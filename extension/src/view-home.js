/**
 * Dashboard + Trials list + trial cards + the Add/Edit trial modal + email
 * suggestions.
 */
import {
  state, esc, IS_WEB, services, serviceById, entryFor, bucket, quickTrial, newTrial, removeTrial,
  combinedIcs, deviceZone, money, stampNow,
} from './state.js';
import { logoHtml } from './brand.js';
import { zonedWallTimeToInstant, zonedParts, urgency, msUntil, formatCountdown, formatRenewalLocal, formatMoney, HOUR, DAY } from './core/dates.js';
import { derivedStatus, savedTotals, sortedForDisplay, transition, validateTrial, canAddTrial } from './core/store.js';
import { parseTrialEmail } from './core/guess.js';
import { downloadIcs } from './core/ics.js';

const WHEN = [3, 7, 14, 30];
const PROVIDER_LABEL = { gmail: 'Gmail', outlook: 'Outlook' };

/* ------------------------------------------------------------------ cards */

function countdownHtml(t, st, band) {
  if (st === 'kept') return '<span class="count"><small>keeping</small></span>';
  if (st === 'confirmed_cancelled') return '<span class="count ok">✓<small>cancelled</small></span>';
  if (st === 'dismissed') return '<span class="count"><small>dismissed</small></span>';
  if (st === 'charged') return '<span class="count crit">Renewed<small>time passed</small></span>';
  const cls = band === 'critical' ? 'crit' : band === 'soon' ? 'soon' : '';
  return `<span class="count ${cls}">${formatCountdown(msUntil(t.renewsAt))}<small>left</small></span>`;
}

/** 'checkout' | 'gmail' | 'gmail:work@x.com' | 'email' → human label */
function sourceLabel(src) {
  if (src === 'checkout') return 'checkout';
  if (src === 'email') return 'pasted email';
  const [prov, account] = String(src).split(':');
  return account || PROVIDER_LABEL[prov] || src;
}

export function cardHtml(t) {
  const st = derivedStatus(t);
  const resolved = bucket(t) === 'resolved';
  const band = resolved ? 'done' : urgency(t.renewsAt);
  const entry = entryFor(t);
  const unanswered = st === 'charged' && t.status !== 'charged';
  const id = esc(t.id);
  const pills = [
    st === 'awaiting_confirmation' ? '<span class="pill warn">did you finish cancelling?</span>' : '',
    t.status === 'charged' ? '<span class="pill crit">charged</span>' : '',
    entry && entry.verified === false && !resolved ? '<span class="pill" title="Not verified against the live site recently">link unverified</span>' : '',
    entry?.requiresChat && !resolved ? '<span class="pill warn">cancel via chat</span>' : '',
    t.source && t.source !== 'manual' && t.source !== 'picker' ? `<span class="pill">from ${esc(sourceLabel(t.source))}</span>` : '',
  ].join('');
  const amountText = t.amount ? `<span class="amount">${formatMoney(t.amount, t.currency)}</span>` : 'Amount not set';

  let actions;
  if (unanswered) {
    actions = `<div class="ask"><b>Did it renew?</b> Tell us so nothing slips through.</div>
      <button class="primary sm" data-act="t-confirm" data-id="${id}">I cancelled in time</button>
      <button class="sm" data-act="t-keep" data-id="${id}">Keeping it</button>
      <button class="sm" data-act="t-charged" data-id="${id}">I got charged</button>`;
  } else if (resolved) {
    actions = `<button class="ghost sm" data-act="t-undo" data-id="${id}">Undo</button>
      <button class="ghost sm" data-act="t-delete" data-id="${id}">Remove</button>`;
  } else {
    actions = `${entry ? `<a class="btn primary sm" href="${esc(entry.cancelUrl)}" target="_blank" rel="noopener" data-act="t-open" data-id="${id}">Cancel at ${esc(entry.name)} ↗</a>` : ''}
      <button class="sm" data-act="t-confirm" data-id="${id}">I cancelled it</button>
      <button class="sm" data-act="t-keep" data-id="${id}">Keeping it</button>
      <span class="spacer"></span>
      <button class="ghost sm icon" data-act="t-ics" data-id="${id}" title="Add to calendar" aria-label="Add to calendar">📅</button>
      <button class="ghost sm icon" data-act="t-edit" data-id="${id}" title="Edit" aria-label="Edit">✎</button>
      <button class="ghost sm icon" data-act="t-delete" data-id="${id}" title="Remove" aria-label="Remove">🗑</button>`;
  }
  const refund =
    t.status === 'charged'
      ? `<div class="hint">${entry?.refundWindowDays ? `You may still be inside ${esc(entry.name)}'s ${entry.refundWindowDays}-day refund window — ` : ''}Cancel now to stop the next cycle${entry ? ` (<a href="${esc(entry.cancelUrl)}" target="_blank" rel="noopener">cancel page</a>)` : ''}, then ask support for a refund citing the unused period.</div>`
      : '';
  return `<article class="card" data-band="${band}" data-id="${id}">
      <div class="card-head">
        ${logoHtml(t.serviceId, t.serviceName)}
        <div class="card-title"><span class="card-name">${esc(t.serviceName)}</span>
          <span class="meta">${amountText} · ${resolved ? '' : 'renews '}${esc(formatRenewalLocal(t.renewsAt, t.timezone))}${t.cardLabel ? ` · ${esc(t.cardLabel)}` : ''}</span></div>
        ${countdownHtml(t, st, band)}
      </div>
      ${pills ? `<div class="pills">${pills}</div>` : ''}
      ${refund}
      <div class="actions">${actions}</div>
      ${entry?.steps?.length && !resolved ? `<details class="steps"><summary>How to cancel at ${esc(entry.name)}</summary><ol>${entry.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${entry.note ? `<p>${esc(entry.note)}</p>` : ''}</details>` : ''}
    </article>`;
}

/* -------------------------------------------------------------- dashboard */

function greeting() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const name = (state.settings.name || state.session?.user?.name || '').split(' ')[0];
  return `${part}${name ? `, ${esc(name)}` : ''}`;
}

export function summaryHtml() {
  const live = state.trials.filter((t) => bucket(t) !== 'resolved' && msUntil(t.renewsAt) > 0);
  const urgent = live.filter((t) => msUntil(t.renewsAt) <= 48 * HOUR);
  const week = live.filter((t) => msUntil(t.renewsAt) <= 7 * DAY);
  const stake = { INR: 0, USD: 0 };
  for (const t of live) stake[t.currency] += t.amount;
  const saved = money(savedTotals(state.trials));
  const stat = (n, label, cls = '', href = '') =>
    `<${href ? `a href="${href}"` : 'div'} class="stat ${cls}"><b>${n}</b><span>${label}</span></${href ? 'a' : 'div'}>`;
  return `<div class="summary">
    ${stat(live.length, 'active trials', '', '#/trials')}
    ${stat(urgent.length, 'end within 48 hours', urgent.length ? 'crit' : '')}
    ${stat(esc(money(stake) || '—'), 'at stake if you forget')}
    ${stat(esc(saved || '—'), 'saved so far', saved ? 'ok' : '', '#/savings')}
  </div>`;
}

export function dashboardHtml() {
  const sorted = sortedForDisplay(state.trials);
  const attention = sorted.filter((t) => bucket(t) === 'attention');
  const upcoming = sorted.filter((t) => bucket(t) === 'upcoming');
  const empty = !state.trials.length;
  return `<div class="page-head">
      <div><h1>${greeting()}</h1><p class="lede">${
        attention.length
          ? `${attention.length} trial${attention.length > 1 ? 's need' : ' needs'} your attention.`
          : upcoming.length
            ? "Nothing urgent. We'll nudge you before anything charges."
            : 'Add your first trial — it takes five seconds.'
      }</p></div>
      <div class="actions"><button data-act="mail-connect" data-provider="gmail" ${state.mail.busy ? 'disabled' : ''}>📧 ${state.mail.busy ? 'Scanning…' : 'Scan Gmail'}</button><button class="primary" data-act="add-open">+ Add trial</button></div>
    </div>
    ${mailHtml()}
    ${!empty && !state.settings.mailConnected?.gmail && !state.mail.candidates.length ? `<div class="banner scan-cta"><div><b>Find trials you forgot about.</b> Scan your Gmail for trial confirmation emails — read-only, read on this device, never uploaded.</div><button class="primary" data-act="mail-connect" data-provider="gmail" ${state.mail.busy ? 'disabled' : ''}>${state.mail.busy ? 'Scanning…' : 'Scan my Gmail'}</button></div>` : ''}
    ${state.settings.mailConnected?.gmail && !state.mail.candidates.length ? scanStatusHtml() : ''}
    ${empty ? emptyStateHtml() : summaryHtml()}
    ${attention.length ? `<section class="section"><div class="section-head"><h2>Needs attention</h2><span class="n">${attention.length}</span></div><div class="cards">${attention.map(cardHtml).join('')}</div></section>` : ''}
    ${upcoming.length ? `<section class="section"><div class="section-head"><h2>Coming up</h2><span class="n">${upcoming.length}</span><a class="see-all" href="#/trials">See all trials →</a></div><div class="cards">${upcoming.slice(0, 5).map(cardHtml).join('')}</div></section>` : ''}
    ${!empty && !attention.length && !upcoming.length ? '<div class="empty">All clear — no open trials. <a href="#/savings">See what you saved →</a></div>' : ''}`;
}

/** "What did the scan check?" — every email the last scan looked at, and why. */
export function scanReportHtml() {
  const rep = state.mail.report;
  const entries = rep?.entries ?? [];
  const VERD = {
    found: ['Found — ready to track', 'ok'],
    'from-you': ['Sent by you', ''],
    ad: ['Looks like an ad', 'warn'],
    'no-signal': ['No sign you started a trial', ''],
    'no-details': ["Couldn't read a service or date", ''],
    ended: ['Trial already ended', ''],
    'too-far': ['Renewal too far away for a trial', ''],
    'person-name': 'Sender is a person, not a service',
    tracked: ['Already tracking it', 'ok'],
    duplicate: ['Same service as another email', ''],
  };
  const rows = entries
    .map((e, i) => {
      const [label, cls] = Array.isArray(VERD[e.verdict]) ? VERD[e.verdict] : [VERD[e.verdict] ?? e.verdict, ''];
      const canTrack = e.verdict !== 'found' && e.verdict !== 'tracked';
      return `<li class="row-item report">${logoHtml(e.serviceId ?? '', e.serviceName || '?', 'sm')}
        <span class="grow"><b>${esc(e.subject || '(no subject)')}</b><span class="hint">${esc(e.from)}${e.account ? ` · ${esc(e.account)}` : ''}</span>
          <span><span class="pill ${cls}">${esc(label)}</span>${e.renewsOn ? ` <span class="hint">ends ${esc(e.renewsOn)}</span>` : ''}</span></span>
        ${canTrack ? `<button class="sm" data-act="report-track" data-i="${i}">Track anyway</button>` : ''}</li>`;
    })
    .join('');
  return `<div class="page-head"><div><h1>What the scan checked</h1><p class="lede">${
    rep ? `Last scan ${esc(ago(rep.at))}: ${entries.length} trial-related email${entries.length === 1 ? '' : 's'}. Read on this device only.` : 'No scan yet.'
  }</p></div>
    <div class="actions"><button data-act="report-recheck">Re-check dismissed emails</button><button class="primary" data-act="mail-rescan">Scan again</button></div></div>
    ${entries.length ? `<ul class="rows">${rows}</ul>` : `<div class="empty">${rep ? "Gmail didn't return any trial-related emails from the last 60 days. If you just started a trial, wait a minute for the email to arrive and scan again — or paste the email via <b>+ Add trial → Paste email</b>." : 'Press <b>Scan again</b> to check your inbox.'}</div>`}
    <p class="hint" style="margin-top:14px">Missed a trial? Press <b>Track anyway</b> next to its email — and tell us the subject line so we can teach the scanner.</p>`;
}

/** Connected inboxes with per-inbox scan / remove, plus "Add another Gmail". */
export function inboxesHtml({ compact = false } = {}) {
  const accounts = state.settings.mailAccounts ?? [];
  const errs = state.settings.mailErrors ?? {};
  const busy = state.mail.busy;
  const rows = accounts
    .map((a) => {
      const err = errs[a.email];
      const label = a.provider === 'gmail' ? 'Gmail' : 'Outlook';
      const status = err
        ? `<span class="error" style="font-size:12px">${esc(err === 'expired' || err === 'account-changed' ? 'Needs you to sign in again' : 'Last scan failed')}</span>`
        : `<span class="hint">${a.lastScan ? `Checked ${esc(ago(a.lastScan))}` : 'Connected'}</span>`;
      return `<div class="switch-row inbox"><span><b>${esc(a.email)}</b><span class="hint">${label}</span>${status}</span>
        <span class="actions"><button class="sm" data-act="mail-rescan" data-provider="${a.provider}" data-account="${esc(a.email)}" ${busy ? 'disabled' : ''}>${err ? 'Reconnect' : 'Scan'}</button>
        <button class="sm ghost" data-act="mail-disconnect" data-provider="${a.provider}" data-account="${esc(a.email)}">Remove</button></span></div>`;
    })
    .join('');
  const add = accounts.some((a) => a.provider === 'gmail')
    ? `<button class="${compact ? 'sm' : ''}" data-act="mail-add-account" data-provider="gmail" ${busy ? 'disabled' : ''}>+ Add another Gmail</button>`
    : `<button class="primary ${compact ? 'sm' : ''}" data-act="mail-connect" data-provider="gmail" ${busy ? 'disabled' : ''}>${busy ? 'Scanning…' : 'Connect Gmail'}</button>`;
  const report = state.mail.report ? `<a class="btn sm ghost" href="#/scan-report">What did the last scan check?</a>` : '';
  return `<div class="settings-list inboxes">${rows}</div><div class="actions" style="margin-top:10px">${add}${report}</div>
    ${state.mail.error ? `<p class="error">${esc(state.mail.error)}</p>` : ''}`;
}

function ago(iso) {
  const ms = Date.now() - (Date.parse(iso ?? '') || 0);
  const h = Math.floor(ms / 3_600_000);
  if (!iso || h > 24 * 30) return 'a while ago';
  if (h < 1) return 'just now';
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}

/** Gmail status line; becomes a prominent banner once the last scan is 6h+ old. */
function scanStatusHtml() {
  const last = state.settings.mailLastScan;
  const stale = Date.now() - (Date.parse(last ?? '') || 0) > 6 * 3_600_000;
  const n = (state.settings.mailAccounts ?? []).length;
  const what = n > 1 ? `${n} inboxes` : 'Gmail';
  if (!stale) return `<p class="hint scan-line">✓ ${what} checked ${esc(ago(last))} · next check in about 6 hours · <button class="link" data-act="mail-rescan">Scan now</button> · <a href="#/scan-report">What did it check?</a> · <a href="#/settings/sources">Manage inboxes</a></p>`;
  return `<div class="banner scan-cta"><div><b>Check for new trials.</b> Your ${n > 1 ? 'inboxes were' : 'Gmail was'} last checked ${esc(ago(last))}.</div>
    <button class="primary" data-act="mail-rescan" ${state.mail.busy ? 'disabled' : ''}>${state.mail.busy ? 'Scanning…' : 'Scan now'}</button></div>`;
}

function emptyStateHtml() {
  return `<div class="empty-hero">
    <div class="empty-icon">⏳</div>
    <h2>No trials yet</h2>
    <p class="lede">Three ways to start:</p>
    <div class="empty-ways">
      <button class="way" data-act="add-open" data-tab="pick"><b>Pick a service</b><span>Netflix, Spotify, ChatGPT… and when it ends</span></button>
      <button class="way" data-act="add-open" data-tab="paste"><b>Paste an email</b><span>We read the date and price for you</span></button>
      <button class="way" data-act="mail-connect" data-provider="gmail"><b>Scan my Gmail</b><span>Find trials you already started — read-only, on this device</span></button>
    </div></div>`;
}

/* ----------------------------------------------------------------- trials */

export function trialsHtml() {
  const f = state.filter;
  const all = sortedForDisplay(state.trials);
  const counts = {
    open: all.filter((t) => bucket(t) !== 'resolved').length,
    soon: all.filter((t) => bucket(t) === 'attention').length,
    resolved: all.filter((t) => bucket(t) === 'resolved').length,
    all: all.length,
  };
  const q = f.q.trim().toLowerCase();
  const list = all.filter((t) => {
    const b = bucket(t);
    if (f.status === 'open' && b === 'resolved') return false;
    if (f.status === 'soon' && b !== 'attention') return false;
    if (f.status === 'resolved' && b !== 'resolved') return false;
    return !q || t.serviceName.toLowerCase().includes(q) || (t.cardLabel ?? '').toLowerCase().includes(q);
  });
  const tab = (k, label) => `<button role="tab" data-act="filter" data-status="${k}" aria-selected="${f.status === k}">${label} <span class="n">${counts[k]}</span></button>`;
  return `<div class="page-head"><div><h1>Trials</h1><p class="lede">Everything you're tracking, most urgent first.</p></div>
      <div class="actions"><button data-act="mail-connect" data-provider="gmail" ${state.mail.busy ? 'disabled' : ''}>📧 ${state.mail.busy ? 'Scanning…' : 'Scan Gmail'}</button><button data-act="ics-all">📅 Export calendar</button><button class="primary" data-act="add-open">+ Add trial</button></div></div>
    ${state.mail.error ? `<p class="error">${esc(state.mail.error)}</p>` : ''}
    ${state.mail.candidates.length ? `<p class="banner">Found ${state.mail.candidates.length} possible trial${state.mail.candidates.length > 1 ? 's' : ''} in your email — <a href="#/">review on the dashboard</a>.</p>` : state.mail.report ? `<p class="hint">Last email scan: ${state.mail.report.entries.length} trial-related emails checked · <a href="#/scan-report">See what it checked</a></p>` : ''}
    <div class="toolbar">
      <div class="tabs" role="tablist">${tab('open', 'Open')}${tab('soon', 'Ending soon')}${tab('resolved', 'Resolved')}${tab('all', 'All')}</div>
      <input type="search" id="trial-search" placeholder="Search trials" value="${esc(f.q)}" aria-label="Search trials" />
    </div>
    ${list.length ? `<div class="cards">${list.map(cardHtml).join('')}</div>` : `<div class="empty">${q ? `No trials match "${esc(f.q)}".` : f.status === 'resolved' ? 'Nothing resolved yet.' : 'No open trials. <button class="link" data-act="add-open">Add one</button>'}</div>`}`;
}

/* ------------------------------------------------------------------- mail */

export function mailHtml() {
  const m = state.mail;
  if (!m.candidates.length) return m.error ? `<p class="error">${esc(m.error)}</p>` : '';
  return `<div class="panel found" id="mail-panel">
    <div class="section-head"><h2>Found in your email</h2><span class="n">${m.candidates.length}</span></div>
    <p class="hint">Check the date, then track. We'll nudge you before each one charges.</p>
    <div class="cards">${m.candidates
      .map((c) => {
        const mid = esc(c.messageId);
        return `<div class="card flat">
          <div class="card-head">${logoHtml(c.serviceId ?? '', c.serviceName)}
            <div class="card-title"><span class="card-name">${esc(c.serviceName)}</span><span class="meta">${esc(c.subject)} · ${esc(c.account ?? PROVIDER_LABEL[c.provider] ?? '')}</span></div></div>
          <div class="chips"><label class="inline">Ends on <input type="date" data-mail-date="${mid}" value="${esc(c.renewsOn ?? '')}"></label>
            ${c.renewalMatched ? `<span class="hint">read "${esc(c.renewalMatched)}"</span>` : c.renewsOn ? '<span class="hint">guessed from trial length</span>' : '<span class="pill warn">set the date</span>'}
            ${c.amount ? `<span class="pill">${c.currency === 'USD' ? '$' : '₹'}${esc(c.amount)}</span>` : ''}</div>
          <div class="actions"><button class="primary sm" data-act="mail-track" data-id="${mid}">Track it</button><button class="ghost sm" data-act="mail-dismiss" data-id="${mid}">Not a trial</button></div>
        </div>`;
      })
      .join('')}</div></div>`;
}

/* ------------------------------------------------------------ add / edit */

function chips(key, value) {
  return `<div class="chips">${WHEN.map((d) => `<button type="button" class="chip" data-act="when" data-key="${esc(key)}" data-days="${d}" aria-pressed="${value === d}">in ${d} days</button>`).join('')}
    <input type="date" data-when-date="${esc(key)}" value="${typeof value === 'string' ? esc(value) : ''}" min="${new Date().toISOString().slice(0, 10)}" aria-label="Pick the end date" /></div>`;
}

function manualForm() {
  const editing = state.trials.find((t) => t.id === state.editingId) ?? null;
  const seedRegion = state.seed?.region ?? (state.seed?.currency === 'USD' ? 'US' : state.seed?.currency === 'INR' ? 'IN' : null);
  const region = editing?.region ?? seedRegion ?? state.settings.region;
  const v = editing
    ? { name: editing.serviceName, ...zonedParts(editing.renewsAt, editing.timezone), tz: editing.timezone, amount: editing.amount ? editing.amount / 100 : '', len: editing.trialLengthDays, card: editing.cardLabel ?? '' }
    : {
        name: state.seed?.serviceName ?? '',
        ...(state.seed?.renewsAt ? zonedParts(state.seed.renewsAt, deviceZone) : { date: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10), time: '00:00' }),
        tz: state.settings.timezone || deviceZone,
        amount: state.seed?.amount ?? '',
        len: Number(state.seed?.trialLengthDays) || 7,
        card: '',
      };
  const lengths = [...new Set([7, 14, 30, 60, Number(v.len) || 7])].sort((a, b) => a - b);
  const zones = [...new Set([v.tz, deviceZone, 'Asia/Kolkata', 'UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London'])];
  return `<form class="form-grid" id="add-form" data-form="trial">
      ${state.seed?.note ? `<p class="banner span2">${esc(state.seed.note)}</p>` : ''}
      <label class="span2">Service
        <input id="f-name" list="services" placeholder="e.g. Netflix" value="${esc(v.name)}" required autocomplete="off" />
        <datalist id="services">${services().map((e) => `<option value="${esc(e.name)}"></option>`).join('')}</datalist></label>
      <label>Trial ends / renews on<input id="f-date" type="date" value="${esc(v.date)}" required /></label>
      <label>At<input id="f-time" type="time" value="${esc(v.time)}" required /></label>
      <label>Then charges (optional)<input id="f-amount" type="number" min="0" step="0.01" placeholder="499" value="${esc(v.amount)}" /></label>
      <label>Currency<select id="f-region"><option value="IN" ${region === 'IN' ? 'selected' : ''}>₹ INR</option><option value="US" ${region === 'US' ? 'selected' : ''}>$ USD</option></select></label>
      <details class="span2 more"><summary>More options</summary><div class="form-grid">
        <label>Billing timezone<select id="f-tz">${zones.map((z) => `<option ${z === v.tz ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label>
        <label>Trial length<select id="f-len">${lengths.map((n) => `<option value="${n}" ${n === Number(v.len) ? 'selected' : ''}>${n} days</option>`).join('')}</select></label>
        <label class="span2">Paid with<input id="f-card" placeholder="e.g. HDFC card / UPI AutoPay" value="${esc(v.card)}" /></label>
      </div></details>
      <p class="error span2" id="f-error" hidden></p>
      <div class="span2 modal-actions"><button type="button" class="ghost" data-act="add-close">Cancel</button><button type="submit" class="primary">${editing ? 'Save changes' : 'Track this trial'}</button></div>
    </form>`;
}

export function addModalHtml() {
  if (!state.addOpen && !state.editingId) return '';
  const editing = state.trials.find((t) => t.id === state.editingId) ?? null;
  const tab = editing || state.seed ? 'manual' : state.addTab;
  let body;
  if (tab === 'pick') {
    const q = state.quick;
    body = `<div class="svc-grid compact">${services()
      .map((e) => `<button type="button" class="svc" data-act="quick-pick" data-id="${esc(e.serviceId)}" aria-pressed="${q.serviceId === e.serviceId}">${logoHtml(e.serviceId, e.name, 'sm')}<span>${esc(e.name)}</span></button>`)
      .join('')}</div>
      ${q.serviceId
        ? `<div class="quick-when"><label>When does the ${esc(serviceById(q.serviceId)?.name ?? '')} trial end?</label>${chips('quick', q.when)}
          <label class="narrow">Then charges (optional)<input id="q-amount" type="number" min="0" step="0.01" placeholder="499" /></label></div>
          <div class="modal-actions"><button class="ghost" data-act="add-close">Cancel</button><button class="primary" data-act="quick-save">Track ${esc(serviceById(q.serviceId)?.name ?? '')}</button></div>`
        : '<p class="hint">Not listed? Use <b>Paste email</b> or <b>Enter manually</b>.</p>'}`;
  } else if (tab === 'paste') {
    body = `<p class="hint">Started a trial on your phone or in an app? Paste the confirmation email or receipt — we'll fill in the details.</p>
      <textarea id="paste-text" rows="7" placeholder="e.g. Your free trial of YouTube Premium has started. Starting December 21, 2026 you'll be charged ₹149.00/month."></textarea>
      <p class="hint" id="paste-hint">Read on your device. Nothing is uploaded.</p>
      <div class="modal-actions"><button class="ghost" data-act="add-close">Cancel</button><button class="primary" data-act="parse-email">Read it</button></div>`;
  } else body = manualForm();
  const t = (k, l) => `<button type="button" role="tab" data-act="add-tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`;
  return `<div class="modal-backdrop" data-act="add-close-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-head"><h2 id="modal-title">${editing ? `Edit ${esc(editing.serviceName)}` : 'Add a trial'}</h2><button class="ghost icon" data-act="add-close" aria-label="Close">✕</button></div>
    ${editing || state.seed ? '' : `<div class="tabs" role="tablist">${t('pick', 'Pick a service')}${t('paste', 'Paste email')}${t('manual', 'Enter manually')}</div>`}
    ${body}</div></div>`;
}

/* ---------------------------------------------------------------- actions */

function readForm() {
  const val = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id)).value;
  const name = val('f-name').trim();
  const region = val('f-region');
  const entry = state.directory.find((x) => x.region === region && x.name.toLowerCase() === name.toLowerCase()) ?? state.directory.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return {
    serviceId: entry?.serviceId ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    region,
    serviceName: entry?.name ?? name,
    renewsAt: zonedWallTimeToInstant(val('f-date'), val('f-time'), val('f-tz')).toISOString(),
    timezone: val('f-tz'),
    amount: Math.round((Number(val('f-amount')) || 0) * 100),
    currency: region === 'IN' ? 'INR' : 'USD',
    trialLengthDays: Number(val('f-len')),
    cardLabel: val('f-card').trim() || undefined,
  };
}

function closeAdd() {
  state.addOpen = false;
  state.editingId = null;
  state.seed = null;
  state.quick = { serviceId: null, when: 7 };
}

/** @param {(p:string|null)=>void} go @param {()=>Promise<void>} persist @param {(m:string)=>void} toast */
export function homeActions(go, persist, toast) {
  const gateOk = () => {
    if (canAddTrial(state.trials).allowed || state.settings.unlocked) return true;
    go('#/settings/plan');
    toast('Free plan limit reached — unlock unlimited trials.');
    return false;
  };
  const update = async (id, next, msg) => {
    state.trials = transition(state.trials, id, next);
    await persist();
    go(null);
    if (msg) toast(msg);
  };
  return {
    'add-open': (el) => {
      state.addOpen = true;
      state.editingId = null;
      if (el.dataset.tab) state.addTab = /** @type {any} */ (el.dataset.tab);
      go(null);
    },
    'add-close': () => {
      closeAdd();
      go(null);
    },
    'add-close-backdrop': (el, e) => {
      if (e.target === el) {
        closeAdd();
        go(null);
      }
    },
    'add-tab': (el) => {
      state.addTab = /** @type {any} */ (el.dataset.tab);
      go(null);
    },
    'quick-pick': (el) => {
      state.quick.serviceId = state.quick.serviceId === el.dataset.id ? null : el.dataset.id;
      go(null);
    },
    when: (el) => {
      state.quick.when = Number(el.dataset.days);
      go(null);
    },
    'change:when-date': (el) => {
      const v = /** @type {HTMLInputElement} */ (el).value;
      if (v) state.quick.when = v;
      go(null);
    },
    'quick-save': async () => {
      if (!state.quick.serviceId || !gateOk()) return;
      const amount = Number(/** @type {HTMLInputElement} */ (document.getElementById('q-amount'))?.value) || 0;
      const t = quickTrial(state.quick.serviceId, state.quick.when, amount);
      state.trials = [...state.trials, t];
      closeAdd();
      await persist();
      go(null);
      toast(`Tracking ${t.serviceName}. We'll nudge you before it charges.`);
    },
    'report-track': (el) => {
      const e = state.mail.report?.entries?.[Number(el.dataset.i)];
      if (!e) return;
      state.seed = {
        serviceId: e.serviceId,
        region: e.region,
        serviceName: e.serviceName ?? '',
        amount: e.amount,
        currency: e.currency,
        trialLengthDays: e.trialLengthDays,
        renewsAt: e.renewsOn ? zonedWallTimeToInstant(e.renewsOn, '00:00', deviceZone).toISOString() : null,
        source: e.account ? `gmail:${e.account}` : 'gmail',
        note: `From your email “${e.subject}”. Check the service, date and price, then save.`,
      };
      state.addOpen = true;
      go(null);
    },
    'report-recheck': async () => {
      await chrome.storage.local.set({ mailSeen: [] });
      toast('Dismissed emails will be checked again on the next scan.');
    },
    'parse-email': () => {
      const r = parseTrialEmail(/** @type {HTMLTextAreaElement} */ (document.getElementById('paste-text')).value, state.directory);
      if (!r.found) {
        document.getElementById('paste-hint').textContent = "Couldn't find a service, price or date in that text — try Enter manually.";
        return;
      }
      const bits = [r.serviceName, r.renewalMatched ? `renews "${r.renewalMatched}"` : r.days ? `${r.days.days}-day trial` : null, r.price && `${r.price.currency === 'USD' ? '$' : '₹'}${r.price.amount}`].filter(Boolean);
      state.seed = {
        serviceId: r.entry?.serviceId ?? null,
        region: r.entry?.region ?? null,
        serviceName: r.serviceName ?? '',
        amount: r.price?.amount ?? null,
        currency: r.price?.currency ?? null,
        trialLengthDays: r.days?.days ?? null,
        renewsAt: r.renewsOn ? zonedWallTimeToInstant(r.renewsOn, '00:00', deviceZone).toISOString() : null,
        source: 'email',
        note: `Read from your email: ${bits.join(' · ')}. Check it, then save.`,
      };
      go(null);
    },
    'form:trial': async () => {
      const fields = readForm();
      const errors = validateTrial(fields);
      const errEl = document.getElementById('f-error');
      if (errors.length) {
        errEl.hidden = false;
        errEl.textContent = errors.join(' · ');
        return;
      }
      const editing = state.editingId;
      if (editing) {
        state.trials = state.trials.map((t) => (t.id === editing ? { ...t, ...fields, updatedAt: stampNow() } : t));
      } else {
        if (!gateOk()) return;
        state.trials = [...state.trials, newTrial({ ...fields, source: state.seed?.source ?? 'manual' })];
      }
      closeAdd();
      await persist();
      go(null);
      toast(editing ? 'Saved.' : `Tracking ${fields.serviceName}.`);
    },
    't-edit': (el) => {
      state.editingId = el.dataset.id;
      go(null);
    },
    't-open': async (el) => {
      const t = state.trials.find((x) => x.id === el.dataset.id);
      const entry = t && entryFor(t);
      state.trials = transition(state.trials, el.dataset.id, 'awaiting_confirmation').map((x) => (x.id === el.dataset.id ? { ...x, cancelUrlUsed: entry?.cancelUrl ?? null } : x));
      await persist();
      go(null);
    },
    't-confirm': (el) => update(el.dataset.id, 'confirmed_cancelled', 'Marked as cancelled. Nice save!'),
    't-keep': (el) => update(el.dataset.id, 'kept', "Got it — you're keeping it. No more nudges."),
    't-charged': (el) => update(el.dataset.id, 'charged', 'Marked as charged. Cancel now to stop the next cycle.'),
    't-undo': (el) => update(el.dataset.id, 'active', 'Moved back to open trials.'),
    't-delete': async (el) => {
      const t = state.trials.find((x) => x.id === el.dataset.id);
      if (!t || !confirm(`Remove ${t.serviceName}? This can't be undone.`)) return;
      removeTrial(t.id);
      await persist();
      go(null);
      toast(`Removed ${t.serviceName}.`);
    },
    't-ics': (el) => {
      const t = state.trials.find((x) => x.id === el.dataset.id);
      if (t) downloadIcs(`trialexit-${t.serviceId}.ics`, combinedIcs([t]));
    },
    'ics-all': () => {
      const live = state.trials.filter((t) => bucket(t) !== 'resolved');
      if (!live.length) return toast('No open trials to export.');
      downloadIcs('trialexit-trials.ics', combinedIcs(live));
    },
    filter: (el) => {
      state.filter.status = el.dataset.status;
      go(null);
    },
    'input:trial-search': (el) => {
      state.filter.q = /** @type {HTMLInputElement} */ (el).value;
      go(null, { keepFocus: 'trial-search' });
    },
  };
}
