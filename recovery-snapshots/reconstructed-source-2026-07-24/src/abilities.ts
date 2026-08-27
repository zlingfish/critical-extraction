export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export const SMOKE_DURATION = 18;
export const SMOKE_COOLDOWN = 42;
export const SMOKE_RADIUS = 4.8;
export const ADRENALINE_DURATION = 9;
export const ADRENALINE_COOLDOWN = 55;
export const ADRENALINE_SPEED_MULTIPLIER = 1.18;
export const ADRENALINE_TOTAL_HEALING = 20;
export const ADRENALINE_HEALING_PER_SECOND = 2.5;

export function isAbilityReady(now: number, cooldownEndsAt: number): boolean {
  return now >= cooldownEndsAt;
}

export function abilitySecondsRemaining(now: number, endsAt: number): number {
  return Math.max(0, endsAt - now);
}

export function lineSegmentIntersectsSphere(
  start: Vector3Like,
  end: Vector3Like,
  center: Vector3Like,
  radius: number,
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  if (lengthSquared <= Number.EPSILON) {
    return (start.x - center.x) ** 2 + (start.y - center.y) ** 2 + (start.z - center.z) ** 2 <= radius ** 2;
  }
  const t = Math.min(1, Math.max(0, (
    (center.x - start.x) * dx
    + (center.y - start.y) * dy
    + (center.z - start.z) * dz
  ) / lengthSquared));
  const closestX = start.x + dx * t;
  const closestY = start.y + dy * t;
  const closestZ = start.z + dz * t;
  return (closestX - center.x) ** 2 + (closestY - center.y) ** 2 + (closestZ - center.z) ** 2 <= radius ** 2;
}

export function applyAdrenalineHealing(
  health: number,
  healingRemaining: number,
  delta: number,
): { health: number; healingRemaining: number } {
  if (health >= 100 || healingRemaining <= 0 || delta <= 0) return { health, healingRemaining };
  const healing = Math.min(100 - health, healingRemaining, delta * ADRENALINE_HEALING_PER_SECOND);
  return {
    health: health + healing,
    healingRemaining: healingRemaining - healing,
  };
}
