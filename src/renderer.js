'use strict';

const { ProductionScene } = require('./production-scene');
const { GameInterface } = require('./interface');
const FONT = '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif';

// Presentation owns pixels and hit regions only. All stock, movement progress and
// money displayed below come from the single production simulation snapshot.
class Renderer {
  constructor(ctx) {
    this.c=ctx;this.zones=[];this.scene=new ProductionScene(ctx);this.interface=new GameInterface(this);
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
  emit(event){this.scene.emit(event);}
  draw(view,ui,dt=0){this.interface.draw(view,ui,dt);}
  actionAt(x,y) {
    for(let i=this.zones.length-1;i>=0;i--){const z=this.zones[i];if(x>=z.x&&x<=z.x+z.w&&y>=z.y&&y<=z.y+z.h)return z.action;}
    return null;
  }
}

module.exports={Renderer};
