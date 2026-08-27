import type { EnemyDifficultyId, EnemyTactic, EnemyWeaponId } from './enemy-ai';

export type BossCombatPhase = 'command' | 'pressure' | 'desperate';

export interface BossCombatTuning {
  phase: BossCombatPhase;
  speedMultiplier: number;
  shotDelayMultiplier: number;
  burstPauseMultiplier: number;
  burstMultiplier: number;
  supportCooldown: number;
  holdDistance: number;
  tacticRefreshMultiplier: number;
  recoveryDelay: number;
  recoveryCeiling: number;
  recoveryRate: number;
}

const PHASE_TUNING: Record<BossCombatPhase, Omit<BossCombatTuning, 'phase'>> = {
  command: {
    speedMultiplier: 1.08,
    shotDelayMultiplier: 0.78,
    burstPauseMultiplier: 0.72,
    burstMultiplier: 1,
    supportCooldown: 30,
    holdDistance: 18,
    tacticRefreshMultiplier: 0.9,
    recoveryDelay: 8,
    recoveryCeiling: 0.7,
    recoveryRate: 0.018,
  },
  pressure: {
    speedMultiplier: 1.24,
    shotDelayMultiplier: 0.62,
    burstPauseMultiplier: 0.54,
    burstMultiplier: 1.25,
    supportCooldown: 21,
    holdDistance: 12,
    tacticRefreshMultiplier: 0.7,
    recoveryDelay: 10,
    recoveryCeiling: 0.59,
    recoveryRate: 0.01,
  },
  desperate: {
    speedMultiplier: 1.4,
    shotDelayMultiplier: 0.5,
    burstPauseMultiplier: 0.4,
    burstMultiplier: 1.5,
    supportCooldown: 14,
    holdDistance: 7,
    tacticRefreshMultiplier: 0.5,
    recoveryDelay: Number.POSITIVE_INFINITY,
    recoveryCeiling: 0.25,
    recoveryRate: 0,
  },
};

export function getBossCombatPhase(health: number, maxHealth: number): BossCombatPhase {
  const ratio = maxHealth > 0 ? Math.max(0, health) / maxHealth : 0;
  if (ratio > 0.6) return 'command';
  if (ratio > 0.25) return 'pressure';
  return 'desperate';
}

export function getBossCombatTuning(
  health: number,
  maxHealth: number,
  difficulty: EnemyDifficultyId,
): BossCombatTuning {
  const phase = getBossCombatPhase(health, maxHealth);
  const base = PHASE_TUNING[phase];
  if (difficulty === 'standard') return { phase, ...base };

  if (difficulty === 'recruit') {
    return {
      phase,
      ...base,
      speedMultiplier: 1 + (base.speedMultiplier - 1) * 0.55,
      shotDelayMultiplier: 1 - (1 - base.shotDelayMultiplier) * 0.55,
      burstPauseMultiplier: 1 - (1 - base.burstPauseMultiplier) * 0.55,
      burstMultiplier: 1 + (base.burstMultiplier - 1) * 0.45,
      supportCooldown: base.supportCooldown * 1.35,
      holdDistance: base.holdDistance + 3,
      tacticRefreshMultiplier: base.tacticRefreshMultiplier * 1.2,
    };
  }

  return {
    phase,
    ...base,
    speedMultiplier: base.speedMultiplier * 1.08,
    shotDelayMultiplier: base.shotDelayMultiplier * 0.88,
    burstPauseMultiplier: base.burstPauseMultiplier * 0.86,
    burstMultiplier: base.burstMultiplier * 1.12,
    supportCooldown: base.supportCooldown * 0.75,
    holdDistance: Math.max(5, base.holdDistance - 2),
    tacticRefreshMultiplier: base.tacticRefreshMultiplier * 0.82,
  };
}

export function selectBossTactic(input: {
  phase: BossCombatPhase;
  weaponId: EnemyWeaponId;
  distance: number;
  holdDistance: number;
  visible: boolean;
  reloading: boolean;
  suppressed: boolean;
  roll: number;
}): EnemyTactic {
  const roll = Math.max(0, Math.min(1, input.roll));
  if (input.reloading) return input.phase === 'desperate' ? 'flank' : 'cover';

  if (input.phase === 'command') {
    if (input.suppressed) return 'cover';
    if (!input.visible || input.distance > input.holdDistance * 1.45) return 'flank';
    return roll < 0.58 ? 'cover' : 'flank';
  }

  if (input.phase === 'pressure') {
    if (input.suppressed && roll < 0.22) return 'cover';
    if (!input.visible) return 'flank';
    return input.distance > input.holdDistance
      ? (roll < 0.68 ? 'advance' : 'flank')
      : 'flank';
  }

  if (!input.visible) return 'flank';
  if (input.distance > input.holdDistance) return roll < 0.78 ? 'advance' : 'flank';
  return input.weaponId === 'shotgun' && input.distance < 4 ? 'cover' : 'flank';
}
