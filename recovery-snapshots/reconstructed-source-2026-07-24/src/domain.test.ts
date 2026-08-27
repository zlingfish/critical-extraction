import { describe, expect, it } from 'vitest';
import {
  addInventoryItem,
  applyDamage,
  canExtract,
  completeReload,
  createDefaultProfile,
  createRunState,
  discardInventoryItem,
  consumeInventoryItem,
  parseProfile,
  buyMarketItem,
  buyAmmoPack,
  buyGear,
  buyWeaponModification,
  buySupply,
  selectKeycard,
  equipGear,
  equipWeaponModification,
  sellAll,
  sellItem,
  withdrawSelectedKeycardForRun,
  settleExtraction,
  transferInventoryItem,
  removeWeaponModification,
  reorderInventoryItems,
  nextLootRevealCount,
  revealedLootSlots,
  sortInventoryItems,
  upgradeFacility,
  settleFailure,
  insureItem,
  collectInsuranceReturns,
  consumeKeyUse,
  gearDurabilityPercent,
  gearRepairCost,
  persistRunDurability,
  repairGear,
} from './domain';

const commonItem = {
  id: 'wire',
  name: '工业铜线',
  kind: 'supplies' as const,
  rarity: 'white' as const,
  value: 280,
  quantity: 1,
};

const keycard = {
  id: 'administration-outdoor-access-card',
  name: '行政主楼档案室房卡',
  kind: 'intel' as const,
  rarity: 'purple' as const,
  value: 2600,
  quantity: 2,
  keyUses: 3,
  maxKeyUses: 3,
};

describe('combat domain', () => {
  it('absorbs 65 percent of damage with armor', () => {
    expect(applyDamage(100, 50, 20)).toEqual({ health: 93, armor: 37 });
  });

  it('allows remaining damage through depleted armor', () => {
    expect(applyDamage(100, 5, 20)).toEqual({ health: 85, armor: 0 });
  });

  it('moves reserve ammunition into a partial magazine', () => {
    expect(completeReload({ magazine: 8, reserve: 12, reloading: true, reloadEndsAt: 8 })).toEqual({
      magazine: 20,
      reserve: 0,
      reloading: false,
      reloadEndsAt: 0,
    });
  });
});

describe('inventory domain', () => {
  it('stacks duplicate items without consuming a slot', () => {
    const result = addInventoryItem([commonItem], { ...commonItem, quantity: 2 });
    expect(result.items[0].quantity).toBe(3);
  });

  it('refuses a thirteenth unique backpack item', () => {
    const full = Array.from({ length: 12 }, (_, index) => ({
      ...commonItem,
      id: `item-${index}`,
    }));
    expect(addInventoryItem(full, { ...commonItem, id: 'thirteenth' }).added).toBe(false);
  });

  it('moves one corpse-loot stack into the player backpack', () => {
    const result = transferInventoryItem([commonItem], [], commonItem.id, 6);
    expect(result.transferred).toBe(true);
    expect(result.source).toEqual([]);
    expect(result.destination).toEqual([commonItem]);
  });

  it('leaves corpse loot behind when the backpack is full', () => {
    const full = Array.from({ length: 2 }, (_, index) => ({ ...commonItem, id: `full-${index}` }));
    const result = transferInventoryItem([commonItem], full, commonItem.id, 2);
    expect(result.transferred).toBe(false);
    expect(result.source).toEqual([commonItem]);
  });

  it('discards only the selected backpack stack', () => {
    const kept = { ...commonItem, id: 'kept-item', name: '保留物资' };
    const result = discardInventoryItem([{ ...commonItem, quantity: 2 }, kept], commonItem.id);
    expect(result.discarded).toEqual({ ...commonItem, quantity: 2 });
    expect(result.items).toEqual([kept]);
  });

  it('consumes one access-card use without removing the rest of a stack', () => {
    const kept = { ...commonItem, id: 'kept-item', name: '保留物资' };
    const cards = { ...commonItem, id: 'access-card', quantity: 2 };
    const result = consumeInventoryItem([cards, kept], cards.id);
    expect(result.consumed).toBe(true);
    expect(result.items).toEqual([{ ...cards, quantity: 1 }, kept]);
  });

  it('does not change the backpack when the access card is missing', () => {
    const kept = { ...commonItem, id: 'kept-item', name: '保留物资' };
    const items = [kept];
    const result = consumeInventoryItem(items, 'access-card');
    expect(result).toEqual({ items, consumed: false });
  });

  it('only removes the first matching stack when old data contains duplicate ids', () => {
    const duplicate = { ...commonItem, quantity: 2 };
    const transfer = transferInventoryItem([commonItem, duplicate], [], commonItem.id, 6);
    expect(transfer.source).toEqual([duplicate]);
    expect(transfer.destination).toEqual([commonItem]);
    const discarded = discardInventoryItem([commonItem, duplicate], commonItem.id);
    expect(discarded.items).toEqual([duplicate]);
  });

  it('reorders backpack items and sorts high-value loot first', () => {
    const red = { ...commonItem, id: 'red', name: '红色物资', rarity: 'red' as const, value: 5000 };
    const green = { ...commonItem, id: 'green', name: '绿色物资', rarity: 'green' as const, value: 900 };
    expect(reorderInventoryItems([commonItem, red, green], green.id, commonItem.id).map((item) => item.id))
      .toEqual([green.id, commonItem.id, red.id]);
    expect(sortInventoryItems([commonItem, green, red]).map((item) => item.id))
      .toEqual([red.id, green.id, commonItem.id]);
  });

  it('reveals container slots one step at a time without exceeding capacity', () => {
    expect(revealedLootSlots(0, 6)).toBe(0);
    expect(revealedLootSlots(0.34, 6)).toBe(2);
    expect(revealedLootSlots(1, 6)).toBe(6);
    expect(revealedLootSlots(2, 6)).toBe(6);
  });

  it('reveals only one unknown item after each reveal tick', () => {
    expect(nextLootRevealCount(0, 6)).toBe(1);
    expect(nextLootRevealCount(1, 6)).toBe(2);
    expect(nextLootRevealCount(5, 6)).toBe(6);
    expect(nextLootRevealCount(6, 6)).toBe(6);
  });

  it('sells every stashed item', () => {
    const profile = { ...createDefaultProfile(), stash: [commonItem] };
    const sold = sellAll(profile);
    expect(sold.credits).toBe(1480);
    expect(sold.stash).toEqual([]);
  });

  it('adds credits immediately when selling one stacked item', () => {
    const profile = { ...createDefaultProfile(), stash: [{ ...commonItem, quantity: 3 }] };
    const sold = sellItem(profile, commonItem.id);
    expect(sold.credits).toBe(1480);
    expect(sold.stash[0].quantity).toBe(2);
  });

  it('buys a market item into the stash with credits', () => {
    const bought = buyMarketItem(createDefaultProfile(), commonItem, 400);
    expect(bought.credits).toBe(800);
    expect(bought.stash).toEqual([commonItem]);
  });

  it('selects an owned keycard and withdraws exactly one for the next run', () => {
    const profile = selectKeycard({ ...createDefaultProfile(), stash: [keycard] }, keycard.id);
    const prepared = withdrawSelectedKeycardForRun(profile, keycard.id);
    expect(prepared.item).toEqual({ ...keycard, quantity: 1 });
    expect(prepared.profile.stash[0].quantity).toBe(1);
    expect(prepared.profile.selectedKeycardId).toBe(keycard.id);
  });

  it('cannot select or withdraw a keycard that is not in the stash', () => {
    const profile = createDefaultProfile();
    expect(selectKeycard(profile, keycard.id)).toBe(profile);
    expect(withdrawSelectedKeycardForRun(profile, keycard.id)).toEqual({ profile, item: null });
  });

  it('clears the selected keycard when its final copy is sold', () => {
    const selected = selectKeycard({ ...createDefaultProfile(), stash: [{ ...keycard, quantity: 1 }] }, keycard.id);
    expect(sellItem(selected, keycard.id).selectedKeycardId).toBeNull();
  });

  it('buys armor supply for the next run with credits', () => {
    const profile = { ...createDefaultProfile(), credits: 2000 };
    const supplied = buySupply(profile, 'armor');
    expect(supplied.credits).toBe(400);
    expect(supplied.nextRunArmorBonus).toBe(30);
  });

  it('buys one 0-6 ammunition pack for the next run', () => {
    const profile = { ...createDefaultProfile(), credits: 12000 };
    const supplied = buyAmmoPack(profile, 6);
    expect(supplied).toMatchObject({ credits: 2000, nextRunAmmoLevel: 6, nextRunAmmoBonus: 30 });
    expect(buyAmmoPack(supplied, 2)).toBe(supplied);
  });

  it('converts old requisition tokens into credits', () => {
    const restored = parseProfile(JSON.stringify({ ...createDefaultProfile(), credits: 100, requisitionTokens: 3 }));
    expect(restored.credits).toBe(640);
    expect(restored.requisitionTokens).toBe(0);
  });

  it('buys and equips permanent gear', () => {
    const richProfile = { ...createDefaultProfile(), credits: 5000 };
    const bought = buyGear(richProfile, 'ridge-h2', 'helmet', 900);
    expect(bought.credits).toBe(4100);
    expect(bought.ownedGear).toContain('ridge-h2');
    const equipped = equipGear(bought, 'ridge-h2', 'helmet');
    expect(equipped.equippedGear.helmet).toBe('ridge-h2');
  });

  it('upgrades a facility and preserves its level', () => {
    const richProfile = { ...createDefaultProfile(), credits: 5000 };
    const upgraded = upgradeFacility(richProfile, 'warehouse', 2800);
    expect(upgraded.credits).toBe(2200);
    expect(upgraded.facilityLevels.warehouse).toBe(2);
  });

  it('buys, equips, and removes a permanent weapon modification', () => {
    const richProfile = { ...createDefaultProfile(), credits: 10000 };
    const bought = buyWeaponModification(richProfile, 'optic-ranger-3x', 3700);
    expect(bought.credits).toBe(6300);
    expect(bought.ownedWeaponMods).toContain('optic-ranger-3x');
    const equipped = equipWeaponModification(bought, 'rifle', 'optic', 'optic-ranger-3x');
    expect(equipped.weaponBuilds.rifle?.optic).toBe('optic-ranger-3x');
    const removed = removeWeaponModification(equipped, 'rifle', 'optic');
    expect(removed.weaponBuilds.rifle?.optic).toBeUndefined();
    expect(removed.ownedWeaponMods).toContain('optic-ranger-3x');
    expect(removed.credits).toBe(6300);
  });

  it('refuses unaffordable, duplicate, unknown, and mismatched weapon modifications', () => {
    const defaultProfile = createDefaultProfile();
    expect(buyWeaponModification(defaultProfile, 'optic-ranger-3x', 3700)).toBe(defaultProfile);
    expect(buyWeaponModification(defaultProfile, 'unknown-modification', 100)).toBe(defaultProfile);

    const richProfile = { ...defaultProfile, credits: 10000 };
    const bought = buyWeaponModification(richProfile, 'optic-ranger-3x', 3700);
    expect(buyWeaponModification(bought, 'optic-ranger-3x', 3700)).toBe(bought);
    expect(equipWeaponModification(bought, 'rifle', 'muzzle', 'optic-ranger-3x')).toBe(bought);
    expect(equipWeaponModification(bought, 'unknown-weapon', 'optic', 'optic-ranger-3x')).toBe(bought);
  });

  it('supports long-term facility upgrades and stops at each facility cap', () => {
    const profile = {
      ...createDefaultProfile(),
      credits: 999999,
      facilityLevels: { ...createDefaultProfile().facilityLevels, warehouse: 14 },
    };
    const upgraded = upgradeFacility(profile, 'warehouse', 100, 15);
    expect(upgraded.facilityLevels.warehouse).toBe(15);
    expect(upgradeFacility(upgraded, 'warehouse', 100, 15)).toBe(upgraded);
  });

  it('repairs invalid saved facility levels', () => {
    const saved = createDefaultProfile();
    saved.facilityLevels.workshop = 999;
    saved.facilityLevels.command = -12;
    const restored = parseProfile(JSON.stringify(saved));
    expect(restored.facilityLevels.workshop).toBe(15);
    expect(restored.facilityLevels.command).toBe(1);
  });

  it('adds new equipment fields when loading an older profile', () => {
    const legacy = createDefaultProfile() as unknown as Record<string, unknown>;
    delete legacy.ownedGear;
    delete legacy.equippedGear;
    delete legacy.facilityLevels;
    delete legacy.ownedWeaponMods;
    delete legacy.weaponBuilds;
    delete legacy.nextRunAmmoLevel;
    const restored = parseProfile(JSON.stringify(legacy));
    expect(restored.ownedGear).toContain('starter-pack');
    expect(restored.facilityLevels.workshop).toBe(1);
    expect(restored.ownedWeaponMods).toEqual([]);
    expect(restored.weaponBuilds).toEqual({});
    expect(restored.nextRunAmmoLevel).toBeNull();
  });

  it('repairs unknown and mismatched weapon modifications in saved profiles', () => {
    const saved = createDefaultProfile();
    saved.ownedWeaponMods = ['optic-ranger-3x', 'muzzle-vector-comp', 'unknown-modification'];
    saved.weaponBuilds = {
      rifle: {
        optic: 'optic-ranger-3x',
        muzzle: 'optic-ranger-3x',
        magazine: 'unknown-modification',
      },
      unknownWeapon: { muzzle: 'muzzle-vector-comp' },
    };
    const restored = parseProfile(JSON.stringify(saved));
    expect(restored.ownedWeaponMods).toEqual(['optic-ranger-3x', 'muzzle-vector-comp']);
    expect(restored.weaponBuilds).toEqual({ rifle: { optic: 'optic-ranger-3x' } });
  });
});

describe('gear durability domain', () => {
  it('defaults missing or invalid saved durability to full condition', () => {
    const profile = createDefaultProfile();
    profile.gearDurability = { damaged: -20, broken: 180, invalid: Number.NaN };
    expect(gearDurabilityPercent(profile, 'unknown')).toBe(100);
    expect(gearDurabilityPercent(profile, 'damaged')).toBe(0);
    expect(gearDurabilityPercent(profile, 'broken')).toBe(100);
    expect(gearDurabilityPercent(profile, 'invalid')).toBe(100);
  });

  it('calculates repair price from the missing condition', () => {
    const profile = { ...createDefaultProfile(), gearDurability: { 'weapon-rifle': 40 } };
    expect(gearRepairCost(profile, 'weapon-rifle', 1000)).toBe(240);
  });

  it('repairs owned gear when the profile can afford it', () => {
    const profile = { ...createDefaultProfile(), credits: 500, gearDurability: { 'weapon-rifle': 40 } };
    const repaired = repairGear(profile, 'weapon-rifle', 1000);
    expect(repaired.credits).toBe(260);
    expect(repaired.gearDurability['weapon-rifle']).toBe(100);
  });

  it('leaves gear unchanged when repair is unaffordable or not owned', () => {
    const profile = { ...createDefaultProfile(), credits: 100, gearDurability: { 'weapon-rifle': 40 } };
    expect(repairGear(profile, 'weapon-rifle', 1000)).toBe(profile);
    expect(repairGear(profile, 'missing-gear', 1000)).toBe(profile);
  });

  it('persists the lower remaining condition after a run', () => {
    const profile = { ...createDefaultProfile(), gearDurability: { 'starter-helmet': 80, 'starter-armor': 90, 'weapon-rifle': 70 } };
    const run = createRunState();
    run.player.armor = 25;
    run.player.maxArmorDurability = 50;
    run.player.armorDurability = 25;
    run.player.weaponDurability = 35;
    run.player.maxWeaponDurability = 100;
    const persisted = persistRunDurability(profile, run);
    expect(persisted.gearDurability['starter-helmet']).toBe(50);
    expect(persisted.gearDurability['starter-armor']).toBe(50);
    expect(persisted.gearDurability['weapon-rifle']).toBe(35);
  });
});

describe('安全箱与保险结算', () => {
  it('行动失败只保留安全箱物资', () => {
    const run = createRunState();
    run.backpack = [{ ...commonItem, id: 'lost' }];
    run.player.secureContainer = [{ ...commonItem, id: 'secured', value: 2200 }];
    const settled = settleFailure(createDefaultProfile(), run);
    expect(settled.profile.stash.map((item) => item.id)).toEqual(['secured']);
    expect(settled.profile.totalRuns).toBe(1);
  });

  it('门卡按次数消耗，最后一次使用后才离开背包', () => {
    const card = { ...commonItem, id: 'key-card', keyUses: 2, maxKeyUses: 2 };
    const first = consumeKeyUse([card], card.id);
    expect(first.remainingUses).toBe(1);
    expect(first.items[0].keyUses).toBe(1);
    const second = consumeKeyUse(first.items, card.id);
    expect(second.remainingUses).toBe(0);
    expect(second.items).toEqual([]);
  });

  it('投保会扣金币，到期后可把装备领回仓库且不能重复领取', () => {
    const weapon = { ...commonItem, id: 'insured-rifle', name: '投保步枪', kind: 'weapon' as const };
    const insured = insureItem(createDefaultProfile(), weapon, 300, 1000, 2000);
    expect(insured.credits).toBe(900);
    expect(insureItem(insured, weapon, 300, 1200, 2000)).toBe(insured);
    const failed = settleFailure(insured, createRunState()).profile;
    failed.insurancePolicies[0].returnAt = 3000;
    expect(collectInsuranceReturns(failed, 2999).returned).toEqual([]);
    const collected = collectInsuranceReturns(failed, 3000);
    expect(collected.returned).toEqual([weapon]);
    expect(collected.profile.stash[0].id).toBe(weapon.id);
    expect(collectInsuranceReturns(collected.profile, 4000).returned).toEqual([]);
  });
});

describe('run settlement', () => {
  it('requires the objective before extraction', () => {
    const run = createRunState();
    expect(canExtract(run)).toBe(false);
    run.hasObjective = true;
    expect(canExtract(run)).toBe(true);
  });

  it('moves run loot into the persistent stash', () => {
    const run = createRunState();
    run.backpack = [commonItem];
    run.elapsedSeconds = 310;
    run.kills = 3;
    const settled = settleExtraction(createDefaultProfile(), run);
    expect(settled.profile.stash).toHaveLength(1);
    expect(settled.profile.totalExtractions).toBe(1);
    expect(settled.result.value).toBe(280);
  });

  it('recovers from corrupt storage', () => {
    expect(parseProfile('{oops')).toEqual(createDefaultProfile());
    expect(parseProfile(JSON.stringify({ version: 0 }))).toEqual(createDefaultProfile());
  });
});
