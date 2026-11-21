/**
 * "Did a trial just start?" — decides when the extension interrupts the user.
 *
 * The content script reports two kinds of evidence per browser tab:
 *   - a CHECKOUT it saw (trial wording + a payment form), and whether the user
 *     pressed a submit-like button there;
 *   - the CURRENT page's signals (success wording / success URL).
 * Pure function so the thresholds are testable; false positives are worse than
 * misses because a nagging extension gets uninstalled.
 */

/** How long a checkout in this tab counts as "just now". */
export const INTENT_TTL_MS = 45 * 60_000;

const SUCCESS_PATH = /\/(?:welcome|success|thank-?you|thanks|confirm(?:ed|ation)?|complete|order-complete|getting-started|onboarding|activated|receipt)\b/i;
const SUCCESS_TEXT =
  /(?:trial\s+(?:has\s+)?(?:started|begun|is\s+active|activated)|you(?:'|’)?re\s+(?:all\s+set|subscribed|in)|subscription\s+(?:is\s+)?(?:active|confirmed)|payment\s+(?:successful|confirmed|method\s+added)|welcome\s+to\s+(?:your\s+)?(?:free\s+trial|premium|pro|plus)|enjoy\s+your\s+(?:free\s+)?trial|thanks\s+for\s+(?:subscribing|signing\s+up|starting))/i;
const TRIAL_TEXT =
  /free\s+trial|\d+[-\s]?days?\s+free|trial\s+(?:period|ends)|start\s+(?:your\s+)?(?:free\s+)?trial|try\s+(?:it\s+)?free|first\s+(?:month|week)\s+free|cancel\s+any\s?time|won(?:'|’)?t\s+be\s+charged\s+until|then\s+[₹$€£]\s?\d/i;

/** @param {string} url @param {string} text */
export function pageSignals(url, text) {
  const t = String(text ?? '');
  let path = '';
  try {
    const u = new URL(url);
    path = u.pathname + u.search;
  } catch {
    path = String(url ?? '');
  }
  return {
    trial: TRIAL_TEXT.test(t),
    success: SUCCESS_TEXT.test(t) || SUCCESS_PATH.test(path),
    successText: SUCCESS_TEXT.test(t),
  };
}

/**
 * @param {{
 *   intent: null | { at: number, submitted: boolean, host: string, analysis: any },
 *   current: { host: string, url: string, signals: { trial: boolean, success: boolean, successText: boolean }, analysis: any },
 *   now?: number,
 *   alreadyTracked?: boolean,
 *   muted?: boolean,
 * }} input
 * @returns {{ show: boolean, confidence: 'high'|'medium'|'none', reason: string, analysis: any }}
 */
export function decideActivation({ intent, current, now = Date.now(), alreadyTracked = false, muted = false }) {
  const none = (reason) => ({ show: false, confidence: /** @type {const} */ ('none'), reason, analysis: null });
  if (muted) return none('muted site');
  if (alreadyTracked) return none('already tracked');

  const fresh = intent && now - intent.at < INTENT_TTL_MS ? intent : null;
  const s = current.signals;

  // Strongest: user pressed "Start trial" on a trial checkout in this tab, and
  // has now left that checkout (redirect, success page, or SPA route change).
  if (fresh?.submitted && (s.success || current.url !== fresh.url)) {
    return {
      show: true,
      confidence: 'high',
      reason: s.success ? 'submitted checkout, then success page' : 'submitted checkout, then navigated',
      analysis: mergeAnalysis(fresh.analysis, current.analysis),
    };
  }

  // Success page whose own text talks about a trial (no checkout seen — e.g.
  // the extension was installed mid-flow, or checkout was in another tab).
  if (s.successText && s.trial) {
    return { show: true, confidence: 'medium', reason: 'success page mentions a trial', analysis: current.analysis };
  }

  // Success page right after a trial checkout we saw, even without a click
  // (Apple Pay / Google Pay sheets submit without a DOM click).
  if (fresh && s.success) {
    return { show: true, confidence: 'medium', reason: 'success page after trial checkout', analysis: mergeAnalysis(fresh.analysis, current.analysis) };
  }

  return none('no activation evidence');
}

/** Checkout pages usually carry the trial length and price; prefer them. */
function mergeAnalysis(checkout, current) {
  if (!checkout) return current;
  if (!current) return checkout;
  return {
    ...current,
    ...Object.fromEntries(Object.entries(checkout).filter(([, v]) => v != null)),
    siteName: checkout.siteName ?? current.siteName,
  };
}
