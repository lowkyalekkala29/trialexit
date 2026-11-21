/**
 * Heuristic extraction from checkout page text.
 *
 * Design rule: every value produced here is a GUESS that the user sees and
 * corrects before anything is saved. Confidence is part of the return value so
 * the UI can say "we read 14 days" instead of pretending to know.
 *
 * Hard-won detail: "30-day money-back guarantee" is not a trial. Refund and
 * warranty clauses must be rejected, or the product confidently lies.
 */

const REFUND_CLAUSE =
  /money[-\s]?back|refund|guarantee|warranty|notice\s+period|days?\s+to\s+cancel|return\s+policy/i;

const MAX_TRIAL_DAYS = 120;

/**
 * @param {string} text
 * @param {number} index
 * @param {number} [radius]
 * @returns {string}
 */
function clauseAround(text, index, radius = 130) {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius));
}

/** @typedef {'high'|'medium'|'low'} Confidence */

/**
 * @typedef {Object} DayGuess
 * @property {number} days
 * @property {Confidence} confidence
 * @property {string} matched  the phrase we keyed on, for display
 */

/** Ordered most-specific first. Multipliers convert weeks/months to days. */
const DAY_PATTERNS = [
  { re: /(\d{1,3})[\s-]*day(?:s)?\s+(?:free\s+)?(?:trial|free|on\s+us|risk[-\s]?free)/i, conf: /** @type {Confidence} */ ('high'), mult: 1 },
  { re: /(?:free\s+)?trial[^.\n]{0,40}?(\d{1,3})\s*[- ]?day(?:s)?/i, conf: /** @type {Confidence} */ ('high'), mult: 1 },
  { re: /(\d{1,3})[-\s]?days?[^.\n]{0,25}(?:free|on\s+us)/i, conf: /** @type {Confidence} */ ('medium'), mult: 1 },
  { re: /first\s+(\d{1,3})\s+days/i, conf: /** @type {Confidence} */ ('medium'), mult: 1 },
  { re: /(\d{1,2})[-\s]?weeks?[^.\n]{0,25}(?:free|trial|on\s+us)/i, conf: /** @type {Confidence} */ ('high'), mult: 7 },
  { re: /(\d{1,2})[-\s]?(?:month|mo)s?[^.\n]{0,25}(?:free|trial|on\s+us)/i, conf: /** @type {Confidence} */ ('low'), mult: 30 },
];

/**
 * @param {string} text
 * @returns {DayGuess | null}
 */
export function extractTrialDays(text) {
  const haystack = String(text ?? '');
  if (!haystack) return null;

  for (const pattern of DAY_PATTERNS) {
    const m = pattern.re.exec(haystack);
    if (!m) continue;

    // Reject only when the refund wording belongs to THIS phrase
    // ("30-day money-back guarantee"), not when it merely appears nearby.
    // A page can legitimately advertise a trial and a refund policy.
    const immediatelyAfter = haystack.slice(m.index + m[0].length, m.index + m[0].length + 12);
    if (REFUND_CLAUSE.test(m[0]) || REFUND_CLAUSE.test(immediatelyAfter)) continue;

    const days = Number(m[1]) * pattern.mult;
    if (!Number.isFinite(days) || days < 1 || days > MAX_TRIAL_DAYS) continue;

    return {
      days,
      // A refund clause elsewhere on the page means we should be humbler.
      confidence: REFUND_CLAUSE.test(haystack) ? 'low' : pattern.conf,
      matched: m[0].replace(/\s+/g, ' ').trim(),
    };
  }
  return null;
}

/**
 * @typedef {Object} PriceGuess
 * @property {number} amount    major units, e.g. 1675
 * @property {'INR'|'USD'|null} currency
 * @property {Confidence} confidence
 * @property {string} matched
 */

const PRICE_PATTERNS = [
  {
    re: /(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d{1,2})?)\s*(?:\/|per\s*)\s*(?:mo|month|monthly)/i,
    currency: /** @type {const} */ ('INR'),
    conf: /** @type {Confidence} */ ('high'),
  },
  {
    re: /\$\s?([\d,]+(?:\.\d{1,2})?)\s*(?:\/|per\s*)\s*(?:mo|month|monthly)/i,
    currency: /** @type {const} */ ('USD'),
    conf: /** @type {Confidence} */ ('high'),
  },
  {
    re: /then\s*(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d{1,2})?)/i,
    currency: /** @type {const} */ ('INR'),
    conf: /** @type {Confidence} */ ('high'),
  },
  {
    re: /then\s*\$\s?([\d,]+(?:\.\d{1,2})?)/i,
    currency: /** @type {const} */ ('USD'),
    conf: /** @type {Confidence} */ ('high'),
  },
  {
    re: /(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d{1,2})?)/i,
    currency: /** @type {const} */ ('INR'),
    conf: /** @type {Confidence} */ ('low'),
  },
  {
    re: /\$\s?([\d,]+(?:\.\d{1,2})?)/i,
    currency: /** @type {const} */ ('USD'),
    conf: /** @type {Confidence} */ ('low'),
  },
];

/**
 * @param {string} text
 * @returns {PriceGuess | null}
 */
export function extractPrice(text) {
  const haystack = String(text ?? '');
  for (const pattern of PRICE_PATTERNS) {
    const m = pattern.re.exec(haystack);
    if (!m) continue;
    const amount = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    return {
      amount,
      currency: pattern.currency,
      confidence: pattern.conf,
      matched: m[0].replace(/\s+/g, ' ').trim(),
    };
  }
  return null;
}

const POST_SIGNUP_TEXT =
  /you'?re\s+all\s+set|subscription\s+is\s+active|you'?re\s+subscribed|payment\s+successful|your\s+plan\s+is\s+active|trial\s+(?:has\s+)?started|enjoy\s+your\s+(?:free\s+)?trial|welcome\s+to\s+[A-Z]/i;

const POST_SIGNUP_PATH = /\/(?:welcome|success|thank-?you|confirmed|getting-started|onboarding\/?complete)\b/i;

const PRICING_TEXT = /free\s+trial|start\s+(?:your\s+)?free|try\s+(?:it\s+)?free|\d+[-\s]?day\s+free/i;

/**
 * Where in the funnel does this page sit? Prompting on a pricing page is a
 * different offer than prompting after signup.
 * @param {string} text
 * @param {string} url
 * @returns {'post-signup'|'pricing'|'unknown'}
 */
export function detectPhase(text, url) {
  const haystack = String(text ?? '');
  const path = String(url ?? '');
  if (POST_SIGNUP_PATH.test(path) || POST_SIGNUP_TEXT.test(haystack)) return 'post-signup';
  if (PRICING_TEXT.test(haystack)) return 'pricing';
  return 'unknown';
}

/**
 * Renewal instant if the trial started now and runs for `days`.
 * @param {Date} now
 * @param {number} days
 * @returns {string} ISO instant
 */
export function deriveRenewal(now, days) {
  const ms = Math.max(1, Number(days) || 0) * 86_400_000;
  return new Date(now.getTime() + ms).toISOString();
}

/**
 * Human sentence used in the UI so the guess is never silent.
 * @param {{ days?: DayGuess|null, price?: PriceGuess|null, phase?: string }} guess
 * @returns {string}
 */
export function derivationNote(guess) {
  const bits = [];
  if (guess.days) bits.push(`${guess.days.days}-day trial`);
  if (guess.price) {
    const currency = guess.price.currency === 'USD' ? '$' : guess.price.currency === 'INR' ? '₹' : '';
    bits.push(`${currency}${guess.price.amount}`);
  }
  if (!bits.length) return 'Nothing readable on this page — fill it in manually.';
  const phase =
    guess.phase === 'post-signup'
      ? 'Read from the confirmation page'
      : guess.phase === 'pricing'
        ? 'Read from the pricing page, before signup'
        : 'Read from this page';
  return `${phase}: we guessed ${bits.join(' and ')}. Correct anything that is wrong.`;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const RENEWAL_CUE =
  /(renew|charg|bill|trial\s+(?:ends?|expires?)|ends?\s+on|expires?|until|starting|first\s+payment|next\s+payment|auto[-\s]?pay|debit)/i;

/** "December 5, 2026", "Dec 5", "5 December 2026", "5th Dec", "2026-12-05", "05/12/2026" */
const DATE_PATTERNS = [
  { re: new RegExp(`${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})?`, 'gi'), order: 'mdy' },
  { re: new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?,?\\s*(\\d{4})?`, 'gi'), order: 'dmy' },
  { re: /(\d{4})-(\d{2})-(\d{2})/g, order: 'iso' },
  { re: /(\d{1,2})\/(\d{1,2})\/(\d{4})/g, order: 'slash' },
];

/**
 * Finds the renewal/charge date in a confirmation email or receipt.
 * Only dates near a renewal cue ("renews on", "you'll be charged", "trial ends")
 * count — receipts are full of order dates that must not be mistaken for it.
 *
 * @param {string} text
 * @param {Date} [now]  resolves dates written without a year
 * @param {'dmy'|'mdy'} [slashOrder]  how to read 05/12/2026 (India: dmy)
 * @returns {{ date: string, matched: string } | null}  date as YYYY-MM-DD
 */
export function extractRenewalDate(text, now = new Date(), slashOrder = 'dmy') {
  const src = String(text ?? '');
  /** @type {{ date: string, matched: string, score: number }[]} */
  const found = [];
  for (const { re, order } of DATE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      let y, mo, d;
      if (order === 'mdy') [mo, d, y] = [MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), +m[2], m[3]];
      else if (order === 'dmy') [d, mo, y] = [+m[1], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), m[3]];
      else if (order === 'iso') [y, mo, d] = [m[1], +m[2] - 1, +m[3]];
      else if (slashOrder === 'mdy') [mo, d, y] = [+m[1] - 1, +m[2], m[3]];
      else [d, mo, y] = [+m[1], +m[2] - 1, m[3]];
      if (mo < 0 || mo > 11 || d < 1 || d > 31) continue;
      let year = y ? +y : now.getFullYear();
      let candidate = new Date(Date.UTC(year, mo, d));
      // "Dec 5" with no year, written in late December, means next year.
      // No year written and the date already passed: only roll into next year
      // across New Year (e.g. "3 Jan" read in late December). Otherwise it's a
      // past date — a trial that already ended, not one 300 days away.
      if (!y && candidate.getTime() < now.getTime() - 86_400_000) {
        const next = new Date(Date.UTC(year + 1, mo, d));
        if (next.getTime() - now.getTime() < 75 * 86_400_000) candidate = next;
      }
      const before = src.slice(Math.max(0, m.index - 90), m.index);
      const cue = RENEWAL_CUE.test(before);
      if (!cue) continue;
      const future = candidate.getTime() >= now.getTime() - 86_400_000;
      // Prefer the cue closest to the date, and future dates over past ones.
      const lastCue = before.search(new RegExp(`${RENEWAL_CUE.source}(?![\\s\\S]*${RENEWAL_CUE.source})`, 'i'));
      found.push({
        date: candidate.toISOString().slice(0, 10),
        matched: m[0].trim(),
        score: (future ? 100 : 0) + lastCue,
      });
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => b.score - a.score);
  return { date: found[0].date, matched: found[0].matched };
}

/**
 * Reads a pasted confirmation email / receipt / app-store mail into a
 * suggested trial. Every field is a guess shown to the user before saving.
 *
 * @param {string} text
 * @param {{ name: string, serviceId: string, region: string, domains?: string[] }[]} directory
 * @param {Date} [now]
 */
export function parseTrialEmail(text, directory, now = new Date()) {
  const src = String(text ?? '');
  const lower = src.toLowerCase();
  // Longest name first so "YouTube Premium" beats "YouTube".
  const byName = [...directory]
    .sort((a, b) => b.name.length - a.name.length)
    .find((e) => lower.includes(e.name.toLowerCase()) || (e.domains ?? []).some((d) => lower.includes(d)));
  const days = extractTrialDays(src);
  const price = extractPrice(src);
  const renewal = extractRenewalDate(src, now);
  const renewsOn = renewal?.date ?? (days ? deriveRenewal(now, days.days).slice(0, 10) : null);
  return {
    entry: byName ?? null,
    serviceName: byName?.name ?? null,
    days,
    price,
    renewsOn,
    renewalMatched: renewal?.matched ?? null,
    found: Boolean(byName || days || price || renewal),
  };
}

/* ---------------------------------------------------------------------------
 * Confirmation vs advertisement.
 * "Your free trial has started" is a trial the user started. "Try Premium free
 * for 1 month" is marketing. Inbox scanning must only surface the first kind,
 * or the product fills up with trials that never existed.
 * ------------------------------------------------------------------------- */

const CONFIRM_SIGNALS = [
  /\b(?:your\s+)?(?:free\s+)?trial\s+(?:has\s+)?(?:started|begun|begins\s+(?:today|now)|is\s+(?:now\s+)?active|activated|is\s+confirmed)/i,
  /\byour\s+(?:free\s+)?trial\s+(?:of\s+[^.\n]{1,40}\s+)?(?:ends|expires|will\s+end|is\s+ending|runs\s+until)/i,
  /\bwelcome\s+to\s+your\s+(?:free\s+)?trial\b/i,
  /\byou(?:'|’)?re\s+(?:now\s+)?(?:on|in)\s+(?:a|your|the)\s+(?:free\s+)?trial\b/i,
  /\byou(?:'|’)?ll\s+be\s+(?:charged|billed)\s+(?:on|starting|from|after)\b|\byou\s+will\s+be\s+(?:charged|billed)\s+(?:on|starting|from|after)\b/i,
  /\b(?:first|next)\s+(?:payment|charge|billing(?:\s+date)?)\s+(?:is|will\s+be|of|on|date)\b/i,
  /\bsubscription\s+(?:confirmation|confirmed|is\s+active)\b/i,
  /\bthanks?\s+(?:you\s+)?for\s+(?:subscribing|starting\s+your|signing\s+up\s+for\s+(?:a|your|the)\s+(?:free\s+)?trial)/i,
  /\b(?:auto\s?pay|mandate|e-?mandate)\s+(?:has\s+been\s+|was\s+|is\s+)?(?:set\s+up|created|registered|approved|activated)/i,
  /\byour\s+(?:free\s+)?trial\s+of\b/i,
  /\breceipt\b|\border\s+(?:confirmation|summary|number)\b|\binvoice\b/i,
];

const PROMO_SIGNALS = [
  /\btry\s+(?:[\w+-]+\s+){0,3}(?:for\s+)?free\b/i,
  /\bstart\s+(?:your|a)\s+(?:\d+[-\s]?(?:day|week|month)\s+)?free\s+trial\b/i,
  /\b(?:claim|unlock|redeem)\s+(?:your|a|an)\b/i,
  /\bget\s+(?:\d+|one|two|three)\s+(?:days?|weeks?|months?)\s+(?:free|of\b)/i,
  /\blimited[-\s]time\b|\boffer\s+(?:ends|expires)\b|\bdon(?:'|’)?t\s+miss\b|\blast\s+chance\b/i,
  /\b(?:special|exclusive|introductory)\s+offer\b|\b\d{1,2}\s?%\s+off\b/i,
  /\bupgrade\s+(?:now|today|to)\b/i,
  /\bwe\s+miss\s+you\b|\bcome\s+back\b/i,
  /\b(?:deal|sale|offer)\b/i,
  /\b(?:only|just|at\s+just)\s+(?:₹|rs\.?|inr|\$)\s?\d/i,
  /(?:₹|rs\.?|\$)\s?\d[\d,.]*\s+for\s+(?:\d+|one|two|three|six|twelve)\s+(?:months?|weeks?|days?)/i,
  /\bsave\s+(?:up\s+to\s+)?(?:₹|rs\.?|\$|\d)/i,
];

/**
 * @param {string} text  subject + sender + body
 * @returns {{ kind: 'confirmation'|'promo'|'unknown', confirm: number, promo: number }}
 */
export function classifyTrialEmail(text) {
  const src = String(text ?? '');
  // The subject line (first line) says the most about intent.
  const subject = src.split('\n', 1)[0] ?? '';
  const count = (list, s) => list.reduce((n, re) => n + (re.test(s) ? 1 : 0), 0);
  const subjectConfirm = count(CONFIRM_SIGNALS, subject);
  const subjectPromo = count(PROMO_SIGNALS, subject);
  const confirm = count(CONFIRM_SIGNALS, src) + subjectConfirm;
  const promo = count(PROMO_SIGNALS, src) + subjectPromo;
  let kind;
  // The subject decides when it's clear-cut either way.
  if (subjectPromo > 0 && subjectConfirm === 0) kind = 'promo';
  else if (subjectConfirm > 0 && subjectPromo === 0) kind = 'confirmation';
  // Otherwise confirmation must clearly outweigh marketing; a tie is an ad.
  else if (confirm > promo) kind = 'confirmation';
  else if (promo > 0) kind = 'promo';
  else kind = 'unknown';
  return { kind: /** @type {'confirmation'|'promo'|'unknown'} */ (kind), confirm, promo };
}
