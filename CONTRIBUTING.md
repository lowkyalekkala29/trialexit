# Contributing

The most useful contribution is **fixing a dead cancel link**. Cancel flows change without notice, and a wrong link breaks the product's only promise.

## Report a broken or changed link

Open an issue with:

- the service and region (e.g. "SonyLIV (IN)")
- what you saw (404, redirects to home page, moved behind chat support)
- the correct URL if you found it

## Submit a fix

1. Edit `directory/directory.json`.
2. Keep the row shape:

```json
{
  "serviceId": "netflix",
  "region": "IN",
  "name": "Netflix",
  "cancelUrl": "https://www.netflix.com/cancelplan",
  "domains": ["netflix.com"],
  "steps": ["Sign in", "Account → Membership → Cancel Membership"],
  "requiresChat": false,
  "refundWindowDays": null,
  "lastVerifiedAt": "2026-11-20",
  "verified": true
}
```

3. Set `lastVerifiedAt` to today and `verified` to `true` **only if you actually loaded the page**.
4. Run the checks, then open a PR.

```bash
npm run verify     # live check of every URL, report only
npm run verify:write  # apply results to directory.json
npm test
npm run sync       # vendor core + directory into extension/
```

## Rules for the directory

- **One row per region.** The same service has different cancel URLs per country.
- **Never mark a link verified without loading it.** An unverified link shows a badge in the UI; a wrongly verified one silently fails the user.
- **`requiresChat: true`** when the only path is support chat or phone. That changes the advice we give, so it must be accurate.
- **No affiliate or referral URLs.** The direct cancellation page only.

## Code

- `core/` is pure logic with no browser APIs. If it needs `chrome.*`, it belongs in `extension/`.
- Dates are stored as instants with an offset. Never store a bare date for a renewal.
- Cancellation is never inferred. Only the user confirms it.
- Run `npm test` before pushing. Zero dependencies on purpose — keep it that way unless there's a strong reason.

## Adding a merchant to checkout detection

Add the domain to `directory.json` **and** to `content_scripts.matches` in `extension/manifest.json`. Host permissions are intentionally narrow; each addition is a permission expansion and should be justified in the PR.
