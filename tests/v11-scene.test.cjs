'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {Game}=require('../src/core'),{ProductionInsights}=require('../src/production-insights'),{Renderer}=require('../src/renderer');
const {ART_ASSETS}=require('../src/art-manifest'),{canvasHarness,deepFreeze}=require('./canvas-harness.cjs');
const fixtures=import(pathToFileURL(path.resolve(__dirname,'../tools/six-gen-acceptance.mjs')).href).then(m=>m.createSixGenerationFixtures());
const viewports=[{width:320,height:524,safeTop:24,safeBottom:16},{width:360,height:640,safeTop:0},
 {width:390,height:844,safeTop:44,safeBottom:34},{width:430,height:932,safeTop:0}];
const copy=x=>JSON.parse(JSON.stringify(x));
const inside=(f,b)=>f.x>=b.x-1e-6&&f.y>=b.y-1e-6&&f.x+f.w<=b.x+b.w+1e-6&&f.y+f.h<=b.y+b.h+1e-6;
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
function create(){const canvas=canvasHarness(),draws=[];canvas.ctx.globalAlpha=1;canvas.ctx.drawImage=(image,...args)=>draws.push({id:image.id,args});
 const r=new Renderer(canvas.ctx,{get(id){assert.ok(ART_ASSETS[id],id);return{id};},report:()=>({pending:0,failed:0})});return{r,canvas,draws};}
function paint(r,view,viewport,extra={}){const ui=deepFreeze({viewport,modal:null,...extra}),before=JSON.stringify(view);r.draw(deepFreeze(view),ui,0);assert.equal(JSON.stringify(view),before);return ui;}
test('six generations at four viewports keep all four drag objects reachable and all modal states leave their coordinates unchanged',async()=>{
 const data=await fixtures;
 for(const item of data.cases.filter(row=>['entry','upgraded'].includes(row.configuration)))for(const viewport of viewports){
  const {r,canvas}=create(),view=new ProductionInsights().enrich(copy(item.snapshot));
  paint(r,view,viewport);const stable=copy({machines:r.scene.stationFrames,bins:r.scene.bufferFrames,frames:r.scene.transferFrames});
  assert.equal(stable.frames.length,4);
  for(const frame of stable.frames){assert.ok(frame.w>=64&&frame.h>=64);assert.ok(inside(frame,r.scene.contentFrame));
   for(const blocker of r.scene.stationFrames.concat(r.interface.layout.overlayLayout.exclusionRects))assert.equal(overlap(frame,blocker),0,item.id);}
  for(const modal of [{type:'station',stationId:'cup'},{type:'logistics'},{type:'expansion'},null]){
   paint(r,view,viewport,{modal});assert.deepEqual({machines:r.scene.stationFrames,bins:r.scene.bufferFrames,frames:r.scene.transferFrames},stable);
  }
  assert.equal(canvas.depth(),0);
 }
});
test('one hit function controls route highlight, final receiver and tolerance while excluding HUD, source bins and machine clicks',async()=>{
 const data=await fixtures,view=new ProductionInsights().enrich(copy(data.cases.find(row=>row.id==='g1-first-tray').snapshot));
 for(const viewport of viewports){const {r}=create();paint(r,view,viewport);
  for(const source of ['pop','cup']){
   const target=copy(r.scene.transferFrames.find(f=>f.kind==='input'&&f.source===source));
   for(const [dx,dy,expected]of [[32,32,true],[1,1,true],[63,63,true],[-10,32,true],[-13,32,false]]){
    const x=target.x+dx,y=target.y+dy,held={source,target:target.target,amount:4,x,y,dragging:true,overTarget:!expected};
    paint(r,view,viewport,{transfer:held});const hit=r.transferTargetAt(x,y,source),diag=r.scene.diagnostics.transfers.find(row=>row.source.source===source);
    assert.equal(!!hit,expected);assert.equal(diag.overTarget,expected);assert.equal(r.transferGhost.ready,expected);
    assert.equal(r.transferTargetAt(x,y,source==='pop'?'cup':'pop'),null);
   }
   for(const blocker of r.scene.stationFrames.concat(r.scene.transferFrames.filter(f=>f.kind==='tray'),r.interface.layout.overlayLayout.exclusionRects))
    assert.equal(r.transferTargetAt(blocker.x+blocker.w/2,blocker.y+blocker.h/2,source),null);
   const full={...view,transfers:view.transfers.map(row=>row.source===source?{...row,inputAmount:row.inputCapacity}:row)};
   paint(r,full,viewport);assert.equal(r.transferTargetAt(target.x+32,target.y+32,source),null);
   paint(r,view,viewport,{modal:{type:'logistics'}});assert.equal(r.transferTargetAt(target.x+32,target.y+32,source),null);
   paint(r,view,viewport);
  }
 }
});
test('drop receipts, the tutorial hand and a trial warning are pure local feedback and cancellation returns in 200 milliseconds',()=>{
 const game=new Game({mode:'v15',now:1800000000000});game.tick(10);
 const view=new ProductionInsights().enrich(game.getView()),before=game.exportSave(1800000000000),viewport=viewports[0],{r,canvas}=create();
 paint(r,view,viewport);const source=r.transferPoint('pop','tray'),target=r.transferPoint('pop','input');
 const feedback={kind:'invalid',source:'pop',target:'cup',amount:4,x:200,y:290,sourceX:source.x,sourceY:source.y,age:.3,duration:1.2,reason:'放错入口'};
 paint(r,view,viewport,{transferFeedback:feedback});assert.equal(r.transferReceipt.progress,1);assert.equal(r.transferReceipt.x,source.x);assert.equal(r.transferReceipt.y,source.y);
 assert.ok(canvas.texts.some(row=>row.text==='放错入口'));
 paint(r,view,viewport,{tutorial:{source:'pop',target:'cup',progress:.5}});assert.ok(r.tutorialHand);
 assert.ok(r.tutorialHand.x>Math.min(source.x,target.x)&&r.tutorialHand.x<Math.max(source.x,target.x));
 paint(r,view,viewport,{transfer:{source:'pop',target:'cup',amount:4,x:target.x,y:target.y,dragging:true,trialHint:'投送将重计试运行'}});
 assert.ok(canvas.texts.some(row=>row.text==='投送将重计试运行'));
 const beforeModal=copy(r.scene.transferFrames);paint(r,view,viewport,{modal:{type:'settings'},transferFeedback:feedback,tutorial:{source:'pop',progress:.5}});
 assert.equal(r.transferReceipt,null);assert.equal(r.tutorialHand,null);assert.deepEqual(r.scene.transferFrames,beforeModal);
 assert.deepEqual(game.exportSave(1800000000000),before);
});
test('v1.1 background resources cover the canvas and the wall retains its authored proportion',()=>{
 const {r,draws}=create(),view=new ProductionInsights().enrich(new Game({mode:'v15'}).getView());
 assert.ok(ART_ASSETS.factory_floor_extension&&ART_ASSETS.factory_wall_corner&&ART_ASSETS.ui_gesture_hand,'new asset manifest must be generated before integration checks');
 paint(r,view,viewports[2]);const floor=draws.find(row=>row.id==='factory_floor_extension'),wall=draws.find(row=>row.id==='factory_wall_corner');
 assert.ok(floor&&wall);const dest=floor.args.slice(-4);assert.ok(dest[0]<=0&&dest[1]<=0&&dest[0]+dest[2]>=390&&dest[1]+dest[3]>=844);
 const wr=wall.args.slice(-4);assert.equal(wr[0],0);assert.equal(wr[1],0);assert.equal(wr[2],390);
 assert.ok(Math.abs(wr[3]/wr[2]-214/512)<1e-6);
});
