/**
 * Gmail scan for the WEB app — several Gmail accounts per user.
 * Same privacy model as the extension:
 *  - Google's own consent popup asks for read-only Gmail access, separately
 *    from sign-in (incremental authorization).
 *  - Matching emails go straight from Gmail into this browser tab, are parsed
 *    here, and are never uploaded. Only user-confirmed trials are saved.
 *  - Access tokens live in sessionStorage for at most an hour per account; no
 *    refresh token exists anywhere, so nothing can read an inbox later or
 *    from a server.
 */
import { GOOGLE_CLIENT_ID } from './config.js';
import { gmailMoneyEmails } from './gmail-fetch.js';
import { collectCandidates, candidateKey, CANDIDATE_VERSION } from './mail-candidates.js';

const SCOPES = 'openid email https://www.googleapis.com/auth/gmail.readonly';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const TOKENS_KEY = 'trialexit:gmail-tokens';

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

function tokens() {
  try {
    return JSON.parse(sessionStorage.getItem(TOKENS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function setTokens(all) {
  try {
    sessionStorage.setItem(TOKENS_KEY, JSON.stringify(all));
  } catch {
    /* private mode: memory only for this page load */
  }
}

const live = (email) => {
  const t = tokens()[email];
  return t && t.expiresAt > Date.now() + 60_000 ? t.token : null;
};

/** True when this account can be scanned right now without a popup. */
export const hasLiveGmailToken = (email) => (email ? Boolean(live(email)) : Object.keys(tokens()).some((e) => live(e)));

async function emailForToken(token) {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('expired');
  const d = await res.json();
  if (!d.email) throw new Error('no-email');
  return String(d.email).toLowerCase();
}

/**
 * Opens Google's window. Must be called from a click.
 * @param {{ hint?: string, selectAccount?: boolean }} opts
 * @returns {Promise<{ token: string, email: string }>}
 */
export async function requestGmailAccess({ hint = '', selectAccount = false, consent = false } = {}) {
  if (!(/** @type {any} */ (window).google?.accounts?.oauth2)) await loadGis();
  const resp = await new Promise((resolve, reject) => {
    const client = /** @type {any} */ (window).google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      include_granted_scopes: true,
      callback: (r) => (r.error ? reject(new Error(r.error === 'access_denied' ? 'no-token' : r.error)) : resolve(r)),
      error_callback: (err) =>
        reject(new Error(err?.type === 'popup_closed' ? 'no-token' : err?.type === 'popup_failed_to_open' ? 'popup-blocked' : err?.type ?? 'no-token')),
    });
    client.requestAccessToken({ prompt: consent ? 'consent' : selectAccount ? 'select_account' : '', login_hint: hint || undefined });
  });
  if (!(/** @type {any} */ (window).google.accounts.oauth2.hasGrantedAllScopes(resp, GMAIL_SCOPE))) throw new Error('scope-not-granted');
  const email = await emailForToken(resp.access_token);
  const all = tokens();
  all[email] = { token: resp.access_token, expiresAt: Date.now() + Number(resp.expires_in ?? 3600) * 1000 };
  setTokens(all);
  return { token: resp.access_token, email };
}

/** Google's own one-line reason from an error body (no personal data in it). */
function googleReason(body) {
  try {
    const e = JSON.parse(body)?.error;
    return String(e?.errors?.[0]?.reason ?? e?.status ?? '') + (e?.message ? `: ${e.message}` : '');
  } catch {
    return String(body).slice(0, 160);
  }
}

async function gmail(email, token, path) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    const all = tokens();
    delete all[email];
    setTokens(all);
    throw new Error('expired');
  }
  if (res.status === 403) {
    const body = await res.text().catch(() => '');
    // Gmail also answers 403 when we read too fast: that's a "slow down", not missing access.
    if (/rateLimitExceeded|userRateLimitExceeded|quotaExceeded|RATE_LIMIT/i.test(body)) throw new Error('gmail-429');
    if (/SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(body)) throw new Error('gmail-api-disabled');
    // Refused: drop this access so the next tap asks Google again instead of
    // reusing the same refused token for the rest of the hour.
    const all = tokens();
    delete all[email];
    setTokens(all);
    throw new Error(`scope-not-granted|${googleReason(body)}`);
  }
  if (!res.ok) throw new Error(`gmail-${res.status}`);
  return res.json();
}

const messages = (email, token, seen, directory, onProgress) =>
  gmailMoneyEmails((path) => gmail(email, token, path), { seen, directory, onProgress });

/**
 * Scan Gmail inboxes and merge new suggestions into storage.
 *  - addAccount: open Google's account chooser and add (then scan) another inbox
 *  - otherwise: scan every connected inbox that can be scanned now; the first
 *    one needing Google's window uses this click (only one popup per click),
 *    the rest are reported as needing a tap.
 * @param {{ interactive: boolean, addAccount?: boolean, account?: string|null, hint?: string, directory: any[], trials: any[], onProgress?: (p: any) => void }} opts
 * @returns {Promise<{ ok: boolean, found?: number, reason?: string, needsTap?: string[] }>}
 */
export async function scanGmailWeb({ interactive, addAccount = false, account = null, hint, directory, trials, onProgress = () => {} }) {
  try {
    const got = await chrome.storage.local.get(['mailSeen', 'mailCandidates', 'settings', 'session']);
    const settings = got.settings ?? {};
    let accounts = (settings.mailAccounts ?? []).filter((a) => a.provider === 'gmail');
    const errors = { ...(settings.mailErrors ?? {}) };
    let targets;
    let popupUsed = false;

    if (addAccount || !accounts.length) {
      const { email } = await requestGmailAccess({ selectAccount: true, hint: accounts.length ? '' : hint });
      popupUsed = true;
      if (!accounts.some((a) => a.email === email)) accounts = [...accounts, { provider: 'gmail', email, via: 'web', addedAt: new Date().toISOString() }];
      targets = accounts.filter((a) => a.email === email);
    } else {
      targets = accounts.filter((a) => !account || a.email === account);
    }

    const existing = got.mailCandidates ?? [];
    const seen = new Set([...(got.mailSeen ?? []), ...existing.map((c) => c.messageId)]);
    const ownName = settings.name || got.session?.user?.name || '';
    const fresh = [];
    const needsTap = [];
    let scannedTotal = 0;
    const report = [];
    for (const acc of targets) {
      const hadError = Boolean(errors[acc.email]);
      // A tap on Scan/Reconnect after a failure always asks Google again.
      let token = interactive && hadError && !popupUsed ? null : live(acc.email);
      if (!token && interactive && !popupUsed) {
        try {
          const r = await requestGmailAccess({ hint: acc.email, consent: String(errors[acc.email]).startsWith('scope-not-granted') });
          popupUsed = true;
          if (r.email !== acc.email) throw new Error('account-changed');
          token = r.token;
        } catch (err) {
          errors[acc.email] = String(err?.message ?? err);
          continue;
        }
      }
      if (!token) {
        needsTap.push(acc.email);
        continue;
      }
      try {
        const { candidates, scanned, report: rep } = await collectCandidates('gmail', messages(acc.email, token, seen, directory, (pr) => onProgress({ ...pr, account: acc.email })), {
          directory,
          trials,
          ownEmail: acc.email,
          ownName,
        });
        scannedTotal += scanned;
        report.push(...rep);
        const known = new Set([...existing, ...fresh].map(candidateKey));
        fresh.push(...candidates.filter((c) => !known.has(candidateKey(c))).map((c) => ({ ...c, account: acc.email })));
        delete errors[acc.email];
        acc.lastScan = new Date().toISOString();
      } catch (err) {
        errors[acc.email] = String(err?.message ?? err);
      }
    }
    accounts = accounts.map((a) => targets.find((t) => t.email === a.email) ?? a);
    const latest = (await chrome.storage.local.get('settings')).settings ?? {};
    await chrome.storage.local.set({
      mailScanReport: { at: new Date().toISOString(), entries: report.slice(0, 150) },
      mailCandidates: [...existing, ...fresh],
      settings: {
        ...latest,
        mailAccounts: [...(latest.mailAccounts ?? []).filter((a) => a.provider !== 'gmail'), ...accounts],
        mailConnected: { ...(latest.mailConnected ?? {}), gmail: accounts.length > 0 },
        mailLastScan: new Date().toISOString(),
        scannedWith: CANDIDATE_VERSION,
        mailErrors: errors,
      },
    });
    const failed = targets.length === 1 ? errors[targets[0].email] : null;
    if (failed) return { ok: false, reason: failed };
    return { ok: true, found: fresh.length, needsTap, scanned: scannedTotal };
  } catch (err) {
    return { ok: false, reason: String(err?.message ?? err) };
  }
}

/** Remove one Gmail inbox (or all of them when email is omitted). */
export async function disconnectGmailWeb(email = null) {
  const all = tokens();
  const gone = email ? [email] : Object.keys(all);
  try {
    await loadGis();
    for (const e of gone) if (all[e]?.token) /** @type {any} */ (window).google.accounts.oauth2.revoke(all[e].token, () => {});
  } catch {
    /* already gone */
  }
  for (const e of gone) delete all[e];
  setTokens(all);
  const got = await chrome.storage.local.get(['settings', 'mailCandidates']);
  const s = got.settings ?? {};
  const left = (s.mailAccounts ?? []).filter((a) => !(a.provider === 'gmail' && (!email || a.email === email)));
  const errors = { ...(s.mailErrors ?? {}) };
  for (const e of gone) delete errors[e];
  await chrome.storage.local.set({
    mailCandidates: (got.mailCandidates ?? []).filter((c) => !(c.provider === 'gmail' && (!email || c.account === email || !c.account))),
    settings: { ...s, mailAccounts: left, mailErrors: errors, mailConnected: { ...(s.mailConnected ?? {}), gmail: left.some((a) => a.provider === 'gmail') } },
  });
}
