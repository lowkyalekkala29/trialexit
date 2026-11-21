/**
 * Pure trial-state logic. No storage, no DOM — so it is fully testable and
 * usable from both the extension and any future surface.
 */

import { toDate, urgency, msUntil } from './dates.js';

/** Free-tier gate is dormant until the first 20 users are in. */
export const FREE_LAUNCH = true;
export const FREE_TRIAL_LIMIT = 3;

/**
 * A trial that has physically passed its renewal but was never confirmed
 * cancelled is almost certainly charged. We surface that as a state rather
 * than a countdown, because a negative countdown reads like a bug.
 * @param {import('./types.js').Trial} t
 * @param {Date} [now]
 * @returns {import('./types.js').Trial['status']}
 */
export function derivedStatus(t, now = new Date()) {
  if ((t.status === 'active' || t.status === 'awaiting_confirmation') && msUntil(t.renewsAt, now) <= 0) return 'charged';
  return t.status;
}

/**
 * @param {import('./types.js').Trial[]} trials
 * @returns {number}
 */
export function billableActiveCount(trials, now = new Date()) {
  return trials.filter((t) => derivedStatus(t, now) === 'active').length;
}

/**
 * @param {import('./types.js').Trial[]} trials
 * @param {Date} [now]
 * @returns {{ allowed: boolean, reason: string }}
 */
export function canAddTrial(trials, now = new Date()) {
  if (FREE_LAUNCH) return { allowed: true, reason: 'free launch' };
  const n = billableActiveCount(trials, now);
  return n < FREE_TRIAL_LIMIT
    ? { allowed: true, reason: `${FREE_TRIAL_LIMIT - n} slots left` }
    : { allowed: false, reason: 'Free limit reached' };
}

/**
 * Total genuinely saved: only trials the user CONFIRMED cancelled before the
 * charge landed. Anything else would be marketing arithmetic.
 * Reported per currency — never FX-converted, so the number stays truthful.
 *
 * @param {import('./types.js').Trial[]} trials
 * @returns {{ INR: number, USD: number }}
 */
export function savedTotals(trials) {
  /** @type {{ INR: number, USD: number }} */
  const totals = { INR: 0, USD: 0 };
  for (const t of trials) {
    if (t.status !== 'confirmed_cancelled' || !t.cancelledAt) continue;
    const cancelledBeforeCharge =
      toDate(t.cancelledAt).getTime() < toDate(t.renewsAt).getTime();
    if (!cancelledBeforeCharge) continue;
    totals[t.currency] += t.amount;
  }
  return totals;
}

/**
 * @param {import('./types.js').Trial[]} trials
 * @param {string} id
 * @param {import('./types.js').TrialStatus} next
 * @param {Date} [now]
 * @returns {import('./types.js').Trial[]}
 */
export function transition(trials, id, next, now = new Date()) {
  const stamp = now.toISOString();
  return trials.map((t) => {
    if (t.id !== id) return t;
    if (next === 'confirmed_cancelled') return { ...t, status: next, cancelledAt: stamp, updatedAt: stamp };
    if (next === 'active') return { ...t, status: next, cancelledAt: null, updatedAt: stamp };
    return { ...t, status: next, updatedAt: stamp };
  });
}

/**
 * Cards sorted by what is most dangerous first: critical, soon, safe, past due
 * last. Cancelled items sink to the bottom.
 * @param {import('./types.js').Trial[]} trials
 * @param {Date} [now]
 */
export function sortedForDisplay(trials, now = new Date()) {
  const weight = { critical: 0, soon: 1, safe: 2, past_due: 3 };
  return [...trials].sort((a, b) => {
    const aDone = ['confirmed_cancelled', 'kept'].includes(derivedStatus(a, now));
    const bDone = ['confirmed_cancelled', 'kept'].includes(derivedStatus(b, now));
    if (aDone !== bDone) return aDone ? 1 : -1;
    const ua = weight[urgency(a.renewsAt, now)];
    const ub = weight[urgency(b.renewsAt, now)];
    if (ua !== ub) return ua - ub;
    return toDate(a.renewsAt).getTime() - toDate(b.renewsAt).getTime();
  });
}

/**
 * Validate untrusted input before it becomes a Trial.
 * @param {Partial<import('./types.js').Trial>} input
 * @returns {string[]} list of problems; empty means valid
 */
export function validateTrial(input) {
  const errors = [];
  if (!input.serviceName?.trim()) errors.push('Service name is required');
  if (!input.renewsAt) errors.push('Renewal date is required');
  else if (Number.isNaN(new Date(input.renewsAt).getTime())) errors.push('Renewal date is invalid');
  if (!Number.isFinite(input.amount) || /** @type {number} */ (input.amount) < 0)
    errors.push('Renewal amount must be zero or more');
  if (!input.currency) errors.push('Currency is required');
  return errors;
}
