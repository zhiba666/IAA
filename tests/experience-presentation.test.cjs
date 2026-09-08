'use strict';
const { legacyGame } = require('./legacy-fixture.cjs');

const assert = require('node:assert/strict');
const test = require('node:test');
const { Game, CONFIG, formatNumber } = require('../src/core');
const { Renderer } = require('../src/renderer');

const NOW = 1800000000000;
const SURFACES = [
  ['turbo', { type: 'turbo' }], ['order', { type: 'order' }],
  ['sponsor', { type: 'machine' }], ['offline', { type: 'offline' }]
];

function canvas() {
  let depth = 0;
  const texts = [];
  const finite = (name, values) => values.forEach(value =>
    assert.ok(typeof value === 'number' && Number.isFinite(value), `${name}: invalid Canvas geometry`));
  const ctx = {
    font: '14px sans-serif', textAlign: 'left', globalAlpha: 1, texts, overlayTextIndex: 0,
    save() { depth++; },
    restore() { assert.ok(depth > 0, 'Canvas restore requires a matching save'); depth--; },
    measureText(value) {
      const size = Number((this.font.match(/([\d.]+)px/) || [0, 14])[1]);
      return { width: [...String(value)].reduce((sum, char) => sum + size * (char.charCodeAt(0) > 127 ? 1 : .55), 0) };
    },
    fillText(value, ...geometry) {
      finite('fillText', geometry);
      texts.push({ text: String(value), x: geometry[0], y: geometry[1], width: this.measureText(value).width });
    },
    beginPath() {}, closePath() {}, fill() {}, stroke() {}, clip() {},
    verify() { assert.equal(depth, 0, 'rendering must leave the Canvas state balanced'); }
  };
  for (const method of ['moveTo', 'lineTo', 'arcTo', 'translate', 'scale', 'rotate', 'fillRect', 'clearRect', 'setTransform'])
    ctx[method] = (...args) => finite(method, args);
  ctx.fillRect = (...args) => {
    finite('fillRect', args);
    if (args[0] === 0 && args[1] === 0 && args[2] === 480 && args[3] === 920 && /^rgba/.test(ctx.fillStyle))
      ctx.overlayTextIndex = texts.length;
  };
  ctx.arc = (x, y, radius, start, end, anticlockwise) => {
    finite('arc', [x, y, radius, start, end]); assert.ok(radius >= 0);
    if (anticlockwise !== undefined) assert.equal(typeof anticlockwise, 'boolean');
  };
  return new Proxy(ctx, {
    set(target, property, value) {
      if (property === 'globalAlpha') assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
      if (property === 'lineWidth') assert.ok(Number.isFinite(value) && value > 0);
      target[property] = value; return true;
    }
  });
}

function factory(overrides = {}) {
  const game = legacyGame({ now: NOW });
  Object.assign(game.state, {
    coins: 100, playedSeconds: CONFIG.rewardUnlockSeconds,
    taps: 5, bursts: 1, upgrades: { tap: 1, auto: 1, value: 1 },
    orderIndex: CONFIG.machines[1].requiredOrders,
    totalProduced: CONFIG.orders[CONFIG.machines[1].requiredOrders].target,
    offline: { id: 'offline:experience', seconds: 600, production: 240, coins: 300 }
  }, overrides);
  return game;
}

function draw(game, ui = {}, renderer = new Renderer(canvas()), dt = 0) {
  renderer.c.texts.length = 0; renderer.c.overlayTextIndex = 0;
  const view = game instanceof Game ? game.getView() : game;
  renderer.draw(view, { viewport: { width: 480, height: 920 }, modal: null, isDouyin: false, adBusy: false, toast: '', ...ui }, dt);
  renderer.c.verify();
  for (const zone of renderer.zones) {
    for (const value of [zone.x, zone.y, zone.w, zone.h]) assert.ok(Number.isFinite(value));
    assert.ok(zone.w > 0 && zone.h > 0);
    assert.ok(zone.x >= 0 && zone.y >= 0 && zone.x + zone.w <= 480 && zone.y + zone.h <= 920,
      `${zone.action}: interactive region must remain within the game canvas`);
  }
  const entries = renderer.c.texts.slice(renderer.c.overlayTextIndex);
  const text = entries.map(entry => entry.text).join('\n');
  assert.doesNotMatch(text, /undefined|NaN|Infinity/, 'player-facing copy cannot contain invalid view values');
  return { renderer, entries, text, compact: text.replace(/\s/g, ''), actions: renderer.zones.map(zone => zone.action) };
}

const shown = number => number > 0 && number < 10 ? Number(number.toFixed(2)).toString() : formatNumber(number);

function hasAction(output, action) { return output.actions.includes(action); }

function checkRewardSurfaces(game, eligible, seconds) {
  for (const [kind, modal] of SURFACES) {
    const view = game.getView();
    assert.equal(view.rewards[kind].available, eligible, `${kind}: fixture eligibility`);
    const output = draw(game, { modal });
    assert.equal(hasAction(output, 'ad:' + kind), eligible, `${kind}: hit region must match reward eligibility`);
    if (seconds !== undefined) assert.match(output.text, new RegExp(`${seconds}\\s*(?:秒|s)`), `${kind}: remaining wait must be visible`);
  }
}

test('experience: every reward entry explains the remaining intro wait and cannot be activated early', () => {
  const game = factory({ playedSeconds: CONFIG.rewardUnlockSeconds - 16.5 });
  checkRewardSurfaces(game, false, 17);
  game.state.playedSeconds = CONFIG.rewardUnlockSeconds;
  checkRewardSurfaces(game, true);
});

test('experience: reward entries have no cooldown while active playback still disables repeat actions', () => {
  const game = factory({ playedSeconds: 240, lastRewardAt: 240 });
  checkRewardSurfaces(game, true);
  assert.ok(hasAction(draw(game, { modal: { type: 'order' } }), 'claimOrder'));
  assert.ok(hasAction(draw(game, { modal: { type: 'offline' } }), 'claimOffline'));
  for (const [, modal] of SURFACES) assert.doesNotMatch(draw(game, { modal }).text, /冷却/);
  const quote = game.quoteReward('turbo');
  assert.equal(game.quoteReward('turbo').id, quote.id, 'repeat requests reuse the one pending reward');
  for (const isDouyin of [false, true]) {
    const busy = draw(game, { modal: { type: 'reward', quote }, isDouyin, adBusy: true });
    assert.deepEqual(busy.actions, [], 'active playback cannot be submitted twice');
  }
  assert.equal(game.applyReward(quote.id).ok, true);
  checkRewardSurfaces(game, true);
  const next = game.quoteReward('turbo');
  assert.ok(next && next.id !== quote.id, 'a completed reward permits the next request immediately');
});

test('experience: ordinary order settlement appears first and only a completed order can be claimed', () => {
  const game = factory({ orderIndex: 0, totalProduced: CONFIG.orders[0].target });
  const output = draw(game, { modal: { type: 'order' } });
  const ordinary = output.renderer.zones.find(zone => zone.action === 'claimOrder');
  const optional = output.renderer.zones.find(zone => zone.action === 'ad:order');
  assert.ok(ordinary && optional);
  assert.ok(ordinary.y + ordinary.h <= optional.y, 'ordinary settlement must precede the optional ad without overlap');
  assert.equal(output.renderer.actionAt(ordinary.x + ordinary.w / 2, ordinary.y + ordinary.h / 2), 'claimOrder');
  game.state.playedSeconds = 0;
  const firstOrder = draw(game, { modal: { type: 'order' } });
  assert.ok(hasAction(firstOrder, 'claimOrder')); assert.ok(!hasAction(firstOrder, 'ad:order'));
  assert.equal(game.claimOrder().ok, true);
  const unfinished = draw(game, { modal: { type: 'order' } });
  assert.ok(!hasAction(unfinished, 'claimOrder')); assert.ok(!hasAction(unfinished, 'ad:order'));
});

test('experience: upgrade rows show before/after values and units while preserving purchase eligibility', () => {
  const game = factory({ upgrades: { tap: 0, auto: 0, value: 0 }, coins: 0 });
  const view = game.getView(), output = draw(game, { modal: { type: 'upgrades' } });
  for (const upgrade of view.upgrades) {
    const preview = upgrade.preview; assert.ok(preview && preview.after > preview.before);
    assert.ok(output.entries.some(entry => entry.text.includes(shown(preview.before)) && entry.text.includes(shown(preview.after)) && entry.text.includes(preview.unit)),
      `${upgrade.key}: an upgrade needs both projected values and its unit together`);
    assert.ok(!hasAction(output, 'upgrade:' + upgrade.key));
  }
  game.state.coins = Math.max(...view.upgrades.map(upgrade => upgrade.cost));
  for (const upgrade of view.upgrades) assert.ok(hasAction(draw(game, { modal: { type: 'upgrades' } }), 'upgrade:' + upgrade.key));
  game.state.upgrades = { tap: CONFIG.maxUpgradeLevel, auto: CONFIG.maxUpgradeLevel, value: CONFIG.maxUpgradeLevel };
  const maxed = draw(game, { modal: { type: 'upgrades' } });
  assert.equal(maxed.entries.filter(entry => entry.text === '已满级').length, 3);
  assert.ok(!maxed.actions.some(action => action && action.startsWith('upgrade:')));
});

test('experience: machine details show two production comparisons and the remaining requirements before evolution', () => {
  const next = CONFIG.machines[1];
  const game = factory({ coins: next.cost - 123, orderIndex: next.requiredOrders - 1 });
  const view = game.getView(); assert.ok(view.machinePreview);
  const output = draw(game, { modal: { type: 'machine' } });
  const preview = view.machinePreview;
  const comparisons = [[preview.tapBefore, preview.tapAfter], [preview.incomeBefore, preview.incomeAfter]];
  const rows = comparisons.map(([before, after]) => {
    assert.ok(after > before);
    return output.entries.find(entry => entry.text.includes(shown(before)) && entry.text.includes(shown(after)) && /[→⇒]/.test(entry.text));
  });
  assert.ok(rows.every(Boolean), 'show both click output and automatic income comparisons');
  assert.notEqual(rows[0].y, rows[1].y, 'the two gains must have their own readable rows');
  assert.match(output.text, /123/); assert.ok(!hasAction(output, 'evolve'));
  game.state.orderIndex = next.requiredOrders; game.state.coins = next.cost;
  assert.ok(hasAction(draw(game, { modal: { type: 'machine' } }), 'evolve'));
});

test('experience: real simulation bursts carry their actual payout through the renderer', () => {
  for (const trigger of ['tap', 'tick']) {
    const game = factory({ energy: CONFIG.energyMax - 1 });
    const renderer = new Renderer(canvas());
    draw(game, {}, renderer);
    game.drainEvents();
    const coinsBefore = game.state.coins;
    if (trigger === 'tap') game.tap(); else game.tick(1);
    const events = game.drainEvents();
    const production = events.find(event => event.type === 'produce' && event.source === 'burst');
    assert.ok(production && production.amount > 0 && production.coins > 0, `${trigger}: gameplay must produce a real free burst`);
    const ordinaryIncome = events.filter(event => event.type === 'produce' && event.source !== 'burst' || event.type === 'quest').reduce((sum, event) => sum + event.coins, 0);
    const burstIncome = game.state.coins - coinsBefore - ordinaryIncome;
    assert.ok(Math.abs(burstIncome - production.coins) < 1e-9, `${trigger}: burst payout must reconcile with the actual balance change`);
    for (const event of events) renderer.emit(event);
    const output = draw(game, {}, renderer);
    assert.ok(output.entries.some(entry => entry.text.includes(`+${shown(production.amount)} 份`)), `${trigger}: display the actual burst production`);
    assert.ok(output.entries.some(entry => entry.text.includes(`+${shown(burstIncome)} 金币`)), `${trigger}: display the actual nonzero burst payout`);
  }
});

test('experience: rapid real taps combine their own production and restart after the merge window expires', () => {
  const game = factory({ energy: CONFIG.energyMax - 1 });
  const renderer = new Renderer(canvas());
  draw(game, {}, renderer);
  let tapAmount = 0, burstAmount = 0;
  const tap = () => {
    const result = game.tap(); assert.equal(result.ok, true);
    for (const event of game.drainEvents()) {
      if (event.type === 'produce' && event.source === 'burst') burstAmount += event.amount;
      renderer.emit(event);
    }
    assert.equal(renderer.scene.tapPulse, 1, 'every click must retain its immediate machine pulse');
    return result.amount;
  };
  for (let i = 0; i < 16; i++) {
    renderer.update(.05);
    tapAmount += tap();
  }
  assert.ok(burstAmount > 0, 'the real click sequence must include a separate free burst');
  let floats = renderer.floats.filter(float => float.kind === 'tap');
  assert.equal(floats.length, 1, 'rapid clicking should have one readable cumulative float');
  assert.ok(Math.abs(floats[0].amount - tapAmount) < 1e-9, 'only tap production belongs in the cumulative amount');
  assert.notEqual(floats[0].amount, tapAmount + burstAmount);
  assert.ok(floats[0].text.includes(`+${shown(tapAmount)} 份`));
  assert.match(floats[0].text, /连点/);
  const output = draw(game, {}, renderer);
  assert.ok(!output.entries.some(entry => entry.text === floats[0].text), 'the burst settlement takes priority over tap floats');

  renderer.update(.26);
  const nextAmount = tap();
  floats = renderer.floats.filter(float => float.kind === 'tap');
  assert.equal(floats.length, 2, 'a pause beyond the merge window starts a new float while the previous one fades');
  assert.equal(floats[1].amount, nextAmount);
  assert.doesNotMatch(floats[1].text, /连点/, 'a new sequence cannot retain the old cumulative label');

  renderer.update(3);
  assert.equal(renderer.floats.length, 0, 'the prior sequence must expire completely');
  const restartedAmount = tap();
  floats = renderer.floats.filter(float => float.kind === 'tap');
  assert.equal(floats.length, 1);
  assert.equal(floats[0].amount, restartedAmount, 'a new sequence must restart from the current click output');
  assert.ok(floats[0].text.includes(`+${shown(restartedAmount)} 份`));
  const restarted = draw(game, {}, renderer);
  assert.ok(restarted.entries.some(entry => entry.text === floats[0].text), 'the new tap float becomes visible after the burst notice expires');
});
