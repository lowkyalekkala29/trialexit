import { derivedStatus, sortedForDisplay } from './core/store.js';
import { urgency, msUntil, formatCountdown, formatMoney } from './core/dates.js';

const mini = document.getElementById('mini');

document.getElementById('open-dash').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

const got = await chrome.storage.local.get(['trials']);
const trials = Array.isArray(got.trials) ? got.trials : [];
const now = new Date();
const list = sortedForDisplay(trials, now).filter((t) => derivedStatus(t, now) !== 'confirmed_cancelled');

if (!list.length) {
  mini.innerHTML = '<div class="empty" style="padding:18px 12px;font-size:13px">No active trials.<br />Open the dashboard to log one.</div>';
} else {
  mini.innerHTML = `<div class="cards">${list.slice(0, 3).map((t) => {
    const band = urgency(t.renewsAt, now);
    return `<div class="card" data-band="${band}" style="padding:9px 11px;gap:4px">
      <div class="card-head">
        <span class="card-name" style="font-size:14px">${t.serviceName}</span>
        <span class="count ${band === 'critical' ? 'crit' : band === 'soon' ? 'soon' : ''}" style="font-size:13px">${formatCountdown(msUntil(t.renewsAt, now))}</span>
      </div>
      <div class="meta" style="font-size:12px">${formatMoney(t.amount, t.currency)} renews</div>
    </div>`;
  }).join('')}</div>`;
}
