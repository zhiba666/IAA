'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

const project = path.resolve(__dirname, '..');
const manifestPath = 'art-source/six-gen/integration/manifest.json';
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
  for (const file of [...build.ART_SOURCE_FILES, ...manifest.assets.map(entry => entry.file)]) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.copyFile(path.join(project, file), path.join(root, file));
  }
  return { root, build, manifest };
}

test('six-generation copy uses the reviewed final bytes, prunes stale art and enforces delivery budgets', async t => {
  const { root, build, manifest } = await fixture(t);
  const data = await build.readRuntimeArt(root);
  assert.equal(data.entries.length, 84);
  assert.equal(data.assembly.generationStationRigs.length, 18);
  assert.equal(data.totals.compressedBytes, 1846247);
  assert.equal(data.totals.decodedBytes, 26848144);
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
  assert.equal(report.generationStationRigCount, 18);
  assert.ok(Object.values(report.budgets).every(budget => budget.passed));
  for (const target of ['web', 'build/douyin']) {
    await assert.rejects(fs.stat(path.join(root, target, 'assets/art/old/preview.png')), { code: 'ENOENT' });
    const entries = await fs.readdir(path.join(root, target, 'assets/art/six_gen'));
    assert.deepEqual(entries.sort(), manifest.assets.map(entry => entry.id + '.png').sort());
    for (const resource of data.entries) {
      const bytes = await fs.readFile(path.join(root, target, resource.path));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), resource.sha256, target + ': ' + resource.id);
    }
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
