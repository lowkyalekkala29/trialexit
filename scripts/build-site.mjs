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
await cp(join(repo, 'landing/privacy.html'), join(out, 'privacy.html'));
await cp(join(repo, 'landing/terms.html'), join(out, 'terms.html'));
await cp(join(repo, 'landing/og.png'), join(out, 'og.png'));
await cp(join(repo, 'extension/icons'), join(out, 'icons'), { recursive: true });

for (const f of ['app.js', 'state.js', 'auth.js', 'cloud.js', 'config.js', 'view-auth.js', 'view-onboarding.js', 'view-home.js', 'view-account.js', 'web-mail.js', 'mail-candidates.js', 'licence.js', 'brand.js', 'ui.css']) {
  await cp(join(repo, 'extension/src', f), join(app, f));
}
await cp(join(repo, 'core/src'), join(app, 'core'), { recursive: true });
await cp(join(repo, 'web'), app, { recursive: true });
await cp(join(repo, 'extension/icons'), join(app, 'icons'), { recursive: true });
await mkdir(join(app, 'data'), { recursive: true });
await cp(join(repo, 'directory/directory.json'), join(app, 'data/directory.json'));

// Downloadable extension (sideload build) + install page.
{
  const { existsSync } = await import('node:fs');
  const { readFile: rf } = await import('node:fs/promises');
  const version = JSON.parse(await rf(join(repo, 'extension/manifest.json'), 'utf8')).version;
  const zip = join(repo, 'dist', `trialexit-${version}-sideload.zip`);
  if (existsSync(zip)) {
    await mkdir(join(out, 'downloads'), { recursive: true });
    await cp(zip, join(out, 'downloads', 'trialexit-extension.zip'));
  }
  const { writeFile: wf } = await import('node:fs/promises');
  await wf(join(out, 'install.html'), (await rf(join(repo, 'landing/install.html'), 'utf8')).replaceAll('{{VERSION}}', version));
}

// --preview: simulated sign-in (no backend), for design reviews and demos.
if (process.argv.includes('--preview')) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const cfg = join(app, 'config.js');
  const text = (await readFile(cfg, 'utf8'))
    .replace(/export const SUPABASE_URL = '[^']*';/, "export const SUPABASE_URL = '';")
    .replace(/export const SUPABASE_ANON_KEY = '[^']*';/, "export const SUPABASE_ANON_KEY = '';");
  await writeFile(cfg, text);
}

console.log(`built site/ — landing at /, web app at /app/${process.argv.includes('--preview') ? ' (preview mode)' : ''}`);
