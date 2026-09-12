'use strict';

const { V13OrderGame } = require('./v13-order-core');
const { MODE } = require('./v13-order-mode');
const { createPlatform } = require('./platform');
const { createArtAssets } = require('./art-assets');
const { ART_ASSETS, ART_RUNTIME_IDS } = require('./art-manifest');
const { createV13ArtAssets } = require('./v13-art-assets');
const { V13_SCENE_ART_ASSETS } = require('./v13-scene-art-manifest');
const { V13OrderScene, orderSceneAssetIds, orderSceneEnvironmentAssetIds } = require('./v13-order-scene');
const { AudioEngine } = require('./audio');
const { APP_VERSION } = require('./version');

const root = typeof globalThis !== 'undefined' ? globalThis : GameGlobal;
const platform = createPlatform(), canvas = platform.canvas, ctx = canvas.getContext('2d');
const sound = new AudioEngine(), art = createArtAssets(), v13Art = createV13ArtAssets();
// Environment art owns a separate on-demand selection, with the same 4 MiB
// cap and stale-request/retry handling as the product and character pack.
const sceneArt = createV13ArtAssets({ assets: V13_SCENE_ART_ASSETS });
const baseDecodedBytes = ART_RUNTIME_IDS.reduce((sum, id) => sum + ART_ASSETS[id].decodedBytes, 0);
art.loadAll();
v13Art.select(orderSceneAssetIds('factory'));
sceneArt.select(orderSceneEnvironmentAssetIds('factory'));
const renderer = new V13OrderScene({ canvas, art, v13Art, sceneArt });
const initialSave = platform.load(), initialError = platform.lastStorageError;
let game = new V13OrderGame({ save: initialSave });
const ui = { scene: 'factory', scroll: 0, transfer: null, delivery: null, message: '', saveError: '',
  recoveryBlocked: !!(initialError || game.loadWarning), viewport: null };
if (ui.recoveryBlocked) ui.saveError = '试玩存档未能读取，已暂停，请重试读取';
let hidden = false, lastTime = null, saveTimer = 0, messageTimer = 0, ratio = 1, pointer = null, blockedInput = false;
const pointers = new Set(), DRAG_DISTANCE = 8;
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const contains = (r, x, y) => !!r && x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
const reasons = { 'source-empty': '还没有可搬的货物', 'target-full': '入口已满，等这一批加工',
  'stock-empty': '货架还没有可用成品', 'no-stock': '货架还没有可用成品', 'wrong-target': '请放到对应入口',
  'order-complete': '这位顾客的订单已完成', 'unknown-order': '这笔订单已离开',
  'order-not-found': '这笔订单已离开', 'order-satisfied': '这笔订单已经配齐', 'invalid-order': '这笔订单已离开' };

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
  cancelGesture(true); ui.scene = scene; ui.scroll = 0;
  v13Art.select(orderSceneAssetIds(scene));
  sceneArt.select(orderSceneEnvironmentAssetIds(scene));
}
function act(action) {
  if (!action) return;
  if (action === 'reload-save') {
    if (!ui.recoveryBlocked) return;
    cancelGesture(true);
    const saved = platform.load(), error = platform.lastStorageError;
    const restored = new V13OrderGame({ save: saved });
    if (error || restored.loadWarning) { message('仍无法读取，原试玩存档已保留'); return; }
    game = restored; ui.recoveryBlocked = false; ui.saveError = ''; lastTime = null;
    message('试玩进度已恢复'); return;
  }
  if (action === 'retry-art') { art.retryFailed(); v13Art.retryFailed(); sceneArt.retryFailed(); return; }
  if (ui.recoveryBlocked) return;
  if (action === 'retry-save') { persist(); return; }
  if (action === 'scene:factory' || action === 'scene:store') { setScene(action.slice(6)); return; }
  if (action.indexOf('cancel-order:') === 0) {
    cancelGesture(true);
    const result = game.cancelOrder(action.slice(13));
    message(result.ok ? '订单已取消，已配货物回到可用库存' : reasons[result.reason] || '订单已更新');
    processEvents(); persist();
  }
}
function scroll(delta) {
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
    const kind = ui.recoveryBlocked ? null : sourceMatch ? 'transfer' : action === 'delivery:original' ? 'delivery' : null;
    const content = renderer.layout && renderer.layout.content;
    pointer = { id, action, x, y, lastY: y, moved: false, attempted: false, kind,
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
    if (!current.moved && distance < DRAG_DISTANCE && current.action === action) act(action);
  }
});
if (platform.onScroll) platform.onScroll(event => {
  if (hidden || ui.transfer || ui.delivery) return;
  if (contains(renderer.layout && renderer.layout.content, event.x, event.y)) scroll(finite(event.deltaY));
});
if (platform.onInputCancel) platform.onInputCancel(() => cancelGesture(true));
function resize(info = {}) {
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
platform.onHide(() => { hidden = true; cancelGesture(true); lastTime = null; sound.setEnabled(false); persist(); });
platform.onShow(() => { hidden = false; lastTime = null; sound.setEnabled(true); });
if (!platform.isDouyin && typeof document !== 'undefined') {
  document.title = '小小爆米花厂 · v1.3 订单试玩';
  canvas.id = 'game'; canvas.tabIndex = 0; canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', '订单试玩：拖动场内两段货盘完成包装，再把货架成品拖给顾客成交');
  const instructions = document.getElementById('instructions');
  if (instructions) instructions.textContent = '订单试玩使用独立存档。按住货盘拖入对应入口，包装完成仅入成品库。到客户区，把货架原味拖入取货袋，配齐订单才收款。取消订单释放已配货物。F进入生产区，O进入客户区，Escape取消拖拽。';
  const loading = document.getElementById('loading'); if (loading) loading.remove();
  window.addEventListener('keydown', event => {
    if (event.repeat || hidden) return;
    const action = { KeyF: 'scene:factory', KeyO: 'scene:store' }[event.code];
    if (action || event.code === 'Escape') { event.preventDefault(); cancelGesture(true); if (action) act(action); }
  });
}
root.__POPCORN__ = Object.freeze({ version: APP_VERSION, mode: MODE,
  snapshot: () => game.getView(), analytics: () => platform.getAnalytics(),
  presentation: () => JSON.parse(JSON.stringify({ scene: ui.scene, layout: renderer.layout, zones: renderer.zones,
    diagnostics: renderer.diagnostics, transfer: ui.transfer, delivery: ui.delivery, message: ui.message,
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
