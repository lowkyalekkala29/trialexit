/**
 * Alert scheduling. Turns trials into concrete fire-at times, and names those
 * times deterministically so alarms survive an extension restart.
 *
 * Pure: no chrome.* here, so the schedule is testable without a browser.
 */

import { alertSchedule, msUntil, HOUR, CHECKIN_DELAY, toDate } from './dates.js';
import { derivedStatus } from './store.js';

/**
 * @typedef {Object} PendingAlert
 * @property {string} trialId
 * @property {string} at       ISO instant
 * @property {AlertKind} kind
 * @property {string} label
 */

/** @typedef {'primary'|'reminder'|'final'|'urgent'|'lastcall'|'immediate'|'checkin'} AlertKind */

/** A trial added inside the alert window still deserves a nudge. */
const IMMEDIATE_DELAY_MS = 60_000;
const FINAL_WINDOW = 24 * HOUR;

/**
 * @param {import('./types.js').Trial[]} trials
 * @param {Date} [now]
 * @param {{ skip?: string[] }} [prefs]  nudge kinds the user turned off
 * @returns {PendingAlert[]}
 */
export function pendingAlerts(trials, now = new Date(), prefs = {}) {
  /** @type {PendingAlert[]} */
  const out = [];
  const skip = new Set(prefs.skip ?? []);
  for (const t of trials) {
    const status = derivedStatus(t, now);
    const renewal = toDate(t.renewsAt).getTime();

    // Nobody told us how it ended: ask once, shortly after the renewal moment.
    if ((status === 'active' || status === 'charged' || status === 'awaiting_confirmation') && t.status !== 'kept') {
      const checkinAt = renewal + CHECKIN_DELAY;
      if (checkinAt > now.getTime()) {
        out.push({ trialId: t.id, at: new Date(checkinAt).toISOString(), kind: 'checkin', label: 'Did it renew?' });
      }
    }

    if (status !== 'active' && status !== 'awaiting_confirmation') continue;
    if (msUntil(t.renewsAt, now) <= 0) continue;

    const scheduled = alertSchedule(t.renewsAt, t.trialLengthDays, now);
    // Added late: everything before the next ladder step is already past.
    // Nudge shortly instead of staying silent until the next rung.
    const nextAt = scheduled[0] ? new Date(scheduled[0].at).getTime() : renewal;
    if (msUntil(t.renewsAt, now) <= FINAL_WINDOW && nextAt - now.getTime() > IMMEDIATE_DELAY_MS * 5) {
      out.push({
        trialId: t.id,
        at: new Date(now.getTime() + IMMEDIATE_DELAY_MS).toISOString(),
        kind: 'immediate',
        label: `${t.serviceName} renews soon`,
      });
    }
    for (const a of scheduled) {
      out.push({ trialId: t.id, at: a.at, kind: /** @type {AlertKind} */ (a.kind), label: a.label });
    }
  }
  return out.filter((a) => !skip.has(a.kind) && !(a.kind === 'immediate' && skip.has('lastcall') && skip.has('urgent') && skip.has('final'))).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/**
 * Names must be stable across restarts so alarms can be reconciled, and they
 * must be unique per (trial, kind).
 * @param {PendingAlert} alert
 * @returns {string}
 */
export function alarmName(alert) {
  return `trial:${alert.trialId}:${alert.kind}`;
}

/**
 * @param {string} name
 * @returns {{ trialId: string, kind: string } | null}
 */
export function parseAlarmName(name) {
  const parts = String(name).split(':');
  if (parts.length !== 3 || parts[0] !== 'trial') return null;
  return { trialId: parts[1], kind: parts[2] };
}

/**
 * @param {import('./types.js').Trial} trial
 * @param {AlertKind} kind
 * @returns {string}
 */
export function notificationTitle(trial, kind) {
  const n = trial.serviceName;
  switch (kind) {
    case 'reminder': return `2 days left on your ${n} trial`;
    case 'final': return `${n} renews in under 24 hours`;
    case 'urgent': return `${n} charges in about 6 hours`;
    case 'lastcall': return `${n} charges within the hour`;
    case 'immediate': return `${n} renews very soon`;
    case 'checkin': return `Did ${n} renew?`;
    default: return `Cancel your ${n} trial`;
  }
}

/**
 * @param {import('./types.js').Trial} trial
 * @param {AlertKind} [kind]
 * @returns {string}
 */
export function notificationBody(trial, kind) {
  const amount = new Intl.NumberFormat(trial.currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency: trial.currency,
    maximumFractionDigits: 2,
  }).format(trial.amount / 100);
  if (kind === 'checkin') {
    return `Its renewal time has passed. Open TrialExit and mark it: cancelled, keeping it, or charged — so nothing slips through.`;
  }
  return `${amount} will be charged unless you cancel. Click to open the cancel page.`;
}

export { HOUR };
