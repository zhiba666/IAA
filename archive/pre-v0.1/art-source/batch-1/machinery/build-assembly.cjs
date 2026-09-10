'use strict';
// Editable SVG composition; embeds original RGBA exports without repainting.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const rig=read(path.join(__dirname,'assembly.json'));
const core=read(path.join(__dirname,'../core/assembly.json'));
const png={};
for(const category of ['machines','scene','products'])for(const file of fs.readdirSync(path.join(root,'assets/art',category)).filter(f=>f.endsWith('.png')))png[path.basename(file,'.png')]='data:image/png;base64,'+fs.readFileSync(path.join(root,'assets/art',category,file)).toString('base64');
let serial=0;
function image(id,r,flip=false){const el=`<image href="${png[id]}" x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" preserveAspectRatio="xMidYMid meet"/>`;return flip?`<g transform="translate(${2*r[0]+r[2]} 0) scale(-1 1)">${el}</g>`:el;}
const part=p=>image(p.id,p.rect,p.flipX);
const group=(x,y,s,html)=>`<g transform="translate(${x} ${y}) scale(${s})">${html}</g>`;
function clip(points,html){const id='clip'+serial++;return `<defs><clipPath id="${id}"><polygon points="${points.map(p=>p.join(',')).join(' ')}"/></clipPath></defs><g clip-path="url(#${id})">${html}</g>`;}
function cup(r){return image('product_cup_empty',r)+image('product_cup_fill',[r[0]+r[2]*.03,r[1]-r[2]*.29,r[2]*.94,r[2]*.94*94/128]);}
function pack(name,x,y,s){const p=core[name];let html=p.parts.filter(a=>a.layer<20).map(part).join('');html+=p.slots.map(a=>cup(a.rect)).join('');html+=p.parts.filter(a=>a.layer>=20&&a.state!=='closed').map(a=>a.clip?clip(p[a.clip],part(a)):part(a)).join('');return group(x,y,s,html);}
function contents(key,state,p){if(state==='empty')return '';if(key==='popMachine')return image('product_cup_fill',p.content.exampleFill);if(key==='shipMachine')return state==='double'?pack('doubleTray',183,314,1.4):state==='box'?pack('fourCupBox',180,294,1.3):cup(p.content.singleCup);if(key==='cupsBuffer')return p.content.slots.slice(0,state==='full'?6:1).map(cup).join('');if(key==='conveyorTransfer')return cup([220,40,55,67.69]);if(key==='conveyorInfeed')return image('product_kernel_a',[168,117,44,42])+image('product_kernel_b',[260,162,44,43]);return cup([238,97,54,66.46]);}
function machine(key,state){const p=rig[key];return p.layers.filter(a=>a.layer<30).map(part).join('')+contents(key,state,p)+p.layers.filter(a=>a.layer>=30).map(part).join('');}
const cases=[['popMachine','empty','POP / EMPTY'],['popMachine','work','POP / WORKING'],['shipMachine','single','SHIP / SINGLE CUP'],['shipMachine','double','SHIP / DOUBLE TRAY'],['shipMachine','box','SHIP / OPEN BOX'],['conveyorTransfer','work','TRANSFER / CARGO'],['conveyorInfeed','work','INFEED / KERNELS'],['conveyorOutfeed','work','OUTFEED / CUP'],['cupsBuffer','empty','BUFFER / EMPTY'],['cupsBuffer','small','BUFFER / SMALL'],['cupsBuffer','full','BUFFER / FULL'],['shipMachine','empty','SHIP / EMPTY']];
let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1610" viewBox="0 0 1800 1610"><rect width="1800" height="1610" fill="#f5f0e4"/><g font-family="Microsoft YaHei, sans-serif" fill="#084d53"><text x="30" y="58" font-size="37" font-weight="700">MACHINERY 01 / STATIC LAYER ASSEMBLY</text><text x="32" y="102" font-size="23">Artwork only. Products and moving heads remain separate. No gameplay is connected.</text>';
cases.forEach(([key,state,label],i)=>{const x=24+i%4*445,y=124+Math.floor(i/4)*482,p=rig[key],s=Math.min(402/p.size[0],386/p.size[1]);svg+=`<rect x="${x}" y="${y}" width="428" height="462" fill="#fffaf0"/><text x="${x+12}" y="${y+37}" font-size="24">${label}</text>`+group(x+(428-p.size[0]*s)/2,y+61+(386-p.size[1]*s)/2,s,machine(key,state));});
svg+='</g></svg>';fs.writeFileSync(path.join(__dirname,'assembly.svg'),svg);console.log('Wrote layered assembly.svg from assembly.json and unchanged PNGs.');
