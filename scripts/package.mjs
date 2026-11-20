/**
 * Builds the Chrome Web Store upload artifact.
 * Run: node scripts/package.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(repo, 'dist');
const manifest = JSON.parse(await readFile(join(repo, 'extension/manifest.json'), 'utf8'));
const name = `trialexit-${manifest.version}.zip`;

await mkdir(dist, { recursive: true });
await rm(join(dist, name), { force: true });

execFileSync('zip', ['-rq', join(dist, name), '.', '-x', '*.DS_Store'], {
  cwd: join(repo, 'extension'),
});

console.log(`built dist/${name} (v${manifest.version}) — upload this at chrome.google.com/webstore/devconsole`);
