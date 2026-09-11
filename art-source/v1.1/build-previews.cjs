// Art-only review generator. Does not load Game or write runtime files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.cjs');
const ROOT = path.resolve(__dirname, '../..');
const { ART_RIGS, ART_ASSETS } = require(path.join(ROOT, 'src/art-manifest.js'));
const { SixGenerationScene } = require(path.join(ROOT, 'src/six-generation-scene.js'));
const { createArtTransform } = require(path.join(ROOT, 'src/art-layout.js'));
const assembly = JSON.parse(fs.readFileSync(path.join(ROOT, 'art-source/six-gen/integration/assembly.json')));
const assets = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, 'art-source/six-gen/integration/manifest.json'))).assets.map(a => [a.id, a]));
const outDir = path.join(__dirname, 'previews');
fs.mkdirSync(outDir, {recursive:true});
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
let used, clips, defs;
function use(id) {
  used.add(id); const a = assets.get(id); if(!a) throw Error('Missing asset '+id);
  if(!defs.has(id)) defs.set(id, `<image id="a_${id}" width="${a.width}" height="${a.height}" href="data:image/png;base64,${fs.readFileSync(path.join(ROOT,a.file)).toString('base64')}"/>`);
  return a;
}
function img(id, r, extra='') {
  const a=use(id), sc=Math.min(r[2]/a.width,r[3]/a.height);
  return `<use href="#a_${id}" transform="translate(${r[0]+(r[2]-a.width*sc)/2},${r[1]+(r[3]-a.height*sc)/2}) scale(${sc})" ${extra}/>`;
}
function txt(s,x,y,size=12,color='#174e51',extra='') { return `<text x="${x}" y="${y}" font-family="Microsoft YaHei,Arial,sans-serif" font-size="${size}" fill="${color}" ${extra}>${esc(s)}</text>`; }
function box(x,y,w,h,fill='#fff8e8',stroke='none',r=12) { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`; }
function nine(id,x,y,w,h,b=12) {
  const a=use(id),sb=ART_ASSETS[id]?.sourceBorder||12;
  const xs=[0,sb,a.width-sb,a.width],ys=[0,sb,a.height-sb,a.height];
  const dx=[x,x+b,x+w-b,x+w],dy=[y,y+b,y+h-b,y+h];let s='';
  for(let j=0;j<3;j++)for(let i=0;i<3;i++)s+=`<svg x="${dx[i]}" y="${dy[j]}" width="${dx[i+1]-dx[i]}" height="${dy[j+1]-dy[j]}" viewBox="${xs[i]} ${ys[j]} ${xs[i+1]-xs[i]} ${ys[j+1]-ys[j]}" preserveAspectRatio="none"><use href="#a_${id}"/></svg>`;
  return s;
}
function clip(s,p) { if(!p?.length)return s;const id='c'+clips++;return `<defs><clipPath id="${id}"><polygon points="${p.map(q=>q.join(',')).join(' ')}"/></clipPath></defs><g clip-path="url(#${id})">${s}</g>`; }
function part(l,r) {let s=img(l.id,l.rect);if(l.flipX)s=`<g transform="translate(${2*l.rect[0]+l.rect[2]},0) scale(-1,1)">${s}</g>`;return clip(s,typeof l.clip==='string'?r[l.clip]:l.clip);}
function cup(r) {
  const c=ART_RIGS.cupProduct,sc=r[2]/c.size[0];
  return `<g transform="translate(${r[0]},${r[1]}) scale(${sc})">${part(c.empty,c)+clip(part(c.fill,c),c.fillClip)}</g>`;
}
function packageAt(r,amount=1) {
  if(amount===1)return cup(r);
  const a=assembly.packaging[amount===2?'doubleTray':'fourCupBox'],sc=Math.min(r[2]/a.size[0],r[3]/a.size[1]);
  const layers=a.parts.filter(p=>p.state!=='closed').map(p=>({layer:p.layer,s:part(p,a)}));
  for(const slot of a.slots.slice(0,amount))layers.push({layer:slot.layer,s:clip(cup(slot.rect),a.contentClip)});
  return `<g transform="translate(${r[0]+(r[2]-a.size[0]*sc)/2},${r[1]+r[3]-a.size[1]*sc}) scale(${sc})">${layers.sort((a,b)=>a.layer-b.layer).map(l=>l.s).join('')}</g>`;
}
function rigSvg(r,id,g=1) {
  let layers=(r.layers||[]).map(l=>({layer:l.layer||0,s:part(l,r)}));
  if(id==='pop'&&r.content?.exampleFill)layers.push({layer:30,s:clip(img('product_cup_fill',r.content.exampleFill),r.contentClip)});
  if(id==='cup'&&r.cup)layers.push({layer:30,s:clip(cup(r.cup.rect),r.contentClip)});
  if(id==='ship'&&r.content?.singleCup)layers.push({layer:30,s:clip(cup(r.content.singleCup),r.contentClip)});
  if(r.slots)for(const slot of r.slots){
    for(const name of ['head','front']){const l=slot[name];if(l&&!r.layers.some(a=>a.id===l.id&&JSON.stringify(a.rect)===JSON.stringify(l.rect)))layers.push({layer:l.layer,s:part(l,r)});}
    const amount=g>=5?(id==='ship'?4:2):1;
    const rect=amount>1?(slot.batchContent?.rect||slot.packagingRect||slot.carrier?.rect||slot.cup?.rect||slot.content?.rect):(slot.singleCupRect||slot.cup?.rect||slot.content?.rect);
    const polygon=slot.clip||slot.contentClip||r.contentClip;
    let layer=slot.cup?.layer||slot.content?.layer||30;
    if(id==='pop'&&amount===2&&slot.carrier){layers.push({layer:slot.carrier.layer,s:clip(part(slot.carrier,r),polygon)});layer=Math.max(layer,slot.carrier.layer+1);}
    if(rect){
      const [xx,yy,ww,hh]=rect;
      const fill=id==='pop'&&amount===2?img('product_cup_fill',[xx+ww*.19,yy+hh*.16,ww*.34,ww*.34*94/128])+img('product_cup_fill',[xx+ww*.50,yy+hh*.34,ww*.34,ww*.34*94/128]):id==='pop'?img('product_cup_fill',rect):packageAt(rect,amount);
      layers.push({layer,s:clip(fill,polygon)});
    }
  }
  if(['bulk','cups'].includes(id)){
    const slots=r.content?.slots||Array.from({length:4},(_,i)=>[110+(i%3)*60,85+Math.floor(i/3)*50,50,60]);
    const content=slots.slice(0,4).map((q,i)=>id==='bulk'?img(i%2?'product_kernel_a':'product_kernel_b',q):cup(q)).join('');
    layers.push({layer:r.content?.layer||30,s:clip(content,r.contentClip)});
  }
  return layers.sort((a,b)=>a.layer-b.layer).map(l=>l.s).join('');
}
function tray(x,y,kind) {
  let s=img('transfer_tray_empty',[x,y,68,47]);
  for(let i=0;i<4;i++){const r=[x+20+(i%3)*9-Math.floor(i/3)*9,y+13+(i%3)*4+Math.floor(i/3)*7,10,12];s+=kind==='B'?cup(r):img('product_kernel_b',r);}
  return s;
}
function layout(w,h,g) {
  const scene=new SixGenerationScene({},{});scene.generation=g;scene.frame={x:12,y:98,w:w-24,h:h-178};
  if(h<560){
    // Short-screen art study: separate three production rows without transfer rails.
    // This is a preview arrangement, not a change to the live layout implementation.
    const nodes=[];const rowH=(h-194)/3;
    for(const [i,id]of ['pop','cup','ship'].entries()){
      const machine=scene.rigFor(id,g);const group=[];
      const defs=[[id,machine,104/Math.max(...machine.size)]];
      if(id!=='ship'){
        defs.push(['belt_'+id,ART_RIGS.conveyorRight,.11]);
        const bid=id==='pop'?'bulk':'cups',br=g>=3?scene.logisticsRig(bid==='bulk'?'bulk_large':'cups_rack'):ART_RIGS[bid==='bulk'?'bulkBuffer':'cupsBuffer'];
        defs.push([bid,br,64/br.size[0]]);
      }else defs.push(['outfeed',ART_RIGS.conveyorOutfeed,.10]);
      for(const [nid,rig,scale]of defs){const prev=group.at(-1),p=prev?.local.point(prev.rig.output);const local=createArtTransform({x:p?p[0]-rig.input[0]*scale:0,y:p?p[1]-rig.input[1]*scale:0,scale});group.push({id:nid,rig,local,kind:nid.startsWith('belt')||nid==='outfeed'?'belt':['bulk','cups'].includes(nid)?'buffer':'machine'});}
      const rs=group.map(n=>n.local.rect([0,0,...n.rig.size])),left=Math.min(...rs.map(r=>r[0])),top=Math.min(...rs.map(r=>r[1])),gw=Math.max(...rs.map(r=>r[0]+r[2]))-left,gh=Math.max(...rs.map(r=>r[1]+r[3]))-top;
      const sc=Math.min((w-32)/gw,(rowH-15)/gh),world=createArtTransform({x:16+(w-32-gw*sc)/2-left*sc,y:102+i*rowH-top*sc,scale:sc});
      for(const n of group){n.transform=world.child(n.local);n.rect=n.transform.rect([0,0,...n.rig.size]);nodes.push(n);}
    }
    return {nodes,by:Object.fromEntries(nodes.map(n=>[n.id,n]))};
  }
  const nodes=scene.placements(w-24,h-178).nodes;
  return {nodes,by:Object.fromEntries(nodes.map(n=>[n.id,n]))};
}
function sceneView(w,h,g,state) {
  const {nodes,by}=layout(w,h,g),meta={viewport:[w,h],generation:g,state,syntheticArtOnly:true,safeArea:[24,12,24,12],machines:[],buffers:[],ports:[]};
  // Floor is used once with uniform cover, never claimed to be a seamless tile.
  const f=use('factory_floor_extension'),sc=Math.max(w/f.width,h/f.height);
  let s=`<use href="#a_factory_floor_extension" transform="translate(${(w-f.width*sc)/2},0) scale(${sc})"/>`;
  s+=img('factory_wall_corner',[0,0,w,w*assets.get('factory_wall_corner').height/assets.get('factory_wall_corner').width]);
  if(g===6){const tower=assembly.scene.tower,ts=Math.min(w*.4/tower.size[0],h*.64/tower.size[1]);s+=`<g transform="translate(${w-tower.size[0]*ts-12},115) scale(${ts})" opacity=".35">${tower.layers.map(l=>part(l,tower)).join('')}</g>`;}
  for(const n of nodes.filter(n=>n.kind==='belt')) {
    if(['belt_bulk_cup','belt_stock_ship'].includes(n.id))continue;
    s+=`<g transform="translate(${n.transform.x},${n.transform.y}) scale(${n.transform.scale})">${rigSvg(n.rig,n.id,g)}</g>`;
  }
  for(const n of nodes.filter(n=>n.kind!=='belt').sort((a,b)=>a.rect[1]+a.rect[3]-b.rect[1]-b.rect[3])){
    s+=`<g transform="translate(${n.transform.x},${n.transform.y}) scale(${n.transform.scale})">${rigSvg(n.rig,n.id,g)}</g>`;
    const row={id:n.id,rect:n.rect.map(v=>+v.toFixed(2))};meta[n.kind==='machine'?'machines':'buffers'].push(row);
  }
  const ports={};
  for(const [id,label] of [['cup','装杯'],['ship','出货']]){
    const p=by[id].transform.point(by[id].rig.input),x=Math.max(36,Math.min(w-36,p[0])),y=p[1]-(g===6&&h<560&&id==='cup'?2:0);ports[id]=[x,y];
    const active=['drag-a','ready','wrong'].includes(state)&&id==='cup'||state==='drag-b'&&id==='ship';
    s+=`<circle cx="${x}" cy="${y}" r="32" fill="${active?'#e6f5ce':'#fff9e6'}" fill-opacity=".87" stroke="${active?'#219b85':'#c4b891'}" stroke-width="${active?2.8:1}"/>`;
    s+=img('input_cup_collar',[x-29,y-21,58,40])+img('ui_icon_'+id,[x-11,y-17,22,22]);
    s+=txt(label+'入口',x,y+21,10,'#124e51','text-anchor="middle" font-weight="700"');
    meta.ports.push({id,visualBounds:[x-32,y-32,64,64],anchor:[x,y],originalPort:p});
  }
  for(const [id,label] of [['bulk','待装'],['cups','待发']]){
    const n=by[id],cx=Math.min(w-44,Math.max(44,n.rect[0]+n.rect[2]/2)),y=n.rect[1]+n.rect[3]+5;
    s+=box(cx-40,y,80,21,'#fff8e5','#d5bd83',8)+txt(label+'  24',cx,y+14,11,'#326765','text-anchor="middle" font-weight="700"');
  }
  // All values below are labelled synthetic in the gallery, not economy changes.
  s+=nine('ui_hud_coin',12,24,125,40)+img('ui_icon_coin',[21,33,22,22])+txt('128',52,52,24,'#fffaf0','font-weight="700"');
  s+=txt('出货  3.0 份/秒',16,84,12,'#164f52','font-weight="700"');
  s+=nine('ui_button_secondary',w-56,24,44,44)+img('ui_icon_settings',[w-46,34,24,24]);
  s+=box(12,h-55,114,29,'#fff8e5','#d7c9a5')+img('ui_icon_automation',[20,h-49,18,18])+txt(g===6?'改造完成':'自动补料',43,h-35,11);
  s+=nine('ui_button_secondary',w-116,h-68,48,44)+img('ui_icon_automation',[w-104,h-65,24,24])+txt('物流',w-92,h-29,10,'#174e51','text-anchor="middle"');
  s+=nine('ui_button_secondary',w-62,h-68,48,44)+img(g===6?'ui_badge_complete':'ui_icon_expand',[w-50,h-65,24,24])+txt(g===6?'已建成':'扩建',w-38,h-29,10,'#174e51','text-anchor="middle"');
  if(['drag-a','drag-b','ready','wrong'].includes(state)){
    const route=state==='drag-b'?'B':'A',source=by[route==='A'?'bulk':'cups'];
    const a=[Math.min(w-38,source.rect[0]+source.rect[2]/2),source.rect[1]+source.rect[3]*.6],b=ports[route==='A'?'cup':'ship'];
    const ready=state==='ready',wrong=state==='wrong',p=ready?b:wrong?ports.ship:[(a[0]+b[0])/2,(a[1]+b[1])/2];
    const c=wrong?'#a6513b':'#248d83';
    s+=`<path d="M${a[0]} ${a[1]} Q${a[0]+20} ${b[1]-20} ${b[0]} ${b[1]}" fill="none" stroke="${c}" stroke-width="2.4" stroke-dasharray="5 6"/>`;
    if(ready)s+=`<circle cx="${b[0]}" cy="${b[1]}" r="37" fill="none" stroke="#28a38e" stroke-width="3"/>`;
    const tx=Math.max(8,Math.min(w-84,p[0]-37)),ty=p[1]-79;
    s+=`<ellipse cx="${tx+36}" cy="${ty+48}" rx="27" ry="7" fill="#153c40" opacity=".15"/>`+tray(tx,ty,route);
    s+=box(tx+44,ty-6,37,20,'#125e61')+txt('24',tx+62,ty+8,12,'white','text-anchor="middle" font-weight="700"');
    s+=img('ui_gesture_hand',[p[0]-17/128*40,p[1]-9/128*40,40,40]);
    const message=wrong?'放错入口':ready?'松手放入':'拖到'+(route==='A'?'装杯':'出货')+'入口';
    s+=box(Math.max(8,Math.min(w-126,p[0]-63)),p[1]+37,126,25,'#fff9e8',c,10)+txt(message,Math.max(71,Math.min(w-63,p[0])),p[1]+54,12,c,'text-anchor="middle" font-weight="700"');
  }
  if(['modal','logistics','expansion'].includes(state)){
    const ww=Math.min(360,w*.84),hh=state==='modal'?264:state==='logistics'?362:320,x=(w-ww)/2,y=(h-hh)/2;
    s+=box(0,0,w,h,'rgba(20,42,40,.42)','none',0)+nine('ui_panel',x,y,ww,hh,16);
    s+=img('ui_icon_close',[x+ww-38,y+15,22,22]);
    const title=state==='modal'?'装杯机 · 升级':state==='logistics'?'物流改造':'扩建工厂';
    s+=txt(title,x+22,y+36,18,'#174e51','font-weight="700"');
    if(state==='modal'){
      s+=img('ui_icon_cup',[x+22,y+62,34,34])+txt('处理速度',x+68,y+78,12,'#647267')+txt('2 → 3 份/秒',x+68,y+103,20,'#175c5c','font-weight="700"');
      s+=txt('仍需拖拽送料',x+22,y+143,13,'#7c6846');
      s+=nine('ui_button_primary',x+20,y+hh-75,ww-40,48)+txt('升级 · 30 金币',w/2,y+hh-45,15,'#164f51','text-anchor="middle" font-weight="700"');
    }else if(state==='logistics'){
      [['A · 自动补料','无需手动搬运','130 金币'],['B · 自动送货','已自动','已接通'],['仓位改造','批量、仓位与入口容量','查看升级']].forEach((row,i)=>{
        const yy=y+62+i*82;s+=nine('ui_card',x+17,yy,ww-34,73,9)+txt(row[0],x+29,yy+23,13,'#174e51','font-weight="700"')+txt(row[1],x+29,yy+44,11,'#727765')+txt(row[2],x+ww-29,yy+62,12,'#17685e','text-anchor="end"');
      });
      s+=txt('点选项目后查看价格并确认',w/2,y+hh-20,11,'#727765','text-anchor="middle"');
    }else{
      s+=txt('解锁下一代设备改造',x+22,y+77,15)+txt('设备另购，扩建不会立即提速',x+22,y+104,11,'#7c6846');
      s+=img('ui_icon_check',[x+24,y+134,18,18])+txt('出货目标已达成',x+50,y+148,12);
      s+=img('ui_icon_warning',[x+24,y+170,18,18])+txt('装杯不足 3 份/秒',x+50,y+184,12,'#9a6837');
      s+=nine('ui_button_disabled',x+20,y+hh-75,ww-40,48)+txt('查看扩建条件',w/2,y+hh-45,14,'#67716b','text-anchor="middle" font-weight="700"');
    }
    meta.modalBounds=[x,y,ww,hh];
  }
  return {s,meta};
}
async function saveScreen(w,h,g,state){
  used=new Set();clips=0;defs=new Map();const {s,meta}=sceneView(w,h,g,state);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${[...defs.values()].join('')}</defs>${s}</svg>`;
  const name=`g${g}-${state}-${w}x${h}`,png=await sharp(Buffer.from(svg)).png().toBuffer();
  fs.writeFileSync(path.join(outDir,name+'.png'),png);
  fs.writeFileSync(path.join(outDir,name+'.svg'),svg);
  meta.assetIds=[...used];meta.pngSha256=hash(png);
  fs.writeFileSync(path.join(outDir,name+'.json'),JSON.stringify(meta,null,2));
  return {name,w,h,g,state,meta};
}
async function main(){
  for(const [id,folder]of[['ui_gesture_hand','hand'],['factory_floor_extension','floor'],['factory_wall_corner','wall']]){
    const file=`art-source/v1.1/${folder}/exports/${id}.png`,m=await sharp(path.join(ROOT,file)).metadata();assets.set(id,{id,file,width:m.width,height:m.height});
  }
  const records=[];
  for(const [w,h]of[[320,524],[360,640],[390,844],[430,932]])for(const state of ['home','drag-a','drag-b','ready','wrong','modal','logistics','expansion'])records.push(await saveScreen(w,h,1,state));
  for(const [w,h]of[[320,524],[390,844]])for(const state of ['home','modal'])records.push(await saveScreen(w,h,6,state));
  const featured=['g1-drag-a-390x844','g1-drag-b-390x844','g1-ready-390x844','g1-modal-390x844'];
  const layers=[];for(const [i,name]of featured.entries())layers.push({input:await sharp(path.join(outDir,name+'.png')).resize(312,675).toBuffer(),left:24+i*336,top:94});
  const head=Buffer.from(`<svg width="1370" height="810"><rect width="1370" height="810" fill="#f2eddf"/><text x="24" y="38" font-size="24" font-family="Microsoft YaHei" fill="#174e51">v1.1 美术组合预览</text><text x="24" y="66" font-size="14" font-family="Microsoft YaHei" fill="#69746a">新增手势与背景 + 现有机器、托盘、入口和弹窗资源 · 合成示例，不是游戏运行验收</text></svg>`);
  await sharp(head).composite(layers).png().toFile(path.join(outDir,'overview.png'));
  const labels={home:'全屏场景', 'drag-a':'A 段拖拽','drag-b':'B 段拖拽',ready:'可投送',wrong:'误投反馈',modal:'设备弹窗',logistics:'物流弹窗',expansion:'扩建弹窗'};
  fs.writeFileSync(path.join(__dirname,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>v1.1 美术补充预览</title><style>body{margin:0;padding:28px;background:#f2eddf;color:#164f52;font:16px Microsoft YaHei,sans-serif}h1{margin:0 0 12px}p{max-width:960px;line-height:1.7;color:#647166}.filters{position:sticky;top:0;background:#f2eddfed;padding:12px 0;display:flex;gap:10px;z-index:1}button{padding:10px 18px;border:1px solid #7ca7a1;border-radius:9px;background:#fff9e9;color:#164f52;cursor:pointer}button.active{background:#176b6c;color:white}.grid{display:flex;flex-wrap:wrap;align-items:start;gap:22px}article{background:#fffaf0;border-radius:14px;padding:12px;box-shadow:0 3px 14px #174e5110}h2{font-size:14px;margin:0 0 10px}img{display:block;width:100%;border-radius:7px}article[hidden]{display:none}</style><h1>v1.1 美术补充预览</h1><p>3 张新增素材，配合现有六代美术组成 36 个静态视图。所有数量、金币、价格和状态均为布局样例；动画时序、库存、购买和真实触摸未在此页面执行。背景按等比 cover 绘制，未声称可无缝平铺。</p><div class="filters">${['all','320','360','390','430','g6'].map(x=>`<button data-filter="${x}" class="${x==='390'?'active':''}">${x==='all'?'全部':x==='g6'?'第六代':x+' px'}</button>`).join('')}</div><div class="grid">${records.map(r=>`<article data-width="${r.w}" data-gen="${r.g}" style="width:${Math.min(330,r.w)}px" ${r.w!==390?'hidden':''}><h2>G${r.g} · ${labels[r.state]} · ${r.w}×${r.h}</h2><a href="previews/${r.name}.png"><img loading="lazy" src="previews/${r.name}.png" alt="${labels[r.state]}"></a></article>`).join('')}</div><script>document.querySelectorAll('button').forEach(b=>b.onclick=()=>{document.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('article').forEach(a=>a.hidden=!(b.dataset.filter==='all'||b.dataset.filter==='g6'&&a.dataset.gen==='6'||a.dataset.width===b.dataset.filter));});</script></html>`);
  fs.writeFileSync(path.join(outDir,'preview-report.json'),JSON.stringify({kind:'synthetic-art-only',createdAt:new Date().toISOString(),records,sourceHashes:Object.fromEntries(['src/art-manifest.js','src/six-generation-scene.js','src/first-generation-scene.js','art-source/six-gen/integration/assembly.json'].map(f=>[f,hash(fs.readFileSync(path.join(ROOT,f)))]))},null,2));
  console.log(JSON.stringify({screens:records.length,gallery:path.join(__dirname,'index.html'),overview:path.join(outDir,'overview.png')}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
