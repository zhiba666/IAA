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
  { width: 390, height: 844, safeTop: 0 },
  { width: 320, height: 484, safeTop: 75 },
  { width: 390, height: 804, safeTop: 28, menuBottom: 70 }
];
const overlap = (a,b) => Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))
  * Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
function snapshot() {
  const game = new Game({ mode: 'v15', now: 1800000000000 });
  game.tick(10);
  return new ProductionInsights().enrich(game.getView());
}
function render(view,viewport,options={}) {
  const canvas=canvasHarness(); canvas.ctx.globalAlpha=1;
  const renderer=new Renderer(canvas.ctx,{get(id){assert.ok(ART_ASSETS[id]);return {id};},report:()=>({pending:0,failed:0})});
  const ui={viewport,modal:null,transfer:null,stationCollapsed:false,stationDetails:false,toast:'',rateUpdatingUntil:0,...options};
  const before=JSON.stringify({view,ui});
  deepFreeze(view);deepFreeze(ui);renderer.draw(view,ui,.1);
  assert.equal(JSON.stringify({view,ui}),before,'rendering cannot reserve, move, or sell inventory');
  assert.equal(canvas.depth(),0);
  for(const entry of canvas.texts){
    const left=entry.x-(entry.align==='center'?entry.width/2:entry.align==='right'?entry.width:0);
    assert.ok(left>=-1&&left+entry.width<=viewport.width+1,'text fits: '+entry.text);
  }
  return {renderer,canvas};
}

test('both v15 transfer rows remain separate, touchable and above every expanded machine panel',()=>{
  for(const viewport of viewports)for(const stationId of [null,'pop','cup','ship']){
    const {renderer,canvas}=render(snapshot(),viewport,{modal:stationId?{type:'station',stationId}:null});
    const transfers=renderer.scene.transferFrames;
    assert.equal(transfers.length,4);
    for(const zone of transfers){
      assert.ok(zone.w>=56&&zone.h>=56);
      assert.ok(zone.x>=0&&zone.y>=viewport.safeTop&&zone.x+zone.w<=viewport.width&&zone.y+zone.h<=renderer.interface.layout.dock.y);
      for(const [dx,dy] of [[1,1],[zone.w-1,1],[1,zone.h-1],[zone.w-1,zone.h-1],[zone.w/2,zone.h/2]])
        assert.equal(renderer.actionAt(zone.x+dx,zone.y+dy),zone.action,'visible transfer areas cannot open a purchase panel');
      for(const other of renderer.zones.filter(item=>item.action!==zone.action))assert.equal(overlap(zone,other),0,'distinct input ownership: '+zone.action+' / '+other.action);
    }
    for(const station of renderer.scene.stationFrames)
      assert.equal(renderer.actionAt(station.x+station.w/2,station.y+station.h/2),'station:'+station.id,'all three machines remain directly selectable');
    assert.ok(canvas.texts.some(item=>item.text.startsWith('装杯入口 ')));
    assert.ok(canvas.texts.some(item=>item.text.startsWith('出货入口 ')));
    assert.ok(!canvas.texts.some(item=>item.text.includes('首段搬运试玩')||item.text.includes('暂不开放扩建')));
    if(!stationId)assert.ok(renderer.zones.some(item=>item.action==='openLogistics'));
  }
});

test('only the held route highlights, full inputs reject the visual drop, and finished cups use their own ghost',()=>{
  const view=snapshot(),held={source:'cup',target:'ship',amount:4,x:210,y:380,dragging:true,overTarget:true};
  const ready=render(view,viewports[0],{transfer:held});
  assert.equal(ready.renderer.scene.diagnostics.transfers[0].legal,false);
  assert.equal(ready.renderer.scene.diagnostics.transfers[1].legal,true);
  assert.equal(ready.renderer.transferGhost.source,'cup');
  assert.equal(ready.renderer.transferGhost.target,'ship');
  assert.ok(ready.renderer.transferGhost.y+ready.renderer.transferGhost.h<held.y);
  const full={...view,transfers:view.transfers.map(item=>item.source==='cup'?{...item,inputAmount:item.inputCapacity}:item)};
  const rejected=render(full,viewports[0],{transfer:held});
  assert.equal(rejected.renderer.scene.diagnostics.transfers[1].legal,false);
  assert.ok(rejected.canvas.texts.some(item=>item.text==='入口已满'));
});

test('automation and batch purchases occupy their own sheet and never require manual collection after takeover',()=>{
  const original=snapshot();
  const ready={...original,transfers:original.transfers.map(item=>({...item,automation:{...item.automation,available:true}})),
    logisticsUpgrade:{...original.logisticsUpgrade,available:true}};
  for(const viewport of viewports){
    const {renderer,canvas}=render(ready,viewport,{modal:{type:'logistics'},transfer:{source:'cup',target:'ship',amount:4,x:210,y:380,dragging:true}});
    assert.equal(renderer.transferGhost,null);
    assert.deepEqual(renderer.zones.map(item=>item.action).sort(),['automate-cup','automate-pop','close','upgrade-logistics'].sort());
    for(const zone of renderer.zones){
      assert.ok(zone.w>=44&&zone.h>=44&&zone.y>=renderer.interface.top&&zone.y+zone.h<=viewport.height);
      assert.equal(renderer.actionAt(zone.x+zone.w/2,zone.y+zone.h/2),zone.action);
    }
    assert.ok(canvas.texts.some(item=>item.text.includes('不提升加工速度')));
    assert.ok(canvas.texts.some(item=>item.text.includes('减少补料频率')));
  }
  const automated={...ready,transfers:ready.transfers.map(item=>({...item,automated:true})),automaticTrial:{elapsedSeconds:60,requiredSeconds:60,complete:true}};
  const home=render(automated,viewports[0]);
  assert.ok(home.canvas.texts.some(item=>item.text==='已接通 · 无需手动'));
  assert.ok(home.canvas.texts.some(item=>item.text.startsWith('下一目标 · 扩建')));
  assert.ok(!home.canvas.texts.some(item=>item.text==='未接通 · 手动送入'));
});

test('dragging activates only its matching physical machine inlet and releases it for ordinary station taps',()=>{
  for(const viewport of viewports)for(const source of ['pop','cup'])for(const stationId of [null,'cup']){
    const target=source==='pop'?'cup':'ship',view=snapshot();
    const modal=stationId?{type:'station',stationId}:null;
    const transfer={source,target,amount:4,x:210,y:380,dragging:true,overTarget:false};
    const {renderer}=render(view,viewport,{modal,transfer});
    const ports=renderer.scene.transferFrames.filter(frame=>frame.kind==='port');
    assert.equal(ports.length,1);
    assert.equal(ports[0].source,source);
    assert.equal(ports[0].target,target);
    assert.ok(ports[0].w>=56&&ports[0].h>=56);
    const actual=renderer.scene.diagnostics.machines.find(item=>item.stationId===target).ports.input;
    assert.equal(renderer.actionAt(...actual),'transfer-target-'+target,'the visible machine inlet accepts the held route');
    assert.ok(ports[0].y>=viewport.safeTop&&ports[0].y+ports[0].h<=renderer.interface.layout.dock.y);
    const released=render(view,viewport,{modal,transfer:null}).renderer;
    assert.equal(released.scene.transferFrames.filter(frame=>frame.kind==='port').length,0);
    for(const station of released.scene.stationFrames)
      assert.equal(released.actionAt(station.x+station.w/2,station.y+station.h/2),'station:'+station.id);
  }
});

test('every migrated later generation can paint both cargo ghosts and accurately describes restart scope',()=>{
  const game=new Game({now:1800000000000}),seen=new Set();
  for(let step=0;step<3000&&seen.size<5;step++){
    for(const id of ['pop','cup','ship'])while(game.getView().stations.find(item=>item.id===id).upgrade?.available)game.buyUpgrade(id);
    if(game.state.machine>0&&!seen.has(game.state.machine)){
      seen.add(game.state.machine);
      const migrated=new Game({mode:'v15',save:game.exportSave(1800000000000)});
      assert.equal(migrated.state.machine,game.state.machine);
      const view=new ProductionInsights().enrich(migrated.getView());
      assert.ok(view.transfers.every(item=>item.automated));
      for(const source of ['pop','cup']){
        const {renderer}=render(view,viewports[0],{transfer:{source,target:source==='pop'?'cup':'ship',amount:4,x:210,y:380,dragging:true}});
        assert.equal(renderer.scene.artGeneration,null,'later generations use ProductionScene artwork');
        assert.equal(renderer.transferGhost.source,source,'both inherited cargo painters remain callable');
        assert.equal(renderer.scene.transferFrames.length,0,'automatic later stages need no manual collection targets');
      }
      const settings=render(view,viewports[2],{modal:{type:'settings'}}).canvas.texts.map(item=>item.text).join('');
      assert.ok(settings.includes('旧版工厂兼容迁移'));
      assert.ok(!settings.includes('不读取、不迁移')&&!settings.includes('从新工厂开始'));
      const restart=render(view,viewports[2],{modal:{type:'restart'}}).canvas.texts.map(item=>item.text).join('');
      assert.ok(restart.includes('物流改造和生产进度'));
      assert.ok(restart.includes('旧版原档备份仍会保留'));
    }
    if(game.getView().expansion?.ready)game.evolve();
    game.tick(10);game.drainEvents();
  }
  assert.equal(seen.size,5);
});
