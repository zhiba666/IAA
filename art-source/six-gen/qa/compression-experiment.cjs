const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sharp=require('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const ROOT=path.resolve(__dirname,'../../..'),baseline=require('./baseline-report.json');
const OUT=path.join(__dirname,'compression-experiment');fs.mkdirSync(OUT,{recursive:true});
const presets=[{id:'full256',scale:1,palette:true,colours:256,quality:95,dither:0.5},{id:'compact256',scale:0.75,palette:true,colours:256,quality:92,dither:0.5}];
const result={scope:'QA-only derivative experiments; baseline and official assets untouched; not final accepted exports.',createdAt:new Date().toISOString(),method:'Uniform resize only; alpha-aware palette PNG. Full256 preserves original dimensions. Compact256 keeps products/icons native resolution, scales machine/scene/fx/UI plates to 75%.',presets:[],visualReview:'PENDING'};
async function compositeDiff(src,dst,w,h){
 const a=await sharp(src).resize(w,h,{fit:'fill'}).ensureAlpha().raw().toBuffer(),b=await sharp(dst).ensureAlpha().raw().toBuffer();
 let sum=0,alphaMax=0,edge=0;
 for(let i=0;i<a.length;i+=4){let aa=a[i+3]/255,ba=b[i+3]/255;alphaMax=Math.max(alphaMax,Math.abs(a[i+3]-b[i+3]));for(const bg of [24,245])for(let c=0;c<3;c++){let d=(a[i+c]*aa+bg*(1-aa))-(b[i+c]*ba+bg*(1-ba));sum+=d*d;}}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(x===0||y===0||x===w-1||y===h-1)if(b[(y*w+x)*4+3]>=128)edge++;
 return {compositedRgbRmse:Math.sqrt(sum/(w*h*6)),maximumAlphaDelta:alphaMax,borderAlpha128:edge};
}
(async()=>{
 for(const preset of presets){let rows=[];fs.mkdirSync(path.join(OUT,preset.id),{recursive:true});
  for(const a of baseline.assets){
   const source=path.join(ROOT,a.path),small=a.path.includes('/products/')||a.id.startsWith('ui_icon_');
   const scale=small?1:preset.scale,w=Math.max(1,Math.round(a.width*scale)),h=Math.max(1,Math.round(a.height*scale));
   const output=path.join(OUT,preset.id,a.id+'.png');
   const data=await sharp(source).resize(w,h,{fit:'fill'}).png({palette:preset.palette,colours:preset.colours,quality:preset.quality,dither:preset.dither,compressionLevel:9,effort:7}).toBuffer();
   fs.writeFileSync(output,data);
   const row={id:a.id,source:a.path,file:path.relative(ROOT,output).replaceAll('\\','/'),width:w,height:h,bytes:data.length,decodedBytes:w*h*4,sha256:crypto.createHash('sha256').update(data).digest('hex'),...await compositeDiff(source,data,w,h)};
   rows.push(row);
  }
  const total=rows.reduce((o,a)=>({pngBytes:o.pngBytes+a.bytes,rgbaBytes:o.rgbaBytes+a.decodedBytes}),{pngBytes:0,rgbaBytes:0});
  const current=rows.filter(a=>baseline.assets.find(b=>b.id===a.id).selectedByCurrentBuild).reduce((o,a)=>({pngBytes:o.pngBytes+a.bytes,rgbaBytes:o.rgbaBytes+a.decodedBytes}),{pngBytes:0,rgbaBytes:0});
  const summary={preset,total,current,under1MiB:total.pngBytes<=1048576,pngSavingsPercent:100*(1-total.pngBytes/baseline.budget.allUnique.pngBytes),maxCompositedRgbRmse:Math.max(...rows.map(a=>a.compositedRgbRmse)),rows};
  result.presets.push(summary);console.log(JSON.stringify({...summary,rows:undefined}));
 }
 const selected=['product_kernel_a','product_kernel_b','product_cup_empty','product_cup_fill','machine_pop_body','machine_pop_head','machine_cup_body','machine_ship_body','conveyor_down_right','ui_panel','ui_icon_settings','factory_room'];
 const thumbW=270,thumbH=220,canvasW=thumbW*3,canvasH=selected.length*thumbH;
 const items=[];
 for(let y=0;y<selected.length;y++)for(let x=0;x<3;x++){
   const id=selected[y],a=baseline.assets.find(a=>a.id===id),src=x===0?path.join(ROOT,a.path):path.join(OUT,presets[x-1].id,id+'.png');
   const label=(x===0?'original':presets[x-1].id)+' · '+id;
   const bg=y%2?'#202b30':'#faf5e7';
   const panel=await sharp({create:{width:thumbW,height:thumbH,channels:4,background:bg}}).composite([{input:Buffer.from(`<svg width="${thumbW}" height="${thumbH}"><text x="8" y="17" fill="${y%2?'white':'black'}" font-size="11" font-family="Arial">${label}</text></svg>`),top:0,left:0}]).png().toBuffer();
   items.push({input:panel,left:x*thumbW,top:y*thumbH});
   const img=await sharp(src).resize({width:250,height:190,fit:'inside',withoutEnlargement:true}).png().toBuffer(),meta=await sharp(img).metadata();
   items.push({input:img,left:x*thumbW+Math.round((thumbW-meta.width)/2),top:y*thumbH+25+Math.round((190-meta.height)/2)});
 }
 await sharp({create:{width:canvasW,height:canvasH,channels:4,background:'#faf5e7'}}).composite(items).png().toFile(path.join(OUT,'comparison-contact-sheet.png'));
 fs.writeFileSync(path.join(__dirname,'compression-report.json'),JSON.stringify(result,null,2)+'\n');
 fs.writeFileSync(path.join(__dirname,'compression-report.md'),`# 旧素材 PNG 候选压缩实验\n\n只写 qa/compression-experiment；未改原图与正式清单。原 60 张共 ${baseline.budget.allUnique.pngBytes} B。\n\n| 方案 | 全部60 PNG B | 41运行 PNG B | 全部RGBA B | 最大合成RGB RMSE |\n|---|---:|---:|---:|---:|\n${result.presets.map(p=>`| ${p.preset.id} | ${p.total.pngBytes} | ${p.current.pngBytes} | ${p.total.rgbaBytes} | ${p.maxCompositedRgbRmse.toFixed(3)} |`).join('\n')}\n\nFull256 保持原尺寸；Compact256 将机器/环境/UI底板等比缩小到约75%，产品及图标不变。每图输出256色带alpha PNG，透明通道不以白色抠图。原始 kernel_a 边界问题会被实验沿袭，正式候选仍需修复。\n\n[对照图](compression-experiment/comparison-contact-sheet.png)，逐件 SHA、尺寸、Alpha 最大误差和暗/亮底合成 RMSE 见 compression-report.json。误差指标只用于筛选，不代替视觉验收；六代首包/转代峰值仍需真实依赖并集。\n`);
})().catch(e=>{console.error(e);process.exitCode=1});
