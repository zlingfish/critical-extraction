import type { ItemRarity, PersistentProfile, WeaponBuildEffects, WeaponModSlot } from './types';

export type GunsmithWeaponId = 'rifle' | 'smg' | 'shotgun' | 'asval' | 'awm' | 'm7';

export interface WeaponModification {
  id: string;
  name: string;
  slot: WeaponModSlot;
  rarity: ItemRarity;
  price: number;
  description: string;
  effects: Partial<WeaponBuildEffects>;
}

export const GUNSMITH_WEAPONS: Array<{ id: GunsmithWeaponId; name: string; shortName: string }> = [
  { id: 'rifle', name: 'KR-56 突击步枪', shortName: 'KR-56' },
  { id: 'smg', name: 'V9 冲锋枪', shortName: 'V9' },
  { id: 'shotgun', name: 'SG-12 战术霰弹枪', shortName: 'SG-12' },
  { id: 'asval', name: 'AS VAL 微声步枪', shortName: 'AS VAL' },
  { id: 'awm', name: 'AWM 精密狙击步枪', shortName: 'AWM' },
  { id: 'm7', name: 'M7 战斗步枪', shortName: 'M7' },
];

export const WEAPON_MOD_SLOTS: Array<{ id: WeaponModSlot; label: string; mark: string }> = [
  { id: 'muzzle', label: '枪口', mark: 'MZ' },
  { id: 'optic', label: '瞄具', mark: 'OP' },
  { id: 'handguard', label: '护木', mark: 'HG' },
  { id: 'grip', label: '前握把', mark: 'GR' },
  { id: 'stock', label: '枪托', mark: 'ST' },
  { id: 'magazine', label: '弹匣', mark: 'MG' },
];

export const WEAPON_MODIFICATIONS: WeaponModification[] = [
  { id: 'muzzle-patrol-brake', name: '巡逻制退器', slot: 'muzzle', rarity: 'green', price: 900, description: '基础制退结构，略微压低枪口跳动。', effects: { recoilMultiplier: 0.94, noiseMultiplier: 1.06 } },
  { id: 'muzzle-vector-comp', name: '矢量补偿器', slot: 'muzzle', rarity: 'blue', price: 2200, description: '重新分配火药气体，提升连续射击稳定性。', effects: { recoilMultiplier: 0.86, spreadMultiplier: 0.97, noiseMultiplier: 1.08 } },
  { id: 'muzzle-ghost-suppressor', name: '幽影抑制器', slot: 'muzzle', rarity: 'purple', price: 4300, description: '大幅降低枪声传播距离，并提供少量控制。', effects: { recoilMultiplier: 0.93, noiseMultiplier: 0.48 } },
  { id: 'muzzle-kraken-brake', name: '海怪重型制退器', slot: 'muzzle', rarity: 'gold', price: 6900, description: '重型多室制退器，强力控制后坐力。', effects: { recoilMultiplier: 0.76, spreadMultiplier: 0.94, noiseMultiplier: 1.16 } },
  { id: 'muzzle-apex-hybrid', name: '顶点复合枪口', slot: 'muzzle', rarity: 'red', price: 9400, description: '高级复合结构，兼顾隐蔽性与控制力。', effects: { recoilMultiplier: 0.72, spreadMultiplier: 0.91, noiseMultiplier: 0.72 } },

  { id: 'optic-reflex-1x', name: '萤火 1 倍反射镜', slot: 'optic', rarity: 'green', price: 800, description: '开阔视野，适合近距离快速瞄准。', effects: { aimFovDelta: 4, spreadMultiplier: 0.98 } },
  { id: 'optic-holo-2x', name: '堡垒 2 倍全息镜', slot: 'optic', rarity: 'blue', price: 1900, description: '清晰准点与适中倍率，兼顾室内外。', effects: { aimFovDelta: -3, spreadMultiplier: 0.95 } },
  { id: 'optic-ranger-3x', name: '游骑兵 3 倍镜', slot: 'optic', rarity: 'purple', price: 3700, description: '中距离识别镜组，提升瞄准射击精度。', effects: { aimFovDelta: -9, spreadMultiplier: 0.9 } },
  { id: 'optic-falcon-5x', name: '猎隼 5 倍镜', slot: 'optic', rarity: 'gold', price: 6200, description: '高倍率精密镜组，适合远距离压制。', effects: { aimFovDelta: -15, spreadMultiplier: 0.84 } },
  { id: 'optic-oracle-hybrid', name: '先知可变倍率镜', slot: 'optic', rarity: 'red', price: 9600, description: '高透镜片与数字修正模块，提供最高精度。', effects: { aimFovDelta: -12, spreadMultiplier: 0.78 } },

  { id: 'handguard-light-rail', name: '轻量导轨护木', slot: 'handguard', rarity: 'green', price: 1000, description: '轻量化导轨改善持枪响应。', effects: { reloadMultiplier: 0.97, recoilMultiplier: 0.97 } },
  { id: 'handguard-ridge-mk2', name: '山脊 MK2 护木', slot: 'handguard', rarity: 'blue', price: 2400, description: '刚性护木减少枪管摆动。', effects: { recoilMultiplier: 0.92, spreadMultiplier: 0.95 } },
  { id: 'handguard-carbon-float', name: '碳纤自由浮置护木', slot: 'handguard', rarity: 'purple', price: 4500, description: '隔离枪管受力并控制整体重量。', effects: { recoilMultiplier: 0.88, spreadMultiplier: 0.9, reloadMultiplier: 0.96 } },
  { id: 'handguard-titan-rail', name: '泰坦全长导轨', slot: 'handguard', rarity: 'gold', price: 6800, description: '重型一体导轨带来极高结构稳定性。', effects: { recoilMultiplier: 0.81, spreadMultiplier: 0.88, reloadMultiplier: 1.04 } },
  { id: 'handguard-zero-platform', name: '零点改装平台', slot: 'handguard', rarity: 'red', price: 9200, description: '高规格一体平台，全面提升射击控制。', effects: { recoilMultiplier: 0.76, spreadMultiplier: 0.83 } },

  { id: 'grip-compact-angle', name: '紧凑斜角握把', slot: 'grip', rarity: 'green', price: 850, description: '改善短距离转移与抵肩速度。', effects: { recoilMultiplier: 0.96, spreadMultiplier: 0.97 } },
  { id: 'grip-vertical-v2', name: 'V2 垂直握把', slot: 'grip', rarity: 'blue', price: 2100, description: '直接抑制垂直后坐力。', effects: { recoilMultiplier: 0.87 } },
  { id: 'grip-phantom-stop', name: '幻影手止', slot: 'grip', rarity: 'purple', price: 3900, description: '低轮廓手止兼顾精度和操控。', effects: { recoilMultiplier: 0.9, spreadMultiplier: 0.88, reloadMultiplier: 0.97 } },
  { id: 'grip-anchor-heavy', name: '锚点重型握把', slot: 'grip', rarity: 'gold', price: 6400, description: '牺牲少量操作速度换取极强稳定性。', effects: { recoilMultiplier: 0.75, reloadMultiplier: 1.05 } },
  { id: 'grip-vector-active', name: '矢量主动稳定握把', slot: 'grip', rarity: 'red', price: 9300, description: '主动阻尼结构同时控制后坐与散布。', effects: { recoilMultiplier: 0.7, spreadMultiplier: 0.84 } },

  { id: 'stock-scout-light', name: '侦察轻型枪托', slot: 'stock', rarity: 'green', price: 950, description: '轻量枪托提升操作和换弹速度。', effects: { reloadMultiplier: 0.94, recoilMultiplier: 0.98 } },
  { id: 'stock-brace-mk3', name: '支点 MK3 枪托', slot: 'stock', rarity: 'blue', price: 2300, description: '加强抵肩结构，稳定连续射击。', effects: { recoilMultiplier: 0.89, spreadMultiplier: 0.97 } },
  { id: 'stock-marksman', name: '射手精调枪托', slot: 'stock', rarity: 'purple', price: 4200, description: '可调托腮与尾垫提高瞄准稳定。', effects: { recoilMultiplier: 0.84, spreadMultiplier: 0.9 } },
  { id: 'stock-bulwark', name: '壁垒重型枪托', slot: 'stock', rarity: 'gold', price: 6700, description: '重型缓冲机构显著削弱后坐力。', effects: { recoilMultiplier: 0.73, reloadMultiplier: 1.06 } },
  { id: 'stock-adaptive-x', name: '自适应 X 枪托', slot: 'stock', rarity: 'red', price: 9500, description: '自适应缓冲与高强度骨架兼顾各项性能。', effects: { recoilMultiplier: 0.68, spreadMultiplier: 0.87, reloadMultiplier: 0.96 } },

  { id: 'mag-quick-plate', name: '快拔弹匣底板', slot: 'magazine', rarity: 'green', price: 1100, description: '改善抓取位置，小幅缩短换弹。', effects: { reloadMultiplier: 0.86, reserveBonus: 10 } },
  { id: 'mag-extended', name: '扩容弹匣', slot: 'magazine', rarity: 'blue', price: 2600, description: '增加弹匣与备弹容量，换弹略慢。', effects: { magazineBonus: 8, reserveBonus: 20, reloadMultiplier: 1.08 } },
  { id: 'mag-fast-extended', name: '竞赛扩容快弹匣', slot: 'magazine', rarity: 'purple', price: 4700, description: '兼顾扩容和快速换弹。', effects: { magazineBonus: 10, reserveBonus: 30, reloadMultiplier: 0.9 } },
  { id: 'mag-drum', name: '高容量弹鼓', slot: 'magazine', rarity: 'gold', price: 7200, description: '大幅提升持续火力，但换弹和操控更慢。', effects: { magazineBonus: 22, reserveBonus: 45, reloadMultiplier: 1.24, recoilMultiplier: 1.06 } },
  { id: 'mag-adaptive-feed', name: '自适应供弹模块', slot: 'magazine', rarity: 'red', price: 9600, description: '高可靠供弹系统，容量与换弹速度全面提升。', effects: { magazineBonus: 16, reserveBonus: 50, reloadMultiplier: 0.82 } },
];

export const DEFAULT_WEAPON_BUILD_EFFECTS: WeaponBuildEffects = {
  recoilMultiplier: 1,
  spreadMultiplier: 1,
  reloadMultiplier: 1,
  noiseMultiplier: 1,
  magazineBonus: 0,
  reserveBonus: 0,
  aimFovDelta: 0,
};

export function weaponModificationPrice(profile: PersistentProfile, modification: WeaponModification): number {
  const workshopLevel = profile.facilityLevels.workshop ?? 1;
  const discount = Math.min(0.1, Math.max(0, workshopLevel - 1) * 0.05);
  return Math.round(modification.price * (1 - discount));
}

export function resolveWeaponBuild(profile: PersistentProfile, weaponId: GunsmithWeaponId): WeaponBuildEffects {
  const build = profile.weaponBuilds[weaponId] ?? {};
  const result = { ...DEFAULT_WEAPON_BUILD_EFFECTS };
  for (const modificationId of Object.values(build)) {
    const modification = WEAPON_MODIFICATIONS.find((entry) => entry.id === modificationId);
    if (!modification) continue;
    const effects = modification.effects;
    result.recoilMultiplier *= effects.recoilMultiplier ?? 1;
    result.spreadMultiplier *= effects.spreadMultiplier ?? 1;
    result.reloadMultiplier *= effects.reloadMultiplier ?? 1;
    result.noiseMultiplier *= effects.noiseMultiplier ?? 1;
    result.magazineBonus += effects.magazineBonus ?? 0;
    result.reserveBonus += effects.reserveBonus ?? 0;
    result.aimFovDelta += effects.aimFovDelta ?? 0;
  }
  return result;
}

export function resolveAllWeaponBuilds(profile: PersistentProfile): Record<GunsmithWeaponId, WeaponBuildEffects> {
  return Object.fromEntries(GUNSMITH_WEAPONS.map((weapon) => [weapon.id, resolveWeaponBuild(profile, weapon.id)])) as Record<GunsmithWeaponId, WeaponBuildEffects>;
}
