/**
 * Gmail trial detector (classic content script on mail.google.com).
 *
 * Why the inbox: every trial — started on desktop, iPhone, Android, an app
 * store or inside an app — sends a confirmation email. The inbox is the one
 * place that sees all of them.
 *
 * Privacy: runs only on mail.google.com, reads only the email the user has
 * OPEN (or the subject/snippet rows of a search the user started), parses on
 * device via the extension's own worker, and transmits nothing.
 */
(() => {
  const TRIAL_SIGNAL = new RegExp(
    [
      'free\\s+trial', '\\btrial\\b', 'days?\\s+free', 'first\\s+month\\s+free',
      'subscription\\s+(?:has\\s+been\\s+)?(?:confirmation|confirmed|activated|started|is\\s+active)', 'thanks?\\s+(?:you\\s+)?for\\s+subscribing',
      'membership\\s+(?:has\\s+been\\s+)?(?:confirmation|confirmed|activated|is\\s+active)', 'welcome\\s+to\\s+(?:[\\w.+-]+\\s+){0,2}(?:premium|plus|pro|prime)',
      "you(?:'|’)?ll\\s+be\\s+charged", 'will\\s+(?:be\\s+)?(?:automatically\\s+)?(?:renew|charged|billed)', 'auto[-\\s]?renew',
      'renews?\\s+on', 'next\\s+(?:billing|payment)', 'first\\s+payment', 'payment\\s+method\\s+added',
      'auto\\s?pay', 'e-?mandate', 'mandate\\s+(?:registered|created|approved)', 'standing\\s+instruction', 'auto[-\\s]?debit',
      'order\\s+receipt',
    ].join('|'),
    'i',
  );
  const SEEN = new Set();
  let panel = null;

  function shadowHost(id) {
    document.getElementById(id)?.remove();
    const host = document.createElement('div');
    host.id = id;
    host.style.cssText = 'position:fixed;z-index:2147483647;right:20px;bottom:20px;';
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      .box{width:330px;background:#fff;color:#111827;border:1px solid #e4e7eb;border-radius:14px;
        box-shadow:0 12px 40px rgba(17,24,39,.18);font:13px/1.45 -apple-system,'Segoe UI',system-ui,sans-serif;padding:14px;display:grid;gap:9px}
      .hd{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px}
      .mk{width:22px;height:22px;border-radius:6px;background:#16a34a;color:#fff;display:grid;place-items:center;font-size:12px}
      .x{margin-left:auto;cursor:pointer;color:#9ca3af;border:0;background:none;font-size:16px}
      .muted{color:#6b7280}
      .row{display:flex;gap:8px;flex-wrap:wrap}
      button.b{all:unset;cursor:pointer;padding:7px 12px;border-radius:9px;font-weight:600;border:1px solid #d0d5db}
      button.p{background:#16a34a;color:#fff;border-color:#16a34a}
      ul{list-style:none;margin:0;padding:0;display:grid;gap:6px;max-height:320px;overflow:auto}
      li{border:1px solid #e4e7eb;border-radius:10px;padding:8px 10px;cursor:pointer}
      li:hover{background:#f6f7f9}
      li b{display:block;font-size:13px}
      label{display:grid;gap:3px;font-size:11px;color:#6b7280;font-weight:600}
      input{font:inherit;border:1px solid #d0d5db;border-radius:8px;padding:6px 8px;color:#111827}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    </style><div class="box"></div>`;
    return { host, box: /** @type {HTMLElement} */ (root.querySelector('.box')) };
  }

  function header(box, title, host) {
    const hd = document.createElement('div');
    hd.className = 'hd';
    hd.innerHTML = '<span class="mk">✓</span><span></span><button class="x" title="Dismiss">×</button>';
    hd.querySelector('span:nth-child(2)').textContent = title;
    hd.querySelector('.x').addEventListener('click', () => host.remove());
    box.append(hd);
  }

  /* ---------- open email → offer to track ---------- */

  function openEmail() {
    const bodies = [...document.querySelectorAll('div.a3s')].filter((el) => el.offsetParent !== null);
    if (!bodies.length) return null;
    const subject = document.querySelector('h2.hP')?.textContent?.trim() ?? '';
    const sender = document.querySelector('.gD')?.getAttribute('email') ?? '';
    const body = bodies.map((b) => b.innerText).join('\n').slice(0, 20000);
    const key = `${subject}|${body.length}`;
    return { subject, sender, text: `${subject}\n${sender}\n${body}`, key };
  }

  function offerTrack(mail, r) {
    const { host, box } = shadowHost('trialexit-gmail');
    header(box, 'Looks like a free trial', host);
    const today = new Date().toISOString().slice(0, 10);
    const renew = r.renewsOn ?? new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const form = document.createElement('div');
    form.className = 'grid';
    form.innerHTML = `
      <label style="grid-column:1/-1">Service<input name="name"></label>
      <label>Ends / renews on<input name="date" type="date" min="${today}"></label>
      <label>Amount<input name="amount" type="number" min="0" step="0.01" placeholder="optional"></label>`;
    /** @type {HTMLInputElement} */ (form.querySelector('[name=name]')).value =
      r.serviceName ?? (mail.sender.split('@')[1]?.split('.').slice(-2, -1)[0] ?? '');
    /** @type {HTMLInputElement} */ (form.querySelector('[name=date]')).value = renew;
    if (r.price) /** @type {HTMLInputElement} */ (form.querySelector('[name=amount]')).value = String(r.price.amount);
    const note = document.createElement('div');
    note.className = 'muted';
    note.textContent = r.renewalMatched
      ? `Read "${r.renewalMatched}" from this email. Check it, then track.`
      : r.renewsOn
        ? `No end date in the email — guessed from the ${r.days?.days}-day trial. Check it.`
        : 'No end date found — set it, then track.';
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<button class="b p">Track this trial</button><button class="b">Not a trial</button>';
    const [track, no] = row.querySelectorAll('button');
    no.addEventListener('click', () => host.remove());
    track.addEventListener('click', () => {
      const get = (n) => /** @type {HTMLInputElement} */ (form.querySelector(`[name=${n}]`)).value;
      chrome.runtime.sendMessage(
        {
          type: 'add-trial',
          trial: {
            serviceId: r.entry?.serviceId ?? null,
            region: r.entry?.region ?? null,
            serviceName: get('name').trim(),
            renewsOn: get('date'),
            amount: Number(get('amount')) || 0,
            currency: r.price?.currency ?? null,
            trialLengthDays: r.days?.days ?? null,
            source: 'gmail',
          },
        },
        (res) => {
          box.innerHTML = '';
          header(box, res?.ok ? (res.duplicate ? 'Already tracked' : 'Tracked') : 'Could not save', host);
          const m = document.createElement('div');
          m.className = 'muted';
          m.textContent = res?.ok
            ? "We'll nudge you 2 days, 1 day, 6 hours and 1 hour before it charges."
            : String(res?.reason ?? 'Unknown error');
          box.append(m);
          setTimeout(() => host.remove(), 4000);
        },
      );
    });
    box.append(form, note, row);
  }

  function checkOpenEmail() {
    const mail = openEmail();
    if (!mail || SEEN.has(mail.key)) return;
    SEEN.add(mail.key);
    if (!TRIAL_SIGNAL.test(mail.text)) return;
    chrome.runtime.sendMessage({ type: 'analyze-email', text: mail.text }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) return;
      const r = res.result;
      // Need something concrete beyond the keyword to interrupt the user.
      if (!r.entry && !r.renewalMatched && !r.days) return;
      if (res.alreadyTracked) return;
      offerTrack(mail, r);
    });
  }

  /* ---------- search results → list candidates ---------- */

  function listCandidates() {
    if (!/#search\/.*trial/i.test(decodeURIComponent(location.hash))) return;
    const rows = [...document.querySelectorAll('tr.zA')].filter((r) => r.offsetParent !== null);
    if (!rows.length) return;
    const items = rows
      .map((row) => ({
        row,
        from: row.querySelector('.yW [email], .yW .zF, .yW .yP')?.textContent?.trim() ?? '',
        subject: row.querySelector('.bog')?.textContent?.trim() ?? '',
        snippet: row.querySelector('.y2')?.textContent?.replace(/^\s*-\s*/, '').trim() ?? '',
      }))
      .filter((i) => TRIAL_SIGNAL.test(`${i.subject} ${i.snippet}`))
      .slice(0, 25);
    const sig = items.map((i) => i.subject).join('|');
    if (panel === sig) return;
    panel = sig;
    const { host, box } = shadowHost('trialexit-gmail-list');
    header(box, items.length ? `${items.length} possible trial emails` : 'No trial emails found', host);
    const help = document.createElement('div');
    help.className = 'muted';
    help.textContent = items.length
      ? 'Open each one — TrialExit reads it and offers to track the trial.'
      : 'Nothing in the last 60 days. New trial emails will be caught when you open them.';
    box.append(help);
    const ul = document.createElement('ul');
    for (const i of items) {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = i.from;
      const s = document.createElement('span');
      s.className = 'muted';
      s.textContent = i.subject;
      li.append(b, s);
      li.addEventListener('click', () => /** @type {HTMLElement} */ (i.row).click());
      ul.append(li);
    }
    box.append(ul);
  }

  let timer = 0;
  const tick = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        checkOpenEmail();
        listCandidates();
      } catch {
        /* Gmail changed its DOM: fail silent, never break the inbox */
      }
    }, 600);
  };
  new MutationObserver(tick).observe(document.body, { childList: true, subtree: true });
  addEventListener('hashchange', () => {
    panel = null;
    tick();
  });
  tick();
})();
