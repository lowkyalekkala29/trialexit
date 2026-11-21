# Chrome Web Store submission — copy/paste sheet

Developer dashboard: https://chrome.google.com/webstore/devconsole (one-time $5 registration fee).
Upload: `dist/trialexit-<version>.zip` from `npm run package`.

## Store listing tab

**Name:** TrialExit

**Summary (≤132 chars):**
Stop losing money to forgotten trials and subscriptions. Warned before every charge, with a one-click cancel link. Offers too.

**Category:** Productivity  **Language:** English

**Description:**
```
Free trials are built to be forgotten, and subscriptions renew while you're not looking. TrialExit protects you from losing money to either one.

ONE DASHBOARD, FOUR LISTS
• Trials: every free trial you started, with a countdown to the charge
• Subscriptions: what you pay each month and year, and a reminder 3 days and 1 day before each renewal
• Cancelled: "money protected", every charge you avoided, counted honestly
• Offers: discounts and deals from services in your inbox, with when they expire

TrialExit fixes the part a calendar reminder doesn't: when the alert fires, one click opens the service's actual cancellation page — not the homepage, not a help article.

HOW IT WORKS
• Catch every trial: connect Gmail (read-only) and TrialExit finds trial, subscription, cancellation and offer emails — including trials started on your phone or in app stores. It also spots trials on checkout pages as you sign up.
• Get nudged as the charge gets closer: 2 days, 1 day, 6 hours and 1 hour before (plus a 5-day heads-up on long trials), and a morning digest of what renews this week.
• Click the notification → the exact cancel page opens. Afterwards, TrialExit asks "Did it renew?" so every trial ends as cancelled, kept or charged — nothing slips through.

WHAT'S INSIDE
• Countdown cards coloured by urgency, and a toolbar badge when a charge is under 48 hours away
• Direct cancel links and step-by-step instructions for Netflix, Spotify, YouTube Premium, ChatGPT Plus, Adobe, Disney+ Hotstar, Prime Video, LinkedIn Premium, Claude, Canva and more
• "Add to calendar" export so the reminder reaches your phone too
• Warnings when a service only lets you cancel through support chat
• An honest "saved" total — only counts trials you confirmed cancelling before the charge

PRIVATE BY DESIGN
• No account. No bank or card connection. No analytics.
• Your trials are stored only in your browser.
• Email access is optional and read-only. Emails are read on your device and never uploaded — there is no TrialExit server.
• Checkout detection works on every site, entirely on your device. Ordinary pages are skipped after a quick local check; turn it off or mute any site any time.

Free during launch.
```

**Screenshots (1280×800):** `store/screenshot-1-found-in-email.png`, `store/screenshot-2-onboarding.png`, `store/screenshot-3-dashboard.png`, `store/screenshot-4-popup.png`
**Small promo tile (440×280):** `store/promo-tile-440x280.png`
**Icon:** `extension/icons/icon-128.png`

**Homepage URL:** your deployed site (e.g. https://trialexit.vercel.app)
**Support URL:** https://github.com/lowkyalekkala29/trialexit/issues

## Privacy practices tab

**Single purpose:**
Help users remember to cancel free trials before they renew, by tracking renewal dates and opening the service's cancellation page when a reminder fires.

**Permission justifications:**

| Permission | Justification to paste |
|---|---|
| storage | Saves the user's tracked trials (service name, renewal date, amount) locally on the device. Nothing is synced to a server. |
| alarms | Schedules the reminder that fires 48 hours / 24 hours before a trial renews. |
| notifications | Shows the renewal reminder. Clicking it opens that service's cancellation page. |
| activeTab | Lets the user press "Track a trial on this page" on a tab that was open before the extension was installed. |
| scripting | Injects the trial-detection function into the active tab only after the user clicks "Check this page", and registers the detector on a single site only when the user presses "Always detect here" and grants that site. |
| identity | Lets the user sign in to Google when they press "Connect Gmail", to grant read-only mailbox access (gmail.readonly) used to find trial confirmation emails. |
| Host permission: gmail.googleapis.com, oauth2.googleapis.com | After the user connects Gmail, searches their mailbox (read-only) for free-trial confirmation emails; oauth2.googleapis.com is used only to revoke the token on disconnect. Email content is processed on the device and never transmitted elsewhere. |
| Content script on mail.google.com | Reads only the email the user currently has open, to offer "Track this trial" when it is a trial confirmation. Processed on-device; nothing is transmitted. |
| Host permission: raw.githubusercontent.com | Downloads the public JSON list of cancellation links (no user data is sent) so broken links can be fixed without an extension update. |
| Host permissions + content script on all http(s) sites | The extension's single purpose is catching free trials when the user starts them, and trials are sold on thousands of different sites, so a fixed list cannot work. On each page the script checks locally for trial/checkout wording and payment forms; ordinary pages are left alone after that check. Only trial checkout and "trial started" pages are parsed, on-device, to prefill the service, end date and price for the user to confirm. No page content is transmitted or stored. Users can switch detection off or mute any site. |

**Remote code:** No, I am not using remote code. (The downloaded directory is JSON data, never executed.)

**Data usage:** tick **"Personal communications"** (emails are read, on-device, when the user connects a mailbox), **"Website content"** (checkout pages). Leave **"Web history"** unticked: pages are checked on-device and no browsing history is stored. Nothing is transmitted to the developer; say so in the justification. Then tick all three certifications (no selling, no unrelated use, no creditworthiness use).

**Privacy policy URL:** https://github.com/lowkyalekkala29/trialexit/blob/main/PRIVACY.md

## Distribution
Visibility: Public · Regions: All · Free.

## Review tips
- Broad host permissions (all sites) + email scopes trigger an in-depth review: plan for 3–7 days, sometimes more. The justification above is what reviewers read — keep it.
- Bump `version` in `extension/manifest.json` for every re-upload.
