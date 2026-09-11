'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Game, CONFIG } = require('../src/core');
const { ProductionInsights } = require('../src/production-insights');
const { Renderer } = require('../src/renderer');
const { ART_ASSETS } = require('../src/art-manifest');
const { canvasHarness, deepFreeze } = require('./canvas-harness.cjs');
const { harness } = require('./app-harness.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const contract = job => job ? { amount: job.amount, progress: job.progress, complete: job.complete } : null;
const fixtureModule = import(pathToFileURL(path.resolve(__dirname, '../tools/six-gen-acceptance.mjs')).href);
const fixtures = fixtureModule.then(module => module.createSixGenerationFixtures());
const viewports = [320, 390].flatMap(width => [0, 8, 24].map(safeTop => ({
  width, height: (width === 320 ? 524 : 844) - safeTop, safeTop, menuBottom: 0
})));

function render(view, viewport, extra = {}, missing = null) {
  const canvas = canvasHarness(), draws = [];
  canvas.ctx.globalAlpha = 1;
  canvas.ctx.drawImage = (image, ...args) => {
    assert.ok(image?.id && ART_ASSETS[image.id], 'every painted image is a real runtime manifest resource');
    assert.ok(args.every(Number.isFinite)); draws.push({ id: image.id, args });
  };
  const assets = { get(id) {
    assert.ok(ART_ASSETS[id], 'declared asset ' + id);
    return id === missing ? null : { id, width: ART_ASSETS[id].width, height: ART_ASSETS[id].height };
  }, report: () => ({ requested: Object.keys(ART_ASSETS).length, pending: 0, failed: missing ? 1 : 0 }) };
  const renderer = new Renderer(canvas.ctx, assets);
  const ui = deepFreeze({ viewport, modal: null, stationCollapsed: false, stationDetails: false,
    transfer: null, toast: '', toastSeconds: 0, newFactory: false, rateUpdatingUntil: 0, ...extra });
  const before = JSON.stringify(view); deepFreeze(view); renderer.draw(view, ui, 0);
  assert.equal(JSON.stringify(view), before, 'presentation is read-only');
  assert.equal(canvas.depth(), 0, 'all Canvas and clipping stacks restore');
  return { renderer, canvas, draws, ui };
}

function enriched(item) { return new ProductionInsights().enrich(copy(item.snapshot)); }
function inside(rect, bounds, label) {
  const values = Array.isArray(rect) ? rect : [rect.x, rect.y, rect.w, rect.h];
  const [x, y, w, h] = values;
  assert.ok(values.every(Number.isFinite) && w > 0 && h > 0, label + ' positive bounds');
  assert.ok(x >= bounds.x - 1e-6 && y >= bounds.y - 1e-6 && x + w <= bounds.x + bounds.w + 1e-6 && y + h <= bounds.y + bounds.h + 1e-6,
    label + ' stays in production scene: ' + JSON.stringify({ rect: values, bounds }));
}

test('six-generation fixtures are accepted real states with distinct installed equipment at entry and full upgrade', async () => {
  const data = await fixtures;
  assert.equal(data.deviceStatus, 'NOT_RUN');
  const upgraded = [[[1, 1], [1, 1], [1, 1]], [[2, 1], [2, 1], [1, 2]], [[2, 1], [2, 1], [2, 2]],
    [[4, 1], [3, 1], [2, 4]], [[4, 2], [4, 2], [4, 4]], [[6, 2], [6, 2], [4, 4]]];
  for (const item of data.cases) {
    const restored = new Game({ mode: 'v15', save: item.save, now: item.save.savedAt });
    assert.equal(restored.loadWarning, null, item.id);
    assert.deepEqual(restored.getView(), item.snapshot, item.id + ': real view, not a manually populated presentation');
    assert.equal(restored.state.version, 4);
    assert.equal(restored.state.coins + restored.state.totalSpent, restored.state.totalSold * CONFIG.price);
  }
  for (let generation = 1; generation <= 6; generation++) {
    const entry = data.cases.find(item => item.id === 'g' + generation + '-entry');
    const full = data.cases.find(item => item.id === 'g' + generation + '-upgraded');
    assert.equal(entry.kind, 'natural-production'); assert.equal(full.kind, 'natural-production');
    assert.deepEqual(full.snapshot.stations.map(station => [station.lanes, station.batchSize]), upgraded[generation - 1]);
    assert.deepEqual(entry.snapshot.stations.map(station => [station.lanes, station.batchSize]), upgraded[Math.max(0, generation - 2)]);
  }
  assert.equal(data.transitions.length, 5);
  assert.equal(data.stateMatrix.length, 54);
  assert.equal(data.stateMatrix.filter(row => row.result === 'N/A').length, 12);
  assert.equal(data.warehouseMatrix.length, 48);
  for (const row of data.stateMatrix.filter(row => row.reachable)) {
    const station = data.cases.find(item => item.id === row.fixture).snapshot.stations.find(item => item.id === row.stationId);
    assert.equal(station.status, row.status, JSON.stringify(row));
  }
});

test('all six actual entry and upgraded factories render art within small screens and both safe-area cases', async () => {
  const data = await fixtures;
  for (const item of data.cases.filter(item => ['entry', 'upgraded'].includes(item.configuration))) {
    for (const viewport of viewports) for (const stationId of [null, 'pop', 'cup', 'ship']) {
      const label = item.id + '/' + viewport.width + '/safe' + viewport.safeTop + '/' + stationId;
      const view = enriched(item);
      const { renderer, canvas } = render(view, viewport, { modal: stationId ? { type: 'station', stationId } : null });
      const scene = renderer.scene, layout = renderer.interface.layout;
      assert.equal(scene.artGeneration, item.save.machine, label + ': no silent old Canvas route');
      assert.equal(scene.stationFrames.length, 3); assert.equal(scene.bufferFrames.length, 2);
      assert.deepEqual(layout.scene, { x: 0, y: 0, w: viewport.width, h: viewport.height });
      assert.ok(scene.contentFrame.y >= viewport.safeTop);
      assert.equal(layout.dock, undefined);
      for (const frame of scene.stationFrames) {
        assert.equal(frame.art, true, label + '/' + frame.id + ' art');
        assert.ok(frame.w >= 44 && frame.h >= 44, label + '/' + frame.id + ' 44 px touch area');
        inside(frame.artRect, layout.scene, label + '/' + frame.id);
        if (!stationId) assert.equal(renderer.actionAt(frame.x + frame.w / 2, frame.y + frame.h / 2), 'station:' + frame.id, label + ' machine click');
        else assert.ok(!renderer.zones.some(zone => zone.action === 'station:' + frame.id), label + ' modal owns input');
      }
      for (const bin of scene.diagnostics.buffers) inside(bin.rect, layout.scene, label + '/' + bin.id);
      for (const station of view.stations) {
        const machine = scene.diagnostics.machines.find(machine => machine.stationId === station.id);
        assert.deepEqual(machine.jobs.map(contract), station.jobs.filter(Boolean).map(contract), label + ' all actual lane batches');
      }
      for (const connection of scene.diagnostics.connections) assert.ok(connection.gap <= 2, label + ' port gap');
      for (const text of canvas.texts) {
        const left = text.x - (text.align === 'center' ? text.width / 2 : text.align === 'right' ? text.width : 0);
        assert.ok(left >= -1 && left + text.width <= viewport.width + 1, label + ' text fits: ' + text.text);
      }
    }
  }
});

test('multi-head job sprites freeze with real progress, and upgraded old one-portion batches retain their amount', async () => {
  const data = await fixtures;
  const cases = data.cases.filter(item => item.configuration === 'old-batch' || item.configuration === 'mixed' || ['waiting', 'running', 'blocked'].includes(item.configuration));
  for (const item of cases) {
    const view = enriched(item), { renderer, canvas, draws, ui } = render(view, viewports[0]);
    const heads = () => copy(draws.filter(draw => /^machine_(pop|cup|ship)_head$/.test(draw.id)));
    const first = heads(); draws.length = 0;
    renderer.draw(view, ui, .7);
    assert.deepEqual(heads(), first, item.id + ': wall-clock effects cannot animate idle/frozen production heads');
    for (const station of view.stations) {
      const machine = renderer.scene.diagnostics.machines.find(machine => machine.stationId === station.id);
      assert.deepEqual(machine.jobs.map(contract), station.jobs.filter(Boolean).map(contract), item.id + ': no inferred maximum batch amount');
    }
    assert.equal(canvas.depth(), 0);
  }
  for (const item of data.cases.filter(item => item.configuration === 'old-batch')) {
    const jobs = item.save.stations[item.stationId].jobs;
    item.oldJobs.forEach((job, lane) => { if (job?.remainingTicks > 0) assert.deepEqual(jobs[lane], job); });
    assert.ok(jobs.some(job => job && job.amount < item.newBatchSize));
  }
});

test('real 4/24/36 transfer capacities and full-input rejection stay visible and conserve stock', async () => {
  const data = await fixtures;
  for (const [id, amount] of [['g1-first-tray', 4], ['g1-regular-tray', 24], ['g1-expanded-tray', 36]]) {
    assert.equal(data.cases.find(item => item.id === id).snapshot.transfers[0].batchSize, amount);
  }
  const full = data.cases.find(item => item.id === 'g1-boundary-input-full');
  for (const source of ['pop', 'cup']) {
    const target = source === 'pop' ? 'cup' : 'ship';
    const game = new Game({ mode: 'v15', save: full.save, now: full.save.savedAt });
    const inventory = copy(game.state);
    const claim = game.reserveTransfer(source);
    if (claim.ok) assert.equal(game.commitTransfer(claim.token).amount, 0);
    assert.deepEqual(game.state, inventory, 'full input cannot remove or sell source stock');
    const { renderer, canvas } = render(enriched(full), viewports[0], { transfer: { source, target, amount: 4, x: 150, y: 300, dragging: true, overTarget: true } });
    assert.equal(renderer.scene.diagnostics.transfers[source === 'pop' ? 0 : 1].legal, false);
    assert.ok(canvas.texts.some(item => item.text === '已满'));
  }
  // Continuous-pointer and host-lifecycle cancellation are covered by the v1.1
  // input suite; art consumes only the resulting released presentation state.
});

test('failed six-generation art has visible recovery and retains selectable machine ownership', async () => {
  const item = (await fixtures).cases.find(item => item.id === 'g6-upgraded');
  const { renderer, canvas } = render(enriched(item), viewports[0], {}, 'machine_cup_hex_body');
  assert.ok(canvas.texts.some(item => item.text.includes('美术失败')));
  const retry = renderer.zones.find(zone => zone.action === 'retry-art');
  assert.ok(retry && retry.w >= 44 && retry.h >= 44);
  assert.equal(renderer.actionAt(retry.x + retry.w / 2, retry.y + retry.h / 2), 'retry-art');
  const cup = renderer.scene.stationFrames.find(frame => frame.id === 'cup');
  assert.equal(renderer.actionAt(cup.x + cup.w / 2, cup.y + cup.h / 2), 'station:cup');
});

test('six-generation acceptance tooling remains outside both formal runtime packages', () => {
  for (const target of ['web', 'build/douyin']) {
    const bundle = fs.readFileSync(path.resolve(__dirname, '..', target, 'game.bundle.js'), 'utf8');
    assert.ok(!bundle.includes('__IAA_SIX_ACCEPTANCE_INPUT__') && !bundle.includes('/__six/capture/'));
    assert.ok(!fs.existsSync(path.resolve(__dirname, '..', target, 'tools/six-gen-acceptance.mjs')));
  }
});

test('all warehouse fill boundaries remain bounded, entry covers reflect purchases, and the tower shares one authored transform', async () => {
  const data = await fixtures;
  for (const row of data.warehouseMatrix) {
    const item = data.cases.find(item => item.id === row.fixture);
    const { renderer } = render(enriched(item), viewports[0]);
    const bin = renderer.scene.diagnostics.buffers.find(bin => bin.id === row.warehouse);
    assert.equal(bin.amount, row.actual.amount);
    assert.equal(bin.capacity, row.actual.capacity);
    if (row.generation >= 3) {
      assert.ok(bin.representativeCount <= bin.representativeLimit);
      assert.equal(bin.representativeCount === 0, row.amount === 'empty');
      if (row.amount === 'one') assert.equal(bin.representativeCount, 1);
    }
  }
  for (const item of data.cases.filter(item => item.configuration === 'entry' && item.save.machine > 0)) {
    const { renderer } = render(enriched(item), viewports[0]);
    for (const machine of renderer.scene.diagnostics.machines) {
      const actual = item.snapshot.stations.find(station => station.id === machine.stationId);
      assert.equal(machine.slots.filter(slot => slot.installed).length, actual.lanes);
      for (const slot of machine.slots) assert.equal(slot.coverVisible, !slot.installed);
    }
  }
  const final = data.cases.find(item => item.id === 'g6-complete');
  const { renderer, canvas } = render(enriched(final), viewports[1]);
  const tower = renderer.scene.diagnostics.decorations.filter(layer => layer.id.startsWith('factory_tower_'));
  assert.equal(tower.length, 2); assert.deepEqual(tower[0].transform, tower[1].transform);
  assert.ok(tower.every(layer => layer.behindMachines));
  assert.ok(canvas.texts.some(item => item.text.includes('六代工厂已建成')));
});

test('settled multi-portion shipments paint closed box markers without crediting a second sale', async () => {
  const item = (await fixtures).cases.find(item => item.id === 'g6-upgraded');
  const game = new Game({ mode: 'v15', save: item.save, now: item.save.savedAt });
  game.tick(1);
  const events = game.drainEvents(), shipment = events.find(event => event.type === 'ship');
  assert.ok(shipment.amount >= 4);
  const before = game.exportSave(item.save.savedAt);
  const view = new ProductionInsights().enrich(game.getView());
  const { renderer, draws, ui } = render(view, viewports[0]);
  renderer.emit(shipment); draws.length = 0;
  renderer.draw(view, ui, .1);
  assert.ok(draws.some(draw => draw.id === 'product_box_lid'));
  assert.equal(renderer.scene.delivery.coins, shipment.coins);
  assert.deepEqual(game.exportSave(item.save.savedAt), before);
});
