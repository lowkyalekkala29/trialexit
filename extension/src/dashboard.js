import {
  zonedWallTimeToInstant,
  urgency,
  msUntil,
  formatCountdown,
  formatRenewalLocal,
  formatMoney,
  HOUR,
} from './core/dates.js';
import { normalizeDirectory, search, loadDirectory } from './core/directory.js';
import {
  canAddTrial,
  derivedStatus,
  savedTotals,
  sortedForDisplay,
  transition,
  validateTrial,
} from './core/store.js';
import { buildIcs, downloadIcs } from './core/ics.js';

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

const state = {
  /** @type {import('./core/types.js').Trial[]} */
  trials: [],
  /** @type {import('./core/types.js').DirectoryEntry[]} */
  directory: [],
  settings: { region: 'IN', unlocked: false },
  /** @type {{ serviceId?: string, serviceName?: string, amount?: number|null } | null} */
  seed: null,
};

const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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

  const seedEntries = got.bundledDirectory
    ? normalizeDirectory(got.bundledDirectory)
    : normalizeDirectory(await (await fetch('data/directory.json')).json());
  state.directory = seedEntries;
  render();

  loadDirectory(seedEntries).then((fresh) => {
    if (fresh.length && fresh.length !== state.directory.length) {
      state.directory = fresh;
      chrome.storage.local.set({ bundledDirectory: { entries: fresh } });
      render();
    }
  });
}

function entryFor(trial) {
  return state.directory.find((e) => e.serviceId === trial.serviceId && e.region === trial.region)
    ?? state.directory.find((e) => e.serviceId === trial.serviceId);
}

function cardHtml(t) {
  const now = new Date();
  const status = derivedStatus(t, now);
  const band = status === 'confirmed_cancelled' ? 'done' : urgency(t.renewsAt, now);
  const left = msUntil(t.renewsAt, now);
  const entry = entryFor(t);
  const verified = entry?.verified !== false;
  const done = status === 'confirmed_cancelled';

  const bandPill = done
    ? '<span class="pill ok">cancelled</span>'
    : status === 'charged'
      ? '<span class="pill crit">charged</span>'
      : status === 'awaiting_confirmation'
        ? '<span class="pill warn">confirm cancellation</span>'
        : '';

  return `
    <article class="card" data-band="${band}" data-id="${esc(t.id)}">
      <div class="card-head">
        <span class="card-name">${esc(t.serviceName)}</span>
        <span class="pill">${esc(t.region)}</span>
        ${bandPill}
        ${verified ? '' : '<span class="pill warn" title="This link could not be verified recently">link unverified</span>'}
        ${entry?.requiresChat ? '<span class="pill warn">chat required</span>' : ''}
        <span class="count ${band === 'critical' ? 'crit' : band === 'soon' ? 'soon' : ''}">
          ${status === 'charged' ? 'past due' : done ? '—' : formatCountdown(left)}
        </span>
      </div>
      <div class="meta">
        <span class="amount">${formatMoney(t.amount, t.currency)}</span> renews
        ${esc(formatRenewalLocal(t.renewsAt, t.timezone))}
        ${t.cardLabel ? ` · ${esc(t.cardLabel)}` : ''}
      </div>
      <div class="actions">
        ${entry ? `<a class="btn primary" href="${esc(entry.cancelUrl)}" target="_blank" rel="noopener" data-act="open" data-id="${esc(t.id)}">Cancel at ${esc(entry.name)}</a>` : ''}
        <button class="btn" data-act="ics" data-id="${esc(t.id)}">Add to calendar</button>
        ${done
          ? `<button class="ghost" data-act="undo" data-id="${esc(t.id)}">Undo</button>`
          : `<button class="btn" data-act="confirm" data-id="${esc(t.id)}">I cancelled it</button>`}
        <button class="ghost" data-act="delete" data-id="${esc(t.id)}">Remove</button>
      </div>
      ${entry?.steps?.length
        ? `<details class="steps"><summary>How to cancel at ${esc(entry.name)}</summary><ol>${entry.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>`
        : ''}
      ${entry?.note ? `<div class="hint">${esc(entry.note)}</div>` : ''}
    </article>`;
}

function formHtml() {
  const region = state.settings.region;
  const options = search(state.directory, '', region).concat(
    state.directory.filter((e) => e.region === region),
  );
  const seen = new Set();
  const datalist = options
    .filter((e) => (seen.has(e.name) ? false : seen.add(e.name)))
    .map((e) => `<option value="${esc(e.name)}"></option>`)
    .join('');
  const zones = ZONES.includes(deviceZone) ? ZONES : [deviceZone, ...ZONES];

  return `
    <form class="add" id="add-form">
      <h2>Log a trial</h2>
      <label>Service
        <input id="f-name" list="services" placeholder="Netflix" value="${esc(state.seed?.serviceName ?? '')}" required />
        <datalist id="services">${datalist}</datalist>
      </label>
      <label>Region
        <select id="f-region">
          <option value="IN" ${region === 'IN' ? 'selected' : ''}>India (₹)</option>
          <option value="US" ${region === 'US' ? 'selected' : ''}>US ($)</option>
        </select>
      </label>
      <label>Renews on
        <input id="f-date" type="date" required />
      </label>
      <label>Renews at
        <input id="f-time" type="time" value="00:00" required />
      </label>
      <label>Billing timezone
        <select id="f-tz">${zones.map((z) => `<option value="${z}" ${z === deviceZone ? 'selected' : ''}>${z}</option>`).join('')}</select>
      </label>
      <label>Renewal amount
        <input id="f-amount" type="number" min="0" step="1" placeholder="499" value="${state.seed?.amount ?? ''}" required />
      </label>
      <label>Trial length
        <select id="f-len">
          <option value="7">7 days</option>
          <option value="14">14 days</option>
          <option value="30">30 days</option>
          <option value="60">60 days</option>
        </select>
      </label>
      <label>Paid with (optional)
        <input id="f-card" placeholder="UPI AutoPay / HDFC card" />
      </label>
      <div class="row-span actions">
        <button type="submit" class="primary">Track this trial</button>
        <span class="hint">Alert fires 48h before renewal (5 days for trials over 2 weeks), plus a ping at 24h.</span>
      </div>
      <p class="error row-span" id="f-error" hidden></p>
    </form>`;
}

function render() {
  const now = new Date();
  const saved = savedTotals(state.trials);
  const savedText = [
    saved.INR ? formatMoney(saved.INR, 'INR') : '',
    saved.USD ? formatMoney(saved.USD, 'USD') : '',
  ]
    .filter(Boolean)
    .join(' + ');
  $('#saved').innerHTML = savedText ? `Saved so far <b>${esc(savedText)}</b>` : 'Nothing charged yet.';

  const list = sortedForDisplay(state.trials, now);
  $('#app').innerHTML =
    formHtml() +
    (list.length
      ? `<div class="cards">${list.map(cardHtml).join('')}</div>`
      : `<div class="empty">No trials tracked.<br />Log one above — it takes about five seconds.</div>`);
  $('#f-date').value = new Date(now.getTime() + 7 * 24 * HOUR).toISOString().slice(0, 10);
}

document.addEventListener('submit', async (e) => {
  const form = /** @type {HTMLFormElement} */ (e.target);
  if (form.id !== 'add-form') return;
  e.preventDefault();

  const name = /** @type {HTMLInputElement} */ ($('#f-name')).value.trim();
  const region = /** @type {HTMLSelectElement} */ ($('#f-region')).value;
  const dateStr = /** @type {HTMLInputElement} */ ($('#f-date')).value;
  const timeStr = /** @type {HTMLInputElement} */ ($('#f-time')).value;
  const tz = /** @type {HTMLSelectElement} */ ($('#f-tz')).value;
  const amountMajor = Number(/** @type {HTMLInputElement} */ ($('#f-amount')).value);
  const lenDays = Number(/** @type {HTMLSelectElement} */ ($('#f-len')).value);
  const cardLabel = /** @type {HTMLInputElement} */ ($('#f-card')).value.trim();
  const currency = region === 'IN' ? 'INR' : 'USD';

  const entry = state.directory.find(
    (x) => x.region === region && x.name.toLowerCase() === name.toLowerCase(),
  ) ?? state.directory.find((x) => x.name.toLowerCase() === name.toLowerCase());

  const renewsAt = zonedWallTimeToInstant(dateStr, timeStr, tz).toISOString();
  const trial = {
    id: crypto.randomUUID(),
    serviceId: entry?.serviceId ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    region,
    serviceName: entry?.name ?? name,
    renewsAt,
    timezone: tz,
    amount: Math.round(amountMajor * 100),
    currency,
    trialLengthDays: lenDays,
    status: 'active',
    createdAt: new Date().toISOString(),
    cancelledAt: null,
    cancelUrlUsed: null,
    cardLabel: cardLabel || undefined,
  };

  const errors = validateTrial(trial);
  const errEl = $('#f-error');
  if (errors.length) {
    errEl.hidden = false;
    errEl.textContent = errors.join(' · ');
    return;
  }

  const gate = canAddTrial(state.trials);
  if (!gate.allowed && !state.settings.unlocked) {
    /** @type {HTMLDialogElement} */ ($('#paywall')).showModal();
    return;
  }

  state.trials = [...state.trials, trial];
  state.seed = null;
  await save();
  render();
});

document.addEventListener('click', async (e) => {
  const el = /** @type {HTMLElement} */ (e.target).closest('[data-act]');
  if (!el) return;
  const id = el.dataset.id;
  const act = el.dataset.act;
  const trial = state.trials.find((t) => t.id === id);

  if (act === 'open' && trial) {
    // Opening the cancel page is intent, not proof. Never mark it cancelled here.
    state.trials = transition(state.trials, id, 'awaiting_confirmation');
    const entry = entryFor(trial);
    if (entry) state.trials = state.trials.map((t) => (t.id === id ? { ...t, cancelUrlUsed: entry.cancelUrl } : t));
    await save();
    render();
    return;
  }
  if (act === 'confirm' && trial) {
    state.trials = transition(state.trials, id, 'confirmed_cancelled');
  } else if (act === 'undo' && trial) {
    state.trials = transition(state.trials, id, 'active');
  } else if (act === 'delete' && trial) {
    state.trials = state.trials.filter((t) => t.id !== id);
  } else if (act === 'ics' && trial) {
    const entry = entryFor(trial);
    const ics = buildIcs({
      trial,
      cancelUrl: entry?.cancelUrl ?? '',
      steps: entry?.steps ?? [`Sign in to ${trial.serviceName}`, 'Open billing settings', 'Cancel the subscription'],
      renewLabel: formatRenewalLocal(trial.renewsAt, trial.timezone),
      summaryLine: `${formatMoney(trial.amount, trial.currency)} will be charged`,
      requiresChat: entry?.requiresChat,
    });
    downloadIcs(`trialexit-${trial.serviceId}.ics`, ics);
    return;
  } else {
    return;
  }
  await save();
  render();
});

$('#unlock-close').addEventListener('click', () => /** @type {HTMLDialogElement} */ ($('#paywall')).close());
$('#unlock-apply').addEventListener('click', async () => {
  const code = /** @type {HTMLInputElement} */ ($('#unlock-code')).value.trim().toUpperCase();
  if (code === 'TRIALEXIT-DEV') {
    state.settings.unlocked = true;
    await save();
    /** @type {HTMLDialogElement} */ ($('#paywall')).close();
    render();
  } else {
    $('#unlock-error').hidden = false;
  }
});

setInterval(render, 30_000);
boot();
