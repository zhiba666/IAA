'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');

const experiment = CONFIG.transferExperiment.id;
const create = options => new Game({ experiment, now: 0, ...options });
const copy = value => JSON.parse(JSON.stringify(value));
const jobAmount = station => station.jobs.reduce((sum, job) => sum + (job ? job.amount : 0), 0);
function assertConserved(game) {
  const s = game.state;
  const wip = CONFIG.stationIds.reduce((sum, id) => sum + jobAmount(s.stations[id]), 0);
  assert.equal(s.totalProduced, s.totalSold + s.buffers.pop + s.buffers.cup + s.inputs.cup + wip);
  assert.equal(s.transfer.transferredAmount, s.inputs.cup + jobAmount(s.stations.cup) + s.stations.cup.processed);
  assert.equal(s.totalEarned, s.totalSold * CONFIG.price);
  assert.equal(s.coins + s.totalSpent, s.totalEarned);
  assert.ok(Number.isSafeInteger(s.inputs.cup) && s.inputs.cup >= 0 && s.inputs.cup <= CONFIG.transferExperiment.inputCapacity);
  for (const id of ['pop', 'cup']) assert.ok(Number.isSafeInteger(s.buffers[id]) && s.buffers[id] >= 0 && s.buffers[id] <= CONFIG.machines[0].buffers[id]);
}
function transfer(game) {
  const reservation = game.reserveTransfer();
  return reservation.ok ? game.commitTransfer(reservation.token) : reservation;
}
function comparable(game) {
  const save = game.exportSave(0);
  save.simulation.carry = Math.round(save.simulation.carry * 1e8) / 1e8;
  return save;
}

test('manual transfer is opt-in and leaves the normal v2 save and production intact', () => {
  const normal = new Game({ now: 0 });
  assert.equal(normal.state.version, 2);
  assert.equal(normal.state.experiment, undefined);
  assert.equal(normal.state.inputs, undefined);
  assert.equal(normal.getView().transfer, null);
  assert.equal(normal.reserveTransfer().reason, 'experiment-disabled');
  assert.equal(normal.commitTransfer('anything').reason, 'experiment-disabled');
  normal.tick(1);
  assert.equal(normal.state.totalSold, 1);
  assert.throws(() => new Game({ experiment: 'unknown' }), /invalid-experiment/);
});

test('the isolated first generation fills its source and safely waits for player input', () => {
  const game = create();
  assert.equal(game.state.version, 3);
  assert.equal(game.state.experiment, experiment);
  assert.deepEqual(game.state.inputs, { cup: 0 });
  assert.equal(game.getView().transfer.batchSize, 4);
  assert.equal(game.reserveTransfer().reason, 'source-empty');
  game.tick(60);
  assert.deepEqual(game.state.buffers, { pop: 12, cup: 0 });
  assert.equal(game.state.totalSold, 0);
  assert.equal(game.state.coins, 0);
  assert.equal(game.getView().stations[0].status, 'blocked');
  assert.equal(game.getView().stations[1].status, 'waiting');
  assertConserved(game);
});

test('reservation does not subtract or duplicate inventory and only one token may exist', () => {
  const game = create();
  game.tick(3);
  const before = copy(game.state);
  const first = game.reserveTransfer();
  assert.equal(first.ok, true);
  assert.equal(first.amount, 4);
  assert.deepEqual(game.state, before);
  assert.equal(game.getView().transfer.reservedAmount, 4);
  assert.equal(game.reserveTransfer().reason, 'transfer-pending');
  assert.equal(game.commitTransfer('wrong-token').reason, 'invalid-transfer');
  assert.equal(game.getView().transfer.reservedAmount, 4);
  assertConserved(game);
});

test('committing starts real cup work, leaves shipping automatic, and only sells after processing', () => {
  const game = create();
  game.tick(1);
  const reservation = game.reserveTransfer();
  assert.deepEqual(game.commitTransfer(reservation.token), { ok: true, amount: 4, remaining: 0 });
  assert.equal(game.state.inputs.cup, 3);
  assert.equal(game.state.stations.cup.jobs[0].remainingTicks, 60);
  assert.equal(game.state.buffers.cup, 0);
  assert.equal(game.state.totalSold, 0);
  assert.equal(game.state.coins, 0);
  assert.equal(game.getView().transfer.batchSize, 12);
  assert.deepEqual(game.state.transfer, { completedTransfers: 1, transferredAmount: 4 });
  const before = copy(game.state);
  assert.equal(game.commitTransfer(reservation.token).reason, 'invalid-transfer');
  assert.deepEqual(game.state, before);
  game.tick(.5);
  assert.equal(game.state.stations.cup.processed, 1);
  assert.equal(game.state.stations.ship.jobs[0].amount, 1);
  assert.equal(game.state.totalSold, 0);
  game.tick(20 / 120);
  assert.equal(game.state.totalSold, 1);
  assert.equal(game.state.coins, CONFIG.price);
  assertConserved(game);
});

test('partial acceptance leaves the remainder in the source and a full input rejects a new reservation', () => {
  const game = create();
  game.tick(10);
  transfer(game); // Four to cup, then the blocked pop lane deposits one.
  game.tick(.25);
  assert.equal(game.state.inputs.cup, 3);
  assert.equal(game.state.buffers.pop, 10);
  const reservation = game.reserveTransfer();
  assert.equal(reservation.amount, 10);
  assert.equal(game.getView().transfer.receivableAmount, 9);
  assert.deepEqual(game.commitTransfer(reservation.token), { ok: true, amount: 9, remaining: 1 });
  assert.equal(game.state.inputs.cup, 12);
  assert.equal(game.state.buffers.pop, 1);
  assert.equal(game.getView().transfer.reservedAmount, 0);
  const before = copy(game.state);
  assert.equal(game.reserveTransfer().reason, 'target-full');
  assert.deepEqual(game.state, before);
  assertConserved(game);
});

test('cancel and stale callbacks are idempotent, preserve tutorial size, and cannot release a newer token', () => {
  const game = create();
  game.tick(3);
  const before = copy(game.state);
  const first = game.reserveTransfer();
  assert.deepEqual(game.cancelTransfer(first.token), { ok: true, amount: 4 });
  assert.deepEqual(game.cancelTransfer(first.token), { ok: true, amount: 0 });
  assert.deepEqual(game.state, before);
  assert.equal(game.getView().transfer.batchSize, 4);
  const second = game.reserveTransfer();
  assert.notEqual(first.token, second.token);
  game.cancelTransfer(first.token);
  assert.equal(game.commitTransfer(first.token).reason, 'invalid-transfer');
  assert.equal(game.getView().transfer.reservedAmount, 4);
  game.cancelTransfer();
  assert.equal(game.getView().transfer.reservedAmount, 0);
  assert.equal(game.commitTransfer(second.token).reason, 'invalid-transfer');
  assert.deepEqual(game.state, before);
  assertConserved(game);
});

test('a source with fewer than four portions transfers only its actual integer stock', () => {
  const game = create();
  game.tick(.25);
  const reservation = game.reserveTransfer();
  assert.equal(reservation.amount, 1);
  assert.deepEqual(game.commitTransfer(reservation.token), { ok: true, amount: 1, remaining: 0 });
  assert.equal(game.getView().transfer.batchSize, 12);
  assertConserved(game);
});

test('holding a reservation across simulation ticks occupies source capacity without creating goods', () => {
  const game = create();
  game.tick(1);
  const reservation = game.reserveTransfer();
  game.tick(20);
  assert.equal(game.state.buffers.pop, 12);
  assert.equal(game.state.totalSold, 0);
  assert.equal(game.getView().transfer.reservedAmount, 4);
  assertConserved(game);
  assert.equal(game.commitTransfer(reservation.token).amount, 4);
  assertConserved(game);
});

test('saving releases UI reservations and reload preserves inputs, WIP and first successful transfer', () => {
  const game = create();
  game.tick(10);
  transfer(game);
  game.tick(.003);
  const reservation = game.reserveTransfer();
  assert.equal(reservation.ok, true);
  const save = game.exportSave(500);
  assert.equal(game.getView().transfer.reservedAmount, 0);
  assert.equal(save._transferReservation, undefined);
  assert.equal(save.transfer.token, undefined);
  assert.equal(game.commitTransfer(reservation.token).reason, 'invalid-transfer');
  const restored = create({ save: JSON.stringify(save), now: 500 + 365 * 86400000 });
  assert.equal(restored.loadWarning, null);
  assert.deepEqual(comparable(restored), comparable(game));
  assert.equal(restored.getView().transfer.batchSize, 12);
  assert.equal(restored.getView().transfer.reservedAmount, 0);
  game.tick(3.997); restored.tick(3.997);
  assert.deepEqual(comparable(restored), comparable(game));
  assertConserved(restored);
});

test('normal and experiment saves cannot cross mode boundaries or mutate their input objects', () => {
  const normal = new Game({ now: 0 }); normal.tick(30);
  const p0 = create(); p0.tick(3); transfer(p0); p0.tick(2);
  const normalSave = normal.exportSave(0), p0Save = p0.exportSave(0);
  const originalNormal = JSON.stringify(normalSave), originalP0 = JSON.stringify(p0Save);
  for (const recovered of [create({ save: normalSave }), new Game({ save: p0Save, now: 0 })]) {
    assert.ok(recovered.loadWarning);
    assert.equal(recovered.state.coins, 0);
    assert.equal(recovered.state.totalSold, 0);
  }
  assert.equal(JSON.stringify(normalSave), originalNormal);
  assert.equal(JSON.stringify(p0Save), originalP0);
  const disguised = copy(p0Save); disguised.version = CONFIG.version;
  assert.ok(new Game({ save: disguised, now: 0 }).loadWarning);
});

test('experiment restore rejects invalid input amounts, transfer accounting and unsupported generations', () => {
  const game = create(); game.tick(10); transfer(game);
  const mutations = [
    save => { save.inputs.cup++; },
    save => { save.inputs.cup = -1; },
    save => { save.inputs.cup = .5; },
    save => { save.inputs.cup = 13; },
    save => { delete save.inputs; },
    save => { save.transfer.transferredAmount++; },
    save => { save.transfer.completedTransfers = 0; },
    save => { save.transfer.completedTransfers = 100; },
    save => { save.machine = 1; },
    save => { delete save.experiment; }
  ];
  for (const mutate of mutations) {
    const save = game.exportSave(0); mutate(save);
    const restored = create({ save });
    assert.ok(restored.loadWarning);
    assert.equal(restored.state.totalSold, 0);
    assertConserved(restored);
  }
});

test('experiment blocks expansion even after genuine sales and keeps first-generation upgrades usable', () => {
  const game = create();
  for (let i = 0; i < 150; i++) {
    game.tick(2);
    transfer(game);
    if (game.state.upgrades.cup === 0 && game.state.coins >= 30) assert.equal(game.buyUpgrade('cup').ok, true);
  }
  assert.ok(game.state.totalSold > 100);
  assert.ok(game.state.coins >= 180);
  const before = copy(game.state);
  assert.equal(game.getView().expansion.ready, false);
  assert.equal(game.getView().expansion.reason, 'experiment-complete');
  assert.equal(game.evolve().reason, 'experiment-complete');
  assert.deepEqual(game.state, before);
  assert.equal(game.state.machine, 0);
  assertConserved(game);
});

test('same command times at coarse, 60 Hz and uneven frame rates produce identical saved states', () => {
  const games = [create(), create(), create()];
  for (let step = 0; step < 50; step++) {
    games[0].tick(2);
    for (let frame = 0; frame < 120; frame++) games[1].tick(1 / 60);
    for (let repeat = 0; repeat < 4; repeat++) for (const dt of [.003, .017, .13, .35]) games[2].tick(dt);
    for (const game of games) {
      const reservation = game.reserveTransfer();
      if (reservation.ok) {
        if (step % 7 === 0) game.cancelTransfer(reservation.token);
        else game.commitTransfer(reservation.token);
      }
      if (step === 20) game.buyUpgrade('cup');
      assertConserved(game);
    }
  }
  assert.deepEqual(comparable(games[1]), comparable(games[0]));
  assert.deepEqual(comparable(games[2]), comparable(games[0]));
});

test('varied transfer, cancel, invalid-token and reload sequences conserve every portion and coin', () => {
  let game = create(), seed = 47273;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
  for (let i = 0; i < 600; i++) {
    game.tick((random() % 240) / CONFIG.ticksPerSecond);
    const reservation = game.reserveTransfer();
    if (reservation.ok) {
      if (i % 5 === 0) game.cancelTransfer(reservation.token);
      else {
        assert.equal(game.commitTransfer('stale').ok, false);
        game.commitTransfer(reservation.token);
        assert.equal(game.commitTransfer(reservation.token).ok, false);
      }
    }
    if (i % 13 === 0) for (const id of CONFIG.stationIds) game.buyUpgrade(id);
    if (i % 17 === 0) {
      const before = comparable(game);
      game = create({ save: before });
      assert.equal(game.loadWarning, null);
      assert.deepEqual(comparable(game), before);
    }
    assertConserved(game);
  }
  assert.ok(game.state.totalSold > 0);
});
