'use strict';

// Reuses the six original Canvas machine silhouettes. Processing and stock live
// exclusively in core.js: every moving part reads a real job's progress.
const C={ink:'#283e32',green:'#366348',yellow:'#f4ca58',cream:'#fff9e8'};
const PALETTES=[['#eee5cb','#dfd2b0'],['#e4e9d7','#cfdbc2'],['#e8e1de','#d9ced0'],['#e0e8df','#cad9cf'],['#efe2ce','#ddcdb5'],['#ede5c9','#ded2ac']];
const PRODUCTION_FORMS=Object.freeze([
  {id:'cup',unit:'单份装杯',rhythm:'一口锅，一条线'},
  {id:'electric',unit:'电热流水线',rhythm:'稳定供料，快装快发'},
  {id:'parallel',unit:'并行工位',rhythm:'多路加工，合流出货'},
  {id:'tray',unit:'整托包装',rhythm:'多头装杯，成批处理'},
  {id:'carton',unit:'成箱包装',rhythm:'装箱封口，整批送出'},
  {id:'pallet',unit:'整垛发运',rhythm:'多线合流，自动码垛'}
].map(Object.freeze));
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const value=n=>Number.isFinite(n)?n:0;
const machineStage=n=>clamp(Math.floor(value(n)),0,5);

class ProductionScene {
  constructor(ctx){
    this.c=ctx;this.frame=null;this.stationFrames=[];this.bufferFrames=[];this.driveTime=0;
    this.flash=null;this.delivery=null;this.pendingDelivery={amount:0,coins:0};this.deliveryCooldown=0;
  }
  emit(event){
    if(!event)return;
    if(event.type==='upgrade'||event.type==='evolve'){
      this.flash={stationId:event.stationId||null,name:String(event.name||'设备改造'),remaining:2,duration:2};
    }else if(event.type==='ship'&&value(event.amount)>0){
      // This is an event receipt, never a second sale. A visual parcel may stand
      // for many shipped portions; the displayed coin sum is the actual event sum.
      this.pendingDelivery.amount+=value(event.amount);this.pendingDelivery.coins+=value(event.coins);
    }
  }
  update(dt){
    const elapsed=Math.max(0,value(dt));
    if(this.flash){this.flash.remaining=Math.max(0,this.flash.remaining-elapsed);if(!this.flash.remaining)this.flash=null;}
    if(this.delivery){this.delivery.remaining=Math.max(0,this.delivery.remaining-elapsed);if(!this.delivery.remaining)this.delivery=null;}
    this.deliveryCooldown=Math.max(0,this.deliveryCooldown-elapsed);
    if(this.pendingDelivery.amount>0&&this.deliveryCooldown===0){
      this.delivery={...this.pendingDelivery,remaining:.65,duration:.65};
      this.pendingDelivery={amount:0,coins:0};this.deliveryCooldown=.75;
    }
  }
  box(x,y,w,h,r=8,fill,stroke){
    if(w<=0||h<=0)return;
    const c=this.c;r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);
    c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();
    if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}
  }
  line(x,y,xx,yy,color,width=2){const c=this.c;c.beginPath();c.moveTo(x,y);c.lineTo(xx,yy);c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.stroke();}
  circle(x,y,r,fill){const c=this.c;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=fill;c.fill();}
  popcorn(x,y,r=5,a=0){const c=this.c;c.save();c.translate(x,y);c.rotate(a);this.circle(-r*.5,0,r*.66,'#fff8d5');this.circle(r*.4,-r*.35,r*.7,'#fffce9');this.circle(r*.45,r*.5,r*.65,'#ffeab0');this.circle(-r*.4,r*.55,r*.58,'#fff5c8');this.circle(0,r*.1,r*.33,'#e7bc5b');c.restore();}
  cup(x,y,fill=1,scale=1){
    const c=this.c;c.save();c.translate(x,y);c.scale(scale,scale);
    c.beginPath();c.moveTo(-13,-14);c.lineTo(13,-14);c.lineTo(10,15);c.lineTo(-10,15);c.closePath();c.fillStyle=C.cream;c.fill();
    c.save();c.clip();for(const xx of [-10,0,10]){c.fillStyle='#d99665';c.fillRect(xx-3,-14,5,32);}c.restore();
    this.box(-14,-16,28,4,2,'#fffbea');
    if(fill>0){c.save();c.globalAlpha*=clamp(fill*2,0,1);for(let i=0;i<5;i++)this.popcorn(-9+i*4.5,-17-(i%2)*3+12*(1-fill),3.7,i);c.restore();}
    this.circle(0,3,5,'#fff9e8');this.circle(0,3,2.4,C.green);c.restore();
  }
  crate(x,y,w,h){this.box(x,y,w,h,3,'#dfbd88','#aa825b');this.line(x+w*.5,y+1,x+w*.5,y+h-1,'#f9e9be',Math.max(2,w*.12));this.box(x+w*.1,y+h*.42,w*.24,h*.28,2,'#fff0cc');}
  jobProgress(station,index=0){const job=station.jobs&&station.jobs[index];return clamp(value(Array.isArray(station.jobs)?job&&job.progress:station.progress),0,1);}
  draw(x,y,w,h,view){
    if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0)return;
    const c=this.c,stage=machineStage(view.state.machine),palette=PALETTES[stage];
    const inset=h<225?4:8,gap=clamp(h*.12,26,46),rowH=(h-inset*2-gap*2)/3;
    this.frame={x,y,w,h};this.stationFrames=[];this.bufferFrames=[];
    c.save();this.box(x,y,w,h,20,palette[0]);c.clip();
    // One workshop floor and one continuous material route connect the stations.
    // The floor remains visually secondary to equipment and physical stock.
    for(let yy=y+18;yy<y+h;yy+=34)this.line(x+5,yy,x+w-5,yy,palette[1],.65);
    const artW=(w-inset*2)*.52,flowX=x+inset+artW*.51;
    this.line(flowX,y+15,flowX,y+h-15,'#c8b891',20);
    this.line(flowX,y+15,flowX,y+h-15,'#efe4c7',13);
    for(let index=0;index<3;index++){
      const station=view.stations[index],yy=y+inset+index*(rowH+gap);
      const frame={id:station.id,x:x+inset,y:yy,w:w-inset*2,h:rowH,artW,textX:x+inset+artW+9};
      this.stationFrames.push(frame);
      const selected=view.presentation&&view.presentation.selectedStationId===station.id;
      const bottleneck=view.insights&&view.insights.bottleneck&&view.insights.bottleneck.stationId===station.id;
      const flashing=this.flash&&(!this.flash.stationId||this.flash.stationId===station.id);
      if(selected)this.box(frame.x,yy,frame.w,rowH,12,'rgba(255,249,224,.53)','#58754c');
      else if(bottleneck)this.box(frame.x,yy,frame.w,rowH,12,'rgba(250,226,168,.20)');
      // A small station plinth replaces the old three full-width white cards.
      this.box(frame.x+6,yy+rowH-7,artW-10,5,2,'#b6aa83');
      c.save();c.beginPath();c.rect(frame.x+3,yy+2,Math.max(1,artW-2),rowH-4);c.clip();
      this.drawStationArtwork(frame.x+5,yy+3,Math.max(1,artW-7),rowH-6,station,stage);
      if(flashing)this.drawInstallation(frame,this.flash);
      if(station.id==='ship')this.drawDelivery(frame);
      c.restore();
      if(index<2){
        const buffer=view.buffers[index],bufferFrame={id:buffer.id,x:frame.x+3,y:yy+rowH+1,w:frame.w-6,h:gap-2};
        this.bufferFrames.push(bufferFrame);this.drawBuffer(bufferFrame,buffer,station,index);
      }
    }
    c.restore();
    return {frame:this.frame,stationFrames:this.stationFrames,bufferFrames:this.bufferFrames};
  }
  drawInstallation(frame,flash){
    const c=this.c,p=1-flash.remaining/flash.duration,x=frame.x+frame.artW*.5,y=frame.y+frame.h*.48;
    c.save();c.globalAlpha*=Math.min(1,flash.remaining*2);
    const radius=Math.min(frame.artW*.37,frame.h*.44);
    c.beginPath();c.arc(x,y,radius,-Math.PI*.8+p,Math.PI*.6+p);c.strokeStyle='#e2ae43';c.lineWidth=2;c.stroke();
    for(let i=0;i<3;i++){
      const xx=x+Math.cos(i*2.1+p*4)*radius,yy=y+Math.sin(i*2.1+p*4)*radius;
      this.line(xx-3,yy,xx+3,yy,'#b5832c',2);this.line(xx,yy-3,xx,yy+3,'#b5832c',2);
    }
    c.restore();
  }
  drawDelivery(frame){
    const delivery=this.delivery;if(!delivery)return;
    const c=this.c,p=1-delivery.remaining/delivery.duration;
    const xx=frame.x+frame.artW*(.71+p*.22),yy=frame.y+frame.h*.56;
    c.save();c.globalAlpha*=Math.min(1,delivery.remaining*5);
    if(delivery.amount>=4)this.crate(xx-7,yy-7,14,12);else this.cup(xx,yy,1,.34);
    c.font='700 11px "Microsoft YaHei", "PingFang SC", sans-serif';c.textBaseline='middle';c.textAlign='right';c.fillStyle='#486a3c';
    c.fillText('+'+delivery.coins+' 金',frame.x+frame.artW-2,frame.y+frame.h-8);
    c.restore();
  }
  drawStationArtwork(x,y,w,h,station,stage){
    if(station.id==='pop')this.drawPop(x,y,w,h,station,stage);
    else if(station.id==='cup')this.drawCupStation(x,y,w,h,station,stage);
    else this.drawShipStation(x,y,w,h,station,stage);
  }
  drawPop(x,y,w,h,station,stage){
    const c=this.c,scaleX=w/275,scaleY=Math.min(h/(stage===5?220:170),scaleX);
    const jobs=station.jobs||[],active=Array.isArray(station.jobs)?jobs.some(job=>job&&!job.complete):station.status==='running';
    // Expansion changes the shared housing. Actual purchased lanes are the
    // working heads inside it; we never tile and shrink complete machines.
    c.save();c.translate(x+w/2,y+h*.59);c.scale(scaleX,scaleY);
    this.driveTime=this.jobProgress(station,jobs.findIndex(job=>job&&!job.complete))*Math.PI*2;
    this.drawMachine(stage,active,false,station);c.restore();
  }
  drawCupStation(x,y,w,h,station,stage){
    const c=this.c,scaleX=w/160,scaleY=Math.min(h/130,scaleX),lanes=Math.min(6,Math.max(1,value(station.lanes)));
    c.save();c.translate(x+w/2,y+h*.52);c.scale(scaleX,scaleY);
    const tone=['#9fb09c','#7ca997','#ae95bd','#7c9fae','#bb9878','#b6a05c'][stage];
    this.box(-70,36,140,9,4,'#667f65');this.box(-65,45,8,13,2,'#8ca083');this.box(57,45,8,13,2,'#8ca083');
    this.box(-66,-51,132,20,6,tone);this.box(-59,-46,118,5,2,'#e8eedc');
    for(const side of [-61,61])this.box(side-4,-31,8,65,3,tone);
    for(let i=0;i<lanes;i++){
      const xx=(i-(lanes-1)/2)*Math.min(37,105/lanes),job=station.jobs&&station.jobs[i];
      const progress=this.jobProgress(station,i),active=Array.isArray(station.jobs)?!!(job&&job.amount>0):value(station.inFlight)>0;
      this.box(xx-8,-28,16,24,4,'#e8dbc3');this.box(xx-4,-5,8,10+(active?Math.sin(progress*Math.PI)*6:0),2,tone);
      const portions=Math.min(2,Math.max(1,job?job.amount:station.batchSize));
      for(let k=0;k<portions;k++)this.cup(xx+(k-(portions-1)/2)*14,22,active?progress:0,Math.min(.94/portions,3.6/lanes/portions));
      if(active&&station.status==='running')for(let k=0;k<3;k++)this.popcorn(xx+Math.sin(k*5)*3,5+(progress*13+k*5)%15,2.2,k);
    }
    this.circle(54,-41,3,station.status==='running'?'#f4ca58':'#ccd6c6');
    this.line(-49,40,-15,40,'#a8b995',2);this.line(15,40,49,40,'#a8b995',2);
    if(station.batchSize>1){this.box(-50,32,100,5,2,tone);this.line(0,31,0,39,'#e2d8ba',3);}
    c.restore();
  }
  drawShipStation(x,y,w,h,station,stage){
    const c=this.c,scaleX=w/174,scaleY=Math.min(h/128,scaleX),lanes=Math.min(4,Math.max(1,value(station.lanes)));
    const tone=['#849775','#7c9e8b','#a18bad','#7897a4','#b18f6b','#b2a055'][stage];
    c.save();c.translate(x+w/2,y+h*.56);c.scale(scaleX,scaleY);
    // All heads share a single chassis and belt. Real jobs supply the package,
    // ram travel, roller motion and completion indication of each work head.
    this.box(-79,30,158,10,5,'#647c64');this.box(-68,40,8,12,2,'#94a58a');this.box(60,40,8,12,2,'#94a58a');
    this.box(-74,-49,8,79,3,tone);this.box(66,-49,8,79,3,tone);this.box(-77,-57,154,13,4,tone);
    this.box(-64,-53,115,4,2,'#dce6c9');this.circle(63,-50,3,station.status==='running'?'#f4ca58':'#b6c3aa');
    for(let i=0;i<lanes;i++){
      const job=station.jobs&&station.jobs[i],active=Array.isArray(station.jobs)?!!(job&&job.amount>0):value(station.inFlight)>0;
      const p=this.jobProgress(station,i),batch=Math.max(1,value(job?job.amount:station.batchSize));
      const cell=132/lanes,xx=-66+cell*(i+.5),headW=Math.min(39,cell-5);
      this.box(xx-headW*.35,-42,headW*.7,9,3,'#dce3cd');
      this.box(xx-4,-33,8,9+(active?Math.sin(p*Math.PI)*7:0),2,tone);
      if(active){
        if(batch===1)this.cup(xx,11,1,Math.min(.85,cell/35));
        else if(batch<4){for(let k=0;k<Math.min(batch,3);k++)this.cup(xx+(k-(batch-1)/2)*Math.min(17,cell/3),12,1,Math.min(.57,cell/62));this.box(xx-headW/2,26,headW,4,2,'#bca377');}
        else{this.crate(xx-headW*.45,1,headW*.9,26);this.line(xx,3,xx,25,'#749060',2);}
      }else this.box(xx-headW*.45,26,headW*.9,2,1,'#a6b398');
      for(let k=0;k<3;k++){
        const roller=xx-cell*.43+((k*cell/3+(active?p*cell/3:0))%(cell*.87));
        this.line(roller,32,roller-3,37,'#a9ba9b',1.5);
      }
    }
    this.line(80,14,87,14,'#5e855f',2);this.line(83,10,87,14,'#5e855f',2);this.line(83,18,87,14,'#5e855f',2);
    c.restore();
  }
  drawBuffer(frame,buffer,upstream,index){
    const {x,y,w,h}=frame,c=this.c,amount=Math.max(0,value(buffer.amount)),capacity=Math.max(1,value(buffer.capacity));
    const ratio=clamp(amount/capacity,0,1),binW=w*.54,binH=Math.min(24,h-8),binY=y+(h-binH)/2;
    const innerW=binW-10,slots=index?10:16,occupied=ratio*slots;
    // The fill width is proportional to the exact stock, while representative
    // kernels/cups remain tangible even when one portion represents a small fill.
    this.box(x,binY,binW,binH,5,'#d4c8a6','#b8a47d');
    this.box(x+3,binY+3,binW-6,binH-6,3,'#ece3cb');
    if(ratio>0)this.box(x+4,binY+4,(binW-8)*ratio,binH-8,2,ratio>.85?'#e4bd75':'#e3ce91');
    for(let i=0;i<Math.ceil(occupied);i++){
      const fraction=clamp(occupied-i,0,1);c.save();c.globalAlpha*=.55+fraction*.45;
      if(index)this.cup(x+6+(i+.5)*innerW/slots,binY+binH*.62,1,Math.min(.43,(binH-5)/40));
      else this.popcorn(x+6+(i+.5)*innerW/slots,binY+binH*.5+(i%2?2:-2),Math.min(4.3,binH*.2),i);
      c.restore();
    }
    this.box(x+1,binY+binH-4,binW-2,5,2,'#b79d72');
    const arrowX=x+binW/2;
    this.line(arrowX-4,y+h-5,arrowX,y+h-1,'#789062',1.7);this.line(arrowX+4,y+h-5,arrowX,y+h-1,'#789062',1.7);
    c.save();c.font='600 11px "Microsoft YaHei", "PingFang SC", sans-serif';c.textBaseline='middle';c.textAlign='left';c.fillStyle=ratio>.85?'#8c6428':'#677451';
    c.fillText((index?'待发':'待装')+' '+amount+' / '+capacity,x+binW+8,y+h*.5);c.restore();
  }
  drawMachinePreview(x,y,size,stage){if(!(size>0))return;const c=this.c;c.save();c.translate(x+size/2,y+size*.65);c.scale(size/290,size/290);this.driveTime=0;this.drawMachine(machineStage(stage),false,true);c.restore();}
  drawProductionPreview(x,y,size,stage){if(!(size>0))return;const c=this.c;c.save();if(stage<4)this.cup(x+size/2,y+size/2,1,size/60);else this.crate(x+size*.2,y+size*.25,size*.6,size*.5);c.restore();}
  drawMachine(stage,active,preview=false,station=null) {
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
      if(station){this.box(-91,-74,182,68,12,'#ded5e3');this.box(-97,-83,194,14,5,'#877192');}
      else for(const x of [-49,49]) {this.box(x-35,-74,70,68,12,'#ede5ee');this.box(x-41,-83,82,14,5,'#877192');this.box(x-27,-61,54,38,8,'#f4dfa5');this.circle(x,15,9,'#6f647e');this.circle(x,15,4,active&&Math.floor(time*5)%2===(x<0?0:1)?C.yellow:'#beb69d');}
    } else if(stage===3) {
      this.box(-103,-66,206,99,13,color);this.box(-112,-76,224,14,5,'#547183');
      if(!station)for(const x of [-83,-50,-17,16,49,82]){this.box(x-13,-53,26,54,6,'#dfe9e8');this.box(x-9,-47,18,36,4,'#f4dfad');this.box(x-5,3,10,19,3,'#4f6c7d');}
      this.box(-86,26,172,12,5,'#536e7a');
    } else if(stage===4) {
      this.box(-124,-55,95,86,10,color);if(!station)this.box(-113,-43,73,40,6,'#f1ddb3');this.box(-132,-66,111,15,6,'#997057');
      this.box(-19,-84,111,80,12,'#e7c9a0');this.box(-29,-92,131,14,5,'#a47859');if(!station)this.box(-3,-70,80,40,6,'#fff0c8');else for(let i=0;i<3;i++)this.line(-4,-66+i*9,71,-66+i*9,'#c5a783',3);this.box(30,-4,24,32,4,'#b38c68');
    } else {
      this.box(-91,-36,182,67,15,'#c7ad58');this.box(-62,-85,124,53,13,'#e8cd71');this.box(-40,-133,80,52,12,'#f3d889');
      this.box(-99,-45,198,13,5,'#9b8849');this.box(-70,-94,140,13,5,'#a78c47');this.box(-46,-141,92,12,5,'#b69a4f');
      if(!station)for(let i=0;i<3;i++){this.box(-68+i*53,-23,30,37,7,'#f7ecbd');this.circle(-53+i*53,-4,6,'#b39643');}
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
    // Purchased heads occupy one shared equipment body. Preview keeps each
    // generation's original silhouette; live heads follow the true lane count.
    if(station){
      const lanes=Math.min(6,Math.max(1,value(station.lanes))),span=stage===4?205:stage===5?152:170;
      const headW=Math.min(52,span/lanes-5),headY=stage===0?-23:stage===2?-64:stage===3?-52:stage===4?-27:stage===5?-24:-38;
      const headH=stage===2?46:stage===3?51:26;
      this.box(-span/2-5,headY-4,span+10,headH+13,7,'#c8c2a3');
      for(let i=0;i<lanes;i++)this.drawPopHead((i-(lanes-1)/2)*span/lanes,headY,headW,headH,station,i);
    }else{
      const chambers=stage===2?[-49,49]:stage===3?[-83,-50,-17,16,49,82]:stage===4?[-77,36]:[0];
      for(const [index,x] of chambers.entries())for(let i=0;i<(stage===3?2:5);i++){
        const phase=(time*(active?1.8:0)+i*.18+index*.35)%1;
        this.popcorn(x+(stage===3?5:20)*Math.sin(i*4.2),-24-Math.sin(phase*Math.PI)*10,2.7+phase*1.6,i);
      }
    }
    if(active) {
      const steamCount=2;
      c.save();c.globalAlpha=.2;
      for(let i=0;i<steamCount;i++)this.circle(-24+i*48/(steamCount-1),-92-(time*18+i*16)%38,6+(time+i)%5,'#ffffff');
      c.restore();
    }
  }
  drawPopHead(x,y,w,h,station,index){
    const job=station.jobs&&station.jobs[index],p=this.jobProgress(station,index),working=!!(job&&!job.complete);
    this.box(x-w/2,y,w,h,5,'#fff0bc','#ad9a6d');
    this.box(x-w/2+3,y+h+3,w-6,3,1,working?'#6f9561':'#9b9f8c');
    if(job)for(let k=0;k<Math.min(4,Math.max(2,value(job.amount)+1));k++){
      const lift=working?Math.sin((p+k*.17)*Math.PI)*5:0;
      this.popcorn(x+(k-1.5)*Math.min(8,w/5),y+h*.62-lift,3+p*1.2,k);
    }
  }

}

module.exports={ProductionScene,PRODUCTION_FORMS};
