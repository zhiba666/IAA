'use strict';
// Read-only guidance. The player chooses contracts and collects permanent equipment.
const { formatNumber } = require('./core');
const finite = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const amount = value => formatNumber(Math.ceil(finite(value)));
const rate = value => finite(value) < 10 ? Number(finite(value).toFixed(2)).toString() : formatNumber(value);

function selectNextStep(view, target = null) {
  const guided=view.onboarding&&view.onboarding.goal;
  if(guided)return {id:guided.id,kind:guided.action==='observe'?'observe':guided.action.startsWith('upgrade:')?'upgrade':guided.action==='order'?'order':'produce',
    action:guided.action,enabled:guided.action!=='observe',title:guided.title,detail:guided.text,reason:guided.reason||view.onboarding.nextUnlock,
    buttonLabel:guided.buttonLabel,...(guided.upgradeKey?{upgradeKey:guided.upgradeKey}:{}),
    ...(Number.isFinite(guided.missingCoins)?{missingCoins:guided.missingCoins}:{})};
  const state = view.state || {}, order = view.order, next = view.nextMachine;
  const coins = finite(state.coins), production = view.production || {}, income = finite(production.baseIncome);
  const upgrades = (view.upgrades || []).filter(item => item.unlocked !== false && item.level < item.maxLevel && item.preview);
  const affordable = item => item.canBuy && item.cost <= coins;
  const orderStep = (reason) => ({id:'order:'+(order && order.index),kind:'order',action:'order',enabled:true,
    title:order && order.ready?'本单可以装车了':order && order.awaitingSelection?'选择下一张订单':'查看本单生产要求',
    detail:order && order.ready?'结算 '+amount(order.reward)+' 金币':order && order.awaitingSelection?'比较客户需求，继续收集设备':(order && order.name || '继续经营'),
    reason:reason||(order && order.awaitingSelection?'已获得的设备永久同时生效':'当前客户订单'),buttonLabel:order && order.ready?'前往装车':order && order.awaitingSelection?'选择订单':'查看进度'});
  const upgradeStep = (item, reason, estimate, forProduction = false) => ({id:'upgrade:'+item.key,kind:'upgrade',action:'upgrade:'+item.key,
    enabled:!!affordable(item),upgradeKey:item.key,cost:item.cost,missingCoins:Math.max(0,item.cost-coins),
    title:item.name+' · '+item.level+'级',detail:forProduction&&item.key==='auto'?
      rate(production.baseAuto)+' → '+rate(item.preview.after/Math.max(1e-9,production.price))+' 份/秒':
      rate(item.preview.before)+' → '+rate(item.preview.after)+' '+item.preview.unit,
    reason:affordable(item)?reason:'还差 '+amount(item.cost-coins)+' 金币',buttonLabel:formatNumber(item.cost)+' 升级',...(estimate?{estimate}:{})});
  if (view.canEvolve && next) return {id:'machine:'+next.id,kind:'machine',action:'machine',enabled:true,
    title:'开动'+next.name,detail:'金币和订单都已备齐',reason:'换代解锁新的生产能力',buttonLabel:'去换代'};
  if (order && order.completed) return {id:'complete',kind:'completion',action:'completion',enabled:true,
    title:'工厂已竣工',detail:'所有主线客户订单已完成',reason:'查看建厂历程与竣工纪念',buttonLabel:'查看纪念'};
  if (order && order.ready) return orderStep();
  const explicitKey = target && typeof target.action === 'string' && target.action.startsWith('upgrade:') ? target.action.slice(8) : target && target.upgradeKey;
  const explicit = upgrades.find(item => item.key === explicitKey);
  if (explicit) return upgradeStep(explicit,'当前教学目标');
  if (target && ['tutorial','quest'].includes(target.source) && target.action === 'tap') return {id:target.id,kind:'produce',action:'tap',enabled:true,
    title:target.title,detail:target.text,reason:'先熟悉投料与自动生产',buttonLabel:'点击生产'};
  if (order && order.awaitingSelection && !(next && state.orderIndex >= next.requiredOrders)) return orderStep();
  if (view.factory && view.factory.storedBurst) return {id:'pressure:stored',kind:'pressure',action:'releasePressure',enabled:true,
    title:'一锅爆米花已蓄满',detail:'可在需要集中出货时放出',reason:view.contracts && view.contracts.active?'可用于本单集中发运':'额外保留的一锅产能',buttonLabel:'放出蓄压锅'};
  if (next && state.orderIndex >= next.requiredOrders) {
    const missingCoins = Math.max(0,next.cost-coins), beforeSeconds = income > 0 ? missingCoins/income : Infinity;
    const investment = upgrades.filter(item => ['auto','value'].includes(item.key) && affordable(item)).map(item => {
      const afterIncome = item.key === 'auto' ? item.preview.after : finite(production.baseAuto)*item.preview.after;
      return {item,afterSeconds:afterIncome>0?(missingCoins+item.cost)/afterIncome:Infinity};
    }).filter(item => item.afterSeconds < beforeSeconds).sort((a,b) => a.afterSeconds-b.afterSeconds)[0];
    if (investment) return upgradeStep(investment.item,'缩短换代攒钱时间',{basis:'permanent-auto-income',beforeSeconds,afterSeconds:investment.afterSeconds});
    return {id:'save:machine:'+next.id,kind:'save',action:'machine',enabled:true,title:'为换代攒钱',
      detail:'还差 '+amount(missingCoins)+' 金币',reason:next.name,buttonLabel:'查看设备',cost:next.cost,missingCoins};
  }
  const reserved = next && coins >= next.cost ? next.cost : 0;
  const candidates = ['auto','tap'].map(key=>upgrades.find(item=>item.key===key)).filter(Boolean);
  const upgrade = candidates[0] && (!reserved || affordable(candidates[0]) && coins-candidates[0].cost>=reserved) ? candidates[0] : null;
  if (upgrade) return upgradeStep(upgrade,upgrade.key==='auto'?'自动生产持续推进当前批次':'提高每次有效投料的产量',null,true);
  if (view.contracts && view.contracts.active) {
    const contract = view.contracts.active, requirement = (contract.requirements || []).find(item => item.current < item.target);
    return {id:contract.id,kind:'contract',action:'order',enabled:true,title:contract.title,
      detail:requirement?requirement.label+' '+amount(requirement.current)+' / '+amount(requirement.target)+' '+requirement.unit:'等待装车',
      reason:contract.description,buttonLabel:'查看本单'};
  }
  return orderStep(reserved?'金币已备齐，先完成订单':undefined);
}
module.exports = { selectNextStep };
