'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Game}=require('../src/core');
const {ProductionInsights}=require('../src/production-insights');
const {Renderer}=require('../src/renderer');
const {ART_ASSETS}=require('../src/art-manifest');
const {canvasHarness,deepFreeze}=require('./canvas-harness.cjs');
const ports=[{width:320,height:524,safeTop:0},{width:360,height:640,safeTop:0},{width:390,height:844,safeTop:0},{width:430,height:932,safeTop:0},
  {width:320,height:524,safeTop:24,safeBottom:34,safeLeft:8,safeRight:8,menuBottom:75,menuButton:{left:220,top:35,right:308,bottom:75,width:88,height:40}}];
function view(){const game=new Game({mode:'v15',now:1800000000000});game.tick(10);return new ProductionInsights().enrich(game.getView());}
function quotes(v,stationId='cup'){
  const q={},make=(key,offer,extra={})=>{if(offer)q[key]={id:'reviewed-'+key,action:'purchase:reviewed-'+key,cost:offer.cost,name:offer.name||key,generation:v.state.machine,...extra};};
  const s=v.stations.find(s=>s.id===stationId);make('upgrade',s.upgrade,{stationId,level:s.level+1});
  for(const t of v.transfers)if(!t.automated)make('automate-'+t.source,t.automation,{source:t.source});
  make('logistics',v.logisticsUpgrade);make('expansion',v.expansion);return q;
}
function render(v,viewport,options={}){
  const canvas=canvasHarness();canvas.ctx.globalAlpha=1;
  const renderer=new Renderer(canvas.ctx,{get(id){assert.ok(ART_ASSETS[id],id);return{id};},report:()=>options.artReport||{pending:0,failed:0}});
  // Isolate interface behavior from concurrently evolving scene composition.
  renderer.scene={stationFrames:[],transferFrames:[],update(){},draw(x,y,w,h,presented){this.last={x,y,w,h,presented};this.stationFrames=[{id:'cup',x:130,y:220,w:80,h:100}];this.transferFrames=[{action:'transfer-source-pop',x:230,y:170,w:64,h:64}];}};
  renderer.drawTransfer=(_,ui)=>{if(!ui.modal)renderer.ghostDrawn=true;else renderer.transferGhost=null;};
  const ui={viewport,modal:null,transfer:null,press:null,toast:'',quotes:quotes(v),elapsedSeconds:20,...options};
  const before=JSON.stringify({v,ui});deepFreeze(v);deepFreeze(ui);renderer.draw(v,ui,.016);
  assert.equal(JSON.stringify({v,ui}),before,'painting leaves quotes and the simulation untouched');assert.equal(canvas.depth(),0);
  for(const entry of canvas.texts){const left=entry.x-(entry.align==='center'?entry.width/2:entry.align==='right'?entry.width:0);assert.ok(left>=0&&left+entry.width<=viewport.width+.01,'text fits horizontal screen: '+entry.text);}
  return{renderer,canvas,ui,layout:renderer.interface.layout,text:canvas.texts.map(t=>t.text).join('|')};
}

test('full canvas and HUD exclusions remain unchanged through every centered modal and safe area',()=>{
  for(const viewport of ports){const v=view(),home=render(v,viewport);assert.deepEqual(home.layout.scene,{x:0,y:0,w:viewport.width,h:viewport.height});assert.equal(home.layout.dock,undefined);
    for(const type of ['station','logistics','expansion','settings','restart','stats']){
      const result=render(v,viewport,{modal:{type,stationId:'cup',scroll:0,openedAt:19.9},transfer:{amount:4,dragging:true}}),m=result.layout.modal;
      assert.deepEqual(result.layout.scene,home.layout.scene);assert.deepEqual(result.layout.overlayLayout,home.layout.overlayLayout);
      assert.equal(result.renderer.scene.last.presented.presentation.transfer,null);assert.equal(result.renderer.ghostDrawn,undefined);
      assert.ok(m.y>=result.renderer.interface.top&&m.y+m.h<=viewport.height-(viewport.safeBottom||0));
      const safe=result.renderer.interface.safe;assert.ok(Math.abs(m.x+m.w/2-(safe.x+safe.w/2))<.001);assert.ok(Math.abs(m.y+m.h/2-(safe.y+safe.h/2))<.001);
      assert.ok(!result.renderer.zones.some(z=>/^station:|^transfer-|openLogistics|openExpansion/.test(z.action)));
      assert.equal(result.renderer.actionAt(0,0),'close');assert.equal(result.renderer.actionAt(m.x+4,m.y+m.h/2),'modal-body');
      const close=result.renderer.zones.find(z=>z.action==='close'&&z.w===44);assert.ok(close);assert.equal(result.renderer.actionAt(close.x+22,close.y+22),'close');
    }
  }
});

test('station confirmation uses the reviewed quote, preserves prices and explains locked purchases',()=>{
  const initial=view(),v={...initial,state:{...initial.state,coins:1000},stations:initial.stations.map(s=>s.id==='cup'?{...s,upgrade:{...s.upgrade,available:true,reason:''}}:s)};
  const ready=render(v,ports[0],{modal:{type:'station',stationId:'cup',scroll:0},quotes:quotes(v)});
  assert.ok(ready.renderer.zones.some(z=>z.action==='purchase:reviewed-upgrade'));assert.ok(ready.text.includes('2 → 3 份/秒'));assert.ok(ready.text.includes('仍需拖拽送料'));assert.ok(ready.text.includes('30 金币'));
  const poor={...v,state:{...v.state,coins:2},stations:v.stations.map(s=>s.id==='cup'?{...s,upgrade:{...s.upgrade,available:false,reason:'not-enough-coins'}}:s)};
  const blocked=render(poor,ports[0],{modal:{type:'station',stationId:'cup'},quotes:quotes(poor)});assert.ok(blocked.text.includes('还差 28 金币'));assert.ok(!blocked.renderer.zones.some(z=>z.action.startsWith('purchase:')));
  const stale=quotes(v);stale.upgrade.cost=29;const rejected=render(v,ports[0],{modal:{type:'station',stationId:'cup'},quotes:stale});assert.ok(rejected.renderer.zones.some(z=>z.action==='refreshQuotes'));assert.ok(!rejected.renderer.zones.some(z=>z.action.startsWith('purchase:')));
});

test('short logistics content scrolls while close and purchase targets remain accurately clipped',()=>{
  const initial=view(),v={...initial,state:{...initial.state,coins:10000},transfers:initial.transfers.map(t=>({...t,automation:{...t.automation,available:true,reason:''}})),logisticsUpgrade:{...initial.logisticsUpgrade,available:true,reason:''}};
  const top=render(v,ports[4],{modal:{type:'logistics',scroll:0},quotes:quotes(v)});assert.ok(top.layout.modal.content.scrollMax>0);
  const actions=new Set();for(const scroll of [0,70,130,200,270,340,420,500,10000]){
    const result=render(v,ports[4],{modal:{type:'logistics',scroll},quotes:quotes(v)}),c=result.layout.modal.content;
    for(const z of result.renderer.zones.filter(z=>z.action.startsWith('purchase:'))){assert.ok(z.y>=c.y&&z.y+z.h<=c.y+c.h+.001);assert.ok(z.h>=44);actions.add(z.action);}
    assert.deepEqual(result.layout.scene,top.layout.scene);assert.deepEqual([result.layout.modal.x,result.layout.modal.y,result.layout.modal.w,result.layout.modal.h],[top.layout.modal.x,top.layout.modal.y,top.layout.modal.w,top.layout.modal.h]);
  }
  assert.deepEqual([...actions].sort(),['purchase:reviewed-automate-pop','purchase:reviewed-automate-cup','purchase:reviewed-logistics'].sort());
  const failure=render(v,ports[4],{modal:{type:'logistics',scroll:10000,error:'报价已失效，请重新查看'},quotes:quotes(v)});
  const errorText=failure.canvas.texts.find(t=>t.text==='报价已失效，请重新查看');assert.ok(errorText&&errorText.y<failure.layout.modal.content.y,'purchase errors remain above the scrolling body');
  const automated={...v,transfers:v.transfers.map(t=>({...t,automated:true}))};const result=render(automated,ports[2],{modal:{type:'logistics'},quotes:quotes(automated)});
  assert.ok(result.text.includes('已自动'));assert.ok(!result.renderer.zones.some(z=>z.action.includes('automate-')));
});

test('art and save errors use the status slot without replacing the coin tile',()=>{
  for(const options of [{saveError:'进度暂未保存'}, {artReport:{failed:3,pending:0}}]){
    const result=render(view(),ports[0],options),coin=result.layout.hud.coin,status=result.layout.hud.status;
    const recovery=result.renderer.zones.find(z=>z.action==='retry-save'||z.action==='retry-art');assert.ok(recovery);assert.ok(recovery.y>=status.y);assert.ok(recovery.y>coin.y+coin.h);assert.ok(result.text.includes('出货 '));
    assert.ok(!result.text.includes('先点')&&!result.text.includes('近10秒均速'));
  }
});

test('statistics honor live sampling and final generation never promises a seventh generation',()=>{
  const initial=view(),v={...initial,insights:{...initial.insights,sampling:{...initial.insights.sampling,label:'近10秒实测 · 自动运行'}}};
  const stats=render(v,ports[2],{modal:{type:'stats'}});assert.ok(stats.text.includes('近10秒实测 · 自动运行'));assert.ok(!stats.text.includes('含手动'));
  const final={...v,state:{...v.state,machine:5},expansion:null,transfers:v.transfers.map(t=>({...t,automated:true})),automaticTrial:{complete:true}};
  const done=render(final,ports[2],{modal:{type:'expansion'}});assert.ok(done.text.includes('六代工厂已建成'));assert.ok(!done.text.includes('解锁')&&!done.renderer.zones.some(z=>z.action.startsWith('purchase:')));
});

test('settings retain health text, stored errors and restart scope within reachable scrolling content',()=>{
  const v=view(),all=[];for(const scroll of [0,100,200,300,400,500,10000])all.push(render(v,ports[4],{modal:{type:'settings',scroll},saveError:'设备存储已满',loadError:'已保留原档备份'}).text);
  const text=all.join('|');for(const phrase of ['设备存储已满','已保留原档备份','抵制不良游戏','享受健康生活','旧版工厂兼容迁移'])assert.ok(text.includes(phrase),phrase);
  const restart=render(v,ports[4],{modal:{type:'restart'}});assert.ok(restart.text.includes('旧版原档备份仍会保留'));assert.ok(restart.renderer.zones.some(z=>z.action==='confirmRestart'));
});
