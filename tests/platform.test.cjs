'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/platform.js'), 'utf8');
const START = 1800000000000;

function makeAd(options = {}) {
  const listeners = { close: new Set(), error: new Set(), load: new Set() };
  const ad = {
    showCalls: 0, loadCalls: 0, destroyCalls: 0,
    onClose(fn) { listeners.close.add(fn); }, offClose(fn) { listeners.close.delete(fn); },
    onError(fn) { listeners.error.add(fn); }, offError(fn) { listeners.error.delete(fn); },
    onLoad(fn) { listeners.load.add(fn); }, offLoad(fn) { listeners.load.delete(fn); },
    show() {
      ad.showCalls++;
      if (options.showThrow) throw new Error('show failed synchronously');
      return options.showReject ? Promise.reject({ errCode: 1001 }) : Promise.resolve();
    },
    load() { ad.loadCalls++; return Promise.resolve(); },
    destroy() {
      ad.destroyCalls++;
      if (options.destroyThrow) throw new Error('destroy failed synchronously');
      if (options.destroyReject) return Promise.reject(new Error('destroy failed asynchronously'));
      return options.destroyPromise;
    },
    emit(event, value) { for (const fn of [...listeners[event]]) fn(value); },
    listeners(event) { return [...listeners[event]]; }
  };
  if (options.destroyUnsupported) delete ad.destroy;
  return ad;
}

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
    onTouchEnd(fn) { pointerEvents.touchend = fn; },
    getStorageSync(key) { if (options.storageFailure) throw new Error('storage denied'); return storage.get(key); },
    setStorageSync(key, value) { if (options.storageFailure) throw new Error('storage full'); storage.set(key, value); },
    createRewardedVideoAd(config) {
      if (options.reuseRewardInstance && rewards.length) return rewards[0];
      const ad = makeAd(options.rewardAd);
      ad.config = config; rewards.push(ad); return ad;
    },
    createInterstitialAd(config) {
      const ad = makeAd(options.interstitialAd);
      ad.config = config; interstitials.push(ad); return ad;
    }
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

async function flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); }
async function showInterstitial(h) {
  const promise = h.platform.interstitial();
  await flush();
  const ad = h.interstitials.at(-1);
  assert.ok(ad, 'an eligible request should create an SDK ad');
  assert.equal(ad.showCalls, 1);
  ad.emit('close');
  assert.equal(await promise, true);
  return ad;
}

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

test('reward: only explicit SDK isEnded=true grants a reward', async (t) => {
  for (const [name, payload, completed] of [
    ['completed', { isEnded: true }, true], ['cancelled', { isEnded: false }, false],
    ['missing payload', undefined, false], ['empty payload', {}, false],
    ['truthy non-boolean payload', { isEnded: 1 }, false]
  ]) await t.test(name, async () => {
    const h = harness();
    const promise = h.platform.reward('turbo');
    assert.equal(h.platform.adBusy, true);
    await flush();
    assert.equal(h.platform.adBusy, true, 'show() fulfillment is not verified completion');
    h.rewards[0].emit('close', payload);
    const result = await promise;
    assert.equal(result.completed, completed);
    assert.equal(result.reason, completed ? 'completed' : 'cancelled');
    assert.equal(h.platform.adBusy, false);
    assert.equal(h.pendingTimers(), 0);
  });
});

test('reward: duplicate and stale callbacks settle and track only once', async () => {
  const h = harness();
  const promise = h.platform.reward('order');
  const ad = h.rewards[0];
  const close = ad.listeners('close')[0], error = ad.listeners('error')[0];
  close({ isEnded: true }); close({ isEnded: true }); error({ errCode: 1001 });
  assert.equal((await promise).completed, true);
  assert.equal(ad.listeners('close').length, 0);
  assert.equal(ad.listeners('error').length, 0);
  assert.equal(h.platform.getAnalytics().filter(e => e.event === 'ad_complete').length, 1);
  assert.equal(h.platform.getAnalytics().filter(e => e.event === 'ad_incomplete').length, 0);
  const second = h.platform.reward('order');
  close({ isEnded: true });
  assert.equal(h.platform.adBusy, true, 'a previous request cannot complete the next one');
  ad.emit('close', { isEnded: false });
  assert.equal((await second).completed, false);
  assert.equal(h.rewards.length, 1, 'the SDK rewarded ad is reused');
});

test('reward: SDK errors, rejected show(), and synchronous errors release the busy flag', async (t) => {
  for (const mode of ['callback', 'showReject', 'showThrow']) await t.test(mode, async () => {
    const h = harness({ rewardAd: { [mode]: true } });
    const promise = h.platform.reward('sponsor');
    if (mode === 'callback') h.rewards[0].emit('error', { errCode: 1001 });
    const result = await promise;
    assert.equal(result.completed, false); assert.equal(result.reason, 'failed');
    assert.equal(h.platform.adBusy, false); assert.equal(h.pendingTimers(), 0);
    assert.equal(h.rewards[0].destroyCalls, 1, 'a failed SDK instance is retired before retry');
  });
});

test('reward: a failed instance cannot deliver a late close into an immediate brand retry', async () => {
  const h = harness();
  const first = h.platform.reward('brand'), failedAd = h.rewards[0];
  failedAd.emit('error', { errCode: 1001 });
  assert.equal((await first).reason, 'failed');
  assert.equal(failedAd.destroyCalls, 1);
  const second = h.platform.reward('brand');
  assert.equal(h.rewards.length, 2, 'retry creates an independent SDK event source without a cooldown');
  failedAd.emit('close', { isEnded: true });
  failedAd.emit('error', { errCode: 1001 });
  assert.equal(h.platform.adBusy, true, 'late events emitted by the old instance cannot settle the new reward');
  assert.equal(h.platform.getAnalytics().filter(e => e.event === 'ad_complete').length, 0);
  h.rewards[1].emit('close', { isEnded: true });
  assert.equal((await second).completed, true);
  assert.equal(h.platform.getAnalytics().filter(e => e.event === 'ad_complete').length, 1);
});

test('reward: asynchronous destruction releases gameplay but prevents recreation until cleanup settles', async () => {
  let resolveDestroy;
  const destroyPromise = new Promise(resolve => { resolveDestroy = resolve; });
  const h = harness({ rewardAd: { destroyPromise } });
  const first = h.platform.reward('brand'), failedAd = h.rewards[0];
  failedAd.emit('error', { errCode: 1001 });
  assert.equal((await first).reason, 'failed');
  assert.equal(h.platform.adBusy, false, 'cleanup does not freeze the game');
  assert.equal((await h.platform.reward('brand')).reason, 'unavailable');
  assert.equal(h.rewards.length, 1, 'the globally unique SDK instance is not recreated during destruction');
  resolveDestroy(); await flush();
  const retry = h.platform.reward('brand');
  assert.equal(h.rewards.length, 2);
  failedAd.emit('close', { isEnded: true });
  assert.equal(h.platform.adBusy, true);
  h.rewards[1].emit('close', { isEnded: true });
  assert.equal((await retry).completed, true);
});

test('reward: failed or unsupported destruction never rebinds a contaminated SDK singleton', async (t) => {
  for (const mode of ['destroyThrow', 'destroyReject', 'destroyUnsupported']) await t.test(mode, async () => {
    const h = harness({ rewardAd: { [mode]: true }, reuseRewardInstance: true });
    const first = h.platform.reward('brand'), failedAd = h.rewards[0];
    failedAd.emit('error', { errCode: 1001 });
    assert.equal((await first).reason, 'failed');
    await flush();
    const retry = h.platform.reward('brand');
    assert.equal((await retry).reason, 'unavailable');
    assert.equal(failedAd.showCalls, 1, 'the returned contaminated instance must not start another reward');
    assert.equal(failedAd.listeners('close').length, 0);
    assert.equal(failedAd.listeners('error').length, 0);
    failedAd.emit('close', { isEnded: true });
    assert.equal(h.platform.getAnalytics().filter(e => e.event === 'ad_complete').length, 0);
    assert.equal(h.platform.adBusy, false);
    // Recovery is tied to instance identity, not a fixed wait or a permanent lockout.
    const freshAd = makeAd();
    h.sdk.createRewardedVideoAd = () => freshAd;
    const recovered = h.platform.reward('brand');
    failedAd.emit('close', { isEnded: true });
    assert.equal(h.platform.adBusy, true);
    freshAd.emit('close', { isEnded: true });
    assert.equal((await recovered).completed, true);
  });
});

test('reward: timeout never grants and permits a fresh SDK request', async () => {
  const h = harness();
  const first = h.platform.reward('turbo');
  h.at(180000); h.runTimers();
  assert.equal((await first).reason, 'timeout');
  assert.equal(h.rewards[0].destroyCalls, 1);
  assert.equal(h.platform.adBusy, false);
  const second = h.platform.reward('turbo');
  assert.equal(h.rewards.length, 2);
  h.rewards[0].emit('close', { isEnded: true });
  assert.equal(h.platform.adBusy, true, 'a timed-out SDK instance cannot complete the replacement request');
  h.rewards[1].emit('close', { isEnded: true });
  assert.equal((await second).completed, true);
});

test('ads: concurrent requests cannot overlap across placements', async () => {
  const h = harness(); h.at(90000);
  const reward = h.platform.reward('turbo');
  assert.equal((await h.platform.reward('order')).reason, 'busy');
  assert.equal(await h.platform.interstitial(), false);
  assert.equal(h.rewards.length, 1); assert.equal(h.interstitials.length, 0);
  h.rewards[0].emit('close', { isEnded: true }); await reward;
  h.at(150000);
  const interstitial = h.platform.interstitial(); await flush();
  assert.equal((await h.platform.reward('order')).reason, 'busy');
  h.interstitials[0].emit('close'); await interstitial;
  assert.equal(h.platform.adBusy, false);
});

test('ads: missing or placeholder app/ad IDs never call the SDK', async (t) => {
  for (const config of [
    { appId: '' }, { appId: 'YOUR_APP_ID' }, { rewardAdUnitId: '', interstitialAdUnitId: '' },
    { rewardAdUnitId: 'test-reward', interstitialAdUnitId: 'TODO-interstitial' }
  ]) await t.test(JSON.stringify(config), async () => {
    const h = harness({ config }); h.at(90000);
    assert.equal((await h.platform.reward('turbo')).reason, 'unavailable');
    assert.equal(await h.platform.interstitial(), false);
    assert.equal(h.rewards.length, 0); assert.equal(h.interstitials.length, 0);
    assert.equal(h.platform.adBusy, false);
  });
});

test('browser: simulated ads are disabled by default, including explicit completion', async () => {
  const h = harness({ browser: true });
  assert.equal((await h.platform.reward('turbo', { simulate: 'complete' })).reason, 'unavailable');
  assert.equal(await h.platform.interstitial(), false);
});

test('browser: enabled simulations require an explicit outcome and distinguish completion/cancel/failure', async () => {
  const h = harness({ browser: true, config: { allowSimulatedAds: true } });
  assert.equal((await h.platform.reward('turbo')).reason, 'simulation-choice-required');
  assert.equal((await h.platform.reward('turbo', { simulate: 'yes' })).completed, false);
  for (const [simulate, completed, reason] of [
    ['complete', true, 'simulated-complete'], ['cancel', false, 'cancelled'], ['fail', false, 'failed']
  ]) {
    const result = await h.platform.reward('turbo', { simulate });
    assert.equal(result.completed, completed); assert.equal(result.reason, reason); assert.equal(result.simulated, true);
  }
  assert.equal(h.platform.getAnalytics().filter(e => e.event === 'ad_simulated').length, 3);
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

test('interstitial: no 120-second product cooldown, with 90-second startup and 60-second platform spacing', async () => {
  const h = harness();
  h.at(89999); assert.equal(await h.platform.interstitial(), false);
  assert.equal(h.interstitials.length, 0);
  h.at(90000); const first = await showInterstitial(h);
  assert.equal(first.loadCalls, 1); assert.equal(first.destroyCalls, 1);
  h.at(149999); assert.equal(await h.platform.interstitial(), false);
  h.at(150000); await showInterstitial(h);
  assert.equal(h.interstitials.length, 2);
});

test('interstitial: waits 60 seconds after a rewarded ad ends', async (t) => {
  for (const completed of [true, false]) await t.test(completed ? 'completed reward' : 'cancelled reward', async () => {
    const h = harness(); h.at(90000);
    const promise = h.platform.reward('turbo');
    h.rewards[0].emit('close', { isEnded: completed }); await promise;
    h.at(149999); assert.equal(await h.platform.interstitial(), false);
    h.at(150000); await showInterstitial(h);
  });
});

test('interstitial: first 20 minutes have a maximum of two impressions', async () => {
  const h = harness();
  h.at(90000); await showInterstitial(h);
  h.at(210000); await showInterstitial(h);
  h.at(330000); assert.equal(await h.platform.interstitial(), false);
  h.at(1199999); assert.equal(await h.platform.interstitial(), false);
  assert.equal(h.interstitials.length, 2);
  h.at(1200000); await showInterstitial(h);
  assert.equal(h.interstitials.length, 3);
});

test('interstitial: duplicate load/close callbacks do not show, count or settle twice', async () => {
  const h = harness(); h.at(90000);
  const promise = h.platform.interstitial();
  const ad = h.interstitials[0];
  const onLoad = ad.listeners('load')[0], onClose = ad.listeners('close')[0];
  onLoad(); onLoad(); await flush();
  assert.equal(ad.showCalls, 1);
  onClose(); onClose();
  assert.equal(await promise, true);
  assert.equal(ad.destroyCalls, 1);
  assert.equal(h.platform.getAnalytics().filter(e => e.event === 'ad_impression').length, 1);
  assert.equal(h.pendingTimers(), 0);
});

test('interstitial: failed show never counts an impression, releases lock, and has a 30-second retry backoff', async () => {
  const h = harness({ interstitialAd: { showReject: true } }); h.at(90000);
  assert.equal(await h.platform.interstitial(), false);
  assert.equal(h.platform.adBusy, false);
  assert.equal(h.interstitials[0].destroyCalls, 0, 'SDK does not permit destroying an unshown interstitial');
  h.at(119999); assert.equal(await h.platform.interstitial(), false);
  assert.equal(h.interstitials.length, 1);
  h.at(120000); assert.equal(await h.platform.interstitial(), false);
  assert.equal(h.interstitials.length, 2);
  assert.equal(h.platform.getAnalytics().filter(e => e.event === 'ad_impression').length, 0);
});

test('interstitial: late close/error callbacks after failure cannot alter impression caps or duplicate analytics', async () => {
  const h = harness({ interstitialAd: { showReject: true } }); h.at(90000);
  const promise = h.platform.interstitial();
  const ad = h.interstitials[0];
  const close = ad.listeners('close')[0], error = ad.listeners('error')[0];
  assert.equal(await promise, false);
  close(); error({ errCode: 1002 });
  assert.equal(h.platform.getAnalytics().filter(e => e.event === 'ad_impression').length, 0);
  assert.equal(h.platform.getAnalytics().filter(e => e.event === 'ad_incomplete').length, 1);
  assert.equal(ad.destroyCalls, 0);
  h.at(120000); assert.equal(await h.platform.interstitial(), false);
  assert.equal(h.interstitials.length, 2, 'a stale close cannot count an impression or extend retry protection');
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
