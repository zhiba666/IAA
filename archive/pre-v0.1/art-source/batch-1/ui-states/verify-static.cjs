'use strict';
// Read-only checks of artwork specifications; report is written only here.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
const {CONFIG}=require(path.join(root,'src/factory-rules.js'));
const js=fs.readFileSync(path.join(__dirname,'preview.js'),'utf8');
new vm.Script(js,{filename:'preview.js'});
const {RULES,EXPANSION_FIXTURES}=vm.runInNewContext(js.split('const definitions =')[0]+'\n({RULES,EXPANSION_FIXTURES});');
const layout=JSON.parse(fs.readFileSync(path.join(__dirname,'spec/layout.json'),'utf8'));
const motion=JSON.parse(fs.readFileSync(path.join(__dirname,'motion-spec.json'),'utf8'));
const failures=[];
const check=(condition,label)=>{if(!condition)failures.push(label);};
const css=fs.readFileSync(path.join(__dirname,'preview.css'),'utf8');
for(const id of ['hud-coin','hud-rate','panel','card-skin','compact-skin','primary','secondary','disabled'])check(css.includes('.phone .'+id+'{border-image-source:'),id+' image source overrides base border shorthand');
for(const id of CONFIG.stationIds)check(RULES.initialCapacity[id]===CONFIG.stations[id].levels[0].capacity,'initial capacity '+id);
check(RULES.initialBuffer===CONFIG.machines[0].buffers.pop&&RULES.initialBuffer===CONFIG.machines[0].buffers.cup,'initial buffer');
check(RULES.cupUpgrade.cost===CONFIG.stations.cup.levels[1].cost,'first cup cost');
check(RULES.cupUpgrade.capacity===CONFIG.stations.cup.levels[1].capacity,'first cup capacity');
check(RULES.doubleCup.cost===CONFIG.stations.cup.levels[2].cost,'dual cup cost');
check(RULES.doubleCup.requiredGeneration===CONFIG.stations.cup.levels[2].requiredMachine+1,'dual cup generation');
for(const key of ['cost','requiredSold','targetRate'])check(RULES.expansion[key]===CONFIG.machines[1][key],'expansion '+key);
check(RULES.expansion.bufferAfter===CONFIG.machines[1].buffers.pop&&RULES.expansion.bufferAfter===CONFIG.machines[1].buffers.cup,'expanded buffer');
const fixtures=Object.entries(EXPANSION_FIXTURES).map(([id,f])=>{
  check(f.coins+f.spent===f.sold*CONFIG.price,id+' ledger');
  check(f.spent===0||f.spent===CONFIG.stations.cup.levels[1].cost,id+' valid purchase expense');
  const reason=!f.rateReached?'rate':f.sold<RULES.expansion.requiredSold?'sold':f.coins<RULES.expansion.cost?'poor':'ready';
  check(reason===id,id+' expansion condition');
  return {id,...f,expectedReason:reason};
});
const geometry=Object.entries(layout.textureGeometry).filter(([,v])=>typeof v==='object').map(([id,expected])=>{
  const png=fs.readFileSync(path.join(root,'assets/art/ui',id+'.png'));
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20),slice=layout.assets.nineSlice;
  const center=[width-slice.left-slice.right,height-slice.top-slice.bottom];
  check(width===expected.width&&height===expected.height,id+' dimensions');
  check(center[0]>0&&center[1]>0,id+' positive nine-slice center');
  check(center.every((v,i)=>v===expected.stretchCenter[i]),id+' documented center');
  return {id,width,height,slice:32,center,centerPositive:center.every(n=>n>0)};
});
check(layout.screens.length===7,'seven UI assemblies');
check(motion.effects.length===6,'six feedback groups');
for(const effect of motion.effects){
  check(effect.timeline[0].from===0&&effect.timeline.at(-1).to===1,effect.id+' full timeline');
  for(let i=1;i<effect.timeline.length;i++)check(effect.timeline[i].from===effect.timeline[i-1].to,effect.id+' continuous timeline');
}
const referenced=[...new Set([...Object.values(motion.assetPaths),...layout.assets.batch0Textures.concat(layout.assets.batch1Textures).map(id=>'assets/art/ui/'+id+'.png'),...layout.assets.icons.map(id=>'assets/art/ui/ui_icon_'+id+'.png')])];
const absent=referenced.filter(file=>!fs.existsSync(path.join(root,file)));
check(absent.length===0,'referenced PNGs exist: '+absent.join(', '));
const report={date:'2026-09-09',scope:'static-ui-and-motion-specification',passed:failures.length===0,source:'src/factory-rules.js',sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src/factory-rules.js'))).digest('hex'),rules:RULES,expansionFixtures:fixtures,nineSlice:geometry,assemblies:layout.screens.length,states:layout.screens.reduce((n,s)=>n+s.states.length,0),motionGroups:motion.effects.length,referencedPngCount:referenced.length,absentPngs:absent,scriptSyntaxChecked:true,browserLayoutChecked:false,gameIntegrated:false,failures};
fs.writeFileSync(path.join(__dirname,'static-qa.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,assemblies:report.assemblies,states:report.states,motionGroups:report.motionGroups,referencedPngCount:report.referencedPngCount,failures},null,2));
if(failures.length)process.exitCode=1;
