'use strict';
// Art-only state machine. Never imports game core, persistence, economy or a game clock.
(async function () {
  const $ = id => document.getElementById(id), library = window.V13_PROCESS_ART;
  const ctx = $('machine').getContext('2d'), pack = $('pack').getContext('2d');
  const descriptions = {
    idle: '空滚筒保持可见，管口无糖浆。无料时不显示已经加工好的成品。',
    loading: '原味散料进入滚筒，内容被限制在开口内，前侧铜壁保持完整。',
    coating: '独立糖浆与散料响应工序进度，焦糖颗粒逐步替换原味颗粒。',
    discharge: '焦糖散料离开滚筒并进入出口盘，前盘壁遮住底部颗粒。',
    blocked: '已加工散料停在出口盘。满仓等待时停流、停动，并保留产品。',
    packing: '散料装入空焦糖桶，近侧桶沿与桶壁盖住下方内容。'
  };
  let rig, state = 'coating', progress = .55, playing = false, previous = 0;
  const images = new Map(), assets = Object.fromEntries((library?.assets || []).map(a => [a.id, a]));
  function polygon(c, points) { c.beginPath(); points.forEach(([x,y],i) => i ? c.lineTo(x,y) : c.moveTo(x,y)); c.closePath(); }
  function clipped(c, points, draw) { c.save(); polygon(c,points); c.clip(); draw(); c.restore(); }
  // Map the trimmed export back to its retained source space. Rounding at export
  // causes <1 source-pixel differences; use both recorded dimensions, not a guessed crop.
  function native(c,id) {
    const a=assets[id], img=images.get(id), [x,y,w,h]=a.sourceRect, p=a.padding;
    const sx=w/(a.width-2*p), sy=h/(a.height-2*p);
    c.drawImage(img,x-p*sx,y-p*sy,a.width*sx,a.height*sy);
  }
  // Bounds are attachment guides only: preserve and draw every PNG pixel.
  function place(c,id,rect,alpha=1) {
    if(alpha<=0)return;
    const a=assets[id], b=rig.visualBounds[id], k=Math.min(rect[2]/b[2],rect[3]/b[3]);
    const x=rect[0]+(rect[2]-b[2]*k)/2, y=rect[1]+rect[3]-b[3]*k;
    c.save();c.globalAlpha=alpha;c.drawImage(images.get(id),x-b[0]*k,y-b[1]*k,a.width*k,a.height*k);c.restore();
  }
  function material(c,rect,caramel,amount=1,wiggle=0) {
    if(amount<=0)return;
    const box=[rect[0]+wiggle,rect[1]+rect[3]*(1-amount),rect[2],rect[3]*amount];
    place(c,'material_original_popcorn',box,1-caramel);
    place(c,'material_caramel_popcorn',box,caramel);
  }
  function draw() {
    const bg=$('background').value, m=rig.machine, p=rig.packaging;
    ctx.clearRect(0,0,1254,1254);pack.clearRect(0,0,1254,1254);
    $('machine').style.background=bg;$('pack').style.background=bg;
    native(ctx,m.asset);
    const phase=Math.sin(progress*Math.PI*8), active=state==='coating';
    let amount=state==='loading'?progress:active?1:state==='discharge'?1-progress:0;
    clipped(ctx,m.contentClip,()=>material(ctx,m.contentRect,active?progress:state==='discharge'?1:0,amount,active?phase*7:0));
    if(active){
      const [x,y]=m.syrupOutlet,[tx,ty]=m.syrupImpact,dx=tx-x,dy=ty-y,len=Math.hypot(dx,dy);
      ctx.save();ctx.translate(x,y);ctx.rotate(-Math.atan2(dx,dy));
      const width=len*rig.visualBounds.caramel_syrup_flow[2]/rig.visualBounds.caramel_syrup_flow[3];
      place(ctx,'caramel_syrup_flow',[-width/2,0,width,len],.9);ctx.restore();
    }
    const output=state==='blocked'?1:state==='discharge'?progress:state==='packing'?1-progress:0;
    if(output>0){material(ctx,m.outputRect,1,output);clipped(ctx,m.outputFrontClip,()=>native(ctx,m.asset));}
    native(pack,p.asset);
    if(state==='packing'){
      material(pack,p.fillRect,1,progress);
      clipped(pack,p.frontClip,()=>native(pack,p.asset));
    }
    if($('guides').checked){
      for(const [c,points] of [[ctx,m.contentClip],[ctx,m.outputFrontClip],[pack,p.frontClip]]){c.save();c.strokeStyle='#ed4c75';c.lineWidth=5;c.setLineDash([15,10]);polygon(c,points);c.stroke();c.restore();}
      for(const [x,y] of [m.syrupOutlet,m.syrupImpact,m.contentPivot]){ctx.fillStyle='#ed4c75';ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.fill();}
    }
    $('progress').value=Math.round(progress*100);$('progress-value').textContent=Math.round(progress*100)+'%';
    $('machine').setAttribute('aria-label',rig.states.find(s=>s.id===state).label+'：'+descriptions[state]);
    $('pack').setAttribute('aria-label',state==='packing'?'焦糖桶装填进度 '+Math.round(progress*100)+'%':'空焦糖包装桶');
    $('pack-title').textContent=state==='packing'?'装桶 · 内容与前壁遮挡':'包装等待 · 空桶';
    $('pack-note').textContent=state==='packing'?'预览装填阶段，包装完成后再使用已有焦糖成品图。':'等待装填时保持空桶，尚未显示成品。';
  }
  function updateState(next,p=.55){
    state=next;progress=Math.max(0,Math.min(1,p));
    const index=rig.states.findIndex(s=>s.id===state);
    $('step').textContent='PROCESS '+String(index+1).padStart(2,'0')+' / 06';
    $('state-title').textContent=rig.states[index].label;$('description').textContent=descriptions[state];
    for(const button of $('states').children)button.setAttribute('aria-pressed',String(button.dataset.state===state));
    draw();
  }
  function setPlaying(value){playing=value;previous=0;$('play').textContent=value?'暂停演示':'播放演示';$('play').setAttribute('aria-pressed',String(value));}
  function frame(now){
    if(playing&&rig&&images.size===library.assets.length){
      const dt=previous?Math.min((now-previous)/1000,.1):0;
      const index=rig.states.findIndex(s=>s.id===state);progress+=dt/rig.states[index].duration;
      if(progress>=1)updateState(rig.states[(index+1)%rig.states.length].id,0);else draw();
    }
    previous=now;requestAnimationFrame(frame);
  }
  async function initialize(){
    $('retry').hidden=true;$('load-status').className='';$('load-status').textContent='正在加载资源…';
    if(!library)throw new Error('资源目录加载失败');
    if(!rig){const response=await fetch('assembly.json');if(!response.ok)throw new Error('装配文件加载失败');rig=await response.json();}
    await Promise.all(library.assets.map(a=>images.has(a.id)?Promise.resolve():new Promise((resolve,reject)=>{
      const img=new Image();img.onload=()=>{if(img.naturalWidth!==a.width||img.naturalHeight!==a.height)return reject(new Error(a.id+'尺寸与清单不同'));images.set(a.id,img);resolve();};img.onerror=()=>reject(new Error(a.label+'加载失败'));img.src=a.url;
    })));
    if(!$('states').children.length)for(const item of rig.states){const b=document.createElement('button');b.textContent=item.label;b.dataset.state=item.id;b.onclick=()=>{setPlaying(false);updateState(item.id,item.id==='blocked'?1:.55);};$('states').append(b);}
    if(!$('catalog').children.length)for(const a of library.assets){const card=document.createElement('article');card.className='asset';const img=document.createElement('img');img.src=a.url;img.alt=a.label;const name=document.createElement('h3');name.textContent=a.label;const code=document.createElement('code');code.textContent=a.id;const detail=document.createElement('small');detail.textContent=a.width+' × '+a.height+' · '+(a.bytes/1024).toFixed(1)+' KiB';card.append(img,name,code,detail);$('catalog').append(card);}
    $('budget').textContent=(library.bytes/1024).toFixed(1)+' KiB / RGBA '+(library.decodedBytes/1048576).toFixed(2)+' MiB';
    $('load-status').textContent='5 / 5 张资源已加载';$('play').disabled=false;$('progress').disabled=false;updateState(state,progress);
  }
  function failure(error){setPlaying(false);$('load-status').textContent=error.message;$('load-status').className='error';$('retry').hidden=false;}
  $('play').onclick=()=>setPlaying(!playing);
  $('progress').oninput=()=>{setPlaying(false);progress=Number($('progress').value)/100;draw();};
  $('background').onchange=()=>{if(rig&&images.size===library.assets.length)draw();};
  $('guides').onchange=()=>{if(rig&&images.size===library.assets.length)draw();};
  $('retry').onclick=()=>{if(!library){window.location.reload();return;}initialize().catch(failure);};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)setPlaying(false);});
  initialize().catch(failure);requestAnimationFrame(frame);
})();
