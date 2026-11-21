import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gmailMoneyEmails } from '../../extension/src/gmail-fetch.js';

const b64 = (s) => Buffer.from(s).toString('base64url');
const msgs = {
  m1: { subject: 'Your TestRail instance is ready', from: 'TestRail <hello@gurock.com>', snippet: 'Welcome! You have 30 days to explore TestRail Cloud.' },
  m2: { subject: 'Lunch tomorrow?', from: 'Ravi <ravi@example.com>', snippet: 'See you at 1' },
};
const full = (id) => ({ id, internalDate: String(Date.now()), snippet: msgs[id].snippet, payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: msgs[id].subject }, { name: 'From', value: msgs[id].from }, { name: 'Date', value: new Date().toUTCString() }], body: { data: b64(msgs[id].snippet) } } });

test('deep scan finds emails the phrase search misses, and only reads relevant ones in full', async () => {
  const fullReads = [];
  const api = async (path) => {
    if (path.startsWith('/messages?')) {
      const q = decodeURIComponent(path.split('q=')[1]);
      return q.startsWith('newer_than:60d -in:sent') ? { messages: [{ id: 'm1' }, { id: 'm2' }] } : { messages: [] };
    }
    const id = path.split('/')[2].split('?')[0];
    if (path.includes('format=metadata')) return { id, snippet: msgs[id].snippet, payload: { headers: [{ name: 'Subject', value: msgs[id].subject }, { name: 'From', value: msgs[id].from }] } };
    fullReads.push(id);
    return full(id);
  };
  const out = [];
  for await (const m of gmailMoneyEmails(api, { seen: new Set() })) out.push(m);
  assert.deepEqual(fullReads, ['m1']);
  assert.match(out[0].subject, /TestRail/);
});
