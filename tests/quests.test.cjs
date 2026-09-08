'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG, QUEST_CHAPTERS } = require('../src/core.js');
const now = 1000000, fresh = () => new Game({ now });
const items = game => game.getView().quests.chapters.flatMap(chapter => chapter.quests);
const quest = (game, id) => items(game).find(item => item.id === id);
const totalRewards = QUEST_CHAPTERS.flatMap(chapter => chapter.quests).reduce((sum, item) => sum + item.reward, 0);
function completeSave() {
  const game = fresh();
  Object.assign(game.state, { taps: 100, bursts: 10, machine: 5, orderIndex: 20,
    totalProduced: CONFIG.orders[19].target, upgrades: { tap: 24, auto: 24, value: 24 } });
  const save = game.exportSave(now); delete save.factory; delete save.claimedQuests; return save;
}

test('new factory has four ordered growth chapters with no paid or ready goals', () => {
  const game = fresh(), view = game.getView().quests;
  assert.equal(view.chapters.length, 4); assert.equal(view.total, 16); assert.equal(view.claimedCount, 0);
  assert.equal(view.readyCount, 0); assert.equal(view.complete, false); assert.equal(view.activeChapterId, 'start');
  assert.equal(view.focus.id, 'start-taps');
  assert.deepEqual(view.chapters.map(chapter => chapter.unlocked), [true, false, false, false]);
});

test('fifth tap automatically pays the fixed reward once without a separate claim or ad', () => {
  const game = fresh(); for (let i = 0; i < 4; i++) game.tap();
  assert.equal(quest(game, 'start-taps').progress, .8); assert.equal(game.state.coins, 4);
  game.drainEvents(); game.tap();
  assert.equal(game.state.coins, 13); assert.equal(game.state.totalProduced, 5); assert.equal(game.state.energy, 10);
  assert.equal(quest(game, 'start-taps').claimed, true); assert.equal(quest(game, 'start-taps').ready, false);
  assert.equal(game.state.rewardedCount, 0);
  const awards = game.drainEvents().filter(event => event.type === 'quest');
  assert.deepEqual(awards, [{ type: 'quest', id: 'start-taps', title: '亲手爆香', coins: 8, automatic: true }]);
  const saved = game.exportSave(now); assert.equal(game.claimQuest('start-taps').reason, 'already-claimed');
  assert.deepEqual(game.exportSave(now), saved);
});

test('upgrade and real order delivery trigger their own automatic rewards', () => {
  const game = fresh(); game.state.upgrades.tap = 1;
  game.state.claimedQuests = ['start-tap-upgrade'];
  game.state.coins = CONFIG.upgrades.auto.baseCost;
  assert.equal(game.buyUpgrade('auto').ok, true); assert.equal(game.state.coins, 16);
  assert.equal(quest(game, 'start-auto-upgrade').claimed, true);
  assert.equal(game.getView().quests.chapters[1].unlocked, false);
  game.state.totalProduced = CONFIG.orders[0].target;
  assert.equal(quest(game, 'start-order').claimed, false);
  const coins = game.state.coins; assert.equal(game.claimOrder().ok, true);
  assert.equal(game.state.coins - coins, CONFIG.orders[0].reward + 24);
  assert.equal(quest(game, 'start-order').claimed, true); assert.equal(game.state.rewardedCount, 0);
});

test('historical progress pays through every unlocked chapter once on legacy migration', () => {
  const save = completeSave(), game = new Game({ save, now });
  assert.equal(game.state.coins, totalRewards); assert.equal(game.state.totalCoins, totalRewards);
  assert.equal(game.getView().quests.complete, true); assert.equal(game.getView().quests.claimedCount, 16);
  assert.ok(game.drainEvents().filter(event => event.type === 'quest').every(event => event.automatic));
  const again = new Game({ save: game.exportSave(now), now });
  assert.equal(again.state.coins, game.state.coins); assert.equal(again.drainEvents().filter(event => event.type === 'quest').length, 0);
});

test('later chapters retain progress but do not pay through an unfinished earlier chapter', () => {
  const save = completeSave(); save.taps = 0;
  const game = new Game({ save, now });
  assert.equal(game.getView().quests.chapters[1].unlocked, false);
  assert.equal(quest(game, 'operate-burst').progress, 1); assert.equal(quest(game, 'operate-burst').claimed, false);
  assert.equal(game.state.claimedQuests.length, 3);
  // One defined QA setup changes the missing historical fact; a real tick then
  // performs the same automatic chapter catch-up used by ordinary gameplay.
  game.state.taps = 5; game.tick(.001);
  assert.equal(game.getView().quests.complete, true); assert.equal(game.state.claimedQuests.length, 16);
});

test('claim identifiers reject unknown input without mutation', () => {
  const game = fresh(), before = game.exportSave(now);
  for (const id of [null, undefined, 0, {}, [], 'constructor', '__proto__', 'toString', 'unknown', '']) {
    assert.equal(game.claimQuest(id).reason, 'unknown-quest'); assert.deepEqual(game.exportSave(now), before);
  }
});

test('corrupt claim lists are whitelisted and cannot supply saved reward amounts', () => {
  const save = fresh().exportSave(now); save.taps = 5;
  save.claimedQuests = ['start-taps', 'start-taps', 'unknown', '__proto__', { id: 'start-order' }, 17, null, 'finish-tower'];
  save.quests = [{ id: 'start-order', ready: true, reward: 1e100 }];
  const game = new Game({ save, now });
  assert.deepEqual(game.state.claimedQuests, ['start-taps', 'finish-tower']); assert.equal(game.state.coins, 0);
  assert.equal(game.claimQuest('start-order').reason, 'quest-not-ready');
});

test('missing or malformed claim lists pay a valid historical goal once and preserve other fields', () => {
  for (const claimedQuests of [undefined, null, false, 7, 'start-taps', { 'start-taps': true }]) {
    const save = fresh().exportSave(now); Object.assign(save, { claimedQuests, taps: 5, coins: 123, totalCoins: 123 });
    const game = new Game({ save, now });
    assert.deepEqual(game.state.claimedQuests, ['start-taps']); assert.equal(game.state.coins, 131);
    assert.equal(new Game({ save: game.exportSave(now), now }).state.coins, 131);
  }
});

test('invalid legacy metrics cannot manufacture chapter completion', () => {
  const save = fresh().exportSave(now); delete save.factory;
  Object.assign(save, { taps: Infinity, bursts: -4, orderIndex: 20, totalProduced: NaN,
    machine: 5, upgrades: { tap: Infinity, auto: '24', value: -1 } });
  const game = new Game({ save, now });
  for (const item of items(game)) { assert.equal(item.current, 0); assert.equal(item.ready, false); assert.ok(Number.isFinite(item.progress)); }
  assert.equal(game.state.coins, 0);
});

test('frozen definitions and copied view rows cannot rewrite authoritative automatic rewards', () => {
  assert.equal(Object.isFrozen(QUEST_CHAPTERS), true);
  assert.throws(() => { QUEST_CHAPTERS[0].quests[0].reward = 1e100; }, TypeError);
  const game = fresh(), item = quest(game, 'start-taps'); item.reward = 1e100; item.target = 1; item.ready = true;
  game.tap(); assert.equal(game.state.coins, 1);
  for (let i = 1; i < 5; i++) game.tap();
  assert.equal(game.state.coins, 13);
  const exported = game.exportSave(now); exported.claimedQuests.length = 0;
  assert.equal(game.claimQuest('start-taps').reason, 'already-claimed');
});

test('completion keeps all growth rewards claimed without creating a repeat order', () => {
  const game = new Game({ save: completeSave(), now }), before = game.state.claimedQuests.slice();
  assert.equal(game.getView().order.completed, true); assert.equal(game.claimOrder().ok, false);
  game.tick(10); assert.deepEqual(game.state.claimedQuests, before);
  assert.equal(game.getView().quests.readyCount, 0); assert.equal(game.getView().quests.complete, true);
});
