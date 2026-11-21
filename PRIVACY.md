# Privacy

TrialExit has no backend, no analytics, and no account. This is a short document because there is very little to disclose.

## What is stored

Only what you type into the extension, kept in your browser's local extension storage:

- service name, region, renewal date and time, timezone
- renewal amount and currency
- an optional label you write yourself (e.g. "HDFC card")
- whether you marked a trial as cancelled

There are no card numbers, no UPI IDs, no bank credentials, and no passwords.

## Email access (optional, Gmail and Outlook)

If — and only if — you press **Connect Gmail** or **Connect Outlook**, TrialExit asks for **read-only** access
to your mailbox (`gmail.readonly` / Microsoft Graph `Mail.Read`). It uses that access for one purpose:
finding emails that confirm a free trial or subscription, so they can be offered to you as trials to track.

- The extension searches only for trial and subscription phrases (e.g. "free trial", "trial ends",
  "will automatically renew") in the last 60 days.
- Matching emails are downloaded **directly from Google / Microsoft into the extension on your device**
  and parsed there. Email content is **never sent to any TrialExit server** — there is none — or to any
  third party.
- Only the result is stored locally: service name, guessed end date, price, the email's subject line and
  message ID (so the same email is not suggested twice). Email bodies are not stored.
- Nothing is ever sent, deleted, labelled or modified in your mailbox.
- **Disconnect** in the dashboard revokes the token. You can also revoke access at
  myaccount.google.com/permissions or account.live.com/consent/Manage.

TrialExit's use and transfer of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

## Gmail page detector

On `mail.google.com`, a content script reads **only the email you have open** to offer "Track this trial".
It runs on your device and transmits nothing.

## What leaves your device

- A plain HTTP GET for the public service directory JSON at `raw.githubusercontent.com`. It contains no identifiers and no information about you — it is the same request every user makes.
- If you connected email: requests from your browser to Google / Microsoft's own APIs, authenticated as you, to read trial emails as described above. Those requests go to the provider, not to us.

To catch trials as you start them, a small script runs on the websites you visit. On an ordinary page
it checks the address and visible text for trial or checkout wording (e.g. "free trial", "start your
trial", a card form), finds none, and does nothing else. Only when a page looks like a trial checkout
or a "your trial has started" page is its text parsed — inside the extension, on your device — to guess
the service, trial length and price, which are shown to you for confirmation. Page content is never
transmitted anywhere and never stored; only a trial you confirm is saved. You can turn this off in the
dashboard, or choose "Never on this site" for any site.

No telemetry. No crash reporting. No advertising identifiers.

## Permissions, and why each exists

| Permission | Why |
|---|---|
| `storage` | Save your trials locally |
| `alarms` | Schedule the alert before renewal |
| `notifications` | Show the alert |
| `activeTab`, `scripting` | "Track a trial on this page" from the toolbar, on tabs opened before install |
| host access to all sites + content script on all sites | Detect trial checkouts and "trial started" pages as described above, on-device only |
| host access to `raw.githubusercontent.com` | Refresh the cancel-link directory |
| `identity` | Sign in to Google / Microsoft when you press Connect Gmail / Outlook |
| host access to `gmail.googleapis.com`, `graph.microsoft.com`, `oauth2.googleapis.com` | Read trial emails (read-only) after you connect, and revoke access on disconnect |
| content script on `mail.google.com` | Offer to track the trial in the email you have open |

## What is never done

- Cancelling a subscription on your behalf
- Sending page content anywhere, or storing it
- Sharing or selling any data, because none is collected

## Removing your data

Uninstalling the extension deletes its storage. You can also remove individual trials in the dashboard.

## Changes

Any change to this policy will appear as a commit in the public repository, which is the version you are running.
