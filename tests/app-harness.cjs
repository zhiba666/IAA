'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { GameInterface } = require('../src/interface');
const { legacyGame } = require('./legacy-fixture.cjs');
const START = 1800000000000;
const coreSource = fs.readFileSync(path.join(__dirname, '../src/core.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
// Run the actual application and economy together. Only the environment-facing
// platform, sounds and drawing are replaced, so tests drive real input handlers.
function harness(options = {}) {
  let now = START, frameTime = 1, nextFrame = null, drawnUI = null;
  let pointerHandler, hideHandler, showHandler, resizeHandler, hidden = false, hitAction = null;
  let saveFailure = !!options.saveFailure;
  const keyboard = {}, saves = [], analytics = [], rewardRequests = [], sounds = [], sidebarRequests=[], rendererEvents=[];
  const ctx = { setTransform() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const canvas = { getContext: () => ctx, setAttribute() {} };
  const platform = {
    canvas, isDouyin: false, config: { allowSimulatedAds: true, ...options.config },
    lastStorageError: '',
    load() { this.lastStorageError = options.loadError || ''; return options.save == null ? (options.freshOnboarding ? null : legacyGame({ now: START }).exportSave(START)) : copy(options.save); },
    save(value) {
      this.lastStorageError = saveFailure ? 'storage full' : '';
      if (!saveFailure) saves.push(copy(value));
      return !saveFailure;
    },
    onPointer(fn) { pointerHandler = fn; }, onHide(fn) { hideHandler = fn; },
    onShow(fn) { showHandler = fn; }, onResize(fn) { resizeHandler = fn; },
    getSystemInfo: () => ({ width: 480, height: 920, pixelRatio: 1 }),
    track(event, data) { analytics.push({ event, data: copy(data || {}) }); },
    getAnalytics: () => copy(analytics), vibrate() {},
    reward(kind, requestOptions) {
      return new Promise((resolve, reject) => rewardRequests.push({ kind, options: requestOptions, resolve, reject }));
    },
    interstitial: () => Promise.resolve(false),
    getSidebarState:()=>({supported:!!options.sidebarSupported,checking:false,fromSidebar:false}),
    checkSidebar:()=>Promise.resolve(),
    navigateSidebar() { return new Promise(resolve=>sidebarRequests.push(resolve)); }
  };
  class MockRenderer {
    constructor() { this.interface = new GameInterface(this); }
    actionAt() { return hitAction; }
    emit(event) { rendererEvents.push(copy(event)); }
    draw(view, ui, dt) { drawnUI = copy(ui); drawnUI.animationDt = dt; }
  }
  class MockAudio {
    setEnabled(enabled) { this.enabled = enabled; }
    unlock() {}
    play(name) { sounds.push(name); }
  }
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    document: { getElementById: () => null },
    window: { addEventListener(name, fn) { keyboard[name] = fn; } },
    requestAnimationFrame(fn) {
      assert.equal(nextFrame, null, 'only one animation frame should be scheduled');
      nextFrame = fn;
    }
  });
  const coreModule = { exports: {} };
  vm.runInContext('(function(module, exports, require) {\n' + coreSource + '\n})', context)(coreModule, coreModule.exports,
    name => require(path.resolve(__dirname, '../src', name)));
  function mockedRequire(name) {
    if (name === './core') return coreModule.exports;
    if (name === './platform') return { createPlatform: () => platform };
    if (name === './audio') return { AudioEngine: MockAudio };
    if (name === './renderer') return { Renderer: MockRenderer };
    if (name === './experience') return require('../src/experience');
    if (name === './offline-summary') return require('../src/offline-summary');
    if (name === './next-step') return require('../src/next-step');
    if (name === './onboarding') return require('../src/onboarding');
    throw new Error('Unexpected dependency: ' + name);
  }
  vm.runInContext('(function(require) {\n' + mainSource + '\n})', context)(mockedRequire);
  const h = {
    platform, saves, analytics, rewardRequests, sounds, sidebarRequests, rendererEvents,
    snapshot: () => copy(context.__POPCORN__.snapshot()),
    lastUI: () => copy(drawnUI),
    ui() { h.frame(0); return copy(drawnUI); },
    frame(ms) {
      now += ms; frameTime += ms;
      const fn = nextFrame; nextFrame = null;
      assert.equal(typeof fn, 'function'); fn(frameTime);
    },
    advance(ms) { now += ms; frameTime += ms; },
    hide() { if (!hidden) { hidden = true; hideHandler(); } },
    show() { if (hidden) { hidden = false; showHandler(); } },
    resize() { resizeHandler(platform.getSystemInfo()); },
    pointer(type, action = 'tap', id = 1, x = 100, y = 100) {
      hitAction = action; pointerHandler({ type, id, x, y });
    },
    click(action) {
      hitAction = action;
      pointerHandler({ type: 'down', id: 1, x: 100, y: 100 });
      pointerHandler({ type: 'up', id: 1, x: 100, y: 100 });
      hitAction = null;
    },
    key(code, repeat = false) {
      const event = { code, repeat, prevented: false, preventDefault() { this.prevented = true; } };
      keyboard.keydown(event); return event;
    },
    setSaveFailure(value) { saveFailure = value; }
  };
  h.frame(0);
  if(options.autoStart!==false){h.click('start');h.frame(0);}
  return h;
}

module.exports = { harness, START };
