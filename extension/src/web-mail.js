/**
 * Gmail scan for the WEB app. Same privacy model as the extension:
 *  - Google's own consent popup asks for read-only Gmail access, separately
 *    from sign-in (incremental authorization).
 *  - Matching emails go straight from Gmail into this browser tab, are parsed
 *    here, and are never uploaded. Only the user-confirmed trials are saved.
 *  - The access token lives in memory/sessionStorage for at most an hour; no
 *    refresh token exists anywhere, so nothing can read the inbox in the
 *    background or from a server.
 */
import { GOOGLE_CLIENT_ID } from './config.js';
import { GMAIL_QUERY, messageToText } from './core/mail.js';
import { collectCandidates } from './mail-candidates.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.messages.readonly';
const TOKEN_KEY = 'trialexit:gmail-token';
const MAX_MESSAGES = 40;

export function loadGis() {
  if (/** @type {any} */ (window).google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    const sc = existing ?? document.createElement('script');
    const done = () => (/** @type {any} */ (window).google?.accounts?.oauth2 ? resolve(undefined) : reject(new Error('google-unavailable')));
    sc.addEventListener('load', done);
    sc.addEventListener('error', () => reject(new Error('google-unavailable')));
    setTimeout(done, 6000);
    if (!existing) {
      /** @type {HTMLScriptElement} */ (sc).src = 'https://accounts.google.com/gsi/client';
      /** @type {HTMLScriptElement} */ (sc).async = true;
      document.head.append(sc);
    }
  });
}

function cachedToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null');
    return t && t.expiresAt > Date.now() + 60_000 ? t.token : null;
  } catch {
    return null;
  }
}

/**
 * Must be called from a click (Google opens a popup).
 * @param {string} [hint] the signed-in email, so Google preselects that account
 */
export async function requestGmailAccess(hint) {
  if (!(/** @type {any} */ (window).google?.accounts?.oauth2)) await loadGis();
  return new Promise((resolve, reject) => {
    const client = /** @type {any} */ (window).google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      include_granted_scopes: true,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error === 'access_denied' ? 'no-token' : resp.error));
        if (!/** @type {any} */ (window).google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
          return reject(new Error('scope-not-granted'));
        }
        try {
          sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: resp.access_token, expiresAt: Date.now() + Number(resp.expires_in ?? 3600) * 1000 }));
        } catch {
          /* private mode: keep it in memory only */
        }
        resolve(resp.access_token);
      },
      error_callback: (err) =>
        reject(new Error(err?.type === 'popup_closed' ? 'no-token' : err?.type === 'popup_failed_to_open' ? 'popup-blocked' : err?.type ?? 'no-token')),
    });
    client.requestAccessToken({ prompt: '', login_hint: hint || undefined });
  });
}

async function gmail(token, path) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    throw new Error('expired');
  }
  if (res.status === 403) {
    // Two very different 403s: the API is switched off in the Google Cloud
    // project (owner must enable it), or the user didn't grant Gmail access.
    const body = await res.text().catch(() => '');
    if (/SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(body)) throw new Error('gmail-api-disabled');
    throw new Error('scope-not-granted');
  }
  if (!res.ok) throw new Error(`gmail-${res.status}`);
  return res.json();
}

async function* messages(token, seen) {
  const list = await gmail(token, `/messages?maxResults=${MAX_MESSAGES}&q=${encodeURIComponent(GMAIL_QUERY)}`);
  for (const { id } of list.messages ?? []) {
    if (seen.has(`gmail:${id}`)) continue;
    yield messageToText(await gmail(token, `/messages/${id}?format=full`));
  }
}

/**
 * Scan Gmail and merge new suggestions into storage (shown on the dashboard).
 * @param {{ interactive: boolean, hint?: string, directory: any[], trials: any[] }} opts
 * @returns {Promise<{ ok: boolean, found?: number, reason?: string }>}
 */
export async function scanGmailWeb({ interactive, hint, directory, trials }) {
  try {
    const token = cachedToken() ?? (interactive ? await requestGmailAccess(hint) : null);
    if (!token) return { ok: false, reason: 'needs-consent' };
    const got = await chrome.storage.local.get(['mailSeen', 'mailCandidates', 'settings']);
    const existing = got.mailCandidates ?? [];
    const seen = new Set([...(got.mailSeen ?? []), ...existing.map((c) => c.messageId)]);
    const { candidates } = await collectCandidates('gmail', messages(token, seen), { directory, trials });
    const known = new Set(existing.map((c) => (c.serviceId ?? c.serviceName).toLowerCase()));
    const fresh = candidates.filter((c) => !known.has((c.serviceId ?? c.serviceName).toLowerCase()));
    const settings = got.settings ?? {};
    await chrome.storage.local.set({
      mailCandidates: [...existing, ...fresh],
      settings: { ...settings, mailConnected: { ...(settings.mailConnected ?? {}), gmail: true }, mailLastScan: new Date().toISOString(), mailErrors: {} },
    });
    return { ok: true, found: fresh.length };
  } catch (err) {
    return { ok: false, reason: String(err?.message ?? err) };
  }
}

export async function disconnectGmailWeb() {
  const token = cachedToken();
  sessionStorage.removeItem(TOKEN_KEY);
  try {
    await loadGis();
    if (token) /** @type {any} */ (window).google.accounts.oauth2.revoke(token, () => {});
  } catch {
    /* already gone */
  }
  const got = await chrome.storage.local.get(['settings', 'mailCandidates']);
  await chrome.storage.local.set({
    mailCandidates: (got.mailCandidates ?? []).filter((c) => c.provider !== 'gmail'),
    settings: { ...(got.settings ?? {}), mailConnected: { ...(got.settings?.mailConnected ?? {}), gmail: false } },
  });
}

/** True when a scan can run right now without a popup. */
export const hasLiveGmailToken = () => Boolean(cachedToken());
