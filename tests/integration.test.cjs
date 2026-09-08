'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { Game, CONFIG } = require('../src/core');
const { GameInterface } = require('../src/interface');

const START = 1800000000000;
const coreSource = fs.readFileSync(path.join(__dirname, '../src/core.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

function saved(overrides = {}) {
  return Object.assign(new Game({ now: START }).exportSave(START), overrides);
}

// Run the actual application and economy together. Only the environment-facing
// platform, sounds and drawing are replaced, so tests drive real input handlers.
function harness(options = {}) {
  let now = START, frameTime = 1, nextFrame = null, drawnUI = null;
  let pointerHandler, hideHandler, showHandler, hidden = false, hitAction = null;
  let saveFailure = !!options.saveFailure;
  const keyboard = {}, saves = [], analytics = [], rewardRequests = [], sounds = [], sidebarRequests=[];
  const ctx = { setTransform() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const canvas = { getContext: () => ctx, setAttribute() {} };
  const platform = {
    canvas, isDouyin: false, config: { allowSimulatedAds: true },
    lastStorageError: '',
    load() { this.lastStorageError = options.loadError || ''; return options.save == null ? null : copy(options.save); },
    save(value) {
      this.lastStorageError = saveFailure ? 'storage full' : '';
      if (!saveFailure) saves.push(copy(value));
      return !saveFailure;
    },
    onPointer(fn) { pointerHandler = fn; }, onHide(fn) { hideHandler = fn; },
    onShow(fn) { showHandler = fn; }, onResize() {},
    getSystemInfo: () => ({ width: 480, height: 920, pixelRatio: 1 }),
    track(event, data) { analytics.push({ event, data: copy(data || {}) }); },
    getAnalytics: () => copy(analytics), vibrate() {},
    reward(kind, requestOptions) {
      return new Promise((resolve, reject) => rewardRequests.push({ kind, options: requestOptions, resolve, reject }));
    },
    interstitial: () => Promise.resolve(false),
    getSidebarState:()=>({supported:!!options.sidebarSupported,checking:false,fromSidebar:false}),
    checkSidebar:()=>Promise.resolve(),
    navigateSidebar() { return new Promise(resolve=>sidebarRequests.push(resolve)); }
  };
  class MockRenderer {
    constructor() { this.interface = new GameInterface(this); }
    actionAt() { return hitAction; }
    emit() {}
    draw(view, ui, dt) { drawnUI = copy(ui); drawnUI.animationDt = dt; }
  }
  class MockAudio {
    setEnabled(enabled) { this.enabled = enabled; }
    unlock() {}
    play(name) { sounds.push(name); }
  }
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    document: { getElementById: () => null },
    window: { addEventListener(name, fn) { keyboard[name] = fn; } },
    requestAnimationFrame(fn) {
      assert.equal(nextFrame, null, 'only one animation frame should be scheduled');
      nextFrame = fn;
    }
  });
  const coreModule = { exports: {} };
  vm.runInContext('(function(module, exports) {\n' + coreSource + '\n})', context)(coreModule, coreModule.exports);
  function mockedRequire(name) {
    if (name === './core') return coreModule.exports;
    if (name === './platform') return { createPlatform: () => platform };
    if (name === './audio') return { AudioEngine: MockAudio };
    if (name === './renderer') return { Renderer: MockRenderer };
    if (name === './experience') return require('../src/experience');
    if (name === './offline-summary') return require('../src/offline-summary');
    if (name === './next-step') return require('../src/next-step');
    throw new Error('Unexpected dependency: ' + name);
  }
  vm.runInContext('(function(require) {\n' + mainSource + '\n})', context)(mockedRequire);
  const h = {
    platform, saves, analytics, rewardRequests, sounds, sidebarRequests,
    snapshot: () => copy(context.__POPCORN__.snapshot()),
    lastUI: () => copy(drawnUI),
    ui() { h.frame(0); return copy(drawnUI); },
    frame(ms) {
      now += ms; frameTime += ms;
      const fn = nextFrame; nextFrame = null;
      assert.equal(typeof fn, 'function'); fn(frameTime);
    },
    advance(ms) { now += ms; frameTime += ms; },
    hide() { if (!hidden) { hidden = true; hideHandler(); } },
    show() { if (hidden) { hidden = false; showHandler(); } },
    click(action) {
      hitAction = action;
      pointerHandler({ type: 'down', id: 1, x: 100, y: 100 });
      pointerHandler({ type: 'up', id: 1, x: 100, y: 100 });
      hitAction = null;
    },
    key(code, repeat = false) {
      const event = { code, repeat, prevented: false, preventDefault() { this.prevented = true; } };
      keyboard.keydown(event); return event;
    },
    setSaveFailure(value) { saveFailure = value; }
  };
  h.frame(0);
  if(options.autoStart!==false){h.click('start');h.frame(0);}
  return h;
}

async function flush() { for (let i = 0; i < 6; i++) await Promise.resolve(); }

function growthSave(overrides={}) {
  const game=new Game({now:START});
  Object.assign(game.state,{machine:4,orderIndex:14,totalProduced:64000000,coins:1e10,taps:20,bursts:1,energy:85,
    playedSeconds:120,upgrades:{tap:24,auto:24,value:24},learning:{heatRecoveryUses:10,heatRecoveryDismissed:false}},overrides);
  for(let i=0;i<4;i++){
    const ready=game.getView().quests.chapters.flatMap(c=>c.quests).filter(q=>q.ready);
    if(!ready.length)break;
    game.state.claimedQuests.push(...ready.map(q=>q.id));
  }
  return game.exportSave(START);
}

test('main: craft quotes require their panel and a replay cannot buy the next level',()=>{
  const h=harness({save:growthSave({orderIndex:16,totalProduced:220000000,coins:1e12})});
  const item=h.snapshot().refinements.options[0],action='refinement:'+item.key+':'+item.level+':'+item.cost;
  const before=h.snapshot().state.coins;
  h.click(action);assert.equal(h.snapshot().state.coins,before);
  h.click('upgrades');h.click('refinements');assert.equal(h.ui().modal.type,'refinements');
  h.click(action);assert.equal(h.snapshot().state.refinements.yield,1);assert.equal(h.snapshot().state.coins,before-item.cost);
  h.click(action);assert.equal(h.snapshot().state.refinements.yield,1);assert.equal(h.snapshot().state.coins,before-item.cost);
  const restored=harness({save:h.saves.at(-1)});assert.equal(restored.snapshot().state.refinements.yield,1);
});

test('main: mode advice never changes production on open, and folding it restores upgrade guidance',()=>{
  const save=growthSave({machine:2,orderIndex:10,totalProduced:847526.7689210637,coins:19440801.157558426,upgrades:{tap:16,auto:17,value:17}});
  const h=harness({save}),{selectNextStep}=require('../src/next-step'),{selectCurrentTarget}=require('../src/experience');
  const step=()=>selectNextStep(h.snapshot(),selectCurrentTarget(h.snapshot(),h.ui()),h.ui());
  assert.equal(step().kind,'mode');const id=step().id;
  h.click('goalExpand');h.click('goalCollapse');assert.equal(h.ui().dismissedModeSuggestion,id);assert.equal(step().kind,'upgrade');
  const other=harness({save});const advice=selectNextStep(other.snapshot(),selectCurrentTarget(other.snapshot(),other.ui()),other.ui());
  other.click(advice.action);assert.equal(other.ui().modal.type,'productionModes');assert.equal(other.snapshot().state.productionMode,'balanced');
  other.click('productionMode:'+advice.modeId);assert.equal(other.snapshot().state.productionMode,advice.modeId);
});

test('main: residual heat practice completes after ten uses and a skipped lesson stays skipped on reload',()=>{
  const save=growthSave({machine:3,orderIndex:10,totalProduced:3000000,energy:92,learning:{heatRecoveryUses:0,heatRecoveryDismissed:false}});
  const h=harness({save});h.click('heatLesson');h.click('practiceHeat');h.click('timing');h.frame(8000);
  assert.equal(h.snapshot().state.heatRecoveryTaps,10);
  for(let i=0;i<10;i++)h.click('tap');
  assert.equal(h.snapshot().state.learning.heatRecoveryUses,10);
  assert.notEqual(require('../src/experience').selectCurrentTarget(h.snapshot(),h.ui()).source,'learning');
  const skipped=harness({save});skipped.click('heatLesson');skipped.click('skipHeatLesson');
  assert.equal(skipped.snapshot().state.learning.heatRecoveryDismissed,true);
  const restored=harness({save:skipped.saves.at(-1)});assert.equal(restored.snapshot().state.learning.heatRecoveryDismissed,true);
  assert.equal(restored.snapshot().state.heatRecoveryTaps,0,'skipping never grants charges');
});

test('main: timing cue sounds once per pot and remains quiet behind a sheet',()=>{
  const h=harness({save:growthSave({energy:90})});
  h.click('upgrades');h.frame(2000);assert.equal(h.sounds.filter(s=>s==='heatReady').length,0);
  h.click('close');h.frame(0);h.frame(1000);assert.equal(h.sounds.filter(s=>s==='heatReady').length,1);
  h.frame(6000);h.frame(60000);h.frame(33000);assert.equal(h.sounds.filter(s=>s==='heatReady').length,2);
});
function readyOrderSave() { return saved({ coins: 10, totalProduced: CONFIG.orders[0].target, playedSeconds: CONFIG.rewardUnlockSeconds }); }

test('main: an immediate perfect burst replaces its timing acknowledgement',()=>{
  const h=harness({save:growthSave({energy:96})});
  h.click('timing');assert.equal(h.ui().toastKind,'timing');
  h.click('tap');h.click('tap');
  assert.equal(h.snapshot().state.bursts,2);
  assert.equal(h.ui().toast,'','actual burst settlement is no longer covered by timing copy');
});

test('main: staged delivery requires its order panel and persists a single advance payment',()=>{
  const h=harness({save:growthSave({machine:2,orderIndex:10,totalProduced:4000000,coins:1e8})});
  const before=h.snapshot(),stage=before.deliveries.stages[0],action='delivery:10:1';
  h.click(action);assert.equal(h.snapshot().state.coins,before.state.coins);
  h.click('order');h.click(action);
  assert.equal(h.snapshot().state.coins,before.state.coins+stage.coins);
  assert.equal(h.snapshot().order.reward,before.order.reward-stage.coins);
  h.click(action);assert.equal(h.snapshot().state.coins,before.state.coins+stage.coins);
  const restored=harness({save:h.saves.at(-1)});
  assert.deepEqual(restored.snapshot().state.deliveries.claimed,[1]);
  assert.equal(restored.snapshot().order.reward,before.order.reward-stage.coins);
});

test('main: commission selection captures the offer, returns to production and settles once',()=>{
  const h=harness({save:growthSave()}),option=h.snapshot().commissions.options.find(item=>item.kind==='bulk');
  const accept='commissionAccept:bulk:'+option.id;
  h.click(accept);assert.equal(h.snapshot().commissions.active,null);
  h.click('commissions');assert.equal(h.ui().modal.commissionQuotes.bulk.id,option.id);
  h.click(accept);assert.equal(h.ui().modal,null);
  assert.equal(h.snapshot().commissions.active.id,option.id);
  h.click(accept);assert.equal(h.snapshot().commissions.active.id,option.id);
  h.frame(60000);h.frame(15000);
  assert.equal(h.snapshot().commissions.active.ready,true);
  const before=h.snapshot().state.coins;
  h.click('commissionClaim:'+option.id);assert.equal(h.snapshot().state.coins,before);
  h.click('commissions');h.click('commissionClaim:'+option.id);
  assert.equal(h.snapshot().state.coins,before+option.reward);
  assert.equal(h.snapshot().commissions.active,null);
  h.click('commissionClaim:'+option.id);assert.equal(h.snapshot().state.coins,before+option.reward);
  const restored=harness({save:h.saves.at(-1)});
  assert.equal(restored.snapshot().commissions.remaining,2);
});

test('main: artisan commission counts actual perfect pots and consumed recovery across normal actions',()=>{
  const h=harness({save:growthSave({machine:3,orderIndex:10,totalProduced:3000000,energy:96})});
  h.click('commissions');const quote=h.ui().modal.commissionQuotes.artisan;
  h.click('commissionAccept:artisan:'+quote.id);h.click('timing');h.click('tap');h.click('tap');
  assert.equal(h.snapshot().commissions.active.perfect,1);
  for(let i=0;i<10;i++)h.click('tap');
  assert.equal(h.snapshot().commissions.active.recovery,10);
  h.frame(60000);h.frame(2000);h.click('timing');h.frame(8000);
  assert.equal(h.snapshot().commissions.active.ready,true);
  h.click('commissions');const coins=h.snapshot().state.coins;
  h.click('commissionClaim:'+quote.id);assert.equal(h.snapshot().state.coins,coins+quote.reward);
});

test('main: souvenirs require the collection panel, charge once and survive restart',()=>{
  const h=harness({save:growthSave({machine:5,orderIndex:20,loopIndex:3,totalProduced:5e9,coins:2e12})});
  const item=h.snapshot().souvenirs.options[0],before=h.snapshot().state.coins;
  h.click('souvenir:'+item.key);assert.equal(h.snapshot().state.coins,before);
  h.click('souvenirs');h.click('souvenir:'+item.key);
  assert.equal(h.snapshot().state.coins,before-item.cost);
  assert.deepEqual(h.snapshot().state.souvenirs,[item.key]);
  h.click('souvenir:'+item.key);assert.equal(h.snapshot().state.coins,before-item.cost);
  const restored=harness({save:h.saves.at(-1)});
  assert.deepEqual(restored.snapshot().state.souvenirs,[item.key]);
});
function beginOrderAd(h) { h.click('ad:order'); h.click('watch'); assert.equal(h.rewardRequests.length, 1); }
function near(actual, expected, message) { assert.ok(Math.abs(actual - expected) < 1e-8, message || `${actual} should equal ${expected}`); }

test('main: cold-start notice blocks production, navigation, shortcuts and ads until deliberate start',()=>{
  const h=harness({autoStart:false,save:readyOrderSave(),sidebarSupported:true});
  const before=h.snapshot();
  for(const action of ['tap','upgrade:tap','claimOrder','ad:order','watch','visitSidebar','close'])h.click(action);
  h.key('Space');h.key('Escape');h.frame(60000);
  assert.equal(h.ui().startup,true);
  assert.equal(h.snapshot().state.coins,before.state.coins);
  assert.equal(h.snapshot().state.playedSeconds,before.state.playedSeconds);
  assert.equal(h.rewardRequests.length,0);assert.equal(h.sidebarRequests.length,0);
  h.key('Enter');h.frame(0);h.key('Space');
  assert.equal(h.ui().startup,false);
  assert.equal(h.snapshot().state.taps,before.state.taps+1);
});

test('main: notice preserves pending offline rewards and does not reappear on ordinary resume',()=>{
  const h=harness({autoStart:false,save:saved({offline:{id:'offline:notice',seconds:600,production:240,coins:300}})});
  assert.equal(h.ui().modal.type,'offline');h.click('claimOffline');
  assert.equal(h.snapshot().state.coins,0);
  h.click('start');assert.equal(h.ui().modal.type,'offline');h.click('claimOffline');
  assert.equal(h.snapshot().state.coins,300);h.hide();h.advance(1000);h.show();
  assert.equal(h.ui().startup,false);
  assert.equal(h.snapshot().state.coins,300);
});

test('main: sidebar navigation is user-triggered, single-flight and never grants a reward',async()=>{
  const h=harness({sidebarSupported:true});
  h.click('sidebar');assert.equal(h.sidebarRequests.length,0);
  const coins=h.snapshot().state.coins;
  h.click('visitSidebar');h.click('visitSidebar');
  assert.equal(h.sidebarRequests.length,1);assert.equal(h.ui().sidebarBusy,true);
  h.sidebarRequests[0]({ok:false,reason:'failed'});await flush();
  assert.equal(h.ui().sidebarBusy,false);assert.match(h.ui().toast,/无法打开侧边栏/);
  assert.equal(h.snapshot().state.coins,coins);
  h.click('close');h.click('tap');assert.equal(h.snapshot().state.taps,1);
});

test('main: storage save failures warn without stopping play, and later saves can recover', () => {
  const h = harness({ saveFailure: true });
  assert.equal(h.ui().saved, false);
  assert.match(h.ui().toast, /进度暂未保存/);
  h.key('Space');
  assert.equal(h.snapshot().state.coins, 1);
  h.setSaveFailure(false); h.click('close');
  assert.equal(h.ui().saved, true);
  assert.equal(h.saves.at(-1).coins, 1);
  h.setSaveFailure(true); h.click('close');
  assert.match(h.ui().toast, /进度暂未保存/);
});

test('main: corrupt platform load and incompatible game saves show a readable recovery message', async t => {
  await t.test('platform parser/storage error', () => {
    const h = harness({ loadError: 'Unexpected token in JSON' });
    assert.match(h.ui().toast, /存档读取失败/);
    assert.equal(h.snapshot().state.coins, 0);
    assert.equal(h.saves.at(-1).version, 1);
    h.frame(4000); h.hide(); h.advance(1000); h.show();
    assert.equal(h.ui().toast, '', 'an old startup error should not be shown on every resume');
  });
  await t.test('unsupported save version', () => {
    const h = harness({ save: { version: 999, coins: 999999 } });
    assert.match(h.ui().toast, /存档版本不兼容/);
    assert.equal(h.snapshot().state.coins, 0);
  });
});

test('main: ordinary hide/show pauses online progress and makes each offline interval claimable once', () => {
  const h = harness({ save: saved({ coins: 100, upgrades: { tap: 0, auto: 1, value: 0 } }) });
  const baseAuto = h.snapshot().production.baseAuto;
  h.hide(); h.frame(120000);
  assert.equal(h.snapshot().state.coins, 100);
  assert.equal(h.snapshot().stats.playedSeconds, 0);
  h.show();
  assert.equal(h.ui().modal.type, 'offline');
  assert.equal(h.snapshot().offline.seconds, 120);
  near(h.snapshot().offline.coins, baseAuto * 120 * 0.5);
  h.click('claimOffline');
  const afterFirstClaim = h.snapshot().state.coins;
  near(afterFirstClaim, 100 + baseAuto * 120 * 0.5);
  assert.equal(h.snapshot().offline, null);
  h.click('claimOffline'); h.show();
  assert.equal(h.snapshot().state.coins, afterFirstClaim);
  h.hide(); h.advance(60000); h.show();
  assert.equal(h.snapshot().offline.seconds, 60);
  h.click('claimOffline');
  near(h.snapshot().state.coins, afterFirstClaim + baseAuto * 60 * 0.5);
});

test('main: complete/cancel/fail/rejected ads settle once and block repeated watch clicks', async t => {
  for (const outcome of ['completed', 'cancelled', 'failed', 'rejected']) await t.test(outcome, async () => {
    const h = harness({ save: readyOrderSave() });
    beginOrderAd(h);
    h.click('watch'); h.click('watch');
    assert.equal(h.rewardRequests.length, 1);
    assert.equal(h.ui().adBusy, true);
    h.frame(5000);
    assert.equal(h.snapshot().state.coins, 10, 'ad playback pauses production');
    assert.equal(h.snapshot().stats.playedSeconds, 90);
    const request = h.rewardRequests[0];
    if (outcome === 'rejected') request.reject(new Error('SDK rejected'));
    else request.resolve({ completed: outcome === 'completed', reason: outcome });
    await flush();
    request.resolve({ completed: true, reason: 'completed' }); await flush();
    assert.equal(h.ui().adBusy, false);
    assert.equal(Object.keys(h.snapshot().state.pendingRewards).length, 0);
    if (outcome === 'completed') {
      assert.equal(h.snapshot().state.coins, 10 + CONFIG.orders[0].reward * 3);
      assert.equal(h.snapshot().state.orderIndex, 1);
      assert.equal(h.snapshot().stats.rewardedCount, 1);
      assert.equal(h.analytics.filter(e => e.event === 'reward_granted').length, 1);
      h.click('watch'); assert.equal(h.rewardRequests.length, 1);
    } else {
      assert.equal(h.snapshot().state.coins, 10);
      assert.equal(h.snapshot().state.orderIndex, 0);
      assert.equal(h.snapshot().stats.rewardedCount, 0);
      assert.equal(h.analytics.filter(e => e.event === 'reward_granted').length, 0);
      assert.equal(h.ui().modal.type, 'order');
      assert.match(h.ui().toast, outcome === 'cancelled' ? /未完整观看/ : /加载失败/);
      h.click('claimOrder');
      assert.equal(h.snapshot().state.coins, 10 + CONFIG.orders[0].reward, 'normal order payout remains available after an incomplete ad');
    }
  });
});

test('main: rewarded ad hide/show supports both SDK callback orders without losing the quote or granting offline income', async t => {
  for (const first of ['show', 'close']) await t.test(first + ' arrives first', async () => {
    const h = harness({ save: readyOrderSave() }); beginOrderAd(h);
    h.hide(); h.advance(45000);
    if (first === 'show') {
      h.show();
      assert.equal(Object.keys(h.snapshot().state.pendingRewards).length, 1);
    }
    h.rewardRequests[0].resolve({ completed: true, reason: 'completed' }); await flush();
    if (first === 'close') h.show();
    assert.equal(h.snapshot().state.coins, 10 + CONFIG.orders[0].reward * 3);
    assert.equal(h.snapshot().stats.rewardedCount, 1);
    assert.equal(h.snapshot().offline, null);
    assert.equal(h.ui().modal, null);
  });
});

test('main: background time after a settled ad earns offline income from the saved settlement time', async () => {
  const h = harness({ save: readyOrderSave() }); beginOrderAd(h);
  h.hide(); h.advance(30000);
  h.rewardRequests[0].resolve({ completed: true, reason: 'completed' }); await flush();
  assert.equal(h.saves.at(-1).savedAt, START + 30000);
  h.advance(60000); h.show();
  assert.equal(h.snapshot().stats.rewardedCount, 1);
  assert.equal(h.snapshot().offline.seconds, 60);
  near(h.snapshot().offline.coins, 12);
  h.click('claimOffline');
  near(h.snapshot().state.coins, 10 + CONFIG.orders[0].reward * 3 + 12);
});

test('main: modal keyboard handling blocks production, purchases and navigation, while Escape closes it', () => {
  const h = harness({ save: saved({ coins: 100 }) });
  h.key('KeyO'); assert.equal(h.ui().modal.type, 'order');
  for (const code of ['Space', 'Digit1', 'Digit2', 'Digit3', 'KeyM']) h.key(code);
  assert.equal(h.snapshot().state.coins, 100);
  assert.equal(h.snapshot().stats.taps, 0);
  assert.deepEqual(h.snapshot().state.upgrades, { tap: 0, auto: 0, value: 0 });
  assert.equal(h.ui().modal.type, 'order');
  h.key('Escape'); assert.equal(h.ui().modal, null);
  assert.equal(h.key('Space').prevented, true);
  assert.equal(h.snapshot().stats.taps, 1);
  h.key('Digit1'); assert.equal(h.snapshot().state.upgrades.tap, 1);
  h.key('Digit1', true); assert.equal(h.snapshot().state.upgrades.tap, 1, 'held purchase keys must not spend repeatedly');
});

test('main: expanding or collapsing a goal only changes its visibility, even when a purchase or reward is ready',()=>{
  for(const state of [
    {coins:100,taps:5,claimedQuests:['start-taps']},
    {coins:100,taps:5,upgrades:{tap:1,auto:1,value:0}}
  ]){
    const h=harness({save:saved(state)}),before=h.snapshot();
    h.click('goalCollapse');assert.equal(h.ui().goalExpanded,false);
    h.click('goalExpand');assert.equal(h.ui().goalExpanded,true);
    h.click('goalCollapse');assert.equal(h.ui().goalExpanded,false);
    assert.deepEqual(h.snapshot(),before,'changing guidance cannot produce, spend coins, claim rewards or change progress');
    assert.equal(h.ui().modal,null);
    assert.equal(h.analytics.some(entry=>entry.event==='upgrade_purchase'),false);
  }
});

test('main: Escape closes a sheet before collapsing guidance and respects a player who hid the tutorial',()=>{
  const h=harness();
  assert.ok(h.snapshot().tutorial,'new-player guidance is initially eligible to expand');
  h.key('Escape');assert.equal(h.ui().goalExpanded,false);
  h.key('Space');assert.equal(h.ui().goalExpanded,false,'production does not reopen dismissed teaching');
  h.click('goalExpand');assert.equal(h.ui().goalExpanded,true);
  h.click('workshop');assert.equal(h.ui().modal.type,'workshop');
  h.click('settings');assert.equal(h.ui().modal.type,'settings');
  h.click('goalCollapse');assert.equal(h.ui().goalExpanded,true,'a covered control cannot toggle the goal');
  h.key('Escape');assert.equal(h.ui().modal,null);
  assert.equal(h.ui().goalExpanded,true,'closing settings preserves the previously expanded goal');
  h.key('Escape');assert.equal(h.ui().goalExpanded,false);
  const before=h.snapshot();h.key('Escape');assert.deepEqual(h.snapshot(),before);
});

test('main: slow foreground frames advance economy by elapsed seconds while animation delta stays bounded', () => {
  const h = harness();
  h.frame(2000);
  near(h.snapshot().stats.playedSeconds, 2);
  near(h.snapshot().state.coins, 0.8);
  h.frame(10000);
  near(h.snapshot().stats.playedSeconds, 12);
  near(h.snapshot().state.coins, 4.8);
  assert.ok(h.saves.length >= 2, 'a slow frame still triggers periodic saving');
  near(h.lastUI().animationDt, 0.05, 'large economy steps must use a short visual animation step');
  h.frame(300000);
  near(h.snapshot().stats.playedSeconds, 72, 'a single unexpectedly huge foreground gap is capped at 60 seconds');
});

test('main: a restarted app discards an unverified persisted reward quote', () => {
  const game = new Game({ now: START, save: readyOrderSave() });
  const quote = game.quoteReward('order'); assert.ok(quote);
  const h = harness({ save: game.exportSave(START) });
  assert.equal(Object.keys(h.snapshot().state.pendingRewards).length, 0);
  assert.equal(h.snapshot().state.coins, 10);
  assert.equal(h.snapshot().stats.rewardedCount, 0);
  h.click('watch'); assert.equal(h.rewardRequests.length, 0);
});

test('main: reward confirmation freezes its preview and quoted payout while ordinary production advances', async () => {
  const h=harness({save:saved({coins:10,orderIndex:3,totalProduced:2500,playedSeconds:120})});
  const expected=h.snapshot().rewards.sponsor.impact;
  h.click('ad:sponsor');
  const initial=h.ui().modal;
  assert.equal(initial.type,'reward');assert.deepEqual(initial.impact,expected);
  h.frame(30000);
  assert.notEqual(h.snapshot().rewards.sponsor.impact.machineCoinsMissing,expected.machineCoinsMissing);
  assert.deepEqual(h.ui().modal.impact,expected);
  assert.deepEqual(h.ui().modal.quote,initial.quote);
  const coinsBefore=h.snapshot().state.coins;
  h.click('watch');h.rewardRequests[0].resolve({completed:true,reason:'completed'});await flush();
  near(h.snapshot().state.coins-coinsBefore,initial.quote.amount);
});

test('main: ordinary order toast uses the one actual settlement and repeated claims cannot repay it', () => {
  const h = harness({ save: readyOrderSave() });
  const before = h.snapshot().state.coins;
  h.click('claimOrder');
  assert.equal(h.ui().toast, '订单已发车，到账 +180 金币');
  assert.equal(h.snapshot().state.coins - before, CONFIG.orders[0].reward);
  assert.equal(h.snapshot().state.orderIndex, 1);
  assert.equal(h.analytics.filter(e => e.event === 'order').length, 1);
  h.click('claimOrder');
  assert.equal(h.snapshot().state.coins - before, CONFIG.orders[0].reward);
  assert.equal(h.analytics.filter(e => e.event === 'order').length, 1);

  // With two ready orders, one click must still settle only the first order.
  const queued = harness({ save: saved({ totalProduced: CONFIG.orders[1].target }) });
  queued.click('claimOrder');
  assert.equal(queued.snapshot().state.orderIndex, 1);
  assert.equal(queued.snapshot().state.coins, CONFIG.orders[0].reward);
  assert.equal(queued.ui().toast, '订单已发车，到账 +180 金币');
});

test('main: evolution feedback shows actual permanent income with sub-unit precision even during turbo', async t => {
  for (const boostSeconds of [0, CONFIG.turboDuration]) await t.test('boost seconds ' + boostSeconds, () => {
    const next = CONFIG.machines[1];
    const h = harness({ save: saved({ coins: next.cost, orderIndex: next.requiredOrders, totalProduced: CONFIG.orders[next.requiredOrders - 1].target, boostSeconds }) });
    const before = h.snapshot().production.baseIncome;
    h.click('evolve');
    const after = h.snapshot().production.baseIncome;
    const event = h.analytics.find(e => e.event === 'evolve');
    assert.ok(event);
    near(event.data.incomeBefore, before);
    near(event.data.incomeAfter, after);
    assert.equal(h.ui().toast, '电热锅开动！自动金币/秒 0.4 → 1.08');
    assert.equal(h.snapshot().state.machine, 1);
    assert.equal(h.snapshot().boostSeconds, boostSeconds);
  });
});

test('main: task rewards need explicit release, save once and stay claimed after reload', () => {
  const h = harness();
  for(let i=0;i<5;i++)h.click('tap');
  const task = h.snapshot().quests.focus;
  assert.equal(task.ready, true);
  const before = h.snapshot().state.coins;
  h.key('KeyQ');
  assert.equal(h.ui().modal.type, 'quests');
  h.click('questClaim:'+task.id);
  assert.equal(h.snapshot().state.coins, before+task.reward);
  assert.match(h.ui().toast, /金币已到账/);
  assert.equal(h.analytics.filter(e=>e.event==='quest').length, 1);
  assert.ok(h.sounds.includes('upgrade'));
  h.click('questClaim:'+task.id);
  assert.equal(h.snapshot().state.coins, before+task.reward);
  const restored = harness({save:h.saves.at(-1)});
  restored.click('questClaim:'+task.id);
  assert.equal(restored.snapshot().state.coins, before+task.reward);
  assert.equal(restored.snapshot().quests.claimedCount, 1);
  assert.equal(h.rewardRequests.length, 0);
});

test('main: task navigation reveals upgrades without buying or producing', () => {
  const h=harness({save:saved({coins:100})});
  const quests=h.snapshot().quests, chapter=quests.chapters[0];
  const tap=chapter.quests.find(q=>q.action==='tap');
  const upgrade=chapter.quests.find(q=>q.action==='upgrade:tap');
  assert.ok(tap&&upgrade);
  h.click('quests');h.click('questGo:'+upgrade.id);
  assert.equal(h.ui().modal.type,'upgrades');assert.equal(h.ui().tab,'upgrades');
  assert.equal(h.snapshot().state.coins,100);assert.equal(h.snapshot().state.upgrades.tap,0);
  assert.equal(h.ui().questGuideId,upgrade.id);
  h.click('quests');h.click('questGo:'+tap.id);
  assert.equal(h.ui().modal,null);assert.equal(h.snapshot().state.taps,0);
  const locked=quests.chapters[1].quests[0];
  h.click('quests');h.click('questChapter:'+quests.chapters[1].id);
  assert.equal(h.ui().modal.chapterId,quests.chapters[1].id);
  h.click('questGo:'+locked.id);h.click('questClaim:'+locked.id);
  assert.equal(h.ui().modal.type,'quests');assert.equal(h.snapshot().state.coins,100);
});

test('main: task claims and Q respect startup, reward playback and modal keyboard guards', () => {
  const seed=saved({taps:5,totalProduced:50,playedSeconds:120});
  const h=harness({save:seed,autoStart:false}), task=h.snapshot().quests.focus;
  const before=h.snapshot().state.coins;
  h.key('KeyQ');h.click('quests');h.click('questClaim:'+task.id);
  assert.equal(h.ui().startup,true);assert.equal(h.snapshot().state.coins,before);
  h.click('start');h.click('order');h.key('KeyQ');assert.equal(h.ui().modal.type,'order');
  h.click('ad:order');h.click('watch');h.click('questClaim:'+task.id);h.click('quests');
  assert.equal(h.ui().adBusy,true);assert.equal(h.snapshot().state.coins,before);
  assert.equal(h.snapshot().quests.claimedCount,0);
});


function brandSave(overrides={}) {
  return saved({machine:1,orderIndex:3,totalProduced:800,playedSeconds:240,coins:100, ...overrides});
}

test('main: consecutive complete brand adverts grant one permanent level each without a cooldown', async () => {
  const h=harness({save:brandSave()}), before=h.snapshot().production.baseIncome;
  h.key('KeyB');assert.equal(h.ui().modal.type,'brand');
  for(let level=1;level<=2;level++){
    h.click('ad:brand');assert.equal(h.ui().modal.quote.brandLevel,level-1);
    h.click('watch');h.click('watch');h.click('ad:brand');
    assert.equal(h.rewardRequests.length,level);
    assert.equal(h.rewardRequests[level-1].kind,'brand');
    const seconds=h.snapshot().state.playedSeconds;
    h.frame(60000);assert.equal(h.snapshot().state.playedSeconds,seconds);
    h.rewardRequests[level-1].resolve({completed:true});await flush();
    assert.equal(h.snapshot().state.brandLevel,level);
    assert.equal(h.ui().modal.type,'brand');assert.equal(h.ui().tab,'brand');
    assert.ok(h.ui().toast.includes('Lv.'+level));assert.ok(h.ui().toast.includes('永久'));
    assert.equal(h.saves.at(-1).brandLevel,level);
    near(h.snapshot().production.baseIncome,before*(1+level*CONFIG.brandBonusPerLevel));
    assert.equal(h.snapshot().rewards.turbo.available,true);
  }
  assert.equal(h.snapshot().rewards.brand.reason,'brand-stage-cap');
  h.click('ad:brand');h.click('watch');assert.equal(h.rewardRequests.length,2);
  assert.equal(h.analytics.filter(e=>e.event==='reward_granted'&&e.data.kind==='brand').length,2);
});

test('main: incomplete brand adverts return to the offer without granting or delaying retries', async t => {
  for(const outcome of ['cancelled','failed','unavailable','reject'])await t.test(outcome,async()=>{
    const h=harness({save:brandSave()}),before=h.snapshot().production.baseIncome;
    h.click('brand');h.click('ad:brand');h.click('watch');
    if(outcome==='reject')h.rewardRequests[0].reject(new Error('sdk unavailable'));
    else h.rewardRequests[0].resolve({completed:false,reason:outcome});
    await flush();assert.equal(h.snapshot().state.brandLevel,0);
    near(h.snapshot().production.baseIncome,before);assert.equal(h.ui().modal.type,'brand');
    assert.equal(h.snapshot().stats.rewardedCount,0);
    h.click('ad:brand');h.click('watch');assert.equal(h.rewardRequests.length,2);
  });
});

test('main: brand levels survive restart but interrupted, unverified requests grant nothing', async () => {
  const h=harness({save:brandSave()});h.click('ad:brand');h.click('watch');
  const interrupted=harness({save:h.saves.at(-1)});
  assert.equal(interrupted.snapshot().state.brandLevel,0);
  assert.deepEqual(interrupted.snapshot().state.pendingRewards,{});
  interrupted.click('watch');assert.equal(interrupted.rewardRequests.length,0);
  h.rewardRequests[0].resolve({completed:true});await flush();
  const restored=harness({save:h.saves.at(-1)});
  assert.equal(restored.snapshot().state.brandLevel,1);
  near(restored.snapshot().production.baseIncome,h.snapshot().production.baseIncome);
  restored.click('watch');assert.equal(restored.snapshot().state.brandLevel,1);
  restored.click('ad:brand');assert.equal(restored.ui().modal.quote.brandLevel,1);
});

test('main: recent legacy reward timestamps do not block another rewarded advert after loading', () => {
  const h=harness({save:brandSave({lastRewardAt:240,rewardedCount:1})});
  assert.equal(h.snapshot().rewards.brand.available,true);
  assert.equal(h.snapshot().rewards.turbo.available,true);
  h.click('ad:brand');h.click('watch');assert.equal(h.rewardRequests.length,1);
});

test('main: ordinary first upgrades and task rewards are not attributed to watching an advert', () => {
  const h=harness({save:saved({coins:100,taps:5})});
  h.click('questClaim:start-taps');h.click('upgrade:tap');
  assert.equal(h.analytics.find(e=>e.event==='upgrade_purchase').data.afterReward,false);
});


test('main: unlocked production choices require their panel, persist and leave pending offline rewards unchanged', () => {
  const h = harness({ save: saved({ machine: 2, orderIndex: 6, totalProduced: 20000, coins: 1000,
    taps: 10, bursts: 1, upgrades: { tap: 4, auto: 4, value: 4 } }) });
  const baseline = h.snapshot().production;
  h.click('productionMode:rush'); assert.equal(h.snapshot().state.productionMode, 'balanced');
  h.key('KeyP'); assert.equal(h.ui().modal.type, 'productionModes');
  h.click('productionMode:rush');
  assert.equal(h.snapshot().state.productionMode, 'rush');
  near(h.snapshot().production.baseAuto, baseline.baseAuto * 1.2);
  near(h.snapshot().production.baseIncome, baseline.baseIncome * .96);
  assert.equal(h.saves.at(-1).productionMode, 'rush');
  assert.equal(h.analytics.filter(item => item.event === 'experience_production_mode').length, 1);
  h.click('productionMode:rush');
  assert.equal(h.analytics.filter(item => item.event === 'experience_production_mode').length, 1);
  h.click('close'); h.hide(); h.advance(60000); h.show();
  assert.equal(h.snapshot().state.productionMode, 'rush');
  const pending = h.snapshot().offline;
  h.click('close'); h.click('productionModes'); h.click('productionMode:premium');
  assert.deepEqual(h.snapshot().offline, pending);
  h.click('close'); h.click('offline'); h.click('claimOffline');
  assert.equal(h.snapshot().offline, null);
  assert.match(h.ui().toast, /离线收益已到账/);
});

test('main: early factories cannot open production choices or use its keyboard shortcut', () => {
  const h = harness();
  h.key('KeyP'); assert.equal(h.ui().modal, null);
  assert.match(h.ui().toast, /双缸机/);
  h.click('productionMode:premium'); assert.equal(h.snapshot().state.productionMode, 'balanced');
});

function batchSave(overrides = {}) {
  return saved({ machine: 4, orderIndex: 14, totalProduced: CONFIG.orders[13].target,
    coins: 1e9, taps: 20, bursts: 1, playedSeconds: 120,
    upgrades: { tap: 16, auto: 18, value: 16 }, ...overrides });
}
const batchAction = (key, quote) => ['upgradeBatch', key, quote.fromLevel, quote.count, quote.cost].join(':');

test('main: bulk purchases require the selected panel quantity, save once and cannot replay an old quote', () => {
  const h = harness({ save: batchSave() }), before = h.snapshot();
  const quote = before.upgrades.find(u => u.key === 'auto').bulk;
  assert.ok(quote.count > 1);
  const action = batchAction('auto', quote);
  h.click(action); assert.deepEqual(h.snapshot().state.upgrades, before.state.upgrades);
  h.click('upgrades'); assert.equal(h.ui().modal.quantity, 1);
  h.click(action); assert.equal(h.snapshot().state.coins, before.state.coins);
  h.click('upgradeQuantity:5'); assert.equal(h.ui().modal.quantity, 5);
  assert.equal(h.snapshot().state.coins, before.state.coins, 'changing quantity does not purchase');
  h.click(action);
  assert.equal(h.snapshot().state.upgrades.auto, quote.toLevel);
  assert.equal(h.snapshot().state.coins, before.state.coins - quote.cost);
  assert.equal(h.saves.at(-1).upgrades.auto, quote.toLevel);
  assert.equal(h.analytics.filter(e => e.event === 'upgradeBatch').length, 1);
  assert.equal(h.analytics.find(e => e.event === 'upgrade_purchase').data.count, quote.count);
  const coins = h.snapshot().state.coins;
  h.click(action); assert.equal(h.snapshot().state.coins, coins);
  assert.match(h.ui().toast, /报价已变化/);
  h.click('close'); h.click('upgrades'); assert.equal(h.ui().modal.quantity, 1);
  h.click('close');
  const level = h.snapshot().state.upgrades.value;
  h.key('Digit3'); assert.equal(h.snapshot().state.upgrades.value, level + 1, 'keyboard still buys one level');
});

test('main: early batches stay locked and a later batch preserves the already-complete machine fund', () => {
  const early = harness({ save: saved({ coins: 1e9 }) });
  early.click('upgrades'); early.click('upgradeQuantity:5'); assert.equal(early.ui().modal.quantity, 1);
  early.click('upgradeBatch:tap:0:5:999'); assert.equal(early.snapshot().state.upgrades.tap, 0);
  const source = new Game({ save: batchSave(), now: START });
  const cost = source._upgradeCost('auto', 18) + source._upgradeCost('auto', 19);
  const fund = CONFIG.machines[5].cost;
  const h = harness({ save: batchSave({ coins: fund + cost }) });
  h.click('upgrades'); h.click('upgradeQuantity:5');
  const quote = h.snapshot().upgrades.find(u => u.key === 'auto').bulk;
  assert.equal(quote.count, 2); assert.equal(quote.reservedCoins, fund);
  h.click(batchAction('auto', quote)); assert.equal(h.snapshot().state.coins, fund);
  assert.equal(h.snapshot().upgrades.find(u => u.key === 'auto').bulk.count, 0);
});

test('main: earned heat recovery survives background and offline collection without granting more charges', () => {
  const h = harness({ save: batchSave({ machine: 3, orderIndex: 10, totalProduced: CONFIG.orders[9].target, energy: 92 }) });
  h.click('timing'); h.frame(8000);
  assert.equal(h.snapshot().milestones.heatRecovery.remainingTaps, 10);
  h.click('tap'); assert.equal(h.snapshot().state.heatRecoveryTaps, 9);
  const energy = h.snapshot().energy;
  h.hide(); h.advance(60000); h.show();
  assert.equal(h.snapshot().state.heatRecoveryTaps, 9);
  assert.equal(h.snapshot().energy, energy);
  assert.equal(h.ui().modal.type, 'offline'); h.click('claimOffline');
  assert.equal(h.snapshot().state.heatRecoveryTaps, 9);
  h.click('tap'); assert.equal(h.snapshot().state.heatRecoveryTaps, 8);
  assert.equal(h.snapshot().energy, energy + CONFIG.tapEnergy + CONFIG.heatRecoveryEnergyPerTap);
});

test('main: funding guidance opens the current beneficial upgrade without spending machine savings', () => {
  const h = harness({ save: saved({ machine: 2, orderIndex: 10, totalProduced: 847526.7689210637,
    coins: 19440801.157558426, taps: 20, bursts: 1, upgrades: { tap: 16, auto: 17, value: 17 } }) });
  const step = require('../src/next-step').selectNextStep(h.snapshot(),null,{suppressModeAdvice:true});
  assert.equal(step.kind, 'upgrade'); assert.ok(step.estimate);
  const before = h.snapshot().state;
  h.click('fundingUpgrade:' + step.upgradeKey); assert.equal(h.ui().modal, null);
  h.click('machine'); h.click('fundingUpgrade:' + step.upgradeKey);
  assert.equal(h.ui().modal.type, 'upgrades'); assert.equal(h.ui().modal.quantity, 1);
  assert.equal(h.ui().focusUpgrade, step.upgradeKey);
  assert.equal(h.snapshot().state.coins, before.coins);
  assert.deepEqual(h.snapshot().state.upgrades, before.upgrades);
  h.click('close'); h.click('upgrades'); assert.equal(h.ui().focusUpgrade, '', 'normal entry does not retain old navigation focus');
});
