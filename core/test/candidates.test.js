import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectCandidates, candidateType } from '../../extension/src/mail-candidates.js';
import { dueReminder } from '../src/reminders.js';
import { pendingAlerts } from '../src/alerts.js';

const now = new Date();
const iso = (d) => d.toISOString();
const days = (n) => new Date(now.getTime() + n * 864e5);
async function* feed(list) { for (const m of list) yield m; }
const mail = (id, from, subject, body, date = iso(days(-1))) => ({ id, from, subject, date, text: `${subject}\n${from}\n${body}` });

test('sorts emails into trial, subscription, cancellation and offer', async () => {
  const { candidates, report } = await collectCandidates('gmail', feed([
    mail('1', 'TestRail <noreply@testrail.com>', 'Welcome to your TestRail trial', 'Your 30-day free trial of TestRail Cloud has started. Your trial ends in 30 days.'),
    mail('2', 'Spotify <no-reply@spotify.com>', 'Your receipt from Spotify', 'Thanks for your payment. Spotify Premium Individual ₹119 per month. Your subscription renews automatically.'),
    mail('3', 'Hotstar <noreply@hotstar.com>', 'Your subscription has been cancelled', "We're sorry to see you go. Your membership has been cancelled."),
    mail('4', 'Swiggy <offers@swiggy.in>', 'Flat 50% off on your next order', 'Use code SAVE50. Offer valid till 30 Dec. Limited time only.'),
  ]), { directory: [], trials: [] });
  const byType = Object.fromEntries(candidates.map((c) => [candidateType(c), c]));
  assert.ok(byType.trial, JSON.stringify(report.map((r) => [r.subject, r.verdict])));
  assert.equal(byType.subscription?.cycle, 'monthly');
  assert.ok(Date.parse(byType.subscription.renewsOn) > Date.now());
  assert.ok(byType.cancellation);
  assert.equal(byType.offer?.discount, '50% off');
});

test('subscription reminders: 3 days and 1 day before, once per cycle', () => {
  const sub = { id: 's', kind: 'subscription', cycle: 'monthly', status: 'active', renewsAt: iso(new Date(days(3).getTime() - 3600_000 + 60_000)) };
  // The 3-day rung became due a minute ago... adjust to be exactly due
  const at = new Date(Date.parse(sub.renewsAt) - 3 * 864e5 + 60_000);
  const due = dueReminder(sub, at, []);
  assert.match(due.kind, /^sub3d:\d{4}-\d\d-\d\d$/);
  assert.equal(dueReminder(sub, at, [due.kind]), null);
  assert.equal(dueReminder({ ...sub, status: 'confirmed_cancelled' }, at, []), null);
  const alerts = pendingAlerts([sub], now);
  assert.ok(alerts.some((a) => a.kind === 'sub1d'));
  assert.equal(pendingAlerts([sub], now, { skip: ['subscriptions'] }).length, 0);
});

test('TestRail-style wording without the word "trial" is still a trial', async () => {
  const { candidates } = await collectCandidates('gmail', feed([
    mail('9', 'TestRail <hello@gurock.com>', 'Your TestRail instance is ready', 'Welcome! You have 30 days to explore TestRail Cloud.'),
  ]), { directory: [], trials: [] });
  assert.equal(candidates.length, 1);
  assert.equal(candidateType(candidates[0]), 'trial');
  assert.ok(candidates[0].renewsOn);
});
