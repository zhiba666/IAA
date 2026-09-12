'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/core');
const { V13OrderGame, MODE, SAVE_KEY, SAVE_VERSION, ORDER_RULES } = require('../src/v13-order-core');
const fresh = () => new V13OrderGame({ now: 0 });
const clone = value => JSON.parse(JSON.stringify(value));

function transfer(game, source) {
  const hold = game.beginTransfer(source);
  if (hold.ok) assert.equal(game.commitTransfer(hold.token).ok, true);
}
function produce(game, target) {
  let steps = 0;
  while (game.getView().finished.stock.original < target && steps++ < 1000) {
    assert.equal(game.tick(.25).ok, true);
    transfer(game, 'pop');
    transfer(game, 'cup');
  }
  assert.ok(steps < 1000, 'production should reach requested stock');
}
function firstSale(game) {
  produce(game, 4);
  const order = game.getView().orders[0], hold = game.beginDelivery('original');
  assert.equal(game.deliver(hold.token, order.id).settled, true);
  return order;
}
function checkConservation(game) {
  const view = game.getView(), state = game.state;
  const wip = ['pop', 'cup', 'ship'].reduce((sum, id) => sum + state.stations[id].jobs.reduce((n, job) => n + (job ? job.amount : 0), 0), 0);
  assert.equal(state.totalProduced, state.totalSold + view.finished.stock.original + state.buffers.pop
    + state.buffers.cup + state.inputs.cup + state.inputs.ship + wip);
  assert.equal(state.stations.ship.processed, state.totalSold + view.finished.stock.original);
  assert.equal(state.totalSold, view.orderLedger.sold);
  assert.equal(state.coins, view.orderLedger.earned);
  assert.equal(state.totalEarned, view.orderLedger.earned);
  assert.equal(view.finished.stock.original, view.finished.available.original + view.finished.reserved.original + view.finished.held.original);
  assert.ok(view.finished.stock.original <= view.finished.capacity);
  assert.ok(view.finished.available.original >= 0);
}

test('v1.3 creates an isolated original-only first order and disables future purchases', () => {
  const game = fresh(), view = game.getView();
  assert.equal(view.mode, MODE);
  assert.equal(SAVE_VERSION, 1);
  assert.equal(SAVE_KEY, 'little_popcorn_factory_orders_p0_v1');
  assert.equal(view.orders.length, 1);
  assert.deepEqual(view.orders[0].items, { original: 4 });
  assert.equal(view.orders[0].quote, 4);
  assert.equal(view.finished.capacity, 24);
  assert.equal(view.stations[2].name, '包装入库');
  for (const command of ['buyUpgrade', 'buyAutomation', 'buyLogisticsUpgrade', 'evolve']) {
    assert.equal(game[command]('cup').ok, false);
  }
  assert.equal(view.expansion, null);
  assert.equal(view.logisticsUpgrade, null);
  assert.ok(view.stations.every(station => station.upgrade === null));
  assert.ok(view.transfers.every(route => route.automation === null));
});

test('real packaging enters finished stock without selling or earning money', () => {
  const game = fresh();
  produce(game, 8);
  assert.equal(game.getView().finished.stock.original, 8);
  assert.equal(game.state.stations.ship.processed, 8);
  assert.equal(game.state.totalSold, 0);
  assert.equal(game.state.totalEarned, 0);
  assert.equal(game.state.coins, 0);
  const events = game.drainEvents();
  assert.equal(events.filter(event => event.type === 'packaging').reduce((sum, event) => sum + event.amount, 0), 8);
  assert.equal(events.filter(event => ['ship', 'first-sale', 'order-settled'].includes(event.type)).length, 0);
  checkConservation(game);
});

test('one correct batch settles the first order exactly once and admits at most two successors', () => {
  const game = fresh();
  produce(game, 4);
  const order = game.getView().orders[0], hold = game.beginDelivery();
  game.drainEvents();
  const result = game.deliver(hold.token, order.id);
  assert.equal(result.amount, 4);
  assert.equal(result.coins, order.quote);
  assert.equal(result.settled, true);
  assert.equal(game.state.coins, 4);
  assert.equal(game.state.totalSold, 4);
  assert.equal(game.getView().orders.length, 2);
  assert.equal(game.drainEvents().filter(event => event.type === 'order-settled').length, 1);
  const save = game.exportSave(10);
  assert.equal(game.deliver(hold.token, order.id).ok, false);
  assert.equal(game.cancelOrder(order.id).ok, false);
  assert.deepEqual(game.exportSave(10), save);
  const restored = new V13OrderGame({ save, now: 86400000 });
  assert.equal(restored.loadWarning, null);
  assert.equal(restored.deliver(hold.token, order.id).ok, false);
  assert.deepEqual(restored.exportSave(10), save);
  checkConservation(restored);
});

test('partial delivery retains real capacity and pays the fixed quote only after all demand is filled', () => {
  const game = fresh();
  firstSale(game);
  produce(game, 10);
  const order = game.getView().orders[0];
  assert.equal(order.items.original, 6);
  let hold = game.beginDelivery();
  assert.equal(hold.amount, ORDER_RULES.deliveryBatch);
  assert.equal(game.deliver(hold.token, order.id).settled, false);
  let view = game.getView();
  assert.equal(view.finished.stock.original, 10);
  assert.equal(view.finished.reserved.original, 4);
  assert.equal(view.finished.available.original, 6);
  assert.equal(view.orders[0].status, 'partial');
  assert.equal(game.state.coins, 4);
  hold = game.beginDelivery();
  const result = game.deliver(hold.token, order.id);
  assert.equal(result.amount, 2);
  assert.equal(result.remaining, 2);
  assert.equal(result.coins, 7);
  assert.equal(game.state.coins, 11);
  assert.equal(game.state.totalSold, 10);
  assert.equal(game.getView().finished.stock.original, 4);
  checkConservation(game);
});

test('two customers cannot claim each other’s persistent or transient stock', () => {
  const game = fresh();
  firstSale(game);
  produce(game, 8);
  const [first, second] = game.getView().orders;
  let hold = game.beginDelivery();
  game.deliver(hold.token, first.id);
  hold = game.beginDelivery();
  assert.equal(game.beginDelivery().reason, 'delivery-pending');
  assert.equal(game.getView().finished.available.original, 0);
  assert.equal(game.getView().finished.reserved.original, 4);
  assert.equal(game.getView().finished.held.original, 4);
  game.deliver(hold.token, second.id);
  assert.equal(game.getView().finished.reserved.original, 8);
  assert.equal(game.beginDelivery().reason, 'source-empty');
  assert.equal(game.state.coins, 4);
  checkConservation(game);
});

test('cancelling an ordinary partial order releases all units without paying or losing stock', () => {
  const game = fresh();
  firstSale(game);
  produce(game, 8);
  const order = game.getView().orders[0], hold = game.beginDelivery();
  game.deliver(hold.token, order.id);
  const before = game.getView();
  assert.equal(game.cancelOrder(order.id).amount, 4);
  const after = game.getView();
  assert.equal(after.finished.stock.original, before.finished.stock.original);
  assert.equal(after.finished.available.original, before.finished.available.original + 4);
  assert.equal(after.state.coins, before.state.coins);
  assert.equal(after.orders.length, 2);
  assert.ok(after.orders.every(item => item.id !== order.id));
  assert.equal(game.cancelOrder(order.id).ok, false);
  const restored = new V13OrderGame({ save: game.exportSave(0), now: 1 });
  assert.equal(restored.loadWarning, null);
  assert.equal(restored.getView().orderLedger.cancelled, 1);
  checkConservation(restored);
});

test('wrong product, target and stale drag tokens cannot duplicate or destroy finished stock', () => {
  const game = fresh();
  produce(game, 4);
  assert.equal(game.beginDelivery('caramel').reason, 'invalid-product');
  const hold = game.beginDelivery();
  assert.equal(game.deliver('fake-token', game.getView().orders[0].id).reason, 'invalid-delivery');
  assert.equal(game.getView().finished.held.original, 4);
  assert.equal(game.deliver(hold.token, 'not-an-order').reason, 'invalid-order');
  assert.equal(game.getView().finished.held.original, 0);
  assert.equal(game.getView().finished.available.original, 4);
  const next = game.beginDelivery();
  assert.equal(game.cancelDelivery(hold.token).amount, 0);
  assert.equal(game.cancelDelivery(next.token).amount, 4);
  assert.equal(game.cancelDelivery(next.token).amount, 0);
  assert.equal(game.state.coins, 0);
  checkConservation(game);
});

test('save/load preserves partial orders but drops drag holds and never simulates offline time', () => {
  const game = fresh();
  firstSale(game);
  produce(game, 12);
  const order = game.getView().orders[0], hold = game.beginDelivery();
  game.deliver(hold.token, order.id);
  const transient = game.beginDelivery();
  const transferHold = game.beginTransfer('pop');
  assert.equal(transient.ok, true);
  const save = game.exportSave(100);
  assert.equal(game.getView().finished.held.original, 0);
  assert.equal(JSON.stringify(save).includes(transient.token), false);
  if (transferHold.ok) assert.equal(JSON.stringify(save).includes(transferHold.token), false);
  const restored = new V13OrderGame({ save: JSON.stringify(save), now: 100000000000 });
  assert.equal(restored.loadWarning, null);
  assert.deepEqual(restored.exportSave(100), save);
  assert.equal(restored.getView().orders[0].reserved.original, 4);
  assert.equal(restored.deliver(transient.token, order.id).ok, false);
  assert.equal(restored.state.coins, 4);
  checkConservation(restored);
});

test('a full warehouse blocks completed packaging WIP even when its stock is reserved', () => {
  const game = fresh();
  firstSale(game);
  produce(game, 24);
  const order = game.getView().orders[0];
  game.deliver(game.beginDelivery().token, order.id);
  for (let i = 0; i < 20; i++) {
    game.tick(.25);
    transfer(game, 'pop'); transfer(game, 'cup');
  }
  assert.equal(game.getView().finished.stock.original, 24);
  assert.equal(game.getView().finished.reserved.original, 4);
  assert.equal(game.getView().stations[2].status, 'blocked');
  assert.equal(game.state.stations.ship.jobs[0].remainingTicks, 0);
  const packaged = game.state.stations.ship.processed;
  game.tick(1);
  assert.equal(game.state.stations.ship.processed, packaged);
  const save = game.exportSave(0), restored = new V13OrderGame({ save, now: 90000 });
  assert.equal(restored.loadWarning, null);
  assert.equal(restored.state.stations.ship.jobs[0].remainingTicks, 0);
  const delivery = restored.deliver(restored.beginDelivery().token, order.id);
  assert.equal(delivery.settled, true);
  assert.equal(restored.state.stations.ship.processed, packaged + 1, 'freed capacity admits the already-complete batch once');
  assert.equal(restored.getView().finished.stock.original, 19);
  checkConservation(restored);
});

test('snapshot mutation cannot change quoted orders, inventory or the sales ledger', () => {
  const game = fresh();
  produce(game, 4);
  const view = game.getView(), expected = game.exportSave(0);
  view.orders[0].quote = 99999;
  view.orders[0].items.original = 1;
  view.finished.stock.original = 999;
  view.orderLedger.earned = 999;
  view.state.coins = 999;
  assert.deepEqual(game.exportSave(0), expected);
  game.setSetting('sound', false);
  game.tick(1);
  assert.equal(game.getView().orders[0].quote, 4);
});

test('corrupt order, capacity, quote and cumulative ledger saves recover without accepting counterfeit value', () => {
  const game = fresh();
  firstSale(game);
  produce(game, 12);
  game.deliver(game.beginDelivery().token, game.getView().orders[0].id);
  const valid = game.exportSave(100);
  const corruptions = [
    data => { data.mode = 'v15'; },
    data => { data.version = 4; },
    data => { data.savedAt = Infinity; },
    data => { data.commerce.stock.original = 25; },
    data => { data.commerce.stock.original = 3; },
    data => { data.commerce.stock.caramel = 1; },
    data => { data.commerce.orders[0].quote++; },
    data => { data.commerce.orders[0].items.original = 30; },
    data => { data.commerce.orders[0].items.caramel = 1; },
    data => { data.commerce.orders[0].reserved.original = 6; },
    data => { data.commerce.orders[0].reserved.original = -1; },
    data => { data.commerce.orders[0].reserved.caramel = 0; },
    data => { data.commerce.orders[0].status = 'settled'; },
    data => { data.commerce.orders[0].status = 'pending'; },
    data => { data.commerce.orders[0].createdAtTick = data.factory.simulation.ticks + 1; },
    data => { data.commerce.orders[1] = clone(data.commerce.orders[0]); },
    data => { data.commerce.orders.push(clone(data.commerce.orders[0])); },
    data => { data.commerce.nextOrderId = 2; },
    data => { data.commerce.nextOrderId++; },
    data => { data.commerce.ledger.completed++; },
    data => { data.commerce.ledger.cancelled++; },
    data => { data.commerce.ledger.buckets[0].settled++; },
    data => { data.commerce.ledger.earned++; data.factory.totalEarned++; data.factory.coins++; },
    data => { data.commerce.ledger.sold++; data.factory.totalSold++; },
    data => { data.factory.coins++; },
    data => { data.factory.totalProduced++; },
    data => { data.factory.stations.ship.processed++; },
    data => { data.factory.machine = 1; },
    data => { data.factory.upgrades.cup = 1; },
    data => { data.factory.connections.pop.automated = true; },
    data => { data.factory.simulation.ticks = Number.MAX_SAFE_INTEGER; },
    data => { data.factory.totalSpent = 1; data.factory.coins--; }
  ];
  for (const corrupt of corruptions) {
    const save = clone(valid);
    corrupt(save);
    const restored = new V13OrderGame({ save, now: 1000 });
    assert.ok(restored.loadWarning, corrupt.toString());
    assert.equal(restored.state.coins, 0, corrupt.toString());
    assert.equal(restored.getView().finished.stock.original, 0, corrupt.toString());
    assert.equal(restored.getView().orders.length, 1, corrupt.toString());
  }
  assert.equal(new V13OrderGame({ save: valid, now: 1000 }).loadWarning, null);
});

test('legacy profiles and their save bytes remain untouched and cannot be imported into the prototype', () => {
  for (const mode of [null, 'v15']) {
    const legacy = new Game({ mode, now: 0 });
    legacy.tick(3);
    const save = legacy.exportSave(0), original = JSON.stringify(save);
    const prototype = new V13OrderGame({ save, now: 100000 });
    assert.ok(prototype.loadWarning);
    assert.equal(JSON.stringify(save), original);
    const restored = new Game({ mode, save, now: 100000 });
    assert.equal(restored.loadWarning, null);
    assert.deepEqual(restored.exportSave(0), save);
  }
});

test('bounded cumulative history keeps canceled IDs unique and never removes the earning route', () => {
  let game = fresh();
  const ids = new Set();
  for (let index = 0; index < 150; index++) {
    const order = game.getView().orders[0];
    assert.equal(ids.has(order.id), false);
    ids.add(order.id);
    assert.equal(game.cancelOrder(order.id).ok, true);
    assert.equal(game.getView().orders.length, 1);
    if (index % 25 === 0) {
      game = new V13OrderGame({ save: game.exportSave(0), now: 0 });
      assert.equal(game.loadWarning, null);
    }
  }
  produce(game, 8);
  const order = game.getView().orders[0];
  while (game.getView().orders.some(item => item.id === order.id)) game.deliver(game.beginDelivery().token, order.id);
  assert.equal(game.getView().orderLedger.completed, 1);
  assert.equal(game.getView().orderLedger.cancelled, 150);
  assert.equal(game.getView().orders.length, 2);
  assert.ok(JSON.stringify(game.exportSave(0)).length < 10000);
  checkConservation(game);
});

test('invalid and excessive time are rejected atomically and foreground partitioning stays deterministic', () => {
  const game = fresh(), before = game.exportSave(0);
  for (const seconds of [-1, NaN, Infinity, '1', 61, 1e100]) {
    assert.equal(game.tick(seconds).ok, false);
    assert.deepEqual(game.exportSave(0), before);
  }
  const partitioned = fresh();
  game.tick(3);
  for (let i = 0; i < 12; i++) partitioned.tick(.25);
  assert.deepEqual(partitioned.exportSave(0), game.exportSave(0));
});

test('production transfer target rejection and save cancellation preserve the existing A/B inventory', () => {
  const game = fresh();
  game.tick(2);
  const before = game.state.buffers.pop;
  const hold = game.beginTransfer('pop');
  assert.equal(game.commitTransfer(hold.token, 'ship').reason, 'invalid-target');
  assert.equal(game.state.buffers.pop, before);
  assert.equal(game.state.inputs.cup, 0);
  assert.equal(game.commitTransfer(hold.token).ok, false);
  const next = game.beginTransfer('pop');
  const saved = game.exportSave(0);
  assert.equal(game.commitTransfer(next.token).ok, false);
  assert.equal(saved.factory.buffers.pop, before);
  checkConservation(game);
});
