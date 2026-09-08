'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { Game, CONFIG, QUEST_CHAPTERS } = require('../src/core');
const { harness, START } = require('./app-harness.cjs');
const { legacyGame } = require('./legacy-fixture.cjs');

const copy = value => JSON.parse(JSON.stringify(value));

function saved(overrides = {}) {
  // Most fixtures isolate economic and host behavior from automatic milestones.
  // Teaching tests explicitly request an empty claimedQuests list or a fresh app.
  return Object.assign(legacyGame({ now: START }).exportSave(START), { claimedQuests: QUEST_CHAPTERS.flatMap(c => c.quests.map(q => q.id)) }, overrides);
}

async function flush() { for (let i = 0; i < 6; i++) await Promise.resolve(); }

test('main: developer long press keeps short taps immediate and repeats at 100 taps/second across frame rates', () => {
  for (const intervals of [[33, 33, 34], [16, 17, 17], [8, 8, 9], [7, 41, 12, 90]]) {
    const h = harness({ config: { developerHoldTap: true } });
    h.pointer('down'); assert.equal(h.snapshot().state.taps, 1);
    h.frame(349); assert.equal(h.snapshot().state.taps, 1);
    h.frame(1); assert.equal(h.snapshot().state.taps, 1);
    let elapsed = 0, frame = 0;
    while (elapsed < 2000) {
      const ms = Math.min(intervals[frame++ % intervals.length], 2000 - elapsed);
      h.frame(ms); elapsed += ms;
    }
    assert.equal(h.snapshot().state.taps, 201, 'two seconds of held production gives 200 extra taps');
    h.pointer('up'); h.frame(1000);
    assert.equal(h.snapshot().state.taps, 201, 'release does not click again or leave a timer running');
    h.pointer('down'); h.frame(100); h.pointer('up'); h.frame(1000);
    assert.equal(h.snapshot().state.taps, 202, 'a fresh short press still gives exactly one tap');
  }
});

test('main: held production requires an explicit boolean development flag', () => {
  for (const developerHoldTap of [undefined, false, 'true', 1]) {
    const h = harness({ config: { developerHoldTap, debug: true } });
    h.pointer('down'); h.frame(350); h.frame(2000); h.pointer('up');
    assert.equal(h.snapshot().state.taps, 1);
  }
});

test('main: developer held taps use the normal tutorial economy, burst and persistence paths', () => {
  const save = saved();
  const held = harness({ config: { developerHoldTap: true }, save }), manual = harness({ save });
  held.pointer('down'); manual.click('tap');
  held.frame(350); manual.frame(350);
  held.frame(1000); manual.frame(1000);
  for (let i = 0; i < 100; i++) manual.click('tap');
  held.pointer('up');
  assert.deepEqual(held.snapshot(), manual.snapshot());
  assert.equal(held.rendererEvents.filter(e => e.type === 'produce' && e.source === 'tap').length, 101);
  held.hide();
  assert.equal(held.saves.at(-1).taps, save.taps + 101);
});

test('main: developer holds stop on cancel, leaving production, backgrounding, panels and resizing', () => {
  for (const cancel of [
    h => h.pointer('cancel'),
    h => { h.pointer('move', 'upgrades', 1, 150, 150); h.pointer('move', 'tap'); },
    h => { h.hide(); h.advance(10000); h.show(); },
    h => { h.key('KeyO'); h.key('Escape'); },
    h => h.resize()
  ]) {
    const h = harness({ config: { developerHoldTap: true } });
    h.pointer('down'); h.frame(350); h.frame(1000);
    assert.equal(h.snapshot().state.taps, 101);
    cancel(h); h.frame(0); h.frame(1000);
    assert.equal(h.snapshot().state.taps, 101, 'the interrupted gesture cannot resume itself');
    h.pointer('up'); h.pointer('down'); h.frame(350); h.frame(1000);
    assert.equal(h.snapshot().state.taps, 202, 'a new gesture can repeat normally');
  }
});

test('main: a second finger cannot multiply production or release the held finger', () => {
  const h = harness({ config: { developerHoldTap: true } });
  h.pointer('down'); h.pointer('down', 'tap', 2);
  h.frame(350); h.frame(1000);
  assert.equal(h.snapshot().state.taps, 101);
  h.pointer('cancel', 'tap', 2); h.pointer('up', 'tap', 2); h.frame(1000);
  assert.equal(h.snapshot().state.taps, 201);
  h.pointer('up'); h.frame(1000);
  assert.equal(h.snapshot().state.taps, 201);
});

test('main: startup, panels, ads and non-production controls never acquire developer repeat', () => {
  const h = harness({ config: { developerHoldTap: true }, autoStart: false, save: readyOrderSave() });
  h.pointer('down'); h.frame(2000); h.pointer('up');
  assert.equal(h.snapshot().state.taps, 0);
  h.click('start'); h.frame(0);
  h.pointer('down', 'order'); h.frame(2000);
  assert.equal(h.ui().modal, null, 'navigation still waits for release');
  h.pointer('up', 'order'); assert.equal(h.ui().modal.type, 'order');
  h.pointer('down'); h.frame(2000); h.pointer('up');
  assert.equal(h.snapshot().state.taps, 0, 'a panel blocks production');
  h.click('ad:order'); h.click('watch');
  h.pointer('down'); h.frame(2000); h.pointer('up');
  assert.equal(h.snapshot().state.taps, 0);
  assert.equal(h.rewardRequests.length, 1, 'holding never replays an ad request');
});

test('main: developer hold uses touch-down time and discards excessive stalled-frame backlog', () => {
  const h = harness({ config: { developerHoldTap: true } });
  h.advance(5000); h.pointer('down'); h.frame(0);
  assert.equal(h.snapshot().state.taps, 1, 'time before touch-down cannot count as holding');
  h.frame(350); h.frame(10000);
  assert.equal(h.snapshot().state.taps, 101, 'one stalled frame catches up at most one second');
  h.frame(10); assert.equal(h.snapshot().state.taps, 102, 'discarded time is never replayed in later frames');
});

function growthSave(overrides={}) {
  const game=legacyGame({now:START});
  Object.assign(game.state,{machine:4,orderIndex:14,totalProduced:64000000,coins:1e10,taps:20,bursts:1,energy:85,
    playedSeconds:120,upgrades:{tap:24,auto:24,value:24},learning:{heatRecoveryUses:10,heatRecoveryDismissed:false}},overrides);
  game.state.claimedQuests = QUEST_CHAPTERS.flatMap(c => c.quests.map(q => q.id));
  return game.exportSave(START);
}

test('main: automatic pots keep producing behind sheets without a timing cue',()=>{
  const h=harness({save:growthSave({energy:90})});
  h.click('upgrades');h.frame(1000);
  assert.equal(h.snapshot().state.bursts,1,'the old perfect interval cannot settle a pot');
  h.frame(500);
  assert.equal(h.snapshot().state.bursts,2);
  assert.equal(h.ui().modal.type,'upgrades');
  assert.equal(h.sounds.filter(s=>s==='burst').length,1);
  assert.equal(h.sounds.includes('heatReady'),false);
});
function readyOrderSave() { return saved({ coins: 10, totalProduced: CONFIG.orders[0].target, playedSeconds: CONFIG.rewardUnlockSeconds }); }

test('main: retired ignition input and F shortcut cannot produce before an automatic pot',()=>{
  const h=harness({save:growthSave({energy:96})});
  const before=h.snapshot();
  assert.equal(h.key('KeyF').prevented,false);
  h.click('timing');
  assert.deepEqual(h.snapshot(),before);
  assert.equal(h.rendererEvents.some(e=>e.type==='burst'),false);
  h.frame(1000);
  assert.equal(h.snapshot().state.bursts,2);
  assert.equal(h.rendererEvents.filter(e=>e.type==='burst').length,1);
  assert.equal(h.analytics.some(e=>e.event==='timing'||e.event==='experience_timing'),false);
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
  assert.equal(h.saves.length, 0);
  assert.match(h.ui().toast, /进度暂未保存/);
  h.key('Space');
  assert.equal(h.snapshot().state.coins, 1);
  h.setSaveFailure(false); h.click('close');
  assert.equal(h.saves.at(-1).coins, 1);
  h.frame(4000);assert.equal(h.ui().toast,'');
  const savedCount=h.saves.length;
  h.setSaveFailure(true); h.click('close');
  assert.match(h.ui().toast, /进度暂未保存/);
  assert.equal(h.saves.length,savedCount);
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

test('main: Escape closes a sheet before collapsing established-factory guidance and preserves the player choice',()=>{
  const h=harness();
  h.click('goalExpand');
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

test('main: evolution forwards precise permanent income to its reveal and clears stale toast even during turbo', async t => {
  for (const boostSeconds of [0, CONFIG.turboDuration]) await t.test('boost seconds ' + boostSeconds, () => {
    const next = CONFIG.machines[1];
    const h = harness({ save: saved({ coins: next.cost, orderIndex: next.requiredOrders, totalProduced: CONFIG.orders[next.requiredOrders - 1].target, boostSeconds }) });
    h.click('modules');assert.match(h.ui().toast,/解锁/);
    const before = h.snapshot().production.baseIncome;
    h.click('evolve');
    const after = h.snapshot().production.baseIncome;
    const event = h.analytics.find(e => e.event === 'evolve');
    assert.ok(event);
    near(event.data.incomeBefore, before);
    near(event.data.incomeAfter, after);
    const reveals = h.rendererEvents.filter(e => e.type === 'evolve');
    assert.equal(reveals.length,1,'one settled evolution launches one reveal');
    assert.deepEqual(reveals[0],event.data,'the renderer receives the authoritative settled event');
    near(reveals[0].incomeBefore,.4);near(reveals[0].incomeAfter,1.0752,'rendering receives full settlement precision before formatting');
    assert.equal(h.ui().toast,'','an earlier toast cannot cover the production reveal');
    assert.equal(h.ui().toastSeconds,0);assert.equal(h.ui().toastKind,'');
    assert.equal(h.sounds.filter(name=>name==='machine').length,1);
    assert.equal(h.snapshot().state.machine, 1);
    assert.equal(h.snapshot().boostSeconds, boostSeconds);
  });
});

test('main: teaching milestones pay automatically, persist and cannot be claimed a second time', () => {
  const h = harness();
  for(let i=0;i<5;i++)h.click('tap');
  const task = h.snapshot().quests.chapters[0].quests.find(q => q.id === 'start-taps');
  assert.equal(task.claimed, true); assert.equal(task.ready, false);
  const before = h.snapshot().state.coins;
  h.key('KeyQ');
  assert.equal(h.ui().modal.type, 'quests');
  h.click('questClaim:'+task.id);
  assert.equal(h.snapshot().state.coins, before);
  assert.equal(h.analytics.filter(e=>e.event==='quest').length, 1);
  assert.ok(h.sounds.includes('upgrade'));
  h.click('questClaim:'+task.id);
  assert.equal(h.snapshot().state.coins, before);
  const restored = harness({save:h.saves.at(-1)});
  restored.click('questClaim:'+task.id);
  assert.equal(restored.snapshot().state.coins, before);
  assert.equal(restored.snapshot().quests.claimedCount, 1);
  assert.equal(h.rewardRequests.length, 0);
});

test('main: task navigation reveals upgrades without buying or producing', () => {
  const h=harness({save:saved({coins:100,claimedQuests:[]})});
  const quests=h.snapshot().quests, chapter=quests.chapters[0];
  const tap=chapter.quests.find(q=>q.action==='tap');
  const upgrade=chapter.quests.find(q=>q.action==='upgrade:tap');
  assert.ok(tap&&upgrade);
  h.click('quests');h.click('questGo:'+upgrade.id);
  assert.equal(h.ui().modal.type,'upgrades');
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
  const seed=saved({taps:5,totalProduced:50,playedSeconds:120,claimedQuests:[]});
  const h=harness({save:seed,autoStart:false}), task=h.snapshot().quests.focus;
  const before=h.snapshot().state.coins;
  h.key('KeyQ');h.click('quests');h.click('questClaim:'+task.id);
  assert.equal(h.ui().startup,true);assert.equal(h.snapshot().state.coins,before);
  h.click('start');h.click('order');h.key('KeyQ');assert.equal(h.ui().modal.type,'order');
  h.click('ad:order');h.click('watch');h.click('questClaim:'+task.id);h.click('quests');
  assert.equal(h.ui().adBusy,true);assert.equal(h.snapshot().state.coins,before);
  assert.equal(h.snapshot().quests.claimedCount,1);
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
    assert.equal(h.ui().modal.type,'brand');
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

test('main: funding guidance opens the current beneficial upgrade without spending machine savings', () => {
  const h = harness({ save: saved({ machine: 2, orderIndex: 10, totalProduced: 847526.7689210637,
    coins: 1000000, taps: 20, bursts: 1, upgrades: { tap: 12, auto: 12, value: 12 } }) });
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

function contractSave(overrides = {}) {
  return saved({ machine: 2, orderIndex: 6, totalProduced: CONFIG.orders[5].target, coins: 10000000,
    taps: 20, bursts: 3, energy: 0, playedSeconds: 200, upgrades: { tap: 12, auto: 12, value: 12 }, ...overrides });
}
function chooseContract(h, kind) {
  h.click('order');
  const quote = h.ui().modal.contractQuotes[kind];
  h.click('contractAccept:' + kind + ':' + quote.id);
  assert.equal(h.snapshot().contracts.active.id, quote.id);
  return quote;
}
test('main: contract actions parse the entire quoted ID and require the matching order panel', () => {
  const h = harness({ save: contractSave() }), quote = h.snapshot().contracts.options.find(o => o.kind === 'cinema');
  const action = 'contractAccept:cinema:' + quote.id;
  assert.ok(quote.id.split(':').length > 2, 'the ID itself contains separators');
  h.click(action); assert.equal(h.snapshot().contracts.active, null);
  h.click('order'); assert.equal(h.ui().modal.contractQuotes.cinema.id, quote.id);
  h.click(action + ':forged'); assert.equal(h.snapshot().contracts.active, null);
  h.click(action); assert.equal(h.snapshot().contracts.active.id, quote.id); assert.equal(h.ui().modal, null);
  h.click(action); assert.equal(h.snapshot().contracts.active.id, quote.id);
  assert.equal(h.analytics.filter(e => e.event === 'contract' && e.data.action === 'accept').length, 1);
  assert.equal(h.saves.at(-1).factory.active.id, quote.id);
});
test('main: a changed factory invalidates the displayed contract quote before acceptance', () => {
  const h = harness({ save: contractSave() }); h.click('order');
  const quote = h.ui().modal.contractQuotes.gift;
  h.click('upgrade:auto');
  assert.equal(h.snapshot().state.upgrades.auto, 13);
  h.click('contractAccept:gift:' + quote.id);
  assert.equal(h.snapshot().contracts.active, null);
  assert.equal(h.ui().modal.type, 'order');
  assert.notEqual(h.ui().modal.contractQuotes.gift.basis, quote.basis);
});
test('main: abandoning a contract requires two deliberate clicks and does not reclaim held goods', () => {
  const h = harness({ save: contractSave() }), quote = chooseContract(h, 'gift');
  h.frame(3000); const before = h.snapshot(); assert.ok(before.contracts.active.heldCoins > 0);
  const action = 'contractCancel:' + quote.id;
  h.click(action); assert.equal(h.snapshot().contracts.active.id, quote.id);
  h.click('order'); h.click(action);
  assert.equal(h.snapshot().contracts.active.id, quote.id); assert.equal(h.ui().modal.cancelContractId, quote.id);
  h.click(action); assert.equal(h.snapshot().contracts.active, null);
  assert.equal(h.snapshot().state.coins, before.state.coins); assert.equal(h.snapshot().state.orderIndex, 6);
  const replacement = h.ui().modal.contractQuotes.gift;
  assert.notEqual(replacement.id, quote.id);
  h.click('contractAccept:gift:' + replacement.id);
  assert.equal(h.snapshot().contracts.active.progress, 0); assert.equal(h.snapshot().contracts.active.heldCoins, 0);
});
test('main: the catalogue preserves all owned devices through panel actions, accepted contracts and restart', () => {
  const save = contractSave({ orderIndex: 8 });
  const h = harness({ save });
  const owned = h.snapshot().factory.owned;
  assert.deepEqual(owned.slice().sort(), ['coating', 'packer', 'pressure']);
  h.click('module:packer'); assert.deepEqual(h.snapshot().factory.owned, owned);
  h.key('KeyP'); assert.equal(h.ui().modal.type, 'modules');
  h.click('module:pressure'); assert.deepEqual(h.snapshot().factory.owned, owned);
  h.click('pressureMode:hold'); assert.equal(h.snapshot().factory.pressureMode, 'hold');
  h.click('close'); chooseContract(h, 'festival');
  h.click('modules'); h.click('module:pressure');
  assert.deepEqual(h.snapshot().factory.owned, owned); assert.equal(h.snapshot().factory.canConfigure, false);
  const restarted = harness({ save: h.saves.at(-1) });
  assert.deepEqual(restarted.snapshot().factory.owned, owned); assert.equal(restarted.snapshot().factory.pressureMode, 'hold');
  assert.equal(restarted.snapshot().contracts.active.kind, 'festival');
});
test('main: stored pressure uses its own release action, respects sheets and persists one actual burst', () => {
  const save = contractSave(); save.factory.owned = ['pressure', 'coating']; save.factory.pressureMode = 'hold';
  const h = harness({ save }); h.frame(20000);
  assert.equal(h.snapshot().factory.storedBurst, true);
  const before = h.snapshot(); h.click('order'); h.click('releasePressure');
  assert.equal(h.snapshot().state.bursts, before.state.bursts);
  h.key('Escape'); h.key('KeyR');
  assert.equal(h.snapshot().state.bursts, before.state.bursts + 1); assert.equal(h.snapshot().factory.storedBurst, false);
  assert.ok(h.rendererEvents.some(e => e.type === 'burst' && e.source === 'pressure'));
  h.key('KeyR'); assert.equal(h.snapshot().state.bursts, before.state.bursts + 1);
  const restarted = harness({ save: h.saves.at(-1) });
  assert.equal(restarted.snapshot().factory.storedBurst, false); assert.equal(restarted.snapshot().state.bursts, before.state.bursts + 1);
});
test('main: developer repeat cannot bypass the later per-pot operation limit', () => {
  const h = harness({ save: contractSave(), config: { developerHoldTap: true } });
  const taps = h.snapshot().state.taps;
  h.pointer('down'); h.frame(350); h.frame(1000); h.frame(1000); h.frame(1000); h.pointer('up');
  assert.equal(h.snapshot().state.taps - taps, 3); assert.equal(h.snapshot().factory.tapsRemaining, 0);
});
test('main: a rewarded contract delivery settles its held goods once and survives restart', async () => {
  const h = harness({ save: contractSave() }); chooseContract(h, 'cinema'); h.frame(60000);
  assert.equal(h.snapshot().order.ready, true);
  const order = h.snapshot().order, coins = h.snapshot().state.coins;
  assert.ok(order.heldCoins > 0);
  beginOrderAd(h); const amount = h.ui().modal.quote.amount;
  h.rewardRequests[0].resolve({ completed: true, reason: 'completed' }); await flush();
  near(h.snapshot().state.coins - coins, order.reward + amount);
  assert.equal(h.snapshot().state.orderIndex, 7); assert.equal(h.snapshot().contracts.active, null);
  h.click('claimOrder'); assert.equal(h.snapshot().state.orderIndex, 7);
  const restarted = harness({ save: h.saves.at(-1) });
  assert.equal(restarted.snapshot().state.orderIndex, 7); assert.equal(restarted.snapshot().order.awaitingSelection, true);
});
