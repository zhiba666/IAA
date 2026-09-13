'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const { OrderGame, ORDER_RULES, migrateLegacySave } = require('../src/v13-order-core');
const clone = value => JSON.parse(JSON.stringify(value));
function step(game, manual = true) {
  game.tick(.25);
  if (manual) {
    for (const source of ['pop', 'cup']) {
      const hold = game.beginTransfer(source);
      if (hold.ok) game.commitTransfer(hold.token);
    }
    for (const order of game.getView().orders) {
      const hold = game.beginDelivery();
      if (hold.ok) game.deliver(hold.token, order.id);
    }
  }
  game.drainEvents();
}
function earned(target = 100) {
  const game = new OrderGame({ now: 0 });
  for (let count = 0; count < 20000 && game.state.coins < target; count++) step(game);
  assert.ok(game.state.coins >= target);
  return game;
}
function automated() {
  const game = earned();
  assert.equal(game.buyAutomation('pop').ok, true);
  assert.equal(game.buyAutomation('cup').ok, true);
  assert.equal(game.buySalesperson().ok, true);
  for (const order of game.getView().orders) game.handoffOrder(order.id);
  return game;
}
function roundTrip(game) {
  const save = game.exportSave(123), restored = new OrderGame({ save, now: 1e12 });
  assert.equal(restored.loadWarning, null);
  assert.deepEqual(restored.exportSave(123), save);
  return restored;
}

test('all purchases have actual spend, durable capabilities and matching quotes', () => {
  const game = earned(500);
  const commands = [() => game.buyAutomation('pop'), () => game.buyAutomation('cup'), () => game.buySalesperson(),
    () => game.buyUpgrade('cup'), () => game.buyUpgrade('pop'), () => game.buyUpgrade('ship'),
    () => game.buyLogisticsUpgrade(), () => game.evolve()];
  for (const command of commands) {
    const before = game.state.coins, spent = game.state.totalSpent;
    const result = command();
    assert.equal(result.ok, true, result.reason);
    assert.equal(game.state.coins, before - result.cost);
    assert.equal(game.state.totalSpent, spent + result.cost);
    assert.equal(game.state.coins + game.state.totalSpent, game.state.totalEarned);
    roundTrip(game);
  }
  assert.equal(game.state.machine, 1);
  assert.ok(game.state.connections.pop.automated && game.state.connections.cup.automated);
  assert.equal(game.getView().salesperson.owned, true);
  assert.equal(game.buySalesperson().reason, 'already-purchased');
  assert.equal(game.buyAutomation('pop').reason, 'already-automated');
});

test('purchase records reject edited prices, duplicated capabilities and unaccounted spending', () => {
  const valid = automated().exportSave(0);
  for (const corrupt of [
    data => { data.commerce.purchases[0].cost++; },
    data => { data.commerce.purchases.push(clone(data.commerce.purchases[0])); },
    data => { data.commerce.salesperson.owned = false; },
    data => { data.commerce.salesperson.remainingTicks = 0; },
    data => { data.factory.totalSpent++; data.factory.coins--; },
    data => { data.factory.upgrades.ship++; }
  ]) {
    const save = clone(valid); corrupt(save);
    assert.ok(new OrderGame({ save, now: 0 }).loadWarning, corrupt.toString());
  }
});

test('assistance touches current legal processing only, is rate limited across reload, and never advances time', () => {
  const game = new OrderGame({ now: 0 }), before = game.exportSave(0);
  assert.equal(game.assist('cup').reason, 'no-active-batch');
  assert.equal(game.assist('bogus').reason, 'invalid-station');
  assert.equal(game.assist('pop').ok, true);
  assert.equal(game.state.simulation.ticks, 0);
  assert.equal(game.state.simulation.carry, 0);
  assert.equal(game.state.totalProduced, before.factory.totalProduced);
  assert.equal(game.state.totalEarned, 0);
  assert.equal(game.state.stations.pop.jobs[0].remainingTicks, 30 - ORDER_RULES.assist.progressTicks);
  assert.equal(game.assist('pop').reason, 'assist-rate-limit');
  const restored = roundTrip(game);
  assert.equal(restored.assist('pop').reason, 'assist-rate-limit');
  let extra = ORDER_RULES.assist.progressTicks;
  for (let index = 0; index < 3; index++) {
    restored.tick(.25);
    const ticks = restored.state.simulation.ticks;
    const assisted = restored.assist('pop');
    if (assisted.ok) extra += assisted.progressTicks;
    assert.equal(restored.state.simulation.ticks, ticks);
  }
  assert.ok(extra <= ORDER_RULES.assist.maxExtraTicks);
  const produced = restored.state.totalProduced;
  restored.tick(1);
  assert.ok(restored.state.totalProduced > produced, 'base processing continues after clicks stop');
});

test('fresh replenishment counts reserved and all WIP, stops admission at its target, and restarts after sale', () => {
  const game = new OrderGame({ now: 0 });
  for (let count = 0; count < 200; count++) {
    game.tick(.25);
    for (const source of ['pop', 'cup']) {
      const hold = game.beginTransfer(source); if (hold.ok) game.commitTransfer(hold.token);
    }
  }
  const view = game.getView();
  assert.equal(view.finished.stock.original, ORDER_RULES.targetStock);
  assert.equal(view.replenishment.inProgress, 0);
  assert.equal(game.state.totalProduced, ORDER_RULES.targetStock);
  const total = game.state.totalProduced;
  game.tick(60);
  assert.equal(game.state.totalProduced, total);
  const order = game.getView().orders[0];
  assert.equal(game.deliver(game.beginDelivery().token, order.id).settled, true);
  assert.ok(game.state.totalProduced > total);
  roundTrip(game);
});

test('a paid logistics expansion grows finished storage and replenishment without repeated overproduction', () => {
  const game = earned(100);
  assert.equal(game.getView().finished.capacity, 24);
  const coins = game.state.coins;
  assert.equal(game.buyLogisticsUpgrade().ok, true);
  assert.equal(game.state.coins, coins - ORDER_RULES.logisticsLevels[1].cost);
  assert.equal(game.getView().finished.capacity, 36);
  assert.equal(game.getView().replenishment.targetStock, 36);
  for (const order of game.getView().orders) game.cancelOrder(order.id);
  function fill(factory) {
    for (let index = 0; index < 200; index++) {
      factory.tick(.25);
      for (const source of ['pop', 'cup']) {
        const hold = factory.beginTransfer(source); if (hold.ok) factory.commitTransfer(hold.token);
      }
    }
    assert.equal(factory.getView().finished.stock.original, 36);
    assert.equal(factory.getView().replenishment.inProgress, 0);
  }
  fill(game);
  const restored = roundTrip(game), produced = restored.state.totalProduced;
  restored.tick(60);
  assert.equal(restored.state.totalProduced, produced, 'the same inventory target must not create another supply budget');
  const order = restored.getView().orders[0];
  while (restored.getView().orders.some(item => item.id === order.id))
    assert.equal(restored.deliver(restored.beginDelivery().token, order.id).ok, true);
  fill(restored);
  assert.equal(restored.state.totalProduced - produced, order.items.original, 'only the sold quantity is replenished');
  roundTrip(restored);
  const forged = restored.exportSave(0);
  forged.factory.logisticsLevel = 0;
  assert.ok(new OrderGame({ save: forged, now: 0 }).loadWarning, 'unpaid capacity cannot be accepted on reload');
});

test('seller cannot steal a delivery hold or a manual partial order, and handoff explicitly enables continuation', () => {
  const game = automated();
  // Cancel existing allocations so both orders begin with no owner.
  for (const order of game.getView().orders) game.cancelOrder(order.id);
  game.tick(10);
  const order = game.getView().orders.find(item => item.items.original > ORDER_RULES.deliveryBatch);
  assert.ok(order);
  const hold = game.beginDelivery();
  assert.equal(hold.ok, true);
  game.tick(6);
  assert.equal(game.getView().finished.held.original, hold.amount);
  assert.ok(game.getView().finished.stock.original >= hold.amount + game.getView().finished.reserved.original);
  // Its original target may have completed during the drag: stale drop safely releases the hold.
  game.cancelDelivery(hold.token);
  let current = game.getView().orders.find(item => item.items.original > ORDER_RULES.deliveryBatch && !item.reserved.original);
  if (!current) {
    for (const item of game.getView().orders) game.cancelOrder(item.id);
    while (!(current = game.getView().orders.find(item => item.items.original > ORDER_RULES.deliveryBatch))) game.cancelOrder(game.getView().orders[0].id);
  }
  const delivery = game.beginDelivery();
  assert.equal(game.deliver(delivery.token, current.id).settled, false);
  const reserved = game.getView().orders.find(item => item.id === current.id).reserved.original;
  game.tick(30);
  assert.equal(game.getView().orders.find(item => item.id === current.id).reserved.original, reserved);
  assert.equal(game.handoffOrder(current.id).ok, true);
  game.tick(8);
  assert.equal(game.getView().orders.some(item => item.id === current.id), false);
  assert.equal(game.handoffOrder(current.id).reason, 'invalid-order');
  roundTrip(game);
});

test('seller uses finite cycles, whole-order commands, deterministic partitions and no legacy sale events', () => {
  const game = automated(), save = game.exportSave(0), other = new OrderGame({ save, now: 0 });
  const before = game.state.totalEarned;
  const result = game.tick(10);
  for (let index = 0; index < 40; index++) other.tick(.25);
  assert.deepEqual(game.exportSave(0), other.exportSave(0));
  const events = game.drainEvents();
  const settlements = events.filter(event => event.type === 'order-settled');
  assert.equal(new Set(settlements.map(event => event.orderId)).size, settlements.length);
  assert.ok(settlements.length <= 5, 'one service command per 2 seconds');
  assert.equal(events.some(event => event.type === 'ship' || event.type === 'first-sale'), false);
  assert.equal(result.coins, game.state.totalEarned - before);
  assert.equal(settlements.reduce((sum, event) => sum + event.coins, 0), result.coins);
});

test('seller completes a ready small order before an older large one, then uses waiting order for equal priorities', () => {
  for (const [amounts, expectedAmount] of [[[8, 4], 4], [[6, 8], 6]]) {
    const game = earned(100);
    for (const order of game.getView().orders) game.cancelOrder(order.id);
    let count = 0;
    while (JSON.stringify(game.getView().orders.map(order => order.items.original)) !== JSON.stringify(amounts) && count++ < 10)
      game.cancelOrder(game.getView().orders[0].id);
    assert.ok(count < 10);
    for (let index = 0; index < 200; index++) {
      game.tick(.25);
      for (const source of ['pop', 'cup']) {
        const hold = game.beginTransfer(source); if (hold.ok) game.commitTransfer(hold.token);
      }
    }
    assert.equal(game.getView().finished.stock.original, 24);
    const orders = game.getView().orders;
    assert.equal(game.buySalesperson().ok, true);
    game.drainEvents(); game.tick(2);
    const allocation = game.drainEvents().find(event => event.type === 'order-reserved');
    assert.equal(allocation.orderId, orders.find(order => order.items.original === expectedAmount).id);
    roundTrip(game);
  }
});

test('production forecasts respect finite order service and never promise packaging income', () => {
  const manual = new OrderGame({ now: 0 }).getView();
  assert.equal(manual.forecast.automaticCapacity, 0);
  assert.equal(manual.forecast.revenueUpperBound, 0);
  const view = automated().getView();
  assert.equal(view.forecast.salespersonCapacity, 22 / 12);
  assert.ok(Math.abs(view.forecast.revenueUpperBound - 26 / 12) < 1e-9);
  assert.equal(view.stations.find(station => station.id === 'cup').upgrade.forecast.after.revenueUpperBound,
    view.forecast.revenueUpperBound, 'device speed cannot bypass the seller');
});

test('legacy saves migrate without replaying historical sales or losing cash, WIP and automatic operation', () => {
  const old = new Game({ now: 0 }); old.tick(60);
  assert.equal(old.buyUpgrade('cup').ok, true);
  old.tick(20);
  const oldSave = old.exportSave(0), original = JSON.stringify(oldSave);
  const migrated = migrateLegacySave(oldSave, 300);
  assert.equal(migrated.ok, true, migrated.reason);
  assert.equal(JSON.stringify(oldSave), original);
  const game = new OrderGame({ save: migrated.save, now: 1e12 });
  assert.equal(game.loadWarning, null);
  for (const key of ['coins', 'totalEarned', 'totalSpent', 'totalProduced', 'totalSold', 'machine', 'upgrades', 'stations', 'buffers'])
    assert.deepEqual(game.state[key], oldSave[key], key);
  assert.equal(game.getView().finished.stock.original, 0, 'history is not manufactured again');
  assert.equal(game.getView().salesperson.owned, true);
  assert.equal(game.getView().accounting.openingBalance, oldSave.coins);
  const income = game.state.totalEarned;
  game.tick(60);
  assert.ok(game.state.totalEarned > income);
  assert.equal(game.state.coins + game.state.totalSpent, game.state.totalEarned);
  roundTrip(game);
  const invalid = clone(oldSave); invalid.coins++;
  assert.equal(migrateLegacySave(invalid, 300).ok, false);
  assert.deepEqual(invalid.coins, oldSave.coins + 1, 'failed migration does not mutate its source');
  assert.equal(migrateLegacySave(null).ok, false);
});

test('prototype partial orders migrate with their original quotes, inventory and manual ownership', () => {
  const game = earned(10), save = game.exportSave(0);
  save.mode = 'v13-orders-p0'; save.version = 1;
  for (const key of ['baseline', 'purchases', 'salesperson', 'assists']) delete save.commerce[key];
  for (const order of save.commerce.orders) delete order.assignedTo;
  const result = migrateLegacySave(save, 0);
  assert.equal(result.ok, true, result.reason);
  const migrated = new OrderGame({ save: result.save, now: 0 });
  assert.equal(migrated.state.totalEarned, game.state.totalEarned);
  assert.deepEqual(migrated.getView().finished.stock, game.getView().finished.stock);
  assert.equal(migrated.getView().salesperson.owned, false);
  for (const order of migrated.getView().orders) assert.equal(order.assignedTo, order.reserved.original ? 'manual' : null);
  roundTrip(migrated);
});

test('all six existing real generations migrate at their levels and continue unattended', async () => {
  const { createSixGenerationFixtures } = await import('../tools/six-gen-acceptance.mjs');
  const fixtures = createSixGenerationFixtures();
  for (const fixture of fixtures.cases.filter(item => item.configuration === 'upgraded')) {
    const result = migrateLegacySave(fixture.save, 0);
    assert.equal(result.ok, true, fixture.id + ': ' + result.reason);
    const game = new OrderGame({ save: result.save, now: 0 });
    assert.equal(game.loadWarning, null, fixture.id);
    assert.equal(game.state.machine, fixture.save.machine);
    assert.deepEqual(game.state.upgrades, fixture.save.upgrades);
    assert.deepEqual(game.state.stations, fixture.save.stations);
    const before = game.state.totalSold;
    game.tick(60);
    assert.ok(game.state.totalSold > before, fixture.id + ' keeps selling');
    assert.ok(game.getView().finished.stock.original <= game.getView().finished.capacity);
    roundTrip(game);
  }
  const sixth = fixtures.cases.find(item => item.id === 'g6-upgraded');
  const probe = new OrderGame({ save: migrateLegacySave(sixth.save, 0).save, now: 0 });
  let steps = 0;
  while (probe.state.stations.cup.jobs.filter(Boolean).length < 2 && steps++ < 1200) probe.tick(1 / CONFIG.ticksPerSecond);
  assert.ok(steps < 1200, 'real multi-lane jobs are available for the invalid-fraction regression');
  const invalid = probe.exportSave(0), jobs = invalid.factory.stations.cup.jobs.filter(Boolean);
  // Moving one integer portion back to the input preserves all batch-sum and
  // transfer accounting; each job must still reject its fractional amount.
  jobs[0].amount -= .5; jobs[1].amount -= .5; invalid.factory.inputs.cup++;
  assert.ok(new OrderGame({ save: invalid, now: 0 }).loadWarning, 'fractional portions remain invalid');
});
