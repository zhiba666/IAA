'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { canvasHarness } = require('./canvas-harness.cjs');
const { ART_ASSETS } = require('../src/art-manifest');
const { V13_ART_ASSETS } = require('../src/v13-art-manifest');
const { V13_SCENE_ART_ASSETS } = require('../src/v13-scene-art-manifest');
const KEY = 'little_popcorn_factory_orders_v2';
const MODE = 'factory-orders';
const START = 1800000000000;
const copy = value => JSON.parse(JSON.stringify(value));
function economicSnapshot(view) { const result = copy(view); delete result.state.savedAt; return result; }
const source = fs.readFileSync(path.resolve(__dirname, '../web/game.bundle.js'), 'utf8');
const assetByPath = new Map([ART_ASSETS, V13_ART_ASSETS, V13_SCENE_ART_ASSETS].flatMap(assets => Object.values(assets)).map(asset => [asset.path, asset]));

// This runs the actual built main/platform/renderer/core and asset loaders.
// The fixture supplies only browser primitives, image completion, and a clock.
function boot(options = {}) {
  const width = options.width || 320, height = options.height || 524;
  const drawing = canvasHarness(), pointers = {}, events = {}, storage = new Map();
  let now = START, nextFrame = null, canvasCreations = 0;
  const left = 12, top = 20, scale = options.scale || 1;
  const bounds = { left, top, width: width * scale, height: height * scale };
  const protectedKey = 'little_popcorn_factory_manual_transfer_p0_v3', protectedValue = '{"version":4,"machine":5,"coins":987654321}';
  storage.set(protectedKey, protectedValue);
  if (options.save) storage.set(KEY, typeof options.save === 'string' ? options.save : JSON.stringify(options.save));
  const canvas = {
    style: {}, setAttribute() {}, getContext: () => drawing.ctx, getBoundingClientRect: () => bounds,
    addEventListener(name, fn) { assert.equal(pointers[name], undefined, 'a single platform attaches each Canvas listener'); pointers[name] = fn; },
    setPointerCapture() {}
  };
  const document = {
    hidden: false,
    getElementById(id) { if (id === 'game') { canvasCreations++; return canvas; } return null; },
    querySelector: () => canvas, addEventListener(name, fn) { events[name] = fn; }
  };
  const window = {
    innerWidth: width, innerHeight: height, devicePixelRatio: options.pixelRatio || 2,
    location: { search: '' }, addEventListener(name, fn) { events[name] = fn; },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
  };
  class BrowserImage {
    set src(value) {
      this.path = value; if (!value) return;
      const asset = assetByPath.get(value); assert.ok(asset, 'bundle loads a known packaged image: ' + value);
      this.naturalWidth = asset.width; this.naturalHeight = asset.height;
      if (options.missingImages) { if (this.onerror) this.onerror(); }
      else if (this.onload) this.onload();
    }
  }
  const context = vm.createContext({
    ...(options.native ? { tt: {
      createCanvas() { canvasCreations++; return canvas; }, createImage: () => new BrowserImage(),
      getSystemInfoSync: () => ({ windowWidth: width, windowHeight: height, pixelRatio: 2,
        safeArea: { left: 0, top: 28, right: width, bottom: height - 20 } }),
      getMenuButtonLayout: () => ({ left: width - 100, top: 30, right: width - 8, bottom: 62, width: 92, height: 32 }),
      getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
      onTouchStart(fn) { pointers.pointerdown = fn; }, onTouchMove(fn) { pointers.pointermove = fn; },
      onTouchEnd(fn) { pointers.pointerup = fn; }, onTouchCancel(fn) { pointers.pointercancel = fn; },
      onHide(fn) { events.hide = fn; }, onShow(fn) { events.show = fn; }
    } } : { window, document, Image: BrowserImage }),
    Date: class extends Date { static now() { return now; } },
    requestAnimationFrame(fn) { assert.equal(nextFrame, null, 'only one real bundle frame loop'); nextFrame = fn; }
  });
  if (options.native) {
    context.require = name => {
      assert.ok(['./config.js', './game.bundle.js'].includes(name));
      vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../build/douyin', name), 'utf8'), context, { filename: name });
    };
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../build/douyin/game.js'), 'utf8'), context);
  } else vm.runInContext(source, context, { filename: 'web/game.bundle.js' });
  const presentation = () => copy(context.__POPCORN__.presentation());
  function actionAt(x, y) {
    const zones = presentation().zones;
    for (let i = zones.length - 1; i >= 0; i--) {
      const zone = zones[i];
      if (x >= zone.x && y >= zone.y && x <= zone.x + zone.w && y <= zone.y + zone.h) return zone.action;
    }
    return null;
  }
  const h = {
    storage, drawing, presentation, actionAt, document, events,
    snapshot: () => copy(context.__POPCORN__.snapshot()), saved: () => storage.get(KEY),
    frame(ms = 0) {
      now += ms; drawing.clear(); const fn = nextFrame; nextFrame = null;
      assert.equal(typeof fn, 'function'); fn(now); assert.equal(drawing.depth(), 0);
      assert.equal(storage.get(protectedKey), protectedValue, 'the retired experimental save remains byte-identical');
    },
    run(seconds) { for (let leftMs = seconds * 1000; leftMs > 0;) { const ms = Math.min(100, leftMs); h.frame(ms); leftMs -= ms; } },
    event(type, point, pointerType = 'touch', id = 1) {
      if (options.native) {
        pointers[type]({ changedTouches: [{ identifier: id, screenX: point.x, screenY: point.y }] });
        return;
      }
      let prevented = false;
      pointers[type]({ pointerId: id, pointerType, clientX: left + point.x * scale, clientY: top + point.y * scale,
        button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
        preventDefault() { prevented = true; } });
      assert.equal(prevented, true, 'actual platform consumes ' + type);
    },
    point(action) {
      const zone = presentation().zones.slice().reverse().find(row => row.action === action && actionAt(row.x + row.w / 2, row.y + row.h / 2) === action);
      assert.ok(zone, 'visible real hit area: ' + action);
      return { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
    },
    click(action) { const p = h.point(action); h.event('pointerdown', p); h.event('pointerup', p); h.frame(); },
    scroll(deltaY) {
      if (options.native) {
        const r = presentation().layout.content, from = { x: r.x + 3, y: r.y + r.h / 2 };
        h.event('pointerdown', from); h.event('pointermove', { x: from.x, y: from.y - Math.max(-150, Math.min(150, deltaY)) });
        h.event('pointerup', { x: from.x, y: from.y - Math.max(-150, Math.min(150, deltaY)) }); h.frame(); return;
      }
      const r = presentation().layout.content;
      pointers.wheel({ clientX: left + (r.x + r.w / 2) * scale, clientY: top + (r.y + r.h / 2) * scale,
        deltaY: deltaY * scale, deltaMode: 0, preventDefault() {} }); h.frame();
    },
    reveal(actions) {
      h.scroll(-100000);
      for (let i = 0; i < 40; i++) {
        const zones = presentation().zones;
        if (actions.every(action => zones.some(zone => zone.action === action))) return;
        h.scroll(12);
      }
      assert.fail('same visible frame must contain source and target: ' + actions.join(', '));
    },
    dragPoints(from, to, pointerType = 'touch', id = 1) {
      h.event('pointerdown', from, pointerType, id);
      for (let step = 1; step <= 4; step++) {
        h.event('pointermove', { x: from.x + (to.x - from.x) * step / 4, y: from.y + (to.y - from.y) * step / 4 }, pointerType, id);
        h.frame(0);
      }
      h.event('pointerup', to, pointerType, id); h.frame();
    },
    drag(from, to, pointerType = 'touch') { h.reveal([from, to]); h.dragPoints(h.point(from), h.point(to), pointerType); },
    verifyControls() {
      for (const zone of presentation().zones) {
        assert.ok(zone.x >= 0 && zone.y >= 0 && zone.x + zone.w <= width + .01 && zone.y + zone.h <= height + .01, zone.action + ' lies inside viewport');
        assert.ok(zone.w >= 44 && zone.h >= 44, zone.action + ' is a full touch target');
      }
    }
  };
  h.frame(); assert.equal(h.snapshot().mode, MODE); assert.equal(canvasCreations, 1);
  return h;
}

function route(h, from, pointerType) {
  const sourceAction = 'transfer-source-' + from, targetAction = 'transfer-target-' + (from === 'pop' ? 'cup' : 'ship');
  h.drag(sourceAction, targetAction, pointerType);
}
function packageFour(h, pointerType) {
  h.run(3); route(h, 'pop', pointerType); assert.equal(h.snapshot().transfers[0].transferredAmount, 4);
  h.run(3); route(h, 'cup', pointerType); assert.equal(h.snapshot().transfers[1].transferredAmount, 4);
  h.run(2); assert.equal(h.snapshot().finished.stock.original, 4); assert.equal(h.snapshot().state.coins, 0);
}
function refill(h, minimum) {
  h.click('scene:factory');
  for (let i = 0; i < 90 && h.snapshot().finished.stock.original < minimum; i++) {
    h.run(.5);
    for (const sourceId of ['pop', 'cup']) if (h.snapshot().transfers.find(item => item.source === sourceId).canReserve) route(h, sourceId);
  }
  assert.ok(h.snapshot().finished.stock.original >= minimum, 'real A/B pointer drags refill shared finished inventory');
  h.click('scene:store');
}

test('real generated Douyin default has one shared clock, packaging stock, order income and no offline catch-up', () => {
  for (const size of [{ width: 320, height: 524 }, { width: 390, height: 844 }]) {
    const h = boot({ ...size, native: true });
    h.verifyControls(); packageFour(h);
    const before = h.snapshot(); h.click('scene:store');
    assert.equal(h.snapshot().state.simulation.ticks, before.state.simulation.ticks);
    const order = h.snapshot().orders[0]; h.drag('delivery:original', 'order:' + order.id);
    assert.equal(h.snapshot().state.totalEarned, order.quote);
    h.events.hide(); const paused = h.snapshot(); h.frame(3600000); h.events.show(); h.frame();
    assert.deepEqual(economicSnapshot(h.snapshot()), economicSnapshot(paused));
    assert.equal(h.snapshot().orderLedger.completed, 1);
    h.verifyControls();
  }
});

test('built order package completes real A/B and customer drags at short and tall phone coordinates', () => {
  for (const size of [{ width: 320, height: 524 }, { width: 390, height: 844, scale: .75, pixelRatio: 3 }]) {
    for (const pointerType of ['touch', 'mouse']) {
      const h = boot(size); h.verifyControls(); packageFour(h, pointerType);
      const first = h.snapshot().orders[0]; h.click('scene:store'); h.verifyControls();
      h.drag('delivery:original', 'order:' + first.id, pointerType);
      assert.equal(h.snapshot().state.coins, first.quote); assert.equal(h.snapshot().state.totalSold, 4);
      assert.equal(h.snapshot().orderLedger.completed, 1);
      const before = h.snapshot();
      h.event('pointerup', h.point('order:' + h.snapshot().orders[0].id), pointerType); h.frame();
      assert.deepEqual(h.snapshot(), before, 'a repeated browser release cannot settle a replacement customer');
      const restored = boot(Object.assign({}, size, { save: h.saved() }));
      assert.deepEqual(economicSnapshot(restored.snapshot()), economicSnapshot(before), 'the actual platform reload retains one paid transaction');
    }
  }
});

test('real package partially delivers, restores and cancels without losing goods or awarding partial income', () => {
  for (const size of [{ width: 320, height: 524 }, { width: 390, height: 844 }]) {
    const h = boot(size); packageFour(h); h.click('scene:store'); h.drag('delivery:original', 'order:' + h.snapshot().orders[0].id);
    refill(h, 12); const target = h.snapshot().orders[0], before = h.snapshot();
    h.drag('delivery:original', 'order:' + target.id);
    const partial = h.snapshot();
    assert.equal(partial.orders.find(item => item.id === target.id).reserved.original, 4);
    assert.equal(partial.state.coins, before.state.coins); assert.equal(partial.finished.stock.original, before.finished.stock.original);
    const resumed = boot(Object.assign({}, size, { save: h.saved() }));
    assert.deepEqual(economicSnapshot(resumed.snapshot()), economicSnapshot(partial));
    resumed.click('scene:store'); resumed.reveal(['cancel-order:' + target.id]); resumed.click('cancel-order:' + target.id);
    const released = resumed.snapshot();
    assert.equal(released.finished.available.original, partial.finished.available.original + 4);
    assert.equal(released.finished.reserved.original, 0); assert.equal(released.finished.stock.original, partial.finished.stock.original);
    assert.equal(released.state.coins, partial.state.coins);
    assert.ok(!released.orders.some(item => item.id === target.id));
    assert.equal(boot(Object.assign({}, size, { save: resumed.saved() })).snapshot().orderLedger.cancelled, 1);
  }
});

test('all A/B source glyph areas and the visible stocked cup are usable drag origins', () => {
  for (const size of [{ width: 320, height: 524 }, { width: 390, height: 844 }]) {
    const h = boot(size); packageFour(h);
    for (const id of ['pop', 'cup']) {
      const action = 'transfer-source-' + id; h.reveal([action]);
      const zone = h.presentation().zones.find(item => item.action === action);
      for (const [fx, fy] of [[.12, .2], [.5, .5], [.88, .8]]) assert.equal(h.actionAt(zone.x + zone.w * fx, zone.y + zone.h * fy), action);
    }
    h.click('scene:store');
    const info = h.presentation(), stock = info.layout.stock;
    const cup = info.diagnostics.sprites.find(item => item.id === 'product_original_cup' && item.rect.x >= stock.x && item.rect.y >= stock.y && item.rect.y + item.rect.h <= stock.y + stock.h);
    assert.ok(cup && cup.available, 'the real renderer draws a loaded original cup on the shelf');
    const from = { x: cup.rect.x + cup.rect.w / 2, y: cup.rect.y + cup.rect.h / 2 };
    assert.equal(h.actionAt(from.x, from.y), 'delivery:original', 'the visible cup itself starts a shelf delivery');
    const first = h.snapshot().orders[0]; h.reveal(['order:' + first.id]);
    h.dragPoints(from, h.point('order:' + first.id));
    assert.equal(h.snapshot().state.coins, first.quote);
  }
});

test('image failure retains reachable production and order controls in the built short-screen package', () => {
  const h = boot({ width: 320, height: 524, missingImages: true });
  assert.ok(h.presentation().art.failed > 0); h.verifyControls(); packageFour(h);
  h.click('scene:store'); h.verifyControls(); const order = h.snapshot().orders[0];
  h.drag('delivery:original', 'order:' + order.id); assert.equal(h.snapshot().state.coins, order.quote);
});

test('real browser drags survive stalls and normal one-second foreground frames keep production running', () => {
  for (const size of [{ width: 320, height: 524 }, { width: 390, height: 844 }]) {
    const h = boot(size);
    function throttledDrag(sourceAction, targetAction, kind) {
      h.reveal([sourceAction, targetAction]);
      const from = h.point(sourceAction), to = h.point(targetAction);
      h.event('pointerdown', from, 'mouse');
      h.event('pointermove', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, 'mouse'); h.frame();
      const held = h.presentation()[kind]; assert.ok(held && held.token, 'real pointer movement reserves ' + kind);
      const before = h.snapshot(); h.frame(2000);
      assert.equal(h.presentation()[kind].token, held.token, 'foreground throttling retains the actual browser reservation');
      assert.deepEqual(h.snapshot(), before, 'an oversized frame does not produce or sell inventory');
      h.event('pointermove', to, 'mouse'); h.frame(1006);
      assert.equal(h.presentation()[kind].token, held.token, 'another slow tool move retains the same token');
      assert.ok(h.snapshot().state.simulation.ticks > before.state.simulation.ticks, 'normal 1 Hz frames with timer jitter still process real work');
      assert.equal(h.snapshot().state.coins, before.state.coins, 'foreground work alone never settles the held order');
      h.event('pointerup', to, 'mouse'); h.frame();
      assert.equal(h.presentation()[kind], null);
    }
    h.run(3); throttledDrag('transfer-source-pop', 'transfer-target-cup', 'transfer');
    assert.equal(h.snapshot().transfers[0].transferredAmount, 4);
    h.run(3); throttledDrag('transfer-source-cup', 'transfer-target-ship', 'transfer');
    assert.equal(h.snapshot().transfers[1].transferredAmount, 4);
    h.run(2); assert.equal(h.snapshot().finished.stock.original, 4); assert.equal(h.snapshot().state.coins, 0);
    h.click('scene:store'); const first = h.snapshot().orders[0];
    throttledDrag('delivery:original', 'order:' + first.id, 'delivery');
    assert.equal(h.snapshot().state.coins, first.quote); assert.equal(h.snapshot().orderLedger.completed, 1);
  }
});
