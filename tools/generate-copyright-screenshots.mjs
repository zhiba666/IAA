// Actual Renderer.draw output, with deliberately fixed demonstration state.
// These images are not browser/Android captures or platform-verification evidence.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtimeModules=process.env.CODEX_ARTIFACT_NODE_MODULES;
if(!runtimeModules)throw new Error('Set CODEX_ARTIFACT_NODE_MODULES to the path from load_workspace_dependencies.');
const runtimeRequire=createRequire(path.join(runtimeModules,'_resolve.cjs'));
const {createCanvas,GlobalFonts}=runtimeRequire('@napi-rs/canvas');
GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc','Microsoft YaHei');
const require=createRequire(import.meta.url);
const {Game}=require('../src/core.js');
const {Renderer}=require('../src/renderer.js');
const output=process.argv.indexOf('--output');
if(output>=0&&!process.argv[output+1])throw new Error('--output requires a directory.');
const directory=output>=0?path.resolve(process.argv[output+1]):path.join(root,'docs/copyright/screenshots');
await mkdir(directory,{recursive:true});
function state(){
  const game=new Game({now:0});Object.assign(game.state,{machine:1,coins:45200,totalCoins:98200,totalProduced:9000,
    taps:340,bursts:12,orderIndex:4,energy:68,playedSeconds:720,upgrades:{tap:4,auto:5,value:4}});return game;
}
const views=[
  {name:'01-startup',caption:'启动与健康游戏忠告',description:'当前源码直接渲染的启动页。点击进入工厂后开始经营。',ui:{startup:true}},
  {name:'02-main',caption:'工厂主界面',description:'示例金币、当前订单、生产区域、火候和底部导航。通过升级入口查看永久提升；浏览器激励仅为模拟。',ui:{}},
  {name:'03-order',caption:'普通订单装车与广告加价',description:'示例订单达到产量要求，可直接装车领取基础金币；广告加价是可选路线。',ui:{modal:{type:'order'}}},
  {name:'04-blueprint',caption:'六阶段工厂蓝图',description:'当前设备与后续设备条件由同一份配置数据生成。示例状态不代表真实玩家进度。',ui:{modal:{type:'blueprint'}}},
  {name:'05-settings',caption:'工厂设置与侧边栏入口的界面分支',description:'此图显式设置抖音样式及侧边栏支持状态以展示界面分支，未调用抖音API，不是能力验证。',ui:{isDouyin:true,sidebar:{supported:true,checking:false,fromSidebar:false},modal:{type:'settings'}}},
  {name:'06-sidebar',caption:'侧边栏操作说明的界面分支',description:'此图仅演示侧边栏说明与主动跳转按钮。真实可用性、跳转及回访参数需在抖音环境验证。',ui:{isDouyin:true,sidebar:{supported:true,checking:false,fromSidebar:false},modal:{type:'sidebar'}}}
];
const metadata=[];
for(const view of views){
  const game=state(),canvas=createCanvas(960,1840),context=canvas.getContext('2d');context.scale(2,2);
  const renderer=new Renderer(context);
  // This installed Canvas font parser misreads non-100 weights (650/750) as
  // huge font sizes. Normalize weights only for this illustration backend.
  // The original renderer, text, geometry, sizes and source files stay intact.
  const drawText=renderer.text.bind(renderer);
  renderer.text=(s,x,y,size=14,color='#283e32',weight=400,align='left')=>
    drawText(s,x,y,size,color,Math.round(weight/100)*100,align);
  const ui={viewport:{width:480,height:920},modal:null,toast:'',saved:true,isDouyin:false,startup:false,sidebarBusy:false,
    sidebar:{supported:false,checking:false,fromSidebar:false},...view.ui};
  renderer.draw(game.getView(),ui,0);
  const target=path.join(directory,view.name+'.png');await writeFile(target,canvas.toBuffer('image/png'));
  metadata.push({path:target,caption:view.caption,description:view.description,source:'Renderer.draw / fixed demonstration state'});
}
await writeFile(output>=0?path.join(directory,'screenshots.json'):path.join(root,'docs/copyright/screenshots.json'),JSON.stringify(metadata,null,2)+'\n');
console.log(`Rendered ${metadata.length} genuine code UI illustrations at 960 x 1840; no native/browser evidence asserted.`);
