const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const ROOT = path.resolve(__dirname, '../../..');
const MODULES = 'C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const sharp = require(path.join(MODULES, 'sharp'));
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT,p), 'utf8'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const planDir = 'art-source/six-generation-20260910/input-plan/IAA_Six_Generation_Art_Plan';
const plan = read(planDir+'/reuse-inventory.json');
const candidates = read(planDir+'/asset-candidates.json');
const manifest = read('assets/art/manifest.json');
const runtime = require(path.join(ROOT,'src/art-manifest.js'));
const files = p => fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(p,e.name)):[path.join(p,e.name)]);
const git = args => cp.execFileSync('git',args,{cwd:ROOT,encoding:'utf8'}).trim();
const counts = ids => {
  const rows = report.assets.filter(a=>ids.includes(a.id));
  return {count:rows.length,pngBytes:rows.reduce((s,a)=>s+a.bytes,0),rgbaBytes:rows.reduce((s,a)=>s+a.decodedBytes,0)};
};
const report = {scope:'Read-only audit of baseline art; no generation or runtime integration. Individual selected references and nine representative images visually inspected, all exported PNGs freshly decoded.',createdAt:new Date().toISOString(),baseCommit:plan.baseCommit,currentHead:git(['rev-parse','HEAD']),baselineMatchesHead:false,trackedBaselineDiff:git(['diff','--name-only',plan.baseCommit,'--','assets/art','src','tools']),workingTreeStatus:git(['status','--short']),tools:{node:process.execPath,sharp:require.resolve(path.join(MODULES,'sharp')),pngjs:require.resolve(path.join(MODULES,'pngjs')),python:'C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',pillowAvailable:true,canvasAvailable:false,installedDependencies:false},references:[],assets:[],findings:[]};
report.baselineMatchesHead=report.currentHead===report.baseCommit;
async function inspect(file) {
  const b=fs.readFileSync(file), metadata=await sharp(b).metadata();
  const {data,info}=await sharp(b).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const [w,h,c]=[info.width,info.height,info.channels];
  const alpha={minimum:255,maximum:0,transparentPixels:0,translucentPixels:0,opaquePixels:0,borderAlphaPositive:0,borderAlpha128:0,borderAlpha255:0};
  const boxes={positive:[w,h,-1,-1],alpha128:[w,h,-1,-1]};
  const border128=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const a=data[(y*w+x)*c+c-1]; alpha.minimum=Math.min(alpha.minimum,a);alpha.maximum=Math.max(alpha.maximum,a);
    if(a===0)alpha.transparentPixels++;else if(a===255)alpha.opaquePixels++;else alpha.translucentPixels++;
    for(const [name,threshold] of [['positive',1],['alpha128',128]])if(a>=threshold){const z=boxes[name];z[0]=Math.min(z[0],x);z[1]=Math.min(z[1],y);z[2]=Math.max(z[2],x);z[3]=Math.max(z[3],y);}
    if(x===0||x===w-1||y===0||y===h-1){if(a>0)alpha.borderAlphaPositive++;if(a>=128){alpha.borderAlpha128++;border128.push([x,y,a]);}if(a===255)alpha.borderAlpha255++;}
  }
  return {path:path.relative(ROOT,file).replaceAll('\\','/'),width:w,height:h,channels:metadata.channels,hasAlpha:metadata.hasAlpha,format:metadata.format,bytes:b.length,decodedBytes:w*h*4,sha256:sha(b),alpha,boundsInclusive:boxes,borderPixelsAlpha128:border128.length<100?border128:undefined};
}
(async()=>{
 const entries=new Map(manifest.entries.map(a=>[a.id,a]));
 const planEntries=new Map(plan.assets.map(a=>[a.id,a]));
 for(const file of files(path.join(ROOT,'assets/art')).filter(f=>f.endsWith('.png')).sort()){
   const a=await inspect(file);a.id=path.basename(file,'.png');a.selectedByCurrentBuild=runtime.ART_RUNTIME_IDS.includes(a.id);
   const entry=entries.get(a.id), pa=planEntries.get(a.id), ra=runtime.ART_ASSETS[a.id];
   a.manifestMatched=!!entry;a.planMatched=!!pa;a.metadataMismatches=[];a.manifestMissingFields=[];
   if(entry)for(const k of ['path','width','height','bytes','decodedBytes']){if(entry[k]===undefined)a.manifestMissingFields.push(k);else if(entry[k]!==a[k])a.metadataMismatches.push({field:k,manifest:entry[k],actual:a[k]});}
   if(ra)for(const k of ['width','height','bytes','decodedBytes','sha256'])if(ra[k]!==a[k])a.metadataMismatches.push({field:'runtime.'+k,manifest:ra[k],actual:a[k]});
   a.runtimeShaVerified=ra?.sha256===a.sha256;
   if(pa&&pa.selectedByCurrentBuild!==a.selectedByCurrentBuild)a.metadataMismatches.push({field:'plan.selectedByCurrentBuild',plan:pa.selectedByCurrentBuild,actual:a.selectedByCurrentBuild});
   a.source=entry?.source;a.sourceExists=entry?.source?fs.existsSync(path.join(ROOT,entry.source)):false;
   a.status=a.id==='product_kernel_a'?'repair_candidate_required':a.id==='factory_room'?'opaque_background_reusable':'technically_reusable_pending_target_assembly';
   report.assets.push(a);
 }
 const refs=['output/imagegen/popcorn-ui-20260909/popcorn-factory-simplified.png','output/imagegen/popcorn-ui-20260909/ui-components.png','output/imagegen/popcorn-ui-20260909/ui-upgrade-and-production.png','output/imagegen/popcorn-ui-20260909/ui-tasks-and-shipping.png'];
 for(const p of refs){const b=fs.readFileSync(path.join(ROOT,p)),meta=await sharp(b).metadata();report.references.push({path:p,absolutePath:path.join(ROOT,p),sha256:sha(b),width:meta.width,height:meta.height,bytes:b.length,visuallyInspected:true});}
 report.referenceSupport=['assets/art/products/product_cup_empty.png','assets/art/products/product_cup_fill.png','assets/art/machines/machine_pop_head.png','assets/art/machines/machine_cup_head.png','assets/art/machines/machine_ship_head.png','assets/art/ui/ui_panel.png','art-source/batch-0/assembly.json','art-source/batch-1/machinery/assembly.json','art-source/batch-1/machinery/assembly-preview.png'].map(p=>({path:p,absolutePath:path.join(ROOT,p),sha256:sha(fs.readFileSync(path.join(ROOT,p))),visuallyInspected:p.endsWith('.png')}));
 const ids=report.assets.map(a=>a.id);
 report.crosscheck={manifestEntries:manifest.entries.length,physicalPngs:ids.length,planEntries:plan.assets.length,missingManifestFiles:manifest.entries.filter(a=>!ids.includes(a.id)).map(a=>a.id),unlistedPngs:ids.filter(id=>!entries.has(id)),missingPlanFiles:plan.assets.filter(a=>!ids.includes(a.id)).map(a=>a.id),metadataMismatchIds:report.assets.filter(a=>a.metadataMismatches.length).map(a=>a.id),allSourcesExist:report.assets.every(a=>a.sourceExists),runtimeShaVerified:report.assets.filter(a=>a.runtimeShaVerified).length,aliasesNotCounted:manifest.aliases,requiredNewCandidateCount:candidates.requiredCandidates,conditionalNewCandidateCount:candidates.conditionalCandidates,candidateIdsAlreadyPresent:candidates.assets.filter(a=>ids.includes(a.id)).map(a=>a.id)};
 const all=counts(ids),current=counts(runtime.ART_RUNTIME_IDS);
 report.budget={unit:'MiB = 1048576 bytes. PNG file bytes and width*height*4 RGBA are separate; no ZIP or GPU/total process memory substitution.',targets:{firstGenerationPngBytes:2*1048576,allUniquePngBytes:4*1048576,rgbaBytes:32*1048576},allUnique:all,currentRuntime:current,currentRuntimePngWithin2MiB:current.pngBytes<=2*1048576,allPngWithin4MiB:all.pngBytes<=4*1048576,allRgbaWithin32MiB:all.rgbaBytes<=32*1048576,allPngOver4MiB:Math.max(0,all.pngBytes-4*1048576),currentRuntimePngOver2MiB:Math.max(0,current.pngBytes-2*1048576),sixGenerationPerGenerationAndTransitionPeak:'Not measured: new candidates do not exist yet; current runtime assets are not proof of generation dependency/peak budgets.'};
 report.findings=[{severity:'must_fix_candidate',id:'product_kernel_a',detail:'Fresh decode reconfirms alpha>=128 pixels on the outer border. Recover complete silhouette from source/crop with transparent gutter or imagegen repair into candidate directory. Preserve baseline file. Do not claim adding padding reconstructs missing pixels.'},{severity:'budget_fail',detail:'Existing unique exported PNGs exceed the 4 MiB target before adding six-generation candidates; current runtime set exceeds 2 MiB first-package target. Re-export/optimize candidate set and measure all generation dependency unions.'},{severity:'scope',detail:'All 60 PNGs decoded and mapped; only representative art and selected references visually inspected. Target assembly, white/dark edge QA, small-screen readability and six-generation integration are not claimed.'},{severity:'reuse',detail:'Current cups, kernels after kernel_a repair, three head families, UI plates, conveyors, bins and packaging are visual foundations. New multi-slot bodies/front occluders must preserve orthographic axes and proportions; do not horizontally stretch old machines.'},{severity:'reference',detail:'Four approved concept/UI images contain baked example text and products. They are appearance references only, not production-ready sprites or authoritative gameplay numbers.'}];
 fs.writeFileSync(path.join(__dirname,'baseline-report.json'),JSON.stringify(report,null,2)+'\n');
 const mib=n=>(n/1048576).toFixed(4);
 const rows=report.assets.map(a=>`| ${a.id} | ${a.width}×${a.height} | ${a.bytes} | ${a.alpha.borderAlpha128} | ${a.selectedByCurrentBuild?'是':'否'} | ${a.id==='product_kernel_a'?'必须修复候选':'技术复用候选'} |`).join('\n');
 const md=`# 六代美术基线审计\n\n只做美术基线审计，未修改 assets/art、src、tools，未执行游戏构建或接入。记录于 ${report.createdAt}。\n\n## 基线与实体\n\n- 当前 HEAD：\`${report.currentHead}\`，与计划基线完全一致。\n- assets/art、src、tools 相对计划提交无差异。工作区其他既有未跟踪文件见 JSON 快照。\n- 实体 PNG ${all.count} 个、清单 ${manifest.entries.length} 项、计划复用 ${plan.assets.length} 项；运行选择 ${current.count} 个。文件、尺寸、字节、解码估算与清单一致；运行时 ${report.crosscheck.runtimeShaVerified} 个 SHA 一致。\n- 全部 ${all.count} 张 PNG 已逐图实际解码，JSON 逐件记录 SHA、透明/半透明/不透明像素、边界和 alpha 可见范围。四张选定参考及九张代表性现有图已工具目检；未冒充全部逐图视觉验收。\n- 候选计划含 ${candidates.requiredCandidates} 个必需新增和 ${candidates.conditionalCandidates} 个条件新增，尚无同名正式 PNG。\n\n## 预算实测\n\n| 集合 | PNG 文件字节 | PNG MiB | RGBA 基础字节 | RGBA MiB |\n|---|---:|---:|---:|---:|\n| 60 张全部 | ${all.pngBytes} | ${mib(all.pngBytes)} | ${all.rgbaBytes} | ${mib(all.rgbaBytes)} |\n| 41 张运行选择 | ${current.pngBytes} | ${mib(current.pngBytes)} | ${current.rgbaBytes} | ${mib(current.rgbaBytes)} |\n\n完整美术 4 MiB 目标已超出 ${report.budget.allPngOver4MiB} B；当前运行集合较首代/首包 2 MiB 目标超出 ${report.budget.currentRuntimePngOver2MiB} B。RGBA 基础解码估算在 32 MiB 目标内，但不等同 GPU 或进程总内存。新增六代素材必须在候选目录优化并重新测量 common + generation 与转代并集；当前结果不能证明六代预算通过。\n\n## 复用与必须修复\n\n1. \`product_kernel_a\` 边缘缺少安全透明间隔，重新解码确认 ${report.assets.find(a=>a.id==='product_kernel_a').alpha.borderAlpha128} 个外边界像素 alpha ≥ 128。必须从原源图恢复完整裁切/用图像工具修复后导出到候选目录，保留原件；仅补空白不能证明恢复了被切断轮廓。\n2. 空杯、填充、三类工作头与无字 UI 底板目检可作为同风格复用基础。kernel_b 轮廓正常；kernel_a 右侧轮廓触边。装配预览证明杯/产品/头/挡板分层结构可延用，但高代插槽比例仍需新静态装配验证。\n3. 输送、两仓、包装旧件经实体和 alpha 技术核查可进入复用候选。其局部接料位置、遮挡、小屏辨識度由各新装配验证，不能用技术通过替代视觉通过。\n4. 原首代机体/front 保留，新多头机壳不得对旧整机非等比横拉。\n5. factory_room 允许不透明且接触画布边界；其他透明精灵的强 alpha 边界接触按缺陷检查。\n6. 源图和概念 UI 中示例文字/金额/数值不成为资源文字或新玩法。\n\n## 可用参考\n\n${report.references.map(r=>`- [${path.basename(r.path)}](../../../${r.path}) — ${r.width}×${r.height}，SHA-256 \`${r.sha256}\``).join('\n')}\n\n同一目检参考中，机器是简化圆角体块、青绿/灰钢、大色块和左上光；红白杯和黄色爆米花为视觉重点。UI 使用奶油底和青绿边框，主动作黄色。带文字整板仅用于外观方向。真实绝对路径及杯、头、UI、装配参考在 JSON 的 references/referenceSupport。\n\n## 工具\n\n- Node：\`${report.tools.node}\`\n- sharp：\`${report.tools.sharp}\`\n- pngjs：\`${report.tools.pngjs}\`\n- Python：\`${report.tools.python}\`；Pillow 已存在，只检查可用性。\n- 未安装依赖；canvas 不可用。本审计用 sharp 读取图片而未编辑图片。\n\n## 逐件结果\n\n边界列是外边界 alpha ≥ 128 像素数；factory_room 不透明背景为例外。\n\n| ID | 尺寸 | PNG B | 边界 ≥128 | 运行选择 | 处理 |\n|---|---:|---:|---:|---|---|\n${rows}\n`;
 fs.writeFileSync(path.join(__dirname,'baseline-report.md'),md);
 console.log(JSON.stringify({crosscheck:report.crosscheck,budget:report.budget,borderFindings:report.assets.filter(a=>a.alpha.borderAlpha128).map(a=>({id:a.id,borderAlpha128:a.alpha.borderAlpha128})),output:path.join(__dirname,'baseline-report.json')},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
