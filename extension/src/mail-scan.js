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

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.messages.readonly';

/**
 * Fallback for people not signed into Chrome itself (chrome.identity needs a
 * Chrome profile). Google's normal sign-in window via launchWebAuthFlow, with
 * the web OAuth client. Background re-auth uses prompt=none, which succeeds
 * silently while the user is still signed into Google in this browser.
 * Requires https://<extension-id>.chromiumapp.org/ as a redirect URI on the
 * web client.
 */
async function gmailTokenViaWebFlow(interactive) {
  const { gmailWebToken: cached, session } = await chrome.storage.local.get(['gmailWebToken', 'session']);
  if (cached?.token && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const hint = cached?.hint || session?.user?.email || '';
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: 'token',
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: GMAIL_SCOPE,
    include_granted_scopes: 'true',
    prompt: interactive ? 'select_account' : 'none',
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
  await chrome.storage.local.set({
    gmailWebToken: { token, expiresAt: Date.now() + Number(p.get('expires_in') ?? 3600) * 1000, hint },
  });
  return token;
}

async function gmailToken(interactive) {
  const id = chrome.runtime.getManifest().oauth2?.client_id ?? '';
  if (!id || id.startsWith('REPLACE')) throw new Error('not-configured');
  const { gmailWebToken } = await chrome.storage.local.get('gmailWebToken');
  if (gmailWebToken) return gmailTokenViaWebFlow(interactive); // this user is on the fallback path
  try {
    const res = await chrome.identity.getAuthToken({ interactive });
    const token = typeof res === 'string' ? res : res?.token;
    if (!token) throw new Error('no-token');
    return token;
  } catch (err) {
    // Not signed into Chrome (or Chrome sync sign-in disabled): use Google's normal window.
    if (/not signed in|sign in to chrome|signin is disabled|turned off|not supported/i.test(String(err?.message ?? err))) {
      return gmailTokenViaWebFlow(interactive);
    }
    throw err;
  }
}

async function gmailApi(token, path) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token }).catch(() => {});
    const { gmailWebToken } = await chrome.storage.local.get('gmailWebToken');
    if (gmailWebToken) await chrome.storage.local.set({ gmailWebToken: { ...gmailWebToken, token: null, expiresAt: 0 } });
    throw new Error('expired');
  }
  if (!res.ok) throw new Error(`gmail-${res.status}`);
  return res.json();
}

/** @returns {AsyncGenerator<{id:string,subject:string,from:string,date:string,text:string}>} */
async function* gmailMessages(interactive, seen) {
  const token = await gmailToken(interactive);
  const list = await gmailApi(token, `/messages?maxResults=${MAX_MESSAGES}&q=${encodeURIComponent(GMAIL_QUERY)}`);
  for (const { id } of list.messages ?? []) {
    if (seen.has(`gmail:${id}`)) continue;
    yield messageToText(await gmailApi(token, `/messages/${id}?format=full`));
  }
}

async function gmailDisconnect() {
  const { gmailWebToken } = await chrome.storage.local.get('gmailWebToken');
  if (gmailWebToken?.token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(gmailWebToken.token)}`, { method: 'POST' }).catch(() => {});
  }
  await chrome.storage.local.remove('gmailWebToken');
  if (gmailWebToken) return;
  try {
    const token = await gmailToken(false);
    await chrome.identity.removeCachedAuthToken({ token });
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' });
  } catch {
    /* already disconnected */
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
  gmail: { label: 'Gmail', messages: gmailMessages, disconnect: gmailDisconnect },
  outlook: { label: 'Outlook', messages: outlookMessages, disconnect: outlookDisconnect },
};

/**
 * @param {'gmail'|'outlook'} provider
 * @param {{ interactive: boolean, directory: any[], trials: any[], seen: Set<string> }} opts
 */
export async function scanMailbox(provider, { interactive, directory, trials, seen }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error('unknown-provider');
  return collectCandidates(provider, p.messages(interactive, seen), { directory, trials });
}

/** @param {'gmail'|'outlook'} provider */
export async function disconnectMailbox(provider) {
  await PROVIDERS[provider]?.disconnect();
}
