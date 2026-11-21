/**
 * Trial activation detector — runs on every http(s) page.
 *
 * Cost and privacy rules:
 *  - On an ordinary page it does one regex over the URL and the first part of
 *    the visible text, finds nothing, and stops. No text leaves the tab.
 *  - Only pages with trial/checkout/success wording (or a tab where the user
 *    just submitted a trial checkout) are handed to the extension's own worker
 *    for parsing. Nothing is ever sent off the device.
 *  - It never saves anything on its own: the user confirms every trial.
 */
(() => {
  if (window.top !== window || !document.documentElement) return;

  const TEXT_LIMIT = 30_000;
  const PREFILTER =
    /free\s+trial|\btrial\b|days?\s+free|first\s+(?:month|week)\s+free|cancel\s+any\s?time|won(?:'|’)?t\s+be\s+charged|subscri(?:be|ption)|you(?:'|’)?re\s+all\s+set|payment\s+(?:successful|confirmed)|welcome\s+to/i;
  const PREFILTER_URL =
    /checkout|subscri|signup|sign-up|register|trial|billing|payment|pricing|plans?\b|upgrade|premium|welcome|success|thank|confirm|onboarding/i;
  const PAYMENT_FORM = [
    'input[autocomplete^="cc-"]',
    'input[name*="cardnumber" i]',
    'input[name*="card_number" i]',
    'input[id*="card-number" i]',
    'input[placeholder*="card number" i]',
    'input[name*="upi" i]',
    'iframe[name^="__privateStripeFrame"]',
    'iframe[src*="js.stripe.com"]',
    'iframe[src*="checkout.stripe.com"]',
    'iframe[src*="razorpay"]',
    'iframe[src*="braintree"]',
    'iframe[src*="adyen"]',
    'iframe[src*="paypal"]',
    'iframe[src*="paddle"]',
    'iframe[src*="chargebee"]',
    'iframe[src*="recurly"]',
    'iframe[src*="checkout.com"]',
    'iframe[src*="payu"]',
    'iframe[src*="cashfree"]',
    'iframe[src*="google.com/payments"]',
  ].join(',');
  const SUBMIT_TEXT =
    /start|try|trial|subscribe|continue|pay|confirm|upgrade|buy|place\s+order|join|get\s+(?:started|premium|pro|plus)|activate|claim|redeem|agree/i;

  let lastUrl = '';
  let scanning = false;
  let watchingSubmit = false;
  let shown = false;

  function visibleText() {
    return (document.body?.innerText ?? '').slice(0, TEXT_LIMIT);
  }

  function siteName() {
    const meta =
      document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ||
      document.querySelector('meta[name="application-name"]')?.getAttribute('content');
    if (meta && meta.length < 40) return meta.trim();
    const host = location.hostname.replace(/^www\./, '');
    const titleName = () => (document.title.split(/\s[|\-–—:·]\s/)[0] || host).trim().slice(0, 40);
    // IP addresses and single-label hosts carry no brand; the title does.
    if (/^[\d.]+$|^\[|^localhost$/.test(host) || !host.includes('.')) return titleName();
    const parts = host.split('.');
    const label = parts.length > 2 && parts.at(-2).length <= 3 ? parts.at(-3) : parts.at(-2);
    return label ? label[0].toUpperCase() + label.slice(1) : titleName();
  }

  function scan() {
    if (scanning || shown) return;
    scanning = true;
    const text = visibleText();
    const interesting = PREFILTER.test(text) || PREFILTER_URL.test(location.pathname + location.search);
    const paymentForm = interesting && Boolean(document.querySelector(PAYMENT_FORM));
    chrome.runtime.sendMessage(
      {
        type: 'page-scan',
        page: {
          url: location.href,
          hostname: location.hostname,
          title: document.title,
          // Ordinary pages send no text at all.
          text: interesting ? text : '',
          siteName: interesting ? siteName() : '',
          paymentForm,
        },
      },
      (res) => {
        scanning = false;
        if (chrome.runtime.lastError || !res) return;
        if (res.checkout) watchSubmit();
        if (res.show) offer(res);
      },
    );
  }

  /** On a trial checkout: remember when the user presses the button that starts it. */
  function watchSubmit() {
    if (watchingSubmit) return;
    watchingSubmit = true;
    const report = () => chrome.runtime.sendMessage({ type: 'checkout-submitted', url: location.href }).catch?.(() => {});
    document.addEventListener(
      'click',
      (e) => {
        const el = /** @type {HTMLElement} */ (e.target)?.closest?.('button, [role="button"], input[type="submit"], a');
        if (!el) return;
        const label = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''} ${/** @type {HTMLInputElement} */ (el).value ?? ''}`;
        if (SUBMIT_TEXT.test(label)) report();
      },
      true,
    );
    document.addEventListener('submit', report, true);
  }

  /* ------------------------------------------------------------------ UI */

  function offer(res) {
    if (shown) return;
    shown = true;
    const a = res.analysis ?? {};
    const name = a.entry?.name ?? a.siteName ?? location.hostname;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483647;right:20px;bottom:20px;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      .box{width:336px;background:#fff;color:#111827;border:1px solid #e4e7eb;border-radius:14px;
        box-shadow:0 12px 40px rgba(17,24,39,.18);font:13px/1.45 -apple-system,'Segoe UI',system-ui,sans-serif;padding:14px;display:grid;gap:10px}
      .hd{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px}
      .mk{width:22px;height:22px;border-radius:6px;background:#16a34a;color:#fff;display:grid;place-items:center;font-size:12px;flex-shrink:0}
      .x{all:unset;margin-left:auto;cursor:pointer;color:#9ca3af;font-size:18px;line-height:1}
      .muted{color:#6b7280}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      label{display:grid;gap:3px;font-size:11px;color:#6b7280;font-weight:600}
      input{font:inherit;border:1px solid #d0d5db;border-radius:8px;padding:6px 8px;color:#111827;background:#fff;min-width:0}
      .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
      button.b{all:unset;cursor:pointer;padding:7px 12px;border-radius:9px;font-weight:600;border:1px solid #d0d5db;color:#111827}
      button.p{background:#16a34a;color:#fff;border-color:#16a34a}
      button.l{border-color:transparent;color:#6b7280;padding:7px 6px;font-weight:500}
    </style>
    <div class="box">
      <div class="hd"><span class="mk">✓</span><span class="t"></span><button class="x" title="Dismiss">×</button></div>
      <div class="grid">
        <label style="grid-column:1/-1">Service<input name="name"></label>
        <label>Trial ends on<input name="date" type="date"></label>
        <label>Then charges<input name="amount" type="number" min="0" step="0.01" placeholder="optional"></label>
      </div>
      <div class="muted note"></div>
      <div class="row"><button class="b p track">Track this trial</button><button class="b l later">Not a trial</button><button class="b l mute">Never on this site</button></div>
    </div>`;
    const $ = (s) => /** @type {HTMLElement} */ (root.querySelector(s));
    $('.t').textContent = res.confidence === 'high' ? `Trial started at ${name}?` : `Did you start a trial at ${name}?`;
    const today = new Date();
    const renewsAt = a.renewsAt ? new Date(a.renewsAt) : new Date(today.getTime() + 7 * 864e5);
    const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    /** @type {HTMLInputElement} */ ($('[name=name]')).value = name;
    /** @type {HTMLInputElement} */ ($('[name=date]')).value = iso(renewsAt);
    /** @type {HTMLInputElement} */ ($('[name=date]')).min = iso(today);
    if (a.price?.amount) /** @type {HTMLInputElement} */ ($('[name=amount]')).value = String(a.price.amount);
    $('.note').textContent = a.days
      ? `We read a ${a.days.days}-day trial${a.price ? ` and ${a.price.currency === 'USD' ? '$' : '₹'}${a.price.amount}` : ''}. Check the date — we'll nudge you before it charges.`
      : "We couldn't read the trial length — check the end date. We'll nudge you before it charges.";

    const close = () => host.remove();
    $('.x').addEventListener('click', close);
    $('.later').addEventListener('click', close);
    $('.mute').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'mute-site', hostname: location.hostname });
      close();
    });
    $('.track').addEventListener('click', () => {
      const v = (n) => /** @type {HTMLInputElement} */ ($(`[name=${n}]`)).value;
      chrome.runtime.sendMessage(
        {
          type: 'add-trial',
          trial: {
            serviceId: a.entry?.serviceId ?? null,
            region: a.entry?.region ?? null,
            serviceName: v('name').trim(),
            renewsOn: v('date'),
            amount: Number(v('amount')) || 0,
            currency: a.price?.currency ?? null,
            trialLengthDays: a.days?.days ?? null,
            source: 'checkout',
          },
        },
        (r) => {
          const box = $('.box');
          box.replaceChildren();
          const hd = document.createElement('div');
          hd.className = 'hd';
          hd.innerHTML = '<span class="mk">✓</span>';
          const t = document.createElement('span');
          t.textContent = r?.ok ? (r.duplicate ? 'Already tracked' : `Tracking ${v('name')}`) : 'Could not save';
          hd.append(t);
          const m = document.createElement('div');
          m.className = 'muted';
          m.textContent = r?.ok
            ? "We'll nudge you 2 days, 1 day, 6 hours and 1 hour before it charges, with the cancel link."
            : String(r?.reason ?? 'Unknown error');
          box.append(hd, m);
          setTimeout(close, 4500);
        },
      );
    });
    document.documentElement.append(host);
  }

  /* ---------------------------------------------------------- scheduling */

  function onUrlMaybeChanged() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    watchingSubmit = false;
    setTimeout(scan, 700);
    // Checkouts often render the payment form late (SPA, lazy iframes).
    setTimeout(scan, 3000);
  }

  onUrlMaybeChanged();
  // Single-page apps change the URL without a page load.
  setInterval(onUrlMaybeChanged, 1000);
  addEventListener('popstate', onUrlMaybeChanged);
})();
