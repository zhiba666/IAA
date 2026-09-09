'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,''));
const save=(p,v)=>fs.writeFileSync(path.join(root,p),JSON.stringify(v,null,2)+'\n');
const groups=['core','machinery','icons'];
const existing=read('assets/art/manifest.json');
const rigs={batch0:read('art-source/batch-0/assembly.json'),machinery:read('art-source/batch-1/machinery/assembly.json'),core:read('art-source/batch-1/core/assembly.json')};
const metrics=groups.flatMap(group=>read(`art-source/batch-1/${group}/export-metrics.json`).map(m=>({...m,group})));
const verified=process.argv.includes('--verified');
const entries=metrics.map(m=>{
  const icon=m.id.startsWith('ui_icon_'),ui=m.id.startsWith('ui_'),fx=m.id.startsWith('fx_');
  const e={id:m.id,path:m.path,width:m.width,height:m.height,displayWidth:icon?32:ui?m.width/3:m.id==='factory_room'?390:m.width/2,displayHeight:icon?32:ui?m.height/3:m.id==='factory_room'?585:m.height/2,anchor:{x:ui?0:m.width/2,y:ui?0:m.height},layer:ui?100:fx?70:m.id.includes('front')?50:m.id.includes('head')?20:10,input:null,output:null,slots:[],clip:null,hitArea:null,source:`art-source/batch-1/${m.group}/${m.source}`,sourceRect:m.sourceRect,batch:1,bytes:m.bytes,decodedBytes:m.width*m.height*4,assemblyRefs:[],intendedBinding:ui?'runtime text / selection and reason overlays':fx?'real event only; see motion-spec.json':'see assemblyRefs; static artwork only',status:{produced:true,exported:true,technicalPreviewChecked:verified,integrated:false,stateBound:false,accepted:false}};
  if(ui){e.hitArea={minimumLogicalSize:[44,44],note:'Icons display at 24-32 px inside an independent 44 px touch region.'};if(!icon)e.nineSlice={left:32,top:32,right:32,bottom:32};}
  for(const group of ['machinery','core'])for(const[name,rig]of Object.entries(rigs[group]))if(rig?.size){
    for(const part of rig.layers||rig.parts||[])if(part.id===e.id){
      e.assemblyRefs.push({source:`art-source/batch-1/${group}/assembly.json`,assembly:name,rect:part.rect,layer:part.layer,anchor:rig.anchor,coordinateSpace:'assembly pixels',...(part.flipX?{flipX:true}:{})});
      if(e.id.endsWith('body')||e.id.endsWith('back')||e.id==='product_double_tray'||e.id==='product_box_open'){
        e.input=rig.input||null;e.output=rig.output||null;e.clip=rig.contentClip||null;e.slots=rig.slots||rig.headSlots||rig.content?.slots||[];
        if(rig.clickRegion)e.hitArea={polygon:rig.clickRegion,coordinateSpace:'assembly pixels',minimumLogicalSize:[44,44]};
      }
    }
  }
  e.coordinateSpaces={anchor:'sprite pixels',display:'logical pixels',inputOutputSlotsClip:'assembly pixels; see assemblyRefs',hitArea:ui?'logical pixels':'assembly pixels when polygon is present'};
  if(e.id.startsWith('factory_'))e.environmentLayer={room:'wall/floor plate',window:'left wall prop',door:'left wall doorway prop'}[e.id.replace('factory_','')];
  return e;
});
const all=[...existing.entries.filter(e=>e.batch!==1),...entries];
const seen=new Set();
const checks=all.map(e=>{
  if(seen.has(e.id))throw Error('Duplicate id '+e.id);seen.add(e.id);
  const b=fs.readFileSync(path.join(root,e.path));
  if(b.toString('hex',0,8)!=='89504e470d0a1a0a')throw Error('Not PNG: '+e.path);
  const width=b.readUInt32BE(16),height=b.readUInt32BE(20),colorType=b[25];
  if(width!==e.width||height!==e.height)throw Error('Dimensions: '+e.id);
  if(!fs.existsSync(path.join(root,e.source)))throw Error('Source missing: '+e.source);
  if(e.nineSlice&&(e.nineSlice.left+e.nineSlice.right>=width||e.nineSlice.top+e.nineSlice.bottom>=height))throw Error('Nine slice: '+e.id);
  return {id:e.id,path:e.path,width,height,colorType,bytes:b.length,decodedBytes:width*height*4,sha256:crypto.createHash('sha256').update(b).digest('hex')};
});
const compressedBytes=checks.reduce((s,e)=>s+e.bytes,0),decodedBytes=checks.reduce((s,e)=>s+e.decodedBytes,0);
const manifest={version:2,batch:1,batches:[0,1],scope:'artwork-only',date:'2026-09-09',assemblySource:'art-source/batch-1/assembly.json',compressedBytes,decodedBytes,budget:{p0TargetBytes:2*1024**2,completeTargetBytes:4*1024**2,decodedTargetBytes:32*1024**2,p0Met:compressedBytes<=2*1024**2,completeTargetMet:compressedBytes<=4*1024**2,decodedMet:decodedBytes<=32*1024**2,note:'Exported batch 0 + 1 only; runtime atlases, source files and previews excluded. Complete art still needs G01/T01/B01.'},aliases:{product_pile_small:'product_cup_fill'},entries:all};
save('assets/art/manifest.json',manifest);
save('art-source/batch-1/manifest.json',{...manifest,entries});
save('art-source/batch-1/assembly.json',{version:1,status:'static_art_only_not_integrated',coordinateSpaces:'Each named rig uses its own assembly pixels; scale rigs uniformly.',rigs:{batch0:'art-source/batch-0/assembly.json',machinery:'art-source/batch-1/machinery/assembly.json',products:'art-source/batch-1/core/assembly.json',ui:'art-source/batch-1/ui-states/spec/layout.json'},camera:rigs.batch0.camera,scene:'art-source/batch-1/scene-layout.json',motion:'art-source/batch-1/ui-states/motion-spec.json'});
save('art-source/batch-1/validation.json',{scope:'static asset data; not game acceptance',date:'2026-09-09',newAssets:entries.length,totalAssets:all.length,compressedBytes,decodedBytes,budget:manifest.budget,checks});
const columns=['id','path','width','height','displayWidth','displayHeight','anchor','layer','input','output','slots','clip','hitArea','nineSlice'];
fs.writeFileSync(path.join(__dirname,'asset-table.csv'),'\uFEFF'+columns.join(',')+'\n'+entries.map(e=>columns.map(k=>'"'+(typeof e[k]==='object'?JSON.stringify(e[k]):e[k]??'').toString().replace(/"/g,'""')+'"').join(',')).join('\n')+'\n');
console.log(JSON.stringify({newAssets:entries.length,totalAssets:all.length,compressedMiB:compressedBytes/1024**2,decodedMiB:decodedBytes/1024**2,budget:manifest.budget},null,2));
