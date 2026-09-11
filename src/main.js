'use strict';
const { Game, CONFIG } = require('./core');
const { createPlatform } = require('./platform');
const { AudioEngine } = require('./audio');
const { Renderer } = require('./renderer');
const { ProductionInsights } = require('./production-insights');
const { createArtAssets } = require('./art-assets');
const { APP_VERSION } = require('./version');
const { describeOffer, quoteMatches } = require('./purchase-quotes');

// Input and presentation never edit authoritative stock or money.
const platform = createPlatform();
const canvas = platform.canvas, ctx = canvas.getContext('2d'), sound = new AudioEngine();
const initialSave = platform.load(), initialLoadError = platform.lastStorageError;
const experiment = platform.config.experiment === CONFIG.transferExperiment.id ? CONFIG.transferExperiment.id : null;
const mode = !experiment && platform.config.mode !== 'baseline' ? 'v15' : null;
let migrationPending = mode === 'v15' && initialSave && initialSave.version === CONFIG.version;
let game = new Game({ save: initialSave, experiment, mode: migrationPending ? null : mode });
const art = createArtAssets();
art.loadAll();
let renderer = new Renderer(ctx, art), insights = new ProductionInsights();
const ui = { modal: null, quote: null, quotes: {}, toast: '', toastSeconds: 0,
  isDouyin: platform.isDouyin, newFactory: !game.state.introSeen,
  elapsedSeconds: 0, rateUpdatingUntil: 0, shipment: null, purchaseFeedback: null,
  transfer: null, press: null, transferFeedback: null, tutorial: null, saveError: '',
  loadError: game.loadWarning || (initialLoadError ? '存档读取失败，当前工厂已使用恢复数据' : '') };
let width = 480, height = 840, ratio = 1;
let hidden = false, lastTime = null, saveTimer = 0, pointer = null, inputBlocked = false;
let modalSerial = 0, nextQuoteId = 0, purchaseGuard = null;
const activePointers = new Set();
const teaching = { pop: { nextAt: 0, failures: 0 }, cup: { nextAt: 0, failures: 0 } };
let pendingShipment = { amount: 0, coins: 0 }, lastShipmentTick = -Infinity;
const shipmentInterval = Math.ceil(CONFIG.ticksPerSecond * .65);
const stationIds = ['pop', 'cup', 'ship'], DRAG_DISTANCE = 8;
const reasons = {
  'not-enough-coins': '金币不足', 'max-level': '已满级', 'machine-required': '需先扩建',
  'max-machine': '六代工厂已建成', 'sales-required': '出货数量尚未达标',
  'throughput-required': '实际出货尚未达标', 'expansion-not-ready': '扩建条件尚未达到',
  'source-empty': '缺料', 'target-full': '已满', 'already-automated': '已自动',
  'automation-required': '需接通两段自动转运', 'automatic-trial-required': '需完成自动试运行',
  'experiment-complete': '归档实验未开放扩建', 'wrong-target': '放错入口',
  'outside': '未放入入口', 'stale-quote': '报价已更新，请重新查看'
};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const transferSource = action => {
  if (action === 'transfer:source' && experiment) return 'pop';
  const match = /^transfer-source-(pop|cup)$/.exec(action || '');
  return match ? match[1] : null;
};
function routeView(source, view = game.getView()) {
  return view.mode === 'v15' ? view.transfers.find(row => row.source === source) : source === 'pop' ? view.transfer : null;
}
function toast(message) { ui.toast = message; ui.toastSeconds = 3.5; }
function configure() { sound.setEnabled(!hidden && game.state.settings.sound); }
function endpoint(source, target) {
  const frames = renderer.scene && renderer.scene.transferFrames || [];
  const frame = frames.find(row => row.source === source && (target ? row.kind === 'input' : row.kind === 'tray'));
  return frame ? [frame.x + frame.w/2, frame.y + frame.h/2] : null;
}
function feedback(kind, held, reason = '', amount) {
  if (!held) return;
  const a = endpoint(held.source, false) || [finite(held.startX, held.x), finite(held.startY, held.y)];
  const b = endpoint(held.source, true) || [held.x, held.y];
  ui.transferFeedback = { kind, source: held.source, target: held.target, amount: amount == null ? held.amount : amount,
    x: held.x, y: held.y, sourceX: a[0], sourceY: a[1], targetX: b[0], targetY: b[1],
    reason: reasons[reason] || reason, age: 0, duration: kind === 'invalid' ? 1.2 : .2 };
}
function cancelTransfer(reason = 'cancel', animate = true) {
  const held = ui.transfer;
  if (held) {
    game.cancelTransfer(held.token);
    if (animate && !hidden) feedback(['wrong-target','target-full','outside'].includes(reason) ? 'invalid' : 'cancel', held, reason);
    platform.track('transfer_cancelled', { source: held.source, reason, playedSeconds: game.state.playedSeconds });
    if (['wrong-target','outside','target-full'].includes(reason)) {
      const lesson = teaching[held.source];
      if (lesson && ++lesson.failures >= 2) { lesson.nextAt = ui.elapsedSeconds + .4; lesson.failures = 0; }
    }
  }
  ui.transfer = null; ui.press = null; pointer = null;
}
function clearInput(reason, clearPointers = true) {
  cancelTransfer(reason, false); ui.tutorial = null; ui.transferFeedback = null;
  if (clearPointers) { activePointers.clear(); inputBlocked = false; }
}
function save() {
  // Every actual save is a gesture boundary. Autosave waits for idle input.
  cancelTransfer('save', false);
  activePointers.clear(); inputBlocked = false;
  let candidate = game;
  if (migrationPending) {
    candidate = new Game({ save: game.exportSave(), mode });
    if (candidate.loadWarning) { ui.saveError = '旧档迁移校验失败，当前工厂仍可运行'; toast(ui.saveError); return false; }
  }
  const ok = platform.save(candidate.exportSave());
  if (ok && migrationPending) { game = candidate; migrationPending = false; insights = new ProductionInsights(); }
  if (!ok && !ui.saveError) toast('进度暂未保存，请检查设备存储空间');
  ui.saveError = ok ? '' : '进度未保存，请重试';
  return ok;
}
function processEvents() {
  for (const event of game.drainEvents()) {
    renderer.emit(event);
    if (event.type === 'ship') { pendingShipment.amount += event.amount; pendingShipment.coins += event.coins; }
    if (['upgrade','evolve','automation','logistics-upgrade'].includes(event.type)) {
      sound.play(event.type === 'evolve' ? 'machine' : 'upgrade');
      if (game.state.settings.haptics) platform.vibrate();
      platform.track(event.type, { ...event, playedSeconds: game.state.playedSeconds });
    }
    if (['first-sale','transfer','automatic-trial'].includes(event.type)) platform.track(event.type, { ...event, playedSeconds: game.state.playedSeconds });
  }
  const tick = game.state.simulation.ticks;
  if (pendingShipment.amount && tick-lastShipmentTick >= shipmentInterval) {
    ui.shipment = { ...pendingShipment, atTick: tick }; pendingShipment = { amount: 0, coins: 0 };
    lastShipmentTick = tick; sound.play('ship');
  }
}
function resize(info = {}) {
  clearInput('resize');
  purchaseGuard = null;
  width = Math.max(1, finite(info.width, 480)); height = Math.max(1, finite(info.height, 840));
  ratio = clamp(finite(info.pixelRatio, 1), 1, 2);
  canvas.width = Math.round(width*ratio); canvas.height = Math.round(height*ratio);
  const safe = info.safeArea || {}, validX = Number.isFinite(safe.left) && Number.isFinite(safe.right)
    && safe.left >= 0 && safe.right <= width && safe.left < safe.right;
  const validY = Number.isFinite(safe.top) && Number.isFinite(safe.bottom)
    && safe.top >= 0 && safe.bottom <= height && safe.top < safe.bottom;
  const safeTop = validY ? safe.top : clamp(finite(info.statusBarHeight), 0, height/3), menu = info.menuButton;
  const menuButton = menu && ['left','top','right','bottom'].every(key => Number.isFinite(menu[key]))
    && menu.left >= 0 && menu.top >= 0 && menu.right <= width && menu.bottom <= height
    && menu.right > menu.left && menu.bottom > menu.top
    ? { left: menu.left, top: menu.top, right: menu.right, bottom: menu.bottom, width: menu.right-menu.left, height: menu.bottom-menu.top } : null;
  ui.viewport = { width, height, safeTop, safeBottom: validY ? height-safe.bottom : 0,
    safeLeft: validX ? safe.left : 0, safeRight: validX ? width-safe.right : 0,
    menuButton, menuBottom: platform.isDouyin ? menuButton ? menuButton.bottom : safeTop+40 : 0 };
  if (ui.modal) ui.modal.scroll = 0;
}
function closeModal() {
  if (ui.modal) platform.track('modal_close', { type: ui.modal.type });
  ui.modal = null; ui.quote = null; ui.quotes = {}; modalSerial++;
}
function prepareQuotes() {
  ui.quote = null; ui.quotes = {};
  if (!ui.modal) return;
  const view = game.getView(), type = ui.modal.type;
  const keys = type === 'station' ? ['upgrade-'+ui.modal.stationId]
    : type === 'logistics' ? ['automate-pop','automate-cup','logistics'] : type === 'expansion' ? ['expansion'] : [];
  for (const key of keys) {
    const offer = describeOffer(view, key); if (!offer) continue;
    const id = String(++nextQuoteId), quote = { ...offer, id, action: 'purchase:'+id, fingerprint: JSON.stringify(offer) };
    ui.quotes[offer.kind === 'upgrade' ? 'upgrade' : key] = quote;
    if (offer.kind === 'upgrade') ui.quote = quote;
  }
}
function openModal(type, stationId) {
  cancelTransfer('modal', false); ui.tutorial = null;
  purchaseGuard = null;
  ui.modal = { type, scroll: 0, openedAt: ui.elapsedSeconds, error: '' };
  if (stationId) ui.modal.stationId = stationId;
  modalSerial++; prepareQuotes(); sound.play('click');
  platform.track('modal_open', { type, stationId: stationId || '' });
}
function purchase(id) {
  if (!ui.modal) return;
  const quote = Object.values(ui.quotes).find(row => row.id === id);
  const expected = quote && (quote.kind === 'upgrade' ? 'station' : quote.kind === 'expansion' ? 'expansion' : 'logistics');
  if (!quote || expected !== ui.modal.type || quote.kind === 'upgrade' && quote.stationId !== ui.modal.stationId) return;
  if (!quoteMatches(quote, game.getView())) { ui.modal.error = reasons['stale-quote']; return; }
  const response = quote.kind === 'upgrade' ? game.buyUpgrade(quote.stationId)
    : quote.kind === 'automation' ? game.buyAutomation(quote.source)
    : quote.kind === 'logistics' ? game.buyLogisticsUpgrade() : game.evolve();
  if (!response || !response.ok) {
    ui.modal.error = response && response.reason === 'not-enough-coins'
      ? '还差 '+Math.max(0, quote.cost-game.state.coins)+' 金币' : reasons[response && response.reason] || '条件尚未达到';
    sound.play('error'); return;
  }
  quote.used = true;
  // A closing confirmation can overlap a machine. Consume the rest of a rapid
  // tap sequence at that old button until it pauses or deliberately moves away.
  const confirmation = renderer.zones.find(zone => zone.action === quote.action);
  purchaseGuard = confirmation ? { ...confirmation, until: ui.elapsedSeconds+.6 } : null;
  ui.purchaseFeedback = { stationId: quote.stationId, source: quote.source, name: quote.name, atTick: game.state.simulation.ticks, kind: quote.kind };
  ui.rateUpdatingUntil = game.state.simulation.ticks + CONFIG.ticksPerSecond*10;
  closeModal(); processEvents(); save();
}
function act(action, keyboard = false) {
  if (!action || hidden) return;
  sound.unlock();
  if (action === 'close') { cancelTransfer('escape'); closeModal(); return; }
  if (action === 'retry-art') { art.retryFailed(); return; }
  if (action === 'retry-save') { save(); return; }
  if (action === 'refreshQuotes' && ui.modal) { ui.modal.error = ''; prepareQuotes(); return; }
  if (/^purchase:\d+$/.test(action)) { purchase(action.slice(9)); return; }
  if (action === 'dismissIntro' && !ui.modal) { game.acknowledgeIntro(); ui.newFactory = false; save(); return; }
  const canOpen = !ui.modal || keyboard;
  if (canOpen && action === 'settings') { openModal('settings'); return; }
  if (canOpen && action === 'openStats') { openModal('stats'); return; }
  if (canOpen && action === 'openLogistics' && game.getView().mode === 'v15') { openModal('logistics'); return; }
  if (canOpen && action === 'openExpansion') { openModal('expansion'); return; }
  if (canOpen && action.startsWith('station:') && stationIds.includes(action.slice(8))) { openModal('station', action.slice(8)); return; }
  if (action.startsWith('setting:') && ui.modal && ui.modal.type === 'settings') {
    const key = action.slice(8);
    if (['sound','haptics'].includes(key)) { game.setSetting(key, !game.state.settings[key]); configure(); save(); }
    return;
  }
  if (action === 'restart' && ui.modal && ui.modal.type === 'settings') { openModal('restart'); return; }
  if (action === 'confirmRestart' && ui.modal && ui.modal.type === 'restart') {
    const fresh = new Game({ experiment, mode });
    if (!platform.save(fresh.exportSave())) { ui.modal.error = '重新开始失败，当前工厂已保留'; toast(ui.modal.error); return; }
    clearInput('restart'); game = fresh; migrationPending = false;
    renderer = new Renderer(ctx, art); insights = new ProductionInsights(); closeModal();
    ui.newFactory = true; ui.purchaseFeedback = null; ui.rateUpdatingUntil = 0; ui.shipment = null;
    ui.toast = ''; ui.toastSeconds = 0; ui.saveError = ''; ui.loadError = '';
    pendingShipment = { amount: 0, coins: 0 }; lastShipmentTick = -Infinity; lastTime = null; saveTimer = 0;
    for (const lesson of Object.values(teaching)) { lesson.nextAt = ui.elapsedSeconds; lesson.failures = 0; }
    configure();
  }
}
function beginTransfer(current, x, y) {
  const response = game.reserveTransfer(current.source);
  if (!response.ok) {
    feedback('invalid', { source: current.source, target: current.source === 'pop' ? 'cup' : 'ship', x, y, amount: 0, startX: current.x, startY: current.y }, response.reason);
    platform.track('transfer_invalid', { source: current.source, reason: response.reason });
    ui.press = null; pointer = null; return false;
  }
  sound.unlock();
  const view = game.getView(), trial = view.automaticTrial;
  ui.transfer = { token: response.token, source: current.source, target: response.target || (current.source === 'pop' ? 'cup' : 'ship'),
    amount: response.amount, x, y, startX: current.x, startY: current.y, pointerId: current.id,
    startedAt: ui.elapsedSeconds, dragging: true, overTarget: false,
    trialHint: trial && !trial.complete && view.transfers.every(row => row.automated) ? '投送将重计试运行' : '' };
  ui.press = null;
  platform.track('transfer_started', { source: current.source, amount: response.amount });
  return true;
}
function targetAt(x, y, source) {
  if (ui.modal || hidden || x < 0 || y < 0 || x > ui.viewport.width || y > ui.viewport.height) return null;
  return typeof renderer.transferTargetAt === 'function' ? renderer.transferTargetAt(x, y, source) : null;
}
function canDrop(x, y, source) {
  const target = targetAt(x, y, source), route = routeView(source);
  return !!target && !!route && route.inputAmount < route.inputCapacity;
}
function advanceDrag(current, x, y) {
  if (x < 0 || y < 0 || x > ui.viewport.width || y > ui.viewport.height) { cancelTransfer('outside'); return; }
  if (!ui.transfer && Math.hypot(x-current.x, y-current.y) >= DRAG_DISTANCE && !beginTransfer(current, x, y)) return;
  if (ui.transfer) { ui.transfer.x = x; ui.transfer.y = y; ui.transfer.overTarget = canDrop(x, y, current.source); }
}
function finishTransfer() {
  const held = ui.transfer; if (!held) return;
  // Dispose of the entire gesture before processing events or feedback.
  ui.transfer = null; ui.press = null; pointer = null;
  const response = game.commitTransfer(held.token);
  if (!response.ok) { game.cancelTransfer(held.token); feedback('invalid', held, response.reason); return; }
  feedback('success', held, '', response.amount); ui.transferFeedback.remaining = response.remaining || 0;
  teaching[held.source].failures = 0; ui.tutorial = null;
  if (game.state.settings.haptics) platform.vibrate();
  if (ui.newFactory) { game.acknowledgeIntro(); ui.newFactory = false; }
  platform.track('transfer_success', { source: held.source, amount: response.amount, duration: Math.max(0, ui.elapsedSeconds-held.startedAt) });
  processEvents(); save();
}
function modalContent() {
  const layout = renderer.interface && renderer.interface.layout;
  return ui.modal && layout && layout.modal && layout.modal.content;
}
function contains(rect, x, y) { return !!rect && x >= rect.x && x <= rect.x+rect.w && y >= rect.y && y <= rect.y+rect.h; }
function scrollModal(delta) {
  const content = modalContent(); if (!content || !ui.modal) return;
  ui.modal.scroll = clamp(finite(ui.modal.scroll)+delta, 0, Math.max(0, finite(content.scrollMax)));
}
platform.onPointer(event => {
  const id = event.id == null ? 0 : event.id, x = event.x, y = event.y;
  if (event.type === 'down') {
    const duplicate = activePointers.has(id); activePointers.add(id);
    if (duplicate || activePointers.size > 1) { inputBlocked = true; cancelTransfer('multitouch'); ui.tutorial = null; return; }
  } else if (event.type === 'up' || event.type === 'cancel') activePointers.delete(id);
  if (inputBlocked) { if (activePointers.size === 0) inputBlocked = false; return; }
  if (hidden) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) { if (pointer && pointer.id === id) cancelTransfer('invalid-coordinate'); return; }
  if (event.type === 'cancel') { if (pointer && pointer.id === id) cancelTransfer('pointercancel'); return; }
  const action = renderer.actionAt(x, y);
  if (event.type === 'down') {
    if (x < 0 || y < 0 || x > ui.viewport.width || y > ui.viewport.height) return;
    if (!ui.modal && purchaseGuard) {
      if (ui.elapsedSeconds < purchaseGuard.until && contains(purchaseGuard, x, y)) {
        purchaseGuard.until = ui.elapsedSeconds+.6; pointer = null; return;
      }
      purchaseGuard = null;
    }
    ui.tutorial = null;
    const source = !ui.modal && (experiment || game.getView().mode === 'v15') ? transferSource(action) : null;
    pointer = { id, action, x, y, lastY: y, source, serial: modalSerial, moved: false, scrollable: contains(modalContent(), x, y) };
    if (source) { ui.press = { source, x, y }; teaching[source].nextAt = ui.elapsedSeconds+5; }
    return;
  }
  if (!pointer || pointer.id !== id) return;
  const current = pointer, distance = Math.hypot(x-current.x, y-current.y);
  if (current.serial !== modalSerial) { cancelTransfer('modal'); return; }
  if (event.type === 'move') {
    if (current.source) { advanceDrag(current, x, y); return; }
    if (distance >= DRAG_DISTANCE) current.moved = true;
    if (current.scrollable && current.moved) scrollModal(current.lastY-y);
    current.lastY = y; return;
  }
  if (event.type !== 'up') return;
  if (current.source) {
    advanceDrag(current, x, y);
    if (ui.transfer && canDrop(x, y, current.source)) finishTransfer();
    else {
      const route = ui.transfer && routeView(current.source);
      const sameTarget = route && (action === 'transfer-target-'+route.target || experiment && action === 'transfer:target');
      cancelTransfer(sameTarget && route.inputAmount >= route.inputCapacity ? 'target-full'
        : /^transfer-target-/.test(action || '') ? 'wrong-target' : ui.transfer ? 'outside' : 'tap');
    }
    return;
  }
  pointer = null; ui.press = null;
  if (!current.moved && distance < DRAG_DISTANCE && current.action === action) act(action);
});
if (platform.onScroll) platform.onScroll(event => {
  if (!hidden && ui.modal && contains(modalContent(), event.x, event.y)) scrollModal(event.deltaY);
});
if (platform.onInputCancel) platform.onInputCancel(() => clearInput('focus'));
platform.onResize(resize);
platform.onHide(() => {
  hidden = true; clearInput('background'); lastTime = null;
  pendingShipment = { amount: 0, coins: 0 }; ui.shipment = null; configure(); save();
});
platform.onShow(() => { hidden = false; lastTime = null; configure(); });

// No keyboard action moves cargo or enables the retired tap path.
if (!platform.isDouyin && typeof document !== 'undefined') {
  canvas.id = 'game'; canvas.setAttribute('aria-label', '小小爆米花厂：从待装仓拖到装杯入口，再从待发仓拖到出货入口');
  const instructions = document.getElementById('instructions');
  if (instructions) instructions.textContent = '按住货仓，连续拖到对应入口后松手。A段把爆米花送入装杯机，B段把成品送入出货机，只有真实出货才结算金币。点击机器打开升级窗口，物流与扩建按需查看。快捷键1、2、3查看设备，Enter确认当前设备报价，L物流，M扩建，S设置，Escape取消拖拽或关闭窗口。';
  canvas.setAttribute('role', 'application'); canvas.tabIndex = 0;
  const loading = document.getElementById('loading'); if (loading) loading.remove();
  window.addEventListener('keydown', event => {
    if (event.repeat) return;
    const action = event.code === 'Escape' ? 'close'
      : event.code === 'Enter' && ui.modal && ui.modal.type === 'station' && ui.quote ? ui.quote.action
        : ({ Digit1: 'station:pop', Digit2: 'station:cup', Digit3: 'station:ship', KeyM: 'openExpansion', KeyL: 'openLogistics', KeyS: 'settings' })[event.code];
    if (action) { event.preventDefault(); cancelTransfer('keyboard'); act(action, true); }
  });
}
function updateTutorial(view) {
  if (pointer || ui.modal || ui.transfer || hidden) { ui.tutorial = null; return; }
  const routes = view.mode === 'v15' ? view.transfers : view.transfer ? [{ ...view.transfer, source: 'pop', target: 'cup' }] : [];
  const eligible = routes.find(row => !row.automated && !(view.mode === 'v15' ? row.manualTransfers : row.completedTransfers)
    && row.availableAmount > 0 && row.inputAmount < row.inputCapacity);
  if (!eligible) { ui.tutorial = null; return; }
  const lesson = teaching[eligible.source];
  if (ui.tutorial && ui.tutorial.source !== eligible.source) ui.tutorial = null;
  if (!ui.tutorial && ui.elapsedSeconds >= lesson.nextAt) ui.tutorial = { source: eligible.source, target: eligible.target, startedAt: ui.elapsedSeconds, progress: 0 };
  if (ui.tutorial) {
    ui.tutorial.progress = clamp((ui.elapsedSeconds-ui.tutorial.startedAt)/1.6, 0, 1);
    if (ui.tutorial.progress >= 1) { ui.tutorial = null; lesson.nextAt = ui.elapsedSeconds+5; }
  }
}
const runtimeGlobal = typeof globalThis !== 'undefined' ? globalThis : GameGlobal;
runtimeGlobal.__POPCORN__ = Object.freeze({ snapshot: () => game.getView(), analytics: () => platform.getAnalytics(), version: APP_VERSION,
  presentation: () => JSON.parse(JSON.stringify({ layout: renderer.interface && renderer.interface.layout, zones: renderer.zones,
    art: art.report(), scene: renderer.scene && renderer.scene.diagnostics,
    transfer: ui.transfer, modal: ui.modal, tutorial: ui.tutorial, quotes: ui.quotes })) });
configure(); resize(platform.getSystemInfo());
if (ui.loadError) toast(ui.loadError);
save();
const requestFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame.bind(runtimeGlobal) : callback => setTimeout(() => callback(Date.now()), 1000/30);
function frame(time) {
  const elapsed = lastTime === null ? 0 : Math.max(0, (time-lastTime)/1000), dt = elapsed <= 1 ? elapsed : 0;
  if (elapsed > 1) clearInput('stalled-frame');
  lastTime = time;
  if (!hidden) {
    game.tick(dt); processEvents(); ui.elapsedSeconds += dt;
    saveTimer += dt; if (saveTimer >= 5 && !ui.transfer && !pointer && activePointers.size === 0) { saveTimer = 0; save(); }
    if (ui.toastSeconds > 0) { ui.toastSeconds -= dt; if (ui.toastSeconds <= 0) ui.toast = ''; }
    if (ui.transferFeedback) { ui.transferFeedback.age += dt; if (ui.transferFeedback.age >= ui.transferFeedback.duration) ui.transferFeedback = null; }
    if (ui.transfer) ui.transfer.overTarget = canDrop(ui.transfer.x, ui.transfer.y, ui.transfer.source);
    const view = game.getView(); updateTutorial(view);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    renderer.draw(insights.enrich(view), ui, Math.min(.1, dt));
  }
  requestFrame(frame);
}
requestFrame(frame);
