'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core.js');
const { simulate } = require('./balance.cjs');
const chapters = new Game({ now: 1000000 }).getView().quests.chapters;
const allQuestIds = chapters.flatMap(chapter => chapter.quests.map(quest => quest.id));

for (const tapsPerSecond of [2, 1, 0]) {
  test(`automatic growth rewards: ${tapsPerSecond} requested taps/sec keeps a complete free route`, () => {
    const route = simulate({ name: 'automatic growth', tapsPerSecond });
    assert.equal(route.completed, true); assert.equal(route.rewardCount, 0);
    assert.equal(route.assumptions.collectQuests, 'automatic');
    assert.equal(route.orders.length, CONFIG.orders.length); assert.equal(route.machines.length, CONFIG.machines.length);
    assert.ok(route.milestones.firstUpgrade.playSeconds > 0);
    assert.equal(route.questRewardCount, route.questClaims.length);
    assert.equal(new Set(route.questClaims.map(claim => claim.id)).size, route.questRewardCount, 'growth goals pay once');
    assert.equal(route.questRewardCoins, route.questClaims.reduce((sum, claim) => sum + claim.coins, 0));
    assert.ok(route.questClaims.every(claim => claim.automatic && Number.isFinite(claim.coins) && claim.coins > 0));
    const mainOrderCoins = route.orders.reduce((sum, order) => sum + order.coins, 0);
    assert.ok(route.questRewardCoins < mainOrderCoins, 'growth rewards supplement the contract economy');
    if (tapsPerSecond > 0) assert.deepEqual(route.questClaims.map(claim => claim.id).sort(), [...allQuestIds].sort());
    else {
      assert.equal(route.successfulTaps, 0);
      assert.ok(!route.questClaims.some(claim => claim.id === 'start-taps'), 'automatic play does not invent manual inputs');
    }
  });
}

test('legacy collectQuests flag cannot add a duplicate reward or change the simulation', () => {
  const ordinary = simulate({ name: 'ordinary' }), compatibility = simulate({ name: 'legacy caller', collectQuests: true });
  assert.equal(ordinary.playSeconds, compatibility.playSeconds);
  assert.equal(ordinary.final.coins, compatibility.final.coins);
  assert.deepEqual(ordinary.questClaims, compatibility.questClaims);
});

for (const highAds of [false, true]) {
  test(`${highAds ? 'combined' : 'permanent'} ads preserve automatic one-time growth rewards`, () => {
    const route = simulate({ name: 'cooperation', permanentAds: true, highAds });
    assert.equal(route.completed, true);
    assert.deepEqual(route.questClaims.map(claim => claim.id).sort(), [...allQuestIds].sort());
    assert.equal(route.questRewardCount, allQuestIds.length);
    assert.ok(route.questClaims.every(claim => claim.automatic));
    assert.equal(route.wallSeconds, route.playSeconds + route.rewardCount * 30);
  });
}
