'use strict';
const { legacyGame } = require('./legacy-fixture.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG, QUEST_CHAPTERS, formatNumber } = require('../src/core.js');
// Isolate economy from one-time teaching grants (covered in quests.test).
const fresh = () => { const game=legacyGame({now:1000000});game.state.claimedQuests=QUEST_CHAPTERS.flatMap(c=>c.quests.map(q=>q.id));return game; };
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-10), `${label || 'value'}: ${actual} ≠ ${expected}`);
const advance = (game, seconds, step = 1) => { while (seconds > 0) { const dt = Math.min(step, seconds); game.tick(dt); seconds -= dt; } };
function eligible(kind) {
  const game = fresh();
  game.state.playedSeconds = CONFIG.rewardUnlockSeconds;
  if (kind === 'order') game.state.totalProduced = CONFIG.orders[0].target;
  if (kind === 'sponsor') { game.state.orderIndex = 3; game.state.totalProduced = CONFIG.orders[2].target; }
  if (kind === 'offline') game.state.offline = { id: 'offline:test', seconds: 60, production: 12, coins: 12 };
  return game;
}

test('one tap produces and sells immediately, with energy and events', () => {
  const game = fresh(); const result = game.tap();
  assert.equal(result.amount, 1); assert.equal(game.state.coins, 1);
  assert.equal(game.state.totalProduced, 1); assert.equal(game.state.taps, 1); assert.equal(game.state.energy, 2);
  assert.deepEqual(game.drainEvents().map(({type,source,amount,coins})=>({type,source,amount,coins})), [{ type: 'produce', source: 'tap', amount: 1, coins: 1 }]);
  assert.deepEqual(game.drainEvents(), []);
});
test('starter automation runs without any input or adverts', () => {
  const game = fresh(); game.tick(10);
  close(game.state.coins, 4); close(game.state.totalProduced, 4);
  assert.equal(game.state.energy, 10); assert.equal(game.state.taps, 0); assert.equal(game.state.rewardedCount, 0);
});
test('free burst includes permanent tap and automation and consumes energy', () => {
  const game = fresh();
  for (let i = 0; i < 50; i++) game.tap();
  assert.equal(game.state.bursts, 1); close(game.state.totalProduced, 50 + 24 + 0.4 * 8);
  assert.equal(game.state.energy, 0); assert.equal(game.state.rewardedCount, 0);
  assert.equal(game.drainEvents().filter(e => e.type === 'burst').length, 1);
});
test('2 taps/s triggers first free burst in 20 seconds', () => {
  const game = fresh();
  for (let i = 0; i < 19; i++) { game.tap(); game.tap(); game.tick(1); }
  assert.equal(game.state.bursts, 0); game.tap(); game.tap(); game.tick(1);
  assert.equal(game.state.bursts, 1); assert.equal(game.state.playedSeconds, 20);
});
test('each permanent upgrade charges its quoted cost and changes its actual output', () => {
  for (const key of ['tap', 'auto', 'value']) {
    const game = fresh(); const before = game.getView(); const quote = before.upgrades.find(u => u.key === key);
    game.state.coins = quote.cost - 0.001;
    assert.equal(game.buyUpgrade(key).reason, 'not-enough-coins');
    game.state.coins = quote.cost; const result = game.buyUpgrade(key);
    assert.equal(result.cost, quote.cost); assert.equal(game.state.coins, 0); assert.equal(game.state.upgrades[key], 1);
    const after = game.getView();
    assert.ok(after.production[key === 'value' ? 'price' : key] > before.production[key === 'value' ? 'price' : key]);
    assert.equal(after.upgrades.find(u => u.key === key).cost, Math.ceil(CONFIG.upgrades[key].baseCost * CONFIG.upgrades[key].growth));
  }
});
test('invalid and maxed upgrades cannot charge coins', () => {
  const game = fresh(); game.state.coins = 1e30; const before = game.state.coins;
  assert.equal(game.buyUpgrade('constructor').reason, 'invalid-upgrade');
  game.state.upgrades.tap = CONFIG.maxUpgradeLevel;
  assert.equal(game.buyUpgrade('tap').reason, 'max-level'); assert.equal(game.state.coins, before);
});
test('machines require main orders and exact funds, without an advert prerequisite', () => {
  const game = fresh(); const machine = CONFIG.machines[1]; game.state.coins = machine.cost;
  assert.equal(game.evolve().reason, 'orders-required');
  game.state.orderIndex = machine.requiredOrders; game.state.coins -= 0.001;
  assert.equal(game.evolve().reason, 'not-enough-coins'); game.state.coins = machine.cost;
  const before = game.getView().production; assert.equal(game.evolve().ok, true);
  assert.equal(game.state.coins, 0); assert.equal(game.state.rewardedCount, 0);
  close(game.getView().production.tap / before.tap, machine.multiplier);
  close(game.getView().production.price / before.price, machine.priceMultiplier);
});
test('unavailable rewards return no request and preserve resources', () => {
  const game = fresh();
  for (const kind of ['turbo', 'order', 'sponsor', 'offline', 'bogus']) assert.equal(game.quoteReward(kind), null);
  assert.equal(game.state.rewardSerial, 0); assert.equal(game.applyReward('unknown').reason, 'unknown-reward');
});
for (const kind of ['turbo', 'order', 'sponsor', 'offline']) {
  test(`${kind}: quoted reward freezes, request is exclusive, completion is idempotent`, () => {
    const game = eligible(kind); const quote = game.quoteReward(kind); assert.ok(quote);
    assert.deepEqual(game.quoteReward(kind), quote);
    const returnedCopy = game.quoteReward(kind); returnedCopy.amount = 1e100;
    assert.deepEqual(game.quoteReward(kind), quote);
    assert.equal(game.quoteReward(kind === 'turbo' ? 'sponsor' : 'turbo'), null);
    game.state.upgrades.auto = 10; game.state.upgrades.value = 10;
    const coins = game.state.coins; const produced = game.state.totalProduced;
    const result = game.applyReward(quote.id); assert.equal(result.ok, true); assert.equal(result.amount, quote.amount);
    if (kind === 'turbo') { assert.equal(game.state.boostSeconds, quote.duration); assert.equal(game.getView().production.turboMultiplier, 3); }
    if (kind === 'sponsor') close(game.state.coins - coins, quote.amount);
    if (kind === 'order') {
      close(game.state.coins - coins, CONFIG.orders[0].reward * 3); assert.equal(game.state.orderIndex, 1);
      const event = game.drainEvents().find(e => e.type === 'order'); assert.equal(event.multiplier, 3); assert.equal(event.coins, CONFIG.orders[0].reward * 3);
    }
    if (kind === 'offline') { close(game.state.coins - coins, 24); close(game.state.totalProduced - produced, 12); assert.equal(game.state.offline, null); }
    const snapshot = game.exportSave(1000000);
    assert.equal(game.applyReward(quote.id).reason, 'already-claimed'); assert.deepEqual(game.exportSave(1000000), snapshot);
    const restored = new Game({ save: snapshot, now: 1000000 });
    assert.equal(restored.applyReward(quote.id).reason, 'already-claimed');
  });
  test(`${kind}: cancellation awards nothing and does not impose a cooldown`, () => {
    const game = eligible(kind); const quote = game.quoteReward(kind); const before = game.state.coins;
    assert.equal(game.cancelReward(quote.id).ok, true); assert.equal(game.state.coins, before);
    assert.equal(game.state.rewardedCount, 0); assert.equal(game.applyReward(quote.id).reason, 'unknown-reward');
    const retry = game.quoteReward(kind); assert.ok(retry); assert.notEqual(retry.id, quote.id);
    game.cancelReward(retry.id);
    if (kind === 'order') assert.equal(game.claimOrder().ok, true);
    if (kind === 'offline') assert.equal(game.claimOffline().ok, true);
    const produced = game.state.totalProduced; game.tick(1); assert.ok(game.state.totalProduced > produced);
  });
}
test('reward completion has no cooldown; turbo can immediately extend duration without stacking multipliers', () => {
  const game = eligible('turbo'); let quote = game.quoteReward('turbo'); game.applyReward(quote.id);
  assert.equal(game.getView().rewards.turbo.available, true);
  const nextQuote = game.quoteReward('turbo'); assert.ok(nextQuote); assert.notEqual(nextQuote.id, quote.id);
  // A retained valid request promises a duration even if another boost remains.
  game.state.boostSeconds = 30; quote = game.quoteReward('turbo'); game.applyReward(quote.id);
  assert.equal(game.state.boostSeconds, 30 + CONFIG.turboDuration); assert.equal(game.getView().production.turboMultiplier, 3);
});
test('sponsor is capped at 60% of next device cost and excludes turbo multiplier', () => {
  const game = eligible('sponsor'); const base = game.getView().rewards.sponsor.amount;
  game.state.boostSeconds = 90; assert.equal(game.getView().rewards.sponsor.amount, base);
  game.state.upgrades.auto = 24; game.state.upgrades.value = 24;
  assert.equal(game.getView().rewards.sponsor.amount, Math.floor(CONFIG.machines[1].cost * 0.6));
});
test('ordinary order and offline claims invalidate in-flight bonus requests', () => {
  for (const kind of ['order', 'offline']) {
    const game = eligible(kind); const quote = game.quoteReward(kind);
    const result = kind === 'order' ? game.claimOrder() : game.claimOffline(); assert.equal(result.ok, true);
    const coins = game.state.coins; assert.equal(game.applyReward(quote.id).reason, 'unknown-reward'); assert.equal(game.state.coins, coins);
  }
});
test('offline is capped at 8h, uses 50% permanent automation, and ignores turbo and bursts', () => {
  const source = fresh(); source.state.upgrades.auto = 4; source.state.upgrades.value = 3; source.state.boostSeconds = 90;
  const p = source.getView().production; const restored = new Game({ save: source.exportSave(1000000), now: 1000000 + 12 * 3600000 });
  const offline = restored.state.offline; assert.equal(offline.seconds, 28800);
  close(offline.production, p.baseAuto * 28800 * 0.5); close(offline.coins, offline.production * p.price);
  assert.equal(restored.state.totalProduced, 0); assert.equal(restored.state.bursts, 0); assert.equal(restored.state.energy, 0); assert.equal(restored.state.boostSeconds, 0);
  assert.equal(restored.claimOffline().ok, true); assert.equal(restored.claimOffline().reason, 'no-offline-reward');
  const again = new Game({ save: restored.exportSave(50000000), now: 50000000 });
  assert.equal(again.state.offline, null); close(again.state.coins, offline.coins); close(again.state.totalProduced, offline.production);
});
test('unclaimed offline packs merge to one 8h cap; clock reversal and short absences do not award', () => {
  const start = fresh(); const savedAt = 1000000;
  assert.equal(new Game({ save: start.exportSave(savedAt), now: savedAt - 1000 }).state.offline, null);
  assert.equal(new Game({ save: start.exportSave(savedAt), now: savedAt + 29999 }).state.offline, null);
  const first = new Game({ save: start.exportSave(savedAt), now: savedAt + 5 * 3600000 });
  const second = new Game({ save: first.exportSave(savedAt + 5 * 3600000), now: savedAt + 10 * 3600000 });
  assert.equal(second.state.offline.seconds, 28800); close(second.state.offline.production, 0.4 * 28800 * 0.5);
});
test('malformed JSON and versions produce a playable initial factory', () => {
  for (const save of ['{bad json', { version: 999 }, [], 'null']) {
    const game = new Game({ save, now: 1000000 }); assert.ok(game.loadWarning); assert.equal(game.state.coins, 0);
    assert.equal(game.tap().ok, true); assert.equal(game.state.coins, 1);
  }
});
test('corrupt numeric fields are sanitized; orders and machines cannot exceed production prerequisites', () => {
  const save = fresh().exportSave(1000000);
  Object.assign(save, { coins: -7, totalCoins: Infinity, totalProduced: NaN, machine: 99, orderIndex: 999, energy: 999, boostSeconds: Infinity, taps: 1.7, loopIndex: 100, playedSeconds: 'bad' });
  delete save.factory; // exercise the original cumulative-save validation
  save.upgrades = { tap: 99, auto: -10, value: Infinity }; save.settings = { sound: false, haptics: 'bad' };
  save.pendingRewards = { hacked: { id: 'hacked', kind: 'sponsor', amount: Infinity } };
  const game = new Game({ save, now: 1000000 });
  assert.equal(game.state.coins, 0); assert.equal(game.state.totalProduced, 0); assert.equal(game.state.machine, 0); assert.equal(game.state.orderIndex, 0);
  assert.equal(game.state.loopIndex, 0); assert.equal(game.state.taps, 1); assert.deepEqual(game.state.upgrades, { tap: 24, auto: 0, value: 0 });
  assert.ok(game.state.energy < 100); assert.equal(game.state.settings.sound, false); assert.equal(game.state.settings.haptics, true);
  assert.deepEqual(game.state.pendingRewards, {}); assert.equal(game.tick(1).ok, true); assert.ok(Number.isFinite(game.state.coins));
});
test('coarse ticks match fine ticks, including boost expiry and several passive bursts', () => {
  const coarse = fresh(), fine = fresh(); coarse.state.boostSeconds = 17; fine.state.boostSeconds = 17;
  advance(coarse, 600, 60); advance(fine, 600, 0.25);
  for (const key of ['totalProduced', 'coins', 'boostSeconds', 'bursts', 'energy', 'playedSeconds']) close(coarse.state[key], fine.state[key], key);
  assert.equal(coarse.state.bursts, 6); assert.equal(coarse.state.playedSeconds, 600);
});
test('invalid dt cannot corrupt resources and a single oversized tick is bounded', () => {
  const game = fresh(); for (const value of [0, -1, Infinity, NaN, '1', null]) assert.equal(game.tick(value).ok, false);
  assert.equal(game.state.coins, 0); assert.equal(game.tick(1000000).seconds, 60); assert.equal(game.state.playedSeconds, 60);
});
test('number formatting handles zero, decimals and Chinese unit boundaries', () => {
  assert.equal(formatNumber(0), '0'); assert.equal(formatNumber(-1), '0'); assert.equal(formatNumber(1234.9), '1,234');
  assert.equal(formatNumber(10000), '1万'); assert.equal(formatNumber(12000), '1.2万'); assert.equal(formatNumber(100000000), '1亿');
});

test('six introductory orders use cumulative output; later orders require a chosen customer and end after twenty',()=>{
 const game=fresh();game.state.totalProduced=CONFIG.orders.at(-1).target;
 for(let i=0;i<6;i++)assert.equal(game.claimOrder().order.index,i);
 assert.equal(game.getView().order.awaitingSelection,true);
 assert.equal(game.claimOrder().ok,false);
 for(let i=6;i<20;i++){
   game.state.machine=CONFIG.machines.filter(m=>m.requiredOrders<=i).length-1;
   assert.equal(game.acceptContract('cinema').ok,true);
   for(let sec=0;sec<180&&!game.getView().order.ready;sec++)game.tick(1);
   const order=game.getView().order;assert.equal(order.ready,true);
   const before=game.state.coins,paid=game.claimOrder();
   close(game.state.coins-before,paid.coins);
   assert.equal(game.claimOrder().ok,false);
 }
 assert.equal(game.state.orderIndex,20);assert.equal(game.getView().order.completed,true);
 assert.equal(game.getView().order.isLoop,false);assert.equal(game.getView().rewards.order.available,false);
 const copy=new Game({save:game.exportSave(1000000),now:1000000});
 assert.equal(copy.state.orderIndex,20);assert.equal(copy.getView().order.completed,true);
});
