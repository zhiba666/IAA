'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG, QUEST_CHAPTERS } = require('../src/core.js');
const now = 1000000;
const fresh = () => new Game({ now });
const items = game => game.getView().quests.chapters.flatMap(chapter => chapter.quests);
const quest = (game, id) => items(game).find(item => item.id === id);
function finishProgress(game) {
  Object.assign(game.state, { taps: 100, bursts: 10, machine: 5, orderIndex: 20, totalProduced: CONFIG.orders[19].target });
  game.state.upgrades = { tap: 24, auto: 24, value: 24 };
}
function claimChapter(game, index) {
  for (const q of QUEST_CHAPTERS[index].quests) assert.equal(game.claimQuest(q.id).ok, true, q.id);
}

test('new factory offers optional opening goals while keeping later chapters locked', () => {
  const game = fresh(), view = game.getView().quests;
  assert.equal(view.chapters.length, 4); assert.equal(view.total, 16); assert.equal(view.claimedCount, 0);
  assert.equal(view.readyCount, 0); assert.equal(view.complete, false); assert.equal(view.activeChapterId, 'start');
  assert.equal(view.focus.id, 'start-taps'); assert.equal(view.focus.action, 'tap');
  assert.deepEqual(view.chapters.map(chapter => chapter.unlocked), [true, false, false, false]);
  for (const item of items(game)) { assert.equal(item.current, 0); assert.equal(item.progress, 0); assert.equal(item.claimed, false); }
  assert.deepEqual(game.state.claimedQuests, []); assert.equal(game.tap().ok, true);
});

test('five taps require a manual claim and award only the fixed coins once', () => {
  const game = fresh();
  for (let i = 0; i < 4; i++) game.tap();
  assert.equal(quest(game, 'start-taps').current, 4); assert.equal(quest(game, 'start-taps').progress, 0.8);
  assert.equal(game.claimQuest('start-taps').reason, 'quest-not-ready');
  game.tap(); assert.equal(game.state.coins, 5); assert.equal(quest(game, 'start-taps').ready, true);
  game.drainEvents(); const energy = game.state.energy, produced = game.state.totalProduced;
  assert.deepEqual(game.claimQuest('start-taps'), { ok: true, coins: 8, id: 'start-taps', title: '亲手爆香' });
  assert.equal(game.state.coins, 13); assert.equal(game.state.totalCoins, 13);
  assert.equal(game.state.totalProduced, produced); assert.equal(game.state.energy, energy);
  assert.equal(game.state.rewardedCount, 0); assert.equal(game.state.lastRewardAt, fresh().state.lastRewardAt);
  assert.deepEqual(game.drainEvents(), [{ type: 'quest', id: 'start-taps', title: '亲手爆香', coins: 8 }]);
  const saved = game.exportSave(now);
  assert.equal(game.claimQuest('start-taps').reason, 'already-claimed');
  assert.deepEqual(game.exportSave(now), saved); assert.deepEqual(game.drainEvents(), []);
});

test('completed goals in the same chapter can be claimed in any order and focus prefers ready goals', () => {
  const game = fresh(); game.state.coins = CONFIG.upgrades.auto.baseCost;
  assert.equal(game.buyUpgrade('auto').ok, true); assert.equal(game.state.coins, 0);
  assert.equal(game.getView().quests.focus.id, 'start-auto-upgrade');
  assert.equal(game.claimQuest('start-auto-upgrade').coins, 16);
  assert.equal(game.getView().quests.focus.id, 'start-taps');
  assert.equal(game.getView().quests.claimedCount, 1);
  assert.equal(game.getView().quests.chapters[1].unlocked, false);
});

test('orders count only when loaded, while ordinary claims require no adverts', () => {
  const game = fresh(); game.state.totalProduced = CONFIG.orders[0].target;
  assert.equal(quest(game, 'start-order').current, 0);
  assert.equal(game.claimQuest('start-order').reason, 'quest-not-ready');
  assert.equal(game.claimOrder().ok, true); assert.equal(quest(game, 'start-order').ready, true);
  assert.equal(game.claimQuest('start-order').coins, 24); assert.equal(game.state.rewardedCount, 0);
});

test('future progress is retained but rewards unlock only after every preceding chapter claim', () => {
  const game = fresh(); finishProgress(game);
  const later = quest(game, 'operate-burst');
  assert.equal(later.current, 1); assert.equal(later.progress, 1); assert.equal(later.locked, true); assert.equal(later.ready, false);
  const before = game.exportSave(now);
  assert.equal(game.claimQuest('operate-burst').reason, 'quest-locked'); assert.deepEqual(game.exportSave(now), before);
  for (const q of QUEST_CHAPTERS[0].quests.slice(0, -1)) game.claimQuest(q.id);
  assert.equal(game.getView().quests.chapters[1].unlocked, false);
  game.claimQuest(QUEST_CHAPTERS[0].quests.at(-1).id);
  const view = game.getView().quests;
  assert.equal(view.activeChapterId, 'operate'); assert.equal(view.chapters[0].complete, true);
  assert.equal(view.readyCount, 4); assert.equal(quest(game, 'operate-burst').ready, true);
  assert.equal(view.focus.id, 'operate-value');
});

test('passive free bursts and all three permanent upgrade types contribute without reward videos', () => {
  const game = fresh();
  game.state.taps = 5; game.state.orderIndex = 1; game.state.totalProduced = 50; game.state.upgrades = { tap: 1, auto: 1, value: 0 };
  claimChapter(game, 0);
  game.tick(60); game.tick(40);
  assert.equal(quest(game, 'operate-burst').ready, true); assert.equal(game.claimQuest('operate-burst').coins, 60);
  assert.equal(game.buyUpgrade('value').ok, true); assert.equal(quest(game, 'operate-value').ready, true);
  game.state.coins = 10000; while (game.state.upgrades.auto < 4) assert.equal(game.buyUpgrade('auto').ok, true);
  assert.equal(quest(game, 'operate-auto').ready, true); assert.equal(game.state.rewardedCount, 0);
});

test('saving and loading retains claims and unclaimed progress without repeated rewards', () => {
  const game = fresh(); for (let i = 0; i < 5; i++) game.tap(); game.claimQuest('start-taps');
  game.state.coins = 100; game.buyUpgrade('tap');
  const saved = game.exportSave(now), restored = new Game({ save: JSON.stringify(saved), now });
  assert.equal(restored.state.version, 1); assert.deepEqual(restored.state.claimedQuests, ['start-taps']);
  assert.equal(restored.state.coins, saved.coins);
  assert.equal(restored.claimQuest('start-taps').reason, 'already-claimed');
  assert.equal(quest(restored, 'start-tap-upgrade').ready, true);
  assert.equal(restored.claimQuest('start-tap-upgrade').coins, 12);
  const secondSave = restored.exportSave(now), again = new Game({ save: secondSave, now });
  assert.equal(again.claimQuest('start-tap-upgrade').reason, 'already-claimed');
  assert.equal(again.state.coins, secondSave.coins);
});

test('version 1 saves without quest fields recover historical progress and grant each reward at most once', () => {
  const source = fresh(); finishProgress(source); const save = source.exportSave(now); delete save.claimedQuests;
  const game = new Game({ save, now });
  assert.equal(game.loadWarning, null); assert.equal(game.getView().quests.readyCount, 4);
  const initialCoins = game.state.coins;
  for (const [index, chapter] of QUEST_CHAPTERS.entries()) {
    assert.equal(game.getView().quests.activeChapterId, chapter.id);
    for (const q of [...chapter.quests].reverse()) {
      assert.equal(game.claimQuest(q.id).coins, q.reward);
      assert.equal(game.claimQuest(q.id).reason, 'already-claimed');
    }
    assert.equal(game.getView().quests.chapters[index].complete, true);
  }
  const totalRewards = QUEST_CHAPTERS.flatMap(chapter => chapter.quests).reduce((sum, q) => sum + q.reward, 0);
  assert.equal(game.state.coins - initialCoins, totalRewards); assert.equal(game.state.totalCoins, totalRewards);
  const view = game.getView().quests;
  assert.equal(view.complete, true); assert.equal(view.claimedCount, 16); assert.equal(view.readyCount, 0);
  assert.equal(view.focus, null); assert.equal(view.activeChapterId, null);
  const restored = new Game({ save: game.exportSave(now), now });
  assert.equal(restored.getView().quests.complete, true); assert.equal(restored.state.coins, game.state.coins);
  assert.equal(restored.drainEvents().length, 0);
});

test('claim identifiers reject unknown strings and non-string input without mutation', () => {
  const game = fresh(); finishProgress(game); const before = game.exportSave(now);
  for (const id of [null, undefined, 0, {}, [], 'constructor', '__proto__', 'toString', 'unknown', '']) {
    assert.equal(game.claimQuest(id).reason, 'unknown-quest');
    assert.deepEqual(game.exportSave(now), before);
  }
  assert.deepEqual(game.drainEvents(), []);
});

test('corrupt claimed quests are deduplicated and whitelisted without trusting saved rewards', () => {
  const save = fresh().exportSave(now);
  save.taps = 5;
  save.claimedQuests = ['start-taps', 'start-taps', 'unknown', '__proto__', { id: 'start-order' }, 17, null, 'finish-tower'];
  save.quests = [{ id: 'start-order', ready: true, reward: 1e100 }];
  const game = new Game({ save, now });
  assert.deepEqual(game.state.claimedQuests, ['start-taps', 'finish-tower']);
  assert.equal(game.state.coins, 0); assert.equal(game.getView().quests.claimedCount, 2);
  assert.equal(game.claimQuest('start-taps').reason, 'already-claimed');
  assert.equal(game.claimQuest('finish-tower').reason, 'already-claimed');
  assert.equal(game.claimQuest('start-order').reason, 'quest-not-ready');
  assert.equal(game.getView().quests.chapters[1].unlocked, false);
  assert.equal(game.tap().ok, true);
});

test('missing or malformed quest claim lists safely default without affecting other save fields', () => {
  for (const claimedQuests of [undefined, null, false, 7, 'start-taps', { 'start-taps': true }]) {
    const save = fresh().exportSave(now); save.claimedQuests = claimedQuests; save.taps = 5; save.coins = 123;
    const game = new Game({ save, now });
    assert.deepEqual(game.state.claimedQuests, []); assert.equal(game.state.coins, 123);
    assert.equal(game.claimQuest('start-taps').coins, 8);
  }
});

test('sanitized save metrics cannot make impossible chapter goals ready', () => {
  const save = fresh().exportSave(now);
  Object.assign(save, { taps: Infinity, bursts: -4, orderIndex: 20, totalProduced: NaN, machine: 5, upgrades: { tap: Infinity, auto: '24', value: -1 } });
  const game = new Game({ save, now });
  for (const q of items(game)) { assert.equal(q.current, 0); assert.equal(q.ready, false); assert.equal(Number.isFinite(q.progress), true); }
  assert.equal(game.claimQuest('start-order').reason, 'quest-not-ready');
});

test('definitions and returned view data cannot rewrite authoritative rewards', () => {
  assert.equal(Object.isFrozen(QUEST_CHAPTERS), true);
  assert.throws(() => { QUEST_CHAPTERS[0].quests[0].reward = 1e100; }, TypeError);
  const game = fresh(); for (let i = 0; i < 5; i++) game.tap();
  const item = quest(game, 'start-taps'); item.reward = 1e100; item.ready = false;
  assert.equal(game.claimQuest('start-taps').coins, 8);
  const exported = game.exportSave(now); exported.claimedQuests.length = 0;
  assert.equal(game.claimQuest('start-taps').reason, 'already-claimed');
});

test('quest progress never resets after chapter unlock, purchases, later machines, or loop orders', () => {
  const game = fresh(); finishProgress(game); game.state.loopIndex = 30;
  game.state.coins = 0;
  for (const [index] of QUEST_CHAPTERS.entries()) claimChapter(game, index);
  for (const q of items(game)) { assert.equal(q.current, q.target); assert.equal(q.progress, 1); assert.equal(q.claimed, true); }
  game.state.totalProduced = game.getView().order.target;
  assert.equal(game.claimOrder().ok, true); assert.equal(game.getView().quests.complete, true);
  assert.equal(game.getView().quests.readyCount, 0);
});
