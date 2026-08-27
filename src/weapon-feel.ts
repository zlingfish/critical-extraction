export type WeaponFeelId = 'rifle' | 'smg' | 'shotgun' | 'asval' | 'awm' | 'm7';

export interface WeaponFeelProfile {
  verticalGain: number;
  horizontalPattern: readonly number[];
  recovery: number;
  weaponKick: number;
  aimSpeed: number;
  falloffStart: number;
  minimumDamageMultiplier: number;
  postShotSway: number;
  swayRecovery: number;
}

export interface RecoilStep {
  pitch: number;
  yaw: number;
  weaponKick: number;
  recovery: number;
}

export type ReloadStyle = 'empty' | 'tactical';

// Global recoil feel adjustment. Keep weapon profiles distinct while making the current pass less jumpy.
export const RECOIL_AMPLITUDE = 0.75;

export function resolveReloadDuration(baseDuration: number, style: ReloadStyle): number {
  const safeDuration = Number.isFinite(baseDuration) ? Math.max(0.1, baseDuration) : 0.1;
  return style === 'empty' ? safeDuration : safeDuration * 0.82;
}

export function resolveWeaponClearance(
  distance: number | null,
  fullyRaisedDistance = 0.42,
  clearDistance = 1.18,
): number {
  if (distance === null || !Number.isFinite(distance) || distance >= clearDistance) return 0;
  if (distance <= fullyRaisedDistance) return 1;
  return 1 - (distance - fullyRaisedDistance) / (clearDistance - fullyRaisedDistance);
}

export const WEAPON_FEEL_PROFILES: Record<WeaponFeelId, WeaponFeelProfile> = {
  rifle: {
    verticalGain: 0.0105,
    horizontalPattern: [-0.0015, 0.001, 0.0028, -0.001, -0.0032, 0.0018, 0.0035, -0.0024],
    recovery: 9.5,
    weaponKick: 0.055,
    aimSpeed: 11,
    falloffStart: 50,
    minimumDamageMultiplier: 0.65,
    postShotSway: 0.002,
    swayRecovery: 9,
  },
  smg: {
    verticalGain: 0.0068,
    horizontalPattern: [-0.0038, 0.0044, -0.0052, 0.0048, -0.003, 0.0055],
    recovery: 12.5,
    weaponKick: 0.035,
    aimSpeed: 15,
    falloffStart: 18,
    minimumDamageMultiplier: 0.38,
    postShotSway: 0.0012,
    swayRecovery: 13,
  },
  shotgun: {
    verticalGain: 0.042,
    horizontalPattern: [0.007, -0.005, 0.009, -0.008],
    recovery: 5.5,
    weaponKick: 0.16,
    aimSpeed: 12,
    falloffStart: 10,
    minimumDamageMultiplier: 0.15,
    postShotSway: 0.012,
    swayRecovery: 6,
  },
  asval: {
    verticalGain: 0.0085,
    horizontalPattern: [0.001, 0.0025, 0.004, 0.003, -0.001, -0.0035, -0.002],
    recovery: 11,
    weaponKick: 0.045,
    aimSpeed: 10,
    falloffStart: 28,
    minimumDamageMultiplier: 0.52,
    postShotSway: 0.0025,
    swayRecovery: 10,
  },
  awm: {
    verticalGain: 0.075,
    horizontalPattern: [-0.006, 0.008],
    recovery: 4,
    weaponKick: 0.24,
    aimSpeed: 4,
    falloffStart: 120,
    minimumDamageMultiplier: 0.82,
    postShotSway: 0.026,
    swayRecovery: 2.8,
  },
  m7: {
    verticalGain: 0.0135,
    horizontalPattern: [-0.0045, -0.003, -0.001, 0.002, 0.0048, 0.003, -0.002],
    recovery: 8,
    weaponKick: 0.075,
    aimSpeed: 7,
    falloffStart: 70,
    minimumDamageMultiplier: 0.72,
    postShotSway: 0.005,
    swayRecovery: 7,
  },
};

export function resolveDamageAtDistance(
  weaponId: WeaponFeelId,
  baseDamage: number,
  distance: number,
  maximumRange: number,
): number {
  const profile = WEAPON_FEEL_PROFILES[weaponId];
  const safeDamage = Math.max(0, Number.isFinite(baseDamage) ? baseDamage : 0);
  const safeDistance = Math.max(0, Number.isFinite(distance) ? distance : 0);
  const range = Math.max(profile.falloffStart + 0.01, maximumRange);
  if (safeDistance <= profile.falloffStart) return safeDamage;
  const progress = Math.min(1, (safeDistance - profile.falloffStart) / (range - profile.falloffStart));
  const multiplier = 1 + (profile.minimumDamageMultiplier - 1) * progress;
  return safeDamage * multiplier;
}

export function resolvePelletDamage(baseDamage: number, pelletCount: number, damageIsPerShot: boolean): number {
  const safeDamage = Math.max(0, Number.isFinite(baseDamage) ? baseDamage : 0);
  const safePellets = Math.max(1, Math.floor(Number.isFinite(pelletCount) ? pelletCount : 1));
  return damageIsPerShot ? safeDamage / safePellets : safeDamage;
}

export function resolveAimSpread(hipSpread: number, aimSpread: number, aimProgress: number): number {
  const progress = Math.min(1, Math.max(0, Number.isFinite(aimProgress) ? aimProgress : 0));
  return hipSpread + (aimSpread - hipSpread) * progress;
}

const AIM_RECOIL_MULTIPLIER = 0.68;

export function resolveRecoilStep(
  weaponId: WeaponFeelId,
  shotIndex: number,
  aiming: boolean,
  recoilMultiplier = 1,
): RecoilStep {
  const profile = WEAPON_FEEL_PROFILES[weaponId];
  const index = Math.max(0, Math.floor(Number.isFinite(shotIndex) ? shotIndex : 0));
  const modificationMultiplier = Number.isFinite(recoilMultiplier)
    ? Math.max(0, recoilMultiplier)
    : 1;
  const appliedMultiplier = modificationMultiplier * (aiming ? AIM_RECOIL_MULTIPLIER : 1);
  const verticalRamp = 1 + Math.min(index, 10) * 0.045;

  return {
    pitch: profile.verticalGain * verticalRamp * appliedMultiplier * RECOIL_AMPLITUDE,
    yaw: profile.horizontalPattern[index % profile.horizontalPattern.length] * appliedMultiplier * RECOIL_AMPLITUDE,
    weaponKick: profile.weaponKick * appliedMultiplier * RECOIL_AMPLITUDE,
    recovery: profile.recovery,
  };
}
