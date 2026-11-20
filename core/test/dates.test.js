import test from 'node:test';
import assert from 'node:assert/strict';
import {
  zonedWallTimeToInstant,
  zoneOffsetMs,
  primaryLeadMs,
  alertSchedule,
  urgency,
  formatCountdown,
  trialLengthDays,
  HOUR,
  DAY,
} from '../src/dates.js';

test('IST wall time converts to the correct UTC instant', () => {
  const d = zonedWallTimeToInstant('2026-11-27', '00:00', 'Asia/Kolkata');
  assert.equal(d.toISOString(), '2026-11-26T18:30:00.000Z');
});

test('offset handles DST in New York (summer vs winter)', () => {
  const summer = zoneOffsetMs(new Date('2026-07-01T12:00:00Z'), 'America/New_York');
  const winter = zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), 'America/New_York');
  assert.equal(summer, -4 * HOUR);
  assert.equal(winter, -5 * HOUR);
});

test('DST spring-forward: same morning, offset changes across 02:00 local', () => {
  // 2026-03-08 is the US spring-forward date. 01:30 is EST (-5), 03:30 is EDT (-4).
  const beforeJump = zonedWallTimeToInstant('2026-03-08', '01:30', 'America/New_York');
  const afterJump = zonedWallTimeToInstant('2026-03-08', '03:30', 'America/New_York');
  assert.equal(beforeJump.toISOString(), '2026-03-08T06:30:00.000Z');
  assert.equal(afterJump.toISOString(), '2026-03-08T07:30:00.000Z');
  // Two wall-clock hours apart must be only one real hour apart.
  assert.equal(afterJump.getTime() - beforeJump.getTime(), HOUR);
});

test('same wall clock in different zones yields different instants', () => {
  const ist = zonedWallTimeToInstant('2026-11-27', '00:00', 'Asia/Kolkata');
  const utc = zonedWallTimeToInstant('2026-11-27', '00:00', 'UTC');
  assert.equal(utc.getTime() - ist.getTime(), 5.5 * HOUR);
});

test('lead time is adaptive: short trials 48h, long trials 5 days', () => {
  assert.equal(primaryLeadMs(7), 48 * HOUR);
  assert.equal(primaryLeadMs(14), 48 * HOUR);
  assert.equal(primaryLeadMs(15), 5 * DAY);
  assert.equal(primaryLeadMs(30), 5 * DAY);
});

test('alert schedule drops past alerts and keeps ordering', () => {
  const renewal = '2026-12-01T00:00:00+05:30';
  const now = new Date('2026-11-29T00:00:00Z'); // primary (48h) already passed
  const alerts = alertSchedule(renewal, 7, now);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'final');
});

test('alert schedule for a 30 day trial fires 5 days out plus a 24h ping', () => {
  const renewal = '2026-12-31T00:00:00+05:30';
  const now = new Date('2026-12-01T00:00:00Z');
  const alerts = alertSchedule(renewal, 30, now);
  assert.deepEqual(
    alerts.map((a) => a.kind),
    ['primary', 'final'],
  );
});

test('urgency bands', () => {
  const now = new Date('2026-11-20T00:00:00Z');
  const at = (h) => new Date(now.getTime() + h * HOUR).toISOString();
  assert.equal(urgency(at(-1), now), 'past_due');
  assert.equal(urgency(at(1), now), 'critical');
  assert.equal(urgency(at(47), now), 'critical');
  assert.equal(urgency(at(49), now), 'soon');
  assert.equal(urgency(at(24 * 6), now), 'soon');
  assert.equal(urgency(at(24 * 8), now), 'safe');
});

test('countdown formatting', () => {
  assert.equal(formatCountdown(-1), 'passed');
  assert.equal(formatCountdown(15), '0m');
  assert.equal(formatCountdown(65 * 60_000), '1h 05m');
  assert.equal(formatCountdown(3 * DAY + 4 * HOUR), '3d 4h');
});

test('trial length floors partial days and never returns zero', () => {
  assert.equal(trialLengthDays('2026-11-20T00:00:00Z', '2026-11-27T00:00:00Z'), 7);
  assert.equal(trialLengthDays('2026-11-20T00:00:00Z', '2026-11-20T06:00:00Z'), 1);
});
