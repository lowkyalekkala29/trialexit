import { derivedStatus, sortedForDisplay } from './core/store.js';
import { urgency, msUntil, formatCountdown, formatMoney, HOUR } from './core/dates.js';
import { logoHtml } from './brand.js';

const mini = document.getElementById('mini');
const detectArea = document.getElementById('detect-area');

document.getElementById('scan-gmail').addEventListener('click', async () => {
  const { settings } = await chrome.storage.local.get('settings');
  if (Object.values(settings?.mailConnected ?? {}).some(Boolean)) {
    chrome.runtime.sendMessage({ type: 'mail-rescan' });
  }
  chrome.runtime.openOptionsPage();
  window.close();
});

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
  detectArea.innerHTML = '<button class="primary" id="detect-btn" style="width:100%">Track a trial on this page</button>';

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
      <div class="card" style="padding:11px 12px;gap:7px">
        <div class="card-head">
          <span class="card-name" style="font-size:14px">${esc(name)}</span>
          <span class="pill ${a?.days ? 'ok' : ''}">${esc(badge)}</span>
        </div>
        <div class="meta" style="font-size:12px">${esc(a?.note ?? '')}</div>
        <div class="meta" style="font-size:12px">${entry ? 'Cancel link on file' : 'Not in the directory yet'}</div>
        <div class="actions" style="margin-top:2px">
          <button class="primary sm" id="track-btn">Track this trial</button>
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

  });
}

const got = await chrome.storage.local.get(['trials']);
const trials = Array.isArray(got.trials) ? got.trials : [];
const now = new Date();
const open = sortedForDisplay(trials, now).filter((t) => {
  const st = derivedStatus(t, now);
  return st === 'active' || st === 'awaiting_confirmation' || (st === 'charged' && t.status !== 'charged');
});

if (!open.length) {
  mini.innerHTML =
    '<div class="empty" style="padding:16px 12px;font-size:13px">No trials tracked yet.<br />Track one on this page, or let us find them in your email.</div>';
} else {
  const urgent = open.filter((t) => msUntil(t.renewsAt, now) <= 48 * HOUR).length;
  mini.innerHTML = `<div class="section-head" style="margin-bottom:8px"><h2>${urgent ? 'Needs attention' : 'Next up'}</h2><span class="n">${open.length} open</span></div>
  <div class="cards">${open
    .slice(0, 4)
    .map((t) => {
      const band = urgency(t.renewsAt, now);
      const passed = msUntil(t.renewsAt, now) <= 0;
      return `<div class="card" data-band="${band}">
        <div class="card-head">
          ${logoHtml(t.serviceId, t.serviceName, 'sm')}
          <div style="display:grid;min-width:0"><span class="card-name">${esc(t.serviceName)}</span>
          <span class="meta" style="font-size:12px">${t.amount ? `${formatMoney(t.amount, t.currency)} renews` : 'renews'}</span></div>
          <span class="count ${passed || band === 'critical' ? 'crit' : band === 'soon' ? 'soon' : ''}">${passed ? 'Renewed?' : formatCountdown(msUntil(t.renewsAt, now))}</span>
        </div>
      </div>`;
    })
    .join('')}</div>`;
}

renderDetection();
