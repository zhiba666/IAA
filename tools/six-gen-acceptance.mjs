import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { Game, CONFIG } = require('../src/core');
const { conserved } = require('./automation-balance.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = 1800000000000;
const copy = value => JSON.parse(JSON.stringify(value));
const STATIONS = ['pop', 'cup', 'ship'];
const SCOPE = 'six-generation-runtime-acceptance';

function checkedFixture(id, game, description, extra = {}) {
  conserved(game);
  const save = game.exportSave(NOW);
  const restored = new Game({ mode: 'v15', save, now: NOW });
  assert.equal(restored.loadWarning, null, id + ': validator accepts fixture');
  assert.deepEqual(restored.exportSave(NOW), save, id + ': restore preserves every account and job');
  return { id, mode: 'v15', storageKey: CONFIG.automation.saveKey,
    kind: 'natural-production', description, save, snapshot: restored.getView(), ...extra };
}

function move(game, source) {
  const claim = game.reserveTransfer(source);
  return claim.ok ? game.commitTransfer(claim.token) : claim;
}

// These fixtures use ordinary production, purchases and expansion. They are
// test input for the formal bundle, never shipping code or a replacement view.
export function createSixGenerationFixtures() {
  const game = new Game({ mode: 'v15', now: NOW });
  const cases = [checkedFixture('g1-entry', game, 'Fresh generation 1 before any purchase.', { configuration: 'entry' })];
  const seen = new Set(), transitions = [], batchTransitions = [];
  for (let step = 0; step < 12000 && seen.size < 6; step++) {
    game.tick(5);
    for (const source of ['pop', 'cup']) if (!game.state.connections[source].automated) move(game, source);
    if (game.state.upgrades.cup === 0) game.buyUpgrade('cup');
    else if (!game.state.connections.pop.automated) game.buyAutomation('pop');
    else if (!game.state.connections.cup.automated) game.buyAutomation('cup');
    else for (const id of ['cup', 'pop', 'ship']) {
      const station = game.getView().stations.find(item => item.id === id);
      const oldJobs = copy(game.state.stations[id].jobs);
      if (game.buyUpgrade(id).ok) {
        oldJobs.forEach((job, lane) => { if (job?.remainingTicks > 0) assert.deepEqual(game.state.stations[id].jobs[lane], job); });
        const updated = game.getView().stations.find(item => item.id === id);
        if (updated.batchSize !== station.batchSize && oldJobs.some(Boolean)) {
          const sample = checkedFixture('g' + (game.state.machine + 1) + '-' + id + '-old-batch', game,
            'A normal purchase preserves old in-flight amounts and durations; later jobs use the new batch size.',
            { configuration: 'old-batch', stationId: id, oldJobs, newBatchSize: updated.batchSize });
          cases.push(sample); batchTransitions.push(sample.id);
        }
      }
    }
    const view = game.getView();
    if (view.stations.every(station => !station.upgrade || station.upgrade.requiredMachine > game.state.machine || station.upgrade.reason === 'machine-required')) {
      const generation = game.state.machine + 1;
      if (!seen.has(generation)) {
        cases.push(checkedFixture('g' + generation + '-upgraded', game,
          'Every station upgrade currently unlocked in generation ' + generation + ' was purchased using actual sale income.',
          { configuration: 'upgraded' }));
        seen.add(generation);
      }
      const oldJobs = copy(game.state.stations);
      const before = game.state.machine;
      if (before < 5 && game.evolve().ok) {
        for (const id of STATIONS) oldJobs[id].jobs.forEach((job, lane) => {
          if (job?.remainingTicks > 0) assert.deepEqual(game.state.stations[id].jobs[lane], job);
        });
        transitions.push({ from: before + 1, to: game.state.machine + 1, retainedJobs: copy(oldJobs) });
        cases.push(checkedFixture('g' + (game.state.machine + 1) + '-entry', game,
          'Immediately after real expansion: earlier installed heads and in-flight jobs are retained.', { configuration: 'entry' }));
      }
    }
    conserved(game); game.drainEvents();
  }
  assert.equal(seen.size, 6, 'normal commands reach all six fully upgraded generations');
  for (let step = 0; game.getView().logisticsUpgrade && step < 12000; step++) {
    game.tick(5); game.buyLogisticsUpgrade(); conserved(game); game.drainEvents();
  }
  assert.equal(game.getView().logisticsUpgrade, null, 'normal sales fund all final logistics upgrades');
  cases.push(checkedFixture('g6-complete', game, 'All six-generation equipment and logistics upgrades purchased through normal sale income.', { configuration: 'complete' }));
  const firstTransfer = new Game({ mode: 'v15', now: NOW }); firstTransfer.tick(10);
  cases.push(checkedFixture('g1-first-tray', firstTransfer, 'First transfer offers exactly four actual portions.', { configuration: 'transfer-4' }));
  move(firstTransfer, 'pop'); firstTransfer.tick(3); move(firstTransfer, 'cup'); firstTransfer.tick(20);
  cases.push(checkedFixture('g1-regular-tray', firstTransfer, 'After tutorial transfer, regular tray offers up to 24 actual portions.', { configuration: 'transfer-24' }));
  for (let i = 0; i < 160; i++) { firstTransfer.tick(1); move(firstTransfer, 'pop'); move(firstTransfer, 'cup'); }
  assert.equal(firstTransfer.buyLogisticsUpgrade().ok, true);
  firstTransfer.tick(20);
  cases.push(checkedFixture('g1-expanded-tray', firstTransfer, 'Purchased logistics upgrade expands the tray and input to 36 portions.', { configuration: 'transfer-36' }));
  const original = cases.find(item => item.id === 'g1-expanded-tray');
  for (const [a, b] of [[false, false], [true, false], [false, true], [true, true]]) {
    const connected = new Game({ mode: 'v15', save: original.save, now: NOW });
    for (let i = 0; i < 800; i++) { connected.tick(1); move(connected, 'pop'); move(connected, 'cup'); }
    if (a) assert.equal(connected.buyAutomation('pop').ok, true);
    if (b) assert.equal(connected.buyAutomation('cup').ok, true);
    cases.push(checkedFixture('g1-connections-' + Number(a) + Number(b), connected, 'Actually purchased connection state A=' + a + ', B=' + b + '.', { configuration: 'connections' }));
  }
  // Boundary saves explicitly rebuild stock accounts; no invented money or
  // illegal jobs are accepted. These are NOT claimed as naturally reached play.
  const stateMatrix = [], warehouseMatrix = [];
  for (let generation = 1; generation <= 6; generation++) {
    const seed = cases.find(item => item.id === 'g' + generation + '-upgraded');
    for (const kind of ['waiting', 'running', 'blocked', 'mixed']) {
      const boundary = createBoundary(seed, kind);
      if (kind === 'mixed' && boundary.snapshot.stations.every(station => station.lanes === 1)) continue;
      cases.push(boundary);
    }
    for (const stationId of STATIONS) for (const status of ['waiting', 'running', 'blocked']) {
      const reachable = !(stationId === 'pop' && status === 'waiting' || stationId === 'ship' && status === 'blocked');
      stateMatrix.push({ generation, stationId, status, reachable, result: reachable ? 'VALIDATED_FIXTURE' : 'N/A',
        reason: !reachable ? stationId === 'pop' ? 'No raw-material purchasing or input-wait state exists.' : 'Completed shipping settles immediately; no downstream output bin exists.' : undefined,
        fixture: reachable ? 'g' + generation + '-boundary-' + status : null });
    }
    for (const id of ['pop', 'cup']) for (const amount of ['empty', 'one', 'half', 'full']) {
      const boundary = createBoundary(seed, 'warehouse', { id, amount }); cases.push(boundary);
      warehouseMatrix.push({ generation, warehouse: id, amount, fixture: boundary.id, actual: boundary.snapshot.buffers.find(item => item.id === id) });
    }
  }
  cases.push(createBoundary(cases.find(item => item.id === 'g1-entry'), 'input-full'));
  return { version: 1, scope: SCOPE, contractVersion: 'six-gen-art-1.0', generatedFrom: 'src/core.js',
    storagePolicy: 'Dedicated loopback acceptance origin only. Existing production browser/native storage is never read or replaced.',
    entryPolicy: 'Unchanged formal web/index.html + game.bundle.js; all hooks and fixtures are served from tools only.',
    deviceStatus: 'NOT_RUN', viewports: [{ width: 320, height: 524 }, { width: 390, height: 844 }],
    safeInsets: [0, 8, 24], cases, transitions, batchTransitions, stateMatrix, warehouseMatrix };
}

function createBoundary(seed, kind, stock = null) {
  const save = copy(seed.save), generation = save.machine + 1;
  const definitions = CONFIG.automation.stations;
  const capacity = new Game({ mode: 'v15', save, now: NOW }).getView().buffers[0].capacity;
  save.buffers = { pop: 0, cup: 0 }; save.inputs = { cup: 0, ship: 0 };
  for (const id of STATIONS) {
    const spec = definitions[id].levels[save.upgrades[id]];
    save.stations[id].history = [];
    save.stations[id].jobs = Array.from({ length: spec.lanes }, (_, lane) => {
      if (kind === 'waiting' && id !== 'pop' || kind === 'warehouse' || kind === 'input-full') return null;
      if (kind === 'mixed' && lane % 3 === 1) return null;
      return { amount: spec.batchSize, durationTicks: spec.cycleTicks,
        remainingTicks: kind === 'blocked' && id !== 'ship' || kind === 'mixed' && lane % 3 === 0 && id !== 'ship' ? 0 : Math.max(1, Math.round(spec.cycleTicks * (.25 + lane * .1))) };
    });
  }
  if (kind === 'blocked' || kind === 'mixed') save.buffers = { pop: capacity, cup: capacity };
  if (stock) save.buffers[stock.id] = stock.amount === 'empty' ? 0 : stock.amount === 'one' ? 1 : stock.amount === 'half' ? Math.floor(capacity / 2) : capacity;
  if (kind === 'input-full') { save.inputs.cup = 24; save.inputs.ship = 24; save.buffers.pop = 24; save.buffers.cup = 24; }
  const amount = id => save.stations[id].jobs.reduce((n, job) => n + (job?.amount || 0), 0);
  save.stations.ship.processed = save.totalSold;
  save.stations.cup.processed = save.totalSold + save.buffers.cup + save.inputs.ship + amount('ship');
  save.totalProduced = save.totalSold + save.buffers.pop + save.buffers.cup + save.inputs.cup + save.inputs.ship + STATIONS.reduce((n, id) => n + amount(id), 0);
  save.stations.pop.processed = save.totalProduced - amount('pop');
  for (const source of ['pop', 'cup']) {
    const target = source === 'pop' ? 'cup' : 'ship';
    save.connections[source].transferredAmount = save.inputs[target] + amount(target) + save.stations[target].processed;
  }
  const game = new Game({ mode: 'v15', save, now: NOW });
  assert.equal(game.loadWarning, null, 'valid conserved boundary ' + generation + '/' + kind);
  const id = 'g' + generation + '-boundary-' + (stock ? stock.id + '-' + stock.amount : kind);
  return checkedFixture(id, game, 'Explicit conserved boundary accepted by Game; not claimed as naturally reached play.',
    { kind: 'validated-boundary', configuration: kind, boundaryOnly: true });
}

export async function writeSixGenerationFixtures(directory = path.join(ROOT, 'output/six-gen-runtime/fixtures')) {
  const data = createSixGenerationFixtures(); await mkdir(directory, { recursive: true });
  for (const item of data.cases) await writeFile(path.join(directory, item.id + '.json'), JSON.stringify(item, null, 2) + '\n');
  await writeFile(path.join(directory, 'index.json'), JSON.stringify({ ...data, cases: data.cases.map(({ save, snapshot, ...item }) => item) }, null, 2) + '\n');
  return { directory, cases: data.cases.length };
}

const runtime = String.raw`(function(){
  const input=globalThis.__IAA_SIX_ACCEPTANCE_INPUT__,errors=[];
  if(!input||input.scope!=='six-generation-runtime-acceptance'||location.hostname!=='127.0.0.1')throw Error('Isolated acceptance origin required');
  globalThis.POPCORN_CONFIG={...globalThis.POPCORN_CONFIG,mode:'v15',experiment:null};
  localStorage.setItem(input.fixture.storageKey,JSON.stringify(input.fixture.save));
  for(const edge of ['top','bottom'])document.documentElement.style.setProperty('--safe-'+edge,input.safe+'px','important');
  let paused=input.paused,clock=0,previous=null,recorder=null,frames=[];
  const native=requestAnimationFrame.bind(globalThis);
  globalThis.requestAnimationFrame=callback=>native(now=>{if(previous!==null&&!paused){const elapsed=Math.max(0,now-previous);clock+=elapsed;frames.push(elapsed);if(frames.length>1800)frames.shift();}previous=now;callback(clock);});
  window.addEventListener('error',event=>errors.push({type:'error',message:event.message||'Resource failed',file:event.filename||event.target?.src||''}),true);
  window.addEventListener('unhandledrejection',event=>errors.push({type:'unhandledrejection',message:String(event.reason)}));
  function diagnostics(){return{scope:input.scope,commit:input.commit,contractVersion:input.contractVersion,checkerVersion:1,capturedAt:new Date().toISOString(),fixture:input.fixture.id,fixtureKind:input.fixture.kind,configuration:input.fixture.configuration,generation:input.fixture.save.machine+1,viewSize:{width:innerWidth,height:innerHeight},safeArea:{top:input.safe,bottom:input.safe},paused,qaClockMs:clock,assetShas:input.assetShas,snapshot:globalThis.__POPCORN__?.snapshot(),presentation:globalThis.__POPCORN__?.presentation?.(),errors:errors.slice(),frameTiming:{samples:frames.length,averageMs:frames.length?frames.reduce((a,b)=>a+b,0)/frames.length:null,p95Ms:frames.length?frames.slice().sort((a,b)=>a-b)[Math.floor(frames.length*.95)]:null},resources:performance.getEntriesByType('resource').map(e=>({name:e.name,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize,duration:e.duration})),deviceStatus:'NOT_RUN'};}
  function notify(message){parent.postMessage({type:'six-gen-status',message,diagnostics:diagnostics()},location.origin);}
  async function save(name,blob){const response=await fetch('/__six/capture/'+name,{method:'POST',headers:{'X-IAA-Acceptance':'runtime'},body:blob});if(!response.ok)throw Error('Capture failed '+response.status);return response.json();}
  async function capture(){await new Promise(resolve=>native(()=>native(resolve)));const canvas=document.querySelector('canvas');if(!canvas||!globalThis.__POPCORN__)throw Error('Formal bundle has not started');const name=[input.fixture.id,innerWidth+'x'+innerHeight,'safe'+input.safe,Date.now()].join('-');const data=diagnostics();await save(name+'.png',await new Promise(resolve=>canvas.toBlob(resolve,'image/png')));await save(name+'.json',new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));notify('PNG + 诊断已保存：'+name);}
  async function record(){if(recorder){recorder.stop();return;}const canvas=document.querySelector('canvas');const mime=['video/webm;codecs=vp9','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));const stream=canvas.captureStream(30),chunks=[],name=[input.fixture.id,innerWidth+'x'+innerHeight,'motion',Date.now()].join('-');const start=diagnostics();recorder=new MediaRecorder(stream,{mimeType:mime});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());recorder=null;await save(name+'.webm',new Blob(chunks,{type:mime}));await save(name+'.json',new Blob([JSON.stringify({start,end:diagnostics()},null,2)],{type:'application/json'}));notify('8秒录屏已保存：'+name);};recorder.start(250);setTimeout(()=>{if(recorder?.state==='recording')recorder.stop();},8000);notify('录屏中');}
  function command(action){if(action==='pause'){paused=!paused;notify(paused?'已暂停':'正在运行');}else if(action==='step'){if(paused)clock+=1000/120;notify('单步');}else if(action==='capture')capture().catch(e=>notify(e.message));else if(action==='record')record().catch(e=>notify(e.message));}
  window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===parent&&event.data?.type==='six-gen-command')command(event.data.action);});
  window.addEventListener('keydown',event=>{const action={KeyP:'capture',KeyR:'record',KeyT:'step',Space:'pause'}[event.code];if(action&&!event.repeat){event.preventDefault();event.stopImmediatePropagation();command(action);}},true);
  window.addEventListener('load',()=>notify('正式运行入口已加载；P截图 / R录屏 / 空格暂停'));
})();`;

function controls(fixtures, url) {
  const fixture = url.searchParams.get('fixture') || 'g6-upgraded';
  const width = url.searchParams.get('width') === '320' ? 320 : 390, height = width === 320 ? 524 : 844;
  const safe = [8, 24].includes(Number(url.searchParams.get('safe'))) ? Number(url.searchParams.get('safe')) : 0;
  const params = new URLSearchParams({ fixture, safe, pause: url.searchParams.get('pause') === '0' ? '0' : '1' });
  if (url.searchParams.get('fail') === '1') params.set('fail', '1');
  return `<!doctype html><meta charset="utf-8"><title>六代正式运行验收</title><style>body{margin:16px;background:#e5eadf;color:#253c30;font:14px system-ui}main{display:flex;align-items:flex-start;gap:20px}aside{width:340px}button,select{font:inherit;padding:8px;margin:3px 0}iframe{border:1px solid #66816c;background:white;flex:none}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}label{display:block;margin:8px 0}</style><h2>六代正式运行验收 · 独立本地存档</h2><main><iframe title="正式游戏" width="${width}" height="${height}" src="/game?${params}"></iframe><aside><form><label>状态 <select name="fixture">${fixtures.cases.map(item => `<option value="${item.id}"${item.id === fixture ? ' selected' : ''}>${item.id}</option>`).join('')}</select></label><label>视口 <select name="width"><option value="390"${width === 390 ? ' selected' : ''}>390 × 844</option><option value="320"${width === 320 ? ' selected' : ''}>320 × 524</option></select></label><label>上下安全区 <select name="safe">${[0, 8, 24].map(value => `<option${safe === value ? ' selected' : ''}>${value}</option>`).join('')}</select> px</label><label><input name="fail" value="1" type="checkbox"${url.searchParams.get('fail') === '1' ? ' checked' : ''}> 首次加载缺失一个六代机器资源（重试恢复）</label><button>加载选择状态</button></form><p>实际正式 bundle / 正式 Canvas。边界 fixture 单独标注；真机 NOT_RUN。</p><button data-action="pause">暂停 / 继续</button> <button data-action="step">单步 1 tick</button><br><button data-action="capture">保存 PNG + 诊断</button> <button data-action="record">录屏 8 秒</button><pre id="status">等待正式入口…</pre><details><summary>实时只读诊断</summary><pre id="diagnostics"></pre></details></aside></main><script>document.querySelectorAll('[data-action]').forEach(button=>button.onclick=()=>document.querySelector('iframe').contentWindow.postMessage({type:'six-gen-command',action:button.dataset.action},location.origin));window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.type==='six-gen-status'){document.getElementById('status').textContent=event.data.message;document.getElementById('diagnostics').textContent=JSON.stringify(event.data.diagnostics,null,2);}});</script>`;
}

export async function createSixGenerationAcceptanceServer(options = {}) {
  const fixtures = createSixGenerationFixtures(), byId = Object.fromEntries(fixtures.cases.map(item => [item.id, item]));
  const { ART_ASSETS } = require('../src/art-manifest');
  const assetShas = Object.fromEntries(Object.entries(ART_ASSETS).map(([id, value]) => [id, value.sha256]));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const output = options.output || path.join(ROOT, 'output/six-gen-runtime/runtime-captures');
  const requests = []; let failNextAsset = false;
  const server = http.createServer(async (req, res) => {
    const port = server.address()?.port, origin = `http://127.0.0.1:${port}`, url = new URL(req.url, origin);
    const send = (status, body, type = 'text/plain; charset=utf-8') => { requests.push({ at: new Date().toISOString(), path: req.url, status, bytes: Buffer.byteLength(body) }); res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
    try {
      if (req.method === 'POST' && url.pathname.startsWith('/__six/capture/')) {
        if (req.headers.origin !== origin || req.headers['x-iaa-acceptance'] !== 'runtime') return send(403, 'Same-origin runtime capture required');
        const name = url.pathname.slice('/__six/capture/'.length);
        if (!/^[a-zA-Z0-9_-]+\.(png|json|webm)$/.test(name)) return send(400, 'Invalid capture name');
        const chunks = []; let length = 0;
        for await (const chunk of req) { length += chunk.length; if (length > 80 * 1024 * 1024) return send(413, 'Capture too large'); chunks.push(chunk); }
        await mkdir(output, { recursive: true }); await writeFile(path.join(output, name), Buffer.concat(chunks));
        await writeFile(path.join(output, 'request-report.json'), JSON.stringify({ scope: SCOPE, requests }, null, 2) + '\n');
        return send(201, JSON.stringify({ saved: path.join(output, name), bytes: length }), 'application/json');
      }
      if (req.method !== 'GET') return send(405, 'GET required');
      if (url.pathname === '/') return send(200, controls(fixtures, url), 'text/html; charset=utf-8');
      if (url.pathname === '/__six/runtime.js') return send(200, runtime, 'text/javascript; charset=utf-8');
      if (url.pathname === '/__six/report') return send(200, JSON.stringify({ scope: SCOPE, requests }), 'application/json');
      if (url.pathname === '/favicon.ico') return send(204, '');
      const target = path.resolve(ROOT, 'web', '.' + (url.pathname === '/game' ? '/index.html' : decodeURIComponent(url.pathname)));
      if (!target.startsWith(path.join(ROOT, 'web') + path.sep)) return send(403, 'Outside formal web build');
      if (failNextAsset && /machine_cup_hex_body\.png$/.test(url.pathname)) { failNextAsset = false; return send(503, 'Acceptance-only first-load failure'); }
      let bytes = await readFile(target);
      if (url.pathname === '/game') {
        const item = byId[url.searchParams.get('fixture') || 'g6-upgraded']; if (!item) return send(400, 'Unknown fixture');
        failNextAsset = url.searchParams.get('fail') === '1';
        const safe = [8, 24].includes(Number(url.searchParams.get('safe'))) ? Number(url.searchParams.get('safe')) : 0;
        const input = JSON.stringify({ fixture: item, scope: SCOPE, commit, contractVersion: fixtures.contractVersion, assetShas, paused: url.searchParams.get('pause') !== '0', safe }).replace(/</g, '\\u003c');
        const html = bytes.toString('utf8');
        assert.ok(html.includes('<script src="game.bundle.js"></script>'));
        bytes = Buffer.from(html.replace('<script src="game.bundle.js"></script>', `<script>globalThis.__IAA_SIX_ACCEPTANCE_INPUT__=${input};</script><script src="/__six/runtime.js"></script><script src="game.bundle.js"></script>`));
      }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.wav': 'audio/wav' };
      send(200, bytes, types[path.extname(target)] || 'application/octet-stream');
    } catch (error) { send(error.code === 'ENOENT' ? 404 : 500, error.message); }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes('--serve')) {
    const flag = process.argv.indexOf('--port'), port = flag >= 0 ? Number(process.argv[flag + 1]) : 4196;
    const server = await createSixGenerationAcceptanceServer();
    server.listen(port, '127.0.0.1', () => console.log('Six-generation formal runtime acceptance: http://127.0.0.1:' + port + '/'));
  } else console.log(JSON.stringify(await writeSixGenerationFixtures(), null, 2));
}
