'use strict';
// Platform-independent simulation. Tick uses seconds; save timestamps use milliseconds.
const CONFIG = {
  version: 1, title: '小小爆米花厂', energyMax: 100, tapEnergy: 2, passiveEnergy: 1,
  maxUpgradeLevel: 24, autoLevelGrowth: 1.3, turboMultiplier: 3, turboDuration: 90,
  rewardUnlockSeconds: 90, rewardCooldownSeconds: 120,
  offlineMaxSeconds: 28800, offlineEfficiency: 0.5, offlineMinSeconds: 30,
  machines: [
    { id: 0, name: '手摇锅', description: '一把玉米，开启你的工厂梦', color: '#f3b35b', multiplier: 1, priceMultiplier: 1, cost: 0, requiredOrders: 0 },
    { id: 1, name: '电热锅', description: '恒温加热，香气开始飘满街', color: '#ed785d', multiplier: 2.4, priceMultiplier: 1.12, cost: 30000, requiredOrders: 3 },
    { id: 2, name: '双缸机', description: '双锅轮转，让每一份等待更短', color: '#66bfaa', multiplier: 5.5, priceMultiplier: 1.25, cost: 2000000, requiredOrders: 6 },
    { id: 3, name: '多头机', description: '六头齐开，爆米花像瀑布落下', color: '#6baacb', multiplier: 12, priceMultiplier: 1.4, cost: 160000000, requiredOrders: 10 },
    { id: 4, name: '自动流水线', description: '连续生产，整座工厂为你运转', color: '#9c86cf', multiplier: 26, priceMultiplier: 1.6, cost: 10000000000, requiredOrders: 14 },
    { id: 5, name: '巨型爆米花塔', description: '让金色爆米花，点亮整座城市', color: '#e5ad4d', multiplier: 60, priceMultiplier: 1.8, cost: 225000000000, requiredOrders: 18 }
  ],
  upgrades: {
    tap: { name: '爆裂玉米', description: '每次点击产量提升', baseCost: 16, growth: 2.1 },
    auto: { name: '自动火力', description: '持续自动生产并出售', baseCost: 24, growth: 2.1 },
    value: { name: '焦糖配方', description: '所有爆米花的售价提升', baseCost: 32, growth: 2.1 }
  },
  orders: [
    { name: '街角第一桶', target: 50, reward: 180 },
    { name: '放学后的香气', target: 200, reward: 600 },
    { name: '周末小摊', target: 800, reward: 2600 },
    { name: '社区电影夜', target: 2500, reward: 8800 },
    { name: '甜蜜下午茶', target: 7000, reward: 32000 },
    { name: '校园运动会', target: 20000, reward: 120000 },
    { name: '双倍快乐', target: 60000, reward: 480000 },
    { name: '公园嘉年华', target: 150000, reward: 1440000 },
    { name: '满座电影院', target: 350000, reward: 4400000 },
    { name: '全城首映礼', target: 800000, reward: 12800000 },
    { name: '星光音乐节', target: 7200000, reward: 40000000 },
    { name: '金色美食街', target: 16000000, reward: 112000000 },
    { name: '跨城快递', target: 32000000, reward: 288000000 },
    { name: '连锁店开张', target: 64000000, reward: 720000000 },
    { name: '超级体育场', target: 120000000, reward: 1800000000 },
    { name: '海滨烟花夜', target: 220000000, reward: 4400000000 },
    { name: '全国巡游', target: 400000000, reward: 10400000000 },
    { name: '城市庆典', target: 720000000, reward: 24000000000 },
    { name: '云端甜品节', target: 1200000000, reward: 52000000000 },
    { name: '世界爆米花日', target: 2000000000, reward: 100000000000 }
  ]
};
const MAX_NUMBER = 1e150;
const KEYS = ['tap', 'auto', 'value'];
const REWARDS = ['turbo', 'order', 'sponsor', 'offline'];
const finite = (n, fallback = 0, max = MAX_NUMBER) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : fallback;
const integer = (n, fallback = 0, max = MAX_NUMBER) => Math.floor(finite(n, fallback, max));
const clone = obj => JSON.parse(JSON.stringify(obj));
const fail = reason => ({ ok: false, reason });
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function formatNumber(value) {
  const n = finite(value);
  const trim = x => x.replace(/\.0+$|0$/, '').replace(/\.$/, '');
  if (n < 10000) return Math.floor(n).toLocaleString('zh-CN');
  if (n < 100000000) return trim((n / 10000).toFixed(n < 100000 ? 2 : 1)) + '万';
  if (n < 1e12) return trim((n / 1e8).toFixed(n < 1e9 ? 2 : 1)) + '亿';
  return trim((n / 1e12).toFixed(1)) + '万亿';
}
function freshState(now) {
  return {
    version: 1, savedAt: now, coins: 0, totalProduced: 0, totalCoins: 0,
    taps: 0, bursts: 0, machine: 0, upgrades: { tap: 0, auto: 0, value: 0 },
    orderIndex: 0, loopIndex: 0, energy: 0, boostSeconds: 0, playedSeconds: 0,
    settings: { sound: true, haptics: true }, offline: null, rewardSerial: 0,
    rewardedCount: 0, lastRewardAt: -CONFIG.rewardCooldownSeconds,
    pendingRewards: {}, claimedRewards: [], completedAt: null
  };
}
class Game {
  constructor({ save = null, now = Date.now() } = {}) {
    this.events = []; this.now = finite(now, Date.now()); this.state = freshState(this.now); this.loadWarning = null;
    if (save) this._restore(save);
  }
  _restore(input) {
    let save;
    try { save = typeof input === 'string' ? JSON.parse(input) : input; }
    catch (_) { this.loadWarning = '存档读取失败，已安全开始新工厂'; return; }
    if (!save || typeof save !== 'object' || Array.isArray(save) || save.version !== CONFIG.version) {
      this.loadWarning = '存档版本不兼容，已安全开始新工厂'; return;
    }
    const s = this.state;
    for (const key of ['coins', 'totalProduced', 'totalCoins', 'playedSeconds']) s[key] = finite(save[key]);
    for (const key of ['taps', 'bursts', 'loopIndex', 'rewardSerial', 'rewardedCount']) s[key] = integer(save[key]);
    s.totalCoins = Math.max(s.totalCoins, s.coins);
    s.machine = integer(save.machine, 0, 5); s.orderIndex = integer(save.orderIndex, 0, 20);
    while (s.orderIndex > 0 && CONFIG.orders[s.orderIndex - 1].target > s.totalProduced) s.orderIndex--;
    if (s.orderIndex < 20) s.loopIndex = 0;
    while (s.machine > 0 && CONFIG.machines[s.machine].requiredOrders > s.orderIndex) s.machine--;
    for (const key of KEYS) s.upgrades[key] = integer(save.upgrades && save.upgrades[key], 0, CONFIG.maxUpgradeLevel);
    s.energy = finite(save.energy, 0, CONFIG.energyMax - 1e-10);
    s.boostSeconds = finite(save.boostSeconds, 0, 86400);
    s.lastRewardAt = typeof save.lastRewardAt === 'number' && Number.isFinite(save.lastRewardAt)
      ? Math.min(s.playedSeconds, Math.max(-CONFIG.rewardCooldownSeconds, save.lastRewardAt)) : -CONFIG.rewardCooldownSeconds;
    for (const key of ['sound', 'haptics']) if (save.settings && typeof save.settings[key] === 'boolean') s.settings[key] = save.settings[key];
    s.claimedRewards = Array.isArray(save.claimedRewards) ? save.claimedRewards.filter(x => typeof x === 'string' && x.length < 100).slice(-128) : [];
    if (s.orderIndex === 20) s.completedAt = finite(save.completedAt, s.playedSeconds);
    if (save.offline && typeof save.offline.id === 'string') {
      const o = save.offline;
      s.offline = { id: o.id.slice(0, 100), seconds: finite(o.seconds, 0, CONFIG.offlineMaxSeconds), production: finite(o.production), coins: finite(o.coins) };
    }
    if (save.pendingRewards && typeof save.pendingRewards === 'object') {
      for (const [id, q] of Object.entries(save.pendingRewards).slice(-4)) {
        if (!q || typeof q !== 'object' || id !== q.id || !/^reward:\d+:\d+$/.test(id) || id.length > 100 || !REWARDS.includes(q.kind) || s.claimedRewards.includes(id)) continue;
        s.pendingRewards[id] = {
          id, kind: q.kind, title: String(q.title || '').slice(0, 100), description: String(q.description || '').slice(0, 100), amount: finite(q.amount),
          duration: finite(q.duration, 0, CONFIG.turboDuration), orderIndex: integer(q.orderIndex), loopIndex: integer(q.loopIndex),
          offlineId: typeof q.offlineId === 'string' ? q.offlineId.slice(0, 100) : null, machine: integer(q.machine, 0, 5), createdAt: finite(q.createdAt)
        };
      }
    }
    const savedAt = finite(save.savedAt, this.now);
    const elapsed = Math.max(0, (this.now - savedAt) / 1000);
    s.boostSeconds = Math.max(0, s.boostSeconds - elapsed);
    s.lastRewardAt = Math.max(-CONFIG.rewardCooldownSeconds, s.lastRewardAt - elapsed);
    if (elapsed >= CONFIG.offlineMinSeconds) {
      const seconds = Math.min(elapsed, CONFIG.offlineMaxSeconds - (s.offline ? s.offline.seconds : 0));
      if (seconds > 0) {
        const p = this._production(), prior = s.offline;
        const production = p.baseAuto * seconds * CONFIG.offlineEfficiency;
        s.offline = {
          id: 'offline:' + savedAt + ':' + Math.floor(this.now), seconds: seconds + (prior ? prior.seconds : 0),
          production: production + (prior ? prior.production : 0), coins: production * p.price + (prior ? prior.coins : 0)
        };
        for (const [id, q] of Object.entries(s.pendingRewards)) if (q.kind === 'offline') delete s.pendingRewards[id];
      }
    }
    s.savedAt = this.now;
  }
  _production() {
    const s = this.state, m = CONFIG.machines[s.machine];
    const tap = (1 + 0.8 * s.upgrades.tap) * Math.pow(1.2, s.upgrades.tap) * m.multiplier;
    const baseAuto = (0.4 + 0.7 * s.upgrades.auto) * Math.pow(CONFIG.autoLevelGrowth, s.upgrades.auto) * m.multiplier;
    const price = (1 + 0.2 * s.upgrades.value) * Math.pow(1.15, s.upgrades.value) * m.priceMultiplier;
    return { tap, auto: baseAuto * (s.boostSeconds > 0 ? 3 : 1), baseAuto, price, baseIncome: baseAuto * price, turboMultiplier: s.boostSeconds > 0 ? 3 : 1 };
  }
  _addCoins(coins) { this.state.coins = finite(this.state.coins + coins); this.state.totalCoins = finite(this.state.totalCoins + coins); }
  _produce(amount, source) {
    const n = finite(amount); if (!n) return;
    const coins = finite(n * this._production().price);
    this.state.totalProduced = finite(this.state.totalProduced + n); this._addCoins(coins);
    this._event('produce', { source, amount: n, coins });
  }
  _event(type, extra = {}) {
    if (this.events.length >= 160) this.events.shift();
    this.events.push({ type, ...extra });
  }
  _addEnergy(amount) {
    this.state.energy += amount;
    while (this.state.energy >= CONFIG.energyMax) {
      this.state.energy -= CONFIG.energyMax;
      const p = this._production(), production = p.tap * 24 + p.baseAuto * 8;
      this._produce(production, 'burst'); this.state.bursts++; this._event('burst', { amount: production });
    }
  }
  tick(dt) {
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return fail('invalid-time');
    dt = Math.min(dt, 60);
    const p = this._production(), boostedTime = Math.min(dt, this.state.boostSeconds);
    this._produce(p.baseAuto * (dt + boostedTime * 2), 'auto');
    this.state.boostSeconds = Math.max(0, this.state.boostSeconds - dt); this.state.playedSeconds += dt;
    this._addEnergy(dt * CONFIG.passiveEnergy); return { ok: true, seconds: dt };
  }
  tap() {
    const amount = this._production().tap;
    this.state.taps++; this._produce(amount, 'tap'); this._addEnergy(CONFIG.tapEnergy); return { ok: true, amount };
  }
  _upgradeCost(key) {
    const u = CONFIG.upgrades[key];
    return Math.ceil(u.baseCost * Math.pow(u.growth, this.state.upgrades[key]) * (1 + this.state.machine * 0.45));
  }
  buyUpgrade(key) {
    if (!KEYS.includes(key)) return fail('invalid-upgrade');
    if (this.state.upgrades[key] >= CONFIG.maxUpgradeLevel) return fail('max-level');
    const cost = this._upgradeCost(key); if (this.state.coins < cost) return fail('not-enough-coins');
    this.state.coins -= cost; this.state.upgrades[key]++;
    this._event('upgrade', { key, level: this.state.upgrades[key], cost }); return { ok: true, key, level: this.state.upgrades[key], cost };
  }
  evolve() {
    const next = CONFIG.machines[this.state.machine + 1]; if (!next) return fail('max-machine');
    if (this.state.orderIndex < next.requiredOrders) return fail('orders-required');
    if (this.state.coins < next.cost) return fail('not-enough-coins');
    this.state.coins -= next.cost; this.state.machine++;
    this._event('evolve', { machine: this.state.machine, name: next.name }); return { ok: true, machine: this.state.machine };
  }
  _order() {
    const s = this.state, isLoop = s.orderIndex >= 20;
    const order = isLoop ? {
      name: ['城市返场订单', '全球甜蜜补货', '金色派对专供', '爆米花王国'][s.loopIndex % 4] + ' · ' + (s.loopIndex + 1),
      target: finite(CONFIG.orders[19].target * Math.pow(1.35, Math.min(s.loopIndex + 1, 1000))),
      reward: finite(CONFIG.orders[19].reward * Math.pow(1.3, Math.min(s.loopIndex, 1000)))
    } : CONFIG.orders[s.orderIndex];
    const previousTarget = isLoop ? finite(CONFIG.orders[19].target * Math.pow(1.35, Math.min(s.loopIndex, 1000))) : (s.orderIndex > 0 ? CONFIG.orders[s.orderIndex - 1].target : 0);
    return {
      ...order, index: isLoop ? 20 + s.loopIndex : s.orderIndex, number: isLoop ? s.loopIndex + 1 : s.orderIndex + 1,
      progress: Math.min(1, s.totalProduced / order.target), stageProgress: Math.max(0, Math.min(1, (s.totalProduced - previousTarget) / Math.max(1, order.target - previousTarget))),
      ready: s.totalProduced >= order.target, isLoop
    };
  }
  claimOrder() { return this._claimOrder(1); }
  _claimOrder(multiplier, frozenBonus = 0) {
    const order = this._order(); if (!order.ready) return fail('order-not-ready');
    const coins = finite(order.reward * multiplier + frozenBonus); this._addCoins(coins);
    multiplier = coins / order.reward;
    if (order.isLoop) this.state.loopIndex++; else this.state.orderIndex++;
    for (const [id, q] of Object.entries(this.state.pendingRewards)) if (q.kind === 'order') delete this.state.pendingRewards[id];
    this._event('order', { index: order.index, name: order.name, coins, multiplier, isLoop: order.isLoop });
    if (this.state.orderIndex === 20 && !order.isLoop) { this.state.completedAt = this.state.playedSeconds; this._event('complete', { seconds: this.state.playedSeconds }); }
    return { ok: true, coins, order, multiplier };
  }
  _rewardOffer(kind) {
    const s = this.state; if (!REWARDS.includes(kind)) return null;
    const p = this._production(), next = CONFIG.machines[s.machine + 1], order = this._order();
    let amount = 0, title = '', description = '', reason = '';
    if (kind === 'turbo') {
      amount = CONFIG.turboDuration; title = '涡轮增压'; description = '自动生产 3 倍 · 90 秒';
    } else if (kind === 'order') {
      amount = order.reward * 2; title = '订单加价'; description = '额外 +' + formatNumber(amount) + ' 金币 · 总奖励 3 倍';
      if (!order.ready) reason = 'order-not-ready';
    } else if (kind === 'sponsor') {
      amount = next ? Math.floor(Math.min(p.baseIncome * 120, next.cost * 0.6)) : 0;
      title = '设备赞助'; description = '获得 ' + formatNumber(amount) + ' 金币';
      if (!next) reason = 'max-machine';
      else if (s.coins >= next.cost) reason = 'already-affordable';
      else if (s.orderIndex < next.requiredOrders) reason = 'orders-required';
      else if (amount < 1) reason = 'production-required';
    } else {
      amount = s.offline ? s.offline.coins : 0; title = '离线翻倍'; description = '额外 +' + formatNumber(amount) + ' 金币';
      if (!s.offline) reason = 'no-offline-reward';
    }
    if (!reason && s.playedSeconds < CONFIG.rewardUnlockSeconds) reason = 'intro-first';
    const cooldown = Math.max(0, CONFIG.rewardCooldownSeconds - (s.playedSeconds - s.lastRewardAt));
    if (!reason && cooldown > 0) reason = 'reward-cooldown';
    return { kind, title, description, amount, duration: kind === 'turbo' ? 90 : undefined, available: !reason, reason, cooldown };
  }
  quoteReward(kind) {
    const offer = this._rewardOffer(kind); if (!offer || !offer.available) return null;
    const s = this.state, existing = Object.values(s.pendingRewards)[0];
    if (existing) return existing.kind === kind ? clone(existing) : null;
    s.rewardSerial++;
    const id = 'reward:' + s.rewardSerial + ':' + Math.floor(s.playedSeconds * 1000);
    const quote = { id, kind, title: offer.title, description: offer.description, amount: offer.amount, duration: offer.duration || 0,
      orderIndex: s.orderIndex, loopIndex: s.loopIndex, offlineId: s.offline ? s.offline.id : null, machine: s.machine, createdAt: s.playedSeconds };
    s.pendingRewards[id] = quote; return clone(quote);
  }
  cancelReward(id) {
    if (!has(this.state.pendingRewards, id)) return fail('unknown-reward');
    delete this.state.pendingRewards[id]; return { ok: true };
  }
  applyReward(id) {
    const s = this.state;
    if (s.claimedRewards.includes(id)) return fail('already-claimed');
    if (!has(s.pendingRewards, id)) return fail('unknown-reward');
    const q = s.pendingRewards[id];
    if (q.kind === 'order' && (q.orderIndex !== s.orderIndex || q.loopIndex !== s.loopIndex || !this._order().ready)) { delete s.pendingRewards[id]; return fail('stale-order'); }
    if (q.kind === 'offline' && (!s.offline || q.offlineId !== s.offline.id)) { delete s.pendingRewards[id]; return fail('stale-offline'); }
    delete s.pendingRewards[id]; s.claimedRewards.push(id); s.claimedRewards = s.claimedRewards.slice(-128);
    s.lastRewardAt = s.playedSeconds; s.rewardedCount++;
    let coins = 0;
    if (q.kind === 'turbo') s.boostSeconds = Math.min(86400, s.boostSeconds + q.duration);
    else if (q.kind === 'order') { const result = this._claimOrder(1, q.amount); coins = result.coins; }
    else if (q.kind === 'sponsor') { this._addCoins(q.amount); coins = q.amount; }
    else if (q.kind === 'offline') { const result = this._claimOffline(); this._addCoins(q.amount); coins = result.coins + q.amount; }
    this._event('reward', { kind: q.kind, amount: q.amount, coins, id }); return { ok: true, kind: q.kind, amount: q.amount, coins, duration: q.duration };
  }
  claimOffline() { return this._claimOffline(); }
  _claimOffline() {
    const offline = this.state.offline; if (!offline) return fail('no-offline-reward');
    this.state.offline = null; this.state.totalProduced = finite(this.state.totalProduced + offline.production); this._addCoins(offline.coins);
    for (const [id, q] of Object.entries(this.state.pendingRewards)) if (q.kind === 'offline') delete this.state.pendingRewards[id];
    this._event('offline', { coins: offline.coins, amount: offline.production, seconds: offline.seconds }); return { ok: true, coins: offline.coins, amount: offline.production, seconds: offline.seconds };
  }
  setSetting(key, value) {
    if (!['sound', 'haptics'].includes(key) || typeof value !== 'boolean') return fail('invalid-setting');
    this.state.settings[key] = value; return { ok: true };
  }
  _tutorial() {
    const s = this.state;
    if (s.taps < 5) return { step: 0, title: '轻点机器，开始爆香', text: '点一下就生产并出售一份爆米花。先试试点 5 下！', action: 'tap' };
    if (s.upgrades.tap < 1) return { step: 1, title: '让每次点击更有分量', text: '在下方升级「爆裂玉米」，每点一下都能生产更多。', action: 'upgrade-tap' };
    if (s.upgrades.auto < 1) return { step: 2, title: '请一团火焰帮你工作', text: '升级「自动火力」，松开手也能持续生产、自动赚金币。', action: 'upgrade-auto' };
    if (s.bursts < 1) return { step: 3, title: '爆锅倒计时', text: '继续点击积攒能量，满格会免费触发爆米花大喷发！', action: 'tap' };
    if (s.orderIndex < 1) return { step: 4, title: '签收你的第一笔订单', text: '累计产量已经达标。领取订单，拿到额外金币奖励。', action: 'order' };
    return null;
  }
  getView() {
    const s = this.state, next = CONFIG.machines[s.machine + 1] || null;
    return {
      state: s, machine: CONFIG.machines[s.machine], nextMachine: next,
      upgrades: KEYS.map(key => ({ key, name: CONFIG.upgrades[key].name, description: CONFIG.upgrades[key].description,
        level: s.upgrades[key], maxLevel: CONFIG.maxUpgradeLevel, cost: this._upgradeCost(key), canBuy: s.upgrades[key] < CONFIG.maxUpgradeLevel && s.coins >= this._upgradeCost(key) })),
      production: this._production(), order: this._order(), energy: s.energy, energyMax: 100, boostSeconds: s.boostSeconds, tutorial: this._tutorial(),
      canEvolve: !!next && s.orderIndex >= next.requiredOrders && s.coins >= next.cost,
      evolveReason: !next ? 'max-machine' : s.orderIndex < next.requiredOrders ? 'orders-required' : s.coins < next.cost ? 'not-enough-coins' : '',
      completed: s.orderIndex >= 20, offline: s.offline, loadWarning: this.loadWarning,
      rewards: Object.fromEntries(REWARDS.map(kind => [kind, this._rewardOffer(kind)])),
      stats: { totalProduced: s.totalProduced, totalCoins: s.totalCoins, playedSeconds: s.playedSeconds, taps: s.taps, bursts: s.bursts,
        orders: s.orderIndex, loopOrders: s.loopIndex, rewardedCount: s.rewardedCount, completedAt: s.completedAt }
    };
  }
  drainEvents() { const result = this.events; this.events = []; return result; }
  exportSave(now = Date.now()) { this.state.savedAt = finite(now, this.now); return clone(this.state); }
}
module.exports = { CONFIG, Game, formatNumber };

