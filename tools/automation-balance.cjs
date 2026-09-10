'use strict';
const assert = require('node:assert/strict');
const { Game } = require('../src/core');

function conserved(game) {
  const s = game.state;
  const wip = Object.values(s.stations).reduce((sum, station) => sum + station.jobs.reduce((n, job) => n + (job ? job.amount : 0), 0), 0);
  assert.equal(s.totalProduced, s.totalSold + s.buffers.pop + s.buffers.cup + s.inputs.cup + s.inputs.ship + wip);
  assert.equal(s.coins + s.totalSpent, s.totalEarned);
}
function runStrategy(name, interval, nonOptimal = false) {
  const game = new Game({ mode: 'v15', now: 0 });
  const result = { strategy: name, firstSale: null, firstAutomation: null, secondAutomation: null, firstExpansion: null, manualTransfers: 0 };
  let lastSource = 'cup';
  function move(source) {
    if (game.state.connections[source].automated) return;
    const reservation = game.reserveTransfer(source);
    if (reservation.ok && game.commitTransfer(reservation.token).ok) result.manualTransfers++;
  }
  for (let quarter = 1; quarter <= 4800; quarter++) {
    game.tick(.25);
    const time = quarter / 4;
    if (time === 1) move('pop');
    if (time === 3) move('cup');
    if (quarter % (interval * 4) === 0) {
      const manual = ['pop', 'cup'].filter(source => !game.state.connections[source].automated);
      const source = manual.length === 1 ? manual[0] : lastSource === 'pop' ? 'cup' : 'pop';
      move(source); lastSource = source;
    }
    if (quarter % 4 === 0) {
      const s = game.state;
      if (nonOptimal && s.upgrades.pop === 0) game.buyUpgrade('pop');
      else if (s.upgrades.cup === 0) game.buyUpgrade('cup');
      else if (interval >= 8 && s.logisticsLevel === 0) game.buyLogisticsUpgrade();
      else if (!s.connections.pop.automated) game.buyAutomation('pop');
      else if (!s.connections.cup.automated) game.buyAutomation('cup');
      else if (s.upgrades.cup < 2) game.buyUpgrade('cup');
      else if (game.evolve().ok) result.firstExpansion = time;
      conserved(game);
    }
    for (const event of game.drainEvents()) {
      if (event.type === 'first-sale' && result.firstSale === null) result.firstSale = event.playedSeconds;
      if (event.type === 'automation') {
        if (result.firstAutomation === null) result.firstAutomation = event.playedSeconds;
        else result.secondAutomation = event.playedSeconds;
      }
    }
    if (result.firstExpansion !== null) break;
  }
  assert.notEqual(result.firstExpansion, null, `${name} must progress`);
  const sold = game.state.totalSold;
  game.tick(60);
  result.unattended60SecondsSold = game.state.totalSold - sold;
  assert.ok(result.unattended60SecondsSold > 0);
  conserved(game);
  const restored = new Game({ mode: 'v15', save: game.exportSave(0), now: 86400000 });
  assert.equal(restored.loadWarning, null);
  return result;
}
function runFullProgression() {
  const game = new Game({ mode: 'v15', now: 0 });
  const stages = [{ machine: 0, seconds: 0 }];
  for (let step = 0; step < 2000 && game.state.machine < 5; step++) {
    game.tick(5);
    for (const source of ['pop', 'cup']) if (!game.state.connections[source].automated) {
      const claim = game.reserveTransfer(source);
      if (claim.ok) game.commitTransfer(claim.token);
    }
    if (game.state.upgrades.cup === 0) game.buyUpgrade('cup');
    else if (!game.state.connections.pop.automated) game.buyAutomation('pop');
    else if (!game.state.connections.cup.automated) game.buyAutomation('cup');
    else {
      for (const id of ['cup', 'pop', 'ship']) game.buyUpgrade(id);
      if (game.evolve().ok) stages.push({ machine: game.state.machine, seconds: game.state.playedSeconds });
    }
    conserved(game);
    if (step % 41 === 0) assert.equal(new Game({ mode: 'v15', save: game.exportSave(0), now: 1e12 }).loadWarning, null);
    game.drainEvents();
  }
  assert.equal(game.state.machine, 5);
  game.tick(1000);
  for (const id of ['cup', 'pop', 'ship']) game.buyUpgrade(id);
  game.tick(60);
  assert.ok(game.getView().throughput >= 95);
  conserved(game);
  return { stages, finalRate: game.getView().throughput };
}
if (require.main === module) {
  console.log(JSON.stringify([
    runStrategy('积极操作：每5秒一段', 5),
    runStrategy('低频操作：每8秒一段，优先扩容', 8),
    runStrategy('非最优：先买爆锅，每6秒一段', 6, true)
  ], null, 2));
  console.log(JSON.stringify({ fullProgression: runFullProgression() }, null, 2));
}
module.exports = { runStrategy, runFullProgression, conserved };
