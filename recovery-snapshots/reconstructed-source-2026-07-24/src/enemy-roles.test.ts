import { describe, expect, it } from 'vitest';
import {
  ENEMY_ROLE_CONFIGS,
  SHIELD_FRONTAL_DAMAGE_MULTIPLIER,
  applyShieldDamageReduction,
  calculateMedicHeal,
  canCaptainCallSupport,
  getCaptainSupportResult,
  getEnemyRoleConfig,
  getEnemyRoleForIndex,
  getRoleCombatDistance,
  getShieldDamageMultiplier,
  isCloseRangePreferred,
  isShieldFrontalHit,
  medicCanHeal,
  prefersCloseRange,
  selectEnemyRole,
  shouldAssaultAdvance,
} from './enemy-roles';

describe('敌人职业配置', () => {
  it('六种职业都有中文名称、战斗数值和地图识别色', () => {
    const roles = ['standard', 'medic', 'shield', 'sniper', 'assault', 'captain'] as const;
    for (const role of roles) {
      const config = ENEMY_ROLE_CONFIGS[role];
      expect(config.label.length).toBeGreaterThan(0);
      expect(config.health).toBeGreaterThan(0);
      expect(config.armor).toBeGreaterThanOrEqual(0);
      expect(config.speed).toBeGreaterThan(0);
      expect(config.visionRange).toBeGreaterThan(0);
      expect(config.weaponPreference.length).toBeGreaterThan(0);
      expect(config.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('按序号和难度稳定选择职业，并且不同难度会改变编组', () => {
    expect(selectEnemyRole(3, 'standard')).toBe(selectEnemyRole(3, 'standard'));
    expect(getEnemyRoleForIndex(3, 'standard')).toBe(selectEnemyRole(3, 'standard'));
    expect(selectEnemyRole(0, 'standard')).toBe('standard');
    expect(selectEnemyRole(4, 'standard')).toBe('sniper');
    expect(selectEnemyRole(4, 'veteran')).toBe('captain');
    expect(selectEnemyRole(-1, 'standard')).toBe('assault');
    expect(selectEnemyRole(Number.NaN, 'standard')).toBe('standard');
  });

  it('配置查询返回与职业一致的对象', () => {
    expect(getEnemyRoleConfig('medic')).toMatchObject({ id: 'medic', label: '医疗兵', marker: 'medical' });
  });
});

describe('医疗兵治疗', () => {
  it('在范围内治疗受伤队友，并遵守治疗量和冷却', () => {
    const result = calculateMedicHeal({
      medicAlive: true, allyHealth: 50, allyMaxHealth: 100, distance: 8, now: 20, lastHealAt: 0,
    });
    expect(result).toMatchObject({ canHeal: true, healedAmount: 24, allyHealth: 74, nextHealAt: 28, reason: 'ready' });
    expect(medicCanHeal({ medicAlive: true, allyHealth: 50, distance: 8, now: 20, lastHealAt: 0 })).toBe(true);
    expect(calculateMedicHeal({ medicAlive: true, allyHealth: 50, distance: 8, now: 22, lastHealAt: 20 }).reason).toBe('cooldown');
  });

  it('不会治疗死亡、满血或超出范围的目标', () => {
    expect(calculateMedicHeal({ medicAlive: true, allyAlive: false, allyHealth: 40, distance: 2 }).reason).toBe('ally_dead');
    expect(calculateMedicHeal({ medicAlive: false, allyHealth: 40, distance: 2 }).reason).toBe('medic_dead');
    expect(calculateMedicHeal({ medicAlive: true, allyHealth: 100, distance: 2 }).reason).toBe('target_full');
    expect(calculateMedicHeal({ medicAlive: true, allyHealth: 40, distance: 15 }).reason).toBe('out_of_range');
  });
});

describe('队长呼叫支援', () => {
  it('发现玩家或附近威胁达到阈值时可以呼叫支援', () => {
    expect(canCaptainCallSupport({ captainAlive: true, now: 50, lastCalledAt: 0, nearbyThreats: 2 })).toBe(true);
    expect(getCaptainSupportResult({ captainAlive: true, now: 50, lastCalledAt: 0, nearbyThreats: 0, playerVisible: true }))
      .toMatchObject({ canCall: true, reason: 'ready', nextReadyAt: 95 });
  });

  it('支援未结束、冷却中或没有威胁时不能重复呼叫', () => {
    expect(getCaptainSupportResult({ captainAlive: false, nearbyThreats: 3 }).reason).toBe('captain_dead');
    expect(getCaptainSupportResult({ captainAlive: true, nearbyThreats: 3, supportAlreadyActive: true }).reason).toBe('support_active');
    expect(getCaptainSupportResult({ captainAlive: true, now: 10, lastCalledAt: 0, nearbyThreats: 3 }).reason).toBe('cooldown');
    expect(getCaptainSupportResult({ captainAlive: true, nearbyThreats: 1 }).reason).toBe('no_threat');
  });
});

describe('盾牌兵正面减伤', () => {
  const forward = { x: 0, y: 0, z: 1 };

  it('正面攻击只受到百分之二十伤害，背后攻击不减伤', () => {
    expect(isShieldFrontalHit({ attackerDirection: forward, shieldForward: forward })).toBe(true);
    expect(getShieldDamageMultiplier({ hitDirection: forward, shieldForward: forward })).toBe(SHIELD_FRONTAL_DAMAGE_MULTIPLIER);
    expect(applyShieldDamageReduction(50, { hitDirection: forward, shieldForward: forward })).toBe(10);
    expect(isShieldFrontalHit({ hitDirection: { x: 0, y: 0, z: -1 }, shieldForward: forward })).toBe(false);
    expect(getShieldDamageMultiplier({ hitDirection: { x: 0, y: 0, z: -1 }, shieldForward: forward })).toBe(1);
  });

  it('放下盾牌或零长度方向不会误判为正面防御', () => {
    expect(isShieldFrontalHit({ hitDirection: forward, shieldForward: forward, shieldRaised: false })).toBe(false);
    expect(isShieldFrontalHit({ hitDirection: { x: 0, y: 0, z: 0 }, shieldForward: forward })).toBe(false);
  });
});

describe('冲锋兵交战距离', () => {
  it('冲锋兵偏好近距离，距离过远时主动接近', () => {
    expect(prefersCloseRange('assault', 10)).toBe(true);
    expect(isCloseRangePreferred({ role: 'assault', distance: 10 })).toBe(true);
    expect(isCloseRangePreferred('sniper', 10)).toBe(false);
    expect(shouldAssaultAdvance({ role: 'assault', distance: 24, targetVisible: true })).toBe(true);
    expect(shouldAssaultAdvance({ role: 'assault', distance: 24, targetVisible: false })).toBe(false);
  });

  it('按职业偏好返回近、中、远距离分区', () => {
    expect(getRoleCombatDistance('assault', 2)).toBe('close');
    expect(getRoleCombatDistance('assault', 8)).toBe('medium');
    expect(getRoleCombatDistance('sniper', 45)).toBe('medium');
    expect(getRoleCombatDistance('sniper', 10)).toBe('close');
    expect(getRoleCombatDistance('standard', 100)).toBe('long');
  });
});
