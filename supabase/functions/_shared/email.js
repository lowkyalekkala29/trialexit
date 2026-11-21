/**
 * Reminder email template (plain HTML tables so it renders in Gmail/Outlook).
 * Pure: (data) → { subject, html, text }.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const URGENT = new Set(['final', 'urgent', 'lastcall', 'immediate']);

/**
 * @param {{ name?: string|null, kind: string, title: string, service: string, amount: string|null,
 *   renews: string, cancelUrl: string|null, steps: string[], requiresChat: boolean,
 *   cancelledLink: string, keptLink: string, chargedLink: string, appUrl: string }} d
 */
export function reminderEmail(d) {
  const checkin = d.kind === 'checkin';
  const subject = checkin ? `Did ${d.service} renew?` : URGENT.has(d.kind) ? `⏰ ${d.title}` : d.title;
  const color = URGENT.has(d.kind) ? '#dc2626' : '#16a34a';
  const lead = checkin
    ? `Your ${esc(d.service)} trial was due to renew on <b>${esc(d.renews)}</b>. Tell us what happened so nothing slips into a subscription you didn't want.`
    : `${d.amount ? `<b>${esc(d.amount)}</b> will be charged` : 'Your trial converts to a paid plan'} on <b>${esc(d.renews)}</b> unless you cancel.`;
  const btn = (href, label, primary) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:4px 6px 4px 0;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;${
      primary ? `background:${color};color:#ffffff` : 'background:#ffffff;color:#111827;border:1px solid #d0d5db'
    }">${esc(label)}</a>`;
  const steps = d.steps.length
    ? `<p style="margin:18px 0 6px;font-weight:600">How to cancel</p><ol style="margin:0;padding-left:20px;color:#374151">${d.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e7eb;border-radius:16px">
<tr><td style="padding:24px 24px 8px"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:7px;background:#16a34a;color:#fff;font-weight:800">✓</span>
<span style="font-weight:700;margin-left:8px;vertical-align:middle">TrialExit</span></td></tr>
<tr><td style="padding:8px 24px 24px;font-size:15px;line-height:1.55">
<h1 style="font-size:20px;margin:8px 0 10px;color:${URGENT.has(d.kind) ? '#dc2626' : '#111827'}">${esc(d.title)}</h1>
<p style="margin:0 0 16px">${d.name ? `Hi ${esc(d.name)}, ` : ''}${lead}</p>
${d.requiresChat && !checkin ? '<p style="margin:0 0 14px;padding:10px 12px;background:#fff7ed;border-radius:10px;color:#9a3412">Heads up: this service usually needs support chat to cancel — allow a few extra minutes.</p>' : ''}
${!checkin && d.cancelUrl ? btn(d.cancelUrl, `Cancel ${d.service} now →`, true) : ''}
<div style="margin-top:8px">${btn(d.cancelledLink, checkin ? 'I cancelled in time' : 'I already cancelled', checkin)}${btn(d.keptLink, "I'm keeping it", false)}${checkin ? btn(d.chargedLink, 'I got charged', false) : ''}</div>
${checkin ? '' : steps}
<p style="margin:22px 0 0;color:#6b7280;font-size:13px">One click updates TrialExit — no sign-in needed. <a href="${esc(d.appUrl)}/app/" style="color:#16a34a">Open your trials</a> · <a href="${esc(d.appUrl)}/app/#/settings/notifications" style="color:#6b7280">Reminder settings</a></p>
</td></tr></table></td></tr></table></body></html>`;
  const text = [
    d.title,
    '',
    checkin ? `Your ${d.service} trial was due to renew on ${d.renews}. Did it renew?` : `${d.amount ? `${d.amount} will be charged` : 'Your trial converts to paid'} on ${d.renews} unless you cancel.`,
    !checkin && d.cancelUrl ? `Cancel now: ${d.cancelUrl}` : '',
    `I cancelled: ${d.cancelledLink}`,
    `I'm keeping it: ${d.keptLink}`,
    checkin ? `I got charged: ${d.chargedLink}` : '',
    '',
    `Your trials: ${d.appUrl}/app/`,
  ]
    .filter((l) => l !== '')
    .join('\n');
  return { subject, html, text };
}
