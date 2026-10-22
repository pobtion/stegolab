const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname);
const publicRoot = path.join(root, 'public');
const port = Number(process.env.PORT || 3000);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function isInside(candidate, base) {
  const relative = path.relative(base, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function serve(target, res) {
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(target).on('error', () => {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal server error');
  }).pipe(res);
}

function findFile(candidates, index, res) {
  if (index >= candidates.length) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  const candidate = candidates[index];
  fs.stat(candidate, (error, stat) => {
    if (!error && stat.isFile()) return serve(candidate, res);
    findFile(candidates, index + 1, res);
  });
}

const server = http.createServer((req, res) => {
  let requested;
  try { requested = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Invalid URL encoding'); }
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const candidates = requested === '/'
    ? [path.resolve(root, 'index.html')]
    : [path.resolve(root, relative), path.resolve(publicRoot, relative)];
  const safeCandidates = candidates.filter((candidate, index) => isInside(candidate, index === 0 ? root : publicRoot));
  if (!safeCandidates.length) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Forbidden'); }
  findFile(safeCandidates, 0, res);
});

server.listen(port, '0.0.0.0', () => console.log(`StegoLab listening on http://0.0.0.0:${port}`));
