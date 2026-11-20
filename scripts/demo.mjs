/**
 * Zero-dependency static server for the preview.
 * Chrome blocks `fetch` on file:// URLs, so the dashboard needs a real origin.
 *
 * Run: node scripts/demo.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir, cp } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

// The dashboard fetches `data/directory.json` relative to its own URL.
await mkdir(join(repo, 'demo/data'), { recursive: true });
await cp(join(repo, 'directory/directory.json'), join(repo, 'demo/data/directory.json'));

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // Redirect the root instead of serving the file at "/", otherwise every
  // relative URL (shim.js, data/directory.json) resolves against "/" and 404s.
  if (url.pathname === '/') {
    res.writeHead(302, { location: '/demo/preview.html' }).end();
    return;
  }

  const pathname = url.pathname;
  const filePath = join(repo, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));

  if (!filePath.startsWith(repo)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': TYPES[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${pathname}`);
  }
});

server.listen(PORT, () => {
  console.log(`TrialExit preview → http://localhost:${PORT}`);
  console.log('Ctrl-C to stop.');
});
