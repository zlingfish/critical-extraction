import { describe, expect, it } from 'vitest';
import {
  EXTRACTION_CONDITIONS,
  OPERATION_EVENTS,
  OPERATION_TASKS,
  RISK_DROP_MULTIPLIERS,
  advanceExtractionCondition,
  advanceTaskProgress,
  createOperationScenario,
  createSeededRandom,
  createTaskProgress,
  getDropMultiplier,
  isTaskComplete,
  pickRandomEvent,
  pickRandomExtractionCondition,
  pickRandomTask,
  taskProgressRatio,
  updateTaskClock,
} from './operation-events';

describe('随机行动内容', () => {
  it('提供多种随机事件、任务和撤离条件', () => {
    expect(OPERATION_EVENTS).toHaveLength(7);
    expect(OPERATION_TASKS).toHaveLength(5);
    expect(EXTRACTION_CONDITIONS).toHaveLength(4);
    expect(OPERATION_EVENTS.every((event) => event.durationSeconds > 0 && event.targetText.length > 0)).toBe(true);
    expect(OPERATION_TASKS.every((task) => task.requiredProgress > 0 && task.targetText.length > 0)).toBe(true);
  });

  it('同一个数字或字符串 seed 会得到同样的随机序列', () => {
    const first = Array.from({ length: 8 }, () => createSeededRandom('港区-42')());
    const second = Array.from({ length: 8 }, () => createSeededRandom('港区-42')());
    expect(first).toEqual(second);
    expect(createOperationScenario(12345)).toEqual(createOperationScenario(12345));
    expect(createOperationScenario('12345')).toEqual(createOperationScenario('12345'));
    expect(createOperationScenario(12345)).not.toEqual(createOperationScenario(12346));
  });

  it('抽取结果始终属于定义好的内容', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      expect(OPERATION_EVENTS).toContainEqual(pickRandomEvent(seed));
      expect(OPERATION_TASKS).toContainEqual(pickRandomTask(seed));
      expect(EXTRACTION_CONDITIONS).toContainEqual(pickRandomExtractionCondition(seed));
    }
  });
});

describe('任务进度纯函数', () => {
  const task = OPERATION_TASKS.find((item) => item.type === 'timed-scavenge');
  if (!task) throw new Error('测试任务缺失');

  it('按事件数量推进并限制在目标值', () => {
    const initial = createTaskProgress(task);
    const next = advanceTaskProgress(task, initial, 2);
    expect(next).toEqual({ current: 2, required: 5, elapsedSeconds: 0, completed: false, failed: false });
    const done = advanceTaskProgress(task, next, 99);
    expect(done.current).toBe(5);
    expect(isTaskComplete(done)).toBe(true);
    expect(taskProgressRatio(done)).toBe(1);
    expect(initial).toEqual({ current: 0, required: 5, elapsedSeconds: 0, completed: false, failed: false });
  });

  it('限时任务超时后失败且不能继续完成', () => {
    const initial = createTaskProgress(task);
    const timedOut = updateTaskClock(task, initial, 181);
    expect(timedOut.failed).toBe(true);
    expect(isTaskComplete(advanceTaskProgress(task, timedOut, 5))).toBe(false);
  });

  it('按时完成后不会因为结算时间较晚而变成失败', () => {
    const done = advanceTaskProgress(task, createTaskProgress(task), 5, 170);
    const settled = advanceTaskProgress(task, done, 0, 200);
    expect(settled.completed).toBe(true);
    expect(settled.failed).toBe(false);
    expect(isTaskComplete(settled)).toBe(true);
  });

  it('不允许负数进度和倒退时间', () => {
    const initial = advanceTaskProgress(task, createTaskProgress(task), 2, 20);
    const unchanged = advanceTaskProgress(task, initial, -8, 10);
    expect(unchanged.current).toBe(2);
    expect(unchanged.elapsedSeconds).toBe(20);
    expect(taskProgressRatio(unchanged)).toBe(0.4);
  });
});

describe('撤离条件和风险掉落', () => {
  it('支付、启动、击杀和等待都可以用同一个进度函数完成', () => {
    const pay = EXTRACTION_CONDITIONS.find((item) => item.type === 'pay-credits');
    const wait = EXTRACTION_CONDITIONS.find((item) => item.type === 'wait-helicopter');
    if (!pay || !wait) throw new Error('撤离条件缺失');
    expect(advanceExtractionCondition(pay, 0, 799).completed).toBe(false);
    expect(advanceExtractionCondition(pay, 799, 1).completed).toBe(true);
    expect(advanceExtractionCondition(wait, 0, 100)).toEqual({ current: 45, required: 45, completed: true });
  });

  it('高危区金色和红色掉落倍率更高', () => {
    expect(RISK_DROP_MULTIPLIERS.normal.gold).toBe(1);
    expect(RISK_DROP_MULTIPLIERS.normal.red).toBe(1);
    expect(getDropMultiplier('high-risk', 'gold')).toBeGreaterThan(getDropMultiplier('normal', 'gold'));
    expect(getDropMultiplier('high-risk', 'red')).toBeGreaterThan(getDropMultiplier('high-risk', 'gold'));
  });
});
