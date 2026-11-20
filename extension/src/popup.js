import { derivedStatus, sortedForDisplay } from './core/store.js';
import { urgency, msUntil, formatCountdown, formatMoney } from './core/dates.js';

const mini = document.getElementById('mini');
const detectArea = document.getElementById('detect-area');

document.getElementById('open-dash').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Current tab, needed for the per-site grant. */
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function renderDetection() {
  detectArea.innerHTML = '<button class="primary" id="detect-btn" style="width:100%;justify-content:center">Check this page</button>';

  document.getElementById('detect-btn').addEventListener('click', async () => {
    detectArea.innerHTML = '<div class="hint">Scanning…</div>';
    const res = await chrome.runtime.sendMessage({ type: 'detect-active' }).catch(() => null);

    if (!res?.ok) {
      detectArea.innerHTML = `<div class="hint">Can't scan this page (${esc(res?.reason ?? 'unknown')}). Chrome blocks extension access on browser and store pages.</div>`;
      return;
    }

    const a = res.analysis;
    const entry = a?.entry;
    const name = entry?.name ?? a?.hostname ?? 'This page';
    const badge = a?.phase === 'post-signup' ? 'just signed up' : a?.days ? `${a.days.days}-day trial` : 'no trial signals';

    detectArea.innerHTML = `
      <div class="card" data-band="${a?.days || a?.phase === 'post-signup' ? 'safe' : 'past_due'}" style="padding:11px 12px;gap:7px">
        <div class="card-head">
          <span class="card-name" style="font-size:14px">${esc(name)}</span>
          <span class="pill ${a?.days ? 'ok' : ''}">${esc(badge)}</span>
        </div>
        <div class="meta" style="font-size:12px">${esc(a?.note ?? '')}</div>
        <div class="meta" style="font-size:12px">${entry ? 'Cancel link on file' : 'Not in the directory yet'}</div>
        <div class="actions" style="margin-top:2px">
          <button class="primary" id="track-btn" style="font-size:12px;padding:5px 9px">Log this trial</button>
          ${entry ? '' : '<button class="ghost" id="always-btn" style="font-size:12px;padding:5px 9px">Always detect here</button>'}
        </div>
      </div>`;

    document.getElementById('track-btn')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'open-dashboard',
        seed: {
          serviceId: entry?.serviceId ?? null,
          region: entry?.region ?? null,
          serviceName: name,
          amount: a?.price?.amount ?? null,
          currency: a?.price?.currency ?? null,
          trialLengthDays: a?.days?.days ?? null,
          renewsAt: a?.renewsAt ?? null,
          note: a?.note ?? null,
        },
      });
      window.close();
    });

    document.getElementById('always-btn')?.addEventListener('click', async () => {
      const tab = await activeTab();
      if (!tab?.url) return;
      const origin = new URL(tab.url).origin;
      // permissions.request must run inside this click handler to keep the
      // user-gesture flag; that is why it lives here and not in the worker.
      const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
      if (!granted) return;
      await chrome.runtime.sendMessage({ type: 'register-site', origin });
      detectArea.insertAdjacentHTML(
        'beforeend',
        '<div class="hint">Auto-detect is on for this site. Reload the page to see it.</div>',
      );
    });
  });
}

const got = await chrome.storage.local.get(['trials']);
const trials = Array.isArray(got.trials) ? got.trials : [];
const now = new Date();
const list = sortedForDisplay(trials, now).filter((t) => derivedStatus(t, now) !== 'confirmed_cancelled');

if (!list.length) {
  mini.innerHTML =
    '<div class="empty" style="padding:16px 12px;font-size:13px">No active trials.<br />Log one below, or on a checkout page.</div>';
} else {
  mini.innerHTML = `<div class="cards">${list
    .slice(0, 3)
    .map((t) => {
      const band = urgency(t.renewsAt, now);
      return `<div class="card" data-band="${band}" style="padding:9px 11px;gap:4px">
        <div class="card-head">
          <span class="card-name" style="font-size:14px">${esc(t.serviceName)}</span>
          <span class="count ${band === 'critical' ? 'crit' : band === 'soon' ? 'soon' : ''}" style="font-size:13px">${formatCountdown(msUntil(t.renewsAt, now))}</span>
        </div>
        <div class="meta" style="font-size:12px">${formatMoney(t.amount, t.currency)} renews</div>
      </div>`;
    })
    .join('')}</div>`;
}

renderDetection();
