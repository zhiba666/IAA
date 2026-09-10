'use strict';

const { ProductionScene } = require('./production-scene');
const { ART_RIGS, ART_ASSETS } = require('./art-manifest');
const { createArtTransform, drawArtLayer, clipArtPolygon, minimumHitRect } = require('./art-layout');
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
    const compact = h < 420;
    // Short screens change the floor plan: three distinct machines step across
    // the room. Only the inter-station conveyors get shorter; rigs remain uniform.
    const rows = compact ? [
      ['pop','popMachine',.16], ['belt_pop_bulk','conveyorRight',.13], ['bulk','bulkBuffer',.13],
      ['belt_bulk_cup','conveyorLeft',.26,true], ['cup','cupMachine',.20],
      ['belt_cup_stock','conveyorLeft',.34], ['cups','cupsBuffer',.13],
      ['belt_stock_ship','conveyorTransfer',.105], ['ship','shipMachine',.16], ['outfeed','conveyorOutfeed',.10]
    ] : [
      ['pop','popMachine',.23], ['belt_pop_bulk','conveyorRight',.25], ['bulk','bulkBuffer',.19],
      ['belt_bulk_cup','conveyorLeft',.35], ['cup','cupMachine',.24],
      ['belt_cup_stock','conveyorRight',.30], ['cups','cupsBuffer',.18],
      ['belt_stock_ship','conveyorLeft',.46], ['ship','shipMachine',.22], ['outfeed','conveyorOutfeed',.19]
    ];
    const nodes = []; let previous;
    for (const [id, name, scale, reverse] of rows) {
      const source = ART_RIGS[name], rig = reverse ? {...source,input:source.output,output:source.input} : source;
      const from = previous && previous.local.point(previous.rig.output);
      const local = createArtTransform({ x: from ? from[0] - rig.input[0] * scale : 0,
        y: from ? from[1] - rig.input[1] * scale : 0, scale });
      const node = { id, name, rig, local, kind: id.includes('belt') || id === 'outfeed' ? 'belt' : ['bulk','cups'].includes(id) ? 'buffer' : 'machine' };
      nodes.push(node); previous = node;
    }
    const extent = nodes.map(n => n.local.rect([0,0,...n.rig.size]));
    const minX = Math.min(...extent.map(r => r[0])), minY = Math.min(...extent.map(r => r[1]));
    const maxX = Math.max(...extent.map(r => r[0]+r[2])), maxY = Math.max(...extent.map(r => r[1]+r[3]));
    const scale = Math.min((w-16)/(maxX-minX), (h-(compact?22:38))/(maxY-minY));
    const scene = createArtTransform({ x: this.frame.x + (w-(maxX-minX)*scale)/2-minX*scale,
      y: this.frame.y + (compact ? 12 : 18) + Math.max(0,(h-(compact?22:34)-(maxY-minY)*scale)/2)-minY*scale, scale });
    nodes.forEach(node => { node.transform = scene.child(node.local); node.rect = node.transform.rect([0,0,...node.rig.size]); });
    return { nodes, compact };
  }
  draw(x, y, w, h, view) {
    if (view.state.machine !== 0) { this.artGeneration = null; return super.draw(x,y,w,h,view); }
    this.artGeneration = 0;
    if (![x,y,w,h].every(Number.isFinite) || w<=0 || h<=0) return;
    this.frame={x,y,w,h}; this.stationFrames=[]; this.bufferFrames=[];
    const {nodes,compact}=this.placements(w,h), c=this.c, identity=createArtTransform();
    const byId=Object.fromEntries(nodes.map(node=>[node.id,node]));
    this.diagnostics={layout:compact?'compact-return-loop':'tall-zigzag',machines:[],buffers:[],connections:[],frame:{x,y,w,h}};
    c.save(); this.box(x,y,w,h,16,'#f0e1c4'); c.clip();
    const room=ART_ASSETS.factory_room, roomScale=Math.max(w/room.width,h/room.height);
    this.sprite('factory_room',[x+(w-room.width*roomScale)/2,y,room.width*roomScale,room.height*roomScale],identity);
    if(!compact)this.sprite('factory_window',[x+27,y+10,66,60.07],identity);
    for(let i=1;i<nodes.length;i++) {
      const a=nodes[i-1].transform.point(nodes[i-1].rig.output),b=nodes[i].transform.point(nodes[i].rig.input);
      this.diagnostics.connections.push({from:nodes[i-1].id,to:nodes[i].id,fromPoint:a,toPoint:b,gap:Math.hypot(a[0]-b[0],a[1]-b[1])});
    }
    for(const node of nodes.filter(n=>n.kind==='belt'))this.belt(node,view);
    const solids=nodes.filter(n=>n.kind!=='belt').sort((a,b)=>a.transform.point(a.rig.anchor)[1]-b.transform.point(b.rig.anchor)[1]);
    for(const node of solids) {
      if(node.kind==='machine')this.machine(node,view.stations.find(s=>s.id===node.id),view);
      else this.stock(node,view.buffers[node.id==='bulk'?0:1]);
    }
    // Labels are a final live text layer, never part of a machine PNG.
    for(const id of ['pop','cup','ship'])this.machineLabel(byId[id],view.stations.find(s=>s.id===id),view,compact);
    for(const id of ['bulk','cups'])this.stockLabel(byId[id],view.buffers[id==='bulk'?0:1],compact);
    if(this.delivery) {
      const node=byId.outfeed,p=1-this.delivery.remaining/this.delivery.duration,rect=node.rect;
      this.label('+'+this.delivery.coins+' 金',Math.min(x+w-28,rect[0]+rect[2]*.6),Math.min(y+h-10,rect[1]+rect[3]+4),12,'#176968','center');
    }
    c.restore();
    return {frame:this.frame,stationFrames:this.stationFrames,bufferFrames:this.bufferFrames};
  }
  label(text,x,y,size=12,color='#195b60',align='left') {
    const c=this.c;c.font=`700 ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;c.textAlign=align;c.textBaseline='middle';c.fillStyle=color;c.fillText(text,x,y);
  }
  machine(node,station,view) {
    const {rig,transform:t}=node, job=station.jobs && station.jobs[0];
    const p=job?clamp(job.progress):0,working=!!job&&!job.complete;
    const travel=rig.layers.find(layer=>layer.travel)?.travel || [0,0];
    const headOffset=working?Math.sin(p*Math.PI)*travel[1]:0;
    const diag={stationId:station.id,status:station.status,rect:node.rect,ports:{input:t.point(rig.input),output:t.point(rig.output)},
      jobs:(station.jobs||[]).filter(Boolean).map(item=>({amount:item.amount,progress:item.progress,complete:item.complete,headOffset:item.complete?0:Math.sin(clamp(item.progress)*Math.PI)*travel[1]}))};
    this.diagnostics.machines.push(diag);
    const selected=view.presentation?.selectedStationId===station.id;
    if(selected){const r=node.rect;this.box(r[0]-2,r[1]-2,r[2]+4,r[3]+4,12,'rgba(255,245,200,.26)','#267d7e');}
    for(const layer of rig.layers.filter(l=>l.layer<30))this.part(layer,t,layer.travel?{offset:[0,headOffset]}:undefined);
    if(job){
      if(station.id==='pop')this.clipped(rig.contentClip,t,()=>this.sprite('product_cup_fill',rig.content.exampleFill,t));
      else this.cupAt(station.id==='cup'?rig.cup.rect:rig.content.singleCup,t,station.id==='cup'?p:1);
    }
    for(const layer of rig.layers.filter(l=>l.layer>=30))this.part(layer,t);
    if(this.flash?.stationId===station.id){const r=node.rect;this.sprite('fx_sparkle',[r[0]+r[2]*.55,r[1]+r[3]*.08,28,28],createArtTransform(),{alpha:Math.min(1,this.flash.remaining)});}
    const region=rig.clickRegion || [[0,0],[rig.size[0],0],[rig.size[0],rig.size[1]],[0,rig.size[1]]];
    const points=t.points(region),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const hit=minimumHitRect([Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)],44,[this.frame.x,this.frame.y,this.frame.w,this.frame.h]);
    this.stationFrames.push({id:station.id,x:hit[0],y:hit[1],w:hit[2],h:hit[3],art:true,artRect:node.rect,textX:hit[0]});
  }
  machineLabel(node,station,view,compact) {
    const r=node.rect,selected=view.presentation?.selectedStationId===station.id;
    let x,y,align='left';
    if(compact){x=r[0]+r[2]/2;y=station.id==='ship'?r[1]+r[3]+7:r[1]-7;align='center';}
    else if(station.id==='cup'){x=r[0]-6;y=r[1]+r[3]*.55;align='right';}
    else{x=r[0]+r[2]+10;y=r[1]+r[3]*(station.id==='ship'?.72:.38);}
    x=Math.min(this.frame.x+this.frame.w-70,Math.max(this.frame.x+35,x));
    const name=(selected?'▸ ':'')+station.name;
    const state={running:'加工中',waiting:'等供料',blocked:'等空位'}[station.status];
    if(compact){
      this.box(x-48,y-9,96,18,5,'rgba(255,250,232,.94)');
      this.label(name+' · '+state,x,y,11,station.status==='running'?'#176c68':'#80532a',align);
    }else {this.label(name,x,y,17,'#164f54',align);this.label(state,x,y+22,12,station.status==='running'?'#176c68':'#8a5b2f',align);}
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
    const r=node.rect,text=(node.id==='bulk'?'待装 ':'待发 ')+buffer.amount+'/'+buffer.capacity;
    const x=Math.max(this.frame.x+42,Math.min(this.frame.x+this.frame.w-42,r[0]+r[2]*.5));
    const y=compact?r[1]+r[3]+8:r[1]+r[3]+12;
    this.box(x-42,y-9,84,18,5,'rgba(255,250,232,.94)');
    this.label(text,x,y,compact?11:13,buffer.amount>=buffer.capacity?'#925f29':'#235f63','center');
  }
  belt(node,view) {
    const {rig,transform:t}=node;
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
      job=view.stations.find(s=>s.id===stationId).jobs?.[0];
      if(job&&!job.complete){progress=clamp(job.progress);cargo=node.id.includes('bulk')?'kernel':'cup';}
    }
    if(cargo){
      const point=along(.18+progress*.65),xx=point.x,yy=point.y;
      // Transit markers represent that existing batch; they are never additional stock.
      const identity=createArtTransform();
      if(cargo==='cup')this.cupAt([xx-6,yy-15,12,15],identity);
      else this.sprite('product_kernel_a',[xx-3,yy-6,7,7],identity);
    }
    for(const layer of rig.layers.filter(l=>l.layer>=30))this.part(layer,t);
  }
}

module.exports={FirstGenerationScene};
