'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const { runStrategy, runFullProgression, conserved } = require('../tools/automation-balance.cjs');

const fresh = () => new Game({ mode: 'v15', now: 0 });
function move(game, source) {
  const reservation = game.reserveTransfer(source);
  return reservation.ok ? game.commitTransfer(reservation.token) : reservation;
}
function earn(game, seconds = 160) {
  for (let i = 0; i < seconds * 2; i++) {
    game.tick(.5);
    move(game, 'pop'); move(game, 'cup');
    game.drainEvents();
  }
}
function snapshot(game) {
  const save = game.exportSave(0);
  save.simulation.carry = Math.round(save.simulation.carry * 1e8) / 1e8;
  return save;
}
function autoFactory() {
  const game = fresh();
  earn(game, 250);
  assert.equal(game.buyUpgrade('cup').ok, true);
  assert.equal(game.buyAutomation('pop').ok, true);
  assert.equal(game.buyAutomation('cup').ok, true);
  return game;
}

test('v15 starts with two disconnected real input pockets and never sells a skipped process', () => {
  const game = fresh();
  assert.equal(game.getView().mode, 'v15');
  assert.equal(game.state.version, 4);
  assert.deepEqual(game.state.inputs, { cup: 0, ship: 0 });
  game.tick(20);
  assert.equal(game.state.totalSold, 0);
  assert.equal(game.state.buffers.pop, 24);
  assert.equal(game.state.buffers.cup, 0);
  assert.equal(game.getView().onboarding.source, 'pop');
  assert.equal(move(game, 'pop').amount, 4);
  game.tick(2);
  assert.equal(game.state.buffers.cup, 4);
  assert.equal(game.state.totalSold, 0);
  assert.equal(game.getView().onboarding.source, 'cup');
  assert.equal(move(game, 'cup').amount, 4);
  assert.equal(game.state.totalSold, 0);
  game.tick(1);
  assert.equal(game.state.totalSold, 4);
  assert.equal(game.state.coins, 4);
  assert.equal(game.getView().transfers[0].batchSize, 24);
  assert.equal(game.getView().transfers[1].batchSize, 24);
  assert.equal(game.drainEvents().filter(e => e.type === 'first-sale').length, 1);
  conserved(game);
});

test('both source claims can coexist; cancel, stale commits and save releases are idempotent', () => {
  const game = fresh();
  game.tick(3); move(game, 'pop'); game.tick(3);
  const a = game.reserveTransfer('pop'), b = game.reserveTransfer('cup');
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  const inventory = game.state.totalProduced - game.state.totalSold;
  assert.equal(game.reserveTransfer('pop').reason, 'transfer-pending');
  assert.equal(game.reserveTransfer('ship').reason, 'invalid-source');
  assert.equal(game.commitTransfer('wrong').reason, 'invalid-transfer');
  assert.equal(game.cancelTransfer(a.token).amount, a.amount);
  assert.equal(game.cancelTransfer(a.token).amount, 0);
  assert.equal(game.commitTransfer(a.token).reason, 'invalid-transfer');
  assert.equal(game.state.totalProduced - game.state.totalSold, inventory);
  const save = game.exportSave(0);
  assert.equal(game.getView().transfers[1].reservedAmount, 0);
  assert.equal(game.commitTransfer(b.token).reason, 'invalid-transfer');
  assert.equal(JSON.stringify(save).includes('token'), false);
  const restored = new Game({ mode: 'v15', save, now: 1e12 });
  assert.equal(restored.loadWarning, null);
  assert.deepEqual(snapshot(restored), snapshot(game));
  conserved(game); conserved(restored);
});

test('automation respects held stock and partial commit leaves the rest in its source', () => {
  const game = fresh();
  earn(game);
  game.tick(20);
  const claim = game.reserveTransfer('pop');
  assert.equal(claim.amount, 24);
  assert.equal(game.buyAutomation('pop').ok, true);
  assert.equal(game.buyLogisticsUpgrade().ok, true);
  for (let i = 0; i < 40; i++) {
    game.tick(1);
    assert.ok(game.state.buffers.pop >= claim.amount);
    conserved(game);
  }
  // The unreserved stock has filled the input pocket while the claim stays in
  // the source. A drop accepts its current free space, not its stale preview.
  const before = game.state.buffers.pop;
  const free = game.getView().transfers[0].inputCapacity - game.state.inputs.cup;
  assert.ok(free < claim.amount);
  const result = game.commitTransfer(claim.token);
  assert.equal(result.amount, free);
  assert.equal(result.remaining, claim.amount - free);
  assert.equal(game.state.buffers.pop, before - free);
  assert.equal(game.commitTransfer(claim.token).reason, 'invalid-transfer');
  conserved(game);
});

test('automation purchases remove required manual work; logistics and machines have distinct effects', () => {
  const game = fresh();
  assert.equal(game.buyAutomation('pop').reason, 'not-enough-coins');
  assert.equal(game.buyAutomation('unknown').reason, 'invalid-source');
  earn(game, 400);
  assert.equal(game.buyUpgrade('cup').ok, true);
  assert.equal(game.getView().stations[1].capacity, 3);
  const capacities = game.getView().stations.map(s => s.capacity);
  const before = game.state.coins;
  assert.equal(game.buyAutomation('pop').ok, true);
  assert.equal(game.state.coins, before - CONFIG.automation.routes.pop.cost);
  assert.equal(game.buyAutomation('pop').reason, 'already-automated');
  assert.equal(game.buyAutomation('cup').ok, true);
  assert.deepEqual(game.getView().stations.map(s => s.capacity), capacities);
  assert.equal(game.buyLogisticsUpgrade().ok, true);
  assert.deepEqual(game.getView().stations.map(s => s.capacity), capacities);
  assert.equal(game.getView().transfers[0].batchSize, 36);
  assert.equal(game.getView().buffers[0].capacity, 36);
  const sold = game.state.totalSold;
  game.tick(60);
  assert.ok(game.state.totalSold - sold >= 175);
  assert.equal(game.getView().automaticTrial.complete, true);
  conserved(game);
});

test('manual bursts cannot earn the stable automatic milestone and successful drops reset an unfinished trial', () => {
  const manual = fresh();
  earn(manual, 30); manual.buyUpgrade('cup'); earn(manual, 100);
  assert.equal(manual.getView().automaticTrial.complete, false);
  assert.equal(manual.state.milestones[0], false);
  assert.equal(manual.evolve().reason, 'automation-required');
  const game = autoFactory();
  game.tick(25);
  assert.ok(game.getView().automaticTrial.elapsedSeconds > 0);
  let reservation;
  for (let i = 0; i < 120; i++) {
    reservation = game.reserveTransfer('pop');
    if (reservation.ok) break;
    game.tick(1 / 120);
  }
  assert.equal(reservation.ok, true);
  const elapsed = game.getView().automaticTrial.elapsedSeconds;
  game.cancelTransfer(reservation.token);
  assert.equal(game.getView().automaticTrial.elapsedSeconds, elapsed);
  assert.equal(game.commitTransfer(reservation.token).ok, false);
  assert.equal(game.getView().automaticTrial.elapsedSeconds, elapsed);
  assert.equal(move(game, 'pop').ok, true);
  assert.equal(game.getView().automaticTrial.elapsedSeconds, 0);
  game.tick(60);
  assert.equal(game.getView().automaticTrial.complete, true);
  assert.equal(game.state.milestones[0], true);
  game.state.stations.ship.history = [];
  assert.equal(game.getView().automaticTrial.complete, true);
  assert.equal(game.state.milestones[0], true);
  conserved(game);
});

test('validated v2 migration preserves all old level definitions, WIP and earnings with no offline reward', () => {
  const old = new Game({ now: 0 });
  old.tick(25); old.buyUpgrade('cup'); old.tick(20.003);
  const save = old.exportSave(0), raw = JSON.stringify(save);
  const game = new Game({ mode: 'v15', save: raw, now: 1e12 });
  assert.equal(game.loadWarning, null);
  assert.equal(game.state.economyProfile, 'legacy');
  assert.equal(JSON.stringify(save), raw);
  for (const key of ['coins', 'totalSold', 'totalEarned', 'totalSpent', 'upgrades', 'milestones']) assert.deepEqual(game.state[key], save[key]);
  for (const id of ['pop', 'cup', 'ship']) save.stations[id].jobs.forEach((job, lane) => {
    if (job) assert.deepEqual(game.state.stations[id].jobs[lane], job);
  });
  assert.deepEqual(game.getView().stations.map(s => s.capacity), old.getView().stations.map(s => s.capacity));
  assert.ok(game.getView().transfers.every(t => t.automated));
  for (let step = 0; step < 60; step++) {
    old.tick(1); game.tick(1);
    assert.ok(game.state.totalSold >= old.state.totalSold);
    conserved(game);
  }
  const restored = new Game({ mode: 'v15', save: game.exportSave(0), now: 0 });
  assert.equal(restored.loadWarning, null);
  assert.deepEqual(snapshot(restored), snapshot(game));
});

test('migration preserves blocked completed batches and all six legacy level mappings without reducing sale rates', () => {
  const old = new Game({ now: 0 });
  old.tick(20);
  assert.ok(old.state.stations.pop.jobs.some(job => job && job.remainingTicks === 0));
  let stageChecked = -1;
  for (let step = 0; step < 2000; step++) {
    if (old.state.machine > stageChecked) {
      for (const offset of [0, .003, .25, 1 / 120]) {
        const baseline = new Game({ save: old.exportSave(0), now: 0 });
        baseline.tick(offset);
        const save = baseline.exportSave(0);
        const migrated = new Game({ mode: 'v15', save, now: 1e12 });
        assert.equal(migrated.loadWarning, null);
        for (const id of ['pop', 'cup', 'ship']) assert.deepEqual(migrated.state.stations[id].jobs, save.stations[id].jobs);
        assert.deepEqual(migrated.getView().stations.map(s => [s.capacity, s.level]), baseline.getView().stations.map(s => [s.capacity, s.level]));
        for (let second = 0; second < 30; second++) {
          migrated.tick(1); baseline.tick(1);
          assert.ok(migrated.state.totalSold >= baseline.state.totalSold);
        }
        assert.equal(new Game({ mode: 'v15', save: migrated.exportSave(0), now: 0 }).loadWarning, null);
        conserved(migrated);
      }
      stageChecked = old.state.machine;
      if (stageChecked === 5) break;
    }
    old.tick(5);
    for (const id of ['cup', 'pop', 'ship']) old.buyUpgrade(id);
    old.evolve(); old.drainEvents();
  }
  assert.equal(stageChecked, 5);
});

test('trial save evidence rejects time reversal but preserves a completed milestone after later manual input', () => {
  const game = autoFactory(); game.tick(25);
  assert.ok(game.state.automaticTrial.elapsedTicks > 0);
  const active = game.exportSave(0);
  active.connections.pop.automatedAtTick = active.simulation.ticks - CONFIG.rateWindowSeconds * CONFIG.ticksPerSecond + 1;
  assert.ok(new Game({ mode: 'v15', save: active, now: 0 }).loadWarning);
  game.tick(60);
  assert.equal(game.state.automaticTrial.complete, true);
  for (const completedAtTick of [game.state.simulation.ticks + 1,
    game.state.connections.cup.automatedAtTick + CONFIG.automation.trialSeconds * CONFIG.ticksPerSecond]) {
    const invalid = game.exportSave(0);
    invalid.automaticTrial.completedAtTick = completedAtTick;
    assert.ok(new Game({ mode: 'v15', save: invalid, now: 0 }).loadWarning);
  }
  let committed = false;
  for (let i = 0; i < 120; i++) {
    game.tick(1 / 120);
    if (move(game, 'pop').ok) { committed = true; break; }
  }
  assert.equal(committed, true);
  assert.equal(game.state.automaticTrial.complete, true);
  assert.equal(new Game({ mode: 'v15', save: game.exportSave(0), now: 0 }).loadWarning, null);
});

test('later expansion cannot mistake a transient measured release for sustainable upstream capacity', () => {
  const game = autoFactory();
  game.tick(500);
  for (const id of ['cup', 'cup', 'pop', 'ship']) assert.equal(game.buyUpgrade(id).ok, true);
  assert.equal(game.evolve().ok, true);
  assert.equal(game.buyUpgrade('cup').ok, true);
  game.tick(10);
  assert.equal(game.buyUpgrade('ship').ok, true);
  assert.deepEqual(game.getView().stations.map(s => s.capacity), [6, 10, 12]);
  assert.equal(game.getView().expansion.targetRate, 7);
  // Model a short window dominated by earlier stock releases. Its measured
  // shipping rate is real evidence of dispatch, but cannot prove a 6/s source
  // can sustainably feed a 7/s destination gate.
  game.state.stations.ship.history = [{ tick: game.state.simulation.ticks, amount: 80 }];
  assert.ok(game.getView().throughput > 7);
  assert.equal(game.getView().automaticTrial.complete, true);
  game.tick(1);
  assert.equal(game.state.milestones[1], false);
  conserved(game);
});

test('v15 restore rejects corrupted route accounts, clocks, inputs, profiles and spoofed v2 balances', () => {
  const game = autoFactory(); game.tick(15);
  for (const mutate of [
    s => { s.inputs.ship++; },
    s => { s.connections.pop.transferredAmount++; },
    s => { s.connections.cup.remainingTicks = 121; },
    s => { s.connections.pop.manualTransfers = s.connections.pop.completedTransfers + 1; },
    s => { s.connections.pop.lastManualTransferTick = s.simulation.ticks + 1; },
    s => { s.connections.pop.automatedAtTick = s.simulation.ticks + 1; },
    s => { s.automaticTrial.complete = true; },
    s => { s.economyProfile = 'unknown'; },
    s => { s.logisticsLevel = 99; },
    s => { s.coins++; }
  ]) {
    const save = game.exportSave(0); mutate(save);
    const restored = new Game({ mode: 'v15', save, now: 0 });
    assert.ok(restored.loadWarning);
    assert.equal(restored.state.totalSold, 0);
    conserved(restored);
  }
  const legacy = new Game({ now: 0 }); legacy.tick(50);
  const invalid = legacy.exportSave(0); invalid.coins++;
  assert.ok(new Game({ mode: 'v15', save: invalid, now: 0 }).loadWarning);
  const p0 = new Game({ experiment: CONFIG.transferExperiment.id, now: 0 }).exportSave(0);
  assert.ok(new Game({ mode: 'v15', save: p0, now: 0 }).loadWarning);
});

test('same command times give equal v15 state at 120 Hz, 60 Hz and coarse frames including reload', () => {
  const seed = autoFactory().exportSave(0);
  const games = [0, 1, 2].map(() => new Game({ mode: 'v15', save: seed, now: 0 }));
  for (let second = 0; second < 75; second++) {
    games[0].tick(1);
    for (let i = 0; i < 60; i++) games[1].tick(1 / 60);
    for (let i = 0; i < 120; i++) games[2].tick(1 / 120);
    if (second === 3 || second === 14) for (const game of games) {
      for (const source of ['pop', 'cup']) move(game, source);
    }
    if (second === 40) for (let i = 0; i < games.length; i++) games[i] = new Game({ mode: 'v15', save: games[i].exportSave(0), now: 1e9 });
  }
  assert.deepEqual(snapshot(games[1]), snapshot(games[0]));
  assert.deepEqual(snapshot(games[2]), snapshot(games[0]));
  games.forEach(conserved);
});

test('mixed reservations, automatic ticks, stale callbacks, purchases and reloads conserve inventory and money', () => {
  let game = autoFactory(), seed = 27;
  const tokens = [];
  for (let i = 0; i < 500; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const source = seed % 2 ? 'pop' : 'cup';
    switch (seed % 7) {
      case 0: { const claim = game.reserveTransfer(source); if (claim.ok) tokens.push(claim.token); break; }
      case 1: game.commitTransfer(tokens[seed % Math.max(1, tokens.length)] || 'unknown'); break;
      case 2: game.cancelTransfer(tokens[seed % Math.max(1, tokens.length)] || 'unknown'); break;
      case 3: game.buyLogisticsUpgrade(); break;
      case 4: game.buyUpgrade(['pop', 'cup', 'ship'][seed % 3]); break;
      case 5: move(game, source); break;
      case 6: game.evolve(); break;
    }
    game.tick([.0017, .033, .1, .7][seed % 4]);
    conserved(game);
    if (i % 17 === 0) {
      const saved = snapshot(game);
      game = new Game({ mode: 'v15', save: saved, now: 1e12 });
      assert.equal(game.loadWarning, null);
      assert.deepEqual(snapshot(game), saved);
    }
    game.drainEvents();
  }
});

test('active, infrequent and non-optimal purchase scripts all reach first expansion and keep selling unattended', () => {
  const results = [runStrategy('active', 5), runStrategy('infrequent', 8), runStrategy('non-optimal', 6, true)];
  for (const result of results) {
    assert.ok(result.firstSale <= 15);
    assert.ok(result.secondAutomation >= 180 && result.secondAutomation <= 300);
    assert.ok(result.firstExpansion >= 360 && result.firstExpansion <= 600);
    assert.ok(result.unattended60SecondsSold >= 230);
  }
});

test('fresh v15 factories reach every later stage and 96/s without repeating manual transport', () => {
  const result = runFullProgression();
  assert.deepEqual(result.stages.map(stage => stage.machine), [0, 1, 2, 3, 4, 5]);
  assert.equal(result.finalRate, 96);
});
