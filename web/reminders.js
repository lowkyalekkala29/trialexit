/**
 * Web reminders.
 *
 * A web page cannot wake itself up, so browser notifications here only fire
 * while a TrialExit tab is open. The dependable channels on the web are the
 * calendar export (follows you to your phone) and the Chrome extension. This
 * module covers the "tab is open" case and nags the user toward a real channel.
 */
import { alertSchedule, msUntil } from './core/dates.js';
import { derivedStatus } from './core/store.js';
import { notificationTitle, notificationBody } from './core/alerts.js';

const FIRED_KEY = 'trialexit:fired';

function fired() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

function markFired(set) {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify([...set].slice(-500)));
  } catch {
    /* ignore */
  }
}

async function check() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const { trials = [] } = await chrome.storage.local.get('trials');
  const now = new Date();
  const done = fired();
  for (const t of trials) {
    if (derivedStatus(t, now) !== 'active' || msUntil(t.renewsAt, now) <= 0) continue;
    // Every alert from the full schedule that is already due, oldest first.
    const due = alertSchedule(t.renewsAt, t.trialLengthDays, new Date(0)).filter(
      (a) => new Date(a.at).getTime() <= now.getTime(),
    );
    const latest = due.at(-1);
    if (!latest) continue;
    const key = `${t.id}:${latest.kind}`;
    if (done.has(key)) continue;
    done.add(key);
    const n = new Notification(notificationTitle(t, latest.kind), {
      body: notificationBody(t, latest.kind),
      icon: 'icons/icon-128.png',
      tag: key,
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }
  markFired(done);
}

function renderBanner() {
  const el = document.getElementById('web-banner');
  if (!el) return;
  const canNotify = 'Notification' in window;
  const granted = canNotify && Notification.permission === 'granted';
  if (document.body.classList.contains('is-onboarding')) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<div class="banner">
    <div>
      Trials are saved in this browser. For nudges when this tab is closed, use
      <b>Calendar</b> on each trial, or <a href="../#install">get the Chrome extension</a> — it also finds trials in your Gmail.
    </div>
    ${canNotify && !granted && Notification.permission !== 'denied'
      ? '<button class="btn" id="enable-notify">Enable tab alerts</button>'
      : ''}</div>`;
  document.getElementById('enable-notify')?.addEventListener('click', async () => {
    await Notification.requestPermission();
    renderBanner();
    check();
  });
}

renderBanner();
new MutationObserver(renderBanner).observe(document.body, { attributes: true, attributeFilter: ['class'] });
check();
setInterval(check, 60_000);
