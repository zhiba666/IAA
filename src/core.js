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
let nextReservationId = 0;

function formatNumber(value) {
  const n = number(value) ? Math.max(0, value) : 0;
  if (n < 10000) return Math.floor(n).toLocaleString('zh-CN');
  const divisor = n < 1e8 ? 1e4 : n < 1e12 ? 1e8 : 1e12;
  return (n / divisor).toFixed(1).replace(/\.0$/, '') + (divisor === 1e4 ? '万' : divisor === 1e8 ? '亿' : '万亿');
}
function freshState(now, experiment = null, mode = null) {
  const state = {
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
  if (experiment) {
    state.version = CONFIG.transferExperiment.version;
    state.experiment = experiment;
    state.inputs = { cup: 0 };
    state.transfer = { completedTransfers: 0, transferredAmount: 0 };
  }
  if (mode === 'v15') {
    state.version = CONFIG.automation.version;
    state.mode = mode;
    state.economyProfile = 'fresh';
    state.inputs = { cup: 0, ship: 0 };
    state.logisticsLevel = 0;
    state.connections = Object.fromEntries(['pop', 'cup'].map(source => [source, {
      automated: false, automatedAtTick: null, remainingTicks: 0, completedTransfers: 0, transferredAmount: 0,
      manualTransfers: 0, lastManualTransferTick: null
    }]));
    state.automaticTrial = { elapsedTicks: 0, complete: false, completedAtTick: null };
  }
  return state;
}

// This class alone owns production and settlement. Rendering receives snapshots.
// totalProduced counts portions admitted into the first workstation, including
// its work in progress: produced = sold + buffers + inputs + station WIP.
class Game {
  constructor({ save = null, now = Date.now(), experiment = null, mode = null, finishedGoods = null } = {}) {
    if (experiment !== null && experiment !== CONFIG.transferExperiment.id) throw new Error('invalid-experiment');
    if (mode !== null && mode !== 'v15') throw new Error('invalid-mode');
    if (mode && experiment) throw new Error('incompatible-mode');
    // An isolated mode may explicitly own finished inventory and the sales
    // ledger. The default profiles retain their existing immediate-sale rules.
    if (finishedGoods && (mode !== 'v15' || !['canAccept', 'accept', 'validateLedger']
      .every(key => typeof finishedGoods[key] === 'function'))) throw new Error('invalid-finished-goods');
    this._finishedGoods = finishedGoods;
    this._orderRules = finishedGoods && finishedGoods.rules;
    this.mode = mode;
    this.experiment = experiment;
    this._transferReservation = null;
    this._transferReservations = new Map();
    this.now = nowValue(now);
    this.events = [];
    this.loadWarning = null;
    this.state = freshState(this.now, this.experiment, this.mode);
    if (save !== null && save !== undefined) this._restore(save);
    if (!this._loadedAutomation) this._settle();
  }
  _definitions(s = this.state) { if (this._orderRules) return this._orderRules.stations[s.economyProfile]; return this.mode === 'v15' && s.economyProfile === 'fresh' ? CONFIG.automation.stations : CONFIG.stations; }
  _machines(s = this.state) { if (this._orderRules) return this._orderRules.machines; return this.mode === 'v15' && s.economyProfile === 'fresh' ? CONFIG.automation.machines : CONFIG.machines; }
  _logisticsLevels() { return this._orderRules ? this._orderRules.logisticsLevels : CONFIG.automation.logisticsLevels; }
  _routeDefinition(source) { return this._orderRules ? this._orderRules.automation[source] : CONFIG.automation.routes[source]; }
  _spec(id) { return this._definitions()[id].levels[this.state.upgrades[id]]; }
  _logisticsSpec(s = this.state) {
    const level = this._logisticsLevels()[s.logisticsLevel];
    const stage = this._machines(s)[s.machine];
    return { ...level, transferBatch: Math.max(level.transferBatch, stage.buffers.pop, stage.buffers.cup),
      inputCapacity: Math.max(level.inputCapacity, stage.buffers.pop, stage.buffers.cup),
      bufferCapacity: Math.max(s.economyProfile === 'legacy' && s.logisticsLevel === 0 ? 0 : level.bufferCapacity,
        stage.buffers.pop, stage.buffers.cup) };
  }
  _bufferCaps(s = this.state) {
    if (this.mode !== 'v15') return this._machines(s)[s.machine].buffers;
    // Migration retains old output capacity; the added input pockets never
    // reduce the capacity or processing definitions of an existing factory.
    const capacity = this._logisticsSpec(s).bufferCapacity;
    return { pop: capacity, cup: capacity };
  }
  _restore(input) {
    try {
      const data = typeof input === 'string' ? JSON.parse(input) : input;
      if (this.mode === 'v15' && data && data.version === CONFIG.version) {
        if (this._finishedGoods) throw new Error('inventory-migration-disabled');
        const validated = new Game({ save: data, now: this.now });
        if (validated.loadWarning) throw new Error('legacy-invalid');
        const migrated = { ...validated.state, ...Object.fromEntries(Object.entries(freshState(this.now, null, 'v15'))
          .filter(([key]) => ['version', 'mode', 'economyProfile', 'inputs', 'logisticsLevel', 'connections', 'automaticTrial'].includes(key))) };
        migrated.economyProfile = 'legacy';
        for (const source of ['pop', 'cup']) {
          const target = CONFIG.automation.routes[source].target;
          migrated.connections[source].automated = true;
          migrated.connections[source].automatedAtTick = 0;
          migrated.connections[source].transferredAmount = sumJobs(migrated.stations[target]) + migrated.stations[target].processed;
        }
        migrated.automaticTrial = { elapsedTicks: CONFIG.automation.trialSeconds * HZ, complete: true,
          completedAtTick: migrated.simulation.ticks };
        this.state = migrated;
        this._loadedAutomation = true;
        return;
      }
      const version = this.mode === 'v15' ? CONFIG.automation.version : this.experiment ? CONFIG.transferExperiment.version : CONFIG.version;
      if (!data || data.version !== version || (data.experiment || null) !== this.experiment
        || (this.mode === 'v15' && data.mode !== 'v15')) throw new Error('version');
      const s = freshState(this.now, this.experiment, this.mode);
      if (this.mode === 'v15') {
        if (!['fresh', 'legacy'].includes(data.economyProfile)) throw new Error('profile');
        s.economyProfile = data.economyProfile;
        if (!whole(data.logisticsLevel) || !this._logisticsLevels()[data.logisticsLevel]
          || this._logisticsLevels()[data.logisticsLevel].requiredMachine > data.machine) throw new Error('logistics');
        s.logisticsLevel = data.logisticsLevel;
      }
      if (!whole(data.machine) || data.machine >= CONFIG.machines.length) throw new Error('machine');
      if (this.experiment && data.machine !== 0) throw new Error('machine');
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
        const spec = this._definitions(s)[id].levels[level];
        if (!whole(level) || !spec || spec.requiredMachine > s.machine) throw new Error('upgrade');
        s.upgrades[id] = level;
        const raw = data.stations && data.stations[id];
        if (!raw || !whole(raw.processed) || !Array.isArray(raw.jobs) || raw.jobs.length !== spec.lanes) throw new Error('station');
        const jobs = raw.jobs.map(job => {
          if (job === null) return null;
          if (!job || !whole(job.amount) || !whole(job.remainingTicks) || job.remainingTicks > job.durationTicks
            || !this._definitions(s)[id].levels.slice(0, level + 1).some(old => (this._finishedGoods ? job.amount > 0 && job.amount <= old.batchSize : old.batchSize === job.amount) && old.cycleTicks === job.durationTicks)) throw new Error('job');
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
        if (!whole(amount) || amount > this._bufferCaps(s)[id]) throw new Error('buffer');
        s.buffers[id] = amount;
      }
      if (this.mode === 'v15') {
        for (const source of ['pop', 'cup']) {
          const target = CONFIG.automation.routes[source].target;
          const amount = data.inputs && data.inputs[target];
          if (!whole(amount) || amount > this._logisticsSpec(s).inputCapacity) throw new Error('input');
          s.inputs[target] = amount;
          const c = data.connections && data.connections[source];
          const cycle = s.economyProfile === 'legacy' ? 0 : CONFIG.automation.transportCycleTicks;
          if (!c || typeof c.automated !== 'boolean' || !whole(c.remainingTicks) || c.remainingTicks > cycle
            || (c.automated ? !whole(c.automatedAtTick) || c.automatedAtTick > s.simulation.ticks : c.automatedAtTick !== null)
            || (!c.automated && c.remainingTicks !== 0)
            || !whole(c.completedTransfers) || !whole(c.transferredAmount) || !whole(c.manualTransfers)
            || c.manualTransfers > c.completedTransfers || c.completedTransfers > c.transferredAmount
            || !(c.lastManualTransferTick === null || whole(c.lastManualTransferTick) && c.lastManualTransferTick <= s.simulation.ticks)
            || (c.manualTransfers === 0) !== (c.lastManualTransferTick === null)
            || (s.economyProfile === 'legacy' && !c.automated)) throw new Error('connection');
          if (c.transferredAmount !== amount + sumJobs(s.stations[target]) + s.stations[target].processed) throw new Error('transfer-conservation');
          s.connections[source] = { automated: c.automated, automatedAtTick: c.automatedAtTick, remainingTicks: c.remainingTicks,
            completedTransfers: c.completedTransfers, transferredAmount: c.transferredAmount,
            manualTransfers: c.manualTransfers, lastManualTransferTick: c.lastManualTransferTick };
        }
        const trial = data.automaticTrial, required = CONFIG.automation.trialSeconds * HZ;
        if (!trial || !whole(trial.elapsedTicks) || trial.elapsedTicks > required || typeof trial.complete !== 'boolean'
          || trial.complete !== (trial.elapsedTicks === required)
          || (trial.complete ? !whole(trial.completedAtTick) || trial.completedAtTick > s.simulation.ticks : trial.completedAtTick !== null)
          || ((!s.connections.pop.automated || !s.connections.cup.automated) && trial.elapsedTicks > 0)) throw new Error('automatic-trial');
        if (trial.elapsedTicks > 0 && !(s.economyProfile === 'legacy' && trial.complete)) {
          const end = trial.complete ? trial.completedAtTick : s.simulation.ticks;
          const start = end - trial.elapsedTicks + 1;
          if (this._automaticCapacity(s) < this._machines(s)[1].targetRate
            || Object.values(s.connections).some(c => start - c.automatedAtTick < WINDOW
              || c.lastManualTransferTick !== null && c.lastManualTransferTick <= end && start - c.lastManualTransferTick < WINDOW)) throw new Error('trial-clock');
        }
        s.automaticTrial = { elapsedTicks: trial.elapsedTicks, complete: trial.complete, completedAtTick: trial.completedAtTick };
        if (!this._orderRules && s.economyProfile === 'fresh' && s.milestones[0] && !trial.complete) throw new Error('milestone');
      }
      if (this.experiment) {
        const input = data.inputs && data.inputs.cup;
        const transfer = data.transfer;
        if (!whole(input) || input > CONFIG.transferExperiment.inputCapacity) throw new Error('input');
        if (!transfer || !whole(transfer.completedTransfers) || !whole(transfer.transferredAmount)
          || transfer.completedTransfers > transfer.transferredAmount
          || (transfer.completedTransfers === 0 && transfer.transferredAmount !== 0)
          || (transfer.completedTransfers > 0 && transfer.transferredAmount > CONFIG.transferExperiment.tutorialBatch
            + (transfer.completedTransfers - 1) * CONFIG.transferExperiment.transferBatch)) throw new Error('transfer');
        s.inputs.cup = input;
        s.transfer = { completedTransfers: transfer.completedTransfers, transferredAmount: transfer.transferredAmount };
        if (s.transfer.transferredAmount !== input + sumJobs(s.stations.cup) + s.stations.cup.processed) throw new Error('transfer-conservation');
      }
      const wip = IDS.reduce((sum, id) => sum + sumJobs(s.stations[id]), 0);
      const inputs = this.mode === 'v15' ? s.inputs.cup + s.inputs.ship : this.experiment ? s.inputs.cup : 0;
      const packaged = this._finishedGoods ? s.stations.ship.processed : s.totalSold;
      if (s.totalProduced !== packaged + s.buffers.pop + s.buffers.cup + inputs + wip
        || s.stations.pop.processed !== s.totalProduced - sumJobs(s.stations.pop)
        || s.stations.cup.processed !== packaged + s.buffers.cup + sumJobs(s.stations.ship) + (this.mode === 'v15' ? s.inputs.ship : 0)
        || (this._finishedGoods ? !this._finishedGoods.validateLedger(s)
          : s.stations.ship.processed !== s.totalSold || s.totalEarned !== s.totalSold * CONFIG.price)
        || s.coins !== s.totalEarned - s.totalSpent) throw new Error('conservation');
      this.state = s;
      if (this.mode === 'v15') this._loadedAutomation = true;
    } catch (error) {
      this.loadWarning = this.mode === 'v15' ? '自动化存档校验失败，已安全重新开工；原存档保留。' : this.experiment
        ? error && error.message === 'version' ? '实验存档不兼容，已重新开始实验；正式存档保留。' : '实验存档损坏，已安全重新开始实验。'
        : error && error.message === 'version' ? '玩法已重构，从新工厂开始；旧存档保留。' : '新工厂存档损坏，已安全重新开工。';
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
    const s = this.state, bufferCaps = this._bufferCaps();
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
            if (this._finishedGoods) {
              if (!this._finishedGoods.canAccept(job.amount, s)) continue;
              this._finishedGoods.accept(job.amount, s);
            } else {
              if (this.mode === 'v15' && s.totalSold === 0) this.events.push({ type: 'first-sale', amount: job.amount, playedSeconds: s.playedSeconds });
              s.totalSold += job.amount;
              const coins = job.amount * CONFIG.price;
              s.coins += coins;
              s.totalEarned += coins;
            }
          } else s.buffers[id] += job.amount;
          this._record(id, job.amount);
          station.jobs[lane] = null;
          changed = true;
        }
      }
      if (this.mode === 'v15') {
        for (const source of ['cup', 'pop']) {
          const connection = s.connections[source];
          if (!connection.automated || connection.remainingTicks > 0) continue;
          const target = CONFIG.automation.routes[source].target;
          const reserved = this._transferReservations.get(source);
          const logistics = this._logisticsSpec();
          const amount = Math.min(logistics.transferBatch,
            s.buffers[source] - (reserved ? reserved.amount : 0), logistics.inputCapacity - s.inputs[target]);
          if (amount <= 0) continue;
          this._moveTransfer(source, amount, false);
          connection.remainingTicks = s.economyProfile === 'legacy' ? 0 : CONFIG.automation.transportCycleTicks;
          changed = true;
        }
      }
      for (const id of ['ship', 'cup', 'pop']) {
        const station = s.stations[id], spec = this._spec(id);
        for (let lane = 0; lane < station.jobs.length; lane++) {
          if (station.jobs[lane]) continue;
          const input = id === 'cup' ? 'pop' : 'cup';
          const hasInput = this.mode === 'v15' && id !== 'pop' || this.experiment && id === 'cup';
          const stock = hasInput ? s.inputs : s.buffers;
          const inputKey = hasInput ? id : input;
          const amount = this._finishedGoods && id !== 'pop' ? Math.min(spec.batchSize, stock[inputKey]) : spec.batchSize;
          if (id !== 'pop' && (amount <= 0 || stock[inputKey] < amount)) continue;
          if (id === 'pop' && this._finishedGoods && this._finishedGoods.canStart
            && !this._finishedGoods.canStart(amount, s)) continue;
          if (id === 'pop') s.totalProduced += amount;
          else stock[inputKey] -= amount;
          station.jobs[lane] = { amount, durationTicks: spec.cycleTicks, remainingTicks: spec.cycleTicks };
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
    const soldBefore = s.totalSold, earnedBefore = s.totalEarned;
    for (let i = 0; i < steps; i++) {
      s.simulation.ticks++;
      s.playedSeconds = s.simulation.ticks / HZ;
      for (const id of IDS) for (const job of s.stations[id].jobs) if (job && job.remainingTicks > 0) job.remainingTicks--;
      if (this.mode === 'v15') for (const c of Object.values(s.connections)) if (c.remainingTicks > 0) c.remainingTicks--;
      this._settle();
      if (this.mode === 'v15') this._advanceAutomaticTrial();
      if (this._finishedGoods && this._finishedGoods.afterTick) this._finishedGoods.afterTick(s);
      if (s.simulation.ticks % HZ === 0) {
        this._pruneHistory();
        const next = this._machines()[s.machine + 1];
        if (next && !s.milestones[s.machine] && s.playedSeconds >= CONFIG.rateWindowSeconds
          && (this.mode !== 'v15' || s.automaticTrial.complete && this._unattended() && this._automaticCapacity() >= next.targetRate)
          && this._actualRate('ship') >= next.targetRate) s.milestones[s.machine] = true;
      }
    }
    this._pruneHistory();
    const amount = s.totalSold - soldBefore;
    const coins = s.totalEarned - earnedBefore;
    if (amount && !this._finishedGoods) this.events.push({ type: 'ship', amount, coins });
    return { ok: true, amount, coins };
  }
  _upgrade(id) {
    const definition = this._definitions()[id];
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
    const s = this.state, next = this._machines()[s.machine + 1];
    if (!next) return null;
    const rateReached = this._orderRules ? true : s.milestones[s.machine];
    const canAfford = s.coins >= next.cost;
    const reason = this.experiment ? 'experiment-complete'
      : !this._orderRules && this.mode === 'v15' && (!s.connections.pop.automated || !s.connections.cup.automated) ? 'automation-required'
      : !this._orderRules && this.mode === 'v15' && !s.automaticTrial.complete ? 'automatic-trial-required'
      : !rateReached ? 'throughput-required' : s.totalSold < next.requiredSold ? 'sales-required'
      : !canAfford ? 'not-enough-coins' : '';
    return { name: next.name, description: next.description, cost: next.cost, requiredSold: next.requiredSold,
      targetRate: next.targetRate, sold: s.totalSold, total: next.requiredSold, rateReached, canAfford, ready: !reason, reason };
  }
  evolve() {
    if (this.experiment) return fail('experiment-complete');
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
  _unattended() {
    const s = this.state;
    return Object.values(s.connections).every(c => c.automated
      && s.simulation.ticks - c.automatedAtTick >= WINDOW
      && (c.lastManualTransferTick === null || s.simulation.ticks - c.lastManualTransferTick >= WINDOW));
  }
  _automaticCapacity(s = this.state) {
    if (!Object.values(s.connections).every(c => c.automated)) return 0;
    const processing = IDS.map(id => this._definitions(s)[id].levels[s.upgrades[id]].capacity);
    const transport = s.economyProfile === 'legacy' ? Number.MAX_SAFE_INTEGER
      : this._logisticsSpec(s).transferBatch * HZ / CONFIG.automation.transportCycleTicks;
    return Math.min(...processing, transport);
  }
  _advanceAutomaticTrial() {
    const s = this.state, trial = s.automaticTrial;
    if (trial.complete) return;
    const target = this._machines()[1].targetRate;
    if (!this._unattended() || this._automaticCapacity() < target || this._actualRate('ship') < target) { trial.elapsedTicks = 0; return; }
    trial.elapsedTicks = Math.min(CONFIG.automation.trialSeconds * HZ, trial.elapsedTicks + 1);
    if (trial.elapsedTicks === CONFIG.automation.trialSeconds * HZ) {
      trial.complete = true;
      trial.completedAtTick = s.simulation.ticks;
      this.events.push({ type: 'automatic-trial', playedSeconds: s.playedSeconds });
    }
  }
  _automationOffer(source) {
    const route = this._routeDefinition(source), s = this.state;
    const reason = s.connections[source].automated ? 'already-automated'
      : this._orderRules && !s.connections[source].manualTransfers ? 'tutorial-required'
      : s.machine < route.requiredMachine ? 'machine-required' : s.coins < route.cost ? 'not-enough-coins' : '';
    return { ...route, available: !reason, reason };
  }
  buyAutomation(source = 'pop') {
    if (this.mode !== 'v15') return fail('automation-disabled');
    if (!['pop', 'cup'].includes(source)) return fail('invalid-source');
    const offer = this._automationOffer(source);
    if (!offer.available) return fail(offer.reason);
    const s = this.state;
    s.coins -= offer.cost;
    s.totalSpent += offer.cost;
    s.connections[source].automated = true;
    s.connections[source].automatedAtTick = s.simulation.ticks;
    this._settle();
    this.events.push({ type: 'automation', source, target: offer.target, cost: offer.cost, playedSeconds: s.playedSeconds });
    return { ok: true, source, target: offer.target, cost: offer.cost };
  }
  _logisticsUpgrade() {
    if (this.mode !== 'v15') return null;
    const s = this.state, next = this._logisticsLevels()[s.logisticsLevel + 1];
    if (!next) return null;
    const reason = next.requiredMachine > s.machine ? 'machine-required' : s.coins < next.cost ? 'not-enough-coins' : '';
    const before = this._logisticsSpec();
    const after = this._logisticsSpec({ ...s, logisticsLevel: s.logisticsLevel + 1 });
    return { ...after, cost: next.cost, available: !reason, reason, before, after,
      batchBefore: before.transferBatch, batchAfter: after.transferBatch,
      inputBefore: before.inputCapacity, inputAfter: after.inputCapacity,
      capacityBefore: before.bufferCapacity, capacityAfter: after.bufferCapacity };
  }
  buyLogisticsUpgrade() {
    if (this.mode !== 'v15') return fail('automation-disabled');
    const offer = this._logisticsUpgrade();
    if (!offer) return fail('max-level');
    if (!offer.available) return fail(offer.reason);
    const s = this.state;
    s.coins -= offer.cost;
    s.totalSpent += offer.cost;
    s.logisticsLevel++;
    this._settle();
    this.events.push({ type: 'logistics-upgrade', level: s.logisticsLevel, cost: offer.cost, playedSeconds: s.playedSeconds });
    return { ok: true, level: s.logisticsLevel, cost: offer.cost };
  }
  _routeView(source) {
    const s = this.state, target = CONFIG.automation.routes[source].target;
    const c = s.connections[source], logistics = this._logisticsSpec();
    const reservation = this._transferReservations.get(source);
    const batchSize = !c.automated && c.manualTransfers === 0 ? CONFIG.automation.tutorialBatch : logistics.transferBatch;
    const reservedAmount = reservation ? reservation.amount : 0;
    const availableAmount = Math.min(Math.max(0, s.buffers[source] - reservedAmount), batchSize);
    const free = Math.max(0, logistics.inputCapacity - s.inputs[target]);
    const reason = reservation ? 'transfer-pending' : !availableAmount ? 'source-empty' : !free ? 'target-full' : '';
    const transportCycleTicks = s.economyProfile === 'legacy' ? 0 : CONFIG.automation.transportCycleTicks;
    return { id: source === 'pop' ? 'A' : 'B', enabled: true, source, target, batchSize,
      inputAmount: s.inputs[target], inputCapacity: logistics.inputCapacity,
      reservedAmount, availableAmount, receivableAmount: Math.min(availableAmount, free),
      canReserve: !reason, reason, ...c, automation: this._automationOffer(source),
      automaticBatchSize: logistics.transferBatch, transportCycleTicks,
      transportCapacity: transportCycleTicks ? logistics.transferBatch * HZ / transportCycleTicks : Number.MAX_SAFE_INTEGER };
  }
  _moveTransfer(source, amount, manual) {
    const s = this.state, target = CONFIG.automation.routes[source].target, c = s.connections[source];
    s.buffers[source] -= amount;
    s.inputs[target] += amount;
    c.completedTransfers++;
    c.transferredAmount += amount;
    if (manual) {
      c.manualTransfers++;
      c.lastManualTransferTick = s.simulation.ticks;
      if (!s.automaticTrial.complete) s.automaticTrial.elapsedTicks = 0;
    }
    this.events.push({ type: 'transfer', source, target, amount, automated: !manual, playedSeconds: s.playedSeconds });
  }
  _transferView() {
    if (this.mode === 'v15') return this._routeView('pop');
    if (!this.experiment) return null;
    const s = this.state, rules = CONFIG.transferExperiment;
    const batchSize = s.transfer.completedTransfers ? rules.transferBatch : rules.tutorialBatch;
    const availableAmount = Math.min(s.buffers.pop, batchSize);
    const free = rules.inputCapacity - s.inputs.cup;
    const reason = this._transferReservation ? 'transfer-pending' : !availableAmount ? 'source-empty' : free <= 0 ? 'target-full' : '';
    return { enabled: true, source: 'pop', target: 'cup', batchSize,
      inputAmount: s.inputs.cup, inputCapacity: rules.inputCapacity,
      reservedAmount: this._transferReservation ? this._transferReservation.amount : 0,
      availableAmount, receivableAmount: Math.min(availableAmount, Math.max(0, free)),
      canReserve: !reason, reason, ...s.transfer };
  }
  reserveTransfer(source = 'pop') {
    if (this.mode === 'v15') {
      if (!['pop', 'cup'].includes(source)) return fail('invalid-source');
      const transfer = this._routeView(source);
      if (!transfer.canReserve) return fail(transfer.reason);
      const reservation = { token: `transfer-${++nextReservationId}`, source, target: transfer.target,
        amount: transfer.receivableAmount };
      this._transferReservations.set(source, reservation);
      return { ok: true, ...reservation };
    }
    const transfer = this._transferView();
    if (!transfer) return fail('experiment-disabled');
    if (!transfer.canReserve) return fail(transfer.reason);
    const reservation = { token: `transfer-${++nextReservationId}`, amount: transfer.availableAmount };
    this._transferReservation = reservation;
    return { ok: true, ...reservation };
  }
  commitTransfer(token) {
    if (this.mode === 'v15') {
      const reservation = [...this._transferReservations.values()].find(r => r.token === token);
      if (!reservation) return fail('invalid-transfer');
      const { source, target } = reservation, s = this.state;
      this._transferReservations.delete(source);
      const amount = Math.min(reservation.amount, s.buffers[source], this._logisticsSpec().inputCapacity - s.inputs[target]);
      if (amount <= 0) return { ...fail(s.buffers[source] <= 0 ? 'source-empty' : 'target-full'), amount: 0, remaining: reservation.amount };
      this._moveTransfer(source, amount, true);
      this._settle();
      return { ok: true, source, target, amount, remaining: reservation.amount - amount };
    }
    if (!this.experiment) return fail('experiment-disabled');
    const reservation = this._transferReservation;
    if (!reservation || reservation.token !== token) return fail('invalid-transfer');
    // A reservation is a claim on source stock, not extra inventory. The target
    // is rechecked at commit; rejected portions remain in the source buffer.
    this._transferReservation = null;
    const s = this.state;
    const amount = Math.min(reservation.amount, s.buffers.pop, CONFIG.transferExperiment.inputCapacity - s.inputs.cup);
    if (amount <= 0) return { ...fail(s.buffers.pop <= 0 ? 'source-empty' : 'target-full'), amount: 0, remaining: reservation.amount };
    s.buffers.pop -= amount;
    s.inputs.cup += amount;
    s.transfer.completedTransfers++;
    s.transfer.transferredAmount += amount;
    this._settle();
    this.events.push({ type: 'transfer', source: 'pop', target: 'cup', amount, remaining: reservation.amount - amount });
    return { ok: true, amount, remaining: reservation.amount - amount };
  }
  cancelTransfer(token) {
    if (this.mode === 'v15') {
      let amount = 0;
      for (const [source, reservation] of this._transferReservations) {
        if (token !== undefined && reservation.token !== token) continue;
        amount += reservation.amount;
        this._transferReservations.delete(source);
      }
      return { ok: true, amount };
    }
    const reservation = this._transferReservation;
    if (!reservation || (token !== undefined && token !== reservation.token)) return { ok: true, amount: 0 };
    this._transferReservation = null;
    return { ok: true, amount: reservation.amount };
  }
  _onboarding() {
    const s = this.state;
    if (this.mode === 'v15') {
      for (const source of ['pop', 'cup']) {
        const c = s.connections[source];
        if (!c.automated && !c.manualTransfers) return { phase: 'transfer', source,
          stationId: CONFIG.automation.routes[source].target,
          hint: source === 'pop' ? '把待装仓的一盘送到装杯进料口' : '把待发仓的一盘送到出货进料口，赚到第一笔金币' };
      }
      if (s.upgrades.cup === 0 && s.economyProfile === 'fresh') return { phase: 'upgrade', stationId: 'cup', hint: '装杯每秒 2→3 份，小改造让加工更快' };
      const nextSource = ['pop', 'cup'].find(source => !s.connections[source].automated);
      if (nextSource) return { phase: 'automation', source: nextSource, stationId: CONFIG.automation.routes[nextSource].target,
        hint: nextSource === 'pop' ? '接通自动补料，以后少搬一段' : '接通自动送货，让整线自己运行' };
      if (!s.automaticTrial.complete) return { phase: 'trial', stationId: null, hint: '两段已接通，观察无人搬运时的稳定出货' };
      if (s.machine === 0) return { phase: 'expand', stationId: null, hint: '继续真实出货，准备第一次扩建' };
      return { phase: 'complete', stationId: null, hint: '' };
    }
    if (this.experiment && s.transfer.completedTransfers === 0) return {
      phase: 'transfer', stationId: 'cup', hint: '把待装仓的一批爆米花送到装杯进料口'
    };
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
      return { id, name: this._definitions()[id].name, capacity: spec.capacity, actualRate: this._actualRate(id), status,
        lanes: spec.lanes, batchSize: spec.batchSize, progress: jobs.reduce((sum, job) => sum + (job ? job.progress : 0), 0) / spec.lanes,
        inFlight: sumJobs(data), level: s.upgrades[id], processed: data.processed, jobs, upgrade: this._upgrade(id) };
    });
    return clone({ state: s, mode: this.mode, machine: this._machines()[s.machine], stations,
      buffers: ['pop', 'cup'].map(id => ({ id, amount: s.buffers[id], capacity: this._bufferCaps()[id] })),
      throughput: this._actualRate('ship'), price: CONFIG.price, expansion: this._expansion(),
      ...(this.mode === 'v15' ? {
        transfers: ['pop', 'cup'].map(source => this._routeView(source)),
        logisticsUpgrade: this._logisticsUpgrade(),
        automaticTrial: { elapsedSeconds: s.automaticTrial.elapsedTicks / HZ,
          requiredSeconds: CONFIG.automation.trialSeconds, complete: s.automaticTrial.complete,
          targetRate: this._machines()[1].targetRate, unattended: this._unattended() }
      } : {}),
      transfer: this._transferView(), onboarding: this._onboarding(), loadWarning: this.loadWarning });
  }
  drainEvents() { const events = this.events; this.events = []; return events; }
  exportSave(now = Date.now()) {
    this.cancelTransfer();
    this._pruneHistory();
    return clone({ ...this.state, savedAt: nowValue(now) });
  }
}
module.exports = { Game, CONFIG, formatNumber };
