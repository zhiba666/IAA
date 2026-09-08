'use strict';
// Read-only home guidance. Estimates use permanent automatic income only;
// player taps, bursts, temporary boosts and unclaimed rewards are not assumed.
const { CONFIG, formatNumber } = require('./core');
const KEYS = Object.keys(CONFIG.upgrades);
const finite = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
const amount = value => formatNumber(Math.ceil(finite(value)));
const rate = value => finite(value) < 10 ? Number(finite(value).toFixed(2)).toString() : formatNumber(value);

function selectNextStep(view, target = null, context = {}) {
  context = context || {};
  const state = view.state || {}, production = view.production || {};
  const upgrades = view.upgrades || [], order = view.order, next = view.nextMachine;
  const coins = finite(state.coins), income = finite(production.baseIncome);
  const usable = upgrade => upgrade && upgrade.level < upgrade.maxLevel && upgrade.preview;
  const affordable = upgrade => usable(upgrade) && upgrade.canBuy && finite(upgrade.cost) <= coins;
  const crafts = (view.refinements && view.refinements.unlocked ? view.refinements.options : []).filter(item => item.preview && item.level < item.unlockedLevel);
  const craftStep = (item, reason, estimate = null) => ({
    id: 'refinement:' + item.key + ':' + item.level, kind: 'refinement', action: 'refinements', enabled: true,
    title: item.name + ' · 工艺' + (item.level + 1) + '级',
    detail: item.canBuy ? rate(item.preview.before) + ' → ' + rate(item.preview.after) + ' ' + item.preview.unit : '还差 ' + amount(item.cost - coins) + ' 金币',
    reason, buttonLabel: '查看工艺', refinementKey: item.key, ...(estimate ? {estimate} : {})
  });
  const orderStep = reason => {
    if (!order) return produceStep(reason);
    const ready = !!order.ready;
    return {
      id: 'order:' + order.index + ':' + Number(!!order.isLoop), kind: 'order', action: 'order', enabled: true,
      title: ready ? '订单可以装车了' : '继续完成订单',
      detail: ready ? '普通奖励 ' + amount(order.reward) + ' 金币' : '本单还差 ' + amount(finite(order.target) - finite(state.totalProduced)) + ' 份',
      reason: reason || (ready ? '累计产量已达标' : '持续生产累计订单进度'), buttonLabel: ready ? '前往装车' : '查看订单'
    };
  };
  const produceStep = reason => ({
    id: 'produce:' + (target && target.id || 'production'), kind: 'produce', action: 'tap', enabled: true,
    title: '继续点击生产', detail: '每次 +' + rate(production.tap) + ' 份',
    reason: reason || (target && target.title) || '点击与自动生产共同累计', buttonLabel: '继续生产'
  });
  const machineStep = () => ({
    id: 'machine:' + next.id, kind: 'machine', action: 'machine', enabled: true,
    title: '开动' + next.name, detail: '金币和订单都已备齐', reason: '下一阶段生产设备', buttonLabel: '去换代'
  });
  const deliveryStep = () => {
    const delivery=view.deliveries,part=delivery&&delivery.stages.find(item=>item.ready&&!item.claimed);
    return part ? {id:'delivery:'+delivery.orderIndex+':'+part.stage,kind:'delivery',action:'order',enabled:true,
      title:'分段交付可以领奖了',detail:'提前领取 '+amount(part.coins)+' 金币',
      reason:part.stage*25+'%产量已完成 · 计入本单总奖',buttonLabel:'去交付',stage:part.stage} : null;
  };
  const commissionStep = () => {
    const active=view.commissions&&view.commissions.active;
    if(!active)return null;
    const detail=active.ready?'额外奖励 '+amount(active.reward)+' 金币':active.kind==='bulk'?'新增生产还差 '+amount(active.productionTarget-active.production)+' 份':'完美爆锅 '+Math.min(active.perfect,active.perfectTarget)+' / '+active.perfectTarget+' 次'+(active.recoveryTarget>0?' · 余热 '+Math.min(active.recovery,active.recoveryTarget)+' / '+active.recoveryTarget:'');
    return {id:active.id,kind:'commission',action:'commissions',enabled:true,ready:active.ready,
      title:active.ready?'领取本次额外奖励':'完成委托领奖',detail,
      reason:'你的自选委托 · 主线同时推进',buttonLabel:active.ready?'领取委托':'查看进度'};
  };
  const upgradeStep = (upgrade, reason, { estimate, forOrder = false } = {}) => {
    const preview = upgrade.preview, missingCoins = Math.max(0, finite(upgrade.cost) - coins);
    let before = preview.before, after = preview.after, unit = preview.unit;
    // The auto preview is permanent income. Dividing by the unchanged price
    // presents the same upgrade as production when the goal is an order.
    if (forOrder && upgrade.key === 'auto' && finite(production.price) > 0) {
      before = production.baseAuto; after = preview.after / production.price; unit = '份/秒';
    }
    return {
      id: 'upgrade:' + upgrade.key, kind: 'upgrade', action: 'upgrade:' + upgrade.key,
      enabled: !!affordable(upgrade), upgradeKey: upgrade.key, cost: upgrade.cost, missingCoins,
      title: upgrade.name + ' · ' + upgrade.level + '级',
      detail: rate(before) + ' → ' + rate(after) + ' ' + unit,
      reason: missingCoins > 0 ? '还差 ' + amount(missingCoins) + ' 金币' : reason,
      buttonLabel: formatNumber(upgrade.cost) + ' 升级', ...(estimate ? { estimate } : {})
    };
  };

  // Explicitly selected, completed goals stay ahead of incidental opportunities.
  if (target && target.ready) {
    if (typeof target.action === 'string' && target.action.startsWith('questClaim:')) return {
      id: target.id, kind: 'quest', action: target.action, enabled: true,
      title: '领取成长奖励', detail: '领取 ' + amount(target.reward) + ' 金币',
      reason: target.title || '当前目标已完成', buttonLabel: '领取奖励'
    };
    if (target.action === 'order' && order && order.ready) return orderStep();
    if (target.action === 'machine' && view.canEvolve && next) return machineStep();
  }

  const explicitKey = target && (typeof target.action === 'string' && target.action.startsWith('upgrade:') ? target.action.slice(8) : target.upgradeKey);
  const explicitUpgrade = KEYS.includes(explicitKey) && upgrades.find(upgrade => upgrade.key === explicitKey);
  if (usable(explicitUpgrade)) return upgradeStep(explicitUpgrade, '当前目标');
  if (target && !explicitKey && ['tutorial', 'quest'].includes(target.source) && target.action === 'tap') return produceStep();

  if (order && order.ready) return orderStep();
  if (view.canEvolve && next) return machineStep();
  const delivery=deliveryStep();
  if(delivery)return delivery;
  const commission=commissionStep();
  if(commission&&commission.ready)return commission;
  if (target && target.source === 'learning' && target.action === 'heatLesson') return {
    id: target.id, kind: 'learning', action: 'heatLesson', enabled: true,
    title: target.charged ? '第2步 · 点击用掉余热' : '第1步 · 完成一次完美爆锅', detail: target.text,
    reason: '可跳过 · 不影响免费爆锅', buttonLabel: '练习余热'
  };
  if(commission&&target&&target.source==='commission')return commission;
  if(target&&target.source==='souvenir')return {id:target.id,kind:'souvenir',action:'souvenirs',enabled:true,
    title:'布置竣工后的工厂',detail:target.text,reason:'循环订单金币有新用途',buttonLabel:'查看收藏'};

  const ordersMissing = next ? Math.max(0, finite(next.requiredOrders) - finite(state.orderIndex)) : 0;
  const fundingLimited = next && ordersMissing === 0 && coins < finite(next.cost);
  const bottleneck = fundingLimited ? 'funding' : order && !order.ready ? 'production' : null;
  const modes = view.productionModes;
  const explicitTeaching = target && ['tutorial', 'quest'].includes(target.source);
  if (bottleneck && !explicitTeaching && !context.suppressModeAdvice && modes && modes.unlocked && Array.isArray(modes.options)) {
    const field = fundingLimited ? 'baseIncome' : 'baseAuto';
    const currentRate = finite(production[field]);
    // Compare canonical permanent previews; neither a temporary boost nor the
    // current wallet changes the identity of a suggestion within this stage.
    let best = null;
    for (const mode of modes.options) {
      if (!mode || mode.id === modes.current || !CONFIG.productionModes.some(option => option.id === mode.id)) continue;
      const p = mode.preview;
      if (!p || !['baseAuto', 'baseIncome'].every(key => typeof p[key] === 'number' && Number.isFinite(p[key]) && p[key] > 0)) continue;
      if (!(p[field] > currentRate + Math.max(1e-9, currentRate * 1e-12))) continue;
      if (!best || p[field] > best.preview[field]) best = mode;
    }
    if (best) {
      const id = 'mode:' + bottleneck + ':' + best.id + ':' + finite(state.machine);
      if (context.dismissedModeSuggestion !== id) return {
        id, kind: 'mode', action: 'modeAdvice:' + id, enabled: true, modeId: best.id, bottleneck,
        title: '查看' + best.name,
        detail: '产量 ' + rate(production.baseAuto) + ' → ' + rate(best.preview.baseAuto) + ' 份/秒 · 收入 ' + rate(income) + ' → ' + rate(best.preview.baseIncome) + ' 金币/秒',
        reason: fundingLimited ? '订单条件已齐，攒换代金币；产量会减少' : '本单还缺产量，赶订单更快；收入会减少',
        buttonLabel: '比较档位',
        preview: { productionBefore: finite(production.baseAuto), productionAfter: best.preview.baseAuto,
          incomeBefore: income, incomeAfter: best.preview.baseIncome }
      };
    }
  }
  if (next && ordersMissing === 0) {
    const missingCoins = Math.max(0, finite(next.cost) - coins);
    const beforeSeconds = income > 0 ? missingCoins / income : Infinity;
    let best = null;
    for (const key of ['auto', 'value']) {
      const upgrade = upgrades.find(item => item.key === key);
      if (!affordable(upgrade)) continue;
      const afterIncome = key === 'auto' ? finite(upgrade.preview.after) : finite(production.baseAuto) * finite(upgrade.preview.after);
      if (!(afterIncome > income)) continue;
      const afterSeconds = (missingCoins + finite(upgrade.cost)) / afterIncome;
      // Require a meaningful strict improvement, avoiding floating-point ties.
      if (!Number.isFinite(beforeSeconds) || !(afterSeconds < beforeSeconds - Math.max(1e-9, beforeSeconds * 1e-12))) continue;
      if (!best || afterSeconds < best.afterSeconds) best = { upgrade, afterSeconds };
    }
    const investment = crafts.filter(item => item.canBuy && item.preview.before > 0).map(item => ({item,
      seconds: (missingCoins + item.cost) / (income * item.preview.after / item.preview.before)
    })).filter(item => item.seconds < beforeSeconds).sort((a,b) => a.seconds - b.seconds)[0];
    if (investment && (!best || investment.seconds < best.afterSeconds)) return craftStep(investment.item, '攒钱提速 · 按常驻收入估算',
      { basis:'permanent-auto-income', beforeSeconds, afterSeconds:investment.seconds });
    if (best) return upgradeStep(best.upgrade, '攒钱目标 · 自动收入估算', {
      estimate: { basis: 'permanent-auto-income', beforeSeconds, afterSeconds: best.afterSeconds }
    });
    return {
      id: 'save:machine:' + next.id, kind: 'save', action: 'machine', enabled: true,
      title: '为换代攒钱', detail: '还差 ' + amount(missingCoins) + ' 金币', reason: next.name,
      buttonLabel: '查看设备', cost: next.cost, missingCoins
    };
  }

  const upgrade = ['auto', 'tap'].map(key => upgrades.find(item => item.key === key)).find(usable);
  // Once the equipment fund is complete, only surplus may be spent while
  // waiting for orders; guidance must not undo an already-met requirement.
  if (next && coins >= finite(next.cost) && (!upgrade || coins - finite(upgrade.cost) < finite(next.cost))) {
    const surplusCraft=crafts.find(item => item.canBuy && coins-item.cost>=next.cost && item.key==='yield') || crafts.find(item => item.canBuy && coins-item.cost>=next.cost);
    if(surplusCraft)return craftStep(surplusCraft,'仅用余款强化，保留换代金币');
    return orderStep('金币已备齐，先完成订单');
  }
  if (upgrade) return upgradeStep(upgrade,
    upgrade.key === 'auto' ? '订单目标 · 常驻产量提升' : '订单目标 · 每次点击更多', { forOrder: !!order });
  const craft = crafts.find(item => item.canBuy && item.key === 'yield') || crafts.find(item => item.canBuy) || crafts[0];
  if (craft) return craftStep(craft, craft.key === 'yield' ? '提高产量，推进后续订单' : '提高售价，积累工厂资金');
  return order ? orderStep('永久生产升级已满级') : produceStep('永久生产升级已满级');
}

module.exports = { selectNextStep };
