/**
 * Verifies every cancel URL in the directory against the live web.
 *
 * This exists because a dead link breaks the product's only promise, and hand
 * checking does not scale. Conservative by design:
 *   - 404 / 410            => verified:false  (link is genuinely gone)
 *   - 401/403/429/503      => left alone, reported as "blocked" (bot walls are
 *                             not evidence the link is dead)
 *   - 2xx / 3xx            => verified:true, lastVerifiedAt updated
 *
 * Usage: node scripts/verify-directory.mjs [--write]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(repo, 'directory/directory.json');
const write = process.argv.includes('--write');
const TIMEOUT_MS = 12_000;

const data = JSON.parse(await readFile(FILE, 'utf8'));
const today = new Date().toISOString().slice(0, 10);

/** @type {Array<{label: string, status: string, code?: number}>} */
const report = [];

for (const entry of data.entries) {
  const label = `${entry.name} (${entry.region})`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(entry.cancelUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; TrialExitLinkCheck/1.0)' },
    });
    clearTimeout(timer);

    if (res.status === 404 || res.status === 410) {
      entry.verified = false;
      entry.lastVerifiedAt = null;
      report.push({ label, status: 'dead', code: res.status });
    } else if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 503) {
      report.push({ label, status: 'blocked', code: res.status });
    } else if (res.ok || (res.status >= 300 && res.status < 400)) {
      entry.verified = true;
      entry.lastVerifiedAt = today;
      report.push({ label, status: 'ok', code: res.status });
    } else {
      report.push({ label, status: 'review', code: res.status });
    }
  } catch (err) {
    report.push({ label, status: 'unreachable', code: undefined });
  }
}

const ok = report.filter((r) => r.status === 'ok').length;
const blocked = report.filter((r) => r.status === 'blocked').length;
const dead = report.filter((r) => r.status === 'dead').length;
const other = report.length - ok - blocked - dead;

console.log(`\nchecked ${report.length} links: ${ok} ok · ${blocked} blocked · ${dead} dead · ${other} review\n`);
for (const r of report.filter((x) => x.status !== 'ok')) {
  console.log(`  ${r.status.padEnd(12)} ${r.code ?? '   '}  ${r.label}`);
}

if (write) {
  data.updatedAt = today;
  await writeFile(FILE, JSON.stringify(data, null, 2) + '\n');
  console.log('\ndirectory.json updated. Run `npm run sync` to vendor it into the extension.');
} else {
  console.log('\ndry run — pass --write to apply.');
}
