'use strict';
const { legacyGame } = require('./legacy-fixture.cjs');
// Independent gameplay acceptance. Fixtures are explicit; simulation after setup
// uses public Game actions only and never calls a platform or real advert API.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core.js');
const NOW = 1800000000000;
const copy = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * 1e-9), `${label}: ${actual} != ${expected}`);
function advance(game, seconds) {
  for (let left = seconds; left > 1e-8;) { const dt = Math.min(.25, left); game.tick(dt); left -= dt; }
}
function fixture(overrides = {}) {
  const fresh = legacyGame({ now: NOW });
  Object.assign(fresh.state, { machine: 2, orderIndex: 6, totalProduced: CONFIG.orders[5].target,
    coins: 240000, totalCoins: 2240000, taps: 30, bursts: 1, playedSeconds: 120, energy: 0,
    upgrades: { tap: 12, auto: 12, value: 12 }, ...overrides });
  const game = new Game({ now: NOW, save: fresh.exportSave(NOW) });
  game.tick(.001); game.drainEvents(); return game;
}
function seedCollection(game, desired, pressureMode = 'auto') {
  // Explicit historical collection fixture; gameplay never removes equipment.
  game.state.factory.owned = desired.slice();
  game.state.factory.pressureMode = pressureMode;
  assert.deepEqual([...game.getView().factory.owned].sort(), [...desired].sort());
}
function accept(game, kind) {
  const option = game.getView().contracts.options.find(item => item.kind === kind);
  assert.ok(option, 'missing contract route ' + kind);
  assert.equal(option.canAccept, true, option.reason);
  assert.equal(game.acceptContract(kind, option).ok, true);
  return copy(game.getView().contracts.active);
}
function finishNaturally(game, maxSeconds = 240, active = false) {
  for (let seconds = 0; seconds < maxSeconds; seconds++) {
    if (game.getView().order.ready) return seconds;
    const factory = game.getView().factory;
    if (active && factory.storedBurst) game.releasePressure();
    if (active && factory.tapReady) game.tap();
    advance(game, 1);
  }
  assert.equal(game.getView().order.ready, true, 'natural production did not make the current order ready');
  return maxSeconds;
}

test('factory: legacy six-delivery factories retain the three-route contract choice', () => {
  const game = legacyGame({ now: NOW });
  assert.equal(game.getView().factory.unlocked, false);
  for (let index = 0; index < 6; index++) {
    game.state.totalProduced = CONFIG.orders[index].target;
    assert.equal(game.claimOrder().ok, true);
  }
  game.state.coins = CONFIG.machines[1].cost; assert.equal(game.evolve().ok, true);
  assert.equal(game.getView().contracts.unlocked, false);
  game.state.coins = CONFIG.machines[2].cost; assert.equal(game.evolve().ok, true);
  const view = game.getView();
  assert.equal(view.factory.totalModules, 6); assert.equal(view.order.awaitingSelection, true);
  assert.deepEqual(view.contracts.options.map(option => option.kind).sort(), ['cinema', 'festival', 'gift']);
  assert.equal(game.claimOrder().ok, false, 'lifetime tutorial output cannot auto-complete an unselected contract');
});

test('factory: every owned device stays active and retired loadout changes cannot mutate a contract', () => {
  const game = fixture(), before = game.state.coins;
  assert.deepEqual([...game.getView().factory.equipped].sort(), ['coating', 'packer']);
  assert.equal(game.toggleModule('pressure').ok, false, 'equipment cannot be manually obtained');
  seedCollection(game, ['coating', 'packer', 'pressure']); near(game.state.coins, before, 'collection fixture has no economy effect');
  const active = accept(game, 'gift'), after = game.exportSave(NOW);
  assert.equal(game.toggleModule('coating').ok, false);
  assert.equal(game.acceptContract('cinema').ok, false);
  assert.deepEqual(game.exportSave(NOW), after, 'rejected actions must not alter contract or economy');
  assert.equal(game.cancelContract(active.id).ok, true);
  assert.deepEqual(game.getView().factory.owned, ['coating', 'packer', 'pressure']);
});

test('factory: reserved output and sale income are never counted twice', () => {
  const game = fixture(), baseline = new Game({ now: NOW, save: game.exportSave(NOW) });
  accept(game, 'cinema');
  const coins = game.state.coins, controlCoins = baseline.state.coins, produced = game.state.totalProduced;
  advance(game, 3); advance(baseline, 3);
  const active = game.getView().contracts.active;
  assert.ok(active.heldProduction > 0); assert.ok(active.heldCoins > 0);
  assert.ok(game.state.coins - coins < baseline.state.coins - controlCoins, 'reserved capacity cannot also earn full retail income');
  const baseOutput = baseline.state.totalProduced - produced, extra = baseOutput * .15;
  near(game.state.coins - coins, (baseline.state.coins - controlCoins) * .4, 'packer retains ordinary 40 percent retail');
  near(game.state.coins - coins + active.heldCoins, (baseOutput + extra) * game.getView().production.price, 'retail plus held income includes actual bonus goods once');
  near(game.state.totalProduced - produced, baseOutput + extra, 'physical total includes contract-only bonus goods');
});

test('factory: accepted requirements and reward stay frozen after upgrades and view mutation', () => {
  const game = fixture({ coins: 1000000, totalCoins: 3000000 }), active = accept(game, 'cinema');
  const targets = active.requirements.map(({ key, target }) => ({ key, target }));
  const returned = game.getView().contracts.active; returned.reward = 1e99; returned.requirements[0].target = 1;
  assert.equal(game.buyUpgrade('auto').ok, true);
  advance(game, 2);
  const after = game.getView().contracts.active;
  assert.equal(after.reward, active.reward);
  assert.deepEqual(after.requirements.map(({ key, target }) => ({ key, target })), targets);
  assert.notEqual(after.reward, returned.reward, 'view must not expose a mutable reward quote');
});

test('factory: cancellation clears progress, refuses stale IDs and cannot manufacture a reward', () => {
  const game = fixture(), original = accept(game, 'cinema');
  advance(game, 3);
  const coins = game.state.coins, orderIndex = game.state.orderIndex;
  assert.equal(game.cancelContract(original.id).ok, true);
  near(game.state.coins, coins, 'cancel does not award reserved goods or reward');
  assert.equal(game.state.orderIndex, orderIndex);
  const replacement = accept(game, 'cinema');
  assert.notEqual(replacement.id, original.id);
  assert.equal(replacement.heldProduction, 0); assert.equal(replacement.heldCoins, 0);
  assert.ok(replacement.requirements.every(requirement => requirement.current === 0));
  assert.equal(game.cancelContract(original.id).ok, false);
  assert.equal(game.getView().contracts.active.id, replacement.id);
  assert.equal(game.claimOrder().ok, false);
});

test('factory: every route has a zero-tap, zero-ad production path', t => {
  for (const kind of ['cinema', 'gift', 'festival']) {
    const game = fixture(), taps = game.state.taps;
    accept(game, kind); const seconds = finishNaturally(game);
    assert.equal(game.claimOrder().ok, true);
    assert.equal(game.state.orderIndex, 7); assert.equal(game.state.taps, taps);
    assert.equal(game.state.rewardedCount, 0);
    t.diagnostic(JSON.stringify({ route: kind, automaticDeliverySeconds: seconds }));
  }
});

test('factory: pressure holds only one pot, manual release is single-use and overflow stays productive', () => {
  const game = fixture(); seedCollection(game, ['pressure', 'coating'], 'hold');
  advance(game, 40); assert.equal(game.getView().factory.storedBurst, true);
  const before = game.state.totalProduced, bursts = game.state.bursts;
  advance(game, 60);
  assert.equal(game.getView().factory.storedBurst, true);
  assert.ok(game.state.totalProduced > before); assert.ok(game.state.bursts > bursts, 'a full pressure slot must not stop future automatic pots');
  assert.equal(game.releasePressure().ok, true); assert.equal(game.getView().factory.storedBurst, false);
  const after = game.exportSave(NOW); assert.equal(game.releasePressure().ok, false);
  assert.deepEqual(game.exportSave(NOW), after, 'empty pressure cannot pay a second time');
});

test('factory: automatic full pots advance festival batches once per complete charge', () => {
  const game = fixture();
  accept(game, 'festival');
  advance(game, 18.5);
  const before = { produced: game.state.totalProduced, bursts: game.state.bursts };
  assert.equal(game.getView().contracts.active.batches, 0);
  advance(game, 1.5);
  assert.equal(game.state.bursts, before.bursts + 1);
  assert.ok(game.state.totalProduced > before.produced);
  assert.equal(game.getView().contracts.active.batches, 1);
  advance(game, 1);
  assert.equal(game.state.bursts, before.bursts + 1);
  assert.equal(game.getView().contracts.active.batches, 1);
});

test('factory: active quote, progress and held goods survive save reload without delivery rollback', () => {
  const game = fixture(); accept(game, 'gift'); advance(game, 7);
  const before = game.getView(), restored = new Game({ now: NOW, save: game.exportSave(NOW) });
  assert.equal(restored.state.orderIndex, before.state.orderIndex);
  assert.deepEqual(restored.getView().contracts.active, before.contracts.active);
  finishNaturally(restored); assert.equal(restored.claimOrder().ok, true);
  const delivered = new Game({ now: NOW, save: restored.exportSave(NOW) });
  assert.equal(delivered.state.orderIndex, 7);
  assert.equal(delivered.getView().contracts.active, null);
  assert.equal(delivered.claimOrder().ok, false);
});

test('factory: offline rewards use the saved contract, never a later replacement', () => {
  const game = fixture(); const original = accept(game, 'cinema'); advance(game, 3);
  const saved = game.exportSave(NOW), activeBefore = copy(game.getView().contracts.active);
  const restored = new Game({ now: NOW + 600000, save: saved });
  assert.deepEqual(restored.getView().contracts.active, activeBefore, 'offline parcel waits for explicit claim');
  assert.equal(restored.cancelContract(original.id).ok, true);
  const replacement = accept(restored, 'gift'), coins = restored.state.coins;
  assert.equal(restored.claimOffline().ok, true);
  const after = restored.getView().contracts.active;
  assert.equal(after.id, replacement.id); assert.equal(after.heldProduction, 0); assert.equal(after.heldCoins, 0);
  assert.ok(after.requirements.every(requirement => requirement.current === 0), 'old parcel must not produce new-contract work');
  assert.ok(restored.state.coins >= coins);
  const snapshot = restored.exportSave(NOW + 600000);
  assert.equal(restored.claimOffline().ok, false); assert.deepEqual(restored.exportSave(NOW + 600000), snapshot);
});

test('factory: malformed module, stored-pot and active records restore safely with finite output', () => {
  const source = fixture(); accept(source, 'gift'); advance(source, 2);
  for (const equipped of [null, 'pressure', {}, 1, false, ['pressure', 'pressure', 'coating', 'packer', '__proto__']]) {
    const save = source.exportSave(NOW);
    save.factory.owned = equipped;
    save.factory.storedBurst = { amount: Infinity };
    save.factory.tapsThisPot = Infinity; save.factory.tapCooldown = -1;
    const restored = new Game({ now: NOW, save }), view = restored.getView();
    assert.ok(view.factory.equipped.length <= 6);
    assert.equal(new Set(view.factory.equipped).size, view.factory.equipped.length);
    assert.ok(Number.isFinite(view.factory.chargeProgress));
    assert.ok(Number.isFinite(view.production.auto));
    advance(restored, 1); assert.ok(Number.isFinite(restored.state.coins));
  }
  for (const change of [{ id: 'contract:forged' }, { kind: '__proto__' }, { orderIndex: 5 }, { quantity: Infinity, coated: -1, heldCoins: Infinity }]) {
    const save = source.exportSave(NOW); Object.assign(save.factory.active, change);
    const restored = new Game({ now: NOW, save }), active = restored.getView().contracts.active;
    if (change.id || change.kind || change.orderIndex) assert.equal(active, null);
    else { assert.ok(Number.isFinite(active.heldCoins)); assert.ok(active.requirements.every(item => item.current >= 0 && item.current <= item.target)); }
  }
});

test('factory: offline ad completion doubles cash once and never doubles held contract goods', () => {
  const source = fixture(); accept(source, 'gift'); advance(source, 3);
  const restored = new Game({ now: NOW + 30000, save: source.exportSave(NOW) });
  const normal = new Game({ now: NOW + 30000, save: restored.exportSave(NOW + 30000) });
  const preview = restored.getView().offline, coins = restored.state.coins;
  const quote = restored.quoteReward('offline'); assert.ok(quote);
  near(quote.amount, preview.cashCoins, 'only projected offline cash receives ad bonus');
  assert.equal(normal.claimOffline().ok, true);
  const result = restored.applyReward(quote.id); assert.equal(result.ok, true);
  near(restored.state.coins - coins, normal.state.coins - coins + quote.amount, 'cash reward frozen at quote');
  assert.deepEqual(restored.getView().contracts.active, normal.getView().contracts.active);
  near(restored.state.totalProduced, normal.state.totalProduced, 'ads do not duplicate physical output');
  const after = restored.exportSave(NOW + 30000);
  assert.equal(restored.applyReward(quote.id).ok, false); assert.deepEqual(restored.exportSave(NOW + 30000), after);
});

test('factory: failed/cancelled offline ads preserve parcel and permit exactly one ordinary claim', () => {
  const source = fixture(); accept(source, 'cinema'); advance(source, 1);
  const game = new Game({ now: NOW + 30000, save: source.exportSave(NOW) });
  const baseline = new Game({ now: NOW + 30000, save: game.exportSave(NOW + 30000) });
  const parcel = copy(game.state.offline), active = copy(game.getView().contracts.active), coins = game.state.coins;
  const quote = game.quoteReward('offline'); assert.ok(quote); assert.equal(game.cancelReward(quote.id).ok, true);
  assert.deepEqual(game.state.offline, parcel); assert.deepEqual(game.getView().contracts.active, active);
  assert.equal(game.state.coins, coins); assert.equal(game.applyReward(quote.id).ok, false);
  assert.equal(game.claimOffline().ok, true); assert.equal(baseline.claimOffline().ok, true);
  near(game.state.coins, baseline.state.coins, 'cancelled ad cash matches ordinary claim');
  assert.deepEqual(game.getView().contracts.active, baseline.getView().contracts.active);
});

test('factory: restored offline receipt rejects forged cash and keeps the original legal frozen bonus', () => {
  const source = fixture(); accept(source, 'gift'); advance(source, 3);
  const game = new Game({ now: NOW + 30000, save: source.exportSave(NOW) });
  const quote = game.quoteReward('offline'); assert.ok(quote);
  const save = game.exportSave(NOW + 30000);
  const legal = new Game({ now: NOW + 30000, save });
  const legalResult = legal.applyReward(quote.id); assert.equal(legalResult.ok, true);
  near(legalResult.amount, quote.amount, 'legal saved receipt keeps frozen cash bonus');
  for (const forgedAmount of [1e100, save.offline.coins, quote.amount + 1000, -1]) {
    const forged = copy(save); forged.pendingRewards[quote.id].amount = forgedAmount;
    const restored = new Game({ now: NOW + 30000, save: forged }), before = restored.state.coins;
    assert.equal(restored.applyReward(quote.id).ok, false, 'forged or held-goods bonus must be rejected');
    assert.equal(restored.state.coins, before);
    assert.equal(restored.claimOffline().ok, true, 'invalid receipt must not erase the earned ordinary parcel');
  }
});

test('factory: one coarse tick and equivalent fine ticks conserve production, coins and contract work', () => {
  for (const kind of ['cinema', 'gift', 'festival']) {
    const source = fixture(); accept(source, kind);
    const coarse = new Game({ now: NOW, save: source.exportSave(NOW) });
    const fine = new Game({ now: NOW, save: source.exportSave(NOW) });
    coarse.tick(60); for (let i = 0; i < 600; i++) fine.tick(.1);
    near(coarse.state.totalProduced, fine.state.totalProduced, kind + ' physical output');
    near(coarse.state.coins, fine.state.coins, kind + ' cash');
    near(coarse.getView().contracts.active.heldCoins, fine.getView().contracts.active.heldCoins, kind + ' held cash');
    near(coarse.getView().contracts.active.requirements[0].current, fine.getView().contracts.active.requirements[0].current, kind + ' contract work');
    assert.equal(coarse.state.bursts, fine.state.bursts);
  }
});

test('factory: a cancelled contract cannot be revived by a stored pot released into its replacement', () => {
  const game = fixture(); seedCollection(game, ['pressure', 'coating'], 'hold');
  const original = accept(game, 'festival'); advance(game, 21);
  assert.equal(game.getView().factory.storedBurst, true);
  assert.equal(game.cancelContract(original.id).ok, true);
  const replacement = accept(game, 'festival'), produced = game.state.totalProduced;
  assert.equal(replacement.requirements[0].current, 0);
  assert.equal(game.releasePressure().ok, true);
  assert.equal(game.getView().contracts.active.id, replacement.id);
  assert.equal(game.getView().contracts.active.requirements[0].current, 1);
  assert.ok(game.state.totalProduced > produced);
  const after = game.exportSave(NOW); assert.equal(game.releasePressure().ok, false);
  assert.deepEqual(game.exportSave(NOW), after); assert.equal(game.state.orderIndex, 6);
});

test('factory: cancelled contract invalidates its frozen ad receipt without platform calls', () => {
  const game = fixture(); const original = accept(game, 'cinema'); finishNaturally(game);
  const quote = game.quoteReward('order'); assert.ok(quote);
  const pending = game.exportSave(NOW);
  assert.equal(game.cancelContract(original.id).ok, false, 'pending ad completion safely locks the contract');
  assert.deepEqual(game.exportSave(NOW), pending);
  assert.equal(game.cancelReward(quote.id).ok, true);
  assert.equal(game.cancelContract(original.id).ok, true);
  const replacement = accept(game, 'cinema'), coins = game.state.coins;
  assert.equal(game.applyReward(quote.id).ok, false);
  near(game.state.coins, coins, 'stale ad receipt cannot pay');
  assert.equal(game.getView().contracts.active.id, replacement.id); assert.equal(game.state.orderIndex, 6);
});

test('factory: completed legacy save preserves earned ability and has no repeat delivery', () => {
  const game = fixture({ machine: 5, orderIndex: 20, totalProduced: CONFIG.orders[19].target,
    upgrades: { tap: 24, auto: 24, value: 24 }, refinements: { yield: 3, value: 3 },
    research: { levels: { yield: 5, value: 4 }, serial: 3, active: null }, brandLevel: 4, loopIndex: 3 });
  const before = game.getView().production;
  const level = 24, machine = CONFIG.machines[5], legacyYield = Math.pow(1.2, 3) * Math.pow(1.08, 5);
  const legacyPrice = Math.pow(1.2, 3) * Math.pow(1.08, 4);
  const expectedTap = (1 + .8 * level) * Math.pow(1.2, level) * machine.multiplier * 1.8 * legacyYield;
  const expectedAuto = (.4 + .7 * level) * Math.pow(CONFIG.autoLevelGrowth, level) * machine.multiplier * 1.8 * legacyYield;
  const expectedPrice = (1 + .2 * level) * Math.pow(1.15, level) * machine.priceMultiplier * legacyPrice;
  assert.ok(before.tap >= expectedTap * (1 - 1e-9), 'legacy research/refinement/brand tap power must survive initial migration');
  assert.ok(before.auto >= expectedAuto * (1 - 1e-9), 'legacy research/refinement/brand automation must survive initial migration');
  assert.ok(before.price >= expectedPrice * (1 - 1e-9), 'legacy research/refinement price power must survive initial migration');
  const restored = new Game({ now: NOW, save: game.exportSave(NOW) });
  assert.equal(restored.state.machine, 5); assert.equal(restored.state.orderIndex, 20);
  near(restored.getView().production.tap, before.tap, 'earned tap capability');
  near(restored.getView().production.auto, before.auto, 'earned auto capability');
  near(restored.getView().production.price, before.price, 'earned price capability');
  assert.equal(restored.getView().order.completed, true); assert.equal(restored.claimOrder().ok, false);
  assert.equal(restored.getView().contracts.options.length, 0);
});

function journey({ equipped, kinds, active }, seconds = 600) {
  const game = fixture(); seedCollection(game, equipped, active ? 'hold' : 'auto');
  const initial = { orderIndex: game.state.orderIndex, coins: game.state.coins, upgrades: copy(game.state.upgrades) };
  const deliveries = []; let routeIndex = 0, taps = 0, releases = 0;
  for (let at = 0; at < seconds; at++) {
    let view = game.getView();
    if (view.order.ready) {
      deliveries.push({ at, kind: view.order.kind, order: game.state.orderIndex + 1 });
      assert.equal(game.claimOrder().ok, true);
    }
    view = game.getView();
    if (view.canEvolve) assert.equal(game.evolve().ok, true);
    if (at % 5 === 0) {
      for (const key of ['auto', 'value', 'tap']) {
        const upgrade = game.getView().upgrades.find(item => item.key === key);
        if (upgrade && upgrade.cost <= game.state.coins * .25) game.buyUpgrade(key);
      }
    }
    view = game.getView();
    if (!view.contracts.active && !view.order.completed) accept(game, kinds[routeIndex++ % kinds.length]);
    view = game.getView();
    if (active && view.factory.storedBurst && at % 3 === 0) { assert.equal(game.releasePressure().ok, true); releases++; }
    if (active && view.factory.tapReady) { if (game.tap().ok !== false) taps++; }
    advance(game, 1); game.drainEvents();
  }
  return { initial, durationSeconds: seconds, equipped, routePolicy: kinds, active, deliveries, taps, releases,
    finalOrder: game.state.orderIndex, finalMachine: game.state.machine, finalCoins: game.state.coins,
    finalUpgrades: game.state.upgrades, rewardedCount: game.state.rewardedCount };
}

function fixedContractComparison() {
  const rows = [];
  for (const equipped of [['coating', 'packer'], ['pressure', 'coating'], ['pressure', 'packer']]) {
    for (const kind of ['cinema', 'gift', 'festival']) for (const active of [false, true]) {
      const game = fixture(); seedCollection(game, equipped); accept(game, kind);
      const before = game.state.coins, quote = copy(game.getView().contracts.active);
      let seconds = 0, taps = 0, releases = 0;
      while (!game.getView().order.ready && seconds < 240) {
        if (active && game.getView().factory.storedBurst) { assert.equal(game.releasePressure().ok, true); releases++; }
        if (active && game.getView().factory.tapReady) { assert.equal(game.tap().ok, true); taps++; }
        advance(game, .25); seconds += .25; game.drainEvents();
      }
      assert.equal(game.getView().order.ready, true);
      const cashBeforeDelivery = game.state.coins - before, heldCoins = game.getView().contracts.active.heldCoins;
      assert.equal(game.claimOrder().ok, true);
      rows.push({ equipped: equipped.join('+'), kind, active, seconds, taps, releases,
        reward: quote.reward, target: quote.requirements[0].target,
        cashBeforeDelivery: Math.round(cashBeforeDelivery), heldCoins: Math.round(heldCoins),
        totalCash: Math.round(game.state.coins - before),
        coinsPerSecond: Math.round((game.state.coins - before) / seconds) });
    }
  }
  return rows;
}
test('factory: historical partial collections retain coating benefits at fixed starting economy without upgrades', t => {
  const rows = fixedContractComparison();
  t.diagnostic('FIXED_CONTRACT_REPORT ' + JSON.stringify(rows));
  for (const active of [false, true]) {
    const coated = rows.find(row => row.active === active && row.kind === 'gift' && row.equipped === 'coating+packer');
    const uncoated = rows.find(row => row.active === active && row.kind === 'gift' && row.equipped === 'pressure+packer');
    assert.ok(coated.seconds < uncoated.seconds, 'coating module must materially speed up the actual coating requirement');
  }
});
test('factory: reproducible ten-minute midgame comparison covers automatic play and manual pressure mode', t => {
  for (const policy of [
    { equipped: ['coating', 'packer'], kinds: ['cinema', 'gift', 'festival'], active: false },
    { equipped: ['pressure', 'coating'], kinds: ['cinema', 'gift', 'festival'], active: true }
  ]) {
    const report = journey(policy);
    t.diagnostic('MIDGAME_REPORT ' + JSON.stringify(report));
    assert.ok(report.deliveries.length >= 3, 'ten-minute natural play must deliver multiple contracts');
    assert.equal(report.rewardedCount, 0);
    if (!policy.active) { assert.equal(report.taps, 0); assert.equal(report.releases, 0); }
    else assert.ok(report.releases > 0);
  }
});

module.exports = { journey };
