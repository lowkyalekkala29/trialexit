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
