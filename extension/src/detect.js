/**
 * Checkout-page detector.
 *
 * Runs as a classic (non-module) content script, so it cannot import the
 * directory — it asks the background worker instead. It only ever signals
 * "this page looks like a trial signup for service X"; nothing is saved until
 * the user confirms. No page content leaves the device.
 */

const TRIAL_SIGNALS = [
  /\bfree trial\b/i,
  /\b\d+\s*-?\s*day(?:s)?\s+free\b/i,
  /\btry (?:it )?free\b/i,
  /\bstart (?:your )?free\b/i,
  /\bauto-?renew/i,
  /\bthen \s*(?:₹|rs\.?|\$|usd)\s*[\d,]+/i,
];

/** Should this page show the "log this trial" affordance? */
function looksLikeTrialPage() {
  const text = (document.body?.innerText ?? '').slice(0, 20_000);
  return TRIAL_SIGNALS.some((re) => re.test(text));
}

/** Best-effort monthly price on the page, in major units. */
function guessPrice() {
  const text = (document.body?.innerText ?? '').slice(0, 20_000);
  const m = /(?:₹|rs\.?|\$)\s?([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function announce(entry) {
  if (!entry) return;
  const bar = document.createElement('div');
  bar.id = 'trialexit-hint';
  bar.setAttribute(
    'style',
    [
      'position:fixed', 'z-index:2147483647', 'right:16px', 'bottom:16px',
      'max-width:320px', 'padding:12px 14px', 'border-radius:12px',
      'background:#12231c', 'color:#eef7f2', 'font:14px/1.4 system-ui,sans-serif',
      'box-shadow:0 8px 28px rgba(0,0,0,.28)', 'display:flex', 'gap:10px', 'align-items:center',
    ].join(';'),
  );
  const label = document.createElement('span');
  label.textContent = `${entry.name} trial detected`;
  const btn = document.createElement('button');
  btn.textContent = 'Track it';
  btn.setAttribute(
    'style',
    'all:unset;cursor:pointer;background:#2fbf71;color:#062015;padding:6px 10px;border-radius:8px;font-weight:600',
  );
  btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'open-dashboard',
      seed: {
        serviceId: entry.serviceId,
        region: entry.region,
        serviceName: entry.name,
        amount: guessPrice(),
      },
    });
    bar.remove();
  });
  bar.append(label, btn);
  document.body.append(bar);
}

if (looksLikeTrialPage()) {
  chrome.runtime.sendMessage(
    { type: 'detect-service', hostname: location.hostname },
    (res) => {
      if (chrome.runtime.lastError) return;
      if (res?.entry) announce(res.entry);
    },
  );
}
