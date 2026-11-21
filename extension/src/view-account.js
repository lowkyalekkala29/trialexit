/**
 * Savings, Settings (profile / notifications / sources / plan / data) and Help.
 */
import { state, esc, IS_WEB, money, bucket, combinedIcs, deviceZone, save } from './state.js';
import { logoHtml } from './brand.js';
import { CLOUD_ENABLED } from './config.js';
import { NUDGES } from './core/reminders.js';
import { savedTotals, derivedStatus } from './core/store.js';
import { formatMoney, formatRenewalLocal } from './core/dates.js';
import { downloadIcs } from './core/ics.js';
import { validateLicence } from './licence.js';
import { signOut, updateUserName } from './auth.js';
import { deleteAccount, syncTrials } from './cloud.js';

const PROVIDER_LABEL = { gmail: 'Gmail', outlook: 'Outlook' };

/* ---------------------------------------------------------------- savings */

export function savingsHtml() {
  const saved = savedTotals(state.trials);
  const cancelled = state.trials.filter((t) => t.status === 'confirmed_cancelled');
  const inTime = cancelled.filter((t) => t.cancelledAt && Date.parse(t.cancelledAt) < Date.parse(t.renewsAt));
  const kept = state.trials.filter((t) => t.status === 'kept');
  const charged = state.trials.filter((t) => t.status === 'charged' || (derivedStatus(t) === 'charged' && t.status !== 'charged'));
  const keptMonthly = { INR: 0, USD: 0 };
  for (const t of kept) keptMonthly[t.currency] += t.amount;
  const row = (t, right) => `<li class="row-item">${logoHtml(t.serviceId, t.serviceName, 'sm')}<span class="grow"><b>${esc(t.serviceName)}</b><span class="hint">${esc(formatRenewalLocal(t.renewsAt, t.timezone))}</span></span>${right}</li>`;
  return `<div class="page-head"><div><h1>Savings</h1><p class="lede">Only trials you confirmed cancelling before the charge count. No made-up numbers.</p></div></div>
    <div class="summary three">
      <div class="stat ok big"><b>${esc(money(saved) || '₹0')}</b><span>saved by cancelling in time</span></div>
      <div class="stat"><b>${inTime.length}</b><span>trials cancelled before charging</span></div>
      <div class="stat"><b>${esc(money(keptMonthly) || '—')}</b><span>per cycle on trials you kept</span></div>
    </div>
    <section class="section"><div class="section-head"><h2>Cancelled in time</h2><span class="n">${inTime.length}</span></div>
      ${inTime.length ? `<ul class="rows">${inTime.map((t) => row(t, `<span class="amount ok">${t.amount ? formatMoney(t.amount, t.currency) : '—'}</span>`)).join('')}</ul>` : '<div class="empty">Cancel a trial before it charges and it shows up here.</div>'}</section>
    ${kept.length ? `<section class="section"><div class="section-head"><h2>Kept as subscriptions</h2><span class="n">${kept.length}</span></div><ul class="rows">${kept.map((t) => row(t, `<span class="amount">${t.amount ? formatMoney(t.amount, t.currency) : '—'}</span>`)).join('')}</ul></section>` : ''}
    ${charged.length ? `<section class="section"><div class="section-head"><h2>Charged</h2><span class="n">${charged.length}</span></div><p class="hint">Many services refund a charge you didn't use if you ask within a few days. Cancel first, then contact support.</p><ul class="rows">${charged.map((t) => row(t, `<span class="amount crit">${t.amount ? formatMoney(t.amount, t.currency) : '—'}</span>`)).join('')}</ul></section>` : ''}`;
}

/* --------------------------------------------------------------- settings */

const TABS = [
  ['profile', 'Profile'],
  ['notifications', 'Notifications'],
  ['sources', 'Trial sources'],
  ['plan', 'Plan'],
  ['data', 'Data & privacy'],
];

const sw = (id, on, label, sub = '', disabled = false) => `<label class="switch-row ${disabled ? 'disabled' : ''}"><span><b>${label}</b>${sub ? `<span class="hint">${sub}</span>` : ''}</span><input type="checkbox" class="switch" id="${id}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}></label>`;

function profileTab() {
  const s = state.settings;
  const u = state.session?.user;
  return `<div class="card-block"><h2>Profile</h2>
    <div class="form-grid">
      <label>Name<input id="s-name" value="${esc(s.name || u?.name || '')}" placeholder="Your name"></label>
      <label>Email<input value="${esc(u?.email ?? 'Not signed in')}" disabled></label>
      <label>Currency<select id="s-region"><option value="IN" ${s.region === 'IN' ? 'selected' : ''}>₹ INR (India)</option><option value="US" ${s.region === 'US' ? 'selected' : ''}>$ USD</option></select></label>
      <label>Timezone<input id="s-tz" value="${esc(s.timezone || deviceZone)}"></label>
    </div>
    <div class="actions end"><button class="primary" data-act="s-save-profile">Save</button></div></div>
    <div class="card-block"><h2>Account</h2>
    ${u ? `<p class="hint">Signed in as <b>${esc(u.email)}</b> with ${esc(u.provider === 'azure' ? 'Microsoft' : u.provider === 'google' ? 'Google' : 'email code')}.${state.session.preview ? ' (preview mode — nothing is stored on a server)' : ''}</p>
      <p class="hint">${state.lastSync ? `Last synced ${esc(new Date(state.lastSync).toLocaleString())}.` : ''}</p>
      <div class="actions"><button data-act="s-sync">Sync now</button><button data-act="s-signout">Sign out</button></div>`
    : `<p class="hint">You're using TrialExit without an account. Sign in to sync with the web app and get email reminders.</p><a class="btn primary" href="#/signin">Sign in or create account</a>`}</div>`;
}

function notificationsTab() {
  const s = state.settings;
  const skip = new Set(s.reminderSkip ?? []);
  const signedIn = Boolean(state.session);
  const perm = IS_WEB && 'Notification' in window ? Notification.permission : null;
  return `<div class="card-block"><h2>Channels</h2><div class="settings-list">
    ${sw('s-email', s.reminderEmail !== false && signedIn, 'Email reminders', signedIn ? `Sent to ${esc(state.session.user.email)}. Work even when every browser is closed, with one-click "I cancelled" buttons.` : 'Sign in to get email reminders.', !signedIn)}
    ${IS_WEB
      ? `<div class="switch-row"><span><b>Browser notifications</b><span class="hint">${perm === 'granted' ? 'Allowed — shown while TrialExit is open in a tab.' : perm === 'denied' ? 'Blocked. Allow notifications for this site in your browser settings.' : 'Shown while TrialExit is open in a tab.'}</span></span>${perm === 'default' ? '<button class="sm" data-act="notify">Allow</button>' : ''}</div>`
      : `<div class="switch-row"><span><b>Desktop notifications</b><span class="hint">From the extension, with Open cancel page and Snooze buttons, plus a 9am digest.</span></span><button class="sm" data-act="s-test-notify">Send a test</button></div>`}
    <div class="switch-row"><span><b>Calendar</b><span class="hint">Export open trials to Google, Apple or Outlook calendar, with alarms.</span></span><button class="sm" data-act="ics-all">Export .ics</button></div>
  </div></div>
  <div class="card-block"><h2>When to nudge</h2><p class="hint">Applies to email and desktop notifications.</p>
    <div class="check-list">${NUDGES.map((n) => `<label class="check"><input type="checkbox" data-nudge="${n.kind}" ${skip.has(n.kind) ? '' : 'checked'}> ${esc(n.label)}</label>`).join('')}</div>
    <div class="actions end"><button class="primary" data-act="s-save-notify">Save</button></div></div>`;
}

function sourcesTab() {
  if (IS_WEB) {
    const gm = state.settings.mailConnected?.gmail;
    return `<div class="card-block"><h2>Gmail</h2>
      <p class="hint">Read-only. Searches only for trial and subscription emails from the last 60 days. Emails are read in your browser and never uploaded; access lasts an hour each time you allow it.</p>
      <div class="switch-row"><span><b>Gmail</b><span class="hint">${gm ? `Connected${state.settings.mailLastScan ? ` · last scan ${esc(new Date(state.settings.mailLastScan).toLocaleString())}` : ''}` : 'Not connected'}</span></span>
      <span class="actions"><button class="sm ${gm ? '' : 'primary'}" data-act="mail-connect" data-provider="gmail">${state.mail.busy ? 'Scanning…' : gm ? 'Scan now' : 'Connect & scan'}</button>${gm ? '<button class="sm ghost" data-act="mail-disconnect" data-provider="gmail">Disconnect</button>' : ''}</span></div>
      ${state.mail.error ? `<p class="error">${esc(state.mail.error)}</p>` : ''}
      <p class="hint">Outlook scanning is in the Chrome extension.</p></div>
      <div class="card-block"><h2>Chrome extension</h2>
      <p class="hint">The extension catches trials the moment you sign up on any website, and scans Gmail &amp; Outlook for trials started on your phone. Sign in to it with the same account and everything syncs here.</p>
      <a class="btn primary" href="../#install" target="_blank" rel="noopener">Get TrialExit for Chrome</a></div>
      <div class="card-block"><h2>Paste an email</h2><p class="hint">On any device: Add trial → Paste email.</p><button data-act="add-open" data-tab="paste">Paste a confirmation email</button></div>`;
  }
  const conn = state.settings.mailConnected ?? {};
  return `<div class="card-block"><h2>Checkout detection</h2><div class="settings-list">
      ${sw('s-watch', state.settings.watchCheckouts !== false, 'Watch checkout pages on every site', 'Pages are checked on this device only; nothing you browse is uploaded or stored.')}</div>
      ${state.mutedHosts.length ? `<p class="hint">Never asked on: ${state.mutedHosts.map(esc).join(', ')} <button class="link" data-act="s-unmute">Ask again everywhere</button></p>` : ''}</div>
    <div class="card-block"><h2>Email</h2><p class="hint">Read-only. Emails are read on this device and never uploaded. Rescans every 6 hours.</p>
      ${['gmail', 'outlook'].map((p) => `<div class="switch-row"><span><b>${PROVIDER_LABEL[p]}</b><span class="hint">${conn[p] ? 'Connected' : 'Not connected'}</span></span>${conn[p] ? `<span class="actions"><button class="sm" data-act="mail-rescan">Scan now</button><button class="sm ghost" data-act="mail-disconnect" data-provider="${p}">Disconnect</button></span>` : `<button class="sm primary" data-act="mail-connect" data-provider="${p}">${state.mail.busy === p ? 'Scanning…' : 'Connect'}</button>`}</div>`).join('')}
      ${state.mail.error ? `<p class="error">${esc(state.mail.error)}</p>` : ''}
      ${state.settings.mailLastScan ? `<p class="hint">Last scan ${esc(new Date(state.settings.mailLastScan).toLocaleString())}</p>` : ''}</div>`;
}

function planTab() {
  const s = state.settings;
  return `<div class="card-block plan-card"><div class="plan-head"><div><span class="pill ok">current plan</span><h2>Launch — free</h2></div><div class="price">₹0</div></div>
    <ul class="ticks left"><li>Unlimited trials during launch</li><li>Checkout detection, Gmail &amp; Outlook scanning</li><li>Email, desktop and calendar reminders</li><li>Early users keep a free lifetime plan when paid plans start</li></ul></div>
    <div class="card-block"><h2>Lifetime unlock</h2><p class="hint">One payment, no subscription — charging monthly to cancel monthly fees would make us the problem. ₹299 / $6.99, coming soon.</p>
    ${s.unlocked ? '<p class="banner">Unlocked ✓ — thank you!</p>' : `<div class="inline-form"><input id="s-licence" placeholder="Licence key"><button data-act="s-licence">Apply</button></div><p class="error" id="s-licence-err" hidden></p>`}</div>`;
}

function dataTab() {
  return `<div class="card-block"><h2>Export</h2><p class="hint">Your data is yours. Download everything at any time.</p>
      <div class="actions"><button data-act="s-export-json">Download JSON</button><button data-act="s-export-csv">Download CSV</button><button data-act="ics-all">Calendar (.ics)</button></div></div>
    <div class="card-block"><h2>What we store</h2><ul class="ticks left">
      <li>The trials you track: service, end date, amount, status</li>
      <li>Your name, currency, timezone and reminder choices</li>
      <li>Never: card numbers, bank details, passwords, page contents or email bodies</li></ul>
      <p class="hint"><a href="${IS_WEB ? '../' : 'https://trialexit.app/'}privacy.html" target="_blank" rel="noopener">Read the privacy policy</a></p></div>
    <div class="card-block danger-zone"><h2>Delete account</h2><p class="hint">Permanently deletes your account and every trial on our servers and this device. This can't be undone.</p>
      <div class="inline-form"><input id="s-delete-confirm" placeholder='Type "DELETE" to confirm'><button class="danger-solid" data-act="s-delete">Delete account</button></div></div>`;
}

export function settingsHtml(tab = 'profile') {
  return `<div class="page-head"><div><h1>Settings</h1></div></div>
    <div class="settings">
      <nav class="settings-nav">${TABS.map(([k, l]) => `<a href="#/settings/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</nav>
      <div class="settings-body">${{ profile: profileTab, notifications: notificationsTab, sources: sourcesTab, plan: planTab, data: dataTab }[tab]?.() ?? profileTab()}</div>
    </div>`;
}

/* ------------------------------------------------------------------- help */

const FAQ = [
  ['How does TrialExit find my trials?', 'Three ways: the Chrome extension notices when you start a trial on any website; it can scan Gmail or Outlook (read-only, on your device) for trial confirmation emails; and you can add or paste one yourself.'],
  ['When will I be reminded?', '2 days, 1 day, 6 hours and 1 hour before the charge (plus 5 days for trials longer than two weeks), and once after the renewal time to ask what happened. Change this in Settings → Notifications.'],
  ['Do you cancel for me?', "No — and you shouldn't trust anything that does without your password. We open the exact cancel page and show the steps, so it takes a minute."],
  ['Is my data safe?', 'We never ask for bank or card access. Emails and web pages are read on your device and never uploaded. Your trial list is stored in your account so it syncs and so email reminders can be sent.'],
  ['A cancel link is wrong', 'Links are community-maintained and shown with when they were last checked. Report it below and we fix it for everyone without an app update.'],
  ['What does it cost?', 'Free during launch. Later, a one-time lifetime unlock — never a subscription.'],
];

export function helpHtml() {
  return `<div class="page-head"><div><h1>Help</h1><p class="lede">Quick answers, and a real human if you need one.</p></div></div>
    <div class="card-block">${FAQ.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
    <div class="help-grid">
      <a class="card-block link-card" href="https://github.com/lowkyalekkala29/trialexit/issues/new?title=Broken%20cancel%20link%3A%20" target="_blank" rel="noopener"><b>Report a broken cancel link</b><span class="hint">Fixed for everyone, usually within a day</span></a>
      <a class="card-block link-card" href="https://github.com/lowkyalekkala29/trialexit/issues/new?title=Feedback%3A%20" target="_blank" rel="noopener"><b>Send feedback or request a service</b><span class="hint">We read everything</span></a>
    </div>`;
}

/* ---------------------------------------------------------------- actions */

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** @param {(p:string|null)=>void} go @param {()=>Promise<void>} persist @param {(m:string)=>void} toast */
export function accountActions(go, persist, toast, onSignedOut) {
  return {
    's-save-profile': async () => {
      const v = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id)).value.trim();
      state.settings.name = v('s-name');
      state.settings.region = v('s-region');
      state.settings.timezone = v('s-tz') || deviceZone;
      await persist();
      await updateUserName(state.settings.name);
      toast('Profile saved.');
      go(null);
    },
    's-save-notify': async () => {
      const email = /** @type {HTMLInputElement} */ (document.getElementById('s-email'));
      if (!email.disabled) state.settings.reminderEmail = email.checked;
      state.settings.reminderSkip = [...document.querySelectorAll('[data-nudge]')].filter((c) => !(/** @type {HTMLInputElement} */ (c).checked)).map((c) => /** @type {HTMLElement} */ (c).dataset.nudge);
      await persist();
      toast('Notification settings saved.');
    },
    'change:s-watch': async (el) => {
      const latest = (await chrome.storage.local.get('settings')).settings ?? {};
      state.settings.watchCheckouts = /** @type {HTMLInputElement} */ (el).checked;
      await chrome.storage.local.set({ settings: { ...latest, watchCheckouts: state.settings.watchCheckouts } });
      toast(state.settings.watchCheckouts ? 'Checkout detection on.' : 'Checkout detection off.');
    },
    's-unmute': async () => {
      await chrome.storage.local.set({ mutedHosts: [] });
      state.mutedHosts = [];
      go(null);
    },
    's-test-notify': () => {
      chrome.notifications.create('test', { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon-128.png'), title: 'TrialExit notifications work ✓', message: "This is what a nudge looks like. You'll get them before each trial charges.", priority: 1 });
    },
    notify: async () => {
      await Notification.requestPermission();
      go(null);
    },
    's-sync': async () => {
      const r = await syncTrials();
      toast(r.preview ? 'Preview mode — nothing to sync.' : r.ok ? 'Synced.' : `Sync failed: ${r.error}`);
      state.lastSync = (await chrome.storage.local.get('lastSync')).lastSync ?? null;
      go(null);
    },
    's-signout': async () => {
      if (!confirm('Sign out? Your trials stay on this device.')) return;
      await signOut();
      await onSignedOut();
    },
    's-licence': async () => {
      const key = /** @type {HTMLInputElement} */ (document.getElementById('s-licence')).value;
      const r = await validateLicence(key);
      const err = document.getElementById('s-licence-err');
      if (r.ok) {
        state.settings.unlocked = true;
        await persist();
        toast('Unlocked — thank you!');
        return go(null);
      }
      err.hidden = false;
      err.textContent = r.reason === 'not-configured' ? 'Payments open soon — everything is free during launch.' : "That key isn't valid.";
    },
    's-export-json': () => download(`trialexit-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), trials: state.trials, settings: { ...state.settings, mailErrors: undefined } }, null, 2), 'application/json'),
    's-export-csv': () => {
      const cols = ['serviceName', 'status', 'renewsAt', 'timezone', 'amount', 'currency', 'trialLengthDays', 'createdAt', 'cancelledAt', 'source'];
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = state.trials.map((t) => cols.map((c) => q(c === 'amount' ? (t.amount / 100).toFixed(2) : t[c])).join(','));
      download(`trialexit-${new Date().toISOString().slice(0, 10)}.csv`, [cols.join(','), ...rows].join('\n'), 'text/csv');
    },
    's-delete': async () => {
      if (/** @type {HTMLInputElement} */ (document.getElementById('s-delete-confirm')).value.trim() !== 'DELETE') return toast('Type DELETE to confirm.');
      try {
        await deleteAccount();
        toast('Account deleted.');
        await onSignedOut();
      } catch (err) {
        toast(String(err?.message ?? err));
      }
    },
  };
}
