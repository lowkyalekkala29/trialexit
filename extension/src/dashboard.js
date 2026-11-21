/**
 * Dashboard — shared by the extension (options page) and the web app (/app).
 * Platform differences go through chrome.* (real in the extension, a
 * localStorage adapter on the web) plus the IS_WEB flag for copy.
 */
import {
  zonedWallTimeToInstant,
  zonedParts,
  urgency,
  msUntil,
  formatCountdown,
  formatRenewalLocal,
  formatMoney,
  HOUR,
  DAY,
} from './core/dates.js';
import { normalizeDirectory, loadDirectory } from './core/directory.js';
import {
  canAddTrial,
  derivedStatus,
  savedTotals,
  sortedForDisplay,
  transition,
  validateTrial,
} from './core/store.js';
import { buildIcs, downloadIcs } from './core/ics.js';
import { parseTrialEmail } from './core/guess.js';
import { validateLicence } from './licence.js';
import { logoHtml } from './brand.js';

const IS_WEB = location.protocol !== 'chrome-extension:';

const ZONES = [
  'Asia/Kolkata',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const defaultRegion = deviceZone === 'Asia/Kolkata' || deviceZone === 'Asia/Calcutta' ? 'IN' : 'US';

/** Quick "ends in" choices. Most card-required trials are one of these. */
const WHEN_CHOICES = [3, 7, 14, 30];

const state = {
  /** @type {import('./core/types.js').Trial[]} */
  trials: [],
  /** @type {import('./core/types.js').DirectoryEntry[]} */
  directory: [],
  settings: { region: defaultRegion, unlocked: false, onboarded: false },
  /** @type {any} */
  seed: null,
  /** @type {string | null} */
  editingId: null,
  addOpen: false,
  /** @type {'pick'|'paste'|'manual'} */
  addTab: 'pick',
  quick: /** @type {{ serviceId: string|null, when: number|string }} */ ({ serviceId: null, when: 7 }),
  mail: { candidates: /** @type {any[]} */ ([]), busy: /** @type {any} */ (false), error: '' },
  ob: { step: 0, picked: /** @type {string[]} */ ([]), when: /** @type {Record<string, number|string>} */ ({}) },
};

const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

function esc(v) {
  return String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

const DIRECTORY_CANDIDATES = IS_WEB
  ? ['data/directory.json', '../data/directory.json']
  : ['../data/directory.json', 'data/directory.json'];

async function loadBundledDirectory() {
  for (const url of DIRECTORY_CANDIDATES) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      return normalizeDirectory(await res.json());
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

async function save() {
  const latest = (await chrome.storage.local.get('settings')).settings;
  state.settings = { ...state.settings, ...pickMail(latest) };
  await chrome.storage.local.set({ trials: state.trials, settings: state.settings });
  chrome.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => {});
}

/* ------------------------------------------------------------------ data */

function entryFor(trial) {
  return (
    state.directory.find((e) => e.serviceId === trial.serviceId && e.region === trial.region) ??
    state.directory.find((e) => e.serviceId === trial.serviceId)
  );
}

/** One directory entry per service, preferring the user's region. */
function services() {
  const region = state.settings.region;
  const byId = new Map();
  for (const e of state.directory) {
    const cur = byId.get(e.serviceId);
    if (!cur || (cur.region !== region && e.region === region)) byId.set(e.serviceId, e);
  }
  return [...byId.values()];
}

function serviceById(id) {
  return services().find((e) => e.serviceId === id) ?? null;
}

/** @param {number|string} when days from now, or a YYYY-MM-DD date */
function renewalFrom(when) {
  if (typeof when === 'number') {
    return { renewsAt: new Date(Date.now() + when * DAY).toISOString(), days: when };
  }
  const at = zonedWallTimeToInstant(String(when), '00:00', deviceZone);
  return { renewsAt: at.toISOString(), days: Math.max(1, Math.round((at.getTime() - Date.now()) / DAY)) };
}

function newTrial(fields) {
  return {
    id: crypto.randomUUID(),
    status: 'active',
    createdAt: new Date().toISOString(),
    cancelledAt: null,
    cancelUrlUsed: null,
    ...fields,
  };
}

/** @param {string} serviceId @param {number|string} when @param {number} [amountMajor] */
function quickTrial(serviceId, when, amountMajor) {
  const e = serviceById(serviceId);
  const { renewsAt, days } = renewalFrom(when);
  const region = e?.region ?? state.settings.region;
  return newTrial({
    serviceId,
    region,
    serviceName: e?.name ?? serviceId,
    renewsAt,
    timezone: deviceZone,
    amount: Math.max(0, Math.round((Number(amountMajor) || 0) * 100)),
    currency: region === 'IN' ? 'INR' : 'USD',
    trialLengthDays: days,
    source: 'picker',
  });
}

/** Unanswered = the renewal moment passed and the user hasn't told us how it ended. */
function bucket(t, now) {
  const st = derivedStatus(t, now);
  if (st === 'confirmed_cancelled' || st === 'kept' || st === 'dismissed' || t.status === 'charged') return 'resolved';
  if (st === 'charged' || st === 'awaiting_confirmation') return 'attention';
  if (msUntil(t.renewsAt, now) <= 48 * HOUR) return 'attention';
  return 'upcoming';
}

function combinedIcs(trials) {
  const blocks = trials.map((t) => {
    const entry = entryFor(t);
    return buildIcs({
      trial: t,
      cancelUrl: entry?.cancelUrl ?? '',
      steps: entry?.steps ?? [`Sign in to ${t.serviceName}`, 'Open billing settings', 'Cancel the subscription'],
      renewLabel: formatRenewalLocal(t.renewsAt, t.timezone),
      summaryLine: t.amount ? `${formatMoney(t.amount, t.currency)} will be charged` : 'trial ends',
      requiresChat: entry?.requiresChat,
    });
  });
  if (blocks.length === 1) return blocks[0];
  const head = blocks[0].slice(0, blocks[0].indexOf('BEGIN:VEVENT'));
  const events = blocks.map((b) => b.slice(b.indexOf('BEGIN:VEVENT'), b.indexOf('END:VCALENDAR')));
  return head + events.join('') + 'END:VCALENDAR\r\n';
}

/* ------------------------------------------------------------ onboarding */

function progress(step) {
  return `<div class="progress">${[0, 1, 2, 3].map((i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>`;
}

function serviceGrid(selected, act) {
  return `<div class="svc-grid">${services()
    .map(
      (e) => `<button type="button" class="svc" data-act="${act}" data-id="${esc(e.serviceId)}"
        aria-pressed="${selected.includes(e.serviceId)}">${logoHtml(e.serviceId, e.name, 'sm')}<span>${esc(e.name)}</span></button>`,
    )
    .join('')}</div>`;
}

function whenChips(key, value) {
  const isDate = typeof value === 'string';
  return `<div class="chips">
    ${WHEN_CHOICES.map(
      (d) => `<button type="button" class="chip" data-act="when" data-key="${esc(key)}" data-days="${d}" aria-pressed="${value === d}">in ${d} days</button>`,
    ).join('')}
    <input type="date" data-when-date="${esc(key)}" value="${isDate ? esc(value) : ''}" min="${new Date().toISOString().slice(0, 10)}" aria-label="Pick the end date" />
  </div>`;
}

function onboardingHtml() {
  const { step, picked } = state.ob;
  if (step === 0) {
    return `<div class="onboard"><div class="panel">${progress(0)}
      <h2>Never pay for a trial you forgot.</h2>
      <p class="lede">Put every free trial in one place. We nudge you before each one charges, and one tap opens the exact cancel page.</p>
      <ul class="ticks">
        <li>Nudges at 2 days, 1 day, 6 hours and 1 hour before the charge</li>
        <li>Direct cancel links and steps for popular services</li>
        <li>No bank or card access. No account needed.</li>
      </ul>
      <div class="ob-foot"><button class="ghost" data-act="ob-skip">Skip</button>
      <button class="primary" data-act="ob-next">Get started</button></div></div></div>`;
  }
  if (step === 1) {
    return `<div class="onboard"><div class="panel">${progress(1)}
      <h2>Which trials do you have right now?</h2>
      <p class="lede">Tap every service you're trialling. You can add others later, or paste a confirmation email.</p>
      ${IS_WEB ? '' : `<div class="banner" style="margin-bottom:14px"><div><b>Don't remember?</b> We'll look in your inbox for trial emails (read-only, stays on this device).${state.mail.error ? `<div class="error">${esc(state.mail.error)}</div>` : ''}</div>
        <div class="actions" style="flex-wrap:nowrap">${['gmail', 'outlook'].map((p) => `<button class="primary" data-act="ob-mail" data-provider="${p}" ${state.mail.busy ? 'disabled' : ''}>${state.mail.busy === p ? 'Scanning…' : PROVIDER_LABEL[p]}</button>`).join('')}</div></div>`}
      ${serviceGrid(picked, 'ob-pick')}
      <div class="ob-foot"><button class="ghost" data-act="ob-skip">I don't have any right now</button>
      <button class="primary" data-act="ob-next" ${picked.length ? '' : 'disabled'}>Next${picked.length ? ` · ${picked.length} selected` : ''}</button></div></div></div>`;
  }
  if (step === 2) {
    return `<div class="onboard"><div class="panel">${progress(2)}
      <h2>When does each one end?</h2>
      <p class="lede">Best guess is fine. You can fix it any time.</p>
      ${picked
        .map((id) => {
          const e = serviceById(id);
          return `<div class="when-row"><div class="when-head">${logoHtml(id, e?.name ?? id, 'sm')}${esc(e?.name ?? id)}</div>${whenChips(id, state.ob.when[id] ?? 7)}</div>`;
        })
        .join('')}
      <div class="ob-foot"><button class="ghost" data-act="ob-back">Back</button>
      <button class="primary" data-act="ob-save">Track ${picked.length} trial${picked.length === 1 ? '' : 's'}</button></div></div></div>`;
  }
  const canNotify = IS_WEB && 'Notification' in window && Notification.permission === 'default';
  return `<div class="onboard"><div class="panel">${progress(3)}
    <h2>Make sure the nudge reaches you</h2>
    ${IS_WEB
      ? `<p class="lede">A web page can only alert you while it's open. Add your trials to your calendar so the reminder reaches your phone.</p>
         <div class="actions">
           <button class="primary" data-act="ics-all">Add all to calendar</button>
           ${canNotify ? '<button data-act="notify">Allow browser alerts</button>' : ''}
         </div>`
      : `<p class="lede">Alerts are on. Pin TrialExit so the red badge is always visible: click the puzzle icon in Chrome's toolbar, then the pin next to TrialExit.</p>
         <p class="lede">Connect Gmail or Outlook on the next screen and we'll keep checking for new trial emails — including trials you start on your phone.</p>
         <div class="actions"><button data-act="ics-all">Also add to my calendar</button></div>`}
    <div class="ob-foot"><span></span><button class="primary" data-act="ob-done">Go to my trials</button></div></div></div>`;
}

/* ---------------------------------------------------------------- home */

function countdownHtml(t, now, st, band) {
  if (st === 'kept') return '<span class="count"><small>keeping</small></span>';
  if (st === 'confirmed_cancelled') return '<span class="count" style="color:var(--brand)">✓<small>cancelled</small></span>';
  if (st === 'charged') return '<span class="count crit">Renewed<small>time passed</small></span>';
  const cls = band === 'critical' ? 'crit' : band === 'soon' ? 'soon' : '';
  return `<span class="count ${cls}">${formatCountdown(msUntil(t.renewsAt, now))}<small>left</small></span>`;
}

function cardHtml(t, now) {
  const st = derivedStatus(t, now);
  const resolved = bucket(t, now) === 'resolved';
  const band = resolved ? 'done' : urgency(t.renewsAt, now);
  const entry = entryFor(t);
  const unanswered = st === 'charged' && t.status !== 'charged';
  const id = esc(t.id);

  const pills = [
    st === 'awaiting_confirmation' ? '<span class="pill warn">did you finish cancelling?</span>' : '',
    t.status === 'charged' ? '<span class="pill crit">charged</span>' : '',
    entry && entry.verified === false ? '<span class="pill warn" title="Not verified against the live site recently">link unverified</span>' : '',
    entry?.requiresChat && !resolved ? '<span class="pill warn">cancel via chat</span>' : '',
  ].join('');

  const amountText = t.amount ? `<span class="amount">${formatMoney(t.amount, t.currency)}</span>` : 'Amount not set';

  let actions;
  if (unanswered) {
    actions = `<div class="hint" style="color:var(--text);width:100%"><b>Did it renew?</b> Tell us so nothing slips through.</div>
      <button class="primary sm" data-act="confirm" data-id="${id}">I cancelled in time</button>
      <button class="sm" data-act="keep" data-id="${id}">Keeping it</button>
      <button class="sm" data-act="charged" data-id="${id}">I got charged</button>`;
  } else if (resolved) {
    actions = `<button class="ghost sm" data-act="undo" data-id="${id}">Undo</button>
      <button class="ghost sm" data-act="delete" data-id="${id}">Remove</button>`;
  } else {
    actions = `${entry ? `<a class="btn primary sm" href="${esc(entry.cancelUrl)}" target="_blank" rel="noopener" data-act="open" data-id="${id}">Cancel at ${esc(entry.name)} ↗</a>` : ''}
      <button class="sm" data-act="confirm" data-id="${id}">I cancelled it</button>
      <button class="sm" data-act="keep" data-id="${id}">Keeping it</button>
      <button class="ghost sm" data-act="ics" data-id="${id}">Calendar</button>
      <button class="ghost sm" data-act="edit" data-id="${id}">Edit</button>
      <button class="ghost sm" data-act="delete" data-id="${id}">Remove</button>`;
  }

  const refund =
    t.status === 'charged'
      ? `<div class="hint">${entry?.refundWindowDays ? `You may still be inside ${esc(entry.name)}'s ${entry.refundWindowDays}-day refund window — ` : ''}Cancel now to stop the next cycle${entry ? ` (<a href="${esc(entry.cancelUrl)}" target="_blank" rel="noopener">cancel page</a>)` : ''}, then ask support for a refund citing the unused period.</div>`
      : '';

  return `
    <article class="card" data-band="${band}" data-id="${id}">
      <div class="card-head">
        ${logoHtml(t.serviceId, t.serviceName)}
        <div style="display:grid;gap:2px;min-width:0">
          <span class="card-name">${esc(t.serviceName)}</span>
          <span class="meta">${amountText} · ${resolved ? '' : 'renews '}${esc(formatRenewalLocal(t.renewsAt, t.timezone))}${t.cardLabel ? ` · ${esc(t.cardLabel)}` : ''}</span>
        </div>
        ${countdownHtml(t, now, st, band)}
      </div>
      ${pills ? `<div class="card-head">${pills}</div>` : ''}
      ${refund}
      <div class="actions">${actions}</div>
      ${entry?.steps?.length && !resolved
        ? `<details class="steps"><summary>How to cancel at ${esc(entry.name)}</summary><ol>${entry.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${entry.note ? `<p>${esc(entry.note)}</p>` : ''}</details>`
        : ''}
    </article>`;
}

function summaryHtml(now) {
  const live = state.trials.filter((t) => bucket(t, now) !== 'resolved');
  const active = live.filter((t) => msUntil(t.renewsAt, now) > 0);
  const urgent = active.filter((t) => msUntil(t.renewsAt, now) <= 48 * HOUR);
  const week = active.filter((t) => msUntil(t.renewsAt, now) <= 7 * DAY);
  const stake = { INR: 0, USD: 0 };
  for (const t of active) stake[t.currency] += t.amount;
  const stakeText = [stake.INR && formatMoney(stake.INR, 'INR'), stake.USD && formatMoney(stake.USD, 'USD')]
    .filter(Boolean)
    .join(' + ');
  const stat = (n, label, cls = '') => `<div class="stat ${cls}"><b>${n}</b><span>${label}</span></div>`;
  return `<div class="summary">
    ${stat(active.length, 'active trials')}
    ${stat(urgent.length, 'end within 48h', urgent.length ? 'crit' : '')}
    ${stat(week.length, 'end this week', week.length ? 'soon' : '')}
    ${stat(esc(stakeText || '—'), 'at stake')}
  </div>`;
}

function sectionsHtml(now) {
  if (!state.trials.length) {
    return `<div class="empty">No trials yet.<br />Press <b>Add trial</b> — it takes five seconds.</div>`;
  }
  const sorted = sortedForDisplay(state.trials, now);
  const groups = { attention: [], upcoming: [], resolved: [] };
  for (const t of sorted) groups[bucket(t, now)].push(t);
  const sec = (key, title) =>
    groups[key].length
      ? `<section class="section"><div class="section-head"><h2>${title}</h2><span class="n">${groups[key].length}</span></div>
         <div class="cards">${groups[key].map((t) => cardHtml(t, now)).join('')}</div></section>`
      : '';
  return `${sec('attention', 'Needs attention')}${sec('upcoming', 'Upcoming')}${
    !groups.attention.length && !groups.upcoming.length ? '<div class="empty" style="margin-bottom:22px">Nothing ending soon. You\'re all clear.</div>' : ''
  }${
    groups.resolved.length
      ? `<details class="section"><summary class="section-head"><h2>Resolved</h2><span class="n">${groups.resolved.length}</span></summary>
         <div class="cards" style="margin-top:10px">${groups.resolved.map((t) => cardHtml(t, now)).join('')}</div></details>`
      : ''
  }`;
}

/* ---------------------------------------------------------------- email */

const PROVIDER_LABEL = { gmail: 'Gmail', outlook: 'Outlook' };

function mailErrorText(provider, reason) {
  const r = String(reason ?? '');
  const name = PROVIDER_LABEL[provider] ?? 'Email';
  if (r === 'not-configured') return `${name} connection isn't set up in this build yet. Use Paste email for now.`;
  if (r === 'expired') return `${name} sign-in expired — press Connect ${name} again.`;
  if (r === 'no-token' || /did not approve|cancel|access_denied|user/i.test(r)) return `${name} sign-in was cancelled.`;
  return `Couldn't reach ${name} (${r}).`;
}

function connected() {
  return state.settings.mailConnected ?? {};
}

function connectButtons(cls = 'primary') {
  return ['gmail', 'outlook']
    .filter((p) => !connected()[p])
    .map(
      (p) => `<button class="${cls}" data-act="mail-connect" data-provider="${p}" ${state.mail.busy ? 'disabled' : ''}>${
        state.mail.busy === p ? 'Scanning…' : `Connect ${PROVIDER_LABEL[p]}`
      }</button>`,
    )
    .join('');
}

function mailHtml() {
  if (IS_WEB) return '';
  const m = state.mail;
  const conn = connected();
  const anyConnected = Object.values(conn).some(Boolean);
  const err = m.error ? `<div class="error">${esc(m.error)}</div>` : '';
  let out = '';
  if (m.candidates.length) {
    out += `<div class="panel" id="mail-panel">
      <div class="section-head" style="margin:0 0 6px"><h2>Found in your email</h2><span class="n">${m.candidates.length}</span></div>
      <p class="hint" style="margin:0 0 12px">Check the date, then track. We'll nudge you before each one charges.</p>
      <div class="cards">${m.candidates
        .map((c) => {
          const mid = esc(c.messageId);
          return `<div class="card" style="box-shadow:none">
            <div class="card-head">${logoHtml(c.serviceId ?? '', c.serviceName)}
              <div style="display:grid;gap:2px;min-width:0"><span class="card-name">${esc(c.serviceName)}</span>
              <span class="meta">${esc(c.subject)} · ${esc(PROVIDER_LABEL[c.provider] ?? '')}</span></div></div>
            <div class="chips">
              <label style="display:flex;align-items:center;gap:8px">Ends on <input type="date" data-mail-date="${mid}" value="${esc(c.renewsOn ?? '')}"></label>
              ${c.renewalMatched ? `<span class="hint">read "${esc(c.renewalMatched)}"</span>` : c.renewsOn ? '<span class="hint">guessed from trial length</span>' : '<span class="pill warn">set the date</span>'}
              ${c.amount ? `<span class="pill">${c.currency === 'USD' ? '$' : '₹'}${esc(c.amount)}</span>` : ''}
            </div>
            <div class="actions"><button class="primary sm" data-act="mail-track" data-id="${mid}">Track it</button>
            <button class="ghost sm" data-act="mail-dismiss" data-id="${mid}">Not a trial</button></div>
          </div>`;
        })
        .join('')}</div></div>`;
  }
  if (anyConnected) {
    const last = state.settings.mailLastScan ? new Date(state.settings.mailLastScan).toLocaleString() : 'never';
    const names = Object.keys(conn).filter((k) => conn[k]).map((k) => PROVIDER_LABEL[k]);
    out += `<div class="hint" style="margin:-8px 0 18px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span>✓ ${esc(names.join(' + '))} connected · checked ${esc(last)} · rescans every 6h</span>
      <button class="ghost sm" data-act="mail-rescan" ${m.busy ? 'disabled' : ''}>${m.busy ? 'Scanning…' : 'Scan now'}</button>
      ${connectButtons('ghost sm')}
      ${Object.keys(conn).filter((k) => conn[k]).map((k) => `<button class="ghost sm" data-act="mail-disconnect" data-provider="${k}">Disconnect ${PROVIDER_LABEL[k]}</button>`).join('')}
      ${err}</div>`;
    return out;
  }
  return `${out}<div class="banner" style="background:var(--surface);border-color:var(--line);color:var(--text)">
    <div><b>Catch every trial automatically.</b> <span class="hint">Connect your email (read-only) and we'll find trial confirmations — including ones started on your phone or in app stores. Emails are read on this device and never uploaded.</span>${err}</div>
    <div class="actions" style="flex-wrap:nowrap">${connectButtons()}</div></div>`;
}

async function mailCall(type, provider = null) {
  state.mail.busy = provider ?? true;
  state.mail.error = '';
  renderMail();
  const res = await chrome.runtime.sendMessage({ type, provider }).catch((err) => ({ ok: false, reason: err?.message }));
  state.mail.busy = false;
  const got = await chrome.storage.local.get(['mailCandidates', 'settings']);
  state.mail.candidates = got.mailCandidates ?? [];
  state.settings = { ...state.settings, ...pickMail(got.settings) };
  if (!res?.ok) state.mail.error = mailErrorText(provider, res?.reason);
  else if (type === 'mail-rescan') {
    const errs = Object.entries(state.settings.mailErrors ?? {});
    if (errs.length) state.mail.error = errs.map(([p, r]) => mailErrorText(p, r)).join(' ');
  }
  return res;
}

/** Only the worker-owned mail fields — never let a stale copy clobber the rest. */
function pickMail(settings) {
  if (!settings) return {};
  const { mailConnected, mailLastScan, mailErrors } = settings;
  return { mailConnected, mailLastScan, mailErrors };
}

function renderMail() {
  const slot = document.getElementById('mail-slot');
  if (slot) slot.innerHTML = mailHtml();
}

/* ------------------------------------------------------------ add panel */

function manualFormHtml() {
  const editing = state.trials.find((t) => t.id === state.editingId) ?? null;
  const seedRegion =
    state.seed?.region ?? (state.seed?.currency === 'USD' ? 'US' : state.seed?.currency === 'INR' ? 'IN' : null);
  const region = editing?.region ?? seedRegion ?? state.settings.region;
  const seedDays = Number(state.seed?.trialLengthDays) || null;
  const values = editing
    ? {
        name: editing.serviceName,
        ...zonedParts(editing.renewsAt, editing.timezone),
        tz: editing.timezone,
        amount: editing.amount ? editing.amount / 100 : '',
        len: editing.trialLengthDays,
        card: editing.cardLabel ?? '',
      }
    : {
        name: state.seed?.serviceName ?? '',
        ...(state.seed?.renewsAt
          ? zonedParts(state.seed.renewsAt, deviceZone)
          : { date: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10), time: '00:00' }),
        tz: deviceZone,
        amount: state.seed?.amount ?? '',
        len: seedDays ?? 7,
        card: '',
      };

  const datalist = services().map((e) => `<option value="${esc(e.name)}"></option>`).join('');
  const zones = ZONES.includes(values.tz) ? ZONES : [values.tz, ...ZONES];
  const lengths = [7, 14, 30, 60];
  const chosenLen = Number(values.len);
  if (Number.isFinite(chosenLen) && !lengths.includes(chosenLen)) {
    lengths.push(chosenLen);
    lengths.sort((a, b) => a - b);
  }

  return `
    <form class="add" id="add-form">
      ${state.seed?.note ? `<p class="banner row-span" style="margin:0">${esc(state.seed.note)}</p>` : ''}
      <label>Service
        <input id="f-name" list="services" placeholder="Netflix" value="${esc(values.name)}" required />
        <datalist id="services">${datalist}</datalist>
      </label>
      <label>Renewal amount (optional)
        <input id="f-amount" type="number" min="0" step="0.01" placeholder="499" value="${esc(values.amount)}" />
      </label>
      <label>Trial ends / renews on
        <input id="f-date" type="date" value="${esc(values.date)}" required />
      </label>
      <label>At
        <input id="f-time" type="time" value="${esc(values.time)}" required />
      </label>
      <details class="row-span steps"><summary>More options</summary>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:10px">
          <label>Region / currency
            <select id="f-region">
              <option value="IN" ${region === 'IN' ? 'selected' : ''}>India (₹)</option>
              <option value="US" ${region === 'US' ? 'selected' : ''}>US ($)</option>
            </select>
          </label>
          <label>Billing timezone
            <select id="f-tz">${zones.map((z) => `<option value="${z}" ${z === values.tz ? 'selected' : ''}>${z}</option>`).join('')}</select>
          </label>
          <label>Trial length
            <select id="f-len">${lengths.map((n) => `<option value="${n}" ${String(n) === String(values.len) ? 'selected' : ''}>${n} days</option>`).join('')}</select>
          </label>
          <label>Paid with
            <input id="f-card" placeholder="UPI AutoPay / HDFC card" value="${esc(values.card)}" />
          </label>
        </div>
      </details>
      <div class="row-span actions">
        <button type="submit" class="primary">${editing ? 'Save changes' : 'Track this trial'}</button>
        <button type="button" class="ghost" data-act="close-add">Cancel</button>
      </div>
      <p class="error row-span" id="f-error" hidden></p>
    </form>`;
}

function addPanelHtml() {
  const editing = state.trials.find((t) => t.id === state.editingId) ?? null;
  const tab = editing ? 'manual' : state.addTab;
  const tabBtn = (key, label) =>
    `<button type="button" role="tab" data-act="tab" data-tab="${key}" aria-selected="${tab === key}">${label}</button>`;
  let body;
  if (tab === 'pick') {
    const q = state.quick;
    body = `${serviceGrid(q.serviceId ? [q.serviceId] : [], 'quick-pick')}
      ${q.serviceId
        ? `<div style="margin-top:16px;display:grid;gap:12px">
            <label>When does the trial end?</label>${whenChips('quick', q.when)}
            <label style="max-width:240px">Renewal amount (optional)<input id="q-amount" type="number" min="0" step="0.01" placeholder="499" /></label>
            <div class="actions"><button class="primary" data-act="quick-save">Track ${esc(serviceById(q.serviceId)?.name ?? '')}</button>
            <button class="ghost" data-act="close-add">Cancel</button></div></div>`
        : '<p class="hint" style="margin-top:12px">Not listed? Use <b>Paste email</b> or <b>Enter manually</b>.</p>'}`;
  } else if (tab === 'paste') {
    body = `<p class="hint" style="margin-top:0">Trial started on your phone, in an app, or before you installed TrialExit? Paste the confirmation email or receipt.</p>
      <textarea id="paste-text" rows="6" placeholder="e.g. Your free trial of YouTube Premium has started. Starting December 21, 2026 you'll be charged ₹149.00/month."></textarea>
      <div class="actions" style="margin-top:10px"><button class="primary" data-act="parse-email">Read it</button>
      <span class="hint" id="paste-hint">Read on your device. Nothing is uploaded.</span></div>`;
  } else {
    body = manualFormHtml();
  }
  return `<div class="panel" id="add-panel">
    <h2>${editing ? `Edit ${esc(editing.serviceName)}` : 'Add a trial'}</h2>
    ${editing ? '<div style="height:10px"></div>' : `<div class="tabs" role="tablist">${tabBtn('pick', 'Pick a service')}${tabBtn('paste', 'Paste email')}${tabBtn('manual', 'Enter manually')}</div>`}
    ${body}</div>`;
}

/* --------------------------------------------------------------- render */

function render() {
  const now = new Date();
  const onboarding = !state.settings.onboarded && !state.trials.length && !state.seed;
  document.body.classList.toggle('is-onboarding', onboarding);

  const saved = savedTotals(state.trials);
  const savedText = [saved.INR && formatMoney(saved.INR, 'INR'), saved.USD && formatMoney(saved.USD, 'USD')]
    .filter(Boolean)
    .join(' + ');
  $('#saved').innerHTML = savedText ? `Saved <b>${esc(savedText)}</b>` : '';
  $('#top-actions').innerHTML = onboarding ? '' : `<button class="primary" data-act="open-add">+ Add trial</button>`;

  if (onboarding) {
    $('#app').innerHTML = onboardingHtml();
    return;
  }
  $('#app').innerHTML =
    (state.addOpen || state.editingId || state.seed ? addPanelHtml() : '') +
    `<div id="mail-slot">${mailHtml()}</div>` +
    `<div id="cards-wrap">${summaryHtml(now)}${sectionsHtml(now)}</div>`;
}

/** Refresh countdowns only — never the form, or typing gets wiped. */
function renderCards() {
  const wrap = document.getElementById('cards-wrap');
  if (!wrap || document.body.classList.contains('is-onboarding')) return;
  const openResolved = wrap.querySelector('details.section')?.hasAttribute('open');
  const now = new Date();
  wrap.innerHTML = summaryHtml(now) + sectionsHtml(now);
  if (openResolved) wrap.querySelector('details.section')?.setAttribute('open', '');
}

function closeAdd() {
  state.addOpen = false;
  state.editingId = null;
  state.seed = null;
  state.quick = { serviceId: null, when: 7 };
}

/* --------------------------------------------------------------- events */

function readForm() {
  const val = (sel) => /** @type {HTMLInputElement} */ ($(sel)).value;
  const name = val('#f-name').trim();
  const region = val('#f-region');
  const currency = region === 'IN' ? 'INR' : 'USD';
  const entry =
    state.directory.find((x) => x.region === region && x.name.toLowerCase() === name.toLowerCase()) ??
    state.directory.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return {
    serviceId: entry?.serviceId ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    region,
    serviceName: entry?.name ?? name,
    renewsAt: zonedWallTimeToInstant(val('#f-date'), val('#f-time'), val('#f-tz')).toISOString(),
    timezone: val('#f-tz'),
    amount: Math.round((Number(val('#f-amount')) || 0) * 100),
    currency,
    trialLengthDays: Number(val('#f-len')),
    cardLabel: val('#f-card').trim() || undefined,
  };
}

function gateOk() {
  const gate = canAddTrial(state.trials);
  if (!gate.allowed && !state.settings.unlocked) {
    /** @type {HTMLDialogElement} */ ($('#paywall')).showModal();
    return false;
  }
  return true;
}

document.addEventListener('submit', async (e) => {
  const form = /** @type {HTMLFormElement} */ (e.target);
  if (form.id !== 'add-form') return;
  e.preventDefault();

  const fields = readForm();
  const errors = validateTrial(fields);
  const errEl = $('#f-error');
  if (errors.length) {
    errEl.hidden = false;
    errEl.textContent = errors.join(' · ');
    return;
  }
  if (state.editingId) {
    state.trials = state.trials.map((t) => (t.id === state.editingId ? { ...t, ...fields } : t));
  } else {
    if (!gateOk()) return;
    state.trials = [...state.trials, newTrial({ ...fields, source: state.seed?.source ?? (state.seed ? 'page' : 'manual') })];
  }
  state.settings.onboarded = true;
  closeAdd();
  await save();
  render();
});

document.addEventListener('change', (e) => {
  const el = /** @type {HTMLInputElement} */ (e.target);
  const key = el.dataset?.whenDate;
  if (!key || !el.value) return;
  if (key === 'quick') state.quick.when = el.value;
  else state.ob.when[key] = el.value;
  el.closest('.chips')?.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
});

document.addEventListener('click', async (e) => {
  const el = /** @type {HTMLElement} */ (e.target).closest('[data-act]');
  if (!el) return;
  const { id, act } = el.dataset;
  const trial = state.trials.find((t) => t.id === id);

  switch (act) {
    case 'ob-next':
      state.ob.step += 1;
      return render();
    case 'ob-back':
      state.ob.step -= 1;
      return render();
    case 'ob-skip':
    case 'ob-done':
      state.settings.onboarded = true;
      await save();
      return render();
    case 'ob-pick': {
      const set = new Set(state.ob.picked);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      state.ob.picked = [...set];
      return render();
    }
    case 'ob-save': {
      state.trials = [...state.trials, ...state.ob.picked.map((sid) => quickTrial(sid, state.ob.when[sid] ?? 7))];
      state.ob.step = 3;
      await chrome.storage.local.set({ trials: state.trials });
      chrome.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => {});
      // Keep the wizard on screen for the alerts step even though trials now exist.
      document.body.classList.add('is-onboarding');
      $('#app').innerHTML = onboardingHtml();
      return;
    }
    case 'when': {
      const days = Number(el.dataset.days);
      if (el.dataset.key === 'quick') state.quick.when = days;
      else state.ob.when[el.dataset.key ?? ''] = days;
      el.closest('.chips')?.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === el)));
      const date = el.closest('.chips')?.querySelector('input[type=date]');
      if (date) /** @type {HTMLInputElement} */ (date).value = '';
      return;
    }
    case 'ob-mail': {
      const res = await mailCall('mail-connect', el.dataset.provider);
      if (res?.ok) {
        state.settings.onboarded = true;
        await save();
      }
      return render();
    }
    case 'mail-connect':
      await mailCall('mail-connect', el.dataset.provider);
      return render();
    case 'mail-rescan':
      await mailCall('mail-rescan');
      return render();
    case 'mail-disconnect':
      await mailCall('mail-disconnect', el.dataset.provider);
      return render();
    case 'mail-dismiss':
      await chrome.runtime.sendMessage({ type: 'mail-dismiss', messageId: id });
      state.mail.candidates = state.mail.candidates.filter((c) => c.messageId !== id);
      return render();
    case 'mail-track': {
      const c = state.mail.candidates.find((x) => x.messageId === id);
      if (!c) return;
      const date = /** @type {HTMLInputElement|null} */ (document.querySelector(`[data-mail-date="${CSS.escape(id ?? '')}"]`))?.value;
      if (!date) {
        state.mail.error = 'Set the end date first.';
        return renderMail();
      }
      const res = await chrome.runtime.sendMessage({ type: 'add-trial', trial: { ...c, renewsOn: date, source: c.provider } });
      if (!res?.ok) return alert(res?.reason ?? 'Could not save');
      await chrome.runtime.sendMessage({ type: 'mail-dismiss', messageId: id });
      state.mail.candidates = state.mail.candidates.filter((x) => x.messageId !== id);
      const got = await chrome.storage.local.get('trials');
      state.trials = got.trials ?? state.trials;
      return render();
    }
    case 'notify':
      await Notification.requestPermission();
      el.remove();
      return;
    case 'ics-all': {
      const live = state.trials.filter((t) => bucket(t, new Date()) !== 'resolved');
      if (live.length) downloadIcs('trialexit-trials.ics', combinedIcs(live));
      return;
    }
    case 'open-add':
      state.addOpen = true;
      state.editingId = null;
      render();
      $('#add-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    case 'close-add':
      closeAdd();
      return render();
    case 'tab':
      state.addTab = /** @type {any} */ (el.dataset.tab);
      return render();
    case 'quick-pick':
      state.quick.serviceId = state.quick.serviceId === id ? null : id ?? null;
      return render();
    case 'quick-save': {
      if (!state.quick.serviceId || !gateOk()) return;
      const amount = Number(/** @type {HTMLInputElement} */ ($('#q-amount'))?.value) || 0;
      state.trials = [...state.trials, quickTrial(state.quick.serviceId, state.quick.when, amount)];
      state.settings.onboarded = true;
      closeAdd();
      await save();
      return render();
    }
    case 'parse-email': {
      const text = /** @type {HTMLTextAreaElement} */ ($('#paste-text')).value;
      const r = parseTrialEmail(text, state.directory);
      if (!r.found) {
        $('#paste-hint').textContent = "Couldn't find a service, price or date in that text — try Enter manually.";
        return;
      }
      const bits = [
        r.serviceName,
        r.renewalMatched ? `renews "${r.renewalMatched}"` : r.days ? `${r.days.days}-day trial` : null,
        r.price && `${r.price.currency === 'USD' ? '$' : '₹'}${r.price.amount}`,
      ].filter(Boolean);
      state.seed = {
        serviceId: r.entry?.serviceId ?? null,
        region: r.entry?.region ?? null,
        serviceName: r.serviceName ?? '',
        amount: r.price?.amount ?? null,
        currency: r.price?.currency ?? null,
        trialLengthDays: r.days?.days ?? null,
        renewsAt: r.renewsOn ? zonedWallTimeToInstant(r.renewsOn, '00:00', deviceZone).toISOString() : null,
        source: 'email',
        note: `Read from your email: ${bits.join(' · ')}. Check it, then press Track.`,
      };
      state.addTab = 'manual';
      return render();
    }
    case 'edit':
      if (!trial) return;
      state.editingId = trial.id;
      render();
      $('#add-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    case 'open': {
      if (!trial) return;
      // Opening the cancel page is intent, not proof. Never mark it cancelled here.
      const entry = entryFor(trial);
      state.trials = transition(state.trials, id ?? '', 'awaiting_confirmation').map((t) =>
        t.id === id ? { ...t, cancelUrlUsed: entry?.cancelUrl ?? null } : t,
      );
      break;
    }
    case 'confirm':
      if (trial) state.trials = transition(state.trials, id ?? '', 'confirmed_cancelled');
      break;
    case 'keep':
      if (trial) state.trials = transition(state.trials, id ?? '', 'kept');
      break;
    case 'charged':
      if (trial) state.trials = transition(state.trials, id ?? '', 'charged');
      break;
    case 'undo':
      if (trial) state.trials = transition(state.trials, id ?? '', 'active');
      break;
    case 'delete':
      if (!trial || !confirm(`Remove ${trial.serviceName}? This cannot be undone.`)) return;
      state.trials = state.trials.filter((t) => t.id !== id);
      break;
    case 'ics':
      if (trial) downloadIcs(`trialexit-${trial.serviceId}.ics`, combinedIcs([trial]));
      return;
    default:
      return;
  }
  await save();
  render();
});

$('#unlock-close').addEventListener('click', () => /** @type {HTMLDialogElement} */ ($('#paywall')).close());

$('#unlock-apply').addEventListener('click', async () => {
  const code = /** @type {HTMLInputElement} */ ($('#unlock-code')).value.trim().toUpperCase();
  const errEl = $('#unlock-error');
  const res = await validateLicence(code);
  if (res.ok) {
    state.settings.unlocked = true;
    await save();
    /** @type {HTMLDialogElement} */ ($('#paywall')).close();
    render();
    return;
  }
  errEl.hidden = false;
  errEl.textContent =
    res.reason === 'not-configured'
      ? 'Payments are not live yet — this build is free during the launch period.'
      : 'That code is not valid.';
});

/* ----------------------------------------------------------------- boot */

async function boot() {
  const got = await chrome.storage.local.get(['trials', 'settings', 'pendingSeed', 'bundledDirectory', 'mailCandidates']);
  state.mail.candidates = Array.isArray(got.mailCandidates) ? got.mailCandidates : [];
  state.trials = Array.isArray(got.trials) ? got.trials : [];
  state.settings = { region: defaultRegion, unlocked: false, onboarded: false, ...(got.settings ?? {}) };
  if (state.trials.length) state.settings.onboarded = true;
  if (got.pendingSeed) {
    state.seed = got.pendingSeed;
    state.addOpen = true;
    state.addTab = 'manual';
    await chrome.storage.local.remove('pendingSeed');
  }
  state.directory = got.bundledDirectory ? normalizeDirectory(got.bundledDirectory) : await loadBundledDirectory();
  render();

  loadDirectory(state.directory).then((fresh) => {
    if (fresh.length && fresh.length !== state.directory.length) {
      state.directory = fresh;
      chrome.storage.local.set({ bundledDirectory: { entries: fresh } });
      if (!document.querySelector('#add-form, textarea, .onboard')) render();
    }
  });
}

// Another surface (popup, mail scan, Gmail page detector, other tab) changed the data: pick it up.
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== 'local') return;
  // The worker writes mail state into settings; never let a stale copy here clobber it.
  if (changes.settings?.newValue) state.settings = { ...state.settings, ...pickMail(changes.settings.newValue) };
  if (changes.mailCandidates) {
    state.mail.candidates = changes.mailCandidates.newValue ?? [];
    if (!document.body.classList.contains('is-onboarding')) renderMail();
  }
  if (!changes.trials) return;
  const next = changes.trials.newValue;
  if (Array.isArray(next) && JSON.stringify(next) !== JSON.stringify(state.trials)) {
    state.trials = next;
    renderCards();
  }
});

if (!IS_WEB) {
  const foot = document.createElement('p');
  foot.className = 'hint';
  foot.style.cssText = 'text-align:center;margin-top:30px';
  foot.textContent = `TrialExit ${chrome.runtime.getManifest().version} · extension id ${chrome.runtime.id}`;
  document.querySelector('.wrap')?.append(foot);
}

setInterval(renderCards, 30_000);
boot();
