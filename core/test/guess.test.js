import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTrialDays,
  extractPrice,
  detectPhase,
  deriveRenewal,
  derivationNote,
} from '../src/guess.js';

test('reads a standard day-length trial', () => {
  const g = extractTrialDays('Start your 14-day free trial today');
  assert.equal(g?.days, 14);
  assert.equal(g?.confidence, 'high');
});

test('reads "first N days" phrasing', () => {
  assert.equal(extractTrialDays('Your first 30 days are on us')?.days, 30);
});

test('reads "N days on us"', () => {
  assert.equal(extractTrialDays('7 days on us, cancel any time')?.days, 7);
});

test('reads weeks and months', () => {
  assert.equal(extractTrialDays('A 2-week free trial')?.days, 14);
  assert.equal(extractTrialDays('One month free trial: 1-month free')?.days, 30);
});

test('refuses to mistake a money-back guarantee for a trial', () => {
  assert.equal(extractTrialDays('Every plan includes a 30-day money-back guarantee'), null);
  assert.equal(extractTrialDays('Cancel within 14 days for a full refund'), null);
});

test('downgrades confidence when the page also mentions refunds', () => {
  const g = extractTrialDays('14-day free trial. 30-day refund policy applies.');
  assert.equal(g?.days, 14);
  assert.equal(g?.confidence, 'low');
});

test('rejects absurd lengths', () => {
  assert.equal(extractTrialDays('999-day free trial'), null);
});

test('returns null when the page says nothing useful', () => {
  assert.equal(extractTrialDays('Sign in to continue'), null);
  assert.equal(extractTrialDays(''), null);
});

test('prefers a per-month price over a stray number', () => {
  const p = extractPrice('Save 20%. Then ₹1,675/month after the trial.');
  assert.equal(p?.amount, 1675);
  assert.equal(p?.currency, 'INR');
  assert.equal(p?.confidence, 'high');
});

test('handles USD per-month pricing', () => {
  const p = extractPrice('Only $19.99/month after your trial');
  assert.equal(p?.amount, 19.99);
  assert.equal(p?.currency, 'USD');
});

test('falls back to a low-confidence bare price', () => {
  const p = extractPrice('Plans from ₹499');
  assert.equal(p?.amount, 499);
  assert.equal(p?.currency, 'INR');
  assert.equal(p?.confidence, 'low');
});

test('detects post-signup state from text and from the URL', () => {
  assert.equal(detectPhase("You're all set! Your trial has started.", 'https://x.com/home'), 'post-signup');
  assert.equal(detectPhase('Welcome back', 'https://x.com/welcome'), 'post-signup');
  assert.equal(detectPhase('Start your free trial', 'https://x.com/pricing'), 'pricing');
  assert.equal(detectPhase('Sign in', 'https://x.com/login'), 'unknown');
});

test('derives a renewal instant N days out', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  assert.equal(deriveRenewal(now, 14), '2026-12-04T10:00:00.000Z');
});

test('the derivation note names what was read', () => {
  const note = derivationNote({
    days: { days: 14, confidence: 'high', matched: '14-day free trial' },
    price: { amount: 1675, currency: 'INR', confidence: 'high', matched: '₹1,675/month' },
    phase: 'post-signup',
  });
  assert.match(note, /14-day trial/);
  assert.match(note, /₹1675/);
  assert.match(note, /confirmation page/);
});
