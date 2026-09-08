'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core.js');
const NOW = 1000000;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);
const MODES = [
  { id: 'balanced', production: 1, price: 1, income: 1 },
  { id: 'rush', production: 1.2, price: 0.8, income: 0.96 },
  { id: 'premium', production: 0.8, price: 1.5, income: 1.2 }
];
function factory(machine = 2) {
  const game = new Game({ now: NOW });
  game.state.machine = machine;
  game.state.orderIndex = CONFIG.machines[machine].requiredOrders;
  game.state.totalProduced = game.state.orderIndex ? CONFIG.orders[game.state.orderIndex - 1].target : 0;
  game.state.upgrades = { tap: 4, auto: 5, value: 3 };
  game.state.brandLevel = Math.min(machine * 2, 3);
  game.state.playedSeconds = CONFIG.rewardUnlockSeconds;
  return game;
}

test('production modes unlock through the actual twin-machine evolution and preserve resources on selection', () => {
  assert.equal(new Game({ now: NOW }).state.productionMode, 'balanced');
  const game = factory(1), next = CONFIG.machines[2];
  assert.equal(game.getView().productionModes.unlocked, false);
  const locked = game.exportSave(NOW);
  assert.deepEqual(game.setProductionMode('rush'), { ok: false, reason: 'production-mode-locked' });
  assert.deepEqual(game.exportSave(NOW), locked);
  game.state.orderIndex = next.requiredOrders; game.state.totalProduced = CONFIG.orders[next.requiredOrders - 1].target;
  game.state.coins = next.cost + 123; assert.equal(game.evolve().ok, true); game.drainEvents();
  assert.equal(game.getView().productionModes.unlocked, true);
  const before = game.exportSave(NOW);
  assert.deepEqual(game.setProductionMode('rush'), { ok: true, productionMode: 'rush', changed: true });
  assert.deepEqual(game.exportSave(NOW), { ...before, productionMode: 'rush' });
  assert.deepEqual(game.drainEvents(), [{ type: 'productionMode', from: 'balanced', to: 'rush' }]);
  assert.deepEqual(game.setProductionMode('rush'), { ok: true, productionMode: 'rush', changed: false });
  assert.deepEqual(game.drainEvents(), []);
  assert.equal(game.setProductionMode('premium').ok, true);
  assert.deepEqual(game.drainEvents(), [{ type: 'productionMode', from: 'rush', to: 'premium' }]);
});

test('invalid production modes cannot change money, progression, mode or events', () => {
  for (const machine of [0, 1, 2, 5]) {
    const game = factory(machine);
    if (machine >= 2) game.setProductionMode('premium');
    game.drainEvents(); const before = game.exportSave(NOW);
    for (const id of ['constructor', '__proto__', 'RUSH', '', null, undefined, {}, 1]) {
      assert.deepEqual(game.setProductionMode(id), { ok: false, reason: 'invalid-production-mode' });
      assert.deepEqual(game.exportSave(NOW), before);
    }
    assert.deepEqual(game.drainEvents(), []);
  }
});

for (const mode of MODES) {
  test(`${mode.id}: taps, automatic sales and free bursts use the selected production and price exactly once`, () => {
    for (const source of ['tap', 'auto', 'burst']) {
      const normal = factory(), selected = factory(); selected.setProductionMode(mode.id);
      for (const game of [normal, selected]) {
        if (source === 'auto') game.tick(10);
        else { if (source === 'burst') game.state.energy = 98; game.tap(); }
      }
      const baseSale = normal.drainEvents().find(e => e.type === 'produce' && e.source === source);
      const modeSale = selected.drainEvents().find(e => e.type === 'produce' && e.source === source);
      assert.ok(baseSale); assert.ok(modeSale);
      close(modeSale.amount, baseSale.amount * mode.production); close(modeSale.coins, baseSale.coins * mode.income);
      close(selected.getView().production.price, normal.getView().production.price * mode.price);
      close(selected.state.coins, normal.state.coins * mode.income);
    }
  });
}

test('mode previews are read-only independent values and agree with actual production after selection', () => {
  const game = factory(); game.state.boostSeconds = 40;
  const before = game.exportSave(NOW), modes = game.getView().productionModes;
  assert.equal(modes.current, 'balanced'); assert.equal(modes.options.filter(mode => mode.selected).length, 1);
  assert.deepEqual(modes.options.map(mode => mode.id), MODES.map(mode => mode.id));
  for (let i = 0; i < 5; i++) game.getView();
  assert.deepEqual(game.exportSave(NOW), before); assert.deepEqual(game.drainEvents(), []);
  for (const option of modes.options) {
    const selected = new Game({ save: before, now: NOW }); assert.equal(selected.setProductionMode(option.id).ok, true);
    const actual = selected.getView();
    assert.equal(actual.productionModes.current, option.id);
    assert.equal(actual.productionModes.options.find(mode => mode.id === option.id).selected, true);
    for (const field of ['tap', 'baseAuto', 'price', 'baseIncome']) close(option.preview[field], actual.production[field]);
    assert.equal('auto' in option.preview, false, 'permanent preview must exclude temporary turbo');
  }
  modes.options[0].name = 'corrupted'; modes.options[0].productionMultiplier = 100;
  modes.options[0].preview.baseAuto = 1e99;
  assert.equal(game.getView().productionModes.options[0].name, '常规档');
  assert.equal(game.getView().productionModes.options[0].productionMultiplier, 1);
  assert.deepEqual(game.exportSave(NOW), before);
});

test('legacy, invalid and machine-repaired saves fall back to the original balanced economy', () => {
  for (const machine of [0, 1, 2, 5]) {
    const game = factory(machine), expected = game.getView().production;
    for (const value of [undefined, null, 'unknown', 'constructor', {}, 12]) {
      const save = game.exportSave(NOW);
      if (value === undefined) delete save.productionMode; else save.productionMode = value;
      const restored = new Game({ save, now: NOW });
      assert.equal(restored.state.productionMode, 'balanced'); assert.deepEqual(restored.getView().production, expected);
    }
  }
  const save = factory().exportSave(NOW); save.productionMode = 'premium'; save.orderIndex = 3; save.totalProduced = CONFIG.orders[2].target;
  const restored = new Game({ save, now: NOW });
  assert.equal(restored.state.machine, 1); assert.equal(restored.state.productionMode, 'balanced');
  assert.equal(restored.getView().productionModes.unlocked, false);
  for (const mode of MODES) {
    const game = factory(); game.setProductionMode(mode.id);
    const restoredMode = new Game({ save: game.exportSave(NOW), now: NOW });
    assert.equal(restoredMode.state.productionMode, mode.id); assert.deepEqual(restoredMode.getView().production, game.getView().production);
  }
});

test('offline accrual uses the saved mode before calculating income, ignores turbo and preserves already-earned packs', () => {
  for (const mode of MODES) {
    const source = factory(); source.setProductionMode(mode.id); source.state.boostSeconds = 90;
    const production = source.getView().production;
    const restored = new Game({ save: source.exportSave(NOW), now: NOW + 60000 });
    const pack = { ...restored.state.offline };
    close(pack.production, production.baseAuto * 60 * 0.5); close(pack.coins, pack.production * production.price);
    assert.equal(restored.state.productionMode, mode.id); assert.equal(restored.state.boostSeconds, 30);
    const before = restored.state.totalProduced; assert.equal(restored.state.bursts, 0);
    restored.setProductionMode(mode.id === 'premium' ? 'rush' : 'premium');
    assert.deepEqual(restored.state.offline, pack, 'switching cannot reprice accrued offline production');
    const laterProduction = restored.getView().production;
    const merged = new Game({ save: restored.exportSave(NOW + 60000), now: NOW + 120000 });
    close(merged.state.offline.production, pack.production + laterProduction.baseAuto * 60 * 0.5);
    close(merged.state.offline.coins, pack.coins + laterProduction.baseIncome * 60 * 0.5);
    const expectedCoins = merged.state.offline.coins, expectedProduction = merged.state.offline.production;
    assert.equal(merged.claimOffline().ok, true);
    close(merged.state.coins, expectedCoins); close(merged.state.totalProduced - before, expectedProduction);
    assert.equal(merged.claimOffline().ok, false);
  }
});

test('turbo boosts only automatic production and mode-scaled perfect bursts retain the 20 percent skill bonus', () => {
  for (const mode of MODES) {
    const normal = factory(), boosted = factory();
    for (const game of [normal, boosted]) {
      game.setProductionMode(mode.id); game.state.energy = 92; game.state.bursts = 1;
    }
    boosted.state.boostSeconds = 90;
    const p = normal.getView().production;
    assert.deepEqual(normal.getView().productionModes, boosted.getView().productionModes);
    close(boosted.getView().production.auto, p.baseAuto * 3);
    for (const game of [normal, boosted]) { assert.equal(game.tryPerfectBurst().perfect, true); game.tick(8); }
    const standard = normal.drainEvents(), turbo = boosted.drainEvents();
    const normalBurst = standard.find(e => e.type === 'burst'), boostedBurst = turbo.find(e => e.type === 'burst');
    close(normalBurst.amount, (p.tap * 24 + p.baseAuto * 8) * 1.2); assert.deepEqual(boostedBurst, normalBurst);
    close(turbo.find(e => e.type === 'produce' && e.source === 'auto').coins, standard.find(e => e.type === 'produce' && e.source === 'auto').coins * 3);
    close(boosted.getView().production.tap, p.tap);
  }
});

test('upgrade, brand and next-machine previews retain the chosen mode and match real purchases', () => {
  for (const mode of MODES) {
    for (const key of ['tap', 'auto', 'value']) {
      const game = factory(); game.setProductionMode(mode.id); game.state.boostSeconds = 90;
      const upgrade = game.getView().upgrades.find(option => option.key === key);
      game.state.coins = upgrade.cost; assert.equal(game.buyUpgrade(key).ok, true);
      const field = key === 'tap' ? 'tap' : key === 'auto' ? 'baseIncome' : 'price';
      close(game.getView().production[field], upgrade.preview.after);
    }
    const game = factory(); game.setProductionMode(mode.id); game.state.boostSeconds = 90;
    const brand = game.getView().brand, impact = game.getView().rewards.brand.impact;
    const quote = game.quoteReward('brand'); assert.ok(quote); assert.equal(game.applyReward(quote.id).ok, true);
    const branded = game.getView().production;
    close(branded.baseAuto, brand.baseAutoAfter); close(branded.baseAuto, impact.baseAutoAfter);
    close(branded.baseIncome, brand.baseIncomeAfter); close(branded.tap, brand.tapAfter); close(branded.price, brand.priceAfter);
    const preview = game.getView().machinePreview, next = CONFIG.machines[3];
    game.state.orderIndex = next.requiredOrders; game.state.coins = next.cost;
    assert.equal(game.evolve().ok, true); assert.equal(game.state.productionMode, mode.id);
    close(game.getView().production.tap, preview.tapAfter); close(game.getView().production.baseIncome, preview.incomeAfter);
  }
});

test('pending rewarded quotes block mode changes until cancelled or completed without changing frozen amounts', () => {
  const game = factory(); game.state.orderIndex = CONFIG.machines[3].requiredOrders;
  game.setProductionMode('premium'); const expected = game.getView().rewards.sponsor.amount;
  close(expected, Math.floor(game.getView().production.baseIncome * 120));
  const quote = game.quoteReward('sponsor'); assert.ok(quote); const before = game.exportSave(NOW);
  assert.deepEqual(game.setProductionMode('rush'), { ok: false, reason: 'busy' });
  assert.deepEqual(game.exportSave(NOW), before); assert.deepEqual(game.quoteReward('sponsor'), quote);
  assert.equal(game.setProductionMode('premium').changed, false);
  assert.equal(game.applyReward(quote.id).coins, expected); assert.equal(game.setProductionMode('rush').ok, true);
  const turbo = game.quoteReward('turbo'); assert.ok(turbo);
  assert.equal(game.setProductionMode('balanced').reason, 'busy'); assert.equal(game.cancelReward(turbo.id).ok, true);
  assert.equal(game.setProductionMode('balanced').ok, true);
});