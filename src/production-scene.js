'use strict';

// Original Canvas artwork. Coordinates are local to a 432 × 220 production bay.
// Production events are aggregated over elapsed time; no particle represents a
// literal unit of stock. Large factories communicate growth without unbounded work.
const PARTICLE_LIMIT = 72, UNIT_LIMIT = 8, EVOLVE_DURATION = 2.8;
const PRODUCTION_FORMS = Object.freeze([
  {id:'kernel',unit:'散粒',rhythm:'一粒粒爆开',unlock:'手摇出粒，落进接料桶'},
  {id:'cup',unit:'满杯',rhythm:'装满一杯，再送出',unlock:'散粒装成满杯，整杯出货'},
  {id:'pair',unit:'双杯组',rhythm:'双路接料，成对送出',unlock:'左右交替装杯，双杯合流'},
  {id:'tray',unit:'六杯整托',rhythm:'六头齐落，一托送出',unlock:'六杯同步成型，整托出货'},
  {id:'carton',unit:'封装箱',rhythm:'装箱、合盖、封箱',unlock:'成托装箱，封好再出货'},
  {id:'pallet',unit:'整垛货',rhythm:'逐层码齐，整垛发运',unlock:'整箱自动码垛，成垛发运'}
].map(form=>Object.freeze(form)));
const WINDOW = .12;
const FRAME_X = [[100,346],[102,330],[102,330],[92,340],[74,378],[80,378]];
const FRAME_Y = [[80,243],[54,243],[40,243],[47,243],[31,243],[0,243]], PERFECT_DURATION = 1.8;
const C = { ink:'#283e32', green:'#366348', yellow:'#f4ca58', cream:'#fff9e8', line:'#b9cbae' };
const BAY = [
  {wall:'#e1ebd8',grid:'#d4e0cb',wood:'#b3bf9e',trim:'#8f9d7c'},
  {wall:'#e2ede0',grid:'#d2e2d0',wood:'#a9bfa4',trim:'#78997c'},
  {wall:'#e9e5ed',grid:'#ded9e4',wood:'#bcb4c5',trim:'#9987a4'},
  {wall:'#e0e9ec',grid:'#d1dfe3',wood:'#a8bcc1',trim:'#819fa9'},
  {wall:'#eee7d7',grid:'#e4dac6',wood:'#c7b99b',trim:'#a88e6b'},
  {wall:'#efe9d3',grid:'#e4dcbd',wood:'#c8bd8b',trim:'#a39762'}
];
const clamp = (n,lo,hi) => Math.max(lo,Math.min(hi,n));
const positive = n => Number.isFinite(n)&&n>0?n:0;
const machineStage = v => clamp(Math.floor(Number.isFinite(v)?v:v&&v.state&&Number.isFinite(v.state.machine)?v.state.machine:0),0,5);

class ProductionScene {
  constructor(ctx) {
    this.c=ctx;this.t=0;this.stage=0;this.productionMode='balanced';this.particles=[];this.pendingAuto=0;this.windowTime=0;
    this.autoCredit=0;this.autoCadence=0;this.flow=0;this.packTravel=0;this.portIndex=0;
    this.tapPulse=0;this.bucketPulse=0;this.burstTime=0;this.perfectTime=0;this.evolveTime=0;this.evolveLaunched=false;this.orderTime=0;
    this.producedInWindow=0;this.emitted=0;this.units=[];this.dispatched=0;this.lastDispatch=-10;
    this.evolveFrom=0;this.impactTime=0;
    this.autoLevel=0;this.recipeTier=0;this.yieldLevel=0;this.finishLevel=0;this.driveTime=0;this.souvenirs=[];
  }

  syncView(view) {
    if(!view)return;
    this.setStage(machineStage(view));
    this.productionMode=view.productionModes?view.productionModes.current:'balanced';
    const state=view.state||{},upgrades=state.upgrades||{},refinements=state.refinements||{};
    this.autoLevel=clamp(positive(upgrades.auto),0,24);
    const recipe=positive(upgrades.value);
    this.recipeTier=recipe>=20?3:recipe>=12?2:recipe>=6?1:0;
    this.yieldLevel=clamp(Math.floor(positive(refinements.yield)),0,3);
    this.finishLevel=clamp(Math.floor(positive(refinements.value)),0,3);
    this.souvenirs=Array.isArray(state.souvenirs)?state.souvenirs.filter(key=>['sign','cup','starlight'].includes(key)):[];
  }

  setStage(stage) {
    if(stage===this.stage)return;
    this.stage=stage;this.units.length=0;this.particles.length=0;
    this.autoCredit=0;this.pendingAuto=0;this.windowTime=0;this.flow=0;this.lastDispatch=-10;
  }

  emit(event,viewOrStage) {
    if(!event||typeof event!=='object')return;
    if(viewOrStage!==undefined&&event.type!=='evolve')this.setStage(machineStage(viewOrStage));
    if(event.type==='produce') {
      const amount=positive(event.amount);if(!amount)return;
      if(event.source==='auto')this.pendingAuto=Math.min(1e100,this.pendingAuto+amount);
      else if(event.source==='tap') {
        this.tapPulse=1;
        this.spray(this.stage===0?3:2,'tap');this.dispatch('tap');
      }
      // The core sends a separate burst event with its payout after produce/burst.
    } else if(event.type==='burst') {
      this.burstTime=1.6;this.tapPulse=1;this.bucketPulse=1;
      this.spray(18,'burst',true);this.dispatch('burst');
      this.perfectTime=event.perfect===true?PERFECT_DURATION:0;
      if(this.perfectTime>0) {
        // The bonus changes visual richness only; the core remains the payout authority.
        this.spray(8,'perfect',true);
      }
    } else if(event.type==='evolve') {
      this.evolveFrom=this.stage;
      if(Number.isFinite(event.machine))this.setStage(machineStage(event.machine));
      this.units.length=0;this.particles.length=0;
      this.evolveTime=EVOLVE_DURATION;this.evolveLaunched=false;this.tapPulse=0;
    } else if(event.type==='souvenir') {
      this.spray(12,'perfect',true);
    } else if(event.type==='order'||event.type==='delivery') {
      this.orderTime=1.65;
    }
  }

  update(dt,view) {
    if(!Number.isFinite(dt)||dt<=0)return;
    this.syncView(view);
    this.t+=dt;this.tapPulse=Math.max(0,this.tapPulse-dt*5);
    this.bucketPulse=Math.max(0,this.bucketPulse-dt*4);this.burstTime=Math.max(0,this.burstTime-dt);
    this.perfectTime=Math.max(0,this.perfectTime-dt);
    this.evolveTime=Math.max(0,this.evolveTime-dt);this.orderTime=Math.max(0,this.orderTime-dt);
    this.impactTime=Math.max(0,this.impactTime-dt);
    // Drop stale effects after a pause instead of replaying an expensive backlog.
    if(dt>1) {
      this.particles.length=0;this.units.length=0;this.pendingAuto=0;this.windowTime=0;this.autoCredit=0;
      this.autoCadence=0;this.flow=0;this.evolveLaunched=true;return;
    }
    if(this.flow>0||this.tapPulse>0)this.driveTime+=dt*(.7+this.autoLevel/16+this.yieldLevel*.12)*(this.productionMode==='rush'?1.15:this.productionMode==='premium'?.85:1);
    for(const p of this.particles) {
      p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=p.gravity*dt;p.life-=dt;p.a+=dt*2;
      if(p.y>=p.floor&&p.vy>0){p.life=0;this.bucketPulse=Math.max(this.bucketPulse,.3);}
    }
    for(let i=this.particles.length-1;i>=0;i--)if(this.particles[i].life<=0)this.particles.splice(i,1);
    for(const unit of this.units)unit.progress+=dt/unit.duration;
    this.units=this.units.filter(unit=>unit.progress<1);
    this.windowTime+=dt;this.autoCadence+=dt;
    if(this.windowTime+1e-9>=WINDOW) {
      const elapsed=this.windowTime,amount=this.pendingAuto;
      this.producedInWindow=amount;this.pendingAuto=0;this.windowTime=0;
      const visibleRate=amount>0?Math.min(10,2*Math.log2(1+amount/elapsed)):0;
      this.flow=visibleRate;
      this.autoCredit=Math.min(16,this.autoCredit+visibleRate*elapsed*(this.productionMode==='rush'?1.15:this.productionMode==='premium'?.85:1));
      if(amount>0&&this.autoCredit>=8&&this.dispatch('auto'))this.autoCredit-=8;
    }
    this.packTravel+=(this.flow>0?12+this.flow*1.35+this.autoLevel*.5+this.yieldLevel*4:0)*dt;
    if(this.evolveTime>0&&this.evolveTime<=2&&!this.evolveLaunched) {
      this.evolveLaunched=true;this.dispatch('evolve');this.bucketPulse=1;this.impactTime=.45;
    }
  }

  dispatch(kind) {
    const hero=kind==='burst'||kind==='evolve';
    // Production is settled by Game. A package is a visual batch, never inventory.
    const clearAt=[.3,.76,.98,.98,.78,.94][this.stage];
    if(!hero&&(this.t-this.lastDispatch<.5||this.units.some(unit=>unit.progress<clearAt)||this.units.filter(unit=>!unit.hero).length>=3))return false;
    if(this.evolveTime>2&&kind!=='evolve')return false;
    if(hero)this.units.length=0;
    if(this.units.length>=UNIT_LIMIT)this.units.shift();
    this.units.push({stage:this.stage,kind,hero,progress:0,duration:hero?2.6:2.7});
    this.lastDispatch=this.t;this.dispatched++;return true;
  }

  ports() {
    const offsets=[[0],[0],[-49,49],[-83,-50,-17,16,49,82],[-78,43],[-39,0,39]][this.stage];
    const y=[96,151,146,145,139,141][this.stage];
    return offsets.map(dx=>({x:216+dx,y}));
  }

  spray(count,kind,priority=false) {
    count=clamp(Math.floor(count),0,PARTICLE_LIMIT);
    if(priority&&this.particles.length+count>PARTICLE_LIMIT)this.particles.splice(0,this.particles.length+count-PARTICLE_LIMIT);
    const ports=this.ports(),perfect=kind==='perfect',burst=kind==='burst'||perfect,celebrate=kind==='celebrate';
    for(let i=0;i<count&&this.particles.length<PARTICLE_LIMIT;i++) {
      const port=ports[this.portIndex++%ports.length],spread=burst?140:celebrate?120:45;
      const originX=celebrate?55+Math.random()*322:port.x;
      this.particles.push({x:originX+(Math.random()-.5)*10,y:celebrate?28:port.y,
        vx:(Math.random()-.5)*spread+(216-originX)*.22,vy:celebrate?-35-Math.random()*65:burst?-100-Math.random()*140:-50-Math.random()*65,
        gravity:burst?280:240,life:burst?1.7:celebrate?1.5:1.25,r:(burst?4.5:3.5)+Math.random()*2,
        a:Math.random()*6,floor:celebrate?213:this.stage>=4?180:183,kind,port:port.x,
        accent:perfect?(i%2?'#568861':'#d5a434'):null});
      this.emitted++;
    }
  }

  box(x,y,w,h,r,fill,stroke) {
    const c=this.c;r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);
    c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();
    if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}
  }
  circle(x,y,r,fill) {const c=this.c;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=fill;c.fill();}
  line(x,y,xx,yy,color,width=2) {const c=this.c;c.beginPath();c.moveTo(x,y);c.lineTo(xx,yy);c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.stroke();}
  popcorn(x,y,r=5,a=0) {
    const c=this.c;c.save();c.translate(x,y);c.rotate(a);
    const tones=[['#fff8d5','#fffce9','#ffeab0','#fff5c8','#e7bc5b'],['#f9e2a2','#fff0bf','#e9bc70','#f7d797','#d39b49'],['#edc37e','#ffe1a4','#d99950','#f1cb83','#b7793d'],['#f1c36a','#ffe5a2','#db9a43','#f6cf7c','#b97c36']][this.recipeTier];
    this.circle(-r*.5,0,r*.66,tones[0]);this.circle(r*.4,-r*.35,r*.7,tones[1]);
    this.circle(r*.45,r*.5,r*.65,tones[2]);this.circle(-r*.4,r*.55,r*.58,tones[3]);this.circle(0,r*.1,r*.33,tones[4]);
    if(this.recipeTier>=2)this.circle(r*.34,-r*.55,r*.18,'#fff3ce');c.restore();
  }

  sparkle(x,y,r,a,color) {
    const c=this.c;c.save();c.translate(x,y);c.rotate(a);c.beginPath();
    for(let i=0;i<8;i++) {
      const angle=i*Math.PI/4-Math.PI/2,radius=i%2?r*.3:r;
      if(i===0)c.moveTo(Math.cos(angle)*radius,Math.sin(angle)*radius);
      else c.lineTo(Math.cos(angle)*radius,Math.sin(angle)*radius);
    }
    c.closePath();c.fillStyle=color;c.fill();this.circle(0,0,r*.17,'#fffbee');c.restore();
  }

  framing(w,h,options={}) {
    // Keep the working machine, outlet and packages in one camera. The smaller
    // early machines need less headroom; the final tower retains its full height.
    // Frame each silhouette closely, including the hand crank and moving packages.
    // Overlay controls reserve room without reducing the card's full backdrop.
    const topInset=clamp(positive(options&&options.topInset),0,h);
    const bottomInset=clamp(positive(options&&options.bottomInset),0,h-topInset);
    const height=h-topInset-bottomInset,[top,bottom]=FRAME_Y[this.stage],[left,right]=FRAME_X[this.stage];
    const scale=Math.min(w/(right-left),height/(bottom-top));
    return {scale,x:w/2-(left+right)/2*scale,y:topInset+(height-(bottom-top)*scale)/2-top*scale};
  }

  draw(x,y,w,h,view,options) {
    if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0)return;
    this.syncView(view);
    const c=this.c,frame=this.framing(w,h,options),scale=frame.scale,bay=BAY[this.stage];
    c.save();this.box(x,y,w,h,18,bay.wall);c.clip();
    // Continue the subtle backdrop over the full card, including tall screens.
    for(let xx=x+16;xx<x+w;xx+=32)this.line(xx,y,xx,y+h,bay.grid,.6);
    for(let yy=y+18;yy<y+h;yy+=32)this.line(x,yy,x+w,yy,bay.grid,.6);
    if(!(scale>0)){c.restore();return;}
    c.translate(x+frame.x,y+frame.y);c.scale(scale,scale);
    this.workshop();
    if(this.burstTime>0) {
      const progress=1-this.burstTime/1.6;c.save();c.globalAlpha=Math.max(0,(1-progress)*.5);
      this.circle(216,136,26+progress*145,'#fff2b3');
      for(let i=0;i<12;i++){const a=i*Math.PI/6;this.line(216+Math.cos(a)*(55+progress*60),136+Math.sin(a)*(55+progress*60),216+Math.cos(a)*(66+progress*76),136+Math.sin(a)*(66+progress*76),'#e8bd49',3);}c.restore();
    }
    if(this.perfectTime>0) {
      const progress=1-this.perfectTime/PERFECT_DURATION,radius=55+progress*57;
      c.save();c.globalAlpha=clamp((1-progress)*1.25,0,1);
      c.beginPath();c.arc(216,130,radius,0,Math.PI*2);c.strokeStyle='#568861';c.lineWidth=3;c.stroke();
      c.beginPath();c.arc(216,130,radius+8,0,Math.PI*2);c.strokeStyle='#e0b33f';c.lineWidth=2;c.stroke();
      for(let i=0;i<8;i++) {
        const a=i*Math.PI/4+progress*.35;
        this.sparkle(216+Math.cos(a)*(radius+16),130+Math.sin(a)*(radius+16),6*(1-progress*.5),a,i%2?'#568861':'#d5a434');
      }
      c.restore();
    }
    const elapsed=EVOLVE_DURATION-this.evolveTime,retiring=this.evolveTime>0&&elapsed<.28;
    const install=this.evolveTime>0?1-clamp((elapsed-.28)/.52,0,1):0;
    if(this.evolveTime>0)this.reveal();
    c.save();
    if(retiring){const shrink=1-elapsed/.28*.3;c.globalAlpha=1-elapsed/.28;c.translate(216,130+elapsed*90);c.scale(shrink,shrink);this.drawMachine(this.evolveFrom,false);}
    else {
      const impact=this.impactTime>0?Math.sin((.45-this.impactTime)*24)*this.impactTime*5:0;
      c.translate(216,130-install*65+this.tapPulse*2+impact);
      c.scale(1+this.tapPulse*.02,1-this.tapPulse*.025);
      c.globalAlpha=1-install;this.drawMachine(this.stage,this.flow>0||this.tapPulse>0);
    }
    c.restore();
    c.save();if(this.evolveTime>2)c.globalAlpha=1-install;
    this.outputStation();c.restore();
    for(const unit of this.units)this.drawUnit(unit);
    for(const p of this.particles){c.save();c.globalAlpha=clamp(p.life*3,0,1);if(p.kind==='perfect')this.sparkle(p.x,p.y,p.r,p.a,p.accent);else this.popcorn(p.x,p.y,p.r,p.a);c.restore();}
    if(this.orderTime>0)this.shipment();
    c.restore();
  }

  workshop() {
    const c=this.c,stage=this.stage,bay=BAY[stage],top=FRAME_Y[stage][0];
    // Quiet architecture sits behind the silhouette; the close phone camera can
    // crop the outer bay without losing the machine, outlets or moving packages.
    this.box(65,232,324,10,5,bay.wood);this.line(70,238,388,238,bay.trim,1.5);
    const windows=stage>=2?[104,283]:[281];
    for(const wx of windows) {
      const wy=top-15,ww=stage>=4?66:53,wh=stage>=4?64:49;
      this.box(wx,wy,ww,wh,7,bay.wood);this.box(wx+4,wy+4,ww-8,wh-8,4,'#f6f6e6');
      this.box(wx+7,wy+7,ww-14,wh*.45,3,'#e1eadd');
      this.line(wx+ww/2,wy+4,wx+ww/2,wy+wh-4,bay.wood,3);
      this.line(wx+4,wy+wh*.55,wx+ww-4,wy+wh*.55,bay.wood,3);
      this.line(wx-3,wy+wh,wx+ww+3,wy+wh,bay.trim,3);
    }
    if(stage<=1) {
      this.line(96,146,132,146,bay.trim,4);
      for(let i=0;i<stage+2;i++) {
        this.box(99+i*10,129-i%2*3,8,15+i%2*3,2,i%2?'#d8bd78':'#bac99a');
        this.line(101+i*10,132,104+i*10,132,'#f7efc9',1);
      }
    } else {
      const shelfX=stage>=4?81:102;
      this.line(shelfX,111,shelfX,194,bay.trim,2);this.line(shelfX+34,111,shelfX+34,194,bay.trim,2);
      for(let row=0;row<(stage>=4?3:2);row++) {
        const sy=137+row*27;
        this.line(shelfX-2,sy,shelfX+36,sy,bay.trim,3);
        for(let i=0;i<2;i++)this.crate(shelfX+3+i*16,sy-18,13,16,false);
      }
    }
    if(stage>=3) {
      const railY=top-8;
      this.line(97,railY,353,railY,bay.trim,3);
      for(const lx of stage>=4?[135,216,297]:[145,285]) {
        this.line(lx,railY,lx,railY+11,bay.trim,1.5);
        this.box(lx-12,railY+10,24,6,3,bay.trim);this.box(lx-8,railY+15,16,3,1,'#fff0bf');
      }
    }
    const crateX=stage>=4?349:303;
    this.crate(crateX,184,25,23,this.finishLevel>0);
    if(stage>=2)this.crate(crateX+2,167,21,16,this.finishLevel>0);
    if(stage>=4)this.crate(crateX-1,152,19,14,this.finishLevel>1);
    if(stage===5) {
      this.crate(94,188,24,19,this.finishLevel>0);
      this.box(318,67,25,32,5,'#f3e4b1',bay.trim);
      this.sparkle(330.5,81,8,0,'#b99e51');this.line(324,93,337,93,bay.trim,1);
    }
    // These are permanent, purchased keepsakes, visible on the same production bay.
    if(this.souvenirs.includes('sign')){
      this.box(119,43,75,32,5,'#f6e3a3','#a78338');
      this.line(124,48,189,48,'#caaa55',1);this.line(124,70,189,70,'#caaa55',1);
      this.popcorn(139,58,8,0);this.sparkle(164,58,7,0,'#b5882c');this.sparkle(181,58,5,0,'#b5882c');
    }
    if(this.souvenirs.includes('cup')){
      this.box(303,128,36,7,2,'#b49a58');this.box(318,111,7,18,2,'#c79d32');
      this.box(307,87,28,25,5,'#efc44e');this.box(313,90,16,6,2,'#ffe69a');
      this.line(307,92,301,94,'#d0aa44',3);this.line(301,94,304,106,'#d0aa44',3);
      this.line(335,92,341,94,'#d0aa44',3);this.line(341,94,338,106,'#d0aa44',3);
      this.sparkle(321,103,5,0,'#fff3c0');
    }
    if(this.souvenirs.includes('starlight')){
      this.line(104,15,357,15,'#a58b47',1.5);
      for(const [i,lx] of [116,157,279,322,350].entries()){
        const sy=i%2?31:23;this.line(lx,15,lx,sy,'#b39a55',1);
        this.sparkle(lx,sy+5,5.5+Math.sin(this.t*1.8+i)*.7,0,i%2?'#fff8c7':'#f2c951');
      }
    }
    // A softly painted lane makes the dispatch area read as a larger workshop.
    if(stage>=4) {
      c.save();c.globalAlpha=.55;
      this.line(85,214,377,214,'#f9edc3',2);
      for(let i=0;i<3;i++){const xx=307+i*13;this.line(xx,213,xx+4,215,bay.trim,1);this.line(xx+4,215,xx,217,bay.trim,1);}
      c.restore();
    }
  }

  crate(x,y,w,h,finished=false) {
    this.box(x,y,w,h,3,finished?'#e6c675':'#dfcca3');
    this.line(x+2,y+4,x+w-2,y+4,finished?'#b79442':'#b8a077',1);
    this.line(x+w*.5,y+1,x+w*.5,y+h-1,finished?'#faf0c0':'#f1e4c1',2);
    if(finished)this.circle(x+w*.73,y+h*.67,Math.min(w,h)*.13,C.green);
  }

  reveal() {
    const c=this.c,progress=clamp(1-this.evolveTime/EVOLVE_DURATION,0,1),fade=Math.sin(progress*Math.PI);
    c.save();c.globalAlpha=fade*.6;
    this.circle(216,137,48+progress*90,'#fff6d7');
    c.save();c.translate(216,201);c.scale(1,.22);
    c.beginPath();c.arc(0,0,40+progress*118,0,Math.PI*2);c.strokeStyle='#fff5cf';c.lineWidth=12;c.stroke();c.restore();
    // Two light strips part around the installation instead of covering its
    // input area. The effect owns no hit target and expires with evolveTime.
    for(const sign of [-1,1]) {
      const xx=216+sign*(39+progress*106);
      this.line(xx,74,xx,184,'#fff9e8',5*(1-progress)+1);
      this.sparkle(xx,96+progress*33,7,progress*.6,'#e4c467');
    }
    c.restore();
  }

  shipment() {
    // Departure stays inside the scene clip and never owns an input region.
    const progress=clamp(1-this.orderTime/1.65,0,1),x=168+progress*progress*330;
    this.box(x,164,84,34,7,'#f5c960');this.box(x+79,174,32,24,5,'#64856a');
    this.box(x+85,177,19,10,3,'#e2eddc');this.line(x+6,192,x+75,192,'#d6a543',2);
    for(const wheelX of [x+18,x+93]){this.circle(wheelX,201,9,C.ink);this.circle(wheelX,201,4,'#f7f6e9');}
    this.popcorn(x+40,180,9,-.1);
    this.crate(x+9,151,21,12,this.finishLevel>0);this.crate(x+33,147,21,16,this.finishLevel>0);
    if(this.stage>=2)this.crate(x+57,153,19,10,this.finishLevel>0);
    if(this.stage>=4){this.crate(x+12,138,19,12,this.finishLevel>1);this.crate(x+36,134,19,12,this.finishLevel>1);}
    if(this.stage===5)this.crate(x+58,137,18,15,this.finishLevel>1);
  }

  bucket(x,y,scale,fill) {
    const c=this.c;c.save();c.translate(x,y);c.scale(scale,scale);
    c.beginPath();c.moveTo(-38,-19);c.lineTo(38,-19);c.lineTo(29,20);c.lineTo(-29,20);c.closePath();c.fillStyle=C.cream;c.fill();
    c.save();c.clip();for(let i=-34;i<40;i+=19){c.fillStyle=this.finishLevel>0?'#c49b43':['#d89465','#cb9560','#a8764c','#54735b'][this.recipeTier];c.fillRect(i,-19,9,41);}c.restore();
    if(this.recipeTier>=2)this.line(-30,14,30,14,this.finishLevel>0?'#bc9440':'#d6b166',2);
    this.box(-40,-22,80,6,3,'#fffbee');
    const count=Math.floor(clamp(fill,0,1)*19);for(let i=0;i<count;i++)this.popcorn(Math.sin(i*31.2)*30,-22-Math.abs(Math.cos(i*11.8))*9,4.5,i);
    this.box(-15,-3,30,14,6,'#fff9e7');
    if(this.recipeTier>=3||this.finishLevel>0)this.sparkle(0,4,this.finishLevel>1?6:4.5,0,this.finishLevel>0?'#b28a2e':C.green);
    else this.circle(0,4,3,C.green);
    if(this.finishLevel>0) {
      this.line(-35,-16,35,-16,'#e7c96b',2);
      if(this.finishLevel>=2){this.circle(-20,3,1.7,'#b28a2e');this.circle(20,3,1.7,'#b28a2e');}
      if(this.finishLevel>=3){this.line(-10,-8,10,-8,'#c39b46',1.5);this.line(-10,13,10,13,'#c39b46',1.5);}
    }
    c.restore();
  }

  outputStation() {
    const stage=this.stage,c=this.c;
    if(stage===0){this.bucket(216,217,1+this.bucketPulse*.025,.65+this.bucketPulse*.35);return;}
    // Every generation owns a different arrangement, including while idle.
    const left=stage>=4?104:128,right=stage>=4?363:322;
    this.box(left,224,right-left,9,4,'#546f5c');
    for(let i=0;i<12;i++){
      const xx=left+5+(i*(right-left-10)/12+this.packTravel%16)%(right-left-10);
      this.line(xx,226,xx-3,230,'#a8bba0',1.6);
    }
    if(stage===1){this.line(216,166,216,180,'#668b78',7);this.circle(216,178,4,C.yellow);}
    if(stage===2){
      for(const sign of [-1,1]){
        this.line(216+sign*49,156,216+sign*49,176,'#9681a3',6);
        this.line(216+sign*49,176,216+sign*22,189,'#9681a3',6);
        this.circle(216+sign*49,168,3,Math.floor(this.driveTime*3)%2===(sign<0?0:1)?C.yellow:'#d6cddc');
      }
    }
    if(stage===3){
      this.box(142,175,148,7,3,'#547183');
      for(let i=0;i<6;i++)this.line(151+i*26,177,151+i*26,186,'#bfd2d8',3);
      this.line(142,217,142,204,'#698998',3);this.line(290,217,290,204,'#698998',3);
    }
    if(stage===4){
      this.line(280,171,280,222,'#ab825e',6);this.line(280,173,322,173,'#ab825e',6);
      this.box(290,176,21,9,3,'#547763');this.circle(301,174,9,'#f3d181');this.circle(301,174,3,'#b49053');
    }
    if(stage===5){
      for(const xx of [151,279]){this.line(xx,134,xx,222,'#a99049',5);this.line(xx+4,141,xx+4,216,'#eedc9e',1.5);}
      this.line(150,134,280,134,'#b5994f',7);
      const lift=170+Math.sin(this.driveTime*2)*9;
      this.box(155,lift,121,6,2,'#d6bb67');this.line(166,lift+5,166,lift+13,'#a48b44',3);
      this.line(264,lift+5,264,lift+13,'#a48b44',3);
    }
    if(!this.units.length){c.save();c.globalAlpha=.5;this.product(stage,216,210,.78,.08);c.restore();}
  }

  drawUnit(unit) {
    const c=this.c,p=clamp(unit.progress,0,1),stage=unit.stage;
    const form=clamp(p/.38,0,1),travel=clamp((p-.38)/.62,0,1);
    // A first batch holds center stage, then joins the normal dispatch lane.
    const x=stage===0?216+Math.sin(p*Math.PI*2)*16:216+travel*(stage>=4?109:77);
    const y=stage===0?126+p*78-Math.sin(p*Math.PI)*38:210;
    c.save();c.globalAlpha=clamp((1-p)*7,0,1);
    if(unit.hero&&stage>0){
      c.save();c.globalAlpha*=.55*(1-travel);this.box(x-48,y-38,96,56,10,'#fff1bc');c.restore();
    }
    const size=stage===0?1:unit.hero?1.1:stage===3?.82:.88;
    this.product(stage,x,y,size,form);
    if(unit.hero&&form>.9&&travel<.55){
      this.sparkle(x-43,y-28,5,0,'#d4ad47');this.sparkle(x+43,y-20,4,0,'#6b936e');
    }
    c.restore();
  }

  cup(x,y,fill=1,scale=1) {
    const c=this.c;c.save();c.translate(x,y);c.scale(scale,scale);
    c.beginPath();c.moveTo(-13,-14);c.lineTo(13,-14);c.lineTo(10,15);c.lineTo(-10,15);c.closePath();
    c.fillStyle=C.cream;c.fill();
    c.save();c.clip();
    for(const xx of [-10,0,10]){c.fillStyle=this.finishLevel?'#bf9b42':['#d99665','#c7995b','#b38259','#648d72'][this.recipeTier];c.fillRect(xx-3,-14,5,32);}c.restore();
    this.box(-14,-16,28,4,2,'#fffbea');
    if(fill>0){
      // A fixed crown becomes visible as the cup fills; it never adds particles.
      c.save();c.translate(0,(1-clamp(fill,0,1))*12);c.globalAlpha*=clamp(fill*2,0,1);
      for(let i=0;i<5;i++)this.popcorn(-9+i*4.5,-17-(i%2)*3,3.7,i);c.restore();
    }
    this.circle(0,3,5,'#fff9e8');this.circle(0,3,2.4,this.finishLevel?'#b6943d':C.green);
    c.restore();
  }

  product(stage,x,y,scale=1,form=1) {
    const c=this.c;c.save();c.translate(x,y);c.scale(scale,scale);
    if(stage===0)this.popcorn(0,0,8+Math.sin(form*Math.PI)*2,-form);
    else if(stage===1)this.cup(0,0,form,1.25);
    else if(stage===2){
      const gap=17+(1-form)*17;
      this.cup(-gap,0,clamp(form*1.7,0,1));this.cup(gap,0,clamp((form-.3)*1.7,0,1));
      this.box(-gap-14,12,gap*2+28,6,3,'#a790b5');
      if(form>.75)this.box(-7,8,14,9,3,'#d2c0dd');
    }else if(stage===3){
      for(let row=0;row<2;row++)for(let col=0;col<3;col++){
        this.cup((col-1)*27+(1-form)*(col-1)*8,-14+row*16-(1-form)*8,form,.8);
      }
      this.box(-46,14,92,8,3,'#7798a5');this.line(-44,16,44,16,'#b8d0d6',2);
      this.box(-12,14,24,8,2,'#e9f0e6');this.circle(0,18,2.2,C.green);
    }else if(stage===4){
      const closing=clamp((form-.5)*2,0,1);
      this.box(-29,-21,58,41,4,'#dcb987','#aa825b');
      this.box(-24,-17,48,7,2,'#a47950');
      if(closing<1)for(let i=0;i<3;i++)this.cup(-17+i*17,-14-(1-closing)*8,1,.55);
      for(const sign of [-1,1]){
        c.beginPath();c.moveTo(sign*29,-21);c.lineTo(sign*29,-12);c.lineTo(sign*(29-closing*29),-12-(1-closing)*18);c.lineTo(sign*(29-closing*29),-21-(1-closing)*18);c.closePath();c.fillStyle='#ebd2a9';c.fill();
      }
      if(closing>.8){this.line(0,-21,0,18,'#f6e5bb',6);this.line(-22,-16,22,-16,'#c4a06d',1);}
      this.box(-21,-2,17,12,2,'#fff0cc');this.popcorn(-12,3,3.8,0);
      this.line(12,7,20,7,'#ad8659',2);this.line(12,11,20,11,'#ad8659',2);
    }else{
      this.box(-43,16,86,8,2,'#9e8052');
      for(const xx of [-34,0,34])this.box(xx-5,23,10,5,1,'#7d694b');
      for(let row=0;row<3;row++){
        const arrival=clamp(form*3-row,0,1);if(arrival<=0)continue;
        c.save();c.globalAlpha*=arrival;
        for(let col=0;col<2;col++)this.crate(-37+col*38,16-(row+1)*20-(1-arrival)*18,35,19,true);
        c.restore();
      }
      if(form>.95){
        for(const xx of [-22,23])this.line(xx,-44,xx,20,'#5e8066',4);
        this.box(-11,-17,22,17,3,'#fff2be');this.sparkle(0,-8,6,0,'#b29741');
      }
    }
    c.restore();
  }

  drawProductionPreview(x,y,size,stage) {
    if(![x,y,size].every(Number.isFinite)||size<=0)return;
    // Preview geometry never synchronizes stage or advances live production.
    this.product(machineStage(stage),x+size/2,y+size*.6,size/112,1);
  }

  drawMachinePreview(x,y,size,stage) {
    if(!(size>0))return;
    const c=this.c;c.save();c.translate(x+size/2,y+size*.6);c.scale(size/300,size/300);
    this.drawMachine(machineStage(stage),false,true);c.restore();
  }

  drawMachine(stage,active,preview=false) {
    const c=this.c,time=preview?0:this.driveTime,bob=active?Math.sin(time*(stage===0?7:6))*.9:0;
    c.translate(0,bob);if(stage===5)c.scale(.73,.73);
    const color=['#d2a567','#85a898','#b398bf','#7e9bad','#d1956d','#cead4b'][stage];
    this.box(-98,31,196,17,6,'#a4b69a');this.box(-83,48,13,29,3,'#8c9f85');this.box(70,48,13,29,3,'#8c9f85');
    if(stage===0) {
      this.box(-74,-25,148,58,15,color);this.box(-61,-16,122,28,8,'#f5dfb1');this.box(-80,-34,160,13,6,'#8c7753');
      this.box(-33,-43,66,9,4,'#bd9b5b');this.line(77,-9,106,-9,'#78674c',5);
      this.line(106,-9,106,-29+(active?Math.sin(time*8)*7:0),'#78674c',5);this.box(98,-37+(active?Math.sin(time*8)*7:0),18,14,6,'#4c6b50');this.box(-19,17,38,15,5,'#6e7e61');
    } else if(stage===1) {
      this.box(-73,-61,146,93,18,color);this.box(-59,-47,118,51,10,'#d8e8ce');this.box(-49,-37,98,33,6,'#f5e5ab');
      this.box(-82,-69,164,14,6,'#567465');this.circle(43,18,7,active?'#f9d36a':'#bad0b0');this.box(-54,13,61,10,4,'#527161');this.box(-22,30,44,13,4,'#567465');
    } else if(stage===2) {
      this.box(-98,-28,196,61,12,color);
      for(const x of [-49,49]) {this.box(x-35,-74,70,68,12,'#ede5ee');this.box(x-41,-83,82,14,5,'#877192');this.box(x-27,-61,54,38,8,'#f4dfa5');this.circle(x,15,9,'#6f647e');this.circle(x,15,4,active&&Math.floor(time*5)%2===(x<0?0:1)?C.yellow:'#beb69d');}
    } else if(stage===3) {
      this.box(-103,-66,206,99,13,color);this.box(-112,-76,224,14,5,'#547183');
      for(const x of [-83,-50,-17,16,49,82]){this.box(x-13,-53,26,54,6,'#dfe9e8');this.box(x-9,-47,18,36,4,'#f4dfad');this.box(x-5,3,10,19,3,'#4f6c7d');}this.box(-86,26,172,12,5,'#536e7a');
    } else if(stage===4) {
      this.box(-124,-55,95,86,10,color);this.box(-113,-43,73,40,6,'#f1ddb3');this.box(-132,-66,111,15,6,'#997057');
      this.box(-19,-84,111,80,12,'#e7c9a0');this.box(-29,-92,131,14,5,'#a47859');this.box(-3,-70,80,40,6,'#fff0c8');this.box(30,-4,24,32,4,'#b38c68');
    } else {
      this.box(-91,-36,182,67,15,'#c7ad58');this.box(-62,-85,124,53,13,'#e8cd71');this.box(-40,-133,80,52,12,'#f3d889');
      this.box(-99,-45,198,13,5,'#9b8849');this.box(-70,-94,140,13,5,'#a78c47');this.box(-46,-141,92,12,5,'#b69a4f');
      for(let i=0;i<3;i++){this.box(-68+i*53,-23,30,37,7,'#f7ecbd');this.circle(-53+i*53,-4,6,'#b39643');}
      this.box(-27,-70,54,25,7,'#fff0c6');this.circle(0,-111,12,'#fff7d7');this.circle(0,-111,5,'#b68c2d');
      this.line(0,-144,0,-168,'#9d8649',3);this.box(1,-166,31,16,2,'#d88964');
    }
    if(stage!==2) {
      const [mx,my]=stage===0?[-49,21]:stage===1?[-39,18]:stage===3?[-75,31]:stage===4?[-77,15]:[59,22];
      this.circle(mx,my,stage===3?4:7,stage>=4?'#9d8055':'#647d69');
      const radius=stage===3?2:4.5,angle=active?time*3:0;
      for(let i=0;i<3;i++) {
        const a=angle+i*Math.PI*2/3;
        this.line(mx,my,mx+Math.cos(a)*radius,my+Math.sin(a)*radius,'#f3e2ab',1.5);
      }
    }
    // Visible kernels swell inside the chambers before they emerge as popcorn.
    const chambers=stage===2?[-49,49]:stage===3?[-83,-50,-17,16,49,82]:stage===4?[-77,36]:[0];
    for(const [index,x] of chambers.entries()) {
      const kernels=stage===3?2:5;
      for(let i=0;i<kernels;i++) {
        const phase=(time*(active?1.8:0)+i*.18+index*.35)%1,xx=x+(stage===3?5:20)*Math.sin(i*4.2);
        this.popcorn(xx,-24-Math.sin(phase*Math.PI)*10,2.7+phase*1.6,i);
      }
    }
    if(active) {
      const steamCount=2;
      c.save();c.globalAlpha=.2;
      for(let i=0;i<steamCount;i++)this.circle(-24+i*48/(steamCount-1),-92-(time*18+i*16)%38,6+(time+i)%5,'#ffffff');
      c.restore();
    }
  }
}

module.exports={ProductionScene,PARTICLE_LIMIT,UNIT_LIMIT,PRODUCTION_FORMS,EVOLVE_DURATION};

