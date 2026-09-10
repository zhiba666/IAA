'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, copyFile, writeFile, readFile, realpath, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const vm = require('node:vm');
const run = promisify(execFile);

test('both build modes disable legacy hold tapping and simulated ads on every host', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'popcorn-build-config-'));
  t.after(async () => {
    const resolved = await realpath(root);
    assert.equal(path.dirname(resolved), await realpath(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('popcorn-build-config-'));
    await rm(resolved, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'tools'));
  await mkdir(path.join(root, 'src'));
  for (const filename of ['build.mjs', 'bundle.mjs', 'audio.mjs', 'art-build.mjs']) {
    await copyFile(path.resolve(__dirname, '../tools', filename), path.join(root, 'tools', filename));
  }
  const { ART_SOURCE_REFS, ART_RUNTIME_IDS, ART_ASSETS } = require('../src/art-manifest');
  for (const filename of [...ART_SOURCE_REFS, ...ART_RUNTIME_IDS.map(id => ART_ASSETS[id].sourcePath), 'web/index.html', 'package.json', 'src/version.js']) {
    await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
    await copyFile(path.resolve(__dirname, '..', filename), path.join(root, filename));
  }
  await writeFile(path.join(root, 'src/main.js'),
    '(function(root){root.startedWithHold=root.POPCORN_CONFIG.developerHoldTap;})(typeof globalThis !== "undefined" ? globalThis : GameGlobal);');
  const { inspectProject } = await import('../tools/preflight.mjs');

  // Use the same output directory so the release case also catches stale dev artifacts.
  for (const enabled of [true, false]) {
    await writeFile(path.join(root, 'config.local.json'), JSON.stringify({ developerHoldTap: !enabled, allowSimulatedAds: true }));
    await run(process.execPath, [path.join(root, 'tools/build.mjs'), ...(enabled ? ['--development'] : [])]);
    const webBundle = await readFile(path.join(root, 'web/game.bundle.js'), 'utf8');
    const nativeBundle = await readFile(path.join(root, 'build/douyin/game.bundle.js'), 'utf8');
    const nativeConfig = await readFile(path.join(root, 'build/douyin/config.js'), 'utf8');
    assert.equal(webBundle, nativeBundle);
    assert.match(webBundle, /v0\.1\.0.*pipeline/);

    const web = vm.createContext({ POPCORN_CONFIG: { developerHoldTap: !enabled, allowSimulatedAds: true } });
    vm.runInContext(webBundle, web);
    assert.equal(web.startedWithHold, false, 'Web startup must use the build flag, ignoring entry config');
    assert.equal(web.POPCORN_CONFIG.allowSimulatedAds, false, 'Web cannot re-enable legacy rewards');

    for (const gameGlobalOnly of [false, true]) {
      const native = vm.createContext({});
      native.GameGlobal = vm.runInContext('this', native);
      if (gameGlobalOnly) native.globalThis = undefined;
      vm.runInContext(nativeConfig, native);
      assert.equal(native.POPCORN_CONFIG.developerHoldTap, false, 'native config must override local requests');
      assert.equal(native.POPCORN_CONFIG.allowSimulatedAds, false);
      // A stale/manual config edit cannot re-enable the release bundle.
      native.POPCORN_CONFIG.developerHoldTap = true;
      native.POPCORN_CONFIG.allowSimulatedAds = true;
      vm.runInContext(nativeBundle, native);
      assert.equal(native.startedWithHold, false, 'native startup must use the build flag on both global APIs');
    }

    const report = await inspectProject(root);
    assert.equal(report.codeReady, true, 'both build modes disable retired gameplay paths');
    assert.equal(report.checks.find(check => check.code === 'developer-hold-disabled').status, 'pass');
  }
});
