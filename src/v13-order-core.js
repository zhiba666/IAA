'use strict';
const { Game, CONFIG } = require('./core');
const { MODE, SAVE_KEY, SAVE_VERSION } = require('./v13-order-mode');
const { ORDER_RULES } = require('./order-rules');

const DELIVERY_BATCH = ORDER_RULES.deliveryBatch;
const MAX_ORDERS = 1000000;
const MAX_TICKS = 1000000000;
const MAX_TOTAL = 1000000000;
const MAX_SAVE_BYTES = 250000;
const TEMPLATES = ORDER_RULES.templates;
const clone = value => JSON.parse(JSON.stringify(value));
const fail = reason => ({ ok: false, reason });
const whole = (value, max = MAX_TOTAL) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const timestamp = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const productMap = (value, max) => value && Object.keys(value).length === 1
  && Object.prototype.hasOwnProperty.call(value, 'original') && whole(value.original, max);
let nextHoldId = 0;

function freshCommerce() {
  return {
    stock: { original: 0 }, orders: [], nextOrderId: 1,
    baseline: null, purchases: [], salesperson: { owned: false, remainingTicks: ORDER_RULES.salesperson.serviceTicks },
    assists: Object.fromEntries(CONFIG.stationIds.map(id => [id, { lastTick: null, windowTick: 0, usedTicks: 0 }])),
    ledger: { completed: 0, cancelled: 0, sold: 0, earned: 0,
      buckets: TEMPLATES.map(() => ({ settled: 0, cancelled: 0 })) }
  };
}

// The shared factory owns one clock and legal production batches. Commerce owns
// finished inventory, customer reservations, and atomic whole-order settlement.
class V13OrderGame {
  constructor({ save = null, now = Date.now() } = {}) {
    this.mode = MODE;
    this.now = timestamp(now) ? now : Date.now();
    this.events = [];
    this.loadWarning = null;
    this._deliveryHold = null;
    this._commerce = freshCommerce();
    const finishedGoods = {
      rules: ORDER_RULES,
      canStart: (amount, state) => this._canStart(amount, state),
      afterTick: state => this._afterTick(state),
      canAccept: (amount, state) => this._commerce.stock.original + amount <= this._finishedCapacity(state),
      accept: (amount, state) => {
        this._commerce.stock.original += amount;
        this.events.push({ type: 'packaging', productId: 'original', amount,
          first: state.stations.ship.processed === 0, playedSeconds: state.playedSeconds });
      },
      validateLedger: state => this._validateFactoryLedger(state)
    };
    let factorySave = null;
    if (save !== null && save !== undefined) {
      try {
        if (typeof save === 'string' && save.length > MAX_SAVE_BYTES) throw new Error('save-size');
        let data = typeof save === 'string' ? JSON.parse(save) : save;
        if (data && data.mode === 'v13-orders-p0' && data.version === 1) data = upgradePrototype(data);
        this._commerce = this._validateCommerce(data);
        factorySave = data.factory;
        const factory = new Game({ save: factorySave, now: this.now, mode: 'v15', finishedGoods });
        if (factory.loadWarning) throw new Error('factory-save');
        this._factory = factory;
      } catch (error) {
        this.loadWarning = '经营存档校验失败，原存档保留；当前临时工厂不可覆盖原数据。';
        this._commerce = freshCommerce();
        factorySave = null;
      }
    }
    if (!this._factory) this._factory = new Game({ now: this.now, mode: 'v15', finishedGoods });
    this._fillOrders();
  }

  get state() { return this._factory.state; }
  _finishedCapacity(state = this.state) {
    const level = ORDER_RULES.logisticsLevels[state.logisticsLevel];
    return level ? level.finishedCapacity : 0;
  }

  _validateCommerce(data) {
    if (!data || data.mode !== MODE || data.version !== SAVE_VERSION || !timestamp(data.savedAt)) throw new Error('save-format');
    const raw = data.commerce, factory = data.factory;
    if (!raw || !factory || factory.mode !== 'v15' || factory.version !== CONFIG.automation.version
      || !['fresh', 'legacy'].includes(factory.economyProfile) || !timestamp(factory.savedAt)
      || !factory.simulation || !whole(factory.simulation.ticks, MAX_TICKS)
      || !['coins', 'totalProduced', 'totalSold', 'totalEarned', 'totalSpent'].every(key => whole(factory[key]))
      || !productMap(raw.stock, this._finishedCapacity(factory)) || !whole(raw.nextOrderId, MAX_ORDERS + 1) || raw.nextOrderId < 2
      || !Array.isArray(raw.orders) || raw.orders.length > ORDER_RULES.maxOrders) throw new Error('unsupported-state');
    if (raw.baseline !== null) {
      if (!raw.baseline || raw.baseline.mode !== 'v15') throw new Error('baseline');
      const baseline = new Game({ save: raw.baseline, mode: 'v15', now: this.now });
      if (baseline.loadWarning) throw new Error('baseline');
      if (factory.economyProfile !== baseline.state.economyProfile) throw new Error('baseline-profile');
    } else if (factory.economyProfile !== 'fresh') throw new Error('baseline-profile');
    this._validatePurchases(raw, factory);
    if (!raw.salesperson || typeof raw.salesperson.owned !== 'boolean'
      || !whole(raw.salesperson.remainingTicks, ORDER_RULES.salesperson.serviceTicks)
      || raw.salesperson.remainingTicks < 1) throw new Error('salesperson');
    if (!raw.assists || CONFIG.stationIds.some(id => {
      const item = raw.assists[id];
      return !item || !(item.lastTick === null || whole(item.lastTick, factory.simulation.ticks))
        || !whole(item.windowTick, factory.simulation.ticks) || item.windowTick % ORDER_RULES.assist.windowTicks !== 0
        || !whole(item.usedTicks, ORDER_RULES.assist.maxExtraTicks)
        || (item.lastTick === null && item.usedTicks !== 0);
    })) throw new Error('assist');

    const ledger = raw.ledger;
    if (!ledger || !['completed', 'cancelled', 'sold', 'earned'].every(key => whole(ledger[key]))
      || !Array.isArray(ledger.buckets) || ledger.buckets.length !== TEMPLATES.length) throw new Error('ledger');
    const buckets = ledger.buckets.map(bucket => {
      if (!bucket || !whole(bucket.settled, MAX_ORDERS) || !whole(bucket.cancelled, MAX_ORDERS)) throw new Error('ledger-bucket');
      return { settled: bucket.settled, cancelled: bucket.cancelled };
    });
    let completed = 0, cancelled = 0, sold = 0, earned = 0;
    buckets.forEach((bucket, index) => {
      completed += bucket.settled;
      cancelled += bucket.cancelled;
      sold += bucket.settled * TEMPLATES[index].amount;
      earned += bucket.settled * TEMPLATES[index].quote;
    });
    if (completed !== ledger.completed || cancelled !== ledger.cancelled || sold !== ledger.sold || earned !== ledger.earned)
      throw new Error('ledger-totals');
    const pendingBuckets = TEMPLATES.map(() => 0), ids = new Set();
    let reserved = 0;
    const orders = raw.orders.map(order => {
      if (!order || !whole(order.sequence, MAX_ORDERS) || order.sequence < 1 || order.sequence >= raw.nextOrderId
        || order.id !== `v13-order-${order.sequence}` || ids.has(order.id)
        || !whole(order.createdAtTick, factory.simulation.ticks)) throw new Error('order-id');
      const index = (order.sequence - 1) % TEMPLATES.length, template = TEMPLATES[index];
      if (!productMap(order.items, template.amount) || order.items.original !== template.amount
        || !productMap(order.reserved, template.amount - 1) || order.quote !== template.quote
        || order.status !== (order.reserved.original ? 'partial' : 'pending')
        || ![null, 'manual', 'salesperson'].includes(order.assignedTo)
        || (order.reserved.original > 0 && order.assignedTo === null)
        || (order.assignedTo === 'salesperson' && !raw.salesperson.owned)) throw new Error('order-lines');
      ids.add(order.id);
      pendingBuckets[index]++;
      reserved += order.reserved.original;
      return { id: order.id, sequence: order.sequence, items: { original: template.amount },
        reserved: { original: order.reserved.original }, quote: template.quote,
        createdAtTick: order.createdAtTick, status: order.status, assignedTo: order.assignedTo };
    });
    const created = raw.nextOrderId - 1;
    if (reserved > raw.stock.original || created !== completed + cancelled + orders.length
      || orders.length > (completed ? ORDER_RULES.maxOrders : 1)) throw new Error('reservation-conservation');
    for (let index = 0; index < TEMPLATES.length; index++) {
      const generated = Math.floor((created + TEMPLATES.length - 1 - index) / TEMPLATES.length);
      if (generated !== buckets[index].settled + buckets[index].cancelled + pendingBuckets[index]) throw new Error('order-ledger');
    }
    if (created < MAX_ORDERS && orders.length !== (completed ? ORDER_RULES.maxOrders : 1)) throw new Error('missing-order');
    return { stock: { original: raw.stock.original }, orders, nextOrderId: raw.nextOrderId,
      ledger: { completed, cancelled, sold, earned, buckets }, baseline: clone(raw.baseline), purchases: clone(raw.purchases),
      salesperson: clone(raw.salesperson), assists: clone(raw.assists) };
  }

  _validateFactoryLedger(state) {
    const commerce = this._commerce, base = commerce.baseline;
    return state.totalSold === commerce.ledger.sold + (base ? base.totalSold : 0)
      && state.totalEarned === commerce.ledger.earned + (base ? base.totalEarned : 0)
      && state.totalSpent === commerce.purchases.reduce((sum, purchase) => sum + purchase.cost, base ? base.totalSpent : 0)
      && state.coins + state.totalSpent === state.totalEarned
      && state.stations.ship.processed === commerce.stock.original + state.totalSold;
  }

  _validatePurchases(raw, factory) {
    if (!Array.isArray(raw.purchases) || raw.purchases.length > 64) throw new Error('purchases');
    const base = raw.baseline;
    const levels = base ? { ...base.upgrades } : { pop: 0, cup: 0, ship: 0 };
    let machine = base ? base.machine : 0, logistics = base ? base.logisticsLevel : 0;
    const automated = Object.fromEntries(['pop', 'cup'].map(id => [id, !!(base && base.connections[id].automated)]));
    let salesperson = !!(base && Object.values(base.connections).every(route => route.automated));
    for (const purchase of raw.purchases) {
      if (!purchase || !whole(purchase.cost) || !whole(purchase.tick, factory.simulation.ticks)) throw new Error('purchase');
      let offer;
      if (purchase.kind === 'upgrade' && CONFIG.stationIds.includes(purchase.id)) {
        offer = ORDER_RULES.stations[factory.economyProfile][purchase.id].levels[++levels[purchase.id]];
      } else if (purchase.kind === 'automation' && ['pop', 'cup'].includes(purchase.id) && !automated[purchase.id]) {
        offer = ORDER_RULES.automation[purchase.id]; automated[purchase.id] = true;
      } else if (purchase.kind === 'logistics') offer = ORDER_RULES.logisticsLevels[++logistics];
      else if (purchase.kind === 'expansion') offer = ORDER_RULES.machines[++machine];
      else if (purchase.kind === 'salesperson' && !salesperson) { offer = ORDER_RULES.salesperson; salesperson = true; }
      else throw new Error('purchase-kind');
      if (!offer || purchase.cost !== offer.cost || (offer.requiredMachine || 0) > machine) throw new Error('purchase-price');
    }
    if (machine !== factory.machine || logistics !== factory.logisticsLevel
      || CONFIG.stationIds.some(id => levels[id] !== factory.upgrades[id])
      || ['pop', 'cup'].some(id => !factory.connections[id] || automated[id] !== factory.connections[id].automated)
      || !raw.salesperson || salesperson !== raw.salesperson.owned) throw new Error('purchase-state');
  }

  _fillOrders() {
    const commerce = this._commerce, limit = commerce.ledger.completed ? ORDER_RULES.maxOrders : 1;
    while (commerce.orders.length < limit && commerce.nextOrderId <= MAX_ORDERS) {
      const sequence = commerce.nextOrderId++, template = TEMPLATES[(sequence - 1) % TEMPLATES.length];
      commerce.orders.push({ id: `v13-order-${sequence}`, sequence, items: { original: template.amount },
        reserved: { original: 0 }, quote: template.quote, status: 'pending', assignedTo: null, createdAtTick: this.state.simulation.ticks });
    }
  }

  _reserved() { return this._commerce.orders.reduce((sum, order) => sum + order.reserved.original, 0); }
  _available() { return this._commerce.stock.original - this._reserved() - (this._deliveryHold ? this._deliveryHold.amount : 0); }

  tick(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > 60
      || this.state.simulation.ticks + Math.ceil(seconds * CONFIG.ticksPerSecond) > MAX_TICKS) return fail('invalid-time');
    const before = this.state.stations.ship.processed;
    const result = this._factory.tick(seconds);
    return { ...result, packaged: this.state.stations.ship.processed - before };
  }

  reserveTransfer(source = 'pop') { return this._factory.reserveTransfer(source); }
  beginTransfer(source = 'pop') { return this.reserveTransfer(source); }
  commitTransfer(token, target) {
    if (target !== undefined) {
      const reservation = [...this._factory._transferReservations.values()].find(item => item.token === token);
      if (!reservation) return fail('invalid-transfer');
      if (reservation.target !== target) { this._factory.cancelTransfer(token); return fail('invalid-target'); }
    }
    return this._factory.commitTransfer(token);
  }
  cancelTransfer(token) { return this._factory.cancelTransfer(token); }

  beginDelivery(productId = 'original') {
    if (productId !== 'original') return fail('invalid-product');
    if (this._deliveryHold) return fail('delivery-pending');
    const amount = Math.min(DELIVERY_BATCH, this._available());
    if (amount <= 0) return fail('source-empty');
    this._deliveryHold = { token: `v13-delivery-${++nextHoldId}`, productId, amount };
    return { ok: true, ...this._deliveryHold };
  }

  deliver(token, orderId) {
    const hold = this._deliveryHold;
    if (!hold || hold.token !== token) return fail('invalid-delivery');
    this._deliveryHold = null;
    return this._allocate(orderId, hold.amount, 'manual');
  }

  _allocate(orderId, limit, actor) {
    const commerce = this._commerce, index = commerce.orders.findIndex(order => order.id === orderId);
    if (index < 0) return fail('invalid-order');
    const order = commerce.orders[index];
    if (actor === 'salesperson' && order.assignedTo === 'manual') return fail('manual-reservation');
    const amount = Math.min(limit, order.items.original - order.reserved.original, this._available());
    if (amount <= 0) return fail('order-filled');
    order.reserved.original += amount;
    order.status = 'partial';
    order.assignedTo = actor;
    const settled = Object.keys(order.items).every(product => order.reserved[product] === order.items[product]);
    this.events.push({ type: 'order-reserved', orderId, productId: 'original', amount });
    if (settled) {
      // Every line, inventory, historical counts, money, and removal commit in
      // the same synchronous command. No rendering callback can settle an ID.
      const quantity = order.items.original, quote = order.quote;
      commerce.stock.original -= quantity;
      commerce.ledger.completed++;
      commerce.ledger.sold += quantity;
      commerce.ledger.earned += quote;
      commerce.ledger.buckets[(order.sequence - 1) % TEMPLATES.length].settled++;
      this.state.totalSold += quantity;
      this.state.totalEarned += quote;
      this.state.coins += quote;
      commerce.orders.splice(index, 1);
      this.events.push({ type: 'order-settled', orderId, amount: quantity, coins: quote, quote,
        first: commerce.ledger.completed === 1, playedSeconds: this.state.playedSeconds });
      this._fillOrders();
      this._factory._settle();
    }
    return { ok: true, orderId, amount, remaining: limit - amount, settled, coins: settled ? order.quote : 0 };
  }

  cancelDelivery(token) {
    const hold = this._deliveryHold;
    if (!hold || token !== undefined && token !== hold.token) return { ok: true, amount: 0 };
    this._deliveryHold = null;
    return { ok: true, amount: hold.amount };
  }

  cancelOrder(orderId) {
    const commerce = this._commerce, index = commerce.orders.findIndex(order => order.id === orderId);
    if (index < 0) return fail('invalid-order');
    const order = commerce.orders[index];
    commerce.ledger.cancelled++;
    commerce.ledger.buckets[(order.sequence - 1) % TEMPLATES.length].cancelled++;
    commerce.orders.splice(index, 1);
    this._fillOrders();
    this.events.push({ type: 'order-cancelled', orderId, amount: order.reserved.original });
    return { ok: true, orderId, amount: order.reserved.original };
  }

  _purchase(kind, id, command) {
    const result = command();
    if (result.ok) this._commerce.purchases.push({ kind, id, cost: result.cost, tick: this.state.simulation.ticks });
    return result;
  }
  buyUpgrade(id) { return this._purchase('upgrade', id, () => this._factory.buyUpgrade(id)); }
  buyAutomation(source = 'pop') { return this._purchase('automation', source, () => this._factory.buyAutomation(source)); }
  buyLogisticsUpgrade() { return this._purchase('logistics', null, () => this._factory.buyLogisticsUpgrade()); }
  evolve() { return this._purchase('expansion', null, () => this._factory.evolve()); }
  _salespersonOffer() {
    const worker = this._commerce.salesperson, rule = ORDER_RULES.salesperson;
    const reason = worker.owned ? 'already-purchased' : this.state.coins < rule.cost ? 'not-enough-coins' : '';
    return { ...worker, cost: rule.cost, available: !reason, reason,
      serviceSeconds: rule.serviceTicks / CONFIG.ticksPerSecond,
      remainingSeconds: worker.remainingTicks / CONFIG.ticksPerSecond };
  }
  buySalesperson() {
    const offer = this._salespersonOffer();
    if (!offer.available) return fail(offer.reason);
    return this._purchase('salesperson', null, () => {
      this.state.coins -= offer.cost; this.state.totalSpent += offer.cost;
      this._commerce.salesperson.owned = true;
      this.events.push({ type: 'salesperson', cost: offer.cost });
      return { ok: true, cost: offer.cost };
    });
  }
  handoffOrder(orderId) {
    if (!this._commerce.salesperson.owned) return fail('salesperson-required');
    const order = this._commerce.orders.find(item => item.id === orderId);
    if (!order) return fail('invalid-order');
    order.assignedTo = 'salesperson';
    return { ok: true, orderId };
  }
  _afterTick(state) {
    const worker = this._commerce.salesperson;
    if (!worker.owned) return;
    if (--worker.remainingTicks > 0) return;
    worker.remainingTicks = ORDER_RULES.salesperson.serviceTicks;
    const available = this._available(), serviceAvailable = Math.min(available, ORDER_RULES.salesperson.batch);
    const orders = this._commerce.orders.filter(order => order.assignedTo !== 'manual').slice().sort((a, b) => {
      const missingA = a.items.original - a.reserved.original, missingB = b.items.original - b.reserved.original;
      return Number(missingB <= serviceAvailable) - Number(missingA <= serviceAvailable)
        || a.createdAtTick - b.createdAtTick || a.sequence - b.sequence;
    });
    if (orders.length && available > 0) this._allocate(orders[0].id, ORDER_RULES.salesperson.batch, 'salesperson');
  }
  _replenishment(state = this.state) {
    const reserved = this._reserved(), available = this._available();
    const capacity = this._finishedCapacity(state), targetStock = ORDER_RULES.logisticsLevels[state.logisticsLevel].targetStock;
    const inProgress = state.totalProduced - state.stations.ship.processed;
    const remainingDemand = this._commerce.orders.reduce((sum, order) => sum + order.items.original - order.reserved.original, 0);
    const held = this._deliveryHold ? this._deliveryHold.amount : 0;
    const deficit = Math.max(0, remainingDemand - available - held - inProgress);
    return { productId: 'original', available, reserved, inProgress, remainingDemand, deficit,
      targetStock, target: Math.min(capacity, reserved + Math.max(remainingDemand, targetStock)) };
  }
  _canStart(amount, state) {
    const plan = this._replenishment(state);
    return this._commerce.stock.original + plan.inProgress + amount <= plan.target;
  }
  _assistOffer(id) {
    if (!CONFIG.stationIds.includes(id)) return null;
    const rule = ORDER_RULES.assist, tracker = this._commerce.assists[id], tick = this.state.simulation.ticks;
    const jobs = this.state.stations[id].jobs.filter(job => job && job.remainingTicks > 0);
    const windowTick = Math.floor(tick / rule.windowTicks) * rule.windowTicks;
    const used = tracker.windowTick === windowTick ? tracker.usedTicks : 0;
    const progressTicks = jobs.length ? Math.min(rule.maxExtraTicks - used, rule.progressTicks) : 0;
    const reason = !jobs.length ? 'no-active-batch'
      : tracker.lastTick !== null && tick - tracker.lastTick < rule.intervalTicks ? 'assist-rate-limit'
      : progressTicks <= 0 ? 'assist-cap' : '';
    return { available: !reason, reason, progressTicks, minIntervalSeconds: rule.intervalTicks / CONFIG.ticksPerSecond,
      maxSpeedMultiplier: rule.maxSpeedMultiplier };
  }
  assist(id) {
    const offer = this._assistOffer(id);
    if (!offer) return fail('invalid-station');
    if (!offer.available) return fail(offer.reason);
    const rule = ORDER_RULES.assist, tracker = this._commerce.assists[id], tick = this.state.simulation.ticks;
    const windowTick = Math.floor(tick / rule.windowTicks) * rule.windowTicks;
    if (tracker.windowTick !== windowTick) { tracker.windowTick = windowTick; tracker.usedTicks = 0; }
    let applied = 0;
    for (const job of this.state.stations[id].jobs) if (job && job.remainingTicks > 0) {
      const amount = Math.min(offer.progressTicks, job.remainingTicks);
      job.remainingTicks -= amount; applied = Math.max(applied, amount);
    }
    tracker.lastTick = tick; tracker.usedTicks += applied;
    this._factory._settle();
    this.events.push({ type: 'assist', stationId: id, progressTicks: applied });
    return { ok: true, stationId: id, progressTicks: applied };
  }
  _forecast(capacities) {
    const quantity = TEMPLATES.reduce((sum, template) => sum + template.amount, 0);
    const revenue = TEMPLATES.reduce((sum, template) => sum + template.quote, 0);
    const serviceSeconds = TEMPLATES.reduce((sum, template) => sum + Math.ceil(template.amount / ORDER_RULES.salesperson.batch), 0)
      * ORDER_RULES.salesperson.serviceTicks / CONFIG.ticksPerSecond;
    const processingCapacity = Math.min(...capacities);
    const salespersonCapacity = quantity / serviceSeconds;
    const automated = this._commerce.salesperson.owned && Object.values(this.state.connections).every(route => route.automated);
    const transportCapacity = this.state.economyProfile === 'legacy' ? Infinity
      : this._factory._logisticsSpec().transferBatch * CONFIG.ticksPerSecond / CONFIG.automation.transportCycleTicks;
    const automaticCapacity = automated ? Math.min(processingCapacity, salespersonCapacity, transportCapacity) : 0;
    return { processingCapacity, salespersonCapacity, automaticCapacity,
      revenueUpperBound: automaticCapacity * revenue / quantity, kind: 'unattended-upper-bound' };
  }
  setSetting(key, value) { return this._factory.setSetting(key, value); }
  acknowledgeIntro() { return this._factory.acknowledgeIntro(); }

  getView() {
    const view = this._factory.getView(), commerce = this._commerce;
    view.mode = MODE;
    view.state.mode = MODE;
    view.stations.forEach(station => { station.assist = this._assistOffer(station.id); if (station.id === 'ship') station.name = '包装入库'; });
    view.salesperson = this._salespersonOffer();
    view.replenishment = this._replenishment();
    view.forecast = this._forecast(view.stations.map(station => station.capacity));
    view.stations.forEach((station, index) => {
      if (station.upgrade) station.upgrade.forecast = { before: view.forecast,
        after: this._forecast(view.stations.map((other, otherIndex) => otherIndex === index ? station.upgrade.capacity : other.capacity)) };
    });
    view.accounting = { openingBalance: commerce.baseline ? commerce.baseline.coins : 0,
      historicalEarned: commerce.baseline ? commerce.baseline.totalEarned : 0,
      historicalSpent: commerce.baseline ? commerce.baseline.totalSpent : 0, compensation: 0 };
    if (view.expansion) view.expansion.targetRate = 0;
    view.transfer = view.transfers[0];
    view.finished = { capacity: this._finishedCapacity(), stock: { ...commerce.stock }, reserved: { original: this._reserved() },
      held: { original: this._deliveryHold ? this._deliveryHold.amount : 0 }, available: { original: this._available() }, deliveryBatch: DELIVERY_BATCH };
    view.orders = clone(commerce.orders);
    view.orderLedger = clone(commerce.ledger);
    view.delivery = this._deliveryHold ? { ...this._deliveryHold } : null;
    view.loadWarning = this.loadWarning;
    const missingTransfer = view.transfers.find(transfer => !transfer.manualTransfers && !transfer.automated);
    view.onboarding = missingTransfer ? { phase: 'transfer', source: missingTransfer.source,
      stationId: missingTransfer.target, hint: missingTransfer.source === 'pop' ? '把待装仓的一盘送进装杯口' : '把待包仓的一盘送进包装口，成品会自动进入货架' }
      : commerce.ledger.completed === 0 ? { phase: 'delivery', stationId: null,
        hint: commerce.stock.original ? '前往场外，把原味杯拖给顾客；整单配齐才收款' : '等待包装入库，再到场外交付首单' }
      : { phase: 'orders', stationId: null, hint: '继续生产原味杯，选择顾客配货；部分配货会保留，整单配齐才收款' };
    return view;
  }

  drainEvents() {
    const events = this._factory.drainEvents().concat(this.events);
    this.events = [];
    return events;
  }

  exportSave(now = Date.now()) {
    this.cancelDelivery();
    const savedAt = timestamp(now) ? now : Date.now();
    return { version: SAVE_VERSION, mode: MODE, savedAt,
      factory: this._factory.exportSave(savedAt), commerce: clone(this._commerce) };
  }
}

function upgradePrototype(input) {
  const data = clone(input), factory = data.factory;
  if (!factory || factory.economyProfile !== 'fresh' || factory.machine !== 0 || factory.logisticsLevel !== 0
    || factory.totalSpent !== 0 || CONFIG.stationIds.some(id => factory.upgrades[id] !== 0)
    || ['pop', 'cup'].some(id => factory.connections[id].automated)
    || factory.milestones.some(Boolean) || factory.firstUpgradeAt !== null) throw new Error('prototype-state');
  const defaults = freshCommerce();
  data.mode = MODE; data.version = SAVE_VERSION;
  data.commerce = { ...data.commerce, baseline: null, purchases: [], salesperson: defaults.salesperson, assists: defaults.assists };
  for (const order of data.commerce.orders) order.assignedTo = order.reserved.original ? 'manual' : null;
  return data;
}

function migrateLegacySave(input, now = Date.now()) {
  try {
    if (typeof input === 'string' && input.length > MAX_SAVE_BYTES) throw new Error('save-size');
    const data = typeof input === 'string' ? JSON.parse(input) : clone(input);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('save-format');
    if (data && (data.mode === MODE || data.mode === 'v13-orders-p0')) {
      const migrated = new V13OrderGame({ save: data, now });
      if (migrated.loadWarning) throw new Error('order-save-invalid');
      return { ok: true, save: migrated.exportSave(now) };
    }
    const legacy = new Game({ save: data, mode: 'v15', now });
    if (legacy.loadWarning) throw new Error('legacy-save-invalid');
    const factory = legacy.exportSave(now), commerce = freshCommerce();
    commerce.baseline = clone(factory);
    commerce.salesperson.owned = Object.values(factory.connections).every(route => route.automated);
    commerce.nextOrderId = 2;
    commerce.orders = [{ id: 'v13-order-1', sequence: 1, items: { original: TEMPLATES[0].amount },
      reserved: { original: 0 }, quote: TEMPLATES[0].quote, status: 'pending', assignedTo: null,
      createdAtTick: factory.simulation.ticks }];
    const save = { mode: MODE, version: SAVE_VERSION, savedAt: timestamp(now) ? now : Date.now(), factory, commerce };
    const check = new V13OrderGame({ save, now });
    if (check.loadWarning) throw new Error('migration-validation');
    return { ok: true, save: check.exportSave(now) };
  } catch (error) { return { ok: false, reason: error.message || 'migration-failed' }; }
}

module.exports = { V13OrderGame, OrderGame: V13OrderGame, MODE, SAVE_KEY, SAVE_VERSION, ORDER_RULES, migrateLegacySave };
