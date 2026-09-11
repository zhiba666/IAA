'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/core');
const { harness, START } = require('./app-harness.cjs');

const config = { mode: 'v15' };
const sourceAction = source => 'transfer-source-' + source;
const targetAction = source => 'transfer-target-' + (source === 'pop' ? 'cup' : 'ship');
const route = (h, source = 'pop') => h.snapshot().transfers.find(item => item.source === source);
const move = (h, source = 'pop', id = 1) => h.drag(sourceAction(source), targetAction(source), id);

function setup(source = 'pop') {
  const h = harness({ config }); h.run(3);
  if (source === 'cup') { move(h); h.run(3); }
  assert.ok(route(h, source).receivableAmount > 0, 'the requested source has genuinely produced cargo');
  return h;
}

function hold(h, source = 'pop', id = 1) {
  h.pointer('down', sourceAction(source), id, 100, 100);
  h.pointer('move', null, id, 108, 100);
  const held = h.ui().transfer;
  assert.ok(held && held.source === source);
  assert.equal(route(h, source).reservedAmount, held.amount);
  return held;
}

function conserved(h) {
  const s = h.snapshot().state;
  const wip = Object.values(s.stations).reduce((sum, station) => sum + station.jobs.reduce((n, job) => n + (job ? job.amount : 0), 0), 0);
  assert.equal(s.totalProduced, s.totalSold + s.buffers.pop + s.buffers.cup + s.inputs.cup + s.inputs.ship + wip);
  assert.equal(s.coins + s.totalSpent, s.totalEarned);
}

// Build advanced fixtures only by legal production, transfer and purchase calls.
// Every exported fixture is loaded by the real validator before main uses it.
let manualSave, semiAutomaticSave;
function fundedManualSave() {
  if (!manualSave) {
    const game = new Game({ mode: 'v15', now: START });
    for (let i = 0; i < 480; i++) {
      game.tick(.5);
      for (const source of ['pop', 'cup']) {
        const claim = game.reserveTransfer(source);
        if (claim.ok) assert.equal(game.commitTransfer(claim.token).ok, true);
      }
      game.drainEvents();
    }
    manualSave = game.exportSave(START);
    assert.equal(new Game({ mode: 'v15', save: manualSave, now: START }).loadWarning, null);
  }
  return manualSave;
}

function competingSave() {
  if (!semiAutomaticSave) {
    const game = new Game({ mode: 'v15', save: fundedManualSave(), now: START });
    assert.equal(game.loadWarning, null);
    assert.equal(game.buyUpgrade('cup').ok, true);
    assert.equal(game.buyUpgrade('cup').ok, true);
    assert.equal(game.buyAutomation('pop').ok, true);
    assert.equal(game.buyLogisticsUpgrade().ok, true);
    let ready = false;
    for (let tick = 0; tick < 480; tick++) {
      game.tick(1 / 120);
      const current = game.getView().transfers[0];
      if (current.canReserve && current.receivableAmount >= 3) { ready = true; break; }
    }
    assert.equal(ready, true, 'legal processing creates space before the next automatic transfer');
    semiAutomaticSave = game.exportSave(START);
    const restored = new Game({ mode: 'v15', save: semiAutomaticSave, now: START });
    assert.equal(restored.loadWarning, null);
    assert.deepEqual(restored.getView().transfers.map(item => item.automated), [true, false]);
    assert.equal(restored.state.logisticsLevel, 1);
  }
  return semiAutomaticSave;
}

test('v1.1 requires 8 logical pixels to reserve; a fast release uses the same threshold once', () => {
  const h = setup(), before = h.snapshot().state;
  h.pointer('down', sourceAction('pop'), 1, 100, 100);
  h.pointer('move', targetAction('pop'), 1, 107, 100);
  assert.equal(route(h).reservedAmount, 0);
  assert.equal(h.ui().transfer, null);
  assert.equal(h.ui().press.source, 'pop');
  h.pointer('move', targetAction('pop'), 1, 108, 100);
  assert.equal(route(h).reservedAmount, 4);
  assert.equal(h.ui().transfer.amount, 4);
  assert.deepEqual(h.snapshot().state, before, 'reservation is not a stock movement or a sale');
  assert.equal(h.analytics.filter(event => event.event === 'transfer_started').length, 1);
  h.pointer('up', targetAction('pop'), 1, 108, 100);
  assert.equal(route(h).manualTransfers, 1);
  assert.equal(route(h).transferredAmount, 4);
  assert.equal(h.snapshot().state.totalSold, 0);
  assert.equal(h.snapshot().state.coins, 0);
  conserved(h);

  for (const distance of [0, 7, 8, 110]) {
    const fast = setup(), original = fast.snapshot().state;
    fast.pointer('down', sourceAction('pop'), 4, 100, 100);
    fast.pointer('up', targetAction('pop'), 4, 100 + distance, 100);
    assert.equal(route(fast).manualTransfers, distance >= 8 ? 1 : 0);
    assert.equal(route(fast).reservedAmount, 0);
    assert.equal(fast.ui().transfer, null);
    if (distance < 8) assert.deepEqual(fast.snapshot().state, original);
    const after = fast.snapshot().state;
    fast.pointer('up', targetAction('pop'), 4, 100 + distance, 100);
    assert.deepEqual(fast.snapshot().state, after, 'duplicate release cannot settle a second batch');
    conserved(fast);
  }
});

test('source taps, target taps and sequential taps never arm either transfer route', () => {
  const h = setup('cup'), before = h.snapshot().state;
  for (const source of ['pop', 'cup']) {
    for (const action of [sourceAction(source), targetAction(source), targetAction(source), sourceAction(source), targetAction(source)]) h.click(action);
    assert.equal(route(h, source).reservedAmount, 0);
  }
  assert.deepEqual(h.snapshot().state, before);
  assert.equal(h.ui().transfer, null); assert.equal(h.ui().press, null); assert.equal(h.ui().modal, null);
  conserved(h);
});

test('three fingers lock transfers until every contact has been released across different release orders', () => {
  for (const releaseOrder of [[1, 2, 3], [2, 1, 3], [3, 2, 1]]) {
    const h = setup(), before = h.snapshot().state;
    hold(h, 'pop', 1);
    h.pointer('down', targetAction('pop'), 2, 200, 180);
    h.pointer('down', sourceAction('pop'), 3, 100, 100);
    assert.equal(route(h).reservedAmount, 0);
    assert.equal(h.ui().transfer, null);
    for (let i = 0; i < releaseOrder.length; i++) {
      const id = releaseOrder[i];
      h.pointer('move', targetAction('pop'), id, 210, 180);
      h.pointer('up', targetAction('pop'), id, 210, 180);
      assert.deepEqual(h.snapshot().state, before, 'partial contact release cannot reactivate an old drag');
    }
    move(h, 'pop', 8);
    assert.equal(route(h).manualTransfers, 1, 'a fresh gesture works after the entire contact set is empty');
    conserved(h);
  }
});

test('mismatched IDs cannot move or commit held cargo, while duplicate downs cancel and duplicate ups are inert', () => {
  const h = setup(), held = hold(h, 'pop', 11), before = h.snapshot().state;
  h.pointer('move', targetAction('pop'), 77, 210, 180);
  h.pointer('up', targetAction('pop'), 77, 210, 180);
  assert.equal(h.ui().transfer.token, held.token);
  assert.deepEqual(h.snapshot().state, before);
  h.pointer('up', targetAction('pop'), 11, 210, 180);
  const committed = h.snapshot().state;
  for (const id of [11, 77, 0]) h.pointer('up', targetAction('pop'), id, 210, 180);
  assert.deepEqual(h.snapshot().state, committed);

  hold(h, 'pop', 21);
  const duplicateBefore = h.snapshot().state;
  h.pointer('down', sourceAction('pop'), 21, 100, 100);
  h.pointer('move', targetAction('pop'), 21, 210, 180);
  h.pointer('up', targetAction('pop'), 21, 210, 180);
  assert.equal(route(h).reservedAmount, 0);
  assert.deepEqual(h.snapshot().state, duplicateBefore);
  move(h, 'pop', 22);
  assert.equal(route(h).manualTransfers, 2);
  conserved(h);
});

test('invalid coordinates and interruption boundaries release A/B cargo without delayed commits', async t => {
  const cancellations = {
    NaN(h, source) { h.pointer('move', targetAction(source), 9, NaN, 180); },
    outsideMove(h) { h.pointer('move', null, 9, -1, 100); },
    outsideRelease(h, source) { h.pointer('up', targetAction(source), 9, h.info.width + 1, 180); },
    wrongTarget(h, source) { const wrong = source === 'pop' ? 'transfer-target-ship' : 'transfer-target-cup'; h.pointer('up', wrong, 9, 210, 180); },
    pointerCancel(h) { h.pointer('cancel', null, 9); },
    resize(h) { h.resize(); },
    blur(h) { h.blur(); },
    hide(h) { h.hide(); h.show(); h.frame(0); },
    stalled(h) { h.frame(1001); }
  };
  for (const source of ['pop', 'cup']) for (const [name, cancel] of Object.entries(cancellations)) await t.test(source + ': ' + name, () => {
    const h = setup(source), before = h.snapshot().state;
    hold(h, source, 9); cancel(h, source);
    assert.equal(route(h, source).reservedAmount, 0);
    h.pointer('move', targetAction(source), 9, 210, 180);
    h.pointer('up', targetAction(source), 9, 210, 180);
    h.pointer('up', targetAction(source), 9, 210, 180);
    assert.deepEqual(h.snapshot().state, before);
    assert.equal(h.ui().transfer, null); assert.equal(h.ui().press, null); assert.equal(h.ui().modal, null);
    conserved(h);
  });
});

test('empty source drags never reserve cargo or fall through into a machine modal', () => {
  for (const source of ['pop', 'cup']) {
    const h = harness({ config }), before = h.snapshot().state;
    assert.equal(route(h, source).availableAmount, 0);
    h.pointer('down', sourceAction(source), 1, 100, 100);
    h.pointer('move', 'station:' + (source === 'pop' ? 'cup' : 'ship'), 1, 210, 180);
    h.pointer('up', 'station:' + (source === 'pop' ? 'cup' : 'ship'), 1, 210, 180);
    assert.equal(h.ui().transfer, null); assert.equal(h.ui().modal, null);
    assert.equal(route(h, source).reservedAmount, 0);
    assert.deepEqual(h.snapshot().state, before);
    assert.ok(h.analytics.some(event => event.event === 'transfer_invalid' && event.data.source === source && event.data.reason === 'source-empty'));
    conserved(h);
  }
});

test('modal input blocks background actions; a content swipe scrolls without purchasing its starting button', () => {
  const layout = { modal: { content: { x: 40, y: 200, w: 300, h: 200, scrollMax: 240 } } };
  const h = harness({ config, save: fundedManualSave(), layout });
  h.click('openLogistics');
  const quote = h.ui().quotes['automate-pop'], before = h.snapshot().state;
  assert.ok(quote && before.coins >= quote.cost, 'the swipe starts on an affordable real automation quote');
  h.click('station:ship'); h.click('settings'); move(h);
  assert.equal(h.ui().modal.type, 'logistics');
  assert.deepEqual(h.ui().quotes['automate-pop'], quote);
  assert.equal(route(h).reservedAmount, 0);
  h.pointer('down', quote.action, 1, 100, 260);
  h.pointer('move', quote.action, 1, 100, 220);
  h.pointer('up', quote.action, 1, 100, 220);
  assert.equal(h.ui().modal.scroll, 40);
  assert.deepEqual(h.snapshot().state, before, 'scrolling cannot buy even with an unchanged button action at release');
  assert.deepEqual(h.ui().quotes['automate-pop'], quote);
  conserved(h);
});

test('wheel scroll is restricted to current modal content, clamped, and ignored while hidden or closed', () => {
  const layout = { modal: { content: { x: 40, y: 200, w: 300, h: 200, scrollMax: 240 } } };
  const h = harness({ config, save: fundedManualSave(), layout }), before = h.snapshot().state;
  h.scroll(100, 250, 80); assert.equal(h.ui().modal, null);
  h.click('openLogistics');
  for (const point of [[39, 250], [341, 250], [100, 199], [100, 401]]) h.scroll(point[0], point[1], 80);
  assert.equal(h.ui().modal.scroll, 0);
  h.scroll(100, 250, 80); assert.equal(h.ui().modal.scroll, 80);
  h.scroll(100, 250, 10000); assert.equal(h.ui().modal.scroll, 240);
  h.scroll(100, 250, -10000); assert.equal(h.ui().modal.scroll, 0);
  h.hide(); h.scroll(100, 250, 80); h.show(); h.frame(0);
  assert.equal(h.ui().modal.scroll, 0);
  h.click('close'); h.scroll(100, 250, 80);
  assert.equal(h.ui().modal, null);
  assert.deepEqual(h.snapshot().state, before);
  conserved(h);
});

test('A/B tutorials wait for real stock, retry an unsuccessful lesson and stop after its first successful delivery', () => {
  const h = harness({ config });
  assert.equal(route(h).availableAmount, 0); assert.equal(h.ui().tutorial, null);
  function waitForLesson(source, maxSeconds = 7) {
    for (let step = 0; step < maxSeconds * 20; step++) {
      h.frame(50);
      const tutorial = h.lastUI().tutorial;
      if (tutorial) {
        const current = route(h, tutorial.source);
        assert.equal(current.automated, false); assert.equal(current.manualTransfers, 0);
        assert.ok(current.availableAmount > 0 && current.inputAmount < current.inputCapacity);
        if (tutorial.source === source) return tutorial;
      }
    }
    assert.fail('expected a stock-backed tutorial for ' + source);
  }
  assert.equal(waitForLesson('pop').target, 'cup');
  h.click(sourceAction('pop')); assert.equal(h.ui().tutorial, null);
  assert.equal(route(h).manualTransfers, 0);
  waitForLesson('pop');
  move(h);
  assert.equal(route(h).manualTransfers, 1); assert.equal(h.ui().tutorial, null);
  assert.equal(route(h, 'cup').availableAmount, 0, 'A delivery still needs real cup processing before B teaching');
  assert.equal(waitForLesson('cup').target, 'ship');
  move(h, 'cup');
  assert.equal(route(h, 'cup').manualTransfers, 1); assert.equal(h.ui().tutorial, null);
  for (let step = 0; step < 160; step++) { h.frame(50); assert.equal(h.lastUI().tutorial, null); }
  assert.ok(h.snapshot().state.totalSold > 0);
  conserved(h);
});

test('validated legacy automatic saves skip manual tutorials while real production continues', () => {
  const old = new Game({ now: START }); old.tick(40);
  const save = old.exportSave(START);
  assert.equal(new Game({ save, now: START }).loadWarning, null);
  const h = harness({ config, save });
  assert.equal(h.snapshot().state.version, 4); assert.equal(h.snapshot().state.economyProfile, 'legacy');
  assert.ok(h.snapshot().transfers.every(item => item.automated));
  const sold = h.snapshot().state.totalSold;
  for (let i = 0; i < 100; i++) { h.frame(100); assert.equal(h.lastUI().tutorial, null); }
  assert.ok(h.snapshot().state.totalSold > sold);
  conserved(h);
});

test('held cargo survives automatic competition and partial delivery reports only the actually accepted amount', () => {
  const h = harness({ config, save: competingSave() }), initial = route(h);
  const held = hold(h);
  assert.equal(held.amount, initial.receivableAmount);
  assert.ok(held.amount < initial.availableAmount, 'pickup uses current receiving space rather than the whole visible source stock');
  let free = initial.inputCapacity - initial.inputAmount, competed = false;
  for (let i = 0; i < 60; i++) {
    h.frame(100);
    const current = route(h);
    assert.equal(current.reservedAmount, held.amount);
    assert.ok(h.snapshot().state.buffers.pop >= held.amount, 'automation never consumes the reserved portion');
    conserved(h);
    free = current.inputCapacity - current.inputAmount;
    if (current.completedTransfers > initial.completedTransfers && free > 0 && free < held.amount) { competed = true; break; }
  }
  assert.equal(competed, true, 'automatic transfers genuinely changed the receiving space while held');
  const before = h.snapshot().state, manualBefore = route(h).manualTransfers;
  h.pointer('up', targetAction('pop'), 1, 210, 180);
  const feedback = h.ui().transferFeedback;
  assert.equal(feedback.kind, 'success'); assert.equal(feedback.amount, free);
  assert.equal(feedback.remaining, held.amount - free);
  assert.equal(h.snapshot().state.buffers.pop, before.buffers.pop - free);
  assert.equal(route(h).manualTransfers, manualBefore + 1);
  assert.equal(route(h).reservedAmount, 0);
  assert.equal(h.analytics.filter(event => event.event === 'transfer_success').at(-1).data.amount, free);
  assert.equal(h.snapshot().state.totalEarned, before.totalEarned, 'the partial drop does not manufacture revenue');
  conserved(h);
});

test('an inlet filled by real automation rejects a held drop, returns all cargo and never opens a modal', () => {
  const h = harness({ config, save: competingSave() }), initial = route(h), held = hold(h);
  let filled = false;
  for (let i = 0; i < 40; i++) {
    h.frame(1000);
    assert.equal(route(h).reservedAmount, held.amount, 'automatic transport leaves the held claim intact');
    assert.ok(h.snapshot().state.buffers.pop >= held.amount);
    conserved(h);
    if (route(h).inputAmount === route(h).inputCapacity) { filled = true; break; }
  }
  assert.equal(filled, true);
  assert.ok(route(h).completedTransfers > initial.completedTransfers);
  const before = h.snapshot().state;
  h.pointer('move', targetAction('pop'), 1, 210, 180);
  assert.equal(h.ui().transfer.overTarget, false);
  h.pointer('up', targetAction('pop'), 1, 210, 180);
  assert.equal(h.ui().transfer, null); assert.equal(h.ui().modal, null);
  assert.equal(route(h).reservedAmount, 0);
  assert.equal(h.ui().transferFeedback.kind, 'invalid'); assert.match(h.ui().transferFeedback.reason, /已满/);
  assert.deepEqual(h.snapshot().state, before);
  h.pointer('up', targetAction('pop'), 1, 210, 180);
  assert.deepEqual(h.snapshot().state, before);
  conserved(h);
});
