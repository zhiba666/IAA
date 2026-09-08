'use strict';
// Platform-independent simulation. Tick uses seconds; save timestamps use milliseconds.
const CONFIG = {
  version: 1, title: '小小爆米花厂', energyMax: 100, tapEnergy: 2, passiveEnergy: 1,
  maxUpgradeLevel: 24, autoLevelGrowth: 1.3, turboMultiplier: 3, turboDuration: 90,
  timingAttemptEnergy: 80, timingWindowStart: 92, timingWindowEnd: 98, timingBonusPercent: 20,
  heatRecoveryUnlockMachine: 3, heatRecoveryUpgradeLevel: 16, heatRecoveryMaxTaps: 10, heatRecoveryEnergyPerTap: 1,
  bulkUpgradeUnlockMachine: 3, bulkUpgradeMaxCount: 5,
  rewardUnlockSeconds: 90, rewardCooldownSeconds: 0,
  brandMaxLevel: 10, brandBonusPerLevel: 0.2, brandLevelsPerMachine: 2,
  offlineMaxSeconds: 28800, offlineEfficiency: 0.5, offlineMinSeconds: 30,
  productionModeUnlockMachine: 2,
  productionModes: [
    { id: 'balanced', name: '常规档', description: '均衡生产，保持常规产量与售价', productionMultiplier: 1, priceMultiplier: 1 },
    { id: 'rush', name: '赶单档', description: '产量 +20%，售价 -20%；适合赶订单', productionMultiplier: 1.2, priceMultiplier: 0.8 },
    { id: 'premium', name: '高价档', description: '产量 -20%，售价 +50%；适合攒换代金币', productionMultiplier: 0.8, priceMultiplier: 1.5 }
  ],
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
  refinements: {
    yield: { name: '连续爆香', description: '每级产量 ×1.2，点击、自动与爆锅同步提升', multiplier: 1.2, levels: [
      { requiredMachine: 4, requiredOrders: 14, cost: 1200000000 },
      { requiredMachine: 4, requiredOrders: 16, cost: 65000000000 },
      { requiredMachine: 5, requiredOrders: 18, cost: 150000000000 }
    ] },
    value: { name: '金装配方', description: '每级售价 ×1.2，生产出售与离线收益同步提升', multiplier: 1.2, levels: [
      { requiredMachine: 4, requiredOrders: 14, cost: 1000000000 },
      { requiredMachine: 4, requiredOrders: 16, cost: 30000000000 },
      { requiredMachine: 5, requiredOrders: 18, cost: 90000000000 }
    ] }
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
// One-time growth goals use lifetime counters, so older saves keep their progress.
const QUEST_CHAPTERS = [
  { id: 'start', title: '开工', subtitle: '亲手开锅，让第一桶香气飘出去', quests: [
    {"id":"start-taps","title":"亲手爆香","description":"累计点击生产 5 次","hint":"点机器或场景下方空地，每次点击都计入。","action":"tap","metric":"taps","target":5,"reward":8},
    {"id":"start-tap-upgrade","title":"好玉米，更饱满","description":"爆裂玉米达到 Lv.1","hint":"升级爆裂玉米，提高每次点击产量。","action":"upgrade:tap","metric":"upgrade","key":"tap","target":1,"reward":12},
    {"id":"start-auto-upgrade","title":"让火力接班","description":"自动火力达到 Lv.1","hint":"升级自动火力，松开手也能生产。","action":"upgrade:auto","metric":"upgrade","key":"auto","target":1,"reward":16},
    {"id":"start-order","title":"街角第一单","description":"装车完成 1 张主线订单","hint":"产量达标后，打开订单装车领奖。","action":"order","metric":"orderIndex","target":1,"reward":24}
  ] },
  { id: 'operate', title: '经营', subtitle: '学会配方、爆锅和持续生产', quests: [
    {"id":"operate-value","title":"加一点焦糖","description":"焦糖配方达到 Lv.1","hint":"升级焦糖配方，提高每份售价。","action":"upgrade:value","metric":"upgrade","key":"value","target":1,"reward":40},
    {"id":"operate-burst","title":"免费大喷发","description":"累计触发 1 次免费爆锅","hint":"点击和在线生产蓄能，满格自动爆锅。","action":"tap","metric":"bursts","target":1,"reward":60},
    {"id":"operate-auto","title":"稳稳开工","description":"自动火力达到 Lv.4","hint":"继续升级自动火力，提高持续收入。","action":"upgrade:auto","metric":"upgrade","key":"auto","target":4,"reward":120},
    {"id":"operate-orders","title":"小摊有口碑","description":"装车完成 3 张主线订单","hint":"订单不消耗累计产量，达标后逐单装车。","action":"order","metric":"orderIndex","target":3,"reward":300}
  ] },
  { id: 'expand', title: '扩张', subtitle: '用经营积累换来更好的设备', quests: [
    {"id":"expand-electric","title":"告别手摇锅","description":"换代至电热锅","hint":"完成 3 单并攒够 3万 金币后换代。","action":"machine","metric":"machine","target":1,"reward":1500},
    {"id":"expand-recipe","title":"招牌焦糖味","description":"焦糖配方达到 Lv.6","hint":"配方升级提高所有爆米花的售价。","action":"upgrade:value","metric":"upgrade","key":"value","target":6,"reward":800},
    {"id":"expand-orders","title":"接住大订单","description":"装车完成 6 张主线订单","hint":"持续生产并装车，备齐双缸机订单条件。","action":"order","metric":"orderIndex","target":6,"reward":4000},
    {"id":"expand-twin","title":"双锅齐开","description":"换代至双缸机","hint":"完成 6 单并攒够 200万 金币后换代。","action":"machine","metric":"machine","target":2,"reward":80000}
  ] },
  { id: 'finish', title: '竣工', subtitle: '从街角小摊到城市里的金色地标', quests: [
    {"id":"finish-multi","title":"六头齐开","description":"换代至多头机","hint":"继续升级与装车，达标后开动多头机。","action":"machine","metric":"machine","target":3,"reward":4000000},
    {"id":"finish-line","title":"整厂联动","description":"换代至自动流水线","hint":"完成 14 单，攒够换代金币开动流水线。","action":"machine","metric":"machine","target":4,"reward":200000000},
    {"id":"finish-tower","title":"点亮爆米花塔","description":"换代至巨型爆米花塔","hint":"完成 18 单，攒够换代金币建成爆米花塔。","action":"machine","metric":"machine","target":5,"reward":2000000000},
    {"id":"finish-orders","title":"把香甜送到世界","description":"装车完成全部 20 张主线订单","hint":"装车世界爆米花日订单，见证工厂竣工。","action":"order","metric":"orderIndex","target":20,"reward":2000000000}
  ] }
];
// Reward amounts and identifiers are definitions, never trusted fields from a save.
for (const chapter of QUEST_CHAPTERS) {
  chapter.quests.forEach(Object.freeze); Object.freeze(chapter.quests); Object.freeze(chapter);
}
Object.freeze(QUEST_CHAPTERS);
const QUEST_IDS = new Set(QUEST_CHAPTERS.flatMap(chapter => chapter.quests.map(quest => quest.id)));
const MAX_NUMBER = 1e150;
const NEVER_REWARDED_AT = -1e9;
const KEYS = ['tap', 'auto', 'value'];
const REFINEMENT_KEYS = ['yield', 'value'];
const COMMISSION_KINDS = ['bulk', 'artisan'];
const SOUVENIRS = [
  { key: 'sign', name: '城市招牌', description: '在工厂前立起金色招牌，纪念从街角到城市的旅程', cost: 150000000000, requiredLoops: 0 },
  { key: 'cup', name: '金色奖杯', description: '完成一次返场配送，把世界爆米花日的荣誉摆上展台', cost: 350000000000, requiredLoops: 1 },
  { key: 'starlight', name: '星光灯饰', description: '完成三次返场配送，让竣工的工厂亮起星光', cost: 800000000000, requiredLoops: 3 }
];
const REWARDS = ['turbo', 'order', 'sponsor', 'offline', 'brand'];
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
    taps: 0, bursts: 0, machine: 0, brandLevel: 0, productionMode: 'balanced', upgrades: { tap: 0, auto: 0, value: 0 },
    refinements: { yield: 0, value: 0 }, learning: { heatRecoveryDismissed: false, heatRecoveryUses: 0 },
    orderIndex: 0, loopIndex: 0, energy: 0, boostSeconds: 0, playedSeconds: 0, heatRecoveryTaps: 0,
    deliveries: { orderIndex: 0, claimed: [] }, commissions: { serial: 0, orderIndex: 0, claimed: 0, active: null }, souvenirs: [],
    settings: { sound: true, haptics: true }, offline: null, rewardSerial: 0,
    rewardedCount: 0, lastRewardAt: NEVER_REWARDED_AT,
    pendingRewards: {}, claimedRewards: [], claimedQuests: [], completedAt: null
  };
}
class Game {
  constructor({ save = null, now = Date.now() } = {}) {
    this.events = []; this.now = finite(now, Date.now()); this.state = freshState(this.now); this.loadWarning = null;
    // Timing belongs to this live pot only. It is deliberately absent from saves.
    this._timingAttempted = false; this._timingArmed = false;
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
    // A missing, invalid or locked mode preserves the original economy of older saves.
    s.productionMode = s.machine >= CONFIG.productionModeUnlockMachine && CONFIG.productionModes.some(mode => mode.id === save.productionMode)
      ? save.productionMode : 'balanced';
    // Restore permanent production before calculating any newly accrued offline income.
    s.brandLevel = integer(save.brandLevel, 0, this._brandCap());
    for (const key of KEYS) s.upgrades[key] = integer(save.upgrades && save.upgrades[key], 0, CONFIG.maxUpgradeLevel);
    for (const key of REFINEMENT_KEYS) s.refinements[key] = integer(save.refinements && save.refinements[key], 0, this._refinementCap(key));
    s.learning.heatRecoveryDismissed = !!(save.learning && save.learning.heatRecoveryDismissed === true);
    s.learning.heatRecoveryUses = integer(save.learning && save.learning.heatRecoveryUses, 0, CONFIG.heatRecoveryMaxTaps);
    // Earned residual heat survives a break; restoring an eligible factory grants none by itself.
    s.heatRecoveryTaps = this._heatRecoveryUnlocked() ? integer(save.heatRecoveryTaps, 0, CONFIG.heatRecoveryMaxTaps) : 0;
    s.energy = finite(save.energy, 0, CONFIG.energyMax - 1e-10);
    s.boostSeconds = finite(save.boostSeconds, 0, 86400);
    s.lastRewardAt = typeof save.lastRewardAt === 'number' && Number.isFinite(save.lastRewardAt)
      ? Math.min(s.playedSeconds, Math.max(NEVER_REWARDED_AT, save.lastRewardAt)) : NEVER_REWARDED_AT;
    for (const key of ['sound', 'haptics']) if (save.settings && typeof save.settings[key] === 'boolean') s.settings[key] = save.settings[key];
    s.claimedRewards = Array.isArray(save.claimedRewards) ? save.claimedRewards.filter(x => typeof x === 'string' && x.length < 100).slice(-128) : [];
    s.claimedQuests = Array.isArray(save.claimedQuests) ? [...new Set(save.claimedQuests.filter(id => typeof id === 'string' && QUEST_IDS.has(id)))] : [];
    if (s.orderIndex === 20) s.completedAt = finite(save.completedAt, s.playedSeconds);
    if (save.offline && typeof save.offline.id === 'string') {
      const o = save.offline;
      s.offline = { id: o.id.slice(0, 100), seconds: finite(o.seconds, 0, CONFIG.offlineMaxSeconds), production: finite(o.production), coins: finite(o.coins) };
    }
    this._restoreProgression(save);
    if (save.pendingRewards && typeof save.pendingRewards === 'object') {
      for (const [id, q] of Object.entries(save.pendingRewards).slice(-4)) {
        if (!q || typeof q !== 'object' || id !== q.id || !/^reward:\d+:\d+$/.test(id) || id.length > 100 || !REWARDS.includes(q.kind) || s.claimedRewards.includes(id)) continue;
        // A saved request is never proof of ad completion. Keep only a canonical,
        // still-current brand quote for the existing completion/cancellation flow.
        if (q.kind === 'brand' && (q.amount !== 1 || q.duration !== 0 || !Number.isInteger(q.brandLevel)
          || q.brandLevel !== s.brandLevel || q.brandLevel < 0 || q.brandLevel >= this._brandCap())) continue;
        s.pendingRewards[id] = {
          id, kind: q.kind, title: String(q.title || '').slice(0, 100), description: String(q.description || '').slice(0, 100), amount: finite(q.amount),
          duration: finite(q.duration, 0, CONFIG.turboDuration), orderIndex: integer(q.orderIndex), loopIndex: integer(q.loopIndex),
          offlineId: typeof q.offlineId === 'string' ? q.offlineId.slice(0, 100) : null, machine: integer(q.machine, 0, 5), createdAt: finite(q.createdAt),
          ...(q.kind === 'brand' ? { amount: 1, duration: 0, brandLevel: q.brandLevel } : {})
        };
      }
    }
    const savedAt = finite(save.savedAt, this.now);
    const elapsed = Math.max(0, (this.now - savedAt) / 1000);
    s.boostSeconds = Math.max(0, s.boostSeconds - elapsed);
    s.lastRewardAt = Math.max(NEVER_REWARDED_AT, s.lastRewardAt - elapsed);
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
  _heatRecoveryUnlocked() {
    return this.state.machine >= CONFIG.heatRecoveryUnlockMachine && this.state.upgrades.tap >= CONFIG.heatRecoveryUpgradeLevel;
  }
  _brandCap(machine = this.state.machine) { return Math.min(CONFIG.brandMaxLevel, machine * CONFIG.brandLevelsPerMachine); }
  _production({ machine = this.state.machine, upgrades = this.state.upgrades, boostSeconds = this.state.boostSeconds, brandLevel = this.state.brandLevel, productionMode = this.state.productionMode, refinements = this.state.refinements } = {}) {
    const m = CONFIG.machines[machine], brandMultiplier = 1 + brandLevel * CONFIG.brandBonusPerLevel;
    const mode = CONFIG.productionModes.find(option => option.id === productionMode) || CONFIG.productionModes[0];
    const yieldMultiplier = Math.pow(CONFIG.refinements.yield.multiplier, refinements.yield);
    const priceMultiplier = Math.pow(CONFIG.refinements.value.multiplier, refinements.value);
    const tap = (1 + 0.8 * upgrades.tap) * Math.pow(1.2, upgrades.tap) * m.multiplier * brandMultiplier * mode.productionMultiplier * yieldMultiplier;
    const baseAuto = (0.4 + 0.7 * upgrades.auto) * Math.pow(CONFIG.autoLevelGrowth, upgrades.auto) * m.multiplier * brandMultiplier * mode.productionMultiplier * yieldMultiplier;
    const price = (1 + 0.2 * upgrades.value) * Math.pow(1.15, upgrades.value) * m.priceMultiplier * mode.priceMultiplier * priceMultiplier;
    return { tap, auto: baseAuto * (boostSeconds > 0 ? 3 : 1), baseAuto, price, baseIncome: baseAuto * price, turboMultiplier: boostSeconds > 0 ? 3 : 1 };
  }
  setProductionMode(id) {
    if (!CONFIG.productionModes.some(mode => mode.id === id)) return fail('invalid-production-mode');
    if (this.state.machine < CONFIG.productionModeUnlockMachine) return fail('production-mode-locked');
    const from = this.state.productionMode;
    if (from === id) return { ok: true, productionMode: id, changed: false };
    // A pending rewarded offer keeps its quoted economy until completion or cancellation.
    if (Object.keys(this.state.pendingRewards).length > 0) return fail('busy');
    this.state.productionMode = id; this._event('productionMode', { from, to: id });
    return { ok: true, productionMode: id, changed: true };
  }
  _addCoins(coins) { this.state.coins = finite(this.state.coins + coins); this.state.totalCoins = finite(this.state.totalCoins + coins); }
  _produce(amount, source) {
    const n = finite(amount); if (!n) return;
    const coins = finite(n * this._production().price);
    this.state.totalProduced = finite(this.state.totalProduced + n); this._addCoins(coins);
    this._commissionProgress('production', n);
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
      const p = this._production(), baseProduction = p.tap * 24 + p.baseAuto * 8, perfect = this._timingArmed;
      const bonusAmount = perfect ? baseProduction * CONFIG.timingBonusPercent / 100 : 0;
      const production = baseProduction + bonusAmount;
      this._produce(production, 'burst'); this.state.bursts++;
      if (perfect) this._commissionProgress('perfect', 1);
      this._timingAttempted = false; this._timingArmed = false;
      const recoveryGranted = perfect && this._heatRecoveryUnlocked();
      if (recoveryGranted) this.state.heatRecoveryTaps = CONFIG.heatRecoveryMaxTaps;
      this._event('burst', { amount: production, coins: finite(production * p.price), perfect, bonusAmount,
        ...(recoveryGranted ? { heatRecoveryTaps: CONFIG.heatRecoveryMaxTaps } : {}) });
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
    const amount = this._production().tap, recoveryUsed = this._heatRecoveryUnlocked() && this.state.heatRecoveryTaps > 0;
    // Consume the previous pot's heat first: a perfect burst triggered by this tap grants all ten new uses.
    if (recoveryUsed) { this.state.heatRecoveryTaps--; this.state.learning.heatRecoveryUses = Math.min(CONFIG.heatRecoveryMaxTaps, this.state.learning.heatRecoveryUses + 1); this._commissionProgress('recovery', 1); }
    this.state.taps++; this._produce(amount, 'tap');
    this._addEnergy(CONFIG.tapEnergy + (recoveryUsed ? CONFIG.heatRecoveryEnergyPerTap : 0));
    return { ok: true, amount, recoveryUsed, heatRecoveryTaps: this.state.heatRecoveryTaps };
  }
  tryPerfectBurst() {
    const s = this.state;
    if (s.bursts < 1) return { ok: false, perfect: false, reason: 'timing-locked' };
    if (this._timingAttempted) return { ok: false, perfect: false, reason: 'timing-already-attempted' };
    if (s.energy < CONFIG.timingAttemptEnergy || s.energy >= CONFIG.energyMax) return { ok: false, perfect: false, reason: 'timing-not-ready' };
    this._timingAttempted = true;
    this._timingArmed = s.energy >= CONFIG.timingWindowStart && s.energy <= CONFIG.timingWindowEnd;
    this._event('timing', { perfect: this._timingArmed, energy: s.energy, bonusPercent: this._timingArmed ? CONFIG.timingBonusPercent : 0, burstNumber: s.bursts + 1 });
    return { ok: true, perfect: this._timingArmed, reason: this._timingArmed ? '' : 'timing-missed' };
  }
  _upgradeCost(key, level = this.state.upgrades[key]) {
    const u = CONFIG.upgrades[key];
    return Math.ceil(u.baseCost * Math.pow(u.growth, level) * (1 + this.state.machine * 0.45));
  }
  _bulkReservedCoins() {
    const next = CONFIG.machines[this.state.machine + 1];
    return next && this.state.coins >= next.cost ? next.cost : 0;
  }
  _bulkUpgradeQuote(key, before) {
    const s = this.state, fromLevel = s.upgrades[key], reservedCoins = this._bulkReservedCoins();
    let count = 0, cost = 0, reason = '';
    if (s.machine < CONFIG.bulkUpgradeUnlockMachine) reason = 'bulk-upgrade-locked';
    else if (fromLevel >= CONFIG.maxUpgradeLevel) reason = 'max-level';
    else if (Object.keys(s.pendingRewards).length) reason = 'busy';
    else {
      const availableCoins = Math.max(0, s.coins - reservedCoins);
      while (count < CONFIG.bulkUpgradeMaxCount && fromLevel + count < CONFIG.maxUpgradeLevel) {
        const nextCost = this._upgradeCost(key, fromLevel + count);
        if (cost + nextCost > availableCoins) break;
        cost += nextCost; count++;
      }
      if (!count) reason = reservedCoins > 0 ? 'machine-fund-reserved' : 'not-enough-coins';
    }
    return { count, cost, fromLevel, toLevel: fromLevel + count, canBuy: count > 0, reason, reservedCoins,
      preview: count > 0 ? this._upgradePreview(key, before, count) : null };
  }
  buyUpgradeBatch(key, quote) {
    if (!KEYS.includes(key)) return fail('invalid-upgrade');
    const s = this.state;
    if (s.machine < CONFIG.bulkUpgradeUnlockMachine) return fail('bulk-upgrade-locked');
    if (!quote || typeof quote !== 'object' || Array.isArray(quote) || !Number.isInteger(quote.count)
      || quote.count < 1 || quote.count > CONFIG.bulkUpgradeMaxCount || !Number.isInteger(quote.fromLevel)
      || quote.fromLevel < 0 || quote.fromLevel > CONFIG.maxUpgradeLevel || !Number.isInteger(quote.cost) || quote.cost <= 0) return fail('invalid-upgrade-batch');
    if (Object.keys(s.pendingRewards).length) return fail('busy');
    if (s.upgrades[key] !== quote.fromLevel) return fail('stale-upgrade');
    if (quote.fromLevel + quote.count > CONFIG.maxUpgradeLevel) return fail('max-level');
    let cost = 0;
    for (let i = 0; i < quote.count; i++) cost += this._upgradeCost(key, quote.fromLevel + i);
    if (cost !== quote.cost) return fail('stale-upgrade');
    if (s.coins < cost) return fail('not-enough-coins');
    if (cost > s.coins - this._bulkReservedCoins()) return fail('machine-fund-reserved');
    // Commit only the displayed count. New income must never silently add levels to a held click.
    s.coins -= cost; s.upgrades[key] += quote.count;
    const purchase = { key, fromLevel: quote.fromLevel, level: s.upgrades[key], count: quote.count, cost };
    this._event('upgradeBatch', purchase); return { ok: true, ...purchase };
  }
  buyUpgrade(key) {
    if (!KEYS.includes(key)) return fail('invalid-upgrade');
    if (this.state.upgrades[key] >= CONFIG.maxUpgradeLevel) return fail('max-level');
    const cost = this._upgradeCost(key); if (this.state.coins < cost) return fail('not-enough-coins');
    this.state.coins -= cost; this.state.upgrades[key]++;
    this._event('upgrade', { key, level: this.state.upgrades[key], cost }); return { ok: true, key, level: this.state.upgrades[key], cost };
  }
  _refinementCap(key) {
    return CONFIG.refinements[key].levels.filter(level => this.state.machine >= level.requiredMachine && this.state.orderIndex >= level.requiredOrders).length;
  }
  _refinementOption(key, before = this._production()) {
    const s = this.state, config = CONFIG.refinements[key], level = s.refinements[key], maxLevel = config.levels.length;
    const unlockedLevel = this._refinementCap(key), next = config.levels[level] || null;
    const cost = next ? next.cost : 0;
    const reason = !next ? 'max-level' : level >= unlockedLevel ? s.machine < 4 ? 'refinement-locked' : 'refinement-stage-locked' : Object.keys(s.pendingRewards).length ? 'busy' : s.coins < cost ? 'not-enough-coins' : '';
    const after = next ? this._production({ refinements: { ...s.refinements, [key]: level + 1 } }) : null;
    const [label, field, unit] = key === 'yield' ? ['自动产量', 'baseAuto', '份/秒'] : ['每份售价', 'price', '金币/份'];
    const future = config.levels[Math.max(level, unlockedLevel)] || null;
    const nextUnlockText = future ? `完成 ${future.requiredOrders} 单 · ${CONFIG.machines[future.requiredMachine].name}，开放 Lv.${Math.max(level, unlockedLevel) + 1}` : '全部工艺等级已开放';
    return { key, name: config.name, description: config.description, level, maxLevel, unlockedLevel, cost, canBuy: !reason, reason,
      preview: after ? { label, before: before[field], after: after[field], unit } : null,
      nextUnlockText: level === maxLevel ? '已完成全部工艺强化' : nextUnlockText };
  }
  buyRefinement(key, quote) {
    if (!REFINEMENT_KEYS.includes(key)) return fail('invalid-refinement');
    if (quote !== undefined && (!quote || typeof quote !== 'object' || Array.isArray(quote) || !Number.isInteger(quote.level)
      || quote.level < 0 || quote.level >= CONFIG.refinements[key].levels.length || !Number.isInteger(quote.cost) || quote.cost <= 0
      || (has(quote, 'key') && quote.key !== key))) return fail('invalid-refinement-quote');
    if (Object.keys(this.state.pendingRewards).length) return fail('busy');
    const option = this._refinementOption(key);
    // A held button can only buy the level and price actually displayed. Replaying it cannot charge twice.
    if (quote && (quote.level !== option.level || quote.cost !== option.cost)) return fail('stale-refinement');
    if (!option.canBuy) return fail(option.reason);
    this.state.coins -= option.cost; this.state.refinements[key]++;
    const purchase = { key, name: option.name, fromLevel: option.level, level: this.state.refinements[key], cost: option.cost };
    this._event('refinement', purchase); return { ok: true, ...purchase };
  }
  evolve() {
    const next = CONFIG.machines[this.state.machine + 1]; if (!next) return fail('max-machine');
    if (this.state.orderIndex < next.requiredOrders) return fail('orders-required');
    if (this.state.coins < next.cost) return fail('not-enough-coins');
    const before = this._production();
    this.state.coins -= next.cost; this.state.machine++;
    const after = this._production();
    this._event('evolve', { machine: this.state.machine, name: next.name, incomeBefore: before.baseIncome, incomeAfter: after.baseIncome,
      tapBefore: before.tap, tapAfter: after.tap }); return { ok: true, machine: this.state.machine };
  }
  _restoreProgression(save) {
    const s = this.state, delivery = save.deliveries, commission = save.commissions;
    s.deliveries.orderIndex = integer(delivery && delivery.orderIndex, 0, s.orderIndex);
    if (delivery && delivery.orderIndex === s.orderIndex && s.orderIndex >= 10 && s.orderIndex < 20 && Array.isArray(delivery.claimed)) {
      s.deliveries.claimed = [...new Set(delivery.claimed.filter(stage => Number.isInteger(stage) && stage >= 1 && stage <= 3
        && s.totalProduced >= this._deliveryThreshold(stage)))];
    }
    s.commissions.orderIndex = integer(commission && commission.orderIndex, 0, s.orderIndex);
    s.commissions.serial = integer(commission && commission.serial, 0, 1e12);
    if (commission && commission.orderIndex === s.orderIndex) s.commissions.claimed = integer(commission.claimed, 0, 3);
    const active = commission && commission.active;
    if (active && typeof active === 'object' && COMMISSION_KINDS.includes(active.kind) && Number.isInteger(active.orderIndex)
      && active.orderIndex >= 10 && active.orderIndex < 20 && active.orderIndex <= s.orderIndex
      && Number.isInteger(active.serial) && active.serial >= 0 && active.serial < s.commissions.serial
      && active.id === `commission:${active.serial}:${active.orderIndex}:${active.kind}` && active.basis && typeof active.basis === 'object') {
      // Freeze the accepted permanent factory, then rebuild all prices and goals from definitions.
      // A save cannot supply its own reward amount, goal count, title or readiness flag.
      const basis = active.basis, stageMachine = CONFIG.machines.filter(item => item.requiredOrders <= active.orderIndex).length - 1;
      const machine = integer(basis.machine, 0, Math.min(s.machine, stageMachine));
      const safeBasis = {
        machine, brandLevel: integer(basis.brandLevel, 0, Math.min(s.brandLevel, this._brandCap(machine))),
        upgrades: Object.fromEntries(KEYS.map(key => [key, integer(basis.upgrades && basis.upgrades[key], 0, s.upgrades[key])])),
        refinements: Object.fromEntries(REFINEMENT_KEYS.map(key => [key, integer(basis.refinements && basis.refinements[key], 0,
          Math.min(s.refinements[key], CONFIG.refinements[key].levels.filter(level => machine >= level.requiredMachine && active.orderIndex >= level.requiredOrders).length))]))
      };
      const restored = this._commissionOption(active.kind, safeBasis, active.serial, active.orderIndex);
      s.commissions.active = { ...restored, basis: safeBasis,
        production: finite(active.production, 0, restored.productionTarget), perfect: integer(active.perfect, 0, restored.perfectTarget),
        recovery: integer(active.recovery, 0, restored.recoveryTarget),
        offlineExcludedProduction: finite(active.offlineExcludedProduction, 0, s.offline ? s.offline.production : 0) };
    }
    s.souvenirs = s.machine === 5 && s.orderIndex === 20 && Array.isArray(save.souvenirs)
      ? SOUVENIRS.filter(item => save.souvenirs.includes(item.key) && s.loopIndex >= item.requiredLoops).map(item => item.key) : [];
  }
  _deliveryThreshold(stage) {
    const index = this.state.orderIndex, order = CONFIG.orders[index];
    if (!order) return 0;
    const previous = index > 0 ? CONFIG.orders[index - 1].target : 0;
    return previous + (order.target - previous) * stage / 4;
  }
  _deliveries() {
    const s = this.state, unlocked = s.orderIndex >= 10 && s.orderIndex < 20;
    const claimed = s.deliveries.orderIndex === s.orderIndex ? s.deliveries.claimed : [];
    const stages = unlocked ? [1, 2, 3].map(stage => {
      const threshold = this._deliveryThreshold(stage), wasClaimed = claimed.includes(stage);
      return { stage, threshold, coins: Math.floor(CONFIG.orders[s.orderIndex].reward * .2),
        claimed: wasClaimed, ready: !wasClaimed && s.totalProduced >= threshold };
    }) : [];
    return { unlocked, orderIndex: s.orderIndex, stages, readyCount: stages.filter(stage => stage.ready).length };
  }
  claimDelivery(stage, expectedOrderIndex) {
    if (!Number.isInteger(stage) || stage < 1 || stage > 3 || !Number.isInteger(expectedOrderIndex)) return fail('invalid-delivery');
    if (expectedOrderIndex !== this.state.orderIndex) return fail('stale-order');
    const deliveries = this._deliveries(); if (!deliveries.unlocked) return fail('delivery-locked');
    const delivery = deliveries.stages[stage - 1];
    if (delivery.claimed) return fail('already-claimed');
    if (!delivery.ready) return fail('delivery-not-ready');
    if (Object.keys(this.state.pendingRewards).length) return fail('busy');
    if (this.state.deliveries.orderIndex !== expectedOrderIndex) this.state.deliveries = { orderIndex: expectedOrderIndex, claimed: [] };
    this.state.deliveries.claimed.push(stage); this._addCoins(delivery.coins);
    this._event('delivery', { stage, orderIndex: expectedOrderIndex, coins: delivery.coins });
    return { ok: true, stage, orderIndex: expectedOrderIndex, coins: delivery.coins };
  }
  _commissionBasis() {
    const s = this.state;
    return { machine: s.machine, upgrades: { ...s.upgrades }, brandLevel: s.brandLevel, refinements: { ...s.refinements } };
  }
  _commissionOption(kind, basis = this._commissionBasis(), serial = this.state.commissions.serial, orderIndex = this.state.orderIndex) {
    const p = this._production({ ...basis, productionMode: 'balanced', boostSeconds: 0 }), bulk = kind === 'bulk';
    const productionTarget = bulk ? Math.max(50, Math.ceil(p.baseAuto * 75)) : 0;
    const recoveryTarget = !bulk && basis.machine >= CONFIG.heatRecoveryUnlockMachine && basis.upgrades.tap >= CONFIG.heatRecoveryUpgradeLevel ? 10 : 0;
    return { kind, id: `commission:${serial}:${orderIndex}:${kind}`, serial, orderIndex,
      title: bulk ? '大批量补货' : '匠心精品单',
      description: bulk ? `新生产 ${formatNumber(productionTarget)} 份 · 赶单档更快` : recoveryTarget ? '2 次完美爆锅 · 使用 10 次余热' : '完成 2 次完美爆锅',
      reward: Math.floor(p.baseIncome * (bulk ? 60 : 90)), productionTarget, perfectTarget: bulk ? 0 : 2, recoveryTarget };
  }
  _commissions() {
    const s = this.state, c = s.commissions, unlocked = s.orderIndex >= 10;
    const remaining = s.orderIndex < 20 ? 3 - (c.orderIndex === s.orderIndex ? c.claimed : 0) : 0;
    let active = null;
    if (c.active) {
      const a = c.active, parts = a.kind === 'bulk' ? [a.production / a.productionTarget]
        : [a.perfect / a.perfectTarget, ...(a.recoveryTarget ? [a.recovery / a.recoveryTarget] : [])];
      active = { id: a.id, kind: a.kind, title: a.title, description: a.description, reward: a.reward,
        productionTarget: a.productionTarget, production: a.production, perfectTarget: a.perfectTarget, perfect: a.perfect,
        recoveryTarget: a.recoveryTarget, recovery: a.recovery, ready: parts.every(value => value >= 1),
        progress: Math.min(1, parts.reduce((sum, value) => sum + value, 0) / parts.length) };
    }
    return { unlocked, available: unlocked && remaining > 0 && !active && !Object.keys(s.pendingRewards).length,
      remaining, options: unlocked && s.orderIndex < 20 ? COMMISSION_KINDS.map(kind => this._commissionOption(kind)) : [], active };
  }
  _commissionProgress(metric, amount) {
    const active = this.state.commissions.active;
    if (!active || (active.kind === 'bulk') !== (metric === 'production')) return;
    active[metric] = Math.min(active[metric + 'Target'], active[metric] + finite(amount));
  }
  acceptCommission(kind, quote) {
    if (!COMMISSION_KINDS.includes(kind)) return fail('invalid-commission');
    const s = this.state, c = s.commissions, current = this._commissionOption(kind);
    if (!quote || typeof quote !== 'object' || Array.isArray(quote)
      || ['id', 'kind', 'serial', 'orderIndex', 'reward', 'productionTarget', 'perfectTarget', 'recoveryTarget'].some(key => quote[key] !== current[key])) return fail('stale-commission');
    if (Object.keys(s.pendingRewards).length) return fail('busy');
    if (s.orderIndex < 10 || s.orderIndex >= 20) return fail('commission-locked');
    if (c.active) return fail('commission-active');
    if (this._commissions().remaining <= 0) return fail('commission-limit');
    if (c.orderIndex !== s.orderIndex) { c.orderIndex = s.orderIndex; c.claimed = 0; }
    c.active = { ...current, basis: this._commissionBasis(), production: 0, perfect: 0, recovery: 0,
      offlineExcludedProduction: s.offline ? s.offline.production : 0 };
    c.serial++;
    this._event('commission', { action: 'accept', id: current.id, kind, title: current.title, coins: 0 });
    return { ok: true, ...this._commissions().active };
  }
  cancelCommission(id) {
    const c = this.state.commissions;
    if (!c.active || id !== c.active.id) return fail('stale-commission');
    if (Object.keys(this.state.pendingRewards).length) return fail('busy');
    const active = c.active; c.active = null; c.serial++;
    this._event('commission', { action: 'cancel', id, kind: active.kind, title: active.title, coins: 0 });
    return { ok: true, id };
  }
  claimCommission(id) {
    const s = this.state, c = s.commissions, active = this._commissions().active;
    if (!active || id !== active.id) return fail('stale-commission');
    if (!active.ready) return fail('commission-not-ready');
    if (Object.keys(s.pendingRewards).length) return fail('busy');
    if (c.orderIndex !== s.orderIndex) { c.orderIndex = s.orderIndex; c.claimed = 0; }
    c.active = null; c.claimed = Math.min(3, c.claimed + 1); c.serial++; this._addCoins(active.reward);
    this._event('commission', { action: 'claim', id, kind: active.kind, title: active.title, coins: active.reward });
    return { ok: true, id, kind: active.kind, title: active.title, coins: active.reward };
  }
  _souvenirs() {
    const s = this.state, unlocked = s.orderIndex === 20 && s.machine === 5;
    const options = SOUVENIRS.map(item => {
      const owned = s.souvenirs.includes(item.key);
      const reason = owned ? 'already-owned' : !unlocked ? 'souvenir-locked' : s.loopIndex < item.requiredLoops ? 'loops-required'
        : Object.keys(s.pendingRewards).length ? 'busy' : s.coins < item.cost ? 'not-enough-coins' : '';
      return { ...item, owned, canBuy: !reason, reason };
    });
    const ownedCount = options.filter(option => option.owned).length;
    return { unlocked, ownedCount, total: SOUVENIRS.length, complete: ownedCount === SOUVENIRS.length, options };
  }
  buySouvenir(key, quote) {
    const option = this._souvenirs().options.find(item => item.key === key);
    if (!option) return fail('invalid-souvenir');
    if (!quote || typeof quote !== 'object' || Array.isArray(quote)
      || quote.key !== key || quote.cost !== option.cost || quote.requiredLoops !== option.requiredLoops) return fail('stale-souvenir');
    if (!option.canBuy) return fail(option.reason);
    this.state.coins -= option.cost; this.state.souvenirs.push(key);
    this._event('souvenir', { key, name: option.name, cost: option.cost });
    return { ok: true, key, name: option.name, cost: option.cost };
  }
  _order() {
    const s = this.state, isLoop = s.orderIndex >= 20;
    const order = isLoop ? {
      name: ['城市返场订单', '全球甜蜜补货', '金色派对专供', '爆米花王国'][s.loopIndex % 4] + ' · ' + (s.loopIndex + 1),
      target: finite(CONFIG.orders[19].target * Math.pow(1.35, Math.min(s.loopIndex + 1, 1000))),
      reward: finite(CONFIG.orders[19].reward * Math.pow(1.3, Math.min(s.loopIndex, 1000)))
    } : CONFIG.orders[s.orderIndex];
    const previousTarget = isLoop ? finite(CONFIG.orders[19].target * Math.pow(1.35, Math.min(s.loopIndex, 1000))) : (s.orderIndex > 0 ? CONFIG.orders[s.orderIndex - 1].target : 0);
    const paid = this._deliveries().stages.filter(stage => stage.claimed).reduce((sum, stage) => sum + stage.coins, 0);
    return {
      ...order, fullReward: order.reward, reward: order.reward - paid,
      index: isLoop ? 20 + s.loopIndex : s.orderIndex, number: isLoop ? s.loopIndex + 1 : s.orderIndex + 1,
      progress: Math.min(1, s.totalProduced / order.target), stageProgress: Math.max(0, Math.min(1, (s.totalProduced - previousTarget) / Math.max(1, order.target - previousTarget))),
      ready: s.totalProduced >= order.target, isLoop
    };
  }
  claimOrder() { return this._claimOrder(1); }
  _claimOrder(multiplier, frozenBonus = 0) {
    const order = this._order(); if (!order.ready) return fail('order-not-ready');
    const coins = finite(order.reward * multiplier + frozenBonus); this._addCoins(coins);
    multiplier = coins / order.reward;
    if (order.isLoop) this.state.loopIndex++; else {
      this.state.orderIndex++;
      this.state.deliveries = { orderIndex: this.state.orderIndex, claimed: [] };
      this.state.commissions.orderIndex = this.state.orderIndex; this.state.commissions.claimed = 0; this.state.commissions.serial++;
    }
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
      amount = order.reward * 2; title = '订单加价'; description = '额外 +' + formatNumber(amount) + ' 金币 · ' + (order.reward < order.fullReward ? '尾款' : '总奖励') + ' 3 倍';
      if (!order.ready) reason = 'order-not-ready';
    } else if (kind === 'sponsor') {
      amount = next ? Math.floor(Math.min(p.baseIncome * 120, next.cost * 0.6)) : 0;
      title = '设备赞助'; description = '获得 ' + formatNumber(amount) + ' 金币';
      if (!next) reason = 'max-machine';
      else if (s.coins >= next.cost) reason = 'already-affordable';
      else if (s.orderIndex < next.requiredOrders) reason = 'orders-required';
      else if (amount < 1) reason = 'production-required';
    } else if (kind === 'brand') {
      amount = 1; title = '品牌合作 · 永久产量'; description = '完整观看后，永久产量加成 +' + Math.round(CONFIG.brandBonusPerLevel * 100) + ' 个百分点';
      if (s.brandLevel >= CONFIG.brandMaxLevel) reason = 'brand-max-level';
      else if (s.machine === 0) reason = 'brand-machine-required';
      else if (s.brandLevel >= this._brandCap()) reason = 'brand-stage-cap';
    } else {
      amount = s.offline ? s.offline.coins : 0; title = '离线翻倍'; description = '额外 +' + formatNumber(amount) + ' 金币';
      if (!s.offline) reason = 'no-offline-reward';
    }
    if (!reason && s.playedSeconds < CONFIG.rewardUnlockSeconds) reason = 'intro-first';
    const cooldown = 0;
    return { kind, title, description, amount, duration: kind === 'turbo' ? 90 : undefined, available: !reason, reason, cooldown };
  }
  _rewardImpact(offer, production, next, order) {
    const s = this.state, extraCoins = finite(offer.amount);
    const rate = n => n < 100 ? Number(n.toFixed(2)).toLocaleString('zh-CN') : formatNumber(n);
    if (offer.kind === 'turbo') {
      // A second video extends the existing boost; it never multiplies taps or bursts.
      // The estimate compares the added time against the same time without this video.
      const seconds = Math.max(0, Math.min(offer.duration, 86400 - s.boostSeconds));
      const after = this._production({ boostSeconds: Math.max(1, seconds) });
      const incomeExtra = after.auto * after.price - production.baseIncome;
      const estimatedExtraCoins = finite(incomeExtra * seconds);
      return {
        title: '自动收益预计额外 +' + formatNumber(estimatedExtraCoins) + ' 金币',
        detail: `按当前产能，新增 ${rate(seconds)} 秒在线增压；点击与免费爆锅收益不变。` + (s.boostSeconds > 0 ? '已有增压仅续时，仍为 3 倍。' : ''),
        estimated: true, seconds, startsAfterSeconds: s.boostSeconds,
        extraCoins: estimatedExtraCoins, extraProduction: finite((after.auto - production.baseAuto) * seconds),
        autoIncomeBefore: production.baseIncome, autoIncomeAfter: after.auto * after.price,
        tapBefore: production.tap, tapAfter: after.tap, multiplier: after.turboMultiplier
      };
    }
    if (offer.kind === 'sponsor') {
      if (!next) return { title: '已建成最高级机器', detail: '设备赞助已完成。', estimated: false, extraCoins: 0, canEvolveAfter: false, machineCoinsMissing: 0, ordersMissing: 0 };
      const coinsAfter = finite(s.coins + extraCoins), machineCoinsMissing = Math.max(0, next.cost - coinsAfter);
      const ordersMissing = Math.max(0, next.requiredOrders - s.orderIndex);
      return {
        title: machineCoinsMissing > 0 ? '到账后换代还差 ' + formatNumber(Math.ceil(machineCoinsMissing)) + ' 金币' : '到账后金币足够换代',
        detail: `${next.name}赞助 +${formatNumber(extraCoins)} 金币。` + (ordersMissing > 0 ? `还需完成 ${ordersMissing} 张主线订单。` : '订单条件已齐。'),
        estimated: false, extraCoins, coinsBefore: s.coins, coinsAfter,
        machineId: next.id, machineName: next.name, machineCost: next.cost, machineCoinsMissing, ordersMissing,
        canEvolveAfter: machineCoinsMissing === 0 && ordersMissing === 0
      };
    }
    if (offer.kind === 'brand') {
      const nextLevel = Math.min(CONFIG.brandMaxLevel, s.brandLevel + 1), after = this._production({ brandLevel: nextLevel });
      const bonusBefore = Math.round(s.brandLevel * CONFIG.brandBonusPerLevel * 100), bonusAfter = Math.round(nextLevel * CONFIG.brandBonusPerLevel * 100);
      return {
        title: '永久自动 ' + rate(production.baseIncome) + ' → ' + rate(after.baseIncome) + ' 金币/秒',
        detail: `点击 ${rate(production.tap)} → ${rate(after.tap)} 份/次；永久加成 ${bonusBefore}% → ${bonusAfter}%。`,
        estimated: false, levelBefore: s.brandLevel, levelAfter: nextLevel, percentagePoints: bonusAfter - bonusBefore,
        autoIncomeBefore: production.baseIncome, autoIncomeAfter: after.baseIncome,
        baseAutoBefore: production.baseAuto, baseAutoAfter: after.baseAuto,
        tapBefore: production.tap, tapAfter: after.tap, bonusPercentBefore: bonusBefore, bonusPercentAfter: bonusAfter
      };
    }
    const freeCoins = offer.kind === 'order' ? order.reward : (s.offline ? s.offline.coins : 0);
    const totalCoins = finite(freeCoins + extraCoins);
    return {
      title: '额外 +' + formatNumber(extraCoins) + ' 金币',
      detail: '普通领取 ' + formatNumber(freeCoins) + '；看完共 ' + formatNumber(totalCoins) + ' 金币。',
      estimated: false, freeCoins, extraCoins, totalCoins, coinsAfter: finite(s.coins + totalCoins)
    };
  }
  quoteReward(kind) {
    const offer = this._rewardOffer(kind); if (!offer || !offer.available) return null;
    const s = this.state, existing = Object.values(s.pendingRewards)[0];
    if (existing) return existing.kind === kind ? clone(existing) : null;
    s.rewardSerial++;
    const id = 'reward:' + s.rewardSerial + ':' + Math.floor(s.playedSeconds * 1000);
    const quote = { id, kind, title: offer.title, description: offer.description, amount: offer.amount, duration: offer.duration || 0,
      orderIndex: s.orderIndex, loopIndex: s.loopIndex, offlineId: s.offline ? s.offline.id : null, machine: s.machine, createdAt: s.playedSeconds,
      ...(kind === 'brand' ? { brandLevel: s.brandLevel } : {}) };
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
    if (q.kind === 'order' && (q.orderIndex !== s.orderIndex || q.loopIndex !== s.loopIndex || !this._order().ready
      || q.amount !== this._order().reward * 2)) { delete s.pendingRewards[id]; return fail('stale-order'); }
    if (q.kind === 'offline' && (!s.offline || q.offlineId !== s.offline.id)) { delete s.pendingRewards[id]; return fail('stale-offline'); }
    if (q.kind === 'brand' && (q.brandLevel !== s.brandLevel || s.brandLevel >= this._brandCap())) { delete s.pendingRewards[id]; return fail('stale-brand'); }
    delete s.pendingRewards[id]; s.claimedRewards.push(id); s.claimedRewards = s.claimedRewards.slice(-128);
    s.lastRewardAt = s.playedSeconds; s.rewardedCount++;
    let coins = 0;
    if (q.kind === 'turbo') s.boostSeconds = Math.min(86400, s.boostSeconds + q.duration);
    else if (q.kind === 'order') { const result = this._claimOrder(1, q.amount); coins = result.coins; }
    else if (q.kind === 'sponsor') { this._addCoins(q.amount); coins = q.amount; }
    else if (q.kind === 'offline') { const result = this._claimOffline(); this._addCoins(q.amount); coins = result.coins + q.amount; }
    else if (q.kind === 'brand') s.brandLevel++;
    const brandResult = q.kind === 'brand' ? { brandLevel: s.brandLevel, bonusPercent: Math.round(s.brandLevel * CONFIG.brandBonusPerLevel * 100) } : {};
    this._event('reward', { kind: q.kind, amount: q.amount, coins, id, ...brandResult });
    return { ok: true, kind: q.kind, amount: q.amount, coins, duration: q.duration, ...brandResult };
  }
  claimOffline() { return this._claimOffline(); }
  _claimOffline() {
    const offline = this.state.offline; if (!offline) return fail('no-offline-reward');
    const active = this.state.commissions.active;
    if (active && active.kind === 'bulk') this._commissionProgress('production', Math.max(0, offline.production - active.offlineExcludedProduction));
    if (active) active.offlineExcludedProduction = 0;
    this.state.offline = null; this.state.totalProduced = finite(this.state.totalProduced + offline.production); this._addCoins(offline.coins);
    for (const [id, q] of Object.entries(this.state.pendingRewards)) if (q.kind === 'offline') delete this.state.pendingRewards[id];
    this._event('offline', { coins: offline.coins, amount: offline.production, seconds: offline.seconds }); return { ok: true, coins: offline.coins, amount: offline.production, seconds: offline.seconds };
  }
  setSetting(key, value) {
    if (!['sound', 'haptics'].includes(key) || typeof value !== 'boolean') return fail('invalid-setting');
    this.state.settings[key] = value; return { ok: true };
  }
  dismissHeatRecoveryGuide() {
    if (!this._heatRecoveryUnlocked()) return fail('heat-recovery-locked');
    this.state.learning.heatRecoveryDismissed = true; return { ok: true };
  }
  _quests() {
    const s = this.state, claimedIds = new Set(s.claimedQuests);
    let unlocked = true;
    const chapters = QUEST_CHAPTERS.map(chapter => {
      const quests = chapter.quests.map(q => {
        const current = Math.min(q.target, q.metric === 'upgrade' ? s.upgrades[q.key] : s[q.metric]);
        const claimed = claimedIds.has(q.id), ready = unlocked && !claimed && current >= q.target;
        let hint = q.hint;
        if (!unlocked) hint = '领取上一章全部奖励后解锁，已有进度保留。';
        else if (ready) hint = '目标已达成，领取这份成长奖励。';
        else if (q.metric === 'upgrade' && !claimed) {
          const missing = Math.max(0, this._upgradeCost(q.key) - s.coins);
          if (missing > 0) hint = `下一级还差 ${formatNumber(Math.ceil(missing))} 金币，继续生产积累。`;
        }
        return { id: q.id, title: q.title, description: q.description, hint, action: q.action,
          target: q.target, current, progress: current / q.target, reward: q.reward, ready, claimed, locked: !unlocked };
      });
      const claimedCount = quests.filter(q => q.claimed).length, complete = claimedCount === quests.length;
      const result = { id: chapter.id, title: chapter.title, subtitle: chapter.subtitle, unlocked, complete, claimedCount, total: quests.length, quests };
      unlocked = unlocked && complete;
      return result;
    });
    const all = chapters.flatMap(chapter => chapter.quests), active = chapters.find(chapter => chapter.unlocked && !chapter.complete);
    const claimedCount = all.filter(q => q.claimed).length, readyCount = all.filter(q => q.ready).length;
    return { chapters, activeChapterId: active ? active.id : null, claimedCount, total: all.length, readyCount,
      focus: all.find(q => q.ready) || (active && active.quests.find(q => !q.claimed)) || null, complete: claimedCount === all.length };
  }
  claimQuest(id) {
    if (typeof id !== 'string' || !QUEST_IDS.has(id)) return fail('unknown-quest');
    if (this.state.claimedQuests.includes(id)) return fail('already-claimed');
    const quest = this._quests().chapters.flatMap(chapter => chapter.quests).find(q => q.id === id);
    if (quest.locked) return fail('quest-locked');
    if (!quest.ready) return fail('quest-not-ready');
    this.state.claimedQuests.push(id); this._addCoins(quest.reward);
    this._event('quest', { id, title: quest.title, coins: quest.reward });
    return { ok: true, coins: quest.reward, id, title: quest.title };
  }
  _tutorial() {
    const s = this.state, order = this._order();
    if (s.orderIndex < 1 && order.ready) return { step: 4, title: '第一单可以装车了', text: `打开订单，直接装车领取 ${formatNumber(order.reward)} 金币。`, action: 'order' };
    if (s.taps < 5) return { step: 0, title: '轻点机器，开始爆香', text: `点机器生产，已点击 ${s.taps}/5 次。`, action: 'tap' };
    for (const [key, step, title, benefit] of [['tap', 1, '让每次点击更有分量', '每次点击产出更多'], ['auto', 2, '让工厂自己生产', '松开手也能赚金币']]) {
      if (s.upgrades[key] >= 1) continue;
      const cost = this._upgradeCost(key), missing = Math.max(0, cost - s.coins), name = CONFIG.upgrades[key].name;
      return { step, title, text: missing > 0 ? `「${name}」还差 ${formatNumber(Math.ceil(missing))} 金币，继续点击。` : `升级「${name}」，${benefit}。`, action: missing > 0 ? 'tap' : 'upgrade:' + key, upgradeKey: key };
    }
    if (s.bursts < 1) return { step: 3, title: '攒满能量，免费爆锅', text: `能量 ${Math.floor(s.energy)}/100，继续点击触发免费大喷发。`, action: 'tap' };
    if (s.orderIndex < 1) return { step: 4, title: '装满你的第一张订单', text: `还需生产 ${formatNumber(Math.ceil(order.target - s.totalProduced))} 份，继续点击。`, action: 'tap' };
    return null;
  }
  _upgradePreview(key, before, count = 1) {
    if (this.state.upgrades[key] >= CONFIG.maxUpgradeLevel) return null;
    const after = this._production({ upgrades: { ...this.state.upgrades, [key]: this.state.upgrades[key] + count } });
    const [label, unit, field] = key === 'tap' ? ['点击产量', '份/次', 'tap'] : key === 'auto' ? ['永久自动收益', '金币/秒', 'baseIncome'] : ['每份售价', '金币/份', 'price'];
    return { label, unit, before: before[field], after: after[field] };
  }
  _goal(next, order) {
    const s = this.state;
    if (!next) return { title: order.ready ? '订单可以装车了' : '下一单：' + order.name,
      text: order.ready ? `直接装车可领取 ${formatNumber(order.reward)} 金币。` : `还需生产 ${formatNumber(Math.ceil(order.target - s.totalProduced))} 份。`, action: 'order' };
    const ordersMissing = Math.max(0, next.requiredOrders - s.orderIndex), coinsMissing = Math.max(0, next.cost - s.coins);
    if (!ordersMissing && !coinsMissing) return { title: next.name + '可以开动了', text: '换代条件已齐，开动新机器！', action: 'machine' };
    const missing = [];
    if (ordersMissing) missing.push(`${ordersMissing} 个主线订单`);
    if (coinsMissing) missing.push(`${formatNumber(Math.ceil(coinsMissing))} 金币`);
    return { title: '下一台：' + next.name, text: '还差 ' + missing.join(' · ') + '。', action: ordersMissing ? 'order' : 'tab:machines' };
  }
  getView() {
    const s = this.state, next = CONFIG.machines[s.machine + 1] || null, production = this._production(), order = this._order();
    const nextProduction = next ? this._production({ machine: s.machine + 1 }) : null;
    const nextBrandLevel = Math.min(CONFIG.brandMaxLevel, s.brandLevel + 1), brandAfter = this._production({ brandLevel: nextBrandLevel });
    return {
      state: s, machine: CONFIG.machines[s.machine], nextMachine: next,
      milestones: {
        heatRecovery: { unlocked: this._heatRecoveryUnlocked(), remainingTaps: s.heatRecoveryTaps, maxTaps: CONFIG.heatRecoveryMaxTaps,
          energyPerTap: CONFIG.heatRecoveryEnergyPerTap, requiredMachine: CONFIG.heatRecoveryUnlockMachine, requiredUpgradeLevel: CONFIG.heatRecoveryUpgradeLevel, upgradeKey: 'tap' },
        bulkUpgrade: { unlocked: s.machine >= CONFIG.bulkUpgradeUnlockMachine, maxCount: CONFIG.bulkUpgradeMaxCount, reservedCoins: this._bulkReservedCoins() }
      },
      productionModes: { unlocked: s.machine >= CONFIG.productionModeUnlockMachine, current: s.productionMode,
        options: CONFIG.productionModes.map(mode => {
          const { tap, baseAuto, price, baseIncome } = this._production({ productionMode: mode.id });
          return { ...mode, selected: mode.id === s.productionMode, preview: { tap, baseAuto, price, baseIncome } };
        }) },
      brand: { level: s.brandLevel, maxLevel: CONFIG.brandMaxLevel, unlockedLevelCap: this._brandCap(),
        bonusPercent: Math.round(s.brandLevel * CONFIG.brandBonusPerLevel * 100), multiplier: 1 + s.brandLevel * CONFIG.brandBonusPerLevel,
        maxed: s.brandLevel >= CONFIG.brandMaxLevel, stageCapped: s.machine > 0 && s.brandLevel < CONFIG.brandMaxLevel && s.brandLevel >= this._brandCap(), unlocked: s.machine > 0,
        nextBonusPercent: Math.round(nextBrandLevel * CONFIG.brandBonusPerLevel * 100), priceBefore: production.price, priceAfter: brandAfter.price,
        tapBefore: production.tap, tapAfter: brandAfter.tap,
        baseAutoBefore: production.baseAuto, baseAutoAfter: brandAfter.baseAuto,
        baseIncomeBefore: production.baseIncome, baseIncomeAfter: brandAfter.baseIncome },
      upgrades: KEYS.map(key => ({ key, name: CONFIG.upgrades[key].name, description: CONFIG.upgrades[key].description,
        level: s.upgrades[key], maxLevel: CONFIG.maxUpgradeLevel, cost: this._upgradeCost(key), canBuy: s.upgrades[key] < CONFIG.maxUpgradeLevel && s.coins >= this._upgradeCost(key), preview: this._upgradePreview(key, production), bulk: this._bulkUpgradeQuote(key, production) })),
      refinements: { unlocked: s.machine >= 4, title: '工艺强化', options: REFINEMENT_KEYS.map(key => this._refinementOption(key, production)) },
      production, order, deliveries: this._deliveries(), commissions: this._commissions(), souvenirs: this._souvenirs(),
      quests: this._quests(), energy: s.energy, energyMax: 100, boostSeconds: s.boostSeconds, tutorial: this._tutorial(), goal: this._goal(next, order),
      timing: { unlocked: s.bursts > 0, available: s.bursts > 0 && !this._timingAttempted && s.energy >= CONFIG.timingAttemptEnergy && s.energy < CONFIG.energyMax,
        attempted: this._timingAttempted, armed: this._timingArmed, progress: s.energy / CONFIG.energyMax,
        windowStart: CONFIG.timingWindowStart / CONFIG.energyMax, windowEnd: CONFIG.timingWindowEnd / CONFIG.energyMax, bonusPercent: CONFIG.timingBonusPercent },
      machinePreview: nextProduction ? { tapBefore: production.tap, tapAfter: nextProduction.tap, incomeBefore: production.baseIncome, incomeAfter: nextProduction.baseIncome } : null,
      canEvolve: !!next && s.orderIndex >= next.requiredOrders && s.coins >= next.cost,
      evolveReason: !next ? 'max-machine' : s.orderIndex < next.requiredOrders ? 'orders-required' : s.coins < next.cost ? 'not-enough-coins' : '',
      completed: s.orderIndex >= 20, offline: s.offline, loadWarning: this.loadWarning,
      rewards: Object.fromEntries(REWARDS.map(kind => {
        const offer = this._rewardOffer(kind);
        return [kind, { ...offer, impact: this._rewardImpact(offer, production, next, order) }];
      })),
      stats: { totalProduced: s.totalProduced, totalCoins: s.totalCoins, playedSeconds: s.playedSeconds, taps: s.taps, bursts: s.bursts,
        orders: s.orderIndex, loopOrders: s.loopIndex, rewardedCount: s.rewardedCount, completedAt: s.completedAt }
    };
  }
  drainEvents() { const result = this.events; this.events = []; return result; }
  exportSave(now = Date.now()) { this.state.savedAt = finite(now, this.now); return clone(this.state); }
}
module.exports = { CONFIG, QUEST_CHAPTERS, Game, formatNumber };


