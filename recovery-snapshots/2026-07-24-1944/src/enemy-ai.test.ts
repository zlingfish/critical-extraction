import { describe, expect, it } from 'vitest';
import {
  closestPointOnSegment,
  getEnemyDifficultyBehavior,
  getEnemyReactionTime,
  getEnemySuppressionResponse,
  selectEnemyTactic,
  selectEnemyWarningCue,
  shouldAlertAlly,
  shouldPlayBulletWhiz,
  updateEnemyAttackWarning,
  updateEnemyPerception,
} from './enemy-ai';

describe('子弹擦身距离', () => {
  it('计算三维弹道中段离玩家最近的位置', () => {
    const result = closestPointOnSegment(
      { x: 0, y: 1, z: 0 },
      { x: 10, y: 1, z: 0 },
      { x: 4, y: 3, z: 0 },
    );

    expect(result.point).toEqual({ x: 4, y: 1, z: 0 });
    expect(result.distance).toBeCloseTo(2);
    expect(result.t).toBeCloseTo(0.4);
  });

  it('弹道范围之外会限制到起点或终点', () => {
    expect(closestPointOnSegment(
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: -2, y: 0, z: 0 },
    ).point).toEqual({ x: 0, y: 0, z: 0 });
    expect(closestPointOnSegment(
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 7, y: 0, z: 0 },
    ).point).toEqual({ x: 4, y: 0, z: 0 });
  });

  it('零长度弹道也能返回有效距离', () => {
    const result = closestPointOnSegment(
      { x: 1, y: 2, z: 3 },
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 6, z: 3 },
    );
    expect(result.distance).toBe(5);
    expect(result.t).toBe(0);
  });

  it('只为未命中且确实擦身而过的弹道播放声音', () => {
    expect(shouldPlayBulletWhiz(1.2, false)).toBe(true);
    expect(shouldPlayBulletWhiz(0.2, false)).toBe(false);
    expect(shouldPlayBulletWhiz(4, false)).toBe(false);
    expect(shouldPlayBulletWhiz(1.2, true)).toBe(false);
  });
});

describe('敌人战术选择', () => {
  it('受伤或换弹时优先寻找掩体', () => {
    expect(selectEnemyTactic({ weaponId: 'smg', healthRatio: 0.25, distance: 12, visible: true, reloading: false, roll: 0.9 })).toBe('cover');
    expect(selectEnemyTactic({ weaponId: 'shotgun', healthRatio: 1, distance: 12, visible: true, reloading: true, roll: 0.2 })).toBe('cover');
  });

  it('狙击手在玩家靠近时后撤', () => {
    expect(selectEnemyTactic({ weaponId: 'sniper', healthRatio: 1, distance: 10, visible: true, reloading: false, roll: 0.2 })).toBe('retreat');
  });

  it('霰弹枪手会从远处侧绕接近', () => {
    expect(selectEnemyTactic({ weaponId: 'shotgun', healthRatio: 1, distance: 25, visible: true, reloading: false, roll: 0.2 })).toBe('flank');
  });

  it('受到压制时所有武器都优先寻找掩体', () => {
    expect(selectEnemyTactic({ weaponId: 'sniper', healthRatio: 1, distance: 45, visible: true, reloading: false, roll: 0.1, suppressed: true })).toBe('cover');
    expect(selectEnemyTactic({ weaponId: 'shotgun', healthRatio: 1, distance: 6, visible: true, reloading: false, roll: 0.9, suppressed: true })).toBe('cover');
  });
});

describe('附近队友呼叫', () => {
  it('只通知范围内且尚未交战的存活队友', () => {
    expect(shouldAlertAlly({ distance: 18, alive: true, state: 'patrol' })).toBe(true);
    expect(shouldAlertAlly({ distance: 31, alive: true, state: 'patrol' })).toBe(false);
    expect(shouldAlertAlly({ distance: 12, alive: true, state: 'engage' })).toBe(false);
    expect(shouldAlertAlly({ distance: 12, alive: false, state: 'dead' })).toBe(false);
  });

  it('难度越高，能够参与配合的队友范围越大', () => {
    expect(shouldAlertAlly({ distance: 26, alive: true, state: 'patrol', difficulty: 'recruit' })).toBe(false);
    expect(shouldAlertAlly({ distance: 26, alive: true, state: 'patrol', difficulty: 'standard' })).toBe(true);
    expect(shouldAlertAlly({ distance: 36, alive: true, state: 'patrol', difficulty: 'veteran' })).toBe(true);
  });
});

describe('射击前预警', () => {
  it('第一次瞄准玩家时只抬枪或喊话，不能立即开火', () => {
    const result = updateEnemyAttackWarning({
      state: { phase: 'idle', readyAt: 0 },
      now: 10,
      targetVisible: true,
      targetInRange: true,
      difficulty: 'standard',
      reactionRoll: 0.5,
      warningRoll: 0.9,
      nearbyAllies: 0,
    });

    expect(result.state.phase).toBe('warning');
    expect(result.state.readyAt).toBeCloseTo(10.82);
    expect(result.canFire).toBe(false);
    expect(result.cue).toBe('raise_weapon');
  });

  it('预警时间结束后才允许开火', () => {
    const state = { phase: 'warning' as const, readyAt: 5.8 };
    const waiting = updateEnemyAttackWarning({
      state,
      now: 5.4,
      targetVisible: true,
      targetInRange: true,
      difficulty: 'standard',
      reactionRoll: 0.5,
      warningRoll: 0,
      nearbyAllies: 2,
    });
    const ready = updateEnemyAttackWarning({
      state,
      now: 5.8,
      targetVisible: true,
      targetInRange: true,
      difficulty: 'standard',
      reactionRoll: 0.5,
      warningRoll: 0,
      nearbyAllies: 2,
    });

    expect(waiting.canFire).toBe(false);
    expect(ready.canFire).toBe(true);
    expect(ready.state.phase).toBe('ready');
  });

  it('目标消失后会取消射击准备，重新发现时再次预警', () => {
    const result = updateEnemyAttackWarning({
      state: { phase: 'ready', readyAt: 4 },
      now: 6,
      targetVisible: false,
      targetInRange: true,
      difficulty: 'veteran',
      reactionRoll: 0,
      warningRoll: 0,
      nearbyAllies: 3,
    });
    expect(result).toEqual({ state: { phase: 'idle', readyAt: 0 }, canFire: false, cue: null });
  });

  it('附近有队友时更倾向于先喊话', () => {
    expect(selectEnemyWarningCue({ roll: 0.5, nearbyAllies: 2 })).toBe('callout');
    expect(selectEnemyWarningCue({ roll: 0.9, nearbyAllies: 2 })).toBe('raise_weapon');
  });
});

describe('发现玩家过程', () => {
  it('看见异常后需要持续观察，不能一帧确认玩家', () => {
    const firstLook = updateEnemyPerception({
      state: { awareness: 0, lastVisualAt: -100 },
      now: 10,
      delta: 0.1,
      visible: true,
      inCone: true,
      closeRange: false,
      alreadyEngaged: false,
      difficulty: 'standard',
    });

    expect(firstLook.observing).toBe(true);
    expect(firstLook.confirmed).toBe(false);
    expect(firstLook.state.awareness).toBeGreaterThan(0);
    expect(firstLook.state.awareness).toBeLessThan(1);
  });

  it('持续观察足够久后才确认目标', () => {
    let state = { awareness: 0, lastVisualAt: -100 };
    let confirmed = false;
    for (let step = 0; step < 10; step += 1) {
      const result = updateEnemyPerception({
        state,
        now: 20 + step * 0.1,
        delta: 0.1,
        visible: true,
        inCone: true,
        closeRange: false,
        alreadyEngaged: false,
        difficulty: 'standard',
      });
      state = result.state;
      confirmed = result.confirmed;
    }
    expect(confirmed).toBe(true);
  });

  it('失去视线后怀疑会下降，并保留最后看见时间', () => {
    const result = updateEnemyPerception({
      state: { awareness: 0.7, lastVisualAt: 12 },
      now: 14,
      delta: 0.4,
      visible: false,
      inCone: false,
      closeRange: false,
      alreadyEngaged: false,
      difficulty: 'standard',
    });
    expect(result.confirmed).toBe(false);
    expect(result.state.awareness).toBeLessThan(0.7);
    expect(result.state.lastVisualAt).toBe(12);
  });

  it('墙后目标不会因为 Boss 身份而被确认', () => {
    const result = updateEnemyPerception({
      state: { awareness: 1, lastVisualAt: 5 },
      now: 8,
      delta: 0.2,
      visible: false,
      inCone: true,
      closeRange: true,
      alreadyEngaged: true,
      difficulty: 'veteran',
      boss: true,
    });
    expect(result.observing).toBe(false);
    expect(result.confirmed).toBe(false);
    expect(result.state.lastVisualAt).toBe(5);
  });
});

describe('压制反应', () => {
  it('普通敌人受压制后寻找掩体并大幅降低射击精度', () => {
    const response = getEnemySuppressionResponse({ now: 12, lastSuppressedAt: 10.5 });
    expect(response.suppressed).toBe(true);
    expect(response.forceCover).toBe(true);
    expect(response.accuracyMultiplier).toBeLessThanOrEqual(0.2);
    expect(response.burstSizeMultiplier).toBeLessThan(0.5);
    expect(response.movementSpeedMultiplier).toBeGreaterThan(1);
  });

  it('压制结束后恢复正常射击和移动', () => {
    expect(getEnemySuppressionResponse({ now: 14, lastSuppressedAt: 10 })).toMatchObject({
      suppressed: false,
      forceCover: false,
      accuracyMultiplier: 1,
      burstSizeMultiplier: 1,
      movementSpeedMultiplier: 1,
    });
  });

  it('未记录压制时间时不会误判为受压制', () => {
    expect(getEnemySuppressionResponse({ now: 1, lastSuppressedAt: Number.NEGATIVE_INFINITY }).suppressed).toBe(false);
  });

  it('Boss 会短暂受压制，但不会停止推进或完全失去火力', () => {
    const response = getEnemySuppressionResponse({ now: 10.4, lastSuppressedAt: 10, boss: true });
    expect(response.suppressed).toBe(true);
    expect(response.forceCover).toBe(false);
    expect(response.duration).toBeLessThan(1);
    expect(response.accuracyMultiplier).toBeGreaterThan(0.5);
    expect(response.burstSizeMultiplier).toBeGreaterThan(0.7);
  });
});

describe('行为难度', () => {
  it('高难度缩短反应时间并增强队友配合', () => {
    expect(getEnemyReactionTime({ difficulty: 'veteran', roll: 0.5 }))
      .toBeLessThan(getEnemyReactionTime({ difficulty: 'recruit', roll: 0.5 }));
    expect(getEnemyDifficultyBehavior('veteran').coordinationRadius)
      .toBeGreaterThan(getEnemyDifficultyBehavior('recruit').coordinationRadius);
    expect(getEnemyDifficultyBehavior('veteran').coordinationCooldown)
      .toBeLessThan(getEnemyDifficultyBehavior('recruit').coordinationCooldown);
    expect(getEnemyDifficultyBehavior('veteran').maxCoordinatedAllies)
      .toBeGreaterThan(getEnemyDifficultyBehavior('recruit').maxCoordinatedAllies);
  });

  it('难度不会提高敌人生命、伤害或基础准度', () => {
    for (const difficulty of ['recruit', 'standard', 'veteran'] as const) {
      expect(getEnemyDifficultyBehavior(difficulty)).toMatchObject({
        healthMultiplier: 1,
        damageMultiplier: 1,
        accuracyMultiplier: 1,
      });
    }
  });
});
