/**
 * Shared app state + data helpers for the dashboard (extension) and web app.
 */
import { zonedWallTimeToInstant, msUntil, formatRenewalLocal, formatMoney, HOUR, DAY } from './core/dates.js';
import { normalizeDirectory, loadDirectory } from './core/directory.js';
import { derivedStatus } from './core/store.js';
import { buildIcs } from './core/ics.js';

export const IS_WEB = location.protocol !== 'chrome-extension:';
export const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export const defaultRegion = /^Asia\/(Kolkata|Calcutta)$/.test(deviceZone) ? 'IN' : 'US';

export const state = {
  /** @type {any[]} */ trials: [],
  /** @type {{id:string, deletedAt:string}[]} */ tombstones: [],
  /** @type {any[]} */ directory: [],
  /** @type {any} */ settings: {},
  /** @type {any} */ session: null,
  /** @type {any} */ seed: null,
  /** @type {string|null} */ editingId: null,
  addOpen: false,
  /** @type {'pick'|'paste'|'manual'} */ addTab: 'pick',
  /** @type {'trial'|'subscription'} */ addKind: 'trial',
  quick: /** @type {{serviceId: string|null, when: number|string}} */ ({ serviceId: null, when: 7 }),
  ob: { picked: /** @type {string[]} */ ([]), when: /** @type {Record<string, number|string>} */ ({}) },
  mail: { candidates: /** @type {any[]} */ ([]), busy: /** @type {any} */ (false), error: '', report: /** @type {any} */ (null) },
  auth: { email: '', stage: /** @type {'start'|'code'} */ ('start'), busy: false, error: '', mode: /** @type {'signup'|'signin'} */ ('signup') },
  filter: { status: 'open', q: '' },
  lastSync: /** @type {string|null} */ (null),
  extensionInstalled: false,
};

export const DEFAULT_SETTINGS = {
  name: '',
  region: defaultRegion,
  timezone: deviceZone,
  onboarded: false,
  reminderEmail: true,
  reminderBrowser: true,
  reminderSkip: /** @type {string[]} */ ([]),
  unlocked: false,
  watchCheckouts: true,
};

export const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

export function esc(v) {
  return String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(/** @type {any} */ (el)._t);
  /** @type {any} */ (el)._t = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Worker-owned fields: never let a stale tab overwrite them. */
export function pickWorkerFields(s) {
  if (!s) return {};
  const { mailConnected, mailLastScan, mailErrors, mailAccounts, scannedWith } = s;
  return { mailConnected, mailLastScan, mailErrors, mailAccounts, scannedWith };
}

export async function save() {
  const latest = (await chrome.storage.local.get('settings')).settings;
  state.settings = { ...state.settings, ...pickWorkerFields(latest) };
  await chrome.storage.local.set({ trials: state.trials, tombstones: state.tombstones, settings: state.settings });
  chrome.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => {});
}

export const now = () => new Date();
export const stampNow = () => new Date().toISOString();

/* ---------------------------------------------------------------- directory */

const DIRECTORY_CANDIDATES = IS_WEB ? ['data/directory.json', '../data/directory.json'] : ['../data/directory.json', 'data/directory.json'];

export async function loadBundledDirectory() {
  for (const url of DIRECTORY_CANDIDATES) {
    try {
      const res = await fetch(url);
      if (res.ok) return normalizeDirectory(await res.json());
    } catch {
      /* next */
    }
  }
  return [];
}

export async function refreshDirectory(onChange) {
  const fresh = await loadDirectory(state.directory).catch(() => []);
  if (fresh.length && fresh.length !== state.directory.length) {
    state.directory = fresh;
    chrome.storage.local.set({ bundledDirectory: { entries: fresh } });
    onChange?.();
  }
}

export function entryFor(trial) {
  return (
    state.directory.find((e) => e.serviceId === trial.serviceId && e.region === trial.region) ??
    state.directory.find((e) => e.serviceId === trial.serviceId)
  );
}

export function services() {
  const region = state.settings.region;
  const byId = new Map();
  for (const e of state.directory) {
    const cur = byId.get(e.serviceId);
    if (!cur || (cur.region !== region && e.region === region)) byId.set(e.serviceId, e);
  }
  return [...byId.values()];
}

export const serviceById = (id) => services().find((e) => e.serviceId === id) ?? null;

/* ------------------------------------------------------------------- trials */

export function renewalFrom(when) {
  if (typeof when === 'number') return { renewsAt: new Date(Date.now() + when * DAY).toISOString(), days: when };
  const at = zonedWallTimeToInstant(String(when), '00:00', deviceZone);
  return { renewsAt: at.toISOString(), days: Math.max(1, Math.round((at.getTime() - Date.now()) / DAY)) };
}

export function newTrial(fields) {
  const t = stampNow();
  return { id: crypto.randomUUID(), status: 'active', createdAt: t, updatedAt: t, cancelledAt: null, cancelUrlUsed: null, ...fields };
}

export function quickTrial(serviceId, when, amountMajor) {
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

export function removeTrial(id) {
  state.trials = state.trials.filter((t) => t.id !== id);
  state.tombstones = [...state.tombstones.filter((d) => d.id !== id), { id, deletedAt: stampNow() }];
}

/** 'attention' | 'upcoming' | 'resolved' */
export function bucket(t, at = now()) {
  // Subscriptions have their own page; they never show as trial cards.
  if (t.kind === 'subscription') return t.status === 'confirmed_cancelled' ? 'resolved' : 'subscription';
  const st = derivedStatus(t, at);
  if (st === 'confirmed_cancelled' || st === 'kept' || st === 'dismissed' || t.status === 'charged') return 'resolved';
  if (st === 'charged' || st === 'awaiting_confirmation') return 'attention';
  if (msUntil(t.renewsAt, at) <= 48 * HOUR) return 'attention';
  return 'upcoming';
}

export function combinedIcs(trials) {
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

export function money(totals) {
  return [totals.INR && formatMoney(totals.INR, 'INR'), totals.USD && formatMoney(totals.USD, 'USD')].filter(Boolean).join(' + ');
}

export function initials(nameOrEmail) {
  const s = String(nameOrEmail ?? '').trim();
  if (!s) return '?';
  const parts = s.includes('@') ? [s[0]] : s.split(/\s+/).slice(0, 2).map((p) => p[0]);
  return parts.join('').toUpperCase();
}
