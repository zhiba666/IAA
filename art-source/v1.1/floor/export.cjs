const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');

const original = 'C:/Users/chenweilun/.codex/generated_images/01a08b4a-765e-7cd2-936d-25d38a2d9fcf/exec-a95e3bef-37c4-42d1-9f95-8c5985343890.png';
const reference = path.resolve(__dirname, '../../six-gen/integration/exports/factory_room.png');
const source = path.join(__dirname, 'sources/factory_floor_extension-original.png');
const output = path.join(__dirname, 'exports/factory_floor_extension.png');
const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

(async () => {
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (!fs.existsSync(source)) fs.copyFileSync(original, source);
  const sourceMetadata = await sharp(source).metadata();
  const sourceStats = await sharp(source).stats();
  if (sourceMetadata.width !== sourceMetadata.height || !sourceStats.isOpaque) throw new Error('Source must be square and opaque');
  await sharp(source).resize(512, 512, { fit: 'inside', kernel: 'lanczos3' }).png({ palette: true, colours: 4, dither: 0, compressionLevel: 9, adaptiveFiltering: true, effort: 10 }).toFile(output);
  const outputMetadata = await sharp(output).metadata();
  const outputStats = await sharp(output).stats();
  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
  const baseline = await sharp(source).resize(512, 512, { fit: 'inside', kernel: 'lanczos3' }).raw().toBuffer();
  let absoluteError = 0, maxChannelError = 0;
  for (let i = 0; i < data.length; i++) {
    const error = Math.abs(data[i] - baseline[i]);
    absoluteError += error;
    maxChannelError = Math.max(maxChannelError, error);
  }
  let leftRightDiff = 0, topBottomDiff = 0;
  for (let i = 0; i < info.width; i++) for (let c = 0; c < 3; c++) {
    leftRightDiff += Math.abs(data[(i * info.width) * info.channels + c] - data[(i * info.width + info.width - 1) * info.channels + c]);
    topBottomDiff += Math.abs(data[i * info.channels + c] - data[((info.height - 1) * info.width + i) * info.channels + c]);
  }
  const result = {
    assetId: 'factory_floor_extension',
    generatedAt: '2026-09-10',
    generationMode: 'built-in image_gen',
    prompt: 'prompt.txt',
    originalGeneratedPath: original,
    reference: { path: reference, role: 'Visual style reference inspected with view_image; descriptive prompt used for a new generation', sha256: sha256(reference) },
    source: { path: 'sources/factory_floor_extension-original.png', width: sourceMetadata.width, height: sourceMetadata.height, channels: sourceMetadata.channels, opaque: sourceStats.isOpaque, bytes: fs.statSync(source).size, sha256: sha256(source) },
    export: { path: 'exports/factory_floor_extension.png', width: outputMetadata.width, height: outputMetadata.height, channels: outputMetadata.channels, hasAlpha: outputMetadata.hasAlpha, opaque: outputStats.isOpaque, bytes: fs.statSync(output).size, sha256: sha256(output), processing: 'Proportional Lanczos3 downscale; visually inspected 4-colour palette quantization with dithering disabled; PNG compression level 9. No repaint, matte removal, or content replacement.' },
    qa: { targetBytes: 70 * 1024, byteBudgetPassed: fs.statSync(output).size < 70 * 1024, visuallyInspected: true, meanRGB: outputStats.channels.slice(0, 3).map(c => c.mean), standardDeviationRGB: outputStats.channels.slice(0, 3).map(c => c.stdev), quantizationAgainstLossless512: { meanAbsoluteChannelError: absoluteError / data.length, maxChannelError }, edgeMeanAbsoluteDifferenceRGB: { leftRight: leftRightDiff / (info.width * 3), topBottom: topBottomDiff / (info.width * 3) } },
    integration: { usage: 'Cover background under foreground equipment and the room-wall layer; suitable for screen aspect-ratio extension.', repeatSafe: false, limitations: ['Not certified seamless; use cover or a single stretched background, not a visibly repeated tile.', 'Existing factory_room.png contains diagonal grout lines that this quiet extension intentionally omits; do not directly hard-join the two into a continuous tile grid.', 'No perspective marks, walls, skirting, objects, UI, or baked foreground shadows.'] }
  };
  fs.writeFileSync(path.join(__dirname, 'export.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
})();
