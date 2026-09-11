'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Game,CONFIG}=require('../src/core'),{Renderer}=require('../src/renderer'),{ProductionInsights}=require('../src/production-insights');
const {ART_ASSETS}=require('../src/art-manifest'),{canvasHarness,deepFreeze}=require('./canvas-harness.cjs');
function draw(view,extra={}){const canvas=canvasHarness();canvas.ctx.globalAlpha=1;const r=new Renderer(canvas.ctx,{get(id){assert.ok(ART_ASSETS[id]);return{id};},report:()=>({failed:0,pending:0})});
 const ui=deepFreeze({viewport:{width:320,height:524,safeTop:24},modal:null,...extra}),before=JSON.stringify(view);r.draw(deepFreeze(view),ui,0);
 assert.equal(JSON.stringify(view),before);assert.equal(canvas.depth(),0);return{r,canvas,ui};}
function snapshot(){const game=new Game({experiment:CONFIG.transferExperiment.id,now:1800000000000});game.tick(10);return new ProductionInsights().enrich(game.getView());}
test('archived first-leg mode uses physical full-scene source and input without a rail or tap-selection presentation',()=>{
 const {r,canvas}=draw(snapshot());assert.equal(r.scene.transferFrames.length,2);
 const source=r.scene.transferFrames.find(f=>f.kind==='tray'),target=r.scene.transferFrames.find(f=>f.kind==='input');
 assert.ok(source.w>=56&&source.h>=56&&target.w>=64&&target.h>=64);assert.equal(r.scene.transferHeight,0);
 assert.equal(r.actionAt(source.x+32,source.y+32),'transfer-source-pop');
 assert.equal(r.transferTargetAt(target.x+32,target.y+32,'pop'),target);
 assert.equal(r.transferTargetAt(target.x+32,target.y+32,'cup'),null);
 assert.ok(!canvas.texts.some(row=>/点选|再点|B 段正常|点按/.test(row.text)));
});
test('cargo ghost follows a gesture above the finger and a full inlet never advertises a valid drop',()=>{
 const view=snapshot(),first=draw(view),target=first.r.scene.transferFrames.find(f=>f.kind==='input');
 const held={source:'pop',target:'cup',amount:4,x:target.x+32,y:target.y+32,dragging:true};
 const {r,canvas}=draw(view,{transfer:held});assert.equal(r.transferGhost.amount,4);assert.equal(r.transferGhost.ready,true);
 assert.ok(r.transferGhost.y+r.transferGhost.h<held.y);assert.ok(canvas.texts.some(row=>row.text==='4 份'));
 const full=draw({...view,transfer:{...view.transfer,inputAmount:view.transfer.inputCapacity}},{transfer:held});
 assert.equal(full.r.transferGhost.ready,false);assert.equal(full.r.transferTargetAt(held.x,held.y,'pop'),null);assert.ok(full.canvas.texts.some(row=>row.text==='已满'));
 assert.equal(draw(view,{press:{source:'pop',x:held.x,y:held.y}}).r.transferGhost,null);
});
test('modal input ownership removes background operations and cargo feedback',()=>{
 const held={source:'pop',target:'cup',amount:4,x:100,y:240,dragging:true};
 const {r}=draw(snapshot(),{modal:{type:'settings'},transfer:held});
 assert.equal(r.transferGhost,null);assert.equal(r.transferTargetAt(20,220,'pop'),null);assert.ok(!r.zones.some(z=>z.action.startsWith('transfer-')));
 const ordinary=draw(new ProductionInsights().enrich(new Game().getView()));assert.equal(ordinary.r.scene.transferFrames.length,0);
});
