'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/platform.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const FROM_SIDEBAR = { launch_from: 'homepage', location: 'sidebar_card', scene: '021036' };

function harness(options = {}) {
  let now = 1800000000000, timerId = 0, launchReads = 0, writes = 0;
  const timers = new Map(), events = {}, checks = [], navigations = [], order = [];
  const canvas = { style: {}, addEventListener() {} };
  const sdk = {
    createCanvas: () => canvas,
    getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844 }),
    getStorageSync: () => '', setStorageSync() { writes++; },
    onHide(fn) { events.hide = fn; },
    onShow(fn) {
      order.push('listen');
      if (options.showThrows) throw new Error('unsupported onShow');
      events.show = fn;
      if ('initialShow' in options) fn(options.initialShow);
    },
    getLaunchOptionsSync() {
      launchReads++; order.push('launch');
      if (options.launchThrows) throw new Error('unsupported launch info');
      if (options.showDuringLaunch) events.show(options.showDuringLaunch);
      return options.launch || {};
    },
    checkScene(request) { order.push('check'); checks.push(request); return options.check && options.check(request); },
    navigateToScene(request) { navigations.push(request); return options.navigate && options.navigate(request); }
  };
  for (const missing of options.missing || []) delete sdk[missing];
  const context = vm.createContext({ module: { exports: {} },
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay) { timers.set(++timerId, { fn, at: now + delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    ...(options.browser ? {
      document: { getElementById: () => canvas, addEventListener() {} },
      window: { addEventListener() {} }
    } : { tt: sdk })
  });
  vm.runInContext(source, context, { filename: 'src/platform.js' });
  const platform = context.module.exports.createPlatform();
  return { platform, sdk, checks, navigations, events, order,
    state: () => copy(platform.getSidebarState()),
    launchReads: () => launchReads, writes: () => writes, pendingTimers: () => timers.size,
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    }
  };
}

async function supported(h) {
  const pending = h.platform.checkSidebar();
  h.checks.at(-1).success({ isExist: true });
  assert.equal((await pending).supported, true);
}
async function flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

test('sidebar: browser, missing APIs and failed show subscription stay safely unavailable', async t => {
  for (const options of [
    { browser: true }, { missing: ['checkScene'] }, { missing: ['navigateToScene'] },
    { missing: ['onShow'] }, { showThrows: true }
  ]) await t.test(JSON.stringify(options), async () => {
    const h = harness(options);
    assert.deepEqual(h.state(), { supported: false, checking: false, fromSidebar: false });
    assert.equal((await h.platform.checkSidebar()).supported, false);
    assert.deepEqual(copy(await h.platform.navigateSidebar()), { ok: false, reason: 'unavailable' });
    assert.equal(h.checks.length, 0); assert.equal(h.navigations.length, 0); assert.equal(h.pendingTimers(), 0);
  });
});

test('sidebar: detection is explicit, concurrent probes share one request, and snapshots cannot mutate state', async () => {
  const h = harness();
  assert.equal(h.checks.length, 0); assert.equal(h.navigations.length, 0);
  const snapshot = h.platform.getSidebarState(); snapshot.supported = true;
  assert.equal(h.state().supported, false);
  const first = h.platform.checkSidebar(), second = h.platform.checkSidebar();
  assert.equal(first, second); assert.equal(h.checks.length, 1);
  assert.equal(h.checks[0].scene, 'sidebar'); assert.equal(h.state().checking, true);
  assert.equal((await h.platform.navigateSidebar()).reason, 'checking');
  assert.equal(h.navigations.length, 0);
  h.checks[0].success({ isExist: true });
  assert.deepEqual(copy(await first), { supported: true, checking: false, fromSidebar: false });
  assert.equal(h.pendingTimers(), 0);
});

test('sidebar: only exact isExist=true enables the entry and no probe can navigate automatically', async t => {
  for (const payload of [undefined, null, {}, { isExist: false }, { isExist: 1 }, { isExist: 'true' }]) {
    await t.test(JSON.stringify(payload) || 'undefined', async () => {
      const h = harness({ check: request => request.success(payload) });
      assert.equal((await h.platform.checkSidebar()).supported, false);
      assert.equal((await h.platform.navigateSidebar()).reason, 'unavailable');
      assert.equal(h.navigations.length, 0); assert.equal(h.pendingTimers(), 0);
    });
  }
});

test('sidebar: callback failure, synchronous SDK throw and Promise rejection clear probe state', async t => {
  for (const [name, check] of [
    ['callback', request => request.fail({ errMsg: 'unavailable' })],
    ['throw', () => { throw new Error('SDK failed'); }],
    ['rejection', () => Promise.reject(new Error('SDK failed'))]
  ]) await t.test(name, async () => {
    const h = harness({ check });
    assert.equal((await h.platform.checkSidebar()).supported, false);
    assert.equal(h.state().checking, false); assert.equal(h.pendingTimers(), 0);
  });
});

test('sidebar: fulfilled Promise alone cannot establish support; timeout and stale callbacks cannot poison retry', async () => {
  const h = harness({ check: () => Promise.resolve({ isExist: true }) });
  const first = h.platform.checkSidebar(); await flush();
  assert.equal(h.state().checking, true); assert.equal(h.state().supported, false);
  h.advance(5000); assert.equal((await first).supported, false);
  const second = h.platform.checkSidebar();
  h.checks[0].success({ isExist: true }); h.checks[0].fail({});
  assert.equal(h.state().checking, true); assert.equal(h.state().supported, false);
  h.checks[1].success({ isExist: true }); await second;
  h.checks[1].fail({}); h.checks[0].success({ isExist: false });
  assert.equal(h.state().supported, true); assert.equal(h.pendingTimers(), 0);
});

test('sidebar: synchronously captured onShow beats stale launch options and registration precedes lookup', () => {
  const h = harness({ initialShow: FROM_SIDEBAR, launch: { scene: '000000' } });
  assert.equal(h.state().fromSidebar, true); assert.equal(h.launchReads(), 0);
  const during = harness({ showDuringLaunch: FROM_SIDEBAR, launch: { scene: '000000' } });
  assert.equal(during.state().fromSidebar, true); assert.deepEqual(during.order, ['listen', 'launch']);
});

test('sidebar: launch info failures are optional; documented cold scenes are recognized without invented values', async t => {
  for (const scene of ['021036', '101036', '181036', '261036']) await t.test(scene, () => {
    assert.equal(harness({ launch: { scene } }).state().fromSidebar, true);
  });
  assert.equal(harness({ launchThrows: true }).state().fromSidebar, false);
  assert.equal(harness({ missing: ['getLaunchOptionsSync'] }).state().fromSidebar, false);
  assert.equal(harness({ launch: { scene: 21036 } }).state().fromSidebar, false);
  assert.equal(harness({ launch: { scene: 'sidebar' } }).state().fromSidebar, false);
});

test('sidebar: every latest onShow refreshes origin before lifecycle de-duplication, without retaining query data', () => {
  const h = harness({ launch: { scene: '021036' } });
  let resumes = 0;
  h.platform.onShow(() => { resumes++; assert.equal(h.state().fromSidebar, true); });
  h.events.show({ scene: '000000' }); assert.equal(h.state().fromSidebar, false);
  h.events.show(FROM_SIDEBAR); assert.equal(h.state().fromSidebar, true);
  assert.equal(resumes, 0, 'existing repeated-show coalescing is preserved');
  h.events.hide(); h.events.show(FROM_SIDEBAR); assert.equal(resumes, 1);
  h.events.show({ launch_from: 'homepage', location: 'homepage_expand' }); assert.equal(h.state().fromSidebar, true);
  h.events.show({ query: FROM_SIDEBAR }); assert.equal(h.state().fromSidebar, false);
  h.events.show(FROM_SIDEBAR); h.events.show(); assert.equal(h.state().fromSidebar, false);
  h.events.show({ ...FROM_SIDEBAR, launch_from: 'search' }); assert.equal(h.state().fromSidebar, false);
  assert.equal(h.launchReads(), 1, 'warm resumes must not reread initial launch options');
  assert.equal(h.writes(), 0, 'origin detection neither changes saves nor issues rewards');
});

test('sidebar: user navigation is immediate, duplicate clicks are blocked, and success never proves a return', async () => {
  const h = harness(); await supported(h);
  const pending = h.platform.navigateSidebar();
  assert.equal(h.navigations.length, 1, 'SDK invocation must stay inside user gesture stack');
  assert.equal(h.navigations[0].scene, 'sidebar');
  assert.equal((await h.platform.navigateSidebar()).reason, 'busy');
  h.navigations[0].success({ errMsg: 'navigateToScene:ok' });
  assert.deepEqual(copy(await pending), { ok: true, reason: 'navigated' });
  assert.equal(h.state().fromSidebar, false); assert.equal(h.pendingTimers(), 0);
  h.events.hide(); h.events.show(FROM_SIDEBAR); assert.equal(h.state().fromSidebar, true);
  h.navigations[0].fail({}); assert.equal(h.state().fromSidebar, true);
  assert.equal(h.writes(), 0);
});

test('sidebar: navigation failures and throws are bounded and leave supported games retryable', async t => {
  for (const [name, navigate] of [
    ['callback', request => request.fail({ errNo: 21101 })],
    ['throw', () => { throw new Error('SDK failed'); }],
    ['rejection', () => Promise.reject(new Error('SDK failed'))]
  ]) await t.test(name, async () => {
    const h = harness({ navigate }); await supported(h);
    assert.deepEqual(copy(await h.platform.navigateSidebar()), { ok: false, reason: 'failed' });
    assert.equal(h.state().supported, true); assert.equal(h.state().fromSidebar, false);
    await h.platform.navigateSidebar(); assert.equal(h.navigations.length, 2); assert.equal(h.pendingTimers(), 0);
  });
});

test('sidebar: navigation timeout releases its lock; late success cannot finish a newer request or change origin', async () => {
  const h = harness({ navigate: () => Promise.resolve() }); await supported(h);
  const first = h.platform.navigateSidebar(); await flush();
  assert.equal((await h.platform.navigateSidebar()).reason, 'busy');
  h.advance(10000); assert.deepEqual(copy(await first), { ok: false, reason: 'timeout' });
  const second = h.platform.navigateSidebar();
  h.navigations[0].success({}); h.navigations[0].fail({});
  assert.equal((await h.platform.navigateSidebar()).reason, 'busy');
  assert.equal(h.state().fromSidebar, false);
  h.navigations[1].success({}); assert.equal((await second).ok, true);
  assert.equal(h.pendingTimers(), 0);
});

test('sidebar: background navigation and disappeared APIs do not dispatch', async () => {
  const h = harness(); await supported(h);
  h.events.hide(); assert.equal((await h.platform.navigateSidebar()).reason, 'hidden');
  h.events.show({}); delete h.sdk.navigateToScene;
  assert.equal((await h.platform.navigateSidebar()).reason, 'unavailable');
  assert.equal((await h.platform.checkSidebar()).supported, false);
  assert.equal(h.navigations.length, 0);
});
