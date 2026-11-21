/**
 * Email → trial suggestions. No browser-extension APIs here, so the web app
 * can use it too. Email content is only ever handled in memory, on the device.
 */
import { parseTrialEmail, classifyTrialEmail } from './core/guess.js';

/** Bump when the rules change: older suggestions are discarded and re-scanned. */
export const CANDIDATE_VERSION = 2;

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
 * @param {string} provider
 * @param {AsyncIterable<{id:string,subject:string,from:string,date:string,text:string}>} messages
 * @param {{ directory: any[], trials: any[] }} opts
 */
export async function collectCandidates(provider, messages, { directory, trials }) {
  const found = new Map();
  let scanned = 0;
  for await (const mail of messages) {
    scanned++;
    // Only emails confirming a trial the user started — not "Try Premium free" ads.
    const { kind } = classifyTrialEmail(mail.text);
    if (kind === 'promo') continue;
    // Count trial length from the day the email arrived, not from today.
    const received = mail.date ? new Date(mail.date) : new Date();
    const parsed = parseTrialEmail(mail.text, directory, received);
    if (kind === 'unknown' && !parsed.renewalMatched) continue;
    if (!parsed.entry && !parsed.renewalMatched && !parsed.days) continue;
    if (parsed.renewsOn && Date.parse(parsed.renewsOn) < Date.now() - 3 * 864e5) continue;
    const name = parsed.serviceName ?? senderName(mail.from);
    const tracked = trials.some(
      (t) =>
        (t.serviceId === parsed.entry?.serviceId || t.serviceName.toLowerCase() === String(name).toLowerCase()) &&
        ['active', 'awaiting_confirmation'].includes(t.status),
    );
    if (tracked) continue;
    const key = (parsed.entry?.serviceId ?? name).toLowerCase();
    if (found.has(key)) continue; // newest email first; keep it
    found.set(key, {
      v: CANDIDATE_VERSION,
      messageId: `${provider}:${mail.id}`,
      provider,
      from: mail.from,
      subject: mail.subject,
      receivedAt: mail.date,
      serviceId: parsed.entry?.serviceId ?? null,
      region: parsed.entry?.region ?? null,
      serviceName: name,
      renewsOn: parsed.renewsOn,
      renewalMatched: parsed.renewalMatched,
      amount: parsed.price?.amount ?? null,
      currency: parsed.price?.currency ?? null,
      trialLengthDays: parsed.days?.days ?? null,
    });
  }
  return { candidates: [...found.values()], scanned };
}

