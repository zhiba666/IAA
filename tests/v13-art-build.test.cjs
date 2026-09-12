'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

const project = path.resolve(__dirname, '..');
const manifestPath = 'art-source/v1.3/manifest.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-v13-art-'));
  t.after(async () => {
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('popcorn-v13-art-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const build = await import('../tools/v13-art-build.mjs');
  const manifest = JSON.parse(await fs.readFile(path.join(project, manifestPath), 'utf8'));
  for (const file of [manifestPath, ...manifest.assets.map(entry => entry.file)]) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.copyFile(path.join(project, file), path.join(root, file));
  }
  return { root, build, manifest };
}

test('v1.3 exports generate a separate runtime manifest and copy exactly to both hosts', async t => {
  const { root, build, manifest } = await fixture(t);
  const data = await build.generateV13RuntimeArt(root);
  const generated = require(path.join(root, 'src/v13-art-manifest.js'));
  assert.equal(data.entries.length, 18);
  assert.deepEqual(data.totals, { compressedBytes: 946983, decodedBytes: 13051392 });
  assert.deepEqual(generated.V13_ART_IDS, manifest.assets.map(entry => entry.id));
  assert.deepEqual(generated.V13_ART_ASSETS, data.assets);
  assert.deepEqual(Object.fromEntries(Object.entries(generated.V13_ART_GROUPS).map(([group, ids]) => [group, ids.length])),
    { products: 7, machines: 5, characters: 3, scene: 2, ui: 1 });
  assert.deepEqual(generated.V13_ART_BUDGETS, { compressedBytes: 1048576, decodedBytes: 16777216 });
  for (const target of ['web', 'build/douyin']) {
    for (const file of ['assets/art/v13/stale/preview.png', 'assets/art/six_gen/keep.png', 'assets/art/v11/keep.png']) {
      await fs.mkdir(path.dirname(path.join(root, target, file)), { recursive: true });
      await fs.writeFile(path.join(root, target, file), 'fixture');
    }
  }
  const report = await build.copyV13RuntimeArt(root, ['web', 'build/douyin'], data);
  assert.equal(report.count, 18);
  assert.equal(report.compressedBytes, data.totals.compressedBytes);
  assert.equal(report.decodedBytes, data.totals.decodedBytes);
  assert.ok(Object.values(report.budgets).every(budget => budget.passed));
  assert.deepEqual(report.targets.map(target => [target.directory, target.verified]), [['web', 18], ['build/douyin', 18]]);
  await assert.rejects(fs.stat(path.join(root, 'output')), { code: 'ENOENT' });
  for (const target of ['web', 'build/douyin']) {
    await assert.rejects(fs.stat(path.join(root, target, 'assets/art/v13/stale/preview.png')), { code: 'ENOENT' });
    for (const version of ['six_gen', 'v11']) {
      assert.equal(await fs.readFile(path.join(root, target, 'assets/art', version, 'keep.png'), 'utf8'), 'fixture');
    }
    const pngs = (await fs.readdir(path.join(root, target, 'assets/art/v13'))).filter(file => file.endsWith('.png'));
    assert.deepEqual(pngs.sort(), manifest.assets.map(entry => entry.id + '.png').sort());
    for (const resource of data.entries) {
      const copied = await fs.readFile(path.join(root, target, resource.path));
      assert.equal(hash(copied), resource.sha256, target + ': ' + resource.id);
      assert.deepEqual(copied, await fs.readFile(path.join(root, resource.sourcePath)));
    }
  }
});

test('v1.3 contract rejects missing and duplicate IDs, altered exports, metadata and escaped paths', async t => {
  const { root, build, manifest } = await fixture(t);
  for (const [change, expected] of [
    [copy => { copy.contractVersion = 'v13-unreviewed'; }, /Invalid v1.3 art contract/],
    [copy => { copy.assets.pop(); }, /18 unique reviewed IDs/],
    [copy => { copy.assets[0] = copy.assets[1]; }, /18 unique reviewed IDs/],
    [copy => { copy.assets[0].file = '../outside.png'; }, /Invalid v1.3 runtime art or export path/],
    [copy => { copy.assets[0].path = 'assets/art/../outside.png'; }, /Invalid v1.3 runtime art or export path/],
    [copy => { copy.assets[0].category = 'machines'; }, /Invalid v1.3 runtime art/],
    [copy => { copy.assets[0].delivery = 'DRAFT'; }, /Invalid v1.3 runtime art/],
    [copy => { copy.assets[0].anchor = [-1, 0]; }, /Invalid v1.3 runtime art/],
    [copy => { copy.assets[0].width += 1; }, /PNG dimensions\/signature mismatch/],
    [copy => { copy.assets[0].sha256 = '0'.repeat(64); }, /SHA-256 mismatch/],
    [copy => { copy.assets[0].bytes += 1; }, /art size mismatch/],
    [copy => { copy.assets[0].decodedBytes += 4; }, /art size mismatch/],
    [copy => { copy.bytes += 1; }, /manifest totals mismatch/]
  ]) {
    const changed = structuredClone(manifest);
    change(changed);
    await fs.writeFile(path.join(root, manifestPath), JSON.stringify(changed));
    await assert.rejects(build.readV13RuntimeArt(root), expected);
  }
});

test('v1.3 build fails for missing, truncated and damaged PNG exports even with a changed hash', async t => {
  const { root, build, manifest } = await fixture(t);
  const first = manifest.assets[0], file = path.join(root, first.file), original = await fs.readFile(file);
  await fs.unlink(file);
  await assert.rejects(build.readV13RuntimeArt(root), { code: 'ENOENT' });
  for (const bytes of [Buffer.from('not a PNG'), original.subarray(0, original.length - 12),
    Buffer.concat([original.subarray(0, original.length - 1), Buffer.from([original.at(-1) ^ 1])])]) {
    const updated = structuredClone(manifest);
    updated.assets[0].sha256 = hash(bytes);
    updated.assets[0].bytes = bytes.length;
    await fs.writeFile(path.join(root, manifestPath), JSON.stringify(updated));
    await fs.writeFile(file, bytes);
    await assert.rejects(build.readV13RuntimeArt(root), /PNG dimensions\/signature mismatch|Damaged v1.3 PNG/);
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

test('v1.3 budgets remain enforced after matching hashes and byte counts are updated', async t => {
  const { root, build, manifest } = await fixture(t);
  const first = manifest.assets[0], file = path.join(root, first.file), original = await fs.readFile(file);
  const ancillary = Buffer.alloc(1048576 + 12);
  ancillary.writeUInt32BE(1048576);
  ancillary.write('tEXt', 4);
  ancillary.writeUInt32BE(crc32(ancillary.subarray(4, ancillary.length - 4)), ancillary.length - 4);
  const enlarged = Buffer.concat([original.subarray(0, 33), ancillary, original.subarray(33)]);
  const largeFile = structuredClone(manifest);
  largeFile.assets[0].bytes = enlarged.length;
  largeFile.assets[0].sha256 = hash(enlarged);
  largeFile.bytes += enlarged.length - original.length;
  await fs.writeFile(file, enlarged);
  await fs.writeFile(path.join(root, manifestPath), JSON.stringify(largeFile));
  await assert.rejects(build.readV13RuntimeArt(root), /budget exceeded: compressedBytes/);

  const hugeDimensions = Buffer.from(original);
  hugeDimensions.writeUInt32BE(2048, 16);
  hugeDimensions.writeUInt32BE(2048, 20);
  hugeDimensions.writeUInt32BE(crc32(hugeDimensions.subarray(12, 29)), 29);
  const largeDecode = structuredClone(manifest);
  Object.assign(largeDecode.assets[0], { width: 2048, height: 2048, decodedBytes: 2048 * 2048 * 4, sha256: hash(hugeDimensions) });
  largeDecode.decodedBytes += largeDecode.assets[0].decodedBytes - first.decodedBytes;
  await fs.writeFile(file, hugeDimensions);
  await fs.writeFile(path.join(root, manifestPath), JSON.stringify(largeDecode));
  await assert.rejects(build.readV13RuntimeArt(root), /budget exceeded: decodedBytes/);
});

test('v1.3 copier rejects escaped targets and catches source changes after validation', async t => {
  const { root, build } = await fixture(t);
  const data = await build.readV13RuntimeArt(root);
  await assert.rejects(build.copyV13RuntimeArt(root, ['../outside-v13'], data), /path outside package/);
  const corrupted = structuredClone(data);
  corrupted.entries[0].path = 'assets/art/../outside.png';
  await assert.rejects(build.copyV13RuntimeArt(root, ['web'], corrupted), /Invalid v1.3 copy destination/);
  await fs.writeFile(path.join(root, data.entries[0].sourcePath), 'changed after manifest validation');
  await assert.rejects(build.copyV13RuntimeArt(root, ['web'], data), /v1.3 art copy mismatch/);
});
