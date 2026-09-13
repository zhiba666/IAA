import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createVisualFixtures } from './visual-acceptance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const OUTPUT = path.join(ROOT, 'output/gen1-art-runtime/runtime-captures');
const AUTOMATION_OUTPUT = path.join(ROOT, 'artifacts/v15');
const PORT = Number(process.env.IAA_ACCEPTANCE_PORT || 4192);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.webm': 'video/webm' };
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');

// An acceptance-only origin serves the unchanged formal index/bundle/art. It
// adds keyboard-operated capture support, not an alternate game or renderer.
export function createAcceptanceServer() {
  const fixtures = createVisualFixtures(), requests = [];
  const fixtureMap = Object.fromEntries(fixtures.cases.map(item => [item.id, item]));
  const server = http.createServer(async (req, res) => {
    let status = 500, size = 0;
    function send(code, body, type = 'text/plain; charset=utf-8') {
      status = code; size = Buffer.byteLength(body);
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body);
    }
    res.on('finish', () => requests.push({ at: new Date().toISOString(), method: req.method, path: req.url, status, bytes: size }));
    try {
      const port = server.address()?.port || PORT;
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (req.method === 'POST' && url.pathname.startsWith('/__acceptance/capture/')) {
        if (req.headers.origin !== `http://127.0.0.1:${port}` || req.headers['x-iaa-acceptance'] !== 'runtime') {
          send(403, 'Only the isolated local acceptance page may write a capture.'); return;
        }
        const name = decodeURIComponent(url.pathname.slice('/__acceptance/capture/'.length));
        if (!/^[a-zA-Z0-9_-]+\.(png|webm|json)$/.test(name)) { send(400, 'Invalid capture filename'); return; }
        const chunks = []; let count = 0;
        for await (const chunk of req) {
          count += chunk.length;
          if (count > 80 * 1024 * 1024) { send(413, 'Capture too large'); return; }
          chunks.push(chunk);
        }
        const captureOutput = name.startsWith('v15-') ? AUTOMATION_OUTPUT : OUTPUT;
        await mkdir(captureOutput, { recursive: true });
        await writeFile(path.join(captureOutput, name), Buffer.concat(chunks));
        await writeFile(path.join(captureOutput, 'request-report.json'), JSON.stringify({ scope: fixtures.scope, requests }, null, 2) + '\n');
        send(201, JSON.stringify({ saved: path.join(captureOutput, name), bytes: count }), types['.json']); return;
      }
      if (req.method !== 'GET') { send(405, 'GET required'); return; }
      if (url.pathname === '/__acceptance/report') {
        send(200, JSON.stringify({ scope: fixtures.scope, requests }), types['.json']); return;
      }
      if (url.pathname === '/__acceptance/runtime.js') {
        send(200, await readFile(path.join(ROOT, 'tools/acceptance-runtime.js')), types['.js']); return;
      }
      if (url.pathname === '/favicon.ico') { status = 204; res.writeHead(204); res.end(); return; }
      const target = path.resolve(WEB, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!target.startsWith(WEB + path.sep)) { send(403, 'Path outside formal web build'); return; }
      let data = await readFile(target);
      if (target === path.join(WEB, 'index.html')) {
        const requestedMode = url.searchParams.get('mode');
        const historicalMode = requestedMode === 'legacy-v15' ? 'v15' : requestedMode;
        const name = url.searchParams.get('fixture') || (historicalMode === 'v15' ? 'v15-fresh' : 'fresh-shortage');
        const fixture = fixtureMap[name];
        if (!fixture) { send(400, 'Unknown fixture; use ' + Object.keys(fixtureMap).join(', ')); return; }
        if (url.searchParams.has('experiment') || historicalMode && historicalMode !== fixture.mode) {
          send(400, 'Fixture ' + fixture.id + ' requires mode=' + (fixture.mode === 'v15' ? 'legacy-v15' : 'baseline') + ' without an experiment parameter.'); return;
        }
        const input = { fixture, scope: fixtures.scope, mode: fixture.mode, storageKey: fixture.storageKey, port,
          paused: url.searchParams.get('pause') === '1', safe: url.searchParams.get('safe') === '1' };
        const inject = `<script>globalThis.__IAA_ACCEPTANCE_INPUT__=${json(input)};</script>\n  <script src="/__acceptance/runtime.js"></script>\n  `;
        const html = data.toString('utf8');
        if (!html.includes('<script src="game.bundle.js"></script>')) throw new Error('Formal entry bundle marker changed');
        data = Buffer.from(html.replace('<script src="game.bundle.js"></script>', inject + '<script src="game.bundle.js"></script>'));
      }
      send(200, data, types[path.extname(target)] || 'application/octet-stream');
    } catch (error) { send(error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not found' : error.message); }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  createAcceptanceServer().listen(PORT, '127.0.0.1', () => {
    console.log(`Formal game acceptance: http://127.0.0.1:${PORT}/?fixture=first-cup-before&pause=1`);
    console.log(`V1.5 purchase acceptance: http://127.0.0.1:${PORT}/?mode=legacy-v15&fixture=v15-purchase-ready&pause=1`);
    console.log('Keys: P save PNG + diagnostics; R record 8 s WebM; Space pause/resume; T advance one real simulation tick while paused.');
    console.log(`Capture files: ${OUTPUT}`);
    console.log(`V1.5 capture files: ${AUTOMATION_OUTPUT}`);
  });
}
