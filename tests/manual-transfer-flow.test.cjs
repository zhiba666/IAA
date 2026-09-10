'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./app-harness.cjs');
const experiment = 'manual-transfer-p0';
function setup() {
  const h = harness({ config: { experiment } });
  h.run(3);
  return h;
}
function conserved(h) {
  const s = h.snapshot().state;
  const wip = Object.values(s.stations).reduce((sum, st) => sum + st.jobs.reduce((n, j) => n + (j?.amount || 0), 0), 0);
  assert.equal(s.totalProduced, s.totalSold + s.buffers.pop + s.buffers.cup + s.inputs.cup + wip);
  assert.equal(s.coins + s.totalSpent, s.totalEarned);
}
test('P0 real entry requires transfer, accepts source then target taps, and settles only actual sales', () => {
  const h = setup();
  assert.equal(h.snapshot().state.totalSold, 0);
  assert.equal(h.snapshot().state.version, 3);
  assert.equal(h.lastView().insights.stableRate, 0);
  h.click('transfer:source');
  assert.equal(h.ui().transfer.amount, 4);
  assert.equal(h.snapshot().state.buffers.pop, 12, 'reservation is still in source');
  h.click('transfer:target');
  assert.equal(h.ui().transfer, null);
  assert.equal(h.snapshot().state.coins, 0, 'dropping never awards cash');
  h.run(3);
  assert.equal(h.snapshot().state.totalSold, 4);
  assert.equal(h.snapshot().state.coins, 4);
  assert.equal(h.ui().newFactory, false);
  conserved(h);
  h.click('transfer:source');
  assert.equal(h.ui().transfer.amount, 12);
  h.click('transfer:target');
  h.run(8);
  assert.equal(h.snapshot().state.totalSold, 16);
  h.run(60);
  assert.equal(h.snapshot().state.totalSold, 16, 'P0 has no automatic first transport');
  conserved(h);
});
test('P0 drag commit is once only and dropping over a machine cannot open its upgrade panel', () => {
  const h = setup();
  h.pointer('down', 'transfer:source');
  h.pointer('move', 'transfer:target', 1, 210, 180);
  assert.equal(h.ui().transfer.dragging, true);
  assert.equal(h.ui().transfer.overTarget, true);
  h.pointer('up', 'transfer:target', 1, 210, 180);
  const state = h.snapshot().state;
  h.pointer('up', 'transfer:target', 1, 210, 180);
  assert.deepEqual(h.snapshot().state, state);
  assert.equal(h.ui().modal, null);
  h.pointer('down', 'transfer:source');
  h.pointer('move', 'station:cup', 1, 230, 190);
  h.pointer('up', 'station:cup', 1, 230, 190);
  assert.equal(h.ui().modal, null);
  assert.equal(h.snapshot().transfer.reservedAmount, 0);
  conserved(h);
});
test('P0 cancellations, multitouch, leaving screen, resize, blur and background release stock safely', async t => {
  const cases = {
    pointerCancel(h) { h.pointer('cancel', 'transfer:source'); },
    secondFinger(h) { h.pointer('down', 'transfer:target', 2); h.pointer('up', 'transfer:target', 2); },
    offscreen(h) { h.pointer('move', null, 1, -20, 90); },
    resize(h) { h.resize(); },
    blur(h) { h.blur(); },
    background(h) { h.hide(); h.show(); },
    settings(h) { h.key('KeyS'); },
    escape(h) { h.key('Escape'); }
  };
  for (const [name, cancel] of Object.entries(cases)) await t.test(name, () => {
    const h = setup(), before = h.snapshot().state;
    h.pointer('down', 'transfer:source'); cancel(h);
    h.pointer('up', 'transfer:target');
    assert.equal(h.ui().transfer, null);
    assert.equal(h.snapshot().transfer.reservedAmount, 0);
    assert.deepEqual(h.snapshot().state, before);
    conserved(h);
  });
});
test('P0 autosave does not interrupt held cargo and lifecycle save restores no reservation', () => {
  const h = setup();
  h.click('transfer:source');
  h.run(6);
  assert.equal(h.ui().transfer.amount, 4);
  h.hide();
  assert.equal(h.snapshot().transfer.reservedAmount, 0);
  h.show(); h.frame(0);
  assert.equal(h.ui().transfer, null);
  const saved = h.saves.at(-1);
  const loaded = harness({ config: { experiment }, save: saved });
  assert.equal(loaded.snapshot().transfer.reservedAmount, 0);
  assert.deepEqual(loaded.snapshot().state.buffers, saved.buffers);
  loaded.click('transfer:source'); loaded.click('transfer:target'); loaded.run(3);
  assert.equal(loaded.snapshot().state.totalSold, 4);
  conserved(loaded);
});

test('resize clears abandoned touch IDs so a new finger can resume without an old up event', () => {
  const h = setup();
  h.pointer('down', 'transfer:source', 1);
  h.resize();
  h.pointer('down', 'transfer:source', 2); h.pointer('up', 'transfer:source', 2);
  assert.equal(h.ui().transfer.amount, 4);
  h.pointer('down', 'transfer:target', 2); h.pointer('up', 'transfer:target', 2);
  h.run(3);
  assert.equal(h.snapshot().state.totalSold, 4);
  conserved(h);
});
test('P0 storage failure keeps transferred stock playable and restart retains experimental mode', () => {
  const h = setup();
  h.setSaveFailure(true);
  h.click('transfer:source'); h.click('transfer:target');
  assert.match(h.ui().toast, /未保存|存储/);
  h.run(3); assert.equal(h.snapshot().state.totalSold, 4);
  h.click('settings'); h.click('restart'); h.click('confirmRestart');
  assert.equal(h.snapshot().state.totalSold, 4);
  h.setSaveFailure(false); h.click('confirmRestart');
  assert.equal(h.snapshot().state.version, 3);
  assert.equal(h.snapshot().state.experiment, experiment);
  assert.equal(h.snapshot().state.totalSold, 0);
  conserved(h);
});
