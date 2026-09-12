'use strict';

const { ART_ASSETS, ART_SIX_GEN } = require('./art-manifest');
const { SixGenerationScene } = require('./six-generation-scene');
const { V13_ART_ASSETS } = require('./v13-art-manifest');
const { V13_SCENE_ART_ASSETS, V13_SCENE_ART_IDS } = require('./v13-scene-art-manifest');
const { fitArtRect, pointInRect, transferTargetAt: hitTransferTarget } = require('./art-layout');

const C = { ink: '#214f48', muted: '#6b7b70', page: '#edf3ea', paper: '#fffdf5', mint: '#dcebdd', green: '#386b51', line: '#c8d8c8', gold: '#eed48c', coral: '#af6651' };
const finite = value => Number.isFinite(value) ? value : 0;
const amount = value => Math.max(0, Math.floor(finite(value)));
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value)));
const original = value => amount(value && value.original);
const rect = (x, y, w, h) => ({ x, y, w, h });
const STORE_ASSETS = Object.freeze(['product_original_cup', 'customer_neighbor', 'customer_family', 'clerk_vendor', 'order_pickup_bag', 'shop_front', 'ui_order_ticket']);
const STORE_RACK = ART_SIX_GEN.logistics.rigs.find(rig => rig.id === 'cups_rack');
// Authored in the unchanged 179 x 192 bag's local pixels, as in v13-showroom.
const PICKUP_FRONT_CLIPS = [
  [[43,59],[60,68],[65,78],[89,81],[110,79],[127,74],[145,65],[163,58],[179,192],[0,192],[37,156]],
  [[85,96],[86,65],[87,48],[91,39],[97,32],[105,28],[118,29],[129,34],[136,43],[141,61],[146,84],[137,88],[132,57],[128,45],[121,38],[109,35],[102,39],[99,48],[98,67],[98,96]]
];

function orderSceneAssetIds(scene) {
  return scene === 'store' ? STORE_ASSETS.slice() : ['product_original_cup'];
}
function orderSceneEnvironmentAssetIds(scene) {
  return scene === 'store' ? V13_SCENE_ART_IDS.slice() : [];
}

// Keep the original workshop assembly and its physical transfer geometry.
// Only the order mode's packaging vocabulary and HUD clipping differ.
class OrderFactoryScene extends SixGenerationScene {
  background() {
    super.background();
    const r = this.paintClip;
    if (r) { this.c.beginPath(); this.c.rect(r.x, r.y, r.w, r.h); this.c.clip(); }
  }
  label(value, x, y, size, color, align) {
    return super.label(String(value).replace('出货入口', '包装入口').replace(/^待发 /, '待包 '), x, y, size, color, align);
  }
  machineLabel(node, station, view, compact) {
    const clip = this.paintClip, r = node.rect;
    const offset = clip ? Math.min(0, clip.y + clip.h - 1 - (r[1] + r[3] + 16)) : 0;
    const labelNode = offset ? Object.assign({}, node, { rect: [r[0], r[1] + offset, r[2], r[3]] }) : node;
    return super.machineLabel(labelNode, station, view, compact);
  }
  transitCup(r, transform, node, job) {
    this.cupAt(r, transform, job ? clamp(job.progress, 0, 1) : 1);
  }
  logisticsControls(nodes, view) {
    const r = this.viewportClip;
    for (const frame of this.transferFrames) {
      if (r && (frame.y < r.y || frame.y + frame.h > r.y + r.h + .01)) frame.accepting = false;
    }
    return super.logisticsControls(nodes, view);
  }
}

// Presentation reads the production and order snapshots without owning stock,
// orders, settlement, or time. Every card and hit region keeps the order's id.
class V13OrderScene {
  constructor(options) {
    options = options || {};
    const canvas = options.canvas || options.ctx;
    this.c = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : canvas;
    this.art = options.art; this.v13Art = options.v13Art; this.sceneArt = options.sceneArt;
    this.factoryScene = new OrderFactoryScene(this.c, this.art);
    this.factoryScene.v13Art = this.v13Art;
    this.zones = []; this.transferFrames = []; this.orderFrames = []; this.clip = null;
    this.layout = null; this.diagnostics = null;
  }
  box(r, fill, stroke, radius) {
    if (r.w <= 0 || r.h <= 0) return;
    const c = this.c, k = Math.min(radius == null ? 12 : radius, r.w / 2, r.h / 2);
    c.beginPath(); c.moveTo(r.x + k, r.y); c.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, k);
    c.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, k); c.arcTo(r.x, r.y + r.h, r.x, r.y, k);
    c.arcTo(r.x, r.y, r.x + r.w, r.y, k); c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
  }
  text(value, x, y, width, size, color, weight, align) {
    const c = this.c; let label = String(value);
    size = size || 13; weight = Math.round((weight || 500) / 100) * 100;
    c.font = weight + ' ' + size + 'px "Microsoft YaHei", "PingFang SC", sans-serif';
    if (c.measureText(label).width > width) {
      while (label.length && c.measureText(label + '…').width > width) label = label.slice(0, -1);
      label += '…';
    }
    c.fillStyle = color || C.ink; c.textAlign = align || 'left'; c.textBaseline = 'middle'; c.fillText(label, x, y);
  }
  visible(r, full) {
    if (!this.clip) return true;
    const b = this.clip;
    return full ? r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w + .01 && r.y + r.h <= b.y + b.h + .01
      : r.x + r.w > b.x && r.x < b.x + b.w && r.y + r.h > b.y && r.y < b.y + b.h;
  }
  hit(r, action, extra) {
    if (!this.visible(r, true)) return null;
    const zone = Object.assign({}, r, { action }, extra || {});
    this.zones.push(zone); return zone;
  }
  button(r, label, action, active, extra) {
    this.box(r, active ? C.green : C.mint, active ? C.green : C.line, 9);
    this.text(label, r.x + r.w / 2, r.y + r.h / 2, r.w - 12, 12, active ? C.paper : C.green, 700, 'center');
    return this.hit(r, action, extra);
  }
  sprite(id, r, legacy, quiet) {
    const catalog = legacy ? ART_ASSETS : V13_ART_ASSETS, asset = catalog[id], source = legacy ? this.art : this.v13Art;
    const img = source && typeof source.get === 'function' ? source.get(id) : null;
    const fitted = asset ? fitArtRect([asset.width, asset.height], [r.x, r.y, r.w, r.h]) : [r.x, r.y, r.w, r.h];
    let available = !!(asset && img);
    if (available) try { this.c.drawImage(img, 0, 0, asset.width, asset.height, fitted[0], fitted[1], fitted[2], fitted[3]); } catch (_) { available = false; }
    this.diagnostics.sprites.push({ id, legacy: !!legacy, available, rect: rect(fitted[0], fitted[1], fitted[2], fitted[3]) });
    if (!available && !quiet && r.w >= 44 && r.h >= 44) {
      this.box(rect(r.x + r.w / 2 - 15, r.y + r.h / 2 - 20, 30, 32), C.mint, C.line, 5);
      this.text('待加载', r.x + r.w / 2, r.y + r.h / 2 + 22, r.w, 10, C.muted, 500, 'center');
    }
    return available;
  }
  environmentSprite(id, r, cover) {
    const asset = V13_SCENE_ART_ASSETS[id], img = this.sceneArt && typeof this.sceneArt.get === 'function' ? this.sceneArt.get(id) : null;
    const scale = asset && (cover ? Math.max(r.w / asset.width, r.h / asset.height) : Math.min(r.w / asset.width, r.h / asset.height));
    const fitted = asset ? rect(r.x + (r.w - asset.width * scale) / 2, r.y + (r.h - asset.height * scale) / 2, asset.width * scale, asset.height * scale) : r;
    let available = !!(asset && img);
    // The courtyard is one cover image, never a repeated texture. Counter and
    // wayfinding remain whole, uniformly scaled images without invented layers.
    if (available) {
      this.c.save(); this.c.beginPath(); this.c.rect(r.x, r.y, r.w, r.h); this.c.clip();
      try { this.c.drawImage(img, 0, 0, asset.width, asset.height, fitted.x, fitted.y, fitted.w, fitted.h); } catch (_) { available = false; }
      this.c.restore();
    }
    this.diagnostics.sprites.push({ id, legacy: false, environment: true, available, rect: fitted, fit: cover ? 'cover' : 'contain' });
    return available;
  }
  assemblyClip(points, fitted, scale, draw) {
    this.c.save(); this.c.beginPath();
    points.forEach((point, index) => this.c[index ? 'lineTo' : 'moveTo'](fitted[0] + point[0] * scale, fitted[1] + point[1] * scale));
    this.c.closePath(); this.c.clip();
    try { draw(); } finally { this.c.restore(); }
  }
  pickupBag(r, reserved) {
    const asset = V13_ART_ASSETS.order_pickup_bag, fitted = fitArtRect([asset.width, asset.height], [r.x, r.y, r.w, r.h]), scale = fitted[2] / asset.width;
    const bag = rect(fitted[0], fitted[1], fitted[2], fitted[3]);
    if (!this.sprite('order_pickup_bag', bag, false, true) || !reserved) return;
    this.sprite('product_original_cup', rect(fitted[0] + 78 * scale, fitted[1] + 45 * scale, 61 * scale, 63 * scale), false, true);
    for (const polygon of PICKUP_FRONT_CLIPS) this.assemblyClip(polygon, fitted, scale, () => this.sprite('order_pickup_bag', bag, false, true));
  }
  sharedRack(r, count) {
    const rig = STORE_RACK, fitted = fitArtRect(rig.size, [r.x, r.y, r.w, r.h]), scale = fitted[2] / rig.size[0];
    const local = value => rect(fitted[0] + value[0] * scale, fitted[1] + value[1] * scale, value[2] * scale, value[3] * scale);
    for (const layer of rig.layers.filter(item => item.layer < rig.content.layer)) this.sprite(layer.id, local(layer.rect), true, true);
    this.assemblyClip(rig.contentClip, fitted, scale, () => {
      for (const slot of rig.content.slots.slice(0, amount(count))) this.sprite('product_original_cup', local(slot), false, true);
    });
    for (const layer of rig.layers.filter(item => item.layer >= rig.content.layer)) this.sprite(layer.id, local(layer.rect), true, true);
  }
  actionAt(x, y) {
    for (let i = this.zones.length - 1; i >= 0; i--) if (pointInRect(x, y, this.zones[i])) return this.zones[i].action;
    return null;
  }
  transferTargetAt(x, y, source) {
    if (!this.layout || this.layout.scene !== 'factory') return null;
    return hitTransferTarget(this.transferFrames, x, y, source, this.factoryScene.transferBlockers);
  }
  transferPoint(source, kind) {
    const frame = this.transferFrames.find(item => item.source === source && item.kind === kind);
    return frame ? { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 } : null;
  }
  deliveryTargetAt(x, y) {
    if (this.zones.some(zone => zone.action.indexOf('cancel-order:') === 0 && pointInRect(x, y, zone))) return null;
    return this.orderFrames.find(frame => frame.accepting && pointInRect(x, y, frame)) || null;
  }
  draw(view, ui, dt) {
    ui = ui || {}; view = view || {};
    const vp = ui.viewport || {}, w = Math.max(1, finite(vp.width)), h = Math.max(1, finite(vp.height));
    const left = clamp(vp.safeLeft, 0, w / 3), right = clamp(vp.safeRight, 0, w / 3);
    const top = Math.max(8, finite(vp.safeTop) + 8, finite(vp.menuBottom) + 8, vp.menuButton ? finite(vp.menuButton.bottom) + 8 : 0);
    const safeWidth = Math.max(44, Math.min(520, w - left - right - 24));
    const safe = rect(left + (w - left - right - safeWidth) / 2, top, safeWidth, Math.max(1, h - clamp(vp.safeBottom, 0, h / 3) - top - 8));
    const scene = ui.scene === 'store' ? 'store' : 'factory';
    const legacyReport = this.art && (typeof this.art.report === 'function' ? this.art.report() : this.art.report) || {};
    const newReport = this.v13Art && (typeof this.v13Art.report === 'function' ? this.v13Art.report() : this.v13Art.report) || {};
    const sceneReport = scene === 'store' && this.sceneArt && (typeof this.sceneArt.report === 'function' ? this.sceneArt.report() : this.sceneArt.report) || {};
    const failedArt = finite(legacyReport.failed) > 0 || finite(newReport.failed) > 0 || finite(sceneReport.failed) > 0;
    const retry = ui.recoveryBlocked ? 'reload-save' : ui.saveError ? 'retry-save' : failedArt ? 'retry-art' : null;
    const footerHeight = retry ? 48 : 26;
    const stockHeight = scene === 'store' ? clamp(safe.h * .18, 100, 156) : 64;
    const stock = rect(safe.x, safe.y + safe.h - footerHeight - stockHeight - 4, safe.w, stockHeight);
    const content = rect(safe.x, safe.y + 82, safe.w, Math.max(44, stock.y - safe.y - 88));
    const naturalHeight = scene === 'factory' ? Math.max(192, content.h) : Math.max(268, content.h);
    content.scrollMax = Math.max(0, naturalHeight - content.h);
    const scroll = clamp(ui.scroll, 0, content.scrollMax);
    this.layout = { safe, content, stock, scroll, scene, naturalHeight };
    this.zones = []; this.transferFrames = []; this.orderFrames = []; this.clip = null;
    this.diagnostics = { layout: this.layout, scene, sprites: [], machines: [], orders: [], inventory: {}, assetIds: orderSceneAssetIds(scene), environmentAssetIds: orderSceneEnvironmentAssetIds(scene), controls: this.zones };
    this.c.clearRect(0, 0, w, h); this.box(rect(0, 0, w, h), C.page, null, 0);
    const origin = rect(content.x, content.y - scroll, content.w, naturalHeight);
    if (scene === 'factory') {
      this.clip = content;
      this.factory(view, ui, origin, dt);
      this.clip = null;
    }
    if (scene === 'store') {
      this.environmentSprite('scene_direct_sales_courtyard', rect(0, 0, w, h), true);
    }
    this.box(rect(safe.x - 4, safe.y - 3, safe.w + 8, 85), '#fffdf5ed', null, 14);
    this.text(scene === 'factory' ? '原味订单试玩' : '工厂直售', safe.x, safe.y + 17, safe.w * .58, 20, C.ink, 800);
    this.text('金币 ' + amount(view.state && view.state.coins), safe.x + safe.w, safe.y + 17, safe.w * .42 - 8, 13, C.green, 800, 'right');
    const tabWidth = (safe.w - 6) / 2;
    this.button(rect(safe.x, safe.y + 36, tabWidth, 44), '01  生产工厂', 'scene:factory', scene === 'factory');
    this.button(rect(safe.x + tabWidth + 6, safe.y + 36, tabWidth, 44), '02  顾客订单', 'scene:store', scene === 'store');
    if (scene === 'store') {
      this.c.save(); this.c.beginPath(); this.c.rect(content.x, content.y, content.w, content.h); this.c.clip(); this.clip = content;
      this.store(view, ui, origin);
      this.clip = null; this.c.restore();
    }
    if (content.scrollMax > 0) {
      const thumb = Math.max(20, content.h * content.h / naturalHeight);
      this.box(rect(content.x + content.w - 3, content.y + scroll / content.scrollMax * (content.h - thumb), 3, thumb), '#8eac96', null, 2);
    }
    this.inventory(view, ui, stock);
    const footerY = safe.y + safe.h - footerHeight;
    if (retry) this.button(rect(safe.x, footerY + 4, safe.w, 44), retry === 'reload-save' ? '存档未能读取 · 重试读取' : retry === 'retry-save' ? '保存失败 · 点击重试' : '图片加载失败 · 点击重试', retry, false);
    else {
      const message = ui.message && (typeof ui.message === 'object' ? ui.message.text : ui.message);
      if (scene === 'store') this.box(rect(safe.x, footerY + 2, safe.w, 24), '#fffdf5ed', null, 8);
      this.text(message || '包装只入库，拖给顾客才收款', safe.x + safe.w / 2, footerY + 14, safe.w - 4, 11, message ? C.green : C.muted, message ? 700 : 500, 'center');
    }
    this.dragGhost(ui, vp);
    return this.diagnostics;
  }
  factory(view, ui, r, dt) {
    const scene = this.factoryScene, vp = ui.viewport, content = this.layout.content;
    // This is a read-only presentation adapter; the simulation and save mode
    // remain v13-orders-p0, including packaging into shared inventory.
    const presented = Object.assign({}, view, { mode: 'v15',
      presentation: Object.assign({}, view.presentation || {}, { transfer: ui.transfer, viewport: vp,
        overlayLayout: { topInset: r.y, bottomInset: vp.height - r.y - r.h,
          leftInset: r.x, rightInset: vp.width - r.x - r.w,
          exclusionRects: [
            rect(0, 0, vp.width, content.y),
            rect(0, content.y + content.h, vp.width, vp.height - content.y - content.h)
          ] } }) });
    scene.viewportClip = content;
    // The six-pixel gap before the inventory also belongs to the workshop's
    // labels. Input ownership remains restricted to the content rectangle.
    scene.paintClip = rect(content.x, content.y, content.w, this.layout.stock.y - content.y);
    scene.update(finite(dt));
    scene.draw(0, 0, vp.width, vp.height, presented);
    for (const frame of scene.transferFrames) {
      const route = (view.transfers || []).find(item => item.source === frame.source) || {};
      const buffer = (view.buffers || []).find(item => item.id === frame.source) || {};
      const zone = this.hit(frame, frame.action, Object.assign({}, frame,
        { amount: amount(buffer.amount), available: amount(route.availableAmount) }));
      if (zone) this.transferFrames.push(zone);
    }
    this.diagnostics.factoryScene = scene.diagnostics;
    this.diagnostics.machines = scene.diagnostics.machines.map(machine => {
      const station = view.stations.find(item => item.id === machine.stationId);
      return { id: station.id, status: station.status, progress: clamp(station.progress, 0, 1),
        jobs: (station.jobs || []).map(item => item && { amount: item.amount, progress: item.progress, complete: item.complete }),
        rect: rect(machine.rect[0], machine.rect[1], machine.rect[2], machine.rect[3]) };
    });
  }
  store(view, ui, r) {
    const orders = (view.orders || []).slice(0, 2);
    // Art adapts to the remaining height; text and 44 px controls never scale
    // with the source's 390 x 744 composition. The inventory stays fixed below.
    const heroHeight = clamp(r.h - 224, 54, 240), bubbleHeight = 114, column = (r.w - 8) / 2;
    const stageY = r.y + heroHeight + bubbleHeight + 4, stageHeight = r.y + r.h - stageY;
    const shop = fitArtRect([768, 627], [r.x + 6, r.y, r.w * .85, heroHeight + 2]);
    this.sprite('shop_front', rect(shop[0], shop[1], shop[2], shop[3]), false, true);
    this.assemblyClip([[158,264],[504,324],[504,414],[167,334]], shop, shop[2] / 768, () => {
      this.sprite('clerk_vendor', rect(shop[0] + 298 * shop[2] / 768, shop[1] + 279 * shop[2] / 768, 126 * shop[2] / 768, 194 * shop[2] / 768), false, true);
    });
    this.environmentSprite('scene_factory_wayfinding', rect(r.x + r.w * .79, r.y + heroHeight * .39, r.w * .2, heroHeight * .61), false);
    const counterHeight = Math.min(r.w * .35, stageHeight * .62), counterY = r.y + r.h - counterHeight;
    const counterFit = fitArtRect([640, 242], [r.x + r.w * .025, counterY, r.w * .95, counterHeight]);
    const counter = rect(counterFit[0], counterFit[1], counterFit[2], counterFit[3]);
    const customerHeight = Math.min(128, stageHeight * .78), bagHeight = clamp(stageHeight * .34, 33, 56);
    for (let index = 0; index < 2; index++) if (orders[index]) {
      const center = counter.x + counter.w * (index ? .77 : .20), width = Math.min(column * .4, customerHeight * .76);
      this.sprite(index ? 'customer_family' : 'customer_neighbor', rect(center - width / 2, Math.max(stageY + 3, counter.y - customerHeight * .71), width, customerHeight), false, true);
    }
    if (!this.environmentSprite('scene_pickup_counter', counter, false)) this.box(counter, '#dcebddb8', C.line, 9);
    for (let index = 0; index < 2; index++) {
      const x = r.x + (column + 8) * index, bagWidth = bagHeight * 179 / 192;
      const bag = rect(counter.x + counter.w * (index ? .88 : .33) - bagWidth / 2, counter.y - bagHeight * .40, bagWidth, bagHeight);
      if (orders[index]) this.pickupBag(bag, original(orders[index].reserved));
      const area = rect(x, r.y + heroHeight, column, bubbleHeight);
      if (!this.visible(area)) continue;
      if (orders[index]) this.orderCard(orders[index], index, ui, area, r.y + r.h, bag);
      else {
        this.box(area, '#fffdf5d9', C.line, 12);
        this.text('下一位顾客', area.x + area.w / 2, area.y + 25, area.w - 12, 13, C.green, 700, 'center');
        this.sprite('ui_order_ticket', rect(area.x + area.w / 2 - 11, area.y + 44, 22, 30), false, true);
        this.text(orders.length ? '首单完成后开放' : '顾客正在进店', area.x + area.w / 2, area.y + 94, area.w - 12, 12, C.muted, 500, 'center');
      }
    }
    this.diagnostics.courtyard = { shop: rect(shop[0], shop[1], shop[2], shop[3]), counter, customerCount: orders.length, completed: amount(view.orderLedger && view.orderLedger.completed) };
  }
  orderCard(order, index, ui, r, bottom, bag) {
    const demand = original(order.items), reserved = original(order.reserved), remaining = Math.max(0, demand - reserved);
    const drag = ui.delivery, accepting = remaining > 0;
    const dropArea = rect(r.x, r.y + 46, r.w, bottom - r.y - 46);
    const hovered = accepting && drag && pointInRect(finite(drag.x), finite(drag.y), dropArea);
    this.box(r, hovered ? '#fff0c8' : '#fffdf5f5', drag && accepting ? C.green : C.line, 12);
    const x = r.x + 10, width = r.w - 20, cancel = rect(r.x + r.w - 46, r.y, 44, 44);
    this.text(index ? '家庭采购客' : '街角顾客', x, r.y + 22, r.w - 58, 12, C.ink, 800);
    this.text('取消', cancel.x + 22, cancel.y + 22, 40, 11, C.coral, 500, 'center');
    this.sprite('product_original_cup', rect(x - 2, r.y + 45, 24, 27), false, true);
    this.text('原味 × ' + demand, x + 27, r.y + 58, width - 27, 14, C.ink, 800);
    this.text('已配 ' + reserved + ' · 还需 ' + remaining, x, r.y + 82, width, 12, C.muted, 600);
    this.text('报酬 ' + amount(order.quote) + ' 金币', x, r.y + 103, width, 12, C.green, 700);
    // Only the visible part of a customer's lower bubble and pickup station is
    // interactive. Short safe-area screens can scroll without losing the drop
    // target; its 44 px minimum and separate cancellation corner are retained.
    if (drag && accepting) this.box(dropArea, null, C.green, 8);
    const top = this.clip ? Math.max(dropArea.y, this.clip.y) : dropArea.y;
    const end = this.clip ? Math.min(bottom, this.clip.y + this.clip.h) : bottom;
    const frame = end - top >= 44 ? this.hit(rect(dropArea.x, top, dropArea.w, end - top), 'order:' + order.id, { orderId: order.id, accepting, demand, reserved, remaining }) : null;
    if (frame) this.orderFrames.push(frame);
    this.hit(cancel, 'cancel-order:' + order.id, { orderId: order.id });
    this.diagnostics.orders.push({ id: order.id, demand, reserved, remaining, quote: amount(order.quote), rect: r, accepting, bag, bagProducts: reserved ? 1 : 0 });
  }
  inventory(view, ui, r) {
    const finished = view.finished || {}, stock = original(finished.stock), reserved = original(finished.reserved), available = original(finished.available), held = original(finished.held);
    this.diagnostics.inventory = { stock, reserved, available, held, capacity: amount(finished.capacity), representativeProducts: Math.min(stock, 1) };
    if (ui.scene === 'store') {
      const representativeProducts = Math.min(available, STORE_RACK.content.slots.length);
      const rackWidth = Math.min(r.w * .43, r.h * 512 / 429), x = r.x + rackWidth + 10, width = r.w - rackWidth - 18;
      this.box(r, '#fffdf5e8', '#d0cdae', 13);
      this.sharedRack(rect(r.x + 3, r.y + 5, rackWidth, r.h - 10), representativeProducts);
      this.text('共享货架 · 原味 ' + stock + '/' + amount(finished.capacity), x, r.y + 17, width, 12, C.ink, 800);
      this.text('可取 ' + available + ' · 预留 ' + reserved, x, r.y + 37, width, 12, C.green, 700);
      const source = rect(x, r.y + r.h - 51, width, 44);
      this.hit(r, 'delivery:original');
      this.button(source, held ? '手中 ' + held + ' 杯' : available ? '拖给顾客' : '等待成品', 'delivery:original', available > 0);
      this.diagnostics.inventory.representativeProducts = representativeProducts;
      this.diagnostics.inventory.source = Object.assign({}, r);
      return;
    }
    this.box(r, '#fff4d8', '#dfcda3', 13);
    if (stock > 0) this.sprite('product_original_cup', rect(r.x + 7, r.y + 8, 48, 48), false, false);
    else {
      this.box(rect(r.x + 15, r.y + 16, 32, 32), '#f5ead0', '#d5c6a8', 6);
      this.text('空', r.x + 31, r.y + 32, 30, 12, C.muted, 500, 'center');
    }
    const width = r.w - 142, x = r.x + 65;
    this.text('原味成品 ' + stock + '/' + amount(finished.capacity), x, r.y + 17, width, 12, C.ink, 800);
    this.text('可取 ' + available + ' · 订单占用 ' + reserved, x, r.y + 35, width, 10, C.muted);
    this.text(held ? '手中 ' + held + ' 杯' : '工厂与门店共享', x, r.y + 51, width, 10, C.muted);
    const action = ui.scene === 'store' ? 'delivery:original' : 'scene:store';
    const source = rect(r.x + r.w - 72, r.y + 10, 64, 44);
    if (ui.scene === 'store') this.hit(r, action);
    this.button(source, ui.scene === 'store' ? (available ? '拖给顾客' : '等待成品') : '去交订单', action, available > 0);
    this.diagnostics.inventory.source = ui.scene === 'store' ? Object.assign({}, r) : source;
  }
  dragGhost(ui, vp) {
    const held = ui.delivery || ui.transfer;
    if (!held || !Number.isFinite(held.x) || !Number.isFinite(held.y) || !amount(held.amount)) return;
    const x = clamp(held.x, 31, vp.width - 31), y = clamp(held.y - 32, 36, vp.height - 45);
    const delivery = !!ui.delivery;
    this.c.save(); this.c.globalAlpha = .93;
    this.box(rect(x - 29, y - 33, 58, 67), C.paper, C.green, 12);
    const id = delivery || held.source === 'cup' ? 'product_original_cup' : 'product_cup_fill';
    this.sprite(id, rect(x - 19, y - 29, 38, 42), !delivery && held.source !== 'cup', true);
    const target = delivery ? this.deliveryTargetAt(held.x, held.y) : this.transferTargetAt(held.x, held.y, held.source);
    const preview = delivery && target ? Math.min(amount(held.amount), target.remaining) : amount(held.amount);
    this.text((delivery && target ? '交 ' : '×') + preview, x, y + 23, 48, 12, C.green, 800, 'center');
    this.c.restore();
    this.diagnostics.ghost = { type: delivery ? 'delivery' : 'transfer', x, y, amount: amount(held.amount), previewAmount: preview, targetId: target && target.orderId, source: held.source || 'original' };
  }
}

module.exports = { V13OrderScene, orderSceneAssetIds, orderSceneEnvironmentAssetIds };
