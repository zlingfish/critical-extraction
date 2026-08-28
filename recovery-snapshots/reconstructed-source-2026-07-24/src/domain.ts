import { FACILITY_MAX_LEVELS } from './types';
import { GUNSMITH_WEAPONS, WEAPON_MODIFICATIONS, WEAPON_MOD_SLOTS } from './gunsmith';
import { createHealthyInjuries, durabilityAdjustedValue, revealUnknownItem } from './survival-systems';
import type {
  AmmoLevel,
  ExtractionResult,
  FacilityId,
  GearCategory,
  InventoryItem,
  PersistentProfile,
  RunState,
  WeaponModSlot,
  WeaponState,
} from './types';

export const PROFILE_KEY = 'critical-extraction.profile.v1';
export const BACKPACK_CAPACITY = 12;
export const BACKPACK_GRID_WIDTH = 4;
export const BACKPACK_GRID_HEIGHT = 3;

export function inventoryItemSlots(item: InventoryItem): number {
  const width = Math.max(1, Math.floor(item.slotWidth ?? 1));
  const height = Math.max(1, Math.floor(item.slotHeight ?? 1));
  return width * height;
}

export function backpackUsedSlots(items: readonly InventoryItem[]): number {
  return items.reduce((sum, item) => sum + inventoryItemSlots(item), 0);
}

export function createDefaultProfile(): PersistentProfile {
  return {
    version: 1,
    credits: 1200,
    requisitionTokens: 0,
    nextRunArmorBonus: 0,
    nextRunAmmoBonus: 0,
    nextRunAmmoLevel: null,
    nextRunMedkitBonus: 0,
    selectedKeycardId: null,
    stash: [],
    ownedGear: ['starter-helmet', 'starter-armor', 'starter-pack', 'starter-medical', 'weapon-rifle'],
    equippedGear: {
      helmet: 'starter-helmet',
      armor: 'starter-armor',
      backpack: 'starter-pack',
      medical: 'starter-medical',
      weapon: 'weapon-rifle',
    },
    facilityLevels: {
      workshop: 1,
      command: 1,
      armory: 1,
      warehouse: 1,
      medicalBay: 1,
      training: 1,
    },
    ownedWeaponMods: [],
    weaponBuilds: {},
    gearDurability: {},
    insurancePolicies: [],
    secureContainerCapacity: 2,
    collectionItemIds: [],
    discoveredSecrets: [],
    operationChainStage: 0,
    bestTimeSeconds: null,
    totalExtractions: 0,
    totalKills: 0,
    totalRuns: 0,
  };
}

export function createRunState(): RunState {
  return {
    phase: 'menu',
    player: {
      health: 100,
      armor: 70,
      stamina: 100,
      medkits: 3,
      bandages: 2,
      splints: 1,
      armorLevel: 2,
      armorDurability: 70,
      maxArmorDurability: 70,
      ammoLevel: 1,
      injuries: createHealthyInjuries(),
      secureContainer: [],
      secureContainerCapacity: 2,
      weaponDurability: 100,
      maxWeaponDurability: 100,
      weapon: { magazine: 30, reserve: 90, reloading: false, reloadEndsAt: 0 },
    },
    backpack: [],
    hasObjective: false,
    kills: 0,
    elapsedSeconds: 0,
    extractionProgress: 0,
    objectiveText: '潜入仓库，取得加密硬盘',
    loadoutValue: 0,
    combatLog: [],
    routeLog: [],
  };
}

export function applyDamage(
  health: number,
  armor: number,
  rawDamage: number,
): { health: number; armor: number } {
  const absorbed = Math.min(armor, rawDamage * 0.65);
  const nextArmor = Math.max(0, armor - absorbed);
  const nextHealth = Math.max(0, health - (rawDamage - absorbed));
  return { health: Math.round(nextHealth), armor: Math.round(nextArmor) };
}

export function addInventoryItem(
  items: InventoryItem[],
  item: InventoryItem,
  capacity = BACKPACK_CAPACITY,
): { items: InventoryItem[]; added: boolean } {
  const sameIndex = items.findIndex((entry) => canStackInventoryItems(entry, item));
  if (sameIndex >= 0) {
    const next = items.map((entry, index) =>
      index === sameIndex
        ? { ...entry, quantity: entry.quantity + item.quantity }
        : entry,
    );
    return { items: next, added: true };
  }
  if (backpackUsedSlots(items) + inventoryItemSlots(item) > capacity) return { items, added: false };
  return { items: [...items, { ...item }], added: true };
}

function canStackInventoryItems(left: InventoryItem, right: InventoryItem): boolean {
  if (left.id !== right.id) return false;
  if (['weapon', 'armor', 'helmet'].includes(left.kind) || ['weapon', 'armor', 'helmet'].includes(right.kind)) return false;
  return left.durability === right.durability
    && left.maxDurability === right.maxDurability
    && left.identified === right.identified
    && left.trueName === right.trueName
    && left.trueValue === right.trueValue
    && left.keyUses === right.keyUses
    && left.maxKeyUses === right.maxKeyUses;
}

export function transferInventoryItem(
  source: InventoryItem[],
  destination: InventoryItem[],
  itemId: string,
  capacity = BACKPACK_CAPACITY,
): { source: InventoryItem[]; destination: InventoryItem[]; transferred: boolean } {
  const sourceIndex = source.findIndex((entry) => entry.id === itemId);
  if (sourceIndex < 0) return { source, destination, transferred: false };
  const item = source[sourceIndex];
  const result = addInventoryItem(destination, item, capacity);
  if (!result.added) return { source, destination, transferred: false };
  return {
    source: source.filter((_, index) => index !== sourceIndex),
    destination: result.items,
    transferred: true,
  };
}

export function discardInventoryItem(
  items: InventoryItem[],
  itemId: string,
): { items: InventoryItem[]; discarded: InventoryItem | null } {
  const itemIndex = items.findIndex((entry) => entry.id === itemId);
  if (itemIndex < 0) return { items, discarded: null };
  const discarded = items[itemIndex];
  return {
    items: items.filter((_, index) => index !== itemIndex),
    discarded,
  };
}

export function consumeInventoryItem(
  items: InventoryItem[],
  itemId: string,
  amount = 1,
): { items: InventoryItem[]; consumed: boolean } {
  const quantity = Math.max(1, Math.floor(amount));
  const itemIndex = items.findIndex((entry) => entry.id === itemId && entry.quantity >= quantity);
  if (itemIndex < 0) return { items, consumed: false };
  const next = [...items];
  const item = next[itemIndex];
  if (item.quantity === quantity) next.splice(itemIndex, 1);
  else next[itemIndex] = { ...item, quantity: item.quantity - quantity };
  return { items: next, consumed: true };
}

export function consumeKeyUse(
  items: InventoryItem[],
  itemId: string,
): { items: InventoryItem[]; consumed: boolean; remainingUses: number } {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) return { items, consumed: false, remainingUses: 0 };
  const uses = Math.max(1, Math.floor(item.keyUses ?? 1));
  if (uses <= 1) {
    const consumed = consumeInventoryItem(items, itemId);
    return { ...consumed, remainingUses: 0 };
  }
  return {
    consumed: true,
    remainingUses: uses - 1,
    items: items.map((entry) => entry === item ? { ...entry, keyUses: uses - 1 } : entry),
  };
}

export function reorderInventoryItems(
  items: InventoryItem[],
  sourceId: string,
  targetId: string | null,
): InventoryItem[] {
  const sourceIndex = items.findIndex((entry) => entry.id === sourceId);
  if (sourceIndex < 0) return items;
  const targetIndex = targetId === null ? items.length - 1 : items.findIndex((entry) => entry.id === targetId);
  if (targetIndex < 0 || targetIndex === sourceIndex) return items;
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

const RARITY_SCORE: Record<InventoryItem['rarity'], number> = {
  black: 0,
  white: 1,
  green: 2,
  blue: 3,
  purple: 4,
  gold: 5,
  red: 6,
};

export function sortInventoryItems(items: InventoryItem[]): InventoryItem[] {
  return [...items].sort((a, b) =>
    RARITY_SCORE[b.rarity] - RARITY_SCORE[a.rarity]
      || b.value * b.quantity - a.value * a.quantity
      || a.name.localeCompare(b.name, 'zh-CN'),
  );
}

export function revealedLootSlots(progress: number, capacity: number): number {
  const safeCapacity = Math.max(0, Math.floor(capacity));
  const safeProgress = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return Math.min(safeCapacity, Math.floor(safeProgress * safeCapacity));
}

export function nextLootRevealCount(current: number, capacity: number): number {
  const safeCapacity = Math.max(0, Math.floor(capacity));
  return Math.min(safeCapacity, Math.max(0, Math.floor(current)) + 1);
}

export function inventoryValue(items: InventoryItem[]): number {
  return items.reduce((sum, item) => sum + durabilityAdjustedValue(item) * item.quantity, 0);
}

export function canExtract(state: RunState): boolean {
  return state.hasObjective && state.player.health > 0;
}

export function completeReload(weapon: WeaponState, magazineCapacity = 30): WeaponState {
  if (!weapon.reloading) return weapon;
  const loaded = Math.min(magazineCapacity - weapon.magazine, weapon.reserve);
  return {
    magazine: weapon.magazine + loaded,
    reserve: weapon.reserve - loaded,
    reloading: false,
    reloadEndsAt: 0,
  };
}

export function settleExtraction(
  profile: PersistentProfile,
  run: RunState,
): { profile: PersistentProfile; result: ExtractionResult } {
  const extractedItems = [...run.backpack, ...run.player.secureContainer].map(revealUnknownItem);
  const value = inventoryValue(extractedItems);
  const score = value + run.kills * 180 - run.elapsedSeconds * 2;
  const grade: ExtractionResult['grade'] =
    score >= 4200 ? 'S' : score >= 2800 ? 'A' : score >= 1400 ? 'B' : 'C';
  const stash = [...profile.stash];
  for (const item of extractedItems) {
    const merged = addInventoryItem(stash, item, Number.POSITIVE_INFINITY);
    stash.splice(0, stash.length, ...merged.items);
  }
  return {
    profile: {
      ...profile,
      stash,
      collectionItemIds: [...new Set([...profile.collectionItemIds, ...extractedItems.map((item) => item.id)])],
      bestTimeSeconds:
        profile.bestTimeSeconds === null
          ? run.elapsedSeconds
          : Math.min(profile.bestTimeSeconds, run.elapsedSeconds),
      totalExtractions: profile.totalExtractions + 1,
      totalKills: profile.totalKills + run.kills,
      totalRuns: profile.totalRuns + 1,
    },
    result: { value, grade, timeSeconds: run.elapsedSeconds, kills: run.kills },
  };
}

export function settleFailure(
  profile: PersistentProfile,
  run: RunState,
): { profile: PersistentProfile; retained: InventoryItem[] } {
  const retained = run.player.secureContainer.map(revealUnknownItem);
  let stash = [...profile.stash];
  for (const item of retained) stash = addInventoryItem(stash, item, Number.POSITIVE_INFINITY).items;
  return {
    retained,
    profile: {
      ...profile,
      stash,
      collectionItemIds: [...new Set([...profile.collectionItemIds, ...retained.map((item) => item.id)])],
      insurancePolicies: profile.insurancePolicies.map((policy) => policy.status === 'covered'
        ? { ...policy, status: 'active' as const, returnAt: Date.now() + 60_000 }
        : policy),
      totalKills: profile.totalKills + run.kills,
      totalRuns: profile.totalRuns + 1,
    },
  };
}

export function insureItem(
  profile: PersistentProfile,
  item: InventoryItem,
  premium: number,
  now = Date.now(),
  delayMs = 60_000,
): PersistentProfile {
  const cost = Math.max(0, Math.round(premium));
  const alreadyActive = profile.insurancePolicies.some((policy) => policy.itemId === item.id && (policy.status === 'covered' || policy.status === 'active'));
  if (profile.credits < cost || alreadyActive) return profile;
  return {
    ...profile,
    credits: profile.credits - cost,
    insurancePolicies: [...profile.insurancePolicies, {
      id: `${item.id}-${now}`,
      itemId: item.id,
      itemName: item.name,
      item: { ...item, quantity: 1 },
      premium: cost,
      returnAt: now + Math.max(1_000, delayMs),
      status: 'covered',
    }],
  };
}

export function collectInsuranceReturns(
  profile: PersistentProfile,
  now = Date.now(),
): { profile: PersistentProfile; returned: InventoryItem[] } {
  const due = profile.insurancePolicies.filter((policy) => policy.status === 'active' && policy.returnAt <= now);
  if (due.length === 0) return { profile, returned: [] };
  let stash = [...profile.stash];
  for (const policy of due) stash = addInventoryItem(stash, policy.item, Number.POSITIVE_INFINITY).items;
  const dueIds = new Set(due.map((policy) => policy.id));
  return {
    returned: due.map((policy) => policy.item),
    profile: {
      ...profile,
      stash,
      insurancePolicies: profile.insurancePolicies.map((policy) => dueIds.has(policy.id)
        ? { ...policy, status: 'returned' as const }
        : policy),
    },
  };
}

export function gearDurabilityPercent(profile: PersistentProfile, gearId: string): number {
  const saved = profile.gearDurability[gearId];
  if (!Number.isFinite(saved)) return 100;
  return Math.max(0, Math.min(100, Math.round(saved)));
}

export function gearRepairCost(profile: PersistentProfile, gearId: string, fullValue: number): number {
  const missingPercent = 100 - gearDurabilityPercent(profile, gearId);
  if (missingPercent <= 0) return 0;
  return Math.max(fullValue > 0 ? 80 : 0, Math.round(Math.max(0, fullValue) * missingPercent / 100 * 0.4));
}

export function repairGear(profile: PersistentProfile, gearId: string, fullValue: number): PersistentProfile {
  if (!profile.ownedGear.includes(gearId)) return profile;
  const cost = gearRepairCost(profile, gearId, fullValue);
  if (cost <= 0 || profile.credits < cost) return profile;
  return {
    ...profile,
    credits: profile.credits - cost,
    gearDurability: { ...profile.gearDurability, [gearId]: 100 },
  };
}

export function persistRunDurability(profile: PersistentProfile, run: RunState): PersistentProfile {
  const next = { ...profile.gearDurability };
  const armorPercent = run.player.maxArmorDurability > 0
    ? Math.round(run.player.armorDurability / run.player.maxArmorDurability * 100)
    : 0;
  for (const category of ['helmet', 'armor'] as const) {
    const gearId = profile.equippedGear[category];
    if (!gearId) continue;
    next[gearId] = Math.min(gearDurabilityPercent(profile, gearId), Math.max(0, Math.min(100, armorPercent)));
  }
  const weaponId = profile.equippedGear.weapon;
  if (weaponId) {
    const weaponPercent = run.player.maxWeaponDurability > 0
      ? Math.round(run.player.weaponDurability / run.player.maxWeaponDurability * 100)
      : 0;
    next[weaponId] = Math.min(gearDurabilityPercent(profile, weaponId), Math.max(0, Math.min(100, weaponPercent)));
  }
  return { ...profile, gearDurability: next };
}

export function sellItem(
  profile: PersistentProfile,
  itemId: string,
): PersistentProfile {
  const item = profile.stash.find((entry) => entry.id === itemId);
  if (!item) return profile;
  const stash = item.quantity > 1
    ? profile.stash.map((entry) => entry.id === itemId
      ? { ...entry, quantity: entry.quantity - 1 }
      : entry)
    : profile.stash.filter((entry) => entry.id !== itemId);
  return {
    ...profile,
    credits: profile.credits + durabilityAdjustedValue(item),
    selectedKeycardId: stash.some((entry) => entry.id === profile.selectedKeycardId)
      ? profile.selectedKeycardId
      : null,
    stash,
  };
}

export function sellAll(profile: PersistentProfile): PersistentProfile {
  return {
    ...profile,
    credits: profile.credits + inventoryValue(profile.stash),
    selectedKeycardId: null,
    stash: [],
  };
}

export function selectKeycard(profile: PersistentProfile, itemId: string | null): PersistentProfile {
  if (itemId === null) return { ...profile, selectedKeycardId: null };
  if (!profile.stash.some((item) => item.id === itemId && (item.keyUses ?? 0) > 0)) return profile;
  return { ...profile, selectedKeycardId: itemId };
}

export function withdrawSelectedKeycardForRun(
  profile: PersistentProfile,
  expectedItemId: string,
): { profile: PersistentProfile; item: InventoryItem | null } {
  if (profile.selectedKeycardId !== expectedItemId) return { profile, item: null };
  const index = profile.stash.findIndex((item) => item.id === expectedItemId && (item.keyUses ?? 0) > 0);
  if (index < 0) return { profile, item: null };
  const selected = profile.stash[index];
  const stash = [...profile.stash];
  if (selected.quantity > 1) stash[index] = { ...selected, quantity: selected.quantity - 1 };
  else stash.splice(index, 1);
  return {
    profile: { ...profile, stash },
    item: { ...selected, quantity: 1 },
  };
}

export function buyMarketItem(
  profile: PersistentProfile,
  item: InventoryItem,
  price: number,
): PersistentProfile {
  if (profile.credits < price || price < 0) return profile;
  const added = addInventoryItem(profile.stash, item, Number.POSITIVE_INFINITY);
  return {
    ...profile,
    credits: profile.credits - price,
    stash: added.items,
  };
}

export type SupplyId = 'armor' | 'ammo' | 'medical';

export interface AmmoPackDefinition {
  level: AmmoLevel;
  name: string;
  cost: number;
  rounds: number;
  description: string;
}

export const AMMO_PACKS: readonly AmmoPackDefinition[] = [
  { level: 0, name: '训练弹', cost: 100, rounds: 90, description: '数量多但穿甲能力很弱，适合无甲目标。' },
  { level: 1, name: '民用弹', cost: 300, rounds: 90, description: '基础弹药，对轻型防护有一定效果。' },
  { level: 2, name: '制式弹', cost: 700, rounds: 75, description: '常规行动弹药，兼顾价格与穿透。' },
  { level: 3, name: '强化弹', cost: 1500, rounds: 75, description: '可稳定对付中等防护目标。' },
  { level: 4, name: '穿甲弹', cost: 3200, rounds: 60, description: '针对重甲目标，价格明显提高。' },
  { level: 5, name: '特种穿甲弹', cost: 6000, rounds: 45, description: '高危行动用弹，对高级护甲威胁很大。' },
  { level: 6, name: '绝密钨芯弹', cost: 10000, rounds: 30, description: '最高等级弹药，数量少但穿透最强。' },
] as const;

export function buyAmmoPack(profile: PersistentProfile, level: AmmoLevel): PersistentProfile {
  const pack = AMMO_PACKS.find((entry) => entry.level === level);
  if (!pack || profile.nextRunAmmoLevel !== null || profile.credits < pack.cost) return profile;
  return {
    ...profile,
    credits: profile.credits - pack.cost,
    nextRunAmmoLevel: pack.level,
    nextRunAmmoBonus: Math.min(180, profile.nextRunAmmoBonus + pack.rounds),
  };
}

export function buySupply(profile: PersistentProfile, supplyId: SupplyId): PersistentProfile {
  const supplies = {
    armor: { cost: 1600, field: 'nextRunArmorBonus' as const, amount: 30, limit: 60 },
    ammo: { cost: 1100, field: 'nextRunAmmoBonus' as const, amount: 30, limit: 90 },
    medical: { cost: 1800, field: 'nextRunMedkitBonus' as const, amount: 1, limit: 3 },
  };
  const supply = supplies[supplyId];
  if (profile.credits < supply.cost || profile[supply.field] >= supply.limit) return profile;
  return {
    ...profile,
    credits: profile.credits - supply.cost,
    [supply.field]: Math.min(supply.limit, profile[supply.field] + supply.amount),
  };
}

export function buyGear(
  profile: PersistentProfile,
  gearId: string,
  category: GearCategory,
  price: number,
): PersistentProfile {
  if (price < 0 || profile.credits < price || profile.ownedGear.includes(gearId)) return profile;
  return {
    ...profile,
    credits: profile.credits - price,
    ownedGear: [...profile.ownedGear, gearId],
    gearDurability: { ...profile.gearDurability, [gearId]: 100 },
    equippedGear: profile.equippedGear[category]
      ? profile.equippedGear
      : { ...profile.equippedGear, [category]: gearId },
  };
}

export function equipGear(
  profile: PersistentProfile,
  gearId: string,
  category: GearCategory,
): PersistentProfile {
  if (!profile.ownedGear.includes(gearId)) return profile;
  return {
    ...profile,
    equippedGear: { ...profile.equippedGear, [category]: gearId },
  };
}

export function upgradeFacility(
  profile: PersistentProfile,
  facilityId: FacilityId,
  cost: number,
  maxLevel = FACILITY_MAX_LEVELS[facilityId],
): PersistentProfile {
  const currentLevel = profile.facilityLevels[facilityId] ?? 1;
  if (cost < 0 || profile.credits < cost || currentLevel >= maxLevel) return profile;
  return {
    ...profile,
    credits: profile.credits - cost,
    facilityLevels: { ...profile.facilityLevels, [facilityId]: currentLevel + 1 },
  };
}

export function buyWeaponModification(
  profile: PersistentProfile,
  modificationId: string,
  price: number,
): PersistentProfile {
  const modificationExists = WEAPON_MODIFICATIONS.some((modification) => modification.id === modificationId);
  if (
    !modificationExists ||
    !Number.isFinite(price) ||
    price < 0 ||
    profile.credits < price ||
    profile.ownedWeaponMods.includes(modificationId)
  ) return profile;
  return {
    ...profile,
    credits: profile.credits - price,
    ownedWeaponMods: [...profile.ownedWeaponMods, modificationId],
  };
}

export function equipWeaponModification(
  profile: PersistentProfile,
  weaponId: string,
  slot: WeaponModSlot,
  modificationId: string,
): PersistentProfile {
  const weaponExists = GUNSMITH_WEAPONS.some((weapon) => weapon.id === weaponId);
  const modification = WEAPON_MODIFICATIONS.find((entry) => entry.id === modificationId);
  if (!weaponExists || modification?.slot !== slot || !profile.ownedWeaponMods.includes(modificationId)) return profile;
  return {
    ...profile,
    weaponBuilds: {
      ...profile.weaponBuilds,
      [weaponId]: { ...profile.weaponBuilds[weaponId], [slot]: modificationId },
    },
  };
}

export function removeWeaponModification(
  profile: PersistentProfile,
  weaponId: string,
  slot: WeaponModSlot,
): PersistentProfile {
  const currentBuild = profile.weaponBuilds[weaponId];
  if (!currentBuild?.[slot]) return profile;
  const nextBuild = { ...currentBuild };
  delete nextBuild[slot];
  return { ...profile, weaponBuilds: { ...profile.weaponBuilds, [weaponId]: nextBuild } };
}

export function parseProfile(raw: string | null): PersistentProfile {
  if (!raw) return createDefaultProfile();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      parsed.version === 1 &&
      'credits' in parsed &&
      typeof parsed.credits === 'number' &&
      'stash' in parsed &&
      Array.isArray(parsed.stash)
    ) {
      const defaults = createDefaultProfile();
      const restored = { ...defaults, ...(parsed as PersistentProfile) };
      const convertedTokens = Number.isFinite(restored.requisitionTokens) ? restored.requisitionTokens : 0;
      const ownedWeaponMods = Array.isArray(restored.ownedWeaponMods)
        ? restored.ownedWeaponMods.filter((id): id is string =>
          typeof id === 'string' && WEAPON_MODIFICATIONS.some((modification) => modification.id === id))
        : defaults.ownedWeaponMods;
      const savedWeaponBuilds = typeof restored.weaponBuilds === 'object' && restored.weaponBuilds !== null && !Array.isArray(restored.weaponBuilds)
        ? restored.weaponBuilds
        : {};
      const weaponBuilds = Object.fromEntries(GUNSMITH_WEAPONS.flatMap((weapon) => {
        const savedBuild = savedWeaponBuilds[weapon.id];
        if (!savedBuild || typeof savedBuild !== 'object' || Array.isArray(savedBuild)) return [];
        const validBuild = Object.fromEntries(WEAPON_MOD_SLOTS.flatMap((slot) => {
          const modificationId = savedBuild[slot.id];
          const valid = typeof modificationId === 'string'
            && ownedWeaponMods.includes(modificationId)
            && WEAPON_MODIFICATIONS.some((modification) => modification.id === modificationId && modification.slot === slot.id);
          return valid ? [[slot.id, modificationId]] : [];
        }));
        return Object.keys(validBuild).length > 0 ? [[weapon.id, validBuild]] : [];
      }));
      const insurancePolicies = Array.isArray(restored.insurancePolicies)
        ? restored.insurancePolicies.filter((policy): policy is PersistentProfile['insurancePolicies'][number] => {
          if (!policy || typeof policy !== 'object') return false;
          const candidate = policy as PersistentProfile['insurancePolicies'][number];
          return typeof candidate.id === 'string'
            && typeof candidate.itemId === 'string'
            && candidate.item && typeof candidate.item === 'object'
            && (candidate.status === 'covered' || candidate.status === 'active' || candidate.status === 'returned' || candidate.status === 'lost')
            && Number.isFinite(candidate.returnAt);
        })
        : defaults.insurancePolicies;
      const nextRunAmmoLevel = Number.isInteger(restored.nextRunAmmoLevel)
        && restored.nextRunAmmoLevel !== null
        && restored.nextRunAmmoLevel >= 0
        && restored.nextRunAmmoLevel <= 6
        ? restored.nextRunAmmoLevel as AmmoLevel
        : null;
      const selectedKeycardId = typeof restored.selectedKeycardId === 'string'
        ? restored.selectedKeycardId
        : null;
      return {
        ...restored,
        credits: restored.credits + convertedTokens * 180,
        requisitionTokens: 0,
        nextRunAmmoLevel,
        selectedKeycardId,
        ownedGear: Array.isArray(restored.ownedGear) ? restored.ownedGear : defaults.ownedGear,
        equippedGear: {
          ...defaults.equippedGear,
          ...(typeof restored.equippedGear === 'object' && restored.equippedGear !== null ? restored.equippedGear : {}),
        },
        facilityLevels: Object.fromEntries(
          (Object.keys(FACILITY_MAX_LEVELS) as FacilityId[]).map((facilityId) => {
            const savedLevel = restored.facilityLevels?.[facilityId];
            const level = typeof savedLevel === 'number' && Number.isFinite(savedLevel)
              ? Math.min(FACILITY_MAX_LEVELS[facilityId], Math.max(1, Math.floor(savedLevel)))
              : defaults.facilityLevels[facilityId];
            return [facilityId, level];
          }),
        ) as Record<FacilityId, number>,
        ownedWeaponMods,
        weaponBuilds,
        gearDurability: typeof restored.gearDurability === 'object' && restored.gearDurability !== null && !Array.isArray(restored.gearDurability)
          ? Object.fromEntries(Object.entries(restored.gearDurability)
            .filter((entry): entry is [string, number] => typeof entry[0] === 'string' && typeof entry[1] === 'number' && Number.isFinite(entry[1]))
            .map(([id, durability]) => [id, Math.max(0, Math.min(100, Math.round(durability)))]))
          : defaults.gearDurability,
        insurancePolicies,
        secureContainerCapacity: Number.isFinite(restored.secureContainerCapacity)
          ? Math.max(1, Math.min(4, Math.floor(restored.secureContainerCapacity)))
          : defaults.secureContainerCapacity,
        collectionItemIds: Array.isArray(restored.collectionItemIds)
          ? restored.collectionItemIds.filter((id): id is string => typeof id === 'string')
          : defaults.collectionItemIds,
        discoveredSecrets: Array.isArray(restored.discoveredSecrets)
          ? restored.discoveredSecrets.filter((id): id is string => typeof id === 'string')
          : defaults.discoveredSecrets,
        operationChainStage: Number.isFinite(restored.operationChainStage)
          ? Math.max(0, Math.min(3, Math.floor(restored.operationChainStage)))
          : defaults.operationChainStage,
      };
    }
  } catch {
    return createDefaultProfile();
  }
  return createDefaultProfile();
}

export function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
