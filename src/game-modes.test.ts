import { describe, expect, it } from 'vitest';
import { GAME_MODE_IDS, gameModeDefinition, isObjectiveCarryMode, isWeaponAllowed } from './game-modes';

describe('game mode rules', () => {
  it('defines every selectable mode', () => {
    expect(GAME_MODE_IDS).toEqual(expect.arrayContaining([
      'extraction', 'clear', 'survival', 'intel', 'night', 'zero', 'boss-hunt',
      'random-extract', 'escort', 'red-zone', 'continuous', 'weapon-lock',
    ]));
    expect(new Set(GAME_MODE_IDS).size).toBe(GAME_MODE_IDS.length);
  });

  it('keeps red zone at 20 minutes while making it more rewarding', () => {
    const redZone = gameModeDefinition('red-zone');
    expect(redZone.timeLimit).toBe(1200);
    expect(redZone.timeLimit).toBe(gameModeDefinition('extraction').timeLimit);
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
