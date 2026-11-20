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
import {
  pendingAlerts,
  alarmName,
  parseAlarmName,
  notificationTitle,
  notificationBody,
} from './core/alerts.js';

const ALARM_PREFIX = 'trial:';

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
  const critical = list.filter(
    (t) => derivedStatus(t, now) === 'active' && msUntil(t.renewsAt, now) <= 48 * HOUR,
  ).length;
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
  const parsed = parseAlarmName(alarmNameValue);
  if (!parsed) return;
  const trials = await getTrials();
  const directory = await getDirectory();
  const found = cancelUrlFor(trials, directory, parsed.trialId);
  if (!found?.trial || derivedStatus(found.trial) !== 'active') return;

  await chrome.notifications.create(alarmNameValue, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: notificationTitle(found.trial, /** @type {any} */ (parsed.kind)),
    message: notificationBody(found.trial),
    contextMessage: found.entry ? `Cancel at ${found.entry.name}` : 'Open TrialExit to cancel',
    priority: 2,
    requireInteraction: true,
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create('badge-refresh', { periodInMinutes: 30 });
  await refreshBadge();
  await resyncAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  await refreshBadge();
  await resyncAlarms();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'badge-refresh') {
    refreshBadge();
    resyncAlarms();
    return;
  }
  if (alarm.name.startsWith(ALARM_PREFIX)) fireNotification(alarm.name);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.trials) return;
  refreshBadge(changes.trials.newValue);
  resyncAlarms();
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const parsed = parseAlarmName(notificationId);
  const trials = await getTrials();
  const directory = await getDirectory();
  const found = parsed ? cancelUrlFor(trials, directory, parsed.trialId) : null;

  if (found?.url) {
    // Opening the cancel page is intent, not proof — never mark it cancelled.
    await setTrials(transition(trials, /** @type {string} */ (parsed?.trialId), 'awaiting_confirmation'));
    await chrome.tabs.create({ url: found.url });
  } else {
    await chrome.runtime.openOptionsPage();
  }
  await chrome.notifications.clear(notificationId);
});

/**
 * Injected into the active tab on demand. Must be fully self-contained: Chrome
 * serialises this function, so it cannot close over anything in the worker.
 */
function scanPage() {
  const text = (document.body?.innerText ?? '').slice(0, 20_000);
  const signals = [
    /\bfree trial\b/i,
    /\b\d+\s*-?\s*day(?:s)?\s+free\b/i,
    /\btry (?:it )?free\b/i,
    /\bstart (?:your )?free\b/i,
    /\bauto-?renew/i,
    /\bthen\s*(?:₹|rs\.?|\$|usd)\s*[\d,]+/i,
  ];
  const priceMatch = /(?:₹|rs\.?|\$)\s?([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  return {
    hostname: location.hostname,
    title: document.title,
    looksLikeTrial: signals.some((re) => re.test(text)),
    price: priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null,
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

  const entries = await getDirectory();
  const byHost = matchByHost(entries, scan.hostname ?? '');
  const title = String(scan.title ?? '').toLowerCase();
  const byTitle = byHost
    ? null
    : entries.find((e) => e.name.length > 3 && title.includes(e.name.toLowerCase())) ?? null;

  return { ok: true, scan, entry: byHost ?? byTitle ?? null };
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
