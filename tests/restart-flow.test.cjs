'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/core');
const { harness, START } = require('./app-harness.cjs');
const { legacyGame } = require('./legacy-fixture.cjs');

function progressedGame() {
  const game = legacyGame({ now: START });
  Object.assign(game.state, { coins: 5000, totalCoins: 20000, machine: 2, orderIndex: 7,
    brandLevel: 2, playedSeconds: 120, upgrades: { tap: 5, auto: 4, value: 3 },
    settings: { sound: false, haptics: false } });
  return harness({ save: game.exportSave(START) });
}

test('restart clears saved progress and resumes fresh onboarding across reloads', () => {
  const h = progressedGame();
  h.click('settings'); h.click('restart');
  assert.equal(h.ui().modal.type, 'restart');
  h.click('confirmRestart');
  const fresh = new Game({ now: START }).exportSave(START);
  assert.deepEqual(h.saves.at(-1), fresh);
  assert.equal(h.ui().modal, null);
  assert.equal(h.snapshot().onboarding.goal.action, 'tap');
  assert.equal(h.ui().startup, false);
  h.hide(); h.show();
  assert.deepEqual(h.snapshot().state, fresh);
  const reloaded = harness({ save: h.saves.at(-1) });
  assert.deepEqual(reloaded.snapshot().state, fresh);
  assert.equal(reloaded.ui().modal, null);
  assert.equal(reloaded.snapshot().onboarding.goal.action, 'tap');
});

test('restart only deletes after confirmation; cancel and close preserve progress', () => {
  const h = progressedGame(), before = h.snapshot().state;
  h.click('confirmRestart');
  h.click('settings'); h.click('restart'); h.click('settings');
  assert.equal(h.ui().modal.type, 'settings');
  assert.deepEqual(h.snapshot().state, before);
  h.click('restart'); h.click('close'); h.click('confirmRestart');
  assert.deepEqual(h.snapshot().state, before);
});

test('restart preserves the current game when the new save cannot be written', () => {
  const h = progressedGame(), before = h.snapshot().state;
  h.click('settings'); h.click('restart'); h.setSaveFailure(true); h.click('confirmRestart');
  assert.equal(h.ui().modal.type, 'restart');
  assert.match(h.ui().toast, /删除失败/);
  assert.deepEqual(h.snapshot().state, before);
  assert.deepEqual(h.saves.at(-1), before);
});
