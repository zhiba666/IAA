'use strict';
// Historical research/commission analysis. Its baseline belongs to retired rules.
function retiredAnalysis() { throw new Error('历史研发分析已停用，不适用于当前合同与自动爆锅规则；请运行 node tests/balance.cjs。原报告仅作历史记录。'); }
// Controlled fresh-save comparisons. Sparse tapping still includes attentive one-second decisions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Game, CONFIG } = require('../src/core');
const { scheduledTaps } = require('./midgame-analysis.cjs');
const NOW = 1000000;
const BASELINE_FILE = path.resolve(__dirname, './fixtures/content-baseline.json');

function expectedRate(p, tapsPerSecond) {
  return (p.baseAuto + p.tap * tapsPerSecond + (CONFIG.passiveEnergy + CONFIG.tapEnergy * tapsPerSecond)
    / CONFIG.energyMax * (p.tap * 24 + p.baseAuto * 8)) * p.price;
}
function summarizeGaps(events, start, end) {
  const times = [...new Set([start, ...events.filter(e => e.seconds >= start && e.seconds <= end).map(e => e.seconds), end])].sort((a, b) => a - b);
  return times.slice(1).map((to, index) => ({ fromSeconds: times[index], toSeconds: to, seconds: to - times[index] }))
    .sort((a, b) => b.seconds - a.seconds);
}

function simulate({ tapsPerSecond, policy, features, research = false, researchPolicy = 'alternate', finishResearch = false }) {
  retiredAnalysis();
  assert.ok(!finishResearch || research);
  const game = new Game({ now: NOW }), cache = new Map(), orders = [], machines = [], growth = [], claims = [], researchStarts = [];
  const ledger = { production: 0, quests: 0, orders: 0, deliveries: 0, commissions: 0, upgrades: 0, refinements: 0, machines: 0 };
  let allResearchAt = null;
  const snapshot = () => ({ seconds: game.state.playedSeconds, orderIndex: game.state.orderIndex,
    machine: game.state.machine, coins: game.state.coins, totalProduced: game.state.totalProduced,
    upgrades: { ...game.state.upgrades }, refinements: { ...game.state.refinements },
    research: JSON.parse(JSON.stringify(game.state.research || null)) });
  function collect() {
    for (const e of game.drainEvents()) {
      if (e.type === 'produce') ledger.production += e.coins;
      if (e.type === 'quest') ledger.quests += e.coins;
      if (e.type === 'upgrade') ledger.upgrades += e.cost;
      if (e.type === 'refinement') ledger.refinements += e.cost;
      if (e.type === 'evolve') {
        ledger.machines += CONFIG.machines[e.machine].cost;
        machines.push({ machine: e.machine, seconds: game.state.playedSeconds, upgrades: { ...game.state.upgrades }, refinements: { ...game.state.refinements } });
      }
      if (e.type === 'order') {
        ledger.orders += e.coins;
        orders.push({ number: e.index + 1, seconds: game.state.playedSeconds, machine: game.state.machine, isLoop: e.isLoop, coins: e.coins });
      }
      if (['upgrade', 'refinement', 'evolve'].includes(e.type) || e.type === 'research' && e.action === 'claim') {
        growth.push({ ...snapshot(), type: e.type, key: e.key, level: e.level || e.machine });
      }
    }
  }
  function claimQuests() {
    for (;;) {
      const q = game.getView().quests.chapters.flatMap(chapter => chapter.quests).find(q => q.ready);
      if (!q) break;
      assert.equal(game.claimQuest(q.id).ok, true); collect();
    }
  }
  function claimDeliveries() {
    if (features === 'ignore') return;
    for (const q of game.getView().deliveries.stages.filter(q => q.ready)) {
      const r = game.claimDelivery(q.stage, game.state.orderIndex); assert.equal(r.ok, true);
      ledger.deliveries += r.coins; collect();
    }
  }
  function claimCommission() {
    if (features === 'ignore') return;
    const active = game.getView().commissions.active;
    if (!active || !active.ready) return;
    const r = game.claimCommission(active.id); assert.equal(r.ok, true);
    ledger.commissions += r.coins; collect();
  }
  function setMode() {
    const v = game.getView(); if (!v.productionModes.unlocked) return;
    const desired = policy === 'goal-switch' ? v.nextMachine && game.state.orderIndex >= v.nextMachine.requiredOrders
      && game.state.coins < v.nextMachine.cost ? 'premium' : 'rush' : policy;
    if (desired !== game.state.productionMode) { assert.equal(game.setProductionMode(desired).ok, true); collect(); }
  }
  function investment() {
    const s = game.state, v = game.getView();
    const cacheKey = JSON.stringify([s.machine, s.upgrades, s.refinements, s.productionMode, s.orderIndex, s.research?.levels]);
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const before = expectedRate(v.production, tapsPerSecond), choices = [];
    for (const u of v.upgrades.filter(u => u.level < u.maxLevel)) choices.push({ kind: 'upgrade', key: u.key, cost: u.cost, after: game._production({ upgrades: { ...s.upgrades, [u.key]: u.level + 1 } }) });
    if (v.nextMachine && s.orderIndex >= v.nextMachine.requiredOrders) choices.push({ kind: 'machine', cost: v.nextMachine.cost, after: game._production({ machine: s.machine + 1 }) });
    for (const u of v.refinements.options.filter(u => u.level < u.unlockedLevel)) choices.push({ kind: 'refinement', key: u.key, cost: u.cost, level: u.level, after: game._production({ refinements: { ...s.refinements, [u.key]: u.level + 1 } }) });
    for (const c of choices) c.payback = c.cost / (expectedRate(c.after, tapsPerSecond) - before);
    choices.sort((a, b) => a.payback - b.payback || a.cost - b.cost);
    const c = choices[0] || null; cache.set(cacheKey, c); return c;
  }
  function claimResearch() {
    if (!research) return;
    const active = game.getView().research.active;
    if (!active || !active.ready) return;
    const coins = game.state.coins, r = game.claimResearch(active.id); assert.equal(r.ok, true);
    assert.equal(game.state.coins, coins, 'Research completion neither costs nor awards coins');
    const start = researchStarts.find(item => item.id === active.id); assert.ok(start);
    claims.push({ id: active.id, key: active.key, level: active.level, seconds: game.state.playedSeconds,
      durationSeconds: game.state.playedSeconds - start.seconds, productionTarget: active.productionTarget,
      productionCompleted: active.production });
    collect();
    if (game.getView().research.complete) allResearchAt = game.state.playedSeconds;
  }
  function startResearch() {
    if (!research) return;
    const v = game.getView().research;
    if (!v.unlocked || v.complete || v.active) return;
    const choices = v.options.filter(option => option.canStart);
    if (researchPolicy === 'alternate') choices.sort((a, b) => a.level - b.level || (a.key === 'yield' ? -1 : 1));
    else {
      const first = researchPolicy === 'yield-first' ? 'yield' : 'value';
      choices.sort((a, b) => a.key === first ? -1 : b.key === first ? 1 : 0);
    }
    const q = choices[0]; assert.ok(q);
    const coins = game.state.coins, r = game.startResearch(q.key, q); assert.equal(r.ok, true);
    assert.equal(game.state.coins, coins, 'Starting research costs no coins');
    researchStarts.push({ id: r.id, key: r.key, level: r.level, seconds: game.state.playedSeconds,
      orderIndex: game.state.orderIndex, productionTarget: q.productionTarget, mode: game.state.productionMode });
    collect();
  }
  while (game.state.playedSeconds < 172800) {
    claimQuests(); claimCommission(); claimDeliveries();
    while (game.getView().order.ready && game.state.orderIndex < 20) {
      claimDeliveries(); assert.equal(game.claimOrder().ok, true); collect(); claimQuests(); claimCommission();
    }
    setMode(); claimResearch();
    for (let i = 0; i < 30; i++) {
      const c = investment(); if (!c || game.state.coins < c.cost) break;
      const r = c.kind === 'machine' ? game.evolve() : c.kind === 'refinement' ? game.buyRefinement(c.key, c) : game.buyUpgrade(c.key);
      assert.equal(r.ok, true); collect(); claimQuests(); setMode();
    }
    if (game.state.orderIndex >= 20 && game.state.machine >= 5 && (!finishResearch || game.getView().research.complete)) break;
    startResearch();
    if (features !== 'ignore' && game.state.orderIndex < 20) {
      const v = game.getView().commissions;
      if (v.available && !v.active) {
        const option = v.options.find(option => option.kind === features);
        assert.equal(game.acceptCommission(option.kind, option).ok, true); collect();
      }
    }
    const count = scheduledTaps(game.state.playedSeconds, tapsPerSecond);
    for (let i = 0; i < count; i++) { game.tap(); collect(); }
    game.tick(1); collect();
  }
  assert.ok(game.state.completedAt);
  if (finishResearch) {
    assert.equal(game.getView().research.complete, true, 'Remaining research completes through real production after mainline');
    const restored = new Game({ save: game.exportSave(NOW), now: NOW });
    assert.equal(restored.getView().research.complete, true, 'Naturally completed research persists');
    assert.equal(restored.state.coins, game.state.coins);
  }
  assert.equal(game.state.taps, Math.floor(game.state.playedSeconds * tapsPerSecond + 1e-9));
  const earned = ledger.production + ledger.quests + ledger.orders + ledger.deliveries + ledger.commissions;
  const spent = ledger.upgrades + ledger.refinements + ledger.machines;
  assert.ok(Math.abs(game.state.coins - earned + spent) <= Math.max(1, game.state.coins) * 1e-9, 'Real earned coin ledger reconciles');
  const start = orders.find(order => order.number === 10).seconds;
  const growthGaps = summarizeGaps(growth, start, game.state.completedAt);
  const purchaseGaps = summarizeGaps(growth.filter(e => e.type !== 'research'), start, game.state.completedAt);
  return { tapsPerSecond, policy, features, research, researchPolicy, completedSeconds: game.state.completedAt, orders, machines,
    growth: growth.filter(e => e.seconds >= start), researchStarts, researchClaims: claims,
    permanentGrowth: { longestGapSeconds: growthGaps[0].seconds, topGaps: growthGaps.slice(0, 8),
      purchaseOnlyLongestGapSeconds: purchaseGaps[0].seconds, allResearchAt,
      secondsFromAllResearchToCompletion: allResearchAt === null ? null : Math.max(0, game.state.completedAt - allResearchAt) },
    continuation: finishResearch ? { completedSeconds: game.state.playedSeconds,
      secondsAfterMainline: game.state.playedSeconds - game.state.completedAt,
      researchClaimsAfterMainline: claims.filter(claim => claim.seconds > game.state.completedAt).length,
      allResearchComplete: game.getView().research.complete } : null,
    ledger: { ...ledger, finalCoins: game.state.coins }, finalState: snapshot() };
}

function run() {
  retiredAnalysis();
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const routes = [], comparisons = [];
  for (const old of baseline.routes) {
    const control = simulate(old);
    assert.equal(control.completedSeconds, old.completedSeconds, 'Ignoring research preserves completion');
    assert.deepEqual(control.orders, old.orders, 'Control matches every baseline order');
    assert.deepEqual(control.machines, old.machines, 'Control matches every baseline machine');
    for (const researchPolicy of ['alternate', 'yield-first', 'value-first']) {
      const enhanced = simulate({ ...old, research: true, researchPolicy });
      assert.deepEqual(enhanced.orders.slice(0, 10), control.orders.slice(0, 10), 'First ten orders remain unchanged');
      assert.ok(enhanced.completedSeconds <= control.completedSeconds);
      assert.ok(enhanced.permanentGrowth.longestGapSeconds <= (old.tapsPerSecond === 2 ? 180 : 300),
        `Permanent growth gap stays within the ${old.tapsPerSecond === 2 ? 180 : 300}s acceptance bound: ${JSON.stringify([old.tapsPerSecond, old.policy, old.features, researchPolicy])}`);
      routes.push(enhanced);
      comparisons.push({ tapsPerSecond: old.tapsPerSecond, policy: old.policy, features: old.features, researchPolicy,
        beforeSeconds: old.completedSeconds, afterSeconds: enhanced.completedSeconds,
        beforeLongestPermanentGrowthGapSeconds: old.permanentGrowth.longestGapSeconds,
        afterLongestPermanentGrowthGapSeconds: enhanced.permanentGrowth.longestGapSeconds,
        afterPurchaseOnlyLongestGapSeconds: enhanced.permanentGrowth.purchaseOnlyLongestGapSeconds,
        researchClaims: enhanced.researchClaims.length, researchTailSeconds: enhanced.permanentGrowth.secondsFromAllResearchToCompletion });
    }
  }
  const continuations = [2, 0].map(tapsPerSecond => simulate({ tapsPerSecond, policy: 'balanced', features: 'bulk', research: true, finishResearch: true }));
  assert.ok(continuations[0].continuation.researchClaimsAfterMainline > 0, 'At least one route has earned research left to pursue after mainline');
  return { purpose: 'True permanent growth changes measured separately from repeatable payouts and temporary bonuses; fixed strategy simulation, not human playtest.',
    coreSha256: crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../src/core.js'))).digest('hex'),
    baselineCoreSha256: baseline.coreSha256, baselineOriginalGitSource: baseline.originalGitSource,
    researchConfig: CONFIG.research,
    assumptions: { baseline: baseline.assumptions,
      research: 'One research project at a time; claim completed work before investments and start the next project after investments. Alternate lower-level routes (yield on ties), fully prioritize yield, or fully prioritize value. No cancellation or production injection.',
      duration: 'The durationSeconds setting is a frozen normal permanent automatic-production target, not a countdown. Taps, bursts and subsequent permanent growth shorten real completion time; changing mode changes actual production without repricing the target.',
      growthGap: 'Counts only permanent base upgrades, refinements, machine changes and claimed research. Order payouts, commissions, delivery rewards, research starts and mode changes do not count.',
      noTaps: 'The zero-tap route uses only automatic production and passive bursts, but still inspects, claims and buys every second; it is not an unattended playtest.' },
    verified: { ignoredResearchPreservesAllBaselineTimelines: true, firstTenOrdersUnchanged: true, realCoinLedgersReconcile: true, exactTapCadence: true,
      activeGrowthGapsAtMost180Seconds: true, sparseGrowthGapsAtMost300Seconds: true, zeroTapMainlineCompletes: true, remainingResearchNaturallyCompletedAndSaved: true },
    comparisons, continuations, routes };
}
if (require.main === module) {
  const report = run(), output = path.resolve(__dirname, '../artifacts/content-growth-analysis.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ verified: report.verified, comparisons: report.comparisons }, null, 2) + '\n');
}
module.exports = { simulate, run };
