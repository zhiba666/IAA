'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const NOW = 1800000000000;
const IDS = ['coating', 'packer', 'pressure', 'feeder', 'reclaimer', 'inspector'];
const near = (a, b, message = '') => assert.ok(Math.abs(a - b) <= Math.max(1e-7, Math.abs(b) * 1e-10), `${message}: ${a} != ${b}`);

function factory(overrides = {}) {
  const game = new Game({ now: NOW });
  Object.assign(game.state, { machine: 2, orderIndex: 6, totalProduced: 20000, playedSeconds: 200,
    coins: 1e7, totalCoins: 1e7, upgrades: { tap: 12, auto: 12, value: 12 }, bursts: 3, ...overrides });
  game.state.onboarding = { version: 1, legacy: true, seen: [] };
  game._autoQuests(); game.drainEvents(); return game;
}
function deliver(game, kind) {
  assert.equal(game.acceptContract(kind).ok, true, kind);
  for (let seconds = 0; seconds < 240 && !game.getView().order.ready; seconds++) game.tick(1);
  assert.equal(game.getView().order.ready, true, `${kind} must finish without pressure interaction`);
  assert.equal(game.claimOrder().ok, true);
}

test('equipment: six visible goals start locked and repeated views neither earn devices nor mutate save data', () => {
  const game = new Game({ now: NOW }), before = game.exportSave(NOW);
  for (let i = 0; i < 3; i++) {
    const view = game.getView().factory;
    assert.equal(view.totalModules, 6); assert.equal(view.ownedCount, 0);
    assert.deepEqual(view.owned, []); assert.deepEqual(view.equipped, []);
    assert.deepEqual(view.modules.map(m => m.id).sort(), IDS.slice().sort());
    assert.ok(view.nextModule && !view.nextModule.owned);
    for (const module of view.modules) {
      assert.equal(module.owned, false); assert.equal(module.unlocked, false);
      assert.ok(module.condition && module.progressText);
      assert.ok(Number.isFinite(module.progress) && module.progress >= 0 && module.progress <= 1);
    }
    view.owned.push('pressure'); view.modules[0].owned = true;
  }
  assert.deepEqual(game.exportSave(NOW), before);
  assert.equal(game.state.factory.version, 3);
});

test('equipment: successful delivery automatically grants the first three devices and receipt is idempotent', () => {
  const game = factory();
  assert.deepEqual(game.getView().factory.owned, []);
  deliver(game, 'cinema');
  assert.deepEqual(game.getView().factory.owned.slice().sort(), ['coating', 'packer']);
  let events = game.drainEvents().filter(e => e.type === 'module');
  assert.deepEqual(events.map(e => e.id).sort(), ['coating', 'packer']);
  deliver(game, 'gift');
  assert.deepEqual(game.getView().factory.owned.slice().sort(), ['coating', 'packer', 'pressure']);
  assert.equal(game.getView().factory.pressureMode, 'auto');
  events = game.drainEvents().filter(e => e.type === 'module');
  assert.deepEqual(events.map(e => e.id), ['pressure']);
  const snapshot = game.exportSave(NOW);
  assert.equal(game.claimOrder().ok, false); assert.equal(game.toggleModule('packer').ok, false);
  game.getView(); game.getView();
  assert.deepEqual(game.exportSave(NOW), snapshot);
  const restored = new Game({ now: NOW, save: snapshot });
  assert.deepEqual(restored.getView().factory.owned, game.getView().factory.owned);
  assert.equal(restored.drainEvents().filter(e => e.type === 'module').length, 0, 'owned devices must not be awarded twice on reload');
});

test('equipment: contract diversity counts successful delivery once, never acceptance or cancellation', () => {
  const game = factory();
  for (const kind of ['cinema', 'gift', 'festival']) {
    assert.equal(game.acceptContract(kind).ok, true);
    assert.equal(game.cancelContract(game.getView().contracts.active.id).ok, true);
  }
  assert.deepEqual(game.state.factory.contractCounts, { cinema: 0, gift: 0, festival: 0 });
  for (const kind of ['cinema', 'gift', 'festival']) deliver(game, kind);
  assert.deepEqual(game.state.factory.contractCounts, { cinema: 1, gift: 1, festival: 1 });
  assert.equal(game.state.orderIndex, 9);
  assert.ok(game.getView().factory.owned.includes('inspector'));
  assert.equal(game.claimOrder().ok, false);
  assert.deepEqual(new Game({ now: NOW, save: game.exportSave(NOW) }).state.factory.contractCounts, game.state.factory.contractCounts);
});

test('equipment: main campaign provides late-device fallback without a particular contract route', () => {
  const game = factory({ machine: 3, orderIndex: 12, bursts: 14 });
  assert.ok(game.getView().factory.owned.includes('feeder'));
  assert.ok(!game.getView().factory.owned.includes('reclaimer'));
  assert.ok(!game.getView().factory.owned.includes('inspector'));
  game.state.orderIndex = 13; game._autoQuests();
  assert.ok(game.getView().factory.owned.includes('reclaimer'));
  game.state.machine = 4; game.state.orderIndex = 16; game._autoQuests();
  assert.deepEqual(game.getView().factory.owned.slice().sort(), IDS.slice().sort());
  assert.equal(game.getView().factory.nextModule, null);
  assert.equal(game.getView().factory.ownedCount, 6);
  assert.ok(game.getView().factory.modules.every(m => m.owned && m.equipped && m.unlocked && m.progress === 1));
});

test('equipment: the fifteenth actual pot unlocks reclaimer, whose natural charge gain is exactly ten percent', () => {
  const game = factory({ machine: 3, orderIndex: 10, bursts: 14, energy: 94 });
  near(game.getView().factory.passiveEnergy, 6);
  game.tick(1);
  assert.equal(game.state.bursts, 15);
  assert.ok(game.getView().factory.owned.includes('reclaimer'));
  near(game.getView().factory.passiveEnergy, 6.6);
  const energy = game.state.energy; game.tick(1); near(game.state.energy - energy, 6.6);
});

test('equipment: automatic pressure adds 25 percent without delaying festival progress or requiring release', () => {
  const game = factory({ orderIndex: 8, energy: 95 }), p = game.getView().production;
  assert.equal(game.getView().factory.pressureMode, 'auto');
  assert.equal(game.acceptContract('festival').ok, true);
  const produced = game.state.totalProduced, bursts = game.state.bursts;
  game.tick(1);
  assert.equal(game.state.bursts, bursts + 1); assert.equal(game.getView().contracts.active.batches, 1);
  assert.equal(game.getView().factory.storedBurst, false);
  const base = p.baseAuto + (24 * p.tap + 8 * p.baseAuto) * 1.25;
  const held = game.getView().contracts.active.heldProduction;
  assert.ok(game.state.totalProduced - produced >= base);
  near((game.state.totalProduced - produced) * p.price,
    game.drainEvents().filter(e => e.type === 'produce').reduce((sum, e) => sum + e.coins, 0) + held * p.price,
    'pressure and packer bonus remain physical goods with exactly one value');
});

test('equipment: manual pressure mode is optional, persisted, and switching to auto releases saved stock exactly once', () => {
  const game = factory({ orderIndex: 8, energy: 95 });
  assert.equal(game.setPressureMode('hold').ok, true); game.tick(1);
  assert.equal(game.getView().factory.storedBurst, true);
  const restored = new Game({ now: NOW, save: game.exportSave(NOW) });
  assert.equal(restored.getView().factory.pressureMode, 'hold');
  const amount = restored.getView().factory.storedBurstAmount, produced = restored.state.totalProduced, bursts = restored.state.bursts;
  assert.equal(restored.setPressureMode('auto').ok, true);
  near(restored.state.totalProduced - produced, amount); assert.equal(restored.state.bursts, bursts + 1);
  assert.equal(restored.getView().factory.storedBurst, false);
  restored.setPressureMode('auto'); assert.equal(restored.releasePressure().ok, false);
  near(restored.state.totalProduced - produced, amount); assert.equal(restored.state.bursts, bursts + 1);
  const before = restored.exportSave(NOW);
  assert.equal(restored.setPressureMode('forged').ok, false);
  assert.deepEqual(restored.exportSave(NOW), before);
});

test('equipment: feeder adds one real input per natural full pot without clicks, input quota or extra charge', () => {
  const game = factory({ machine: 3, orderIndex: 10, energy: 94, bursts: 3 });
  const p = game.getView().production, produced = game.state.totalProduced, taps = game.state.taps;
  game.tick(1);
  near(game.state.totalProduced - produced, p.baseAuto + (24 * p.tap + 8 * p.baseAuto) * 1.25 + p.tap);
  assert.equal(game.state.taps, taps); assert.equal(game.getView().factory.tapsRemaining, 3);
  near(game.state.energy, 0);
  assert.equal(game.tap().ok, true); assert.equal(game.getView().factory.tapsRemaining, 2);
  near(game.state.energy, 2);
});

test('equipment: packer adds contract-only goods while preserving ordinary retail income and finite target cap', () => {
  const game = factory({ orderIndex: 7 });
  assert.equal(game.acceptContract('cinema').ok, true);
  assert.equal(game.getView().contracts.active.allocation, .6);
  const p = game.getView().production, coins = game.state.coins, produced = game.state.totalProduced;
  const result = game._produce(100, 'test');
  near(game.state.coins - coins, 40 * p.price);
  near(game.getView().contracts.active.heldProduction, 75);
  near(game.getView().contracts.active.heldCoins, 75 * p.price);
  near(result.amount, 115); near(game.state.totalProduced - produced, 115);
  game._produce(game.getView().contracts.active.quantityTarget * 2, 'test');
  near(game.getView().contracts.active.heldProduction, game.getView().contracts.active.quantityTarget);
  const readyProduced = game.state.totalProduced, readyCoins = game.state.coins;
  game._produce(100, 'test');
  near(game.state.totalProduced - readyProduced, 100); near(game.state.coins - readyCoins, 100 * p.price);
});

test('equipment: inspector improves only newly quoted base bonuses and active rewards survive upgrades and reload', () => {
  const game = factory({ machine: 4, orderIndex: 15 });
  const before = game.getView().contracts.options.find(o => o.kind === 'cinema');
  game.state.factory.owned.push('inspector');
  const quoted = game.getView().contracts.options.find(o => o.kind === 'cinema');
  assert.equal(quoted.reward, Math.floor(before.reward * 1.05));
  assert.equal(game.acceptContract('cinema', before).ok, false, 'equipment changes invalidate a stale offer');
  assert.equal(game.acceptContract('cinema', quoted).ok, true);
  game._produce(100, 'test');
  const active = game.getView().contracts.active;
  near(active.heldCoins, 75 * game.getView().production.price, 'inspector does not multiply goods value');
  assert.equal(game.buyUpgrade('auto').ok, true);
  const restored = new Game({ now: NOW, save: game.exportSave(NOW) });
  assert.equal(restored.getView().contracts.active.reward, active.reward);
  assert.equal(restored.getView().contracts.active.quantityTarget, active.quantityTarget);
  near(restored.getView().contracts.active.heldCoins, active.heldCoins);
});

test('equipment: version two loadouts migrate permanently without discarding stored stock or frozen contract allocation', () => {
  const game = factory({ orderIndex: 8 });
  assert.equal(game.setPressureMode('hold').ok, true); game.state.energy = 95; game.tick(1);
  assert.equal(game.acceptContract('cinema').ok, true); game.tick(1);
  const save = game.exportSave(NOW);
  save.factory.version = 2; save.factory.equipped = ['pressure', 'coating']; delete save.factory.owned;
  save.factory.active.allocation = .6; delete save.factory.active.packingBonus;
  const oldBasis = JSON.parse(save.factory.active.basis).slice(0, 6); oldBasis[5] = save.factory.equipped;
  save.factory.active.basis = JSON.stringify(oldBasis); delete save.factory.active.qualityBonus;
  const active = save.factory.active, stored = save.factory.storedBurst.amount;
  const restored = new Game({ now: NOW, save });
  assert.equal(restored.state.factory.version, 3);
  for (const id of ['coating', 'pressure', 'packer']) assert.ok(restored.getView().factory.owned.includes(id));
  near(restored.getView().factory.storedBurstAmount, stored);
  assert.equal(restored.getView().contracts.active.reward, active.reward);
  assert.equal(restored.getView().contracts.active.allocation, .6);
  const produced = restored.state.totalProduced; restored._produce(100, 'test');
  near(restored.state.totalProduced - produced, 100, 'migrated active contract cannot silently gain a new frozen bonus');
  assert.equal(restored.releasePressure().ok, true); assert.equal(restored.releasePressure().ok, false);
});

test('equipment: offline packing projection and ad receipt conserve real goods and never pay contract goods twice', () => {
  const game = factory({ orderIndex: 7 }); assert.equal(game.acceptContract('gift').ok, true);
  const restored = new Game({ now: NOW + 30000, save: game.exportSave(NOW) });
  const view = restored.getView(), base = restored.state.offline.production;
  assert.ok(view.offline.production > base, 'packing bonus must be shown as actual projected output');
  const before = { produced: restored.state.totalProduced, coins: restored.state.coins, held: view.contracts.active.heldCoins };
  const quote = restored.quoteReward('offline'); near(quote.amount, view.offline.cashCoins);
  const payout = restored.applyReward(quote.id); assert.equal(payout.ok, true);
  near(restored.state.totalProduced - before.produced, view.offline.production);
  near(restored.state.coins - before.coins, view.offline.cashCoins * 2);
  near(restored.getView().contracts.active.heldCoins - before.held, view.offline.contractCoins);
  near(view.offline.production * view.production.price, view.offline.cashCoins + view.offline.contractCoins);
  const saved = restored.exportSave(NOW + 30000);
  assert.equal(restored.applyReward(quote.id).ok, false); assert.equal(restored.claimOffline().ok, false);
  assert.deepEqual(restored.exportSave(NOW + 30000), saved);
});

test('equipment: legacy 75 percent packing and base-only reward remain frozen even when loading grants all six devices', () => {
  const game = factory({ machine: 4, orderIndex: 16 });
  game.state.factory.owned = ['coating', 'packer'];
  const quote = game.getView().contracts.options.find(option => option.kind === 'cinema');
  assert.equal(game.acceptContract('cinema', quote).ok, true);
  const save = game.exportSave(NOW), a = save.factory.active;
  // This is the actual six-field v2 basis, with no v3 packing or quality terms.
  const oldBasis = JSON.parse(a.basis).slice(0, 6); oldBasis[5] = ['coating', 'packer'];
  a.basis = JSON.stringify(oldBasis); a.allocation = .75; delete a.packingBonus; delete a.qualityBonus;
  save.factory.version = 2; save.factory.equipped = ['coating', 'packer']; delete save.factory.owned;
  const restored = new Game({ now: NOW, save }), view = restored.getView();
  assert.equal(view.factory.ownedCount, 6);
  assert.equal(view.contracts.active.reward, quote.reward);
  assert.equal(view.contracts.active.qualityBonus, 0); assert.equal(view.contracts.active.packingBonus, 0);
  assert.equal(view.contracts.active.allocation, .75);
  const produced = restored.state.totalProduced, coins = restored.state.coins;
  restored._produce(100, 'test');
  near(restored.state.totalProduced - produced, 100);
  near(restored.state.coins - coins, 25 * view.production.price);
  near(restored.getView().contracts.active.heldProduction, 75);
  assert.equal(restored.cancelContract(view.contracts.active.id).ok, true);
  const next = restored.getView().contracts.options.find(option => option.kind === 'cinema');
  assert.equal(next.allocation, .6); assert.equal(next.packingBonus, .15); assert.equal(next.qualityBonus, .05);
  assert.equal(next.reward, Math.floor(quote.reward * 1.05));
});
