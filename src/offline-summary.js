'use strict';
// Preview the ordinary offline claim only. It never claims, advances a clock,
// changes the supplied view, or includes the optional advertisement reward.
const { CONFIG, formatNumber } = require('./core');
const { selectNextStep } = require('./next-step');
const amount = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1e150, value)) : 0;
const fraction = value => Math.max(0, Math.min(1, value));

function selectOfflineSummary(view) {
  if (!view || !view.offline || !view.state) return null;
  const pending = view.offline, state = view.state, order = view.order, next = view.nextMachine;
  const coins = amount(pending.coins), production = amount(pending.production);
  const coinsAfter = amount(amount(state.coins) + coins);
  const producedAfter = amount(amount(state.totalProduced) + production);
  const previousTarget = !order ? 0 : order.isLoop
    ? amount(CONFIG.orders[CONFIG.orders.length - 1].target * Math.pow(1.35, Math.min(amount(state.loopIndex), 1000)))
    : state.orderIndex > 0 ? CONFIG.orders[state.orderIndex - 1].target : 0;
  const progress = total => order ? fraction((total - previousTarget) / Math.max(1, order.target - previousTarget)) : 0;
  const readyAfter = !!order && producedAfter >= order.target;
  const projected = {
    ...view, offline: null,
    state: { ...state, coins: coinsAfter, totalProduced: producedAfter, offline: null },
    order: order ? { ...order, ready: readyAfter, stageProgress: progress(producedAfter) } : null,
    upgrades: (view.upgrades || []).map(upgrade => ({ ...upgrade,
      canBuy: upgrade.level < upgrade.maxLevel && coinsAfter >= upgrade.cost })),
    canEvolve: !!next && state.orderIndex >= next.requiredOrders && coinsAfter >= next.cost
  };
  let nextStep;
  if (readyAfter) {
    nextStep = { title: '领取后可装车', detail: order.name + ' · 奖励 ' + formatNumber(order.reward) + ' 金币', action: 'order', buttonLabel: '查看订单' };
  } else if (projected.canEvolve) {
    nextStep = { title: '领取后可换代', detail: next.name + '的金币和订单已备齐', action: 'machine', buttonLabel: '查看设备' };
  } else {
    const step = selectNextStep(projected, view.tutorial && view.tutorial.upgradeKey ? view.tutorial : null, {suppressModeAdvice:true});
    if (step.kind === 'upgrade') {
      const upgrade = projected.upgrades.find(item => item.key === step.upgradeKey);
      nextStep = step.enabled
        ? { title: '领取后可升级' + upgrade.name, detail: step.detail, action: 'upgrades', buttonLabel: '查看升级' }
        : { title: '领取后继续攒升级', detail: upgrade.name + '还差 ' + formatNumber(Math.ceil(step.missingCoins)) + ' 金币', action: 'upgrades', buttonLabel: '查看升级' };
    } else if (step.kind === 'save') {
      nextStep = { title: '领取后继续攒换代', detail: next.name + '还差 ' + formatNumber(Math.ceil(step.missingCoins)) + ' 金币', action: 'machine', buttonLabel: '查看设备' };
    } else {
      nextStep = { title: '领取后继续生产', detail: order ? '本单还差 ' + formatNumber(Math.ceil(Math.max(0, order.target - producedAfter))) + ' 份' : step.detail, action: 'close', buttonLabel: '继续经营' };
    }
  }
  return {
    production, coins, coinsAfter,
    order: order ? { name: order.name, readyBefore: !!order.ready, readyAfter,
      progressBefore: progress(amount(state.totalProduced)), progressAfter: progress(producedAfter),
      missingProduction: Math.max(0, order.target - producedAfter) } : null,
    nextStep,
    ruleText: '常驻自动产能的 50%，最多 8 小时。\n按离开时档位计算；广告只翻倍金币。'
  };
}
module.exports = { selectOfflineSummary };
