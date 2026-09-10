'use strict';
// Standalone artwork review. These fixtures never import the game, start its
// simulation, call a purchase endpoint or read/write browser storage.
const ART = '../../../assets/art/';
// Read-only art-fixture snapshot checked against factory-rules.js on 2026-09-09.
// This is deliberately separate from the game's executable modules.
const RULES={initialCapacity:{pop:4,cup:2,ship:6},initialBuffer:12,cupUpgrade:{cost:30,capacity:6},doubleCup:{cost:200,requiredGeneration:2},expansion:{cost:180,requiredSold:100,targetRate:3,bufferAfter:24}};
const EXPANSION_FIXTURES={
  sold:{coins:46,sold:76,rate:3.2,spent:30,rateReached:true},
  rate:{coins:200,sold:200,rate:2.0,spent:0,rateReached:false},
  poor:{coins:70,sold:100,rate:3.2,spent:30,rateReached:true},
  ready:{coins:180,sold:210,rate:3.2,spent:30,rateReached:true}
};
const definitions = [
  {id:'hud',label:'01 主 HUD',description:'金币与近 10 秒实测出货分区；工位、两仓与选择反馈留在场景观察区。',states:[['initial','初始经营'],['selected','装杯已选中'],['shared','共同限制'],['observing','改造后观察中']]},
  {id:'upgrade',label:'02 工位改造区',description:'三工位切换与独立详情入口；购买仅对应当前显示报价。',states:[['ready','可购买'],['poor','金币不足'],['expansion','需先扩建'],['max','已满级'],['stale','报价失效']]},
  {id:'details',label:'03 改造详情',description:'设备能力、实测通过量与当前工作头状态分开显示；资料展开后仍可观察三工位。',states:[['processing','加工中'],['waiting','等上游供料'],['blocked','完成等下游'],['insufficient','有料但不足一批']]},
  {id:'installed',label:'04 购买后折叠条',description:'安装结果常驻短条，保留“查看下档”独立入口；再次点击不会直接购买下一档。',states:[['installed','已安装 · 观察中']]},
  {id:'expansion',label:'05 扩建目标卡',description:'销量、均速与金币分别表达条件；扩建只开放配置与仓位，不自动安装新工作头。',states:[['sold','销量未达标'],['rate','均速未达标'],['poor','金币不足'],['ready','可扩建'],['complete','六代完成']]},
  {id:'settings',label:'06 设置',description:'声音与振动状态由文字覆盖层表达；保存错误始终在面板内可见。',states:[['on','声音 / 振动开启'],['off','声音 / 振动关闭'],['error','保存失败提示']]},
  {id:'restart',label:'07 重开确认',description:'确认与保留进度各占独立 44 px 操作区；当前页面只展示文案与静态入口。',states:[['confirm','等待确认'],['cancel','取消入口焦点']]}
];
let currentScreen = 'hud';
let currentState = 'initial';
let currentBackground = 'warm';
let safeTop = 8;
const byId = id => document.getElementById(id);
const icon = (name, extra='') => `<img class="icon ${extra}" src="${ART}ui/ui_icon_${name}.png" alt="" data-art="ui_icon_${name}">`;
const action = (label, destination='', style='secondary', attributes='') => `<button type="button" class="skin action ${style}" ${destination ? `data-screen="${destination}"` : ''} ${attributes}>${label}</button>`;
const iconButton = (name, label, destination) => `<button type="button" class="skin secondary icon-action close" aria-label="${label}" data-screen="${destination}">${icon(name)}</button>`;
const title = (text, name, close=true) => `<div class="dock-title">${icon(name)}<span>${text}</span>${close ? iconButton('close','返回主 HUD','hud') : ''}</div>`;
const notice = (text, good=false) => `<div class="notice ${good?'good':''}">${icon(good?'check':'warning')}<span>${text}</span></div>`;
function header() {
  const afterPurchase=currentScreen==='installed'||currentState==='observing';
  const laterState=currentState==='max'||currentState==='complete';
  const expansion=currentScreen==='expansion'?EXPANSION_FIXTURES[currentState]:null;
  const coins=expansion?expansion.coins:currentState==='poor'?12:afterPurchase?16:46;
  const rate=expansion?expansion.rate.toFixed(1):afterPurchase?'2.4':'2.0';
  const hint=currentState==='shared'?'爆锅与装杯共同限制产出':afterPurchase?'改造已安装 · 等待均速更新':'待装仓积压 · 点装杯查看改造';
  return `<header class="header"><div class="topline"><strong>小小爆米花厂</strong><span>${laterState?'后续终态文案校对':'第 1 代 · 紧凑产线'}</span></div><div class="hud"><div class="skin hud-coin">${icon('coin')}<b>${coins}</b></div><div class="skin hud-rate rate">${icon('ship_speed')}<span class="rate-stack"><b>${rate} <span style="font-size:10px">份 / 秒</span></b><small>${afterPurchase?'近 10 秒 · 更新中':'近 10 秒实测'}</small></span></div>${iconButton('settings','查看设置装配稿','settings')}</div><div class="hint">${icon(afterPurchase?'wait':'warning')}<span>${laterState?'终态文案示意 · 使用首代机体占位':hint}</span></div></header>`;
}
function scene() {
  const selected=['upgrade','details','installed'].includes(currentScreen)||currentState==='selected';
  const installed=currentScreen==='installed'||currentState==='observing';
  const detailState=currentScreen==='details'?currentState:'';
  const cupState=detailState==='waiting'?'等上游供料':detailState==='blocked'?'完成等下游':detailState==='insufficient'?'等凑齐批次':'加工中';
  const machines=[['pop','爆锅',detailState==='blocked'?'等待空位':'加工中'],['cup','装杯',cupState],['ship','出货','自动出货']];
  return `<section class="scene" aria-label="三工位与两仓观察区"><div class="scene-overline">产线观察区 · 独立机体示意</div><div class="station-row">${machines.map(([id,label,state])=>`<button type="button" class="station ${id==='cup'&&selected?'selected':''}" data-screen="${id==='cup'?'upgrade':'details'}" aria-label="${label}工位静态示意"><span class="machine-slot"><img class="machine-thumb" src="${ART}machines/machine_${id}_body.png" alt="${label}新机体" data-art="machine_${id}_body"></span><strong>${label}</strong><small>${state}</small></button>`).join('')}</div><div class="buffer-row"><span class="stock"><img src="${ART}products/product_kernel_a.png" alt="" data-art="product_kernel_a">待装 <b>${installed?'8':'12'} / 12</b></span><span class="stock"><img src="${ART}products/product_cup_empty.png" alt="" data-art="product_cup_empty">待发 <b>2 / 12</b></span></div><p class="scene-note">场景数字为独立文字层 · 本页不推进生产</p></section>`;
}
function tabs() {
  return `<div class="tabs">${action('爆锅','details')}${action('装杯','upgrade','secondary current')}${action('出货','details')}${iconButton('arrow','查看改造详情','details')}</div>`;
}
function hudDock() {
  return `<section class="dock skin card-skin">${title('观察产线，疏通积压','upgrade',false)}<p class="copy">设备能力：爆锅 4 / 装杯 ${currentState==='observing'?RULES.cupUpgrade.capacity:RULES.initialCapacity.cup} / 出货 6 份 / 秒</p><p class="copy only-large">先查看装杯改造，出货实测随后逐步体现。</p><div class="footer-tabs">${action(icon('pop')+'爆锅','details')}${action(icon('cup')+'装杯','upgrade','primary')}${action(icon('ship')+'出货','details')}</div><div class="button-row">${action(icon('expand')+'扩建目标','expansion')}</div></section>`;
}
function upgradeDock() {
  const states={
    ready:{heading:'快速装杯头',text:'设备能力 2 → 6 份 / 秒',estimate:'预计稳定出货 ≈ 2 → 4 份 / 秒',button:'购买改造',price:'30 金币',note:'实际收益随供料与库存逐步体现。'},
    poor:{heading:'快速装杯头',text:'设备能力 2 → 6 份 / 秒',estimate:'预计稳定出货 ≈ 2 → 4 份 / 秒',button:'还差 18 金币',price:'30 金币',note:'金币不足，当前报价仍可查看。'},
    expansion:{heading:'双头装杯',text:'需要先扩建至第 2 代',estimate:'扩建后另行购买，才安装第二个头。',button:'需先扩建',price:'200 金币',note:'扩建与工作头购买是两个独立步骤。'},
    max:{heading:'本工位已完成全部改造',text:'已满级 · 当前设备保持生产',estimate:'查看其他工位，继续优化整线配合。',button:'本工位已满级',price:'已满级',note:'此状态为后续完整等级覆盖样稿。'},
    stale:{heading:'报价已失效',text:'设备档位或条件已发生变化',estimate:'重新查看后生成当前报价。',button:'重新查看报价',price:'—',note:'旧报价不继续购买，也不自动购买下一档。'}
  };
  const d=states[currentState];
  const enabled=currentState==='ready'||currentState==='stale';
  return `<section class="dock skin panel">${tabs()}<p class="copy strong">${d.heading} · ${d.text}</p><p class="copy">${d.estimate}</p><p class="subtle only-large">${d.note}</p><div class="button-row"><span class="price">${d.price}</span>${action(d.button,currentState==='ready'?'installed':'upgrade',enabled?'primary':'disabled',enabled?'':'disabled')}</div></section>`;
}
function detailsDock() {
  const map={processing:['加工中','当前批次按真实进度升起填充层。','1 头 · 1 份 / 批 · 在制 1 份'],waiting:['等上游供料','没有加工批次，工作头回到待机姿态。','1 头 · 1 份 / 批 · 在制 0 份'],blocked:['完成等下游','保留完成产品，等下游腾出仓位。','1 头 · 1 份 / 批 · 完成等待 1 份'],insufficient:['有料但不足一批','示例：仅余 1 份，双份批次需要 2 份。','批量状态补充稿 · 后续设备配置']};
  const [state,note,facts]=map[currentState];
  return `<section class="dock skin panel">${title('装杯 · 改造详情','cup')}<p class="copy strong">${facts}</p><div class="fact-row"><span>实测通过 · 近 10 秒</span><b>2.0 份 / 秒</b></div><div class="head-states"><span class="head-state ${currentState==='blocked'?'blocked':currentState==='processing'?'':'waiting'}">工作头 01 · ${state}</span></div><p class="copy">${note}</p><div class="button-row">${action('返回改造概览','upgrade')}${action('收起并观察','hud','secondary','data-state="selected"')}</div></section>`;
}
function installedDock() {
  return `<section class="dock skin compact-skin"><div class="folded">${icon('check')}<div class="message">快速装杯头已安装<small>生产继续 · 观察库存与实测出货</small></div>${action('查看下档','upgrade','secondary','data-state="expansion"')}${iconButton('close','关闭折叠条','hud')}</div></section>`;
}
function expansionDock() {
  if(currentState==='complete')return `<section class="dock skin card-skin">${title('六代生产线已落成','check')}<p class="copy strong">六代完成 · 继续改造已开放设备</p><p class="copy">工作头仍按实际购买配置装配。</p><p class="subtle">完整成长状态补充稿；未新增结算奖励。</p><div class="button-row">${action('观察产线','hud')}</div></section>`;
  const fixture=EXPANSION_FIXTURES[currentState],gate=RULES.expansion;
  const ready=fixture.rateReached&&fixture.sold>=gate.requiredSold&&fixture.coins>=gate.cost;
  const text=currentState==='sold'?'销量未达标，继续自动出货':currentState==='rate'?'近 10 秒均速尚未达标':currentState==='poor'?`金币不足，还差 ${gate.cost-fixture.coins} 金币`:'条件已齐，可以扩建';
  return `<section class="dock skin card-skin">${title('扩建至第 2 代','expand')}<p class="copy strong">待装 / 待发仓位 ${RULES.initialBuffer} → ${gate.bufferAfter} 份</p><p class="subtle">开放双头装杯与成组包装，设备需另购。</p><div class="condition"><span>累计出货</span><b>${fixture.sold} / ${gate.requiredSold} 份</b></div><div class="meter"><span style="width:${Math.min(100,fixture.sold/gate.requiredSold*100)}%"></span></div><div class="condition"><span>近 10 秒均速</span><b>${fixture.rate.toFixed(1)} / ${gate.targetRate.toFixed(1)} 份 / 秒</b></div>${notice(text,ready)}<div class="button-row">${action(gate.cost+' 金币扩建','',ready?'primary':'disabled',ready?'aria-label="扩建静态示意，不执行购买"':'disabled')}</div></section>`;
}
function settingsDock() {
  const off=currentState==='off';
  return `<section class="dock skin panel">${title('工厂设置','settings')}<div class="setting-row">${icon('sound')}<span>声音</span>${action(off?'关闭':'开启','settings','secondary',`data-state="${off?'on':'off'}" aria-pressed="${!off}"`)}</div><div class="setting-row">${icon('vibration')}<span>振动</span>${action(off?'关闭':'开启','settings','secondary',`data-state="${off?'on':'off'}" aria-pressed="${!off}"`)}</div>${currentState==='error'?'<p class="setting-error" role="status">保存失败，请稍后重试。当前进度仍在本次会话中。</p>':'<p class="subtle">进度自动保存 · 离开期间生产暂停</p>'}<div class="button-row">${action('重新开始本版本工厂','restart')}</div></section>`;
}
function restartDock() {
  return `<section class="dock skin panel">${title('重新开始新工厂','warning')}<p class="restart-copy">将重新开始本版本的金币、设备和生产进度。旧版本存档仍保留。</p><div class="button-row">${action('确认，重新开始','', 'primary','aria-label="重开确认静态示意，不执行重开"')}</div><div class="button-row">${action('保留当前进度','hud','secondary',currentState==='cancel'?'data-highlight="true"':'')}</div></section>`;
}
const dockRenderers={hud:hudDock,upgrade:upgradeDock,details:detailsDock,installed:installedDock,expansion:expansionDock,settings:settingsDock,restart:restartDock};
function selectScreen(id,state) {
  const definition=definitions.find(item=>item.id===id)||definitions[0];
  currentScreen=definition.id;
  currentState=definition.states.some(([key])=>key===state)?state:definition.states[0][0];
  byId('state').innerHTML=definition.states.map(([id,label])=>`<option value="${id}" ${id===currentState?'selected':''}>${label}</option>`).join('');
  byId('description').textContent=definition.description;
  for(const button of byId('screens').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.screen===currentScreen));
  render();
}
function render() {
  const markup=header()+scene()+dockRenderers[currentScreen]();
  for(const id of ['large','compact']) {
    const frame=byId(id);
    frame.innerHTML=markup;
    frame.classList.remove('warm','dark','checker');frame.classList.add(currentBackground);
    frame.style.setProperty('--safe-top',safeTop+'px');
    frame.dataset.screen=currentScreen;frame.dataset.state=currentState;
    const highlighted=frame.querySelector('[data-highlight]');if(highlighted)highlighted.style.outline='2px solid #d09e36';
    for(const button of frame.querySelectorAll('[data-screen]'))button.onclick=()=>selectScreen(button.dataset.screen,button.dataset.state);
  }
  inspectAssets();
}
async function inspectAssets() {
  const snapshot={screen:currentScreen,state:currentState};
  const paths=[...new Set([...document.querySelectorAll('.phone img[data-art]')].map(img=>img.getAttribute('src')))];
  paths.push(...['ui_hud_coin','ui_hud_rate','ui_panel','ui_button_primary','ui_button_secondary','ui_button_disabled','ui_card','ui_compact_bar'].map(id=>ART+'ui/'+id+'.png'));
  const results=await Promise.all(paths.map(path=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve({path,ok:true,width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>resolve({path,ok:false});img.src=path;})));
  if(snapshot.screen!==currentScreen||snapshot.state!==currentState)return;
  const missing=results.filter(result=>!result.ok);
  byId('asset-status').textContent=`本稿引用检查：${results.length-missing.length} / ${results.length} 个独立 PNG 可加载。${missing.length?'尚待汇总：'+missing.map(item=>item.path.split('/').pop()).join('、'):'素材来源可追溯；游戏接入与状态绑定尚未执行。'}`;
  window.artPreviewReport={screen:currentScreen,state:currentState,assets:results,viewports:['large','compact'].map(id=>{const e=byId(id),scene=e.querySelector('.scene');return {id,width:e.clientWidth,height:e.clientHeight,scrollHeight:e.scrollHeight,sceneHeight:scene.getBoundingClientRect().height,undersizedButtons:[...e.querySelectorAll('button')].filter(b=>{const r=b.getBoundingClientRect();return r.width<44||r.height<44;}).map(b=>b.textContent.trim()||b.getAttribute('aria-label'))};})};
}
byId('screens').innerHTML=definitions.map(item=>`<button type="button" data-screen="${item.id}" aria-pressed="false">${item.label}</button>`).join('');
for(const button of byId('screens').querySelectorAll('button'))button.onclick=()=>selectScreen(button.dataset.screen);
byId('state').onchange=event=>{currentState=event.target.value;render();};
byId('safe-top').onchange=event=>{safeTop=Number(event.target.value);render();};
byId('background').onchange=event=>{currentBackground=event.target.value;render();};
selectScreen('hud');
