import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAudio } from './audio.mjs';
import { bundleCommonJS } from './bundle.mjs';
import { generateRuntimeArt, copyRuntimeArt } from './art-build.mjs';
import { generateV13RuntimeArt, copyV13RuntimeArt } from './v13-art-build.mjs';
import { generateV13SceneRuntimeArt, copyV13SceneRuntimeArt } from './v13-scene-art-build.mjs';
import releaseVersion from '../src/version.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--development')) throw new Error('用法：node tools/build.mjs [--development]');
const development = args.includes('--development');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (version !== releaseVersion.APP_VERSION) throw new Error('Application version does not match package.json');
const runtimeArt = await generateRuntimeArt(root);
const v13RuntimeArt = await generateV13RuntimeArt(root);
const v13SceneRuntimeArt = await generateV13SceneRuntimeArt(root);
const { code, moduleIds } = await bundleCommonJS({ root, entries: ['src/main.js'] });
// Set the build-controlled switch before platform initialization on both hosts.
// A local config or the Web entry cannot accidentally enable it in a release build.
const buildConfig = `(function(root){root.POPCORN_CONFIG=root.POPCORN_CONFIG||{};root.POPCORN_CONFIG.developerHoldTap=false;root.POPCORN_CONFIG.allowSimulatedAds=false;})(typeof globalThis !== "undefined" ? globalThis : GameGlobal);\n`;
const bundle = `/* 小小爆米花厂 v${version} | pipeline | ${development ? 'development' : 'release'} */\n` + buildConfig + code;
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
config.developerHoldTap=false;
await writeFile(path.join(root, 'build/douyin/config.js'), '(typeof globalThis !== "undefined" ? globalThis : GameGlobal).POPCORN_CONFIG = '+JSON.stringify(config,null,2)+';\n');
await writeFile(path.join(root, 'build/douyin/project.config.json'), JSON.stringify({ description: '小小爆米花厂', setting: { es6: true, minified: false, urlCheck: true }, appid: config.appId, projectname: 'tiny-popcorn-factory', compileType: 'game' }, null, 2));
await generateAudio(path.join(root,'build/douyin/audio'));
const artReport = await copyRuntimeArt(root, ['web', 'build/douyin'], runtimeArt);
const v13ArtReport = await copyV13RuntimeArt(root, ['web', 'build/douyin'], v13RuntimeArt);
const v13SceneArtReport = await copyV13SceneRuntimeArt(root, ['.', 'web', 'build/douyin'], v13SceneRuntimeArt);
console.log(`Optional v1.3 scene art: ${v13SceneArtReport.count} PNGs; ${(v13SceneArtReport.compressedBytes / 1048576).toFixed(2)} MiB files; ${(v13SceneArtReport.decodedBytes / 1048576).toFixed(2)} MiB decoded. Repository and both packages verified; independent scene budgets passed.`);
console.log(`Optional v1.3 art: ${v13ArtReport.count} PNGs; ${(v13ArtReport.compressedBytes / 1048576).toFixed(2)} MiB files; ${(v13ArtReport.decodedBytes / 1048576).toFixed(2)} MiB decoded. Both packages verified; on-demand pack budgets passed.`);
console.log(`Six-generation runtime art: ${artReport.count} PNGs; ${(artReport.compressedBytes / 1048576).toFixed(2)} MiB files; ${(artReport.decodedBytes / 1048576).toFixed(2)} MiB decoded. Both packages verified byte-for-byte; all art budgets passed.`);
console.log(`Built factory v${version} ${development ? 'development' : 'release'} (双场景原味经营；助力不推进世界时钟；广告停用): ${moduleIds.length} modules; ${(Buffer.byteLength(bundle)/1024).toFixed(1)} KiB. Web: web/ · Douyin: build/douyin/`);
