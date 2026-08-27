import { describe, expect, it } from 'vitest';
import { areEnemyFactionsHostile, resolveFactionDamage, selectFactionTarget } from './faction-combat';
import type { FactionCombatant } from './faction-combat';

describe('动态势力交战', () => {
  const source: FactionCombatant = { id: 1, faction: 'security', alive: true, x: 0, z: 0 };

  it('同一势力互不攻击，优先选择范围内最近的敌对目标', () => {
    const target = selectFactionTarget<FactionCombatant>(source, [
      source,
      { id: 2, faction: 'security', alive: true, x: 2, z: 0 },
      { id: 3, faction: 'raider', alive: true, x: 8, z: 0 },
      { id: 4, faction: 'raider', alive: true, x: 4, z: 0 },
    ], 12);
    expect(target?.id).toBe(4);
    expect(areEnemyFactionsHostile('security', 'security')).toBe(false);
    expect(areEnemyFactionsHostile('security', 'raider')).toBe(true);
  });

  it('忽略死亡和射程外目标', () => {
    expect(selectFactionTarget<FactionCombatant>(source, [
      { id: 2, faction: 'raider', alive: false, x: 2, z: 0 },
      { id: 3, faction: 'raider', alive: true, x: 30, z: 0 },
    ], 20)).toBeNull();
  });

  it('护甲先吸收部分伤害，耗尽后会正确击杀', () => {
    expect(resolveFactionDamage(100, 20, 30)).toEqual({
      health: 83.5,
      armor: 6.5,
      healthDamage: 16.5,
      armorDamage: 13.5,
      killed: false,
    });
    expect(resolveFactionDamage(10, 0, 30).killed).toBe(true);
  });
});
