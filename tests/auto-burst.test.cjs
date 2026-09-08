'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG, QUEST_CHAPTERS } = require('../src/core');
const NOW = 1000000;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);
function factory(energy = 0) {
  const game = new Game({ now: NOW });
  game.state.bursts = 1; game.state.energy = energy;
  game.state.upgrades = { tap: 4, auto: 3, value: 2 };
  game.state.claimedQuests = QUEST_CHAPTERS.flatMap(chapter => chapter.quests.map(q => q.id));
  return game;
}
function advance(game, seconds, step = 60) {
  const events = [];
  while (seconds > 1e-8) { const dt = Math.min(step, seconds); game.tick(dt); events.push(...game.drainEvents()); seconds -= dt; }
  return events;
}
function baseBurst(game) {
  const p = game.getView().production;
  return { amount: p.tap * 24 + p.baseAuto * 8, price: p.price };
}

test('the first full pot pays the original automatic reward without introducing a timing action', () => {
  const game = new Game({ now: NOW }); game.state.energy = 95;
  assert.equal(typeof game.tryPerfectBurst, 'undefined');
  assert.equal(Object.hasOwn(game.getView(), 'timing'), false);
  game.tick(5);
  const events = game.drainEvents(), burst = events.find(event => event.type === 'burst');
  close(burst.amount, 24 + .4 * 8); assert.equal(burst.source, 'pot');
  assert.equal(game.state.bursts, 1); assert.equal(game.state.energy, 0);
  assert.equal(events.some(event => event.type === 'timing'), false);
  assert.equal(Object.hasOwn(burst, 'perfect'), false); assert.equal(Object.hasOwn(burst, 'bonusAmount'), false);
});

test('normal early-game production keeps its free payout and automatic teaching rewards separate', () => {
  const game = new Game({ now: NOW });
  for (let i = 0; i < 200; i++) { game.tap(); game.tap(); game.tick(1); }
  const expected = 400 + .4 * 200 + 10 * (24 + .4 * 8);
  close(game.state.totalProduced, expected); close(game.state.coins, expected + 8);
  assert.ok(game.state.claimedQuests.includes('start-taps')); assert.equal(game.state.bursts, 10); assert.equal(game.state.energy, 0);
});

for (const energy of [0, 79.999, 80, 92, 98, 99.999]) {
  test(`a pot at ${energy} energy waits until the full threshold and pays once`, () => {
    const game = factory(energy), base = baseBurst(game), missing = CONFIG.energyMax - energy;
    const partial = advance(game, missing / 2);
    assert.equal(game.state.bursts, 1); assert.equal(partial.some(event => event.type === 'burst'), false);
    const events = advance(game, missing / 2), bursts = events.filter(event => event.type === 'burst');
    assert.equal(bursts.length, 1); close(bursts[0].amount, base.amount);
    assert.equal(game.state.bursts, 2); close(game.state.energy, 0);
    const produced = events.find(event => event.type === 'produce' && event.source === 'burst');
    close(bursts[0].amount, produced.amount); close(bursts[0].coins, produced.coins);
    assert.equal(advance(game, 1).some(event => event.type === 'burst'), false);
  });
}

test('coarse and fine advancement settle the same automatic pots and physical output', () => {
  const coarse = factory(92), fine = factory(92), base = baseBurst(coarse);
  const events = advance(coarse, 308, 60); advance(fine, 308, .25);
  for (const key of ['coins', 'totalProduced', 'energy', 'bursts']) close(coarse.state[key], fine.state[key]);
  const bursts = events.filter(event => event.type === 'burst');
  assert.equal(bursts.length, 4); bursts.forEach(burst => close(burst.amount, base.amount));
});

test('one large energy batch settles every full pot and retains the remaining energy', () => {
  const game = factory(0), base = baseBurst(game); game._addEnergy(250);
  const bursts = game.drainEvents().filter(event => event.type === 'burst');
  assert.equal(bursts.length, 2); bursts.forEach(burst => close(burst.amount, base.amount));
  assert.equal(game.state.energy, 50);
});

test('saved energy and previously paid bonuses survive reload without reviving manual ignition', () => {
  const game = factory(95), save = game.exportSave(NOW), base = baseBurst(game);
  save.coins += base.amount * 1.2 * base.price; save.totalProduced += base.amount * 1.2;
  save.timing = { armed: true, attempted: true }; save._timingArmed = true;
  save.onboarding.seen.push('timing');
  const restored = new Game({ save, now: NOW });
  close(restored.state.coins, save.coins); close(restored.state.totalProduced, save.totalProduced);
  close(restored.state.energy, 95);
  assert.doesNotMatch(JSON.stringify(restored.exportSave(NOW)), /timing|perfect|armed|attempted/);
  restored.drainEvents();
  const bursts = advance(restored, 5).filter(event => event.type === 'burst');
  assert.equal(bursts.length, 1); close(bursts[0].amount, base.amount);
});

test('automatic burst output includes permanent growth and excludes temporary turbo multiplication', () => {
  const game = factory(96); Object.assign(game.state, { machine: 1, brandLevel: 2, boostSeconds: 90 });
  const base = baseBurst(game); game.tick(1);
  const burst = game.drainEvents().find(event => event.type === 'burst');
  close(burst.amount, base.amount); close(burst.coins, base.amount * base.price);
  assert.equal(game.state.energy, 0);
});

test('completed retired artisan commissions settle once while preserving previously earned coins', () => {
  for (const perfect of [1, 2]) {
    const game = factory(); Object.assign(game.state, { orderIndex: 10, machine: 3, totalProduced: CONFIG.orders[9].target,
      coins: 1000, totalCoins: 1000, upgrades: { tap: 16, auto: 14, value: 14 } });
    const basis = game._commissionBasis(), option = game._legacyCommissionOption('artisan', basis, 0, 10);
    const save = game.exportSave(NOW); delete save.factory;
    save.commissions = { orderIndex: 10, serial: 1, claimed: 0,
      active: { ...option, basis, perfect, recovery: option.recoveryTarget, production: 0 } };
    const restored = new Game({ save, now: NOW });
    close(restored.state.coins, 1000 + (perfect === 2 ? option.reward : 0));
    assert.equal(restored.state.commissions.active, null);
    const reloaded = new Game({ save: restored.exportSave(NOW), now: NOW });
    close(reloaded.state.coins, restored.state.coins);
  }
});
