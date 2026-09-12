import { readFile, writeFile, mkdir, copyFile, readdir, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

export const V13_SCENE_ART_SOURCE_FILE = 'art-source/v1.3-scenes/manifest.json';
export const V13_SCENE_ART_BUDGETS = Object.freeze({ compressedBytes: 1048576, decodedBytes: 4194304 });
const CONTRACT_VERSION = 'v13-scenes-art-1';
const SOURCE_ROOT = 'art-source/v1.3-scenes/';
const OUTPUT_ROOT = 'assets/art/v13-scenes/';
const EXPECTED = {
  scene_direct_sales_courtyard: { kind: 'background', maxSize: 960, anchor: 'top-center', z: 0 },
  scene_pickup_counter: { kind: 'sprite', maxSize: 640, anchor: 'bottom-center', z: 40 },
  scene_factory_wayfinding: { kind: 'sprite', maxSize: 256, anchor: 'bottom-center', z: 15 }
};
const EXPECTED_IDS = Object.keys(EXPECTED);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function contained(root, file) {
  const resolved = path.resolve(root, file), relative = path.relative(path.resolve(root), resolved);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('v1.3 scene art path outside package: ' + file);
  }
  return resolved;
}

async function checkedPath(root, file) {
  const resolved = contained(root, file);
  let current = path.resolve(root);
  for (const part of path.relative(current, resolved).split(path.sep)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlink in v1.3 scene art path: ' + file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return resolved;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

// The reviewed exports use non-interlaced 8-bit RGB/RGBA. Validate their complete
// chunk stream and inflated scanlines, including a bounded decompression limit.
export function validateV13ScenePng(bytes, entry) {
  if (bytes.length < 45 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes.readUInt32BE(16) !== entry.width || bytes.readUInt32BE(20) !== entry.height) {
    throw new Error('v1.3 scene PNG dimensions/signature mismatch: ' + entry.id);
  }
  const channels = bytes[25] === 2 ? 3 : bytes[25] === 6 ? 4 : 0;
  if (bytes[24] !== 8 || !channels || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0 ||
      (entry.kind === 'background' ? channels !== 3 : channels !== 4)) {
    throw new Error('Unsupported v1.3 scene PNG encoding: ' + entry.id);
  }
  let offset = 8, ended = false, dataEnded = false;
  const dataChunks = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length || ended) throw new Error('Damaged v1.3 scene PNG: ' + entry.id);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) {
      throw new Error('Damaged v1.3 scene PNG chunk: ' + entry.id + '/' + type);
    }
    if (type === 'IHDR' && offset !== 8) throw new Error('Duplicate v1.3 scene PNG header: ' + entry.id);
    if (type === 'IDAT') {
      if (dataEnded) throw new Error('Nonconsecutive v1.3 scene PNG data: ' + entry.id);
      dataChunks.push(bytes.subarray(offset + 8, end - 4));
    } else if (dataChunks.length) dataEnded = true;
    if (type === 'IEND') {
      if (length !== 0) throw new Error('Damaged v1.3 scene PNG end: ' + entry.id);
      ended = true;
    }
    if (/^[A-Z]/.test(type) && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) {
      throw new Error('Unsupported v1.3 scene PNG chunk: ' + entry.id + '/' + type);
    }
    offset = end;
  }
  if (!ended || !dataChunks.length || offset !== bytes.length) throw new Error('Damaged v1.3 scene PNG: ' + entry.id);
  const stride = entry.width * channels + 1, expectedBytes = stride * entry.height;
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > 4 * 960 * 960 + 960) {
    throw new Error('Invalid v1.3 scene PNG decode size: ' + entry.id);
  }
  try {
    const compressed = Buffer.concat(dataChunks);
    const decoded = inflateSync(compressed, { maxOutputLength: expectedBytes + 1, info: true });
    if (decoded.buffer.length !== expectedBytes || decoded.engine.bytesWritten !== compressed.length) throw new Error('length');
    for (let row = 0; row < entry.height; row++) if (decoded.buffer[row * stride] > 4) throw new Error('filter');
  } catch {
    throw new Error('Damaged v1.3 scene PNG image data: ' + entry.id);
  }
}

export async function readV13SceneRuntimeArt(root) {
  const manifest = JSON.parse(await readFile(await checkedPath(root, V13_SCENE_ART_SOURCE_FILE), 'utf8'));
  if (manifest.contract !== CONTRACT_VERSION || !Array.isArray(manifest.assets) ||
      manifest.assets.length !== EXPECTED_IDS.length ||
      EXPECTED_IDS.some(id => manifest.assets.filter(entry => entry && entry.id === id).length !== 1)) {
    throw new Error('Invalid v1.3 scene art contract: expected v13-scenes-art-1 and 3 unique reviewed IDs');
  }
  if (!manifest.budget || manifest.budget.compressedBytes !== V13_SCENE_ART_BUDGETS.compressedBytes ||
      manifest.budget.rgbaBytes !== V13_SCENE_ART_BUDGETS.decodedBytes) {
    throw new Error('Invalid v1.3 scene art budget contract');
  }
  const assets = {}, entries = [];
  for (const entry of manifest.assets) {
    const { id, kind, width, height, anchorPx, maxSize, z } = entry, expected = EXPECTED[id];
    if (entry.path !== 'exports/' + id + '.png' || entry.source !== 'sources/' + id + '.png' ||
        kind !== expected.kind || maxSize !== expected.maxSize || z !== expected.z || entry.anchor !== expected.anchor ||
        typeof entry.label !== 'string' || !entry.label ||
        !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
        width > maxSize || height > maxSize || !Number.isSafeInteger(width * height * 4) ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.compressedBytes) || entry.compressedBytes <= 0 ||
        !Array.isArray(anchorPx) || anchorPx.length !== 2 || !anchorPx.every(Number.isFinite) ||
        anchorPx[0] < 0 || anchorPx[0] > width || anchorPx[1] < 0 || anchorPx[1] > height) {
      throw new Error('Invalid v1.3 scene runtime art or export path: ' + id);
    }
    const sourcePath = SOURCE_ROOT + entry.path;
    const bytes = await readFile(await checkedPath(root, sourcePath));
    validateV13ScenePng(bytes, entry);
    if (digest(bytes) !== entry.sha256) throw new Error('v1.3 scene art SHA-256 mismatch: ' + id);
    if (bytes.length !== entry.compressedBytes || width * height * 4 !== entry.rgbaBytes) {
      throw new Error('v1.3 scene art size mismatch: ' + id);
    }
    const resource = { id, path: OUTPUT_ROOT + id + '.png', sourcePath, width, height, anchor: [...anchorPx],
      bytes: bytes.length, decodedBytes: width * height * 4, sha256: entry.sha256, kind, z,
      label: entry.label, sourceRect: [0, 0, width, height] };
    assets[id] = resource;
    entries.push(resource);
  }
  const totals = { compressedBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    decodedBytes: entries.reduce((sum, entry) => sum + entry.decodedBytes, 0) };
  for (const [key, limit] of Object.entries(V13_SCENE_ART_BUDGETS)) {
    if (totals[key] > limit) throw new Error('v1.3 scene art budget exceeded: ' + key + ' ' + totals[key] + ' > ' + limit);
  }
  if (!manifest.totals || manifest.totals.count !== entries.length ||
      manifest.totals.compressedBytes !== totals.compressedBytes || manifest.totals.rgbaBytes !== totals.decodedBytes) {
    throw new Error('v1.3 scene art manifest totals mismatch');
  }
  return { assets, entries, totals, contractVersion: CONTRACT_VERSION };
}

export async function generateV13SceneRuntimeArt(root) {
  const data = await readV13SceneRuntimeArt(root);
  const source = "'use strict';\n// Generated by tools/v13-scene-art-build.mjs; scene assets are loaded on demand.\n" +
    'const V13_SCENE_ART_ASSETS = ' + JSON.stringify(data.assets) + ';\n' +
    'const V13_SCENE_ART_IDS = ' + JSON.stringify(data.entries.map(entry => entry.id)) + ';\n' +
    'const V13_SCENE_ART_BUDGETS = ' + JSON.stringify(V13_SCENE_ART_BUDGETS) + ';\n' +
    'module.exports = { V13_SCENE_ART_ASSETS, V13_SCENE_ART_IDS, V13_SCENE_ART_BUDGETS };\n';
  const target = await checkedPath(root, 'src/v13-scene-art-manifest.js');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source);
  return data;
}

export async function copyV13SceneRuntimeArt(root, targets, data) {
  const permitted = new Set(EXPECTED_IDS.map(id => id + '.png'));
  const packages = [];
  for (const target of targets) {
    const outputRoot = target === '.' ? path.resolve(root) : await checkedPath(root, target);
    const artDir = await checkedPath(root, path.join(target, OUTPUT_ROOT));
    async function prune(directory) {
      let children;
      try { children = await readdir(directory, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const child of children) {
        const file = contained(artDir, path.relative(artDir, path.join(directory, child.name)));
        if (child.isSymbolicLink()) throw new Error('Symlink in v1.3 scene art output');
        if (child.isDirectory()) await prune(file);
        else if (!permitted.has(path.relative(artDir, file))) await unlink(file);
      }
    }
    if (data.entries.length !== EXPECTED_IDS.length ||
        EXPECTED_IDS.some(id => data.entries.filter(entry => entry.id === id).length !== 1)) {
      throw new Error('Invalid v1.3 scene copy contract');
    }
    for (const entry of data.entries) {
      if (entry.path !== OUTPUT_ROOT + entry.id + '.png' ||
          entry.sourcePath !== SOURCE_ROOT + 'exports/' + entry.id + '.png') {
        throw new Error('Invalid v1.3 scene copy destination: ' + entry.id);
      }
    }
    await prune(artDir);
    await mkdir(artDir, { recursive: true });
    for (const entry of data.entries) {
      const destination = await checkedPath(outputRoot, entry.path);
      await copyFile(await checkedPath(root, entry.sourcePath), destination);
      if (digest(await readFile(destination)) !== entry.sha256) throw new Error('v1.3 scene art copy mismatch: ' + entry.id);
    }
    packages.push({ directory: target, verified: data.entries.length, missing: [], mismatched: [] });
  }
  const report = { schemaVersion: 1, scope: 'optional-v13-scene-runtime-art', contractVersion: data.contractVersion,
    sourceFile: V13_SCENE_ART_SOURCE_FILE, count: data.entries.length, ...data.totals,
    loading: 'on-demand; excluded from the original 87-image preload and separate 18-image v1.3 pack',
    budgets: Object.fromEntries(Object.entries(V13_SCENE_ART_BUDGETS).map(([key, limit]) =>
      [key, { limit, actual: data.totals[key], passed: data.totals[key] <= limit }])),
    targets: packages, entries: data.entries };
  return report;
}
