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
  assert.ok(free.playSeconds > 0 && free.playSeconds < 3600);
  assert.equal(free.wallSeconds, free.playSeconds);
  assert.equal(free.contracts.length, 14);
  assert.ok(free.questClaims.every(claim => claim.automatic));
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
    assert.ok(route.final.baseIncome > 0 && Number.isFinite(route.final.baseIncome));
  });
}

test('permanent videos reduce production time while all viewing time stays visible', () => {
  assert.ok(permanent.ads.every(ad => ad.kind === 'brand'));
  assert.equal(permanent.rewardCount, 10);
  assert.ok(permanent.playSeconds < free.playSeconds);
  assert.equal(permanent.wallSeconds - permanent.playSeconds, 300);
  assert.equal(combined.wallSeconds - combined.playSeconds, combined.rewardCount * 30);
  assert.ok(combined.playSeconds < free.playSeconds);
  assert.ok(permanent.rewardCount < combined.rewardCount);
});
