'use strict';
const { Game, CONFIG } = require('./core');
const { MODE, SAVE_KEY, SAVE_VERSION } = require('./v13-order-mode');

const CAPACITY = 24;
const DELIVERY_BATCH = 4;
const MAX_ORDERS = 1000000;
const MAX_TICKS = 1000000000;
const MAX_TOTAL = 1000000000;
const MAX_SAVE_BYTES = 250000;
const TEMPLATES = Object.freeze([
  Object.freeze({ amount: 4, quote: 4 }), Object.freeze({ amount: 6, quote: 7 }),
  Object.freeze({ amount: 8, quote: 10 }), Object.freeze({ amount: 4, quote: 5 })
]);
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
    ledger: { completed: 0, cancelled: 0, sold: 0, earned: 0,
      buckets: TEMPLATES.map(() => ({ settled: 0, cancelled: 0 })) }
  };
}

// This wrapper is a deliberately isolated original-only P0. Factory jobs use
// the existing v15 clock and A/B transfers; the explicit completion adapter
// makes packaging a stock operation, with no virtual sale or later refund.
class V13OrderGame {
  constructor({ save = null, now = Date.now() } = {}) {
    this.mode = MODE;
    this.now = timestamp(now) ? now : Date.now();
    this.events = [];
    this.loadWarning = null;
    this._deliveryHold = null;
    this._commerce = freshCommerce();
    const finishedGoods = {
      canAccept: amount => this._commerce.stock.original + amount <= CAPACITY,
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
        const data = typeof save === 'string' ? JSON.parse(save) : save;
        this._commerce = this._validateCommerce(data);
        factorySave = data.factory;
        const factory = new Game({ save: factorySave, now: this.now, mode: 'v15', finishedGoods });
        if (factory.loadWarning) throw new Error('factory-save');
        this._factory = factory;
      } catch (error) {
        this.loadWarning = 'v1.3 订单试玩存档校验失败，已安全重新开工；原存档保留。';
        this._commerce = freshCommerce();
        factorySave = null;
      }
    }
    if (!this._factory) this._factory = new Game({ now: this.now, mode: 'v15', finishedGoods });
    this._fillOrders();
  }

  get state() { return this._factory.state; }

  _validateCommerce(data) {
    if (!data || data.mode !== MODE || data.version !== SAVE_VERSION || !timestamp(data.savedAt)) throw new Error('save-format');
    const raw = data.commerce, factory = data.factory;
    if (!raw || !factory || factory.mode !== 'v15' || factory.version !== CONFIG.automation.version
      || factory.economyProfile !== 'fresh' || factory.machine !== 0 || factory.logisticsLevel !== 0
      || !timestamp(factory.savedAt) || !factory.upgrades
      || CONFIG.stationIds.some(id => factory.upgrades[id] !== 0)
      || !factory.connections || ['pop', 'cup'].some(source => !factory.connections[source]
        || factory.connections[source].automated !== false)
      || !factory.automaticTrial || factory.automaticTrial.elapsedTicks !== 0 || factory.automaticTrial.complete !== false
      || !Array.isArray(factory.milestones) || factory.milestones.length !== CONFIG.machines.length - 1
      || factory.milestones.some(Boolean) || factory.firstUpgradeAt !== null
      || !factory.simulation || !whole(factory.simulation.ticks, MAX_TICKS)
      || !['coins', 'totalProduced', 'totalSold', 'totalEarned', 'totalSpent'].every(key => whole(factory[key]))
      || factory.totalSpent !== 0 || !productMap(raw.stock, CAPACITY)
      || !whole(raw.nextOrderId, MAX_ORDERS + 1) || raw.nextOrderId < 2
      || !Array.isArray(raw.orders) || raw.orders.length > 2) throw new Error('unsupported-state');

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
        || order.status !== (order.reserved.original ? 'partial' : 'pending')) throw new Error('order-lines');
      ids.add(order.id);
      pendingBuckets[index]++;
      reserved += order.reserved.original;
      return { id: order.id, sequence: order.sequence, items: { original: template.amount },
        reserved: { original: order.reserved.original }, quote: template.quote,
        createdAtTick: order.createdAtTick, status: order.status };
    });
    const created = raw.nextOrderId - 1;
    if (reserved > raw.stock.original || created !== completed + cancelled + orders.length
      || orders.length > (completed ? 2 : 1)) throw new Error('reservation-conservation');
    for (let index = 0; index < TEMPLATES.length; index++) {
      const generated = Math.floor((created + TEMPLATES.length - 1 - index) / TEMPLATES.length);
      if (generated !== buckets[index].settled + buckets[index].cancelled + pendingBuckets[index]) throw new Error('order-ledger');
    }
    if (created < MAX_ORDERS && orders.length !== (completed ? 2 : 1)) throw new Error('missing-order');
    return { stock: { original: raw.stock.original }, orders, nextOrderId: raw.nextOrderId,
      ledger: { completed, cancelled, sold, earned, buckets } };
  }

  _validateFactoryLedger(state) {
    const commerce = this._commerce;
    return state.totalSold === commerce.ledger.sold && state.totalEarned === commerce.ledger.earned
      && state.totalSpent === 0 && state.coins === commerce.ledger.earned
      && state.stations.ship.processed === commerce.stock.original + commerce.ledger.sold;
  }

  _fillOrders() {
    const commerce = this._commerce, limit = commerce.ledger.completed ? 2 : 1;
    while (commerce.orders.length < limit && commerce.nextOrderId <= MAX_ORDERS) {
      const sequence = commerce.nextOrderId++, template = TEMPLATES[(sequence - 1) % TEMPLATES.length];
      commerce.orders.push({ id: `v13-order-${sequence}`, sequence, items: { original: template.amount },
        reserved: { original: 0 }, quote: template.quote, status: 'pending', createdAtTick: this.state.simulation.ticks });
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
    const commerce = this._commerce, index = commerce.orders.findIndex(order => order.id === orderId);
    this._deliveryHold = null;
    if (index < 0) return fail('invalid-order');
    const order = commerce.orders[index];
    const amount = Math.min(hold.amount, order.items.original - order.reserved.original,
      commerce.stock.original - this._reserved());
    if (amount <= 0) return fail('order-filled');
    order.reserved.original += amount;
    order.status = 'partial';
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
    return { ok: true, orderId, amount, remaining: hold.amount - amount, settled, coins: settled ? order.quote : 0 };
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

  buyUpgrade() { return fail('v13-p0-unavailable'); }
  buyAutomation() { return fail('v13-p0-unavailable'); }
  buyLogisticsUpgrade() { return fail('v13-p0-unavailable'); }
  evolve() { return fail('v13-p0-unavailable'); }
  setSetting(key, value) { return this._factory.setSetting(key, value); }
  acknowledgeIntro() { return this._factory.acknowledgeIntro(); }

  getView() {
    const view = this._factory.getView(), commerce = this._commerce;
    view.mode = MODE;
    view.state.mode = MODE;
    view.expansion = null;
    view.logisticsUpgrade = null;
    view.automaticTrial = null;
    view.stations.forEach(station => { station.upgrade = null; if (station.id === 'ship') station.name = '包装入库'; });
    view.transfers.forEach(transfer => { transfer.automation = null; });
    view.transfer = view.transfers[0];
    view.finished = { capacity: CAPACITY, stock: { ...commerce.stock }, reserved: { original: this._reserved() },
      held: { original: this._deliveryHold ? this._deliveryHold.amount : 0 }, available: { original: this._available() }, deliveryBatch: DELIVERY_BATCH };
    view.orders = clone(commerce.orders);
    view.orderLedger = clone(commerce.ledger);
    view.delivery = this._deliveryHold ? { ...this._deliveryHold } : null;
    view.loadWarning = this.loadWarning;
    const missingTransfer = view.transfers.find(transfer => !transfer.manualTransfers);
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

module.exports = { V13OrderGame, OrderGame: V13OrderGame, MODE, SAVE_KEY, SAVE_VERSION,
  ORDER_RULES: Object.freeze({ capacity: CAPACITY, deliveryBatch: DELIVERY_BATCH, maxOrders: 2, templates: TEMPLATES }) };
