'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/core');
const { featureAccess, normalizeOnboarding, selectOnboarding } = require('../src/onboarding');
const fresh = () => new Game({ now: 1000 }).state;
const view = state => ({ state, order: { target: 50, reward: 180, ready: state.totalProduced >= 50 },
  upgrades: [{ key: 'tap', name: '爆裂玉米', cost: 16 }, { key: 'auto', name: '自动火力', cost: 24 }, { key: 'value', name: '焦糖配方', cost: 32 }] });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const goal = game => game.getView().onboarding.goal;
const earnFor = (game, key) => {
  for (let i = 0; i < 1000; i++) {
    const item = game.getView().upgrades.find(item => item.key === key);
    if (item.unlocked && item.canBuy) return;
    assert.equal(game.tap().ok, true);
  }
  assert.fail('upgrade was not affordable after production');
};
const buyFirstTap = game => { earnFor(game, 'tap'); assert.equal(game.buyUpgrade('tap').ok, true); };
const buyFirstAuto = game => { buyFirstTap(game); assert.equal(game.tap().ok, true); earnFor(game, 'auto'); assert.equal(game.buyUpgrade('auto').ok, true); };
const observeAuto = game => { for (let i = 0; i < 12; i++) { game.tick(.25); assert.equal(game.observeOnboarding(.25).ok, true); } };

test('onboarding: fresh players practice at the real machine without a queued lesson', () => {
  const state = fresh(), onboarding = selectOnboarding(view(state));
  assert.equal(Object.values(onboarding.features).some(Boolean), false);
  assert.equal(onboarding.lesson, null); assert.equal(onboarding.lessons.length, 1);
  assert.equal(onboarding.goal.step, 1); assert.equal(onboarding.goal.total, 5);
  assert.equal(onboarding.goal.source, 'onboarding'); assert.equal(onboarding.goal.action, 'tap');
  assert.equal(onboarding.goal.anchor, 'machine'); assert.equal(onboarding.goal.buttonLabel, '');
  assert.match(onboarding.nextUnlock, /点击 5 次或累计生产 16 份/);
});

test('onboarding: passive production and five taps retain their original unlock boundaries', () => {
  const state = fresh(); state.totalProduced = 15.99;
  assert.equal(featureAccess(state).tapUpgrade, false);
  state.totalProduced = 16;
  assert.equal(featureAccess(state).tapUpgrade, true); assert.equal(state.taps, 0);
  assert.equal(selectOnboarding(view(state)).goal.step, 2);
  state.totalProduced = 0; state.taps = 5;
  assert.equal(featureAccess(state).tapUpgrade, true);
});

test('onboarding: five clicks keep production active until the actual upgrade is affordable', () => {
  const game = new Game({ now: 1000 });
  for (let i = 0; i < 5; i++) game.tap();
  assert.equal(game.state.coins, 13);
  assert.equal(goal(game).action, 'tap'); assert.equal(goal(game).phase, 'save');
  assert.equal(goal(game).missingCoins, 3); assert.equal(goal(game).anchor, 'machine');
  earnFor(game, 'tap');
  assert.equal(goal(game).action, 'upgrade:tap'); assert.equal(goal(game).anchor, 'upgrades');
});

test('onboarding: actual actions teach and complete the five-step loop without waiting for a burst', () => {
  const game = new Game({ now: 1000 }); buyFirstTap(game);
  assert.equal(goal(game).phase, 'verify'); assert.equal(goal(game).step, 2);
  assert.equal(goal(game).before, 1); assert.equal(goal(game).after, 2.16);
  assert.equal(game.state.onboarding.practice.tapVerified, false);
  assert.equal(game.tap().amount, 2.16); assert.equal(game.state.onboarding.practice.tapVerified, true);
  assert.equal(goal(game).step, 3);
  earnFor(game, 'auto'); game.buyUpgrade('auto');
  assert.equal(goal(game).action, 'observe'); assert.equal(goal(game).anchor, 'wallet');
  assert.equal(goal(game).buttonLabel, ''); assert.equal(goal(game).step, 3);
  observeAuto(game); assert.equal(goal(game).step, 4);
  while (!game.getView().order.ready) game.tap();
  assert.equal(goal(game).phase, 'deliver'); assert.equal(goal(game).anchor, 'order');
  assert.equal(game.claimOrder().ok, true); assert.equal(game.state.onboarding.practice.orderClaimed, true);
  assert.equal(goal(game).action, 'upgrade:value'); assert.equal(goal(game).step, 5);
  game.buyUpgrade('value');
  assert.equal(goal(game).phase, 'verify'); assert.equal(goal(game).before, 1); assert.equal(goal(game).after, 1.38);
  game.tap();
  assert.equal(goal(game), null); assert.equal(game.getView().onboarding.completed, true);
  assert.equal(game.state.bursts, 0);
  assert.deepEqual(game.drainEvents().filter(event => event.type === 'onboardingPractice').map(event => event.id),
    ['production', 'tapVerified', 'autoObserved', 'orderClaimed', 'valueVerified']);
  game.tap(); game.tick(3); game.observeOnboarding(3);
  assert.equal(game.drainEvents().some(event => event.type === 'onboardingPractice'), false);
});

test('onboarding: observation cannot simulate production, double-count time, or finish while clicking', () => {
  const game = new Game({ now: 1000 }); buyFirstAuto(game);
  const economy = [game.state.coins, game.state.totalProduced, game.state.playedSeconds];
  assert.equal(game.observeOnboarding(3).ok, false);
  assert.deepEqual([game.state.coins, game.state.totalProduced, game.state.playedSeconds], economy);
  game.tick(2); assert.equal(game.observeOnboarding(2).seconds, 2);
  assert.equal(game.observeOnboarding(1).ok, false);
  game.tap(); assert.equal(game.state.onboarding.autoObservationSeconds, 0);
  game.tick(2); game.observeOnboarding(2);
  assert.equal(game.state.onboarding.practice.autoObserved, false);
  game.tick(1); assert.equal(game.observeOnboarding(1).completed, true);
  assert.equal(goal(game).step, 4);
});

test('onboarding: failed actions and help acknowledgments cannot advance practice', () => {
  const game = new Game({ now: 1000 }), before = JSON.stringify(game.state.onboarding.practice);
  assert.equal(game.buyUpgrade('tap').ok, false); assert.equal(game.claimOrder().ok, false);
  assert.equal(game.acknowledgeGuide('autoUpgrade').ok, false);
  assert.equal(game.acknowledgeGuide('production').ok, true); assert.equal(game.acknowledgeGuide('production').ok, true);
  assert.equal(JSON.stringify(game.state.onboarding.practice), before); assert.equal(goal(game).step, 1);
  buyFirstTap(game); const verification = JSON.stringify(goal(game));
  game.acknowledgeGuide('tapUpgrade'); game.acknowledgeGuide('production');
  assert.equal(game.buyUpgrade('invalid').ok, false);
  assert.equal(JSON.stringify(goal(game)), verification);
});

test('onboarding: skip and resume persist without unlocking features or completing practice', () => {
  const game = new Game({ now: 1000 }), features = game.getView().onboarding.features;
  assert.equal(game.setOnboardingSkipped(true).ok, true);
  assert.equal(goal(game), null); assert.equal(game.getView().onboarding.completed, false);
  assert.deepEqual(game.getView().onboarding.features, features); assert.equal(game.buyUpgrade('auto').ok, false);
  const resumed = new Game({ now: 1000, save: game.exportSave(1000) });
  assert.equal(resumed.getView().onboarding.skipped, true); assert.equal(resumed.setOnboardingSkipped(false).ok, true);
  assert.equal(goal(resumed).step, 1); assert.equal(resumed.state.onboarding.practice.production, false);
  assert.equal(resumed.setOnboardingSkipped('false').ok, false);
});

test('onboarding: first-purchase comparisons and partial observations survive restart', () => {
  const game = new Game({ now: 1000 }); buyFirstTap(game);
  const restoredTap = new Game({ now: 1000, save: game.exportSave(1000) });
  assert.equal(goal(restoredTap).phase, 'verify'); assert.equal(goal(restoredTap).before, 1);
  restoredTap.tap(); earnFor(restoredTap, 'auto'); restoredTap.buyUpgrade('auto');
  restoredTap.tick(1); restoredTap.observeOnboarding(1);
  const restoredAuto = new Game({ now: 1000, save: restoredTap.exportSave(1000) });
  assert.equal(goal(restoredAuto).observationSeconds, 1); assert.equal(restoredAuto.observeOnboarding(2).ok, false);
  restoredAuto.tick(2); assert.equal(restoredAuto.observeOnboarding(2).completed, true);
});

test('onboarding: version-one migration follows economic progress, never acknowledgments', () => {
  const state = fresh(), readAll = { version: 1, legacy: false, seen: ['production', 'tapUpgrade', 'autoUpgrade', 'valueUpgrade'] };
  state.onboarding = normalizeOnboarding(readAll, state);
  assert.equal(state.onboarding.version, 2); assert.equal(Object.values(state.onboarding.practice).some(Boolean), false);
  assert.equal(selectOnboarding(view(state)).goal.step, 1);
  state.upgrades.tap = 1; state.onboarding = normalizeOnboarding({ version: 1, legacy: false, seen: [] }, state);
  assert.equal(selectOnboarding(view(state)).goal.step, 3);
  state.upgrades.auto = 1; state.onboarding = normalizeOnboarding({ version: 1, legacy: false, seen: [] }, state);
  assert.equal(selectOnboarding(view(state)).goal.step, 4);
  state.orderIndex = 1; state.upgrades.value = 1;
  state.onboarding = normalizeOnboarding({ version: 1, legacy: false, seen: [] }, state);
  assert.equal(selectOnboarding(view(state)).goal, null);
});

test('onboarding: legacy migrations retain access and never queue explanation cards', () => {
  const state = fresh(); delete state.onboarding;
  assert.equal(normalizeOnboarding(null, state).legacy, false);
  state.machine = 2; state.orderIndex = 6; state.playedSeconds = 100;
  state.factory.owned = ['coating', 'packer', 'pressure']; state.onboarding = normalizeOnboarding(undefined, state);
  assert.equal(state.onboarding.legacy, true);
  for (const id of ['tapUpgrade', 'autoUpgrade', 'orders', 'valueUpgrade', 'modules', 'gift', 'festival', 'pressure']) assert.equal(featureAccess(state)[id], true, id);
  assert.equal(selectOnboarding(view(state)).goal, null); assert.equal(selectOnboarding(view(state)).lesson, null);
  assert.deepEqual(normalizeOnboarding(state.onboarding, state), state.onboarding);
  state.machine = 3;
  assert.equal(selectOnboarding(view(state)).lesson, null);
  assert.equal(selectOnboarding(view(state)).lessons.find(lesson => lesson.id === 'bulk').seen, false);
});

test('onboarding: optional mechanics retain their economic and time boundaries', () => {
  const state = fresh(); state.playedSeconds = 1000; assert.equal(featureAccess(state).rewards, false);
  state.orderIndex = 1; state.playedSeconds = 89.99;
  for (const id of ['tapUpgrade', 'autoUpgrade', 'orders', 'valueUpgrade', 'workshop', 'records']) assert.equal(featureAccess(state)[id], true, id);
  assert.equal(featureAccess(state).rewards, false); state.playedSeconds = 90; assert.equal(featureAccess(state).rewards, true);
  state.machine = 2; state.orderIndex = 6; let features = featureAccess(state);
  for (const id of ['pot', 'contracts', 'modules']) assert.equal(features[id], true, id);
  for (const id of ['gift', 'festival', 'pressure', 'bulk', 'feeder', 'reclaimer', 'inspector', 'souvenirs']) assert.equal(features[id], false, id);
  state.factory.active = { kind: 'gift' }; assert.equal(featureAccess(state).gift, true);
  state.factory.active = { kind: 'festival' }; assert.equal(featureAccess(state).festival, true);
  state.factory.active = null; state.orderIndex = 7; assert.equal(featureAccess(state).gift, true);
  state.orderIndex = 8; state.factory.owned = ['coating', 'packer', 'pressure']; features = featureAccess(state);
  assert.equal(features.festival, true); assert.equal(features.pressure, true);
  state.machine = 3; assert.equal(featureAccess(state).bulk, true); assert.equal(featureAccess(state).feeder, false);
  state.factory.owned.push('feeder'); assert.equal(featureAccess(state).feeder, true);
  state.factory.owned.push('reclaimer'); assert.equal(featureAccess(state).reclaimer, true);
  state.machine = 5; state.orderIndex = 19; assert.equal(featureAccess(state).souvenirs, false);
  state.orderIndex = 20; assert.equal(featureAccess(state).souvenirs, true);
});

test('onboarding: reusable help and selectors sanitize data without mutating frozen saves', () => {
  const state = fresh(); Object.assign(state, { machine: 5, orderIndex: 20, playedSeconds: 100, bursts: 1 });
  state.factory.owned = ['coating', 'packer', 'pressure', 'feeder', 'reclaimer', 'inspector'];
  state.onboarding = normalizeOnboarding({ ...state.onboarding, seen: ['production', 'production', 'tapUpgrade', 'timing', '__proto__', {}, null] }, state);
  assert.deepEqual(state.onboarding.seen, ['production', 'tapUpgrade']);
  const first = selectOnboarding(view(state));
  assert.equal(first.lessons.length, Object.keys(first.features).length + 1);
  for (const lesson of first.lessons) for (const field of ['title', 'benefit', 'instruction', 'action', 'buttonLabel']) assert.ok(lesson[field], lesson.id + ':' + field);
  assert.equal(first.nextUnlock, ''); assert.equal(first.lesson, null);
  const frozenView = freeze(view(state)), before = JSON.stringify(frozenView);
  for (let i = 0; i < 5; i++) { featureAccess(state); selectOnboarding(frozenView); normalizeOnboarding(state.onboarding, state); }
  assert.equal(JSON.stringify(frozenView), before);
});

test('onboarding: getView is read-only even while an unfinished demonstration is visible', () => {
  const game = new Game({ now: 1000 }); buyFirstAuto(game);
  freeze(game.state);
  const before = JSON.stringify(game.state);
  for (let i = 0; i < 5; i++) assert.equal(goal(game).phase, 'observe');
  assert.equal(JSON.stringify(game.state), before);
});

test('onboarding: established legacy saves do not emit beginner practice events', () => {
  const game = new Game({ now: 1000 });
  game.state.onboarding = normalizeOnboarding({ version: 1, legacy: true, seen: [] }, game.state);
  game.tap();
  game.state.coins = 1000;
  game.buyUpgrade('tap'); game.tap();
  game.buyUpgrade('auto'); game.tick(3);
  assert.equal(game.observeOnboarding(3).ok, false);
  while (!game.getView().order.ready) game.tap();
  game.claimOrder(); game.buyUpgrade('value'); game.tap();
  assert.equal(goal(game), null);
  assert.equal(game.drainEvents().some(event => event.type === 'onboardingPractice'), false);
});
