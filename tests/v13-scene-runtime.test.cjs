'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { canvasHarness } = require('./canvas-harness.cjs');
const { ART_ASSETS, ART_RUNTIME_IDS } = require('../src/art-manifest');
const { V13_ART_ASSETS, V13_ART_IDS } = require('../src/v13-art-manifest');
const { V13_SCENE_ART_ASSETS, V13_SCENE_ART_IDS } = require('../src/v13-scene-art-manifest');

const MODE = 'v13-orders-p0';
const SAVE_KEY = 'little_popcorn_factory_orders_p0_v1';
const FORMAL_KEY = 'little_popcorn_factory_automation_v4';
const FORMAL_SAVE = '{"version":4,"machine":5,"coins":987654321}';
const source = fs.readFileSync(path.resolve(__dirname, '../web/game.bundle.js'), 'utf8');
const nativeSource = fs.readFileSync(path.resolve(__dirname, '../build/douyin/game.bundle.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const assetByPath = new Map([ART_ASSETS, V13_ART_ASSETS, V13_SCENE_ART_ASSETS]
  .flatMap(assets => Object.values(assets)).map(asset => [asset.path, asset]));
const scenePaths = new Set(Object.values(V13_SCENE_ART_ASSETS).map(asset => asset.path));
const sorted = values => values.slice().sort();

// Exercise the actual built entry, browser platform, renderer and game. Only
// browser primitives, image completion and the animation clock are simulated.
function boot(options = {}) {
  const width = options.width || 320, height = options.height || 524, scale = options.scale || 1;
  const drawing = canvasHarness(), pointers = {}, events = {}, storage = new Map();
  const requests = [], unknownPaths = [];
  let now = 1800000000000, nextFrame = null, failScenes = !!options.failScenes;
  const orders = options.search === undefined || options.search === '?mode=' + MODE;
  if (orders) storage.set(FORMAL_KEY, FORMAL_SAVE);
  if (options.save) storage.set(SAVE_KEY, options.save);
  const canvas = { style: {}, setAttribute() {}, getContext: () => drawing.ctx,
    getBoundingClientRect: () => ({ left: 12, top: 20, width: width * scale, height: height * scale }),
    addEventListener(name, fn) { assert.equal(pointers[name], undefined); pointers[name] = fn; }, setPointerCapture() {} };
  const document = { hidden: false, getElementById: id => id === 'game' ? canvas : null,
    querySelector: () => canvas, addEventListener(name, fn) { events[name] = fn; } };
  const window = { innerWidth: width, innerHeight: height, devicePixelRatio: 2,
    location: { search: options.search === undefined ? '?mode=' + MODE : options.search },
    addEventListener(name, fn) { events[name] = fn; },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  class BrowserImage {
    get src() { return this.currentPath; }
    set src(value) {
      this.currentPath = value;
      if (!value) return;
      const asset = assetByPath.get(value);
      if (!asset) { unknownPaths.push(value); return; }
      this.naturalWidth = asset.width; this.naturalHeight = asset.height;
      const request = { path: value, id: asset.id, image: this, onload: this.onload, onerror: this.onerror };
      requests.push(request);
      if (scenePaths.has(value) && options.deferScenes) return;
      if (scenePaths.has(value) && failScenes) { if (this.onerror) this.onerror(); }
      else if (this.onload) this.onload();
    }
  }
  const nativeHost = { createCanvas: () => canvas, createImage: () => new BrowserImage(),
    getSystemInfoSync: () => ({ windowWidth: width, windowHeight: height, pixelRatio: 2 }),
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    onTouchStart(fn) { pointers.pointerdown = fn; }, onTouchMove(fn) { pointers.pointermove = fn; },
    onTouchEnd(fn) { pointers.pointerup = fn; }, onTouchCancel(fn) { pointers.pointercancel = fn; },
    onHide(fn) { events.hide = fn; }, onShow(fn) { events.show = fn; }, onWindowResize(fn) { events.resize = fn; } };
  const context = vm.createContext({
    ...(options.native ? { tt: nativeHost, POPCORN_CONFIG: { mode: MODE } } : { window, document, Image: BrowserImage }),
    Date: class extends Date { static now() { return now; } },
    requestAnimationFrame(fn) { assert.equal(nextFrame, null, 'one built-package frame loop'); nextFrame = fn; } });
  if (options.native) { context.GameGlobal = vm.runInContext('this', context); context.globalThis = undefined; }
  vm.runInContext(options.native ? nativeSource : source, context, { filename: options.native ? 'build/douyin/game.bundle.js' : 'web/game.bundle.js' });
  const presentation = () => copy(context.__POPCORN__.presentation());
  function actionAt(x, y) {
    const zones = presentation().zones;
    for (let i = zones.length - 1; i >= 0; i--) {
      const zone = zones[i];
      if (x >= zone.x && y >= zone.y && x <= zone.x + zone.w && y <= zone.y + zone.h) return zone.action;
    }
    return null;
  }
  const h = { drawing, requests, storage, presentation, actionAt,
    snapshot: () => copy(context.__POPCORN__.snapshot()), saved: () => storage.get(SAVE_KEY),
    sceneRequests: () => requests.filter(request => scenePaths.has(request.path)),
    failScenes(value) { failScenes = value; },
    frame(ms = 0) {
      now += ms; drawing.clear(); const fn = nextFrame; nextFrame = null;
      assert.equal(typeof fn, 'function'); fn(now);
      assert.equal(drawing.depth(), 0, 'scene changes keep Canvas save/restore balanced');
      assert.deepEqual(unknownPaths, [], 'every requested image belongs to a packaged catalog');
      if (orders) assert.equal(storage.get(FORMAL_KEY), FORMAL_SAVE, 'order scene never rewrites formal progress');
    },
    run(seconds) { for (let remaining = seconds * 1000; remaining > 0;) { const ms = Math.min(100, remaining); h.frame(ms); remaining -= ms; } },
    event(type, point, pointerType = 'touch') {
      if (options.native) {
        pointers[type]({ changedTouches: [{ identifier: 1, screenX: point.x, screenY: point.y }] });
        return;
      }
      let prevented = false;
      pointers[type]({ pointerId: 1, pointerType, button: 0, buttons: type === 'pointerup' ? 0 : 1,
        clientX: 12 + point.x * scale, clientY: 20 + point.y * scale, preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
    },
    point(action) {
      const zone = presentation().zones.slice().reverse().find(row => row.action === action && actionAt(row.x + row.w / 2, row.y + row.h / 2) === action);
      assert.ok(zone, 'reachable built-package control: ' + action);
      return { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
    },
    click(action) { const p = h.point(action); h.event('pointerdown', p); h.event('pointerup', p); h.frame(); },
    key(code) { let prevented = false; events.keydown({ code, repeat: false, preventDefault() { prevented = true; } }); assert.ok(prevented); h.frame(); },
    scroll(deltaY) {
      const r = presentation().layout.content;
      pointers.wheel({ clientX: 12 + (r.x + r.w / 2) * scale, clientY: 20 + (r.y + r.h / 2) * scale,
        deltaY: deltaY * scale, deltaMode: 0, preventDefault() {} }); h.frame();
    },
    reveal(actions) {
      h.scroll(-100000);
      for (let i = 0; i < 40; i++) {
        if (actions.every(action => presentation().zones.some(zone => zone.action === action))) return;
        h.scroll(12);
      }
      assert.fail('source and target must coexist in a visible frame: ' + actions.join(', '));
    },
    drag(fromAction, toAction, pointerType = 'touch') {
      h.reveal([fromAction, toAction]); const from = h.point(fromAction), to = h.point(toAction);
      h.event('pointerdown', from, pointerType);
      for (let step = 1; step <= 4; step++) {
        h.event('pointermove', { x: from.x + (to.x - from.x) * step / 4, y: from.y + (to.y - from.y) * step / 4 }, pointerType); h.frame();
      }
      h.event('pointerup', to, pointerType); h.frame();
    },
    verifyControls() {
      for (const zone of presentation().zones) {
        assert.ok(zone.w >= 44 && zone.h >= 44, zone.action + ' retains a full touch target');
        assert.ok(zone.x >= 0 && zone.y >= 0 && zone.x + zone.w <= width + .01 && zone.y + zone.h <= height + .01, zone.action + ' fits viewport');
      }
    }
  };
  h.frame(); return h;
}

function produce(h, minimum, pointerType) {
  assert.equal(h.presentation().scene, 'factory');
  for (let i = 0; i < 100 && h.snapshot().finished.stock.original < minimum; i++) {
    h.run(.5);
    for (const source of ['pop', 'cup']) {
      if (h.snapshot().transfers.find(item => item.source === source).canReserve)
        h.drag('transfer-source-' + source, 'transfer-target-' + (source === 'pop' ? 'cup' : 'ship'), pointerType);
    }
  }
  assert.ok(h.snapshot().finished.stock.original >= minimum, 'actual production and both transfer drags fill shared inventory');
}

function assertSceneSelection(h, selected) {
  const view = h.presentation(), ids = selected ? V13_SCENE_ART_IDS : [];
  assert.equal(view.sceneArt.requested, ids.length);
  assert.deepEqual(sorted(view.sceneArt.entries.map(entry => entry.id)), sorted(ids));
  assert.equal(view.sceneArt.budgetBytes, 4 * 1024 * 1024);
  assert.equal(view.sceneArt.decodedBytes, ids.reduce((sum, id) => sum + V13_SCENE_ART_ASSETS[id].width * V13_SCENE_ART_ASSETS[id].height * 4, 0));
  assert.ok(view.sceneArt.decodedBytes <= view.sceneArt.budgetBytes);
  assert.equal(view.art.loaded, 87); assert.equal(view.art.requested, ART_RUNTIME_IDS.length);
  assert.ok(view.v13Art.requested < V13_ART_IDS.length, 'optional v1.3 pack is still selected on demand');
  assert.ok(view.v13Art.entries.every(entry => !V13_SCENE_ART_IDS.includes(entry.id)), 'new scenes have a separate loader');
  assert.equal(view.v13Art.budgetBytes, 4 * 1024 * 1024);
  assert.ok(view.v13Art.decodedBytes <= view.v13Art.budgetBytes);
  const baseBytes = ART_RUNTIME_IDS.reduce((sum, id) => sum + ART_ASSETS[id].decodedBytes, 0);
  assert.equal(view.artMemory.baseDecodedBytes, baseBytes);
  assert.equal(view.artMemory.optionalDecodedBytes, view.v13Art.decodedBytes + view.sceneArt.decodedBytes);
  assert.equal(view.artMemory.totalDecodedBytes, baseBytes + view.artMemory.optionalDecodedBytes);
  assert.ok(view.artMemory.totalDecodedBytes <= baseBytes + view.v13Art.budgetBytes + view.sceneArt.budgetBytes);
  if (!selected) assert.equal(view.artMemory.totalDecodedBytes, baseBytes + view.v13Art.decodedBytes, 'factory estimate releases all scene memory');
}

test('built runtime selects only three scene images on store entry and releases them on return', () => {
  const h = boot();
  assert.equal(V13_SCENE_ART_IDS.length, 3);
  assertSceneSelection(h, false); assert.equal(h.sceneRequests().length, 0);
  const baseRequests = h.requests.filter(request => ART_RUNTIME_IDS.includes(request.id));
  h.click('scene:store'); assertSceneSelection(h, true); h.verifyControls();
  assert.equal(h.sceneRequests().length, 3); assert.equal(h.presentation().sceneArt.loaded, 3);
  const firstImages = h.sceneRequests().map(request => request.image);
  const count = h.requests.length;
  h.key('KeyO'); assert.equal(h.requests.length, count, 'reselecting the current scene does not reload images');
  h.click('scene:factory'); assertSceneSelection(h, false);
  for (const image of firstImages) { assert.equal(image.src, ''); assert.equal(image.onload, null); assert.equal(image.onerror, null); }
  for (const request of baseRequests) assert.equal(request.image.src, request.path, 'base art survives scene release');
  h.key('KeyO'); assertSceneSelection(h, true);
  assert.equal(h.sceneRequests().length, 6);
  assert.ok(h.sceneRequests().slice(3).every(request => !firstImages.includes(request.image)));
});

test('scene-only image failure keeps delivery usable and the real retry control reloads only failed images', () => {
  const h = boot({ failScenes: true }); produce(h, 4);
  h.click('scene:store'); assertSceneSelection(h, true); h.verifyControls();
  assert.equal(h.presentation().sceneArt.failed, 3);
  assert.equal(h.presentation().art.failed, 0); assert.equal(h.presentation().v13Art.failed, 0);
  h.point('retry-art');
  const order = h.snapshot().orders[0];
  h.drag('delivery:original', 'order:' + order.id);
  assert.equal(h.snapshot().state.coins, order.quote, 'fallback art preserves real order delivery');
  const otherRequests = h.requests.filter(request => !scenePaths.has(request.path)).length;
  h.failScenes(false); h.click('retry-art');
  assert.equal(h.presentation().sceneArt.loaded, 3); assert.equal(h.presentation().sceneArt.failed, 0);
  assert.equal(h.sceneRequests().length, 6);
  assert.equal(h.requests.filter(request => !scenePaths.has(request.path)).length, otherRequests);
  assert.ok(!h.presentation().zones.some(zone => zone.action === 'retry-art'));
});

test('quick store/factory/store switches ignore old host callbacks in the actual main entry', () => {
  const h = boot({ deferScenes: true }); h.key('KeyO');
  const stale = h.sceneRequests().slice(); assert.equal(h.presentation().sceneArt.pending, 3);
  h.key('KeyF'); assertSceneSelection(h, false);
  h.key('KeyO'); assert.equal(h.sceneRequests().length, 6);
  const pending = h.presentation().sceneArt;
  for (const request of stale) { request.onload(); request.onerror(); assert.equal(request.image.src, ''); }
  h.frame(); assert.deepEqual(h.presentation().sceneArt, pending, 'released callbacks cannot settle the new selection');
  for (const request of h.sceneRequests().slice(3)) request.onload();
  h.frame(); assert.equal(h.presentation().sceneArt.loaded, 3); assert.equal(h.presentation().sceneArt.failed, 0);
});

test('new store retains real delivery, partial cancellation and one inventory across scene switches', () => {
  for (const size of [{ width: 320, height: 524, pointerType: 'touch' }, { width: 390, height: 844, scale: .75, pointerType: 'mouse' }]) {
    const h = boot(size); produce(h, 12, size.pointerType);
    assert.equal(h.snapshot().state.coins, 0);
    const first = h.snapshot().orders[0], stock = h.snapshot().finished.stock.original;
    h.click('scene:store'); h.verifyControls();
    h.drag('delivery:original', 'order:' + first.id, size.pointerType);
    assert.equal(h.snapshot().state.coins, first.quote);
    assert.equal(h.snapshot().finished.stock.original, stock - first.items.original);
    assert.equal(h.snapshot().orderLedger.completed, 1);
    const second = h.snapshot().orders[0], before = h.snapshot();
    h.drag('delivery:original', 'order:' + second.id, size.pointerType);
    const partial = h.snapshot();
    assert.equal(partial.orders.find(order => order.id === second.id).reserved.original, 4);
    assert.equal(partial.finished.stock.original, before.finished.stock.original);
    assert.equal(partial.state.coins, before.state.coins);

    h.reveal(['delivery:original', 'order:' + second.id]);
    const from = h.point('delivery:original'), to = h.point('order:' + second.id);
    h.event('pointerdown', from, size.pointerType);
    h.event('pointermove', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, size.pointerType); h.frame();
    assert.ok(h.presentation().delivery, 'actual shelf drag reserves available stock');
    h.key('KeyF'); h.event('pointerup', from, size.pointerType); h.frame();
    assert.equal(h.presentation().delivery, null);
    assert.deepEqual(h.snapshot().finished, partial.finished, 'leaving store returns held goods and retains allocated goods');
    assertSceneSelection(h, false);
    h.key('KeyO'); assert.deepEqual(h.snapshot().finished, partial.finished);
    h.reveal(['cancel-order:' + second.id]); h.click('cancel-order:' + second.id);
    const cancelled = h.snapshot();
    assert.equal(cancelled.finished.stock.original, partial.finished.stock.original);
    assert.equal(cancelled.finished.reserved.original, 0);
    assert.equal(cancelled.finished.available.original, partial.finished.available.original + 4);
    assert.equal(cancelled.state.coins, partial.state.coins);
    assert.equal(cancelled.orderLedger.cancelled, 1);
    assert.ok(!cancelled.orders.some(order => order.id === second.id));
    const restored = boot({ ...size, save: h.saved() }).snapshot();
    assert.deepEqual(restored.finished, cancelled.finished);
    assert.deepEqual(restored.orderLedger, cancelled.orderLedger);
    assert.equal(restored.state.coins, cancelled.state.coins);
  }
});

test('formal and baseline entry points never request the new order-scene images', () => {
  for (const search of ['', '?mode=baseline']) {
    const h = boot({ search }); h.run(1);
    assert.notEqual(h.snapshot().mode, MODE);
    assert.equal(h.sceneRequests().length, 0);
    assert.equal(h.presentation().art.loaded, 87);
    assert.equal(h.storage.has(SAVE_KEY), false, 'formal entry does not initialize the isolated order save');
  }
});

test('native package uses tt.createImage and GameGlobal to enter and release the store scene', () => {
  const h = boot({ native: true });
  assert.equal(h.snapshot().mode, MODE); assertSceneSelection(h, false);
  assert.equal(h.sceneRequests().length, 0);
  h.click('scene:store'); h.verifyControls(); assertSceneSelection(h, true);
  assert.equal(h.presentation().sceneArt.loaded, 3);
  const images = h.sceneRequests().map(request => request.image);
  h.click('scene:factory'); assertSceneSelection(h, false);
  assert.ok(images.every(image => image.src === ''));
  assert.ok(h.storage.has(SAVE_KEY));
});
