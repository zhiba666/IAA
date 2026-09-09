'use strict';
const { Game, CONFIG } = require('./core');

const IDS = CONFIG.stationIds;
const HZ = CONFIG.ticksPerSecond;
const SAMPLE_TICKS = HZ / 4;
const CONFIRM_TICKS = HZ * 2;
const HISTORY_TICKS = HZ * 6;
const closeRate = (a, b) => Math.abs(a - b) < .05;
const rateText = rate => Number(rate.toFixed(1)).toString();
const configurationKey = (machine, levels) => [machine, ...IDS.map(id => levels[id])].join(':');

// Display only. This module never receives a live Game, calls exportSave, writes
// storage, or changes its input snapshot. All ticks below belong to private
// games. A neutral empty copy measures sustainable output, excluding the brief
// extra sales a pre-existing stockpile could otherwise promise after an upgrade.
class ProductionInsights {
  constructor() {
    this.cache = new Map();
    this.configuration = null;
    this.configurationSince = 0;
    this.lastTick = -1;
    this.lastSampleTick = -Infinity;
    this.samples = [];
    this.confirmedId = null;
    this.lastUpgradeTick = null;
    this.previousLevels = null;
    this.lastBottleneck = null;
  }

  _predict(machine, levels) {
    const key = configurationKey(machine, levels);
    if (this.cache.has(key)) return this.cache.get(key);
    const seed = new Game({ now: 0 }).getView().state;
    seed.machine = machine;
    seed.totalProduced = 0;
    for (const id of IDS) {
      const spec = CONFIG.stations[id].levels[levels[id]];
      seed.upgrades[id] = levels[id];
      seed.stations[id] = { jobs: Array(spec.lanes).fill(null), processed: 0, history: [] };
    }
    const copy = new Game({ save: seed, now: 0 });
    // Twelve seconds lets all real batches enter the line. Measure two 12 s
    // windows (whole multiples of every configured cycle), with finite buffers,
    // parallel lanes, downstream pickups and blocked completed jobs unchanged.
    copy.tick(12);
    let before = copy.state.totalSold;
    copy.tick(12);
    const firstRate = (copy.state.totalSold - before) / 12;
    before = copy.state.totalSold;
    copy.tick(12);
    let rate = (copy.state.totalSold - before) / 12;
    // Keep a bounded fallback if future rule changes need longer to settle.
    if (!closeRate(rate, firstRate)) {
      before = copy.state.totalSold;
      copy.tick(36);
      rate = (copy.state.totalSold - before) / 36;
    }
    const result = Object.freeze({ rate: Math.round(rate * 1000) / 1000 });
    // Limit display memory over arbitrarily long/restarted sessions.
    if (this.cache.size >= 80) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, result);
    return result;
  }

  _observe(view, key) {
    const tick = view.state.simulation.ticks;
    const rewound = tick < this.lastTick;
    const changed = key !== this.configuration;
    const first = this.configuration === null || rewound;
    if (changed || rewound) {
      const upgraded = !first && this.previousLevels && IDS.some(id => view.state.upgrades[id] !== this.previousLevels[id]);
      if (upgraded) this.lastUpgradeTick = tick;
      else if (first) this.lastUpgradeTick = view.state.firstUpgradeAt;
      this.configuration = key;
      // A loaded factory may already contain two seconds of production evidence.
      // A just-purchased configuration must build fresh evidence instead.
      this.configurationSince = first ? Math.max(0, tick - CONFIRM_TICKS) : tick;
      this.previousLevels = { ...view.state.upgrades };
      this.samples = [];
      this.lastSampleTick = -Infinity;
      this.confirmedId = null;
      this.lastBottleneck = null;
    }
    this.lastTick = tick;
    if (tick - this.lastSampleTick < SAMPLE_TICKS) return false;
    this.lastSampleTick = tick;
    this.samples.push({
      tick,
      statuses: Object.fromEntries(view.stations.map(station => [station.id, station.status])),
      buffers: Object.fromEntries(view.buffers.map(buffer => [buffer.id, buffer.amount / buffer.capacity]))
    });
    this.samples = this.samples.filter(sample => sample.tick >= tick - HISTORY_TICKS);
    return true;
  }

  _bottleneck(view, stableRate) {
    const tick = view.state.simulation.ticks;
    const minimum = Math.min(...view.stations.map(station => station.capacity));
    const limiting = view.stations.filter(station => closeRate(station.capacity, minimum));
    const names = limiting.map(station => station.name).join('与');
    const forecastLabel = `${names}能力限制 · 稳定约${rateText(stableRate)}份/秒`;
    const common = { predictedStationId: limiting.length === 1 ? limiting[0].id : null, stationIds: limiting.map(station => station.id), forecastLabel };
    if (limiting.length > 1) {
      this.confirmedId = null;
      return { ...common, stationId: null, status: 'balanced', label: `${names}共同限制`,
        reason: `设备能力接近；单独改造一处可能暂不提速，整线稳定约${rateText(stableRate)}份/秒。` };
    }
    const station = limiting[0];
    const inputId = station.id === 'cup' ? 'pop' : station.id === 'ship' ? 'cup' : null;
    const input = view.buffers.find(buffer => buffer.id === inputId);
    const recentHistory = view.state.stations[station.id].history;
    const recentRate = recentHistory.reduce((sum, event) => sum + (event.tick > tick - CONFIRM_TICKS ? event.amount : 0), 0) / 2;
    const sustained = tick - this.configurationSince >= CONFIRM_TICKS;
    const activeEvidence = station.status === 'running' && recentRate >= station.capacity * .8;
    const recentSamples = this.samples.filter(sample => sample.tick > tick - CONFIRM_TICKS);
    const inactiveSamples = recentSamples.filter(sample => sample.statuses[station.id] !== 'running');
    const continuouslyInactive = recentSamples.length >= 7 && inactiveSamples.length === recentSamples.length;
    if (sustained && activeEvidence) this.confirmedId = station.id;
    if (continuouslyInactive) this.confirmedId = null;
    if (this.confirmedId !== station.id) {
      const startup = view.state.playedSeconds < 2;
      return { ...common, stationId: null, status: 'observing', label: startup ? '首批供料中' : '观察改造后的货物流动',
        reason: `${forecastLabel}；等待持续生产确认，短时缺料或堵塞不作为瓶颈。` };
    }
    const inputSamples = inputId ? this.samples.filter(sample => sample.buffers[inputId] >= .5) : [];
    const sustainedStock = inputSamples.length >= 3 && inputSamples[inputSamples.length - 1].tick - inputSamples[0].tick >= HZ;
    let evidence;
    if (input && (sustainedStock || input.amount >= input.capacity * .75)) {
      evidence = `${inputId === 'pop' ? '待装爆米花' : '待发成品'}${sustainedStock ? '持续' : '已有'}积压，${station.name}持续处理`;
    } else if (station.id === 'pop') {
      evidence = '供料能力低于后段，装杯与出货会间歇等料';
    } else {
      evidence = `${station.name}近2秒接近满负荷，其他工位仍有余量`;
    }
    return { ...common, stationId: station.id, status: 'confirmed', label: `${station.name}限制出货`,
      reason: `${evidence}；${station.lanes}个工作头×每批${station.batchSize}份，整线稳定约${rateText(stableRate)}份/秒。` };
  }

  enrich(view) {
    const levels = view.state.upgrades;
    const machine = view.state.machine;
    const key = configurationKey(machine, levels);
    const stableRate = this._predict(machine, levels).rate;
    const sampled = this._observe(view, key);
    if (sampled || !this.lastBottleneck) this.lastBottleneck = this._bottleneck(view, stableRate);
    const stations = view.stations.map(station => {
      if (!station.upgrade) return { ...station, upgrade: null };
      const upgrade = station.upgrade;
      const nextLevels = { ...levels, [station.id]: station.level + 1 };
      const predictionMachine = Math.max(machine, upgrade.requiredMachine);
      const lineAfter = this._predict(predictionMachine, nextLevels).rate;
      const lineImproves = lineAfter - stableRate > .05;
      return { ...station, upgrade: { ...upgrade,
        capacityBefore: station.capacity, capacityAfter: upgrade.capacity,
        lineBefore: stableRate, lineAfter, lineImproves,
        lineRequiresExpansion: predictionMachine > machine,
        lineMessage: lineImproves
          ? `预计整线稳定出货约${rateText(stableRate)}→${rateText(lineAfter)}份/秒`
          : '暂不提高稳定出货，为后续改造预留能力'
      } };
    });
    const nextMachine = CONFIG.machines[machine + 1];
    const expansion = view.expansion ? { ...view.expansion,
      bufferChanges: ['pop', 'cup'].map(id => ({ id, name: id === 'pop' ? '待装仓' : '成品仓',
        before: view.machine.buffers[id], after: nextMachine.buffers[id] })),
      unlocks: IDS.flatMap(id => CONFIG.stations[id].levels
        .filter(level => level.requiredMachine === machine + 1)
        .map(level => ({ stationId: id, stationName: CONFIG.stations[id].name, name: level.name }))),
      note: '扩建开放改造，设备提速需另行购买'
    } : null;
    const tick = view.state.simulation.ticks;
    const secondsSinceUpgrade = this.lastUpgradeTick === null ? Infinity : Math.max(0, tick - this.lastUpgradeTick) / HZ;
    const updating = secondsSinceUpgrade < CONFIG.rateWindowSeconds;
    const warming = view.state.playedSeconds < CONFIG.rateWindowSeconds;
    return { ...view, stations, expansion, insights: {
      stableRate,
      previewMethod: '按真实批次、并行工作头及有限仓位，在隔离工厂预热后推演稳定出货；不含积压库存的短时释放。',
      bottleneck: { ...this.lastBottleneck, stationIds: [...this.lastBottleneck.stationIds] },
      sampling: { windowSeconds: CONFIG.rateWindowSeconds, updating, warming,
        label: updating ? '近10秒实测 · 均速更新中' : warming ? '实测均速 · 开工不足10秒' : '近10秒实测均速',
        secondsUntilSettled: updating ? Math.ceil(CONFIG.rateWindowSeconds - secondsSinceUpgrade) : 0 }
    } };
  }
}

module.exports = { ProductionInsights };
