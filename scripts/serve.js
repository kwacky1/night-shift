// Tiny static server for local dev. The game itself needs no build step.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// SERVE_ROOT serves another folder, e.g. the itch.io build in dist/html.
const root = resolve(process.env.SERVE_ROOT || fileURLToPath(new URL('../game/', import.meta.url)));
const port = Number(process.env.PORT) || 8080;
// no-store on everything, so a plain refresh always picks up edited ES modules.
const noStore = { 'Cache-Control': 'no-store' };
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const filePath = normalize(join(root, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath));
  if (!filePath.startsWith(root)) {
    res.writeHead(403, noStore).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { ...noStore, 'Content-Type': types[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, noStore).end('Not found');
  }
}).listen(port, () => console.log(`NIGHT_SHIFT.EXE running at http://localhost:${port}/`));
