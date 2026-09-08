'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {ProductionScene,PARTICLE_LIMIT,UNIT_LIMIT,PRODUCTION_FORMS}=require('../src/production-scene');

function canvas() {
  let depth=0,operations=0;const alphaStack=[];
  const ctx={globalAlpha:1,save(){depth++;alphaStack.push(this.globalAlpha);},restore(){assert.ok(depth>0);depth--;this.globalAlpha=alphaStack.pop();},beginPath(){},closePath(){},fill(){},stroke(){},clip(){},
    verify(){assert.equal(depth,0);assert.ok(operations>0);}};
  for(const name of ['moveTo','lineTo','arcTo','translate','scale','rotate','fillRect','arc','ellipse','bezierCurveTo','quadraticCurveTo'])ctx[name]=(...args)=>{
    for(const n of args)if(typeof n!=='boolean')assert.ok(Number.isFinite(n),name+' requires finite coordinates');
    if(name==='arc'||name==='ellipse')assert.ok(args[2]>=0);operations++;
  };
  ctx.setLineDash=values=>values.forEach(n=>assert.ok(Number.isFinite(n)&&n>=0));
  ctx.fillText=(_text,x,y)=>{assert.ok(Number.isFinite(x)&&Number.isFinite(y));operations++;};
  ctx.measureText=text=>({width:String(text).length*7});
  return new Proxy(ctx,{set(target,key,value){if(key==='globalAlpha')assert.ok(value>=0&&value<=1);target[key]=value;return true;}});
}

function observedScene() {
  const scene=new ProductionScene(canvas()),dispatches=[],dispatch=scene.dispatch;
  scene.dispatch=function(...args) {
    const result=dispatch.apply(this,args);
    if(result)dispatches.push({kind:args[0],stage:this.stage});
    return result;
  };
  return {scene,dispatches};
}

function simulate(rate,stage,dt=.02,seconds=6) {
  const result=observedScene(),view={state:{machine:stage}};
  for(let i=0;i<Math.round(seconds/dt);i++) {
    result.scene.emit({type:'produce',source:'auto',amount:rate*dt},view);
    result.scene.update(dt,view);
    assert.ok(result.scene.units.length<=UNIT_LIMIT);
    assert.ok(result.scene.particles.length<=PARTICLE_LIMIT);
  }
  return result;
}

function snapshot(scene) {
  return structuredClone(Object.fromEntries(Object.entries(scene).filter(([key,value])=>key!=='c'&&typeof value!=='function')));
}

function deepFreeze(value) {
  if(value&&typeof value==='object') {
    for(const child of Object.values(value))deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test('production scene: every generation describes a distinct production unit and organization',()=>{
  assert.equal(PRODUCTION_FORMS.length,6);
  assert.equal(new Set(PRODUCTION_FORMS.map(form=>form.id)).size,6);
  assert.equal(new Set(PRODUCTION_FORMS.map(form=>form.unit)).size,6);
  for(const form of PRODUCTION_FORMS)for(const field of ['id','unit','rhythm','unlock']) {
    assert.equal(typeof form[field],'string');assert.ok(form[field].trim().length>0);
  }
});

test('production scene: automatic dispatch follows elapsed production rather than event count',()=>{
  for(let stage=0;stage<6;stage++) {
    const runs=[1/120,1/60,1/30,.05].map(dt=>simulate(40,stage,dt,30));
    const counts=runs.map(run=>run.dispatches.length);
    assert.ok(Math.min(...counts)>0,'production should dispatch visible units');
    assert.ok(Math.max(...counts)-Math.min(...counts)<=1,'frame rate should not materially change sustained dispatch count at stage '+stage+': '+counts.join(', '));
    for(const run of runs)assert.equal(run.scene.particles.length,0,'automatic output uses organized units');
  }
  assert.ok(simulate(1000,3).dispatches.length>simulate(.004,3).dispatches.length,'real throughput still changes the dispatch rhythm');
  const {scene,dispatches}=observedScene();
  for(let i=0;i<100;i++)scene.emit({type:'produce',source:'auto',amount:.001});
  assert.equal(scene.units.length,0,'event receipt does not dispatch once per tick');
  scene.update(.12,{state:{machine:0}});
  assert.equal(dispatches.length,0,'tiny events cannot force a minimum unit per event');
});

test('production scene: an idle machine never manufactures visual shipments',()=>{
  for(let stage=0;stage<6;stage++) {
    const {scene,dispatches}=observedScene();
    for(let i=0;i<120;i++)scene.update(.05,{state:{machine:stage}});
    assert.equal(dispatches.length,0);assert.equal(scene.units.length,0);assert.equal(scene.particles.length,0);
    scene.emit({type:'produce',source:'auto',amount:.001});scene.update(.12);
    for(let i=0;i<60;i++)scene.update(.1);
    assert.equal(dispatches.length,0,'idle time cannot turn a small production credit into free shipments');
  }
  const {scene,dispatches}=simulate(40,3,1/60,6),count=dispatches.length;
  assert.ok(scene.autoCredit>=8,'a busy output lane can retain earned visual credit');
  for(let i=0;i<60;i++)scene.update(.1);
  assert.equal(dispatches.length,count,'clearing the lane cannot dispatch saved credit without new production');
  assert.equal(scene.units.length,0);
});

test('production scene: taps give fixed feedback while generations change the visible unit',()=>{
  for(let stage=0;stage<6;stage++)for(const amount of [1,40,1000,1e90]) {
    const scene=new ProductionScene(canvas());
    scene.emit({type:'produce',source:'tap',amount},stage);
    assert.equal(scene.particles.length,stage===0?3:2,'larger payouts do not add particles');
    assert.equal(scene.units.length,1);assert.equal(scene.units[0].stage,stage);
    assert.equal(scene.units[0].kind,'tap');assert.ok(scene.tapPulse>0);
  }
});

test('production scene: organized output and particles have independent fixed budgets',()=>{
  assert.equal(UNIT_LIMIT,8);
  const scene=new ProductionScene(canvas());
  for(let i=0;i<100;i++) {
    scene.emit({type:'produce',source:'tap',amount:1e90},5);
    assert.ok(scene.units.length<=UNIT_LIMIT);assert.ok(scene.particles.length<=PARTICLE_LIMIT);
  }
  assert.equal(scene.particles.length,PARTICLE_LIMIT);
  for(let i=0;i<100;i++) {
    scene.dispatch('burst');
    assert.ok(scene.units.length<=UNIT_LIMIT);
  }
  for(const unit of scene.units) {
    assert.ok(Number.isFinite(unit.progress));assert.ok(Number.isFinite(unit.duration)&&unit.duration>0);
    assert.ok(Number.isInteger(unit.stage)&&unit.stage>=0&&unit.stage<6);
  }
});

test('production scene: bursts dispatch one hero and keep fixed accents even when the scene is full',()=>{
  const scene=new ProductionScene(canvas());
  scene.emit({type:'produce',source:'burst',amount:999});
  assert.equal(scene.particles.length,0);assert.equal(scene.units.length,0);
  for(let i=0;i<100;i++)scene.emit({type:'produce',source:'tap',amount:1000},5);
  const before=scene.dispatched;
  scene.emit({type:'burst',amount:1e90},5);
  assert.equal(scene.dispatched,before+1);assert.ok(scene.units.some(unit=>unit.kind==='burst'&&unit.hero));
  assert.equal(scene.particles.filter(p=>p.kind==='burst').length,18);
  assert.equal(scene.particles.length,PARTICLE_LIMIT);assert.ok(scene.burstTime>0);
  for(let stage=0;stage<6;stage++)for(const amount of [1,1000,1e90]) {
    const normal=new ProductionScene(canvas());normal.emit({type:'burst',amount},stage);
    assert.equal(normal.particles.length,18);assert.equal(normal.units.length,1);
    assert.equal(normal.units[0].stage,stage);assert.equal(normal.units[0].hero,true);
  }
});

test('production scene: stored pressure waits for release while automatic bursts keep their feedback',()=>{
  const scene=new ProductionScene(canvas());
  scene.emit({type:'pressure',action:'store',amount:1000},5);
  assert.ok(scene.pressurePulse>0);assert.equal(scene.units.length,0,'storage is not a shipment');
  assert.equal(scene.particles.length,0);
  for(const source of ['pressure','pot']){
    scene.emit({type:'burst',source,amount:1000},5);
    assert.ok(scene.burstTime>0);assert.equal(scene.particles.filter(p=>p.kind==='burst').length,18);
    assert.equal(scene.units.length,1,'each release has one hero batch');
    assert.equal(scene.units[0].kind,source==='pressure'?'pressure':'burst');
    scene.update(.1);scene.draw(0,0,296,117);scene.c.verify();
    scene.update(5);assert.equal(scene.particles.length,0);assert.equal(scene.burstTime,0);
  }
});

test('production scene: souvenir celebrations retain their distinct sparkles without shipping goods',()=>{
  const scene=new ProductionScene(canvas());scene.emit({type:'souvenir'},5);
  assert.equal(scene.particles.length,12);assert.equal(scene.units.length,0);
  assert.ok(scene.particles.every(p=>p.kind==='sparkle'&&p.accent));
  scene.update(.1);scene.draw(0,0,296,117);scene.c.verify();
  scene.update(5);assert.equal(scene.particles.length,0);
});

test('production scene: evolution clears old output and reveals a first hero batch without blocking taps',()=>{
  const scene=new ProductionScene(canvas());scene.dispatch('auto');assert.ok(scene.units.length>0);
  scene.emit({type:'evolve',machine:4});
  assert.equal(scene.stage,4);assert.equal(scene.units.length,0);assert.equal(scene.particles.length,0);
  assert.equal(scene.evolveTime,2.8);
  scene.update(.7);assert.equal(scene.evolveLaunched,false);
  scene.emit({type:'produce',source:'tap',amount:40});
  assert.ok(scene.tapPulse>0);assert.equal(scene.particles.length,2,'installation still acknowledges taps immediately');
  const particleCount=scene.particles.length;scene.update(.15);
  assert.ok(scene.evolveLaunched);assert.ok(scene.units.some(unit=>unit.kind==='evolve'&&unit.hero&&unit.stage===4));
  assert.ok(scene.particles.length<=particleCount,'installation launches product units without a particle spray');
  scene.update(.23);scene.emit({type:'produce',source:'tap',amount:40});
  assert.ok(scene.tapPulse>0);assert.ok(scene.particles.length>=2,'the first batch keeps tap feedback responsive');
  assert.ok(scene.units.some(unit=>unit.kind==='evolve'&&unit.hero),'taps leave the first hero batch visible');
  for(let i=0;i<27;i++)scene.update(.1);
  scene.emit({type:'produce',source:'tap',amount:40});
  assert.ok(scene.units.some(unit=>unit.kind==='tap'&&unit.stage===4),'normal output resumes after the first batch leaves');
  assert.ok(simulate(40,4).scene.packTravel>0);
});

test('production scene: rapid taps, automatic bursts and repeated evolution stay responsive and bounded',()=>{
  const scene=new ProductionScene(canvas());
  for(let i=0;i<90;i++) {
    const stage=i%6;scene.emit({type:'evolve',machine:stage});
    scene.emit({type:'produce',source:'tap',amount:1e90});
    assert.ok(scene.tapPulse>0);assert.equal(scene.particles.length,stage===0?3:2);
    scene.emit({type:'burst',source:'pot',amount:1e90});
    assert.ok(scene.burstTime>0);
    assert.equal(scene.particles.filter(p=>p.kind==='burst').length,18);
    scene.update(.05,{state:{machine:stage}});
    assert.ok(scene.units.every(unit=>unit.stage===stage),'new generations do not retain old production units');
    assert.ok(scene.units.length<=UNIT_LIMIT);assert.ok(scene.particles.length<=PARTICLE_LIMIT);
    scene.draw(0,0,296,378,{state:{machine:stage}},{topInset:104,bottomInset:112});
  }
  scene.update(.8);assert.ok(scene.units.some(unit=>unit.kind==='evolve'&&unit.hero&&unit.stage===5));
  scene.emit({type:'burst',source:'pot'});assert.ok(scene.units.some(unit=>unit.kind==='burst'&&unit.hero));
  scene.c.verify();scene.update(5);
  assert.equal(scene.units.length,0);assert.equal(scene.particles.length,0);
  assert.equal(scene.burstTime,0);assert.equal(scene.evolveTime,0);
});

test('production scene: claimed orders briefly depart while production remains responsive',()=>{
  const ctx=canvas(),scene=new ProductionScene(ctx);
  scene.emit({type:'order'});assert.ok(scene.orderTime>0);
  scene.emit({type:'produce',source:'tap',amount:20},4);assert.ok(scene.units.length>0);
  for(let i=0;i<4;i++){scene.update(.3);scene.draw(12,177,296,177,{state:{machine:4}});}
  ctx.verify();assert.ok(scene.orderTime>0);scene.update(.5);assert.equal(scene.orderTime,0);
});

test('production scene: every generation and preview draws finite geometry without leaking Canvas state',()=>{
  for(let stage=0;stage<6;stage++) {
    const scene=simulate(20,stage).scene;
    scene.emit({type:'evolve',machine:stage});scene.update(.85);
    scene.emit({type:'burst',amount:300,source:'pot'},stage);
    for(const [w,h] of [[432,220],[288,145],[640,240],[296,108],[296,117],[366,393]])scene.draw(0,0,w,h,{state:{machine:stage}});
    scene.draw(12,53,366,630,{state:{machine:stage}},{topInset:128,bottomInset:106});
    scene.drawMachinePreview(20,20,110,stage);scene.drawProductionPreview(20,20,110,stage);scene.c.verify();
    assert.equal(scene.stage,stage);
  }
});

test('production scene: framing accommodates phone layouts and reserved overlay space',()=>{
  for(let stage=0;stage<6;stage++) {
    const scene=new ProductionScene(canvas());scene.stage=stage;
    for(const [w,h,options={}] of [[296,108],[296,117],[366,393],[432,220],[640,240],[406,742,{topInset:104,bottomInset:112}],[296,378,{topInset:104,bottomInset:112}]]) {
      const frame=scene.framing(w,h,options);
      assert.ok([frame.x,frame.y,frame.scale].every(Number.isFinite));assert.ok(frame.scale>0);
      scene.draw(0,0,w,h,undefined,options);
    }
    assert.ok(scene.framing(366,393).scale>scene.framing(366,117).scale,'more vertical room enlarges the production area');
    scene.draw(0,0,296,108,undefined,{topInset:108,bottomInset:108});scene.c.verify();
  }
});

test('production scene: previews leave active output, animation and generation state untouched',()=>{
  const scene=simulate(60,4).scene;
  scene.emit({type:'burst',source:'pot',amount:1200},4);scene.emit({type:'order'});
  const before=snapshot(scene),units=scene.units,particles=scene.particles;
  for(let stage=0;stage<6;stage++) {
    scene.drawMachinePreview(20,20,110,stage);scene.drawProductionPreview(20,20,110,stage);
    assert.deepEqual(snapshot(scene),before,'drawing another generation preview cannot alter the live scene');
    assert.equal(scene.units,units);assert.equal(scene.particles,particles);
  }
  scene.c.verify();
});

test('production scene: visual events and rendering never mutate economic state or payouts',()=>{
  const view=deepFreeze({state:{machine:4,coins:213,stock:47,totalProduced:980,upgrades:{auto:12,value:12},refinements:{yield:2,value:1}},productionModes:{current:'premium'}});
  const before=structuredClone(view),scene=new ProductionScene(canvas());
  for(const event of [{type:'produce',source:'auto',amount:100},{type:'produce',source:'tap',amount:80},{type:'produce',source:'burst',amount:1000},{type:'burst',amount:1000,source:'pot'},{type:'evolve',machine:4},{type:'order'}])scene.emit(deepFreeze(event),view);
  for(let i=0;i<20;i++) {
    scene.update(.1,view);scene.draw(0,0,366,393,view);
    scene.drawProductionPreview(0,0,80,i%6);
  }
  assert.deepEqual(view,before);scene.c.verify();
});

test('production scene: invalid events and long pauses cannot create delayed production or invalid effects',()=>{
  const {scene,dispatches}=observedScene();
  for(const event of [null,undefined,{},false])scene.emit(event);
  for(const source of ['auto','tap'])for(const amount of [-1,0,NaN,Infinity,undefined])scene.emit({type:'produce',source,amount});
  scene.update(NaN);scene.update(-1);assert.equal(scene.pendingAuto,0);assert.equal(dispatches.length,0);
  scene.emit({type:'burst',source:'pot'});scene.emit({type:'evolve',machine:5});
  scene.emit({type:'produce',source:'auto',amount:1e90});
  const count=dispatches.length;scene.update(5);scene.update(.12);
  assert.equal(scene.particles.length,0);assert.equal(scene.units.length,0);assert.equal(scene.pendingAuto,0);
  assert.equal(dispatches.length,count,'resuming cannot replay pending production or the first-batch reveal');
});

test('production scene: upgrades animate the motor and finish without replaying work after a pause',()=>{
  const low=new ProductionScene(canvas()),high=new ProductionScene(canvas());
  const lowView={state:{machine:4,upgrades:{auto:0,value:0}}};
  const highView={state:{machine:4,upgrades:{auto:24,value:24},refinements:{yield:3,value:3}}};
  for(let i=0;i<30;i++)for(const [scene,view] of [[low,lowView],[high,highView]]) {
    scene.emit({type:'produce',source:'auto',amount:10});scene.update(.05,view);
  }
  assert.ok(high.driveTime>low.driveTime,'equal production still shows the upgraded motor running faster');
  assert.ok(high.packTravel>low.packTravel,'upgrades change movement while keeping particle counts fixed');
  assert.equal(high.recipeTier,3);assert.equal(high.finishLevel,3);assert.equal(low.recipeTier,0);
  assert.equal(high.particles.length,0);assert.equal(low.particles.length,0);
  for(let stage=0;stage<6;stage++) {
    const view={state:{...highView.state,machine:stage}};
    high.emit({type:'evolve',machine:stage});high.emit({type:'order'});
    high.draw(0,0,296,378,view,{topInset:104,bottomInset:112});high.drawProductionPreview(0,0,110,stage);
    assert.ok(high.units.length<=UNIT_LIMIT);assert.ok(high.particles.length<=PARTICLE_LIMIT);
  }
  high.c.verify();
  const driveTime=high.driveTime,travel=high.packTravel;
  high.update(5,highView);
  assert.equal(high.driveTime,driveTime);assert.equal(high.packTravel,travel);
  assert.equal(high.evolveTime,0);assert.equal(high.orderTime,0);assert.equal(high.particles.length,0);assert.equal(high.units.length,0);
  high.update(.12,{state:{machine:0}});
  assert.equal(high.autoLevel,0);assert.equal(high.recipeTier,0);assert.equal(high.finishLevel,0);assert.equal(high.yieldLevel,0);
});
