/**
 * Deploys site/ (landing + web app) to Vercel as a static site.
 * Needs a Vercel token in VERCEL_TOKEN (in Claude cloud sessions the proxy
 * injects it). Run: npm run site && node scripts/deploy-vercel.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(repo, 'site');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const files = await Promise.all(
  (await walk(site)).map(async (p) => ({
    file: relative(site, p).split('\\').join('/'),
    data: (await readFile(p)).toString('base64'),
    encoding: 'base64',
  })),
);
files.push({
  file: 'vercel.json',
  data: Buffer.from(JSON.stringify({
    headers: [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }],
  })).toString('base64'),
  encoding: 'base64',
});

// curl, not fetch: it honours HTTPS_PROXY (Node's fetch does not).
const { writeFile, mkdtemp } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { execFileSync } = await import('node:child_process');
const body = join(await mkdtemp(join(tmpdir(), 'vercel-')), 'body.json');
await writeFile(body, JSON.stringify({ name: 'trialexit', files, target: 'production', projectSettings: { framework: null } }));
const raw = execFileSync('curl', [
  '-sS', '-X', 'POST', 'https://api.vercel.com/v13/deployments',
  '-H', 'content-type: application/json',
  '-H', `authorization: Bearer ${process.env.VERCEL_TOKEN ?? 'injected-by-proxy'}`,
  '--data-binary', `@${body}`,
], { maxBuffer: 1 << 26 }).toString();
const d = JSON.parse(raw);
if (d.error) {
  console.error('deploy failed', JSON.stringify(d.error).slice(0, 500));
  process.exit(1);
}
console.log(JSON.stringify({ id: d.id, url: `https://${d.url}`, aliases: d.alias ?? [], state: d.readyState }));
