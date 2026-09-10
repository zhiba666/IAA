const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sharp=require('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const ROOT=path.resolve(__dirname,'../../..');
const runtime=require(path.join(ROOT,'src/art-manifest.js'));
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const stages=read('art-source/six-gen/contracts/stage-profile.snapshot.json').stages;
const packaging=read('art-source/batch-1/core/assembly.json');
const contract=read('art-source/six-gen/contracts/style-contract.json');
const sceneConfigurations=read('art-source/six-gen/qa/scene-configurations.json').configurations;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const assets=new Map(),cache=new Map();let used=new Set(),clipIndex=0;
const qaPath=p=>path.join(__dirname,p);fs.mkdirSync(qaPath('previews'),{recursive:true});
for(const [id,a] of Object.entries(runtime.ART_ASSETS)) assets.set(id,{...a,file:a.path});
for(const a of read('assets/art/manifest.json').entries)if(!assets.has(a.id))assets.set(a.id,{...a,file:a.path});
for(const folder of ['pop','cup','ship','logistics','ui','scene','common','integration/common']){
 const exportDir=path.join(ROOT,'art-source/six-gen',folder,'exports');
 if(fs.existsSync(exportDir))for(const f of fs.readdirSync(exportDir).filter(f=>f.endsWith('.png')))assets.set(path.basename(f,'.png'),{id:path.basename(f,'.png'),file:path.join(exportDir,f),manifestStatus:'candidate-export-path-discovered'});
 const file=path.join(ROOT,'art-source/six-gen',folder,'manifest.fragment.json');if(!fs.existsSync(file))continue;
 const m=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const a of m.assets||m.entries||[]){
  if(!a.file)continue;let p=path.isAbsolute(a.file)?a.file:path.join(ROOT,a.file);if(!fs.existsSync(p))p=path.join(path.dirname(file),a.file);
  if(fs.existsSync(p))assets.set(a.id,{...a,file:p});
 }
}
const finalManifestPath=path.join(ROOT,'art-source/six-gen/integration/manifest.json');
if(fs.existsSync(finalManifestPath)){
 const finalManifest=JSON.parse(fs.readFileSync(finalManifestPath,'utf8'));
 for(const a of finalManifest.assets||finalManifest.entries||[]){const f=a.file||a.path;if(!f)continue;const resolved=path.isAbsolute(f)?f:path.join(ROOT,f);if(fs.existsSync(resolved))assets.set(a.id,{...a,file:resolved,manifestStatus:'final-candidate-collection'});}
}
function load(id){
 if(cache.has(id))return cache.get(id);const a=assets.get(id);if(!a)throw Error('Missing asset: '+id);
 let f=path.isAbsolute(a.file)?a.file:path.join(ROOT,a.file);const compact=qaPath('compression-experiment/compact256/'+id+'.png');
 if(a.file.startsWith('assets/')&&fs.existsSync(compact))f=compact;
 const b=fs.readFileSync(f);const item={...a,file:f,sha256:hash(b),href:'data:image/png;base64,'+b.toString('base64')};cache.set(id,item);return item;
}
function image(id,r,extra=''){used.add(id);const a=load(id);return `<image href="${a.href}" x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" preserveAspectRatio="xMidYMid meet" ${extra}/>`;}
function text(s,x,y,size=12,fill='#124e54',extra=''){return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-family="Microsoft YaHei,Arial,sans-serif" ${extra}>${escape(s)}</text>`;}
function polygon(points,fill,stroke='none',extra=''){return `<polygon points="${points.map(p=>p.join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" ${extra}/>`;}
function clip(content,points){if(!points)return content;const id='clip'+(++clipIndex);return `<defs><clipPath id="${id}">${polygon(points,'white')}</clipPath></defs><g clip-path="url(#${id})">${content}</g>`;}
function cup(rect,filled=true){const[x,y,w,h]=rect;let out=image('product_cup_empty',rect);if(filled){const sc=w/104;out+=`<g transform="translate(${x},${y}) scale(${sc})">${clip(image('product_cup_fill',[3.12,-38.12,97.76,71.7925]),[[3,-78],[101,-78],[101,14],[88,29],[52,35],[16,29],[3,14]])}</g>`;}return out;}
function packaged(rect,amount=1,closed=false,fullCanvas=false){if(amount===1){if(!fullCanvas)return cup(rect);const w=rect[2]*.4,h=w*128/104;return cup([rect[0]+(rect[2]-w)/2,rect[1]+rect[3]*.74-h,w,h]);}const r=packaging[amount===2?'doubleTray':'fourCupBox'],scale=Math.min(rect[2]/r.size[0],rect[3]/r.size[1]);const parts=[...r.parts.filter(p=>p.state!=='closed'||closed).map(p=>({layer:p.layer,content:clip(layerImage(p),typeof p.clip==='string'?r[p.clip]:p.clip)})),...r.slots.map(s=>({layer:s.layer,content:cup(s.rect)}))].sort((a,b)=>a.layer-b.layer);return `<g transform="translate(${rect[0]+(rect[2]-r.size[0]*scale)/2},${rect[1]+rect[3]-r.size[1]*scale}) scale(${scale})">${parts.map(p=>p.content).join('')}</g>`;}
function portionContent(station,rect,batchSize,fullCanvas=true){if(station!=='pop')return packaged(rect,batchSize,false,station==='ship'&&fullCanvas);if(batchSize===1)return image('product_cup_fill',rect);const w=rect[2]*.34,h=w*94/128;return image('product_cup_fill',[rect[0]+rect[2]*.19,rect[1]+rect[3]*.16,w,h])+image('product_cup_fill',[rect[0]+rect[2]*.50,rect[1]+rect[3]*.34,w,h]);}
function oldRig(id){const r=structuredClone(runtime.ART_RIGS[id]);if(!r)throw Error('Missing rig '+id);r.id=id;r.qaAssemblyFile='src/art-manifest.js';r.qaAssemblySha256=hash(fs.readFileSync(path.join(ROOT,r.qaAssemblyFile)));return r;}
function layerImage(l,rig){let s=image(l.id||l.assetId,l.rect);if(l.flipX)s=`<g transform="translate(${2*l.rect[0]+l.rect[2]},0) scale(-1,1)">${image(l.id,l.rect)}</g>`;const points=typeof l.clip==='string'?rig?.[l.clip]:l.clip;return points?clip(s,points):s;}
function renderRig(r,{station,state='running',quantity,capacity,activeSlots,batchSize=1,jobs}={}){
 let layers=r.layers||Object.values(r).filter(v=>v&&v.id&&v.rect);layers=layers.map(l=>({...l}));let out='';
 if(r.slots?.length){
  const dynamic=r.slots.flatMap(s=>[s.head,s.cup,s.content,s.cover]).filter(v=>v?.id&&v?.rect);
  layers=layers.filter(l=>!dynamic.some(p=>p.id===l.id&&JSON.stringify(p.rect)===JSON.stringify(l.rect)));
  for(const s of r.slots)if(s.front?.id&&s.front?.rect&&!layers.some(l=>l.id===s.front.id&&JSON.stringify(l.rect)===JSON.stringify(s.front.rect)))layers.push({...s.front});
 }
 const contentLayer=r.content?.layer||30;
 let content='',dynamicContents=[];
 if(quantity!==undefined){
  const count=quantity===0?0:quantity===1?1:Math.min(6,Math.max(2,Math.ceil(6*quantity/capacity)));
  if(r.content?.kind==='kernels'&&r.content?.slots)for(let i=0;i<count;i++)content+=image('product_kernel_b',r.content.slots[i]);
  else if(r.id==='bulkBuffer')for(let i=0;i<count;i++)content+=image(i%2?'product_kernel_b':'product_kernel_b',[130+(i%3)*70,80+Math.floor(i/3)*60,72,70]);
  else if(r.content?.slots)for(let i=0;i<count;i++)content+=cup(r.content.slots[i]);
  else for(let i=0;i<count;i++)content+=cup([110+(i%3)*80,95+Math.floor(i/3)*75,65,80]);
  content=clip(content,r.contentClip);
 }else if(state!=='waiting'){
  if(station==='pop'&&r.content?.exampleFill)content=clip(image('product_cup_fill',r.content.exampleFill),r.contentClip);
  if(station==='ship'&&r.content?.singleCup)content=clip(packaged(r.content.singleCup,batchSize),r.contentClip);
  if(station==='cup'&&r.cup)content=clip(cup(r.cup.rect),r.contentClip);
  if(r.slots?.length)for(const [i,slot]of r.slots.entries()){
   if(activeSlots!==undefined&&i>=activeSlots)continue;
   if(jobs&&!jobs[i])continue;const amount=jobs?jobs[i].amount:batchSize;
   const batchRect=amount>1?(slot.batchContent?.rect||slot.packagingRect||slot.carrier?.rect):null;
   if(station==='pop'&&amount===2&&slot.carrier?.id&&slot.carrier?.rect)dynamicContents.push({layer:slot.carrier.layer||35,content:clip(image(slot.carrier.id,slot.carrier.rect),slot.clip||slot.contentClip||r.contentClip)});
   if(slot.cup?.rect)dynamicContents.push({layer:slot.cup.layer||contentLayer,content:clip(packaged(batchRect||slot.cup.rect,amount),slot.clip||slot.contentClip||r.contentClip)});
   else if(slot.content?.rect)dynamicContents.push({layer:station==='pop'&&amount===2&&slot.carrier?Math.max(slot.content.layer||contentLayer,(slot.carrier.layer||35)+1):slot.content.layer||contentLayer,content:clip(portionContent(station,amount===1&&slot.singleCupRect?slot.singleCupRect:batchRect||slot.content.rect,amount,!slot.singleCupRect),slot.clip||slot.contentClip||r.contentClip)});
  }
 }
 if(r.slots?.length){
  const installed=activeSlots===undefined?r.slots.length:activeSlots;
  for(const [i,s]of r.slots.entries()){
   if(i>=installed){if(s.cover?.id&&s.cover?.rect)layers.push({...s.cover});}
   else if(s.head?.id&&s.head?.rect&&!layers.some(l=>l.id===s.head.id&&JSON.stringify(l.rect)===JSON.stringify(s.head.rect)))layers.push({...s.head});
  }
 }
 const sorted=[...layers,{layer:contentLayer,content},...dynamicContents].sort((a,b)=>(a.layer||0)-(b.layer||0));
 for(const l of sorted){if(l.content!==undefined)out+=l.content;else if(l.id&&l.rect)out+=layerImage(l,r);}
 return out;
}
function normalizedRig(r){if(!r)return null;const n=r.rig?{...r.rig,id:r.id,stationId:r.stationId,generationUse:r.generationUse}:r;return n.size&&n.layers?.length?n:null;}
function selectRig(station,g){
 if(g===1)return oldRig({pop:'popMachine',cup:'cupMachine',ship:'shipMachine'}[station]);
 const file=path.join(ROOT,'art-source/six-gen',station,'assembly.json');if(!fs.existsSync(file))return null;
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 const rig=(data.rigs||[]).filter(r=>r.stationId===station&&(r.generationUse||r.stageUse||[]).includes(g)).map(normalizedRig).find(Boolean)||null;
 if(rig){rig.qaAssemblyFile=path.relative(ROOT,file).replaceAll('\\','/');rig.qaAssemblySha256=hash(fs.readFileSync(file));}return rig;
}
function selectLogistics(station,g){
 const file=path.join(ROOT,'art-source/six-gen/logistics/assembly.json');
 if(fs.existsSync(file)){const data=JSON.parse(fs.readFileSync(file,'utf8')),rig=(data.rigs||[]).find(r=>r.stationId===station&&(r.generationUse||[]).includes(g));if(rig){rig.qaAssemblyFile=path.relative(ROOT,file).replaceAll('\\','/');rig.qaAssemblySha256=hash(fs.readFileSync(file));return rig;}}
 return oldRig(station==='bulk'?'bulkBuffer':'cupsBuffer');
}
function addLayerNode(nodes,id,rig,scale,translate,extra={}){const node={id,rig,scale,translate,...extra};nodes.push(node);return node;}
function port(n,key){return [n.translate[0]+n.rig[key][0]*n.scale,n.translate[1]+n.rig[key][1]*n.scale];}
function attach(nodes,id,rig,scale,previous,extra={}){const p=port(previous,'output');return addLayerNode(nodes,id,rig,scale,[p[0]-rig.input[0]*scale,p[1]-rig.input[1]*scale],extra);}
function realSceneNodes(g,configuration){
 const rigs={};for(const s of ['pop','cup','ship']){rigs[s]=selectRig(s,g);if(!rigs[s])throw Error(`Incomplete ${s} rig for G${g}; final preview generation refused.`);}
 const n=[],spec=stages[g-1],fixture=sceneConfigurations.find(f=>f.generation===g&&f.configuration===configuration);
 if(!fixture)throw Error(`Missing explicit static configuration G${g} ${configuration}`);
 const owned={stations:Object.fromEntries(Object.entries(fixture.installed).map(([id,s])=>[id,{maxUnlockedLanes:s.lanes,maxUnlockedBatchSize:s.batchSize}]))};
 let p=addLayerNode(n,'pop',rigs.pop,150/Math.max(...rigs.pop.size),[0,0],{station:'pop',activeSlots:owned.stations.pop.maxUnlockedLanes,batchSize:owned.stations.pop.maxUnlockedBatchSize});
 p=attach(n,'belt_pop_bulk',oldRig('conveyorRight'),0.22,p,{belt:true});
 p=attach(n,'bulk',selectLogistics('bulk',g),0.18,p,{buffer:true,quantity:1,capacity:spec.freshStageCapacityFloor});
 p=attach(n,'belt_bulk_cup',oldRig('conveyorLeft'),0.30,p,{belt:true});
 p=attach(n,'cup',rigs.cup,145/Math.max(...rigs.cup.size),p,{station:'cup',activeSlots:owned.stations.cup.maxUnlockedLanes,batchSize:owned.stations.cup.maxUnlockedBatchSize});
 p=attach(n,'belt_cup_stock',oldRig('conveyorRight'),0.23,p,{belt:true});
 p=attach(n,'cups',selectLogistics('cups',g),0.18,p,{buffer:true,quantity:1,capacity:spec.freshStageCapacityFloor});
 p=attach(n,'belt_stock_ship',oldRig('conveyorLeft'),0.38,p,{belt:true});
 p=attach(n,'ship',rigs.ship,145/Math.max(...rigs.ship.size),p,{station:'ship',activeSlots:owned.stations.ship.maxUnlockedLanes,batchSize:owned.stations.ship.maxUnlockedBatchSize});
 attach(n,'outfeed',oldRig('conveyorOutfeed'),0.16,p,{belt:true});
 return n;
}
function ui(w,h,g,configuration,gray=false){
 let s='';const hudW=(w-60)/2,hudH=hudW*138/384;
 s+=image('ui_hud_coin',[24,47,hudW,hudH])+image('ui_hud_rate',[36+hudW,47,hudW,hudH]);
 s+=text('金币  —',34,47+hudH/2+4,13,'#ffffff')+text('产出  —',46+hudW,47+hudH/2+4,13);
 s+=text(`G${String(g).padStart(2,'0')}  ${stages[g-1].name}`,24,36,12,'#124e54','font-weight="700"');
 s+=text(configuration==='entry'?'扩建保留旧头':'已安装配置示意',w-24,36,10,'#587277','text-anchor="end"');
 s+=`<rect x="24" y="${h-78}" width="${w-48}" height="50" rx="14" fill="#f5efe0" stroke="#c4d1ca"/>`;
 s+=image('ui_icon_pop',[27,h-66,25,25])+image('ui_icon_cup',[w/2-13,h-66,25,25])+image('ui_icon_ship',[w-52,h-66,25,25]);
 s+=text('爆锅',40,h-34,10,'#124e54','text-anchor="middle"')+text('装杯',w/2,h-34,10,'#124e54','text-anchor="middle"')+text('出货',w-40,h-34,10,'#124e54','text-anchor="middle"');
 s+=text(gray?'密度灰盒 · 不可作为成品交付':'美术预览，非真机验收',w/2,h-11,10,gray?'#a34320':'#637b7d','text-anchor="middle"');
 return s;
}
function floor(w,h){let s=`<rect width="${w}" height="${h}" fill="#f3ead9"/>`;s+=`<path d="M0 100L${w} ${100+w*.55} M0 200L${w} ${200+w*.55} M0 300L${w} ${300+w*.55} M0 400L${w} ${400+w*.55} M${w} 100L0 ${100+w*.55} M${w} 200L0 ${200+w*.55} M${w} 300L0 ${300+w*.55} M${w} 400L0 ${400+w*.55}" stroke="#e4d8c3" stroke-width="1" opacity=".65"/>`;return s;}
function svgWrap(w,h,content){return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${content}</svg>`;}
function sceneDecorations(g,w,h,nodes,tx,ty,scale,hit){
 let back='',front='',placement=[];
 const sceneFile=path.join(ROOT,'art-source/six-gen/scene/assembly.json');
 if(g>=2&&assets.has('factory_platform_extension')){const n=nodes.find(n=>n.id==='pop'),pw=n.rig.size[0]*n.scale*scale*1.02,ph=pw*318/512,rect=[tx+n.translate[0]*scale-2,ty+(n.translate[1]+n.rig.size[1]*n.scale)*scale-ph*.62,pw,ph];back+=image('factory_platform_extension',rect);placement.push({id:'factory_platform_extension',rect,layer:'behind stations'});}
 if(g===6&&assets.has('factory_tower_back')){const th=h<600?260:450,tw=th*317/640,rect=[w-24-tw,h<600?105:121,tw,th];back+=image('factory_tower_back',rect,'opacity=".46"');placement.push({id:'factory_tower_back',rect,layer:'background landmark',opacity:.46});}
 if(g===6&&assets.has('factory_tower_front')){
  placement.push({id:'factory_tower_front',omittedFromScene:true,reason:'Independent frame cannot align to the tower base without obscuring the factory flow at these viewports; delivered in the independent asset overview.'});
 }
 return {back,front,placement,assembly:fs.existsSync(sceneFile)?{path:'art-source/six-gen/scene/assembly.json',sha256:hash(fs.readFileSync(sceneFile))}:null};
}
function captureAssetEvidence(meta){
 const rows=[...used].map(id=>({id,path:path.relative(ROOT,load(id).file).replaceAll('\\','/'),sha256:load(id).sha256}));
 for(const ref of meta.sourceScreenshots||[]){const j=path.join(ROOT,ref.file.replace(/\.png$/,'.json'));if(fs.existsSync(j))rows.push(...(JSON.parse(fs.readFileSync(j,'utf8')).assetSHAs||[]));}
 return [...new Map(rows.map(a=>[a.id+'|'+a.sha256,a])).values()];
}
async function save(name,w,h,content,meta){const svg=svgWrap(w,h,content),p=qaPath('previews/'+name);await sharp(Buffer.from(svg)).png().toFile(p+'.png');fs.writeFileSync(p+'.svg',svg);const evidence={commit:contract.baseCommit,contractVersion:contract.contractVersion,viewSize:[w,h],safeArea:meta.safeArea||24,generation:meta.generation,configuration:meta.configuration,fixtureKind:meta.fixtureKind||'synthetic-art-only',syntheticArtOnly:true,executionTime:new Date().toISOString(),checkerVersion:'static-preview-1.0',pngSha256:hash(fs.readFileSync(p+'.png')),assetSHAs:captureAssetEvidence(meta),conclusion:meta.conclusion||'PENDING_VISUAL_REVIEW',...meta};fs.writeFileSync(p+'.json',JSON.stringify(evidence,null,2)+'\n');return p+'.png';}
async function renderReal(g,configuration,w,h){used=new Set();const nodes=realSceneNodes(g,configuration),box=[Infinity,Infinity,-Infinity,-Infinity];
 for(const n of nodes){box[0]=Math.min(box[0],n.translate[0]);box[1]=Math.min(box[1],n.translate[1]);box[2]=Math.max(box[2],n.translate[0]+n.rig.size[0]*n.scale);box[3]=Math.max(box[3],n.translate[1]+n.rig.size[1]*n.scale);}
 const sceneTop=h<600?103:121,available=[w-34,h-sceneTop-91],scale=Math.min(available[0]/(box[2]-box[0]),available[1]/(box[3]-box[1]));const tx=(w-(box[2]-box[0])*scale)/2-box[0]*scale,ty=sceneTop-box[1]*scale;let scene='',hit=[];
 const sorted=[...nodes.filter(n=>n.belt),...nodes.filter(n=>!n.belt).sort((a,b)=>port(a,'output')[1]-port(b,'output')[1])];
 for(const n of sorted){scene+=`<g transform="translate(${n.translate}) scale(${n.scale})">${renderRig(n.rig,n)}</g>`;if(n.station||n.buffer){const x=tx+n.translate[0]*scale,y=ty+n.translate[1]*scale,rw=n.rig.size[0]*n.scale*scale,rh=n.rig.size[1]*n.scale*scale;hit.push({id:n.id,bounds:[x,y,rw,rh],minimumTargetMet:rw>=44&&rh>=44});}}
 const decor=sceneDecorations(g,w,h,nodes,tx,ty,scale,hit);
 let s=floor(w,h)+decor.back+`<g transform="translate(${tx},${ty}) scale(${scale})">${scene}</g>`+decor.front;
 for(const n of nodes.filter(n=>n.station||n.buffer)){const x=tx+(n.translate[0]+n.rig.size[0]*n.scale*.5)*scale,y=ty+(n.translate[1]+n.rig.size[1]*n.scale)*scale;const label={pop:'爆锅',cup:'装杯',ship:'出货',bulk:'待装 · 1份样例',cups:'待发 · 1份样例'}[n.id];s+=text(label,Math.max(42,Math.min(w-42,x)),y+11,10,'#124e54','text-anchor="middle" paint-order="stroke" stroke="#f3ead9" stroke-width="3" stroke-linejoin="round"');}
 for(const [i,id]of['cup','ship'].entries()){const n=nodes.find(n=>n.id===id),p=port(n,'input'),cx=Math.max(46,Math.min(w-46,tx+p[0]*scale)),cy=ty+p[1]*scale;s+=`<circle cx="${cx}" cy="${cy}" r="22" fill="#fffaf0" fill-opacity=".35" stroke="#229da5" stroke-width="1.2" stroke-dasharray="3 3"/>`;if(assets.has('input_cup_collar'))s+=image('input_cup_collar',[cx-22,cy-15.24,44,30.48]);s+=text('入口',cx,cy+3,9,'#124e54','text-anchor="middle" paint-order="stroke" stroke="#f5efe0" stroke-width="2"');hit.push({id:id+'_input',bounds:[cx-22,cy-22,44,44],minimumTargetMet:true});}
 s+=ui(w,h,g,configuration);const name=`g${String(g).padStart(2,'0')}-${configuration}-${w}x${h}`;
 return save(name,w,h,s,{generation:g,configuration,fixtureKind:'synthetic-art-only',availableRigCount:3,requiredGenerationRigCount:18,fixtureConfiguration:sceneConfigurations.find(f=>f.generation===g&&f.configuration===configuration),fixtureConfigurationSha256:hash(fs.readFileSync(path.join(ROOT,'art-source/six-gen/qa/scene-configurations.json'))),rigs:nodes.filter(n=>n.station).map(n=>({station:n.station,id:n.rig.id,size:n.rig.size,activeSlots:n.activeSlots,batchSize:n.batchSize})),hitRegions:hit,decorationPlacements:decor.placement,assemblySHAs:[...new Map([...nodes.map(n=>[n.rig.qaAssemblyFile,{path:n.rig.qaAssemblyFile,sha256:n.rig.qaAssemblySha256}]),...(decor.assembly?[[decor.assembly.path,decor.assembly]]:[])]).values()],connectorMath:'Every belt input/output translated from adjoining local rig ports; visual continuity requires separate inspection.',notes:['HUD dash values mean no live game metrics. One-portion warehouse examples are synthetic static fixtures.','Scene is independent artwork preview and does not execute or write a game save.']});
}
function grayMachine(station,x,y,w,h,slots){let s=polygon([[x,y+h*.2],[x+w*.42,y],[x+w,y+h*.25],[x+w*.57,y+h*.45]],'#b9c7ca','#69878b');s+=polygon([[x,y+h*.2],[x+w*.57,y+h*.45],[x+w*.57,y+h],[x,y+h*.75]],'#879ca1','#69878b')+polygon([[x+w*.57,y+h*.45],[x+w,y+h*.25],[x+w,y+h*.80],[x+w*.57,y+h]],'#657f87','#536b72');const headId={pop:'machine_pop_head',cup:'machine_cup_head',ship:'machine_ship_head'}[station];const perRow=slots===6?3:2,rows=Math.ceil(slots/perRow);for(let i=0;i<slots;i++){const col=i%perRow,row=Math.floor(i/perRow);const px=x+8+col*w/(perRow+0.2)+row*6,py=y+h*.05+row*h*.29+col*4;const sw=station==='pop'?w/(perRow+1.1):w/(perRow+2.4);s+=image(headId,[px,py,sw,sw]);if(station!=='pop')s+=cup([px+sw*.3,py+sw*.65,Math.max(9,sw*.32),Math.max(11,sw*.4)]);}s+=text({pop:'POP · 六头密度',cup:'CUP · 六头密度',ship:'SHIP · 四道'}[station],x+w/2,y+h+13,10,'#345a61','text-anchor="middle"');return s;}
async function renderGray(w,h){used=new Set();const short=h<600,top=short?105:125,sy=short?1:1.68,sx=w/320;let s=floor(w,h);const positions={pop:[17*sx,top,132*sx,78*sy],bulk:[228*sx,top+66*sy,67*sx,51*sy],cup:[31*sx,top+118*sy,138*sx,83*sy],cups:[230*sx,top+184*sy,65*sx,50*sy],ship:[38*sx,top+235*sy,139*sx,71*sy]};
 const flow=[[133*sx,top+58*sy],[248*sx,top+90*sy],[110*sx,top+167*sy],[256*sx,top+210*sy],[108*sx,top+273*sy]];
 s+=`<polyline points="${flow.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#b4aa92" stroke-width="16" stroke-linejoin="round"/><polyline points="${flow.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#f1f0df" stroke-width="1" stroke-dasharray="3 7"/>`;
 for(const id of['pop','cup','ship'])s+=grayMachine(id,...positions[id],id==='ship'?4:6);
 for(const id of['bulk','cups']){const[x,y,bw,bh]=positions[id];s+=polygon([[x,y+bh*.35],[x+bw*.55,y],[x+bw,y+bh*.3],[x+bw*.47,y+bh]],'#b8c8c9','#456d73');s+=id==='bulk'?image('product_kernel_b',[x+bw*.42,y+bh*.25,14,14]):cup([x+bw*.40,y+bh*.19,12,15]);s+=text(id==='bulk'?'待装仓':'待发仓',x+bw/2,y+bh+12,10,'#345a61','text-anchor="middle"');}
 const hit=[];for(const id of['pop','bulk','cup','cups','ship']){const r=positions[id];hit.push({id,bounds:r,minimumTargetMet:r[2]>=44&&r[3]>=44});}
 for(const id of['cup','ship']){const r=positions[id],cx=r[0]+r[2]+18,cy=r[1]+r[3]*.68;s+=`<circle cx="${cx}" cy="${cy}" r="22" fill="#fffaf0" stroke="#169ca5" stroke-dasharray="4 3"/>`+text('入口',cx,cy+4,10,'#12646b','text-anchor="middle"');hit.push({id:id+'_input',bounds:[cx-22,cy-22,44,44],minimumTargetMet:true});}
 s+=ui(w,h,6,'upgraded',true);return save(`gate1-g06-density-graybox-${w}x${h}`,w,h,s,{generation:6,configuration:'upgraded',fixtureKind:'geometry-graybox-not-deliverable',conclusion:'GEOMETRY_DRAFT_REQUIRES_REVIEW',hitRegions:hit,notes:['Gray polygons are temporary density geometry, not generated machine art.','Real common cup, three working-head families, UI skin and 44px input targets used for size reference.','No claim that six-generation art or final assembly is complete.']});
}
async function renderPopPair(w,h){used=new Set();const source='art-source/six-gen/pop/exports/machine_pop_pair_body.png';if(!fs.existsSync(path.join(ROOT,source)))return;assets.set('machine_pop_pair_body',{id:'machine_pop_pair_body',file:source});cache.delete('machine_pop_pair_body');let s=floor(w,h);const scale=(w-48)/860,ty=142;const r={size:[860,760],layers:[{id:'machine_pop_pair_body',rect:[46,190,768,506],layer:10},{id:'machine_pop_head',rect:[157,138,262,253.8125],layer:20},{id:'machine_pop_head',rect:[432,238,262,253.8125],layer:20},{id:'machine_pop_front',rect:[169,376,248,132.3871],layer:50},{id:'machine_pop_front',rect:[448,476,248,132.3871],layer:50}]};s+=`<g transform="translate(12,${ty}) scale(${scale})">${renderRig(r)}</g>`+text('G02 双头局部 · 共用工作头 / 前挡',w/2,125,12,'#124e54','text-anchor="middle"');s+=ui(w,h,2,'upgraded');await save(`gate1-g02-pop-pair-${w}x${h}`,w,h,s,{generation:2,configuration:'upgraded',fixtureKind:'partial-cross-package-sample',conclusion:'PARTIAL_SAMPLE_ONLY',notes:['Only POP pair body is new; shared heads/front guards are reused. CUP/SHIP availability is not implied.']});}
async function fixtures(){
 const machine=[];for(const stage of stages)for(const station of ['pop','cup','ship'])for(const state of ['waiting','running','blocked']){const reachable=!(station==='ship'&&state==='blocked')&&!(station==='pop'&&state==='waiting');machine.push({generation:stage.generation,station,state,reachability:reachable?'REACHABLE_STATIC_RULE_REVIEW':'N/A_NORMAL_SETTLED_OPERATION',fixtureKind:reachable?'synthetic-art-only':'excluded-impossible-steady-state',reason:station==='ship'&&state==='blocked'?'ship completion settles directly to coins; no output warehouse':station==='pop'&&state==='waiting'?'pop has no purchased raw-material input and starts empty lanes immediately in settle; no fake waiting-for-material state':'legal state in current core rule flow; art fixture only',installedLanes:stage.stations[station].maxUnlockedLanes,batchSize:stage.stations[station].maxUnlockedBatchSize,jobs:reachable?Array.from({length:stage.stations[station].maxUnlockedLanes},()=>state==='waiting'?null:{amount:stage.stations[station].maxUnlockedBatchSize,progress:state==='blocked'?1:0.5,complete:state==='blocked'}):null,artReview:'PENDING_RIGS_AND_VISUAL_REVIEW'});}
 const warehouse=[];for(const stage of stages)for(const id of['pop','cup'])for(const state of['empty','one-portion','half','full']){const cap=stage.freshStageCapacityFloor;warehouse.push({generation:stage.generation,warehouse:id,state,amount:state==='empty'?0:state==='one-portion'?1:state==='half'?Math.floor(cap/2):cap,capacity:cap,fixtureKind:'synthetic-art-only',capacitySource:'audited fresh stage floor; actual live capacity is max(logistics,stage), not asserted here',representativeLimit:6,artReview:'PENDING_VISUAL_REVIEW'});}
 fs.writeFileSync(qaPath('machine-state-fixtures.json'),JSON.stringify({scope:'Static reachability review, no game execution/save modification',ruleEvidence:['src/core.js:267-278 completion','src/core.js:300-308 start','src/core.js:612-615 view'],count:machine.length,reachable:machine.filter(a=>a.reachability.startsWith('REACHABLE')).length,excluded:machine.filter(a=>a.reachability.startsWith('N/A')).length,fixtures:machine},null,2)+'\n');
 fs.writeFileSync(qaPath('warehouse-fixtures.json'),JSON.stringify({scope:'6 generations x 2 warehouses x 4 occupancy samples; synthetic art only',count:warehouse.length,fixtures:warehouse},null,2)+'\n');
 const mixed=[];for(const stage of stages)for(const station of['pop','cup','ship']){const n=stage.stations[station].maxUnlockedLanes;if(n<2)continue;const b=stage.stations[station].maxUnlockedBatchSize;mixed.push({generation:stage.generation,station,installedLanes:n,fixtureKind:'synthetic-art-only',jobs:[{amount:b,progress:.48,complete:false},station==='ship'?null:{amount:b,progress:1,complete:true},...Array.from({length:Math.max(0,n-2)},()=>station==='pop'?{amount:b,progress:.24,complete:false}:null)],semantics:station==='ship'?'running plus idle lanes, never blocked':'running plus completed output-blocked lane; POP trailing lanes remain running, CUP trailing lanes may wait for input',runtimeExecuted:false});}
 const oldNew=[];for(const stage of stages)for(const station of['pop','cup'])if(stage.stations[station].maxUnlockedBatchSize===2)oldNew.push({generation:stage.generation,station,fixtureKind:'synthetic-art-only',jobs:[{amount:1,progress:.8,complete:false},{amount:2,progress:.25,complete:false}],note:'Independent pre-upgrade one-portion job remains one; newly started job has two. Never duplicate the old job or silently change its amount.',runtimeExecuted:false});
 fs.writeFileSync(qaPath('mixed-and-batch-fixtures.json'),JSON.stringify({scope:'Static legal mixed-lane and old/new batch illustrations; no game saves',mixedLaneFixtures:mixed,oldAndNewBatchFixtures:oldNew},null,2)+'\n');
 const tileW=240,tileH=200;used=new Set();let s='';for(const [i,f]of warehouse.entries()){const x=(i%8)*tileW,y=Math.floor(i/8)*tileH;s+=`<g transform="translate(${x},${y})"><rect width="${tileW}" height="${tileH}" fill="${i%2?'#f6f0e3':'#e4eded'}"/>`+text(`G${f.generation} ${f.warehouse==='pop'?'待装':'待发'} ${f.state}`,10,18,11)+text(`${f.amount} / ${f.capacity} · 静态样例`,10,35,10);const r=selectLogistics(f.warehouse==='pop'?'bulk':'cups',f.generation);s+=`<g transform="translate(28,40) scale(.32)">${renderRig(r,{quantity:f.amount,capacity:f.capacity})}</g></g>`;}await save('warehouse-48-fixture-contact',8*tileW,6*tileH,s,{generation:'all',configuration:'static-fixtures',fixtureKind:'synthetic-art-only',requiredItems:48,conclusion:'PENDING_VISUAL_REVIEW',notes:['All 48 occupancy fixtures use generation-resolved old/new bins. New front rails and one-portion visibility require independent review.']});
 used=new Set();s='';const availability=[];for(const[i,f]of machine.entries()){const x=(i%9)*220,y=Math.floor(i/9)*210,r=selectRig(f.station,f.generation);s+=`<g transform="translate(${x},${y})"><rect width="220" height="210" fill="${i%2?'#f6f0e3':'#e4eded'}"/>`+text(`G${f.generation} ${f.station.toUpperCase()} ${f.state}`,8,18,12);if(f.reachability.startsWith('N/A')){s+=text('N/A · 不构造非法状态',16,86,12,'#8b6a52')+text(f.station==='pop'?'无虚构采购原料流程':'出货完成直接结算',16,106,11,'#8b6a52');}else if(!r){s+=text('待真实机壳 / 装配',16,86,12,'#a34c2d')+text('不可计入已完成',16,106,11,'#a34c2d');}else{const sc=Math.min(190/r.size[0],153/r.size[1]);s+=`<g transform="translate(${(220-r.size[0]*sc)/2},29) scale(${sc})">${renderRig(r,{station:f.station,state:f.state,activeSlots:f.installedLanes,batchSize:f.batchSize})}</g>`+text(f.state==='blocked'?'完成批次保留 · 等待下游空间':f.state==='running'?'加工中 · 独立静态工序示意':'等进料 · 无加工产品',110,198,10,'#345a61','text-anchor="middle"');}s+='</g>';availability.push({generation:f.generation,station:f.station,state:f.state,reachable:f.reachability.startsWith('REACHABLE'),rigAvailable:!!r,status:f.reachability.startsWith('N/A')?'N/A':r?'RENDERED_PENDING_VISUAL_REVIEW':'MISSING_RIG'});}await save('machine-54-state-contact',1980,1260,s,{generation:'all',configuration:'state-fixtures',fixtureKind:'synthetic-art-only',requiredItems:54,conclusion:'PARTIAL_UNTIL_ALL_18_RIGS_EXIST',availability});
}
async function supplemental(){
 const screenshot=(name,x,y,w,h)=>{const f=qaPath('previews/'+name+'.png'),b=fs.readFileSync(f);return {svg:`<image href="data:image/png;base64,${b.toString('base64')}" x="${x}" y="${y}" width="${w}" height="${h}"/>`,reference:{file:path.relative(ROOT,f).replaceAll('\\','/'),sha256:hash(b)}};};
 const g1=JSON.parse(fs.readFileSync(qaPath('previews/g01-entry-320x524.json'))),connectionStates=[[false,false],[true,false],[false,true],[true,true]];
 used=new Set();let s='<rect width="1320" height="628" fill="#f3ead9"/>',refs=[],connectionFixtures=[];
 for(const[i,state]of connectionStates.entries()){const x=i*330,shot=screenshot('g01-entry-320x524',x+5,45,320,524);s+=shot.svg+text(['两段手动','仅待装自动','仅待发自动','两段自动'][i],x+15,27,17);refs.push(shot.reference);for(const[k,id]of['cup_input','ship_input'].entries()){const b=g1.hitRegions.find(h=>h.id===id).bounds,cx=x+5+b[0]+22,cy=45+b[1]+22;const color=state[k]?'#0e8b86':'#986e40';s+=`<circle cx="${cx}" cy="${cy}" r="25" fill="none" stroke="${color}" stroke-width="2.4" ${state[k]?'':'stroke-dasharray="4 3"'}/>`;s+=image(state[k]&&assets.has('ui_icon_automation')?'ui_icon_automation':'ui_icon_wait',[cx+12,cy-33,20,20]);s+=text((k===0?'待装→装杯：':'待发→出货：')+(state[k]?'自动连接':'手动搬运'),x+15,590+k*21,12,color);}
  connectionFixtures.push({popToCupAutomated:state[0],cupToShipAutomated:state[1],fixtureKind:'synthetic-art-only',gameExecuted:false});}
 await save('g01-four-connections-contact',1320,628,s,{generation:1,configuration:'four-connection-states',fixtureKind:'synthetic-art-only',sourceScreenshots:refs,connectionFixtures,conclusion:'PENDING_VISUAL_REVIEW',notes:['Colored automation marker and explicit manual/automatic text are static annotations. No connection purchase or transport code was executed.']});
 used=new Set();s='<rect width="700" height="636" fill="#f3ead9"/>';refs=[];for(const[i,name]of['试运行开始前','试运行完成示意'].entries()){const shot=screenshot('g01-entry-320x524',15+i*350,48,320,524);s+=shot.svg+text(name,24+i*350,29,19);refs.push(shot.reference);s+=image(i&&assets.has('ui_badge_complete')?'ui_badge_complete':'ui_icon_wait',[26+i*350,580,28,28])+text(i?'完成结果标签 · 静态示例':'两段已连接 · 尚未累计',65+i*350,599,13)+text('美术状态说明，未运行自动试运行',24+i*350,624,11,'#7a7464');}
 await save('g01-trial-before-after-contact',700,636,s,{generation:1,configuration:'trial-before-after',fixtureKind:'synthetic-art-only',sourceScreenshots:refs,conclusion:'PENDING_VISUAL_REVIEW',notes:['No elapsed time or trial completion was measured. Both are deliberately labeled static result-state illustrations; interactive UI-state details are provided by the UI package.']});
 used=new Set();s='<rect width="930" height="296" fill="#f3ead9"/>';const transfers=[{amount:4,label:'首次搬运',source:'CONFIG.automation.tutorialBatch / src/core.js route first-manual condition'},{amount:24,label:'常规整盘',source:'CONFIG.automation.logisticsLevels[0].transferBatch'},{amount:36,label:'扩容托盘',source:'CONFIG.automation.logisticsLevels[1].transferBatch'}];for(const[i,f]of transfers.entries()){const x=i*310;s+=text(f.label,x+20,29,18)+text(`${f.amount} 份`,x+20,58,22,'#bc7922');let tray=image('transfer_tray_empty',[0,0,192,133]);const n=Math.min(6,f.amount);for(let k=0;k<n;k++){const px=48+(k%3)*28,py=38+Math.floor(k/3)*24;tray+=image('product_kernel_b',[px,py,23,22.3]);}s+=`<g transform="translate(${x+28},80) scale(1.28)">${clip(tray,[[0,0],[192,0],[192,133],[0,133]])}</g>`+text('代表性颗粒限量显示；份数以样例文字为准',x+14,278,11,'#647c7c');}
 await save('g01-transfer-4-24-36-contact',930,296,s,{generation:1,configuration:'manual-transfer-amounts',fixtureKind:'synthetic-art-only',transferFixtures:transfers,conclusion:'PENDING_VISUAL_REVIEW',ruleEvidence:['src/factory-rules.js:65-75','src/core.js:474'],notes:['No transport action or inventory mutation was executed.']});
 used=new Set();s='<rect width="1280" height="1100" fill="#f3ead9"/>';const mixedRecords=[];
 for(const[gIndex,g]of[5,6].entries())for(const[stationIndex,station]of['pop','cup'].entries())for(const[modeIndex,mode]of['old-new-batch','mixed-running-blocked'].entries()){
  const cell=gIndex*4+stationIndex*2+modeIndex,x=(cell%4)*320,y=Math.floor(cell/4)*550,r=selectRig(station,g),n=stages[g-1].stations[station].maxUnlockedLanes;
  const jobs=Array.from({length:n},(_,i)=>i===0?{amount:modeIndex?2:1,progress:.72,complete:false}:i===1?{amount:2,progress:modeIndex?1:.35,complete:!!modeIndex}:station==='pop'?{amount:2,progress:.24,complete:false}:null);
  s+=text(`G${g} ${station.toUpperCase()} · ${modeIndex?'混合加工/待放':'旧1份 / 新2份'}`,x+12,y+25,15);const scale=Math.min(298/r.size[0],430/r.size[1]);s+=`<g transform="translate(${x+(320-r.size[0]*scale)/2},${y+45}) scale(${scale})">${renderRig(r,{station,state:'running',activeSlots:n,batchSize:2,jobs})}</g>`;
  s+=text(modeIndex?'槽1：2份加工中':'槽1：旧批次1份，仍独立保留',x+12,y+492,12)+text(modeIndex?'槽2：2份已完成，等待下游空间':'槽2：新批次2份，双托/双杯可辨',x+12,y+514,12)+text('静态合法状态示意，未执行游戏',x+12,y+537,11,'#7a7464');mixedRecords.push({generation:g,station,mode,fixtureKind:'synthetic-art-only',installedLanes:n,jobs});
 }
 await save('g05-g06-mixed-and-old-new-batches-contact',1280,1100,s,{generation:[5,6],configuration:'mixed-jobs',fixtureKind:'synthetic-art-only',fixtures:mixedRecords,conclusion:'PENDING_VISUAL_REVIEW'});
 used=new Set();s='<rect width="820" height="922" fill="#f3ead9"/>';refs=[];for(const[i,c]of['entry','upgraded'].entries()){const shot=screenshot(`g06-${c}-390x844`,10+i*410,55,390,844);s+=shot.svg+text(c==='entry'?'扩建进入：4 / 4 / 4 头':'设备满配：6 / 6 / 4 头',22+i*410,31,19);refs.push(shot.reference);}await save('g06-entry-versus-installed-contact',820,922,s,{generation:6,configuration:'entry-vs-upgraded',fixtureKind:'synthetic-art-only',sourceScreenshots:refs,conclusion:'PENDING_VISUAL_REVIEW',notes:['Construction of generation six and completion of all device installations are distinct states. No seventh generation or reward action is introduced.']});
 fs.writeFileSync(qaPath('interaction-scope-not-run.json'),JSON.stringify({scope:'Art-only task; behavior checks intentionally not executed',checks:[{id:'cancel-transfer-reservation',status:'NOT_RUN',reason:'Requires runtime transfer/session state; visual cancel state supplied separately by UI fixtures.'},{id:'second-click-purchase',status:'NOT_RUN',reason:'Requires live purchase handler/idempotence; art cannot verify it.'},{id:'stale-price-quote',status:'NOT_RUN',reason:'Requires live quote validation; illustrative label is not interaction evidence.'},{id:'drag-release-does-not-purchase',status:'NOT_RUN',reason:'No input integration in authorized scope.'},{id:'trial-time-completion',status:'NOT_RUN',reason:'Only before/after artwork state examples were rendered.'}]},null,2)+'\n');
}
async function main(){const mode=process.argv[2]||'gate1';await fixtures();if(mode==='gate1'){for(const [w,h]of[[390,844],[320,524]]){await renderReal(1,'entry',w,h);await renderGray(w,h);await renderPopPair(w,h);}}else if(mode==='final'){for(const g of[1,2,3,4,5,6])for(const c of['entry','upgraded'])for(const[w,h]of[[390,844],[320,524]])await renderReal(g,c,w,h);}console.log(JSON.stringify({mode,output:qaPath('previews'),status:mode==='gate1'?'PARTIAL_GATE1_EVIDENCE':'RENDERED_PENDING_VISUAL_REVIEW'}));}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={renderReal,renderGray,renderRig,selectRig,fixtures,supplemental,assets};
