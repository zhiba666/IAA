'use strict';
// Rebuild a standalone review sheet from the editable assembly and unchanged PNGs.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const assembly = JSON.parse(fs.readFileSync(path.join(__dirname, 'assembly.json'), 'utf8'));
const metrics = JSON.parse(fs.readFileSync(path.join(__dirname, 'export-metrics.json'), 'utf8').replace(/^\uFEFF/, ''));
const png = Object.fromEntries(metrics.map(asset => [asset.id, 'data:image/png;base64,' + fs.readFileSync(path.join(root, asset.path)).toString('base64')]));
let serial = 0;
const img = (id, rect) => `<image href="${png[id]}" x="${rect[0]}" y="${rect[1]}" width="${rect[2]}" height="${rect[3]}" preserveAspectRatio="xMidYMid meet"/>`;
const part = layer => img(layer.id, layer.rect);
const group = (x, y, scale, content) => `<g transform="translate(${x} ${y}) scale(${scale})">${content}</g>`;
function clip(points, content) {
  const id = 'clip-' + serial++;
  return `<defs><clipPath id="${id}"><polygon points="${points.map(p => p.join(',')).join(' ')}"/></clipPath></defs><g clip-path="url(#${id})">${content}</g>`;
}
function cup(progress) {
  const rig = assembly.cupProduct;
  if (!progress) return part(rig.empty);
  const rect = [...rig.fill.rect];rect[1] += rig.fillTravel[1] * (1 - progress);
  return part(rig.empty) + clip(rig.fillClip, img(rig.fill.id, rect));
}
function machine() {
  const rig = assembly.cupMachine, rect = rig.cup.rect;
  return part(rig.body) + part(rig.head) + group(rect[0], rect[1], rect[2] / 104, cup(1)) + part(rig.front);
}
function conveyor(right) {
  const rig = right ? assembly.conveyorRight : assembly.conveyorLeft;
  let products = '';
  if (right) for (let i = 0; i < 4; i++) products += img(i % 2 ? 'product_kernel_b' : 'product_kernel_a', [99 + i * 75, 69 + i * 41, 42, 40]);
  else for (let i = 0; i < 3; i++) products += group(367 - i * 108, 82 + i * 62, .45, cup(1));
  return part(rig.back) + products + part(rig.front);
}
function bulk(ratio) {
  const rig = assembly.bulkBuffer;
  let contents = '';
  if (ratio > .8) {
    for (let row = 0; row < 5; row++) for (let col = 0; col < 7; col++) {
      const id = (row + col) % 2 ? 'product_kernel_b' : 'product_kernel_a';
      const height = id.endsWith('_a') ? 53.375 : 54.25;
      contents += img(id, [147 + col * 45 - row * 25, 137 + col * 18 + row * 25 - rig.fillLift * ratio, 56, height]);
    }
  } else if (ratio > 0) {
    for (let i = 0; i < 3; i++) contents += img(i % 2 ? 'product_kernel_b' : 'product_kernel_a', [190 + i * 40, 171 + i * 15, 50, 48]);
  }
  return part(rig.back) + clip(rig.contentClip, contents) + part(rig.front);
}
const text = (label, x, y, size = 18, color = '#3b635e', weight = 500) => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${label}</text>`;
const card = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="#fffaf0" stroke="#d3ded5" stroke-width="2"/>`;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1250" viewBox="0 0 1600 1250"><rect width="1600" height="1250" fill="#eee9dc"/><g font-family="Microsoft YaHei, PingFang SC, sans-serif">`;
svg += text('批次 0 · 独立美术装配样板', 40, 51, 30, '#315c57', 700);
svg += text('只校对部件比例、分层与遮挡；未接入游戏。PNG 保持原样，中文为样板标注。', 40, 80, 17, '#717d70');
svg += card(32, 104, 516, 618) + card(572, 104, 996, 298) + card(572, 426, 996, 296) + card(32, 746, 1536, 470);
svg += text('装杯机 · 固定机体 / 工作头 / 前挡板', 56, 141, 20, '#315c57', 700);
svg += group(133, 163, .70, machine());
svg += text('同一画布 448 × 640 · 所有部件等比缩放', 56, 651, 17);
svg += text('杯位与填充独立，前挡板遮住杯底', 56, 681, 17, '#717d70');
svg += text('红白杯 · 杯口裁切与连续填充示意', 598, 141, 20, '#315c57', 700);
for (const [i, progress] of [0, .3, .7, 1].entries()) {
  const x = 661 + i * 236;
  svg += group(x, 215, 1.02, cup(progress));
  svg += text(['空杯', '少量填充', '接近完成', '满杯'][i], x + 14, 374, 18);
}
svg += text('两向输送带 · 商品在带面上，前挡板最后叠放', 598, 463, 20, '#315c57', 700);
svg += group(646, 483, .57, conveyor(true)) + group(1120, 483, .57, conveyor(false));
svg += text('待装仓 · 后壳 → 内容裁切 → 前挡板', 56, 786, 20, '#315c57', 700);
for (const [i, ratio] of [0, .08, 1].entries()) {
  const x = 80 + i * 510;
  svg += group(x, 838, .74, bulk(ratio));
  svg += text(['空仓', '少量：仍可辨认独立产品', '满仓：聚合填充，不堆叠数百件'][i], x + 36, 1146, 18);
}
svg += text('装配数据：assembly.json  ·  生成脚本：build-assembly.cjs  ·  首批未包含爆锅、出货机与完整场景', 56, 1191, 17, '#717d70');
svg += '</g></svg>';
fs.writeFileSync(path.join(__dirname, 'assembly.svg'), svg, 'utf8');
console.log('Wrote art-source/batch-0/assembly.svg');
