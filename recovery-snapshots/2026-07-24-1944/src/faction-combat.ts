export type EnemyFaction = 'security' | 'raider';

export interface FactionCombatant {
  id: number;
  faction: EnemyFaction;
  alive: boolean;
  x: number;
  z: number;
}

export interface FactionDamageResult {
  health: number;
  armor: number;
  healthDamage: number;
  armorDamage: number;
  killed: boolean;
}

export function areEnemyFactionsHostile(left: EnemyFaction, right: EnemyFaction): boolean {
  return left !== right;
}

export function selectFactionTarget<T extends FactionCombatant>(
  source: T,
  candidates: readonly T[],
  maxDistance: number,
): T | null {
  const range = Math.max(0, maxDistance);
  let closest: T | null = null;
  let closestDistanceSquared = range * range;
  for (const candidate of candidates) {
    if (candidate.id === source.id || !candidate.alive) continue;
    if (!areEnemyFactionsHostile(source.faction, candidate.faction)) continue;
    const distanceSquared = (candidate.x - source.x) ** 2 + (candidate.z - source.z) ** 2;
    if (distanceSquared > closestDistanceSquared) continue;
    closest = candidate;
    closestDistanceSquared = distanceSquared;
  }
  return closest;
}

export function resolveFactionDamage(
  health: number,
  armor: number,
  rawDamage: number,
  armorAbsorption = 0.45,
): FactionDamageResult {
  const safeHealth = Math.max(0, health);
  const safeArmor = Math.max(0, armor);
  const damage = Math.max(0, rawDamage);
  const absorption = Math.min(1, Math.max(0, armorAbsorption));
  const armorDamage = Math.min(safeArmor, damage * absorption);
  const healthDamage = Math.min(safeHealth, damage - armorDamage);
  const nextHealth = Math.max(0, safeHealth - healthDamage);
  return {
    health: nextHealth,
    armor: Math.max(0, safeArmor - armorDamage),
    healthDamage,
    armorDamage,
    killed: nextHealth <= 0 && safeHealth > 0,
  };
}
