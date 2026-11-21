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

for (const file of ['types.js', 'dates.js', 'ics.js', 'store.js', 'directory.js', 'alerts.js', 'guess.js', 'mail.js', 'activation.js', 'sync.js', 'reminders.js', 'money.js']) {
  await cp(join(repo, 'core/src', file), join(repo, 'extension/src/core', file));
}

await cp(join(repo, 'directory/directory.json'), join(repo, 'extension/data/directory.json'));

// Edge functions import the same core logic, so the server and the extension
// can never disagree about when a nudge is due.
await mkdir(join(repo, 'supabase/functions/_shared'), { recursive: true });
for (const file of ['dates.js', 'alerts.js', 'store.js', 'reminders.js', 'signing.js', 'email.js', 'money.js']) {
  await cp(join(repo, 'core/src', file), join(repo, 'supabase/functions/_shared', file));
}

const manifestPath = join(repo, 'extension/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

// Detection runs on every site (see extension/src/detect.js for the cost/privacy rules).
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log('synced: core/*.js -> extension/src/core, directory.json -> extension/data');
