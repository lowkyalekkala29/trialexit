import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTrialEmail, parseTrialEmail } from '../src/guess.js';

const mail = (subject, body) => `${subject}\nSender <x@y.com>\n${body}`;

test('LinkedIn Premium promo is an ad, not a trial', () => {
  const r = classifyTrialEmail(mail('Try Premium free for 1 month', 'Get 1 month of LinkedIn Premium free. See who viewed your profile. Start your free trial. Unsubscribe'));
  assert.equal(r.kind, 'promo');
});

test('Adobe "start your free trial" marketing is an ad', () => {
  const r = classifyTrialEmail(mail('Limited-time offer: Creative Cloud', 'Start your 7-day free trial of Creative Cloud today. Offer ends Sunday.'));
  assert.equal(r.kind, 'promo');
});

test('a real trial confirmation is a confirmation', () => {
  const r = classifyTrialEmail(mail('Your free trial of YouTube Premium has started', "Starting December 21, 2026 you'll be charged ₹149.00/month. Cancel anytime."));
  assert.equal(r.kind, 'confirmation');
});

test('Apple / Play subscription receipts are confirmations', () => {
  assert.equal(classifyTrialEmail(mail('Your Subscription Confirmation', 'Free Trial. Renews December 5, 2026. ₹199/month.')).kind, 'confirmation');
  assert.equal(classifyTrialEmail(mail('Your Google Play Order Receipt', 'Free trial ends 3 Dec 2026, then ₹99/month')).kind, 'confirmation');
});

test('confirmation that also mentions an upsell stays a confirmation', () => {
  const r = classifyTrialEmail(mail('Welcome to your free trial', 'Your trial ends on 5 Dec. Upgrade to annual and save 20% off.'));
  assert.equal(r.kind, 'confirmation');
});

test('trial length counts from the email date, not today', () => {
  const dir = [{ name: 'Netflix', serviceId: 'netflix', region: 'IN', domains: ['netflix.com'] }];
  const r = parseTrialEmail('Welcome to Netflix! Your 7-day free trial has started.', dir, new Date('2026-11-10T10:00:00Z'));
  assert.equal(r.renewsOn, '2026-11-17');
});

test('limited-time offer that mentions a future charge is still an ad', () => {
  const r = classifyTrialEmail(mail('Limited time offer: 3 months for ₹99', "Get Premium for just ₹99. You'll be charged ₹199/month after 3 months. Offer ends Sunday."));
  assert.equal(r.kind, 'promo');
});

test('deal / sale subjects are ads', () => {
  assert.equal(classifyTrialEmail(mail('Black Friday deal: 50% off Pro', 'Your trial of Pro could be yours.')).kind, 'promo');
  assert.equal(classifyTrialEmail(mail('Only ₹49 for 2 months of Music', 'Subscribe today')).kind, 'promo');
});

test('a tie between confirmation and marketing counts as an ad', () => {
  assert.equal(classifyTrialEmail(mail('Your account update', 'Upgrade now. Thanks for subscribing.')).kind, 'promo');
});

test('a "trial ending" reminder means you are on a trial', () => {
  assert.equal(classifyTrialEmail(mail('Your account update', 'Upgrade now. Your trial ends on 5 Dec.')).kind, 'confirmation');
});

test('B2B / SaaS trial emails (TestRail style) are confirmations with a date', () => {
  const now = new Date('2026-11-21T10:00:00Z');
  const a = mail('Your TestRail trial is ready', 'Thanks for signing up for a 30-day TestRail trial. Your trial expires on December 21, 2026. Log in at yourcompany.testrail.io');
  assert.equal(classifyTrialEmail(a).kind, 'confirmation');
  const pa = parseTrialEmail(a, [], now);
  assert.equal(pa.renewsOn, '2026-12-21');
  assert.equal(pa.days?.days, 30);

  const b = mail('Welcome to TestRail', 'Your TestRail Cloud trial has been created. Your 30 day trial lets you explore all features.');
  assert.equal(classifyTrialEmail(b).kind, 'confirmation');
  assert.equal(parseTrialEmail(b, [], now).renewsOn, '2026-12-21');
});

test('B2B marketing ("start your 30-day trial") is still an ad', () => {
  assert.equal(classifyTrialEmail(mail('Start your 30-day free trial of TestRail', 'Try TestRail free for 30 days. Limited offer.')).kind, 'promo');
});

test('real confirmation subject wins even with an upsell in the body', () => {
  assert.equal(classifyTrialEmail(mail('Your free trial has started', "You'll be charged on 5 Dec. Upgrade to annual and save 20%.")).kind, 'confirmation');
});

import { extractRenewalDate } from '../src/guess.js';
test('a past date without a year is past, not next year', () => {
  const now = new Date('2026-11-21T10:00:00Z');
  assert.equal(extractRenewalDate('Your plan renews on 20 Sept', now)?.date, '2026-09-20');
  assert.equal(extractRenewalDate('Trial ends on 3 Jan', new Date('2026-12-20T10:00:00Z'))?.date, '2027-01-03');
});
