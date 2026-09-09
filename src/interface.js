'use strict';

const { formatNumber: num } = require('./core');
const C={ink:'#334237',muted:'#727968',paper:'#f5eedc',white:'#fffaf0',green:'#38654d',mint:'#e0e9d5',yellow:'#efc45b',orange:'#966330',line:'#d5d9bd'};
const HEALTH=['抵制不良游戏，拒绝盗版游戏。','注意自我保护，谨防受骗上当。','适度游戏益脑，沉迷游戏伤身。','合理安排时间，享受健康生活。'];
const rate=n=>Number.isFinite(n)?Number(n.toFixed(n<10?2:1)).toString():'0';
const finite=n=>Number.isFinite(n)?n:0;
const statusText=s=>({running:'● 加工中',blocked:'Ⅱ 等下游空位',waiting:'… 等上游供料'})[s]||'等待';

class GameInterface {
  constructor(renderer){this.r=renderer;this.layout=null;}
  text(s,x,y,size=14,color=C.ink,weight=500,align='left'){this.r.text(s,x,y,size,color,weight,align);}
  ellipsis(s,width,size=14){s=String(s);this.r.c.font=`500 ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;if(this.r.c.measureText(s).width<=width)return s;while(s.length&&this.r.c.measureText(s+'…').width>width)s=s.slice(0,-1);return s+'…';}
  label(s,x,y,width,size=14,color=C.ink,weight=500,align='left'){this.text(this.ellipsis(s,width,size),x,y,size,color,weight,align);}
  box(x,y,w,h,fill=C.white,stroke,r=14){this.r.box(x,y,w,h,r,fill,stroke);}
  button(x,y,w,label,action,{fill=C.green,color=C.white,disabled=false,h=44,size=14}={}){
    this.box(x,y,w,h,disabled?'#e5e4d5':fill);
    this.label(label,x+w/2,y+h/2,w-12,size,disabled?C.muted:color,700,'center');
    if(!disabled)this.r.hit(x,y,w,h,action);
  }
  progress(x,y,w,h,value,fill=C.green,back='#dbdfca'){this.box(x,y,w,h,back,undefined,h/2);if(value>0)this.box(x,y,w*Math.min(1,value),h,fill,undefined,h/2);}
  draw(v,ui,dt=0){
    const r=this.r;this.w=ui.viewport.width;this.h=ui.viewport.height;r.zones=[];
    const safe=Math.max(finite(ui.viewport.safeTop),ui.viewport.menuBottom?finite(ui.viewport.menuBottom)+5:0);
    this.top=Math.max(10,safe+5);this.short=this.h-this.top<530;
    r.c.clearRect(0,0,this.w,this.h);this.box(0,0,this.w,this.h,C.paper,undefined,0);
    r.scene.update(dt);this.home(v,ui);
    if(ui.modal&&ui.modal.type!=='station'){r.c.fillStyle='rgba(40,51,38,.3)';r.c.fillRect(0,0,this.w,this.h);this.sheet(v,ui);}
  }
  home(v,ui){
    const r=this.r,w=this.w,h=this.h,top=this.top,selected=ui.modal?.type==='station'?ui.modal.stationId:null;
    const short=this.short,headerH=short?54:96;
    if(!short){
      this.text('小小爆米花厂',16,top+14,21,C.ink,800);
      this.label('第 '+(finite(v.state.machine)+1)+' 代 · '+v.machine.name,17,top+37,w-82,12,C.muted);
    }
    const moneyY=top+(short?13:62),coinW=short?w*.34:w*.45;
    r.circle(23,moneyY,8,C.yellow);this.text('金',23,moneyY,10,C.orange,700,'center');
    this.label(num(v.state.coins),37,moneyY,coinW-26,short?19:25,C.ink,800);
    const end=short?w-63:w-16;
    this.label('实际出货 '+rate(v.throughput)+' 份/秒',end,moneyY-3,short?w*.43:w*.49,short?12:14,C.green,750,'right');
    const updating=v.state.simulation.ticks<finite(ui.rateUpdatingUntil)||v.state.playedSeconds<10;
    this.label(v.state.playedSeconds<10?'实测 · 开工不足10秒':updating||v.insights?.sampling.updating?'近10秒均速 · 更新中':'最近10秒均速',end,moneyY+14,short?w*.43:w*.49,11,C.muted,500,'right');
    this.button(w-56,top,44,'⚙','settings',{fill:'#e4e7d3',color:C.green,size:21});
    const bottleneck=v.insights?.bottleneck;
    const hint=ui.toast||(bottleneck?.label||'观察供料与积压，寻找生产限制');
    this.label(hint,16,top+headerH-8,w-32,12,ui.toast?C.green:C.orange,650);
    const collapsed=selected&&ui.stationCollapsed;
    const dockH=selected?(collapsed?52:short?160:202):(short?158:174);
    const dockY=h-dockH-4,sceneY=top+headerH,sceneH=dockY-sceneY-4;
    const presented={...v,presentation:{selectedStationId:selected}};
    r.scene.draw(8,sceneY,w-16,sceneH,presented);
    this.layout={header:{x:8,y:top,w:w-16,h:headerH},scene:{x:8,y:sceneY,w:w-16,h:sceneH},goal:{x:8,y:dockY,w:w-16,h:dockH},dock:{x:8,y:dockY,w:w-16,h:dockH}};
    for(const frame of r.scene.stationFrames){
      const s=v.stations.find(item=>item.id===frame.id),room=frame.x+frame.w-frame.textX-10,compact=frame.h<90;
      this.label((selected===s.id?'▸ ':'')+s.name,frame.textX,frame.y+(compact?13:24),room,compact?15:19,C.ink,800);
      this.label(statusText(s.status),frame.textX,frame.y+(compact?32:50),room,12,s.status==='running'?C.green:C.orange,600);
      if(frame.h>=90){
        const tag=selected===s.id?'已选中 · 下方比较':bottleneck?.stationId===s.id?'限制产出 · 点此改造':'点击查看改造';
        this.label(tag,frame.textX,frame.y+frame.h-19,room,12,C.muted);
      }
      const hitH=Math.max(44,frame.h);r.hit(frame.x,frame.y+(frame.h-hitH)/2,frame.w,hitH,'station:'+s.id);
    }
    if(selected)this.station(v,ui,dockY,dockH);
    else this.goal(v,dockY,dockH);
  }
  goal(v,y,height){
    const x=8,w=this.w-16,next=v.expansion;
    this.box(x,y,w,height,C.white,C.line,16);
    if(!next){this.text('六代生产线已落成',x+12,y+24,17,C.green,800);this.label('继续改造各工位，改善整线配合',x+12,y+53,w-24,13,C.muted);this.label('累计出货 '+num(v.state.totalSold)+' 份',x+12,y+84,w-24,14,C.green);return;}
    const changes=next.bufferChanges||[],unlocks=next.unlocks||[];
    this.label('扩建目标 · '+next.name,x+12,y+18,w-24,14,C.ink,800);
    const stocks=changes.length?changes.map(b=>(b.id==='pop'?'待装':'待发')+' '+num(b.before)+'→'+num(b.after)).join(' · '):'扩建增加两处库存仓位';
    this.label(stocks+' 份',x+12,y+40,w-24,12,C.ink,600);
    const names=unlocks.map(u=>typeof u==='string'?u:u.name).filter(Boolean);
    this.label('开放：'+(names.slice(0,2).join('、')||next.description),x+12,y+57,w-24,12,C.green);
    if(names.length>2)this.label('以及'+names.slice(2).join('、'),x+12,y+74,w-24,12,C.green);
    this.label('扩建开放改造，设备提速需另行购买',x+12,y+92,w-24,12,C.orange,600);
    const buttonY=y+height-52,buttonW=112,infoW=w-buttonW-34;
    const sold=Math.min(v.state.totalSold,next.requiredSold);
    this.label('出货 '+num(sold)+' / '+num(next.requiredSold),x+12,buttonY+8,infoW,11,C.muted);
    const reason=!next.rateReached?'均速需达 '+rate(next.targetRate)+' 份/秒':sold<next.requiredSold?'均速已达标 · 等销量':!next.canAfford?'还差 '+num(next.cost-v.state.coins)+' 金币':'✓ 扩建条件已齐';
    this.label(reason,x+12,buttonY+25,infoW,11,next.ready?C.green:C.muted);
    this.progress(x+12,buttonY+40,infoW,3,sold/Math.max(1,next.requiredSold));
    this.button(x+w-buttonW-10,buttonY,buttonW,num(next.cost)+' 金币扩建','evolve',{disabled:!next.ready||!next.canAfford,size:12});
  }
  station(v,ui,y,height){
    const id=ui.modal.stationId,s=v.stations.find(item=>item.id===id);if(!s)return;
    const x=8,w=this.w-16,short=this.short;
    this.box(x,y,w,height,C.white,C.line,16);
    if(ui.stationCollapsed){
      const label=ui.purchaseFeedback?.stationId===id?'✓ '+ui.purchaseFeedback.name+'已安装':s.name+' · 已选中';
      this.button(x+4,y+4,92,'查看下档','reviewUpgrade',{fill:C.mint,color:C.green,size:12});
      this.label(label,x+104,y+17,w-158,12,C.green,750);
      this.label('生产继续 · 观察库存',x+104,y+36,w-158,11,C.muted);
      this.button(x+w-48,y+4,44,'×','close',{fill:C.mint,color:C.green,size:22});return;
    }
    const tabW=(w-100)/3;
    v.stations.forEach((item,i)=>this.button(x+4+i*tabW,y+2,tabW,item.name,'station:'+item.id,{fill:id===item.id?C.green:C.white,color:id===item.id?C.white:C.muted,size:13}));
    this.button(x+w-96,y+2,44,ui.stationDetails?'概览':'详情','toggleDetails',{fill:C.mint,color:C.green,size:12});
    this.button(x+w-48,y+2,44,'⌄','collapseStation',{fill:C.mint,color:C.green,size:22});
    const up=s.upgrade,buttonY=y+height-48,contentY=y+55;
    const quote=ui.quote,valid=quote&&quote.stationId===id&&quote.level===s.level+1;
    if(ui.stationDetails){
      this.label(s.lanes+' 头并行 · '+s.batchSize+' 份/批 · 在制 '+num(s.inFlight)+' 份',x+12,contentY,w-24,12,C.ink,650);
      this.label('实测通过 '+rate(s.actualRate)+' 份/秒（近10秒）',x+12,contentY+19,w-24,12,C.green);
      const why=s.status==='blocked'?'批次完成，等待下游仓位腾空':s.status==='waiting'?'等待上游凑齐 '+s.batchSize+' 份才开工':'按真实供料与剩余仓位加工';
      this.label(why,x+12,contentY+38,w-24,12,C.muted);
      if(!short){this.label(v.insights?.bottleneck?.reason||'持续观察实际供料和库存',x+12,contentY+59,w-24,12,C.orange);this.label('预计值：同规则副本推演，按当前设备配合',x+12,contentY+79,w-24,12,C.muted);}
    }else if(up){
      this.label(up.name+' · 能力 '+rate(s.capacity)+'→'+rate(up.capacity)+'份/秒',x+12,contentY,w-24,13,C.ink,700);
      this.label((up.lineRequiresExpansion?'扩建后预计出货 ≈ ':'预计稳定出货 ≈ ')+rate(up.lineBefore)+'→'+rate(up.lineAfter)+' 份/秒',x+12,contentY+20,w-24,13,C.green,750);
      const improvement=up.lineImproves?'供料与库存稳定后体现，实测见顶部':'暂不提高稳定出货，为后续改造预留能力';
      this.label(improvement,x+12,contentY+40,w-24,12,C.orange,600);
      if(!short){this.label('设备能力单位：份/秒 · 预测含批次与仓位',x+12,contentY+65,w-24,12,C.muted);this.label('改造后由真实生产逐步消化积压',x+12,contentY+83,w-24,12,C.muted);}
    }else{
      this.label(s.name+'已完成全部改造',x+12,contentY,w-24,14,C.green,750);
      this.label('现有能力 '+rate(s.capacity)+' 份/秒',x+12,contentY+21,w-24,13,C.ink);
      this.label('可切换其他工位，继续优化整线',x+12,contentY+40,w-24,12,C.muted);
    }
    const priceW=96,buttonW=w-priceW-28;
    this.label(up?num(valid?quote.cost:up.cost)+' 金币':'已满级',x+12,buttonY+22,priceW,15,C.ink,800);
    let label='购买改造',disabled=!up||!up.available||!valid;
    if(!up)label='本工位已满级';
    else if(!valid)label='请重新查看报价';
    else if(up.reason==='machine-required')label='需先扩建至第 '+(up.requiredMachine+1)+' 代';
    else if(up.reason==='not-enough-coins')label='还差 '+num(Math.max(0,quote.cost-v.state.coins))+' 金币';
    this.button(x+priceW+16,buttonY,buttonW,label,up?'upgrade:'+id+':'+(s.level+1):'noop',{disabled,size:12});
  }
  sheet(v,ui){
    const r=this.r,w=this.w,type=ui.modal.type,available=this.h-this.top-4;
    const height=Math.min(type==='restart'?270:414,available),y=this.h-height-4;this.sheetY=y;r.zones=[];
    this.box(8,y,w-16,height,C.white,undefined,20);
    this.text(type==='restart'?'重新开始新工厂':'工厂设置',24,y+25,19,C.ink,800);
    this.button(w-56,y+4,44,'×','close',{fill:C.mint,color:C.green,size:23});
    if(type==='restart')this.restart(y,height);else this.settings(v,y,height);
    // Keep storage/purchase errors readable even when a native safe area makes
    // the settings sheet cover the home status line. This slot is always reserved.
    if(ui.toast)this.label(ui.toast,24,y+44,w-84,11,C.orange,600);
  }
  settings(v,y,height){
    const x=24,w=this.w-48,settings=v.state.settings||{};
    this.button(x,y+54,w,'声音 · '+(settings.sound?'开启':'关闭'),'setting:sound',{fill:C.mint,color:C.green});
    this.button(x,y+106,w,'振动 · '+(settings.haptics?'开启':'关闭'),'setting:haptics',{fill:C.mint,color:C.green});
    this.label('2.0 三段生产线 · 仅出货结算金币',x,y+171,w,12,C.ink);
    this.label('进度自动保存 · 离开期间生产暂停',x,y+191,w,12,C.muted);
    this.label('玩法已重构，本版本从新工厂开始',x,y+215,w,12,C.muted);
    this.label('旧存档保留，不读取、不迁移、不改写',x,y+235,w,12,C.muted);
    const healthY=y+258;for(let i=0;i<HEALTH.length;i++)this.label(HEALTH[i],x,healthY+i*17,w,11,C.muted);
    this.button(x,y+height-52,w,'重新开始本版本工厂','restart',{fill:'#efe0ca',color:C.orange,size:13});
  }
  restart(y,height){
    const x=24,w=this.w-48;
    this.r.wrap('将重新开始本版本的金币、设备和生产进度。\n旧版本工厂存档仍会保留。',x,y+74,w,14,C.ink,24);
    this.button(x,y+height-102,w,'确认，重新开始新工厂','confirmRestart',{fill:'#ab654e'});
    this.button(x,y+height-52,w,'保留进度','close',{fill:C.mint,color:C.green});
  }
}

module.exports={GameInterface};
