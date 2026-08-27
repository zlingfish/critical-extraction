import type {
  ExtractionResult,
  InventoryItem,
  PersistentProfile,
  RunState,
  WeaponState,
} from './types';

export const PROFILE_KEY = 'critical-extraction.profile.v1';
export const BACKPACK_CAPACITY = 6;

export function createDefaultProfile(): PersistentProfile {
  return {
    version: 1,
    credits: 1200,
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
      armor: 50,
      stamina: 100,
      medkits: 2,
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

export function inventoryValue(items: InventoryItem[]): number {
  return items.reduce((sum, item) => sum + item.value * item.quantity, 0);
}

export function canExtract(state: RunState): boolean {
  return state.hasObjective && state.player.health > 0;
}

export function completeReload(weapon: WeaponState): WeaponState {
  if (!weapon.reloading) return weapon;
  const loaded = Math.min(30 - weapon.magazine, weapon.reserve);
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
      return { ...createDefaultProfile(), ...(parsed as PersistentProfile) };
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
