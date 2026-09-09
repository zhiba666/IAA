'use strict';

// SDK references checked 2026-09-05. No credentials or live ad IDs are bundled.
// https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/drawing/picture/tt-create-canvas
// https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/foundation/system/click-event/tt-on-touch-start
// https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/interface/menu/tt-get-menu-button-layout
// https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/open-ability/ad/incentive-ads
// https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/ads/interstitial-ad/interstitial-ad-notice
// https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/open-ability/Introduction-for-tech
// https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/open-capacity/sidebar-capacity/tt-check-scene
// https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/open-capacity/sidebar-capacity/tt-navigate-to-scene
const SAVE_KEY = 'little_popcorn_factory_pipeline_v2';

function createPlatform() {
  const root = typeof globalThis !== 'undefined' ? globalThis : GameGlobal;
  const sdk = typeof tt !== 'undefined' ? tt : root.tt;
  const isDouyin = !!(sdk && typeof sdk.createCanvas === 'function');
  const config = Object.assign({ appId: '', rewardAdUnitId: '', interstitialAdUnitId: '',
    allowSimulatedAds: false, analyticsEnabled: false, debug: false, developerHoldTap: false }, root.POPCORN_CONFIG || {});
  config.allowSimulatedAds = false;
  config.developerHoldTap = false;
  const doc = typeof document !== 'undefined' ? document : null;
  const win = typeof window !== 'undefined' ? window : root;
  const canvas = isDouyin ? sdk.createCanvas() : createBrowserCanvas(doc);
  const callbacks = { hide: [], show: [], pointer: [], resize: [] };
  const analytics = [];

  let adBusy = false;
  let lastStorageError = '';
  let hidden = false;
  const sidebar = { supported: false, checking: false, fromSidebar: false };
  let sidebarShowSubscribed = false;
  let sidebarShowObserved = false;
  let sidebarCheck = null;
  let sidebarNavigation = null;

  function subscribe(name, callback) {
    if (typeof callback !== 'function') return function () {};
    callbacks[name].push(callback);
    return function () {
      const index = callbacks[name].indexOf(callback);
      if (index >= 0) callbacks[name].splice(index, 1);
    };
  }

  function emit(name, value) {
    callbacks[name].slice().forEach(function (callback) { callback(value); });
  }

  function getSystemInfo() {
    let raw = {};
    if (isDouyin && typeof sdk.getSystemInfoSync === 'function') {
      try { raw = sdk.getSystemInfoSync() || {}; } catch (_) { /* fallback below */ }
    }
    const width = positive(raw.windowWidth || raw.screenWidth || win.innerWidth, 480);
    const height = positive(raw.windowHeight || raw.screenHeight || win.innerHeight, 840);
    const pixelRatio = positive(raw.pixelRatio || win.devicePixelRatio, 1);
    let menuButton = null;
    if (isDouyin && typeof sdk.getMenuButtonLayout === 'function') {
      try {
        const rect = sdk.getMenuButtonLayout();
        // The capsule is reported in screen pixels, independently of safeArea.
        // Early or unsupported native calls can return an empty/invalid layout.
        if (rect && ['left', 'top', 'right', 'bottom', 'width', 'height'].every(key => Number.isFinite(rect[key])) &&
          rect.left >= 0 && rect.top >= 0 && rect.right > rect.left && rect.bottom > rect.top &&
          rect.right <= width && rect.bottom <= height && rect.width > 0 && rect.height > 0) {
          menuButton = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
            width: rect.width, height: rect.height };
        }
      } catch (_) { /* Optional native layout must never prevent startup or resizing. */ }
    }
    return Object.assign({}, raw, {
      width: width, height: height, windowWidth: width, windowHeight: height,
      pixelRatio: pixelRatio, menuButton: menuButton,
      safeArea: raw.safeArea || { left: 0, top: 0, right: width, bottom: height, width: width, height: height }
    });
  }

  function notifyHidden() {
    if (hidden) return;
    hidden = true;
    emit('hide');
  }

  function notifyShown(value) {
    if (isDouyin) {
      // Read every native callback, including the cold-start callback and a
      // repeated show without hide. Never reuse stale launch options on resume.
      sidebarShowObserved = true;
      sidebar.fromSidebar = isSidebarLaunch(value);
    }
    // A returning device may have changed size even without a resize API.
    emit('resize', getSystemInfo());
    if (!hidden) return;
    hidden = false;
    emit('show', value);
  }

  if (isDouyin) {
    // Register synchronously during game.js initialization, before querying any
    // optional capability. Missing/broken sidebar support cannot stop gameplay.
    if (typeof sdk.onShow === 'function') {
      try { sdk.onShow(notifyShown); sidebarShowSubscribed = true; } catch (_) {}
    }
    if (!sidebarShowObserved && typeof sdk.getLaunchOptionsSync === 'function') {
      try {
        const launch = sdk.getLaunchOptionsSync();
        if (!sidebarShowObserved) sidebar.fromSidebar = isSidebarLaunch(launch);
      } catch (_) { /* onShow remains the authoritative warm-start source */ }
    }
    const touchMethods = [['onTouchStart', 'down'], ['onTouchMove', 'move'],
      ['onTouchEnd', 'up'], ['onTouchCancel', 'cancel']];
    touchMethods.forEach(function (pair) {
      if (typeof sdk[pair[0]] !== 'function') return;
      sdk[pair[0]](function (event) {
        const points = event.changedTouches || event.touches || [];
        points.forEach(function (point) {
          emit('pointer', { type: pair[1], x: number(point.screenX, point.clientX),
            y: number(point.screenY, point.clientY), id: point.identifier == null ? 0 : point.identifier });
        });
      });
    });
    if (typeof sdk.onHide === 'function') sdk.onHide(notifyHidden);
    // Feature detection: this event is not present in every mini-game runtime.
    if (typeof sdk.onWindowResize === 'function') sdk.onWindowResize(function () { emit('resize', getSystemInfo()); });
  } else {
    canvas.style.touchAction = 'none';
    const activePointers = new Map();
    function cancelPointer(id) {
      const point = activePointers.get(id);
      if (!point) return;
      activePointers.delete(id);
      emit('pointer', { type: 'cancel', x: point.x, y: point.y, id: id });
    }
    [['pointerdown', 'down'], ['pointermove', 'move'], ['pointerup', 'up'], ['pointercancel', 'cancel']].forEach(function (pair) {
      canvas.addEventListener(pair[0], function (event) {
        if (event.pointerType === 'mouse' && pair[1] === 'down' && event.button !== 0) return;
        event.preventDefault();
        if (pair[1] === 'down' && canvas.setPointerCapture) {
          try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* unsupported pointer capture */ }
        }
        const rect = canvas.getBoundingClientRect();
        const point = { type: pair[1], x: event.clientX - rect.left,
          y: event.clientY - rect.top, id: event.pointerId == null ? 0 : event.pointerId };
        if (pair[1] === 'down' || pair[1] === 'move' && activePointers.has(point.id)) activePointers.set(point.id, point);
        else if (pair[1] === 'up' || pair[1] === 'cancel') activePointers.delete(point.id);
        emit('pointer', point);
      }, { passive: false });
    });
    canvas.addEventListener('lostpointercapture', function (event) {
      cancelPointer(event.pointerId == null ? 0 : event.pointerId);
    });
    // Focus loss ends held input without starting an offline/foreground cycle.
    win.addEventListener('blur', function () { activePointers.forEach(function (_, id) { cancelPointer(id); }); });
    doc.addEventListener('visibilitychange', function () { if (doc.hidden) notifyHidden(); else notifyShown(); });
    win.addEventListener('pagehide', notifyHidden);
    win.addEventListener('pageshow', notifyShown);
    win.addEventListener('resize', function () { emit('resize', getSystemInfo()); });
  }

  function getSidebarState() {
    return Object.assign({}, sidebar);
  }

  function hasSidebarApi() {
    return isDouyin && sidebarShowSubscribed && typeof sdk.checkScene === 'function' &&
      typeof sdk.navigateToScene === 'function';
  }

  function checkSidebar() {
    if (sidebarCheck) return sidebarCheck;
    sidebar.supported = false;
    if (!hasSidebarApi()) return Promise.resolve(getSidebarState());
    sidebar.checking = true;
    let resolveCheck;
    const pending = new Promise(function (resolve) { resolveCheck = resolve; });
    sidebarCheck = pending;
    let settled = false;
    let timer = null;
    function finish(supported) {
      if (settled) return;
      settled = true;
      if (timer != null) clearTimeout(timer);
      sidebar.supported = supported === true;
      sidebar.checking = false;
      sidebarCheck = null;
      resolveCheck(getSidebarState());
    }
    try {
      timer = setTimeout(function () { finish(false); }, 5000);
      const returned = sdk.checkScene({ scene: 'sidebar',
        success: function (result) { finish(!!(result && result.isExist === true)); },
        fail: function () { finish(false); } });
      // The documented API is callback-based; a Promise fulfillment is not
      // evidence of support. Consume unexpected rejections defensively.
      if (returned && typeof returned.then === 'function') Promise.resolve(returned).catch(function () { finish(false); });
    } catch (_) { finish(false); }
    return pending;
  }

  function navigateSidebar() {
    // Only invoke from an explicit user action. Do not defer navigation behind
    // an async capability probe, which can lose the runtime's user gesture.
    if (sidebar.checking) return Promise.resolve({ ok: false, reason: 'checking' });
    if (!sidebar.supported || !hasSidebarApi()) return Promise.resolve({ ok: false, reason: 'unavailable' });
    if (adBusy || sidebarNavigation) return Promise.resolve({ ok: false, reason: 'busy' });
    if (hidden) return Promise.resolve({ ok: false, reason: 'hidden' });
    let resolveNavigation;
    const pending = new Promise(function (resolve) { resolveNavigation = resolve; });
    sidebarNavigation = pending;
    let settled = false;
    let timer = null;
    function finish(ok, reason) {
      if (settled) return;
      settled = true;
      if (timer != null) clearTimeout(timer);
      sidebarNavigation = null;
      // A successful jump only means the sidebar opened, never that the user
      // returned from it. Only native launch/onShow parameters change that flag.
      resolveNavigation({ ok: ok, reason: reason });
    }
    try {
      timer = setTimeout(function () { finish(false, 'timeout'); }, 10000);
      const returned = sdk.navigateToScene({ scene: 'sidebar',
        success: function () { finish(true, 'navigated'); },
        fail: function () { finish(false, 'failed'); } });
      if (returned && typeof returned.then === 'function') Promise.resolve(returned).catch(function () { finish(false, 'failed'); });
    } catch (_) { finish(false, 'failed'); }
    return pending;
  }

  function track(event, data) {
    const cleanEvent = String(event || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
    const cleanData = {};
    Object.keys(data || {}).slice(0, 24).forEach(function (key) {
      const value = data[key];
      if (typeof value === 'number' && Number.isFinite(value)) cleanData[key] = value;
      else if (typeof value === 'string') cleanData[key] = value.slice(0, 120);
      else if (typeof value === 'boolean') cleanData[key] = value ? 1 : 0;
    });
    analytics.push({ event: cleanEvent, data: cleanData, time: Date.now() });
    if (analytics.length > 200) analytics.shift();
    // Production reporting is an explicit deployment choice; debug events stay in memory by default.
    if (isDouyin && config.analyticsEnabled === true && typeof sdk.reportAnalytics === 'function') {
      try { sdk.reportAnalytics(cleanEvent, cleanData); } catch (_) { /* metrics must not interrupt play */ }
    }
  }

  function load() {
    lastStorageError = '';
    try {
      const value = isDouyin ? sdk.getStorageSync(SAVE_KEY) : win.localStorage.getItem(SAVE_KEY);
      if (value == null || value === '') return null;
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid-save');
      return parsed;
    } catch (error) {
      lastStorageError = String(error && error.message || error);
      return null;
    }
  }

  function save(data) {
    lastStorageError = '';
    try {
      const encoded = JSON.stringify(data);
      if (typeof encoded !== 'string') throw new Error('invalid-save');
      if (isDouyin) sdk.setStorageSync(SAVE_KEY, encoded);
      else win.localStorage.setItem(SAVE_KEY, encoded);
      return true;
    } catch (error) {
      lastStorageError = String(error && error.message || error);
      return false;
    }
  }

  // Retained platform interface; this version never creates ads or grants rewards.
  function reward() { return Promise.resolve({ completed: false, reason: 'disabled' }); }
  function interstitial() { return Promise.resolve(false); }

  function vibrate() {
    try {
      if (isDouyin && typeof sdk.vibrateShort === 'function') sdk.vibrateShort({ fail: function () {} });
      else if (win.navigator && typeof win.navigator.vibrate === 'function') win.navigator.vibrate(12);
    } catch (_) { /* haptics are optional */ }
  }

  return {
    canvas: canvas, isDouyin: isDouyin, config: config, load: load, save: save,
    onHide: function (callback) { return subscribe('hide', callback); },
    onShow: function (callback) { return subscribe('show', callback); },
    onPointer: function (callback) { return subscribe('pointer', callback); },
    onResize: function (callback) { return subscribe('resize', callback); },
    reward: reward, interstitial: interstitial, track: track, getSystemInfo: getSystemInfo, vibrate: vibrate,
    getSidebarState: getSidebarState, checkSidebar: checkSidebar, navigateSidebar: navigateSidebar,
    getAnalytics: function () { return analytics.map(function (entry) { return Object.assign({}, entry, { data: Object.assign({}, entry.data) }); }); },
    get lastStorageError() { return lastStorageError; },
    get adBusy() { return adBusy; }
  };
}

function isSidebarLaunch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  // Prefer the official onShow fields when present; do not treat custom query
  // parameters, scene-shaped strings, or contradictory metadata as a return.
  if (value.launch_from != null || value.location != null) {
    return value.launch_from === 'homepage' &&
      (value.location === 'sidebar_card' || value.location === 'homepage_expand');
  }
  // Cold-start fallback for hosts whose getLaunchOptionsSync only provides scene.
  // https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/operation1/user-ops/-retention/sidebar
  return ['021036', '101036', '181036', '261036'].indexOf(value.scene) !== -1;
}

function createBrowserCanvas(doc) {
  if (!doc) throw new Error('A browser document or Douyin tt runtime is required.');
  let canvas = doc.getElementById('game') || doc.querySelector('canvas');
  if (!canvas) {
    canvas = doc.createElement('canvas');
    canvas.id = 'game';
    doc.body.appendChild(canvas);
  }
  return canvas;
}

function validId(value) {
  return typeof value === 'string' && value.trim().length > 0 && !/^(YOUR_|REPLACE|TODO|test|placeholder)/i.test(value);
}

function positive(value, fallback) { return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback; }
function number(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0; }

module.exports = { createPlatform: createPlatform, SAVE_KEY: SAVE_KEY };
