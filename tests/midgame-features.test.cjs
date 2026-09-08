'use strict';
const { legacyGame } = require('./legacy-fixture.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG, QUEST_CHAPTERS } = require('../src/core');
const NOW = 1000000;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);
function factory(machine = 4, tapLevel = 16) {
  const game = legacyGame({ now: NOW });
  game.state.machine = machine;
  game.state.orderIndex = CONFIG.machines[machine].requiredOrders;
  game.state.totalProduced = game.state.orderIndex ? CONFIG.orders[game.state.orderIndex - 1].target : 0;
  game.state.upgrades = { tap: tapLevel, auto: 12, value: 10 };
  game.state.playedSeconds = CONFIG.rewardUnlockSeconds;
  game.state.bursts = 1;
  game.state.claimedQuests=QUEST_CHAPTERS.flatMap(c=>c.quests.map(q=>q.id));
  game.state.factory.completedContracts = Math.max(0, game.state.orderIndex - 6);
  game._autoQuests(); game.drainEvents();
  return game;
}
function price(key, level, machine = 4) {
  const config = CONFIG.upgrades[key];
  return Math.ceil(config.baseCost * Math.pow(config.growth, level) * (1 + machine * .45));
}
function totalPrice(key, level, count, machine = 4) {
  let result = 0; for (let i = 0; i < count; i++) result += price(key, level + i, machine); return result;
}
function bulk(game, key = 'auto') { return game.getView().upgrades.find(upgrade => upgrade.key === key).bulk; }
function noMutation(game, callback, reason) {
  game.drainEvents(); const before = game.exportSave(NOW);
  const result = callback(); assert.equal(result.ok, false); if (reason) assert.equal(result.reason, reason);
  assert.deepEqual(game.exportSave(NOW), before); assert.deepEqual(game.drainEvents(), []);
}








test('batch upgrade quotes unlock at machine 3 and preserve all existing single-purchase fields and behavior', () => {
  assert.equal(factory(3).getView().milestones.bulkUpgrade.unlocked, true);
  const game = factory(2); game.state.coins = 1e8;
  assert.equal(game.getView().milestones.bulkUpgrade.unlocked, false);
  assert.equal(bulk(game).reason, 'bulk-upgrade-locked'); assert.equal(bulk(game).canBuy, false);
  noMutation(game, () => game.buyUpgradeBatch('auto', { count: 1, cost: price('auto', 12, 2), fromLevel: 12 }), 'bulk-upgrade-locked');
  const item = game.getView().upgrades.find(upgrade => upgrade.key === 'auto');
  assert.equal(item.cost, price('auto', 12, 2)); assert.equal(item.canBuy, true);
  const result = game.buyUpgrade('auto'); assert.equal(result.cost, item.cost); assert.equal(result.level, 13);
  close(game.getView().production.baseIncome, item.preview.after);
  const next = CONFIG.machines[3]; game.state.orderIndex = next.requiredOrders; game.state.coins = next.cost;
  assert.equal(game.evolve().ok, true); assert.equal(game.getView().milestones.bulkUpgrade.unlocked, true);
});

test('batch quotes sum rounded per-level prices and show precisely the affordable count including partial purchases', () => {
  for (const key of ['tap', 'auto', 'value']) for (const count of [0, 1, 2, 3, 4, 5]) {
    const game = factory(); const fromLevel = game.state.upgrades[key];
    const target = totalPrice(key, fromLevel, count); game.state.coins = target;
    const quote = bulk(game, key);
    assert.equal(quote.count, count); assert.equal(quote.cost, target); assert.equal(quote.fromLevel, fromLevel); assert.equal(quote.toLevel, fromLevel + count);
    assert.equal(quote.canBuy, count > 0);
    if (count) { game.state.coins -= 1; assert.equal(bulk(game, key).count, count - 1); }
    else { assert.equal(quote.reason, 'not-enough-coins'); assert.equal(quote.preview, null); }
  }
});

test('batch prices, permanent output and balances match the exact same number of single upgrades for the current campaign', () => {
  for (const mode of ['balanced']) for (const key of ['tap', 'auto', 'value']) {
    const game = factory(); game.state.brandLevel = 5; game.state.coins = totalPrice(key, game.state.upgrades[key], 5) + 123;
    game.state.totalCoins = game.state.coins;
    game.state.boostSeconds = 90; game.setProductionMode(mode); game.drainEvents();
    const singles = new Game({ save: game.exportSave(NOW), now: NOW }), quote = bulk(game, key);
    const result = game.buyUpgradeBatch(key, quote); assert.equal(result.ok, true); assert.equal(result.count, 5);
    for (let i = 0; i < quote.count; i++) assert.equal(singles.buyUpgrade(key).ok, true);
    assert.deepEqual(game.exportSave(NOW), singles.exportSave(NOW)); assert.deepEqual(game.getView().production, singles.getView().production);
    const field = key === 'tap' ? 'tap' : key === 'auto' ? 'baseIncome' : 'price';
    close(game.getView().production[field], quote.preview.after);
    assert.deepEqual(game.drainEvents(), [{ type: 'upgradeBatch', key, fromLevel: quote.fromLevel, level: quote.toLevel, count: 5, cost: quote.cost }]);
  }
});

test('batch upgrades stop at level 24 and all zero-count reasons are explicit', () => {
  const game = factory(5); game.state.coins = 1e15;
  for (const level of [20, 21, 22, 23, 24]) {
    game.state.upgrades.auto = level; const quote = bulk(game);
    assert.equal(quote.count, 24 - level); assert.equal(quote.toLevel, 24);
    if (level === 24) { assert.equal(quote.reason, 'max-level'); assert.equal(quote.preview, null); }
  }
});

test('batch purchases reserve already-complete machine funds, but ordinary single upgrades retain manual spending', () => {
  for (const orderIndex of [14, 18]) {
    const game = factory(); game.state.orderIndex = orderIndex; const fund = CONFIG.machines[5].cost;
    game.state.coins = fund; const singleCost = price('auto', 12);
    assert.equal(game.getView().milestones.bulkUpgrade.reservedCoins, fund);
    assert.equal(bulk(game).reason, 'machine-fund-reserved'); assert.equal(bulk(game).count, 0);
    noMutation(game, () => game.buyUpgradeBatch('auto', { count: 1, cost: singleCost, fromLevel: 12 }), 'machine-fund-reserved');
    game.state.coins = fund + totalPrice('auto', 12, 3); const quote = bulk(game);
    assert.equal(quote.count, 3); assert.equal(game.buyUpgradeBatch('auto', quote).ok, true); assert.equal(game.state.coins, fund);
    assert.equal(game.buyUpgrade('auto').ok, true); assert.ok(game.state.coins < fund);
  }
  const saving = factory(); saving.state.coins = CONFIG.machines[5].cost - 1;
  assert.equal(bulk(saving).reservedCoins, 0); assert.equal(bulk(saving).count, 5);
  const complete = factory(5); complete.state.coins = 1e12;
  assert.equal(bulk(complete).reservedCoins, 0); assert.equal(bulk(complete).count, 5);
});

test('a displayed partial quote buys that exact count when additional money arrives before release', () => {
  const game = factory(); game.state.coins = totalPrice('auto', 12, 2); const shown = bulk(game);
  assert.equal(shown.count, 2); game.state.coins += totalPrice('auto', 14, 3);
  assert.equal(bulk(game).count, 5); const beforeCoins = game.state.coins;
  const result = game.buyUpgradeBatch('auto', shown);
  assert.equal(result.count, 2); assert.equal(game.state.upgrades.auto, 14); assert.equal(game.state.coins, beforeCoins - shown.cost);
});

test('malformed batch requests never buy a partial upgrade or change events and resources', () => {
  const game = factory(); game.state.coins = 1e10; const quote = bulk(game);
  for (const value of [undefined, null, [], '5', {},
    { ...quote, count: 0 }, { ...quote, count: 6 }, { ...quote, count: 1.5 }, { ...quote, count: '5' },
    { ...quote, fromLevel: -1 }, { ...quote, fromLevel: NaN }, { ...quote, fromLevel: 24.1 },
    { ...quote, cost: Infinity }, { ...quote, cost: 0 }, { ...quote, cost: 1.5 }
  ]) noMutation(game, () => game.buyUpgradeBatch('auto', value), 'invalid-upgrade-batch');
  noMutation(game, () => game.buyUpgradeBatch('__proto__', quote), 'invalid-upgrade');
  noMutation(game, () => game.buyUpgradeBatch('auto', { ...quote, cost: quote.cost + 1 }), 'stale-upgrade');
});

test('stale level or machine prices, insufficient funds, and newly completed reserves reject atomically', () => {
  const levelChanged = factory(); levelChanged.state.coins = 1e10; const first = bulk(levelChanged);
  levelChanged.buyUpgrade('auto'); noMutation(levelChanged, () => levelChanged.buyUpgradeBatch('auto', first), 'stale-upgrade');
  const machineChanged = factory(); machineChanged.state.coins = 1e10; const old = bulk(machineChanged); machineChanged.state.machine = 5;
  noMutation(machineChanged, () => machineChanged.buyUpgradeBatch('auto', old), 'stale-upgrade');
  const poor = factory(); poor.state.coins = 1e10; const costly = bulk(poor); poor.state.coins = costly.cost - 1;
  noMutation(poor, () => poor.buyUpgradeBatch('auto', costly), 'not-enough-coins');
  const funded = factory(); funded.state.coins = CONFIG.machines[5].cost - 1; const beforeFunding = bulk(funded); funded.state.coins++;
  noMutation(funded, () => funded.buyUpgradeBatch('auto', beforeFunding), 'machine-fund-reserved');
  const capped = factory(5); capped.state.upgrades.auto = 23; capped.state.coins = 1e15;
  noMutation(capped, () => capped.buyUpgradeBatch('auto', { count: 2, fromLevel: 23, cost: totalPrice('auto', 23, 2, 5) }), 'max-level');
});

test('pending advertisements block batches until resolved without invalidating or repricing the reward quote', () => {
  const game = factory(); game.state.coins = 1e10; const purchase = bulk(game), ad = game.quoteReward('turbo');
  assert.ok(ad); assert.equal(bulk(game).reason, 'busy');
  noMutation(game, () => game.buyUpgradeBatch('auto', purchase), 'busy');
  assert.deepEqual(game.quoteReward('turbo'), ad); game.cancelReward(ad.id);
  assert.equal(game.buyUpgradeBatch('auto', purchase).ok, true);
  noMutation(game, () => game.buyUpgradeBatch('auto', purchase), 'stale-upgrade');
});

test('milestone and batch previews are read-only, omit turbo from permanent gains, and leave accrued offline packs unchanged', () => {
  const game = factory(); game.state.coins = 1e10;
  game.state.offline = { id: 'offline:earned', seconds: 60, production: 100, coins: 200 };
  const before = game.exportSave(NOW), first = bulk(game);
  for (let i = 0; i < 5; i++) game.getView();
  assert.deepEqual(game.exportSave(NOW), before); assert.deepEqual(game.drainEvents(), []);
  game.state.boostSeconds = 90; assert.deepEqual(bulk(game), first);
  const pack = { ...game.state.offline }; assert.equal(game.buyUpgradeBatch('auto', first).ok, true);
  assert.deepEqual(game.state.offline, pack); assert.equal(game.state.heatRecoveryTaps, 0);
  const reload = new Game({ save: game.exportSave(NOW), now: NOW });
  assert.equal(reload.state.upgrades.auto, first.toLevel); assert.equal(reload.state.heatRecoveryTaps, 0);
  for(const key of ['id','seconds','production','coins'])assert.equal(reload.state.offline[key],pack[key]);
  assert.equal(reload.state.offline.factorySegments[0].contractId,null);
});
