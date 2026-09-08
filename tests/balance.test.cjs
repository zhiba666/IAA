'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG } = require('../src/core.js');
const { runAll, simulate } = require('./balance.cjs');
const routes = runAll();
for (const route of routes) {
  test(`${route.name}: reaches every device and all 20 main orders without seeded funds`, () => {
    assert.equal(route.completed, true); assert.equal(route.allMachines, true);
    assert.equal(route.machines.length, CONFIG.machines.length); assert.equal(route.orders.length, CONFIG.orders.length);
    assert.ok(route.final.totalProduced > 0, 'contract-local production replaces the old cumulative target');
    assert.equal(route.contracts.length, 14);
    assert.equal(route.equipment.length, 6); assert.equal(new Set(route.final.owned).size, 6);
    assert.ok(route.equipment.every(item => item.orderIndex <= 16), 'all functional equipment is available with at least four orders left');
    assert.equal(new Set(route.contracts.map(contract => contract.id)).size, 14);
    assert.deepEqual([...new Set(route.contracts.map(contract => contract.kind))].sort(), ['cinema', 'festival', 'gift']);
    assert.ok(route.final.coins >= 0); assert.ok(route.playSeconds > 0);
    for (let i = 1; i < route.machines.length; i++) assert.ok(route.machines[i].wallSeconds >= route.machines[i - 1].wallSeconds);
    if (!route.assumptions.highAds && !route.assumptions.permanentAds) assert.equal(route.rewardCount, 0);
  });
}
test('ad simulation accounts for every 30-second pause and honors concrete frozen rewards', () => {
  const free = routes[0], ads = routes[1];
  assert.ok(ads.playSeconds < free.playSeconds, 'rewarded production reduces simulated production time');
  assert.equal(ads.wallSeconds, ads.playSeconds + ads.rewardCount * 30);
  assert.ok(ads.rewardCount > 0); assert.ok(ads.ads.some(ad => ad.kind === 'order'));
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
    assert.ok(Math.abs(ad.afterCoins - ad.before.coins - ad.grantedCoins - ad.automaticQuestCoins) <= Math.max(1e-6, ad.grantedCoins * 1e-10));
  }
  for (const route of routes) assert.equal(route.wallSeconds, route.playSeconds + route.rewardCount * 30 + route.assumptions.offlineSeconds);
});

test('single-route automatic campaigns collect every device before the final four contracts without diversity requirements', () => {
  for (const kind of ['cinema', 'gift', 'festival']) {
    const route = simulate({ name: kind + ' route', tapsPerSecond: 0, contractKinds: [kind] });
    assert.equal(route.completed, true, kind);
    assert.equal(route.successfulTaps, 0); assert.equal(route.rewardCount, 0);
    assert.equal(route.equipment.length, 6);
    assert.ok(route.equipment.every(item => item.orderIndex <= 16));
    const inspector = route.equipment.find(item => item.id === 'inspector');
    if (kind === 'cinema') {
      assert.equal(inspector.orderIndex, 16);
      assert.deepEqual(route.final.contractCounts, { cinema: 14, gift: 0, festival: 0 });
    }
  }
});
test('offline-return policy receives capped production once and pays exactly the elapsed wall time', () => {
  const route = routes[3];
  assert.equal(route.offline.seconds, CONFIG.offlineMaxSeconds);
  assert.equal(route.wallSeconds, route.playSeconds + CONFIG.offlineMaxSeconds);
  assert.ok(route.offline.production > 0); assert.ok(route.offline.coins > 0);
});
test('pure automation completes without any production clicks or advertising', () => {
  const route = routes[2]; assert.equal(route.successfulTaps, 0); assert.equal(route.rewardCount, 0);
  assert.equal(route.completed, true); assert.ok(route.wallSeconds < 3600);
});
