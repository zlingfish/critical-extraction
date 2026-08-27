import { describe, expect, it } from 'vitest';
import { createDefaultProfile } from './domain';
import {
  GUNSMITH_WEAPONS,
  resolveAllWeaponBuilds,
  resolveWeaponBuild,
  WEAPON_MODIFICATIONS,
  WEAPON_MOD_SLOTS,
} from './gunsmith';

describe('gunsmith build effects', () => {
  it('combines installed modifications for one weapon only', () => {
    const profile = createDefaultProfile();
    profile.ownedWeaponMods = ['muzzle-ghost-suppressor', 'mag-fast-extended'];
    profile.weaponBuilds = { rifle: { muzzle: 'muzzle-ghost-suppressor', magazine: 'mag-fast-extended' } };
    const rifle = resolveWeaponBuild(profile, 'rifle');
    const smg = resolveWeaponBuild(profile, 'smg');
    expect(rifle.noiseMultiplier).toBeCloseTo(0.48);
    expect(rifle.magazineBonus).toBe(10);
    expect(rifle.reserveBonus).toBe(30);
    expect(rifle.reloadMultiplier).toBeCloseTo(0.9);
    expect(smg.noiseMultiplier).toBe(1);
    expect(smg.magazineBonus).toBe(0);
  });

  it('multiplies percentage effects and adds capacity effects across different slots', () => {
    const profile = createDefaultProfile();
    profile.weaponBuilds = {
      rifle: {
        muzzle: 'muzzle-vector-comp',
        handguard: 'handguard-carbon-float',
        magazine: 'mag-fast-extended',
      },
    };
    const effects = resolveWeaponBuild(profile, 'rifle');
    expect(effects.recoilMultiplier).toBeCloseTo(0.86 * 0.88);
    expect(effects.spreadMultiplier).toBeCloseTo(0.97 * 0.9);
    expect(effects.reloadMultiplier).toBeCloseTo(0.96 * 0.9);
    expect(effects.magazineBonus).toBe(10);
    expect(effects.reserveBonus).toBe(30);
  });

  it('resolves an independent build result for every supported weapon', () => {
    const profile = createDefaultProfile();
    profile.weaponBuilds = { rifle: { magazine: 'mag-extended' } };
    const builds = resolveAllWeaponBuilds(profile);
    expect(Object.keys(builds)).toHaveLength(GUNSMITH_WEAPONS.length);
    expect(builds.rifle.magazineBonus).toBe(8);
    expect(builds.smg.magazineBonus).toBe(0);
    expect(builds.shotgun.magazineBonus).toBe(0);
  });

  it('provides five choices for every modification slot', () => {
    expect(WEAPON_MOD_SLOTS).toHaveLength(6);
    for (const slot of WEAPON_MOD_SLOTS) {
      expect(WEAPON_MODIFICATIONS.filter((entry) => entry.slot === slot.id)).toHaveLength(5);
    }
    expect(new Set(WEAPON_MODIFICATIONS.map((entry) => entry.id)).size).toBe(WEAPON_MODIFICATIONS.length);
  });
});
