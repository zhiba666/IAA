// Isolated local QA for the factory redesign. Generate with node tools/factory-check.mjs.
// The resulting page imports Game + Renderer + the shared QA action dispatcher only.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleCommonJS, allowQAModule } from './bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function factoryQA(require) {
  'use strict';
  const { Game, CONFIG } = require('src/core.js');
  const { Renderer } = require('src/renderer.js');
  const { dispatchQAAction } = require('tools/qa-actions.cjs');
  const NOW = 1800000000000, $ = id => document.getElementById(id);
  const canvas = $('game'), report = $('report'), clone = value => JSON.parse(JSON.stringify(value));
  const errors = [], actions = [];
  let game, renderer, ui, elapsed = 0, lastFrame = 0, lastReport = -1, paused = false, pointer = null;
  let fixture = null, qaAdvancedSeconds = 0, renderChangedState = false;
  function fail(reason) {
    errors.push(String(reason && reason.stack || reason).slice(0, 1500));
    paused = true; $('pause').textContent = 'QA：继续';
    $('status').textContent = 'QA 错误：' + errors.at(-1);
    report.textContent = JSON.stringify({ fixture, errors, actions }, null, 2);
  }
  const safe = operation => (...args) => { try { operation(...args); } catch (reason) { fail(reason); } };
  window.addEventListener('error', event => fail(event.error || event.message));
  window.addEventListener('unhandledrejection', event => fail(event.reason));
  function drain() { const events = game.drainEvents(); events.forEach(event => renderer.emit(event)); return events; }
  function seed(stage, orderIndex) {
    const fresh = new Game({ now: NOW }), level = [0, 7, 12, 17, 21, 24][stage];
    Object.assign(fresh.state, { machine: stage, orderIndex,
      totalProduced: orderIndex ? CONFIG.orders[orderIndex - 1].target : 0,
      coins: stage ? CONFIG.machines[stage].cost * .12 : 0,
      totalCoins: stage ? CONFIG.machines[stage].cost * 1.12 : 0,
      taps: stage ? 30 : 0, bursts: stage ? 1 : 0, energy: 0,
      playedSeconds: stage ? 120 : 0, upgrades: { tap: level, auto: level, value: level },
      learning: { heatRecoveryDismissed: true, heatRecoveryUses: 10 } });
    const result = new Game({ now: NOW, save: fresh.exportSave(NOW) });
    if (result.state.machine !== stage || result.state.orderIndex !== orderIndex) throw new Error('夹具存档验证发生阶段回退');
    if (stage > 0) result.state.onboarding.seen = result.getView().onboarding.lessons.map(lesson => lesson.id);
    return result;
  }
  function reset() {
    const stage = Number($('stage').value), orderIndex = $('phase').value === 'complete' ? 20 : CONFIG.machines[stage].requiredOrders;
    fixture = { label: '明确 QA 内存夹具；初始资源为预置值，已有阶段引导视为已读', stage, orderIndex };
    game = seed(stage, orderIndex);
    const [width, height] = $('viewport').value.split('x').map(Number);
    ui = { viewport: { width, height }, modal: null, isDouyin: false, adBusy: false,
      startup: false, toast: '', questGuideId: '' };
    canvas.width = width; canvas.height = height;
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    renderer = new Renderer(canvas.getContext('2d'));
    elapsed = 0; lastFrame = 0; lastReport = -1; qaAdvancedSeconds = 0;
    paused = false; pointer = null; renderChangedState = false; errors.length = 0; actions.length = 0;
    $('pause').textContent = 'QA：暂停'; draw(0);
  }
  function snapshot() {
    const view = game.getView();
    return { purpose: 'Game + Renderer + dispatchQAAction；无 main/platform、真实广告或玩家存档读写',
      fixture, viewport: ui.viewport, paused, elapsedSeconds: Number(elapsed.toFixed(2)),
      qaAdvancedSeconds, productionSpeed: '1×；QA 推进单独标记',
      state: { machine: game.state.machine, orderIndex: game.state.orderIndex, coins: game.state.coins,
        totalProduced: game.state.totalProduced, totalCoins: game.state.totalCoins,
        bursts: game.state.bursts, taps: game.state.taps, upgrades: game.state.upgrades,
        rewardedCount: game.state.rewardedCount, claimedQuests: game.state.claimedQuests },
      factory: view.factory, contracts: view.contracts, order: view.order, production: view.production,
      onboarding: { goal: view.onboarding.goal, skipped: view.onboarding.skipped },
      modal: ui.modal, renderChangedState, actions: actions.slice(-50),
      hitZones: renderer.zones.map(({ x, y, w, h, action }) => ({ x, y, w, h, action })), errors };
  }
  function dispatch(action, origin = '画布 / 真实玩法控件') {
    const before = game.state.orderIndex;
    const result = dispatchQAAction(game, ui, action);
    const events = drain();
    actions.push({ at: Number(elapsed.toFixed(2)), action, origin, result, beforeOrder: before,
      afterOrder: game.state.orderIndex, events: events.filter(event => event.type !== 'produce') });
    draw(0); return result;
  }
  function accept(kind) {
    dispatch('order');
    const option = game.getView().contracts.options.find(item => item.kind === kind);
    if (!option) throw new Error('此阶段没有 ' + kind + ' 合约报价');
    dispatch('contractAccept:' + kind + ':' + option.id);
  }
  function draw(dt) {
    const verify = elapsed - lastReport >= .25 || dt === 0;
    const before = verify ? JSON.stringify(game.exportSave(NOW + elapsed * 1000)) : null;
    renderer.draw(game.getView(), ui, dt);
    if (verify && before !== JSON.stringify(game.exportSave(NOW + elapsed * 1000))) {
      renderChangedState = true; throw new Error('Renderer 修改了 Game 状态');
    }
    if (!verify) return;
    lastReport = elapsed;
    const view = game.getView();
    $('status').textContent = (paused ? 'QA 暂停' : '正常速度生产') + ' · ' + CONFIG.machines[game.state.machine].name +
      ' · 主线 ' + game.state.orderIndex + '/20 · QA 推进 ' + qaAdvancedSeconds + ' 秒';
    $('release').disabled = !(view.factory && view.factory.storedBurst);
    $('cancel').disabled = !(view.contracts && view.contracts.active);
    $('claim').disabled = !view.order.ready;
    $('modules').disabled = !(view.factory && view.factory.unlocked);
    for (const kind of ['cinema', 'gift', 'festival']) {
      const option = view.contracts && view.contracts.options.find(item => item.kind === kind);
      $('accept-' + kind).disabled = !option || !option.canAccept;
    }
    for (const mode of ['auto', 'hold']) {
      const button = $('pressure-' + mode);
      button.disabled = !view.factory.canSetPressureMode;
      button.setAttribute('aria-pressed', String(view.factory.pressureMode === mode));
    }
    report.textContent = JSON.stringify(snapshot(), null, 2);
  }
  function advance(seconds, marked = false, observedSeconds = 0) {
    if (marked) qaAdvancedSeconds += seconds;
    let remaining = seconds;
    while (remaining > 1e-8) {
      const step = Math.min(.1, remaining); game.tick(step); elapsed += step; remaining -= step; drain();
    }
    // Only the normal visible frame supplies observation time. QA time jumps
    // and the in-memory offline replay cannot complete a hands-on exercise.
    if (observedSeconds > 0) { game.observeOnboarding(observedSeconds); drain(); }
    draw(Math.min(seconds, .1));
  }
  function frame(timestamp) {
    const dt = lastFrame ? Math.min(.1, Math.max(0, (timestamp - lastFrame) / 1000)) : 0;
    lastFrame = timestamp;
    if (!paused && dt > 0) {
      const observing = !document.hidden && !ui.modal && !ui.startup && !ui.adBusy && !(pointer && pointer.action === 'tap')
        && game.getView().onboarding.goal && game.getView().onboarding.goal.action === 'observe';
      try { advance(dt, false, observing ? Math.min(dt, .25) : 0); } catch (reason) { fail(reason); }
    }
    requestAnimationFrame(frame);
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height };
  }
  canvas.addEventListener('pointerdown', safe(event => {
    const p = point(event); pointer = { ...p, id: event.pointerId, action: renderer.actionAt(p.x, p.y) };
    canvas.setPointerCapture(event.pointerId);
  }));
  canvas.addEventListener('pointerup', safe(event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const old = pointer, p = point(event); pointer = null;
    if (old.action === renderer.actionAt(p.x, p.y) && Math.hypot(old.x - p.x, old.y - p.y) < 20) dispatch(old.action);
  }));
  canvas.addEventListener('pointercancel', () => { pointer = null; });
  CONFIG.machines.forEach((machine, index) => {
    const option = document.createElement('option'); option.value = index; option.textContent = machine.name;
    $('stage').appendChild(option);
  });
  $('stage').value = '2';
  for (const id of ['stage', 'viewport', 'phase']) $(id).addEventListener('change', safe(reset));
  $('reset').addEventListener('click', safe(reset));
  $('pause').addEventListener('click', safe(() => { paused = !paused; lastFrame = 0; $('pause').textContent = paused ? 'QA：继续' : 'QA：暂停'; draw(0); }));
  for (const seconds of [1, 30, 120]) $('step-' + seconds).addEventListener('click', safe(() => advance(seconds, true)));
  for (const [id, action] of [['tap', 'tap'], ['release', 'releasePressure'], ['order', 'order'], ['modules', 'modules'], ['claim', 'claimOrder'], ['upgrades', 'upgrades'], ['machine', 'machine'], ['close', 'close']]) {
    $(id).addEventListener('click', safe(() => dispatch(action)));
  }
  for (const mode of ['auto', 'hold']) $('pressure-' + mode).addEventListener('click', safe(() => { dispatch('modules'); dispatch('pressureMode:' + mode); }));
  for (const kind of ['cinema', 'gift', 'festival']) $('accept-' + kind).addEventListener('click', safe(() => accept(kind)));
  $('cancel').addEventListener('click', safe(() => {
    const active = game.getView().contracts.active;
    if (active) { dispatch('order'); dispatch('contractCancel:' + active.id); }
  }));
  $('reload').addEventListener('click', safe(() => {
    const now = NOW + elapsed * 1000, before = clone(game.getView().contracts);
    game = new Game({ now, save: game.exportSave(now) }); ui.modal = null; drain();
    actions.push({ at: elapsed, action: 'QA 内存快照重载', before, after: clone(game.getView().contracts) }); draw(0);
  }));
  $('offline').addEventListener('click', safe(() => {
    const now = NOW + elapsed * 1000;
    game = new Game({ now: now + 600000, save: game.exportSave(now) });
    qaAdvancedSeconds += 600; elapsed += 600; ui.modal = { type: 'offline' }; drain();
    actions.push({ at: elapsed, action: 'QA 内存离线 10 分钟；待真实领取' }); draw(0);
  }));
  $('download').addEventListener('click', safe(() => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'factory-qa-report.json'; link.click(); URL.revokeObjectURL(url);
  }));
  Object.defineProperty(window, 'factoryQA', { value: Object.freeze({ get snapshot() { return clone(snapshot()); } }) });
  reset(); requestAnimationFrame(frame);
}

const { code, moduleIds } = await bundleCommonJS({ root,
  entries: ['src/core.js', 'src/renderer.js', 'tools/qa-actions.cjs'], allowModule: allowQAModule, initialize: factoryQA });
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>工厂改版 · 本地隔离 QA</title><style>
*{box-sizing:border-box}body{margin:20px;background:#edf1eb;color:#283e32;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif}h1{font-size:23px;margin:0 0 8px}p{margin:8px 0}.controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0}button,select{min-height:40px;font:inherit;padding:7px 11px;border:1px solid #bbc9b5;border-radius:7px;background:#fffdf7;color:inherit}button{cursor:pointer}button:disabled{opacity:.45;cursor:default}button[aria-pressed=true]{background:#356348;color:white}.qa{border-style:dashed}main{display:flex;align-items:flex-start;gap:20px}canvas{display:block;touch-action:none;box-shadow:0 0 0 1px #bdceb6}aside{min-width:350px;max-width:760px;max-height:920px;overflow:auto;padding:14px;background:#fffdf7;border-radius:8px}pre{margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.5 Consolas,monospace}.note{max-width:1100px;color:#5c7054}#status{font-weight:700}@media(max-width:760px){body{margin:10px}main{flex-wrap:wrap}aside{min-width:0;width:100%}}
</style></head><body><h1>工厂改版 · 本地隔离 QA</h1>
<p class="note">真实 Game + Renderer + dispatchQAAction。所有状态均为明确标注的内存夹具，不读取或覆盖正式存档，不接入平台与真实广告。正常生产为 1× 速度；时间跳步只由虚线 QA 控件触发并记录。</p>
<div class="controls"><label>阶段 <select id="stage" aria-label="阶段夹具"></select></label><label>进度 <select id="phase" aria-label="进度夹具"><option value="start">阶段起点</option><option value="complete">QA：20 单已竣工</option></select></label><label>尺寸 <select id="viewport" aria-label="画布尺寸"><option value="320x524">320 × 524</option><option value="390x844" selected>390 × 844</option></select></label><button id="reset" class="qa">QA：复原夹具</button></div>
<div class="controls"><button id="tap">投料生产</button><button id="release">释放蓄压</button><button id="order">订单面板</button><button id="modules">设备图鉴</button><button id="upgrades">升级面板</button><button id="machine">设备面板</button><button id="close">关闭面板</button></div>
<div class="controls"><button id="pressure-auto">自动放锅</button><button id="pressure-hold">手动储压</button><button id="accept-cinema">接影院单</button><button id="accept-gift">接精品单</button><button id="accept-festival">接活动单</button><button id="claim">交付当前单</button><button id="cancel">放弃当前单</button></div>
<div class="controls"><button id="pause" class="qa">QA：暂停</button><button id="step-1" class="qa">QA：推进 1 秒</button><button id="step-30" class="qa">QA：推进 30 秒</button><button id="step-120" class="qa">QA：推进 120 秒</button><button id="reload" class="qa">QA：内存重载</button><button id="offline" class="qa">QA：离线 10 分钟</button><button id="download" class="qa">导出 JSON 报告</button></div>
<p class="note">单次只接受一个合同；六件设备达标自动获得、永久同时生效。换阶段/尺寸会复原夹具。页面按钮与画布按钮走同一 QA dispatcher；广告按钮返回不执行，奖励测试由 Node 测试使用内存凭证验证。</p>
<p id="status" role="status"></p><main><canvas id="game" tabindex="0" role="application" aria-label="真实工厂游戏画面"></canvas><aside><pre id="report" aria-label="工厂 QA JSON 报告"></pre></aside></main>
<script>${code.replaceAll('</script', '<\\/script')}</script></body></html>`;
await mkdir(path.join(root, 'web'), { recursive: true });
await writeFile(path.join(root, 'web/factory-check.html'), html);
console.log('Local-only factory QA: http://127.0.0.1:4173/factory-check.html');
console.log('Bundled ' + moduleIds.length + ' modules; main/platform excluded; no live storage/ad adapter.');
