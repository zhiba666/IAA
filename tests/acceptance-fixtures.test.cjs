'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { Game, CONFIG } = require('../src/core');
const { conserved } = require('../tools/automation-balance.cjs');
const { canvasHarness } = require('./canvas-harness.cjs');
const { SAVE_KEY: ORDER_SAVE_KEY } = require('../src/v13-order-mode');
const fixtureModule = import(pathToFileURL(path.resolve(__dirname, '../tools/visual-acceptance.mjs')).href);
const serverModule = import(pathToFileURL(path.resolve(__dirname, '../tools/serve-acceptance.mjs')).href);
const runtime = fs.readFileSync(path.resolve(__dirname, '../tools/acceptance-runtime.js'), 'utf8');

test('v15 QA fixtures preserve real income and can buy both routes with ordinary core commands', async () => {
  const fixtures = (await fixtureModule).createVisualFixtures();
  for (const item of fixtures.cases) {
    assert.equal(item.storageKey, item.mode === 'v15' ? CONFIG.automation.saveKey : 'little_popcorn_factory_pipeline_v2');
    const game = new Game({ mode: item.mode === 'v15' ? 'v15' : null, save: item.save, now: item.save.savedAt });
    assert.equal(game.loadWarning, null, item.id);
    assert.deepEqual(game.getView(), item.snapshot);
    if (item.mode === 'v15') conserved(game);
  }
  const ready = fixtures.cases.find(item => item.id === 'v15-purchase-ready');
  const game = new Game({ mode: 'v15', save: ready.save });
  assert.ok(game.getView().transfers.every(item => !item.automated && item.automation.available));
  assert.ok(game.state.totalSold > 0 && game.state.totalEarned === game.state.totalSold * CONFIG.price);
  assert.equal(game.buyAutomation('pop').ok, true);
  assert.equal(game.buyAutomation('cup').ok, true);
  assert.equal(game.buyLogisticsUpgrade().ok, true);
  const sold = game.state.totalSold;
  game.tick(60);
  assert.ok(game.state.totalSold > sold, 'the fixture supports actual unattended production after UI-equivalent purchases');
  conserved(game);
  const automatic = fixtures.cases.find(item => item.id === 'v15-automated');
  assert.ok(automatic.snapshot.transfers.every(item => item.automated));
  assert.equal(automatic.snapshot.automaticTrial.complete, true);
});

test('the isolated runtime replaces only the chosen fixture key and explicitly selects its mode', async () => {
  const fixtures = (await fixtureModule).createVisualFixtures(), storage = new Map([
    ['little_popcorn_factory_pipeline_v2', 'existing-qa-baseline'],
    [CONFIG.automation.saveKey, 'existing-qa-v15'],
    [CONFIG.automation.saveKey + '_backup_v2', 'qa-backup-must-stay'],
    ['unrelated', 'leave-alone']
  ]);
  for (const id of ['v15-purchase-ready', 'v15-fresh', 'first-cup-before', 'v15-automated']) {
    const fixture = fixtures.cases.find(item => item.id === id), writes = [];
    const before = new Map(storage);
    const location = new URL('http://127.0.0.1:4192/?mode=' + fixture.mode + '&fixture=' + fixture.id + '&pause=1');
    const context = {
      __IAA_ACCEPTANCE_INPUT__: { fixture, mode: fixture.mode, storageKey: fixture.storageKey, scope: fixtures.scope, port: 4192, paused: true, safe: false },
      POPCORN_CONFIG: { mode: fixture.mode === 'v15' ? 'baseline' : 'v15', experiment: 'manual-transfer-p0' },
      location, URL, history: { replaceState(state, title, href) { location.href = href; } },
      localStorage: { setItem(key,value) { writes.push(key); storage.set(key,value); } },
      requestAnimationFrame() { return 1; }, window: { addEventListener() {} },
      document: { documentElement: { style: { setProperty() {} } }, title: '' },
      console: { error() {}, info() {} }
    };
    vm.runInNewContext(runtime, context);
    const routeMode = fixture.mode === 'v15' ? 'legacy-v15' : 'baseline';
    assert.equal(context.POPCORN_CONFIG.mode, routeMode);
    assert.equal(location.searchParams.get('mode'), routeMode, 'QA query mode also selects compatibility before the bundle boots');
    assert.equal(location.searchParams.get('fixture'), fixture.id);
    assert.equal(location.searchParams.get('pause'), '1');
    assert.equal(context.POPCORN_CONFIG.experiment, null);
    assert.deepEqual(writes, [fixture.storageKey]);
    assert.equal(storage.get(fixture.storageKey), JSON.stringify(fixture.save));
    for (const [key,value] of before) if (key !== fixture.storageKey) assert.equal(storage.get(key), value);
  }
  assert.equal(storage.get(CONFIG.automation.saveKey + '_backup_v2'), 'qa-backup-must-stay');
});

test('acceptance URLs isolate legacy fixtures from v15 and reject conflicting mode or experiment requests', async t => {
  const server = (await serverModule).createAcceptanceServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  for (const [query,mode,id] of [
    ['?fixture=first-cup-before&pause=1', 'baseline', 'first-cup-before'],
    ['?mode=v15&fixture=v15-purchase-ready&pause=1', 'v15', 'v15-purchase-ready'],
    ['?mode=v15', 'v15', 'v15-fresh'],
    ['?mode=v15&fixture=v15-automated', 'v15', 'v15-automated'],
    ['?mode=legacy-v15', 'v15', 'v15-fresh'],
    ['?mode=legacy-v15&fixture=v15-purchase-ready&pause=1', 'v15', 'v15-purchase-ready']
  ]) {
    const response = await fetch(origin + '/' + query);
    assert.equal(response.status, 200);
    const html = await response.text();
    const input = JSON.parse(html.match(/__IAA_ACCEPTANCE_INPUT__=([\s\S]+?);<\/script>/)[1]);
    assert.equal(input.fixture.id, id);
    assert.equal(input.mode, mode);
    assert.equal(input.storageKey, input.fixture.storageKey);
    assert.equal(input.port, server.address().port);
    assert.ok(html.indexOf('/__acceptance/runtime.js') < html.indexOf('game.bundle.js'), 'mode is set before the formal game reads storage');
  }
  for (const query of ['?mode=baseline&fixture=v15-fresh', '?mode=v15&fixture=pop-full', '?mode=legacy-v15&fixture=pop-full', '?experiment=manual-transfer-p0'])
    assert.equal((await fetch(origin + '/' + query)).status, 400);
  assert.equal((await fetch(origin + '/__acceptance/capture/not-written.json', { method: 'POST', body: '{}' })).status, 403);
});

test('the actual browser bundle boots QA fixtures in their compatible core without migrating them to orders', async () => {
  const fixtures = (await fixtureModule).createVisualFixtures();
  const bundle = fs.readFileSync(path.resolve(__dirname, '../web/game.bundle.js'), 'utf8');
  for (const [id, queryMode] of [['v15-purchase-ready', 'v15'], ['v15-fresh', 'legacy-v15'],
    ['v15-automated', 'v15'], ['first-cup-before', 'baseline']]) {
    const fixture = fixtures.cases.find(item => item.id === id), drawing = canvasHarness();
    const location = new URL('http://127.0.0.1:4192/?mode=' + queryMode + '&fixture=' + id + '&pause=1');
    const storage = new Map([['unrelated', 'keep-this'], [CONFIG.automation.saveKey + '_backup_v2', 'keep-backup']]);
    let nextFrame = null;
    const canvas = { style: {}, getContext: () => drawing.ctx, setAttribute() {}, addEventListener() {}, setPointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }) };
    const document = { hidden: false, title: '', documentElement: { style: { setProperty() {} } },
      getElementById: name => name === 'game' ? canvas : null, querySelector: () => canvas, addEventListener() {} };
    const localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
    const window = { location, localStorage, innerWidth: 390, innerHeight: 844, devicePixelRatio: 1, addEventListener() {} };
    const context = vm.createContext({
      __IAA_ACCEPTANCE_INPUT__: { fixture, mode: fixture.mode, storageKey: fixture.storageKey,
        scope: fixtures.scope, port: 4192, paused: true, safe: false },
      location, URL, history: { replaceState(state, title, href) { location.href = href; } },
      localStorage, window, document, innerWidth: 390, innerHeight: 844, devicePixelRatio: 1,
      performance: { getEntriesByType: () => [], now: () => 0 },
      console: { error() {}, info() {} },
      Date: class extends Date { static now() { return fixture.save.savedAt; } },
      requestAnimationFrame(callback) { assert.equal(nextFrame, null, 'QA still owns one real application frame loop'); nextFrame = callback; }
    });
    vm.runInContext(runtime, context, { filename: 'tools/acceptance-runtime.js' });
    vm.runInContext(bundle, context, { filename: 'web/game.bundle.js' });
    const frame = nextFrame; nextFrame = null; frame(fixture.save.savedAt);
    const snapshot = JSON.parse(JSON.stringify(context.__POPCORN__.snapshot()));
    assert.deepEqual(snapshot, fixture.snapshot, id + ' retains every validated state field at its paused QA clock');
    assert.equal(snapshot.mode, fixture.mode === 'v15' ? 'v15' : null);
    assert.equal(snapshot.orders, undefined, 'legacy QA never silently boots the order world');
    assert.equal(storage.has(ORDER_SAVE_KEY), false, 'QA does not migrate the historical fixture into a new order save');
    assert.equal(storage.get('unrelated'), 'keep-this');
    assert.equal(storage.get(CONFIG.automation.saveKey + '_backup_v2'), 'keep-backup');
    assert.equal(context.__IAA_ACCEPTANCE__.diagnostics().mode, fixture.mode, 'diagnostics retain the fixture core mode');
    assert.equal(drawing.depth(), 0);
  }
});
