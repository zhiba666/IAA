'use strict';

// Standalone v1.3 process-art pack. This script never writes assets/ or a runtime preload.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');

function loadSharp() {
  const candidates = [
    process.env.IAA_SHARP_MODULE,
    'sharp',
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('sharp is unavailable; set IAA_SHARP_MODULE to the installed sharp module directory.');
}

const sharp = loadSharp();
const base = __dirname;
const root = path.resolve(base, '../..');
const CONTRACT = 'v13-process-art-1';
const PADDING = 4;
const BUDGET = Object.freeze({ compressedBytes: 512 * 1024, decodedBytes: 3 * 1024 * 1024 });
const SPECS = [
  { id: 'machine_caramel_coater_empty', label: '空载琥珀裹糖机', category: 'machine', maxSize: 480, anchorType: 'bottom-center' },
  { id: 'material_original_popcorn', label: '原味爆米花物料', category: 'materials', maxSize: 192, anchorType: 'bottom-center' },
  { id: 'material_caramel_popcorn', label: '焦糖爆米花物料', category: 'materials', maxSize: 192, anchorType: 'bottom-center' },
  { id: 'caramel_syrup_flow', label: '焦糖浆流', category: 'machine', maxSize: 192, anchorType: 'top-center' },
  { id: 'product_caramel_tub_empty', label: '空焦糖包装桶', category: 'packaging', maxSize: 256, anchorType: 'bottom-center' },
];
const QA_FILES = [
  { file: 'qa/contact-sheet.png', width: 1280, height: 332 },
  { file: 'qa/three-backgrounds.png', width: 1280, height: 900 },
];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const esc = text => String(text).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const check = (condition, message) => { if (!condition) throw new Error(message); };

function inside(relative) {
  check(typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative), 'Expected package-relative path: ' + relative);
  const file = path.resolve(base, relative);
  check(file.startsWith(base + path.sep), 'Path outside process-art package: ' + relative);
  return file;
}

function provenanceSourceMatches(value, expected) {
  if (typeof value !== 'string') return false;
  return [path.resolve(base, value), path.resolve(root, value)].includes(expected);
}

async function inspect(file) {
  const meta = await sharp(file).metadata();
  check(meta.format === 'png' && meta.hasAlpha, 'Expected PNG with genuine alpha: ' + file);
  const { data, info } = await sharp(file).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  check(info.channels === 4, 'RGBA decoding failed: ' + file);
  let clear = 0, partial = 0, edge = 0, visible = 0;
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const alpha = data[(y * info.width + x) * 4 + 3];
    if (alpha === 0) clear++;
    else {
      visible++;
      if (alpha < 255) partial++;
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) edge++;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  check(visible > 0 && clear >= info.width * info.height * 0.1, 'Insufficient actual transparent pixels or empty sprite: ' + file);
  return {
    width: info.width, height: info.height, channels: info.channels,
    clear, partial, visible, edge,
    bounds: [x0, y0, x1 - x0 + 1, y1 - y0 + 1],
    margins: { top: y0, right: info.width - x1 - 1, bottom: info.height - y1 - 1, left: x0 },
  };
}

function validateProvenance(spec, provenance, source) {
  check(Array.isArray(provenance.assets), 'Missing provenance assets array: ' + spec.id);
  const ids = provenance.assets.map(asset => asset.id);
  check(new Set(ids).size === ids.length, 'Duplicate provenance asset ID: ' + spec.category);
  const matches = provenance.assets.filter(asset => asset.id === spec.id);
  check(matches.length === 1, 'Missing or duplicate provenance entry: ' + spec.id);
  const entry = matches[0];
  check(provenanceSourceMatches(entry.source, source), 'Provenance source path mismatch: ' + spec.id);
  if (entry.sourceSha256) check(entry.sourceSha256 === sha(source), 'Provenance source SHA mismatch: ' + spec.id);
  if (entry.sha256) check(entry.sha256 === sha(source), 'Provenance SHA mismatch: ' + spec.id);
}

async function sourceInput(spec) {
  const source = `${spec.category}/sources/${spec.id}.png`;
  const prompt = `${spec.category}/prompts/${spec.id}.txt`;
  const provenance = `${spec.category}/provenance.json`;
  const sourceFile = inside(source), promptFile = inside(prompt), provenanceFile = inside(provenance);
  const promptText = fs.readFileSync(promptFile, 'utf8');
  check(promptText.trim().length >= 80, 'Missing or incomplete generation prompt: ' + spec.id);
  validateProvenance(spec, read(provenanceFile), sourceFile);
  return {
    spec, source, prompt, provenance, sourceFile,
    original: await inspect(sourceFile),
    sourceSha256: sha(sourceFile), promptSha256: sha(promptFile), provenanceSha256: sha(provenanceFile),
  };
}

async function exportSprite(input) {
  const { spec, original, sourceFile } = input;
  const [left, top, width, height] = original.bounds;
  const resized = await sharp(sourceFile)
    .extract({ left, top, width, height })
    .resize(spec.maxSize - PADDING * 2, spec.maxSize - PADDING * 2, {
      fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3',
    })
    .toColourspace('srgb').ensureAlpha().png().toBuffer();
  await sharp(resized)
    .extend({ top: PADDING, bottom: PADDING, left: PADDING, right: PADDING, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, effort: 10, palette: false })
    .toFile(inside(`exports/${spec.id}.png`));
}

async function assetMetadata(input) {
  const { spec, original } = input;
  const file = `exports/${spec.id}.png`, output = inside(file), alpha = await inspect(output);
  check(alpha.width <= spec.maxSize && alpha.height <= spec.maxSize, 'Export exceeds size limit: ' + spec.id);
  check(alpha.edge === 0 && Object.values(alpha.margins).every(value => value >= PADDING), 'Export must retain four fully transparent border pixels: ' + spec.id);
  const anchor = [alpha.width / 2, spec.anchorType === 'top-center' ? PADDING : alpha.height - PADDING];
  return {
    ...spec, generation: 2, source: input.source, prompt: input.prompt, provenance: input.provenance,
    file, url: file, width: alpha.width, height: alpha.height,
    bytes: fs.statSync(output).size, decodedBytes: alpha.width * alpha.height * 4,
    sha256: sha(output), sourceSha256: input.sourceSha256, promptSha256: input.promptSha256,
    provenanceSha256: input.provenanceSha256,
    sourceSize: [original.width, original.height], sourceRect: original.bounds,
    sourceBoundaryNontransparentPixels: original.edge,
    anchor, anchorUnits: 'export-pixels', padding: PADDING, alpha,
    delivery: 'ART_READY', gameplay: 'NOT_INTEGRATED',
    transform: 'Crop true alpha bounds; uniform Lanczos3 downscale without enlargement; 4px transparent padding. Source pixels and prompts retained.',
  };
}

async function overview(assets) {
  const width = 1280, cellW = 256, header = 64, height = 332;
  const layers = [], labels = [
    '<text x="20" y="29" font-size="21" fill="#173b45">IAA v1.3 / CARAMEL PROCESS ART</text>',
    '<text x="20" y="50" font-size="12" fill="#546c75">5 standalone sprites / actual alpha / source-preserving exports / gameplay not integrated</text>',
  ];
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i], x = i * cellW;
    const sprite = await sharp(inside(asset.file)).resize(230, 204, { fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    layers.push({ input: sprite.data, left: x + Math.floor((cellW - sprite.info.width) / 2), top: header + Math.floor((212 - sprite.info.height) / 2) });
    labels.push(`<text x="${x + 12}" y="290" font-size="14" fill="#173b45">${esc(asset.label)}</text>`);
    labels.push(`<text x="${x + 12}" y="307" font-size="10" fill="#546c75">${esc(asset.id)}</text>`);
    labels.push(`<text x="${x + 12}" y="323" font-size="10" fill="#546c75">${asset.width} x ${asset.height} / ${(asset.bytes / 1024).toFixed(1)} KiB / ${asset.anchorType}</text>`);
  }
  const grid = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="checker" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#e9edef"/><path d="M0 0H10V10H0ZM10 10H20V20H10Z" fill="#dce3e6"/></pattern></defs><rect width="${width}" height="${height}" fill="#f4f7f8"/><rect y="${header}" width="${width}" height="212" fill="url(#checker)"/></svg>`);
  layers.unshift({ input: grid, left: 0, top: 0 });
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g font-family="Microsoft YaHei,Arial">${labels.join('')}</g></svg>`), left: 0, top: 0 });
  await sharp({ create: { width, height, channels: 4, background: '#f4f7f8' } }).composite(layers).png().toFile(inside('qa/contact-sheet.png'));

  const backdrops = [
    { color: '#ffffff', text: '#173b45', name: 'WHITE / #FFFFFF' },
    { color: '#183943', text: '#f1f7f8', name: 'DARK / #183943' },
    { color: '#8ac8c7', text: '#173b45', name: 'TEAL / #8AC8C7' },
  ];
  const comparison = [], comparisonLabels = [];
  for (let row = 0; row < backdrops.length; row++) {
    const backdrop = backdrops[row], y = row * 300;
    comparison.push({ input: await sharp({ create: { width, height: 300, channels: 4, background: backdrop.color } }).png().toBuffer(), left: 0, top: y });
    comparisonLabels.push(`<text x="16" y="${y + 24}" font-size="12" fill="${backdrop.text}">${backdrop.name}</text>`);
    for (let col = 0; col < assets.length; col++) {
      const asset = assets[col], x = col * cellW;
      for (const size of [144, 64]) {
        const sprite = await sharp(inside(asset.file)).resize(size, size, { fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
        comparison.push({ input: sprite.data, left: x + Math.floor((cellW - sprite.info.width) / 2), top: y + (size === 144 ? 35 : 183) + Math.floor((size - sprite.info.height) / 2) });
      }
      comparisonLabels.push(`<text x="${x + 10}" y="${y + 270}" font-size="10" fill="${backdrop.text}">${esc(asset.id)}</text>`);
      comparisonLabels.push(`<text x="${x + 10}" y="${y + 287}" font-size="10" fill="${backdrop.text}">144px / 64px reference boxes</text>`);
    }
  }
  comparison.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="900"><g font-family="Microsoft YaHei,Arial">${comparisonLabels.join('')}</g></svg>`), left: 0, top: 0 });
  await sharp({ create: { width, height: 900, channels: 4, background: '#fff' } }).composite(comparison).png().toFile(inside('qa/three-backgrounds.png'));
}

async function qaMetadata() {
  const result = [];
  for (const spec of QA_FILES) {
    const file = inside(spec.file), meta = await sharp(file).metadata();
    check(meta.format === 'png' && meta.width === spec.width && meta.height === spec.height, 'Missing or invalid static QA image: ' + spec.file);
    result.push({ ...spec, bytes: fs.statSync(file).size, sha256: sha(file) });
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  check(args.every(arg => arg === '--verify') && args.length <= 1, 'Usage: node art-source/v1.3-process/build.cjs [--verify]');
  const verifyOnly = args.includes('--verify');
  check(SPECS.length === 5 && new Set(SPECS.map(spec => spec.id)).size === SPECS.length, 'Incomplete or duplicated process asset IDs');
  // Complete input validation before producing any exports.
  const inputs = [];
  for (const spec of SPECS) inputs.push(await sourceInput(spec));
  if (!verifyOnly) {
    fs.mkdirSync(inside('exports'), { recursive: true });
    fs.mkdirSync(inside('qa'), { recursive: true });
    for (const input of inputs) await exportSprite(input);
  }
  const assets = [];
  for (const input of inputs) assets.push(await assetMetadata(input));
  const bytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  const decodedBytes = assets.reduce((sum, asset) => sum + asset.decodedBytes, 0);
  check(bytes <= BUDGET.compressedBytes, `Compressed export budget exceeded: ${bytes} > ${BUDGET.compressedBytes}`);
  check(decodedBytes <= BUDGET.decodedBytes, `Decoded RGBA budget exceeded: ${decodedBytes} > ${BUDGET.decodedBytes}`);
  if (!verifyOnly) await overview(assets);
  const manifest = {
    contractVersion: CONTRACT, status: 'ART_READY_NOT_GAMEPLAY_INTEGRATED',
    coordinateSystem: 'Export pixel coordinates; [0,0] is top-left; anchors are sprite attachment references.',
    loading: 'Independent optional process-art source pack. No runtime copies or preload registration.',
    assets, bytes, decodedBytes, budget: BUDGET, qa: await qaMetadata(),
  };
  if (verifyOnly) {
    check(JSON.stringify(read(inside('manifest.json'))) === JSON.stringify(manifest), 'Manifest differs from current source, prompt, provenance, export, or QA files; rebuild and review explicitly.');
  } else {
    write(inside('manifest.json'), manifest);
    fs.writeFileSync(inside('catalog.js'), '// Generated by build.cjs; independent process-art pack.\nwindow.V13_PROCESS_ART = ' + JSON.stringify(manifest) + ';\n');
  }
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(inside('catalog.js'), 'utf8'), context, { timeout: 1000 });
  check(JSON.stringify(context.window.V13_PROCESS_ART) === JSON.stringify(manifest), 'Catalog differs from manifest.');
  for (const asset of context.window.V13_PROCESS_ART.assets) check(inside(asset.url) === inside(asset.file), 'Invalid catalog URL: ' + asset.id);
  const report = {
    schemaVersion: 1, contractVersion: CONTRACT, scope: 'v13-process-static-source-and-export-checks', result: 'PASS',
    assetCount: assets.length, bytes, decodedBytes, budget: BUDGET,
    checks: {
      expectedUniqueIds: true, actualAlpha: true, fourPixelTransparentBorders: true, sizeLimits: true,
      sourceHashes: true, promptHashes: true, provenanceHashesAndSourcePaths: true,
      exportHashes: true, manifestMatchesFiles: true, catalogMatchesManifest: true,
      packageRelativeCatalogUrls: true, staticQaHashesAndDimensions: true, budgets: true,
    },
    browserValidation: 'NOT_RUN_BY_THIS_SCRIPT', gameplayValidation: 'NOT_RUN_BY_THIS_SCRIPT',
    notes: [
      'Only the five independent caramel-process sprites are included in these budgets; retained sources and QA composites are excluded.',
      'The existing v1.3 pack, assets/runtime, and gameplay preload are not modified.',
      'Static alpha inspection cannot prove semantic art quality; review the contact sheet and three-background comparison.',
      '--verify reads existing artifacts and prints results without modifying files.',
    ],
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
