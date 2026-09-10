'use strict';
const { Game, CONFIG } = require('./core');

const IDS = CONFIG.stationIds;
const HZ = CONFIG.ticksPerSecond;
const SAMPLE_TICKS = HZ / 4;
const CONFIRM_TICKS = HZ * 2;
const HISTORY_TICKS = HZ * 6;
const MANUAL_EXPERIMENT = 'manual-transfer-p0';
const closeRate = (a, b) => Math.abs(a - b) < .05;
const rateText = rate => Number(rate.toFixed(1)).toString();
const transportMode = view => view.transfer?.enabled || view.state.experiment === MANUAL_EXPERIMENT
  ? MANUAL_EXPERIMENT : 'legacy-auto';
const configurationKey = (machine, levels, transport) => [transport, machine, ...IDS.map(id => levels[id])].join(':');
const transferId = transfer => transfer.source === 'pop' ? 'A' : 'B';
const profileRules = view => view.state.economyProfile === 'legacy' ? CONFIG : CONFIG.automation;

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

  _predict(machine, levels, transport) {
    const key = configurationKey(machine, levels, transport);
    if (this.cache.has(key)) return this.cache.get(key);
    // P0 leaves A manual at every available device level. Without any future
    // input commands its finite stock can only drain, so the unattended steady
    // rate is exactly zero. A device upgrade cannot reconnect that edge. This
    // also avoids simulating later machine stages that P0 does not support.
    if (transport === MANUAL_EXPERIMENT) {
      const result = Object.freeze({ rate: 0 });
      if (this.cache.size >= 80) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, result);
      return result;
    }
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

  _automationKey(view, changes = {}) {
    const s = view.state;
    return JSON.stringify({ mode: view.mode, profile: s.economyProfile,
      machine: changes.machine ?? s.machine, levels: changes.levels || s.upgrades,
      logisticsLevel: changes.logisticsLevel ?? s.logisticsLevel,
      buffers: view.buffers.map(buffer => [buffer.id, buffer.capacity]),
      transfers: view.transfers.map(transfer => [transfer.source,
        transfer.automated || changes.automatedSource === transfer.source,
        transfer.batchSize, transfer.inputCapacity, transfer.transportCycleTicks, transfer.transportCapacity]) });
  }

  _predictAutomation(view, changes = {}) {
    const key = this._automationKey(view, changes);
    if (this.cache.has(key)) return this.cache.get(key);
    let rate = 0;
    if (view.transfers.every(transfer => transfer.automated || changes.automatedSource === transfer.source)) {
      // Reset inventory, histories and manual actions in a private factory. The
      // economy profile preserves existing factories' original machine levels.
      const seed = new Game({ mode: 'v15', now: 0 }).getView().state;
      const rules = profileRules(view);
      seed.economyProfile = view.state.economyProfile;
      seed.machine = changes.machine ?? view.state.machine;
      seed.logisticsLevel = changes.logisticsLevel ?? view.state.logisticsLevel;
      seed.totalProduced = 0;
      const levels = changes.levels || view.state.upgrades;
      for (const id of IDS) {
        seed.upgrades[id] = levels[id];
        seed.stations[id] = { jobs: Array(rules.stations[id].levels[levels[id]].lanes).fill(null), processed: 0, history: [] };
      }
      for (const transfer of view.transfers) {
        seed.connections[transfer.source].automated = true;
        seed.connections[transfer.source].automatedAtTick = 0;
      }
      const copy = new Game({ mode: 'v15', save: seed, now: 0 });
      // Transport cycles join actual batches and finite entrance/store capacity
      // in this simulation; min(device rates) alone would overpromise output.
      copy.tick(24);
      let before = copy.state.totalSold;
      copy.tick(24);
      const firstRate = (copy.state.totalSold - before) / 24;
      before = copy.state.totalSold;
      copy.tick(24);
      rate = (copy.state.totalSold - before) / 24;
      if (!closeRate(rate, firstRate)) {
        before = copy.state.totalSold;
        copy.tick(48);
        rate = (copy.state.totalSold - before) / 48;
      }
    }
    const result = Object.freeze({ rate: Math.round(rate * 1000) / 1000 });
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
      const upgraded = !first && this.previousLevels && (IDS.some(id => view.state.upgrades[id] !== this.previousLevels[id])
        || view.mode === 'v15');
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

  _manualBottleneck(view) {
    const processing = view.state.inputs.cup > 0 || view.state.buffers.cup > 0
      || view.stations.some(station => station.id !== 'pop' && station.inFlight > 0);
    const waitingForPop = !processing && view.state.buffers.pop === 0;
    return {
      stationId: null, predictedStationId: null, stationIds: [], transportId: 'A', status: 'transport',
      forecastLabel: 'A 段需要手动补料 · 无人操作基线0份/秒',
      label: processing ? '本批加工中 · 后续仍需手动补料' : waitingForPop ? '等待爆锅供料' : '等待手动补料',
      reason: processing
        ? '已投送的货物正经过装杯和出货；本批处理完后仍需手动补料，设备改造不会接通自动运输。'
        : '将待装仓的货物送入装杯进料口；等待补料属于运输限制，设备改造不会接通自动运输。'
    };
  }

  _automationBottleneck(view, stableRate) {
    const manual = view.transfers.filter(transfer => !transfer.automated);
    if (manual.length) {
      const ready = [...manual].reverse().find(transfer => transfer.receivableAmount > 0);
      const ids = manual.map(transferId), names = ids.join('、');
      const processing = view.state.inputs.ship > 0 || view.stations.find(station => station.id === 'ship').inFlight > 0;
      return { stationId: null, predictedStationId: null, stationIds: [], transportId: transferId(ready || manual[0]),
        transportIds: ids, status: 'transport', kind: 'manual',
        forecastLabel: `${names} 段尚需手动运输 · 自动运行基线0份/秒`,
        label: ready ? `${transferId(ready)} 段等待手动${ready.source === 'pop' ? '补料' : '发货'}`
          : processing ? '本批出货中 · 后续仍需搬运' : '等待上游加工 · 后续需搬运',
        reason: `${names} 段尚未自动接通。${ready ? `把${ready.source === 'pop' ? '待装仓' : '待发仓'}的一批货物送入${ready.target === 'cup' ? '装杯' : '出货'}进料口；` : ''}停止搬运后有限库存会耗尽，自动运行基线为0；设备改造只提高处理能力。` };
    }
    const processingCapacity = Math.min(...view.stations.map(station => station.capacity));
    const transportCapacity = Math.min(...view.transfers.map(transfer => transfer.transportCapacity));
    if (transportCapacity < processingCapacity - .05) {
      const limiting = view.transfers.filter(transfer => closeRate(transfer.transportCapacity, transportCapacity));
      const ids = limiting.map(transferId), names = ids.join('、');
      return { stationId: null, predictedStationId: null, stationIds: [], transportId: ids[0], transportIds: ids,
        status: 'transport', kind: 'capacity', label: `${names} 段运输能力限制出货`,
        forecastLabel: `自动转运限制 · 稳定约${rateText(stableRate)}份/秒`,
        reason: `${names} 段每秒最多转运${rateText(transportCapacity)}份，低于设备处理能力；增大整盘与入口容量可减少运输限制，单独提高设备能力可能暂不提速。` };
    }
    return { ...this._bottleneck(view, stableRate), kind: 'processing', transportIds: [] };
  }

  _enrichAutomation(view) {
    const s = view.state, rules = profileRules(view);
    const key = this._automationKey(view);
    const stableRate = this._predictAutomation(view).rate;
    const sampled = this._observe(view, key);
    const manualTransfer = view.transfers.some(transfer => !transfer.automated);
    if (manualTransfer || sampled || !this.lastBottleneck) this.lastBottleneck = this._automationBottleneck(view, stableRate);
    const stations = view.stations.map(station => {
      if (!station.upgrade) return { ...station, upgrade: null };
      const upgrade = station.upgrade;
      const predictionMachine = Math.max(s.machine, upgrade.requiredMachine);
      const lineAfter = this._predictAutomation(view, { machine: predictionMachine,
        levels: { ...s.upgrades, [station.id]: station.level + 1 } }).rate;
      const lineImproves = lineAfter > stableRate + .05;
      return { ...station, upgrade: { ...upgrade,
        capacityBefore: station.capacity, capacityAfter: upgrade.capacity,
        lineBefore: stableRate, lineAfter, lineImproves, lineRequiresExpansion: predictionMachine > s.machine,
        lineMessage: manualTransfer ? '提高设备处理能力，不接通自动运输；自动运行基线仍为0份/秒'
          : lineImproves ? `预计自动稳定出货约${rateText(stableRate)}→${rateText(lineAfter)}份/秒`
            : '暂不提高自动稳定出货，为后续改造预留能力' } };
    });
    const transfers = view.transfers.map(transfer => {
      if (!transfer.automation) return { ...transfer };
      const lineAfter = this._predictAutomation(view, { automatedSource: transfer.source }).rate;
      return { ...transfer, automation: { ...transfer.automation,
        lineBefore: stableRate, lineAfter, lineImproves: lineAfter > stableRate + .05,
        lineMessage: lineAfter > 0 ? `永久少搬这一段；接通后自动稳定出货约${rateText(lineAfter)}份/秒`
          : '永久少搬这一段；另一段仍需手动，自动运行基线仍为0份/秒' } };
    });
    let logisticsUpgrade = null;
    if (view.logisticsUpgrade) {
      const predictionMachine = Math.max(s.machine, view.logisticsUpgrade.requiredMachine);
      const lineAfter = this._predictAutomation(view, { machine: predictionMachine, logisticsLevel: s.logisticsLevel + 1 }).rate;
      logisticsUpgrade = { ...view.logisticsUpgrade, lineBefore: stableRate, lineAfter,
        lineImproves: lineAfter > stableRate + .05,
        lineMessage: lineAfter > stableRate + .05 ? `缓解运输限制；自动稳定出货约${rateText(stableRate)}→${rateText(lineAfter)}份/秒`
          : '增大整盘、入口与仓容，减少补料频率；暂不提高自动稳定出货' };
    }
    const nextMachine = rules.machines[s.machine + 1];
    const expansion = view.expansion && nextMachine ? { ...view.expansion,
      bufferChanges: view.buffers.map(buffer => ({ id: buffer.id, name: buffer.id === 'pop' ? '待装仓' : '待发仓',
        before: buffer.capacity, after: Math.max(buffer.capacity, nextMachine.buffers[buffer.id]) })),
      unlocks: IDS.flatMap(id => rules.stations[id].levels.filter(level => level.requiredMachine === s.machine + 1)
        .map(level => ({ stationId: id, stationName: rules.stations[id].name, name: level.name }))),
      lineBefore: stableRate, lineAfter: this._predictAutomation(view, { machine: s.machine + 1 }).rate,
      note: '已购自动转运持续生效；完成无人干预试运行与真实销售目标后扩建，设备改造另行购买' } : null;
    const tick = s.simulation.ticks;
    const secondsSinceUpgrade = this.lastUpgradeTick === null ? Infinity : Math.max(0, tick - this.lastUpgradeTick) / HZ;
    const updating = secondsSinceUpgrade < CONFIG.rateWindowSeconds;
    const warming = s.playedSeconds < CONFIG.rateWindowSeconds;
    const includesManualInput = manualTransfer || Object.values(s.connections).some(connection =>
      Number.isInteger(connection.lastManualTransferTick) && connection.lastManualTransferTick > tick - CONFIG.rateWindowSeconds * HZ);
    return { ...view, stations, transfers, logisticsUpgrade, expansion, insights: {
      stableRate, stableRateLabel: '自动运行基线', manualTransfer,
      previewMethod: '按当前运输接通状态、整盘批量、运输周期、入口与仓容，在隔离空工厂推演自动稳定出货；实测包含最近手动送料和库存释放。',
      bottleneck: { ...this.lastBottleneck, stationIds: [...this.lastBottleneck.stationIds], transportIds: [...this.lastBottleneck.transportIds] },
      sampling: { windowSeconds: CONFIG.rateWindowSeconds, updating, warming, includesManualInput,
        label: `${warming ? '实测不足10秒' : '近10秒实测'}${includesManualInput ? ' · 含手动搬运' : ' · 自动运行'}${updating ? ' · 更新中' : ''}`,
        secondsUntilSettled: updating ? Math.ceil(CONFIG.rateWindowSeconds - secondsSinceUpgrade) : 0 }
    } };
  }

  enrich(view) {
    if (view.mode === 'v15') return this._enrichAutomation(view);
    const levels = view.state.upgrades;
    const machine = view.state.machine;
    const transport = transportMode(view);
    const manualTransfer = transport === MANUAL_EXPERIMENT;
    const key = configurationKey(machine, levels, transport);
    const stableRate = this._predict(machine, levels, transport).rate;
    const sampled = this._observe(view, key);
    // A committed transfer changes the explanation immediately, even when it
    // happens between production samples or at the same simulation tick.
    if (manualTransfer) this.lastBottleneck = this._manualBottleneck(view);
    else if (sampled || !this.lastBottleneck) this.lastBottleneck = this._bottleneck(view, stableRate);
    const stations = view.stations.map(station => {
      if (!station.upgrade) return { ...station, upgrade: null };
      const upgrade = station.upgrade;
      const nextLevels = { ...levels, [station.id]: station.level + 1 };
      const predictionMachine = Math.max(machine, upgrade.requiredMachine);
      const lineAfter = this._predict(predictionMachine, nextLevels, transport).rate;
      const lineImproves = lineAfter - stableRate > .05;
      return { ...station, upgrade: { ...upgrade,
        capacityBefore: station.capacity, capacityAfter: upgrade.capacity,
        lineBefore: stableRate, lineAfter, lineImproves,
        lineRequiresExpansion: predictionMachine > machine,
        lineMessage: manualTransfer ? '仅提高设备处理能力，不接通自动运输；无人操作基线仍为0份/秒' : lineImproves
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
      note: manualTransfer ? 'P0 验证手动补料，扩建与自动化尚未开放' : '扩建开放改造，设备提速需另行购买'
    } : null;
    const tick = view.state.simulation.ticks;
    const secondsSinceUpgrade = this.lastUpgradeTick === null ? Infinity : Math.max(0, tick - this.lastUpgradeTick) / HZ;
    const updating = secondsSinceUpgrade < CONFIG.rateWindowSeconds;
    const warming = view.state.playedSeconds < CONFIG.rateWindowSeconds;
    return { ...view, stations, expansion, insights: {
      stableRate,
      stableRateLabel: manualTransfer ? '无人操作基线' : '整线稳定出货',
      manualTransfer,
      previewMethod: manualTransfer
        ? 'A 段需要手动转运；停止投料后有限库存会耗尽，因此无人操作基线为0。实测出货包含已经手动投送的货物。'
        : '按真实批次、并行工作头及有限仓位，在隔离工厂预热后推演稳定出货；不含积压库存的短时释放。',
      bottleneck: { ...this.lastBottleneck, stationIds: [...this.lastBottleneck.stationIds] },
      sampling: { windowSeconds: CONFIG.rateWindowSeconds, updating, warming,
        includesManualInput: manualTransfer,
        label: manualTransfer
          ? warming ? '实测含手动搬运 · 不足10秒' : updating ? '近10秒实测含手动搬运 · 更新中' : '近10秒实测 · 含手动搬运'
          : updating ? '近10秒实测 · 均速更新中' : warming ? '实测均速 · 开工不足10秒' : '近10秒实测均速',
        secondsUntilSettled: updating ? Math.ceil(CONFIG.rateWindowSeconds - secondsSinceUpgrade) : 0 }
    } };
  }
}

module.exports = { ProductionInsights };
