/**
 * Vendors shared code into the extension package.
 * Chrome cannot import from outside the extension root, and we refuse to add a
 * bundler just to satisfy that. Copy-only: no transform, no build artifact to
 * debug. Run: node scripts/sync.mjs
 */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repo = join(root, '..');

await mkdir(join(repo, 'extension/src/core'), { recursive: true });
await mkdir(join(repo, 'extension/data'), { recursive: true });

for (const file of ['types.js', 'dates.js', 'ics.js', 'store.js', 'directory.js', 'alerts.js', 'guess.js', 'mail.js']) {
  await cp(join(repo, 'core/src', file), join(repo, 'extension/src/core', file));
}

await cp(join(repo, 'directory/directory.json'), join(repo, 'extension/data/directory.json'));

const manifestPath = join(repo, 'extension/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

// Auto-detect on every merchant in the directory, not a hand-kept subset.
const directory = JSON.parse(await readFile(join(repo, 'directory/directory.json'), 'utf8'));
// Whole-platform domains would run the detector on every search, inbox and shop page.
const TOO_BROAD = new Set(['google.com', 'amazon.com', 'amazon.in']);
const domains = [...new Set(directory.entries.flatMap((e) => e.domains ?? []))]
  .filter((d) => !TOO_BROAD.has(d))
  .sort();
manifest.content_scripts[0].matches = domains.map((d) => `https://*.${d}/*`);
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log('synced: core/*.js -> extension/src/core, directory.json -> extension/data');
