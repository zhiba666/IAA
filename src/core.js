'use strict';
const { CONFIG } = require('./factory-rules');
const IDS = CONFIG.stationIds;
const HZ = CONFIG.ticksPerSecond;
const WINDOW = CONFIG.rateWindowSeconds * HZ;
const clone = value => JSON.parse(JSON.stringify(value));
const fail = reason => ({ ok: false, reason });
const number = value => typeof value === 'number' && Number.isFinite(value);
const whole = value => Number.isSafeInteger(value) && value >= 0;
const nowValue = value => number(value) && value >= 0 ? value : Date.now();
const sumJobs = station => station.jobs.reduce((sum, job) => sum + (job ? job.amount : 0), 0);

function formatNumber(value) {
  const n = number(value) ? Math.max(0, value) : 0;
  if (n < 10000) return Math.floor(n).toLocaleString('zh-CN');
  const divisor = n < 1e8 ? 1e4 : n < 1e12 ? 1e8 : 1e12;
  return (n / divisor).toFixed(1).replace(/\.0$/, '') + (divisor === 1e4 ? '万' : divisor === 1e8 ? '亿' : '万亿');
}
function freshState(now) {
  return {
    version: CONFIG.version, savedAt: now, introSeen: false,
    coins: 0, machine: 0, upgrades: { pop: 0, cup: 0, ship: 0 },
    settings: { sound: true, haptics: true },
    playedSeconds: 0, totalProduced: 0, totalSold: 0, totalEarned: 0, totalSpent: 0,
    buffers: { pop: 0, cup: 0 },
    stations: Object.fromEntries(IDS.map(id => [id, { jobs: [null], processed: 0, history: [] }])),
    simulation: { ticks: 0, carry: 0 },
    milestones: CONFIG.machines.slice(1).map(() => false),
    firstUpgradeAt: null
  };
}

// This class alone owns production and settlement. Rendering receives snapshots.
// totalProduced counts portions admitted into the first workstation, including
// its work in progress: produced = sold + both buffers + every station's WIP.
class Game {
  constructor({ save = null, now = Date.now() } = {}) {
    this.now = nowValue(now);
    this.events = [];
    this.loadWarning = null;
    this.state = freshState(this.now);
    if (save !== null && save !== undefined) this._restore(save);
    this._settle();
  }
  _spec(id) { return CONFIG.stations[id].levels[this.state.upgrades[id]]; }
  _restore(input) {
    try {
      const data = typeof input === 'string' ? JSON.parse(input) : input;
      if (!data || data.version !== CONFIG.version) throw new Error('version');
      const s = freshState(this.now);
      if (!whole(data.machine) || data.machine >= CONFIG.machines.length) throw new Error('machine');
      s.machine = data.machine;
      for (const key of ['coins', 'totalProduced', 'totalSold', 'totalEarned', 'totalSpent']) {
        if (!whole(data[key])) throw new Error(key);
        s[key] = data[key];
      }
      if (!data.simulation || !whole(data.simulation.ticks) || !number(data.simulation.carry)
        || data.simulation.carry < 0 || data.simulation.carry >= 1) throw new Error('clock');
      s.simulation = { ticks: data.simulation.ticks, carry: data.simulation.carry };
      s.playedSeconds = s.simulation.ticks / HZ;
      s.savedAt = nowValue(data.savedAt);
      s.introSeen = data.introSeen === true;
      s.firstUpgradeAt = data.firstUpgradeAt === null ? null
        : whole(data.firstUpgradeAt) && data.firstUpgradeAt <= s.simulation.ticks ? data.firstUpgradeAt : null;
      for (const key of ['sound', 'haptics']) s.settings[key] = !(data.settings && data.settings[key] === false);
      s.milestones = s.milestones.map((_, i) => !!(data.milestones && data.milestones[i] === true));
      for (const id of IDS) {
        const level = data.upgrades && data.upgrades[id];
        const spec = CONFIG.stations[id].levels[level];
        if (!whole(level) || !spec || spec.requiredMachine > s.machine) throw new Error('upgrade');
        s.upgrades[id] = level;
        const raw = data.stations && data.stations[id];
        if (!raw || !whole(raw.processed) || !Array.isArray(raw.jobs) || raw.jobs.length !== spec.lanes) throw new Error('station');
        const jobs = raw.jobs.map(job => {
          if (job === null) return null;
          if (!job || !whole(job.remainingTicks) || job.remainingTicks > job.durationTicks
            || !CONFIG.stations[id].levels.slice(0, level + 1).some(old => old.batchSize === job.amount && old.cycleTicks === job.durationTicks)) throw new Error('job');
          return { amount: job.amount, durationTicks: job.durationTicks, remainingTicks: job.remainingTicks };
        });
        const history = [];
        if (!Array.isArray(raw.history) || raw.history.length > WINDOW + 1) throw new Error('history');
        let previousTick = -1;
        for (const entry of raw.history) {
          if (!entry || !whole(entry.tick) || !whole(entry.amount) || entry.amount === 0
            || entry.tick <= previousTick || entry.tick > s.simulation.ticks) throw new Error('history');
          previousTick = entry.tick;
          if (entry.tick > s.simulation.ticks - WINDOW) history.push({ tick: entry.tick, amount: entry.amount });
        }
        if (history.reduce((sum, entry) => sum + entry.amount, 0) > raw.processed) throw new Error('history-total');
        s.stations[id] = { jobs, processed: raw.processed, history };
      }
      for (const id of ['pop', 'cup']) {
        const amount = data.buffers && data.buffers[id];
        if (!whole(amount) || amount > CONFIG.machines[s.machine].buffers[id]) throw new Error('buffer');
        s.buffers[id] = amount;
      }
      const wip = IDS.reduce((sum, id) => sum + sumJobs(s.stations[id]), 0);
      if (s.totalProduced !== s.totalSold + s.buffers.pop + s.buffers.cup + wip
        || s.stations.pop.processed !== s.totalProduced - sumJobs(s.stations.pop)
        || s.stations.cup.processed !== s.totalSold + s.buffers.cup + sumJobs(s.stations.ship)
        || s.stations.ship.processed !== s.totalSold
        || s.totalEarned !== s.totalSold * CONFIG.price || s.coins !== s.totalEarned - s.totalSpent) throw new Error('conservation');
      this.state = s;
    } catch (error) {
      this.loadWarning = error && error.message === 'version'
        ? '玩法已重构，从新工厂开始；旧存档保留。' : '新工厂存档损坏，已安全重新开工。';
    }
    // savedAt is metadata only. Loading never simulates time away or adds money.
  }
  _record(id, amount) {
    const station = this.state.stations[id];
    station.processed += amount;
    const tick = this.state.simulation.ticks;
    const last = station.history[station.history.length - 1];
    if (last && last.tick === tick) last.amount += amount;
    else station.history.push({ tick, amount });
  }
  _pruneHistory() {
    const cutoff = this.state.simulation.ticks - WINDOW;
    for (const id of IDS) {
      const history = this.state.stations[id].history;
      let count = 0;
      while (count < history.length && history[count].tick <= cutoff) count++;
      if (count) history.splice(0, count);
    }
  }
  _actualRate(id) {
    const cutoff = this.state.simulation.ticks - WINDOW;
    const amount = this.state.stations[id].history.reduce((sum, item) => sum + (item.tick > cutoff ? item.amount : 0), 0);
    return amount / Math.min(CONFIG.rateWindowSeconds, Math.max(1 / HZ, this.state.playedSeconds));
  }
  _settle() {
    const s = this.state, bufferCaps = CONFIG.machines[s.machine].buffers;
    let changed;
    do {
      changed = false;
      // A finished batch may remain in its lane while the output buffer is full.
      // Repeating to a fixed point lets simultaneous downstream pickups unblock
      // upstream delivery at this exact tick, without introducing a frame delay.
      for (const id of ['ship', 'cup', 'pop']) {
        const station = s.stations[id];
        for (let lane = 0; lane < station.jobs.length; lane++) {
          const job = station.jobs[lane];
          if (!job || job.remainingTicks > 0) continue;
          if (id !== 'ship' && s.buffers[id] + job.amount > bufferCaps[id]) continue;
          if (id === 'ship') {
            s.totalSold += job.amount;
            const coins = job.amount * CONFIG.price;
            s.coins += coins;
            s.totalEarned += coins;
          } else s.buffers[id] += job.amount;
          this._record(id, job.amount);
          station.jobs[lane] = null;
          changed = true;
        }
      }
      for (const id of ['ship', 'cup', 'pop']) {
        const station = s.stations[id], spec = this._spec(id);
        for (let lane = 0; lane < station.jobs.length; lane++) {
          if (station.jobs[lane]) continue;
          const input = id === 'cup' ? 'pop' : 'cup';
          if (id !== 'pop' && s.buffers[input] < spec.batchSize) continue;
          if (id === 'pop') s.totalProduced += spec.batchSize;
          else s.buffers[input] -= spec.batchSize;
          station.jobs[lane] = { amount: spec.batchSize, durationTicks: spec.cycleTicks, remainingTicks: spec.cycleTicks };
          changed = true;
        }
      }
    } while (changed);
  }
  tick(seconds) {
    if (!number(seconds) || seconds < 0) return fail('invalid-time');
    const s = this.state;
    // Carry is in simulation ticks, survives saves and makes frame partitioning
    // immaterial. The tiny epsilon only removes floating-point boundary noise.
    const exact = s.simulation.carry + seconds * HZ;
    if (!Number.isSafeInteger(Math.floor(exact)) || !Number.isSafeInteger(s.simulation.ticks + Math.floor(exact))) return fail('invalid-time');
    const steps = Math.floor(exact + 1e-9);
    s.simulation.carry = Math.max(0, exact - steps);
    const soldBefore = s.totalSold;
    for (let i = 0; i < steps; i++) {
      s.simulation.ticks++;
      s.playedSeconds = s.simulation.ticks / HZ;
      for (const id of IDS) for (const job of s.stations[id].jobs) if (job && job.remainingTicks > 0) job.remainingTicks--;
      this._settle();
      if (s.simulation.ticks % HZ === 0) {
        this._pruneHistory();
        const next = CONFIG.machines[s.machine + 1];
        if (next && !s.milestones[s.machine] && s.playedSeconds >= CONFIG.rateWindowSeconds
          && this._actualRate('ship') >= next.targetRate) s.milestones[s.machine] = true;
      }
    }
    this._pruneHistory();
    const amount = s.totalSold - soldBefore;
    if (amount) this.events.push({ type: 'ship', amount, coins: amount * CONFIG.price });
    return { ok: true, amount, coins: amount * CONFIG.price };
  }
  _upgrade(id) {
    const definition = CONFIG.stations[id];
    if (!definition) return null;
    const next = definition.levels[this.state.upgrades[id] + 1];
    if (!next) return null;
    const reason = next.requiredMachine > this.state.machine ? 'machine-required'
      : this.state.coins < next.cost ? 'not-enough-coins' : '';
    return { ...next, available: !reason, reason };
  }
  buyUpgrade(id) {
    if (!IDS.includes(id)) return fail('invalid-station');
    const upgrade = this._upgrade(id);
    if (!upgrade) return fail('max-level');
    if (!upgrade.available) return fail(upgrade.reason);
    const s = this.state;
    s.coins -= upgrade.cost;
    s.totalSpent += upgrade.cost;
    s.upgrades[id]++;
    while (s.stations[id].jobs.length < upgrade.lanes) s.stations[id].jobs.push(null);
    if (id === 'cup' && s.firstUpgradeAt === null) s.firstUpgradeAt = s.simulation.ticks;
    this._settle();
    this.events.push({ type: 'upgrade', stationId: id, name: upgrade.name, level: s.upgrades[id], cost: upgrade.cost });
    return { ok: true, stationId: id, cost: upgrade.cost, level: s.upgrades[id] };
  }
  _expansion() {
    const s = this.state, next = CONFIG.machines[s.machine + 1];
    if (!next) return null;
    const rateReached = s.milestones[s.machine];
    const canAfford = s.coins >= next.cost;
    const reason = !rateReached ? 'throughput-required' : s.totalSold < next.requiredSold ? 'sales-required'
      : !canAfford ? 'not-enough-coins' : '';
    return { name: next.name, description: next.description, cost: next.cost, requiredSold: next.requiredSold,
      targetRate: next.targetRate, sold: s.totalSold, total: next.requiredSold, rateReached, canAfford, ready: !reason, reason };
  }
  evolve() {
    const expansion = this._expansion();
    if (!expansion) return fail('max-machine');
    if (!expansion.ready) return fail(expansion.reason);
    const s = this.state;
    s.coins -= expansion.cost;
    s.totalSpent += expansion.cost;
    s.machine++;
    this._settle();
    this.events.push({ type: 'evolve', machine: s.machine, name: expansion.name, cost: expansion.cost });
    return { ok: true, machine: s.machine, cost: expansion.cost };
  }
  setSetting(key, value) {
    if (!['sound', 'haptics'].includes(key) || typeof value !== 'boolean') return fail('invalid-setting');
    this.state.settings[key] = value;
    return { ok: true };
  }
  acknowledgeIntro() { this.state.introSeen = true; return { ok: true }; }
  _onboarding() {
    const s = this.state;
    const firstCup = CONFIG.stations.cup.levels[1];
    if (s.upgrades.cup === 0) {
      if (s.buffers.pop < CONFIG.machines[0].buffers.pop / 2 && s.coins < firstCup.cost) return {
        phase: 'observe', stationId: 'cup',
        hint: '这里太慢，留意积压'
      };
      return { phase: 'upgrade', stationId: 'cup', hint: `点此改造 · ${firstCup.cost}金币` };
    }
    if (s.firstUpgradeAt !== null && s.simulation.ticks - s.firstUpgradeAt < WINDOW) {
      return { phase: 'improved', stationId: 'cup', hint: '已加快，留意积压' };
    }
    return { phase: 'complete', stationId: null, hint: '' };
  }
  getView() {
    const s = this.state;
    const stations = IDS.map(id => {
      const data = s.stations[id], spec = this._spec(id);
      const jobs = data.jobs.map(job => job ? { amount: job.amount, progress: 1 - job.remainingTicks / job.durationTicks, complete: job.remainingTicks === 0 } : null);
      const status = data.jobs.some(job => job && job.remainingTicks === 0) ? 'blocked'
        : data.jobs.some(Boolean) ? 'running' : 'waiting';
      return { id, name: CONFIG.stations[id].name, capacity: spec.capacity, actualRate: this._actualRate(id), status,
        lanes: spec.lanes, batchSize: spec.batchSize, progress: jobs.reduce((sum, job) => sum + (job ? job.progress : 0), 0) / spec.lanes,
        inFlight: sumJobs(data), level: s.upgrades[id], processed: data.processed, jobs, upgrade: this._upgrade(id) };
    });
    return clone({ state: s, machine: CONFIG.machines[s.machine], stations,
      buffers: ['pop', 'cup'].map(id => ({ id, amount: s.buffers[id], capacity: CONFIG.machines[s.machine].buffers[id] })),
      throughput: this._actualRate('ship'), price: CONFIG.price, expansion: this._expansion(),
      onboarding: this._onboarding(), loadWarning: this.loadWarning });
  }
  drainEvents() { const events = this.events; this.events = []; return events; }
  exportSave(now = Date.now()) {
    this._pruneHistory();
    return clone({ ...this.state, savedAt: nowValue(now) });
  }
}
module.exports = { Game, CONFIG, formatNumber };
