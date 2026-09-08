'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG } = require('../src/core.js');
const { runAll } = require('./balance.cjs');
const routes = runAll();
for (const route of routes) {
  test(`${route.name}: reaches every device and all 20 main orders without seeded funds`, () => {
    assert.equal(route.completed, true); assert.equal(route.allMachines, true);
    assert.equal(route.machines.length, CONFIG.machines.length); assert.equal(route.orders.length, CONFIG.orders.length);
    assert.ok(route.final.totalProduced >= CONFIG.orders.at(-1).target);
    assert.ok(route.final.coins >= 0); assert.ok(route.playSeconds > 0);
    for (let i = 1; i < route.machines.length; i++) assert.ok(route.machines[i].wallSeconds >= route.machines[i - 1].wallSeconds);
    if (!route.assumptions.highAds && !route.assumptions.permanentAds) assert.equal(route.rewardCount, 0);
  });
}
test('high-ad policy is meaningfully faster including 30 seconds per ad, while preserving the free path', () => {
  const free = routes[0], ads = routes[1];
  assert.ok(ads.wallSeconds <= free.wallSeconds * 0.8, 'target: at least 20% shorter total session');
  assert.equal(ads.wallSeconds, ads.playSeconds + ads.rewardCount * 30);
  assert.ok(ads.adsInFirst20WallMinutes >= 15 && ads.adsInFirst20WallMinutes <= 22, 'the no-cooldown policy watches ready orders and renews expired turbo');
  for (const kind of ['turbo', 'sponsor', 'order']) assert.ok(ads.ads.some(a => a.kind === kind), `policy exercises ${kind}`);
  assert.ok(ads.ads.some((ad, i) => i > 0 && ad.playSeconds - ads.ads[i - 1].playSeconds < 120), 'the removed global cooldown no longer delays eligible rewards');
  for (const ad of ads.ads) {
    if (ad.kind === 'turbo') {
      assert.equal(ad.before.boostSeconds, 0, 'the simulation renews expired turbo instead of repeatedly stacking videos');
      assert.equal(ad.promised, CONFIG.turboDuration);
      assert.equal(ad.grantedCoins, 0);
    } else if (ad.kind === 'sponsor') {
      assert.ok(ad.before.nextMachineCost > ad.before.coins);
      assert.ok(ad.before.nextMachineCost - ad.before.coins <= ad.promised);
      assert.equal(ad.grantedCoins, ad.promised);
    } else if (ad.kind === 'order') {
      assert.equal(ad.promised, ad.before.orderReward * 2);
      assert.equal(ad.grantedCoins, ad.before.orderReward * 3);
    }
    assert.ok(Math.abs(ad.afterCoins - ad.before.coins - ad.grantedCoins) <= Math.max(1e-6, ad.grantedCoins * 1e-10));
  }
});
test('offline-return policy receives capped production once and pays exactly the elapsed wall time', () => {
  const route = routes[3];
  assert.equal(route.offline.seconds, CONFIG.offlineMaxSeconds);
  assert.equal(route.wallSeconds, route.playSeconds + CONFIG.offlineMaxSeconds);
  assert.ok(route.offline.production > 0); assert.ok(route.offline.coins > 0);
});
