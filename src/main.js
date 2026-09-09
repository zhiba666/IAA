'use strict';
const { Game } = require('./core');
const { createPlatform } = require('./platform');
const { AudioEngine } = require('./audio');
const { Renderer } = require('./renderer');

// The application owns input and lifecycle. Only Game advances stock or money.
const platform = createPlatform();
const canvas = platform.canvas, ctx = canvas.getContext('2d');
const sound = new AudioEngine();
const initialSave = platform.load();
let game = new Game({ save: initialSave });
let renderer = new Renderer(ctx);
const ui = { modal: null, toast: '', toastSeconds: 0, isDouyin: platform.isDouyin,
  newFactory: !game.state.introSeen, sidebar: { supported: false }, sidebarBusy: false };
let width = 480, height = 840, ratio = 1, ox = 0;
let hidden = false, lastTime = null, saveTimer = 0, pointer = null, saveFailed = false;
const stationIds = ['pop', 'cup', 'ship'];
const reasons = {
  'not-enough-coins': '金币还不够，出货后再来改造',
  'max-level': '本阶段改造完成，继续扩建工厂',
  'machine-required': '扩建工厂后开放这项改造',
  'max-machine': '六代工厂已建成，继续优化生产线',
  'sales-required': '继续出货，达到本次扩建目标',
  'throughput-required': '改善瓶颈，达到目标出货速度',
  'expansion-not-ready': '扩建条件尚未达到',
  'stale-upgrade': '改造已更新，请重新查看工位'
};
function toast(message) { ui.toast = message; ui.toastSeconds = 3.5; }
function configure() { sound.setEnabled(!hidden && game.state.settings.sound); }
function save() {
  const ok = platform.save(game.exportSave());
  if (!ok && !saveFailed) toast('进度暂未保存，请检查设备存储空间');
  saveFailed = !ok;
  return ok;
}
function processEvents() {
  for (const event of game.drainEvents()) {
    renderer.emit(event);
    if (event.type === 'upgrade' || event.type === 'evolve') {
      sound.play(event.type === 'evolve' ? 'machine' : 'upgrade');
      if (game.state.settings.haptics) platform.vibrate();
      platform.track(event.type, event);
    }
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
  pointer = null;
  width = info.width; height = info.height; ratio = Math.min(2, info.pixelRatio || 1);
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const safe = info.safeArea || {};
  const safeTop = platform.isDouyin ? Math.max(0, Number.isFinite(safe.top) ? safe.top : info.statusBarHeight || 0) : 0;
  const bottom = platform.isDouyin ? Math.max(0, height - (safe.bottom || height)) + 6 : 0;
  const menuBottom = platform.isDouyin ? (info.menuButton ? info.menuButton.bottom : safeTop + 40) : 0;
  const contentWidth = Math.min(width, 480); ox = (width - contentWidth) / 2;
  ui.viewport = { width: contentWidth, height: height - bottom, safeTop, menuBottom };
}
async function visitSidebar() {
  if (ui.sidebarBusy || !ui.sidebar.supported) return;
  ui.sidebarBusy = true;
  try {
    const response = await platform.navigateSidebar();
    if (!response.ok) toast('暂时无法打开侧边栏，请稍后再试');
  } catch (_) { toast('暂时无法打开侧边栏，请稍后再试'); }
  finally { ui.sidebarBusy = false; }
}
function act(action) {
  if (!action || hidden) return;
  sound.unlock();
  if (action === 'close') { ui.modal = null; return; }
  if (action === 'dismissIntro') {
    game.acknowledgeIntro(); ui.newFactory = false; save(); return;
  }
  if (action === 'settings' && !ui.modal) { ui.modal = { type: 'settings' }; return; }
  if (action.startsWith('station:') && !ui.modal) {
    const stationId = action.slice(8);
    if (stationIds.includes(stationId)) { ui.modal = { type: 'station', stationId }; sound.play('click'); }
    return;
  }
  if (action.startsWith('upgrade:')) {
    const stationId = action.slice(8);
    if (!ui.modal || ui.modal.type !== 'station' || ui.modal.stationId !== stationId || !stationIds.includes(stationId)) return;
    if (result(game.buyUpgrade(stationId))) {
      ui.modal = null;
      toast('工位改造完成，观察库存和实际出货速度');
    }
    return;
  }
  if (action === 'evolve' && !ui.modal) {
    if (result(game.evolve())) toast('扩建完成，可改造新增工位');
    return;
  }
  if (action.startsWith('setting:') && ui.modal && ui.modal.type === 'settings') {
    const key = action.slice(8);
    if (['sound', 'haptics'].includes(key)) {
      game.setSetting(key, !game.state.settings[key]); configure(); save();
    }
    return;
  }
  if (action === 'visitSidebar' && ui.modal && ui.modal.type === 'settings') { visitSidebar(); return; }
  if (action === 'restart' && ui.modal && ui.modal.type === 'settings') { ui.modal = { type: 'restart' }; return; }
  if (action === 'confirmRestart' && ui.modal && ui.modal.type === 'restart') {
    const fresh = new Game();
    // Replace this version's key only, and retain the active factory if writing fails.
    if (!platform.save(fresh.exportSave())) { toast('重新开始失败，当前工厂已保留'); return; }
    game = fresh; renderer = new Renderer(ctx); ui.modal = null; ui.newFactory = true;
    ui.toast = ''; ui.toastSeconds = 0; pointer = null; lastTime = null; saveTimer = 0; saveFailed = false;
    configure();
  }
}
platform.onPointer(event => {
  const x = event.x - ox, y = event.y;
  if (event.type === 'down') {
    if (!pointer && !hidden) pointer = { id: event.id, action: renderer.actionAt(x, y), x, y };
  } else if (event.type === 'move' && pointer && pointer.id === event.id) {
    if (Math.hypot(x - pointer.x, y - pointer.y) >= 20) pointer = null;
  } else if ((event.type === 'up' || event.type === 'cancel') && pointer && pointer.id === event.id) {
    const previous = pointer; pointer = null;
    if (event.type === 'up' && previous.action === renderer.actionAt(x, y) && Math.hypot(x - previous.x, y - previous.y) < 20) act(previous.action);
  }
});
platform.onResize(resize);
platform.onHide(() => { hidden = true; pointer = null; lastTime = null; configure(); save(); });
platform.onShow(() => { hidden = false; lastTime = null; configure(); });

// Native tt canvases have no DOM methods even when their IDE supplies window.
if (!platform.isDouyin && typeof document !== 'undefined') {
  canvas.id = 'game'; canvas.setAttribute('aria-label', '小小爆米花厂：爆锅、装杯、出货生产线');
  canvas.setAttribute('role', 'application'); canvas.tabIndex = 0;
  const loading = document.getElementById('loading'); if (loading) loading.remove();
  window.addEventListener('keydown', event => {
    if (event.repeat) return;
    const action = event.code === 'Escape' ? 'close' : ui.modal ?
      event.code === 'Enter' && ui.modal.type === 'station' ? 'upgrade:' + ui.modal.stationId : null :
      ({ Digit1: 'station:pop', Digit2: 'station:cup', Digit3: 'station:ship', KeyM: 'evolve', KeyS: 'settings' })[event.code];
    if (action) { event.preventDefault(); act(action); }
  });
}
const runtimeGlobal = typeof globalThis !== 'undefined' ? globalThis : GameGlobal;
runtimeGlobal.__POPCORN__ = Object.freeze({ snapshot: () => game.getView(), analytics: () => platform.getAnalytics(), version: '2.0.0' });
configure(); resize(platform.getSystemInfo());
if (game.loadWarning) toast(game.loadWarning);
else if (platform.lastStorageError) toast('存档读取失败，已开始新工厂');
save();
if (typeof platform.checkSidebar === 'function') platform.checkSidebar();
const requestFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame.bind(runtimeGlobal) : callback => setTimeout(() => callback(Date.now()), 1000 / 30);
function frame(time) {
  // OS sleep and browser freezing can skip hide/show events. Treat a stalled
  // frame over one second as paused too; never settle it as offline production.
  const elapsed = lastTime === null ? 0 : Math.max(0, (time - lastTime) / 1000);
  const dt = elapsed <= 1 ? elapsed : 0;
  lastTime = time;
  if (!hidden) {
    game.tick(dt); processEvents();
    saveTimer += dt; if (saveTimer >= 5) { saveTimer = 0; save(); }
    if (ui.toastSeconds > 0) { ui.toastSeconds -= dt; if (ui.toastSeconds <= 0) ui.toast = ''; }
    if (typeof platform.getSidebarState === 'function') ui.sidebar = platform.getSidebarState();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.fillStyle = '#e9eee5'; ctx.fillRect(0, 0, width, height);
    ctx.setTransform(ratio, 0, 0, ratio, ratio * ox, 0);
    renderer.draw(game.getView(), ui, Math.min(.1, dt));
  }
  requestFrame(frame);
}
requestFrame(frame);
