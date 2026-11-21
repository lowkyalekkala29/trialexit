import test from 'node:test';
import assert from 'node:assert/strict';
import { messageToText, htmlToText, decodeBase64Url, outlookMessageToText, OUTLOOK_SEARCH } from '../src/mail.js';

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('decodes base64url utf-8 including ₹', () => {
  assert.equal(decodeBase64Url(b64url('Pay ₹149')), 'Pay ₹149');
});

test('prefers text/plain inside multipart', () => {
  const msg = {
    id: 'm1',
    internalDate: '1763700000000',
    payload: {
      headers: [{ name: 'Subject', value: 'Your free trial has started' }, { name: 'From', value: 'Spotify <no-reply@spotify.com>' }],
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: b64url('<p>HTML version</p>') } },
        { mimeType: 'text/plain', body: { data: b64url('Plain: trial ends on 5 Dec') } },
      ],
    },
  };
  const r = messageToText(msg);
  assert.equal(r.subject, 'Your free trial has started');
  assert.match(r.text, /Plain: trial ends on 5 Dec/);
  assert.doesNotMatch(r.text, /HTML version/);
});

test('html fallback strips tags and styles', () => {
  assert.equal(htmlToText('<style>a{}</style><p>Renews on <b>Dec 5</b></p>'), 'Renews on Dec 5');
});

test('outlook message flattens sender, subject and html body', () => {
  const r = outlookMessageToText({
    id: 'o1',
    subject: 'Your Canva Pro trial',
    from: { emailAddress: { name: 'Canva', address: 'no-reply@canva.com' } },
    receivedDateTime: '2026-11-20T10:00:00Z',
    body: { contentType: 'html', content: '<p>Your trial ends on <b>Dec 4, 2026</b></p>' },
  });
  assert.equal(r.from, 'Canva <no-reply@canva.com>');
  assert.match(r.text, /Your trial ends on Dec 4, 2026/);
});

test('outlook search is a KQL OR of quoted phrases', () => {
  assert.match(OUTLOOK_SEARCH, /^"free trial" OR "trial ends"/);
});
