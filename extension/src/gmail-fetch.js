/**
 * Finds money-related emails in a Gmail inbox, in two passes:
 *  1. Gmail's own search with a wide phrase list (fast, precise wording).
 *  2. A sweep of the ~300 most recent emails using only subject, sender and
 *     the one-line preview (cheap "metadata" reads), filtered on this device
 *     for anything about trials, subscriptions, payments, renewals, offers or
 *     cancellations. This catches wording no phrase list predicts.
 * Only the emails picked by either pass are read in full. Shared by the web
 * app and the extension; `api(path)` is the authenticated Gmail call.
 */
import { gmailQuery, messageToText } from './core/mail.js';

const LOOKS_RELEVANT = new RegExp(
  [
    '\\btrial', 'subscri', '\\bmember(?:ship)?\\b', '\\brenew', '\\breceipt\\b', '\\binvoice\\b', '\\bbilling\\b',
    '\\bpayment\\b', '\\bcharged?\\b', '\\bdebited\\b', 'auto\\s?pay', '\\bmandate\\b', '\\bwelcome\\b',
    '\\b(?:your|the)\\s+(?:plan|account|instance|workspace|site|team|order)\\b', '\\bget(?:ting)?\\s+started\\b',
    '\\bactivat', '\\bexpir', '\\b\\d+\\s*(?:-\\s*)?days?\\b', '\\bpremium\\b', '\\bplus\\b', '\\bpro\\b',
    '\\bupgrade', '\\boffer\\b', '\\bdiscount', '\\bcoupon', '%\\s*off', '\\bcashback\\b', '\\bdeal\\b', '\\bsale\\b',
    '\\bcancel', '\\bthank(?:s|\\s+you)\\s+for\\s+(?:signing|joining|choosing|your)',
  ].join('|'),
  'i',
);
/** At most this many sweep matches are read in full per scan. */
const MAX_SWEEP_READS = 100;

const RECENT_QUERY = 'newer_than:60d -in:sent -in:chats -in:spam -in:trash';

/**
 * @param {(path: string) => Promise<any>} api
 * @param {{ seen: Set<string>, directory?: any[], maxRecent?: number, maxDirect?: number }} opts
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = /gmail-(?:429|5\d\d)|Failed to fetch|NetworkError|network/i;

/**
 * Gmail allows ~250 quota units per second per user (a message read costs 5),
 * so reads are paced and a "slow down" answer is retried with backoff instead
 * of failing the whole scan. Lost access ("expired", "scope-not-granted") is
 * never retried.
 */
function patient(api) {
  return async (path) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await api(path);
      } catch (err) {
        if (attempt >= 4 || !RETRYABLE.test(String(err?.message ?? err))) throw err;
        await wait(800 * 2 ** attempt + Math.random() * 400);
      }
    }
  };
}

export async function* gmailMoneyEmails(rawApi, { seen, directory = [], maxRecent = 300, maxDirect = 100, onProgress = () => {} }) {
  const api = patient(rawApi);
  const list = async (q, max) => {
    const out = [];
    let pageToken = '';
    while (out.length < max) {
      const r = await api(`/messages?maxResults=${Math.min(100, max - out.length)}&q=${encodeURIComponent(q)}${pageToken ? `&pageToken=${pageToken}` : ''}`);
      out.push(...(r.messages ?? []).map((m) => m.id));
      if (!r.nextPageToken) break;
      pageToken = r.nextPageToken;
    }
    return out;
  };

  const domains = [...new Set(directory.flatMap((e) => e.domains ?? []))];
  const picked = new Set(await list(gmailQuery(domains), maxDirect));
  const direct = picked.size;

  const recent = (await list(RECENT_QUERY, maxRecent)).filter((id) => !picked.has(id) && !seen.has(`gmail:${id}`));
  for (let i = 0; i < recent.length; i += 5) {
    onProgress({ phase: 'sweep', done: i, total: recent.length });
    if (i) await wait(150);
    const metas = await Promise.all(
      recent.slice(i, i + 5).map((id) =>
        api(`/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`).catch(() => null),
      ),
    );
    for (const m of metas) {
      if (!m) continue;
      const h = (n) => m.payload?.headers?.find((x) => String(x.name).toLowerCase() === n)?.value ?? '';
      if (picked.size - direct < MAX_SWEEP_READS && LOOKS_RELEVANT.test(`${h('subject')} ${h('from')} ${m.snippet ?? ''}`)) picked.add(m.id);
    }
  }

  // Read the picked emails a few at a time (still well under Gmail's limit).
  const todo = [...picked].filter((id) => !seen.has(`gmail:${id}`));
  let read = 0;
  let failedReads = 0;
  const fetchOne = async (id) => {
    try {
      return await api(`/messages/${id}?format=full`);
    } catch (err) {
      const why = String(err?.message ?? err);
      // Lost access stops the scan; anything else skips just this one email.
      if (!RETRYABLE.test(why) && !/^gmail-\d+$/.test(why)) throw err;
      if (++failedReads > 20 && failedReads > read) throw err;
      return null;
    }
  };
  for (let i = 0; i < todo.length; i += 4) {
    onProgress({ phase: 'read', done: i, total: todo.length });
    if (i) await wait(100);
    const batch = await Promise.all(todo.slice(i, i + 4).map(fetchOne));
    for (const msg of batch) {
      if (!msg) continue;
      read++;
      yield messageToText(msg);
    }
  }
  onProgress({ phase: 'done', done: todo.length, total: todo.length });
}
