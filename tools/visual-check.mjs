// Local, isolated visual QA only. This page is never included in the Douyin package.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'src') + path.sep;
const modules = new Map();
async function collect(filename) {
  if (!filename.startsWith(sourceRoot) || /[\\/](main|platform)\.js$/.test(filename)) {
    throw new Error('Visual fixtures must use presentation and core modules only');
  }
  const id = path.relative(root, filename).replaceAll('\\', '/');
  if (modules.has(id)) return id;
  modules.set(id, '');
  let source = await readFile(filename, 'utf8');
  for (const match of [...source.matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)]) {
    const file = path.resolve(path.dirname(filename), match[1].endsWith('.js') ? match[1] : match[1] + '.js');
    const dependency = await collect(file);
    source = source.replace(match[0], 'require(' + JSON.stringify(dependency) + ')');
  }
  modules.set(id, source);
  return id;
}

function visualFixtures(require) {
  'use strict';
  const { Game, CONFIG } = require('src/core.js');
  const { Renderer } = require('src/renderer.js');
  const { selectCurrentTarget } = require('src/experience.js');
  const { selectOfflineSummary } = require('src/offline-summary.js');
  const { selectNextStep } = require('src/next-step.js');
  const NOW = 1800000000000;
  const canvas = document.getElementById('game');
  const report = document.getElementById('report');
  const status = document.getElementById('status');
  const viewport = document.getElementById('viewport');
  const fixtures = document.getElementById('fixtures');
  const base = { taps: 20, bursts: 1, playedSeconds: 120, energy: 85, orderIndex: 3, totalProduced: 800,
    upgrades: { tap: 4, auto: 4, value: 1 } };
  const definitions = [
    { id: 'delivery-mid', name: '第11单 · 分段交付', modal:'order', state:{...base,machine:2,orderIndex:10,totalProduced:4000000,coins:19440801,upgrades:{tap:16,auto:17,value:17},learning:{heatRecoveryUses:10}} },
    { id: 'delivery-late', name: '第17单 · 分段交付', modal:'order', state:{...base,machine:4,orderIndex:16,totalProduced:310000000,coins:7e10,upgrades:{tap:24,auto:24,value:24},refinements:{yield:1,value:1},learning:{heatRecoveryUses:10}} },
    { id: 'commission-choice', name: '等待期间 · 二选一委托', modal:'commissions', state:{...base,machine:3,orderIndex:10,totalProduced:800000,coins:1e8,energy:96,upgrades:{tap:18,auto:18,value:18},learning:{heatRecoveryUses:10}} },
    { id: 'souvenir-shop', name: '竣工 · 纪念收藏', modal:'souvenirs', state:{...base,machine:5,orderIndex:20,loopIndex:3,totalProduced:5e9,coins:2e12,upgrades:{tap:24,auto:24,value:24},refinements:{yield:3,value:3},learning:{heatRecoveryUses:10}} },
    { id: 'craft-line', name: '流水线 · 工艺强化', modal:'refinements', state:{...base,machine:4,orderIndex:14,totalProduced:64000000,coins:1e10,upgrades:{tap:24,auto:24,value:24},learning:{heatRecoveryUses:10,heatRecoveryDismissed:false}} },
    { id: 'craft-stage', name: '第17单 · 二级工艺', modal:'refinements', state:{...base,machine:4,orderIndex:16,totalProduced:220000000,coins:7e10,upgrades:{tap:24,auto:24,value:24},refinements:{yield:1,value:1},learning:{heatRecoveryUses:10,heatRecoveryDismissed:false}} },
    { id: 'gold-tower', name: '金装塔 · 成长外观', state:{...base,machine:5,orderIndex:19,totalProduced:1200000000,coins:1e10,upgrades:{tap:24,auto:24,value:24},refinements:{yield:3,value:3},learning:{heatRecoveryUses:10,heatRecoveryDismissed:false}} },
    { id: 'mode-advice', name: '缺资金 · 切档建议', state:{...base,machine:2,orderIndex:10,totalProduced:847526.7689210637,coins:19440801.157558426,upgrades:{tap:16,auto:17,value:17}} },
    { id: 'heat-lesson', name: '余热 · 首次练习', modal:'heatLesson', state:{...base,machine:3,orderIndex:10,totalProduced:3000000,coins:1e8,energy:92,upgrades:{tap:18,auto:18,value:18}} },
    { id: 'midgame-funding', name: '第11单 · 攒多头机', modal: 'machine', state: { ...base, machine: 2, orderIndex: 10, totalProduced: 847526.7689210637, coins: 19440801.157558426, upgrades: { tap: 16, auto: 17, value: 17 } } },
    { id: 'heat-unlock', name: '多头机 · 余热门槛', modal: 'upgrades', state: { ...base, machine: 3, orderIndex: 10, totalProduced: 3000000, coins: 1e9, upgrades: { tap: 15, auto: 19, value: 18 } } },
    { id: 'heat-ready', name: '多头机 · 完美接力', state: { ...base, machine: 3, orderIndex: 10, totalProduced: 3000000, coins: 1e8, energy: 92, upgrades: { tap: 18, auto: 18, value: 18 } } },
    { id: 'heat-active', name: '余热 · 剩余10次', state: { ...base, machine: 3, orderIndex: 10, totalProduced: 3000000, coins: 1e8, energy: 0, heatRecoveryTaps: 10, upgrades: { tap: 18, auto: 18, value: 18 } } },
    { id: 'bulk-buy', name: '批量 · 实际级数', modal: 'upgrades', quantity: 5, state: { ...base, machine: 3, orderIndex: 10, totalProduced: 3000000, coins: 1e9, upgrades: { tap: 18, auto: 18, value: 18 } } },
    { id: 'bulk-reserve', name: '批量 · 预留换代款', modal: 'upgrades', quantity: 5, state: { ...base, machine: 3, orderIndex: 14, totalProduced: 64000000, coins: 1e10, upgrades: { tap: 18, auto: 18, value: 18 } } },
    { id: 'mode-home', name: '双缸机 · 选择档位', state: { ...base, machine: 2, orderIndex: 6, totalProduced: 20000, coins: 1000, upgrades: { tap: 8, auto: 8, value: 6 } } },
    { id: 'mode-panel', name: '三档收益比较', modal: 'productionModes', state: { ...base, machine: 2, orderIndex: 6, totalProduced: 20000, coins: 1000, upgrades: { tap: 8, auto: 8, value: 6 } } },
    { id: 'offline-ready', name: '离线回归 · 可领单', modal: 'offline', state: { ...base, machine: 2, orderIndex: 6, totalProduced: 20000, coins: 1000, upgrades: { tap: 8, auto: 8, value: 6 }, offline: { id: 'offline:visual', seconds: 3600, production: 40000, coins: 80000 } } },
    { id: 'brand-relative', name: '品牌 · 相对增长', modal: 'brand', state: { ...base, machine: 3, brandLevel: 5, orderIndex: 10, totalProduced: 800000, coins: 1000, upgrades: { tap: 8, auto: 8, value: 6 } } },
    { id: 'fresh', name: '首次开工', state: {}, claimReady: false },
    { id: 'tracked-upgrade', name: '追踪升级', state: { taps: 5, coins: 100 }, guide: 'start-tap-upgrade' },
    { id: 'quest-ready', name: '任务可领', state: { taps: 5, coins: 20 }, claimReady: false },
    { id: 'order-ready', name: '订单达标', state: { taps: 5, coins: 100, totalProduced: 50, upgrades: { tap: 1, auto: 1, value: 1 } } },
    { id: 'saving-1000', name: '攒机器 · 1,000', state: { ...base, coins: 1000 } },
    { id: 'saving-29500', name: '攒机器 · 29,500', state: { ...base, coins: 29500 } },
    { id: 'saving-29900', name: '攒机器 · 29,900', state: { ...base, coins: 29900 } },
    { id: 'machine-ready', name: '可立即换代', state: { ...base, coins: CONFIG.machines[1].cost } },
    { id: 'orders-reserved', name: '金币够 · 缺订单', state: { ...base, coins: CONFIG.machines[1].cost, orderIndex: 2, totalProduced: 200 } },
    { id: 'all-max', name: '最终机器 · 全满级', state: { ...base, machine: 5, coins: 1e12, orderIndex: 20,
      totalProduced: CONFIG.orders[19].target, upgrades: { tap: 24, auto: 24, value: 24 }, refinements:{yield:3,value:3}, learning:{heatRecoveryUses:10,heatRecoveryDismissed:false} } }
  ];
  const errors = [];
  let game, renderer, selected, ui, lastAction = null, pointer = null;
  function dimensions() {
    const [width, height] = viewport.value.split('x').map(Number);
    return { width, height };
  }
  function reportError(error) {
    errors.push(String(error && error.message || error).slice(0, 500));
    status.textContent = '夹具错误：' + errors.at(-1);
    report.textContent = JSON.stringify({ fixture: selected && selected.id, errors }, null, 2);
  }
  window.addEventListener('error', event => reportError(event.error || event.message));
  window.addEventListener('unhandledrejection', event => reportError(event.reason));
  function draw() {
    const view = game.getView(), before = JSON.stringify(game.exportSave(NOW));
    renderer.draw(view, ui, .016);
    const unchanged = before === JSON.stringify(game.exportSave(NOW));
    if (!unchanged) throw new Error('Rendering changed the fixture game state');
    const recommendation = renderer.interface.recommendation || null;
    const s = view.state;
    status.textContent = selected.name + ' · ' + ui.viewport.width + ' × ' + ui.viewport.height + ' · ' +
      (lastAction ? '最近操作：' + lastAction.action : '静态夹具已就绪；可点击画布检查操作');
    report.textContent = JSON.stringify({
      purpose: '本地视觉夹具，不读写游戏存档；所有操作只影响本页内存，重新选夹具即可复原。',
      fixture: selected.id, viewport: ui.viewport, modal: ui.modal, focusUpgrade: ui.focusUpgrade || null, gameStateChangedByRender: !unchanged,
      target: selectCurrentTarget(view, ui), recommendation,
      productionModes: view.productionModes, offlineSummary: selectOfflineSummary(view), milestones: view.milestones, refinements:view.refinements, learning:s.learning,
      deliveries:view.deliveries, commissions:view.commissions, souvenirs:view.souvenirs,
      state: { coins: s.coins, totalProduced: s.totalProduced, taps: s.taps, machine: s.machine,
        productionMode: s.productionMode, heatRecoveryTaps: s.heatRecoveryTaps, energy: s.energy, bursts: s.bursts,
        upgrades: s.upgrades, claimedQuests: s.claimedQuests, orderIndex: s.orderIndex, loopIndex: s.loopIndex, souvenirs:s.souvenirs },
      bulkQuotes: view.upgrades.map(u => ({ key: u.key, ...u.bulk })),
      order: { ready: view.order.ready, stageProgress: view.order.stageProgress, reward: view.order.reward },
      machine: { canEvolve: view.canEvolve, reason: view.evolveReason, next: view.nextMachine && view.nextMachine.name },
      lastAction, hitZones: renderer.zones.map(({ x, y, w, h, action }) => ({ x, y, w, h, action })), errors
    }, null, 2);
  }
  function select(id) {
    selected = definitions.find(item => item.id === id) || definitions[0];
    game = new Game({ now: NOW });
    Object.assign(game.state, JSON.parse(JSON.stringify(selected.state)));
    game.state.totalCoins = game.state.coins;
    if (selected.claimReady !== false) {
      // Include only already-achieved, unlocked claims. Repeat when a completed
      // chapter unlocks the next one; future tasks never become falsely claimed.
      for (let i = 0; i < 4; i++) {
        const ready = game.getView().quests.chapters.flatMap(chapter => chapter.quests).filter(q => q.ready);
        if (!ready.length) break;
        game.state.claimedQuests.push(...ready.map(q => q.id));
      }
    }
    ui = { viewport: dimensions(), tab: 'upgrades', isDouyin: false, adBusy: false, modal: null, toast: '',
      startup: false, questGuideId: selected.guide || '' };
    if (selected.modal) ui.modal = { type: selected.modal, ...(selected.modal === 'upgrades' ? { quantity: selected.quantity || 1 } : {}) };
    canvas.width = ui.viewport.width;
    canvas.height = ui.viewport.height;
    canvas.style.width = canvas.width + 'px';
    canvas.style.height = canvas.height + 'px';
    renderer = new Renderer(canvas.getContext('2d'));
    lastAction = null;
    pointer = null;
    for (const button of fixtures.children) button.setAttribute('aria-pressed', String(button.dataset.fixture === selected.id));
    draw();
  }
  function open(type, focusUpgrade = '') {
    ui.modal = { type, ...(type === 'upgrades' ? { quantity: 1 } : {}) };
    ui.focusUpgrade = type === 'upgrades' ? focusUpgrade : '';
    if (type === 'quests') ui.modal.chapterId = game.getView().quests.activeChapterId;
  }
  function dispatch(action) {
    if (!action) return;
    let result = null;
    if(action==='goalExpand'||action==='goalCollapse'){
      if(action==='goalCollapse'){const step=selectNextStep(game.getView(),selectCurrentTarget(game.getView(),ui),ui);if(step.kind==='mode')ui.dismissedModeSuggestion=step.id;}
      ui.goalExpanded=action==='goalExpand';
    }else if(action.startsWith('modeAdvice:')){
      const step=selectNextStep(game.getView(),selectCurrentTarget(game.getView(),ui),ui);
      if(step.kind!=='mode'||step.id!==action.slice(11))return;
      ui.dismissedModeSuggestion=step.id;open('productionModes');ui.modal.advice=step;
    }else if(action==='skipHeatLesson'){result=game.dismissHeatRecoveryGuide();ui.modal=null;ui.goalExpanded=undefined;}
    else if(action==='practiceHeat'){ui.modal=null;ui.goalExpanded=undefined;}
    else if(action.startsWith('refinement:')){const [,key,level,cost]=action.split(':');result=game.buyRefinement(key,{level:Number(level),cost:Number(cost)});}
    else if (action === 'target') {
      const target = selectCurrentTarget(game.getView(), ui);
      if (!target || !target.action) return;
      if (target.action.startsWith('upgrade:')) open('upgrades', target.action.slice(8));
      else return dispatch(target.action);
    } else if (action === 'tap') { if (!ui.modal) result = game.tap(); }
    else if (action === 'timing') { if (!ui.modal) {result = game.tryPerfectBurst();if(result.ok){ui.toast=result.perfect?'火候正好！本锅额外 +20%':'下锅再挑战';ui.toastKind='timing';}} }
    else if (action.startsWith('delivery:')) { const [,orderIndex,stage]=action.split(':');result=game.claimDelivery(Number(stage),Number(orderIndex)); }
    else if (action.startsWith('commissionAccept:')) {
      const rest=action.slice('commissionAccept:'.length),separator=rest.indexOf(':'),kind=rest.slice(0,separator),id=rest.slice(separator+1);
      const quote=ui.modal&&ui.modal.commissionQuotes&&ui.modal.commissionQuotes[kind];
      if(quote&&quote.id===id){result=game.acceptCommission(kind,quote);if(result.ok){ui.modal=null;ui.goalExpanded=true;}}
    }
    else if (action.startsWith('commissionClaim:')) { result=game.claimCommission(action.slice('commissionClaim:'.length));if(result.ok)open('commissions'); }
    else if (action.startsWith('commissionCancel:')) { result=game.cancelCommission(action.slice('commissionCancel:'.length));if(result.ok)open('commissions'); }
    else if (action.startsWith('souvenir:')) { const key=action.slice('souvenir:'.length);result=game.buySouvenir(key,ui.modal&&ui.modal.souvenirQuotes&&ui.modal.souvenirQuotes[key]);if(result.ok)open('souvenirs'); }
    else if (action.startsWith('upgradeQuantity:')) {
      const quantity = Number(action.slice(16));
      if (ui.modal && ui.modal.type === 'upgrades' && game.getView().milestones.bulkUpgrade.unlocked && [1, CONFIG.bulkUpgradeMaxCount].includes(quantity)) ui.modal.quantity = quantity;
    }
    else if (action.startsWith('upgradeBatch:')) {
      if (ui.modal && ui.modal.type === 'upgrades' && ui.modal.quantity === CONFIG.bulkUpgradeMaxCount) {
        const [, key, fromLevel, count, cost] = action.split(':');
        result = game.buyUpgradeBatch(key, { fromLevel: Number(fromLevel), count: Number(count), cost: Number(cost) });
      }
    }
    else if (action.startsWith('fundingUpgrade:')) {
      const step = selectNextStep(game.getView(),null,{suppressModeAdvice:true});
      if (ui.modal && ui.modal.type === 'machine' && step.kind === 'upgrade' && step.enabled && step.estimate && step.upgradeKey === action.slice(15)) {
        open('upgrades', step.upgradeKey);
      }
    }
    else if (action.startsWith('productionMode:')) result = game.setProductionMode(action.slice(15));
    else if (action === 'claimOffline') { ui.modal = null; result = game.claimOffline(); }
    else if (action.startsWith('upgrade:')) result = game.buyUpgrade(action.slice(8));
    else if (action.startsWith('questClaim:')) result = game.claimQuest(action.slice(11));
    else if (action === 'claimOrder') { ui.modal = null; result = game.claimOrder(); }
    else if (action === 'evolve') { ui.modal = null; result = game.evolve(); }
    else if (action === 'close') ui.modal = null;
    else if (action.startsWith('tab:')) open(({ machines: 'machine', upgrades: 'upgrades', stats: 'stats', brand: 'brand' })[action.slice(4)] || 'workshop');
    else if (action.startsWith('questChapter:')) { if (ui.modal) { ui.modal.chapterId = action.slice(13); ui.modal.page = 0; } }
    else if (action.startsWith('questPage:') || action.startsWith('blueprintPage:')) { if (ui.modal) ui.modal.page = Number(action.split(':')[1]) || 0; }
    else if (action.startsWith('questGo:')) {
      const quest = game.getView().quests.chapters.flatMap(chapter => chapter.quests).find(q => q.id === action.slice(8));
      if (quest && !quest.locked && !quest.claimed) {
        ui.questGuideId = quest.id;
        if (quest.action.startsWith('upgrade:')) open('upgrades', quest.action.slice(8));
        else if (['machine', 'order'].includes(quest.action)) open(quest.action);
        else ui.modal = null;
      }
    } else if (action.startsWith('setting:')) {
      const key = action.slice(8);
      result = game.setSetting(key, !game.state.settings[key]);
    } else if (['upgrades', 'order', 'machine', 'quests', 'workshop', 'settings', 'help', 'privacy',
      'health', 'stats', 'blueprint', 'completion', 'brand', 'turbo', 'productionModes', 'offline','refinements','heatLesson','commissions','souvenirs'].includes(action)) open(action);
    else result = { ok: false, reason: '本地夹具不执行广告、平台或存档操作' };
    lastAction = { action, result };
    for (const event of game.drainEvents()) {renderer.emit(event);if(event.type==='burst'&&ui.toastKind==='timing'){ui.toast='';ui.toastKind='';}}
    draw();
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height };
  }
  canvas.addEventListener('pointerdown', event => {
    const p = point(event);
    pointer = { ...p, id: event.pointerId, action: renderer.actionAt(p.x, p.y) };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const previous = pointer;
    pointer = null;
    const p = point(event), action = renderer.actionAt(p.x, p.y);
    if (action === previous.action && Math.hypot(p.x - previous.x, p.y - previous.y) <= 20) {
      try { dispatch(action); } catch (error) { reportError(error); }
    }
  });
  canvas.addEventListener('pointercancel', () => { pointer = null; });
  for (const item of definitions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.name;
    button.dataset.fixture = item.id;
    button.addEventListener('click', () => { try { select(item.id); } catch (error) { reportError(error); } });
    fixtures.appendChild(button);
  }
  viewport.addEventListener('change', () => { try { select(selected.id); } catch (error) { reportError(error); } });
  document.getElementById('reset').addEventListener('click', () => { try { select(selected.id); } catch (error) { reportError(error); } });
  select('fresh');
}

await collect(path.join(root, 'src/core.js'));
await collect(path.join(root, 'src/renderer.js'));
const bundle = `const modules={${[...modules].map(([id, source]) => JSON.stringify(id) + ':function(module,exports,require){\n' + source + '\n}').join(',\n')}};
const cache={};function require(id){if(cache[id])return cache[id].exports;if(!modules[id])throw new Error('Unknown fixture module '+id);const m=cache[id]={exports:{}};modules[id](m,m.exports,require);return m.exports;}
(${visualFixtures.toString()})(require);`;
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>本地视觉夹具 · 档位与回归</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:16px;background:#edf1eb;color:#283e32;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif}
h1{font-size:22px;margin:0 0 4px}p{margin:4px 0 10px}button,select{font:inherit;color:inherit;background:#fffdf7;border:1px solid #b8c9b2;border-radius:7px;padding:8px 12px;min-height:44px}
button{cursor:pointer}button[aria-pressed=true]{color:#fff;background:#366348;border-color:#366348}.controls{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:10px 0}
#fixtures{display:flex;flex-wrap:wrap;gap:6px;max-width:1500px}main{display:flex;gap:20px;align-items:flex-start;margin-top:12px}
canvas{display:block;flex:none;touch-action:none;box-shadow:0 0 0 1px #bdceb6}
aside{background:#fffdf7;border:1px solid #d4dfce;border-radius:8px;padding:14px;min-width:380px;max-width:760px;max-height:844px;overflow:auto}
h2{font-size:16px;margin:0 0 8px}pre{font:12px/1.5 Consolas,monospace;white-space:pre-wrap;word-break:break-word;margin:0}#status{font-weight:650;margin-top:10px}
</style></head><body>
<h1>本地视觉夹具 · 档位与回归</h1>
<p>本地视觉夹具，不读写游戏存档。左侧由真实游戏渲染器绘制；点击只改变本页内存。此页不加载正式入口，不执行广告，不推进时钟。</p>
<div id="fixtures" aria-label="选择视觉夹具"></div>
<div class="controls"><label for="viewport">画布尺寸</label><select id="viewport" aria-label="画布尺寸"><option value="320x524">320 × 524 · 安全区</option><option value="320x568">320 × 568 · 小屏</option><option value="390x844" selected>390 × 844 · 常规</option></select><button id="reset" type="button">复原当前夹具</button><span>切换尺寸也会复原当前夹具。</span></div>
<p id="status" role="status"></p>
<main><canvas id="game" role="application" tabindex="0" aria-label="隔离夹具游戏画面"></canvas><aside aria-label="视觉夹具只读报告"><h2>当前目标、推荐与操作结果</h2><pre id="report" aria-label="视觉夹具 JSON 报告"></pre></aside></main>
<script>(function(){${bundle.replaceAll('</script', '<\\/script')}})();</script></body></html>`;
await writeFile(path.join(root, 'web/visual-check.html'), html);
console.log('Local-only visual fixtures: /visual-check.html');
console.log('Included ' + modules.size + ' core/presentation modules; no main, platform or storage adapter.');


