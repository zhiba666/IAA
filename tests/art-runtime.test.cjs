'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createArtAssets } = require('../src/art-assets');
const { ART_ASSETS, ART_RIGS, ART_RUNTIME_IDS, ART_GENERATION_RIGS, ART_SIX_GEN } = require('../src/art-manifest');
const { V13_ART_ASSETS, V13_ART_IDS } = require('../src/v13-art-manifest');
const { V13_SCENE_ART_ASSETS, V13_SCENE_ART_IDS } = require('../src/v13-scene-art-manifest');
const { createArtTransform, artSpriteTransform, artSourcePoint, drawArtLayer, clipArtPolygon, minimumHitRect, drawNineSlice } = require('../src/art-layout');

test('the same uniform transform maps image crops, sprite points, assembly ports, clips and hit rectangles', () => {
  const rig = ART_RIGS.popMachine, asset = ART_ASSETS.machine_pop_body, layer = rig.layers[0];
  const transform = createArtTransform({ x: 30, y: 100, scale: 0.24 });
  assert.deepEqual(transform.inversePoint(transform.point(rig.output)), rig.output);
  const sprite = artSpriteTransform(asset, layer, transform);
  const operations = [];
  const ctx = { save() {}, restore() {}, drawImage(...args) { operations.push(args); },
    beginPath() {}, moveTo(...args) { operations.push(args); }, lineTo(...args) { operations.push(args); }, closePath() {}, clip() {} };
  const img = {};
  const crop = [20, 30, 80, 90];
  assert.equal(drawArtLayer(ctx, { machine_pop_body: img }, layer, transform, { crop }), true);
  assert.deepEqual(operations[0], [img, ...crop, ...sprite.rect(crop)]);
  assert.deepEqual(artSourcePoint(asset, layer, transform, asset.sourceRect.slice(0, 2)), sprite.point([0, 0]));
  assert.ok(Math.abs(sprite.rect([0, 0, asset.width, asset.height])[2] / asset.width - sprite.scale) < 1e-12);
  clipArtPolygon(ctx, rig.contentClip, transform);
  assert.deepEqual(operations[1], transform.point(rig.contentClip[0]));
  const hit = minimumHitRect(transform.rect([0, 0, 40, 80]), 44, [0, 0, 390, 844]);
  assert.deepEqual(hit.slice(2), [44, 44]);
  const child = transform.child({ x: 20, y: 30, scale: 0.5 });
  child.point([12, 14]).forEach((value, index) => assert.ok(Math.abs(value - transform.point([26, 37])[index]) < 1e-10));
  const mirrored = artSpriteTransform(asset, { ...layer, flipX: true }, transform);
  const full = sprite.rect([0, 0, asset.width, asset.height]);
  assert.ok(Math.abs(mirrored.point([20, 30])[0] - (full[0] + full[2] - 20 * sprite.scale)) < 1e-10);
  assert.ok(Math.abs(mirrored.inversePoint(mirrored.point([20, 30]))[0] - 20) < 1e-10);
  assert.throws(() => createArtTransform({ x: NaN }), /positive uniform scale/);
});

test('browser and native image hosts decode the exact local runtime set once with actionable failures', async () => {
  for (const native of [false, true]) {
    const requests = [];
    class Image {
      set src(value) {
        requests.push(value);
        const asset = Object.values(ART_ASSETS).find(entry => entry.path === value);
        this.width = asset.width; this.height = asset.height;
        queueMicrotask(() => this.onload());
      }
    }
    const art = createArtAssets({ root: native ? { tt: { createImage: () => new Image() } } : { Image } });
    const [first, second] = await Promise.all([art.loadAll(), art.loadAll()]);
    assert.equal(first.loaded, ART_RUNTIME_IDS.length); assert.equal(first.failed, 0);
    assert.deepEqual(first, second); assert.equal(requests.length, ART_RUNTIME_IDS.length);
    assert.ok(art.get('machine_pop_body'));
  }
  const missing = createArtAssets({ root: {} });
  const unavailable = await missing.loadAll();
  assert.equal(unavailable.failed, ART_RUNTIME_IDS.length);
  assert.match(unavailable.entries[0].error, /unavailable/);
  const broken = createArtAssets({ ids: ['machine_pop_body'], createImage: () => ({
    set src(value) { queueMicrotask(() => this.onerror()); }
  }) });
  assert.equal((await broken.loadAll()).failed, 1);
  assert.equal(broken.get('machine_pop_body'), null);
});

test('nine-slice preserves fixed corners while stretching only blank panel centers and edges', () => {
  const calls = [], image = {};
  const ctx = { drawImage(...args) { calls.push(args); } };
  assert.equal(drawNineSlice(ctx, { ui_panel: image }, 'ui_panel', [4, 8, 300, 200], { border: 11 }), true);
  assert.equal(calls.length, 9);
  assert.deepEqual(calls[0], [image, 0, 0, ART_ASSETS.ui_panel.sourceBorder, ART_ASSETS.ui_panel.sourceBorder, 4, 8, 11, 11]);
  assert.deepEqual(calls[4].slice(5), [15, 19, 278, 178]);
});

test('both production build roots contain exactly the referenced independent PNGs, unchanged', async () => {
  const root = path.resolve(__dirname, '..');
  for (const target of ['web', 'build/douyin']) {
    const files = [];
    function walk(directory) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file); else files.push(path.relative(path.join(root, target), file).replaceAll('\\', '/'));
    } }
    walk(path.join(root, target, 'assets/art'));
    const packagedAssets = [...ART_RUNTIME_IDS.map(id => ART_ASSETS[id]), ...V13_ART_IDS.map(id => V13_ART_ASSETS[id]),
      ...V13_SCENE_ART_IDS.map(id => V13_SCENE_ART_ASSETS[id])];
    assert.deepEqual(files.sort(), packagedAssets.map(asset => asset.path).sort());
    for (const asset of packagedAssets) {
      assert.deepEqual(fs.readFileSync(path.join(root, target, asset.path)), fs.readFileSync(path.join(root, asset.sourcePath)), target + ': ' + asset.id);
    }
  }
  const reviewed = JSON.parse(fs.readFileSync(path.join(root, 'art-source/six-gen/integration/manifest.json')));
  const supplement = JSON.parse(fs.readFileSync(path.join(root, 'art-source/v1.1/manifest.fragment.json')));
  assert.equal(reviewed.assets.length, 84);
  assert.equal(ART_RUNTIME_IDS.length, 87);
  assert.deepEqual(ART_RUNTIME_IDS.slice().sort(), [...reviewed.assets, ...supplement.assets].map(entry => entry.id).sort());
  assert.ok(!ART_RUNTIME_IDS.some(id => /preview|source/.test(id)));
  assert.equal(ART_RIGS.shipMachine.content.packageRigs, undefined);
  assert.equal(ART_GENERATION_RIGS.length, 18);
  assert.ok(ART_SIX_GEN.packaging.doubleTray && ART_SIX_GEN.packaging.fourCupBox);
  assert.ok(ART_SIX_GEN.scene.tower.layers.some(layer => layer.id === 'factory_tower_front'));
  const { readRuntimeArt, ART_BUDGETS } = await import('../tools/art-build.mjs');
  const data = await readRuntimeArt(root);
  assert.equal(data.entries.length, ART_RUNTIME_IDS.length);
  assert.equal(data.totals.compressedBytes, ART_RUNTIME_IDS.reduce((sum, id) => sum + ART_ASSETS[id].bytes, 0));
  for (const [key, limit] of Object.entries(ART_BUDGETS)) assert.ok(data.totals[key] <= limit, key);
});
