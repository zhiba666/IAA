import { readFile, writeFile, mkdir, copyFile, readdir, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const V13_ART_SOURCE_FILE = 'art-source/v1.3/manifest.json';
export const V13_ART_BUDGETS = { compressedBytes: 1048576, decodedBytes: 16 * 1048576 };
const CONTRACT_VERSION = 'v13-art-1';
const EXPECTED_GROUPS = {
  products: ['product_original_cup', 'product_caramel_tub', 'product_cheese_carton', 'product_duo_bucket',
    'product_choco_cup', 'product_star_pop', 'product_celebration_box'],
  machines: ['machine_caramel_coater', 'machine_dual_flavor', 'machine_dual_drizzle', 'machine_star_press', 'machine_gift_assembler'],
  characters: ['customer_neighbor', 'customer_family', 'clerk_vendor'],
  scene: ['shop_front', 'order_pickup_bag'],
  ui: ['ui_order_ticket']
};
const EXPECTED_IDS = Object.values(EXPECTED_GROUPS).flat();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function contained(root, file) {
  const resolved = path.resolve(root, file), relative = path.relative(path.resolve(root), resolved);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('v1.3 art path outside package: ' + file);
  }
  return resolved;
}

async function checkedPath(root, file) {
  const resolved = contained(root, file);
  let current = path.resolve(root);
  for (const part of path.relative(current, resolved).split(path.sep)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlink in v1.3 art path: ' + file);
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

function validatePng(bytes, entry) {
  if (bytes.length < 45 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes.readUInt32BE(16) !== entry.width || bytes.readUInt32BE(20) !== entry.height) {
    throw new Error('v1.3 PNG dimensions/signature mismatch: ' + entry.id);
  }
  let offset = 8, dataChunks = 0, ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length || ended) throw new Error('Damaged v1.3 PNG: ' + entry.id);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) {
      throw new Error('Damaged v1.3 PNG chunk: ' + entry.id + '/' + type);
    }
    if (type === 'IDAT') dataChunks++;
    if (type === 'IEND') {
      if (length !== 0) throw new Error('Damaged v1.3 PNG end: ' + entry.id);
      ended = true;
    }
    offset = end;
  }
  if (!ended || !dataChunks || offset !== bytes.length) throw new Error('Damaged v1.3 PNG: ' + entry.id);
}

export async function readV13RuntimeArt(root) {
  const manifest = JSON.parse(await readFile(await checkedPath(root, V13_ART_SOURCE_FILE), 'utf8'));
  if (manifest.contractVersion !== CONTRACT_VERSION || !Array.isArray(manifest.assets) ||
      manifest.assets.length !== EXPECTED_IDS.length ||
      EXPECTED_IDS.some(id => manifest.assets.filter(entry => entry.id === id).length !== 1)) {
    throw new Error('Invalid v1.3 art contract: expected v13-art-1 and 18 unique reviewed IDs');
  }
  const assets = {}, entries = [], groups = Object.fromEntries(Object.keys(EXPECTED_GROUPS).map(group => [group, []]));
  for (const entry of manifest.assets) {
    const { id, category, generation, width, height, anchor } = entry;
    if (entry.file !== 'art-source/v1.3/exports/' + id + '.png' || entry.path !== 'assets/art/v13/' + id + '.png' ||
        !EXPECTED_GROUPS[category]?.includes(id) || entry.delivery !== 'ART_READY' ||
        typeof entry.label !== 'string' || !entry.label || !Number.isInteger(generation) || generation < 1 || generation > 6 ||
        !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
        !Number.isSafeInteger(width * height * 4) || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 ||
        !Array.isArray(anchor) || anchor.length !== 2 || !anchor.every(Number.isFinite) ||
        anchor[0] < 0 || anchor[0] > width || anchor[1] < 0 || anchor[1] > height) {
      throw new Error('Invalid v1.3 runtime art or export path: ' + id);
    }
    const bytes = await readFile(await checkedPath(root, entry.file));
    validatePng(bytes, entry);
    if (digest(bytes) !== entry.sha256) throw new Error('v1.3 art SHA-256 mismatch: ' + id);
    if (bytes.length !== entry.bytes || width * height * 4 !== entry.decodedBytes) {
      throw new Error('v1.3 art size mismatch: ' + id);
    }
    const resource = { id, path: entry.path, sourcePath: entry.file, width, height, anchor: [...anchor],
      bytes: bytes.length, decodedBytes: width * height * 4, sha256: entry.sha256, category, generation,
      label: entry.label, sourceRect: [0, 0, width, height] };
    assets[id] = resource;
    entries.push(resource);
    groups[category].push(id);
  }
  const totals = { compressedBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    decodedBytes: entries.reduce((sum, entry) => sum + entry.decodedBytes, 0) };
  for (const [key, limit] of Object.entries(V13_ART_BUDGETS)) {
    if (totals[key] > limit) throw new Error('v1.3 art budget exceeded: ' + key + ' ' + totals[key] + ' > ' + limit);
  }
  if (totals.compressedBytes !== manifest.bytes || totals.decodedBytes !== manifest.decodedBytes) {
    throw new Error('v1.3 art manifest totals mismatch');
  }
  return { assets, entries, groups, totals, contractVersion: CONTRACT_VERSION };
}

export async function generateV13RuntimeArt(root) {
  const data = await readV13RuntimeArt(root);
  const source = "'use strict';\n// Generated by tools/v13-art-build.mjs; optional assets are loaded on demand.\n" +
    'const V13_ART_ASSETS = ' + JSON.stringify(data.assets) + ';\n' +
    'const V13_ART_IDS = ' + JSON.stringify(data.entries.map(entry => entry.id)) + ';\n' +
    'const V13_ART_GROUPS = ' + JSON.stringify(data.groups) + ';\n' +
    'const V13_ART_BUDGETS = ' + JSON.stringify(V13_ART_BUDGETS) + ';\n' +
    'module.exports = { V13_ART_ASSETS, V13_ART_IDS, V13_ART_GROUPS, V13_ART_BUDGETS };\n';
  const target = await checkedPath(root, 'src/v13-art-manifest.js');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source);
  return data;
}

export async function copyV13RuntimeArt(root, targets, data) {
  const permitted = new Set(data.entries.map(entry => entry.id + '.png'));
  const packages = [];
  for (const target of targets) {
    const outputRoot = await checkedPath(root, target);
    const artDir = await checkedPath(root, path.join(target, 'assets/art/v13'));
    // This optional pack owns only v13; neighboring runtime art is preserved.
    async function prune(directory) {
      let children;
      try { children = await readdir(directory, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const child of children) {
        const file = contained(artDir, path.relative(artDir, path.join(directory, child.name)));
        if (child.isSymbolicLink()) throw new Error('Symlink in v1.3 runtime art output');
        if (child.isDirectory()) await prune(file);
        else if (!permitted.has(path.relative(artDir, file))) await unlink(file);
      }
    }
    await prune(artDir);
    await mkdir(artDir, { recursive: true });
    for (const entry of data.entries) {
      if (entry.path !== 'assets/art/v13/' + entry.id + '.png' || !EXPECTED_IDS.includes(entry.id)) {
        throw new Error('Invalid v1.3 copy destination: ' + entry.id);
      }
      const destination = await checkedPath(outputRoot, entry.path);
      const source = await checkedPath(root, entry.sourcePath);
      await copyFile(source, destination);
      if (digest(await readFile(destination)) !== entry.sha256) throw new Error('v1.3 art copy mismatch: ' + entry.id);
    }
    packages.push({ directory: target, verified: data.entries.length, missing: [], mismatched: [] });
  }
  const report = { schemaVersion: 1, scope: 'optional-v13-runtime-art', contractVersion: data.contractVersion,
    sourceFile: V13_ART_SOURCE_FILE, count: data.entries.length, ...data.totals,
    loading: 'on-demand; excluded from the original 87-image preload list',
    budgets: Object.fromEntries(Object.entries(V13_ART_BUDGETS).map(([key, limit]) =>
      [key, { limit, actual: data.totals[key], passed: data.totals[key] <= limit }])),
    targets: packages, entries: data.entries };
  return report;
}
