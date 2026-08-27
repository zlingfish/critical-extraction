export interface ThreatEscalation {
  level: 0 | 1 | 2 | 3;
  label: string;
  progress: number;
  perceptionMultiplier: number;
  tacticRefreshMultiplier: number;
  coordinationMultiplier: number;
  accuracyMultiplier: number;
  fireDelayMultiplier: number;
  damageMultiplier: number;
  movementMultiplier: number;
}

const THREAT_LEVELS = [
  { at: 0, label: '威胁稳定' },
  { at: 120, label: '敌方警戒' },
  { at: 240, label: '增援活跃' },
  { at: 360, label: '全面封锁' },
] as const;

/**
 * 根据本局经过时间给出小幅、连续的压力修正。
 * 它只影响行为节奏，不改变开局选择的难度和敌人基础生命值。
 */
export function getThreatEscalation(elapsedSeconds: number): ThreatEscalation {
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const progress = Math.min(1, elapsed / 420);
  let level: ThreatEscalation['level'] = 0;
  for (let index = THREAT_LEVELS.length - 1; index >= 0; index -= 1) {
    if (elapsed >= THREAT_LEVELS[index].at) {
      level = index as ThreatEscalation['level'];
      break;
    }
  }
  return {
    level,
    label: THREAT_LEVELS[level].label,
    progress,
    perceptionMultiplier: 1 + progress * 0.28,
    tacticRefreshMultiplier: 1 - progress * 0.18,
    coordinationMultiplier: 1 + progress * 0.22,
    accuracyMultiplier: 1 + progress * 0.12,
    fireDelayMultiplier: 1 - progress * 0.16,
    damageMultiplier: 1 + progress * 0.12,
    movementMultiplier: 1 + progress * 0.1,
  };
}

