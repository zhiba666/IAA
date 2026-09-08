'use strict';
const { CONFIG, formatNumber: num } = require('./core');
const { ProductionScene } = require('./production-scene');
const { GameInterface } = require('./interface');
const C = { ink:'#283e32', muted:'#849084', paper:'#f8f6ed', white:'#fffdf7', green:'#366348', mint:'#deebd5', yellow:'#f4ca58', orange:'#e09a55', line:'#e1e4d7', purple:'#ddd4ef' };
const FONT = '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
const rate = n => n>0&&n<10?Number(n.toFixed(2)).toString():num(n);
// Full standard text required before gameplay; not an age-rating or identity system.
const HEALTH_ADVISORY = ['抵制不良游戏，拒绝盗版游戏。','注意自我保护，谨防受骗上当。','适度游戏益脑，沉迷游戏伤身。','合理安排时间，享受健康生活。'];
class Renderer {
  constructor(ctx) { this.c=ctx; this.zones=[]; this.t=0; this.particles=[]; this.floats=[]; this.flash=0; this.truck=0; this.tapPulse=0; this.notice=null; this.guideAction=''; this.scene=new ProductionScene(ctx);this.interface=new GameInterface(this);this.viewport=null; }
  box(x,y,w,h,r=14,fill=C.white,stroke) { const c=this.c; c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath(); if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();} }
  text(s,x,y,size=14,color=C.ink,weight=400,align='left') { const c=this.c;c.font=`${weight} ${size}px ${FONT}`;c.fillStyle=color;c.textAlign=align;c.textBaseline='middle';c.fillText(String(s),x,y); }
  fitText(s,x,y,width,size=14,color=C.ink,weight=400,align='left') { this.c.font=`${weight} ${size}px ${FONT}`;const measured=this.c.measureText(String(s)).width;this.text(s,x,y,measured>width?size*width/measured:size,color,weight,align); }
  wrap(s,x,y,width,size=14,color=C.muted,line=24) { const c=this.c;c.font=`400 ${size}px ${FONT}`;let str='',n=0;for(const char of String(s)){if(char==='\n'||c.measureText(str+char).width>width){this.text(str,x,y+n*line,size,color);str=char==='\n'?'':char;n++;}else str+=char;}if(str)this.text(str,x,y+n*line,size,color);return(n+1)*line; }
  circle(x,y,r,fill,stroke){const c=this.c;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.stroke();}}
  line(x,y,xx,yy,color=C.ink,width=2){const c=this.c;c.beginPath();c.moveTo(x,y);c.lineTo(xx,yy);c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.stroke();}
  hit(x,y,w,h,action) { this.zones.push({x,y,w,h,action}); }
  button(x,y,w,h,label,action,opts={}) { const fill=opts.disabled?'#e6e8de':opts.fill||C.green;this.box(x,y,w,h,opts.radius||14,fill,opts.stroke);if(!opts.disabled&&action===this.guideAction){this.c.save();this.c.lineWidth=2;this.box(x-3,y-3,w+6,h+6,(opts.radius||14)+2,null,C.orange);this.c.restore();}this.fitText(label,x+w/2,y+h/2,w-14,opts.size||15,opts.disabled?C.muted:opts.color||C.white,opts.weight||650,'center');if(!opts.disabled)this.hit(x,y,w,h,action); }
  rewardStatus(v,kind) { const offer=v.rewards[kind];if(offer.available)return '';if(offer.reason==='intro-first')return `营业 ${Math.ceil(Math.max(0,CONFIG.rewardUnlockSeconds-v.state.playedSeconds))} 秒后开放`;return ({'brand-machine-required':'电热锅解锁后开放','brand-stage-cap':'换代后解锁更多等级','brand-max-level':'合作已满级','orders-required':'先完成所需订单','already-affordable':'金币已足够换代','production-required':'先提升自动收益','order-not-ready':'订单完成后开放','no-offline-reward':'暂无离线收益'})[offer.reason]||'暂不可用'; }
  icon(type,x,y,s=22,color=C.ink) { const c=this.c;c.save();c.translate(x,y);c.scale(s/24,s/24);c.strokeStyle=color;c.fillStyle=color;c.lineWidth=1.8;c.lineCap='round';c.lineJoin='round';
    if(type==='coin'){this.circle(12,12,9,'#f8d56e','#d7a642');this.text('•',12,11,20,'#b78723',700,'center');}
    else if(type==='bolt'){c.beginPath();c.moveTo(14,1);c.lineTo(5,14);c.lineTo(11,14);c.lineTo(9,23);c.lineTo(20,9);c.lineTo(13,9);c.closePath();c.fill();}
    else if(type==='arrow'){this.line(5,12,19,12,color,2);this.line(14,6,20,12,color,2);this.line(14,18,20,12,color,2);}
    else if(type==='play'){c.beginPath();c.moveTo(8,5);c.lineTo(19,12);c.lineTo(8,19);c.closePath();c.fill();}
    else if(type==='gear'){for(let i=0;i<8;i++){c.save();c.translate(12,12);c.rotate(i*Math.PI/4);c.fillRect(-2,-12,4,5);c.restore();}this.circle(12,12,8,color);this.circle(12,12,3,C.paper);}
    else if(type==='factory'){this.box(2,11,20,11,2,null,color);this.line(3,11,9,6,color);this.line(9,6,9,11,color);this.line(9,11,16,6,color);this.line(16,6,16,11,color);c.fillRect(18,2,3,9);for(let i=0;i<3;i++)c.fillRect(6+i*5,15,2,3);}
    else if(type==='chart'){this.line(3,2,3,22,color);this.line(3,22,23,22,color);c.fillRect(7,12,3,7);c.fillRect(13,8,3,11);c.fillRect(19,3,3,16);}
    else if(type==='hand'){this.circle(12,15,7,color);this.box(9,2,5,14,2,color);this.box(5,10,5,9,2,color);}
    else if(type==='check'){this.line(4,12,9,17,color,3);this.line(9,17,20,5,color,3);}
    else if(type==='close'){this.line(6,6,18,18,color);this.line(18,6,6,18,color);}
    else {this.circle(12,12,8,color);}
    c.restore();
  }
  popcorn(x,y,r=5,angle=0) { const c=this.c;c.save();c.translate(x,y);c.rotate(angle);this.circle(-r*.5,0,r*.66,'#fff8d5');this.circle(r*.4,-r*.35,r*.7,'#fffce9');this.circle(r*.45,r*.5,r*.65,'#ffeab0');this.circle(-r*.4,r*.55,r*.58,'#fff5c8');this.circle(-r*.05,r*.1,r*.36,'#f0c867');c.restore(); }
  emit(event) {
    if(this.viewport)this.scene.emit(event,this.lastView);
    if(event.type==='produce'||event.type==='burst') {
      const burst=event.type==='burst',count=this.viewport?0:burst?65:event.source==='tap'?5:Math.min(5,Math.ceil(event.amount/10));
      for(let i=0;i<count&&this.particles.length<180;i++)this.particles.push({x:240+(Math.random()-.5)*74,y:390,vx:(Math.random()-.5)*(burst?300:90),vy:-40-Math.random()*(burst?300:110),life:1.5+Math.random(),r:4+Math.random()*5,a:Math.random()*6});
      if(event.source==='tap'){
        this.tapPulse=1;
        // Combine very rapid taps into one readable amount; each tap still animates the machine.
        const recent=this.floats.find(f=>f.kind==='tap'&&f.life>.55);
        if(recent){recent.amount+=event.amount;recent.text=`连点 +${rate(recent.amount)} 份`;recent.life=.8;}
        else this.floats.push({kind:'tap',amount:event.amount,text:`+${rate(event.amount)} 份`,x:240,y:414,life:.8});
      }
      if(burst){this.flash=1;this.notice={title:`${event.perfect?'完美爆锅':'免费爆锅'} +${rate(event.amount)} 份`,text:`自动售出 +${rate(event.coins)} 金币${event.perfect?' · 含20%加成':''}`,life:2.4,perfect:!!event.perfect,bonusText:event.perfect?'火候额外 +'+rate(event.bonusAmount||0)+' 份':''};}
    }
    if(event.type==='order'){this.truck=1;this.floats.push({text:'订单发车！',x:240,y:420,life:1.7});}
    if(event.type==='quest')this.floats.push({text:`任务奖励 +${num(event.coins)} 金币`,x:240,y:453,life:1.7});
    if(event.type==='evolve'){this.flash=1;for(let i=0;i<(this.viewport?0:55)&&this.particles.length<180;i++)this.particles.push({x:50+Math.random()*380,y:260,vx:(Math.random()-.5)*130,vy:-80-Math.random()*140,life:2+Math.random(),r:5,a:0});}
    if(this.floats.length>8)this.floats.splice(0,this.floats.length-8);
  }
  update(dt,noticeVisible=true) {this.t+=dt;this.flash=Math.max(0,this.flash-dt*1.5);this.tapPulse=Math.max(0,this.tapPulse-dt*6);this.truck=Math.max(0,this.truck-dt*.45);if(this.notice&&noticeVisible){this.notice.life-=dt;if(this.notice.life<=0)this.notice=null;}for(const p of this.particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=370*dt;p.life-=dt;p.a+=dt*2;}this.particles=this.particles.filter(p=>p.life>0&&p.y<545);for(const f of this.floats){f.y-=35*dt;f.life-=dt;}this.floats=this.floats.filter(p=>p.life>0);}
  draw(view,ui,dt) {
    this.lastView=view;
    const noticeVisible=!ui.toast&&!ui.modal&&!ui.startup&&!ui.adBusy;
    if(ui.viewport){this.viewport=ui.viewport;this.update(dt,noticeVisible);this.interface.draw(view,ui,dt);return;}
    this.update(dt,noticeVisible);this.zones=[];const c=this.c;c.clearRect(0,0,480,920);this.box(0,0,480,920,0,C.paper);
    if(ui.startup){this.welcome(ui);return;}
    const tracked=view.quests&&ui.questGuideId?view.quests.chapters.flatMap(chapter=>chapter.quests).find(quest=>quest.id===ui.questGuideId&&!quest.claimed&&!quest.locked&&!quest.ready):null;
    const guide=tracked||view.tutorial||view.goal;this.guideAction=guide?guide.action:'';
    // Top bar / account
    this.text('POPCORN WORKS',24,29,10,C.green,750);this.text('小小爆米花厂',24,60,26,C.ink,800);
    if(ui.isDouyin&&ui.sidebar&&ui.sidebar.supported){
      this.box(287,18,120,27,13,C.mint);this.text('侧边栏再来玩',347,31,12,C.green,650,'center');this.hit(282,12,130,46,'sidebar');
    }else{this.box(287,18,120,27,13,ui.isDouyin?C.mint:C.purple);this.circle(300,31,3,ui.isDouyin?C.green:'#9380ae');this.text(ui.isDouyin?'工厂营业中':'试玩 · 激励模拟',311,31,11,C.ink,600);}
    const gearY=ui.isDouyin?41:21; // Keep the native menu capsule clear of the settings button center.
    this.box(421,gearY,36,36,12,'#ebece1');this.icon('gear',430,gearY+9,18);this.hit(416,gearY-5,46,46,'settings');
    this.box(24,88,432,69,18,C.white,C.line);this.icon('coin',40,101,28);this.text('可用金币',78,107,11,C.muted);this.text(num(view.state.coins),78,132,27,C.ink,800);
    this.line(240,105,240,141,C.line,1);this.text('自动收益 / 秒',262,107,11,C.muted);this.text(`+${rate(view.production.auto*view.production.price)}`,262,132,23,C.green,750);
    this.text('01  /  今日生产',24,181,12,C.ink,700);this.text(`累计 ${num(view.state.totalProduced)} 份`,456,181,12,C.muted,400,'right');
    this.order(view);
    this.factory(view,ui);
    this.bottom(view,ui);
    if(view.offline&&view.offline.coins>0){this.text('离线收益待领取 →',26,905,11,C.green,650);this.hit(24,893,170,26,'offline');}else this.text(ui.saved?'已自动保存':'本地存档',26,905,10,C.muted);this.text('点击生产  /  放置也有收获',454,905,10,C.muted,400,'right');
    if(ui.modal)this.modal(view,ui);
    if(ui.toast){const y=ui.modal?(ui.modal.type==='quests'?842:ui.modal.type==='brand'?766:174):494;this.box(36,y,408,44,13,'#2d4535');this.fitText(ui.toast,240,y+22,382,13,C.white,600,'center');}
  }
  welcome(ui) {
    this.box(24,28,432,864,28,C.mint);
    this.text('POPCORN WORKS',240,83,12,C.green,750,'center');
    this.text('小小爆米花厂',240,129,34,C.ink,800,'center');
    this.text('从一口小锅，开始今天的收获',240,172,15,C.green,500,'center');
    this.circle(240,263,58,'#edf1dd');
    this.popcorn(240,253,29,-.1);this.popcorn(181,280,10,.3);this.popcorn(299,229,12,-.4);
    this.box(44,349,392,302,23,C.white);
    this.text('健康游戏忠告',240,394,27,C.ink,750,'center');
    HEALTH_ADVISORY.forEach((line,i)=>this.text(line,240,453+i*42,20,C.ink,500,'center'));
    let y=677;
    for(const line of ui.publication||[]){y+=this.wrap(line,54,y,372,12,C.green,17)+3;}
    this.button(64,786,352,57,'开始经营','start',{size:20});
    this.text('小小爆米花厂 · 1.0.0',240,863,12,C.green,500,'center');
  }
  order(v) {const o=v.order;this.box(24,198,432,82,18,'#e9eddf');this.box(37,213,45,45,12,C.white);this.icon(o.ready?'check':'factory',48,224,23,C.green);this.text(o.isLoop?`循环订单 ${v.state.loopIndex+1}`:`订单 ${String(v.state.orderIndex+1).padStart(2,'0')} / 20`,94,217,10,C.muted,650);this.text(o.name,94,237,15,C.ink,750);
    this.box(94,254,228,5,2,'#d5ddca');this.box(94,254,Math.max(5,228*Math.min(1,o.progress)),5,2,C.green);this.text(o.ready?'可以发车':`${num(v.state.totalProduced)} / ${num(o.target)}`,439,265,10,C.muted,500,'right');this.button(340,211,102,40,o.ready?'装车结算':'查看订单','order',{fill:o.ready?C.green:C.white,color:o.ready?C.white:C.ink,size:13}); }
  factory(v,ui) {
    const c=this.c;this.box(24,293,432,285,22,'#e1ebd8');c.save();this.box(24,293,432,285,22,null);c.clip();
    for(let x=40;x<470;x+=36){this.line(x,305,x,568,'#d4e0cb',.6);}for(let y=308;y<580;y+=36)this.line(28,y,452,y,'#d4e0cb',.6);
    this.circle(374,334,70,'#e9f0e3');this.circle(386,326,48,'#f1f4e9');this.line(31,520,450,520,'#bacdb1',2);
    this.box(42,309,127,26,13,'#f5f6e8');this.circle(55,322,3,C.green);this.text(v.machine.name,66,322,11,C.ink,650);
    if(v.boostSeconds>0){this.box(312,309,128,26,13,C.yellow);this.icon('bolt',321,314,15,C.ink);this.text(`3 倍增压 ${Math.ceil(v.boostSeconds)}s`,342,322,11,C.ink,600);}else this.text(`STAGE 0${v.state.machine+1}`,434,322,10,'#82917b',650,'right');
    // wall shelves and corn sacks
    this.line(44,416,102,416,'#b6c4a9',5);for(let i=0;i<3;i++){this.box(49+i*17,383,12,31,3,i%2?'#e8b74e':'#b9cb9e');this.line(52+i*17,390,58+i*17,390,'#f9efc8',2);}
    this.box(364,470,45,48,7,'#d9c793');this.line(370,479,403,479,'#b09c64',2);this.text('CORN',386,497,9,'#8e7c4d',700,'center');this.box(408,484,33,34,6,'#e6d7ac');
    c.save();c.translate(240,421+this.tapPulse*3);c.scale(1+this.tapPulse*.025,1-this.tapPulse*.025);this.drawMachine(v.state.machine,v.production.auto>0||this.particles.length>0);c.restore();
    // striped popcorn bucket
    c.save();c.translate(242,504);c.beginPath();c.moveTo(-49,-29);c.lineTo(49,-29);c.lineTo(37,31);c.lineTo(-37,31);c.closePath();c.fillStyle='#fff9e8';c.fill();c.save();c.clip();for(let i=-40;i<50;i+=23){c.save();c.rotate(.06);c.fillStyle='#d89465';c.fillRect(i,-30,12,64);c.restore();}c.restore();this.box(-51,-32,102,8,4,'#fffbee');
    const pile=13+Math.min(40,Math.floor(v.state.machine*6+v.energy/7));for(let i=0;i<pile;i++){const x=Math.sin(i*31.2)*39,y=-29-Math.abs(Math.cos(i*11.8))*16-(i%5);this.popcorn(x,y,5.5,i);}this.box(-20,-6,40,22,9,'#fff9e7');this.text('POP!',0,5,12,C.ink,900,'center');c.restore();
    for(const p of this.particles){c.globalAlpha=Math.min(1,p.life*2);this.popcorn(p.x,p.y,p.r,p.a);}c.globalAlpha=1;
    if(this.truck>0){const x=480-(1-this.truck)*750;this.box(x,474,110,54,8,'#f7c85d');this.box(x+103,489,45,39,6,'#658769');this.box(x+111,494,24,15,3,'#dfeadb');this.circle(x+26,532,11,C.ink);this.circle(x+123,532,11,C.ink);this.circle(x+26,532,5,C.white);this.circle(x+123,532,5,C.white);this.text('POPCORN',x+55,502,11,C.ink,750,'center');}
    for(const f of this.floats){c.globalAlpha=Math.min(1,f.life*2);this.text(f.text,f.x,f.y,21,C.green,800,'center');}c.globalAlpha=1;
    if(this.flash>0){c.globalAlpha=this.flash*.4;c.fillStyle='#fff7cb';c.fillRect(24,293,432,285);c.globalAlpha=1;}c.restore();
    if(this.notice){this.box(84,343,312,52,13,'#fff8dd',C.yellow);this.fitText(this.notice.title,240,360,288,16,C.green,800,'center');this.fitText(this.notice.text,240,382,288,13,C.ink,600,'center');}
    this.hit(24,340,432,203,'tap');
    this.box(44,548,392,19,9,'#cbd9c2');this.box(44,548,Math.max(18,392*v.energy/100),19,9,C.yellow);this.text(v.energy>80?'快要爆锅了！继续点击':'免费爆锅能量',57,558,10,C.ink,650);this.text(`${Math.floor(v.energy)} / 100`,422,558,10,C.ink,650,'right');
    this.button(24,590,283,55,'点一下，爆米花！','tap',{fill:C.green,size:18});this.icon('hand',45,605,24,C.white);this.text(`+${rate(v.production.tap)} 份`,280,631,10,'#bed5bd',500,'right');
    const turbo=v.rewards.turbo;this.button(317,590,139,55,turbo.available?(v.boostSeconds>0?'续时增压':'涡轮增压'):this.rewardStatus(v,'turbo'),'ad:turbo',{fill:C.yellow,color:C.ink,size:14,disabled:!turbo.available});this.text('广告 · 3 倍 / 90 秒',387,633,10,turbo.available?'#755b23':C.muted,500,'center');
    const guide=v.tutorial||v.goal;
    if(guide){const width=v.quests?270:400;this.box(24,651,v.quests?292:432,46,12,v.canEvolve?C.mint:'#eeeede');this.fitText(guide.title,40,665,width-20,13,C.green,750);this.fitText(guide.text,40,685,width,12,C.ink);if(guide.action&&guide.action!=='tap'){const action=guide.action.startsWith('upgrade:')?'tab:upgrades':guide.action;this.hit(24,651,v.quests?284:432,46,action);this.icon('arrow',v.quests?290:428,657,16,C.green);}}
    if(v.quests)this.questEntry(v.quests);
  }
  questEntry(quests) {
    const ready=quests.readyCount>0,focus=quests.focus;
    this.box(322,651,134,46,12,ready?C.green:C.mint,ready?undefined:'#c3d5ba');
    this.text(ready?`成长任务 · ${quests.readyCount} 可领`:'成长任务',389,665,13,ready?C.white:C.green,750,'center');
    const detail=quests.complete?'全部完成 ✓':ready?'点击领取金币':focus?`${focus.title} ${num(Math.min(focus.current,focus.target))}/${num(focus.target)}`:`已领 ${quests.claimedCount}/${quests.total}`;
    this.fitText(detail,389,684,119,11,ready?'#d7e8ce':C.green,500,'center');
    this.hit(322,651,134,46,'quests');
  }
  drawMachine(stage,active) {
    const c=this.c,bob=active?Math.sin(this.t*12)*1.1:0;c.translate(0,bob);if(stage===5)c.scale(.73,.73);
    const colors=['#d2a567','#85a898','#b398bf','#7e9bad','#d1956d','#cead4b'];const color=colors[stage];
    this.box(-98,31,196,17,6,'#a4b69a');this.box(-83,48,13,37,3,'#8c9f85');this.box(70,48,13,37,3,'#8c9f85');
    if(stage===0){this.box(-74,-25,148,58,15,color);this.box(-61,-16,122,28,8,'#f5dfb1');this.box(-80,-34,160,13,6,'#8c7753');this.box(-33,-43,66,9,4,'#bd9b5b');this.line(77,-9,106,-9,'#78674c',5);this.line(106,-9,106,-29,'#78674c',5);this.box(98,-37,18,14,6,'#4c6b50');this.box(-19,17,38,15,5,'#6e7e61');}
    else if(stage===1){this.box(-73,-61,146,93,18,color);this.box(-59,-47,118,51,10,'#d8e8ce');this.box(-49,-37,98,33,6,'#f5e5ab');this.box(-82,-69,164,14,6,'#567465');this.circle(43,18,7,'#f9d36a');this.box(-54,13,61,10,4,'#527161');this.box(-22,30,44,13,4,'#567465');}
    else if(stage===2){this.box(-98,-28,196,61,12,color);for(const x of [-49,49]){this.box(x-35,-74,70,68,12,'#ede5ee');this.box(x-41,-83,82,14,5,'#877192');this.box(x-27,-61,54,38,8,'#f4dfa5');this.circle(x,15,9,'#6f647e');this.circle(x,15,4,C.yellow);}this.box(-18,30,36,17,4,'#877192');}
    else if(stage===3){this.box(-103,-66,206,99,13,color);this.box(-112,-76,224,14,5,'#547183');for(const x of [-83,-50,-17,16,49,82]){this.box(x-13,-53,26,54,6,'#dfe9e8');this.box(x-9,-47,18,36,4,'#f4dfad');this.box(x-5,3,10,19,3,'#4f6c7d');}this.box(-86,26,172,12,5,'#536e7a');}
    else if(stage===4){this.box(-124,-55,95,86,10,color);this.box(-113,-43,73,40,6,'#f1ddb3');this.box(-132,-66,111,15,6,'#997057');this.box(-19,-84,111,80,12,'#e7c9a0');this.box(-29,-92,131,14,5,'#a47859');this.box(-3,-70,80,40,6,'#fff0c8');this.box(-125,17,257,22,9,'#61785e');for(let i=0;i<12;i++){const x=-115+i*21+(this.t*28%21);this.line(x,22,x-8,34,'#a8bba0',2);}this.box(30,-4,24,32,4,'#b38c68');}
    else {this.box(-91,-36,182,67,15,'#c7ad58');this.box(-62,-85,124,53,13,'#e8cd71');this.box(-40,-133,80,52,12,'#f3d889');this.box(-99,-45,198,13,5,'#9b8849');this.box(-70,-94,140,13,5,'#a78c47');this.box(-46,-141,92,12,5,'#b69a4f');for(let i=0;i<3;i++){this.box(-68+i*53,-23,30,37,7,'#f7ecbd');this.circle(-53+i*53,-4,6,'#b39643');}this.box(-27,-70,54,25,7,'#fff0c6');this.circle(0,-111,12,'#fff7d7');this.text('★',0,-111,16,'#b68c2d',700,'center');this.line(0,-144,0,-168,'#9d8649',3);this.box(1,-166,31,16,2,'#d88964');}
    const kernels=stage===0?9:12+stage*3;for(let i=0;i<kernels;i++){const x=Math.sin(i*3.4+this.t*(active?2:0))*48;this.popcorn(x,-29-Math.abs(Math.cos(i*5.8+this.t))*9,4,i);}
    if(active){for(let i=0;i<3;i++){c.globalAlpha=.22;this.circle(-25+i*24,-103-(this.t*16+i*18)%45,7+(this.t*3+i)%8,'#ffffff');}c.globalAlpha=1;}
  }
  bottom(v,ui) {
    const tabs=[['upgrades','bolt','设备升级'],['machines','factory','工厂蓝图'],['stats','chart','经营记录'],['brand','coin','品牌合作']];
    tabs.forEach(([id,icon,label],i)=>{const x=24+i*109,selected=ui.tab===id,highlight=(id==='upgrades'&&this.guideAction.startsWith('upgrade:'))||(id==='machines'&&v.canEvolve);this.box(x,704,104,37,12,selected?C.mint:'#eeeee5',highlight?C.orange:undefined);this.icon(icon,x+9,714,17,selected?C.green:C.muted);this.text(label,x+33,723,12,selected?C.green:C.muted,650);this.hit(x,704,104,37,'tab:'+id);});
    if(ui.tab==='upgrades'){
      v.upgrades.forEach((u,i)=>{const y=750+i*50;this.box(24,y,432,46,12,C.white,C.line);this.box(34,y+7,32,32,9,[C.mint,C.purple,'#f7e7b1'][i]);this.icon(['hand','bolt','coin'][i],41,y+14,18);this.text(`${u.name} · Lv.${u.level}`,77,y+13,13,C.ink,700);
        const preview=u.preview?`${u.key==='auto'?'永久 ':''}${rate(u.preview.before)} → ${rate(u.preview.after)} ${u.preview.unit}`:'永久提升已满级';this.fitText(preview,77,y+33,236,12,C.green);
        this.button(325,y+3,122,40,u.level>=u.maxLevel?'已满级':num(u.cost)+'  升级','upgrade:'+u.key,{disabled:!u.canBuy,fill:C.green,size:13});
      });
    }else if(ui.tab==='machines'){
      const next=v.nextMachine,p=v.machinePreview;this.box(24,750,432,146,16,C.white,C.line);this.text(next?'下一台设备':'六阶工厂 · 已全部落成',42,767,12,C.muted);this.text(next?next.name:'巨型爆米花塔',42,792,22,C.ink,800);
      if(next){this.button(324,762,115,42,v.canEvolve?'立即换代':'查看换代','machine',{fill:v.canEvolve?C.green:C.yellow,color:v.canEvolve?C.white:C.ink,size:13});this.fitText(`永久自动 ${rate(p.incomeBefore)} → ${rate(p.incomeAfter)} 金币/秒`,42,817,394,12,C.green);this.fitText(`订单 ${Math.min(v.state.orderIndex,next.requiredOrders)}/${next.requiredOrders} · ${v.state.coins>=next.cost?'金币已备齐':'还差 '+num(Math.ceil(next.cost-v.state.coins))+' 金币'}`,42,839,394,12,C.ink);
      }else{this.fitText('继续完成循环订单，刷新生产纪录。',42,828,394,13,C.green);this.button(324,766,115,42,'竣工纪念','completion',{fill:C.yellow,color:C.ink,size:13});}
      this.button(42,858,394,30,'查看全部 6 个阶段  →','blueprint',{fill:C.white,color:C.green,size:12});
    }else if(ui.tab==='brand'){
      const b=v.brand,offer=v.rewards.brand;this.box(24,750,432,146,16,C.white,C.line);
      this.fitText(`Lv.${b.level}/${b.maxLevel} · 永久产量 +${b.bonusPercent}%`,42,772,276,17,C.green,750);
      this.button(335,759,104,34,'合作详情 →','brand',{fill:C.mint,color:C.green,size:12});
      this.fitText(b.maxed?`永久自动收益 ${rate(b.baseIncomeBefore)} 金币/秒`:`下一级：永久自动 ${rate(b.baseIncomeBefore)} → ${rate(b.baseIncomeAfter)} 金币/秒`,42,803,396,13,C.ink,650);
      this.text('完整观看 1 次广告 · 每级 +20% 基础产量',42,825,12,C.muted);
      this.button(42,846,396,38,offer.available?`广告 · 永久升至 Lv.${b.level+1}`:`广告 · ${this.rewardStatus(v,'brand')}`,'ad:brand',{fill:C.yellow,color:C.ink,size:13,disabled:!offer.available});
    }else {this.box(24,750,432,146,16,C.white,C.line);const stats=[['总生产',num(v.state.totalProduced)+' 份'],['完成订单',String(v.state.orderIndex+v.state.loopIndex)+' 单'],['免费爆锅',String(v.state.bursts)+' 次'],['累计营业',num(v.state.totalCoins)+' 金币']];stats.forEach(([label,value],i)=>{const x=44+(i%2)*217,y=772+Math.floor(i/2)*64;this.text(label,x,y,11,C.muted);this.fitText(value,x,y+26,195,19,C.ink,750);});}
  }
  modal(v,ui) {
    const m=ui.modal,c=this.c;this.zones=[];c.fillStyle='rgba(31,48,36,.45)';c.fillRect(0,0,480,920);const quests=m.type==='quests',tall=m.type==='blueprint',settings=m.type==='settings',brand=m.type==='brand',y=quests?85:tall?133:settings||brand?176:239,h=quests?750:tall?666:settings||brand?568:446;this.box(24,y,432,h,24,C.white);this.box(423,y+14,22,22,8,'#efeee4');this.icon('close',423,y+14,22,C.muted);if(!ui.adBusy)this.hit(410,y+5,42,42,'close');
    const title=(s,sub)=>{this.text(s,48,y+44,24,C.ink,800);if(sub)this.wrap(sub,48,y+82,378,13,C.muted,22);};
    if(m.type==='quests')this.questModal(v.quests,m,y);
    else if(m.type==='order'){
      const o=v.order,offer=v.rewards.order;title(o.ready?'这一车，满载而归':o.name,o.ready?'爆米花已装好，直接装车即可领取金币。':'持续生产即可完成订单，生产出的爆米花会自动出售。');this.box(48,y+130,384,103,16,'#f2eedb');this.text(o.name,68,y+155,14,C.ink,650);this.fitText(`基础奖励  ${num(o.reward)} 金币`,68,y+190,344,23,C.ink,750);this.text(`${num(v.state.totalProduced)} / ${num(o.target)} 份`,68,y+217,11,C.muted);
      if(o.ready){this.button(48,y+255,384,53,`直接装车 · ${num(o.reward)} 金币`,'claimOrder',{fill:C.green});this.button(48,y+321,384,49,offer.available?`广告加价 · 共 ${num(o.reward*3)} 金币`:`广告加价 · ${this.rewardStatus(v,'order')}`,'ad:order',{fill:C.yellow,color:C.ink,disabled:!offer.available});this.text('广告未完成时，仍可直接领取基础奖励',240,y+397,11,C.muted,400,'center');}else{this.button(48,y+310,384,50,'回到工厂，继续生产','close');this.text(`进度 ${Math.min(100,o.progress*100).toFixed(0)}%`,240,y+270,20,C.green,700,'center');}
    }else if(m.type==='machine'){
      const n=v.nextMachine,p=v.machinePreview,offer=v.rewards.sponsor;if(!n){title('全阶段设备已落成','继续生产，刷新你的工厂纪录。');this.button(48,y+315,384,50,'回到工厂','close');return;}
      title(n.name,n.description);this.box(48,y+130,384,140,16,C.mint);this.text(`${num(n.cost)} 金币`,68,y+153,23,C.ink,750);this.text(`主线订单 ${Math.min(v.state.orderIndex,n.requiredOrders)} / ${n.requiredOrders}`,68,y+179,13,C.green);this.fitText(`永久自动 ${rate(p.incomeBefore)} → ${rate(p.incomeAfter)} 金币/秒`,68,y+207,344,14,C.green,650);this.fitText(`点击产量 ${rate(p.tapBefore)} → ${rate(p.tapAfter)} 份/次`,68,y+229,344,13,C.ink);this.fitText(`${v.state.coins>=n.cost?'金币已备齐':'还差 '+num(Math.ceil(n.cost-v.state.coins))+' 金币'} · ${v.state.orderIndex>=n.requiredOrders?'订单已达标':'还差 '+(n.requiredOrders-v.state.orderIndex)+' 单'}`,68,y+253,344,12,C.muted);
      this.button(48,y+284,384,48,v.canEvolve?'换代，开动新机器！':(v.evolveReason==='orders-required'?'先完成所需订单':'金币不足，继续生产'),'evolve',{disabled:!v.canEvolve});this.button(48,y+347,384,43,offer.available?'广告 · 获取设备赞助':`广告赞助 · ${this.rewardStatus(v,'sponsor')}`,'ad:sponsor',{fill:C.yellow,color:C.ink,disabled:!offer.available});this.text('永久升级保留，产量与售价随设备一起成长',240,y+418,11,C.muted,400,'center');
    }else if(m.type==='offline'){
      const o=v.offline,offer=v.rewards.offline;title('欢迎回来，小厂长',o?'你离开的时间里，工厂也在认真营业。':'离线收益已经领取。');if(o){this.box(48,y+131,384,98,16,C.mint);this.text(`离线营业 ${this.duration(o.seconds)}`,68,y+157,13,C.green);this.text(`+${num(o.coins)} 金币`,68,y+195,29,C.ink,800);this.button(48,y+253,384,53,'领取收益，开工！','claimOffline');this.button(48,y+319,384,50,offer.available?`广告翻倍 · 共 ${num(o.coins*2)} 金币`:`广告翻倍 · ${this.rewardStatus(v,'offline')}`,'ad:offline',{fill:C.yellow,color:C.ink,disabled:!offer.available});this.text('最多结算 8 小时，按永久自动产能的 50% 计算',240,y+400,11,C.muted,400,'center');}
    }
    else if(m.type==='brand'){
      const b=v.brand,offer=v.rewards.brand;title('品牌合作',`当前 Lv.${b.level}/${b.maxLevel} · 永久产量 +${b.bonusPercent}%`);
      this.box(48,y+126,384,126,16,'#f4e9c5');
      this.text(b.maxed?'合作已满级，持续享受永久加成':`完整看 1 次广告：Lv.${b.level} → Lv.${b.level+1}`,68,y+151,14,C.ink,700);
      this.fitText(b.maxed?`永久产量 +${b.bonusPercent}%`:`永久产量 +${b.bonusPercent}% → +${b.nextBonusPercent}%`,68,y+181,344,22,C.green,750);
      this.fitText(b.maxed?`点击产量 ${rate(b.tapBefore)} 份/次`:`点击产量 ${rate(b.tapBefore)} → ${rate(b.tapAfter)} 份/次`,68,y+210,344,13,C.ink);
      this.fitText(b.maxed?`永久自动 ${rate(b.baseIncomeBefore)} 金币/秒`:`永久自动 ${rate(b.baseIncomeBefore)} → ${rate(b.baseIncomeAfter)} 金币/秒`,68,y+233,344,13,C.ink);
      this.wrap('点击、自动、免费爆锅和后续离线产量一起提升。\n订单积累更快；订单和任务金币奖励不额外翻倍。',48,y+276,384,13,C.ink,22);
      this.fitText('换代、关闭和重启游戏后保留于本地存档。',48,y+328,384,13,C.green,650);
      this.fitText(b.maxed?'已达到全部合作等级':!b.unlocked?'换代至电热锅开放 Lv.1–2，后续每次换代再开放 2 级':b.stageCapped?`本阶段已完成 Lv.${b.unlockedLevelCap}，换代后再开放 2 级`:`本阶段开放至 Lv.${b.unlockedLevelCap} · 满级 +200% 基础产量`,48,y+352,384,12,C.muted);
      this.button(48,y+376,384,49,offer.available?`广告 · 永久升至 Lv.${b.level+1}`:`广告 · ${this.rewardStatus(v,'brand')}`,'ad:brand',{fill:C.yellow,color:C.ink,disabled:!offer.available});
      this.button(48,y+438,384,43,'继续经营','close',{fill:C.mint,color:C.green});
      this.text('每次完整观看升 1 级 · 未完成不升级',240,y+518,12,C.muted,400,'center');
    }
    else if(m.type==='reward'){
      const q=m.quote,isBrand=q.kind==='brand';title(isBrand?'永久产量升级':'本次激励奖励',q.title);this.box(48,y+126,384,99,16,'#f4e9c5');
      if(isBrand){
        const before=q.bonusBefore!=null?q.bonusBefore:v.brand.bonusPercent,after=q.bonusAfter!=null?q.bonusAfter:v.brand.nextBonusPercent;
        this.fitText(`Lv.${q.brandLevel} → Lv.${q.brandLevel+1} · 永久产量 +${before}% → +${after}%`,240,y+150,354,20,C.green,750,'center');
        this.fitText(`点击产量 ${rate(q.tapBefore!=null?q.tapBefore:v.brand.tapBefore)} → ${rate(q.tapAfter!=null?q.tapAfter:v.brand.tapAfter)} 份/次`,240,y+179,354,13,C.ink,600,'center');
        this.fitText(`永久自动 ${rate(q.baseIncomeBefore!=null?q.baseIncomeBefore:v.brand.baseIncomeBefore)} → ${rate(q.baseIncomeAfter!=null?q.baseIncomeAfter:v.brand.baseIncomeAfter)} 金币/秒`,240,y+204,354,13,C.ink,500,'center');
      }else{
        const s=q.kind==='turbo'?'自动产速 ×3，持续 90 秒':(q.kind==='order'||q.kind==='offline'?`额外 +${num(q.amount)} 金币`:`奖励 +${num(q.amount)} 金币`);this.text(s,240,y+162,22,C.ink,750,'center');this.text(q.kind==='order'?`本单共领取 ${num(q.amount*1.5)} 金币`:q.kind==='offline'?`本次共领取 ${num(q.amount*2)} 金币`:'完成后按当前显示的奖励结算',240,y+199,12,C.muted,400,'center');
      }
      if(ui.isDouyin){this.button(48,y+255,384,53,ui.adBusy?'广告加载 / 播放中…':isBrand?'观看广告，永久升级':'观看广告，领取奖励','watch',{disabled:ui.adBusy,fill:C.yellow,color:C.ink});}
      else{this.text('浏览器模拟体验 · 不会播放真实广告',240,y+247,12,C.green,650,'center');this.button(48,y+274,384,50,isBrand?'模拟完整观看 → 永久升级':'模拟完整观看 → 领取奖励','simulate:complete',{fill:C.yellow,color:C.ink,disabled:ui.adBusy});this.button(48,y+336,185,42,'模拟中途关闭','simulate:cancel',{fill:'#eceee3',color:C.ink,size:12,disabled:ui.adBusy});this.button(247,y+336,185,42,'模拟加载失败','simulate:fail',{fill:'#eceee3',color:C.ink,size:12,disabled:ui.adBusy});}
      this.text(isBrand?'可随时关闭；未完成观看不升级，已有等级保留':'可随时关闭；未完成观看不会发放奖励',240,y+405,11,C.muted,400,'center');
    }
    else if(m.type==='settings'){title('工厂设置','小小爆米花厂 · 1.0.0');this.button(48,y+132,384,47,`音效                 ${v.state.settings.sound?'已开启':'已关闭'}`,'setting:sound',{fill:C.mint,color:C.ink});this.button(48,y+191,384,47,`震动反馈             ${v.state.settings.haptics?'已开启':'已关闭'}`,'setting:haptics',{fill:C.mint,color:C.ink});this.button(48,y+250,384,47,'玩法说明','help',{fill:'#eeeee5',color:C.ink});this.button(48,y+309,384,47,'存档与隐私','privacy',{fill:'#eeeee5',color:C.ink});this.button(48,y+368,384,47,'健康游戏忠告','health',{fill:'#eeeee5',color:C.ink});if(ui.isDouyin&&ui.sidebar&&ui.sidebar.supported)this.button(48,y+427,384,47,'从侧边栏回到工厂','sidebar',{fill:C.mint,color:C.ink});this.text('进度仅保存于当前设备，请勿清除应用数据',240,y+526,11,C.muted,400,'center');}
    else if(m.type==='health'){title('健康游戏忠告','合理安排时间，休息后再来收获。');HEALTH_ADVISORY.forEach((line,i)=>this.text(line,240,y+143+i*43,20,C.ink,500,'center'));this.button(48,y+362,384,49,'回到工厂','close');}
    else if(m.type==='sidebar'){
      title('从侧边栏，再回到工厂',ui.sidebar&&ui.sidebar.fromSidebar?'欢迎回来，你已从侧边栏进入工厂。':'下次来玩，可以从抖音侧边栏找到工厂。');
      this.box(48,y+136,384,118,16,C.mint);
      this.text('抖音首页侧边栏',240,y+174,21,C.green,750,'center');
      this.text('找到「小小爆米花厂」，继续今天的经营',240,y+219,14,C.ink,500,'center');
      this.button(48,y+283,384,49,ui.sidebarBusy?'正在打开…':'去侧边栏看看','visitSidebar',{disabled:ui.sidebarBusy||!ui.sidebar||!ui.sidebar.supported});
      this.button(48,y+346,384,43,'继续经营','close',{fill:'#eeeee5',color:C.ink});
    }
    else if(m.type==='help'){title('一口锅，也能有大梦想','点击生产 → 免费爆锅 → 完成订单 → 升级换代');this.wrap('① 点击锅或绿色按钮，爆米花自动售卖。\n② 升级自动生产，松开手也能持续赚钱。\n③ 能量积满自动爆锅；升级三条永久产线。\n④ 完成订单并攒够金币，解锁下一台机器。\n⑤ 成长任务引导新尝试，达成后领取金币。\n⑥ 品牌合作：广告提升永久产量，换代保留。\n⑦ 完成 20 单后继续循环订单、刷新纪录。',48,y+127,380,13,C.ink,27);this.fitText('电脑：空格生产 · 1/2/3 升级 · O 订单 · M 机器 · Q 任务 · B 合作',240,y+329,382,11,C.muted,400,'center');this.button(48,y+362,384,49,'开工！','close');}
    else if(m.type==='privacy'){title('存档与隐私','进度保存在当前浏览器或小游戏的本地存储中。');this.wrap('游戏保存金币、设备、订单、任务与品牌合作等级、音效设置及最后离开时间，用于恢复进度与计算离线收益。\n本版无账号、无云存档，不主动上传游戏埋点。抖音广告的数据处理以平台实际说明为准。\n每 5 秒及离开时自动保存。清理浏览器或应用数据后，本地进度可能丢失。',48,y+136,382,14,C.ink,27);this.button(48,y+362,384,49,'知道了','close');}
    else if(m.type==='blueprint'){title('从小锅，到大工厂','每一次换代，产量与售价一起提升。');CONFIG.machines.forEach((machine,i)=>{const yy=y+128+i*77;this.box(48,yy,384,65,13,i===v.state.machine?C.mint:'#f2f1e8');this.box(61,yy+14,36,36,11,i<=v.state.machine?machine.color:'#e1e3d8');this.text(String(i+1).padStart(2,'0'),79,yy+32,14,C.ink,750,'center');this.text(machine.name,111,yy+23,15,C.ink,700);this.text(i<=v.state.machine?'已落成':`${num(machine.cost)} 金币 · ${machine.requiredOrders} 个订单`,111,yy+46,11,C.muted);if(i===v.state.machine)this.text('当前',410,yy+30,11,C.green,600,'right');});this.button(48,y+604,384,40,'回到工厂','close');}
    else if(m.type==='completion'){title('小小工厂，大大梦想','20 个主线订单完成！每一锅都算数。');this.box(48,y+126,384,136,18,C.mint);this.text('POPCORN WORKS',240,y+152,12,C.green,750,'center');this.text('工厂竣工纪念',240,y+193,31,C.ink,800,'center');this.text(`累计生产 ${num(v.state.totalProduced)} 份 · ${v.state.bursts} 次爆锅`,240,y+238,12,C.green,550,'center');this.wrap('新的循环订单已经到站。机器还在转，让下一份纪录更香一点。',48,y+291,380,14,C.muted,25);this.button(48,y+362,384,49,'继续营业，刷新纪录','close');}
  }
  questModal(quests,modal,y) {
    if(!quests||!quests.chapters.length){this.text('成长任务',48,y+44,25,C.ink,800);this.text('继续经营，更多收获正在路上。',48,y+93,15,C.muted);return;}
    const chapters=quests.chapters,chapter=chapters.find(item=>item.id===modal.chapterId)||chapters.find(item=>item.id===quests.activeChapterId)||chapters[0];
    this.text('成长任务',48,y+43,25,C.ink,800);
    this.text(`做一点新尝试，收获金币奖励 · ${quests.claimedCount}/${quests.total}`,48,y+78,14,C.muted);
    chapters.forEach((item,i)=>{
      const x=48+i*98,selected=item.id===chapter.id,ready=item.quests.some(quest=>quest.ready&&!quest.locked&&!quest.claimed);
      this.box(x,y+104,90,54,12,selected?C.green:'#efefe5',ready&&!selected?C.orange:undefined);
      this.text(`第 ${i+1} 章`,x+45,y+120,16,selected?C.white:C.ink,700,'center');
      this.text(item.complete?'已完成':!item.unlocked?'待解锁':ready?'可领奖':`${item.claimedCount}/${item.total} 已领`,x+45,y+143,12,selected?'#d9e9d1':C.muted,500,'center');
      this.hit(x,y+104,90,54,'questChapter:'+item.id);
    });
    this.text(chapter.title,48,y+185,19,C.green,750);
    this.fitText(chapter.unlocked?chapter.subtitle:'领完上一章奖励后解锁 · 提前完成也会记录',48,y+211,384,14,C.muted);
    chapter.quests.forEach((quest,i)=>{
      const yy=y+236+i*120,locked=!chapter.unlocked||quest.locked,ready=quest.ready&&!locked&&!quest.claimed,progress=Math.max(0,Math.min(1,quest.progress));
      this.box(48,yy,384,112,14,quest.claimed?'#f1f2e9':ready?'#e4eedb':locked?'#f0f0e8':'#f7f5e9',ready?'#b7cca9':C.line);
      this.fitText(quest.title,62,yy+21,225,18,locked?C.muted:C.ink,750);
      this.fitText(`+${num(quest.reward)} 金币`,418,yy+21,120,15,quest.claimed?C.muted:C.green,700,'right');
      this.fitText(quest.description,62,yy+46,354,14,locked?C.muted:C.ink);
      this.fitText(quest.claimed?'奖励已入账':ready?'目标达成，奖励等你领取':quest.hint,62,yy+69,245,12,C.muted);
      this.box(62,yy+93,152,6,3,'#dce2d2');if(progress>0)this.box(62,yy+93,Math.max(6,152*progress),6,3,quest.claimed?'#b1c6a2':C.green);
      this.fitText(`${num(Math.min(quest.current,quest.target))} / ${num(quest.target)}`,304,yy+96,82,12,C.muted,500,'right');
      const label=quest.claimed?'已领取 ✓':locked?'待解锁':ready?'领取奖励':'去完成';
      this.button(320,yy+65,98,40,label,ready?'questClaim:'+quest.id:'questGo:'+quest.id,{disabled:quest.claimed||locked||(!ready&&!quest.action),fill:ready?C.green:C.mint,color:ready?C.white:C.green,size:14});
    });
    this.text(quests.complete?'全部任务已完成，继续创造你的工厂纪录。':'按自己的节奏经营 · 奖励不设倒计时',240,y+725,13,C.muted,500,'center');
  }
  duration(seconds){const m=Math.floor(seconds/60);return m>=60?`${Math.floor(m/60)} 小时 ${m%60} 分钟`:`${m} 分钟`;}
  actionAt(x,y){for(let i=this.zones.length-1;i>=0;i--){const z=this.zones[i];if(x>=z.x&&x<=z.x+z.w&&y>=z.y&&y<=z.y+z.h)return z.action;}return null;}
}
module.exports={Renderer,HEALTH_ADVISORY};



