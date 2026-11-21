import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRenewalDate, parseTrialEmail } from '../src/guess.js';

const now = new Date('2026-11-21T10:00:00Z');
const dir = [
  { name: 'Netflix', serviceId: 'netflix', region: 'IN', domains: ['netflix.com'] },
  { name: 'YouTube', serviceId: 'yt', region: 'IN', domains: [] },
  { name: 'YouTube Premium', serviceId: 'youtube-premium', region: 'IN', domains: ['youtube.com'] },
];

test('reads "renews on" date and ignores the order date', () => {
  const r = extractRenewalDate('Order date: November 21, 2026. Your free trial ends and you will be charged on December 5, 2026.', now);
  assert.equal(r?.date, '2026-12-05');
});

test('day-first dates, no year, roll into next year when needed', () => {
  assert.equal(extractRenewalDate('Your plan renews on 5th Dec', now)?.date, '2026-12-05');
  assert.equal(extractRenewalDate('Trial ends on 3 Jan', now)?.date, '2027-01-03');
});

test('Indian slash dates are day-first', () => {
  assert.equal(extractRenewalDate('AutoPay debit scheduled on 05/12/2026', now)?.date, '2026-12-05');
});

test('a date with no renewal cue is not a renewal date', () => {
  assert.equal(extractRenewalDate('Receipt issued December 5, 2026', now), null);
});

test('full Google Play style email', () => {
  const email = `Your free trial of YouTube Premium has started.
You won't be charged until your trial ends. Starting December 21, 2026 you'll be charged ₹149.00/month.`;
  const r = parseTrialEmail(email, dir, now);
  assert.equal(r.entry?.serviceId, 'youtube-premium');
  assert.equal(r.renewsOn, '2026-12-21');
  assert.equal(r.price?.amount, 149);
});

test('falls back to trial length when no date is written', () => {
  const r = parseTrialEmail('Welcome to Netflix! Enjoy your 7-day free trial.', dir, now);
  assert.equal(r.serviceName, 'Netflix');
  assert.equal(r.renewsOn, '2026-11-28');
});
