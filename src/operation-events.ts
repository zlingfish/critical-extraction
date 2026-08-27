/**
 * 局内随机行动规则。
 *
 * 这里刻意只保存数据和纯函数，不依赖 Three.js 或游戏循环，方便测试和接入
 * 不同地图。给定同一个 seed，所有抽取结果都完全一致。
 */

export type Seed = number | string;

export type OperationEventType =
  | 'power-outage'
  | 'airdrop'
  | 'alarm'
  | 'boss-patrol'
  | 'extraction-closure'
  | 'enemy-convoy'
  | 'gas-leak';

export interface OperationEvent {
  readonly type: OperationEventType;
  readonly title: string;
  readonly description: string;
  readonly targetText: string;
  readonly durationSeconds: number;
}

export const OPERATION_EVENTS: readonly OperationEvent[] = [
  {
    type: 'power-outage',
    title: '区域停电',
    description: '港区电网被切断，室内照明和部分门禁暂时失效。',
    targetText: '前往配电站恢复电源',
    durationSeconds: 120,
  },
  {
    type: 'airdrop',
    title: '补给空投',
    description: '一架运输机正在投放补给箱，落点会吸引附近敌人。',
    targetText: '找到空投箱并在敌人前取出物资',
    durationSeconds: 150,
  },
  {
    type: 'alarm',
    title: '全区警报',
    description: '警报系统被触发，敌方巡逻频率和警戒范围暂时提高。',
    targetText: '保持隐蔽并撑过警报倒计时',
    durationSeconds: 60,
  },
  {
    type: 'boss-patrol',
    title: '重装队长巡逻',
    description: '一名重装队长带队进入港区，击败他可获得高价值战利品。',
    targetText: '追踪并击败重装队长',
    durationSeconds: 210,
  },
  {
    type: 'extraction-closure',
    title: '撤离点临时关闭',
    description: '撤离信标遭到干扰，当前撤离点暂时无法使用。',
    targetText: '等待恢复或寻找另一处撤离点',
    durationSeconds: 90,
  },
  {
    type: 'enemy-convoy',
    title: '敌方车队抵达',
    description: '一支增援车队抵达外围，武装人员正在向核心区域推进。',
    targetText: '避开车队或伏击增援人员',
    durationSeconds: 135,
  },
  {
    type: 'gas-leak',
    title: '毒气泄漏',
    description: '核心区域发生化学品泄漏，停留其中会持续受到伤害。',
    targetText: '离开高危区，等待毒气消散',
    durationSeconds: 75,
  },
] as const;

export type OperationTaskType =
  | 'rescue'
  | 'plant-bomb'
  | 'escort'
  | 'timed-scavenge'
  | 'hunt-target';

export interface OperationTask {
  readonly type: OperationTaskType;
  readonly title: string;
  readonly description: string;
  readonly targetText: string;
  readonly requiredProgress: number;
  readonly timeLimitSeconds?: number;
  readonly rewardCredits: number;
}

export const OPERATION_TASKS: readonly OperationTask[] = [
  {
    type: 'rescue',
    title: '救出失联人员',
    description: '找到被困的港区工作人员，把他带到安全集合点。',
    targetText: '救出 1 名人员并带到集合点',
    requiredProgress: 1,
    rewardCredits: 1800,
  },
  {
    type: 'plant-bomb',
    title: '安装爆破装置',
    description: '在指定的燃料管线上安装并启动爆破装置。',
    targetText: '安装并启动 1 个爆破装置',
    requiredProgress: 1,
    rewardCredits: 2200,
  },
  {
    type: 'escort',
    title: '护送关键物品',
    description: '将密封货箱安全送到指定装卸点，货箱损坏会导致任务失败。',
    targetText: '将货箱护送到装卸点',
    requiredProgress: 1,
    rewardCredits: 2400,
  },
  {
    type: 'timed-scavenge',
    title: '限时搜集',
    description: '在封锁前搜集指定的零件，越快完成奖励越高。',
    targetText: '在 180 秒内搜集 5 件指定物资',
    requiredProgress: 5,
    timeLimitSeconds: 180,
    rewardCredits: 2000,
  },
  {
    type: 'hunt-target',
    title: '猎杀指定目标',
    description: '消灭携带情报的敌方军官，确认目标身份后再撤离。',
    targetText: '击杀指定敌人 1 名',
    requiredProgress: 1,
    rewardCredits: 2600,
  },
] as const;

export interface TaskProgress {
  readonly current: number;
  readonly required: number;
  readonly elapsedSeconds: number;
  readonly completed: boolean;
  readonly failed: boolean;
}

export function createTaskProgress(task: OperationTask, elapsedSeconds = 0): TaskProgress {
  const elapsed = Math.max(0, elapsedSeconds);
  const failed = task.timeLimitSeconds !== undefined && elapsed > task.timeLimitSeconds;
  return {
    current: 0,
    required: task.requiredProgress,
    elapsedSeconds: elapsed,
    completed: false,
    failed,
  };
}

/** 以事件发生的数量推进任务；不会超过目标，也不会修改传入对象。 */
export function advanceTaskProgress(
  task: OperationTask,
  progress: TaskProgress,
  amount = 1,
  elapsedSeconds = progress.elapsedSeconds,
): TaskProgress {
  const elapsed = Math.max(progress.elapsedSeconds, elapsedSeconds);
  const timedOut = task.timeLimitSeconds !== undefined && elapsed > task.timeLimitSeconds;
  if (progress.failed || progress.completed || timedOut) {
    return { ...progress, elapsedSeconds: elapsed, failed: progress.failed || (!progress.completed && timedOut) };
  }
  const current = Math.min(task.requiredProgress, Math.max(0, progress.current + Math.max(0, amount)));
  return {
    current,
    required: task.requiredProgress,
    elapsedSeconds: elapsed,
    completed: current >= task.requiredProgress,
    failed: false,
  };
}

/** 只推进时间，用于限时任务的倒计时。 */
export function updateTaskClock(task: OperationTask, progress: TaskProgress, elapsedSeconds: number): TaskProgress {
  const elapsed = Math.max(progress.elapsedSeconds, elapsedSeconds);
  const timedOut = task.timeLimitSeconds !== undefined && elapsed > task.timeLimitSeconds;
  return { ...progress, elapsedSeconds: elapsed, failed: progress.failed || (!progress.completed && timedOut) };
}

export function isTaskComplete(progress: TaskProgress): boolean {
  return progress.completed && !progress.failed;
}

export function taskProgressRatio(progress: TaskProgress): number {
  if (progress.required <= 0) return 1;
  return Math.min(1, Math.max(0, progress.current / progress.required));
}

export type ExtractionConditionType =
  | 'pay-credits'
  | 'restore-power'
  | 'defeat-guard'
  | 'wait-helicopter';

export interface ExtractionCondition {
  readonly type: ExtractionConditionType;
  readonly title: string;
  readonly description: string;
  readonly targetText: string;
  readonly requiredProgress: number;
  readonly waitSeconds?: number;
}

export const EXTRACTION_CONDITIONS: readonly ExtractionCondition[] = [
  {
    type: 'pay-credits',
    title: '支付通行费',
    description: '向撤离点守卫支付通用货币，立即开放撤离通道。',
    targetText: '支付 800 通用货币',
    requiredProgress: 800,
  },
  {
    type: 'restore-power',
    title: '开启电源',
    description: '重新启动撤离区的备用发电机，恢复信标。',
    targetText: '启动备用发电机',
    requiredProgress: 1,
  },
  {
    type: 'defeat-guard',
    title: '击败守卫',
    description: '清除守住撤离通道的敌方小队后才能呼叫撤离。',
    targetText: '击败撤离点守卫小队',
    requiredProgress: 1,
  },
  {
    type: 'wait-helicopter',
    title: '等待直升机',
    description: '保持在信标范围内，等待直升机抵达。受到攻击会中断等待。',
    targetText: '在撤离区等待 45 秒',
    requiredProgress: 45,
    waitSeconds: 45,
  },
] as const;

export interface ExtractionConditionProgress {
  readonly current: number;
  readonly required: number;
  readonly completed: boolean;
}

export function advanceExtractionCondition(
  condition: ExtractionCondition,
  currentProgress: number,
  amount = 1,
): ExtractionConditionProgress {
  const current = Math.min(condition.requiredProgress, Math.max(0, currentProgress + Math.max(0, amount)));
  return { current, required: condition.requiredProgress, completed: current >= condition.requiredProgress };
}

export type RiskLevel = 'normal' | 'high-risk';
export type DropRarity = 'gold' | 'red';

export const RISK_DROP_MULTIPLIERS: Readonly<Record<RiskLevel, Readonly<Record<DropRarity, number>>>> = {
  normal: { gold: 1, red: 1 },
  'high-risk': { gold: 2.5, red: 4 },
};

export function getDropMultiplier(risk: RiskLevel, rarity: DropRarity): number {
  return RISK_DROP_MULTIPLIERS[risk][rarity];
}

export function rollRiskLevel(random: () => number): RiskLevel {
  return random() < 0.35 ? 'high-risk' : 'normal';
}

/** 将字符串 seed 稳定地转为 32 位整数。 */
function hashSeed(seed: Seed): number {
  if (typeof seed === 'number') return Number.isFinite(seed) ? seed >>> 0 : 0;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 可复现的伪随机数生成器，返回 [0, 1) 内的数字。 */
export function createSeededRandom(seed: Seed): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(values: readonly T[], random: () => number): T {
  return values[Math.min(values.length - 1, Math.floor(random() * values.length))];
}

export function pickRandomEvent(seed: Seed): OperationEvent {
  return pick(OPERATION_EVENTS, createSeededRandom(seed));
}

export function pickRandomTask(seed: Seed): OperationTask {
  return pick(OPERATION_TASKS, createSeededRandom(seed));
}

export function pickRandomExtractionCondition(seed: Seed): ExtractionCondition {
  return pick(EXTRACTION_CONDITIONS, createSeededRandom(seed));
}

export interface OperationScenario {
  readonly event: OperationEvent;
  readonly task: OperationTask;
  readonly extractionCondition: ExtractionCondition;
  readonly risk: RiskLevel;
}

/** 为一局行动一次性抽取事件、任务、撤离条件和风险等级。 */
export function createOperationScenario(seed: Seed): OperationScenario {
  const random = createSeededRandom(seed);
  return {
    event: pick(OPERATION_EVENTS, random),
    task: pick(OPERATION_TASKS, random),
    extractionCondition: pick(EXTRACTION_CONDITIONS, random),
    risk: rollRiskLevel(random),
  };
}

// 这些别名让接入层可以使用更直观的命名。
export const RANDOM_EVENTS = OPERATION_EVENTS;
export const RANDOM_TASKS = OPERATION_TASKS;
export const RANDOM_EXTRACTION_CONDITIONS = EXTRACTION_CONDITIONS;
export const sampleOperationEvent = pickRandomEvent;
export const sampleOperationTask = pickRandomTask;
export const sampleExtractionCondition = pickRandomExtractionCondition;
export const generateOperationScenario = createOperationScenario;
