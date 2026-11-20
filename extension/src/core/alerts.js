/**
 * Alert scheduling. Turns trials into concrete fire-at times, and names those
 * times deterministically so alarms survive an extension restart.
 *
 * Pure: no chrome.* here, so the schedule is testable without a browser.
 */

import { alertSchedule, msUntil, HOUR } from './dates.js';
import { derivedStatus } from './store.js';

/**
 * @typedef {Object} PendingAlert
 * @property {string} trialId
 * @property {string} at       ISO instant
 * @property {'primary'|'final'|'immediate'} kind
 * @property {string} label
 */

/** A trial added inside the alert window still deserves a nudge. */
const IMMEDIATE_DELAY_MS = 60_000;

/**
 * @param {import('./types.js').Trial[]} trials
 * @param {Date} [now]
 * @returns {PendingAlert[]}
 */
export function pendingAlerts(trials, now = new Date()) {
  /** @type {PendingAlert[]} */
  const out = [];
  for (const t of trials) {
    if (derivedStatus(t, now) !== 'active') continue;
    if (msUntil(t.renewsAt, now) <= 0) continue;

    const scheduled = alertSchedule(t.renewsAt, t.trialLengthDays, now);
    if (scheduled.length === 0) {
      // Renewal is under 24h away, so both standard alerts are already in the
      // past. Nudge shortly instead of staying silent.
      out.push({
        trialId: t.id,
        at: new Date(now.getTime() + IMMEDIATE_DELAY_MS).toISOString(),
        kind: 'immediate',
        label: `${t.serviceName} renews soon`,
      });
      continue;
    }
    for (const a of scheduled) {
      out.push({
        trialId: t.id,
        at: a.at,
        kind: /** @type {'primary'|'final'} */ (a.kind),
        label: a.label,
      });
    }
  }
  return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
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
 * @param {'primary'|'final'|'immediate'} kind
 * @returns {string}
 */
export function notificationTitle(trial, kind) {
  if (kind === 'final') return `${trial.serviceName} renews in under 24 hours`;
  if (kind === 'immediate') return `${trial.serviceName} renews very soon`;
  return `Cancel your ${trial.serviceName} trial`;
}

/**
 * @param {import('./types.js').Trial} trial
 * @returns {string}
 */
export function notificationBody(trial) {
  const amount = new Intl.NumberFormat(trial.currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency: trial.currency,
    maximumFractionDigits: 2,
  }).format(trial.amount / 100);
  return `${amount} will be charged unless you cancel. Click to open the cancel page.`;
}

export { HOUR };
