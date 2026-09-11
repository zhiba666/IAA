import { readFile, writeFile, mkdir, copyFile, readdir, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// The original first-generation dependency list remains useful to legacy rigs.
// Runtime delivery combines the frozen six-generation contract and the reviewed
// v1.1 supplement. Historical source contracts remain independently verifiable.
export const FIRST_GENERATION_IDS = [
  'machine_pop_body', 'machine_pop_head', 'machine_pop_front',
  'machine_cup_body', 'machine_cup_head', 'machine_cup_front',
  'machine_ship_body', 'machine_ship_head', 'machine_ship_front',
  'buffer_bulk_back', 'buffer_bulk_front', 'buffer_cups_back', 'buffer_cups_front',
  'conveyor_down_right', 'conveyor_front_right', 'conveyor_down_left', 'conveyor_front_left',
  'conveyor_outfeed_back', 'conveyor_outfeed_front',
  'conveyor_transfer_back', 'conveyor_transfer_front',
  'product_kernel_a', 'product_kernel_b', 'product_cup_empty', 'product_cup_fill',
  'factory_room', 'factory_window', 'fx_sparkle',
  'ui_hud_coin', 'ui_hud_rate', 'ui_panel', 'ui_button_primary', 'ui_button_secondary',
  'ui_button_disabled', 'ui_card', 'ui_compact_bar',
  ...['coin', 'pop', 'cup', 'ship', 'settings'].map(id => 'ui_icon_' + id)
];
export const ART_SOURCE_FILES = ['assets/art/manifest.json', 'art-source/six-gen/integration/legacy/batch-0-assembly.json',
  'art-source/six-gen/integration/legacy/batch-1-machinery-assembly.json', 'art-source/six-gen/integration/manifest.json',
  'art-source/six-gen/integration/assembly.json', 'art-source/v1.1/manifest.fragment.json'];
const V11_ASSET_FOLDERS = { ui_gesture_hand: 'hand', factory_floor_extension: 'floor', factory_wall_corner: 'wall' };
export const ART_BUDGETS = { firstGenerationCompressedBytes: 1048576,
  compressedBytes: 4 * 1048576, decodedBytes: 32 * 1048576 };

function contained(root, file) {
  const resolved = path.resolve(root, file);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('Art path outside package: ' + file);
  return resolved;
}
function normalizeRig(rig) {
  const result = { ...rig };
  result.layers = (rig.layers || Object.entries(rig).filter(([, value]) => value && value.id && value.rect)
    .map(([part, value]) => ({ part, ...value }))).map(layer => ({ ...layer }));
  // Cup occupancy comes from the actual job, never an unconditional art layer.
  if (result.cup) result.layers = result.layers.filter(layer => layer.part !== 'cup');
  if (!result.clickRegion && result.size) {
    const [w, h] = result.size;
    result.clickRegion = [[0, 0], [w, 0], [w, h], [0, h]];
  }
  return result;
}

export async function readRuntimeArt(root) {
  const [manifest, batch0, machinery, reviewed, assembly, supplement] = await Promise.all(ART_SOURCE_FILES.map(async file =>
    JSON.parse(await readFile(path.join(root, file), 'utf8'))));
  const byId = new Map(manifest.entries.map(entry => [entry.id, entry]));
  const assets = {}, entries = [];
  if (reviewed.contractVersion !== 'six-gen-art-1.0' || assembly.contractVersion !== reviewed.contractVersion ||
      !Array.isArray(reviewed.assets) || reviewed.assets.length !== 84) throw new Error('Invalid reviewed six-generation art contract');
  if (supplement.schemaVersion !== 1 || supplement.contractVersion !== 'v11-art-supplement-1' ||
      !Array.isArray(supplement.assets) || supplement.assets.length !== 3 ||
      Object.keys(V11_ASSET_FOLDERS).some(id => supplement.assets.filter(entry => entry.id === id).length !== 1)) {
    throw new Error('Invalid reviewed v1.1 art supplement contract');
  }
  for (const [entry, isSupplement] of [...reviewed.assets.map(entry => [entry, false]), ...supplement.assets.map(entry => [entry, true])]) {
    const { id } = entry;
    const expectedFile = isSupplement ? 'art-source/v1.1/' + V11_ASSET_FOLDERS[id] + '/exports/' + id + '.png' :
      'art-source/six-gen/integration/exports/' + id + '.png';
    if (!/^[a-z_]+$/.test(id) || assets[id] || entry.status !== 'EXPORTED' ||
        entry.file !== expectedFile || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !Number.isInteger(entry.width) || !Number.isInteger(entry.height) || entry.width <= 0 || entry.height <= 0 ||
        !Array.isArray(entry.anchor) || entry.anchor.length !== 2 || !entry.anchor.every(Number.isFinite) ||
        !Array.isArray(entry.stageUse) || !entry.stageUse.length || entry.stageUse.some(stage => !Number.isInteger(stage) || stage < 1 || stage > 6)) {
      throw new Error('Invalid runtime art: ' + id);
    }
    if (isSupplement && (entry.folder !== V11_ASSET_FOLDERS[id] ||
        typeof entry.sourceFile !== 'string' || !entry.sourceFile.startsWith('art-source/v1.1/' + entry.folder + '/sources/') ||
        typeof entry.provenanceRef !== 'string' || !entry.provenanceRef.startsWith('art-source/v1.1/' + entry.folder + '/'))) {
      throw new Error('Missing v1.1 art provenance: ' + id);
    }
    if (isSupplement && (entry.stageUse.length !== 6 || [1, 2, 3, 4, 5, 6].some(stage => !entry.stageUse.includes(stage)))) {
      throw new Error('v1.1 shared art must include all six stages: ' + id);
    }
    const bytes = await readFile(contained(root, entry.file));
    if (bytes.length < 33 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
        bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) !== entry.width || bytes.readUInt32BE(20) !== entry.height) {
      throw new Error('PNG dimensions/signature disagree with art manifest: ' + id);
    }
    const resource = { id, path: 'assets/art/' + (isSupplement ? 'v11' : 'six_gen') + '/' + id + '.png', sourcePath: entry.file,
      width: entry.width, height: entry.height, bytes: bytes.length, stageUse: entry.stageUse,
      decodedBytes: entry.width * entry.height * 4, sha256: createHash('sha256').update(bytes).digest('hex'),
      contractVersion: isSupplement ? supplement.contractVersion : reviewed.contractVersion, provenanceRef: entry.provenanceRef };
    if (resource.sha256 !== entry.sha256) throw new Error('Reviewed art SHA-256 mismatch: ' + id);
    if (isSupplement && (resource.bytes !== entry.bytes || resource.decodedBytes !== entry.decodedBytes)) {
      throw new Error('Reviewed v1.1 art size mismatch: ' + id);
    }
    // Optimized PNGs retain the old crop's source coordinate space. The drawing
    // helper maps that crop to the new pixel dimensions with a uniform fit.
    const original = byId.get(id);
    assets[id] = { ...resource, anchor: entry.anchor, source: original?.source || entry.sourceFile,
      sourceRect: original?.sourceRect || [0, 0, entry.width, entry.height],
      ...(original?.nineSlice ? { sourceBorder: original.nineSlice.left * entry.width / original.width } : {}) };
    entries.push(resource);
  }
  const rigs = Object.fromEntries([
    ...['cupMachine', 'cupProduct', 'bulkBuffer', 'conveyorRight', 'conveyorLeft'].map(id => [id, normalizeRig(batch0[id])]),
    ...['popMachine', 'shipMachine', 'cupsBuffer', 'conveyorOutfeed', 'conveyorTransfer'].map(id => [id, normalizeRig(machinery[id])])
  ]);
  // Keep first-generation shipping single-cup; later jobs select the reviewed
  // tray/box assemblies from their own retained job.amount.
  rigs.shipMachine.content = { ids: ['product_cup_empty', 'product_cup_fill'], layer: 30,
    singleCup: machinery.shipMachine.content.singleCup };
  for (const [name, rig] of Object.entries(rigs)) for (const layer of rig.layers) {
    if (!assets[layer.id]) throw new Error('Rig references omitted runtime art: ' + name + '/' + layer.id);
    const asset = byId.get(layer.id), [, , w, h] = layer.rect;
    if (Math.abs((w / h) / (asset.width / asset.height) - 1) > 0.004) throw new Error('Nonuniform source assembly: ' + name + '/' + layer.id);
  }
  validateAssembly(assembly, assets);
  const combinations = assembly.generationStationRigs.map(item => item.generation + ':' + item.stationId);
  const expected = Array.from({ length: 6 }, (_, index) => ['pop', 'cup', 'ship'].map(id => (index + 1) + ':' + id)).flat();
  if (combinations.length !== 18 || new Set(combinations).size !== 18 || expected.some(id => !combinations.includes(id))) {
    throw new Error('Six-generation assembly must define each of 18 generation/station combinations once');
  }
  const firstGenerationIds = entries.filter(entry => entry.stageUse.includes(1)).map(entry => entry.id);
  const totals = { firstGenerationCompressedBytes: firstGenerationIds.reduce((sum, id) => sum + assets[id].bytes, 0),
    compressedBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    decodedBytes: entries.reduce((sum, entry) => sum + entry.decodedBytes, 0) };
  for (const [key, limit] of Object.entries(ART_BUDGETS)) {
    if (totals[key] > limit) throw new Error('Runtime art budget exceeded: ' + key + ' ' + totals[key] + ' > ' + limit);
  }
  return { assets, rigs, entries, assembly, firstGenerationIds, totals,
    sourceContracts: [{ contractVersion: reviewed.contractVersion, count: reviewed.assets.length },
      { contractVersion: supplement.contractVersion, count: supplement.assets.length }] };
}

// Rectangle containers can intentionally differ from the source image aspect
// ratio: drawArtLayer uses contain/one uniform scale, never stretching a sprite.
// Validate geometry and every sprite reference without rewriting frozen rigs.
function validateAssembly(node, assets, location = 'assembly') {
  if (!node || typeof node !== 'object') return;
  const spriteLayer = /\.(layers|parts)\.\d+$/.test(location) && node.id;
  if (Object.hasOwn(node, 'rect') || spriteLayer) {
    if (!Array.isArray(node.rect) || node.rect.length !== 4 || !node.rect.every(Number.isFinite) || node.rect[2] <= 0 || node.rect[3] <= 0) {
      throw new Error('Invalid assembly rectangle: ' + location);
    }
    const packagingSlot = /^assembly\.packaging\.(doubleTray|fourCupBox)\.slots\.\d+$/.test(location);
    if (node.id && !packagingSlot && !assets[node.id]) throw new Error('Assembly references omitted runtime art: ' + location + '/' + node.id);
  }
  if (node.size && (!Array.isArray(node.size) || node.size.length !== 2 || !node.size.every(value => Number.isFinite(value) && value > 0))) {
    throw new Error('Invalid assembly canvas size: ' + location);
  }
  if (Array.isArray(node.ids)) for (const id of node.ids) {
    if (!assets[id]) throw new Error('Assembly references omitted runtime art: ' + location + '/' + id);
  }
  for (const [key, value] of Object.entries(node)) validateAssembly(value, assets, location + '.' + key);
}

export async function generateRuntimeArt(root) {
  const data = await readRuntimeArt(root);
  const source = "'use strict';\n// Generated by tools/art-build.mjs from reviewed art-source assemblies.\n" +
    '// Original artwork status/history is deliberately preserved in its source files.\n' +
    'const ART_ASSETS = ' + JSON.stringify(data.assets) + ';\n' +
    'const ART_RIGS = ' + JSON.stringify(data.rigs) + ';\n' +
    'const ART_RUNTIME_IDS = ' + JSON.stringify(data.entries.map(entry => entry.id)) + ';\n' +
    'const ART_FIRST_GENERATION_IDS = ' + JSON.stringify(data.firstGenerationIds) + ';\n' +
    'const ART_SIX_GEN_ASSEMBLY = ' + JSON.stringify(data.assembly) + ';\n' +
    'const ART_GENERATION_RIGS = ART_SIX_GEN_ASSEMBLY.generationStationRigs;\n' +
    'const ART_SIX_GEN = { logistics: ART_SIX_GEN_ASSEMBLY.logistics, scene: ART_SIX_GEN_ASSEMBLY.scene, ui: ART_SIX_GEN_ASSEMBLY.ui, packaging: ART_SIX_GEN_ASSEMBLY.packaging };\n' +
    'const SIX_GEN_RIGS = ART_GENERATION_RIGS, SIX_GEN_LOGISTICS = ART_SIX_GEN.logistics, SIX_GEN_SCENE = ART_SIX_GEN.scene, SIX_GEN_PACKAGING = ART_SIX_GEN.packaging;\n' +
    'const ART_SOURCE_REFS = ' + JSON.stringify(ART_SOURCE_FILES) + ';\n' +
    'module.exports = { ART_ASSETS, ART_RIGS, ART_RUNTIME_IDS, ART_FIRST_GENERATION_IDS, ART_SOURCE_REFS, ART_GENERATION_RIGS, ART_SIX_GEN, ART_SIX_GEN_ASSEMBLY, SIX_GEN_RIGS, SIX_GEN_LOGISTICS, SIX_GEN_SCENE, SIX_GEN_PACKAGING };\n';
  await writeFile(path.join(root, 'src/art-manifest.js'), source);
  return data;
}

export async function copyRuntimeArt(root, targets, data) {
  const permitted = new Set(data.entries.map(entry => entry.path));
  for (const target of targets) {
    const outputRoot = contained(root, target);
    const artDir = contained(outputRoot, 'assets/art');
    // Prune only stale generated runtime art; never touch the source art tree.
    async function prune(directory) {
      let children;
      try { children = await readdir(directory, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const child of children) {
        const file = contained(artDir, path.relative(artDir, path.join(directory, child.name)));
        if (child.isSymbolicLink()) throw new Error('Symlink inside runtime art output');
        if (child.isDirectory()) await prune(file);
        else if (!permitted.has(path.relative(outputRoot, file).replaceAll('\\', '/'))) await unlink(file);
      }
    }
    await prune(artDir);
    for (const entry of data.entries) {
      const dest = contained(outputRoot, entry.path);
      await mkdir(path.dirname(dest), { recursive: true });
      if ((await lstat(path.dirname(dest))).isSymbolicLink()) throw new Error('Symlink in runtime art output');
      await copyFile(contained(root, entry.sourcePath), dest);
      const copied = await readFile(dest);
      if (createHash('sha256').update(copied).digest('hex') !== entry.sha256) throw new Error('Art copy mismatch: ' + entry.id);
    }
  }
  const packages = await Promise.all(targets.map(async target => {
    const runtimeFiles = target === 'web' ? ['index.html', 'game.bundle.js'] :
      ['game.js', 'game.json', 'project.config.json', 'config.js', 'game.bundle.js', ...['upgrade', 'machine', 'click', 'error'].map(id => 'audio/' + id + '.wav')];
    const entries = await Promise.all(runtimeFiles.map(async file => ({ path: file, bytes: (await lstat(contained(path.join(root, target), file))).size })));
    return { directory: target, verified: data.entries.length, missing: [], mismatched: [],
      otherRuntimeFiles: entries, totalRuntimeBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0) + data.entries.reduce((sum, entry) => sum + entry.bytes, 0) };
  }));
  const report = { schemaVersion: 2, scope: 'six-generation-runtime-art-with-v11-supplement', sourceFiles: ART_SOURCE_FILES,
    sourceContracts: data.sourceContracts,
    count: data.entries.length, compressedBytes: data.entries.reduce((sum, entry) => sum + entry.bytes, 0),
    decodedBytes: data.entries.reduce((sum, entry) => sum + entry.decodedBytes, 0),
    generationStationRigCount: data.assembly.generationStationRigs.length,
    firstGenerationIds: data.firstGenerationIds, firstGenerationCompressedBytes: data.totals.firstGenerationCompressedBytes,
    budgets: Object.fromEntries(Object.entries(ART_BUDGETS).map(([key, limit]) => [key, { limit, actual: data.totals[key], passed: data.totals[key] <= limit }])),
    targets: packages,
    excluded: ['reference sheets', 'raw source images', 'preview images', 'art-only fixture scripts'],
    entries: data.entries };
  await mkdir(path.join(root, 'output/six-gen-art-runtime'), { recursive: true });
  await writeFile(path.join(root, 'output/six-gen-art-runtime/resource-report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(root, 'output/six-gen-art-runtime/resource-report.md'),
    '# 六代与 v1.1 补充运行资源体积与构建复制检查\n\n' +
    `运行 PNG：${report.count} 个；压缩文件 ${report.compressedBytes.toLocaleString('en-US')} bytes（${(report.compressedBytes / 1048576).toFixed(2)} MiB）；RGBA 解码估算 ${(report.decodedBytes / 1048576).toFixed(2)} MiB。\n\n` +
    `首代与共享依赖 ${report.firstGenerationIds.length} 个，共 ${report.firstGenerationCompressedBytes.toLocaleString('en-US')} bytes；18 组代际/工位装配引用和矩形检查通过。首代 1 MiB、全部 PNG 4 MiB、RGBA 32 MiB 预算均通过。\n\n` +
    packages.map(target => `- ${target.directory}：${report.count} 个资源逐文件 SHA-256 复制校验通过；包含代码、入口及该端音效的运行文件合计 ${(target.totalRuntimeBytes / 1048576).toFixed(2)} MiB。`).join('\n') +
    `\n\n运行图片仅复制原六代冻结合同的 84 个 PNG 与 v1.1 独立补充合同的 3 个 PNG，共 ${report.count} 个最终导出文件；原图、预览与美术 fixture 不进入运行包。旧装配原始坐标和 sourceRect 保留，运行时等比适配优化后的 PNG 尺寸。本报告证明清单、构建复制和预算检查通过；实际浏览器加载、状态表现与真机验收须分别记录。\n`);
  return report;
}
