'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/platform.js'), 'utf8');
const START = 1800000000000;

function harness(options = {}) {
  let now = START;
  let nextTimer = 1;
  const timers = new Map();
  const lifecycle = {};
  const browserEvents = {};
  const pointerEvents = {};
  const viewportEvents = {};
  const listenerOptions = {};
  const storage = new Map();
  const rewards = [];
  const interstitials = [];
  const canvas = {
    style: {}, addEventListener(name, fn, value) { pointerEvents[name] = fn; listenerOptions[name] = value; },
    getBoundingClientRect() { return options.canvasRect || { left: 12, top: 20 }; }, setPointerCapture() {}
  };
  const sdk = {
    createCanvas: () => canvas,
    getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 3 }),
    onHide(fn) { lifecycle.hide = fn; }, onShow(fn) { lifecycle.show = fn; },
    onTouchStart(fn) { pointerEvents.touchstart = fn; },
    onTouchMove(fn) { pointerEvents.touchmove = fn; },
    onTouchEnd(fn) { pointerEvents.touchend = fn; },
    onTouchCancel(fn) { pointerEvents.touchcancel = fn; },
    getStorageSync(key) { if (options.storageFailure) throw new Error('storage denied'); return storage.get(key); },
    setStorageSync(key, value) { if (options.storageFailure || key === options.writeFailureKey) throw new Error('storage full'); storage.set(key, key === options.corruptWriteKey ? 'incomplete' : value); },
    removeStorageSync(key) { storage.delete(key); },
    createRewardedVideoAd(config) { rewards.push(config); return {}; },
    createInterstitialAd(config) { interstitials.push(config); return {}; }
  };
  const document = {
    hidden: false,
    getElementById: () => canvas,
    querySelector: () => canvas,
    addEventListener(name, fn) { browserEvents[name] = fn; }
  };
  const window = {
    location: { search: options.search || '' },
    innerWidth: 480, innerHeight: 920, devicePixelRatio: 2,
    ...(options.visualViewport ? { visualViewport: { addEventListener(name, fn) { viewportEvents[name] = fn; } } } : {}),
    addEventListener(name, fn) { browserEvents[name] = fn; },
    localStorage: {
      getItem(key) { if (options.storageFailure) throw new Error('storage denied'); return storage.get(key); },
      setItem(key, value) { if (options.storageFailure || key === options.writeFailureKey) throw new Error('storage full'); storage.set(key, key === options.corruptWriteKey ? 'incomplete' : value); },
      removeItem(key) { storage.delete(key); }
    }
  };
  const context = vm.createContext({
    require: name => require(path.resolve(__dirname, '../src', name)),
    module: { exports: {} },
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    POPCORN_CONFIG: Object.assign({ mode: 'baseline', appId: 'tt-live-app', rewardAdUnitId: 'live-reward-unit', interstitialAdUnitId: 'live-interstitial-unit' }, options.config),
    ...(options.browser ? { document, window } : { tt: sdk })
  });
  vm.runInContext(source, context, { filename: 'src/platform.js' });
  const platform = context.module.exports.createPlatform();
  return {
    platform, sdk, rewards, interstitials, lifecycle, browserEvents, pointerEvents, viewportEvents, listenerOptions, canvas, document, window, storage,
    saveKey: context.module.exports.SAVE_KEY,
    at(ms) { now = START + ms; },
    runTimers() {
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    },
    pendingTimers: () => timers.size
  };
}

function browserPointer(h, type, id, x = 100, y = 200, overrides = {}) {
  h.pointerEvents[type]({ pointerId: id, clientX: x, clientY: y,
    pointerType: 'touch', button: 0, preventDefault() {}, ...overrides });
}

test('browser pointers map a scaled CSS canvas into logical coordinates independently of device pixels', () => {
  const h = harness({ browser: true, canvasRect: { left: 10.5, top: 20.25, width: 240, height: 230 } });
  const points = [];
  h.window.devicePixelRatio = 4;
  h.canvas.width = 1920; h.canvas.height = 3680;
  h.platform.onPointer(point => points.push({ ...point }));
  browserPointer(h, 'pointerdown', 9, 130.5, 135.25);
  browserPointer(h, 'pointermove', 9, -1.5, 260.25);
  assert.deepEqual(points, [
    { type: 'down', x: 240, y: 460, id: 9 },
    { type: 'move', x: -24, y: 960, id: 9 }
  ], 'outside-canvas points stay outside so a release can cancel rather than clamp into a target');
  h.pointerEvents.lostpointercapture({ pointerId: 9 });
  assert.deepEqual(points.at(-1), { type: 'cancel', x: -24, y: 960, id: 9 });

  const fallback = harness({ browser: true, canvasRect: { left: 12, top: 20, width: 0, height: NaN } });
  fallback.platform.onPointer(point => points.push({ ...point }));
  browserPointer(fallback, 'pointerdown', 2, 100, 200);
  assert.deepEqual(points.at(-1), { type: 'down', x: 88, y: 180, id: 2 }, 'missing or invalid CSS dimensions retain an unscaled fallback');
});

test('browser wheel maps position and pixel, line and page deltas to logical canvas distances', () => {
  const h = harness({ browser: true, canvasRect: { left: 12, top: 20, width: 240, height: 460 } });
  const scrolls = [], pointers = [];
  let prevented = 0;
  h.window.devicePixelRatio = 3;
  const unsubscribe = h.platform.onScroll(event => scrolls.push({ ...event }));
  h.platform.onPointer(event => pointers.push(event));
  const wheel = (deltaY, deltaMode) => h.pointerEvents.wheel({ clientX: 132, clientY: 250, deltaY, deltaMode,
    preventDefault() { prevented++; } });
  wheel(30, 0); wheel(-3, 1); wheel(0.5, 2);
  assert.deepEqual(scrolls, [
    { x: 240, y: 460, deltaY: 60 },
    { x: 240, y: 460, deltaY: -96 },
    { x: 240, y: 460, deltaY: 460 }
  ]);
  assert.equal(h.listenerOptions.wheel.passive, false);
  assert.equal(prevented, 3);
  assert.equal(pointers.length, 0, 'wheel cannot synthesize a transfer or a purchase pointer');
  wheel(0, 0); wheel(Infinity, 0); wheel(NaN, 1);
  assert.equal(scrolls.length, 3); assert.equal(prevented, 3);
  unsubscribe(); wheel(8, 0);
  assert.equal(scrolls.length, 3, 'scroll subscriptions can be removed');
});

test('visual viewport resize and scroll cancel held input and refresh layout without a lifecycle transition', () => {
  const h = harness({ browser: true, visualViewport: true });
  const pointers = [], resizes = [];
  let cancels = 0, hides = 0, shows = 0;
  h.platform.onPointer(point => pointers.push({ ...point }));
  h.platform.onInputCancel(() => cancels++);
  h.platform.onResize(info => resizes.push(info));
  h.platform.onHide(() => hides++); h.platform.onShow(() => shows++);
  browserPointer(h, 'pointerdown', 1); browserPointer(h, 'pointermove', 1, 180, 260);
  h.window.innerHeight = 640;
  h.viewportEvents.resize();
  assert.deepEqual(pointers.at(-1), { type: 'cancel', x: 168, y: 240, id: 1 });
  assert.equal(resizes.at(-1).height, 640);
  const count = pointers.length;
  h.viewportEvents.scroll();
  h.pointerEvents.lostpointercapture({ pointerId: 1 });
  assert.equal(pointers.length, count, 'viewport cancellation clears the tracked pointer once');
  assert.equal(cancels, 2); assert.equal(resizes.length, 2);
  assert.equal(hides, 0); assert.equal(shows, 0);

  browserPointer(h, 'pointerdown', 2);
  h.browserEvents.resize();
  assert.equal(pointers.at(-1).type, 'cancel');
  assert.equal(pointers.at(-1).id, 2);
  assert.equal(cancels, 3); assert.equal(resizes.length, 3);
});

test('browser input: lost capture cancels only the matching active pointer at its latest position', () => {
  const h = harness({ browser: true }), events = [];
  h.platform.onPointer(point => events.push({ ...point }));
  browserPointer(h, 'pointerdown', 0);
  browserPointer(h, 'pointerdown', 7);
  browserPointer(h, 'pointermove', 0, 160, 290);
  h.pointerEvents.lostpointercapture({ pointerId: 9 });
  assert.equal(events.length, 3, 'an unrelated capture loss cannot cancel a held pointer');
  h.pointerEvents.lostpointercapture({ pointerId: 0 });
  assert.deepEqual(events.at(-1), { type: 'cancel', x: 148, y: 270, id: 0 });
  h.pointerEvents.lostpointercapture({ pointerId: 0 });
  assert.equal(events.length, 4, 'duplicate capture loss cannot emit a second cancel');
  h.browserEvents.blur();
  assert.deepEqual(events.at(-1), { type: 'cancel', x: 88, y: 180, id: 7 });
  assert.equal(events.length, 5, 'the other held pointer remains tracked until focus loss');
});

test('browser input: blur cancels held pointers without changing lifecycle or cancelling released input', () => {
  const h = harness({ browser: true }), events = [];
  let hides = 0, shows = 0, resizes = 0;
  h.platform.onPointer(point => events.push({ ...point }));
  h.platform.onHide(() => hides++); h.platform.onShow(() => shows++); h.platform.onResize(() => resizes++);
  browserPointer(h, 'pointermove', 1);
  browserPointer(h, 'pointerdown', 2);
  browserPointer(h, 'pointerup', 2);
  browserPointer(h, 'pointerdown', 3);
  browserPointer(h, 'pointercancel', 3);
  browserPointer(h, 'pointerdown', 4, 100, 200, { pointerType: 'mouse', button: 2 });
  browserPointer(h, 'pointerdown', 5);
  browserPointer(h, 'pointerdown', 6);
  h.browserEvents.blur();
  assert.deepEqual(events.filter(point => point.type === 'cancel').map(point => point.id), [3, 5, 6]);
  const count = events.length;
  h.browserEvents.blur();
  for (const pointerId of [2, 3, 5, 6]) h.pointerEvents.lostpointercapture({ pointerId });
  assert.equal(events.length, count, 'released, cancelled and already blurred pointers are cleared');
  assert.equal(hides, 0); assert.equal(shows, 0); assert.equal(resizes, 0);
});

test('native input: touch cancellation forwards changed pointers with matching identifiers', () => {
  const h = harness(), events = [];
  h.platform.onPointer(point => events.push({ ...point }));
  h.pointerEvents.touchstart({ changedTouches: [
    { identifier: 0, screenX: 100, screenY: 200 }, { identifier: 7, clientX: 120, clientY: 240 }
  ] });
  h.pointerEvents.touchcancel({
    changedTouches: [{ identifier: 0, screenX: 110, screenY: 220 }],
    touches: [{ identifier: 7, clientX: 120, clientY: 240 }]
  });
  assert.deepEqual(events, [
    { type: 'down', x: 100, y: 200, id: 0 },
    { type: 'down', x: 120, y: 240, id: 7 },
    { type: 'cancel', x: 110, y: 220, id: 0 }
  ]);
});

test('native touchcancel without changed touches cancels the interaction without inventing pointer identities', () => {
  const h = harness(), pointers = [];
  let cancellations = 0;
  h.platform.onPointer(point => pointers.push({ ...point }));
  h.platform.onInputCancel(() => cancellations++);
  h.pointerEvents.touchstart({ changedTouches: [{ identifier: 7, screenX: 90, screenY: 120 }] });
  h.pointerEvents.touchcancel({ changedTouches: [], touches: [{ identifier: 7, screenX: 90, screenY: 120 }] });
  h.pointerEvents.touchcancel({ touches: [] });
  h.pointerEvents.touchcancel();
  assert.equal(cancellations, 3);
  assert.deepEqual(pointers, [{ type: 'down', x: 90, y: 120, id: 7 }]);
});

test('safe area normalization preserves valid bounds and makes malformed native or CSS values usable', () => {
  const h = harness();
  const safeArea = { left: 8, top: 36, right: 382, bottom: 820, width: 999, height: -1 };
  h.sdk.getSystemInfoSync = () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 3, safeArea });
  const initial = h.platform.getSystemInfo().safeArea;
  assert.deepEqual({ ...initial }, { left: 8, top: 36, right: 382, bottom: 820, width: 374, height: 784 });
  initial.top = 0;
  assert.equal(safeArea.top, 36, 'normalization does not mutate native return values');
  for (const value of [null, {}, 'invalid', { left: NaN, top: Infinity, right: null, bottom: '20' },
    { left: 900, right: -10, top: 900, bottom: -10 }]) {
    h.sdk.getSystemInfoSync = () => ({ windowWidth: 390, windowHeight: 844, safeArea: value });
    assert.deepEqual({ ...h.platform.getSystemInfo().safeArea }, { left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844 });
  }
  h.sdk.getSystemInfoSync = () => ({ windowWidth: 390, windowHeight: 844, safeArea: { left: 8, top: 36, width: 374, height: 784 } });
  assert.deepEqual({ ...h.platform.getSystemInfo().safeArea }, { left: 8, top: 36, right: 382, bottom: 820, width: 374, height: 784 });

  const browser = harness({ browser: true });
  browser.document.documentElement = {};
  browser.window.getComputedStyle = () => ({ getPropertyValue(name) { return { '--safe-top': '28px', '--safe-bottom': '20px', '--safe-left': '-7px', '--safe-right': 'NaN' }[name]; } });
  assert.deepEqual({ ...browser.platform.getSystemInfo().safeArea }, { left: 0, top: 28, right: 480, bottom: 900, width: 480, height: 872 });
  browser.window.getComputedStyle = () => { throw new Error('styles unavailable'); };
  assert.deepEqual({ ...browser.platform.getSystemInfo().safeArea }, { left: 0, top: 0, right: 480, bottom: 920, width: 480, height: 920 });
});

test('system info: native menu geometry stays in screen pixels and refreshes on foreground', () => {
  const h = harness();
  const rect = { left: 286, top: 63, right: 378, bottom: 95, width: 92, height: 32 };
  let calls = 0;
  h.sdk.getMenuButtonLayout = () => { calls++; return rect; };
  const first = h.platform.getSystemInfo();
  assert.deepEqual(JSON.parse(JSON.stringify(first.menuButton)), rect);
  assert.equal(first.pixelRatio, 3, 'capsule coordinates must not be multiplied by pixel ratio');
  first.menuButton.top = 0;
  assert.equal(rect.top, 63, 'the normalized result cannot mutate native geometry');
  rect.top = 51; rect.bottom = 83;
  let resized;
  h.platform.onResize(info => { resized = info; });
  h.lifecycle.show({});
  assert.equal(calls, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(resized.menuButton)), rect, 'foreground resize rereads the capsule');
});

test('system info: missing, failed or invalid menu geometry uses a null fallback', async t => {
  const rect = { left: 286, top: 63, right: 378, bottom: 95, width: 92, height: 32 };
  for (const [name, getLayout] of [
    ['missing method', undefined],
    ['native failure', () => { throw new Error('layout unavailable'); }],
    ['missing value', () => null],
    ['early empty result', () => ({})],
    ['null coordinates', () => ({ ...rect, left: null })],
    ['non-numeric coordinates', () => ({ ...rect, top: '63' })],
    ['non-finite coordinates', () => ({ ...rect, bottom: Infinity })],
    ['empty bounds', () => ({ ...rect, right: rect.left, width: 0 })],
    ['inverted bounds', () => ({ ...rect, bottom: rect.top - 1 })],
    ['negative origin', () => ({ ...rect, left: -1 })],
    ['outside current window', () => ({ ...rect, right: 400 })]
  ]) await t.test(name, () => {
    const h = harness(); h.sdk.getMenuButtonLayout = getLayout;
    const info = h.platform.getSystemInfo();
    assert.equal(info.menuButton, null);
    assert.equal(info.width, 390); assert.equal(info.height, 844);
  });
  const browser = harness({ browser: true });
  browser.sdk.getMenuButtonLayout = () => { throw new Error('browser must not read native menu geometry'); };
  assert.equal(browser.platform.getSystemInfo().menuButton, null);
});

test('storage: browser and SDK round trip saves and reject corrupt data without throwing', async (t) => {
  for (const browser of [true, false]) await t.test(browser ? 'browser' : 'SDK', () => {
    const h = harness({ browser });
    assert.equal(h.platform.load(), null);
    assert.equal(h.platform.save({ version: 1, coins: 123 }), true);
    assert.equal(h.platform.load().coins, 123);
    h.storage.set(h.saveKey, '{bad JSON');
    assert.equal(h.platform.load(), null); assert.ok(h.platform.lastStorageError);
    h.storage.set(h.saveKey, '[]');
    assert.equal(h.platform.load(), null); assert.equal(h.platform.lastStorageError, 'invalid-save');
    assert.equal(h.platform.save({ coins: 456 }), true); assert.equal(h.platform.lastStorageError, '');
    const cyclic = {}; cyclic.self = cyclic;
    assert.equal(h.platform.save(cyclic), false); assert.ok(h.platform.lastStorageError);
  });
});

test('storage: unavailable/full storage reports failure in browser and SDK', async (t) => {
  for (const browser of [true, false]) await t.test(browser ? 'browser' : 'SDK', () => {
    const h = harness({ browser, storageFailure: true });
    assert.equal(h.platform.load(), null); assert.match(h.platform.lastStorageError, /denied/);
    assert.equal(h.platform.save({ coins: 10 }), false); assert.match(h.platform.lastStorageError, /full/);
  });
});

test('lifecycle: duplicated hide/show events are coalesced and subscriptions can be removed', async (t) => {
  for (const browser of [true, false]) await t.test(browser ? 'browser' : 'SDK', () => {
    const h = harness({ browser }); let hides = 0, shows = 0, resizes = 0;
    const offHide = h.platform.onHide(() => hides++);
    h.platform.onShow(() => shows++); h.platform.onResize(() => resizes++);
    const hide = browser ? h.browserEvents.pagehide : h.lifecycle.hide;
    const show = browser ? h.browserEvents.pageshow : h.lifecycle.show;
    hide(); hide(); show(); show();
    assert.equal(hides, 1); assert.equal(shows, 1); assert.equal(resizes, 2);
    offHide(); hide(); show(); assert.equal(hides, 1); assert.equal(shows, 2);
  });
});


test('pipeline disables every legacy ad path without creating an SDK instance', async () => {
  for (const browser of [false, true]) {
    const h = harness({ browser, config: { allowSimulatedAds: true, developerHoldTap: true } });
    assert.equal(h.platform.config.allowSimulatedAds, false);
    assert.equal(h.platform.config.developerHoldTap, false);
    for (const kind of ['turbo', 'order', 'sponsor', 'brand', 'offline']) {
      const result = await h.platform.reward(kind, { simulate: 'complete' });
      assert.equal(result.completed, false);
      assert.equal(result.reason, 'disabled');
    }
    h.at(3600000);
    assert.equal(await h.platform.interstitial(), false);
    assert.equal(h.rewards.length, 0);
    assert.equal(h.interstitials.length, 0);
    assert.equal(h.pendingTimers(), 0);
  }
});

test('pipeline storage uses only the v2 key and leaves the original save untouched', () => {
  for (const browser of [false, true]) {
    const h = harness({ browser });
    const oldKey = 'little_popcorn_factory_v1';
    const oldSave = JSON.stringify({ version: 1, coins: 987654321, energy: 100 });
    h.storage.set(oldKey, oldSave);
    assert.equal(h.saveKey, 'little_popcorn_factory_pipeline_v2');
    assert.equal(h.platform.load(), null);
    assert.equal(h.platform.save({ version: 2, coins: 12 }), true);
    assert.equal(h.platform.load().coins, 12);
    assert.equal(h.storage.get(oldKey), oldSave);
  }
});

test('P0 opt-in isolates all reads and writes from both old save keys on browser and native', () => {
  const { CONFIG } = require('../src/factory-rules');
  for (const browser of [false, true]) {
    const h = harness({ browser, config: { experiment: CONFIG.transferExperiment.id } });
    const old = '{"version":2,"coins":789}';
    h.storage.set('little_popcorn_factory_pipeline_v2', old);
    h.storage.set('little_popcorn_factory_v1', 'old factory');
    assert.equal(h.platform.saveKey, CONFIG.transferExperiment.saveKey);
    assert.equal(h.platform.load(), null);
    const data = { version: 3, experiment: CONFIG.transferExperiment.id, coins: 12 };
    assert.equal(h.platform.save(data), true);
    assert.equal(h.platform.load().coins, 12);
    assert.equal(h.storage.get('little_popcorn_factory_pipeline_v2'), old);
    assert.equal(h.storage.get('little_popcorn_factory_v1'), 'old factory');
  }
});

test('only the exact P0 browser switch enables experimental storage', () => {
  for (const search of ['?experiment=manual-transfer-p0', '?x=1&experiment=manual-transfer-p0&y=2']) {
    const h = harness({ browser: true, search });
    assert.equal(h.platform.config.experiment, 'manual-transfer-p0');
    assert.equal(h.platform.saveKey, 'little_popcorn_factory_manual_transfer_p0_v3');
  }
  for (const search of ['', '?experiment=manual-transfer', '?experiment=manual-transfer-p0-other', '?otherexperiment=manual-transfer-p0']) {
    const h = harness({ browser: true, search, config: { experiment: true } });
    assert.equal(h.platform.config.experiment, null);
    assert.equal(h.platform.saveKey, 'little_popcorn_factory_pipeline_v2');
  }
});

test('browser blur cancels tap-selected input even after the pointer has been released', () => {
  const h = harness({ browser: true });
  let cancelled = 0;
  h.platform.onInputCancel(() => cancelled++);
  browserPointer(h, 'pointerdown', 1); browserPointer(h, 'pointerup', 1);
  h.browserEvents.blur();
  assert.equal(cancelled, 1);
});

test('v15 default storage migrates by preserving raw v2 before writing and verifying v4', () => {
  for (const browser of [true, false]) {
    const h = harness({ browser, config: { mode: undefined } });
    const key = 'little_popcorn_factory_automation_v4';
    const original = '{ "version": 2, "coins": 42 }';
    h.storage.set('little_popcorn_factory_pipeline_v2', original);
    h.storage.set('little_popcorn_factory_v1', 'untouched v1');
    assert.equal(h.platform.config.mode, 'v15');
    assert.equal(h.platform.saveKey, key);
    assert.equal(h.platform.load().version, 2);
    assert.equal(h.platform.save({ version: 4, mode: 'v15', coins: 42 }), true);
    assert.equal(h.storage.get(key + '_backup_v2'), original);
    assert.equal(h.storage.get('little_popcorn_factory_pipeline_v2'), original);
    assert.equal(h.storage.get('little_popcorn_factory_v1'), 'untouched v1');
    assert.equal(h.platform.load().version, 4);
    assert.equal(h.platform.save({ version: 2 }), false, 'a fallback legacy run cannot overwrite the v4 key');
  }
});
test('v15 backup and new save failures preserve original v2 and are explicitly reported', () => {
  const key = 'little_popcorn_factory_automation_v4';
  for (const browser of [true, false]) for (const failure of [
    { writeFailureKey: key + '_backup_v2' }, { writeFailureKey: key },
    { corruptWriteKey: key + '_backup_v2' }, { corruptWriteKey: key }
  ]) {
    const h = harness({ browser, config: { mode: 'v15' }, ...failure });
    const original = '{"version":2,"coins":321}';
    h.storage.set('little_popcorn_factory_pipeline_v2', original);
    assert.equal(h.platform.load().version, 2);
    assert.equal(h.platform.save({ version: 4, mode: 'v15', coins: 321 }), false);
    assert.ok(h.platform.lastStorageError);
    assert.equal(h.storage.get('little_popcorn_factory_pipeline_v2'), original);
    assert.equal(h.storage.has(key), false, 'a failed new document is not activated on the next launch');
    if (failure.writeFailureKey?.endsWith('_backup_v2') || failure.corruptWriteKey?.endsWith('_backup_v2')) assert.equal(h.storage.has(key), false);
  }
});
test('baseline query and P0 override complete mode while default startup never loads P0', () => {
  const baseline = harness({ browser: true, search: '?mode=baseline', config: { mode: 'v15' } });
  assert.equal(baseline.platform.saveKey, 'little_popcorn_factory_pipeline_v2');
  const p0 = harness({ browser: true, search: '?experiment=manual-transfer-p0', config: { mode: 'v15' } });
  assert.equal(p0.platform.saveKey, 'little_popcorn_factory_manual_transfer_p0_v3');
  const current = harness({ browser: true, config: { mode: undefined } });
  current.storage.set('little_popcorn_factory_manual_transfer_p0_v3', '{"version":3}');
  assert.equal(current.platform.load(), null);
});
