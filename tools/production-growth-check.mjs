// Isolated, local-only production/evolution QA. Never included in release bundles.
// Run: node tools/production-growth-check.mjs; npm start
// Open in Chrome: http://127.0.0.1:4173/production-growth-check.html
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'src') + path.sep;
const modules = new Map();
async function collect(filename) {
  if (!filename.startsWith(sourceRoot) || /[\\/](main|platform)\.js$/.test(filename)) {
    throw new Error('Production QA may include core/presentation modules only');
  }
  const id = path.relative(root, filename).replaceAll('\\', '/');
  if (modules.has(id)) return id;
  modules.set(id, '');
  let source = await readFile(filename, 'utf8');
  for (const match of [...source.matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)]) {
    const filename = path.resolve(path.dirname(path.join(root, id)), match[1].endsWith('.js') ? match[1] : match[1] + '.js');
    source = source.replace(match[0], 'require(' + JSON.stringify(await collect(filename)) + ')');
  }
  modules.set(id, source);
  return id;
}

function productionGrowthQA(require) {
  'use strict';
  const { Game, CONFIG } = require('src/core.js');
  const { Renderer } = require('src/renderer.js');
  const { PRODUCTION_FORMS, ProductionScene } = require('src/production-scene.js');
  const { selectCurrentTarget } = require('src/experience.js');
  const { selectNextStep } = require('src/next-step.js');
  const NOW = 1800000000000;
  const $ = id => document.getElementById(id);
  const canvas = $('game'), report = $('report'), status = $('status');
  const clone = value => JSON.parse(JSON.stringify(value));
  const errors = [], evolutionLog = [];
  let game, renderer, ui, selection = { kind: 'stage', stage: 0 };
  let paused = false, elapsed = 0, lastFrame = 0, reportAt = -1, lastAction = null, pointer = null;
  let chain = null, maxParticles = 0, maxUnits = 0, renderChangedState = false;
  const formFor = stage => Array.isArray(PRODUCTION_FORMS) ? PRODUCTION_FORMS[stage] : null;
  function error(error) {
    errors.push(String(error && error.stack || error).slice(0, 1000));
    paused = true; chain = null;
    status.textContent = 'QA 错误：' + errors.at(-1);
    $('pause').textContent = 'QA：继续';
    report.textContent = JSON.stringify({ errors, evolutionLog }, null, 2);
  }
  function safe(action) { return (...args) => { try { action(...args); } catch (reason) { error(reason); } }; }
  window.addEventListener('error', event => error(event.error || event.message));
  window.addEventListener('unhandledrejection', event => error(event.reason));
  function dimensions() {
    const [width, height] = $('viewport').value.split('x').map(Number);
    return { width, height };
  }
  function seed(stage, beforeEvolve = false) {
    const fresh = new Game({ now: NOW });
    const orders = CONFIG.machines[beforeEvolve ? stage + 1 : stage].requiredOrders;
    const level = [4, 8, 12, 18, 22, 24][stage];
    Object.assign(fresh.state, {
      machine: stage, orderIndex: orders, totalProduced: orders ? CONFIG.orders[orders - 1].target : 30,
      coins: beforeEvolve ? CONFIG.machines[stage + 1].cost : Math.max(1000, CONFIG.machines[stage].cost * .12),
      taps: 30, bursts: 1, energy: 45, playedSeconds: 120,
      upgrades: { tap: level, auto: level, value: level },
      learning: { heatRecoveryUses: 10, heatRecoveryDismissed: true }
    });
    fresh.state.totalCoins = fresh.state.coins;
    // Round-trip the explicitly labelled fixture through the real save validator.
    // Nothing is persisted: this snapshot exists only in this page's memory.
    const seeded = new Game({ now: NOW, save: fresh.exportSave(NOW) });
    if (seeded.state.machine !== stage || seeded.state.orderIndex !== orders) throw new Error('Invalid QA stage seed');
    if (beforeEvolve && !seeded.getView().canEvolve) throw new Error('Evolution fixture did not satisfy the real prerequisites');
    return seeded;
  }
  function select(kind, stage) {
    selection = { kind, stage };
    game = seed(stage, kind === 'evolve');
    ui = { viewport: dimensions(), tab: 'upgrades', isDouyin: false, adBusy: false, modal: null,
      toast: '', startup: false, questGuideId: '' };
    canvas.width = ui.viewport.width; canvas.height = ui.viewport.height;
    canvas.style.width = canvas.width + 'px'; canvas.style.height = canvas.height + 'px';
    renderer = new Renderer(canvas.getContext('2d'));
    drawComparison();
    elapsed = 0; lastFrame = 0; reportAt = -1; lastAction = null; pointer = null; chain = null;
    maxParticles = 0; maxUnits = 0; renderChangedState = false;
    evolutionLog.length = 0; errors.length = 0; paused = false;
    $('stage').value = String(stage); $('pause').textContent = 'QA：暂停';
    for (const button of $('transitions').children) button.setAttribute('aria-pressed', String(kind === 'evolve' && Number(button.dataset.stage) === stage));
    draw(0);
  }
  function drawComparison() {
    const preview = $('comparison');
    preview.width = canvas.width; preview.height = 126;
    preview.style.width = preview.width + 'px'; preview.style.height = preview.height + 'px';
    const context = preview.getContext('2d'), scene = new ProductionScene(context);
    context.fillStyle = '#fffdf7'; context.fillRect(0, 0, preview.width, preview.height);
    const cell = preview.width / 6;
    context.textAlign = 'center'; context.textBaseline = 'middle';
    for (let stage = 0; stage < 6; stage++) {
      const x = stage * cell, form = formFor(stage);
      context.fillStyle = '#68805f'; context.font = '600 10px "Microsoft YaHei",sans-serif';
      context.fillText('0' + (stage + 1), x + cell / 2, 14);
      scene.drawProductionPreview(x + 2, 28, cell - 4, stage);
      context.fillStyle = '#283e32'; context.font = '600 10px "Microsoft YaHei",sans-serif';
      context.fillText(form ? form.unit : CONFIG.machines[stage].name, x + cell / 2, 105, cell - 6);
    }
  }
  function drain() {
    const events = game.drainEvents();
    for (const event of events) renderer.emit(event);
    return events;
  }
  function evolve(origin) {
    const before = clone(game.getView());
    const result = game.evolve();
    ui.modal = null;
    const events = drain();
    const evolveEvents = events.filter(event => event.type === 'evolve');
    if (result.ok && (evolveEvents.length !== 1 || game.state.machine !== before.state.machine + 1)) {
      throw new Error('Game.evolve did not produce exactly one matching evolution event');
    }
    if (result.ok) evolutionLog.push({
      origin, at: Number(elapsed.toFixed(3)), from: before.state.machine, to: game.state.machine,
      prerequisites: { canEvolve: before.canEvolve, coins: before.state.coins, requiredCoins: before.nextMachine.cost,
        orders: before.state.orderIndex, requiredOrders: before.nextMachine.requiredOrders },
      result, events: clone(evolveEvents), rendererReceived: true,
      sceneImmediatelyAfterEmit: { stage: renderer.scene.stage, evolveTime: renderer.scene.evolveTime }
    });
    lastAction = { action: 'evolve', result, origin };
    return result;
  }
  function prepareChainStep() {
    const next = CONFIG.machines[game.state.machine + 1];
    if (!next) { chain = null; return; }
    // QA-only fixture provisioning between transitions: do not fake production or
    // evolution events. All five replacements still run through Game.evolve().
    game.state.coins = Math.max(game.state.coins, next.cost);
    game.state.totalCoins = Math.max(game.state.totalCoins, game.state.coins);
    game.state.orderIndex = Math.max(game.state.orderIndex, next.requiredOrders);
    game.state.totalProduced = Math.max(game.state.totalProduced, CONFIG.orders[next.requiredOrders - 1].target);
    renderer.lastView = game.getView();
    if (!evolve('QA 五次串行换代；本步仅预置金币与合法订单条件').ok) throw new Error('Serial evolution fixture could not evolve');
  }
  function open(type) {
    ui.modal = { type, ...(type === 'upgrades' ? { quantity: 1 } : {}) };
    if (type === 'quests') ui.modal.chapterId = game.getView().quests.activeChapterId;
  }
  function dispatch(action) {
    if (!action) return;
    chain = null;
    let result = null;
    if (action === 'evolve') { evolve('画布按钮 / QA 换代按钮'); draw(0); return; }
    if (action === 'tap') { if (!ui.modal) result = game.tap(); }
    else if (action === 'timing') { if (!ui.modal) result = game.tryPerfectBurst(); }
    else if (action === 'target') {
      const target = selectCurrentTarget(game.getView(), ui);
      if (target && target.action) {
        if (target.action.startsWith('upgrade:')) { open('upgrades'); ui.focusUpgrade = target.action.slice(8); }
        else { dispatch(target.action); return; }
      }
    } else if (action === 'goalExpand' || action === 'goalCollapse') ui.goalExpanded = action === 'goalExpand';
    else if (action.startsWith('modeAdvice:')) {
      const step = selectNextStep(game.getView(), selectCurrentTarget(game.getView(), ui), ui);
      if (step.kind === 'mode' && step.id === action.slice(11)) { ui.dismissedModeSuggestion = step.id; open('productionModes'); ui.modal.advice = step; }
    } else if (action === 'close') ui.modal = null;
    else if (action === 'practiceHeat') ui.modal = null;
    else if (action === 'skipHeatLesson') { result = game.dismissHeatRecoveryGuide(); ui.modal = null; }
    else if (action === 'claimOrder') { result = game.claimOrder(); ui.modal = null; }
    else if (action.startsWith('productionMode:')) result = game.setProductionMode(action.slice(15));
    else if (action.startsWith('upgrade:')) result = game.buyUpgrade(action.slice(8));
    else if (action.startsWith('refinement:')) { const [, key, level, cost] = action.split(':'); result = game.buyRefinement(key, { level: Number(level), cost: Number(cost) }); }
    else if (action.startsWith('upgradeQuantity:')) { if (ui.modal) ui.modal.quantity = Number(action.slice(16)); }
    else if (action.startsWith('upgradeBatch:')) { const [, key, fromLevel, count, cost] = action.split(':'); result = game.buyUpgradeBatch(key, { fromLevel: Number(fromLevel), count: Number(count), cost: Number(cost) }); }
    else if (action.startsWith('questClaim:')) result = game.claimQuest(action.slice(11));
    else if (action.startsWith('delivery:')) { const [, orderIndex, stage] = action.split(':'); result = game.claimDelivery(Number(stage), Number(orderIndex)); }
    else if (action.startsWith('questChapter:')) { if (ui.modal) { ui.modal.chapterId = action.slice(13); ui.modal.page = 0; } }
    else if (action.startsWith('questPage:') || action.startsWith('blueprintPage:')) { if (ui.modal) ui.modal.page = Number(action.split(':')[1]) || 0; }
    else if (action.startsWith('questGo:')) {
      const quest = game.getView().quests.chapters.flatMap(chapter => chapter.quests).find(item => item.id === action.slice(8));
      if (quest && !quest.locked && !quest.claimed) {
        ui.questGuideId = quest.id;
        if (quest.action.startsWith('upgrade:')) { open('upgrades'); ui.focusUpgrade = quest.action.slice(8); }
        else if (['machine', 'order'].includes(quest.action)) open(quest.action);
        else ui.modal = null;
      }
    } else if (action.startsWith('tab:')) open(({ machines: 'machine', upgrades: 'upgrades', stats: 'stats', brand: 'brand' })[action.slice(4)] || 'workshop');
    else if (['machine', 'blueprint', 'order', 'upgrades', 'productionModes', 'workshop', 'quests', 'refinements', 'heatLesson', 'stats', 'brand', 'settings', 'help', 'completion', 'commissions', 'souvenirs', 'research'].includes(action)) open(action);
    else result = { ok: false, reason: '此生产 QA 工具不处理该操作：' + action };
    lastAction = { action, result }; drain(); draw(0);
  }
  function snapshot() {
    const view = game.getView(), scene = renderer.scene;
    return {
      purpose: '本地生产 QA；状态只读；测试夹具仅在内存中创建。无平台、广告或存档读写。',
      fixture: selection, viewport: ui.viewport, paused, elapsedSeconds: Number(elapsed.toFixed(2)),
      form: formFor(game.state.machine), formsAvailable: Array.isArray(PRODUCTION_FORMS),
      state: { machine: game.state.machine, coins: game.state.coins, totalProduced: game.state.totalProduced,
        orderIndex: game.state.orderIndex, energy: game.state.energy, taps: game.state.taps, upgrades: game.state.upgrades },
      production: view.production, canEvolve: view.canEvolve, evolveReason: view.evolveReason,
      scene: { stage: scene.stage, evolveTime: scene.evolveTime, evolveLaunched: scene.evolveLaunched,
        particles: scene.particles.length, units: Array.isArray(scene.units) ? scene.units.length : null,
        unitsByKind: Array.isArray(scene.units) ? scene.units.reduce((out, unit) => { const key = unit.kind || unit.type || unit.form || 'unknown'; out[key] = (out[key] || 0) + 1; return out; }, {}) : null,
        maxParticles, maxUnits, flow: scene.flow,
        productionMode: scene.productionMode },
      serialEvolution: chain ? { nextAt: chain.nextAt, completed: evolutionLog.length } : null,
      evolutionLog, modal: ui.modal && ui.modal.type, lastAction, renderChangedState,
      hitZones: renderer.zones.map(({ x, y, w, h, action }) => ({ x, y, w, h, action })), errors
    };
  }
  function draw(dt) {
    const verify = elapsed - reportAt > .25 || dt === 0;
    const before = verify ? JSON.stringify(game.exportSave(NOW)) : null;
    renderer.draw(game.getView(), ui, dt);
    if (verify && before !== JSON.stringify(game.exportSave(NOW))) {
      renderChangedState = true; throw new Error('Renderer mutated the in-memory fixture Game state');
    }
    maxParticles = Math.max(maxParticles, renderer.scene.particles.length);
    maxUnits = Math.max(maxUnits, Array.isArray(renderer.scene.units) ? renderer.scene.units.length : 0);
    if (verify) {
      reportAt = elapsed;
      const form = formFor(game.state.machine);
      status.textContent = (paused ? 'QA 已暂停' : '真实时钟生产中') + ' · ' + CONFIG.machines[game.state.machine].name +
        (form ? ' · ' + form.unit + ' / ' + form.rhythm : '') + ' · 成功换代 ' + evolutionLog.length + ' 次';
      $('evolve').disabled = !game.getView().canEvolve;
      $('step').disabled = !paused;
      $('stepHalf').disabled = !paused;
      report.textContent = JSON.stringify(snapshot(), null, 2);
    }
  }
  function advance(dt) {
    elapsed += dt; game.tick(dt); drain();
    if (chain && elapsed >= chain.nextAt) {
      prepareChainStep();
      if (chain) { if (game.state.machine >= 5) chain = null; else chain.nextAt = elapsed + 4.5; }
    }
    draw(dt);
  }
  function frame(timestamp) {
    const dt = lastFrame ? Math.min(.05, Math.max(0, (timestamp - lastFrame) / 1000)) : 0;
    lastFrame = timestamp;
    if (!paused && dt > 0) { try { advance(dt); } catch (reason) { error(reason); } }
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
    const previous = pointer, p = point(event); pointer = null;
    if (renderer.actionAt(p.x, p.y) === previous.action && Math.hypot(p.x - previous.x, p.y - previous.y) < 20) dispatch(previous.action);
  }));
  canvas.addEventListener('pointercancel', () => { pointer = null; });
  CONFIG.machines.forEach((machine, stage) => {
    const option = document.createElement('option'); option.value = String(stage); option.textContent = (stage + 1) + ' · ' + machine.name;
    $('stage').appendChild(option);
    if (stage < 5) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.stage = String(stage);
      button.textContent = machine.name + ' → ' + CONFIG.machines[stage + 1].name;
      button.addEventListener('click', safe(() => select('evolve', stage))); $('transitions').appendChild(button);
    }
  });
  $('stage').addEventListener('change', safe(() => select('stage', Number($('stage').value))));
  $('viewport').addEventListener('change', safe(() => select(selection.kind, selection.stage)));
  $('reset').addEventListener('click', safe(() => select(selection.kind, selection.stage)));
  $('pause').addEventListener('click', safe(() => { paused = !paused; lastFrame = 0; $('pause').textContent = paused ? 'QA：继续' : 'QA：暂停'; draw(0); }));
  $('step').addEventListener('click', safe(() => { if (paused) { advance(1 / 60); draw(0); } }));
  $('stepHalf').addEventListener('click', safe(() => { if (paused) { for (let frame = 0; frame < 30; frame++) advance(1 / 60); draw(0); } }));
  $('tap').addEventListener('click', safe(() => dispatch('tap')));
  $('evolve').addEventListener('click', safe(() => dispatch('evolve')));
  $('machine').addEventListener('click', safe(() => dispatch('machine')));
  $('blueprint').addEventListener('click', safe(() => dispatch('blueprint')));
  $('replay').addEventListener('click', safe(() => { const stage = Math.min(selection.stage, 4); select('evolve', stage); evolve('QA 回放：重建合法夹具并真实调用 evolve'); draw(0); }));
  $('chain').addEventListener('click', safe(() => { select('evolve', 0); chain = { nextAt: .8 }; draw(0); }));
  // Browser diagnostics can inspect a snapshot; game/renderer objects and mutators
  // are deliberately not exported. Use the labelled QA controls to take actions.
  Object.defineProperty(window, 'productionGrowthQA', { value: Object.freeze({ get snapshot() { return clone(snapshot()); } }) });
  select('stage', 0); requestAnimationFrame(frame);
}

await collect(path.join(root, 'src/core.js'));
await collect(path.join(root, 'src/renderer.js'));
const bundle = `const modules={${[...modules].map(([id, source]) => JSON.stringify(id) + ':function(module,exports,require){\n' + source + '\n}').join(',\n')}};
const cache={};function require(id){if(cache[id])return cache[id].exports;if(!modules[id])throw new Error('Unknown QA module '+id);const m=cache[id]={exports:{}};modules[id](m,m.exports,require);return m.exports;}
(${productionGrowthQA.toString()})(require);`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地产出成长 QA · 六阶段与五次换代</title>
<style>*{box-sizing:border-box}:root{color-scheme:light}body{margin:20px;background:#edf1eb;color:#283e32;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif}h1{font-size:22px;margin:0 0 4px}p{margin:6px 0 12px}.controls,#transitions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0}button,select{font:inherit;min-height:42px;padding:8px 12px;color:inherit;background:#fffdf7;border:1px solid #b8c9b2;border-radius:8px}button{cursor:pointer}button:disabled{opacity:.45;cursor:default}button[aria-pressed=true],#evolve:not(:disabled){background:#366348;color:white}#status{font-weight:650}main{display:flex;align-items:flex-start;gap:20px}canvas{display:block;flex:none;touch-action:none;box-shadow:0 0 0 1px #bdceb6}aside{min-width:350px;max-width:750px;max-height:932px;overflow:auto;padding:16px;border:1px solid #d4dfce;border-radius:8px;background:#fffdf7}h2{font-size:16px;margin:0 0 10px}pre{margin:0;font:12px/1.5 Consolas,monospace;white-space:pre-wrap;word-break:break-word}.note{max-width:1100px;color:#68785f}.qa{border-style:dashed}@media(max-width:760px){main{flex-wrap:wrap}body{margin:10px}aside{min-width:0;width:100%}}</style></head><body>
<h1>本地产出成长 QA · 六阶段与五次换代</h1>
<p class="note">真实 Game + Renderer；画布按钮可点击，自动生产按真实时间推进。六阶段和换代前状态均为明确测试夹具，只驻留本页内存，不读写用户存档。</p>
<div class="controls"><label for="stage">阶段夹具</label><select id="stage" aria-label="阶段夹具"></select><label for="viewport">画布尺寸</label><select id="viewport" aria-label="画布尺寸"><option value="320x568">320 × 568</option><option value="390x844" selected>390 × 844</option><option value="430x932">430 × 932</option></select><button id="reset" type="button">QA：复原夹具</button></div>
<p>换代前合法夹具（金币、订单、累计产量满足真实条件）：</p><div id="transitions" aria-label="五个换代前夹具"></div>
<div class="controls"><button id="tap" type="button">真实点击生产</button><button id="evolve" type="button">真实换代</button><button id="machine" type="button">打开换代面板</button><button id="blueprint" type="button">打开六阶段蓝图</button><button class="qa" id="pause" type="button">QA：暂停</button><button class="qa" id="step" type="button" disabled>QA：单步 1/60 秒</button><button class="qa" id="stepHalf" type="button" disabled>QA：推进 0.5 秒</button><button class="qa" id="replay" type="button">QA：回放当前换代</button><button class="qa" id="chain" type="button">QA：串行播放五次换代</button></div>
<p class="note">QA 暂停/回放不属于游戏功能。串行播放每隔 4.5 秒预置下一步合法条件，再真实调用 Game.evolve；每次事件和渲染接收结果记录在右侧。切换阶段或尺寸会复原夹具。</p>
<p id="status" role="status"></p><main><div><canvas id="game" role="application" tabindex="0" aria-label="真实游戏生产画面"></canvas><h2 style="margin-top:18px">六种产出单位 · 静态对照</h2><canvas id="comparison" role="img" aria-label="六阶段产出单位对照，使用真实产物预览绘制"></canvas></div><aside aria-label="产出与换代只读状态"><h2>只读状态 · 产出单位与事件链</h2><pre id="report" aria-label="生产成长 QA JSON 报告"></pre></aside></main>
<script>(function(){${bundle.replaceAll('</script', '<\\/script')}})();</script></body></html>`;
await mkdir(path.join(root, 'web'), { recursive: true });
await writeFile(path.join(root, 'web/production-growth-check.html'), html);
console.log('Local-only production growth QA: /production-growth-check.html');
console.log('Included ' + modules.size + ' core/presentation modules; no main, platform or storage adapter.');
