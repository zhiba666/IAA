'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createV13ArtAssets, V13_ART_BUDGET_BYTES } = require('../src/v13-art-assets');
const { V13_ART_ASSETS, V13_ART_IDS } = require('../src/v13-art-manifest');
const { createArtAssets } = require('../src/art-assets');
const { ART_ASSETS, ART_RUNTIME_IDS } = require('../src/art-manifest');

const assets = {
  a: { path: 'a.png', width: 16, height: 12 },
  b: { path: 'b.png', width: 20, height: 24 },
  c: { path: 'c.png', width: 32, height: 32 }
};

function harness(extraAssets) {
  const catalog = { ...assets, ...extraAssets }, images = [], timers = new Map(), clearedTimers = [];
  let timerId = 0;
  const root = {
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { clearedTimers.push(id); timers.delete(id); }
  };
  function createImage() {
    const image = { src: '', succeed(width, height) {
      const asset = Object.values(catalog).find(entry => entry.path === this.src);
      this.width = width === undefined ? asset.width : width;
      this.height = height === undefined ? asset.height : height;
      if (this.onload) this.onload();
    }, fail() { if (this.onerror) this.onerror(); } };
    images.push(image);
    return image;
  }
  return { catalog, images, timers, clearedTimers, root, createImage,
    art: createV13ArtAssets({ assets: catalog, root, createImage }) };
}

test('selection deduplicates IDs and concurrent calls, and retains loaded and pending intersections', async () => {
  const { art, images } = harness();
  const first = art.select(['a', 'a', 'b']);
  assert.equal(art.select(['b', 'a']), first);
  assert.equal(images.length, 2);
  images[0].succeed();
  const retained = art.get('a');
  const second = art.select(['a', 'b', 'c']);
  assert.equal(images.length, 3);
  assert.equal(art.get('a'), retained);
  images[1].succeed(); images[2].succeed();
  await Promise.all([first, second]);
  assert.equal(art.report().loaded, 3);
  assert.equal(art.report().pending, 0);
  assert.equal(art.report().complete, true);
  assert.equal(art.report().decodedBytes, (16 * 12 + 20 * 24 + 32 * 32) * 4);
  assert.equal(art.report().budgetBytes, 4 * 1024 * 1024);
  assert.equal(art.get('a'), retained);
  assert.ok(art.report().entries.every(entry => !Object.hasOwn(entry, 'image')));
});

test('page changes release loaded and pending images; stale load/error/timeout callbacks cannot restore them', async () => {
  const { art, images, timers } = harness();
  const first = art.select(['a', 'b']);
  images[0].succeed();
  const staleLoad = images[1].onload, staleError = images[1].onerror, staleTimeout = [...timers.values()][0];
  const second = art.select(['c']);
  assert.equal(images[0].src, ''); assert.equal(images[1].src, '');
  assert.equal(images[1].onload, null); assert.equal(images[1].onerror, null);
  assert.equal(timers.size, 1);
  staleLoad(); staleError(); staleTimeout();
  assert.equal(art.get('a'), null); assert.equal(art.get('b'), null);
  assert.equal(art.report().requested, 1); assert.equal(art.report().pending, 1);
  await first;
  images[2].succeed(); await second;
  assert.equal(art.report().loaded, 1);
  const third = art.select(['b']);
  staleLoad(); staleError(); staleTimeout();
  assert.equal(art.get('b'), null);
  assert.equal(art.report().pending, 1);
  images[3].succeed(); await third;
  assert.equal(art.get('b'), images[3]);
  assert.equal(timers.size, 0);
});

test('retry recovers only failed images and deduplicates simultaneous retries', async () => {
  const { art, images } = harness();
  const first = art.select(['a', 'b']);
  images[0].succeed(); images[1].fail(); await first;
  const loaded = art.get('a');
  assert.equal(art.report().failed, 1);
  assert.equal(images[1].src, '');
  await art.select(['a', 'b']);
  assert.equal(images.length, 2);
  const retry = art.retryFailed();
  assert.equal(art.retryFailed(), retry);
  assert.equal(art.select(['b', 'a']), retry);
  assert.equal(images.length, 3);
  images[2].succeed();
  assert.equal((await retry).failed, 0);
  assert.equal(art.report().loaded, 2);
  assert.equal(art.get('a'), loaded);
});

test('dimension mismatch and timeout fail cleanly and can be retried', async () => {
  const { art, images, timers } = harness();
  const first = art.select(['a', 'b']);
  images[0].succeed(15, 12);
  const timeout = [...timers.values()][0];
  timeout();
  const result = await first;
  assert.equal(result.failed, 2); assert.equal(result.complete, true);
  assert.match(result.entries[0].error, /dimensions disagree/);
  assert.match(result.entries[1].error, /timed out/);
  assert.equal(art.get('a'), null); assert.equal(art.get('b'), null);
  assert.equal(timers.size, 0);
  const retry = art.retryFailed();
  images[2].succeed(); images[3].succeed(); await retry;
  assert.equal(art.report().loaded, 2);
});

test('unknown IDs and over-budget selections allocate nothing and leave the current collection intact', async () => {
  const { art, images } = harness({ huge: { path: 'huge.png', width: 1024, height: 1024 },
    bad: { path: 'bad.png', width: 0, height: 1 } });
  const initial = art.select(['a']); images[0].succeed(); await initial;
  const before = art.report(), image = art.get('a');
  for (const [selection, pattern] of [
    [['a', 'missing'], /unknown/], [['toString'], /unknown/], [['huge', 'a'], /budget/], [['bad'], /dimensions/], [null, /array/]
  ]) {
    await assert.rejects(art.select(selection), pattern);
    assert.deepEqual(art.report(), before);
    assert.equal(art.get('a'), image);
    assert.equal(images.length, 1);
  }
  const boundary = art.select(['huge']);
  assert.equal(art.report().decodedBytes, V13_ART_BUDGET_BYTES);
  assert.equal(images[0].src, '');
  images[1].succeed(); await boundary;
  assert.equal(art.report().loaded, 1);
});

test('dispose settles outstanding selections, clears host resources, and rejects further loads', async () => {
  const { art, images, timers } = harness();
  const pending = art.select(['a']);
  const staleLoad = images[0].onload, staleTimeout = [...timers.values()][0];
  art.dispose(); art.dispose(); staleLoad(); staleTimeout();
  const result = await pending;
  assert.equal(result.requested, 0); assert.equal(result.decodedBytes, 0); assert.equal(result.complete, true);
  assert.equal(images[0].src, ''); assert.equal(timers.size, 0); assert.equal(art.get('a'), null);
  await assert.rejects(art.select(['a']), /disposed/);
  await assert.rejects(art.retryFailed(), /disposed/);
  assert.equal(images.length, 1);
});

test('browser Image and native tt.createImage load manifest metadata while the legacy 87-image loader stays independent', async () => {
  const shopIds = ['product_original_cup', 'product_caramel_tub', 'customer_neighbor', 'customer_family',
    'clerk_vendor', 'shop_front', 'order_pickup_bag', 'ui_order_ticket'];
  for (const native of [false, true]) {
    const requests = [];
    class Image {
      set src(value) {
        if (!value) return;
        requests.push(value);
        const asset = [...Object.values(ART_ASSETS), ...Object.values(V13_ART_ASSETS)].find(entry => entry.path === value);
        this.width = asset.width; this.height = asset.height;
        queueMicrotask(() => { if (this.onload) this.onload(); });
      }
    }
    const root = native ? { tt: { createImage: () => new Image() } } : { Image };
    const legacy = createArtAssets({ root }), art = createV13ArtAssets({ root });
    const [oldReport, newReport] = await Promise.all([legacy.loadAll(), art.select(shopIds)]);
    assert.equal(ART_RUNTIME_IDS.length, 87);
    assert.equal(oldReport.loaded, 87); assert.equal(oldReport.failed, 0);
    assert.equal(newReport.loaded, 8); assert.equal(requests.length, 95);
    assert.equal(newReport.decodedBytes, 3853824);
    await assert.rejects(art.select(V13_ART_IDS), /budget/);
    assert.equal(requests.length, 95);
    assert.equal(art.report().loaded, 8);
    const legacyImage = legacy.get('machine_pop_body');
    await art.select([]);
    assert.equal(art.report().requested, 0);
    assert.equal(legacy.get('machine_pop_body'), legacyImage);
    assert.equal(legacy.report().loaded, 87);
    const legacyBytes = ART_RUNTIME_IDS.reduce((sum, id) => sum + ART_ASSETS[id].decodedBytes, 0);
    assert.ok(legacyBytes + V13_ART_BUDGET_BYTES < 32 * 1024 * 1024);
  }
  const missing = createV13ArtAssets({ root: {} });
  const result = await missing.select(['ui_order_ticket']);
  assert.equal(result.failed, 1); assert.match(result.entries[0].error, /unavailable/);
});
