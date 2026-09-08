'use strict';
// Read-only presentation and session diagnostics. This module never changes a save,
// grants a reward, advances time, or owns a platform/network dependency.
const REWARD_KINDS = ['turbo', 'order', 'sponsor', 'offline', 'brand'];
const AD_REASONS = ['completed', 'simulated-complete', 'cancelled', 'failed', 'timeout', 'unavailable', 'busy', 'simulation-choice-required'];
const UPGRADE_KEYS = ['tap', 'auto', 'value'];
const { selectRecoveryLesson } = require('./heat-guide');
const copy = value => JSON.parse(JSON.stringify(value));
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const label = value => typeof value === 'string' ? value.slice(0, 160) : '';
const shown = value => {
  const n = Math.max(0, Math.ceil(number(value)));
  if (n < 10000) return n.toLocaleString('zh-CN');
  if (n < 1e8) return +(n / 1e4).toFixed(2) + '万';
  return +(n / 1e8).toFixed(2) + '亿';
};

function selectCurrentTarget(view, ui = {}) {
  const quests = view.quests ? view.quests.chapters.flatMap(chapter => chapter.quests) : [];
  const usable = quest => quest && !quest.claimed && !quest.locked;
  const questTarget = quest => ({
    id: quest.id, source: 'quest', title: quest.title,
    text: quest.ready ? '目标已达成，领取 ' + shown(quest.reward) + ' 金币。' : quest.hint || quest.description,
    action: quest.ready ? 'questClaim:' + quest.id : quest.action,
    ready: !!quest.ready, reward: quest.reward
  });
  const tracked = quests.find(quest => quest.id === ui.questGuideId && usable(quest));
  if (tracked) return questTarget(tracked);
  const orderTarget = () => ({
    id: 'order:' + view.order.index + ':' + Number(!!view.order.isLoop), source: 'order',
    title: '订单可以装车了', text: '打开订单，直接装车领取 ' + shown(view.order.reward) + ' 金币。', action: 'order', ready: true
  });
  if (view.order && view.order.ready && view.state.orderIndex === 0) return orderTarget();
  if (view.canEvolve && view.goal) return { ...view.goal, id: 'machine:' + view.nextMachine.id, source: 'machine', ready: true };
  const readyQuest = quests.find(quest => usable(quest) && quest.ready);
  if (readyQuest) return questTarget(readyQuest);
  if (view.tutorial) return { ...view.tutorial, id: 'tutorial:' + view.tutorial.step, source: 'tutorial', ready: false };
  if (view.order && view.order.ready) return orderTarget();
  const research=view.research,trial=research&&research.active;
  const researchTarget=()=>({id:trial?trial.id:'research:available',source:'research',
    title:trial?trial.ready?'研发完成 · 永久提升':trial.projectName+'试制中':'解锁新的风味课题',
    text:trial?trial.ready?'免费验收，让工厂的永久能力再升一级。':'新增生产 '+shown(trial.production)+' / '+shown(trial.productionTarget)+' 份':'选择产量或售价路线，正常生产即可永久变强。',
    action:'research',ready:!!(trial&&trial.ready)});
  if(trial&&trial.ready)return researchTarget();
  const delivery=view.deliveries,part=delivery&&delivery.stages.find(item=>item.ready&&!item.claimed);
  if(part)return {id:'delivery:'+delivery.orderIndex+':'+part.stage,source:'delivery',title:'分段交付可以领奖了',
    text:'提前领取 '+shown(part.coins)+' 金币，计入本单总奖。',action:'order',ready:true,reward:part.coins};
  const active=view.commissions&&view.commissions.active;
  const commissionTarget=()=>({id:active.id,source:'commission',title:active.ready?'委托奖励可以领取了':active.title,
    text:active.ready?'领取额外奖励 '+shown(active.reward)+' 金币。':active.kind==='bulk'?'新增生产 '+shown(Math.min(active.production,active.productionTarget))+' / '+shown(active.productionTarget)+' 份':'完美爆锅 '+Math.min(active.perfect,active.perfectTarget)+' / '+active.perfectTarget+' 次'+(active.recoveryTarget>0?' · 余热 '+Math.min(active.recovery,active.recoveryTarget)+' / '+active.recoveryTarget:'')+'。',
    action:'commissions',ready:!!active.ready,reward:active.reward});
  if(active&&active.ready)return commissionTarget();
  const lesson = selectRecoveryLesson(view);
  if (lesson) return lesson;
  if(trial)return researchTarget();
  if(active)return commissionTarget();
  if(research&&research.unlocked&&!research.complete&&(view.upgrades||[]).every(item=>item.level>=item.maxLevel))return researchTarget();
  const collection=view.souvenirs;
  const equipmentComplete=!view.nextMachine&&(view.upgrades||[]).every(item=>item.level>=item.maxLevel)&&(!view.refinements||view.refinements.options.every(item=>item.level>=item.maxLevel));
  if(collection&&collection.unlocked&&!collection.complete&&equipmentComplete){
    const item=collection.options.find(option=>!option.owned&&option.canBuy)||collection.options.find(option=>!option.owned);
    if(item)return {id:'souvenir:'+item.key,source:'souvenir',title:'竣工后的工厂，由你布置',
      text:item.canBuy?item.name+' · '+shown(item.cost)+' 金币':view.state.loopIndex<item.requiredLoops?'再完成 '+(item.requiredLoops-view.state.loopIndex)+' 张循环订单':'为'+item.name+'再攒 '+shown(item.cost-view.state.coins)+' 金币',
      action:'souvenirs',ready:false};
  }
  if (view.goal) return { ...view.goal, id: view.nextMachine ? 'machine:' + view.nextMachine.id : 'order:' + view.order.index,
    source: view.nextMachine ? 'machine' : 'order', ready: false };
  return null;
}

function snapshot(view) {
  const s = view.state || {}, upgrades = s.upgrades || {};
  return {
    playedSeconds: number(s.playedSeconds), coins: number(s.coins), totalCoins: number(s.totalCoins),
    totalProduced: number(s.totalProduced), taps: number(s.taps), bursts: number(s.bursts),
    upgradeLevels: UPGRADE_KEYS.reduce((sum, key) => sum + number(upgrades[key]), 0),
    upgrades: Object.fromEntries(UPGRADE_KEYS.map(key => [key, number(upgrades[key])])),
    orders: number(s.orderIndex), loopOrders: number(s.loopIndex), machine: number(s.machine),
    rewardedCount: number(s.rewardedCount), brandLevel: number(s.brandLevel),
    productionMode: ['balanced','rush','premium'].includes(s.productionMode) ? s.productionMode : 'balanced',
    heatRecoveryTaps: number(s.heatRecoveryTaps),
    heatRecoveryUses: number(s.learning && s.learning.heatRecoveryUses),
    refinementLevels: number(s.refinements && s.refinements.yield) + number(s.refinements && s.refinements.value),
    deliveredStages: view.deliveries ? view.deliveries.stages.filter(item=>item.claimed).length : 0,
    deliveryReadyCount: number(view.deliveries&&view.deliveries.readyCount),
    commissionKind: label(view.commissions&&view.commissions.active&&view.commissions.active.kind),
    commissionProgress: number(view.commissions&&view.commissions.active&&view.commissions.active.progress),
    commissionRemaining: number(view.commissions&&view.commissions.remaining),
    souvenirsOwned: number(view.souvenirs&&view.souvenirs.ownedCount),
    researchLevels: number(view.research&&view.research.totalLevels),
    researchProgress: number(view.research&&view.research.active&&view.research.active.progress),
    baseIncome: number(view.production && view.production.baseIncome)
  };
}

function recommendationSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const clean = {};
  for (const key of ['id', 'kind', 'action', 'title', 'detail', 'reason', 'buttonLabel']) clean[key] = label(value[key]);
  if (!clean.id || !clean.kind) return null;
  clean.enabled = value.enabled === true;
  if (UPGRADE_KEYS.includes(value.upgradeKey)) clean.upgradeKey = value.upgradeKey;
  for (const key of ['cost', 'missingCoins']) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) clean[key] = Math.max(0, value[key]);
  }
  const estimate = value.estimate;
  if (estimate && estimate.basis === 'permanent-auto-income' &&
      ['beforeSeconds', 'afterSeconds'].every(key => typeof estimate[key] === 'number' && Number.isFinite(estimate[key]) && estimate[key] >= 0)) {
    clean.estimate = { basis: estimate.basis, beforeSeconds: estimate.beforeSeconds, afterSeconds: estimate.afterSeconds };
  }
  return clean;
}

function createExperienceTracker(options = {}) {
  const track = typeof options.track === 'function' ? options.track : () => {};
  const maxEvents = Math.max(16, Math.min(2000, Math.floor(number(options.maxEvents) || 400)));
  const maxPending = Math.max(1, Math.min(200, Math.floor(number(options.maxPending) || 80)));
  const outcomeSeconds = Math.max(1, Math.min(300, number(options.outcomeSeconds) || 30));
  const milestones = {}, tutorialSteps = [], events = [], pending = [], rewardedIds = [];
  const ads = Object.fromEntries(REWARD_KINDS.map(kind => [kind, {
    impressions: 0, unavailableImpressions: 0, clicks: 0, requests: 0, completions: 0,
    cancellations: 0, failures: 0, grants: 0, coinsGranted: 0, outcomes: 0
  }]));
  let baseline = options.initialView ? snapshot(options.initialView) : null;
  let current = baseline ? copy(baseline) : null, target = null, lastTarget = '', lastTutorial = '';
  let recommendation = null, lastRecommendation = '', lastProgressionSurface = '';
  let visibleEntries = new Map(), recentReward = null, sequence = 0;
  let droppedEvents = 0, droppedOutcomes = 0, trackingErrors = 0;

  function emit(event, view, data = {}) {
    const playedSeconds = number(view.state && view.state.playedSeconds);
    const clean = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') clean[key] = label(value);
      else if (typeof value === 'boolean') clean[key] = value;
      else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    }
    const entry = { sequence: ++sequence, event, playedSeconds, data: clean };
    events.push(entry);
    if (events.length > maxEvents) { events.shift(); droppedEvents++; }
    // External diagnostics must never interrupt a successful game action.
    try { track(event, { ...clean, playedSeconds }); } catch (_) { trackingErrors++; }
    return entry;
  }
  function attribution(view) {
    if (!recentReward) return {};
    const elapsed = number(view.state.playedSeconds) - recentReward.playedSeconds;
    return elapsed >= 0 && elapsed <= 60 ? { lastRewardKind: recentReward.kind, secondsSinceReward: elapsed } : {};
  }
  function update(view) {
    const next = snapshot(view);
    if (!baseline) baseline = copy(next);
    if (current && next.playedSeconds < current.playedSeconds) {
      droppedOutcomes += pending.length; pending.length = 0; recentReward = null;
      visibleEntries.clear(); lastTarget = ''; lastTutorial = '';
      recommendation = null; lastRecommendation = '';
      lastProgressionSurface = '';
      emit('experience_observation_reset', view, { previousSeconds: current.playedSeconds });
    }
    current = next;
  }
  function milestone(name, view, field, isFirstEvent = false) {
    if (milestones[name] || !current || current[field] <= 0) return;
    // Existing-save progress is baseline, not a newly achieved first-session step.
    if (baseline[field] > 0 && !isFirstEvent) return;
    milestones[name] = copy(emit('experience_milestone', view, { name, ...attribution(view) }));
  }
  function reward(event, view) {
    const kind = event.kind;
    if (!REWARD_KINDS.includes(kind)) return;
    const id = label(event.id);
    if (id && rewardedIds.includes(id)) return;
    if (id) { rewardedIds.push(id); if (rewardedIds.length > 128) rewardedIds.shift(); }
    recentReward = { kind, id, playedSeconds: current.playedSeconds };
    ads[kind].grants++; ads[kind].coinsGranted += number(event.coins);
    emit('experience_reward_granted', view, { kind, id, amount: number(event.amount), coins: number(event.coins),
      brandLevel: current.brandLevel, baseIncome: current.baseIncome });
    pending.push({ kind, id, at: current.playedSeconds, due: current.playedSeconds + outcomeSeconds, before: copy(current) });
    if (pending.length > maxPending) { pending.shift(); droppedOutcomes++; }
  }
  function recordEvent(event, view) {
    if (!event || !view || !view.state) return;
    update(view);
    if (event.type === 'reward') reward(event, view);
    if (event.type === 'produce' && event.source === 'tap') milestone('first_tap', view, 'taps', current.taps === 1);
    if (event.type === 'upgrade') milestone('first_upgrade', view, 'upgradeLevels', current.upgradeLevels === 1);
    if (event.type === 'burst') milestone('first_burst', view, 'bursts', current.bursts === 1);
    if (event.type === 'order' && !event.isLoop) milestone('first_order', view, 'orders', current.orders === 1);
    if (event.type === 'evolve') milestone('first_evolve', view, 'machine', current.machine === 1);
    if (event.type === 'productionMode') emit('experience_production_mode', view, {
      from: event.from, to: event.to, machine: current.machine, orderIndex: current.orders,
      baseAuto: number(view.production && view.production.baseAuto), baseIncome: current.baseIncome,
      orderReady: !!(view.order && view.order.ready), ...attribution(view)
    });
    if (event.type === 'timing') emit('experience_timing', view, { perfect: event.perfect === true,
      energy: number(event.energy), bonusPercent: number(event.bonusPercent), burstNumber: number(event.burstNumber) });
    if (event.type === 'burst' && event.perfect === true && event.heatRecoveryTaps > 0) emit('experience_heat_recovery', view, {
      grantedTaps: number(event.heatRecoveryTaps), machine: current.machine, tapLevel: current.upgrades.tap
    });
    if(event.type==='delivery')emit('experience_delivery',view,{stage:number(event.stage),coins:number(event.coins),orderIndex:current.orders});
    if(event.type==='commission')emit('experience_commission',view,{action:event.action,id:event.id,kind:event.kind,coins:number(event.coins),orderIndex:current.orders});
    if(event.type==='souvenir')emit('experience_souvenir',view,{key:event.key,cost:number(event.cost),ownedCount:current.souvenirsOwned,loopOrders:current.loopOrders});
    if(event.type==='research')emit('experience_research',view,{action:event.action,id:event.id,key:event.key,level:number(event.level),before:number(event.before),after:number(event.after),totalLevels:current.researchLevels});
    if (['upgrade', 'upgradeBatch', 'refinement', 'order', 'evolve'].includes(event.type)) emit('experience_progress', view, {
      kind: event.type, key: event.key, level: event.level, orderIndex: current.orders, machine: current.machine,
      ...(event.type === 'upgradeBatch' ? { count: number(event.count), fromLevel: number(event.fromLevel), cost: number(event.cost) } : {}), ...attribution(view)
    });
  }
  function recordEvents(batch, view) {
    // Order ads emit an order event before reward in the core. Register its verified
    // grant first so the same transaction receives the correct most-recent kind.
    for (const event of batch) if (event.type === 'reward') recordEvent(event, view);
    for (const event of batch) if (event.type !== 'reward') recordEvent(event, view);
  }
  function recordAdClick(kind, view, detail = {}) {
    if (!REWARD_KINDS.includes(kind) || !view || !view.state) return;
    update(view); ads[kind].clicks++;
    emit('experience_ad_click', view, { kind, placement: label(detail.placement || 'unknown'),
      available: !!(view.rewards && view.rewards[kind] && view.rewards[kind].available) });
  }
  function recordAdRequest(kind, view) {
    if (!REWARD_KINDS.includes(kind) || !view || !view.state) return;
    update(view); ads[kind].requests++;
    emit('experience_ad_request', view, { kind });
  }
  function recordAdResult(kind, response, view) {
    if (!REWARD_KINDS.includes(kind) || !view || !view.state) return;
    update(view);
    const result = response && typeof response === 'object' ? response : {};
    const completed = result.completed === true;
    // Only known platform status codes are retained. Never store SDK error
    // messages, identifiers, URLs, or arbitrary fields from an ad response.
    const reason = AD_REASONS.includes(result.reason) ? result.reason : completed ? 'completed' : 'unknown';
    const outcome = completed ? 'complete' : reason === 'cancelled' ? 'cancel' : 'fail';
    ads[kind][completed ? 'completions' : outcome === 'cancel' ? 'cancellations' : 'failures']++;
    // Completion is a platform observation, not proof that core applied a grant.
    // Only the separate reward event sets attribution or starts a progress window.
    emit('experience_ad_result', view, { kind, outcome, completed, reason, simulated: result.simulated === true });
  }
  function observe(view, detail = {}) {
    if (!view || !view.state) return;
    update(view);
    // A 30-second outcome is observational. It includes intervening actions and
    // rewards; it must not be reported as the ad's causal or incremental return.
    for (let i = pending.length - 1; i >= 0; i--) {
      const item = pending[i];
      if (current.playedSeconds < item.due) continue;
      const before = item.before;
      emit('experience_reward_progress', view, {
        kind: item.kind, id: item.id, windowSeconds: outcomeSeconds, elapsedSeconds: current.playedSeconds - item.at,
        coinsChange: current.coins - before.coins, coinsEarned: current.totalCoins - before.totalCoins,
        produced: current.totalProduced - before.totalProduced, upgradeLevels: current.upgradeLevels - before.upgradeLevels,
        tapLevels: current.upgrades.tap - before.upgrades.tap, autoLevels: current.upgrades.auto - before.upgrades.auto,
        valueLevels: current.upgrades.value - before.upgrades.value, orders: current.orders - before.orders,
        loopOrders: current.loopOrders - before.loopOrders, machines: current.machine - before.machine,
        baseIncomeChange: current.baseIncome - before.baseIncome, interveningRewards: current.rewardedCount - before.rewardedCount
      });
      ads[item.kind].outcomes++; pending.splice(i, 1);
    }
    const visible = detail.visible !== false;
    const surface=visible&&(detail.modalType||(detail.ui&&detail.ui.modal&&detail.ui.modal.type));
    const active=view.commissions&&view.commissions.active;
    const progressionSurface=['order','commissions','souvenirs','research'].includes(surface)?{
      surface,orderIndex:current.orders,deliveryReadyCount:current.deliveryReadyCount,
      commissionKind:current.commissionKind,commissionReady:!!(active&&active.ready),
      commissionAvailable:!!(view.commissions&&view.commissions.available),commissionRemaining:current.commissionRemaining,
      souvenirsOwned:current.souvenirsOwned,
      ...(surface==='research'?{researchLevels:current.researchLevels,researchId:view.research&&view.research.active&&view.research.active.id||'',researchReady:!!(view.research&&view.research.active&&view.research.active.ready)}:{})
    }:null;
    const progressionKey=progressionSurface?JSON.stringify(progressionSurface):'';
    if(progressionKey&&progressionKey!==lastProgressionSurface)emit('experience_progression_visible',view,progressionSurface);
    lastProgressionSurface=progressionKey;
    target = !visible ? null : detail.target === undefined ? selectCurrentTarget(view, detail.ui || {}) : detail.target;
    const targetKey = visible && target ? [target.source, target.id, target.action].join('|') : '';
    if (targetKey && targetKey !== lastTarget) emit('experience_target_visible', view, {
      id: target.id, source: target.source, action: target.action, title: target.title, ready: !!target.ready
    });
    lastTarget = targetKey;
    // Observe only the card actually supplied by the renderer. Dynamic prices,
    // countdowns and copy update the report without creating per-frame events.
    recommendation = visible ? recommendationSnapshot(detail.recommendation) : null;
    const recommendationKey = recommendation ? JSON.stringify([
      recommendation.id, recommendation.kind, recommendation.action, recommendation.enabled, recommendation.upgradeKey || ''
    ]) : '';
    if (recommendationKey && recommendationKey !== lastRecommendation) emit('experience_recommendation_visible', view, recommendation);
    lastRecommendation = recommendationKey;
    const tutorialKey = visible && target && target.source === 'tutorial' && view.tutorial ? String(view.tutorial.step) : '';
    if (tutorialKey && tutorialKey !== lastTutorial) {
      if (!tutorialSteps.includes(view.tutorial.step)) tutorialSteps.push(view.tutorial.step);
      emit('experience_tutorial_step', view, { step: view.tutorial.step, action: view.tutorial.action });
    }
    lastTutorial = tutorialKey;
    const nextEntries = new Map();
    for (const entry of visible ? detail.adEntries || [] : []) {
      const kind = typeof entry === 'string' ? entry.replace(/^ad:/, '') : entry.kind;
      if (!REWARD_KINDS.includes(kind) || entry.visible === false) continue;
      const offer = view.rewards && view.rewards[kind] || {};
      const placement = typeof entry === 'string' ? 'unknown' : label(entry.placement || 'unknown');
      const available = typeof entry.available === 'boolean' ? entry.available : !!offer.available;
      const reason = label(entry.reason || offer.reason || '');
      const key = kind + ':' + placement, signature = key + ':' + available + ':' + reason;
      if (nextEntries.has(key)) continue;
      nextEntries.set(key, signature);
      if (visibleEntries.get(key) === signature) continue;
      ads[kind][available ? 'impressions' : 'unavailableImpressions']++;
      emit('experience_ad_entry', view, { kind, placement, available, reason });
    }
    visibleEntries = nextEntries;
  }
  function exportReport() {
    return copy({ version: 1, scope: 'local-session', timing: 'game-played-seconds',
      attribution: 'Most recent granted reward within 60 game seconds; progress is observed, not causal.',
      outcomeSeconds, baseline, current, target, recommendation, milestones, tutorialSteps, ads, recentReward,
      pendingOutcomes: pending.map(({ before, ...item }) => item), events,
      droppedEvents, droppedOutcomes, trackingErrors });
  }
  return { observe, recordEvent, recordEvents, recordAdClick, recordAdRequest, recordAdResult, export: exportReport };
}

module.exports = { selectCurrentTarget, createExperienceTracker };

