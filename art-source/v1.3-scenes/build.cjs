'use strict';
// Production export only: native-alpha crop, resize, padding and lossless PNG compression.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
let sharp;
for (const candidate of [process.env.IAA_SHARP_MODULE, 'sharp', path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')].filter(Boolean)) {
  try { sharp = require(candidate); break; } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
}
if (!sharp) throw new Error('Set IAA_SHARP_MODULE to the installed sharp module directory.');
const base = __dirname;
const root = path.resolve(base, '../..');
const specs = [
  { id: 'scene_direct_sales_courtyard', label: '工厂直售庭院', kind: 'background', maxSize: 960, anchor: 'top-center', z: 0, provenance: 'provenance-background.json' },
  { id: 'scene_pickup_counter', label: '双客取货柜台', kind: 'sprite', maxSize: 640, anchor: 'bottom-center', z: 40, provenance: 'provenance-counter.json' },
  { id: 'scene_factory_wayfinding', label: '工厂导向牌', kind: 'sprite', maxSize: 256, anchor: 'bottom-center', z: 15, provenance: 'provenance-wayfinding.json' },
];
const write = (file, value) => fs.writeFileSync(path.join(base, file), JSON.stringify(value, null, 2) + '\n');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const assert = (value, message) => { if (!value) throw new Error(message); };
async function inspect(file) {
  const meta = await sharp(file).metadata();
  const {data, info} = await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  let clear = 0, partial = 0, edgeVisible = 0, minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const a = data[(y * info.width + x) * 4 + 3];
    if (a === 0) clear++;
    else {
      if (a < 255) partial++;
      if (!x || !y || x === info.width-1 || y === info.height-1) edgeVisible++;
      minX = Math.min(minX,x); minY = Math.min(minY,y); maxX = Math.max(maxX,x); maxY = Math.max(maxY,y);
    }
  }
  assert(meta.format === 'png' && maxX >= 0, 'Expected nonempty PNG: '+file);
  return {width: info.width, height: info.height, hasAlpha: meta.hasAlpha, clear, partial, edgeVisible, bounds: [minX,minY,maxX-minX+1,maxY-minY+1], bytes: fs.statSync(file).size, sha256: sha(file)};
}
async function main() {
  const verifyOnly = process.argv.includes('--verify');
  if (!verifyOnly) fs.mkdirSync(path.join(base,'exports'),{recursive:true});
  const saved = verifyOnly ? JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8')) : null;
  const assets = [];
  for (const spec of specs) {
    const source = 'sources/'+spec.id+'.png', exported = 'exports/'+spec.id+'.png';
    const original = await inspect(path.join(base,source));
    assert(fs.existsSync(path.join(base,'prompts',spec.id+'.txt')), 'Missing prompt: '+spec.id);
    assert(fs.existsSync(path.join(base,spec.provenance)), 'Missing provenance: '+spec.id);
    const provenance = JSON.parse(fs.readFileSync(path.join(base,spec.provenance),'utf8'));
    if (provenance.sha256) assert(provenance.sha256.toLowerCase() === original.sha256, 'Provenance source hash mismatch: '+spec.id);
    if (spec.kind === 'sprite') assert(original.hasAlpha && original.clear > original.width * original.height * .1, 'Sprite has no genuine transparency: '+spec.id);
    else assert(original.clear === 0, 'Background must be opaque');
    if (!verifyOnly) {
      let pipe = sharp(path.join(base,source));
      if (spec.kind === 'sprite') {
        const [left,top,width,height] = original.bounds;
        pipe = pipe.extract({left,top,width,height}).resize({width:spec.maxSize-8,height:spec.maxSize-8,fit:'inside',withoutEnlargement:true,kernel:'lanczos3'}).extend({top:4,bottom:4,left:4,right:4,background:{r:0,g:0,b:0,alpha:0}});
      } else pipe = pipe.resize({width:640,height:960,fit:'inside',withoutEnlargement:true,kernel:'lanczos3'});
      await pipe.png({compressionLevel:9,adaptiveFiltering:true}).toFile(path.join(base,exported));
    }
    const output = await inspect(path.join(base,exported));
    assert(Math.max(output.width,output.height) <= spec.maxSize, 'Dimensions exceed contract: '+spec.id);
    if (spec.kind === 'sprite') assert(output.hasAlpha && output.edgeVisible === 0 && output.bounds[0] >= 4 && output.bounds[1] >= 4, 'Transparent export margin failed: '+spec.id);
    const entry = {...spec,source,path:exported,prompt:'prompts/'+spec.id+'.txt',width:output.width,height:output.height,anchorPx:[output.width/2,spec.kind==='background'?0:output.height-4],compressedBytes:output.bytes,rgbaBytes:output.width*output.height*4,sourceCrop:spec.kind==='sprite'?original.bounds:[0,0,original.width,original.height],sourceSha256:original.sha256,sha256:output.sha256,sourceInspection:original,exportInspection:output};
    if (saved) {
      const prior = saved.assets.find(item=>item.id===spec.id);
      assert(prior && prior.sha256===entry.sha256 && prior.sourceSha256===entry.sourceSha256 && prior.width===entry.width && prior.height===entry.height, 'Manifest mismatch: '+spec.id);
    }
    assets.push(entry);
  }
  const compressedBytes = assets.reduce((n,a)=>n+a.compressedBytes,0);
  const rgbaBytes = assets.reduce((n,a)=>n+a.rgbaBytes,0);
  assert(compressedBytes <= 1024*1024, 'New-art PNG budget exceeded');
  assert(rgbaBytes <= 4*1024*1024, 'New-art RGBA estimate budget exceeded');
  const manifest = {contract:'v13-scenes-art-1',status:'design-preview-not-runtime-integrated',generator:'built-in image_gen',reference:'input/IAA_v1.3_版本设计思路报告.md',budget:{compressedBytes:1024*1024,rgbaBytes:4*1024*1024},totals:{count:assets.length,compressedBytes,rgbaBytes},assets};
  if (!verifyOnly) write('manifest.json',manifest);
  const preview = require('./preview.js');
  const assembly = {contract:'v13-scenes-art-1',purpose:'art preview; no runtime inventory or order binding',layout:preview.layout,sources:preview.sources,states:preview.states,layers:['courtyard','shop','clerk clipped to shopWindow','sign','customers','counter','bag back > product > bag front clips','rack back > clipped product slots > rack front','order/header/inventory UI'],bagContract:'179x192 unchanged export; clip coordinates in preview.js copied from src/v13-showroom.js',rackContract:'512x429 cups_rack; slots and content clip preserved in preview.js'};
  if (!verifyOnly) write('assembly.json',assembly);
  else assert(JSON.stringify(JSON.parse(fs.readFileSync(path.join(base,'assembly.json'),'utf8'))) === JSON.stringify(assembly), 'Assembly differs from current preview.js');
  const reuse = [
    'art-source/v1.3/exports/shop_front.png','art-source/v1.3/exports/customer_neighbor.png','art-source/v1.3/exports/customer_family.png','art-source/v1.3/exports/clerk_vendor.png',
    'art-source/v1.3/exports/order_pickup_bag.png','art-source/v1.3/exports/product_original_cup.png','art-source/v1.3/exports/product_caramel_tub.png',
    'art-source/six-gen/integration/exports/buffer_cups_rack_back.png','art-source/six-gen/integration/exports/buffer_cups_rack_front.png',
  ].map(file=>{ assert(fs.existsSync(path.join(root,file)),'Missing reused sprite '+file); return {path:file,sha256:sha(path.join(root,file))}; });
  const reuseManifest = {policy:'reference existing files; no duplicate exports',assets:reuse};
  if (!verifyOnly) write('reuse-manifest.json',reuseManifest);
  else assert(JSON.stringify(JSON.parse(fs.readFileSync(path.join(base,'reuse-manifest.json'),'utf8'))) === JSON.stringify(reuseManifest), 'Reuse manifest differs from current source files');
  console.log(JSON.stringify({mode:verifyOnly?'verify':'export',...manifest.totals,passed:true}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
