import { describe, expect, it } from 'vitest';
import { createDefaultProfile } from './domain';
import {
  createChallengeProgress,
  createExtractItemChallenge,
  dailyChallengeIndex,
  equipmentCategory,
  equipLootToStash,
  isEquipableLoot,
  updateChallenge,
} from './run-challenges';

describe('每日挑战轮换', () => {
  it('同一天保持一致，不同日期能够轮换', () => {
    expect(dailyChallengeIndex('2026-07-24', 4)).toBe(dailyChallengeIndex('2026-07-24', 4));
    const choices = new Set(Array.from({ length: 20 }, (_, day) => dailyChallengeIndex(`2026-08-${day + 1}`, 4)));
    expect(choices.size).toBeGreaterThan(1);
  });

  it('没有可用挑战时返回安全索引', () => {
    expect(dailyChallengeIndex('2026-07-24', 0)).toBe(0);
  });
});
import type { ChallengeDefinition } from './run-challenges';
import type { InventoryItem } from './types';

const noDamage: ChallengeDefinition = {
  id: 'clean',
  kind: 'no-damage-extraction',
  name: '无伤撤离',
  description: '无伤撤离',
};

const pistolOnly: ChallengeDefinition = {
  id: 'pistol',
  kind: 'pistol-only',
  name: '只用手枪',
  description: '只用手枪并撤离',
};

const headshots: ChallengeDefinition = {
  id: 'headshots',
  kind: 'headshot-kills',
  name: '精准猎手',
  description: '爆头击杀',
  targetKills: 2,
};

const armor: InventoryItem = {
  id: 'loot-heavy-armor',
  name: '缴获重型护甲',
  kind: 'armor',
  rarity: 'purple',
  value: 4600,
  quantity: 1,
};

describe('run challenges', () => {
  it('completes a no-damage challenge only after extraction', () => {
    const initial = createChallengeProgress(noDamage);
    expect(updateChallenge(initial, { type: 'kill' }, noDamage).completed).toBe(false);
    const extracted = updateChallenge(initial, { type: 'extracted' }, noDamage);
    expect(extracted.completed).toBe(true);
  });

  it('permanently fails a no-damage challenge after real damage', () => {
    const damaged = updateChallenge(createChallengeProgress(noDamage), { type: 'damage', amount: 5 }, noDamage);
    expect(damaged.failed).toBe(true);
    expect(updateChallenge(damaged, { type: 'extracted' }, noDamage).completed).toBe(false);
  });

  it('counts only headshot kills and completes at the configured target', () => {
    let progress = createChallengeProgress(headshots);
    progress = updateChallenge(progress, { type: 'kill', headshot: false }, headshots);
    expect(progress.progress).toBe(0);
    progress = updateChallenge(progress, { type: 'kill', headshot: true }, headshots);
    expect(progress.progress).toBe(1);
    progress = updateChallenge(progress, { type: 'kill', headshot: true }, headshots);
    expect(progress.completed).toBe(true);
    expect(progress.progress).toBe(2);
  });

  it('allows pistol fire but fails after firing another weapon', () => {
    let progress = createChallengeProgress(pistolOnly);
    progress = updateChallenge(progress, { type: 'weapon-fired', weapon: 'pistol' }, pistolOnly);
    expect(progress.failed).toBe(false);
    progress = updateChallenge(progress, { type: 'weapon-fired', weapon: 'other' }, pistolOnly);
    expect(progress.failed).toBe(true);
    expect(updateChallenge(progress, { type: 'extracted' }, pistolOnly).completed).toBe(false);
  });

  it('requires both the specified item and a successful extraction', () => {
    const definition = createExtractItemChallenge('encrypted-drive');
    let progress = createChallengeProgress(definition);
    progress = updateChallenge(progress, { type: 'item-extracted', itemId: 'wrong-item' }, definition);
    progress = updateChallenge(progress, { type: 'extracted' }, definition);
    expect(progress.completed).toBe(false);

    progress = createChallengeProgress(definition);
    progress = updateChallenge(progress, { type: 'item-extracted', itemId: 'encrypted-drive' }, definition);
    expect(progress.completed).toBe(false);
    expect(updateChallenge(progress, { type: 'extracted' }, definition).completed).toBe(true);
  });
});

describe('equippable extracted loot', () => {
  it('recognizes armor, medical supplies, and weapon loot', () => {
    const medical = { ...armor, id: 'field-kit', name: '野战医疗组', kind: 'medical' as const };
    const weapon = { ...armor, id: 'weapon-v9', name: 'V9 冲锋枪', kind: 'supplies' as const };
    const ordinary = { ...armor, id: 'copper-wire', name: '铜线', kind: 'supplies' as const };
    expect(equipmentCategory(armor)).toBe('armor');
    expect(equipmentCategory(medical)).toBe('medical');
    expect(equipmentCategory(weapon)).toBe('weapon');
    expect(isEquipableLoot(ordinary)).toBe(false);
  });

  it('adds and equips loot without mutating the original profile', () => {
    const original = createDefaultProfile();
    const result = equipLootToStash(original, armor);
    expect(result).toMatchObject({ equipped: true, category: 'armor', reason: 'equipped' });
    expect(result.profile.stash).toContainEqual(armor);
    expect(result.profile.ownedGear).toContain(armor.id);
    expect(result.profile.equippedGear.armor).toBe(armor.id);
    expect(original.stash).toEqual([]);
    expect(original.equippedGear.armor).toBe('starter-armor');
  });

  it('stacks duplicate loot and does not duplicate ownership', () => {
    const first = equipLootToStash(createDefaultProfile(), armor).profile;
    const second = equipLootToStash(first, { ...armor, quantity: 2 }).profile;
    expect(second.stash.find((item) => item.id === armor.id)?.quantity).toBe(3);
    expect(second.ownedGear.filter((id) => id === armor.id)).toHaveLength(1);
  });

  it('leaves ordinary valuables untouched instead of equipping them', () => {
    const profile = createDefaultProfile();
    const ordinary = { ...armor, id: 'gold-chip', name: '黄金芯片', kind: 'electronics' as const };
    const result = equipLootToStash(profile, ordinary);
    expect(result).toEqual({ profile, equipped: false, category: null, reason: 'not-equipable' });
  });
});
