/**
 * Background service worker.
 *
 * Owns three things the UI must not: the alarm schedule, notifications, and
 * service-directory lookup. The worker is killed aggressively by Chrome, so
 * every piece of state it needs is rebuilt from chrome.storage on wake.
 */

import { normalizeDirectory, matchByHost, loadDirectory } from './core/directory.js';
import { derivedStatus, sortedForDisplay, transition } from './core/store.js';
import { msUntil, HOUR } from './core/dates.js';
import { extractTrialDays, extractPrice, detectPhase, derivationNote, deriveRenewal } from './core/guess.js';
import {
  pendingAlerts,
  alarmName,
  parseAlarmName,
  notificationTitle,
  notificationBody,
} from './core/alerts.js';

const ALARM_PREFIX = 'trial:';
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
  if (notificationId === DIGEST_ALARM) return chrome.runtime.openOptionsPage();
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

/**
 * Tier 3: user grants this one origin, and we register a persistent content
 * script for it. Still not <all_urls> — one origin at a time, on request.
 * @param {string} origin
 */
async function registerSiteScript(origin) {
  if (!/^https?:\/\/[^/]+$/.test(origin)) return { ok: false, reason: 'bad-origin' };
  const id = `site-${btoa(origin).replace(/[^a-zA-Z0-9]/g, '').slice(0, 40)}`;
  const existing = await chrome.scripting.getRegisteredContentScripts();
  if (existing.some((s) => s.id === id)) return { ok: true, already: true };
  await chrome.scripting.registerContentScripts([
    {
      id,
      matches: [`${origin}/*`],
      js: ['src/detect.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ]);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
  if (msg?.type === 'register-site') {
    registerSiteScript(msg.origin)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, reason: String(err?.message ?? err) }));
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
