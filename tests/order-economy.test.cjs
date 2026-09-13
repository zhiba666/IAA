'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runEconomySimulation, runOnboarding, runContinuation } = require('../tools/order-economy.cjs');

test('order economy earns basic automation on active, infrequent and non-optimal routes and sustains newly produced sales', () => {
  const result = runEconomySimulation({ seconds: 180 });
  const [active, low, nonOptimal] = result.onboarding;
  for (const route of result.onboarding) {
    assert.ok(route.firstSaleSeconds > 0);
    assert.ok(route.basicAutomationSeconds < 900, route.strategy);
    assert.equal(route.coins + route.spent, route.earned);
    assert.ok(route.manualTransfers >= 2, 'both segments receive their manual introduction');
    assert.equal(route.purchases.filter(item => item.item.startsWith('automation:')).length, 2);
    assert.equal(route.purchases.filter(item => item.item === 'salesperson').length, 1);
  }
  assert.ok(active.basicAutomationSeconds < low.basicAutomationSeconds);
  assert.ok(nonOptimal.spent > active.spent);
  assert.ok(nonOptimal.basicAutomationSeconds > active.basicAutomationSeconds);
  assert.ok(result.continuations[0].earned >= result.continuations[2].earned, 'active input must not be economically harmful');
  for (const route of result.continuations) {
    assert.ok(route.last60Seconds.producedUnits > 0);
    assert.ok(route.last60Seconds.completedOrders > 0);
    assert.ok(route.longestNoSaleSeconds < 60);
    assert.ok(route.paybackSeconds > 0 && route.paybackSeconds <= 180);
  }
  assert.equal(result.continuations[2].interactionRounds, 0);
  assert.equal(result.continuations[2].manualTransfers, 0);
  assert.equal(result.continuations[2].manualDeliveries, 0);
  assert.equal(result.continuations[2].acceptedAssists, 0);
});

test('the same legally purchased automation snapshot produces identical unattended economy results', () => {
  const { save } = runOnboarding('自动化基准', { interval: .5, assist: true });
  const before = JSON.stringify(save);
  const a = runContinuation('重放', save, { seconds: 120 });
  const b = runContinuation('重放', save, { seconds: 120 });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(save), before, 'comparison must not alter the shared starting save');
});
