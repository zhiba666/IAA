'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const NOW = 1000000;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);
function factory(index = 10, machine = index >= 18 ? 5 : index >= 14 ? 4 : 3) {
  const game = new Game({ now: NOW });
  Object.assign(game.state, { orderIndex: index, machine, totalProduced: CONFIG.orders[index - 1].target, playedSeconds: 120, bursts: 1 });
  game.state.upgrades = { tap: 16, auto: 14, value: 14 };
  return game;
}
function option(game, key = 'yield') { return game.getView().research.options.find(item => item.key === key); }
function start(game, key = 'yield') { const quote = option(game, key); assert.equal(game.startResearch(key, quote).ok, true); return quote; }
function finish(game, key = 'yield') { const quote = start(game, key); game._produce(quote.productionTarget, 'test'); return game.claimResearch(quote.id); }
function copy(game, later = 0) { return new Game({ save: game.exportSave(NOW), now: NOW + later }); }
function noMutation(game, callback, reason) {
  game.drainEvents(); const before = game.exportSave(NOW), result = callback();
  assert.equal(result.ok, false); if (reason) assert.equal(result.reason, reason);
  assert.deepEqual(game.exportSave(NOW), before); assert.deepEqual(game.drainEvents(), []);
}

test('research unlocks on the tenth claimed main order and old saves gain no unearned levels', () => {
  const game = factory(9, 2);
  assert.equal(game.getView().research.unlocked, false);
  noMutation(game, () => game.startResearch('yield', option(game)), 'research-locked');
  game.state.totalProduced = CONFIG.orders[9].target;
  assert.equal(game.getView().research.unlocked, false);
  game.claimOrder(); assert.equal(game.getView().research.unlocked, true);
  const save = game.exportSave(NOW); delete save.research;
  const legacy = new Game({ save, now: NOW });
  assert.deepEqual(legacy.state.research, { levels: { yield: 0, value: 0 }, serial: 0, active: null });
  assert.deepEqual(legacy.getView().production, game.getView().production);
  assert.equal(legacy.getView().research.maxLevels, 24);
});

test('research offers are free, use balanced permanent production, and getView has no side effects', () => {
  const game = factory(), quote = option(game), before = game.exportSave(NOW);
  assert.equal(quote.productionTarget, Math.max(CONFIG.research.minProduction, Math.ceil(game.getView().production.baseAuto * CONFIG.research.durationSeconds)));
  assert.equal(quote.level, 0); assert.equal(quote.maxLevel, 12); assert.equal(quote.canStart, true);
  close(quote.preview.after / quote.preview.before, CONFIG.research.multiplier);
  game.getView(); assert.deepEqual(game.exportSave(NOW), before); assert.deepEqual(game.drainEvents(), []);
  game.setProductionMode('premium'); game.state.boostSeconds = 90;
  assert.deepEqual(option(game), quote);
  game.setProductionMode('rush'); assert.deepEqual(option(game), quote);
  assert.equal(game.state.coins, 0); start(game);
  assert.equal(game.state.coins, 0); assert.equal(game.state.totalCoins, 0);
  const low = factory(10, 0); low.state.upgrades = { tap: 0, auto: 0, value: 0 };
  assert.equal(option(low).productionTarget, CONFIG.research.minProduction);
});

test('only new actual production advances research; readiness requires manual settlement', () => {
  const game = factory(), quote = start(game), produced = game.state.totalProduced;
  assert.equal(game.getView().research.active.production, 0);
  game.tap(); game.tick(10); game.state.energy = 99; game.tick(1);
  close(game.getView().research.active.production, Math.min(quote.productionTarget, game.state.totalProduced - produced));
  game._produce(quote.productionTarget, 'test');
  const ready = game.getView().research.active;
  assert.equal(ready.production, quote.productionTarget); assert.equal(ready.progress, 1); assert.equal(ready.ready, true);
  assert.equal(game.state.research.levels.yield, 0);
  const before = { coins: game.state.coins, totalCoins: game.state.totalCoins, produced: game.state.totalProduced };
  assert.equal(game.claimResearch(quote.id).level, 1);
  assert.equal(game.state.coins, before.coins); assert.equal(game.state.totalCoins, before.totalCoins); assert.equal(game.state.totalProduced, before.produced);
  noMutation(game, () => game.claimResearch(quote.id), 'stale-research');
});

test('yield and value settlement changes real taps, passive production, bursts, prices, previews and offline income', () => {
  const game = factory(), p = game.getView().production;
  const yielded = finish(game), valued = finish(game, 'value'), multiplier = CONFIG.research.multiplier;
  close(yielded.after / yielded.before, multiplier); close(valued.after / valued.before, multiplier);
  const after = game.getView().production;
  close(after.tap, p.tap * multiplier); close(after.baseAuto, p.baseAuto * multiplier);
  close(after.price, p.price * multiplier); close(after.baseIncome, p.baseIncome * multiplier ** 2);
  close(game.tap().amount, after.tap);
  game.state.energy = 99; game.drainEvents(); game.tick(1);
  const burst = game.drainEvents().find(event => event.type === 'burst');
  close(burst.amount, after.tap * 24 + after.baseAuto * 8); close(burst.coins, burst.amount * after.price);
  const valuePreview = game.getView().upgrades.find(item => item.key === 'value').preview;
  close(valuePreview.before, after.price);
  const reload = copy(game, 60000);
  close(reload.state.offline.production, after.baseAuto * 60 * CONFIG.offlineEfficiency);
  close(reload.state.offline.coins, after.baseIncome * 60 * CONFIG.offlineEfficiency);
  close(reload.getView().production.baseIncome, after.baseIncome);
});

test('both routes can finish all 24 levels without spending, tapping, advertising or another order gate', () => {
  const game = factory(10, 2); game.state.upgrades = { tap: 0, auto: 0, value: 0 };
  const original = game.getView().production, taps = game.state.taps, orderIndex = game.state.orderIndex;
  for (let level = 0; level < CONFIG.research.maxLevel; level++) {
    for (const key of ['yield', 'value']) {
      const quote = start(game, key);
      assert.equal(quote.level, level);
      assert.equal(quote.projectName, CONFIG.research.routes[key].projects[Math.floor(level / 3)]);
      let seconds = 0;
      while (!game.getView().research.active.ready && seconds < 130) { game.tick(1); seconds++; }
      assert.ok(seconds <= CONFIG.research.durationSeconds + 1, `level ${level} ${key} took ${seconds}s`);
      assert.equal(game.claimResearch(quote.id).ok, true);
    }
  }
  const research = game.getView().research;
  assert.equal(research.totalLevels, 24); assert.equal(research.complete, true);
  assert.equal(game.state.taps, taps); assert.equal(game.state.orderIndex, orderIndex); assert.equal(game.state.rewardedCount, 0);
  for (const key of ['yield', 'value']) { assert.equal(option(game, key).canStart, false); noMutation(game, () => game.startResearch(key, option(game, key)), 'max-level'); }
  close(game.getView().production.baseIncome, original.baseIncome * CONFIG.research.multiplier ** 24);
  assert.equal(copy(game).getView().research.complete, true);
});

test('malformed and edited research quotes fail atomically and cannot choose their own goals or gains', () => {
  const game = factory(), quote = option(game);
  for (const input of [undefined, null, [], {}, { ...quote, key: 'value' }, { ...quote, productionTarget: 1 },
    { ...quote, serial: Infinity }, { ...quote, id: 'research:forged' }, { ...quote, level: 11 }, { ...quote, multiplier: 100 },
    { ...quote, basis: null }, { ...quote, basis: { ...quote.basis, upgrades: { tap: 0, auto: 0, value: 0 } } },
    { ...quote, preview: { ...quote.preview, after: quote.preview.after * 10 } }]) {
    noMutation(game, () => game.startResearch('yield', input), 'stale-research');
  }
  noMutation(game, () => game.startResearch('__proto__', quote), 'invalid-research');
});

test('all permanent factory changes expire held quotes, including changes that leave the numeric goal unchanged', () => {
  for (const change of [game => game.buyUpgrade('auto'), game => game.buyUpgrade('tap'), game => game.buyUpgrade('value'),
    game => { game.state.brandLevel++; }, game => { game.state.refinements.value++; }, game => { game.state.refinements.yield++; },
    game => { game.state.research.levels.value++; }, game => { game.state.machine++; }]) {
    const game = factory(14, 3); game.state.coins = 1e14;
    const quote = option(game); change(game);
    noMutation(game, () => game.startResearch('yield', quote), 'stale-research');
  }
});

test('one research runs at a time; cancelling clears progress and invalidates all old ids and quotes', () => {
  const game = factory(), heldValue = option(game, 'value'), quote = start(game);
  game.tick(10);
  noMutation(game, () => game.startResearch('yield', quote), 'stale-research');
  noMutation(game, () => game.startResearch('value', heldValue), 'stale-research');
  noMutation(game, () => game.startResearch('value', option(game, 'value')), 'research-active');
  noMutation(game, () => game.claimResearch(quote.id), 'research-not-ready');
  assert.equal(game.cancelResearch(quote.id).ok, true);
  noMutation(game, () => game.startResearch('yield', quote), 'stale-research');
  noMutation(game, () => game.cancelResearch(quote.id), 'stale-research');
  const next = start(game, 'value'); assert.equal(game.getView().research.active.production, 0);
  assert.notEqual(next.id, quote.id);
  const reload = copy(game); noMutation(reload, () => reload.claimResearch(quote.id), 'stale-research');
  assert.equal(reload.getView().research.active.id, next.id);
});

test('research targets remain frozen through upgrades, mode changes, machine changes and main completion', () => {
  const game = factory(19, 4), quote = start(game);
  game.state.coins = 1e15; game.buyUpgrade('auto'); game.buyUpgrade('value'); game.buyRefinement('yield'); game.buyRefinement('value');
  game.state.brandLevel = 8; game.evolve(); game.setProductionMode('premium');
  game.state.totalProduced = CONFIG.orders[19].target; game.claimOrder(); game.tick(1);
  const active = game.getView().research.active;
  assert.equal(active.productionTarget, quote.productionTarget);
  const reload = copy(game); assert.deepEqual(reload.getView().research.active, active);
  reload._produce(quote.productionTarget, 'test'); assert.equal(reload.claimResearch(quote.id).ok, true);
  assert.equal(reload.getView().research.options.every(item => item.canStart), true);
});

test('pending advertisements block start, cancel and claim while real new production continues', () => {
  const game = factory(), quote = option(game), ad = game.quoteReward('turbo');
  noMutation(game, () => game.startResearch('yield', quote), 'busy');
  game.cancelReward(ad.id); start(game);
  const nextAd = game.quoteReward('turbo');
  noMutation(game, () => game.cancelResearch(quote.id), 'busy');
  noMutation(game, () => game.claimResearch(quote.id), 'busy');
  game.tick(60); game.tick(60); assert.equal(game.getView().research.active.ready, true);
  noMutation(game, () => game.claimResearch(quote.id), 'busy');
  game.applyReward(nextAd.id); assert.equal(game.claimResearch(quote.id).ok, true);
});

test('research excludes old unclaimed offline packs but counts new offline production once alongside commissions', () => {
  const source = factory(); source.state.offline = { id: 'offline:old', seconds: 60, production: 100, coins: 200 };
  const quote = start(source), commission = source.getView().commissions.options[0];
  source.acceptCommission(commission.kind, commission);
  const game = copy(source, 30000), produced = source.getView().production.baseAuto * 30 * CONFIG.offlineEfficiency;
  assert.equal(game.getView().research.active.production, 0);
  const ad = game.quoteReward('offline'); assert.equal(game.applyReward(ad.id).ok, true);
  close(game.getView().research.active.production, Math.min(quote.productionTarget, produced));
  close(game.getView().commissions.active.production, Math.min(commission.productionTarget, produced));
  noMutation(game, () => game.claimOffline(), 'no-offline-reward');
  const oldOnly = factory(); oldOnly.state.offline = { id: 'offline:old', seconds: 60, production: 100, coins: 200 };
  start(oldOnly); oldOnly.claimOffline(); assert.equal(oldOnly.getView().research.active.production, 0);
  const newlyAway = copy(oldOnly, 30000); newlyAway.claimOffline();
  close(newlyAway.getView().research.active.production, produced);
});

test('offline research progress survives a merged pack, reload and manual completion with no repeat claim', () => {
  const source = factory(); const quote = start(source);
  const first = copy(source, 60000), merged = new Game({ save: first.exportSave(NOW + 60000), now: NOW + 300000 });
  assert.equal(merged.getView().research.active.ready, false);
  merged.claimOffline(); assert.equal(merged.getView().research.active.ready, true);
  assert.equal(merged.claimResearch(quote.id).ok, true);
  const after = new Game({ save: merged.exportSave(NOW + 300000), now: NOW + 300000 });
  assert.equal(after.state.research.levels.yield, 1);
  noMutation(after, () => after.claimResearch(quote.id), 'stale-research');
  noMutation(after, () => after.startResearch('yield', quote), 'stale-research');
});

test('restoration rebuilds research names and targets from the factory basis and bounds malformed progress', () => {
  const game = factory(); finish(game, 'value'); const quote = start(game); game.tick(10);
  const original = game.exportSave(NOW), changed = structuredClone(original);
  Object.assign(changed.research.active, { productionTarget: 1, name: 'forged', projectName: 'forged', ready: true, multiplier: 999, reward: 1e100, production: Infinity });
  const restore = new Game({ save: changed, now: NOW }), active = restore.getView().research.active;
  assert.equal(active.productionTarget, quote.productionTarget); assert.equal(active.name, quote.name); assert.equal(active.projectName, quote.projectName);
  assert.equal(active.production, 0); assert.equal(active.ready, false);
  changed.research.active.production = 1e100;
  assert.equal(new Game({ save: changed, now: NOW }).getView().research.active.production, quote.productionTarget);
  for (const update of [{ id: 'bad' }, { key: '__proto__' }, { level: 0 }, { level: 13 }, { serial: Infinity }, { basis: null }, { orderIndex: 9 }, { orderIndex: 20 }]) {
    const save = structuredClone(original); Object.assign(save.research.active, update);
    assert.equal(new Game({ save, now: NOW }).getView().research.active, null);
  }
  const stale = structuredClone(original); stale.research.levels.yield = 1;
  assert.equal(new Game({ save: stale, now: NOW }).getView().research.active, null);
});

test('saved research levels are finite bounded integers and cannot unlock before ten completed orders', () => {
  for (const bad of [undefined, null, false, [], { levels: null }, { levels: { yield: Infinity, value: '12' } }]) {
    const save = factory().exportSave(NOW); save.research = bad;
    assert.deepEqual(new Game({ save, now: NOW }).state.research.levels, { yield: 0, value: 0 });
  }
  const save = factory().exportSave(NOW); save.research = { levels: { yield: 999, value: 2.9 }, serial: -100 };
  const restored = new Game({ save, now: NOW });
  assert.deepEqual(restored.state.research.levels, { yield: 12, value: 2 }); assert.equal(restored.state.research.serial, 0);
  save.orderIndex = 9; assert.deepEqual(new Game({ save, now: NOW }).state.research.levels, { yield: 0, value: 0 });
});

test('commissions accepted before or after research keep frozen goals and rewards after further research and reload', () => {
  for (const priorLevel of [0, 1]) {
    const game = factory(); if (priorLevel) finish(game);
    const quote = game.getView().commissions.options[0]; game.acceptCommission(quote.kind, quote);
    finish(game); finish(game, 'value');
    const live = game.getView().commissions.active, restored = copy(game).getView().commissions.active;
    assert.equal(live.productionTarget, quote.productionTarget); assert.equal(live.reward, quote.reward);
    assert.deepEqual(restored, live);
    if (!priorLevel) {
      const legacy = game.exportSave(NOW); delete legacy.commissions.active.basis.researchLevels;
      assert.equal(new Game({ save: legacy, now: NOW }).getView().commissions.active.reward, quote.reward);
    }
    const updated = game.getView().commissions.options[0];
    assert.ok(updated.productionTarget > quote.productionTarget); assert.ok(updated.reward > quote.reward);
  }
});

test('research events report actual claimed permanent benefits exactly once', () => {
  const game = factory(); game.setProductionMode('premium'); game.drainEvents();
  const quote = start(game, 'value'); game.tick(1); game.cancelResearch(quote.id);
  const result = finish(game, 'value');
  const events = game.drainEvents().filter(event => event.type === 'research');
  assert.deepEqual(events.map(event => event.action), ['start', 'cancel', 'start', 'claim']);
  const claim = events[3]; assert.equal(claim.level, 1); assert.equal(claim.before, result.before); assert.equal(claim.after, result.after);
  close(claim.after / claim.before, CONFIG.research.multiplier); close(claim.after, game.getView().production.price);
  noMutation(game, () => game.claimResearch(result.id), 'stale-research');
});
