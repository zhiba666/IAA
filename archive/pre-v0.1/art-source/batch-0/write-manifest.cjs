'use strict';
// Metadata is reviewed separately from the mechanical PNG cutting recipe.
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'../..');
const metrics=JSON.parse(fs.readFileSync(path.join(root,'art-source/batch-0/export-metrics.json'),'utf8').replace(/^\uFEFF/,''));
const assembly=JSON.parse(fs.readFileSync(path.join(__dirname,'assembly.json'),'utf8'));
const entries=metrics.map(m=>{
  const ui=m.id.startsWith('ui_');
  const front=m.id.includes('front'),head=m.id.endsWith('head');
  return {id:m.id,path:m.path,width:m.width,height:m.height,
    displayWidth:ui?m.width/3:m.width/2,displayHeight:ui?m.height/3:m.height/2,
    anchor:{x:ui?0:m.width/2,y:ui?0:m.height},layer:ui?100:front?40:head?20:10,
    input:null,output:null,slots:[],clip:null,hitArea:null,
    ...(ui?{nineSlice:{left:32,top:32,right:32,bottom:32}}:{}),
    source:'art-source/batch-0/'+m.source,sourceRect:m.sourceRect,batch:0,
    intendedBinding:m.id.startsWith('product_kernel')?'job.progress / inventory amount':'see art-source/batch-0/assembly.json',
    status:{produced:true,exported:true,technicalPreviewChecked:true,integrated:false,stateBound:false,accepted:false}};
});
for(const entry of entries){
  entry.assemblyRefs=[];
  for(const [name,rig] of Object.entries(assembly)){
    if(!rig||!rig.size)continue;
    for(const [part,value] of Object.entries(rig))if(value&&value.id===entry.id){
      entry.assemblyRefs.push({assembly:name,part,rect:value.rect,layer:value.layer});
      entry.layer=value.layer;
      if(part==='body'||part==='back'||part==='empty'){
        entry.anchor={x:rig.anchor[0],y:rig.anchor[1]};
        entry.input=rig.input||null;entry.output=rig.output||null;entry.clip=rig.contentClip||null;
      }
    }
  }
  if(entry.id==='machine_cup_body'){
    entry.slots=[{id:'head_0',position:assembly.cupMachine.head.pivot,rect:assembly.cupMachine.head.rect}];
    entry.hitArea={rect:[0,0,448,640],note:'Proposed local image area only; actual >=44px touch targets are deferred.'};
  }
  if(entry.id==='product_cup_fill')entry.clip=assembly.cupProduct.fillClip;
}
fs.writeFileSync(path.join(root,'assets/art/manifest.json'),JSON.stringify({batch:0,scope:'artwork-only',date:'2026-09-09',assemblySource:'art-source/batch-0/assembly.json',compressedBytes:metrics.reduce((s,e)=>s+e.bytes,0),decodedBytes:metrics.reduce((s,e)=>s+e.decodedBytes,0),entries},null,2)+'\n');
console.log('Recorded '+entries.length+' exported sprites.');
