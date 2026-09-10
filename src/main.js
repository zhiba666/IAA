'use strict';
const { Game, CONFIG } = require('./core');
const { createPlatform } = require('./platform');
const { AudioEngine } = require('./audio');
const { Renderer } = require('./renderer');
const { ProductionInsights } = require('./production-insights');
const { createArtAssets } = require('./art-assets');
const { APP_VERSION } = require('./version');

// The application owns input and lifecycle. Only Game advances stock or money.
const platform = createPlatform();
const canvas = platform.canvas, ctx = canvas.getContext('2d');
const sound = new AudioEngine();
const initialSave = platform.load();
const experiment = platform.config.experiment === CONFIG.transferExperiment.id ? CONFIG.transferExperiment.id : null;
const mode = !experiment && platform.config.mode !== 'baseline' ? 'v15' : null;
let migrationPending = mode === 'v15' && initialSave && initialSave.version === CONFIG.version;
let game = new Game({ save: initialSave, experiment, mode: migrationPending ? null : mode });
const art = createArtAssets();
art.loadAll();
let renderer = new Renderer(ctx, art);
let insights = new ProductionInsights();
const ui = { modal: null, toast: '', toastSeconds: 0, isDouyin: platform.isDouyin,
  newFactory: !game.state.introSeen,
  stationCollapsed: false, stationDetails: false, quote: null, purchaseFeedback: null,
  rateUpdatingUntil: 0, shipment: null, transfer: null };
let width = 480, height = 840, ratio = 1, ox = 0;
let hidden = false, lastTime = null, saveTimer = 0, pointer = null, saveFailed = false;
const activePointers = new Set();
let pendingShipment = { amount: 0, coins: 0 }, lastShipmentTick = -Infinity;
const shipmentInterval = Math.ceil(CONFIG.ticksPerSecond * .65);
const stationIds = ['pop', 'cup', 'ship'];
const reasons = {
  'not-enough-coins': '金币还不够，出货后再来改造',
  'max-level': '本阶段改造完成，继续扩建工厂',
  'machine-required': '扩建工厂后开放这项改造',
  'max-machine': '六代工厂已建成，继续优化生产线',
  'sales-required': '继续出货，达到本次扩建目标',
  'throughput-required': '改善瓶颈，达到目标出货速度',
  'expansion-not-ready': '扩建条件尚未达到',
  'stale-upgrade': '改造已更新，请重新查看工位',
  'source-empty': '这个货仓还没有货，等上一工位完成加工',
  'target-full': '进料位已满，等机器处理后再搬',
  'already-automated': '这段已经自动补料，无需再次购买',
  'automation-required': '先接通两段自动转运',
  'trial-required': '两段接通后，完成稳定自动试运行',
  'automatic-trial-required': '两段接通后，完成稳定自动试运行',
  'experiment-complete': '本次试玩先验证首段搬运，扩建暂未开放'
};
function toast(message) { ui.toast = message; ui.toastSeconds = 3.5; }
function configure() { sound.setEnabled(!hidden && game.state.settings.sound); }
function cancelTransfer() {
  if (ui.transfer) {
    game.cancelTransfer(ui.transfer.token);
    platform.track('transfer_cancelled', { source: ui.transfer.source || 'pop', playedSeconds: game.state.playedSeconds });
    toast('已取消搬运，货物保留在源仓');
  }
  ui.transfer = null;
  pointer = null;
}
function save() {
  if (ui.transfer) cancelTransfer();
  let candidate = game;
  if (migrationPending) {
    candidate = new Game({ save: game.exportSave(), mode });
    if (candidate.loadWarning) { toast('旧档迁移校验失败，当前工厂仍可继续运行'); return false; }
  }
  const ok = platform.save(candidate.exportSave());
  if (ok && migrationPending) {
    game = candidate; migrationPending = false;
    insights = new ProductionInsights();
  }
  if (!ok && !saveFailed) toast('进度暂未保存，请检查设备存储空间');
  saveFailed = !ok;
  return ok;
}
function processEvents() {
  for (const event of game.drainEvents()) {
    renderer.emit(event);
    if (event.type === 'ship') {
      // These amounts have already been settled by Game. This aggregation only
      // paints feedback and throttles sound; it never credits another shipment.
      pendingShipment.amount += event.amount;
      pendingShipment.coins += event.coins;
    }
    if (['upgrade', 'evolve', 'automation', 'logistics-upgrade'].includes(event.type)) {
      sound.play(event.type === 'evolve' ? 'machine' : 'upgrade');
      if (game.state.settings.haptics) platform.vibrate();
      platform.track(event.type, { ...event, playedSeconds: game.state.playedSeconds });
    }
    if (['first-sale', 'transfer', 'automatic-trial'].includes(event.type)) platform.track(event.type, { ...event, playedSeconds: game.state.playedSeconds });
  }
  const tick = game.state.simulation.ticks;
  if (pendingShipment.amount && tick - lastShipmentTick >= shipmentInterval) {
    ui.shipment = { ...pendingShipment, atTick: tick };
    pendingShipment = { amount: 0, coins: 0 };
    lastShipmentTick = tick;
    sound.play('ship');
  }
}
function result(response) {
  if (!response || !response.ok) {
    toast(reasons[response && response.reason] || '条件尚未达到，请查看工位或扩建目标');
    sound.play('error');
    return false;
  }
  processEvents(); save(); return true;
}
function resize(info) {
  cancelTransfer();
  activePointers.clear();
  width = info.width; height = info.height; ratio = Math.min(2, info.pixelRatio || 1);
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const safe = info.safeArea || {};
  const safeTop = Math.max(0, Number.isFinite(safe.top) ? safe.top : info.statusBarHeight || 0);
  const bottom = Math.max(0, height - (safe.bottom || height)) + (platform.isDouyin ? 6 : 0);
  const menuBottom = platform.isDouyin ? (info.menuButton ? info.menuButton.bottom : safeTop + 40) : 0;
  const left = Math.max(0, safe.left || 0), right = Math.max(0, width - (safe.right || width));
  const contentWidth = Math.min(width-left-right, 480); ox = left + (width-left-right-contentWidth) / 2;
  ui.viewport = { width: contentWidth, height: height - bottom, safeTop, menuBottom };
}
function reviewUpgrade(stationId) {
  const station = game.getView().stations.find(item => item.id === stationId);
  ui.quote = station && station.upgrade ? { stationId, level: station.level + 1,
    cost: station.upgrade.cost, name: station.upgrade.name } : null;
  ui.stationCollapsed = false;
  ui.stationDetails = false;
}
function act(action) {
  if (!action || hidden) return;
  sound.unlock();
  if (ui.transfer && !action.startsWith('transfer:') && !action.startsWith('transfer-')) cancelTransfer();
  if (action === 'retry-art') { art.retryFailed(); toast('正在重新加载美术资源'); return; }
  if (action === 'close') { ui.modal = null; return; }
  if (action === 'dismissIntro') {
    game.acknowledgeIntro(); ui.newFactory = false; save(); return;
  }
  if (action === 'settings' && (!ui.modal || ui.modal.type === 'station')) { ui.modal = { type: 'settings' }; return; }
  if (action === 'openLogistics' && game.getView().mode === 'v15' && (!ui.modal || ui.modal.type === 'station')) {
    ui.modal = { type: 'logistics' }; return;
  }
  if (/^automate:(pop|cup)$/.test(action) || /^automate-(pop|cup)$/.test(action)) {
    if (game.getView().mode !== 'v15' || ui.modal && ui.modal.type !== 'logistics') return;
    if (result(game.buyAutomation(action.slice(9)))) toast('自动转运已接通，永久少搬一段');
    return;
  }
  if (action === 'upgrade-logistics' && ui.modal?.type === 'logistics' && game.getView().mode === 'v15') {
    if (result(game.buyLogisticsUpgrade())) toast('整盘批量和仓位已扩大，补料次数更少');
    return;
  }
  if (action.startsWith('station:') && (!ui.modal || ui.modal.type === 'station')) {
    const stationId = action.slice(8);
    if (stationIds.includes(stationId)) {
      if (!ui.modal || ui.modal.stationId !== stationId) reviewUpgrade(stationId);
      ui.modal = { type: 'station', stationId }; sound.play('click');
    }
    return;
  }
  if (action === 'reviewUpgrade' && ui.modal && ui.modal.type === 'station') {
    reviewUpgrade(ui.modal.stationId);
    return;
  }
  if (action === 'toggleDetails' && ui.modal && ui.modal.type === 'station' && !ui.stationCollapsed) {
    ui.stationDetails = !ui.stationDetails;
    return;
  }
  if (action === 'collapseStation' && ui.modal && ui.modal.type === 'station') {
    ui.stationCollapsed = true;
    ui.stationDetails = false;
    return;
  }
  if (action.startsWith('upgrade:')) {
    // A pointer or Enter key carries the exact quote the player reviewed.
    // Retain that quote after buying so a repeated input cannot buy the next tier.
    const match = /^upgrade:(pop|cup|ship):(\d+)$/.exec(action);
    if (!match) return;
    const stationId = match[1], level = Number(match[2]), quote = ui.quote;
    if (!ui.modal || ui.modal.type !== 'station' || ui.modal.stationId !== stationId || ui.stationCollapsed
      || !quote || quote.stationId !== stationId || quote.level !== level || game.state.upgrades[stationId] + 1 !== level) return;
    const upgrade = game.getView().stations.find(item => item.id === stationId).upgrade;
    if (!upgrade || upgrade.cost !== quote.cost || upgrade.name !== quote.name) return;
    if (result(game.buyUpgrade(stationId))) {
      ui.stationCollapsed = true;
      ui.stationDetails = false;
      ui.purchaseFeedback = { stationId, name: quote.name, atTick: game.state.simulation.ticks };
      ui.rateUpdatingUntil = game.state.simulation.ticks + CONFIG.ticksPerSecond * 10;
    }
    return;
  }
  if (action === 'evolve' && !ui.modal) {
    if (result(game.evolve())) toast('仓位扩建完成，设备提速需另行购买');
    return;
  }
  if (action.startsWith('setting:') && ui.modal && ui.modal.type === 'settings') {
    const key = action.slice(8);
    if (['sound', 'haptics'].includes(key)) {
      game.setSetting(key, !game.state.settings[key]); configure(); save();
    }
    return;
  }
  if (action === 'restart' && ui.modal && ui.modal.type === 'settings') { ui.modal = { type: 'restart' }; return; }
  if (action === 'confirmRestart' && ui.modal && ui.modal.type === 'restart') {
    const fresh = new Game({ experiment, mode });
    // Replace this version's key only, and retain the active factory if writing fails.
    if (!platform.save(fresh.exportSave())) { toast('重新开始失败，当前工厂已保留'); return; }
    game = fresh; migrationPending = false; renderer = new Renderer(ctx, art); insights = new ProductionInsights(); ui.modal = null; ui.newFactory = true;
    ui.quote = null; ui.purchaseFeedback = null; ui.stationCollapsed = false; ui.stationDetails = false;
    ui.rateUpdatingUntil = 0; ui.shipment = null; pendingShipment = { amount: 0, coins: 0 }; lastShipmentTick = -Infinity;
    ui.toast = ''; ui.toastSeconds = 0; cancelTransfer(); activePointers.clear(); lastTime = null; saveTimer = 0; saveFailed = false;
    configure();
  }
}
function beginTransfer(x, y, source = 'pop') {
  if (ui.transfer) cancelTransfer();
  const response = game.reserveTransfer(source);
  if (!response.ok) {
    platform.track('transfer_invalid', { source, reason: response.reason, playedSeconds: game.state.playedSeconds });
    toast(reasons[response.reason] || '暂时无法搬运，检查货仓和进料位'); return;
  }
  sound.unlock();
  ui.transfer = { token: response.token, source, target: response.target || (source === 'pop' ? 'cup' : 'ship'), amount: response.amount, x, y, dragging: false, selected: true, overTarget: false };
}
function finishTransfer() {
  if (!ui.transfer) return;
  const { token, target } = ui.transfer;
  const response = game.commitTransfer(token);
  if (!response.ok) game.cancelTransfer(token);
  ui.transfer = null;
  if (!response.ok) { toast(reasons[response.reason] || '投送未完成，货物仍在源仓'); return; }
  toast(response.remaining > 0 ? `送入 ${response.amount} 份，余下 ${response.remaining} 份留在源仓` : `送入 ${response.amount} 份，等待${target === 'ship' ? '出货' : '装杯'}加工`);
  if (ui.newFactory) { game.acknowledgeIntro(); ui.newFactory = false; }
  processEvents(); save();
}
const transferSource = action => action === 'transfer:source' ? 'pop' : /^transfer-source-(pop|cup)$/.exec(action || '')?.[1];
const isTransferTarget = action => action === 'transfer:target' || /^transfer-target-(cup|ship)$/.test(action || '');
const matchesTransferTarget = action => !!ui.transfer && (action === 'transfer:target' && !!experiment || action === `transfer-target-${ui.transfer.target}`);
platform.onPointer(event => {
  const x = event.x - ox, y = event.y;
  const action = renderer.actionAt(x, y);
  if (event.type === 'down') {
    activePointers.add(event.id);
    if (activePointers.size > 1) { cancelTransfer(); return; }
  } else if (event.type === 'up' || event.type === 'cancel') activePointers.delete(event.id);
  if (hidden) return;
  if (event.type === 'cancel' && (pointer?.id === event.id || !pointer)) { cancelTransfer(); return; }
  const canTransfer = (experiment || game.getView().mode === 'v15') && (!ui.modal || ui.modal.type === 'station');
  if (event.type === 'down') {
    if (canTransfer && transferSource(action)) beginTransfer(x, y, transferSource(action));
    else if (ui.transfer && !matchesTransferTarget(action)) cancelTransfer();
    if (!pointer) pointer = { id: event.id, action, x, y };
  } else if (event.type === 'move' && pointer && pointer.id === event.id) {
    if (canTransfer && ui.transfer && transferSource(pointer.action)) {
      if (x < 0 || y < 0 || x > ui.viewport.width || y > ui.viewport.height) { cancelTransfer(); return; }
      ui.transfer.x = x; ui.transfer.y = y;
      if (Math.hypot(x - pointer.x, y - pointer.y) >= 20) ui.transfer.dragging = true;
      ui.transfer.overTarget = matchesTransferTarget(action);
    } else if (Math.hypot(x - pointer.x, y - pointer.y) >= 20) pointer = null;
  } else if ((event.type === 'up' || event.type === 'cancel') && pointer && pointer.id === event.id) {
    const previous = pointer; pointer = null;
    if (transferSource(previous.action)) {
      if (!ui.transfer) return;
      if (event.type === 'up' && matchesTransferTarget(action)) finishTransfer();
      else if (event.type === 'cancel' || ui.transfer.dragging || action !== previous.action) cancelTransfer();
      return;
    }
    if (isTransferTarget(previous.action)) {
      if (canTransfer && event.type === 'up' && action === previous.action && Math.hypot(x - previous.x, y - previous.y) < 20) {
        if (matchesTransferTarget(action)) finishTransfer(); else toast('先点对应货仓拿一批，再点这里送入');
      }
      return;
    }
    if (event.type === 'up' && previous.action === action && Math.hypot(x - previous.x, y - previous.y) < 20) act(previous.action);
  }
});
if (platform.onInputCancel) platform.onInputCancel(() => { cancelTransfer(); activePointers.clear(); });
platform.onResize(resize);
platform.onHide(() => {
  hidden = true; cancelTransfer(); activePointers.clear(); lastTime = null;
  pendingShipment = { amount: 0, coins: 0 }; ui.shipment = null;
  configure(); save();
});
platform.onShow(() => { hidden = false; lastTime = null; configure(); });

// Native tt canvases have no DOM methods even when their IDE supplies window.
if (!platform.isDouyin && typeof document !== 'undefined') {
  canvas.id = 'game'; canvas.setAttribute('aria-label', '小小爆米花厂：爆锅、装杯、出货生产线');
  if (experiment) {
    canvas.setAttribute('aria-label', '首段搬运试玩：从待装仓拖一批到装杯入口，或先点待装仓再点入口');
    const instructions = document.getElementById('instructions');
    if (instructions) instructions.textContent = '首段搬运试玩。爆锅自动生产，装杯需要手动补料。按住待装仓拖到装杯入口松手，或先点待装仓再点入口。首批最多4份，此后每批最多12份；只有真实出货结算金币。Escape取消搬运，S打开设置。当前尚未开放自动转运与扩建，试玩存档与原工厂隔离。';
  } else if (mode === 'v15') {
    canvas.setAttribute('aria-label', '小小爆米花厂：先从待装仓送到装杯入口，再从待发仓送到出货入口，可拖整盘或依次点按');
    const instructions = document.getElementById('instructions');
    if (instructions) instructions.textContent = '爆锅自动生产。先从待装仓搬到装杯入口，加工后再从待发仓搬到出货入口；按住拖动，或先点货仓再点对应入口。两段自动转运分别购买，接通后无需手动搬运。物流改造增加批量和仓位，点击机器提高加工能力。只有真实出货结算金币，完成稳定自动试运行和销售目标后可以扩建。快捷键1、2、3选择工位，Enter购买当前报价，M扩建，S设置，Escape取消搬运或关闭面板。';
  }
  canvas.setAttribute('role', 'application'); canvas.tabIndex = 0;
  const loading = document.getElementById('loading'); if (loading) loading.remove();
  window.addEventListener('keydown', event => {
    if (event.repeat) return;
    const quote = ui.quote;
    const action = event.code === 'Escape' ? 'close'
      : event.code === 'Enter' && ui.modal && ui.modal.type === 'station' && quote
        ? `upgrade:${quote.stationId}:${quote.level}`
        : ({ Digit1: 'station:pop', Digit2: 'station:cup', Digit3: 'station:ship', KeyM: 'evolve', KeyS: 'settings' })[event.code];
    if (action) { event.preventDefault(); act(action); }
  });
}
const runtimeGlobal = typeof globalThis !== 'undefined' ? globalThis : GameGlobal;
runtimeGlobal.__POPCORN__ = Object.freeze({ snapshot: () => game.getView(), analytics: () => platform.getAnalytics(), version: APP_VERSION,
  presentation: () => JSON.parse(JSON.stringify({layout:renderer.interface.layout,zones:renderer.zones,art:art.report(),scene:renderer.scene.diagnostics})) });
configure(); resize(platform.getSystemInfo());
if (game.loadWarning) toast(game.loadWarning);
else if (platform.lastStorageError) toast('存档读取失败，已开始新工厂');
save();
const requestFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame.bind(runtimeGlobal) : callback => setTimeout(() => callback(Date.now()), 1000 / 30);
function frame(time) {
  // OS sleep and browser freezing can skip hide/show events. Treat a stalled
  // frame over one second as paused too; never settle it as offline production.
  const elapsed = lastTime === null ? 0 : Math.max(0, (time - lastTime) / 1000);
  const dt = elapsed <= 1 ? elapsed : 0;
  lastTime = time;
  if (!hidden) {
    game.tick(dt); processEvents();
    saveTimer += dt; if (saveTimer >= 5 && !ui.transfer) { saveTimer = 0; save(); }
    if (ui.toastSeconds > 0) { ui.toastSeconds -= dt; if (ui.toastSeconds <= 0) ui.toast = ''; }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.fillStyle = '#e9eee5'; ctx.fillRect(0, 0, width, height);
    ctx.setTransform(ratio, 0, 0, ratio, ratio * ox, 0);
    renderer.draw(insights.enrich(game.getView()), ui, Math.min(.1, dt));
  }
  requestFrame(frame);
}
requestFrame(frame);
