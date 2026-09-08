'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const NOW = 1000000;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);
function factory(machine = 4, orders = 14) {
  const game = new Game({ now: NOW });
  Object.assign(game.state, { machine, orderIndex: orders, totalProduced: CONFIG.orders[orders - 1].target, coins: 1e13, playedSeconds: 100, bursts: 1, upgrades: { tap: 24, auto: 24, value: 24 } });
  return game;
}
function option(game, key = 'yield') { return game.getView().refinements.options.find(item => item.key === key); }
function unchanged(game, action, reason) {
  game.drainEvents(); const before = game.exportSave(NOW);
  assert.deepEqual(action(), { ok: false, reason });
  assert.deepEqual(game.exportSave(NOW), before); assert.deepEqual(game.drainEvents(), []);
}

test('refinement caps require earned orders and the matching equipment, keeping all three stages separate', () => {
  for (const [machine, orders, cap] of [[3, 14, 0], [4, 13, 0], [4, 14, 1], [4, 15, 1], [4, 16, 2], [4, 18, 2], [5, 17, 2], [5, 18, 3]]) {
    const game = factory(machine, orders);
    for (const key of ['yield', 'value']) {
      assert.equal(option(game, key).unlockedLevel, cap);
      for (let level = 0; level < cap; level++) assert.equal(game.buyRefinement(key, option(game, key)).ok, true);
      unchanged(game, () => game.buyRefinement(key), cap === 3 ? 'max-level' : machine < 4 ? 'refinement-locked' : 'refinement-stage-locked');
    }
  }
  const game = factory(); assert.match(option(game).nextUnlockText, /16 单.*Lv.2/);
  game.buyRefinement('yield'); assert.match(option(game).nextUnlockText, /16 单.*Lv.2/);
  game.state.orderIndex = 16; game.buyRefinement('yield'); assert.match(option(game).nextUnlockText, /18 单.*巨型爆米花塔.*Lv.3/);
});

test('an exact displayed refinement quote buys once, deducts only that cost, and becomes stale', () => {
  const game = factory(), quote = option(game), coins = game.state.coins;
  const result = game.buyRefinement('yield', quote);
  assert.deepEqual(result, { ok: true, key: 'yield', name: '连续爆香', fromLevel: 0, level: 1, cost: quote.cost });
  assert.equal(game.state.coins, coins - quote.cost);
  assert.deepEqual(game.drainEvents(), [{ type: 'refinement', key: 'yield', name: '连续爆香', fromLevel: 0, level: 1, cost: quote.cost }]);
  unchanged(game, () => game.buyRefinement('yield', quote), 'stale-refinement');
  assert.equal(game.state.refinements.value, 0); assert.deepEqual(game.state.upgrades, { tap: 24, auto: 24, value: 24 });
});

test('refinement purchases reject wrong or malformed quotes and insufficient funding atomically', () => {
  const game = factory();
  unchanged(game, () => game.buyRefinement('missing'), 'invalid-refinement');
  for (const quote of [null, [], {}, { level: -1, cost: 1 }, { level: 0.5, cost: 1 }, { level: 0, cost: NaN }, { level: 0, cost: 1.5 }, { level: 0, cost: Infinity }, { key: 'value', level: 0, cost: option(game).cost }]) {
    unchanged(game, () => game.buyRefinement('yield', quote), 'invalid-refinement-quote');
  }
  unchanged(game, () => game.buyRefinement('yield', { level: 0, cost: option(game).cost + 1 }), 'stale-refinement');
  game.state.coins = option(game).cost - 1;
  assert.equal(option(game).canBuy, false);
  unchanged(game, () => game.buyRefinement('yield', option(game)), 'not-enough-coins');
  game.state.coins++; assert.equal(game.buyRefinement('yield').ok, true); assert.equal(game.state.coins, 0);
});

test('pending rewarded offers freeze refinement purchases until cancelled, including after reload', () => {
  const game = factory(), quote = option(game), reward = game.quoteReward('brand');
  assert.ok(reward); assert.equal(option(game).reason, 'busy'); assert.equal(option(game).canBuy, false);
  unchanged(game, () => game.buyRefinement('yield', quote), 'busy');
  const restored = new Game({ save: game.exportSave(NOW), now: NOW });
  unchanged(restored, () => restored.buyRefinement('yield'), 'busy');
  assert.equal(restored.cancelReward(reward.id).ok, true);
  assert.equal(restored.buyRefinement('yield', quote).ok, true);
});

test('yield applies to taps, permanent auto, boosted auto and full perfect bursts; price only changes coins', () => {
  for (const mode of ['balanced', 'rush', 'premium']) {
    const original = factory(), improved = factory();
    for (const game of [original, improved]) { game.setProductionMode(mode); game.state.boostSeconds = 30; }
    const before = original.getView().production, preview = option(improved).preview;
    improved.buyRefinement('yield'); const yieldOnly = improved.getView().production;
    close(preview.before, before.baseAuto); close(preview.after, yieldOnly.baseAuto);
    for (const field of ['tap', 'baseAuto', 'auto', 'baseIncome']) close(yieldOnly[field], before[field] * 1.2);
    close(yieldOnly.price, before.price);
    improved.buyRefinement('value'); const after = improved.getView().production;
    close(after.price, before.price * 1.2); close(after.baseIncome, before.baseIncome * 1.44);
    for (const game of [original, improved]) { game.drainEvents(); game.state.energy = 92; assert.equal(game.tryPerfectBurst().perfect, true); game.tick(8); }
    const oldBurst = original.drainEvents().find(event => event.type === 'burst'), newBurst = improved.drainEvents().find(event => event.type === 'burst');
    close(newBurst.amount, oldBurst.amount * 1.2); close(newBurst.coins, oldBurst.coins * 1.44);
    assert.equal(improved.state.heatRecoveryTaps, 10);
  }
});

test('save restoration validates refinement levels against validated orders/equipment and migrates missing fields', () => {
  const source = factory(5, 18), raw = source.exportSave(NOW);
  delete raw.refinements; delete raw.learning;
  const legacy = new Game({ save: raw, now: NOW });
  assert.deepEqual(legacy.state.refinements, { yield: 0, value: 0 });
  assert.deepEqual(legacy.state.learning, { heatRecoveryDismissed: false, heatRecoveryUses: 0 });
  assert.deepEqual(legacy.getView().production, source.getView().production);
  const valid = source.exportSave(NOW); valid.refinements = { yield: 2.8, value: 999 };
  assert.deepEqual(new Game({ save: valid, now: NOW }).state.refinements, { yield: 2, value: 3 });
  valid.refinements = { yield: -1, value: '3' };
  assert.deepEqual(new Game({ save: valid, now: NOW }).state.refinements, { yield: 0, value: 0 });
  valid.refinements = { yield: Infinity, value: NaN };
  assert.deepEqual(new Game({ save: valid, now: NOW }).state.refinements, { yield: 0, value: 0 });
  valid.refinements = { yield: 3, value: 3 }; valid.totalProduced = CONFIG.orders[13].target;
  const gated = new Game({ save: valid, now: NOW });
  assert.equal(gated.state.machine, 4); assert.equal(gated.state.orderIndex, 14);
  assert.deepEqual(gated.state.refinements, { yield: 1, value: 1 });
});

test('saved refinements combine once with brand and mode before offline accrual and brand previews', () => {
  const game = factory(5, 18);
  game.state.brandLevel = 4; game.setProductionMode('premium');
  for (const key of ['yield', 'value']) for (let i = 0; i < 3; i++) assert.equal(game.buyRefinement(key).ok, true);
  const p = game.getView().production, restored = new Game({ save: game.exportSave(NOW), now: NOW + 600000 });
  assert.deepEqual(restored.state.refinements, { yield: 3, value: 3 });
  assert.deepEqual(restored.getView().production, p);
  close(restored.state.offline.production, p.baseAuto * 600 * CONFIG.offlineEfficiency);
  close(restored.state.offline.coins, p.baseIncome * 600 * CONFIG.offlineEfficiency);
  const brand = restored.getView().brand;
  close(brand.baseAutoAfter / brand.baseAutoBefore, 2 / 1.8); close(brand.priceAfter, brand.priceBefore);
  assert.equal(restored.claimOffline().ok, true); unchanged(restored, () => restored.claimOffline(), 'no-offline-reward');
});

test('residual-heat learning requires ten eligible uses across pots and persists through breaks without offline progress', () => {
  const game = factory(3, 10); game.state.heatRecoveryTaps = 6;
  for (let i = 0; i < 4; i++) game.tap();
  assert.equal(game.state.learning.heatRecoveryUses, 4);
  const restored = new Game({ save: game.exportSave(NOW), now: NOW + 600000 });
  assert.equal(restored.state.learning.heatRecoveryUses, 4); assert.equal(restored.state.heatRecoveryTaps, 2);
  restored.tap(); restored.tap(); assert.equal(restored.state.learning.heatRecoveryUses, 6);
  restored.tap(); assert.equal(restored.state.learning.heatRecoveryUses, 6);
  restored.state.energy = 92; assert.equal(restored.tryPerfectBurst().perfect, true); restored.tick(8);
  assert.equal(restored.state.learning.heatRecoveryUses, 6);
  for (let i = 0; i < 10; i++) restored.tap();
  assert.equal(restored.state.learning.heatRecoveryUses, 10);
  restored.state.machine = 2; restored.state.heatRecoveryTaps = 10; restored.state.learning.heatRecoveryUses = 0;
  restored.tap(); assert.equal(restored.state.learning.heatRecoveryUses, 0);
});

test('residual-heat guide dismissal is persisted and learning save fields are bounded', () => {
  const game = factory(3, 10);
  assert.equal(game.dismissHeatRecoveryGuide().ok, true);
  assert.equal(new Game({ save: game.exportSave(NOW), now: NOW }).state.learning.heatRecoveryDismissed, true);
  const raw = game.exportSave(NOW); raw.learning = { heatRecoveryDismissed: 'true', heatRecoveryUses: 999 };
  assert.deepEqual(new Game({ save: raw, now: NOW }).state.learning, { heatRecoveryDismissed: false, heatRecoveryUses: 10 });
  raw.learning = { heatRecoveryUses: NaN };
  assert.equal(new Game({ save: raw, now: NOW }).state.learning.heatRecoveryUses, 0);
  const locked = new Game({ now: NOW }); unchanged(locked, () => locked.dismissHeatRecoveryGuide(), 'heat-recovery-locked');
});
