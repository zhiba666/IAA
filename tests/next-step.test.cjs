'use strict';
const { legacyGame } = require('./legacy-fixture.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG, QUEST_CHAPTERS } = require('../src/core');
const { selectCurrentTarget } = require('../src/experience');
const { selectNextStep } = require('../src/next-step');

const NOW = 1800000000000;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-10), `${actual} differs from ${expected}`);
const readyFactory = (coins = 1000) => {
  const game = legacyGame({ now: NOW });
  Object.assign(game.state, { coins, taps: 5, bursts: 1, orderIndex: 3, totalProduced: 800,
    upgrades: { tap: 1, auto: 4, value: 1 },
    claimedQuests: QUEST_CHAPTERS.slice(0, 2).flatMap(chapter => chapter.quests.map(quest => quest.id)) });
  return game;
};
const select = game => { const view = game.getView(); return selectNextStep(view, selectCurrentTarget(view)); };
const secondsToMachine = game => {
  const view = game.getView();
  return Math.max(0, view.nextMachine.cost - game.state.coins) / view.production.baseIncome;
};
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
};

test('next step: a distant equipment fund recommends the purchase that reaches the goal sooner, not the cheapest upgrade', () => {
  const game = readyFactory(1000), before = secondsToMachine(game), step = select(game);
  assert.equal(step.action, 'upgrade:auto');
  assert.equal(step.enabled, true);
  assert.equal(step.estimate.basis, 'permanent-auto-income');
  assert.equal(game.buyUpgrade(step.upgradeKey).ok, true);
  const after = secondsToMachine(game);
  close(before, 2299.299389204596); close(after, 1474.6042054370798);
  close(step.estimate.beforeSeconds, before); close(step.estimate.afterSeconds, after);
  const cheaper = readyFactory(1000); cheaper.buyUpgrade('value');
  assert.ok(after < secondsToMachine(cheaper));
  assert.ok(after < before);
});

test('next step: near the equipment goal, the smaller recipe investment beats the larger production upgrade', () => {
  const game = readyFactory(29500), before = secondsToMachine(game), step = select(game);
  assert.equal(step.action, 'upgrade:value');
  game.buyUpgrade(step.upgradeKey);
  close(before, 39.64309291732062); close(secondsToMachine(game), 33.566126872603405);
  const automatic = readyFactory(29500); automatic.buyUpgrade('auto');
  assert.ok(secondsToMachine(automatic) > before);
  assert.ok(secondsToMachine(game) < before);
});

test('next step: save the final equipment coins when every purchase would delay the goal', () => {
  const game = readyFactory(29900), before = secondsToMachine(game), step = select(game);
  assert.equal(step.kind, 'save'); assert.equal(step.action, 'machine'); assert.equal(step.enabled, true);
  assert.equal(step.missingCoins, 100); assert.match(step.detail, /100/);
  for (const key of ['auto', 'value', 'tap']) {
    const alternative = readyFactory(29900); alternative.buyUpgrade(key);
    assert.ok(secondsToMachine(alternative) > before);
  }
});

test('next step: crossing the actual machine affordability threshold changes saving into immediate evolution', () => {
  const game = readyFactory(CONFIG.machines[1].cost - 0.1);
  assert.equal(select(game).kind, 'save');
  game.state.coins = CONFIG.machines[1].cost;
  const step = select(game);
  assert.equal(step.kind, 'machine'); assert.equal(step.action, 'machine');
  assert.equal(game.evolve().ok, true); assert.equal(game.state.machine, 1);
});

test('next step: completed teaching rewards arrive automatically and stop asking for manual claims', () => {
  const game = readyFactory(30000), view = game.getView();
  const target = selectCurrentTarget(view, { questGuideId: 'expand-electric' });
  // This quest is not ready until the machine evolves; complete it in core first.
  assert.equal(target.ready, false);
  const before=game.state.coins;game.evolve();
  const completedView = game.getView(), completed = selectCurrentTarget(completedView, { questGuideId: 'expand-electric' });
  const step = selectNextStep(completedView, completed);
  assert.ok(game.state.claimedQuests.includes('expand-electric'));
  assert.equal(game.state.coins,before-CONFIG.machines[1].cost+1500);
  assert.notEqual(step.kind,'quest');assert.ok(!step.action.startsWith('questClaim:'));
  assert.notEqual(completed.id,'expand-electric');
});

test('next step: a selected ready machine takes priority even when another order can be collected', () => {
  const game = readyFactory(30000); game.state.totalProduced = CONFIG.orders[3].target;
  const view = game.getView(); assert.equal(view.order.ready, true);
  assert.equal(selectNextStep(view, selectCurrentTarget(view)).kind, 'machine');
});

test('next step: a ready order offers collection instead of buying another upgrade', () => {
  const game = readyFactory(1000); game.state.totalProduced = CONFIG.orders[3].target;
  const step = select(game);
  assert.equal(step.kind, 'order'); assert.equal(step.action, 'order');
  assert.match(step.detail, /8,800/);
  assert.equal(game.claimOrder().ok, true);
  assert.equal(game.state.orderIndex, 4);
});

test('next step: a tracked recipe target keeps its direction while the cheaper production upgrades are affordable', () => {
  const game = readyFactory(200); game.state.machine = 1; game.state.upgrades.value = 5;
  const view = game.getView(), target = selectCurrentTarget(view, { questGuideId: 'expand-recipe' });
  const step = selectNextStep(view, target);
  assert.equal(step.upgradeKey, 'value'); assert.equal(step.enabled, false);
  assert.ok(step.missingCoins > 0); assert.match(step.reason, /还差/);
  assert.equal(game.buyUpgrade(step.upgradeKey).reason, 'not-enough-coins');
});

test('next step: a tutorial upgradeKey preserves the intended automatic upgrade while the target action asks for production', () => {
  const game = new Game({ now: NOW });
  for(let i=0;i<8;i++)game.tap();
  game.buyUpgrade('tap');game.tap();
  game.state.coins=23.9;
  const view = game.getView(), target = { ...view.tutorial, id: 'tutorial:2', source: 'tutorial', upgradeKey: 'auto' };
  assert.equal(target.action, 'tap');
  const step = selectNextStep(view, target);
  assert.equal(step.upgradeKey, 'auto'); assert.equal(step.action, 'tap'); assert.equal(step.enabled, true); assert.match(step.detail, /1 金币/);
  game.state.coins = CONFIG.upgrades.auto.baseCost;
  assert.equal(selectNextStep(game.getView(), target).action, 'upgrade:auto');
});

test('next step: tap and burst teaching continues production without inventing a helpful upgrade', () => {
  const game = new Game({ now: NOW }); game.state.coins = 1000;
  const view = game.getView();
  assert.equal(selectNextStep(view, selectCurrentTarget(view)).kind, 'produce');
  const trackedBurst = { id: 'operate-burst', source: 'quest', action: 'tap', title: '免费大喷发', ready: false };
  assert.equal(selectNextStep(view, trackedBurst).action, 'tap');
});

test('next step: missing orders favor production and the suggested purchase really increases portions per second', () => {
  const game = readyFactory(1000); game.state.orderIndex = 2; game.state.totalProduced = 200;
  const view = game.getView(), step = selectNextStep(view, { ...view.goal, source: 'machine' });
  assert.equal(step.upgradeKey, 'auto'); assert.match(step.detail, /份\/秒/);
  const before = view.production;
  game.buyUpgrade(step.upgradeKey);
  const after = game.getView().production;
  assert.ok(after.baseAuto > before.baseAuto); assert.equal(after.price, before.price);
});

test('next step: an unaffordable production goal waits for auto even when tap and recipe are cheaper', () => {
  const game = readyFactory(100); game.state.orderIndex = 2; game.state.totalProduced = 200;
  const step = selectNextStep(game.getView(), null);
  assert.equal(step.upgradeKey, 'auto'); assert.equal(step.enabled, false);
  assert.equal(game.getView().upgrades.find(upgrade => upgrade.key === 'tap').canBuy, true);
  assert.equal(game.getView().upgrades.find(upgrade => upgrade.key === 'value').canBuy, true);
});

test('next step: an already complete equipment fund is preserved until the missing orders are complete', () => {
  const game = readyFactory(30000); game.state.orderIndex = 2; game.state.totalProduced = 200;
  const step = selectNextStep(game.getView(), null);
  assert.equal(step.kind, 'order'); assert.match(step.reason, /金币已备齐/);
  assert.equal(game.state.coins, CONFIG.machines[1].cost);
  const cost = game.getView().upgrades.find(upgrade => upgrade.key === 'auto').cost;
  game.state.coins += cost - 0.1;
  assert.equal(selectNextStep(game.getView(), null).kind, 'order');
  game.state.coins += 0.1;
  const surplus = selectNextStep(game.getView(), null);
  assert.equal(surplus.upgradeKey, 'auto');
  game.buyUpgrade(surplus.upgradeKey);
  close(game.state.coins, CONFIG.machines[1].cost);
});

test('next step: temporary turbo does not change an investment or its permanent-income estimate', () => {
  const game = readyFactory(1000), ordinary = select(game);
  game.state.boostSeconds = CONFIG.turboDuration;
  assert.ok(game.getView().production.auto > game.getView().production.baseAuto);
  assert.deepEqual(select(game), ordinary);
});

test('next step: brand production bonuses are included in the real purchased income estimate', () => {
  const game = readyFactory(100000);
  Object.assign(game.state, { machine: 1, orderIndex: 6, totalProduced: 20000, brandLevel: 2 });
  // Settle rewards earned by the fixture's already completed machine/orders
  // before comparing the marginal effect of its next investment.
  game.tick(1);game.drainEvents();
  const view = game.getView(), target = { ...view.goal, source: 'machine' }, step = selectNextStep(view, target);
  assert.equal(step.kind, 'upgrade');
  const before = secondsToMachine(game);
  game.buyUpgrade(step.upgradeKey);
  close(step.estimate.beforeSeconds, before);
  close(step.estimate.afterSeconds, secondsToMachine(game));
});

test('next step: an unfinished final-machine contract can still improve real per-click output after auto is maxed', () => {
  const game = readyFactory(1e20);
  Object.assign(game.state, { machine: 5, orderIndex: 19, totalProduced: CONFIG.orders[18].target,
    upgrades: { tap: 1, auto: CONFIG.maxUpgradeLevel, value: 1 } });
  assert.ok(game.acceptContract('cinema').ok);
  const view = game.getView(); assert.equal(view.order.isLoop, false);assert.equal(view.order.completed,false);
  const step = selectNextStep(view, { ...view.goal, source: 'order' }, { suppressModeAdvice: true });
  assert.equal(step.upgradeKey, 'tap'); assert.match(step.detail, /份\/次/);
  const before = view.production;
  game.buyUpgrade(step.upgradeKey);
  assert.ok(game.getView().production.tap > before.tap);
  assert.equal(game.getView().production.baseAuto, before.baseAuto);
});

test('next step: fully upgraded production offers the active order instead of a disabled level-24 purchase', () => {
  const game = readyFactory(1e20);
  Object.assign(game.state, { machine: 5, orderIndex: 19, totalProduced: CONFIG.orders[18].target,
    upgrades: { tap: CONFIG.maxUpgradeLevel, auto: CONFIG.maxUpgradeLevel, value: 1 }, refinements:{yield:3,value:3} });
  assert.ok(game.acceptContract('gift').ok);
  const step = selectNextStep(game.getView(), null, { suppressModeAdvice: true });
  assert.equal(step.kind, 'contract'); assert.equal(step.enabled, true);assert.equal(step.action,'order');
  assert.match(step.detail,/糖衣成品/);
  assert.equal(step.upgradeKey, undefined);
});

test('next step: advice does not mutate a frozen view, save, order counters or queued events', () => {
  const game = readyFactory(1000); game.tap();
  const before = JSON.stringify(game.state), events = JSON.stringify(game.events), view = game.getView();
  const originalOrder = view.upgrades.map(upgrade => upgrade.key);
  freeze(view);
  const target = freeze(selectCurrentTarget(view));
  for (let i = 0; i < 5; i++) selectNextStep(view, target);
  assert.equal(JSON.stringify(game.state), before); assert.equal(JSON.stringify(game.events), events);
  assert.deepEqual(view.upgrades.map(upgrade => upgrade.key), originalOrder);
});

test('next step: an unusable preview cannot produce a bogus investment or nonfinite estimate', () => {
  const game = readyFactory(1000), view = game.getView();
  view.upgrades = view.upgrades.map(upgrade => ({ ...upgrade, preview: null }));
  const step = selectNextStep(view, null);
  assert.equal(step.kind, 'save'); assert.equal(step.estimate, undefined);
  view.production.baseIncome = 0;
  assert.equal(selectNextStep(view, null).kind, 'save');
});

test('next step: selecting a contract never chooses or equips a module on the player behalf',()=>{
  const game=readyFactory(1000);Object.assign(game.state,{machine:2,orderIndex:6,totalProduced:20000});
  const before=game.exportSave(NOW),events=game.drainEvents();
  for(let i=0;i<5;i++){const step=select(game);assert.equal(step.kind,'order');assert.equal(step.action,'order');assert.match(step.detail,/客户需求/);}
  assert.deepEqual(game.exportSave(NOW),before);assert.equal(game.getView().contracts.active,null);assert.deepEqual(game.drainEvents(),events);
});

test('next step: missing machine capability recommends real funding or evolution before offering an unusable contract',()=>{
  for(const [machine,orderIndex] of [[1,6],[2,10],[3,14],[4,18]]){
    const game=readyFactory(1);Object.assign(game.state,{machine,orderIndex,totalProduced:CONFIG.orders[orderIndex-1].target});
    assert.equal(game.getView().order.awaitingSelection,true);assert.ok(game.getView().contracts.options.every(item=>!item.canAccept));
    assert.equal(select(game).action,'machine');
    game.state.coins=CONFIG.machines[machine+1].cost;assert.equal(select(game).kind,'machine');
    assert.ok(game.evolve().ok);assert.equal(select(game).action,'order');
  }
});

test('next step: stored pressure becomes an explicit production action and completion stays finite',()=>{
  const game=readyFactory(1000);Object.assign(game.state,{machine:2,orderIndex:6,totalProduced:20000});
  game.state.factory.owned.push('pressure');game.setPressureMode('hold');assert.ok(game.acceptContract('festival').ok);
  game.state.energy=99;game.tick(1);const step=select(game);assert.equal(step.kind,'pressure');assert.equal(step.action,'releasePressure');
  assert.ok(game.releasePressure().ok);assert.notEqual(select(game).action,'releasePressure');
  Object.assign(game.state,{machine:5,orderIndex:20});
  const completed=select(game);assert.equal(completed.kind,'completion');assert.equal(completed.action,'completion');assert.equal(completed.upgradeKey,undefined);
});
