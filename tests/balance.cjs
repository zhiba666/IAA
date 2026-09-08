'use strict';
// Deterministic policy simulation, not a prediction of human sessions or ad revenue.
// Run: node tests/balance.cjs
const { Game, CONFIG } = require('../src/core.js');
const assert = require('node:assert/strict');
const KEYS = ['tap', 'auto', 'value'];
function income(game, tapsPerSecond) {
  const { tap, baseAuto, price } = game.getView().production;
  const burstsPerSecond = (CONFIG.passiveEnergy + CONFIG.tapEnergy * tapsPerSecond) / CONFIG.energyMax;
  return (tap * tapsPerSecond + baseAuto + burstsPerSecond * (24 * tap + 8 * baseAuto)) * price;
}
function chooseInvestment(game, tapsPerSecond) {
  const view = game.getView(), before = income(game, tapsPerSecond), options = [];
  for (const u of view.upgrades) {
    if (u.level >= u.maxLevel) continue;
    game.state.upgrades[u.key]++; const after = income(game, tapsPerSecond); game.state.upgrades[u.key]--;
    options.push({ key: u.key, cost: u.cost, payback: u.cost / (after - before) });
  }
  if (view.nextMachine && game.state.orderIndex >= view.nextMachine.requiredOrders) {
    game.state.machine++; const after = income(game, tapsPerSecond); game.state.machine--;
    options.push({ key: 'machine', cost: view.nextMachine.cost, payback: view.nextMachine.cost / (after - before) });
  }
  options.sort((a, b) => a.payback - b.payback || a.cost - b.cost);
  return options[0];
}
function simulate({ name, tapsPerSecond = 2, highAds = false, permanentAds = false, offlineAfter = null, adOrderWaitSeconds = 90, collectQuests = false }) {
  let game = new Game({ now: 1000000 }), wall = 0, didOffline = false;
  const machines = [{ name: CONFIG.machines[0].name, wallSeconds: 0, playSeconds: 0 }], orders = [], ads = [], milestones = {};
  const deviceFunding = [], upgradePurchases = [], questClaims = []; let offline = null;
  function collect() {
    for (const e of game.drainEvents()) {
      const stamp = { wallSeconds: wall, playSeconds: game.state.playedSeconds };
      if (e.type === 'burst' && !milestones.firstBurst) milestones.firstBurst = stamp;
      if (e.type === 'upgrade') {
        if (!milestones.firstUpgrade) milestones.firstUpgrade = stamp;
        if (e.key === 'auto' && !milestones.firstAutomationUpgrade) milestones.firstAutomationUpgrade = stamp;
        upgradePurchases.push({ ...stamp, key: e.key, level: e.level, cost: e.cost });
      }
      if (e.type === 'evolve') machines.push({ name: e.name, ...stamp });
      if (e.type === 'order') {
        orders.push({ number: e.index + 1, name: e.name, ...stamp, coins: e.coins });
      }
    }
    const next = CONFIG.machines[game.state.machine + 1];
    if (next && !deviceFunding.find(d => d.name === next.name) && game.state.orderIndex >= next.requiredOrders) {
      deviceFunding.push({ name: next.name, wallSeconds: wall, playSeconds: game.state.playedSeconds, cost: next.cost, coins: game.state.coins, gap: Math.max(0, next.cost - game.state.coins), baseIncome: game.getView().production.baseIncome });
    }
  }
  function collectQuestRewards() {
    if (!collectQuests) return;
    // A claim may unlock a chapter whose historic conditions are already met.
    // Refresh the view after every claim until the available chain is exhausted.
    for (;;) {
      const quest = game.getView().quests.chapters.flatMap(chapter => chapter.quests).find(q => q.ready);
      if (!quest) return;
      const before = { coins: game.state.coins, machine: game.state.machine, orders: game.state.orderIndex };
      const result = game.claimQuest(quest.id); assert.equal(result.ok, true);
      questClaims.push({ id: quest.id, title: quest.title, coins: result.coins, wallSeconds: wall, playSeconds: game.state.playedSeconds, before, afterCoins: game.state.coins });
      collect();
    }
  }
  function reward(kind) {
    const q = game.quoteReward(kind); if (!q) return false;
    const beforeView = game.getView();
    const before = { coins: game.state.coins, baseIncome: beforeView.production.baseIncome, nextMachineCost: beforeView.nextMachine?.cost || 0,
      brandLevel: game.state.brandLevel, machine: game.state.machine, orderReward: beforeView.order.reward, boostSeconds: beforeView.boostSeconds };
    wall += 30; // Actual main loop pauses game.tick and tapping while adBusy.
    const result = game.applyReward(q.id); assert.equal(result.ok, true);
    ads.push({ kind, wallSeconds: wall, playSeconds: game.state.playedSeconds, promised: q.amount, grantedCoins: result.coins, before, afterCoins: game.state.coins,
      afterBrandLevel: game.state.brandLevel, afterBaseIncome: game.getView().production.baseIncome });
    collect(); collectQuestRewards(); return true;
  }
  while (wall < 172800 && (game.state.orderIndex < 20 || game.state.machine < 5)) {
    if (!didOffline && offlineAfter !== null && game.state.playedSeconds >= offlineAfter) {
      const savedAt = 1000000 + wall * 1000, before = game.state.totalProduced;
      wall += 8 * 3600; didOffline = true;
      game = new Game({ save: game.exportSave(savedAt), now: 1000000 + wall * 1000 });
      offline = { ...game.state.offline, wallSeconds: wall, playSeconds: game.state.playedSeconds };
      assert.ok(offline.production > 0); game.claimOffline(); assert.equal(game.state.totalProduced, before + offline.production); collect();
    }
    collectQuestRewards();
    // Permanent cooperation has priority once each device unlocks its two levels.
    // Every video still adds 30 seconds of paused gameplay to the session.
    if (permanentAds && game.getView().rewards.brand.available) reward('brand');
    const view = game.getView();
    if (highAds) {
      const productionRate = income(game, tapsPerSecond) / view.production.price + (view.boostSeconds > 0 ? view.production.baseAuto * 2 : 0);
      const nextOrderSeconds = Math.max(0, view.order.target - game.state.totalProduced) / productionRate;
      const saveAdForOrder = nextOrderSeconds <= adOrderWaitSeconds && view.order.reward * 2 > view.production.baseIncome * CONFIG.turboDuration * 2;
      if (view.order.ready && view.rewards.order.available) reward('order');
      else if (view.rewards.sponsor.available && view.nextMachine.cost > game.state.coins && view.nextMachine.cost - game.state.coins <= view.rewards.sponsor.amount) reward('sponsor');
      else if (view.rewards.turbo.available && view.boostSeconds <= 0 && !saveAdForOrder) reward('turbo');
    }
    while (game.state.orderIndex < 20 && game.getView().order.ready) { game.claimOrder(); collect(); collectQuestRewards(); }
    // A concrete, reproducible policy: invest in the next improvement with the
    // shortest permanent-income payback, saving until that purchase is affordable.
    for (let purchases = 0; purchases < 20; purchases++) {
      const choice = chooseInvestment(game, tapsPerSecond);
      if (!choice || game.state.coins < choice.cost) break;
      const result = choice.key === 'machine' ? game.evolve() : game.buyUpgrade(choice.key);
      assert.equal(result.ok, true); collect(); collectQuestRewards();
    }
    if (game.state.orderIndex >= 20 && game.state.machine >= 5) break;
    for (let i = 0; i < tapsPerSecond; i++) game.tap();
    game.tick(1); wall++; collect();
  }
  for (const ad of ads) {
    ad.upgradesWithin30PlaySeconds = upgradePurchases.filter(u => u.playSeconds >= ad.playSeconds && u.playSeconds <= ad.playSeconds + 30).length;
    ad.machinesWithin30PlaySeconds = machines.filter(m => m.playSeconds >= ad.playSeconds && m.playSeconds <= ad.playSeconds + 30).map(m => m.name);
  }
  for (const funding of deviceFunding) { const acquired = machines.find(m => m.name === funding.name); funding.fundingWaitSeconds = acquired ? acquired.playSeconds - funding.playSeconds : null; }
  return {
    name, assumptions: { tapsPerSecond, highAds, permanentAds, collectQuests, adSeconds: highAds || permanentAds ? 30 : 0, adPausesGameplay: true, adOrderWaitSeconds,
      adPolicy: 'available permanent level if enabled; ready order; sponsor only if it closes a positive device gap; otherwise renew expired turbo unless a more valuable order is expected soon',
      investmentPolicy: 'best marginal permanent-income payback; save until affordable', offlineAfter, offlineSeconds: offline ? 28800 : 0 },
    completed: game.state.orderIndex === 20 && game.state.machine === 5, playSeconds: game.state.playedSeconds, wallSeconds: wall,
    mainOrdersCompletedAt: game.state.completedAt, allMachines: game.state.machine === 5, milestones, machines, orders, deviceFunding,
    questRewardCount: questClaims.length, questRewardCoins: questClaims.reduce((sum, claim) => sum + claim.coins, 0), questClaims,
    adsInFirst20WallMinutes: ads.filter(ad => ad.wallSeconds <= 1200).length, rewardCount: ads.length, ads, offline,
    final: { coins: game.state.coins, totalProduced: game.state.totalProduced, upgrades: game.state.upgrades, brandLevel: game.state.brandLevel, baseIncome: game.getView().production.baseIncome }
  };
}
function runAll() {
  return [
    simulate({ name: '主动零广告' }),
    simulate({ name: '主动高广告', highAds: true }),
    simulate({ name: '放置生产（无点击，持续升级和结算）', tapsPerSecond: 0 }),
    simulate({ name: '离线回归（主动10分钟→离线8小时→主动）', offlineAfter: 600 }),
    simulate({ name: '主动仅永久广告', permanentAds: true }),
    simulate({ name: '主动综合广告', highAds: true, permanentAds: true })
  ];
}
if (require.main === module) process.stdout.write(JSON.stringify({ config: CONFIG, routes: runAll() }, null, 2) + '\n');
module.exports = { simulate, runAll };
