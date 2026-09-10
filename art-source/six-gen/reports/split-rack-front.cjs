const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sharp=require('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.cjs');
const ROOT=path.resolve(__dirname,'../../..'),dir=path.join(ROOT,'art-source/six-gen/logistics');
const polygons=[[[10,134],[355,289],[468,233],[469,249],[355,305],[10,151]],[[24,220],[345,378],[463,312],[465,329],[346,393],[22,240]],[[4,134],[34,143],[35,267],[4,270]],[[314,380],[374,397],[374,427],[314,423]]];
async function main(){const src=path.join(dir,'exports/buffer_cups_rack_back.png'),dst=path.join(dir,'exports/buffer_cups_rack_front.png');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="429">${polygons.map(p=>`<polygon points="${p.map(x=>x.join(',')).join(' ')}" fill="white"/>`).join('')}</svg>`;
await sharp(src).ensureAlpha().composite([{input:Buffer.from(svg),blend:'dest-in'}]).png({palette:true,colours:256,quality:92,compressionLevel:9}).toFile(dst);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),back=JSON.parse(fs.readFileSync(path.join(dir,'buffer_cups_rack_back.export.json')));
const e={...back,id:'buffer_cups_rack_front',file:'art-source/six-gen/logistics/exports/buffer_cups_rack_front.png',sourceFile:back.sourceFile,width:512,height:429,anchor:[256,425],sha256:hash(dst),bytes:fs.statSync(dst).size,rgbaBytes:512*429*4,sourceRect:back.sourceRect,transform:'Use rack_back export transform, then extract exact shelf-edge/post polygons with alpha dest-in. No pixels painted.',clipPolygons:polygons,kind:'mechanical-layer-extraction'};
fs.writeFileSync(path.join(dir,'buffer_cups_rack_front.export.json'),JSON.stringify(e,null,2));
console.log(JSON.stringify({file:e.file,bytes:e.bytes,sha256:e.sha256}));}
main().catch(e=>{console.error(e);process.exitCode=1});
