'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Game, CONFIG } = require('../src/core');
const { Renderer } = require('../src/renderer');
const { selectCurrentTarget, createExperienceTracker } = require('../src/experience');
const { selectNextStep } = require('../src/next-step');
const { selectOfflineSummary } = require('../src/offline-summary');

const NOW = 1800000000000;
const VIEWPORTS = [[320, 524], [320, 568], [390, 700], [390, 844]];
const copy = value => JSON.parse(JSON.stringify(value));
function factory(overrides = {}) {
  const game = new Game({ now: NOW });
  Object.assign(game.state, { machine: 3, orderIndex: 10, totalProduced: CONFIG.orders[9].target,
    coins: 1e9, totalCoins: 1e9, playedSeconds: 300, taps: 10, bursts: 2,
    upgrades: { tap: 16, auto: 16, value: 16 }, learning: { heatRecoveryUses: 10, heatRecoveryDismissed: true }, ...overrides });
  for (let i = 0; i < 4; i++) {
    const ready = game.getView().quests.chapters.flatMap(chapter => chapter.quests).filter(quest => quest.ready);
    game.state.claimedQuests.push(...ready.map(quest => quest.id));
  }
  return game;
}
function context2d(records = []) {
  const c = { font: '14px sans-serif', textAlign: 'left',
    measureText(value) {
      const size = Number(this.font.match(/([\d.]+)px/)[1]);
      return { width: [...String(value)].reduce((sum, ch) => sum + size * (ch.charCodeAt(0) > 127 ? 1 : .55), 0) };
    },
    fillText(value, x, y) {
      const h = Number(this.font.match(/([\d.]+)px/)[1]), w = this.measureText(value).width;
      records.push({ text: String(value), x: x - (this.textAlign === 'center' ? w / 2 : this.textAlign === 'right' ? w : 0), y: y - h / 2, w, h });
    },
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} })
  };
  return new Proxy(c, { get(target, key) { return key in target ? target[key] : () => {}; } });
}
const overlaps = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 3
  && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 2;
function sheet(game, type, width, height, modal = {}) {
  const records = [], renderer = new Renderer(context2d(records)), ui = { modal: { type, ...modal }, toast: '', adBusy: false, isDouyin: false };
  const button = renderer.interface.button;
  renderer.interface.button = function (...args) {
    const start = records.length;
    button.apply(this, args);
    for (const entry of records.slice(start)) entry.owner = args[4];
  };
  Object.assign(renderer.interface, { w: width, h: height, cw: width - 24, x: 12 });
  const before = copy(game.exportSave(NOW));
  renderer.interface.sheet(game.getView(), ui);
  assert.deepEqual(game.exportSave(NOW), before, 'rendering cannot alter research or factory state');
  for (const zone of renderer.zones) {
    assert.ok(zone.h >= 44, zone.action + ' needs a 44px touch target');
    assert.ok(zone.x >= 0 && zone.y >= 0 && zone.x + zone.w <= width && zone.y + zone.h <= height, 'offscreen control ' + zone.action);
    assert.equal(renderer.actionAt(zone.x + zone.w / 2, zone.y + zone.h / 2), zone.action, 'intercepted control ' + zone.action);
  }
  for (let i = 0; i < renderer.zones.length; i++) for (let j = i + 1; j < renderer.zones.length; j++) {
    assert.ok(!overlaps(renderer.zones[i], renderer.zones[j]), 'controls overlap at ' + width + 'x' + height);
  }
  for (const entry of records) {
    assert.doesNotMatch(entry.text, /undefined|NaN|Infinity/);
    assert.ok(entry.x >= -.5 && entry.y >= 0 && entry.x + entry.w <= width + .5 && entry.y + entry.h <= height, 'offscreen text ' + entry.text);
    for (const zone of renderer.zones) if (type !== 'upgrades' && entry.owner !== zone.action) {
      assert.ok(!overlaps(entry, zone), 'text covered by ' + zone.action + ': ' + entry.text + ' at ' + width + 'x' + height);
    }
  }
  for (let i = 0; i < records.length; i++) for (let j = i + 1; j < records.length; j++) {
    assert.ok(!overlaps(records[i], records[j]), 'text overlaps: ' + records[i].text + ' / ' + records[j].text);
  }
  return { renderer, ui, text: records.map(entry => entry.text).join('\n'), actions: renderer.zones.map(zone => zone.action) };
}

test('research sheets expose truthful per-level gains, both exact quotes and usable controls at every target viewport', () => {
  for (const [width, height] of VIEWPORTS) for (const level of [0, 4, CONFIG.research.maxLevel - 1]) {
    const game = factory({ research: { levels: { yield: level, value: level }, serial: 0, active: null } });
    const output = sheet(game, 'research', width, height);
    for (const option of game.getView().research.options) {
      assert.deepEqual(output.ui.modal.researchQuotes[option.key], option);
      assert.ok(output.actions.includes('researchStart:' + option.key + ':' + option.id));
    }
    assert.match(output.text, new RegExp('下一级永久 \\+' + Math.round((CONFIG.research.multiplier - 1) * 100) + '%'));
    assert.ok(output.actions.includes('researchBook'));
    const book = sheet(game, 'researchBook', width, height);
    assert.ok(book.actions.includes('research'));
    for (const route of Object.values(CONFIG.research.routes)) for (const project of route.projects) assert.ok(book.text.includes(project));
  }
});

test('active and ready research keep progress, permanent result, claim and abandonment readable on small screens', () => {
  for (const [width, height] of VIEWPORTS) for (const key of ['yield', 'value']) {
    const game = factory(), option = game.getView().research.options.find(item => item.key === key);
    assert.equal(game.startResearch(key, option).ok, true);
    game.tick(10);
    const active = game.getView().research.active;
    assert.ok(active.production > 0 && !active.ready);
    let output = sheet(game, 'research', width, height);
    assert.deepEqual(output.ui.modal.researchQuotes, {});
    assert.ok(output.actions.includes('researchCancel:' + active.id));
    assert.ok(!output.actions.includes('researchClaim:' + active.id));
    assert.match(output.text, /放弃.*清空/);
    for (let second = 0; second < CONFIG.research.durationSeconds + 1; second++) game.tick(1);
    output = sheet(game, 'research', width, height);
    assert.equal(game.getView().research.active.ready, true);
    assert.ok(output.actions.includes('researchClaim:' + active.id));
    assert.match(output.text, /永久提升/);
  }
});

test('locked, completed and workshop entry states remain reachable with the additional research row', () => {
  for (const [width, height] of VIEWPORTS) {
    const locked = factory({ machine: 2, orderIndex: 9, totalProduced: CONFIG.orders[8].target });
    assert.equal(sheet(locked, 'research', width, height).actions.some(action => action.startsWith('researchStart:')), false);
    const completed = factory({ machine: 5, orderIndex: 20, totalProduced: CONFIG.orders[19].target, completedAt: 300,
      research: { levels: { yield: CONFIG.research.maxLevel, value: CONFIG.research.maxLevel }, serial: 100, active: null } });
    const output = sheet(completed, 'research', width, height);
    sheet(completed, 'researchBook', width, height);
    assert.equal(output.actions.some(action => action.startsWith('researchStart:')), false);
    assert.ok(output.actions.includes('close'));
    for (const game of [factory(), completed]) {
      assert.ok(sheet(game, 'workshop', width, height).actions.includes('research'));
      assert.ok(sheet(game, 'upgrades', width, height).actions.includes('research'));
    }
    assert.ok(sheet(completed, 'workshop', width, height).actions.includes('souvenirs'));
  }
});

// Run the real main entry and renderer: pointer coordinates are selected from
// the actual visible hit zones. Only platform storage, sound and canvas APIs are faked.
function harness({ save = factory().exportSave(NOW), width = 320, height = 524, autoStart = true } = {}) {
  let now = NOW, nextFrame, time = 1, pointer, lastUI, renderer;
  const saves = [], keyboard = {}, records = [], ctx = context2d(records);
  const platform = {
    canvas: { getContext: () => ctx, setAttribute() {} }, isDouyin: false, config: {}, lastStorageError: '',
    load: () => copy(save), save(value) { saves.push(copy(value)); return true; },
    onPointer(fn) { pointer = fn; }, onHide() {}, onShow() {}, onResize() {},
    getSystemInfo: () => ({ width, height, pixelRatio: 1 }), track() {}, getAnalytics: () => [], vibrate() {},
    checkSidebar: () => Promise.resolve(), getSidebarState: () => ({ supported: false }), interstitial: () => Promise.resolve(false)
  };
  class ObservedRenderer extends Renderer {
    constructor(c) { super(c); renderer = this; }
    draw(view, ui, dt) { super.draw(view, ui, dt); lastUI = copy(ui); }
  }
  class Audio { setEnabled() {} unlock() {} play() {} }
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    document: { getElementById: () => null }, window: { addEventListener(name, fn) { keyboard[name] = fn; } },
    requestAnimationFrame(fn) { nextFrame = fn; }
  });
  const coreModule = { exports: {} };
  vm.runInContext('(function(module,exports){\n' + fs.readFileSync(path.join(__dirname, '../src/core.js'), 'utf8') + '\n})', context)(coreModule, coreModule.exports);
  const requireModule = name => ({ './core': coreModule.exports, './platform': { createPlatform: () => platform },
    './audio': { AudioEngine: Audio }, './renderer': { Renderer: ObservedRenderer },
    './experience': require('../src/experience'), './offline-summary': require('../src/offline-summary'), './next-step': require('../src/next-step') })[name];
  vm.runInContext('(function(require){\n' + fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8') + '\n})', context)(requireModule);
  const h = {
    saves, snapshot: () => copy(context.__POPCORN__.snapshot()), ui: () => copy(lastUI), zones: () => copy(renderer.zones),
    frame(ms = 0) { now += ms; time += ms; records.length = 0; const fn = nextFrame; nextFrame = null; fn(time); },
    at(action) { const zone = renderer.zones.find(item => item.action === action); assert.ok(zone, 'visible action missing: ' + action); return { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 }; },
    down(point, id = 1) { pointer({ type: 'down', id, ...point }); },
    up(point, id = 1) { pointer({ type: 'up', id, ...point }); h.frame(); },
    click(action) { const point = h.at(action); h.down(point); h.up(point); },
    key(code) { keyboard.keydown({ code, repeat: false, preventDefault() {} }); h.frame(); },
    openResearch() { if (lastUI.modal) h.click('close'); h.click('workshop'); h.click('research'); }
  };
  h.frame();
  if (autoStart) h.click('start');
  return h;
}

test('real canvas input starts a research project only on release and preserves it across application reload', () => {
  for (const [width, height] of VIEWPORTS) {
    const h = harness({ width, height, autoStart: false });
    assert.equal(h.ui().startup, true);
    assert.equal(h.zones().some(zone => zone.action === 'research'), false);
    h.key('KeyQ'); assert.equal(h.ui().startup, true);
    h.click('start'); h.openResearch();
    h.click('researchBook'); assert.equal(h.ui().modal.type, 'researchBook'); h.click('research');
    const option = h.ui().modal.researchQuotes.yield, action = 'researchStart:yield:' + option.id, point = h.at(action);
    const before = h.snapshot().state;
    h.down(point); assert.equal(h.snapshot().research.active, null);
    h.up({ x: point.x - 25, y: point.y }); assert.equal(h.snapshot().research.active, null, 'drag release cannot accept');
    h.click(action);
    assert.equal(h.ui().modal, null);
    assert.equal(h.snapshot().research.active.id, option.id);
    assert.equal(h.snapshot().state.coins, before.coins, 'starting is free');
    assert.equal(h.snapshot().state.taps, before.taps, 'starting cannot tap through to production');
    const restored = harness({ save: h.saves.at(-1), width, height });
    assert.equal(restored.snapshot().research.active.id, option.id);
    restored.openResearch(); assert.equal(restored.ui().modal.type, 'research');
    assert.equal(restored.zones().some(zone => zone.action.startsWith('researchStart:')), false);
  }
});

test('real canvas claim applies one permanent level and stale pointer release cannot start the next project', () => {
  const h = harness(); h.openResearch();
  const option = h.ui().modal.researchQuotes.value;
  h.click('researchStart:value:' + option.id);
  let elapsed = 0;
  while (!h.snapshot().research.active.ready && elapsed < 600) { h.frame(1000); elapsed++; }
  assert.ok(h.snapshot().research.active.ready, 'normal production reaches the frozen target');
  const before = h.snapshot().production.price;
  h.openResearch(); const claim = 'researchClaim:' + option.id, point = h.at(claim);
  h.down(point); assert.equal(h.snapshot().state.research.levels.value, 0);
  h.up(point);
  assert.equal(h.snapshot().state.research.levels.value, 1);
  assert.ok(Math.abs(h.snapshot().production.price / before - CONFIG.research.multiplier) < 1e-12);
  assert.match(h.ui().toast, /永久提升/);
  h.up(point); assert.equal(h.snapshot().research.active, null, 'duplicate release cannot accept another route');
  const restored = harness({ save: h.saves.at(-1) });
  assert.equal(restored.snapshot().state.research.levels.value, 1);
  assert.equal(restored.snapshot().research.active, null);
});

test('abandonment needs two deliberate releases, reopening clears confirmation and completed levels survive reload', () => {
  const seed = factory({ research: { levels: { yield: 2, value: 1 }, serial: 4, active: null } });
  const h = harness({ save: seed.exportSave(NOW) }); h.openResearch();
  const option = h.ui().modal.researchQuotes.yield;
  h.click('researchStart:yield:' + option.id); h.frame(1000); h.openResearch();
  const action = 'researchCancel:' + option.id;
  h.click(action); assert.ok(h.snapshot().research.active);
  assert.match(h.ui().toast, /再点一次放弃/);
  h.click('close'); h.openResearch();
  h.click(action); assert.ok(h.snapshot().research.active, 'returning requires a fresh confirmation');
  const point = h.at(action); h.down(point); assert.ok(h.snapshot().research.active);
  h.up(point);
  assert.equal(h.snapshot().research.active, null);
  assert.deepEqual(h.snapshot().state.research.levels, { yield: 2, value: 1 });
  const restored = harness({ save: h.saves.at(-1) });
  assert.equal(restored.snapshot().research.active, null);
  assert.deepEqual(restored.snapshot().state.research.levels, { yield: 2, value: 1 });
});

test('research sheets isolate underlying taps, upgrade shortcuts, mismatched pointer ids and motion', () => {
  const h = harness(); h.openResearch();
  const before = h.snapshot().state;
  for (const code of ['Space', 'Digit1', 'Digit2', 'Digit3', 'KeyO']) h.key(code);
  assert.equal(h.ui().modal.type, 'research');
  assert.equal(h.snapshot().state.taps, before.taps);
  assert.deepEqual(h.snapshot().state.upgrades, before.upgrades);
  h.down({ x: 160, y: 210 }); h.up({ x: 160, y: 210 });
  assert.equal(h.snapshot().state.taps, before.taps);
  const option = h.ui().modal.researchQuotes.yield, point = h.at('researchStart:yield:' + option.id);
  h.down(point, 7); h.up(point, 8); assert.equal(h.snapshot().research.active, null);
  h.up({ x: point.x, y: point.y + 30 }, 7); assert.equal(h.snapshot().research.active, null);
});

test('research guidance respects available main rewards, keeps active work ahead of unready jobs, and is read-only', () => {
  const game = factory({ upgrades: { tap: 24, auto: 24, value: 24 } });
  const target = () => selectCurrentTarget(game.getView());
  assert.equal(target().source, 'research');
  const job = game.getView().commissions.options.find(option => option.kind === 'bulk');
  game.acceptCommission('bulk', job); assert.equal(target().source, 'commission');
  const option = game.getView().research.options[0]; game.startResearch(option.key, option);
  assert.equal(target().source, 'research');
  game.state.totalProduced = game.getView().deliveries.stages[0].threshold;
  assert.equal(target().source, 'delivery');
  game.state.research.active.production = option.productionTarget;
  assert.equal(target().source, 'research', 'permanent upgrade ready precedes a staged cash claim');
  assert.equal(selectNextStep(game.getView(), target()).kind, 'research');
  game.state.totalProduced = CONFIG.orders[10].target;
  assert.equal(target().source, 'order');
  assert.equal(selectNextStep(game.getView(), target()).kind, 'order');
  game.state.machine = 2; game.state.coins = CONFIG.machines[3].cost;
  assert.equal(target().source, 'machine');
  const before = copy(game.exportSave(NOW)); target(); selectNextStep(game.getView(), target());
  assert.deepEqual(game.exportSave(NOW), before);
});

test('research telemetry records permanent results once and exposes a changed sheet state without per-frame spam', () => {
  const game = factory(), tracker = createExperienceTracker({ initialView: game.getView() });
  const observe = () => tracker.observe(game.getView(), { modalType: 'research' });
  const exposed = () => tracker.export().events.filter(event => event.event === 'experience_progression_visible').length;
  for (let i = 0; i < 10; i++) observe(); assert.equal(exposed(), 1);
  const option = game.getView().research.options[0]; game.startResearch(option.key, option);
  tracker.recordEvents(game.drainEvents(), game.getView()); observe(); assert.equal(exposed(), 2);
  game.tick(1); tracker.recordEvents(game.drainEvents(), game.getView());
  for (let i = 0; i < 10; i++) observe(); assert.equal(exposed(), 2);
  game.state.research.active.production = option.productionTarget;
  observe(); assert.equal(exposed(), 3);
  const claimed = game.claimResearch(option.id); assert.equal(claimed.ok, true);
  tracker.recordEvents(game.drainEvents(), game.getView()); observe(); assert.equal(exposed(), 4);
  game.claimResearch(option.id); tracker.recordEvents(game.drainEvents(), game.getView());
  const events = tracker.export().events.filter(event => event.event === 'experience_research');
  assert.deepEqual(events.map(event => event.data.action), ['start', 'claim']);
  assert.equal(events[1].data.after, claimed.after); assert.equal(events[1].data.before, claimed.before);
  assert.equal(tracker.export().current.researchLevels, 1);
  tracker.observe(game.getView(), { modalType: 'research', visible: false }); assert.equal(exposed(), 4);
});

test('offline research advice excludes pre-acceptance production, never grants the preview, and defers to main goals', () => {
  const game = factory({ coins: 0 }), target = game.getView().research.options[0].productionTarget;
  game.state.offline = { id: 'offline:research-ui', seconds: 60, production: target + 50, coins: 1 };
  const option = game.getView().research.options[0]; assert.equal(game.startResearch(option.key, option).ok, true);
  const snapshot = () => copy(game.exportSave(NOW));
  let before = snapshot();
  assert.notEqual(selectOfflineSummary(game.getView()).nextStep.title, '领取后可验收研发');
  assert.deepEqual(snapshot(), before);
  game.state.offline.production += target;
  before = snapshot();
  const summary = selectOfflineSummary(game.getView());
  assert.equal(summary.nextStep.title, '领取后可验收研发');
  assert.equal(summary.nextStep.action, 'research');
  assert.equal(game.getView().research.active.ready, false, 'preview is not a claim');
  assert.deepEqual(snapshot(), before);
  const orderView = copy(game.getView()); orderView.offline.production = orderView.order.target;
  assert.equal(selectOfflineSummary(orderView).nextStep.action, 'order');
  const machineView = copy(game.getView()); machineView.state.machine = 2; machineView.nextMachine = CONFIG.machines[3];
  machineView.offline.coins = CONFIG.machines[3].cost;
  assert.equal(selectOfflineSummary(machineView).nextStep.action, 'machine');
  assert.equal(game.claimOffline().ok, true); assert.equal(game.getView().research.active.ready, true);
  assert.equal(game.state.research.levels.yield, 0, 'ordinary offline claim still requires explicit research acceptance');
});
