'use strict';
const { CONFIG, formatNumber: num } = require('./core');
const { ProductionScene, PRODUCTION_FORMS } = require('./production-scene');
const { GameInterface } = require('./interface');
const C = { ink:'#283e32', muted:'#849084', white:'#fffdf7' };
const FONT = '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
const rate = n => n>0&&n<10?Number(n.toFixed(2)).toString():num(n);
class Renderer {
  constructor(ctx) { this.c=ctx; this.zones=[]; this.floats=[]; this.notice=null; this.queuedBurstNotice=null; this.guideAction=''; this.scene=new ProductionScene(ctx);this.interface=new GameInterface(this);this.viewport=null; }
  box(x,y,w,h,r=14,fill=C.white,stroke) { const c=this.c; c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath(); if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();} }
  text(s,x,y,size=14,color=C.ink,weight=400,align='left') { const c=this.c;c.font=`${weight} ${size}px ${FONT}`;c.fillStyle=color;c.textAlign=align;c.textBaseline='middle';c.fillText(String(s),x,y); }
  wrap(s,x,y,width,size=14,color=C.muted,line=24) { const c=this.c;c.font=`400 ${size}px ${FONT}`;let str='',n=0;for(const char of String(s)){if(char==='\n'||c.measureText(str+char).width>width){this.text(str,x,y+n*line,size,color);str=char==='\n'?'':char;n++;}else str+=char;}if(str)this.text(str,x,y+n*line,size,color);return(n+1)*line; }
  circle(x,y,r,fill,stroke){const c=this.c;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.stroke();}}
  line(x,y,xx,yy,color=C.ink,width=2){const c=this.c;c.beginPath();c.moveTo(x,y);c.lineTo(xx,yy);c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.stroke();}
  hit(x,y,w,h,action) { this.zones.push({x,y,w,h,action}); }
  rewardStatus(v,kind) { const offer=v.rewards[kind];if(offer.available)return '';if(offer.reason==='intro-first')return `营业 ${Math.ceil(Math.max(0,CONFIG.rewardUnlockSeconds-v.state.playedSeconds))} 秒后开放`;return ({'brand-machine-required':'电热锅解锁后开放','brand-stage-cap':'换代后解锁更多等级','brand-max-level':'合作已满级','orders-required':'先完成所需订单','already-affordable':'金币已足够换代','production-required':'先提升自动收益','order-not-ready':'订单完成后开放','no-offline-reward':'暂无离线收益'})[offer.reason]||'暂不可用'; }
  arrow(x,y,s=22,color=C.ink) { const c=this.c;c.save();c.translate(x,y);c.scale(s/24,s/24);this.line(5,12,19,12,color,2);this.line(14,6,20,12,color,2);this.line(14,18,20,12,color,2);c.restore(); }
  popcorn(x,y,r=5,angle=0) { const c=this.c;c.save();c.translate(x,y);c.rotate(angle);this.circle(-r*.5,0,r*.66,'#fff8d5');this.circle(r*.4,-r*.35,r*.7,'#fffce9');this.circle(r*.45,r*.5,r*.65,'#ffeab0');this.circle(-r*.4,r*.55,r*.58,'#fff5c8');this.circle(-r*.05,r*.1,r*.36,'#f0c867');c.restore(); }
  emit(event) {
    this.scene.emit(event,this.lastView);
    if(event.type==='produce'||event.type==='burst') {
      if(event.source==='tap'){
        // Combine very rapid taps into one readable amount; each tap still animates the machine.
        const recent=this.floats.find(f=>f.kind==='tap'&&f.life>.55);
        if(recent){recent.amount+=event.amount;recent.text=`连点 +${rate(recent.amount)} 份`;recent.life=.8;}
        else this.floats.push({kind:'tap',amount:event.amount,text:`+${rate(event.amount)} 份`,life:.8});
      }
      if(event.type==='burst'){
        const notice={kind:'burst',title:`${event.perfect?'完美爆锅':'免费爆锅'} +${rate(event.amount)} 份`,text:`自动售出 +${rate(event.coins)} 金币${event.perfect?' · 含20%加成':''}`,life:2.4,perfect:!!event.perfect,bonusText:event.perfect?'火候额外 +'+rate(event.bonusAmount||0)+' 份':''};
        // Let the new production form land before showing the latest burst payout.
        if(this.notice&&this.notice.kind==='evolve')this.queuedBurstNotice=notice;
        else this.notice=notice;
      }
    }
    if(event.type==='evolve'){
      const stage=Number.isFinite(event.machine)?Math.max(0,Math.min(5,Math.floor(event.machine))):this.lastView&&this.lastView.state?this.lastView.state.machine:1;
      const form=PRODUCTION_FORMS[stage],hasIncome=Number.isFinite(event.incomeBefore)&&event.incomeBefore>0&&Number.isFinite(event.incomeAfter);
      const growth=hasIncome?' · 自动金币 ×'+Number((event.incomeAfter/event.incomeBefore).toFixed(2)):'';
      if(this.notice&&this.notice.kind==='burst')this.queuedBurstNotice=this.notice;
      this.notice={kind:'evolve',title:'第 '+(stage+1)+' 代 · '+form.unit,text:form.rhythm+growth,life:3.2,perfect:false,bonusText:''};
    }
    if(this.floats.length>8)this.floats.splice(0,this.floats.length-8);
  }
  update(dt,noticeVisible=true) {
    if(this.notice&&noticeVisible){
      this.notice.life-=dt;
      if(this.notice.life<=0){this.notice=this.queuedBurstNotice;this.queuedBurstNotice=null;}
    }
    for(const f of this.floats)f.life-=dt;
    this.floats=this.floats.filter(f=>f.life>0);
  }
  draw(view,ui,dt) {
    this.lastView=view;
    this.viewport=ui.viewport;
    this.update(dt,!ui.toast&&!ui.modal&&!ui.startup&&!ui.adBusy);
    this.interface.draw(view,ui,dt);
  }
  duration(seconds){const m=Math.floor(seconds/60);return m>=60?`${Math.floor(m/60)} 小时 ${m%60} 分钟`:`${m} 分钟`;}
  actionAt(x,y){for(let i=this.zones.length-1;i>=0;i--){const z=this.zones[i];if(x>=z.x&&x<=z.x+z.w&&y>=z.y&&y<=z.y+z.h)return z.action;}return null;}
}
module.exports={Renderer};



