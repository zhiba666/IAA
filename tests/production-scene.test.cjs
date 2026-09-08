'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {ProductionScene,PARTICLE_LIMIT}=require('../src/production-scene');

function canvas() {
  let depth=0,operations=0;
  const ctx={save(){depth++;},restore(){assert.ok(depth>0);depth--;},beginPath(){},closePath(){},fill(){},stroke(){},clip(){},
    verify(){assert.equal(depth,0);assert.ok(operations>0);}};
  for(const name of ['moveTo','lineTo','arcTo','translate','scale','rotate','fillRect','arc'])ctx[name]=(...args)=>{
    for(const n of args)assert.ok(Number.isFinite(n),name+' requires finite coordinates');
    if(name==='arc')assert.ok(args[2]>=0);operations++;
  };
  return new Proxy(ctx,{set(target,key,value){if(key==='globalAlpha')assert.ok(value>=0&&value<=1);target[key]=value;return true;}});
}

function simulate(rate,stage,dt=.02,seconds=3) {
  const scene=new ProductionScene(canvas()),view={state:{machine:stage}};
  for(let i=0;i<Math.round(seconds/dt);i++) {
    scene.emit({type:'produce',source:'auto',amount:rate*dt},view);
    scene.update(dt,view);
  }
  return scene;
}

test('production scene: emission reflects production accumulated over time rather than event count',()=>{
  const thirty=simulate(40,3,.01),sixty=simulate(40,3,.02);
  assert.equal(thirty.emitted,sixty.emitted);
  assert.ok(simulate(1000,3).emitted>simulate(.4,3).emitted*3);
  const scene=new ProductionScene(canvas());
  for(let i=0;i<100;i++)scene.emit({type:'produce',source:'auto',amount:.001});
  assert.equal(scene.particles.length,0,'event receipt must not spray once per tick');
  scene.update(.12,{state:{machine:0}});
  assert.ok(scene.particles.length<=1,'small amounts cannot create a minimum particle per event');
});

test('production scene: later machines use multiple outlets and larger taps produce stronger effects',()=>{
  for(let stage=0;stage<6;stage++) {
    const scene=new ProductionScene(canvas());
    scene.emit({type:'produce',source:'tap',amount:1000},stage);
    const outlets=new Set(scene.particles.map(p=>p.port)).size;
    assert.ok(stage<2?outlets===1:outlets>1,'later machines visibly expand beyond one outlet');
  }
  const scene=new ProductionScene(canvas());
  scene.emit({type:'produce',source:'tap',amount:1});const low=scene.particles.length;
  scene.particles.length=0;scene.emit({type:'produce',source:'tap',amount:1000});
  assert.ok(scene.particles.length>low);
});

test('production scene: burst is counted once and takes priority within the shared particle budget',()=>{
  const scene=new ProductionScene(canvas());
  scene.emit({type:'produce',source:'burst',amount:999});assert.equal(scene.particles.length,0);
  for(let i=0;i<30;i++)scene.emit({type:'produce',source:'tap',amount:1000},5);
  assert.equal(scene.particles.length,PARTICLE_LIMIT);
  const normal=new ProductionScene(canvas());normal.emit({type:'burst',amount:1000},5);
  scene.emit({type:'burst',amount:1000},5);
  assert.ok(scene.burstTime>0);assert.equal(scene.particles.length,PARTICLE_LIMIT);
  assert.ok(normal.particles.length>0);
  assert.equal(scene.particles.filter(p=>p.kind==='burst').length,normal.particles.length,'a full scene preserves the whole burst by replacing older particles');
  for(let i=0;i<40;i++){scene.emit({type:'evolve',machine:i%6});scene.update(.05);assert.ok(scene.particles.length<=PARTICLE_LIMIT);}
  scene.update(5);assert.equal(scene.particles.length,0);assert.equal(scene.burstTime,0);assert.equal(scene.evolveTime,0);
});

test('production scene: perfect effects stay distinct and bounded without duplicating bursts or trusting invalid bonuses',()=>{
  const normal=new ProductionScene(canvas()),perfect=new ProductionScene(canvas());
  normal.emit({type:'burst',amount:480,perfect:false,bonusAmount:80},5);
  perfect.emit({type:'burst',amount:480,perfect:true,bonusAmount:80},5);
  assert.equal(normal.perfectTime,0);assert.ok(perfect.perfectTime>0);
  assert.equal(normal.particles.filter(p=>p.kind==='perfect').length,0);
  assert.equal(perfect.particles.filter(p=>p.kind==='burst').length,normal.particles.length);
  const accents=perfect.particles.filter(p=>p.kind==='perfect');
  assert.ok(accents.length>0);assert.ok(accents.every(p=>p.accent),'perfect bursts add visibly distinct accents');
  assert.ok(accents.every(p=>perfect.ports().some(port=>port.x===p.port)),'bonus accents emerge from the same machine outlets');
  for(let i=0;i<40;i++) {
    perfect.emit({type:'burst',perfect:true,bonusAmount:1e90},i%6);
    assert.ok(perfect.particles.length<=PARTICLE_LIMIT);
  }
  perfect.update(5);assert.equal(perfect.particles.length,0);assert.equal(perfect.perfectTime,0);
  perfect.emit({type:'burst',perfect:false});assert.equal(perfect.perfectTime,0);
  const baseline=new ProductionScene(canvas());baseline.emit({type:'burst',perfect:true,bonusAmount:0});
  const baseAccents=baseline.particles.filter(p=>p.kind==='perfect').length;
  for(const bonusAmount of [NaN,Infinity,-2,undefined]) {
    const scene=new ProductionScene(canvas());scene.emit({type:'burst',perfect:true,bonusAmount});
    assert.equal(scene.particles.filter(p=>p.kind==='perfect').length,baseAccents,'invalid bonuses have the same effect as zero');
    scene.update(.1);scene.draw(0,0,296,117);scene.c.verify();
  }
  const scene=new ProductionScene(canvas());scene.emit({type:'burst',perfect:'true',bonusAmount:1000});
  assert.equal(scene.perfectTime,0);assert.equal(scene.particles.some(p=>p.kind==='perfect'),false);
});

test('production scene: evolution installs then starts a new machine without blocking taps',()=>{
  const scene=new ProductionScene(canvas());
  scene.emit({type:'evolve',machine:4});assert.equal(scene.stage,4);
  const before=scene.emitted;scene.emit({type:'produce',source:'tap',amount:40});assert.ok(scene.emitted>before);
  for(let i=0;i<4;i++)scene.update(.2);
  assert.ok(scene.evolveLaunched);assert.ok(scene.particles.some(p=>p.kind==='burst'));
  const flow=simulate(40,4);assert.ok(flow.packTravel>0);
});

test('production scene: claimed orders briefly depart while production remains responsive',()=>{
  const ctx=canvas(),scene=new ProductionScene(ctx);
  scene.emit({type:'order'});assert.ok(scene.orderTime>0);
  scene.emit({type:'produce',source:'tap',amount:20},4);assert.ok(scene.particles.length>0);
  for(let i=0;i<4;i++){scene.update(.3);scene.draw(12,177,296,177,{state:{machine:4}});}
  ctx.verify();assert.ok(scene.orderTime>0);scene.update(.5);assert.equal(scene.orderTime,0);
});

test('production scene: every machine and preview draws finite geometry without leaking Canvas state',()=>{
  for(let stage=0;stage<6;stage++) {
    const ctx=canvas(),scene=simulate(20,stage);scene.c=ctx;
    scene.emit({type:'burst',amount:300,perfect:true,bonusAmount:50},stage);scene.emit({type:'evolve',machine:stage});scene.update(.05);
    for(const [w,h] of [[432,220],[288,145],[640,240],[296,108],[296,117],[366,393]])scene.draw(0,0,w,h,{state:{machine:stage}});
    scene.draw(12,53,366,630,{state:{machine:stage}},{topInset:128,bottomInset:106});
    scene.drawMachinePreview(20,20,110,stage);ctx.verify();
    assert.equal(scene.stage,stage);
  }
});

test('production scene: focused framing enlarges the machine while keeping each identity and packages visible',()=>{
  const bounds=[
    [118,332,87,213],[118,314,61,213],[118,314,47,213],
    [104,328,54,213],[84,366.2,38,209],[91.8,366.2,7.36,209]
  ];
  for(let stage=0;stage<6;stage++) {
    const scene=new ProductionScene(canvas());scene.stage=stage;
    for(const [w,h,options={}] of [[296,108],[296,117],[366,393],[432,220],[640,240],[406,742,{topInset:104,bottomInset:112}],[296,378,{topInset:104,bottomInset:112}]]) {
      const f=scene.framing(w,h,options),[left,right,top,bottom]=bounds[stage];
      assert.ok(f.x+left*f.scale>=0&&f.x+right*f.scale<=w,'stage '+stage+' horizontal working area stays visible');
      assert.ok(f.y+top*f.scale>=(options.topInset||0)&&f.y+bottom*f.scale<=h-(options.bottomInset||0),'stage '+stage+' machine and packages stay inside the area reserved between overlays');
    }
    assert.ok(scene.framing(366,393).scale>scene.framing(366,117).scale,'more vertical room should enlarge the machine');
  }
});

test('production scene: invalid events and long pauses cannot create a backlog or invalid particles',()=>{
  const scene=new ProductionScene(canvas());
  for(const amount of [-1,NaN,Infinity,undefined])scene.emit({type:'produce',source:'auto',amount});
  scene.update(NaN);scene.update(-1);assert.equal(scene.pendingAuto,0);
  scene.emit({type:'produce',source:'auto',amount:1e90});scene.update(5);scene.update(.12);
  assert.equal(scene.particles.length,0);assert.equal(scene.pendingAuto,0);
});

test('production scene: upgrades animate faster and refine packages without replaying work after a pause',()=>{
  const low=new ProductionScene(canvas()),high=new ProductionScene(canvas());
  const lowView={state:{machine:4,upgrades:{auto:0,value:0}}};
  const highView={state:{machine:4,upgrades:{auto:24,value:24},refinements:{yield:3,value:3}}};
  for(let i=0;i<30;i++)for(const [scene,view] of [[low,lowView],[high,highView]]) {
    scene.emit({type:'produce',source:'auto',amount:10});scene.update(.05,view);
  }
  assert.ok(high.driveTime>low.driveTime,'equal production still shows the upgraded motor running faster');
  assert.ok(high.packTravel>low.packTravel,'continuous production increases the dispatch rhythm');
  assert.equal(high.recipeTier,3);assert.equal(high.finishLevel,3);assert.equal(low.recipeTier,0);
  for(let stage=0;stage<6;stage++) {
    const view={state:{...highView.state,machine:stage}};
    high.emit({type:'evolve',machine:stage});high.emit({type:'order'});
    high.draw(0,0,296,378,view,{topInset:104,bottomInset:112});high.drawMachinePreview(0,0,110,stage);
    assert.ok(high.particles.length<=PARTICLE_LIMIT);
  }
  high.c.verify();
  const driveTime=high.driveTime,travel=high.packTravel;
  high.update(5,highView);
  assert.equal(high.driveTime,driveTime);assert.equal(high.packTravel,travel);
  assert.equal(high.evolveTime,0);assert.equal(high.orderTime,0);assert.equal(high.particles.length,0);
  high.update(.12,{state:{machine:0}});
  assert.equal(high.autoLevel,0);assert.equal(high.recipeTier,0);assert.equal(high.finishLevel,0);assert.equal(high.yieldLevel,0);
});
