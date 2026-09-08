'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const { selectCurrentTarget, createExperienceTracker } = require('../src/experience');
const NOW = 1800000000000;
const fresh = () => new Game({ now: NOW });
const entries = (tracker, event) => tracker.export().events.filter(item => item.event === event);
const drain = (tracker, game) => tracker.recordEvents(game.drainEvents(), game.getView());
function playable(game) {
  Object.assign(game.state, { taps: 5, bursts: 1, orderIndex: 1, totalProduced: 50,
    upgrades: { tap: 1, auto: 1, value: 0 }, playedSeconds: 90, coins: 100 });
}

test('experience telemetry: one target coordinates tracked tasks, direct claims and first-session priority', () => {
  const game = fresh();
  assert.equal(selectCurrentTarget(game.getView()).source, 'tutorial');
  for (let i = 0; i < 5; i++) game.tap();
  let target = selectCurrentTarget(game.getView());
  assert.equal(target.id, 'start-taps'); assert.equal(target.action, 'questClaim:start-taps');
  assert.equal(target.source, 'quest'); assert.equal(target.ready, true); assert.match(target.text, /8 金币/);
  const tracked = { questGuideId: 'start-auto-upgrade' };
  target = selectCurrentTarget(game.getView(), tracked);
  assert.equal(target.id, 'start-auto-upgrade'); assert.equal(target.action, 'upgrade:auto');
  assert.equal(target.title, '让火力接班'); assert.match(target.text, /下一级还差/);
  game.state.coins = 100; game.buyUpgrade('auto');
  target = selectCurrentTarget(game.getView(), tracked);
  assert.equal(target.action, 'questClaim:start-auto-upgrade');
  game.claimQuest('start-auto-upgrade');
  assert.equal(selectCurrentTarget(game.getView(), tracked).id, 'start-taps');
  game.state.totalProduced = 50;
  assert.equal(selectCurrentTarget(game.getView()).source, 'order', 'first ready order precedes untracked old task rewards');
  assert.equal(selectCurrentTarget(game.getView(), { questGuideId: 'start-taps' }).source, 'quest');
  game.claimOrder(); game.state.orderIndex = 3; game.state.coins = CONFIG.machines[1].cost;
  assert.equal(selectCurrentTarget(game.getView()).action, 'machine');
  assert.equal(selectCurrentTarget(game.getView(), { questGuideId: 'expand-electric' }).action, 'machine', 'locked tracked task is ignored');
});

test('experience telemetry: events retain genuine first milestones without inventing history from an existing save', () => {
  const game = fresh(), tracker = createExperienceTracker({ initialView: game.getView() });
  game.tap(); drain(tracker, game);
  game.state.coins = 100; game.buyUpgrade('tap'); drain(tracker, game);
  game.state.energy = 99; game.tap(); drain(tracker, game);
  game.state.totalProduced = 50; game.claimOrder(); drain(tracker, game);
  game.state.coins = CONFIG.machines[1].cost; game.state.orderIndex = 3; game.evolve(); drain(tracker, game);
  assert.deepEqual(Object.keys(tracker.export().milestones).sort(), ['first_burst', 'first_evolve', 'first_order', 'first_tap', 'first_upgrade']);
  const saved = game.exportSave(NOW), restored = new Game({ save: saved, now: NOW });
  const old = createExperienceTracker({ initialView: restored.getView() });
  restored.tap(); restored.state.coins = 1000; restored.buyUpgrade('tap'); drain(old, restored);
  old.observe(restored.getView());
  assert.deepEqual(old.export().milestones, {});
  assert.equal(entries(tracker, 'experience_milestone').length, 5);
});

test('experience telemetry: target and actual rendered ad entries deduplicate until visibility or eligibility changes', () => {
  const game = fresh(), tracker = createExperienceTracker();
  const detail = { adEntries: [{ kind: 'turbo', placement: 'factory' }] };
  tracker.observe(game.getView(), detail);
  game.tick(1); tracker.observe(game.getView(), detail); tracker.observe(game.getView(), detail);
  assert.equal(entries(tracker, 'experience_target_visible').length, 1, 'changing countdown text is not a new target');
  assert.equal(entries(tracker, 'experience_tutorial_step').length, 1);
  assert.equal(entries(tracker, 'experience_ad_entry').length, 1);
  assert.equal(tracker.export().ads.turbo.unavailableImpressions, 1);
  game.state.playedSeconds = 90; tracker.observe(game.getView(), detail);
  assert.equal(tracker.export().ads.turbo.impressions, 1);
  tracker.observe(game.getView(), { ...detail, visible: false });
  tracker.observe(game.getView(), detail);
  assert.equal(tracker.export().ads.turbo.impressions, 2, 'reopening a visible surface creates one new impression');
  tracker.recordAdClick('turbo', game.getView(), { placement: 'factory' });
  assert.equal(tracker.export().ads.turbo.clicks, 1);
  tracker.observe(game.getView(), { target: selectCurrentTarget(game.getView(), { questGuideId: 'start-auto-upgrade' }) });
  assert.equal(entries(tracker, 'experience_tutorial_step').length, 2, 'a hidden underlying tutorial is not counted as visible');
});

test('experience telemetry: recommendation exposure deduplicates changing prices, estimates and copy while keeping its current snapshot', () => {
  const game = fresh(), tracker = createExperienceTracker({ initialView: game.getView() });
  const recommendation = { id: 'upgrade:auto', kind: 'upgrade', action: 'upgrade:auto', enabled: true,
    upgradeKey: 'auto', cost: 18, missingCoins: 0, title: '提高自动产能', detail: '更快完成当前目标',
    reason: '目标生产需求', buttonLabel: '升级',
    estimate: { basis: 'permanent-auto-income', beforeSeconds: 120, afterSeconds: 90 } };
  for (let i = 0; i < 100; i++) {
    tracker.observe(game.getView(), { recommendation: { ...recommendation, cost: 18 + i,
      detail: '当前估算 ' + i, estimate: { ...recommendation.estimate, beforeSeconds: 120 - i } } });
  }
  assert.equal(entries(tracker, 'experience_recommendation_visible').length, 1);
  const current = tracker.export().recommendation;
  assert.equal(current.cost, 117); assert.equal(current.detail, '当前估算 99');
  assert.equal(current.estimate.beforeSeconds, 21);
  assert.equal(entries(tracker, 'experience_target_visible').length, 1, 'recommendation does not replace current-target observation');
});

test('experience telemetry: recommendation exposure follows action, eligibility, identity and upgrade changes', () => {
  const game = fresh(), tracker = createExperienceTracker({ initialView: game.getView() });
  let recommendation = { id: 'next', kind: 'upgrade', action: 'upgrade:auto', upgradeKey: 'auto', enabled: false };
  const observe = change => {
    recommendation = { ...recommendation, ...change };
    tracker.observe(game.getView(), { recommendation });
    tracker.observe(game.getView(), { recommendation });
  };
  observe({}); observe({ enabled: true }); observe({ action: 'factory' });
  observe({ upgradeKey: 'value' }); observe({ kind: 'save' }); observe({ id: 'next-machine' });
  const visible = entries(tracker, 'experience_recommendation_visible');
  assert.equal(visible.length, 6);
  assert.equal(visible[0].data.enabled, false); assert.equal(visible[1].data.enabled, true);
  assert.equal(visible[2].data.action, 'factory'); assert.equal(visible[3].data.upgradeKey, 'value');
  assert.equal(visible[4].data.kind, 'save'); assert.equal(visible[5].data.id, 'next-machine');
});

test('experience telemetry: covered, hidden or absent recommendation clears its snapshot and reopening counts once', () => {
  const game = fresh(), tracker = createExperienceTracker({ initialView: game.getView() });
  const recommendation = { id: 'first-order', kind: 'order', action: 'order', enabled: true };
  const shown = { recommendation };
  tracker.observe(game.getView(), shown);
  for (const hidden of [{ recommendation: null }, { recommendation: undefined }, {}, { visible: false, recommendation }]) {
    tracker.observe(game.getView(), hidden);
    assert.equal(tracker.export().recommendation, null);
    tracker.observe(game.getView(), hidden);
    tracker.observe(game.getView(), shown); tracker.observe(game.getView(), shown);
  }
  assert.equal(entries(tracker, 'experience_recommendation_visible').length, 5);
  game.tick(5); tracker.observe(game.getView(), shown);
  game.state.playedSeconds = 0; tracker.observe(game.getView(), shown);
  assert.equal(entries(tracker, 'experience_recommendation_visible').length, 6, 'a rewound observation starts a new visibility interval');
});

test('experience telemetry: recommendation snapshots retain only safe fields and isolate caller and report mutations', () => {
  const game = fresh(), tracker = createExperienceTracker({ initialView: game.getView() });
  const view = game.getView(), before = JSON.stringify(view), save = game.exportSave(NOW);
  const recommendation = { id: 'save-machine', kind: 'save', action: 'tap', enabled: false,
    title: 'x'.repeat(200), detail: '保留当前金币', reason: '升级会延后目标', buttonLabel: '继续生产',
    upgradeKey: 'unknown', cost: Infinity, missingCoins: 12,
    estimate: { basis: 'permanent-auto-income', beforeSeconds: 30, afterSeconds: 48, privateField: 'private-fixture' },
    raw: 'private-fixture' };
  tracker.observe(view, { recommendation });
  const report = tracker.export();
  assert.equal(report.recommendation.title.length, 160);
  assert.equal(report.recommendation.upgradeKey, undefined); assert.equal(report.recommendation.cost, undefined);
  assert.deepEqual(report.recommendation.estimate, { basis: 'permanent-auto-income', beforeSeconds: 30, afterSeconds: 48 });
  assert.doesNotMatch(JSON.stringify(report), /private-fixture/);
  recommendation.detail = 'changed by caller'; recommendation.estimate.beforeSeconds = 999;
  report.recommendation.detail = 'changed in export'; report.recommendation.estimate.afterSeconds = 999;
  report.events.find(entry => entry.event === 'experience_recommendation_visible').data.enabled = true;
  const next = tracker.export();
  assert.equal(next.recommendation.detail, '保留当前金币'); assert.equal(next.recommendation.estimate.beforeSeconds, 30);
  assert.equal(next.recommendation.estimate.afterSeconds, 48);
  assert.equal(entries(tracker, 'experience_recommendation_visible')[0].data.enabled, false);
  assert.equal(JSON.stringify(view), before); assert.deepEqual(game.exportSave(NOW), save);
  tracker.observe(view, { recommendation: { ...recommendation, estimate: { basis: 'unknown', beforeSeconds: 1, afterSeconds: 2 } } });
  assert.equal(tracker.export().recommendation.estimate, undefined);
  tracker.observe(view, { recommendation: {} });
  assert.equal(tracker.export().recommendation, null);
});

test('experience telemetry: recommendation transitions remain bounded when the analytics callback throws', () => {
  const game = fresh(), tracker = createExperienceTracker({ initialView: game.getView(), maxEvents: 16,
    track() { throw new Error('unavailable analytics'); } });
  const save = game.exportSave(NOW), queued = JSON.stringify(game.events);
  for (let i = 0; i < 80; i++) tracker.observe(game.getView(), { target: null,
    recommendation: { id: 'order:' + i, kind: 'order', action: 'order', enabled: true, title: '当前订单' } });
  const report = tracker.export();
  assert.equal(report.events.length, 16); assert.equal(report.droppedEvents, 64); assert.equal(report.trackingErrors, 80);
  assert.equal(report.recommendation.id, 'order:79'); assert.equal(report.events.at(-1).data.id, 'order:79');
  assert.deepEqual(game.exportSave(NOW), save); assert.equal(JSON.stringify(game.events), queued);
});

test('experience telemetry: grant follow-up waits for 30 played seconds and separates received rewards from later progress', () => {
  const game = fresh(); playable(game);
  const tracker = createExperienceTracker({ initialView: game.getView() });
  const quote = game.quoteReward('turbo'); game.applyReward(quote.id); drain(tracker, game);
  assert.equal(tracker.export().ads.turbo.grants, 1);
  tracker.recordEvent({ type: 'reward', kind: 'turbo', id: quote.id }, game.getView());
  assert.equal(tracker.export().ads.turbo.grants, 1, 'duplicate verified event is not double-counted');
  for (let i = 0; i < 100; i++) tracker.observe(game.getView());
  assert.equal(entries(tracker, 'experience_reward_progress').length, 0, 'wall time and repaint count do not advance the window');
  game.tick(29); game.buyUpgrade('auto'); drain(tracker, game); tracker.observe(game.getView());
  assert.equal(entries(tracker, 'experience_reward_progress').length, 0);
  const progress = entries(tracker, 'experience_progress').at(-1);
  assert.equal(progress.data.lastRewardKind, 'turbo');
  game.tick(1); drain(tracker, game); tracker.observe(game.getView());
  const outcome = entries(tracker, 'experience_reward_progress')[0].data;
  assert.equal(outcome.kind, 'turbo'); assert.equal(outcome.elapsedSeconds, 30);
  assert.equal(outcome.autoLevels, 1); assert.equal(outcome.upgradeLevels, 1);
  assert.ok(outcome.produced > 0); assert.ok(outcome.coinsEarned > outcome.coinsChange);
  assert.equal(outcome.interveningRewards, 0); assert.equal(tracker.export().pendingOutcomes.length, 0);
});

test('experience telemetry: ad requests and platform completion stay separate from verified grants', () => {
  const game = fresh(); playable(game);
  const tracker = createExperienceTracker({ initialView: game.getView() });
  const before = JSON.stringify(game.state), queued = JSON.stringify(game.events);
  tracker.recordAdRequest('turbo', game.getView());
  tracker.recordAdResult('turbo', { completed: true, reason: 'simulated-complete', simulated: true }, game.getView());
  let report = tracker.export();
  assert.equal(report.ads.turbo.requests, 1); assert.equal(report.ads.turbo.completions, 1);
  assert.equal(report.ads.turbo.grants, 0); assert.equal(report.pendingOutcomes.length, 0); assert.equal(report.recentReward, null);
  assert.equal(JSON.stringify(game.state), before); assert.equal(JSON.stringify(game.events), queued);
  const result = entries(tracker, 'experience_ad_result').at(-1);
  assert.equal(result.data.outcome, 'complete'); assert.equal(result.data.simulated, true);
  const quote = game.quoteReward('turbo'); game.applyReward(quote.id); drain(tracker, game);
  report = tracker.export();
  assert.equal(report.ads.turbo.completions, 1); assert.equal(report.ads.turbo.grants, 1);
  assert.equal(report.pendingOutcomes.length, 1); assert.equal(report.recentReward.kind, 'turbo');
});

test('experience telemetry: cancellation and failure reasons are bounded platform codes with no raw response data', () => {
  const game = fresh(); playable(game);
  const tracker = createExperienceTracker({ initialView: game.getView() });
  const responses = [
    { completed: false, reason: 'cancelled' },
    { completed: false, reason: 'timeout' },
    { completed: false, reason: 'unavailable' },
    { completed: false, reason: 'failed', error: { message: 'private-key-fixture' }, appId: 'private-app-fixture' },
    { completed: false, reason: 'private-url-fixture' },
    null
  ];
  for (const response of responses) {
    tracker.recordAdRequest('brand', game.getView());
    tracker.recordAdResult('brand', response, game.getView());
  }
  const report = tracker.export();
  assert.equal(report.ads.brand.requests, 6); assert.equal(report.ads.brand.cancellations, 1);
  assert.equal(report.ads.brand.failures, 5); assert.equal(report.ads.brand.completions, 0);
  assert.equal(report.ads.brand.grants, 0); assert.equal(report.pendingOutcomes.length, 0);
  assert.deepEqual(entries(tracker, 'experience_ad_result').map(entry => entry.data.reason), ['cancelled', 'timeout', 'unavailable', 'failed', 'unknown', 'unknown']);
  assert.doesNotMatch(JSON.stringify(report), /private-/);
  tracker.recordAdRequest('unknown', game.getView()); tracker.recordAdResult('unknown', {}, game.getView());
  assert.deepEqual(tracker.export(), report, 'unknown placements cannot create unbounded counters');
});

test('experience telemetry: modal and hidden target semantics preserve ad exposure and re-entry counting', () => {
  const game = fresh(); playable(game);
  const tracker = createExperienceTracker({ initialView: game.getView() });
  const detail = { visible: true, target: null, adEntries: [{ kind: 'order', placement: 'order' }] };
  tracker.observe(game.getView(), detail);
  assert.equal(tracker.export().target, null);
  assert.equal(tracker.export().ads.order.unavailableImpressions, 1, 'modal advertisements remain visible when the home target is covered');
  tracker.observe(game.getView(), { visible: false });
  assert.equal(tracker.export().target, null, 'hidden view has no observed target');
  tracker.observe(game.getView(), detail);
  assert.equal(tracker.export().ads.order.unavailableImpressions, 2);
  tracker.observe(game.getView());
  assert.deepEqual(tracker.export().target, selectCurrentTarget(game.getView()));
});

test('experience telemetry: free timing attempts record their result without replacing the first free burst milestone', () => {
  const game = fresh(), tracker = createExperienceTracker({ initialView: game.getView() });
  assert.equal(game.tryPerfectBurst().ok, false);drain(tracker, game);
  assert.equal(entries(tracker, 'experience_timing').length, 0);
  assert.equal(tracker.export().milestones.first_burst, undefined);
  game.tick(60);game.tick(40);drain(tracker, game);
  const firstBurst=tracker.export().milestones.first_burst;
  assert.equal(firstBurst.data.name, 'first_burst');
  assert.equal(game.tryPerfectBurst().ok, false);drain(tracker, game);
  game.tick(60);game.tick(20);drain(tracker, game);
  const before=game.exportSave(NOW);
  assert.equal(game.tryPerfectBurst().perfect, false);
  assert.equal(game.tryPerfectBurst().ok, false);drain(tracker, game);
  assert.deepEqual(game.exportSave(NOW), before, 'a miss neither charges nor changes production');
  game.tick(20);game.tick(60);game.tick(34);drain(tracker, game);
  assert.equal(game.tryPerfectBurst().perfect, true);
  game.tick(2);drain(tracker, game);
  const attempts=entries(tracker, 'experience_timing');
  assert.deepEqual(attempts.map(entry=>[entry.data.perfect,entry.data.energy,entry.data.bonusPercent,entry.data.burstNumber]), [[false,80,0,2],[true,94,20,3]], 'reports retain the attempt energy, even when event processing is delayed');
  assert.deepEqual(tracker.export().milestones.first_burst,firstBurst);
});

test('experience telemetry: order-ad transaction is attributed to its own kind and overlapping windows disclose other grants', () => {
  const game = fresh(); playable(game); game.state.orderIndex = 0;
  const tracker = createExperienceTracker({ initialView: game.getView() });
  const turbo = game.quoteReward('turbo'); game.applyReward(turbo.id); drain(tracker, game);
  game.tick(2); drain(tracker, game);
  const order = game.quoteReward('order'); game.applyReward(order.id); drain(tracker, game);
  assert.equal(tracker.export().milestones.first_order.data.lastRewardKind, 'order');
  assert.equal(entries(tracker, 'experience_progress').at(-1).data.lastRewardKind, 'order');
  game.tick(30); drain(tracker, game); tracker.observe(game.getView());
  const outcomes = entries(tracker, 'experience_reward_progress');
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes.find(entry => entry.data.kind === 'turbo').data.interveningRewards, 1);
  assert.equal(outcomes.find(entry => entry.data.kind === 'order').data.interveningRewards, 0);
  assert.equal(outcomes.find(entry => entry.data.kind === 'order').data.orders, 0, 'the grant settlement is outside the post-grant window');
  game.tick(60); game.state.coins = 1000; game.buyUpgrade('tap'); drain(tracker, game);
  assert.equal(entries(tracker, 'experience_progress').at(-1).data.lastRewardKind, undefined, 'last-touch attribution expires');
});

test('experience telemetry: bounded reports and throwing analytics callbacks cannot change state, events or exported saves', () => {
  const game = fresh(); playable(game);
  const tracker = createExperienceTracker({ initialView: game.getView(), maxEvents: 16, maxPending: 2, track() { throw new Error('offline analytics'); } });
  const before = JSON.stringify(game.state), beforeEvents = JSON.stringify(game.events);
  for (let i = 0; i < 40; i++) {
    tracker.recordAdClick('turbo', game.getView());
    tracker.recordEvent({ type: 'reward', id: 'sample:' + i, kind: 'turbo', amount: 0, coins: 0 }, game.getView());
    tracker.observe(game.getView()); selectCurrentTarget(game.getView());
  }
  assert.equal(JSON.stringify(game.state), before); assert.equal(JSON.stringify(game.events), beforeEvents);
  const report = tracker.export();
  assert.equal(report.events.length, 16); assert.equal(report.pendingOutcomes.length, 2);
  assert.ok(report.droppedEvents > 0); assert.equal(report.droppedOutcomes, 38); assert.ok(report.trackingErrors > 0);
  report.current.upgrades.tap = 999; report.events.length = 0; report.ads.turbo.grants = -1;
  assert.equal(tracker.export().current.upgrades.tap, 1); assert.equal(tracker.export().events.length, 16);
  assert.equal(tracker.export().ads.turbo.grants, 40);
  assert.equal(JSON.stringify(game.state), before);
});

test('experience telemetry: production choice records the actual selected economics without inventing a reward', () => {
  const game = new Game({ now: NOW });
  Object.assign(game.state, { machine: 2, orderIndex: 6, totalProduced: 20000 });
  const tracker = createExperienceTracker({ initialView: game.getView() });
  game.setProductionMode('premium'); drain(tracker, game);
  const recorded = entries(tracker, 'experience_production_mode');
  assert.equal(recorded.length, 1); assert.equal(recorded[0].data.from, 'balanced');
  assert.equal(recorded[0].data.to, 'premium');
  assert.equal(recorded[0].data.baseIncome, game.getView().production.baseIncome);
  assert.equal(tracker.export().current.productionMode, 'premium');
  assert.equal(entries(tracker, 'experience_reward_granted').length, 0);
});

test('experience telemetry: a bulk purchase records one transaction and its actual levels without an ad reward', () => {
  const game = fresh();
  Object.assign(game.state, { machine: 4, orderIndex: 14, totalProduced: CONFIG.orders[13].target, coins: 1e9,
    upgrades: { tap: 16, auto: 18, value: 16 } });
  const tracker = createExperienceTracker({ initialView: game.getView() });
  const quote = game.getView().upgrades.find(u => u.key === 'auto').bulk;
  assert.ok(game.buyUpgradeBatch('auto', quote).ok); drain(tracker, game);
  const progress = entries(tracker, 'experience_progress');
  assert.equal(progress.length, 1); assert.equal(progress[0].data.kind, 'upgradeBatch');
  assert.equal(progress[0].data.count, quote.count); assert.equal(progress[0].data.cost, quote.cost);
  assert.equal(tracker.export().current.upgrades.auto, quote.toLevel);
  assert.equal(entries(tracker, 'experience_reward_granted').length, 0);
});

test('experience telemetry: heat recovery is recorded only when a perfect burst actually grants it', () => {
  const game = fresh();
  Object.assign(game.state, { machine: 3, orderIndex: 10, totalProduced: CONFIG.orders[9].target, bursts: 1, energy: 92,
    upgrades: { tap: 16, auto: 16, value: 16 } });
  const tracker = createExperienceTracker({ initialView: game.getView() });
  game.tryPerfectBurst(); drain(tracker, game);
  assert.equal(entries(tracker, 'experience_heat_recovery').length, 0, 'arming has not paid a burst');
  game.tick(8); drain(tracker, game);
  assert.equal(entries(tracker, 'experience_heat_recovery').length, 1);
  assert.equal(entries(tracker, 'experience_heat_recovery')[0].data.grantedTaps, 10);
  game.tap(); game.tap(); drain(tracker, game);
  assert.equal(tracker.export().current.heatRecoveryTaps, 8);
  assert.equal(entries(tracker, 'experience_heat_recovery').length, 1);
  assert.equal(entries(tracker, 'experience_reward_granted').length, 0);
});
