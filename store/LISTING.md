# Chrome Web Store submission — copy/paste sheet

Developer dashboard: https://chrome.google.com/webstore/devconsole (one-time $5 registration fee).
Upload: `dist/trialexit-<version>.zip` from `npm run package`.

## Store listing tab

**Name:** TrialExit

**Summary (≤132 chars):**
Finds the free trials you started (checkout pages + Gmail/Outlook) and nudges you before they charge, with a one-click cancel link.

**Category:** Productivity  **Language:** English

**Description:**
```
Free trials are built to be forgotten. You hand over your card for a 7-day trial, life happens, and the charge lands.

TrialExit fixes the part a calendar reminder doesn't: when the alert fires, one click opens the service's actual cancellation page — not the homepage, not a help article.

HOW IT WORKS
• Catch every trial: connect Gmail or Outlook (read-only) and TrialExit finds trial confirmation emails — including trials started on your phone or in app stores. It also spots trials on checkout pages as you sign up.
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
• No "read all websites" permission. Pages are read only on known checkout sites, or on the tab where you click the icon.

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
| activeTab | When the user clicks the toolbar icon and presses "Check this page", reads the current tab to detect a free-trial offer (trial length and price) so the user doesn't have to type it. |
| scripting | Injects the trial-detection function into the active tab only after the user clicks "Check this page", and registers the detector on a single site only when the user presses "Always detect here" and grants that site. |
| identity | Lets the user sign in to Google or Microsoft when they press "Connect Gmail" / "Connect Outlook", to grant read-only mailbox access used to find trial confirmation emails. |
| Host permission: gmail.googleapis.com, oauth2.googleapis.com | After the user connects Gmail, searches their mailbox (read-only) for free-trial confirmation emails; oauth2.googleapis.com is used only to revoke the token on disconnect. Email content is processed on the device and never transmitted elsewhere. |
| Host permission: graph.microsoft.com | Same as above for Outlook / Microsoft 365 mailboxes, via Microsoft Graph Mail.Read. |
| Content script on mail.google.com | Reads only the email the user currently has open, to offer "Track this trial" when it is a trial confirmation. Processed on-device; nothing is transmitted. |
| Host permission: raw.githubusercontent.com | Downloads the public JSON list of cancellation links (no user data is sent) so broken links can be fixed without an extension update. |
| Optional host permissions (https://*/*, http://*/*) | Never requested at install. Requested for one specific site only when the user presses "Always detect here" on that site, so trial detection works there automatically. Users can revoke it at any time. |
| Content scripts on listed merchant domains | Detects free-trial checkout pages on 10 well-known subscription services and offers to log the trial. Page text is processed on-device and never transmitted. |

**Remote code:** No, I am not using remote code. (The downloaded directory is JSON data, never executed.)

**Data usage:** tick **"Personal communications"** (emails are read, on-device, when the user connects a mailbox) and **"Website content"** (checkout pages). Nothing is transmitted to the developer; say so in the justification. Then tick all three certifications (no selling, no unrelated use, no creditworthiness use).

**Privacy policy URL:** https://github.com/lowkyalekkala29/trialexit/blob/main/PRIVACY.md

## Distribution
Visibility: Public · Regions: All · Free.

## Review tips
- Review usually takes 1–3 days; the optional broad host permission can add time. If it gets rejected over it, remove `optional_host_permissions` + the "Always detect here" button — activeTab detection still works everywhere.
- Bump `version` in `extension/manifest.json` for every re-upload.
