const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sharp=require('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.cjs');
const ROOT=path.resolve(__dirname,'../..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const definitions=[
  {id:'ui_gesture_hand',folder:'hand',size:[128,128],alpha:'transparent',anchor:[17,9],use:'Teaching pointer; align fingertip then animate in code.'},
  {id:'factory_floor_extension',folder:'floor',size:[512,512],alpha:'opaque',anchor:[0,0],use:'One proportional cover image, not certified seamless.'},
  {id:'factory_wall_corner',folder:'wall',size:[512,214],alpha:'transparent',anchor:[256,0],use:'Align top center; uniform screen-width scaling above the floor.'}
];
async function main(){
  const assets=[];
  // This manifest is now a production build input. QA verifies its reviewed
  // hashes and metadata; it must never silently re-register changed pixels.
  const registered=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.fragment.json')));
  if(registered.contractVersion!=='v11-art-supplement-1'||registered.assets.length!==definitions.length)throw Error('Invalid registered v1.1 art contract');
  for(const d of definitions){
    const file=`art-source/v1.1/${d.folder}/exports/${d.id}.png`,b=fs.readFileSync(path.join(ROOT,file)),m=await sharp(b).metadata();
    if(m.format!=='png'||m.width!==d.size[0]||m.height!==d.size[1])throw Error('PNG format/size '+d.id);
    const {data,info}=await sharp(b).ensureAlpha().raw().toBuffer({resolveWithObject:true});let transparent=0,partial=0,opaque=0;
    for(let i=3;i<data.length;i+=4){if(data[i]===0)transparent++;else if(data[i]===255)opaque++;else partial++;}
    if(d.alpha==='transparent'&&(!m.hasAlpha||transparent<100||opaque+partial<100))throw Error('Missing real alpha '+d.id);
    if(d.alpha==='opaque'&&transparent+partial!==0)throw Error('Unexpected floor alpha');
    const reviewed=registered.assets.find(a=>a.id===d.id);
    if(!reviewed||reviewed.status!=='EXPORTED'||reviewed.file!==file||reviewed.sha256!==hash(b)||reviewed.bytes!==b.length||reviewed.width!==m.width||reviewed.height!==m.height||reviewed.decodedBytes!==m.width*m.height*4||JSON.stringify(reviewed.anchor)!==JSON.stringify(d.anchor))throw Error('Reviewed v1.1 art no longer matches '+d.id);
    assets.push({...d,file,sourceFile:reviewed.sourceFile,provenanceRef:reviewed.provenanceRef,width:m.width,height:m.height,bytes:b.length,decodedBytes:m.width*m.height*4,sha256:hash(b),alphaStats:{transparent,partial,opaque},stageUse:[1,2,3,4,5,6],status:'EXPORTED'});
  }
  const baseline=JSON.parse(fs.readFileSync(path.join(ROOT,'art-source/six-gen/integration/manifest.json'))).assets;
  const baseBytes=baseline.reduce((n,a)=>n+fs.statSync(path.join(ROOT,a.file)).size,0),baseDecoded=baseline.reduce((n,a)=>n+a.width*a.height*4,0);
  const extraBytes=assets.reduce((n,a)=>n+a.bytes,0),extraDecoded=assets.reduce((n,a)=>n+a.decodedBytes,0);
  const firstBase=baseline.filter(a=>a.stageUse.includes(1)).reduce((n,a)=>n+fs.statSync(path.join(ROOT,a.file)).size,0);
  const budgets={supplement:{bytes:extraBytes,limit:150*1024},firstGenerationProjected:{bytes:firstBase+extraBytes,limit:1048576},allProjected:{bytes:baseBytes+extraBytes,limit:4*1048576},decodedProjected:{bytes:baseDecoded+extraDecoded,limit:32*1048576}};
  for(const b of Object.values(budgets)){b.passed=b.bytes<=b.limit;if(!b.passed)throw Error('Budget exceeded '+JSON.stringify(b));}
  console.log(JSON.stringify({scope:'v11-source-and-exports',assets:assets.map(a=>({id:a.id,bytes:a.bytes,alpha:a.alphaStats})),budgets,passed:true}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
