'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Game}=require('../src/core');
const {describeOffer,quoteMatches}=require('../src/purchase-quotes');
const {harness}=require('./app-harness.cjs');
function rich(){
  const g=new Game({mode:'v15',now:0});
  for(let i=0;i<1600;i++){g.tick(.5);for(const source of ['pop','cup']){const r=g.reserveTransfer(source);if(r.ok)g.commitTransfer(r.token);}g.drainEvents();}
  return g;
}
const seed=rich().exportSave(0);
const boot=()=>harness({config:{mode:'v15'},save:seed});
function quoted(view,key){const offer=describeOffer(view,key);return {...offer,id:'1',action:'purchase:1',fingerprint:JSON.stringify(offer)};}

test('every quote binds its object, target tier, name, price and generation and rejects tampering',()=>{
  const g=new Game({mode:'v15',save:seed,now:0});
  for(const key of ['upgrade-pop','upgrade-cup','upgrade-ship','automate-pop','automate-cup','logistics','expansion']){
    const q=quoted(g.getView(),key);assert.equal(quoteMatches(q,g.getView()),true);
    for(const field of ['cost','level','generation','name']){
      const changed={...q,[field]:typeof q[field]==='number'?q[field]+1:String(q[field])+'changed'};
      assert.equal(quoteMatches(changed,g.getView()),false,key+' rejects changed '+field);
    }
    assert.equal(quoteMatches({...q,used:true},g.getView()),false);
    assert.equal(quoteMatches({...q,fingerprint:'{}'},g.getView()),false);
  }
  const q=quoted(g.getView(),'upgrade-cup');g.tick(1);
  assert.equal(quoteMatches(q,g.getView()),true,'natural income never changes the reviewed price');
  assert.equal(g.buyUpgrade('cup').ok,true);assert.equal(quoteMatches(q,g.getView()),false,'buying a tier invalidates its old quote');
});

test('A, B and logistics each require current modal quote, close once and preserve unrelated purchases',()=>{
  const h=boot();
  for(const key of ['automate-pop','automate-cup','logistics']){
    h.click('openLogistics');const q=h.ui().quotes[key],before=h.snapshot().state;
    h.click(key);assert.deepEqual(h.snapshot().state,before,'retired command is not a purchase alias');
    h.click(q.action);const after=h.snapshot().state;
    assert.equal(after.totalSpent-before.totalSpent,q.cost);assert.equal(before.coins-after.coins,q.cost);
    assert.equal(h.ui().modal,null);assert.deepEqual(h.ui().quotes,{});
    for(let i=0;i<5;i++)h.click(q.action);
    assert.deepEqual(h.snapshot().state,after,'same quote cannot buy twice');
    h.click('openLogistics');
    assert.ok(!Object.values(h.ui().quotes).some(row=>row.id===q.id));
    if(key.startsWith('automate-'))assert.equal(h.ui().quotes[key],undefined);
    h.click(q.action);assert.deepEqual(h.snapshot().state,after,'stale quote cannot purchase within a newly opened modal');h.click('close');
  }
  assert.ok(h.snapshot().transfers.every(row=>row.automated));assert.equal(h.snapshot().state.logisticsLevel,1);
});

test('expansion validates live conditions then consumes the exact reviewed generation once',()=>{
  const h=boot();h.click('openExpansion');const locked=h.ui().quotes.expansion;
  h.click(locked.action);assert.equal(h.snapshot().state.machine,0);assert.match(h.ui().modal.error,/自动/);h.click('close');
  h.click('station:cup');h.click(h.ui().quotes.upgrade.action);
  for(const key of ['automate-pop','automate-cup']){h.click('openLogistics');h.click(h.ui().quotes[key].action);}
  h.run(60);assert.equal(h.snapshot().automaticTrial.complete,true);assert.equal(h.snapshot().expansion.ready,true);
  h.click('openExpansion');const q=h.ui().quotes.expansion,before=h.snapshot().state;
  h.click(locked.action);assert.deepEqual(h.snapshot().state,before,'old quote ID cannot be reused after conditions change');
  h.click(q.action);const after=h.snapshot().state;
  assert.equal(after.machine,1);assert.equal(after.coins,before.coins-q.cost);assert.equal(after.totalSpent,before.totalSpent+q.cost);
  assert.ok(h.snapshot().transfers.every(row=>row.automated));assert.equal(h.ui().modal,null);
  h.click(q.action);h.click('openExpansion');h.click(q.action);
  assert.deepEqual(h.snapshot().state,after,'repeated expansion token never buys the next generation');
});

test('insufficient funds retain a visible reason and the same price can succeed after real income arrives',()=>{
  const g=new Game({now:0});const h=harness({config:{mode:'baseline'},save:g.exportSave(0)});
  h.click('station:cup');const q=h.ui().quotes.upgrade;h.click(q.action);
  assert.equal(h.ui().modal.type,'station');assert.match(h.ui().modal.error,/还差 30 金币/);
  assert.equal(h.snapshot().state.upgrades.cup,0);h.run(30);
  assert.equal(h.ui().quotes.upgrade.id,q.id);h.click(q.action);
  assert.equal(h.snapshot().state.upgrades.cup,1);assert.equal(h.ui().modal,null);
});
