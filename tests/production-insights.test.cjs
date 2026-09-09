'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const { ProductionInsights } = require('../src/production-insights');
const { deepFreeze } = require('./canvas-harness.cjs');

function configuredGame(machine, levels) {
  const seed = new Game({ now: 0 }).getView().state;
  seed.machine = machine;
  seed.totalProduced = 0;
  for (const id of CONFIG.stationIds) {
    seed.upgrades[id] = levels[id];
    seed.stations[id] = { jobs: Array(CONFIG.stations[id].levels[levels[id]].lanes).fill(null), processed: 0, history: [] };
  }
  const game = new Game({ save: seed, now: 0 });
  assert.equal(game.loadWarning, null);
  return game;
}
const offer = (view, id) => view.stations.find(station => station.id === id).upgrade;
function observe(game, insights, seconds, step = .25) {
  let view;
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    game.tick(step);
    view = insights.enrich(game.getView());
  }
  return view;
}

test('opening offers distinguish device capacity from sustainable line output', () => {
  const game = new Game({ now: 0 });
  const view = new ProductionInsights().enrich(game.getView());
  assert.equal(view.insights.stableRate, 2);
  assert.equal(view.throughput, 0, 'forecast never replaces observed shipping');
  assert.deepEqual([offer(view, 'cup').cost, offer(view, 'cup').capacityBefore, offer(view, 'cup').capacityAfter], [30, 2, 6]);
  assert.deepEqual([offer(view, 'cup').lineBefore, offer(view, 'cup').lineAfter], [2, 4]);
  for (const id of ['pop', 'ship']) {
    assert.equal(offer(view, id).lineAfter, 2);
    assert.equal(offer(view, id).lineImproves, false);
    assert.match(offer(view, id).lineMessage, /暂不提高稳定出货，为后续改造预留能力/);
    assert.equal(offer(view, id).reason, 'not-enough-coins');
  }
  assert.deepEqual(view.expansion.bufferChanges.map(buffer => [buffer.before, buffer.after]), [[12, 24], [12, 24]]);
  assert.deepEqual(view.expansion.unlocks.map(unlock => unlock.name), ['并排双锅', '双头装杯', '双份成组包装']);
  assert.equal(view.expansion.note, '扩建开放改造，设备提速需另行购买');
});

test('frozen snapshots, official game state, events and saves remain untouched; cache survives frames and coins', () => {
  const game = new Game({ now: 0 });
  game.tick(20);
  const snapshot = deepFreeze(game.getView());
  const stateBefore = JSON.stringify(game.state), eventsBefore = JSON.stringify(game.events);
  const viewBefore = JSON.stringify(snapshot);
  const insights = new ProductionInsights();
  const originalTick = Game.prototype.tick;
  let simulatedCalls = 0;
  Game.prototype.tick = function (seconds) { simulatedCalls++; return originalTick.call(this, seconds); };
  try {
    let enriched = insights.enrich(snapshot);
    const callsAfterSetup = simulatedCalls;
    assert.ok(callsAfterSetup > 0, 'prediction must use the real Game.tick');
    for (let frame = 0; frame < 600; frame++) enriched = insights.enrich(snapshot);
    assert.equal(simulatedCalls, callsAfterSetup, 'no long simulation on each render');
    enriched.stations[1].upgrade.lineAfter = 900;
    enriched.insights.bottleneck.stationIds.push('fake');
    const fresh = insights.enrich(snapshot);
    assert.equal(offer(fresh, 'cup').lineAfter, 4);
    assert.ok(!fresh.insights.bottleneck.stationIds.includes('fake'));
    assert.equal(JSON.stringify(snapshot), viewBefore);
    assert.equal(JSON.stringify(game.state), stateBefore);
    assert.equal(JSON.stringify(game.events), eventsBefore);
    originalTick.call(game, 1);
    insights.enrich(game.getView());
    assert.equal(simulatedCalls, callsAfterSetup, 'inventory, history and coins do not invalidate stable configuration predictions');
    game.buyUpgrade('cup');
    insights.enrich(game.getView());
    assert.ok(simulatedCalls > callsAfterSetup, 'purchase computes its newly relevant configuration previews');
  } finally {
    Game.prototype.tick = originalTick;
  }
});

test('real parallel and multi-portion batches match long-run measured shipping, including locked previews', () => {
  for (const [machine, levels, expected, upgradeId, after] of [
    [1, { pop: 2, cup: 2, ship: 2 }, 8, 'pop', 10],
    [3, { pop: 0, cup: 0, ship: 4 }, 2, 'cup', 4],
    [4, { pop: 5, cup: 5, ship: 4 }, 32, 'ship', 64],
    [5, { pop: 6, cup: 6, ship: 5 }, 80, 'ship', 96],
    [5, { pop: 6, cup: 5, ship: 6 }, 64, 'cup', 96]
  ]) {
    const game = configuredGame(machine, levels);
    const view = new ProductionInsights().enrich(game.getView());
    assert.equal(view.insights.stableRate, expected);
    assert.equal(offer(view, upgradeId).lineAfter, after);
    game.tick(60);
    const soldBefore = game.state.totalSold;
    game.tick(30);
    assert.equal((game.state.totalSold - soldBefore) / 30, view.insights.stableRate);
    for (const buffer of game.getView().buffers) assert.ok(buffer.amount <= buffer.capacity);
    if (machine === 1) {
      assert.equal(offer(view, upgradeId).lineRequiresExpansion, true);
      assert.equal(offer(view, upgradeId).reason, 'machine-required');
    }
  }
});

test('missing initial input and upstream full storage are not mistaken for limiting stations', () => {
  const game = new Game({ now: 0 });
  const insights = new ProductionInsights();
  let view = insights.enrich(game.getView());
  assert.equal(view.stations[1].status, 'waiting');
  assert.equal(view.stations[2].status, 'waiting');
  assert.equal(view.insights.bottleneck.stationId, null);
  assert.equal(view.insights.bottleneck.status, 'observing');
  view = observe(game, insights, 20);
  assert.equal(view.stations[0].status, 'blocked');
  assert.equal(view.buffers[0].amount, 12);
  assert.equal(view.insights.bottleneck.stationId, 'cup');
  assert.match(view.insights.bottleneck.reason, /待装爆米花持续积压/);
  assert.match(view.insights.bottleneck.reason, /每批1份/);
});

test('purchasing updates forecasts immediately but confirms the next constraint after sustained production', () => {
  const game = new Game({ now: 0 }), insights = new ProductionInsights();
  game.tick(20);
  let view = insights.enrich(game.getView());
  assert.equal(view.insights.bottleneck.stationId, 'cup');
  assert.equal(game.buyUpgrade('cup').ok, true);
  view = insights.enrich(game.getView());
  assert.equal(view.insights.stableRate, 4);
  assert.equal(view.insights.bottleneck.stationId, null, 'upstream still blocked by the real old stockpile');
  assert.equal(view.throughput, 2, 'ten-second shipping remains real after purchase');
  assert.equal(view.insights.sampling.updating, true);
  assert.match(view.insights.sampling.label, /均速更新中/);
  const initial = view.insights.bottleneck.label;
  for (let frame = 0; frame < 30; frame++) assert.equal(insights.enrich(game.getView()).insights.bottleneck.label, initial);
  view = observe(game, insights, 12);
  assert.equal(view.buffers[0].amount, 0);
  assert.equal(view.insights.bottleneck.stationId, 'pop');
  assert.equal(view.insights.sampling.updating, false);
  assert.ok(view.throughput >= 3.8);
});

test('batch shipping bottleneck is downstream of both full stores and releases only through real sales', () => {
  const game = configuredGame(4, { pop: 5, cup: 5, ship: 4 });
  const insights = new ProductionInsights();
  let view = observe(game, insights, 30);
  game.tick(.125); // A completed batch is now held in each upstream work head.
  view = insights.enrich(game.getView());
  assert.deepEqual(view.stations.map(station => station.status), ['blocked', 'blocked', 'running']);
  assert.deepEqual(view.buffers.map(buffer => buffer.amount), [192, 192]);
  assert.equal(view.insights.bottleneck.stationId, 'ship');
  assert.match(view.insights.bottleneck.reason, /每批4份/);
  assert.equal(offer(view, 'pop').lineImproves, false);
  game.tick(120);
  const soldBefore = game.state.totalSold;
  assert.equal(game.buyUpgrade('ship').ok, true);
  view = insights.enrich(game.getView());
  assert.equal(view.insights.stableRate, 64);
  assert.equal(game.state.totalSold, soldBefore, 'preview makes no sales');
  assert.ok(game.state.buffers.cup > 0, 'upgrade and preview do not clear storage');
  view = observe(game, insights, 30);
  assert.equal(view.buffers[1].amount, 0);
  assert.equal(view.insights.bottleneck.status, 'balanced');
  assert.deepEqual(view.insights.bottleneck.stationIds, ['pop', 'cup']);
});

test('snapshot refreshes cannot manufacture sustained evidence, and reloading preserves real production', () => {
  const game = new Game({ now: 0 });
  game.tick(20); game.buyUpgrade('cup'); game.tick(.75);
  const save = game.exportSave(123);
  const original = JSON.stringify(save);
  const restored = new Game({ save, now: 123 + 86400000 });
  const insights = new ProductionInsights();
  for (let frame = 0; frame < 60; frame++) insights.enrich(deepFreeze(restored.getView()));
  assert.equal(JSON.stringify(save), original);
  assert.deepEqual(restored.exportSave(123), save);
  assert.equal(insights.enrich(restored.getView()).insights.sampling.updating, true);
  game.tick(30.125); restored.tick(30.125);
  assert.deepEqual(restored.exportSave(123), game.exportSave(123));
  const freshGame = new Game({ now: 0 });
  const restartedView = insights.enrich(freshGame.getView());
  assert.equal(restartedView.insights.stableRate, 2);
  assert.equal(restartedView.insights.bottleneck.stationId, null);
  assert.equal(restartedView.insights.sampling.updating, false);
});
