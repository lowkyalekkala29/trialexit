import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEmailType, extractOffer } from '../src/guess.js';

const mail = (subject, body) => `${subject}\nSender <x@y.com>\n${body}`;
const now = new Date('2026-11-21T10:00:00Z');

test('trial confirmations', () => {
  assert.equal(classifyEmailType(mail('Your TestRail trial is ready', 'Your 30-day trial expires on 21 Dec.')), 'trial');
  assert.equal(classifyEmailType(mail('Your free trial of YouTube Premium has started', "You'll be charged ₹149/month from 21 Dec.")), 'trial');
});

test('paid subscriptions: receipts and renewals', () => {
  assert.equal(classifyEmailType(mail('Your Netflix receipt', 'Thanks for your payment. Premium plan ₹649/month. Next billing date: 21 Dec.')), 'subscription');
  assert.equal(classifyEmailType(mail('Your Spotify Premium has been renewed', 'Amount charged ₹119. Your plan renews on 20 Dec.')), 'subscription');
  assert.equal(classifyEmailType(mail('Welcome to ChatGPT Plus', "You're now subscribed. $20 per month.")), 'subscription');
});

test('one-off shopping receipts are not subscriptions', () => {
  assert.equal(classifyEmailType(mail('Your Amazon order receipt', 'Order #123: USB cable ₹299. Delivered tomorrow.')), 'other');
});

test('cancellations', () => {
  assert.equal(classifyEmailType(mail('Your subscription has been cancelled', 'We are sorry to see you go. You can use Premium until 5 Dec.')), 'cancellation');
  assert.equal(classifyEmailType(mail('UPI AutoPay mandate revoked', 'Your AutoPay mandate for Netflix has been revoked.')), 'cancellation');
});

test('offers and discounts', () => {
  assert.equal(classifyEmailType(mail('50% off Prime Video for 3 months', 'Limited time offer. Valid till 30 Nov.')), 'offer');
  assert.equal(classifyEmailType(mail('Get YouTube Premium for just ₹10', 'Special offer: 3 months for just ₹10. Offer ends 5 Dec 2026.')), 'offer');
  const o = extractOffer(mail('50% off Prime Video', 'Limited time offer. Valid till 30 Nov.'), now);
  assert.equal(o.discount, '50% off');
  assert.equal(o.endsOn, '2026-11-30');
});

test('plain newsletters are other', () => {
  assert.equal(classifyEmailType(mail('Your weekly digest', 'Top stories for you.')), 'other');
});
