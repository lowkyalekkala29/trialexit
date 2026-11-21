import test from 'node:test';
import assert from 'node:assert/strict';
import { decideActivation, pageSignals, INTENT_TTL_MS } from '../src/activation.js';

const now = 1_800_000_000_000;
const checkout = { at: now - 60_000, submitted: true, host: 'app.example.com', url: 'https://app.example.com/checkout', analysis: { siteName: 'Example', days: { days: 14 } } };
const cur = (url, text) => ({ host: new URL(url).host, url, signals: pageSignals(url, text), analysis: { siteName: 'Example' } });

test('trial checkout signals: wording without success', () => {
  const s = pageSignals('https://x.com/pricing', 'Start your 14-day free trial. Then $12/month. Cancel anytime.');
  assert.deepEqual(s, { trial: true, success: false, successText: false });
});

test('ordinary page is quiet', () => {
  const s = pageSignals('https://news.com/article', 'The weather today is mild.');
  assert.deepEqual(s, { trial: false, success: false, successText: false });
  assert.equal(decideActivation({ intent: null, current: cur('https://news.com/a', 'hello'), now }).show, false);
});

test('submit on trial checkout then success page => high confidence, checkout data wins', () => {
  const r = decideActivation({ intent: checkout, current: cur('https://app.example.com/welcome', 'Welcome aboard'), now });
  assert.equal(r.show, true);
  assert.equal(r.confidence, 'high');
  assert.equal(r.analysis.days.days, 14);
});

test('submit then SPA route change counts too', () => {
  const r = decideActivation({ intent: checkout, current: cur('https://app.example.com/dashboard', 'Projects'), now });
  assert.equal(r.confidence, 'high');
});

test('submit but still on the same checkout URL (validation error) => quiet', () => {
  const r = decideActivation({ intent: checkout, current: cur('https://app.example.com/checkout', 'Card declined'), now });
  assert.equal(r.show, false);
});

test('stale checkout intent is ignored', () => {
  const old = { ...checkout, at: now - INTENT_TTL_MS - 1 };
  assert.equal(decideActivation({ intent: old, current: cur('https://app.example.com/home', 'Home'), now }).show, false);
});

test('success page that mentions a trial, no checkout seen => medium', () => {
  const r = decideActivation({ intent: null, current: cur('https://y.com/x', "You're all set! Your 7-day free trial has started."), now });
  assert.equal(r.confidence, 'medium');
});

test('success page without trial wording and no checkout => quiet (ordinary order confirmation)', () => {
  const r = decideActivation({ intent: null, current: cur('https://shop.com/thank-you', 'Thanks for your order #123'), now });
  assert.equal(r.show, false);
});

test('Apple Pay style: checkout seen, no click, then success => medium', () => {
  const r = decideActivation({ intent: { ...checkout, submitted: false }, current: cur('https://app.example.com/success', 'Done'), now });
  assert.equal(r.confidence, 'medium');
});

test('already tracked or muted => quiet', () => {
  assert.equal(decideActivation({ intent: checkout, current: cur('https://app.example.com/welcome', ''), now, alreadyTracked: true }).show, false);
  assert.equal(decideActivation({ intent: checkout, current: cur('https://app.example.com/welcome', ''), now, muted: true }).show, false);
});
