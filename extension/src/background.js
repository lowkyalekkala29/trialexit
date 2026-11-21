/**
 * Background service worker.
 *
 * Owns three things the UI must not: the alarm schedule, notifications, and
 * service-directory lookup. The worker is killed aggressively by Chrome, so
 * every piece of state it needs is rebuilt from chrome.storage on wake.
 */

import { normalizeDirectory, matchByHost, loadDirectory } from './core/directory.js';
import { derivedStatus, sortedForDisplay, transition } from './core/store.js';
import { msUntil, HOUR, zonedWallTimeToInstant } from './core/dates.js';
import { extractTrialDays, extractPrice, detectPhase, derivationNote, deriveRenewal, parseTrialEmail } from './core/guess.js';
import {
  pendingAlerts,
  alarmName,
  parseAlarmName,
  notificationTitle,
  notificationBody,
} from './core/alerts.js';

import { scanMailbox, disconnectMailbox, PROVIDERS } from './mail-scan.js';
import { decideActivation, pageSignals } from './core/activation.js';

const ALARM_PREFIX = 'trial:';
const MAIL_ALARM = 'mail-scan';
const SNOOZE_PREFIX = 'snooze:';
const DIGEST_ALARM = 'daily-digest';
const SNOOZE_MS = 3 * HOUR;

/** Next 09:00 local time, so the digest lands at the start of the day. */
function nextNineAm(now = new Date()) {
  const d = new Date(now);
  d.setHours(9, 0, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

async function ensureDigest() {
  const existing = await chrome.alarms.get(DIGEST_ALARM);
  if (!existing) await chrome.alarms.create(DIGEST_ALARM, { when: nextNineAm(), periodInMinutes: 24 * 60 });
}

/** Morning roll-up: everything renewing this week plus anything still unanswered. */
async function fireDigest() {
  const trials = await getTrials();
  const now = new Date();
  const week = trials.filter(
    (t) => derivedStatus(t, now) === 'active' && msUntil(t.renewsAt, now) <= 7 * 24 * HOUR,
  );
  const unanswered = trials.filter((t) => derivedStatus(t, now) === 'charged');
  if (!week.length && !unanswered.length) return;
  const parts = [];
  if (week.length) parts.push(`${week.length} trial${week.length > 1 ? 's' : ''} renew this week: ${week.map((t) => t.serviceName).join(', ')}`);
  if (unanswered.length) parts.push(`${unanswered.length} renewed without an answer — did you cancel?`);
  await chrome.notifications.create(DIGEST_ALARM, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: 'TrialExit — your trials today',
    message: parts.join('. '),
    priority: 1,
  });
}

/** @returns {Promise<import('./core/types.js').Trial[]>} */
async function getTrials() {
  const got = await chrome.storage.local.get('trials');
  return Array.isArray(got.trials) ? got.trials : [];
}

async function setTrials(trials) {
  await chrome.storage.local.set({ trials });
}

async function getDirectory() {
  const got = await chrome.storage.local.get('bundledDirectory');
  const bundled = normalizeDirectory(got.bundledDirectory ?? { entries: [] });
  const seed = bundled.length
    ? bundled
    : normalizeDirectory(await (await fetch(chrome.runtime.getURL('data/directory.json'))).json());
  return loadDirectory(seed);
}

function cancelUrlFor(trials, directory, trialId) {
  const trial = trials.find((t) => t.id === trialId);
  if (!trial) return null;
  const entry =
    directory.find((e) => e.serviceId === trial.serviceId && e.region === trial.region) ??
    directory.find((e) => e.serviceId === trial.serviceId);
  return { trial, entry: entry ?? null, url: entry?.cancelUrl ?? null };
}

async function refreshBadge(trials) {
  const list = trials ?? (await getTrials());
  const now = new Date();
  const critical = list.filter((t) => {
    const st = derivedStatus(t, now);
    if (st === 'charged') return msUntil(t.renewsAt, now) > -3 * 24 * HOUR; // ask for 3 days
    return (st === 'active' || st === 'awaiting_confirmation') && msUntil(t.renewsAt, now) <= 48 * HOUR;
  }).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#D93A2B' });
  await chrome.action.setBadgeText({ text: critical > 0 ? String(critical) : '' });
  const next = sortedForDisplay(list, now).find((t) => derivedStatus(t, now) === 'active');
  await chrome.action.setTitle({
    title: next
      ? `TrialExit — ${next.serviceName} renews in ${Math.max(0, Math.ceil(msUntil(next.renewsAt, now) / HOUR))}h`
      : 'TrialExit',
  });
}

/**
 * Reconciles alarms with the current trial list: drop stale ones, add missing
 * ones. Idempotent, so it is safe to call on every storage change and on wake.
 */
async function resyncAlarms() {
  const trials = await getTrials();
  const wanted = new Map(pendingAlerts(trials).map((a) => [alarmName(a), a]));

  const existing = await chrome.alarms.getAll();
  for (const alarm of existing) {
    if (!alarm.name.startsWith(ALARM_PREFIX)) continue;
    if (!wanted.has(alarm.name)) await chrome.alarms.clear(alarm.name);
  }

  const present = new Set(existing.map((a) => a.name));
  for (const [name, alert] of wanted) {
    if (present.has(name)) continue;
    const when = new Date(alert.at).getTime();
    if (when <= Date.now()) continue;
    await chrome.alarms.create(name, { when });
  }
}

async function fireNotification(alarmNameValue) {
  const isSnooze = alarmNameValue.startsWith(SNOOZE_PREFIX);
  const parsed = isSnooze
    ? (() => {
        const [, trialId, kind] = alarmNameValue.split(':');
        return { trialId, kind };
      })()
    : parseAlarmName(alarmNameValue);
  if (!parsed) return;
  const trials = await getTrials();
  const directory = await getDirectory();
  const found = cancelUrlFor(trials, directory, parsed.trialId);
  if (!found?.trial) return;
  const status = derivedStatus(found.trial);
  const kind = /** @type {any} */ (parsed.kind);
  const checkin = kind === 'checkin';
  if (checkin ? !['charged', 'active', 'awaiting_confirmation'].includes(status) : !['active', 'awaiting_confirmation'].includes(status)) return;

  // One notification id per trial: a newer rung replaces the older one.
  const id = `${ALARM_PREFIX}${parsed.trialId}:${kind}`;
  await chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: notificationTitle(found.trial, kind),
    message: notificationBody(found.trial, kind),
    contextMessage: found.entry ? `Cancel at ${found.entry.name}` : 'Open TrialExit to cancel',
    buttons: checkin
      ? [{ title: 'Open TrialExit' }]
      : [{ title: found.url ? 'Open cancel page' : 'Open TrialExit' }, { title: 'Snooze 3 hours' }],
    priority: 2,
    requireInteraction: true,
  });
}

/** @param {string} notificationId @param {number} buttonIndex */
async function handleNotification(notificationId, buttonIndex = 0) {
  await chrome.notifications.clear(notificationId);
  if (notificationId === DIGEST_ALARM || notificationId === 'mail-found') return chrome.runtime.openOptionsPage();
  const parsed = parseAlarmName(notificationId);
  if (!parsed) return chrome.runtime.openOptionsPage();

  if (buttonIndex === 1) {
    const renewsAt = (await getTrials()).find((t) => t.id === parsed.trialId)?.renewsAt;
    // Never snooze past the charge: cap at 10 minutes before renewal.
    const cap = renewsAt ? new Date(renewsAt).getTime() - 10 * 60_000 : Infinity;
    const when = Math.min(Date.now() + SNOOZE_MS, cap);
    if (when > Date.now()) {
      await chrome.alarms.create(`${SNOOZE_PREFIX}${parsed.trialId}:${parsed.kind}`, { when });
    }
    return;
  }

  const trials = await getTrials();
  const found = cancelUrlFor(trials, await getDirectory(), parsed.trialId);
  if (parsed.kind !== 'checkin' && found?.url && derivedStatus(found.trial) === 'active') {
    // Opening the cancel page is intent, not proof — never mark it cancelled.
    await setTrials(transition(trials, parsed.trialId, 'awaiting_confirmation'));
    await chrome.tabs.create({ url: found.url });
  } else {
    await chrome.runtime.openOptionsPage();
  }
}

/**
 * Scan one mailbox (or every connected one), merge new suggestions into
 * storage, and notify about anything new on background runs.
 * @param {'gmail'|'outlook'|null} provider  null = all connected
 * @param {boolean} interactive
 */
async function runMailScan(provider, interactive) {
  const got = await chrome.storage.local.get(['mailSeen', 'mailCandidates', 'settings']);
  const settings = got.settings ?? {};
  const connected = { ...(settings.mailConnected ?? {}) };
  const targets = provider ? [provider] : Object.keys(connected).filter((k) => connected[k]);
  const existing = Array.isArray(got.mailCandidates) ? got.mailCandidates : [];
  const seen = new Set([...(got.mailSeen ?? []), ...existing.map((c) => c.messageId)]);
  const fresh = [];
  const errors = {};
  for (const p of targets) {
    try {
      const { candidates } = await scanMailbox(/** @type {any} */ (p), {
        interactive,
        directory: await getDirectory(),
        trials: await getTrials(),
        seen,
      });
      const knownServices = new Set([...existing, ...fresh].map((c) => (c.serviceId ?? c.serviceName).toLowerCase()));
      fresh.push(...candidates.filter((c) => !knownServices.has((c.serviceId ?? c.serviceName).toLowerCase())));
      connected[p] = true;
    } catch (err) {
      errors[p] = String(err?.message ?? err);
    }
  }
  const latest = (await chrome.storage.local.get('settings')).settings ?? {};
  await chrome.storage.local.set({
    mailCandidates: [...existing, ...fresh],
    settings: { ...latest, mailConnected: connected, mailLastScan: new Date().toISOString(), mailErrors: errors },
  });
  if (Object.values(connected).some(Boolean)) await chrome.alarms.create(MAIL_ALARM, { periodInMinutes: 6 * 60 });
  if (!interactive && fresh.length) {
    await chrome.notifications.create('mail-found', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: fresh.length === 1 ? `New trial found: ${fresh[0].serviceName}` : `${fresh.length} new trials found in your email`,
      message: 'Open TrialExit to start tracking — we will nudge you before it charges.',
      priority: 2,
    });
  }
  if (provider && errors[provider]) return { ok: false, reason: errors[provider] };
  return { ok: true, found: fresh.length };
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.alarms.create('badge-refresh', { periodInMinutes: 30 });
  await ensureDigest();
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
  await refreshBadge();
  await resyncAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDigest();
  await refreshBadge();
  await resyncAlarms();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'badge-refresh') {
    refreshBadge();
    resyncAlarms();
    return;
  }
  if (alarm.name === MAIL_ALARM) {
    runMailScan(null, false).catch(() => {});
    return;
  }
  if (alarm.name === DIGEST_ALARM) {
    fireDigest();
    return;
  }
  if (alarm.name.startsWith(ALARM_PREFIX) || alarm.name.startsWith(SNOOZE_PREFIX)) fireNotification(alarm.name);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.trials) return;
  refreshBadge(changes.trials.newValue);
  resyncAlarms();
});

chrome.notifications.onClicked.addListener((id) => handleNotification(id, 0));
chrome.notifications.onButtonClicked.addListener((id, index) => handleNotification(id, index));

/**
 * Injected into the active tab on demand. Must be fully self-contained: Chrome
 * serialises this function, so it cannot close over anything in the worker.
 */
function scanPage() {
  const text = (document.body?.innerText ?? '').slice(0, 20_000);
  return {
    hostname: location.hostname,
    url: location.href,
    title: document.title,
    text,
  };
}

/**
 * Reads a page's text into a structured, confidence-labelled guess.
 * Every field here is a suggestion the UI must surface and the user must confirm.
 * @param {{ text: string, url: string, title: string, hostname: string }} page
 */
async function analyzePage(page) {
  const entries = await getDirectory();
  const byHost = matchByHost(entries, page.hostname ?? '');
  const title = String(page.title ?? '').toLowerCase();
  const byTitle = byHost
    ? null
    : entries.find((e) => e.name.length > 3 && title.includes(e.name.toLowerCase())) ?? null;

  const days = extractTrialDays(page.text);
  const price = extractPrice(page.text);
  const phase = detectPhase(page.text, page.url);
  const entry = byHost ?? byTitle ?? null;

  return {
    hostname: page.hostname,
    title: page.title,
    entry,
    phase,
    days,
    price,
    // A guessed trial length is only useful with a guessed renewal date.
    renewsAt: days ? deriveRenewal(new Date(), days.days) : null,
    note: derivationNote({ days, price, phase }),
  };
}

/**
 * Tier 2: activeTab. Works on ANY site the user invokes us on, with no
 * install-time host permission.
 */
async function detectActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, reason: 'no-tab' };
  // Do not gate on tab.url: without host permission it is undefined even though
  // the activeTab grant still lets us inject. Injection is the real test.
  let injection;
  try {
    [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanPage,
    });
  } catch (err) {
    return { ok: false, reason: 'restricted-page' };
  }
  const scan = injection?.result;
  if (!scan) return { ok: false, reason: 'no-result' };
  return { ok: true, analysis: await analyzePage(scan) };
}

/* ------------------------------------------------ trial activation (all sites) */

const INTENT_KEY = (tabId) => `intent:${tabId}`;

async function getIntent(tabId) {
  if (tabId == null) return null;
  const key = INTENT_KEY(tabId);
  return (await chrome.storage.session.get(key))[key] ?? null;
}

async function setIntent(tabId, intent) {
  if (tabId == null) return;
  const key = INTENT_KEY(tabId);
  if (intent) await chrome.storage.session.set({ [key]: intent });
  else await chrome.storage.session.remove(key);
}

chrome.tabs.onRemoved.addListener((tabId) => setIntent(tabId, null));

/** Registrable-ish domain, so app.x.com and x.com share a mute. */
function baseDomain(hostname) {
  if (/^[\d.]+$|^\[|^localhost$/.test(hostname)) return hostname;
  const parts = String(hostname).replace(/^www\./, '').split('.');
  return parts.length > 2 && parts.at(-2).length <= 3 ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
}

const CHECKOUT_URL = /checkout|subscri|signup|sign-up|trial|billing|payment|upgrade|plans?\b|pricing|premium|purchase/i;

/**
 * Every page reports here. Ordinary pages arrive with empty text and return
 * immediately unless this tab has a pending trial checkout.
 * @param {any} page
 * @param {number|undefined} tabId
 */
async function handlePageScan(page, tabId) {
  const intent = await getIntent(tabId);
  if (!page.text && !intent) return {};
  const { settings } = await chrome.storage.local.get('settings');
  if (settings?.watchCheckouts === false) return {};

  const { mutedHosts = [] } = await chrome.storage.local.get('mutedHosts');
  const muted = mutedHosts.includes(baseDomain(page.hostname));
  const signals = pageSignals(page.url, page.text);
  const analysis = page.text ? { ...(await analyzePage(page)), siteName: page.siteName || null } : null;

  const isCheckout = Boolean(
    page.text && signals.trial && !signals.success && (page.paymentForm || CHECKOUT_URL.test(page.url)),
  );
  if (isCheckout && !muted) {
    const keepSubmit = intent?.url === page.url && intent.submitted;
    await setIntent(tabId, { at: Date.now(), submitted: keepSubmit, url: page.url, host: page.hostname, analysis });
    return { checkout: true };
  }

  const trials = await getTrials();
  const candidate = intent?.analysis ?? analysis;
  const name = candidate?.entry?.name ?? candidate?.siteName ?? page.siteName ?? '';
  const alreadyTracked = Boolean(
    name &&
      trials.some(
        (t) =>
          ['active', 'awaiting_confirmation'].includes(t.status) &&
          (t.serviceId === candidate?.entry?.serviceId || t.serviceName.toLowerCase() === name.toLowerCase()) &&
          Date.now() - new Date(t.createdAt).getTime() < 3 * 24 * HOUR,
      ),
  );

  const decision = decideActivation({
    intent,
    current: { host: page.hostname, url: page.url, signals, analysis: analysis ?? { siteName: page.siteName || null } },
    alreadyTracked,
    muted,
  });
  if (decision.show) {
    await setIntent(tabId, null);
    return { show: true, confidence: decision.confidence, analysis: decision.analysis };
  }
  return {};
}

export const GMAIL_TRIAL_SEARCH =
  '("free trial" OR "trial ends" OR "trial period" OR "your trial" OR "subscription confirmation" OR "will automatically renew" OR "you\'ll be charged") newer_than:60d';

/** Same service, renewal within 2 days, still open: treat as the same trial. */
function findDuplicate(trials, serviceId, serviceName, renewsAt) {
  const at = new Date(renewsAt).getTime();
  return trials.find(
    (t) =>
      (t.serviceId === serviceId || t.serviceName.toLowerCase() === String(serviceName).toLowerCase()) &&
      ['active', 'awaiting_confirmation'].includes(t.status) &&
      Math.abs(new Date(t.renewsAt).getTime() - at) < 2 * 24 * HOUR,
  );
}

/** @param {any} input from a detector; every field was confirmed by the user */
async function addTrialFromDetector(input) {
  const name = String(input?.serviceName ?? '').trim();
  if (!name) return { ok: false, reason: 'Service name is required' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input?.renewsOn))) return { ok: false, reason: 'Pick an end date' };
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const renewsAt = zonedWallTimeToInstant(input.renewsOn, '00:00', zone).toISOString();
  const directory = await getDirectory();
  const entry =
    (input.serviceId && directory.find((e) => e.serviceId === input.serviceId)) ||
    directory.find((e) => e.name.toLowerCase() === name.toLowerCase()) ||
    null;
  const currency = input.currency ?? (zone === 'Asia/Kolkata' || zone === 'Asia/Calcutta' ? 'INR' : 'USD');
  const region = input.region ?? entry?.region ?? (currency === 'INR' ? 'IN' : 'US');
  const serviceId = entry?.serviceId ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const trials = await getTrials();
  if (findDuplicate(trials, serviceId, name, renewsAt)) return { ok: true, duplicate: true };
  const days = Number(input.trialLengthDays) || Math.max(1, Math.round((new Date(renewsAt).getTime() - Date.now()) / (24 * HOUR)));
  trials.push({
    id: crypto.randomUUID(),
    serviceId,
    region,
    serviceName: entry?.name ?? name,
    renewsAt,
    timezone: zone,
    amount: Math.max(0, Math.round((Number(input.amount) || 0) * 100)),
    currency,
    trialLengthDays: days,
    status: 'active',
    createdAt: new Date().toISOString(),
    cancelledAt: null,
    cancelUrlUsed: null,
    source: input.source ?? 'detector',
  });
  await setTrials(trials);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'analyze-email') {
    Promise.all([getDirectory(), getTrials()])
      .then(([entries, trials]) => {
        const result = parseTrialEmail(String(msg.text ?? ''), entries);
        const alreadyTracked = Boolean(
          result.renewsOn &&
            result.entry &&
            findDuplicate(trials, result.entry.serviceId, result.entry.name, result.renewsOn),
        );
        sendResponse({ ok: true, result, alreadyTracked });
      })
      .catch((err) => sendResponse({ ok: false, reason: String(err?.message ?? err) }));
    return true;
  }
  if (msg?.type === 'add-trial') {
    addTrialFromDetector(msg.trial)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, reason: String(err?.message ?? err) }));
    return true;
  }
  if (msg?.type === 'mail-connect' || msg?.type === 'mail-rescan') {
    if (msg.provider && !PROVIDERS[msg.provider]) return false;
    runMailScan(msg.provider ?? null, msg.type === 'mail-connect')
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, reason: String(err?.message ?? err) }));
    return true;
  }
  if (msg?.type === 'mail-dismiss') {
    chrome.storage.local.get(['mailSeen', 'mailCandidates']).then(async (got) => {
      const seen = new Set(got.mailSeen ?? []);
      seen.add(msg.messageId);
      await chrome.storage.local.set({
        mailSeen: [...seen].slice(-2000),
        mailCandidates: (got.mailCandidates ?? []).filter((c) => c.messageId !== msg.messageId),
      });
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg?.type === 'mail-disconnect') {
    if (!PROVIDERS[msg.provider]) return false;
    disconnectMailbox(msg.provider).then(async () => {
      const got = await chrome.storage.local.get(['settings', 'mailCandidates']);
      const connected = { ...(got.settings?.mailConnected ?? {}), [msg.provider]: false };
      if (!Object.values(connected).some(Boolean)) await chrome.alarms.clear(MAIL_ALARM);
      await chrome.storage.local.set({
        mailCandidates: (got.mailCandidates ?? []).filter((c) => c.provider !== msg.provider),
        settings: { ...(got.settings ?? {}), mailConnected: connected },
      });
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg?.type === 'scan-gmail') {
    chrome.tabs
      .create({ url: `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(GMAIL_TRIAL_SEARCH)}` })
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'detect-service') {
    getDirectory()
      .then((entries) => sendResponse({ entry: matchByHost(entries, msg.hostname ?? '') ?? null }))
      .catch(() => sendResponse({ entry: null }));
    return true;
  }
  if (msg?.type === 'analyze-page') {
    analyzePage(msg.page ?? {})
      .then((analysis) => sendResponse({ ok: true, analysis }))
      .catch((err) => sendResponse({ ok: false, reason: String(err?.message ?? err) }));
    return true;
  }
  if (msg?.type === 'detect-active') {
    detectActiveTab()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, reason: String(err?.message ?? err) }));
    return true;
  }
  if (msg?.type === 'page-scan') {
    handlePageScan(msg.page ?? {}, _sender.tab?.id)
      .then(sendResponse)
      .catch(() => sendResponse({}));
    return true;
  }
  if (msg?.type === 'checkout-submitted') {
    getIntent(_sender.tab?.id).then(async (intent) => {
      if (intent) await setIntent(_sender.tab?.id, { ...intent, submitted: true, at: Date.now() });
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg?.type === 'mute-site') {
    chrome.storage.local.get('mutedHosts').then(async ({ mutedHosts = [] }) => {
      const set = new Set(mutedHosts);
      set.add(baseDomain(msg.hostname ?? ''));
      await chrome.storage.local.set({ mutedHosts: [...set] });
      await setIntent(_sender.tab?.id, null);
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg?.type === 'refresh-badge') {
    Promise.all([refreshBadge(), resyncAlarms()]).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'open-dashboard') {
    chrome.storage.local
      .set({ pendingSeed: msg.seed ?? null })
      .then(() => chrome.runtime.openOptionsPage())
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
