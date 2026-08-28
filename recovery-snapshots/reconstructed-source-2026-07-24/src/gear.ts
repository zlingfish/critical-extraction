import { FACILITY_MAX_LEVELS } from './types';
import type { AmmoLevel, FacilityId, GearCategory, InventoryItem, ItemRarity, PersistentProfile } from './types';

export type GearWeaponId = 'rifle' | 'smg' | 'shotgun' | 'asval' | 'awm' | 'm7';

export interface GearItem {
  id: string;
  name: string;
  category: GearCategory;
  rarity: ItemRarity;
  price: number;
  weight: number;
  icon: 'hard-hat' | 'shield' | 'backpack' | 'briefcase-medical' | 'crosshair';
  description: string;
  armorBonus?: number;
  backpackSlots?: number;
  medkitBonus?: number;
  ammoBonus?: number;
  weaponId?: GearWeaponId;
}

export interface FacilityDefinition {
  id: FacilityId;
  name: string;
  icon: 'wrench' | 'radio' | 'crosshair' | 'warehouse' | 'briefcase-medical' | 'dumbbell';
  description: string;
  effect: string;
  costs: [number, number];
  maxLevel: number;
}

export const GEAR_CATEGORIES: Array<{ id: GearCategory | 'all'; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'helmet', label: '头盔' },
  { id: 'armor', label: '护甲' },
  { id: 'backpack', label: '背包' },
  { id: 'medical', label: '医疗' },
  { id: 'weapon', label: '武器' },
];

export const GEAR_CATALOG: GearItem[] = [
  { id: 'starter-helmet', name: '巡逻 M1 头盔', category: 'helmet', rarity: 'white', price: 460, weight: 1.4, icon: 'hard-hat', armorBonus: 2, description: '基础复合材料头盔，提供少量额外防护。死亡后会遗失。' },
  { id: 'ridge-h2', name: '山脊 H2 头盔', category: 'helmet', rarity: 'green', price: 900, weight: 1.8, icon: 'hard-hat', armorBonus: 6, description: '加厚侧板与护耳结构，适合近距离交火。' },
  { id: 'sentinel-h4', name: '哨兵 H4 头盔', category: 'helmet', rarity: 'blue', price: 2800, weight: 2.2, icon: 'hard-hat', armorBonus: 10, description: '全包围战术头盔，强化正面和侧面防护。' },
  { id: 'aegis-h6', name: '玄甲 H6 头盔', category: 'helmet', rarity: 'purple', price: 5200, weight: 2.8, icon: 'hard-hat', armorBonus: 15, description: '重型防弹结构，针对高威胁区域设计。' },
  { id: 'auric-h7', name: '曜金 G7 复合头盔', category: 'helmet', rarity: 'gold', price: 9800, weight: 3.2, icon: 'hard-hat', armorBonus: 20, description: '多层复合防护壳体与全包围护颚，适合高危险行动。' },
  { id: 'scarlet-h9', name: '赤霄 X9 全防头盔', category: 'helmet', rarity: 'red', price: 16800, weight: 3.8, icon: 'hard-hat', armorBonus: 26, description: '最高等级头部防护，强化面部、后脑和侧面覆盖。' },

  { id: 'starter-armor', name: '轻型巡逻背心', category: 'armor', rarity: 'white', price: 780, weight: 4.2, icon: 'shield', armorBonus: 5, description: '基础插板背心，兼顾行动速度与防护。死亡后会遗失。' },
  { id: 'frontier-a2', name: '边境 A2 护甲', category: 'armor', rarity: 'green', price: 1900, weight: 6.1, icon: 'shield', armorBonus: 12, description: '增加胸腹部覆盖面积，适合普通行动。' },
  { id: 'bulwark-a4', name: '壁垒 A4 护甲', category: 'armor', rarity: 'blue', price: 3600, weight: 8.8, icon: 'shield', armorBonus: 20, description: '加强型陶瓷插板和侧腰防护。' },
  { id: 'titan-a6', name: '泰岳 A6 重甲', category: 'armor', rarity: 'purple', price: 6800, weight: 12.4, icon: 'shield', armorBonus: 30, description: '高覆盖重型护甲，显著提高开局护甲值。' },
  { id: 'auric-a7', name: '曜金 G7 复合胸甲', category: 'armor', rarity: 'gold', price: 14200, weight: 13.6, icon: 'shield', armorBonus: 36, description: '覆盖胸腹与侧腰的强化插板系统，提供高等级持续防护。' },
  { id: 'scarlet-a9', name: '赤霄 X9 重型胸甲', category: 'armor', rarity: 'red', price: 23800, weight: 15.8, icon: 'shield', armorBonus: 44, description: '最高等级全覆盖胸甲，用重量换取极强的正面与侧面防护。' },

  { id: 'starter-pack', name: '侦察 12 格背包', category: 'backpack', rarity: 'white', price: 520, weight: 1.2, icon: 'backpack', backpackSlots: 12, description: '轻量行动背包，可容纳 12 种不同物资。死亡后会遗失。' },
  { id: 'trail-pack', name: '远行 14 格背包', category: 'backpack', rarity: 'green', price: 1600, weight: 1.8, icon: 'backpack', backpackSlots: 14, description: '增加两个物资格，适合中短距离搜索。' },
  { id: 'assault-pack', name: '强袭 16 格背包', category: 'backpack', rarity: 'blue', price: 3200, weight: 2.5, icon: 'backpack', backpackSlots: 16, description: '分区收纳结构，可携带更多高价值战利品。' },
  { id: 'expedition-pack', name: '远征 18 格背包', category: 'backpack', rarity: 'purple', price: 5900, weight: 3.3, icon: 'backpack', backpackSlots: 18, description: '大型模块化背包，兼顾容量与行动负担。' },
  { id: 'auric-pack', name: '曜金 G7 20 格战术背包', category: 'backpack', rarity: 'gold', price: 11200, weight: 4.0, icon: 'backpack', backpackSlots: 20, description: '高强度模块化携行系统，可稳定携带大量高价值物资。' },
  { id: 'scarlet-pack', name: '赤霄 X9 22 格远征背包', category: 'backpack', rarity: 'red', price: 19600, weight: 4.8, icon: 'backpack', backpackSlots: 22, description: '最高等级远征背包，提供当前最大的行动物资容量。' },

  { id: 'starter-medical', name: '基础急救包', category: 'medical', rarity: 'white', price: 340, weight: 0.6, icon: 'briefcase-medical', medkitBonus: 0, description: '标准止血与包扎用品。死亡后会遗失。' },
  { id: 'field-medical', name: '战地急救组', category: 'medical', rarity: 'green', price: 1500, weight: 1.0, icon: 'briefcase-medical', medkitBonus: 1, description: '下一局额外携带 1 个医疗包。' },
  { id: 'trauma-medical', name: '创伤处理组', category: 'medical', rarity: 'blue', price: 3000, weight: 1.5, icon: 'briefcase-medical', medkitBonus: 2, description: '完整创伤处理套件，额外携带 2 个医疗包。' },
  { id: 'advanced-medical', name: '高级维生系统', category: 'medical', rarity: 'purple', price: 5400, weight: 2.1, icon: 'briefcase-medical', medkitBonus: 3, description: '高规格生命支持装备，额外携带 3 个医疗包。' },
  { id: 'auric-medical', name: '曜金 G7 战地维生组', category: 'medical', rarity: 'gold', price: 9800, weight: 2.7, icon: 'briefcase-medical', medkitBonus: 4, description: '高危行动医疗配置，下一局额外携带 4 个医疗包。' },
  { id: 'scarlet-medical', name: '赤霄 X9 急救终端', category: 'medical', rarity: 'red', price: 17200, weight: 3.4, icon: 'briefcase-medical', medkitBonus: 5, description: '最高等级生命保障系统，下一局额外携带 5 个医疗包。' },

  { id: 'weapon-rifle', name: 'KR-56 突击步枪', category: 'weapon', rarity: 'white', price: 1100, weight: 3.7, icon: 'crosshair', weaponId: 'rifle', ammoBonus: 0, description: '均衡可靠的制式突击步枪。需要购买并装入主武器栏；死亡会遗失。' },
  { id: 'weapon-smg', name: 'V9 冲锋枪', category: 'weapon', rarity: 'green', price: 2600, weight: 2.8, icon: 'crosshair', weaponId: 'smg', ammoBonus: 40, description: '高射速、低后坐力，近中距离持续火力出色。' },
  { id: 'weapon-shotgun', name: 'SG-12 战术霰弹枪', category: 'weapon', rarity: 'blue', price: 3400, weight: 4.1, icon: 'crosshair', weaponId: 'shotgun', ammoBonus: 12, description: '近距离威力强，适合管道和楼内作战。' },
  { id: 'weapon-asval', name: 'AS VAL 微声步枪', category: 'weapon', rarity: 'purple', price: 5200, weight: 3.5, icon: 'crosshair', weaponId: 'asval', ammoBonus: 20, description: '自带抑制结构，射击更不容易惊动远处敌人。' },
  { id: 'weapon-awm', name: 'AWM 精密狙击步枪', category: 'weapon', rarity: 'gold', price: 7800, weight: 6.4, icon: 'crosshair', weaponId: 'awm', ammoBonus: 5, description: '远距离高威力精密步枪，弹匣容量较小。' },
  { id: 'weapon-m7', name: 'M7 战斗步枪', category: 'weapon', rarity: 'red', price: 10800, weight: 4.6, icon: 'crosshair', weaponId: 'm7', ammoBonus: 25, description: '高级战斗步枪，兼顾射程、威力与持续火力。' },
];

export const FACILITIES: FacilityDefinition[] = [
  { id: 'workshop', name: '装备工作台', icon: 'wrench', description: '维护装备并降低采购损耗。', effect: '前 3 级快速降价，之后每 3 级继续降低采购价', costs: [2400, 6200], maxLevel: FACILITY_MAX_LEVELS.workshop },
  { id: 'command', name: '行动指挥室', icon: 'radio', description: '整合行动情报和防护调度。', effect: '前 3 级强化护甲，之后每 3 级获得防护提升', costs: [2600, 6800], maxLevel: FACILITY_MAX_LEVELS.command },
  { id: 'armory', name: '战备靶场', icon: 'crosshair', description: '改进弹药配发和武器校准。', effect: '前 3 级增加备弹，之后每 2 级扩充一次弹药', costs: [2200, 5800], maxLevel: FACILITY_MAX_LEVELS.armory },
  { id: 'warehouse', name: '后勤仓库', icon: 'warehouse', description: '扩充行动背包的模块化收纳。', effect: '前 3 级增加背包格，之后每 3 级扩充一次', costs: [2800, 7200], maxLevel: FACILITY_MAX_LEVELS.warehouse },
  { id: 'medicalBay', name: '医疗站', icon: 'briefcase-medical', description: '完善战地救护和药品配置。', effect: '前 3 级增加医疗包，之后每 5 级补充一次', costs: [2500, 6500], maxLevel: FACILITY_MAX_LEVELS.medicalBay },
  { id: 'training', name: '训练中心', icon: 'dumbbell', description: '强化负重行动和防护适应。', effect: '前 3 级强化护甲，之后每 3 级提升行动防护', costs: [2300, 6000], maxLevel: FACILITY_MAX_LEVELS.training },
];

function laterMilestones(level: number, interval: number): number {
  return Math.floor(Math.max(0, level - 3) / interval);
}

export function gearPrice(profile: PersistentProfile, item: GearItem): number {
  const workshopLevel = profile.facilityLevels.workshop ?? 1;
  const earlyDiscount = Math.min(2, Math.max(0, workshopLevel - 1)) * 0.05;
  const discount = Math.min(0.18, earlyDiscount + laterMilestones(workshopLevel, 3) * 0.02);
  return Math.round(item.price * (1 - discount));
}

export function equippedItem(profile: PersistentProfile, category: GearCategory): GearItem | undefined {
  const id = profile.equippedGear[category];
  const catalogItem = GEAR_CATALOG.find((item) => item.id === id);
  if (catalogItem) return catalogItem;
  const loot = profile.stash.find((item) => item.id === id);
  if (!loot) return undefined;
  return gearItemFromLoot(loot, category);
}

function rarityBonus(rarity: ItemRarity): number {
  return ({ black: 0, white: 2, green: 5, blue: 9, purple: 14, gold: 20, red: 28 })[rarity];
}

/** 将敌人掉落的动态装备转成和制式装备相同的效果，避免“装备了但下一局没变化”。 */
function gearItemFromLoot(item: InventoryItem, category: GearCategory): GearItem {
  const durabilityRatio = item.maxDurability ? Math.max(0, Math.min(1, (item.durability ?? 0) / item.maxDurability)) : 1;
  const armorBonus = Math.max(1, Math.round(rarityBonus(item.rarity) * (0.55 + durabilityRatio * 0.45)));
  const weaponId = ({ smg: 'smg', shotgun: 'shotgun', sniper: 'awm', rifle: 'rifle', asval: 'asval', awm: 'awm', m7: 'm7' } as const)[item.variant ?? ''];
  return {
    id: item.id,
    name: item.name,
    category,
    rarity: item.rarity,
    price: item.value,
    weight: 1,
    icon: category === 'weapon' ? 'crosshair' : category === 'medical' ? 'briefcase-medical' : category === 'helmet' ? 'hard-hat' : 'shield',
    description: item.description ?? '行动中回收的装备。',
    armorBonus: category === 'armor' || category === 'helmet' ? armorBonus : undefined,
    medkitBonus: category === 'medical' ? 1 : undefined,
    weaponId: category === 'weapon' ? weaponId : undefined,
    ammoBonus: category === 'weapon' ? Math.round(rarityBonus(item.rarity) * 1.5) : undefined,
  };
}

export function resolveLoadout(profile: PersistentProfile): {
  armor: number;
  ammo: number;
  medkits: number;
  backpackSlots: number;
  weapon: GearWeaponId;
  armorLevel: number;
  ammoLevel: AmmoLevel;
  loadoutValue: number;
  secureContainerCapacity: number;
} {
  const helmet = equippedItem(profile, 'helmet');
  const armor = equippedItem(profile, 'armor');
  const backpack = equippedItem(profile, 'backpack');
  const medical = equippedItem(profile, 'medical');
  const weapon = equippedItem(profile, 'weapon');
  const levels = profile.facilityLevels;
  const commandArmor = Math.min(2, Math.max(0, levels.command - 1)) * 3 + laterMilestones(levels.command, 3) * 2;
  const trainingArmor = Math.min(2, Math.max(0, levels.training - 1)) * 4 + laterMilestones(levels.training, 3) * 2;
  const armoryAmmo = Math.min(2, Math.max(0, levels.armory - 1)) * 15 + laterMilestones(levels.armory, 2) * 5;
  const warehouseSlots = Math.min(2, Math.max(0, levels.warehouse - 1)) * 2 + laterMilestones(levels.warehouse, 3);
  const medicalKits = Math.min(2, Math.max(0, levels.medicalBay - 1)) + laterMilestones(levels.medicalBay, 5);
  const protectionByRarity: Record<ItemRarity, number> = { black: 0, white: 1, green: 2, blue: 3, purple: 4, gold: 5, red: 6 };
  const ammunitionByRarity: Record<ItemRarity, AmmoLevel> = { black: 0, white: 1, green: 2, blue: 3, purple: 4, gold: 5, red: 6 };
  const equipped = [helmet, armor, backpack, medical, weapon].filter((item): item is GearItem => Boolean(item));
  return {
    armor: (helmet?.armorBonus ?? 0) + (armor?.armorBonus ?? 0) + commandArmor + trainingArmor,
    ammo: (weapon?.ammoBonus ?? 0) + armoryAmmo,
    medkits: (medical?.medkitBonus ?? 0) + medicalKits,
    backpackSlots: (backpack?.backpackSlots ?? 6) + warehouseSlots,
    weapon: weapon?.weaponId ?? 'rifle',
    armorLevel: Math.max(protectionByRarity[helmet?.rarity ?? 'white'], protectionByRarity[armor?.rarity ?? 'white']),
    ammoLevel: ammunitionByRarity[weapon?.rarity ?? 'white'],
    loadoutValue: equipped.reduce((sum, item) => sum + item.price, 0),
    secureContainerCapacity: Math.max(1, Math.min(4, profile.secureContainerCapacity)),
  };
}

export function facilityUpgradeCost(definition: FacilityDefinition, currentLevel: number): number | null {
  if (currentLevel >= definition.maxLevel) return null;
  if (currentLevel <= 2) return definition.costs[Math.max(0, currentLevel - 1)];
  const laterLevel = currentLevel - 2;
  const multiplier = 1 + laterLevel * 0.28 + laterLevel * laterLevel * 0.035;
  return Math.round((definition.costs[1] * multiplier) / 100) * 100;
}
