/**
 * Builds the static website: landing page at `/`, web app at `/app/`.
 * The web app reuses the extension's dashboard and core logic verbatim; only
 * the platform adapter (web/platform.js) differs.
 *
 * Run: node scripts/build-site.mjs   → output in site/
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(repo, 'site');
const app = join(out, 'app');

await rm(out, { recursive: true, force: true });
await mkdir(join(app, 'core'), { recursive: true });

await cp(join(repo, 'landing/index.html'), join(out, 'index.html'));
await cp(join(repo, 'PRIVACY.md'), join(out, 'privacy.md'));
await cp(join(repo, 'extension/icons'), join(out, 'icons'), { recursive: true });

for (const f of ['dashboard.js', 'licence.js', 'brand.js', 'ui.css']) {
  await cp(join(repo, 'extension/src', f), join(app, f));
}
await cp(join(repo, 'core/src'), join(app, 'core'), { recursive: true });
await cp(join(repo, 'web'), app, { recursive: true });
await cp(join(repo, 'extension/icons'), join(app, 'icons'), { recursive: true });
await mkdir(join(app, 'data'), { recursive: true });
await cp(join(repo, 'directory/directory.json'), join(app, 'data/directory.json'));

console.log('built site/ — landing at /, web app at /app/');
