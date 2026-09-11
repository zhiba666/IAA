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

test('v1.1 default browser package requires continuous drags on both routes and preserves unattended dispatch after purchases', () => {
  for (const size of [{ width: 320, height: 524 }, {width:360,height:640}, { width: 390, height: 844 }, {width:430,height:932}]) {
    const h = browserBoot({ ...size, mode: 'v15' });
    assert.equal(h.snapshot().mode, 'v15'); h.verifyControls();
    for (let i = 0; i < 3; i++) h.frame(1000);
    h.clickAction('transfer-source-pop', 'touch'); h.clickAction('transfer-target-cup', 'touch');
    assert.equal(h.snapshot().transfers[0].reservedAmount,0);
    assert.equal(h.snapshot().transfers[0].manualTransfers,0,'tap followed by tap cannot submit A cargo');
    assert.equal(h.snapshot().state.inputs.cup,0);
    assert.equal(h.presentation().transfer,null);
    h.drag('transfer-source-pop','transfer-target-cup');
    for (let i = 0; i < 3; i++) h.frame(1000);
    assert.equal(h.snapshot().state.totalSold, 0);
    h.clickAction('transfer-source-cup','touch');h.clickAction('transfer-target-ship','touch');
    assert.equal(h.snapshot().transfers[1].manualTransfers,0,'tap followed by tap cannot submit B cargo');
    h.drag('transfer-source-cup','transfer-target-ship');
    for (let i = 0; i < 2; i++) h.frame(1000);
    assert.equal(h.snapshot().state.totalSold, 4);
    const sceneBefore=h.presentation().scene.machines;
    h.clickAction('station:cup'); h.verifyControls();
    assert.ok(!h.actions().some(action=>action.startsWith('station:')||action.startsWith('transfer-')));
    assert.deepEqual(h.presentation().scene.machines,sceneBefore,'opening the modal does not move the machines');
    h.clickAction('close');
    h.clickAction('openLogistics'); h.verifyControls(); h.clickAction('close');
    assert.equal(h.storage.has(KEY), false);
  }
  const g = new Game({ mode: 'v15', now: START });
  for (let i = 0; i < 50; i++) {
    g.tick(8);
    for (const source of ['pop', 'cup']) { const r = g.reserveTransfer(source); if (r.ok) g.commitTransfer(r.token); }
  }
  assert.equal(g.buyUpgrade('cup').ok, true);
  const h = browserBoot({ mode: 'v15', save: g.exportSave(START) });
  const before = h.snapshot().state.totalSpent;
  h.clickAction('openLogistics');h.purchase('automate-pop');h.clickAction('openLogistics');h.purchase('automate-cup');
  assert.ok(h.snapshot().transfers.every(t => t.automated));
  assert.equal(h.snapshot().state.totalSpent - before, 460);
  h.clickAction('openLogistics');h.purchase('logistics');
  assert.equal(h.snapshot().state.logisticsLevel, 1);
  const sold = h.snapshot().state.totalSold;
  for (let i = 0; i < 60; i++) h.frame(1000);
  assert.ok(h.snapshot().state.totalSold > sold);
  assert.ok(h.snapshot().automaticTrial.complete);
});

// Real built main + platform + renderer + core. Only browser DOM primitives,
// its animation clock and Canvas drawing calls are supplied by this fixture.
function browserBoot({ width = 320, height = 524, pixelRatio = 1, left = 0, top = 0, save = null, experiment = null, mode = 'baseline' } = {}) {
  const drawing = canvasHarness(), pointerEvents = {}, documentEvents = {}, windowEvents = {}, storage = new Map();
  let now = START, nextFrame = null;
  if (save) storage.set(save.version === 4 ? 'little_popcorn_factory_automation_v4' : KEY, JSON.stringify(save));
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
    location: { search: experiment ? '?experiment=' + experiment : mode === 'baseline' ? '?mode=baseline' : '' },
    innerWidth: width, innerHeight: height, devicePixelRatio: pixelRatio,
    addEventListener(name, fn) { windowEvents[name] = fn; },
    localStorage: { getItem: key => storage.get(key), setItem: (key,value) => storage.set(key,value) }
  };
  const context = vm.createContext({ document, window,
    Date: class extends Date { static now() { return now; } },
    requestAnimationFrame(fn) { assert.equal(nextFrame,null); nextFrame = fn; }
  });
  const source = fs.readFileSync(path.resolve(__dirname,'../web/game.bundle.js'),'utf8');
  vm.runInContext(source,context);
  assert.equal(context.__POPCORN__.version,'1.1.0');
  const presentation=()=>JSON.parse(JSON.stringify(context.__POPCORN__.presentation()));
  const actionAt=(x,y)=>{const zones=presentation().zones;for(let i=zones.length-1;i>=0;i--){const z=zones[i];if(x>=z.x&&x<=z.x+z.w&&y>=z.y&&y<=z.y+z.h)return z.action;}return null;};
  const h = {
    canvas, rect, storage, drawing,
    snapshot: () => JSON.parse(JSON.stringify(context.__POPCORN__.snapshot())),
    presentation,
    actionAt: (x,y)=>actionAt(x-left,y-top),
    actions: () => presentation().zones.map(zone => zone.action),
    verifyControls() {
      const ratio=Math.min(2,Math.max(1,pixelRatio));
      assert.equal(canvas.width,Math.round(width*ratio));assert.equal(canvas.height,Math.round(height*ratio));
      assert.deepEqual(presentation().layout.scene,{x:0,y:0,w:width,h:height});
      assert.equal(presentation().layout.dock,undefined);
      for (const zone of presentation().zones.filter(item => item.action && item.action !== 'noop')) {
        assert.ok(zone.w >= 44 && zone.h >= 44, '44px minimum touch target: ' + zone.action);
        assert.ok(zone.x >= 0 && zone.y >= 0 && zone.x + zone.w <= width+.001
          && zone.y + zone.h <= height+.001, 'the entire control stays inside the visible viewport: ' + zone.action);
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
      const zone = presentation().zones.slice().reverse().find(item => item.action === action&&actionAt(item.x+item.w/2,item.y+item.h/2)===action);
      assert.ok(zone,'real hit region exists: '+action);
      const x=zone.x+zone.w/2,y=zone.y+zone.h/2;
      assert.equal(actionAt(x,y),action);
      return { x:left+x, y:top+y };
    },
    clickAction(action,pointerType='mouse',betweenFrames=false) { const p=h.point(action);h.clickAt(p.x,p.y,pointerType,betweenFrames); },
    drag(source,target,pointerType='touch') {const from=h.point(source),to=h.point(target);h.event('pointerdown',from.x,from.y,pointerType);h.event('pointermove',to.x,to.y,pointerType);h.frame(16);h.event('pointerup',to.x,to.y,pointerType);h.frame(0);},
    key(code,repeat=false){windowEvents.keydown({code,repeat,preventDefault(){}});h.frame(0);},
    scroll(deltaY){const c=presentation().layout.modal.content;let prevented=false;pointerEvents.wheel({clientX:left+c.x+c.w/2,clientY:top+c.y+c.h/2,deltaY,deltaMode:0,preventDefault(){prevented=true;}});assert.equal(prevented,true);h.frame(0);},
    revealAction(action){if(h.actions().includes(action))return;h.scroll(-100000);for(let i=0;i<30&&!h.actions().includes(action);i++)h.scroll(24);assert.ok(h.actions().includes(action),'scroll reaches '+action);},
    purchase(key,pointerType='touch'){const q=presentation().quotes[key];assert.ok(q,'reviewed quote '+key);assert.equal(q.action,'purchase:'+q.id);h.revealAction(q.action);h.clickAction(q.action,pointerType);assert.equal(presentation().modal,null,'successful purchase closes its modal');assert.deepEqual(presentation().quotes,{});return q;}
  };
  h.frame(); return h;
}

test('browser bundle routes real mouse and touch coordinates through platform and station hit testing', () => {
  const game = new Game({now:START}); game.tick(40); const save = game.exportSave(START);
  for (const options of [
    { width:320,height:524 },
    { width:320,height:524,pixelRatio:2 },
    { width:360,height:640,pixelRatio:2 },
    { width:390,height:844,pixelRatio:3,left:12,top:20 },
    { width:430,height:932,pixelRatio:3,left:7,top:14 },
    { width:960,height:900,pixelRatio:2 }
  ]) for (const pointerType of ['mouse','touch','pen']) {
    const h=browserBoot({...options,save});
    h.verifyControls();
    assert.ok(h.actions().includes('station:cup'));
    const before=h.snapshot();
    h.clickAction('station:cup',pointerType,true);
    const quote=h.presentation().quotes.upgrade;
    assert.equal(quote.stationId,'cup');assert.equal(quote.level,1);
    assert.ok(h.actions().includes(quote.action),'actual pointer opens the reviewed purchase control');
    assert.ok(!h.actions().some(action=>action.startsWith('station:')),'modal blocks every background station');
    h.verifyControls();
    h.clickAction(quote.action,pointerType,true);
    const after=h.snapshot();
    assert.equal(after.state.upgrades.cup,1);
    assert.equal(after.state.totalSpent-before.state.totalSpent,30);
    assert.equal(after.state.coins,before.state.coins-30);
    assert.ok(h.actions().includes('station:cup'));
    assert.equal(h.presentation().modal,null);
    assert.deepEqual(h.presentation().quotes,{});
    assert.ok(!h.actions().includes('reviewUpgrade'));
    assert.ok(!h.actions().some(action => action && action.startsWith('upgrade:')));
    h.verifyControls();
    assert.equal(JSON.parse(h.storage.get(KEY)).upgrades.cup,1,'browser storage receives the purchased upgrade');
  }
});

test('the visible cup machine opens a centered modal at 320 by 524 and releases all station controls on close', () => {
  const h=browserBoot();
  const original=h.presentation().scene.machines.map(machine=>machine.rect);
  h.clickAction('station:cup','mouse',true);
  const modal=h.presentation().layout.modal;
  assert.ok(Math.abs(modal.x+modal.w/2-160)<.01&&Math.abs(modal.y+modal.h/2-262)<12);
  assert.deepEqual(h.presentation().scene.machines.map(machine=>machine.rect),original);
  assert.ok(!h.actions().includes('station:pop'));
  assert.ok(!h.actions().includes('collapseStation'));
  assert.ok(h.drawing.texts.some(entry=>entry.text.includes('快速装杯头')));
  assert.ok(h.drawing.texts.some(entry=>entry.text.includes('处理速度')));
  assert.ok(h.drawing.texts.some(entry=>entry.text.includes('金币')));
  h.verifyControls();
  h.clickAction('close');
  for(const id of ['pop','cup','ship'])assert.ok(h.actions().includes('station:'+id));
  h.clickAction('station:ship','touch',true);
  assert.ok(h.drawing.texts.some(entry=>entry.text.includes('快速出货带')));
  h.clickAction('close');
  assert.ok(!h.actions().includes('reviewUpgrade'));
  assert.ok(!h.drawing.texts.some(entry=>/重构|旧存档/.test(entry.text)), 'migration details do not occupy the first factory scene');
  h.clickAction('settings');
  assert.ok(h.drawing.texts.some(entry=>entry.text.includes('旧存档备份')));
  h.verifyControls();
});

test('repeated real pointer taps at the former purchase position never arm or buy the following upgrade', () => {
  const game = new Game({ now: START }); game.tick(1000);
  const save = game.exportSave(START); save.machine = 2;
  for (const options of [{ width: 320, height: 524 }, { width: 390, height: 844, pixelRatio:3, left:12, top:20 }]) {
    const h = browserBoot({ ...options, save });
    h.clickAction('station:cup');
    const firstQuote=h.presentation().quotes.upgrade,button=h.point(firstQuote.action);
    h.clickAt(button.x, button.y, 'touch', true);
    const after = h.snapshot();
    assert.ok(after.stations.find(station => station.id === 'cup').upgrade.available, 'next tier is unlocked and affordable');
    for (let i = 0; i < 6; i++) h.clickAt(button.x, button.y, 'touch', true);
    assert.equal(h.snapshot().state.totalSpent, after.state.totalSpent,
      'former confirm coordinate must not repurchase: '+JSON.stringify({size:options,button,upgrades:h.snapshot().state.upgrades}));
    assert.equal(h.snapshot().state.upgrades.cup, 1);
    assert.ok(!Object.values(h.presentation().quotes).some(q=>q.stationId==='cup'&&q.level===2),'repeated old-position taps do not arm the next cup quote');
    if(h.presentation().modal)h.clickAction('close');
    h.clickAction('station:cup');
    const secondQuote=h.presentation().quotes.upgrade;assert.notEqual(secondQuote.id,firstQuote.id);assert.equal(secondQuote.level,2);
    h.clickAction(secondQuote.action);
    assert.equal(h.snapshot().state.upgrades.cup, 2, 'explicitly reviewing the next quote still permits purchase');
  }
});

test('purchase protection survives hover and interrupted drags, then restores the former area after 600ms of quiet',()=>{
  const game=new Game({now:START});game.tick(1000);const save=game.exportSave(START);save.machine=2;
  const h=browserBoot({save});h.clickAction('station:cup');
  const q=h.presentation().quotes.upgrade,button=h.point(q.action);h.clickAt(button.x,button.y,'touch');
  const spent=h.snapshot().state.totalSpent,outside=h.point('station:pop');
  assert.equal(h.actionAt(button.x,button.y),'station:ship','the former confirm point really covers another machine');
  h.event('pointermove',outside.x,outside.y,'mouse');
  h.clickAt(button.x,button.y,'touch');
  assert.equal(h.presentation().modal,null,'hovering elsewhere does not release the old purchase area');
  h.event('pointerdown',button.x,button.y,'touch');
  h.event('pointermove',outside.x,outside.y,'touch');
  h.event('pointerup',outside.x,outside.y,'touch');h.frame(0);
  assert.equal(h.presentation().modal,null,'a consumed down cannot become an unrelated action after moving out');
  h.frame(599);h.clickAt(button.x,button.y,'touch');
  assert.equal(h.presentation().modal,null,'599ms still belongs to the protected burst');
  h.frame(601);h.clickAt(button.x,button.y,'touch');
  assert.equal(h.presentation().modal.type,'station');assert.equal(h.presentation().modal.stationId,'ship','after a quiet interval the real machine can be opened normally');
  assert.equal(h.snapshot().state.totalSpent,spent,'opening the restored machine still requires a reviewed confirmation');
});

test('the scrolled logistics purchase rectangle also consumes immediate taps on the machinery beneath it',()=>{
  const game=new Game({mode:'v15',now:START});
  for(let i=0;i<50;i++){game.tick(8);for(const source of ['pop','cup']){const r=game.reserveTransfer(source);if(r.ok)game.commitTransfer(r.token);}}
  game.buyUpgrade('cup');const h=browserBoot({mode:'v15',save:game.exportSave(START),pixelRatio:2,left:11,top:17});
  h.clickAction('openLogistics');const q=h.presentation().quotes['automate-pop'];h.scroll(24);h.revealAction(q.action);
  assert.equal(h.presentation().modal.scroll,24,'the quote button uses a scrolled content coordinate');
  const button=h.point(q.action);h.clickAt(button.x,button.y,'touch');
  const after=h.snapshot();assert.equal(h.presentation().modal,null);assert.equal(after.transfers[0].automated,true);
  assert.match(h.actionAt(button.x,button.y),/^station:/,'the logistics confirm rectangle overlaps a real underlying station');
  for(let i=0;i<6;i++)h.clickAt(button.x,button.y,'touch',true);
  assert.equal(h.presentation().modal,null);assert.equal(h.snapshot().state.totalSpent,after.state.totalSpent);
  h.clickAction('openLogistics');assert.equal(h.presentation().modal.type,'logistics','an explicit different control immediately releases the protected area');
  h.purchase('automate-cup');assert.equal(h.snapshot().transfers[1].automated,true);
});

test('P0 browser bundle also rejects tap-then-tap and preserves real continuous drags and isolated saves', () => {
  for (const options of [{ width: 320, height: 524 }, { width: 390, height: 844, pixelRatio: 3, left: 12, top: 20 }, { width: 960, height: 900 }]) {
    const h = browserBoot({ ...options, experiment: 'manual-transfer-p0' });
    for (let i = 0; i < 4; i++) h.frame(1000);
    h.verifyControls();
    assert.equal(h.snapshot().state.totalSold, 0);
    h.clickAction('transfer-source-pop', 'touch', true);
    assert.equal(h.snapshot().transfer.reservedAmount, 0);
    h.clickAction('transfer-target-cup', 'touch', true);
    assert.equal(h.snapshot().state.transfer.transferredAmount,0,'prototype cannot revive the retired two-tap path');
    h.drag('transfer-source-pop','transfer-target-cup','touch');
    assert.equal(h.snapshot().state.transfer.transferredAmount, 4);
    for (let i = 0; i < 4; i++) h.frame(1000);
    assert.equal(h.snapshot().state.totalSold, 4);
    const from = h.point('transfer-source-pop'), to = h.point('transfer-target-cup');
    h.event('pointerdown', from.x, from.y, 'mouse');
    h.event('pointermove', to.x, to.y, 'mouse'); h.frame(16);
    h.event('pointerup', to.x, to.y, 'mouse'); h.frame(0);
    assert.equal(h.snapshot().state.transfer.transferredAmount, 16);
    assert.equal(h.snapshot().state.totalSpent, 0);
    for (let i = 0; i < 8; i++) h.frame(1000);
    assert.equal(h.snapshot().state.totalSold, 16);
    assert.equal(h.storage.has(KEY), false, 'formal key was never created by the prototype');
    const saved = JSON.parse(h.storage.get('little_popcorn_factory_manual_transfer_p0_v3'));
    assert.equal(saved.experiment, 'manual-transfer-p0');
    assert.equal(saved.version, 3);
  }
});
