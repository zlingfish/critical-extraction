import { describe, expect, it } from 'vitest';
import { CONTAINER_KIND_AFFINITY, LOOT_CATALOG, LOOT_CATALOG_SIZE, LOOT_POOLS, lootPoolForContainer } from './loot';

describe('loot catalog', () => {
  it('contains more than one thousand unique published variants', () => {
    expect(LOOT_CATALOG_SIZE).toBeGreaterThan(1000);
    expect(new Set(LOOT_CATALOG.map((item) => item.id)).size).toBe(LOOT_CATALOG_SIZE);
    expect(new Set(LOOT_CATALOG.map((item) => item.name)).size).toBe(LOOT_CATALOG_SIZE);
  });

  it('keeps every rarity pool available for container rolls', () => {
    for (const rarity of ['black', 'white', 'green', 'blue', 'purple', 'gold', 'red'] as const) {
      expect(LOOT_POOLS[rarity].length).toBeGreaterThan(0);
    }
  });

  it('gives specialist containers clearly different item categories', () => {
    expect(new Set(lootPoolForContainer('medical', 'gold').map((item) => item.kind))).toEqual(new Set(['medical']));
    expect(new Set(lootPoolForContainer('computer', 'purple').map((item) => item.kind)))
      .toEqual(new Set(['electronics', 'intel']));
    expect(CONTAINER_KIND_AFFINITY.weapon).not.toContain('medical');
  });
});
