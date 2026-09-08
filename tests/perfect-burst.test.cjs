'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');

const NOW = 1000000;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);
function factory(energy = 92) {
  const game = new Game({ now: NOW });
  game.state.bursts = 1; game.state.energy = energy;
  game.state.upgrades = { tap: 4, auto: 3, value: 2 };
  return game;
}
function advance(game, seconds, step = 60) {
  while (seconds > 0) { const dt = Math.min(step, seconds); game.tick(dt); seconds -= dt; }
}
function baseBurst(game) {
  const p = game.getView().production;
  return { amount: p.tap * 24 + p.baseAuto * 8, price: p.price };
}

test('timing opens only after the first free burst and never interrupts its original reward', () => {
  const game = new Game({ now: NOW }); game.state.energy = 95;
  assert.equal(game.getView().timing.unlocked, false);
  assert.deepEqual(game.tryPerfectBurst(), { ok: false, perfect: false, reason: 'timing-locked' });
  assert.deepEqual(game.drainEvents(), [], 'locked input is not a timing attempt');
  game.tick(5);
  const burst = game.drainEvents().find(e => e.type === 'burst');
  close(burst.amount, 24 + 0.4 * 8);
  assert.equal(burst.perfect, false); assert.equal(burst.bonusAmount, 0);
  assert.equal(game.getView().timing.unlocked, true);
  assert.equal(game.getView().timing.available, false);
  game.tick(60); game.tick(20);
  assert.equal(game.getView().timing.available, true);
});

test('normal taps and ticks retain the original free economy without timing attempts', () => {
  const game = new Game({ now: NOW });
  for (let i = 0; i < 200; i++) { game.tap(); game.tap(); game.tick(1); }
  const bursts = 10, expected = 400 + 0.4 * 200 + bursts * (24 + 0.4 * 8);
  close(game.state.totalProduced, expected); close(game.state.coins, expected);
  assert.equal(game.state.bursts, bursts); assert.equal(game.state.energy, 0);
  assert.ok(game.drainEvents().filter(e => e.type === 'burst').every(e => !e.perfect && e.bonusAmount === 0));
});

test('timing availability uses the 80 to below-100 range and normalized view coordinates', () => {
  for (const [energy, available] of [[0, false], [79.999, false], [80, true], [92, true], [98, true], [99.999, true], [100, false]]) {
    const game = factory(energy), timing = game.getView().timing;
    assert.equal(timing.available, available, String(energy));
    close(timing.progress, energy / 100);
    assert.equal(timing.windowStart, .92); assert.equal(timing.windowEnd, .98); assert.equal(timing.bonusPercent, 20);
    if (!available) {
      assert.equal(game.tryPerfectBurst().reason, 'timing-not-ready');
      assert.equal(game.getView().timing.attempted, false);
      assert.deepEqual(game.drainEvents(), [], 'unavailable input is not a timing attempt');
    }
  }
});

for (const energy of [92, 95, 98]) {
  test(`perfect timing at energy ${energy} pays exactly 20% extra on the next free burst only`, () => {
    const game = factory(energy), base = baseBurst(game), before = game.exportSave(NOW);
    assert.deepEqual(game.tryPerfectBurst(), { ok: true, perfect: true, reason: '' });
    assert.deepEqual(game.exportSave(NOW), before, 'arming cannot award, charge or change energy');
    assert.equal(game.getView().timing.armed, true);
    assert.equal(game.getView().timing.available, false);
    assert.deepEqual(game.drainEvents(), [{ type: 'timing', perfect: true, energy, bonusPercent: 20, burstNumber: 2 }]);
    game.tick(100 - energy);
    const events = game.drainEvents(), burst = events.find(e => e.type === 'burst'), produced = events.find(e => e.type === 'produce' && e.source === 'burst');
    close(burst.amount, base.amount * 1.2); close(burst.bonusAmount, base.amount * .2);
    close(burst.coins, burst.amount * base.price); close(produced.amount, burst.amount);
    close(game.state.coins, events.filter(e => e.type === 'produce').reduce((sum, e) => sum + e.coins, 0));
    assert.equal(burst.perfect, true);
    assert.equal(game.getView().timing.armed, false); assert.equal(game.getView().timing.attempted, false);
    advance(game, 100);
    const next = game.drainEvents().find(e => e.type === 'burst');
    close(next.amount, base.amount); assert.equal(next.perfect, false); assert.equal(next.bonusAmount, 0);
  });
}

test('early and late attempts spend the one chance without charging, delaying or reducing the free burst', () => {
  for (const energy of [80, 91.999, 98.001, 99.999]) {
    const game = factory(energy), base = baseBurst(game), before = game.exportSave(NOW);
    assert.deepEqual(game.tryPerfectBurst(), { ok: true, perfect: false, reason: 'timing-missed' });
    assert.deepEqual(game.exportSave(NOW), before);
    assert.equal(game.getView().timing.attempted, true); assert.equal(game.getView().timing.armed, false);
    assert.equal(game.tryPerfectBurst().reason, 'timing-already-attempted');
    assert.deepEqual(game.drainEvents(), [{ type: 'timing', perfect: false, energy, bonusPercent: 0, burstNumber: 2 }], 'one legal miss is recorded and repeated input adds nothing');
    game.tick(100 - energy);
    const burst = game.drainEvents().find(e => e.type === 'burst');
    assert.ok(burst, 'normal burst remains on its original energy threshold');
    close(burst.amount, base.amount); assert.equal(burst.perfect, false); assert.equal(burst.bonusAmount, 0);
  }
});

test('repeated timing input cannot stack a bonus, and the next energy cycle receives one new chance', () => {
  const game = factory(), base = baseBurst(game);
  assert.equal(game.tryPerfectBurst().perfect, true);
  for (let i = 0; i < 10; i++) assert.equal(game.tryPerfectBurst().reason, 'timing-already-attempted');
  assert.equal(game.drainEvents().filter(e => e.type === 'timing').length, 1);
  game.tick(8);
  close(game.drainEvents().find(e => e.type === 'burst').bonusAmount, base.amount * .2);
  advance(game, 92);
  assert.equal(game.getView().timing.available, true);
  assert.equal(game.tryPerfectBurst().perfect, true);
});

test('coarse advancement preserves free burst timing and applies the armed bonus to only its first burst', () => {
  const coarse = factory(), fine = factory(), base = baseBurst(coarse);
  coarse.tryPerfectBurst(); fine.tryPerfectBurst();
  advance(coarse, 300, 60); advance(fine, 300, .25);
  for (const key of ['coins', 'totalProduced', 'energy', 'bursts']) close(coarse.state[key], fine.state[key]);
  const bursts = coarse.drainEvents().filter(e => e.type === 'burst');
  assert.deepEqual(bursts.map(e => e.perfect), [true, false, false]);
  close(bursts[0].bonusAmount, base.amount * .2);
  assert.equal(bursts[1].bonusAmount, 0); assert.equal(bursts[2].bonusAmount, 0);
});

test('multiple bursts processed by one energy batch clear timing before the second burst', () => {
  // Public ticks are capped at 60s, so the normal passive rate cannot emit two
  // bursts in one tick. Exercise the energy loop directly for the batched edge.
  const game = factory(); game.tryPerfectBurst(); game._addEnergy(250);
  const bursts = game.drainEvents().filter(e => e.type === 'burst');
  assert.deepEqual(bursts.map(e => e.perfect), [true, false, false]);
  assert.equal(game.getView().timing.armed, false);
});

test('temporary attempt and bonus never enter saves, and restarting discards the unearned bonus', () => {
  for (const energy of [85, 95]) {
    const game = factory(energy); game.tryPerfectBurst();
    const save = game.exportSave(NOW);
    assert.doesNotMatch(JSON.stringify(save), /timing|perfect|armed|attempted/);
    const restored = new Game({ save, now: NOW }), base = baseBurst(restored);
    assert.equal(restored.getView().timing.attempted, false); assert.equal(restored.getView().timing.armed, false);
    restored.tick(100 - energy);
    const burst = restored.drainEvents().find(e => e.type === 'burst');
    close(burst.amount, base.amount); assert.equal(burst.perfect, false);
  }
});

test('perfect burst uses the current permanent output and never amplifies the temporary auto turbo twice', () => {
  const game = factory(); game.state.machine = 1; game.state.brandLevel = 2; game.state.boostSeconds = 90;
  game.tryPerfectBurst();
  game.state.upgrades.tap++; game.state.upgrades.auto++;
  const base = baseBurst(game); game.tick(8);
  const burst = game.drainEvents().find(e => e.type === 'burst');
  close(burst.amount, base.amount * 1.2); close(burst.bonusAmount, base.amount * .2);
});
