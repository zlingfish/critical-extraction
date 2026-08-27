import { describe, expect, it } from 'vitest';
import { advanceShortcutGate, createShortcutGate, unlockShortcutGate } from './world-shortcuts';

describe('地图捷径闸门', () => {
  it('没有权限时保持关闭且保留碰撞', () => {
    const locked = createShortcutGate();
    expect(unlockShortcutGate(locked, false)).toEqual(locked);
    expect(advanceShortcutGate(locked, 10)).toEqual(locked);
  });

  it('解锁后逐步开门，并在门缝足够大时关闭碰撞', () => {
    const unlocked = unlockShortcutGate(createShortcutGate(), true);
    const opening = advanceShortcutGate(unlocked, 0.4, 1);
    const passable = advanceShortcutGate(opening, 0.2, 1);
    expect(opening).toEqual({ unlocked: true, openProgress: 0.4, colliderEnabled: true });
    expect(passable.openProgress).toBeCloseTo(0.6);
    expect(passable.colliderEnabled).toBe(false);
  });

  it('负时间不会让闸门倒退，进度不会超过一', () => {
    const unlocked = unlockShortcutGate(createShortcutGate(), true);
    expect(advanceShortcutGate(unlocked, -1).openProgress).toBe(0);
    expect(advanceShortcutGate(unlocked, 20).openProgress).toBe(1);
  });
});
