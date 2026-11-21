/**
 * Email → trial suggestions. No browser-extension APIs here, so the web app
 * can use it too. Email content is only ever handled in memory, on the device.
 */
import { parseTrialEmail, classifyTrialEmail } from './core/guess.js';

/** Bump when the rules change: older suggestions are discarded and re-scanned. */
export const CANDIDATE_VERSION = 6;

/** "Netflix <info@mailer.netflix.com>" → "Netflix" */
export function senderName(from) {
  const m = String(from ?? '').match(/^\s*"?([^"<]+?)"?\s*</);
  if (m?.[1]?.trim()) return m[1].trim();
  return String(from ?? '').split('@')[1]?.split('.').slice(-2, -1)[0] ?? 'Unknown service';
}

/**
 * Turns a stream of emails into trial suggestions: parse, drop noise and
 * already-tracked services, keep the newest email per service. Shared by the
 * extension (background) and the web app (browser) — the only difference
 * between them is how the emails are fetched.
 */
/** Trials run days or weeks; a "renewal" months away is a yearly plan or a misread date. */
const MAX_TRIAL_AHEAD_DAYS = 100;

/** "Name <a@b.com>" → "a@b.com" */
const addressOf = (from) => (String(from ?? '').match(/<([^>]+)>/)?.[1] ?? String(from ?? '')).trim().toLowerCase();

/**
 * @param {string} provider
 * @param {AsyncIterable<{id:string,subject:string,from:string,date:string,text:string}>} messages
 * @param {{ directory: any[], trials: any[], ownEmail?: string|null, ownName?: string|null }} opts
 */
/** Plain-language reasons shown in "What did the scan check?". */
export const VERDICTS = {
  found: 'Found — ready to track',
  'from-you': 'Sent by you',
  ad: 'Looks like an ad',
  'no-signal': 'No sign you started a trial',
  'no-details': 'No service or date we could read',
  ended: 'Trial already ended',
  'too-far': 'Renewal too far away to be a trial',
  'person-name': 'Sender is a person, not a service',
  tracked: 'Already tracking this',
  duplicate: 'Same service as another email',
};

export async function collectCandidates(provider, messages, { directory, trials, ownEmail = null, ownName = null }) {
  const found = new Map();
  /** Every email checked, with the reason it was kept or skipped (stays on the device). */
  const report = [];
  let scanned = 0;
  const me = String(ownEmail ?? '').toLowerCase();
  const myName = String(ownName ?? '').trim().toLowerCase();
  for await (const mail of messages) {
    scanned++;
    const received = mail.date ? new Date(mail.date) : new Date();
    const parsed = parseTrialEmail(mail.text, directory, received);
    const name = parsed.serviceName ?? senderName(mail.from);
    const entry = {
      messageId: `${provider}:${mail.id}`,
      provider,
      account: ownEmail ?? null,
      subject: mail.subject,
      from: mail.from,
      receivedAt: mail.date,
      serviceId: parsed.entry?.serviceId ?? null,
      region: parsed.entry?.region ?? null,
      serviceName: name,
      renewsOn: parsed.renewsOn,
      renewalMatched: parsed.renewalMatched,
      amount: parsed.price?.amount ?? null,
      currency: parsed.price?.currency ?? null,
      trialLengthDays: parsed.days?.days ?? null,
      verdict: 'found',
    };
    report.push(entry);
    const skip = (why) => {
      entry.verdict = why;
    };
    // Emails the user sent or forwarded to themselves are not trial confirmations.
    if (me && addressOf(mail.from) === me) { skip('from-you'); continue; }
    // Only emails confirming a trial the user started — not "Try Premium free" ads.
    const { kind } = classifyTrialEmail(mail.text);
    if (kind === 'promo') { skip('ad'); continue; }
    if (kind === 'unknown' && !parsed.renewalMatched) { skip('no-signal'); continue; }
    if (!parsed.entry && !parsed.renewalMatched && !parsed.days) { skip('no-details'); continue; }
    if (parsed.renewsOn && Date.parse(parsed.renewsOn) < Date.now() - 3 * 864e5) { skip('ended'); continue; }
    if (parsed.renewsOn && Date.parse(parsed.renewsOn) - received.getTime() > MAX_TRIAL_AHEAD_DAYS * 864e5) { skip('too-far'); continue; }
    // A person's name (e.g. the user's own) is never a service.
    if (!parsed.entry && myName && String(name).trim().toLowerCase() === myName) { skip('person-name'); continue; }
    const tracked = trials.some(
      (t) =>
        (t.serviceId === parsed.entry?.serviceId || t.serviceName.toLowerCase() === String(name).toLowerCase()) &&
        ['active', 'awaiting_confirmation'].includes(t.status),
    );
    if (tracked) { skip('tracked'); continue; }
    const key = (parsed.entry?.serviceId ?? name).toLowerCase();
    if (found.has(key)) { skip('duplicate'); continue; } // newest email first; keep it
    const { verdict, account, ...candidate } = entry;
    found.set(key, { v: CANDIDATE_VERSION, ...candidate });
  }
  return { candidates: [...found.values()], scanned, report };
}

