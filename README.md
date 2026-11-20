# TrialExit

Track free trials and get a reminder that **opens the exact cancel page** — before the charge lands.

No bank access, no accounts, no server. Everything stays in the browser.

## Why it exists

People start 7- and 30-day trials intending to cancel, then lose the date. A calendar reminder
alone fails because once it opens you still have to go find a buried cancellation page. TrialExit
puts the reminder, the direct cancellation URL, and the steps in one place.

## What it does

- **5-second capture** — service, renewal date/time/timezone, amount.
- **Countdown cards** — green (>7d), amber (2–7d), red (<48h), grey (past due).
- **Adaptive alerts** — 48h before renewal for trials ≤14 days, 5 days for longer ones, plus a
  24h ping. A flat 48h alert silently costs you two days of access on a 30-day trial.
- **Calendar export** — `.ics` with UTC timestamps (no fragile `VTIMEZONE`), two alarms, and the
  cancel URL embedded in the event description, so the alert is actionable when it fires.
- **Direct exit links** — deep links into each service's cancellation surface, verified and dated.
- **Honest bookkeeping** — a trial is only marked saved when *you* confirm cancellation and it
  happened before the charge. "Saved" is never inferred.

## Install (developer mode, until the store listing is live)

1. `node scripts/sync.mjs` — vendors `core/` and the directory into `extension/`.
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the `extension/` folder.
4. Click the TrialExit toolbar icon → **Open** for the dashboard.

Works in Chrome, Edge, Brave, Arc, Opera and Vivaldi (all Chromium).

## Tests

```
npm test
```

Zero dependencies. Pure logic lives in `core/src` and is tested without a browser.

## Layout

```
core/src/       pure logic: date math, .ics, state machine, directory loader
core/test/      node --test suites
directory/      the public service directory (JSON) — the actual product surface
extension/      MV3 package: popup + full-tab dashboard + checkout detector
scripts/sync.mjs
```

## The directory is community-maintained

`directory/directory.json` is fetched at runtime from `raw.githubusercontent.com`, with the bundled
copy as offline fallback. Fixing a dead cancel link is a pull request — no store re-review, no
release. Each entry carries `verified` and `lastVerifiedAt`; anything unverified renders a badge in
the UI rather than quietly lying.

Broken link? Open an issue with the service name and what changed.

## Privacy

- No account, no analytics, no network calls except the directory refresh.
- Extension permissions are deliberately narrow: `storage`, `alarms`, `activeTab`, host access only
  to `raw.githubusercontent.com`, and content scripts on the merchant domains in the directory.
- Nothing about which subscriptions you hold ever leaves the device.

## Status

`0.1.0` — pre-release. Paywall is wired but dormant (`FREE_LAUNCH` in `core/src/store.js`) while
the product is free for the first 20 users. Payments are not integrated yet.
