import test from 'node:test';
import assert from 'node:assert/strict';
import { nextCharge, monthlySpend, moneyProtected, protectedBy, upcomingCharges, detectCycle, addCycle } from '../src/money.js';
import { transition, derivedStatus } from '../src/store.js';

const now = new Date('2026-11-21T10:00:00Z');
const sub = (o) => ({ id: 's', kind: 'subscription', cycle: 'monthly', serviceName: 'Netflix', amount: 64900, currency: 'INR', renewsAt: '2026-09-05T00:00:00Z', status: 'active', ...o });

test('subscription rolls to its next charge and never shows as charged', () => {
  assert.equal(nextCharge(sub(), now).toISOString(), '2026-12-05T00:00:00.000Z');
  assert.equal(derivedStatus(sub(), now), 'active');
  assert.equal(nextCharge(sub({ cycle: 'yearly', renewsAt: '2026-03-01T00:00:00Z' }), now).toISOString(), '2027-03-01T00:00:00.000Z');
});

test('monthly spend normalises cycles', () => {
  const s = monthlySpend([sub(), sub({ cycle: 'yearly', amount: 120000 }), sub({ status: 'confirmed_cancelled' }), { kind: 'trial', amount: 999, currency: 'INR' }]);
  assert.equal(s.INR, 64900 + 10000);
});

test('money protected: trial cancelled in time counts once; subscription counts each skipped renewal', () => {
  const trial = { amount: 49900, currency: 'INR', renewsAt: '2026-11-25T00:00:00Z', status: 'confirmed_cancelled', cancelledAt: '2026-11-20T00:00:00Z' };
  assert.equal(protectedBy(trial, now), 49900);
  const late = { ...trial, cancelledAt: '2026-11-26T00:00:00Z' };
  assert.equal(protectedBy(late, now), 0);
  // cancelled 10 Sep; renewals 5 Oct and 5 Nov have passed → 2 charges avoided
  const s = sub({ status: 'confirmed_cancelled', cancelledAt: '2026-09-10T00:00:00Z' });
  assert.equal(protectedBy(s, now), 2 * 64900);
  assert.equal(moneyProtected([trial, s], now).INR, 49900 + 2 * 64900);
});

test('keeping a trial turns it into a monthly subscription', () => {
  const t = { id: 't', kind: 'trial', status: 'active', renewsAt: '2026-11-25T00:00:00Z', amount: 100, currency: 'INR' };
  const [k] = transition([t], 't', 'kept', now);
  assert.equal(k.kind, 'subscription');
  assert.equal(k.cycle, 'monthly');
  assert.equal(k.status, 'active');
});

test('upcoming charges include trial conversions and subscription renewals', () => {
  const items = [sub({ renewsAt: '2026-11-24T00:00:00Z' }), { kind: 'trial', status: 'active', renewsAt: '2026-11-23T00:00:00Z', amount: 1, currency: 'INR' }, sub({ renewsAt: '2026-12-20T00:00:00Z' })];
  assert.equal(upcomingCharges(items, now, 7).length, 2);
});

test('billing cycle detection', () => {
  assert.equal(detectCycle('₹649/month'), 'monthly');
  assert.equal(detectCycle('Billed annually'), 'yearly');
  assert.equal(detectCycle('₹199 per week'), 'weekly');
  assert.equal(detectCycle('quarterly plan'), 'quarterly');
  assert.equal(detectCycle('Thanks!'), null);
  assert.equal(addCycle(new Date('2026-01-31T00:00:00Z'), 'monthly').toISOString().slice(0, 7), '2026-03');
});
