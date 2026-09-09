'use strict';

const { formatNumber: num } = require('./core');
const C={ink:'#283e32',muted:'#75816d',paper:'#f7f5ea',white:'#fffdf7',green:'#366348',mint:'#deebd5',yellow:'#f4ca58',orange:'#ba8433',line:'#dce3d2'};
const HEALTH=['抵制不良游戏，拒绝盗版游戏。','注意自我保护，谨防受骗上当。','适度游戏益脑，沉迷游戏伤身。','合理安排时间，享受健康生活。'];
const rate=n=>Number.isFinite(n)?Number(n.toFixed(n<10?2:1)).toString():'0';
const finite=n=>Number.isFinite(n)?n:0;
const statusText=s=>({running:'运转中',blocked:'下游已满 · 暂停',waiting:'缺料等待'})[s]||'等待';
const statusColor=s=>s==='blocked'?C.orange:s==='waiting'?C.muted:C.green;

class GameInterface {
  constructor(renderer){this.r=renderer;this.layout=null;}
  text(s,x,y,size=14,color=C.ink,weight=500,align='left'){this.r.text(s,x,y,size,color,weight,align);}
  ellipsis(s,width,size=14){s=String(s);this.r.c.font=`500 ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;if(this.r.c.measureText(s).width<=width)return s;while(s.length&&this.r.c.measureText(s+'…').width>width)s=s.slice(0,-1);return s+'…';}
  label(s,x,y,width,size=14,color=C.ink,weight=500,align='left'){this.text(this.ellipsis(s,width,size),x,y,size,color,weight,align);}
  box(x,y,w,h,fill=C.white,stroke,r=14){this.r.box(x,y,w,h,r,fill,stroke);}
  button(x,y,w,label,action,{fill=C.green,color=C.white,disabled=false,h=44,size=14}={}){
    this.box(x,y,w,h,disabled?'#e3e7da':fill);
    this.label(label,x+w/2,y+h/2,w-16,size,disabled?C.muted:color,700,'center');
    if(!disabled)this.r.hit(x,y,w,h,action);
  }
  progress(x,y,w,h,value,fill=C.green,back='#dce5d3'){this.box(x,y,w,h,back,undefined,h/2);if(value>0)this.box(x,y,w*Math.min(1,value),h,fill,undefined,h/2);}
  draw(v,ui,dt=0){
    const r=this.r;this.w=ui.viewport.width;this.h=ui.viewport.height;r.zones=[];
    const safe=Math.max(finite(ui.viewport.safeTop),ui.viewport.menuBottom?finite(ui.viewport.menuBottom)+5:0);
    this.top=Math.max(12,safe+5);r.c.clearRect(0,0,this.w,this.h);this.box(0,0,this.w,this.h,C.paper,undefined,0);
    r.scene.update(dt);this.home(v,ui);
    if(ui.modal){r.c.fillStyle='rgba(31,48,36,.34)';r.c.fillRect(0,0,this.w,this.h);this.sheet(v,ui);}
    if(ui.toast){
      const yy=ui.modal?Math.max(this.top+56,this.sheetY-47):Math.max(this.top+58,this.layout.goal.y-45);
      this.box(14,yy,this.w-28,38,C.green);this.label(ui.toast,this.w/2,yy+19,this.w-46,12,C.white,600,'center');
    }
  }
  home(v,ui){
    const r=this.r,w=this.w,h=this.h,top=this.top;
    this.text('小小爆米花厂',16,top+9,20,C.ink,800);
    this.label('第 '+(finite(v.state.machine)+1)+' 代 · '+v.machine.name,17,top+29,w-75,11,C.muted);
    this.button(w-53,top-2,38,'⚙','settings',{fill:'#e8eddf',color:C.green,size:20,h:38});
    r.circle(23,top+52,8,C.yellow,'#d6b448');this.text('金',23,top+52,9,'#977126',700,'center');
    this.label(num(v.state.coins),37,top+51,w*.43,23,C.ink,800);
    this.label('出货 '+rate(v.throughput)+' 份/秒',w-16,top+47,w*.45,13,C.green,750,'right');
    this.label('每份 '+rate(v.price)+' 金币',w-16,top+63,w*.45,10,C.muted,500,'right');
    let sceneY=top+77;
    if(ui.newFactory){
      const bh=42;this.box(12,sceneY-3,w-24,bh,'#ece9d7');
      this.label('生产线已重构，从新工厂开始。',23,sceneY+10,w-70,11,C.ink,650);
      this.label('旧工厂存档仍保留。',23,sceneY+26,w-70,10,C.muted);
      this.button(w-49,sceneY-2,34,'×','dismissIntro',{fill:'#ece9d7',color:C.muted,h:38,size:21});sceneY+=bh+3;
    }
    const goalH=h<600?103:115,goalY=h-goalH-10,sceneH=Math.max(168,goalY-10-sceneY);
    r.scene.draw(12,sceneY,w-24,sceneH,v);
    this.layout={header:{x:12,y:top,w:w-24,h:70},scene:{x:12,y:sceneY,w:w-24,h:sceneH},goal:{x:12,y:goalY,w:w-24,h:goalH}};
    const highlighted=v.onboarding&&v.onboarding.stationId;
    for(const frame of r.scene.stationFrames){
      const station=v.stations.find(item=>item.id===frame.id),compact=frame.h<88,room=frame.x+frame.w-frame.textX-11;
      const titleY=frame.y+(compact?11:19),rateY=frame.y+(compact?frame.h*.51:48),actualY=frame.y+(compact?frame.h*.81:69);
      this.label(station.name,frame.textX,titleY,room*.48,compact?13:16,C.ink,800);
      this.label(statusText(station.status),frame.x+frame.w-11,titleY,room*.52,compact?9:10,statusColor(station.status),650,'right');
      this.label('能力 '+rate(station.capacity)+' 份/秒',frame.textX,rateY,room,compact?11:13,C.muted,550);
      this.label('实际 '+rate(station.actualRate)+' 份/秒',frame.textX,actualY,room,compact?11:14,C.green,750);
      if(frame.h>=110)this.label(station.lanes+' 工位并行 · '+station.batchSize+' 份/批',frame.textX,frame.y+93,room,11,C.muted);
      if(frame.h>=140)this.label('点击设备查看改造 ›',frame.textX,frame.y+frame.h-20,room,11,C.green,600);
      r.hit(frame.x,frame.y,frame.w,frame.h,'station:'+station.id);
      if(highlighted===station.id){
        const phase=v.onboarding.phase;
        const hint=v.onboarding.hint;
        if(frame.h>=109){
          const yy=frame.y+frame.h-23;
          this.box(frame.textX-4,yy-11,room+5,22,'#fff0bf',undefined,6);
          this.label('‹ '+hint,frame.textX+2,yy,room-8,10,'#956b25',650);
        }else{
          // A compact pointer stays attached to the real cup machine. No modal
          // queue interrupts the automatically running line.
          const yy=frame.y+frame.h-8;
          this.box(frame.x+10,yy-7,Math.max(40,frame.artW-12),14,'#fff0bf',undefined,5);
          this.label(phase==='observe'?'留意积压 ↑':phase==='improved'?'已提速 ↑':'点此改造 ↑',frame.x+frame.artW/2+3,yy,frame.artW-17,9,'#956b25',750,'center');
        }
      }
    }
    this.goal(v,goalY,goalH);
  }
  goal(v,y,height){
    const x=12,w=this.w-24,next=v.expansion,compact=height<110;
    this.box(x,y,w,height,C.white,C.line,18);
    if(!next){
      this.text('六代生产线已落成',x+13,y+23,16,C.green,800);
      this.label('继续改造工位，让整条线配合得更顺畅',x+13,y+49,w-26,12,C.muted);
      this.label('累计出货 '+num(v.state.totalSold)+' 份',x+13,y+height-22,w-26,14,C.green,700);return;
    }
    this.label('扩建 · '+next.name,x+13,y+18,w-26,14,C.ink,800);
    const required=Math.max(1,finite(next.requiredSold)),sold=Math.min(finite(v.state.totalSold),required);
    this.label('出货 '+num(sold)+' / '+num(required)+' 份',x+13,y+40,w-26,11,C.muted);
    this.progress(x+13,y+53,w-26,4,sold/required);
    const buttonW=this.w<350?104:124,buttonH=compact?33:39,buttonY=y+height-buttonH-10;
    const reached=next.rateReached===true;
    this.label('达到 '+rate(next.targetRate)+' 份/秒'+(reached?' ✓':''),x+13,buttonY+10,w-buttonW-39,11,reached?C.green:C.muted,600);
    const remaining=next.ready?'目标已达成':!reached?'提升实际出货速度':sold<required?'继续出货，积累销量':'扩建需 '+num(next.cost)+' 金币';
    this.label(remaining,x+13,buttonY+26,w-buttonW-39,10,C.muted);
    this.button(x+w-buttonW-11,buttonY,buttonW,num(next.cost)+' 金币扩建','evolve',{fill:C.green,disabled:!next.ready||!next.canAfford,h:buttonH,size:12});
  }
  sheet(v,ui){
    const r=this.r,w=this.w,type=ui.modal.type,available=this.h-this.top-14;
    const desired=type==='station'?405:type==='settings'?427:270;
    const height=Math.min(desired,available),y=Math.max(this.top,this.h-height-12);this.sheetY=y;r.zones=[];
    // Tapping the dimmed factory returns directly to its running line.
    if(y-this.top>=36)r.hit(8,this.top,w-16,y-this.top,'close');
    this.box(8,y,w-16,height,C.white,undefined,22);
    const titles={station:'工位改造',settings:'工厂设置',restart:'重新开始新工厂'};
    this.text(titles[type]||'工厂设置',25,y+29,20,C.ink,800);
    this.button(w-57,y+9,39,'×','close',{fill:'#eaf0e2',color:C.green,size:25,h:39});
    if(type==='station')this.station(v,ui.modal.stationId,y,height);
    else if(type==='restart')this.restart(y,height);
    else this.settings(v,y,height);
  }
  station(v,id,y,height){
    const s=v.stations.find(item=>item.id===id);if(!s)return;
    const x=25,w=this.w-50,compact=height<360,infoTop=y+59,artH=compact?77:103;
    this.box(x,infoTop,w,artH,'#e7eddd');this.r.scene.drawStationArtwork(x+7,infoTop+4,w*.41,artH-8,s,v.state.machine);
    const tx=x+w*.45,tw=w*.55-10;
    this.label(s.name,tx,infoTop+19,tw,18,C.ink,800);
    this.label(statusText(s.status),tx,infoTop+43,tw,12,statusColor(s.status),650);
    if(!compact)this.label(s.lanes+' 工位并行 · '+s.batchSize+' 份/批',tx,infoTop+69,tw,11,C.muted);
    const statsY=infoTop+artH+22;
    this.label('设备能力',x,statsY,w*.55,12,C.muted);
    this.text(rate(s.capacity)+' 份/秒',x+w,statsY,16,C.ink,750,'right');
    this.label('实际通过',x,statsY+27,w*.55,12,C.muted);
    this.text(rate(s.actualRate)+' 份/秒',x+w,statsY+27,16,C.green,750,'right');
    const explanation=s.status==='blocked'?'下游库存已满，这台设备正在等空位。':s.status==='waiting'?'正在等上游供料，空闲能力不会变成收入。':'按实际供料和下游空间运转，出货时才入账。';
    if(!compact)this.label(explanation,x,statsY+54,w,11,C.muted);
    const upgrade=s.upgrade,buttonY=y+height-55;
    if(upgrade){
      const detailY=buttonY-(compact?48:56);
      this.label(upgrade.name||'改造'+s.name,x,detailY,w,14,C.green,750);
      this.label('能力 '+rate(s.capacity)+' → '+rate(upgrade.capacity)+' 份/秒',x,detailY+22,w,12,C.ink,600);
      if(!compact&&upgrade.lanes!==s.lanes)this.label('并行工位 '+s.lanes+' → '+upgrade.lanes,x,detailY+39,w,10,C.muted);
      else if(!compact&&upgrade.batchSize!==s.batchSize)this.label('每批 '+s.batchSize+' → '+upgrade.batchSize+' 份',x,detailY+39,w,10,C.muted);
      let label='花 '+num(upgrade.cost)+' 金币改造';
      if(!upgrade.available)label=upgrade.reason==='not-enough-coins'?'还差 '+num(Math.max(0,upgrade.cost-v.state.coins))+' 金币':upgrade.reason==='machine-required'?'扩建后开放':upgrade.reason==='max-level'?'本工位已完成全部改造':'需先扩建生产线';
      this.button(x,buttonY,w,label,'upgrade:'+s.id,{disabled:!upgrade.available,h:42});
    }else{
      this.label('本工位已完成全部改造',x,buttonY-27,w,13,C.green,650);
      this.button(x,buttonY,w,'回到生产线','close',{fill:C.mint,color:C.green,h:42});
    }
  }
  settings(v,y,height){
    const x=25,w=this.w-50,settings=v.state.settings||{},short=height<410;
    this.button(x,y+62,w,'声音 · '+(settings.sound?'开启':'关闭'),'setting:sound',{fill:C.mint,color:C.green,h:40});
    this.button(x,y+110,w,'振动 · '+(settings.haptics?'开启':'关闭'),'setting:haptics',{fill:C.mint,color:C.green,h:40});
    this.label('进度自动保存 · 离开期间生产暂停',x,y+173,w,11,C.muted);
    this.label('只在最终出货后收入金币',x,y+193,w,11,C.muted);
    const healthY=y+(short?220:231),spacing=short?17:21;
    for(let i=0;i<HEALTH.length;i++)this.label(HEALTH[i],x,healthY+i*spacing,w,10,C.muted);
    this.button(x,y+height-57,w,'重新开始本版本工厂','restart',{fill:'#efe4d6',color:'#96613f',h:40,size:13});
  }
  restart(y,height){
    const x=25,w=this.w-50;
    this.r.wrap('将重新开始本版本的金币、设备和生产进度。\n旧版本工厂存档仍会保留。',x,y+79,w,14,C.ink,25);
    this.button(x,y+height-112,w,'确认，重新开始新工厂','confirmRestart',{fill:'#b3654f',h:43});
    this.button(x,y+height-58,w,'保留进度','close',{fill:C.mint,color:C.green,h:43});
  }
}

module.exports={GameInterface};
