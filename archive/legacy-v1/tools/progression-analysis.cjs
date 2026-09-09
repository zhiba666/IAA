// Retired with the v2 pipeline; archived reports remain historical evidence.
throw new Error('此脚本对应已停用的旧玩法。新生产线技术检查请运行 npm test；正式试玩请运行 npm start。');
'use strict';
// Historical delivery/commission analysis; never overwrite its old reports with current rules.
function retiredAnalysis() { throw new Error('历史交付与委托分析已停用，不适用于当前合同与自动爆锅规则；请运行 node tests/balance.cjs。原报告仅作历史记录。'); }
// Reproducible canonical-action simulations; fixed strategies are not human playtests.
// node tools/progression-analysis.cjs --output artifacts/progression-analysis.json
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Game, CONFIG } = require('../src/core');
const { scheduledTaps } = require('./midgame-analysis.cjs');
const NOW = 1000000, LIMIT = 172800;
// Captured before this feature change with tools/late-growth-analysis.cjs.
const BASELINE = {
  coreSha256: "15d62bceee27da9d987792f8e6542c3092c68636d7f6d27e9a91231ce03e4d71",
  routes: [
    { tapsPerSecond: 2, policy: "balanced", completedSeconds: 2778,
      orders: [{"number":1,"seconds":12,"machine":0},{"number":2,"seconds":20,"machine":0},{"number":3,"seconds":32,"machine":0},{"number":4,"seconds":44,"machine":0},{"number":5,"seconds":72,"machine":1},{"number":6,"seconds":93,"machine":1},{"number":7,"seconds":120,"machine":1},{"number":8,"seconds":169,"machine":2},{"number":9,"seconds":200,"machine":2},{"number":10,"seconds":240,"machine":2},{"number":11,"seconds":460,"machine":3},{"number":12,"seconds":552,"machine":3},{"number":13,"seconds":660,"machine":3},{"number":14,"seconds":819,"machine":3},{"number":15,"seconds":988,"machine":4},{"number":16,"seconds":1162,"machine":4},{"number":17,"seconds":1465,"machine":4},{"number":18,"seconds":1938,"machine":4},{"number":19,"seconds":2346,"machine":5},{"number":20,"seconds":2778,"machine":5}],
      machines: [{"machine":1,"seconds":66,"upgrades":{"tap":8,"auto":7,"value":7},"refinements":{"yield":0,"value":0}},{"machine":2,"seconds":160,"upgrades":{"tap":13,"auto":12,"value":12},"refinements":{"yield":0,"value":0}},{"machine":3,"seconds":390,"upgrades":{"tap":18,"auto":18,"value":18},"refinements":{"yield":0,"value":0}},{"machine":4,"seconds":932,"upgrades":{"tap":24,"auto":24,"value":24},"refinements":{"yield":0,"value":0}},{"machine":5,"seconds":2120,"upgrades":{"tap":24,"auto":24,"value":24},"refinements":{"yield":2,"value":2}}] },
    { tapsPerSecond: 2, policy: "goal-switch", completedSeconds: 2580,
      orders: [{"number":1,"seconds":12,"machine":0},{"number":2,"seconds":20,"machine":0},{"number":3,"seconds":32,"machine":0},{"number":4,"seconds":44,"machine":0},{"number":5,"seconds":72,"machine":1},{"number":6,"seconds":93,"machine":1},{"number":7,"seconds":120,"machine":1},{"number":8,"seconds":167,"machine":2},{"number":9,"seconds":195,"machine":2},{"number":10,"seconds":229,"machine":2},{"number":11,"seconds":432,"machine":3},{"number":12,"seconds":515,"machine":3},{"number":13,"seconds":613,"machine":3},{"number":14,"seconds":751,"machine":3},{"number":15,"seconds":940,"machine":4},{"number":16,"seconds":1083,"machine":4},{"number":17,"seconds":1349,"machine":4},{"number":18,"seconds":1740,"machine":4},{"number":19,"seconds":2211,"machine":5},{"number":20,"seconds":2580,"machine":5}],
      machines: [{"machine":1,"seconds":66,"upgrades":{"tap":8,"auto":7,"value":7},"refinements":{"yield":0,"value":0}},{"machine":2,"seconds":160,"upgrades":{"tap":13,"auto":12,"value":12},"refinements":{"yield":0,"value":0}},{"machine":3,"seconds":360,"upgrades":{"tap":18,"auto":18,"value":18},"refinements":{"yield":0,"value":0}},{"machine":4,"seconds":889,"upgrades":{"tap":24,"auto":24,"value":24},"refinements":{"yield":0,"value":0}},{"machine":5,"seconds":2042,"upgrades":{"tap":24,"auto":24,"value":24},"refinements":{"yield":2,"value":2}}] },
    { tapsPerSecond: 0.2, policy: "balanced", completedSeconds: 4572,
      orders: [{"number":1,"seconds":46,"machine":0},{"number":2,"seconds":69,"machine":0},{"number":3,"seconds":93,"machine":0},{"number":4,"seconds":136,"machine":0},{"number":5,"seconds":189,"machine":1},{"number":6,"seconds":225,"machine":1},{"number":7,"seconds":286,"machine":1},{"number":8,"seconds":373,"machine":2},{"number":9,"seconds":430,"machine":2},{"number":10,"seconds":500,"machine":2},{"number":11,"seconds":847,"machine":3},{"number":12,"seconds":990,"machine":3},{"number":13,"seconds":1148,"machine":3},{"number":14,"seconds":1394,"machine":3},{"number":15,"seconds":1679,"machine":4},{"number":16,"seconds":1964,"machine":4},{"number":17,"seconds":2452,"machine":4},{"number":18,"seconds":3215,"machine":4},{"number":19,"seconds":3878,"machine":5},{"number":20,"seconds":4572,"machine":5}],
      machines: [{"machine":1,"seconds":176,"upgrades":{"tap":6,"auto":8,"value":7},"refinements":{"yield":0,"value":0}},{"machine":2,"seconds":358,"upgrades":{"tap":10,"auto":13,"value":12},"refinements":{"yield":0,"value":0}},{"machine":3,"seconds":748,"upgrades":{"tap":15,"auto":19,"value":18},"refinements":{"yield":0,"value":0}},{"machine":4,"seconds":1588,"upgrades":{"tap":24,"auto":24,"value":24},"refinements":{"yield":0,"value":0}},{"machine":5,"seconds":3515,"upgrades":{"tap":24,"auto":24,"value":24},"refinements":{"yield":2,"value":2}}] },
    { tapsPerSecond: 0.2, policy: "goal-switch", completedSeconds: 4245,
      orders: [{"number":1,"seconds":46,"machine":0},{"number":2,"seconds":69,"machine":0},{"number":3,"seconds":93,"machine":0},{"number":4,"seconds":136,"machine":0},{"number":5,"seconds":189,"machine":1},{"number":6,"seconds":225,"machine":1},{"number":7,"seconds":286,"machine":1},{"number":8,"seconds":371,"machine":2},{"number":9,"seconds":427,"machine":2},{"number":10,"seconds":485,"machine":2},{"number":11,"seconds":794,"machine":3},{"number":12,"seconds":923,"machine":3},{"number":13,"seconds":1072,"machine":3},{"number":14,"seconds":1280,"machine":3},{"number":15,"seconds":1584,"machine":4},{"number":16,"seconds":1825,"machine":4},{"number":17,"seconds":2252,"machine":4},{"number":18,"seconds":2884,"machine":4},{"number":19,"seconds":3644,"machine":5},{"number":20,"seconds":4245,"machine":5}],
      machines: [{"machine":1,"seconds":176,"upgrades":{"tap":6,"auto":8,"value":7},"refinements":{"yield":0,"value":0}},{"machine":2,"seconds":358,"upgrades":{"tap":10,"auto":13,"value":12},"refinements":{"yield":0,"value":0}},{"machine":3,"seconds":699,"upgrades":{"tap":15,"auto":19,"value":18},"refinements":{"yield":0,"value":0}},{"machine":4,"seconds":1505,"upgrades":{"tap":24,"auto":24,"value":24},"refinements":{"yield":0,"value":0}},{"machine":5,"seconds":3376,"upgrades":{"tap":24,"auto":24,"value":24},"refinements":{"yield":2,"value":2}}] }
  ]
};

function expectedRate(p, tapsPerSecond) {
  return (p.baseAuto + p.tap * tapsPerSecond + (CONFIG.passiveEnergy + CONFIG.tapEnergy * tapsPerSecond) / CONFIG.energyMax * (p.tap * 24 + p.baseAuto * 8)) * p.price;
}
function longestGap(events, start, end) {
  const times = [...new Set([start, ...events.filter(e => e.seconds >= start && e.seconds <= end).map(e => e.seconds), end])].sort((a, b) => a - b);
  return Math.max(...times.map((time, index) => index ? time - times[index - 1] : 0));
}
function auditEarnedSave(save) {
  // Fork a legitimately reached state, then use only public actions. The side branch never funds a mainline route.
  const game = new Game({ save, now: NOW });
  assert.equal(game.state.coins, save.coins);
  assert.equal(game.getView().commissions.active.id, save.commissions.active.id, 'An active contract survives save/load');
  assert.equal(game.cancelCommission(game.getView().commissions.active.id).ok, true);
  const initialCoins = game.state.coins, initialSeconds = game.state.playedSeconds;
  for (let cycle = 0; cycle < 12; cycle++) {
    const quote = game.getView().commissions.options.find(option => option.kind === 'bulk');
    assert.equal(game.acceptCommission('bulk', quote).ok, true);
    const id = game.getView().commissions.active.id;
    assert.equal(game.cancelCommission(id).ok, true);
    assert.equal(game.claimCommission(id).ok, false, 'A cancelled contract cannot pay');
    assert.equal(game.acceptCommission('bulk', quote).ok, false, 'A cancelled quote cannot be reused');
    assert.equal(game.state.coins, initialCoins, 'Accept/cancel cycling earns no coins');
  }
  let contractIncome = 0;
  for (let count = 0; count < 3; count++) {
    const quote = game.getView().commissions.options.find(option => option.kind === 'bulk');
    assert.equal(game.acceptCommission('bulk', quote).ok, true);
    const id = game.getView().commissions.active.id;
    while (!game.getView().commissions.active.ready && game.state.playedSeconds - initialSeconds < 3600) {
      game.tap(); game.tap(); game.tick(1); game.drainEvents();
    }
    assert.ok(game.getView().commissions.active.ready, 'Natural production completes an accepted bulk contract');
    const result = game.claimCommission(id); assert.equal(result.ok, true); contractIncome += result.coins;
    assert.equal(game.claimCommission(id).ok, false);
  }
  assert.equal(game.getView().commissions.remaining, 0);
  const quote = game.getView().commissions.options.find(option => option.kind === 'bulk');
  assert.equal(game.acceptCommission('bulk', quote).ok, false, 'A fourth payout cannot be accepted on the same mainline order');
  const restored = new Game({ save: game.exportSave(NOW), now: NOW });
  assert.equal(restored.getView().commissions.remaining, 0, 'Save/load does not reset the payout cap');
  return { orderIndex: game.state.orderIndex, cancelCyclesWithoutIncome: 12, naturallyCompletedContracts: 3,
    durationSeconds: game.state.playedSeconds - initialSeconds, contractIncome, capSurvivesReload: true };
}
function simulate({ tapsPerSecond = 2, policy = 'balanced', features = 'ignore', perfectTiming = features === 'artisan', finishCollection = false } = {}) {
  retiredAnalysis();
  const game = new Game({ now: NOW }), cache = new Map(), orders = [], machines = [], purchases = [], rewards = [], deliveries = [], commissions = [], timing = [], souvenirs = [];
  const ledger = { production: 0, quests: 0, orders: 0, deliveries: 0, commissions: 0, upgrades: 0, refinements: 0, machines: 0, souvenirs: 0 };
  const mainRewards = new Map();
  let mainline = null, collectibleStart = null, staleDeliveryChecked = false, prematureCommissionChecked = false, duplicateCommissionChecked = false, earnedSaveAudit = null;
  function rejectWithoutCoins(call, label) {
    const coins = game.state.coins, result = call();
    assert.equal(result.ok, false, label); assert.equal(game.state.coins, coins, label + ' must not pay');
  }
  function collect() {
    for (const event of game.drainEvents()) {
      const seconds = game.state.playedSeconds, s = game.state;
      if (event.type === 'produce') ledger.production += event.coins;
      if (event.type === 'quest') ledger.quests += event.coins;
      if (event.type === 'order') {
        ledger.orders += event.coins;
        orders.push({ number: event.index + 1, seconds, machine: s.machine, isLoop: event.isLoop, coins: event.coins });
        if (!event.isLoop) mainRewards.set(event.index, (mainRewards.get(event.index) || 0) + event.coins);
      }
      if (event.type === 'upgrade') ledger.upgrades += event.cost;
      if (event.type === 'refinement') ledger.refinements += event.cost;
      if (event.type === 'evolve') {
        ledger.machines += CONFIG.machines[event.machine].cost;
        machines.push({ machine: event.machine, seconds, upgrades: { ...s.upgrades }, refinements: { ...s.refinements } });
      }
      if (['upgrade', 'refinement', 'evolve'].includes(event.type)) purchases.push({ type: event.type, key: event.key || 'machine', level: event.level || event.machine, seconds, orderIndex: s.orderIndex, cost: event.cost || CONFIG.machines[event.machine].cost });
      if (['quest', 'order'].includes(event.type)) rewards.push({ type: event.type, seconds, coins: event.coins });
    }
  }
  function claimQuests() {
    for (;;) {
      const quest = game.getView().quests.chapters.flatMap(chapter => chapter.quests).find(q => q.ready);
      if (!quest) return;
      assert.equal(game.claimQuest(quest.id).ok, true); collect();
    }
  }
  function setMode() {
    const view = game.getView();
    if (!view.productionModes.unlocked) return;
    const desired = policy === 'goal-switch' ? view.nextMachine && game.state.orderIndex >= view.nextMachine.requiredOrders && game.state.coins < view.nextMachine.cost ? 'premium' : 'rush' : policy;
    if (desired !== game.state.productionMode) { assert.equal(game.setProductionMode(desired).ok, true); collect(); }
  }
  function investment() {
    const s = game.state, v = game.getView(), cacheKey = JSON.stringify([s.machine, s.upgrades, s.refinements, s.productionMode, s.orderIndex]);
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const before = expectedRate(v.production, tapsPerSecond), choices = [];
    for (const u of v.upgrades.filter(u => u.level < u.maxLevel)) choices.push({ kind: 'upgrade', key: u.key, cost: u.cost, after: game._production({ upgrades: { ...s.upgrades, [u.key]: u.level + 1 } }) });
    if (v.nextMachine && s.orderIndex >= v.nextMachine.requiredOrders) choices.push({ kind: 'machine', cost: v.nextMachine.cost, after: game._production({ machine: s.machine + 1 }) });
    for (const u of v.refinements.options.filter(u => u.level < u.unlockedLevel)) choices.push({ kind: 'refinement', key: u.key, cost: u.cost, level: u.level, after: game._production({ refinements: { ...s.refinements, [u.key]: u.level + 1 } }) });
    for (const choice of choices) choice.payback = choice.cost / (expectedRate(choice.after, tapsPerSecond) - before);
    choices.sort((a, b) => a.payback - b.payback || a.cost - b.cost);
    const choice = choices[0] || null; cache.set(cacheKey, choice); return choice;
  }
  function claimDeliveries() {
    if (features === 'ignore') return;
    const view = game.getView().deliveries;
    for (const stage of view.stages.filter(stage => stage.ready)) {
      const seconds = game.state.playedSeconds, orderIndex = game.state.orderIndex;
      if (!staleDeliveryChecked) {
        rejectWithoutCoins(() => game.claimDelivery(stage.stage, orderIndex - 1), 'Stale delivery'); staleDeliveryChecked = true;
      }
      const result = game.claimDelivery(stage.stage, orderIndex); assert.equal(result.ok, true);
      assert.equal(result.coins, stage.coins); ledger.deliveries += result.coins;
      mainRewards.set(orderIndex, (mainRewards.get(orderIndex) || 0) + result.coins);
      deliveries.push({ orderIndex, stage: stage.stage, threshold: stage.threshold, seconds, coins: result.coins });
      rewards.push({ type: 'delivery', seconds, coins: result.coins }); collect();
      rejectWithoutCoins(() => game.claimDelivery(stage.stage, orderIndex), 'Duplicate delivery');
      const restored = new Game({ save: game.exportSave(NOW), now: NOW });
      assert.equal(restored.claimDelivery(stage.stage, orderIndex).ok, false, 'Delivery cannot be reclaimed after save/load');
    }
  }
  function claimCommission() {
    if (features === 'ignore') return;
    const active = game.getView().commissions.active;
    if (!active || !active.ready) return;
    const result = game.claimCommission(active.id); assert.equal(result.ok, true); assert.equal(result.coins, active.reward);
    ledger.commissions += result.coins;
    const started = commissions.find(item => item.id === active.id);
    assert.ok(started); Object.assign(started, { completedSeconds: game.state.playedSeconds, completedOrderIndex: game.state.orderIndex, durationSeconds: game.state.playedSeconds - started.acceptedSeconds, coins: result.coins,
      productionCompleted: active.production, perfectCompleted: active.perfect, recoveryCompleted: active.recovery });
    rewards.push({ type: 'commission', seconds: game.state.playedSeconds, coins: result.coins }); collect();
    rejectWithoutCoins(() => game.claimCommission(active.id), 'Duplicate commission'); duplicateCommissionChecked = true;
  }
  function acceptCommission() {
    if (features === 'ignore' || game.state.orderIndex >= 20) return;
    const view = game.getView().commissions;
    if (!view.available || view.active) return;
    const option = view.options.find(option => option.kind === features); assert.ok(option);
    const before = game.state.coins, result = game.acceptCommission(option.kind, option); assert.equal(result.ok, true); assert.equal(game.state.coins, before);
    const active = game.getView().commissions.active; assert.ok(active);
    commissions.push({ ...option, id: active.id, acceptedSeconds: game.state.playedSeconds, mode: game.state.productionMode }); collect();
    if (finishCollection && earnedSaveAudit === null) earnedSaveAudit = auditEarnedSave(game.exportSave(NOW));
    rejectWithoutCoins(() => game.acceptCommission(option.kind, option), 'Double commission acceptance');
    if (!prematureCommissionChecked) { rejectWithoutCoins(() => game.claimCommission(active.id), 'Unfinished commission'); prematureCommissionChecked = true; }
  }
  function buyCollection() {
    if (!finishCollection || game.state.orderIndex < 20 || game.state.machine < 5) return;
    if (collectibleStart === null) collectibleStart = game.state.playedSeconds;
    for (const option of game.getView().souvenirs.options.filter(option => option.canBuy)) {
      const before = game.state.coins, result = game.buySouvenir(option.key, option); assert.equal(result.ok, true);
      assert.equal(before - game.state.coins, option.cost); ledger.souvenirs += option.cost;
      souvenirs.push({ key: option.key, seconds: game.state.playedSeconds, cost: option.cost, loops: game.state.loopIndex });
      collect(); rejectWithoutCoins(() => game.buySouvenir(option.key, option), 'Duplicate souvenir');
    }
  }
  while (game.state.playedSeconds < LIMIT) {
    claimQuests(); claimCommission(); claimDeliveries();
    while (game.getView().order.ready && (game.state.orderIndex < 20 || finishCollection)) {
      claimDeliveries(); assert.equal(game.claimOrder().ok, true); collect(); claimQuests(); claimCommission();
    }
    setMode();
    for (let i = 0; i < 30; i++) {
      const choice = investment(); if (!choice || game.state.coins < choice.cost) break;
      const result = choice.kind === 'machine' ? game.evolve() : choice.kind === 'refinement' ? game.buyRefinement(choice.key, choice) : game.buyUpgrade(choice.key);
      assert.equal(result.ok, true); collect(); claimQuests(); setMode();
    }
    if (game.state.orderIndex >= 20 && game.state.machine >= 5 && mainline === null) mainline = { coins: game.state.coins, ledger: { ...ledger }, seconds: game.state.playedSeconds, taps: game.state.taps };
    buyCollection(); acceptCommission();
    if (mainline && (!finishCollection || game.getView().souvenirs.complete)) break;
    const count = scheduledTaps(game.state.playedSeconds, tapsPerSecond);
    for (let i = 0; i < count; i++) { game.tap(); collect(); }
    game.tick(1); collect();
  }
  assert.ok(mainline, 'The fresh-save route must finish within the limit');
  assert.equal(game.state.taps, Math.floor(game.state.playedSeconds * tapsPerSecond + 1e-9), 'Exact tap cadence');
  const earned = ledger.production + ledger.quests + ledger.orders + ledger.deliveries + ledger.commissions;
  const spent = ledger.upgrades + ledger.refinements + ledger.machines + ledger.souvenirs;
  assert.ok(Math.abs(game.state.coins - (earned - spent)) <= Math.max(1, game.state.coins) * 1e-9, 'Earned coin ledger must reconcile');
  for (let index = 0; index < 20; index++) assert.equal(mainRewards.get(index), CONFIG.orders[index].reward, 'Deliveries plus final claim preserve mainline reward');
  if (features !== 'ignore') {
    assert.equal(deliveries.length, 30, 'All three stages of the final ten mainline orders are claimable');
    assert.ok(commissions.some(item => item.completedSeconds !== undefined), 'Chosen commission must be completable');
    assert.ok(staleDeliveryChecked && prematureCommissionChecked && duplicateCommissionChecked);
    const perOrder = new Map();
    for (const item of commissions.filter(item => item.completedSeconds !== undefined)) perOrder.set(item.completedOrderIndex, (perOrder.get(item.completedOrderIndex) || 0) + 1);
    assert.ok([...perOrder.values()].every(count => count <= 3), 'At most three commission payouts per mainline order');
  }
  if (finishCollection) {
    assert.equal(game.getView().souvenirs.complete, true); assert.equal(souvenirs.length, 3); assert.ok(ledger.souvenirs > 0);
    const restored = new Game({ save: game.exportSave(NOW), now: NOW });
    assert.equal(restored.getView().souvenirs.complete, true, 'Earned collection persists');
    assert.equal(restored.state.coins, game.state.coins);
  }
  const mainOrders = orders.filter(order => !order.isLoop), at = number => mainOrders.find(order => order.number === number).seconds;
  const rewardEvents = [...purchases, ...rewards];
  return { tapsPerSecond, policy, features, perfectTiming, completedSeconds: game.state.completedAt, orders: mainOrders, machines, purchases: purchases.filter(item => item.seconds <= mainline.seconds),
    segments: { order10To11Seconds: at(11) - at(10), order14To18Seconds: at(18) - at(14),
      order10To11LongestRewardOrPurchaseGapSeconds: longestGap(rewardEvents, at(10), at(11)),
      order14To18LongestRewardOrPurchaseGapSeconds: longestGap(rewardEvents, at(14), at(18)),
      lateLongestRewardOrPurchaseGapSeconds: longestGap(rewardEvents, at(14), game.state.completedAt),
      lateLongestPurchaseGapSeconds: longestGap(purchases, at(14), game.state.completedAt) },
    deliveries, commissions, perfectBursts: timing.length, mainlineLedger: { ...mainline.ledger, finalCoins: mainline.coins },
    mainOrderRewardTotals: Object.fromEntries(mainRewards), actualTapCalls: mainline.taps, earnedSaveAudit,
    collection: finishCollection ? { completedSeconds: game.state.playedSeconds, secondsAfterMainline: game.state.playedSeconds - collectibleStart, loopOrders: game.state.loopIndex, souvenirs,
      finalLedger: { ...ledger, finalCoins: game.state.coins }, finalTapCalls: game.state.taps } : null };
}

function run() {
  retiredAnalysis();
  const routes = [], comparisons = [];
  for (const tapsPerSecond of [2, 0.2]) for (const policy of ['balanced', 'goal-switch']) {
    const ignore = simulate({ tapsPerSecond, policy });
    const baseline = BASELINE.routes.find(route => route.tapsPerSecond === tapsPerSecond && route.policy === policy);
    assert.equal(ignore.completedSeconds, baseline.completedSeconds, 'Ignoring optional features preserves completion time');
    assert.deepEqual(ignore.orders.map(({ number, seconds, machine }) => ({ number, seconds, machine })), baseline.orders, 'Ignoring optional features preserves every mainline order');
    assert.deepEqual(ignore.machines, baseline.machines, 'Ignoring optional features preserves every machine purchase');
    const ignorePerfect = simulate({ tapsPerSecond, policy, perfectTiming: true });
    const bulk = simulate({ tapsPerSecond, policy, features: 'bulk', finishCollection: tapsPerSecond === 2 && policy === 'balanced' });
    const artisan = simulate({ tapsPerSecond, policy, features: 'artisan' });
    routes.push(ignore, ignorePerfect, bulk, artisan);
    for (const enhanced of [bulk, artisan]) {
      const control = enhanced.perfectTiming ? ignorePerfect : ignore;
      assert.ok(enhanced.completedSeconds <= control.completedSeconds, 'Optional route must not worsen its matching fixed strategy');
      assert.deepEqual(enhanced.orders.slice(0, 10), control.orders.slice(0, 10), 'Features do not alter the first ten mainline orders');
      comparisons.push({ tapsPerSecond, policy, features: enhanced.features, perfectTimingInBothRoutes: enhanced.perfectTiming,
        originalWithoutTimingSeconds: ignore.completedSeconds, beforeSeconds: control.completedSeconds, afterSeconds: enhanced.completedSeconds,
        beforeSegments: control.segments, afterSegments: enhanced.segments, commissionsAccepted: enhanced.commissions.length,
        commissionsCompleted: enhanced.commissions.filter(item => item.completedSeconds !== undefined).length, perfectBursts: enhanced.perfectBursts });
    }
  }
  return { purpose: 'Controlled canonical-action simulations of optional progression changes, not human playtests or evidence of enjoyment/retention.',
    assumptions: { start: 'Fresh zero-coin save; no state edits, injected funding, energy injection, reward ads, or offline rewards.',
      timestepSeconds: 1, tapping: 'Exactly 2 taps per second or one every 5 seconds. Both policies inspect, buy and claim each second, so sparse tapping is not sparse attention.',
      investment: 'Same shortest marginal permanent-income payback strategy as late-growth-analysis, including available upgrades, machines and refinements.',
      mode: 'balanced throughout; goal-switch uses rush, except premium while saving for an order-eligible next machine.',
      mainline: 'Claim quests, completed commissions and ready delivery stages immediately, then mainline orders; never postpone a mainline claim for a commission.',
      commissions: 'Accept the selected kind immediately after purchases; continue production normally; no cancellations in mainline routes. Up to three payouts per current mainline order; active commissions survive mainline advancement.',
      artisan: 'Historical artisan comparisons used a retired perfect-burst controller. That controller has been removed and this analysis cannot run against current rules.',
      discreteGap: 'Counts mainline/quest/delivery/commission claims and upgrades/refinements/machine purchases; excludes continuous production, taps and automatic bursts.',
      collection: 'Continue the enhanced active balanced route past order 20, claiming loop orders and buying each naturally eligible souvenir with earned coins.' },
    coreSha256: crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../src/core.js'))).digest('hex'), baseline: BASELINE,
    interpretation: {
      conclusion: 'Optional delivery stages and commissions shorten mainline completion and discrete reward gaps under these fixed strategies. Ignoring them preserves all four original order and machine timelines.',
      limitations: [
        'Discrete reward/purchase gaps are not new-ability gaps. In active balanced play the bulk route still has a 702-second purchase gap; the matching perfect-timing artisan route has a 666-second gap versus 660 seconds in its no-feature control.',
        'Perfect timing is ideal scripted execution using natural energy and real actions. It does not measure human timing success, enjoyment, attention demands or retention.',
        'The low-tap routes still buy, inspect and claim once per second; they are not unattended or low-attention playtests.',
        'Three souvenirs give the first three loop orders a concrete currency purpose; completing this finite collection does not create an unlimited endgame economy.'
      ]
    },
    verified: { originalRoutesUnchanged: true, earnedLedgersReconcile: true, mainlineRewardConserved: true, exactTapCadence: true,
      chosenCommissionsComplete: true, limitedCommissionsPerOrder: true, duplicateRewardsRejected: true, staleDeliveryRejected: true,
      cancellationAndReloadCannotResetPayoutCap: true, artisanHasMatchingNoFeatureTimingControl: true, collectionNaturallyCompleted: true }, comparisons, routes };
}
if (require.main === module) {
  const report = run(), arg = process.argv.indexOf('--output');
  if (arg >= 0) {
    assert.ok(process.argv[arg + 1], '--output needs a path');
    const output = path.resolve(process.argv[arg + 1]); assert.equal(output, path.resolve(__dirname, '../artifacts/progression-analysis.json'));
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify({ verified: report.verified, comparisons: report.comparisons,
    collection: report.routes.find(route => route.collection).collection }, null, 2) + '\n');
}
module.exports = { simulate, run };
