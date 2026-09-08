'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core.js');

const now = 1000000;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);
function factory() {
  const game = new Game({ now });
  Object.assign(game.state, { playedSeconds: 120, coins: 20000, totalCoins: 20000, orderIndex: 3, totalProduced: 2500 });
  game.state.upgrades = { tap: 3, auto: 4, value: 2 };
  return game;
}
function copy(game) { return new Game({ save: game.exportSave(now), now }); }
function advance(game, seconds) {
  while (seconds > 0) { const dt = Math.min(30, seconds); game.tick(dt); seconds -= dt; }
}

test('all reward previews are readable view data and do not change saves, events or reward eligibility', () => {
  const game = factory(), before = game.exportSave(now);
  for (const [kind, offer] of Object.entries(game.getView().rewards)) {
    assert.equal(typeof offer.impact.title, 'string', kind);
    assert.equal(typeof offer.impact.detail, 'string', kind);
    assert.ok(offer.impact.title.length && offer.impact.detail.length, kind);
    assert.equal(offer.cooldown, 0, kind);
  }
  assert.deepEqual(game.exportSave(now), before);
  assert.deepEqual(game.drainEvents(), []);
  const quote = game.quoteReward('turbo');
  assert.equal(Object.hasOwn(quote, 'impact'), false);
  assert.equal(Object.hasOwn(game.exportSave(now).pendingRewards[quote.id], 'impact'), false);
});

test('sponsor remaining funds predict actual credit, including enough funds and outstanding order conditions', () => {
  for (const coins of [10, CONFIG.machines[1].cost - 1]) {
    const game = factory(); game.state.coins = coins;
    const offer = game.getView().rewards.sponsor, preview = offer.impact;
    assert.equal(preview.extraCoins, offer.amount);
    const quote = game.quoteReward('sponsor');
    assert.equal(game.applyReward(quote.id).ok, true);
    close(game.state.coins, preview.coinsAfter);
    close(Math.max(0, CONFIG.machines[1].cost - game.state.coins), preview.machineCoinsMissing);
    assert.equal(game.getView().canEvolve, preview.canEvolveAfter);
  }
  const blocked = factory(); blocked.state.orderIndex = 0; blocked.state.coins = CONFIG.machines[1].cost - 1;
  const offer = blocked.getView().rewards.sponsor;
  assert.equal(offer.available, false);
  assert.equal(offer.impact.ordersMissing, 3);
  assert.equal(offer.impact.machineCoinsMissing, 0);
  assert.equal(offer.impact.canEvolveAfter, false);
  assert.match(offer.impact.detail, /还需完成 3 张主线订单/);
});

test('order preview separates free settlement from the exact incremental ad reward', () => {
  const game = factory(), ordinary = copy(game), before = game.state.coins;
  const preview = game.getView().rewards.order.impact;
  assert.equal(ordinary.claimOrder().ok, true);
  const quote = game.quoteReward('order'); assert.ok(quote);
  assert.equal(game.applyReward(quote.id).ok, true);
  close(ordinary.state.coins - before, preview.freeCoins);
  close(game.state.coins - ordinary.state.coins, preview.extraCoins);
  close(game.state.coins - before, preview.totalCoins);
  close(game.state.coins, preview.coinsAfter);
  assert.equal(preview.extraCoins, preview.freeCoins * 2);
  assert.equal(preview.totalCoins, preview.freeCoins * 3);
});

test('offline preview uses the stored pack and doubles coins without doubling lifetime production', () => {
  const source = factory(), game = new Game({ save: source.exportSave(now), now: now + 600000 });
  const ordinary = new Game({ save: game.exportSave(now + 600000), now: now + 600000 });
  const before = game.state.coins, preview = game.getView().rewards.offline.impact;
  ordinary.claimOffline();
  const quote = game.quoteReward('offline'); assert.ok(quote);
  assert.equal(game.applyReward(quote.id).ok, true);
  close(ordinary.state.coins - before, preview.freeCoins);
  close(game.state.coins - ordinary.state.coins, preview.extraCoins);
  close(game.state.coins - before, preview.totalCoins);
  close(game.state.totalProduced, ordinary.state.totalProduced);
});

test('brand preview matches permanent tap and automatic rates and excludes the temporary turbo multiplier', () => {
  const game = factory(); game.state.machine = 1; game.state.brandLevel = 1; game.state.boostSeconds = 90;
  const before = game.getView().production, preview = game.getView().rewards.brand.impact;
  assert.equal(preview.autoIncomeBefore, before.baseIncome);
  assert.equal(preview.tapBefore, before.tap);
  assert.equal(preview.bonusPercentBefore, 20);
  assert.equal(preview.bonusPercentAfter, 40);
  assert.equal(preview.percentagePoints, 20);
  const quote = game.quoteReward('brand'); assert.ok(quote);
  assert.equal(game.applyReward(quote.id).ok, true);
  const after = game.getView().production;
  close(after.baseIncome, preview.autoIncomeAfter);
  close(after.tap, preview.tapAfter);
  close(after.auto * after.price, preview.autoIncomeAfter * CONFIG.turboMultiplier);
});

for (const existingSeconds of [0, 37, 86380]) {
  test(`turbo preview predicts only extra automatic income over the added time, with ${existingSeconds}s already active`, () => {
    const game = factory(); game.state.boostSeconds = existingSeconds;
    const ordinary = copy(game), preview = game.getView().rewards.turbo.impact;
    assert.equal(preview.estimated, true);
    assert.match(preview.title, /预计/);
    assert.match(preview.detail, /点击与免费爆锅收益不变/);
    assert.equal(preview.startsAfterSeconds, existingSeconds);
    assert.equal(preview.seconds, Math.min(CONFIG.turboDuration, 86400 - existingSeconds));
    const quote = game.quoteReward('turbo'); assert.ok(quote);
    assert.equal(game.applyReward(quote.id).ok, true);
    // Both factories trigger exactly the same tap and burst production while only
    // the advert route receives added automatic production time.
    for (let i = 0; i < 50; i++) { close(game.tap().amount, ordinary.tap().amount); }
    close(game.state.coins, ordinary.state.coins);
    advance(game, existingSeconds + preview.seconds);
    advance(ordinary, existingSeconds + preview.seconds);
    close(game.state.coins - ordinary.state.coins, preview.extraCoins);
    close(game.state.totalProduced - ordinary.state.totalProduced, preview.extraProduction);
    assert.equal(game.state.bursts, ordinary.state.bursts);
    assert.equal(game.state.boostSeconds, 0);
  });
}
