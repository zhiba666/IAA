'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG, formatNumber } = require('../src/core');
const { Renderer } = require('../src/renderer');
const { ProductionScene } = require('../src/production-scene');
const { ProductionInsights } = require('../src/production-insights');
const { canvasHarness, deepFreeze } = require('./canvas-harness.cjs');

const { describeOffer } = require('../src/purchase-quotes');

function realStages() {
  const game = new Game({ now: 1800000000000 }), result = [], insights = new ProductionInsights();
  for (let i = 0; i < 3000; i++) {
    for (const id of CONFIG.stationIds) while (game.getView().stations.find(s => s.id === id).upgrade?.available) game.buyUpgrade(id);
    const view = game.getView();
    const availableForStage = view.stations.some(s => s.upgrade && s.upgrade.requiredMachine <= view.state.machine);
    if (!availableForStage && !result[view.state.machine]) result[view.state.machine] = deepFreeze(insights.enrich(view));
    if (result.filter(Boolean).length === 6) return result;
    if (view.expansion?.ready) game.evolve();
    game.tick(10);
  }
  assert.fail('all six configured expansion stages must be reachable');
}
const stages = realStages();
// Every viewport is the full host canvas; safe areas are insets, not a shorter canvas.
const VIEWPORTS=[[320,524,false],[360,640,false],[390,844,false],[430,932,false],[320,524,true],[390,844,true]];
function ui(view,width=320,height=524,modal=null,native=false,options={}){
 const station=modal&&modal.type==='station'&&view.stations.find(s=>s.id===modal.stationId);
 const offer=station&&describeOffer(view,'upgrade-'+station.id);
 const quote=offer?{...offer,id:'1',action:'purchase:1',fingerprint:JSON.stringify(offer)}:null;
 return {viewport:{width,height,safeTop:native?28:0,safeBottom:native?40:0,menuBottom:native?70:0},
  modal,toast:'',toastSeconds:0,isDouyin:native,newFactory:false,quote,quotes:quote?{upgrade:quote}:{},rateUpdatingUntil:0,...options};
}
function backdrop(zone,viewport){return zone.action==='modal-body'||zone.action==='close'&&zone.x===0&&zone.y===0&&zone.w===viewport.width&&zone.h===viewport.height;}
function verifyZones(renderer,viewport){
 for(const zone of renderer.zones.filter(z=>z.action&&z.action!=='noop')){
  assert.ok(zone.x>=0&&zone.y>=0&&zone.x+zone.w<=viewport.width+1e-8&&zone.y+zone.h<=viewport.height+1e-8,'target stays on screen: '+zone.action);
  if(backdrop(zone,viewport))continue;
  assert.ok(zone.w>=44&&zone.h>=(zone.action==='openStats'?24:44),'visible control target: '+zone.action);
  assert.equal(renderer.actionAt(zone.x+zone.w/2,zone.y+zone.h/2),zone.action,'visible control owns center: '+zone.action);
 }
}
function verifyTextBounds(canvas,viewport){
 for(const entry of canvas.texts){
  const size=Number((entry.font.match(/([\d.]+)px/)||[0,14])[1]),inset=entry.align==='center'?entry.width/2:entry.align==='right'?entry.width:0;
  let left=entry.x-inset,right=left+entry.width,top=entry.y-size/2,bottom=entry.y+size/2;
  if(entry.clip){
   assert.ok(entry.width<=entry.clip.w+1,'scroll text wraps within its own content width: '+entry.text);
   left=Math.max(left,entry.clip.x);right=Math.min(right,entry.clip.x+entry.clip.w);
   top=Math.max(top,entry.clip.y);bottom=Math.min(bottom,entry.clip.y+entry.clip.h);if(bottom<top||right<left)continue;
  }
  assert.ok(left>=-1&&right<=viewport.width+1,'visible text fits width: '+entry.text);
  assert.ok(top>=-1&&bottom<=viewport.height+1,'visible text fits height: '+entry.text);
 }
}
function verifyVisibleProduction(renderer,modal){
 const scene=renderer.scene,viewport=renderer.interface.layout.scene,bounds=scene.contentFrame;
 assert.equal(scene.stationFrames.length,3);assert.equal(scene.bufferFrames.length,2);
 assert.equal(renderer.interface.layout.dock,undefined);assert.equal(viewport.x,0);assert.equal(viewport.y,0);
 for(const f of scene.stationFrames.concat(scene.bufferFrames))assert.ok(f.x>=bounds.x-1e-6&&f.y>=bounds.y-1e-6&&f.x+f.w<=bounds.x+bounds.w+1e-6&&f.y+f.h<=bounds.y+bounds.h+1e-6,'world entity inside HUD reservation: '+f.id);
 for(const f of scene.stationFrames){
  if(!modal)assert.equal(renderer.actionAt(f.x+f.w/2,f.y+f.h/2),'station:'+f.id);
  else assert.ok(!renderer.zones.some(z=>z.action==='station:'+f.id),'modal blocks background machine');
 }
}
function renderFrozen(view,state){
 const canvas=canvasHarness(),renderer=new Renderer(canvas.ctx),paint=canvas.ctx.fillText.bind(canvas.ctx);
 canvas.ctx.fillText=(...args)=>{paint(...args);const clip=renderer.interface.contentClip;if(clip)canvas.texts[canvas.texts.length-1].clip={...clip};};
 const expectedView=JSON.stringify(view),expectedUi=JSON.stringify(state);deepFreeze(view);deepFreeze(state);
 for(let i=0;i<3;i++)renderer.draw(view,state,.1);
 assert.equal(JSON.stringify(view),expectedView);assert.equal(JSON.stringify(state),expectedUi);assert.equal(canvas.depth(),0);
 verifyZones(renderer,state.viewport);verifyTextBounds(canvas,state.viewport);return{canvas,renderer};
}
const allText=canvas=>canvas.texts.map(row=>row.text).join('\n');

test('all six real stages keep machines, actual stock and compact operating priorities in a full browser or native canvas',()=>{
 for(const view of stages)for(const [width,height,native]of VIEWPORTS){
  const state=ui(view,width,height,null,native),{canvas,renderer}=renderFrozen(view,state);verifyVisibleProduction(renderer,null);
  assert.deepEqual(renderer.interface.layout.scene,{x:0,y:0,w:width,h:height});
  for(const action of ['start','tap','order','modules','quests','brand','ad:turbo','offline'])assert.ok(!renderer.zones.some(z=>z.action===action));
  for(const text of ['爆锅','装杯','出货','待装','待发'])assert.ok(allText(canvas).includes(text));
  assert.ok(canvas.texts.some(row=>/^出货 .+ 份\/秒$/.test(row.text)),'HUD uses actual shipment units');
  assert.ok(!/能力|份\/批|头并行|10秒|开放：|旧存档|玩法已重构/.test(allText(canvas)),'details stay in their on-demand windows');
  assert.ok(canvas.texts.some(row=>row.text===renderer.interface.currentStatus(view,state).text));
  const details=renderFrozen(view,ui(view,width,height,{type:'stats'},native));
  assert.ok(allText(details.canvas).includes('实测')&&allText(details.canvas).includes('份/秒'));
  if(view.expansion){const exp=renderFrozen(view,ui(view,width,height,{type:'expansion'},native));const model=exp.renderer.interface.modalModel(view,ui(view,width,height,{type:'expansion'},native));
   assert.ok(model.rows.some(row=>row.value==='设备另购，扩建不会立即提速'));
   assert.ok(model.rows.some(row=>row.value.startsWith('开放：')));}
 }
});
test('centered station modals preserve every machine and inventory while exposing only deliberate quote confirmation',()=>{
 const game=new Game();game.tick(100);const views=[new ProductionInsights().enrich(game.getView()),...stages];
 for(const view of views)for(const [width,height,native]of VIEWPORTS){
  const home=renderFrozen(view,ui(view,width,height,null,native)),geometry=JSON.stringify(home.renderer.scene.stationFrames);
  for(const stationId of CONFIG.stationIds){
   const state=ui(view,width,height,{type:'station',stationId},native),{canvas,renderer}=renderFrozen(view,state),station=view.stations.find(s=>s.id===stationId);
   verifyVisibleProduction(renderer,state.modal);assert.equal(JSON.stringify(renderer.scene.stationFrames),geometry);
   assert.ok(allText(canvas).includes(station.name+' · 升级'));
   const actions=renderer.zones.map(z=>z.action);assert.ok(actions.includes('close'));assert.ok(actions.includes('modal-body'));
   assert.ok(!actions.some(action=>/^station:|upgrade:|collapseStation|toggleDetails|reviewUpgrade/.test(action)));
   assert.deepEqual(actions.filter(action=>action.startsWith('purchase:')),station.upgrade&&station.upgrade.available?['purchase:1']:[]);
   const m=renderer.interface.layout.modal;assert.ok(m.y>renderer.interface.top);assert.ok(m.y+m.h<height-(state.viewport.safeBottom||0));
  }
 }
});
test('upgrade comparison separates equipment rate and conditional line forecast and keeps the confirmation footer fixed',()=>{
 const game=new Game();game.tick(100);const view=new ProductionInsights().enrich(game.getView());
 for(const [width,height,native]of VIEWPORTS){
  const positions=[];
  for(const stationId of CONFIG.stationIds){
   const state=ui(view,width,height,{type:'station',stationId},native),{canvas,renderer}=renderFrozen(view,state);
   const station=view.stations.find(s=>s.id===stationId),buy=renderer.zones.find(z=>z.action==='purchase:1');
   assert.ok(buy);positions.push([buy.x,buy.y,buy.w,buy.h]);
   const model=renderer.interface.modalModel(view,state),text=model.rows.map(row=>row.value).join('\n');
   assert.ok(text.includes('处理速度'));assert.ok(text.includes('份/秒'));assert.ok(text.includes('价格 '+formatNumber(station.upgrade.cost)+' 金币'));
   if(station.upgrade.lineImproves)assert.ok(text.includes('预计出货 '+station.upgrade.lineBefore+' → '+station.upgrade.lineAfter+' 份/秒'));
   else assert.ok(/当前受.*限制|暂不提高整线出货/.test(text));
   if(stationId==='cup'){assert.ok(text.includes('2 → 6 份/秒'));assert.ok(text.includes('2 → 4 份/秒'));}
  }
  assert.deepEqual(positions[1],positions[0]);assert.deepEqual(positions[2],positions[0]);
 }
});
test('asset failure and pending state have their own status without replacing the coin tile or settings control',()=>{
 const view=new ProductionInsights().enrich(new Game().getView());
 for(const [width,height,native]of VIEWPORTS){
  const canvas=canvasHarness(),renderer=new Renderer(canvas.ctx),state=ui(view,width,height,null,native,{toast:'其他生产提示'});
  let report={requested:87,failed:3,pending:0,loaded:84};renderer.art={get:()=>null,report:()=>report};renderer.draw(view,state,0);
  assert.ok(allText(canvas).includes('美术失败'));assert.equal(renderer.interface.artReport().failed,3);
  const retry=renderer.zones.find(z=>z.action==='retry-art'),coin=renderer.interface.layout.hud.coin;assert.ok(retry);
  assert.ok(retry.y>coin.y+coin.h);assert.ok(renderer.zones.some(z=>z.action==='settings'));verifyZones(renderer,state.viewport);verifyTextBounds(canvas,state.viewport);
  report={requested:87,failed:0,pending:1,loaded:86};canvas.clear();renderer.draw(view,{...state,toast:''},0);assert.ok(allText(canvas).includes('美术加载中'));
  report={requested:87,failed:0,pending:0,loaded:87};canvas.clear();renderer.draw(view,{...state,toast:''},0);assert.ok(!allText(canvas).includes('美术加载中'));
 }
});
test('identical browser and native safe areas produce identical overlays and unclipped modal controls',()=>{
 const game=new Game();game.tick(100);const view=new ProductionInsights().enrich(game.getView());
 const native=ui(view,320,524,{type:'station',stationId:'cup'},true),browser={...native,isDouyin:false};
 const a=renderFrozen(view,native),b=renderFrozen(view,browser);assert.deepEqual(a.renderer.interface.layout,b.renderer.interface.layout);assert.deepEqual(a.renderer.zones,b.renderer.zones);
});
test('unavailable purchases retain concrete funds, required generation and maximum-level reasons',()=>{
 const fresh=new ProductionInsights().enrich(new Game().getView());
 for(const [view,stationId,reason]of [[fresh,'cup','还差 30 金币'],[stages[0],'cup','需第 2 代'],[stages[5],'cup','已满级']]){
  const state=ui(view,320,524,{type:'station',stationId},true),{renderer,canvas}=renderFrozen(view,state);
  assert.ok(allText(canvas).includes(reason),reason);assert.ok(!renderer.zones.some(z=>z.action.startsWith('purchase:')));
 }
});
test('settings and restart retain accurate save scope while every visible control clears the capsule and bottom safe area',()=>{
 const view=new ProductionInsights().enrich(new Game().getView());
 for(const [width,height,native]of VIEWPORTS)for(const modal of [null,{type:'settings'},{type:'restart'}]){
  const state=ui(view,width,height,modal,native),{canvas,renderer}=renderFrozen(view,state);verifyVisibleProduction(renderer,modal);
  if(modal&&modal.type==='settings'){for(const action of ['close','setting:sound','setting:haptics','restart'])assert.ok(renderer.zones.some(z=>z.action===action));
   const model=renderer.interface.modalModel(view,state);assert.ok(model.rows.some(row=>row.value.includes('旧存档备份仍会保留')));}
  if(modal&&modal.type==='restart')assert.ok(renderer.zones.some(z=>z.action==='confirmRestart'));
  if(native)for(const zone of renderer.zones.filter(z=>!backdrop(z,state.viewport)))assert.ok(zone.y>=78&&zone.y+zone.h<=height-40);
 }
});

test('each stock bin shows real physical goods even at the smallest scene height and visibly fills from empty to full', () => {
  for (const index of [0,1]) for (const capacity of [12,384]) {
    const canvas = canvasHarness(), scene = new ProductionScene(canvas.ctx), counts = [], fillWidths = [];
    const baseBox = scene.box.bind(scene); let boxes = [], goods = 0;
    scene.box = (...args) => { boxes.push(args); baseBox(...args); };
    // Count tangible kernel/cup primitives rather than merely checking a display value.
    scene.popcorn = () => { goods++; }; scene.cup = () => { goods++; };
    for (const amount of [0,1,capacity/2,capacity]) {
      boxes=[]; goods=0;
      scene.drawBuffer({x:12,y:80,w:280,h:24},{id:index?'cup':'pop',amount,capacity},{},index);
      counts.push(goods);
      // A filled material region is drawn inside the tray before the front lip.
      const tray = boxes[0];
      const fill = boxes.find(rect => rect[0] === tray[0]+4 && rect[1] === tray[1]+4 && rect[3] === tray[3]-8);
      fillWidths.push(fill ? fill[2] : 0);
      assert.equal(canvas.depth(),0);
    }
    assert.equal(counts[0],0, 'empty stocks show no invented goods');
    assert.ok(counts[1]>0, 'one real portion retains a tangible item at 24px bin height');
    assert.ok(counts[2]>counts[1] && counts[3]>counts[2], 'visible goods become denser with genuine accumulation');
    assert.equal(fillWidths[0],0);
    assert.ok(fillWidths[1]>0 && fillWidths[3]>fillWidths[1], 'fill changes with actual occupied stock');
    assert.ok(Math.abs(fillWidths[2]/fillWidths[3]-.5)<1e-8, 'half full stock occupies half the material region');
    assert.ok(Math.abs(fillWidths[1]/fillWidths[3]-1/capacity)<1e-8, 'one portion uses its exact capacity fraction');
  }
});

test('shipment feedback batches actual event receipts, expires visually and never settles or drains production', () => {
  const game = new Game(); game.tick(10);
  const view = deepFreeze(new ProductionInsights().enrich(game.getView()));
  const before = game.exportSave(1800000000000), canvas = canvasHarness(), scene = new ProductionScene(canvas.ctx);
  for (let i=0;i<20;i++) scene.emit({type:'ship',amount:2,coins:2});
  scene.update(.01);
  scene.draw(8,80,304,220,view);
  assert.ok(canvas.texts.some(text => text.text === '+40 金'), 'twenty receipts become one actual summed income notice');
  const first = scene.delivery;
  scene.emit({type:'ship',amount:3,coins:3});
  scene.update(.1);
  assert.equal(scene.delivery,first, 'high frequency events do not restart departure animation');
  assert.equal(scene.delivery.amount,40);
  scene.update(.8); canvas.clear(); scene.draw(8,80,304,220,view);
  assert.ok(canvas.texts.some(text => text.text === '+3 金'), 'later receipts retain their own true total');
  scene.update(1); assert.equal(scene.delivery,null, 'departed visual does not remain as phantom inventory');
  assert.deepEqual(game.exportSave(1800000000000),before, 'visual receipt handling cannot add coins or clear stock');
  assert.equal(canvas.depth(),0);
});

test('upgrades retain their concrete installation name and later stages draw one pop machine with real working heads', () => {
  const canvas = canvasHarness(), scene = new ProductionScene(canvas.ctx);
  scene.emit({type:'upgrade',stationId:'cup',name:'快速装杯头'});
  assert.equal(scene.flash.name,'快速装杯头'); assert.equal(scene.flash.stationId,'cup');
  scene.update(.1); assert.ok(scene.flash.remaining>0);
  assert.ok(stages.slice(1).some(view => view.stations.some(station => station.lanes > 1)));
  assert.ok(stages.slice(1).some(view => view.stations.find(station => station.id === 'ship').batchSize > 1));
  const machine = scene.drawMachine.bind(scene); let chassis = 0, actualHeads = 0;
  scene.drawMachine = (stage,active,station) => { chassis++; actualHeads=station.lanes; machine(stage,active,station); };
  const pop = stages[5].stations.find(station => station.id === 'pop');
  scene.drawPop(12,12,150,54,pop,5);
  assert.equal(chassis,1, 'parallel production has one shared equipment housing');
  assert.equal(actualHeads,pop.lanes, 'actual purchased head count drives the machine artwork');
  assert.equal(canvas.depth(),0);
});

test('expansion alone never invents working heads; only purchased lane changes add real pop heads', () => {
  const canvas=canvasHarness(),scene=new ProductionScene(canvas.ctx),drawHead=scene.drawPopHead.bind(scene);
  let renderedHeads=[];
  scene.drawPopHead=(x,y,w,h,station,index)=>{renderedHeads.push({index,job:station.jobs[index]});drawHead(x,y,w,h,station,index);};
  function checkHeads(view){
    const station=view.stations.find(item=>item.id==='pop');renderedHeads=[];
    scene.drawPop(12,12,150,54,station,view.state.machine);
    assert.equal(renderedHeads.length,station.lanes,'each purchased work head has exactly one visible chamber');
    assert.deepEqual(renderedHeads.map(head=>head.index),Array.from({length:station.lanes},(_,i)=>i));
    for(const head of renderedHeads)assert.equal(head.job,station.jobs[head.index],'each head reads its own actual production job');
    return renderedHeads.length;
  }
  for(const seed of stages.slice(0,5)){
    const game=new Game({save:seed.state,now:0});
    for(let i=0;i<1000&&!game.getView().expansion?.canAfford;i++)game.tick(10);
    for(let i=0;i<1000&&!game.getView().expansion?.ready;i++)game.tick(10);
    const before=game.getView(),headsBefore=checkHeads(before);
    assert.equal(game.evolve().ok,true);
    const expanded=game.getView();
    assert.equal(checkHeads(expanded),headsBefore,'a bigger workshop keeps its existing purchased head count');
    const upgrade=expanded.stations.find(station=>station.id==='pop').upgrade;
    for(let i=0;i<1000&&game.state.coins<upgrade.cost;i++)game.tick(10);
    assert.equal(game.buyUpgrade('pop').ok,true);
    const upgraded=game.getView();
    assert.equal(checkHeads(upgraded),upgrade.lanes,'installation changes heads to the actual purchased lane count');
  }
  assert.equal(canvas.depth(),0);
});


test('small station windows retain all equipment/forecast units and explicitly mark expansion-dependent predictions',()=>{
 const game=new Game();game.tick(100);const views=[new ProductionInsights().enrich(game.getView()),...stages.slice(0,5)];
 for(const view of views)for(const stationId of CONFIG.stationIds){
  const station=view.stations.find(s=>s.id===stationId);if(!station.upgrade)continue;
  const state=ui(view,320,524,{type:'station',stationId},true),{renderer}=renderFrozen(view,state),model=renderer.interface.modalModel(view,state);
  const rows=model.rows.map(row=>row.value);assert.ok(rows.includes('处理速度'));assert.ok(rows.some(row=>row.endsWith('份/秒')&&row.includes(' → ')));
  if(station.upgrade.lineImproves)assert.ok(rows.some(row=>row.startsWith(station.upgrade.lineRequiresExpansion?'扩建后预计出货 ':'预计出货 ')&&row.endsWith('份/秒')));
  if(station.upgrade.lineRequiresExpansion)assert.match(model.footer.text,/需第 \d+ 代/);
 }
});
test('a zero-progress automatic trial exposes its current insufficient machine rather than an unexplained timer',()=>{
 const game=new Game({mode:'v15'});game.tick(10);const view=new ProductionInsights().enrich(game.getView());
 const blocked={...view,transfers:view.transfers.map(row=>({...row,automated:true})),automaticTrial:{...view.automaticTrial,elapsedSeconds:0,complete:false,targetRate:3}};
 const state=ui(blocked),{renderer,canvas}=renderFrozen(blocked,state);assert.equal(renderer.interface.currentStatus(blocked,state).text,'装杯不足 3 份/秒');assert.ok(allText(canvas).includes('装杯不足 3 份/秒'));
});
