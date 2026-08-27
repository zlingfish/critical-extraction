import { describe, expect, it } from 'vitest';
import {
  addInventoryItem,
  applyDamage,
  canExtract,
  completeReload,
  createDefaultProfile,
  createRunState,
  parseProfile,
  sellAll,
  settleExtraction,
} from './domain';

const commonItem = {
  id: 'wire',
  name: '工业铜线',
  kind: 'supplies' as const,
  rarity: 'white' as const,
  value: 280,
  quantity: 1,
};

describe('combat domain', () => {
  it('absorbs 65 percent of damage with armor', () => {
    expect(applyDamage(100, 50, 20)).toEqual({ health: 93, armor: 37 });
  });

  it('allows remaining damage through depleted armor', () => {
    expect(applyDamage(100, 5, 20)).toEqual({ health: 85, armor: 0 });
  });

  it('moves reserve ammunition into a partial magazine', () => {
    expect(completeReload({ magazine: 8, reserve: 12, reloading: true, reloadEndsAt: 8 })).toEqual({
      magazine: 20,
      reserve: 0,
      reloading: false,
      reloadEndsAt: 0,
    });
  });
});

describe('inventory domain', () => {
  it('stacks duplicate items without consuming a slot', () => {
    const result = addInventoryItem([commonItem], { ...commonItem, quantity: 2 });
    expect(result.items[0].quantity).toBe(3);
  });

  it('refuses a thirteenth unique backpack item', () => {
    const full = Array.from({ length: 12 }, (_, index) => ({
      ...commonItem,
      id: `item-${index}`,
    }));
    expect(addInventoryItem(full, { ...commonItem, id: 'thirteenth' }).added).toBe(false);
  });

  it('sells every stashed item', () => {
    const profile = { ...createDefaultProfile(), stash: [commonItem] };
    const sold = sellAll(profile);
    expect(sold.credits).toBe(1480);
    expect(sold.stash).toEqual([]);
  });
});

describe('run settlement', () => {
  it('requires the objective before extraction', () => {
    const run = createRunState();
    expect(canExtract(run)).toBe(false);
    run.hasObjective = true;
    expect(canExtract(run)).toBe(true);
  });

  it('moves run loot into the persistent stash', () => {
    const run = createRunState();
    run.backpack = [commonItem];
    run.elapsedSeconds = 310;
    run.kills = 3;
    const settled = settleExtraction(createDefaultProfile(), run);
    expect(settled.profile.stash).toHaveLength(1);
    expect(settled.profile.totalExtractions).toBe(1);
    expect(settled.result.value).toBe(280);
  });

  it('recovers from corrupt storage', () => {
    expect(parseProfile('{oops')).toEqual(createDefaultProfile());
    expect(parseProfile(JSON.stringify({ version: 0 }))).toEqual(createDefaultProfile());
  });
});
