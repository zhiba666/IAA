'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { canvasHarness } = require('./canvas-harness.cjs');
const { Game } = require('../src/core');
const START = 1800000000000;
const KEY = 'little_popcorn_factory_pipeline_v2';

// Real built main + platform + renderer + core. Only browser DOM primitives,
// its animation clock and Canvas drawing calls are supplied by this fixture.
function browserBoot({ width = 320, height = 524, pixelRatio = 1, left = 0, top = 0, save = null } = {}) {
  const drawing = canvasHarness(), pointerEvents = {}, documentEvents = {}, windowEvents = {}, storage = new Map();
  let renderer = null, now = START, nextFrame = null;
  if (save) storage.set(KEY, JSON.stringify(save));
  const rect = { left, top, width, height, right: left + width, bottom: top + height };
  const canvas = {
    style: {}, setAttribute() {}, getContext(type) { assert.equal(type,'2d'); return drawing.ctx; },
    getBoundingClientRect: () => rect,
    addEventListener(name, fn) { assert.equal(pointerEvents[name],undefined); pointerEvents[name] = fn; },
    setPointerCapture(id) { assert.ok(Number.isInteger(id)); }
  };
  const document = {
    hidden: false, getElementById: id => id === 'game' ? canvas : null, querySelector: () => canvas,
    addEventListener(name, fn) { documentEvents[name] = fn; }
  };
  const window = {
    innerWidth: width, innerHeight: height, devicePixelRatio: pixelRatio,
    addEventListener(name, fn) { windowEvents[name] = fn; },
    localStorage: { getItem: key => storage.get(key), setItem: (key,value) => storage.set(key,value) }
  };
  const context = vm.createContext({ document, window,
    __captureRenderer(value) { renderer = value; },
    Date: class extends Date { static now() { return now; } },
    requestAnimationFrame(fn) { assert.equal(nextFrame,null); nextFrame = fn; }
  });
  let source = fs.readFileSync(path.resolve(__dirname,'../web/game.bundle.js'),'utf8');
  const marker = 'let renderer = new Renderer(ctx, art);';
  assert.equal(source.split(marker).length,2);
  source = source.replace(marker,marker+'\n__captureRenderer(renderer);');
  vm.runInContext(source,context);
  const h = {
    canvas, rect, storage, drawing,
    snapshot: () => JSON.parse(JSON.stringify(context.__POPCORN__.snapshot())),
    actions: () => renderer.zones.map(zone => zone.action),
    verifyControls() {
      for (const zone of renderer.zones.filter(item => item.action && item.action !== 'noop')) {
        assert.ok(zone.w >= 44 && zone.h >= 44, '44px minimum touch target: ' + zone.action);
        assert.ok(zone.x >= 0 && zone.y >= 0 && zone.x + zone.w <= Math.min(width, 480)
          && zone.y + zone.h <= height, 'the entire control stays inside the visible viewport: ' + zone.action);
      }
    },
    frame(ms = 0) { now += ms; drawing.clear(); const fn = nextFrame; nextFrame = null; assert.equal(typeof fn,'function'); fn(now); assert.equal(drawing.depth(),0); },
    event(type,x,y,pointerType='mouse',id=1) {
      let prevented = false;
      pointerEvents[type]({pointerId:id,pointerType,clientX:x,clientY:y,button:0,buttons:type === 'pointerdown' ? 1 : 0,preventDefault(){prevented=true;}});
      assert.equal(prevented,true,'Canvas pointer handler received '+type);
    },
    clickAt(x,y,pointerType='mouse',betweenFrames=false) {
      h.event('pointermove',x,y,pointerType);
      h.event('pointerdown',x,y,pointerType);
      if (betweenFrames) h.frame(16);
      h.event('pointerup',x,y,pointerType);
      pointerEvents.lostpointercapture({pointerId:1});
      h.frame(0);
    },
    point(action) {
      const zone = renderer.zones.find(item => item.action === action);
      assert.ok(zone,'real hit region exists: '+action);
      const x=zone.x+zone.w/2,y=zone.y+zone.h/2;
      assert.equal(renderer.actionAt(x,y),action);
      return { x:left+(width-Math.min(width,480))/2+x, y:top+y };
    },
    clickAction(action,pointerType='mouse',betweenFrames=false) { const p=h.point(action);h.clickAt(p.x,p.y,pointerType,betweenFrames); }
  };
  h.frame(); return h;
}

test('browser bundle routes real mouse and touch coordinates through platform and station hit testing', () => {
  const game = new Game({now:START}); game.tick(40); const save = game.exportSave(START);
  for (const options of [
    { width:320,height:524 },
    { width:320,height:524,pixelRatio:2 },
    { width:390,height:844,pixelRatio:3,left:12,top:20 },
    { width:960,height:900,pixelRatio:2 }
  ]) for (const pointerType of ['mouse','touch','pen']) {
    const h=browserBoot({...options,save});
    h.verifyControls();
    assert.ok(h.actions().includes('station:cup'));
    const before=h.snapshot();
    h.clickAction('station:cup',pointerType,true);
    assert.ok(h.actions().includes('upgrade:cup:1'),'actual pointer opens the quoted station controls');
    assert.ok(h.actions().includes('station:pop'),'the factory remains directly selectable beside the compact controls');
    h.verifyControls();
    h.clickAction('upgrade:cup:1',pointerType,true);
    const after=h.snapshot();
    assert.equal(after.state.upgrades.cup,1);
    assert.equal(after.state.totalSpent-before.state.totalSpent,30);
    assert.equal(after.state.coins,before.state.coins-30);
    assert.ok(h.actions().includes('station:cup'));
    assert.ok(h.actions().includes('reviewUpgrade'));
    assert.ok(!h.actions().some(action => action && action.startsWith('upgrade:')));
    h.verifyControls();
    assert.equal(JSON.parse(h.storage.get(KEY)).upgrades.cup,1,'browser storage receives the purchased upgrade');
  }
});

test('the visible cup machine opens compact controls at 320 by 524 and keeps every station selectable', () => {
  const h=browserBoot();
  h.clickAction('station:cup','mouse',true);
  assert.ok(h.actions().includes('station:pop'));
  assert.ok(h.actions().includes('collapseStation'));
  assert.ok(h.drawing.texts.some(entry=>entry.text.includes('快速装杯头')));
  assert.ok(h.drawing.texts.some(entry=>entry.text.includes('预计稳定出货')));
  h.verifyControls();
  h.clickAction('station:ship','touch',true);
  assert.ok(h.drawing.texts.some(entry=>entry.text.includes('快速出货带')));
  h.clickAction('collapseStation');
  assert.ok(h.actions().includes('reviewUpgrade'));
  h.clickAction('close');
  assert.ok(!h.actions().includes('reviewUpgrade'));
  assert.ok(!h.drawing.texts.some(entry=>/重构|旧存档/.test(entry.text)), 'migration details do not occupy the first factory scene');
  h.clickAction('settings');
  assert.ok(h.drawing.texts.some(entry=>entry.text.includes('旧存档保留')));
  h.verifyControls();
});

test('repeated real pointer taps at the former purchase position never arm or buy the following upgrade', () => {
  const game = new Game({ now: START }); game.tick(1000);
  const save = game.exportSave(START); save.machine = 2;
  for (const options of [{ width: 320, height: 524 }, { width: 390, height: 844 }]) {
    const h = browserBoot({ ...options, save });
    h.clickAction('station:cup');
    const button = h.point('upgrade:cup:1');
    h.clickAt(button.x, button.y, 'touch', true);
    const after = h.snapshot();
    assert.ok(after.stations.find(station => station.id === 'cup').upgrade.available, 'next tier is unlocked and affordable');
    for (let i = 0; i < 6; i++) h.clickAt(button.x, button.y, 'touch', true);
    assert.equal(h.snapshot().state.totalSpent, after.state.totalSpent);
    assert.equal(h.snapshot().state.upgrades.cup, 1);
    assert.ok(h.actions().includes('reviewUpgrade'), 'repeated taps do not reopen the next quote');
    h.clickAction('reviewUpgrade');
    h.clickAction('upgrade:cup:2');
    assert.equal(h.snapshot().state.upgrades.cup, 2, 'explicitly reviewing the next quote still permits purchase');
  }
});
