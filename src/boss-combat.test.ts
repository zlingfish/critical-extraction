import { describe, expect, it } from 'vitest';
import { getBossCombatPhase, getBossCombatTuning, selectBossTactic } from './boss-combat';

describe('Boss 战斗阶段', () => {
  it('按剩余生命进入指挥、压迫和殊死阶段', () => {
    expect(getBossCombatPhase(1000, 1000)).toBe('command');
    expect(getBossCombatPhase(600, 1000)).toBe('pressure');
    expect(getBossCombatPhase(250, 1000)).toBe('desperate');
  });

  it('生命越低，移动和射击越积极', () => {
    const command = getBossCombatTuning(1000, 1000, 'standard');
    const pressure = getBossCombatTuning(500, 1000, 'standard');
    const desperate = getBossCombatTuning(200, 1000, 'standard');

    expect(pressure.speedMultiplier).toBeGreaterThan(command.speedMultiplier);
    expect(desperate.speedMultiplier).toBeGreaterThan(pressure.speedMultiplier);
    expect(desperate.shotDelayMultiplier).toBeLessThan(pressure.shotDelayMultiplier);
    expect(desperate.supportCooldown).toBeLessThan(pressure.supportCooldown);
    expect(desperate.recoveryRate).toBe(0);
  });

  it('新兵保留更大的反应余地，老兵最凶', () => {
    const recruit = getBossCombatTuning(200, 1000, 'recruit');
    const standard = getBossCombatTuning(200, 1000, 'standard');
    const veteran = getBossCombatTuning(200, 1000, 'veteran');

    expect(recruit.speedMultiplier).toBeLessThan(standard.speedMultiplier);
    expect(veteran.speedMultiplier).toBeGreaterThan(standard.speedMultiplier);
    expect(recruit.shotDelayMultiplier).toBeGreaterThan(standard.shotDelayMultiplier);
    expect(veteran.supportCooldown).toBeLessThan(standard.supportCooldown);
  });
});

describe('Boss 战术选择', () => {
  it('压迫阶段会主动接近远处玩家', () => {
    expect(selectBossTactic({
      phase: 'pressure', weaponId: 'smg', distance: 30, holdDistance: 12,
      visible: true, reloading: false, suppressed: false, roll: 0.2,
    })).toBe('advance');
  });

  it('殊死阶段受压制也不会缩在掩体后', () => {
    expect(selectBossTactic({
      phase: 'desperate', weaponId: 'smg', distance: 20, holdDistance: 7,
      visible: true, reloading: false, suppressed: true, roll: 0.1,
    })).toBe('advance');
  });

  it('指挥阶段被压制时仍会合理找掩体', () => {
    expect(selectBossTactic({
      phase: 'command', weaponId: 'smg', distance: 16, holdDistance: 18,
      visible: true, reloading: false, suppressed: true, roll: 0.9,
    })).toBe('cover');
  });
});
