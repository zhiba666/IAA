const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
let sharp;
try { sharp = require('sharp'); } catch {
  sharp = require(process.env.IAA_SHARP_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'));
}
const base = __dirname;
const root = path.resolve(base, '../..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const relative = file => path.relative(root, file).split(path.sep).join('/');
const groups = ['products', 'machines', 'characters', 'scene'];
const esc = text => String(text).replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch]));
const expectedIds = [
  'product_original_cup', 'product_caramel_tub', 'product_cheese_carton', 'product_duo_bucket',
  'product_choco_cup', 'product_star_pop', 'product_celebration_box',
  'machine_caramel_coater', 'machine_dual_flavor', 'machine_dual_drizzle', 'machine_star_press', 'machine_gift_assembler',
  'customer_neighbor', 'customer_family', 'clerk_vendor', 'shop_front', 'order_pickup_bag', 'ui_order_ticket'
];
function inside(file) {
  const resolved = path.resolve(root, file);
  if (!resolved.startsWith(root + path.sep)) throw new Error('Path outside workspace: ' + file);
  return resolved;
}
async function inspect(file) {
  const meta = await sharp(file).metadata();
  const {data, info} = await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let clear = 0, partial = 0, edge = 0, visible = 0;
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y=0; y<info.height; y++) for (let x=0; x<info.width; x++) {
    const a = data[(y*info.width+x)*4+3];
    if (!a) clear++; else {
      visible++;
      if (a<255) partial++;
      if (x===0 || y===0 || x===info.width-1 || y===info.height-1) edge++;
      x0=Math.min(x0,x); y0=Math.min(y0,y); x1=Math.max(x1,x); y1=Math.max(y1,y);
    }
  }
  if (!meta.hasAlpha || clear < info.width*info.height*.1 || !visible) throw new Error('Missing genuine alpha: ' + file);
  return {width:info.width,height:info.height,clear,partial,edge,visible,bounds:[x0,y0,x1-x0+1,y1-y0+1]};
}
async function overview(assets) {
  const cols=6, cellW=224, cellH=226, width=cols*cellW, height=72+Math.ceil(assets.length/cols)*cellH;
  const layers=[];
  const text=[];
  text.push('<text x="20" y="30" font-size="20" fill="#144f51">IAA v1.3 / ART LIBRARY</text>');
  text.push('<text x="20" y="53" font-size="12" fill="#5b6f76">18 new sprites / 7 products / 5 process modules / 3 characters / 3 scene and UI assets</text>');
  for(let i=0;i<assets.length;i++) {
    const a=assets[i], x=(i%cols)*cellW, y=72+Math.floor(i/cols)*cellH;
    const tile=await sharp(inside(a.file)).resize(200,166,{fit:'inside'}).png().toBuffer({resolveWithObject:true});
    layers.push({input:tile.data,left:x+Math.floor((cellW-tile.info.width)/2),top:y+Math.floor((172-tile.info.height)/2)});
    text.push(`<text x="${x+12}" y="${y+189}" font-size="13" fill="#173a40">${esc(a.label)}</text>`);
    text.push(`<text x="${x+12}" y="${y+208}" font-size="10" fill="#5b6f76">${esc(a.id)}</text>`);
  }
  const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g font-family="Microsoft YaHei,Arial">${text.join('')}</g></svg>`);
  layers.push({input:svg,left:0,top:0});
  await sharp({create:{width,height,channels:4,background:'#f0f5f6'}}).composite(layers).png().toFile(path.join(base,'qa/contact-sheet.png'));
  const products=assets.filter(a=>a.category==='products');
  const backgrounds=['#ffffff','#183943','#8ac8c7'];
  const scaleLayers=[];
  for(let row=0;row<backgrounds.length;row++) {
    scaleLayers.push({input:await sharp({create:{width:1050,height:180,channels:4,background:backgrounds[row]}}).png().toBuffer(),left:0,top:row*180});
    for(let col=0;col<products.length;col++) {
      const a=products[col];
      for(const [size,x,y] of [[96,27,6],[64,9,108],[40,95,122]]) {
        const sprite=await sharp(inside(a.file)).resize(size,size,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
        scaleLayers.push({input:sprite,left:col*150+x,top:row*180+y});
      }
    }
  }
  await sharp({create:{width:1050,height:540,channels:4,background:'#fff'}}).composite(scaleLayers).png().toFile(path.join(base,'qa/product-sizes-three-backgrounds.png'));
}
async function main() {
  const verifyOnly=process.argv.includes('--verify');
  const specs=groups.flatMap(group=>read(path.join(base,group,'manifest.fragment.json')).assets);
  if (specs.length!==expectedIds.length || new Set(specs.map(a=>a.id)).size!==specs.length || expectedIds.some(id=>!specs.find(a=>a.id===id))) throw new Error('Incomplete or duplicated v1.3 asset IDs');
  if(!verifyOnly) {
    fs.mkdirSync(path.join(base,'exports'),{recursive:true});
    fs.mkdirSync(path.join(base,'qa'),{recursive:true});
    fs.mkdirSync(path.join(root,'assets/art/v13'),{recursive:true});
  }
  const assets=[];
  for(const spec of specs) {
    const source=inside(spec.source), original=await inspect(source);
    const sourcePrompt=fs.readFileSync(inside(spec.prompt),'utf8');
    if (sourcePrompt.trim().length<80) throw new Error('Missing generation prompt: '+spec.id);
    const output=path.join(base,'exports',spec.id+'.png');
    if(!verifyOnly) {
      const [left,top,width,height]=original.bounds;
      const target=spec.maxSize;
      const resized=await sharp(source).extract({left,top,width,height}).resize(target-8,target-8,{fit:'inside',withoutEnlargement:true}).png().toBuffer();
      await sharp(resized).extend({top:4,bottom:4,left:4,right:4,background:{r:0,g:0,b:0,alpha:0}}).png({compressionLevel:9,effort:10}).toFile(output);
      fs.copyFileSync(output,path.join(root,'assets/art/v13',spec.id+'.png'));
    }
    const alpha=await inspect(output);
    if(alpha.edge!==0 || alpha.width>spec.maxSize || alpha.height>spec.maxSize) throw new Error('Export bounds failed: '+spec.id);
    const runtimeFile='assets/art/v13/'+spec.id+'.png';
    if(sha(output)!==sha(inside(runtimeFile))) throw new Error('Runtime copy mismatch: '+spec.id);
    assets.push({...spec,file:relative(output),path:runtimeFile,width:alpha.width,height:alpha.height,bytes:fs.statSync(output).size,decodedBytes:alpha.width*alpha.height*4,sha256:sha(output),sourceSha256:sha(source),sourceRect:original.bounds,sourceSize:[original.width,original.height],anchor:[alpha.width/2,alpha.height-4],anchorType:'bottom-center',alpha,sourceBoundaryNontransparentPixels:original.edge,delivery:'ART_READY',gameplay:spec.generation>2?'FUTURE_BLUEPRINT':'CORE_ART_ONLY',transform:'Crop alpha bounds, uniform Lanczos resize, 4px transparent padding. No recoloring or background removal.'});
  }
  const reuse=read(path.join(base,'reuse.json')).assets.map(a=>({...a,sha256:sha(inside(a.file))}));
  const bytes=assets.reduce((sum,a)=>sum+a.bytes,0), decodedBytes=assets.reduce((sum,a)=>sum+a.decodedBytes,0);
  const manifest={contractVersion:'v13-art-1',status:'ART_READY_NOT_GAMEPLAY_INTEGRATED',assets,reuse,loading:'Separate optional art pack. Do not append all assets to the existing 87-image preload list.',bytes,decodedBytes};
  const catalog={...manifest,assets:assets.map(a=>({...a,url:'../../'+a.file})),reuse:reuse.map(a=>({...a,url:'../../'+a.file}))};
  const runtime=Object.fromEntries(assets.map(a=>[a.id,{id:a.id,path:a.path,width:a.width,height:a.height,anchor:a.anchor,bytes:a.bytes,sha256:a.sha256}]));
  const prompts=assets.map(a=>({id:a.id,tool:'image_gen',promptFile:a.prompt,exactPrompt:fs.readFileSync(inside(a.prompt),'utf8')}));
  if(verifyOnly) {
    const saved=read(path.join(base,'manifest.json'));
    if(JSON.stringify(saved)!==JSON.stringify(manifest)) throw new Error('Manifest differs from source/export/reuse metadata; rebuild and review');
    if(JSON.stringify(read(path.join(base,'prompts.json')))!==JSON.stringify(prompts)) throw new Error('Prompt collection differs from source prompts');
  } else {
    write(path.join(base,'manifest.json'),manifest);
    write(path.join(base,'prompts.json'),prompts);
    fs.writeFileSync(path.join(base,'catalog.js'),'window.V13_ART = '+JSON.stringify(catalog)+';\n');
    fs.writeFileSync(path.join(base,'runtime-manifest.cjs'),"'use strict';\n// Generated by art-source/v1.3/build.cjs. Optional pack; not in the v1.1 preload.\nmodule.exports = "+JSON.stringify(runtime,null,2)+';\n');
    await overview(assets);
  }
  const previewContext={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(base,'catalog.js'),'utf8'),previewContext);
  if(JSON.stringify(previewContext.window.V13_ART)!==JSON.stringify(catalog)) throw new Error('Stale or modified preview catalog');
  const runtimeContext={module:{exports:{}}};
  vm.runInNewContext(fs.readFileSync(path.join(base,'runtime-manifest.cjs'),'utf8'),runtimeContext);
  if(JSON.stringify(runtimeContext.module.exports)!==JSON.stringify(runtime)) throw new Error('Stale or modified runtime manifest');
  for (const asset of [...previewContext.window.V13_ART.assets,...previewContext.window.V13_ART.reuse]) {
    if(path.resolve(base,asset.url)!==inside(asset.file)) throw new Error('Invalid gallery URL: '+asset.id);
  }
  const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
  for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  for(const match of html.matchAll(/data-art="([a-z_]+)"/g)) {
    if(![...assets,...reuse].some(a=>a.id===match[1])) throw new Error('Unknown preview sprite: '+match[1]);
  }
  const report={
    schemaVersion:1,
    scope:'v13-static-art-source-and-exports',
    result:'PASS',
    newSprites:assets.length,reusedSprites:reuse.length,bytes,decodedBytes,
    trueAlpha:true,transparentExportBoundary:true,sourceHashesMatch:true,runtimeCopiesMatch:true,
    previewPathsAndScriptSyntax:true,
    browserValidation:'NOT_RUN_BY_STATIC_ART_CHECK',
    gameplayTests:'NOT_RUN_BY_STATIC_ART_CHECK',
    notes:[
      'This report checks source/export metadata, transparency, assets/art/v13 copies, and preview paths/script syntax; it does not run browser interactions.',
      'Browser validation of the official Web game does not establish acceptance of the independent file:// gallery.',
      'Runtime v1.1 remains on its existing reviewed art contract.',
      'High-generation modules are static process sprites; moving internal parts need future rigging.',
      'Source images and exact prompts retained.'
    ]
  };
  console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
