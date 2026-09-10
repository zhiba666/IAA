import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { ART_ASSETS } = require('../src/art-manifest');
const directory = path.join(root, 'output/six-gen-runtime/runtime-captures');
const bundle = path.join(root, 'web/game.bundle.js');
const builtAt = (await fs.stat(bundle)).mtimeMs;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bundleSha256 = sha(await fs.readFile(bundle));
let captureBuildAt = builtAt;
try {
  const previous = JSON.parse(await fs.readFile(path.join(root, 'output/six-gen-runtime/capture-report.json'), 'utf8'));
  if (previous.bundleSha256 === bundleSha256) captureBuildAt = Date.parse(previous.captureBuildAt || previous.builtAt);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const rows = [];
for (const file of await fs.readdir(directory)) {
  if (!file.endsWith('.json') || file === 'request-report.json') continue;
  const capture = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
  if (!capture.presentation || Date.parse(capture.capturedAt) < captureBuildAt) continue;
  rows.push({ file, ...capture });
}
const selected = [];
for (const width of [390, 320]) for (const configuration of ['entry', 'upgraded']) for (let generation = 1; generation <= 6; generation++) {
  const fixture = `g${generation}-${configuration}`;
  const row = rows.filter(row => row.fixture === fixture && row.viewSize.width === width && row.safeArea.top === 0)
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
  assert.ok(row, `Missing final-build capture ${fixture}/${width}`);
  assert.equal(row.presentation.art.loaded, 84, row.file);
  assert.equal(row.presentation.art.failed, 0, row.file);
  assert.equal(row.errors.length, 0, row.file);
  assert.equal(row.snapshot.state.machine, generation - 1);
  for (const [id, asset] of Object.entries(ART_ASSETS)) assert.equal(row.assetShas[id], asset.sha256);
  for (const station of row.snapshot.stations) {
    const machine = row.presentation.scene.machines.find(item => item.stationId === station.id);
    const jobs = job => ({ amount: job.amount, progress: job.progress, complete: job.complete });
    assert.deepEqual(machine.jobs.map(jobs), station.jobs.filter(Boolean).map(jobs), row.file + '/' + station.id);
  }
  for (const connection of row.presentation.scene.connections) assert.ok(connection.gap <= 2);
  const png = row.file.replace(/\.json$/, '.png');
  const bytes = await fs.readFile(path.join(directory, png));
  assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
  selected.push({ fixture, generation, configuration, width, height: row.viewSize.height,
    capturedAt: row.capturedAt, png, metadata: row.file, pngSha256: sha(bytes), assetsLoaded: 84, errors: 0 });
}
const report = { status: 'VERIFIED_RUNTIME', deviceStatus: 'NOT_RUN', capturedFrom: 'Chrome / formal web bundle / isolated acceptance fixtures',
  generatedAt: new Date().toISOString(), bundleSha256, builtAt: new Date(builtAt).toISOString(), captureBuildAt: new Date(captureBuildAt).toISOString(),
  count: selected.length, mainCaptures: selected, extraCaptures: rows.filter(row => !selected.some(item => item.metadata === row.file)).map(row => ({
    file: row.file, fixture: row.fixture, width: row.viewSize.width, safeArea: row.safeArea,
    loaded: row.presentation.art.loaded, failed: row.presentation.art.failed, errors: row.errors.length
  })) };
const output = path.join(root, 'output/six-gen-runtime');
await fs.writeFile(path.join(output, 'capture-report.json'), JSON.stringify(report, null, 2) + '\n');
await fs.writeFile(path.join(output, 'capture-report.md'), `# 六代正式浏览器截图\n\nChrome 中运行最终正式 bundle，24 张基础截图均解码 84/84 PNG、无运行错误。逐图比对真实批次与场景诊断、资源 SHA 和端口接缝。边界 fixture 与真机验证分别记录。\n\n构建 SHA-256：\`${report.bundleSha256}\`。\n\n真机：NOT_RUN。\n\n| 场景 | 视口 | 截图 |\n| --- | --- | --- |\n` + selected.map(row => `| ${row.fixture} | ${row.width}×${row.height} | [PNG](runtime-captures/${row.png}) |`).join('\n') + '\n');
console.log(JSON.stringify({ count: report.count, bundleSha256: report.bundleSha256, output }, null, 2));
