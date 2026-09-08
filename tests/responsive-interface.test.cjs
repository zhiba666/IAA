'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {Game,CONFIG,formatNumber}=require('../src/core');
const {Renderer}=require('../src/renderer');
const {selectCurrentTarget}=require('../src/experience');

const NOW=1800000000000;
const VIEWPORTS=[[320,568],[360,800],[390,844],[430,932],[480,697],[480,920]];
// Full sheet combinations use one compact and one tall layout. Home and timing
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
  const game=new Game({now:NOW});
  Object.assign(game.state,{machine:1,orderIndex:6,totalProduced:60000,coins:1000,playedSeconds:120,taps:10,bursts:1,
    upgrades:{tap:3,auto:4,value:2},offline:{id:'offline:responsive',seconds:600,production:240,coins:300}},overrides);
  return game;
}

function render(game,width,height,ui={},beforeDraw=null) {
  const c=canvas(width,height),r=new Renderer(c),originalHit=r.hit;
  r.hit=function(x,y,w,h,action){originalHit.call(this,x,y,w,h,action);Object.assign(this.zones[this.zones.length-1],{paintSerial:c.serial(),screen:c.bounds(x,y,w,h)});};
  const view=game.getView(),state={viewport:{width,height},tab:'upgrades',isDouyin:false,adBusy:false,modal:null,toast:'',...ui};
  // Prime the active scene without painting a discarded frame into the geometry log.
  r.viewport=state.viewport;r.lastView=view;
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

test('burst settlement retains its visible lifetime while an acknowledgement or sheet covers it',()=>{
  const game=factory(),c=canvas(320,568),r=new Renderer(c);
  const ui={viewport:{width:320,height:568},modal:null,toast:'上一条操作提示',startup:false,adBusy:false};
  r.emit({type:'burst',amount:120,coins:240,perfect:true,bonusAmount:20});
  for(let i=0;i<80;i++)r.draw(game.getView(),ui,.05);
  assert.equal(r.notice.life,2.4,'hidden reward must not expire behind a toast');
  ui.toast='';ui.modal={type:'upgrades'};
  for(let i=0;i<60;i++)r.draw(game.getView(),ui,.05);
  assert.equal(r.notice.life,2.4,'management time must not consume reward display time');
  ui.modal=null;c.text.length=0;r.draw(game.getView(),ui,.05);
  assert.ok(c.text.some(entry=>entry.text.includes('火候额外 +20')),'actual bonus is drawn after returning');
  for(let i=0;i<49;i++)r.draw(game.getView(),ui,.05);
  assert.equal(r.notice,null,'settlement expires after its visible lifetime');
});

test('late growth and learning sheets fit compact safe-area viewports and expose exact purchase quotes',()=>{
  for(const [width,height] of [[320,524],[320,568],[390,844]]){
    const game=factory({machine:4,orderIndex:14,totalProduced:64000000,coins:1e10,upgrades:{tap:24,auto:24,value:24},offline:null});
    for(const type of ['refinements','heatLesson','productionModes']){
      const output=render(game,width,height,{modal:{type,advice:type==='productionModes'?{modeId:'rush',bottleneck:'production'}:undefined}});
      checkLayout(output,type+' safe-area '+height);
      if(type==='refinements')for(const item of game.getView().refinements.options){
        assert.ok(output.actions.includes('refinement:'+item.key+':'+item.level+':'+item.cost));
      }
    }
    const upgrades=render(game,width,height,{modal:{type:'upgrades'}});checkLayout(upgrades,'late upgrade entry');
    assert.ok(upgrades.actions.includes('refinements'));
    const learning=render(game,width,height);checkLayout(learning,'first heat lesson');
  }
});

for(const [width,height] of VIEWPORTS) {
  test(`responsive ${width}×${height}: fresh, affordable, boosted and final factories keep readable controls`,()=>{
    const cases=[new Game({now:NOW}),factory(),factory({boostSeconds:90}),factory({machine:5,orderIndex:20,totalProduced:2e9,coins:1e12,upgrades:{tap:24,auto:24,value:24}})];
    for(const [index,game] of cases.entries()) {
      const output=render(game,width,height);checkLayout(output,'home '+index);
      for(const action of ['tap','upgrades','order','quests','workshop'])assert.ok(output.actions.includes(action));
      assert.ok(!output.actions.includes('settings'),'settings live inside the factory sheet');
      assert.ok(!output.entries.some(e=>e.text==='小小爆米花厂'),'the startup title does not reserve a row during production');
      const target=selectCurrentTarget(output.view,output.ui);
      assert.deepEqual(output.r.currentTarget,target);assert.equal(output.r.guideAction,target.action);
      const expanded=!!output.view.tutorial;
      assert.ok(output.actions.includes(expanded?'goalCollapse':'goalExpand'));
      assert.equal(!!output.r.interface.visibleTarget,expanded);
      if(expanded)assert.ok(output.entries.some(e=>e.text===target.title||e.text.endsWith('…')&&target.title.startsWith(e.text.slice(0,-1))),'the expanded current target title must be visible');
      const income=output.view.production.auto*output.view.production.price;
      const incomeText='自动 +'+(income>0&&income<10?Number(income.toFixed(2)).toString():formatNumber(income))+' /秒';
      const wallet=[output.entries.find(e=>e.text===formatNumber(game.state.coins)),output.entries.find(e=>e.text===incomeText)];
      assert.ok(wallet.every(Boolean),'the floating wallet keeps both the current balance and actual income visible');
      for(const entry of wallet){
        for(const dx of [1,entry.w/2,entry.w-1])assert.equal(output.r.actionAt(entry.x+dx,entry.y+entry.h/2),null,'reading balances must never trigger production or another action');
      }
    }
  });
}

for(const [width,height] of SHEET_VIEWPORTS) {
  test(`responsive ${width}×${height}: main sheets keep controls and copy separate`,async t=>{
    for(const type of ['upgrades','workshop','machine','order','offline','brand','turbo','settings','stats','help','privacy','health','completion'])await t.test(type,()=>{
      const output=render(factory(),width,height,{modal:{type}});checkLayout(output,type);
      assert.ok(output.actions.includes('close'),'sheets must permit returning to production');
      assert.ok(!output.actions.includes('tap'),'modal input must not leak to the production bay');
      if(type==='workshop')assert.ok(output.actions.includes('settings'),'settings remain reachable through the factory');
    });
    for(const page of [0,1])await t.test('blueprint page '+page,()=>checkLayout(render(factory(),width,height,{modal:{type:'blueprint',page}}),'blueprint page '+page));
  });

  test(`responsive ${width}×${height}: each quest chapter is reachable with compact pagination`,()=>{
    const game=factory();
    for(const chapter of game.getView().quests.chapters) {
      const pages=height<760?[0,1]:[0],visibleIds=[];
      for(const page of pages) {
        const output=render(game,width,height,{modal:{type:'quests',chapterId:chapter.id,page}});checkLayout(output,'quests '+chapter.id+' page '+page);
        for(const quest of chapter.quests)if(output.entries.some(e=>e.text===quest.title))visibleIds.push(quest.id);
        for(const other of game.getView().quests.chapters)assert.ok(output.actions.includes('questChapter:'+other.id));
        if(height<760)assert.ok(output.actions.includes('questPage:'+(page?0:1)),'the other page must be reachable');
      }
      assert.deepEqual(visibleIds,chapter.quests.map(q=>q.id),'all four quests must be visible across the available pages');
    }
  });

  test(`responsive ${width}×${height}: all five reward confirmations work in browser and native modes`,async t=>{
    for(const kind of ['turbo','order','sponsor','offline','brand'])for(const isDouyin of [false,true])await t.test(kind+(isDouyin?' native':' browser'),()=>{
      const game=factory(),quote=game.quoteReward(kind);assert.ok(quote,kind+' fixture must produce a real authorized quote');
      const output=render(game,width,height,{isDouyin,modal:{type:'reward',quote}});checkLayout(output,'reward '+kind);
      assert.ok(output.actions.includes(isDouyin?'watch':'simulate:complete'));
      if(!isDouyin)for(const action of ['simulate:cancel','simulate:fail'])assert.ok(output.actions.includes(action));
      const busy=render(game,width,height,{isDouyin,adBusy:true,modal:{type:'reward',quote}});assert.deepEqual(busy.actions,[],'pending playback must prevent duplicate submissions');
    });
  });

  test(`responsive ${width}×${height}: normal collection and optional ads have equal-sized controls`,()=>{
    for(const [type,normal,ad] of [['order','claimOrder','ad:order'],['offline','claimOffline','ad:offline']]) {
      const output=render(factory(),width,height,{modal:{type}}),direct=output.r.zones.find(z=>z.action===normal),rewarded=output.r.zones.find(z=>z.action===ad);
      assert.ok(direct&&rewarded,'both collection choices must be available');
      assert.equal(direct.screen.x,rewarded.screen.x);assert.equal(direct.screen.w,rewarded.screen.w);
      assert.equal(direct.screen.h,rewarded.screen.h,'the ad option must not get a larger touch target');
    }
  });

  test(`responsive ${width}×${height}: completed main orders show the actual loop order number`,()=>{
    for(const loopIndex of [0,4]) {
      const output=render(factory({machine:5,orderIndex:20,loopIndex,totalProduced:2e10}),width,height,{modal:{type:'order'}});
      checkLayout(output,'loop order '+loopIndex);
      assert.ok(output.entries.some(entry=>entry.text==='循环订单 '+(loopIndex+1)));
      assert.ok(!output.entries.some(entry=>/订单\s*21\s*\/\s*20/.test(entry.text)));
    }
  });
}

// These live-interface checks replace the former quest/brand legacy suites.
// Accounting, persistence and reward eligibility remain in their core tests.
test('responsive brand details preserve eligibility and show actual permanent income before confirmation',()=>{
  const shown=n=>n>0&&n<10?Number(n.toFixed(2)).toString():formatNumber(n);
  for(const [state,available] of [
    [{machine:0},false], [{playedSeconds:CONFIG.rewardUnlockSeconds-1},false],
    [{brandLevel:2},false], [{machine:5,brandLevel:CONFIG.brandMaxLevel},false],
    [{brandLevel:1,boostSeconds:90},true]
  ]) {
    const game=factory(state),brand=game.getView().brand;
    const output=render(game,320,568,{modal:{type:'brand'}});checkLayout(output,'brand eligibility');
    assert.ok(output.actions.includes('close'));
    assert.equal(output.actions.includes('ad:brand'),available);
    if(!available)continue;
    const text=output.entries.map(e=>e.text).join('\n');
    assert.ok(text.includes(`自动 ${shown(brand.baseIncomeBefore)} → ${shown(brand.baseIncomeAfter)} 金币/秒`));
    const quote=game.quoteReward('brand'),impact=game.getView().rewards.brand.impact;
    const confirmation=render(game,320,568,{modal:{type:'reward',quote}});checkLayout(confirmation,'brand confirmation');
    assert.ok(confirmation.entries.some(e=>e.text===impact.title));
    assert.doesNotMatch(confirmation.entries.map(e=>e.text).join('\n'),/奖励 \+1 金币|额外 \+1 金币/);
  }
});

test('responsive quests switch from navigation to one-time claims and keep reviewed or locked chapters inactive',()=>{
  const fresh=new Game({now:NOW}),chapters=fresh.getView().quests.chapters;
  const drawChapter=(game,chapterId)=>{
    const output=render(game,390,844,{modal:{type:'quests',chapterId}});
    checkLayout(output,'quest state');
    assert.ok(output.actions.includes('close'));assert.ok(!output.actions.includes('tap'));
    return output;
  };
  const first=chapters[0],initial=drawChapter(fresh,first.id);
  for(const quest of first.quests)assert.ok(initial.actions.includes('questGo:'+quest.id));
  const game=factory({machine:5,orderIndex:20,totalProduced:2e9,taps:50,upgrades:{tap:1,auto:4,value:6}});
  const ready=drawChapter(game,first.id);
  for(const quest of first.quests)assert.ok(ready.actions.includes('questClaim:'+quest.id));
  assert.ok(game.claimQuest(first.quests[0].id).ok);
  const claimed=drawChapter(game,first.id);
  assert.ok(!claimed.actions.includes('questClaim:'+first.quests[0].id));
  assert.ok(!claimed.actions.includes('questGo:'+first.quests[0].id));
  for(const quest of first.quests.slice(1)) {
    assert.ok(claimed.actions.includes('questClaim:'+quest.id));assert.ok(game.claimQuest(quest.id).ok);
  }
  assert.equal(game.getView().quests.activeChapterId,chapters[1].id);
  for(const chapter of [first,chapters[3]]) {
    const output=drawChapter(game,chapter.id);
    assert.ok(!output.actions.some(action=>/^quest(?:Claim|Go):/.test(action)));
    assert.ok(output.entries.some(e=>e.text===chapter.quests[0].title),'review stays on the selected chapter');
  }
});

test('responsive quest pagination keeps the formerly cramped 700px viewport accessible',()=>{
  const game=factory(),chapter=game.getView().quests.chapters[0];
  for(const page of [0,1]) {
    const output=render(game,360,700,{modal:{type:'quests',chapterId:chapter.id,page}});checkLayout(output,'700px quests page '+page);
    assert.ok(output.actions.includes('questPage:'+(page?0:1)));
    assert.equal(chapter.quests.filter(quest=>output.entries.some(entry=>entry.text===quest.title)).length,2);
  }
});

test('responsive target copy, highlighted action and tracked quest stay in sync as readiness changes',()=>{
  const game=new Game({now:NOW});game.state.coins=100;
  const ui={questGuideId:'start-tap-upgrade',goalExpanded:true};
  let output=render(game,320,568,ui);
  assert.equal(output.r.currentTarget.id,'start-tap-upgrade');assert.equal(output.r.guideAction,'upgrade:tap');
  assert.ok(output.actions.includes('upgrade:tap'));
  assert.ok(output.entries.some(e=>e.text==='好玉米，更饱满'));
  assert.equal(actionOnText(output,output.r.currentTarget.title),'target','the expanded goal title opens its current objective');
  assert.ok(game.buyUpgrade('tap').ok);output=render(game,320,568,ui);
  assert.equal(output.r.currentTarget.action,'questClaim:start-tap-upgrade');
  assert.equal(output.r.guideAction,'questClaim:start-tap-upgrade');
  assert.ok(output.entries.some(e=>e.text.includes('目标已达成')));
  assert.ok(game.claimQuest('start-tap-upgrade').ok);output=render(game,320,568,ui);
  assert.notEqual(output.r.currentTarget.id,'start-tap-upgrade','claimed quests must stop driving the current target');
});

test('responsive timing controls stay in place across unlock and disabled input never produces',()=>{
  for(const [width,height] of VIEWPORTS) {
    let originalControls;
    for(const state of ['locked','waiting','ready','perfect','missed','armed']) {
      const game=factory({bursts:state==='locked'?0:1,energy:state==='waiting'?40:['perfect','armed'].includes(state)?94:84});
      if(state==='missed'||state==='armed')assert.equal(game.tryPerfectBurst().ok,true);
      const output=render(game,width,height,{goalExpanded:false});checkLayout(output,`timing ${width} ${state}`);
      const timing=output.r.zones.find(z=>z.action==='timing'||z.action===null);
      const production=output.r.zones.filter(z=>z.action==='tap');
      const bay=production[0];
      assert.equal(production.length,1,'the machine is the only production control outside teaching recommendations');
      assert.ok(timing&&bay,'the machine and timing retain separate input regions');
      const geometry=z=>({x:z.x,y:z.y,w:z.w,h:z.h});
      const controls={bay:geometry(bay),timing:geometry(timing)};
      if(originalControls)assert.deepEqual(controls,originalControls,'unlock and attempt states must not move the controls');
      else originalControls=controls;
      assert.ok(bay.y+bay.h<timing.y,'the machine ends before the timing dock with a real gap');
      const action=['ready','perfect'].includes(state)?'timing':null;
      for(const [dx,dy] of [[1,1],[timing.w-1,1],[1,timing.h-1],[timing.w-1,timing.h-1],[timing.w/2,timing.h/2]]) {
        assert.equal(output.r.actionAt(timing.x+dx,timing.y+dy),action,`${state}: timing must not fall through to production`);
      }
      for(const [dx,dy] of [[1,1],[bay.w-1,1],[1,bay.h-1],[bay.w-1,bay.h-1],[bay.w/2,bay.h/2]]) {
        assert.equal(output.r.actionAt(bay.x+dx,bay.y+dy),'tap','machine edges and the lower thumb area must keep producing');
      }
      assert.equal(output.r.actionAt(timing.x+timing.w/2,bay.y+bay.h+1),null,'the separation below the machine must not produce or ignite');
    }
  }
});

test('responsive heat guidance shows representative states despite rounded energy on the smallest screen',()=>{
  // Exact threshold pairs live in heat-guide.test.cjs. Here check that the UI
  // renders each actionable state, including values rounded across a boundary.
  const cases=[[79.99,'正在升温','等待升温',false],[91.99,'末段火候','尝试点火',true],
    [94,'最佳火候 · 现在点火','现在点火',true],[98.01,'已过最佳火候','尝试点火',true]];
  const [width,height]=VIEWPORTS[0];
  for(const [energy,title,button,available] of cases) {
    const output=render(factory({energy}),width,height);checkLayout(output,`heat ${width} ${energy}`);
    assert.ok(output.entries.some(e=>e.text.startsWith(title)),`${energy}: show the actual heat state`);
    assert.ok(output.entries.some(e=>e.text===button));
    assert.equal(output.actions.includes('timing'),available);
    assert.equal(output.entries.some(e=>e.text==='最佳火候 · 现在点火'),energy>=92&&energy<=98);
  }
});

test('responsive order progress describes the current milestone and preserves overproduction through claims',()=>{
  for(const [width,height] of VIEWPORTS) {
    const game=factory({orderIndex:1,totalProduced:80});
    assert.equal(game.getView().order.progress,.4);assert.equal(game.getView().order.stageProgress,.2);
    const assertProgress=(percent,ready=false)=>{
      const home=render(game,width,height),sheet=render(game,width,height,{modal:{type:'order'}});
      checkLayout(home,'order progress home');checkLayout(sheet,'order progress sheet');
      assert.ok(home.entries.some(e=>e.text===(ready?'本单达标 · 领金币':`本单 ${percent}%  ›`)));
      assert.ok(sheet.entries.some(e=>e.text===(ready?'已达标':percent+'%')));
      assert.equal(sheet.actions.includes('claimOrder'),ready);
      const orderChip=home.r.zones.find(z=>z.action==='order'&&z.y<height/2);
      assert.ok(orderChip);assert.equal(home.r.actionAt(orderChip.x+orderChip.w/2,orderChip.y+orderChip.h/2),'order');
    };
    assertProgress(20);
    game.state.orderIndex=0;game.state.totalProduced=500;
    assertProgress(100,true);assert.ok(game.claimOrder().ok);
    assert.equal(game.state.totalProduced,500);assertProgress(100,true);
    assert.ok(game.claimOrder().ok);assert.equal(game.state.totalProduced,500);assertProgress(50);
    // A rounded 100% must not imply that an unfinished order is claimable.
    game.state.totalProduced=CONFIG.orders[2].target-.01;assertProgress(99);
    game.state.orderIndex=19;
    const lastTarget=CONFIG.orders[19].target;
    game.state.totalProduced=lastTarget*1.175;
    assert.ok(game.claimOrder().ok);assert.equal(game.getView().order.isLoop,true);
    assertProgress(50);
    const loopSheet=render(game,width,height,{modal:{type:'order'}});
    assert.ok(loopSheet.entries.some(e=>e.text==='循环订单 1'));
  }
});

test('responsive production feedback shows real payouts, lets action confirmations take priority and expires without blocking controls',()=>{
  const shown=n=>n>0&&n<10?Number(n.toFixed(2)).toString():formatNumber(n);
  for(const [width,height] of VIEWPORTS)for(const toast of ['', '订单奖励已到账']) {
    const game=factory({energy:94}),normalGame=factory({energy:94});
    assert.ok(game.tryPerfectBurst().perfect);game.tick(6);normalGame.tick(6);
    const perfect=game.drainEvents().find(e=>e.type==='burst'),normal=normalGame.drainEvents().find(e=>e.type==='burst');
    assert.ok(perfect&&normal&&perfect.bonusAmount>0);
    const base=render(game,width,height,{toast});
    const output=render(game,width,height,{toast},r=>{r.emit(normal);r.emit(perfect);});
    checkLayout(output,`perfect notice ${width} ${toast}`);
    assert.deepEqual(output.actions,base.actions,'feedback must not add or remove any gameplay control');
    assert.equal(output.r.notice.title,`完美爆锅 +${shown(perfect.amount)} 份`);
    assert.equal(output.r.notice.bonusText,`火候额外 +${shown(perfect.bonusAmount)} 份`,'the bonus is the real event amount');
    assert.equal(output.entries.some(e=>e.text===output.r.notice.title),!toast,'an action confirmation temporarily takes priority over the burst notice');
    assert.equal(output.entries.some(e=>e.text===output.r.notice.bonusText),!toast);
    if(toast){
      const confirmation=output.entries.find(e=>e.text===toast);
      assert.ok(confirmation,'the action confirmation must be visible');
      assert.equal(output.r.actionAt(confirmation.x+confirmation.w/2,confirmation.y+confirmation.h/2),'tap','transient confirmations must not block the machine');
      assert.ok(output.entries.some(e=>e.text.startsWith('点机器 · 每次 +')),'action confirmations leave the production hint readable');
    }
    assert.ok(!output.entries.some(e=>e.text.startsWith('免费爆锅 +')));
    const ordinary=render(game,width,height,{toast},r=>{r.emit(perfect);r.emit(normal);});
    checkLayout(ordinary,`normal notice ${width} ${toast}`);
    assert.equal(ordinary.r.notice.perfect,false);assert.equal(ordinary.r.notice.bonusText,'');
    assert.equal(ordinary.r.notice.title,`免费爆锅 +${shown(normal.amount)} 份`);
    assert.equal(ordinary.r.notice.text,`自动售出 +${shown(normal.coins)} 金币`);
    assert.equal(ordinary.entries.some(e=>e.text===ordinary.r.notice.title),!toast);
    assert.equal(ordinary.entries.some(e=>e.text===ordinary.r.notice.text),!toast);
    assert.ok(!ordinary.entries.some(e=>/完美爆锅|火候额外/.test(e.text)));
    const expired=render(game,width,height,{toast},r=>{r.emit(perfect);r.update(3);});
    checkLayout(expired,`expired notice ${width} ${toast}`);
    assert.equal(expired.r.notice,null);assert.deepEqual(expired.actions,base.actions);
    assert.ok(!expired.entries.some(e=>/完美爆锅|火候额外/.test(e.text)));
  }
});

test('responsive reward confirmation renders its frozen preview as the factory keeps producing',()=>{
  const game=factory(),impact=JSON.parse(JSON.stringify(game.getView().rewards.sponsor.impact)),quote=game.quoteReward('sponsor');
  assert.ok(quote);game.tick(30);
  assert.notEqual(game.getView().rewards.sponsor.impact.title,impact.title,'passive production must change the live comparison');
  const output=render(game,390,844,{modal:{type:'reward',quote,impact}});
  assert.ok(output.entries.some(entry=>entry.text===impact.title),'confirmation must retain the offered preview');
  assert.ok(!output.entries.some(entry=>entry.text===game.getView().rewards.sponsor.impact.title));
});


test('responsive next step follows the selected task through purchase and reward, including saving for that upgrade',()=>{
  for(const [width,height] of VIEWPORTS){
    const game=new Game({now:NOW}),ui={questGuideId:'start-tap-upgrade',goalExpanded:true};game.state.coins=100;
    let output=render(game,width,height,ui);checkLayout(output,'tracked upgrade');
    assert.equal(output.r.interface.recommendation.action,'upgrade:tap');
    assert.equal(actionOnText(output,output.r.interface.recommendation.buttonLabel),'upgrade:tap');
    assert.ok(game.buyUpgrade('tap').ok);output=render(game,width,height,ui);checkLayout(output,'tracked reward');
    assert.equal(output.r.interface.recommendation.action,'questClaim:start-tap-upgrade');
    assert.equal(actionOnText(output,output.r.interface.recommendation.buttonLabel),'questClaim:start-tap-upgrade');
    assert.ok(!output.actions.some(action=>action&&action.startsWith('upgrade:')),'an earned reward must not be replaced by a cheap purchase');
    const waiting=new Game({now:NOW});waiting.state.taps=5;waiting.state.claimedQuests=['start-taps','start-tap-upgrade'];waiting.state.upgrades.tap=1;waiting.state.coins=17;
    output=render(waiting,width,height);checkLayout(output,'tutorial saving');
    assert.equal(output.r.currentTarget.upgradeKey,'auto');
    assert.equal(output.r.interface.recommendation.upgradeKey,'auto');
    assert.equal(output.r.interface.recommendation.enabled,false);
    assert.equal(actionOnText(output,output.r.interface.recommendation.buttonLabel),null);
  }
});

function nextStepFactory(overrides={}){
  const game=new Game({now:NOW});game.state.claimedQuests=game.getView().quests.chapters.flatMap(c=>c.quests.map(q=>q.id));
  Object.assign(game.state,{taps:5,bursts:1,orderIndex:3,totalProduced:800,coins:1000,upgrades:{tap:1,auto:4,value:1}},overrides);
  return game;
}

test('responsive next step distinguishes useful investment, preserving funds, ready actions and finished upgrades',()=>{
  for(const [width,height] of VIEWPORTS){
    const cases=[
      [nextStepFactory({coins:1000}),'upgrade','upgrade:auto'],
      [nextStepFactory({coins:29500}),'upgrade','upgrade:value'],
      [nextStepFactory({coins:29900}),'save','machine'],
      [nextStepFactory({coins:30000}),'machine','machine'],
      [nextStepFactory({coins:30000,orderIndex:2,totalProduced:200}),'order','order'],
      [nextStepFactory({orderIndex:0,totalProduced:50}),'order','order'],
      [nextStepFactory({machine:5,orderIndex:20,totalProduced:2e9,coins:1e12,upgrades:{tap:24,auto:24,value:24},refinements:{yield:3,value:3},learning:{heatRecoveryUses:10,heatRecoveryDismissed:false}}),'souvenir','souvenirs']
    ];
    for(const [game,kind,action] of cases){
      const saved=JSON.stringify(game.exportSave(NOW));
      const output=render(game,width,height,{goalExpanded:true,suppressModeAdvice:true});checkLayout(output,'next step '+kind);
      const step=output.r.interface.recommendation;
      assert.equal(step.kind,kind);assert.equal(step.action,action);assert.equal(step.enabled,true);
      assert.equal(actionOnText(output,step.buttonLabel),action,'the expanded action must match its displayed suggestion');
      assert.ok(output.entries.some(e=>e.text===step.buttonLabel));
      const detail=step.enabled?step.detail:step.reason;
      assert.ok(output.entries.some(e=>e.text===detail||e.text.endsWith('…')&&detail.startsWith(e.text.slice(0,-1))),'the shared card retains the next step benefit or gap');
      if(kind!=='upgrade')assert.ok(!output.actions.some(a=>a&&a.startsWith('upgrade:')),'saving or claiming must not promote a purchase');
      assert.equal(JSON.stringify(game.exportSave(NOW)),saved,'rendering recommendations cannot mutate the save');
      for(const action of ['tap','upgrades','order','quests','workshop'])assert.ok(output.actions.includes(action));
    }
  }
});

test('responsive target and recommendation exposure only describe an expanded visible goal',()=>{
  const game=nextStepFactory();
  for(const ui of [{goalExpanded:false},{goalExpanded:true,startup:true},{goalExpanded:true,modal:{type:'upgrades'}},{goalExpanded:true,modal:{type:'order'},adBusy:true}]){
    const output=render(game,320,568,ui);checkLayout(output,'hidden recommendation');
    assert.equal(output.r.interface.recommendation,null);
    assert.equal(output.r.interface.visibleTarget,null);
  }
  const expanded=render(game,320,568,{goalExpanded:true});
  assert.ok(expanded.r.interface.recommendation);
  assert.deepEqual(expanded.r.interface.visibleTarget,selectCurrentTarget(expanded.view,expanded.ui));
});


test('home floats one collapsible goal over the scene and keeps production clear of every control',()=>{
  const games=[new Game({now:NOW}),factory(),factory({machine:2}),factory({machine:5,coins:1e12,orderIndex:20,totalProduced:2e9})];
  for(const [width,height] of VIEWPORTS){
    let sceneGeometry;
    for(const goalExpanded of [false,true]){
      let controls;
      for(const game of games){
        let scene;
        const saved=JSON.stringify(game.exportSave(NOW));
        const output=render(game,width,height,{goalExpanded},r=>{
          const draw=r.scene.draw;r.scene.draw=function(x,y,w,h,...rest){scene={x,y,w,h};return draw.call(this,x,y,w,h,...rest);};
        });
        checkLayout(output,'side goal '+goalExpanded);
        assert.ok(scene.h>height*.85,'removing the header and bottom goal gives the factory most of the screen');
        assert.ok(scene.y<height*.03,'production begins near the safe content edge');
        if(sceneGeometry)assert.deepEqual(scene,sceneGeometry,'opening a goal never resizes or narrows the scene');else sceneGeometry=scene;
        const goals=output.r.zones.filter(zone=>zone.action==='target');
        assert.equal(goals.length,goalExpanded?1:0,'only an expanded goal exposes its full target action');
        const toggle=output.r.zones.find(zone=>zone.action===(goalExpanded?'goalCollapse':'goalExpand'));
        assert.ok(toggle&&toggle.y<height*.3,'goal navigation occupies the upper scene instead of a bottom row');
        assert.equal(output.r.actionAt(toggle.x+toggle.w/2,toggle.y+toggle.h/2),toggle.action);
        const bay=output.r.zones.filter(zone=>zone.action==='tap').sort((a,b)=>b.h-a.h)[0];
        assert.ok(bay&&bay.h>=100,'even expanded teaching leaves a useful machine and thumb production area');
        for(const control of output.r.zones.filter(zone=>zone!==bay)){
          const overlap=intersect(bay,control);
          assert.equal(overlap.w*overlap.h,0,'production must not overlap '+control.action);
        }
        const nav=output.r.zones.find(zone=>zone.action==='upgrades');
        assert.ok(scene.y+scene.h<=nav.y&&nav.y-(scene.y+scene.h)<20,'only a small gap separates scene and fixed bottom navigation');
        const relevant=[bay,...output.r.zones.filter(z=>['timing','upgrades','workshop'].includes(z.action)||z.action===null)].map(({x,y,w,h})=>({x,y,w,h}));
        if(controls)assert.deepEqual(relevant,controls,'goal readiness and mode unlock do not move production or navigation');else controls=relevant;
        assert.equal(JSON.stringify(game.exportSave(NOW)),saved);
      }
    }
  }
  for(const height of [649,650]){
    const output=render(factory(),320,height,{goalExpanded:true});checkLayout(output,'side-goal threshold '+height);
    const target=output.r.zones.find(z=>z.action==='target'),bay=output.r.zones.find(z=>z.action==='tap');
    assert.ok(target&&target.y+target.h<=bay.y,'the formerly compact threshold keeps expanded guidance above production');
  }
});

test('goal defaults teach new players and preserve an explicit choice without exposing hidden purchases',()=>{
  for(const game of [new Game({now:NOW}),nextStepFactory()]){
    const view=game.getView(),fresh=!!view.tutorial;
    const initial=render(game,480,697);
    assert.equal(initial.r.interface.isGoalExpanded(view,{}),fresh);
    const hidden=render(game,480,697,{goalExpanded:false});
    assert.equal(hidden.r.interface.isGoalExpanded(view,{goalExpanded:false}),false);
    assert.ok(hidden.actions.includes('goalExpand'));
    assert.ok(!hidden.actions.includes('target'));
    assert.ok(!hidden.actions.some(action=>action&&/^(upgrade:|questClaim:)/.test(action)),'opening a collapsed goal cannot spend or claim');
    const shown=render(game,480,697,{goalExpanded:true});
    assert.equal(shown.r.interface.isGoalExpanded(view,{goalExpanded:true}),true);
    assert.ok(shown.actions.includes('goalCollapse'));
    assert.ok(shown.r.interface.recommendation);
  }
});

test('production modes show real current-to-option comparisons and reachable entries without intercepting production',()=>{
  const shown=n=>n>0&&n<10?Number(n.toFixed(2)).toString():formatNumber(n);
  for(const [width,height] of VIEWPORTS){
    const locked=render(factory({machine:1}),width,height);
    assert.ok(!locked.actions.includes('productionModes'));
    const lockedSheet=render(factory({machine:1}),width,height,{modal:{type:'productionModes'}});checkLayout(lockedSheet,'locked modes');
    assert.ok(!lockedSheet.actions.some(action=>action&&action.startsWith('productionMode:')));
    const game=factory({machine:2,boostSeconds:90});
    for(const id of ['balanced','rush','premium']){
      assert.ok(game.setProductionMode(id).ok);
      const view=game.getView(),current=view.productionModes.options.find(mode=>mode.id===id);
      const home=render(game,width,height);checkLayout(home,'mode home '+id);
      assert.ok(home.entries.some(entry=>entry.text.startsWith(current.name))&&home.entries.some(entry=>entry.text.includes('增压')),'mode and active turbo remain visible together');
      const entrance=home.r.zones.find(zone=>zone.action==='productionModes');
      assert.ok(entrance);assert.equal(entrance.h,44);assert.equal(home.r.actionAt(entrance.x+entrance.w/2,entrance.y+entrance.h/2),'productionModes');
      const saved=JSON.stringify(game.exportSave(NOW));
      const sheet=render(game,width,height,{modal:{type:'productionModes'}});checkLayout(sheet,'production modes '+id);
      assert.ok(!sheet.actions.includes('tap'));
      for(const option of view.productionModes.options){
        assert.equal(sheet.actions.includes('productionMode:'+option.id),!option.selected);
        assert.ok(sheet.entries.some(entry=>entry.text==='产量 '+shown(current.preview.baseAuto)+' → '+shown(option.preview.baseAuto)+' 份/秒'));
        assert.ok(sheet.entries.some(entry=>entry.text==='收入 '+shown(current.preview.baseIncome)+' → '+shown(option.preview.baseIncome)+' 金币/秒'));
      }
      const copy=sheet.entries.map(entry=>entry.text).join('');
      assert.match(copy,/收入 -4%/);assert.match(copy,/产量 -20%/);assert.match(copy,/点击、爆锅也按档位/);assert.match(copy,/离线按离开时档位/);
      assert.equal(JSON.stringify(game.exportSave(NOW)),saved,'comparison must not switch modes or change stored rewards');
      const workshop=render(game,width,height,{modal:{type:'workshop'}});checkLayout(workshop,'unlocked workshop');
      assert.ok(workshop.actions.includes('productionModes'));assert.ok(workshop.actions.includes('stats'));assert.ok(workshop.actions.includes('close'));
    }
  }
});

test('offline summary shows pending production, ordinary-claim order progress and the next useful action',()=>{
  for(const [width,height] of SHEET_VIEWPORTS)for(const [production,percent,ready] of [[30,40,false],[120,100,true]]){
    const game=factory({orderIndex:1,totalProduced:80,offline:{id:'offline:summary',seconds:600,production,coins:300}});
    const saved=JSON.stringify(game.exportSave(NOW));
    const output=render(game,width,height,{modal:{type:'offline'}});checkLayout(output,'offline next action');
    assert.ok(output.entries.some(entry=>entry.text==='生产 +'+production+' 份'));
    assert.ok(output.entries.some(entry=>entry.text==='领取后本单 20% → '+percent+'%'));
    assert.equal(output.entries.some(entry=>entry.text==='本单达标，可领取订单奖励'),ready);
    if(ready)assert.ok(output.entries.some(entry=>entry.text==='领取后可装车'));
    const copy=output.entries.map(entry=>entry.text).join('');
    assert.match(copy,/广告只翻倍金币/);
    assert.equal(JSON.stringify(game.exportSave(NOW)),saved,'reading the offline summary never claims it');
  }
});

test('brand clearly distinguishes cumulative percentage points from real permanent production',()=>{
  const shown=n=>n>0&&n<10?Number(n.toFixed(2)).toString():formatNumber(n);
  for(const [width,height] of SHEET_VIEWPORTS){
    const game=factory({machine:5,brandLevel:5,productionMode:'premium',boostSeconds:90}),brand=game.getView().brand;
    const output=render(game,width,height,{modal:{type:'brand'}});checkLayout(output,'brand percentage points');
    assert.ok(output.entries.some(entry=>entry.text==='+100% → +120%'));
    assert.ok(output.entries.some(entry=>entry.text==='永久产量 '+shown(brand.baseAutoBefore)+' → '+shown(brand.baseAutoAfter)+' 份/秒'));
    assert.match(output.entries.map(entry=>entry.text).join(''),/每级增加 20 个百分点/);
    assert.ok(Math.abs(brand.baseAutoAfter/brand.baseAutoBefore-1.1)<1e-12,'cumulative +100% to +120% is a 10% relative output gain');
    assert.ok(output.actions.includes('ad:brand'));
  }
});


test('bulk upgrades show actual partial counts, total costs and exact bounded purchase actions',()=>{
  const shown=n=>n>0&&n<10?Number(n.toFixed(2)).toString():formatNumber(n);
  for(const [width,height] of VIEWPORTS){
    const game=factory({machine:3,coins:1e14,upgrades:{tap:19,auto:21,value:23}}),view=game.getView();
    assert.deepEqual(view.upgrades.map(upgrade=>upgrade.bulk.count),[5,3,1]);
    const saved=JSON.stringify(game.exportSave(NOW));
    const output=render(game,width,height,{modal:{type:'upgrades',quantity:5}});checkLayout(output,'bulk partial counts');
    assert.ok(!output.actions.some(action=>action&&action.startsWith('upgrade:')),'bulk mode must not silently use a single-level purchase');
    for(const action of ['upgradeQuantity:1','upgradeQuantity:5']){
      const zone=output.r.zones.find(zone=>zone.action===action);assert.ok(zone);assert.equal(zone.h,44);
    }
    for(const upgrade of view.upgrades){
      const b=upgrade.bulk,action='upgradeBatch:'+upgrade.key+':'+b.fromLevel+':'+b.count+':'+b.cost;
      const zone=output.r.zones.find(zone=>zone.action===action);assert.ok(zone);assert.equal(zone.h,44);
      for(const [dx,dy] of [[1,1],[zone.w-1,1],[1,zone.h-1],[zone.w-1,zone.h-1]])assert.equal(output.r.actionAt(zone.x+dx,zone.y+dy),action,'corners use the displayed quote');
      assert.ok(output.entries.some(entry=>entry.text===upgrade.name+' · '+b.fromLevel+' → '+b.toLevel+'级'));
      assert.ok(output.entries.some(entry=>entry.text==='升级 '+b.count+'级'));
      assert.ok(output.entries.some(entry=>entry.text==='合计 '+formatNumber(b.cost)+' 金币'));
      assert.ok(output.entries.some(entry=>entry.text===shown(b.preview.before)+' → '+shown(b.preview.after)+' '+b.preview.unit));
    }
    assert.equal(JSON.stringify(game.exportSave(NOW)),saved,'drawing a quote must not buy or change the selected quantity');
    const single=render(game,width,height,{modal:{type:'upgrades'}});checkLayout(single,'single by default');
    assert.ok(single.actions.includes('upgrade:tap'));assert.ok(!single.actions.some(action=>action&&action.startsWith('upgradeBatch:')));
    const home=render(game,width,height);checkLayout(home,'bulk unlocked home');
    assert.ok(!home.actions.some(action=>action&&action.startsWith('upgradeBatch:')),'home stays single-level regardless of the bulk milestone');
  }
});

test('bulk upgrade zero-count states explain money, level caps and protected machine funds without live buy targets',()=>{
  for(const [width,height] of SHEET_VIEWPORTS){
    const nextCost=CONFIG.machines[4].cost;
    for(const [state,reason] of [
      [{coins:0},'金币不足，继续生产'],
      [{coins:nextCost},'已预留换代资金'],
      [{coins:1e14,upgrades:{tap:24,auto:24,value:24}},'已达到最高等级']
    ]){
      const game=factory({machine:3,...state}),output=render(game,width,height,{modal:{type:'upgrades',quantity:5}});
      checkLayout(output,'bulk disabled '+reason);
      assert.ok(game.getView().upgrades.every(upgrade=>upgrade.bulk.count===0));
      assert.ok(!output.actions.some(action=>action&&action.startsWith('upgradeBatch:')));
      assert.ok(output.entries.some(entry=>entry.text===reason));
      assert.ok(output.actions.includes('upgradeQuantity:1'));assert.ok(output.actions.includes('close'));
      if(state.coins===nextCost){
        const manual=render(game,width,height,{modal:{type:'upgrades',quantity:1}});checkLayout(manual,'manual protected funds');
        assert.ok(manual.actions.includes('upgrade:tap'),'single-level manual spending remains possible');
        assert.match(manual.entries.map(entry=>entry.text).join(''),/不预留换代资金/);
      }
    }
    const locked=render(factory({machine:2}),width,height,{modal:{type:'upgrades',quantity:5}});checkLayout(locked,'bulk locked');
    assert.ok(!locked.actions.some(action=>action&&/^upgrade(?:Quantity|Batch):/.test(action)));
    assert.ok(locked.actions.includes('upgrade:tap'),'locked quantity requests keep ordinary single upgrades');
  }
});

test('heat recovery keeps the remaining assisted taps and per-tap yield inside the machine interaction area',()=>{
  for(const [width,height] of VIEWPORTS){
    const game=factory({machine:3,upgrades:{tap:16,auto:4,value:2},heatRecoveryTaps:10,energy:40});
    let geometry;
    for(const remaining of [10,1,0]){
      game.state.heatRecoveryTaps=remaining;
      const output=render(game,width,height);checkLayout(output,'heat recovery '+remaining);
      const bay=output.r.zones.find(zone=>zone.action==='tap');
      assert.ok(bay,'the machine must remain available when recovery expires');
      const current={x:bay.x,y:bay.y,w:bay.w,h:bay.h};
      if(geometry)assert.deepEqual(current,geometry);else geometry=current;
      assert.equal(output.r.actionAt(bay.x+bay.w/2,bay.y+bay.h/2),'tap');
      const recovery=output.entries.find(entry=>entry.text==='余热×'+remaining+' · 每次+1能量');
      assert.equal(!!recovery,remaining>0);
      const yieldHint=output.entries.find(entry=>entry.text.startsWith('点机器 · 每次 +'));
      assert.ok(yieldHint,'per-tap yield stays visible with and without residual heat');
      for(const entry of [yieldHint,recovery].filter(Boolean)) {
        assert.equal(output.r.actionAt(entry.x+entry.w/2,entry.y+entry.h/2),'tap','the machine hint itself must be tappable');
      }
    }
    const upgrades=render(game,width,height,{modal:{type:'upgrades'}});checkLayout(upgrades,'heat upgrade unlocked');
    assert.ok(upgrades.entries.some(entry=>entry.text==='余热接力已解锁'));
    const blueprint=render(game,width,height,{modal:{type:'blueprint',page:1}});checkLayout(blueprint,'milestone blueprint');
    assert.match(blueprint.entries.map(entry=>entry.text).join(''),/批量升级 · 玉米Lv16余热/);
    const next=render(factory({machine:2,upgrades:{tap:15,auto:4,value:2}}),width,height,{modal:{type:'machine'}});checkLayout(next,'milestone before level');
    assert.ok(next.entries.some(entry=>entry.text==='批量升级；玉米Lv16解锁余热'));
    const ready=render(factory({machine:2,upgrades:{tap:16,auto:4,value:2}}),width,height,{modal:{type:'machine'}});checkLayout(ready,'milestone ready');
    assert.ok(ready.entries.some(entry=>entry.text==='新能力：批量升级＋余热接力'));
    const help=render(game,width,height,{modal:{type:'help'}});checkLayout(help,'milestone help');
    const copy=help.entries.map(entry=>entry.text).join('');
    assert.match(copy,/刷新不叠加/);assert.match(copy,/余热可保存/);assert.match(copy,/多头机开放最多5级批量升级/);
  }
});

test('machine funding offers a beneficial upgrade route while ready and unaffordable states keep their own actions',()=>{
  const state={machine:2,orderIndex:10,totalProduced:847526.7689210637,coins:19440801.157558426,
    upgrades:{tap:16,auto:17,value:17}},game=factory(state);
  const output=render(game,320,568,{modal:{type:'machine'}});checkLayout(output,'funding guidance');
  const step=require('../src/next-step').selectNextStep(game.getView(),null,{suppressModeAdvice:true});
  assert.ok(step.estimate&&step.enabled);
  assert.ok(output.actions.includes('fundingUpgrade:'+step.upgradeKey));
  assert.ok(!output.actions.includes('evolve'));
  assert.ok(output.entries.some(entry=>entry.text==='按常驻收入估算，可更快攒齐'));
  for(const [coins,canEvolve] of [[CONFIG.machines[3].cost,true],[0,false]]){
    const other=render(factory({...state,coins}),320,568,{modal:{type:'machine'}});checkLayout(other,'funding state');
    assert.equal(other.actions.includes('evolve'),canEvolve);
    assert.ok(!other.actions.some(action=>action&&action.startsWith('fundingUpgrade:')));
  }
  const early=render(factory({machine:0}),320,568,{modal:{type:'upgrades'}});checkLayout(early,'early disclosure');
  assert.ok(!early.entries.some(entry=>entry.text.includes('余热')),'early upgrade screen teaches current capabilities');
});
