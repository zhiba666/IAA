'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG, QUEST_CHAPTERS } = require('../src/core');
const { selectNextStep } = require('../src/next-step');

const NOW = 1800000000000;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-10));
function factory(funding = false) {
  const game = new Game({ now: NOW });
  Object.assign(game.state, { machine: 2, orderIndex: funding ? 10 : 6,
    totalProduced: funding ? 847526.7689210637 : CONFIG.orders[5].target,
    coins: 19440801.157558426, taps: 20, bursts: 1,
    upgrades: { tap: 16, auto: 17, value: 17 },
    claimedQuests: QUEST_CHAPTERS.flatMap(chapter => chapter.quests.map(quest => quest.id)) });
  return game;
}

test('mode advice follows the current bottleneck and previews the exact result of the player selecting a mode', () => {
  for (const funding of [false, true]) for (const mode of ['balanced', funding ? 'rush' : 'premium']) {
    const game = factory(funding); game.setProductionMode(mode); game.state.brandLevel = 3;
    const before = game.getView().production, step = selectNextStep(game.getView());
    assert.equal(step.kind, 'mode'); assert.equal(step.modeId, funding ? 'premium' : 'rush');
    assert.equal(step.bottleneck, funding ? 'funding' : 'production');
    assert.equal(step.action, 'modeAdvice:' + step.id); assert.equal(step.enabled, true);
    assert.match(step.detail, /份\/秒/); assert.match(step.detail, /金币\/秒/);
    assert.match(step.reason, funding ? /攒换代金币.*产量会减少/ : /本单还缺产量.*收入会减少/);
    close(step.preview.productionBefore, before.baseAuto); close(step.preview.incomeBefore, before.baseIncome);
    assert.equal(game.setProductionMode(step.modeId).ok, true);
    const after = game.getView().production;
    close(step.preview.productionAfter, after.baseAuto); close(step.preview.incomeAfter, after.baseIncome);
    if (funding) { assert.ok(after.baseIncome > before.baseIncome); assert.ok(after.baseAuto < before.baseAuto); }
    else { assert.ok(after.baseAuto > before.baseAuto); assert.ok(after.baseIncome < before.baseIncome); }
    assert.notEqual(selectNextStep(game.getView()).kind, 'mode', 'the best current mode does not invite another switch');
  }
});

test('dismissing a stable suggestion restores useful investment advice without sacrificing its estimate', () => {
  const game = factory(true), view = game.getView(), mode = selectNextStep(view);
  const context = { dismissedModeSuggestion: mode.id };
  const investment = selectNextStep(view, null, context);
  assert.equal(investment.kind, 'upgrade'); assert.equal(investment.estimate.basis, 'permanent-auto-income');
  assert.deepEqual(investment, selectNextStep(view, null, { suppressModeAdvice: true }));
  const before = (view.nextMachine.cost - view.state.coins) / view.production.baseIncome;
  game.buyUpgrade(investment.upgradeKey);
  const after = game.getView();
  close(investment.estimate.beforeSeconds, before);
  close(investment.estimate.afterSeconds, (after.nextMachine.cost - after.state.coins) / after.production.baseIncome);
  assert.equal(selectNextStep(after).id, mode.id, 'wallet and upgrade changes do not revive a dismissed suggestion');
  assert.notEqual(selectNextStep(after, null, context).kind, 'mode');
});

test('a new machine or a changed funding bottleneck can offer a fresh suggestion', () => {
  const game = factory(false), production = selectNextStep(game.getView());
  game.state.orderIndex = 10; game.state.totalProduced = CONFIG.orders[9].target;
  const funding = selectNextStep(game.getView(), null, { dismissedModeSuggestion: production.id });
  assert.equal(funding.kind, 'mode'); assert.notEqual(funding.id, production.id);
  game.setProductionMode('premium'); game.state.coins = CONFIG.machines[3].cost;
  assert.equal(game.evolve().ok, true);
  const nextStage = selectNextStep(game.getView(), null, { dismissedModeSuggestion: funding.id });
  assert.equal(nextStage.kind, 'mode'); assert.equal(nextStage.modeId, 'rush');
  assert.notEqual(nextStage.id, production.id);
});

test('collection, evolution and explicit teaching keep priority over a mode opportunity', () => {
  const game = factory(true), view = game.getView();
  const quest = { id: 'finish-multi', source: 'quest', ready: true, action: 'questClaim:finish-multi', reward: 4000000 };
  assert.equal(selectNextStep(view, quest).action, quest.action);
  const upgrade = { id: 'tracked-upgrade', source: 'quest', ready: false, action: 'upgrade:tap' };
  assert.equal(selectNextStep(view, upgrade).action, 'upgrade:tap');
  const tapping = { id: 'tracked-burst', source: 'quest', ready: false, action: 'tap' };
  assert.equal(selectNextStep(view, tapping).action, 'tap');
  const orders = { id: 'tracked-order', source: 'quest', ready: false, action: 'order' };
  assert.notEqual(selectNextStep(view, orders).kind, 'mode');
  const learning = { id: 'learn-heat', source: 'learning', action: 'heatLesson', title: '试试余热接力', text: '完美爆锅后点击生产。' };
  const lessonStep=selectNextStep(view,learning);
  assert.equal(lessonStep.id,learning.id);assert.equal(lessonStep.kind,'learning');
  assert.equal(lessonStep.action,'heatLesson');assert.equal(lessonStep.enabled,true);assert.equal(lessonStep.detail,learning.text);
  game.state.totalProduced = CONFIG.orders[10].target;
  assert.equal(selectNextStep(game.getView()).kind, 'order');
  assert.equal(selectNextStep(game.getView(), learning).kind, 'order');
  game.state.totalProduced = CONFIG.orders[9].target; game.state.coins = CONFIG.machines[3].cost;
  assert.equal(selectNextStep(game.getView()).kind, 'machine');
  assert.equal(selectNextStep(game.getView(), learning).kind, 'machine');
});

test('locked, absent or unusable mode previews preserve existing guidance', () => {
  const game = factory(true), view = game.getView();
  const expected = selectNextStep(view, null, { suppressModeAdvice: true });
  for (const modes of [undefined, { ...view.productionModes, unlocked: false },
    { ...view.productionModes, options: [] }, { ...view.productionModes, options: [{ id: 'premium', preview: { baseAuto: 10, baseIncome: Infinity } }] }]) {
    assert.deepEqual(selectNextStep({ ...view, productionModes: modes }), expected);
  }
  const early = factory(false); early.state.machine = 1;
  assert.notEqual(selectNextStep(early.getView()).kind, 'mode');
});

test('mode guidance is read-only, independent of turbo and still useful after upgrades are maxed', () => {
  const game = factory(false); game.state.upgrades = { tap: 24, auto: 24, value: 24 };
  const state = game.exportSave(NOW), events = JSON.stringify(game.events), view = game.getView();
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const context = freeze({}), ordinary = selectNextStep(freeze(JSON.parse(JSON.stringify(view))), null, context);
  assert.equal(ordinary.kind, 'mode');
  assert.deepEqual(game.exportSave(NOW), state); assert.equal(JSON.stringify(game.events), events);
  game.state.boostSeconds = CONFIG.turboDuration;
  assert.deepEqual(selectNextStep(game.getView()), ordinary);
  game.state.machine = 5; game.state.orderIndex = 20; game.state.totalProduced = CONFIG.orders[19].target;
  assert.equal(selectNextStep(game.getView()).modeId, 'rush', 'loop orders still have a production objective');
});
