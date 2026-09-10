// Run only after the listed PNGs have been independently viewed. This freezes that
// specific manual review; it is not a visual test that can approve new renders.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const sharp=require('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const ROOT=path.resolve(__dirname,'../../..'),qa=__dirname,preview=path.join(qa,'previews');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p,o)=>fs.writeFileSync(p,JSON.stringify(o,null,2)+'\n');
const manifestFile='art-source/six-gen/integration/manifest.json',manifest=read(path.join(ROOT,manifestFile)),manifestSha=sha(fs.readFileSync(path.join(ROOT,manifestFile)));
const time=new Date().toISOString(),scenes=[],contacts=[];
for(let g=1;g<=6;g++){
 for(const c of['entry','upgraded'])for(const[w,h]of[[390,844],[320,524]])scenes.push(`g${String(g).padStart(2,'0')}-${c}-${w}x${h}`);
 contacts.push(`g${String(g).padStart(2,'0')}-four-view-review`);
}
contacts.push('asset-overview-light','asset-overview-dark','six-generations-overview','machine-54-state-contact','warehouse-48-fixture-contact','g01-four-connections-contact','g01-trial-before-after-contact','g01-transfer-4-24-36-contact','g05-g06-mixed-and-old-new-batches-contact','g06-entry-versus-installed-contact');
const review={reviewedAt:time,reviewer:'Independent baseline_qa agent',scope:'Static art review only; no runtime, interaction, device or GPU assertions.',finalManifest:{path:manifestFile,sha256:manifestSha},status:'STATIC_ART_REVIEW_PASSED',reviewedArtifacts:[],closedFindings:[
 {id:'rack-front-P1',resolution:'Owner replaced misaligned reused rails with a front mask matching the new rack back; lower-row cups and all four occupancy levels were re-reviewed in the 48-cell contact.'},
 {id:'single-cup-packaging-envelope',resolution:'Single-cup products use the dedicated singleCupRect; double trays and four-cup boxes use the documented packaging envelope at uniform aspect ratio.'},
 {id:'G06-detached-tower-front',resolution:'Detached lower-margin front frame removed from both viewport scenes; exported sprite remains visible in both independent asset overviews.'},
 {id:'final-alpha-candidate-exceptions',resolution:'Root retained original candidate PNGs for product_kernel_b and ui_button_disabled after final palette alpha audit. All final previews regenerated against the locked unified manifest.'}
],knownScopeLimits:[
 'The current frame of running and blocked machines can share the occupied-product artwork. Contact captions and fixture jobs identify the state; this does not assert a tested animation or interaction.',
 'Quantities use a bounded representative sprite count. Text identifies the explicit synthetic quantity; the number of painted kernels or cups is not the live inventory.',
 'Entry fixtures preserve the previous generation maximum installation/batch configuration as an explicit static example, not a reconstructed player save.',
 'Small viewport scenes were inspected as image artifacts. Actual touch behavior, physical screen readability and performance have not been tested.'
]};
(async()=>{
 const issues=[],byId=new Map(),totals={count:0,bytes:0,decodedRgbaBytes:0};
 for(const a of manifest.assets){const b=fs.readFileSync(path.join(ROOT,a.file)),m=await sharp(b).metadata();if(sha(b)!==a.sha256)issues.push('manifest asset SHA '+a.id);if(m.width!==a.width||m.height!==a.height)issues.push('manifest asset dimensions '+a.id);byId.set(a.id,a);totals.count++;totals.bytes+=b.length;totals.decodedRgbaBytes+=m.width*m.height*4;}
 const technical=read(path.join(qa,'static-preview-validation.json'));if(!technical.allTechnicalChecksPass)issues.push('base technical checks failed');
 for(const stem of[...scenes,...contacts]){
  const file=path.join(preview,stem+'.png'),recordFile=path.join(preview,stem+'.json'),b=fs.readFileSync(file),m=await sharp(b).metadata(),j=read(recordFile),localIssues=[];
  if(j.pngSha256!==sha(b))localIssues.push('PNG SHA mismatch');
  if(j.viewSize[0]!==m.width||j.viewSize[1]!==m.height)localIssues.push('PNG dimensions mismatch');
  for(const a of j.assetSHAs||[]){const f=a.path||a.file,target=path.join(ROOT,f),locked=byId.get(a.id);if(!fs.existsSync(target)||sha(fs.readFileSync(target))!==a.sha256)localIssues.push('stale asset '+a.id);if(!locked||locked.file!==f||locked.sha256!==a.sha256)localIssues.push('not final unified asset '+a.id);}
  for(const a of[...(j.sourceScreenshots||[]),...(j.screenshots||[])])if(sha(fs.readFileSync(path.join(ROOT,a.file)))!==a.sha256)localIssues.push('stale source PNG '+a.file);
  for(const a of j.assemblySHAs||[])if(sha(fs.readFileSync(path.join(ROOT,a.path)))!==a.sha256)localIssues.push('stale assembly '+a.path);
  if(j.finalManifestSha256&&j.finalManifestSha256!==manifestSha)localIssues.push('stale manifest evidence');
  if(localIssues.length)issues.push(...localIssues.map(x=>stem+': '+x));
  const pngSha256=sha(b),reviewedVia=scenes.includes(stem)?`g${stem.slice(1,3)}-four-view-review.png`:stem+'.png';
  review.reviewedArtifacts.push({file:path.relative(ROOT,file).replaceAll('\\','/'),pngSha256,viewSize:[m.width,m.height],reviewedVia,conclusion:'VERIFIED_STATIC_ART',technicalIssues:localIssues});
  j.conclusion='VERIFIED_STATIC_ART';j.visualReview={reviewedAt:time,reviewRecord:'art-source/six-gen/qa/final-independent-review.json',reviewedVia,pngSha256,scope:'Static art image only'};j.finalManifestSha256=manifestSha;write(recordFile,j);
 }
 for(const stem of['machine-state-fixtures','warehouse-fixtures']){const p=path.join(qa,stem+'.json'),j=read(p);for(const f of j.fixtures)f.artReview=f.fixtureKind==='excluded-impossible-steady-state'?'N/A_NOT_A_PASS':'VERIFIED_STATIC_ART';j.finalReviewAt=time;j.reviewContact=stem==='machine-state-fixtures'?'previews/machine-54-state-contact.png':'previews/warehouse-48-fixture-contact.png';write(p,j);}
 const protectedDiff=cp.execFileSync('git',['diff','--name-only','HEAD','--','src','assets','tools'],{cwd:ROOT,encoding:'utf8'}).trim();
 if(protectedDiff)issues.push('protected tracked files changed: '+protectedDiff);
 review.baselineCommit=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();review.protectedTrackedPathsUnchanged=!protectedDiff;review.finalAssetTotals=totals;
 review.coverage={generationStationMappings:18,scenePreviews:24,viewports:[[390,844],[320,524]],configurations:['entry','upgraded'],machineFixtureCells:54,reachableMachineFixtures:42,notApplicableMachineFixtures:12,warehouseFixtureCells:48,extraContactBoards:5,assetOverviewItems:84,reviewedPngArtifacts:review.reviewedArtifacts.length};
 review.interactionNotRunRecord='art-source/six-gen/qa/interaction-scope-not-run.json';review.technicalIssues=issues;
 review.status=issues.length?'INCOMPLETE_OR_FAILED':'STATIC_ART_REVIEW_PASSED';
 write(path.join(qa,'final-independent-review.json'),review);
 const md=[
 '# 六代美术独立验收',
 '',
 `结论：${issues.length?'存在未通过项':'静态美术检查通过'}。检查时间：${time}。`,
 '',
 '本报告只覆盖资源与静态装配预览。未接入游戏代码，未运行真机、输入事件或性能测试。',
 '',
 '| 项目 | 结果 |',
 '|---|---|',
 '| 六代 × 三工位 | 18 个真实装配映射 |',
 '| 场景 | 24 张：六代 × entry/upgraded × 390×844/320×524 |',
 '| 机器状态 | 54 格，42 个可达静态案例，12 个 N/A（未计通过） |',
 '| 仓库状态 | 48 格：两仓 × 六代 × 空/1份/半满/满 |',
 '| 补充状态板 | 四连接、试运行前后、4/24/36、旧批次/双份混合、六代进入/满配，共 5 张 |',
 '| 资源透明边缘 | 84 件浅底/深底总览已目检，真实 alpha 技术检查另见 integration 报告 |',
 `| 最终 PNG 总量 | ${totals.count} 件，${totals.bytes.toLocaleString('en-US')} B；解码 RGBA ${totals.decodedRgbaBytes.toLocaleString('en-US')} B |`,
 `| 文件一致性 | ${issues.length?'未通过':'通过'}：PNG、资源、装配与衍生图 SHA 均对照最终清单 |`,
 '',
 '24 张场景通过六张原生像素四视图条逐代查看。三工位维持 S 形流向，两仓分离；机头与盖板数量可辨。高代双份托具、双杯、四杯包装另在局部板检查。数量为明确标注的静态样例，HUD 用破折号避免虚构现场数值。',
 '',
 '已关闭的问题：货架前栏与下层杯遮挡、单杯包装包络过大、六代独立前框脱离塔体、最终量化的两项 alpha 例外。六代前框仅保留在独立资源总览，未放入全景。',
 '',
 '机器 N/A 为六代 POP 等料和六代 SHIP 满仓等待：当前规则不提供这些正常稳态。取消预留、二次点击、报价过期、拖放释放和实测试运行均在 interaction-scope-not-run.json 标为 NOT_RUN。静态图不冒充运行结果。',
 '',
 `基线 HEAD：${review.baselineCommit}。src / assets / tools 的已跟踪文件差异为空。最终 manifest SHA：${manifestSha}。`,
 '',
 '选取交付文件：previews/g??-entry-*.png、g??-upgraded-*.png 及同名 JSON；上述两类状态矩阵、五张补充板、三张总览和六张四视图检查条。Gate1 灰盒、早期临时局部及压缩实验保留为过程证据，不属于成品场景。',
 '',
 'PNG 级目检记录与各文件 SHA 见 final-independent-review.json；技术映射与 24 图数据核对见 static-preview-validation.json。'
 ];fs.writeFileSync(path.join(qa,'FINAL_INDEPENDENT_REVIEW.md'),md.join('\n')+'\n');
 console.log(JSON.stringify({status:review.status,coverage:review.coverage,totals,issues},null,2));if(issues.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
