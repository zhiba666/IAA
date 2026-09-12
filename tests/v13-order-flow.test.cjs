'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { V13OrderGame } = require('../src/v13-order-core');
const { orderSceneAssetIds, orderSceneEnvironmentAssetIds } = require('../src/v13-order-scene');
const MODE = 'v13-orders-p0', START = 1800000000000;
const copy = value => JSON.parse(JSON.stringify(value));

// Run the real entry, controller and both simulation modules in one host.
// Only platform I/O, optional assets, audio and Canvas painting are replaced.
function harness(options = {}) {
  let now = START, frameTime = 0, nextFrame = null, hit = null, view = null, ui = null, platformCount = 0;
  let stored = options.save == null ? null : copy(options.save), loadError = options.loadError || '', saveFailure = !!options.saveFailure;
  const callbacks = {}, keys = {}, saves = [], analytics = [], selected = [], sounds = [];
  const ctx = { setTransform() {} };
  const canvas = { getContext: () => ctx, setAttribute() {}, style: {} };
  const info = { width: 390, height: 844, pixelRatio: 2, safeArea: { left: 0, top: 0, right: 390, bottom: 844 } };
  const platform = {
    canvas, isDouyin: false, config: { mode: MODE }, lastStorageError: '',
    load() { this.lastStorageError = loadError; return stored == null ? null : copy(stored); },
    save(value) {
      this.lastStorageError = saveFailure ? 'storage-full' : '';
      if (saveFailure) return false;
      stored = copy(value); saves.push(copy(value)); return true;
    },
    onPointer(fn) { callbacks.pointer = fn; }, onHide(fn) { callbacks.hide = fn; }, onShow(fn) { callbacks.show = fn; },
    onResize(fn) { callbacks.resize = fn; }, onInputCancel(fn) { callbacks.cancel = fn; }, onScroll(fn) { callbacks.scroll = fn; },
    getSystemInfo: () => info, getAnalytics: () => copy(analytics),
    track(event, data) { analytics.push({ event, data: copy(data) }); }, vibrate() {}
  };
  class Scene {
    constructor() { this.layout = { content: { x: 10, y: 60, w: 370, h: 700, scrollMax: 300 } }; this.zones = []; }
    draw(nextView, nextUI) { view = copy(nextView); ui = copy(nextUI); }
    actionAt(x, y) { return x >= 0 && x <= info.width && y >= 0 && y <= info.height ? hit : null; }
    transferTargetAt(x, y, source) {
      const target = source === 'pop' ? 'cup' : 'ship';
      return this.actionAt(x, y) === 'transfer-target-' + target ? { source, target } : null;
    }
  }
  const assets = () => ({ loadAll() {}, select(ids) { selected.push(ids.slice()); }, retryFailed() {}, report: () => ({ failed: 0, decodedBytes: 0 }) });
  class Audio { unlock() {} setEnabled(value) { this.enabled = value; } play(name) { if (this.enabled !== false) sounds.push(name); } }
  const context = vm.createContext({
    POPCORN_CONFIG: options.query ? { mode: 'v15' } : { mode: MODE },
    Date: class extends Date { static now() { return now; } },
    document: { getElementById: () => null },
    window: { location: { search: options.query ? '?mode=' + MODE : '' }, addEventListener(name, fn) { keys[name] = fn; } },
    requestAnimationFrame(fn) { assert.equal(nextFrame, null, 'the application owns exactly one frame loop'); nextFrame = fn; }
  });
  const cache = new Map(), src = path.resolve(__dirname, '../src');
  function load(name) {
    if (name === './platform') return { createPlatform() { platformCount++; return platform; } };
    if (name === './v13-order-scene') return { V13OrderScene: Scene, orderSceneAssetIds, orderSceneEnvironmentAssetIds };
    if (name === './art-assets') return { createArtAssets: assets };
    if (name === './v13-art-assets') return { createV13ArtAssets: assets };
    if (name === './audio') return { AudioEngine: Audio };
    if (cache.has(name)) return cache.get(name).exports;
    const module = { exports: {} }; cache.set(name, module);
    const source = fs.readFileSync(path.resolve(src, name + '.js'), 'utf8');
    vm.runInContext('(function(module,exports,require){\n' + source + '\n})', context, { filename: name + '.js' })(module, module.exports, load);
    return module.exports;
  }
  load('./main');
  const h = {
    context, platform, saves, analytics, selected, sounds, info,
    snapshot: () => copy(context.__POPCORN__.snapshot()), presentation: () => copy(context.__POPCORN__.presentation()),
    ui() { h.frame(0); return copy(ui); }, drawn: () => copy(view), platformCount: () => platformCount,
    saved: () => stored == null ? null : copy(stored),
    frame(ms = 100) { now += ms; frameTime += ms; const fn = nextFrame; nextFrame = null; assert.equal(typeof fn, 'function'); fn(frameTime); },
    run(seconds) { for (let remaining = seconds * 1000; remaining > 0;) { const ms = Math.min(100, remaining); h.frame(ms); remaining -= ms; } },
    pointer(type, action = null, id = 1, x = 100, y = 100) { hit = action; callbacks.pointer({ type, id, x, y }); },
    click(action) { h.pointer('down', action); h.pointer('up', action); hit = null; },
    drag(source, target, id = 1) { h.pointer('down', source, id); h.pointer('move', target, id, 210, 180); h.pointer('up', target, id, 210, 180); hit = null; },
    key(code) { keys.keydown({ code, repeat: false, preventDefault() {} }); },
    hide() { callbacks.hide(); }, show() { callbacks.show(); }, resize() { callbacks.resize(info); }, blur() { callbacks.cancel(); },
    recover(save, error = '') { stored = save == null ? null : copy(save); loadError = error; },
    setSaveFailure(value) { saveFailure = value; }
  };
  h.frame(0); return h;
}

function transfer(h, source) { h.drag('transfer-source-' + source, 'transfer-target-' + (source === 'pop' ? 'cup' : 'ship')); }
function produceFirst(h) { h.run(3); transfer(h, 'pop'); h.run(3); transfer(h, 'cup'); h.run(2); }
function order(h, index = 0) { return h.snapshot().orders[index]; }
function deliver(h, id = order(h).id) { h.drag('delivery:original', 'order:' + id); }
function conserved(view) {
  const s = view.state;
  const wip = Object.values(s.stations).reduce((sum, station) => sum + station.jobs.reduce((n, job) => n + (job ? job.amount : 0), 0), 0);
  assert.equal(s.totalProduced, s.totalSold + view.finished.stock.original + s.buffers.pop + s.buffers.cup + s.inputs.cup + s.inputs.ship + wip);
  assert.equal(s.coins + s.totalSpent, s.totalEarned);
  assert.equal(view.finished.stock.original, view.finished.available.original + view.finished.reserved.original + view.finished.held.original);
}
function stockFixture() {
  const game = new V13OrderGame({ now: START });
  for (let i = 0; i < 500 && game.getView().finished.stock.original < 24; i++) {
    game.tick(.5);
    for (const source of ['pop', 'cup']) { const held = game.reserveTransfer(source); if (held.ok) game.commitTransfer(held.token); }
  }
  assert.equal(game.getView().finished.stock.original, 24);
  const save = game.exportSave(START);
  assert.equal(new V13OrderGame({ save, now: START }).loadWarning, null);
  return save;
}

test('order opt-in runs one real factory and sells its first packaged batch only on delivery', () => {
  for (const query of [false, true]) {
    const h = harness({ query });
    assert.equal(h.platformCount(), 1);
    assert.equal(h.snapshot().mode, MODE);
    assert.equal(h.snapshot().orders.length, 1);
    produceFirst(h);
    const ready = h.snapshot();
    assert.equal(ready.finished.stock.original, 4);
    assert.equal(ready.state.totalSold, 0); assert.equal(ready.state.totalEarned, 0); assert.equal(ready.state.coins, 0);
    const first = order(h);
    h.click('scene:store'); deliver(h, first.id);
    const sold = h.snapshot();
    assert.equal(sold.state.totalSold, 4); assert.equal(sold.state.coins, first.quote);
    assert.equal(sold.orders.length, 2); assert.equal(sold.orderLedger.completed, 1);
    assert.equal(h.analytics.filter(event => event.event === 'order-settled').length, 1);
    h.pointer('up', 'order:' + first.id, 1, 210, 180);
    assert.deepEqual(h.snapshot(), sold, 'duplicate release does not sell or pay again');
    conserved(sold);
    const restored = harness({ save: h.saved() });
    assert.equal(restored.snapshot().state.coins, first.quote);
    assert.equal(restored.snapshot().orderLedger.completed, 1);
    assert.equal(restored.analytics.filter(event => event.event === 'order-settled').length, 0, 'restoring does not replay a sale');
  }
});

test('scene switches preserve in-flight production and consume exactly the same foreground time', () => {
  const control = harness(), switched = harness();
  control.run(3); switched.run(3); transfer(control, 'pop'); transfer(switched, 'pop');
  for (let i = 0; i < 20; i++) {
    switched.click(i % 2 ? 'scene:factory' : 'scene:store');
    control.run(.1); switched.run(.1);
  }
  assert.deepEqual(switched.snapshot(), control.snapshot());
  assert.equal(switched.platformCount(), 1);
  conserved(switched.snapshot());
});

test('partial delivery survives a scene change and reload and cancellation releases its stock without payment', () => {
  const h = harness({ save: stockFixture() }); h.click('scene:store'); deliver(h);
  const target = order(h), before = h.snapshot(); deliver(h, target.id);
  const partial = h.snapshot(), pending = partial.orders.find(row => row.id === target.id);
  assert.equal(target.items.original, 6); assert.equal(pending.reserved.original, 4);
  assert.equal(pending.status, 'partial'); assert.equal(partial.state.coins, before.state.coins);
  assert.equal(partial.finished.stock.original, before.finished.stock.original);
  h.click('scene:factory'); h.click('scene:store');
  const restored = harness({ save: h.saved() });
  assert.deepEqual(restored.snapshot(), partial);
  restored.click('scene:store'); restored.click('cancel-order:' + target.id);
  const cancelled = restored.snapshot();
  assert.equal(cancelled.finished.reserved.original, 0);
  assert.equal(cancelled.finished.available.original, partial.finished.available.original + 4);
  assert.equal(cancelled.finished.stock.original, partial.finished.stock.original);
  assert.equal(cancelled.state.coins, partial.state.coins);
  assert.ok(!cancelled.orders.some(row => row.id === target.id));
  conserved(cancelled);
});

test('final drag consumes only the remaining requirement and preserves the other customer reservation', () => {
  const h = harness({ save: stockFixture() }); h.click('scene:store'); deliver(h);
  const a = order(h, 0), b = order(h, 1); deliver(h, a.id); deliver(h, b.id);
  const before = h.snapshot(); deliver(h, a.id);
  const after = h.snapshot();
  assert.equal(after.state.coins, before.state.coins + a.quote);
  assert.equal(after.state.totalSold, before.state.totalSold + a.items.original);
  assert.equal(after.orders.find(row => row.id === b.id).reserved.original, 4);
  assert.equal(after.finished.stock.original, before.finished.stock.original - 6);
  assert.equal(after.finished.available.original, before.finished.available.original - 2);
  assert.equal(h.ui().delivery, null);
  conserved(after);
});

test('delivery taps and wrong destinations never turn inventory into sales', () => {
  const h = harness({ save: stockFixture() }); h.click('scene:store'); const before = h.snapshot();
  h.click('delivery:original'); h.click('order:' + order(h).id);
  assert.deepEqual(h.snapshot(), before);
  for (const wrong of [null, 'order:departed', 'scene:factory', 'cancel-order:' + order(h).id, 'transfer-target-ship']) {
    h.drag('delivery:original', wrong);
    assert.deepEqual(h.snapshot(), before);
    assert.equal(h.ui().scene, 'store', 'a drop does not activate the control beneath it');
    assert.equal(h.ui().delivery, null);
  }
});

test('lifecycle, second fingers and keyboard scene changes cancel transient delivery while keeping partial orders', () => {
  const changes = {
    cancel: h => h.pointer('cancel'), resize: h => h.resize(), blur: h => h.blur(),
    background: h => { h.hide(); h.run(25); h.show(); h.frame(0); },
    escape: h => h.key('Escape'), scene: h => h.key('KeyF'),
    multitouch: h => { h.pointer('down', null, 2); h.pointer('move', null, 2); h.pointer('up', null, 2); }
  };
  for (const [name, change] of Object.entries(changes)) {
    const h = harness({ save: stockFixture() }); h.click('scene:store'); deliver(h); deliver(h);
    const before = h.snapshot(), target = order(h).id;
    h.pointer('down', 'delivery:original'); h.pointer('move', 'order:' + target, 1, 210, 180);
    assert.ok(h.snapshot().finished.held.original > 0, name);
    change(h); h.pointer('up', 'order:' + target, 1, 210, 180);
    assert.equal(h.ui().delivery, null, name);
    assert.deepEqual(h.snapshot(), before, name + ' keeps reserved order lines and authoritative stock');
    conserved(h.snapshot());
  }
});

test('a foreground frame stall preserves a held delivery without advancing production or paying twice', () => {
  const h = harness({ save: stockFixture() }); h.click('scene:store');
  const target = order(h);
  h.pointer('down', 'delivery:original', 9);
  h.pointer('move', 'order:' + target.id, 9, 210, 180);
  const before = h.snapshot(), token = h.ui().delivery.token;
  h.frame(2000);
  assert.equal(h.ui().delivery.token, token, 'a still-visible held gesture survives throttled animation frames');
  assert.deepEqual(h.snapshot(), before, 'discarded frame time grants no production, clock progress or income');
  h.pointer('up', 'order:' + target.id, 9, 210, 180);
  const settled = h.snapshot();
  assert.equal(settled.state.coins, before.state.coins + target.quote);
  assert.equal(settled.orderLedger.completed, before.orderLedger.completed + 1);
  h.pointer('up', 'order:' + target.id, 9, 210, 180);
  assert.deepEqual(h.snapshot(), settled, 'the surviving token remains single-use');
  conserved(settled);
});

test('mismatched pointer releases and repeated downs cannot commit a delivery twice', () => {
  const h = harness({ save: stockFixture() }); h.click('scene:store'); const target = order(h).id;
  h.pointer('down', 'delivery:original', 9); h.pointer('move', 'order:' + target, 9, 210, 180);
  const held = h.snapshot();
  h.pointer('up', 'order:' + target, 10, 210, 180); assert.deepEqual(h.snapshot(), held);
  h.pointer('up', 'order:' + target, 9, 210, 180);
  assert.equal(h.snapshot().orderLedger.completed, 1);
  const before = h.snapshot(), next = order(h).id;
  h.pointer('down', 'delivery:original', 11); h.pointer('move', 'order:' + next, 11, 210, 180);
  h.pointer('down', 'delivery:original', 11); h.pointer('up', 'order:' + next, 11, 210, 180);
  assert.deepEqual(h.snapshot(), before, 'duplicate down cancels instead of replacing a held gesture');
});

test('background pauses all work and a returning frame grants no offline production or income', () => {
  const h = harness(); produceFirst(h); h.hide(); const before = h.snapshot();
  h.run(60); assert.deepEqual(h.snapshot(), before);
  h.show(); h.frame(60000); assert.deepEqual(h.snapshot(), before);
  h.run(.5); assert.equal(h.snapshot().state.simulation.ticks, before.state.simulation.ticks + 60);
  assert.equal(h.snapshot().state.coins, 0);
});

test('unreadable and invalid saves stay paused without autosave overwrites until valid data is retried', () => {
  for (const invalid of [{ loadError: 'read-denied' }, { save: { version: 4, mode: 'v15', machine: 5, coins: 777 } }]) {
    const h = harness(invalid), before = h.snapshot();
    assert.equal(h.ui().recoveryBlocked, true); assert.equal(h.saves.length, 0);
    h.run(20); h.hide(); h.show(); h.frame(0); h.click('retry-save');
    assert.deepEqual(h.snapshot(), before); assert.equal(h.saves.length, 0);
    h.click('reload-save'); assert.equal(h.ui().recoveryBlocked, true); assert.equal(h.saves.length, 0);
    const valid = stockFixture(); h.recover(valid); h.click('reload-save');
    assert.equal(h.ui().recoveryBlocked, false); assert.equal(h.snapshot().finished.stock.original, 24);
    h.hide(); assert.equal(h.saves.length, 1); assert.equal(h.saved().commerce.stock.original, 24);
  }
});

test('failed saves keep the active partial order intact and retry writes one consistent snapshot', () => {
  const h = harness({ save: stockFixture() }); h.click('scene:store'); deliver(h);
  h.setSaveFailure(true); deliver(h); const partial = h.snapshot();
  assert.ok(h.ui().saveError); assert.equal(partial.finished.reserved.original, 4);
  h.hide(); assert.deepEqual(h.snapshot(), partial);
  h.show(); h.setSaveFailure(false); h.click('retry-save');
  assert.equal(h.ui().saveError, '');
  const restored = harness({ save: h.saved() }); assert.deepEqual(restored.snapshot(), partial);
});
