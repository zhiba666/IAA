'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createArtAssets } = require('../src/art-assets');
const { ART_ASSETS } = require('../src/art-manifest');

test('retry recovers failed art without decoding successful images again or duplicating requests', async () => {
  const ids = ['machine_pop_body', 'machine_cup_body'];
  const requests = new Map();
  const art = createArtAssets({ ids, createImage: () => ({
    set src(path) {
      requests.set(path, (requests.get(path) || 0) + 1);
      const asset = Object.values(ART_ASSETS).find(item => item.path === path);
      this.width = asset.width; this.height = asset.height;
      queueMicrotask(() => path === ART_ASSETS.machine_cup_body.path && requests.get(path) === 1 ? this.onerror() : this.onload());
    }
  }) });
  const first = await art.loadAll();
  assert.equal(first.loaded, 1); assert.equal(first.failed, 1);
  const retained = art.get(ids[0]);
  const recovery = art.retryFailed();
  const concurrent = art.retryFailed();
  await Promise.all([recovery, concurrent]);
  assert.equal(art.report().loaded, 2); assert.equal(art.report().failed, 0);
  assert.equal(art.get(ids[0]), retained);
  assert.equal(requests.get(ART_ASSETS.machine_pop_body.path), 1);
  assert.equal(requests.get(ART_ASSETS.machine_cup_body.path), 2);
});
