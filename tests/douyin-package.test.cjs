'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { legacyGame } = require('./legacy-fixture.cjs');

const PACKAGE = path.resolve(__dirname, '../build/douyin');
const SAVE_KEY = 'little_popcorn_factory_v1';

// Exercise the generated entry and every real bundled module. This bounded SDK
// contract smoke test is not an IDE, an audio decoder, or a device test.
function boot({ gameGlobalOnly = false, raf = true, browserShims = false, safeTop = 47, menuApi = true, freshOnboarding = false } = {}) {
  let now = 1800000000000, frameTime = 1, pendingFrame = null, canvasCount = 0;
  let depth = 0, operations = 0, layout = null, drawnViewport = null, renderer = null;
  let transform = [1, 0, 0, 1, 0, 0], currentPath = [];
  const states = [], fills = [], events = {}, storage = new Map(), sounds = [], texts = [], textPositions = [];
  // Platform regressions use an established factory; dedicated onboarding
  // checks below leave native storage empty and exercise the genuine first run.
  if(!freshOnboarding)storage.set(SAVE_KEY,JSON.stringify(legacyGame({now}).exportSave(now)));
  const info = { windowWidth: 390, windowHeight: 844, pixelRatio: 3,
    safeArea: { left: 0, top: safeTop, right: 390, bottom: 810, width: 390, height: 810 - safeTop } };
  const menu = { left: 286, top: safeTop + 4, right: 378, bottom: safeTop + 36, width: 92, height: 32 };
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
      // Capture the real instance without changing drawing or hit testing. The
      // generated package itself must continue to expose no native diagnostics.
      const marker='let renderer = new Renderer(ctx);';
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
    }
    return module.exports;
  }
  load(path.join(PACKAGE, 'game.js'));
  const h = {
    context, events, info, menu, canvas, sounds, texts,
    saved() { return JSON.parse(storage.get(SAVE_KEY)); },
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
    taps() { return renderer.lastView.state.taps; },
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
      for(const zone of renderer.zones.filter(zone=>zone.action)) {
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

test('native first run points to real production after the health notice without a blocking lesson', () => {
  const h=boot({freshOnboarding:true,gameGlobalOnly:true});
  assert.deepEqual(h.actions(),['start']);
  h.clickText('开始经营');h.frame();
  assert.ok(h.actions().includes('tap'));
  assert.ok(!h.actions().some(action=>action.startsWith('guideContinue:')));
  for(const action of ['upgrades','order','quests','workshop','timing'])assert.ok(!h.actions().includes(action));
  assert.ok(h.actions().includes('settings'));assert.ok(h.actions().includes('guidebook'));
  h.clickAction('tap');h.frame(1000);h.events.onHide();
  assert.equal(h.saved().taps,1);
  assert.ok(h.saved().playedSeconds>0);
  assert.equal(h.saved().onboarding.practice.production,true);
  assert.deepEqual(h.saved().onboarding.seen,[],'actual practice is independent of reading help');
});

test('native package gates 100 taps per second behind the build flag and cancels held touches', async t => {
  for(const mode of [
    {name:'standard globals + native RAF'},
    {name:'GameGlobal-only + native RAF',gameGlobalOnly:true},
    {name:'GameGlobal-only + timer fallback',gameGlobalOnly:true,raf:false},
    {name:'IDE browser shims + native input',browserShims:true}
  ]) await t.test(mode.name,()=>{
    const h=boot(mode),enabled=h.context.GameGlobal.POPCORN_CONFIG.developerHoldTap;
    assert.equal(typeof enabled,'boolean','the native bundle must explicitly choose a development or release flag');
    assert.equal(h.context.__POPCORN__,undefined,'device debugging must not expose browser diagnostics');
    h.clickText('开始经营');h.frame();
    let point=h.actionPoint('tap');
    h.touch('onTouchStart',point);h.frame(0);
    assert.equal(h.taps(),1,'a production touch must act immediately');
    h.frame(349);assert.equal(h.taps(),1,'a short press must remain one tap');
    h.frame(1);assert.equal(h.taps(),1,'the 350ms threshold must not add a premature repeat');
    h.frame(9);assert.equal(h.taps(),1);
    h.frame(1);assert.equal(h.taps(),enabled?2:1,'the first repeat is due at 360ms only in a development build');
    h.frame(990);assert.equal(h.taps(),enabled?101:1,'one full second after the hold threshold must add exactly 100 taps');
    h.touch('onTouchEnd',point);h.frame(1000);
    let expected=enabled?101:1;
    assert.equal(h.taps(),expected,'lifting the original finger must stop production repeats');

    point=h.actionPoint('tap');
    h.touch('onTouchStart',point);h.frame(1350);expected+=enabled?101:1;
    assert.equal(h.taps(),expected);
    h.touch('onTouchCancel',point);h.frame(1000);
    assert.equal(h.taps(),expected,'native touchcancel must stop production repeats');

    point=h.actionPoint('tap');
    h.touch('onTouchStart',point);h.frame(1350);expected+=enabled?101:1;
    assert.equal(h.taps(),expected);
    h.events.onHide();assert.equal(h.saved().taps,expected,'backgrounding must preserve completed hold production');
    h.frame(1000);h.events.onShow({});h.frame(1000);
    assert.equal(h.taps(),expected,'returning to the foreground must not restart an old held touch');
    h.touch('onTouchEnd',point);h.frame(1000);
    assert.equal(h.taps(),expected,'a late touchend after foreground return must not add a tap');

    point=h.actionPoint('tap');
    h.touch('onTouchStart',point);h.frame(360);expected+=enabled?2:1;
    h.touch('onTouchMove',{screenX:-1,screenY:-1});
    h.touch('onTouchMove',point);h.frame(1000);
    assert.equal(h.taps(),expected,'leaving and re-entering the production area must cancel that hold permanently');
    h.touch('onTouchEnd',point);

    point=h.actionPoint('tap');
    h.touch('onTouchStart',point);h.frame(360);expected+=enabled?2:1;
    h.info.windowHeight=780;h.info.safeArea.bottom=746;
    h.events.onWindowResize({});h.frame(1000);
    assert.equal(h.taps(),expected,'native resize must cancel an in-flight hold');
    h.touch('onTouchEnd',point);

    point=h.actionPoint('tap');
    h.touch('onTouchStart',point);h.frame(60000);expected+=enabled?101:1;
    assert.equal(h.taps(),expected,'a stalled frame must catch up at most 100 repeats');
    h.frame(10);expected+=enabled?1:0;
    assert.equal(h.taps(),expected,'discarded catch-up backlog must not spill into later frames');
    h.touch('onTouchEnd',point);h.events.onHide();assert.equal(h.saved().taps,expected);
  });
});

test('generated Douyin entry: native host selection, safe-area input, audio, lifecycle and bounded scheduling', async t => {
  for (const mode of [
    { name: 'standard globals + native RAF', gameGlobalOnly: false, raf: true },
    { name: 'documented GameGlobal-only runtime + native RAF', gameGlobalOnly: true, raf: true },
    { name: 'GameGlobal-only runtime + timer fallback', gameGlobalOnly: true, raf: false },
    { name: 'IDE browser shims + native canvas without DOM methods', browserShims: true }
  ]) await t.test(mode.name, async () => {
    const h = boot(mode);
    if (!mode.browserShims) {
      assert.equal(h.context.document, undefined); assert.equal(h.context.window, undefined);
    }
    assert.equal(h.context.__POPCORN__, undefined, 'browser diagnostics must not be exposed by native packages');
    assert.equal(h.canvasCount(), 1); h.verifyLayout();
    assert.ok(h.texts.includes('小小爆米花厂'));
    assert.ok(h.texts.includes('健康游戏忠告'));
    assert.ok(!h.texts.some(text=>/^点机器/.test(text)));
    h.clickText('开始经营');h.frame();
    assert.ok(h.texts.some(text=>/^自动 \+.+ \/秒$/.test(text)),'the scene wallet must show automatic income');
    assert.ok(!h.texts.includes('健康游戏忠告'));
    assert.ok(!h.texts.includes('小小爆米花厂'),'the startup title does not consume a home row');
    assert.ok(h.texts.includes('⚙'),'settings remain directly accessible before factory unlocks');
    h.clickAction('goalExpand');h.frame();
    h.clickText('收起');h.frame();
    assert.ok(!h.texts.includes('收起'));
    h.clickText(/^下一步/);h.frame();
    assert.ok(h.texts.includes('收起'),'the native side entry can reopen the new-player goal');
    h.clickAction('tap'); h.events.onHide();
    assert.equal(h.saved().taps, 1, 'screen-space input must reach the machine production area');
    const pop = h.sounds.find(sound => sound.src === 'audio/pop.wav');
    assert.ok(pop && pop.plays === 1, 'touch must call the native audio adapter');
    assert.equal(pop.obeyMuteSwitch, true); assert.ok(pop.stops >= 2);
    const wav = fs.readFileSync(path.join(PACKAGE, pop.src));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    const operations = h.operations(); h.frame(1000);
    assert.equal(h.operations(), operations, 'background frames must not draw');
    h.events.onShow({}); h.frame(); h.frame(100);
    h.clickAction('tap'); h.events.onHide(); assert.equal(h.saved().taps, 2);
    assert.equal(pop.plays, 2, 'native effects must resume after foreground return');
    h.events.onShow({}); h.frame(); h.frame(45000); h.frame(45000);
    h.clickText('工厂'); h.frame();
    h.clickText('⚙');h.frame();
    assert.ok(h.texts.includes('工厂设置'),'relocated settings stay reachable in native safe-area coordinates');
    h.clickText('继续经营');h.frame();
    h.clickText('工厂');h.frame();
    h.clickText(/^涡轮增压(?: ·|$)/); h.frame();
    assert.ok(h.texts.includes('广告 · 开启增压'));
    h.clickText('广告 · 开启增压'); h.frame();
    assert.ok(h.texts.includes('观看广告，领取奖励'));
    assert.equal(h.texts.some(text => /模拟/.test(text)), false);
    h.clickText('观看广告，领取奖励');
    for (let i = 0; i < 6; i++) await Promise.resolve();
    h.frame();
    assert.ok(h.texts.includes('广告暂不可用，工厂仍可正常生产'));
    assert.equal(h.saved().rewardedCount, 0);
    h.clickAction('tap');h.events.onHide();assert.equal(h.saved().taps,3,'failed native ads must preserve production input');
    h.events.onShow({});h.frame();
    h.info.windowHeight = 780; h.info.safeArea.bottom = 746;
    h.events.onWindowResize({}); h.frame(); h.verifyLayout();
    h.clickAction('tap');h.events.onHide();assert.equal(h.saved().taps,4,'resized safe-area coordinates must still reach production');
  });
});

test('native scene fills the top while controls avoid device insets and the menu capsule', async t => {
  for(const scenario of [
    {name:'iPhone dynamic island',safeTop:59},
    {name:'Android with zero top inset',safeTop:0},
    {name:'older host without menu layout API',safeTop:59,menuApi:false}
  ]) await t.test(scenario.name,()=>{
    const h=boot(scenario);
    h.verifyLayout();h.verifyControls();
    h.clickText('开始经营');h.frame();h.verifyControls();h.verifySceneTop();
    h.clickAction('goalExpand');h.frame();
    h.clickText('收起');h.frame();h.verifyControls();
    h.clickText(/^下一步/);h.frame();assert.ok(h.texts.includes('收起'));
    h.clickText(/^本单 /);h.frame();h.verifyControls();
    assert.ok(h.texts.includes('主线合同')&&h.texts.includes('街角第一桶'),'the menu-clearing order entry opens the actual first tutorial contract');
    h.clickText('×');h.frame();
    h.clickText('工厂');h.frame();h.verifyControls();
    h.clickText('⚙');h.frame();assert.ok(h.texts.includes('工厂设置'));h.verifyControls();
    h.clickText('继续经营');h.frame();

    // Both callbacks must re-read insets; stale screen coordinates can look right
    // at launch yet break taps after a resize or a return from another app.
    for(const [index,event] of ['onWindowResize','onShow'].entries()) {
      if(event==='onShow')h.events.onHide();
      h.info.windowHeight=780+index*32;h.info.safeArea.bottom=h.info.windowHeight-34;
      h.info.safeArea.top=scenario.safeTop+index*6;
      h.info.safeArea.height=h.info.safeArea.bottom-h.info.safeArea.top;
      h.menu.top=h.info.safeArea.top+8+index*12;h.menu.bottom=h.menu.top+h.menu.height;
      h.events[event]({});h.frame();h.verifyLayout();h.verifyControls();h.verifySceneTop();
      h.clickText(/^本单 /);h.frame();h.verifyControls();
      assert.ok(h.texts.includes('主线合同')&&h.texts.includes('街角第一桶'),'updated menu coordinates must preserve order input');
      h.clickText('×');h.frame();h.clickAction('tap');h.events.onHide();
      assert.equal(h.saved().taps,index+1,'updated screen coordinates must preserve production input');
      h.events.onShow({});h.frame();
    }
  });
});
