const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.cjs');
const base = __dirname;
const source = path.join(base, 'sources/ui_gesture_hand.png');
const output = path.join(base, 'exports/ui_gesture_hand.png');
const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
async function main() {
  const meta = await sharp(source).metadata();
  const raw = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = raw.info;
  let x0 = width, y0 = height, x1 = -1, y1 = -1, clear = 0, partial = 0, edge = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = raw.data[(y * width + x) * 4 + 3];
    if (a === 0) clear++;
    if (a > 0 && a < 255) partial++;
    if (a > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (a > 0 && (x === 0 || y === 0 || x === width - 1 || y === height - 1)) edge++;
  }
  if (!meta.hasAlpha || clear < width * height * .1 || x1 < x0 || edge !== 0) throw new Error('Source alpha validation failed');
  const crop = { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  const resized = await sharp(source).extract(crop).resize({ width: 120, height: 120, fit: 'inside', kernel: 'lanczos3' }).png().toBuffer({ resolveWithObject: true });
  const left = Math.floor((128 - resized.info.width) / 2), top = Math.floor((128 - resized.info.height) / 2);
  await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized.data, left, top }]).png({ compressionLevel: 9, effort: 10 }).toFile(output);
  const outRaw = await sharp(output).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  let outputClear = 0, outputPartial = 0, paddingBad = 0, minSum = 9999;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const a = outRaw.data[(y * 128 + x) * 4 + 3];
    if (!a) outputClear++;
    if (a > 0 && a < 255) outputPartial++;
    if ((x < 4 || y < 4 || x >= 124 || y >= 124) && a > 0) paddingBad++;
    if (a >= 128) minSum = Math.min(minSum, x + y);
  }
  const leadingEdge = [];
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (outRaw.data[(y * 128 + x) * 4 + 3] >= 128 && x + y <= minSum + 1) leadingEdge.push([x, y]);
  }
  const anchor = [0, 1].map(i => Math.round(leadingEdge.reduce((sum, p) => sum + p[i], 0) / leadingEdge.length));
  if (paddingBad) throw new Error('Export padding validation failed');
  const referencePaths = ['../../six-gen/integration/exports/ui_icon_settings.png', '../../six-gen/integration/exports/ui_icon_check.png'];
  const toolResult = JSON.parse(fs.readFileSync(path.join(base, 'tool-result.json'), 'utf8'));
  const recipe = {
    id: 'ui_gesture_hand', status: 'READY_FOR_INTEGRATION_REVIEW', source: 'sources/ui_gesture_hand.png', file: 'exports/ui_gesture_hand.png',
    sourceSize: [width, height], sourceRect: [crop.left, crop.top, crop.width, crop.height], width: 128, height: 128,
    bytes: fs.statSync(output).size, sourceBytes: fs.statSync(source).size, sourceSha256: hash(source), sha256: hash(output),
    originalAlpha: meta.hasAlpha, sourceTransparentPixels: clear, sourcePartialAlphaPixels: partial, sourceBoundaryNontransparentPixels: edge,
    alpha: { hasAlpha: true, transparentPixels: outputClear, partialAlphaPixels: outputPartial, paddingMinimum: 4, paddingViolations: paddingBad },
    anchor, anchorNormalized: anchor.map(n => n / 128), anchorType: 'index-fingertip outer leading edge, northwest', recommendedLogicalSize: [32, 40],
    transform: 'Lossless source copy, crop actual alpha>0 bounding box, uniform Lanczos3 fit-inside 120x120, centered in 128x128 true-alpha PNG. No recolor, drawing, or content editing.',
    generation: { tool: toolResult.tool, mode: toolResult.mode, model: toolResult.model, seed: 'unavailable', result: 'tool-result.json', prompt: 'prompts/ui_gesture_hand.txt', references: referencePaths.map(p => ({ path: p, role: 'style reference inspected via view_image; described in prompt, not passed as image edit target', sha256: hash(path.resolve(base, p)) })) },
    integration: 'Not registered in production manifest. Use anchor for tutorial target positioning; animate translation/press/scale in code.'
  };
  fs.writeFileSync(path.join(base, 'ui_gesture_hand.export.json'), JSON.stringify(recipe, null, 2) + '\n');
  fs.writeFileSync(path.join(base, 'provenance.json'), JSON.stringify({ ...recipe.generation, generatedImagePath: 'C:/Users/chenweilun/.codex/generated_images/01a08b4a-33d9-7fc3-81b6-a80d84f2784d/exec-4fc8c5f1-ff90-493e-b7ce-540551f2cbb4.png', sourceSha256: recipe.sourceSha256, exportSha256: recipe.sha256, exactPrompt: fs.readFileSync(path.join(base, 'prompts/ui_gesture_hand.txt'), 'utf8') }, null, 2) + '\n');
  const backgrounds = ['#fff6df', '#174d55', '#39b7b4'];
  const layers = [];
  for (let i = 0; i < backgrounds.length; i++) {
    layers.push({ input: await sharp({ create: { width: 200, height: 220, channels: 4, background: backgrounds[i] } }).png().toBuffer(), left: i * 200, top: 0 });
    layers.push({ input: output, left: i * 200 + 36, top: 12 });
    layers.push({ input: await sharp(output).resize(32, 32).png().toBuffer(), left: i * 200 + 51, top: 166 });
    layers.push({ input: await sharp(output).resize(40, 40).png().toBuffer(), left: i * 200 + 112, top: 162 });
  }
  await sharp({ create: { width: 600, height: 220, channels: 4, background: '#ffffff' } }).composite(layers).png().toFile(path.join(base, 'previews/hand-three-backgrounds-128-32-40.png'));
  console.log(JSON.stringify(recipe, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
