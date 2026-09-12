'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

const project = path.resolve(__dirname, '..');
const manifestPath = 'art-source/six-gen/integration/manifest.json';
const supplementPath = 'art-source/v1.1/manifest.fragment.json';
const assemblyPath = 'art-source/six-gen/integration/assembly.json';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-six-gen-art-'));
  t.after(async () => {
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('popcorn-six-gen-art-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const build = await import('../tools/art-build.mjs');
  const manifest = JSON.parse(await fs.readFile(path.join(project, manifestPath), 'utf8'));
  const supplement = JSON.parse(await fs.readFile(path.join(project, supplementPath), 'utf8'));
  for (const file of [...build.ART_SOURCE_FILES, ...manifest.assets.map(entry => entry.file), ...supplement.assets.map(entry => entry.file)]) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.copyFile(path.join(project, file), path.join(root, file));
  }
  return { root, build, manifest, supplement };
}

test('six-generation and v1.1 copy uses the reviewed final bytes, prunes stale art and enforces delivery budgets', async t => {
  const { root, build, manifest, supplement } = await fixture(t);
  const data = await build.readRuntimeArt(root);
  assert.equal(manifest.assets.length, 84, 'the frozen six-generation source contract remains unchanged');
  assert.equal(supplement.assets.length, 3);
  assert.equal(data.entries.length, 87);
  assert.equal(data.assembly.generationStationRigs.length, 18);
  assert.equal(data.totals.compressedBytes, 1928459);
  assert.equal(data.totals.decodedBytes, 28400528);
  assert.equal(data.totals.firstGenerationCompressedBytes, 924343);
  assert.ok(data.totals.firstGenerationCompressedBytes <= 1048576);
  const old = JSON.parse(await fs.readFile(path.join(root, 'assets/art/manifest.json'), 'utf8'));
  assert.deepEqual(data.assets.machine_pop_body.sourceRect, old.entries.find(entry => entry.id === 'machine_pop_body').sourceRect);
  for (const target of ['web', 'build/douyin']) {
    const files = target === 'web' ? ['index.html', 'game.bundle.js'] :
      ['game.js', 'game.json', 'project.config.json', 'config.js', 'game.bundle.js', ...['upgrade', 'machine', 'click', 'error'].map(id => 'audio/' + id + '.wav')];
    for (const file of [...files, 'assets/art/old/preview.png']) {
      await fs.mkdir(path.dirname(path.join(root, target, file)), { recursive: true });
      await fs.writeFile(path.join(root, target, file), 'fixture');
    }
  }
  const report = await build.copyRuntimeArt(root, ['web', 'build/douyin'], data);
  assert.equal(report.count, 87);
  assert.equal(report.compressedBytes, data.totals.compressedBytes);
  assert.equal(report.decodedBytes, data.totals.decodedBytes);
  assert.equal(report.generationStationRigCount, 18);
  assert.ok(report.sourceFiles.includes(supplementPath));
  assert.deepEqual(report.sourceContracts, [{ contractVersion: 'six-gen-art-1.0', count: 84 }, { contractVersion: 'v11-art-supplement-1', count: 3 }]);
  assert.ok(Object.values(report.budgets).every(budget => budget.passed));
  assert.deepEqual(report.targets.map(target => [target.directory, target.verified]), [['web', 87], ['build/douyin', 87]]);
  await assert.rejects(fs.stat(path.join(root, 'output')), { code: 'ENOENT' });
  for (const target of ['web', 'build/douyin']) {
    await assert.rejects(fs.stat(path.join(root, target, 'assets/art/old/preview.png')), { code: 'ENOENT' });
    const entries = await fs.readdir(path.join(root, target, 'assets/art/six_gen'));
    assert.deepEqual(entries.sort(), manifest.assets.map(entry => entry.id + '.png').sort());
    const additions = await fs.readdir(path.join(root, target, 'assets/art/v11'));
    assert.deepEqual(additions.sort(), supplement.assets.map(entry => entry.id + '.png').sort());
    for (const resource of data.entries) {
      const bytes = await fs.readFile(path.join(root, target, resource.path));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), resource.sha256, target + ': ' + resource.id);
    }
  }
});

test('v1.1 supplement keeps reviewed hashes, shared-stage membership, provenance and export paths', async t => {
  const { root, build, supplement } = await fixture(t);
  const data = await build.readRuntimeArt(root);
  for (const entry of supplement.assets) {
    const asset = data.assets[entry.id];
    assert.equal(asset.source, entry.sourceFile);
    assert.equal(asset.provenanceRef, entry.provenanceRef);
    assert.equal(asset.contractVersion, supplement.contractVersion);
    assert.deepEqual(asset.anchor, entry.anchor);
    assert.deepEqual(asset.sourceRect, [0, 0, entry.width, entry.height]);
    assert.deepEqual(asset.stageUse, [1, 2, 3, 4, 5, 6]);
    assert.ok(data.firstGenerationIds.includes(entry.id));
  }
  const first = supplement.assets[0];
  const source = path.join(root, first.file);
  const originalBytes = await fs.readFile(source);
  const corrupted = Buffer.from(originalBytes);
  corrupted[corrupted.length - 1] ^= 1;
  await fs.writeFile(source, corrupted);
  await assert.rejects(build.readRuntimeArt(root), /SHA-256 mismatch/);
  await fs.writeFile(source, originalBytes);

  for (const [change, expected] of [
    [copy => { copy.assets.pop(); }, /v1.1 art supplement contract/],
    [copy => { copy.assets[0] = copy.assets[1]; }, /v1.1 art supplement contract/],
    [copy => { copy.assets[0].file = '../outside.png'; }, /Invalid runtime art/],
    [copy => { copy.assets[0].status = 'EXPORTED_ART_ONLY'; }, /Invalid runtime art/],
    [copy => { copy.assets[0].stageUse = [7]; }, /Invalid runtime art/],
    [copy => { copy.assets[0].stageUse = [2]; }, /all six stages/],
    [copy => { delete copy.assets[0].provenanceRef; }, /Missing v1.1 art provenance/],
    [copy => { copy.assets[0].bytes += 1; }, /art size mismatch/]
  ]) {
    const invalid = structuredClone(supplement);
    change(invalid);
    await fs.writeFile(path.join(root, supplementPath), JSON.stringify(invalid));
    await assert.rejects(build.readRuntimeArt(root), expected);
  }
});

test('reviewed-art validation rejects corrupted pixels, invalid geometry, broken rig coverage and escaped paths', async t => {
  const { root, build, manifest } = await fixture(t);
  const first = manifest.assets[0];
  const originalBytes = await fs.readFile(path.join(root, first.file));
  const originalAssembly = JSON.parse(await fs.readFile(path.join(root, assemblyPath), 'utf8'));
  const save = (file, value) => fs.writeFile(path.join(root, file), JSON.stringify(value));

  const corrupted = Buffer.from(originalBytes);
  corrupted[corrupted.length - 1] ^= 1;
  await fs.writeFile(path.join(root, first.file), corrupted);
  await assert.rejects(build.readRuntimeArt(root), /SHA-256 mismatch/);
  await fs.writeFile(path.join(root, first.file), originalBytes);

  const wrongDimensions = structuredClone(manifest);
  wrongDimensions.assets[0].width += 1;
  await save(manifestPath, wrongDimensions);
  await assert.rejects(build.readRuntimeArt(root), /PNG dimensions\/signature/);

  const escaped = structuredClone(manifest);
  escaped.assets[0].file = '../outside.png';
  await save(manifestPath, escaped);
  await assert.rejects(build.readRuntimeArt(root), /Invalid runtime art/);
  await save(manifestPath, manifest);

  const brokenReference = structuredClone(originalAssembly);
  brokenReference.generationStationRigs[0].rig.layers[0].id = 'machine_missing';
  await save(assemblyPath, brokenReference);
  await assert.rejects(build.readRuntimeArt(root), /omitted runtime art/);

  const badRectangle = structuredClone(originalAssembly);
  badRectangle.generationStationRigs[0].rig.layers[0].rect[2] = -1;
  await save(assemblyPath, badRectangle);
  await assert.rejects(build.readRuntimeArt(root), /Invalid assembly rectangle/);

  const duplicateStage = structuredClone(originalAssembly);
  duplicateStage.generationStationRigs[17] = duplicateStage.generationStationRigs[0];
  await save(assemblyPath, duplicateStage);
  await assert.rejects(build.readRuntimeArt(root), /18 generation\/station combinations/);
  await save(assemblyPath, originalAssembly);

  // Even an updated reviewed hash cannot allow an oversized runtime resource.
  const tooLarge = Buffer.concat([originalBytes, Buffer.alloc(1048576)]);
  const oversized = structuredClone(manifest);
  oversized.assets[0].sha256 = createHash('sha256').update(tooLarge).digest('hex');
  await fs.writeFile(path.join(root, first.file), tooLarge);
  await save(manifestPath, oversized);
  await assert.rejects(build.readRuntimeArt(root), /budget exceeded: firstGenerationCompressedBytes/);
});
