'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Game}=require('../src/core');
const {selectNextStep}=require('../src/next-step');
function factory(overrides={}){
  const game=new Game({now:1000});Object.assign(game.state,{machine:4,orderIndex:16,totalProduced:220000000,coins:230e9,
    upgrades:{tap:24,auto:24,value:24}},overrides);return game;
}
test('craft advice uses only surplus after equipment funding is complete',()=>{
  const game=factory(),before=game.exportSave(1000),step=selectNextStep(game.getView(),null,{suppressModeAdvice:true});
  assert.equal(step.kind,'refinement');assert.equal(step.refinementKey,'yield');
  const option=game.getView().refinements.options.find(o=>o.key===step.refinementKey);
  assert.ok(game.buyRefinement(option.key,option).ok);assert.ok(game.state.coins>=game.getView().nextMachine.cost);
  assert.equal(before.refinements.yield,0);
  game.state.coins=game.getView().nextMachine.cost;
  assert.equal(selectNextStep(game.getView(),null,{suppressModeAdvice:true}).kind,'order');
});
test('funding compares ordinary upgrades and craft investments on the same permanent-income basis',()=>{
  const game=factory({orderIndex:18,totalProduced:720000000,coins:50e9,upgrades:{tap:24,auto:24,value:23}});
  const before=game.getView(),step=selectNextStep(before,null,{suppressModeAdvice:true});
  assert.equal(step.kind,'refinement');assert.equal(step.refinementKey,'value');
  const item=before.refinements.options.find(o=>o.key===step.refinementKey);
  game.buyRefinement(item.key,item);const after=game.getView();
  assert.ok(Math.abs(step.estimate.afterSeconds-(after.nextMachine.cost-after.state.coins)/after.production.baseIncome)<1e-6);
  assert.ok(step.estimate.afterSeconds<step.estimate.beforeSeconds);
});
