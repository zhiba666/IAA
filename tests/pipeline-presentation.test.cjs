'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const { Renderer } = require('../src/renderer');
const { canvasHarness, deepFreeze } = require('./canvas-harness.cjs');
function realStages() {
  const game = new Game({ now: 1800000000000 }), result = [];
  for (let i = 0; i < 3000; i++) {
    for (const id of CONFIG.stationIds) while (game.getView().stations.find(s => s.id === id).upgrade?.available) game.buyUpgrade(id);
    const view = game.getView();
    const availableForStage = view.stations.some(s => s.upgrade && s.upgrade.requiredMachine <= view.state.machine);
    if (!availableForStage && !result[view.state.machine]) result[view.state.machine] = view;
    if (result.filter(Boolean).length === 6) return result;
    if (view.expansion?.ready) game.evolve();
    game.tick(10);
  }
  assert.fail('all six configured expansion stages must be reachable');
}
const stages = realStages();
function ui(width = 320, height = 568, modal = null, native = false) {
  return { viewport: { width, height, safeTop: native ? 28 : 0, menuBottom: native ? 70 : 0 }, modal, toast: '', toastSeconds: 0, isDouyin: native, newFactory: false };
}
function verifyZones(renderer, viewport) {
  for (const z of renderer.zones.filter(z => z.action && z.action !== 'noop')) {
    assert.ok(z.x >= 0 && z.y >= 0 && z.x + z.w <= viewport.width + 1e-8 && z.y + z.h <= viewport.height + 1e-8, 'hit target stays on screen: ' + z.action);
    assert.ok(z.w >= 32 && z.h >= 32, 'touch target remains usable: ' + z.action);
    if (z.x === 0 && z.y === 0 && z.w === viewport.width && z.h === viewport.height) {
      assert.equal(renderer.actionAt(1,1), 'close', 'tapping the dimmed background closes the sheet');
    } else assert.equal(renderer.actionAt(z.x + z.w / 2, z.y + z.h / 2), z.action, 'visible action wins at its own center');
  }
}

test('all six real stages render read-only at small browser and native viewport sizes', () => {
  for (const view of stages) for (const [width,height,native] of [[320,568,false],[320,524,true],[390,804,true],[480,920,false]]) {
    const canvas = canvasHarness(), renderer = new Renderer(canvas.ctx), state = ui(width,height,null,native);
    const expected = JSON.stringify(view); deepFreeze(view); deepFreeze(state);
    for (let i = 0; i < 3; i++) renderer.draw(view, state, .1);
    assert.equal(JSON.stringify(view), expected);
    assert.equal(canvas.depth(), 0);
    verifyZones(renderer, state.viewport);
    for (const id of CONFIG.stationIds) assert.ok(renderer.zones.some(z => z.action === 'station:' + id));
    assert.equal(renderer.scene.stationFrames.length, 3);
    assert.equal(renderer.scene.bufferFrames.length, 2);
    for (const a of ['start','tap','order','modules','quests','brand','ad:turbo','offline']) assert.ok(!renderer.zones.some(z => z.action === a));
    for (const text of ['爆锅','装杯','出货']) assert.ok(canvas.texts.some(item => item.text.includes(text)));
    assert.ok(canvas.texts.some(item => /设备能力|能力/.test(item.text)), 'nominal equipment capacity is labelled');
    assert.ok(canvas.texts.some(item => /实际/.test(item.text)), 'measured throughput is labelled');
  }
});

test('station sheets expose only their own upgrade and remain within a 320px screen', () => {
  const game = new Game(); game.tick(40); const view = deepFreeze(game.getView());
  for (const stationId of CONFIG.stationIds) {
    const canvas = canvasHarness(), renderer = new Renderer(canvas.ctx), state = deepFreeze(ui(320,524,{type:'station',stationId},true));
    renderer.draw(view,state,.1); verifyZones(renderer,state.viewport); assert.equal(canvas.depth(),0);
    assert.ok(renderer.zones.some(z => z.action === 'close'));
    assert.ok(!renderer.zones.some(z => z.action.startsWith('station:')));
    assert.ok(!renderer.zones.some(z => z.action.startsWith('upgrade:') && z.action !== 'upgrade:' + stationId));
    for (const entry of canvas.texts) {
      const half = entry.align === 'center' ? entry.width / 2 : entry.align === 'right' ? entry.width : 0;
      assert.ok(entry.x - half >= -1 && entry.x - half + entry.width <= 321, 'text fits 320px: ' + entry.text);
    }
  }
});

test('settings, restart and nonblocking new-factory notice keep essential controls accessible', () => {
  const game = new Game(), view = deepFreeze(game.getView());
  for (const modal of [null,{type:'settings'},{type:'restart'}]) {
    const canvas = canvasHarness(), renderer = new Renderer(canvas.ctx), state = ui(320,524,modal,true); state.newFactory = true;
    deepFreeze(state); renderer.draw(view,state,.1); verifyZones(renderer,state.viewport);
    if (!modal) for (const id of CONFIG.stationIds) assert.ok(renderer.zones.some(z => z.action === 'station:' + id));
    if (modal?.type === 'settings') for (const action of ['close','setting:sound','setting:haptics','restart']) assert.ok(renderer.zones.some(z => z.action === action));
    if (modal?.type === 'restart') assert.ok(renderer.zones.some(z => z.action === 'confirmRestart'));
  }
});

test('later configured visuals represent parallel lanes and real multi-portion packages', () => {
  assert.ok(stages.slice(1).some(v => v.stations.some(s => s.lanes > 1)));
  assert.ok(stages.slice(1).some(v => v.stations.find(s => s.id === 'ship').batchSize > 1));
  const canvas = canvasHarness(), renderer = new Renderer(canvas.ctx), game = new Game();
  const before = game.exportSave(1800000000000);
  for (let stage = 0; stage < 6; stage++) renderer.scene.drawMachinePreview(0,0,160,stage);
  assert.deepEqual(game.exportSave(1800000000000), before);
  assert.equal(canvas.depth(),0);
});
