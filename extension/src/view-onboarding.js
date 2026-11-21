/**
 * Onboarding — 5 steps, each skippable, resumable (step is in the URL).
 *  1 About you        → name, country/currency, timezone
 *  2 Catch trials     → extension + email sources
 *  3 Current trials   → pick services + when each ends
 *  4 Reminders        → email / browser / calendar + which nudges
 *  5 Done             → summary, go to dashboard
 */
import { state, esc, IS_WEB, services, serviceById, deviceZone, quickTrial, save, combinedIcs, bucket } from './state.js';
import { logoHtml } from './brand.js';
import { NUDGES } from './core/reminders.js';
import { downloadIcs } from './core/ics.js';
import { formatCountdown, msUntil } from './core/dates.js';

const STEPS = ['About you', 'Catch trials', 'Your trials', 'Reminders', 'Done'];
const WHEN = [3, 7, 14, 30];
const ZONES = ['Asia/Kolkata', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];

function frame(step, inner, { next = 'Continue', back = true, skip = true, nextAct = 'ob-next', disabled = false } = {}) {
  return `<div class="ob">
    <header class="ob-top">
      <div class="brand"><span class="mark">✓</span><span class="brand-name">TrialExit</span></div>
      <ol class="stepper">${STEPS.map((s, i) => `<li class="${i + 1 < step ? 'done' : i + 1 === step ? 'on' : ''}"><span>${i + 1 < step ? '✓' : i + 1}</span>${s}</li>`).join('')}</ol>
      <span class="hint mobile-only">Step ${step} of ${STEPS.length}</span>
    </header>
    <main class="ob-body"><div class="ob-card">${inner}
      <div class="ob-foot">
        ${back && step > 1 ? `<button class="ghost" data-act="ob-back" data-step="${step}">Back</button>` : '<span></span>'}
        <div class="actions">
          ${skip ? `<button class="ghost" data-act="ob-skip" data-step="${step}">Skip</button>` : ''}
          <button class="primary" data-act="${nextAct}" data-step="${step}" ${disabled ? 'disabled' : ''}>${next}</button>
        </div>
      </div>
    </div></main>
  </div>`;
}

const toggle = (id, on, label, sub = '', disabled = false) => `
  <label class="switch-row ${disabled ? 'disabled' : ''}">
    <span><b>${label}</b>${sub ? `<span class="hint">${sub}</span>` : ''}</span>
    <input type="checkbox" class="switch" id="${id}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
  </label>`;

export function onboardingHtml(step) {
  const s = state.settings;
  const signedIn = Boolean(state.session);
  if (step === 1) {
    const first = (state.session?.user?.name || s.name || '').split(' ')[0];
    return frame(
      1,
      `<h1>${first ? `Welcome, ${esc(first)}` : 'Welcome to TrialExit'}</h1>
      <p class="lede">Two quick questions so reminders show the right currency and time.</p>
      <div class="form-grid">
        <label class="span2">What should we call you?
          <input id="ob-name" value="${esc(s.name || state.session?.user?.name || '')}" placeholder="Your first name" autocomplete="given-name" />
        </label>
        <label>Where do you pay for subscriptions?
          <select id="ob-region">
            <option value="IN" ${s.region === 'IN' ? 'selected' : ''}>India (₹ INR)</option>
            <option value="US" ${s.region === 'US' ? 'selected' : ''}>United States ($ USD)</option>
            <option value="US" ${s.region !== 'IN' && s.region !== 'US' ? 'selected' : ''}>Elsewhere (prices in $)</option>
          </select>
        </label>
        <label>Your timezone
          <select id="ob-tz">${[...new Set([s.timezone || deviceZone, ...ZONES])].map((z) => `<option ${z === (s.timezone || deviceZone) ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>
        </label>
      </div>`,
      { back: false, skip: false, nextAct: 'ob-save-1' },
    );
  }
  if (step === 2) {
    const conn = s.mailConnected ?? {};
    const gm = conn.gmail;
    const sources = IS_WEB
      ? `<div class="source-card highlight ${gm ? 'ok' : ''}">
          <div class="source-icon">📧</div>
          <div><b>Scan my Gmail</b> ${gm ? '<span class="pill ok">done</span>' : '<span class="pill ok">recommended</span>'}
            <p class="hint">Finds trial confirmation emails — including trials started on your phone or in app stores. <b>Read-only</b>: we can't send, delete or change anything. Emails are read in this browser and never uploaded.</p></div>
          ${gm ? '' : `<button class="primary" data-act="mail-connect" data-provider="gmail" ${state.mail.busy ? 'disabled' : ''}>${state.mail.busy ? 'Scanning…' : 'Scan Gmail'}</button>`}
        </div>
        ${state.mail.error ? `<p class="error">${esc(state.mail.error)}</p>` : ''}
        ${state.mail.candidates.length ? `<p class="banner">Found ${state.mail.candidates.length} trial${state.mail.candidates.length > 1 ? 's' : ''} in your Gmail — you'll confirm ${state.mail.candidates.length > 1 ? 'them' : 'it'} on the dashboard.</p>` : gm ? '<p class="hint">No trial emails found in the last 60 days. We\'ll check again when you come back.</p>' : ''}
        <div class="source-card">
          <div class="source-icon">🧩</div>
          <div><b>TrialExit for Chrome</b><p class="hint">Catches trials the moment you sign up on any website, and keeps checking your inbox in the background.</p></div>
          <a class="btn" href="../#install" target="_blank" rel="noopener">Get the extension</a>
        </div>`
      : `<div class="source-card ok">
          <div class="source-icon">🛒</div>
          <div><b>Checkout detection</b> <span class="pill ok">on</span>
            <p class="hint">When you start a trial on any website, you'll see "Trial started — track it?" with the date and price filled in.</p></div>
        </div>
        ${['gmail', 'outlook']
          .map(
            (p) => `<div class="source-card ${conn[p] ? 'ok' : ''}">
          <div class="source-icon">${p === 'gmail' ? '📧' : '📨'}</div>
          <div><b>${p === 'gmail' ? 'Gmail' : 'Outlook'}</b> ${conn[p] ? '<span class="pill ok">connected</span>' : ''}
            <p class="hint">Finds trial confirmation emails — including trials started on your phone or in app stores. Read-only, read on this device, never uploaded.</p></div>
          ${conn[p] ? '' : `<button class="primary" data-act="mail-connect" data-provider="${p}" ${state.mail.busy ? 'disabled' : ''}>${state.mail.busy === p ? 'Scanning…' : 'Connect'}</button>`}
        </div>`,
          )
          .join('')}
        ${state.mail.error ? `<p class="error">${esc(state.mail.error)}</p>` : ''}
        ${state.mail.candidates.length ? `<p class="banner">Found ${state.mail.candidates.length} trial${state.mail.candidates.length > 1 ? 's' : ''} in your email — you'll review ${state.mail.candidates.length > 1 ? 'them' : 'it'} on the dashboard.</p>` : ''}`;
    return frame(2, `<h1>Find the trials you already have</h1><p class="lede">Most people have one they forgot about. We'll look for trial emails so you don't have to remember.</p><div class="sources">${sources}</div>`, { next: conn.gmail || IS_WEB === false ? 'Continue' : 'Continue' });
  }
  if (step === 3) {
    const picked = state.ob.picked;
    return frame(
      3,
      `<h1>Any trials running right now?</h1>
      <p class="lede">Tap each one, then pick roughly when it ends. Not listed? Add it from the dashboard.</p>
      <div class="svc-grid">${services()
        .map((e) => {
          const on = picked.includes(e.serviceId);
          return `<div class="svc-wrap ${on ? 'on' : ''}">
            <button type="button" class="svc" data-act="ob-pick" data-id="${esc(e.serviceId)}" aria-pressed="${on}">${logoHtml(e.serviceId, e.name, 'sm')}<span>${esc(e.name)}</span></button>
            ${on ? `<div class="chips mini">${WHEN.map((d) => `<button type="button" class="chip" data-act="ob-when" data-id="${esc(e.serviceId)}" data-days="${d}" aria-pressed="${(state.ob.when[e.serviceId] ?? 7) === d}">${d}d</button>`).join('')}<input type="date" data-ob-date="${esc(e.serviceId)}" value="${typeof state.ob.when[e.serviceId] === 'string' ? esc(state.ob.when[e.serviceId]) : ''}" min="${new Date().toISOString().slice(0, 10)}" aria-label="End date for ${esc(e.name)}"></div>` : ''}
          </div>`;
        })
        .join('')}</div>`,
      { next: picked.length ? `Track ${picked.length} trial${picked.length > 1 ? 's' : ''}` : "I don't have any", nextAct: 'ob-save-3', skip: false },
    );
  }
  if (step === 4) {
    const skip = new Set(s.reminderSkip ?? []);
    const canNotify = IS_WEB && 'Notification' in window;
    return frame(
      4,
      `<h1>How should we remind you?</h1>
      <p class="lede">Nudges get louder as the charge gets closer. Each one has a one-click cancel link.</p>
      <div class="settings-list">
        ${toggle('ob-email', s.reminderEmail !== false && signedIn, 'Email reminders', signedIn ? `To ${esc(state.session.user.email)} — work even when your browser is closed.` : 'Sign in to get email reminders.', !signedIn)}
        ${IS_WEB
          ? canNotify
            ? `<div class="switch-row"><span><b>Browser notifications</b><span class="hint">${Notification.permission === 'granted' ? 'Allowed ✓' : Notification.permission === 'denied' ? 'Blocked in browser settings' : 'While TrialExit is open in a tab'}</span></span>${Notification.permission === 'default' ? '<button class="sm" data-act="notify">Allow</button>' : ''}</div>`
            : ''
          : toggle('ob-browser', true, 'Desktop notifications', 'From the extension, with Open cancel page and Snooze buttons.', true)}
        <div class="switch-row"><span><b>Calendar</b><span class="hint">Add your trials to Google, Apple or Outlook calendar — reminders reach your phone.</span></span><button class="sm" data-act="ics-all">Add to calendar</button></div>
      </div>
      <h3 class="sub-h">Which nudges?</h3>
      <div class="check-list">${NUDGES.filter((n) => n.kind !== 'reminder')
        .map((n) => `<label class="check"><input type="checkbox" data-nudge="${n.kind}" ${skip.has(n.kind) ? '' : 'checked'}> ${esc(n.label)}</label>`)
        .join('')}</div>`,
      { nextAct: 'ob-save-4' },
    );
  }
  const live = state.trials.filter((t) => bucket(t) !== 'resolved');
  const next = [...live].sort((a, b) => Date.parse(a.renewsAt) - Date.parse(b.renewsAt))[0];
  return frame(
    5,
    `<div class="done-hero"><div class="done-mark">✓</div>
      <h1>You're all set${s.name ? `, ${esc(s.name.split(' ')[0])}` : ''}</h1>
      <p class="lede">${
        live.length
          ? `Tracking <b>${live.length}</b> trial${live.length > 1 ? 's' : ''}. ${next ? `Next up: <b>${esc(next.serviceName)}</b> in ${formatCountdown(msUntil(next.renewsAt))}.` : ''}`
          : "Nothing to track yet — we'll catch the next trial you start."
      }</p>
      <ul class="ticks left">
        ${IS_WEB ? '<li>Get the Chrome extension to catch trials as you sign up</li>' : '<li>Checkout detection is on for every site</li>'}
        <li>Nudges at ${NUDGES.filter((n) => !(s.reminderSkip ?? []).includes(n.kind) && n.kind !== 'reminder').length} points before each charge</li>
        <li>After each renewal we'll ask what happened</li>
      </ul></div>`,
    { back: true, skip: false, next: 'Go to dashboard', nextAct: 'ob-finish' },
  );
}

/** @param {(path:string|null)=>void} go @param {()=>Promise<void>} persist */
export function onboardingActions(go, persist) {
  const step = (el) => Number(el.dataset.step) || 1;
  return {
    'ob-next': (el) => go(`#/onboarding/${step(el) + 1}`),
    'ob-skip': (el) => go(`#/onboarding/${step(el) + 1}`),
    'ob-back': (el) => go(`#/onboarding/${step(el) - 1}`),
    'ob-save-1': async () => {
      const v = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id)).value;
      state.settings.name = v('ob-name').trim();
      state.settings.region = v('ob-region');
      state.settings.timezone = v('ob-tz');
      await persist();
      go('#/onboarding/2');
    },
    'ob-pick': (el) => {
      const set = new Set(state.ob.picked);
      if (set.has(el.dataset.id)) set.delete(el.dataset.id);
      else set.add(el.dataset.id);
      state.ob.picked = [...set];
      go(null);
    },
    'ob-when': (el) => {
      state.ob.when[el.dataset.id] = Number(el.dataset.days);
      go(null);
    },
    'change:ob-date': (el) => {
      if (/** @type {HTMLInputElement} */ (el).value) state.ob.when[el.dataset.obDate] = /** @type {HTMLInputElement} */ (el).value;
      go(null);
    },
    'ob-save-3': async () => {
      const existing = new Set(state.trials.map((t) => t.serviceId));
      state.trials = [
        ...state.trials,
        ...state.ob.picked.filter((id) => !existing.has(id)).map((id) => quickTrial(id, state.ob.when[id] ?? 7)),
      ];
      state.ob.picked = [];
      await persist();
      go('#/onboarding/4');
    },
    'ob-save-4': async () => {
      const email = /** @type {HTMLInputElement|null} */ (document.getElementById('ob-email'));
      if (email && !email.disabled) state.settings.reminderEmail = email.checked;
      state.settings.reminderSkip = [...document.querySelectorAll('[data-nudge]')]
        .filter((c) => !(/** @type {HTMLInputElement} */ (c).checked))
        .map((c) => /** @type {HTMLElement} */ (c).dataset.nudge);
      await persist();
      go('#/onboarding/5');
    },
    'ob-finish': async () => {
      state.settings.onboarded = true;
      await persist();
      go('#/');
    },
    'ics-all': () => {
      const live = state.trials.filter((t) => bucket(t) !== 'resolved');
      if (live.length) downloadIcs('trialexit-trials.ics', combinedIcs(live));
    },
    notify: async () => {
      await Notification.requestPermission();
      go(null);
    },
  };
}
