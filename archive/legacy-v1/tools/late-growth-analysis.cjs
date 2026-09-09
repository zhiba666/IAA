// Retired with the v2 pipeline; archived reports remain historical evidence.
throw new Error('此脚本对应已停用的旧玩法。新生产线技术检查请运行 npm test；正式试玩请运行 npm start。');
'use strict';
// Real core actions from a fresh save, fixed scripted strategies, no injected funding.
// node tools/late-growth-analysis.cjs --output artifacts/late-growth-analysis.json
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Game, CONFIG } = require('../src/core');
const { scheduledTaps } = require('./midgame-analysis.cjs');
const NOW = 1000000;
function rate(p, tapsPerSecond) {
  return (p.baseAuto + p.tap * tapsPerSecond + (CONFIG.passiveEnergy + CONFIG.tapEnergy * tapsPerSecond) / CONFIG.energyMax * (p.tap * 24 + p.baseAuto * 8)) * p.price;
}
function simulate({ tapsPerSecond = 2, policy = 'balanced', useRefinements = true } = {}) {
  const game = new Game({ now: NOW }), cache = new Map(), orders = [], machines = [], purchases = [];
  const ledger = { income: 0, upgrades: 0, refinements: 0, machines: 0 };
  function collect() {
    for (const event of game.drainEvents()) {
      const seconds = game.state.playedSeconds, s = game.state;
      if (event.type === 'produce' || event.type === 'quest' || event.type === 'order') ledger.income += event.coins;
      if (event.type === 'upgrade') ledger.upgrades += event.cost;
      if (event.type === 'refinement') ledger.refinements += event.cost;
      if (event.type === 'order') orders.push({ number: event.index + 1, seconds, machine: s.machine });
      if (event.type === 'evolve') {
        ledger.machines += CONFIG.machines[event.machine].cost;
        machines.push({ machine: event.machine, seconds, upgrades: { ...s.upgrades }, refinements: { ...s.refinements } });
      }
      if (event.type === 'upgrade' || event.type === 'refinement' || event.type === 'evolve') purchases.push({ type: event.type, key: event.key || 'machine', level: event.level || event.machine, seconds, orderIndex: s.orderIndex, cost: event.cost || CONFIG.machines[event.machine].cost });
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
    const before = rate(v.production, tapsPerSecond), choices = [];
    for (const u of v.upgrades.filter(u => u.level < u.maxLevel)) choices.push({ kind: 'upgrade', key: u.key, cost: u.cost, after: game._production({ upgrades: { ...s.upgrades, [u.key]: u.level + 1 } }) });
    if (v.nextMachine && s.orderIndex >= v.nextMachine.requiredOrders) choices.push({ kind: 'machine', cost: v.nextMachine.cost, after: game._production({ machine: s.machine + 1 }) });
    if (useRefinements) for (const u of v.refinements.options.filter(u => u.level < u.unlockedLevel)) choices.push({ kind: 'refinement', key: u.key, cost: u.cost, level: u.level, after: game._production({ refinements: { ...s.refinements, [u.key]: u.level + 1 } }) });
    for (const choice of choices) choice.payback = choice.cost / (rate(choice.after, tapsPerSecond) - before);
    choices.sort((a, b) => a.payback - b.payback || a.cost - b.cost);
    const choice = choices[0] || null; cache.set(cacheKey, choice); return choice;
  }
  while (game.state.playedSeconds < 172800 && (game.state.orderIndex < 20 || game.state.machine < 5)) {
    claimQuests();
    while (game.state.orderIndex < 20 && game.getView().order.ready) { assert.equal(game.claimOrder().ok, true); collect(); claimQuests(); }
    setMode();
    for (let i = 0; i < 30; i++) {
      const choice = investment();
      if (!choice || game.state.coins < choice.cost) break;
      const result = choice.kind === 'machine' ? game.evolve() : choice.kind === 'refinement' ? game.buyRefinement(choice.key, choice) : game.buyUpgrade(choice.key);
      assert.equal(result.ok, true); collect(); claimQuests(); setMode();
    }
    if (game.state.orderIndex >= 20 && game.state.machine >= 5) break;
    const count = scheduledTaps(game.state.playedSeconds, tapsPerSecond);
    for (let i = 0; i < count; i++) game.tap();
    game.tick(1); collect();
  }
  assert.equal(game.state.orderIndex, 20); assert.equal(game.state.machine, 5);
  assert.equal(game.state.taps, Math.floor(game.state.playedSeconds * tapsPerSecond + 1e-9));
  assert.ok(Math.abs(game.state.coins - (ledger.income - ledger.upgrades - ledger.refinements - ledger.machines)) <= Math.max(1, game.state.coins) * 1e-9, 'Earned coin ledger must reconcile');
  const regularComplete = purchases.filter(p => p.type === 'upgrade').at(-1).seconds;
  const lateStart = orders.find(o => o.number === 14).seconds;
  const lateTimes = [lateStart, ...new Set(purchases.filter(p => p.seconds >= lateStart).map(p => p.seconds)), game.state.completedAt].sort((a, b) => a - b);
  return { tapsPerSecond, policy, useRefinements, completedSeconds: game.state.completedAt, regularUpgradesCompleteSeconds: regularComplete,
    orders, machines, refinements: purchases.filter(p => p.type === 'refinement'),
    lateStage: { fromOrder: 14, seconds: game.state.completedAt - lateStart, longestGapWithoutPurchaseSeconds: Math.max(...lateTimes.map((n, i) => i ? n - lateTimes[i - 1] : 0)) },
    ledger: { ...ledger, finalCoins: game.state.coins }, actualTapCalls: game.state.taps };
}
function run() {
  const routes = [], comparisons = [];
  for (const tapsPerSecond of [2, 0.2]) for (const policy of ['balanced', 'goal-switch']) {
    const before = simulate({ tapsPerSecond, policy, useRefinements: false }), after = simulate({ tapsPerSecond, policy, useRefinements: true });
    routes.push(before, after);
    assert.deepEqual(before.orders.slice(0, 14), after.orders.slice(0, 14), 'Before the line unlock, the economy must remain unchanged');
    assert.equal(after.refinements.length, 6);
    for (const purchase of after.refinements) {
      assert.ok(purchase.orderIndex >= CONFIG.refinements[purchase.key].levels[purchase.level - 1].requiredOrders);
      assert.ok(purchase.seconds < after.completedSeconds, 'Each refinement must arrive before mainline completion');
    }
    comparisons.push({ tapsPerSecond, policy, beforeSeconds: before.completedSeconds, afterSeconds: after.completedSeconds,
      regularUpgradesCompleteSeconds: after.regularUpgradesCompleteSeconds,
      refinementTimes: after.refinements.map(p => ({ key: p.key, level: p.level, seconds: p.seconds, orderIndex: p.orderIndex })),
      lateStageBefore: before.lateStage, lateStageAfter: after.lateStage });
  }
  return { purpose: 'Controlled script comparison of optional late-game purchases, not human playtests or evidence of enjoyment/retention.',
    assumptions: { start: 'Fresh zero-coin state; all funding earned via canonical production and claim actions.', timestepSeconds: 1,
      taps: '2 per second or exactly 1 every 5 seconds. Both policies buy and claim every second, so low tapping is not low attention.',
      investment: 'Save for the eligible purchase with the shortest marginal permanent-income payback, including machine and available refinement levels.',
      modes: 'balanced throughout, or rush until next machine orders are ready then premium while saving for it; rush after the final machine.',
      quests: 'Claim immediately', orders: 'Claim immediately', ads: false, perfectBurst: false, offline: false },
    configuration: CONFIG.refinements, coreSha256: crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../src/core.js'))).digest('hex'),
    verified: { earnedLedgersReconcile: true, beforeOrder14Unchanged: true, allSixPurchasesBeforeCompletion: true, tapCadenceExact: true }, comparisons, routes };
}
if (require.main === module) {
  const report = run(), arg = process.argv.indexOf('--output');
  if (arg >= 0) {
    assert.ok(process.argv[arg + 1], '--output needs a path');
    const output = path.resolve(process.argv[arg + 1]);
    assert.equal(output, path.resolve(__dirname, '../artifacts/late-growth-analysis.json'));
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify({ verified: report.verified, comparisons: report.comparisons }, null, 2) + '\n');
}
module.exports = { simulate, run };
