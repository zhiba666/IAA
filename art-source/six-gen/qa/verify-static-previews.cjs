const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sharp=require('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const ROOT=path.resolve(__dirname,'../../..'),renderer=require('./render-static-previews.cjs');
const profiles=JSON.parse(fs.readFileSync(path.join(ROOT,'art-source/six-gen/contracts/stage-profile.snapshot.json'))).stages;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const report={scope:'Independent static data/file checks. No game execution, save writes, runtime input tests or device tests.',createdAt:new Date().toISOString(),requiredSceneCount:24,requiredGenerationStationMappings:18,scenes:[],rigs:[],findings:[],fixtureMatrices:{}};
async function metaFor(id){const a=renderer.assets.get(id);if(!a)return null;const f=path.isAbsolute(a.file)?a.file:path.join(ROOT,a.file);if(!fs.existsSync(f))return null;const m=await sharp(f).metadata();return {file:f,width:m.width,height:m.height};}
function geometry(value){return Array.isArray(value)&&value.every(Number.isFinite);}
(async()=>{
 for(const stage of profiles)for(const station of['pop','cup','ship']){
  const r=renderer.selectRig(station,stage.generation),check={generation:stage.generation,station,rigId:r?.id||null,available:!!r,issues:[]};
  if(r){if(!geometry(r.size)||r.size.some(x=>x<=0))check.issues.push('invalid rig size');
   for(const field of['input','output'])if(!geometry(r[field])||r[field].length!==2)check.issues.push('invalid '+field);
   const slots=r.slots?.length||r.headSlots?.length||(r.layers||[]).filter(l=>String(l.id).includes('_head')).length;
   check.slots=slots;check.requiredMaximum=stage.stations[station].maxUnlockedLanes;if(slots<check.requiredMaximum)check.issues.push('insufficient actual slots');
   const parts=[...(r.layers||[]),...(r.slots||[]).flatMap(s=>[s.head,s.cover,s.front,s.content,s.carrier,s.cup]).filter(p=>p?.id&&p?.rect)];
   for(const p of parts){if(!geometry(p.rect)||p.rect.length!==4||p.rect[2]<=0||p.rect[3]<=0){check.issues.push('invalid rect '+p.id);continue;}const m=await metaFor(p.id);if(!m){check.issues.push('unresolved asset '+p.id);continue;}
    // Content rectangles can be a documented multi-part packaging canvas, not the named representative sprite's ratio.
    if(p.rigByAmount||p.assembly)continue;
    const sx=p.rect[2]/m.width,sy=p.rect[3]/m.height;if(Math.abs(sx-sy)/Math.max(sx,sy)>.012)check.issues.push('nonuniform aspect '+p.id);
   }
  }else check.issues.push('missing real rig');
  check.issues=[...new Set(check.issues)];report.rigs.push(check);
 }
 for(const g of[1,2,3,4,5,6])for(const configuration of['entry','upgraded'])for(const[w,h]of[[390,844],[320,524]]){
  const stem=`g${String(g).padStart(2,'0')}-${configuration}-${w}x${h}`,png=path.join(__dirname,'previews',stem+'.png'),json=path.join(__dirname,'previews',stem+'.json');
  const check={generation:g,configuration,viewSize:[w,h],file:path.relative(ROOT,png).replaceAll('\\','/'),exists:fs.existsSync(png)&&fs.existsSync(json),issues:[]};
  if(check.exists){const b=fs.readFileSync(png),m=await sharp(b).metadata(),j=JSON.parse(fs.readFileSync(json));if(m.width!==w||m.height!==h)check.issues.push('incorrect dimensions');if(j.pngSha256!==hash(b))check.issues.push('PNG SHA mismatch');if(j.generation!==g||j.configuration!==configuration)check.issues.push('fixture identity mismatch');if(!j.syntheticArtOnly)check.issues.push('missing synthetic-art-only disclosure');
   for(const a of j.assetSHAs||[]){const f=path.join(ROOT,a.path);if(!fs.existsSync(f)||hash(fs.readFileSync(f))!==a.sha256)check.issues.push('stale/missing asset '+a.id);}
   for(const a of j.assemblySHAs||[]){const f=path.join(ROOT,a.path);if(!fs.existsSync(f)||hash(fs.readFileSync(f))!==a.sha256)check.issues.push('stale/missing assembly '+a.path);}
   if((j.rigs||[]).length!==3)check.issues.push('not three station rigs');
   for(const hit of j.hitRegions||[])if(hit.bounds[2]<44||hit.bounds[3]<44)check.issues.push('undersized hit reference '+hit.id);
   check.visualConclusion=j.conclusion;check.assetCount=j.assetSHAs?.length||0;
  }else check.issues.push('missing PNG or evidence JSON');report.scenes.push(check);
 }
 for(const[name,expected]of[['machine-state-fixtures',54],['warehouse-fixtures',48]]){const file=path.join(__dirname,name+'.json'),data=JSON.parse(fs.readFileSync(file));report.fixtureMatrices[name]={actual:data.fixtures.length,expected,countPass:data.fixtures.length===expected,missingDisclosures:data.fixtures.filter(f=>!['synthetic-art-only','excluded-impossible-steady-state'].includes(f.fixtureKind)).length};}
 report.fixtureMatrices.machineReachability=JSON.parse(fs.readFileSync(path.join(__dirname,'machine-state-fixtures.json'))).fixtures.reduce((a,f)=>(a[f.reachability]=(a[f.reachability]||0)+1,a),{});
 report.availableRigMappings=report.rigs.filter(r=>r.available).length;report.renderedSceneCount=report.scenes.filter(s=>s.exists).length;
 report.allTechnicalChecksPass=report.rigs.every(r=>r.issues.length===0)&&report.scenes.every(s=>s.issues.length===0)&&Object.values(report.fixtureMatrices).every(v=>v.countPass===undefined||v.countPass&&v.missingDisclosures===0);
 report.status=report.allTechnicalChecksPass?'TECHNICAL_CHECKS_PASSED_VISUAL_REVIEW_SEPARATE':'INCOMPLETE_OR_FAILED';
 report.notClaimed=['All final visual checks','runtime behavior','GPU/process memory','real device performance','input event behavior','release or integration'];
 fs.writeFileSync(path.join(__dirname,'static-preview-validation.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,availableRigMappings:report.availableRigMappings,renderedSceneCount:report.renderedSceneCount,rigIssues:report.rigs.filter(r=>r.issues.length),sceneIssues:report.scenes.filter(r=>r.exists&&r.issues.length)},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
