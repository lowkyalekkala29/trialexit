// Emails the next due nudge for every open trial. Triggered by pg_cron every 15 min.
// Function secret: BREVO_API_KEY (set in the dashboard). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are automatic. cron_secret, action_secret, app_url
// and mail_from live in private.app_config (generated in the database).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { dueReminder } from '../_shared/reminders.js';
import { notificationTitle } from '../_shared/alerts.js';
import { signAction } from '../_shared/signing.js';
import { formatMoney, formatRenewalLocal } from '../_shared/dates.js';
import { reminderEmail } from '../_shared/email.js';
import { nextCharge } from '../_shared/money.js';

const env = (k: string) => Deno.env.get(k) ?? '';

Deno.serve(async (req) => {
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const cfg = async (k: string) => (await db.rpc('app_config', { key: k })).data ?? '';
  if (!req.headers.get('x-cron-secret') || req.headers.get('x-cron-secret') !== (await cfg('cron_secret'))) {
    return new Response('forbidden', { status: 403 });
  }
  const [actionSecret, appUrl, mailFrom] = [await cfg('action_secret'), await cfg('app_url'), await cfg('mail_from')];
  if (!env('BREVO_API_KEY') || !mailFrom) return Response.json({ ok: false, reason: 'email sending not configured yet' });
  const now = new Date();
  const from = new Date(now.getTime() - 6 * 3600_000).toISOString();
  const to = new Date(now.getTime() + 6 * 86_400_000).toISOString();

  const sel = '*, profiles!inner(name, reminder_email, reminder_skip)';
  const [trialQ, subQ] = await Promise.all([
    db.from('trials').select(sel).is('deleted_at', null).neq('kind', 'subscription')
      .in('status', ['active', 'awaiting_confirmation']).gte('renews_at', from).lte('renews_at', to),
    // Subscriptions repeat, so every live one is checked for its next renewal.
    db.from('trials').select(sel).is('deleted_at', null).eq('kind', 'subscription').neq('status', 'confirmed_cancelled'),
  ]);
  const error = trialQ.error ?? subQ.error;
  if (error) return new Response(error.message, { status: 500 });
  const rows = [...(trialQ.data ?? []), ...(subQ.data ?? [])];

  // Cancel links come from the public, community-maintained directory.
  const directory = await fetch('https://raw.githubusercontent.com/lowkyalekkala29/trialexit/main/directory/directory.json')
    .then((r) => r.json())
    .catch(() => ({ entries: [] }));

  let sent = 0;
  const failures: string[] = [];
  for (const r of rows) {
    if (!r.profiles?.reminder_email) continue;
    const { data: log } = await db.from('reminder_log').select('kind').eq('trial_id', r.id);
    const trial = { renewsAt: r.renews_at, trialLengthDays: r.trial_length_days, status: r.status, kind: r.kind, cycle: r.cycle };
    const due = dueReminder(trial, now, (log ?? []).map((l) => l.kind), r.profiles.reminder_skip ?? []);
    if (!due) continue;

    // Claim the rung first: a duplicate run hits the primary key and skips.
    const { error: claim } = await db.from('reminder_log').insert({ trial_id: r.id, kind: due.kind });
    if (claim) continue;

    const { data: user } = await db.auth.admin.getUserById(r.user_id);
    const to = user?.user?.email;
    if (!to) continue;
    const entry =
      directory.entries.find((e: any) => e.serviceId === r.service_id && e.region === r.region) ??
      directory.entries.find((e: any) => e.serviceId === r.service_id);
    const exp = Date.now() + 14 * 86_400_000;
    const link = async (action: string) =>
      `${env('SUPABASE_URL')}/functions/v1/trial-action?t=${r.id}&a=${action}&e=${exp}&s=${await signAction({ trialId: r.id, action, exp }, actionSecret)}`;
    const t = { serviceName: r.service_name, amount: r.amount, currency: r.currency };
    const baseKind = due.kind.split(':')[0];
    const chargeAt = r.kind === 'subscription' ? nextCharge(trial, now).toISOString() : r.renews_at;
    const mail = reminderEmail({
      name: r.profiles.name,
      kind: baseKind,
      title: notificationTitle(t as any, baseKind as any),
      service: r.service_name,
      amount: r.amount ? formatMoney(r.amount, r.currency) : null,
      renews: formatRenewalLocal(chargeAt, r.timezone),
      cancelUrl: entry?.cancelUrl ?? null,
      steps: entry?.steps ?? [],
      requiresChat: Boolean(entry?.requiresChat),
      cancelledLink: await link('cancelled'),
      keptLink: await link('kept'),
      chargedLink: await link('charged'),
      appUrl,
    });
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env('BREVO_API_KEY'), 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: parseSender(mailFrom),
        to: [{ email: to }],
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text,
      }),
    });
    if (res.ok) sent++;
    else {
      // Keep the provider's reason (no keys or addresses) so failures are diagnosable.
      failures.push(`brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
      await db.from('reminder_log').delete().eq('trial_id', r.id).eq('kind', due.kind); // retry next run
    }
  }
  return Response.json({ ok: failures.length === 0, checked: rows.length, sent, failures });
});

function parseSender(v: string) {
  const m = v.match(/^\s*(.*?)\s*<(.+)>\s*$/);
  return m ? { name: m[1] || 'TrialExit', email: m[2] } : { name: 'TrialExit', email: v };
}
