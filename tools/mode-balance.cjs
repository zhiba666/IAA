// Retired with the v2 pipeline; archived reports remain historical evidence.
throw new Error('此脚本对应已停用的旧玩法。新生产线技术检查请运行 npm test；正式试玩请运行 npm start。');
'use strict';
// Reproducible policy simulation, not measured player behavior or an optimal strategy.
// Run: node tools/mode-balance.cjs [--output artifacts/mode-balance.json]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Game, CONFIG } = require('../src/core.js');
const { simulate: legacyPolicy } = require('../tests/balance.cjs');
const NOW = 1000000;
const MODE_IDS = ['balanced', 'rush', 'premium'];
const MAX_SECONDS = 172800;
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-10, `${label}: ${actual} vs ${expected}`);
function rate(production, tapsPerSecond) {
  const { tap, baseAuto, price } = production;
  const burstsPerSecond = (CONFIG.passiveEnergy + CONFIG.tapEnergy * tapsPerSecond) / CONFIG.energyMax;
  const units = tap * tapsPerSecond + baseAuto + burstsPerSecond * (24 * tap + 8 * baseAuto);
  return { units, coins: units * price };
}
function snapshot(game) { return game.exportSave(NOW); }
function fromSnapshot(save) { return new Game({ save, now: NOW }); }
function chooseInvestment(game, tapsPerSecond, cache) {
  const view = game.getView();
  const machineEligible = !!view.nextMachine && game.state.orderIndex >= view.nextMachine.requiredOrders;
  const signature = JSON.stringify([game.state.machine, game.state.upgrades, game.state.brandLevel, view.productionModes.current, machineEligible]);
  if (cache.has(signature)) return cache.get(signature);
  const before = rate(view.production, tapsPerSecond).coins;
  const candidates = view.upgrades.filter(u => u.level < u.maxLevel).map(u => ({ key: u.key, cost: u.cost }));
  if (machineEligible) candidates.push({ key: 'machine', cost: view.nextMachine.cost });
  const save = snapshot(game);
  for (const candidate of candidates) {
    // Only the isolated forecast receives hypothetical purchase funds. The real
    // route must earn every coin and purchase through the public core methods.
    const forecastSave = { ...save, coins: Math.max(save.coins, candidate.cost) };
    const forecast = fromSnapshot(forecastSave);
    const result = candidate.key === 'machine' ? forecast.evolve() : forecast.buyUpgrade(candidate.key);
    assert.equal(result.ok, true);
    const delta = rate(forecast.getView().production, tapsPerSecond).coins - before;
    candidate.paybackSeconds = delta > 0 ? candidate.cost / delta : Infinity;
  }
  candidates.sort((a, b) => a.paybackSeconds - b.paybackSeconds || a.cost - b.cost);
  const choice = candidates[0] || null; cache.set(signature, choice); return choice;
}
function desiredMode(game, policy) {
  const view = game.getView();
  if (!view.productionModes.unlocked) return 'balanced';
  if (MODE_IDS.includes(policy)) return policy;
  assert.equal(policy, 'goal-switch');
  // A simple explainable policy, not a search for the globally fastest run:
  // produce faster until device order requirements are met, then earn faster
  // while the next device is unaffordable. Investments retain the same policy.
  return view.nextMachine && game.state.orderIndex >= view.nextMachine.requiredOrders && game.state.coins < view.nextMachine.cost ? 'premium' : 'rush';
}
function simulate({ policy = 'balanced', tapsPerSecond = 2, collectQuests = true, capture = false } = {}) {
  const game = new Game({ now: NOW }), cache = new Map();
  const orders = [], machines = [{ id: 0, name: CONFIG.machines[0].name, seconds: 0 }];
  const funding = [], switches = [], questClaims = [], upgrades = [], milestones = {};
  const modeSeconds = Object.fromEntries(MODE_IDS.map(id => [id, 0]));
  const captures = {};
  function collectEvents() {
    for (const e of game.drainEvents()) {
      const seconds = game.state.playedSeconds;
      if (e.type === 'burst' && milestones.firstBurst === undefined) milestones.firstBurst = seconds;
      if (e.type === 'upgrade') {
        if (milestones.firstUpgrade === undefined) milestones.firstUpgrade = seconds;
        if (e.key === 'auto' && milestones.firstAutomationUpgrade === undefined) milestones.firstAutomationUpgrade = seconds;
        upgrades.push({ seconds, key: e.key, level: e.level, cost: e.cost });
      }
      if (e.type === 'order') {
        orders.push({ number: e.index + 1, name: e.name, seconds, coins: e.coins, machine: game.state.machine });
        if (capture && e.index === 9) captures.afterOrder10 = snapshot(game);
      }
      if (e.type === 'evolve') {
        machines.push({ id: e.machine, name: e.name, seconds });
        if (e.machine === CONFIG.productionModeUnlockMachine && capture) captures.unlock = snapshot(game);
      }
      if (e.type === 'productionMode') switches.push({ from: e.from, to: e.to, seconds, orderNumber: game.state.orderIndex + 1 });
    }
    const next = game.getView().nextMachine;
    if (next && game.state.orderIndex >= next.requiredOrders && !funding.some(f => f.id === next.id)) {
      funding.push({ id: next.id, name: next.name, seconds: game.state.playedSeconds, coins: game.state.coins, gap: Math.max(0, next.cost - game.state.coins) });
    }
  }
  function claimQuests() {
    if (!collectQuests) return;
    for (;;) {
      const q = game.getView().quests.chapters.flatMap(c => c.quests).find(q => q.ready);
      if (!q) return;
      const result = game.claimQuest(q.id); assert.equal(result.ok, true);
      questClaims.push({ id: q.id, seconds: game.state.playedSeconds, coins: result.coins }); collectEvents();
    }
  }
  function setMode() {
    const target = desiredMode(game, policy), modes = game.getView().productionModes;
    if (modes.current !== target) {
      const result = game.setProductionMode(target); assert.equal(result.ok, true); collectEvents();
    }
  }
  while (game.state.playedSeconds < MAX_SECONDS && (game.state.orderIndex < 20 || game.state.machine < 5)) {
    claimQuests();
    while (game.state.orderIndex < 20 && game.getView().order.ready) {
      assert.equal(game.claimOrder().ok, true); collectEvents(); claimQuests();
    }
    setMode();
    for (let count = 0; count < 20; count++) {
      const choice = chooseInvestment(game, tapsPerSecond, cache);
      if (!choice || game.state.coins < choice.cost) break;
      const result = choice.key === 'machine' ? game.evolve() : game.buyUpgrade(choice.key);
      assert.equal(result.ok, true); collectEvents(); claimQuests(); setMode();
    }
    if (game.state.orderIndex >= 20 && game.state.machine >= 5) break;
    modeSeconds[game.getView().productionModes.current]++;
    for (let tap = 0; tap < tapsPerSecond; tap++) game.tap();
    assert.equal(game.tick(1).ok, true); collectEvents();
  }
  for (const f of funding) f.fundingWaitSeconds = (machines.find(m => m.id === f.id)?.seconds ?? NaN) - f.seconds;
  const orderWaits = orders.map((order, i) => ({ from: i, to: order.number, seconds: order.seconds - (orders[i - 1]?.seconds || 0) }));
  return {
    policy, tapsPerSecond, collectQuests, completed: game.state.orderIndex === 20 && game.state.machine === 5,
    mainOrdersSeconds: game.state.completedAt, fullCompletionSeconds: game.state.playedSeconds,
    milestones, machines, orders, orderWaits, order10To11Seconds: orderWaits.find(w => w.to === 11)?.seconds ?? null,
    longestOrderWait: [...orderWaits].sort((a, b) => b.seconds - a.seconds)[0] || null,
    deviceFunding: funding, modeSeconds, modeSwitchCount: switches.length, switches,
    questRewardCount: questClaims.length, questRewardCoins: questClaims.reduce((sum, q) => sum + q.coins, 0), questClaims,
    final: { coins: game.state.coins, totalProduced: game.state.totalProduced, upgrades: { ...game.state.upgrades } },
    ...(capture ? { captures } : {})
  };
}
function compareLegacyPolicy() {
  const reference = legacyPolicy({ name: 'existing no-ad policy', collectQuests: false });
  const current = simulate({ policy: 'balanced', collectQuests: false });
  assert.equal(current.fullCompletionSeconds, reference.playSeconds, 'balanced control must match existing balance policy');
  assert.equal(current.mainOrdersSeconds, reference.mainOrdersCompletedAt);
  assert.deepEqual(current.orders.map(o => o.seconds), reference.orders.map(o => o.playSeconds));
  assert.deepEqual(current.machines.map(m => m.seconds), reference.machines.map(m => m.playSeconds));
  close(current.final.totalProduced, reference.final.totalProduced, 'balanced final production');
  return { passed: true, comparison: 'Same current core, independent public-API implementation versus existing tests/balance.cjs policy; not a historical executable.', collectQuests: false, mainOrdersSeconds: current.mainOrdersSeconds, fullCompletionSeconds: current.fullCompletionSeconds };
}
function checkOriginalFormula() {
  let checked = 0;
  for (let machine = 0; machine < CONFIG.machines.length; machine++) {
    for (const level of [0, 6, 12, CONFIG.maxUpgradeLevel]) {
      const s = new Game({ now: NOW }).exportSave(NOW);
      s.machine = machine; s.orderIndex = CONFIG.machines[machine].requiredOrders;
      s.totalProduced = s.orderIndex ? CONFIG.orders[s.orderIndex - 1].target : 0;
      s.upgrades = { tap: level, auto: level, value: level };
      const game = fromSnapshot(s), p = game.getView().production, m = CONFIG.machines[machine];
      close(p.tap, (1 + .8 * level) * Math.pow(1.2, level) * m.multiplier, 'original balanced tap');
      close(p.baseAuto, (.4 + .7 * level) * Math.pow(CONFIG.autoLevelGrowth, level) * m.multiplier, 'original balanced auto');
      close(p.price, (1 + .2 * level) * Math.pow(1.15, level) * m.priceMultiplier, 'original balanced price');
      checked++;
    }
  }
  return { passed: true, fixtures: checked, scope: 'Original balanced tap, baseAuto and price formulas at every machine and levels 0/6/12/max; no brand or turbo.' };
}
function checkSharedEarlyTimeline(routes) {
  const reference = routes[0], unlockAt = reference.machines.find(m => m.id === CONFIG.productionModeUnlockMachine).seconds;
  for (const route of routes) {
    assert.equal(route.machines.find(m => m.id === CONFIG.productionModeUnlockMachine).seconds, unlockAt);
    assert.deepEqual(route.orders.filter(o => o.seconds <= unlockAt), reference.orders.filter(o => o.seconds <= unlockAt));
    assert.deepEqual(route.milestones, reference.milestones);
  }
  return { passed: true, unlockSeconds: unlockAt, ordersAtUnlock: reference.orders.filter(o => o.seconds <= unlockAt).length, scope: 'All four quest-claiming policies have identical order, device and first-upgrade/burst milestones through mode unlock.' };
}
function probeFixedGoals(save, tapsPerSecond = 2) {
  assert.ok(save, 'Balanced route must supply a real order-10 checkpoint');
  const unitGoal = CONFIG.orders[10].target - save.totalProduced;
  const fundingGoal = Math.max(1, CONFIG.machines[3].cost - save.coins);
  const results = [];
  for (const mode of MODE_IDS) {
    const game = fromSnapshot(save); assert.equal(game.setProductionMode(mode).ok, true);
    const startProduced = game.state.totalProduced, startCoins = game.state.coins;
    let productionGoalSeconds = null, fundingGoalSeconds = null, oneMinute = null;
    while (game.state.playedSeconds - save.playedSeconds < MAX_SECONDS && (productionGoalSeconds === null || fundingGoalSeconds === null)) {
      for (let tap = 0; tap < tapsPerSecond; tap++) game.tap(); game.tick(1); game.drainEvents();
      const elapsed = game.state.playedSeconds - save.playedSeconds;
      const produced = game.state.totalProduced - startProduced, coins = game.state.coins - startCoins;
      if (elapsed === 60) oneMinute = { produced, coins };
      if (productionGoalSeconds === null && produced >= unitGoal) productionGoalSeconds = elapsed;
      if (fundingGoalSeconds === null && coins >= fundingGoal) fundingGoalSeconds = elapsed;
    }
    results.push({ mode, productionGoalSeconds, fundingGoalSeconds, oneMinute });
  }
  const [balanced, rush, premium] = results;
  assert.ok(rush.productionGoalSeconds < balanced.productionGoalSeconds && balanced.productionGoalSeconds < premium.productionGoalSeconds, 'rush must win isolated production target');
  assert.ok(premium.fundingGoalSeconds < balanced.fundingGoalSeconds && balanced.fundingGoalSeconds < rush.fundingGoalSeconds, 'premium must win isolated coin target');
  close(rush.oneMinute.produced / balanced.oneMinute.produced, 1.2, 'rush quantity');
  close(rush.oneMinute.coins / balanced.oneMinute.coins, .96, 'rush revenue');
  close(premium.oneMinute.produced / balanced.oneMinute.produced, .8, 'premium quantity');
  close(premium.oneMinute.coins / balanced.oneMinute.coins, 1.2, 'premium revenue');
  return { passed: true, checkpoint: 'Actual balanced route immediately after claiming order 10', assumptions: 'Fixed upgrades and machine; 2 taps/s, free auto-bursts; no investments, order claims, quests, ads or timing bonuses during probe. These isolate the two goals, not full-route performance.', checkpointState: { machine: save.machine, upgrades: save.upgrades, playedSeconds: save.playedSeconds, coins: save.coins, totalProduced: save.totalProduced }, unitGoal, fundingGoal, results };
}
function run() {
  assert.equal(typeof Game.prototype.setProductionMode, 'function', 'Production-mode core API is required');
  assert.deepEqual(CONFIG.productionModes.map(m => m.id), MODE_IDS);
  const originalBalancedFormula = checkOriginalFormula();
  const legacyControl = compareLegacyPolicy();
  const routes = ['balanced', 'rush', 'premium', 'goal-switch'].map(policy => simulate({ policy, capture: policy === 'balanced' }));
  for (const route of routes) assert.equal(route.completed, true, `${route.policy} should finish within simulation limit`);
  const checks = { originalBalancedFormula, legacyControl, sharedEarlyTimeline: checkSharedEarlyTimeline(routes), isolatedGoals: probeFixedGoals(routes[0].captures.afterOrder10) };
  const baseline = routes[0];
  const comparison = routes.map(route => ({ policy: route.policy, mainOrdersSeconds: route.mainOrdersSeconds, fullCompletionSeconds: route.fullCompletionSeconds, order10To11Seconds: route.order10To11Seconds, mainOrdersChangePercent: (route.mainOrdersSeconds / baseline.mainOrdersSeconds - 1) * 100, fullCompletionChangePercent: (route.fullCompletionSeconds / baseline.fullCompletionSeconds - 1) * 100, modeSwitchCount: route.modeSwitchCount }));
  for (const route of routes) delete route.captures;
  return {
    purpose: 'Deterministic production-mode balance validation; not actual player sessions, retention, revenue forecasts, or a proven optimal route.',
    assumptions: { tapsPerSecond: 2, stepSeconds: 1, ads: false, perfectBurstAttempts: false, offline: false, collectQuests: true, simulationLimitSeconds: MAX_SECONDS, orderClaims: 'Claim each main order as soon as ready.', investmentPolicy: 'Same shortest marginal permanent-income payback policy as tests/balance.cjs; save until selected investment is affordable.', switchingPolicy: 'After dual-cylinder unlock: rush for unmet device order requirements, premium while an order-qualified device still lacks funds, rush after final device.', goalProbePolicy: 'Freeze a real balanced order-10 state; separately measure a fixed production target and fixed coin target.' },
    config: { unlockMachine: CONFIG.productionModeUnlockMachine, modes: CONFIG.productionModes }, checks, comparison, routes,
    limitations: ['Balanced remains the unchanged convenience default; it is not guaranteed optimal. Equal time in rush and premium has theoretical average quantity 1.0 and revenue 1.08 at a fixed production state, before discrete purchases or burst timing.', 'Order rewards can compensate for rush-mode sale-price loss; full-run results must be interpreted separately from fixed-state production and coin checks.', 'The simple switching policy has no lookahead and retains the existing investment policy; any slower result is a finding, not a failed gameplay assertion.', 'All durations have one-second simulation granularity. No claim is made about human tapping, reaction time, ad watching, or enjoyment.']
  };
}
if (require.main === module) {
  const report = run(), outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0) {
    assert.ok(process.argv[outputIndex + 1], '--output requires a filename');
    const output = path.resolve(process.argv[outputIndex + 1]);
    const expected = path.resolve(__dirname, '../artifacts/mode-balance.json');
    assert.equal(output, expected, 'This tool writes only artifacts/mode-balance.json');
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ output, checksPassed: true, comparison: report.comparison, isolatedGoals: report.checks.isolatedGoals.results }, null, 2) + '\n');
  } else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
module.exports = { simulate, run };