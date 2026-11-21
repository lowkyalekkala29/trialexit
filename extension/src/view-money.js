/**
 * Money views: Subscriptions, Cancelled (money protected), Offers, and the
 * email suggestions for subscriptions / cancellations / offers.
 */
import { state, esc, money, entryFor } from './state.js';
import { logoHtml } from './brand.js';
import { formatMoney, formatRenewalLocal, DAY } from './core/dates.js';
import { derivedStatus } from './core/store.js';
import { isSubscription, isCancelled, nextCharge, monthlyCost, monthlySpend, moneyProtected, protectedBy, upcomingCharges, cycleLabel } from './core/money.js';
import { candidateType } from './mail-candidates.js';

const PROVIDER_LABEL = { gmail: 'Gmail', outlook: 'Outlook' };
const amt = (minor, cur) => (minor ? formatMoney(minor, cur) : '—');
const fmtDate = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export const subscriptions = () => state.trials.filter((t) => isSubscription(t) && !isCancelled(t));
export const cancelledItems = () => state.trials.filter((t) => isCancelled(t));
export const offerCandidates = () => state.mail.candidates.filter((c) => candidateType(c) === 'offer' && !(c.endsOn && Date.parse(c.endsOn) < Date.now() - DAY));

/** Per-currency yearly totals of live subscriptions. */
function yearly(items) {
  const m = monthlySpend(items);
  return { INR: m.INR * 12, USD: m.USD * 12 };
}

/** The headline: how much TrialExit has kept in your pocket. */
export function protectedHeroHtml() {
  const saved = money(moneyProtected(state.trials)) || '₹0';
  const subs = subscriptions();
  const week = upcomingCharges(state.trials, new Date(), 7);
  const weekTotal = { INR: 0, USD: 0 };
  for (const { item } of week) weekTotal[item.currency] += Number(item.amount) || 0;
  const stat = (n, label, cls = '', href = '') =>
    `<${href ? `a href="${href}"` : 'div'} class="stat ${cls}"><b>${n}</b><span>${label}</span></${href ? 'a' : 'div'}>`;
  return `<div class="summary">
    ${stat(esc(saved), 'money protected so far', 'ok big', '#/cancelled')}
    ${stat(esc(money(monthlySpend(subs)) || '—'), `per month on ${subs.length} subscription${subs.length === 1 ? '' : 's'}`, '', '#/subscriptions')}
    ${stat(esc(money(weekTotal) || '—'), `${week.length} charge${week.length === 1 ? '' : 's'} in the next 7 days`, week.length ? 'crit' : '')}
    ${stat(offerCandidates().length, 'offers & discounts found', '', '#/offers')}
  </div>`;
}

/* ----------------------------------------------------------- subscriptions */

export function subCardHtml(t) {
  const id = esc(t.id);
  const entry = entryFor(t);
  const next = nextCharge(t);
  const days = Math.ceil((next.getTime() - Date.now()) / DAY);
  const band = days <= 3 ? 'critical' : days <= 7 ? 'soon' : 'safe';
  const cancelled = isCancelled(t);
  const actions = cancelled
    ? `<button class="ghost sm" data-act="t-undo" data-id="${id}">Undo</button><button class="ghost sm" data-act="t-delete" data-id="${id}">Remove</button>`
    : `${entry ? `<a class="btn primary sm" href="${esc(entry.cancelUrl)}" target="_blank" rel="noopener">Cancel at ${esc(entry.name)} ↗</a>` : ''}
      <button class="sm" data-act="t-confirm" data-id="${id}">I cancelled it</button>
      <span class="spacer"></span>
      <button class="ghost sm icon" data-act="t-edit" data-id="${id}" title="Edit" aria-label="Edit">✎</button>
      <button class="ghost sm icon" data-act="t-delete" data-id="${id}" title="Remove" aria-label="Remove">🗑</button>`;
  return `<article class="card" data-band="${cancelled ? 'done' : band}" data-id="${id}">
    <div class="card-head">${logoHtml(t.serviceId, t.serviceName)}
      <div class="card-title"><span class="card-name">${esc(t.serviceName)}</span>
        <span class="meta"><span class="amount">${amt(t.amount, t.currency)}</span> / ${cycleLabel(t.cycle)}${
          cancelled ? ' · cancelled' : ` · next charge ${esc(fmtDate(next))}`}${t.amount && !cancelled ? ` · ${esc(formatMoney(Math.round(monthlyCost(t) * 12), t.currency))} a year` : ''}</span></div>
      ${cancelled ? '<span class="count ok">✓<small>cancelled</small></span>' : `<span class="count ${band === 'critical' ? 'crit' : band === 'soon' ? 'soon' : ''}">${days}d<small>to renewal</small></span>`}
    </div>
    ${!t.amount && !cancelled ? '<div class="pills"><span class="pill warn">add the price to see your spend</span></div>' : ''}
    <div class="actions">${actions}</div>
    ${entry?.steps?.length && !cancelled ? `<details class="steps"><summary>How to cancel at ${esc(entry.name)}</summary><ol>${entry.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>` : ''}
  </article>`;
}

export function subscriptionsHtml() {
  const subs = subscriptions().sort((a, b) => nextCharge(a).getTime() - nextCharge(b).getTime());
  const found = state.mail.candidates.filter((c) => candidateType(c) === 'subscription');
  return `<div class="page-head"><div><h1>Subscriptions</h1><p class="lede">Everything that charges you again and again. We remind you 3 days and 1 day before each renewal, so you only pay for what you still use.</p></div>
      <div class="actions"><button data-act="mail-connect" data-provider="gmail" ${state.mail.busy ? 'disabled' : ''}>📧 ${state.mail.busy ? 'Scanning…' : 'Scan Gmail'}</button><button class="primary" data-act="add-open" data-kind="subscription">+ Add subscription</button></div></div>
    <div class="summary three">
      <div class="stat big"><b>${esc(money(monthlySpend(subs)) || '—')}</b><span>per month</span></div>
      <div class="stat"><b>${esc(money(yearly(subs)) || '—')}</b><span>per year</span></div>
      <div class="stat"><b>${subs.length}</b><span>active subscription${subs.length === 1 ? '' : 's'}</span></div>
    </div>
    ${found.length ? suggestionsHtml(found, 'Found in your email') : ''}
    ${subs.length ? `<div class="cards">${subs.map(subCardHtml).join('')}</div>` : `<div class="empty">No subscriptions yet. Add the ones you pay for (Netflix, Spotify, iCloud, gym…), or scan Gmail to find receipts. <button class="link" data-act="add-open" data-kind="subscription">Add one</button></div>`}`;
}

/* --------------------------------------------------------------- cancelled */

export function cancelledHtml() {
  const items = cancelledItems().sort((a, b) => Date.parse(b.cancelledAt ?? 0) - Date.parse(a.cancelledAt ?? 0));
  const charged = state.trials.filter((t) => !isSubscription(t) && (t.status === 'charged' || (derivedStatus(t) === 'charged' && t.status !== 'charged')));
  const found = state.mail.candidates.filter((c) => candidateType(c) === 'cancellation');
  const row = (t) => {
    const p = protectedBy(t);
    const what = isSubscription(t) ? `${amt(t.amount, t.currency)} / ${cycleLabel(t.cycle)} subscription` : 'free trial';
    return `<li class="row-item">${logoHtml(t.serviceId, t.serviceName, 'sm')}<span class="grow"><b>${esc(t.serviceName)}</b><span class="hint">${esc(what)} · cancelled ${t.cancelledAt ? esc(fmtDate(new Date(t.cancelledAt))) : ''}</span></span>
      <span class="amount ${p ? 'ok' : ''}">${p ? `+${formatMoney(p, t.currency)}` : isSubscription(t) ? 'saving from next renewal' : '—'}</span>
      <button class="ghost sm" data-act="t-undo" data-id="${esc(t.id)}" title="Not cancelled after all">Undo</button></li>`;
  };
  return `<div class="page-head"><div><h1>Cancelled</h1><p class="lede">Money you didn't lose. Only real avoided charges count: a trial cancelled before it charged, and each renewal a cancelled subscription would have taken.</p></div></div>
    <div class="summary three">
      <div class="stat ok big"><b>${esc(money(moneyProtected(state.trials)) || '₹0')}</b><span>money protected so far</span></div>
      <div class="stat"><b>${items.filter((t) => !isSubscription(t)).length}</b><span>trials cancelled</span></div>
      <div class="stat"><b>${items.filter(isSubscription).length}</b><span>subscriptions cancelled</span></div>
    </div>
    ${found.length ? suggestionsHtml(found, 'Cancellations found in your email') : ''}
    <section class="section"><div class="section-head"><h2>Cancelled</h2><span class="n">${items.length}</span></div>
      ${items.length ? `<ul class="rows">${items.map(row).join('')}</ul>` : '<div class="empty">Cancel a trial before it charges, or a subscription you no longer use, and it shows up here with the money it saved you.</div>'}</section>
    ${charged.length ? `<section class="section"><div class="section-head"><h2>Charged — ask for a refund</h2><span class="n">${charged.length}</span></div><p class="hint">Many services refund a charge you didn't use if you ask within a few days. Cancel first, then contact support.</p><ul class="rows">${charged.map((t) => `<li class="row-item">${logoHtml(t.serviceId, t.serviceName, 'sm')}<span class="grow"><b>${esc(t.serviceName)}</b><span class="hint">${esc(formatRenewalLocal(t.renewsAt, t.timezone))}</span></span><span class="amount crit">${amt(t.amount, t.currency)}</span></li>`).join('')}</ul></section>` : ''}`;
}

/* ------------------------------------------------------------------ offers */

export function offersHtml() {
  const offers = offerCandidates().sort((a, b) => (a.endsOn ?? '9999').localeCompare(b.endsOn ?? '9999'));
  return `<div class="page-head"><div><h1>Offers &amp; discounts</h1><p class="lede">Deals from services in your inbox, so you pay less for what you already use, and never pay full price by accident. Read on this device from your connected Gmail.</p></div>
      <div class="actions"><button data-act="mail-connect" data-provider="gmail" ${state.mail.busy ? 'disabled' : ''}>📧 ${state.mail.busy ? 'Scanning…' : 'Scan Gmail'}</button></div></div>
    ${offers.length
      ? `<div class="cards">${offers.map((c) => {
          const mid = esc(c.messageId);
          const ends = c.endsOn ? Math.ceil((Date.parse(c.endsOn) - Date.now()) / DAY) : null;
          const gmailLink = c.provider === 'gmail' ? `https://mail.google.com/mail/${c.account ? `?authuser=${encodeURIComponent(c.account)}` : ''}#all/${encodeURIComponent(String(c.messageId).split(':')[1] ?? '')}` : null;
          return `<div class="card flat"><div class="card-head">${logoHtml(c.serviceId ?? '', c.serviceName)}
            <div class="card-title"><span class="card-name">${esc(c.serviceName)}</span><span class="meta">${esc(c.subject)}</span></div>
            ${c.discount ? `<span class="count ok">${esc(c.discount)}</span>` : ''}</div>
            <div class="pills">${ends != null ? `<span class="pill ${ends <= 3 ? 'warn' : ''}">${ends <= 0 ? 'ends today' : `ends in ${ends} day${ends === 1 ? '' : 's'}`}</span>` : ''}<span class="pill">${esc(c.account ?? PROVIDER_LABEL[c.provider] ?? '')}</span></div>
            <div class="actions">${gmailLink ? `<a class="btn sm primary" href="${esc(gmailLink)}" target="_blank" rel="noopener">View in Gmail ↗</a>` : ''}<button class="ghost sm" data-act="mail-dismiss" data-id="${mid}">Not interested</button></div></div>`;
        }).join('')}</div>`
      : `<div class="empty">${state.settings.mailConnected?.gmail ? 'No offers found in the last 60 days. We check again every 6 hours.' : 'Connect Gmail and we’ll pick out discounts and deals from services you use. <button class="link" data-act="mail-connect" data-provider="gmail">Scan my Gmail</button>'}</div>`}`;
}

/* ------------------------------------------- subscription / cancel suggestions */

export function suggestionsHtml(list, title) {
  return `<div class="panel found"><div class="section-head"><h2>${esc(title)}</h2><span class="n">${list.length}</span></div>
    <div class="cards">${list.map((c) => {
      const mid = esc(c.messageId);
      const head = `<div class="card-head">${logoHtml(c.serviceId ?? '', c.serviceName)}<div class="card-title"><span class="card-name">${esc(c.serviceName)}</span><span class="meta">${esc(c.subject)} · ${esc(c.account ?? PROVIDER_LABEL[c.provider] ?? '')}</span></div></div>`;
      if (candidateType(c) === 'cancellation') {
        const match = c.matchId && state.trials.find((t) => t.id === c.matchId);
        return `<div class="card flat">${head}<p class="hint">This email says you cancelled ${esc(c.serviceName)}.</p>
          <div class="actions"><button class="primary sm" data-act="mail-cancel" data-id="${mid}">${match ? `Mark ${esc(match.serviceName)} cancelled` : 'Add to Cancelled'}</button><button class="ghost sm" data-act="mail-dismiss" data-id="${mid}">Ignore</button></div></div>`;
      }
      return `<div class="card flat">${head}
        <div class="chips"><label class="inline">Next charge <input type="date" data-mail-date="${mid}" value="${esc(c.renewsOn ?? '')}"></label>
          <label class="inline">Price <input type="number" min="0" step="0.01" style="width:90px" data-mail-amount="${mid}" value="${esc(c.amount ?? '')}" placeholder="0"></label>
          <label class="inline">Every <select data-mail-cycle="${mid}">${['weekly', 'monthly', 'quarterly', 'yearly'].map((k) => `<option value="${k}" ${k === (c.cycle ?? 'monthly') ? 'selected' : ''}>${cycleLabel(k)}</option>`).join('')}</select></label></div>
        <div class="actions"><button class="primary sm" data-act="mail-track" data-id="${mid}">Add to subscriptions</button><button class="ghost sm" data-act="mail-dismiss" data-id="${mid}">Not a subscription</button></div></div>`;
    }).join('')}</div></div>`;
}
