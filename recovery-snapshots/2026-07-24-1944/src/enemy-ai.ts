export type EnemyWeaponId = 'smg' | 'shotgun' | 'sniper';
export type EnemyTactic = 'advance' | 'flank' | 'cover' | 'retreat';
export type EnemyDifficultyId = 'recruit' | 'standard' | 'veteran';
export type EnemyWarningCue = 'raise_weapon' | 'callout';
export type EnemyAttackPhase = 'idle' | 'warning' | 'ready';

export interface EnemyDifficultyBehavior {
  reactionTime: number;
  reactionJitter: number;
  coordinationRadius: number;
  coordinationCooldown: number;
  maxCoordinatedAllies: number;
  tacticRefreshMultiplier: number;
  healthMultiplier: number;
  damageMultiplier: number;
  accuracyMultiplier: number;
}

export interface EnemyAttackWarningState {
  phase: EnemyAttackPhase;
  readyAt: number;
}

export interface EnemyAttackWarningResult {
  state: EnemyAttackWarningState;
  canFire: boolean;
  cue: EnemyWarningCue | null;
}

export interface EnemySuppressionResponse {
  suppressed: boolean;
  duration: number;
  forceCover: boolean;
  accuracyMultiplier: number;
  burstSizeMultiplier: number;
  movementSpeedMultiplier: number;
}

export interface EnemyPerceptionState {
  awareness: number;
  lastVisualAt: number;
}

export interface EnemyPerceptionResult {
  state: EnemyPerceptionState;
  observing: boolean;
  confirmed: boolean;
}

export interface EnemyWeaponConfig {
  id: EnemyWeaponId;
  label: string;
  magazineSize: number;
  reloadDuration: number;
  range: number;
  preferredMin: number;
  preferredMax: number;
  burstSize: number;
  fireInterval: number;
  burstPause: number;
  pelletCount: number;
  damageMin: number;
  damageMax: number;
  baseAccuracy: number;
  distanceFalloff: number;
  shotVolume: number;
}

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface SegmentProximity {
  point: Vector3Like;
  distance: number;
  t: number;
}

export const BULLET_WHIZ_MIN_DISTANCE = 0.45;
export const BULLET_WHIZ_MAX_DISTANCE = 2.8;

export function closestPointOnSegment(
  start: Vector3Like,
  end: Vector3Like,
  point: Vector3Like,
): SegmentProximity {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentZ = end.z - start.z;
  const lengthSquared = segmentX ** 2 + segmentY ** 2 + segmentZ ** 2;
  const projection = lengthSquared > 0
    ? ((point.x - start.x) * segmentX
      + (point.y - start.y) * segmentY
      + (point.z - start.z) * segmentZ) / lengthSquared
    : 0;
  const t = Math.max(0, Math.min(1, projection));
  const closest = {
    x: start.x + segmentX * t,
    y: start.y + segmentY * t,
    z: start.z + segmentZ * t,
  };
  return {
    point: closest,
    distance: Math.hypot(point.x - closest.x, point.y - closest.y, point.z - closest.z),
    t,
  };
}

export function shouldPlayBulletWhiz(distance: number, hitPlayer: boolean): boolean {
  return !hitPlayer
    && Number.isFinite(distance)
    && distance >= BULLET_WHIZ_MIN_DISTANCE
    && distance <= BULLET_WHIZ_MAX_DISTANCE;
}

export const ENEMY_WEAPON_CONFIGS: Record<EnemyWeaponId, EnemyWeaponConfig> = {
  smg: {
    id: 'smg', label: '冲锋枪手', magazineSize: 24, reloadDuration: 2.15,
    range: 32, preferredMin: 8, preferredMax: 18, burstSize: 4,
    fireInterval: 0.11, burstPause: 0.72, pelletCount: 1,
    damageMin: 5, damageMax: 8, baseAccuracy: 0.43, distanceFalloff: 0.007,
    shotVolume: 0.05,
  },
  shotgun: {
    id: 'shotgun', label: '霰弹枪手', magazineSize: 6, reloadDuration: 2.8,
    range: 17, preferredMin: 4, preferredMax: 10, burstSize: 1,
    fireInterval: 0.9, burstPause: 1.05, pelletCount: 6,
    damageMin: 3, damageMax: 5, baseAccuracy: 0.54, distanceFalloff: 0.027,
    shotVolume: 0.095,
  },
  sniper: {
    id: 'sniper', label: '精确射手', magazineSize: 5, reloadDuration: 3.15,
    range: 68, preferredMin: 27, preferredMax: 48, burstSize: 1,
    fireInterval: 1.8, burstPause: 2.05, pelletCount: 1,
    damageMin: 22, damageMax: 31, baseAccuracy: 0.68, distanceFalloff: 0.004,
    shotVolume: 0.08,
  },
};

/**
 * Higher difficulties make enemies notice, communicate, and reposition faster.
 * Health, damage, and raw accuracy deliberately stay unchanged so difficulty is
 * expressed through behaviour rather than inflated numbers.
 */
export const ENEMY_DIFFICULTY_BEHAVIOR: Record<EnemyDifficultyId, EnemyDifficultyBehavior> = {
  recruit: {
    reactionTime: 1.18,
    reactionJitter: 0.22,
    coordinationRadius: 22,
    coordinationCooldown: 11,
    maxCoordinatedAllies: 1,
    tacticRefreshMultiplier: 1.2,
    healthMultiplier: 1,
    damageMultiplier: 1,
    accuracyMultiplier: 1,
  },
  standard: {
    reactionTime: 0.82,
    reactionJitter: 0.16,
    coordinationRadius: 30,
    coordinationCooldown: 8,
    maxCoordinatedAllies: 2,
    tacticRefreshMultiplier: 1,
    healthMultiplier: 1,
    damageMultiplier: 1,
    accuracyMultiplier: 1,
  },
  veteran: {
    reactionTime: 0.5,
    reactionJitter: 0.1,
    coordinationRadius: 40,
    coordinationCooldown: 5.5,
    maxCoordinatedAllies: 4,
    tacticRefreshMultiplier: 0.78,
    healthMultiplier: 1,
    damageMultiplier: 1,
    accuracyMultiplier: 1,
  },
};

export function getEnemyDifficultyBehavior(difficulty: EnemyDifficultyId): EnemyDifficultyBehavior {
  return ENEMY_DIFFICULTY_BEHAVIOR[difficulty];
}

export function getEnemyReactionTime(input: {
  difficulty: EnemyDifficultyId;
  roll: number;
  elite?: boolean;
  boss?: boolean;
}): number {
  const behavior = getEnemyDifficultyBehavior(input.difficulty);
  const clampedRoll = Math.max(0, Math.min(1, input.roll));
  const jitter = (clampedRoll * 2 - 1) * behavior.reactionJitter;
  const rankMultiplier = input.boss ? 0.72 : input.elite ? 0.86 : 1;
  return Math.max(0.3, (behavior.reactionTime + jitter) * rankMultiplier);
}

export function updateEnemyPerception(input: {
  state: EnemyPerceptionState;
  now: number;
  delta: number;
  visible: boolean;
  inCone: boolean;
  closeRange: boolean;
  alreadyEngaged: boolean;
  difficulty: EnemyDifficultyId;
  elite?: boolean;
  boss?: boolean;
}): EnemyPerceptionResult {
  const observing = input.visible && (input.inCone || input.closeRange || input.alreadyEngaged);
  const reactionTime = getEnemyReactionTime({
    difficulty: input.difficulty,
    roll: 0.5,
    elite: input.elite,
    boss: input.boss,
  });
  const safeDelta = Math.max(0, Number.isFinite(input.delta) ? input.delta : 0);
  let awareness = Math.min(1, Math.max(0, input.state.awareness));
  let lastVisualAt = input.state.lastVisualAt;

  if (observing) {
    const closeMultiplier = input.closeRange ? 1.35 : 1;
    awareness = Math.min(1, awareness + safeDelta * closeMultiplier / Math.max(0.3, reactionTime));
    lastVisualAt = input.now;
  } else {
    awareness = Math.max(0, awareness - safeDelta / Math.max(0.4, reactionTime * 1.4));
  }

  return {
    state: { awareness, lastVisualAt },
    observing,
    confirmed: observing && awareness >= 1,
  };
}

export function selectEnemyWarningCue(input: {
  roll: number;
  nearbyAllies: number;
  boss?: boolean;
}): EnemyWarningCue {
  const calloutChance = input.boss ? 0.8 : input.nearbyAllies > 0 ? 0.62 : 0.28;
  return input.roll < calloutChance ? 'callout' : 'raise_weapon';
}

export function updateEnemyAttackWarning(input: {
  state: EnemyAttackWarningState;
  now: number;
  targetVisible: boolean;
  targetInRange: boolean;
  difficulty: EnemyDifficultyId;
  reactionRoll: number;
  warningRoll: number;
  nearbyAllies: number;
  elite?: boolean;
  boss?: boolean;
}): EnemyAttackWarningResult {
  if (!input.targetVisible || !input.targetInRange) {
    return { state: { phase: 'idle', readyAt: 0 }, canFire: false, cue: null };
  }

  if (input.state.phase === 'idle') {
    const reactionTime = getEnemyReactionTime({
      difficulty: input.difficulty,
      roll: input.reactionRoll,
      elite: input.elite,
      boss: input.boss,
    });
    return {
      state: { phase: 'warning', readyAt: input.now + reactionTime },
      canFire: false,
      cue: selectEnemyWarningCue({
        roll: input.warningRoll,
        nearbyAllies: input.nearbyAllies,
        boss: input.boss,
      }),
    };
  }

  if (input.state.phase === 'warning' && input.now < input.state.readyAt) {
    return { state: input.state, canFire: false, cue: null };
  }

  const readyState: EnemyAttackWarningState = { phase: 'ready', readyAt: input.state.readyAt };
  return { state: readyState, canFire: true, cue: null };
}

export function getEnemySuppressionResponse(input: {
  now: number;
  lastSuppressedAt: number;
  elite?: boolean;
  boss?: boolean;
}): EnemySuppressionResponse {
  const duration = input.boss ? 0.9 : input.elite ? 2.1 : 2.8;
  const suppressed = Number.isFinite(input.lastSuppressedAt)
    && input.now >= input.lastSuppressedAt
    && input.now - input.lastSuppressedAt < duration;
  if (!suppressed) {
    return {
      suppressed: false,
      duration,
      forceCover: false,
      accuracyMultiplier: 1,
      burstSizeMultiplier: 1,
      movementSpeedMultiplier: 1,
    };
  }
  return {
    suppressed: true,
    duration,
    forceCover: !input.boss,
    accuracyMultiplier: input.boss ? 0.62 : input.elite ? 0.25 : 0.18,
    burstSizeMultiplier: input.boss ? 0.78 : 0.4,
    movementSpeedMultiplier: input.boss ? 1.12 : 1.16,
  };
}

export function selectEnemyTactic(input: {
  weaponId: EnemyWeaponId;
  healthRatio: number;
  distance: number;
  visible: boolean;
  reloading: boolean;
  roll: number;
  suppressed?: boolean;
}): EnemyTactic {
  const weapon = ENEMY_WEAPON_CONFIGS[input.weaponId];
  if (input.suppressed || input.reloading || input.healthRatio <= 0.3) return 'cover';
  if (input.weaponId === 'sniper') {
    if (input.distance < weapon.preferredMin) return 'retreat';
    return input.visible && input.distance <= weapon.preferredMax ? 'cover' : 'advance';
  }
  if (input.weaponId === 'shotgun') {
    return input.distance > weapon.preferredMax ? 'flank' : 'cover';
  }
  if (!input.visible || input.distance > weapon.preferredMax) return 'flank';
  return input.roll < 0.58 ? 'flank' : 'cover';
}

export function shouldAlertAlly(input: {
  distance: number;
  alive: boolean;
  state: string;
  radius?: number;
  difficulty?: EnemyDifficultyId;
}): boolean {
  const radius = input.radius
    ?? (input.difficulty ? getEnemyDifficultyBehavior(input.difficulty).coordinationRadius : 30);
  return input.alive
    && input.state !== 'dead'
    && input.state !== 'engage'
    && input.distance <= radius;
}
