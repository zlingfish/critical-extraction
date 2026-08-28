export type GamePhase =
  | 'menu'
  | 'deploying'
  | 'active'
  | 'extracting'
  | 'success'
  | 'failed'
  | 'paused';

export type EnemyState =
  | 'patrol'
  | 'investigate'
  | 'engage'
  | 'search'
  | 'return'
  | 'dead';

export type ItemRarity = 'black' | 'white' | 'green' | 'blue' | 'purple' | 'gold' | 'red';
export type ItemKind = 'supplies' | 'electronics' | 'intel' | 'medical' | 'helmet' | 'armor' | 'weapon';
export type EquipmentSlot = 'helmet' | 'armor' | 'weapon';
export type GearCategory = 'helmet' | 'armor' | 'backpack' | 'medical' | 'weapon';
export type FacilityId = 'workshop' | 'command' | 'armory' | 'warehouse' | 'medicalBay' | 'training';
export type WeaponModSlot = 'muzzle' | 'optic' | 'handguard' | 'grip' | 'stock' | 'magazine';
export type BodyPart = 'head' | 'torso' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';
export type InjurySeverity = 0 | 1 | 2;
export type MedicalTreatment = 'bandage' | 'splint' | 'surgery';
/** 弹药穿透等级：0 级为最基础弹药，6 级为最高级弹药。 */
export type AmmoLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface BodyInjuries {
  leftArm: InjurySeverity;
  rightArm: InjurySeverity;
  leftLeg: InjurySeverity;
  rightLeg: InjurySeverity;
  bleeding: InjurySeverity;
}

export interface CombatRecord {
  atSeconds: number;
  direction: 'dealt' | 'received';
  bodyPart: BodyPart;
  ammoLevel: AmmoLevel;
  armorLevel: number;
  rawDamage: number;
  healthDamage: number;
  armorDamage: number;
  penetrated: boolean;
}

export interface InsurancePolicy {
  id: string;
  itemId: string;
  itemName: string;
  item: InventoryItem;
  premium: number;
  returnAt: number;
  status: 'covered' | 'active' | 'returned' | 'lost';
}

export interface WeaponBuildEffects {
  recoilMultiplier: number;
  spreadMultiplier: number;
  reloadMultiplier: number;
  noiseMultiplier: number;
  magazineBonus: number;
  reserveBonus: number;
  aimFovDelta: number;
}

export const FACILITY_MAX_LEVELS: Record<FacilityId, number> = {
  workshop: 15,
  command: 15,
  armory: 20,
  warehouse: 15,
  medicalBay: 15,
  training: 20,
};

export const BASE_MAX_LEVEL = Object.values(FACILITY_MAX_LEVELS).reduce((sum, level) => sum + level, 0);

export interface InventoryItem {
  id: string;
  name: string;
  kind: ItemKind;
  rarity: ItemRarity;
  value: number;
  quantity: number;
  /** 背包网格占用：默认 1 格；大件可设置为 2x1、2x2 等。 */
  slotWidth?: number;
  slotHeight?: number;
  variant?: string;
  origin?: string;
  description?: string;
  durability?: number;
  maxDurability?: number;
  equipmentSlot?: EquipmentSlot;
  identified?: boolean;
  trueName?: string;
  trueValue?: number;
  keyUses?: number;
  maxKeyUses?: number;
}

export interface WeaponState {
  magazine: number;
  reserve: number;
  reloading: boolean;
  reloadEndsAt: number;
}

export interface PlayerState {
  health: number;
  armor: number;
  stamina: number;
  medkits: number;
  bandages: number;
  splints: number;
  armorLevel: number;
  armorDurability: number;
  maxArmorDurability: number;
  ammoLevel: AmmoLevel;
  injuries: BodyInjuries;
  secureContainer: InventoryItem[];
  secureContainerCapacity: number;
  weaponDurability: number;
  maxWeaponDurability: number;
  weapon: WeaponState;
}

export interface RunState {
  phase: GamePhase;
  player: PlayerState;
  backpack: InventoryItem[];
  hasObjective: boolean;
  kills: number;
  elapsedSeconds: number;
  extractionProgress: number;
  objectiveText: string;
  loadoutValue: number;
  combatLog: CombatRecord[];
  routeLog: string[];
}

export interface PersistentProfile {
  version: 1;
  credits: number;
  requisitionTokens: number;
  nextRunArmorBonus: number;
  nextRunAmmoBonus: number;
  nextRunAmmoLevel: AmmoLevel | null;
  nextRunMedkitBonus: number;
  selectedKeycardId: string | null;
  stash: InventoryItem[];
  ownedGear: string[];
  equippedGear: Partial<Record<GearCategory, string>>;
  facilityLevels: Record<FacilityId, number>;
  ownedWeaponMods: string[];
  weaponBuilds: Record<string, Partial<Record<WeaponModSlot, string>>>;
  gearDurability: Record<string, number>;
  insurancePolicies: InsurancePolicy[];
  secureContainerCapacity: number;
  collectionItemIds: string[];
  discoveredSecrets: string[];
  operationChainStage: number;
  bestTimeSeconds: number | null;
  totalExtractions: number;
  totalKills: number;
  totalRuns: number;
}

export interface ExtractionResult {
  value: number;
  grade: 'S' | 'A' | 'B' | 'C';
  timeSeconds: number;
  kills: number;
}
