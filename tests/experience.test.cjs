'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');

const NOW = 1800000000000;
const fresh = () => new Game({ now: NOW });
const tutorial = game => game.getView().tutorial;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-10), `${actual} differs from ${expected}`);
const finishTutorial = game => Object.assign(game.state, { taps: 5, bursts: 1, orderIndex: 1, totalProduced: CONFIG.orders[0].target, upgrades: { tap: 1, auto: 1, value: 0 } });

test('experience: tutorial shows tap progress and switches from saving to the affordable upgrade', () => {
  const game = fresh();
  assert.match(tutorial(game).text, /0\/5/);
  for (let i = 0; i < 5; i++) game.tap();
  assert.equal(tutorial(game).step, 1);
  assert.equal(tutorial(game).action, 'tap');
  assert.match(tutorial(game).text, /还差 11 金币/);
  game.state.coins = 15.8;
  assert.match(tutorial(game).text, /还差 1 金币/);
  game.state.coins = CONFIG.upgrades.tap.baseCost;
  assert.equal(tutorial(game).action, 'upgrade:tap');
  assert.equal(game.buyUpgrade('tap').ok, true);
  assert.equal(tutorial(game).step, 2);
  assert.equal(tutorial(game).action, 'tap');
  game.state.coins = CONFIG.upgrades.auto.baseCost;
  assert.equal(tutorial(game).action, 'upgrade:auto');
});

test('experience: a ready first order takes priority and early collection does not repeat completed steps', () => {
  const game = fresh();
  game.state.totalProduced = CONFIG.orders[0].target;
  assert.equal(tutorial(game).step, 4);
  assert.equal(tutorial(game).action, 'order');
  assert.match(tutorial(game).text, /180 金币/);
  assert.equal(game.claimOrder().ok, true);
  assert.equal(tutorial(game).step, 0);
  for (let i = 0; i < 5; i++) game.tap();
  assert.equal(game.buyUpgrade('auto').ok, true);
  assert.equal(tutorial(game).step, 1);
  assert.equal(game.buyUpgrade('tap').ok, true);
  assert.equal(tutorial(game).step, 3);
  while (game.state.bursts < 1) game.tap();
  assert.equal(tutorial(game), null);
});

test('experience: tutorial derives skipped steps and recovery from the existing save', () => {
  const game = fresh();
  game.state.coins = 100;
  assert.equal(game.buyUpgrade('auto').ok, true);
  assert.equal(game.buyUpgrade('tap').ok, true);
  for (let i = 0; i < 3; i++) game.tap();
  const snapshot = game.exportSave(NOW), savedKeys = Object.keys(snapshot);
  const restored = new Game({ save: snapshot, now: NOW });
  assert.deepEqual(tutorial(restored), tutorial(game));
  assert.match(tutorial(restored).text, /3\/5/);
  restored.tap(); restored.tap();
  assert.equal(tutorial(restored).step, 3);
  assert.equal(tutorial(restored).action, 'tap');
  assert.deepEqual(Object.keys(restored.exportSave(NOW)), savedKeys);
  restored.state.bursts = 1;
  assert.equal(tutorial(restored).step, 4);
  assert.equal(tutorial(restored).action, 'tap');
  assert.ok(!tutorial(restored).text.includes('已经达标'));
});

test('experience: all upgrade previews match the purchased output and ignore temporary boosts', () => {
  const fields = { tap: 'tap', auto: 'baseIncome', value: 'price' };
  const units = { tap: '份/次', auto: '金币/秒', value: '金币/份' };
  for (const machine of [0, 3, 5]) for (const level of [0, 7, CONFIG.maxUpgradeLevel - 1]) for (const key of Object.keys(fields)) {
    const game = fresh();
    game.state.machine = machine;
    game.state.upgrades = { tap: level, auto: level, value: level };
    game.state.coins = 1e30;
    const ordinary = game.getView().upgrades.find(u => u.key === key).preview;
    game.state.boostSeconds = 90;
    const before = game.getView(), preview = before.upgrades.find(u => u.key === key).preview;
    assert.deepEqual(preview, ordinary);
    assert.equal(preview.unit, units[key]);
    close(preview.before, before.production[fields[key]]);
    assert.equal(game.buyUpgrade(key).ok, true);
    close(preview.after, game.getView().production[fields[key]]);
    if (key === 'auto') close(game.getView().production.auto * game.getView().production.price, preview.after * 3);
    if (level === CONFIG.maxUpgradeLevel - 1) assert.equal(game.getView().upgrades.find(u => u.key === key).preview, null);
  }
});

test('experience: reading previews never mutates state, upgrades or queued production events', () => {
  const game = fresh(); game.tap();
  const before = JSON.stringify(game.state), events = JSON.stringify(game.events);
  for (let i = 0; i < 10; i++) game.getView();
  assert.equal(JSON.stringify(game.state), before);
  assert.equal(JSON.stringify(game.events), events);
});

test('experience: real burst feedback agrees with production events and saved proceeds, including boosts', () => {
  for (const [machine, level] of [[0, 0], [2, 3], [5, CONFIG.maxUpgradeLevel]]) for (const boostSeconds of [0, 90]) {
    const game = fresh(), orderIndex = CONFIG.machines[machine].requiredOrders;
    Object.assign(game.state, { machine, orderIndex, totalProduced: orderIndex ? CONFIG.orders[orderIndex - 1].target : 0,
      coins: 100, energy: 98, boostSeconds, upgrades: { tap: level, auto: level, value: level } });
    const before = game.exportSave(NOW), production = game.getView().production;
    game.tap();
    const events = game.drainEvents(), burst = events.find(e => e.type === 'burst');
    const burstProduction = events.find(e => e.type === 'produce' && e.source === 'burst');
    const allProduction = events.filter(e => e.type === 'produce');
    assert.equal(events.filter(e => e.type === 'burst').length, 1);
    assert.equal(events.filter(e => e.type === 'produce' && e.source === 'burst').length, 1);
    assert.ok(Number.isFinite(burst.amount) && burst.amount > 0);
    assert.ok(Number.isFinite(burst.coins) && burst.coins > 0);
    assert.equal(burst.amount, burstProduction.amount);
    assert.equal(burst.coins, burstProduction.coins);
    close(burst.amount, production.tap * 24 + production.baseAuto * 8);
    close(burst.coins, burst.amount * production.price);
    const after = game.exportSave(NOW);
    close(after.totalProduced - before.totalProduced, allProduction.reduce((sum, event) => sum + event.amount, 0));
    close(after.coins - before.coins, allProduction.reduce((sum, event) => sum + event.coins, 0));
    const restored = new Game({ save: after, now: NOW });
    assert.equal(restored.state.coins, after.coins);
    assert.equal(restored.state.totalProduced, after.totalProduced);
    assert.equal(restored.state.bursts, 1);
  }
});

test('experience: every machine preview and evolution event match actual permanent growth under boost', () => {
  for (let machine = 0; machine < CONFIG.machines.length - 1; machine++) {
    const game = fresh(), next = CONFIG.machines[machine + 1];
    Object.assign(game.state, { machine, coins: next.cost, orderIndex: next.requiredOrders, boostSeconds: 90, upgrades: { tap: 3, auto: 4, value: 2 } });
    const before = game.getView(), preview = before.machinePreview;
    close(preview.tapBefore, before.production.tap);
    close(preview.incomeBefore, before.production.baseIncome);
    const levels = { ...game.state.upgrades };
    assert.equal(game.evolve().ok, true);
    const after = game.getView(), event = game.drainEvents().find(e => e.type === 'evolve');
    close(preview.tapAfter, after.production.tap);
    close(preview.incomeAfter, after.production.baseIncome);
    assert.deepEqual(game.state.upgrades, levels);
    assert.equal(event.machine, machine + 1); assert.equal(event.name, next.name);
    for (const field of ['tapBefore', 'tapAfter', 'incomeBefore', 'incomeAfter']) close(event[field], preview[field]);
    if (machine === CONFIG.machines.length - 2) assert.equal(after.machinePreview, null);
  }
});

test('experience: next-machine goal distinguishes missing orders, missing coins and readiness', () => {
  const game = fresh(); finishTutorial(game);
  game.state.coins = 100;
  let goal = game.getView().goal;
  assert.match(goal.title, /电热锅/); assert.match(goal.text, /2 个主线订单/); assert.match(goal.text, /2.99万 金币/);
  assert.equal(goal.action, 'order');
  game.state.coins = CONFIG.machines[1].cost;
  goal = game.getView().goal;
  assert.match(goal.text, /2 个主线订单/); assert.ok(!goal.text.includes('金币')); assert.equal(goal.action, 'order');
  game.state.orderIndex = CONFIG.machines[1].requiredOrders;
  game.state.totalProduced = CONFIG.orders[game.state.orderIndex - 1].target;
  game.state.coins -= 0.2;
  goal = game.getView().goal;
  assert.match(goal.text, /还差 1 金币/); assert.equal(goal.action, 'tab:machines');
  game.state.coins = CONFIG.machines[1].cost;
  assert.equal(game.getView().goal.action, 'machine');
  const restored = new Game({ save: game.exportSave(NOW), now: NOW });
  assert.deepEqual(restored.getView().goal, game.getView().goal);
});

test('experience: after all machines the goal follows the current main or loop order', () => {
  const game = fresh(); finishTutorial(game);
  Object.assign(game.state, { machine: 5, orderIndex: 18, totalProduced: CONFIG.orders[17].target });
  assert.equal(game.getView().machinePreview, null);
  assert.match(game.getView().goal.title, /云端甜品节/);
  assert.equal(game.getView().goal.action, 'order');
  game.state.orderIndex = CONFIG.orders.length;
  game.state.totalProduced = CONFIG.orders[19].target;
  assert.match(game.getView().goal.title, /城市返场订单/);
  game.state.totalProduced = game.getView().order.target;
  assert.match(game.getView().goal.title, /可以装车/);
  assert.equal(game.claimOrder().ok, true);
  assert.match(game.getView().goal.title, /全球甜蜜补货/);
});
