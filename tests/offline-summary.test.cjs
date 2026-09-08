'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const { selectOfflineSummary } = require('../src/offline-summary');
const NOW = 1800000000000;
function factory(patch = {}) {
  const game = new Game({ now: NOW });
  Object.assign(game.state, { taps: 20, bursts: 1, coins: 10, orderIndex: 1, totalProduced: 60,
    upgrades: { tap: 1, auto: 1, value: 1 }, offline: { id: 'offline:summary', seconds: 600, production: 120, coins: 120 } }, patch);
  return game;
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item);
}
function close(a, b) { assert.ok(Math.abs(a - b) < 1e-8, a + ' != ' + b); }

test('offline summary predicts ordinary claim progress and balance without granting the ad bonus', () => {
  const game = factory(), summary = selectOfflineSummary(game.getView());
  close(summary.order.progressBefore, 10 / 150);
  close(summary.order.progressAfter, 130 / 150);
  const claim = game.claimOffline(); assert.equal(claim.ok, true);
  const after = game.getView();
  assert.equal(summary.coinsAfter, after.state.coins);
  close(summary.order.progressAfter, after.order.stageProgress);
  assert.equal(summary.order.readyAfter, after.order.ready);
  assert.equal(selectOfflineSummary(after), null);
});

test('offline summary offers only the current ready order, without silently claiming future orders or rewards', () => {
  const game = factory({ offline: { id: 'offline:summary', seconds: 600, production: 1000, coins: 7 } });
  const before = JSON.stringify(game.state), summary = selectOfflineSummary(game.getView());
  assert.equal(summary.order.progressAfter, 1); assert.equal(summary.nextStep.action, 'order');
  assert.equal(summary.coinsAfter, 17); assert.equal(summary.nextStep.title, '领取后可装车');
  assert.equal(JSON.stringify(game.state), before);
  assert.equal(game.state.orderIndex, 1);
});

test('offline summary previews newly affordable upgrade, and that upgrade is purchasable after the claim', () => {
  const game = factory({ totalProduced: 50, offline: { id: 'offline:upgrade', seconds: 60, production: 0, coins: 100 } });
  const summary = selectOfflineSummary(game.getView());
  assert.match(summary.nextStep.title, /可升级自动火力/);
  game.claimOffline(); assert.equal(game.buyUpgrade('auto').ok, true);
});

test('offline summary does not spend a completed machine fund on a production upgrade', () => {
  const game = factory({ coins: 29900, orderIndex: 2, totalProduced: 200,
    offline: { id: 'offline:reserved', seconds: 60, production: 1, coins: 100 } });
  const summary = selectOfflineSummary(game.getView());
  assert.equal(summary.coinsAfter, CONFIG.machines[1].cost);
  assert.equal(summary.nextStep.action, 'close');
  assert.match(summary.nextStep.detail, /本单还差/);
});

test('offline summary distinguishes a funded machine from its unclaimed-order requirement', () => {
  const game = factory({ coins: 29900, orderIndex: 3, totalProduced: 800,
    offline: { id: 'offline:machine', seconds: 60, production: 1, coins: 100 } });
  const summary = selectOfflineSummary(game.getView());
  assert.equal(summary.nextStep.action, 'machine');
  game.claimOffline(); assert.equal(game.evolve().ok, true);
});

test('offline summary respects loop-order stage progress and can run on a deeply frozen view', () => {
  const game = factory({ machine: 5, orderIndex: 20, loopIndex: 1, totalProduced: 2.8e9,
    offline: { id: 'offline:loop', seconds: 3600, production: 1e8, coins: 1e9 } });
  const summary = selectOfflineSummary(game.getView());
  game.claimOffline(); close(summary.order.progressAfter, game.getView().order.stageProgress);
  const frozenGame = factory(), view = frozenGame.getView(), before = JSON.stringify(view), events = JSON.stringify(frozenGame.events);
  deepFreeze(view);
  assert.deepEqual(selectOfflineSummary(view), selectOfflineSummary(view));
  assert.equal(JSON.stringify(view), before); assert.equal(JSON.stringify(frozenGame.events), events);
});
