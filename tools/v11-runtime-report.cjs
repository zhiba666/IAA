'use strict';

// Read actual acceptance artifacts only. This tool never draws, changes a
// screenshot, advances the QA clock, or drives the production application.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'output/v11-runtime');
const CAPTURES = path.join(OUTPUT, 'captures');
const VIEWPORTS = [{ width: 320, height: 524 }, { width: 360, height: 640 }, { width: 390, height: 844 }, { width: 430, height: 932 }];
// These filenames were identified by the operator who ran the visible
// fail=1 -> Settings -> Reload art -> Close sequence. They are evidence
// labels, not a blanket exception for any capture with a failed image.
const FAILURE_CASES = [{
  id: 'g6-430-first-load-retry', fixture: 'g6-upgraded', viewport: VIEWPORTS[3], safeArea: { top: 24, bottom: 24 },
  failedFile: 'g6-upgraded-430x932-safe24-1789047031994.json',
  recoveredFile: 'g6-upgraded-430x932-safe24-1789047072798.json', assetId: 'machine_cup_hex_body',
  operatorContext: 'Visible Chrome acceptance run with ?fail=1; one asset failed, then Settings > Reload art > Close.'
}];
const REPRESENTATIVE_HOMES = [
  ['g1-entry', VIEWPORTS[0]], ['g6-upgraded', VIEWPORTS[0]],
  ['g1-connections-10', VIEWPORTS[1]], ['g1-connections-11', VIEWPORTS[2]], ['g6-upgraded', VIEWPORTS[3]]
];
const hash = value => createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const sorted = values => values.slice().sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const round = n => Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : n;
const escapeHTML = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeName = name => /^[a-zA-Z0-9_-]+\.(png|json|webm)$/.test(name);
const sizeKey = value => value && value.width + 'x' + value.height;
const insetKey = value => ['top', 'right', 'bottom', 'left'].map(key => Number.isFinite(value && value[key]) ? value[key] : 0).join(',');

function rect(value) {
  if (Array.isArray(value)) return value.length === 4 ? value.map(round) : null;
  return value && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(value[key])) ? ['x', 'y', 'w', 'h'].map(key => round(value[key])) : null;
}
function point(value) { return Array.isArray(value) && value.length === 2 ? value.map(round) : null; }
function validRect(value) { return value && value.length === 4 && value.every(Number.isFinite) && value[2] > 0 && value[3] > 0; }
function inRect(inner, outer) {
  const e = 1e-5;
  return validRect(inner) && validRect(outer) && inner[0] >= outer[0] - e && inner[1] >= outer[1] - e &&
    inner[0] + inner[2] <= outer[0] + outer[2] + e && inner[1] + inner[3] <= outer[1] + outer[3] + e;
}
function overlaps(a, b) { return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1]; }

// Quantities, job progress, selected highlights, installed heads, hit acceptance,
// ghost coordinates and purchase quotes are deliberately not geometric drift.
function geometryProjection(diagnostic) {
  const presentation = diagnostic.presentation || {}, scene = presentation.scene || {}, layout = presentation.layout || {};
  const overlay = layout.overlayLayout || {};
  return {
    scene: rect(layout.scene), frame: rect(scene.frame), content: rect(scene.content),
    hud: Object.entries(layout.hud || {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => ({ id, rect: rect(value) })),
    overlay: ['topInset', 'bottomInset', 'leftInset', 'rightInset'].map(key => round(overlay[key])),
    exclusions: (overlay.exclusionRects || []).map(value => ({ id: value.id, rect: rect(value) })).sort((a, b) => a.id.localeCompare(b.id)),
    machines: (scene.machines || []).map(value => ({ id: value.stationId, rect: rect(value.rect),
      input: point(value.ports && value.ports.input), output: point(value.ports && value.ports.output) })).sort((a, b) => a.id.localeCompare(b.id)),
    warehouses: (scene.buffers || []).map(value => ({ id: value.id, rect: rect(value.rect) })).sort((a, b) => a.id.localeCompare(b.id)),
    transfers: (scene.transfers || []).map(value => ({ source: value.source && value.source.source, target: value.target && value.target.target,
      tray: rect(value.source), inlet: rect(value.target), physicalInput: rect(value.physicalInput),
      inputPoint: point(value.inputPoint), machineInputPoint: point(value.machineInputPoint) })).sort((a, b) => String(a.source).localeCompare(String(b.source)))
  };
}

function differences(a, b, at = '') {
  if (same(a, b)) return [];
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return [{ path: at, before: a, after: b }];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => differences(a[key], b[key], at ? at + '.' + key : key)).slice(0, 40);
}

function stateLabel(d) {
  const p = d.presentation || {};
  if (p.modal) return 'modal:' + p.modal.type + (p.modal.stationId ? ':' + p.modal.stationId : '');
  if (p.transfer) return 'held:' + (p.transfer.source === 'pop' ? 'A' : 'B') + (p.transfer.overTarget ? ':valid-target' : ':outside-target');
  if (p.tutorial) return 'tutorial:' + (p.tutorial.source === 'pop' ? 'A' : 'B');
  return 'home';
}

function expectedFailureEvidence(d, context, id) {
  const art = d.presentation && d.presentation.art || {};
  const failed = (art.entries || []).filter(entry => entry.status === 'failed');
  const declared = FAILURE_CASES.find(item => item.failedFile === id.split('#')[0] && item.fixture === d.fixture &&
    same(item.viewport, d.viewSize) && insetKey(item.safeArea) === insetKey(d.safeArea));
  const allowed = declared && failed.length === 1 && failed[0].id === declared.assetId &&
    art.requested === 87 && art.loaded === 86 && art.failed === 1 && art.pending === 0;
  const start = Date.parse(d.bundleReadAt), end = Date.parse(d.capturedAt);
  const requests = context.requests.filter(request => request.status === 503 && /\/machine_cup_hex_body\.png$/.test(request.path || '') &&
    Date.parse(request.at) >= start - 1000 && Date.parse(request.at) <= end + 1000);
  const explainedErrors = (d.errors || []).every(error => error.type === 'error' &&
    (/machine_cup_hex_body\.png/.test(error.file || '') || error.message === 'Resource failed'));
  return allowed && requests.length && explainedErrors ? { caseId: declared.id, asset: failed[0].id, requests, status: 'EXPECTED_FAILURE',
    operatorContext: declared.operatorContext,
    note: 'Exact operator-declared capture and matching 503 request; excluded from normal PASS coverage.' } : null;
}

function analyzeDiagnostic(d, context, id) {
  const checks = [], check = (code, passed, detail) => checks.push({ code, passed: !!passed, ...(detail === undefined ? {} : { detail }) });
  const s = d.snapshot && d.snapshot.state || {}, p = d.presentation || {}, art = p.art || {}, scene = p.scene || {};
  const viewport = d.viewSize || {}, full = [0, 0, viewport.width, viewport.height];
  const geometry = geometryProjection(d), expectedFailure = expectedFailureEvidence(d, context, id);
  check('runtime-version', d.runtimeVersion === '1.1.0', d.runtimeVersion);
  check('current-bundle-sha', d.bundleSha256 === context.bundleSha256 && context.bundlesEqual, d.bundleSha256);
  check('bundle-byte-count', d.bundleBytes === context.bundleBytes, d.bundleBytes);
  check('capture-timestamp', Number.isFinite(Date.parse(d.capturedAt)), d.capturedAt);
  check('qa-clock', typeof d.paused === 'boolean' && Number.isFinite(d.qaClockMs) && d.qaClockMs >= 0, { paused: d.paused, qaClockMs: d.qaClockMs });
  check('four-size-viewport', VIEWPORTS.some(size => same(size, viewport)), viewport);
  check('full-logical-canvas', same(rect(p.layout && p.layout.scene), full) && same(rect(scene.frame), full), { layout: geometry.scene, frame: geometry.frame });
  const assetEntries = art.entries || [];
  check('runtime-resource-identities', assetEntries.length === 87 && same(sorted(assetEntries.map(entry => entry.id)), context.assetIds));
  check('runtime-resource-status-counts', assetEntries.filter(entry => entry.status === 'loaded').length === art.loaded &&
    assetEntries.filter(entry => entry.status === 'failed').length === art.failed &&
    assetEntries.every(entry => entry.status === 'loaded' || entry.status === 'failed') && art.pending === 0);
  check('runtime-resource-dimensions', assetEntries.every(entry => {
    const expected = context.assets[entry.id];
    return expected && entry.path === expected.path && (entry.status !== 'loaded' || entry.width === expected.width && entry.height === expected.height);
  }));
  check('runtime-resource-sha', Object.keys(d.assetShas || {}).length === 87 && context.assetIds.every(assetId => d.assetShas[assetId] === context.assets[assetId].sha256));
  check('runtime-resources-loaded', art.requested === 87 && art.loaded === 87 && art.pending === 0 && art.failed === 0 && art.complete === true,
    { requested: art.requested, loaded: art.loaded, pending: art.pending, failed: art.failed });
  check('runtime-errors', Array.isArray(d.errors) && d.errors.length === 0, d.errors);
  const bufferValues = Object.values(s.buffers || {}), inputValues = Object.values(s.inputs || {}), stationValues = Object.values(s.stations || {});
  const jobs = stationValues.flatMap(station => Array.isArray(station.jobs) ? station.jobs.filter(Boolean) : []);
  const counts = [...bufferValues, ...inputValues, ...jobs.map(job => job.amount), s.totalProduced, s.totalSold, s.coins, s.totalSpent, s.totalEarned];
  check('stock-account-shape', s.version === 4 && bufferValues.length === 2 && inputValues.length === 2 && stationValues.length === 3 &&
    stationValues.every(station => Array.isArray(station.jobs)) && counts.every(value => Number.isSafeInteger(value) && value >= 0));
  const sum = values => values.reduce((a, b) => a + b, 0);
  const inventory = { produced: s.totalProduced, sold: s.totalSold, buffers: sum(bufferValues), inputs: sum(inputValues), workInProgress: sum(jobs.map(job => job.amount)) };
  inventory.accounted = inventory.sold + inventory.buffers + inventory.inputs + inventory.workInProgress;
  check('inventory-conservation', inventory.produced === inventory.accounted, inventory);
  check('coin-conservation', s.coins + s.totalSpent === s.totalEarned, { coins: s.coins, spent: s.totalSpent, earned: s.totalEarned });
  check('three-machine-identities', same(geometry.machines.map(item => item.id), ['cup', 'pop', 'ship']));
  check('two-warehouse-identities', same(geometry.warehouses.map(item => item.id), ['cup', 'pop']));
  check('two-inlet-identities', same(geometry.transfers.map(item => [item.source, item.target]), [['cup', 'ship'], ['pop', 'cup']]));
  const objects = [...geometry.machines.map(item => item.rect), ...geometry.warehouses.map(item => item.rect),
    ...geometry.transfers.flatMap(item => [item.tray, item.inlet, item.physicalInput])];
  check('scene-object-bounds', objects.every(value => inRect(value, full) && inRect(value, geometry.content)));
  check('inlet-touch-size', geometry.transfers.every(item => validRect(item.inlet) && item.inlet[2] >= 64 && item.inlet[3] >= 64));
  check('inlets-clear-warehouses', geometry.transfers.every(item => validRect(item.inlet) && geometry.warehouses.every(warehouse => validRect(warehouse.rect) && !overlaps(item.inlet, warehouse.rect))));
  const safe = d.safeArea || {}, safeBounds = [Number(safe.left) || 0, Number(safe.top) || 0,
    viewport.width - (Number(safe.left) || 0) - (Number(safe.right) || 0), viewport.height - (Number(safe.top) || 0) - (Number(safe.bottom) || 0)];
  check('hud-safe-bounds', geometry.hud.length > 0 && geometry.hud.every(item => inRect(item.rect, safeBounds)));
  const capsuleExclusions = geometry.exclusions.filter(item => /capsule|menu/i.test(item.id));
  check('hud-capsule-exclusion', capsuleExclusions.every(exclusion => validRect(exclusion.rect) &&
    geometry.hud.every(item => validRect(item.rect) && !overlaps(item.rect, exclusion.rect))),
  { capturedCapsuleExclusions: capsuleExclusions.length, note: capsuleExclusions.length ? 'Only captured exclusion geometry checked.' : 'This capture has no native capsule geometry; native capsule validation is outside Chrome screenshot evidence.' });
  if (p.modal) {
    const modal = p.layout && p.layout.modal, modalRect = rect(modal), top = p.layout.hud && p.layout.hud.coin && p.layout.hud.coin.y;
    const centerX = safeBounds[0] + safeBounds[2] / 2, centerY = (top + viewport.height - (Number(safe.bottom) || 0) - 8) / 2;
    check('modal-safe-centered', inRect(modalRect, safeBounds) && Math.abs(modalRect[0] + modalRect[2] / 2 - centerX) <= 1e-5 &&
      Math.abs(modalRect[1] + modalRect[3] / 2 - centerY) <= 1e-5, modalRect);
    check('modal-content-bounds', modal && inRect(rect(modal.content), modalRect));
  }
  const ignored = expectedFailure ? new Set(['runtime-resources-loaded', 'runtime-errors']) : new Set();
  const failedChecks = checks.filter(item => !item.passed && !ignored.has(item.code));
  const onlyStale = failedChecks.length > 0 && failedChecks.every(item => ['current-bundle-sha', 'bundle-byte-count', 'runtime-resource-sha'].includes(item.code));
  const status = failedChecks.length ? onlyStale ? 'STALE_BUILD' : 'FAILED' : expectedFailure ? 'EXPECTED_FAILURE' : 'PASS';
  return { id, status, fixture: d.fixture, fixtureKind: d.fixtureKind, configuration: d.configuration, fixtureGeneration: d.generation,
    actualGeneration: Number.isInteger(s.machine) ? s.machine + 1 : null, viewport, safeArea: safe, state: stateLabel(d),
    capturedAt: d.capturedAt, paused: d.paused, qaClockMs: d.qaClockMs, ticks: s.simulation && s.simulation.ticks,
    bundleSha256: d.bundleSha256, checks, failedChecks: failedChecks.map(item => item.code), expectedFailure,
    inventory, coins: s.coins, resources: { requested: art.requested, loaded: art.loaded, pending: art.pending, failed: art.failed },
    connections: s.connections || {}, held: p.transfer ? { source: p.transfer.source, amount: p.transfer.amount, overTarget: p.transfer.overTarget } : null,
    modal: p.modal ? { type: p.modal.type, stationId: p.modal.stationId || null, scroll: p.modal.scroll || 0 } : null,
    frameTiming: d.frameTiming || null, geometry, geometrySha256: hash(JSON.stringify(geometry)) };
}

function stability(records) {
  const groups = new Map();
  for (const row of records.filter(row => row.status === 'PASS')) {
    const key = [row.fixture, sizeKey(row.viewport), insetKey(row.safeArea), row.actualGeneration].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].map(([key, rows]) => {
    rows.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id));
    const baseline = rows.find(row => !row.modal && !row.held) || rows[0];
    const changed = rows.filter(row => row.geometrySha256 !== baseline.geometrySha256).map(row => ({ id: row.id, differences: differences(baseline.geometry, row.geometry) }));
    const transitions = [];
    for (let i = 1; i < rows.length; i++) {
      if (!!rows[i - 1].modal !== !!rows[i].modal) transitions.push({ from: rows[i - 1].id, to: rows[i].id,
        kind: rows[i].modal ? 'open' : 'close', modalType: (rows[i].modal || rows[i - 1].modal).type,
        geometryStable: rows[i - 1].geometrySha256 === rows[i].geometrySha256 });
    }
    return { key, fixture: baseline.fixture, viewport: baseline.viewport, safeArea: baseline.safeArea,
      records: rows.map(row => row.id), baseline: baseline.id, status: changed.length ? 'DRIFT' : rows.length > 1 ? 'STABLE' : 'SINGLE_CAPTURE',
      changed, modalTransitions: transitions, openingCaptured: transitions.some(item => item.kind === 'open'), closingCaptured: transitions.some(item => item.kind === 'close'),
      note: 'Same fixture, viewport, safe insets and actual generation; only fixed scene/HUD/machine/warehouse/inlet geometry compared. Numeric production state and animated cargo are excluded.' };
  });
}

function firstTrayEvidence(records) {
  const matching = records.filter(row => row.status === 'PASS' && row.fixture === 'g1-first-tray').sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const groups = new Map();
  for (const row of matching) {
    const key = sizeKey(row.viewport) + '|' + insetKey(row.safeArea);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const chains = [...groups].map(([key, rows]) => {
    const counters = row => ({ A: row.connections.pop || {}, B: row.connections.cup || {} });
    const initial = rows.find(row => { const { A, B } = counters(row); return A.manualTransfers === 0 && B.manualTransfers === 0 && row.inventory.sold === 0; });
    const afterA = initial && rows.find(row => { const { A, B } = counters(row); return row.capturedAt >= initial.capturedAt && A.manualTransfers === 1 && A.transferredAmount === 4 && B.manualTransfers === 0 && row.inventory.sold === 0; });
    const afterB = afterA && rows.find(row => { const { A, B } = counters(row); return row.capturedAt >= afterA.capturedAt && A.manualTransfers === 1 && A.transferredAmount === 4 && B.manualTransfers === 1 && B.transferredAmount === 4 && row.inventory.sold === 4 && row.coins === 4; });
    const held = ['pop', 'cup'].map(source => ({ source, evidence: rows.filter(row => row.held && row.held.source === source && row.held.amount === 4 && row.held.overTarget).map(row => row.id) }));
    return { key, status: initial && afterA && afterB ? 'COUNTER_CHAIN_OBSERVED' : 'INCOMPLETE',
      steps: [{ stage: 'A0 B0; sold0', evidence: initial && initial.id || null }, { stage: 'A1 amount4; B0; sold0', evidence: afterA && afterA.id || null },
        { stage: 'A1 amount4; B1 amount4; sold4; coins4', evidence: afterB && afterB.id || null }], heldCargoEvidence: held,
      tapCausality: 'NOT_RECORDED_IN_DIAGNOSTICS',
      note: 'Counters and held amounts are direct diagnostics. No pointer/action log is embedded, so an unchanged A0/B0 frame alone cannot prove that a tap occurred. Captures may span fixture reloads; this is an observed state sequence, not a certified uninterrupted input trace.' };
  });
  return { status: chains.some(chain => chain.status === 'COUNTER_CHAIN_OBSERVED') ? 'COUNTER_CHAIN_OBSERVED' : 'INCOMPLETE', chains };
}

function recoveryEvidence(records) {
  return FAILURE_CASES.map(item => {
    const failed = records.find(row => row.metadataFile === item.failedFile), recovered = records.find(row => row.metadataFile === item.recoveredFile);
    const checks = {
      declaredFailureObserved: !!failed && failed.status === 'EXPECTED_FAILURE' && failed.expectedFailure.caseId === item.id,
      recoveryObserved: !!recovered && recovered.status === 'PASS',
      allResourcesRecovered: !!recovered && recovered.resources.loaded === 87 && recovered.resources.failed === 0 && recovered.resources.pending === 0,
      sameScenario: !!failed && !!recovered && failed.fixture === recovered.fixture && same(failed.viewport, recovered.viewport) && insetKey(failed.safeArea) === insetKey(recovered.safeArea),
      sameBuild: !!failed && !!recovered && failed.bundleSha256 === recovered.bundleSha256,
      chronological: !!failed && !!recovered && recovered.capturedAt > failed.capturedAt,
      geometryStable: !!failed && !!recovered && failed.geometrySha256 === recovered.geometrySha256
    };
    return { ...item, status: Object.values(checks).every(Boolean) ? 'RECOVERY_PASS' : !failed || !recovered ? 'MISSING_CAPTURE' : 'RECOVERY_FAILED', checks,
      note: 'The exact failed/recovered pair is checked independently. Recovery is based on current resource state and diagnostics, not on an old 503 remaining in the cumulative request log.' };
  });
}

function coverage(records, layoutStability) {
  const valid = records.filter(row => row.status === 'PASS'), photos = valid.filter(row => row.mediaKind === 'png');
  const viewportCoverage = VIEWPORTS.map(viewport => ({ viewport, screenshots: photos.filter(row => same(row.viewport, viewport)).map(row => row.id) }));
  const homeMatrix = ['g1-entry', 'g1-connections-10', 'g1-connections-11', 'g6-upgraded'].flatMap(fixture => VIEWPORTS.map(viewport => ({ fixture, viewport,
    screenshots: photos.filter(row => row.fixture === fixture && same(row.viewport, viewport) && !row.modal && !row.held).map(row => row.id) })));
  const representativeHomes = REPRESENTATIVE_HOMES.map(([fixture, viewport]) => homeMatrix.find(row => row.fixture === fixture && same(row.viewport, viewport)));
  const modalTypes = ['station', 'logistics', 'expansion'].map(type => ({ type, screenshots: photos.filter(row => row.modal && row.modal.type === type).map(row => row.id) }));
  const modalSequences = modalTypes.map(item => ({ type: item.type, groups: (layoutStability || []).filter(group => group.status === 'STABLE' &&
    ['open', 'close'].every(kind => group.modalTransitions.some(transition => transition.kind === kind && transition.modalType === item.type && transition.geometryStable))).map(group => group.key) }));
  const actual = new Map();
  for (const row of valid) {
    const key = [row.fixture, sizeKey(row.viewport), insetKey(row.safeArea), row.state].join('|');
    if (!actual.has(key)) actual.set(key, { fixture: row.fixture, viewport: row.viewport, safeArea: row.safeArea, state: row.state, screenshots: [], videoEndpoints: [] });
    actual.get(key)[row.mediaKind === 'png' ? 'screenshots' : 'videoEndpoints'].push(row.id);
  }
  const missing = [
    ...viewportCoverage.filter(row => !row.screenshots.length).map(row => ({ kind: 'viewport-screenshot', viewport: row.viewport })),
    ...representativeHomes.filter(row => !row.screenshots.length).map(row => ({ kind: 'representative-home-screenshot', fixture: row.fixture, viewport: row.viewport })),
    ...modalTypes.filter(row => !row.screenshots.length).map(row => ({ kind: 'modal-type-screenshot', type: row.type })),
    ...modalSequences.filter(row => !row.groups.length).map(row => ({ kind: 'stable-modal-open-and-close-sequence', type: row.type }))
  ];
  return { scope: 'Operator-confirmed representative Chrome checklist: 320 first-entry and generation-six home; 360 semi-automatic home; 390 automatic home; 430 generation-six home; three core modal types with stable open/close evidence. This is not a 4-by-4 Chrome capture claim.',
    missingMeaning: 'Missing entries describe uncaptured Chrome screenshot evidence only, not a product/source test failure. Separate source/bundle tests and native-device validation are not inferred here.',
    viewportCoverage, representativeHomes, homeMatrix, modalTypes, modalSequences, actual: [...actual.values()], missing,
    extendedMatrixNotCaptured: homeMatrix.filter(row => !row.screenshots.length).map(row => ({ fixture: row.fixture, viewport: row.viewport, status: 'NOT_CAPTURED_IN_CHROME', requiredForRepresentativeChecklist: false })) };
}

async function readBuildContext() {
  const { ART_ASSETS: assets, ART_RUNTIME_IDS } = require('../src/art-manifest');
  const [web, native] = await Promise.all(['web/game.bundle.js', 'build/douyin/game.bundle.js'].map(file => fs.readFile(path.join(ROOT, file))));
  const context = { assets, assetIds: sorted(ART_RUNTIME_IDS), bundleSha256: hash(web), nativeBundleSha256: hash(native), bundleBytes: web.length,
    bundlesEqual: web.equals(native), requests: [], assetPackageChecks: [] };
  try { context.requests = JSON.parse(await fs.readFile(path.join(CAPTURES, 'request-report.json'), 'utf8')).requests || []; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const id of context.assetIds) {
    const asset = assets[id];
    for (const directory of ['web', 'build/douyin']) {
      try { const bytes = await fs.readFile(path.join(ROOT, directory, asset.path)); context.assetPackageChecks.push({ id, directory, passed: hash(bytes) === asset.sha256 }); }
      catch (error) { context.assetPackageChecks.push({ id, directory, passed: false, error: error.message }); }
    }
  }
  return context;
}

function pngMetadata(bytes) {
  if (bytes.length < 45 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND') throw Error('Invalid or incomplete PNG container');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function buildReport(context) {
  const files = (await fs.readdir(CAPTURES)).filter(safeName).sort(), records = [], media = [], unreadable = [], seenMedia = new Set();
  for (const file of files.filter(name => name.endsWith('.json') && name !== 'request-report.json')) {
    try {
      const raw = await fs.readFile(path.join(CAPTURES, file)), d = JSON.parse(raw);
      const video = !!(d.start || d.end), mediaFile = file.replace(/\.json$/, video ? '.webm' : '.png');
      const bytes = await fs.readFile(path.join(CAPTURES, mediaFile)); seenMedia.add(mediaFile);
      const labels = video ? [['start', d.start], ['end', d.end]] : [['screenshot', d]];
      const endpoints = labels.map(([phase, diagnostic]) => {
        if (!diagnostic || typeof diagnostic !== 'object') throw Error('Missing ' + phase + ' diagnostic');
        const row = analyzeDiagnostic(diagnostic, context, file + (video ? '#' + phase : ''));
        Object.assign(row, { metadataFile: file, metadataSha256: hash(raw), mediaFile, mediaKind: video ? 'webm' : 'png', phase });
        return row;
      });
      const item = { file: mediaFile, metadataFile: file, kind: video ? 'webm' : 'png', bytes: bytes.length, sha256: hash(bytes), diagnosticIds: endpoints.map(row => row.id) };
      if (video) {
        item.containerValid = bytes.length > 100 && bytes.toString('hex', 0, 4) === '1a45dfa3';
        item.sameScenario = d.start.fixture === d.end.fixture && same(d.start.viewSize, d.end.viewSize) && insetKey(d.start.safeArea) === insetKey(d.end.safeArea);
        item.wallIntervalMs = Date.parse(d.end.capturedAt) - Date.parse(d.start.capturedAt);
        item.qaClockDeltaMs = d.end.qaClockMs - d.start.qaClockMs;
        item.simulationTickDelta = (d.end.snapshot.state.simulation.ticks - d.start.snapshot.state.simulation.ticks);
        item.pausedAtStart = d.start.paused; item.pausedAtEnd = d.end.paused;
        item.clockScope = item.qaClockDeltaMs === 0 ? 'QA_CLOCK_FROZEN; pointer interaction can still change state' : 'QA_CLOCK_ADVANCED; elapsed wall time is a separate interval';
        item.decodeReview = 'NOT_RUN_BY_REPORT_TOOL';
        item.valid = item.containerValid && item.sameScenario && item.wallIntervalMs >= 0 && item.qaClockDeltaMs >= 0;
      } else {
        item.png = pngMetadata(bytes);
        const viewport = d.viewSize, ratioX = item.png.width / viewport.width, ratioY = item.png.height / viewport.height;
        item.pixelRatio = ratioX;
        item.valid = ratioX >= 1 && ratioX <= 2 && Math.abs(ratioX - ratioY) < 1e-8;
      }
      if (!item.valid) for (const row of endpoints) { row.status = 'FAILED'; row.failedChecks.push('media-container-or-canvas-size'); }
      item.status = endpoints.some(row => row.status === 'FAILED') ? 'FAILED' : endpoints.some(row => row.status === 'STALE_BUILD') ? 'STALE_BUILD'
        : endpoints.some(row => row.status === 'EXPECTED_FAILURE') ? 'EXPECTED_FAILURE' : 'PASS';
      records.push(...endpoints);
      media.push(item);
    } catch (error) { unreadable.push({ file, error: error.message, note: 'May be incomplete while a capture is being written; rerun after capture completion.' }); }
  }
  const orphanMedia = files.filter(name => /\.(png|webm)$/.test(name) && !seenMedia.has(name));
  const layoutStability = stability(records), matrix = coverage(records, layoutStability), firstTray = firstTrayEvidence(records), assetRecovery = recoveryEvidence(records);
  if (firstTray.status !== 'COUNTER_CHAIN_OBSERVED') matrix.missing.push({ kind: 'first-tray-counter-chain' });
  for (const row of assetRecovery.filter(row => row.status === 'MISSING_CAPTURE')) matrix.missing.push({ kind: 'declared-art-failure-recovery', caseId: row.id });
  const errors = records.filter(row => row.status === 'FAILED'), stale = records.filter(row => row.status === 'STALE_BUILD');
  const buildPassed = context.bundlesEqual && context.assetIds.length === 87 && context.assetPackageChecks.every(row => row.passed);
  const drift = layoutStability.filter(group => group.status === 'DRIFT');
  const failedRecoveries = assetRecovery.filter(row => row.status === 'RECOVERY_FAILED');
  const validationPassed = buildPassed && !errors.length && !unreadable.length && !drift.length && !failedRecoveries.length;
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), scope: 'v1.1 actual Chrome runtime captures; metadata and media-container validation',
    status: !validationPassed ? 'VALIDATION_ISSUES' : matrix.missing.length ? 'PARTIAL_CHROME_COVERAGE' : 'CAPTURED_EVIDENCE_PASS',
    validationStatus: validationPassed ? 'PASS_FOR_CAPTURED_EVIDENCE' : 'VALIDATION_ISSUES',
    coverageStatus: matrix.missing.length ? 'REPRESENTATIVE_CHROME_CAPTURES_MISSING' : 'REPRESENTATIVE_CHROME_CHECKLIST_CAPTURED',
    build: { runtimeVersion: '1.1.0', bundleSha256: context.bundleSha256, nativeBundleSha256: context.nativeBundleSha256,
      bundleBytes: context.bundleBytes, bundlesEqual: context.bundlesEqual, assetCount: context.assetIds.length,
      assetPackageChecks: context.assetPackageChecks, passed: buildPassed },
    summary: { mediaCount: media.length, pngCount: media.filter(row => row.kind === 'png').length, webmCount: media.filter(row => row.kind === 'webm').length,
      diagnosticCount: records.length, normalPass: records.filter(row => row.status === 'PASS').length, expectedFailure: records.filter(row => row.status === 'EXPECTED_FAILURE').length,
      invalid: errors.length, stale: stale.length, unreadable: unreadable.length, geometryDriftGroups: drift.length,
      recoveryPass: assetRecovery.filter(row => row.status === 'RECOVERY_PASS').length, recoveryFailed: failedRecoveries.length,
      missingChecklistItems: matrix.missing.length, extendedMatrixNotCaptured: matrix.extendedMatrixNotCaptured.length },
    evidenceWindow: { firstCapturedAt: records.map(row => row.capturedAt).sort()[0] || null, lastCapturedAt: records.map(row => row.capturedAt).sort().at(-1) || null,
      pausedEndpoints: records.filter(row => row.paused).length, advancingEndpoints: records.filter(row => !row.paused).length,
      qaClockRangeMs: records.length ? { minimum: Math.min(...records.map(row => row.qaClockMs)), maximum: Math.max(...records.map(row => row.qaClockMs)) } : null,
      note: 'capturedAt is wall time. qaClockMs is the acceptance clock, which may stay paused or be advanced manually; it is not continuous real-time gameplay duration.' },
    deviceStatus: 'NOT_RUN', humanFirstPlayStatus: 'NOT_RUN', visualReview: 'NOT_PERFORMED_BY_REPORT_TOOL', sourceTestStatus: 'NOT_ASSESSED_BY_REPORT_TOOL',
    limitations: ['Gallery displays original PNG/WebM files without repainting or generating substitute screenshots.',
      'Metadata checks cannot prove pixel appearance, input causality, video decodability or uninterrupted sessions; inspect the original media separately.',
      'Browser frameTiming may include background throttling and the acceptance clock. It is not native-device FPS, memory, thermal or power evidence.',
      'Expected injected asset failures are separate from normal PASS coverage. Stale bundle captures are retained and excluded from current coverage.',
      'The representative Chrome checklist does not imply a complete four-by-four browser matrix. Extended missing cells describe uncaptured screenshots, not failed source validation.',
      'Native-device and human first-play acceptance are NOT_RUN. A PASS applies only to the evidence and checks actually listed.'],
    media, records, coverage: matrix, layoutStability, firstTrayEvidence: firstTray, assetRecovery, unreadable, orphanMedia };
  return report;
}

function renderGallery(report) {
  const byId = new Map(report.records.map(row => [row.id, row]));
  const cards = report.media.map(item => {
    const row = byId.get(item.diagnosticIds.at(-1));
    return `<article class="card" data-status="${escapeHTML(item.status)}" data-fixture="${escapeHTML(row.fixture)}" data-size="${escapeHTML(sizeKey(row.viewport))}"><div class="media">${item.kind === 'png'
      ? `<a href="captures/${encodeURIComponent(item.file)}"><img loading="lazy" src="captures/${encodeURIComponent(item.file)}" alt="${escapeHTML(row.fixture + ' ' + row.state)}"></a>`
      : `<video controls preload="metadata" src="captures/${encodeURIComponent(item.file)}"></video>`}</div><div class="body"><strong>${escapeHTML(row.fixture)} · ${escapeHTML(sizeKey(row.viewport))}</strong><span class="badge ${item.status === 'PASS' ? 'pass' : 'attention'}">${escapeHTML(item.status)}</span><p>${escapeHTML(row.state)} · safe ${escapeHTML(insetKey(row.safeArea))}</p><p>${escapeHTML(row.capturedAt)}<br>QA ${row.qaClockMs} ms · ${row.paused ? 'paused' : 'advancing'}</p>${item.kind === 'webm' ? `<p>录像墙钟 ${(item.wallIntervalMs / 1000).toFixed(2)} s；QA Δ ${item.qaClockDeltaMs} ms；模拟 Δ ${item.simulationTickDelta} ticks。${escapeHTML(item.clockScope)}</p>` : ''}<a href="captures/${encodeURIComponent(item.metadataFile)}">原始诊断 JSON</a> · <a href="captures/${encodeURIComponent(item.file)}">原始媒体</a><details><summary>检查与文件</summary><p>${escapeHTML(item.file)}</p><p>${escapeHTML(row.failedChecks.join(', ') || 'Metadata checks passed; separate visual review still required.')}</p><code>${item.sha256}</code></details></div></article>`;
  }).join('\n');
  const missing = report.coverage.missing.map(row => `<li>${escapeHTML([row.kind, row.fixture, row.type, row.viewport && sizeKey(row.viewport)].filter(Boolean).join(' · '))}</li>`).join('');
  const extendedMissing = report.coverage.extendedMatrixNotCaptured.map(row => `<li>${escapeHTML(row.fixture)} · ${escapeHTML(sizeKey(row.viewport))}</li>`).join('');
  const recovery = report.assetRecovery.map(row => `<p><strong>${escapeHTML(row.id)} · ${escapeHTML(row.status)}</strong></p><p><a href="captures/${encodeURIComponent(row.failedFile)}">人工故障：86 loaded / 1 failed</a> → <a href="captures/${encodeURIComponent(row.recoveredFile)}">重新加载：87 loaded / 0 failed</a></p><p>仅此操作者指定文件对及对应 503 请求属于故障测试；不豁免其他加载失败。</p>`).join('');
  const matrix = report.coverage.actual.map(row => `<tr><td>${escapeHTML(row.fixture)}</td><td>${escapeHTML(sizeKey(row.viewport))}</td><td>${escapeHTML(insetKey(row.safeArea))}</td><td>${escapeHTML(row.state)}</td><td>${row.screenshots.length}</td><td>${row.videoEndpoints.length}</td></tr>`).join('');
  const chain = report.firstTrayEvidence.chains.map(row => `<p><strong>${escapeHTML(row.key)} · ${escapeHTML(row.status)}</strong></p><ol>${row.steps.map(step => `<li>${escapeHTML(step.stage)} — ${step.evidence ? `<a href="captures/${encodeURIComponent(step.evidence.split('#')[0])}">${escapeHTML(step.evidence)}</a>` : 'MISSING'}</li>`).join('')}</ol>`).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>v1.1 实际运行截图与录像</title><style>body{margin:0;background:#f3efe3;color:#234a4c;font:15px/1.6 system-ui,'Microsoft YaHei',sans-serif}main{max-width:1500px;margin:auto;padding:28px}h1{font-size:28px;margin:0 0 12px}h2{font-size:20px;margin:20px 0 10px}a{color:#176d73}p{margin:8px 0}.banner,.panel{background:#fffaf0;border:1px solid #d9ddce;border-radius:12px;padding:18px;margin:16px 0}.warning{border-left:5px solid #c48332}.filters{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}select{padding:8px;border:1px solid #b8c8c0;border-radius:6px;background:white;color:inherit}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px}.card{background:#fffaf0;border:1px solid #d5dcd1;border-radius:10px;overflow:hidden}.media{display:flex;justify-content:center;background:#d6dfd5;padding:10px;min-height:240px}.media img,.media video{display:block;max-width:100%;height:390px;object-fit:contain}.body{padding:14px}.body p{font-size:12px;color:#506c69}.badge{display:inline-block;font-size:10px;padding:2px 6px;margin-left:5px;border-radius:6px}.pass{background:#d9eddf}.attention{background:#f5ddb5}code{font-size:10px;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;border-bottom:1px solid #d9dfd5;padding:7px}details{margin-top:8px}summary{cursor:pointer}.table{overflow:auto}.muted{color:#667d75;font-size:12px}[hidden]{display:none!important}</style><main><h1>v1.1 实际运行截图与录像</h1><p>生成：${escapeHTML(report.generatedAt)} · <a href="report.json">完整机器可读报告</a> · <a href="README.md">验证范围说明</a></p><div class="banner"><strong>${escapeHTML(report.status)}</strong><p>${report.summary.pngCount} 张 PNG / ${report.summary.webmCount} 段 WebM；${report.summary.normalPass} 个正常诊断通过，${report.summary.expectedFailure} 个预期故障，${report.summary.invalid} 个无效，${report.summary.stale} 个旧构建；缺少 ${report.summary.missingChecklistItems} 项代表性 Chrome 采集证据。扩展矩阵另有 ${report.summary.extendedMatrixNotCaptured} 格未拍，未拍不代表源码验收失败。</p><p>双端 bundle 一致：${report.build.bundlesEqual ? '是' : '否'}；资源 ${report.build.assetCount} 张。<code>${report.build.bundleSha256}</code></p></div><div class="panel warning"><strong>真机 / 真人首玩 NOT_RUN；PASS 仅适用于列出的采集实证。</strong><p>下方直接展示原始 PNG / WebM，未重绘。capturedAt 是墙钟，QA 时钟可暂停或手动推进。浏览器后台节流和采集帧率不能作为抖音真机性能结论。</p><p class="muted">证据窗口 ${escapeHTML(report.evidenceWindow.firstCapturedAt)} — ${escapeHTML(report.evidenceWindow.lastCapturedAt)}。录像分别校验 start/end，容器校验不等于完整视频解码审查。</p></div><details class="panel"><summary>首盘实证 · ${escapeHTML(report.firstTrayEvidence.status)}</summary>${chain}<p>转运次数、数量与销售为诊断直接证据；JSON 没有逐次点击日志，A0/B0 画面不能单独证明执行过点按，也不宣称跨截图为未中断操作。</p></details><details class="panel" ${report.coverage.missing.length ? 'open' : ''}><summary>代表性 Chrome 清单 missing · ${report.coverage.missing.length}</summary><ul>${missing || '<li>代表性清单已有证据；其他状态仍以实际覆盖矩阵为准。</li>'}</ul><p>missing 仅表示 Chrome 截图未采集，不判定源码测试失败。</p></details><details class="panel"><summary>扩展 4×4 主场景截图未覆盖 · ${report.summary.extendedMatrixNotCaptured}</summary><p>本次 Chrome 为代表性采集，下列格未拍，不纳入代表性必需项，也不推断代码测试结果。</p><ul>${extendedMissing}</ul></details><details class="panel"><summary>人工故障与恢复 · ${report.summary.recoveryPass} PASS</summary>${recovery}</details><details class="panel"><summary>实际覆盖矩阵（仅当前构建的正常通过证据）</summary><div class="table"><table><thead><tr><th>fixture</th><th>视口</th><th>safe T/R/B/L</th><th>状态</th><th>PNG</th><th>录像端点</th></tr></thead><tbody>${matrix}</tbody></table></div></details><div class="filters"><select id="status"><option value="">全部状态</option>${[...new Set(report.media.map(row => row.status))].map(value => `<option>${escapeHTML(value)}</option>`).join('')}</select><select id="fixture"><option value="">全部 fixture</option>${[...new Set(report.records.map(row => row.fixture))].sort().map(value => `<option>${escapeHTML(value)}</option>`).join('')}</select><select id="size"><option value="">全部视口</option>${VIEWPORTS.map(value => `<option>${sizeKey(value)}</option>`).join('')}</select><span id="visible"></span></div><div class="grid">${cards}</div></main><script>const filters=['status','fixture','size'].map(id=>document.getElementById(id));function filter(){let count=0;document.querySelectorAll('.card').forEach(card=>{card.hidden=filters.some(select=>select.value&&card.dataset[select.id]!==select.value);if(!card.hidden)count++;});document.getElementById('visible').textContent=count+' 项实际媒体';}filters.forEach(select=>select.addEventListener('change',filter));filter();</script></html>`;
}

function selfTest(report, context) {
  const original = report.records.find(row => row.status === 'PASS');
  assert.ok(original, 'self-test requires one actual valid capture');
  return fs.readFile(path.join(CAPTURES, original.metadataFile), 'utf8').then(text => {
    const raw = JSON.parse(text), base = original.phase === 'start' ? raw.start : original.phase === 'end' ? raw.end : raw;
    assert.equal(analyzeDiagnostic(base, context, 'self-test').status, 'PASS');
    const corruptStock = copy(base); corruptStock.snapshot.state.buffers.pop++;
    assert.ok(analyzeDiagnostic(corruptStock, context, 'self-test').failedChecks.includes('inventory-conservation'));
    const pending = copy(base); pending.presentation.art.loaded--; pending.presentation.art.pending++;
    assert.ok(analyzeDiagnostic(pending, context, 'self-test').failedChecks.includes('runtime-resources-loaded'));
    const oldBundle = copy(base); oldBundle.bundleSha256 = '0'.repeat(64);
    assert.equal(analyzeDiagnostic(oldBundle, context, 'self-test').status, 'STALE_BUILD');
    const numbers = copy(base); numbers.presentation.scene.buffers[0].amount++;
    assert.deepEqual(geometryProjection(numbers), geometryProjection(base), 'numeric content is not geometry drift');
    const moved = copy(base); moved.presentation.scene.machines[0].rect[0] += 2;
    assert.ok(differences(geometryProjection(base), geometryProjection(moved)).length);
    const missingInlet = copy(base); missingInlet.presentation.scene.transfers.pop();
    assert.ok(analyzeDiagnostic(missingInlet, context, 'self-test').failedChecks.includes('two-inlet-identities'));
    const failure = copy(base), declared = FAILURE_CASES[0];
    failure.fixture = declared.fixture; failure.viewSize = declared.viewport; failure.safeArea = declared.safeArea;
    failure.presentation.art.loaded = 86; failure.presentation.art.failed = 1; failure.presentation.art.pending = 0;
    failure.presentation.art.entries.find(entry => entry.id === declared.assetId).status = 'failed';
    const requestContext = { ...context, requests: [{ status: 503, path: '/machine_cup_hex_body.png', at: failure.capturedAt }] };
    assert.equal(expectedFailureEvidence(failure, requestContext, 'unrelated-capture.json'), null, 'a failed asset and nearby 503 are insufficient without the exact declared capture');
    assert.equal(expectedFailureEvidence(failure, requestContext, declared.failedFile).status, 'EXPECTED_FAILURE');
    failure.presentation.art.pending = 1;
    assert.equal(expectedFailureEvidence(failure, requestContext, declared.failedFile), null, 'expected failure cannot hide an additional pending resource');
    assert.throws(() => pngMetadata(Buffer.from('incomplete')), /Invalid or incomplete PNG/);
    return { status: 'PASS', checks: 11, fakeCapturesWritten: false };
  });
}

async function main() {
  const flags = process.argv.slice(2);
  if (flags.some(flag => flag !== '--self-test')) throw Error('Usage: node tools/v11-runtime-report.cjs [--self-test]');
  const context = await readBuildContext(), report = await buildReport(context);
  if (flags.includes('--self-test')) report.toolSelfTest = await selfTest(report, context);
  await fs.mkdir(OUTPUT, { recursive: true });
  await fs.writeFile(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(OUTPUT, 'index.html'), renderGallery(report));
  await fs.writeFile(path.join(OUTPUT, 'README.md'), '# v1.1 实际运行证据报告\n\n' +
    '运行 `node tools/v11-runtime-report.cjs` 读取 captures 中实际 PNG / JSON / WebM 并刷新 report.json 与 index.html。可加 `--self-test` 检验守恒、旧构建、资源未完成、纯数字变化和固定位置变化的识别；自测仅在内存改副本，不写伪造截图或诊断。\n\n' +
    '工具逐条验证运行版本、当前 Web/抖音 bundle SHA、87 张资源身份/尺寸/SHA/加载结果、全部库存与在制品守恒、金币守恒、全屏逻辑视口、3 台机器/2 个货仓/2 个入口及安全区边界。PNG 检查实际尺寸与 Canvas 等比像素倍率；WebM 检查容器并分别校验起止诊断。\n\n' +
    '同 fixture、视口、safe 和实际代际比较固定场景/HUD/机器/货仓/入口几何，忽略库存数字、任务进度、拖拽位置和报价等可变内容。没有对应开/合采集的组不会被当作已验证完整开合。\n\n' +
    'gallery 使用原始媒体，不重绘截图。可见画面、视频解码、连续输入因果仍需独立审查。paused/qaClockMs 为工具控制的 QA 时钟，capturedAt 为墙钟；录像端点和状态序列不能擅自扩展成完整输入日志。浏览器后台帧率不代表真机性能。真机、真人首玩、内存、温度、电量结论均为 NOT_RUN。\n\n' +
    'Chrome 代表性清单为 320 首代和六代、360 半自动、390 全自动、430 六代主场景，以及机器/物流/扩建弹窗开合。扩展 4×4 主场景矩阵单独列出未拍项；missing 只描述截图证据未采集，不判定源码验收失败，也不推断独立测试是否通过。\n\n' +
    '人工故障仅锁定操作者指定的 g6-upgraded-430x932-safe24-1789047031994.json 与对应 machine_cup_hex_body 503 请求，标 EXPECTED_FAILURE；与 1789047072798 恢复文件配对，验证 86/1 到 87/0 及几何和构建一致。任意其他加载失败不会被自动豁免；历史请求日志里的 503 不会让已恢复诊断失败。旧 bundle 独立列出，不计当前覆盖。PASS 仅限报告实际列出的采集证据与检查。\n');
  console.log(JSON.stringify({ status: report.status, ...report.summary, firstTray: report.firstTrayEvidence.status, selfTest: report.toolSelfTest,
    output: path.relative(ROOT, OUTPUT).replaceAll('\\', '/') }, null, 2));
  if (!report.build.passed || report.summary.invalid || report.summary.unreadable || report.summary.geometryDriftGroups || report.summary.recoveryFailed) process.exitCode = 1;
}

module.exports = { analyzeDiagnostic, geometryProjection, differences, firstTrayEvidence, recoveryEvidence, coverage, buildReport };
if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
