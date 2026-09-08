'use strict';
const { legacyGame } = require('./legacy-fixture.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const NOW = 1000000;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-7, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);
function factory(index = 10, machine = index >= 18 ? 5 : index >= 14 ? 4 : 3) {
  const fresh = legacyGame({ now: NOW }); fresh.getView();
  Object.assign(fresh.state, { orderIndex: index, machine, totalProduced: CONFIG.orders[index - 1].target,
    playedSeconds: 120, bursts: 1, taps: 30, upgrades: { tap: 16, auto: 14, value: 14 } });
  const game = new Game({ now: NOW, save: fresh.exportSave(NOW) }); game.drainEvents(); return game;
}
function noMutation(game, operation, reason) {
  game.getView(); game.drainEvents(); const before = game.exportSave(NOW), result = operation();
  assert.equal(result.ok, false); if (reason) assert.equal(result.reason, reason);
  assert.deepEqual(game.exportSave(NOW), before); assert.deepEqual(game.drainEvents(), []);
}
function accept(game, kind = 'cinema') {
  const quote = game.getView().contracts.options.find(item => item.kind === kind);
  assert.equal(game.acceptContract(kind, quote).ok, true); return quote;
}

test('retired parallel routes cannot pay or mutate current contract progress', () => {
  const game = factory(); accept(game);
  for (const action of [() => game.claimDelivery(1, 10), () => game.acceptCommission('bulk', {}),
    () => game.claimCommission('old'), () => game.startResearch('yield', {}), () => game.claimResearch('old'),
    () => game.buyRefinement('yield', {}), () => game.setProductionMode('rush')]) noMutation(game, action, 'route-retired');
  const view = game.getView();
  assert.equal(view.deliveries.unlocked, false); assert.equal(view.commissions.unlocked, false);
  assert.equal(view.research.unlocked, false); assert.equal(view.productionModes.unlocked, false);
});

test('accepted contracts remain local to each delivery and read-only views never pay anything', () => {
  const game = factory(), quote = accept(game);
  game.tick(10); const before = game.exportSave(NOW), active = game.getView().contracts.active;
  for (let i = 0; i < 10; i++) game.getView();
  assert.deepEqual(game.exportSave(NOW), before);
  for (let i = 0; i < 240 && !game.getView().order.ready; i++) game.tick(1);
  assert.equal(game.getView().contracts.active.id, quote.id);
  assert.ok(game.getView().contracts.active.heldProduction >= active.heldProduction);
  assert.equal(game.claimOrder().ok, true); assert.equal(game.state.orderIndex, 11);
  assert.equal(game.getView().contracts.active, null);
  noMutation(game, () => game.claimOrder(), 'order-not-ready');
});

test('contract-era saves retain earned devices and orders below obsolete cumulative thresholds', () => {
  const game = factory(14, 4), save = game.exportSave(NOW);
  save.totalProduced = 123456;
  const restored = new Game({ save, now: NOW });
  assert.equal(restored.state.orderIndex, 14); assert.equal(restored.state.machine, 4);
  assert.equal(restored.state.totalProduced, 123456);
  assert.equal(restored.getView().order.awaitingSelection, true);
});

test('legal legacy saves preserve progress and earned research/refinement power', () => {
  const game = factory(20, 5), save = game.exportSave(NOW); delete save.factory;
  save.research = { levels: { yield: 5, value: 4 }, serial: 0, active: null };
  save.refinements = { yield: 3, value: 3 };
  const restored = new Game({ save, now: NOW }), again = new Game({ save: restored.exportSave(NOW), now: NOW });
  assert.equal(restored.state.orderIndex, 20); assert.equal(restored.state.machine, 5);
  assert.deepEqual(restored.state.research.levels, save.research.levels);
  assert.deepEqual(restored.state.refinements, save.refinements);
  assert.deepEqual(again.getView().production, restored.getView().production);
  assert.equal(again.getView().order.completed, true); assert.equal(again.claimOrder().ok, false);
});

test('all completion souvenirs can be purchased with no repeat-order milestone or production multiplier', () => {
  const game = factory(20, 5); game.state.coins = 2e12;
  const production = game.getView().production;
  assert.equal(game.state.loopIndex, 0); assert.equal(game.getView().souvenirs.total, 3);
  for (const key of ['sign', 'cup', 'starlight']) {
    const quote = game.getView().souvenirs.options.find(item => item.key === key), coins = game.state.coins;
    assert.equal(quote.requiredLoops, 0); assert.equal(quote.canBuy, true);
    assert.equal(game.buySouvenir(key, quote).cost, quote.cost); near(game.state.coins, coins - quote.cost);
    assert.deepEqual(game.getView().production, production);
    noMutation(game, () => game.buySouvenir(key, quote), 'already-owned');
  }
  assert.equal(game.getView().souvenirs.complete, true); assert.equal(game.getView().souvenirs.ownedCount, 3);
  assert.deepEqual(new Game({ save: game.exportSave(NOW), now: NOW }).state.souvenirs, ['sign', 'cup', 'starlight']);
});

test('souvenir purchases validate price, progression, cash and pending advertisement atomically', () => {
  const game = factory(20, 5), quote = game.getView().souvenirs.options[0]; game.state.coins = 0;
  noMutation(game, () => game.buySouvenir('sign', quote), 'not-enough-coins');
  game.state.coins = quote.cost;
  for (const input of [undefined, null, [], {}, { ...quote, cost: 1 }, { ...quote, key: 'cup' }, { ...quote, requiredLoops: -1 }])
    noMutation(game, () => game.buySouvenir('sign', input), 'stale-souvenir');
  noMutation(game, () => game.buySouvenir('__proto__', quote), 'invalid-souvenir');
  const ad = game.quoteReward('turbo'); noMutation(game, () => game.buySouvenir('sign', quote), 'busy'); game.cancelReward(ad.id);
  game.state.machine = 4; noMutation(game, () => game.buySouvenir('sign', quote), 'souvenir-locked');
  game.state.machine = 5; game.state.orderIndex = 19; noMutation(game, () => game.buySouvenir('sign', quote), 'souvenir-locked');
  game.state.orderIndex = 20; assert.equal(game.buySouvenir('sign', quote).ok, true); assert.equal(game.state.coins, 0);
});

test('souvenir restoration accepts only unique defined items and never rewards unfinished factories', () => {
  const save = factory(20, 5).exportSave(NOW);
  save.souvenirs = ['sign', 'sign', 'cup', 'starlight', '__proto__', {}, null];
  assert.deepEqual(new Game({ save, now: NOW }).state.souvenirs, ['sign', 'cup', 'starlight']);
  for (const change of [{ machine: 4 }, { orderIndex: 19 }, { souvenirs: 'sign' }])
    assert.deepEqual(new Game({ save: { ...save, ...change }, now: NOW }).state.souvenirs, []);
});
