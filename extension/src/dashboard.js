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
import { validateLicence } from './licence.js';

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

const DEV_UNLOCK = 'TRIALEXIT-DEV';

const state = {
  /** @type {import('./core/types.js').Trial[]} */
  trials: [],
  /** @type {import('./core/types.js').DirectoryEntry[]} */
  directory: [],
  settings: { region: 'IN', unlocked: false },
  /** @type {{ serviceId?: string, serviceName?: string, amount?: number|null } | null} */
  seed: null,
  /** @type {string | null} */
  editingId: null,
};

const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

function esc(v) {
  return String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

const deviceZone = ZONES.includes(Intl.DateTimeFormat().resolvedOptions().timeZone)
  ? Intl.DateTimeFormat().resolvedOptions().timeZone
  : 'Asia/Kolkata';

async function save() {
  await chrome.storage.local.set({ trials: state.trials, settings: state.settings });
  chrome.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => {});
}

async function boot() {
  const got = await chrome.storage.local.get(['trials', 'settings', 'pendingSeed', 'bundledDirectory']);
  state.trials = Array.isArray(got.trials) ? got.trials : [];
  state.settings = { region: 'IN', unlocked: false, ...(got.settings ?? {}) };
  state.seed = got.pendingSeed ?? null;
  if (got.pendingSeed) await chrome.storage.local.remove('pendingSeed');

  state.directory = got.bundledDirectory
    ? normalizeDirectory(got.bundledDirectory)
    : normalizeDirectory(await (await fetch('data/directory.json')).json());
  render();

  loadDirectory(state.directory).then((fresh) => {
    if (fresh.length && fresh.length !== state.directory.length) {
      state.directory = fresh;
      chrome.storage.local.set({ bundledDirectory: { entries: fresh } });
      render();
    }
  });
}

function entryFor(trial) {
  return (
    state.directory.find((e) => e.serviceId === trial.serviceId && e.region === trial.region) ??
    state.directory.find((e) => e.serviceId === trial.serviceId)
  );
}

function cardHtml(t) {
  const now = new Date();
  const status = derivedStatus(t, now);
  const band = status === 'confirmed_cancelled' ? 'done' : urgency(t.renewsAt, now);
  const entry = entryFor(t);
  const verified = entry?.verified !== false;
  const done = status === 'confirmed_cancelled';
  const charged = status === 'charged';

  const bandPill = done
    ? '<span class="pill ok">cancelled</span>'
    : charged
      ? '<span class="pill crit">charged</span>'
      : status === 'awaiting_confirmation'
        ? '<span class="pill warn">confirm cancellation</span>'
        : '';

  const refund =
    charged && entry?.refundWindowDays
      ? `<div class="hint">You may still be inside ${entry.name}'s ${entry.refundWindowDays}-day refund window — ask support for a refund and cite the unused period.</div>`
      : charged
        ? '<div class="hint">Charged. Cancel now to stop the next cycle, then ask support for a goodwill refund.</div>'
        : '';

  return `
    <article class="card" data-band="${band}" data-id="${esc(t.id)}">
      <div class="card-head">
        <span class="card-name">${esc(t.serviceName)}</span>
        <span class="pill">${esc(t.region)}</span>
        ${bandPill}
        ${verified ? '' : '<span class="pill warn" title="Not verified against the live site recently">link unverified</span>'}
        ${entry?.requiresChat ? '<span class="pill warn">chat required</span>' : ''}
        <span class="count ${band === 'critical' ? 'crit' : band === 'soon' ? 'soon' : ''}">
          ${charged ? 'past due' : done ? '—' : formatCountdown(msUntil(t.renewsAt, now))}
        </span>
      </div>
      <div class="meta">
        <span class="amount">${formatMoney(t.amount, t.currency)}</span> renews
        ${esc(formatRenewalLocal(t.renewsAt, t.timezone))}
        ${t.cardLabel ? ` · ${esc(t.cardLabel)}` : ''}
      </div>
      ${refund}
      <div class="actions">
        ${entry ? `<a class="btn primary" href="${esc(entry.cancelUrl)}" target="_blank" rel="noopener" data-act="open" data-id="${esc(t.id)}">Cancel at ${esc(entry.name)}</a>` : ''}
        <button class="btn" data-act="ics" data-id="${esc(t.id)}">Add to calendar</button>
        ${done
          ? `<button class="ghost" data-act="undo" data-id="${esc(t.id)}">Undo</button>`
          : `<button class="btn" data-act="confirm" data-id="${esc(t.id)}">I cancelled it</button>`}
        <button class="ghost" data-act="edit" data-id="${esc(t.id)}">Edit</button>
        <button class="ghost" data-act="delete" data-id="${esc(t.id)}">Remove</button>
      </div>
      ${entry?.steps?.length
        ? `<details class="steps"><summary>How to cancel at ${esc(entry.name)}</summary><ol>${entry.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>`
        : ''}
      ${entry?.note ? `<div class="hint">${esc(entry.note)}</div>` : ''}
    </article>`;
}

function formHtml() {
  const editing = state.trials.find((t) => t.id === state.editingId) ?? null;
  const region = editing?.region ?? state.settings.region;
  const values = editing
    ? {
        name: editing.serviceName,
        ...zonedParts(editing.renewsAt, editing.timezone),
        tz: editing.timezone,
        amount: editing.amount / 100,
        len: editing.trialLengthDays,
        card: editing.cardLabel ?? '',
      }
    : {
        name: state.seed?.serviceName ?? '',
        date: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10),
        time: '00:00',
        tz: deviceZone,
        amount: state.seed?.amount ?? '',
        len: 7,
        card: '',
      };

  const seen = new Set();
  const datalist = state.directory
    .filter((e) => (seen.has(e.name) ? false : seen.add(e.name)))
    .map((e) => `<option value="${esc(e.name)}"></option>`)
    .join('');
  const zones = ZONES.includes(deviceZone) ? ZONES : [deviceZone, ...ZONES];
  const lengths = [7, 14, 30, 60];

  return `
    <form class="add" id="add-form">
      <h2>${editing ? `Edit ${esc(editing.serviceName)}` : 'Log a trial'}</h2>
      <label>Service
        <input id="f-name" list="services" placeholder="Netflix" value="${esc(values.name)}" required />
        <datalist id="services">${datalist}</datalist>
      </label>
      <label>Region
        <select id="f-region">
          <option value="IN" ${region === 'IN' ? 'selected' : ''}>India (₹)</option>
          <option value="US" ${region === 'US' ? 'selected' : ''}>US ($)</option>
        </select>
      </label>
      <label>Renews on
        <input id="f-date" type="date" value="${esc(values.date)}" required />
      </label>
      <label>Renews at
        <input id="f-time" type="time" value="${esc(values.time)}" required />
      </label>
      <label>Billing timezone
        <select id="f-tz">${zones.map((z) => `<option value="${z}" ${z === values.tz ? 'selected' : ''}>${z}</option>`).join('')}</select>
      </label>
      <label>Renewal amount
        <input id="f-amount" type="number" min="0" step="1" placeholder="499" value="${esc(values.amount)}" required />
      </label>
      <label>Trial length
        <select id="f-len">${lengths.map((n) => `<option value="${n}" ${String(n) === String(values.len) ? 'selected' : ''}>${n} days</option>`).join('')}</select>
      </label>
      <label>Paid with (optional)
        <input id="f-card" placeholder="UPI AutoPay / HDFC card" value="${esc(values.card)}" />
      </label>
      <div class="row-span actions">
        <button type="submit" class="primary">${editing ? 'Save changes' : 'Track this trial'}</button>
        ${editing ? '<button type="button" class="ghost" data-act="cancel-edit">Cancel</button>' : ''}
        <span class="hint">Alert fires 48h before renewal (5 days for trials over two weeks), plus a ping at 24h.</span>
      </div>
      <p class="error row-span" id="f-error" hidden></p>
    </form>`;
}

function render() {
  const now = new Date();
  const saved = savedTotals(state.trials);
  const savedText = [saved.INR && formatMoney(saved.INR, 'INR'), saved.USD && formatMoney(saved.USD, 'USD')]
    .filter(Boolean)
    .join(' + ');
  $('#saved').innerHTML = savedText ? `Saved so far <b>${esc(savedText)}</b>` : 'Nothing charged yet.';

  const list = sortedForDisplay(state.trials, now);
  $('#app').innerHTML =
    formHtml() +
    (list.length
      ? `<div class="cards">${list.map(cardHtml).join('')}</div>`
      : `<div class="empty">No trials tracked.<br />Log one above — it takes about five seconds.</div>`);
}

function readForm() {
  const name = /** @type {HTMLInputElement} */ ($('#f-name')).value.trim();
  const region = /** @type {HTMLSelectElement} */ ($('#f-region')).value;
  const dateStr = /** @type {HTMLInputElement} */ ($('#f-date')).value;
  const timeStr = /** @type {HTMLInputElement} */ ($('#f-time')).value;
  const tz = /** @type {HTMLSelectElement} */ ($('#f-tz')).value;
  const amountMajor = Number(/** @type {HTMLInputElement} */ ($('#f-amount')).value);
  const lenDays = Number(/** @type {HTMLSelectElement} */ ($('#f-len')).value);
  const cardLabel = /** @type {HTMLInputElement} */ ($('#f-card')).value.trim();
  const currency = region === 'IN' ? 'INR' : 'USD';
  const entry =
    state.directory.find((x) => x.region === region && x.name.toLowerCase() === name.toLowerCase()) ??
    state.directory.find((x) => x.name.toLowerCase() === name.toLowerCase());

  return {
    serviceId: entry?.serviceId ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    region,
    serviceName: entry?.name ?? name,
    renewsAt: zonedWallTimeToInstant(dateStr, timeStr, tz).toISOString(),
    timezone: tz,
    amount: Math.round(amountMajor * 100),
    currency,
    trialLengthDays: lenDays,
    cardLabel: cardLabel || undefined,
  };
}

document.addEventListener('submit', async (e) => {
  const form = /** @type {HTMLFormElement} */ (e.target);
  if (form.id !== 'add-form') return;
  e.preventDefault();

  const fields = readForm();
  const errors = validateTrial({ ...fields, serviceName: fields.serviceName });
  const errEl = /** @type {HTMLElement} */ ($('#f-error'));
  if (errors.length) {
    errEl.hidden = false;
    errEl.textContent = errors.join(' · ');
    return;
  }

  if (state.editingId) {
    state.trials = state.trials.map((t) => (t.id === state.editingId ? { ...t, ...fields } : t));
    state.editingId = null;
    await save();
    render();
    return;
  }

  const gate = canAddTrial(state.trials);
  if (!gate.allowed && !state.settings.unlocked) {
    /** @type {HTMLDialogElement} */ ($('#paywall')).showModal();
    return;
  }

  state.trials = [
    ...state.trials,
    {
      id: crypto.randomUUID(),
      ...fields,
      status: 'active',
      createdAt: new Date().toISOString(),
      cancelledAt: null,
      cancelUrlUsed: null,
    },
  ];
  state.seed = null;
  await save();
  render();
});

document.addEventListener('click', async (e) => {
  const el = /** @type {HTMLElement} */ (e.target).closest('[data-act]');
  if (!el) return;
  const { id, act } = el.dataset;
  const trial = state.trials.find((t) => t.id === id);

  if (act === 'cancel-edit') {
    state.editingId = null;
    render();
    return;
  }

  if (act === 'edit' && trial) {
    state.editingId = trial.id;
    render();
    $('#f-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  if (act === 'open' && trial) {
    // Opening the cancel page is intent, not proof. Never mark it cancelled here.
    state.trials = transition(state.trials, id, 'awaiting_confirmation');
    const entry = entryFor(trial);
    if (entry) {
      state.trials = state.trials.map((t) => (t.id === id ? { ...t, cancelUrlUsed: entry.cancelUrl } : t));
    }
    await save();
    render();
    return;
  }

  if (act === 'confirm' && trial) {
    state.trials = transition(state.trials, id, 'confirmed_cancelled');
  } else if (act === 'undo' && trial) {
    state.trials = transition(state.trials, id, 'active');
  } else if (act === 'delete' && trial) {
    if (!confirm(`Remove ${trial.serviceName}? This cannot be undone.`)) return;
    state.trials = state.trials.filter((t) => t.id !== id);
  } else if (act === 'ics' && trial) {
    const entry = entryFor(trial);
    downloadIcs(
      `trialexit-${trial.serviceId}.ics`,
      buildIcs({
        trial,
        cancelUrl: entry?.cancelUrl ?? '',
        steps: entry?.steps ?? [`Sign in to ${trial.serviceName}`, 'Open billing settings', 'Cancel the subscription'],
        renewLabel: formatRenewalLocal(trial.renewsAt, trial.timezone),
        summaryLine: `${formatMoney(trial.amount, trial.currency)} will be charged`,
        requiresChat: entry?.requiresChat,
      }),
    );
    return;
  } else {
    return;
  }

  await save();
  render();
});

$('#unlock-close').addEventListener('click', () =>
  /** @type {HTMLDialogElement} */ ($('#paywall')).close(),
);

$('#unlock-apply').addEventListener('click', async () => {
  const code = /** @type {HTMLInputElement} */ ($('#unlock-code')).value.trim().toUpperCase();
  const errEl = /** @type {HTMLElement} */ ($('#unlock-error'));

  if (code === DEV_UNLOCK) {
    state.settings.unlocked = true;
    await save();
    /** @type {HTMLDialogElement} */ ($('#paywall')).close();
    render();
    return;
  }

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

setInterval(render, 30_000);
boot();
