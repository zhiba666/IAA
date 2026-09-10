'use strict';

const { ProductionScene } = require('./production-scene');
const { FirstGenerationScene } = require('./first-generation-scene');
const { GameInterface } = require('./interface');
const FONT = '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif';

// Presentation owns pixels and hit regions only. All stock, movement progress and
// money displayed below come from the single production simulation snapshot.
class Renderer {
  constructor(ctx, art) {
    this.c=ctx;this.art=art;this.zones=[];this.scene=new FirstGenerationScene(ctx,art);this.interface=new GameInterface(this);
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
  drawTransfer(view,ui){
    this.transferGhost=null;
    const held=ui.transfer;
    if(!(view.transfer?.enabled||view.mode==='v15')||!held?.dragging||!(held.amount>0)||!Number.isFinite(held.x)||!Number.isFinite(held.y)||ui.modal&&ui.modal.type!=='station')return;
    const w=76,h=44,x=Math.max(8,Math.min(ui.viewport.width-w-8,held.x+22));
    const y=Math.max(this.interface.top,Math.min(ui.viewport.height-h-8,held.y-h-24));
    const transfer=view.mode==='v15'?view.transfers.find(item=>item.source===held.source):view.transfer;
    if(!transfer)return;
    const full=transfer.inputAmount>=transfer.inputCapacity,ready=held.overTarget&&!full;
    this.transferGhost={x,y,w,h,amount:held.amount,source:held.source||'pop',target:held.target||'cup'};
    this.c.save();this.c.globalAlpha=.94;
    this.box(x,y,w,h,10,'#fff3c9',ready?'#277860':'#ad8842');
    if(held.source==='cup')this.scene.cup(x+15,y+16,1,.4);
    else this.scene.popcorn(x+15,y+15,6);
    this.text(held.amount+' 份',x+w/2+8,y+15,14,'#66502a',700,'center');
    this.text(full?'入口已满':ready?'松手放入':held.target==='ship'?'拖向出货入口':'拖向装杯入口',x+w/2,y+33,10,'#527052',600,'center');
    this.c.restore();
  }
  emit(event){this.scene.emit(event);}
  draw(view,ui,dt=0){this.interface.draw(view,ui,dt);}
  actionAt(x,y) {
    for(let i=this.zones.length-1;i>=0;i--){const z=this.zones[i];if(x>=z.x&&x<=z.x+z.w&&y>=z.y&&y<=z.y+z.h)return z.action;}
    return null;
  }
}

module.exports={Renderer};
