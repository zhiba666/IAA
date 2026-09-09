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
  const storage = new Map();
  const rewards = [];
  const interstitials = [];
  const canvas = {
    style: {}, addEventListener(name, fn) { pointerEvents[name] = fn; },
    getBoundingClientRect() { return { left: 12, top: 20 }; }, setPointerCapture() {}
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
    setStorageSync(key, value) { if (options.storageFailure) throw new Error('storage full'); storage.set(key, value); },
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
    innerWidth: 480, innerHeight: 920, devicePixelRatio: 2,
    addEventListener(name, fn) { browserEvents[name] = fn; },
    localStorage: {
      getItem(key) { if (options.storageFailure) throw new Error('storage denied'); return storage.get(key); },
      setItem(key, value) { if (options.storageFailure) throw new Error('storage full'); storage.set(key, value); }
    }
  };
  const context = vm.createContext({
    module: { exports: {} },
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    POPCORN_CONFIG: Object.assign({ appId: 'tt-live-app', rewardAdUnitId: 'live-reward-unit', interstitialAdUnitId: 'live-interstitial-unit' }, options.config),
    ...(options.browser ? { document, window } : { tt: sdk })
  });
  vm.runInContext(source, context, { filename: 'src/platform.js' });
  const platform = context.module.exports.createPlatform();
  return {
    platform, sdk, rewards, interstitials, lifecycle, browserEvents, pointerEvents, document, storage,
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
