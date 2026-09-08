// Explicit local QA fixtures. Does not import main/platform or access player saves.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'src') + path.sep;
const modules = new Map();
async function collect(filename) {
  if (!filename.startsWith(sourceRoot) || /[\\/](main|platform)\.js$/.test(filename)) throw new Error('QA only bundles core and presentation modules');
  const id = path.relative(root, filename).replaceAll('\\', '/');
  if (modules.has(id)) return id;
  modules.set(id, '');
  let source = await readFile(filename, 'utf8');
  for (const match of [...source.matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)]) {
    const dependency = await collect(path.resolve(path.dirname(filename), match[1].endsWith('.js') ? match[1] : match[1] + '.js'));
    source = source.replace(match[0], 'require(' + JSON.stringify(dependency) + ')');
  }
  modules.set(id, source);
  return id;
}

function researchFixtures(require) {
  'use strict';
  const { Game, CONFIG } = require('src/core.js');
  const { Renderer } = require('src/renderer.js');
  const { selectCurrentTarget } = require('src/experience.js');
  const { selectNextStep } = require('src/next-step.js');
  const NOW = 1800000000000, STORAGE_KEY = 'tiny-popcorn-research-qa-v1';
  const canvas = document.getElementById('game'), report = document.getElementById('report');
  const status = document.getElementById('status'), viewport = document.getElementById('viewport'), fixture = document.getElementById('fixture');
  const copy = value => JSON.parse(JSON.stringify(value));
  const definitions = [
    { id: 'available', name: '多头机 · 选择课题', modal: 'research' },
    { id: 'active', name: '产量路线 · 试制中', modal: 'research', key: 'yield', progress: .42 },
    { id: 'ready', name: '配方路线 · 待验收', modal: 'research', key: 'value', progress: 1 },
    { id: 'tower-active', name: '竣工后 · 高级试制', modal: 'research', tower: true, key: 'yield', progress: .66, levels: { yield: 8, value: 9 } },
    { id: 'finished', name: '研发手册 · 全部完成', modal: 'research', tower: true, levels: { yield: CONFIG.research.maxLevel, value: CONFIG.research.maxLevel } },
    { id: 'workshop', name: '竣工工厂 · 全入口', modal: 'workshop', tower: true },
    { id: 'upgrades', name: '满级升级 · 研发入口', modal: 'upgrades', tower: true },
    { id: 'locked', name: '前期 · 研发未解锁', modal: 'research', locked: true }
  ];
  let game, ui, renderer, selected, pointer = null, lastAction = null, saved = false;
  const errors = [];
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ schema: 1, fixture: selected.id, viewport: viewport.value,
      save: game.exportSave(NOW), modal: ui.modal && ui.modal.type })); saved = true; }
    catch (error) { saved = false; errors.push('隔离存储不可用：' + error.message); }
  }
  function diagnostics() {
    const view = game.getView(), s = view.state;
    return { purpose: '显式隔离夹具；注入状态与手动推进均不计自然经营时长。只使用独立QA存储键。',
      storageKey: STORAGE_KEY, saved, fixture: selected.id, viewport: copy(ui.viewport),
      modal: ui.modal && { type: ui.modal.type, cancelResearchId: ui.modal.cancelResearchId || null }, toast: ui.toast,
      research: { unlocked: view.research.unlocked, totalLevels: view.research.totalLevels, maxLevels: view.research.maxLevels,
        complete: view.research.complete, active: copy(view.research.active), levels: copy(s.research.levels),
        options: view.research.options.map(({ key, id, level, maxLevel, projectName, productionTarget, canStart, preview }) =>
          ({ key, id, level, maxLevel, projectName, productionTarget, canStart, preview })) },
      state: { coins: s.coins, totalProduced: s.totalProduced, taps: s.taps, machine: s.machine,
        orderIndex: s.orderIndex, loopIndex: s.loopIndex, researchSerial: s.research.serial },
      production: { baseAuto: view.production.baseAuto, baseIncome: view.production.baseIncome, price: view.production.price },
      target: selectCurrentTarget(view, ui), recommendation: selectNextStep(view, selectCurrentTarget(view, ui), ui),
      hitZones: copy(renderer.zones), lastAction: copy(lastAction), errors: [...errors] };
  }
  function draw() {
    const before = JSON.stringify(game.exportSave(NOW));
    renderer.draw(game.getView(), ui, 0);
    const changed = before !== JSON.stringify(game.exportSave(NOW));
    if (changed) throw new Error('Renderer changed fixture state');
    status.textContent = selected.name + ' · ' + viewport.value.replace('x', ' × ') + ' · ' +
      (lastAction ? '最近操作：' + lastAction.action : '夹具已就绪') + (saved ? ' · QA进度可刷新恢复' : '');
    report.textContent = JSON.stringify({ ...diagnostics(), gameStateChangedByRender: changed }, null, 2);
  }
  function makeView(modal) {
    const [width, height] = viewport.value.split('x').map(Number);
    ui = { viewport: { width, height }, tab: 'upgrades', startup: false, adBusy: false, isDouyin: false,
      toast: '', modal: modal ? { type: modal } : null, goalExpanded: false };
    canvas.width = width; canvas.height = height;
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    renderer = new Renderer(canvas.getContext('2d')); pointer = null;
  }
  function select(id) {
    selected = definitions.find(item => item.id === id) || definitions[0];
    fixture.value = selected.id;
    game = new Game({ now: NOW });
    Object.assign(game.state, { machine: selected.tower ? 5 : selected.locked ? 2 : 3,
      orderIndex: selected.tower ? 20 : selected.locked ? 9 : 10,
      totalProduced: CONFIG.orders[selected.tower ? 19 : selected.locked ? 8 : 9].target,
      coins: selected.tower ? 2e12 : 1e9, totalCoins: selected.tower ? 2e12 : 1e9, taps: 20, bursts: 3, playedSeconds: 600,
      upgrades: { tap: selected.tower ? 24 : 16, auto: selected.tower ? 24 : 16, value: selected.tower ? 24 : 16 },
      refinements: { yield: selected.tower ? 3 : 0, value: selected.tower ? 3 : 0 },
      learning: { heatRecoveryUses: 10, heatRecoveryDismissed: true },
      research: { levels: selected.levels ? copy(selected.levels) : { yield: 0, value: 0 }, serial: 0, active: null } });
    if (selected.tower) game.state.completedAt = 600;
    for (let i = 0; i < 4; i++) {
      const ready = game.getView().quests.chapters.flatMap(chapter => chapter.quests).filter(quest => quest.ready);
      game.state.claimedQuests.push(...ready.map(quest => quest.id));
    }
    if (selected.key) {
      const quote = game.getView().research.options.find(item => item.key === selected.key);
      const result = game.startResearch(selected.key, quote);
      if (!result.ok) throw new Error('Fixture cannot start project: ' + result.reason);
      // Explicit fixture progress, not an observed natural production time.
      game.state.research.active.production = game.state.research.active.productionTarget * selected.progress;
    }
    game.drainEvents(); lastAction = null; makeView(selected.modal); persist(); draw();
  }
  function open(type) { ui.modal = { type }; ui.toast = ''; }
  function dispatch(action) {
    if (!action) return;
    let result = null;
    if (action.startsWith('researchStart:')) {
      if (!ui.modal || ui.modal.type !== 'research') return;
      const rest = action.slice(14), cut = rest.indexOf(':'), key = rest.slice(0, cut), id = rest.slice(cut + 1);
      const quote = ui.modal.researchQuotes && ui.modal.researchQuotes[key];
      if (!quote || quote.id !== id) return;
      result = game.startResearch(key, quote);
      if (result.ok) { ui.modal = null; ui.toast = '试制已开始 · 正常生产即可推进'; }
    } else if (action.startsWith('researchClaim:')) {
      if (!ui.modal || ui.modal.type !== 'research') return;
      result = game.claimResearch(action.slice(14));
      if (result.ok) { open('research'); ui.toast = '验收成功 · 永久能力提升'; }
    } else if (action.startsWith('researchCancel:')) {
      if (!ui.modal || ui.modal.type !== 'research') return;
      const id = action.slice(15);
      if (ui.modal.cancelResearchId !== id) { ui.modal.cancelResearchId = id; ui.toast = '本次进度将清空，再点一次放弃'; }
      else { result = game.cancelResearch(id); if (result.ok) { open('research'); ui.toast = '已放弃，永久等级保留'; } }
    } else if (action === 'close') { ui.modal = null; ui.toast = ''; }
    else if (action === 'tap' && !ui.modal) result = game.tap();
    else if (action === 'timing' && !ui.modal) result = game.tryPerfectBurst();
    else if (action === 'goalExpand' || action === 'goalCollapse') ui.goalExpanded = action === 'goalExpand';
    else if (action === 'target') { const target = selectCurrentTarget(game.getView(), ui); if (target) return dispatch(target.action); }
    else if (['research', 'researchBook', 'workshop', 'upgrades', 'order', 'machine', 'blueprint', 'productionModes', 'brand', 'turbo', 'stats', 'souvenirs', 'refinements', 'quests', 'settings'].includes(action)) open(action);
    else result = { ok: false, reason: '此夹具仅操作研发与导航；其他交易在正式输入测试中验证' };
    if (result && !result.ok) ui.toast = '未执行：' + result.reason;
    lastAction = { action, result };
    for (const event of game.drainEvents()) renderer.emit(event);
    persist(); draw();
  }
  function safe(fn) { try { fn(); } catch (error) { errors.push(String(error.message || error)); status.textContent = '夹具错误：' + errors.at(-1); report.textContent = JSON.stringify({ errors }, null, 2); } }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
  }
  canvas.addEventListener('pointerdown', event => {
    const p = point(event); pointer = { ...p, id: event.pointerId, action: renderer.actionAt(p.x, p.y) };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const before = pointer; pointer = null;
    const p = point(event), action = renderer.actionAt(p.x, p.y);
    if (before.action === action && Math.hypot(p.x - before.x, p.y - before.y) < 20) safe(() => dispatch(action));
  });
  canvas.addEventListener('pointercancel', () => { pointer = null; });
  for (const definition of definitions) {
    const option = document.createElement('option'); option.value = definition.id; option.textContent = definition.name; fixture.appendChild(option);
  }
  fixture.addEventListener('change', () => safe(() => select(fixture.value)));
  viewport.addEventListener('change', () => safe(() => { const modal = ui.modal && ui.modal.type; makeView(modal); persist(); draw(); }));
  document.getElementById('reset').addEventListener('click', () => safe(() => select(selected.id)));
  document.getElementById('research').addEventListener('click', () => safe(() => { open('research'); persist(); draw(); }));
  document.getElementById('advance').addEventListener('click', () => safe(() => {
    game.tick(15); game.drainEvents(); lastAction = { action: '显式夹具推进15秒（不计自然时间）', result: null }; persist(); draw();
  }));
  // Read-only snapshots only. No game object or mutation callback is exposed.
  globalThis.__RESEARCH_QA__ = Object.freeze({ snapshot: () => copy(diagnostics()) });
  safe(() => {
    let prior = null;
    try { prior = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) {}
    const query = new URLSearchParams(location.search), selectedByQuery = query.get('fixture'), sizeByQuery = query.get('size');
    if ([...viewport.options].some(option => option.value === sizeByQuery)) viewport.value = sizeByQuery;
    if (selectedByQuery && definitions.some(item => item.id === selectedByQuery)) { select(selectedByQuery); return; }
    if (prior && prior.schema === 1 && definitions.some(item => item.id === prior.fixture) && prior.save) {
      selected = definitions.find(item => item.id === prior.fixture); fixture.value = selected.id;
      if (!sizeByQuery && [...viewport.options].some(option => option.value === prior.viewport)) viewport.value = prior.viewport;
      game = new Game({ save: prior.save, now: NOW }); makeView(prior.modal); saved = true; draw();
    } else select('available');
  });
}

await collect(path.join(root, 'src/core.js'));
await collect(path.join(root, 'src/renderer.js'));
const bundle = `const modules={${[...modules].map(([id, source]) => JSON.stringify(id) + ':function(module,exports,require){\n' + source + '\n}').join(',\n')}};
const cache={};function require(id){if(cache[id])return cache[id].exports;if(!modules[id])throw new Error('Unknown QA module '+id);const module=cache[id]={exports:{}};modules[id](module,module.exports,require);return module.exports;}
(${researchFixtures.toString()})(require);`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>风味研发 · 隔离QA夹具</title><style>
*{box-sizing:border-box}body{margin:16px;background:#edf1eb;color:#283e32;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif}h1{font-size:22px;margin:0 0 6px}p{margin:6px 0}button,select{min-height:44px;font:inherit;color:inherit;background:#fffdf7;border:1px solid #b8c9b2;border-radius:7px;padding:8px 12px}button{cursor:pointer}.controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}main{display:flex;gap:20px;align-items:flex-start}canvas{display:block;flex:none;touch-action:none;box-shadow:0 0 0 1px #bdceb6}aside{min-width:360px;max-width:720px;max-height:844px;overflow:auto;padding:12px;background:#fffdf7;border:1px solid #d4dfce;border-radius:8px}pre{font:12px/1.5 Consolas,monospace;white-space:pre-wrap;word-break:break-word}#status{font-weight:650}
</style></head><body><h1>风味研发 · 隔离QA夹具</h1>
<p>显式测试状态，不计自然经营时长。只使用独立QA存储键；不访问正式游戏存档，不执行广告，不自动推进时间。画布使用真实渲染器，可操作研发；完整应用输入另由自动测试验证。</p>
<div class="controls"><label for="fixture">测试状态</label><select id="fixture" aria-label="测试状态"></select><label for="viewport">画布尺寸</label><select id="viewport" aria-label="画布尺寸"><option value="320x524">320 × 524</option><option value="320x568">320 × 568</option><option value="390x700">390 × 700</option><option value="390x844" selected>390 × 844</option></select><button id="reset">复原当前夹具</button><button id="research">打开研发</button><button id="advance">夹具推进15秒</button></div>
<p id="status" role="status"></p><main><canvas id="game" role="application" tabindex="0" aria-label="隔离研发游戏画面"></canvas><aside><strong>只读诊断 · 研发、金币、操作区域</strong><pre id="report" aria-label="研发QA JSON报告"></pre></aside></main>
<script>(function(){${bundle.replaceAll('</script', '<\\/script')}})();</script></body></html>`;
await writeFile(path.join(root, 'web/research-check.html'), html);
console.log('Local-only research QA: /research-check.html?fixture=available&size=320x524');
console.log(`Bundled ${modules.size} core/presentation modules; isolated key tiny-popcorn-research-qa-v1; no main/platform adapter.`);
