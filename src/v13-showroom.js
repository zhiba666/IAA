'use strict';

const { ART_ASSETS, ART_RIGS, ART_SIX_GEN } = require('./art-manifest');
const { V13_ART_ASSETS } = require('./v13-art-manifest');
const { fitArtRect } = require('./art-layout');

const C = { ink: '#174e51', muted: '#687970', page: '#edf3ea', white: '#fffdf6', line: '#cbd9cc', green: '#38654d', mint: '#dce8d7', coral: '#b9634e', yellow: '#efc45b' };
const V13_PRODUCTS = [
  { id: 'product_original_cup', label: '经典原味杯', generation: 1, machineId: 'machine_pop_body', process: '爆制 · 装杯 · 包装', description: '松脆原味，现做装杯。' },
  { id: 'product_caramel_tub', label: '琥珀焦糖桶', generation: 2, machineId: 'machine_caramel_coater', process: '爆制 · 裹糖 · 装桶', description: '琥珀糖衣均匀包裹爆米花。' },
  { id: 'product_cheese_carton', label: '浓香芝士盒', generation: 3, machineId: 'machine_dual_flavor', process: '爆制 · 芝士调味 · 装盒', description: '金黄芝士粉带来浓香咸味。' },
  { id: 'product_duo_bucket', label: '甜咸双拼桶', generation: 3, machineId: 'machine_dual_flavor', process: '焦糖 · 芝士 · 双舱拼装', description: '焦糖与芝士分别盛入双拼桶。' },
  { id: 'product_choco_cup', label: '黑白巧脆杯', generation: 4, machineId: 'machine_dual_drizzle', process: '爆制 · 双酱淋面 · 冷却', description: '深色巧克力与白色酱线交织。' },
  { id: 'product_star_pop', label: '星星爆米花棒', generation: 5, machineId: 'machine_star_press', process: '爆制 · 星模压制 · 包装', description: '爆米花压成星形，配上短棒。' },
  { id: 'product_celebration_box', label: '星光庆典礼盒', generation: 6, machineId: 'machine_gift_assembler', process: '双拼桶 · 巧脆杯 · 星棒组盒', description: '多款招牌商品汇入庆典礼盒。' }
];
for (const item of V13_PRODUCTS) Object.freeze(item);
Object.freeze(V13_PRODUCTS);

const finite = n => Number.isFinite(n) ? n : 0;
const clamp = (n, min, max) => Math.max(min, Math.min(max, finite(n)));
const generationNumber = value => clamp(Math.round(finite(value)) || 1, 1, 6);
const tabName = value => ['products', 'process', 'store'].indexOf(value) >= 0 ? value : 'products';
const STORE_RACK = ART_SIX_GEN.logistics.rigs.find(rig => rig.id === 'cups_rack');
const STORE_LEGEND_HEIGHT = 112;
const storeSamplesHeight = width => Math.max(152, (width * 2 / 3 - 8) * STORE_RACK.size[1] / STORE_RACK.size[0] + 36);
// Local pixels of the unchanged 179 x 192 pickup-bag export. Repainting the
// near wall and handle after the sample follows the shared tray assembly.
const PICKUP_FRONT_CLIPS = [
  [[43,59],[60,68],[65,78],[89,81],[110,79],[127,74],[145,65],[163,58],[179,192],[0,192],[37,156]],
  [[85,96],[86,65],[87,48],[91,39],[97,32],[105,28],[118,29],[129,34],[136,43],[141,61],[146,84],[137,88],[132,57],[128,45],[121,38],[109,35],[102,39],[99,48],[98,67],[98,96]]
];

function showroomAssetIds(tab, generation) {
  const ids = ['product_original_cup', 'ui_order_ticket'];
  tab = tabName(tab); generation = generationNumber(generation);
  if (tab === 'products') for (const product of V13_PRODUCTS) ids.push(product.id);
  if (tab === 'process') for (const product of V13_PRODUCTS.filter(item => item.generation === generation)) {
    ids.push(product.id);
    if (generation > 1) ids.push(product.machineId);
  }
  if (tab === 'store') ids.push('product_caramel_tub', 'shop_front', 'clerk_vendor', 'customer_neighbor', 'customer_family', 'order_pickup_bag');
  return Array.from(new Set(ids));
}

// The showroom reads a frozen game snapshot and only owns presentation state.
class V13Showroom {
  constructor(renderer, v13Art) {
    this.r = renderer; this.art = v13Art; this.diagnostics = null; this.clip = null;
  }
  text(value, x, y, width, size = 14, color = C.ink, weight = 500, align = 'left') {
    const c = this.r.c; let label = String(value);
    c.font = '500 ' + size + 'px "Microsoft YaHei", sans-serif';
    if (c.measureText(label).width > width) {
      while (label.length && c.measureText(label + '…').width > width) label = label.slice(0, -1);
      label += '…';
    }
    this.r.text(label, x, y, size, color, weight, align);
  }
  line(x, y, width, color = C.line) { this.r.c.fillStyle = color; this.r.c.fillRect(x, y, width, 1); }
  hit(rect, action, label) {
    const clip = this.clip;
    if (clip && (rect.x < clip.x || rect.y < clip.y || rect.x + rect.w > clip.x + clip.w + .01 || rect.y + rect.h > clip.y + clip.h + .01)) return;
    this.r.hit(rect.x, rect.y, rect.w, rect.h, action);
    if (label) this.diagnostics.controls.push(Object.assign({ action, label }, rect));
  }
  arrow(x, y, direction, action, label, disabled) {
    const r = this.r, c = r.c, sign = direction === 'left' ? -1 : 1;
    c.save(); c.strokeStyle = disabled ? C.line : C.green; c.lineWidth = 2.5; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(x + 22 - sign * 7, y + 22); c.lineTo(x + 22 + sign * 7, y + 22);
    c.moveTo(x + 22 + sign, y + 16); c.lineTo(x + 22 + sign * 7, y + 22); c.lineTo(x + 22 + sign, y + 28); c.stroke(); c.restore();
    if (!disabled) this.hit({ x, y, w: 44, h: 44 }, action, label);
  }
  sprite(id, rect, options) {
    options = options || {};
    const asset = options.legacy ? ART_ASSETS[id] : V13_ART_ASSETS[id];
    const source = options.legacy ? this.r.art : this.art;
    const img = source && typeof source.get === 'function' ? source.get(id) : null;
    const fitted = asset ? fitArtRect([asset.width, asset.height], [rect.x, rect.y, rect.w, rect.h], options.align || [.5, .5]) : [rect.x, rect.y, rect.w, rect.h];
    let available = !!(img && asset);
    if (available) {
      try { this.r.c.drawImage(img, 0, 0, asset.width, asset.height, fitted[0], fitted[1], fitted[2], fitted[3]); }
      catch (_) { available = false; }
    }
    this.diagnostics.sprites.push({ id, legacy: !!options.legacy, available, rect: { x: fitted[0], y: fitted[1], w: fitted[2], h: fitted[3] }, clip: this.clip && Object.assign({}, this.clip) });
    if (!available && !options.quiet) {
      const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, c = this.r.c;
      c.save(); c.strokeStyle = C.muted; c.lineWidth = 1.5; c.strokeRect(cx - 9, cy - 15, 18, 18);
      c.beginPath(); c.moveTo(cx - 5, cy - 10); c.lineTo(cx + 5, cy - 2); c.moveTo(cx + 5, cy - 10); c.lineTo(cx - 5, cy - 2); c.stroke(); c.restore();
      if (rect.w >= 52 && rect.h >= 52) this.text('待加载', cx, cy + 15, rect.w - 4, 11, C.muted, 500, 'center');
    }
    return available;
  }
  draw(view, ui, dt) {
    const r = this.r, vp = ui.viewport || {}, w = Math.max(1, finite(vp.width)), h = Math.max(1, finite(vp.height));
    const modal = ui.modal || {}, tab = tabName(modal.tab), generation = generationNumber(modal.generation);
    const left = clamp(vp.safeLeft, 0, w / 3), right = clamp(vp.safeRight, 0, w / 3), bottom = clamp(vp.safeBottom, 0, h / 3);
    const menuBottom = vp.menuButton ? finite(vp.menuButton.bottom) : finite(vp.menuBottom);
    const top = Math.max(8, clamp(vp.safeTop, 0, h / 2) + 8, menuBottom ? clamp(menuBottom, 0, h / 2) + 8 : 0);
    const safe = { x: left + 12, y: top, w: w - left - right - 24, h: h - bottom - top - 12 };
    const report = this.art && (typeof this.art.report === 'function' ? this.art.report() : this.art.report) || {};
    const legacyIds = tab === 'store' ? STORE_RACK.layers.map(layer => layer.id)
      : tab === 'process' && generation === 1 ? ART_RIGS.popMachine.layers.map(layer => layer.id) : [];
    const legacyReport = legacyIds.length && r.art && (typeof r.art.report === 'function' ? r.art.report() : r.art.report) || {};
    const legacyFailed = Array.isArray(legacyReport.entries) && legacyReport.entries.some(entry => entry.status === 'failed' && legacyIds.indexOf(entry.id) >= 0);
    const retryAction = legacyFailed ? 'retry-art' : finite(report.failed) > 0 ? 'retry-v13-art' : null;
    const retryHeight = retryAction ? 52 : 0;
    const generationHeight = tab === 'process' ? 52 : 0;
    const content = { x: safe.x, y: safe.y + 100 + generationHeight, w: safe.w, h: Math.max(32, safe.h - 100 - generationHeight - retryHeight), scrollMax: 0 };
    const naturalHeight = tab === 'products' ? V13_PRODUCTS.length * 98 : tab === 'process' ? 434 : 221 + content.w * 627 / 768 + storeSamplesHeight(content.w) + STORE_LEGEND_HEIGHT;
    content.scrollMax = Math.max(0, naturalHeight - content.h);
    const scroll = clamp(modal.scroll, 0, content.scrollMax);
    const layout = { x: safe.x, y: safe.y, w: safe.w, h: safe.h, type: 'showroom', content, scroll, safe, tab, generation };
    this.diagnostics = { tab, generation, layout, sprites: [], controls: [], assetIds: showroomAssetIds(tab, generation) };
    this.clip = null; r.zones = []; r.c.clearRect(0, 0, w, h); r.box(0, 0, w, h, 0, C.page);
    if (r.interface) r.interface.layout = { scene: { x: 0, y: 0, w, h }, modal: layout };
    this.hit(safe, 'modal-body');
    this.arrow(safe.x - 4, safe.y, 'left', 'close', '返回工厂');
    this.text('新品', safe.x + 48, safe.y + 22, safe.w - 98, 20, C.ink, 800);
    this.sprite('ui_order_ticket', { x: safe.x + safe.w - 30, y: safe.y + 7, w: 25, h: 30 }, { quiet: true });
    const tabs = [{ id: 'products', label: '商品' }, { id: 'process', label: '工艺' }, { id: 'store', label: '直售' }], tabWidth = safe.w / tabs.length;
    for (let index = 0; index < tabs.length; index++) {
      const item = tabs[index], x = safe.x + index * tabWidth, active = tab === item.id;
      this.text(item.label, x + tabWidth / 2, safe.y + 73, tabWidth - 12, 14, active ? C.green : C.muted, active ? 800 : 500, 'center');
      this.hit({ x, y: safe.y + 50, w: tabWidth, h: 44 }, 'showroom-tab:' + item.id, item.label);
      if (active) r.box(x + tabWidth / 2 - 15, safe.y + 94, 30, 3, 1, C.green);
    }
    this.line(safe.x, safe.y + 98, safe.w);
    if (tab === 'process') {
      const y = safe.y + 102;
      this.arrow(safe.x, y, 'left', 'showroom-generation:' + (generation - 1), '上一代', generation === 1);
      this.text('第 ' + generation + ' 代', safe.x + safe.w / 2, y + 22, safe.w - 96, 16, C.ink, 800, 'center');
      this.arrow(safe.x + safe.w - 44, y, 'right', 'showroom-generation:' + (generation + 1), '下一代', generation === 6);
    }
    r.c.save(); r.c.beginPath(); r.c.rect(content.x, content.y, content.w, content.h); r.c.clip(); this.clip = content;
    const origin = { x: content.x, y: content.y - scroll, w: content.w, h: Math.max(content.h, naturalHeight) };
    if (tab === 'products') this.products(origin);
    else if (tab === 'process') this.process(origin, generation);
    else this.store(origin);
    this.clip = null; r.c.restore();
    if (content.scrollMax > 0) {
      const thumb = Math.max(24, content.h * content.h / naturalHeight), y = content.y + scroll / content.scrollMax * (content.h - thumb);
      r.box(safe.x + safe.w - 3, y, 3, thumb, 1, '#93ac97');
    }
    if (retryHeight) {
      const y = safe.y + safe.h - 44;
      r.box(safe.x, y, safe.w, 44, 6, C.mint, C.line);
      this.text('重新加载图片', safe.x + safe.w / 2, y + 22, safe.w - 20, 13, C.green, 700, 'center');
      this.hit({ x: safe.x, y, w: safe.w, h: 44 }, retryAction, '重新加载图片');
    }
    return this.diagnostics;
  }
  products(rect) {
    const r = this.r;
    for (let index = 0; index < V13_PRODUCTS.length; index++) {
      const product = V13_PRODUCTS[index], y = rect.y + index * 98;
      if (this.clip && (y + 98 < this.clip.y || y > this.clip.y + this.clip.h)) continue;
      this.sprite(product.id, { x: rect.x + 2, y: y + 6, w: 83, h: 83 });
      this.text(product.label, rect.x + 92, y + 28, rect.w - 130, 15, C.ink, 750);
      this.text('第 ' + product.generation + ' 代 · ' + (product.generation === 1 ? '经典原味' : '筹备中'), rect.x + 92, y + 53, rect.w - 128, 11, product.generation === 1 ? C.green : C.coral);
      this.text(product.generation === 1 ? '原味工艺' : product.process, rect.x + 92, y + 73, rect.w - 128, 10, C.muted);
      this.arrow(rect.x + rect.w - 44, y + 25, 'right', 'showroom-product:' + product.generation, product.label);
      this.hit({ x: rect.x, y: y + 5, w: rect.w - 44, h: 88 }, 'showroom-product:' + product.generation, product.label);
      this.line(rect.x + 90, y + 97, rect.w - 90);
    }
  }
  originalMachine(rect) {
    const rig = ART_RIGS.popMachine, fitted = fitArtRect(rig.size, [rect.x, rect.y, rect.w, rect.h]), scale = fitted[2] / rig.size[0];
    for (const layer of rig.layers) this.sprite(layer.id, { x: fitted[0] + layer.rect[0] * scale, y: fitted[1] + layer.rect[1] * scale, w: layer.rect[2] * scale, h: layer.rect[3] * scale }, { legacy: true, quiet: true });
    if (!this.diagnostics.sprites.some(item => item.legacy && item.available)) this.sprite('machine_pop_body', rect, { legacy: true });
  }
  process(rect, generation) {
    const products = V13_PRODUCTS.filter(item => item.generation === generation), product = products[0], machine = V13_ART_ASSETS[product.machineId];
    this.text(generation === 1 ? '原味工艺 · 现有产品' : '新品工艺 · 筹备中', rect.x + rect.w / 2, rect.y + 16, rect.w - 16, 12, generation === 1 ? C.green : C.coral, 600, 'center');
    const machineRect = { x: rect.x + 20, y: rect.y + 36, w: rect.w - 40, h: 220 };
    if (generation === 1) this.originalMachine(machineRect); else this.sprite(product.machineId, machineRect);
    this.text(machine ? machine.label : '原味爆锅', rect.x + rect.w / 2, rect.y + 273, rect.w - 20, 16, C.ink, 800, 'center');
    this.line(rect.x + 16, rect.y + 293, rect.w - 32);
    if (products.length === 1) {
      this.sprite(product.id, { x: rect.x + 2, y: rect.y + 305, w: 99, h: 106 });
      this.text(product.label, rect.x + 106, rect.y + 327, rect.w - 112, 14, C.ink, 750);
      this.text(product.process, rect.x + 106, rect.y + 353, rect.w - 112, 10, C.green);
      this.wrapped(product.description, rect.x + 106, rect.y + 377, rect.w - 112, 11, C.muted, 18);
    } else {
      const width = rect.w / products.length;
      for (let index = 0; index < products.length; index++) {
        const item = products[index], x = rect.x + width * index;
        this.sprite(item.id, { x: x + (width - 88) / 2, y: rect.y + 300, w: 88, h: 87 });
        this.text(item.label, x + width / 2, rect.y + 398, width - 8, 12, C.ink, 750, 'center');
        this.text(index === 0 ? '芝士调味 · 装盒' : '焦糖芝士 · 拼装', x + width / 2, rect.y + 419, width - 8, 10, C.green, 500, 'center');
      }
    }
  }
  wrapped(value, x, y, width, size, color, lineHeight) {
    const c = this.r.c; c.font = '500 ' + size + 'px "Microsoft YaHei", sans-serif'; let line = '', row = 0;
    for (const char of value) {
      if (line && c.measureText(line + char).width > width) { this.text(line, x, y + row * lineHeight, width, size, color); line = char; row++; }
      else line += char;
    }
    if (line) this.text(line, x, y + row * lineHeight, width, size, color);
  }
  assemblyClip(polygon, fitted, scale, draw) {
    const c = this.r.c;
    c.save(); c.beginPath();
    polygon.forEach((point, index) => c[index ? 'lineTo' : 'moveTo'](fitted[0] + point[0] * scale, fitted[1] + point[1] * scale));
    c.closePath(); c.clip();
    try { draw(); } finally { c.restore(); }
  }
  sampleRack(rect) {
    const rig = STORE_RACK, fitted = fitArtRect(rig.size, [rect.x, rect.y, rect.w, rect.h]), scale = fitted[2] / rig.size[0];
    const localRect = value => ({ x: fitted[0] + value[0] * scale, y: fitted[1] + value[1] * scale, w: value[2] * scale, h: value[3] * scale });
    for (const layer of rig.layers.filter(item => item.layer < rig.content.layer)) this.sprite(layer.id, localRect(layer.rect), { legacy: true });
    // Fixed art samples use authored shelf slots, independently of live stock.
    this.assemblyClip(rig.contentClip, fitted, scale, () => {
      this.sprite('product_original_cup', localRect(rig.content.slots[0]), { align: [.5, 1] });
      this.sprite('product_caramel_tub', localRect(rig.content.slots[2]), { align: [.5, 1] });
    });
    for (const layer of rig.layers.filter(item => item.layer >= rig.content.layer)) this.sprite(layer.id, localRect(layer.rect), { legacy: true, quiet: true });
  }
  pickupSample(rect) {
    const asset = V13_ART_ASSETS.order_pickup_bag, fitted = fitArtRect([asset.width, asset.height], [rect.x, rect.y, rect.w, rect.h]), scale = fitted[2] / asset.width;
    const bag = { x: fitted[0], y: fitted[1], w: fitted[2], h: fitted[3] };
    if (!this.sprite('order_pickup_bag', bag)) return;
    this.sprite('product_original_cup', { x: fitted[0] + 78 * scale, y: fitted[1] + 45 * scale, w: 61 * scale, h: 63 * scale }, { align: [.5, 1], quiet: true });
    for (const polygon of PICKUP_FRONT_CLIPS) this.assemblyClip(polygon, fitted, scale, () => this.sprite('order_pickup_bag', bag, { quiet: true }));
  }
  store(rect) {
    this.text('工厂直售 · 筹备中', rect.x + rect.w / 2, rect.y + 20, rect.w - 20, 15, C.green, 750, 'center');
    const shopHeight = rect.w * 627 / 768, shopY = rect.y + 42;
    this.sprite('shop_front', { x: rect.x, y: shopY, w: rect.w, h: shopHeight });
    const samplesY = shopY + shopHeight + 14, slot = rect.w / 3, samplesHeight = storeSamplesHeight(rect.w);
    this.line(rect.x + 6, samplesY - 2, rect.w - 12);
    this.sampleRack({ x: rect.x + 4, y: samplesY + 4, w: slot * 2 - 8, h: samplesHeight - 36 });
    this.pickupSample({ x: rect.x + slot * 2 + 6, y: samplesY + samplesHeight - 146, w: slot - 12, h: 110 });
    this.text('原味 / 焦糖样品', rect.x + slot, samplesY + samplesHeight - 16, slot * 2 - 8, 11, C.ink, 600, 'center');
    this.text('取货示意', rect.x + slot * 2.5, samplesY + samplesHeight - 16, slot - 8, 11, C.ink, 600, 'center');
    const legendY = samplesY + samplesHeight, legendWidth = rect.w / 2;
    const legends = [{ id: 'product_original_cup', label: '经典原味' }, { id: 'product_caramel_tub', label: '琥珀焦糖' }];
    for (let index = 0; index < legends.length; index++) {
      const item = legends[index], x = rect.x + legendWidth * (index + .5);
      this.sprite(item.id, { x: x - 39, y: legendY + 6, w: 78, h: 78 });
      this.text(item.label, x, legendY + 100, legendWidth - 8, 11, C.ink, 600, 'center');
    }
    const peopleY = legendY + STORE_LEGEND_HEIGHT;
    this.line(rect.x + 6, peopleY - 2, rect.w - 12);
    const people = [{ id: 'clerk_vendor', label: '售货员' }, { id: 'customer_neighbor', label: '街角顾客' }, { id: 'customer_family', label: '家庭采购客' }];
    for (let index = 0; index < people.length; index++) {
      const item = people[index], x = rect.x + slot * index;
      this.sprite(item.id, { x: x + 3, y: peopleY + 9, w: slot - 6, h: 125 }, { align: [.5, 1] });
      this.text(item.label, x + slot / 2, peopleY + 149, slot - 8, 11, C.ink, 600, 'center');
    }
  }
}

module.exports = { V13Showroom, V13_PRODUCTS, showroomAssetIds };
