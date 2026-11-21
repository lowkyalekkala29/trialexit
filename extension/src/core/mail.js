/**
 * Mail provider helpers (Gmail API + Microsoft Graph) — pure, so they are testable without a browser.
 * Email content is decoded and parsed on the user's device only.
 */

/**
 * Everything that might mark a trial or a new subscription. Deliberately
 * broad: the on-device classifier (classifyTrialEmail) drops ads afterwards.
 */
export const PHRASES = [
  // trial started / running
  'free trial', 'trial started', 'trial has started', 'trial has begun', 'trial is active', 'trial activated',
  'trial is ready', 'trial account', 'trial period', 'your trial', 'day trial', 'days free', 'month free',
  'first month free', 'free for 7 days', 'free for 14 days', 'free for 30 days', 'free for 1 month',
  // trial ending
  'trial ends', 'trial ending', 'trial expires', 'trial will expire', 'trial expiring', 'trial is ending',
  'trial is over', 'trial will end',
  // subscriptions & memberships
  'subscription confirmation', 'subscription confirmed', 'subscription activated', 'subscription started',
  'subscription is active', 'thanks for subscribing', 'thank you for subscribing', "you're subscribed",
  'you are subscribed', 'membership confirmation', 'membership activated', 'membership is active',
  'welcome to premium', 'welcome to plus', 'welcome to pro',
  // billing & renewal
  'will automatically renew', 'auto-renew', 'auto renew', 'renews on', 'will renew', 'renewal date',
  "you'll be charged", 'you will be charged', 'will be charged', 'next billing date', 'next payment',
  'billing date', 'first payment', 'payment method added', 'card added',
  // India: UPI AutoPay / e-mandates / standing instructions
  'autopay', 'auto pay', 'upi autopay', 'e-mandate', 'emandate', 'mandate registered', 'mandate created',
  'mandate approved', 'standing instruction', 'auto-debit', 'auto debit', 'autodebit', 'recurring payment',
  // app stores
  'google play order receipt', 'your google play order', 'apple subscription', 'your subscription to',
];

/** Microsoft Graph $search (KQL). Graph can't combine $search with a date filter. */
export const OUTLOOK_SEARCH = PHRASES.slice(0, 20).map((p) => `"${p.replace(/'/g, '')}"`).join(' OR ');

/** Search used both by the API scan and the "open Gmail search" fallback. */
/**
 * Gmail search: any email with "trial" in the subject (catches "Your TestRail
 * trial is ready", "Welcome to your Notion trial"…), plus confirmation phrases
 * that appear in bodies. The on-device classifier then drops ads.
 */
export const GMAIL_QUERY = gmailQuery();

/**
 * @param {string[]} [serviceDomains] mail from known subscription services is
 *   always worth a look (the classifier still drops their marketing)
 */
export function gmailQuery(serviceDomains = []) {
  const phrases = PHRASES.map((p) => `"${p}"`);
  const from = serviceDomains.map((d) => `from:${d}`);
  return `(subject:trial OR subject:subscription OR subject:membership OR ${[...phrases, ...from].join(' OR ')}) newer_than:60d -in:chats -in:sent`;
}

/** @param {string} data base64url */
export function decodeBase64Url(data) {
  const b64 = String(data ?? '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/** Crude but safe HTML → text: drop style/script, tags, decode common entities. */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8377;|&#x20b9;/gi, '₹')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

/**
 * Flattens a Gmail API message (format=full) into subject/from/date/text.
 * Prefers text/plain; falls back to text/html.
 * @param {any} msg
 */
export function messageToText(msg) {
  const headers = msg?.payload?.headers ?? [];
  const h = (name) => headers.find((x) => x.name?.toLowerCase() === name)?.value ?? '';
  let plain = '';
  let html = '';
  const walk = (part) => {
    if (!part) return;
    const data = part.body?.data;
    if (data && part.mimeType === 'text/plain' && !plain) plain = decodeBase64Url(data);
    if (data && part.mimeType === 'text/html' && !html) html = decodeBase64Url(data);
    for (const p of part.parts ?? []) walk(p);
  };
  walk(msg?.payload);
  const body = (plain || htmlToText(html) || msg?.snippet || '').slice(0, 20000);
  return {
    id: String(msg?.id ?? ''),
    subject: h('subject'),
    from: h('from'),
    date: msg?.internalDate ? new Date(Number(msg.internalDate)).toISOString() : '',
    text: `${h('subject')}\n${h('from')}\n${body}`,
  };
}

/**
 * Flattens a Microsoft Graph message (fetched with Prefer: outlook.body-content-type="text").
 * @param {any} msg
 */
export function outlookMessageToText(msg) {
  const from = msg?.from?.emailAddress ? `${msg.from.emailAddress.name ?? ''} <${msg.from.emailAddress.address ?? ''}>` : '';
  const raw = msg?.body?.content ?? msg?.bodyPreview ?? '';
  const body = (msg?.body?.contentType === 'html' ? htmlToText(raw) : String(raw)).slice(0, 20000);
  return {
    id: String(msg?.id ?? ''),
    subject: String(msg?.subject ?? ''),
    from,
    date: msg?.receivedDateTime ? new Date(msg.receivedDateTime).toISOString() : '',
    text: `${msg?.subject ?? ''}\n${from}\n${body}`,
  };
}
