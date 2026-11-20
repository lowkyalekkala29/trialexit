import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pendingAlerts,
  alarmName,
  parseAlarmName,
  notificationTitle,
  notificationBody,
} from '../src/alerts.js';

const now = new Date('2026-11-20T00:00:00Z');

/** @param {Partial<import('../src/types.js').Trial>} over */
const trial = (over = {}) => ({
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
  ...over,
});

test('a week-long trial schedules two alerts, primary first', () => {
  const alerts = pendingAlerts([trial()], now);
  assert.deepEqual(alerts.map((a) => a.kind), ['primary', 'final']);
});

test('cancelled and charged trials schedule nothing', () => {
  const done = trial({ status: 'confirmed_cancelled', cancelledAt: now.toISOString() });
  const charged = trial({ renewsAt: '2026-11-19T00:00:00+05:30' });
  assert.equal(pendingAlerts([done, charged], now).length, 0);
});

test('a trial added inside 24h still gets an immediate nudge', () => {
  const soon = trial({ renewsAt: new Date(now.getTime() + 3 * 3600_000).toISOString() });
  const alerts = pendingAlerts([soon], now);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'immediate');
  assert.ok(new Date(alerts[0].at).getTime() > now.getTime());
});

test('alarm names round-trip and reject foreign names', () => {
  const parsed = parseAlarmName('trial:abc-123:final');
  assert.deepEqual(parsed, { trialId: 'abc-123', kind: 'final' });
  assert.equal(parseAlarmName('badge-refresh'), null);
  assert.equal(parseAlarmName('trial:only-two'), null);
  assert.equal(alarmName({ trialId: 'abc-123', at: '', kind: 'final', label: '' }), 'trial:abc-123:final');
});

test('notification copy names the amount so the alert is actionable', () => {
  assert.equal(notificationTitle(trial(), 'primary'), 'Cancel your Netflix trial');
  assert.equal(notificationTitle(trial(), 'final'), 'Netflix renews in under 24 hours');
  assert.match(notificationBody(trial()), /499/);
});
