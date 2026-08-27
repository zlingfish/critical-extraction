import type { InventoryItem, ItemRarity } from './types';

export type EnemyArmorClass = 'regular' | 'elite' | 'boss';
export type RecoveredEnemyWeaponId = 'smg' | 'shotgun' | 'sniper';

interface ArmorProfile {
  name: string;
  rarities: [ItemRarity, ItemRarity, ItemRarity, ItemRarity];
  values: [number, number, number, number];
}

const ARMOR_PROFILES: Record<EnemyArmorClass, ArmorProfile> = {
  regular: { name: '制式防弹衣', rarities: ['black', 'white', 'green', 'blue'], values: [260, 680, 1200, 1900] },
  elite: { name: '重甲战术防弹衣', rarities: ['black', 'green', 'blue', 'purple'], values: [650, 1800, 3400, 5900] },
  boss: { name: '指挥级重型胸甲', rarities: ['black', 'purple', 'gold', 'red'], values: [1600, 4800, 9200, 16800] },
};

interface FixedEquipmentProfile {
  name: string;
  rarity: ItemRarity;
  value: number;
}

const HELMET_PROFILES: Record<EnemyArmorClass, FixedEquipmentProfile> = {
  regular: { name: '制式 M2 战术头盔', rarity: 'green', value: 900 },
  elite: { name: '哨兵 H4 重型头盔', rarity: 'purple', value: 3600 },
  boss: { name: '指挥官 X7 全防头盔', rarity: 'red', value: 11800 },
};

interface RecoveredWeaponProfile {
  name: string;
  values: Record<EnemyArmorClass, number>;
}

const WEAPON_PROFILES: Record<RecoveredEnemyWeaponId, RecoveredWeaponProfile> = {
  smg: { name: 'V9 冲锋枪', values: { regular: 1800, elite: 4200, boss: 8800 } },
  shotgun: { name: 'SG-12 战术霰弹枪', values: { regular: 2400, elite: 5100, boss: 9800 } },
  sniper: { name: 'M24 精确步枪', values: { regular: 3200, elite: 6800, boss: 12600 } },
};

const WEAPON_RARITIES: Record<EnemyArmorClass, ItemRarity> = {
  regular: 'green',
  elite: 'purple',
  boss: 'gold',
};

const WEAPON_PREFIXES: Record<EnemyArmorClass, string> = {
  regular: '缴获',
  elite: '精英改装',
  boss: '首领定制',
};

export function createRecoveredArmorLoot(
  id: string,
  armorClass: EnemyArmorClass,
  durability: number,
  maxDurability: number,
): InventoryItem {
  const profile = ARMOR_PROFILES[armorClass];
  const safeMax = Math.max(1, Math.round(maxDurability));
  const safeDurability = Math.max(0, Math.min(safeMax, Math.round(durability)));
  const ratio = safeDurability / safeMax;
  const conditionIndex = ratio <= 0 ? 0 : ratio < 0.45 ? 1 : ratio < 0.75 ? 2 : 3;
  const conditionLabel = ['破损', '严重磨损', '磨损', '完好'][conditionIndex];
  return {
    id,
    name: `${conditionLabel}${profile.name}`,
    kind: 'armor',
    rarity: profile.rarities[conditionIndex],
    value: profile.values[conditionIndex],
    quantity: 1,
    durability: safeDurability,
    maxDurability: safeMax,
    equipmentSlot: 'armor',
    description: `${profile.name}，耐久 ${safeDurability}/${safeMax}。带出后可在交易行回收。`,
  };
}

/**
 * Returns corpse equipment in the same order as the three equipment slots in the loot UI.
 */
export function createRecoveredEnemyEquipment(
  baseId: string,
  armorClass: EnemyArmorClass,
  weaponId: RecoveredEnemyWeaponId,
  armorDurability: number,
  armorMaxDurability: number,
): InventoryItem[] {
  const helmet = HELMET_PROFILES[armorClass];
  const weapon = WEAPON_PROFILES[weaponId];
  return [
    {
      id: `${baseId}-helmet`,
      name: helmet.name,
      kind: 'helmet',
      rarity: helmet.rarity,
      value: helmet.value,
      quantity: 1,
      equipmentSlot: 'helmet',
      description: `${helmet.name}，从敌方目标身上回收，可带出行动并在交易行出售。`,
    },
    createRecoveredArmorLoot(
      `${baseId}-armor`,
      armorClass,
      armorDurability,
      armorMaxDurability,
    ),
    {
      id: `${baseId}-weapon`,
      name: `${WEAPON_PREFIXES[armorClass]}${weapon.name}`,
      kind: 'weapon',
      rarity: WEAPON_RARITIES[armorClass],
      value: weapon.values[armorClass],
      quantity: 1,
      variant: weaponId,
      equipmentSlot: 'weapon',
      description: `${weapon.name}，从敌方目标身上回收，可带出行动并在交易行出售。`,
    },
  ];
}
