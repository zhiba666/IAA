'use strict';
const { Game, CONFIG, formatNumber } = require('./core');
const { createPlatform } = require('./platform');
const { AudioEngine } = require('./audio');
const { Renderer } = require('./renderer');
const { selectCurrentTarget, createExperienceTracker } = require('./experience');
const { selectOfflineSummary } = require('./offline-summary');
const { selectNextStep } = require('./next-step');

const platform = createPlatform();
const developerHoldTap = platform.config && platform.config.developerHoldTap === true;
const HOLD_DELAY_MS = 350, HOLD_INTERVAL_MS = 10, MAX_HOLD_TAPS_PER_FRAME = 100;
const canvas = platform.canvas;
const ctx = canvas.getContext('2d');
const sound = new AudioEngine();
const initialSave=platform.load();
let initialLoadError=platform.lastStorageError;
let game = new Game({ save: initialSave });
let experience = createExperienceTracker({initialView:game.getView(),track:(event,data)=>platform.track(event,data)});
let renderer = new Renderer(ctx);
function createUI() { return { modal:null, toast:'', toastSeconds:0, adBusy:false, isDouyin:platform.isDouyin,
  startup:true, guideIdleSeconds:0, guideKey:'', sidebarBusy:false, sidebar:{supported:false,checking:false,fromSidebar:false} }; }
let ui = createUI();
// Only display real identifiers explicitly supplied in the local release configuration.
const publication=platform.config&&platform.config.publication||{};
ui.publication=[['批准文号',publication.approvalNumber],['网络游戏出版号',publication.publicationNumber],['著作权登记号',publication.copyrightNumber]]
  .filter(([,value])=>typeof value==='string'&&value.trim()).map(([label,value])=>`${label}：${value.trim().slice(0,100)}`);
let ox=0, ratio=1, width=480, height=920;
let hidden=false, hideForAd=false, lastTime=0, saveTimer=0, toastSaveFailed=false, pointer=null;
const PANELS = new Set(['upgrades','order','machine','quests','workshop','settings','help','privacy','health','stats','blueprint','completion','brand','turbo','offline','heatLesson','souvenirs','modules','sidebar','guidebook']);
const reasons={
  'guide-locked':'继续生产和升级，即可解锁这项功能', 'stale-guide':'这条帮助暂不可用，请查看当前目标',
  'not-enough-coins':'金币还差一点，继续生产吧', 'orders-required':'先完成所需主线订单', 'max-level':'这项升级已经满级',
  'max-machine':'全部设备已经落成', 'order-not-ready':'本单要求尚未完成', 'intro-first':'营业 90 秒后开放激励',
  'no-offline-reward':'离线收益已经领取', 'already-affordable':'金币足够，可以直接换代',
  'production-required':'先提升自动生产能力', 'already-claimed':'这份奖励已经到账', 'stale-order':'本单已变化，请重新查看',
  'stale-offline':'离线收益已变化，请重新查看', 'unknown-reward':'这次奖励已失效，请重新选择', 'busy':'广告正在处理中',
  'unavailable':'广告暂不可用，工厂仍可正常生产', 'cancelled':'未完整观看，未发放广告奖励', 'failed':'广告加载失败，请稍后再试',
  'timeout':'广告响应超时，工厂可继续营业',
  'unknown-quest':'这项成长记录不存在', 'quest-locked':'先完成前面的教学', 'quest-not-ready':'目标还未达成',
  'brand-machine-required':'换代至电热锅后开放品牌合作', 'brand-stage-cap':'本阶段合作已完成，换代后再开放两级',
  'brand-max-level':'品牌合作已满级，永久收益持续生效', 'stale-brand':'合作等级已变化，请重新查看',
  'bulk-upgrade-locked':'多头机后开放批量升级', 'invalid-upgrade-batch':'请重新选择升级数量',
  'stale-upgrade':'升级报价已变化，请重新查看', 'machine-fund-reserved':'已保留换代金币，批量升级只使用余额',
  'factory-locked':'开动双缸机后开放设备图鉴', 'module-locked':'完成获取条件后设备自动生效',
  'invalid-module':'请选择图鉴中的设备', 'equipment-permanent':'已获得的设备永久同时生效',
  'contract-active':'先交付或放弃当前订单，再选择客户', 'contract-locked':'开动双缸机后选择客户订单',
  'invalid-contract':'请选择面板中的客户订单', 'stale-contract':'订单报价已变化，请重新打开订单',
  'contract-not-ready':'继续完成本单生产要求', 'contract-required':'先选择一张客户订单',
  'contracts-complete':'所有主线订单已完成', 'game-complete':'工厂已竣工，查看建厂纪念',
  'no-stored-burst':'蓄压罐还没有储存爆锅', 'pressure-required':'完成第 8 单获得蓄压罐', 'pressure-locked':'完成第 8 单获得蓄压罐',
  'invalid-pressure-mode':'请选择自动放锅或手动储压',
  'tap-cooldown':'稍等片刻，再投入下一份原料', 'tap-limit':'本锅原料已投好，等待出锅',
  'souvenir-locked':'主线竣工并建成爆米花塔后开放收藏', 'souvenir-owned':'这件收藏已经陈列在工厂',
  'stale-souvenir':'收藏报价已变化，请重新查看', 'already-owned':'这件收藏已经陈列在工厂',
  'invalid-souvenir':'请选择面板中的收藏'
};
Object.assign(reasons,{'contracts-locked':reasons['contract-locked'],'campaign-complete':reasons['contracts-complete'],
  'stored-burst':'蓄压锅已备好，可以放出整锅','pot-taps-used':reasons['tap-limit'],'machine-required':'先换代设备，再承接下一张订单'});
function toast(message,kind='general') {ui.toast=message;ui.toastSeconds=3.5;ui.toastKind=kind;}
function formatIncome(value) {return value<1000?value.toFixed(2).replace(/\.?0+$/,''):formatNumber(value);}
function save() {
  const ok=platform.save(game.exportSave());
  if(!ok&&!toastSaveFailed){toast('当前进度暂未保存，请检查设备存储空间');toastSaveFailed=true;}
  if(ok)toastSaveFailed=false;
  return ok;
}
function closeModal() {
  if(ui.adBusy)return;
  if(ui.modal&&ui.modal.quote)game.cancelReward(ui.modal.quote.id);
  if(ui.modal&&ui.modal.type==='guide')game.acknowledgeGuide(ui.modal.guideId);
  ui.modal=null;save();
}
function openModal(type,focusUpgrade='') {
  if(ui.adBusy)return;closeModal();ui.modal={type,...(type==='upgrades'?{quantity:1}:{})};
  const view=game.getView();
  if(type==='upgrades'&&!focusUpgrade&&view.onboarding.goal)focusUpgrade=view.onboarding.goal.upgradeKey||'';
  if(type==='order')ui.modal.contractQuotes=Object.fromEntries((view.contracts && view.contracts.options || []).map(option=>[option.kind,JSON.parse(JSON.stringify(option))]));
  if(type==='souvenirs')ui.modal.souvenirQuotes=Object.fromEntries(view.souvenirs.options.map(option=>[option.key,{...option}]));
  ui.focusUpgrade=type==='upgrades'&&['tap','auto','value'].includes(focusUpgrade)?focusUpgrade:'';sound.play('click');
}
function configure() {sound.setEnabled(game.state.settings.sound);}
function restartGame() {
  if(!ui.modal||ui.modal.type!=='restart'||ui.adBusy)return;
  const freshGame=new Game();
  // Replace only this game's save, and keep the current factory if storage fails.
  if(!platform.save(freshGame.exportSave())){toast('删除失败，原进度已保留，请稍后重试');return;}
  game=freshGame;
  renderer=new Renderer(ctx);
  experience=createExperienceTracker({initialView:game.getView(),track:(event,data)=>platform.track(event,data)});
  ui={...createUI(),startup:false,viewport:ui.viewport,publication:ui.publication,sidebar:ui.sidebar,sidebarBusy:ui.sidebarBusy};
  pointer=null;lastTime=0;saveTimer=0;hideForAd=false;toastSaveFailed=false;initialLoadError='';
  configure();
}
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
  pointer=null;
  width=info.width;height=info.height;ratio=Math.min(2,info.pixelRatio||1);
  canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
  const safe=info.safeArea||{};
  const top=platform.isDouyin?Math.max(0,Number.isFinite(safe.top)?safe.top:info.statusBarHeight||0):0;
  const bottom=platform.isDouyin?Math.max(0,height-(safe.bottom||height))+6:0;
  // Safe areas constrain controls, not the scene background. Keep drawing and
  // pointer coordinates in the same full-height logical viewport.
  const menu=info.menuButton;
  const menuBottom=platform.isDouyin?(menu?menu.bottom:top+40):0;
  const contentWidth=Math.min(width,480);ox=(width-contentWidth)/2;
  ui.viewport={width:contentWidth,height:height-bottom,safeTop:top,menuBottom};
}
function processEvents() {
  const events=game.drainEvents();experience.recordEvents(events,game.getView());
  for(const e of events){
    if(e.type==='onboardingPractice'){platform.track('onboarding_practice',e);continue;}
    if(e.type==='produce'){
      if(e.source==='tap'){renderer.emit(e);sound.play('pop');}
      else renderer.emit(e);
    }else if(e.type==='batch'){
      renderer.emit(e);
    }else{
      renderer.emit(e);sound.play(e.type==='evolve'?'machine':['quest','upgradeBatch','souvenir'].includes(e.type)?'upgrade':['contract','module','pressure'].includes(e.type)?'click':e.type);
      platform.track(e.type,e);
      if(e.type==='burst'){
        if(game.state.settings.haptics)platform.vibrate();
      }
      if(e.type==='evolve'){
        ui.toast='';ui.toastSeconds=0;ui.toastKind='';
        if(game.state.settings.haptics)platform.vibrate();
      }
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
        ui.modal={type:'brand'};
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
  if(!action||ui.adBusy||hidden)return;
  if(action!=='tap')pointer=null;
  if(ui.startup){
    if(action==='start'){ui.startup=false;pointer=null;lastTime=0;sound.unlock();save();}
    return;
  }
  sound.unlock();
  ui.guideIdleSeconds=0;
  if(action==='restart'){
    if(ui.modal&&ui.modal.type==='settings')openModal('restart');
    return;
  }
  if(action==='confirmRestart'){restartGame();return;}
  // Help is opened voluntarily. Its controls never perform the action being explained.
  if(ui.modal&&ui.modal.type==='guide'&&action!=='close'&&!action.startsWith('guideContinue:'))return;
  if(action.startsWith('guideContinue:')){
    if(ui.modal&&ui.modal.type==='guide'&&ui.modal.guideId===action.slice(14))closeModal();
    return;
  }
  if(action.startsWith('guideReview:')){
    const id=action.slice(12),onboarding=game.getView().onboarding;
    if(!ui.modal||!['guidebook','help'].includes(ui.modal.type))return;
    const lesson=onboarding.lessons.find(item=>item.id===id);
    if(lesson){ui.modal={type:'guide',guideId:id,replay:true};pointer=null;}
    return;
  }
  if(action==='guideSkip'||action==='guideResume'){
    if(ui.modal&&!['guidebook','help'].includes(ui.modal.type))return;
    if(action==='guideResume'&&!ui.modal)return;
    if(result(game.setOnboardingSkipped(action==='guideSkip'))){
      closeModal();ui.guideKey='';ui.guideIdleSeconds=0;ui.goalExpanded=false;
      platform.track('onboarding_preference',{skipped:action==='guideSkip'});
    }
    return;
  }
  if(action.startsWith('guidePage:')){
    if(ui.modal&&['guidebook','help'].includes(ui.modal.type))ui.modal.page=Math.max(0,Number(action.slice(10))||0);
    return;
  }
  const features=game.getView().onboarding.features;
  const required=action.startsWith('upgrade:')?{tap:'tapUpgrade',auto:'autoUpgrade',value:'valueUpgrade'}[action.slice(8)]
    :action.startsWith('ad:')?'rewards':({upgrades:'tapUpgrade',order:'orders',claimOrder:'orders',quests:'records',workshop:'workshop',
      machine:'workshop',blueprint:'workshop',evolve:'workshop',modules:'modules',heatLesson:'heat',brand:'brand',turbo:'rewards',souvenirs:'souvenirs'})[action];
  if(required&&!features[required]){toast(reasons['guide-locked']);return;}
  if(action==='goalExpand'||action==='goalCollapse'){
    if(ui.modal)return;
    ui.goalExpanded=action==='goalExpand';pointer=null;sound.play('click');return;
  }
  if(action==='modules'){
    if(!game.getView().factory.unlocked){toast(reasons['factory-locked']);return;}
    openModal('modules');return;
  }
  if(action.startsWith('modulePage:')){
    if(!ui.modal||ui.modal.type!=='modules')return;
    const page=Number(action.slice(11));
    if(Number.isInteger(page)&&page>=0&&page<6)ui.modal.page=page;
    return;
  }
  if(action.startsWith('pressureMode:')){
    if(!ui.modal||ui.modal.type!=='modules')return;
    const mode=action.slice(13);
    if(result(game.setPressureMode(mode)))toast(mode==='auto'?'已开启自动放锅 · 每锅增产 25%':'已开启手动储压 · 可留一锅备用');
    return;
  }
  if(action.startsWith('contractPage:')){
    if(!ui.modal||ui.modal.type!=='order')return;
    const page=Number(action.slice(13));
    if(Number.isInteger(page)&&page>=0&&page<3)ui.modal.page=page;
    return;
  }
  if(action.startsWith('contractAccept:')){
    if(!ui.modal||ui.modal.type!=='order')return;
    const rest=action.slice(15),cut=rest.indexOf(':');if(cut<0)return;
    const kind=rest.slice(0,cut),id=rest.slice(cut+1),quote=ui.modal.contractQuotes&&ui.modal.contractQuotes[kind];
    if(!quote||quote.id!==id)return;
    const accepted=game.acceptContract(kind,quote);
    if(result(accepted)){closeModal();ui.goalExpanded=true;toast('订单已接下 · 生产成品送往当前客户');}
    else if(accepted&&accepted.reason==='stale-contract')openModal('order');
    return;
  }
  if(action.startsWith('contractCancel:')){
    if(!ui.modal||ui.modal.type!=='order')return;
    const id=action.slice(15);
    if(ui.modal.cancelContractId!==id){ui.modal.cancelContractId=id;toast('本单进度将清空，再点一次放弃');return;}
    if(result(game.cancelContract(id))){openModal('order');toast('本单已放弃，可以重新选择客户');}
    return;
  }
  if(action==='releasePressure'){
    if(!ui.modal)result(game.releasePressure());
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
  if(action.startsWith('upgrade:')){
    const key=action.slice(8);
    const onboarding=game.getView().onboarding;
    const firstPractice=game.state.machine===0&&game.state.upgrades[key]===0&&!onboarding.skipped&&!game.state.onboarding.legacy;
    if(result(game.buyUpgrade(key))){
      platform.track('upgrade_purchase',{kind:key,afterReward:game.state.rewardedCount>0&&game.state.playedSeconds-game.state.lastRewardAt<60});
      if(firstPractice){closeModal();ui.guideKey='';ui.guideIdleSeconds=0;}
    }
    return;
  }
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
    if(quest.action.startsWith('upgrade:'))openModal('upgrades',quest.action.slice(8));
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
  if(action==='evolve'){ui.modal=null;if(result(game.evolve()))maybeInterstitial();return;}
  if(action==='completion'&&!game.getView().completed){toast('完成 20 个主线订单后，可获得竣工纪念');return;}
  if(PANELS.has(action))openModal(action);
}

platform.onPointer(e=>{
  const x=e.x-ox,y=e.y;
  if(e.type==='down'){
    if(pointer||hidden||ui.adBusy)return;
    const action=renderer.actionAt(x,y);
    pointer={id:e.id,action,x,y,nextTapAt:developerHoldTap&&action==='tap'&&!ui.startup&&!ui.modal?Date.now()+HOLD_DELAY_MS+HOLD_INTERVAL_MS:null};
    // Production responds immediately. Reward/navigation buttons activate on release,
    // so repeated production taps cannot drift into an ad request.
    if(action==='tap')act(action);
  }else if(e.type==='move'&&pointer&&pointer.id===e.id&&pointer.action==='tap'){
    // Moving off production cancels this gesture permanently, even on re-entry.
    if(renderer.actionAt(x,y)!=='tap')pointer=null;
    else {pointer.x=x;pointer.y=y;}
  }else if((e.type==='up'||e.type==='cancel')&&pointer&&pointer.id===e.id){
    const p=pointer;pointer=null;
    if(e.type==='up'&&p.action!=='tap'&&renderer.actionAt(x,y)===p.action&&Math.hypot(x-p.x,y-p.y)<20)act(p.action);
  }
});
function repeatDeveloperTap() {
  if(!pointer||pointer.nextTapAt===null)return;
  if(hidden||ui.startup||ui.modal||ui.adBusy||renderer.actionAt(pointer.x,pointer.y)!=='tap'){pointer=null;return;}
  // Wall time starts at touch-down, independently of the preceding animation frame.
  // Fractional intervals carry across frames; a stalled frame catches up at most
  // one second, then discards the backlog instead of freezing a test device.
  const due=Math.max(0,Math.floor((Date.now()-pointer.nextTapAt)/HOLD_INTERVAL_MS)+1);
  if(!due)return;
  pointer.nextTapAt+=due*HOLD_INTERVAL_MS;
  for(let i=0;i<Math.min(due,MAX_HOLD_TAPS_PER_FRAME);i++)game.tap();
  processEvents();
}
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
    const keys={Space:'tap',Digit1:'upgrade:tap',Digit2:'upgrade:auto',Digit3:'upgrade:value',KeyO:'order',KeyM:'machine',KeyQ:'quests',KeyB:'brand',KeyP:'modules',KeyR:'releasePressure'};
    if(keys[e.code]){e.preventDefault();act(keys[e.code]);}
  });
  // Read-only diagnostics for QA; held production is enabled only by a development build.
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
      if(!ui.startup){
        game.tick(dt);processEvents();repeatDeveloperTap();
        const goal=game.getView().onboarding.goal;
        const key=goal?goal.id+':'+(goal.phase||''):'';
        if(key!==ui.guideKey){ui.guideKey=key;ui.guideIdleSeconds=0;}
        if(goal&&!ui.modal&&!(pointer&&pointer.action==='tap')){
          // Count visible animation frames, never a background return or a stalled frame.
          const visibleSeconds=Math.min(dt,.25);
          ui.guideIdleSeconds+=visibleSeconds;
          if(goal.action==='observe'){game.observeOnboarding(visibleSeconds);processEvents();}
        }
      }
      saveTimer+=dt;if(saveTimer>=5){saveTimer=0;save();}
    }
    if(!ui.startup&&ui.toastSeconds>0){ui.toastSeconds-=dt;if(ui.toastSeconds<=0)ui.toast='';}
    if(typeof platform.getSidebarState==='function')ui.sidebar=platform.getSidebarState();
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.fillStyle='#e9eee5';ctx.fillRect(0,0,width,height);
    // Subtle vertical rails make the portrait canvas feel intentional on wide screens.
    if(width>ui.viewport.width+60){ctx.strokeStyle='#dce3d7';ctx.lineWidth=1;for(const x of [ox-22,ox+ui.viewport.width+22]){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}}
    const view=game.getView();ui.sceneDt=dt;
    ctx.setTransform(ratio,0,0,ratio,ratio*ox,0);renderer.draw(view,ui,Math.min(.05,dt));
    const homeVisible=!ui.startup&&!ui.adBusy&&!ui.modal,sceneInterface=renderer.interface;
    experience.observe(view,{visible:!ui.startup&&!ui.adBusy,modalType:ui.modal&&ui.modal.type,target:homeVisible&&sceneInterface?sceneInterface.visibleTarget:null,adEntries:sceneInterface?sceneInterface.adEntries:[],recommendation:homeVisible&&sceneInterface?sceneInterface.recommendation:null});
  }
  requestFrame(frame);
}
requestFrame(frame);
