/**
 * Fails the build when a relative import points at a file that does not exist.
 *
 * This exists because a path mismatch between `sync` and the imports shipped a
 * build where nothing loaded: Chrome does not warn, the UI just stays blank.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['extension/src', 'core/src'];
const IMPORT_RE = /(?:^|\s)(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]/g;

/** @type {string[]} */
const problems = [];
let checked = 0;

async function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

for (const root of ROOTS) {
  let files;
  try {
    files = await walk(join(repo, root));
  } catch {
    problems.push(`missing directory: ${root}`);
    continue;
  }

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(IMPORT_RE)) {
      checked++;
      const target = resolve(dirname(file), match[1]);
      try {
        await stat(target);
      } catch {
        problems.push(`${file.replace(repo + '/', '')} imports missing ${match[1]}`);
      }
    }
  }
}

if (problems.length) {
  console.error(`import check failed (${problems.length}):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`imports ok (${checked} relative imports resolved)`);
