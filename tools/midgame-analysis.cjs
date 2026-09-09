// Retired with the v2 pipeline; archived reports remain historical evidence.
throw new Error('此脚本对应已停用的旧玩法。新生产线技术检查请运行 npm test；正式试玩请运行 npm start。');
'use strict';
// Read-only game simulation. Only --output writes its named analysis artifact.
// node tools/midgame-analysis.cjs --output artifacts/midgame-analysis.json
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Game, CONFIG } = require('../src/core.js');
const NOW = 1000000, LIMIT = 172800;
const POLICIES = ['balanced', 'rush', 'premium', 'goal-switch'];
const TAP_RATES = [2, 0.2];
function expectedRate(p, tapsPerSecond) {
  const burstRate = (CONFIG.passiveEnergy + CONFIG.tapEnergy * tapsPerSecond) / CONFIG.energyMax;
  const units = p.tap * tapsPerSecond + p.baseAuto + burstRate * (24 * p.tap + 8 * p.baseAuto);
  return { units, coins: units * p.price };
}
function stateSummary(game, tapsPerSecond) {
  const v = game.getView(), m = CONFIG.machines[3];
  return { seconds: game.state.playedSeconds, machine: game.state.machine, mode: v.productionModes.current,
    orderIndex: game.state.orderIndex, totalProduced: game.state.totalProduced, coins: game.state.coins,
    upgrades: { ...game.state.upgrades }, energy: game.state.energy,
    order11UnitsRemaining: Math.max(0, CONFIG.orders[10].target - game.state.totalProduced),
    multiheadCoinsMissing: game.state.machine >= 3 ? 0 : Math.max(0, m.cost - game.state.coins),
    production: { tap: v.production.tap, baseAuto: v.production.baseAuto, price: v.production.price },
    expectedRate: expectedRate(v.production, tapsPerSecond) };
}
function nextMode(game, policy) {
  const v = game.getView();
  if (!v.productionModes.unlocked) return 'balanced';
  if (policy !== 'goal-switch') return policy;
  return v.nextMachine && game.state.orderIndex >= v.nextMachine.requiredOrders && game.state.coins < v.nextMachine.cost ? 'premium' : 'rush';
}
function chooseInvestment(game, tapsPerSecond, cache) {
  const v = game.getView(), eligible = v.nextMachine && game.state.orderIndex >= v.nextMachine.requiredOrders;
  const key = JSON.stringify([game.state.machine, game.state.upgrades, v.productionModes.current, !!eligible]);
  if (cache.has(key)) return cache.get(key);
  const before = expectedRate(v.production, tapsPerSecond).coins;
  const choices = v.upgrades.filter(u => u.level < u.maxLevel).map(u => ({ key: u.key, cost: u.cost,
    // Canonical core production forecast, with no state mutation or funded clone.
    productionAfter: game._production({ upgrades: { ...game.state.upgrades, [u.key]: u.level + 1 } }) }));
  if (eligible) choices.push({ key: 'machine', cost: v.nextMachine.cost, productionAfter: game._production({ machine: game.state.machine + 1 }) });
  for (const c of choices) c.paybackSeconds = c.cost / (expectedRate(c.productionAfter, tapsPerSecond).coins - before);
  choices.sort((a, b) => a.paybackSeconds - b.paybackSeconds || a.cost - b.cost);
  const result = choices.length ? { key: choices[0].key, cost: choices[0].cost, paybackSeconds: choices[0].paybackSeconds } : null;
  cache.set(key, result); return result;
}
function scheduledTaps(second, tapsPerSecond) {
  // Exact 2/s or 1 per 5 seconds; do not use `i < 0.2`, which emits 1 tap/s.
  return Math.floor((second + 1) * tapsPerSecond + 1e-9) - Math.floor(second * tapsPerSecond + 1e-9);
}
function simulate({ policy, tapsPerSecond, continuation = null, investmentPolicy = 'income-payback', stopAt11 = false }) {
  const game = new Game({ save: continuation, now: NOW }), cache = new Map();
  const orderTimeline = [], machineTimeline = [], actions = [], phaseTransitions = [];
  const ledger = { producedUnits: 0, productionCoins: 0, questCoins: 0, upgradeCosts: 0, machineCosts: 0, bySource: {} };
  const phaseSeconds = { fundingLimitedWhileProducing: 0, deviceAffordableButDeferred: 0, afterMultiheadProducing: 0 };
  let afterOrder10 = null, afterMultihead = null, beforeOrder11 = null, naturalCheckpoint = null;
  let activeWindow = false, previousPhase = null;
  if (continuation) { assert.equal(game.state.orderIndex, 10); afterOrder10 = stateSummary(game, tapsPerSecond); activeWindow = true; }
  function collect() {
    for (const e of game.drainEvents()) {
      const at = game.state.playedSeconds;
      if (e.type === 'order') orderTimeline.push({ number: e.index + 1, seconds: at, machine: game.state.machine, coins: e.coins });
      if (e.type === 'evolve') { machineTimeline.push({ id: e.machine, seconds: at, upgradesAtArrival: { ...game.state.upgrades }, remainingUpgradeLevels: Object.values(game.state.upgrades).reduce((sum, level) => sum + CONFIG.maxUpgradeLevel - level, 0) }); if (e.machine === 3) afterMultihead = stateSummary(game, tapsPerSecond); }
      if (['upgrade', 'evolve', 'quest', 'productionMode'].includes(e.type)) actions.push({ seconds: at, inMidgameWindow: activeWindow, ...e });
      if (!activeWindow) continue;
      if (e.type === 'produce') {
        ledger.producedUnits += e.amount; ledger.productionCoins += e.coins;
        const source = ledger.bySource[e.source] || (ledger.bySource[e.source] = { units: 0, coins: 0, events: 0 });
        source.units += e.amount; source.coins += e.coins; source.events++;
      }
      if (e.type === 'upgrade') ledger.upgradeCosts += e.cost;
      if (e.type === 'quest') ledger.questCoins += e.coins;
      if (e.type === 'evolve') ledger.machineCosts += CONFIG.machines[e.machine].cost;
    }
  }
  function claimQuests() {
    for (;;) {
      const q = game.getView().quests.chapters.flatMap(c => c.quests).find(q => q.ready);
      if (!q) return;
      assert.equal(game.claimQuest(q.id).ok, true); collect();
    }
  }
  function setMode() {
    const desired = nextMode(game, policy);
    if (game.getView().productionModes.current !== desired) { assert.equal(game.setProductionMode(desired).ok, true); collect(); }
  }
  while (game.state.playedSeconds < LIMIT && (game.state.orderIndex < 20 || game.state.machine < 5)) {
    claimQuests();
    while (game.state.orderIndex < 20 && game.getView().order.ready) {
      const number = game.state.orderIndex + 1;
      if (number === 11) { beforeOrder11 = stateSummary(game, tapsPerSecond); activeWindow = false; }
      assert.equal(game.claimOrder().ok, true); collect();
      if (number === 10) { afterOrder10 = stateSummary(game, tapsPerSecond); naturalCheckpoint = game.exportSave(NOW); activeWindow = true; }
      claimQuests();
    }
    if (stopAt11 && game.state.orderIndex >= 11) break;
    setMode();
    for (let i = 0; i < 20; i++) {
      let choice;
      if (investmentPolicy === 'device-first-after-10' && game.state.orderIndex >= 10 && game.state.machine < 3) choice = { key: 'machine', cost: CONFIG.machines[game.state.machine + 1].cost };
      else choice = chooseInvestment(game, tapsPerSecond, cache);
      if (!choice || game.state.coins < choice.cost) break;
      const result = choice.key === 'machine' ? game.evolve() : game.buyUpgrade(choice.key);
      assert.equal(result.ok, true); collect(); claimQuests(); setMode();
    }
    if (game.state.orderIndex >= 20 && game.state.machine >= 5) break;
    if (activeWindow) {
      const phase = game.state.machine >= 3 ? 'afterMultiheadProducing' : game.state.coins < CONFIG.machines[3].cost ? 'fundingLimitedWhileProducing' : 'deviceAffordableButDeferred';
      phaseSeconds[phase]++;
      if (phase !== previousPhase) phaseTransitions.push({ phase, ...stateSummary(game, tapsPerSecond) });
      previousPhase = phase;
    }
    const second = game.state.playedSeconds, taps = scheduledTaps(second, tapsPerSecond);
    for (let tap = 0; tap < taps; tap++) game.tap();
    assert.equal(game.tick(1).ok, true); collect();
  }
  assert.ok(afterOrder10 && beforeOrder11 && afterMultihead, 'Route must naturally reach the measured checkpoints');
  assert.ok(afterMultihead.seconds >= afterOrder10.seconds, 'Multihead is order-10 gated');
  const windowActions = actions.filter(a => a.inMidgameWindow);
  const upgradeActions = windowActions.filter(a => a.type === 'upgrade');
  const upgradeTimes = [...new Set(upgradeActions.map(a => a.seconds))];
  const actionGaps = [afterOrder10.seconds, ...new Set(windowActions.map(a => a.seconds)), beforeOrder11.seconds].sort((a, b) => a - b).map((n, i, a) => i ? n - a[i - 1] : 0);
  const midgame = { afterOrder10, afterMultihead, beforeOrder11,
    order10To11Seconds: beforeOrder11.seconds - afterOrder10.seconds,
    order10ToMultiheadSeconds: afterMultihead.seconds - afterOrder10.seconds,
    multiheadToOrder11Seconds: beforeOrder11.seconds - afterMultihead.seconds,
    phaseSeconds, phaseTransitions,
    upgradeActions: upgradeActions.length, upgradeActionMoments: upgradeTimes.length,
    upgradesBeforeMultihead: upgradeActions.filter(a => a.seconds < afterMultihead.seconds).length,
    upgradesAfterMultihead: upgradeActions.filter(a => a.seconds >= afterMultihead.seconds).length,
    upgradeActionTimes: upgradeTimes, longestGapWithoutNonTapActionSeconds: Math.max(...actionGaps),
    questClaims: windowActions.filter(a => a.type === 'quest').length,
    modeSwitches: windowActions.filter(a => a.type === 'productionMode').length,
    ledger, actions: windowActions };
  const coinDelta = beforeOrder11.coins - afterOrder10.coins;
  const accountedDelta = ledger.productionCoins + ledger.questCoins - ledger.upgradeCosts - ledger.machineCosts;
  assert.ok(Math.abs(coinDelta - accountedDelta) <= Math.max(1, Math.abs(coinDelta)) * 1e-9, 'Midgame coin ledger must reconcile; no injected funds');
  assert.equal(Object.values(phaseSeconds).reduce((a, b) => a + b, 0), midgame.order10To11Seconds, 'Mutually exclusive phase durations must reconcile');
  assert.ok(Math.abs((beforeOrder11.totalProduced - afterOrder10.totalProduced) - ledger.producedUnits) < 1e-6, 'Production must reconcile');
  if (!continuation) assert.equal(game.state.taps, Math.floor(game.state.playedSeconds * tapsPerSecond + 1e-9), 'Actual tap calls must match nominal cadence');
  return { policy, tapsPerSecond, investmentPolicy, fromNaturalCheckpoint: !!continuation,
    completed: game.state.orderIndex === 20 && game.state.machine === 5,
    mainOrdersSeconds: game.state.completedAt, endSeconds: game.state.playedSeconds,
    actualTapCalls: game.state.taps, orderTimeline, machineTimeline, midgame,
    ...(naturalCheckpoint ? { naturalCheckpoint } : {}) };
}
function run() {
  const artifactPath = path.resolve(__dirname, '../artifacts/mode-balance.json');
  const modeArtifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const routes = [], counterfactuals = [];
  for (const tapsPerSecond of TAP_RATES) for (const policy of POLICIES) {
    const route = simulate({ policy, tapsPerSecond }); assert.equal(route.completed, true);
    if (tapsPerSecond === 2) {
      const previous = modeArtifact.routes.find(r => r.policy === policy);
      assert.equal(route.mainOrdersSeconds, previous.mainOrdersSeconds, 'Active route must match existing mode artifact');
      assert.deepEqual(route.orderTimeline.map(o => o.seconds), previous.orders.map(o => o.seconds));
    }
    const branch = simulate({ policy, tapsPerSecond, continuation: route.naturalCheckpoint, investmentPolicy: 'device-first-after-10', stopAt11: true });
    counterfactuals.push({ policy, tapsPerSecond, scenario: 'From the same naturally-earned order-10 state, skip upgrades until the multihead machine is affordable; then resume original investment policy.', midgame: branch.midgame,
      order11ChangeSeconds: branch.midgame.order10To11Seconds - route.midgame.order10To11Seconds,
      machineChangeSeconds: branch.midgame.order10ToMultiheadSeconds - route.midgame.order10ToMultiheadSeconds });
    delete route.naturalCheckpoint; routes.push(route);
  }
  const comparison = routes.map(r => ({ policy: r.policy, tapsPerSecond: r.tapsPerSecond, mainOrdersSeconds: r.mainOrdersSeconds,
    order10At: r.midgame.afterOrder10.seconds, multiheadAt: r.midgame.afterMultihead.seconds, order11At: r.midgame.beforeOrder11.seconds,
    order10To11Seconds: r.midgame.order10To11Seconds, fundingPhaseSeconds: r.midgame.phaseSeconds.fundingLimitedWhileProducing,
    afterMultiheadSeconds: r.midgame.phaseSeconds.afterMultiheadProducing, order10CoinsMissing: r.midgame.afterOrder10.multiheadCoinsMissing,
    upgradeActions: r.midgame.upgradeActions, upgradeActionMoments: r.midgame.upgradeActionMoments,
    longestGapWithoutNonTapActionSeconds: r.midgame.longestGapWithoutNonTapActionSeconds }));
  return { purpose: 'Independent midgame analysis using actual core actions; not player data or proof of enjoyment, retention, or optimal strategy.',
    reproducibility: { command: 'node tools/midgame-analysis.cjs --output artifacts/midgame-analysis.json', coreSha256: crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../src/core.js'))).digest('hex'), modeArtifactSha256: crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex') },
    assumptions: { start: 'Fresh zero-coin Game, every route earns and spends through public actions.', taps: '2 taps each second; low-frequency route exactly 1 tap every 5 seconds. These control production taps only: both policies inspect and purchase once every second.', timestepSeconds: 1, quests: 'Claim as soon as available.', orders: 'Claim as soon as available.', ads: false, offline: false, perfectBurstAttempts: false,
      investment: 'Choose shortest marginal permanent-income payback, then save until affordable. Candidate rates use the canonical read-only _production forecast; no coins or state are injected.', switch: 'After mode unlock, rush while device orders are missing; premium when order-qualified device lacks funds; rush after final machine.', phaseAccounting: 'Production remains incomplete throughout order10-to11; fundingLimitedWhileProducing overlaps production and must not be added again. The three phaseSeconds buckets are mutually exclusive.', branch: 'Counterfactual branches restore the exact naturally-earned order-10 save at the identical timestamp, with no funds, time or rewards added.' },
    configuration: { orders: CONFIG.orders.slice(8, 12), machine: CONFIG.machines[3], modes: CONFIG.productionModes },
    verified: { activeRoutesMatchExistingModeArtifact: true, exactFractionalTapCadence: true, midgameCoinLedgersReconcile: true, phaseDurationsReconcile: true },
    interpretation: {
      structuralChange: {
        previousAdditionalUnits: CONFIG.orders[9].target - CONFIG.orders[8].target,
        nextAdditionalUnits: CONFIG.orders[10].target - CONFIG.orders[9].target,
        additionalUnitRequirementRatio: (CONFIG.orders[10].target - CONFIG.orders[9].target) / (CONFIG.orders[9].target - CONFIG.orders[8].target),
        multiheadProductionRatio: CONFIG.machines[3].multiplier / CONFIG.machines[2].multiplier,
        multiheadIncomeRatio: CONFIG.machines[3].multiplier * CONFIG.machines[3].priceMultiplier / (CONFIG.machines[2].multiplier * CONFIG.machines[2].priceMultiplier)
      },
      observations: [
        'Order 10 unlocks a cash gate for the multihead while order 11 continues to fill. Coin waiting and production waiting overlap before the device upgrade.',
        'Every simulated route still contains upgrades during this order, but action-free stretches are concentrated in the final saving phase before the device purchase.',
        'Every tested branch that skips upgrades to save directly for the multihead reaches order 11 later; an empty wallet immediately after a productive investment is not evidence that the investment was wrong.'
      ],
      recommendations: [
        'First expose the transition as two visible steps: device order conditions met / save for multihead, then complete order 11 with the new machine. Keep both cash and remaining production legible.',
        'Offer the high-price mode when device cash is limiting and rush mode when production is limiting; retain player control and show the reciprocal tradeoff.',
        'When an upgrade is recommended during saving, explain its production or income benefit and why a smaller wallet can still reach the device sooner.',
        'Use non-economic progress feedback during the long final saving stretch before considering more reward currencies or permanent upgrade layers.',
        'Keep current device price and order target for this iteration: these controlled routes complete, and simple saving-only alternatives are worse. This is sufficient to avoid a blind numerical change, not proof that present pacing is ideal.'
      ],
      unresolved: 'No player-observed acceptable wait duration is available. A future tuning decision needs actual observation of recognition, decisions and exits across this transition; scripted duration alone does not establish boredom or retention.'
    },
    batchUpgradeTiming: {
      purpose: 'Evaluate whether unlocking x5 purchase convenience at machine 4 leaves any eligible purchases under these fixed single-upgrade investment routes.',
      snapshots: routes.map(r => ({ policy: r.policy, tapsPerSecond: r.tapsPerSecond, machine3: r.machineTimeline.find(m => m.id === 3), machine4: r.machineTimeline.find(m => m.id === 4) })),
      recommendation: 'These eight routes reach machine 4 with all upgrades already at level 24. Machine 3 still has 18 active-route or 20 low-frequency-route upgrades left, so machine 3 is a useful unlock point for x5 convenience. This does not establish the distribution among actual players.'
    },
    comparison, counterfactualComparison: counterfactuals.map(c => ({ policy: c.policy, tapsPerSecond: c.tapsPerSecond, order11ChangeSeconds: c.order11ChangeSeconds, machineChangeSeconds: c.machineChangeSeconds, upgradeActions: c.midgame.upgradeActions })), routes, counterfactuals,
    limits: ['Low-frequency production tapping does not model a player who only returns every five seconds; purchases and claims remain instant policy decisions.', 'Auto-burst timings are discrete. Income estimates are long-run averages; all reported durations come from actual tick/tap actions.', 'Existing experience-low.json denotes small-viewport browser QA, not low-frequency player measurements.', 'The comparison changes only strategy and tapping cadence, not game prices, targets, multipliers or rewards.', 'No actual player behavior, device performance, advertisements, or frontend navigation costs are measured.'] };
}
if (require.main === module) {
  const report = run(), index = process.argv.indexOf('--output');
  if (index >= 0) {
    assert.ok(process.argv[index + 1], '--output needs a path');
    const output = path.resolve(process.argv[index + 1]);
    assert.equal(output, path.resolve(__dirname, '../artifacts/midgame-analysis.json'));
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ output, verified: report.verified, comparison: report.comparison, counterfactualComparison: report.counterfactualComparison }, null, 2) + '\n');
  } else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
module.exports = { simulate, run, scheduledTaps };