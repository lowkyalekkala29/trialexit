/**
 * Background service worker: badge refresh + checkout-page service lookup.
 * The content script never holds the directory — it asks here, so service
 * metadata has exactly one source of truth.
 */

import { normalizeDirectory, matchByHost, loadDirectory } from './core/directory.js';
import { derivedStatus, sortedForDisplay } from './core/store.js';
import { msUntil, HOUR } from './core/dates.js';

/** @returns {Promise<import('./core/types.js').Trial[]>} */
async function getTrials() {
  const got = await chrome.storage.local.get('trials');
  return Array.isArray(got.trials) ? got.trials : [];
}

async function getDirectory() {
  const got = await chrome.storage.local.get('bundledDirectory');
  const bundled = normalizeDirectory(got.bundledDirectory ?? { entries: [] });
  const seed = bundled.length
    ? bundled
    : normalizeDirectory(await (await fetch(chrome.runtime.getURL('data/directory.json'))).json());
  return loadDirectory(seed);
}

async function refreshBadge() {
  const trials = await getTrials();
  const now = new Date();
  const critical = trials.filter(
    (t) => derivedStatus(t, now) === 'active' && msUntil(t.renewsAt, now) <= 48 * HOUR,
  ).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#D93A2B' });
  await chrome.action.setBadgeText({ text: critical > 0 ? String(critical) : '' });
  const next = sortedForDisplay(trials, now)[0];
  await chrome.action.setTitle({
    title: next
      ? `TrialExit — ${next.serviceName} renews in ${Math.max(0, Math.ceil(msUntil(next.renewsAt, now) / HOUR))}h`
      : 'TrialExit',
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create('badge-refresh', { periodInMinutes: 30 });
  await refreshBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'badge-refresh') refreshBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.trials) refreshBadge();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'detect-service') {
    getDirectory()
      .then((entries) => sendResponse({ entry: matchByHost(entries, msg.hostname ?? '') ?? null }))
      .catch(() => sendResponse({ entry: null }));
    return true;
  }
  if (msg?.type === 'refresh-badge') {
    refreshBadge().then(() => sendResponse({ ok: true }));
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
