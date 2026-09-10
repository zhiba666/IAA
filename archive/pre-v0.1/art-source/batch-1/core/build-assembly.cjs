'use strict';
// Existing PNGs only: uniform transforms, layer ordering and optional assembly clips.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const a = read(path.join(__dirname, 'assembly.json'));
const metrics = [...read(path.join(root, 'art-source/batch-0/export-metrics.json')), ...read(path.join(__dirname, 'export-metrics.json'))];
const asset = Object.fromEntries(metrics.map(m => [m.id, m]));
const png = Object.fromEntries(metrics.map(m => [m.id, 'data:image/png;base64,' + fs.readFileSync(path.join(root, m.path)).toString('base64')]));
let serial=0;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function img(id, r) {
  const m=asset[id];
  if (!m) throw new Error('Unknown asset '+id);
  if (Math.abs(r[2]/r[3] - m.width/m.height)>0.002) throw new Error('Nonuniform scale: '+id);
  return `<image data-asset="${id}" href="${png[id]}" x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" preserveAspectRatio="xMidYMid meet"/>`;
}
const group=(x,y,s,c)=>`<g transform="translate(${x} ${y}) scale(${s})">${c}</g>`;
function clip(points,c) {
  if(!points)return c;
  const id='clip-'+serial++;
  return `<defs><clipPath id="${id}"><polygon points="${points.map(p=>p.join(',')).join(' ')}"/></clipPath></defs><g clip-path="url(#${id})">${c}</g>`;
}
function cup() {
  return a.cupProduct.parts.map(p=>p.clip?clip(a.cupProduct[p.clip],img(p.id,p.rect)):img(p.id,p.rect)).join('');
}
function rig(state) {
  const r=a[state.rig];const layers=[];
  for(const p of r.parts) {
    if(p.state==='closed'&&!state.closed)continue;
    layers.push({layer:p.layer,svg:p.clip?clip(r[p.clip],img(p.id,p.rect)):img(p.id,p.rect)});
  }
  for(const slot of r.slots)if(state.filledSlots.includes(slot.id)) {
    const s=slot.width/a.cupProduct.size[0];
    layers.push({layer:slot.layer,svg:clip(r.contentClip,group(slot.anchor[0]-a.cupProduct.anchor[0]*s,slot.anchor[1]-a.cupProduct.anchor[1]*s,s,cup()))});
  }
  return layers.sort((x,y)=>x.layer-y.layer).map(x=>x.svg).join('');
}
const text=(s,x,y,size=18,fill='#315c57',weight=500)=>`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`;
const card=(x,y,w,h)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="#fffaf0" stroke="#d3ded5" stroke-width="2"/>`;
let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="990" viewBox="0 0 1600 990"><rect width="1600" height="990" fill="#eee9dc"/><g font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">';
svg+=text('批次 1 · 包装产品独立装配',36,48,30,'#315c57',700);
svg+=text('空托 → 双杯 · 空箱 → 四杯 → 封箱；全部复用原 PNG 等比叠放，未接入游戏。',36,79,18,'#717d70');
svg+=card(28,104,754,332)+card(806,104,766,332);
svg+=text('双杯托 · 两个独立卡槽',50,142,21,'#315c57',700)+text('箱体分层 · 后壳 / 两面前墙 / 箱盖',830,142,21,'#315c57',700);
svg+=group(112,158,1.36,rig(a.states[0]))+group(467,158,1.36,rig(a.states[1]));
svg+=text('空托',194,408,18)+text('双杯',550,408,18);
svg+=img('product_box_open',[844,196,165.1,166.4])+img('product_box_front',[1098,244,166.4,101.4])+img('product_box_lid',[1337,221,166.4,118.3]);
svg+=text('后壳',899,408,18)+text('前墙（最后遮挡杯底）',1079,408,18)+text('箱盖',1390,408,18);
for(let i=0;i<3;i++) {
  const x=28+i*524;svg+=card(x,460,496,450);
  svg+=text(['空箱','四杯装箱','封箱'][i],x+22,500,22,'#315c57',700);
  svg+=group(x+101,505,1.84,rig(a.states[i+2]));
  svg+=text(['完整箱后壳 → 独立前墙','后排先放，前排后放；前墙遮住杯底','箱盖在前墙之上，装配共用同一画布'][i],x+24,879,16,'#717d70');
}
svg+=text('assembly.json 保存 anchor / input / output / slots / clip / parts；可编辑 SVG 内嵌 PNG。',36,953,17,'#717d70');
svg+='</g></svg>';
const svgPath=path.join(__dirname,'assembly.svg');fs.writeFileSync(svgPath,svg);
async function main() {
  let sharp;try{sharp=require('sharp');}catch{if(process.argv[2])sharp=require(path.resolve(process.argv[2]));}
  if(sharp) {
    await sharp(Buffer.from(svg)).png().toFile(path.join(__dirname,'assembly-preview.png'));
    const core=read(path.join(__dirname,'export-metrics.json'));
    let contact='<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="920"><rect width="1440" height="920" fill="#eee9dc"/><g font-family="Microsoft YaHei, sans-serif">'+text('批次 1 · 核心资源单件校对',28,41,26,'#315c57',700);
    for(const [i,m] of core.entries()) {
      const x=20+(i%4)*355,y=68+Math.floor(i/4)*277;
      const s=Math.min(300/m.width,207/m.height);
      contact+=card(x,y,335,257)+text(m.id,x+12,y+25,16);
      contact+=img(m.id,[x+(335-m.width*s)/2,y+38+(207-m.height*s)/2,m.width*s,m.height*s]);
    }
    contact+='</g></svg>';
    await sharp(Buffer.from(contact)).png().toFile(path.join(__dirname,'contact-sheet.png'));
  }
  console.log('Wrote assembly.svg'+(sharp?' and assembly-preview.png':'; pass a sharp module path to also rasterize'));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
