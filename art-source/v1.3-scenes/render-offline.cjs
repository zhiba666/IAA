'use strict';
// Executes this package's local canvas drawing in Node. No browser is opened or controlled.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
let canvasLib;
for (const candidate of [process.env.IAA_CANVAS_MODULE,'@napi-rs/canvas',path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')].filter(Boolean)) {
  try { canvasLib=require(candidate);break; } catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
}
if(!canvasLib)throw new Error('Set IAA_CANVAS_MODULE to an installed @napi-rs/canvas.');
const base=__dirname;
const {createCanvas,Image}=canvasLib;
const canvas=createCanvas(780,1488);
const nodes=new Map();
function element(id,dataset={}) { if(!nodes.has(id))nodes.set(id,{id,dataset,attributes:{},listeners:{},textContent:'',hidden:false,setAttribute(key,val){this.attributes[key]=val;},addEventListener(event,fn){this.listeners[event]=fn;}});return nodes.get(id); }
const canvasNode=element('scene-preview');canvasNode.getContext=()=>canvas.getContext('2d');canvasNode.width=canvas.width;canvasNode.height=canvas.height;
const stateButtons=['first','mixed','complete'].map(id=>element('state-'+id,{state:id}));
const toneButtons=['light','dark'].map(id=>element('tone-'+id,{tone:id}));
const document={getElementById:id=>element(id),querySelectorAll:selector=>selector==='[data-state]'?stateButtons:selector==='.swatch[data-tone]'?toneButtons:[],body:{dataset:{}}};
class LocalImage extends Image {
  get naturalWidth(){return this.width;}
  get naturalHeight(){return this.height;}
  set src(value){super.src=fs.readFileSync(path.resolve(base,value));}
}
const window={document,location:{reload(){throw new Error('Reload is not available in offline renderer');}}};
const sandbox={window,document,Image:LocalImage,console,Promise,Object,Math,JSON,Array,String,Number,Boolean,setTimeout,clearTimeout};
async function main(){
  vm.runInNewContext(fs.readFileSync(path.join(base,'preview.js'),'utf8'),sandbox,{filename:'preview.js'});
  const ready=await window.sceneArtPreviewReady;
  if(!ready.ok)throw new Error('Images failed: '+JSON.stringify(ready));
  fs.mkdirSync(path.join(base,'qa'),{recursive:true});
  const records=[], scenes=[];
  for(const state of ['first','mixed','complete']){
    stateButtons.find(b=>b.dataset.state===state).listeners.click();
    const scene=createCanvas(390,744);scene.getContext('2d').drawImage(canvas,0,0,390,744);scenes.push(scene);
    for(const width of [390,320]){
      const height=Math.round(width*744/390);
      const target=createCanvas(width,height);
      target.getContext('2d').drawImage(canvas,0,0,width,height);
      const file='qa/scene-'+state+'-'+width+'.png';
      fs.writeFileSync(path.join(base,file),target.toBuffer('image/png'));
      records.push({file,width,height,state,loaded:window.sceneArtPreview.loaded.length,failed:window.sceneArtPreview.failed});
    }
  }
  const overview=createCanvas(1300,906),oc=overview.getContext('2d');
  oc.fillStyle='#f4f2e9';oc.fillRect(0,0,1300,906);
  oc.fillStyle='#174e51';oc.font='700 32px "Microsoft YaHei",sans-serif';oc.fillText('工厂直售区 / v1.3 场景装配',30,50);
  const titles=['01  首单等候','02  混合配货','03  成交反馈'];
  scenes.forEach((scene,i)=>{const x=30+i*425;oc.font='600 19px "Microsoft YaHei",sans-serif';oc.fillText(titles[i],x,94);oc.drawImage(scene,x,112);});
  oc.fillStyle='#6b7c70';oc.font='400 16px "Microsoft YaHei",sans-serif';oc.fillText('美术状态示例 · 3 张新增环境图 + 9 项既有精灵 · 非游戏实机截图',30,886);
  fs.writeFileSync(path.join(base,'qa/scene-overview.png'),overview.toBuffer('image/png'));
  const report={date:'2026-09-12',method:'@napi-rs/canvas running local preview.js with a minimal document adapter',scope:'Local PNG composition and three state render branches only. Does not inspect CSS layout, browser interactions, real gameplay, or device input.',passed:true,ready,images:records};
  console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
