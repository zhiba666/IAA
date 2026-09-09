'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/core');
const { harness, START } = require('./app-harness.cjs');
const station = (view, id) => view.stations.find(item => item.id === id);
function progressed() { const game = new Game({ now: START }); game.tick(40); return game.exportSave(START); }
function economy(view) { const s = view.state; return { coins: s.coins, totalSold: s.totalSold, totalProduced: s.totalProduced, totalEarned: s.totalEarned, totalSpent: s.totalSpent, buffers: s.buffers, stations: s.stations, upgrades: s.upgrades, machine: s.machine }; }

test('actual entry starts automatically and never credits work in progress before final shipment', () => {
  const h = harness();
  assert.equal(h.context.__POPCORN__.version, '2.0.0');
  assert.deepEqual(Object.keys(h.context.__POPCORN__).sort(), ['analytics','snapshot','version']);
  assert.equal(h.ui().newFactory, true);
  h.frame(500);
  assert.ok(h.snapshot().state.totalProduced > 0);
  assert.equal(h.snapshot().state.coins, 0);
  h.run(20);
  const s = h.snapshot().state;
  assert.ok(s.totalSold > 0);
  assert.equal(s.coins, s.totalSold);
  assert.equal(s.totalProduced, s.totalSold + s.buffers.pop + s.buffers.cup + Object.values(s.stations).reduce((n,st) => n + st.jobs.reduce((m,j) => m + (j ? j.amount : 0), 0), 0));
  assert.equal(h.legacyCalls(), 0);
});

test('first bottleneck upgrade is scoped to its real station, pays once, and improves dispatch', () => {
  const h = harness({ save: progressed() }), before = h.snapshot();
  h.click('upgrade:cup:1');
  assert.deepEqual(economy(h.snapshot()), economy(before), 'an invisible or stale upgrade action cannot buy');
  h.click('station:pop'); h.click('upgrade:cup:1');
  assert.deepEqual(economy(h.snapshot()), economy(before), 'a different station sheet cannot buy the cup upgrade');
  h.click('station:cup');
  assert.deepEqual(h.ui().modal, { type: 'station', stationId: 'cup' });
  const cost = station(before, 'cup').upgrade.cost;
  const quote = h.ui().quote;
  h.click('upgrade:cup:1');
  const after = h.snapshot();
  assert.equal(after.state.coins, before.state.coins - cost);
  assert.equal(after.state.totalSpent, before.state.totalSpent + cost);
  assert.equal(station(after, 'cup').capacity, 6);
  assert.equal(station(after, 'pop').capacity, station(before, 'pop').capacity);
  assert.equal(station(after, 'ship').capacity, station(before, 'ship').capacity);
  assert.deepEqual(h.ui().modal, { type: 'station', stationId: 'cup' });
  assert.equal(h.ui().stationCollapsed, true);
  assert.deepEqual(h.ui().quote, quote, 'completed purchase keeps its original quote');
  assert.equal(h.ui().purchaseFeedback.name, quote.name);
  assert.equal(h.ui().rateUpdatingUntil, after.state.simulation.ticks + 1200);
  assert.equal(h.snapshot().throughput, before.throughput, 'upgrade never replaces actual speed with its prediction');
  h.click('upgrade:cup:1');
  assert.equal(h.snapshot().state.totalSpent, after.state.totalSpent);
  const stocked = after.state.buffers.pop;
  h.run(10);
  assert.ok(h.snapshot().state.buffers.pop < stocked, 'the upstream backlog visibly drains');
  assert.ok(h.snapshot().throughput > before.throughput, 'measured shipments rise, beyond nominal capacity text');
  assert.equal(h.ui().rateUpdatingUntil <= h.snapshot().state.simulation.ticks, true);
  assert.ok(h.sounds.includes('upgrade'));
});

test('insufficient coins and unknown legacy inputs cannot alter stock or money', () => {
  const h = harness({ config: { developerHoldTap: true, allowSimulatedAds: true } }), before = h.snapshot();
  h.click('station:cup'); h.click('upgrade:cup:1');
  assert.deepEqual(economy(h.snapshot()), economy(before));
  assert.match(h.ui().toast, /金币/);
  h.click('close');
  for (const action of ['tap','start','claimOrder','releasePressure','ad:turbo','ad:offline','ad:brand','adComplete','simulate:complete','quest:0','energy','claimOffline','upgrade:auto','upgrade:tap','upgrade:value','upgrade:cup','brand','order','modules']) h.click(action);
  assert.deepEqual(economy(h.snapshot()), economy(before));
  assert.equal(h.legacyCalls(), 0);
});

test('reviewed quotes resist repeated clicks and Enter even when the following tier is affordable', () => {
  const fixture = new Game({ now: START }); fixture.tick(1000);
  const save = fixture.exportSave(START); save.machine = 2;
  const h = harness({ save });
  h.key('Digit2');
  assert.equal(h.ui().quote.level, 1);
  h.key('Enter', true);
  assert.equal(station(h.snapshot(), 'cup').level, 0, 'key repeat cannot trigger a purchase');
  h.key('Enter');
  const paid = h.snapshot().state.totalSpent;
  assert.equal(station(h.snapshot(), 'cup').level, 1);
  assert.ok(station(h.snapshot(), 'cup').upgrade.available, 'the next tier really is affordable and unlocked');
  for (let i = 0; i < 4; i++) { h.click('upgrade:cup:1'); h.click('upgrade:cup:2'); h.key('Enter'); }
  h.click('station:cup'); h.key('Enter');
  assert.equal(h.snapshot().state.totalSpent, paid, 'same-station taps retain the completed quote');
  h.click('reviewUpgrade');
  assert.equal(h.ui().quote.level, 2);
  assert.equal(h.ui().stationCollapsed, false);
  h.click('upgrade:cup:1');
  assert.equal(h.snapshot().state.totalSpent, paid, 'old token remains invalid after quote refresh');
  h.key('Enter');
  assert.equal(station(h.snapshot(), 'cup').level, 2);
  assert.equal(h.snapshot().state.totalSpent, paid + 200);
});

test('compact controls and number keys switch stations without pausing real production', () => {
  const h = harness({ save: progressed() });
  h.key('Digit2'); h.click('toggleDetails');
  assert.equal(h.ui().stationDetails, true);
  h.key('Digit1');
  assert.deepEqual(h.ui().modal, { type: 'station', stationId: 'pop' });
  assert.equal(h.ui().quote.stationId, 'pop');
  assert.equal(h.ui().stationDetails, false);
  h.click('collapseStation');
  assert.equal(h.ui().stationCollapsed, true);
  h.key('Digit3');
  assert.deepEqual(h.ui().modal, { type: 'station', stationId: 'ship' });
  assert.equal(h.ui().stationCollapsed, false);
  const before = h.snapshot().state.totalSold;
  h.run(3);
  assert.ok(h.snapshot().state.totalSold > before, 'the selected station panel never pauses production');
  h.key('KeyS');
  assert.equal(h.ui().modal.type, 'settings');
  h.key('Escape');
  assert.equal(h.ui().modal, null);
  const spent = h.snapshot().state.totalSpent;
  h.key('Enter');
  assert.equal(h.snapshot().state.totalSpent, spent, 'hidden panel cannot buy from its retained quote');
});

test('shipment feedback aggregates real events without extra settlement or per-portion sound', () => {
  const h = harness({ save: progressed() });
  h.click('station:cup'); h.click('upgrade:cup:1');
  const before = h.snapshot().state;
  h.run(8, 10);
  const after = h.snapshot().state;
  const realEvents = h.rendererEvents.filter(event => event.type === 'ship');
  assert.equal(realEvents.reduce((n, event) => n + event.amount, 0), after.totalSold - before.totalSold);
  assert.equal(after.coins - before.coins, after.totalSold - before.totalSold);
  const chimes = h.sounds.filter(name => name === 'ship');
  assert.ok(chimes.length > 0);
  assert.ok(chimes.length <= Math.ceil(8 / .65), 'ship sound is capped even with 100 input frames per second');
  assert.ok(chimes.length < realEvents.length);
  const feedback = h.ui().shipment;
  assert.ok(feedback.amount > 0);
  assert.equal(feedback.coins, feedback.amount * h.snapshot().price);
  h.hide(); h.run(2); h.show(); h.frame(0);
  assert.equal(h.ui().shipment, null, 'backgrounded feedback is cleared instead of replayed');
  assert.equal(h.sounds.filter(name => name === 'ship').length, chimes.length);
});

test('background and wall-clock absence cannot create inventory, offline rewards, or coins', () => {
  const h = harness({ save: progressed() });
  h.hide(); const paused = economy(h.snapshot());
  h.frame(3600000); h.show(); h.frame(0);
  assert.deepEqual(economy(h.snapshot()), paused);
  h.frame(1000); assert.ok(h.snapshot().state.totalSold > paused.totalSold);
  h.hide(); const saved = h.saves.at(-1); saved.savedAt = START - 7 * 86400000;
  const reloaded = harness({ save: saved });
  assert.deepEqual(economy(reloaded.snapshot()), economy(h.snapshot()));
  assert.equal(reloaded.legacyCalls(), 0);
});

test('save reload preserves partial work, purchased capacity, settings and one-time intro dismissal', () => {
  const h = harness({ save: progressed() });
  h.click('station:cup'); h.click('upgrade:cup:1'); h.frame(123);
  h.click('dismissIntro'); h.click('settings'); h.click('setting:sound'); h.click('setting:haptics'); h.click('close');
  h.hide();
  const reloaded = harness({ save: h.saves.at(-1) });
  assert.deepEqual(economy(reloaded.snapshot()), economy(h.snapshot()));
  assert.deepEqual(reloaded.snapshot().state.settings, { sound: false, haptics: false });
  assert.equal(reloaded.ui().newFactory, false);
  reloaded.run(1); h.show(); h.frame(0); h.run(1);
  assert.deepEqual(economy(reloaded.snapshot()), economy(h.snapshot()));
});

test('storage failure is surfaced while automatic production remains usable and later saves recover', () => {
  const h = harness({ saveFailure: true });
  assert.match(h.ui().toast, /未保存|存储/);
  h.run(6); assert.ok(h.snapshot().state.totalSold > 0); assert.equal(h.saves.length, 0);
  h.setSaveFailure(false); h.run(5);
  assert.ok(h.saves.at(-1).totalSold > 0);
});

test('restart requires its visible confirmation and retains current factory when writing fails', () => {
  const h = harness({ save: progressed() }), before = economy(h.snapshot());
  h.click('confirmRestart'); assert.deepEqual(economy(h.snapshot()), before);
  h.click('settings'); h.click('restart'); h.click('close'); h.click('confirmRestart');
  assert.deepEqual(economy(h.snapshot()), before);
  h.click('settings'); h.click('restart'); h.setSaveFailure(true); h.click('confirmRestart');
  assert.deepEqual(economy(h.snapshot()), before); assert.equal(h.ui().modal.type, 'restart');
  assert.match(h.ui().toast, /失败.*保留/);
  h.setSaveFailure(false); h.click('confirmRestart');
  assert.equal(h.snapshot().state.totalSold, 0); assert.equal(h.snapshot().state.coins, 0);
  assert.equal(h.snapshot().state.machine, 0); assert.equal(h.ui().newFactory, true);
  const reloaded = harness({ save: h.saves.at(-1) });
  assert.equal(reloaded.snapshot().state.totalSold, 0);
  assert.equal(reloaded.ui().newFactory, true);
});

test('cancelled, dragged and interrupted pointers cannot buy a station upgrade', () => {
  const h = harness({ save: progressed() }); h.click('station:cup'); const before = economy(h.snapshot());
  h.pointer('down','upgrade:cup:1'); h.pointer('cancel','upgrade:cup:1');
  h.pointer('down','upgrade:cup:1'); h.pointer('move','upgrade:cup:1',1,150,100); h.pointer('up','upgrade:cup:1');
  h.pointer('down','upgrade:cup:1'); h.hide(); h.show(); h.pointer('up','upgrade:cup:1');
  h.pointer('down','upgrade:cup:1'); h.resize(); h.pointer('up','upgrade:cup:1');
  assert.deepEqual(economy(h.snapshot()), before);
});

test('snapshot diagnostics are detached and cannot mutate authoritative simulation', () => {
  const h = harness({ save: progressed() }), before = h.snapshot();
  assert.equal(h.lastView().insights.stableRate, 2, 'only the rendered view is enriched with forecasts');
  assert.equal(before.insights, undefined, 'the diagnostic snapshot remains the raw production contract');
  for (let i = 0; i < 12; i++) h.frame(0);
  assert.deepEqual(h.snapshot(), before, 'repeated presentation enrichment cannot advance production');
  const exposed = h.context.__POPCORN__.snapshot();
  exposed.state.coins = 999999; exposed.stations[0].capacity = 999999; exposed.state.buffers.pop = 0;
  assert.deepEqual(h.snapshot(), before);
});

test('a frozen animation frame cannot settle time away when no hide event arrives', () => {
  const h = harness({ save: progressed() });
  const before = economy(h.snapshot()), ticks = h.snapshot().state.simulation.ticks;
  for (const ms of [1001, 60000, 3600000]) {
    h.frame(ms);
    assert.deepEqual(economy(h.snapshot()), before, 'stalled frame is treated as paused');
    assert.equal(h.snapshot().state.simulation.ticks, ticks);
  }
  h.frame(1000);
  assert.ok(h.snapshot().state.totalSold > before.totalSold, 'the next ordinary frame resumes real dispatch');
  assert.equal(h.snapshot().state.simulation.ticks, ticks + 120);
});
