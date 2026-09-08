'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG } = require('../src/core.js');
const { simulate } = require('./balance.cjs');
const free = simulate({ name: 'free' });
const permanent = simulate({ name: 'permanent only', permanentAds: true });
const combined = simulate({ name: 'combined', permanentAds: true, highAds: true });

test('permanent cooperation preserves the existing free economic route', () => {
  assert.equal(free.completed, true);
  assert.equal(free.rewardCount, 0);
  assert.equal(free.final.brandLevel, 0);
  // Recorded before permanent rewards: same policy, no seeded funds or quest grants.
  assert.equal(free.playSeconds, 3520);
  assert.equal(free.wallSeconds, free.playSeconds);
  assert.deepEqual(free.machines.map(machine => machine.playSeconds), [0, 73, 164, 396, 940, 2406]);
});

for (const route of [permanent, combined]) {
  test(route.name + ': permanent rewards respect stage limits and grant a lasting linear income bonus', () => {
    assert.equal(route.completed, true);
    assert.equal(route.orders.length, CONFIG.orders.length);
    assert.equal(route.machines.length, CONFIG.machines.length);
    assert.equal(route.final.brandLevel, CONFIG.brandMaxLevel);
    assert.equal(route.wallSeconds, route.playSeconds + route.rewardCount * 30);
    const brandAds = route.ads.filter(ad => ad.kind === 'brand');
    assert.equal(brandAds.length, CONFIG.brandMaxLevel);
    for (const [i, ad] of brandAds.entries()) {
      assert.equal(ad.before.brandLevel, i);
      assert.equal(ad.afterBrandLevel, i + 1);
      assert.ok(ad.afterBrandLevel <= ad.before.machine * CONFIG.brandLevelsPerMachine);
      assert.ok(ad.playSeconds >= CONFIG.rewardUnlockSeconds);
      assert.equal(ad.promised, 1);
      assert.equal(ad.grantedCoins, 0, 'permanent cooperation raises future production income instead of granting instant coins');
      assert.equal(ad.afterCoins, ad.before.coins);
      const expectedRatio = (1 + (i + 1) * CONFIG.brandBonusPerLevel) / (1 + i * CONFIG.brandBonusPerLevel);
      assert.ok(Math.abs(ad.afterBaseIncome / ad.before.baseIncome - expectedRatio) < 1e-10);
    }
    assert.deepEqual(route.final.upgrades, free.final.upgrades);
    const expectedMultiplier = 1 + CONFIG.brandMaxLevel * CONFIG.brandBonusPerLevel;
    assert.ok(Math.abs(route.final.baseIncome / free.final.baseIncome - expectedMultiplier) < 1e-10);
    assert.ok(route.final.coins > free.final.coins, 'completed cooperation leaves a useful enduring income asset');
  });
}

test('ten permanent videos accelerate production and main orders including all viewing time', () => {
  assert.ok(permanent.ads.every(ad => ad.kind === 'brand'));
  assert.equal(permanent.rewardCount, 10);
  assert.ok(permanent.playSeconds < free.playSeconds);
  assert.ok(permanent.wallSeconds <= free.wallSeconds * 0.65, 'permanent production gives a material benefit after paying the viewing time');
  assert.ok(permanent.wallSeconds >= free.wallSeconds * 0.4, 'stage limits preserve a substantial production and order journey');
  assert.ok(permanent.machines[4].playSeconds < free.machines[4].playSeconds, 'permanent earnings help reach the assembly line');
  assert.ok(combined.wallSeconds < free.wallSeconds);
  assert.ok(permanent.rewardCount < combined.rewardCount);
  assert.ok(permanent.wallSeconds <= combined.wallSeconds * 1.05, 'the focused permanent route remains competitive without stacking every temporary offer');
});
