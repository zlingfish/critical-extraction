import { describe, expect, it } from 'vitest';
import {
  aimSwayMultiplier,
  applyBodyInjury,
  createHealthyInjuries,
  durabilityAdjustedValue,
  moveItemFromSecureContainer,
  moveItemToSecureContainer,
  movementMultiplier,
  penetrationChance,
  resolveBallisticHit,
  revealUnknownItem,
  treatInjuries,
} from './survival-systems';

const loot = { id: 'chip', name: '芯片', kind: 'electronics' as const, rarity: 'gold' as const, value: 5000, quantity: 1 };

describe('弹药与护甲等级', () => {
  it('高级弹击穿重甲的概率明显高于普通弹', () => {
    expect(penetrationChance(5, 5)).toBeGreaterThan(penetrationChance(1, 5));
    expect(resolveBallisticHit(40, 100, 1, 5, 0.5).healthDamage)
      .toBeLessThan(resolveBallisticHit(40, 100, 5, 5, 0.5).healthDamage);
  });

  it('无护甲时伤害全部作用于生命', () => {
    expect(resolveBallisticHit(30, 0, 1, 0, 0.9)).toMatchObject({ healthDamage: 30, armorDamage: 0, penetrated: true });
  });

  it('支持完整的 0 到 6 级弹药范围', () => {
    expect(penetrationChance(0, 6)).toBeGreaterThanOrEqual(0.08);
    expect(penetrationChance(6, 6)).toBeGreaterThan(penetrationChance(0, 6));
    expect(resolveBallisticHit(40, 100, 6, 6, 0.2).healthDamage)
      .toBeGreaterThan(resolveBallisticHit(40, 100, 0, 6, 0.2).healthDamage);
  });
});

describe('身体部位受伤', () => {
  it('腿伤减速，手臂伤增加瞄准晃动，夹板可治疗一个最严重部位', () => {
    let injuries = createHealthyInjuries();
    injuries = applyBodyInjury(injuries, 'leftLeg', 35, 0);
    injuries = applyBodyInjury(injuries, 'rightArm', 35, 0);
    expect(movementMultiplier(injuries)).toBeLessThan(1);
    expect(aimSwayMultiplier(injuries)).toBeGreaterThan(1);
    expect(treatInjuries(injuries, 'splint').leftLeg).toBe(1);
    expect(treatInjuries(injuries, 'surgery')).toEqual(createHealthyInjuries());
  });
});

describe('安全箱、鉴定和耐久', () => {
  it('安全箱保留普通贵重物品但拒绝整件武器', () => {
    const moved = moveItemToSecureContainer([loot], [], loot.id, 2);
    expect(moved.moved).toBe(true);
    expect(moved.backpack).toEqual([]);
    expect(moveItemFromSecureContainer([], moved.secureContainer, loot.id, 12).backpack).toEqual([loot]);
    const weapon = { ...loot, id: 'gun', kind: 'weapon' as const };
    expect(moveItemToSecureContainer([weapon], [], weapon.id, 2).moved).toBe(false);
  });

  it('破损装备售价降低，未知包装撤离后显示真实内容', () => {
    expect(durabilityAdjustedValue({ ...loot, durability: 0, maxDurability: 100 })).toBe(1400);
    expect(revealUnknownItem({ ...loot, name: '未知密封包装', value: 0, identified: false, trueName: '绝密芯片', trueValue: 9000 }))
      .toMatchObject({ name: '绝密芯片', value: 9000, identified: true });
  });
});
