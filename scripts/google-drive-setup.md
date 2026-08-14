# Google Drive setup (one-time)

The `drive-upload` edge function writes production files into **Pawan's My Drive**
using a refresh token held as a Supabase secret. No Google credentials ever reach
the browser, and nobody signs in again after this runs once.

Do this once. It takes about 15 minutes. You need:

- A Google account that owns the target Drive — **pawan@swftconnect.com**
- The Supabase CLI, logged in and linked to this project (`supabase link`)
- Node 20+ (for the helper script)
- The shared secret from the WordPress plugin settings (`designer_shared_secret`)

---

## 1. Create the Google OAuth client

In [Google Cloud Console](https://console.cloud.google.com/):

1. **Create a project** (or reuse one) — e.g. `swft-nfc-designer`.
2. **APIs & Services → Library → Google Drive API → Enable.**
3. **APIs & Services → OAuth consent screen.** On a Workspace account choose
   **Internal** — no Google verification review, no test-user list to maintain.
   App name `NFC Card Designer`, support email + developer email = your own.
   No scopes need adding on this screen; the script requests them at sign-in.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID.**
   - Application type: **Web application** (not "Desktop app" — the script runs a
     real localhost redirect)
   - Name: `NFC designer local setup`
   - **Authorised redirect URIs → Add URI:** `http://localhost:8765/callback`
     (exactly this — no trailing slash, no https)
5. Copy the **Client ID** and **Client secret** from the dialog. Keep them in your
   password manager, not in a file in this repo.

## 2. Get the refresh token

From the repo root:

```bash
node scripts/get-google-refresh-token.mjs
```

It prompts for the client ID and secret (the secret is not echoed). You can also
pass them as `--client-id=… --client-secret=…`, or set `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` in the environment.

What happens:

1. The script starts a local server on port 8765 and opens the Google consent
   screen (if the browser doesn't open, paste the URL it prints).
2. **Sign in as pawan@swftconnect.com** — this is the account whose My Drive
   receives the files. Approve the single requested permission.
3. The tab confirms and can be closed; the terminal prints the refresh token.

The token is printed once and never written to disk. Copy it straight into step 3
— don't commit it, paste it into chat, or leave it in a notes app.

If the script errors, the message says what to fix: `redirect_uri_mismatch` means
step 1.4 doesn't match, `invalid_client` means the ID/secret pair is wrong, and
"port 8765 is already in use" means something else is listening (stop it and rerun
— the port is fixed by the redirect URI).

## 3. Set the secrets and deploy

```bash
supabase secrets set \
  GOOGLE_CLIENT_ID=<client id from step 1> \
  GOOGLE_CLIENT_SECRET=<client secret from step 1> \
  GOOGLE_REFRESH_TOKEN=<refresh token from step 2> \
  DESIGNER_SHARED_SECRET=<same value as the WordPress designer_shared_secret setting>

supabase functions deploy drive-upload
```

`DESIGNER_SHARED_SECRET` must be **byte-identical** to the plugin's
`designer_shared_secret` setting — WordPress signs the production deep links with
it and the edge function verifies them. If they differ, every "Save to Google
Drive" click fails with a 403.

`APP_ORIGIN` is already set from earlier functions; check it with
`supabase secrets list` if uploads are rejected for CORS.

Verify with a real order: open a WooCommerce order → **Production files** on an
NFC line item → **Save to Google Drive**. The folder link appears in the panel and
on the order's proof links.

## 4. If access is revoked

The refresh token stops working if the app is removed under
[Google Account → Data & privacy → Third-party access](https://myaccount.google.com/permissions),
or if the OAuth client is deleted in Cloud Console.

When that happens the edge function returns `drive-reauth-required` and the
production panel shows a re-authorise message pointing at this document. To fix:
rerun **step 2**, then `supabase secrets set GOOGLE_REFRESH_TOKEN=…` and redeploy.
Nothing else changes — the same client ID and secret still apply, and existing
Drive folders keep working.

## 5. What the app can and can't see in Drive

The token is scoped to `drive.file`: **the app only sees files and folders it
created itself.** The rest of the Drive is invisible to it, which is the point —
a leaked token can't read anything else.

Consequences worth knowing:

- The app creates its own root folder, **`NFC Card Production`**, on first upload.
  Orders land in `NFC Card Production/Order-<order#>-<partner-slug>/` with
  `print/`, `source/`, `preview.pdf` and `links.csv` inside.
- You can **move, rename, or share that folder** in Drive freely — `drive.file`
  access follows the file, not the location, so nothing breaks.
- Folders you create by hand in Drive are **not** usable as a destination; the app
  can't see them. Always let it create its own and move it afterwards if you want
  it filed somewhere else.
- Don't delete `NFC Card Production` to "reset" things — deleting it just means the
  next upload creates a fresh one, and older order links point into the trash.
