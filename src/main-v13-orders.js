'use strict';

const { MODE } = require('./v13-order-mode');
const { loadOrderSession } = require('./order-session');
const { describeOffer, quoteMatches } = require('./purchase-quotes');
const { createArtAssets } = require('./art-assets');
const { ART_ASSETS, ART_RUNTIME_IDS } = require('./art-manifest');
const { createV13ArtAssets } = require('./v13-art-assets');
const { V13_SCENE_ART_ASSETS } = require('./v13-scene-art-manifest');
const { V13OrderScene, orderSceneAssetIds, orderSceneEnvironmentAssetIds } = require('./v13-order-scene');
const { AudioEngine } = require('./audio');
const { APP_VERSION } = require('./version');

function startOrderGame({ platform, session }) {
const root = typeof globalThis !== 'undefined' ? globalThis : GameGlobal;
const canvas = platform.canvas, ctx = canvas.getContext('2d');
const sound = new AudioEngine(), art = createArtAssets(), v13Art = createV13ArtAssets();
// Environment art owns a separate on-demand selection, with the same 4 MiB
// cap and stale-request/retry handling as the product and character pack.
const sceneArt = createV13ArtAssets({ assets: V13_SCENE_ART_ASSETS });
const baseDecodedBytes = ART_RUNTIME_IDS.reduce((sum, id) => sum + ART_ASSETS[id].decodedBytes, 0);
art.loadAll();
v13Art.select(orderSceneAssetIds('factory'));
sceneArt.select(orderSceneEnvironmentAssetIds('factory'));
const renderer = new V13OrderScene({ canvas, art, v13Art, sceneArt });
let game = session.game;
const ui = { scene: 'factory', scroll: 0, transfer: null, delivery: null, message: '', saveError: '',
  recoveryBlocked: !!session.recoveryBlocked, viewport: null, modal: null, quote: null };
if (ui.recoveryBlocked) ui.saveError = session.message || '存档未能读取，已暂停，请重试读取';
else if (session.message) ui.message = session.message;
let hidden = false, lastTime = null, saveTimer = 0, messageTimer = ui.message ? 8 : 0, ratio = 1, pointer = null, blockedInput = false;
let modalSerial = 0, quoteSerial = 0;
let pendingCompatibility = null, stopped = false;
const pointers = new Set(), DRAG_DISTANCE = 8;
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const contains = (r, x, y) => !!r && x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
const reasons = { 'source-empty': '还没有可搬的货物', 'target-full': '入口已满，等这一批加工',
  'stock-empty': '货架还没有可用成品', 'no-stock': '货架还没有可用成品', 'wrong-target': '请放到对应入口',
  'order-complete': '这位顾客的订单已完成', 'unknown-order': '这笔订单已离开',
  'order-not-found': '这笔订单已离开', 'order-satisfied': '这笔订单已经配齐', 'invalid-order': '这笔订单已离开',
  'not-enough-coins': '金币不足', 'max-level': '已完成全部改造', 'machine-required': '需要先扩建工厂',
  'already-automated': '这段转运已经自动化', 'tutorial-required': '先手动完成这一段转运',
  'manual-transfer-required': '先手动完成这一段转运', 'no-active-batch': '等待当前工位获得合法批次',
  'assist-rate-limit': '稍等片刻再助力', 'assist-cap': '助力已达持续增益上限',
  'already-purchased': '已购买', 'salesperson-required': '先购买基础售货员',
  'sales-required': '整单成交数量尚未达标', 'throughput-required': '实际加工能力尚未达标',
  'expansion-not-ready': '扩建条件尚未达到', 'max-machine': '已完成全部扩建',
  'stale-quote': '报价已更新，请返回重新查看' };

function message(text) { ui.message = text; messageTimer = 3.5; }
function cancelGesture(clearPointers = false) {
  if (ui.transfer) game.cancelTransfer(ui.transfer.token);
  if (ui.delivery) game.cancelDelivery(ui.delivery.token);
  ui.transfer = null; ui.delivery = null; pointer = null;
  if (clearPointers) { pointers.clear(); blockedInput = false; }
}
function persist() {
  if (ui.recoveryBlocked) return false;
  cancelGesture(true);
  const ok = platform.save(game.exportSave());
  ui.saveError = ok ? '' : '进度未保存，请重试';
  return ok;
}
function processEvents() {
  for (const event of game.drainEvents()) {
    if (event.type === 'order-settled') {
      const coins = event.coins == null ? event.quote : event.coins;
      message('订单成交，收入 ' + coins + ' 金币'); sound.play('ship');
      platform.track('order-settled', event);
    }
  }
}
function setScene(scene) {
  if (scene !== 'factory' && scene !== 'store') return;
  cancelGesture(true); closeModal(); ui.scene = scene; ui.scroll = 0;
  v13Art.select(orderSceneAssetIds(scene));
  sceneArt.select(orderSceneEnvironmentAssetIds(scene));
}
function closeModal() { ui.modal = null; ui.quote = null; modalSerial++; }
function openModal(type) {
  cancelGesture(true); ui.quote = null; modalSerial++;
  ui.modal = { type, scroll: 0, error: '' };
}
function showOffer(key) {
  if (!ui.modal || ui.modal.type !== 'manage') return;
  const offer = describeOffer(game.getView(), key);
  if (!offer) { message('这项能力已完成，或暂未开放'); return; }
  openModal('purchase');
  ui.quote = { ...offer, id: String(++quoteSerial), fingerprint: JSON.stringify(offer) };
}
function purchase(id) {
  const quote = ui.quote;
  if (!ui.modal || ui.modal.type !== 'purchase' || !quote || quote.id !== id || quote.used) return;
  if (!quoteMatches(quote, game.getView())) { ui.modal.error = reasons['stale-quote']; return; }
  // The quote is single-use even if host input repeats a release event.
  quote.used = true;
  const result = quote.kind === 'upgrade' ? game.buyUpgrade(quote.stationId)
    : quote.kind === 'automation' ? game.buyAutomation(quote.source)
    : quote.kind === 'logistics' ? game.buyLogisticsUpgrade()
    : quote.kind === 'salesperson' ? game.buySalesperson() : game.evolve();
  if (!result.ok) {
    quote.used = false;
    ui.modal.error = reasons[result.reason] || '当前条件尚未达到';
    return;
  }
  openModal('receipt'); ui.modal.message = '已购买 ' + quote.name + ' · ' + quote.cost + ' 金币';
  sound.play('upgrade'); processEvents(); persist();
}
function act(action) {
  if (!action) return;
  if (action === 'reload-save') {
    if (!ui.recoveryBlocked) return;
    cancelGesture(true);
    const restored = loadOrderSession(platform);
    if (restored.compatibility) {
      // loadOrderSession has selected the legacy storage key. Retire this
      // paused controller before the compatible runtime starts on the next
      // frame, so no order save or second simulation can reach that key.
      pendingCompatibility = restored; return;
    }
    if (restored.recoveryBlocked) { message(restored.message || '仍无法读取，原存档已保留'); return; }
    game = restored.game; ui.recoveryBlocked = false; ui.saveError = ''; lastTime = null;
    message(restored.message || '经营进度已恢复'); return;
  }
  if (action === 'retry-art') { art.retryFailed(); v13Art.retryFailed(); sceneArt.retryFailed(); return; }
  if (ui.recoveryBlocked) return;
  if (action === 'retry-save') { persist(); return; }
  if (action === 'scene:factory' || action === 'scene:store') { setScene(action.slice(6)); return; }
  if (action === 'open-assist' || action === 'open-manage') { openModal(action.slice(5)); return; }
  if (action === 'close-modal') { cancelGesture(true); closeModal(); return; }
  if (action === 'manage-back') { openModal('manage'); return; }
  if (action.indexOf('offer:') === 0) { showOffer(action.slice(6)); return; }
  if (action.indexOf('purchase:') === 0) { purchase(action.slice(9)); return; }
  if (/^assist:(pop|cup|ship)$/.test(action) && ui.modal && ui.modal.type === 'assist') {
    const result = game.assist(action.slice(7));
    if (!result.ok) ui.modal.error = reasons[result.reason] || '当前批次暂不可助力';
    else { ui.modal.error = ''; sound.play('click'); processEvents(); }
    return;
  }
  if (ui.modal) return;
  if (action.indexOf('handoff-order:') === 0) {
    cancelGesture(true);
    const result = game.handoffOrder(action.slice(14));
    message(result.ok ? '已交给售货员，将按服务周期接续配货' : reasons[result.reason] || '订单已更新');
    processEvents(); persist(); return;
  }
  if (action.indexOf('cancel-order:') === 0) {
    cancelGesture(true);
    const result = game.cancelOrder(action.slice(13));
    message(result.ok ? '订单已取消，已配货物回到可用库存' : reasons[result.reason] || '订单已更新');
    processEvents(); persist();
  }
}
function scroll(delta) {
  if (ui.modal) { ui.modal.scroll = clamp(finite(ui.modal.scroll) + delta, 0, finite(renderer.layout && renderer.layout.modalContent && renderer.layout.modalContent.scrollMax)); return; }
  const content = renderer.layout && renderer.layout.content;
  if (content) ui.scroll = clamp(finite(ui.scroll) + delta, 0, finite(content.scrollMax));
}
function advanceDrag(current, x, y) {
  const moved = Math.hypot(x - current.x, y - current.y) >= DRAG_DISTANCE;
  if (!current.moved && moved) current.moved = true;
  if (!current.moved) return;
  if (!ui.transfer && !ui.delivery && !current.attempted) {
    current.attempted = true;
    const result = current.kind === 'transfer' ? game.reserveTransfer(current.source) : game.beginDelivery('original');
    if (!result.ok) { message(reasons[result.reason] || '现在没有可配货物'); return; }
    const held = Object.assign({}, result, { productId: 'original', source: current.source,
      target: current.source === 'pop' ? 'cup' : 'ship', x, y, dragging: true });
    if (current.kind === 'transfer') ui.transfer = held; else ui.delivery = held;
  }
  const held = ui.transfer || ui.delivery;
  if (held) { held.x = x; held.y = y; held.overTarget = !!dropTarget(x, y); }
}
function dropTarget(x, y) {
  if (ui.modal) return null;
  if (ui.transfer) return renderer.transferTargetAt(x, y, ui.transfer.source);
  if (ui.delivery) {
    const action = renderer.actionAt(x, y);
    if (action && action.indexOf('order:') === 0) {
      const id = action.slice(6), order = game.getView().orders.find(item => item.id === id);
      if (order && order.items.original > order.reserved.original) return id;
    }
  }
  return null;
}
function finishDrag(x, y) {
  const target = dropTarget(x, y), held = ui.transfer || ui.delivery;
  if (!held || !target) { cancelGesture(); if (held) message('未放入对应入口，货物已归还'); return; }
  const isDelivery = !!ui.delivery;
  const result = isDelivery ? game.deliver(held.token, target) : game.commitTransfer(held.token);
  cancelGesture();
  if (!result.ok) message(reasons[result.reason] || '配货未完成，货物已归还');
  else if (isDelivery) message('已配入 ' + result.amount + ' 份');
  else message('已送入 ' + result.amount + ' 份，继续加工');
  processEvents(); persist();
}

platform.onPointer(event => {
  if (stopped || pendingCompatibility) return;
  const id = event.id == null ? 0 : event.id, x = event.x, y = event.y;
  if (event.type === 'down') {
    const duplicate = pointers.has(id); pointers.add(id);
    if (duplicate || pointers.size > 1) { blockedInput = true; cancelGesture(); return; }
  } else if (event.type === 'up' || event.type === 'cancel') pointers.delete(id);
  if (blockedInput) { if (!pointers.size) blockedInput = false; return; }
  if (hidden) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) { cancelGesture(); return; }
  if (event.type === 'cancel') { if (pointer && pointer.id === id) cancelGesture(); return; }
  const action = renderer.actionAt(x, y);
  if (event.type === 'down') {
    if (!contains({ x: 0, y: 0, w: ui.viewport.width, h: ui.viewport.height }, x, y)) return;
    sound.unlock();
    const sourceMatch = /^transfer-source-(pop|cup)$/.exec(action || '');
    const kind = ui.recoveryBlocked || ui.modal ? null : sourceMatch ? 'transfer' : action === 'delivery:original' ? 'delivery' : null;
    const content = renderer.layout && (ui.modal ? renderer.layout.modalContent : renderer.layout.content);
    pointer = { id, action, x, y, lastY: y, moved: false, attempted: false, kind, modalSerial,
      source: sourceMatch ? sourceMatch[1] : null, scrollable: !kind && contains(content, x, y) };
    return;
  }
  if (!pointer || pointer.id !== id) return;
  const current = pointer, distance = Math.hypot(x - current.x, y - current.y);
  if (event.type === 'move') {
    if (current.kind) advanceDrag(current, x, y);
    else {
      if (distance >= DRAG_DISTANCE) current.moved = true;
      if (current.scrollable && current.moved) scroll(current.lastY - y);
      current.lastY = y;
    }
  } else if (event.type === 'up') {
    if (current.kind) { advanceDrag(current, x, y); finishDrag(x, y); return; }
    pointer = null;
    if (!current.moved && distance < DRAG_DISTANCE && current.action === action && current.modalSerial === modalSerial) act(action);
  }
});
if (platform.onScroll) platform.onScroll(event => {
  if (stopped || pendingCompatibility || hidden || ui.transfer || ui.delivery) return;
  if (contains(renderer.layout && (ui.modal ? renderer.layout.modalContent : renderer.layout.content), event.x, event.y)) scroll(finite(event.deltaY));
});
if (platform.onInputCancel) platform.onInputCancel(() => { if (!stopped && !pendingCompatibility) cancelGesture(true); });
function resize(info = {}) {
  if (stopped || pendingCompatibility) return;
  cancelGesture(true);
  const width = Math.max(1, finite(info.width, 480)), height = Math.max(1, finite(info.height, 840));
  ratio = clamp(finite(info.pixelRatio, 1), 1, 2);
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const safe = info.safeArea || {}, menu = info.menuButton;
  const top = clamp(finite(safe.top), 0, height / 2);
  ui.viewport = { width, height, safeTop: top, safeBottom: clamp(height - finite(safe.bottom, height), 0, height / 2),
    safeLeft: clamp(finite(safe.left), 0, width / 3), safeRight: clamp(width - finite(safe.right, width), 0, width / 3),
    menuButton: menu || null, menuBottom: platform.isDouyin ? menu ? menu.bottom : top + 40 : 0 };
  ui.scroll = 0;
}
platform.onResize(resize);
platform.onHide(() => { if (stopped || pendingCompatibility) return; hidden = true; cancelGesture(true); lastTime = null; sound.setEnabled(false); persist(); });
platform.onShow(() => { if (stopped || pendingCompatibility) return; hidden = false; lastTime = null; sound.setEnabled(true); });
if (!platform.isDouyin && typeof document !== 'undefined') {
  document.title = '小小爆米花厂 · 生产与直售';
  canvas.id = 'game'; canvas.tabIndex = 0; canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', '生产与直售：两段货盘完成包装，成品配齐顾客整单收款，可点击助力、改造和购买自动化');
  const instructions = document.getElementById('instructions');
  if (instructions) instructions.textContent = '拖动 A/B 货盘到对应入口，包装只进入共享成品库。到直售区把原味拖给顾客，整单配齐自动收款。助力面板只加快当前批次；经营面板购买改造、转运与售货员。人工部分配货须点“交给售货员”后才自动接续。F生产，O直售，A助力，U经营，Escape关闭弹窗或取消拖拽。';
  const loading = document.getElementById('loading'); if (loading) loading.remove();
  window.addEventListener('keydown', event => {
    if (stopped || pendingCompatibility || event.repeat || hidden) return;
    const action = { KeyF: 'scene:factory', KeyO: 'scene:store', KeyA: 'open-assist', KeyU: 'open-manage' }[event.code];
    if (action || event.code === 'Escape') { event.preventDefault(); cancelGesture(true); if (action) act(action); else closeModal(); }
  });
}
root.__POPCORN__ = Object.freeze({ version: APP_VERSION, mode: MODE,
  snapshot: () => game.getView(), analytics: () => platform.getAnalytics(),
  presentation: () => JSON.parse(JSON.stringify({ scene: ui.scene, layout: renderer.layout, zones: renderer.zones,
    diagnostics: renderer.diagnostics, transfer: ui.transfer, delivery: ui.delivery, message: ui.message, modal: ui.modal, quote: ui.quote,
    saveError: ui.saveError, recoveryBlocked: ui.recoveryBlocked, art: art.report(), v13Art: v13Art.report(),
    sceneArt: sceneArt.report(), artMemory: {
      baseDecodedBytes, optionalDecodedBytes: v13Art.report().decodedBytes + sceneArt.report().decodedBytes,
      totalDecodedBytes: baseDecodedBytes + v13Art.report().decodedBytes + sceneArt.report().decodedBytes,
      estimate: 'selected image dimensions only; excludes canvas, GPU copies and host caches'
    } })) });
resize(platform.getSystemInfo());
if (!ui.recoveryBlocked) persist();
const requestFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame.bind(root)
  : callback => setTimeout(() => callback(Date.now()), 1000 / 30);
function frame(time) {
  if (stopped) return;
  if (pendingCompatibility) {
    stopped = true; sound.setEnabled(false);
    require('./legacy-main').startLegacyGame(platform, pendingCompatibility.legacySave, pendingCompatibility.message);
    return;
  }
  const elapsed = lastTime === null ? 0 : Math.max(0, (time - lastTime) / 1000), dt = elapsed < 2 ? elapsed : 0;
  // Allow normal 1 Hz foreground throttling (including timer jitter). A gap
  // of two seconds or more contributes no catch-up production, and is not
  // an input cancellation. Slow, continuous drags remain valid; actual
  // hide, focus loss, resize and pointer cancellation release their holds.
  lastTime = time;
  if (!hidden) {
    if (!ui.recoveryBlocked) { game.tick(dt); processEvents(); }
    saveTimer += dt;
    if (saveTimer >= 5 && !pointer && !pointers.size && !ui.transfer && !ui.delivery) { saveTimer = 0; persist(); }
    messageTimer -= dt; if (messageTimer <= 0) ui.message = '';
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    renderer.draw(game.getView(), ui, Math.min(.1, dt));
  }
  requestFrame(frame);
}
requestFrame(frame);
}
module.exports = { startOrderGame };
