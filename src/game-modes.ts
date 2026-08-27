export type GameModeId =
  | 'extraction'
  | 'clear'
  | 'survival'
  | 'intel'
  | 'night'
  | 'zero'
  | 'boss-hunt'
  | 'random-extract'
  | 'escort'
  | 'red-zone'
  | 'continuous'
  | 'weapon-lock';

export type ModeWeaponId = 'rifle' | 'smg' | 'shotgun' | 'asval' | 'awm' | 'm7';

export interface GameModeDefinition {
  id: GameModeId;
  name: string;
  description: string;
  timeLimit: number;
  enemyMultiplier: number;
  lootBoosts: number;
  visionMultiplier: number;
  hearingMultiplier: number;
  movementMultiplier: number;
  allowedWeapons?: readonly ModeWeaponId[];
}

export const GAME_MODE_DEFINITIONS: Readonly<Record<GameModeId, GameModeDefinition>> = {
  extraction: { id: 'extraction', name: '标准撤离', description: '击败区域首领，取得任务物品后撤离。', timeLimit: 1200, enemyMultiplier: 1, lootBoosts: 0, visionMultiplier: 1, hearingMultiplier: 1, movementMultiplier: 1 },
  clear: { id: 'clear', name: '热区清剿', description: '清空区域内全部敌人，再进入撤离区。', timeLimit: 1200, enemyMultiplier: 1, lootBoosts: 0, visionMultiplier: 1, hearingMultiplier: 1, movementMultiplier: 1 },
  survival: { id: 'survival', name: '计时突围', description: '在持续搜索中坚守 120 秒，再前往撤离。', timeLimit: 1200, enemyMultiplier: 1, lootBoosts: 0, visionMultiplier: 1, hearingMultiplier: 1, movementMultiplier: 1 },
  intel: { id: 'intel', name: '情报回收', description: '搜集 3 件情报物资后撤离。', timeLimit: 1200, enemyMultiplier: 1, lootBoosts: 0, visionMultiplier: 1, hearingMultiplier: 1, movementMultiplier: 1 },
  night: { id: 'night', name: '夜战潜入', description: '低能见度行动。N 切换夜视，敌人更依赖枪声和脚步声。', timeLimit: 1200, enemyMultiplier: 1, lootBoosts: 0, visionMultiplier: 0.38, hearingMultiplier: 1.65, movementMultiplier: 1 },
  zero: { id: 'zero', name: '零装突袭', description: '无护甲、补给和武器入场，必须在局内寻找装备。', timeLimit: 1200, enemyMultiplier: 1, lootBoosts: 1, visionMultiplier: 1, hearingMultiplier: 1, movementMultiplier: 1 },
  'boss-hunt': { id: 'boss-hunt', name: '首领追猎', description: '追踪移动首领，击败后回收专属红色物品。', timeLimit: 1200, enemyMultiplier: 1, lootBoosts: 1, visionMultiplier: 1, hearingMultiplier: 1, movementMultiplier: 1 },
  'random-extract': { id: 'random-extract', name: '随机撤离', description: '撤离坐标开局隐藏，找到地图情报后才会显示。', timeLimit: 1200, enemyMultiplier: 1, lootBoosts: 0, visionMultiplier: 1, hearingMultiplier: 1, movementMultiplier: 1 },
  escort: { id: 'escort', name: '高价值押运', description: '手持任务货箱撤离，无法开枪且移动速度下降。', timeLimit: 1200, enemyMultiplier: 1, lootBoosts: 1, visionMultiplier: 1, hearingMultiplier: 1, movementMultiplier: 0.68 },
  'red-zone': { id: 'red-zone', name: '红区封锁', description: '敌人更多、物资更好，但撤离窗口仍为 20 分钟。', timeLimit: 1200, enemyMultiplier: 1.55, lootBoosts: 2, visionMultiplier: 1.08, hearingMultiplier: 1.15, movementMultiplier: 1 },
  continuous: { id: 'continuous', name: '连续行动', description: '连续完成三张地图，生命、护甲、药品、弹药和战利品全部继承。', timeLimit: 1200, enemyMultiplier: 1, lootBoosts: 1, visionMultiplier: 1, hearingMultiplier: 1, movementMultiplier: 1 },
  'weapon-lock': { id: 'weapon-lock', name: '武器限定', description: '本局只能使用 V9、SG-12 或 AWM。', timeLimit: 1200, enemyMultiplier: 1, lootBoosts: 1, visionMultiplier: 1, hearingMultiplier: 1, movementMultiplier: 1, allowedWeapons: ['smg', 'shotgun', 'awm'] },
};

export const GAME_MODE_IDS = Object.keys(GAME_MODE_DEFINITIONS) as GameModeId[];

export function gameModeDefinition(id: GameModeId): GameModeDefinition {
  return GAME_MODE_DEFINITIONS[id] ?? GAME_MODE_DEFINITIONS.extraction;
}

export function isObjectiveCarryMode(id: GameModeId): boolean {
  return ['extraction', 'night', 'zero', 'random-extract', 'escort', 'red-zone', 'continuous', 'weapon-lock'].includes(id);
}

export function isWeaponAllowed(id: GameModeId, weapon: ModeWeaponId): boolean {
  const allowed = GAME_MODE_DEFINITIONS[id].allowedWeapons;
  return !allowed || allowed.includes(weapon);
}
