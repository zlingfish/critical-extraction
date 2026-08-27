import type { InventoryItem } from './types';

const RARITY_LOAD: Record<InventoryItem['rarity'], number> = {
  black: 0.5,
  white: 0.65,
  green: 0.8,
  blue: 1,
  purple: 1.2,
  gold: 1.45,
  red: 1.8,
};

export function backpackLoadRatio(items: readonly InventoryItem[], capacity: number): number {
  if (capacity <= 0) return items.length > 0 ? 1 : 0;
  const load = items.reduce((sum, item) => {
    const stackedLoad = 1 + Math.min(3, Math.max(0, item.quantity - 1)) * 0.2;
    return sum + RARITY_LOAD[item.rarity] * stackedLoad;
  }, 0);
  return Math.max(0, Math.min(1, load / capacity));
}

export function backpackSpeedMultiplier(items: readonly InventoryItem[], capacity: number): number {
  const load = backpackLoadRatio(items, capacity);
  const highValueCount = items.filter((item) => item.rarity === 'gold' || item.rarity === 'red').length;
  return Math.max(0.68, 1 - load * 0.2 - Math.min(0.08, highValueCount * 0.015));
}

export function rareLootSignalRadius(items: readonly InventoryItem[]): number {
  const gold = items.filter((item) => item.rarity === 'gold').length;
  const red = items.filter((item) => item.rarity === 'red').length;
  if (gold === 0 && red === 0) return 0;
  return Math.min(52, 18 + gold * 4 + red * 9);
}
