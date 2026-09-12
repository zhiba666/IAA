'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');

const project = path.resolve(__dirname, '..');
const sourceRoot = 'art-source/v1.3-scenes/';
const manifestPath = sourceRoot + 'manifest.json';
const targets = ['.', 'web', 'build/douyin'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedIds = ['scene_direct_sales_courtyard', 'scene_pickup_counter', 'scene_factory_wayfinding'];

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-v13-scene-art-'));
  t.after(async () => {
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('popcorn-v13-scene-art-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const build = await import('../tools/v13-scene-art-build.mjs');
  const manifest = JSON.parse(await fs.readFile(path.join(project, manifestPath), 'utf8'));
  for (const file of [manifestPath, ...manifest.assets.map(entry => sourceRoot + entry.path)]) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.copyFile(path.join(project, file), path.join(root, file));
  }
  return { root, build, manifest };
}

test('reviewed scene exports generate a standalone manifest and exact repo/Web/Douyin copies', async t => {
  const { root, build } = await fixture(t);
  const data = await build.generateV13SceneRuntimeArt(root);
  const filename = path.join(root, 'src/v13-scene-art-manifest.js'), generated = require(filename);
  assert.deepEqual(generated.V13_SCENE_ART_IDS, expectedIds);
  assert.deepEqual(generated.V13_SCENE_ART_ASSETS, data.assets);
  assert.deepEqual(generated.V13_SCENE_ART_BUDGETS, { compressedBytes: 1048576, decodedBytes: 4194304 });
  assert.deepEqual(data.totals, { compressedBytes: 811705, decodedBytes: 3326976 });
  assert.doesNotMatch(await fs.readFile(filename, 'utf8'), /\?\.|\?\?/);
  for (const target of targets) {
    for (const file of ['assets/art/v13-scenes/stale/preview.png', 'assets/art/six_gen/keep.png', 'assets/art/v13/keep.png']) {
      await fs.mkdir(path.dirname(path.join(root, target, file)), { recursive: true });
      await fs.writeFile(path.join(root, target, file), 'fixture');
    }
  }
  const report = await build.copyV13SceneRuntimeArt(root, targets, data);
  assert.equal(report.count, 3);
  assert.equal(report.compressedBytes, data.totals.compressedBytes);
  assert.equal(report.decodedBytes, data.totals.decodedBytes);
  assert.ok(Object.values(report.budgets).every(budget => budget.passed));
  assert.deepEqual(report.targets.map(target => [target.directory, target.verified]), targets.map(target => [target, 3]));
  await assert.rejects(fs.stat(path.join(root, 'output')), { code: 'ENOENT' });
  for (const target of targets) {
    await assert.rejects(fs.stat(path.join(root, target, 'assets/art/v13-scenes/stale/preview.png')), { code: 'ENOENT' });
    for (const version of ['six_gen', 'v13']) assert.equal(await fs.readFile(path.join(root, target, 'assets/art', version, 'keep.png'), 'utf8'), 'fixture');
    const pngs = (await fs.readdir(path.join(root, target, 'assets/art/v13-scenes'))).filter(file => file.endsWith('.png'));
    assert.deepEqual(pngs.sort(), expectedIds.map(id => id + '.png').sort());
    for (const resource of data.entries) {
      const copied = await fs.readFile(path.join(root, target, resource.path));
      assert.equal(hash(copied), resource.sha256);
      assert.deepEqual(copied, await fs.readFile(path.join(root, resource.sourcePath)));
    }
  }
});

test('scene contract rejects unreviewed IDs, unsafe paths, invalid metadata and altered budgets', async t => {
  const { root, build, manifest } = await fixture(t);
  for (const [change, expected] of [
    [copy => { copy.contract = 'unreviewed'; }, /3 unique reviewed IDs/],
    [copy => { copy.assets.pop(); }, /3 unique reviewed IDs/],
    [copy => { copy.assets[0] = copy.assets[1]; }, /3 unique reviewed IDs/],
    [copy => { copy.assets[0] = null; }, /3 unique reviewed IDs/],
    [copy => { copy.assets[0].path = '../outside.png'; }, /runtime art or export path/],
    [copy => { copy.assets[0].source = '../outside.png'; }, /runtime art or export path/],
    [copy => { copy.assets[0].kind = 'sprite'; }, /runtime art or export path/],
    [copy => { copy.assets[0].anchorPx = [-1, 0]; }, /runtime art or export path/],
    [copy => { copy.assets[0].maxSize = 2048; }, /runtime art or export path/],
    [copy => { copy.assets[0].width = 959; }, /dimensions\/signature mismatch/],
    [copy => { copy.assets[0].sha256 = '0'.repeat(64); }, /SHA-256 mismatch/],
    [copy => { copy.assets[0].compressedBytes += 1; }, /size mismatch/],
    [copy => { copy.assets[0].rgbaBytes += 4; }, /size mismatch/],
    [copy => { copy.totals.compressedBytes += 1; }, /manifest totals mismatch/],
    [copy => { copy.totals.count += 1; }, /manifest totals mismatch/],
    [copy => { copy.budget.compressedBytes += 1; }, /budget contract/],
    [copy => { copy.budget.rgbaBytes += 1; }, /budget contract/]
  ]) {
    const changed = structuredClone(manifest);
    change(changed);
    await fs.writeFile(path.join(root, manifestPath), JSON.stringify(changed));
    await assert.rejects(build.readV13SceneRuntimeArt(root), expected);
  }
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); result.write(type, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, result.length - 4)), result.length - 4);
  return result;
}

function png(width, height, raw, channels = 3) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = channels === 3 ? 2 : 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function replaceFirst(root, manifest, bytes, metadata = {}) {
  const changed = structuredClone(manifest), entry = changed.assets[0];
  Object.assign(entry, metadata, { compressedBytes: bytes.length, sha256: hash(bytes) });
  entry.rgbaBytes = entry.width * entry.height * 4;
  changed.totals.compressedBytes = changed.assets.reduce((sum, asset) => sum + asset.compressedBytes, 0);
  changed.totals.rgbaBytes = changed.assets.reduce((sum, asset) => sum + asset.rgbaBytes, 0);
  await fs.writeFile(path.join(root, sourceRoot + entry.path), bytes);
  await fs.writeFile(path.join(root, manifestPath), JSON.stringify(changed));
}

test('PNG validation rejects missing files, corrupt chunks and invalid compressed pixels even with matching hashes', async t => {
  const { root, build, manifest } = await fixture(t);
  const first = manifest.assets[0], file = path.join(root, sourceRoot + first.path), original = await fs.readFile(file);
  await fs.unlink(file);
  await assert.rejects(build.readV13SceneRuntimeArt(root), { code: 'ENOENT' });
  const corruptedCrc = Buffer.from(original); corruptedCrc[corruptedCrc.length - 1] ^= 1;
  const invalidFilters = Buffer.alloc((first.width * 3 + 1) * first.height); invalidFilters[0] = 5;
  for (const bytes of [Buffer.from('not PNG'), original.subarray(0, original.length - 12), corruptedCrc,
    png(first.width, first.height, Buffer.alloc(1)), png(first.width, first.height, invalidFilters)]) {
    await replaceFirst(root, manifest, bytes);
    await assert.rejects(build.readV13SceneRuntimeArt(root), /dimensions\/signature mismatch|Damaged v1.3 scene PNG/);
  }
});

test('scene compressed and decoded budgets fail independently after valid PNG/hash/manifest updates', async t => {
  const { root, build, manifest } = await fixture(t);
  const original = await fs.readFile(path.join(root, sourceRoot + manifest.assets[0].path));
  const enlarged = Buffer.concat([original.subarray(0, 33), chunk('tEXt', Buffer.alloc(1048576)), original.subarray(33)]);
  await replaceFirst(root, manifest, enlarged);
  await assert.rejects(build.readV13SceneRuntimeArt(root), /budget exceeded: compressedBytes/);
  const decodedLarge = png(960, 960, Buffer.alloc((960 * 3 + 1) * 960));
  await replaceFirst(root, manifest, decodedLarge, { width: 960, height: 960 });
  await assert.rejects(build.readV13SceneRuntimeArt(root), /budget exceeded: decodedBytes/);
});

test('scene copier rejects escaped paths, incomplete contracts and source changes after validation', async t => {
  const { root, build } = await fixture(t), data = await build.readV13SceneRuntimeArt(root);
  await assert.rejects(build.copyV13SceneRuntimeArt(root, ['../outside-scenes'], data), /path outside package/);
  const badPath = structuredClone(data); badPath.entries[0].path = 'assets/art/../outside.png';
  await assert.rejects(build.copyV13SceneRuntimeArt(root, ['web'], badPath), /copy destination/);
  const missing = structuredClone(data); missing.entries.pop();
  await assert.rejects(build.copyV13SceneRuntimeArt(root, ['web'], missing), /copy contract/);
  await fs.writeFile(path.join(root, data.entries[0].sourcePath), 'changed after validation');
  await assert.rejects(build.copyV13SceneRuntimeArt(root, ['web'], data), /copy mismatch/);
});

test('actual built scene pack is byte-identical on both hosts without joining existing preload manifests', async () => {
  const { V13_SCENE_ART_IDS, V13_SCENE_ART_ASSETS } = require('../src/v13-scene-art-manifest');
  const { ART_RUNTIME_IDS } = require('../src/art-manifest');
  const { V13_ART_IDS } = require('../src/v13-art-manifest');
  assert.equal(ART_RUNTIME_IDS.length, 87); assert.equal(V13_ART_IDS.length, 18);
  assert.deepEqual(V13_SCENE_ART_IDS, expectedIds);
  for (const id of expectedIds) {
    assert.ok(!ART_RUNTIME_IDS.includes(id) && !V13_ART_IDS.includes(id));
    const resource = V13_SCENE_ART_ASSETS[id], source = await fs.readFile(path.join(project, resource.sourcePath));
    for (const target of targets) assert.deepEqual(await fs.readFile(path.join(project, target, resource.path)), source);
  }
  const { inspectProject } = await import('../tools/preflight.mjs');
  const report = await inspectProject(project);
  assert.equal(report.codeReady, true);
  assert.equal(report.checks.find(check => check.code === 'v13-scene-art-format').status, 'pass');
  assert.equal(report.checks.find(check => check.code === 'v13-scene-art-budget').status, 'pass');
});
