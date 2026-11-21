/**
 * Builds the extension zips.
 *   dist/trialexit-<v>-sideload.zip  manifest keeps "key" → fixed extension ID
 *                                    (mkkpnhiokdmpjlkapkhhiifpefgjegbp) for
 *                                    "Load unpacked" installs before store approval.
 *   dist/trialexit-<v>-store.zip     "key" removed (the Web Store rejects it). For
 *                                    the FIRST upload only, add .secrets/extension-key.pem
 *                                    as key.pem at the zip root so the store keeps the
 *                                    same ID — see SETUP.md.
 * Run: npm run package
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(repo, 'dist');
const manifest = JSON.parse(await readFile(join(repo, 'extension/manifest.json'), 'utf8'));
const v = manifest.version;
await mkdir(dist, { recursive: true });

async function zip(name, mutate) {
  const dir = await mkdtemp(join(tmpdir(), 'trialexit-'));
  await cp(join(repo, 'extension'), dir, { recursive: true });
  const m = structuredClone(manifest);
  mutate(m);
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  await rm(join(dist, name), { force: true });
  execFileSync('zip', ['-rq', join(dist, name), '.', '-x', '*.DS_Store'], { cwd: dir });
  await rm(dir, { recursive: true, force: true });
  console.log(`built dist/${name}`);
}

await zip(`trialexit-${v}-sideload.zip`, () => {});
await zip(`trialexit-${v}-store.zip`, (m) => delete m.key);
