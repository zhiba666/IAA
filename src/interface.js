'use strict';

const { CONFIG, formatNumber: num } = require('./core');
const { selectCurrentTarget } = require('./experience');
const { selectHeatGuide, selectRecoveryLesson } = require('./heat-guide');
const { selectNextStep } = require('./next-step');
const { selectOfflineSummary } = require('./offline-summary');
const C={ink:'#283e32',muted:'#687764',paper:'#f8f6ed',white:'#fffdf7',green:'#366348',mint:'#deebd5',yellow:'#f4ca58',orange:'#df9954',line:'#dce3d2'};
const rate=n=>n>0&&n<10?Number(n.toFixed(2)).toString():num(n);
const HEALTH=['抵制不良游戏，拒绝盗版游戏。','注意自我保护，谨防受骗上当。','适度游戏益脑，沉迷游戏伤身。','合理安排时间，享受健康生活。'];

// Coordinates are viewport CSS pixels. Scenes can shrink; controls and copy do not.
class GameInterface {
  constructor(renderer){this.r=renderer;this.adEntries=[];this.recommendation=null;this.visibleTarget=null;}
  isGoalExpanded(v,ui){return ui.goalExpanded===true||(ui.goalExpanded!==false&&(!!v.tutorial||(selectCurrentTarget(v,ui)||{}).source==='learning'));}
  text(s,x,y,size=14,color=C.ink,weight=500,align='left'){this.r.text(s,x,y,size,color,weight,align);}
  ellipsis(s,width,size=14){s=String(s);this.r.c.font=`500 ${size}px "Microsoft YaHei",sans-serif`;if(this.r.c.measureText(s).width<=width)return s;while(s.length&&this.r.c.measureText(s+'…').width>width)s=s.slice(0,-1);return s+'…';}
  label(s,x,y,width,size=14,color=C.ink,weight=500,align='left'){this.text(this.ellipsis(s,width,size),x,y,size,color,weight,align);}
  lines(s,x,y,width,size=14,color=C.muted,line=21){return this.r.wrap(s,x,y,width,size,color,line);}
  box(x,y,w,h,fill=C.white,stroke){this.r.box(x,y,w,h,14,fill,stroke);}
  preview(cx,cy,size,stage){this.r.scene.drawMachinePreview(cx-size/2,cy-size/2,size,stage);}
  button(x,y,w,label,action,{fill=C.green,color=C.white,disabled=false,h=44,size=15,subLabel=''}={}){this.box(x,y,w,h,disabled?'#e6e8de':fill);if(!disabled&&action===this.r.guideAction)this.r.box(x-2,y-2,w+4,h+4,15,null,C.orange);this.label(label,x+w/2,y+h/2-(subLabel?8:0),w-16,size,disabled?C.muted:color,700,'center');if(subLabel)this.label(subLabel,x+w/2,y+h/2+11,w-16,11,disabled?C.muted:color,500,'center');if(!disabled)this.r.hit(x,y,w,h,action);}
  adButton(v,kind,y,label,placement='sheet'){const offer=v.rewards[kind];this.button(22,y,this.w-44,'广告 · '+(offer.available?label:this.r.rewardStatus(v,kind)),'ad:'+kind,{fill:C.yellow,color:C.ink,disabled:!offer.available});this.adEntries.push({kind,placement,available:offer.available,reason:offer.reason||''});}
  draw(v,ui,dt){
    const r=this.r;this.w=ui.viewport.width;this.h=ui.viewport.height;this.x=12;this.cw=this.w-24;this.adEntries=[];this.recommendation=null;this.visibleTarget=null;r.zones=[];
    r.c.clearRect(0,0,this.w,this.h);this.box(0,0,this.w,this.h,C.paper);
    if(ui.startup){this.inSafeArea(ui,()=>this.welcome(ui));return;}
    const target=selectCurrentTarget(v,ui);r.currentTarget=target;r.guideAction=target?target.action:'';
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
    const navY=h-52,sceneBottom=navY-8,sceneH=sceneBottom-sceneTop,heatY=sceneBottom-76;
    const walletX=x+10,walletY=hudTop+10,walletW=Math.min(184,cw-160);
    const orderX=w-152,orderY=Math.max(walletY,(ui.viewport.menuBottom||0)+8),orderW=130,modeY=orderY+48;
    const expanded=this.isGoalExpanded(v,ui),goalY=Math.max(hudTop+112,modeY+52),goalH=132;
    const tapTop=expanded?goalY+goalH+8:Math.max(hudTop+138,modeY+52);
    this.feedbackY=tapTop+4;
    r.scene.update(ui.sceneDt===undefined?dt:ui.sceneDt,v);
    r.scene.draw(x,sceneTop,cw,sceneH,v,{topInset:tapTop-sceneTop,bottomInset:112});
    // Read-only balances float over the scene, outside the production hit area.
    this.box(walletX,walletY,walletW,70,'rgba(255,253,247,.96)');
    this.text('金币',walletX+12,walletY+15,11,C.muted);
    this.label(num(v.state.coins),walletX+12,walletY+36,walletW-24,21,C.ink,800);
    this.label('自动 +'+rate(v.production.auto*v.production.price)+' /秒',walletX+12,walletY+57,walletW-24,11,C.green,650);
    const modes=v.productionModes,currentMode=modes&&modes.options.find(mode=>mode.id===modes.current);
    if(modes&&modes.unlocked){
      this.button(orderX,modeY,orderW,currentMode.name+' · 切档 ›','productionModes',{fill:C.mint,color:C.green,size:13,subLabel:v.boostSeconds>0?'增压 '+Math.ceil(v.boostSeconds)+' 秒':v.machine.name});
    }else{
      this.label(v.machine.name,orderX+8,modeY+13,orderW-16,14,C.green,700);
      this.label(v.boostSeconds>0?'增压 '+Math.ceil(v.boostSeconds)+' 秒':'第 '+(v.state.machine+1)+' 阶段',orderX+8,modeY+32,orderW-16,11,C.muted);
    }
    if(r.notice&&!ui.toast){
      const yy=this.feedbackY,perfect=r.notice.perfect;
      this.box(x+10,yy,cw-20,54,perfect?'#fff0bc':'#fff8df',perfect?'#c29b3f':undefined);
      this.label(r.notice.title,w/2,yy+17,cw-40,16,C.green,800,'center');
      this.label(perfect?r.notice.bonusText:r.notice.text,w/2,yy+39,cw-40,13,C.ink,600,'center');
    }
    const recovery=v.milestones&&v.milestones.heatRecovery,remaining=recovery&&recovery.unlocked?recovery.remainingTaps:0;
    const f=!r.notice&&!ui.toast?r.floats.filter(item=>item.kind==='tap').slice(-1)[0]:null;
    this.label(f?f.text:'点机器 · 每次 +'+rate(v.production.tap)+'份',w/2,heatY-31,cw-32,f?17:13,C.green,750,'center');
    this.label(remaining>0?'余热×'+remaining+' · 每次+1能量':v.state.taps<5?'点机器，让玉米爆开 · '+v.state.taps+'/5':'点击机器或下方空地，都能生产',w/2,heatY-12,cw-32,11,C.muted,500,'center');
    // The full lower scene is a thumb-friendly production surface. HUD and heat
    // controls never overlap it; transient feedback does not intercept taps.
    r.hit(x,tapTop,cw,heatY-8-tapTop,'tap');
    const sideReward=!!(v.deliveries&&v.deliveries.readyCount||v.commissions&&v.commissions.active&&v.commissions.active.ready);
    this.box(orderX,orderY,orderW,44,v.order.ready?C.green:C.white);
    this.text(v.order.ready?'本单达标 · 领金币':sideReward?'阶段奖励可领取 ›':'本单 '+this.orderPercent(v.order)+'%  ›',orderX+orderW/2,orderY+15,13,v.order.ready?C.white:C.green,700,'center');
    this.progress(orderX+10,orderY+30,orderW-20,5,v.order.stageProgress,v.order.ready?C.yellow:C.green,v.order.ready?'#628169':'#dce5d5');
    r.hit(orderX,orderY,orderW,44,'order');
    this.heat(v,heatY);
    this.goal(v,ui,target,goalY,goalH);
    const nav=[['升级','upgrades'],['订单'+(sideReward?' · 奖':''),'order'],['任务'+(v.quests.readyCount?' · '+v.quests.readyCount:''),'quests'],['工厂','workshop']];
    nav.forEach(([name,action],i)=>this.button(x+i*(cw+6)/4,navY,(cw-18)/4,name,action,{fill:action==='order'&&v.order.ready?C.green:C.mint,color:action==='order'&&v.order.ready?C.white:C.green,size:14}));
  }
  orderPercent(order){return order.ready?100:Math.min(99,Math.floor(order.stageProgress*100));}
  progress(x,y,w,h,value,fill=C.green,track='#dce5d5'){
    const p=Math.max(0,Math.min(1,value));this.r.box(x,y,w,h,h/2,track);
    if(p>0)this.r.box(x,y,w*p,h,Math.min(h/2,w*p/2),fill);
  }
  heat(v,y){
    const r=this.r,x=this.x+8,w=this.cw-16,g=selectHeatGuide(v),best=g.state==='perfect';
    const zoom=v.timing.unlocked&&g.energy>=80&&!v.timing.armed&&!v.timing.attempted;
    const start=zoom?.8:0,span=1-start,progress=Math.max(0,Math.min(1,(g.progress-start)/span));
    const timingWidth=100,timingX=x+w-timingWidth,barW=w-timingWidth-12;
    this.box(x,y,w,68,'rgba(255,253,247,.96)');
    this.label(zoom&&g.state==='ready'?'末段火候 · 92–98点火':g.title,x+10,y+13,w-20,12,best?C.green:C.ink,700);
    this.text(g.energy.toFixed(1)+' / '+CONFIG.energyMax,x+10,y+32,11,C.muted,600);
    const guide=zoom?'80–100放大':v.timing.unlocked?CONFIG.timingWindowStart+'–'+CONFIG.timingWindowEnd+'最佳':'蓄满爆锅';
    this.label(guide,x+barW,y+32,barW-74,10,C.muted,500,'right');
    const barX=x+10,barWidth=barW-10;
    this.progress(barX,y+47,barWidth,12,progress,g.state==='armed'||best?C.green:C.yellow,'#d7e2cd');
    if(v.timing.unlocked){
      const left=barX+barWidth*(g.windowStart-start)/span,right=barX+barWidth*(g.windowEnd-start)/span;
      r.c.fillStyle=best?'#5c9964':'#87ae70';r.c.fillRect(left,y+45,right-left,16);
      r.line(left,y+45,left,y+61,C.white,2);r.line(right,y+45,right,y+61,C.white,2);
    }
    const marker=barX+Math.max(2,Math.min(barWidth-2,barWidth*progress));
    r.line(marker,y+45,marker,y+61,C.ink,2);r.circle(marker,y+45,3,C.ink);
    if(best)r.box(timingX-9,y+17,timingWidth+6,50,16,null,'#b3832d');
    this.button(timingX-6,y+20,timingWidth,g.buttonLabel,'timing',{h:44,disabled:!g.canAttempt,fill:best?C.green:C.yellow,color:best?C.white:C.ink,size:13});
    if(!g.canAttempt)r.hit(timingX-6,y+20,timingWidth,44,null);
  }
  goal(v,ui,target,y,height){
    const step=selectNextStep(v,target,ui),x=this.x+10,w=this.cw-20;
    if(!this.isGoalExpanded(v,ui)){
      const label=step.kind==='quest'?'可领奖 · '+Math.max(1,v.quests.readyCount):step.kind==='order'&&v.order.ready?'可装车 ›':step.kind==='machine'?'可换代 ›':step.kind==='delivery'?'可交付 ›':step.kind==='commission'?step.ready?'委托可领奖 ›':'委托进度 ›':step.kind==='souvenir'?'竣工收藏 ›':step.kind==='learning'?'学余热 ›':step.kind==='refinement'?'工艺强化 ›':step.kind==='mode'?'试试切档 ›':'下一步 ›';
      const detail=step.kind==='quest'?'成长奖励':step.kind==='upgrade'?'升级建议':step.kind==='save'?'攒钱目标':step.kind==='delivery'?'分段提前领奖':step.kind==='commission'?'自选经营目标':step.kind==='souvenir'?'金币换工厂装饰':step.kind==='mode'?step.bottleneck==='funding'?'攒换代金币':'加快本单生产':step.kind==='refinement'?'继续提升工厂':'当前目标';
      this.button(x,(ui.viewport.safeTop||0)+92,112,label,'goalExpand',{fill:step.kind==='quest'?C.yellow:C.white,color:C.green,size:13,subLabel:detail});
      return;
    }
    this.visibleTarget=target;this.recommendation=step;
    this.box(x,y,w,height,'rgba(255,253,247,.97)',C.line);
    this.label(target?target.title:'当前经营目标',x+12,y+18,w-86,14,C.green,750);
    this.label(target&&target.ready&&step.kind==='quest'?'目标已达成 · 领奖':step.title,x+12,y+40,w-86,13,C.ink,650);
    if(target&&target.action)this.r.hit(x+4,y+2,w-74,44,'target');
    this.button(x+w-62,y+4,56,step.kind==='learning'?'跳过':'收起',step.kind==='learning'?'skipHeatLesson':'goalCollapse',{fill:C.mint,color:C.green,size:12});
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
    this.top=12;this.bottom=this.h-12;this.bodyTop=80;this.box(6,this.top,this.w-12,this.h-24,C.white);
    this.button(this.w-56,19,44,'×','close',{fill:'#edf0e5',color:C.green,size:25,disabled:ui.adBusy});
    const titles={upgrades:'设备升级',refinements:'工艺强化',heatLesson:'余热接力',workshop:'我的工厂',quests:'成长任务',order:'订单装车',commissions:'可选委托',souvenirs:'竣工收藏',machine:'设备换代',blueprint:'工厂蓝图',brand:'品牌合作',reward:'本次广告奖励',offline:'欢迎回来，小厂长',settings:'工厂设置',help:'玩法说明',privacy:'存档与隐私',health:'健康游戏忠告',sidebar:'侧边栏再来玩',stats:'经营记录',completion:'工厂竣工纪念',turbo:'涡轮增压',productionModes:'生产档位'};
    const craftEntry=m.type==='upgrades'&&v.refinements&&v.refinements.unlocked;
    if(m.type==='heatLesson'&&!(v.milestones&&v.milestones.heatRecovery&&v.milestones.heatRecovery.unlocked))titles.heatLesson='火候练习';
    const commissionEntry=m.type==='order'&&v.commissions&&(v.commissions.unlocked||v.commissions.active);
    if(ui.toast)this.label(ui.toast,22,43,this.w-(craftEntry||m.type==='refinements'||commissionEntry?188:m.type==='workshop'?144:88),14,C.green,700);
    else this.text(titles[m.type]||'我的工厂',22,43,21,C.ink,800);
    if(m.type==='workshop')this.button(this.w-112,19,44,'⚙','settings',{fill:C.mint,color:C.green,size:22});
    if(craftEntry)this.button(this.w-150,19,86,'工艺 ›','refinements',{fill:C.yellow,color:C.green,size:13});
    if(m.type==='refinements')this.button(this.w-150,19,86,'升级 ›','upgrades',{fill:C.mint,color:C.green,size:13});
    if(commissionEntry)this.button(this.w-150,19,86,v.commissions.active&&v.commissions.active.ready?'委托 · 奖':'委托 ›','commissions',{fill:C.yellow,color:C.green,size:13});
    const type=m.type;
    if(type==='upgrades')this.upgrades(v,m,ui.focusUpgrade);
    else if(type==='refinements')this.refinements(v,m);
    else if(type==='heatLesson')this.heatLesson(v);
    else if(type==='workshop')this.workshop(v);
    else if(type==='productionModes')this.productionModes(v,m);
    else if(type==='quests')this.quests(v,m);
    else if(type==='machine'||type==='blueprint')this.machine(v,m);
    else if(type==='order')this.order(v);
    else if(type==='commissions')this.commissions(v,m);
    else if(type==='souvenirs')this.souvenirs(v,m);
    else if(type==='offline')this.offline(v);
    else if(type==='brand')this.brand(v);
    else if(type==='reward')this.reward(v,ui);
    else if(type==='turbo'){const p=v.rewards.turbo.impact;this.text('自动产速 ×3 · 持续 90 秒',22,99,17,C.green,750);this.impact(p,141);this.adButton(v,'turbo',this.h-128,v.boostSeconds>0?'延长增压':'开启增压','turbo');this.backButton();}
    else if(type==='stats'){[['总生产',num(v.state.totalProduced)+' 份'],['完成订单',(v.state.orderIndex+v.state.loopIndex)+' 单'],['免费爆锅',v.state.bursts+' 次'],['累计营业',num(v.state.totalCoins)+' 金币']].forEach(([k,s],i)=>{this.text(k,24,100+i*70,14,C.muted);this.text(s,24,129+i*70,23,C.green,750);});this.backButton();}
    else if(type==='settings')this.settings(v,ui);
    else if(type==='health'){HEALTH.forEach((s,i)=>this.text(s,this.w/2,125+i*43,Math.min(16,(this.w-42)/17),C.ink,500,'center'));this.backButton();}
    else if(type==='help'){this.lines('① 点击机器生产后自动售卖。升级提高产量或单价，松手也有自动收入。\n② 完成订单、领取目标奖励，攒金币换代。\n③ 满能量免费爆锅。首次爆锅后，92–98点火，本锅+20%；每锅一次，退出取消本锅加成。\n④ 双缸机开放三档，可免费切换。赶单多产量；高价攒金币。\n⑤ 多头机＋爆裂玉米Lv16解锁余热接力：完美爆锅后10次点击各额外+1能量，刷新不叠加，余热可保存。\n⑥ 多头机开放最多5级批量升级，逐级合计价格；保留攒齐的换代资金。单级可手动花费。\n⑦ 品牌累计加永久产量；离线不计临时增压。',22,91,this.w-44,14,C.ink,21);this.backButton();}
    else if(type==='privacy'){this.lines('金币、设备、订单、任务、品牌合作与设置保存在当前设备。\n\n每 5 秒及退出时自动保存。清理应用数据会影响进度。\n\n没有账号或云存档。体验记录默认只存在本地内存，刷新后重新记录；未开启平台上报时不联网发送。',22,97,this.w-44,15,C.ink,23);this.backButton();}
    else if(type==='sidebar'){this.lines(ui.sidebar&&ui.sidebar.fromSidebar?'欢迎回来，你已从侧边栏进入工厂。':'在抖音首页侧边栏，找到小小爆米花厂，继续今天的经营。',22,100,this.w-44,16,C.ink,26);this.button(22,this.h-184,this.w-44,ui.sidebarBusy?'正在打开…':'去侧边栏看看','visitSidebar',{disabled:ui.sidebarBusy||!ui.sidebar||!ui.sidebar.supported});this.backButton();}
    else if(type==='completion'){this.text('小小工厂，大大梦想',this.w/2,105,22,C.green,800,'center');this.preview(this.w/2,205,135,5);this.lines('20 个主线订单完成！\n累计生产 '+num(v.state.totalProduced)+' 份。\n完成循环订单，攒金币布置工厂。',22,294,this.w-44,15,C.ink,25);if(v.souvenirs&&v.souvenirs.unlocked)this.button(22,this.h-126,this.w-44,'竣工收藏 · '+v.souvenirs.ownedCount+' / '+v.souvenirs.total,'souvenirs',{fill:C.yellow,color:C.green});this.backButton();}
    if(ui.adBusy){r.zones=[];this.adEntries=[];}
  }
  backButton(){this.button(22,this.h-70,this.w-44,'继续经营','close',{fill:C.mint,color:C.green});}
  impact(p,y){if(!p)return;this.lines(p.title,22,y,this.w-44,16,C.green,23);this.lines(p.detail,22,y+52,this.w-44,14,C.muted,21);}
  upgrades(v,m={},focusUpgrade=''){
    const milestones=v.milestones||{},bulkUnlocked=milestones.bulkUpgrade&&milestones.bulkUpgrade.unlocked;
    const batch=bulkUnlocked&&m.quantity===5,recovery=milestones.heatRecovery;
    if(bulkUnlocked){
      const half=(this.w-50)/2;
      this.button(22,78,half,'单级','upgradeQuantity:1',{fill:batch?C.mint:C.green,color:batch?C.green:C.white});
      this.button(28+half,78,half,'最多5级','upgradeQuantity:5',{fill:batch?C.green:C.mint,color:batch?C.white:C.green});
      this.label(batch?'逐级合计价格；保留攒齐的换代资金':'单级手动购买，不预留换代资金',22,136,this.w-44,12,C.muted);
    }
    const reasons={'machine-fund-reserved':'已预留换代资金','not-enough-coins':'金币不足，继续生产','max-level':'已达到最高等级','busy':'奖励处理中','bulk-upgrade-locked':'多头机后开放'};
    const compact=this.h<560&&bulkUnlocked;
    v.upgrades.forEach((u,i)=>{
      const y=(bulkUnlocked?151:84)+i*(compact?94:108),b=batch?u.bulk:null,p=b?b.preview:u.preview;
      const count=b?b.count:u.level>=u.maxLevel?0:1,canBuy=b?b.canBuy:u.canBuy,cost=b?b.cost:u.cost;
      this.box(16,y,this.w-32,compact?88:102,C.mint,u.key===focusUpgrade?C.orange:undefined);
      this.label(u.name+' · '+(b?b.fromLevel+' → '+b.toLevel:u.level)+'级',28,y+17,this.w-56,16,C.ink,750);
      this.label(p?rate(p.before)+' → '+rate(p.after)+' '+p.unit:u.level>=u.maxLevel?'永久升级已满级':'本次可购买 0 级',28,y+39,this.w-56,13,C.green);
      const status=b?(count>0?'合计 '+num(cost)+' 金币':reasons[b.reason]||'暂不可批量升级'):canBuy?'花费 '+num(cost)+' 金币':u.level>=u.maxLevel?'已达到最高等级':'还差 '+num(Math.ceil(cost-v.state.coins))+' 金币';
      this.label(status,28,y+(compact?60:67),this.w-164,12,C.muted);
      const note=u.key==='tap'?(recovery&&recovery.unlocked?'余热接力已解锁':v.state.machine>=2?'多头机＋Lv16解锁余热':'每次点击产量提升'):b&&b.reservedCoins>0?'已预留换代资金':b?'逐级原价合计':canBuy?'升级立即生效':'单级购买';
      this.label(note,28,y+(compact?80:88),this.w-164,11,C.green);
      const action=b?'upgradeBatch:'+u.key+':'+b.fromLevel+':'+b.count+':'+b.cost:'upgrade:'+u.key;
      this.button(this.w-132,y+(compact?42:53),104,count>0?'升级 '+count+'级':u.level>=u.maxLevel?'已满级':'暂不可购买',action,{disabled:!canBuy||count===0,size:14});
    });
    if(!bulkUnlocked&&v.state.machine>=2){
      this.text('余热接力 · 多头机＋爆裂玉米Lv16',22,428,14,C.green,700);
      this.lines('完美爆锅后，接下来10次点击各额外+1能量。',22,452,this.w-44,13,C.muted,19);
    }else if(!bulkUnlocked)this.lines('永久升级随设备换代保留。',22,428,this.w-44,14,C.muted,21);
    this.backButton();
  }
  workshop(v){
    const n=v.nextMachine,modes=v.productionModes,unlocked=modes&&modes.unlocked,small=this.h<650;
    this.preview(this.w/2,small?120:147,small?80:125,v.state.machine);
    this.text(v.machine.name,this.w/2,small?174:208,18,C.green,750,'center');
    const rows=[['下一台：'+(n?n.name:'全部落成'),'machine'],['六阶段工厂蓝图','blueprint']];
    if(unlocked){const current=modes.options.find(mode=>mode.id===modes.current);rows.push(['生产档位 · '+current.name,'productionModes']);}
    rows.push(['品牌合作 · 累计 +'+v.brand.bonusPercent+'%','brand'],['涡轮增压 · '+(v.boostSeconds>0?'剩余 '+Math.ceil(v.boostSeconds)+' 秒':'自动产速 ×3'),'turbo'],['经营记录','stats']);
    if(v.souvenirs&&v.souvenirs.unlocked)rows.push(['竣工收藏 · '+v.souvenirs.ownedCount+' / '+v.souvenirs.total,'souvenirs']);
    const short={machine:n?'设备换代':'设备已落成',blueprint:'工厂蓝图',productionModes:'生产档位',brand:'品牌 +'+v.brand.bonusPercent+'%',turbo:'涡轮增压',stats:'经营记录',souvenirs:'竣工收藏 '+(v.souvenirs?v.souvenirs.ownedCount:0)+'/3'};
    rows.forEach(([s,a],i)=>this.button(small?22+i%2*(this.w-38)/2:22,(small?195:232)+(small?Math.floor(i/2)*54:i*53),small?(this.w-50)/2:this.w-44,small?short[a]:s,a,{fill:a==='souvenirs'?C.yellow:C.mint,color:C.green,size:small?14:15}));
    this.backButton();
  }
  refinements(v,m){
    const craft=v.refinements;
    if(!craft||!craft.unlocked){this.lines('开动自动流水线后，解锁永久工艺强化。',22,105,this.w-44,16,C.green,25);this.backButton();return;}
    this.text('让满级设备，继续成长',22,92,16,C.green,750);
    this.label('完成14 / 16 / 18单，逐段开放三级',22,116,this.w-44,13,C.muted);
    const compact=this.h<560;
    craft.options.forEach((item,i)=>{
      const y=(compact?130:136)+i*(compact?136:154),p=item.preview;
      this.box(16,y,this.w-32,compact?130:144,'#eef0df',m.focusRefinement===item.key?C.orange:C.line);
      this.label(item.name+' · Lv.'+item.level+' / '+item.maxLevel,28,y+21,this.w-56,17,C.ink,750);
      this.label(item.key==='yield'?'每级产量×1.2 · 点击、自动、爆锅':'每级售价×1.2 · 在线与离线',28,y+45,this.w-56,12,C.muted);
      this.label(p?rate(p.before)+' → '+rate(p.after)+' '+p.unit:'本项工艺已全部完成',28,y+69,this.w-56,14,C.green,650);
      const locked=item.level>=item.unlockedLevel,done=item.level>=item.maxLevel;
      const gate=CONFIG.refinements[item.key].levels[item.level];
      const status=done?'永久收益持续生效':locked?'完成'+gate.requiredOrders+'单解锁':num(item.cost)+' 金币';
      this.label(status,28,y+(compact?90:98),this.w-164,13,C.ink,650);
      this.label(done?'已满级':locked?'需'+CONFIG.machines[gate.requiredMachine].name:item.canBuy?'金币已备齐':'还差 '+num(Math.max(0,Math.ceil(item.cost-v.state.coins)))+' 金币',28,y+(compact?115:124),this.w-164,11,C.muted);
      this.button(this.w-132,y+(compact?79:90),104,done?'已满级':locked?'待解锁':'强化一级','refinement:'+item.key+':'+item.level+':'+item.cost,{disabled:!item.canBuy,fill:C.green,size:14});
    });
    this.label('手动花费金币；工艺随换代保留。',22,compact?420:461,this.w-44,12,C.green);
    this.label('需攒换代款时，可先比较生产档位。',22,compact?438:481,this.w-44,12,C.muted);
    this.backButton();
  }
  heatLesson(v){
    const lesson=selectRecoveryLesson(v),uses=v.state.learning?v.state.learning.heatRecoveryUses:0;
    const recovery=!!(v.milestones&&v.milestones.heatRecovery&&v.milestones.heatRecovery.unlocked);
    const compact=this.h<560;
    this.text(recovery?'把上一锅的火力，接给下一锅':'抓准火候，让这一锅多产20%',22,97,17,C.green,750);
    const rows=recovery?[['01  抓准火候','能量到92–98时点火，蓄满后完美爆锅。'],['02  接住余热','完美爆锅后，获得10次余热点击。'],['03  再快一点','每次点击额外+1能量，加快下一锅。']]:[['01  能量接近80时准备','末段能量条会放大，留意最佳区间。'],['02  在92–98点火','每锅一次，命中最佳区间标记完美。'],['03  继续生产直到蓄满','100能量免费爆锅，额外获得20%产量。']];
    rows.forEach(([title,body],i)=>{const y=(compact?122:126)+i*(compact?74:86);this.box(16,y,this.w-32,compact?66:77,C.mint);this.text(title,28,y+22,16,C.green,750);this.label(body,28,y+53,this.w-56,12,C.ink);});
    this.text(recovery?'余热练习 '+Math.min(10,uses||0)+' / 10 次':'额外产量在蓄满爆锅时结算',22,compact?360:412,15,C.green,750);
    this.label('不点火或没命中，仍会照常免费爆锅。',22,compact?383:438,this.w-44,12,C.muted);
    this.button(22,this.h-114,this.w-44,lesson?'先跳过练习':'返回工厂',lesson?'skipHeatLesson':'close',{fill:C.mint,color:C.green});
    this.button(22,this.h-64,this.w-44,lesson&&lesson.charged?'回工厂，点击用余热':'回工厂，试试点火','practiceHeat',{fill:C.green});
  }
  productionModes(v,m={}){
    const modes=v.productionModes;
    if(!modes||!modes.unlocked){this.lines('换代到双缸机后，可选择生产档位。',22,106,this.w-44,16,C.green,24);this.backButton();return;}
    const current=modes.options.find(mode=>mode.id===modes.current),before=current.preview;
    this.label(m.advice?m.advice.bottleneck==='funding'?'当前目标：攒够下一台设备金币':'当前目标：加快本单生产':'数值对比当前档位（不计临时增压）',22,92,this.w-44,14,C.green,700);
    this.label(m.advice?'推荐已描边，可自由选择；不计临时增压。':'加减幅度以常规档为准，可免费切换。',22,114,this.w-44,13,C.muted);
    const hints={balanced:'产量、售价保持常规',rush:'售价 -20% · 收入 -4%',premium:'售价 +50% · 产量 -20%'};
    const compact=this.h<560;
    modes.options.forEach((mode,i)=>{
      const y=(compact?130:138)+i*(compact?94:106),p=mode.preview;
      this.box(16,y,this.w-32,compact?88:98,mode.selected?C.mint:'#f0f2e8',m.advice&&m.advice.modeId===mode.id?C.orange:mode.selected?C.green:undefined);
      this.label(mode.name,28,y+19,this.w-165,16,C.green,750);
      this.label(hints[mode.id]||mode.description,28,y+(compact?37:42),this.w-165,12,C.muted);
      this.label('产量 '+rate(before.baseAuto)+' → '+rate(p.baseAuto)+' 份/秒',28,y+(compact?58:65),this.w-56,13,C.ink);
      this.label('收入 '+rate(before.baseIncome)+' → '+rate(p.baseIncome)+' 金币/秒',28,y+(compact?78:86),this.w-56,13,C.green);
      this.button(this.w-124,y+9,96,mode.selected?'使用中':'使用'+mode.name,'productionMode:'+mode.id,{disabled:mode.selected,fill:C.green,size:13});
    });
    this.lines('点击、爆锅也按档位；离线按离开时档位。',22,compact?427:466,this.w-44,13,C.muted,18);
    this.backButton();
  }
  quests(v,m){const qs=v.quests,chapters=qs.chapters,ch=chapters.find(c=>c.id===m.chapterId)||chapters.find(c=>c.id===qs.activeChapterId)||chapters[0];
    chapters.forEach((c,i)=>this.button(16+i*(this.w-32)/4,78,(this.w-40)/4,c.title,'questChapter:'+c.id,{fill:ch.id===c.id?C.green:C.mint,color:ch.id===c.id?C.white:C.green,size:14}));
    this.label(ch.unlocked?ch.subtitle:'领完上一章奖励后解锁，已有进度保留',22,145,this.w-44,14,C.muted);
    const perPage=this.h<760?2:4,page=Math.max(0,Math.min(Math.ceil(ch.quests.length/perPage)-1,m.page||0));
    ch.quests.slice(page*perPage,(page+1)*perPage).forEach((q,i)=>{const yy=165+i*122;this.box(16,yy,this.w-32,112,q.ready?C.mint:'#f1f2e8');this.label(q.title,27,yy+20,this.w-54,16,C.ink,750);this.label(q.description,27,yy+44,this.w-54,14,C.ink);this.text('奖励 +'+num(q.reward)+' 金币',27,yy+72,14,C.green,650);this.text(num(Math.min(q.current,q.target))+' / '+num(q.target),27,yy+94,12,C.muted);this.button(this.w-124,yy+61,96,q.claimed?'已领取':q.locked?'待解锁':q.ready?'领取奖励':'去完成',(q.ready?'questClaim:':'questGo:')+q.id,{disabled:q.claimed||q.locked,size:14});});
    if(perPage===2){this.button(22,this.h-127,95,'上一页','questPage:'+Math.max(0,page-1),{disabled:page===0,fill:C.mint,color:C.green});this.text((page+1)+' / 2',this.w/2,this.h-105,14,C.muted,600,'center');this.button(this.w-117,this.h-127,95,'下一页','questPage:'+Math.min(1,page+1),{disabled:page===1,fill:C.mint,color:C.green});}this.backButton();
  }
  machine(v,m){
    if(m.type==='blueprint'){
      const page=Math.max(0,Math.min(1,m.page||0)),perPage=3;
      CONFIG.machines.slice(page*perPage,(page+1)*perPage).forEach((n,i)=>{
        const index=page*perPage+i,y=87+i*115;
        this.box(16,y,this.w-32,105,index===v.state.machine?C.mint:'#f2f2e8');
        this.preview(73,y+57,89,index);this.text(n.name,128,y+24,16,C.ink,750);
        this.label(index<=v.state.machine?'已落成':num(n.cost)+' 金币',128,y+47,this.w-151,14,C.green);
        this.text(index===v.state.machine?'当前设备':index<v.state.machine?'已升级':n.requiredOrders+' 张主线订单',128,y+71,13,C.muted);
        const ability=index===2?'解锁生产档位':index===3?'批量升级 · 玉米Lv16余热':index===4?'连续生产的自动流水线':'';
        if(ability)this.label(ability,128,y+94,this.w-151,11,C.green);
      });
      this.button(22,this.h-122,112,page===0?'后 3 台 →':'← 前 3 台','blueprintPage:'+(1-page),{fill:C.mint,color:C.green});this.backButton();return;
    }
    const n=v.nextMachine,p=v.machinePreview;
    if(!n){this.text('六阶段设备已经全部落成',22,108,18,C.green,750);this.backButton();return;}
    this.preview(this.w*.27,151,112,v.state.machine);this.r.icon('arrow',this.w/2-10,135,20,C.green);this.preview(this.w*.73,151,122,v.state.machine+1);
    this.text(v.machine.name,this.w*.27,215,15,C.muted,600,'center');this.text(n.name,this.w*.73,215,16,C.green,750,'center');
    this.text('永久自动金币 / 秒',22,244,14,C.muted);this.label(rate(p.incomeBefore)+' → '+rate(p.incomeAfter),22,269,this.w-44,24,C.green,800);
    this.label('点击 '+rate(p.tapBefore)+' → '+rate(p.tapAfter)+' 份',22,293,this.w-44,14,C.ink);
    const ability=n.id===2?'新能力：自由切换生产档位':n.id===3?(v.state.upgrades.tap>=16?'新能力：批量升级＋余热接力':'批量升级；玉米Lv16解锁余热'):n.id===4?'连续生产，开动自动流水线':'';
    if(ability)this.label(ability,22,317,this.w-44,14,C.green,650);
    this.text(v.state.coins>=n.cost?'金币已备齐':'还差 '+num(Math.ceil(n.cost-v.state.coins))+' 金币',22,344,16,C.ink,650);this.text('主线订单 '+Math.min(v.state.orderIndex,n.requiredOrders)+' / '+n.requiredOrders,22,370,14,C.muted);
    const step=v.evolveReason==='not-enough-coins'?selectNextStep(v,null,{suppressModeAdvice:true}):null;
    if(step&&step.kind==='upgrade'&&step.enabled&&step.estimate){
      const y=this.h-176;this.box(22,y,this.w-44,44,C.green);
      this.label('查看提速升级',this.w/2,y+14,this.w-60,15,C.white,700,'center');
      this.label('按常驻收入估算，可更快攒齐',this.w/2,y+33,this.w-60,11,C.white,500,'center');
      this.r.hit(22,y,this.w-44,44,'fundingUpgrade:'+step.upgradeKey);
    }else if(step&&step.kind==='refinement')this.button(22,this.h-176,this.w-44,'查看提速工艺','refinements',{subLabel:'按常驻收入估算，可更快攒齐'});
    else this.button(22,this.h-176,this.w-44,v.canEvolve?'换代，开动新机器！':v.evolveReason==='orders-required'?'先完成所需订单':'金币不足，继续生产','evolve',{disabled:!v.canEvolve});
    this.adButton(v,'sponsor',this.h-120,'查看设备赞助','machine');this.backButton();
  }
  order(v){
    const o=v.order,d=v.deliveries;
    this.label(o.name,22,92,this.w-44,20,C.green,750);
    this.text(o.isLoop?'循环订单 '+(v.state.loopIndex+1):'订单 '+(v.state.orderIndex+1)+' / 20',22,117,13,C.muted);
    this.text(o.ready?'已达标':this.orderPercent(o)+'%',this.w-22,117,14,C.green,750,'right');
    this.progress(22,134,this.w-44,9,o.stageProgress);
    if(d&&d.unlocked){
      this.label('本单总奖 '+num(o.fullReward)+' · 已提前领 '+num(o.fullReward-o.reward),22,159,this.w-44,12,C.ink);
      this.label('累计 '+num(v.state.totalProduced)+' / '+num(o.target)+' 份',22,181,this.w-44,12,C.muted);
      d.stages.forEach((part,i)=>{
        const y=194+i*48;this.box(22,y,this.w-44,44,part.claimed?'#f0f2e8':C.mint);
        this.label(part.stage*25+'% · '+num(part.coins)+' 金币',34,y+13,this.w-158,13,C.green,650);
        this.label('累计 '+num(part.threshold)+' 份',34,y+32,this.w-158,11,C.muted);
        this.button(this.w-112,y,90,part.claimed?'已交付':part.ready?'交付领奖':'待生产','delivery:'+d.orderIndex+':'+part.stage,{disabled:part.claimed||!part.ready,size:13});
      });
    }else{
      this.label('累计 '+num(v.state.totalProduced)+' / '+num(o.target)+' 份',22,159,this.w-44,13,C.ink);
      this.box(22,186,this.w-44,80,C.mint);this.text('达标额外奖励',36,209,14,C.muted);this.text(num(o.reward)+' 金币',36,241,25,C.green,800);
      this.lines(o.ready?'奖励可直接领取；超出的产量接续下一单。':'生产即售卖，累计达标再领订单奖励。',22,293,this.w-44,14,C.muted,21);
    }
    this.button(22,this.h-172,this.w-44,(d&&d.unlocked?'结算剩余 · ':'直接领单 · ')+num(o.reward)+' 金币','claimOrder',{disabled:!o.ready});
    if(o.ready)this.adButton(v,'order',this.h-122,(d&&d.unlocked?'剩余加价后 ':'加价后共 ')+num(o.reward*3)+' 金币','order');this.backButton();
  }
  commissions(v,m){
    const jobs=v.commissions,active=jobs&&jobs.active;
    m.commissionQuotes={};
    if(!jobs||!jobs.unlocked&&!active){this.lines('完成第10张主线订单后，开放可选委托。',22,104,this.w-44,16,C.green,25);this.backButton();return;}
    if(active){
      this.label(active.title,22,94,this.w-44,19,C.green,750);
      this.label('完成奖励 '+num(active.reward)+' 金币',22,120,this.w-44,15,C.ink,650);
      this.progress(22,140,this.w-44,9,active.progress);
      const rows=active.kind==='bulk'?[['接单后新增生产',Math.min(active.production,active.productionTarget),active.productionTarget,'份']]:[['接单后完美爆锅',Math.min(active.perfect,active.perfectTarget),active.perfectTarget,'次'],...(active.recoveryTarget>0?[['本委托使用余热',Math.min(active.recovery,active.recoveryTarget),active.recoveryTarget,'次']]:[])];
      rows.forEach(([title,current,total,unit],i)=>{const y=165+i*64;this.box(22,y,this.w-44,57,C.mint);this.label(title,34,y+17,this.w-68,13,C.muted);this.label(num(current)+' / '+num(total)+' '+unit,34,y+40,this.w-68,17,C.green,700);});
      if(rows.length===1)this.label(active.kind==='bulk'?'赶单档提高产量；可按自己的节奏生产。':'92–98能量点火，再蓄满完成完美爆锅。',22,247,this.w-44,12,C.muted);
      this.button(22,this.h-218,this.w-44,active.ready?'领取委托 · '+num(active.reward)+' 金币':'完成目标后领取','commissionClaim:'+active.id,{disabled:!active.ready});
      const half=(this.w-50)/2;
      this.button(22,this.h-168,half,'回厂生产','close',{fill:C.mint,color:C.green,size:14});
      this.button(28+half,this.h-168,half,active.kind==='bulk'?'比较档位':'火候练习',active.kind==='bulk'?'productionModes':'heatLesson',{fill:C.mint,color:C.green,size:14});
      if(!active.ready)this.button(22,this.h-118,this.w-44,'放弃委托 · 不领奖','commissionCancel:'+active.id,{fill:'#edf0e5',color:C.muted,size:13});
    }else if(jobs.available){
      this.label('本单还可领取 '+jobs.remaining+' 次 · 二选一',22,91,this.w-44,14,C.green,700);
      this.label('额外奖励，主线订单照常推进。',22,114,this.w-44,13,C.muted);
      jobs.options.forEach((option,i)=>{
        m.commissionQuotes[option.kind]={...option};
        const y=132+i*146;this.box(16,y,this.w-32,138,C.mint);
        this.label(option.title,28,y+20,this.w-56,18,C.green,750);
        this.label(option.kind==='bulk'?'接单后新生产 '+num(option.productionTarget)+' 份':'接单后完成 '+option.perfectTarget+' 次完美爆锅',28,y+47,this.w-56,14,C.ink);
        this.label(option.kind==='bulk'?'赶单档多产量，适合批量生产':option.recoveryTarget>0?'再用掉 '+option.recoveryTarget+' 次余热点击':'92–98能量点火，蓄满后爆锅',28,y+69,this.w-56,12,C.muted);
        this.label('奖励 '+num(option.reward)+' 金币',28,y+107,this.w-174,13,C.green,700);
        this.button(this.w-134,y+85,106,'选择这单','commissionAccept:'+option.kind+':'+option.id,{size:14});
      });
    }else{
      this.text(v.state.orderIndex>=20?'主线委托已收工':'本单委托已全部领取',22,102,19,C.green,750);
      this.lines(v.state.orderIndex>=20?'继续完成循环订单，用金币收藏工厂纪念装饰。':'完成当前主线订单后，会开放下一组可选委托。',22,140,this.w-44,15,C.muted,25);
      if(v.souvenirs&&v.souvenirs.unlocked)this.button(22,232,this.w-44,'看看竣工收藏','souvenirs',{fill:C.yellow,color:C.green});
    }
    this.button(22,this.h-70,this.w-44,'返回订单','order',{fill:C.mint,color:C.green});
  }
  souvenirs(v,m){
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
      this.label(item.owned?'收藏会随存档保留':v.state.loopIndex<item.requiredLoops?'循环订单 '+v.state.loopIndex+' / '+item.requiredLoops:item.canBuy?'金币已备齐':'还差 '+num(Math.max(0,Math.ceil(item.cost-v.state.coins)))+' 金币',28,y+84,this.w-164,11,C.muted);
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
    if(order){
      const percent=(p,ready)=>ready?100:Math.min(99,Math.floor(p*100));
      this.text('领取后本单 '+percent(order.progressBefore,order.readyBefore)+'% → '+percent(order.progressAfter,order.readyAfter)+'%',22,219,15,C.ink,700);
      this.label(order.readyAfter?'本单达标，可领取订单奖励':'本单还差 '+num(Math.ceil(order.missingProduction))+' 份',22,242,this.w-44,13,C.green);
    }
    this.box(22,263,this.w-44,64,'#f0f2e8');
    this.label(summary.nextStep.title,34,282,this.w-68,14,C.green,700);
    this.label(summary.nextStep.detail,34,307,this.w-68,13,C.muted);
    this.lines(summary.ruleText,22,347,this.w-44,12,C.muted,17);
    this.button(22,this.h-179,this.w-44,'领取收益，开工！','claimOffline');
    this.adButton(v,'offline',this.h-123,'金币翻倍后共 '+num(o.coins*2),'offline');
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
  settings(v,ui){const rows=[['音效 · '+(v.state.settings.sound?'已开启':'已关闭'),'setting:sound'],['震动 · '+(v.state.settings.haptics?'已开启':'已关闭'),'setting:haptics'],['玩法说明','help'],['存档与隐私','privacy'],['健康游戏忠告','health']];if(ui.isDouyin&&ui.sidebar&&ui.sidebar.supported)rows.push(['侧边栏再来玩','sidebar']);rows.forEach(([s,a],i)=>this.button(22,83+i*55,this.w-44,s,a,{fill:C.mint,color:C.green}));this.backButton();}
}
module.exports={GameInterface};
