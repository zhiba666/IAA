'use strict';
// Contact sheet only: unchanged exported sprites laid out on review backgrounds.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
let sharp;
for (const candidate of [process.env.IAA_SHARP_MODULE,'sharp',path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')].filter(Boolean)) {
  try { sharp = require(candidate); break; } catch (error) { if(error.code!=='MODULE_NOT_FOUND')throw error; }
}
if(!sharp)throw new Error('sharp unavailable');
const base=__dirname;
const image=(id,x,y,w,h)=>`<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${fs.readFileSync(path.join(base,'exports',id+'.png')).toString('base64')}"/>`;
const text=(value,x,y,size=20,color='#225956',weight=400)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${value}</text>`;
const rect=(x,y,w,h,fill,r=18)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" rx="${r}"/>`;
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1040"><rect width="1440" height="1040" fill="#f4f2e9"/><g font-family="Microsoft YaHei,Arial,sans-serif">
${text('IAA / v1.3',44,57,18,'#618078',600)}${text('工厂直售区 · 场景美术',44,108,38,'#174e51',700)}${text('3 张新增 PNG · 9 项已有精灵复用 · 图层独立，数量与订单由界面绘制',44,145,20,'#687970')}
${rect(40,180,440,704,'#e6e9df')}${image('scene_direct_sales_courtyard',56,196,408,612)}${text('01  直售庭院背景',62,850,24,'#225956',600)}
${rect(504,180,896,320,'#fffdf6')}${text('02  双客取货柜台',528,216,24,'#225956',600)}${image('scene_pickup_counter',538,246,620,234)}${image('scene_factory_wayfinding',1160,270,210,210)}
${rect(504,522,896,362,'#193e43')}${text('深底边缘 / SMALL SIZE',528,558,19,'#dbe9df',600)}${image('scene_pickup_counter',532,610,438,166)}${image('scene_factory_wayfinding',1000,590,244,256)}${image('scene_factory_wayfinding',1250,676,96,96)}${text('96px',1268,807,16,'#dbe9df')}
${text('03  工厂导向牌',520,927,24,'#225956',600)}${text('青绿金属 / 奶油地面 / 左上柔光 / 近正面 3/4 视角',44,973,20,'#687970')}
${rect(1150,915,54,54,'#225956',10)}${rect(1218,915,54,54,'#d4e5da',10)}${rect(1286,915,54,54,'#f3e9cf',10)}${rect(1354,915,44,54,'#db7463',10)}
</g></svg>`;
fs.mkdirSync(path.join(base,'qa'),{recursive:true});
sharp(Buffer.from(svg)).png().toFile(path.join(base,'qa/contact-sheet.png')).then(()=>console.log('qa/contact-sheet.png created')).catch(error=>{console.error(error);process.exitCode=1;});
