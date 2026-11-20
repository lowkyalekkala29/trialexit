/**
 * Timezone-safe renewal math.
 *
 * Rule that drives this whole file: a renewal is an INSTANT, not a date.
 * "Renews Nov 27" is meaningless — Nov 27 00:00 in IST is Nov 26 18:30 UTC.
 * Every function here operates on instants so a user in one zone tracking a
 * service billed in another still gets a correct alert.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Lead time for the primary alert. Long trials get more runway. */
const SHORT_TRIAL_MAX_DAYS = 14;
const SHORT_TRIAL_LEAD = 48 * HOUR;
const LONG_TRIAL_LEAD = 5 * DAY;
/** Always fire a second, closer ping. */
const FINAL_LEAD = 24 * HOUR;

/**
 * @param {number} trialLengthDays
 * @returns {number} milliseconds before renewal to fire the primary alert
 */
export function primaryLeadMs(trialLengthDays) {
  const days = Number(trialLengthDays) || 0;
  return days > SHORT_TRIAL_MAX_DAYS ? LONG_TRIAL_LEAD : SHORT_TRIAL_LEAD;
}

/**
 * @param {string|number|Date} instant
 * @returns {Date}
 */
export function toDate(instant) {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid instant: ${String(instant)}`);
  return d;
}

/**
 * Offset of a timezone from UTC at a given instant, in ms.
 * Probe technique: format the instant into the zone, read the wall clock back
 * as if it were UTC, and diff. Handles DST because it is evaluated per instant.
 *
 * @param {Date} instant
 * @param {string} timeZone IANA name
 * @returns {number}
 */
export function zoneOffsetMs(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  /** @type {Record<string,string>} */
  const p = {};
  for (const part of dtf.formatToParts(instant)) p[part.type] = part.value;
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return asUTC - instant.getTime();
}

/**
 * Convert a wall-clock time in a named zone into a true instant.
 * Two-pass: guess with the offset at the naive instant, then re-probe at the
 * guess to land correctly across a DST boundary.
 *
 * @param {string} dateStr  "YYYY-MM-DD"
 * @param {string} timeStr  "HH:mm"
 * @param {string} timeZone IANA name
 * @returns {Date}
 */
export function zonedWallTimeToInstant(dateStr, timeStr, timeZone) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const tm = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!dm) throw new Error(`Bad date: ${dateStr}`);
  if (!tm) throw new Error(`Bad time: ${timeStr}`);

  const naive = Date.UTC(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]),
    0,
  );
  const firstGuess = naive - zoneOffsetMs(new Date(naive), timeZone);
  const refined = naive - zoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(refined);
}

/**
 * @param {string} timeZone
 * @returns {string} e.g. "Asia/Kolkata"
 */
export function deviceTimeZone(timeZone) {
  return timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * Alert schedule for a trial. Primary lead is adaptive; a final ping at T-24h
 * is always added. Alerts that already sit in the past are dropped.
 *
 * @param {string} renewsAt ISO instant
 * @param {number} trialLengthDays
 * @param {Date} [now]
 * @returns {import('./types.js').Alert[]}
 */
export function alertSchedule(renewsAt, trialLengthDays, now = new Date()) {
  const renewal = toDate(renewsAt).getTime();
  const candidates = [
    { at: renewal - primaryLeadMs(trialLengthDays), kind: /** @type {const} */ ('primary') },
    { at: renewal - FINAL_LEAD, kind: /** @type {const} */ ('final') },
  ];
  return candidates
    .filter((c) => c.at > now.getTime())
    .sort((a, b) => a.at - b.at)
    .map((c) => ({
      at: new Date(c.at).toISOString(),
      kind: c.kind,
      label:
        c.kind === 'primary'
          ? 'Cancel your trial today'
          : 'Last chance — billing is within 24 hours',
    }));
}

/**
 * @typedef {'past_due'|'critical'|'soon'|'safe'} Urgency
 */

/**
 * @param {string} renewsAt ISO instant
 * @param {Date} [now]
 * @returns {Urgency}
 */
export function urgency(renewsAt, now = new Date()) {
  const ms = toDate(renewsAt).getTime() - now.getTime();
  if (ms <= 0) return 'past_due';
  if (ms <= 48 * HOUR) return 'critical';
  if (ms <= 7 * DAY) return 'soon';
  return 'safe';
}

/**
 * @param {string} renewsAt
 * @param {Date} [now]
 * @returns {number} may be negative
 */
export function msUntil(renewsAt, now = new Date()) {
  return toDate(renewsAt).getTime() - now.getTime();
}

/**
 * Compact countdown for cards: "3d 4h", "12h 05m", "—".
 * @param {number} ms
 * @returns {string}
 */
export function formatCountdown(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return 'passed';
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  const m = Math.floor((ms % HOUR) / MINUTE);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

/**
 * Show the renewal in the zone it will actually be charged in, and annotate
 * when that differs from the viewer's zone.
 *
 * @param {string} renewsAt
 * @param {string} timeZone
 * @returns {string}
 */
export function formatRenewalLocal(renewsAt, timeZone) {
  const d = toDate(renewsAt);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: deviceTimeZone(timeZone),
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const zoneShort = new Intl.DateTimeFormat('en-US', {
    timeZone: deviceTimeZone(timeZone),
    timeZoneName: 'short',
  })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName')?.value;
  return `${fmt.format(d)}${zoneShort ? ` ${zoneShort}` : ''}`;
}

/**
 * Currency helper. Amounts are stored in minor units.
 * @param {number} minorUnits
 * @param {'INR'|'USD'} currency
 * @returns {string}
 */
export function formatMoney(minorUnits, currency) {
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(minorUnits / 100);
}

/**
 * Trial length in whole days between signup and renewal, floored, min 1.
 * @param {string} signupAt
 * @param {string} renewsAt
 * @returns {number}
 */
export function trialLengthDays(signupAt, renewsAt) {
  const ms = toDate(renewsAt).getTime() - toDate(signupAt).getTime();
  return Math.max(1, Math.floor(ms / DAY));
}
