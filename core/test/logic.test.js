import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, escapeText, foldLine } from '../src/ics.js';
import { normalizeDirectory, matchByHost } from '../src/directory.js';
import {
  savedTotals,
  transition,
  canAddTrial,
  derivedStatus,
  validateTrial,
  sortedForDisplay,
} from '../src/store.js';

const baseTrial = {
  id: 't1',
  serviceId: 'netflix',
  region: 'IN',
  serviceName: 'Netflix',
  renewsAt: '2026-11-27T00:00:00+05:30',
  timezone: 'Asia/Kolkata',
  amount: 49900,
  currency: 'INR',
  trialLengthDays: 7,
  status: 'active',
  createdAt: '2026-11-20T00:00:00Z',
  cancelledAt: null,
  cancelUrlUsed: null,
};

test('escapes ICS special characters', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
});

test('folds long lines at 75 octets with a leading space', () => {
  const lines = foldLine('SUMMARY:' + 'x'.repeat(120)).split('\r\n');
  assert.ok(lines.length > 1);
  assert.ok(lines.slice(1).every((l) => l.startsWith(' ')));
});

test('generated calendar has UTC stamps, the cancel URL and two alarms', () => {
  const ics = buildIcs(
    {
      trial: baseTrial,
      cancelUrl: 'https://www.netflix.com/cancelplan',
      steps: ['Sign in', 'Cancel'],
      renewLabel: 'Fri 27 Nov 00:00 IST',
      summaryLine: '₹499 will be charged',
    },
    new Date('2026-11-20T00:00:00Z'),
  );
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART:20261126T183000Z/);
  assert.match(ics, /https:\/\/www\.netflix\.com\/cancelplan/);
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 2);
  assert.match(ics, /TRIGGER:-P2D/);
  assert.match(ics, /TRIGGER:-PT24H/);
  // every line ends CRLF, no bare LF inside
  assert.equal(ics.split('\r\n').length > 10, true);
  assert.ok(!/[^\r]\n/.test(ics));
});

test('saved totals count only confirmed, pre-charge cancellations', () => {
  const trials = [
    { ...baseTrial, id: 'a', status: 'confirmed_cancelled', cancelledAt: '2026-11-26T00:00:00Z' },
    // cancelled too late — the charge already happened
    { ...baseTrial, id: 'b', status: 'confirmed_cancelled', cancelledAt: '2026-11-28T00:00:00Z' },
    { ...baseTrial, id: 'c', status: 'active' },
    { ...baseTrial, id: 'd', currency: 'USD', amount: 999, status: 'confirmed_cancelled', cancelledAt: '2026-11-25T00:00:00Z' },
  ];
  assert.deepEqual(savedTotals(trials), { INR: 49900, USD: 999 });
});

test('transitions set and clear cancelledAt correctly', () => {
  const now = new Date('2026-11-21T00:00:00Z');
  const cancelled = transition([baseTrial], 't1', 'confirmed_cancelled', now);
  assert.equal(cancelled[0].cancelledAt, now.toISOString());
  const back = transition(cancelled, 't1', 'active', now);
  assert.equal(back[0].cancelledAt, null);
});

test('an active trial past its renewal date derives as charged', () => {
  const after = new Date('2026-11-28T00:00:00Z');
  assert.equal(derivedStatus(baseTrial, after), 'charged');
  assert.equal(derivedStatus(baseTrial, new Date('2026-11-21T00:00:00Z')), 'active');
});

test('free gate allows adds during free launch', () => {
  assert.equal(canAddTrial([baseTrial]).allowed, true);
});

test('validation rejects missing and malformed input', () => {
  assert.deepEqual(validateTrial({}), [
    'Service name is required',
    'Renewal date is required',
    'Renewal amount must be zero or more',
    'Currency is required',
  ]);
  assert.deepEqual(validateTrial(baseTrial), []);
});

test('host matching handles subdomains and rejects lookalikes', () => {
  const entries = normalizeDirectory({
    entries: [
      { serviceId: 'netflix', name: 'Netflix', cancelUrl: 'https://x', domains: ['netflix.com'] },
      { serviceId: 'prime', name: 'Prime Video', cancelUrl: 'https://y', domains: ['primevideo.com'] },
    ],
  });
  assert.equal(matchByHost(entries, 'www.netflix.com')?.serviceId, 'netflix');
  assert.equal(matchByHost(entries, 'help.netflix.com')?.serviceId, 'netflix');
  assert.equal(matchByHost(entries, 'netflix.com.evil.test'), undefined);
  assert.equal(matchByHost(entries, 'notnetflix.com'), undefined);
  assert.equal(matchByHost(entries, 'primevideo.com')?.serviceId, 'prime');
});

test('display order puts critical first and cancelled last', () => {
  const now = new Date('2026-11-20T00:00:00Z');
  const soon = { ...baseTrial, id: 'soon', renewsAt: '2026-11-24T00:00:00+05:30' };
  const done = { ...baseTrial, id: 'done', status: 'confirmed_cancelled', cancelledAt: now.toISOString() };
  const safe = { ...baseTrial, id: 'safe', renewsAt: '2026-12-10T00:00:00+05:30' };
  const order = sortedForDisplay([done, safe, soon], now).map((t) => t.id);
  assert.deepEqual(order, ['soon', 'safe', 'done']);
});
