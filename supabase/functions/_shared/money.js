/**
 * Subscriptions & money. Pure, shared by the web app, extension and server.
 *
 * An item is a trial (kind 'trial', the default for older data) or a paid
 * subscription (kind 'subscription', with a billing cycle). "Money protected"
 * only counts charges that really were avoided:
 *  - a trial cancelled before it charged → its first charge
 *  - a cancelled subscription → each renewal that has come and gone since
 *    cancelling (so the number grows honestly, month by month)
 */
import { toDate } from './dates.js';

export const CYCLES = /** @type {const} */ (['weekly', 'monthly', 'quarterly', 'yearly']);

export const isSubscription = (t) => t?.kind === 'subscription';
export const isCancelled = (t) => t?.status === 'confirmed_cancelled';

/** @param {Date} d @param {string} cycle @param {number} [n] */
export function addCycle(d, cycle = 'monthly', n = 1) {
  const x = new Date(d.getTime());
  if (cycle === 'weekly') x.setUTCDate(x.getUTCDate() + 7 * n);
  else if (cycle === 'quarterly') x.setUTCMonth(x.getUTCMonth() + 3 * n);
  else if (cycle === 'yearly') x.setUTCFullYear(x.getUTCFullYear() + n);
  else x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

/** Next charge on or after `now` for a subscription (renewsAt = a known charge date). */
export function nextCharge(t, now = new Date()) {
  let d = toDate(t.renewsAt);
  for (let i = 0; d.getTime() <= now.getTime() && i < 1000; i++) d = addCycle(d, t.cycle);
  return d;
}

/** Monthly cost of one subscription in minor units. */
export function monthlyCost(t) {
  const a = Number(t.amount) || 0;
  return t.cycle === 'yearly' ? a / 12 : t.cycle === 'quarterly' ? a / 3 : t.cycle === 'weekly' ? (a * 52) / 12 : a;
}

/** @returns {{ INR: number, USD: number }} */
export function monthlySpend(items) {
  const out = { INR: 0, USD: 0 };
  for (const t of items) if (isSubscription(t) && !isCancelled(t)) out[t.currency] = (out[t.currency] ?? 0) + Math.round(monthlyCost(t));
  return out;
}

/** Charges avoided by one cancelled item, up to `now` (minor units). */
export function protectedBy(t, now = new Date()) {
  if (!isCancelled(t) || !t.cancelledAt) return 0;
  const cancelled = toDate(t.cancelledAt).getTime();
  const amount = Number(t.amount) || 0;
  if (!isSubscription(t)) return cancelled < toDate(t.renewsAt).getTime() ? amount : 0;
  // Renewals that would have charged between cancelling and now.
  let d = toDate(t.renewsAt);
  for (let i = 0; d.getTime() <= cancelled && i < 1000; i++) d = addCycle(d, t.cycle);
  let n = 0;
  for (let i = 0; d.getTime() <= now.getTime() && i < 1000; i++, n++) d = addCycle(d, t.cycle);
  return n * amount;
}

/** @returns {{ INR: number, USD: number }} */
export function moneyProtected(items, now = new Date()) {
  const out = { INR: 0, USD: 0 };
  for (const t of items) out[t.currency] = (out[t.currency] ?? 0) + protectedBy(t, now);
  return out;
}

/** Charges (trial conversions + subscription renewals) due within `days`. */
export function upcomingCharges(items, now = new Date(), days = 7) {
  const until = now.getTime() + days * 864e5;
  return items
    .filter((t) => !isCancelled(t) && !['kept', 'charged', 'dismissed'].includes(t.status) || (isSubscription(t) && !isCancelled(t)))
    .map((t) => ({ item: t, at: isSubscription(t) ? nextCharge(t, now) : toDate(t.renewsAt) }))
    .filter(({ at }) => at.getTime() > now.getTime() && at.getTime() <= until)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** "₹649 / month" style label pieces. */
export const cycleLabel = (c) => ({ weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year' })[c] ?? 'month';

/**
 * Guess a billing cycle from email/page text.
 * @returns {'weekly'|'monthly'|'quarterly'|'yearly'|null}
 */
export function detectCycle(text) {
  const s = String(text ?? '');
  if (/\b(?:per|a|\/|each)\s?(?:year|yr)\b|\bannual(?:ly)?\b|\byearly\b|\b12[-\s]months?\s+plan\b/i.test(s)) return 'yearly';
  if (/\b(?:per|a|\/|each)\s?quarter\b|\bquarterly\b|\b3[-\s]months?\s+plan\b/i.test(s)) return 'quarterly';
  if (/\b(?:per|a|\/|each)\s?week\b|\bweekly\b/i.test(s)) return 'weekly';
  if (/\b(?:per|a|\/|each)\s?(?:month|mo)\b|\bmonthly\b|\/mo\b/i.test(s)) return 'monthly';
  return null;
}

/** Subscription nudges before the next charge: 3 days and 1 day before. */
export function subscriptionRungs(t, now = new Date()) {
  // The charge that is next, or one that charged within the last 3 hours (so
  // a cron run just after a rung still sees it).
  const charge = nextCharge(t, new Date(now.getTime() - 3 * 3600_000)).getTime();
  return [
    { kind: 'sub3d', at: charge - 3 * 864e5, label: '3 days before renewal', charge },
    { kind: 'sub1d', at: charge - 864e5, label: '1 day before renewal', charge },
  ];
}
