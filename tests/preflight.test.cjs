'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const api = import('../tools/preflight.mjs');

function fixture(overrides = {}) {
  // Test-only synthetic strings are never written to project config or game packages.
  const config = { appId: 'tt93af724b168dc950e2', rewardAdUnitId: 'r8c93af724b168dc95', interstitialAdUnitId: 'i5b81ed690ac734f2', allowSimulatedAds: false, analyticsEnabled: false, debug: false, developerHoldTap: false, ...overrides };
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0); wav.writeUInt32LE(38, 4); wav.write('WAVE', 8);
  const files = new Map(Object.entries({
    'game.js': "require('./config.js');\nrequire('./game.bundle.js');\n",
    'game.json': JSON.stringify({ deviceOrientation: 'portrait', showStatusBar: false }),
    'project.config.json': JSON.stringify({ appid: config.appId, compileType: 'game', setting: { urlCheck: true } }),
    'config.js': `globalThis.POPCORN_CONFIG = ${JSON.stringify(config)};\n`,
    'game.bundle.js': '/* test-only bundle */'.repeat(10),
    ...Object.fromEntries(['upgrade', 'machine', 'click', 'error'].map(name => [`audio/${name}.wav`, wav]))
  }).map(([name, value]) => [name, Buffer.isBuffer(value) ? value : Buffer.from(value)]));
  return { files, entries: [...files].map(([name, bytes]) => ({ name, size: bytes.length })), localConfigText: JSON.stringify(config) };
}

test('preflight distinguishes completed local checks from unverified platform access', async () => {
  const { inspectPackage, exitCode, formatReport } = await api;
  const input = fixture(), report = inspectPackage(input);
  assert.equal(report.codeReady, true);
  assert.equal(report.accountConfigReady, true);
  assert.equal(report.platformVerified, false);
  assert.equal(exitCode(report, true), 0);
  const output = formatReport(report) + JSON.stringify(report);
  for (const id of Object.values(JSON.parse(input.localConfigText)).filter(value => typeof value === 'string')) assert.equal(output.includes(id), false);
  assert.match(output, /真实性、归属和启用状态待平台核验/);
});

test('preflight provides actionable steps when local config is absent', async () => {
  const { inspectPackage, exitCode, formatReport } = await api;
  const input = fixture({ appId: '', rewardAdUnitId: '', interstitialAdUnitId: '' });
  input.localConfigText = null;
  const report = inspectPackage(input);
  assert.equal(report.codeReady, true);
  assert.equal(report.accountConfigReady, false);
  assert.equal(exitCode(report), 0);
  assert.equal(exitCode(report, true), 2);
  assert.match(formatReport(report), /复制 config.local.example.json/);
});

test('preflight catches missing artifacts even without configuration', async () => {
  const { inspectPackage, exitCode } = await api;
  const report = inspectPackage();
  assert.equal(report.codeReady, false);
  assert.equal(exitCode(report, true), 1);
  assert.match(report.checks.find(check => check.code === 'package-files').message, /game.js/);
});

test('preflight rejects malformed or non-object local JSON without echoing content', async () => {
  const { inspectPackage, formatReport } = await api;
  for (const invalid of ['{"appId":"do-not-echo-secret",', 'null', '[]', 'true']) {
    const input = fixture(); input.localConfigText = invalid;
    const report = inspectPackage(input);
    assert.equal(report.codeReady, false);
    assert.equal(formatReport(report).includes('do-not-echo-secret'), false);
  }
});

test('preflight flags common placeholder, whitespace and non-string IDs', async () => {
  const { inspectPackage, idState } = await api;
  for (const id of ['YOUR_APP_ID', 'tttest1234567890', 'placeholder123', 'tt111111111111111111', '你的 AppID', ' real123456 ', 123]) {
    assert.notEqual(idState(id), 'provided-unverified');
    const report = inspectPackage(fixture({ appId: id }));
    assert.equal(report.accountConfigReady, false);
    assert.equal(report.checks.find(check => check.code === 'appId').status, 'pending');
  }
});

test('preflight requires explicit simulated-ad disable in generated config', async () => {
  const { inspectPackage } = await api;
  for (const value of [true, 'false', undefined]) {
    const report = inspectPackage(fixture({ allowSimulatedAds: value }));
    assert.equal(report.codeReady, false);
    assert.equal(report.checks.find(check => check.code === 'simulated-ads-disabled').status, 'error');
  }
});

test('preflight permits forced simulated-ad disable when local config requests simulation', async () => {
  const { inspectPackage } = await api;
  const input = fixture();
  input.localConfigText = JSON.stringify({ ...JSON.parse(input.localConfigText), allowSimulatedAds: true });
  assert.equal(inspectPackage(input).codeReady, true);
});

test('preflight rejects development hold tapping unless the release config explicitly disables it', async () => {
  const { inspectPackage, formatReport } = await api;
  for (const value of [true, 'false', undefined]) {
    const report = inspectPackage(fixture({ developerHoldTap: value }));
    assert.equal(report.codeReady, false);
    assert.equal(report.checks.find(check => check.code === 'developer-hold-disabled').status, 'error');
    assert.match(formatReport(report), /npm run build/);
  }
});

test('preflight accepts a release build overriding a local developer hold request', async () => {
  const { inspectPackage } = await api;
  const input = fixture();
  input.localConfigText = JSON.stringify({ ...JSON.parse(input.localConfigText), developerHoldTap: true });
  const report = inspectPackage(input);
  assert.equal(report.codeReady, true);
  assert.equal(report.checks.find(check => check.code === 'config-synchronized').status, 'pass');
});

test('preflight identifies stale configuration without exposing IDs', async () => {
  const { inspectPackage, formatReport } = await api;
  const input = fixture();
  input.localConfigText = JSON.stringify({ ...JSON.parse(input.localConfigText), rewardAdUnitId: 'r98765432fedcba01' });
  const report = inspectPackage(input);
  assert.equal(report.codeReady, false);
  assert.equal(report.checks.find(check => check.code === 'config-synchronized').status, 'error');
  assert.equal(formatReport(report).includes('r98765432fedcba01'), false);
});

test('preflight rejects an AppID mismatch between runtime and IDE config', async () => {
  const { inspectPackage } = await api;
  const input = fixture();
  input.files.set('project.config.json', Buffer.from(JSON.stringify({ appid: 'ttdiff123456789abcd0', compileType: 'game', setting: { urlCheck: true } })));
  const report = inspectPackage(input);
  assert.equal(report.checks.find(check => check.code === 'appid-synchronized').status, 'error');
});

test('preflight never executes JavaScript embedded in config', async () => {
  const { inspectPackage } = await api;
  const input = fixture();
  input.files.set('config.js', Buffer.from('globalThis.POPCORN_CONFIG = {}; globalThis.PREFLIGHT_EXECUTED = true;'));
  assert.equal(inspectPackage(input).codeReady, false);
  assert.equal(globalThis.PREFLIGHT_EXECUTED, undefined);
});

test('preflight reads the native GameGlobal fallback config without evaluating it', async () => {
  const { inspectPackage } = await api;
  const input = fixture();
  input.files.set('config.js', Buffer.from(`(typeof globalThis !== "undefined" ? globalThis : GameGlobal).POPCORN_CONFIG = ${input.localConfigText};`));
  assert.equal(inspectPackage(input).codeReady, true);
});

test('preflight rejects unexpected configuration fields without printing their values', async () => {
  const { inspectPackage, formatReport } = await api;
  const report = inspectPackage(fixture({ appSecret: 'private-data-must-not-appear' }));
  assert.equal(report.codeReady, false);
  assert.equal(formatReport(report).includes('private-data-must-not-appear'), false);
});

test('preflight checks entry order and bundle content', async () => {
  const { inspectPackage } = await api;
  const input = fixture();
  input.files.set('game.js', Buffer.from("require('./game.bundle.js');\nrequire('./config.js');"));
  input.files.set('game.bundle.js', Buffer.from(''));
  const report = inspectPackage(input);
  assert.equal(report.checks.find(check => check.code === 'entry-order').status, 'error');
  assert.equal(report.checks.find(check => check.code === 'bundle-content').status, 'error');
});

test('preflight catches missing and corrupt WAV assets', async () => {
  const { inspectPackage } = await api;
  const input = fixture();
  input.files.delete('audio/upgrade.wav');
  input.files.delete('audio/machine.wav');
  input.files.set('audio/click.wav', Buffer.from('not a wav'));
  const report = inspectPackage(input);
  assert.equal(report.codeReady, false);
  assert.match(report.checks.find(check => check.code === 'package-files').message, /upgrade.wav/);
  assert.match(report.checks.find(check => check.code === 'package-files').message, /machine.wav/);
  assert.match(report.checks.find(check => check.code === 'audio-format').message, /click.wav/);
});

test('preflight catches incorrect RIFF declared length', async () => {
  const { inspectPackage } = await api;
  const input = fixture();
  const audio = Buffer.from(input.files.get('audio/upgrade.wav')); audio.writeUInt32LE(200, 4);
  input.files.set('audio/upgrade.wav', audio);
  assert.equal(inspectPackage(input).checks.find(check => check.code === 'audio-format').status, 'error');
});

test('preflight detects excess files and oversized package without listing unknown paths', async () => {
  const { inspectPackage, formatReport } = await api;
  const input = fixture();
  input.entries.push({ name: 'private-path.do-not-print', size: 21 * 1024 * 1024 });
  const report = inspectPackage(input);
  assert.equal(report.checks.find(check => check.code === 'package-contents').status, 'error');
  assert.equal(report.checks.find(check => check.code === 'package-size').status, 'error');
  assert.equal(formatReport(report).includes('private-path.do-not-print'), false);
});

test('preflight refuses unsupported game config, disabled domain checks and debug mode', async () => {
  const { inspectPackage } = await api;
  const input = fixture({ debug: true });
  input.files.set('game.json', Buffer.from(JSON.stringify({ deviceOrientation: 'landscape', subpackages: [] })));
  input.files.set('project.config.json', Buffer.from(JSON.stringify({ compileType: 'miniprogram', setting: { urlCheck: false } })));
  const report = inspectPackage(input);
  for (const code of ['game-config', 'project-config', 'debug-disabled']) assert.equal(report.checks.find(check => check.code === code).status, 'error');
});

test('preflight treats unreadable files and symlinks as package failures', async () => {
  const { inspectPackage } = await api;
  assert.equal(inspectPackage({ ...fixture(), readErrors: ['symlink'] }).codeReady, false);
});

test('preflight requires console verification for enabled analytics', async () => {
  const { inspectPackage } = await api;
  const report = inspectPackage(fixture({ analyticsEnabled: true }));
  assert.equal(report.codeReady, true);
  assert.equal(report.accountConfigReady, false);
  assert.equal(report.checks.find(check => check.code === 'analytics-console').status, 'pending');
});


test('preflight strict mode does not require any disabled ad placement', async () => {
  const { inspectPackage, exitCode } = await api;
  const report = inspectPackage(fixture({ rewardAdUnitId: '', interstitialAdUnitId: '' }));
  assert.equal(report.codeReady, true);
  assert.equal(report.accountConfigReady, true);
  assert.equal(exitCode(report, true), 0);
  assert.equal(report.checks.find(check => check.code === 'ads-disabled').status, 'pass');
  assert.ok(!report.checks.some(check => ['rewardAdUnitId', 'interstitialAdUnitId'].includes(check.code)));
});
