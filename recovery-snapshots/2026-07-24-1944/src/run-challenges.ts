import type { GearCategory, InventoryItem, PersistentProfile } from './types';

/** 可在一局中追踪的挑战类型。 */
export type ChallengeKind =
  | 'no-damage-extraction'
  | 'headshot-kills'
  | 'pistol-only'
  | 'extract-item';

export interface ChallengeDefinition {
  id: string;
  kind: ChallengeKind;
  name: string;
  description: string;
  /** 击杀数目标；只有爆头击杀挑战使用。 */
  targetKills?: number;
  /** 需要带出局外的物品 ID；只有指定物品挑战使用。 */
  targetItemId?: string;
}

export interface ChallengeProgress {
  challengeId: string;
  kind: ChallengeKind;
  progress: number;
  target: number;
  completed: boolean;
  failed: boolean;
  extracted: boolean;
  tookDamage: boolean;
  nonPistolShots: number;
  headshotKills: number;
  extractedItemIds: string[];
}

export type ChallengeEvent =
  | { type: 'damage'; amount?: number }
  | { type: 'kill'; headshot?: boolean }
  | { type: 'weapon-fired'; weapon: 'pistol' | 'other' }
  | { type: 'item-extracted'; itemId: string; quantity?: number }
  | { type: 'extracted' }
  | { type: 'failed' };

export const DEFAULT_CHALLENGES: readonly ChallengeDefinition[] = [
  {
    id: 'clean-extraction',
    kind: 'no-damage-extraction',
    name: '无伤撤离',
    description: '本局生命值不能下降，并成功撤离。',
  },
  {
    id: 'precision-hunter',
    kind: 'headshot-kills',
    name: '精准猎手',
    description: '完成 3 次爆头击杀。',
    targetKills: 3,
  },
  {
    id: 'sidearm-run',
    kind: 'pistol-only',
    name: '手枪行动',
    description: '整局只使用手枪，并成功撤离。',
  },
];

export function dailyChallengeIndex(dateKey: string, challengeCount: number): number {
  if (challengeCount <= 0) return 0;
  let hash = 2166136261;
  for (let index = 0; index < dateKey.length; index += 1) {
    hash ^= dateKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % Math.max(1, Math.floor(challengeCount));
}

export function createExtractItemChallenge(
  itemId: string,
  name = '指定回收',
): ChallengeDefinition {
  return {
    id: `extract-${itemId}`,
    kind: 'extract-item',
    name,
    description: `带出指定物品「${itemId}」。`,
    targetItemId: itemId,
  };
}

export function createChallengeProgress(definition: ChallengeDefinition): ChallengeProgress {
  const target = definition.kind === 'headshot-kills'
    ? Math.max(1, Math.floor(definition.targetKills ?? 1))
    : 1;
  return {
    challengeId: definition.id,
    kind: definition.kind,
    progress: 0,
    target,
    completed: false,
    failed: false,
    extracted: false,
    tookDamage: false,
    nonPistolShots: 0,
    headshotKills: 0,
    extractedItemIds: [],
  };
}

export function createChallengeSet(
  definitions: readonly ChallengeDefinition[] = DEFAULT_CHALLENGES,
): ChallengeProgress[] {
  return definitions.map(createChallengeProgress);
}

function finishIfReady(progress: ChallengeProgress, definition?: ChallengeDefinition): ChallengeProgress {
  if (progress.failed || progress.completed) return progress;
  const ready = (() => {
    switch (progress.kind) {
      case 'no-damage-extraction':
        return progress.extracted && !progress.tookDamage;
      case 'headshot-kills':
        return progress.headshotKills >= progress.target;
      case 'pistol-only':
        return progress.extracted && progress.nonPistolShots === 0;
      case 'extract-item':
        return progress.extracted
          && !!definition?.targetItemId
          && progress.extractedItemIds.includes(definition.targetItemId);
    }
  })();
  return ready ? { ...progress, completed: true, progress: progress.target } : progress;
}

/**
 * 用一条局内事件推进挑战。函数不会修改传入对象，适合在游戏状态或存档中复用。
 */
export function updateChallenge(
  progress: ChallengeProgress,
  event: ChallengeEvent,
  definition?: ChallengeDefinition,
): ChallengeProgress {
  if (progress.completed || progress.failed) return progress;
  let next: ChallengeProgress = { ...progress, extractedItemIds: [...progress.extractedItemIds] };
  switch (event.type) {
    case 'damage':
      if ((event.amount ?? 1) > 0) {
        next.tookDamage = true;
        if (next.kind === 'no-damage-extraction') next.failed = true;
      }
      break;
    case 'kill':
      if (event.headshot) {
        next.headshotKills += 1;
        if (next.kind === 'headshot-kills') next.progress = Math.min(next.target, next.headshotKills);
      }
      break;
    case 'weapon-fired':
      if (event.weapon !== 'pistol') {
        next.nonPistolShots += 1;
        if (next.kind === 'pistol-only') next.failed = true;
      }
      break;
    case 'item-extracted':
      if (!next.extractedItemIds.includes(event.itemId)) next.extractedItemIds.push(event.itemId);
      if (next.kind === 'extract-item' && event.itemId === definition?.targetItemId) next.progress = 1;
      break;
    case 'extracted':
      next.extracted = true;
      break;
    case 'failed':
      next.failed = true;
      break;
  }
  return finishIfReady(next, definition);
}

export function updateChallengeSet(
  progress: readonly ChallengeProgress[],
  definitions: readonly ChallengeDefinition[],
  event: ChallengeEvent,
): ChallengeProgress[] {
  return progress.map((entry) => updateChallenge(
    entry,
    event,
    definitions.find((definition) => definition.id === entry.challengeId),
  ));
}

export function isChallengeComplete(progress: ChallengeProgress): boolean {
  return progress.completed;
}

export function completedChallenges(progress: readonly ChallengeProgress[]): ChallengeProgress[] {
  return progress.filter((entry) => entry.completed);
}

export type LootEquipmentKind = 'armor' | 'weapon' | 'medical';

export interface EquipLootResult {
  profile: PersistentProfile;
  equipped: boolean;
  category: GearCategory | null;
  reason: 'equipped' | 'not-equipable';
}

type EquipmentMetadata = Partial<{
  equipmentType: LootEquipmentKind | GearCategory;
  category: LootEquipmentKind | GearCategory;
  gearCategory: GearCategory;
}>;

function metadataFor(item: InventoryItem): EquipmentMetadata {
  return item as InventoryItem & EquipmentMetadata;
}

/** 根据物品本身判定它是否能作为护甲、武器或医疗装备。 */
export function equipmentCategory(item: InventoryItem): GearCategory | null {
  if (item.equipmentSlot === 'helmet' || item.equipmentSlot === 'armor' || item.equipmentSlot === 'weapon') {
    return item.equipmentSlot;
  }
  const metadata = metadataFor(item);
  const explicit = metadata.gearCategory ?? metadata.category ?? metadata.equipmentType;
  if (explicit === 'helmet' || explicit === 'armor' || explicit === 'medical' || explicit === 'weapon') {
    return explicit;
  }
  const text = `${item.id} ${item.name}`.toLowerCase();
  if (item.kind === 'armor') return /helmet|head|头盔|头部/.test(text) ? 'helmet' : 'armor';
  if (item.kind === 'medical') return 'medical';
  if (/weapon|rifle|pistol|smg|shotgun|sniper|gun|步枪|手枪|冲锋枪|霰弹|狙击/.test(text)) return 'weapon';
  return null;
}

export function isEquipableLoot(item: InventoryItem): boolean {
  return equipmentCategory(item) !== null;
}

/**
 * 把带出的战利品加入仓库并立即装备。返回新档案，不会修改旧档案。
 * 同 ID 物品会叠加数量，ownedGear 只保留一份 ID。
 */
export function equipLootToStash(
  profile: PersistentProfile,
  item: InventoryItem,
  forcedCategory?: GearCategory,
): EquipLootResult {
  const category = forcedCategory ?? equipmentCategory(item);
  if (category !== 'armor' && category !== 'helmet' && category !== 'medical' && category !== 'weapon') {
    return { profile, equipped: false, category: null, reason: 'not-equipable' };
  }
  const quantity = Math.max(1, Math.floor(item.quantity));
  const existing = profile.stash.findIndex((entry) => entry.id === item.id);
  const stash = existing < 0
    ? [...profile.stash, { ...item, quantity }]
    : profile.stash.map((entry, index) => index === existing
      ? { ...entry, quantity: entry.quantity + quantity }
      : entry);
  const ownedGear = profile.ownedGear.includes(item.id) ? [...profile.ownedGear] : [...profile.ownedGear, item.id];
  return {
    profile: {
      ...profile,
      stash,
      ownedGear,
      equippedGear: { ...profile.equippedGear, [category]: item.id },
    },
    equipped: true,
    category,
    reason: 'equipped',
  };
}

/** 简洁版本：只返回更新后的局外档案。 */
export function equipLootToProfile(
  profile: PersistentProfile,
  item: InventoryItem,
  forcedCategory?: GearCategory,
): PersistentProfile {
  const category = forcedCategory ?? equipmentCategory(item);
  if (!category) return profile;
  if (!profile.stash.some((entry) => entry.id === item.id)) {
    return equipLootToStash(profile, item, category).profile;
  }
  return {
    ...profile,
    ownedGear: profile.ownedGear.includes(item.id) ? profile.ownedGear : [...profile.ownedGear, item.id],
    equippedGear: { ...profile.equippedGear, [category]: item.id },
  };
}
