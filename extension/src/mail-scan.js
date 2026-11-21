/**
 * Inbox scan for trial confirmations — Gmail (Google API) and Outlook
 * (Microsoft Graph). Runs in the background worker.
 *
 * Mail is fetched straight from the provider into this extension, parsed on
 * the device, and never sent anywhere else. Only the resulting suggestions
 * (service, date, price, subject line) are stored.
 */
import { GMAIL_QUERY, OUTLOOK_SEARCH, messageToText, outlookMessageToText } from './core/mail.js';
import { collectCandidates } from './mail-candidates.js';
import { OUTLOOK_CLIENT_ID, GOOGLE_CLIENT_ID } from './config.js';

const MAX_MESSAGES = 40;
const LOOKBACK_MS = 60 * 864e5;

/* ------------------------------------------------------------------ gmail */
/*
 * Several Gmail accounts per user (personal, work…). Each account is
 * { provider: 'gmail', email, via: 'chrome' | 'web' }:
 *  - 'chrome': the account Chrome itself is signed into (chrome.identity)
 *  - 'web':    any other account, via Google's sign-in window
 *              (launchWebAuthFlow + the web client); background renewals use
 *              prompt=none + login_hint, silent while the user stays signed
 *              into that Google account in this browser.
 * Access tokens live in storage for at most an hour; there are no refresh
 * tokens and no server copy.
 */
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.messages.readonly';
const GMAIL_SCOPES = ['openid', 'email', GMAIL_SCOPE];
const TOKENS_KEY = 'gmailTokens';

async function cachedToken(email) {
  const all = (await chrome.storage.local.get(TOKENS_KEY))[TOKENS_KEY] ?? {};
  const t = all[email];
  return t?.token && t.expiresAt > Date.now() + 60_000 ? t.token : null;
}

async function saveToken(email, token, expiresIn = 3600) {
  const all = (await chrome.storage.local.get(TOKENS_KEY))[TOKENS_KEY] ?? {};
  all[email] = { token, expiresAt: Date.now() + Number(expiresIn) * 1000 };
  await chrome.storage.local.set({ [TOKENS_KEY]: all });
}

async function forgetToken(email) {
  const all = (await chrome.storage.local.get(TOKENS_KEY))[TOKENS_KEY] ?? {};
  const t = all[email];
  delete all[email];
  await chrome.storage.local.set({ [TOKENS_KEY]: all });
  return t?.token ?? null;
}

/** Which Google account a token belongs to (needs the "email" scope). */
async function emailForToken(token) {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('expired');
  const d = await res.json();
  if (!d.email) throw new Error('no-email');
  return String(d.email).toLowerCase();
}

function assertConfigured() {
  const id = chrome.runtime.getManifest().oauth2?.client_id ?? '';
  if (!id || id.startsWith('REPLACE')) throw new Error('not-configured');
}

async function chromeToken(interactive) {
  const res = await chrome.identity.getAuthToken({ interactive, scopes: GMAIL_SCOPES });
  const token = typeof res === 'string' ? res : res?.token;
  if (!token) throw new Error('no-token');
  return token;
}

const notSignedIntoChrome = (err) =>
  /not signed in|sign in to chrome|signin is disabled|turned off|not supported/i.test(String(err?.message ?? err));

/** Google's normal sign-in window (works without a Chrome profile). */
async function webFlow({ interactive, hint = '', selectAccount = false }) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: 'token',
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: GMAIL_SCOPES.join(' '),
    include_granted_scopes: 'true',
    ...(interactive ? (selectAccount ? { prompt: 'select_account' } : {}) : { prompt: 'none' }),
    ...(hint ? { login_hint: hint } : {}),
  }).toString();
  let final;
  try {
    final = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive });
  } catch {
    throw new Error(interactive ? 'no-token' : 'expired');
  }
  const p = new URLSearchParams(new URL(final ?? '').hash.slice(1));
  if (p.get('error')) throw new Error(p.get('error') === 'access_denied' ? 'no-token' : 'expired');
  const token = p.get('access_token');
  if (!token) throw new Error('no-token');
  return { token, expiresIn: p.get('expires_in') ?? 3600 };
}

/**
 * Connect a Gmail account. First account: Chrome's own account if Chrome is
 * signed in, else Google's window. "Add another": always Google's window with
 * the account chooser.
 * @returns {Promise<{ provider: 'gmail', email: string, via: 'chrome'|'web' }>}
 */
export async function connectGmail({ addAnother = false } = {}) {
  assertConfigured();
  if (!addAnother) {
    try {
      const token = await chromeToken(true);
      const email = await emailForToken(token);
      return { provider: 'gmail', email, via: 'chrome' };
    } catch (err) {
      if (!notSignedIntoChrome(err)) throw err;
    }
  }
  const { token, expiresIn } = await webFlow({ interactive: true, selectAccount: true });
  const email = await emailForToken(token);
  await saveToken(email, token, expiresIn);
  return { provider: 'gmail', email, via: 'web' };
}

/** Access token for one connected account, renewing silently when possible. */
async function tokenFor(account, interactive) {
  if (account.via === 'chrome') {
    const token = await chromeToken(interactive);
    // Chrome may now be signed into a different Google account.
    const email = await emailForToken(token);
    if (email !== account.email) throw new Error('account-changed');
    return token;
  }
  const cached = await cachedToken(account.email);
  if (cached) return cached;
  const { token, expiresIn } = await webFlow({ interactive, hint: account.email });
  const email = await emailForToken(token);
  if (email !== account.email) throw new Error('account-changed');
  await saveToken(email, token, expiresIn);
  return token;
}

async function gmailApi(account, token, path) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    if (account.via === 'chrome') await chrome.identity.removeCachedAuthToken({ token }).catch(() => {});
    else await forgetToken(account.email);
    throw new Error('expired');
  }
  if (res.status === 403) {
    const body = await res.text().catch(() => '');
    throw new Error(/SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(body) ? 'gmail-api-disabled' : 'scope-not-granted');
  }
  if (!res.ok) throw new Error(`gmail-${res.status}`);
  return res.json();
}

/** @returns {AsyncGenerator<{id:string,subject:string,from:string,date:string,text:string}>} */
async function* gmailMessages(account, interactive, seen) {
  const token = await tokenFor(account, interactive);
  const list = await gmailApi(account, token, `/messages?maxResults=${MAX_MESSAGES}&q=${encodeURIComponent(GMAIL_QUERY)}`);
  for (const { id } of list.messages ?? []) {
    if (seen.has(`gmail:${id}`)) continue;
    yield messageToText(await gmailApi(account, token, `/messages/${id}?format=full`));
  }
}

/** Scan one Gmail account; suggestions are tagged with the inbox they came from. */
export async function scanGmailAccount(account, { interactive, directory, trials, seen, ownName }) {
  const { candidates, scanned } = await collectCandidates('gmail', gmailMessages(account, interactive, seen), {
    directory,
    trials,
    ownEmail: account.email,
    ownName,
  });
  return { candidates: candidates.map((c) => ({ ...c, account: account.email })), scanned };
}

export async function disconnectGmailAccount(account) {
  const token = await forgetToken(account.email);
  if (token) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
  if (account.via === 'chrome') {
    try {
      const t = await chromeToken(false);
      await chrome.identity.removeCachedAuthToken({ token: t });
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: 'POST' }).catch(() => {});
    } catch {
      /* already gone */
    }
  }
}

/* ---------------------------------------------------------------- outlook */

const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_SCOPES = 'openid offline_access https://graph.microsoft.com/Mail.Read';

/**
 * Implicit-flow token via chrome.identity.launchWebAuthFlow. Non-interactive
 * runs use prompt=none, which succeeds silently while the user's Microsoft
 * session is alive; otherwise the dashboard asks them to reconnect.
 */
async function outlookToken(interactive) {
  if (!OUTLOOK_CLIENT_ID) throw new Error('not-configured');
  const cached = (await chrome.storage.local.get('outlookToken')).outlookToken;
  if (cached?.token && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const redirect = chrome.identity.getRedirectURL();
  const url = new URL(MS_AUTH);
  url.search = new URLSearchParams({
    client_id: OUTLOOK_CLIENT_ID,
    response_type: 'token',
    redirect_uri: redirect,
    scope: MS_SCOPES,
    response_mode: 'fragment',
    ...(interactive ? { prompt: 'select_account' } : { prompt: 'none' }),
    ...(cached?.loginHint ? { login_hint: cached.loginHint } : {}),
  }).toString();
  const final = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive });
  const params = new URLSearchParams(new URL(final ?? '').hash.slice(1));
  if (params.get('error')) throw new Error(params.get('error') === 'interaction_required' ? 'expired' : params.get('error') ?? 'no-token');
  const token = params.get('access_token');
  if (!token) throw new Error('no-token');
  const expiresAt = Date.now() + Number(params.get('expires_in') ?? 3600) * 1000;
  await chrome.storage.local.set({ outlookToken: { token, expiresAt, loginHint: cached?.loginHint ?? null } });
  return token;
}

async function graph(token, path) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' },
  });
  if (res.status === 401) {
    await chrome.storage.local.remove('outlookToken');
    throw new Error('expired');
  }
  if (!res.ok) throw new Error(`outlook-${res.status}`);
  return res.json();
}

async function* outlookMessages(interactive, seen) {
  const token = await outlookToken(interactive);
  const me = await graph(token, '/me?$select=userPrincipalName,mail').catch(() => null);
  if (me) {
    const cached = (await chrome.storage.local.get('outlookToken')).outlookToken;
    await chrome.storage.local.set({ outlookToken: { ...cached, loginHint: me.mail ?? me.userPrincipalName } });
  }
  const q = encodeURIComponent(`"${OUTLOOK_SEARCH.replace(/"/g, '\\"')}"`);
  const list = await graph(
    token,
    `/me/messages?$search=${q}&$top=${MAX_MESSAGES}&$select=id,subject,from,receivedDateTime,body,bodyPreview`,
  );
  for (const msg of list.value ?? []) {
    if (seen.has(`outlook:${msg.id}`)) continue;
    if (msg.receivedDateTime && Date.parse(msg.receivedDateTime) < Date.now() - LOOKBACK_MS) continue;
    yield outlookMessageToText(msg);
  }
}

async function outlookDisconnect() {
  await chrome.storage.local.remove('outlookToken');
}

/* ----------------------------------------------------------------- shared */

export const PROVIDERS = {
  outlook: { label: 'Outlook', messages: outlookMessages, disconnect: outlookDisconnect },
};

/** Outlook (single account) scan. Gmail uses scanGmailAccount per account. */
export async function scanMailbox(provider, { interactive, directory, trials, seen }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error('unknown-provider');
  const { session, settings } = await chrome.storage.local.get(['session', 'settings']);
  return collectCandidates(provider, p.messages(interactive, seen), {
    directory,
    trials,
    ownEmail: session?.user?.email,
    ownName: settings?.name || session?.user?.name,
  });
}

/** @param {'outlook'} provider */
export async function disconnectMailbox(provider) {
  await PROVIDERS[provider]?.disconnect();
}
