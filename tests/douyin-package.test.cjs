'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');


const PACKAGE = path.resolve(__dirname, '../build/douyin');
const SAVE_KEY = 'little_popcorn_factory_pipeline_v2';

test('v15 native package routes both trays inside safe areas and pauses without offline income', () => {
  for (const size of [{ width: 320, height: 524, safeTop: 28 }, { width: 390, height: 844, safeTop: 59 }]) {
    const h = boot({ ...size, mode: 'v15' });
    assert.equal(h.snapshot().mode, 'v15'); h.verifyLayout(); h.verifyControls();
    for (let i = 0; i < 3; i++) h.frame(1000);
    h.clickAction('transfer-source-pop'); h.frame(0); h.clickAction('transfer-target-cup'); h.frame(0);
    for (let i = 0; i < 3; i++) h.frame(1000);
    assert.equal(h.snapshot().state.totalSold, 0);
    h.clickAction('transfer-source-cup'); h.frame(0); h.clickAction('transfer-target-ship'); h.frame(0);
    for (let i = 0; i < 2; i++) h.frame(1000);
    assert.equal(h.snapshot().state.totalSold, 4);
    for (const action of ['station:cup', 'openLogistics', 'settings']) {
      h.clickAction(action); h.frame(0); h.verifyControls();
      if (action.startsWith('station:')) { h.clickAction('collapseStation'); h.frame(0); }
      h.clickAction('close'); h.frame(0);
    }
    h.events.onHide(); const before = h.saved(); h.frame(3600000); h.events.onShow({}); h.frame(0);
    assert.equal(h.snapshot().state.totalSold, before.totalSold);
    assert.equal(h.saved().version, 4);
  }
});

// Exercise the generated entry and every real bundled module. This bounded SDK
// contract smoke test is not an IDE, an audio decoder, or a device test.
function boot({ gameGlobalOnly = false, raf = true, browserShims = false, safeTop = 47, menuApi = true, width = 390, height = 844, mode = 'baseline' } = {}) {
  let now = 1800000000000, frameTime = 1, pendingFrame = null, canvasCount = 0;
  let depth = 0, operations = 0, layout = null, drawnViewport = null, renderer = null;
  let transform = [1, 0, 0, 1, 0, 0], currentPath = [];
  const states = [], fills = [], events = {}, storage = new Map(), sounds = [], texts = [], textPositions = [];
  // Leave native storage empty to exercise the genuine v2 first run.
  const info = { windowWidth: width, windowHeight: height, pixelRatio: 3,
    safeArea: { left: 0, top: safeTop, right: width, bottom: height - 34, width, height: height - 34 - safeTop } };
  const menu = { left: width - 104, top: safeTop + 4, right: width - 12, bottom: safeTop + 36, width: 92, height: 32 };
  const point = (x, y) => {
    const [a, b, c, d, e, f] = transform, dpr = Math.min(2, info.pixelRatio);
    return { x: (a*x+c*y+e)/dpr, y: (b*x+d*y+f)/dpr };
  };
  const bounds = points => ({ left: Math.min(...points.map(p=>p.x)), top: Math.min(...points.map(p=>p.y)),
    right: Math.max(...points.map(p=>p.x)), bottom: Math.max(...points.map(p=>p.y)) });
  const rectangle = (x, y, w, h) => bounds([point(x,y),point(x+w,y),point(x+w,y+h),point(x,y+h)]);
  const ctx = {
    save() { depth++; states.push({ transform: [...transform], font: this.font, textAlign: this.textAlign, fillStyle: this.fillStyle }); },
    restore() { assert.ok(depth > 0); depth--; const state=states.pop();transform=state.transform;this.font=state.font;this.textAlign=state.textAlign;this.fillStyle=state.fillStyle; },
    measureText(value) { const size=Number((this.font.match(/([\d.]+)px/)||[0,14])[1]);return { width: [...String(value)].reduce((sum,c)=>sum+size*(c.charCodeAt(0)>127?1:.55),0) }; },
    fillText(value, x, y) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y)); texts.push(String(value)); operations++;
      const width=this.measureText(value).width, size=Number((this.font.match(/([\d.]+)px/)||[0,14])[1]);
      const left=x-(this.textAlign==='center'?width/2:this.textAlign==='right'?width:0);
      textPositions.push({text:String(value),...point(left+width/2,y),...rectangle(left,y-size/2,width,size)});
    },
    setTransform(...values) {
      assert.ok(values.every(Number.isFinite));
      layout = values; transform = [...values];
    },
    translate(x,y) { assert.ok([x,y].every(Number.isFinite));const [a,b,c,d,e,f]=transform;transform=[a,b,c,d,a*x+c*y+e,b*x+d*y+f];operations++; },
    scale(x,y) { assert.ok([x,y].every(Number.isFinite));const [a,b,c,d,e,f]=transform;transform=[a*x,b*x,c*y,d*y,e,f];operations++; },
    rotate(angle) { assert.ok(Number.isFinite(angle));const [a,b,c,d,e,f]=transform,cs=Math.cos(angle),sn=Math.sin(angle);transform=[a*cs+c*sn,b*cs+d*sn,c*cs-a*sn,d*cs-b*sn,e,f];operations++; },
    beginPath() { currentPath=[]; }, closePath() {},
    fill() { if(currentPath.length)fills.push(bounds(currentPath)); }, stroke() {}, clip() {}
  };
  for (const name of ['moveTo', 'lineTo', 'arcTo']) {
    ctx[name] = (...args) => { assert.ok(args.every(Number.isFinite), name);currentPath.push(point(args[0],args[1]));if(name==='arcTo')currentPath.push(point(args[2],args[3]));operations++; };
  }
  ctx.fillRect=(x,y,width,height)=>{assert.ok([x,y,width,height].every(Number.isFinite));fills.push(rectangle(x,y,width,height));operations++;};
  ctx.clearRect=(x,y,width,height)=>{assert.ok([x,y,width,height].every(Number.isFinite));drawnViewport={width,height,...rectangle(x,y,width,height)};operations++;};
  ctx.arc = (x, y, r, start, end) => {
    assert.ok([x, y, r, start, end].every(Number.isFinite)); assert.ok(r >= 0); operations++;
  };
  ctx.rect = (x,y,w,h) => { assert.ok([x,y,w,h].every(Number.isFinite)); operations++; };
  const canvas = { getContext(type) { assert.equal(type, '2d'); return ctx; } };
  const tt = {
    createCanvas() { canvasCount++; return canvas; },
    getSystemInfoSync() { return info; },
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    createInnerAudioContext() {
      const audio = { plays: 0, stops: 0, onError(fn) { this.errorHandler = fn; },
        stop() { this.stops++; }, play() { this.plays++; } };
      sounds.push(audio); return audio;
    },
    createRewardedVideoAd() { throw new Error('Unconfigured native package must not request ads'); },
    createInterstitialAd() { throw new Error('Unconfigured native package must not request ads'); },
    vibrateShort() {}
  };
  if(menuApi)tt.getMenuButtonLayout=()=>menu;
  for (const name of ['onTouchStart', 'onTouchMove', 'onTouchEnd', 'onTouchCancel', 'onHide', 'onShow', 'onWindowResize']) {
    tt[name] = fn => { assert.equal(events[name], undefined); events[name] = fn; };
  }
  function schedule(fn) {
    assert.equal(pendingFrame, null, 'exactly one animation frame may be pending');
    pendingFrame = fn; return 1;
  }
  const context = vm.createContext({ tt,
    __captureRenderer(value) { renderer=value; },
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay) { assert.equal(raf, false, 'native RAF must be used when available'); assert.ok(delay > 0 && delay < 100); return schedule(() => fn()); },
    clearTimeout() {}
  });
  context.GameGlobal = vm.runInContext('this', context);
  if (browserShims) {
    // IDE 4.5.5 exposes browser globals beside tt, while its native canvas is
    // not a DOM element. Browser-only accessibility and input must stay off.
    context.document = { getElementById() { throw new Error('Native entry must not use the DOM'); } };
    context.window = { addEventListener() { throw new Error('Native entry must use tt input'); } };
  }
  if (raf) context.requestAnimationFrame = schedule;
  if (gameGlobalOnly) context.globalThis = undefined;
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    assert.ok(filename.startsWith(PACKAGE + path.sep), 'dependency must remain inside package');
    const module = { exports: {} }; cache.set(filename, module);
    let source = fs.readFileSync(filename, 'utf8');
    if(filename===path.join(PACKAGE,'game.bundle.js')) {
      // Capture only the real renderer instance; drawing and hit testing stay unchanged.
      const marker='let renderer = new Renderer(ctx, art);';
      assert.equal(source.split(marker).length,2);
      source=source.replace(marker,marker+'\n__captureRenderer(renderer);');
    }
    const run = vm.runInContext('(function(require,module,exports){\n' + source + '\n})', context, { filename });
    run(request => {
      assert.match(request, /^\.\//);
      return load(path.resolve(path.dirname(filename), request));
    }, module, module.exports);
    if (filename === path.join(PACKAGE, 'config.js')) {
      // Keep this in-memory SDK scenario independent of local account IDs.
      // The actual production simulation flag must already be disabled.
      const config = context.GameGlobal.POPCORN_CONFIG;
      assert.equal(config.allowSimulatedAds, false);
      config.appId = ''; config.rewardAdUnitId = ''; config.interstitialAdUnitId = '';
      config.mode = mode;
    }
    return module.exports;
  }
  load(path.join(PACKAGE, 'game.js'));
  const h = {
    context, events, info, menu, canvas, sounds, texts, storage,
    saved() { return JSON.parse(storage.get(mode === 'baseline' ? SAVE_KEY : 'little_popcorn_factory_automation_v4')); },
    frame(ms = 16) {
      now += ms; frameTime += ms; texts.length = 0; textPositions.length=0; fills.length=0;
      const fn = pendingFrame; pendingFrame = null;
      assert.equal(typeof fn, 'function'); fn(frameTime);
      assert.equal(depth, 0, 'Canvas transform stack must remain balanced');
      assert.equal(typeof pendingFrame, 'function');
    },
    click(x, y) {
      // fillText positions already include every Canvas transform and are CSS pixels.
      const point = { identifier: 4, screenX: x, screenY: y };
      events.onTouchStart({ touches: [point], changedTouches: [point] });
      events.onTouchEnd({ touches: [], changedTouches: [point] });
    },
    textPoint(label) {
      const matches=textPositions.filter(entry=>typeof label==='string'?entry.text===label:label.test(entry.text));
      assert.ok(matches.length,'visible native control not found: '+label);
      const entry=matches[matches.length-1];return {screenX:entry.x,screenY:entry.y};
    },
    actionPoint(action) {
      // Production feedback temporarily replaces its label. Use the real visible
      // hit zones and verify the winning hit-test action, including overlays.
      for(const zone of [...renderer.zones].reverse()) {
        const x=zone.x+zone.w/2,y=zone.y+zone.h/2;
        if(zone.action===action&&renderer.actionAt(x,y)===action)
          return {screenX:x+layout[4]/layout[0],screenY:y+layout[5]/layout[3]};
      }
      assert.fail('visible native action not found: '+action);
    },
    clickAction(action) {
      // Text can also appear in non-interactive teaching copy. Tap the actual
      // rendered hit zone in screen coordinates, retaining native input routing.
      const point=this.actionPoint(action);this.click(point.screenX,point.screenY);
    },
    touch(type, point, identifier=4) {
      const contact={identifier,...point};
      events[type]({touches:type==='onTouchEnd'||type==='onTouchCancel'?[]:[contact],changedTouches:[contact]});
    },
    snapshot() { return JSON.parse(JSON.stringify(context.GameGlobal.__POPCORN__.snapshot())); },
    actions() { return Array.from(renderer.zones,zone=>zone.action).filter(Boolean); },
    clickText(label) {
      const point=this.textPoint(label);this.click(point.screenX,point.screenY);
    },
    verifyLayout() {
      const dpr = Math.min(2, info.pixelRatio);
      assert.equal(canvas.width, info.windowWidth * dpr);
      assert.equal(canvas.height, info.windowHeight * dpr);
      assert.equal(layout[0],dpr,'responsive controls must retain CSS-pixel sizing');
      assert.equal(layout[3],dpr,'portrait content must not be globally shrunk');
      assert.ok(drawnViewport&&drawnViewport.width>0&&drawnViewport.height>0);
      assert.ok(layout[4] / dpr >= info.safeArea.left);
      assert.equal(layout[5],0,'native safe top must not shift the entire scene down');
      assert.equal(drawnViewport.top,0,'the viewport must start at the screen top');
      assert.equal(drawnViewport.height,info.safeArea.bottom-6,'only the bottom inset reduces the scene viewport');
      assert.ok((layout[4] + drawnViewport.width * layout[0]) / dpr <= info.safeArea.right + 1e-8);
      assert.ok((layout[5] + drawnViewport.height * layout[3]) / dpr <= info.safeArea.bottom + 1e-8);
    },
    verifyControls() {
      const capsule = menuApi ? menu : {left:info.windowWidth-130,right:info.windowWidth,top:info.safeArea.top,bottom:info.safeArea.top+40};
      const intersects = rect => rect.left<capsule.right && rect.right>capsule.left && rect.top<capsule.bottom && rect.bottom>capsule.top;
      for(const entry of textPositions) {
        assert.ok(entry.top>=info.safeArea.top-1e-8,'text must clear the status area: '+entry.text);
        assert.ok(!intersects(entry),'text must clear the native menu: '+entry.text);
      }
      for(const zone of renderer.zones.filter(zone=>zone.action && zone.action !== 'noop' && !(zone.x===0 && zone.y===0 && zone.w===info.windowWidth))) {
        assert.ok(zone.w>=44&&zone.h>=44,'native controls retain a 44px minimum touch target: '+zone.action);
        assert.ok(zone.x>=info.safeArea.left&&zone.x+zone.w<=info.safeArea.right,'control stays horizontally visible: '+zone.action);
        assert.ok(zone.y+zone.h<=info.safeArea.bottom-6,'control clears the bottom safe area: '+zone.action);
        assert.ok(zone.y>=info.safeArea.top,'control must clear the status area: '+zone.action);
        assert.ok(!intersects({left:zone.x,right:zone.x+zone.w,top:zone.y,bottom:zone.y+zone.h}),'control must clear the native menu: '+zone.action);
      }
    },
    verifySceneTop() {
      assert.ok(fills.some(rect=>rect.left>0 && rect.left<30 && rect.right>info.windowWidth-30 && rect.top<=0 && rect.bottom>info.windowHeight/2),
        'the production scene background must extend behind the top safe area');
    },
    operations: () => operations,
    canvasCount: () => canvasCount
  };
  h.frame(); return h;
}

test('generated Douyin entry automatically runs the real pipeline without DOM or ads', async t => {
  for (const mode of [
    { name: 'native RAF' },
    { name: 'GameGlobal-only RAF', gameGlobalOnly: true },
    { name: 'GameGlobal-only timer fallback', gameGlobalOnly: true, raf: false },
    { name: 'IDE browser shims and native canvas', browserShims: true }
  ]) await t.test(mode.name, () => {
    const h = boot(mode);
    assert.equal(h.canvasCount(), 1);
    assert.equal(h.context.GameGlobal.__POPCORN__.version, '0.1.0');
    assert.deepEqual(Object.keys(h.context.GameGlobal.__POPCORN__).sort(), ['analytics','presentation','snapshot','version']);
    assert.equal(h.context.GameGlobal.POPCORN_CONFIG.developerHoldTap, false);
    assert.equal(h.context.GameGlobal.POPCORN_CONFIG.allowSimulatedAds, false);
    h.verifyLayout();
    for (const action of ['station:pop','station:cup','station:ship','settings']) assert.ok(h.actions().includes(action));
    assert.ok(!h.actions().some(action => /^(start|tap|ad|order|quest|brand|guidebook|offline)/.test(action)));
    assert.ok(!h.texts.some(text => /重构|旧存档/.test(text)), 'migration details are absent from the first factory scene');
    h.clickAction('settings'); h.frame(0);
    assert.ok(h.texts.some(text => /玩法已重构/.test(text)), 'version context remains available in settings');
    assert.ok(h.texts.some(text => /旧存档保留/.test(text)), 'legacy save policy remains available in settings');
    h.clickAction('close'); h.frame(0);
    for (let i = 0; i < 20; i++) h.frame(1000);
    assert.ok(h.snapshot().state.totalSold > 0, 'production and final dispatch happen without any tap');
    const before = h.snapshot();
    h.clickAction('station:cup'); h.frame(0);
    assert.ok(h.actions().includes('upgrade:cup:1'));
    assert.ok(h.actions().includes('station:pop'), 'compact controls keep other stations selectable');
    h.verifyControls();
    h.clickAction('upgrade:cup:1'); h.frame(0);
    const after = h.snapshot();
    assert.ok(after.state.coins < before.state.coins, 'real native input pays for the selected station');
    assert.ok(after.stations.find(station => station.id === 'cup').capacity > before.stations.find(station => station.id === 'cup').capacity);
    assert.equal(after.state.totalSpent-before.state.totalSpent,30);
    assert.equal(after.state.coins,before.state.coins-30);
    assert.equal(after.throughput,before.throughput,'the forecast does not replace measured dispatch');
    assert.ok(h.actions().includes('reviewUpgrade'),'purchase preserves selection in the collapsed controls');
    assert.ok(!h.actions().some(action=>action.startsWith('upgrade:')),'next quote is not armed automatically');
    h.verifyControls();
    const sound = h.sounds.find(audio => audio.src === 'audio/upgrade.wav');
    assert.ok(sound && sound.plays > 0, 'upgrade reuses the native sound adapter');
    assert.equal(sound.obeyMuteSwitch, true);
    const wav = fs.readFileSync(path.join(PACKAGE, sound.src));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    const shipmentSound=h.sounds.find(audio=>audio.src==='audio/click.wav'&&audio.volume===.12);
    assert.ok(shipmentSound&&shipmentSound.plays>0,'real shipments use the quiet bundled sound');
    assert.ok(shipmentSound.plays<=Math.ceil(20/.65),'native shipment sound is grouped and limited');
    assert.equal(after.state.totalProduced,after.state.totalSold+after.state.buffers.pop+after.state.buffers.cup
      +Object.values(after.state.stations).reduce((n,station)=>n+station.jobs.reduce((sum,job)=>sum+(job?job.amount:0),0),0));
    h.events.onHide();
    const saved = h.saved(), operationCount = h.operations();
    h.frame(3600000);
    assert.equal(h.operations(), operationCount, 'hidden frames do not paint');
    assert.deepEqual(h.saved(), saved);
    h.events.onShow({}); h.frame(0);
    assert.equal(h.snapshot().state.totalSold, saved.totalSold, 'no offline shipping or income on return');
    h.frame(1000);
    assert.ok(h.snapshot().state.totalSold >= saved.totalSold);
    h.info.windowHeight = 780; h.info.safeArea.bottom = 746;
    h.events.onWindowResize({}); h.frame(0); h.verifyLayout();
    h.clickAction('settings'); h.frame(0);
    assert.ok(h.actions().includes('setting:sound'));
    h.clickAction('setting:sound'); h.frame(0);
    h.events.onHide(); assert.equal(h.saved().settings.sound, false);
  });
});

test('native controls avoid device status insets and menu capsule after resize and resume', async t => {
  for (const scenario of [
    { name: 'dynamic island', safeTop: 59 },
    { name: 'Android zero top inset', safeTop: 0 },
    { name: 'no menu API', safeTop: 59, menuApi: false },
    { name: 'small native viewport and capsule', width: 320, height: 524, safeTop: 28 }
  ]) await t.test(scenario.name, () => {
    const h = boot(scenario);
    h.verifyLayout(); h.verifyControls();
    for (const action of ['station:pop','station:cup','station:ship','settings']) {
      h.clickAction(action); h.frame(0); h.verifyControls();
      if(action.startsWith('station:')) { h.clickAction('collapseStation'); h.frame(0); h.verifyControls(); }
      h.clickAction('close'); h.frame(0);
    }
    for (const event of ['onWindowResize', 'onShow']) {
      if (event === 'onShow') h.events.onHide();
      h.info.windowHeight = 780; h.info.safeArea.bottom = 746;
      h.info.safeArea.top = scenario.safeTop + 6;
      h.menu.top = h.info.safeArea.top + 8; h.menu.bottom = h.menu.top + h.menu.height;
      h.events[event]({}); h.frame(0); h.verifyLayout(); h.verifyControls();
      h.clickAction('station:cup'); h.frame(0); h.verifyControls();
      h.clickAction('collapseStation'); h.frame(0); h.verifyControls();
      h.clickAction('close'); h.frame(0);
    }
  });
});
