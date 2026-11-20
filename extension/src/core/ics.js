/**
 * RFC 5545 (.ics) generation.
 *
 * Two decisions worth keeping:
 * 1. All times are emitted in UTC (trailing Z) so we never have to build a
 *    VTIMEZONE block — the single most common source of broken calendar files.
 * 2. The cancel URL and the steps go INSIDE the event description, so the
 *    alert is actionable the moment it opens. A reminder that tells you to go
 *    search for a cancel page is the exact failure mode this product exists to fix.
 */

import { toDate, alertSchedule } from './dates.js';

const CRLF = '\r\n';
const MAX_OCTETS = 75;

/**
 * Escape ICS text values: backslash, semicolon, comma, newline.
 * @param {string} v
 * @returns {string}
 */
export function escapeText(v) {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold a content line to 75 octets, continuation lines start with a space.
 * Splits on characters, not bytes, so multi-byte text (₹, é) stays valid.
 * @param {string} line
 * @returns {string}
 */
export function foldLine(line) {
  const parts = [];
  let current = '';
  for (const ch of line) {
    const candidate = current + ch;
    if (Buffer.byteLength(candidate, 'utf8') > MAX_OCTETS) {
      parts.push(current);
      current = ' ' + ch;
    } else {
      current = candidate;
    }
  }
  parts.push(current);
  return parts.join(CRLF);
}

/**
 * @param {Date} d
 * @returns {string} 20261120T173000Z
 */
export function utcStamp(d) {
  return (
    toDate(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  );
}

/**
 * @typedef {Object} IcsInput
 * @property {import('./types.js').Trial} trial
 * @property {string} cancelUrl
 * @property {string[]} steps
 * @property {string} renewLabel  Pre-formatted, e.g. "Fri 27 Nov 00:00 IST"
 * @property {string} summaryLine e.g. "₹499 will be charged"
 * @property {boolean} [requiresChat]
 */

/**
 * ISO-8601 duration for a trigger, preferring whole hours/days over minutes.
 * @param {number} ms
 * @returns {string}
 */
export function triggerDuration(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes % 1440 === 0) return `-P${minutes / 1440}D`;
  if (minutes % 60 === 0) return `-PT${minutes / 60}H`;
  return `-PT${minutes}M`;
}

/**
 * Build a single-event calendar with two display alarms.
 * @param {IcsInput} input
 * @param {Date} [now]
 * @returns {string}
 */
export function buildIcs(input, now = new Date()) {
  const { trial, cancelUrl, steps, renewLabel, summaryLine, requiresChat } = input;
  const renewal = toDate(trial.renewsAt);
  const alerts = alertSchedule(trial.renewsAt, trial.trialLengthDays, now);

  const description = [
    `${trial.serviceName} — ${summaryLine}`,
    `Renews: ${renewLabel}`,
    '',
    `Cancel here: ${cancelUrl}`,
    requiresChat ? 'Note: this service may require support chat or phone to cancel.' : '',
    '',
    'Steps:',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    'Mark it cancelled in TrialExit once done.',
  ]
    .filter((l) => l !== '')
    .join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TrialExit//Cancel a trial//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${trial.id}@trialexit`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(renewal)}`,
    `DTEND:${utcStamp(new Date(renewal.getTime() + 15 * 60_000))}`,
    `SUMMARY:${escapeText(`Cancel ${trial.serviceName} trial — ${summaryLine}`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${cancelUrl}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `TRIGGER:${triggerDuration(renewal.getTime() - toDate(alerts[0]?.at ?? renewal).getTime())}`,
    `DESCRIPTION:${escapeText(`Cancel ${trial.serviceName} now`)}`,
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT24H',
    `DESCRIPTION:${escapeText(`${trial.serviceName} bills in 24 hours`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(foldLine).join(CRLF) + CRLF;
}

/**
 * @param {string} filename
 * @param {string} content
 */
export function downloadIcs(filename, content) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
