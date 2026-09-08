'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const { selectHeatGuide } = require('../src/heat-guide');

function factory(energy = 0, unlocked = true) {
  const game = new Game({ now: 1000000 });
  game.state.energy = energy;
  game.state.bursts = unlocked ? 1 : 0;
  return game;
}

for (const [energy, state, canAttempt] of [
  [0, 'heating', false], [79.99, 'heating', false],
  [80, 'ready', true], [91.99, 'ready', true],
  [92, 'perfect', true], [98, 'perfect', true],
  [98.01, 'late', true], [99.9, 'late', true], [100, 'late', false]
]) {
  test(`heat guide preserves exact core boundaries at ${energy} energy`, () => {
    const game = factory(energy), view = game.getView(), guide = selectHeatGuide(view);
    assert.equal(guide.state, state);
    assert.equal(guide.canAttempt, canAttempt);
    assert.equal(guide.canAttempt, view.timing.available);
    assert.equal(guide.energy, energy);
    assert.equal(guide.progress, energy / CONFIG.energyMax);
    assert.equal(guide.windowStart, view.timing.windowStart);
    assert.equal(guide.windowEnd, view.timing.windowEnd);
    assert.ok(guide.title && guide.hint && guide.buttonLabel);
    assert.ok([...guide.buttonLabel].length <= 8);
  });
}

test('the first pot teaches automatic free bursts before exposing a timing attempt', () => {
  for (const energy of [0, 80, 92, 98, 99.9]) {
    const game = factory(energy, false), guide = selectHeatGuide(game.getView());
    assert.equal(guide.state, 'locked');
    assert.equal(guide.canAttempt, false);
    assert.match(guide.title, /自动爆锅/);
    assert.match(guide.hint, /首次爆锅后/);
  }
  const game = factory(99, false);
  game.tick(1);
  assert.equal(selectHeatGuide(game.getView()).state, 'heating');
});

test('heating tells the player the remaining energy and the configured best window', () => {
  assert.match(selectHeatGuide(factory(0).getView()).hint, new RegExp(`${CONFIG.timingAttemptEnergy} 格后`));
  const close = selectHeatGuide(factory(CONFIG.timingAttemptEnergy - 0.01).getView());
  assert.match(close.hint, /1 格后/);
  assert.ok(close.hint.includes(`${CONFIG.timingWindowStart}–${CONFIG.timingWindowEnd}`));
});

test('a successful attempt stays visibly armed past the best window until its burst', () => {
  const game = factory(CONFIG.timingWindowStart);
  assert.equal(game.tryPerfectBurst().perfect, true);
  game.tick(CONFIG.timingWindowEnd - CONFIG.timingWindowStart + 1);
  const guide = selectHeatGuide(game.getView());
  assert.equal(guide.state, 'armed');
  assert.equal(guide.canAttempt, false);
  assert.ok(guide.title.includes(`+${CONFIG.timingBonusPercent}%`));
  assert.match(guide.hint, /蓄满后/);
  game.tick(CONFIG.energyMax - game.state.energy);
  assert.equal(selectHeatGuide(game.getView()).state, 'heating');
  assert.equal(game.drainEvents().find(event => event.type === 'burst').perfect, true);
});

test('early and late misses show normal free production and cannot invite another attempt', () => {
  for (const energy of [CONFIG.timingAttemptEnergy, CONFIG.timingWindowEnd + 0.01]) {
    const game = factory(energy);
    assert.equal(game.tryPerfectBurst().perfect, false);
    const guide = selectHeatGuide(game.getView());
    assert.equal(guide.state, 'missed');
    assert.equal(guide.canAttempt, false);
    assert.match(guide.title, /照常爆锅/);
    assert.match(guide.buttonLabel, /已尝试/);
    game.tick(CONFIG.energyMax - energy);
    assert.equal(selectHeatGuide(game.getView()).state, 'heating');
    assert.equal(game.drainEvents().find(event => event.type === 'burst').perfect, false);
  }
});

test('heat selection is read only and tolerates an absent initial view', () => {
  const game = factory(CONFIG.timingWindowStart);
  const view = game.getView(), before = game.exportSave(1000000);
  const viewBefore = JSON.stringify(view);
  Object.freeze(view.timing); Object.freeze(view);
  selectHeatGuide(view);
  assert.equal(JSON.stringify(view), viewBefore);
  assert.deepEqual(game.exportSave(1000000), before);
  assert.deepEqual(game.drainEvents(), []);
  const empty = selectHeatGuide();
  assert.equal(empty.state, 'locked');
  assert.equal(empty.progress, 0);
  assert.equal(empty.canAttempt, false);
});