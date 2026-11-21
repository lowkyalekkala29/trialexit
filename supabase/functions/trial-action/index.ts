// One-click "I cancelled" / "Keeping it" / "I got charged" from a reminder email.
// The link is HMAC-signed by send-reminders; nothing else can trigger a change.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { verifyAction } from '../_shared/signing.js';

const env = (k: string) => Deno.env.get(k) ?? '';
let appUrl = '';
const STATUS: Record<string, string> = { cancelled: 'confirmed_cancelled', kept: 'kept', charged: 'charged' };
const COPY: Record<string, string> = {
  cancelled: 'Marked as cancelled. Nice save — no more reminders for this one.',
  kept: "Got it — it's now in your Subscriptions. We'll remind you before each renewal.",
  charged: 'Marked as charged. Cancel now to stop the next cycle, then ask support for a refund.',
};

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const p = { trialId: u.searchParams.get('t') ?? '', action: u.searchParams.get('a') ?? '', exp: Number(u.searchParams.get('e')) };
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const cfg = async (k: string) => (await db.rpc('app_config', { key: k })).data ?? '';
  appUrl = await cfg('app_url');
  const ok = STATUS[p.action] && (await verifyAction(p, u.searchParams.get('s') ?? '', await cfg('action_secret')));
  if (!ok) return page('This link has expired or is invalid.', 'Open TrialExit to update the trial there.', 400);
  const now = new Date().toISOString();
  const { error } = await db
    .from('trials')
    .update(
      p.action === 'kept'
        ? // Keeping a trial makes it a subscription we keep watching each month.
          { kind: 'subscription', cycle: 'monthly', status: 'active', updated_at: now }
        : { status: STATUS[p.action], updated_at: now, ...(p.action === 'cancelled' ? { cancelled_at: now } : {}) },
    )
    .eq('id', p.trialId)
    .is('deleted_at', null);
  if (error) return page('Something went wrong.', 'Please update the trial in TrialExit.', 500);
  return page('Done ✓', COPY[p.action]);
});

function page(title: string, body: string, status = 200) {
  const app = appUrl;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TrialExit</title>
<body style="margin:0;background:#f6f7f9;font:16px/1.5 -apple-system,'Segoe UI',system-ui,sans-serif;color:#111827;display:grid;place-items:center;min-height:100vh">
<div style="background:#fff;border:1px solid #e4e7eb;border-radius:16px;padding:32px;max-width:420px;margin:16px;text-align:center">
<div style="width:40px;height:40px;border-radius:10px;background:#16a34a;color:#fff;display:grid;place-items:center;margin:0 auto 14px;font-weight:800">✓</div>
<h1 style="font-size:20px;margin:0 0 8px">${esc(title)}</h1><p style="color:#6b7280;margin:0 0 20px">${esc(body)}</p>
<a href="${esc(app)}/app/" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600">Open TrialExit</a></div>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}
