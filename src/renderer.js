'use strict';

const { SixGenerationScene } = require('./six-generation-scene');
const { GameInterface } = require('./interface');
const { createArtTransform, transferTargetAt: hitTransferTarget } = require('./art-layout');
const { ART_ASSETS } = require('./art-manifest');
const { ART_EFFECTS } = require('./art-effects');
const { V13Showroom } = require('./v13-showroom');
const FONT = '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif';

// Presentation owns pixels and hit regions only. All stock, movement progress and
// money displayed below come from the single production simulation snapshot.
class Renderer {
  constructor(ctx, art, v13Art) {
    this.c=ctx;this.art=art;this.v13Art=v13Art;this.zones=[];this.scene=new SixGenerationScene(ctx,art);this.interface=new GameInterface(this);
    this.scene.v13Art=v13Art;this.showroom=new V13Showroom(this,v13Art);
  }
  box(x,y,w,h,r=14,fill='#fffdf7',stroke) {
    if(w<=0||h<=0)return;
    const c=this.c;r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);
    c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);
    c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();
    if(fill){c.fillStyle=fill;c.fill();}
    if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}
  }
  text(s,x,y,size=14,color='#283e32',weight=400,align='left') {
    // Older native Canvas parsers do not support intermediate CSS font weights.
    const c=this.c,canvasWeight=Math.max(100,Math.min(900,Math.round(weight/100)*100));
    c.font=`${canvasWeight} ${size}px ${FONT}`;c.fillStyle=color;
    c.textAlign=align;c.textBaseline='middle';c.fillText(String(s),x,y);
  }
  wrap(s,x,y,width,size=14,color='#687764',line=22) {
    this.c.font=`400 ${size}px ${FONT}`;let str='',n=0;
    for(const char of String(s)){
      if(char==='\n'||this.c.measureText(str+char).width>width){this.text(str,x,y+n*line,size,color);str=char==='\n'?'':char;n++;}
      else str+=char;
    }
    if(str)this.text(str,x,y+n*line,size,color);
    return(n+1)*line;
  }
  circle(x,y,r,fill,stroke) {
    const c=this.c;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=fill;c.fill();
    if(stroke){c.strokeStyle=stroke;c.stroke();}
  }
  hit(x,y,w,h,action){if(w>0&&h>0)this.zones.push({x,y,w,h,action});}
  transferTargetAt(x,y,source) {
    if (this.modalOpen) return null;
    return hitTransferTarget(this.scene.transferFrames,x,y,source,this.scene.transferBlockers);
  }
  transferPoint(source,kind) {
    const frame=(this.scene.transferFrames || []).find(item=>item.source===source&&item.kind===kind);
    return frame?{x:frame.x+frame.w/2,y:frame.y+frame.h/2}:null;
  }
  drawTransfer(view,ui) {
    this.transferGhost=null; this.tutorialHand=null; this.transferReceipt=null;
    if (ui.modal) return;
    this.drawTutorial(ui);
    this.drawTransferFeedback(ui);
    const held=ui.transfer;
    if (!held || !held.dragging || !(held.amount>0) || !Number.isFinite(held.x) || !Number.isFinite(held.y)) return;
    const source=held.source || 'pop', target=held.target || (source==='pop'?'cup':'ship');
    const ready=!!this.transferTargetAt(held.x,held.y,source);
    const viewport=ui.viewport,w=76,h=42;
    const x=Math.max(8+(viewport.safeLeft||0),Math.min(viewport.width-w-8-(viewport.safeRight||0),held.x-w/2));
    const top=this.scene.contentFrame?this.scene.contentFrame.y:4+(viewport.safeTop||0);
    const preferred=held.y-h-ART_EFFECTS.transfer.ghostOffset;
    const y=Math.max(top,Math.min(viewport.height-h-8-(viewport.safeBottom||0),preferred<top?held.y+ART_EFFECTS.transfer.ghostOffset:preferred));
    this.transferGhost={x,y,w,h,amount:held.amount,source,target,ready};
    this.c.save();this.c.globalAlpha=.96;
    this.box(x,y,w,h,10,'#fff4d5',ready?'#277860':'#b99756');
    this.paintCargo(x+4,y+5,34,28,held.amount,source);
    this.text(held.amount+' 份',x+53,y+20,13,'#66502a',700,'center');
    if(held.trialHint){
      const hint=String(held.trialHint),width=Math.min(viewport.width-24,hint.length*11+16);
      const hx=Math.max(width/2+12,Math.min(viewport.width-width/2-12,x+w/2));
      const hy=Math.min(viewport.height-(viewport.safeBottom||0)-18,y+h+12);
      this.box(hx-width/2,hy-10,width,20,6,'#fff5dc');this.text(hint,hx,hy,11,'#96602b',700,'center');
    }
    this.c.restore();
  }
  paintCargo(x,y,w,h,amount,source) {
    if (typeof this.scene.trayAt==='function') this.scene.trayAt([x,y,w,h],createArtTransform(),amount,source==='cup'?'cup':'kernel');
    else if(source==='cup')this.scene.cup(x+w/2,y+h/2,1,.4);
    else this.scene.popcorn(x+w/2,y+h/2,6);
  }
  drawTransferFeedback(ui) {
    const receipt=ui.transferFeedback;
    if (!receipt) return;
    const age=receipt.age||0,duration=receipt.duration||ART_EFFECTS.transfer.duration;
    const lifetime=Math.max(0,Math.min(1,age/duration)),p=Math.max(0,Math.min(1,age/ART_EFFECTS.transfer.duration));
    if(lifetime>=1)return;
    const sourcePoint=this.transferPoint(receipt.source,'tray'), targetPoint=this.transferPoint(receipt.source,'input');
    const fallback=sourcePoint || {x:0,y:0}, success=receipt.kind==='success';
    const start={x:Number.isFinite(receipt.x)?receipt.x:fallback.x,y:Number.isFinite(receipt.y)?receipt.y:fallback.y};
    const finish=success?{x:Number.isFinite(receipt.targetX)?receipt.targetX:(targetPoint||fallback).x,
      y:Number.isFinite(receipt.targetY)?receipt.targetY:(targetPoint||fallback).y}:
      {x:Number.isFinite(receipt.sourceX)?receipt.sourceX:fallback.x,y:Number.isFinite(receipt.sourceY)?receipt.sourceY:fallback.y};
    const ease=1-Math.pow(1-p,3), x=start.x+(finish.x-start.x)*ease,y=start.y+(finish.y-start.y)*ease;
    this.transferReceipt={kind:receipt.kind,x,y,amount:receipt.amount,progress:p};
    this.c.save();this.c.globalAlpha=1-lifetime*.65;
    if(p<1)this.paintCargo(x-19,y-24,38,28,receipt.amount,receipt.source);
    if(success){
      this.circle(finish.x,finish.y,12+p*14,'rgba(255,222,108,'+((1-p)*.3)+')');
      this.text('+'+receipt.amount,finish.x,finish.y-22-p*8,13,'#247967',700,'center');
    }else if(receipt.kind==='invalid'&&receipt.reason){
      const text=String(receipt.reason).slice(0,10),width=Math.min(ui.viewport.width-16,text.length*11+12);
      const tx=Math.max(width/2+8,Math.min(ui.viewport.width-width/2-8,x));
      this.box(tx-width/2,y+10,width,22,7,'#fff2da');
      this.text(text,tx,y+21,11,'#96602b',700,'center');
    }
    this.c.restore();
  }
  drawTutorial(ui) {
    const tutorial=ui.tutorial;
    if(!tutorial||ui.transfer||ui.press)return;
    const from=this.transferPoint(tutorial.source,'tray'),to=this.transferPoint(tutorial.source,'input');
    if(!from||!to)return;
    const p=Math.max(0,Math.min(1,tutorial.progress||0)),travel=Math.max(0,Math.min(1,(p-.15)/.7)),ease=travel*travel*(3-2*travel);
    const x=from.x+(to.x-from.x)*ease,y=from.y+(to.y-from.y)*ease;
    const size=ART_EFFECTS.tutorial.handSize,tip=ART_EFFECTS.tutorial.fingertip;
    this.tutorialHand={x,y,source:tutorial.source,target:tutorial.target,progress:p};
    this.c.save();this.c.globalAlpha=p>.9?(1-p)*10:Math.min(1,p*12+.2);
    this.c.beginPath();if(this.c.setLineDash)this.c.setLineDash([3,6]);
    this.c.moveTo(from.x,from.y);this.c.lineTo(to.x,to.y);this.c.strokeStyle='rgba(62,125,104,.48)';this.c.lineWidth=2;this.c.stroke();
    if(this.c.setLineDash)this.c.setLineDash([]);
    if(ART_ASSETS.ui_gesture_hand)this.scene.sprite('ui_gesture_hand',[x-size*tip[0],y-size*tip[1],size,size],createArtTransform());
    else this.circle(x,y,9,'rgba(255,245,214,.94)','#3b7770');
    const text=tutorial.source==='pop'?'拖到装杯入口':'拖到出货入口',width=text.length*11+12;
    const tx=Math.max(width/2+8,Math.min(ui.viewport.width-width/2-8,from.x));
    this.box(tx-width/2,from.y-48,width,22,7,'rgba(255,250,232,.96)');
    this.text(text,tx,from.y-37,11,'#286753',700,'center');
    this.c.restore();
  }
  emit(event){this.scene.emit(event);}
  draw(view,ui,dt=0){
    this.modalOpen=!!ui.modal;this.transferGhost=null;this.tutorialHand=null;this.transferReceipt=null;
    if(ui.modal&&ui.modal.type==='showroom'){
      this.scene.update(dt);this.showroom.draw(view,ui,dt);return;
    }
    this.interface.draw(view,ui,dt);
  }
  actionAt(x,y) {
    for(let i=this.zones.length-1;i>=0;i--){const z=this.zones[i];if(x>=z.x&&x<=z.x+z.w&&y>=z.y&&y<=z.y+z.h)return z.action;}
    return null;
  }
}

module.exports={Renderer};
