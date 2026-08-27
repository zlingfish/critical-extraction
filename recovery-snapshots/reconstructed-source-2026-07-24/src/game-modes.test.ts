import { describe, expect, it } from 'vitest';
import { GAME_MODE_IDS, GAME_MODE_TIME_LIMIT_SECONDS, gameModeDefinition, isObjectiveCarryMode, isWeaponAllowed } from './game-modes';

describe('game mode rules', () => {
  it('defines every selectable mode', () => {
    expect(GAME_MODE_IDS).toHaveLength(13);
    expect(new Set(GAME_MODE_IDS).size).toBe(GAME_MODE_IDS.length);
  });

  it('uses a 20 minute limit for every mode', () => {
    for (const id of GAME_MODE_IDS) {
      expect(gameModeDefinition(id).timeLimit).toBe(GAME_MODE_TIME_LIMIT_SECONDS);
    }
  });

  it('makes red zone more dangerous and rewarding', () => {
    const redZone = gameModeDefinition('red-zone');
    expect(redZone.enemyMultiplier).toBeGreaterThan(1);
    expect(redZone.lootBoosts).toBeGreaterThan(0);
  });

  it('changes perception during night operations', () => {
    const night = gameModeDefinition('night');
    expect(night.visionMultiplier).toBeLessThan(1);
    expect(night.hearingMultiplier).toBeGreaterThan(1);
  });

  it('limits the weapon challenge to three weapon families', () => {
    expect(isWeaponAllowed('weapon-lock', 'smg')).toBe(true);
    expect(isWeaponAllowed('weapon-lock', 'shotgun')).toBe(true);
    expect(isWeaponAllowed('weapon-lock', 'awm')).toBe(true);
    expect(isWeaponAllowed('weapon-lock', 'rifle')).toBe(false);
    expect(isWeaponAllowed('extraction', 'rifle')).toBe(true);
  });

  it('marks modes that use the physical objective case', () => {
    expect(isObjectiveCarryMode('escort')).toBe(true);
    expect(isObjectiveCarryMode('boss-hunt')).toBe(false);
    expect(isObjectiveCarryMode('intel')).toBe(false);
  });
});
