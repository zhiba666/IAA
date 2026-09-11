'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./app-harness.cjs');
const { Game } = require('../src/core');
const config = { mode: 'v15' };
function setup() { const h = harness({ config }); h.run(3); return h; }
function transfer(h, source) {
  h.drag(`transfer-source-${source}`, `transfer-target-${source === 'pop' ? 'cup' : 'ship'}`);
}
function conserved(h) {
  const s = h.snapshot().state;
  const wip = Object.values(s.stations).reduce((n, st) => n + st.jobs.reduce((m, j) => m + (j?.amount || 0), 0), 0);
  assert.equal(s.totalProduced, s.totalSold + s.buffers.pop + s.buffers.cup + s.inputs.cup + s.inputs.ship + wip);
  assert.equal(s.coins + s.totalSpent, s.totalEarned);
}
test('v15 real entry requires both transfers and never sells a dropped tray directly', () => {
  const h = setup();
  assert.equal(h.snapshot().mode, 'v15');
  assert.equal(h.snapshot().state.totalSold, 0);
  transfer(h, 'pop'); h.run(3);
  assert.equal(h.snapshot().state.totalSold, 0);
  assert.equal(h.snapshot().state.buffers.cup, 4);
  transfer(h, 'cup');
  assert.equal(h.snapshot().state.coins, 0);
  h.run(2);
  assert.equal(h.snapshot().state.totalSold, 4);
  assert.ok(h.snapshot().state.playedSeconds < 15);
  conserved(h);
});
test('v15 second tray rejects wrong input and cannot open a machine purchase', () => {
  const h = setup(); transfer(h, 'pop'); h.run(3);
  const before = h.snapshot().state;
  h.pointer('down', 'transfer-source-cup');
  h.pointer('move', 'transfer-target-cup', 1, 210, 180);
  assert.equal(h.ui().transfer.overTarget, false);
  h.pointer('up', 'transfer-target-cup', 1, 210, 180);
  assert.equal(h.ui().transfer, null);
  assert.deepEqual(h.snapshot().state, before);
  h.pointer('down', 'transfer-source-cup');
  h.pointer('move', 'station:ship', 1, 210, 180);
  h.pointer('up', 'station:ship', 1, 210, 180);
  assert.equal(h.ui().modal, null);
  h.pointer('down', 'transfer-source-cup');
  h.pointer('move', 'transfer-target-ship', 1, 210, 180);
  assert.equal(h.ui().transfer.overTarget, true);
  h.pointer('up', 'transfer-target-ship', 1, 210, 180);
  const committed = h.snapshot().state;
  h.pointer('up', 'transfer-target-ship', 1, 210, 180);
  assert.deepEqual(h.snapshot().state, committed);
  h.run(2); assert.equal(h.snapshot().state.totalSold, 4); conserved(h);
});
test('v15 both source paths survive lifecycle, second fingers and settings cancellation', () => {
  for (const source of ['pop', 'cup']) for (const cancel of [
    h => h.pointer('cancel', null), h => h.resize(), h => h.blur(),
    h => { h.hide(); h.show(); }, h => h.key('KeyS'),
    h => { h.pointer('down', null, 2); h.pointer('up', null, 2); }
  ]) {
    const h = setup(); transfer(h, 'pop'); h.run(3);
    const before = h.snapshot().state;
    h.pointer('down', `transfer-source-${source}`);
    h.pointer('move', null, 1, 120, 120); cancel(h);
    h.pointer('up', `transfer-target-${source === 'pop' ? 'cup' : 'ship'}`);
    assert.equal(h.ui().transfer, null);
    assert.deepEqual(h.snapshot().state, before);
    conserved(h);
  }
});
test('v2 migration activates only after save succeeds, then resumes with both connections automated', () => {
  const old = new Game({ now: 1800000000000 }); old.tick(40);
  const original = old.exportSave(1800000000000);
  const h = harness({ config, save: original, saveFailure: true });
  assert.equal(h.snapshot().state.version, 2);
  h.run(2);
  assert.ok(h.snapshot().state.totalSold > original.totalSold, 'write failure keeps original factory running');
  const current = h.snapshot().state;
  h.setSaveFailure(false); h.hide(); h.show(); h.frame(0);
  assert.equal(h.snapshot().state.version, 4);
  assert.equal(h.snapshot().state.economyProfile, 'legacy');
  assert.equal(h.snapshot().state.totalSold, current.totalSold);
  assert.ok(h.snapshot().transfers.every(t => t.automated));
  assert.equal(h.saves.at(-1).version, 4);
  conserved(h);
});
test('default main mode is v15 and restarting retains the complete game mode', () => {
  const h = harness({ config: { mode: undefined } });
  assert.equal(h.snapshot().state.version, 4);
  h.click('settings'); h.click('restart'); h.click('confirmRestart');
  assert.equal(h.snapshot().state.version, 4);
  assert.ok(h.snapshot().transfers.every(t => !t.automated));
});
