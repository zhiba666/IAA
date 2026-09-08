'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Game,CONFIG,QUEST_CHAPTERS,formatNumber}=require('../src/core');
const {Renderer}=require('../src/renderer');
const {selectCurrentTarget,createExperienceTracker}=require('../src/experience');
const {selectNextStep}=require('../src/next-step');

const NOW=1800000000000,VIEWPORTS=[[320,524],[320,568],[390,844]];
function factory(overrides={}){
  const game=new Game({now:NOW});
  Object.assign(game.state,{machine:3,orderIndex:10,totalProduced:CONFIG.orders[9].target,coins:1e9,
    playedSeconds:300,taps:10,bursts:2,upgrades:{tap:16,auto:16,value:16},
    learning:{heatRecoveryUses:10,heatRecoverySkipped:true},
    claimedQuests:QUEST_CHAPTERS.flatMap(chapter=>chapter.quests.map(quest=>quest.id)),...overrides});
  return game;
}

// Exercise the real sheet renderer and hit testing. Sheet text is in CSS pixels;
// decorative machine previews do not emit text or input regions.
function sheet(game,type,width=320,height=524,extra={}){
  const text=[];
  const c={font:'14px sans-serif',textAlign:'left',
    measureText(value){const size=Number(this.font.match(/([\d.]+)px/)[1]);return{width:[...String(value)].reduce((sum,ch)=>sum+size*(ch.charCodeAt(0)>127?1:.55),0)};},
    fillText(value,x,y){const size=Number(this.font.match(/([\d.]+)px/)[1]),w=this.measureText(value).width;
      text.push({text:String(value),x:x-(this.textAlign==='center'?w/2:this.textAlign==='right'?w:0),y:y-size/2,w,h:size});}
  };
  for(const method of ['save','restore','beginPath','closePath','moveTo','lineTo','arcTo','arc','fill','stroke','clip','translate','scale','rotate','fillRect','clearRect'])c[method]=()=>{};
  const renderer=new Renderer(c),ui={modal:{type},toast:'',adBusy:false,isDouyin:false,...extra};
  Object.assign(renderer.interface,{w:width,h:height,cw:width-24,x:12});
  renderer.interface.sheet(game.getView(),ui);
  const overlap=(a,b)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>3&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>2;
  for(const zone of renderer.zones){
    assert.ok(zone.h>=44,zone.action+' is below the touch-size requirement');
    assert.ok(zone.x>=0&&zone.y>=0&&zone.x+zone.w<=width&&zone.y+zone.h<=height,zone.action+' is outside the viewport');
    assert.equal(renderer.actionAt(zone.x+zone.w/2,zone.y+zone.h/2),zone.action,'another control intercepts '+zone.action);
  }
  for(let i=0;i<renderer.zones.length;i++)for(let j=i+1;j<renderer.zones.length;j++)assert.ok(!overlap(renderer.zones[i],renderer.zones[j]),'controls overlap');
  for(const entry of text){
    assert.doesNotMatch(entry.text,/undefined|NaN|Infinity/);
    assert.ok(entry.x>=-.5&&entry.y>=0&&entry.x+entry.w<=width+.5&&entry.y+entry.h<=height,'out-of-bounds text '+entry.text);
  }
  for(let i=0;i<text.length;i++)for(let j=i+1;j<text.length;j++)assert.ok(!overlap(text[i],text[j]),'text overlaps: '+text[i].text+' / '+text[j].text);
  return{renderer,ui,text:text.map(entry=>entry.text).join('\n'),actions:renderer.zones.map(zone=>zone.action)};
}

test('order stages expose only ready, unclaimed exact actions, while full settlement and its optional ad stay independent',()=>{
  for(const [width,height] of VIEWPORTS){
    const game=factory(),stages=game.getView().deliveries.stages;
    game.state.totalProduced=stages[1].threshold;
    let output=sheet(game,'order',width,height);
    assert.ok(output.actions.includes('delivery:10:1'));assert.ok(output.actions.includes('delivery:10:2'));
    assert.ok(!output.actions.includes('delivery:10:3'));assert.ok(!output.actions.includes('claimOrder'));
    assert.ok(output.actions.includes('commissions'));
    assert.equal(game.claimDelivery(1,10).ok,true);
    output=sheet(game,'order',width,height);
    assert.ok(!output.actions.includes('delivery:10:1'));
    assert.ok(output.text.includes(formatNumber(stages[0].coins)),'the amount already advanced stays visible');
    game.state.totalProduced=CONFIG.orders[10].target;
    output=sheet(game,'order',width,height);
    const direct=output.renderer.zones.find(zone=>zone.action==='claimOrder'),ad=output.renderer.zones.find(zone=>zone.action==='ad:order');
    assert.ok(direct&&ad);assert.ok(direct.y+direct.h<=ad.y);
    assert.equal(direct.w,ad.w);assert.equal(direct.h,ad.h);
    const view=game.getView();
    assert.ok(output.text.includes(formatNumber(view.order.fullReward)));
    assert.ok(output.text.includes(formatNumber(view.order.reward)));
    assert.ok(output.text.includes(formatNumber(view.order.reward*3)));
    assert.ok(output.actions.includes('delivery:10:3'),'full readiness must not erase available staged claims');
  }
});

test('optional commissions render reviewable quotes, track real progress, preserve claim identifiers and support both routes',()=>{
  for(const [width,height] of VIEWPORTS)for(const kind of ['bulk','artisan']){
    const game=factory();
    let output=sheet(game,'commissions',width,height),quote=output.ui.modal.commissionQuotes[kind];
    assert.deepEqual(quote,game.getView().commissions.options.find(option=>option.kind===kind));
    assert.ok(output.actions.includes('commissionAccept:'+kind+':'+quote.id));
    assert.equal(game.acceptCommission(kind,quote).ok,true);
    output=sheet(game,'commissions',width,height);
    assert.ok(output.actions.includes('commissionCancel:'+quote.id));
    assert.ok(!output.actions.includes('commissionClaim:'+quote.id));
    assert.ok(output.actions.includes(kind==='bulk'?'productionModes':'heatLesson'));
    assert.ok(output.actions.includes('close'));
    assert.deepEqual(output.ui.modal.commissionQuotes,{},'active jobs must not leave acceptance quotes behind');
    const active=game.state.commissions.active;
    if(kind==='bulk'){game.tick(30);assert.ok(game.getView().commissions.active.production>0);game.tick(60);}
    else{active.perfect=active.perfectTarget;active.recovery=active.recoveryTarget-1;
      output=sheet(game,'commissions',width,height);assert.ok(!output.actions.includes('commissionClaim:'+quote.id));
      game.state.heatRecoveryTaps=1;game.tap();}
    assert.equal(game.getView().commissions.active.ready,true);
    output=sheet(game,'commissions',width,height);assert.ok(output.actions.includes('commissionClaim:'+quote.id));
    assert.equal(game.claimCommission(quote.id).ok,true);
    output=sheet(game,'commissions',width,height);assert.equal(game.getView().commissions.remaining,2);
    const second=output.ui.modal.commissionQuotes[kind];assert.notEqual(second.id,quote.id);
    assert.equal(game.acceptCommission(kind,second).ok,true);assert.equal(game.cancelCommission(second.id).ok,true);
    assert.equal(game.getView().commissions.remaining,2,'declining a route does not consume a claim');
  }
});

test('early artisan instructions teach only available timing skills and all new terminal states remain usable on small screens',()=>{
  for(const [width,height] of VIEWPORTS){
    const early=factory({machine:2,upgrades:{tap:10,auto:10,value:10}}),quote=early.getView().commissions.options.find(option=>option.kind==='artisan');
    assert.equal(quote.recoveryTarget,0);early.acceptCommission('artisan',quote);
    const practice=sheet(early,'heatLesson',width,height);
    assert.ok(practice.actions.includes('practiceHeat'));assert.match(practice.text,/92–98/);
    assert.doesNotMatch(practice.text,/获得10次余热/);
    const exhausted=factory();exhausted.state.commissions={serial:3,orderIndex:10,claimed:3,active:null};
    assert.ok(!sheet(exhausted,'commissions',width,height).actions.some(action=>action.startsWith('commissionAccept:')));
    const completed=factory({machine:5,orderIndex:20,loopIndex:0,totalProduced:CONFIG.orders[19].target,coins:1e20,upgrades:{tap:24,auto:24,value:24},refinements:{yield:3,value:3}});
    for(const type of ['workshop','completion','commissions'])assert.ok(sheet(completed,type,width,height).actions.includes('souvenirs'));
    let output=sheet(completed,'souvenirs',width,height);
    const sign=output.ui.modal.souvenirQuotes.sign;
    assert.ok(output.actions.includes('souvenir:sign'));assert.ok(!output.actions.includes('souvenir:cup'));
    assert.equal(completed.buySouvenir('sign',sign).ok,true);
    output=sheet(completed,'souvenirs',width,height);assert.ok(!output.actions.includes('souvenir:sign'));
    completed.state.loopIndex=100;
    output=sheet(completed,'souvenirs',width,height);
    for(const key of ['cup','starlight'])assert.equal(completed.buySouvenir(key,output.ui.modal.souvenirQuotes[key]).ok,true);
    assert.ok(!sheet(completed,'souvenirs',width,height).actions.some(action=>action.startsWith('souvenir:')));
    const locked=factory({machine:2,orderIndex:9});
    for(const type of ['commissions','souvenirs'])assert.ok(sheet(locked,type,width,height).actions.includes('close'));
  }
});

test('ready main rewards and evolution stay above optional jobs, and stage or job claims stay above mode advice',()=>{
  const game=factory(),quote=game.getView().commissions.options.find(option=>option.kind==='bulk');
  game.acceptCommission('bulk',quote);
  let view=game.getView(),target=selectCurrentTarget(view);
  assert.equal(target.source,'commission');assert.equal(selectNextStep(view,target).kind,'commission');
  game.state.totalProduced=view.deliveries.stages[0].threshold;
  view=game.getView();assert.equal(selectNextStep(view,selectCurrentTarget(view)).kind,'delivery');
  game.claimDelivery(1,10);game.state.commissions.active.production=quote.productionTarget;
  view=game.getView();assert.equal(selectNextStep(view,selectCurrentTarget(view)).kind,'commission');
  game.state.totalProduced=CONFIG.orders[10].target;
  view=game.getView();assert.equal(selectNextStep(view,selectCurrentTarget(view)).kind,'order');
  game.state.machine=2;game.state.coins=CONFIG.machines[3].cost;
  view=game.getView();assert.equal(selectNextStep(view,selectCurrentTarget(view)).kind,'machine');
  game.state.machine=3;game.state.orderIndex=14;game.state.totalProduced=CONFIG.orders[13].target;
  game.state.coins=0;game.state.commissions.active.production=0;
  const before=JSON.stringify(game.state);view=game.getView();target=selectCurrentTarget(view);
  selectNextStep(view,target);assert.equal(JSON.stringify(game.state),before,'guidance must not change the chosen mode or job');
});

test('progression analytics observe actions and actual surfaces without per-frame exposure spam',()=>{
  const game=factory(),tracker=createExperienceTracker({initialView:game.getView()});
  for(let i=0;i<10;i++)tracker.observe(game.getView(),{modalType:'commissions'});
  let report=tracker.export();assert.equal(report.events.filter(event=>event.event==='experience_progression_visible').length,1);
  const quote=game.getView().commissions.options[0];game.acceptCommission(quote.kind,quote);
  tracker.recordEvents(game.drainEvents(),game.getView());tracker.observe(game.getView(),{modalType:'commissions'});
  assert.equal(tracker.export().events.filter(event=>event.event==='experience_progression_visible').length,2);
  game.state.totalProduced=game.getView().deliveries.stages[0].threshold;game.claimDelivery(1,10);
  tracker.recordEvents(game.drainEvents(),game.getView());
  game.state.commissions.active.production=quote.productionTarget;game.claimCommission(quote.id);
  tracker.recordEvents(game.drainEvents(),game.getView());
  Object.assign(game.state,{machine:5,orderIndex:20,coins:1e20,loopIndex:0});
  const sign=game.getView().souvenirs.options.find(option=>option.key==='sign');game.buySouvenir('sign',sign);
  tracker.recordEvents(game.drainEvents(),game.getView());
  report=tracker.export();
  assert.equal(report.events.filter(event=>event.event==='experience_delivery').length,1);
  assert.deepEqual(report.events.filter(event=>event.event==='experience_commission').map(event=>event.data.action),['accept','claim']);
  assert.equal(report.events.filter(event=>event.event==='experience_souvenir').length,1);
  assert.equal(report.current.souvenirsOwned,1);
  tracker.observe(game.getView(),{modalType:'souvenirs',visible:false});
  assert.equal(tracker.export().events.filter(event=>event.event==='experience_progression_visible').length,2,'hidden sheets are not exposures');
});
