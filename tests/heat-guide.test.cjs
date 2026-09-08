'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const { legacyGame } = require('./legacy-fixture.cjs');
const { selectHeatGuide } = require('../src/heat-guide');

function factory(energy = 0, bursts = 1) {
  const game = new Game({ now: 1000000 });
  game.state.energy = energy; game.state.bursts = bursts;
  return game;
}

test('energy guidance uses the same automatic cycle before and after the first burst', () => {
  for (const bursts of [0, 1, 100]) for (const energy of [0, 79.99, 80, 91.99, 92, 98, 98.01, 99.9, 100]) {
    const guide = selectHeatGuide(factory(energy, bursts).getView());
    assert.equal(guide.state, 'heating'); assert.equal(guide.energy, energy);
    assert.equal(guide.progress, energy / CONFIG.energyMax);
    assert.match(guide.title, /自动爆锅/); assert.match(guide.hint, /自动出锅/);
    assert.doesNotMatch(JSON.stringify(guide), /canAttempt|windowStart|windowEnd|完美|提前|最佳/);
  }
});

test('energy guidance reports remaining charge and starts the next cycle after automatic payout', () => {
  assert.match(selectHeatGuide(factory(0).getView()).hint, /100 格后/);
  const game = factory(99);
  assert.match(selectHeatGuide(game.getView()).hint, /1 格后/);
  game.tick(1);
  const guide = selectHeatGuide(game.getView());
  assert.equal(guide.state, 'heating'); assert.equal(guide.energy, 0);
  assert.match(guide.hint, /100 格后/);
  assert.equal(game.drainEvents().filter(event => event.type === 'burst').length, 1);
});

test('an empty equipped pressure tank explains that the next full pot is stored', () => {
  const game = legacyGame({ now: 1000000 });
  game.state.machine = 2; game.state.energy = 80;
  game.state.factory.owned.push('pressure'); game.setPressureMode('hold');
  const guide = selectHeatGuide(game.getView());
  assert.equal(guide.state, 'heating'); assert.match(guide.title, /自动储锅/);
  assert.match(guide.hint, /20 格后存入蓄压罐/);
  game.tick(4);
  assert.equal(selectHeatGuide(game.getView()).state, 'stored');
});

test('stored-pressure guidance explains release while ordinary production can continue', () => {
  const game = legacyGame({ now: 1000000 });
  game.state.energy = 99; game.state.bursts = 1; game.state.machine = 2;
  game.state.factory.owned.push('pressure'); game.setPressureMode('hold'); game.tick(1);
  const before = game.exportSave(1000000), guide = selectHeatGuide(game.getView());
  assert.equal(guide.state, 'stored'); assert.match(guide.buttonLabel, /放出/); assert.match(guide.hint, /仍会继续/);
  assert.deepEqual(game.exportSave(1000000), before);
  game.releasePressure(); assert.equal(selectHeatGuide(game.getView()).state, 'heating');
});

test('heat selection is read only and tolerates absent or malformed initial energy', () => {
  const game = factory(92), view = game.getView(), before = game.exportSave(1000000), viewBefore = JSON.stringify(view);
  Object.freeze(view.factory); Object.freeze(view);
  selectHeatGuide(view);
  assert.equal(JSON.stringify(view), viewBefore); assert.deepEqual(game.exportSave(1000000), before);
  assert.deepEqual(game.drainEvents(), []);
  const empty = selectHeatGuide();
  assert.equal(empty.state, 'heating'); assert.equal(empty.progress, 0);
  for (const energy of [undefined, '92', NaN, Infinity, -5]) assert.equal(selectHeatGuide({ energy }).progress, 0);
  assert.equal(selectHeatGuide({ energy: 101 }).progress, 1);
});
