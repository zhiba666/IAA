const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sharp=require('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(__dirname,'qa');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const definitions=[
  {id:'ui_gesture_hand',folder:'hand',size:[128,128],alpha:'transparent',anchor:[17,9],use:'Teaching pointer; align fingertip then animate in code.'},
  {id:'factory_floor_extension',folder:'floor',size:[512,512],alpha:'opaque',anchor:[0,0],use:'One proportional cover image, not certified seamless.'},
  {id:'factory_wall_corner',folder:'wall',size:[512,214],alpha:'transparent',anchor:[256,0],use:'Align top center; uniform screen-width scaling above the floor.'}
];
async function main(){
  fs.mkdirSync(OUT,{recursive:true});const assets=[];
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
  // These are static geometry checks only. They do not test pointer events.
  const previews=JSON.parse(fs.readFileSync(path.join(__dirname,'previews/preview-report.json'))).records;
  const geometry=[];
  for(const r of previews){
    const meta=r.meta,inBounds=b=>b[0]>=0&&b[1]>=0&&b[0]+b[2]<=r.w+.01&&b[1]+b[3]<=r.h+.01;
    const pass=[...meta.machines,...meta.buffers].every(n=>inBounds(n.rect))&&meta.ports.every(p=>inBounds(p.visualBounds));
    if(!pass)throw Error('Clipped visual object '+r.name);
    const home=previews.find(q=>q.w===r.w&&q.h===r.h&&q.g===r.g&&q.state==='home');
    const stable=JSON.stringify(meta.machines)===JSON.stringify(home.meta.machines)&&JSON.stringify(meta.buffers)===JSON.stringify(home.meta.buffers)&&JSON.stringify(meta.ports)===JSON.stringify(home.meta.ports);
    if(!stable)throw Error('Unstable scene '+r.name);
    const modal=meta.modalBounds,centered=!modal||Math.abs(modal[0]+modal[2]/2-r.w/2)<.01&&Math.abs(modal[1]+modal[3]/2-r.h/2)<.01;
    if(!centered)throw Error('Off-center modal '+r.name);
    const overlaps=[];for(const p of meta.ports)for(const b of meta.buffers){const a=p.visualBounds,c=b.rect,iw=Math.min(a[0]+a[2],c[0]+c[2])-Math.max(a[0],c[0]),ih=Math.min(a[1]+a[3],c[1]+c[3])-Math.max(a[1],c[1]);if(iw>0&&ih>0)overlaps.push({port:p.id,buffer:b.id,overlapArea:+(iw*ih).toFixed(2)});}
    geometry.push({name:r.name,inBounds:pass,stableScene:stable,centeredModal:centered,portBufferEnvelopeOverlaps:overlaps});
  }
  const cards=[];
  const bg=Buffer.from('<svg width="1160" height="500"><rect width="1160" height="500" fill="#f3eddf"/><text x="28" y="42" font-family="Microsoft YaHei" font-size="25" fill="#174e51">v1.1 新增美术 · 3 张</text><text x="28" y="70" font-family="Microsoft YaHei" font-size="14" fill="#68776f">透明手势 / 地板延展 / 透明墙角层</text><rect x="28" y="102" width="348" height="280" rx="14" fill="#c7ddcf"/><rect x="406" y="102" width="348" height="280" rx="14" fill="#fff9e9"/><rect x="784" y="102" width="348" height="280" rx="14" fill="#174e51"/><g font-family="Microsoft YaHei" fill="#174e51" font-size="16"><text x="28" y="416">教学手势 · 128 × 128</text><text x="406" y="416">地板延展 · 512 × 512</text><text x="784" y="416">墙角层 · 512 × 214</text></g><g font-family="Microsoft YaHei" fill="#68776f" font-size="13"><text x="28" y="446">32–40 px 使用，动画由代码驱动</text><text x="406" y="446">等比 cover，不作无缝平铺</text><text x="784" y="446">底部真实透明，叠在地板上方</text></g></svg>');
  for(const [i,a]of assets.entries()){const b=await sharp(path.join(ROOT,a.file)).resize({width:300,height:246,fit:'inside'}).toBuffer(),m=await sharp(b).metadata();cards.push({input:b,left:28+i*378+Math.round((348-m.width)/2),top:102+Math.round((280-m.height)/2)});}
  await sharp(bg).composite(cards).png().toFile(path.join(OUT,'asset-overview.png'));
  const report={createdAt:new Date().toISOString(),assetCount:3,budgets,geometry,checks:{pngSizeAndAlpha:'PASS',projectedBudgets:'PASS',staticBounds:'PASS',staticModalStability:'PASS',visualReview:'Review PNGs separately',runtimeIntegration:'NOT_RUN',inputAndEconomy:'NOT_RUN',realDevice:'NOT_RUN'},nextStep:'Implement code and resolve input-area conflicts using live viewport/pointer geometry; additional sprite production is not required.'};
  fs.writeFileSync(path.join(OUT,'art-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({assets:assets.map(a=>({id:a.id,bytes:a.bytes,alpha:a.alphaStats})),budgets,previews:previews.length,overlappingViews:geometry.filter(g=>g.portBufferEnvelopeOverlaps.length).map(g=>g.name)}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
