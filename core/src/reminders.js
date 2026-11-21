/**
 * Server-side reminder selection (used by the email edge function).
 *
 * The cron runs every 15 minutes, so it can't fire "at" a moment — it asks:
 * which rung of the ladder is due now and hasn't been sent? Only the newest
 * due rung is sent (no burst of three stale emails after an outage), and
 * nothing older than STALE_MS is sent at all.
 */
import { alertSchedule, CHECKIN_DELAY, toDate } from './dates.js';

export const STALE_MS = 3 * 60 * 60_000;

/** All rungs in ladder order, as the user sees them in Settings. */
export const NUDGES = [
  { kind: 'primary', label: '5 days before (long trials) / 2 days before' },
  { kind: 'reminder', label: '2 days before (long trials)' },
  { kind: 'final', label: '1 day before' },
  { kind: 'urgent', label: '6 hours before' },
  { kind: 'lastcall', label: '1 hour before' },
  { kind: 'checkin', label: 'After renewal: "Did it renew?"' },
];

/**
 * @param {{ renewsAt: string, trialLengthDays: number, status: string }} trial
 * @param {Date} now
 * @param {string[]} sentKinds rungs already emailed for this trial
 * @param {string[]} [skip]   rungs the user turned off
 * @returns {null | { kind: string, at: string }}
 */
export function dueReminder(trial, now, sentKinds = [], skip = []) {
  if (!['active', 'awaiting_confirmation'].includes(trial.status)) return null;
  const renewal = toDate(trial.renewsAt).getTime();
  const rungs = alertSchedule(trial.renewsAt, trial.trialLengthDays, new Date(0)).map((a) => ({
    kind: a.kind,
    at: new Date(a.at).getTime(),
  }));
  rungs.push({ kind: 'checkin', at: renewal + CHECKIN_DELAY });
  const t = now.getTime();
  const due = rungs
    .filter((r) => r.at <= t && t - r.at < STALE_MS && !skip.includes(r.kind))
    .sort((a, b) => b.at - a.at)[0];
  if (!due || sentKinds.includes(due.kind)) return null;
  // Don't send a pre-renewal nudge once the renewal moment has passed.
  if (due.kind !== 'checkin' && renewal <= t) return null;
  return { kind: due.kind, at: new Date(due.at).toISOString() };
}
