'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core.js');
const { simulate } = require('./balance.cjs');
const chapters = new Game({ now: 1000000 }).getView().quests.chapters;
const allQuestIds = chapters.flatMap(chapter => chapter.quests.map(quest => quest.id));
const policies = [
  { name: 'active (2 taps/s)', tapsPerSecond: 2 },
  { name: 'low-frequency (1 tap/s)', tapsPerSecond: 1 },
  { name: 'passive (0 taps/s)', tapsPerSecond: 0 }
];
const comparisons = policies.map(policy => ({
  ...policy,
  baseline: simulate(policy),
  guided: simulate({ ...policy, collectQuests: true })
}));

for (const { name, tapsPerSecond, baseline, guided } of comparisons) {
  test(name + ': optional quest collection preserves a natural, free path to all orders and devices', () => {
    assert.equal(baseline.completed, true);
    assert.equal(guided.completed, true);
    assert.equal(baseline.questRewardCount, 0);
    assert.equal(baseline.questRewardCoins, 0);
    assert.equal(baseline.assumptions.collectQuests, false);
    assert.equal(guided.assumptions.collectQuests, true);
    assert.equal(guided.rewardCount, 0, 'quest rewards never require advertisements');
    assert.equal(guided.orders.length, CONFIG.orders.length);
    assert.equal(guided.machines.length, CONFIG.machines.length);
    assert.ok(guided.milestones.firstUpgrade.playSeconds > 0, 'the first upgrade still requires playing');
    assert.ok(guided.milestones.firstUpgrade.playSeconds <= baseline.milestones.firstUpgrade.playSeconds);
    assert.ok(guided.playSeconds <= baseline.playSeconds, 'optional rewards must not delay the tested strategy');
    assert.ok(guided.playSeconds >= baseline.playSeconds * 0.65, 'grants supplement progression without removing more than 35% of the session');
    for (let i = 1; i < guided.machines.length; i++) {
      assert.ok(guided.machines[i].playSeconds > guided.machines[i - 1].playSeconds, 'no two devices are skipped through at the same instant');
    }
    assert.equal(guided.questRewardCount, guided.questClaims.length);
    assert.equal(new Set(guided.questClaims.map(claim => claim.id)).size, guided.questRewardCount);
    assert.equal(guided.questRewardCoins, guided.questClaims.reduce((sum, claim) => sum + claim.coins, 0));
    for (const claim of guided.questClaims) {
      assert.ok(Number.isFinite(claim.coins) && claim.coins > 0);
      assert.ok(Math.abs(claim.afterCoins - claim.before.coins - claim.coins) <= Math.max(1e-6, claim.coins * 1e-10));
    }
    const mainOrderCoins = guided.orders.reduce((sum, order) => sum + order.coins, 0);
    assert.ok(guided.questRewardCoins < mainOrderCoins * 0.1, 'one-time task grants remain secondary to order income');
    if (tapsPerSecond > 0) {
      assert.deepEqual(guided.questClaims.map(claim => claim.id).sort(), [...allQuestIds].sort(), 'ordinary active play reaches and collects the entire handbook');
    } else {
      const firstChapterIds = new Set(chapters[0].quests.map(quest => quest.id));
      assert.equal(guided.questRewardCount, 3, 'the optional click lesson remains unclaimed by a zero-click policy');
      assert.ok(guided.questClaims.every(claim => firstChapterIds.has(claim.id)));
    }
  });
}

for (const highAds of [false, true]) {
  test((highAds ? 'combined ads' : 'permanent ads only') + ': ordinary play still completes every growth task', () => {
    const route = simulate({ name: 'guided cooperation', permanentAds: true, highAds, collectQuests: true });
    assert.equal(route.completed, true);
    assert.deepEqual(route.questClaims.map(claim => claim.id).sort(), [...allQuestIds].sort());
    assert.equal(route.questRewardCount, allQuestIds.length);
    assert.equal(route.wallSeconds, route.playSeconds + route.rewardCount * 30);
    for (const claim of route.questClaims) {
      assert.ok(Math.abs(claim.afterCoins - claim.before.coins - claim.coins) <= Math.max(1e-6, claim.coins * 1e-10));
    }
  });
}

// Run this file directly to obtain the reproducible policy comparison used in
// the design review. These are deterministic simulations, not user predictions.
if (require.main === module && !process.env.NODE_TEST_CONTEXT) {
  process.stdout.write(JSON.stringify(comparisons.map(({ name, baseline, guided }) => ({
    name,
    baselineSeconds: baseline.playSeconds,
    guidedSeconds: guided.playSeconds,
    reductionPercent: Math.round((1 - guided.playSeconds / baseline.playSeconds) * 10000) / 100,
    firstUpgradeBeforeSeconds: baseline.milestones.firstUpgrade.playSeconds,
    firstUpgradeAfterSeconds: guided.milestones.firstUpgrade.playSeconds,
    questRewardCount: guided.questRewardCount,
    questRewardCoins: guided.questRewardCoins,
    machines: guided.machines
  })), null, 2) + '\n');
}
