import { describe, expect, it } from 'vitest';
import { RECOIL_AMPLITUDE, resolveAimSpread, resolveDamageAtDistance, resolvePelletDamage, resolveRecoilStep, resolveReloadDuration, resolveWeaponClearance, WEAPON_FEEL_PROFILES } from './weapon-feel';
import type { WeaponFeelId } from './weapon-feel';

const WEAPON_IDS: WeaponFeelId[] = ['rifle', 'smg', 'shotgun', 'asval', 'awm', 'm7'];

describe('weapon recoil profiles', () => {
  it('provides a complete and usable profile for all six weapons', () => {
    expect(Object.keys(WEAPON_FEEL_PROFILES).sort()).toEqual([...WEAPON_IDS].sort());

    for (const weaponId of WEAPON_IDS) {
      const profile = WEAPON_FEEL_PROFILES[weaponId];
      expect(profile.verticalGain).toBeGreaterThan(0);
      expect(profile.horizontalPattern.length).toBeGreaterThan(1);
      expect(profile.recovery).toBeGreaterThan(0);
      expect(profile.weaponKick).toBeGreaterThan(0);
      expect(profile.aimSpeed).toBeGreaterThan(0);
      expect(profile.falloffStart).toBeGreaterThan(0);
      expect(profile.minimumDamageMultiplier).toBeGreaterThan(0);
    }
  });

  it('makes the SMG lose much more damage over distance than rifles', () => {
    const smgLongRange = resolveDamageAtDistance('smg', 45, 90, 90);
    const rifleLongRange = resolveDamageAtDistance('rifle', 36, 150, 150);

    expect(smgLongRange).toBeCloseTo(45 * 0.38);
    expect(rifleLongRange).toBeCloseTo(36 * 0.65);
    expect(smgLongRange / 45).toBeLessThan(rifleLongRange / 36);
  });

  it('keeps shotgun damage strong up close and drops it sharply at range', () => {
    expect(resolveDamageAtDistance('shotgun', 17, 6, 42)).toBe(17);
    expect(resolveDamageAtDistance('shotgun', 17, 42, 42)).toBeCloseTo(17 * 0.15);
  });

  it('gives the sniper the slowest aim and strongest lingering sway', () => {
    const awm = WEAPON_FEEL_PROFILES.awm;
    for (const weaponId of WEAPON_IDS.filter((id) => id !== 'awm')) {
      expect(awm.aimSpeed).toBeLessThan(WEAPON_FEEL_PROFILES[weaponId].aimSpeed);
      expect(awm.postShotSway).toBeGreaterThan(WEAPON_FEEL_PROFILES[weaponId].postShotSway);
    }
  });

  it('restores V9 close-range damage to 45 per pellet and 90 per shot', () => {
    const pelletDamage = resolvePelletDamage(45, 2, false);
    expect(pelletDamage).toBe(45);
    expect(pelletDamage * 2).toBe(90);
  });

  it('only grants full aimed accuracy after the aim transition finishes', () => {
    expect(resolveAimSpread(0.034, 0.00045, 0)).toBeCloseTo(0.034);
    expect(resolveAimSpread(0.034, 0.00045, 0.5)).toBeGreaterThan(0.00045);
    expect(resolveAimSpread(0.034, 0.00045, 1)).toBeCloseTo(0.00045);
  });

  it('gives different weapons visibly different recoil strength and direction patterns', () => {
    const rifle = resolveRecoilStep('rifle', 2, false);
    const smg = resolveRecoilStep('smg', 2, false);
    const shotgun = resolveRecoilStep('shotgun', 2, false);
    const awm = resolveRecoilStep('awm', 2, false);

    expect(rifle.pitch).toBeGreaterThan(smg.pitch * 1.3);
    expect(rifle.yaw).not.toBeCloseTo(smg.yaw);
    expect(shotgun.weaponKick).toBeGreaterThan(rifle.weaponKick);
    expect(awm.pitch).toBeGreaterThan(shotgun.pitch);
  });

  it('scales every weapon recoil output to 75% without erasing weapon differences', () => {
    const awm = resolveRecoilStep('awm', 0, false);
    expect(awm.pitch).toBeCloseTo(WEAPON_FEEL_PROFILES.awm.verticalGain * RECOIL_AMPLITUDE);
    expect(awm.weaponKick).toBeCloseTo(WEAPON_FEEL_PROFILES.awm.weaponKick * RECOIL_AMPLITUDE);
    expect(awm.pitch).toBeGreaterThan(resolveRecoilStep('smg', 0, false).pitch);
  });

  it('reduces camera and weapon recoil while aiming', () => {
    const hip = resolveRecoilStep('m7', 4, false);
    const aimed = resolveRecoilStep('m7', 4, true);

    expect(aimed.pitch).toBeLessThan(hip.pitch);
    expect(Math.abs(aimed.yaw)).toBeLessThan(Math.abs(hip.yaw));
    expect(aimed.weaponKick).toBeLessThan(hip.weaponKick);
    expect(aimed.recovery).toBe(hip.recovery);
  });

  it('applies the gunsmith multiplier to pitch, yaw and weapon kick', () => {
    const base = resolveRecoilStep('asval', 1, false);
    const modified = resolveRecoilStep('asval', 1, false, 0.75);

    expect(modified.pitch).toBeCloseTo(base.pitch * 0.75);
    expect(modified.yaw).toBeCloseTo(base.yaw * 0.75);
    expect(modified.weaponKick).toBeCloseTo(base.weaponKick * 0.75);
    expect(modified.recovery).toBe(base.recovery);
  });
});

describe('weapon handling animation rules', () => {
  it('keeps an empty reload complete while making a tactical reload faster', () => {
    expect(resolveReloadDuration(2.4, 'empty')).toBeCloseTo(2.4);
    expect(resolveReloadDuration(2.4, 'tactical')).toBeCloseTo(1.968);
  });

  it('smoothly raises the weapon as a wall gets closer', () => {
    expect(resolveWeaponClearance(null)).toBe(0);
    expect(resolveWeaponClearance(1.3)).toBe(0);
    expect(resolveWeaponClearance(0.8)).toBeGreaterThan(0);
    expect(resolveWeaponClearance(0.8)).toBeLessThan(1);
    expect(resolveWeaponClearance(0.3)).toBe(1);
  });
});
