'use strict';
const { legacyGame } = require('./legacy-fixture.cjs');

const assert=require('node:assert/strict');
const test=require('node:test');
const {Game,CONFIG,formatNumber}=require('../src/core');
const {Renderer}=require('../src/renderer');
const {selectCurrentTarget}=require('../src/experience');

const NOW=1800000000000;
const VIEWPORTS=[[320,568],[360,800],[390,844],[430,932],[480,697],[480,920]];
// Full sheet combinations use one compact and one tall layout. Home and energy
// hit regions still cover every viewport; the 700px pagination regression stays below.
const SHEET_VIEWPORTS=[VIEWPORTS[0],VIEWPORTS[2]];
const identity=()=>[1,0,0,1,0,0];
const intersect=(a,b)=>({w:Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)),h:Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y))});

// Approximate glyph advances using the active font, and apply the actual Canvas
// transform. This catches CSS-pixel regressions without assuming copy never truncates.
function canvas(width,height) {
  let matrix=identity(),stack=[],path=[],arcToCount=0,serial=0;
  const text=[],fills=[];
  const point=(x,y)=>({x:matrix[0]*x+matrix[2]*y+matrix[4],y:matrix[1]*x+matrix[3]*y+matrix[5]});
  const bounds=(x,y,w,h)=>{
    const corners=[point(x,y),point(x+w,y),point(x,y+h),point(x+w,y+h)];
    const xx=corners.map(p=>p.x),yy=corners.map(p=>p.y);
    return{x:Math.min(...xx),y:Math.min(...yy),w:Math.max(...xx)-Math.min(...xx),h:Math.max(...yy)-Math.min(...yy)};
  };
  const finite=(name,args)=>args.forEach(n=>assert.ok(Number.isFinite(n),name+' received invalid coordinates'));
  const ctx={font:'14px sans-serif',textAlign:'left',textBaseline:'middle',globalAlpha:1,fillStyle:'#000',text,fills,overlaySerial:0,
    serial:()=>serial,bounds,
    save(){stack.push({matrix:matrix.slice(),font:this.font,textAlign:this.textAlign,textBaseline:this.textBaseline,globalAlpha:this.globalAlpha,fillStyle:this.fillStyle});},
    restore(){assert.ok(stack.length,'unbalanced Canvas restore');const state=stack.pop();matrix=state.matrix;for(const key of ['font','textAlign','textBaseline','globalAlpha','fillStyle'])this[key]=state[key];},
    setTransform(...args){finite('setTransform',args);matrix=args;},
    translate(x,y){finite('translate',[x,y]);matrix[4]+=matrix[0]*x+matrix[2]*y;matrix[5]+=matrix[1]*x+matrix[3]*y;},
    scale(x,y){finite('scale',[x,y]);matrix[0]*=x;matrix[1]*=x;matrix[2]*=y;matrix[3]*=y;},
    rotate(a){finite('rotate',[a]);const [aa,b,c,d]=matrix,co=Math.cos(a),si=Math.sin(a);matrix[0]=aa*co+c*si;matrix[1]=b*co+d*si;matrix[2]=c*co-aa*si;matrix[3]=d*co-b*si;},
    measureText(value){const size=Number((this.font.match(/([\d.]+)px/)||[0,14])[1]);return{width:[...String(value)].reduce((n,c)=>n+size*(c.charCodeAt(0)>127?1:c===' '?.3:.55),0)};},
    fillText(value,x,y){finite('fillText',[x,y]);const size=Number(this.font.match(/([\d.]+)px/)[1]),w=this.measureText(value).width;
      const left=x-(this.textAlign==='center'?w/2:this.textAlign==='right'?w:0);
      text.push({text:String(value),...bounds(left,y-size/2,w,size),fontSize:size*Math.hypot(matrix[0],matrix[1]),serial:++serial});},
    beginPath(){path=[];arcToCount=0;},closePath(){},clip(){},stroke(){serial++;},
    moveTo(x,y){finite('moveTo',[x,y]);path.push(point(x,y));},lineTo(x,y){finite('lineTo',[x,y]);path.push(point(x,y));},
    arcTo(x,y,xx,yy,r){finite('arcTo',[x,y,xx,yy,r]);path.push(point(x,y),point(xx,yy));arcToCount++;},
    arc(x,y,r,a,b){finite('arc',[x,y,r,a,b]);assert.ok(r>=0);},
    fill(){serial++;if(arcToCount===4&&path.length){const xs=path.map(p=>p.x),ys=path.map(p=>p.y);fills.push({x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys),serial,opaque:this.globalAlpha>.97&&!/^rgba/.test(this.fillStyle)});}},
    fillRect(x,y,w,h){finite('fillRect',[x,y,w,h]);serial++;if(x===0&&y===0&&w===width&&h===height&&/^rgba/.test(this.fillStyle))this.overlaySerial=serial;fills.push({...bounds(x,y,w,h),serial,opaque:this.globalAlpha>.97&&!/^rgba/.test(this.fillStyle)});},
    clearRect(x,y,w,h){finite('clearRect',[x,y,w,h]);},
    verify(){assert.equal(stack.length,0,'Canvas transforms and styles must be restored');}
  };
  return ctx;
}

function factory(overrides={}) {
  const game=legacyGame({now:NOW});
  Object.assign(game.state,{machine:1,orderIndex:6,totalProduced:60000,coins:1000,playedSeconds:120,taps:10,bursts:1,
    upgrades:{tap:3,auto:4,value:2},offline:{id:'offline:responsive',seconds:600,production:240,coins:300}},overrides);
  return game;
}

function render(game,width,height,ui={},beforeDraw=null) {
  const c=canvas(width,height),r=new Renderer(c),originalHit=r.hit;
  r.hit=function(x,y,w,h,action){originalHit.call(this,x,y,w,h,action);Object.assign(this.zones[this.zones.length-1],{paintSerial:c.serial(),screen:c.bounds(x,y,w,h)});};
  const view=game.getView(),state={viewport:{width,height},isDouyin:false,adBusy:false,modal:null,toast:'',...ui};
  // Prime the active scene without painting a discarded frame into the geometry log.
  r.lastView=view;
  if(beforeDraw)beforeDraw(r,view);
  r.draw(view,state,.016);c.verify();
  const entries=c.text.filter(item=>item.serial>c.overlaySerial);
  return{r,c,view,ui:state,entries,actions:r.zones.map(z=>z.action),width,height};
}

function checkLayout(output,label) {
  const {r,c,entries,width,height}=output;
  for(const zone of r.zones) {
    const b=zone.screen;
    assert.ok(b.h>=44-1e-6,`${label}: ${zone.action} is only ${b.h}px high`);
    assert.ok(b.x>=0&&b.y>=0&&b.x+b.w<=width+1e-6&&b.y+b.h<=height+1e-6,`${label}: ${zone.action} extends beyond viewport`);
    const x=zone.x+zone.w/2,y=zone.y+zone.h/2;
    assert.equal(r.actionAt(x,y),zone.action,`${label}: center of ${zone.action} is intercepted by another control`);
    for(const fill of c.fills.filter(f=>f.serial>zone.paintSerial&&f.opaque)) {
      assert.ok(!(x>fill.x+3&&x<fill.x+fill.w-3&&y>fill.y+3&&y<fill.y+fill.h-3),`${label}: ${zone.action} center is covered by a later drawing`);
    }
  }
  for(const entry of entries) {
    assert.doesNotMatch(entry.text,/undefined|NaN|Infinity/,`${label}: invalid visible copy`);
    assert.ok(entry.x>=-.5&&entry.y>=-.5&&entry.x+entry.w<=width+.5&&entry.y+entry.h<=height+.5,`${label}: text extends outside viewport: ${entry.text}`);
    for(const fill of c.fills.filter(f=>f.serial>entry.serial&&f.serial>c.overlaySerial&&f.opaque)) {
      const overlap=intersect(entry,fill);
      assert.ok(!(overlap.w>entry.w*.7&&overlap.h>entry.h*.7),`${label}: text is covered by a later background: ${entry.text}`);
    }
  }
  for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++) {
    const overlap=intersect(entries[i],entries[j]);
    assert.ok(!(overlap.w>4&&overlap.h>2),`${label}: copy overlaps: ${entries[i].text} / ${entries[j].text}`);
  }
}

function actionOnText(output,label) {
  const entry=output.entries.find(entry=>entry.text===label);
  assert.ok(entry,'visible control not found: '+label);
  return output.r.actionAt(entry.x+entry.w/2,entry.y+entry.h/2);
}

function contractFactory(){return factory({machine:2,orderIndex:6,coins:1e6,upgrades:{tap:8,auto:8,value:8},offline:null});}

test('contract options show actual targets and quotes, all three choices remain reachable in compact safe areas',()=>{
  for(const [width,height,safeTop] of [[320,524,0],[320,524,75],[320,568,24],[390,844,0]]){
    const game=contractFactory(),snapshot=JSON.stringify(game.exportSave(NOW));
    for(const page of [0,1,2]){
      const modal={type:'order',page},output=render(game,width,height,{viewport:{width,height,safeTop},modal});
      checkLayout(output,'contract choice '+page);
      const option=game.getView().contracts.options[page];
      assert.deepEqual(modal.contractQuotes[option.kind],option,'the saved click quote must match the visible offer');
      assert.ok(output.actions.includes('contractAccept:'+option.kind+':'+option.id));
      for(const i of [0,1,2])assert.ok(output.actions.includes('contractPage:'+i));
      assert.ok(output.actions.includes('modules'));
      assert.ok(output.entries.some(e=>e.text.includes(formatNumber(option.requirements[0].target))));
      assert.ok(output.entries.some(e=>/60%/.test(e.text)),'ordinary allocation is visible before acceptance');
    }
    assert.equal(JSON.stringify(game.exportSave(NOW)),snapshot);
  }
});

test('contracts render real local progress, preserved retail allocation, and keep cancellation outside production',()=>{
  for(const kind of ['cinema','gift','festival']){
    const game=contractFactory();assert.ok(game.acceptContract(kind).ok);game.tick(2);
    const view=game.getView(),active=view.contracts.active;
    for(const [width,height] of [[320,524],[320,568],[390,844]]){
      const order=render(game,width,height,{modal:{type:'order'}});checkLayout(order,kind+' active');
      assert.ok(order.actions.includes('contractCancel:'+active.id));assert.ok(!order.actions.includes('claimOrder'));
      assert.ok(order.entries.some(e=>e.text.includes('60%产能备货')));
      assert.ok(order.entries.some(e=>e.text.includes(formatNumber(active.heldCoins))));
      assert.ok(!order.actions.includes('tap'));
      const modules=render(game,width,height,{modal:{type:'modules'}});checkLayout(modules,kind+' modules');
      assert.ok(!modules.actions.some(a=>a&&a.startsWith('module:')));
      const home=render(game,width,height,{goalExpanded:false});checkLayout(home,kind+' home');
      const income=view.production.auto*view.production.price*.4;
      assert.ok(home.entries.some(e=>e.text==='现款 +'+formatNumber(income)+' /秒'));
    }
    if(kind==='gift'){
      while(game.getView().contracts.active.heldProduction<game.getView().contracts.active.quantityTarget)game.tick(1);
      assert.equal(game.getView().order.ready,false,'sugar processing continues after all stock is reserved');
      const stocked=render(game,320,524,{modal:{type:'order'}});checkLayout(stocked,'gift fully stocked');
      assert.ok(stocked.entries.some(e=>e.text.startsWith('备货已齐 · 后续产出即时售卖')));
      assert.ok(!stocked.entries.some(e=>e.text.includes('60%产能备货')));
    }
    assert.ok(game.cancelContract(active.id).ok);
    assert.equal(game.getView().factory.canConfigure,false);
  }
});

test('completed contracts retain equal normal and ad controls and end at the twentieth shipment',()=>{
  const game=contractFactory();assert.ok(game.acceptContract('cinema').ok);
  for(let i=0;i<200&&!game.getView().order.ready;i++)game.tick(1);
  assert.ok(game.getView().order.ready);
  for(const [width,height] of [[320,524],[390,844]]){
    const output=render(game,width,height,{modal:{type:'order'}});checkLayout(output,'ready contract');
    const direct=output.r.zones.find(z=>z.action==='claimOrder'),ad=output.r.zones.find(z=>z.action==='ad:order');
    assert.ok(direct&&ad);assert.equal(direct.h,ad.h);assert.equal(direct.w,ad.w);assert.ok(direct.y<ad.y);
    assert.ok(!output.actions.some(a=>a&&a.startsWith('contractCancel:')));
  }
  const complete=factory({machine:5,orderIndex:20,totalProduced:2e9,coins:1e12});
  const output=render(complete,320,524,{modal:{type:'order'}});checkLayout(output,'completed campaign');
  assert.ok(output.actions.includes('souvenirs'));assert.ok(!output.actions.includes('claimOrder'));
  assert.ok(!output.entries.some(e=>/循环订单|返场/.test(e.text)));
});

test('a completed festival returns all production to retail even when its reserved stock is below capacity',()=>{
  const game=contractFactory();assert.ok(game.acceptContract('festival').ok);
  // Three small stored pots meet the festival's batch condition independently of stock.
  for(let i=0;i<3;i++){game.state.factory.storedBurst={amount:1};assert.ok(game.releasePressure().ok);}
  const view=game.getView(),active=view.contracts.active;
  assert.ok(active.ready);assert.ok(active.heldProduction<active.quantityTarget);
  const beforeCoins=game.state.coins;game.tick(.1);
  assert.equal(game.getView().contracts.active.heldProduction,active.heldProduction,'ready contracts reserve no further production');
  const income=view.production.auto*view.production.price;
  assert.ok(Math.abs(game.state.coins-beforeCoins-income*.1)<1e-7,'the full production income is settled as cash');
  for(const [width,height] of [[320,524],[390,844]]){
    const output=render(game,width,height,{modal:{type:'order'}});checkLayout(output,'ready festival retail');
    assert.ok(output.entries.some(e=>e.text==='合同已达标 · 后续产出即时售卖'));
    assert.ok(!output.entries.some(e=>e.text.includes('60%产能备货')));
    assert.ok(output.entries.some(e=>e.text==='+'+formatNumber(income)+' /秒'),'the panel shows the full retail income after readiness');
  }
});

test('the permanent collection exposes optional manual pressure controls and stored pressure requires an explicit release',()=>{
  const game=contractFactory();game.state.factory.owned.push('pressure');game.setPressureMode('hold');
  const initial=game.getView(),before=game.state.coins;
  for(const [width,height] of [[320,524],[320,568],[390,844]]){
    const output=render(game,width,height,{modal:{type:'modules'}});checkLayout(output,'module choices');
    assert.ok(output.actions.includes('pressureMode:auto'));assert.ok(output.actions.includes('pressureMode:hold'));
    assert.ok(!output.actions.some(action=>action&&action.startsWith('module:')),'owned devices cannot be unloaded');
    const charging=render(game,width,height,{goalExpanded:false});checkLayout(charging,'charging pressure');
    assert.ok(charging.entries.some(entry=>entry.text==='蓄满自动储锅'));
    assert.ok(charging.entries.some(entry=>entry.text.includes('格后存入蓄压罐')),'charging describes storage before payout');
    assert.ok(!charging.actions.includes('releasePressure'),'an empty tank cannot be released');
  }
  assert.equal(game.state.coins,before);
  game.state.energy=99;game.tick(1);const events=game.drainEvents();
  assert.ok(events.some(e=>e.type==='pressure'&&e.action==='store'));
  const r=new Renderer(canvas(320,568));r.lastView=game.getView();events.forEach(e=>r.emit(e));
  assert.equal(r.notice.kind,'pressure');assert.ok(!r.scene.units.some(u=>u.kind==='pressure'),'storage is not shipment');
  for(const [width,height] of VIEWPORTS){
    const stored=render(game,width,height,{goalExpanded:false});checkLayout(stored,'stored pressure '+width);
    assert.ok(stored.actions.includes('releasePressure'));
    assert.equal(actionOnText(stored,'放出整锅'),'releasePressure');
    assert.ok(!stored.actions.includes('timing'));
  }
  const locked=render(game,320,568,{modal:{type:'modules'}});checkLayout(locked,'stored rack');
  assert.ok(!locked.actions.some(a=>a&&a.startsWith('module:')));
  assert.ok(game.releasePressure().ok);const burst=game.drainEvents().find(e=>e.type==='burst');r.emit(burst);
  assert.ok(r.scene.units.some(u=>u.kind==='pressure'));assert.match(r.notice.title,/蓄压/);
  assert.equal(r.notice.title,'蓄压整锅放出 +'+formatNumber(burst.amount)+' 份');
  assert.equal(r.notice.text,'本次现款 +'+formatNumber(burst.coins)+' 金币 · 蓄压增产25%');
  for(const [width,height] of VIEWPORTS){
    const released=render(game,width,height,{goalExpanded:false},renderer=>renderer.emit(burst));
    checkLayout(released,'released pressure '+width);
    assert.ok(!released.actions.includes('releasePressure'),'the released pot cannot be paid out twice');
    assert.ok(released.entries.some(entry=>entry.text.startsWith('蓄压整锅放出 +')));
  }
  assert.equal(game.getView().factory.canConfigure,false);
  assert.deepEqual(initial.factory.owned.slice().sort(),['coating','packer','pressure']);
});

test('all six catalogue entries and progress remain readable across compact pages and safe areas',()=>{
  for(const complete of [false,true])for(const [width,height,safeTop] of [[320,524,0],[320,524,75],[320,568,24],[390,844,0]]){
    const game=contractFactory();
    if(complete){game.state.machine=4;game.state.orderIndex=16;game._autoQuests();game.drainEvents();}
    const owned=game.getView().factory.owned,snapshot=JSON.stringify(game.exportSave(NOW)),seen=new Set();
    for(let page=0;page<6;page++){
      const modal={type:'modules',page},output=render(game,width,height,{viewport:{width,height,safeTop},modal});
      checkLayout(output,'catalogue '+complete+' '+width+' '+safeTop+' page '+page);
      assert.ok(output.entries.some(e=>e.text==='设备图鉴'));
      assert.ok(output.entries.some(e=>e.text.includes('永久生效')));
      assert.ok(!output.actions.some(action=>action&&action.startsWith('module:')));
      for(const module of game.getView().factory.modules)if(output.entries.some(e=>e.text.includes(module.name)))seen.add(module.id);
      if(complete){assert.ok(output.actions.includes('pressureMode:auto'));assert.ok(output.actions.includes('pressureMode:hold'));}
    }
    assert.equal(seen.size,6,'every locked or owned device can be inspected');
    assert.equal(JSON.stringify(game.exportSave(NOW)),snapshot);assert.deepEqual(game.getView().factory.owned,owned);
    const home=render(game,width,height,{viewport:{width,height,safeTop},goalExpanded:false});checkLayout(home,'collection home');
    assert.ok(home.entries.some(e=>e.text.includes('设备图鉴 '+owned.length+'/6')));
    if(complete){assert.equal(game.getView().factory.pressureMode,'auto');assert.ok(!home.actions.includes('releasePressure'));}
  }
});

test('growth records award automatically and no retired routes appear in the factory navigation',()=>{
  const game=contractFactory();game.tick(1);
  for(const type of ['upgrades','workshop','quests','modules']){
    const output=render(game,320,524,{modal:{type}});checkLayout(output,type+' current routes');
    assert.ok(!output.actions.some(a=>a&&/^(research|refinement|commission|productionMode|questClaim)/.test(a)));
  }
  const q=game.getView().quests.chapters[0];
  assert.ok(q.quests.every(item=>item.claimed));
  const output=render(game,320,524,{modal:{type:'quests',chapterId:q.id}});
  assert.ok(output.entries.some(e=>e.text==='已完成'));
});

test('real contract processing animates boxed and coated output without changing the economic snapshot',()=>{
  const game=contractFactory(),scene=new Renderer(canvas(390,844)).scene;game.acceptContract('gift');
  scene.syncView(game.getView());const observed=new Set();
  for(let i=0;i<1000&&!game.getView().order.ready;i++){
    game.tick(.1);for(const event of game.drainEvents())scene.emit(event,game.getView());
    scene.update(.1,game.getView());for(const unit of scene.units)observed.add(unit.kind);
    assert.ok(scene.units.length<=8);assert.ok(scene.particles.length<=72);
  }
  assert.ok(game.getView().order.ready);assert.ok(observed.has('packer'));assert.ok(observed.has('coating'));
  assert.equal(scene.packProgress,1);assert.equal(scene.coatingProgress,1);
  const save=JSON.stringify(game.exportSave(NOW));
  scene.draw(0,0,390,620,game.getView(),{topInset:80,bottomInset:100});
  assert.equal(JSON.stringify(game.exportSave(NOW)),save);
});
