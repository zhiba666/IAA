'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');

const ids = ['pop', 'cup', 'ship'];
function assertConserved(game) {
  const s = game.state;
  const inFlight = ids.reduce((sum, id) => sum + s.stations[id].jobs.reduce((n, job) => n + (job ? job.amount : 0), 0), 0);
  assert.equal(s.totalProduced, s.totalSold + s.buffers.pop + s.buffers.cup + inFlight);
  assert.equal(s.totalEarned, s.totalSold * CONFIG.price);
  assert.equal(s.coins + s.totalSpent, s.totalEarned);
  for (const id of ['pop', 'cup']) {
    assert.ok(Number.isSafeInteger(s.buffers[id]));
    assert.ok(s.buffers[id] >= 0 && s.buffers[id] <= CONFIG.machines[s.machine].buffers[id]);
  }
}
function comparable(game) {
  const save = game.exportSave(0);
  save.simulation.carry = Math.round(save.simulation.carry * 1e8) / 1e8;
  return save;
}
function earnAndUpgrade(game, id) {
  const offer = game.getView().stations.find(s => s.id === id).upgrade;
  assert.ok(offer);
  if (offer.cost > game.state.coins) game.tick((offer.cost - game.state.coins) / 2 + 2);
  assert.equal(game.buyUpgrade(id).ok, true);
}

test('new factory starts itself at real 4/2/6 capacity and only sold portions earn coins', () => {
  const game = new Game({ now: 0 });
  assert.deepEqual(game.getView().stations.map(s => s.capacity), [4, 2, 6]);
  assert.equal(game.state.coins, 0);
  assert.equal(game.state.totalProduced, 1);
  game.tick(.75);
  assert.ok(game.state.totalProduced > 1);
  assert.equal(game.state.totalSold, 0);
  assert.equal(game.state.coins, 0);
  game.tick(.2);
  assert.equal(game.state.totalSold, 1);
  assert.equal(game.state.coins, CONFIG.price);
  assertConserved(game);
  assert.equal(game.state.introSeen, false);
  game.acknowledgeIntro();
  assert.equal(game.state.introSeen, true);
});

test('finite accumulation blocks upstream, then a local cup upgrade drains it and lifts actual shipping', () => {
  const game = new Game({ now: 0 });
  game.tick(20);
  assert.equal(game.state.buffers.pop, 12);
  assert.equal(game.getView().stations[0].status, 'blocked');
  assert.equal(game.getView().throughput, 2);
  const before = game.state.coins;
  assert.deepEqual(game.buyUpgrade('cup'), { ok: true, stationId: 'cup', cost: 30, level: 1 });
  assert.equal(game.state.coins, before - 30);
  assert.deepEqual(game.getView().stations.map(s => s.capacity), [4, 6, 6]);
  const paid = game.state.coins;
  assert.equal(game.buyUpgrade('cup').reason, 'machine-required');
  assert.equal(game.state.coins, paid);
  game.tick(12);
  assert.equal(game.state.buffers.pop, 0);
  assert.ok(game.getView().throughput > 3.8);
  assert.ok(game.getView().stations[1].actualRate < game.getView().stations[1].capacity);
  assertConserved(game);
});

test('unavailable and invalid upgrades never debit, legacy economy is disconnected', () => {
  const game = new Game();
  for (const id of ids) assert.equal(game.buyUpgrade(id).reason, 'not-enough-coins');
  for (const id of ['tap', 'auto', 'value', null, '__proto__']) assert.equal(game.buyUpgrade(id).reason, 'invalid-station');
  assert.equal(game.state.totalSpent, 0);
  for (const method of ['tap', 'requestReward', 'completeReward', 'claimOffline', 'acceptContract', 'claimOrder', 'buyBrand', 'releasePressure']) {
    assert.equal(typeof game[method], 'undefined', method);
  }
  assertConserved(game);
});

test('view and export are deep copies and display calls never change production', () => {
  const game = new Game({ now: 0 });
  game.tick(12.125);
  const before = comparable(game);
  const view = game.getView();
  view.state.coins = 1e9;
  view.state.stations.pop.jobs[0].amount = 100;
  view.stations[0].jobs[0].amount = 100;
  view.machine.buffers.pop = 999;
  view.buffers[0].amount = 500;
  const save = game.exportSave(123);
  save.stations.cup.history.length = 0;
  for (let i = 0; i < 20; i++) game.getView();
  assert.deepEqual(comparable(game), before);
  assert.equal(CONFIG.machines[0].buffers.pop, 12);
});

test('save reload retains WIP, fractional tick carry and settings without any time-away payout', () => {
  const original = new Game({ now: 5 });
  original.tick(20);
  original.buyUpgrade('cup');
  original.tick(1.003);
  original.acknowledgeIntro();
  original.setSetting('sound', false);
  const save = original.exportSave(500);
  const restored = new Game({ save: JSON.stringify(save), now: 500 + 365 * 86400000 });
  assert.equal(restored.loadWarning, null);
  assert.deepEqual(comparable(restored), comparable(original));
  assert.equal(restored.state.settings.sound, false);
  assert.equal(restored.state.introSeen, true);
  original.tick(32.997);
  restored.tick(32.997);
  assert.deepEqual(comparable(restored), comparable(original));
  assertConserved(restored);
});

test('old or inconsistent saves start a clean factory and never import old balances or rewards', () => {
  const legacy = { version: 1, coins: 9e9, totalProduced: 7e9, machine: 5, offline: { coins: 9e9 }, pendingRewards: { prize: { amount: 8e9 } } };
  const before = JSON.stringify(legacy);
  const game = new Game({ save: legacy, now: 0 });
  assert.equal(game.state.coins, 0);
  assert.equal(game.state.machine, 0);
  assert.ok(game.loadWarning);
  assert.equal(JSON.stringify(legacy), before);
  const valid = new Game({ now: 0 });
  valid.tick(30);
  for (const corrupt of [
    save => { save.buffers.pop++; },
    save => { save.stations.pop.jobs[0].amount = 100; },
    save => { save.coins += 100; },
    save => { save.totalEarned += 100; },
    save => { save.simulation.carry = NaN; }
  ]) {
    const save = valid.exportSave(0);
    corrupt(save);
    const recovered = new Game({ save, now: 0 });
    assert.ok(recovered.loadWarning);
    assert.equal(recovered.state.coins, 0);
    assertConserved(recovered);
  }
});

test('different frame steps and exact completion boundaries give the same physical state', () => {
  const whole = new Game({ now: 0 }), fine = new Game({ now: 0 }), uneven = new Game({ now: 0 });
  whole.tick(60);
  for (let i = 0; i < 3600; i++) fine.tick(1 / 60);
  for (let i = 0; i < 100; i++) for (const dt of [.003, .017, .13, .45]) uneven.tick(dt);
  assert.deepEqual(comparable(fine), comparable(whole));
  assert.deepEqual(comparable(uneven), comparable(whole));
  for (const game of [whole, fine, uneven]) game.buyUpgrade('cup');
  whole.tick(37.125);
  for (let i = 0; i < 4455; i++) fine.tick(1 / 120);
  uneven.tick(37.1249); uneven.tick(.0001);
  assert.deepEqual(comparable(fine), comparable(whole));
  assert.deepEqual(comparable(uneven), comparable(whole));
  assertConserved(fine);
});

test('upgrading preserves an active job and buys only this station capacity', () => {
  const game = new Game({ now: 0 });
  game.tick(20.1);
  const cupJob = { ...game.state.stations.cup.jobs[0] };
  const before = game.state.totalProduced;
  game.buyUpgrade('cup');
  assert.deepEqual(game.state.stations.cup.jobs[0], cupJob);
  assert.equal(game.state.totalProduced, before);
  assert.equal(game.getView().stations[0].capacity, 4);
  assert.equal(game.getView().stations[2].capacity, 6);
  assertConserved(game);
});

test('all six fixed stages are reachable, real lanes and packaging grow, and no upgrade drops existing inventory', () => {
  const game = new Game({ now: 0 });
  const stageGoals = [];
  let steps = 0;
  while (game.state.machine < 5 && steps++ < 3000) {
    game.tick(5);
    for (const id of ['cup', 'pop', 'ship']) {
      const offer = game.getView().stations.find(station => station.id === id).upgrade;
      if (offer && offer.available) {
        const before = game.state.totalProduced - game.state.totalSold;
        game.buyUpgrade(id);
        assert.ok(game.state.totalProduced - game.state.totalSold >= before);
      }
    }
    const goal = game.getView().expansion;
    const configured = CONFIG.machines[game.state.machine + 1];
    assert.equal(goal.requiredSold, configured.requiredSold);
    assert.equal(goal.targetRate, configured.targetRate);
    assert.equal(goal.cost, configured.cost);
    if (goal.ready) {
      stageGoals.push({ ...goal });
      const unsold = game.state.totalProduced - game.state.totalSold;
      const before = game.state.coins;
      assert.equal(game.evolve().ok, true);
      assert.equal(game.state.coins, before - goal.cost);
      assert.ok(game.state.totalProduced - game.state.totalSold >= unsold);
    }
    assertConserved(game);
    if (steps % 61 === 0) {
      const restored = new Game({ save: game.exportSave(0), now: 1e10 });
      assert.equal(restored.loadWarning, null);
      assert.deepEqual(comparable(restored), comparable(game));
    }
    game.drainEvents();
  }
  assert.equal(game.state.machine, 5, `stage ${game.state.machine} after ${game.state.playedSeconds}s`);
  assert.equal(stageGoals.length, 5);
  assert.equal(game.getView().expansion, null);
  assert.equal(game.evolve().reason, 'max-machine');
  for (const id of ids) earnAndUpgrade(game, id);
  const stations = game.getView().stations;
  assert.deepEqual(stations.map(s => s.lanes), [6, 6, 4]);
  assert.deepEqual(stations.map(s => s.batchSize), [2, 2, 4]);
  game.tick(60);
  assert.ok(game.getView().throughput >= 95);
  assertConserved(game);
  const clone = new Game({ save: game.exportSave(0), now: 0 });
  game.tick(20);
  for (let i = 0; i < 1200; i++) clone.tick(1 / 60);
  assert.deepEqual(comparable(clone), comparable(game));
});

test('expansion rate and sales gates stay fixed after upgrades, and a reached rate remains reached', () => {
  const game = new Game({ now: 0 });
  const before = game.getView().expansion;
  game.tick(20); game.buyUpgrade('cup'); game.tick(15);
  const after = game.getView().expansion;
  assert.equal(after.targetRate, before.targetRate);
  assert.equal(after.requiredSold, before.requiredSold);
  assert.equal(after.cost, before.cost);
  assert.equal(after.rateReached, true);
  game.state.stations.ship.history = [];
  assert.equal(game.getView().throughput, 0);
  assert.equal(game.getView().expansion.rateReached, true);
});

test('late double-portion lanes jam behind four-portion shipping, then added shipping lanes recover without losing old batches', () => {
  const game = new Game({ now: 0 });
  for (let step = 0; game.state.machine < 4 && step < 1000; step++) {
    game.tick(5);
    for (const id of ['cup', 'pop', 'ship']) {
      const offer = game.getView().stations.find(station => station.id === id).upgrade;
      if (offer && offer.available) game.buyUpgrade(id);
    }
    if (game.getView().expansion.ready) game.evolve();
    game.drainEvents();
  }
  assert.equal(game.state.machine, 4);
  game.tick(600); // Earn all three upgrades from actual sales.
  assert.equal(game.buyUpgrade('pop').ok, true);
  assert.equal(game.buyUpgrade('cup').ok, true);
  game.tick(30);
  assert.deepEqual(game.getView().stations.map(station => station.capacity), [64, 64, 32]);
  assert.deepEqual(game.getView().stations.map(station => station.batchSize), [2, 2, 4]);
  assert.deepEqual(game.state.buffers, { pop: 192, cup: 192 });
  assert.deepEqual(game.getView().stations.map(station => station.status), ['blocked', 'blocked', 'running']);
  assert.equal(game.getView().throughput, 32);
  assertConserved(game);

  const existing = game.state.stations.ship.jobs.map(job => ({ ...job }));
  const beforeCoins = game.state.coins;
  const soldBefore = game.state.totalSold;
  assert.equal(game.buyUpgrade('ship').ok, true);
  assert.equal(game.state.coins, beforeCoins - CONFIG.stations.ship.levels[5].cost);
  assert.deepEqual(game.state.stations.ship.jobs.slice(0, 2), existing);
  assert.equal(game.state.stations.ship.jobs.length, 4);
  assert.equal(game.state.totalSold, soldBefore); // Starting extra lanes is not a sale.
  assertConserved(game);

  game.tick(.0013); // Persist a nonzero fractional tick immediately after adding lanes.
  const reloaded = new Game({ save: game.exportSave(0), now: 86400000 });
  assert.equal(reloaded.loadWarning, null);
  assert.deepEqual(comparable(reloaded), comparable(game));
  game.tick(30);
  for (let frame = 0; frame < 1800; frame++) reloaded.tick(1 / 60);
  assert.deepEqual(comparable(reloaded), comparable(game));
  assert.equal(game.state.buffers.cup, 0);
  assert.deepEqual(game.getView().stations.map(station => station.status), ['running', 'running', 'running']);
  assert.deepEqual(game.getView().stations.map(station => station.actualRate), [64, 64, 64]);
  assert.equal((game.state.totalSold - soldBefore) % 4, 0);
  assertConserved(game);
});
