'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { V13OrderScene, orderSceneAssetIds, orderSceneEnvironmentAssetIds } = require('../src/v13-order-scene');
const { V13OrderGame } = require('../src/v13-order-core');
const { V13_ART_ASSETS } = require('../src/v13-art-manifest');
const { V13_SCENE_ART_ASSETS, V13_SCENE_ART_IDS } = require('../src/v13-scene-art-manifest');
const { ART_ASSETS, ART_RIGS } = require('../src/art-manifest');
const { canvasHarness, deepFreeze } = require('./canvas-harness.cjs');

const ports = [
  { width: 320, height: 524 }, { width: 390, height: 844 }, { width: 430, height: 932 },
  { width: 320, height: 524, safeTop: 24, safeBottom: 34, safeLeft: 8, safeRight: 8, menuBottom: 75 },
  { width: 390, height: 844, safeTop: 47, safeBottom: 34, menuButton: { bottom: 91 } }
];
function produce(game, target) {
  let steps = 0;
  while (game.getView().finished.stock.original < target && steps++ < 1000) {
    game.tick(.25);
    for (const source of ['pop', 'cup']) { const hold = game.beginTransfer(source); if (hold.ok) game.commitTransfer(hold.token); }
  }
  assert.ok(steps < 1000);
}
function render(view, scene, viewport, additions, missing) {
  const canvas = canvasHarness(), drawn = [], draws = [], factoryBoxes = [], clips = [];
  const beginPath = canvas.ctx.beginPath, canvasRect = canvas.ctx.rect, clip = canvas.ctx.clip;
  let pathRect = null;
  canvas.ctx.beginPath = function () { pathRect = null; return beginPath.apply(this, arguments); };
  canvas.ctx.rect = function (x, y, w, h) { pathRect = { x, y, w, h }; return canvasRect.apply(this, arguments); };
  canvas.ctx.clip = function () { if (pathRect) clips.push({ ...pathRect }); return clip.apply(this, arguments); };
  const draw = canvas.ctx.drawImage;
  canvas.ctx.drawImage = function () {
    drawn.push(arguments[0].id);
    draws.push({ id: arguments[0].id, rect: Array.from(arguments).slice(-4) });
    draw.apply(this, arguments);
  };
  const legacy = { get(id) { assert.ok(ART_ASSETS[id], id); return missing ? null : { id }; }, report() { return { failed: missing ? 1 : 0 }; } };
  const art = { get(id) { assert.ok(V13_ART_ASSETS[id], id); return missing ? null : { id }; }, report() { return { failed: missing ? 1 : 0 }; } };
  const sceneArt = { get(id) { assert.ok(V13_SCENE_ART_ASSETS[id], id); return missing ? null : { id }; }, report() { return { failed: missing ? 1 : 0 }; } };
  const renderer = new V13OrderScene({ canvas: { getContext: () => canvas.ctx }, art: legacy, v13Art: art, sceneArt });
  const factoryBox = renderer.factoryScene.box;
  renderer.factoryScene.box = function (x, y, w, h) {
    factoryBoxes.push({ x, y, w, h });
    return factoryBox.apply(this, arguments);
  };
  const ui = deepFreeze(Object.assign({ scene, viewport: viewport || ports[0] }, additions || {}));
  deepFreeze(view); const before = JSON.stringify({ view, ui });
  const diagnostics = renderer.draw(view, ui, .016);
  assert.equal(JSON.stringify({ view, ui }), before, 'paint never mutates simulation or gestures');
  assert.equal(canvas.depth(), 0);
  const safe = diagnostics.layout.safe;
  for (const zone of renderer.zones) {
    assert.ok(zone.w >= 44 && zone.h >= 44, zone.action + ' has a full touch target');
    assert.ok(zone.x >= safe.x && zone.y >= safe.y && zone.x + zone.w <= safe.x + safe.w + .01 && zone.y + zone.h <= safe.y + safe.h + .01, zone.action + ' fits safe area');
  }
  for (const entry of canvas.texts) {
    const left = entry.x - (entry.align === 'center' ? entry.width / 2 : entry.align === 'right' ? entry.width : 0);
    assert.ok(left >= -.01 && left + entry.width <= ui.viewport.width + .01, entry.text + ' fits horizontally');
  }
  return { renderer, diagnostics, canvas, drawn, draws, factoryBoxes, clips, text: canvas.texts.map(item => item.text).join('|') };
}

test('factory and store fit short, tall, safe-area and missing-art phones with reachable controls', () => {
  const game = new V13OrderGame({ now: 0 }); produce(game, 8);
  const first = game.getView().orders[0], hold = game.beginDelivery(); game.deliver(hold.token, first.id);
  for (const viewport of ports) for (const missing of [false, true]) for (const scene of ['factory', 'store']) {
    const actions = new Set();
    for (const scroll of [0, 60, 120, 10000]) {
      const result = render(game.getView(), scene, viewport, { scroll }, missing);
      result.renderer.zones.forEach(zone => actions.add(zone.action));
      assert.equal(result.renderer.zones.some(zone => zone.action === 'retry-art'), missing);
      assert.ok(!result.renderer.zones.some(zone => /upgrade|boost|evolve|purchase/.test(zone.action)));
      assert.ok(result.diagnostics.sprites.every(sprite => sprite.available === !missing));
      if (viewport === ports[0] && !missing && !scroll) assert.equal(result.diagnostics.layout.content.scrollMax, 0);
    }
    assert.ok(actions.has('scene:factory') && actions.has('scene:store'));
    if (scene === 'factory') for (const action of ['transfer-source-pop', 'transfer-source-cup', 'transfer-target-cup', 'transfer-target-ship']) assert.ok(actions.has(action), action + ' reachable');
    else for (const order of game.getView().orders) {
      assert.ok(actions.has('order:' + order.id)); assert.ok(actions.has('cancel-order:' + order.id));
    }
  }
});

test('factory restores the authored room, workstations, stock trays and connected production line', () => {
  const game = new V13OrderGame({ now: 0 }); produce(game, 8);
  const view = game.getView();
  const inside = (item, outer) => item.x >= outer.x - .01 && item.y >= outer.y - .01
    && item.x + item.w <= outer.x + outer.w + .01 && item.y + item.h <= outer.y + outer.h + .01;
  for (const viewport of ports.concat({ width: 1707, height: 920 })) {
    const { renderer, diagnostics, drawn, draws } = render(view, 'factory', viewport);
    const factory = diagnostics.factoryScene, content = diagnostics.layout.content;
    assert.equal(factory.layout, 'fullscreen-workstations');
    assert.deepEqual(factory.machines.map(machine => machine.stationId), ['pop', 'cup', 'ship']);
    assert.deepEqual(factory.buffers.map(buffer => [buffer.id, buffer.amount]), view.buffers.map(buffer => [buffer.id, buffer.amount]));
    for (const name of ['popMachine', 'cupMachine', 'shipMachine', 'bulkBuffer', 'cupsBuffer', 'conveyorOutfeed']) {
      for (const layer of ART_RIGS[name].layers) assert.ok(drawn.includes(layer.id), name + ' retains ' + layer.id);
    }
    const floor = draws.find(item => item.id === 'factory_floor_extension');
    const wall = draws.find(item => item.id === 'factory_wall_corner');
    assert.ok(floor && wall, 'the factory retains its original floor and wall corner');
    assert.ok(floor.rect[0] <= 0 && floor.rect[1] <= 0 && floor.rect[0] + floor.rect[2] >= viewport.width && floor.rect[1] + floor.rect[3] >= viewport.height, 'floor covers the viewport');
    assert.ok(Math.abs(wall.rect[3] / wall.rect[2] - ART_ASSETS.factory_wall_corner.height / ART_ASSETS.factory_wall_corner.width) < 1e-6, 'wall keeps its authored proportions');
    for (const machine of factory.machines) {
      const [x, y, w, h] = machine.rect;
      assert.ok(inside({ x, y, w, h }, content), machine.stationId + ' stays inside the interaction area');
    }
    assert.deepEqual(factory.connections.map(link => [link.from, link.to]), [
      ['pop', 'bulk'], ['bulk', 'cup'], ['input-cup', 'cup'],
      ['cup', 'cups'], ['cups', 'ship'], ['input-ship', 'ship'], ['ship', 'outfeed']
    ]);
    for (const source of ['pop', 'cup']) {
      const target = source === 'pop' ? 'cup' : 'ship', bufferId = source === 'pop' ? 'bulk' : 'cups';
      const machine = factory.machines.find(item => item.stationId === source);
      const inputMachine = factory.machines.find(item => item.stationId === target);
      const outputLink = factory.connections.find(item => item.from === source && item.to === bufferId);
      const inputLink = factory.connections.find(item => item.from === 'input-' + target);
      assert.deepEqual(outputLink.fromPoint, machine.ports.output, 'output line meets the machine port');
      assert.deepEqual(inputLink.toPoint, inputMachine.ports.input, 'input line meets the machine port');
      const tray = renderer.transferFrames.find(item => item.source === source && item.kind === 'tray');
      const buffer = factory.buffers.find(item => item.id === source), [x, y, w, h] = buffer.rect;
      assert.ok(inside({ x, y, w, h }, tray), 'the visible stock tray owns its drag target');
    }
  }
});

test('restored factory drop highlights and final receivers agree for both routes across safe and wide viewports', () => {
  const game = new V13OrderGame({ now: 0 });
  game.tick(40);
  const first = game.reserveTransfer('pop'); assert.ok(first.ok); game.commitTransfer(first.token);
  game.tick(10);
  for (const source of ['pop', 'cup']) {
    const hold = game.reserveTransfer(source); assert.ok(hold.ok);
    const view = game.getView();
    for (const viewport of ports.concat({ width: 1707, height: 920 })) {
      const base = render(view, 'factory', viewport), frames = base.renderer.transferFrames;
      assert.equal(frames.length, 4, 'both original drag routes remain available');
      const target = frames.find(item => item.source === source && item.kind === 'input');
      const wrong = frames.find(item => item.source !== source && item.kind === 'input');
      const tray = frames.find(item => item.source === source && item.kind === 'tray');
      const points = [
        [target.x + target.w / 2, target.y + target.h / 2, true],
        [target.x + 1, target.y + 1, true],
        [target.x + target.w - 1, target.y + target.h - 1, true],
        [target.x - 10, target.y + target.h / 2, true],
        [target.x - 13, target.y + target.h / 2, false],
        [wrong.x + wrong.w / 2, wrong.y + wrong.h / 2, false],
        [tray.x + tray.w / 2, tray.y + tray.h / 2, false]
      ];
      for (const [x, y, expected] of points) {
        const result = render(view, 'factory', viewport, { transfer: { ...hold, source, x, y, dragging: true } });
        const receiver = result.renderer.transferTargetAt(x, y, source);
        const highlight = result.diagnostics.factoryScene.transfers.find(item => item.source.source === source);
        assert.equal(!!receiver, expected, source + ' accepts only its own physical input at ' + x + ',' + y + ' on ' + viewport.width + 'x' + viewport.height);
        assert.equal(highlight.overTarget, !!receiver, 'visible drop feedback agrees with final reception');
        assert.deepEqual(result.renderer.transferFrames, frames, 'holding a tray keeps factory coordinates stable');
      }
      const full = { ...view, transfers: view.transfers.map(item => item.source === source ? { ...item, inputAmount: item.inputCapacity } : item) };
      const x = target.x + target.w / 2, y = target.y + target.h / 2;
      const blocked = render(full, 'factory', viewport, { transfer: { ...hold, source, x, y, dragging: true } });
      assert.equal(blocked.renderer.transferTargetAt(x, y, source), null);
      assert.equal(blocked.diagnostics.factoryScene.transfers.find(item => item.source.source === source).overTarget, false, 'full inputs never show a valid drop');
    }
    game.cancelTransfer(hold.token);
  }
});

test('the last factory label and its backplate remain fully visible above shared inventory', () => {
  const view = new V13OrderGame({ now: 0 }).getView();
  for (const viewport of ports.concat({ width: 1707, height: 920 })) for (const missing of [false, true]) {
    const result = render(view, 'factory', viewport, {}, missing);
    const paintClip = result.renderer.factoryScene.paintClip, stock = result.diagnostics.layout.stock;
    assert.ok(paintClip, 'factory exposes its drawing clip');
    assert.ok(result.clips.some(item => ['x', 'y', 'w', 'h'].every(key => Math.abs(item[key] - paintClip[key]) < .01)), 'Canvas uses the factory drawing clip');
    assert.ok(paintClip.y + paintClip.h <= stock.y + .01, 'factory painting stays above inventory');
    const label = result.canvas.texts.find(item => /^包装入库/.test(item.text));
    assert.ok(label, 'the packaging workstation retains its visible label');
    const size = Number(label.font.match(/([\d.]+)px/)[1]);
    const plate = result.factoryBoxes.find(item => Math.abs(item.x + item.w / 2 - label.x) < .01
      && Math.abs(item.y + item.h / 2 - label.y) < .01 && item.w >= label.width && item.h >= size);
    assert.ok(plate, 'the label retains its actual painted backplate');
    assert.ok(label.y - size / 2 >= paintClip.y + 1 && label.y + size / 2 <= paintClip.y + paintClip.h - 1 + .01, 'packaging text has room inside the drawing clip');
    assert.ok(plate.y >= paintClip.y + 1 && plate.y + plate.h <= paintClip.y + paintClip.h - 1 + .01, 'the whole backplate has at least one pixel of room below it');
    assert.ok(label.x - label.width / 2 >= paintClip.x && label.x + label.width / 2 <= paintClip.x + paintClip.w, 'packaging text remains horizontally visible');
    assert.ok(plate.x >= paintClip.x && plate.x + plate.w <= paintClip.x + paintClip.w, 'the backplate remains horizontally visible');
  }
});

test('real packaging inventory is shared between scenes and does not display a sale', () => {
  const game = new V13OrderGame({ now: 0 });
  const empty = render(game.getView(), 'store');
  assert.equal(empty.diagnostics.inventory.representativeProducts, 0);
  produce(game, 8);
  for (const scene of ['factory', 'store']) {
    const result = render(game.getView(), scene);
    assert.deepEqual(result.diagnostics.inventory.stock, 8);
    assert.equal(result.diagnostics.inventory.available, 8);
    assert.match(result.text, /金币 0/);
    assert.match(result.text, /包装只入库，拖给顾客才收款/);
    assert.doesNotMatch(result.text, /成交|售出|销售|赚到|出货/);
  }
  const hold = game.beginDelivery(), order = game.getView().orders[0];
  const held = render(game.getView(), 'store');
  assert.equal(held.diagnostics.inventory.held, hold.amount);
  assert.equal(held.diagnostics.inventory.available, 8 - hold.amount);
  game.deliver(hold.token, order.id);
  const sold = render(game.getView(), 'store', ports[1], { message: '订单成交，收入 ' + order.quote + ' 金币' });
  assert.match(sold.text, new RegExp('金币 ' + order.quote));
  assert.match(sold.text, /订单成交/);
  assert.equal(sold.diagnostics.orders.length, 2);
});

test('each customer card binds demand, reserved stock and fixed reward to its exact order id', () => {
  const game = new V13OrderGame({ now: 0 }); produce(game, 8);
  let view = game.getView(), hold = game.beginDelivery(); game.deliver(hold.token, view.orders[0].id);
  view = game.getView();
  const result = render(view, 'store');
  assert.deepEqual(result.diagnostics.orders.map(order => [order.id, order.demand, order.reserved, order.quote]), view.orders.map(order => [order.id, order.items.original, order.reserved.original, order.quote]));
  for (const frame of result.renderer.orderFrames) {
    assert.equal(result.renderer.actionAt(frame.x + frame.w / 2, frame.y + frame.h / 2), 'order:' + frame.orderId);
    assert.equal(result.renderer.deliveryTargetAt(frame.x + frame.w / 2, frame.y + frame.h / 2).orderId, frame.orderId);
    const cancel = result.renderer.zones.find(zone => zone.action === 'cancel-order:' + frame.orderId);
    assert.equal(result.renderer.deliveryTargetAt(cancel.x + 22, cancel.y + 22), null, 'cancel corner is not a drop target');
    for (const x of [cancel.x, cancel.x + 22, cancel.x + 44]) for (const y of [cancel.y, cancel.y + 22, cancel.y + 44]) {
      assert.equal(result.renderer.deliveryTargetAt(x, y), null, 'the whole cancellation control rejects delivery');
    }
  }
  assert.ok(result.drawn.includes('product_original_cup'));
  assert.ok(result.drawn.includes('order_pickup_bag'));
});

test('delivery ghost previews the target allocation and never invents a larger delivery', () => {
  const game = new V13OrderGame({ now: 0 }); produce(game, 8);
  let hold = game.beginDelivery(); game.deliver(hold.token, game.getView().orders[0].id);
  hold = game.beginDelivery(); game.deliver(hold.token, game.getView().orders[0].id);
  const view = game.getView(), base = render(view, 'store'), target = base.renderer.orderFrames.find(frame => frame.remaining < 4);
  assert.ok(target, 'partial order needs fewer than one full drag');
  const result = render(view, 'store', ports[0], { delivery: { amount: 4, x: target.x + target.w / 2, y: target.y + target.h / 2, dragging: true } });
  assert.equal(result.diagnostics.ghost.amount, 4);
  assert.equal(result.diagnostics.ghost.previewAmount, target.remaining);
  assert.equal(result.diagnostics.ghost.targetId, target.orderId);
  assert.match(result.text, new RegExp('交 ' + target.remaining));
});

test('factory inputs use actual free capacity and unfinished filling retains the original layers', () => {
  const game = new V13OrderGame({ now: 0 }), view = game.getView();
  view.stations[1].jobs = [{ amount: 1, progress: .75, complete: false }];
  view.stations[1].progress = .75; view.stations[1].inFlight = 1;
  view.transfers[0].inputAmount = view.transfers[0].inputCapacity;
  const result = render(view, 'factory');
  const blocked = result.renderer.transferFrames.find(frame => frame.source === 'pop' && frame.kind === 'input');
  assert.equal(blocked.accepting, false);
  assert.equal(result.renderer.transferTargetAt(blocked.x + 1, blocked.y + 1, 'pop'), null);
  assert.ok(result.drawn.includes('product_cup_empty') && result.drawn.includes('product_cup_fill'));
  assert.ok(!result.drawn.includes('product_original_cup'), 'unfinished cups and empty warehouse contain no finished-product art');
  assert.equal(result.diagnostics.machines[1].progress, .75);
  assert.deepEqual(result.diagnostics.machines[1].jobs, view.stations[1].jobs);
});

test('bad-save recovery offers a read retry and optional art selection remains below 4 MiB', () => {
  const result = render(new V13OrderGame({ now: 0 }).getView(), 'store', ports[0], { recoveryBlocked: true, saveError: 'bad existing save' });
  assert.ok(result.renderer.zones.some(zone => zone.action === 'reload-save'));
  assert.ok(!result.renderer.zones.some(zone => /retry-save|reset|overwrite/.test(zone.action)));
  assert.match(result.text, /重试读取/);
  for (const scene of ['factory', 'store']) {
    const ids = orderSceneAssetIds(scene), decoded = ids.reduce((sum, id) => sum + V13_ART_ASSETS[id].decodedBytes, 0);
    assert.equal(ids.length, new Set(ids).size);
    assert.ok(decoded <= 4 * 1024 * 1024);
  }
});

test('desktop keeps the game centered at a readable width and the product glyph starts delivery', () => {
  const game = new V13OrderGame({ now: 0 }); produce(game, 4);
  const result = render(game.getView(), 'store', { width: 1707, height: 920 });
  const safe = result.diagnostics.layout.safe, stock = result.diagnostics.layout.stock;
  assert.equal(safe.w, 520);
  assert.equal(safe.x + safe.w / 2, 1707 / 2);
  assert.equal(result.renderer.actionAt(stock.x + 31, stock.y + 40), 'delivery:original');
});

test('courtyard assets remain independent, cover the view, and preserve customer/counter depth', () => {
  const game = new V13OrderGame({ now: 0 }); produce(game, 8);
  const first = game.getView().orders[0], hold = game.beginDelivery(); game.deliver(hold.token, first.id);
  for (const viewport of ports) {
    const result = render(game.getView(), 'store', viewport);
    assert.deepEqual(result.diagnostics.environmentAssetIds, V13_SCENE_ART_IDS);
    const background = result.diagnostics.sprites.find(sprite => sprite.id === 'scene_direct_sales_courtyard');
    assert.equal(background.fit, 'cover');
    assert.ok(background.rect.x <= 0 && background.rect.y <= 0);
    assert.ok(background.rect.x + background.rect.w >= viewport.width && background.rect.y + background.rect.h >= viewport.height);
    assert.equal(result.drawn.filter(id => id === 'scene_direct_sales_courtyard').length, 1);
    assert.ok(result.drawn.indexOf('customer_neighbor') < result.drawn.indexOf('scene_pickup_counter'));
    assert.ok(result.drawn.indexOf('customer_family') < result.drawn.indexOf('scene_pickup_counter'));
    assert.ok(result.drawn.indexOf('scene_pickup_counter') < result.drawn.indexOf('order_pickup_bag'));
    assert.ok(result.drawn.indexOf('buffer_cups_rack_back') < result.drawn.indexOf('buffer_cups_rack_front'));
    assert.equal(result.diagnostics.courtyard.customerCount, 2);
    const counter = result.diagnostics.courtyard.counter;
    for (const order of result.diagnostics.orders) {
      assert.ok(order.bag.x >= counter.x && order.bag.x + order.bag.w <= counter.x + counter.w, 'pickup bags stay on the uniformly fitted countertop');
      assert.ok(order.bag.y < counter.y && order.bag.y + order.bag.h > counter.y, 'countertop supports each bag');
    }
  }
  assert.deepEqual(orderSceneEnvironmentAssetIds('factory'), []);
  assert.deepEqual(render(game.getView(), 'factory').diagnostics.environmentAssetIds, []);
  assert.ok(orderSceneAssetIds('store').every(id => !V13_SCENE_ART_IDS.includes(id)));
});

test('pickup bag products and shelf slots follow actual reservations and available inventory', () => {
  const game = new V13OrderGame({ now: 0 }); produce(game, 8);
  let hold = game.beginDelivery(); game.deliver(hold.token, game.getView().orders[0].id);
  hold = game.beginDelivery(); game.deliver(hold.token, game.getView().orders[0].id);
  const view = game.getView(), result = render(view, 'store', ports[1]);
  assert.ok(view.orders.some(order => order.reserved.original > 0));
  assert.deepEqual(result.diagnostics.orders.map(order => order.bagProducts), view.orders.map(order => order.reserved.original > 0 ? 1 : 0));
  assert.equal(result.drawn.filter(id => id === 'order_pickup_bag').length, 2 + 2 * view.orders.filter(order => order.reserved.original > 0).length, 'bag front wall and near handle redraw over its contents');
  assert.equal(result.diagnostics.inventory.representativeProducts, Math.min(view.finished.available.original, 6));
  const empty = render(new V13OrderGame({ now: 0 }).getView(), 'store');
  const back = empty.drawn.indexOf('buffer_cups_rack_back'), front = empty.drawn.indexOf('buffer_cups_rack_front');
  assert.deepEqual(empty.drawn.slice(back + 1, front), [], 'empty stock never invents shelf products');
});

test('a scene-only image failure offers retry without disabling real order interaction', () => {
  const canvas = canvasHarness(), scene = new V13OrderScene({
    ctx: canvas.ctx,
    art: { get: id => ({ id }) }, v13Art: { get: id => ({ id }) },
    sceneArt: { get: () => null, report: () => ({ failed: 1 }) }
  });
  scene.draw(new V13OrderGame({ now: 0 }).getView(), { scene: 'store', viewport: ports[0] });
  assert.ok(scene.zones.some(zone => zone.action === 'retry-art'));
  assert.ok(scene.orderFrames.some(frame => frame.accepting));
  scene.draw(new V13OrderGame({ now: 0 }).getView(), { scene: 'factory', viewport: ports[0] });
  assert.ok(!scene.zones.some(zone => zone.action === 'retry-art'), 'unused scene failures do not obscure the factory');
});
