// Retired with the v2 pipeline; archived reports remain historical evidence.
throw new Error('此脚本对应已停用的旧玩法。新生产线技术检查请运行 npm test；正式试玩请运行 npm start。');
'use strict';
// Historical heat-recovery comparison. The milestone and controller are retired.
function retiredAnalysis() { throw new Error('历史完美爆锅与余热分析已停用，不适用于当前合同与自动爆锅规则；请运行 node tests/balance.cjs。原报告仅作历史记录。'); }
// Read-only core simulation. --output may write only artifacts/milestone-analysis.json.
// node tools/milestone-analysis.cjs --output artifacts/milestone-analysis.json
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Game, CONFIG } = require('../src/core.js');
const { scheduledTaps } = require('./midgame-analysis.cjs');
const NOW = 1000000, DURATION = 600, STEP = 0.05;
const ROOT = path.resolve(__dirname, '..');
const CORE_PATH = path.join(ROOT, 'src/core.js');
const MIDGAME_PATH = path.join(ROOT, 'artifacts/midgame-analysis.json');
const OUTPUT_PATH = path.join(ROOT, 'artifacts/milestone-analysis.json');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-9, message);

function summary(game) {
  const view = game.getView();
  return { seconds: game.state.playedSeconds, machine: game.state.machine, mode: view.productionModes.current,
    orderIndex: game.state.orderIndex, totalProduced: game.state.totalProduced, coins: game.state.coins,
    upgrades: { ...game.state.upgrades }, energy: game.state.energy, taps: game.state.taps,
    bursts: game.state.bursts, heatRecoveryUnlocked: view.milestones.heatRecovery.unlocked,
    heatRecoveryTaps: game.state.heatRecoveryTaps, production: { ...view.production } };
}
function expectedIncome(production, tapsPerSecond) {
  const burstRate = (CONFIG.passiveEnergy + CONFIG.tapEnergy * tapsPerSecond) / CONFIG.energyMax;
  return (production.tap * tapsPerSecond + production.baseAuto
    + burstRate * (24 * production.tap + 8 * production.baseAuto)) * production.price;
}

// Same balanced / marginal-income-payback policy and one-second action ordering as
// midgame-analysis, stopping at the evolve event before the new machine's quest.
function earnMultihead(tapsPerSecond) {
  retiredAnalysis();
  const game = new Game({ now: NOW }), cache = new Map();
  const ledger = { productionUnits: 0, productionCoins: 0, orderCoins: 0, questCoins: 0, upgradeCosts: 0, machineCosts: 0 };
  function collect() {
    for (const event of game.drainEvents()) {
      if (event.type === 'produce') { ledger.productionUnits += event.amount; ledger.productionCoins += event.coins; }
      if (event.type === 'order') ledger.orderCoins += event.coins;
      if (event.type === 'quest') ledger.questCoins += event.coins;
      if (event.type === 'upgrade') ledger.upgradeCosts += event.cost;
      if (event.type === 'evolve') ledger.machineCosts += CONFIG.machines[event.machine].cost;
    }
  }
  function claimQuests() {
    for (;;) {
      const quest = game.getView().quests.chapters.flatMap(chapter => chapter.quests).find(quest => quest.ready);
      if (!quest) return;
      assert.equal(game.claimQuest(quest.id).ok, true); collect();
    }
  }
  function investment() {
    const view = game.getView(), eligible = view.nextMachine && game.state.orderIndex >= view.nextMachine.requiredOrders;
    const key = JSON.stringify([game.state.machine, game.state.upgrades, view.productionModes.current, !!eligible]);
    if (cache.has(key)) return cache.get(key);
    const before = expectedIncome(view.production, tapsPerSecond);
    const choices = view.upgrades.filter(upgrade => upgrade.level < upgrade.maxLevel).map(upgrade => ({
      key: upgrade.key, cost: upgrade.cost,
      productionAfter: game._production({ upgrades: { ...game.state.upgrades, [upgrade.key]: upgrade.level + 1 } })
    }));
    if (eligible) choices.push({ key: 'machine', cost: view.nextMachine.cost, productionAfter: game._production({ machine: game.state.machine + 1 }) });
    for (const choice of choices) choice.paybackSeconds = choice.cost / (expectedIncome(choice.productionAfter, tapsPerSecond) - before);
    choices.sort((a, b) => a.paybackSeconds - b.paybackSeconds || a.cost - b.cost);
    const best = choices[0]; cache.set(key, best); return best;
  }
  while (game.state.machine < 3 && game.state.playedSeconds < 172800) {
    claimQuests();
    while (game.state.orderIndex < 20 && game.getView().order.ready) {
      assert.equal(game.claimOrder().ok, true); collect(); claimQuests();
    }
    for (let action = 0; action < 20; action++) {
      const choice = investment();
      if (!choice || game.state.coins < choice.cost) break;
      assert.equal((choice.key === 'machine' ? game.evolve() : game.buyUpgrade(choice.key)).ok, true);
      collect();
      if (game.state.machine === 3) break;
      claimQuests();
    }
    if (game.state.machine === 3) break;
    const taps = scheduledTaps(game.state.playedSeconds, tapsPerSecond);
    for (let tap = 0; tap < taps; tap++) { game.tap(); collect(); }
    assert.equal(game.tick(1).ok, true); collect();
  }
  assert.equal(game.state.machine, 3);
  assert.equal(game.state.taps, Math.floor(game.state.playedSeconds * tapsPerSecond + 1e-9));
  near(game.state.coins, ledger.productionCoins + ledger.orderCoins + ledger.questCoins - ledger.upgradeCosts - ledger.machineCosts, 'Natural route coin ledger');
  near(game.state.totalProduced, ledger.productionUnits, 'Natural route production ledger');
  return { game, arrival: summary(game), ledger };
}

// Low-frequency arrival has tap Lv.15. Earn its next level through production,
// retaining the unclaimed multihead quest and making no other purchases/claims.
function naturallyUnlockHeat(save, tapsPerSecond) {
  const game = new Game({ save, now: NOW }), before = summary(game);
  const cost = game.getView().upgrades.find(upgrade => upgrade.key === 'tap').cost;
  let seconds = 0, tapCalls = 0, productionCoins = 0;
  assert.equal(game.state.upgrades.tap, CONFIG.heatRecoveryUpgradeLevel - 1);
  while (game.state.coins < cost) {
    const taps = scheduledTaps(seconds, tapsPerSecond);
    for (let tap = 0; tap < taps; tap++) { game.tap(); tapCalls++; }
    game.tick(1); seconds++;
    for (const event of game.drainEvents()) if (event.type === 'produce') productionCoins += event.coins;
    assert.ok(seconds < 172800, 'Unlock must be naturally affordable');
  }
  const purchase = game.buyUpgrade('tap'); assert.equal(purchase.ok, true); assert.equal(purchase.cost, cost);
  game.drainEvents();
  assert.equal(game.getView().milestones.heatRecovery.unlocked, true);
  near(game.state.coins, before.coins + productionCoins - cost, 'Unlock coin ledger');
  assert.equal(tapCalls, Math.floor(seconds * tapsPerSecond + 1e-9));
  return { save: game.exportSave(NOW), preparation: { before, seconds, tapCalls, productionCoins, upgradeCost: cost,
    otherPurchases: 0, claimedRewards: 0, perfectAttempts: 0, after: summary(game) } };
}

function measureWindow(save, tapsPerSecond, scenario) {
  retiredAnalysis();
  const game = new Game({ save, now: NOW });
  if (scenario === 'ideal-perfect-without-recovery') game._heatRecoveryUnlocked = () => false;
  const start = summary(game), steps = Math.round(DURATION / STEP), tapEverySteps = Math.round(1 / (tapsPerSecond * STEP));
  assert.equal(tapEverySteps * tapsPerSecond * STEP, 1, 'Tap period must fit the tick grid exactly');
  assert.equal(start.heatRecoveryTaps, 0, 'All branches begin without pre-granted recovery');
  const metrics = { producedUnits: 0, productionCoins: 0, burstCount: 0, perfectCount: 0, timingAttempts: 0,
    tapCalls: 0, recoveryGrantEvents: 0, recoveryTapsGranted: 0, recoveryTapsUsed: 0,
    saveRestoreChecksWithResidualHeat: 0, bySource: {} };
  const tapSchedule = { periodSeconds: 1 / tapsPerSecond, firstTapSeconds: null, lastTapSeconds: null };
  function collect() {
    for (const event of game.drainEvents()) {
      if (event.type === 'produce') {
        metrics.producedUnits += event.amount; metrics.productionCoins += event.coins;
        const source = metrics.bySource[event.source] || (metrics.bySource[event.source] = { units: 0, coins: 0 });
        source.units += event.amount; source.coins += event.coins;
      }
      if (event.type === 'burst') {
        metrics.burstCount++;
        if (event.heatRecoveryTaps) {
          metrics.recoveryGrantEvents++; metrics.recoveryTapsGranted += event.heatRecoveryTaps;
          const restored = new Game({ save: game.exportSave(NOW), now: NOW });
          assert.ok(game.state.heatRecoveryTaps > 0, 'Inspect newly granted residual heat before subsequent taps');
          assert.equal(restored.state.heatRecoveryTaps, game.state.heatRecoveryTaps, 'Positive residual heat survives save/restore');
          metrics.saveRestoreChecksWithResidualHeat++;
        }
      }
      assert.ok(!['upgrade', 'upgradeBatch', 'evolve', 'order', 'quest', 'productionMode', 'reward'].includes(event.type), 'No spending or claims in a fixed window');
    }
  }
  for (let step = 1; step <= steps; step++) {
    assert.equal(game.tick(STEP).ok, true); collect();
    if (step % tapEverySteps === 0) {
      const result = game.tap(); assert.equal(result.ok, true); metrics.tapCalls++;
      if (result.recoveryUsed) metrics.recoveryTapsUsed++;
      if (tapSchedule.firstTapSeconds === null) tapSchedule.firstTapSeconds = step * STEP;
      tapSchedule.lastTapSeconds = step * STEP;
      collect();
    }
  }
  const end = summary(game);
  metrics.recoveryTapsRemaining = end.heatRecoveryTaps;
  metrics.recoveryEnergyAdded = metrics.recoveryTapsUsed * CONFIG.heatRecoveryEnergyPerTap;
  metrics.averageUnitsPerSecond = metrics.producedUnits / DURATION;
  assert.equal(metrics.tapCalls, DURATION * tapsPerSecond);
  assert.equal(end.taps - start.taps, metrics.tapCalls);
  assert.equal(end.bursts - start.bursts, metrics.burstCount);
  assert.equal(metrics.recoveryTapsGranted - metrics.recoveryTapsUsed, metrics.recoveryTapsRemaining, 'Every granted recovery tap is used or saved');
  assert.equal(metrics.perfectCount, scenario === 'no-ignition' ? 0 : metrics.burstCount, 'Ideal policy must hit every measured burst');
  assert.deepEqual(end.upgrades, start.upgrades); assert.equal(end.machine, start.machine); assert.equal(end.mode, start.mode);
  near(end.seconds - start.seconds, DURATION, 'Measured duration');
  near(end.totalProduced - start.totalProduced, metrics.producedUnits, 'Fixed-window production ledger');
  near(end.coins - start.coins, metrics.productionCoins, 'Fixed-window coin ledger');
  near(end.energy, start.energy + DURATION * CONFIG.passiveEnergy + metrics.tapCalls * CONFIG.tapEnergy
    + metrics.recoveryEnergyAdded - metrics.burstCount * CONFIG.energyMax, 'Energy ledger');
  const restored = new Game({ save: game.exportSave(NOW), now: NOW });
  assert.equal(restored.state.heatRecoveryTaps, game.state.heatRecoveryTaps, 'Earned residual heat survives save/restore');
  return { report: { scenario, durationSeconds: DURATION, tapsPerSecond, tapSchedule, start, end, ...metrics }, save: game.exportSave(NOW) };
}

function compareBatch(save, key) {
  const single = new Game({ save, now: NOW }), batch = new Game({ save, now: NOW });
  const quote = batch.getView().upgrades.find(upgrade => upgrade.key === key).bulk;
  assert.equal(quote.canBuy, true); assert.ok(quote.count >= 2, 'Functional example should reduce actions');
  const before = summary(batch);
  let singleCost = 0;
  for (let i = 0; i < quote.count; i++) {
    const purchase = single.buyUpgrade(key); assert.equal(purchase.ok, true); singleCost += purchase.cost;
  }
  const purchase = batch.buyUpgradeBatch(key, quote); assert.equal(purchase.ok, true);
  assert.equal(singleCost, quote.cost); assert.equal(purchase.cost, singleCost);
  assert.deepEqual(single.state, batch.state, 'Batch and quoted count of singles must have identical saved economic state');
  assert.deepEqual(single.getView().production, batch.getView().production, 'Batch and singles must yield identical production/income');
  const after = summary(batch);
  return { key, provenance: 'Same naturally earned active-route arrival, followed by the 600-second no-ignition fixed window; independent clone per upgrade type.',
    quote, before, after, singleCost, batchCost: purchase.cost, singleActions: quote.count, batchActions: 1,
    actionsSaved: quote.count - 1, actionReductionPercent: (quote.count - 1) / quote.count * 100,
    identicalCoins: single.state.coins === batch.state.coins, identicalLevels: true, identicalProductionAndIncome: true,
    entireSavedStateIdentical: true, elapsedTimeDifferenceSeconds: 0 };
}

function run() {
  retiredAnalysis();
  const coreSha256 = hash(CORE_PATH), midgameSha256 = hash(MIDGAME_PATH), midgame = JSON.parse(fs.readFileSync(MIDGAME_PATH, 'utf8'));
  const naturalRoutes = [], experiments = [], preparations = [];
  let batchSource = null;
  function experiment(id, save, tapsPerSecond) {
    const windows = ['no-ignition', 'ideal-perfect-without-recovery', 'ideal-perfect-with-recovery']
      .map(scenario => measureWindow(save, tapsPerSecond, scenario));
    const [baseline, perfect, recovery] = windows.map(window => window.report);
    function change(from, to) {
      return { producedUnits: to.producedUnits - from.producedUnits,
        productionChangePercent: (to.producedUnits / from.producedUnits - 1) * 100,
        productionCoins: to.productionCoins - from.productionCoins,
        coinChangePercent: (to.productionCoins / from.productionCoins - 1) * 100,
        burstCount: to.burstCount - from.burstCount, perfectCount: to.perfectCount - from.perfectCount };
    }
    experiments.push({ id, tapsPerSecond, checkpoint: summary(new Game({ save, now: NOW })),
      windows: windows.map(window => window.report), comparison: { perfectVsNoIgnition: change(baseline, perfect),
        recoveryVsPerfectWithoutRecovery: change(perfect, recovery), recoveryVsNoIgnition: change(baseline, recovery) } });
    return windows[0].save;
  }
  for (const tapsPerSecond of [2, 0.2]) {
    const natural = earnMultihead(tapsPerSecond), expected = midgame.routes.find(route => route.policy === 'balanced' && route.tapsPerSecond === tapsPerSecond).midgame.afterMultihead;
    for (const key of ['seconds', 'machine', 'mode', 'orderIndex', 'totalProduced', 'coins', 'upgrades', 'energy']) {
      assert.deepEqual(natural.arrival[key], expected[key], 'Natural arrival must match midgame artifact: ' + key);
    }
    naturalRoutes.push({ policy: 'balanced', tapsPerSecond, arrival: natural.arrival, ledger: natural.ledger, matchesMidgameArrival: true });
    const save = natural.game.exportSave(NOW);
    const endSave = experiment(tapsPerSecond === 2 ? 'active-natural-arrival' : 'low-frequency-natural-arrival-locked', save, tapsPerSecond);
    if (tapsPerSecond === 2) batchSource = endSave;
    else {
      const unlocked = naturallyUnlockHeat(save, tapsPerSecond);
      preparations.push({ id: 'low-frequency-earned-tap16', ...unlocked.preparation });
      experiment('low-frequency-earned-tap16', unlocked.save, tapsPerSecond);
    }
  }
  const batchUpgrade = ['tap', 'auto', 'value'].map(key => compareBatch(batchSource, key));
  assert.equal(hash(CORE_PATH), coreSha256, 'Core source must not change during analysis');
  const report = { purpose: 'Controlled milestone economy and purchase-equivalence analysis using actual core actions; not player measurements or evidence of enjoyment, retention, or optimal strategy.',
    reproducibility: { command: 'node tools/milestone-analysis.cjs --output artifacts/milestone-analysis.json', coreSha256,
      scriptSha256: hash(__filename), midgameArtifactSha256: midgameSha256, midgameRecordedCoreSha256: midgame.reproducibility.coreSha256 },
    assumptions: { naturalRoute: 'Fresh zero-coin balanced Game; same marginal-income-payback policy as midgame-analysis. One-second purchases and claims, no perfect attempts. Stop immediately on machine3 purchase before claiming its quest.',
      naturalRouteTaps: '2 taps per one-second route step or exactly one tap per five seconds, using the shared scheduledTaps function.',
      fixedWindows: 'Each branch restores the same naturally earned save at identical timestamp, freezes upgrades/machine/mode, and runs 600 seconds with no purchases, claims, ads, offline income or external funds.',
      fixedWindowTaps: 'Uniform taps after tick at t=0.5,1,...,600 for 2/s and t=5,10,...,600 for 0.2/s. Exactly 1200 or 120 production taps; relative cadence restarts at each checkpoint.',
      tickSeconds: STEP, timing: 'Ideal controller inspects immediately before/after every tick/tap, attempts once upon entering the perfect window, and verifies every burst is perfect. This is an ideal bound, not a human reaction model.',
      counterfactual: 'Only the ideal-perfect-without-recovery analysis instance overrides _heatRecoveryUnlocked() to false. Source files and natural starting states are unchanged.',
      lowFrequencyUnlock: 'An additional branch naturally earns the tap Lv.16 price using existing production and exact low-frequency taps, buys that one level, then begins a new fixed comparison. Preparation cost/time is reported separately.',
      batch: 'Three independent copies of one naturally funded state compare the displayed quote.count individual upgrades against one batch. No production time elapses during purchases; no route speed-up is inferred.' },
    configuration: { machine: CONFIG.machines[3], heatRecoveryUnlockMachine: CONFIG.heatRecoveryUnlockMachine,
      heatRecoveryUpgradeLevel: CONFIG.heatRecoveryUpgradeLevel, heatRecoveryMaxTaps: CONFIG.heatRecoveryMaxTaps,
      heatRecoveryEnergyPerTap: CONFIG.heatRecoveryEnergyPerTap, bulkUpgradeUnlockMachine: CONFIG.bulkUpgradeUnlockMachine,
      bulkUpgradeMaxCount: CONFIG.bulkUpgradeMaxCount },
    verified: { naturalArrivalMatchesMidgameArtifact: true, naturalCoinLedgersReconcile: true, noInjectedFunds: true,
      exactFractionalTapCadence: true, fixedWindowLedgersReconcile: true, allIdealBurstsPerfect: true,
      recoveryGrantUseBalance: true, heatRecoverySaveRestore: true, batchSavedStateExactlyEqualsSingles: true,
      batchIncomeExactlyEqualsSingles: true, sourceUnchanged: true, jsonRoundTripValid: true },
    naturalRoutes, preparations, experiments, batchUpgrade,
    limits: ['Only the balanced investment policy is reproduced; these are three checkpoint experiments, not the distribution of player states.',
      'Natural-route controls act every second even for low-frequency tapping; low-frequency does not model infrequent app visits.',
      'Perfect timing assumes immediate observation and flawless reactions. Every attempt is an additional action beyond the stated production-tap cadence.',
      'Frozen-upgrade 600-second windows isolate timing and heat recovery; production differences must not be presented as end-to-end completion speed-ups.',
      'Finite-window burst counts depend on initial energy and ending phase. Remaining granted heat and energy are reported, not converted into unearned output.',
      'The low-frequency Lv.15 arrival is genuinely locked. The unlocked low-frequency group has a separately paid upgrade and cannot be treated as the same initial production state.',
      'Batch comparisons establish exact economic equivalence and purchase-call reduction in funded examples, not natural route time saved or observed UI effort.',
      'No player behavior, frontend timing, click accuracy, enjoyment, advertisement behavior or device performance is measured.'] };
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report, 'Report must contain finite JSON values');
  return report;
}

if (require.main === module) {
  const index = process.argv.indexOf('--output');
  if (index >= 0) {
    assert.ok(process.argv[index + 1], '--output needs a path');
    assert.equal(path.resolve(process.argv[index + 1]), OUTPUT_PATH, 'Only the fixed milestone analysis artifact may be written');
  }
  const report = run();
  if (index >= 0) {
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2) + '\n');
    assert.deepEqual(JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')), report);
    process.stdout.write(JSON.stringify({ output: OUTPUT_PATH, verified: report.verified,
      experiments: report.experiments.map(experiment => ({ id: experiment.id, comparison: experiment.comparison,
        windows: experiment.windows.map(window => ({ scenario: window.scenario, producedUnits: window.producedUnits,
          bursts: window.burstCount, perfect: window.perfectCount, heatGranted: window.recoveryTapsGranted,
          heatUsed: window.recoveryTapsUsed, heatRemaining: window.recoveryTapsRemaining })) })),
      preparation: report.preparations.map(preparation => ({ seconds: preparation.seconds, cost: preparation.upgradeCost })),
      batchUpgrade: report.batchUpgrade.map(example => ({ key: example.key, count: example.quote.count, cost: example.batchCost,
        actionsSaved: example.actionsSaved, entireSavedStateIdentical: example.entireSavedStateIdentical })) }, null, 2) + '\n');
  } else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
module.exports = { run, earnMultihead, measureWindow };
