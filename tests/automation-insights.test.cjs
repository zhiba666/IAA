'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const { ProductionInsights } = require('../src/production-insights');
const { deepFreeze } = require('./canvas-harness.cjs');

const offer = (view, id) => view.stations.find(station => station.id === id).upgrade;
function configured({ machine = 0, levels = { pop: 0, cup: 0, ship: 0 }, automatic = [], logisticsLevel = 0, profile = 'fresh' } = {}) {
  const seed = new Game({ mode: 'v15', now: 0 }).getView().state;
  seed.machine = machine;
  seed.economyProfile = profile;
  seed.logisticsLevel = logisticsLevel;
  seed.totalProduced = 0;
  const definitions = profile === 'legacy' ? CONFIG.stations : CONFIG.automation.stations;
  for (const id of CONFIG.stationIds) {
    seed.upgrades[id] = levels[id];
    seed.stations[id] = { jobs: Array(definitions[id].levels[levels[id]].lanes).fill(null), processed: 0, history: [] };
  }
  for (const source of automatic) {
    seed.connections[source].automated = true;
    seed.connections[source].automatedAtTick = 0;
  }
  const game = new Game({ mode: 'v15', save: seed, now: 0 });
  assert.equal(game.loadWarning, null);
  return game;
}
function move(game, source) {
  const held = game.reserveTransfer(source);
  assert.equal(held.ok, true);
  const result = game.commitTransfer(held.token);
  assert.equal(result.ok, true);
  return result.amount;
}
function measuredRate(game) {
  game.tick(60);
  const before = game.state.totalSold;
  game.tick(60);
  return (game.state.totalSold - before) / 60;
}

test('either missing automatic connection gives zero unattended output and previews the separate takeover reward', () => {
  const insights = new ProductionInsights();
  for (const automatic of [[], ['pop'], ['cup']]) {
    const game = configured({ automatic });
    game.tick(30);
    const view = insights.enrich(game.getView());
    assert.equal(view.insights.stableRate, 0);
    assert.equal(view.insights.stableRateLabel, '自动运行基线');
    assert.equal(view.insights.bottleneck.status, 'transport');
    assert.equal(view.insights.bottleneck.kind, 'manual');
    assert.deepEqual(view.insights.bottleneck.transportIds, ['pop', 'cup'].filter(source => !automatic.includes(source)).map(source => source === 'pop' ? 'A' : 'B'));
    assert.equal(view.insights.sampling.includesManualInput, false, 'a manual route is not evidence that a gesture occurred');
    assert.equal(view.state.totalSold, 0);
    for (const station of view.stations) {
      assert.equal(station.upgrade.lineAfter, 0);
      assert.match(station.upgrade.lineMessage, /不接通自动运输/);
    }
    for (const transfer of view.transfers.filter(item => !item.automated)) {
      assert.equal(transfer.automation.lineAfter, automatic.length === 1 ? 2 : 0);
      assert.match(transfer.automation.lineMessage, /永久少搬这一段/);
    }
  }
});

test('manually supplied sales remain measured output, and guidance changes immediately between samples', () => {
  const game = configured(), insights = new ProductionInsights();
  game.tick(3);
  const first = insights.enrich(game.getView());
  assert.equal(first.insights.bottleneck.transportId, 'A');
  move(game, 'pop');
  game.tick(3);
  const waiting = insights.enrich(game.getView());
  assert.equal(waiting.insights.bottleneck.transportId, 'B');
  const amount = move(game, 'cup');
  const shipping = insights.enrich(game.getView());
  assert.match(shipping.insights.bottleneck.label, /出货中|等待手动补料/);
  game.tick(3);
  const view = insights.enrich(game.getView());
  assert.equal(game.state.totalSold, amount);
  assert.ok(view.throughput > 0);
  assert.equal(view.insights.stableRate, 0);
  assert.match(view.insights.sampling.label, /含手动搬运/);
  game.tick(CONFIG.rateWindowSeconds + 1);
  const idle = insights.enrich(game.getView());
  assert.equal(idle.insights.sampling.includesManualInput, false, 'manual mode alone must not outlive actual sampling evidence');
  assert.match(idle.insights.sampling.label, /本段无手动投送/);
});

test('automatic predictions preserve the fresh small cup upgrades and match actual batch production through later stages', () => {
  const scenarios = [
    { levels: { pop: 0, cup: 0, ship: 0 }, expected: 2, cupAfter: 3 },
    { levels: { pop: 0, cup: 1, ship: 0 }, expected: 3, cupAfter: 4 },
    { machine: 1, levels: { pop: 2, cup: 4, ship: 2 }, expected: 8, upgradeId: 'pop' },
    { machine: 4, levels: { pop: 5, cup: 7, ship: 4 }, expected: 32, upgradeId: 'ship' },
    { machine: 5, levels: { pop: 6, cup: 8, ship: 6 }, expected: 96 }
  ];
  for (const scenario of scenarios) {
    const game = configured({ ...scenario, automatic: ['pop', 'cup'] });
    const insights = new ProductionInsights(), view = insights.enrich(game.getView());
    assert.equal(view.insights.stableRate, scenario.expected);
    assert.equal(measuredRate(game), view.insights.stableRate);
    if (scenario.cupAfter) assert.equal(offer(view, 'cup').lineAfter, scenario.cupAfter);
    if (scenario.upgradeId) {
      const upgrade = offer(view, scenario.upgradeId);
      const after = configured({ automatic: ['pop', 'cup'], machine: Math.max(scenario.machine, upgrade.requiredMachine),
        levels: { ...scenario.levels, [scenario.upgradeId]: scenario.levels[scenario.upgradeId] + 1 } });
      assert.equal(measuredRate(after), upgrade.lineAfter);
    }
  }
});

test('legacy migrations and fresh factories never share predictions for identically numbered cup levels', () => {
  const old = new Game({ now: 0 });
  old.tick(20);
  assert.equal(old.buyUpgrade('cup').ok, true);
  const migrated = new Game({ mode: 'v15', save: old.exportSave(123), now: 123 });
  assert.equal(migrated.loadWarning, null);
  assert.equal(migrated.state.economyProfile, 'legacy');
  const fresh = configured({ automatic: ['pop', 'cup'], levels: { pop: 0, cup: 1, ship: 0 } });
  const insights = new ProductionInsights();
  assert.equal(insights.enrich(migrated.getView()).insights.stableRate, 4);
  assert.equal(insights.enrich(fresh.getView()).insights.stableRate, 3);
  assert.equal(insights.enrich(migrated.getView()).insights.stableRate, 4);
  assert.equal(measuredRate(migrated), 4);
  assert.equal(insights.enrich(new Game({ now: 0 }).getView()).insights.stableRate, 2);
});

test('the recent measured window remains labelled manual after automation takeover until that evidence expires', () => {
  const game = configured(), insights = new ProductionInsights();
  const cost = CONFIG.automation.routes.pop.cost + CONFIG.automation.routes.cup.cost;
  for (let round = 0; game.state.coins < cost && round < 150; round++) {
    game.tick(6);
    for (const source of ['cup', 'pop']) {
      if (game.getView().transfers.find(transfer => transfer.source === source).canReserve) move(game, source);
    }
  }
  assert.ok(game.state.coins >= cost);
  insights.enrich(game.getView());
  assert.equal(game.buyAutomation('pop').ok, true);
  assert.equal(game.buyAutomation('cup').ok, true);
  let view = insights.enrich(game.getView());
  assert.equal(view.insights.manualTransfer, false);
  assert.equal(view.insights.stableRate, 2);
  assert.equal(view.insights.sampling.includesManualInput, true);
  assert.equal(view.insights.sampling.updating, true);
  game.tick(CONFIG.rateWindowSeconds + 1);
  view = insights.enrich(game.getView());
  assert.equal(view.insights.sampling.includesManualInput, false);
  assert.match(view.insights.sampling.label, /自动运行/);
});

test('prediction caching ignores money and inventories but includes transport, logistics, entrance and output capacities', () => {
  const game = configured({ automatic: ['pop', 'cup'] });
  game.tick(10);
  const insights = new ProductionInsights(), originalTick = Game.prototype.tick;
  let simulations = 0;
  Game.prototype.tick = function (seconds) { simulations++; return originalTick.call(this, seconds); };
  try {
    const snapshot = deepFreeze(game.getView());
    const beforeState = JSON.stringify(game.state), beforeEvents = JSON.stringify(game.events);
    insights.enrich(snapshot);
    const initialCalls = simulations;
    assert.ok(initialCalls > 0);
    for (let frame = 0; frame < 50; frame++) insights.enrich(snapshot);
    assert.equal(simulations, initialCalls);
    assert.equal(JSON.stringify(game.state), beforeState);
    assert.equal(JSON.stringify(game.events), beforeEvents);
    originalTick.call(game, 1);
    insights.enrich(game.getView());
    assert.equal(simulations, initialCalls, 'normal inventory and money changes reuse the same predictions');
    assert.equal(JSON.stringify(snapshot.state), beforeState);
    for (const alter of [
      view => { view.transfers[0].batchSize++; },
      view => { view.transfers[0].inputCapacity++; },
      view => { view.transfers[0].transportCycleTicks++; },
      view => { view.buffers[0].capacity++; }
    ]) {
      const changed = game.getView();
      alter(changed);
      const previous = simulations;
      insights.enrich(deepFreeze(changed));
      assert.ok(simulations > previous, 'changed rule snapshots cannot reuse a forecast with a different transport configuration');
    }
  } finally { Game.prototype.tick = originalTick; }
  const manual = configured();
  manual.tick(3);
  const held = manual.reserveTransfer('pop');
  const frozen = deepFreeze(manual.getView()), stateBefore = JSON.stringify(manual.state), eventsBefore = JSON.stringify(manual.events);
  const enriched = insights.enrich(frozen);
  enriched.insights.bottleneck.transportIds.push('fake');
  assert.ok(!insights.enrich(frozen).insights.bottleneck.transportIds.includes('fake'));
  assert.equal(JSON.stringify(manual.state), stateBefore);
  assert.equal(JSON.stringify(manual.events), eventsBefore);
  assert.equal(manual.commitTransfer(held.token).ok, true);
});

test('processing and transport capacity constraints have distinct explanations', () => {
  const game = configured({ automatic: ['pop', 'cup'] }), insights = new ProductionInsights();
  let view;
  for (let step = 0; step < 80; step++) {
    game.tick(.25);
    view = insights.enrich(game.getView());
  }
  assert.equal(view.insights.bottleneck.kind, 'processing');
  assert.equal(view.insights.bottleneck.stationId, 'cup');
  // A future slower transporter must be diagnosed from its exposed capacity,
  // rather than blaming the downstream machine that is waiting for that edge.
  const limited = game.getView();
  limited.transfers[0].transportCapacity = 1;
  const bottleneck = insights.enrich(limited).insights.bottleneck;
  assert.equal(bottleneck.kind, 'capacity');
  assert.equal(bottleneck.stationId, null);
  assert.equal(bottleneck.transportId, 'A');
  assert.match(bottleneck.reason, /低于设备处理能力/);
});

test('expansion and logistics predictions retain automation and use the actual next profile configuration', () => {
  const game = configured({ automatic: ['pop', 'cup'], levels: { pop: 0, cup: 1, ship: 0 } });
  const view = new ProductionInsights().enrich(game.getView());
  assert.deepEqual([view.expansion.lineBefore, view.expansion.lineAfter], [3, 3]);
  assert.deepEqual(view.expansion.bufferChanges.map(buffer => [buffer.before, buffer.after]), [[24, 24], [24, 24]]);
  assert.deepEqual([view.logisticsUpgrade.lineBefore, view.logisticsUpgrade.lineAfter], [3, 3]);
  assert.match(view.logisticsUpgrade.lineMessage, /减少补料频率/);
  assert.ok(view.expansion.unlocks.some(unlock => unlock.name === '双头装杯'));
});
