import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { Game, CONFIG } = require('../src/core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = 1800000000000;
const copy = value => JSON.parse(JSON.stringify(value));

function conserved(state) {
  const work = Object.values(state.stations).reduce((sum, station) => sum + station.jobs.reduce((n, job) => n + (job ? job.amount : 0), 0), 0);
  const inputs = (state.inputs?.cup || 0) + (state.inputs?.ship || 0);
  assert.equal(state.totalProduced, state.totalSold + state.buffers.pop + state.buffers.cup + inputs + work);
  assert.equal(state.totalEarned, state.totalSold * CONFIG.price);
  assert.equal(state.coins + state.totalSpent, state.totalEarned);
}

function fixture(id, kind, description, game, extra = {}) {
  const save = game.exportSave(NOW);
  conserved(save);
  const mode = game.mode === 'v15' ? 'v15' : 'baseline';
  const storageKey = mode === 'v15' ? CONFIG.automation.saveKey : 'little_popcorn_factory_pipeline_v2';
  const restored = new Game({ save, now: NOW, mode: mode === 'v15' ? 'v15' : null });
  assert.equal(restored.loadWarning, null, id + ': the actual save validator accepts this fixture');
  assert.deepEqual(restored.exportSave(NOW), save, id + ': restoring does not change this settled state');
  const snapshot = restored.getView();
  return { id, kind, description, mode, storageKey, save, snapshot,
    events: game.drainEvents(),
    expected: { machine: 0, buffers: copy(save.buffers),
      stations: snapshot.stations.map(({ id, status, jobs }) => ({ id, status, jobs })),
      coins: save.coins, totalSold: save.totalSold }, ...extra };
}

function automationFixtures() {
  const cases = [fixture('v15-fresh', 'natural-production',
    'New v1.5 factory: both transport routes disconnected and both input pockets empty.', new Game({ mode: 'v15', now: NOW }))];
  const manual = new Game({ mode: 'v15', now: NOW });
  const budget = Object.values(CONFIG.automation.routes).reduce((sum, route) => sum + route.cost, 0)
    + CONFIG.automation.logisticsLevels[1].cost + 100;
  // Earn every coin through the production core. The fixture performs ordinary
  // batch transfers and one affordable cup upgrade; it never injects balances,
  // purchases automation, or bypasses the inputs and processing stages.
  for (let step = 1; step <= 2400 && manual.state.coins < budget; step++) {
    manual.tick(.5);
    if (step % 10 === 0 || step === 2 || step === 6) for (const source of ['pop', 'cup']) {
      const claim = manual.reserveTransfer(source);
      if (claim.ok) assert.equal(manual.commitTransfer(claim.token).ok, true);
    }
    if (manual.state.upgrades.cup === 0 && manual.getView().stations.find(item => item.id === 'cup').upgrade.available)
      assert.equal(manual.buyUpgrade('cup').ok, true);
    conserved(manual.state);
    manual.drainEvents();
  }
  assert.ok(manual.state.coins >= budget, 'manual fixture reaches purchase funds through real sales');
  assert.ok(Object.values(manual.state.connections).every(item => !item.automated));
  cases.push(fixture('v15-purchase-ready', 'natural-production',
    'Real manual play has earned enough coins to buy both independent automation routes and the first logistics upgrade through the normal UI; neither route is purchased.', manual,
    { action: { automationSources: ['pop', 'cup'], logisticsUpgrade: true }, earnedBy: 'real tick, reserveTransfer, commitTransfer, first cup upgrade' }));
  const automated = new Game({ mode: 'v15', save: manual.exportSave(NOW), now: NOW });
  for (const source of ['pop', 'cup']) assert.equal(automated.buyAutomation(source).ok, true);
  automated.tick(CONFIG.automation.trialSeconds + 60);
  assert.equal(automated.getView().automaticTrial.complete, true);
  cases.push(fixture('v15-automated', 'natural-production',
    'Both routes were purchased with real sale income, then ran without manual input for the full automatic trial plus 60 seconds.', automated));
  return cases;
}

// These are test data for the real production contract, never a replacement
// renderer or an alternate game entry. This module reads no browser storage.
export function createVisualFixtures() {
  const cases = [];
  cases.push(fixture('fresh-shortage', 'natural-production',
    'Fresh first-generation factory: no invented stock; cup and ship wait for real input.', new Game({ now: NOW })));

  const full = new Game({ now: NOW }); full.tick(20); full.drainEvents();
  cases.push(fixture('pop-full', 'natural-production',
    'Twenty seconds of normal play: pop buffer 12/12 and one completed pop job blocked at its output.', full));

  const upgrade = new Game({ now: NOW }); upgrade.tick(20.1); upgrade.drainEvents();
  const oldJob = copy(upgrade.state.stations.cup.jobs[0]);
  assert.deepEqual(oldJob, { amount: 1, durationTicks: 60, remainingTicks: 18 });
  cases.push(fixture('first-cup-before', 'natural-production',
    'Real first cup upgrade quote: existing cup batch is 70% complete and 30 coins are affordable.', upgrade,
    { expectedOldCupJob: oldJob, action: { station: 'cup', upgradeLevel: 1, cost: 30 } }));
  assert.equal(upgrade.buyUpgrade('cup').ok, true);
  assert.deepEqual(upgrade.state.stations.cup.jobs[0], oldJob);
  cases.push(fixture('first-cup-after', 'natural-production',
    'Actual purchased first cup upgrade: old batch amount and 60-tick duration remain unchanged; new batches use 20 ticks.', upgrade,
    { expectedOldCupJob: oldJob, expectedPurchaseFeedback: '快速装杯头', expectedCollapsed: true }));

  upgrade.tick(12);
  for (let i = 0; i < 120 && upgrade.getView().stations.find(station => station.id === 'cup').status !== 'waiting'; i++) upgrade.tick(1 / CONFIG.ticksPerSecond);
  assert.equal(upgrade.getView().stations.find(station => station.id === 'cup').status, 'waiting');
  upgrade.drainEvents();
  cases.push(fixture('upgraded-shortage', 'natural-production',
    'After the real first cup upgrade consumes the backlog, the faster cup head stops while waiting for upstream material.', upgrade));

  const boundary = new Game({ now: NOW }).exportSave(NOW);
  boundary.buffers = { pop: 12, cup: 12 };
  boundary.stations.pop.jobs = [{ amount: 1, durationTicks: 30, remainingTicks: 0 }];
  boundary.stations.cup.jobs = [{ amount: 1, durationTicks: 60, remainingTicks: 0 }];
  boundary.stations.ship.jobs = [{ amount: 1, durationTicks: 20, remainingTicks: 20 }];
  boundary.totalProduced = 27;
  boundary.stations.pop.processed = 26;
  boundary.stations.cup.processed = 13;
  cases.push(fixture('both-full-boundary', 'conserved-visual-boundary',
    'Explicit visual boundary fixture accepted by Game: both bins 12/12, pop and cup each retain a completed job. Normal first-generation rates cannot naturally fill the cup bin; this is not claimed as naturally reached play.',
    new Game({ save: boundary, now: NOW }),
    { boundaryOnly: true, changesOnNextShipment: true }));

  cases.push(...automationFixtures());

  return { version: 2, scope: 'first-generation-visual-acceptance', generatedFrom: 'src/core.js',
    modes: ['baseline', 'v15'],
    storagePolicy: 'Use only in an isolated acceptance origin/context. Never load, clear, replace or migrate the user\'s existing localStorage or mini-game save.',
    entryPolicy: 'Run the built web/index.html and game.bundle.js. Fixture JSON is input data, not a preview UI.',
    viewports: [{ width: 390, height: 844 }, { width: 320, height: 524 }],
    safeAreaCases: [{ width: 390, height: 844, cssInsets: { top: 75, bottom: 40, left: 0, right: 0 } },
      { width: 320, height: 524, cssInsets: { top: 75, bottom: 40, left: 0, right: 0 } }],
    coverageBoundary: 'Only generation 1 uses the new visual acceptance scope. Generations 2–6 retain existing saves and gameplay and are not claimed as fully reskinned.',
    cases };
}

export async function writeVisualFixtures(directory = path.join(ROOT, 'output/visual-acceptance/fixtures')) {
  const report = createVisualFixtures();
  await mkdir(directory, { recursive: true });
  for (const item of report.cases) await writeFile(path.join(directory, item.id + '.json'), JSON.stringify(item, null, 2) + '\n');
  const index = { ...report, cases: report.cases.map(({ id, kind, description, mode, storageKey }) => ({ id, kind, description, mode, storageKey, file: id + '.json' })) };
  await writeFile(path.join(directory, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  return { directory, cases: report.cases.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const flag = process.argv.indexOf('--out');
  const result = await writeVisualFixtures(flag >= 0 ? path.resolve(process.argv[flag + 1]) : undefined);
  console.log(`Prepared ${result.cases} validated visual fixtures in ${result.directory}`);
  console.log('No browser launched. No existing browser or mini-game storage read or modified.');
}
