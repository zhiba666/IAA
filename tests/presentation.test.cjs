'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { Game } = require('../src/core');
const { Renderer } = require('../src/renderer');

const NOW = 1800000000000;
const HEALTH_ADVISORY = ['抵制不良游戏，拒绝盗版游戏。','注意自我保护，谨防受骗上当。','适度游戏益脑，沉迷游戏伤身。','合理安排时间，享受健康生活。'];
const audioSource = fs.readFileSync(path.join(__dirname, '../src/audio.js'), 'utf8');

function finiteNumbers(name, values) {
  for (const value of values) assert.ok(typeof value === 'number' && Number.isFinite(value), `${name}: invalid geometry value ${String(value)}`);
}

function stubCanvas() {
  const texts = [];
  let depth = 0, operations = 0;
  const ctx = {
    texts, globalAlpha: 1,
    save() { depth++; },
    restore() { assert.ok(depth > 0, 'restore() must have a matching save()'); depth--; },
    measureText(text) { return { width: [...String(text)].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 13 : 7), 0) }; },
    fillText(text, ...geometry) { finiteNumbers('fillText', geometry); texts.push({ text, x: geometry[0], y: geometry[1] }); operations++; },
    beginPath() {}, closePath() {}, fill() {}, stroke() {}, clip() {},
    verify() { assert.equal(depth, 0, 'drawing must leave the Canvas transform/clip stack balanced'); assert.ok(operations > 0); },
    resetText() { texts.length = 0; }
  };
  for (const name of ['moveTo', 'lineTo', 'arcTo', 'translate', 'scale', 'rotate', 'fillRect', 'clearRect', 'setTransform']) {
    ctx[name] = (...args) => { finiteNumbers(name, args); operations++; };
  }
  ctx.arc = (x, y, radius, start, end, counterclockwise) => {
    finiteNumbers('arc', [x, y, radius, start, end]); assert.ok(radius >= 0);
    if (counterclockwise !== undefined) assert.equal(typeof counterclockwise, 'boolean');
    operations++;
  };
  return new Proxy(ctx, {
    set(target, key, value) {
      if (['globalAlpha', 'lineWidth'].includes(key)) {
        finiteNumbers(String(key), [value]);
        if (key === 'globalAlpha') assert.ok(value >= 0 && value <= 1);
        if (key === 'lineWidth') assert.ok(value > 0);
      }
      target[key] = value; return true;
    }
  });
}

function factory(options = {}) {
  const game = new Game({ now: NOW });
  if (options.offline) game.state.offline = { id: 'offline:fixture', seconds: 600, production: 240, coins: 300 };
  return game;
}

function draw(game, options = {}, renderer = null) {
  const ctx = renderer ? renderer.c : stubCanvas();
  const r = renderer || new Renderer(ctx);
  r.draw(game.getView(), Object.assign({ viewport: { width: 480, height: 920 }, modal: null, isDouyin: false, adBusy: false, toast: '' }, options), 0.016);
  ctx.verify();
  for (const zone of r.zones) {
    finiteNumbers('hit region', [zone.x, zone.y, zone.w, zone.h]);
    assert.ok(zone.w > 0 && zone.h > 0, 'interactive regions must have positive dimensions');
  }
  return { renderer: r, ctx, text: ctx.texts.map(entry => entry.text) };
}

test('renderer: startup shows the complete health advisory and only permits starting', () => {
  const output = draw(factory({ offline: true }), { startup: true, modal: { type: 'offline' } });
  assert.ok(output.text.includes('健康游戏忠告'));
  for (const line of HEALTH_ADVISORY) assert.ok(output.text.includes(line));
  assert.deepEqual(output.renderer.zones.map(zone => zone.action), ['start']);
  const health = draw(factory(), { modal: { type: 'health' } });
  for (const line of HEALTH_ADVISORY) assert.ok(health.text.includes(line));
});

test('renderer: sidebar entry requires native support and navigation disables while pending', () => {
  const game = factory();
  for (const options of [{}, { isDouyin: true }, { isDouyin: true, sidebar: { supported: false } }]) {
    const output = draw(game, { ...options, modal: { type: 'settings' } });
    assert.ok(!output.renderer.zones.some(zone => zone.action === 'sidebar'));
  }
  const available = draw(game, { isDouyin: true, sidebar: { supported: true }, modal: { type: 'settings' } });
  assert.ok(available.renderer.zones.some(zone => zone.action === 'sidebar'));
  for (const busy of [false, true]) {
    const output = draw(game, { isDouyin: true, sidebar: { supported: true }, sidebarBusy: busy, modal: { type: 'sidebar' } });
    assert.equal(output.renderer.zones.some(zone => zone.action === 'visitSidebar'), !busy);
    assert.ok(output.renderer.zones.some(zone => zone.action === 'close'));
    assert.ok(!output.renderer.zones.some(zone => /reward|claim|watch|simulate/.test(zone.action)));
  }
});

test('renderer: unlocking automatic upgrades reveals the fractional starter income without rounding it down', () => {
  const game = new Game({ now: NOW }); game.state.upgrades.tap = 1;
  const output = draw(game);
  assert.ok(output.text.includes('自动 +0.4 /秒'));
});

test('renderer: production receipts distinguish settled cash from reserved contract stock and stay bounded',()=>{
  const r=new Renderer(stubCanvas());
  r.emit({type:'produce',source:'tap',amount:5,coins:2,heldProduction:3});
  assert.deepEqual(r.receipts.map(({target,amount})=>({target,amount})),[{target:'wallet',amount:2},{target:'order',amount:3}]);
  r.emit({type:'burst',amount:5,coins:2,heldProduction:3});
  assert.equal(r.receipts.length,2,'the burst celebration cannot duplicate a production settlement');
  r.update(1);
  r.emit({type:'produce',source:'tap',amount:5,coins:0,heldProduction:5});
  assert.deepEqual(r.receipts.map(item=>item.target),['order'],'reserved goods cannot pretend to be spendable coins');
  for(let i=0;i<200;i++){r.emit({type:'produce',source:'auto',amount:1,coins:.4,heldProduction:.6});r.update(.01);assert.ok(r.receipts.length<=10);}
  draw(factory(),{},r);r.update(2);assert.equal(r.receipts.length,0);
});

function nativeAudio(options = {}) {
  let now = 1000;
  const contexts = [];
  let creates = 0;
  const sdk = {
    createInnerAudioContext() {
      creates++;
      if (options.createThrow) throw new Error('create audio failed');
      const audio = {
        stopCalls: 0, playCalls: 0, errorListener: null,
        stop() { this.stopCalls++; if (options.stopThrow) throw new Error('stop failed'); },
        play() { this.playCalls++; if (options.playThrow) throw new Error('play failed'); },
        onError(fn) { if (options.onErrorThrow) throw new Error('register failed'); this.errorListener = fn; }
      };
      if (options.srcThrow) Object.defineProperty(audio, 'src', { set() { throw new Error('invalid src'); } });
      contexts.push(audio); return audio;
    }
  };
  const module = { exports: {} };
  const context = vm.createContext({ module, tt: sdk, Date: class extends Date { static now() { return now; } } });
  vm.runInContext(audioSource, context, { filename: 'src/audio.js' });
  return { engine: new module.exports.AudioEngine(), contexts, creates: () => creates, advance(ms) { now += ms; } };
}

test('native audio: all effects use package-local WAVs and repeated aliases reuse their contexts', () => {
  const h = nativeAudio();
  for (const name of ['pop', 'click', 'burst', 'upgrade', 'order', 'complete', 'error']) h.engine.play(name);
  assert.equal(h.creates(), 7);
  assert.deepEqual(h.contexts.map(audio => audio.src).sort(), ['burst', 'click', 'complete', 'error', 'order', 'pop', 'upgrade'].map(key => `audio/${key}.wav`));
  for (const audio of h.contexts) {
    assert.equal(audio.loop, false); assert.equal(audio.volume, 0.45); assert.equal(audio.obeyMuteSwitch, true);
    assert.equal(audio.playCalls, 1); assert.equal(typeof audio.errorListener, 'function');
    assert.doesNotThrow(() => audio.errorListener({ errCode: 1001 }));
  }
  h.engine.play('machine'); h.engine.play('upgrade'); h.engine.play('reward'); h.engine.play('offline');
  assert.equal(h.creates(), 8);
  assert.equal(h.contexts.find(audio => audio.src === 'audio/machine.wav').playCalls, 1);
  assert.equal(h.contexts.find(audio => audio.src === 'audio/upgrade.wav').playCalls, 2);
  assert.equal(h.contexts.find(audio => audio.src === 'audio/order.wav').playCalls, 3);
});

test('native audio: muting stops existing sounds and prevents new playback until enabled', () => {
  const h = nativeAudio(); h.engine.play('click'); h.engine.play('order');
  const stopCounts = h.contexts.map(audio => audio.stopCalls);
  h.engine.setEnabled(false);
  for (let i = 0; i < h.contexts.length; i++) assert.equal(h.contexts[i].stopCalls, stopCounts[i] + 1);
  h.engine.play('complete'); h.engine.play('click');
  assert.equal(h.creates(), 2); assert.equal(h.contexts[0].playCalls, 1);
  h.engine.setEnabled(true); h.engine.play('click');
  assert.equal(h.creates(), 2); assert.equal(h.contexts[0].playCalls, 2);
});

test('native audio: production pops are throttled for 90 ms while interface sounds remain responsive', () => {
  const h = nativeAudio(); h.engine.play('pop');
  const pop = h.contexts[0];
  h.advance(89); h.engine.play('tap'); assert.equal(pop.playCalls, 1);
  h.engine.play('click'); assert.equal(h.contexts[1].playCalls, 1);
  h.advance(1); h.engine.play('tap'); assert.equal(pop.playCalls, 2);
  assert.equal(h.creates(), 2);
});

test('native audio: SDK creation, property, registration, stop and play errors cannot interrupt gameplay', async t => {
  for (const failure of ['createThrow', 'srcThrow', 'onErrorThrow', 'stopThrow', 'playThrow']) await t.test(failure, () => {
    const h = nativeAudio({ [failure]: true });
    assert.doesNotThrow(() => h.engine.unlock());
    assert.doesNotThrow(() => h.engine.play('order'));
    assert.doesNotThrow(() => h.engine.setEnabled(false));
    assert.doesNotThrow(() => { h.engine.setEnabled(true); h.engine.play('click'); });
  });
});

test('audio: an environment without native audio or Web Audio degrades silently', () => {
  const module = { exports: {} };
  const context = vm.createContext({ module }); vm.runInContext(audioSource, context);
  const engine = new module.exports.AudioEngine();
  assert.doesNotThrow(() => { engine.unlock(); engine.play('pop'); engine.play('burst'); engine.setEnabled(false); });
});
