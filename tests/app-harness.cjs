'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const START = 1800000000000;
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

// Execute the real entry and real simulation; replace only host APIs and paint.
function harness(options = {}) {
  let now = START, frameTime = 0, nextFrame = null, drawnUI = null, drawnView = null;
  let pointerHandler, hideHandler, showHandler, resizeHandler, hitAction = null;
  let saveFailure = !!options.saveFailure;
  const events = {}, saves = [], analytics = [], sounds = [], rendererEvents = [];
  let legacyCalls = 0;
  const ctx = new Proxy({}, { get(target, key) { if (!(key in target)) target[key] = () => {}; return target[key]; } });
  const canvas = { getContext: () => ctx, setAttribute() {}, style: {} };
  const info = { width: 480, height: 920, windowWidth: 480, windowHeight: 920, pixelRatio: 1,
    safeArea: { left: 0, top: 0, right: 480, bottom: 920, width: 480, height: 920 }, ...options.info };
  const platform = {
    canvas, isDouyin: false, config: { allowSimulatedAds: false, developerHoldTap: false, ...options.config },
    lastStorageError: '',
    load() { this.lastStorageError = options.loadError || ''; return options.save == null ? null : copy(options.save); },
    save(value) { this.lastStorageError = saveFailure ? 'storage full' : ''; if (!saveFailure) saves.push(copy(value)); return !saveFailure; },
    onPointer(fn) { pointerHandler = fn; }, onHide(fn) { hideHandler = fn; },
    onShow(fn) { showHandler = fn; }, onResize(fn) { resizeHandler = fn; },
    getSystemInfo: () => info, track(event, data) { analytics.push({ event, data: copy(data || {}) }); },
    getAnalytics: () => copy(analytics), vibrate() {},
    reward() { legacyCalls++; return Promise.resolve({ completed: false, reason: 'disabled' }); },
    interstitial() { legacyCalls++; return Promise.resolve(false); }
  };
  class MockRenderer {
    constructor() { this.zones = []; }
    actionAt() { return hitAction; }
    emit(event) { rendererEvents.push(copy(event)); }
    draw(view, ui, dt) { drawnUI = copy(ui); drawnView = copy(view); this.lastView = view; }
  }
  class MockAudio {
    setEnabled(enabled) { this.enabled = enabled; }
    unlock() {}
    play(name) { if (this.enabled !== false) sounds.push(name); }
  }
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    document: { getElementById: () => null },
    window: { addEventListener(name, fn) { events[name] = fn; } },
    requestAnimationFrame(fn) { assert.equal(nextFrame, null, 'only one animation frame scheduled'); nextFrame = fn; }
  });
  const coreModule = { exports: {} };
  const coreSource = fs.readFileSync(path.resolve(__dirname, '../src/core.js'), 'utf8');
  vm.runInContext('(function(module,exports,require){\n' + coreSource + '\n})', context)(coreModule, coreModule.exports, name => require(path.resolve(__dirname, '../src', name)));
  const mainSource = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
  const mockedRequire = name => {
    if (name === './core') return coreModule.exports;
    if (name === './platform') return { createPlatform: () => platform };
    if (name === './renderer') return { Renderer: MockRenderer };
    if (name === './audio') return { AudioEngine: MockAudio };
    return require(path.resolve(__dirname, '../src', name));
  };
  vm.runInContext('(function(require) {\n' + mainSource + '\n})', context)(mockedRequire);
  const h = {
    context, platform, saves, analytics, sounds, rendererEvents, info,
    snapshot: () => copy(context.__POPCORN__.snapshot()), legacyCalls: () => legacyCalls,
    lastUI: () => copy(drawnUI), lastView: () => copy(drawnView),
    ui() { h.frame(0); return copy(drawnUI); },
    frame(ms = 16) { now += ms; frameTime += ms; const fn = nextFrame; nextFrame = null; assert.equal(typeof fn, 'function'); fn(frameTime); },
    run(seconds, step = 100) { let left = seconds * 1000; while (left > 0) { const ms = Math.min(left, step); h.frame(ms); left -= ms; } },
    advance(ms) { now += ms; frameTime += ms; },
    hide() { hideHandler(); }, show() { showHandler({}); }, resize() { resizeHandler(info); },
    pointer(type, action = null, id = 1, x = 100, y = 100) { hitAction = action; pointerHandler({ type, id, x, y }); },
    click(action) { hitAction = action; pointerHandler({ type: 'down', id: 1, x: 100, y: 100 }); pointerHandler({ type: 'up', id: 1, x: 100, y: 100 }); hitAction = null; },
    key(code, repeat = false) { if (events.keydown) events.keydown({ code, repeat, preventDefault() {} }); },
    setSaveFailure(value) { saveFailure = value; }
  };
  h.frame(0);
  return h;
}
module.exports = { harness, START, copy };
