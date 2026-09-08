import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAudio } from './audio.mjs';
import { bundleCommonJS } from './bundle.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--development')) throw new Error('用法：node tools/build.mjs [--development]');
const developerHoldTap = args.includes('--development');
const { code, moduleIds } = await bundleCommonJS({ root, entries: ['src/main.js'] });
// Set the build-controlled switch before platform initialization on both hosts.
// A local config or the Web entry cannot accidentally enable it in a release build.
const buildConfig = `(function(root){root.POPCORN_CONFIG=root.POPCORN_CONFIG||{};root.POPCORN_CONFIG.developerHoldTap=${developerHoldTap};})(typeof globalThis !== "undefined" ? globalThis : GameGlobal);\n`;
const bundle = `/* 小小爆米花厂 v1.0 | ${developerHoldTap ? 'development: hold to tap 100/s' : 'release'} */\n` + buildConfig + code;
await mkdir(path.join(root, 'build/douyin'), { recursive: true });
await mkdir(path.join(root, 'web'), { recursive: true });
await writeFile(path.join(root, 'web/game.bundle.js'), bundle);
await writeFile(path.join(root, 'build/douyin/game.bundle.js'), bundle);
await writeFile(path.join(root, 'build/douyin/game.js'), "require('./config.js');\nrequire('./game.bundle.js');\n");
await writeFile(path.join(root, 'build/douyin/game.json'), JSON.stringify({ deviceOrientation: 'portrait', showStatusBar: false }, null, 2));
let config = {appId:'',rewardAdUnitId:'',interstitialAdUnitId:'',allowSimulatedAds:false};
try { config = {...config,...JSON.parse(await readFile(path.join(root,'config.local.json'),'utf8'))}; }
catch(error) { if(error.code!=='ENOENT')throw new Error('config.local.json 无效: '+error.message); }
config.allowSimulatedAds=false;
config.developerHoldTap=developerHoldTap;
await writeFile(path.join(root, 'build/douyin/config.js'), '(typeof globalThis !== "undefined" ? globalThis : GameGlobal).POPCORN_CONFIG = '+JSON.stringify(config,null,2)+';\n');
await writeFile(path.join(root, 'build/douyin/project.config.json'), JSON.stringify({ description: '小小爆米花厂', setting: { es6: true, minified: false, urlCheck: true }, appid: config.appId, projectname: 'tiny-popcorn-factory', compileType: 'game' }, null, 2));
await generateAudio(path.join(root,'build/douyin/audio'));
console.log(`Built ${developerHoldTap ? 'development (长按 100 次/秒，仅供调试)' : 'release (开发长按已关闭)'}: ${moduleIds.length} modules; ${(Buffer.byteLength(bundle)/1024).toFixed(1)} KiB. Web: web/ · Douyin: build/douyin/`);
