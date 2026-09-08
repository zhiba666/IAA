'use strict';
// Deterministic policy simulation, not a prediction of human sessions or ad revenue.
// Run: node tests/balance.cjs
const { Game, CONFIG } = require('../src/core.js');
const assert = require('node:assert/strict');
function projectedIncome(production, tapsPerSecond, passiveEnergy, limited, equipment = []) {
  const { tap, baseAuto, price } = production;
  // Three inputs per pot after the twin machine; estimate only for investment
  // ranking. Actual production always uses Game.tap / Game.tick below.
  const taps = limited ? Math.min(tapsPerSecond, 3 * passiveEnergy / (CONFIG.energyMax - 3 * CONFIG.tapEnergy)) : tapsPerSecond;
  const burstsPerSecond = (passiveEnergy + CONFIG.tapEnergy * taps) / CONFIG.energyMax;
  const pressure = equipment.includes('pressure') ? 1.25 : 1;
  const feeder = equipment.includes('feeder') ? tap * passiveEnergy / CONFIG.energyMax : 0;
  return (tap * taps + baseAuto + burstsPerSecond * (24 * tap + 8 * baseAuto) * pressure + feeder) * price;
}
function chooseInvestment(game, tapsPerSecond) {
  const view = game.getView(), p = view.production, passive = view.factory.passiveEnergy;
  const before = projectedIncome(p, tapsPerSecond, passive, view.factory.unlocked, view.factory.owned), options = [];
  for (const u of view.upgrades) {
    if (u.unlocked === false || u.level >= u.maxLevel || !u.preview) continue;
    const projected = { ...p };
    if (u.key === 'tap') projected.tap = u.preview.after;
    if (u.key === 'auto') projected.baseAuto = u.preview.after / p.price;
    if (u.key === 'value') projected.price = u.preview.after;
    const after = projectedIncome(projected, tapsPerSecond, passive, view.factory.unlocked, view.factory.owned);
    options.push({ key: u.key, cost: u.cost, payback: u.cost / (after - before) });
  }
  if (view.nextMachine && game.state.orderIndex >= view.nextMachine.requiredOrders) {
    const ratio = view.nextMachine.multiplier / view.machine.multiplier;
    const projected = { ...p, tap: view.machinePreview.tapAfter, baseAuto: p.baseAuto * ratio,
      price: p.price * view.nextMachine.priceMultiplier / view.machine.priceMultiplier };
    const projectedEquipment = view.factory.owned.concat(view.nextMachine.id >= 3 && !view.factory.owned.includes('feeder') ? ['feeder'] : []);
    const nextPassive = (view.nextMachine.id + 3) * (projectedEquipment.includes('reclaimer') ? 1.1 : 1);
    const after = projectedIncome(projected, tapsPerSecond, nextPassive, view.nextMachine.id >= 2, projectedEquipment);
    options.push({ key: 'machine', cost: view.nextMachine.cost, payback: view.nextMachine.cost / (after - before) });
  }
  options.sort((a, b) => a.payback - b.payback || a.cost - b.cost);
  return options[0];
}
function simulate({ name, tapsPerSecond = 2, highAds = false, permanentAds = false, offlineAfter = null, adOrderWaitSeconds = 90, collectQuests = false, contractKinds = ['cinema', 'gift', 'festival'] }) {
  let game = new Game({ now: 1000000 }), wall = 0, didOffline = false;
  const machines = [{ name: CONFIG.machines[0].name, wallSeconds: 0, playSeconds: 0 }], orders = [], ads = [], milestones = {};
  const deviceFunding = [], upgradePurchases = [], questClaims = [], contracts = [], equipment = []; let offline = null;
  let acceptedContracts = 0, successfulTaps = 0;
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
      if (e.type === 'quest') questClaims.push({ id: e.id, title: e.title, coins: e.coins, automatic: e.automatic === true, ...stamp });
      if (e.type === 'contract' && e.action === 'accept') contracts.push({ id: e.id, kind: e.kind, ...stamp });
    }
    for (const id of game.getView().factory.owned) if (!equipment.some(item => item.id === id))
      equipment.push({ id, orderIndex: game.state.orderIndex, ...{ wallSeconds: wall, playSeconds: game.state.playedSeconds } });
    const next = CONFIG.machines[game.state.machine + 1];
    if (next && !deviceFunding.find(d => d.name === next.name) && game.state.orderIndex >= next.requiredOrders) {
      deviceFunding.push({ name: next.name, wallSeconds: wall, playSeconds: game.state.playedSeconds, cost: next.cost, coins: game.state.coins, gap: Math.max(0, next.cost - game.state.coins), baseIncome: game.getView().production.baseIncome });
    }
  }
  function collectQuestRewards() {
    // Compatibility flag retained for old analysis callers. Growth rewards now
    // arrive through ordinary gameplay events without any claimQuest action.
    collect();
  }
  function reward(kind) {
    const q = game.quoteReward(kind); if (!q) return false;
    const beforeView = game.getView();
    const before = { coins: game.state.coins, baseIncome: beforeView.production.baseIncome, nextMachineCost: beforeView.nextMachine?.cost || 0,
      brandLevel: game.state.brandLevel, machine: game.state.machine, orderReward: beforeView.order.reward, boostSeconds: beforeView.boostSeconds };
    wall += 30; // Actual main loop pauses game.tick and tapping while adBusy.
    const questStart = questClaims.length;
    const result = game.applyReward(q.id); assert.equal(result.ok, true);
    collect();
    ads.push({ kind, wallSeconds: wall, playSeconds: game.state.playedSeconds, promised: q.amount, grantedCoins: result.coins, before, afterCoins: game.state.coins,
      automaticQuestCoins: questClaims.slice(questStart).reduce((sum, quest) => sum + quest.coins, 0),
      afterBrandLevel: game.state.brandLevel, afterBaseIncome: game.getView().production.baseIncome });
    collect(); collectQuestRewards(); return true;
  }
  while (wall < 172800 && (game.state.orderIndex < 20 || game.state.machine < 5)) {
    if (!didOffline && offlineAfter !== null && game.state.playedSeconds >= offlineAfter) {
      const savedAt = 1000000 + wall * 1000, before = game.state.totalProduced;
      wall += 8 * 3600; didOffline = true;
      game = new Game({ save: game.exportSave(savedAt), now: 1000000 + wall * 1000 });
      offline = { ...game.getView().offline, wallSeconds: wall, playSeconds: game.state.playedSeconds };
      assert.ok(offline.production > 0); assert.equal(game.claimOffline().ok, true);
      assert.ok(Math.abs(game.state.totalProduced - before - offline.production) <= Math.max(1e-7, offline.production * 1e-10)); collect();
    }
    collectQuestRewards();
    // Permanent cooperation has priority once each device unlocks its two levels.
    // Every video still adds 30 seconds of paused gameplay to the session.
    if (permanentAds && game.getView().rewards.brand.available) reward('brand');
    const view = game.getView();
    if (highAds) {
      const productionRate = projectedIncome(view.production, tapsPerSecond, view.factory.passiveEnergy, view.factory.unlocked, view.factory.owned) / view.production.price + (view.boostSeconds > 0 ? view.production.baseAuto * 2 : 0);
      const nextOrderSeconds = view.order.kind === 'tutorial' ? Math.max(0, view.order.target - game.state.totalProduced) / productionRate
        : view.contracts.active ? Math.max(0, 1 - view.contracts.active.progress) * 60 : Infinity;
      const saveAdForOrder = nextOrderSeconds <= adOrderWaitSeconds && view.order.reward * 2 > view.production.baseIncome * CONFIG.turboDuration * 2;
      if (view.order.ready && view.rewards.order.available) reward('order');
      else if (view.rewards.sponsor.available && view.nextMachine && view.nextMachine.cost > game.state.coins && view.nextMachine.cost - game.state.coins <= view.rewards.sponsor.amount) reward('sponsor');
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
    const current = game.getView();
    if (current.contracts.unlocked && !current.contracts.active && !current.contracts.completed) {
      const kind = contractKinds[acceptedContracts % contractKinds.length];
      const quote = current.contracts.options.find(option => option.kind === kind && option.canAccept)
        || current.contracts.options.find(option => option.canAccept);
      if (quote) { assert.equal(game.acceptContract(quote.kind, quote).ok, true); acceptedContracts++; collect(); }
    }
    for (let i = 0; i < tapsPerSecond; i++) {
      if (!game.getView().factory.tapReady) break;
      const result = game.tap(); if (result.ok !== false) successfulTaps++;
    }
    game.tick(1); wall++; collect();
  }
  for (const ad of ads) {
    ad.upgradesWithin30PlaySeconds = upgradePurchases.filter(u => u.playSeconds >= ad.playSeconds && u.playSeconds <= ad.playSeconds + 30).length;
    ad.machinesWithin30PlaySeconds = machines.filter(m => m.playSeconds >= ad.playSeconds && m.playSeconds <= ad.playSeconds + 30).map(m => m.name);
  }
  for (const funding of deviceFunding) { const acquired = machines.find(m => m.name === funding.name); funding.fundingWaitSeconds = acquired ? acquired.playSeconds - funding.playSeconds : null; }
  return {
    name, assumptions: { tapsPerSecond, highAds, permanentAds, collectQuests: 'automatic', legacyCollectQuestsArgument: collectQuests, adSeconds: 30, adPausesGameplay: true, adOrderWaitSeconds,
      adPolicy: 'available permanent level if enabled; ready order; sponsor only if it closes a positive device gap; otherwise renew expired turbo unless a more valuable order is expected soon',
      investmentPolicy: 'read-only public upgrade/device previews, estimated best marginal permanent-income payback; save until affordable',
      contractPolicy: contractKinds.join('/') + ' rotation among unlocked acceptable routes, all owned devices active; only public accept/claim; limited input follows tapReady',
      offlineAfter, offlineSeconds: offline ? 28800 : 0 },
    completed: game.state.orderIndex === 20 && game.state.machine === 5, playSeconds: game.state.playedSeconds, wallSeconds: wall,
    mainOrdersCompletedAt: game.state.completedAt, allMachines: game.state.machine === 5, milestones, machines, orders, contracts, equipment, successfulTaps, deviceFunding,
    questRewardCount: questClaims.length, questRewardCoins: questClaims.reduce((sum, claim) => sum + claim.coins, 0), questClaims,
    adsInFirst20WallMinutes: ads.filter(ad => ad.wallSeconds <= 1200).length, rewardCount: ads.length, ads, offline,
    final: { coins: game.state.coins, totalProduced: game.state.totalProduced, upgrades: game.state.upgrades, brandLevel: game.state.brandLevel, baseIncome: game.getView().production.baseIncome,
      owned: game.getView().factory.owned, contractCounts: game.state.factory.contractCounts }
  };
}
function runAll() {
  return [
    simulate({ name: '主动零广告' }),
    simulate({ name: '主动高广告', highAds: true }),
    simulate({ name: '放置生产（无点击，持续升级和结算）', tapsPerSecond: 0 }),
    simulate({ name: '离线回归（主动2分钟→离线8小时→主动）', offlineAfter: 120 }),
    simulate({ name: '主动仅永久广告', permanentAds: true }),
    simulate({ name: '主动综合广告', highAds: true, permanentAds: true })
  ];
}
if (require.main === module) process.stdout.write(JSON.stringify({ config: CONFIG, routes: runAll() }, null, 2) + '\n');
module.exports = { simulate, runAll };
