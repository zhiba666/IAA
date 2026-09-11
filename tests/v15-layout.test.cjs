'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/core');
const { ProductionInsights } = require('../src/production-insights');
const { Renderer } = require('../src/renderer');
const { ART_ASSETS } = require('../src/art-manifest');
const { canvasHarness, deepFreeze } = require('./canvas-harness.cjs');

const viewports = [
  { width: 320, height: 524, safeTop: 0 },
  { width: 360, height: 640, safeTop: 0 },
  { width: 390, height: 844, safeTop: 0 },
  { width: 430, height: 932, safeTop: 0 },
  { width: 320, height: 524, safeTop: 24, safeBottom: 34, menuBottom: 75 },
  { width: 390, height: 844, safeTop: 28, safeBottom: 34, menuBottom: 70 }
];
const overlap = (a,b) => Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))
  * Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
function snapshot() {
  const game = new Game({ mode: 'v15', now: 1800000000000 });game.tick(10);
  return new ProductionInsights().enrich(game.getView());
}
function quotes(view,stationId='cup') {
  const out={};
  const add=(key,offer,extra={})=>{if(offer)out[key]={id:'q-'+key,action:'purchase:q-'+key,cost:offer.cost,name:offer.name||key,generation:view.state.machine,...extra};};
  const station=view.stations.find(s=>s.id===stationId);
  add('upgrade',station.upgrade,{stationId,level:station.level+1});
  for(const transfer of view.transfers)add('automate-'+transfer.source,transfer.automation,{source:transfer.source});
  add('logistics',view.logisticsUpgrade);add('expansion',view.expansion);return out;
}
function render(view,viewport,options={}) {
  const canvas=canvasHarness(); canvas.ctx.globalAlpha=1;
  const renderer=new Renderer(canvas.ctx,{get(id){assert.ok(ART_ASSETS[id],'real manifest asset '+id);return {id};},report:()=>({pending:0,failed:0})});
  const ui={viewport,modal:null,transfer:null,toast:'',rateUpdatingUntil:0,quotes:quotes(view),...options};
  const before=JSON.stringify({view,ui});deepFreeze(view);deepFreeze(ui);renderer.draw(view,ui,.1);
  assert.equal(JSON.stringify({view,ui}),before,'rendering cannot reserve, move, sell inventory, or replace a quote');
  assert.equal(canvas.depth(),0);
  for(const entry of canvas.texts) {
    const left=entry.x-(entry.align==='center'?entry.width/2:entry.align==='right'?entry.width:0);
    assert.ok(left>=-1&&left+entry.width<=viewport.width+1,'text fits: '+entry.text);
  }
  return {renderer,canvas};
}

test('physical bins and inputs remain separate above the bottom controls while centered modals preserve their coordinates',()=>{
  for(const viewport of viewports) {
    const view=snapshot(),home=render(view,viewport),layout=home.renderer.interface.layout,frames=home.renderer.scene.transferFrames;
    assert.deepEqual(layout.scene,{x:0,y:0,w:viewport.width,h:viewport.height});assert.equal(layout.dock,undefined);
    assert.equal(frames.length,4);
    for(const frame of frames) {
      assert.ok(frame.w>=64&&frame.h>=64);
      assert.ok(frame.x>=0&&frame.y>=viewport.safeTop&&frame.x+frame.w<=viewport.width&&frame.y+frame.h<=viewport.height-(viewport.safeBottom||0));
      for(const other of frames.filter(other=>other!==frame))assert.equal(overlap(frame,other),0,'one visible area has one route owner');
      for(const hud of Object.values(layout.hud))assert.equal(overlap(frame,hud),0,'cargo remains outside HUD '+frame.action);
      assert.equal(home.renderer.actionAt(frame.x+frame.w/2,frame.y+frame.h/2),frame.action);
    }
    for(const station of home.renderer.scene.stationFrames)assert.equal(home.renderer.actionAt(station.x+station.w/2,station.y+station.h/2),'station:'+station.id);
    assert.ok(!home.canvas.texts.some(t=>/先点|点选后|再点|首段搬运试玩|暂不开放扩建/.test(t.text)));
    for(const type of ['station','logistics','expansion']) {
      const opened=render(view,viewport,{modal:{type,stationId:'cup',scroll:0}});
      assert.deepEqual(opened.renderer.scene.transferFrames.map(f=>[f.x,f.y,f.w,f.h,f.action]),frames.map(f=>[f.x,f.y,f.w,f.h,f.action]));
      assert.deepEqual(opened.renderer.scene.stationFrames.map(f=>f.artRect),home.renderer.scene.stationFrames.map(f=>f.artRect));
      assert.ok(!opened.renderer.zones.some(z=>z.action.startsWith('transfer-')||z.action.startsWith('station:')));
    }
  }
});

test('only the carried route is legal, full inputs reject a drop, and cargo ghosts stay clear of the pointer',()=>{
  for(const source of ['pop','cup']) {
    const view=snapshot(),base=render(view,viewports[0]).renderer,target=source==='pop'?'cup':'ship';
    const input=base.scene.transferFrames.find(f=>f.kind==='input'&&f.target===target);
    const held={source,target,amount:4,x:input.x+input.w/2,y:input.y+input.h/2,dragging:true,overTarget:true};
    const ready=render(view,viewports[0],{transfer:held});
    assert.equal(ready.renderer.scene.diagnostics.transfers.find(t=>t.source.source===source).legal,true);
    assert.equal(ready.renderer.scene.diagnostics.transfers.find(t=>t.source.source!==source).legal,false);
    assert.equal(ready.renderer.transferGhost.source,source);assert.equal(ready.renderer.transferGhost.target,target);
    assert.ok(ready.renderer.transferGhost.y+ready.renderer.transferGhost.h<held.y||ready.renderer.transferGhost.y>held.y);
    const full={...view,transfers:view.transfers.map(t=>t.source===source?{...t,inputAmount:t.inputCapacity}:t)};
    const rejected=render(full,viewports[0],{transfer:held});
    assert.equal(rejected.renderer.scene.diagnostics.transfers.find(t=>t.source.source===source).legal,false);
    assert.ok(rejected.canvas.texts.some(t=>t.text==='入口已满'||t.text==='已满'));
  }
});

test('logistics purchases are confined to the centered modal and already automated rows cannot be repurchased',()=>{
  const original=snapshot(),view={...original,state:{...original.state,coins:10000},
    transfers:original.transfers.map(t=>({...t,automation:{...t.automation,available:true,reason:''}})),logisticsUpgrade:{...original.logisticsUpgrade,available:true,reason:''}};
  for(const viewport of viewports) {
    const result=render(view,viewport,{modal:{type:'logistics',scroll:0},quotes:quotes(view),transfer:{source:'cup',target:'ship',amount:4,x:210,y:380,dragging:true}});
    assert.equal(result.renderer.transferGhost,null);
    assert.ok(result.renderer.zones.every(z=>z.action==='close'||z.action==='modal-body'||z.action.startsWith('purchase:')));
    for(const z of result.renderer.zones.filter(z=>z.action.startsWith('purchase:'))){assert.ok(z.w>=44&&z.h>=44);assert.equal(result.renderer.actionAt(z.x+z.w/2,z.y+z.h/2),z.action);}
  }
  const automated={...view,transfers:view.transfers.map(t=>({...t,automated:true})),automaticTrial:{elapsedSeconds:60,requiredSeconds:60,complete:true}};
  const ready=render(automated,viewports[2],{modal:{type:'logistics'},quotes:quotes(automated)});
  assert.ok(ready.canvas.texts.some(t=>t.text==='已自动'));assert.ok(!ready.renderer.zones.some(z=>z.action.includes('automate-')));
  const home=render(automated,viewports[0]);assert.ok(!home.canvas.texts.some(t=>/未接通 · 手动|先点/.test(t.text)));
});

test('a visible collar resolves to the matching transfer action and cannot be mistaken for a machine upgrade',()=>{
  for(const viewport of viewports) {
    const view=snapshot(),result=render(view,viewport),frames=result.renderer.scene.transferFrames;
    assert.equal(frames.filter(f=>f.kind==='input').length,2);
    for(const source of ['pop','cup']) {
      const target=source==='pop'?'cup':'ship',input=frames.find(f=>f.kind==='input'&&f.source===source);
      const diagnostics=result.renderer.scene.diagnostics.transfers.find(t=>t.source.source===source);
      assert.ok(diagnostics.inputPoint[0]>=input.x&&diagnostics.inputPoint[0]<=input.x+input.w&&diagnostics.inputPoint[1]>=input.y&&diagnostics.inputPoint[1]<=input.y+input.h);
      assert.equal(result.renderer.actionAt(...diagnostics.inputPoint),'transfer-target-'+target);
      assert.ok(Number.isFinite(diagnostics.machineInputPoint[0]));
    }
  }
});

test('every migrated generation can paint cargo and retains accurate restart and save descriptions',()=>{
  const game=new Game({now:1800000000000}),seen=new Set();
  for(let step=0;step<3000&&seen.size<5;step++){
    for(const id of ['pop','cup','ship'])while(game.getView().stations.find(item=>item.id===id).upgrade?.available)game.buyUpgrade(id);
    if(game.state.machine>0&&!seen.has(game.state.machine)){
      seen.add(game.state.machine);
      const migrated=new Game({mode:'v15',save:game.exportSave(1800000000000)}),view=new ProductionInsights().enrich(migrated.getView());
      assert.equal(migrated.state.machine,game.state.machine);assert.ok(view.transfers.every(t=>t.automated));
      for(const source of ['pop','cup']){
        const {renderer}=render(view,viewports[2],{transfer:{source,target:source==='pop'?'cup':'ship',amount:4,x:210,y:430,dragging:true}});
        assert.equal(renderer.scene.artGeneration,view.state.machine);assert.equal(renderer.transferGhost.source,source);
      }
      const settings=render(view,viewports[3],{modal:{type:'settings'}}).canvas.texts.map(t=>t.text).join('');
      assert.ok(settings.includes('旧版工厂兼容迁移'));assert.ok(!settings.includes('不读取、不迁移'));
      const restart=render(view,viewports[0],{modal:{type:'restart'}}).canvas.texts.map(t=>t.text).join('');
      assert.ok(restart.includes('物流改造和生产进度'));assert.ok(restart.includes('旧版原档备份仍会保留'));
    }
    if(game.getView().expansion?.ready)game.evolve();game.tick(10);game.drainEvents();
  }
  assert.equal(seen.size,5);
});
