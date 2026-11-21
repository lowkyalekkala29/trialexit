import test from 'node:test';
import assert from 'node:assert/strict';
import { dueReminder } from '../src/reminders.js';
import { mergeTrials, toRow, fromRow } from '../src/sync.js';
import { signAction, verifyAction } from '../src/signing.js';
import { pendingAlerts } from '../src/alerts.js';

const H = 3600_000;
const renew = new Date('2026-12-10T00:00:00Z');
const trial = { renewsAt: renew.toISOString(), trialLengthDays: 7, status: 'active' };

test('dueReminder picks the newest due rung only', () => {
  const now = new Date(renew.getTime() - 23 * H); // 24h rung fired 1h ago
  assert.deepEqual(dueReminder(trial, now)?.kind, 'final');
  assert.equal(dueReminder(trial, now, ['final']), null);
});

test('dueReminder skips stale rungs and disabled rungs', () => {
  assert.equal(dueReminder(trial, new Date(renew.getTime() - 40 * H)), null); // 48h rung was 8h ago
  assert.equal(dueReminder(trial, new Date(renew.getTime() - 5.5 * H), [], ['urgent']), null);
});

test('dueReminder sends check-in after renewal, never pre-renewal rungs', () => {
  assert.equal(dueReminder(trial, new Date(renew.getTime() + 2.5 * H))?.kind, 'checkin');
  assert.equal(dueReminder({ ...trial, status: 'kept' }, new Date(renew.getTime() + 2.5 * H)), null);
});

test('pendingAlerts honours turned-off nudges', () => {
  const t = { id: 'x', serviceName: 'X', renewsAt: renew.toISOString(), trialLengthDays: 7, status: 'active' };
  const kinds = pendingAlerts([t], new Date('2026-12-01T00:00:00Z'), { skip: ['urgent', 'checkin'] }).map((a) => a.kind);
  assert.deepEqual(kinds, ['primary', 'final', 'lastcall']);
});

test('merge: newer edit wins, both directions', () => {
  const a = { id: '1', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', status: 'active' };
  const aNew = { ...a, updatedAt: '2026-11-03T00:00:00Z', status: 'kept' };
  const b = { id: '2', createdAt: '2026-11-01T00:00:00Z' };
  const r = mergeTrials({ trials: [aNew], tombstones: [] }, { trials: [a, b], tombstones: [] });
  assert.equal(r.trials.find((t) => t.id === '1').status, 'kept');
  assert.ok(r.trials.find((t) => t.id === '2'));
  assert.deepEqual(r.push.map((t) => t.id), ['1']);
});

test('merge: deletion on one device removes it everywhere, unless edited later', () => {
  const a = { id: '1', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' };
  const del = { id: '1', deletedAt: '2026-11-05T00:00:00Z' };
  const r = mergeTrials({ trials: [], tombstones: [del] }, { trials: [a], tombstones: [] });
  assert.equal(r.trials.length, 0);
  assert.deepEqual(r.pushDeletes.map((d) => d.id), ['1']);
  const edited = { ...a, updatedAt: '2026-11-06T00:00:00Z' };
  assert.equal(mergeTrials({ trials: [], tombstones: [del] }, { trials: [edited], tombstones: [] }).trials.length, 1);
});

test('row mapping round-trips', () => {
  const t = { id: '1', serviceId: 'netflix', region: 'IN', serviceName: 'Netflix', renewsAt: '2026-12-01T00:00:00.000Z', timezone: 'Asia/Kolkata', amount: 49900, currency: 'INR', trialLengthDays: 7, status: 'active', createdAt: '2026-11-21T00:00:00.000Z', cancelledAt: null, cancelUrlUsed: null, updatedAt: '2026-11-21T00:00:00.000Z' };
  const back = fromRow(toRow(t, 'u1'));
  for (const k of Object.keys(t)) assert.deepEqual(back[k], t[k], k);
});

test('signed email action links verify, and reject tampering and expiry', async () => {
  const p = { trialId: 't1', action: 'cancelled', exp: Date.now() + 1000 * 60 };
  const sig = await signAction(p, 'secret');
  assert.equal(await verifyAction(p, sig, 'secret'), true);
  assert.equal(await verifyAction({ ...p, action: 'kept' }, sig, 'secret'), false);
  assert.equal(await verifyAction(p, sig, 'other'), false);
  assert.equal(await verifyAction({ ...p, exp: Date.now() - 1 }, sig, 'secret'), false);
});

import { reminderEmail } from '../src/email.js';
test('reminder email: cancel button, one-click links, escaped content', () => {
  const m = reminderEmail({ name: 'Asha', kind: 'final', title: 'Netflix renews in under 24 hours', service: 'Netflix<script>', amount: '₹499.00', renews: 'Tue 25 Nov, 00:00 IST', cancelUrl: 'https://www.netflix.com/cancelplan', steps: ['Sign in'], requiresChat: false, cancelledLink: 'https://x/c', keptLink: 'https://x/k', chargedLink: 'https://x/ch', appUrl: 'https://app' });
  assert.match(m.subject, /^⏰ Netflix renews/);
  assert.match(m.html, /netflix\.com\/cancelplan/);
  assert.match(m.html, /https:\/\/x\/c/);
  assert.doesNotMatch(m.html, /<script>/);
  assert.match(m.text, /I'm keeping it: https:\/\/x\/k/);
});
