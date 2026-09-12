(function () {
  'use strict';

  const W = 390, H = 744;
  const host = typeof window === 'object' ? window : globalThis;
  const doc = typeof document === 'object' ? document : null;
  const canvas = doc && doc.getElementById('scene-preview');
  let ctx = canvas ? canvas.getContext('2d') : null, renderScale = 2;
  const sources = {
    courtyard: 'exports/scene_direct_sales_courtyard.png',
    counter: 'exports/scene_pickup_counter.png',
    sign: 'exports/scene_factory_wayfinding.png',
    shop: '../v1.3/exports/shop_front.png',
    clerk: '../v1.3/exports/clerk_vendor.png',
    neighbor: '../v1.3/exports/customer_neighbor.png',
    family: '../v1.3/exports/customer_family.png',
    bag: '../v1.3/exports/order_pickup_bag.png',
    original: '../v1.3/exports/product_original_cup.png',
    caramel: '../v1.3/exports/product_caramel_tub.png',
    rackBack: '../six-gen/integration/exports/buffer_cups_rack_back.png',
    rackFront: '../six-gen/integration/exports/buffer_cups_rack_front.png'
  };
  let art = {};
  const failed = [];
  const colors = {ink:'#285348', muted:'#788473', paper:'#fffdf2', green:'#356b52', gold:'#d99748', line:'#cbd5b8'};
  const layout = Object.freeze({canvas:[W,H],shop:[25,77,306,248],clerk:[144,188,50,77],shopWindow:[[158,264],[504,324],[504,414],[167,334]],sign:[303,203,79,112],orders:[[19,302,164,78],[207,302,164,78]],customers:[[67,387,74,101],[250,387,74,101]],counter:[38,449,314,116],bags:[[111,435,47,51],[260,435,47,51]],rack:[91,548,210,176]});
  const STATES = {
    first: {title:'首单等候',description:'第一位顾客等待 4 杯原味；第二个站位保留给下一位顾客。空取货袋与共享货架各自独立。',coins:0,stock:[8,3],reserved:[0,0],slots:['original','original','caramel','original','caramel','original'],bagProducts:[null,null]},
    mixed: {title:'混合配货',description:'家庭顾客的一笔订单同时需要原味与焦糖，分别显示已配 / 所需。前壁与提手遮住商品下半部，报酬保持独立可读。',coins:0,stock:[8,3],reserved:[3,1],slots:['original','original','caramel','original','caramel','original'],bagProducts:['original','caramel']},
    complete: {title:'成交反馈',description:'原味首单交付完成，显示一次「+4」与完成标记。展示状态反馈和带货离开的准备姿态，不进行真实记账。',coins:4,stock:[4,3],reserved:[0,0],slots:['original',null,'caramel',null,'caramel','original'],bagProducts:['original',null]}
  };
  let state = 'first', tone = 'light';
  // These authored coordinates refer to the unchanged 179 × 192 pickup bag.
  // Draw the whole bag, insert the product, then redraw its near wall and handle.
  const PICKUP_FRONT_CLIPS = [
    [[43,59],[60,68],[65,78],[89,81],[110,79],[127,74],[145,65],[163,58],[179,192],[0,192],[37,156]],
    [[85,96],[86,65],[87,48],[91,39],[97,32],[105,28],[118,29],[129,34],[136,43],[141,61],[146,84],[137,88],[132,57],[128,45],[121,38],[109,35],[102,39],[99,48],[98,67],[98,96]]
  ];
  const RACK = {size:[512,429],slots:[[95,104,38,46.769231],[175,141,38,46.769231],[250,173,38,46.769231],[80,205,38,46.769231],[190,255,38,46.769231],[285,298,38,46.769231]],clip:[[38,72],[210,143],[390,220],[390,398],[42,264]]};

  function fit(width,height,r,bottom) {const scale=Math.min(r[2]/width,r[3]/height);return [r[0]+(r[2]-width*scale)/2,r[1]+(r[3]-height*scale)*(bottom?1:.5),width*scale,height*scale];}
  function sprite(id,r,opacity,bottom) {const img=art[id];if(!img)return null;const fitted=fit(img.naturalWidth||img.width,img.naturalHeight||img.height,r,bottom);ctx.save();if(opacity!=null)ctx.globalAlpha=opacity;ctx.drawImage(img,...fitted);ctx.restore();return fitted;}
  function panel(x,y,w,h,fill,stroke,radius) {const r=Math.min(radius||10,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.8;ctx.stroke();}}
  function text(value,x,y,size,color,weight,align) {ctx.font=(Math.round((weight||500)/100)*100)+' '+(size||12)+'px "Microsoft YaHei","PingFang SC",sans-serif';ctx.fillStyle=color||colors.ink;ctx.textAlign=align||'left';ctx.textBaseline='middle';ctx.fillText(String(value),x,y);}
  function clip(points,rect,scale,draw) {ctx.save();ctx.beginPath();points.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](rect[0]+p[0]*scale,rect[1]+p[1]*scale));ctx.closePath();ctx.clip();draw();ctx.restore();}
  function drawBag(r,product) {const fitted=sprite('bag',r);if(!fitted||!product)return;const scale=fitted[2]/179;sprite(product,[fitted[0]+78*scale,fitted[1]+45*scale,61*scale,63*scale],1,true);PICKUP_FRONT_CLIPS.forEach(p=>clip(p,fitted,scale,()=>sprite('bag',fitted)));}
  function drawRack(r,products) {const fitted=fit(...RACK.size,r),scale=fitted[2]/512;const local=slot=>[fitted[0]+slot[0]*scale,fitted[1]+slot[1]*scale,slot[2]*scale,slot[3]*scale];sprite('rackBack',fitted);clip(RACK.clip,fitted,scale,()=>RACK.slots.forEach((slot,i)=>{if(products[i])sprite(products[i],local(slot),1,true);}));sprite('rackFront',fitted);}
  function orderBubble(index) {
    const r=layout.orders[index], x=r[0],y=r[1],w=r[2],h=r[3];const inactive=state==='first'&&index===1,done=state==='complete'&&index===0;
    panel(x,y,w,h,done?'#f0f6dbed':inactive?'#fffdf2bb':'#fffdf2f2',done?'#8caa6c':'#bec9ab',11);
    ctx.beginPath();ctx.moveTo(x+w*.44,y+h-.5);ctx.lineTo(x+w*.5,y+h+7);ctx.lineTo(x+w*.56,y+h-.5);ctx.fillStyle=done?'#f0f6db':inactive?'#fffdf2bb':'#fffdf2';ctx.fill();
    if(inactive){text('下一位顾客',x+w/2,y+23,12,colors.muted,700,'center');text('预留站位 · 等候',x+w/2,y+44,9,colors.muted,500,'center');return;}
    text(index?'家庭采购客':'街角顾客',x+12,y+14,10,colors.muted,600);
    if(done){ctx.beginPath();ctx.moveTo(x+13,y+40);ctx.lineTo(x+19,y+46);ctx.lineTo(x+29,y+33);ctx.strokeStyle=colors.green;ctx.lineWidth=2.5;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();text('交付完成',x+40,y+39,13,colors.green,750);text('原味 × 4 · 收入 4 金币',x+40,y+60,8,colors.muted,500);return;}
    if(state==='mixed'){
      text(index?'8 金币':'4 金币',x+w-12,y+15,8,colors.green,650,'right');
      if(index){sprite('original',[x+10,y+26,23,23]);text('原味',x+39,y+38,10,colors.ink,750);text('已配 1 / 2',x+w-13,y+38,9,colors.muted,600,'right');sprite('caramel',[x+10,y+50,23,23]);text('焦糖',x+39,y+61,10,colors.ink,750);text('已配 1 / 1',x+w-13,y+61,9,colors.muted,600,'right');}
      else{sprite('original',[x+11,y+29,31,33]);text('原味 × 4',x+49,y+40,12,colors.ink,750);text('已配 2 / 4',x+49,y+60,9,colors.muted,600);}
    }else{sprite('original',[x+11,y+30,31,33]);text(index?'原味 × 6':'原味 × 4',x+49,y+41,12,colors.ink,750);text(index?'等候配货 · 7 金币':'等待配货 · 4 金币',x+49,y+61,8,colors.muted,500);}
  }
  function drawHeader(current) {
    panel(14,15,362,51,'#fffdf4ed','#ffffffaa',13);
    text('工厂直售',27,34,17,colors.ink,800);panel(116,25,55,17,'#e8eddd',null,5);text('美术预览',143.5,33.5,8,colors.green,650,'center');
    text('街角庭院  /  '+current.title,28,52,8.5,colors.muted,500);
    panel(281,25,81,29,'#f1e5be',null,9);text('金币 '+current.coins,309,39,11,colors.ink,750,'center');text('示例',352,40,7,colors.muted,500,'center');
  }
  function drawStock(current) {
    panel(48,709,294,26,'#fffdf4ed','#b5c1a6',9);text('共享货架',62,722,9,colors.green,750);text('原味 '+current.stock[0]+'  ·  焦糖 '+current.stock[1],139,722,9,colors.ink,650);text('样例库存',326,722,7.5,colors.muted,500,'right');
    ['original','caramel'].forEach((product,index)=>{const x=index?285:12;panel(x,587,93,89,'#fffdf3ed','#c2cdb1',10);text(index?'焦糖桶':'原味杯',x+46.5,601,10,colors.green,750,'center');sprite(product,[x+9,614,33,35]);text('可用',x+63,623,8,colors.muted,500,'center');text(current.stock[index]-current.reserved[index],x+63,638,12,colors.ink,750,'center');text('订单预留 '+current.reserved[index],x+46.5,662,8,colors.muted,500,'center');});
  }
  function draw() {
    ctx.setTransform(renderScale,0,0,renderScale,0,0);ctx.clearRect(0,0,W,H);ctx.fillStyle=tone==='dark'?'#294334':'#e9eddc';ctx.fillRect(0,0,W,H);
    if(art.courtyard){const image=art.courtyard,iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height,scale=Math.max(W/iw,H/ih);ctx.drawImage(image,(W-iw*scale)/2,(H-ih*scale)/2,iw*scale,ih*scale);}
    const current=STATES[state];
    const shopRect=sprite('shop',layout.shop);if(shopRect)clip(layout.shopWindow,shopRect,shopRect[2]/768,()=>sprite('clerk',layout.clerk));sprite('sign',layout.sign);
    sprite('neighbor',layout.customers[0]);if(state!=='first')sprite('family',layout.customers[1]);
    sprite('counter',layout.counter);drawBag(layout.bags[0],current.bagProducts[0]);drawBag(layout.bags[1],current.bagProducts[1]);
    drawRack(layout.rack,current.slots);orderBubble(0);orderBubble(1);drawHeader(current);drawStock(current);
    panel(140,497,111,19,'#fff8e5e6',null,6);text('取货台 · 交付示意',195.5,506.5,8.5,colors.green,650,'center');
    if(state==='complete') {panel(39,391,66,27,'#ffefd1','#d4a563',10);text('+4 金币',72,405,11,'#986834',800,'center');}
    if(failed.length){panel(26,672,338,26,'#fff2e7f2','#c49d75',8);text('部分图片未加载，请使用下方“重新加载”',195,685,9,'#a27147',650,'center');}
    if(doc){doc.getElementById('state-kicker').textContent=current.title;doc.getElementById('state-description').textContent=current.description;}
    if(canvas)canvas.setAttribute('aria-label','街角直售庭院美术装配，当前为'+current.title+'。订单与库存均为固定示例。');
    host.sceneArtPreview={state,tone,layout,loaded:Object.keys(art),failed:failed.slice(),samples:current,gameplay:false};
  }
  // The exact browser drawing code is also usable by offline Canvas renderers.
  // Images are keyed by sources; scale=320/390 renders a 320px-wide screenshot.
  function renderTo(targetContext,images,stateName,options) {const previous={ctx,art,state,tone,renderScale};ctx=targetContext;art=images;state=STATES[stateName]?stateName:'first';tone=options&&options.tone==='dark'?'dark':'light';renderScale=options&&options.scale||1;try{draw();return host.sceneArtPreview;}finally{ctx=previous.ctx;art=previous.art;state=previous.state;tone=previous.tone;renderScale=previous.renderScale;}}
  host.sceneArtRenderTo=renderTo;
  if(typeof module==='object'&&module.exports)module.exports={renderTo,sources,layout,states:STATES};
  if(!doc||!canvas){host.sceneArtPreviewReady=Promise.resolve({ok:false,offline:true,sources,layout});return;}
  doc.querySelectorAll('[data-state]').forEach(button=>button.addEventListener('click',()=>{state=button.dataset.state;doc.querySelectorAll('[data-state]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));draw();}));
  doc.querySelectorAll('.swatch[data-tone]').forEach(button=>button.addEventListener('click',()=>{tone=button.dataset.tone;doc.body.dataset.tone=tone;doc.querySelectorAll('.swatch[data-tone]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));draw();}));
  doc.getElementById('retry-load').addEventListener('click',()=>host.location.reload());
  draw();
  host.sceneArtPreviewReady=Promise.all(Object.entries(sources).map(([id,src])=>new Promise(resolve=>{const image=new Image();image.onload=()=>{art[id]=image;resolve({id,ok:true,width:image.naturalWidth,height:image.naturalHeight});};image.onerror=()=>{failed.push(id);resolve({id,ok:false});};image.src=src;}))).then(results=>{draw();doc.getElementById('load-status').textContent=failed.length?'资源加载未完成 · '+failed.length+' 张图片待重试':'12 张新旧素材已就绪 · 固定样例';doc.getElementById('retry-load').hidden=!failed.length;canvas.dataset.ready=String(!failed.length);return {ok:!failed.length,results,layout};});
})();
