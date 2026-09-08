'use strict';
const { legacyGame } = require('./legacy-fixture.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Game, CONFIG } = require('../src/core.js');
const { dispatchQAAction: act } = require('../tools/qa-actions.cjs');
const NOW = 1000000;

function fixture() {
  const game = legacyGame({ now: NOW });
  Object.assign(game.state, { machine: 3, orderIndex: 10, totalProduced: CONFIG.orders[9].target,
    coins: 1e12, playedSeconds: 120, bursts: 1, upgrades: { tap: 16, auto: 14, value: 14 } });
  game._autoQuests(); game.drainEvents();
  return { game, ui: { modal: null, startup: false, adBusy: false, toast: '' } };
}
function unchanged(game, callback) {
  game.drainEvents(); const before = game.exportSave(NOW), result = callback();
  assert.deepEqual(game.exportSave(NOW), before); assert.deepEqual(game.drainEvents(), []);
  return result;
}
function contractQuote(game,ui,kind='cinema') {
  act(game,ui,'order');return ui.modal.contractQuotes[kind];
}

test('QA batch purchase requires unlocked upgrades, selected quantity and a current quote', () => {
  const { game, ui } = fixture(), quote = game.getView().upgrades.find(option => option.key === 'auto').bulk;
  const action = ['upgradeBatch', 'auto', quote.fromLevel, quote.count, quote.cost].join(':');
  for (const modal of [null, { type: 'settings', quantity: 5 }, { type: 'upgrades', quantity: 1 }]) {
    ui.modal = modal; assert.equal(unchanged(game, () => act(game, ui, action)), null);
  }
  act(game, ui, 'upgrades');
  act(game, ui, 'upgradeQuantity:2'); assert.equal(ui.modal.quantity, 1);
  act(game, ui, 'upgradeQuantity:5'); assert.equal(ui.modal.quantity, 5);
  assert.equal(unchanged(game, () => act(game, ui, action + ':extra')), null);
  const wrongPrice = ['upgradeBatch', 'auto', quote.fromLevel, quote.count, quote.cost + 1].join(':');
  assert.equal(unchanged(game, () => act(game, ui, wrongPrice)).ok, false);
  assert.equal(act(game, ui, action).ok, true);
  assert.equal(game.state.upgrades.auto, quote.fromLevel + quote.count);
  assert.equal(unchanged(game, () => act(game, ui, action)).ok, false);

  const locked = new Game({ now: NOW }), lockedUI = { modal: { type: 'upgrades', quantity: 5 } };
  assert.equal(unchanged(locked, () => act(locked, lockedUI, action)), null);
  act(locked, lockedUI, 'upgradeQuantity:1'); assert.equal(lockedUI.modal.quantity, 5);
});

test('QA contract selection validates frozen displayed quotes and pays the real completed contract', () => {
  const {game,ui}=fixture(),quote=contractQuote(game,ui),action='contractAccept:cinema:'+quote.id;
  assert.equal(unchanged(game,()=>act(game,ui,action+':stale')),null);
  ui.modal={type:'workshop',contractQuotes:{cinema:quote}};assert.equal(unchanged(game,()=>act(game,ui,action)),null);
  contractQuote(game,ui);game.tick(2);assert.equal(ui.modal.contractQuotes.cinema.reward,quote.reward,'time does not silently rewrite a displayed quote');
  assert.ok(act(game,ui,action).ok);assert.equal(ui.modal,null);assert.equal(game.getView().contracts.active.id,quote.id);
  for(let i=0;i<200&&!game.getView().order.ready;i++)game.tick(1);
  const expected=game.getView().order.reward,coins=game.state.coins,order=game.state.orderIndex;
  act(game,ui,'order');assert.ok(act(game,ui,'claimOrder').ok);
  assert.equal(game.state.orderIndex,order+1);assert.ok(game.state.coins>=coins+expected);
  assert.equal(unchanged(game,()=>act(game,ui,'claimOrder')).ok,false);
});

test('QA rejects stale economic quotes after an upgrade and accepts only the newly reviewed quote', () => {
  const {game,ui}=fixture(),quote=contractQuote(game,ui,'gift');
  game.buyUpgrade('auto');
  assert.equal(unchanged(game,()=>act(game,ui,'contractAccept:gift:'+quote.id)).reason,'stale-contract');
  const current=contractQuote(game,ui,'gift');assert.notEqual(current.basis,quote.basis);
  assert.ok(act(game,ui,'contractAccept:gift:'+current.id).ok);
});

test('contract cancellation requires two clicks in the same open panel and clears no earned money', () => {
  const {game,ui}=fixture(),quote=contractQuote(game,ui,'gift');
  assert.ok(act(game,ui,'contractAccept:gift:'+quote.id).ok);game.tick(2);
  const active=game.getView().contracts.active,cancel='contractCancel:'+active.id;
  assert.ok(active.heldProduction>0);assert.equal(unchanged(game,()=>act(game,ui,cancel)),null);
  act(game,ui,'order');assert.equal(unchanged(game,()=>act(game,ui,cancel)),null);assert.equal(ui.modal.cancelContractId,active.id);
  act(game,ui,'close');act(game,ui,'order');assert.equal(ui.modal.cancelContractId,undefined);
  assert.equal(unchanged(game,()=>act(game,ui,cancel)),null);const coins=game.state.coins;
  assert.ok(act(game,ui,cancel).ok);assert.equal(game.state.coins,coins);assert.equal(game.getView().contracts.active,null);assert.equal(ui.modal.cancelContractId,undefined);
  const replacement=contractQuote(game,ui,'cinema');assert.notEqual(replacement.id,active.id);assert.ok(act(game,ui,'contractAccept:cinema:'+replacement.id).ok);
  act(game,ui,'order');assert.equal(unchanged(game,()=>act(game,ui,cancel)),null);
  assert.equal(unchanged(game,()=>act(game,ui,cancel)).reason,'stale-contract');assert.equal(game.getView().contracts.active.id,replacement.id);
});

test('modules, production and pressure actions stay on their own surfaces and are blocked during startup or rewards', () => {
  const {game,ui}=fixture();
  assert.equal(unchanged(game,()=>act(game,ui,'pressureMode:hold')),null);
  act(game,ui,'modules');assert.ok(act(game,ui,'pressureMode:hold').ok);
  game.state.energy=99;game.tick(1);
  for(const action of ['tap','releasePressure'])assert.equal(unchanged(game,()=>act(game,ui,action)),null);
  act(game,ui,'close');assert.ok(act(game,ui,'releasePressure').ok);
  const quote=contractQuote(game,ui);
  for(const flag of ['startup','adBusy']){
    ui[flag]=true;const prior=structuredClone(ui);
    for(const action of ['pressureMode:hold','tap','contractAccept:cinema:'+quote.id,'contractCancel:unknown'])assert.equal(unchanged(game,()=>act(game,ui,action)),null);
    assert.deepEqual(ui,prior);ui[flag]=false;
  }
  assert.ok(act(game,ui,'contractAccept:cinema:'+quote.id).ok);act(game,ui,'modules');
  const owned=game.getView().factory.owned;
  assert.ok(act(game,ui,'pressureMode:auto').ok);assert.deepEqual(game.getView().factory.owned,owned);
});
test('navigation clears upgrade focus and keeps chapter/page actions in their matching panel', () => {
  const { game, ui } = fixture();
  act(game, ui, 'quests');
  assert.equal(ui.modal.chapterId, game.getView().quests.activeChapterId);
  act(game, ui, 'questPage:1'); assert.equal(ui.modal.page, 1);
  act(game, ui, 'blueprintPage:2'); assert.equal(ui.modal.page, 1);
  const chapter = game.getView().quests.chapters[0].id;
  act(game, ui, 'questChapter:' + chapter); assert.equal(ui.modal.page, 0);
  act(game, ui, 'questChapter:missing'); assert.equal(ui.modal.chapterId, chapter);
  ui.focusUpgrade = 'auto'; act(game, ui, 'machine'); assert.equal(ui.focusUpgrade, '');
  act(game, ui, 'blueprint'); act(game, ui, 'blueprintPage:2'); assert.equal(ui.modal.page, 2);
  act(game, ui, 'questPage:3'); assert.equal(ui.modal.page, 2);
});

test('shared QA actions have no DOM, platform or storage dependency and reject external operations', () => {
  const exports = {}, sandbox = { module: { exports }, require(name) {
    assert.ok(['../src/core.js', '../src/experience.js', '../src/next-step.js'].includes(name));
    return require(name);
  } };
  for (const name of ['window', 'document', 'localStorage', 'fetch', 'tt']) {
    Object.defineProperty(sandbox, name, { get() { throw new Error('Unexpected host access: ' + name); } });
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../tools/qa-actions.cjs'), 'utf8'), sandbox);
  const { game, ui } = fixture();
  for (const action of ['ad:order', 'simulate:order', 'watch', 'visitSidebar', 'save', 'reset', 'tab:machines', 'timing', 'heatLesson', 'practiceHeat', 'skipHeatLesson']) {
    const beforeUI = structuredClone(ui);
    assert.equal(unchanged(game, () => sandbox.module.exports.dispatchQAAction(game, ui, action)).ok, false);
    assert.deepEqual(ui, beforeUI);
  }
  sandbox.module.exports.dispatchQAAction(game, ui, 'machine');
  assert.equal(ui.modal.type, 'machine');
});
