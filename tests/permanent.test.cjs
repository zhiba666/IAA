'use strict';
const { legacyGame } = require('./legacy-fixture.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG, QUEST_CHAPTERS } = require('../src/core.js');
const NOW = 1000000;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);
function factory(machine = 1, level = 0) {
  const game = legacyGame({ now: NOW });
  game.state.machine = machine;
  game.state.orderIndex = CONFIG.machines[machine].requiredOrders;
  game.state.totalProduced = game.state.orderIndex ? CONFIG.orders[game.state.orderIndex - 1].target : 0;
  game.state.playedSeconds = CONFIG.rewardUnlockSeconds;
  game.state.brandLevel = level;
  game.state.claimedQuests=QUEST_CHAPTERS.flatMap(c=>c.quests.map(q=>q.id));
  return game;
}
function completeBrand(game) {
  const quote = game.quoteReward('brand'); assert.ok(quote);
  assert.equal(quote.amount, 1); assert.equal(quote.duration, 0);
  assert.equal(quote.brandLevel, game.state.brandLevel);
  const result = game.applyReward(quote.id); assert.equal(result.ok, true);
  return { quote, result };
}

test('brand is unavailable before the first machine evolution and keeps the 90 second introduction', () => {
  const game = factory(0);
  assert.equal(game.getView().brand.level, 0); assert.equal(game.getView().brand.unlocked, false);
  assert.equal(game.getView().brand.unlockedLevelCap, 0);
  assert.equal(game.getView().rewards.brand.reason, 'brand-machine-required');
  assert.equal(game.quoteReward('brand'), null);
  game.state.machine = 1; game.state.playedSeconds = 89.99;
  assert.equal(game.getView().brand.unlocked, true);
  assert.equal(game.getView().rewards.brand.reason, 'intro-first'); assert.equal(game.quoteReward('brand'), null);
  game.tick(0.01); assert.ok(game.quoteReward('brand'));
});

test('completion grants exactly one permanent level with event data and no instant coins or production', () => {
  const game = factory(); const before = game.exportSave(NOW);
  const { quote, result } = completeBrand(game);
  assert.equal(result.brandLevel, 1); assert.equal(result.bonusPercent, 20);
  assert.equal(result.amount, 1); assert.equal(result.coins, 0); assert.equal(result.duration, 0);
  assert.equal(game.state.coins, before.coins); assert.equal(game.state.totalProduced, before.totalProduced);
  assert.equal(game.state.rewardedCount, 1);
  assert.deepEqual(game.drainEvents(), [{ type: 'reward', kind: 'brand', amount: 1, coins: 0, id: quote.id, brandLevel: 1, bonusPercent: 20 }]);
});

test('brand production scales linearly against the baseline to a maximum of 3 times at level 10 without changing price', () => {
  const game = factory(5); const baseline = game.getView().production;
  for (let level = 1; level <= CONFIG.brandMaxLevel; level++) {
    completeBrand(game); const view = game.getView();
    assert.equal(view.production.price, baseline.price);
    close(view.production.baseIncome, baseline.baseIncome * (1 + level * 0.2));
    close(view.production.tap, baseline.tap * (1 + level * 0.2)); close(view.production.baseAuto, baseline.baseAuto * (1 + level * 0.2));
    close(view.production.auto, baseline.auto * (1 + level * 0.2));
    assert.equal(view.brand.bonusPercent, level * 20); close(view.brand.multiplier, 1 + level * 0.2);
  }
  const view = game.getView(); assert.equal(view.brand.multiplier, 3); assert.equal(view.brand.maxed, true);
  assert.equal(view.brand.stageCapped, false); assert.equal(view.brand.nextBonusPercent, 200);
  assert.equal(view.brand.priceAfter, view.brand.priceBefore); assert.equal(view.brand.baseIncomeAfter, view.brand.baseIncomeBefore);
  assert.equal(view.brand.tapAfter, view.brand.tapBefore);
  assert.equal(view.rewards.brand.reason, 'brand-max-level'); assert.equal(game.quoteReward('brand'), null);
});

test('each evolved machine unlocks two brand levels and normal evolution releases the next pair', () => {
  const game = factory(1);
  for (let machine = 1; machine <= 5; machine++) {
    const cap = machine * 2;
    assert.equal(game.getView().brand.unlockedLevelCap, cap);
    while (game.state.brandLevel < cap) completeBrand(game);
    const view = game.getView(); assert.equal(view.brand.stageCapped, machine < 5);
    assert.equal(view.rewards.brand.reason, machine < 5 ? 'brand-stage-cap' : 'brand-max-level');
    assert.equal(game.quoteReward('brand'), null);
    if (machine < 5) {
      const next = CONFIG.machines[machine + 1];
      game.state.orderIndex = next.requiredOrders; game.state.totalProduced = CONFIG.orders[next.requiredOrders - 1].target;
      game.state.coins = next.cost;
      assert.equal(game.evolve().ok, true); assert.equal(game.state.brandLevel, cap);
      assert.equal(game.getView().rewards.brand.available, true);
    }
  }
});

for (const source of ['tap', 'auto', 'burst']) {
  test(`brand raises ${source} production and sale coins exactly once at the same price`, () => {
    const normal = factory(), branded = factory(1, 1), initialProduction = normal.state.totalProduced;
    for (const game of [normal, branded]) {
      game.state.upgrades = { tap: 3, auto: 4, value: 2 };
      if (source === 'tap') game.tap();
      else if (source === 'auto') game.tick(10);
      else { game.state.energy = 98; game.tap(); }
    }
    const plainEvents = normal.drainEvents(), brandEvents = branded.drainEvents();
    const plainSale = plainEvents.find(e => e.type === 'produce' && e.source === source);
    const brandSale = brandEvents.find(e => e.type === 'produce' && e.source === source);
    assert.ok(plainSale); assert.ok(brandSale); close(brandSale.amount, plainSale.amount * 1.2);
    close(brandSale.coins, plainSale.coins * 1.2);
    close(branded.state.totalProduced - initialProduction, (normal.state.totalProduced - initialProduction) * 1.2);
    assert.equal(branded.getView().production.price, normal.getView().production.price);
  });
}

test('turbo stacks only on auto production while permanent production and previews ignore its duration', () => {
  const game = factory(3, 4); game.state.upgrades = { tap: 5, auto: 6, value: 4 };
  const before = game.getView(); const quote = game.quoteReward('turbo'); assert.ok(quote); game.applyReward(quote.id);
  const after = game.getView();
  assert.equal(after.production.price, before.production.price); assert.equal(after.production.baseAuto, before.production.baseAuto);
  assert.equal(after.production.auto, before.production.auto * 3);
  assert.equal(after.production.baseIncome, before.production.baseIncome); assert.deepEqual(after.brand, before.brand);
  const coins = game.state.coins; game.tick(1); close(game.state.coins - coins, before.production.baseIncome * 3);
});

test('upgrade, machine, and next brand previews match actual outcomes including current brand production', () => {
  for (const key of ['tap', 'auto', 'value']) {
    const game = factory(2, 3); game.state.upgrades = { tap: 3, auto: 4, value: 5 };
    const before = game.getView(), upgrade = before.upgrades.find(u => u.key === key);
    const field = key === 'tap' ? 'tap' : key === 'auto' ? 'baseIncome' : 'price';
    close(upgrade.preview.before, before.production[field]); game.state.coins = upgrade.cost;
    assert.equal(game.buyUpgrade(key).ok, true); close(upgrade.preview.after, game.getView().production[field]);
  }
  const game = factory(2, 3); const view = game.getView();
  const { result } = completeBrand(game); assert.equal(result.bonusPercent, view.brand.nextBonusPercent);
  close(game.getView().production.price, view.brand.priceAfter); close(game.getView().production.baseIncome, view.brand.baseIncomeAfter);
  assert.equal(view.brand.priceBefore, view.brand.priceAfter); close(view.brand.tapBefore, view.production.tap);
  close(game.getView().production.tap, view.brand.tapAfter);
  const preview = game.getView().machinePreview, next = CONFIG.machines[3];
  game.state.orderIndex = next.requiredOrders; game.state.coins = next.cost;
  assert.equal(game.evolve().ok, true); close(game.getView().production.tap, preview.tapAfter);
  close(game.getView().production.baseIncome, preview.incomeAfter);
});


test('new offline earnings restore brand before calculation, boost production and coins and ignore temporary turbo', () => {
  const game = factory(3, 5); game.state.upgrades = { tap: 4, auto: 7, value: 6 }; game.state.boostSeconds = 90;
  const p = game.getView().production;
  const restored = new Game({ save: game.exportSave(NOW), now: NOW + 60000 });
  assert.equal(restored.state.brandLevel, 5); close(restored.state.offline.production, p.baseAuto * 60 * CONFIG.offlineEfficiency);
  close(restored.state.offline.coins, p.baseIncome * 60 * CONFIG.offlineEfficiency);
  const plainSave = game.exportSave(NOW); plainSave.brandLevel = 0;
  const plain = new Game({ save: plainSave, now: NOW + 60000 });
  close(restored.state.offline.production, plain.state.offline.production * 2);
  close(restored.state.offline.coins, plain.state.offline.coins * 2);
});

test('an existing offline pack stays frozen after brand upgrades and merges only later earnings at the new rate', () => {
  const game = factory(); game.state.offline = { id: 'offline:old', seconds: 60, production: 20, coins: 21 };
  completeBrand(game); const frozen = { ...game.state.offline }, p = game.getView().production;
  assert.deepEqual(frozen, { id: 'offline:old', seconds: 60, production: 20, coins: 21 });
  const restored = new Game({ save: game.exportSave(NOW), now: NOW + 120000 });
  close(restored.state.offline.coins, frozen.coins + p.baseIncome * 120 * CONFIG.offlineEfficiency);
  close(restored.state.offline.production, frozen.production + p.baseAuto * 120 * CONFIG.offlineEfficiency);
  const original = new Game({ save: game.exportSave(NOW), now: NOW });
  const offlineQuote = original.quoteReward('offline'); assert.ok(offlineQuote); assert.equal(offlineQuote.amount, frozen.coins);
  assert.equal(original.applyReward(offlineQuote.id).coins, frozen.coins * 2);
});

test('legacy version 1 saves missing brand fields retain baseline earnings and progress', () => {
  const game = factory(2); game.state.coins = 1234; const save = game.exportSave(NOW); delete save.brandLevel;
  const restored = new Game({ save, now: NOW + 60000 });
  assert.equal(restored.state.brandLevel, 0); assert.equal(restored.state.machine, 2);
  assert.equal(restored.state.coins, 1234); assert.equal(restored.loadWarning, null);
  close(restored.state.offline.coins, game.getView().production.baseIncome * 30);
});

test('brand save sanitization rejects non-numbers and clamps integers to legitimately restored capacity', () => {
  for (const [input, expected] of [[undefined, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0], ['2', 0], [null, 0], [{}, 0], [-1, 0], [1.9, 1], [99, 4]]) {
    const save = factory(2).exportSave(NOW); save.brandLevel = input;
    const restored = new Game({ save, now: NOW }); assert.equal(restored.state.brandLevel, expected);
    assert.ok(Number.isFinite(restored.getView().production.tap)); assert.ok(Number.isFinite(restored.getView().production.baseIncome));
  }
  const save = factory(5, 10).exportSave(NOW); save.orderIndex = 3; save.totalProduced = CONFIG.orders[2].target;
  const restored = new Game({ save, now: NOW }); assert.equal(restored.state.machine, 1); assert.equal(restored.state.brandLevel, 2);
  save.orderIndex = 0; save.totalProduced = 0;
  assert.equal(new Game({ save, now: NOW }).state.brandLevel, 0);
});

test('brand completion is idempotent across retries and reloads, and saved requests never auto-award', () => {
  const game = factory(); const quote = game.quoteReward('brand'); assert.ok(quote);
  const pending = new Game({ save: game.exportSave(NOW), now: NOW });
  assert.equal(pending.state.brandLevel, 0); assert.equal(pending.state.rewardedCount, 0); assert.deepEqual(pending.drainEvents(), []);
  assert.equal(pending.applyReward(quote.id).ok, true); assert.equal(pending.state.brandLevel, 1);
  const snapshot = pending.exportSave(NOW);
  assert.equal(pending.applyReward(quote.id).reason, 'already-claimed'); assert.deepEqual(pending.exportSave(NOW), snapshot);
  const restored = new Game({ save: snapshot, now: NOW }); assert.equal(restored.state.brandLevel, 1);
  assert.equal(restored.applyReward(quote.id).reason, 'already-claimed');
});

test('malformed saved brand quotes cannot grant levels, arbitrary money or turbo time', () => {
  for (const changed of [{ amount: 1000000 }, { amount: '1' }, { duration: 90 }, { brandLevel: -1 }, { brandLevel: 1 }, { brandLevel: 0.5 }, { brandLevel: '0' }, { brandLevel: NaN }, { brandLevel: Infinity }, { brandLevel: undefined }]) {
    const game = factory(), quote = game.quoteReward('brand'), save = game.exportSave(NOW);
    Object.assign(save.pendingRewards[quote.id], changed);
    const restored = new Game({ save, now: NOW });
    assert.deepEqual(restored.state.pendingRewards, {}); assert.equal(restored.applyReward(quote.id).reason, 'unknown-reward');
    assert.equal(restored.state.brandLevel, 0); assert.equal(restored.state.coins, 0); assert.equal(restored.state.boostSeconds, 0);
  }
});

test('stale brand levels or newly invalid machine capacity reject callbacks without recording completion', () => {
  for (const invalidate of [game => { game.state.brandLevel = 1; }, game => { game.state.machine = 0; }, game => { game.state.brandLevel = 2; }]) {
    const game = factory(), quote = game.quoteReward('brand'); invalidate(game);
    const before = game.exportSave(NOW); assert.equal(game.applyReward(quote.id).reason, 'stale-brand');
    assert.equal(game.state.brandLevel, before.brandLevel); assert.equal(game.state.coins, before.coins);
    assert.equal(game.state.rewardedCount, 0); assert.equal(game.state.lastRewardAt, before.lastRewardAt);
    assert.equal(game.applyReward(quote.id).reason, 'unknown-reward');
  }
});

test('cancelled or failed brand requests award nothing and keep a retry available', () => {
  const game = factory(), quote = game.quoteReward('brand'), before = game.exportSave(NOW);
  assert.equal(game.cancelReward(quote.id).ok, true); assert.equal(game.applyReward(quote.id).reason, 'unknown-reward');
  assert.equal(game.state.brandLevel, 0); assert.equal(game.state.rewardedCount, 0); assert.equal(game.state.lastRewardAt, before.lastRewardAt);
  assert.equal(game.getView().rewards.brand.available, true); const retry = game.quoteReward('brand');
  assert.ok(retry); assert.notEqual(retry.id, quote.id);
});

test('all eligible advertisements can follow each other immediately while pending requests remain exclusive', () => {
  const game = factory(2); game.acceptContract('cinema');
  while(!game.getView().order.ready)game.tick(1);
  game.state.playedSeconds=CONFIG.rewardUnlockSeconds;
  game.state.offline = { id: 'offline:test', seconds: 60, production: 20, coins: 22 };
  const first = game.quoteReward('brand'); assert.ok(first); assert.equal(game.quoteReward('turbo'), null);
  assert.deepEqual(game.quoteReward('brand'), first); assert.equal(game.applyReward(first.id).ok, true);
  for (const kind of ['turbo', 'order', 'offline', 'brand']) {
    const offer = game.getView().rewards[kind]; assert.equal(offer.available, true);
    const quote = game.quoteReward(kind); assert.ok(quote); assert.equal(game.applyReward(quote.id).ok, true);
  }
  assert.equal(game.state.playedSeconds, CONFIG.rewardUnlockSeconds); assert.equal(game.state.brandLevel, 2);
  assert.equal(game.state.rewardedCount, 5);
});

test('never rewarded timestamps remain outside the post-ad analytics window even after restore', () => {
  const game = new Game({ now: NOW }); assert.ok(game.state.lastRewardAt < -120);
  const restored = new Game({ save: game.exportSave(NOW), now: NOW }); assert.ok(restored.state.lastRewardAt < -120);
  const save = game.exportSave(NOW); delete save.lastRewardAt;
  assert.ok(new Game({ save, now: NOW }).state.lastRewardAt < -120);
});

test('brand preserves quoted contract settlement and fixed automatic teaching rewards', () => {
  for(const level of [0,6]){
    const game=factory(3,level);
    assert.ok(game.acceptContract('cinema').ok);
    const reward=game.getView().contracts.active.reward;
    while(!game.getView().order.ready)game.tick(1);
    const order=game.getView().order;assert.equal(order.reward, reward+game.getView().contracts.active.heldCoins);
    assert.equal(game.claimOrder().coins,order.reward);
    assert.ok(game.acceptContract('cinema').ok);
    while(!game.getView().order.ready)game.tick(1);
    const next=game.getView().order; const quote=game.quoteReward('order');assert.ok(quote);
    assert.equal(game.applyReward(quote.id).coins,next.reward*3);
    const teaching=factory(3,level);
    teaching.state.claimedQuests=[]; teaching.state.taps=4;teaching.drainEvents();teaching.tap();
    assert.equal(teaching.drainEvents().find(e=>e.type==='quest'&&e.id==='start-taps').coins,8);
    assert.equal(teaching.claimQuest('start-taps').ok,false);
  }
});
