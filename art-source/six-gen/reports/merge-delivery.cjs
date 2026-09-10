const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sharp=require('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.cjs');
const ROOT=path.resolve(__dirname,'../../..'),base='art-source/six-gen/integration',read=p=>JSON.parse(fs.readFileSync(path.resolve(ROOT,p),'utf8').replace(/^\uFEFF/,''));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.resolve(ROOT,p))).digest('hex');
async function main(){fs.mkdirSync(path.join(ROOT,base,'exports'),{recursive:true});const assets=[],metrics=[],recipe=[];
for(const folder of ['integration/common','pop','cup','ship','logistics','ui','scene']){const m=read('art-source/six-gen/'+folder+'/manifest.fragment.json');
for(const a of m.assets.filter(a=>a.file&&['EXPORTED','VERIFIED_ART'].includes(a.status))){
if(assets.some(x=>x.id===a.id))throw Error('Duplicate id '+a.id);const src=path.resolve(ROOT,a.file),dest=path.join(ROOT,base,'exports',a.id+'.png'),file=base+'/exports/'+a.id+'.png';
if(folder==='integration/common')fs.copyFileSync(src,dest);else await sharp(src).png({palette:true,colours:256,quality:95,dither:.5,compressionLevel:9,effort:7}).toFile(dest);
const meta=await sharp(dest).metadata();if(meta.width!==a.width||meta.height!==a.height)throw Error('Size changed '+a.id);
assets.push({...a,file,sha256:hash(file),provenanceRef:base+'/provenance.json#'+a.id});
metrics.push({id:a.id,file,sha256:hash(file),width:meta.width,height:meta.height,bytes:fs.statSync(dest).size,rgbaBytes:meta.width*meta.height*4,stageUse:a.stageUse,owner:folder,reused:folder==='integration/common'});
recipe.push({id:a.id,from:a.file,fromSha256:hash(a.file),to:file,toSha256:hash(file),sourceFile:a.sourceFile,sourceSha256:hash(a.sourceFile),sourceProvenance:a.provenanceRef,method:folder==='integration/common'?'copy optimized shared library':'same-size supervised PNG palette256 quality95 dither0.5; original package export unchanged'});
}}
const b={schemaVersion:1,contractVersion:'six-gen-art-1.0',baseCommit:'14310d34e882969208bb7583c5e0c8442bfc3aee',owner:'A0'};
const write=(name,x)=>fs.writeFileSync(path.join(ROOT,base,name),JSON.stringify(x,null,2));write('manifest.json',{...b,assets});write('provenance.json',{...b,createdAt:new Date().toISOString(),sources:recipe});write('export-recipe.json',{...b,operations:recipe});write('asset-metrics.json',metrics);
const sum=xs=>({pngBytes:xs.reduce((s,x)=>s+x.bytes,0),rgbaBytes:xs.reduce((s,x)=>s+x.rgbaBytes,0),count:xs.length});
const gens=Array.from({length:6},(_,i)=>{const rows=metrics.filter(a=>a.stageUse.includes(i+1));return{generation:i+1,...sum(rows),ids:rows.map(a=>a.id)}});
const peaks=gens.slice(0,-1).map((g,i)=>{const ids=new Set([...g.ids,...gens[i+1].ids]);return{from:i+1,to:i+2,...sum(metrics.filter(a=>ids.has(a.id)))}});
const total=sum(metrics),budget={createdAt:new Date().toISOString(),basis:'unique final candidate PNG files, not zip size; RGBA=width*height*4, not GPU/process memory',newAssetCount:metrics.filter(a=>!a.reused).length,reusedAssetCount:metrics.filter(a=>a.reused).length,allUniquePngBytes:total.pngBytes,allRgbaBytes:total.rgbaBytes,targets:{firstGeneration:2097152,complete:4194304,rgba:33554432},passes:{firstGeneration:gens[0].pngBytes<=2097152,complete:total.pngBytes<=4194304,rgba:total.rgbaBytes<=33554432},commonPlusGenBytes:gens,transitionPeaks:peaks};
write('budget-report.json',budget);console.log(JSON.stringify({...total,newAssetCount:budget.newAssetCount,reusedAssetCount:budget.reusedAssetCount,passes:budget.passes}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
