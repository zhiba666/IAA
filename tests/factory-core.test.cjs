'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const { legacyGame } = require('./legacy-fixture.cjs');
const NOW = 1000000;
function factory() {
  const g = legacyGame({ now: NOW });
  Object.assign(g.state, { machine: 2, orderIndex: 6, totalProduced: 20000, playedSeconds: 200, coins: 1000000,
    upgrades: { tap: 12, auto: 12, value: 12 }, bursts: 3 });
  g.tick(.001); g.drainEvents(); return g;
}
const close = (a, b) => assert.ok(Math.abs(a - b) <= Math.max(1e-7, Math.abs(b) * 1e-10), `${a} != ${b}`);

test('factory view is read-only from a fresh game and after campaign completion', () => {
  const g = new Game({ now: NOW });
  for (const completed of [false, true]) {
    if (completed) { g.state.orderIndex = 20; g.state.machine = 5; }
    const before = JSON.stringify(g.state); g.getView(); g.getView();
    assert.equal(JSON.stringify(g.state), before);
  }
});
test('midgame pots wait for full energy and retain their ordinary output', () => {
  for (const energy of [80, 94]) {
    const g = factory(); g.state.energy = energy;
    const p = g.getView().production, before = g.state.totalProduced, bursts = g.state.bursts;
    const seconds = (CONFIG.energyMax - energy) / g.getView().factory.passiveEnergy;
    g.tick(seconds);
    close(g.state.totalProduced - before, p.baseAuto * seconds + 24 * p.tap + 8 * p.baseAuto);
    assert.equal(g.state.energy, 0); assert.equal(g.state.bursts, bursts + 1);
  }
});
test('late active production uses three operations per pot and a cooldown', () => {
  const g = factory();
  assert.equal(g.tap().ok, true); assert.equal(g.tap().reason, 'tap-cooldown');
  g.tick(1); assert.equal(g.tap().ok, true); g.tick(1); assert.equal(g.tap().ok, true);
  g.tick(1); assert.equal(g.tap().reason, 'pot-taps-used');
  g.state.energy = 95; g.tick(1); assert.equal(g.getView().factory.tapsRemaining, 3);
  assert.equal(g.tap().ok, true);
});
test('electric machinery charges automatically every 25 seconds', () => {
  const g = new Game({ now: NOW }); g.state.machine = 1; g.state.energy = 0;
  g.tick(25); assert.equal(g.state.bursts, 1); assert.equal(g.state.taps, 0);
});
test('gift progress requires processing and festival progress requires actual bursts', () => {
  const gift = factory(); assert.equal(gift.acceptContract('gift').ok, true);
  gift._produce(1e10, 'auto'); assert.equal(gift.getView().contracts.active.progress, 0);
  gift.tick(1); assert.ok(gift.getView().contracts.active.coated > 0);
  const festival = factory(); festival.state.factory.owned.push('pressure'); festival.setPressureMode('hold');
  festival.acceptContract('festival'); festival._produce(1e10, 'auto');
  assert.equal(festival.getView().contracts.active.batches, 0);
  festival.state.energy = 0; festival.tick(20);
  assert.equal(festival.getView().factory.storedBurst, true); assert.equal(festival.getView().contracts.active.batches, 0);
  festival.releasePressure(); assert.equal(festival.getView().contracts.active.batches, 1);
});
test('stored pressure retains its 25 percent payout while overflow uses ordinary output', () => {
  const g = factory(); g.state.factory.owned.push('pressure'); g.setPressureMode('hold'); g.state.energy = 0;
  const p = g.getView().production, base = 24 * p.tap + 8 * p.baseAuto;
  g.tick(20);
  close(g.getView().factory.storedBurstAmount, base * 1.25);
  assert.equal(g.drainEvents().filter(event => event.type === 'burst').length, 0);
  g.tick(20);
  const overflow = g.drainEvents().find(event => event.type === 'burst');
  close(overflow.amount, base); assert.equal(overflow.source, 'pot');
  const restored = new Game({ now: NOW, save: g.exportSave(NOW) }), before = restored.state.totalProduced;
  const result = restored.releasePressure(), released = restored.drainEvents().find(event => event.type === 'burst');
  close(result.amount, base * 1.25); close(restored.state.totalProduced - before, base * 1.25);
  assert.equal(released.source, 'pressure'); assert.equal(restored.releasePressure().reason, 'no-stored-burst');
});
test('switching pressure to auto dispatches one stored pot and future event batches progress naturally', () => {
  const g = factory(); g.state.machine = 4; g.state.orderIndex = 14;
  g.tick(.001); g.setPressureMode('hold'); g.state.energy = 99; g.tick(1);
  assert.equal(g.getView().factory.storedBurst, true);
  g.tick(1); assert.equal(g.getView().factory.storedBurst, true);
  g.acceptContract('festival'); assert.equal(g.getView().contracts.active.batches, 0);
  g.setPressureMode('auto'); assert.equal(g.getView().contracts.active.batches, 1); assert.equal(g.getView().factory.storedBurst, false);
  g.tick(1); assert.equal(g.getView().contracts.active.batches, 1);
  while (!g.getView().order.ready) g.tick(1);
  g.tick(20); assert.equal(g.getView().factory.storedBurst, false);
  assert.equal(g.getView().contracts.active.batches, 3);
});
test('offline ads double cash only while reserved contract goods settle once', () => {
  const g = factory(); g.acceptContract('gift');
  const save = g.exportSave(NOW), restored = new Game({ save, now: NOW + 30000 });
  const v = restored.getView(); assert.ok(v.offline.contractCoins > 0);
  close(v.rewards.offline.amount, v.offline.cashCoins);
  close(v.rewards.offline.impact.freeCoins, v.offline.cashCoins);
  const coins = restored.state.coins, held = restored.getView().contracts.active.heldCoins, quote = restored.quoteReward('offline');
  assert.equal(restored.applyReward(quote.id).ok, true);
  close(restored.state.coins - coins, v.offline.cashCoins * 2);
  close(restored.getView().contracts.active.heldCoins - held, v.offline.contractCoins);
  assert.equal(restored.claimOffline().ok, false);
});
test('untrusted offline segments cannot exceed the saved gross package', () => {
  const g = factory(), save = g.exportSave(NOW);
  save.offline = { id: 'offline:test', seconds: 60, production: 100, coins: 200,
    factorySegments: Array.from({ length: 1000 }, () => ({ production: 1e12, coins: 1e12, seconds: 1e12, coatingCapacity: 1e12, contractId: 'bad' })) };
  const restored = new Game({ save, now: NOW }), v = restored.getView();
  assert.ok(v.offline.factorySegments.length <= 34);
  close(v.offline.factorySegments.reduce((a, b) => a + b.production, 0), 100);
  close(v.offline.factorySegments.reduce((a, b) => a + b.coins, 0), 200);
  const coins = restored.state.coins; restored.claimOffline(); close(restored.state.coins - coins, 200);
});
test('legacy invalid order counts remain validated, contract-era counts survive local goals', () => {
  const g = factory(), legacy = g.exportSave(NOW); delete legacy.factory;
  legacy.orderIndex = 20; legacy.totalProduced = 1;
  assert.equal(new Game({ save: legacy, now: NOW }).state.orderIndex, 0);
  const current = g.exportSave(NOW); current.orderIndex = 10; current.totalProduced = 20001;
  assert.equal(new Game({ save: current, now: NOW }).state.orderIndex, 10);
});
test('contract types retain their reward tradeoff even when the legacy reward floor dominates', () => {
  const g = factory(); g.state.machine = 5; g.state.orderIndex = 18;
  const options = g.getView().contracts.options;
  assert.ok(options[1].reward >= options[0].reward * 2.19);
  assert.equal(options[2].reward, options[0].reward * 4);
  const quoted = options[0]; g.buyUpgrade('auto');
  assert.equal(g.acceptContract('cinema', quoted).reason, 'stale-contract');
});
test('finite campaign can finish from a fresh save with no taps, ads or offline income', t => {
  const g = new Game({ now: NOW }), deliveries = [];
  const rate = p => p.baseIncome + (24 * p.tap + 8 * p.baseAuto) * p.price * g._passiveEnergy() / 100;
  for (let seconds = 0; seconds < 1800 && g.state.orderIndex < 20; seconds++) {
    if (g.getView().order.ready) { g.claimOrder(); deliveries.push(seconds); }
    let view = g.getView();
    if (view.canEvolve) g.evolve();
    for (let n = 0; n < 20; n++) {
      view = g.getView(); const before = rate(view.production);
      const choices = view.upgrades.filter(u => u.unlocked !== false && u.level < u.maxLevel).map(u => ({ ...u,
        payback: u.cost / (rate(g._production({ upgrades: { ...g.state.upgrades, [u.key]: u.level + 1 } })) - before) }));
      choices.sort((a, b) => a.payback - b.payback);
      if (!choices[0] || !choices[0].canBuy) break;
      if (view.nextMachine && g.state.orderIndex >= view.nextMachine.requiredOrders && g.state.coins - choices[0].cost < view.nextMachine.cost && choices[0].payback > 30) break;
      g.buyUpgrade(choices[0].key);
    }
    view = g.getView();
    if (view.contracts.unlocked && !view.contracts.active) {
      const option = view.contracts.options.find(o => o.kind === (g.state.orderIndex % 2 ? 'gift' : 'cinema') && o.canAccept)
        || view.contracts.options.find(o => o.canAccept);
      if (option) g.acceptContract(option.kind, option);
    }
    g.tick(1); g.drainEvents();
  }
  assert.equal(g.state.orderIndex, 20); assert.equal(g.state.machine, 5);
  assert.equal(g.state.taps, 0); assert.equal(g.state.rewardedCount, 0);
  assert.equal(g.claimOrder().reason, 'campaign-complete');
  assert.ok(Math.max(...deliveries.slice(6).map((seconds, i) => seconds - deliveries[i + 5])) < 120, JSON.stringify(deliveries));
  for (const option of g.getView().souvenirs.options) assert.equal(g.buySouvenir(option.key, option).ok, true);
  t.diagnostic(JSON.stringify({ completedSeconds: g.state.playedSeconds, deliveries, allSouvenirs: g.getView().souvenirs.complete }));
});
