'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/core');
const { ProductionInsights } = require('../src/production-insights');
const { deepFreeze } = require('./canvas-harness.cjs');

const manualGame = () => new Game({ experiment: 'manual-transfer-p0', now: 0 });
const offer = (view, id) => view.stations.find(station => station.id === id).upgrade;
function transfer(game) {
  const reserved = game.reserveTransfer();
  assert.equal(reserved.ok, true);
  const committed = game.commitTransfer(reserved.token);
  assert.equal(committed.ok, true);
  assert.ok(committed.amount > 0);
  return committed.amount;
}

test('manual transport has zero unattended output and explains idle cup as a transport constraint', () => {
  const game = manualGame(), insights = new ProductionInsights();
  let view = insights.enrich(game.getView());
  assert.equal(view.insights.stableRate, 0);
  assert.equal(view.insights.stableRateLabel, '无人操作基线');
  assert.equal(view.insights.manualTransfer, true);
  assert.equal(view.insights.sampling.includesManualInput, true);
  assert.match(view.insights.sampling.label, /含手动搬运/);
  game.tick(30);
  view = insights.enrich(game.getView());
  assert.equal(view.throughput, 0);
  assert.equal(view.state.totalSold, 0);
  assert.equal(view.insights.bottleneck.status, 'transport');
  assert.equal(view.insights.bottleneck.transportId, 'A');
  assert.equal(view.insights.bottleneck.stationId, null);
  assert.match(view.insights.bottleneck.label, /等待手动补料/);
  for (const station of view.stations) {
    assert.equal(station.upgrade.lineBefore, 0);
    assert.equal(station.upgrade.lineAfter, 0);
    assert.equal(station.upgrade.lineImproves, false);
    assert.match(station.upgrade.lineMessage, /不接通自动运输/);
  }
});

test('a real committed batch changes immediate guidance and measured sales without changing unattended baseline', () => {
  const game = manualGame(), insights = new ProductionInsights();
  game.tick(3);
  let view = insights.enrich(game.getView());
  assert.match(view.insights.bottleneck.label, /等待手动补料/);
  const moved = transfer(game);
  assert.equal(game.state.totalSold, 0, 'transfer itself cannot sell any portions');
  view = insights.enrich(game.getView());
  assert.match(view.insights.bottleneck.label, /本批加工中/, 'guidance responds at the same simulation tick');
  game.tick(3);
  view = insights.enrich(game.getView());
  assert.equal(game.state.totalSold, moved);
  assert.ok(view.throughput > 0, 'actual output includes the real manually supplied batch');
  assert.equal(view.insights.stableRate, 0);
  assert.match(view.insights.previewMethod, /实测出货包含已经手动投送/);
  game.tick(20);
  view = insights.enrich(game.getView());
  assert.equal(view.throughput, 0, 'finite manual stock cannot sustain unattended production');
  assert.equal(game.state.totalSold, moved);
  assert.match(view.insights.sampling.label, /近10秒实测.*含手动搬运/);
});

test('a legitimately earned machine upgrade does not promise or enable unattended transport', () => {
  const game = manualGame(), insights = new ProductionInsights();
  for (let batch = 0; game.state.coins < 30 && batch < 10; batch++) {
    game.tick(7);
    transfer(game);
  }
  game.tick(7);
  assert.ok(game.state.coins >= 30);
  assert.equal(game.buyUpgrade('cup').ok, true);
  let view = insights.enrich(game.getView());
  assert.equal(view.stations.find(station => station.id === 'cup').capacity, 6);
  assert.equal(view.insights.stableRate, 0);
  assert.equal(offer(view, 'cup').lineAfter, 0, 'locked next-stage preview also preserves the manual edge');
  assert.match(offer(view, 'cup').lineMessage, /无人操作基线仍为0/);
  game.tick(40);
  const sold = game.state.totalSold;
  game.tick(30);
  view = insights.enrich(game.getView());
  assert.equal(game.state.totalSold, sold);
  assert.equal(view.throughput, 0);
  assert.match(view.insights.bottleneck.label, /等待手动补料/);
});

test('transport-aware forecast cache separates legacy play and never changes frozen snapshots or reservations', () => {
  const insights = new ProductionInsights(), legacy = new Game({ now: 0 }), game = manualGame();
  assert.equal(insights.enrich(legacy.getView()).insights.stableRate, 2);
  assert.equal(insights.enrich(game.getView()).insights.stableRate, 0);
  assert.equal(offer(insights.enrich(legacy.getView()), 'cup').lineAfter, 4);

  game.tick(3);
  const reservation = game.reserveTransfer();
  assert.equal(reservation.ok, true);
  const snapshot = deepFreeze(game.getView());
  const originalSnapshot = JSON.stringify(snapshot);
  const originalState = JSON.stringify(game.state), originalEvents = JSON.stringify(game.events);
  let view;
  for (let frame = 0; frame < 300; frame++) view = insights.enrich(snapshot);
  assert.equal(view.insights.stableRate, 0);
  view.insights.bottleneck.stationIds.push('fake');
  assert.deepEqual(insights.enrich(snapshot).insights.bottleneck.stationIds, []);
  assert.equal(JSON.stringify(snapshot), originalSnapshot);
  assert.equal(JSON.stringify(game.state), originalState);
  assert.equal(JSON.stringify(game.events), originalEvents);
  assert.equal(game.commitTransfer(reservation.token).ok, true, 'display prediction leaves the held batch available');
  const restored = insights.enrich(legacy.getView());
  assert.equal(restored.insights.stableRate, 2);
  assert.equal(offer(restored, 'cup').lineAfter, 4);
  assert.equal(restored.insights.manualTransfer, false);
});
