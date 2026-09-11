'use strict';

const { formatNumber: num } = require('./core');
const { APP_VERSION } = require('./version');
const { drawNineSlice, drawArtLayer, createArtTransform } = require('./art-layout');
const C={ink:'#174e51',muted:'#727968',paper:'#f5eedc',white:'#fffaf0',green:'#38654d',mint:'#e0e9d5',yellow:'#efc45b',orange:'#966330',line:'#d5d9bd'};
const HEALTH=['抵制不良游戏，拒绝盗版游戏。','注意自我保护，谨防受骗上当。','适度游戏益脑，沉迷游戏伤身。','合理安排时间，享受健康生活。'];
const finite=n=>Number.isFinite(n)?n:0;
const rate=n=>Number.isFinite(n)?Number(n.toFixed(n<10?2:1)).toString():'0';
const clamp=(n,min,max)=>Math.max(min,Math.min(max,finite(n)));

// Overlay painting never changes a quote, reservation, inventory or camera.
class GameInterface {
  constructor(renderer){this.r=renderer;this.layout=null;this.artTheme=true;this.contentClip=null;}
  text(s,x,y,size=14,color=C.ink,weight=500,align='left'){this.r.text(s,x,y,size,color,weight,align);}
  ellipsis(s,width,size=14){s=String(s);this.r.c.font='500 '+size+'px "Microsoft YaHei", sans-serif';if(this.r.c.measureText(s).width<=width)return s;while(s.length&&this.r.c.measureText(s+'…').width>width)s=s.slice(0,-1);return s+'…';}
  label(s,x,y,width,size=14,color=C.ink,weight=500,align='left'){this.text(this.ellipsis(s,width,size),x,y,size,color,weight,align);}
  box(x,y,w,h,fill=C.white,stroke,r=14){this.r.box(x,y,w,h,r,fill,stroke);}
  panel(id,x,y,w,h,fill=C.white,stroke=C.line,radius=14){if(!drawNineSlice(this.r.c,this.r.art,id,[x,y,w,h],{border:10}))this.box(x,y,w,h,fill,stroke,radius);}
  icon(id,x,y,size){return drawArtLayer(this.r.c,this.r.art,{id:'ui_icon_'+id,rect:[x,y,size,size]},createArtTransform());}
  badge(id,x,y,size){return drawArtLayer(this.r.c,this.r.art,{id:'ui_badge_'+id,rect:[x,y,size,size]},createArtTransform());}
  hit(x,y,w,h,action){
    const clip=this.contentClip;
    // Partly hidden purchase buttons cannot receive a misleading tap.
    if(clip&&(x<clip.x||y<clip.y||x+w>clip.x+clip.w||y+h>clip.y+clip.h))return;
    this.r.hit(x,y,w,h,action);
  }
  button(x,y,w,label,action,{fill=C.green,color=C.white,disabled=false,h=44,size=14,icon=null}={}){
    this.panel(disabled?'ui_button_disabled':fill===C.green?'ui_button_primary':'ui_button_secondary',x,y,w,h,disabled?'#e5e4d5':fill,undefined);
    const hasIcon=icon&&this.icon(icon,x+8,y+(h-18)/2,18);
    const textColor=disabled?C.muted:fill===C.green||color===C.white?C.ink:color;
    this.label(label,x+(w+(hasIcon?20:0))/2,y+h/2,w-(hasIcon?32:12),size,textColor,700,'center');
    if(!disabled)this.hit(x,y,w,h,action);
  }
  lines(value,width,size=13){
    this.r.c.font='500 '+size+'px "Microsoft YaHei", sans-serif';const lines=[];let line='';
    for(const char of String(value)){if(char==='\n'||line&&this.r.c.measureText(line+char).width>width){lines.push(line);line=char==='\n'?'':char;}else line+=char;}
    if(line||!lines.length)lines.push(line);return lines;
  }
  artReport(){const art=this.r.art;return art?(typeof art.report==='function'?art.report():art.report)||{}:{};}
  overlay(viewport){
    const w=this.w,h=this.h,left=clamp(viewport.safeLeft,0,w/3),right=clamp(viewport.safeRight,0,w/3);
    const bottom=clamp(viewport.safeBottom,0,h/3),safeTop=clamp(viewport.safeTop,0,h/2),menu=viewport.menuButton;
    const menuBottom=clamp(menu?menu.bottom:viewport.menuBottom,0,h/2);
    this.top=Math.max(10,safeTop+8,menuBottom?menuBottom+8:0);
    const x=left+12,end=w-right-12,bottomY=h-bottom-68;
    const hud={coin:{x,y:this.top,w:Math.min(134,end-x-58),h:42},rate:{x,y:this.top+44,w:Math.max(120,end-x-58),h:26},
      settings:{x:end-44,y:this.top,w:44,h:44},status:{x,y:bottomY,w:Math.max(44,end-x-124),h:56},
      logistics:{x:end-116,y:bottomY,w:54,h:56},expansion:{x:end-54,y:bottomY,w:54,h:56}};
    this.safe={x:left+8,y:this.top,w:w-left-right-16,h:Math.max(120,h-bottom-8-this.top)};
    const overlayLayout={topInset:this.top+76,bottomInset:bottom+76,leftInset:left+12,rightInset:right+12,
      exclusionRects:Object.keys(hud).map(key=>Object.assign({id:key},hud[key]))};
    this.layout={scene:{x:0,y:0,w,h},hud,overlayLayout};return overlayLayout;
  }
  draw(v,ui,dt=0){
    const r=this.r;this.w=ui.viewport.width;this.h=ui.viewport.height;r.zones=[];this.contentClip=null;
    const overlayLayout=this.overlay(ui.viewport);
    r.c.clearRect(0,0,this.w,this.h);this.box(0,0,this.w,this.h,C.paper,undefined,0);r.scene.update(dt);
    const presented=Object.assign({},v,{presentation:Object.assign({},v.presentation||{},
      {selectedStationId:ui.modal&&ui.modal.type==='station'?ui.modal.stationId:null,transfer:ui.modal?null:ui.transfer,press:ui.modal?null:ui.press,
        viewport:ui.viewport,safeArea:{top:finite(ui.viewport.safeTop),bottom:finite(ui.viewport.safeBottom),left:finite(ui.viewport.safeLeft),right:finite(ui.viewport.safeRight)},overlayLayout})});
    r.scene.draw(0,0,this.w,this.h,presented);
    for(const frame of r.scene.stationFrames||[])r.hit(frame.x,frame.y,frame.w,frame.h,'station:'+frame.id);
    for(const frame of r.scene.transferFrames||[])r.hit(frame.x,frame.y,frame.w,frame.h,frame.action);
    this.home(v,ui);
    r.drawTransfer(v,ui);
    if(ui.modal)this.modal(v,ui);
  }
  currentStatus(v,ui){
    const report=this.artReport();
    if(ui.saveError)return {text:'存档失败 · 重试',action:'retry-save',error:true};
    if(finite(report.failed)>0)return {text:'美术失败 · 重试',action:'retry-art',error:true};
    if(ui.loadError)return {text:'存档提示 · 查看',action:'settings',error:true};
    if(ui.toast)return {text:ui.toast,action:'openStats'};
    if(finite(report.pending)>0)return {text:'美术加载中',action:'settings'};
    const transfer=(v.transfers||[]).find(item=>!item.automated);
    if(transfer)return {text:transfer.source==='pop'?'自动补料':'自动送货',action:'openLogistics'};
    if(v.automaticTrial&&!v.automaticTrial.complete){
      const target=finite(v.automaticTrial.targetRate),slow=v.stations.filter(s=>s.capacity<target).sort((a,b)=>a.capacity-b.capacity)[0];
      if(finite(v.automaticTrial.elapsedSeconds)===0&&slow)return {text:slow.name+'不足 '+rate(target)+' 份/秒',action:'openExpansion'};
      return {text:'试运行 '+Math.floor(finite(v.automaticTrial.elapsedSeconds))+'/'+finite(v.automaticTrial.requiredSeconds)+' 秒',action:'openExpansion'};
    }
    if(v.expansion)return {text:v.expansion.ready?'可扩建':'查看扩建条件',action:'openExpansion'};
    return {text:v.state.machine===5?'六代工厂已建成':'查看工厂数据',action:'openStats'};
  }
  home(v,ui){
    const hud=this.layout.hud,coin=hud.coin;this.panel('ui_hud_coin',coin.x,coin.y,coin.w,coin.h,'#f5e4a9');
    if(!this.icon('coin',coin.x+9,coin.y+10,22)){this.r.circle(coin.x+20,coin.y+21,9,C.yellow);this.text('金',coin.x+20,coin.y+21,10,C.orange,700,'center');}
    const hasCoin=this.r.art&&this.r.art.get('ui_hud_coin');
    this.label(num(v.state.coins),coin.x+38,coin.y+21,coin.w-44,23,hasCoin?C.white:C.ink,800);
    this.label('出货 '+rate(v.throughput)+' 份/秒',hud.rate.x+2,hud.rate.y+13,hud.rate.w-4,13,C.ink,700);
    this.hit(coin.x,coin.y,Math.max(coin.w,hud.rate.w),70,'openStats');
    const settings=hud.settings;this.panel('ui_button_secondary',settings.x,settings.y,44,44,C.mint);
    if(!this.icon('settings',settings.x+10,settings.y+10,24))this.text('设置',settings.x+22,settings.y+22,12,C.ink,700,'center');
    this.hit(settings.x,settings.y,44,44,'settings');
    const status=this.currentStatus(v,ui),sr=hud.status;
    this.box(sr.x,sr.y+8,sr.w,40,'rgba(255,250,240,.88)',status.error?'#c89870':undefined,10);
    this.label(status.text,sr.x+sr.w/2,sr.y+28,sr.w-10,11,status.error?C.orange:C.green,650,'center');this.hit(sr.x,sr.y,sr.w,sr.h,status.action);
    for(const item of [{rect:hud.logistics,id:'automation',text:'物流',action:'openLogistics'},
      {rect:hud.expansion,id:v.expansion?'expand':'check',text:v.expansion?'扩建':'已建成',action:'openExpansion'}]){
      const p=item.rect;this.panel('ui_button_secondary',p.x,p.y,p.w,p.h,C.mint);
      this.icon(item.id,p.x+(p.w-22)/2,p.y+6,22);this.text(item.text,p.x+p.w/2,p.y+42,11,C.ink,700,'center');this.hit(p.x,p.y,p.w,p.h,item.action);
    }
  }
  quote(ui,key){return ui.quotes&&ui.quotes[key]||key==='upgrade'&&ui.quote||null;}
  quoteMatches(q,offer,v,station){
    if(!q||!offer||!q.id||typeof q.action!=='string'||q.action!=='purchase:'+q.id||q.cost!==offer.cost)return false;
    if(q.generation!=null&&q.generation!==v.state.machine)return false;
    if(station&&(q.stationId!==station.id||q.level!==station.level+1||q.name!==offer.name))return false;
    return true;
  }
  unavailable(offer,coins,cost){
    if(!offer)return '已满级';
    if(offer.reason==='machine-required')return '需第 '+(finite(offer.requiredMachine)+1)+' 代';
    if(coins<cost)return '还差 '+num(cost-coins)+' 金币';return '';
  }
  purchase(offer,q,v,station,label){
    if(!offer)return {text:'已满级',action:'close',disabled:true};
    if(!this.quoteMatches(q,offer,v,station))return {text:'重新查看报价',action:'refreshQuotes'};
    const blocked=this.unavailable(offer,v.state.coins,q.cost);
    return {text:blocked||label+' · '+num(q.cost)+' 金币',action:q.action,disabled:!!blocked||offer.available===false};
  }
  modalModel(v,ui){
    const type=ui.modal.type,rows=[];
    const text=(value,size=13,color=C.ink,weight=500,gap=8)=>rows.push({kind:'text',value,size,color,weight,gap});
    const button=(value,action,disabled=false)=>rows.push({kind:'button',value,action,disabled});
    let title='工厂设置',height=450,footer={text:'关闭',action:'close',fill:C.mint,color:C.green};
    if(type==='station'){
      const s=v.stations.find(item=>item.id===ui.modal.stationId);height=326;
      if(!s){title='设备信息';text('设备已变化，请重新选择');return {title,height,rows,footer};}
      const up=s.upgrade,q=this.quote(ui,'upgrade');title=s.name+' · 升级';text(up?up.name:'已满级',14,C.ink,700);
      text('处理速度',12,C.muted,500,4);text(up?rate(s.capacity)+' → '+rate(up.capacity)+' 份/秒':rate(s.capacity)+' 份/秒',22,C.ink,800,12);
      const manual=(v.transfers||[]).some(t=>!t.automated)||(v.transfer&&v.transfer.enabled&&v.mode!=='v15');
      if(manual)text('仍需拖拽送料',13,C.orange);
      else if(up&&up.lineImproves)text((up.lineRequiresExpansion?'扩建后预计出货 ':'预计出货 ')+rate(up.lineBefore)+' → '+rate(up.lineAfter)+' 份/秒',13,C.green);
      else if(up){const bottleneck=v.insights&&v.insights.bottleneck,other=bottleneck&&v.stations.find(item=>item.id===bottleneck.stationId);text(other?'当前受'+other.name+'限制':'暂不提高整线出货',13,C.orange);}
      if(up)text('价格 '+num(q&&q.cost!=null?q.cost:up.cost)+' 金币',13,C.ink,700);
      footer=this.purchase(up,q,v,s,'升级');
    }else if(type==='logistics'){
      title='物流改造';height=480;
      for(const source of ['pop','cup']){
        const transfer=(v.transfers||[]).find(item=>item.source===source),offer=transfer&&transfer.automation,q=this.quote(ui,'automate-'+source);
        text(source==='pop'?'A · 自动补料':'B · 自动送货',15,C.ink,750,5);
        if(transfer&&transfer.automated){text('已自动',13,C.green,700);text('无需手动搬运',12,C.muted,500,18);}
        else if(transfer){text('无需手动搬运；不提升加工速度',12,C.muted,500,5);text('价格 '+num(q&&q.cost!=null?q.cost:offer?offer.cost:0)+' 金币',12,C.ink,700,7);const p=this.purchase(offer,q,v,null,'接通');button(p.text,p.action,p.disabled);}
        else text('当前模式无需购买转运',12,C.muted,500,18);
      }
      const up=v.logisticsUpgrade,q=this.quote(ui,'logistics');text('仓位改造',15,C.ink,750,5);
      if(up){text('每批 '+up.batchBefore+' → '+up.batchAfter+' 份',12);text('入口 '+up.inputBefore+' → '+up.inputAfter+'；仓位 '+up.capacityBefore+' → '+up.capacityAfter,12,C.muted,500,5);text('减少补料频率',12,C.muted,500,5);text('价格 '+num(q&&q.cost!=null?q.cost:up.cost)+' 金币',12,C.ink,700,7);const p=this.purchase(up,q,v,null,'改造');button(p.text,p.action,p.disabled);}
      else text('已满级',13,C.green);
    }else if(type==='expansion'){
      title=v.expansion?'扩建工厂':'六代工厂已建成';height=432;const next=v.expansion,q=this.quote(ui,'expansion');
      if(!next){text('六代生产线已落成',19,C.green,800);text('继续查看设备和仓位的剩余改造',13,C.muted);text('累计出货 '+num(v.state.totalSold)+' 份',14);}
      else{
        text('解锁 '+next.name,16,C.ink,750);text('设备另购，扩建不会立即提速',12,C.orange);
        for(const change of next.bufferChanges||[])text(change.name+' '+num(change.before)+' → '+num(change.after)+' 份',12);
        const names=(next.unlocks||[]).map(item=>typeof item==='string'?item:item.name).filter(Boolean);if(names.length)text('开放：'+names.join('、'),12,C.green);
        const routes=v.transfers||[],automatic=!routes.length||routes.every(t=>t.automated),trial=v.automaticTrial;
        if(routes.length)text((automatic?'✓ ':'○ ')+'A / B 自动转运',13,automatic?C.green:C.orange);
        if(trial)text((trial.complete?'✓ ':'○ ')+'试运行 '+Math.floor(finite(trial.elapsedSeconds))+'/'+trial.requiredSeconds+' 秒',13,trial.complete?C.green:C.orange);
        text((next.rateReached?'✓ ':'○ ')+'实际出货达 '+rate(next.targetRate)+' 份/秒',13,next.rateReached?C.green:C.orange);
        if(!next.rateReached){const slow=v.stations.filter(s=>s.capacity<next.targetRate).sort((a,b)=>a.capacity-b.capacity)[0];if(slow)text(slow.name+'不足 '+rate(next.targetRate)+' 份/秒',12,C.orange);}
        text((v.state.totalSold>=next.requiredSold?'✓ ':'○ ')+'累计出货 '+num(v.state.totalSold)+'/'+num(next.requiredSold)+' 份',13);text('价格 '+num(q&&q.cost!=null?q.cost:next.cost)+' 金币',13,C.ink,750);
        if(!this.quoteMatches(q,next,v))footer={text:'重新查看报价',action:'refreshQuotes'};
        else{const blocked=this.unavailable(next,v.state.coins,q.cost);footer={text:blocked||(next.ready?'扩建 · '+num(q.cost)+' 金币':'条件尚未达成'),action:q.action,disabled:!next.ready||!!blocked};}
      }
    }else if(type==='settings'){
      text('小小爆米花厂 · v'+APP_VERSION,12,C.muted);
      const settings=v.state.settings||{};button('声音 · '+(settings.sound?'开启':'关闭'),'setting:sound');button('振动 · '+(settings.haptics?'开启':'关闭'),'setting:haptics');
      if(ui.saveError){text(ui.saveError,12,C.orange);button('重试保存','retry-save');}if(ui.loadError)text(ui.loadError,12,C.orange);
      if(finite(this.artReport().failed)>0){text('部分美术未加载',12,C.orange);button('重新加载美术','retry-art');}
      text('进度自动保存 · 离开期间生产暂停',12,C.muted);text('扩建保留自动补料 · 离线不额外结算',12,C.muted);
      text(v.mode==='v15'?'旧版工厂兼容迁移，保留原档备份':'旧存档备份仍会保留',12,C.muted);
      for(const line of HEALTH)text(line,11,C.muted,500,3);
      footer={text:'重新开始工厂',action:'restart',fill:'#efe0ca',color:C.orange};
    }else if(type==='restart'){
      title='重新开始工厂';height=292;text('将重新开始当前工厂的金币、设备、物流改造和生产进度。',14);text('旧版原档备份仍会保留。',13,C.muted);
      footer={text:'确认重新开始',action:'confirmRestart',fill:'#ab654e'};
    }else if(type==='stats'){
      title='工厂数据';height=370;text('实际出货 '+rate(v.throughput)+' 份/秒',20,C.ink,800);
      const sampling=v.insights&&v.insights.sampling;text(sampling&&sampling.label||((v.state.playedSeconds<10?'实测不足10秒':'近10秒实测')+' · 自动运行'),12,C.muted);
      text('累计出货 '+num(v.state.totalSold)+' 份',14);if(v.insights)text('自动运行基线 '+rate(v.insights.stableRate)+' 份/秒',13,C.muted);
      for(const station of v.stations)text(station.name+' · 能力 '+rate(station.capacity)+' 份/秒',13);
      if(v.insights&&v.insights.bottleneck)text(v.insights.bottleneck.reason,12,C.orange);
    }
    return {title,height,rows,footer,error:ui.modal.error||''};
  }
  modal(v,ui){
    const r=this.r,model=this.modalModel(v,ui),safe=this.safe;
    const w=Math.min(360,safe.w*.84),errorLines=model.error?this.lines(model.error,w-36,11):[],errorHeight=errorLines.length*18;
    const h=Math.min(model.height+errorHeight,safe.h-16),x=safe.x+(safe.w-w)/2,y=safe.y+(safe.h-h)/2;
    const content={x:x+18,y:y+64+errorHeight,w:w-36,h:Math.max(40,h-138-errorHeight),scrollMax:0};let total=0;
    const rows=model.rows.map(row=>{const lines=row.kind==='text'?this.lines(row.value,content.w,row.size):null,height=row.kind==='button'?54:lines.length*(row.size+7)+row.gap;const measured=Object.assign({},row,{lines,top:total,height});total+=height;return measured;});
    content.scrollMax=Math.max(0,total-content.h);const scroll=clamp(ui.modal.scroll,0,content.scrollMax);
    this.layout.modal={x,y,w,h,type:ui.modal.type,content,scroll};
    // Paint and hit zones remain fixed throughout the short opacity fade.
    r.zones=[];r.hit(0,0,this.w,this.h,'close');r.hit(x,y,w,h,'modal-body');
    r.c.save();const age=Math.max(0,finite(ui.elapsedSeconds)-finite(ui.modal.openedAt));r.c.globalAlpha=ui.modal.openedAt==null?1:Math.min(1,.7+age/.16*.3);
    r.c.fillStyle='rgba(20,42,40,.42)';r.c.fillRect(0,0,this.w,this.h);this.panel('ui_panel',x,y,w,h,C.white,undefined,20);
    this.label(model.title,x+18,y+31,w-82,17,C.ink,800);this.button(x+w-52,y+8,44,'×','close',{fill:C.mint,color:C.green,size:23});
    for(let i=0;i<errorLines.length;i++)this.text(errorLines[i],x+18,y+62+i*18,11,C.orange,650);
    r.c.save();r.c.beginPath();r.c.rect(content.x,content.y,content.w,content.h);r.c.clip();this.contentClip=content;
    for(const row of rows){const ry=content.y+row.top-scroll;if(ry+row.height<content.y||ry>content.y+content.h)continue;
      if(row.kind==='button')this.button(content.x,ry,content.w,row.value,row.action,{disabled:row.disabled,size:12});
      else for(let i=0;i<row.lines.length;i++)this.text(row.lines[i],content.x,ry+(row.size+7)*i+row.size/2,row.size,row.color,row.weight);
    }
    this.contentClip=null;r.c.restore();
    if(content.scrollMax>0){const track=content.h,thumb=Math.max(20,track*content.h/total);this.box(x+w-10,content.y,3,track,'#e2e1d3',undefined,2);this.box(x+w-10,content.y+(track-thumb)*scroll/content.scrollMax,3,thumb,'#829a8a',undefined,2);}
    this.button(x+18,y+h-62,w-36,model.footer.text,model.footer.action,{disabled:!!model.footer.disabled,fill:model.footer.fill||C.green,color:model.footer.color||C.white,size:12,h:44});r.c.restore();
  }
}

module.exports={GameInterface};
