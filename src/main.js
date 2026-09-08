'use strict';
const { Game, CONFIG, formatNumber } = require('./core');
const { createPlatform } = require('./platform');
const { AudioEngine } = require('./audio');
const { Renderer } = require('./renderer');
const { selectCurrentTarget, createExperienceTracker } = require('./experience');
const { selectOfflineSummary } = require('./offline-summary');
const { selectNextStep } = require('./next-step');

const platform = createPlatform();
const canvas = platform.canvas;
const ctx = canvas.getContext('2d');
const sound = new AudioEngine();
const initialSave=platform.load();
let initialLoadError=platform.lastStorageError;
let game = new Game({ save: initialSave });
const experience = createExperienceTracker({initialView:game.getView(),track:(event,data)=>platform.track(event,data)});
const renderer = new Renderer(ctx);
const ui = { tab:'upgrades', modal:null, toast:'', toastSeconds:0, adBusy:false, saved:false, isDouyin:platform.isDouyin,
  startup:true, sidebarBusy:false, sidebar:{supported:false,checking:false,fromSidebar:false} };
// Only display real identifiers explicitly supplied in the local release configuration.
const publication=platform.config&&platform.config.publication||{};
ui.publication=[['批准文号',publication.approvalNumber],['网络游戏出版号',publication.publicationNumber],['著作权登记号',publication.copyrightNumber]]
  .filter(([,value])=>typeof value==='string'&&value.trim()).map(([label,value])=>`${label}：${value.trim().slice(0,100)}`);
let scale=1, ox=0, oy=0, ratio=1, width=480, height=920;
let hidden=false, hideForAd=false, lastTime=0, saveTimer=0, toastSaveFailed=false, pointer=null;
const reasons={
  'not-enough-coins':'金币还差一点，继续生产吧', 'orders-required':'先完成所需主线订单', 'max-level':'这项升级已经满级',
  'max-machine':'全部设备已经落成', 'order-not-ready':'再生产一些，就能装车了', 'intro-first':'先熟悉工厂，营业 90 秒后开放激励',
  'no-offline-reward':'离线收益已经领取', 'already-affordable':'金币足够，可以直接换代',
  'production-required':'先提升自动生产能力', 'already-claimed':'这份奖励已经到账', 'stale-order':'订单已结算，奖励不会重复领取',
  'stale-offline':'离线收益已变化，请重新查看', 'unknown-reward':'这次奖励已失效，请重新选择', 'busy':'广告正在处理中',
  'unavailable':'广告暂不可用，工厂仍可正常生产', 'cancelled':'未完整观看，未发放广告奖励', 'failed':'广告加载失败，请稍后再试',
  'timeout':'广告响应超时，工厂可继续营业',
  'unknown-quest':'这项成长任务不存在', 'quest-locked':'领取上一章全部奖励后解锁', 'quest-not-ready':'目标还未达成，继续经营吧',
  'brand-machine-required':'换代至电热锅后开放品牌合作', 'brand-stage-cap':'本阶段合作已完成，换代后再开放两级',
  'brand-max-level':'品牌合作已满级，永久收益持续生效', 'stale-brand':'合作等级已变化，请重新查看收益',
  'invalid-production-mode':'请选择工厂中提供的生产档位', 'production-mode-locked':'双缸机后开放生产档位',
  'bulk-upgrade-locked':'多头机后开放批量升级', 'invalid-upgrade-batch':'请重新选择升级数量',
  'stale-upgrade':'升级报价已变化，请查看后重新购买', 'machine-fund-reserved':'已保留换代金币，批量升级只使用余额',
  'refinement-locked':'开动流水线后解锁工艺强化', 'refinement-stage-locked':'继续完成订单，开放下一阶段工艺',
  'stale-refinement':'工艺报价已变化，请重新查看', 'invalid-refinement':'请选择面板中的工艺', 'invalid-refinement-quote':'请重新查看工艺报价',
  'delivery-locked':'第 11 张主线订单开放分段交付', 'delivery-not-ready':'继续生产，达到本段要求后交付',
  'stale-delivery':'本单已变化，请重新查看交付进度', 'delivery-claimed':'这段货款已经到账',
  'commission-locked':'完成第 10 张主线订单后开放委托', 'commission-active':'先完成或放弃当前委托',
  'commission-limit':'本单委托已领完，下一张主单再来', 'commission-not-ready':'委托还未达成，继续经营吧',
  'stale-commission':'委托已变化，请重新查看', 'souvenir-locked':'主线竣工并建成爆米花塔后开放收藏',
  'souvenir-stage-locked':'继续完成循环订单，解锁这件收藏', 'souvenir-owned':'这件收藏已经陈列在工厂',
  'stale-souvenir':'收藏报价已变化，请重新查看', 'already-owned':'这件收藏已经陈列在工厂',
  'loops-required':'继续完成循环订单，解锁这件收藏', 'invalid-souvenir':'请选择面板中的收藏',
  'invalid-delivery':'请重新查看本单交付进度', 'invalid-commission':'请选择面板中的委托'
};
function toast(message,kind='general') {ui.toast=message;ui.toastSeconds=3.5;ui.toastKind=kind;}
function formatIncome(value) {return value<1000?value.toFixed(2).replace(/\.?0+$/,''):formatNumber(value);}
function save() {
  const ok=platform.save(game.exportSave());ui.saved=ok;
  if(!ok&&!toastSaveFailed){toast('当前进度暂未保存，请检查设备存储空间');toastSaveFailed=true;}
  if(ok)toastSaveFailed=false;
  return ok;
}
function closeModal() {if(ui.adBusy)return;if(ui.modal&&ui.modal.quote)game.cancelReward(ui.modal.quote.id);ui.modal=null;save();}
function openModal(type,focusUpgrade='') {
  if(ui.adBusy)return;closeModal();ui.modal={type,...(type==='upgrades'?{quantity:1}:{})};
  const view=game.getView();
  if(type==='commissions')ui.modal.commissionQuotes=Object.fromEntries(view.commissions.options.map(option=>[option.kind,{...option}]));
  if(type==='souvenirs')ui.modal.souvenirQuotes=Object.fromEntries(view.souvenirs.options.map(option=>[option.key,{...option}]));
  ui.focusUpgrade=type==='upgrades'&&['tap','auto','value'].includes(focusUpgrade)?focusUpgrade:'';sound.play('click');
}
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
  const top=platform.isDouyin?Math.max(0,Number.isFinite(safe.top)?safe.top:info.statusBarHeight||0):0;
  const bottom=platform.isDouyin?Math.max(0,height-(safe.bottom||height))+6:0;
  // Safe areas constrain controls, not the scene background. Keep drawing and
  // pointer coordinates in the same full-height logical viewport.
  const menu=info.menuButton;
  const menuBottom=platform.isDouyin?(menu?menu.bottom:top+40):0;
  scale=1;const contentWidth=Math.min(width,480);ox=(width-contentWidth)/2;oy=0;
  ui.viewport={width:contentWidth,height:height-bottom,safeTop:top,menuBottom};renderer.viewport=ui.viewport;
}
function processEvents() {
  const events=game.drainEvents();experience.recordEvents(events,game.getView());
  for(const e of events){
    if(e.type==='produce'){
      if(e.source==='tap'){renderer.emit(e);sound.play('pop');}
      else if(e.source==='auto')renderer.emit(e);
    }else{
      renderer.emit(e);sound.play(e.type==='evolve'?'machine':['quest','upgradeBatch','refinement','delivery','souvenir'].includes(e.type)||e.type==='commission'&&e.action==='claim'?'upgrade':['productionMode','commission'].includes(e.type)?'click':e.type);
      platform.track(e.type,e);
      if(e.type==='burst'){
        // Settlement replaces the earlier timing acknowledgement, so its actual
        // reward is visible even when the player immediately finishes the pot.
        if(ui.toastKind==='timing'){ui.toast='';ui.toastSeconds=0;ui.toastKind='';}
        if(game.state.settings.haptics)platform.vibrate();
      }
      if(e.type==='evolve')toast(`${e.name}开动！自动金币/秒 ${formatIncome(e.incomeBefore)} → ${formatIncome(e.incomeAfter)}`);
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
  if(!offer||!offer.available){toast(reasons[offer&&offer.reason]||'本次激励暂不可用');return;}
  closeModal();const quote=game.quoteReward(kind);
  if(!quote){toast('奖励正在准备，请稍后再试');return;}
  ui.modal={type:'reward',quote,impact:JSON.parse(JSON.stringify(offer.impact||null))};platform.track('reward_offer',{kind,amount:quote.amount});save();
}
async function watch(simulate) {
  if(ui.adBusy||!ui.modal||!ui.modal.quote)return;
  const quote=ui.modal.quote;ui.adBusy=true;save();
  experience.recordAdRequest(quote.kind,game.getView());
  let response;
  try{response=await platform.reward(quote.kind,simulate?{simulate}:undefined);}catch(_){response={completed:false,reason:'failed'};}
  experience.recordAdResult(quote.kind,response,game.getView());
  ui.adBusy=false;
  if(response.completed){
    ui.modal=null;const applied=game.applyReward(quote.id);
    if(result(applied)){
      if(quote.kind==='brand'){
        ui.modal={type:'brand'};ui.tab='brand';
        toast('合作升至 Lv.'+applied.brandLevel+'！生产效率永久 +'+applied.bonusPercent+'%');
      }else toast(quote.kind==='turbo'?'涡轮启动！自动生产 3 倍，持续 90 秒':'奖励到账 +'+formatNumber(applied.coins)+' 金币');
      platform.track('reward_granted',{kind:quote.kind,coins:applied.coins,...(quote.kind==='brand'?{brandLevel:applied.brandLevel,bonusPercent:applied.bonusPercent}:{})});
    }
  }else{
    game.cancelReward(quote.id);
    ui.modal=quote.kind==='order'?{type:'order'}:quote.kind==='offline'&&game.state.offline?{type:'offline'}:quote.kind==='sponsor'?{type:'machine'}:quote.kind==='brand'?{type:'brand'}:null;
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
  if(action==='goalExpand'||action==='goalCollapse'){
    if(ui.modal)return;
    if(action==='goalCollapse'){
      const view=game.getView(),step=selectNextStep(view,selectCurrentTarget(view,ui),ui);
      if(step.kind==='mode')ui.dismissedModeSuggestion=step.id;
    }
    ui.goalExpanded=action==='goalExpand';pointer=null;sound.play('click');return;
  }
  if(action==='skipHeatLesson'){
    if(result(game.dismissHeatRecoveryGuide())){ui.modal=null;ui.goalExpanded=undefined;toast('已跳过练习，余热能力仍然生效');}return;
  }
  if(action==='practiceHeat'){closeModal();ui.goalExpanded=undefined;return;}
  if(action.startsWith('delivery:')){
    if(!ui.modal||ui.modal.type!=='order')return;
    const parts=action.split(':');if(parts.length!==3)return;
    const delivery=game.claimDelivery(Number(parts[2]),Number(parts[1]));
    if(result(delivery))toast('分段货款 +'+formatNumber(delivery.coins)+' 金币已到账');
    return;
  }
  if(action.startsWith('commissionAccept:')){
    if(!ui.modal||ui.modal.type!=='commissions')return;
    const rest=action.slice('commissionAccept:'.length),separator=rest.indexOf(':');if(separator<0)return;
    const kind=rest.slice(0,separator),id=rest.slice(separator+1),quote=ui.modal.commissionQuotes&&ui.modal.commissionQuotes[kind];
    if(!quote||quote.id!==id)return;
    if(result(game.acceptCommission(kind,quote))){closeModal();ui.goalExpanded=true;toast('委托已接下，可从订单查看进度');}
    return;
  }
  if(action.startsWith('commissionClaim:')){
    if(!ui.modal||ui.modal.type!=='commissions')return;
    const claimed=game.claimCommission(action.slice('commissionClaim:'.length));
    if(result(claimed)){openModal('commissions');toast('委托完成 +'+formatNumber(claimed.coins)+' 金币');}
    return;
  }
  if(action.startsWith('commissionCancel:')){
    if(!ui.modal||ui.modal.type!=='commissions')return;
    if(result(game.cancelCommission(action.slice('commissionCancel:'.length)))){openModal('commissions');toast('已放弃本次委托，可重新选择');}
    return;
  }
  if(action.startsWith('souvenir:')){
    if(!ui.modal||ui.modal.type!=='souvenirs')return;
    const key=action.slice('souvenir:'.length),quote=ui.modal.souvenirQuotes&&ui.modal.souvenirQuotes[key];
    if(!quote)return;
    const purchased=game.buySouvenir(key,quote);
    if(result(purchased)){openModal('souvenirs');toast('收藏已陈列在工厂');}
    return;
  }
  if(action.startsWith('modeAdvice:')){
    if(ui.modal)return;
    const view=game.getView(),step=selectNextStep(view,selectCurrentTarget(view,ui),ui);
    if(step.kind!=='mode'||step.id!==action.slice(11))return;
    ui.dismissedModeSuggestion=step.id;
    openModal('productionModes');ui.modal.advice={id:step.id,modeId:step.modeId,bottleneck:step.bottleneck};
    platform.track('mode_advice_open',{id:step.id,mode:step.modeId});return;
  }
  if(action==='refinements'){
    if(!game.getView().refinements.unlocked){toast(reasons['refinement-locked']);return;}
    openModal('refinements');return;
  }
  if(action.startsWith('refinement:')){
    if(!ui.modal||ui.modal.type!=='refinements')return;
    const parts=action.split(':');if(parts.length!==4)return;
    const purchased=game.buyRefinement(parts[1],{level:Number(parts[2]),cost:Number(parts[3])});
    if(result(purchased))toast(CONFIG.refinements[parts[1]].name+'强化成功 · Lv.'+purchased.level);
    return;
  }
  if(action==='timing'){
    if(ui.modal)return;const attempt=game.tryPerfectBurst();processEvents();
    if(attempt.ok)toast(attempt.perfect?'火候正好！本锅免费爆锅额外 +20%':'这次火候没抓准，仍会正常免费爆锅','timing');
    else toast('每锅一次，能量 80 以上可尝试','timing');return;
  }
  if(action==='productionModes'){
    const view=game.getView();
    if(!view.productionModes.unlocked){toast(reasons['production-mode-locked']);return;}
    const step=selectNextStep(view,null,ui);if(step.kind==='mode')ui.dismissedModeSuggestion=step.id;
    openModal('productionModes');if(step.kind==='mode')ui.modal.advice={id:step.id,modeId:step.modeId,bottleneck:step.bottleneck};
    platform.track('production_mode_open',{machine:view.state.machine,mode:view.productionModes.current});return;
  }
  if(action.startsWith('productionMode:')){
    if(!ui.modal||ui.modal.type!=='productionModes')return;
    const changed=game.setProductionMode(action.slice(15));
    if(result(changed)&&changed.changed){
      const mode=game.getView().productionModes.options.find(item=>item.selected);
      toast(mode.name+'已生效，点击、自动与爆锅一起切换');
    }
    return;
  }
  if(action.startsWith('upgradeQuantity:')){
    if(!ui.modal||ui.modal.type!=='upgrades'||!game.getView().milestones.bulkUpgrade.unlocked)return;
    const quantity=Number(action.slice(16));if(quantity!==1&&quantity!==CONFIG.bulkUpgradeMaxCount)return;
    ui.modal.quantity=quantity;sound.play('click');return;
  }
  if(action.startsWith('upgradeBatch:')){
    if(!ui.modal||ui.modal.type!=='upgrades'||ui.modal.quantity!==CONFIG.bulkUpgradeMaxCount)return;
    const parts=action.split(':');if(parts.length!==5)return;
    const [,key,fromLevel,count,cost]=parts;
    const purchased=game.buyUpgradeBatch(key,{fromLevel:Number(fromLevel),count:Number(count),cost:Number(cost)});
    if(result(purchased)){
      toast(CONFIG.upgrades[key].name+'连升 '+purchased.count+' 级，已扣 '+formatNumber(purchased.cost)+' 金币');
      platform.track('upgrade_purchase',{kind:key,count:purchased.count,cost:purchased.cost,
        afterReward:game.state.rewardedCount>0&&game.state.playedSeconds-game.state.lastRewardAt<60});
    }
    return;
  }
  if(action.startsWith('fundingUpgrade:')){
    if(!ui.modal||ui.modal.type!=='machine')return;
    const step=selectNextStep(game.getView(),null,{suppressModeAdvice:true});
    if(step.kind!=='upgrade'||!step.enabled||!step.estimate||step.upgradeKey!==action.slice(15))return;
    openModal('upgrades',step.upgradeKey);return;
  }
  if(action==='target'){
    const target=selectCurrentTarget(game.getView(),ui);if(!target||!target.action)return;
    if(target.action.startsWith('upgrade:'))openModal('upgrades',target.action.slice(8));
    else act(target.action);return;
  }
  if(action.startsWith('questPage:')){if(ui.modal&&ui.modal.type==='quests')ui.modal.page=Number(action.slice(10))||0;return;}
  if(action.startsWith('blueprintPage:')){if(ui.modal&&ui.modal.type==='blueprint')ui.modal.page=Number(action.slice(14))||0;return;}
  if(action==='tap'){if(!ui.modal){game.tap();processEvents();}return;}
  if(action.startsWith('tab:')){ui.tab=action.slice(4);openModal(({machines:'machine',upgrades:'upgrades',stats:'stats',brand:'brand'})[ui.tab]||'workshop');return;}
  if(action.startsWith('upgrade:')){const key=action.slice(8);if(result(game.buyUpgrade(key)))platform.track('upgrade_purchase',{kind:key,afterReward:game.state.rewardedCount>0&&game.state.playedSeconds-game.state.lastRewardAt<60});return;}
  if(action.startsWith('questChapter:')){
    const chapterId=action.slice(13);
    if(ui.modal&&ui.modal.type==='quests'&&game.getView().quests.chapters.some(chapter=>chapter.id===chapterId)){
      ui.modal.chapterId=chapterId;ui.modal.page=0;sound.play('click');
    }
    return;
  }
  if(action.startsWith('questClaim:')){
    const claimed=game.claimQuest(action.slice(11));
    if(result(claimed))toast(claimed.title+' · +'+formatNumber(claimed.coins)+' 金币已到账');
    return;
  }
  if(action.startsWith('questGo:')){
    const id=action.slice(8),quest=game.getView().quests.chapters.flatMap(chapter=>chapter.quests).find(item=>item.id===id);
    if(!quest||quest.locked||quest.claimed)return;
    closeModal();ui.questGuideId=id;
    // Task shortcuts reveal the actual control; purchases still need their own tap.
    if(quest.action.startsWith('upgrade:')){ui.tab='upgrades';openModal('upgrades',quest.action.slice(8));}
    else if(quest.action.startsWith('tab:'))ui.tab=quest.action.slice(4);
    else if(quest.action==='order'||quest.action==='machine')openModal(quest.action);
    toast(quest.hint);return;
  }
  if(action==='quests'){
    openModal('quests');ui.modal.chapterId=game.getView().quests.activeChapterId;return;
  }
  if(action.startsWith('ad:')){const kind=action.slice(3);experience.recordAdClick(kind,game.getView(),{placement:ui.modal?ui.modal.type:'home'});offerReward(kind);return;}
  if(action.startsWith('simulate:')){watch(action.slice(9));return;}
  if(action.startsWith('setting:')){const key=action.slice(8);game.setSetting(key,!game.state.settings[key]);configure();if(game.state.settings.sound)sound.play('click');save();return;}
  if(action==='watch'){watch();return;}
  if(action==='visitSidebar'){visitSidebar();return;}
  if(action==='close'){closeModal();return;}
  if(action==='claimOrder'){ui.modal=null;const claimed=game.claimOrder();if(result(claimed)){toast(`订单已发车，到账 +${formatNumber(claimed.coins)} 金币`);if(game.state.orderIndex%4===0)maybeInterstitial();}return;}
  if(action==='claimOffline'){const summary=selectOfflineSummary(game.getView());ui.modal=null;if(result(game.claimOffline()))toast('离线收益已到账'+(summary?' · '+summary.nextStep.title.replace('领取后',''):''));return;}
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
platform.onHide(()=>{hideForAd=ui.adBusy;hidden=true;pointer=null;sound.setEnabled(false);experience.observe(game.getView(),{visible:false,target:null});save();});
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
    if(e.code==='Escape'){
      if(!ui.modal&&renderer.interface&&renderer.interface.isGoalExpanded(game.getView(),ui))act('goalCollapse');
      else act('close');
      return;
    }
    if(ui.modal)return;
    const keys={Space:'tap',Digit1:'upgrade:tap',Digit2:'upgrade:auto',Digit3:'upgrade:value',KeyO:'order',KeyM:'machine',KeyQ:'quests',KeyB:'brand',KeyP:'productionModes'};
    if(keys[e.code]){e.preventDefault();act(keys[e.code]);}
  });
  // Read-only diagnostics for QA; no cheats or developer controls in the player flow.
  globalThis.__POPCORN__={snapshot:()=>JSON.parse(JSON.stringify(game.getView())),analytics:()=>platform.getAnalytics(),experience:()=>experience.export(),version:'1.0.0'};
}
restore();resize(platform.getSystemInfo());platform.track('session_start',{isDouyin:platform.isDouyin});
if(typeof platform.checkSidebar==='function')platform.checkSidebar().catch(()=>{});
const runtimeGlobal=typeof globalThis!=='undefined'?globalThis:GameGlobal;
const requestFrame=typeof requestAnimationFrame==='function'?requestAnimationFrame.bind(runtimeGlobal):cb=>setTimeout(()=>cb(Date.now()),1000/30);
function frame(time) {
  const dt=lastTime?Math.max(0,Math.min(60,(time-lastTime)/1000)):0;lastTime=time;
  if(!hidden){
    if(!ui.adBusy){
      if(!ui.startup){game.tick(dt);processEvents();}
      saveTimer+=dt;if(saveTimer>=5){saveTimer=0;save();}
    }
    if(!ui.startup&&ui.toastSeconds>0){ui.toastSeconds-=dt;if(ui.toastSeconds<=0)ui.toast='';}
    if(typeof platform.getSidebarState==='function')ui.sidebar=platform.getSidebarState();
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.fillStyle='#e9eee5';ctx.fillRect(0,0,width,height);
    // Subtle vertical rails make the portrait canvas feel intentional on wide screens.
    if(width>ui.viewport.width+60){ctx.strokeStyle='#dce3d7';ctx.lineWidth=1;for(const x of [ox-22,ox+ui.viewport.width+22]){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}}
    const view=game.getView();ui.sceneDt=dt;
    const cueVisible=!ui.startup&&!ui.modal&&!ui.adBusy;
    const cueReady=cueVisible&&view.timing.unlocked&&!view.timing.attempted&&!view.timing.armed&&view.energy>=CONFIG.timingWindowStart&&view.energy<=CONFIG.timingWindowEnd;
    if(cueReady&&ui.heatCueBurst!==view.state.bursts){ui.heatCueBurst=view.state.bursts;sound.play('heatReady');}
    ctx.setTransform(ratio*scale,0,0,ratio*scale,ratio*ox,ratio*oy);renderer.draw(view,ui,Math.min(.05,dt));
    const homeVisible=!ui.startup&&!ui.adBusy&&!ui.modal,sceneInterface=renderer.interface;
    experience.observe(view,{visible:!ui.startup&&!ui.adBusy,modalType:ui.modal&&ui.modal.type,target:homeVisible&&sceneInterface?sceneInterface.visibleTarget:null,adEntries:sceneInterface?sceneInterface.adEntries:[],recommendation:homeVisible&&sceneInterface?sceneInterface.recommendation:null});
  }
  requestFrame(frame);
}
requestFrame(frame);

