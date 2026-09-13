'use strict';

// Deterministic foreground simulations use public commands only. Every route
// earns its purchases; the no-input comparison clones the very same paid save.
const assert = require('node:assert/strict');
const { OrderGame, ORDER_RULES } = require('../src/v13-order-core');
const { CONFIG } = require('../src/core');
const STEP = .25;
const round = number => Math.round(number * 100) / 100;

function conserved(game, view = game.getView()) {
  const state = game.state;
  const jobs = Object.values(state.stations).reduce((total, station) => total
    + station.jobs.reduce((sum, job) => sum + (job ? job.amount : 0), 0), 0);
  const inProgress = jobs + state.buffers.pop + state.buffers.cup + state.inputs.cup + state.inputs.ship;
  assert.equal(state.totalProduced, state.totalSold + view.finished.stock.original + inProgress, 'physical inventory must balance');
  assert.equal(state.stations.ship.processed, state.totalSold + view.finished.stock.original, 'packaging creates stock exactly once');
  assert.equal(state.coins + state.totalSpent, state.totalEarned, 'earned coins must match balance plus purchases');
  assert.equal(state.totalEarned, view.orderLedger.earned, 'fresh-game income must come from complete orders');
  assert.equal(state.totalSold, view.orderLedger.sold);
  assert.equal(view.finished.stock.original, view.finished.available.original + view.finished.reserved.original + view.finished.held.original);
  assert.ok(view.finished.available.original >= 0);
  assert.ok(view.finished.stock.original <= view.finished.capacity);
  if (view.replenishment) assert.equal(view.replenishment.inProgress, inProgress, 'replenishment must count all actual WIP');
}

function isAutomated(game) {
  return game.state.connections.pop.automated && game.state.connections.cup.automated && game.getView().salesperson.owned;
}

function interact(game, counters, { assist = false } = {}) {
  counters.interactionRounds++;
  for (const source of ['pop', 'cup']) {
    if (game.state.connections[source].automated) continue;
    const held = game.reserveTransfer(source);
    if (held.ok && game.commitTransfer(held.token).ok) counters.manualTransfers++;
  }
  if (assist) for (const station of CONFIG.stationIds) {
    const before = game.state.simulation.ticks;
    if (game.assist(station).ok) counters.acceptedAssists++;
    assert.equal(game.state.simulation.ticks, before, 'assistance cannot advance the world clock');
  }
  const view = game.getView();
  const ranked = [...view.orders].sort((a, b) => {
    const aCanFinish = a.items.original - a.reserved.original <= view.finished.available.original;
    const bCanFinish = b.items.original - b.reserved.original <= view.finished.available.original;
    return Number(bCanFinish) - Number(aCanFinish) || a.createdAtTick - b.createdAtTick || a.sequence - b.sequence;
  });
  if (ranked.length) {
    const held = game.beginDelivery();
    if (held.ok) {
      const delivered = game.deliver(held.token, ranked[0].id);
      if (delivered.ok) counters.manualDeliveries++;
    }
  }
  // Explicitly hand over any manual partial order. This is a player command,
  // performed only during an interaction round, never by the unattended loop.
  if (game.getView().salesperson.owned) for (const order of game.getView().orders) {
    if (order.assignedTo === 'manual') assert.equal(game.handoffOrder(order.id).ok, true);
  }
}

function purchase(game, item) {
  if (item === 'salesperson') return game.buySalesperson();
  if (item === 'logistics') return game.buyLogisticsUpgrade();
  const [kind, id] = item.split(':');
  return kind === 'automation' ? game.buyAutomation(id) : game.buyUpgrade(id);
}

function observe(game, record, previous, time) {
  const view = game.getView();
  if (view.finished.available.original === 0 && view.orders.some(order => order.reserved.original < order.items.original)) record.stockoutSeconds += STEP;
  if (view.finished.stock.original === view.finished.capacity) record.fullWarehouseSeconds += STEP;
  record.maxFinishedStock = Math.max(record.maxFinishedStock, view.finished.stock.original);
  record.maxInProgress = Math.max(record.maxInProgress, view.replenishment ? view.replenishment.inProgress : 0);
  if (view.orderLedger.completed > previous.completed) {
    if (record.firstSaleSeconds === null) record.firstSaleSeconds = time;
    record.longestNoSaleSeconds = Math.max(record.longestNoSaleSeconds, time - previous.lastSale);
    previous.lastSale = time;
    previous.completed = view.orderLedger.completed;
  }
  if (game.state.connections.pop.automated && record.automationASeconds === null) record.automationASeconds = time;
  if (game.state.connections.cup.automated && record.automationBSeconds === null) record.automationBSeconds = time;
  if (view.salesperson.owned && record.salespersonSeconds === null) record.salespersonSeconds = time;
  conserved(game, view);
  game.drainEvents();
}

function newRecord(name) {
  return { strategy: name, firstSaleSeconds: null, automationASeconds: null, automationBSeconds: null,
    salespersonSeconds: null, basicAutomationSeconds: null, interactionRounds: 0, manualTransfers: 0,
    manualDeliveries: 0, acceptedAssists: 0, stockoutSeconds: 0, fullWarehouseSeconds: 0,
    maxFinishedStock: 0, maxInProgress: 0, longestNoSaleSeconds: 0, purchases: [] };
}

function runOnboarding(name, { interval = .5, assist = false, nonOptimal = false, maxSeconds = 900 } = {}) {
  const game = new OrderGame({ now: 0 });
  const record = newRecord(name);
  const plan = nonOptimal
    ? ['upgrade:pop', 'logistics', 'automation:pop', 'automation:cup', 'salesperson']
    : ['automation:pop', 'automation:cup', 'salesperson'];
  const previous = { completed: 0, lastSale: 0 };
  let nextPurchase = 0;
  for (let step = 1; step <= maxSeconds / STEP; step++) {
    assert.equal(game.tick(STEP).ok, true);
    const time = step * STEP;
    if (step % Math.round(interval / STEP) === 0) {
      interact(game, record, { assist });
      if (nextPurchase < plan.length) {
        const result = purchase(game, plan[nextPurchase]);
        if (result.ok) {
          record.purchases.push({ item: plan[nextPurchase++], seconds: time, cost: result.cost });
        }
      }
    }
    observe(game, record, previous, time);
    if (isAutomated(game) && nextPurchase === plan.length) {
      record.basicAutomationSeconds = time;
      for (const order of game.getView().orders) if (order.assignedTo === 'manual') assert.equal(game.handoffOrder(order.id).ok, true);
      break;
    }
  }
  assert.notEqual(record.basicAutomationSeconds, null, `${name}: all three purchases must be reachable`);
  record.coins = game.state.coins;
  record.earned = game.state.totalEarned;
  record.spent = game.state.totalSpent;
  record.completedOrders = game.getView().orderLedger.completed;
  record.soldUnits = game.state.totalSold;
  const save = game.exportSave(0);
  const restored = new OrderGame({ save, now: 86400000000 });
  assert.equal(restored.loadWarning, null, `${name}: paid state must reload`);
  assert.deepEqual(restored.exportSave(0), save, 'reload adds neither offline production nor sales');
  return { record, save };
}

function runContinuation(name, save, { seconds = 600, interval = null, assist = false } = {}) {
  const game = new OrderGame({ save, now: 86400000000 });
  assert.equal(game.loadWarning, null);
  assert.equal(isAutomated(game), true);
  const start = { ticks: game.state.simulation.ticks, produced: game.state.totalProduced,
    sold: game.state.totalSold, earned: game.state.totalEarned, spent: game.state.totalSpent,
    completed: game.getView().orderLedger.completed, stock: game.getView().finished.stock.original };
  const record = newRecord(name);
  const previous = { completed: start.completed, lastSale: 0 };
  for (const key of ['automationASeconds', 'automationBSeconds', 'salespersonSeconds', 'basicAutomationSeconds']) record[key] = 0;
  let lastMinute = null;
  record.paybackSeconds = null;
  for (let step = 1; step <= seconds / STEP; step++) {
    assert.equal(game.tick(STEP).ok, true);
    const time = step * STEP;
    if (interval !== null && step % Math.round(interval / STEP) === 0) interact(game, record, { assist });
    observe(game, record, previous, time);
    if (record.paybackSeconds === null && game.state.totalEarned - start.earned >= start.spent) record.paybackSeconds = time;
    if (time === seconds - 60) lastMinute = { produced: game.state.totalProduced, sold: game.state.totalSold,
      completed: game.getView().orderLedger.completed };
  }
  record.longestNoSaleSeconds = round(Math.max(record.longestNoSaleSeconds, seconds - previous.lastSale));
  record.seconds = seconds;
  record.producedUnits = game.state.totalProduced - start.produced;
  record.soldUnits = game.state.totalSold - start.sold;
  record.completedOrders = game.getView().orderLedger.completed - start.completed;
  record.earned = game.state.totalEarned - start.earned;
  record.finalStock = game.getView().finished.stock.original;
  record.stockoutPercent = round(record.stockoutSeconds / seconds * 100);
  record.fullWarehousePercent = round(record.fullWarehouseSeconds / seconds * 100);
  record.last60Seconds = { producedUnits: game.state.totalProduced - lastMinute.produced,
    soldUnits: game.state.totalSold - lastMinute.sold, completedOrders: game.getView().orderLedger.completed - lastMinute.completed };
  assert.equal(game.state.simulation.ticks - start.ticks, seconds * CONFIG.ticksPerSecond, 'inputs cannot change elapsed simulation time');
  assert.equal(game.state.totalSpent, start.spent, 'comparison has an identical fixed paid equipment state');
  assert.ok(record.last60Seconds.producedUnits > 0 && record.last60Seconds.completedOrders > 0, `${name}: must keep replenishing and selling`);
  assert.ok(record.soldUnits > start.stock, `${name}: sales must include newly produced stock`);
  assert.ok(record.longestNoSaleSeconds < 60, `${name}: no prolonged shortage or full-warehouse deadlock`);
  assert.notEqual(record.paybackSeconds, null, `${name}: basic automation must recover its purchase cost`);
  const restored = new OrderGame({ save: game.exportSave(0), now: 1e12 });
  assert.equal(restored.loadWarning, null);
  conserved(restored);
  return record;
}

function runEconomySimulation({ seconds = 600 } = {}) {
  assert.ok(seconds >= 120 && Number.isInteger(seconds));
  const active = runOnboarding('积极操作（每 0.5 秒，含助力）', { interval: .5, assist: true });
  const low = runOnboarding('低频操作（每 8 秒）', { interval: 8 });
  const nonOptimal = runOnboarding('非最优购买（每 2 秒，先爆锅改造与扩容）', { interval: 2, nonOptimal: true });
  const baseline = active.save;
  const continuations = [
    runContinuation('共同自动化起点：积极操作', baseline, { seconds, interval: .5, assist: true }),
    runContinuation('共同自动化起点：低频操作', baseline, { seconds, interval: 8 }),
    runContinuation('共同自动化起点：完全自动', baseline, { seconds })
  ];
  return { rules: { capacity: ORDER_RULES.capacity, deliveryBatch: ORDER_RULES.deliveryBatch,
    targetStock: ORDER_RULES.targetStock, maxOrders: ORDER_RULES.maxOrders, templates: ORDER_RULES.templates,
    automationPrices: { pop: ORDER_RULES.automation.pop.cost, cup: ORDER_RULES.automation.cup.cost },
    salesperson: { cost: ORDER_RULES.salesperson.cost, serviceSeconds: ORDER_RULES.salesperson.serviceTicks / CONFIG.ticksPerSecond,
      batch: ORDER_RULES.salesperson.batch }, assist: ORDER_RULES.assist, upgradeCosts: ORDER_RULES.upgradeCosts,
    logisticsPrices: ORDER_RULES.logisticsLevels.map(level => level.cost), expansionPrices: ORDER_RULES.machines.map(machine => machine.cost) }, stepSeconds: STEP,
    methodology: '前三条从零资产分别赚取购买；后三条加载同一份合法的 A/B 转运及售货员已购存档，不再购买。缺货=有未配齐需求且可用成品为零；满仓=实物成品等于仓容；回本=本阶段新增订单收入覆盖共同起点累计购买支出。',
    onboarding: [active.record, low.record, nonOptimal.record],
    commonStart: { playedSeconds: baseline.factory.playedSeconds, earned: baseline.factory.totalEarned,
      spent: baseline.factory.totalSpent, coins: baseline.factory.coins, upgrades: baseline.factory.upgrades,
      finishedStock: baseline.commerce.stock.original }, continuations };
}

if (require.main === module) console.log(JSON.stringify(runEconomySimulation(), null, 2));
module.exports = { conserved, interact, runOnboarding, runContinuation, runEconomySimulation };
