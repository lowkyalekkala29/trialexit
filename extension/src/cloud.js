/**
 * Account data: profile + trials sync, export, account deletion.
 * Works from the dashboard and from the extension's service worker.
 * In preview mode every call is a no-op that reports success.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, CLOUD_ENABLED } from './config.js';
import { getSession } from './auth.js';
import { mergeTrials, toRow, fromRow } from './core/sync.js';

async function rest(session, path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${session.access_token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`sync-${res.status}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

const live = (s) => s && !s.preview && CLOUD_ENABLED;

/** Settings fields that belong to the account (everything else is device-local). */
export const PROFILE_FIELDS = ['name', 'region', 'timezone', 'onboarded', 'reminderEmail', 'reminderSkip'];

export async function pushProfile(settings) {
  const s = await getSession();
  if (!live(s)) return { ok: true, preview: true };
  await rest(s, '/profiles', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      id: s.user.id,
      name: settings.name ?? null,
      region: settings.region ?? 'IN',
      timezone: settings.timezone ?? 'UTC',
      onboarded: Boolean(settings.onboarded),
      reminder_email: settings.reminderEmail !== false,
      reminder_skip: settings.reminderSkip ?? [],
      updated_at: new Date().toISOString(),
    }),
  });
  return { ok: true };
}

export async function pullProfile() {
  const s = await getSession();
  if (!live(s)) return null;
  const [p] = (await rest(s, `/profiles?id=eq.${s.user.id}&select=*`)) ?? [];
  if (!p) return null;
  return {
    name: p.name ?? '',
    region: p.region,
    timezone: p.timezone,
    onboarded: p.onboarded,
    reminderEmail: p.reminder_email,
    reminderSkip: p.reminder_skip ?? [],
    plan: p.plan,
  };
}

/**
 * Two-way trial sync. Safe to call often; does nothing when signed out.
 * @returns {Promise<{ ok: boolean, preview?: boolean, pulled?: number, pushed?: number, error?: string }>}
 */
export async function syncTrials() {
  const s = await getSession();
  if (!live(s)) return { ok: true, preview: Boolean(s?.preview) };
  try {
    const rows = (await rest(s, '/trials?select=*')) ?? [];
    const remote = {
      trials: rows.filter((r) => !r.deleted_at).map(fromRow),
      tombstones: rows.filter((r) => r.deleted_at).map((r) => ({ id: r.id, deletedAt: r.deleted_at })),
    };
    const got = await chrome.storage.local.get(['trials', 'tombstones']);
    const local = { trials: got.trials ?? [], tombstones: got.tombstones ?? [] };
    const m = mergeTrials(local, remote);
    if (m.push.length) {
      await rest(s, '/trials', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(m.push.map((t) => toRow(t, s.user.id))),
      });
    }
    for (const d of m.pushDeletes) {
      await rest(s, `/trials?id=eq.${d.id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: d.deletedAt, updated_at: d.deletedAt }) }).catch(() => {});
    }
    // Only write if something changed, so storage listeners don't loop.
    if (JSON.stringify(m.trials) !== JSON.stringify(local.trials) || m.tombstones.length !== local.tombstones.length) {
      await chrome.storage.local.set({ trials: m.trials, tombstones: m.tombstones });
    }
    await chrome.storage.local.set({ lastSync: new Date().toISOString() });
    return { ok: true, pulled: rows.length, pushed: m.push.length };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export async function deleteAccount() {
  const s = await getSession();
  if (live(s)) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${s.access_token}` },
    });
    if (!res.ok) throw new Error('Could not delete the account. Try again or contact support.');
  }
  const keep = await chrome.storage.local.get('bundledDirectory');
  await chrome.storage.local.clear?.();
  if (!chrome.storage.local.clear) {
    for (const k of ['trials', 'tombstones', 'settings', 'session', 'mailCandidates', 'mailSeen', 'mutedHosts', 'lastSync'])
      await chrome.storage.local.remove(k);
  }
  if (keep.bundledDirectory) await chrome.storage.local.set(keep);
}
