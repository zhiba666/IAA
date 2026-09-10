'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Game, CONFIG } = require('../src/core');
const { canvasHarness, deepFreeze } = require('./canvas-harness.cjs');

const fixtureData = import(pathToFileURL(path.resolve(__dirname, '../tools/visual-acceptance.mjs')).href)
  .then(module => module.createVisualFixtures());
const copy = value => JSON.parse(JSON.stringify(value));
const contract = job => job ? { amount: job.amount, progress: job.progress, complete: job.complete } : null;

function createScene() {
  const { FirstGenerationScene } = require('../src/first-generation-scene');
  const { ART_ASSETS } = require('../src/art-manifest');
  const canvas = canvasHarness(), draws = [], images = {};
  canvas.ctx.globalAlpha = 1;
  canvas.ctx.drawImage = (image, ...args) => {
    assert.ok(image && image.id, 'runtime paint resolves an explicit art asset');
    assert.ok(args.every(Number.isFinite), 'sprite source/destination coordinates are finite');
    draws.push({ id: image.id, args });
  };
  const assets = { get(id) {
    assert.ok(ART_ASSETS[id], 'every painted sprite belongs to the compiled art manifest: ' + id);
    return images[id] || (images[id] = { id, width: ART_ASSETS[id].width, height: ART_ASSETS[id].height });
  } };
  return { canvas, draws, scene: new FirstGenerationScene(canvas.ctx, assets) };
}

function paint(scene, snapshot, width = 390) {
  scene.draw(8, 104, width - 16, width === 390 ? 480 : 300, snapshot);
  assert.equal(scene.diagnostics.machines.length, 3);
  for (const station of snapshot.stations) {
    const machine = scene.diagnostics.machines.find(item => item.stationId === station.id);
    assert.ok(machine, 'one machine binds the real ' + station.id + ' station');
    assert.deepEqual(machine.jobs.map(contract), station.jobs.filter(Boolean).map(contract), 'art retains every actual job and batch amount without inventing a waiting job');
  }
}

test('visual fixtures validate through the real save contract and distinguish natural stock from the double-full boundary', async () => {
  const data = await fixtureData;
  assert.equal(data.cases.length, 6);
  for (const item of data.cases) {
    const original = JSON.stringify(item.save), game = new Game({ save: item.save, now: item.save.savedAt });
    assert.equal(game.loadWarning, null, item.id);
    assert.deepEqual(game.getView(), item.snapshot);
    assert.equal(JSON.stringify(item.save), original, 'fixture restore cannot mutate its input');
    assert.equal(game.state.machine, 0);
  }
  const full = data.cases.find(item => item.id === 'pop-full');
  assert.equal(full.kind, 'natural-production');
  assert.equal(full.snapshot.buffers.find(buffer => buffer.id === 'pop').amount, 12);
  const boundary = data.cases.find(item => item.id === 'both-full-boundary');
  assert.equal(boundary.kind, 'conserved-visual-boundary');
  assert.equal(boundary.boundaryOnly, true);
  assert.match(boundary.description, /cannot naturally/);
});

test('first-generation PNG heads and job contents stop on a frozen real snapshot, including shortage and completed blocked batches', async () => {
  const data = await fixtureData;
  for (const id of ['fresh-shortage', 'pop-full', 'upgraded-shortage', 'both-full-boundary']) {
    const item = data.cases.find(fixture => fixture.id === id);
    const snapshot = deepFreeze(copy(item.snapshot)), original = JSON.stringify(snapshot);
    const { scene, canvas, draws } = createScene();
    paint(scene, snapshot);
    const heads = () => draws.filter(call => /^machine_(pop|cup|ship)_head$/.test(call.id));
    const firstHeads = copy(heads()), firstJobs = copy(scene.diagnostics.machines.map(machine => machine.jobs));
    assert.equal(firstHeads.length, 3, 'three real first-generation work heads are visible');
    draws.length = 0;
    for (let i = 0; i < 7; i++) scene.update(.1);
    paint(scene, snapshot);
    assert.deepEqual(heads(), firstHeads, id + ': presentation time cannot manufacture processing progress');
    assert.deepEqual(scene.diagnostics.machines.map(machine => machine.jobs), firstJobs, id + ': blocked and waiting jobs are unchanged');
    assert.equal(JSON.stringify(snapshot), original, 'drawing and effects leave authoritative state untouched');
    assert.equal(canvas.depth(), 0, 'layer and clip saves remain balanced');
  }
});

test('the first cup purchase preserves the old job artwork and duration until its real completion boundary', async () => {
  const data = await fixtureData;
  const before = data.cases.find(item => item.id === 'first-cup-before');
  const after = data.cases.find(item => item.id === 'first-cup-after');
  assert.deepEqual(after.save.stations.cup.jobs[0], before.save.stations.cup.jobs[0]);
  assert.deepEqual(after.save.stations.cup.jobs[0], { amount: 1, durationTicks: 60, remainingTicks: 18 });
  const { scene, canvas } = createScene();
  paint(scene, deepFreeze(copy(before.snapshot)), 320);
  const jobBefore = copy(scene.diagnostics.machines.find(machine => machine.stationId === 'cup').jobs[0]);
  for (const event of after.events) scene.emit(event);
  scene.update(.1); paint(scene, deepFreeze(copy(after.snapshot)), 320);
  const jobAfter = scene.diagnostics.machines.find(machine => machine.stationId === 'cup').jobs[0];
  assert.deepEqual(jobAfter, jobBefore, 'installation feedback cannot replace or reset the in-flight cup');
  const game = new Game({ save: after.save, now: after.save.savedAt });
  game.tick(17 / CONFIG.ticksPerSecond);
  assert.equal(game.state.stations.cup.jobs[0].durationTicks, 60);
  assert.equal(game.state.stations.cup.jobs[0].remainingTicks, 1);
  game.tick(1 / CONFIG.ticksPerSecond);
  assert.equal(game.state.stations.cup.jobs[0].durationTicks, 20, 'only the following batch uses the purchased speed');
  assert.equal(canvas.depth(), 0);
});

test('first-generation shipment animation aggregates only settled real receipts and cannot credit money or clear stock', () => {
  const game = new Game({ now: 1800000000000 }); game.tick(20); game.drainEvents();
  const receipts = [];
  for (let i = 0; i < 8; i++) { game.tick(.25); receipts.push(...game.drainEvents().filter(event => event.type === 'ship')); }
  const expected = receipts.reduce((sum, event) => ({ amount: sum.amount + event.amount, coins: sum.coins + event.coins }), { amount: 0, coins: 0 });
  assert.ok(expected.amount > 0);
  const original = game.exportSave(1800000000000), snapshot = deepFreeze(game.getView());
  const { scene, canvas } = createScene();
  for (const receipt of receipts) scene.emit(deepFreeze(receipt));
  scene.update(.01); paint(scene, snapshot);
  assert.equal(scene.delivery.amount, expected.amount);
  assert.equal(scene.delivery.coins, expected.coins);
  assert.deepEqual(game.exportSave(1800000000000), original, 'receipts cannot perform a second settlement');
  scene.update(2); paint(scene, snapshot);
  assert.equal(scene.delivery, null, 'departed goods do not persist as phantom inventory');
  assert.deepEqual(game.exportSave(1800000000000), original);
  assert.equal(canvas.depth(), 0);
});
