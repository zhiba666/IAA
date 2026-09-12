'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/core');
const { Renderer } = require('../src/renderer');
const { SixGenerationScene } = require('../src/six-generation-scene');
const { createArtTransform } = require('../src/art-layout');
const { ART_ASSETS } = require('../src/art-manifest');
const { V13_ART_ASSETS } = require('../src/v13-art-manifest');
const legacyModule = require('../src/art-assets');
const optionalModule = require('../src/v13-art-assets');
const { harness, START, copy } = require('./app-harness.cjs');
const { canvasHarness, deepFreeze } = require('./canvas-harness.cjs');

const homeIds = ['product_original_cup', 'ui_order_ticket'];
const productIds = ['product_original_cup', 'product_caramel_tub', 'product_cheese_carton', 'product_duo_bucket',
  'product_choco_cup', 'product_star_pop', 'product_celebration_box', 'ui_order_ticket'];
const storeIds = ['product_original_cup', 'ui_order_ticket', 'product_caramel_tub', 'shop_front',
  'clerk_vendor', 'customer_neighbor', 'customer_family', 'order_pickup_bag'];
const catalog = Object.values(ART_ASSETS).concat(Object.values(V13_ART_ASSETS));

function imageHost(fail = false) {
  return () => ({
    set src(value) {
      if (!value) return;
      const asset = catalog.find(item => item.path === value);
      assert.ok(asset, 'image request has manifest metadata: ' + value);
      this.id = asset.id; this.width = asset.width; this.height = asset.height;
      if (fail) this.onerror(); else this.onload();
    }
  });
}

function earnedSave() {
  const game = new Game({ mode: 'v15', now: START });
  for (let step = 0; step < 48; step++) {
    game.tick(.25);
    for (const source of ['pop', 'cup']) {
      const claim = game.reserveTransfer(source);
      if (claim.ok) assert.equal(game.commitTransfer(claim.token).ok, true);
    }
    game.drainEvents();
  }
  assert.ok(game.state.coins > 0 && game.state.totalSold > 0, 'fixture earns its stock and money through real production');
  return game.exportSave(START);
}

test('real main routes from the HUD through every showroom tab and releases selections without changing production state', async t => {
  const legacyInstances = [], optionalInstances = [];
  const createLegacy = legacyModule.createArtAssets, createOptional = optionalModule.createV13ArtAssets;
  t.mock.method(legacyModule, 'createArtAssets', options => {
    const art = createLegacy({ ...options, root: {}, createImage: imageHost() }); legacyInstances.push(art); return art;
  });
  t.mock.method(optionalModule, 'createV13ArtAssets', options => {
    const art = createOptional({ ...options, root: {}, createImage: imageHost() }); optionalInstances.push(art); return art;
  });
  const options = { config: { mode: 'v15' }, save: earnedSave(),
    info: { width: 390, height: 844, safeArea: { left: 0, top: 0, right: 390, bottom: 844 } } };
  const app = harness(options), control = harness(options);
  const art = optionalInstances[0], original = art.get('product_original_cup'), ticket = art.get('ui_order_ticket');
  const canvas = canvasHarness(), renderer = new Renderer(canvas.ctx, legacyInstances[0], art);
  canvas.ctx.globalAlpha = 1;
  assert.ok(renderer.scene instanceof SixGenerationScene);
  assert.equal(renderer.scene.v13Art, art); assert.equal(renderer.showroom.art, art);
  const initialState = app.snapshot().state;

  function paint() {
    canvas.clear();
    renderer.draw(deepFreeze(app.lastView()), deepFreeze(app.lastUI()), 0);
    assert.equal(canvas.depth(), 0);
  }
  function selection(expected, previous = []) {
    const report = copy(app.context.__POPCORN__.presentation().v13Art);
    assert.deepEqual(report.entries.map(item => item.id).sort(), expected.slice().sort());
    assert.equal(report.loaded, expected.length); assert.equal(report.pending, 0); assert.equal(report.failed, 0);
    assert.equal(report.decodedBytes, expected.reduce((sum, id) => sum + V13_ART_ASSETS[id].decodedBytes, 0));
    assert.ok(report.decodedBytes <= report.budgetBytes);
    for (const id of previous.filter(id => !expected.includes(id))) assert.equal(art.get(id), null, id + ' released after navigation');
    assert.equal(art.get('product_original_cup'), original, 'completed product stays resident');
    assert.equal(art.get('ui_order_ticket'), ticket, 'HUD ticket stays resident');
    assert.equal(legacyInstances[0].report().loaded, 87);
  }
  function clickPainted(action) {
    const zone = renderer.zones.find(item => item.action === action);
    assert.ok(zone, 'the actual renderer exposes ' + action);
    const x = zone.x + zone.w / 2, y = zone.y + zone.h / 2;
    assert.equal(renderer.actionAt(x, y), action, 'the visible control is the topmost input target');
    app.pointer('down', action, 1, x, y); app.pointer('up', action, 1, x, y);
    app.frame(200); control.frame(200);
    assert.deepEqual(app.snapshot().state, control.snapshot().state,
      'navigation does not create orders, change inventory or grant money beyond matching simulation frames');
    paint();
  }

  paint(); selection(homeIds);
  clickPainted('openShowroom');
  assert.equal(app.lastUI().modal.type, 'showroom'); assert.equal(app.lastUI().modal.tab, 'products');
  assert.equal(renderer.showroom.diagnostics.tab, 'products'); selection(productIds, homeIds);

  clickPainted('showroom-product:2');
  const caramelIds = homeIds.concat('product_caramel_tub', 'machine_caramel_coater');
  assert.equal(app.lastUI().modal.tab, 'process'); assert.equal(app.lastUI().modal.generation, 2);
  assert.ok(renderer.showroom.diagnostics.sprites.some(item => item.id === 'machine_caramel_coater' && item.available));
  selection(caramelIds, productIds);

  clickPainted('showroom-generation:3');
  const duoIds = homeIds.concat('product_cheese_carton', 'product_duo_bucket', 'machine_dual_flavor');
  assert.equal(app.lastUI().modal.generation, 3); selection(duoIds, caramelIds);
  clickPainted('showroom-tab:store');
  assert.equal(app.lastUI().modal.tab, 'store');
  assert.ok(renderer.showroom.diagnostics.sprites.some(item => item.id === 'shop_front' && item.available));
  selection(storeIds, duoIds);
  assert.equal(art.report().decodedBytes, 3853824);

  clickPainted('showroom-tab:products'); selection(productIds, storeIds);
  clickPainted('showroom-tab:process'); selection(duoIds, productIds);
  assert.equal(app.lastUI().modal.generation, 3);
  clickPainted('close');
  assert.equal(app.lastUI().modal, null); selection(homeIds, duoIds);
  assert.ok(renderer.zones.some(item => item.action === 'openShowroom'));
  assert.ok(app.snapshot().state.simulation.ticks > initialState.simulation.ticks, 'comparison includes naturally advancing frames');
  assert.deepEqual(app.snapshot(), control.snapshot(), 'all live production and derived order/economy views match the untouched control');
  assert.equal(app.analytics.filter(item => item.event === 'modal_open' && item.data.type === 'showroom').length, 1);
  assert.equal(app.analytics.filter(item => item.event === 'modal_close' && item.data.type === 'showroom').length, 1);
  await Promise.all(optionalInstances.map(instance => instance.select([])));
});

async function cupScene(failed = false) {
  const canvas = canvasHarness(), draws = [], clips = [];
  const clip = canvas.ctx.clip;
  canvas.ctx.clip = () => { clips.push(draws.length); clip(); };
  canvas.ctx.drawImage = (image, ...args) => {
    assert.ok(args.every(Number.isFinite)); draws.push({ id: image.id, args });
  };
  const legacy = { get(id) { assert.ok(ART_ASSETS[id], id); return { id }; } };
  const art = optionalModule.createV13ArtAssets({ root: {}, createImage: imageHost(failed) });
  await art.select(['product_original_cup']);
  const scene = new SixGenerationScene(canvas.ctx, legacy);
  scene.v13Art = art;
  return { scene, art, canvas, draws, clips };
}

test('the real six-generation scene paints finished cups with the v1.3 product at a uniform scale', async () => {
  const { scene, art, canvas, draws, clips } = await cupScene();
  const rect = deepFreeze([12, 18, 52, 68]), transform = createArtTransform({ x: 7, y: 11, scale: .75 });
  const before = copy(rect);
  for (const generation of [1, 3, 6]) {
    scene.generation = generation;
    scene.cupAt(rect, transform, 1);
    const draw = draws.at(-1), asset = V13_ART_ASSETS.product_original_cup;
    assert.equal(draw.id, 'product_original_cup');
    assert.deepEqual(draw.args.slice(0, 4), [0, 0, asset.width, asset.height]);
    assert.ok(Math.abs(draw.args[6] / asset.width - draw.args[7] / asset.height) < 1e-12);
  }
  assert.equal(draws.length, 3); assert.equal(clips.length, 0); assert.equal(canvas.depth(), 0);
  assert.deepEqual(rect, before);
  art.dispose();
});

test('cup filling keeps the old empty/fill layers and moving clipped fill until completion', async () => {
  const { scene, art, canvas, draws, clips } = await cupScene();
  const rect = [12, 18, 52, 68], transform = createArtTransform({ x: 7, y: 11, scale: .75 });
  scene.cupAt(rect, transform, 0);
  assert.deepEqual(draws.map(item => item.id), ['product_cup_empty']);
  assert.equal(clips.length, 0);
  draws.length = 0;
  scene.cupAt(rect, transform, .25);
  const early = copy(draws);
  assert.deepEqual(early.map(item => item.id), ['product_cup_empty', 'product_cup_fill']);
  draws.length = 0;
  scene.cupAt(rect, transform, .75);
  assert.deepEqual(draws.map(item => item.id), ['product_cup_empty', 'product_cup_fill']);
  assert.deepEqual(draws[0].args, early[0].args, 'empty cup stays fixed while filling');
  assert.ok(draws[1].args[5] < early[1].args[5], 'the fill rises with live production progress');
  assert.equal(clips.length, 2); assert.equal(canvas.depth(), 0);
  art.dispose();
});

test('failed or absent v1.3 product art falls back to the original completed cup layers', async () => {
  const { scene, art, canvas, draws, clips } = await cupScene(true);
  assert.equal(art.report().failed, 1);
  for (const optional of [art, null]) {
    scene.v13Art = optional; draws.length = 0;
    scene.cupAt([12, 18, 52, 68], createArtTransform(), 1);
    assert.deepEqual(draws.map(item => item.id), ['product_cup_empty', 'product_cup_fill']);
    assert.equal(canvas.depth(), 0);
  }
  assert.equal(clips.length, 2);
  art.dispose();
});
