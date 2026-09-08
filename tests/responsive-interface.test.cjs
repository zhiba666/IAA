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

test('burst settlement retains its visible lifetime while an acknowledgement or sheet covers it',()=>{
  const game=factory(),c=canvas(320,568),r=new Renderer(c);
  const ui={viewport:{width:320,height:568},modal:null,toast:'上一条操作提示',startup:false,adBusy:false};
  r.emit({type:'burst',amount:120,coins:240,source:'pot'});
  for(let i=0;i<80;i++)r.draw(game.getView(),ui,.05);
  assert.equal(r.notice.life,2.4,'hidden reward must not expire behind a toast');
  ui.toast='';ui.modal={type:'upgrades'};
  for(let i=0;i<60;i++)r.draw(game.getView(),ui,.05);
  assert.equal(r.notice.life,2.4,'management time must not consume reward display time');
  ui.modal=null;c.text.length=0;r.draw(game.getView(),ui,.05);
  assert.ok(c.text.some(entry=>entry.text==='本次现款 +240 金币'),'actual payout is drawn after returning');
  for(let i=0;i<49;i++)r.draw(game.getView(),ui,.05);
  assert.equal(r.notice,null,'settlement expires after its visible lifetime');
});

test('generation previews disclose the new output form on compact safe-area screens',()=>{
  const {PRODUCTION_FORMS}=require('../src/production-scene');
  for(const [width,height,safeTop] of [[320,524,0],[320,568,44],[390,844,44]]){
    for(let stage=0;stage<5;stage++){
      const game=factory({machine:stage,coins:1e12,orderIndex:20}),form=PRODUCTION_FORMS[stage+1];
      const output=render(game,width,height,{viewport:{width,height,safeTop},modal:{type:'machine'}});
      checkLayout(output,'generation '+stage+' at '+height+' safe '+safeTop);
      assert.ok(output.entries.some(entry=>entry.text===form.unit),'the next output unit stays fully readable');
      assert.ok(output.entries.some(entry=>entry.text===form.rhythm),'the next production rhythm is disclosed');
      assert.ok(output.actions.includes('evolve'),'the reviewed generation is directly available');
    }
    for(const page of [0,1])checkLayout(render(factory(),width,height,{viewport:{width,height,safeTop},modal:{type:'blueprint',page}}),'output blueprint safe '+safeTop);
  }
});

test('generation celebration shows real permanent income growth and preserves a concurrent burst payout',()=>{
  const {PRODUCTION_FORMS}=require('../src/production-scene'),game=factory({machine:3}),event={type:'evolve',machine:3,incomeBefore:100,incomeAfter:287};
  for(const [width,height] of VIEWPORTS){
    const output=render(game,width,height,{},r=>r.emit(event));checkLayout(output,'generation notice '+width);
    assert.ok(output.entries.some(entry=>entry.text==='第 4 代 · '+PRODUCTION_FORMS[3].unit));
    assert.ok(output.entries.some(entry=>entry.text===PRODUCTION_FORMS[3].rhythm+' · 自动金币 ×2.87'));
    const r=output.r;
    r.emit({type:'burst',amount:120,coins:240,source:'pot'});
    assert.equal(r.notice.kind,'evolve','a burst cannot replace the generation reveal');
    r.update(4,false);assert.equal(r.notice.kind,'evolve','a modal must not consume the reveal lifetime');
    r.update(3.2,true);assert.equal(r.notice.kind,'burst');assert.equal(r.notice.life,2.4);
    assert.equal(r.notice.text,'本次现款 +240 金币');
    r.update(2.5,true);assert.equal(r.notice,null);assert.equal(r.queuedBurstNotice,null);
  }
});

test('generation reveal occupies the goal area and keeps the tower and controls below its full banner',()=>{
  for(const [width,height,safeTop,menuBottom] of [[320,568,0,0],[320,568,44,86],[390,844,44,86]])for(const goalExpanded of [false,true]){
    const game=factory({machine:5,orderIndex:20}),ui={viewport:{width,height,safeTop,menuBottom},goalExpanded};
    const ordinary=render(game,width,height,ui),ordinaryTap=ordinary.r.zones.find(zone=>zone.action==='tap');
    let frame;
    const output=render(game,width,height,ui,r=>{
      const draw=r.scene.draw;r.scene.draw=function(x,y,w,h,view,options){frame={y,options};return draw.call(this,x,y,w,h,view,options);};
      r.emit({type:'evolve',machine:5,incomeBefore:100,incomeAfter:320});
    });
    checkLayout(output,'generation tower reveal '+height+' expanded '+goalExpanded);
    const {r}=output,banner={x:22,y:r.interface.feedbackY,w:width-44,h:54},tap=r.zones.find(zone=>zone.action==='tap');
    const modes=r.zones.find(zone=>zone.action==='modules');
    assert.ok(banner.y>=safeTop+8+10+70+6,'the full wallet remains above the banner');
    if(modes)assert.ok(banner.y>=modes.y+modes.h+6,'visible module controls remain above the banner');
    assert.ok(tap.y>=banner.y+banner.h+6,'the reveal cannot intercept a production tap');
    assert.ok(frame.y+frame.options.topInset>=banner.y+banner.h+6,'the tower is framed below the reveal');
    assert.ok(!r.zones.some(zone=>['goalExpand','goalCollapse','target'].includes(zone.action)),'goal controls temporarily yield their area');
    assert.equal(r.interface.visibleTarget,null);assert.equal(output.ui.goalExpanded,goalExpanded,'the user preference is retained');
    for(const zone of r.zones){const overlap=intersect(banner,zone);assert.ok(overlap.w===0||overlap.h===0,'reveal remains clear of every control');}
    r.update(4);r.draw(output.view,output.ui,0);
    assert.equal(r.zones.some(zone=>zone.action===(goalExpanded?'goalCollapse':'goalExpand')),true,'the goal returns after the reveal');
    assert.equal(r.zones.find(zone=>zone.action==='tap').y,ordinaryTap.y);
    const burst=render(game,width,height,ui,r=>r.emit({type:'burst',amount:120,coins:240}));
    assert.equal(burst.r.zones.find(zone=>zone.action==='tap').y,ordinaryTap.y,'ordinary bursts retain the existing layout');
  }
});

test('an interstitial without a hide event preserves the complete generation reveal until return',()=>{
  const game=factory({machine:4}),output=render(game,320,568,{adBusy:true,sceneDt:.1},r=>r.emit({type:'evolve',machine:4,incomeBefore:100,incomeAfter:320}));
  const {r,view,ui,c}=output,sceneLife=r.scene.evolveTime,noticeLife=r.notice.life;
  for(let i=0;i<50;i++)r.draw(view,ui,.1);
  c.verify();
  assert.equal(r.scene.evolveTime,sceneLife,'five seconds behind an SDK ad must not consume installation');
  assert.equal(r.notice.life,noticeLife,'the announcement retains its existing visible-time policy');
  assert.equal(r.scene.evolveLaunched,false);assert.equal(r.scene.units.length,0);
  ui.adBusy=false;
  for(let i=0;i<8;i++)r.draw(view,ui,.1);
  c.verify();
  assert.ok(r.scene.evolveLaunched,'the first batch launches 0.8 seconds after the ad closes');
  assert.ok(r.scene.units.some(unit=>unit.kind==='evolve'));
  assert.ok(Math.abs(r.notice.life-(noticeLife-.8))<1e-9,'only visible time consumes the announcement');
});


for(const [width,height] of VIEWPORTS) {
  test(`responsive ${width}×${height}: fresh, affordable, boosted and final factories keep readable controls`,()=>{
    const cases=[new Game({now:NOW}),factory(),factory({boostSeconds:90}),factory({machine:5,orderIndex:20,totalProduced:2e9,coins:1e12,upgrades:{tap:24,auto:24,value:24}})];
    for(const [index,game] of cases.entries()) {
      const output=render(game,width,height);checkLayout(output,'home '+index);
      assert.ok(output.actions.includes('tap'));
      for(const [action,feature] of [['upgrades','tapUpgrade'],['order','orders'],['quests','records'],['workshop','workshop']])
        assert.equal(output.actions.includes(action),output.view.onboarding.features[feature],action+' follows its unlock');
      assert.ok(output.actions.includes('settings'),'settings remain reachable before the factory unlocks');
      assert.ok(output.actions.includes('guidebook'),'learned mechanics can be reviewed from home');
      assert.ok(!output.entries.some(e=>e.text==='小小爆米花厂'),'the startup title does not reserve a row during production');
      const target=selectCurrentTarget(output.view,output.ui);
      assert.equal(output.r.guideAction,target.action);
      const expanded=!!output.view.tutorial;
      if(expanded)assert.ok(!output.actions.includes('goalCollapse'),'the first six goals stay visible');
      else assert.ok(output.actions.includes('goalExpand'));
      assert.equal(!!output.r.interface.visibleTarget,expanded);
      if(expanded)assert.ok(output.entries.some(e=>e.text===target.title||e.text.endsWith('…')&&target.title.startsWith(e.text.slice(0,-1))),'the expanded current target title must be visible');
      const income=output.view.production.auto*output.view.production.price;
      const incomeText=output.view.onboarding.features.autoUpgrade?'自动 +'+(income>0&&income<10?Number(income.toFixed(2)).toString():formatNumber(income))+' /秒':'点击生产，即时赚金币';
      const wallet=[output.entries.find(e=>e.text===formatNumber(game.state.coins)),output.entries.find(e=>e.text===incomeText)];
      assert.ok(wallet.every(Boolean),'the wallet shows income after it unlocks and a production cue beforehand');
      for(const entry of wallet){
        for(const dx of [1,entry.w/2,entry.w-1])assert.equal(output.r.actionAt(entry.x+dx,entry.y+entry.h/2),null,'reading balances must never trigger production or another action');
      }
    }
  });
}

for(const [width,height] of SHEET_VIEWPORTS) {
  test(`responsive ${width}×${height}: main sheets keep controls and copy separate`,async t=>{
    for(const type of ['upgrades','workshop','machine','order','offline','brand','turbo','settings','restart','stats','help','privacy','health','completion'])await t.test(type,()=>{
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
      const game=factory(kind==='order'?{orderIndex:3}:{}),quote=game.quoteReward(kind);assert.ok(quote,kind+' fixture must produce a real authorized quote');
      const output=render(game,width,height,{isDouyin,modal:{type:'reward',quote}});checkLayout(output,'reward '+kind);
      assert.ok(output.actions.includes(isDouyin?'watch':'simulate:complete'));
      if(!isDouyin)for(const action of ['simulate:cancel','simulate:fail'])assert.ok(output.actions.includes(action));
      const busy=render(game,width,height,{isDouyin,adBusy:true,modal:{type:'reward',quote}});assert.deepEqual(busy.actions,[],'pending playback must prevent duplicate submissions');
    });
  });

  test(`responsive ${width}×${height}: normal collection and optional ads have equal-sized controls`,()=>{
    for(const [type,normal,ad] of [['order','claimOrder','ad:order'],['offline','claimOffline','ad:offline']]) {
      const output=render(factory(type==='order'?{orderIndex:3}:{}),width,height,{modal:{type}}),direct=output.r.zones.find(z=>z.action===normal),rewarded=output.r.zones.find(z=>z.action===ad);
      assert.ok(direct&&rewarded,'both collection choices must be available');
      assert.equal(direct.screen.x,rewarded.screen.x);assert.equal(direct.screen.w,rewarded.screen.w);
      assert.equal(direct.screen.h,rewarded.screen.h,'the ad option must not get a larger touch target');
    }
  });

  test(`responsive ${width}×${height}: completed campaign shows a finite ending even for legacy loop saves`,()=>{
    for(const loopIndex of [0,4]) {
      const output=render(factory({machine:5,orderIndex:20,loopIndex,totalProduced:2e10}),width,height,{modal:{type:'order'}});
      checkLayout(output,'loop order '+loopIndex);
      assert.ok(output.entries.some(entry=>entry.text==='20单完成 · 工厂竣工'));
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


test('responsive quest pagination keeps the formerly cramped 700px viewport accessible',()=>{
  const game=factory(),chapter=game.getView().quests.chapters[0];
  for(const page of [0,1]) {
    const output=render(game,360,700,{modal:{type:'quests',chapterId:chapter.id,page}});checkLayout(output,'700px quests page '+page);
    assert.ok(output.actions.includes('questPage:'+(page?0:1)));
    assert.equal(chapter.quests.filter(quest=>output.entries.some(entry=>entry.text===quest.title)).length,2);
  }
});


test('responsive energy progress keeps a full scale and cannot trigger production',()=>{
  for(const [width,height] of VIEWPORTS) {
    let originalBay;
    for(const energy of [0,40,79.99,80,91.99,94,98.01,99.99]) {
      const game=factory({energy});
      const output=render(game,width,height,{goalExpanded:false});checkLayout(output,`energy ${width} ${energy}`);
      const production=output.r.zones.filter(z=>z.action==='tap');
      const bay=production[0];
      assert.equal(production.length,1,'the machine is the only production control outside teaching recommendations');
      assert.ok(bay);assert.ok(!output.actions.includes('timing'),'charging does not expose a manual ignition action');
      const geometry=z=>({x:z.x,y:z.y,w:z.w,h:z.h});
      if(originalBay)assert.deepEqual(geometry(bay),originalBay,'energy thresholds must not move the production surface');
      else originalBay=geometry(bay);
      const trackY=height-88,bar=output.c.fills.filter(fill=>Math.abs(fill.y-trackY)<.001&&Math.abs(fill.h-12)<.001);
      assert.equal(bar[0].w,width-60,'the energy track uses the full dock width at every charge level');
      if(energy>0)assert.ok(Math.abs(bar[1].w/bar[0].w-energy/CONFIG.energyMax)<1e-9,'the final segment never zooms or changes scale');
      else assert.equal(bar.length,1,'an empty pot has no progress fill');
      for(const x of [bar[0].x+1,width/2,bar[0].x+bar[0].w-1])assert.equal(output.r.actionAt(x,trackY+6),null,'the read-only energy track cannot produce');
      for(const [dx,dy] of [[1,1],[bay.w-1,1],[1,bay.h-1],[bay.w-1,bay.h-1],[bay.w/2,bay.h/2]]) {
        assert.equal(output.r.actionAt(bay.x+dx,bay.y+dy),'tap','machine edges and the lower thumb area must keep producing');
      }
      assert.equal(output.r.actionAt(width/2,bay.y+bay.h+1),null,'the separation below the machine must not produce');
    }
  }
});

test('responsive energy guidance consistently explains automatic output on the smallest screen',()=>{
  const [width,height]=VIEWPORTS[0];
  for(const energy of [79.99,80,91.99,94,98.01]) {
    const output=render(factory({energy}),width,height);checkLayout(output,`heat ${width} ${energy}`);
    assert.ok(output.entries.some(e=>e.text==='蓄满自动爆锅'));
    assert.ok(output.entries.some(e=>e.text===energy.toFixed(1)+' / '+CONFIG.energyMax));
    assert.ok(output.entries.some(e=>e.text.includes('格后自动出锅')));
    assert.equal(output.actions.includes('timing'),false);
    assert.ok(!output.entries.some(e=>/火候|点火|提前出锅|放大/.test(e.text)));
  }
});

test('responsive order progress describes the current milestone and preserves overproduction through claims',()=>{
  for(const [width,height] of VIEWPORTS) {
    const game=factory({orderIndex:1,totalProduced:80});
    assert.equal(game.getView().order.progress,.4);assert.equal(game.getView().order.stageProgress,.2);
    const assertProgress=(percent,ready=false)=>{
      const home=render(game,width,height),sheet=render(game,width,height,{modal:{type:'order'}});
      checkLayout(home,'order progress home');checkLayout(sheet,'order progress sheet');
      assert.ok(home.entries.some(e=>e.text===(ready?'本单达标 · 装车':`本单 ${percent}%  ›`)));
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

  }
});

test('responsive production feedback shows real payouts, lets action confirmations take priority and expires without blocking controls',()=>{
  const shown=n=>n>0&&n<10?Number(n.toFixed(2)).toString():formatNumber(n);
  for(const [width,height] of VIEWPORTS)for(const toast of ['', '订单奖励已到账']) {
    const game=factory({energy:99});game.tick(1);
    const burst=game.drainEvents().find(e=>e.type==='burst');
    assert.ok(burst&&burst.amount>0);
    const base=render(game,width,height,{toast});
    const output=render(game,width,height,{toast},r=>r.emit(burst));
    checkLayout(output,`automatic burst notice ${width} ${toast}`);
    assert.deepEqual(output.actions,base.actions,'feedback must not add or remove any gameplay control');
    assert.equal(output.r.notice.title,`自动爆锅 +${shown(burst.amount)} 份`);
    assert.equal(output.r.notice.text,`本次现款 +${shown(burst.coins)} 金币`,'the displayed payout comes from the real automatic burst');
    assert.equal(output.entries.some(e=>e.text===output.r.notice.title),!toast,'an action confirmation temporarily takes priority over the burst notice');
    assert.equal(output.entries.some(e=>e.text===output.r.notice.text),!toast);
    if(toast){
      const confirmation=output.entries.find(e=>e.text===toast);
      assert.ok(confirmation,'the action confirmation must be visible');
      assert.equal(output.r.actionAt(confirmation.x+confirmation.w/2,confirmation.y+confirmation.h/2),'tap','transient confirmations must not block the machine');
      assert.ok(output.entries.some(e=>e.text.startsWith('点机器 · 每次 +')),'action confirmations leave the production hint readable');
    }
    assert.ok(!output.entries.some(e=>/完美爆锅|火候额外/.test(e.text)));
    const expired=render(game,width,height,{toast},r=>{r.emit(burst);r.update(3);});
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



function nextStepFactory(overrides={}){
  const game=legacyGame({now:NOW});game.state.claimedQuests=game.getView().quests.chapters.flatMap(c=>c.quests.map(q=>q.id));
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
      [nextStepFactory({machine:5,orderIndex:20,totalProduced:2e9,coins:1e12,upgrades:{tap:24,auto:24,value:24},refinements:{yield:3,value:3},learning:{heatRecoveryUses:10,heatRecoveryDismissed:false}}),'completion','completion'],
      [nextStepFactory({machine:5,orderIndex:20,totalProduced:2e9,coins:1e12,upgrades:{tap:24,auto:24,value:24},refinements:{yield:3,value:3},research:{levels:{yield:CONFIG.research.maxLevel,value:CONFIG.research.maxLevel},serial:48,active:null},learning:{heatRecoveryUses:10,heatRecoveryDismissed:false}}),'completion','completion']
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


test('established home floats one collapsible goal over the scene and keeps production clear of every control',()=>{
  const games=[legacyGame({now:NOW}),factory(),factory({machine:2}),factory({machine:5,coins:1e12,orderIndex:20,totalProduced:2e9})];
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
        const relevant=output.r.zones.filter(z=>['upgrades','workshop'].includes(z.action)).map(({x,y,w,h})=>({x,y,w,h}));
        if(controls)assert.deepEqual(relevant,controls,'goal readiness and module unlock do not move the bottom navigation');else controls=relevant;
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

test('beginner goals stay visible, while established goals preserve the player collapse preference',()=>{
  for(const game of [new Game({now:NOW}),nextStepFactory()]){
    const view=game.getView(),fresh=!!view.tutorial;
    const initial=render(game,480,697);
    assert.equal(initial.r.interface.isGoalExpanded(view,{}),fresh);
    const hidden=render(game,480,697,{goalExpanded:false});
    if(fresh){
      assert.equal(hidden.r.interface.isGoalExpanded(view,{goalExpanded:false}),true);
      assert.ok(!hidden.actions.includes('goalExpand'));assert.ok(!hidden.actions.includes('goalCollapse'));
      assert.equal(hidden.r.interface.visibleTarget.source,'onboarding');
      assert.ok(!hidden.actions.some(action=>action&&/^(upgrade:|questClaim:)/.test(action)));
      continue;
    }
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

test('practice guidance points at real controls without adding duplicate production or observe actions',()=>{
  const goals=[
    {id:'practice-tap',title:'点一下锅',text:'点锅，赚到第一笔金币',action:'tap',anchor:'machine',phase:'produce'},
    {id:'practice-upgrade',title:'升级爆米花',text:'金币够了，点底部「升级」',action:'upgrade:tap',anchor:'upgrades',phase:'buy',upgradeKey:'tap'},
    {id:'practice-verify',title:'再点一下锅',text:'产量增加了',action:'tap',anchor:'machine',phase:'verify',before:1,after:2.16,unit:'份/次'},
    {id:'practice-observe',title:'松手看看',text:'不用点击，金币也在增长',action:'observe',anchor:'wallet',phase:'observe',observationSeconds:2,observationTarget:4},
    {id:'practice-order',title:'装车领取奖励',text:'点右上角订单，把爆米花装车',action:'order',anchor:'order',phase:'deliver'}
  ];
  for(const [width,height,safeTop,menuBottom] of [[320,568,0,0],[320,568,44,86],[390,844,44,86]])for(const goal of goals){
    const game=factory({coins:1000,totalProduced:10,orderIndex:0});
    const outlines=[];
    const configure=(r,view)=>{
      view.onboarding.goal={...goal,step:2,total:6};
      const original=r.interface.guideOutline;
      r.interface.guideOutline=function(x,y,w,h){outlines.push({x,y,w,h});return original.call(this,x,y,w,h);};
    };
    const output=render(game,width,height,{viewport:{width,height,safeTop,menuBottom},guideIdleSeconds:6},configure);
    checkLayout(output,'practice '+goal.id+' '+width+' safe '+safeTop);
    assert.equal(output.actions.filter(action=>action==='tap').length,1,'the machine is the only production control');
    assert.ok(!output.actions.includes('observe'),'observation must never look clickable');
    assert.ok(output.actions.includes('guideSkip'),'practice can be skipped without opening another sheet');
    if(goal.anchor==='machine'){
      const f=output.r.scene.screenFrame;
      assert.equal(output.r.actionAt(f.x+216*f.scale,f.y+130*f.scale),'tap','the highlighted machine remains directly tappable');
    }
    if(goal.anchor==='upgrades'){
      const entrance=output.r.zones.find(z=>z.action==='upgrades');
      assert.ok(outlines.some(o=>o.x===entrance.x&&o.y===entrance.y),'the real upgrade entrance is highlighted');
      outlines.length=0;
      const sheet=render(game,width,height,{viewport:{width,height,safeTop,menuBottom},modal:{type:'upgrades'}},configure);
      checkLayout(sheet,'practice upgrade purchase '+width);
      const purchase=sheet.r.zones.find(z=>z.action==='upgrade:tap');
      const sheetInset=Math.max(safeTop,menuBottom-11);
      assert.ok(purchase&&outlines.some(o=>o.x===purchase.x&&o.y+sheetInset===purchase.y),'guidance highlights the purchase button itself');
    }
    if(goal.phase==='verify')assert.ok(output.entries.some(e=>e.text.includes('1 → 2.16')),'verification shows the real before and after output');
  }
});

test('real practice goals highlight the first shipment and stop recommending purchases during verification',()=>{
  const game=new Game({now:NOW});
  const earn=key=>{for(let i=0;i<100&&!game.getView().upgrades.find(u=>u.key===key).canBuy;i++)game.tap();};
  const highlighted=(modal,focusUpgrade='')=>{
    const outlines=[],borders=[];
    const output=render(game,320,568,{viewport:{width:320,height:568,safeTop:44,menuBottom:86},modal,focusUpgrade},r=>{
      const outline=r.interface.guideOutline,box=r.interface.box;
      r.interface.guideOutline=function(x,y,w,h){outlines.push({x,y,w,h});return outline.call(this,x,y,w,h);};
      r.interface.box=function(x,y,w,h,fill,stroke){if(stroke==='#df9954')borders.push({x,y,w,h});return box.call(this,x,y,w,h,fill,stroke);};
    });
    checkLayout(output,'real practice '+modal.type);
    return{...output,outlines,borders};
  };
  earn('tap');assert.ok(game.buyUpgrade('tap').ok);
  assert.equal(game.getView().onboarding.goal.phase,'verify');
  const verify=highlighted({type:'upgrades'},'tap');
  assert.equal(verify.outlines.length,0,'reopening upgrades during verification cannot recommend another purchase');
  assert.equal(verify.borders.length,0,'a stale upgrade focus cannot outline a row during verification');
  game.tap();earn('auto');assert.ok(game.buyUpgrade('auto').ok);
  for(let i=0;i<12;i++){game.tick(.25);game.observeOnboarding(.25);}
  for(let i=0;i<100&&!game.getView().order.ready;i++)game.tap();
  assert.equal(game.getView().onboarding.goal.action,'order');
  assert.equal(game.getView().onboarding.goal.phase,'deliver');
  const order=highlighted({type:'order'}),claim=order.r.zones.find(z=>z.action==='claimOrder');
  assert.ok(claim,'the first shipment is ready and uses the real claim action');
  assert.ok(order.outlines.some(o=>o.x===claim.x&&o.y+75===claim.y),'the real order goal highlights the actual shipment button');
  assert.ok(!order.r.zones.filter(z=>z.action.startsWith('ad:')).some(z=>order.outlines.some(o=>o.x===z.x&&o.y+75===z.y)),'practice never highlights an optional ad');
});

test('unread help does not replace operating goals and every help close simply returns to production',()=>{
  const game=factory(),lesson={id:'heat',title:'自动爆锅',benefit:'满格自动出锅',instruction:'松手等待能量蓄满',buttonLabel:'试一试'};
  const configure=(r,view)=>{view.onboarding={...view.onboarding,goal:null,lesson,lessons:[lesson],skipped:true,completed:false};view.tutorial=null;};
  for(const [width,height,safeTop] of [[320,568,44],[390,844,44]]){
    const home=render(game,width,height,{viewport:{width,height,safeTop},goalExpanded:true},configure);
    checkLayout(home,'unread help home');
    assert.notEqual(home.r.interface.visibleTarget&&home.r.interface.visibleTarget.source,'onboarding');
    for(const replay of [false,true]){
      const guide=render(game,width,height,{viewport:{width,height,safeTop},modal:{type:'guide',guideId:'heat',replay}},configure);
      checkLayout(guide,'manual help '+replay);
      assert.ok(guide.actions.every(action=>action==='close'),'neither close nor the bottom button advances or navigates gameplay');
    }
    const book=render(game,width,height,{viewport:{width,height,safeTop},modal:{type:'guidebook'}},configure);
    checkLayout(book,'resume guidebook');
    assert.ok(book.actions.includes('guideResume'));
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
    assert.match(copy,/广告只翻倍本次现款/);
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
