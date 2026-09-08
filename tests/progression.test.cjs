'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const NOW = 1000000;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);
function factory(index = 10, machine = index >= 18 ? 5 : index >= 14 ? 4 : 3) {
  const game = new Game({ now: NOW });
  Object.assign(game.state, { orderIndex: index, machine, totalProduced: CONFIG.orders[index - 1].target, playedSeconds: 120, bursts: 1 });
  game.state.upgrades = { tap: 16, auto: 14, value: 14 };
  return game;
}
function offer(game, kind = 'bulk') { return game.getView().commissions.options.find(item => item.kind === kind); }
function accept(game, kind = 'bulk') { const quote = offer(game, kind); assert.equal(game.acceptCommission(kind, quote).ok, true); return quote; }
function perfect(game) { game.state.energy = 92; assert.equal(game.tryPerfectBurst().perfect, true); game.tick(8); }
function copy(game, later = 0) { return new Game({ save: game.exportSave(NOW), now: NOW + later }); }
function noMutation(game, callback, reason) {
  game.drainEvents(); const before = game.exportSave(NOW), result = callback();
  assert.equal(result.ok, false); if (reason) assert.equal(result.reason, reason);
  assert.deepEqual(game.exportSave(NOW), before); assert.deepEqual(game.drainEvents(), []);
}

test('delivery unlock and thresholds split each new main-order segment, and views have no side effects', () => {
  for (let index = 1; index <= 20; index++) {
    const game = factory(index, Math.min(5, index >= 18 ? 5 : index >= 14 ? 4 : index >= 10 ? 3 : index >= 6 ? 2 : index >= 3 ? 1 : 0));
    const before = game.exportSave(NOW), view = game.getView();
    assert.equal(view.deliveries.unlocked, index >= 10 && index < 20);
    assert.equal(view.deliveries.readyCount, 0);
    for (const delivery of view.deliveries.stages) {
      assert.equal(delivery.threshold, CONFIG.orders[index - 1].target + (CONFIG.orders[index].target - CONFIG.orders[index - 1].target) * delivery.stage / 4);
      assert.equal(delivery.coins, CONFIG.orders[index].reward * .2);
    }
    game.getView(); assert.deepEqual(game.exportSave(NOW), before); assert.deepEqual(game.drainEvents(), []);
  }
});

test('all delivery subsets preserve the original exact main-order total and cumulative production', () => {
  for (let mask = 0; mask < 8; mask++) {
    const game = factory(), full = CONFIG.orders[10].reward;
    game.state.totalProduced = CONFIG.orders[10].target;
    for (let stage = 1; stage <= 3; stage++) if (mask & 1 << (stage - 1)) {
      const produced = game.state.totalProduced, before = game.state.coins;
      assert.equal(game.claimDelivery(stage, 10).coins, full * .2);
      assert.equal(game.state.coins - before, full * .2); assert.equal(game.state.totalProduced, produced);
      noMutation(game, () => game.claimDelivery(stage, 10), 'already-claimed');
    }
    const paid = game.state.coins, order = game.getView().order;
    assert.equal(order.fullReward, full); assert.equal(order.reward, full - paid);
    assert.equal(game.claimOrder().coins, full - paid); assert.equal(game.state.coins, full); assert.equal(game.state.totalCoins, full);
    assert.equal(game.state.totalProduced, CONFIG.orders[10].target); assert.deepEqual(game.state.deliveries.claimed, []);
    noMutation(game, () => game.claimDelivery(1, 10), 'stale-order');
  }
});

test('delivery claims reject malformed, early, stale and pending-ad requests atomically', () => {
  const game = factory();
  for (const stage of [0, 4, 1.5, NaN, '1', null]) noMutation(game, () => game.claimDelivery(stage, 10), 'invalid-delivery');
  noMutation(game, () => game.claimDelivery(1, undefined), 'invalid-delivery');
  noMutation(game, () => game.claimDelivery(1, 9), 'stale-order');
  noMutation(game, () => game.claimDelivery(1, 10), 'delivery-not-ready');
  game.state.totalProduced = game.getView().deliveries.stages[0].threshold;
  const ad = game.quoteReward('turbo'); noMutation(game, () => game.claimDelivery(1, 10), 'busy');
  game.cancelReward(ad.id); assert.equal(game.claimDelivery(1, 10).ok, true);
});

test('order ads multiply only the unpaid remainder and cannot race a delivery', () => {
  const game = factory(), full = CONFIG.orders[10].reward;
  game.state.totalProduced = CONFIG.orders[10].target;
  game.claimDelivery(1, 10); game.claimDelivery(2, 10);
  const unpaid = full * .6, preview = game.getView().rewards.order;
  assert.equal(preview.amount, unpaid * 2); assert.equal(preview.impact.freeCoins, unpaid); assert.match(preview.description, /尾款/);
  const ad = game.quoteReward('order');
  noMutation(game, () => game.claimDelivery(3, 10), 'busy');
  assert.equal(game.applyReward(ad.id).coins, unpaid * 3);
  assert.equal(game.state.coins, full + unpaid * 2); assert.equal(game.state.orderIndex, 11);
  assert.equal(game.applyReward(ad.id).reason, 'already-claimed');
  const stale = factory(); stale.state.totalProduced = CONFIG.orders[10].target;
  const prior = stale.quoteReward('order'), input = stale.exportSave(NOW);
  input.deliveries = { orderIndex: 10, claimed: [1] };
  const restored = new Game({ save: input, now: NOW });
  assert.equal(restored.applyReward(prior.id).reason, 'stale-order'); assert.equal(restored.state.coins, 0);
});

test('legacy and malformed delivery records cannot pay past orders or duplicate stages after reload', () => {
  const game = factory(); game.state.totalProduced = CONFIG.orders[10].target;
  game.claimDelivery(2, 10); const reload = copy(game);
  assert.equal(reload.getView().order.reward, CONFIG.orders[10].reward * .8);
  noMutation(reload, () => reload.claimDelivery(2, 10), 'already-claimed');
  for (const value of [undefined, null, [], { orderIndex: 9, claimed: [1, 2, 3] }, { orderIndex: 10, claimed: 'all' }]) {
    const save = game.exportSave(NOW); save.deliveries = value;
    assert.equal(new Game({ save, now: NOW }).getView().order.reward, CONFIG.orders[10].reward);
  }
  const malformed = game.exportSave(NOW); malformed.deliveries.claimed = [1, 1, 2, 0, '3', 4, Infinity];
  assert.deepEqual(new Game({ save: malformed, now: NOW }).state.deliveries.claimed, [1, 2]);
});

test('commission quotes use permanent balanced economics and cannot be improved by turbo or a temporary mode', () => {
  const game = factory(); const before = offer(game), p = game.getView().production;
  assert.equal(before.productionTarget, Math.max(50, Math.ceil(p.baseAuto * 75)));
  assert.equal(before.reward, Math.floor(p.baseIncome * 60));
  assert.equal(offer(game, 'artisan').reward, Math.floor(p.baseIncome * 90));
  game.setProductionMode('rush'); game.state.boostSeconds = 90;
  assert.deepEqual(offer(game), before);
  game.setProductionMode('premium'); assert.deepEqual(offer(game), before);
  const low = factory(10, 2); low.state.upgrades = { tap: 0, auto: 0, value: 0 };
  assert.ok(offer(low).productionTarget >= 50);
});

test('bulk tracks only post-accept production from taps, automatic production and bursts without consuming main progress', () => {
  const game = factory(), quote = accept(game), start = game.state.totalProduced;
  assert.equal(game.getView().commissions.active.production, 0);
  game.tap(); game.tick(10); game.state.energy = 99; game.tick(1);
  close(game.getView().commissions.active.production, Math.min(quote.productionTarget, game.state.totalProduced - start));
  game._produce(quote.productionTarget, 'test');
  assert.equal(game.getView().commissions.active.production, quote.productionTarget);
  const produced = game.state.totalProduced, before = game.state.coins;
  assert.equal(game.claimCommission(quote.id).coins, quote.reward); close(game.state.coins - before, quote.reward);
  assert.equal(game.state.totalProduced, produced); assert.equal(game.getView().commissions.remaining, 2);
  noMutation(game, () => game.claimCommission(quote.id), 'stale-commission');
});

test('artisan requires actual perfect settlements and earned heat usage, never timing attempts or plain/offline production', () => {
  const game = factory(); game.state.heatRecoveryTaps = 10;
  const quote = accept(game, 'artisan'); assert.equal(quote.recoveryTarget, 10);
  game.state.energy = 92; game.tryPerfectBurst(); assert.equal(game.getView().commissions.active.perfect, 0);
  game.tick(8); assert.equal(game.getView().commissions.active.perfect, 1);
  for (let i = 0; i < 10; i++) assert.equal(game.tap().recoveryUsed, true);
  assert.equal(game.getView().commissions.active.recovery, 10); assert.equal(game.getView().commissions.active.ready, false);
  game.state.energy = 99; game.tick(1); assert.equal(game.getView().commissions.active.perfect, 1);
  perfect(game); assert.equal(game.getView().commissions.active.ready, true);
  const offline = copy(game, 600000); const earned = { ...offline.getView().commissions.active }; offline.claimOffline();
  assert.deepEqual(offline.getView().commissions.active, earned);
  assert.equal(offline.claimCommission(quote.id).coins, quote.reward);
});

test('artisan heat requirement freezes at acceptance and cancelled progress never carries into a replacement', () => {
  const game = factory(10, 2), quote = accept(game, 'artisan'); assert.equal(quote.recoveryTarget, 0);
  game.state.machine = 3; perfect(game); perfect(game);
  assert.equal(game.getView().commissions.active.ready, true);
  assert.equal(game.cancelCommission(quote.id).ok, true); assert.equal(game.getView().commissions.remaining, 3);
  noMutation(game, () => game.claimCommission(quote.id), 'stale-commission');
  noMutation(game, () => game.acceptCommission('artisan', quote), 'stale-commission');
  const next = accept(game, 'artisan'); assert.equal(next.recoveryTarget, 10);
  assert.equal(game.getView().commissions.active.perfect, 0); assert.equal(game.getView().commissions.active.recovery, 0);
});

test('commission limit is three paid settlements per main order and resets on the next order', () => {
  const game = factory();
  for (let i = 0; i < 3; i++) { const quote = accept(game); game._produce(quote.productionTarget, 'test'); assert.equal(game.claimCommission(quote.id).ok, true); }
  assert.equal(game.getView().commissions.remaining, 0); assert.equal(game.getView().commissions.available, false);
  noMutation(game, () => game.acceptCommission('bulk', offer(game)), 'commission-limit');
  game.state.totalProduced = CONFIG.orders[10].target; assert.equal(game.claimOrder().ok, true);
  assert.equal(game.getView().commissions.remaining, 3); assert.equal(game.getView().commissions.available, true);
});

test('active commissions cross main-order claims unchanged, including one final settlement after completion', () => {
  for (const index of [10, 19]) {
    const game = factory(index), quote = accept(game); game._produce(quote.productionTarget, 'test');
    const active = game.getView().commissions.active;
    game.state.totalProduced = CONFIG.orders[index].target; game.claimOrder();
    assert.deepEqual(game.getView().commissions.active, active);
    const restored = copy(game); assert.deepEqual(restored.getView().commissions.active, active);
    assert.equal(restored.claimCommission(quote.id).ok, true);
    assert.equal(restored.getView().commissions.remaining, index === 19 ? 0 : 2);
    if (index === 19) { assert.deepEqual(restored.getView().commissions.options, []); assert.equal(restored.getView().commissions.available, false); }
  }
});

test('commission quotes reject edits, economic changes, order changes and double-clicks without giving rewards', () => {
  const game = factory(), quote = offer(game);
  for (const value of [undefined, null, [], {}, { ...quote, reward: quote.reward + 1 }, { ...quote, id: 'commission:forged' }, { ...quote, serial: Infinity }])
    noMutation(game, () => game.acceptCommission('bulk', value), 'stale-commission');
  noMutation(game, () => game.acceptCommission('__proto__', quote), 'invalid-commission');
  game.state.coins = 1e12; game.buyUpgrade('auto');
  noMutation(game, () => game.acceptCommission('bulk', quote), 'stale-commission');
  const accepted = accept(game); noMutation(game, () => game.acceptCommission('bulk', accepted), 'stale-commission');
  noMutation(game, () => game.claimCommission(accepted.id), 'commission-not-ready');
});

test('all commission mutations wait for pending advertisements and never reprice an accepted task', () => {
  const game = factory(), quote = offer(game), ad = game.quoteReward('turbo');
  noMutation(game, () => game.acceptCommission('bulk', quote), 'busy');
  game.cancelReward(ad.id); const active = accept(game), frozenReward = active.reward;
  game.state.coins = 1e12; game.buyUpgrade('auto'); game.buyUpgrade('value'); game.setProductionMode('premium');
  assert.equal(game.getView().commissions.active.reward, frozenReward); assert.equal(copy(game).getView().commissions.active.reward, frozenReward);
  game._produce(active.productionTarget, 'test'); const nextAd = game.quoteReward('turbo');
  noMutation(game, () => game.cancelCommission(active.id), 'busy'); noMutation(game, () => game.claimCommission(active.id), 'busy');
  game.applyReward(nextAd.id); assert.equal(game.claimCommission(active.id).coins, frozenReward);
});

test('offline bulk counts only newly accrued production once, including merged old packs and ad doubling', () => {
  const source = factory(), oldPack = { id: 'offline:old', seconds: 60, production: 100, coins: 200 };
  source.state.offline = oldPack;
  const quote = accept(source), p = source.getView().production;
  const game = copy(source, 30000), newProduction = p.baseAuto * 30 * .5;
  assert.equal(game.getView().commissions.active.production, 0);
  const ad = game.quoteReward('offline'); assert.equal(game.applyReward(ad.id).ok, true);
  close(game.getView().commissions.active.production, Math.min(quote.productionTarget, newProduction));
  assert.equal(game.state.totalProduced, CONFIG.orders[9].target + oldPack.production + newProduction);
  assert.equal(game.claimOffline().reason, 'no-offline-reward');
  const onlyOld = factory(); onlyOld.state.offline = oldPack; accept(onlyOld); onlyOld.claimOffline();
  assert.equal(onlyOld.getView().commissions.active.production, 0);
});

test('commission save restoration rebuilds quotes, clamps progress, and discards invalid or locked active records', () => {
  const game = factory(); const quote = accept(game, 'artisan'); perfect(game);
  const save = game.exportSave(NOW); save.commissions.active.reward = Infinity; save.commissions.active.perfectTarget = 100;
  save.commissions.active.recoveryTarget = 1; save.commissions.active.perfect = 999; save.commissions.active.recovery = Infinity;
  const restored = new Game({ save, now: NOW }), active = restored.getView().commissions.active;
  assert.equal(active.reward, quote.reward); assert.equal(active.perfectTarget, 2); assert.equal(active.recoveryTarget, 10);
  assert.equal(active.perfect, 2); assert.equal(active.recovery, 0); assert.equal(active.ready, false);
  for (const change of [{ id: 'bad' }, { kind: 'unknown' }, { orderIndex: 9 }, { serial: Infinity }, { basis: null }]) {
    const input = structuredClone(save); Object.assign(input.commissions.active, change);
    assert.equal(new Game({ save: input, now: NOW }).getView().commissions.active, null);
  }
  const legacy = game.exportSave(NOW); delete legacy.commissions;
  assert.equal(new Game({ save: legacy, now: NOW }).getView().commissions.active, null);
  assert.equal(new Game({ save: legacy, now: NOW }).getView().commissions.remaining, 3);
});

test('souvenirs require main completion, the tower, loop milestones and exact coins with no production multiplier', () => {
  const game = factory(20); game.state.coins = 2e12; const p = game.getView().production;
  assert.equal(game.getView().souvenirs.unlocked, true); assert.equal(game.getView().souvenirs.total, 3);
  for (const key of ['sign', 'cup', 'starlight']) {
    let option = game.getView().souvenirs.options.find(item => item.key === key);
    if (option.requiredLoops > game.state.loopIndex) noMutation(game, () => game.buySouvenir(key, option), 'loops-required');
    game.state.loopIndex = option.requiredLoops; option = game.getView().souvenirs.options.find(item => item.key === key);
    const coins = game.state.coins, totalCoins = game.state.totalCoins, produced = game.state.totalProduced;
    assert.equal(game.buySouvenir(key, option).cost, option.cost); assert.equal(game.state.coins, coins - option.cost);
    assert.equal(game.state.totalCoins, totalCoins); assert.equal(game.state.totalProduced, produced); assert.deepEqual(game.getView().production, p);
    noMutation(game, () => game.buySouvenir(key, option), 'already-owned');
  }
  assert.equal(game.getView().souvenirs.complete, true); assert.equal(game.getView().souvenirs.ownedCount, 3);
  assert.deepEqual(copy(game).state.souvenirs, ['sign', 'cup', 'starlight']);
});

test('souvenir purchases reject pending ads, malformed prices, insufficient funds, and progression lock', () => {
  const game = factory(20), quote = game.getView().souvenirs.options[0];
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

test('souvenir restore accepts only unique defined milestones and never grants unfinished factories a collection', () => {
  const game = factory(20); game.state.loopIndex = 1;
  const save = game.exportSave(NOW); save.souvenirs = ['sign', 'sign', 'cup', 'starlight', '__proto__', {}, null];
  assert.deepEqual(new Game({ save, now: NOW }).state.souvenirs, ['sign', 'cup']);
  for (const change of [{ machine: 4 }, { orderIndex: 19 }, { souvenirs: 'sign' }])
    assert.deepEqual(new Game({ save: { ...save, ...change }, now: NOW }).state.souvenirs, []);
});
