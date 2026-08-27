import { describe, expect, it } from 'vitest';
import { backpackLoadRatio, backpackSpeedMultiplier, rareLootSignalRadius } from './loot-risk';
import type { InventoryItem } from './types';

const item = (id: string, rarity: InventoryItem['rarity'], quantity = 1): InventoryItem => ({
  id,
  name: id,
  kind: 'supplies',
  rarity,
  value: 100,
  quantity,
});

describe('战利品风险', () => {
  it('背包越满，移动速度越慢但不会低于下限', () => {
    const light = [item('a', 'white')];
    const heavy = Array.from({ length: 12 }, (_, index) => item(`heavy-${index}`, 'purple', 2));
    expect(backpackLoadRatio(heavy, 12)).toBeGreaterThan(backpackLoadRatio(light, 12));
    expect(backpackSpeedMultiplier(heavy, 12)).toBeLessThan(backpackSpeedMultiplier(light, 12));
    expect(backpackSpeedMultiplier(heavy, 1)).toBeGreaterThanOrEqual(0.68);
  });

  it('只有金色和红色物资会产生敌人追踪信号', () => {
    expect(rareLootSignalRadius([item('ordinary', 'purple')])).toBe(0);
    expect(rareLootSignalRadius([item('gold', 'gold')])).toBeGreaterThan(0);
    expect(rareLootSignalRadius([item('red', 'red')])).toBeGreaterThan(rareLootSignalRadius([item('gold', 'gold')]));
  });
});
