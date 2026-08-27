import { describe, expect, it } from 'vitest';
import { addInventoryItem, createDefaultProfile, createRunState, settleExtraction } from './domain';
import { createRecoveredArmorLoot } from './enemy-gear';

describe('recovered enemy armor', () => {
  it('drops every armor class with condition-based rarity and value', () => {
    const regular = createRecoveredArmorLoot('regular-armor', 'regular', 48, 48);
    const elite = createRecoveredArmorLoot('elite-armor', 'elite', 38, 82);
    const boss = createRecoveredArmorLoot('boss-armor', 'boss', 0, 190);

    expect(regular).toMatchObject({ kind: 'armor', rarity: 'blue', value: 1900, durability: 48, maxDurability: 48 });
    expect(elite).toMatchObject({ kind: 'armor', rarity: 'blue', value: 3400, durability: 38, maxDurability: 82 });
    expect(boss).toMatchObject({ kind: 'armor', rarity: 'black', value: 1600, durability: 0, maxDurability: 190 });
  });

  it('uses one backpack slot and enters the stash after extraction', () => {
    const armor = createRecoveredArmorLoot('extracted-armor', 'elite', 82, 82);
    const run = createRunState();
    const pickedUp = addInventoryItem(run.backpack, armor, 12);
    expect(pickedUp.added).toBe(true);
    run.backpack = pickedUp.items;
    run.phase = 'success';

    const settlement = settleExtraction(createDefaultProfile(), run);
    expect(settlement.profile.stash).toContainEqual(armor);
    expect(settlement.profile.stash[0].kind).toBe('armor');
  });
});
