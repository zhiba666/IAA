'use strict';

const { CONFIG, formatNumber: num } = require('./core');
const { selectCurrentTarget } = require('./experience');
const { selectHeatGuide } = require('./heat-guide');
const { selectNextStep } = require('./next-step');
const { selectOfflineSummary } = require('./offline-summary');
const { PRODUCTION_FORMS } = require('./production-scene');
const C={ink:'#283e32',muted:'#687764',paper:'#f8f6ed',white:'#fffdf7',green:'#366348',mint:'#deebd5',yellow:'#f4ca58',orange:'#df9954',line:'#dce3d2'};
const rate=n=>n>0&&n<10?Number(n.toFixed(2)).toString():num(n);
const HEALTH=['抵制不良游戏，拒绝盗版游戏。','注意自我保护，谨防受骗上当。','适度游戏益脑，沉迷游戏伤身。','合理安排时间，享受健康生活。'];

// Coordinates are viewport CSS pixels. Scenes can shrink; controls and copy do not.
class GameInterface {
  constructor(renderer){this.r=renderer;this.adEntries=[];this.recommendation=null;this.visibleTarget=null;}
  feature(v,key){return !v.onboarding||!!(v.onboarding.features&&v.onboarding.features[key]);}
  unlockHint(v){return String(v.onboarding&&v.onboarding.nextUnlock||'').replace(/\s+/g,'').replace(/完成第/g,'完成').replace(/张订单/g,'单').replace(/换代至/g,'换上').replace(/后，解锁/g,' → ');}
  isGoalExpanded(v,ui){return !!(v.onboarding&&v.onboarding.goal)||ui.goalExpanded===true||(ui.goalExpanded!==false&&!!v.tutorial);}
  text(s,x,y,size=14,color=C.ink,weight=500,align='left'){this.r.text(s,x,y,size,color,weight,align);}
  ellipsis(s,width,size=14){s=String(s);this.r.c.font=`500 ${size}px "Microsoft YaHei",sans-serif`;if(this.r.c.measureText(s).width<=width)return s;while(s.length&&this.r.c.measureText(s+'…').width>width)s=s.slice(0,-1);return s+'…';}
  label(s,x,y,width,size=14,color=C.ink,weight=500,align='left'){this.text(this.ellipsis(s,width,size),x,y,size,color,weight,align);}
  lines(s,x,y,width,size=14,color=C.muted,line=21){return this.r.wrap(s,x,y,width,size,color,line);}
  box(x,y,w,h,fill=C.white,stroke){this.r.box(x,y,w,h,14,fill,stroke);}
  preview(cx,cy,size,stage){this.r.scene.drawMachinePreview(cx-size/2,cy-size/2,size,stage);}
  productionPreview(cx,cy,size,stage){this.r.scene.drawProductionPreview(cx-size/2,cy-size/2,size,stage);}
  button(x,y,w,label,action,{fill=C.green,color=C.white,disabled=false,h=44,size=15,subLabel=''}={}){this.box(x,y,w,h,disabled?'#e6e8de':fill);if(!disabled&&this.guideMatches(action))this.guideOutline(x,y,w,h);this.label(label,x+w/2,y+h/2-(subLabel?8:0),w-16,size,disabled?C.muted:color,700,'center');if(subLabel)this.label(subLabel,x+w/2,y+h/2+11,w-16,11,disabled?C.muted:color,500,'center');if(!disabled)this.r.hit(x,y,w,h,action);}
  guideMatches(action){
    const goal=this.activeGuide;if(!goal)return action===this.r.guideAction;
    if(this.activeModal==='upgrades')return goal.phase==='buy'&&goal.anchor==='upgrades'&&action==='upgrade:'+goal.upgradeKey;
    if(this.activeModal==='order')return goal.anchor==='order'&&action==='claimOrder';
    if(this.activeModal)return false;
    return goal.anchor==='upgrades'&&action==='upgrades';
  }
  guideOutline(x,y,w,h){
    const strong=this.guideIdle>=5,pulse=(Math.sin(this.r.scene.t*4)+1)/2;
    this.r.box(x-2,y-2,w+4,h+4,15,null,C.orange);
    if(strong)this.r.box(x-4-pulse,y-4-pulse,w+8+pulse*2,h+8+pulse*2,17,null,C.yellow);
  }
  adButton(v,kind,y,label,placement='sheet'){if(!this.feature(v,'rewards')&&!(v.state.onboarding&&v.state.onboarding.legacy)||(kind==='brand'&&!this.feature(v,'brand')))return;const offer=v.rewards[kind];this.button(22,y,this.w-44,'广告 · '+(offer.available?label:this.r.rewardStatus(v,kind)),'ad:'+kind,{fill:C.yellow,color:C.ink,disabled:!offer.available});this.adEntries.push({kind,placement,available:offer.available,reason:offer.reason||''});}
  draw(v,ui,dt){
    const r=this.r;this.w=ui.viewport.width;this.h=ui.viewport.height;this.x=12;this.cw=this.w-24;this.adEntries=[];this.recommendation=null;this.visibleTarget=null;r.zones=[];
    r.c.clearRect(0,0,this.w,this.h);this.box(0,0,this.w,this.h,C.paper);
    if(ui.startup){this.inSafeArea(ui,()=>this.welcome(ui));return;}
    const target=v.onboarding&&v.onboarding.goal||selectCurrentTarget(v,ui);r.guideAction=target?target.action:'';
    this.activeGuide=v.onboarding&&v.onboarding.goal;this.activeModal=ui.modal&&ui.modal.type;this.guideIdle=ui.guideIdleSeconds||0;
    this.home(v,ui,target,dt);
    if(ui.modal){
      r.c.fillStyle='rgba(31,48,36,.48)';r.c.fillRect(0,0,this.w,this.h);
      this.inSafeArea(ui,()=>this.sheet(v,ui));this.recommendation=null;this.visibleTarget=null;
    }
    if(ui.toast&&!ui.modal){const yy=this.feedbackY;this.box(12,yy,this.cw,40,C.green);this.label(ui.toast,this.w/2,yy+20,this.cw-20,14,C.white,600,'center');}
  }
  inSafeArea(ui,draw){
    // Sheets share a safe content area; the close button starts 19px below it.
    const top=Math.max(ui.viewport.safeTop||0,(ui.viewport.menuBottom||0)-11),height=this.h;
    const c=this.r.c;c.save();c.translate(0,top);this.h-=top;
    try{draw();for(const zone of this.r.zones)zone.y+=top;}
    finally{this.h=height;c.restore();}
  }
  welcome(ui){
    const w=this.w,h=this.h;this.box(12,12,w-24,h-24,C.mint);
    this.text('小小爆米花厂',w/2,55,26,C.ink,800,'center');this.text('从一口小锅，开始今天的收获',w/2,88,14,C.green,500,'center');
    this.r.popcorn(w/2,Math.min(164,h*.28),30,-.1);
    const yy=Math.max(192,h*.40);this.box(24,yy,w-48,190,C.white);this.text('健康游戏忠告',w/2,yy+30,20,C.ink,750,'center');
    HEALTH.forEach((s,i)=>this.text(s,w/2,yy+67+i*30,Math.min(16,(w-60)/17),C.ink,500,'center'));
    let py=yy+211;for(const s of ui.publication||[]){py+=this.lines(s,28,py,w-56,12,C.green,16);}
    this.button(28,h-89,w-56,'开始经营','start',{h:48,size:18});this.text('1.0.0 · 进度自动保存',w/2,h-24,12,C.green,500,'center');
  }
  home(v,ui,target,dt){
    const r=this.r,w=this.w,h=this.h,x=12,cw=this.cw;
    const sceneTop=ui.isDouyin?0:8,hudTop=(ui.viewport.safeTop||0)+8;
    const showOrders=this.feature(v,'orders'),showHeat=this.feature(v,'heat'),showModules=this.feature(v,'modules');
    const nav=[];
    if(this.feature(v,'tapUpgrade')||this.feature(v,'autoUpgrade')||this.feature(v,'valueUpgrade'))nav.push(['升级','upgrades']);
    if(showOrders)nav.push(['合同','order']);
    if(this.feature(v,'records'))nav.push(['成长记录','quests']);
    if(this.feature(v,'workshop'))nav.push(['工厂','workshop']);
    const navY=h-52,sceneBottom=(nav.length?navY:h)-8,sceneH=sceneBottom-sceneTop,heatY=sceneBottom-(showHeat?76:24);
    const walletX=x+10,walletY=hudTop+10,walletW=Math.min(184,cw-160);
    const orderX=w-152,utilityY=Math.max(walletY,(ui.viewport.menuBottom||0)+8),orderY=utilityY+50,orderW=130,modeY=orderY+48;
    const expanded=this.isGoalExpanded(v,ui),goalH=this.activeGuide?82:132;
    const showModuleShortcut=showModules&&(!expanded||Math.max(walletY+82,modeY+50)+goalH+8<=heatY-52);
    const evolving=!!(r.notice&&r.notice.kind==='evolve'&&!ui.toast&&!ui.modal);
    const goalY=Math.max(walletY+82,showModuleShortcut?modeY+50:showOrders?orderY+52:utilityY+52);
    const ordinaryTapTop=expanded?goalY+goalH+8:goalY+56;
    // Temporarily use the goal area for the reveal, then restore the player's
    // expansion preference. The machine frame starts below the full banner.
    this.feedbackY=evolving?goalY+6:ordinaryTapTop+4;
    const tapTop=evolving?this.feedbackY+60:ordinaryTapTop;
    r.scene.update(ui.adBusy?0:ui.sceneDt===undefined?dt:ui.sceneDt,v);
    r.scene.draw(x,sceneTop,cw,sceneH,v,{topInset:tapTop-sceneTop,bottomInset:showHeat?112:68});
    r.drawReceipts({x:walletX+walletW/2,y:walletY+36},{x:orderX+orderW/2,y:orderY+22});
    // Read-only balances float over the scene, outside the production hit area.
    this.box(walletX,walletY,walletW,70,'rgba(255,253,247,.96)');
    this.text('金币',walletX+12,walletY+15,11,C.muted);
    this.label(num(v.state.coins),walletX+12,walletY+36,walletW-24,21,C.ink,800);
    const contract=v.contracts&&v.contracts.active,allocation=contract&&!contract.ready&&contract.heldProduction<contract.quantityTarget?contract.allocation:0;
    this.label(this.feature(v,'autoUpgrade')?(allocation?'现款 +':'自动 +')+rate(v.production.auto*v.production.price*(1-allocation))+' /秒':'点击生产，即时赚金币',walletX+12,walletY+57,walletW-24,11,C.green,650);
    this.button(w-120,utilityY,54,'引导','guidebook',{fill:C.white,color:C.green,size:13});
    this.button(w-60,utilityY,44,'⚙','settings',{fill:C.white,color:C.green,size:20});
    const factory=v.factory;
    if(factory&&showModuleShortcut){
      this.button(orderX,modeY,orderW,'设备图鉴 '+factory.ownedCount+'/'+factory.totalModules,'modules',{fill:C.mint,color:C.green,size:13,subLabel:factory.nextModule?'下一件 · '+factory.nextModule.name:'六件设备 · 全部生效'});
    }
    if(r.notice&&!ui.toast){
      const yy=this.feedbackY,evolved=r.notice.kind==='evolve';
      this.box(x+10,yy,cw-20,54,evolved?C.mint:'#fff8df',evolved?C.green:undefined);
      this.label(r.notice.title,w/2,yy+17,cw-40,16,C.green,800,'center');
      this.label(r.notice.text,w/2,yy+39,cw-40,13,C.ink,600,'center');
    }
    const f=!r.notice&&!ui.toast?r.floats.filter(item=>item.kind==='tap').slice(-1)[0]:null;
    this.label(f?f.text:factory&&this.feature(v,'pot')?(factory.storedBurst?'满锅已存好 · 选择时机放出':factory.tapReady?'添料 '+factory.tapsRemaining+' / '+factory.maxTapsPerPot+' 次':factory.tapsRemaining?'添料间歇 · 本锅还可添 '+factory.tapsRemaining+' 次':'本锅已添足 · 蓄满自动爆锅'):'点机器 · 每次 +'+rate(v.production.tap)+'份',w/2,heatY-31,cw-32,f?17:13,C.green,750,'center');
    const nextUnlock=factory&&showModules?(factory.nextModule?factory.nextModule.name+' · '+factory.nextModule.progressText:'已收齐 6 件设备 · 全部永久生效'):this.unlockHint(v);
    const contractHint=contract&&(contract.kind==='gift'?'原料 '+num(Math.min(contract.heldProduction,contract.quantityTarget))+'/'+num(contract.quantityTarget)+' → 糖衣 '+num(contract.coated)+'/'+num(contract.quantityTarget):contract.kind==='festival'?'真实出锅 '+contract.batches+' / 3 · 每次满锅记一锅':'现款 '+Math.round((1-allocation)*100)+'% → 钱包 · 备货 '+Math.round(allocation*100)+'% → 合同');
    this.label(contractHint||nextUnlock||factory&&this.feature(v,'pot')&&'每锅最多添料三次 · 松手后继续自动蓄能'||'点击机器或下方空地，都能生产',w/2,heatY-12,cw-32,11,C.muted,500,'center');
    if(factory&&this.feature(v,'pot'))this.potSlots(factory,heatY-54);
    // The full lower scene is a thumb-friendly production surface. HUD and heat
    // controls never overlap it; transient feedback does not intercept taps.
    r.hit(x,tapTop,cw,Math.max(44,heatY-8-tapTop),'tap');
    if(showOrders){
      this.box(orderX,orderY,orderW,44,v.order.ready?C.green:C.white);
      this.text(v.order.completed?'工厂已竣工 ›':v.order.awaitingSelection?'选择下一张合同 ›':v.order.ready?'本单达标 · 装车':'本单 '+this.orderPercent(v.order)+'%  ›',orderX+orderW/2,orderY+15,13,v.order.ready?C.white:C.green,700,'center');
      this.progress(orderX+10,orderY+30,orderW-20,5,v.order.stageProgress,v.order.ready?C.yellow:C.green,v.order.ready?'#628169':'#dce5d5');
      if(this.activeGuide&&this.activeGuide.anchor==='order')this.guideOutline(orderX,orderY,orderW,44);
      r.hit(orderX,orderY,orderW,44,'order');
    }
    if(showHeat)this.heat(v,heatY);
    if(!evolving)this.goal(v,ui,target,goalY,goalH);
    nav.forEach(([name,action],i)=>this.button(x+i*(cw+6)/nav.length,navY,(cw-6*(nav.length-1))/nav.length,name,action,{fill:action==='order'&&v.order.ready?C.green:C.mint,color:action==='order'&&v.order.ready?C.white:C.green,size:14}));
    if(!ui.modal&&!evolving)this.practiceCue(v,{walletX,walletY,walletW,heatY});
  }
  practiceCue(v,{walletX,walletY,walletW,heatY}){
    const goal=this.activeGuide;if(!goal)return;
    if(goal.anchor==='wallet'){this.guideOutline(walletX,walletY,walletW,70);return;}
    if(goal.anchor==='heat'){this.guideOutline(this.x+8,heatY,this.cw-16,68);return;}
    if(goal.anchor!=='machine')return;
    const f=this.r.scene.screenFrame;if(!f||f.scale<=0)return;
    const r=this.r,c=r.c,cx=f.x+216*f.scale,cy=f.y+130*f.scale;
    const pulse=(Math.sin(r.scene.t*4)+1)/2,radius=Math.max(23,Math.min(48,41*f.scale))+pulse*3;
    c.save();c.beginPath();c.arc(cx,cy,radius,0,Math.PI*2);c.strokeStyle=C.orange;c.lineWidth=this.guideIdle>=5?3:2;c.stroke();
    if(this.guideIdle>=5){c.beginPath();c.arc(cx,cy,radius+7,0,Math.PI*2);c.strokeStyle=C.yellow;c.lineWidth=2;c.stroke();}
    // The arrow is painted on the production surface; it never adds a hit region.
    const ax=cx+radius+8+(this.guideIdle>=5?pulse*5:0),ay=cy;
    r.line(ax+16,ay,ax,ay,C.orange,3);r.line(ax+7,ay-6,ax,ay,C.orange,3);r.line(ax+7,ay+6,ax,ay,C.orange,3);c.restore();
  }
  potSlots(factory,y){
    const size=24,gap=8,start=this.w/2-(size*3+gap*2)/2;
    for(let i=0;i<3;i++){
      const used=i>=factory.tapsRemaining,x=start+i*(size+gap);
      this.r.box(x,y-8,size,16,7,used?'#9baa90':'#fff4c8',used?undefined:C.orange);
      if(!used)this.r.circle(x+size/2,y,3,C.yellow);
      if(!used&&factory.tapCooldown>0)this.progress(x+3,y+5,size-6,3,1-Math.min(1,factory.tapCooldown),C.green,'#cbd5c0');
    }
  }
  orderPercent(order){return order.ready?100:Math.min(99,Math.floor(order.stageProgress*100));}
  progress(x,y,w,h,value,fill=C.green,track='#dce5d5'){
    const p=Math.max(0,Math.min(1,value));this.r.box(x,y,w,h,h/2,track);
    if(p>0)this.r.box(x,y,w*p,h,Math.min(h/2,w*p/2),fill);
  }
  heat(v,y){
    if(v.factory&&v.factory.storedBurst){
      const x=this.x+8,w=this.cw-16;
      this.box(x,y,w,68,'#e4f0f1');
      this.label('蓄压罐 · 已存一锅',x+10,y+18,w-124,13,C.green,750);
      this.label('按下立刻整批放出',x+10,y+44,w-124,11,C.muted);
      this.button(x+w-112,y+12,102,'放出整锅','releasePressure',{fill:'#366f83',size:14});
      return;
    }
    const x=this.x+8,w=this.cw-16,g=selectHeatGuide(v);
    this.box(x,y,w,68,'rgba(255,253,247,.96)');
    this.label(g.title,x+10,y+14,w-108,12,C.ink,700);
    this.text(g.energy.toFixed(1)+' / '+CONFIG.energyMax,x+w-10,y+14,11,C.muted,600,'right');
    this.label(g.hint,x+10,y+33,w-20,11,C.muted);
    this.progress(x+10,y+48,w-20,12,g.progress,C.yellow,'#d7e2cd');
  }
  goal(v,ui,target,y,height){
    const onboarding=v.onboarding,guide=onboarding&&onboarding.goal;
    if(guide){
      const x=this.x+10,w=this.cw-20;
      this.visibleTarget={...guide,source:'onboarding'};
      this.recommendation={id:guide.id,kind:'onboarding',title:guide.title,detail:guide.text,reason:guide.reason,action:guide.action,buttonLabel:guide.buttonLabel||'去完成',enabled:guide.action!=='observe'};
      this.box(x,y,w,height,'rgba(255,253,247,.97)',C.line);
      this.label('动手试试'+(guide.step&&guide.total?' · '+guide.step+'/'+guide.total:''),x+12,y+14,w-112,11,C.muted,600);
      this.label(guide.title,x+12,y+35,w-104,16,C.green,750);
      this.button(x+w-91,y+3,84,'跳过引导','guideSkip',{fill:C.mint,color:C.green,size:12});
      const detail=guide.phase==='verify'&&Number.isFinite(guide.before)&&Number.isFinite(guide.after)?rate(guide.before)+' → '+rate(guide.after)+' '+(guide.unit||'份/次')+' · 再点一下体验':String(guide.text||'').replace(/。$/,'');
      this.label(detail,x+12,y+61,w-24,12,C.ink,600);
      if(guide.action==='observe'&&guide.observationTarget)this.progress(x+12,y+74,w-24,3,(guide.observationSeconds||0)/guide.observationTarget,C.yellow);
      return;
    }
    const step=selectNextStep(v,target,ui),x=this.x+10,w=this.cw-20;
    if(!this.isGoalExpanded(v,ui)){
      const label=step.kind==='order'&&v.order.ready?'可装车 ›':step.kind==='machine'?'可换代 ›':step.kind==='souvenir'?'竣工收藏 ›':step.kind==='modules'?'收集设备 ›':v.order.awaitingSelection?'选择合同 ›':'下一步 ›';
      const detail=step.kind==='upgrade'?'升级建议':step.kind==='save'?'攒钱目标':step.kind==='souvenir'?'金币换工厂装饰':'当前目标';
      this.button(x,(ui.viewport.safeTop||0)+92,112,label,'goalExpand',{fill:step.kind==='quest'?C.yellow:C.white,color:C.green,size:13,subLabel:detail});
      return;
    }
    this.visibleTarget=target;this.recommendation=step;
    this.box(x,y,w,height,'rgba(255,253,247,.97)',C.line);
    this.label(target?target.title:'当前经营目标',x+12,y+18,w-86,14,C.green,750);
    this.label(target&&target.ready&&step.kind==='quest'?'目标已达成 · 领奖':step.title,x+12,y+40,w-86,13,C.ink,650);
    if(target&&target.action)this.r.hit(x+4,y+2,w-74,44,'target');
    this.button(x+w-62,y+4,56,'收起','goalCollapse',{fill:C.mint,color:C.green,size:12});
    const modePreview=step.kind==='mode'&&step.preview;
    const funding=step.bottleneck==='funding';
    const detail=modePreview?(funding?'收入 '+rate(modePreview.incomeBefore)+' → '+rate(modePreview.incomeAfter)+' 金币/秒':'产量 '+rate(modePreview.productionBefore)+' → '+rate(modePreview.productionAfter)+' 份/秒'):step.detail;
    this.label(detail,x+12,y+65,w-24,13,C.green,600);
    const reason=modePreview?(funding?'产量 -'+Number((100*(1-modePreview.productionAfter/modePreview.productionBefore)).toFixed(1))+'%':'收入 -'+Number((100*(1-modePreview.incomeAfter/modePreview.incomeBefore)).toFixed(1))+'%'):step.kind==='quest'?'一次性成长奖励':step.reason;
    this.label(reason,x+12,y+103,w-136,12,C.muted);
    this.button(x+w-110,y+84,100,step.buttonLabel,step.action,{disabled:!step.enabled,size:14,fill:step.kind==='save'?C.mint:C.green,color:step.kind==='save'?C.green:C.white});
  }
  sheet(v,ui){
    const m=ui.modal,r=this.r;r.zones=[];this.adEntries=[];
    this.box(6,12,this.w-12,this.h-24,C.white);
    this.button(this.w-56,19,44,'×','close',{fill:'#edf0e5',color:C.green,size:25,disabled:ui.adBusy});
    const titles={guide:'新玩法解锁',guidebook:'经营引导',modules:'设备图鉴',upgrades:'设备升级',heatLesson:'自动爆锅与蓄压',workshop:'我的工厂',quests:'成长记录',order:'主线合同',souvenirs:'竣工收藏',machine:'设备换代',blueprint:'工厂蓝图',brand:'品牌合作',reward:'本次广告奖励',offline:'欢迎回来，小厂长',settings:'工厂设置',restart:'删除存档并重新开始',help:'玩法说明',privacy:'存档与隐私',health:'健康游戏忠告',sidebar:'侧边栏再来玩',stats:'经营记录',completion:'工厂竣工纪念',turbo:'涡轮增压'};
    if(ui.toast)this.label(ui.toast,22,43,this.w-(m.type==='workshop'?144:88),14,C.green,700);
    else this.text(titles[m.type]||'我的工厂',22,43,21,C.ink,800);
    if(m.type==='workshop')this.button(this.w-112,19,44,'⚙','settings',{fill:C.mint,color:C.green,size:22});
    const type=m.type;
    if(type==='guide')this.guide(v,m);
    else if(type==='guidebook')this.guidebook(v,m);
    else if(type==='upgrades')this.upgrades(v,m,this.activeGuide?(this.activeGuide.phase==='buy'&&this.activeGuide.anchor==='upgrades'?this.activeGuide.upgradeKey:''):ui.focusUpgrade);
    else if(type==='modules')this.modules(v,m);
    else if(type==='heatLesson')this.heatLesson(v);
    else if(type==='workshop')this.workshop(v);
    else if(type==='quests')this.quests(v,m);
    else if(type==='machine'||type==='blueprint')this.machine(v,m);
    else if(type==='order')this.order(v,m);
    else if(type==='souvenirs')this.souvenirs(v,m);
    else if(type==='offline')this.offline(v);
    else if(type==='brand')this.brand(v);
    else if(type==='reward')this.reward(v,ui);
    else if(type==='turbo'){const p=v.rewards.turbo.impact;this.text('自动产速 ×3 · 持续 90 秒',22,99,17,C.green,750);this.impact(p,141);this.adButton(v,'turbo',this.h-128,v.boostSeconds>0?'延长增压':'开启增压','turbo');this.backButton();}
    else if(type==='stats'){[['总生产',num(v.state.totalProduced)+' 份'],['完成订单',(v.state.orderIndex+v.state.loopIndex)+' 单'],['累计爆锅',v.state.bursts+' 次'],['累计营业',num(v.state.totalCoins)+' 金币']].forEach(([k,s],i)=>{this.text(k,24,100+i*70,14,C.muted);this.text(s,24,129+i*70,23,C.green,750);});this.backButton();}
    else if(type==='settings')this.settings(v,ui);
    else if(type==='restart'){
      this.lines('将清空本设备上的全部游戏进度和设置，包括金币、设备、订单、永久加成与收藏。\n\n删除后无法恢复，将从新手引导重新开始。',22,100,this.w-44,15,C.ink,25);
      this.button(22,this.h-126,this.w-44,'确认删除并重新开始','confirmRestart',{fill:'#b84b3f'});
      this.button(22,this.h-70,this.w-44,'取消，保留存档','settings',{fill:C.mint,color:C.green});
    }
    else if(type==='health'){HEALTH.forEach((s,i)=>this.text(s,this.w/2,125+i*43,Math.min(16,(this.w-42)/17),C.ink,500,'center'));this.backButton();}
    else if(type==='help')this.guidebook(v,m);
    else if(type==='privacy'){this.lines('金币、设备、订单、任务、品牌合作与设置保存在当前设备。\n\n每 5 秒及退出时自动保存。清理应用数据会影响进度。\n\n没有账号或云存档。体验记录默认只存在本地内存，刷新后重新记录；未开启平台上报时不联网发送。',22,97,this.w-44,15,C.ink,23);this.backButton();}
    else if(type==='sidebar'){this.lines(ui.sidebar&&ui.sidebar.fromSidebar?'欢迎回来，你已从侧边栏进入工厂。':'在抖音首页侧边栏，找到小小爆米花厂，继续今天的经营。',22,100,this.w-44,16,C.ink,26);this.button(22,this.h-184,this.w-44,ui.sidebarBusy?'正在打开…':'去侧边栏看看','visitSidebar',{disabled:ui.sidebarBusy||!ui.sidebar||!ui.sidebar.supported});this.backButton();}
    else if(type==='completion'){this.text('小小工厂，大大梦想',this.w/2,105,22,C.green,800,'center');this.preview(this.w/2,205,135,5);this.lines('20 张主线合同完成！\n累计生产 '+num(v.state.totalProduced)+' 份。\n你的工厂已竣工，可继续经营布置纪念装饰。',22,294,this.w-44,15,C.ink,25);if(v.souvenirs&&v.souvenirs.unlocked)this.button(22,this.h-126,this.w-44,'竣工收藏 · '+v.souvenirs.ownedCount+' / '+v.souvenirs.total,'souvenirs',{fill:C.yellow,color:C.green});this.backButton();}
    if(ui.adBusy){r.zones=[];this.adEntries=[];}
  }
  guide(v,m){
    const onboarding=v.onboarding||{},lesson=(onboarding.lessons||[]).find(item=>item.id===m.guideId)||onboarding.lesson;
    if(!lesson){this.lines('点击机器开始生产。完成主页目标，就会解锁下一项经营玩法。',24,101,this.w-48,16,C.green,26);this.backButton();return;}
    const compact=this.h<620,dense=this.h<520,cardY=dense?118:compact?133:153,cardW=this.w-44;
    this.label(lesson.title,22,96,this.w-44,21,C.green,800);
    this.box(22,cardY,cardW,dense?108:compact?122:150,C.mint);
    this.text('它有什么用',36,cardY+24,12,C.green,700);
    this.lines(lesson.benefit,36,cardY+(dense?49:55),cardW-28,dense?15:16,C.ink,dense?22:25);
    const instructionY=cardY+(dense?130:compact?150:181);
    this.text('接下来试一次',24,instructionY,12,C.muted,700);
    this.lines(lesson.instruction,24,instructionY+(dense?25:29),this.w-48,dense?14:15,C.green,dense?23:25);
    if(!dense)this.label(m.replay?'已解锁的玩法，随时可回看':'说明会保存在「引导」里',this.w/2,this.h-99,this.w-44,12,C.muted,500,'center');
    this.button(22,this.h-76,this.w-44,'返回经营','close',{h:48,size:16});
  }
  guidebook(v,m={}){
    const onboarding=v.onboarding||{},lessons=onboarding.lessons||[],perPage=this.h<540?2:this.h<700?3:4,pages=Math.max(1,Math.ceil(lessons.length/perPage)),page=Math.max(0,Math.min(pages-1,m.page||0));
    this.label('每次学一点 · 已解锁 '+lessons.length+' 项',22,87,this.w-44,14,C.green,700);
    const next=this.unlockHint(v)||'完成主页目标，继续经营你的小工厂';
    this.label(next,22,111,this.w-44,12,C.muted);
    if(!lessons.length)this.lines('先点击机器，赚到第一笔金币。\n新玩法开放后，会在这里留下说明。',24,173,this.w-48,16,C.green,28);
    const step=Math.min(109,Math.floor((this.h-322)/perPage));
    lessons.slice(page*perPage,(page+1)*perPage).forEach((lesson,i)=>{
      const y=135+i*step;
      this.box(16,y,this.w-32,step-8,C.mint);
      this.label(lesson.title,28,y+22,this.w-139,15,C.green,750);
      this.label(lesson.benefit,28,y+50,this.w-56,12,C.ink);
      this.button(this.w-96,y+7,68,'回看','guideReview:'+lesson.id,{fill:C.white,color:C.green,h:44,size:13});
      this.r.hit(16,y,this.w-32,step-8,'guideReview:'+lesson.id);
    });
    if(pages>1){
      this.button(22,this.h-178,92,'上一页','guidePage:'+Math.max(0,page-1),{disabled:page===0,fill:C.mint,color:C.green,size:13});
      this.text((page+1)+' / '+pages,this.w/2,this.h-156,13,C.muted,600,'center');
      this.button(this.w-114,this.h-178,92,'下一页','guidePage:'+Math.min(pages-1,page+1),{disabled:page===pages-1,fill:C.mint,color:C.green,size:13});
    }
    if(!onboarding.completed)this.button(22,this.h-122,this.w-44,onboarding.skipped?'恢复操作引导':'回到当前操作引导','guideResume',{fill:C.yellow,color:C.green,size:14});
    this.backButton();
  }
  backButton(){this.button(22,this.h-70,this.w-44,'继续经营','close',{fill:C.mint,color:C.green});}
  impact(p,y){if(!p)return;this.lines(p.title,22,y,this.w-44,16,C.green,23);this.lines(p.detail,22,y+52,this.w-44,14,C.muted,21);}
  upgrades(v,m={},focusUpgrade=''){
    const milestones=v.milestones||{},bulkUnlocked=this.feature(v,'bulk')&&milestones.bulkUpgrade&&milestones.bulkUpgrade.unlocked;
    const batch=bulkUnlocked&&m.quantity===5;
    if(bulkUnlocked){
      const half=(this.w-50)/2;
      this.button(22,78,half,'单级','upgradeQuantity:1',{fill:batch?C.mint:C.green,color:batch?C.green:C.white});
      this.button(28+half,78,half,'最多5级','upgradeQuantity:5',{fill:batch?C.green:C.mint,color:batch?C.white:C.green});
      this.label(batch?'逐级合计价格；保留攒齐的换代资金':'单级手动购买，不预留换代资金',22,136,this.w-44,12,C.muted);
    }
    const reasons={'machine-fund-reserved':'已预留换代资金','not-enough-coins':'金币不足，继续生产','max-level':'已达到最高等级','busy':'奖励处理中','bulk-upgrade-locked':'多头机后开放'};
    const compact=this.h<560&&bulkUnlocked;
    v.upgrades.filter(u=>u.unlocked!==false).forEach((u,i)=>{
      const y=(bulkUnlocked?151:84)+i*(compact?94:108),b=batch?u.bulk:null,p=b?b.preview:u.preview;
      const count=b?b.count:u.level>=u.maxLevel?0:1,canBuy=b?b.canBuy:u.canBuy,cost=b?b.cost:u.cost;
      this.box(16,y,this.w-32,compact?88:102,C.mint,u.key===focusUpgrade?C.orange:undefined);
      this.label(u.name+' · '+(b?b.fromLevel+' → '+b.toLevel:u.level)+'级',28,y+17,this.w-56,16,C.ink,750);
      this.label(p?rate(p.before)+' → '+rate(p.after)+' '+p.unit:u.level>=u.maxLevel?'永久升级已满级':'本次可购买 0 级',28,y+39,this.w-56,13,C.green);
      const status=b?(count>0?'合计 '+num(cost)+' 金币':reasons[b.reason]||'暂不可批量升级'):canBuy?'花费 '+num(cost)+' 金币':u.level>=u.maxLevel?'已达到最高等级':'还差 '+num(Math.ceil(cost-v.state.coins))+' 金币';
      this.label(status,28,y+(compact?60:67),this.w-164,12,C.muted);
      const note=u.key==='tap'?(v.factory&&v.factory.unlocked?'提高添料与爆锅产量':'每次点击产量提升'):b&&b.reservedCoins>0?'已预留换代资金':b?'逐级原价合计':canBuy?'升级立即生效':'单级购买';
      this.label(note,28,y+(compact?80:88),this.w-164,11,C.green);
      const action=b?'upgradeBatch:'+u.key+':'+b.fromLevel+':'+b.count+':'+b.cost:'upgrade:'+u.key;
      this.button(this.w-132,y+(compact?42:53),104,count>0?'升级 '+count+'级':u.level>=u.maxLevel?'已满级':'暂不可购买',action,{disabled:!canBuy||count===0,size:14});
    });
    if(!bulkUnlocked&&this.h>560)this.lines('永久升级随设备换代保留。',22,428,this.w-44,14,C.muted,21);
    this.backButton();
  }
  workshop(v){
    const n=v.nextMachine,small=this.h<760;
    this.preview(this.w/2,small?120:147,small?80:125,v.state.machine);
    this.text(v.machine.name,this.w/2,small?174:208,18,C.green,750,'center');
    const rows=[['下一台：'+(n?n.name:'全部落成'),'machine']];
    if(!v.onboarding||v.state.onboarding&&v.state.onboarding.legacy||this.feature(v,'souvenirs'))rows.push(['六阶段工厂蓝图','blueprint']);
    if(v.factory&&this.feature(v,'modules'))rows.push(['设备图鉴 · '+v.factory.ownedCount+' / '+v.factory.totalModules,'modules']);
    if(this.feature(v,'brand'))rows.push(['品牌合作 · 累计 +'+v.brand.bonusPercent+'%','brand']);
    if(this.feature(v,'rewards'))rows.push(['涡轮增压 · '+(v.boostSeconds>0?'剩余 '+Math.ceil(v.boostSeconds)+' 秒':'自动产速 ×3'),'turbo']);
    if(this.feature(v,'records'))rows.push(['经营记录','stats']);
    if(this.feature(v,'souvenirs')&&v.souvenirs&&v.souvenirs.unlocked)rows.push(['竣工收藏 · '+v.souvenirs.ownedCount+' / '+v.souvenirs.total,'souvenirs']);
    const short={machine:n?'设备换代':'设备已落成',blueprint:'工厂蓝图',modules:'设备图鉴 '+(v.factory?v.factory.ownedCount:0)+'/6',brand:'品牌 +'+v.brand.bonusPercent+'%',turbo:'涡轮增压',stats:'经营记录',souvenirs:'竣工收藏 '+(v.souvenirs?v.souvenirs.ownedCount:0)+'/3'};
    rows.forEach(([s,a],i)=>this.button(small?22+i%2*(this.w-38)/2:22,(small?195:232)+(small?Math.floor(i/2)*54:i*53),small?(this.w-50)/2:this.w-44,small?short[a]:s,a,{fill:['souvenirs','modules'].includes(a)?C.yellow:C.mint,color:C.green,size:small?14:15}));
    this.backButton();
  }
  moduleIcon(id,x,y,size=28){this.r.scene.drawModulePreview(x-size/2,y-size/2,size,id);}
  modules(v,m={}){
    const f=v.factory;
    if(!f||!this.feature(v,'modules')){this.lines('换代至双缸机后，可查看六件设备的获取条件。',22,99,this.w-44,16,C.green,26);this.backButton();return;}
    this.label('已收集 '+f.ownedCount+' / '+f.totalModules+' · 获得后永久生效',22,85,this.w-44,15,C.green,750);
    this.label(f.collectionComplete?'六件设备已集齐，一起为工厂工作！':'完成条件自动获得，全部设备同时工作。',22,108,this.w-44,12,C.muted);
    const pressure=f.modules.some(item=>item.id==='pressure'&&item.owned),cardTop=pressure?178:129;
    if(pressure){
      const half=(this.w-52)/2;
      this.button(22,126,half,'自动放锅','pressureMode:auto',{size:13,subLabel:f.pressureMode==='auto'?'当前模式 · 每锅 +25%':'切换即释放已存锅',disabled:!f.canSetPressureMode,fill:f.pressureMode==='auto'?C.green:C.mint,color:f.pressureMode==='auto'?C.white:C.green});
      this.button(30+half,126,half,'手动储压','pressureMode:hold',{size:13,subLabel:f.pressureMode==='hold'?'当前模式 · 留一锅备用':'可留一锅，手动放出',disabled:!f.canSetPressureMode,fill:f.pressureMode==='hold'?C.green:C.mint,color:f.pressureMode==='hold'?C.white:C.green});
    }
    const perPage=Math.max(1,Math.min(3,Math.floor((this.h-140-cardTop)/138))),pages=Math.max(1,Math.ceil(f.modules.length/perPage)),page=Math.max(0,Math.min(pages-1,m.page||0));
    m.page=page;
    for(const [i,item] of f.modules.slice(page*perPage,(page+1)*perPage).entries()){
      const y=cardTop+i*138;
      this.box(16,y,this.w-32,130,item.owned?C.mint:'#f0f2e8',item.owned?C.green:undefined);
      this.r.c.save();if(!item.owned)this.r.c.globalAlpha=.42;this.moduleIcon(item.id,42,y+27,29);this.r.c.restore();
      this.label(item.name,65,y+19,this.w-96,16,item.owned?C.green:C.muted,750);
      this.label(item.owned?'已获得 · 永久生效':'待获得 · 完成条件自动加入',65,y+40,this.w-96,11,C.muted);
      this.lines(item.description,28,y+59,this.w-56,12,C.ink,17);
      this.label(item.condition,28,y+94,this.w-56,11,C.muted);
      this.label(item.owned?'正在为工厂工作':item.progressText,28,y+112,this.w-56,11,C.green,650);
      this.progress(28,y+124,this.w-56,4,item.owned?1:item.progress);
    }
    if(pages>1){
      this.button(22,this.h-126,92,'上一页','modulePage:'+Math.max(0,page-1),{disabled:page===0,fill:C.mint,color:C.green,size:13});
      this.text((page+1)+' / '+pages,this.w/2,this.h-104,13,C.muted,600,'center');
      this.button(this.w-114,this.h-126,92,'下一页','modulePage:'+Math.min(pages-1,page+1),{disabled:page===pages-1,fill:C.mint,color:C.green,size:13});
    }
    this.backButton();
  }
  heatLesson(v){
    this.text('自动蓄能，满锅就出货',22,96,20,C.green,750);
    const copy=['能量蓄满后自动爆锅，产量和金币即时结算。升级设备，让每锅收获更多。'];
    if(this.feature(v,'pot'))copy.push('每锅最多添料3次，松手仍会自动蓄能。');
    if(this.feature(v,'pressure'))copy.push('蓄压罐默认满锅自动增产25%。图鉴中可改为手动储压，按「放出整锅」后结算。');
    if(this.feature(v,'feeder'))copy.push('送料器每次满锅自动额外添料一次，不占手动次数。');
    this.lines(copy.join('\n\n'),22,139,this.w-44,15,C.ink,25);
    this.backButton();
  }
  quests(v,m){const qs=v.quests,chapters=qs.chapters.filter(c=>!v.onboarding||v.state.onboarding&&v.state.onboarding.legacy||c.unlocked),ch=chapters.find(c=>c.id===m.chapterId)||chapters.find(c=>c.id===qs.activeChapterId)||chapters[0];
    chapters.forEach((c,i)=>this.button(16+i*(this.w-32)/chapters.length,78,(this.w-32)/chapters.length-4,c.title,'questChapter:'+c.id,{fill:ch.id===c.id?C.green:C.mint,color:ch.id===c.id?C.white:C.green,size:14}));
    this.label(ch.unlocked?'达成自动记录，奖励自动到账':'继续经营解锁下一章，已有进度保留',22,145,this.w-44,14,C.muted);
    const perPage=this.h<760?2:4,page=Math.max(0,Math.min(Math.ceil(ch.quests.length/perPage)-1,m.page||0));
    ch.quests.slice(page*perPage,(page+1)*perPage).forEach((q,i)=>{const yy=165+i*122;this.box(16,yy,this.w-32,112,q.claimed?C.mint:'#f1f2e8');this.label(q.title,27,yy+20,this.w-54,16,C.ink,750);this.label(q.description,27,yy+44,this.w-54,14,C.ink);this.label((q.claimed?'已到账 +':'达成自动 +')+num(q.reward)+' 金币',27,yy+72,this.w-163,13,C.green,650);this.text(num(Math.min(q.current,q.target))+' / '+num(q.target),27,yy+94,12,C.muted);this.button(this.w-124,yy+61,96,q.claimed?'已完成':q.locked?'待解锁':'去完成','questGo:'+q.id,{disabled:q.claimed||q.locked,size:14});});
    if(perPage===2){this.button(22,this.h-127,95,'上一页','questPage:'+Math.max(0,page-1),{disabled:page===0,fill:C.mint,color:C.green});this.text((page+1)+' / 2',this.w/2,this.h-105,14,C.muted,600,'center');this.button(this.w-117,this.h-127,95,'下一页','questPage:'+Math.min(1,page+1),{disabled:page===1,fill:C.mint,color:C.green});}this.backButton();
  }
  machine(v,m){
    if(m.type==='blueprint'){
      const page=Math.max(0,Math.min(1,m.page||0)),perPage=3,step=Math.min(118,Math.floor((this.h-218)/3));
      CONFIG.machines.slice(page*perPage,(page+1)*perPage).forEach((n,i)=>{
        const index=page*perPage+i,y=84+i*step,form=PRODUCTION_FORMS[index];
        this.box(16,y,this.w-32,step-7,index===v.state.machine?C.mint:'#f2f2e8');
        this.productionPreview(64,y+(step-7)/2,72,index);
        this.label(form.unit+' · '+n.name,110,y+18,this.w-132,13,C.ink,750);
        this.label(form.rhythm,110,y+40,this.w-132,12,C.green,650);
        this.label(index===v.state.machine?'当前产出':index<v.state.machine?'已落成':num(n.cost)+' 金币 · '+n.requiredOrders+' 单',110,y+61,this.w-132,11,C.muted);
        const ability=index===2?'开放设备图鉴与自选合同':index===3?'获得自动送料器与批量升级':index===4?'扩大产能，继续收集设备':'';
        if(ability)this.label(ability,110,y+82,this.w-132,11,C.green);
        else this.label(form.unlock,110,y+82,this.w-132,11,C.green);
      });
      this.button(22,this.h-122,112,page===0?'后 3 代 →':'← 前 3 代','blueprintPage:'+(1-page),{fill:C.mint,color:C.green});
      this.label('产出形态 · '+(page+1)+' / 2',this.w-22,this.h-100,this.w-166,12,C.green,650,'right');this.backButton();return;
    }
    const n=v.nextMachine,p=v.machinePreview;
    if(!n){this.text('六代工厂，整垛出货',22,108,20,C.green,750);this.productionPreview(this.w/2,205,140,5);this.label(PRODUCTION_FORMS[5].rhythm,this.w/2,305,this.w-44,16,C.green,650,'center');this.backButton();return;}
    const compact=this.h<640,cardY=81,cardH=compact?104:148,cardW=(this.w-56)/2;
    [v.machine,n].forEach((machine,i)=>{
      const stage=v.state.machine+i,x=22+i*(cardW+12),form=PRODUCTION_FORMS[stage];
      this.box(x,cardY,cardW,cardH,i?C.mint:'#f0f2e8',i?C.green:undefined);
      this.label(machine.name,x+cardW/2,cardY+16,cardW-14,13,i?C.green:C.muted,650,'center');
      this.productionPreview(x+cardW/2,cardY+(compact?53:78),compact?80:112,stage);
      this.label(form.unit,x+cardW/2,cardY+cardH-13,cardW-12,14,i?C.green:C.muted,750,'center');
    });
    this.r.arrow(this.w/2-10,cardY+cardH/2-10,20,C.green);
    const form=PRODUCTION_FORMS[v.state.machine+1],y=cardY+cardH+21;
    this.label(form.unlock,22,y,this.w-44,16,C.green,750);
    this.label(form.rhythm,22,y+21,this.w-44,13,C.muted);
    this.text('永久自动金币 / 秒',22,y+44,12,C.muted);this.label(rate(p.incomeBefore)+' → '+rate(p.incomeAfter),22,y+67,this.w-44,22,C.green,800);
    this.label('点击 '+rate(p.tapBefore)+' → '+rate(p.tapAfter)+' 份',22,y+88,this.w-44,13,C.ink);
    const ability=n.id===2?'新能力：按锅投料＋设备图鉴':n.id===3?'获得自动送料器，开放批量升级':n.id===4?'更高产能，继续收集永久设备':'';
    this.label(ability||'永久升级保留，开机即按新形态出货',22,y+110,this.w-44,12,C.green,650);
    this.label((v.state.coins>=n.cost?'金币已备齐':'还差 '+num(Math.ceil(n.cost-v.state.coins))+' 金币')+' · 订单 '+Math.min(v.state.orderIndex,n.requiredOrders)+' / '+n.requiredOrders,22,y+132,this.w-44,13,C.ink,650);
    const step=v.evolveReason==='not-enough-coins'?selectNextStep(v,null,{suppressModeAdvice:true}):null;
    if(step&&step.kind==='upgrade'&&step.enabled&&step.estimate){
      const y=this.h-176;this.box(22,y,this.w-44,44,C.green);
      this.label('查看提速升级',this.w/2,y+14,this.w-60,15,C.white,700,'center');
      this.label('按常驻收入估算，可更快攒齐',this.w/2,y+33,this.w-60,11,C.white,500,'center');
      this.r.hit(22,y,this.w-44,44,'fundingUpgrade:'+step.upgradeKey);
    }else this.button(22,this.h-176,this.w-44,v.canEvolve?'换代，开启'+form.unit+'！':v.evolveReason==='orders-required'?'先完成所需订单':'金币不足，继续生产','evolve',{disabled:!v.canEvolve});
    this.adButton(v,'sponsor',this.h-120,'查看设备赞助','machine');this.backButton();
  }
  order(v,m={}){
    const o=v.order,contracts=v.contracts,active=contracts&&contracts.active;
    if(o.completed||contracts&&contracts.completed){
      this.text('20单完成 · 工厂竣工',22,100,21,C.green,800);
      this.productionPreview(this.w/2,209,155,v.state.machine);
      this.lines('你已把街角小锅建成完整工厂。\n继续生产、记录收益，或布置竣工纪念物。',22,312,this.w-44,15,C.ink,24);
      if(v.souvenirs&&v.souvenirs.unlocked)this.button(22,this.h-124,this.w-44,'布置竣工收藏','souvenirs',{fill:C.yellow,color:C.green});
      this.backButton();return;
    }
    if(o.awaitingSelection&&contracts){
      const options=(contracts.options||[]).filter(option=>option.unlocked!==false),page=Math.max(0,Math.min(options.length-1,m.page||0)),item=options[page];
      m.contractQuotes={};options.forEach(option=>{m.contractQuotes[option.kind]={...option};});
      options.forEach((option,i)=>this.button(16+i*(this.w-26)/options.length,77,(this.w-32)/options.length-2,({cinema:'影院量产',gift:'精品礼盒',festival:'节庆爆发'})[option.kind]||option.title,'contractPage:'+i,{fill:i===page?C.green:C.mint,color:i===page?C.white:C.green,size:13}));
      if(item){
        const cardBottom=this.h-188;
        this.box(16,134,this.w-32,cardBottom-134,C.mint);
        this.label(item.title+' · 第'+(v.state.orderIndex+1)+'单',28,156,this.w-56,18,C.green,750);
        const description=item.description.split(/分配|占用/);
        const compact=this.h<520;
        if(compact)this.label(description[0],28,181,this.w-56,12,C.ink);
        else this.lines(description[0],28,181,this.w-56,13,C.ink,19);
        this.label('备货时占用'+Math.round(item.allocation*100)+'%产能 · 货款交付结算',28,compact?204:224,this.w-56,12,C.muted);
        const requirements=item.requirements||[],start=compact?226:250;
        requirements.forEach((req,i)=>this.label(req.label+' '+num(req.target)+' '+req.unit,28,start+i*25,this.w-56,14,C.green,650));
        this.label('合同奖励 '+num(item.reward)+' 金币',28,cardBottom-16,this.w-56,14,C.green,750);
        const reasons={'module-required':'完成条件获得所需设备','coating-required':'先获得糖衣机','packer-required':'先获得装箱臂','pressure-required':'先获得蓄压罐','busy':'奖励处理中','machine-required':'先换代至双缸机'};
        this.button(22,this.h-174,this.w-44,item.canAccept?'接下这张合同':reasons[item.reason]||'完成解锁条件后可接单','contractAccept:'+item.kind+':'+item.id,{disabled:!item.canAccept,size:15});
      }
      if(this.feature(v,'modules'))this.button(22,this.h-122,this.w-44,'设备图鉴 · 已获得设备同时生效','modules',{fill:C.yellow,color:C.green,size:14});
      this.backButton();return;
    }
    this.label(o.name,22,90,this.w-44,20,C.green,750);
    this.text('第 '+(v.state.orderIndex+1)+' / 20 单',22,116,13,C.muted);
    this.text(o.ready?'已达标':this.orderPercent(o)+'%',this.w-22,116,14,C.green,750,'right');
    this.progress(22,133,this.w-44,8,o.stageProgress);
    if(active){
      const retailOnly=active.ready||active.heldProduction>=active.quantityTarget;
      this.label(retailOnly?(active.ready?'合同已达标 · 后续产出即时售卖':'备货已齐 · 后续产出即时售卖'):Math.round(active.allocation*100)+'%产能备货，'+Math.round((1-active.allocation)*100)+'%即时售卖',22,156,this.w-44,12,C.muted);
      const split=retailOnly?0:active.allocation,half=(this.w-52)/2;
      this.box(22,171,half,50,'#fff3ca');this.box(30+half,171,half,50,C.mint);
      this.label('现款 → 钱包',32,185,half-20,12,C.green,700);
      this.label('+'+rate(v.production.auto*v.production.price*(1-split))+' /秒',32,207,half-20,14,C.ink,700);
      this.label('备货 → 待交货款',40+half,185,half-20,12,C.green,700);
      this.label(num(active.heldCoins)+' 金币',40+half,207,half-20,14,C.ink,700);
      const requirements=active.requirements||o.requirements||[],step=Math.min(54,Math.floor((this.h-370)/Math.max(1,requirements.length)));
      requirements.forEach((req,i)=>{
        const y=232+i*step;this.box(22,y,this.w-44,step-5,C.mint);
        this.label(active.kind==='gift'?'原料 '+num(Math.min(active.heldProduction,active.quantityTarget))+' → 糖衣成品':active.kind==='festival'?'真实出锅 · 满格记一锅':req.label,33,y+11,this.w-66,12,C.muted);
        this.label(num(Math.min(req.current,req.target))+' / '+num(req.target)+' '+req.unit,this.w-33,y+step-23,this.w-66,14,C.green,750,'right');
        if(active.kind==='festival')for(let j=0;j<3;j++)this.progress(33+j*(this.w-66)/3,y+step-12,(this.w-78)/3,4,req.current>j?1:0,C.yellow);
        else this.progress(33,y+step-12,this.w-66,4,req.current/req.target,C.green);
      });
      const detailsY=Math.max(232+requirements.length*step+10,this.h-224);
      this.label('待交 '+num(active.heldProduction)+' 份 · 货款 '+num(active.heldCoins),22,detailsY,this.w-44,12,C.muted);
      this.label('装车结算 '+num(o.reward)+' 金币',22,detailsY+22,this.w-44,16,C.green,750);
    }else{
      this.label('累计 '+num(v.state.totalProduced)+' / '+num(o.target)+' 份',22,159,this.w-44,13,C.ink);
      this.box(22,186,this.w-44,80,C.mint);this.text('达标额外奖励',36,209,14,C.muted);this.text(num(o.reward)+' 金币',36,241,25,C.green,800);
      if(this.h>560)this.lines(o.ready?'直接装车，下一单继续成长。':'生产即售卖，累计达标可领订单奖励。',22,293,this.w-44,14,C.muted,21);
    }
    this.button(22,this.h-172,this.w-44,'直接装车 · '+num(o.reward)+' 金币','claimOrder',{disabled:!o.ready});
    if(o.ready)this.adButton(v,'order',this.h-122,'加价后共 '+num(o.reward*3)+' 金币','order');
    else if(active)this.button(22,this.h-122,this.w-44,'取消合同 · 清空本单货物与进度','contractCancel:'+active.id,{fill:'#edf0e5',color:C.muted,size:12});
    this.backButton();
  }  souvenirs(v,m){
    const collection=v.souvenirs;m.souvenirQuotes={};
    if(!collection||!collection.unlocked){this.lines('完成20张主线订单后，用金币收藏工厂纪念装饰。',22,106,this.w-44,16,C.green,25);this.backButton();return;}
    this.label('已收藏 '+collection.ownedCount+' / '+collection.total+' · 金币换工厂装饰',22,91,this.w-44,14,C.green,700);
    this.label('购买后出现在工厂，收藏永久保留。',22,114,this.w-44,13,C.muted);
    collection.options.forEach((item,i)=>{
      m.souvenirQuotes[item.key]={...item};
      const y=132+i*102;this.box(16,y,this.w-32,96,item.owned?C.mint:'#f0f2e8');
      this.label(item.name,28,y+19,this.w-56,17,C.green,750);
      this.label(item.description,28,y+41,this.w-56,12,C.muted);
      this.label(item.owned?'已经摆进工厂':num(item.cost)+' 金币',28,y+64,this.w-164,13,C.ink,650);
      this.label(item.owned?'收藏会随存档保留':item.canBuy?'金币已备齐':'还差 '+num(Math.max(0,Math.ceil(item.cost-v.state.coins)))+' 金币',28,y+84,this.w-164,11,C.muted);
      this.button(this.w-124,y+46,96,item.owned?'已摆放':'购买收藏','souvenir:'+item.key,{disabled:!item.canBuy||item.owned,size:13});
    });
    this.backButton();
  }
  offline(v){
    const o=v.offline,summary=selectOfflineSummary(v);
    if(!o||!summary){this.text('离线收益已经领取',22,105,16,C.green);this.backButton();return;}
    this.text('离线营业 '+this.r.duration(o.seconds),22,98,16,C.green);
    this.box(22,119,this.w-44,80,C.mint);
    this.text('+'+num(summary.coins)+' 金币',this.w/2,147,26,C.green,800,'center');
    this.text('生产 +'+num(summary.production)+' 份',this.w/2,178,15,C.green,650,'center');
    const order=summary.order;
    if(order&&v.order.completed)this.label('主线已完成 · 继续布置工厂',22,230,this.w-44,15,C.green,700);
    else if(order&&v.order.awaitingSelection)this.label('当前未接合同 · 这次离线收益直接入账',22,230,this.w-44,13,C.green,700);
    else if(order){
      const percent=(p,ready)=>ready?100:Math.min(99,Math.floor(p*100));
      this.text('领取后本单 '+percent(order.progressBefore,order.readyBefore)+'% → '+percent(order.progressAfter,order.readyAfter)+'%',22,219,15,C.ink,700);
      const unit=v.order.requirements&&v.order.requirements[0]?v.order.requirements[0].unit:'份';
      this.label(order.readyAfter?'本单达标，可领取订单奖励':'本单还差 '+num(Math.ceil(order.missingProduction))+' '+unit,22,242,this.w-44,13,C.green);
    }
    this.box(22,263,this.w-44,64,'#f0f2e8');
    this.label(summary.nextStep.title,34,282,this.w-68,14,C.green,700);
    this.label(summary.nextStep.detail,34,307,this.w-68,13,C.muted);
    this.lines(summary.ruleText,22,347,this.w-44,12,C.muted,17);
    this.button(22,this.h-179,this.w-44,'领取收益，开工！','claimOffline');
    this.adButton(v,'offline',this.h-123,'现款翻倍后共 '+num(summary.coins*2),'offline');
    this.backButton();
  }
  brand(v){
    const b=v.brand;
    this.text('品牌 Lv.'+b.level+' / '+b.maxLevel,22,101,20,C.green,800);
    this.box(22,126,this.w-44,147,C.mint);
    this.text(b.maxed?'累计产量加成 · 已满级':'下一次合作 · 累计产量加成',36,148,14,C.muted);
    this.text('+'+b.bonusPercent+'% → +'+b.nextBonusPercent+'%',36,178,24,C.green,800);
    this.label('永久产量 '+rate(b.baseAutoBefore)+' → '+rate(b.baseAutoAfter)+' 份/秒',36,211,this.w-72,14,C.ink);
    this.label('自动 '+rate(b.baseIncomeBefore)+' → '+rate(b.baseIncomeAfter)+' 金币/秒',36,241,this.w-72,14,C.ink);
    this.lines('每级增加 20 个百分点，实际增量见上方。点击、自动、爆锅及后续离线一起提升。',22,293,this.w-44,14,C.ink,21);
    this.lines('订单和任务金币不增加。换代后再开放两级，最高 +200%；换代和重启后保留。',22,366,this.w-44,13,C.muted,20);
    this.adButton(v,'brand',this.h-126,b.maxed?'合作已满级':'永久升至 Lv.'+(b.level+1),'brand');this.backButton();
  }
  reward(v,ui){const q=ui.modal.quote,p=ui.modal.impact||v.rewards[q.kind].impact;this.label(q.title,22,98,this.w-44,18,C.green,750);this.impact(p,141);
    if(q.kind==='sponsor')this.text('本次到账 +'+num(q.amount)+' 金币',22,269,17,C.green,750);
    if(q.kind==='order'||q.kind==='offline')this.text('额外 +'+num(q.amount)+' 金币',22,269,17,C.green,750);
    this.lines('由你选择是否观看；未完整观看不发奖。',22,308,this.w-44,14,C.muted,22);
    if(ui.isDouyin){this.button(22,this.h-130,this.w-44,ui.adBusy?'广告加载 / 播放中…':'观看广告，领取奖励','watch',{disabled:ui.adBusy,fill:C.yellow,color:C.ink});this.backButton();}
    else {this.text('浏览器模拟 · 不播放真实广告',this.w/2,this.h-204,14,C.green,650,'center');this.button(22,this.h-181,this.w-44,'模拟完整观看','simulate:complete',{fill:C.yellow,color:C.ink,disabled:ui.adBusy});this.button(22,this.h-126,(this.w-54)/2,'模拟中途关闭','simulate:cancel',{fill:C.mint,color:C.green,size:14,disabled:ui.adBusy});this.button(this.w/2+5,this.h-126,(this.w-54)/2,'模拟加载失败','simulate:fail',{fill:C.mint,color:C.green,size:14,disabled:ui.adBusy});this.backButton();}
  }
  settings(v,ui){
    const rows=[['音效 · '+(v.state.settings.sound?'已开启':'已关闭'),'setting:sound'],['震动 · '+(v.state.settings.haptics?'已开启':'已关闭'),'setting:haptics'],['经营引导 · 回看已解锁玩法','guidebook'],['存档与隐私','privacy'],['健康游戏忠告','health']];
    if(ui.isDouyin&&ui.sidebar&&ui.sidebar.supported)rows.push(['侧边栏再来玩','sidebar']);
    rows.push(['删除存档并重新开始','restart']);
    const step=Math.min(55,Math.floor((this.h-166)/rows.length));
    rows.forEach(([s,a],i)=>this.button(22,83+i*step,this.w-44,s,a,{fill:a==='restart'?'#f8e4df':C.mint,color:a==='restart'?'#a13e34':C.green}));
    this.backButton();
  }
}
module.exports={GameInterface};
