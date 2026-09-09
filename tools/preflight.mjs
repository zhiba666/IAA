import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AUDIO_FILES = ['upgrade', 'machine', 'click', 'error'].map(name => `audio/${name}.wav`);
export const REQUIRED_FILES = ['game.js', 'game.json', 'project.config.json', 'config.js', 'game.bundle.js', ...AUDIO_FILES];
const CONFIG_DEFAULTS = { appId: '', rewardAdUnitId: '', interstitialAdUnitId: '', allowSimulatedAds: false, analyticsEnabled: false, debug: false, developerHoldTap: false };
const ID_LABELS = { appId: '小游戏 AppID' };
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function parseJSON(source) { try { const result = JSON.parse(source); return object(result) ? result : null; } catch { return null; } }

// Syntax and common placeholder detection only. An offline script cannot validate ownership or approval.
export function idState(value) {
  if (value === undefined || value === '') return 'missing';
  if (typeof value !== 'string' || value !== value.trim() || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) return 'invalid';
  if (/(?:your|replace|todo|test|placeholder|example|demo)/i.test(value) || /^(?:tt|adunit[-_]?)?([a-z0-9])\1{5,}$/i.test(value)) return 'placeholder';
  return 'provided-unverified';
}

// Kept pure so invalid packages can be tested without executing their JavaScript.
export function inspectPackage({ files = new Map(), entries = [], localConfigText = null, readErrors = [] } = {}) {
  const checks = [];
  const add = (code, status, message) => checks.push({ code, status, message });
  const source = name => files.has(name) ? files.get(name).toString('utf8') : null;
  const missingFiles = REQUIRED_FILES.filter(name => !files.has(name));
  add('package-files', missingFiles.length ? 'error' : 'pass', missingFiles.length ? `构建缺少必需文件：${missingFiles.join('、')}。先运行 npm run build。` : `入口、配置、游戏代码及 ${AUDIO_FILES.length} 个音效文件齐全。`);
  if (readErrors.length) add('package-readable', 'error', '部分项目文件无法读取，或发现符号链接；请使用本项目构建器重新生成构建目录。');
  const unknownFiles = entries.filter(entry => !REQUIRED_FILES.includes(entry.name));
  add('package-contents', unknownFiles.length ? 'error' : 'pass', unknownFiles.length ? `包内有 ${unknownFiles.length} 个非预期文件；请检查 build/douyin，仅保留本项目构建器产物。` : '包内未发现多余文件。');
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  add('package-size', totalBytes > MAX_PACKAGE_BYTES ? 'error' : 'pass', `本地未压缩文件共 ${(totalBytes / 1024).toFixed(1)} KiB；当前无分包，按 20 MiB 上限预检，最终以 IDE 统计为准。`);

  const entry = source('game.js');
  if (entry !== null) {
    const validEntry = /^\s*require\(['"]\.\/config\.js['"]\);\s*require\(['"]\.\/game\.bundle\.js['"]\);\s*$/.test(entry);
    add('entry-order', validEntry ? 'pass' : 'error', validEntry ? '入口先加载配置，再启动游戏。' : 'game.js 入口与本项目构建模板不一致，请重新构建。');
  }
  if (files.has('game.bundle.js')) add('bundle-content', files.get('game.bundle.js').length > 100 ? 'pass' : 'error', files.get('game.bundle.js').length > 100 ? '游戏代码非空；运行行为仍须测试。' : '游戏代码为空或异常短，请重新构建。');
  const brokenAudio = AUDIO_FILES.filter(name => {
    const bytes = files.get(name);
    return bytes && (bytes.length <= 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length);
  });
  add('audio-format', brokenAudio.length ? 'error' : 'pass', brokenAudio.length ? `音效 WAV 文件损坏：${brokenAudio.join('、')}。` : '现有音效通过 WAV 文件头与长度检查；播放效果待真机核验。');

  const game = parseJSON(source('game.json'));
  const project = parseJSON(source('project.config.json'));
  if (files.has('game.json')) add('game-config', game && game.deviceOrientation === 'portrait' && game.showStatusBar === false && !game.subpackages && !game.subPackages ? 'pass' : 'error', game && game.deviceOrientation === 'portrait' && game.showStatusBar === false && !game.subpackages && !game.subPackages ? '竖屏、状态栏及无分包配置符合当前版本。' : 'game.json 无效或与当前竖屏无分包构建不一致。');
  if (files.has('project.config.json')) add('project-config', project && project.compileType === 'game' && project.setting?.urlCheck === true ? 'pass' : 'error', project && project.compileType === 'game' && project.setting?.urlCheck === true ? 'IDE 项目类型为小游戏，保留域名校验。' : 'IDE 项目配置无效，或小游戏类型/域名校验不符合预期。');

  const configMatch = source('config.js')?.match(/^\s*(?:globalThis|\(typeof globalThis !== (?:"undefined"|'undefined') \? globalThis : GameGlobal\))\.POPCORN_CONFIG\s*=\s*(\{[\s\S]*\})\s*;\s*$/);
  const built = configMatch ? parseJSON(configMatch[1]) : null;
  if (files.has('config.js')) add('built-config-json', built ? 'pass' : 'error', built ? '构建配置可作为纯 JSON 读取。' : 'config.js 不是预期的纯配置赋值，请重新构建；预检不会执行该文件。');
  const hasLocal = localConfigText !== null;
  const local = hasLocal ? parseJSON(localConfigText) : {};
  if (hasLocal) add('local-config-json', local ? 'pass' : 'error', local ? '本地配置格式有效。' : 'config.local.json 必须是有效 JSON 对象；检查语法，勿在文件中加入注释。');
  else add('local-config-missing', 'pending', '尚无 config.local.json。复制 config.local.example.json 为 config.local.json，在账号后台取得 ID 后填写，再运行 npm run build。');

  for (const [label, config] of [['本地', local], ['构建', built]]) {
    if (!config) continue;
    const unknownKeys = Object.keys(config).filter(key => !Object.hasOwn(CONFIG_DEFAULTS, key));
    if (unknownKeys.length) add(`${label}-unknown-config`, 'error', `${label}配置含非预期字段，请仅保留示例中的字段；不要写入 AppSecret、登录令牌等密钥。`);
    for (const key of ['allowSimulatedAds', 'analyticsEnabled', 'debug', 'developerHoldTap']) {
      if (config[key] !== undefined && typeof config[key] !== 'boolean') add(`${label}-${key}-type`, 'error', `${label}配置 ${key} 必须是 true 或 false。`);
    }
  }
  if (built) {
    add('simulated-ads-disabled', built.allowSimulatedAds === false ? 'pass' : 'error', built.allowSimulatedAds === false ? '抖音包已禁用模拟广告奖励。' : '抖音包未明确禁用模拟广告，禁止继续联调。');
    add('debug-disabled', built.debug !== true ? 'pass' : 'error', built.debug !== true ? '抖音包未开启调试修改配置。' : '抖音包 debug 已开启，恢复 false 并重新构建。');
    add('developer-hold-disabled', built.developerHoldTap === false ? 'pass' : 'error', built.developerHoldTap === false ? '流水线版本已明确停用开发长按连点。' : '当前包未关闭废弃连点功能；运行 npm run build 重新构建。');
    if (local) {
      const expected = { ...CONFIG_DEFAULTS, ...local, allowSimulatedAds: false, developerHoldTap: false };
      const actual = { ...CONFIG_DEFAULTS, ...built };
      const mismatches = Object.keys(CONFIG_DEFAULTS).filter(key => expected[key] !== actual[key]);
      add('config-synchronized', mismatches.length ? 'error' : 'pass', mismatches.length ? `本地与构建配置不一致（${mismatches.join('、')}），请运行 npm run build；不要只改构建目录。` : '本地配置与构建配置一致。');
    }
    add('appid-synchronized', project && built.appId === project.appid ? 'pass' : 'error', project && built.appId === project.appid ? 'IDE 与运行配置中的 AppID 一致。' : 'project.config.json 与 config.js 的 AppID 不一致，请重新构建。');
    if (built.analyticsEnabled === true) add('analytics-console', 'pending', '平台事件上报已启用；需在后台核对事件开通及接收结果。');
  }
  for (const [key, label] of Object.entries(ID_LABELS)) {
    const state = idState(local?.[key]);
    add(key, state === 'provided-unverified' ? 'pass' : 'pending', state === 'provided-unverified' ? `${label} 已填写；格式预检通过，真实性、归属和启用状态待平台核验。` : `${label} ${state === 'missing' ? '未填写' : state === 'placeholder' ? '仍为占位内容' : '格式不符合预期'}；请从对应小游戏后台复制，不要使用虚构 ID。`);
  }
  add('ads-disabled', 'pass', '流水线版本停用全部广告入口与奖励，广告位不属于当前启用条件或严格预检要求。');
  add('platform-verification', 'manual', '真机验收继续暂停：IDE 登录及项目权限、测试账号/设备、预览启动、真机触摸/音效/存档/前后台恢复仍未验证。此脚本不验证平台权限，不证明审核或发布就绪。');
  return { codeReady: !checks.some(check => check.status === 'error'), accountConfigReady: !checks.some(check => check.status === 'pending'), platformVerified: false, totalBytes, checks };
}

export async function inspectProject(rootDir = DEFAULT_ROOT) {
  const packageDir = path.join(rootDir, 'build/douyin');
  const files = new Map(), entries = [], readErrors = [];
  async function walk(relative = '') {
    let children;
    try { children = await readdir(path.join(packageDir, relative), { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') readErrors.push('directory'); return; }
    for (const child of children) {
      const name = relative ? `${relative}/${child.name}` : child.name;
      const filePath = path.join(packageDir, name);
      if (child.isSymbolicLink()) { readErrors.push('symlink'); continue; }
      if (child.isDirectory()) await walk(name);
      else if (child.isFile()) {
        try {
          const info = await lstat(filePath);
          if (info.isSymbolicLink()) { readErrors.push('symlink'); continue; }
          entries.push({ name, size: info.size });
          // Extra package contents are reported by count, never read or printed.
          if (REQUIRED_FILES.includes(name)) files.set(name, await readFile(filePath));
        } catch { readErrors.push('file'); }
      }
    }
  }
  await walk();
  let localConfigText = null;
  try {
    const localPath = path.join(rootDir, 'config.local.json');
    if ((await lstat(localPath)).isSymbolicLink()) readErrors.push('local-symlink');
    else localConfigText = await readFile(localPath, 'utf8');
  } catch (error) { if (error.code !== 'ENOENT') readErrors.push('local-config'); }
  return inspectPackage({ files, entries, localConfigText, readErrors });
}

export function exitCode(report, strict = false) { return !report.codeReady ? 1 : strict && !report.accountConfigReady ? 2 : 0; }
export function formatReport(report) {
  const statusNames = { pass: '通过', error: '错误', pending: '缺项', manual: '待实测' };
  return ['抖音小游戏联调预检', ...report.checks.map(check => `[${statusNames[check.status]}] ${check.message}`), '', `代码准备：${report.codeReady ? '通过本地静态预检' : '未通过'}`, `账号配置：${report.accountConfigReady ? '已填写，待平台确认' : '仍有缺项'}`, '平台/真机：尚未由本脚本验证；严格模式也不能替代真机验收。'].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--strict', '--json'].includes(arg))) {
    console.error('用法：node tools/preflight.mjs [--strict] [--json]');
    process.exitCode = 1;
  } else {
    try {
      const report = await inspectProject();
      console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
      process.exitCode = exitCode(report, args.includes('--strict'));
    } catch {
      console.error('预检未完成：无法读取本地构建，请检查权限并重新运行 npm run build。');
      process.exitCode = 1;
    }
  }
}
