# Privacy

TrialExit has no backend, no analytics, and no account. This is a short document because there is very little to disclose.

## What is stored

Only what you type into the extension, kept in your browser's local extension storage:

- service name, region, renewal date and time, timezone
- renewal amount and currency
- an optional label you write yourself (e.g. "HDFC card")
- whether you marked a trial as cancelled

There are no card numbers, no UPI IDs, no bank credentials, and no passwords.

## What leaves your device

Exactly one thing: a plain HTTP GET for the public service directory JSON at `raw.githubusercontent.com`. It contains no identifiers and no information about you — it is the same request every user makes.

Page text is read on-device, only on merchant domains listed in the manifest, only on the tab you click, or only on origins you explicitly granted. That text is used to guess a trial length and price, is shown to you for correction, and is never transmitted anywhere.

No telemetry. No crash reporting. No advertising identifiers.

## Permissions, and why each exists

| Permission | Why |
|---|---|
| `storage` | Save your trials locally |
| `alarms` | Schedule the alert before renewal |
| `notifications` | Show the alert |
| `activeTab` | Read the current tab **only when you click the extension yourself** |
| `scripting` | Run the checkout detector on that one tab, on demand |
| host access to `raw.githubusercontent.com` | Refresh the cancel-link directory |
| content scripts on the listed merchant domains | Auto-detect a checkout page on the 10 known merchants |
| *optional* per-site access | Only if you press "Always detect here". One site at a time, revocable in Chrome settings |

The extension deliberately does **not** request access to all sites. Detection works everywhere in
three tiers:

1. **Known merchants** — auto-detect, no click.
2. **Any other site** — you click the toolbar icon, the detector reads that tab only.
3. **Any other site, repeatedly** — you grant that one origin, and it stops asking.

There is no configuration in which this extension reads pages you have not opened or explicitly
invoked it on.

## What is never done

- Cancelling a subscription on your behalf
- Reading page content beyond the current checkout page, and only to detect trial signals
- Sharing or selling any data, because none is collected

## Removing your data

Uninstalling the extension deletes its storage. You can also remove individual trials in the dashboard.

## Changes

Any change to this policy will appear as a commit in the public repository, which is the version you are running.
