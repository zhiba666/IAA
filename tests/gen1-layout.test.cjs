'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Game}=require('../src/core'),{Renderer}=require('../src/renderer'),{ProductionInsights}=require('../src/production-insights');
const {ART_ASSETS}=require('../src/art-manifest');
const {canvasHarness,deepFreeze}=require('./canvas-harness.cjs');
const viewports=[{width:320,height:524,safeTop:0},{width:360,height:640,safeTop:24,safeBottom:24},
 {width:390,height:844,safeTop:44,safeBottom:34},{width:430,height:932,safeTop:0},{width:320,height:484,safeTop:75}];
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
const inside=(r,b)=>r[0]>=b.x-1e-6&&r[1]>=b.y-1e-6&&r[0]+r[2]<=b.x+b.w+1e-6&&r[1]+r[3]<=b.y+b.h+1e-6;
function renderer(){const canvas=canvasHarness();canvas.ctx.globalAlpha=1;return {canvas,r:new Renderer(canvas.ctx,{get(id){assert.ok(ART_ASSETS[id]);return{id};},report:()=>({pending:0,failed:0})})};}
test('first-generation full canvas keeps every real machine, warehouse and dedicated inlet inside permanent HUD reservations',()=>{
 const game=new Game({mode:'v15',now:1800000000000});game.tick(10);const view=deepFreeze(new ProductionInsights().enrich(game.getView()));
 for(const viewport of viewports){const {r,canvas}=renderer();r.draw(view,{viewport,modal:null},0);const scene=r.scene,content=scene.contentFrame;
  assert.deepEqual(r.interface.layout.scene,{x:0,y:0,w:viewport.width,h:viewport.height});assert.equal(r.interface.layout.dock,undefined);
  assert.equal(scene.stationFrames.length,3);assert.equal(scene.bufferFrames.length,2);assert.equal(scene.transferFrames.length,4);
  for(const frame of scene.stationFrames){assert.ok(frame.w>=44&&frame.h>=44);assert.ok(inside(frame.artRect,content));assert.ok(frame.artRect[2]>=40&&frame.artRect[3]>=55);
   assert.equal(r.actionAt(frame.x+frame.w/2,frame.y+frame.h/2),'station:'+frame.id);}
  for(const bin of scene.diagnostics.buffers)assert.ok(inside(bin.rect,content));
  for(const frame of scene.transferFrames){assert.ok(frame.w>=64&&frame.h>=64);assert.ok(inside([frame.x,frame.y,frame.w,frame.h],content));
   for(const other of scene.stationFrames.concat(content.exclusionRects))assert.equal(overlap(frame,other),0);}
  assert.equal(scene.transferHeight,0);assert.ok(!canvas.texts.some(row=>/点选|再点|加工中|等供料/.test(row.text)));assert.equal(canvas.depth(),0);
 }
});
test('opening, switching and closing every modal preserves first-generation world geometry',()=>{
 const view=new ProductionInsights().enrich(new Game({mode:'v15'}).getView());
 for(const viewport of viewports){const {r}=renderer();let geometry;
  for(const modal of [null,{type:'station',stationId:'cup'},{type:'station',stationId:'pop'},{type:'logistics'},{type:'expansion'},{type:'settings'},null]){
   r.draw(view,{viewport,modal},0);const current={machines:r.scene.stationFrames,bins:r.scene.bufferFrames,transfers:r.scene.transferFrames,content:r.scene.contentFrame};
   if(geometry)assert.deepEqual(current,geometry);else geometry=JSON.parse(JSON.stringify(current));
   if(modal)assert.ok(!r.zones.some(z=>z.action.startsWith('station:')||z.action.startsWith('transfer-')));
  }
 }
});
