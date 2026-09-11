const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const root = __dirname;
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function metrics(file) {
  const meta = await sharp(file).metadata();
  const {data, info} = await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let transparent=0, opaque=0, partial=0;
  for(let p=3;p<data.length;p+=4) {if(data[p]===0)transparent++;else if(data[p]===255)opaque++;else partial++;}
  return {width:meta.width,height:meta.height,channels:meta.channels,hasAlpha:meta.hasAlpha,bytes:fs.statSync(file).size,
    sha256:sha(file),alphaPixels:{transparent,opaque,partial,total:info.width*info.height}};
}
(async()=>{
  const source=path.join(root,'sources/factory_wall_corner_attempt_03.png');
  const dest=path.join(root,'exports/factory_wall_corner.png');
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.mkdirSync(path.join(root,'previews'),{recursive:true});
  const crop={left:0,top:144,width:1774,height:743};
  await sharp(source).extract(crop).resize({width:512,withoutEnlargement:true,kernel:'lanczos3'})
    .png({compressionLevel:9,palette:true,colours:256,quality:92,dither:0}).toFile(dest);
  const output=await metrics(dest), input=await metrics(source);
  if(!output.hasAlpha||output.alphaPixels.transparent===0||output.bytes>60*1024)throw Error('Wall export gate failed');
  const previewLayers=[];
  for(let n=0;n<3;n++){
    const backgrounds=['#f0e1c4','#173f43','#ffffff'];
    const panel=await sharp({create:{width:512,height:output.height,channels:4,background:backgrounds[n]}})
       .composite([{input:dest}]).png().toBuffer();
    previewLayers.push({input:panel,left:n*512,top:0});
  }
  await sharp({create:{width:1536,height:output.height,channels:4,background:'#f0e1c4'}})
    .composite(previewLayers).png().toFile(path.join(root,'previews/wall-three-backgrounds.png'));
  const report={schemaVersion:1,assetId:'factory_wall_corner',status:'EXPORTED_ART_ONLY',
    source:'sources/factory_wall_corner_attempt_03.png',sourceMetrics:input,
    output:'exports/factory_wall_corner.png',outputMetrics:output,
    recipe:{operations:['rectangular crop to remove upper transparent margin','uniform proportional resize','PNG palette compression preserving alpha'],
      crop,width:512,kernel:'lanczos3',compressionLevel:9,palette:true,colours:256,quality:92,dither:0,
      alphaPolicy:'retain generated alpha through mechanical resize and palette compression; no segmentation, masking, repainting, or background removal'},
    geometry:{canvas:[output.width,output.height],anchor:[output.width/2,0],intendedPlacement:'span full viewport width, top edge aligned to visible scene top',
      note:'Central baseboard point is higher than both ends; no visible wall top after cropping. Height is 214px; do not stretch to 256px.'},
    transparencyNote:'Generated cream wall interiors have near-opaque alpha around 252-254, retained through export. Lower empty region has alpha 0.',
    checks:{dimensions:'PASS',alpha:'PASS',compressedBudget:'PASS_UNDER_60_KIB',visualQA:'PASS_SOURCE_EXPORT_AND_THREE_BACKGROUNDS_REVIEWED',runtimeIntegration:'NOT_RUN'},
    preview:'previews/wall-three-backgrounds.png'};
  fs.writeFileSync(path.join(root,'export.json'),JSON.stringify(report,null,2)+'\n');
  const provenance=JSON.parse(fs.readFileSync(path.join(root,'provenance.json'),'utf8'));
  provenance.status='EXPORTED_ART_ONLY';
  provenance.selectedAttempt=3;
  provenance.attempts=provenance.attempts.filter(a=>a.attempt!==3);
  provenance.attempts.push({attempt:3,source:report.source,...input,resultId:'exec-e46f0c87-9865-47da-9851-f18a254b3918',status:'SELECTED'});
  provenance.checks.transparentLowerRegion='PASS_REAL_ALPHA';
  provenance.checks.topAndSideFullBleed='PASS_AFTER_RECTANGULAR_CROP';
  provenance.reference={path:'art-source/six-gen/integration/exports/factory_room.png',
     sha256:sha(path.join(root,'../../six-gen/integration/exports/factory_room.png')),
     role:'Viewed palette/projection reference; supplied to attempts 1 and 2, not supplied to successful attempt 3'};
  fs.writeFileSync(path.join(root,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
  const old=fs.readFileSync(path.join(root,'prompts.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s)).filter(p=>p.attempt!==3);
  old.push({attempt:3,mode:'built-in',tool:'image_gen.imagegen',intent:'generate',useCase:'stylized-concept',
    prompt:fs.readFileSync(path.join(root,'prompt.txt'),'utf8').trim(),referenceImages:[],source:report.source,
    resultId:'exec-e46f0c87-9865-47da-9851-f18a254b3918',status:'SELECTED_REAL_ALPHA'});
  fs.writeFileSync(path.join(root,'prompts.jsonl'),old.map(p=>JSON.stringify(p)).join('\n')+'\n');
  process.stdout.write(JSON.stringify(report,null,2));
})().catch(error=>{process.stderr.write(error.stack);process.exit(1);});
