'use strict';

// Read-only, loopback-only preview of project artifacts. No directory listings or hidden files.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = fs.realpathSync(path.resolve(__dirname, '../..'));
const port = Number(process.env.IAA_ART_PORT || process.argv[2] || 4174);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Expected a port from 1024 through 65535.');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
};
function fail(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  response.end(message + '\n');
}
const server = http.createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) return fail(response, 405, 'Read-only preview server');
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(request.headers.host)) return fail(response, 403, 'Loopback host required');
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname); }
  catch { return fail(response, 400, 'Invalid URL'); }
  if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some(segment => segment.startsWith('.'))) return fail(response, 403, 'Forbidden path');
  if (pathname === '/') pathname = '/art-source/v1.3-process/index.html';
  let file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep)) return fail(response, 403, 'Outside preview root');
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    file = fs.realpathSync(file);
    if (!file.startsWith(root + path.sep)) return fail(response, 403, 'Outside preview root');
    const stat = fs.statSync(file);
    if (!stat.isFile()) return fail(response, 404, 'Not found');
    const type = types[path.extname(file).toLowerCase()];
    if (!type) return fail(response, 403, 'File type is not served');
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
    if (request.method === 'HEAD') return response.end();
    const stream = fs.createReadStream(file);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  } catch { fail(response, 404, 'Not found'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Process-art preview: http://127.0.0.1:${port}/art-source/v1.3-process/`));
