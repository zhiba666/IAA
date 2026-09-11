'use strict';

const { ProductionScene } = require('./production-scene');
const { ART_RIGS, ART_ASSETS } = require('./art-manifest');
const { createArtTransform, drawArtLayer, clipArtPolygon, minimumHitRect, transferTargetAt } = require('./art-layout');
const { fullScreenPlacements } = require('./fullscreen-layout');
const clamp = n => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

// Only generation one uses these assemblies. The simulation never enters this module.
class FirstGenerationScene extends ProductionScene {
  constructor(ctx, assets) { super(ctx); this.art = assets; this.artGeneration = 0; this.diagnostics = {}; }
  part(layer, transform, options) { return drawArtLayer(this.c, this.art, layer, transform, options); }
  sprite(id, rect, transform, options) { return this.part({ id, rect }, transform, options); }
  clipped(polygon, transform, draw) { this.c.save(); clipArtPolygon(this.c, polygon, transform); draw(); this.c.restore(); }
  cupAt(rect, transform, progress = 1) {
    const rig = ART_RIGS.cupProduct, t = transform.child({ x: rect[0], y: rect[1], scale: rect[2] / rig.size[0] });
    this.part(rig.empty, t);
    if (progress > 0) this.clipped(rig.fillClip, t, () => this.part(rig.fill, t, { offset: [0, rig.fillTravel[1] * (1 - clamp(progress))] }));
  }
  placements(w, h) {
    const rigs = { pop: ART_RIGS.popMachine, cup: ART_RIGS.cupMachine, ship: ART_RIGS.shipMachine,
      bulk: ART_RIGS.bulkBuffer, cups: ART_RIGS.cupsBuffer, outfeed: ART_RIGS.conveyorOutfeed };
    return fullScreenPlacements(this.frame || { x: 0, y: 0, w, h }, rigs, this.presentation);
  }
  draw(x, y, w, h, view) {
    if (![x,y,w,h].every(Number.isFinite) || w <= 0 || h <= 0) return;
    this.artGeneration = (this.generation || 1) - 1;
    this.frame = { x, y, w, h }; this.presentation = view.presentation || {};
    this.stationFrames = []; this.bufferFrames = []; this.transferFrames = [];
    this.transferHeight = 0; this.compactTransfers = false;
    const layout = this.placements(w, h), nodes = Object.fromEntries(layout.nodes.map(node => [node.id, node]));
    this.fullscreenLayout = layout; this.nodes = nodes; this.contentFrame = layout.content;
    this.diagnostics = { generation: this.artGeneration + 1, layout: 'fullscreen-workstations', frame: {x,y,w,h},
      content: { ...layout.content }, machines: [], buffers: [], connections: [], decorations: [],
      transferHeight: 0, transfers: [], fallbacks: [] };
    const transfers = view.mode === 'v15' ? view.transfers || [] :
      view.transfer && view.transfer.enabled ? [{ ...view.transfer, source: 'pop', target: 'cup' }] : [];
    this.transferFrames = layout.transfers.filter(frame => transfers.some(row => row.source === frame.source))
      .map(frame => {
        const transfer = transfers.find(row => row.source === frame.source);
        return { ...frame, accepting: frame.kind === 'input' && transfer.inputAmount < transfer.inputCapacity };
      });
    const c = this.c;
    c.save(); c.beginPath(); c.rect(x,y,w,h); c.clip();
    this.background();
    if (typeof this.decorations === 'function') this.decorations(nodes, layout.content.h);
    this.drawConnections(nodes, view, transfers);
    this.belt(nodes.outfeed, view);
    for (const id of ['pop','cup','ship']) this.machine(nodes[id], view.stations.find(station => station.id === id), view);
    for (const id of ['bulk','cups']) this.stock(nodes[id], view.buffers.find(buffer => buffer.id === (id === 'bulk' ? 'pop' : 'cup')));
    for (const id of ['pop','cup','ship']) this.machineLabel(nodes[id], view.stations.find(station => station.id === id), view, layout.compact);
    for (const id of ['bulk','cups']) this.stockLabel(nodes[id], view.buffers.find(buffer => buffer.id === (id === 'bulk' ? 'pop' : 'cup')), layout.compact);
    this.logisticsControls(nodes, view);
    if (this.delivery) {
      const r = nodes.outfeed.rect;
      this.label('+' + this.delivery.coins, r[0] + r[2] / 2, Math.min(layout.content.y + layout.content.h - 5, r[1] + r[3] + 8), 11, '#176968', 'center');
    }
    c.restore();
    return { frame: this.frame, stationFrames: this.stationFrames, bufferFrames: this.bufferFrames, transferFrames: this.transferFrames };
  }
  background() {
    const { x,y,w,h } = this.frame, identity = createArtTransform();
    this.box(x,y,w,h,0,'#f0e1c4');
    const floor = ART_ASSETS.factory_floor_extension, wall = ART_ASSETS.factory_wall_corner;
    if (floor && this.art && this.art.get('factory_floor_extension')) {
      const scale = Math.max(w / floor.width, h / floor.height);
      this.sprite('factory_floor_extension', [x+(w-floor.width*scale)/2,y,floor.width*scale,floor.height*scale], identity);
      if (wall) this.sprite('factory_wall_corner', [x,y,w,w*wall.height/wall.width], identity);
    } else {
      const room = ART_ASSETS.factory_room, scale = Math.max(w/room.width,h/room.height);
      this.sprite('factory_room', [x+(w-room.width*scale)/2,y,room.width*scale,room.height*scale], identity);
    }
  }
  drawConnections(nodes, view, transfers) {
    const identity = createArtTransform();
    const connect = (from, to, a, b, source, stationId) => {
      const transfer = transfers.find(row => row.source === source);
      const manual = !!transfer && !transfer.automated;
      const c = this.c;
      c.save();
      if (manual) { if (c.setLineDash) c.setLineDash([3,6]); this.line(a[0],a[1],b[0],b[1],'rgba(143,118,77,.42)',2); }
      else {
        this.line(a[0],a[1],b[0],b[1],'#829798',10);
        this.line(a[0],a[1],b[0],b[1],'#cbd2c5',6);
      }
      c.restore();
      this.diagnostics.connections.push({ from, to, fromPoint: a, toPoint: b, gap: 0, path: [a,b], automated: !manual });
      if (manual) return;
      const station = view.stations.find(row => row.id === stationId);
      const job = station && (station.jobs || []).find(row => row && !row.complete);
      if (job) {
        const p = .15 + clamp(job.progress) * .7, px = a[0] + (b[0]-a[0])*p, py = a[1] + (b[1]-a[1])*p;
        if (stationId === 'pop') this.sprite('product_kernel_a',[px-4,py-5,8,8],identity);
        else this.transitCup([px-6,py-11,12,15],identity,{id:from},job);
      }
    };
    for (const source of ['pop','cup']) {
      const target = source === 'pop' ? 'cup' : 'ship', bin = nodes[source === 'pop' ? 'bulk' : 'cups'];
      const output = nodes[source].transform.point(nodes[source].rig.output), binInput = bin.transform.point(bin.rig.input);
      connect(source,bin.id,output,binInput,null,source);
      const input = this.transferFrames.find(frame => frame.kind === 'input' && frame.source === source);
      const destination = input ? [input.x+input.w/2,input.y+22] : nodes[target].transform.point(nodes[target].rig.input);
      const binOutput = bin.transform.point(bin.rig.output);
      connect(bin.id,target,binOutput,destination,source,target);
      if (input) connect('input-'+target,target,[input.x+input.w-2,input.y+23],nodes[target].transform.point(nodes[target].rig.input),null,target);
    }
    connect('ship','outfeed',nodes.ship.transform.point(nodes.ship.rig.output),nodes.outfeed.transform.point(nodes.outfeed.rig.input),null,'ship');
  }
  logisticsControls(nodes, view) {
    const held = this.presentation.transfer, pressed = this.presentation.press;
    const transfers = view.mode === 'v15' ? view.transfers || [] :
      view.transfer && view.transfer.enabled ? [{ ...view.transfer, source: 'pop', target: 'cup' }] : [];
    const blockers = this.stationFrames.concat(this.contentFrame.exclusionRects || []);
    this.transferBlockers = blockers;
    for (const transfer of transfers) {
      const source = this.transferFrames.find(frame => frame.kind === 'tray' && frame.source === transfer.source);
      const target = this.transferFrames.find(frame => frame.kind === 'input' && frame.source === transfer.source);
      if (!source || !target) continue;
      const amount = held && (held.source || 'pop') === transfer.source && held.dragging ? held.amount : 0;
      const legal = amount > 0 && target.accepting;
      const ready = legal && transferTargetAt(this.transferFrames,held.x,held.y,transfer.source,blockers) === target;
      if (pressed && pressed.source === source.source || amount > 0) {
        this.box(source.x-1,source.y-1,source.w+2,source.h+2,10,'rgba(255,231,158,.12)','#bb8c37');
      }
      const pulse = ready ? '#e0f2ca' : legal ? 'rgba(223,239,208,.5)' : 'rgba(255,249,229,.35)';
      this.box(target.x,target.y,target.w,target.h,10,pulse,legal?'#2c8472':'#a0aa99');
      if (!this.sprite('input_cup_collar',[target.x+1,target.y+1,62,43],createArtTransform())) {
        this.box(target.x+6,target.y+9,52,29,6,'#dce6d4','#718c80');
      }
      this.sprite('ui_icon_'+(transfer.target==='cup'?'cup':'ship'),[target.x+23,target.y+13,18,18],createArtTransform());
      const label = !target.accepting ? '已满' : ready ? '松手放入' : transfer.target === 'cup' ? '装杯入口' : '出货入口';
      this.label(label,target.x+32,target.y+54,10,!target.accepting?'#93612c':'#256454','center');
      if (legal) {
        this.c.save(); if (this.c.setLineDash) this.c.setLineDash([3,4]);
        this.box(target.x-12,target.y-12,target.w+24,target.h+24,16,null,'rgba(44,132,114,.42)'); this.c.restore();
      }
      const diag = {source,target,amount,inputAmount:transfer.inputAmount,inputCapacity:transfer.inputCapacity,
        automated:!!transfer.automated,legal,overTarget:!!ready,inputPoint:[target.x+32,target.y+22],
        machineInputPoint:nodes[transfer.target].transform.point(nodes[transfer.target].rig.input),physicalInput:target};
      this.diagnostics.transfers.push(diag);
    }
    this.diagnostics.transfer = this.diagnostics.transfers[0] || null;
  }
  transferControls(nodes,view) { this.logisticsControls(nodes,view); }
  label(text,x,y,size=12,color='#195b60',align='left') {
    const c=this.c;c.font=`700 ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;c.textAlign=align;c.textBaseline='middle';c.fillStyle=color;c.fillText(text,x,y);
  }
  machine(node,station,view) {
    const {rig,transform:t}=node, job=station.jobs && station.jobs[0];
    const p=job?clamp(job.progress):0,working=!!job&&!job.complete;
    const movingLayer=rig.layers.find(layer=>layer.travel);
    const travel=(movingLayer == null ? undefined : movingLayer.travel) || [0,0];
    const headOffset=working?Math.sin(p*Math.PI)*travel[1]:0;
    const diag={stationId:station.id,status:station.status,rect:node.rect,ports:{input:t.point(rig.input),output:t.point(rig.output)},
      jobs:(station.jobs||[]).filter(Boolean).map(item=>({amount:item.amount,progress:item.progress,complete:item.complete,headOffset:item.complete?0:Math.sin(clamp(item.progress)*Math.PI)*travel[1]}))};
    this.diagnostics.machines.push(diag);
    const selected=(view.presentation == null ? undefined : view.presentation.selectedStationId)===station.id;
    if(selected){const r=node.rect;this.box(r[0]-2,r[1]-2,r[2]+4,r[3]+4,12,'rgba(255,245,200,.26)','#267d7e');}
    for(const layer of rig.layers.filter(l=>l.layer<30))this.part(layer,t,layer.travel?{offset:[0,headOffset]}:undefined);
    if(job){
      if(station.id==='pop')this.clipped(rig.contentClip,t,()=>this.sprite('product_cup_fill',rig.content.exampleFill,t));
      else this.cupAt(station.id==='cup'?rig.cup.rect:rig.content.singleCup,t,station.id==='cup'?p:1);
    }
    for(const layer of rig.layers.filter(l=>l.layer>=30))this.part(layer,t);
    if((this.flash == null ? undefined : this.flash.stationId)===station.id){const r=node.rect;this.sprite('fx_sparkle',[r[0]+r[2]*.55,r[1]+r[3]*.08,28,28],createArtTransform(),{alpha:Math.min(1,this.flash.remaining)});}
    const region=rig.clickRegion || [[0,0],[rig.size[0],0],[rig.size[0],rig.size[1]],[0,rig.size[1]]];
    const points=t.points(region),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const hit=minimumHitRect([Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)],44,[this.frame.x,this.frame.y,this.frame.w,this.frame.h]);
    this.stationFrames.push({id:station.id,x:hit[0],y:hit[1],w:hit[2],h:hit[3],art:true,artRect:node.rect,textX:hit[0]});
  }
  machineLabel(node,station,view,compact) {
    const r=node.rect, selected=(view.presentation || {}).selectedStationId===station.id;
    const status=station.status==='waiting'?'缺料':station.status==='blocked'?'已满':'';
    const text=station.name+(status?' · '+status:'');
    const x=r[0]+r[2]/2,y=r[1]+r[3]+8,size=compact?10:12;
    this.c.font='700 '+size+'px "Microsoft YaHei", "PingFang SC", sans-serif';
    const width=this.c.measureText(text).width+12;
    this.box(x-width/2,y-8,width,16,5,'rgba(255,250,232,.86)',selected?'#27847a':undefined);
    this.label(text,x,y,size,status?'#93612c':'#175f60','center');
  }
  stock(node,buffer) {
    const {rig,transform:t}=node,amount=Math.max(0,buffer.amount),ratio=clamp(amount/Math.max(1,buffer.capacity));
    for(const layer of rig.layers.filter(l=>l.layer<30))this.part(layer,t);
    this.clipped(rig.contentClip,t,()=>{
      if(node.id==='bulk'){
        const count=amount<4?amount:Math.ceil(ratio*24);
        for(let i=0;i<count;i++){
          const row=Math.floor(i/6),col=i%6,id=i%2?'product_kernel_b':'product_kernel_a';
          const r=amount<4?[190+i*40,171+i*15,50,49]:[157+col*45-row*25,145+col*18+row*25-rig.fillLift*ratio,56,54];
          this.sprite(id,r,t);
        }
      }else{
        const count=amount===0?0:amount<3?amount:Math.ceil(ratio*rig.content.representativeLimit);
        rig.content.slots.slice(0,count).forEach(r=>this.cupAt(r,t));
      }
    });
    for(const layer of rig.layers.filter(l=>l.layer>=30))this.part(layer,t);
    const r=node.rect;this.bufferFrames.push({id:buffer.id,x:r[0],y:r[1],w:r[2],h:r[3],art:true});
    this.diagnostics.buffers.push({id:buffer.id,amount,capacity:buffer.capacity,rect:r,full:amount>=buffer.capacity});
  }
  stockLabel(node,buffer,compact) {
    const r=node.rect, number=buffer.amount>=1000?(buffer.amount/1000).toFixed(1)+'k':String(buffer.amount);
    const text=(node.id==='bulk'?'待装 ':'待发 ')+number;
    const frame=this.transferFrames.find(item=>item.kind==='tray'&&item.source===buffer.id);
    const x=frame?frame.x+32:r[0]+r[2]/2,y=frame?frame.y+55:r[1]+r[3]+8;
    this.label(text,x,y,10,buffer.amount>=buffer.capacity?'#925f29':'#235f63','center');
  }
  belt(node,view) {
    const {rig,transform:t}=node;
    const connection=node.id==='belt_bulk_cup'?'pop':node.id==='belt_stock_ship'?'cup':null;
    const transfer=view.mode==='v15'&&connection?view.transfers.find(item=>item.source===connection):null;
    const disconnected=view.mode==='v15'?connection&&!(transfer == null ? undefined : transfer.automated):(view.transfer == null ? undefined : view.transfer.enabled)&&node.id==='belt_bulk_cup';
    if(disconnected){
      const a=t.point(rig.input),b=t.point(rig.output),c=this.c;
      c.save();if(c.setLineDash)c.setLineDash([4,5]);this.line(a[0],a[1],b[0],b[1],'#b79963',3);c.restore();
      return;
    }
    for(const layer of rig.layers.filter(l=>l.layer<30))this.part(layer,t);
    const points=(rig.path||[rig.input,rig.output]).map(point=>t.point(point));
    const segments=points.slice(1).map((point,i)=>({a:points[i],b:point,length:Math.hypot(point[0]-points[i][0],point[1]-points[i][1])}));
    const total=segments.reduce((sum,s)=>sum+s.length,0);
    const along=progress=>{
      let distance=clamp(progress)*total;
      for(const segment of segments){
        if(distance<=segment.length||segment===segments[segments.length-1]){const p=segment.length?distance/segment.length:0;return {x:segment.a[0]+(segment.b[0]-segment.a[0])*p,y:segment.a[1]+(segment.b[1]-segment.a[1])*p,angle:Math.atan2(segment.b[1]-segment.a[1],segment.b[0]-segment.a[0])};}
        distance-=segment.length;
      }
    };
    if(total>28){
      const mark=along(.52),dx=Math.cos(mark.angle),dy=Math.sin(mark.angle);
      for(const side of [-1,1])this.line(mark.x-dx*4+dy*side*3,mark.y-dy*4-dx*side*3,mark.x,mark.y,'#e4c889',1.5);
    }
    let job=null,progress=0,cargo=null;
    if(node.id==='outfeed'){
      if(this.delivery){progress=1-this.delivery.remaining/this.delivery.duration;cargo='cup';}
    }else{
      const stationId=node.id==='belt_pop_bulk'?'pop':node.id==='belt_bulk_cup'?'cup':node.id==='belt_cup_stock'?'cup':'ship';
      const jobs=view.stations.find(s=>s.id===stationId).jobs;
      job=jobs == null ? undefined : jobs[0];
      if(job&&!job.complete){progress=clamp(job.progress);cargo=node.id.includes('bulk')?'kernel':'cup';}
    }
    if(cargo){
      const point=along(.18+progress*.65),xx=point.x,yy=point.y;
      // Transit markers represent that existing batch; they are never additional stock.
      const identity=createArtTransform();
      if(cargo==='cup')this.transitCup([xx-6,yy-15,12,15],identity,node,job);
      else this.sprite('product_kernel_a',[xx-3,yy-6,7,7],identity);
    }
    for(const layer of rig.layers.filter(l=>l.layer>=30))this.part(layer,t);
  }
  transitCup(rect,transform) { this.cupAt(rect,transform); }
}

module.exports={FirstGenerationScene};
