'use strict';

// Reuses the six original Canvas machine silhouettes. Processing and stock live
// exclusively in core.js: every moving part reads a real job's progress.
const C={ink:'#283e32',green:'#366348',yellow:'#f4ca58',cream:'#fff9e8'};
const PALETTES=[['#e2ebd9','#ccdabd'],['#deebe1','#bbd4c0'],['#e9e3ef','#d2c4dd'],['#e0eaed','#bfd3d9'],['#eee5d6','#deccb0'],['#eee8cf','#dace9a']];
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
  constructor(ctx){this.c=ctx;this.frame=null;this.stationFrames=[];this.bufferFrames=[];this.driveTime=0;this.flash=null;}
  emit(event){if(event&&['upgrade','evolve'].includes(event.type))this.flash={stationId:event.stationId||null,remaining:1.1};}
  update(dt){if(this.flash){this.flash.remaining=Math.max(0,this.flash.remaining-Math.max(0,value(dt)));if(!this.flash.remaining)this.flash=null;}}
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
    const inset=8,gap=clamp(h*.09,22,46),rowH=(h-inset*2-gap*2)/3;
    this.frame={x,y,w,h};this.stationFrames=[];this.bufferFrames=[];
    c.save();this.box(x,y,w,h,22,palette[0]);c.clip();
    for(let yy=y+12;yy<y+h;yy+=24)this.line(x+5,yy,x+w-5,yy,palette[1],.45);
    for(let xx=x+18;xx<x+w;xx+=36)this.line(xx,y,xx,y+h,palette[1],.4);
    for(let index=0;index<3;index++){
      const station=view.stations[index],yy=y+inset+index*(rowH+gap),artW=Math.min(w*.43,rowH*1.4);
      const frame={id:station.id,x:x+inset,y:yy,w:w-inset*2,h:rowH,artW,textX:x+inset+artW+8};
      this.stationFrames.push(frame);
      const highlighted=view.onboarding&&view.onboarding.stationId===station.id;
      const flashing=this.flash&&(!this.flash.stationId||this.flash.stationId===station.id);
      this.box(frame.x,yy,frame.w,rowH,14,'rgba(255,253,247,.93)',highlighted?'#d89b3e':flashing?'#68986c':'rgba(99,123,89,.14)');
      const color=station.status==='blocked'?'#d39a47':station.status==='waiting'?'#a5afa1':'#79a275';
      this.box(frame.x+5,yy+Math.min(11,rowH*.12),3,rowH-Math.min(22,rowH*.24),2,color);
      c.save();c.beginPath();c.rect(frame.x+8,yy+3,Math.max(1,artW-9),rowH-6);c.clip();
      this.drawStationArtwork(frame.x+10,yy+5,Math.max(1,artW-11),rowH-10,station,stage);c.restore();
      if(index<2){
        const buffer=view.buffers[index],bufferFrame={id:buffer.id,x:frame.x+12,y:yy+rowH+3,w:frame.w-24,h:gap-6};
        this.bufferFrames.push(bufferFrame);this.drawBuffer(bufferFrame,buffer,station,index);
      }
    }
    c.restore();
    return {frame:this.frame,stationFrames:this.stationFrames,bufferFrames:this.bufferFrames};
  }
  drawStationArtwork(x,y,w,h,station,stage){
    if(station.id==='pop')this.drawPop(x,y,w,h,station,stage);
    else if(station.id==='cup')this.drawCupStation(x,y,w,h,station,stage);
    else this.drawShipStation(x,y,w,h,station,stage);
  }
  drawPop(x,y,w,h,station,stage){
    const c=this.c,lanes=Math.min(6,Math.max(1,value(station.lanes))),columns=Math.min(3,lanes),rows=Math.ceil(lanes/columns),each=w/columns,cellH=h/rows;
    for(let i=0;i<lanes;i++){
      const job=station.jobs&&station.jobs[i],active=Array.isArray(station.jobs)?!!(job&&!job.complete):station.status==='running';
      const scale=Math.min(each/270,cellH/(stage===5?250:220));c.save();
      c.translate(x+(i%columns+.5)*each,y+(Math.floor(i/columns)+.61)*cellH);c.scale(scale,scale);this.driveTime=this.jobProgress(station,i)*Math.PI*2;
      // Original silhouette remains visible, including its hand crank. It is an
      // automatically driven part now; touching it opens the station upgrade.
      this.drawMachine(stage,active);c.restore();
    }
  }
  drawCupStation(x,y,w,h,station,stage){
    const c=this.c,scale=Math.min(w/160,h/130),lanes=Math.min(6,Math.max(1,value(station.lanes)));
    c.save();c.translate(x+w/2,y+h*.52);c.scale(scale,scale);
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
    const lanes=Math.min(4,Math.max(1,value(station.lanes))),columns=lanes>2?2:1,rows=Math.ceil(lanes/columns);
    for(let i=0;i<lanes;i++)this.drawShipLane(x+i%columns*w/columns,y+Math.floor(i/columns)*h/rows,w/columns,h/rows,station,stage,i);
  }
  drawShipLane(x,y,w,h,station,stage,index){
    const c=this.c,scale=Math.min(w/174,h/132),job=station.jobs&&station.jobs[index];
    const batch=Math.max(1,value(job?job.amount:station.batchSize)),active=Array.isArray(station.jobs)?!!(job&&job.amount>0):value(station.inFlight)>0,p=this.jobProgress(station,index),travel=active?p*25:0;
    c.save();c.translate(x+w/2,y+h*.56);c.scale(scale,scale);
    this.box(-79,30,155,10,5,'#647c64');this.box(-67,40,8,12,2,'#94a58a');this.box(59,40,8,12,2,'#94a58a');
    const phase=active?p*17:0;
    for(let i=0;i<9;i++){const xx=-72+((i*17+phase)%144);this.line(xx,32,xx-3,37,'#a9ba9b',1.5);}
    if(batch===1){
      this.box(43,-23,31,51,5,'#829b76');this.box(47,-18,23,17,3,'#e5e8ce');
      this.line(53,-10,57,-6,'#5c8260',2);this.line(57,-6,64,-14,'#5c8260',2);
      if(active)this.cup(-37+travel,10,1,.94);
      this.line(-66,-9,-53,-9,'#87a079',2);this.line(-58,-14,-53,-9,'#87a079',2);this.line(-58,-4,-53,-9,'#87a079',2);
    }else if(batch<4){
      this.box(-66,-38,10,68,3,'#7999a3');this.box(53,-38,10,68,3,'#7999a3');this.box(-67,-46,132,12,4,'#668693');
      if(active){
        const count=Math.min(batch,6);for(let i=0;i<count;i++)this.cup(-39+(i%3)*26+travel*.25,2+Math.floor(i/3)*16,1,.62);
        this.box(-50+travel*.25,24,91,6,2,'#a295af');
      }
      this.box(-13,-34,26,12+p*7,4,'#b9cdd0');
    }else{
      this.box(-66,-62,9,92,3,'#a98b61');this.box(56,-62,9,92,3,'#a98b61');this.box(-67,-70,134,11,4,'#ba9b66');
      this.box(-37,-60+p*13,75,6,2,'#b79b6d');this.box(-5,-53+p*13,10,13,2,'#8b9870');
      if(active&&stage<5)this.crate(-43+travel*.5,-4,63,34);
      if(active&&stage===5){
        this.box(-43,23,86,6,2,'#9e8052');
        this.crate(-35,-13,70,35);
        this.line(-19,-11,-19,22,'#6f8a67',3);this.line(20,-11,20,22,'#6f8a67',3);
      }
    }
    // The output arrow is packaging expression. Only core shipment events settle.
    this.line(79,11,86,11,'#5e855f',2);this.line(83,7,87,11,'#5e855f',2);this.line(83,15,87,11,'#5e855f',2);
    c.restore();
  }
  drawBuffer(frame,buffer,upstream,index){
    const {x,y,w,h}=frame,c=this.c,ratio=clamp(value(buffer.amount)/Math.max(1,value(buffer.capacity)),0,1);
    const binW=Math.min(86,w*.35),filled=Math.ceil(ratio*8),yy=y+h*.48;
    this.line(x+binW/2,y-2,x+binW/2,y+h+2,'#8eaa84',3);
    this.box(x,yy-7,binW,14,4,'#c4d1b8','#a5b796');
    for(let i=0;i<8;i++)this.box(x+3+i*(binW-5)/8,yy-4,(binW-13)/8,8,2,i<filled?(ratio>.8?'#dbb063':index?'#e9c688':'#f4da89'):'#e1e8d8');
    if(h>=30&&buffer.amount>0){for(let i=0;i<Math.min(5,filled);i++)index?this.cup(x+12+i*14,yy-8,1,.29):this.popcorn(x+12+i*14,yy-9,3.2,i);}
    this.line(x+binW/2-4,y+h-3,x+binW/2,y+h+1,'#789a70',1.7);this.line(x+binW/2+4,y+h-3,x+binW/2,y+h+1,'#789a70',1.7);
    c.save();c.font='500 11px "Microsoft YaHei", "PingFang SC", sans-serif';c.textBaseline='middle';c.textAlign='left';c.fillStyle=ratio>.8?'#996520':'#62715a';
    c.fillText((index?'待发':'待装')+' '+value(buffer.amount)+' / '+value(buffer.capacity)+' 份',x+binW+10,yy);c.restore();
  }
  drawMachinePreview(x,y,size,stage){if(!(size>0))return;const c=this.c;c.save();c.translate(x+size/2,y+size*.65);c.scale(size/290,size/290);this.driveTime=0;this.drawMachine(machineStage(stage),false,true);c.restore();}
  drawProductionPreview(x,y,size,stage){if(!(size>0))return;const c=this.c;c.save();if(stage<4)this.cup(x+size/2,y+size/2,1,size/60);else this.crate(x+size*.2,y+size*.25,size*.6,size*.5);c.restore();}
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

module.exports={ProductionScene,PRODUCTION_FORMS};
