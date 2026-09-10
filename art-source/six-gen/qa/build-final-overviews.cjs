const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sharp=require('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const ROOT=path.resolve(__dirname,'../../..'),manifestPath=path.join(ROOT,'art-source/six-gen/integration/manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),items=manifest.assets||manifest.entries;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
const text=(s,x,y,fill='#194b51',size=10)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-family="Microsoft YaHei,Arial,sans-serif">${esc(s)}</text>`;
const svg=(w,h,c)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${c}</svg>`;
const href=b=>'data:image/png;base64,'+b.toString('base64');
async function emit(file,w,h,s,meta){const out=path.join(__dirname,'previews',file);await sharp(Buffer.from(svg(w,h,s))).png().toFile(out);const record={scope:'Static art overview; no runtime or device claims',createdAt:new Date().toISOString(),checkerVersion:'overview-1.0',pngSha256:sha(fs.readFileSync(out)),finalManifestSha256:sha(fs.readFileSync(manifestPath)),viewSize:[w,h],...meta};fs.writeFileSync(out.replace(/\.png$/,'.json'),JSON.stringify(record,null,2)+'\n');console.log(out);}
(async()=>{
 const order=[...items].sort((a,b)=>a.id.localeCompare(b.id));const cw=200,ch=194,w=8*cw,h=62+Math.ceil(order.length/8)*ch;
 for(const theme of['light','dark']){const bg=theme==='light'?'#f4edde':'#202e34',fg=theme==='light'?'#174d55':'#edf6ee';let s=`<rect width="${w}" height="${h}" fill="${bg}"/>`+text('IAA · 六代美术资源 / '+order.length+' PNG',24,27,fg,19)+text('真实候选文件 · 原图比例 · '+(theme==='light'?'浅底':'深底')+'透明边缘检查 · 未接入代码',24,48,fg,12);const evidence=[];
  for(const[i,a]of order.entries()){const x=(i%8)*cw,y=62+Math.floor(i/8)*ch,f=path.isAbsolute(a.file||a.path)?(a.file||a.path):path.join(ROOT,a.file||a.path),b=fs.readFileSync(f),m=await sharp(b).metadata();const label=a.id.split('_'),mid=Math.ceil(label.length/2);const lines=[label.slice(0,mid).join('_'),label.slice(mid).join('_')];s+=`<rect x="${x+4}" y="${y+4}" width="192" height="186" rx="7" fill="${theme==='light'?'#fffaf0':'#2b3c44'}"/>`;s+=`<image href="${href(b)}" x="${x+12}" y="${y+8}" width="176" height="135" preserveAspectRatio="xMidYMid meet"/>`+text(lines[0],x+10,y+157,fg,10)+text(lines[1],x+10,y+171,fg,10)+text(`${m.width} × ${m.height}`,x+10,y+185,theme==='light'?'#647c7c':'#adc3c6',9);evidence.push({id:a.id,file:a.file||a.path,sha256:sha(b),width:m.width,height:m.height});}
  await emit(`asset-overview-${theme}.png`,w,h,s,{theme,assetCount:order.length,assetSHAs:evidence,conclusion:'PENDING_VISUAL_REVIEW'});
 }
 let s='<rect width="750" height="1096" fill="#f3ead9"/>'+text('六代成长 · 已安装配置静态美术预览',24,29,'#124e54',21);const screenshots=[];
 for(let g=1;g<=6;g++){const name=`g${String(g).padStart(2,'0')}-upgraded-390x844.png`,f=path.join(__dirname,'previews',name),b=fs.readFileSync(f),x=12+((g-1)%3)*248,y=47+Math.floor((g-1)/3)*523;s+=`<image href="${href(b)}" x="${x}" y="${y}" width="234" height="506.4"/>`;screenshots.push({generation:g,file:path.relative(ROOT,f).replaceAll('\\','/'),sha256:sha(b)});}
 await emit('six-generations-overview.png',750,1096,s,{screenshots,fixtureKind:'synthetic-art-only',conclusion:'PENDING_VISUAL_REVIEW'});
 for(let g=1;g<=6;g++){
  let contact='<rect width="1426" height="898" fill="#f3ead9"/>'+text(`G${String(g).padStart(2,'0')} · 两配置 / 两视口 · 原生像素检查`,16,26,'#124e54',17),x=6;const sources=[];
  for(const [vw,vh]of[[390,844],[320,524]])for(const configuration of['entry','upgraded']){const name=`g${String(g).padStart(2,'0')}-${configuration}-${vw}x${vh}.png`,f=path.join(__dirname,'previews',name),b=fs.readFileSync(f);contact+=text(`${configuration} ${vw}×${vh}`,x+10,46)+`<image href="${href(b)}" x="${x}" y="54" width="${vw}" height="${vh}"/>`;sources.push({file:path.relative(ROOT,f).replaceAll('\\','/'),sha256:sha(b)});x+=vw;}
  await emit(`g${String(g).padStart(2,'0')}-four-view-review.png`,1426,898,contact,{generation:g,screenshots:sources,fixtureKind:'synthetic-art-only',conclusion:'PENDING_VISUAL_REVIEW'});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
