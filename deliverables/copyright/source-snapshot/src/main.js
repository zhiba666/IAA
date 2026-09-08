'use strict';
const { Game, CONFIG, formatNumber } = require('./core');
const { createPlatform } = require('./platform');
const { AudioEngine } = require('./audio');
const { Renderer } = require('./renderer');

const platform = createPlatform();
const canvas = platform.canvas;
const ctx = canvas.getContext('2d');
const sound = new AudioEngine();
const initialSave=platform.load();
let initialLoadError=platform.lastStorageError;
let game = new Game({ save: initialSave });
const renderer = new Renderer(ctx);
const ui = { tab:'upgrades', modal:null, toast:'', toastSeconds:0, adBusy:false, saved:false, isDouyin:platform.isDouyin,
  startup:true, sidebarBusy:false, sidebar:{supported:false,checking:false,fromSidebar:false} };
// Only display real identifiers explicitly supplied in the local release configuration.
const publication=platform.config&&platform.config.publication||{};
ui.publication=[['批准文号',publication.approvalNumber],['网络游戏出版号',publication.publicationNumber],['著作权登记号',publication.copyrightNumber]]
  .filter(([,value])=>typeof value==='string'&&value.trim()).map(([label,value])=>`${label}：${value.trim().slice(0,100)}`);
let scale=1, ox=0, oy=0, ratio=1, width=480, height=920;
let hidden=false, hideForAd=false, lastTime=0, saveTimer=0, autoParticleTimer=0, toastSaveFailed=false, pointer=null;
const reasons={
  'not-enough-coins':'金币还差一点，继续生产吧', 'orders-required':'先完成所需主线订单', 'max-level':'这项升级已经满级',
  'max-machine':'全部设备已经落成', 'order-not-ready':'再生产一些，就能装车了', 'intro-first':'先熟悉工厂，营业 90 秒后开放激励',
  'reward-cooldown':'激励正在准备，请稍后再来', 'no-offline-reward':'离线收益已经领取', 'already-affordable':'金币足够，可以直接换代',
  'production-required':'先提升自动生产能力', 'already-claimed':'这份奖励已经到账', 'stale-order':'订单已结算，奖励不会重复领取',
  'stale-offline':'离线收益已变化，请重新查看', 'unknown-reward':'这次奖励已失效，请重新选择', 'busy':'广告正在处理中',
  'unavailable':'广告暂不可用，工厂仍可正常生产', 'cancelled':'未完整观看，未发放广告奖励', 'failed':'广告加载失败，请稍后再试',
  'timeout':'广告响应超时，工厂可继续营业'
};
function toast(message) {ui.toast=message;ui.toastSeconds=3.5;}
function save() {
  const ok=platform.save(game.exportSave());ui.saved=ok;
  if(!ok&&!toastSaveFailed){toast('当前进度暂未保存，请检查设备存储空间');toastSaveFailed=true;}
  if(ok)toastSaveFailed=false;
  return ok;
}
function closeModal() {if(ui.adBusy)return;if(ui.modal&&ui.modal.quote)game.cancelReward(ui.modal.quote.id);ui.modal=null;save();}
function openModal(type) {if(ui.adBusy)return;closeModal();ui.modal={type};sound.play('click');}
function configure() {sound.setEnabled(game.state.settings.sound);}
function restore() {
  configure();
  // Pending quotes survive snapshots only to guarantee unique identifiers. A restarted app
  // has no verified SDK completion callback, so it must discard unfulfilled requests.
  for(const id of Object.keys(game.state.pendingRewards))game.cancelReward(id);
  ui.modal=game.state.offline&&game.state.offline.coins>0?{type:'offline'}:null;
  if(game.loadWarning)toast(game.loadWarning);
  else if(initialLoadError){toast('存档读取失败，已安全开始新工厂');initialLoadError='';}
  save();
}
function resize(info) {
  width=info.width;height=info.height;ratio=Math.min(2,info.pixelRatio||1);
  canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
  const safe=info.safeArea||{};
  const top=platform.isDouyin?Math.max(0,safe.top||0)+18:0;
  const bottom=platform.isDouyin?Math.max(0,height-(safe.bottom||height))+6:0;
  scale=Math.min(width/480,(height-top-bottom)/920);ox=(width-480*scale)/2;oy=top+(height-top-bottom-920*scale)/2;
}
function processEvents() {
  for(const e of game.drainEvents()){
    if(e.type==='produce'){
      if(e.source==='tap'){renderer.emit(e);sound.play('pop');}
      else if(e.source==='auto'&&autoParticleTimer>=.12){renderer.emit(e);autoParticleTimer=0;}
    }else{
      renderer.emit(e);sound.play(e.type==='evolve'?'machine':e.type);
      platform.track(e.type,e);
      if(e.type==='burst'&&game.state.settings.haptics)platform.vibrate();
      if(e.type==='evolve')toast(`${game.getView().machine.name}开动了！`);
      if(e.type==='complete')ui.modal={type:'completion'};
    }
  }
}
function result(actionResult) {
  if(!actionResult||!actionResult.ok){if(actionResult)toast(reasons[actionResult.reason]||'暂时无法操作，请稍后再试');return false;}
  processEvents();save();return true;
}
function offerReward(kind) {
  const view=game.getView(),offer=view.rewards[kind];
  if(!offer||!offer.available){toast(offer&&offer.reason==='reward-cooldown'?`下次激励还需 ${Math.ceil(offer.cooldown)} 秒`:reasons[offer&&offer.reason]||'本次激励暂不可用');return;}
  closeModal();const quote=game.quoteReward(kind);
  if(!quote){toast('奖励正在准备，请稍后再试');return;}
  ui.modal={type:'reward',quote};platform.track('reward_offer',{kind,amount:quote.amount});save();
}
async function watch(simulate) {
  if(ui.adBusy||!ui.modal||!ui.modal.quote)return;
  const quote=ui.modal.quote;ui.adBusy=true;save();
  let response;
  try{response=await platform.reward(quote.kind,simulate?{simulate}:undefined);}catch(_){response={completed:false,reason:'failed'};}
  ui.adBusy=false;
  if(response.completed){
    ui.modal=null;const applied=game.applyReward(quote.id);
    if(result(applied)){toast(quote.kind==='turbo'?'涡轮启动！自动生产 3 倍，持续 90 秒':`奖励到账 +${formatNumber(applied.coins)} 金币`);platform.track('reward_granted',{kind:quote.kind,coins:applied.coins});}
  }else{
    game.cancelReward(quote.id);
    ui.modal=quote.kind==='order'?{type:'order'}:quote.kind==='offline'&&game.state.offline?{type:'offline'}:quote.kind==='sponsor'?{type:'machine'}:null;
    toast(reasons[response.reason]||'广告未完成，奖励未领取');save();
  }
  lastTime=0;
}
async function maybeInterstitial() {
  if(ui.adBusy||hidden||ui.modal)return;
  ui.adBusy=true;
  try{await platform.interstitial();}finally{ui.adBusy=false;lastTime=0;save();}
}
async function visitSidebar() {
  if(ui.sidebarBusy||typeof platform.navigateSidebar!=='function')return;
  ui.sidebarBusy=true;save();
  try {
    // Invoke the native API within this click stack, before the first await.
    const response=await platform.navigateSidebar();
    if(!response.ok)toast(response.reason==='checking'?'入口正在准备，请稍后再试':'暂时无法打开侧边栏，请稍后再试');
  }catch(_){toast('暂时无法打开侧边栏，请稍后再试');}
  finally{ui.sidebarBusy=false;}
}
function act(action) {
  if(!action||ui.adBusy)return;
  if(ui.startup){
    if(action==='start'){ui.startup=false;pointer=null;lastTime=0;sound.unlock();save();}
    return;
  }
  sound.unlock();
  if(action==='tap'){if(!ui.modal){game.tap();processEvents();}return;}
  if(action.startsWith('tab:')){ui.tab=action.slice(4);sound.play('click');return;}
  if(action.startsWith('upgrade:')){const key=action.slice(8);if(result(game.buyUpgrade(key)))platform.track('upgrade_purchase',{kind:key,afterReward:game.state.playedSeconds-game.state.lastRewardAt<60});return;}
  if(action.startsWith('ad:')){offerReward(action.slice(3));return;}
  if(action.startsWith('simulate:')){watch(action.slice(9));return;}
  if(action.startsWith('setting:')){const key=action.slice(8);game.setSetting(key,!game.state.settings[key]);configure();if(game.state.settings.sound)sound.play('click');save();return;}
  if(action==='watch'){watch();return;}
  if(action==='visitSidebar'){visitSidebar();return;}
  if(action==='close'){closeModal();return;}
  if(action==='claimOrder'){ui.modal=null;if(result(game.claimOrder())){toast('订单已发车，金币到账！');if(game.state.orderIndex%4===0)maybeInterstitial();}return;}
  if(action==='claimOffline'){ui.modal=null;if(result(game.claimOffline()))toast('离线收益已领取，欢迎回来！');return;}
  if(action==='evolve'){ui.modal=null;if(result(game.evolve())){ui.tab='machines';maybeInterstitial();}return;}
  if(action==='completion'&&!game.getView().completed){toast('完成 20 个主线订单后，可获得竣工纪念');return;}
  openModal(action);
}

platform.onPointer(e=>{
  const x=(e.x-ox)/scale,y=(e.y-oy)/scale;
  if(e.type==='down'){
    if(pointer)return;
    const action=renderer.actionAt(x,y);pointer={id:e.id,action,x,y};
    // Production responds immediately. Reward/navigation buttons activate on release,
    // so repeated production taps cannot drift into an ad request.
    if(action==='tap')act(action);
  }else if((e.type==='up'||e.type==='cancel')&&pointer&&pointer.id===e.id){
    const p=pointer;pointer=null;
    if(e.type==='up'&&p.action!=='tap'&&renderer.actionAt(x,y)===p.action&&Math.hypot(x-p.x,y-p.y)<20)act(p.action);
  }
});
platform.onResize(resize);
platform.onHide(()=>{hideForAd=ui.adBusy;hidden=true;pointer=null;sound.setEnabled(false);save();});
platform.onShow(()=>{
  hidden=false;lastTime=0;
  const settledAdAbsence=hideForAd&&!ui.adBusy&&(Date.now()-game.state.savedAt)>=CONFIG.offlineMinSeconds*1000;
  if(!hideForAd||settledAdAbsence){const snapshot=game.exportSave(game.state.savedAt);game=new Game({save:snapshot});restore();platform.track('session_resume',{});}
  hideForAd=false;
  configure();
});
// The Douyin IDE also exposes browser globals, but tt canvases have no DOM API.
if(!platform.isDouyin&&typeof document!=='undefined'){
  canvas.id='game';canvas.setAttribute('aria-label','小小爆米花厂游戏画面');canvas.setAttribute('role','application');canvas.tabIndex=0;
  const loading=document.getElementById('loading');if(loading)loading.remove();
  window.addEventListener('keydown',e=>{
    if(ui.startup){if(e.code==='Enter'){e.preventDefault();act('start');}return;}
    if(e.repeat&&e.code!=='Space')return;
    if(e.code==='Escape'){act('close');return;}
    if(ui.modal)return;
    const keys={Space:'tap',Digit1:'upgrade:tap',Digit2:'upgrade:auto',Digit3:'upgrade:value',KeyO:'order',KeyM:'machine'};
    if(keys[e.code]){e.preventDefault();act(keys[e.code]);}
  });
  // Read-only diagnostics for QA; no cheats or developer controls in the player flow.
  globalThis.__POPCORN__={snapshot:()=>JSON.parse(JSON.stringify(game.getView())),analytics:()=>platform.getAnalytics(),version:'1.0.0'};
}
restore();resize(platform.getSystemInfo());platform.track('session_start',{isDouyin:platform.isDouyin});
if(typeof platform.checkSidebar==='function')platform.checkSidebar().catch(()=>{});
const runtimeGlobal=typeof globalThis!=='undefined'?globalThis:GameGlobal;
const requestFrame=typeof requestAnimationFrame==='function'?requestAnimationFrame.bind(runtimeGlobal):cb=>setTimeout(()=>cb(Date.now()),1000/30);
function frame(time) {
  const dt=lastTime?Math.max(0,Math.min(60,(time-lastTime)/1000)):0;lastTime=time;
  if(!hidden){
    if(!ui.adBusy){
      if(!ui.startup){game.tick(dt);autoParticleTimer+=dt;processEvents();}
      saveTimer+=dt;if(saveTimer>=5){saveTimer=0;save();}
    }
    if(!ui.startup&&ui.toastSeconds>0){ui.toastSeconds-=dt;if(ui.toastSeconds<=0)ui.toast='';}
    if(typeof platform.getSidebarState==='function')ui.sidebar=platform.getSidebarState();
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.fillStyle='#e9eee5';ctx.fillRect(0,0,width,height);
    // Subtle vertical rails make the portrait canvas feel intentional on wide screens.
    if(width>480*scale+60){ctx.strokeStyle='#dce3d7';ctx.lineWidth=1;for(const x of [ox-22,ox+480*scale+22]){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}}
    ctx.setTransform(ratio*scale,0,0,ratio*scale,ratio*ox,ratio*oy);renderer.draw(game.getView(),ui,Math.min(.05,dt));
  }
  requestFrame(frame);
}
requestFrame(frame);
