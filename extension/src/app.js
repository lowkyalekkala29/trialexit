/**
 * TrialExit app shell — shared by the web app (/app) and the extension
 * dashboard. Hash router, auth gate, onboarding gate, sidebar shell, event
 * delegation, sync.
 *
 * Routes:
 *   #/signup  #/signin                         (signed out)
 *   #/onboarding/1..5                          (signed in, not onboarded)
 *   #/  #/trials  #/savings  #/settings/<tab>  #/help
 */
import { state, $, esc, IS_WEB, DEFAULT_SETTINGS, save, toast, pickWorkerFields, loadBundledDirectory, refreshDirectory, initials } from './state.js';
import { normalizeDirectory } from './core/directory.js';
import { CLOUD_ENABLED } from './config.js';
import { getSession, completeRedirect, getProviders } from './auth.js';
import { pullProfile, pushProfile, syncTrials, PROFILE_FIELDS } from './cloud.js';
import { authHtml, authActions, mountGoogleButton } from './view-auth.js';
import { onboardingHtml, onboardingActions } from './view-onboarding.js';
import { dashboardHtml, trialsHtml, addModalHtml, mailHtml, homeActions } from './view-home.js';
import { savingsHtml, settingsHtml, helpHtml, accountActions } from './view-account.js';
import { bucket } from './state.js';

const ICON = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  piggy: '<path d="M19 9a7 7 0 0 0-13.5 2.6V16l-2 2 2 1 1-2h9l1 2 2-1-1-2.4A7 7 0 0 0 19 12h2v-3z"/><circle cx="15" cy="10" r=".8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const NAV = [
  ['#/', 'Dashboard', 'home'],
  ['#/trials', 'Trials', 'list'],
  ['#/savings', 'Savings', 'piggy'],
  ['#/settings/profile', 'Settings', 'gear'],
  ['#/help', 'Help', 'help'],
];

/* ------------------------------------------------------------------ route */

function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [, a = '', b = ''] = h.split('/');
  return { path: `/${a}`, sub: b, raw: h };
}

/** Where should this user be right now? Returns a redirect or null. */
function gate(r) {
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
  if (r.path === '/onboarding') {
    document.title = 'Welcome — TrialExit';
    root.innerHTML = previewBar + onboardingHtml(Math.min(5, Math.max(1, Number(r.sub) || 1)));
    return afterRender();
  }

  const page =
    r.path === '/trials' ? trialsHtml()
    : r.path === '/savings' ? savingsHtml()
    : r.path === '/settings' ? settingsHtml(r.sub || 'profile')
    : r.path === '/help' ? helpHtml()
    : dashboardHtml();
  document.title = `${{ '/trials': 'Trials', '/savings': 'Savings', '/settings': 'Settings', '/help': 'Help' }[r.path] ?? 'Dashboard'} — TrialExit`;
  const u = state.session?.user;
  const who = state.settings.name || u?.name || u?.email || 'Guest';
  const attention = state.trials.filter((t) => bucket(t) === 'attention').length;
  const active = (href) => (href === '#/' ? r.path === '/' : `#${r.raw}`.startsWith(href.split('/').slice(0, 2).join('/')));

  root.innerHTML = `${previewBar}<div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#/"><span class="mark">✓</span><span class="brand-name">TrialExit</span></a>
      <nav class="nav">${NAV.map(([href, label, ic]) => `<a href="${href}" class="${active(href) ? 'on' : ''}">${icon(ic)}<span>${label}</span>${label === 'Dashboard' && attention ? `<i class="dot">${attention}</i>` : ''}</a>`).join('')}</nav>
      <div class="side-foot">
        ${!IS_WEB ? '' : '<a class="side-cta" href="../#install" target="_blank" rel="noopener"><b>Get the extension</b><span>Catch trials as you sign up</span></a>'}
        <details class="account"><summary><span class="avatar">${esc(initials(who))}</span><span class="who"><b>${esc(who)}</b><span>${esc(u?.email ?? 'No account — this device only')}</span></span></summary>
          <div class="menu"><a href="#/settings/profile">Account settings</a>${u ? '<button data-act="s-signout">Sign out</button>' : '<a href="#/signin">Sign in</a>'}</div></details>
      </div>
    </aside>
    <main class="content" id="content">${page}</main>
    <nav class="tabbar">${NAV.slice(0, 4).map(([href, label, ic]) => `<a href="${href}" class="${active(href) ? 'on' : ''}">${icon(ic)}<span>${label}</span></a>`).join('')}</nav>
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
  go(state.settings.onboarded ? '#/' : '#/onboarding/1');
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
  if (r === 'expired') return `${name} sign-in expired — connect again.`;
  if (r === 'no-token' || /did not approve|cancel|access_denied|user/i.test(r)) return `${name} sign-in was cancelled.`;
  return `Couldn't reach ${name} (${r}).`;
}

async function mailCall(type, provider = null) {
  state.mail.busy = provider ?? true;
  state.mail.error = '';
  render();
  const res = await chrome.runtime.sendMessage({ type, provider }).catch((err) => ({ ok: false, reason: err?.message }));
  state.mail.busy = false;
  const got = await chrome.storage.local.get(['mailCandidates', 'settings']);
  state.mail.candidates = got.mailCandidates ?? [];
  state.settings = { ...state.settings, ...pickWorkerFields(got.settings) };
  if (!res?.ok) state.mail.error = mailError(provider, res?.reason);
  else if (res.found !== undefined) toast(res.found ? `Found ${res.found} trial${res.found > 1 ? 's' : ''} in your email.` : 'No new trials found in your email.');
  render();
}

const mailActions = {
  'mail-connect': (el) => mailCall('mail-connect', el.dataset.provider),
  'mail-rescan': () => mailCall('mail-rescan'),
  'mail-disconnect': (el) => mailCall('mail-disconnect', el.dataset.provider),
  'mail-dismiss': async (el) => {
    await chrome.runtime.sendMessage({ type: 'mail-dismiss', messageId: el.dataset.id });
    state.mail.candidates = state.mail.candidates.filter((c) => c.messageId !== el.dataset.id);
    render();
  },
  'mail-track': async (el) => {
    const c = state.mail.candidates.find((x) => x.messageId === el.dataset.id);
    const date = /** @type {HTMLInputElement|null} */ (document.querySelector(`[data-mail-date="${CSS.escape(el.dataset.id)}"]`))?.value;
    if (!c) return;
    if (!date) return toast('Set the end date first.');
    const res = await chrome.runtime.sendMessage({ type: 'add-trial', trial: { ...c, renewsOn: date, source: c.provider } });
    if (!res?.ok) return toast(res?.reason ?? 'Could not save');
    await chrome.runtime.sendMessage({ type: 'mail-dismiss', messageId: el.dataset.id });
    state.mail.candidates = state.mail.candidates.filter((x) => x.messageId !== el.dataset.id);
    state.trials = (await chrome.storage.local.get('trials')).trials ?? state.trials;
    toast(`Tracking ${c.serviceName}.`);
    persist();
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
  if (changes.trials && JSON.stringify(changes.trials.newValue) !== JSON.stringify(state.trials)) {
    state.trials = changes.trials.newValue ?? [];
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, 1500);
  }
  if ((changes.trials || changes.mailCandidates) && !document.querySelector('.modal, #add-form, .ob, .auth')) render();
});

/* ------------------------------------------------------------------- boot */

async function boot() {
  const got = await chrome.storage.local.get(['trials', 'tombstones', 'settings', 'pendingSeed', 'bundledDirectory', 'mailCandidates', 'mutedHosts', 'lastSync']);
  state.trials = Array.isArray(got.trials) ? got.trials : [];
  state.tombstones = Array.isArray(got.tombstones) ? got.tombstones : [];
  state.settings = { ...DEFAULT_SETTINGS, ...(got.settings ?? {}) };
  state.mail.candidates = got.mailCandidates ?? [];
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
  render();
  refreshDirectory(render);
  runSync();
}

setInterval(() => {
  if (!document.querySelector('.modal, #add-form, .ob, .auth, input:focus, textarea:focus')) render();
}, 30_000);

boot();
