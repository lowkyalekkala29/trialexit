/**
 * TrialExit app shell — shared by the web app (/app) and the extension
 * dashboard. Hash router, auth gate, onboarding gate, sidebar shell, event
 * delegation, sync.
 *
 * Routes:
 *   #/signup  #/signin                         (signed out)
 *   #/onboarding/1..5                          (signed in, not onboarded)
 *   #/  #/trials  #/subscriptions  #/cancelled  #/offers  #/settings/<tab>  #/help
 */
import { state, $, esc, IS_WEB, DEFAULT_SETTINGS, save, toast, pickWorkerFields, loadBundledDirectory, refreshDirectory, initials } from './state.js';
import { normalizeDirectory } from './core/directory.js';
import { CLOUD_ENABLED } from './config.js';
import { getSession, completeRedirect, getProviders, requestExtensionHandoff } from './auth.js';
import { EXTENSION_ID } from './config.js';
import { pullProfile, pushProfile, syncTrials, PROFILE_FIELDS } from './cloud.js';
import { authHtml, authActions, mountGoogleButton } from './view-auth.js';
import { onboardingHtml, onboardingActions } from './view-onboarding.js';
import { dashboardHtml, trialsHtml, addModalHtml, mailHtml, homeActions, scanReportHtml } from './view-home.js';
import { settingsHtml, helpHtml, accountActions } from './view-account.js';
import { subscriptionsHtml, cancelledHtml, offersHtml } from './view-money.js';
import { candidateType } from './mail-candidates.js';
import { bucket, newTrial, deviceZone } from './state.js';
import { scanGmailWeb, disconnectGmailWeb, hasLiveGmailToken, loadGis } from './web-mail.js';
import { CANDIDATE_VERSION, MIN_KEPT_VERSION } from './mail-candidates.js';
import { zonedWallTimeToInstant } from './core/dates.js';

const ICON = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  piggy: '<path d="M19 9a7 7 0 0 0-13.5 2.6V16l-2 2 2 1 1-2h9l1 2 2-1-1-2.4A7 7 0 0 0 19 12h2v-3z"/><circle cx="15" cy="10" r=".8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const NAV = [
  ['#/', 'Dashboard', 'home'],
  ['#/trials', 'Trials', 'list'],
  ['#/subscriptions', 'Subscriptions', 'repeat'],
  ['#/cancelled', 'Cancelled', 'piggy'],
  ['#/offers', 'Offers', 'tag'],
  ['#/settings/profile', 'Settings', 'gear'],
  ['#/help', 'Help', 'help'],
];

/** Phone bottom bar: five short tabs (Offers is one tap away on the dashboard). */
const TABBAR = [
  ['#/', 'Home', 'home'],
  ['#/trials', 'Trials', 'list'],
  ['#/subscriptions', 'Subs', 'repeat'],
  ['#/cancelled', 'Saved', 'piggy'],
  ['#/settings/profile', 'Settings', 'gear'],
];

/* ------------------------------------------------------------------ route */

function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [, a = '', b = ''] = h.split('/');
  return { path: `/${a}`, sub: b, raw: h };
}

/** Where should this user be right now? Returns a redirect or null. */
function gate(r) {
  if (r.path === '/connect-extension') {
    if (state.session && !state.session.preview) return null;
    try {
      // localStorage (not sessionStorage): the email sign-in link opens a new tab.
      localStorage.setItem('trialexit:after-signin', JSON.stringify({ to: '#/connect-extension', at: Date.now() }));
    } catch {
      /* ignore */
    }
    return state.settings.everSignedIn ? '#/signin' : '#/signup';
  }
  const signedOutOk = !IS_WEB && state.settings.accountSkipped;
  const authed = Boolean(state.session) || signedOutOk;
  if (!authed) return r.path === '/signin' || r.path === '/signup' ? null : state.settings.everSignedIn ? '#/signin' : '#/signup';
  if (!state.settings.onboarded) {
    if (r.path === '/onboarding') return null;
    if ((r.path === '/signin' || r.path === '/signup') && !state.session) return null;
    return '#/onboarding/1';
  }
  if (r.path === '/onboarding' || r.path === '/signup' || (r.path === '/signin' && state.session)) return '#/';
  return null;
}

/* ----------------------------------------------------------------- render */

let pendingFocus = null;

function render() {
  const r = route();
  const redirect = gate(r);
  if (redirect && redirect !== `#${r.raw}`) {
    location.replace(redirect);
    return;
  }
  const root = $('#root');
  const preview = state.session?.preview || !CLOUD_ENABLED;
  const previewBar = preview && IS_WEB ? '<div class="preview-bar">Preview mode — sign-in is simulated and data stays in this browser.</div>' : '';

  if (r.path === '/signin' || r.path === '/signup') {
    // Re-check which sign-in options are on whenever this screen shows, so a
    // provider switched on in Supabase appears without a hard reload.
    if (Date.now() - (state.auth.providersAt ?? 0) > 15_000) {
      state.auth.providersAt = Date.now();
      getProviders().then((p) => {
        const changed = JSON.stringify(p) !== JSON.stringify(state.auth.providers);
        state.auth.providers = p;
        if (changed && document.querySelector('.auth')) render();
      });
    }
    document.title = r.path === '/signin' ? 'Sign in — TrialExit' : 'Create account — TrialExit';
    root.innerHTML = previewBar + authHtml(r.path === '/signin' ? 'signin' : 'signup');
    mountGoogleButton(afterSignIn, (msg) => {
      state.auth.error = msg;
      render();
    });
    return afterRender();
  }
  if (r.path === '/connect-extension') {
    document.title = 'Connect the extension — TrialExit';
    root.innerHTML = `<div class="ob"><header class="ob-top"><div class="brand"><span class="mark">✓</span><span class="brand-name">TrialExit</span></div></header>
      <main class="ob-body"><div class="ob-card" style="text-align:center"><div class="done-mark" id="cx-mark">…</div>
      <h1 id="cx-title">Connecting the Chrome extension…</h1><p class="lede" id="cx-body">One moment.</p>
      <div class="actions" style="justify-content:center;margin-top:16px"><a class="btn" href="#/">Go to dashboard</a></div></div></main></div>`;
    connectExtension();
    return afterRender();
  }
  if (r.path === '/onboarding') {
    document.title = 'Welcome — TrialExit';
    root.innerHTML = previewBar + onboardingHtml(Math.min(5, Math.max(1, Number(r.sub) || 1)));
    return afterRender();
  }

  const page =
    r.path === '/trials' ? trialsHtml()
    : r.path === '/savings' || r.path === '/cancelled' ? cancelledHtml()
    : r.path === '/subscriptions' ? subscriptionsHtml()
    : r.path === '/offers' ? offersHtml()
    : r.path === '/settings' ? settingsHtml(r.sub || 'profile')
    : r.path === '/help' ? helpHtml()
    : r.path === '/scan-report' ? scanReportHtml()
    : dashboardHtml();
  document.title = `${{ '/trials': 'Trials', '/subscriptions': 'Subscriptions', '/cancelled': 'Cancelled', '/savings': 'Cancelled', '/offers': 'Offers', '/settings': 'Settings', '/help': 'Help' }[r.path] ?? 'Dashboard'} — TrialExit`;
  const u = state.session?.user;
  const who = state.settings.name || u?.name || u?.email || 'Guest';
  const attention = state.trials.filter((t) => bucket(t) === 'attention').length;
  const active = (href) => (href === '#/' ? r.path === '/' : `#${r.raw}`.startsWith(href.split('/').slice(0, 2).join('/')));

  root.innerHTML = `${previewBar}<div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#/"><span class="mark">✓</span><span class="brand-name">TrialExit</span></a>
      <nav class="nav">${NAV.map(([href, label, ic]) => `<a href="${href}" class="${active(href) ? 'on' : ''}">${icon(ic)}<span>${label}</span>${label === 'Dashboard' && attention ? `<i class="dot">${attention}</i>` : ''}</a>`).join('')}</nav>
      <div class="side-foot">
        ${!IS_WEB ? '' : '<a class="side-cta" href="../install.html" target="_blank" rel="noopener"><b>Get the extension</b><span>Catch trials as you sign up</span></a>'}
        <details class="account"><summary><span class="avatar">${esc(initials(who))}</span><span class="who"><b>${esc(who)}</b><span>${esc(u?.email ?? 'No account — this device only')}</span></span></summary>
          <div class="menu"><a href="#/settings/profile">Account settings</a>${u ? '<button data-act="s-signout">Sign out</button>' : '<a href="#/signin">Sign in</a>'}</div></details>
      </div>
    </aside>
    <main class="content" id="content">${r.path === '/' ? installBannerHtml() : ''}${page}</main>
    <nav class="tabbar">${TABBAR.map(([href, label, ic]) => `<a href="${href}" class="${active(href) ? 'on' : ''}">${icon(ic)}<span>${label}</span></a>`).join('')}</nav>
  </div>${addModalHtml()}`;
  afterRender();
}

function afterRender() {
  if (pendingFocus) {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(pendingFocus));
    if (el) {
      el.focus();
      el.setSelectionRange?.(el.value.length, el.value.length);
    }
    pendingFocus = null;
  }
}

/** Navigate (path) or re-render in place (null). */
function go(path, opts = {}) {
  if (opts.keepFocus) pendingFocus = opts.keepFocus;
  if (path && path !== location.hash) location.hash = path;
  else render();
}

/* --------------------------------------------------------- install the app */

const install = { prompt: /** @type {any} */ (null) };
const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const INSTALL_DISMISS = 'trialexit:install-dismissed';

if (IS_WEB) {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // show our own button instead of Chrome's mini-bar
    install.prompt = e;
    if (document.querySelector('.content')) render();
  });
  addEventListener('appinstalled', () => {
    install.prompt = null;
    toast('TrialExit is on your home screen.');
    render();
  });
}

/** "Install the app" banner: Android/desktop → real prompt; iPhone → two taps to follow. */
export function installBannerHtml() {
  if (!IS_WEB || isStandalone()) return '';
  try {
    if (Date.now() - Number(localStorage.getItem(INSTALL_DISMISS) ?? 0) < 14 * 864e5) return '';
  } catch {
    /* ignore */
  }
  if (install.prompt) {
    return `<div class="banner install"><div><b>Install the TrialExit app.</b> One tap from your home screen, opens full-screen.</div>
      <div class="actions"><button class="primary" data-act="install-app">Install app</button><button class="ghost" data-act="install-dismiss" aria-label="Not now">✕</button></div></div>`;
  }
  if (isIOS()) {
    return `<div class="banner install"><div><b>Add TrialExit to your home screen.</b> Tap <span class="ios-share" aria-label="Share">⬆︎</span> <b>Share</b> at the bottom of Safari, then <b>Add to Home Screen</b>.</div>
      <button class="ghost" data-act="install-dismiss" aria-label="Not now">✕</button></div>`;
  }
  return '';
}

/* ------------------------------------------------------------ persistence */

let syncTimer = 0;
let lastProfile = '';

function profileSnapshot() {
  return JSON.stringify(PROFILE_FIELDS.map((k) => state.settings[k]));
}

async function persist() {
  await save();
  if (!state.session) return;
  const snap = profileSnapshot();
  if (snap !== lastProfile) {
    lastProfile = snap;
    pushProfile(state.settings).catch(() => {});
  }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, 800);
}

async function runSync() {
  if (!state.session || state.session.preview) return;
  const r = await syncTrials();
  if (r.ok) {
    const got = await chrome.storage.local.get(['trials', 'tombstones', 'lastSync']);
    state.lastSync = got.lastSync ?? null;
    if (JSON.stringify(got.trials) !== JSON.stringify(state.trials)) {
      state.trials = got.trials ?? [];
      state.tombstones = got.tombstones ?? [];
      if (!document.querySelector('.modal, #add-form')) render();
    }
  }
}

/** Website → extension: give the extension its own session for this account. */
let connecting = false;
async function connectExtension() {
  if (connecting) return;
  connecting = true;
  const set = (mark, title, body) => {
    const m = document.getElementById('cx-mark');
    if (!m) return;
    m.textContent = mark;
    document.getElementById('cx-title').textContent = title;
    document.getElementById('cx-body').textContent = body;
  };
  const ext = /** @type {any} */ (globalThis).__extChrome;
  const send = (msg) =>
    new Promise((resolve) => {
      try {
        ext.runtime.sendMessage(EXTENSION_ID, msg, (res) => resolve(ext.runtime.lastError ? null : res));
      } catch {
        resolve(null);
      }
    });
  try {
    const ping = ext ? await send({ type: 'ping' }) : null;
    if (!ping?.installed) {
      set('🧩', 'Install the extension first', 'We could not find TrialExit in this browser. Install it, then press Sign in inside the extension again.');
      return;
    }
    const { tokenHash } = await requestExtensionHandoff();
    const res = await send({ type: 'session-handoff', tokenHash });
    if (!res?.ok) throw new Error(res?.reason ?? 'The extension did not respond');
    set('✓', 'Extension connected', `Signed in as ${res.email}. You can close this tab — the extension now syncs with your account.`);
  } catch (err) {
    set('!', "Couldn't connect the extension", String(err?.message ?? err));
  } finally {
    connecting = false;
  }
}

async function afterSignIn(session) {
  state.session = session;
  state.settings.everSignedIn = true;
  state.settings.accountSkipped = false;
  if (!state.settings.name && session.user?.name) state.settings.name = session.user.name;
  const remote = await pullProfile().catch(() => null);
  if (remote) {
    for (const [k, v] of Object.entries(remote)) if (v !== null && v !== undefined && v !== '') state.settings[k] = v;
  }
  await save();
  lastProfile = profileSnapshot();
  if (!remote) pushProfile(state.settings).catch(() => {});
  await runSync();
  toast(`Signed in as ${session.user.email}`);
  autoScanWeb(true);
  let next = null;
  try {
    const pending = JSON.parse(localStorage.getItem('trialexit:after-signin') ?? 'null');
    localStorage.removeItem('trialexit:after-signin');
    if (pending && Date.now() - pending.at < 30 * 60_000) next = pending.to;
  } catch {
    /* ignore */
  }
  go(next ?? (state.settings.onboarded ? '#/' : '#/onboarding/1'));
}

async function onSignedOut() {
  const wasPreview = state.session?.preview || !CLOUD_ENABLED;
  state.session = null;
  // Web + real account: the account owns the data, so clear this browser's
  // copy (shared computers). Preview mode has no server copy — keep it.
  if (IS_WEB && !wasPreview) {
    // Web: the account owns the data; clear this browser's copy.
    state.trials = [];
    state.tombstones = [];
    state.settings = { ...DEFAULT_SETTINGS, everSignedIn: true };
    await chrome.storage.local.set({ trials: [], tombstones: [], settings: state.settings });
  }
  go('#/signin');
}

/* ------------------------------------------------------------- email scan */

const PROVIDER_LABEL = { gmail: 'Gmail', outlook: 'Outlook' };

function mailError(provider, reason) {
  const r = String(reason ?? '');
  const name = PROVIDER_LABEL[provider] ?? 'Email';
  if (r === 'not-configured') return `${name} connection isn't switched on in this build yet. Use Paste email meanwhile.`;
  if (r === 'outlook-web') return 'Outlook scanning is available in the Chrome extension. On the web, paste the email instead.';
  if (r === 'scope-not-granted') return `Google didn't give read access to your ${name}. Press Scan ${name} again and, in Google's window, keep "View your email messages and settings" ticked.`;
  if (r === 'gmail-api-disabled') return "Gmail scanning isn't switched on yet on our side (Gmail API disabled). We're on it — try again soon, or paste the email meanwhile.";
  if (r === 'popup-blocked') return `Your browser blocked Google's window. Allow pop-ups for trialexit.vercel.app (icon at the right of the address bar), then press Scan ${name} again.`;
  if (r === 'account-changed') return `That's a different Google account. Use "Add another Gmail" to connect it.`;
  if (r === 'needs-consent') return `Press Scan ${name} to allow read-only access again.`;
  if (r === 'google-unavailable') return "Couldn't load Google's sign-in. Check your connection or ad-blocker, then try again.";
  if (r === 'expired') return `${name} sign-in expired — connect again.`;
  if (r === 'timeout') return `The ${name} scan took too long and was stopped. Press Scan again — it continues where it left off.`;
  if (r === 'gmail-429') return `${name} asked us to slow down. Wait a minute, then press Scan again.`;
  if (r === 'no-token' || /did not approve|cancel|access_denied|user/i.test(r)) return `${name} sign-in was cancelled.`;
  return `Couldn't reach ${name} (${r}).`;
}

/** Preview mode has no Google: show what a scan result looks like. */
async function previewScan(addAccount = false) {
  const day = 864e5;
  const iso = (d) => new Date(Date.now() + d * day).toISOString().slice(0, 10);
  const demo = [
    { v: 6, messageId: 'gmail:demo1', provider: 'gmail', subject: 'Your free trial of YouTube Premium has started', serviceId: 'youtube-premium', region: 'IN', serviceName: 'YouTube Premium', renewsOn: iso(29), renewalMatched: new Date(Date.now() + 29 * day).toDateString().slice(4), amount: 149, currency: 'INR' },
    { v: 6, messageId: 'gmail:demo2', provider: 'gmail', subject: 'Welcome to Canva Pro — your 30-day free trial', serviceId: 'canva', region: 'IN', serviceName: 'Canva Pro', renewsOn: iso(30), renewalMatched: null, amount: 499, currency: 'INR', trialLengthDays: 30 },
  ];
  const got = await chrome.storage.local.get(['mailCandidates', 'settings']);
  const known = new Set((got.mailCandidates ?? []).map((c) => c.messageId));
  const fresh = demo.filter((c) => !known.has(c.messageId) && !state.trials.some((t) => t.serviceId === c.serviceId));
  const prev = got.settings ?? {};
  const accounts = prev.mailAccounts ?? [];
  const email = accounts.some((a) => a.email === 'you@gmail.com') && addAccount ? 'work@company.com' : 'you@gmail.com';
  const mailAccounts = accounts.some((a) => a.email === email) ? accounts : [...accounts, { provider: 'gmail', email, via: 'web', lastScan: new Date().toISOString() }];
  await chrome.storage.local.set({
    mailCandidates: [...(got.mailCandidates ?? []), ...fresh.map((c) => ({ ...c, account: email }))],
    settings: { ...prev, mailAccounts, mailConnected: { ...(prev.mailConnected ?? {}), gmail: true }, mailLastScan: new Date().toISOString(), scannedWith: CANDIDATE_VERSION },
  });
  return { ok: true, found: fresh.length };
}

async function webMail(type, provider, { interactive, account }) {
  if (provider && provider !== 'gmail') return { ok: false, reason: 'outlook-web' };
  if (type === 'mail-disconnect') {
    if (!CLOUD_ENABLED) {
      const got = await chrome.storage.local.get('settings');
      const left = (got.settings?.mailAccounts ?? []).filter((a) => a.email !== account);
      await chrome.storage.local.set({ settings: { ...got.settings, mailAccounts: left, mailConnected: { gmail: left.length > 0 } } });
      return { ok: true };
    }
    await disconnectGmailWeb(account);
    return { ok: true };
  }
  if (!CLOUD_ENABLED) return previewScan(type === 'mail-add-account');
  return scanGmailWeb({
    interactive,
    addAccount: type === 'mail-add-account',
    account,
    hint: state.session?.user?.email,
    directory: state.directory,
    trials: state.trials,
    onProgress: showScanProgress,
  });
}

/** Live "Reading your inbox…" text while a web scan runs (no full re-render). */
function showScanProgress(pr) {
  const pct = pr.total ? Math.min(99, Math.round((pr.done / pr.total) * 100)) : 0;
  state.mail.progress =
    pr.phase === 'sweep' ? `Looking through your recent emails… ${pct}%`
    : pr.phase === 'read' ? `Reading ${pr.total} possible matches… ${pct}%`
    : 'Sorting what we found…';
  document.querySelectorAll('button[data-act^="mail-"]').forEach((b) => {
    if (b.textContent === 'Waiting for Google…') b.textContent = 'Scanning…';
  });
  document.querySelectorAll('[data-scan-progress]').forEach((el) => {
    el.textContent = state.mail.progress;
    /** @type {HTMLElement} */ (el).hidden = false;
  });
}

/** A scan can never leave the app stuck on "Scanning…". */
const SCAN_TIMEOUT_MS = 4 * 60_000;
const withTimeout = (promise) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: 'timeout' }), SCAN_TIMEOUT_MS))]);

/**
 * @param {string} type mail-connect | mail-add-account | mail-rescan | mail-disconnect
 * @param {string|null} provider
 * @param {string|null} account  one inbox, or all when null
 * @param {{ auto?: boolean }} opts  auto = not from a click (never opens Google's window)
 */
async function mailCall(type, provider = null, account = null, { auto = false } = {}) {
  state.mail.busy = provider ?? true;
  state.mail.error = '';
  state.mail.progress = type === 'mail-disconnect' ? '' : 'Connecting to Gmail…';
  if (!IS_WEB) render();
  else if (!auto)
    // No re-render before Google's window opens: the click must reach it directly.
    document.querySelectorAll('[data-act^="mail-"]').forEach((b) => {
      /** @type {HTMLButtonElement} */ (b).disabled = true;
      if (b.dataset.act === type) b.textContent = 'Waiting for Google…';
    });
  const res = IS_WEB
    ? await withTimeout(webMail(type, provider ?? 'gmail', { interactive: !auto, account }))
    : await withTimeout(chrome.runtime.sendMessage({ type, provider, account }).catch((err) => ({ ok: false, reason: err?.message })));
  state.mail.busy = false;
  state.mail.progress = '';
  const got = await chrome.storage.local.get(['mailCandidates', 'settings', 'mailScanReport']);
  state.mail.candidates = got.mailCandidates ?? [];
  state.mail.report = got.mailScanReport ?? null;
  state.settings = { ...state.settings, ...pickWorkerFields(got.settings) };
  if (!res?.ok) state.mail.error = mailError(provider ?? 'gmail', res?.reason);
  else if (res.found !== undefined && !auto) {
    const tap = res.needsTap?.length ? ` Tap Scan next to ${res.needsTap.join(', ')} to check ${res.needsTap.length > 1 ? 'those inboxes' : 'that inbox'} too.` : '';
    const checked = typeof res.scanned === 'number' ? res.scanned : null;
    const none =
      checked === 0
        ? 'No trial or subscription emails in the last 60 days.'
        : checked
          ? `Checked ${checked} email${checked > 1 ? 's' : ''} — nothing new to add.`
          : 'No new trials found in your email.';
    toast((res.found ? `Found ${res.found} new item${res.found > 1 ? 's' : ''} in your email — trials, subscriptions or offers.` : `${none} See "What did it check?" for details.`) + tap);
  }
  render();
  return res;
}

/** Web has no background worker: dismiss/track happen right here. */
async function dismissCandidate(id) {
  if (!IS_WEB) return chrome.runtime.sendMessage({ type: 'mail-dismiss', messageId: id });
  const got = await chrome.storage.local.get(['mailSeen', 'mailCandidates']);
  await chrome.storage.local.set({
    mailSeen: [...new Set([...(got.mailSeen ?? []), id])].slice(-2000),
    mailCandidates: (got.mailCandidates ?? []).filter((c) => c.messageId !== id),
  });
}

async function trackCandidate(c, date, extra = {}) {
  if (!IS_WEB && candidateType(c) === 'trial') return chrome.runtime.sendMessage({ type: 'add-trial', trial: { ...c, renewsOn: date, source: c.account ? `${c.provider}:${c.account}` : c.provider } });
  const entry = (c.serviceId && state.directory.find((e) => e.serviceId === c.serviceId)) || null;
  const currency = c.currency ?? (state.settings.region === 'US' ? 'USD' : 'INR');
  const renewsAt = zonedWallTimeToInstant(date, '00:00', state.settings.timezone || deviceZone).toISOString();
  state.trials = [
    ...state.trials,
    newTrial({
      serviceId: entry?.serviceId ?? String(c.serviceName).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      region: c.region ?? entry?.region ?? (currency === 'INR' ? 'IN' : 'US'),
      serviceName: entry?.name ?? c.serviceName,
      renewsAt,
      timezone: state.settings.timezone || deviceZone,
      amount: Math.round((Number(c.amount) || 0) * 100),
      currency,
      trialLengthDays: Number(c.trialLengthDays) || Math.max(1, Math.round((Date.parse(renewsAt) - Date.now()) / 864e5)),
      source: c.account ? `${c.provider}:${c.account}` : c.provider,
      ...extra,
    }),
  ];
  await persist();
  return { ok: true };
}

const installActions = {
  'install-app': async () => {
    if (!install.prompt) return;
    install.prompt.prompt();
    await install.prompt.userChoice.catch(() => null);
    install.prompt = null;
    render();
  },
  'install-dismiss': () => {
    try {
      localStorage.setItem(INSTALL_DISMISS, String(Date.now()));
    } catch {
      /* ignore */
    }
    render();
  },
};

const mailActions = {
  'mail-connect': (el) => mailCall('mail-connect', el.dataset.provider ?? 'gmail'),
  'mail-add-account': (el) => mailCall('mail-add-account', el.dataset.provider ?? 'gmail'),
  'mail-rescan': (el) => mailCall('mail-rescan', el.dataset.provider ?? null, el.dataset.account ?? null),
  'mail-disconnect': (el) => {
    const who = el.dataset.account ?? el.dataset.provider;
    if (!confirm(`Remove ${who}? Trials you already track stay; we just stop checking this inbox.`)) return;
    return mailCall('mail-disconnect', el.dataset.provider ?? 'gmail', el.dataset.account ?? null);
  },
  'mail-dismiss': async (el) => {
    await dismissCandidate(el.dataset.id);
    state.mail.candidates = state.mail.candidates.filter((c) => c.messageId !== el.dataset.id);
    render();
  },
  'mail-track': async (el) => {
    const c = state.mail.candidates.find((x) => x.messageId === el.dataset.id);
    const date = /** @type {HTMLInputElement|null} */ (document.querySelector(`[data-mail-date="${CSS.escape(el.dataset.id)}"]`))?.value;
    if (!c) return;
    if (!date) return toast(candidateType(c) === 'subscription' ? 'Set the next charge date first.' : 'Set the end date first.');
    const isSub = candidateType(c) === 'subscription';
    const field = (k) => /** @type {HTMLInputElement|null} */ (document.querySelector(`[data-mail-${k}="${CSS.escape(el.dataset.id)}"]`))?.value;
    if (isSub) {
      state.trials = (await chrome.storage.local.get('trials')).trials ?? state.trials;
      c.amount = field('amount') === '' || field('amount') == null ? c.amount : Number(field('amount'));
    }
    const res = await trackCandidate(c, date, isSub ? { kind: 'subscription', cycle: field('cycle') || c.cycle || 'monthly' } : {});
    if (!res?.ok) return toast(res?.reason ?? 'Could not save');
    await dismissCandidate(el.dataset.id);
    state.mail.candidates = state.mail.candidates.filter((x) => x.messageId !== el.dataset.id);
    state.trials = (await chrome.storage.local.get('trials')).trials ?? state.trials;
    toast(isSub ? `${c.serviceName} added to Subscriptions.` : `Tracking ${c.serviceName}.`);
    persist();
    render();
  },
  'mail-cancel': async (el) => {
    const c = state.mail.candidates.find((x) => x.messageId === el.dataset.id);
    if (!c) return;
    state.trials = (await chrome.storage.local.get('trials')).trials ?? state.trials;
    const at = new Date(`${c.cancelledOn ?? new Date().toISOString().slice(0, 10)}T12:00:00Z`).toISOString();
    if (c.matchId && state.trials.some((t) => t.id === c.matchId)) {
      state.trials = state.trials.map((t) => (t.id === c.matchId ? { ...t, status: 'confirmed_cancelled', cancelledAt: at, updatedAt: new Date().toISOString() } : t));
      await persist();
    } else {
      // Not tracked yet: record it as a cancelled subscription (no money claimed until a renewal passes).
      await trackCandidate(c, at.slice(0, 10), { kind: 'subscription', cycle: 'monthly', status: 'confirmed_cancelled', cancelledAt: at });
    }
    await dismissCandidate(el.dataset.id);
    state.mail.candidates = state.mail.candidates.filter((x) => x.messageId !== el.dataset.id);
    toast(`${c.serviceName} is in Cancelled.`);
    render();
  },
};

/* ----------------------------------------------------------------- events */

const ACTIONS = {
  ...authActions(go, afterSignIn),
  ...onboardingActions(go, persist),
  ...homeActions(go, persist, toast),
  ...accountActions(go, persist, toast, onSignedOut),
  ...mailActions,
  ...installActions,
};

document.addEventListener('click', (e) => {
  const el = /** @type {HTMLElement} */ (e.target).closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  // The modal backdrop wraps the whole dialog: only a click on the backdrop
  // itself closes it; clicks inside must keep their default (e.g. submit).
  if (el.dataset.act === 'add-close-backdrop' && e.target !== el) return;
  if (el.tagName === 'BUTTON' && el.getAttribute('type') !== 'submit') e.preventDefault?.();
  Promise.resolve(fn(el, e)).catch((err) => toast(String(err?.message ?? err)));
});

document.addEventListener('submit', (e) => {
  const form = /** @type {HTMLFormElement} */ (e.target);
  const fn = ACTIONS[`form:${form.dataset.form}`];
  if (!fn) return;
  e.preventDefault();
  Promise.resolve(fn(form, e)).catch((err) => toast(String(err?.message ?? err)));
});

document.addEventListener('change', (e) => {
  const el = /** @type {HTMLElement} */ (e.target);
  const key = el.dataset.whenDate ? 'change:when-date' : el.dataset.obDate ? 'change:ob-date' : `change:${el.id}`;
  ACTIONS[key]?.(el, e);
});

document.addEventListener('input', (e) => {
  const el = /** @type {HTMLElement} */ (e.target);
  ACTIONS[`input:${el.id}`]?.(el, e);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (state.addOpen || state.editingId)) ACTIONS['add-close']();
});

addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  render();
});
addEventListener('focus', () => runSync());

chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== 'local') return;
  // Signed in from another tab (email link) while this one waits on "check your inbox".
  if (changes.session?.newValue && !state.session && document.querySelector('.auth')) {
    location.hash = '#/';
    location.reload();
    return;
  }
  if (changes.settings?.newValue) state.settings = { ...state.settings, ...pickWorkerFields(changes.settings.newValue) };
  if (changes.mailCandidates) state.mail.candidates = changes.mailCandidates.newValue ?? [];
  if (changes.mailScanReport) state.mail.report = changes.mailScanReport.newValue ?? null;
  if (changes.trials && JSON.stringify(changes.trials.newValue) !== JSON.stringify(state.trials)) {
    state.trials = changes.trials.newValue ?? [];
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, 1500);
  }
  if ((changes.trials || changes.mailCandidates) && !document.querySelector('.modal, #add-form, .ob, .auth')) render();
});

/* ------------------------------------------------------------------- boot */

async function boot() {
  const got = await chrome.storage.local.get(['trials', 'tombstones', 'settings', 'pendingSeed', 'bundledDirectory', 'mailCandidates', 'mutedHosts', 'lastSync', 'mailScanReport']);
  state.mail.report = got.mailScanReport ?? null;
  state.trials = Array.isArray(got.trials) ? got.trials : [];
  state.tombstones = Array.isArray(got.tombstones) ? got.tombstones : [];
  state.settings = { ...DEFAULT_SETTINGS, ...(got.settings ?? {}) };
  state.mail.candidates = got.mailCandidates ?? [];
  // Suggestions from an older scanner (e.g. before ads were filtered out):
  // drop them and forget which emails were seen, so the next scan re-checks.
  if (state.mail.candidates.some((c) => (c.v ?? 1) < MIN_KEPT_VERSION)) {
    state.mail.candidates = state.mail.candidates.filter((c) => (c.v ?? 1) >= MIN_KEPT_VERSION);
    await chrome.storage.local.set({ mailCandidates: state.mail.candidates, mailSeen: [] });
  }
  state.mutedHosts = got.mutedHosts ?? [];
  state.lastSync = got.lastSync ?? null;
  // Extension users from before accounts existed keep working without one.
  if (!IS_WEB && state.trials.length && !got.settings?.everSignedIn && got.settings?.onboarded !== false) {
    state.settings.onboarded = true;
    state.settings.accountSkipped = state.settings.accountSkipped ?? true;
  }
  state.directory = got.bundledDirectory ? normalizeDirectory(got.bundledDirectory) : await loadBundledDirectory();

  try {
    const fromRedirect = await completeRedirect();
    state.session = fromRedirect ?? (await getSession());
    if (fromRedirect) return afterSignIn(fromRedirect);
  } catch (err) {
    state.auth.error = String(err?.message ?? err);
  }
  if (got.pendingSeed) {
    state.seed = got.pendingSeed;
    state.addOpen = true;
    await chrome.storage.local.remove('pendingSeed');
  }
  lastProfile = profileSnapshot();
  if (IS_WEB && CLOUD_ENABLED) loadGis().catch(() => {});
  render();
  refreshDirectory(render);
  runSync();
  autoScanWeb();
}

const SCAN_EVERY_MS = 6 * 60 * 60_000;
const scanIsDue = () =>
  (state.settings.scannedWith ?? 0) < CANDIDATE_VERSION ||
  Date.now() - (Date.parse(state.settings.mailLastScan ?? '') || 0) > SCAN_EVERY_MS - 5 * 60_000;

/**
 * Web: scan Gmail right after login and then every 6 hours while the app is
 * open — silently when Google's access (1 hour) is still valid; otherwise the
 * dashboard shows a one-tap "Scan now" banner (a web page can't open Google's
 * window without a tap).
 */
function autoScanWeb(force = false) {
  if (!IS_WEB || !state.session || state.session.preview || !state.settings.mailConnected?.gmail || state.mail.busy) return;
  if ((force || scanIsDue()) && hasLiveGmailToken()) mailCall('mail-rescan', 'gmail', null, { auto: true });
}
setInterval(() => {
  autoScanWeb();
  if (IS_WEB && scanIsDue() && document.querySelector('.content') && !document.querySelector('.modal, #add-form, input:focus')) render();
}, 30 * 60_000);

setInterval(() => {
  if (!document.querySelector('.modal, #add-form, .ob, .auth, input:focus, textarea:focus')) render();
}, 30_000);

boot();
