# TrialExit

Catch every free trial you start — from **Gmail / Outlook** and checkout pages — get nudged as the
charge gets closer, and cancel in one click on the exact cancel page.

No bank access, no accounts, no server. Email is read on-device. Two surfaces, one codebase:
a Chrome extension (`extension/`) and a web app (`web/` → `/app`).

**Launching?** Read [SETUP.md](SETUP.md) (OAuth clients, store submission) and
[store/LISTING.md](store/LISTING.md) (copy-paste listing + permission justifications).

## Why it exists

People start 7- and 30-day trials intending to cancel, then lose the date. A calendar reminder
alone fails because once it opens you still have to go find a buried cancellation page. TrialExit
puts the reminder, the direct cancellation URL, and the steps in one place.

## What it does

- **Finds trials in your inbox** — connect Gmail or Outlook (read-only); trial confirmation emails,
  including ones from phone and app-store signups, become one-click suggestions. Rescans every 6h.
- **Onboarding in 30 seconds** — tap the services you're trialling, pick when each ends.
- **Escalating nudges** — 2 days, 1 day, 6 hours, 1 hour (plus 5 days for long trials), a 9am digest,
  snooze buttons, then "Did it renew?" so every trial ends as cancelled / kept / charged.
- **Paste an email** — for the web app and mobile: paste a confirmation, the date and price are read.

- **5-second capture** — service, renewal date/time/timezone, amount.
- **Countdown cards** — green (>7d), amber (2–7d), red (<48h), grey (past due).
- **Adaptive alerts** — 48h before renewal for trials ≤14 days, 5 days for longer ones, plus a
  24h ping. A flat 48h alert silently costs you two days of access on a 30-day trial.
- **Calendar export** — `.ics` with UTC timestamps (no fragile `VTIMEZONE`), two alarms, and the
  cancel URL embedded in the event description, so the alert is actionable when it fires.
- **Direct exit links** — deep links into each service's cancellation surface, verified and dated.
- **Detection everywhere, without `<all_urls>`** — 10 known merchants auto-detect; any other site works
  when you click the icon (`activeTab`); "Always detect here" grants one origin at a time.
- **Honest bookkeeping** — a trial is only marked saved when *you* confirm cancellation and it
  happened before the charge. "Saved" is never inferred.

## Scripts

```
npm test              # 52 tests, zero dependencies
npm run site          # build landing + web app into site/
npm run sync          # vendor core/ + directory/ into extension/ (Chrome can't import outside its root)
npm run icons         # regenerate PNG icons (hand-rolled PNG encoder, no image deps)
npm run verify        # live-check every cancel URL, report only
npm run verify:write  # apply verification results to directory.json
npm run package       # build dist/trialexit-<version>.zip for the Web Store
```

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

`0.4.0` — pre-release. Paywall is wired but dormant (`FREE_LAUNCH` in `core/src/store.js`) while
the product is free for the first 20 users. Payments are not integrated yet.
