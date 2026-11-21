# Launch setup — the parts only the owner can do

Everything here is free except the one-time $5 Chrome Web Store registration.
Order matters: the store gives you the extension's permanent ID, and both OAuth
clients are tied to that ID.

## 1. Chrome Web Store draft (gets the permanent extension ID) — 10 min, $5

1. https://chrome.google.com/webstore/devconsole → pay the $5 registration.
2. `npm run package` → upload `dist/trialexit-<version>.zip` as a **new item**. Do **not** submit yet.
3. Copy the **Item ID** (32 letters, e.g. `abcdefghijklmnopabcdefghijklmnop`). This is the extension ID users will have.

## 2. Gmail — Google Cloud OAuth client — 15 min, free

1. https://console.cloud.google.com → create project **TrialExit**.
2. **APIs & Services → Library** → enable **Gmail API**.
3. **OAuth consent screen** → External → app name TrialExit, your support email,
   app homepage = your site, privacy policy = the PRIVACY.md URL.
   - Scopes → add `https://www.googleapis.com/auth/gmail.readonly`.
   - Publishing status: leave as **Testing**.
   - **Test users → add the Gmail address of each of your first users** (max 100).
     Testing mode needs no Google review. That covers the first 20 users.
4. **Credentials → Create credentials → OAuth client ID → Application type "Chrome Extension"**
   → Item ID = the ID from step 1.3.
5. Send me the **Client ID** (`…apps.googleusercontent.com`; it is public, not a secret).
   It goes in `extension/manifest.json → oauth2.client_id`.

> For local testing before the store ID exists, create a second "Chrome Extension" client with the
> unpacked extension's ID (shown at the bottom of the dashboard).

**Going public later (more than 100 users):** submit the consent screen for verification. Gmail read is
a *restricted* scope. Because TrialExit reads mail only on the user's device and has no server, it
should only need the free brand + scope verification, not the paid CASA security assessment.
Confirm with Google during review. Have a 2-minute demo video ready showing the Connect Gmail flow.

## 3. Outlook — Microsoft Entra (Azure) app registration — 10 min, free

1. https://entra.microsoft.com → **App registrations → New registration**
   - Name: TrialExit
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
   - Redirect URI: platform **Single-page application (SPA)** →
     `https://<ITEM_ID>.chromiumapp.org/`  (use the Item ID from step 1.3, trailing slash included)
2. **Authentication** → under *Implicit grant and hybrid flows* tick **Access tokens** → Save.
3. **API permissions → Add → Microsoft Graph → Delegated → `Mail.Read`** (plus `openid`, `offline_access`).
4. Send me the **Application (client) ID** (a GUID, public). It goes in `extension/src/config.js`.

Personal Outlook/Hotmail accounts work immediately. Some work/school tenants block user consent;
those users would need their IT admin. That's fine for a consumer launch.

## 4. Re-upload and submit — 10 min

After the two client IDs are in: bump the version, `npm run package`, upload the new zip to the same
item, fill in the listing from `store/LISTING.md`, and **Submit for review** (typically 1–3 days, can
be longer because of email permissions).

## 5. Website — free

Static site (`npm run site` → `site/`). Deploy on Vercel (free Hobby plan) or GitHub Pages.
