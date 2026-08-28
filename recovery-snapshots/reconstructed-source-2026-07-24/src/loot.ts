import type { InventoryItem, ItemKind, ItemRarity } from './types';

interface LootBlueprint {
  key: string;
  name: string;
  kind: ItemKind;
  rarity: ItemRarity;
  value: number;
}

export interface LootCatalogItem extends InventoryItem {
  variant: string;
  origin: string;
  description: string;
}

const BLUEPRINTS: LootBlueprint[] = [
  { key: 'scrap', name: '拆机零件包', kind: 'supplies', rarity: 'black', value: 45 },
  { key: 'battery', name: '旧式电池组', kind: 'electronics', rarity: 'black', value: 70 },
  { key: 'wire', name: '工业铜线卷', kind: 'supplies', rarity: 'black', value: 92 },
  { key: 'filter', name: '污染滤芯', kind: 'supplies', rarity: 'black', value: 115 },
  { key: 'bandage', name: '野战绷带包', kind: 'medical', rarity: 'black', value: 135 },
  { key: 'stamina-injector', name: '战术体力针', kind: 'medical', rarity: 'green', value: 980 },
  { key: 'adrenaline-injector', name: '肾上腺素注射针', kind: 'medical', rarity: 'blue', value: 2100 },
  { key: 'nutrition-gel', name: '高能营养凝胶', kind: 'supplies', rarity: 'white', value: 260 },
  { key: 'field-meal', name: '战地恢复餐', kind: 'supplies', rarity: 'green', value: 760 },
  { key: 'ration', name: '密封军粮盒', kind: 'supplies', rarity: 'white', value: 180 },
  { key: 'fuse', name: '高压保险管', kind: 'supplies', rarity: 'white', value: 220 },
  { key: 'medkit', name: '止血处理套件', kind: 'medical', rarity: 'white', value: 280 },
  { key: 'memory', name: '旧存储模块', kind: 'electronics', rarity: 'white', value: 320 },
  { key: 'map', name: '区域测绘底图', kind: 'intel', rarity: 'white', value: 360 },
  { key: 'fuel', name: '精炼燃料样本', kind: 'supplies', rarity: 'white', value: 410 },
  { key: 'weapon-parts', name: '制式枪械零件', kind: 'supplies', rarity: 'green', value: 520 },
  { key: 'optic-mount', name: '通用瞄具座', kind: 'supplies', rarity: 'green', value: 590 },
  { key: 'rations', name: '高能压缩口粮', kind: 'supplies', rarity: 'green', value: 670 },
  { key: 'field-med', name: '战地止痛针组', kind: 'medical', rarity: 'green', value: 740 },
  { key: 'relay', name: '短波中继板', kind: 'electronics', rarity: 'green', value: 820 },
  { key: 'seal', name: '水利密封组件', kind: 'supplies', rarity: 'green', value: 940 },
  { key: 'tool-kit', name: '精密工具组', kind: 'supplies', rarity: 'blue', value: 1080 },
  { key: 'radio', name: '加密通信模块', kind: 'electronics', rarity: 'blue', value: 1260 },
  { key: 'drone-part', name: '无人机控制单元', kind: 'electronics', rarity: 'blue', value: 1420 },
  { key: 'rangefinder', name: '激光测距组件', kind: 'electronics', rarity: 'blue', value: 1560 },
  { key: 'access-log', name: '权限审计日志', kind: 'intel', rarity: 'blue', value: 1710 },
  { key: 'coolant', name: '反应堆冷却阀', kind: 'supplies', rarity: 'blue', value: 1880 },
  { key: 'trauma-kit', name: '创伤急救模块', kind: 'medical', rarity: 'blue', value: 1960 },
  { key: 'night-optics', name: '夜视光学组件', kind: 'electronics', rarity: 'purple', value: 2240 },
  { key: 'thermal-sensor', name: '热源传感器', kind: 'electronics', rarity: 'purple', value: 2580 },
  { key: 'command-drive', name: '指挥链存储盘', kind: 'intel', rarity: 'purple', value: 2920 },
  { key: 'crypto-key', name: '区域加密密钥', kind: 'intel', rarity: 'purple', value: 3260 },
  { key: 'prototype-valve', name: '原型水压阀', kind: 'supplies', rarity: 'purple', value: 3580 },
  { key: 'coagulant', name: '军用凝血注射组', kind: 'medical', rarity: 'purple', value: 3720 },
  { key: 'thermal-core', name: '热成像核心', kind: 'electronics', rarity: 'gold', value: 4400 },
  { key: 'access-token', name: '高级访问令牌', kind: 'intel', rarity: 'gold', value: 5600 },
  { key: 'aerospace-alloy', name: '航空级钛合金', kind: 'supplies', rarity: 'gold', value: 6800 },
  { key: 'reactor-key', name: '反应堆主控钥匙', kind: 'intel', rarity: 'gold', value: 7900 },
  { key: 'surgical-system', name: '便携手术维生系统', kind: 'medical', rarity: 'gold', value: 8400 },
  { key: 'quantum-chip', name: '实验型量子芯片', kind: 'electronics', rarity: 'red', value: 12800 },
  { key: 'black-ledger', name: '绝密行动账本', kind: 'intel', rarity: 'red', value: 16800 },
  { key: 'central-key', name: '中央数据库母钥', kind: 'intel', rarity: 'red', value: 19800 },
  { key: 'prototype-core', name: '未公开原型核心', kind: 'electronics', rarity: 'red', value: 24200 },
  { key: 'regen-sample', name: '实验型再生医疗样本', kind: 'medical', rarity: 'red', value: 26800 },
  { key: 'signal-decoder', name: '便携信号解码器', kind: 'intel', rarity: 'purple', value: 4100 },
  { key: 'black-box', name: '失事无人机黑匣', kind: 'electronics', rarity: 'gold', value: 9300 },
  { key: 'command-seal', name: '战区指挥密印', kind: 'intel', rarity: 'red', value: 22400 },
];

const ORIGINS = [
  '北岭水务', '赤湾工程', '九号物流', '长风通信', '玄武安保', '白塔实验室',
  '灰港军械', '临川测绘', '远山能源', '黑峡调度', '鸢尾数据', '无标记批次',
];

const VARIANTS = ['封存版', '军规版', '改装版'];
/** 经济平衡：所有可搜刮目录物资价值统一提高 7 倍。 */
export const LOOT_VALUE_MULTIPLIER = 7;

function backpackShape(_rarity: ItemRarity, _kind: ItemKind, key: string): { slotWidth: number; slotHeight: number } {
  // 参考搜打撤常见设计：尺寸由物品体积决定，不按稀有度一刀切。
  const footprints: Record<string, [number, number]> = {
    'quantum-chip': [1, 1], 'black-ledger': [1, 2], 'central-key': [2, 1],
    'prototype-core': [2, 2], 'regen-sample': [1, 2], 'command-seal': [1, 1],
    'thermal-core': [1, 1], 'access-token': [1, 2], 'aerospace-alloy': [2, 1],
    'reactor-key': [1, 1], 'surgical-system': [2, 2], 'black-box': [2, 1],
    'night-optics': [1, 2], 'thermal-sensor': [1, 1], 'command-drive': [2, 1],
    'crypto-key': [1, 1], 'prototype-valve': [2, 1], 'coagulant': [1, 2],
    'adrenaline-injector': [1, 1], 'stamina-injector': [1, 1], 'medkit': [1, 2],
  };
  const footprint = footprints[key];
  if (footprint) return { slotWidth: footprint[0], slotHeight: footprint[1] };
  return { slotWidth: 1, slotHeight: 1 };
}

export const LOOT_CATALOG: LootCatalogItem[] = BLUEPRINTS.flatMap((blueprint) =>
  ORIGINS.flatMap((origin, originIndex) =>
    VARIANTS.map((variant, variantIndex) => {
      const multiplier = 0.86 + originIndex * 0.018 + variantIndex * 0.065;
      const shape = backpackShape(blueprint.rarity, blueprint.kind, blueprint.key);
      const slotCount = shape.slotWidth * shape.slotHeight;
      const serial = `${String(originIndex + 1).padStart(2, '0')}-${String(variantIndex + 1).padStart(2, '0')}`;
      const name = `「${origin}」${blueprint.name} · ${variant} ${serial}`;
      return {
        id: `loot-${blueprint.key}-${originIndex + 1}-${variantIndex + 1}`,
        name,
        kind: blueprint.kind,
        rarity: blueprint.rarity,
        value: Math.round(blueprint.value * multiplier * LOOT_VALUE_MULTIPLIER * slotCount),
        quantity: 1,
        ...shape,
        variant: `${origin} / ${variant} / 批次 ${serial}`,
        origin,
        description: `${name}，来自${origin}的${variant}物资。批次状态会影响回收估值。`,
      } satisfies LootCatalogItem;
    }),
  ),
);

export const LOOT_CATALOG_SIZE = LOOT_CATALOG.length;

export const LOOT_POOLS: Record<ItemRarity, LootCatalogItem[]> = {
  black: LOOT_CATALOG.filter((item) => item.rarity === 'black'),
  white: LOOT_CATALOG.filter((item) => item.rarity === 'white'),
  green: LOOT_CATALOG.filter((item) => item.rarity === 'green'),
  blue: LOOT_CATALOG.filter((item) => item.rarity === 'blue'),
  purple: LOOT_CATALOG.filter((item) => item.rarity === 'purple'),
  gold: LOOT_CATALOG.filter((item) => item.rarity === 'gold'),
  red: LOOT_CATALOG.filter((item) => item.rarity === 'red'),
};

export const CONTAINER_KIND_AFFINITY: Record<string, readonly ItemKind[]> = {
  bag: ['supplies', 'medical', 'electronics', 'intel'],
  briefcase: ['intel', 'electronics'],
  toolbox: ['supplies', 'electronics'],
  medical: ['medical'],
  computer: ['electronics', 'intel'],
  server: ['electronics', 'intel'],
  ammo: ['supplies'],
  locker: ['supplies', 'medical'],
  case: ['supplies', 'electronics', 'medical'],
  military: ['supplies', 'electronics', 'medical'],
  weapon: ['supplies', 'electronics'],
  safe: ['intel', 'electronics'],
  hidden: ['intel', 'electronics', 'medical', 'supplies'],
  vault: ['intel', 'electronics'],
};

export function lootPoolForContainer(container: string, rarity: ItemRarity): LootCatalogItem[] {
  const kinds = CONTAINER_KIND_AFFINITY[container];
  if (!kinds) return LOOT_POOLS[rarity];
  const preferred = LOOT_POOLS[rarity].filter((item) => kinds.includes(item.kind));
  return preferred.length > 0 ? preferred : LOOT_POOLS[rarity];
}
