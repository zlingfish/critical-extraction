import type {
  ExtractionResult,
  InventoryItem,
  PersistentProfile,
  RunState,
  WeaponState,
} from './types';

export const PROFILE_KEY = 'critical-extraction.profile.v1';
export const BACKPACK_CAPACITY = 12;

export function createDefaultProfile(): PersistentProfile {
  return {
    version: 1,
    credits: 1200,
    requisitionTokens: 0,
    nextRunArmorBonus: 0,
    nextRunAmmoBonus: 0,
    nextRunMedkitBonus: 0,
    stash: [],
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
      weapon: { magazine: 30, reserve: 90, reloading: false, reloadEndsAt: 0 },
    },
    backpack: [],
    hasObjective: false,
    kills: 0,
    elapsedSeconds: 0,
    extractionProgress: 0,
    objectiveText: '潜入仓库，取得加密硬盘',
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
  const sameIndex = items.findIndex((entry) => entry.id === item.id);
  if (sameIndex >= 0) {
    const next = items.map((entry, index) =>
      index === sameIndex
        ? { ...entry, quantity: entry.quantity + item.quantity }
        : entry,
    );
    return { items: next, added: true };
  }
  if (items.length >= capacity) return { items, added: false };
  return { items: [...items, { ...item }], added: true };
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
  return items.reduce((sum, item) => sum + item.value * item.quantity, 0);
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
  const value = inventoryValue(run.backpack);
  const score = value + run.kills * 180 - run.elapsedSeconds * 2;
  const grade: ExtractionResult['grade'] =
    score >= 4200 ? 'S' : score >= 2800 ? 'A' : score >= 1400 ? 'B' : 'C';
  const stash = [...profile.stash];
  for (const item of run.backpack) {
    const merged = addInventoryItem(stash, item, Number.POSITIVE_INFINITY);
    stash.splice(0, stash.length, ...merged.items);
  }
  return {
    profile: {
      ...profile,
      stash,
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

export function sellItem(
  profile: PersistentProfile,
  itemId: string,
): PersistentProfile {
  const item = profile.stash.find((entry) => entry.id === itemId);
  if (!item) return profile;
  return {
    ...profile,
    credits: profile.credits + item.value * item.quantity,
    stash: profile.stash.filter((entry) => entry.id !== itemId),
  };
}

export function sellAll(profile: PersistentProfile): PersistentProfile {
  return {
    ...profile,
    credits: profile.credits + inventoryValue(profile.stash),
    stash: [],
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
      const restored = { ...createDefaultProfile(), ...(parsed as PersistentProfile) };
      const convertedTokens = Number.isFinite(restored.requisitionTokens) ? restored.requisitionTokens : 0;
      return {
        ...restored,
        credits: restored.credits + convertedTokens * 180,
        requisitionTokens: 0,
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
