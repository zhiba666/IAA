'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Game, CONFIG } = require('../src/core');
const { dispatchQAAction } = require('../tools/qa-actions.cjs');

// Exercise the actual generated-page controller with a minimal browser shell.
// Its real Game and dispatcher stay in memory; bundling never writes an artifact.
function page() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'viewport' ? '390x844' : id === 'phase' ? 'start' : '',
      style: {}, listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
      appendChild() {}, setAttribute() {}, setPointerCapture() {},
      getContext() { return {}; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 390, height: 844 }; }
    });
    return elements.get(id);
  }
  const document = { hidden: false, getElementById: element, createElement: () => ({}) };
  const window = { addEventListener() {} };
  let pending, timestamp = 1, hitAction = null;
  class Renderer {
    constructor() { this.zones = []; }
    draw() {}
    emit() {}
    actionAt() { return hitAction; }
  }
  const source = fs.readFileSync(require.resolve('../tools/factory-check.mjs'), 'utf8');
  const controller = source.slice(source.indexOf('function factoryQA(require)'), source.indexOf('\nconst { code, moduleIds }'));
  const run = vm.runInNewContext('(' + controller + ')', {
    document, window, requestAnimationFrame(callback) { pending = callback; }
  });
  run(name => {
    if (name === 'src/core.js') return { Game, CONFIG };
    if (name === 'src/renderer.js') return { Renderer };
    if (name === 'tools/qa-actions.cjs') return { dispatchQAAction };
    throw new Error('Unexpected QA dependency: ' + name);
  });
  element('stage').value = '0'; element('stage').listeners.change();
  const api = {
    snapshot: () => window.factoryQA.snapshot,
    control(id) { element(id).listeners.click(); },
    hidden(value) { document.hidden = value; },
    pointer(type, action) {
      hitAction = action;
      element('game').listeners['pointer' + type]({ clientX: 100, clientY: 100, pointerId: 1 });
    },
    click(action) { api.pointer('down', action); api.pointer('up', action); },
    frames(seconds) {
      for (let i = 0; i < seconds * 10; i++) {
        timestamp += 100; const callback = pending; pending = null; callback(timestamp);
      }
    }
  };
  api.frames(.1);
  return api;
}

test('factory QA observes automatic income only in normal visible home frames, never through QA fast-forward or offline replay', () => {
  const h = page();
  for (let i = 0; i < 100 && h.snapshot().state.coins < CONFIG.upgrades.tap.baseCost; i++) h.click('tap');
  h.click('upgrades'); h.click('upgrade:tap'); h.click('tap');
  for (let i = 0; i < 100 && h.snapshot().state.coins < CONFIG.upgrades.auto.baseCost; i++) h.click('tap');
  h.click('upgrades'); h.click('upgrade:auto');
  assert.equal(h.snapshot().onboarding.goal.phase, 'observe');

  h.control('pause'); h.control('step-30'); h.control('step-120'); h.frames(4);
  assert.equal(h.snapshot().onboarding.goal.phase, 'observe', 'manual QA time must not count as visible practice');
  h.control('offline');
  assert.equal(h.snapshot().onboarding.goal.phase, 'observe');
  h.click('close'); h.control('pause');
  h.click('guidebook'); h.frames(4); h.click('close');
  assert.equal(h.snapshot().onboarding.goal.phase, 'observe');
  h.hidden(true); h.frames(4); h.hidden(false);
  assert.equal(h.snapshot().onboarding.goal.phase, 'observe');
  h.pointer('down', 'tap'); h.frames(4); h.pointer('up', 'tap');
  assert.equal(h.snapshot().onboarding.goal.phase, 'observe');
  h.frames(2);
  assert.equal(h.snapshot().onboarding.goal.phase, 'observe');
  h.frames(1.1);
  assert.notEqual(h.snapshot().onboarding.goal.phase, 'observe', 'stage zero naturally advances after watching actual income');
  assert.equal(h.snapshot().qaAdvancedSeconds, 750);
  assert.equal(h.snapshot().renderChangedState, false);
  assert.deepEqual(Array.from(h.snapshot().errors), []);
});
