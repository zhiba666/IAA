'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { V13Showroom, V13_PRODUCTS, showroomAssetIds } = require('../src/v13-showroom');
const { V13_ART_ASSETS } = require('../src/v13-art-manifest');
const { ART_ASSETS, ART_RUNTIME_IDS, ART_SIX_GEN } = require('../src/art-manifest');
const { Renderer } = require('../src/renderer');
const { canvasHarness, deepFreeze } = require('./canvas-harness.cjs');

const ports = [
  { width: 320, height: 524 }, { width: 390, height: 844 }, { width: 430, height: 932 },
  { width: 320, height: 524, safeTop: 24, safeBottom: 34, safeLeft: 8, safeRight: 8, menuBottom: 75 },
  { width: 390, height: 844, safeTop: 47, safeBottom: 34, menuButton: { bottom: 91 } }
];

function render(viewport, modal, missing = false) {
  const canvas = canvasHarness(), readIds = [], draws = [], clipStack = [];
  const failures = typeof missing === 'object' ? missing : {};
  const legacyFailed = new Set(missing === true ? ART_RUNTIME_IDS : failures.legacyFailed || []);
  const legacyPending = new Set(failures.legacyPending || []);
  const v13Failed = new Set(missing === true ? Object.keys(V13_ART_ASSETS) : failures.v13Failed || []);
  const drawThrows = new Set(failures.drawThrows || []);
  let clips = [], path = [];
  // Record the real Canvas clip stack as well as image order. This catches a
  // correct-looking diagnostics list with a missing or leaked runtime mask.
  for (const name of ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'rect', 'clip', 'drawImage']) {
    const original = canvas.ctx[name];
    canvas.ctx[name] = function (...args) {
      if (name === 'drawImage' && drawThrows.has(args[0].id)) throw new Error('image cannot be drawn');
      original.apply(this, args);
      if (name === 'save') clipStack.push(clips.slice());
      if (name === 'restore') clips = clipStack.pop();
      if (name === 'beginPath') path = [];
      if (name === 'moveTo' || name === 'lineTo') path.push(args.slice());
      if (name === 'rect') { const [x,y,w,h] = args; path.push([x,y],[x+w,y],[x+w,y+h],[x,y+h]); }
      if (name === 'clip') clips = clips.concat([path.slice()]);
      if (name === 'drawImage') draws.push({ id: args[0].id, rect: args.slice(5), clips: clips.slice() });
    };
  }
  const legacy = {
    get(id) { assert.ok(ART_ASSETS[id], id); return legacyFailed.has(id) || legacyPending.has(id) ? null : { id }; },
    report() { return { failed: legacyFailed.size, entries: [...legacyFailed].map(id => ({ id, status: 'failed' })).concat([...legacyPending].map(id => ({ id, status: 'loading' }))) }; }
  };
  const art = { get(id) { assert.ok(V13_ART_ASSETS[id], id); readIds.push(id); return v13Failed.has(id) ? null : { id }; }, report() { return { failed: v13Failed.size }; } };
  const renderer = new Renderer(canvas.ctx, legacy), showroom = new V13Showroom(renderer, art);
  const view = deepFreeze({ state: { coins: 20, machine: 5, inventory: { original: 4 } }, orders: [{ id: 1, count: 2 }] });
  const ui = deepFreeze({ viewport, modal: Object.assign({ type: 'showroom', scroll: 0 }, modal) });
  const before = JSON.stringify({ view, ui }), diagnostics = showroom.draw(view, ui, .016);
  assert.equal(JSON.stringify({ view, ui }), before, 'the showroom never mutates simulation or input state');
  assert.equal(canvas.depth(), 0, 'Canvas state stack is balanced');
  for (const zone of renderer.zones) {
    assert.ok(zone.x >= 0 && zone.y >= 0 && zone.x + zone.w <= viewport.width + .01 && zone.y + zone.h <= viewport.height + .01, zone.action + ' is inside the viewport');
    if (zone.action !== 'modal-body') assert.ok(zone.w >= 44 && zone.h >= 44, zone.action + ' meets touch size');
  }
  for (const entry of canvas.texts) {
    const left = entry.x - (entry.align === 'center' ? entry.width / 2 : entry.align === 'right' ? entry.width : 0);
    assert.ok(left >= -.01 && left + entry.width <= viewport.width + .01, 'text fits horizontally: ' + entry.text);
  }
  assert.deepEqual(renderer.interface.layout.modal, diagnostics.layout, 'shared modal layout drives existing touch scrolling');
  assert.ok(readIds.every(id => diagnostics.assetIds.includes(id)), 'only the selected optional assets are read');
  return { renderer, showroom, canvas, diagnostics, draws, text: canvas.texts.map(item => item.text).join('|') };
}

test('all v1.3 art is reachable with a bounded decoded asset selection', () => {
  const covered = new Set();
  for (const tab of ['products', 'process', 'store']) for (let generation = 1; generation <= 6; generation++) {
    const ids = showroomAssetIds(tab, generation);
    assert.ok(ids.includes('product_original_cup') && ids.includes('ui_order_ticket'));
    assert.equal(ids.length, new Set(ids).size);
    const decoded = ids.reduce((sum, id) => { assert.ok(V13_ART_ASSETS[id], id); covered.add(id); return sum + V13_ART_ASSETS[id].width * V13_ART_ASSETS[id].height * 4; }, 0);
    assert.ok(decoded <= 4 * 1024 * 1024, tab + ' generation ' + generation + ': ' + decoded);
  }
  assert.deepEqual([...covered].sort(), Object.keys(V13_ART_ASSETS).sort());
  assert.equal(covered.size, 18);
  assert.deepEqual(showroomAssetIds('unexpected', NaN), showroomAssetIds('products', 1));
  assert.deepEqual(showroomAssetIds('process', 900), showroomAssetIds('process', 6));
});

test('every tab fits short, tall and safe-area viewports with available and missing art', () => {
  for (const viewport of ports) for (const missing of [false, true]) for (const tab of ['products', 'process', 'store']) {
    for (const generation of tab === 'process' ? [1, 2, 3, 4, 5, 6] : [1]) {
      const result = render(viewport, { tab, generation }, missing), layout = result.diagnostics.layout;
      const minimumTop = Math.max(viewport.safeTop || 0, viewport.menuBottom || 0, viewport.menuButton && viewport.menuButton.bottom || 0);
      assert.ok(layout.y >= minimumTop);
      assert.ok(layout.y + layout.h <= viewport.height - (viewport.safeBottom || 0));
      assert.ok(result.renderer.zones.some(zone => zone.action === 'close'));
      for (const id of ['products', 'process', 'store']) assert.ok(result.renderer.zones.some(zone => zone.action === 'showroom-tab:' + id));
      const retryAction = tab === 'store' || tab === 'process' && generation === 1 ? 'retry-art' : 'retry-v13-art';
      assert.equal(result.renderer.zones.some(zone => zone.action === retryAction), missing);
      assert.ok(result.diagnostics.sprites.length > 0);
      assert.ok(result.diagnostics.sprites.every(sprite => sprite.available !== missing));
      assert.ok(!result.renderer.zones.some(zone => /purchase:|transfer-|station:/.test(zone.action)));
    }
  }
});

test('product catalogue scrolling keeps every generation reachable and clips partial tap targets', () => {
  for (const viewport of ports) {
    const actions = new Set(), sprites = new Set();
    for (const scroll of [0, 60, 120, 180, 240, 300, 360, 420, 10000]) {
      const result = render(viewport, { tab: 'products', scroll }), content = result.diagnostics.layout.content;
      for (const sprite of result.diagnostics.sprites) if (sprite.id.startsWith('product_')) sprites.add(sprite.id);
      for (const zone of result.renderer.zones.filter(item => item.action.startsWith('showroom-product:'))) {
        actions.add(zone.action);
        assert.ok(zone.y >= content.y && zone.y + zone.h <= content.y + content.h + .01);
      }
    }
    for (let generation = 1; generation <= 6; generation++) assert.ok(actions.has('showroom-product:' + generation), 'generation ' + generation + ' reachable');
    assert.deepEqual([...sprites].sort(), V13_PRODUCTS.map(item => item.id).sort());
  }
});

test('process pages preserve present/future status and generation boundaries', () => {
  for (let generation = 1; generation <= 6; generation++) {
    const result = render(ports[1], { tab: 'process', generation });
    assert.ok(result.text.includes(generation === 1 ? '原味工艺 · 现有产品' : '新品工艺 · 筹备中'));
    assert.equal(result.renderer.zones.some(zone => zone.action === 'showroom-generation:' + (generation - 1)), generation > 1);
    assert.equal(result.renderer.zones.some(zone => zone.action === 'showroom-generation:' + (generation + 1)), generation < 6);
    for (const product of V13_PRODUCTS.filter(item => item.generation === generation)) assert.ok(result.diagnostics.sprites.some(sprite => sprite.id === product.id && sprite.available));
    assert.equal(result.diagnostics.sprites.some(sprite => sprite.legacy), generation === 1);
    assert.ok(!result.text.includes('金币') && !result.text.includes('解锁'));
  }
});

test('store presents separate product and character rows without simulated sales', () => {
  const result = render(ports[1], { tab: 'store' }), sprites = result.diagnostics.sprites;
  assert.ok(result.text.includes('工厂直售 · 筹备中'));
  const people = sprites.filter(item => /clerk_|customer_/.test(item.id));
  const products = sprites.filter(item => /product_|pickup_bag/.test(item.id));
  const shop = sprites.find(item => item.id === 'shop_front');
  assert.equal(people.length, 3);
  assert.equal(products.filter(item => item.id.startsWith('product_')).length, 5, 'two shelf samples, one packed sample and two readable legends');
  assert.ok(result.text.includes('原味 / 焦糖样品') && result.text.includes('取货示意'));
  for (const product of products) assert.ok(product.rect.y >= shop.rect.y + shop.rect.h);
  for (const person of people) for (const product of products) assert.ok(person.rect.y >= product.rect.y + product.rect.h);
  assert.ok(!/金币|订单数量|售出|库存|件|缺货/.test(result.text));
});

test('store samples reuse the authored rack anchors, content mask and foreground order', () => {
  const rig = ART_SIX_GEN.logistics.rigs.find(item => item.id === 'cups_rack');
  for (const viewport of ports) {
    const { draws, diagnostics } = render(viewport, { tab: 'store', scroll: 100 });
    const backIndex = draws.findIndex(item => item.id === 'buffer_cups_rack_back');
    const frontIndex = draws.findIndex(item => item.id === 'buffer_cups_rack_front');
    const back = draws[backIndex], front = draws[frontIndex], scale = back.rect[2] / rig.size[0];
    assert.ok(backIndex >= 0 && frontIndex > backIndex);
    assert.deepEqual(front.rect, back.rect, 'shared foreground keeps the original coordinate space');
    assert.ok(Math.abs(back.rect[3] - rig.size[1] * scale) < .00001, 'the rack is scaled uniformly');
    const samples = draws.slice(backIndex + 1, frontIndex);
    assert.deepEqual(samples.map(item => item.id), ['product_original_cup', 'product_caramel_tub']);
    for (const [index, sample] of samples.entries()) {
      const slot = rig.content.slots[index ? 2 : 0], [x,y,w,h] = sample.rect;
      assert.ok(Math.abs(x + w / 2 - (back.rect[0] + (slot[0] + slot[2] / 2) * scale)) < .00001, 'sample remains centered at its authored shelf slot');
      assert.ok(Math.abs(y + h - (back.rect[1] + (slot[1] + slot[3]) * scale)) < .00001, 'sample rests on its authored shelf slot');
      assert.equal(sample.clips.length, 2, 'the sample has viewport and content masks');
      assert.deepEqual(sample.clips[1], rig.contentClip.map(point => [back.rect[0] + point[0] * scale, back.rect[1] + point[1] * scale]));
    }
    assert.equal(back.clips.length, 1); assert.equal(front.clips.length, 1, 'content clipping never cuts the shelf itself');
    for (const id of ['buffer_cups_rack_back', 'buffer_cups_rack_front']) {
      assert.ok(ART_RUNTIME_IDS.includes(id), 'rack art already belongs to the shared runtime selection');
      assert.ok(!diagnostics.assetIds.includes(id), 'rack art adds no optional decoded selection');
    }
  }
});

test('store retains readable product images and names alongside the compact shelf samples', () => {
  for (const viewport of ports) {
    const top = render(viewport, { tab: 'store' });
    const legends = top.diagnostics.sprites.filter(sprite => sprite.id.startsWith('product_') && sprite.rect.w >= 70 && sprite.rect.h >= 70);
    assert.deepEqual(legends.map(sprite => sprite.id), ['product_original_cup', 'product_caramel_tub'], 'each shelf product also has a readable image');
    assert.ok(top.text.includes('经典原味') && top.text.includes('琥珀焦糖'));
    const result = render(viewport, { tab: 'store', scroll: legends[0].rect.y - top.diagnostics.layout.content.y });
    const content = result.diagnostics.layout.content;
    for (const sprite of result.diagnostics.sprites.filter(sprite => sprite.id.startsWith('product_') && sprite.rect.w >= 70 && sprite.rect.h >= 70)) {
      assert.ok(sprite.rect.y >= content.y && sprite.rect.y + sprite.rect.h <= content.y + content.h, 'product image is fully reachable');
    }
    for (const label of result.canvas.texts.filter(item => item.text === '经典原味' || item.text === '琥珀焦糖')) {
      assert.ok(label.y >= content.y && label.y + 6 <= content.y + content.h, 'product name remains visible with the image');
    }
  }
});

function containsPoint(polygon, point) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

test('pickup sample is between the intact bag and its masked near wall and handle', () => {
  for (const viewport of ports) {
    const { draws } = render(viewport, { tab: 'store' });
    const bagIndex = draws.findIndex(item => item.id === 'order_pickup_bag');
    const [bag, sample, wall, handle] = draws.slice(bagIndex, bagIndex + 4);
    assert.deepEqual([bag.id, sample.id, wall.id, handle.id], ['order_pickup_bag', 'product_original_cup', 'order_pickup_bag', 'order_pickup_bag']);
    assert.deepEqual(wall.rect, bag.rect); assert.deepEqual(handle.rect, bag.rect);
    assert.equal(bag.clips.length, 1, 'the original bag and empty mouth stay intact');
    assert.equal(sample.clips.length, 1); assert.equal(wall.clips.length, 2); assert.equal(handle.clips.length, 2);
    const [x,y,w,h] = sample.rect, wallMask = wall.clips[1];
    assert.ok(!containsPoint(wallMask, [x + w / 2, y + h * .1]), 'popcorn protrudes above the front rim');
    assert.ok(containsPoint(wallMask, [x + w / 2, y + h * .9]), 'bag body occludes the lower cup');
    assert.ok(x > bag.rect[0] && x + w < bag.rect[0] + bag.rect[2], 'sample leaves the side opening visible');
    const firstPerson = draws.find(item => item.id === 'clerk_vendor');
    assert.equal(firstPerson.clips.length, 1, 'bag masks never leak into the character row');
  }
});

test('store rack and pickup samples remain reachable while short screens scroll to every character', () => {
  for (const viewport of ports) {
    const top = render(viewport, { tab: 'store' }), content = top.diagnostics.layout.content;
    const rack = top.diagnostics.sprites.find(item => item.id === 'buffer_cups_rack_back');
    const middle = render(viewport, { tab: 'store', scroll: rack.rect.y - content.y });
    for (const sprite of middle.diagnostics.sprites.filter(item => /rack_|product_|pickup_bag/.test(item.id))) {
      assert.ok(sprite.rect.y >= content.y && sprite.rect.y + sprite.rect.h <= content.y + content.h, sprite.id + ' is fully reachable');
    }
    const end = render(viewport, { tab: 'store', scroll: Number.MAX_SAFE_INTEGER });
    assert.equal(end.diagnostics.layout.scroll, content.scrollMax);
    for (const sprite of end.diagnostics.sprites.filter(item => /clerk_|customer_/.test(item.id))) {
      assert.ok(sprite.rect.y >= content.y && sprite.rect.y + sprite.rect.h <= content.y + content.h, sprite.id + ' is reachable at the bottom');
    }
    for (const label of end.canvas.texts.filter(item => /售货员|街角顾客|家庭采购客/.test(item.text))) {
      assert.ok(label.y >= content.y && label.y + 6 <= content.y + content.h, label.text + ' label is visible');
    }
    if (viewport.height <= 524) assert.ok(content.scrollMax > 0, 'short screens retain vertical scrolling');
  }
});

test('a failed shared rack foreground offers a reachable shared-art retry and releases its space after recovery', () => {
  for (const viewport of ports) {
    const failed = render(viewport, { tab: 'store', scroll: 10000 }, { legacyFailed: ['buffer_cups_rack_front'] });
    const retries = failed.renderer.zones.filter(zone => /^retry-/.test(zone.action));
    assert.equal(retries.length, 1); assert.equal(retries[0].action, 'retry-art');
    assert.ok(failed.text.includes('重新加载图片'));
    assert.ok(failed.diagnostics.sprites.find(sprite => sprite.id === 'buffer_cups_rack_back').available);
    assert.equal(failed.diagnostics.sprites.find(sprite => sprite.id === 'buffer_cups_rack_front').available, false);
    const content = failed.diagnostics.layout.content;
    assert.ok(content.y + content.h <= retries[0].y, 'retry remains outside the scrollable content');
    for (const person of failed.diagnostics.sprites.filter(sprite => /clerk_|customer_/.test(sprite.id))) {
      assert.ok(person.rect.y >= content.y && person.rect.y + person.rect.h <= content.y + content.h, 'characters remain reachable above retry');
    }
    const recovered = render(viewport, { tab: 'store', scroll: 10000 });
    assert.equal(recovered.renderer.zones.some(zone => /^retry-/.test(zone.action)), false);
    assert.equal(recovered.diagnostics.layout.content.h, content.h + 52, 'recovery restores the reserved footer space');
    assert.ok(recovered.diagnostics.sprites.find(sprite => sprite.id === 'buffer_cups_rack_front').available);
  }
});

test('shared-art retries only follow failures in the current showroom assembly', () => {
  const firstGeneration = render(ports[0], { tab: 'process', generation: 1 }, { legacyFailed: ['machine_pop_head'] });
  assert.ok(firstGeneration.renderer.zones.some(zone => zone.action === 'retry-art'), 'original machine assembly failures can be retried');
  for (const modal of [{ tab: 'products' }, { tab: 'process', generation: 2 }, { tab: 'process', generation: 1 }, { tab: 'store' }]) {
    const irrelevant = ['ui_icon_coin'];
    if (modal.tab !== 'store') irrelevant.push('buffer_cups_rack_front');
    if (modal.tab !== 'process' || modal.generation !== 1) irrelevant.push('machine_pop_head');
    const result = render(ports[0], modal, { legacyFailed: irrelevant });
    assert.equal(result.renderer.zones.some(zone => /^retry-/.test(zone.action)), false, JSON.stringify(modal) + ' ignores unrelated shared failures');
  }
  const pending = render(ports[0], { tab: 'store' }, { legacyPending: ['buffer_cups_rack_front'] });
  assert.equal(pending.renderer.zones.some(zone => /^retry-/.test(zone.action)), false, 'an asset still loading is not a failed asset');
  const both = render(ports[0], { tab: 'store' }, { legacyFailed: ['buffer_cups_rack_front'], v13Failed: ['order_pickup_bag'] });
  assert.deepEqual(both.renderer.zones.filter(zone => /^retry-/.test(zone.action)).map(zone => zone.action), ['retry-art'], 'one shared retry action retries both loaders');
});

test('a missing or undrawable pickup bag keeps the placeholder without a floating packed cup', () => {
  for (const failures of [{ v13Failed: ['order_pickup_bag'] }, { drawThrows: ['order_pickup_bag'] }]) {
    const result = render(ports[0], { tab: 'store', scroll: 100 }, failures);
    assert.equal(result.diagnostics.sprites.filter(sprite => sprite.id === 'product_original_cup').length, 2, 'the shelf sample and readable legend remain but no packed cup is attempted');
    const bags = result.diagnostics.sprites.filter(sprite => sprite.id === 'order_pickup_bag');
    assert.equal(bags.length, 1, 'no foreground bag passes are attempted'); assert.equal(bags[0].available, false);
    assert.ok(result.text.includes('待加载'), 'the missing bag has an explicit placeholder');
    assert.equal(result.draws.some(draw => draw.id === 'order_pickup_bag'), false);
    for (const person of result.draws.filter(draw => /clerk_|customer_/.test(draw.id))) assert.equal(person.clips.length, 1, 'failure does not leak an assembly clip');
    if (failures.v13Failed) assert.ok(result.renderer.zones.some(zone => zone.action === 'retry-v13-art'), 'optional-art failures keep the existing retry');
  }
});
