import { describe, expect, it } from 'vitest';
import { createDefaultProfile, parseProfile } from './domain';
import { FACILITIES, GEAR_CATALOG, facilityUpgradeCost, gearPrice, resolveLoadout } from './gear';

describe('permanent gear loadout', () => {
  it('resolves the starter equipment bonuses', () => {
    expect(resolveLoadout(createDefaultProfile())).toMatchObject({
      armor: 7,
      ammo: 0,
      medkits: 0,
      backpackSlots: 12,
      weapon: 'rifle',
    });
  });

  it('combines equipped gear with facility bonuses', () => {
    const profile = createDefaultProfile();
    profile.equippedGear.backpack = 'trail-pack';
    profile.equippedGear.medical = 'field-medical';
    profile.equippedGear.weapon = 'weapon-smg';
    profile.facilityLevels.warehouse = 2;
    profile.facilityLevels.medicalBay = 2;
    profile.facilityLevels.armory = 2;
    expect(resolveLoadout(profile)).toMatchObject({
      ammo: 55,
      medkits: 2,
      backpackSlots: 16,
      weapon: 'smg',
    });
  });

  it('applies the maximum workshop equipment discount', () => {
    const profile = createDefaultProfile();
    profile.facilityLevels.workshop = 3;
    const helmet = GEAR_CATALOG.find((item) => item.id === 'ridge-h2');
    expect(helmet).toBeDefined();
    expect(gearPrice(profile, helmet!)).toBe(810);
  });

  it('offers gold and red helmets and chest armor', () => {
    for (const category of ['helmet', 'armor'] as const) {
      expect(GEAR_CATALOG.some((item) => item.category === category && item.rarity === 'gold')).toBe(true);
      expect(GEAR_CATALOG.some((item) => item.category === category && item.rarity === 'red')).toBe(true);
    }
  });

  it('maps weapon rarity to the full 0-6 ammunition scale', () => {
    const profile = createDefaultProfile();
    profile.ownedGear.push('weapon-m7');
    profile.equippedGear.weapon = 'weapon-m7';
    expect(resolveLoadout(profile).ammoLevel).toBe(6);
  });

  it('offers gold and red backpacks and medical gear with stronger loadout bonuses', () => {
    for (const category of ['backpack', 'medical'] as const) {
      expect(GEAR_CATALOG.some((item) => item.category === category && item.rarity === 'gold')).toBe(true);
      expect(GEAR_CATALOG.some((item) => item.category === category && item.rarity === 'red')).toBe(true);
    }
    const profile = createDefaultProfile();
    profile.ownedGear.push('scarlet-pack', 'scarlet-medical');
    profile.equippedGear.backpack = 'scarlet-pack';
    profile.equippedGear.medical = 'scarlet-medical';
    expect(resolveLoadout(profile)).toMatchObject({ backpackSlots: 22, medkits: 5 });
  });

  it('keeps the equipped red protection after restoring the local profile', () => {
    const profile = createDefaultProfile();
    profile.ownedGear.push('scarlet-h9', 'scarlet-a9');
    profile.equippedGear.helmet = 'scarlet-h9';
    profile.equippedGear.armor = 'scarlet-a9';
    const restored = parseProfile(JSON.stringify(profile));
    expect(resolveLoadout(restored).armor).toBe(70);
    expect(restored.equippedGear).toMatchObject({ helmet: 'scarlet-h9', armor: 'scarlet-a9' });
  });

  it('keeps later facility rewards useful without making them grow every level', () => {
    const profile = createDefaultProfile();
    profile.facilityLevels.command = 15;
    profile.facilityLevels.training = 20;
    profile.facilityLevels.armory = 20;
    profile.facilityLevels.warehouse = 15;
    profile.facilityLevels.medicalBay = 15;
    expect(resolveLoadout(profile)).toMatchObject({
      armor: 39,
      ammo: 70,
      medkits: 4,
      backpackSlots: 20,
      weapon: 'rifle',
    });
  });

  it('raises upgrade costs over time and stops at the facility maximum', () => {
    const workshop = FACILITIES.find((facility) => facility.id === 'workshop')!;
    expect(facilityUpgradeCost(workshop, 1)).toBe(2400);
    expect(facilityUpgradeCost(workshop, 3)).toBeGreaterThan(6200);
    expect(facilityUpgradeCost(workshop, 15)).toBeNull();
  });
});
