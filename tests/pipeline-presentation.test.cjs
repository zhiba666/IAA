'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const { Renderer } = require('../src/renderer');
const { ProductionScene } = require('../src/production-scene');
const { ProductionInsights } = require('../src/production-insights');
const { canvasHarness, deepFreeze } = require('./canvas-harness.cjs');

function realStages() {
  const game = new Game({ now: 1800000000000 }), result = [], insights = new ProductionInsights();
  for (let i = 0; i < 3000; i++) {
    for (const id of CONFIG.stationIds) while (game.getView().stations.find(s => s.id === id).upgrade?.available) game.buyUpgrade(id);
    const view = game.getView();
    const availableForStage = view.stations.some(s => s.upgrade && s.upgrade.requiredMachine <= view.state.machine);
    if (!availableForStage && !result[view.state.machine]) result[view.state.machine] = deepFreeze(insights.enrich(view));
    if (result.filter(Boolean).length === 6) return result;
    if (view.expansion?.ready) game.evolve();
    game.tick(10);
  }
  assert.fail('all six configured expansion stages must be reachable');
}
const stages = realStages();
// Native height has already had the physical bottom safe area removed by platform.js.
const VIEWPORTS = [[320,524,false],[390,844,false],[320,484,true],[390,804,true],[480,920,false]];
function ui(view, width = 320, height = 524, modal = null, native = false, options = {}) {
  const station = modal?.type === 'station' && view.stations.find(s => s.id === modal.stationId);
  const upgrade = station && station.upgrade;
  return { viewport: { width, height, safeTop: native ? 28 : 0, menuBottom: native ? 70 : 0 },
    modal, toast: '', toastSeconds: 0, isDouyin: native, newFactory: false,
    stationCollapsed: false, stationDetails: false, purchaseFeedback: null, rateUpdatingUntil: 0,
    quote: upgrade ? { stationId: station.id, level: station.level + 1, cost: upgrade.cost, name: upgrade.name } : null,
    ...options };
}
function verifyZones(renderer, viewport) {
  for (const zone of renderer.zones.filter(z => z.action && z.action !== 'noop')) {
    assert.ok(zone.x >= 0 && zone.y >= 0 && zone.x + zone.w <= viewport.width + 1e-8 && zone.y + zone.h <= viewport.height + 1e-8,
      'hit target stays on screen: ' + zone.action);
    assert.ok(zone.w >= 44 && zone.h >= 44, 'primary touch target is at least 44px: ' + zone.action);
    assert.equal(renderer.actionAt(zone.x + zone.w / 2, zone.y + zone.h / 2), zone.action,
      'visible action wins at its own center: ' + zone.action);
  }
}
function verifyTextBounds(canvas, viewport) {
  for (const entry of canvas.texts) {
    const inset = entry.align === 'center' ? entry.width / 2 : entry.align === 'right' ? entry.width : 0;
    assert.ok(entry.x - inset >= -1 && entry.x - inset + entry.width <= viewport.width + 1,
      'text fits screen width: ' + entry.text);
    const size = Number((entry.font.match(/([\d.]+)px/) || [0,14])[1]);
    assert.ok(entry.y - size / 2 >= -1 && entry.y + size / 2 <= viewport.height + 1,
      'text fits screen height: ' + entry.text);
  }
}
function verifyVisibleProduction(renderer, selectedId) {
  const { scene, dock } = renderer.interface.layout;
  assert.equal(renderer.scene.stationFrames.length, 3);
  assert.equal(renderer.scene.bufferFrames.length, 2);
  for (const frame of [...renderer.scene.stationFrames, ...renderer.scene.bufferFrames]) {
    assert.ok(frame.y >= scene.y && frame.y + frame.h <= dock.y,
      'station and stock remain visible above the operation area: ' + frame.id);
  }
  for (const id of CONFIG.stationIds) {
    const frame = renderer.scene.stationFrames.find(f => f.id === id);
    assert.equal(renderer.actionAt(frame.x + frame.w / 2, frame.y + frame.h / 2), 'station:' + id,
      'the real machine stays directly selectable');
  }
  if (selectedId) assert.ok(renderer.scene.stationFrames.some(frame => frame.id === selectedId), 'selected machine remains in view');
}
function renderFrozen(view, state) {
  const canvas = canvasHarness(), renderer = new Renderer(canvas.ctx);
  const expectedView = JSON.stringify(view), expectedUi = JSON.stringify(state);
  deepFreeze(view); deepFreeze(state);
  for (let i = 0; i < 3; i++) renderer.draw(view, state, .1);
  assert.equal(JSON.stringify(view), expectedView, 'rendering leaves production and display snapshots untouched');
  assert.equal(JSON.stringify(state), expectedUi, 'rendering leaves UI state untouched');
  assert.equal(canvas.depth(), 0);
  verifyZones(renderer, state.viewport); verifyTextBounds(canvas, state.viewport);
  return { canvas, renderer };
}

test('all six real stages keep machines, physical stock and operating priorities visible on small browser and native screens', () => {
  for (const view of stages) for (const [width,height,native] of VIEWPORTS) {
    const state = ui(view,width,height,null,native);
    const { canvas, renderer } = renderFrozen(view,state);
    verifyVisibleProduction(renderer);
    for (const action of ['start','tap','order','modules','quests','brand','ad:turbo','offline']) assert.ok(!renderer.zones.some(z => z.action === action));
    for (const text of ['爆锅','装杯','出货','待装','待发','实际出货','10秒']) assert.ok(canvas.texts.some(item => item.text.includes(text)), 'home labels ' + text);
    const homeTexts = canvas.texts.filter(item => item.y < renderer.interface.layout.dock.y).map(item => item.text);
    assert.ok(!homeTexts.some(text => /能力|份\/批|头并行/.test(text)), 'home does not repeat detailed station parameters');
    assert.ok(canvas.texts.some(item => item.text === view.insights.bottleneck.label), 'one stable bottleneck explanation is visible');
    assert.ok(!canvas.texts.some(item => /重构|旧存档|旧工厂/.test(item.text)), 'version migration copy stays out of the operating scene');
    if (view.expansion) {
      assert.ok(canvas.texts.some(item => item.text.includes('扩建开放改造，设备提速需另行购买')));
      assert.ok(canvas.texts.some(item => /待装.*→.*待发.*→/.test(item.text)), 'expansion explains both stock capacity changes');
      assert.ok(canvas.texts.some(item => item.text.startsWith('开放：')));
    }
  }
});

test('station docks preserve every machine and both inventories while allowing direct switching and deliberate quote review', () => {
  const game = new Game(); game.tick(100);
  const views = [deepFreeze(new ProductionInsights().enrich(game.getView())), ...stages];
  for (const view of views) for (const [width,height,native] of VIEWPORTS) for (const stationId of CONFIG.stationIds) {
    for (const options of [{}, { stationDetails: true }, { stationCollapsed: true }]) {
      const state = ui(view,width,height,{type:'station',stationId},native,options);
      const { canvas, renderer } = renderFrozen(view,state);
      verifyVisibleProduction(renderer,stationId);
      assert.ok(canvas.texts.some(item => item.text.includes('▸ ' + CONFIG.stations[stationId].name)), 'selection is communicated with a marker, not color alone');
      const actions = renderer.zones.map(zone => zone.action);
      if (options.stationCollapsed) {
        assert.ok(actions.includes('reviewUpgrade'));
        assert.ok(!actions.some(action => action.startsWith('upgrade:')), 'collapsed observations cannot buy another tier');
      } else {
        assert.ok(actions.includes('collapseStation'));
        assert.ok(actions.includes('toggleDetails'));
        assert.ok(!actions.includes('close'), 'normal operation dock needs no modal close workflow');
        for (const id of CONFIG.stationIds) assert.equal(actions.filter(action => action === 'station:' + id).length, 2, 'machine and dock tab both switch station');
        const station = view.stations.find(item => item.id === stationId);
        const purchase = actions.filter(action => action.startsWith('upgrade:'));
        assert.deepEqual(purchase, station.upgrade?.available ? ['upgrade:' + stationId + ':' + (station.level + 1)] : []);
      }
    }
  }
});

test('upgrade comparison separates equipment and stable-line impact, and keeps price and button positions fixed', () => {
  const game = new Game(); game.tick(100);
  const view = deepFreeze(new ProductionInsights().enrich(game.getView()));
  for (const [width,height,native] of VIEWPORTS) {
    const controls = [];
    for (const stationId of CONFIG.stationIds) {
      const state = ui(view,width,height,{type:'station',stationId},native);
      const { canvas, renderer } = renderFrozen(view,state);
      const station = view.stations.find(item => item.id === stationId);
      const buy = renderer.zones.find(z => z.action === 'upgrade:' + stationId + ':1');
      assert.ok(buy); controls.push([buy.x,buy.y,buy.w,buy.h]);
      assert.ok(canvas.texts.some(item => item.text.includes('能力 ')), 'equipment change has its own label');
      assert.ok(canvas.texts.some(item => item.text.startsWith('预计稳定出货 ≈ ')), 'forecast is labelled separately from actual output');
      if (stationId === 'cup') {
        assert.ok(canvas.texts.some(item => item.text.includes('能力 2→6')));
        assert.ok(canvas.texts.some(item => item.text.includes('≈ 2→4 份/秒')));
      } else assert.ok(canvas.texts.some(item => item.text === '暂不提高稳定出货，为后续改造预留能力'));
      assert.ok(canvas.texts.some(item => item.text === station.upgrade.cost + ' 金币'));
    }
    assert.deepEqual(controls[1],controls[0], 'switching station keeps the purchase button fixed');
    assert.deepEqual(controls[2],controls[0]);
  }
});

test('unavailable purchases explain funds, expansion and full level rather than relying on disabled color', () => {
  const fresh = deepFreeze(new ProductionInsights().enrich(new Game().getView()));
  const cases = [[fresh,'cup','还差 30 金币'],[stages[0],'cup','需先扩建至第 2 代'],[stages[5],'cup','本工位已满级']];
  for (const [view,stationId,reason] of cases) {
    const { canvas,renderer } = renderFrozen(view,ui(view,320,484,{type:'station',stationId},true));
    assert.ok(canvas.texts.some(item => item.text === reason), 'unavailable purchase reason: ' + reason);
    assert.ok(!renderer.zones.some(zone => zone.action.startsWith('upgrade:')));
  }
});

test('settings own version notices and settings/restart controls stay accessible outside native safe areas', () => {
  const view = deepFreeze(new ProductionInsights().enrich(new Game().getView()));
  for (const [width,height,native] of VIEWPORTS) for (const modal of [null,{type:'settings'},{type:'restart'}]) {
    const state = ui(view,width,height,modal,native,{newFactory:true});
    const { canvas,renderer } = renderFrozen(view,state);
    if (!modal) verifyVisibleProduction(renderer);
    if (modal?.type === 'settings') {
      for (const action of ['close','setting:sound','setting:haptics','restart']) assert.ok(renderer.zones.some(z => z.action === action));
      assert.ok(canvas.texts.some(item => item.text === '旧存档保留，不读取、不迁移、不改写'));
      assert.ok(canvas.texts.some(item => item.text.includes('玩法已重构')));
    }
    if (modal?.type === 'restart') assert.ok(renderer.zones.some(z => z.action === 'confirmRestart'));
    if (native) assert.ok(renderer.zones.every(zone => zone.y >= 75), 'native capsule area remains free of game controls');
  }
});

test('each stock bin shows real physical goods even at the smallest scene height and visibly fills from empty to full', () => {
  for (const index of [0,1]) for (const capacity of [12,384]) {
    const canvas = canvasHarness(), scene = new ProductionScene(canvas.ctx), counts = [], fillWidths = [];
    const baseBox = scene.box.bind(scene); let boxes = [], goods = 0;
    scene.box = (...args) => { boxes.push(args); baseBox(...args); };
    // Count tangible kernel/cup primitives rather than merely checking a display value.
    scene.popcorn = () => { goods++; }; scene.cup = () => { goods++; };
    for (const amount of [0,1,capacity/2,capacity]) {
      boxes=[]; goods=0;
      scene.drawBuffer({x:12,y:80,w:280,h:24},{id:index?'cup':'pop',amount,capacity},{},index);
      counts.push(goods);
      // A filled material region is drawn inside the tray before the front lip.
      const tray = boxes[0];
      const fill = boxes.find(rect => rect[0] === tray[0]+4 && rect[1] === tray[1]+4 && rect[3] === tray[3]-8);
      fillWidths.push(fill ? fill[2] : 0);
      assert.equal(canvas.depth(),0);
    }
    assert.equal(counts[0],0, 'empty stocks show no invented goods');
    assert.ok(counts[1]>0, 'one real portion retains a tangible item at 24px bin height');
    assert.ok(counts[2]>counts[1] && counts[3]>counts[2], 'visible goods become denser with genuine accumulation');
    assert.equal(fillWidths[0],0);
    assert.ok(fillWidths[1]>0 && fillWidths[3]>fillWidths[1], 'fill changes with actual occupied stock');
    assert.ok(Math.abs(fillWidths[2]/fillWidths[3]-.5)<1e-8, 'half full stock occupies half the material region');
    assert.ok(Math.abs(fillWidths[1]/fillWidths[3]-1/capacity)<1e-8, 'one portion uses its exact capacity fraction');
  }
});

test('shipment feedback batches actual event receipts, expires visually and never settles or drains production', () => {
  const game = new Game(); game.tick(10);
  const view = deepFreeze(new ProductionInsights().enrich(game.getView()));
  const before = game.exportSave(1800000000000), canvas = canvasHarness(), scene = new ProductionScene(canvas.ctx);
  for (let i=0;i<20;i++) scene.emit({type:'ship',amount:2,coins:2});
  scene.update(.01);
  scene.draw(8,80,304,220,view);
  assert.ok(canvas.texts.some(text => text.text === '+40 金'), 'twenty receipts become one actual summed income notice');
  const first = scene.delivery;
  scene.emit({type:'ship',amount:3,coins:3});
  scene.update(.1);
  assert.equal(scene.delivery,first, 'high frequency events do not restart departure animation');
  assert.equal(scene.delivery.amount,40);
  scene.update(.8); canvas.clear(); scene.draw(8,80,304,220,view);
  assert.ok(canvas.texts.some(text => text.text === '+3 金'), 'later receipts retain their own true total');
  scene.update(1); assert.equal(scene.delivery,null, 'departed visual does not remain as phantom inventory');
  assert.deepEqual(game.exportSave(1800000000000),before, 'visual receipt handling cannot add coins or clear stock');
  assert.equal(canvas.depth(),0);
});

test('upgrades retain their concrete installation name and later stages draw one pop machine with real working heads', () => {
  const canvas = canvasHarness(), scene = new ProductionScene(canvas.ctx);
  scene.emit({type:'upgrade',stationId:'cup',name:'快速装杯头'});
  assert.equal(scene.flash.name,'快速装杯头'); assert.equal(scene.flash.stationId,'cup');
  scene.update(.1); assert.ok(scene.flash.remaining>0);
  assert.ok(stages.slice(1).some(view => view.stations.some(station => station.lanes > 1)));
  assert.ok(stages.slice(1).some(view => view.stations.find(station => station.id === 'ship').batchSize > 1));
  const machine = scene.drawMachine.bind(scene); let chassis = 0, actualHeads = 0;
  scene.drawMachine = (stage,active,station) => { chassis++; actualHeads=station.lanes; machine(stage,active,station); };
  const pop = stages[5].stations.find(station => station.id === 'pop');
  scene.drawPop(12,12,150,54,pop,5);
  assert.equal(chassis,1, 'parallel production has one shared equipment housing');
  assert.equal(actualHeads,pop.lanes, 'actual purchased head count drives the machine artwork');
  assert.equal(canvas.depth(),0);
});

test('expansion alone never invents working heads; only purchased lane changes add real pop heads', () => {
  const canvas=canvasHarness(),scene=new ProductionScene(canvas.ctx),drawHead=scene.drawPopHead.bind(scene);
  let renderedHeads=[];
  scene.drawPopHead=(x,y,w,h,station,index)=>{renderedHeads.push({index,job:station.jobs[index]});drawHead(x,y,w,h,station,index);};
  function checkHeads(view){
    const station=view.stations.find(item=>item.id==='pop');renderedHeads=[];
    scene.drawPop(12,12,150,54,station,view.state.machine);
    assert.equal(renderedHeads.length,station.lanes,'each purchased work head has exactly one visible chamber');
    assert.deepEqual(renderedHeads.map(head=>head.index),Array.from({length:station.lanes},(_,i)=>i));
    for(const head of renderedHeads)assert.equal(head.job,station.jobs[head.index],'each head reads its own actual production job');
    return renderedHeads.length;
  }
  for(const seed of stages.slice(0,5)){
    const game=new Game({save:seed.state,now:0});
    for(let i=0;i<1000&&!game.getView().expansion?.canAfford;i++)game.tick(10);
    for(let i=0;i<1000&&!game.getView().expansion?.ready;i++)game.tick(10);
    const before=game.getView(),headsBefore=checkHeads(before);
    assert.equal(game.evolve().ok,true);
    const expanded=game.getView();
    assert.equal(checkHeads(expanded),headsBefore,'a bigger workshop keeps its existing purchased head count');
    const upgrade=expanded.stations.find(station=>station.id==='pop').upgrade;
    for(let i=0;i<1000&&game.state.coins<upgrade.cost;i++)game.tick(10);
    assert.equal(game.buyUpgrade('pop').ok,true);
    const upgraded=game.getView();
    assert.equal(checkHeads(upgraded),upgrade.lanes,'installation changes heads to the actual purchased lane count');
  }
  assert.equal(canvas.depth(),0);
});

test('small upgrade panels retain equipment rate units and mark forecasts that require expansion', () => {
  const game=new Game();game.tick(100);
  const views=[new ProductionInsights().enrich(game.getView()),...stages.slice(0,5)];
  for(const view of views)for(const stationId of CONFIG.stationIds){
    const station=view.stations.find(item=>item.id===stationId);if(!station.upgrade)continue;
    const {canvas}=renderFrozen(view,ui(view,320,484,{type:'station',stationId},true));
    const equipment=canvas.texts.find(item=>item.text.includes(' · 能力 '));
    assert.ok(equipment&&equipment.text.endsWith('份/秒'),'equipment units and final rate survive the smallest panel');
    const prefix=station.upgrade.lineRequiresExpansion?'扩建后预计出货 ≈ ':'预计稳定出货 ≈ ';
    assert.ok(canvas.texts.some(item=>item.text.startsWith(prefix)),'forecast clearly states its expansion condition');
  }
});
