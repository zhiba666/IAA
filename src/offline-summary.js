'use strict';
// Ordinary offline claim preview. No reward, clock or save changes occur here.
const { CONFIG, formatNumber } = require('./core');
const { selectNextStep } = require('./next-step');
const amount = value => Number.isFinite(value)?Math.max(0,Math.min(1e150,value)):0;
const fraction = value => Math.max(0,Math.min(1,value));
function selectOfflineSummary(view) {
  if(!view||!view.offline||!view.state)return null;
  const pending=view.offline,state=view.state,order=view.order,next=view.nextMachine;
  const coins=amount(pending.cashCoins === undefined?pending.coins:pending.cashCoins),production=amount(pending.production);
  const coinsAfter=amount(amount(state.coins)+coins),producedAfter=amount(amount(state.totalProduced)+production);
  const contract=view.contracts&&view.contracts.active;
  let before=0,after=0,missing=0,readyAfter=false;
  let projectedOrder=order?{...order}:null;
  if(order&&order.completed){before=after=1;}
  else if(contract){
    const requirements=contract.requirements.map(item=>{
      const added=item.key==='quantity'?amount(pending.contractProduction):item.key==='coated'?amount(pending.contractCoated):0;
      return {...item,current:Math.min(item.target,item.current+added)};
    });
    before=contract.progress;
    after=requirements.reduce((sum,item)=>sum+fraction(item.current/Math.max(1,item.target)),0)/Math.max(1,requirements.length);
    readyAfter=requirements.every(item=>item.current>=item.target);
    missing=Math.max(0,requirements[0].target-requirements[0].current);
    projectedOrder={...order,requirements,ready:readyAfter,stageProgress:after,reward:order.reward+amount(pending.contractCoins)};
  } else if(order&&!order.awaitingSelection){
    const previous=state.orderIndex>0?CONFIG.orders[state.orderIndex-1].target:0;
    const progress=total=>fraction((total-previous)/Math.max(1,order.target-previous));
    before=progress(amount(state.totalProduced));after=progress(producedAfter);
    readyAfter=producedAfter>=order.target;missing=Math.max(0,order.target-producedAfter);
    projectedOrder={...order,ready:readyAfter,stageProgress:after};
  }
  const projected={...view,offline:null,state:{...state,coins:coinsAfter,totalProduced:producedAfter,offline:null},order:projectedOrder,
    upgrades:(view.upgrades||[]).map(upgrade=>({...upgrade,canBuy:upgrade.level<upgrade.maxLevel&&coinsAfter>=upgrade.cost})),
    canEvolve:!!next&&state.orderIndex>=next.requiredOrders&&coinsAfter>=next.cost};
  let nextStep;
  if(readyAfter)nextStep={title:'领取后可装车',detail:order.name+' · 结算 '+formatNumber(projectedOrder.reward)+' 金币',action:'order',buttonLabel:'查看订单'};
  else if(projected.canEvolve)nextStep={title:'领取后可换代',detail:next.name+'的金币和订单已备齐',action:'machine',buttonLabel:'查看设备'};
  else if(order&&order.completed)nextStep={title:'工厂已竣工',detail:'查看建厂纪念与收藏',action:'completion',buttonLabel:'查看纪念'};
  else if(order&&order.awaitingSelection&&!(next&&state.orderIndex>=next.requiredOrders))nextStep={title:'领取后选择客户',detail:'比较订单需求，继续推进设备收集',action:'order',buttonLabel:'选择订单'};
  else {
    const step=selectNextStep(projected);
    if(step.kind==='upgrade'){
      const upgrade=projected.upgrades.find(item=>item.key===step.upgradeKey);
      nextStep=step.enabled?{title:'领取后可升级'+upgrade.name,detail:step.detail,action:'upgrades',buttonLabel:'查看升级'}:
        {title:'领取后继续攒升级',detail:upgrade.name+'还差 '+formatNumber(Math.ceil(step.missingCoins))+' 金币',action:'upgrades',buttonLabel:'查看升级'};
    } else if(step.kind==='save')nextStep={title:'领取后继续攒换代',detail:next.name+'还差 '+formatNumber(Math.ceil(step.missingCoins))+' 金币',action:'machine',buttonLabel:'查看设备'};
    else nextStep={title:'领取后继续生产',detail:contract?contract.kind==='festival'?'活动订单需要在线实际出锅':'继续完成当前客户的生产要求':order?'本单还差 '+formatNumber(Math.ceil(missing))+' 份':step.detail,action:'close',buttonLabel:'继续经营'};
  }
  return {production,coins,coinsAfter,contractCoins:amount(pending.contractCoins),contractProduction:amount(pending.contractProduction),
    order:order?{name:order.name,readyBefore:!!order.ready,readyAfter,progressBefore:before,progressAfter:after,missingProduction:missing}:null,
    nextStep,ruleText:'常驻自动产能的50%，最多8小时。\n合同货物交付结算；广告只翻倍本次现款。'};
}
module.exports={selectOfflineSummary};
