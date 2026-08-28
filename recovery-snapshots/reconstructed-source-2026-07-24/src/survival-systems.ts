import type {
  AmmoLevel,
  BodyInjuries,
  BodyPart,
  InjurySeverity,
  InventoryItem,
  MedicalTreatment,
} from './types';

export interface BallisticResult {
  healthDamage: number;
  armorDamage: number;
  armorDurability: number;
  penetrationChance: number;
  penetrated: boolean;
}

export function createHealthyInjuries(): BodyInjuries {
  return { leftArm: 0, rightArm: 0, leftLeg: 0, rightLeg: 0, bleeding: 0 };
}

export function penetrationChance(ammoLevel: AmmoLevel, armorLevel: number): number {
  const safeArmorLevel = Math.max(0, Math.min(6, Math.round(armorLevel)));
  return Math.max(0.08, Math.min(0.95, 0.48 + (ammoLevel - safeArmorLevel) * 0.17));
}

export function resolveBallisticHit(
  rawDamage: number,
  armorDurability: number,
  ammoLevel: AmmoLevel,
  armorLevel: number,
  roll = Math.random(),
): BallisticResult {
  const damage = Math.max(0, Number.isFinite(rawDamage) ? rawDamage : 0);
  const durability = Math.max(0, Number.isFinite(armorDurability) ? armorDurability : 0);
  if (durability <= 0 || armorLevel <= 0) {
    return {
      healthDamage: Math.round(damage),
      armorDamage: 0,
      armorDurability: 0,
      penetrationChance: 1,
      penetrated: true,
    };
  }
  const chance = penetrationChance(ammoLevel, armorLevel);
  const penetrated = roll < chance;
  const levelGap = Math.max(-6, Math.min(6, ammoLevel - armorLevel));
  const healthMultiplier = penetrated
    ? Math.min(0.94, 0.72 + Math.max(0, levelGap) * 0.055)
    : Math.max(0.1, 0.24 + levelGap * 0.025);
  const armorMultiplier = Math.max(0.42, 0.82 + levelGap * 0.1);
  const armorDamage = Math.min(durability, damage * armorMultiplier);
  return {
    healthDamage: Math.round(damage * healthMultiplier),
    armorDamage: Math.round(armorDamage),
    armorDurability: Math.max(0, Math.round(durability - armorDamage)),
    penetrationChance: chance,
    penetrated,
  };
}

function severityFromDamage(damage: number, roll: number): InjurySeverity {
  if (damage >= 32 || (damage >= 20 && roll < 0.34)) return 2;
  if (damage >= 12 || roll < 0.18) return 1;
  return 0;
}

export function applyBodyInjury(
  injuries: BodyInjuries,
  bodyPart: BodyPart,
  healthDamage: number,
  roll = Math.random(),
): BodyInjuries {
  if (!['leftArm', 'rightArm', 'leftLeg', 'rightLeg'].includes(bodyPart)) return injuries;
  const severity = severityFromDamage(healthDamage, roll);
  if (severity === 0) return injuries;
  const limb = bodyPart as keyof Pick<BodyInjuries, 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg'>;
  const bleeding = healthDamage >= 18 ? Math.max(injuries.bleeding, 1) as InjurySeverity : injuries.bleeding;
  return { ...injuries, [limb]: Math.max(injuries[limb], severity) as InjurySeverity, bleeding };
}

export function movementMultiplier(injuries: BodyInjuries): number {
  const legSeverity = injuries.leftLeg + injuries.rightLeg;
  return Math.max(0.46, 1 - legSeverity * 0.17);
}

export function aimSwayMultiplier(injuries: BodyInjuries): number {
  return 1 + (injuries.leftArm + injuries.rightArm) * 0.48;
}

export function treatInjuries(injuries: BodyInjuries, treatment: MedicalTreatment): BodyInjuries {
  if (treatment === 'bandage') return { ...injuries, bleeding: 0 };
  if (treatment === 'splint') {
    const candidates = ['leftLeg', 'rightLeg', 'leftArm', 'rightArm'] as const;
    const target = candidates.reduce((worst, limb) => injuries[limb] > injuries[worst] ? limb : worst);
    return injuries[target] === 0 ? injuries : { ...injuries, [target]: Math.max(0, injuries[target] - 1) as InjurySeverity };
  }
  return createHealthyInjuries();
}

export function moveItemToSecureContainer(
  backpack: InventoryItem[],
  secureContainer: InventoryItem[],
  itemId: string,
  capacity: number,
): { backpack: InventoryItem[]; secureContainer: InventoryItem[]; moved: boolean } {
  const index = backpack.findIndex((item) => item.id === itemId);
  if (index < 0 || secureContainer.length >= Math.max(0, Math.floor(capacity))) {
    return { backpack, secureContainer, moved: false };
  }
  const item = backpack[index];
  if (item.kind === 'weapon' || item.kind === 'armor' || item.kind === 'helmet') {
    return { backpack, secureContainer, moved: false };
  }
  return {
    backpack: backpack.filter((_, itemIndex) => itemIndex !== index),
    secureContainer: [...secureContainer, item],
    moved: true,
  };
}

export function moveItemFromSecureContainer(
  backpack: InventoryItem[],
  secureContainer: InventoryItem[],
  itemId: string,
  backpackCapacity: number,
): { backpack: InventoryItem[]; secureContainer: InventoryItem[]; moved: boolean } {
  const index = secureContainer.findIndex((item) => item.id === itemId);
  if (index < 0) return { backpack, secureContainer, moved: false };
  const item = secureContainer[index];
  const usedSlots = backpack.reduce((sum, entry) => sum + Math.max(1, (entry.slotWidth ?? 1) * (entry.slotHeight ?? 1)), 0);
  const itemSlots = Math.max(1, (item.slotWidth ?? 1) * (item.slotHeight ?? 1));
  if (usedSlots + itemSlots > backpackCapacity) return { backpack, secureContainer, moved: false };
  return {
    backpack: [...backpack, item],
    secureContainer: secureContainer.filter((_, itemIndex) => itemIndex !== index),
    moved: true,
  };
}

export function durabilityAdjustedValue(item: InventoryItem): number {
  if (item.durability === undefined || item.maxDurability === undefined || item.maxDurability <= 0) return item.value;
  const ratio = Math.max(0, Math.min(1, item.durability / item.maxDurability));
  return Math.round(item.value * (0.28 + ratio * 0.72));
}

export function wearDurability(current: number, maximum: number, amount: number): number {
  if (maximum <= 0) return 0;
  return Math.max(0, Math.min(maximum, Math.round(current - Math.max(0, amount))));
}

export function revealUnknownItem(item: InventoryItem): InventoryItem {
  if (item.identified !== false) return item;
  return {
    ...item,
    identified: true,
    name: item.trueName ?? item.name,
    value: item.trueValue ?? item.value,
    trueName: undefined,
    trueValue: undefined,
  };
}
