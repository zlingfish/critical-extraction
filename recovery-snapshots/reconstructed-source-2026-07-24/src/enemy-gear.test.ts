import { describe, expect, it } from 'vitest';
import { addInventoryItem, createDefaultProfile, createRunState, settleExtraction } from './domain';
import { createRecoveredArmorLoot, createRecoveredEnemyEquipment } from './enemy-gear';

describe('recovered enemy armor', () => {
  it('drops every armor class with condition-based rarity and value', () => {
    const regular = createRecoveredArmorLoot('regular-armor', 'regular', 48, 48);
    const elite = createRecoveredArmorLoot('elite-armor', 'elite', 38, 82);
    const boss = createRecoveredArmorLoot('boss-armor', 'boss', 0, 190);

    expect(regular).toMatchObject({ kind: 'armor', rarity: 'blue', value: 1900, durability: 48, maxDurability: 48 });
    expect(elite).toMatchObject({ kind: 'armor', rarity: 'blue', value: 3400, durability: 38, maxDurability: 82 });
    expect(boss).toMatchObject({ kind: 'armor', rarity: 'black', value: 1600, durability: 0, maxDurability: 190 });
  });

  it.each([
    ['regular', 'smg', 'V9 冲锋枪', ['green', 'blue', 'green']],
    ['elite', 'shotgun', 'SG-12 战术霰弹枪', ['purple', 'purple', 'purple']],
    ['boss', 'sniper', 'M24 精确步枪', ['red', 'red', 'gold']],
  ] as const)('creates helmet, armor and weapon for a %s enemy', (armorClass, weaponId, weaponName, rarities) => {
    const equipment = createRecoveredEnemyEquipment(`${armorClass}-enemy`, armorClass, weaponId, 100, 100);

    expect(equipment.map((item) => item.equipmentSlot)).toEqual(['helmet', 'armor', 'weapon']);
    expect(equipment.map((item) => item.kind)).toEqual(['helmet', 'armor', 'weapon']);
    expect(equipment.map((item) => item.rarity)).toEqual(rarities);
    expect(new Set(equipment.map((item) => item.id)).size).toBe(3);
    expect(equipment[2]).toMatchObject({ variant: weaponId });
    expect(equipment[2].name).toContain(weaponName);
  });

  it('makes elite and boss equipment more valuable than regular equipment', () => {
    const total = (armorClass: 'regular' | 'elite' | 'boss') => createRecoveredEnemyEquipment(
      armorClass,
      armorClass,
      'smg',
      100,
      100,
    ).reduce((sum, item) => sum + item.value, 0);

    expect(total('elite')).toBeGreaterThan(total('regular'));
    expect(total('boss')).toBeGreaterThan(total('elite'));
  });

  it('uses three backpack slots and moves all equipment into the stash after extraction', () => {
    const equipment = createRecoveredEnemyEquipment('extracted-elite', 'elite', 'shotgun', 82, 82);
    const run = createRunState();
    for (const item of equipment) {
      const pickedUp = addInventoryItem(run.backpack, item, 12);
      expect(pickedUp.added).toBe(true);
      run.backpack = pickedUp.items;
    }
    expect(run.backpack).toHaveLength(3);
    run.phase = 'success';

    const settlement = settleExtraction(createDefaultProfile(), run);
    expect(settlement.profile.stash).toEqual(equipment);
    expect(settlement.profile.stash.map((item) => item.equipmentSlot)).toEqual(['helmet', 'armor', 'weapon']);
  });
});
