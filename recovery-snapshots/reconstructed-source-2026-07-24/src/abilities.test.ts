import { describe, expect, it } from 'vitest';
import {
  ADRENALINE_HEALING_PER_SECOND,
  abilitySecondsRemaining,
  applyAdrenalineHealing,
  isAbilityReady,
  lineSegmentIntersectsSphere,
} from './abilities';

describe('烟幕视线遮挡', () => {
  it('视线穿过烟幕时会被遮挡', () => {
    expect(lineSegmentIntersectsSphere(
      { x: 0, y: 1.6, z: 0 },
      { x: 12, y: 1.6, z: 0 },
      { x: 6, y: 1.4, z: 0 },
      4.8,
    )).toBe(true);
  });

  it('视线从烟幕外经过时不会被遮挡', () => {
    expect(lineSegmentIntersectsSphere(
      { x: 0, y: 1.6, z: 0 },
      { x: 12, y: 1.6, z: 0 },
      { x: 6, y: 1.4, z: 7 },
      4.8,
    )).toBe(false);
  });
});

describe('肾上腺素规则', () => {
  it('冷却结束后才可再次使用', () => {
    expect(isAbilityReady(20, 21)).toBe(false);
    expect(isAbilityReady(21, 21)).toBe(true);
    expect(abilitySecondsRemaining(20, 31.5)).toBe(11.5);
  });

  it('持续回血且不会超过生命上限', () => {
    const first = applyAdrenalineHealing(70, 20, 2);
    expect(first.health).toBe(70 + ADRENALINE_HEALING_PER_SECOND * 2);
    expect(first.healingRemaining).toBe(15);
    expect(applyAdrenalineHealing(99, 20, 2)).toEqual({ health: 100, healingRemaining: 19 });
  });

  it('满生命时保留尚未使用的治疗量', () => {
    expect(applyAdrenalineHealing(100, 20, 1)).toEqual({ health: 100, healingRemaining: 20 });
  });
});
