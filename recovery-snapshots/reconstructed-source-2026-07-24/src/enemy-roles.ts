import type { EnemyDifficultyId, EnemyWeaponId } from './enemy-ai';

/** 敌人职业。职业只描述玩法差异，不绑定 Three.js 或游戏实体。 */
export type EnemyRoleId = 'standard' | 'medic' | 'shield' | 'sniper' | 'assault' | 'captain';

export type EnemyRoleMarker = 'dot' | 'medical' | 'shield' | 'scope' | 'chevron' | 'star';
export type EnemyCombatDistance = 'close' | 'medium' | 'long';

export interface EnemyRoleConfig {
  id: EnemyRoleId;
  label: string;
  health: number;
  armor: number;
  speed: number;
  visionRange: number;
  weaponPreference: readonly EnemyWeaponId[];
  preferredDistance: readonly [number, number];
  marker: EnemyRoleMarker;
  color: string;
  description: string;
}

/**
 * 职业基础数值。速度单位为米/秒，视距和交战距离单位为米。
 * 这些是角色初始值，难度调节仍由 enemy-ai.ts 的行为配置负责。
 */
export const ENEMY_ROLE_CONFIGS: Readonly<Record<EnemyRoleId, EnemyRoleConfig>> = {
  standard: {
    id: 'standard', label: '普通步兵', health: 100, armor: 20, speed: 3.1, visionRange: 28,
    weaponPreference: ['smg', 'shotgun'], preferredDistance: [8, 24], marker: 'dot', color: '#596552',
    description: '装备均衡，负责守卫和巡逻。',
  },
  medic: {
    id: 'medic', label: '医疗兵', health: 88, armor: 16, speed: 3.2, visionRange: 31,
    weaponPreference: ['smg'], preferredDistance: [7, 22], marker: 'medical', color: '#4d7865',
    description: '优先救治受伤队友，避免独自冲锋。',
  },
  shield: {
    id: 'shield', label: '盾牌兵', health: 150, armor: 55, speed: 2.25, visionRange: 25,
    weaponPreference: ['shotgun'], preferredDistance: [4, 16], marker: 'shield', color: '#42627a',
    description: '正面持盾推进，绕到侧后方更容易击破。',
  },
  sniper: {
    id: 'sniper', label: '狙击手', health: 82, armor: 12, speed: 2.55, visionRange: 68,
    weaponPreference: ['sniper'], preferredDistance: [27, 58], marker: 'scope', color: '#4c5d4e',
    description: '保持远距离，发现目标后优先寻找高处和掩体。',
  },
  assault: {
    id: 'assault', label: '冲锋兵', health: 112, armor: 24, speed: 4.35, visionRange: 27,
    weaponPreference: ['smg', 'shotgun'], preferredDistance: [3, 14], marker: 'chevron', color: '#7e6047',
    description: '擅长近距离压迫，会主动缩短与目标的距离。',
  },
  captain: {
    id: 'captain', label: '队长', health: 178, armor: 42, speed: 3.2, visionRange: 42,
    weaponPreference: ['smg'], preferredDistance: [10, 30], marker: 'star', color: '#8a6b2d',
    description: '带队作战，满足条件时会呼叫支援。',
  },
};

const ROLE_PATTERNS: Readonly<Record<EnemyDifficultyId, readonly EnemyRoleId[]>> = {
  recruit: ['standard', 'standard', 'medic', 'assault', 'standard', 'shield', 'standard', 'sniper'],
  standard: ['standard', 'medic', 'shield', 'assault', 'sniper', 'assault', 'captain', 'standard', 'medic', 'assault'],
  veteran: ['assault', 'medic', 'shield', 'sniper', 'captain', 'assault', 'sniper', 'shield', 'captain', 'assault'],
};

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** 根据敌人序号和难度稳定分配职业，同样输入永远得到同样结果。 */
export function selectEnemyRole(enemyIndex: number, difficulty: EnemyDifficultyId = 'standard'): EnemyRoleId {
  const pattern = ROLE_PATTERNS[difficulty];
  const normalizedIndex = Number.isFinite(enemyIndex) ? Math.trunc(enemyIndex) : 0;
  return pattern[positiveModulo(normalizedIndex, pattern.length)];
}

/** selectEnemyRole 的语义化别名，方便实体生成代码阅读。 */
export const getEnemyRoleForIndex = selectEnemyRole;

export function getEnemyRoleConfig(role: EnemyRoleId): EnemyRoleConfig {
  return ENEMY_ROLE_CONFIGS[role];
}

export interface MedicHealInput {
  medicAlive: boolean;
  allyAlive?: boolean;
  allyHealth: number;
  allyMaxHealth?: number;
  distance: number;
  now?: number;
  lastHealAt?: number;
  cooldown?: number;
  healAmount?: number;
}

export type MedicHealFailureReason = 'medic_dead' | 'ally_dead' | 'out_of_range' | 'target_full' | 'cooldown';

export interface MedicHealResult {
  canHeal: boolean;
  healedAmount: number;
  allyHealth: number;
  nextHealAt: number;
  reason: 'ready' | MedicHealFailureReason;
}

export const MEDIC_HEAL_RANGE = 14;
export const MEDIC_HEAL_COOLDOWN = 8;
export const MEDIC_HEAL_AMOUNT = 24;

/** 计算医疗兵是否能治疗，以及治疗后的生命值；不修改任何游戏状态。 */
export function calculateMedicHeal(input: MedicHealInput): MedicHealResult {
  const now = input.now ?? 0;
  const lastHealAt = input.lastHealAt ?? Number.NEGATIVE_INFINITY;
  const cooldown = Math.max(0, input.cooldown ?? MEDIC_HEAL_COOLDOWN);
  const maxHealth = Math.max(1, input.allyMaxHealth ?? 100);
  const currentHealth = Math.max(0, Math.min(maxHealth, input.allyHealth));
  const nextHealAt = lastHealAt + cooldown;
  const fail = (reason: MedicHealFailureReason): MedicHealResult => ({
    canHeal: false, healedAmount: 0, allyHealth: currentHealth, nextHealAt, reason,
  });

  if (!input.medicAlive) return fail('medic_dead');
  if (input.allyAlive === false || currentHealth <= 0) return fail('ally_dead');
  if (!Number.isFinite(input.distance) || input.distance > MEDIC_HEAL_RANGE) return fail('out_of_range');
  if (currentHealth >= maxHealth) return fail('target_full');
  if (now < nextHealAt) return fail('cooldown');

  const amount = Math.max(0, input.healAmount ?? MEDIC_HEAL_AMOUNT);
  const healedAmount = Math.min(amount, maxHealth - currentHealth);
  return {
    canHeal: healedAmount > 0,
    healedAmount,
    allyHealth: currentHealth + healedAmount,
    nextHealAt: now + cooldown,
    reason: healedAmount > 0 ? 'ready' : 'target_full',
  };
}

export function medicCanHeal(input: MedicHealInput): boolean {
  return calculateMedicHeal(input).canHeal;
}

export interface CaptainSupportInput {
  captainAlive: boolean;
  now?: number;
  lastCalledAt?: number;
  cooldown?: number;
  nearbyThreats?: number;
  minimumThreats?: number;
  playerVisible?: boolean;
  supportAlreadyActive?: boolean;
}

export type CaptainSupportFailureReason = 'captain_dead' | 'support_active' | 'cooldown' | 'no_threat';

export interface CaptainSupportResult {
  canCall: boolean;
  nextReadyAt: number;
  reason: 'ready' | CaptainSupportFailureReason;
}

export const CAPTAIN_SUPPORT_COOLDOWN = 45;
export const CAPTAIN_SUPPORT_MIN_THREATS = 2;

/** 队长只在活着、没有现存支援且确实发现威胁时呼叫支援。 */
export function getCaptainSupportResult(input: CaptainSupportInput): CaptainSupportResult {
  const now = input.now ?? 0;
  const lastCalledAt = input.lastCalledAt ?? Number.NEGATIVE_INFINITY;
  const cooldown = Math.max(0, input.cooldown ?? CAPTAIN_SUPPORT_COOLDOWN);
  const nextReadyAt = lastCalledAt + cooldown;
  const fail = (reason: CaptainSupportFailureReason): CaptainSupportResult => ({
    canCall: false, nextReadyAt, reason,
  });

  if (!input.captainAlive) return fail('captain_dead');
  if (input.supportAlreadyActive) return fail('support_active');
  if (now < nextReadyAt) return fail('cooldown');
  const threats = Math.max(0, input.nearbyThreats ?? 0);
  const minimumThreats = Math.max(1, input.minimumThreats ?? CAPTAIN_SUPPORT_MIN_THREATS);
  if (!input.playerVisible && threats < minimumThreats) return fail('no_threat');
  return { canCall: true, nextReadyAt: now + cooldown, reason: 'ready' };
}

export function canCaptainCallSupport(input: CaptainSupportInput): boolean {
  return getCaptainSupportResult(input).canCall;
}

export interface ShieldHitInput {
  /** 从盾牌指向攻击者的方向；也接受 attackerDirection 这个更直白的别名。 */
  hitDirection?: Vector3Like;
  attackerDirection?: Vector3Like;
  shieldForward: Vector3Like;
  frontalArcDegrees?: number;
  shieldRaised?: boolean;
}

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export const SHIELD_FRONTAL_ARC_DEGREES = 120;
export const SHIELD_FRONTAL_DAMAGE_MULTIPLIER = 0.2;

function normalizedDot(a: Vector3Like, b: Vector3Like): number {
  const aLength = Math.hypot(a.x, a.y, a.z);
  const bLength = Math.hypot(b.x, b.y, b.z);
  if (aLength <= Number.EPSILON || bLength <= Number.EPSILON) return -1;
  return (a.x * b.x + a.y * b.y + a.z * b.z) / (aLength * bLength);
}

export function isShieldFrontalHit(input: ShieldHitInput): boolean {
  if (input.shieldRaised === false) return false;
  const direction = input.attackerDirection ?? input.hitDirection;
  if (!direction) return false;
  const arc = Math.max(0, Math.min(360, input.frontalArcDegrees ?? SHIELD_FRONTAL_ARC_DEGREES));
  return normalizedDot(direction, input.shieldForward) >= Math.cos((arc * Math.PI) / 360);
}

export function getShieldDamageMultiplier(input: ShieldHitInput): number {
  return isShieldFrontalHit(input) ? SHIELD_FRONTAL_DAMAGE_MULTIPLIER : 1;
}

export function applyShieldDamageReduction(damage: number, input: ShieldHitInput): number {
  return Math.max(0, damage) * getShieldDamageMultiplier(input);
}

export function getRoleCombatDistance(role: EnemyRoleId, distance: number): EnemyCombatDistance {
  const safeDistance = Math.max(0, Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY);
  const [preferredMin, preferredMax] = getEnemyRoleConfig(role).preferredDistance;
  if (safeDistance < preferredMin) return 'close';
  if (safeDistance <= preferredMax) return 'medium';
  return 'long';
}

/** 冲锋兵在目标较远时倾向主动接近；其他职业不会被这个规则强制冲锋。 */
export function prefersCloseRange(role: EnemyRoleId, distance: number): boolean {
  return role === 'assault' && distance >= 0 && distance <= getEnemyRoleConfig(role).preferredDistance[1];
}

export function isCloseRangePreferred(input: { role: EnemyRoleId; distance: number }): boolean;
export function isCloseRangePreferred(role: EnemyRoleId, distance: number): boolean;
export function isCloseRangePreferred(
  inputOrRole: { role: EnemyRoleId; distance: number } | EnemyRoleId,
  distance?: number,
): boolean {
  return typeof inputOrRole === 'string'
    ? prefersCloseRange(inputOrRole, distance ?? Number.POSITIVE_INFINITY)
    : prefersCloseRange(inputOrRole.role, inputOrRole.distance);
}

export function shouldAssaultAdvance(input: { role: EnemyRoleId; distance: number; targetVisible?: boolean }): boolean {
  return input.role === 'assault'
    && input.targetVisible !== false
    && input.distance > getEnemyRoleConfig('assault').preferredDistance[1];
}
