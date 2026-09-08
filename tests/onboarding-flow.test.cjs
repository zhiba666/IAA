'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const { harness, START } = require('./app-harness.cjs');

function economy(game) {
  const state = game.state || game.snapshot().state;
  return Object.fromEntries(['coins', 'totalCoins', 'totalProduced', 'taps', 'bursts', 'energy', 'playedSeconds', 'upgrades', 'orderIndex'].map(key => [key, JSON.parse(JSON.stringify(state[key]))]));
}
function finishOrder(game) {
  for (let seconds = 0; seconds < 240 && !game.getView().order.ready; seconds++) game.tick(1);
  assert.equal(game.getView().order.ready, true);
  assert.equal(game.claimOrder().ok, true);
}
function frames(h, seconds) {
  for (let i = 0; i < seconds * 10; i++) h.frame(100);
}
function tapUntilAffordable(h, key) {
  for (let taps = 0; taps < 100 && !h.snapshot().upgrades.find(item => item.key === key).canBuy; taps++) h.click('tap');
  assert.equal(h.snapshot().upgrades.find(item => item.key === key).canBuy, true, key + ' must be affordable before the lesson asks for a purchase');
}
function buyFirstTap(h) {
  tapUntilAffordable(h, 'tap');
  h.click('upgrades'); h.click('upgrade:tap');
  assert.equal(h.snapshot().state.upgrades.tap, 1);
  assert.equal(h.ui().modal, null, 'the first purchase returns to the actual machine');
}
function buyFirstAuto(h) {
  buyFirstTap(h); h.click('tap');
  tapUntilAffordable(h, 'auto');
  h.click('upgrades'); h.click('upgrade:auto');
  assert.equal(h.snapshot().state.upgrades.auto, 1);
  assert.equal(h.ui().modal, null);
  assert.equal(h.snapshot().onboarding.goal.phase, 'observe');
}

test('onboarding: a new game guides actual production and core rejects locked purchases and orders', () => {
  const game = new Game({ now: START });
  assert.equal(game.state.onboarding.version, 2);
  assert.equal(game.state.onboarding.legacy, false);
  assert.equal(game.state.onboarding.skipped, false);
  assert.deepEqual(game.state.factory.owned, []);
  assert.equal(game.getView().onboarding.lesson, null);
  assert.equal(game.getView().onboarding.goal.action, 'tap');
  assert.ok(game.getView().upgrades.every(upgrade => !upgrade.unlocked && !upgrade.canBuy));
  const before = game.exportSave(START);
  for (const key of ['tap', 'auto', 'value']) assert.equal(game.buyUpgrade(key).reason, 'guide-locked');
  assert.equal(game.claimOrder().reason, 'guide-locked');
  assert.equal(game.acknowledgeGuide('valueUpgrade').reason, 'stale-guide');
  assert.deepEqual(game.exportSave(START), before);
});

test('onboarding: real first purchases progressively open automation, orders and price upgrades without reading help', () => {
  const game = new Game({ now: START });
  for (let i = 0; i < 5; i++) game.tap();
  assert.deepEqual(game.getView().upgrades.map(upgrade => upgrade.unlocked), [true, false, false]);
  while (game.state.coins < CONFIG.upgrades.tap.baseCost) game.tap();
  assert.equal(game.buyUpgrade('tap').ok, true);
  assert.equal(game.getView().onboarding.features.orders, false);
  while (game.state.coins < CONFIG.upgrades.auto.baseCost) game.tap();
  assert.equal(game.buyUpgrade('auto').ok, true);
  assert.equal(game.getView().onboarding.features.orders, true);
  assert.equal(game.getView().onboarding.features.valueUpgrade, false);
  while (!game.getView().order.ready) game.tap();
  assert.equal(game.claimOrder().ok, true);
  assert.equal(game.state.orderIndex, 1);
  assert.equal(game.getView().onboarding.features.valueUpgrade, true);
  assert.equal(game.buyUpgrade('value').ok, true);
  assert.equal(game.state.upgrades.value, 1);
  assert.equal(game.state.rewardedCount, 0);
});

test('onboarding: passive production can unlock the first purchase without taps', () => {
  const game = new Game({ now: START });
  game.tick(40);
  assert.equal(game.state.taps, 0);
  assert.equal(game.getView().upgrades.find(item => item.key === 'tap').canBuy, true);
  assert.equal(game.buyUpgrade('tap').ok, true);
  assert.equal(game.getView().onboarding.features.autoUpgrade, true);
});

test('onboarding: the first cinema delivery unlocks gift and equipment, the second unlocks festival and pressure', () => {
  const game = new Game({ now: START });
  Object.assign(game.state, { machine: 2, orderIndex: 6, totalProduced: 20000, coins: 1000000,
    upgrades: { tap: 12, auto: 12, value: 12 }, bursts: 1 });
  let view = game.getView();
  assert.deepEqual(view.factory.equipped, []);
  assert.equal(view.factory.canConfigure, false);
  assert.deepEqual(view.contracts.options.filter(item => item.canAccept).map(item => item.kind), ['cinema']);
  for (const id of ['coating', 'packer', 'pressure']) assert.equal(game.toggleModule(id).ok, false);
  for (const kind of ['gift', 'festival']) assert.equal(game.acceptContract(kind).reason, 'guide-locked');
  assert.equal(game.acceptContract('cinema').ok, true);
  finishOrder(game);
  assert.equal(game.state.orderIndex, 7);
  view = game.getView();
  assert.deepEqual(view.factory.owned.slice().sort(), ['coating', 'packer']);
  assert.deepEqual(view.contracts.options.filter(item => item.canAccept).map(item => item.kind), ['cinema', 'gift']);
  assert.ok(view.factory.modules.filter(m => m.owned).every(m => m.equipped && m.unlocked));
  assert.equal(game.toggleModule('pressure').ok, false);
  assert.equal(game.acceptContract('gift').ok, true);
  finishOrder(game);
  assert.equal(game.state.orderIndex, 8);
  assert.deepEqual(game.getView().contracts.options.filter(item => item.canAccept).map(item => item.kind), ['cinema', 'gift', 'festival']);
  assert.deepEqual(game.getView().factory.owned.slice().sort(), ['coating', 'packer', 'pressure']);
  assert.equal(game.getView().factory.pressureMode, 'auto');
});

test('onboarding: historical saves retain earned features and migrate loadouts into permanent collections without replaying history', () => {
  const source = new Game({ now: START });
  Object.assign(source.state, { machine: 2, orderIndex: 6, totalProduced: 20000, coins: 1000000, playedSeconds: 120, bursts: 1 });
  source.state.factory.equipped = ['coating', 'packer'];
  source.state.factory.version = 2;
  const saved = source.exportSave(START); delete saved.onboarding;
  const restored = new Game({ now: START, save: saved });
  assert.equal(restored.state.onboarding.legacy, true);
  assert.equal(restored.getView().onboarding.lesson, null);
  assert.equal(restored.getView().tutorial, null);
  assert.ok(['coating', 'packer'].every(id => restored.getView().factory.owned.includes(id)));
  assert.ok(restored.getView().upgrades.every(item => item.unlocked));
  assert.deepEqual(restored.getView().contracts.options.filter(item => item.canAccept).map(item => item.kind), ['cinema', 'gift', 'festival']);
  assert.equal(restored.toggleModule('packer').ok, false);
  assert.equal(restored.toggleModule('pressure').ok, false);
  restored.state.machine = 3;
  assert.equal(restored.getView().onboarding.lesson, null, 'new abilities never enqueue blocking help');
  assert.ok(restored.getView().onboarding.lessons.some(item => item.id === 'bulk'), 'a new ability remains available in contextual help');
});

test('onboarding: starting the game immediately exposes the machine and keeps production running', () => {
  const h = harness({ freshOnboarding: true, autoStart: false });
  assert.equal(h.ui().startup, true);
  assert.equal(h.ui().modal, null);
  h.key('Enter');
  assert.equal(h.ui().modal, null);
  assert.equal(h.snapshot().onboarding.goal.action, 'tap');
  const before = economy(h);
  for (const key of ['Digit1', 'Digit2', 'Digit3', 'KeyO', 'KeyM', 'KeyQ', 'KeyP']) { h.key(key); assert.equal(h.ui().modal, null); }
  assert.deepEqual(economy(h), before);
  h.key('Space');
  assert.equal(h.snapshot().state.taps, 1);
  const produced = h.snapshot().state.totalProduced;
  frames(h, 2);
  assert.ok(h.snapshot().state.totalProduced > produced);
  assert.equal(h.ui().modal, null);
  assert.equal(h.rewardRequests.length, 0);
});

test('onboarding: the first upgrade is taught only when affordable and requires a stronger tap after purchase', () => {
  const h = harness({ freshOnboarding: true });
  for (let i = 0; i < 5; i++) h.key('Space');
  assert.equal(h.ui().modal, null);
  assert.equal(h.snapshot().upgrades.find(item => item.key === 'tap').canBuy, false);
  assert.equal(h.snapshot().onboarding.goal.action, 'tap', 'being three coins short keeps the player on the machine');
  tapUntilAffordable(h, 'tap');
  assert.equal(h.snapshot().onboarding.goal.phase, 'buy');
  const baseTap = h.snapshot().production.tap;
  h.click('upgrades'); h.click('upgrade:tap');
  assert.equal(h.ui().modal, null);
  assert.equal(h.snapshot().onboarding.goal.phase, 'verify');
  assert.equal(h.snapshot().onboarding.goal.action, 'tap');
  frames(h, 5);
  assert.equal(h.snapshot().onboarding.goal.phase, 'verify', 'passive production cannot stand in for trying the upgraded machine');
  const beforeTap = h.snapshot().state.totalProduced;
  h.click('tap');
  assert.ok(h.snapshot().state.totalProduced - beforeTap > baseTap);
  assert.equal(h.snapshot().onboarding.goal.upgradeKey, 'auto');
  h.click('settings'); h.click('close');
  const restored = harness({ save: h.saves.at(-1) });
  assert.equal(restored.ui().modal, null);
  assert.equal(restored.snapshot().onboarding.goal.upgradeKey, 'auto', 'the verified exercise persists across a reload');
});

test('onboarding: automatic income is observed for three visible seconds, excluding panels, hidden time and held production', () => {
  const h = harness({ freshOnboarding: true });
  buyFirstAuto(h);
  const produced = h.snapshot().state.totalProduced;
  h.frame(3000);
  assert.equal(h.snapshot().onboarding.goal.phase, 'observe', 'one stalled frame cannot replace watching income arrive');
  h.click('guidebook'); frames(h, 4);
  assert.equal(h.snapshot().onboarding.goal.phase, 'observe');
  h.click('close'); h.hide(); frames(h, 4); h.show(); h.frame(0);
  assert.equal(h.snapshot().onboarding.goal.phase, 'observe');
  h.pointer('down', 'tap'); frames(h, 4);
  assert.equal(h.snapshot().onboarding.goal.phase, 'observe');
  h.pointer('up', 'tap'); frames(h, 2);
  assert.equal(h.snapshot().onboarding.goal.phase, 'observe', 'only actual visible observation counts');
  frames(h, 1);
  assert.notEqual(h.snapshot().onboarding.goal.phase, 'observe');
  assert.ok(h.snapshot().state.totalProduced > produced, 'production continues throughout visible help and practice');
  assert.equal(h.ui().modal, null);
});

test('onboarding: first delivery leads to the price upgrade, while optional help never displaces the next action', () => {
  const h = harness({ freshOnboarding: true });
  buyFirstAuto(h); frames(h, 3.1);
  for (let taps = 0; taps < 100 && !h.snapshot().order.ready; taps++) h.click('tap');
  assert.equal(h.snapshot().order.ready, true);
  h.click('order'); h.click('claimOrder');
  assert.equal(h.snapshot().state.orderIndex, 1);
  assert.equal(h.ui().modal, null);
  assert.equal(h.snapshot().onboarding.goal.upgradeKey, 'value');
  h.click('upgrades'); h.click('upgrade:value');
  assert.equal(h.ui().modal, null);
  assert.equal(h.snapshot().onboarding.goal.phase, 'verify');
  h.click('tap');
  for (const action of ['workshop', 'quests', 'guidebook']) { h.click(action); h.click('close'); assert.equal(h.ui().modal, null); }
  frames(h, 100);
  assert.equal(h.ui().modal, null, 'unlocking optional rewards cannot produce an unsolicited help sheet');
  assert.equal(h.snapshot().onboarding.lesson, null);
  assert.equal(h.snapshot().state.rewardedCount, 0);
  assert.equal(h.rewardRequests.length, 0);
});

test('onboarding: manual help keeps production running, closes without navigation and does not complete practice', () => {
  const h = harness({ freshOnboarding: true });
  buyFirstTap(h);
  const goal = h.snapshot().onboarding.goal.id;
  h.click('guidebook'); h.click('guideReview:tapUpgrade');
  assert.equal(h.ui().modal.type, 'guide');
  const produced = h.snapshot().state.totalProduced;
  frames(h, 4);
  assert.ok(h.snapshot().state.totalProduced > produced);
  assert.equal(h.snapshot().onboarding.goal.id, goal);
  h.click('close');
  assert.equal(h.ui().modal, null, 'closing help must not navigate to upgrades');
  h.click('guidebook'); h.click('guideReview:tapUpgrade'); h.key('Escape');
  assert.equal(h.ui().modal, null);
  assert.equal(h.snapshot().onboarding.goal.id, goal);
  assert.equal(h.snapshot().state.upgrades.tap, 1);

  const game = new Game({ now: START });
  while (game.state.coins < CONFIG.upgrades.tap.baseCost) game.tap();
  game.buyUpgrade('tap');
  const practice = game.getView().onboarding.goal;
  assert.equal(game.acknowledgeGuide('tapUpgrade').ok, true);
  assert.deepEqual(game.getView().onboarding.goal, practice, 'acknowledging help cannot replace the hands-on exercise');
});

test('onboarding: skipping and resuming tips persists without bypassing economic unlocks', () => {
  const h = harness({ freshOnboarding: true });
  const features = h.snapshot().onboarding.features;
  h.click('guideSkip');
  assert.equal(h.snapshot().state.onboarding.skipped, true);
  assert.equal(h.snapshot().onboarding.goal, null);
  assert.deepEqual(h.snapshot().onboarding.features, features);
  h.click('upgrade:auto'); h.click('claimOrder');
  assert.equal(h.snapshot().state.upgrades.auto, 0);
  assert.equal(h.snapshot().state.orderIndex, 0);
  const restored = harness({ save: h.saves.at(-1) });
  assert.equal(restored.snapshot().state.onboarding.skipped, true);
  restored.click('guidebook');
  restored.click('guideResume');
  assert.equal(restored.snapshot().state.onboarding.skipped, false);
  assert.equal(restored.snapshot().onboarding.goal.action, 'tap');
  assert.equal(restored.ui().modal, null);
});
