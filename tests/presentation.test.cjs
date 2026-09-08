'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { Game, CONFIG, formatNumber } = require('../src/core');
const { Renderer, HEALTH_ADVISORY } = require('../src/renderer');

const NOW = 1800000000000;
const audioSource = fs.readFileSync(path.join(__dirname, '../src/audio.js'), 'utf8');

function finiteNumbers(name, values) {
  for (const value of values) assert.ok(typeof value === 'number' && Number.isFinite(value), `${name}: invalid geometry value ${String(value)}`);
}

function stubCanvas() {
  const texts = [];
  let depth = 0, operations = 0;
  const ctx = {
    texts,
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
  const snapshot = new Game({ now: NOW }).exportSave(NOW);
  const machine = options.machine || 0;
  const orderIndex = options.orderIndex == null ? CONFIG.machines[machine].requiredOrders : options.orderIndex;
  Object.assign(snapshot, {
    machine, orderIndex, coins: 10, playedSeconds: CONFIG.rewardUnlockSeconds,
    totalProduced: Math.max(CONFIG.orders[Math.min(orderIndex, CONFIG.orders.length - 1)].target,
      orderIndex > 0 ? CONFIG.orders[orderIndex - 1].target : 0),
    upgrades: options.maxed ? { tap: CONFIG.maxUpgradeLevel, auto: CONFIG.maxUpgradeLevel, value: CONFIG.maxUpgradeLevel } : { tap: 1, auto: 1, value: 1 },
    offline: options.offline ? { id: 'offline:fixture', seconds: 600, production: 240, coins: 300 } : null
  });
  return new Game({ now: NOW, save: snapshot });
}

function draw(game, options = {}, renderer = null) {
  const ctx = renderer ? renderer.c : stubCanvas();
  const r = renderer || new Renderer(ctx);
  r.draw(game.getView(), Object.assign({ tab: 'upgrades', modal: null, isDouyin: false, adBusy: false, saved: true, toast: '' }, options), 0.016);
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
    for (const modal of [null, { type: 'settings' }]) {
      const output = draw(game, Object.assign({}, options, { modal }));
      assert.ok(!output.renderer.zones.some(zone => zone.action === 'sidebar'));
    }
  }
  for (const modal of [null, { type: 'settings' }]) {
    const output = draw(game, { isDouyin: true, sidebar: { supported: true }, modal });
    assert.ok(output.renderer.zones.some(zone => zone.action === 'sidebar'));
  }
  for (const busy of [false, true]) {
    const output = draw(game, { isDouyin: true, sidebar: { supported: true }, sidebarBusy: busy, modal: { type: 'sidebar' } });
    assert.equal(output.renderer.zones.some(zone => zone.action === 'visitSidebar'), !busy);
    assert.ok(output.renderer.zones.some(zone => zone.action === 'close'));
    assert.ok(!output.renderer.zones.some(zone => /reward|claim|watch|simulate/.test(zone.action)));
  }
});

test('renderer: every machine stage and all three tabs draw finite geometry with balanced Canvas state', async t => {
  for (let machine = 0; machine < CONFIG.machines.length; machine++) {
    for (const tab of ['upgrades', 'machines', 'stats']) await t.test(`stage ${machine + 1} / ${tab}`, () => {
      const game = factory({ machine, orderIndex: machine === 5 ? CONFIG.orders.length : undefined });
      const output = draw(game, { tab, isDouyin: machine % 2 === 0 });
      assert.ok(output.text.includes(CONFIG.machines[machine].name));
      assert.ok(output.renderer.zones.some(zone => zone.action === 'tap'));
    });
  }
});

// The no-viewport renderer still serves the copyright illustration tool.
// Keep its sheets covered by smoke tests; detailed quest/brand behavior is tested
// on the live viewport path in responsive-interface.test.cjs.
test('renderer: legacy illustration sheets and empty/completed variants draw without invalid geometry', async t => {
  const ordinary = ['order', 'machine', 'offline', 'settings', 'help', 'privacy', 'blueprint', 'completion','health','sidebar','quests','brand'];
  for (const type of ordinary) await t.test(type, () => {
    const game = factory({ machine: type === 'completion' ? 5 : 1,
      orderIndex: type === 'completion' ? CONFIG.orders.length : undefined, offline: true });
    const output = draw(game, { modal: { type }, toast: '已安全保存进度' });
    assert.ok(output.renderer.zones.some(zone => zone.action === 'close'));
    assert.ok(output.renderer.zones.every(zone => zone.action !== 'tap'), 'modal hit regions must block the factory behind them');
  });
  await t.test('unfinished order', () => { draw(new Game({ now: NOW }), { modal: { type: 'order' } }); });
  await t.test('already-claimed offline reward', () => { draw(factory(), { modal: { type: 'offline' } }); });
  await t.test('all machines built', () => { draw(factory({ machine: 5 }), { modal: { type: 'machine' } }); });
  await t.test('ready to evolve', () => {
    const game = factory({ machine: 0, orderIndex: CONFIG.machines[1].requiredOrders });
    game.state.coins = CONFIG.machines[1].cost;
    const output = draw(game, { modal: { type: 'machine' } });
    assert.ok(output.renderer.zones.some(zone => zone.action === 'evolve'));
  });
});

test('renderer: all four reward quotes show the correct environment actions and no active controls while busy', async t => {
  for (const kind of ['turbo', 'order', 'sponsor', 'offline']) {
    for (const isDouyin of [false, true]) await t.test(`${kind} / ${isDouyin ? 'Douyin' : 'browser'}`, () => {
      const game = factory({ orderIndex: CONFIG.machines[1].requiredOrders, offline: true });
      const quote = game.quoteReward(kind); assert.ok(quote, 'fixture must produce a valid eligible quote');
      const { renderer } = draw(game, { modal: { type: 'reward', quote }, isDouyin });
      const actions = renderer.zones.map(zone => zone.action);
      if (isDouyin) {
        assert.ok(actions.includes('watch')); assert.ok(!actions.includes('simulate:complete'));
      } else {
        for (const outcome of ['complete', 'cancel', 'fail']) assert.ok(actions.includes('simulate:' + outcome));
        assert.ok(!actions.includes('watch'));
      }
      const busy = draw(game, { modal: { type: 'reward', quote }, isDouyin, adBusy: true });
      assert.equal(busy.renderer.zones.length, 0);
    });
  }
});

test('renderer: maxed upgrades display 已满级 and cannot be purchased', () => {
  const output = draw(factory({ maxed: true }));
  assert.equal(output.text.filter(text => text === '已满级').length, 3);
  assert.ok(output.renderer.zones.every(zone => !zone.action.startsWith('upgrade:')));
});

test('renderer: reward confirmation distinguishes extra coins from the full order/offline payout', () => {
  for (const kind of ['order', 'offline']) {
    const game = factory({ offline: true });
    const quote = game.quoteReward(kind); assert.ok(quote);
    const expectedTotal = kind === 'order' ? game.getView().order.reward + quote.amount : game.getView().offline.coins + quote.amount;
    const output = draw(game, { modal: { type: 'reward', quote } });
    assert.ok(output.text.includes(`额外 +${formatNumber(quote.amount)} 金币`));
    assert.ok(output.text.includes(`${kind === 'order' ? '本单' : '本次'}共领取 ${formatNumber(expectedTotal)} 金币`));
  }
});

test('renderer: a fresh factory displays its fractional 0.4 coins/second rather than rounding down to zero', () => {
  const output = draw(new Game({ now: NOW }));
  const incomeText = output.ctx.texts.find(entry => entry.x === 262 && entry.y === 132);
  assert.ok(incomeText); assert.equal(incomeText.text, '+0.4');
});

test('renderer: bursts, taps and evolution share a 180-particle cap and expire after animation', () => {
  const ctx = stubCanvas(), renderer = new Renderer(ctx);
  for (let i = 0; i < 100; i++) {
    renderer.emit({ type: 'burst', amount: 100 });
    renderer.emit({ type: 'evolve' });
    renderer.emit({ type: 'produce', source: 'tap', amount: 1 });
    assert.ok(renderer.particles.length <= 180);
  }
  assert.equal(renderer.particles.length, 180);
  renderer.emit({ type: 'order' });
  draw(factory({ machine: 5 }), {}, renderer);
  for (const particle of renderer.particles) finiteNumbers('particle', [particle.x, particle.y, particle.vx, particle.vy, particle.life, particle.r, particle.a]);
  renderer.update(5);
  assert.equal(renderer.particles.length, 0); assert.equal(renderer.floats.length, 0);
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
  assert.equal(h.creates(), 7);
  assert.equal(h.contexts.find(audio => audio.src === 'audio/upgrade.wav').playCalls, 3);
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
