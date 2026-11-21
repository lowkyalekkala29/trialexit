/**
 * Accounts. Passwordless: Google, Microsoft, or a 6-digit email code.
 * Talks to Supabase Auth over plain REST (no SDK, so it runs unchanged in the
 * extension, its service worker and the web app).
 *
 * The session lives in chrome.storage.local (real in the extension, the
 * localStorage adapter on the web).
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, CLOUD_ENABLED } from './config.js';

const KEY = 'session';
const IS_EXTENSION = typeof location !== 'undefined' ? location.protocol === 'chrome-extension:' : true;

/** @typedef {{ access_token: string, refresh_token: string, expires_at: number, user: { id: string, email: string, name?: string, provider?: string }, preview?: boolean }} Session */

async function call(path, body, token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || data.error_description || data.message || `auth-${res.status}`);
  return data;
}

function toSession(d) {
  const meta = d.user?.user_metadata ?? {};
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: Date.now() + Number(d.expires_in ?? 3600) * 1000,
    user: {
      id: d.user?.id,
      email: d.user?.email,
      name: meta.full_name || meta.name || '',
      provider: d.user?.app_metadata?.provider ?? 'email',
    },
  };
}

/** @returns {Promise<Session|null>} */
export async function getSession() {
  const s = (await chrome.storage.local.get(KEY))[KEY] ?? null;
  if (!s || s.preview || !CLOUD_ENABLED) return s;
  if (s.expires_at - Date.now() > 60_000) return s;
  try {
    const fresh = toSession(await call('/token?grant_type=refresh_token', { refresh_token: s.refresh_token }));
    await chrome.storage.local.set({ [KEY]: fresh });
    return fresh;
  } catch {
    return s; // offline: keep the stale session; API calls will retry later
  }
}

async function store(session) {
  await chrome.storage.local.set({ [KEY]: session });
  return session;
}

/**
 * Which sign-in methods are switched on in the Supabase project, so the UI
 * never offers a button that would only error.
 * @returns {Promise<{ google: boolean, azure: boolean, email: boolean }>}
 */
export async function getProviders() {
  if (!CLOUD_ENABLED) return { google: true, azure: true, email: true };
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } });
    const d = await res.json();
    return { google: Boolean(d.external?.google), azure: Boolean(d.external?.azure), email: d.external?.email !== false };
  } catch {
    return { google: false, azure: false, email: true };
  }
}

/** Step 1 of email sign-in: send a 6-digit code. */
export async function sendCode(email) {
  if (!CLOUD_ENABLED) return { preview: true };
  // Web: the email's sign-in link brings you back to this app.
  const back = IS_EXTENSION ? '' : `?redirect_to=${encodeURIComponent(`${location.origin}${location.pathname}`)}`;
  await call(`/otp${back}`, { email, create_user: true });
  return { ok: true };
}

/** Step 2: verify the code → signed in. */
export async function verifyCode(email, code) {
  if (!CLOUD_ENABLED) {
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code');
    return store({ access_token: 'preview', refresh_token: '', expires_at: Infinity, preview: true, user: { id: 'preview-user', email, name: '', provider: 'email' } });
  }
  return store(toSession(await call('/verify', { type: 'email', email, token: code })));
}

/**
 * Google / Microsoft. Web: full-page redirect, finished by completeRedirect().
 * Extension: chrome.identity.launchWebAuthFlow popup.
 * @param {'google'|'azure'} provider
 */
export async function signInWithProvider(provider) {
  if (!CLOUD_ENABLED) {
    const email = provider === 'google' ? 'you@gmail.com' : 'you@outlook.com';
    return store({ access_token: 'preview', refresh_token: '', expires_at: Infinity, preview: true, user: { id: 'preview-user', email, name: '', provider } });
  }
  const redirect = IS_EXTENSION ? chrome.identity.getRedirectURL() : `${location.origin}${location.pathname}`;
  const url = `${SUPABASE_URL}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirect)}${
    provider === 'azure' ? '&scopes=email' : ''
  }`;
  if (!IS_EXTENSION) {
    location.href = url;
    return null;
  }
  const final = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  return finishFromHash(new URL(final ?? '').hash);
}

/** Web only: after the OAuth redirect lands back on the app. */
export async function completeRedirect() {
  if (IS_EXTENSION) return null;
  if (/[#&]error(_description)?=/.test(location.hash)) {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    history.replaceState(null, '', location.pathname + '#/signin');
    const code = p.get('error_code') ?? '';
    throw new Error(
      /expired/.test(code + p.get('error_description'))
        ? 'That sign-in link has expired or was already used. Enter your email to get a new one.'
        : p.get('error_description')?.replace(/\+/g, ' ') || 'Sign-in failed. Please try again.',
    );
  }
  if (!location.hash.includes('access_token=')) return null;
  const session = await finishFromHash(location.hash);
  history.replaceState(null, '', location.pathname + '#/');
  return session;
}

async function finishFromHash(hash) {
  const p = new URLSearchParams(String(hash).replace(/^#/, ''));
  if (p.get('error')) throw new Error(p.get('error_description') || p.get('error'));
  const access = p.get('access_token');
  if (!access) throw new Error('Sign-in was cancelled');
  const user = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${access}` },
  }).then((r) => r.json());
  return store(
    toSession({ access_token: access, refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in'), user }),
  );
}

export async function signOut() {
  const s = await getSession();
  if (s && !s.preview && CLOUD_ENABLED) await call('/logout', {}, s.access_token).catch(() => {});
  await chrome.storage.local.remove([KEY, 'lastSync']);
}

export async function updateUserName(name) {
  const s = await getSession();
  if (!s) return;
  if (!s.preview && CLOUD_ENABLED) {
    await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ data: { full_name: name } }),
    }).catch(() => {});
  }
  await store({ ...s, user: { ...s.user, name } });
}
