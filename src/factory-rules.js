'use strict';
const { featureAccess, normalizeOnboarding, selectOnboarding } = require('./onboarding');
const { MODULES, equipmentProgress } = require('./equipment');

// The contract campaign replaces the old parallel counters. Kept separate so
// legacy save normalization and the existing platform reward protocol stay intact.
const KINDS = ['cinema', 'gift', 'festival'];
const safe = (n, max = 1e150) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
const fail = reason => ({ ok: false, reason });
const copy = value => JSON.parse(JSON.stringify(value));

function installFactoryGame(Game, CONFIG, QUEST_CHAPTERS, formatNumber) {
  // Base persistence, tutorial and purchase helpers are defined exactly once in
  // core.js. Live production and the contract campaign are defined in this module.
  const helpers = { _restore: '_restoreLegacyState', _order: '_tutorialOrder', _claimOrder: '_claimTutorialOrder',
    _rewardOffer: '_baseRewardOffer', _goal: '_baseGoal', getView: '_baseView', buyUpgrade: '_purchaseUpgrade',
    buyUpgradeBatch: '_purchaseUpgradeBatch', evolve: '_evolveMachine', buySouvenir: '_purchaseSouvenir', _souvenirs: '_baseSouvenirs' };
  const old = Object.fromEntries(Object.entries(helpers).map(([key, name]) => [key, Game.prototype[name]]));

  Game.prototype._ensureFactory = function () {
    if (!this.state.factory) this.state.factory = { version: 3, owned: [], pressureMode: 'auto', contractCounts: { cinema: 0, gift: 0, festival: 0 }, serial: 0,
      active: null, storedBurst: null, tapsThisPot: 0, tapCooldown: 0, completedContracts: 0 };
    return this.state.factory;
  };
  Game.prototype._hasModule = function (id) { return this.state.machine >= 2 && this._ensureFactory().owned.includes(id); };
  Game.prototype._syncEquipment = function (silent = false) {
    const f = this._ensureFactory();
    for (const item of equipmentProgress(this.state)) if (item.earned && !item.owned) {
      f.owned.push(item.id); f.serial++;
      if (!silent) this._event('module', { action: 'unlock', id: item.id, name: item.name, owned: f.owned.slice(), equipped: f.owned.slice() });
    }
  };
  Game.prototype._passiveEnergy = function () { return (this.state.machine ? this.state.machine + 3 : 1) * (this._hasModule('reclaimer') ? 1.1 : 1); };
  Game.prototype._factoryBasis = function () {
    const s = this.state;
    return JSON.stringify([s.machine, s.upgrades, s.brandLevel, s.refinements, s.research.levels, this._ensureFactory().owned,
      { version: 3, allocation: .6, packingBonus: this._hasModule('packer') ? .15 : 0, qualityBonus: this._hasModule('inspector') ? .05 : 0 }]);
  };
  Game.prototype._autoQuests = function () {
    for (const chapter of QUEST_CHAPTERS) {
      for (const q of chapter.quests) {
        if (this.state.claimedQuests.includes(q.id)) continue;
        const current = q.metric === 'upgrade' ? this.state.upgrades[q.key] : this.state[q.metric];
        if (current < q.target) continue;
        this.state.claimedQuests.push(q.id); this._addCoins(q.reward);
        this._event('quest', { id: q.id, title: q.title, coins: q.reward, automatic: true });
      }
      if (!chapter.quests.every(q => this.state.claimedQuests.includes(q.id))) break;
    }
    this._syncEquipment();
  };
  Game.prototype._contractOption = function (kind, restoredBasis = null, frozenTerms = null) {
    const f = this._ensureFactory(), s = this.state, p = this._production({ ...(restoredBasis || {}), productionMode: 'balanced', boostSeconds: 0 });
    const index = s.orderIndex, stageMachine = index >= 18 ? 5 : index >= 14 ? 4 : index >= 10 ? 3 : 2;
    const quantity = Math.max(50, Math.ceil(p.baseAuto * (kind === 'cinema' ? 24 : kind === 'gift' ? 15 : 6) + p.tap * 4));
    const title = kind === 'cinema' ? '影院大批量' : kind === 'gift' ? '精品糖衣礼盒' : '庆典现场爆香';
    const key = kind === 'cinema' ? 'quantity' : kind === 'gift' ? 'coated' : 'batches';
    const target = kind === 'festival' ? 3 : quantity;
    const reason = index >= 20 ? 'campaign-complete' : index < 6 || s.machine < 2 ? 'contracts-locked'
      : s.machine < stageMachine ? 'machine-required' : f.active ? 'contract-active'
        : Object.keys(s.pendingRewards).length ? 'busy'
          : kind !== 'cinema' && !featureAccess(s)[kind] ? 'guide-locked' : '';
    const terms = frozenTerms || { allocation: .6, packingBonus: this._hasModule('packer') ? .15 : 0, qualityBonus: this._hasModule('inspector') ? .05 : 0 };
    const reward = Math.floor(Math.max(p.baseIncome * 48, (CONFIG.orders[index] || {}).reward || 0) * (kind === 'cinema' ? 1 : kind === 'gift' ? 2.2 : 4) * (1 + terms.qualityBonus));
    return { id: `contract:${index}:${f.serial}:${kind}`, kind, title,
      description: (kind === 'cinema' ? '装满合同数量即可交付。' : kind === 'gift' ? '原料进入合同后还要自动加工糖衣。' : '完成3次真实出锅；释放储压也算一次。')
        + `分配${Math.round(terms.allocation * 100)}%常规产出，货款交付结算。` + (terms.packingBonus ? '装箱臂额外生产15%合同货物。' : ''),
      requirements: [{ key, label: key === 'quantity' ? '装箱数量' : key === 'coated' ? '糖衣成品' : '爆锅批次', current: 0, target, unit: key === 'batches' ? '锅' : '份' }],
      quantityTarget: quantity, reward, ...terms, canAccept: !reason, reason, basis: this._factoryBasis() };
  };
  Game.prototype._contractView = function () {
    const a = this._ensureFactory().active;
    if (!a) return null;
    const current = a.kind === 'cinema' ? a.quantity : a.kind === 'gift' ? a.coated : a.batches;
    const target = a.kind === 'festival' ? 3 : a.quantityTarget;
    const key = a.kind === 'cinema' ? 'quantity' : a.kind === 'gift' ? 'coated' : 'batches';
    return { id: a.id, kind: a.kind, title: a.title, description: a.description,
      requirements: [{ key, label: key === 'quantity' ? '装箱数量' : key === 'coated' ? '糖衣成品' : '爆锅批次', current: Math.min(target, current), target, unit: key === 'batches' ? '锅' : '份' }],
      progress: Math.min(1, current / target), ready: current >= target,
      reward: a.reward, heldCoins: a.heldCoins, heldProduction: a.quantity, coated: a.coated, batches: a.batches,
      quantityTarget: a.quantityTarget, allocation: a.allocation, packingBonus: a.packingBonus, qualityBonus: a.qualityBonus };
  };
  Game.prototype.toggleModule = function (id) {
    if (!MODULES.some(m => m.id === id)) return fail('invalid-module');
    return fail('equipment-permanent');
  };
  Game.prototype.setPressureMode = function (mode) {
    if (!['auto', 'hold'].includes(mode)) return fail('invalid-pressure-mode');
    if (!this._hasModule('pressure')) return fail('pressure-locked');
    if (Object.keys(this.state.pendingRewards).length) return fail('busy');
    const f = this._ensureFactory(); f.pressureMode = mode;
    if (mode === 'auto' && f.storedBurst) this.releasePressure();
    return { ok: true, mode };
  };
  Game.prototype.acceptContract = function (kind, quote) {
    if (!KINDS.includes(kind)) return fail('invalid-contract');
    const option = this._contractOption(kind), f = this._ensureFactory();
    if (!option.canAccept) return fail(option.reason);
    if (quote && (quote.id !== option.id || quote.basis !== option.basis || quote.reward !== option.reward
      || quote.quantityTarget !== option.quantityTarget)) return fail('stale-contract');
    f.active = { ...copy(option), orderIndex: this.state.orderIndex, quantity: 0, coated: 0, batches: 0, heldCoins: 0 };
    f.serial++; this._event('contract', { action: 'accept', id: option.id, kind, title: option.title });
    return { ok: true, ...this._contractView() };
  };
  Game.prototype.cancelContract = function (id) {
    const f = this._ensureFactory();
    if (!f.active || f.active.id !== id) return fail('stale-contract');
    if (Object.keys(this.state.pendingRewards).length) return fail('busy');
    const a = f.active; f.active = null; f.serial++;
    this._event('contract', { action: 'cancel', id, kind: a.kind, discardedProduction: a.quantity });
    return { ok: true, discardedProduction: a.quantity };
  };
  Game.prototype._routeProduction = function (amount, price, source, contractId) {
    const n = safe(amount), f = this._ensureFactory(), a = f.active;
    let held = 0, bonus = 0;
    if (a && (contractId === undefined || a.id === contractId) && !this._contractView().ready) {
      const remaining = Math.max(0, a.quantityTarget - a.quantity), share = a.allocation + (a.packingBonus || 0);
      const input = Math.min(n, remaining / share);
      held = Math.min(remaining, input * a.allocation);
      bonus = Math.min(remaining - held, input * (a.packingBonus || 0));
      a.quantity += held + bonus; a.heldCoins = safe(a.heldCoins + (held + bonus) * price);
      if (held && this._hasModule('packer')) this._event('batch', { kind: 'packer', amount: held, contractId: a.id });
    }
    const coins = safe((n - held) * price);
    this.state.totalProduced = safe(this.state.totalProduced + n + bonus); this._addCoins(coins);
    this._event('produce', { source, amount: n + bonus, coins, heldProduction: held + bonus, contractId: held + bonus && a ? a.id : null });
    return { amount: n + bonus, coins, heldProduction: held + bonus, bonusProduction: bonus };
  };
  Game.prototype._produce = function (amount, source) { return this._routeProduction(amount, this._production().price, source); };
  Game.prototype._processCoating = function (capacity, contractId) {
    const a = this._ensureFactory().active;
    if (a && a.kind === 'gift' && (contractId === undefined || contractId === a.id)) {
      const before = a.coated;
      a.coated = Math.min(a.quantity, a.quantityTarget, a.coated + safe(capacity));
      if (a.coated > before) this._event('batch', { kind: 'coating', amount: a.coated - before, contractId: a.id });
    }
  };
  Game.prototype._burst = function (storedAmount = null, automatic = false) {
    const f = this._ensureFactory(), p = this._production();
    const amount = storedAmount === null ? p.tap * 24 + p.baseAuto * 8 : storedAmount;
    const result = this._produce(amount, 'burst');
    this.state.bursts++; f.tapsThisPot = 0; f.tapCooldown = 0;
    if (f.active && f.active.kind === 'festival') f.active.batches = Math.min(3, f.active.batches + 1);
    this._event('burst', { amount: result.amount, coins: result.coins, immediate: true, source: storedAmount === null ? 'pot' : 'pressure', automatic });
    this._autoQuests(); return { ok: true, amount: result.amount, coins: result.coins };
  };
  Game.prototype._addEnergy = function (amount) {
    const f = this._ensureFactory(); this.state.energy += amount;
    while (this.state.energy >= 100) {
      this.state.energy -= 100;
      if (this._hasModule('pressure') && f.pressureMode === 'auto') {
        const p = this._production(); this._burst((p.tap * 24 + p.baseAuto * 8) * 1.25, true);
      } else if (this._hasModule('pressure') && !f.storedBurst) {
        const p = this._production(); f.storedBurst = { amount: (p.tap * 24 + p.baseAuto * 8) * 1.25 };
        f.tapsThisPot = 0; f.tapCooldown = 0;
        this._event('pressure', { action: 'store', amount: f.storedBurst.amount });
      } else this._burst();
      // One extra real input for each naturally charged pot. This never counts
      // as a player tap, adds energy or grants another feeder input on release.
      if (this._hasModule('feeder')) {
        const result = this._produce(this._production().tap, 'feeder');
        this._event('batch', { kind: 'feeder', amount: result.amount });
      }
    }
  };
  Game.prototype.releasePressure = function () {
    const f = this._ensureFactory();
    if (!f.storedBurst) return fail('no-stored-burst');
    const amount = f.storedBurst.amount; f.storedBurst = null;
    return this._burst(amount);
  };
  Game.prototype.tap = function () {
    const f = this._ensureFactory();
    if (this.state.machine >= 2 && (f.tapCooldown > 0 || f.tapsThisPot >= 3)) return fail(f.tapCooldown > 0 ? 'tap-cooldown' : 'pot-taps-used');
    this.state.onboarding = normalizeOnboarding(this.state.onboarding, this.state);
    const amount = this._production().tap;
    this.state.taps++; f.tapsThisPot++; if (this.state.machine >= 2) f.tapCooldown = 1;
    this._produce(amount, 'tap'); this._addEnergy(2); this._autoQuests();
    this._recordOnboardingPractice('production');
    for (const key of ['tap', 'value']) {
      const baseline = this.state.onboarding.baselines[key];
      if (this.state.upgrades[key] > 0 && (!baseline || this.state.taps > baseline.taps))
        this._recordOnboardingPractice(key + 'Verified');
    }
    const guide = this.state.onboarding;
    if (!guide.practice.autoObserved) {
      guide.autoObservationSeconds = 0;
      if (guide.baselines.auto) guide.baselines.auto.observedAt = this.state.playedSeconds;
    }
    return { ok: true, amount, recoveryUsed: false, heatRecoveryTaps: 0 };
  };
  Game.prototype.tick = function (dt) {
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return fail('invalid-time');
    const elapsed = Math.min(dt, 60), f = this._ensureFactory();
    this._syncEquipment();
    if (f.pressureMode === 'auto' && f.storedBurst) this.releasePressure();
    let remaining = elapsed;
    while (remaining > 0) {
      const seconds = Math.min(1, remaining, Math.max(1e-9, (100 - this.state.energy) / this._passiveEnergy())), p = this._production(), boosted = Math.min(seconds, this.state.boostSeconds);
      this._produce(p.baseAuto * (seconds + boosted * 2), 'auto');
      this._processCoating(p.baseAuto * seconds * (this._hasModule('coating') ? .5 : .2));
      this.state.boostSeconds = Math.max(0, this.state.boostSeconds - seconds);
      this.state.playedSeconds += seconds; f.tapCooldown = Math.max(0, f.tapCooldown - seconds);
      this._addEnergy(seconds * this._passiveEnergy());
      remaining -= seconds;
    }
    this._autoQuests(); return { ok: true, seconds: elapsed };
  };
  Game.prototype._order = function () {
    const s = this.state;
    if (s.orderIndex < 6) return { ...old._order.call(this), kind: 'tutorial', awaitingSelection: false, completed: false, requirements: [] };
    if (s.orderIndex >= 20) return { name: '工厂竣工', kind: 'complete', target: s.totalProduced, reward: 0, fullReward: 0,
      index: 20, number: 20, progress: 1, stageProgress: 1, ready: false, isLoop: false, completed: true, awaitingSelection: false, requirements: [] };
    const a = this._contractView(), current = a ? a.requirements[0].current : 0, target = a ? a.requirements[0].target : 1;
    return { name: a ? a.title : '选择下一张合同', kind: a ? a.kind : null, target, current,
      reward: a ? a.reward + a.heldCoins : 0, fullReward: a ? a.reward + a.heldCoins : 0, bonusReward: a ? a.reward : 0,
      heldCoins: a ? a.heldCoins : 0, index: s.orderIndex, number: s.orderIndex + 1,
      progress: a ? a.progress : 0, stageProgress: a ? a.progress : 0, ready: !!a && a.ready,
      isLoop: false, completed: false, awaitingSelection: !a, requirements: a ? a.requirements : [] };
  };
  Game.prototype._claimOrder = function (multiplier, frozenBonus = 0) {
    if (!featureAccess(this.state).orders) return fail('guide-locked');
    if (this.state.orderIndex < 6) {
      const guide = normalizeOnboarding(this.state.onboarding, this.state);
      const result = old._claimOrder.call(this, multiplier, frozenBonus);
      this._autoQuests();
      if (result.ok) { this.state.onboarding = guide; this._recordOnboardingPractice('orderClaimed'); }
      return result;
    }
    const order = this._order(), f = this._ensureFactory();
    if (!order.ready || !f.active) return fail(order.completed ? 'campaign-complete' : 'order-not-ready');
    const coins = safe(order.reward * multiplier + frozenBonus);
    this._addCoins(coins); this.state.orderIndex++; f.completedContracts++;
    f.contractCounts[f.active.kind]++; f.active = null; f.serial++;
    for (const [id, q] of Object.entries(this.state.pendingRewards)) if (q.kind === 'order') delete this.state.pendingRewards[id];
    this._event('order', { index: order.index, name: order.name, coins, multiplier: coins / Math.max(1, order.reward), isLoop: false });
    if (this.state.orderIndex === 20) { this.state.completedAt = this.state.playedSeconds; this._event('complete', { seconds: this.state.playedSeconds }); }
    this._autoQuests(); return { ok: true, coins, order, multiplier: coins / Math.max(1, order.reward) };
  };
  Game.prototype._goal = function (next, order) {
    if (order.completed) return { title: '工厂竣工', text: '全部20单完成，收藏奖励已开放。', action: 'souvenirs' };
    if (next && this.state.orderIndex >= next.requiredOrders && !this._ensureFactory().active) return old._goal.call(this, next, order);
    if (this.state.orderIndex >= 6 && order.awaitingSelection && this.state.machine >= 2)
      return { title: '选择下一张合同', text: '选择客户，交付合同并收集永久设备。', action: 'order' };
    if (this.state.orderIndex >= 6 && !order.awaitingSelection)
      return { title: order.ready ? '合同可以交付了' : order.name, text: order.ready ? `结算 ${formatNumber(order.reward)} 金币。` : order.requirements.map(r => `${r.label} ${formatNumber(r.current)}/${formatNumber(r.target)}${r.unit}`).join(' · '), action: 'order' };
    return old._goal.call(this, next, order);
  };
  // Previously earned multipliers remain in _production; their old acquisition
  // routes are retired, and their view shapes remain compatible with old clients.
  Game.prototype._deliveries = function () { return { unlocked: false, orderIndex: this.state.orderIndex, stages: [], readyCount: 0 }; };
  Game.prototype._commissions = function () { return { unlocked: false, available: false, remaining: 0, options: [], active: null }; };
  Game.prototype._research = function () { return { unlocked: false, totalLevels: Object.values(this.state.research.levels).reduce((a, b) => a + b, 0), maxLevels: 24, complete: true, options: [], active: null }; };
  for (const action of ['claimDelivery', 'acceptCommission', 'claimCommission', 'startResearch', 'claimResearch', 'buyRefinement'])
    Game.prototype[action] = function () { return fail('route-retired'); };
  Game.prototype.setProductionMode = function () { return fail('route-retired'); };
  Game.prototype._heatRecoveryUnlocked = function () { return false; };
  Game.prototype._rewardOffer = function (kind) {
    const offer = old._rewardOffer.call(this, kind);
    if (offer && offer.available && !featureAccess(this.state).rewards) return { ...offer, available: false, reason: 'guide-locked' };
    if (offer && kind === 'order' && this.state.orderIndex >= 20) return { ...offer, available: false, reason: 'campaign-complete' };
    if (offer && kind === 'offline' && this.state.offline) return { ...offer, amount: this._offlineProjection(this.state.offline).cashCoins,
      description: '离线现款翻倍；合同货款在交付时单独结算' };
    return offer;
  };
  for (const action of ['buyUpgrade', 'buyUpgradeBatch', 'evolve', 'buySouvenir']) {
    Game.prototype[action] = function (...args) {
      const purchase = action === 'buyUpgrade' || action === 'buyUpgradeBatch', key = args[0];
      if (purchase) {
        const feature = ['tap', 'auto', 'value'].includes(args[0]) && { tap: 'tapUpgrade', auto: 'autoUpgrade', value: 'valueUpgrade' }[args[0]];
        if (feature && !featureAccess(this.state)[feature]) return fail('guide-locked');
      }
      const first = purchase && ['tap', 'auto', 'value'].includes(key) && this.state.upgrades[key] === 0;
      const guide = first ? normalizeOnboarding(this.state.onboarding, this.state) : null;
      const field = { tap: 'tap', auto: 'baseIncome', value: 'price' }[key];
      const before = first ? this._production()[field] : 0;
      const result = old[action].apply(this, args);
      if (result.ok) {
        this._autoQuests();
        if (first) {
          this.state.onboarding = guide;
          guide.baselines[key] = { before, after: this._production()[field], taps: this.state.taps,
            playedSeconds: this.state.playedSeconds, totalProduced: this.state.totalProduced, totalCoins: this.state.totalCoins };
          if (key === 'auto') { guide.baselines.auto.observedAt = this.state.playedSeconds; guide.autoObservationSeconds = 0; }
        }
      }
      return result;
    };
  }
  Game.prototype._recordOnboardingPractice = function (id) {
    if (this.state.onboarding.legacy) return false;
    const practice = this.state.onboarding.practice;
    if (practice[id]) return false;
    practice[id] = true;
    this._event('onboardingPractice', { id });
    return true;
  };
  Game.prototype.acknowledgeGuide = function (id) {
    const lesson = selectOnboarding(this.getView()).lessons.find(lesson => lesson.id === id);
    if (!lesson) return fail('stale-guide');
    this.state.onboarding = normalizeOnboarding(this.state.onboarding, this.state);
    if (!this.state.onboarding.seen.includes(id)) { this.state.onboarding.seen.push(id); this._event('guide', { id }); }
    return { ok: true, id };
  };
  Game.prototype.setOnboardingSkipped = function (skipped) {
    if (typeof skipped !== 'boolean') return fail('invalid-onboarding-setting');
    this.state.onboarding = normalizeOnboarding(this.state.onboarding, this.state);
    this.state.onboarding.skipped = skipped;
    this.state.onboarding.autoObservationSeconds = 0;
    if (this.state.onboarding.baselines.auto) this.state.onboarding.baselines.auto.observedAt = this.state.playedSeconds;
    return { ok: true, skipped };
  };
  Game.prototype.observeOnboarding = function (seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return fail('invalid-time');
    const selected = this.getView().onboarding;
    if (!selected.goal || selected.goal.phase !== 'observe') return fail('observation-not-active');
    const guide = normalizeOnboarding(this.state.onboarding, this.state), baseline = guide.baselines.auto;
    if (!baseline || this.state.totalProduced <= baseline.totalProduced) return fail('no-observed-production');
    const elapsed = Math.min(seconds, Math.max(0, this.state.playedSeconds - baseline.observedAt));
    if (elapsed <= 0) return fail('no-observed-production');
    this.state.onboarding = guide;
    baseline.observedAt = this.state.playedSeconds;
    guide.autoObservationSeconds = Math.min(3, guide.autoObservationSeconds + elapsed);
    if (guide.autoObservationSeconds >= 3 - 1e-9) { guide.autoObservationSeconds = 3; this._recordOnboardingPractice('autoObserved'); }
    return { ok: true, seconds: guide.autoObservationSeconds, completed: guide.practice.autoObserved };
  };
  Game.prototype._souvenirs = function () {
    const result = old._souvenirs.call(this), costs = { sign: 5000000000, cup: 20000000000, starlight: 50000000000 };
    result.options = result.options.map(item => {
      const cost = costs[item.key], reason = item.owned ? 'already-owned' : !result.unlocked ? 'souvenir-locked'
        : Object.keys(this.state.pendingRewards).length ? 'busy' : this.state.coins < cost ? 'not-enough-coins' : '';
      return { ...item, description: '完成全部20张订单后，用经营积累收藏竣工纪念品', cost, requiredLoops: 0, reason, canBuy: !reason };
    });
    return result;
  };
  Game.prototype._restore = function (input) {
    let data; try { data = typeof input === 'string' ? JSON.parse(input) : copy(input); } catch (_) { return old._restore.call(this, input); }
    if (!data || data.version !== CONFIG.version) return old._restore.call(this, input);
    const actualProduced = safe(data.totalProduced), index = Math.min(20, Math.floor(safe(data.orderIndex))), savedFactory = data.factory;
    // Contract production is local to each order: old cumulative gates must not
    // roll back earned orders or machines when loading a contract-era save.
    if (savedFactory && [2, 3].includes(savedFactory.version) && index > 0) data.totalProduced = Math.max(actualProduced, CONFIG.orders[index - 1].target);
    old._restore.call(this, data); this.state.totalProduced = actualProduced;
    const f = this._ensureFactory(); this.state.productionMode = 'balanced';
    if (savedFactory && [2, 3].includes(savedFactory.version)) {
      const priorOwned = savedFactory.version === 3 ? savedFactory.owned : savedFactory.equipped;
      f.owned = [...new Set((Array.isArray(priorOwned) ? priorOwned : []).filter(id => MODULES.some(m => m.id === id)
        && (savedFactory.version === 3 || ['pressure', 'coating', 'packer'].includes(id))))];
      if (savedFactory.version === 2 && this.state.machine >= 2) {
        const legacy = !data.onboarding || data.onboarding.legacy === true;
        if (legacy || index >= 7 || savedFactory.active && ['gift', 'festival'].includes(savedFactory.active.kind)) f.owned.push('coating', 'packer');
        if (legacy || index >= 8) f.owned.push('pressure');
        f.owned = [...new Set(f.owned)];
        this.loadWarning = '设备已升级为永久收藏，已开放设备全部生效；原合同与储压锅已保留。';
      }
      f.pressureMode = savedFactory.version === 3 && savedFactory.pressureMode === 'hold' ? 'hold' : 'auto';
      f.serial = Math.floor(safe(savedFactory.serial, 1e12)); f.tapsThisPot = Math.floor(safe(savedFactory.tapsThisPot, 3));
      f.tapCooldown = safe(savedFactory.tapCooldown, 1); f.completedContracts = Math.max(0, this.state.orderIndex - 6);
      let remaining = f.completedContracts;
      for (const kind of KINDS) { const n = Math.floor(safe(savedFactory.contractCounts && savedFactory.contractCounts[kind], remaining)); f.contractCounts[kind] = n; remaining -= n; }
      this._syncEquipment(true);
      if (savedFactory.storedBurst && this._hasModule('pressure')) { const p = this._production(); f.storedBurst = { amount: safe(savedFactory.storedBurst.amount, (p.tap * 24 + p.baseAuto * 8) * 1.25) }; }
      const a = savedFactory.active;
      if (a && KINDS.includes(a.kind) && a.orderIndex === this.state.orderIndex && index >= 6 && index < 20
        && typeof a.id === 'string' && new RegExp(`^contract:${index}:\\d+:${a.kind}$`).test(a.id)) {
        let basis, b = [];
        try { b = JSON.parse(a.basis); if (!Array.isArray(b)) throw new Error('invalid basis'); basis = this._canonicalFactoryBasis({ machine: b[0], upgrades: b[1], brandLevel: b[2], refinements: b[3], researchLevels: b[4] }, index); } catch (_) { b = []; basis = this._commissionBasis(); }
        const modules = Array.isArray(b[5]) ? b[5] : [], modern = b[6] && b[6].version === 3;
        // Rebuild the accepted price/distribution from its snapshot, including
        // pre-collection contracts. Newly acquired quality never reprices work.
        const terms = modern ? { allocation: .6, packingBonus: modules.includes('packer') ? .15 : 0, qualityBonus: modules.includes('inspector') ? .05 : 0 }
          : { allocation: modules.includes('packer') ? .75 : .6, packingBonus: 0, qualityBonus: 0 };
        const option = this._contractOption(a.kind, basis, terms), quantity = safe(a.quantity, option.quantityTarget);
        const restoredSnapshot = JSON.stringify([basis.machine, basis.upgrades, basis.brandLevel, basis.refinements, basis.researchLevels, modules,
          ...(modern ? [{ version: 3, ...terms }] : [])]);
        f.active = { ...option, basis: restoredSnapshot, id: a.id, orderIndex: index,
          quantity, coated: safe(a.coated, quantity), batches: Math.floor(safe(a.batches, 3)),
          heldCoins: safe(a.heldCoins, quantity * this._production().price * (1 + 1e-12)) };
      }
    } else {
      if (this.state.machine >= 2) f.owned = ['coating', 'packer', 'pressure'];
      // Old work paid no entry cost. Ready work is settled once; unfinished work
      // closes while all already earned levels and coins remain untouched.
      const r = this.state.research.active;
      if (r && r.production >= r.productionTarget) this.state.research.levels[r.key] = Math.max(this.state.research.levels[r.key], r.level);
      const c = this.state.commissions.active;
      if (c && (c.kind === 'bulk' ? c.production >= c.productionTarget : c.perfect >= c.perfectTarget && c.recovery >= c.recoveryTarget)) this._addCoins(c.reward);
      if (index >= 6) this.loadWarning = '工厂已升级为合同经营；已有金币、机器、订单和永久能力均已保留。';
    }
    this.state.research.active = null; this.state.commissions.active = null;
    if (index >= 6 && !f.active) for (const [id, q] of Object.entries(this.state.pendingRewards)) if (q.kind === 'order') delete this.state.pendingRewards[id];
    if (this.state.offline) {
      const prior = data.offline, priorProduction = prior ? safe(prior.production) : 0, priorCoins = prior ? safe(prior.coins) : 0;
      const segments = [];
      let remainingProduction = priorProduction, remainingCoins = priorCoins, remainingSeconds = prior ? safe(prior.seconds, CONFIG.offlineMaxSeconds) : 0;
      if (prior && Array.isArray(prior.factorySegments)) for (const segment of prior.factorySegments.slice(0, 32)) {
        if (!segment || typeof segment !== 'object') continue;
        const production = safe(segment.production, remainingProduction), coins = safe(segment.coins, remainingCoins), seconds = safe(segment.seconds, remainingSeconds);
        segments.push({ production, coins, seconds, contractId: typeof segment.contractId === 'string' && /^contract:\d+:\d+:(cinema|gift|festival)$/.test(segment.contractId) ? segment.contractId : null,
          coatingCapacity: safe(segment.coatingCapacity, production * .5) });
        remainingProduction -= production; remainingCoins -= coins; remainingSeconds -= seconds;
      }
      if (remainingProduction > 0 || remainingCoins > 0) segments.push({ production: remainingProduction, coins: remainingCoins, seconds: remainingSeconds, contractId: null, coatingCapacity: 0 });
      const production = Math.max(0, this.state.offline.production - priorProduction), coins = Math.max(0, this.state.offline.coins - priorCoins);
      if (production > 0) segments.push({ production, coins, seconds: Math.max(0, this.state.offline.seconds - (prior ? safe(prior.seconds) : 0)),
        contractId: f.active ? f.active.id : null, coatingCapacity: production * (this._hasModule('coating') ? .5 : .2) });
      this.state.offline.factorySegments = segments;
    }
    // A persisted ad request is not authority for its payout. The offline bonus
    // is exactly the cash portion of the frozen parcel; contract goods are held
    // for later delivery and must never become a forged extra ad bonus.
    for (const [id, request] of Object.entries(this.state.pendingRewards)) {
      if (request.kind !== 'offline') continue;
      const parcel = this.state.offline;
      const cash = parcel ? this._offlineProjection(parcel).cashCoins : 0;
      if (!parcel || request.offlineId !== parcel.id || !Number.isFinite(request.amount)
        || Math.abs(request.amount - cash) > Math.max(1e-7, cash * 1e-10)) delete this.state.pendingRewards[id];
      else request.amount = cash;
    }
    // Souvenirs no longer need obsolete repeat orders.
    if (index === 20 && this.state.machine === 5 && Array.isArray(data.souvenirs)) this.state.souvenirs = [...new Set(data.souvenirs.filter(id => ['sign', 'cup', 'starlight'].includes(id)))];
    this._autoQuests();
    this.state.onboarding = normalizeOnboarding(data.onboarding, this.state);
  };
  Game.prototype._claimOffline = function () {
    const offline = this.state.offline;
    if (!offline) return fail('no-offline-reward');
    const segments = offline.factorySegments || [{ production: offline.production, coins: offline.coins, contractId: null, coatingCapacity: 0 }];
    let coins = 0, heldProduction = 0, production = 0;
    for (const segment of segments) {
      const amount = safe(segment.production), price = amount ? safe(segment.coins) / amount : 0;
      const result = this._routeProduction(amount, price, 'offline', segment.contractId);
      if (!amount && segment.coins) { this._addCoins(safe(segment.coins)); result.coins += safe(segment.coins); }
      this._processCoating(segment.coatingCapacity, segment.contractId); coins += result.coins; heldProduction += result.heldProduction; production += result.amount;
    }
    this.state.offline = null;
    for (const [id, q] of Object.entries(this.state.pendingRewards)) if (q.kind === 'offline') delete this.state.pendingRewards[id];
    this._event('offline', { coins, amount: production, seconds: offline.seconds, heldProduction });
    this._autoQuests(); return { ok: true, coins, amount: production, seconds: offline.seconds, heldProduction };
  };
  Game.prototype._offlineProjection = function (offline) {
    const a = this._ensureFactory().active;
    let remaining = a ? Math.max(0, a.quantityTarget - a.quantity) : 0, contractProduction = 0, contractCoins = 0, contractCoated = 0, bonusProduction = 0, reservedBaseCoins = 0;
    for (const segment of offline.factorySegments || []) if (a && segment.contractId === a.id && !this._contractView().ready) {
      const input = Math.min(segment.production, remaining / (a.allocation + (a.packingBonus || 0)));
      const held = Math.min(remaining, input * a.allocation); remaining -= held;
      const bonus = Math.min(remaining, input * (a.packingBonus || 0)); remaining -= bonus;
      contractProduction += held + bonus; bonusProduction += bonus;
      const price = segment.production ? segment.coins / segment.production : 0;
      contractCoins += (held + bonus) * price; reservedBaseCoins += held * price;
      if (a.kind === 'gift') contractCoated += segment.coatingCapacity;
    }
    return { contractProduction, contractCoins, bonusProduction, production: safe(offline.production + bonusProduction),
      contractCoated: a ? Math.min(contractCoated, a.quantity + contractProduction - a.coated) : 0,
      cashCoins: Math.max(0, offline.coins - reservedBaseCoins) };
  };
  Game.prototype.getView = function () {
    const f = this._ensureFactory(), view = old.getView.call(this), unlocked = this.state.machine >= 2;
    const modules = equipmentProgress(this.state);
    view.factory = { unlocked, owned: f.owned.slice(), equipped: f.owned.slice(), ownedCount: f.owned.length, totalModules: MODULES.length,
      collectionComplete: f.owned.length === MODULES.length, nextModule: modules.find(m => !m.owned) || null,
      canConfigure: false, reason: !unlocked ? 'factory-locked' : '', modules,
      pressureMode: f.pressureMode, canSetPressureMode: this._hasModule('pressure') && !Object.keys(this.state.pendingRewards).length,
      storedBurst: !!f.storedBurst, storedBurstAmount: f.storedBurst ? f.storedBurst.amount : 0, canRelease: !!f.storedBurst, storageCapacity: 1,
      autoPressureDispatch: this._hasModule('pressure') && f.pressureMode === 'auto',
      chargeProgress: this.state.energy / 100, tapReady: !unlocked || f.tapCooldown <= 0 && f.tapsThisPot < 3,
      tapsRemaining: unlocked ? Math.max(0, 3 - f.tapsThisPot) : 3, maxTapsPerPot: 3, tapCooldown: f.tapCooldown, passiveEnergy: this._passiveEnergy() };
    view.factory.packProgress = f.active ? Math.min(1, f.active.quantity / f.active.quantityTarget) : 0;
    view.factory.coatingProgress = f.active && f.active.kind === 'gift' ? Math.min(1, f.active.coated / f.active.quantityTarget) : 0;
    view.contracts = { unlocked: unlocked && this.state.orderIndex >= 6,
      options: this.state.orderIndex >= 6 && this.state.orderIndex < 20 ? KINDS.map(kind => this._contractOption(kind)) : [],
      active: this._contractView(), completed: this.state.orderIndex >= 20 };
    view.productionModes.unlocked = false; view.refinements = { unlocked: false, title: '已保留的永久工艺', options: [] };
    if (view.offline) {
      view.offline = { ...copy(view.offline), ...this._offlineProjection(view.offline) };
    }
    const features = featureAccess(this.state);
    for (const upgrade of view.upgrades) {
      upgrade.unlocked = features[{ tap: 'tapUpgrade', auto: 'autoUpgrade', value: 'valueUpgrade' }[upgrade.key]];
      upgrade.canBuy = upgrade.canBuy && upgrade.unlocked;
      if (!upgrade.unlocked && upgrade.bulk) upgrade.bulk.canBuy = false;
    }
    view.order.unlocked = features.orders;
    view.order.ready = view.order.ready && features.orders;
    for (const option of view.contracts.options) option.unlocked = option.kind === 'cinema' || features[option.kind];
    view.onboarding = selectOnboarding(view);
    // One current teaching objective; later saves use ordinary production goals.
    view.tutorial = view.onboarding.goal;
    return view;
  };
}

module.exports = { installFactoryGame, MODULES, KINDS };
