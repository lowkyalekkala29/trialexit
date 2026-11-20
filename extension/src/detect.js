/**
 * Checkout-page detector (classic content script — cannot import modules, so it
 * only scrapes text and asks the background worker to do the parsing).
 *
 * Nothing is saved here. It offers a suggestion; the user confirms in the
 * dashboard, where the guessed values are visible and editable.
 */

const TEXT_LIMIT = 20_000;
const SEEN_KEY = 'trialexit:hinted';

function pageSnapshot() {
  return {
    text: (document.body?.innerText ?? '').slice(0, TEXT_LIMIT),
    url: location.href,
    title: document.title,
    hostname: location.hostname,
  };
}

function alreadyHinted() {
  try {
    return sessionStorage.getItem(SEEN_KEY) === location.pathname;
  } catch {
    return false;
  }
}

function markHinted() {
  try {
    sessionStorage.setItem(SEEN_KEY, location.pathname);
  } catch {
    /* storage may be unavailable; showing twice is harmless */
  }
}

function announce(analysis) {
  const entry = analysis.entry;
  const name = entry?.name ?? analysis.hostname;
  const label =
    analysis.phase === 'post-signup'
      ? `Trial started at ${name}?`
      : analysis.days
        ? `${name}: ${analysis.days.days}-day trial`
        : `${name} trial page`;

  const bar = document.createElement('div');
  bar.id = 'trialexit-hint';
  bar.setAttribute(
    'style',
    [
      'position:fixed', 'z-index:2147483647', 'right:16px', 'bottom:16px',
      'max-width:330px', 'padding:12px 14px', 'border-radius:12px',
      'background:#12231c', 'color:#eef7f2', 'font:13px/1.45 system-ui,sans-serif',
      'box-shadow:0 8px 28px rgba(0,0,0,.32)', 'display:grid', 'gap:8px',
      'border:1px solid #26382f',
    ].join(';'),
  );

  const title = document.createElement('div');
  title.textContent = label;
  title.style.fontWeight = '600';

  const note = document.createElement('div');
  note.textContent = analysis.note;
  note.style.color = '#93a89c';

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '8px';

  const track = document.createElement('button');
  track.textContent = 'Track it';
  track.setAttribute(
    'style',
    'all:unset;cursor:pointer;background:#2fbf71;color:#062015;padding:6px 11px;border-radius:8px;font-weight:650',
  );
  track.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'open-dashboard',
      seed: {
        serviceId: entry?.serviceId ?? null,
        region: entry?.region ?? null,
        serviceName: name,
        amount: analysis.price?.amount ?? null,
        currency: analysis.price?.currency ?? null,
        trialLengthDays: analysis.days?.days ?? null,
        renewsAt: analysis.renewsAt ?? null,
        note: analysis.note,
      },
    });
    bar.remove();
  });

  const dismiss = document.createElement('button');
  dismiss.textContent = 'Not now';
  dismiss.setAttribute(
    'style',
    'all:unset;cursor:pointer;color:#93a89c;padding:6px 4px;font-size:12px',
  );
  dismiss.addEventListener('click', () => {
    markHinted();
    bar.remove();
  });

  row.append(track, dismiss);
  bar.append(title, note, row);
  document.body.append(bar);
}

if (!alreadyHinted()) {
  chrome.runtime.sendMessage({ type: 'analyze-page', page: pageSnapshot() }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) return;
    const analysis = res.analysis;
    if (!analysis) return;
    // Only speak up when we actually learned something.
    if (analysis.phase === 'unknown' && !analysis.entry && !analysis.days) return;
    announce(analysis);
  });
}
