# Setting up the FatSecret relay

FatSecret can't be called from a phone app directly, so the app talks to a small relay that you own.
The relay is a free Cloudflare Worker. It keeps your FatSecret key, signs each request, and passes the
answer back. Setup takes about ten minutes and is done once. Menu names in Cloudflare and FatSecret
change from time to time; look for the nearest match if a label differs.

## 1. Find your FatSecret key and secret

1. Sign in at <https://platform.fatsecret.com> and open **Manage API Keys** (under your account menu).
2. Under **REST API OAuth 1.0 Credentials**, note the **Consumer Key** and **Consumer Secret**.
   (Not the OAuth 2.0 "Client ID / Client Secret" — the relay uses OAuth 1.0 because it has no
   network-address restriction.)

## 2. Create the Worker

1. Sign in at <https://dash.cloudflare.com>.
2. Go to **Compute (Workers)** → **Workers & Pages** → **Create** → **Create Worker**
   (choose "Start with Hello World" if asked).
3. Name it, for example `food-relay`, and press **Deploy**.
4. Press **Edit code**. Delete everything in the editor.
5. Open [`relay/fatsecret-worker.js`](../relay/fatsecret-worker.js) in this repository, press the
   **Copy raw file** button, and paste it into the Cloudflare editor.
6. Press **Deploy**.

## 3. Add the three secrets

In the Worker's page: **Settings** → **Variables and Secrets** → **Add**. Add each of these with
type **Secret**, then **Deploy**:

| Name | Value |
|---|---|
| `FATSECRET_KEY` | your FatSecret Consumer Key |
| `FATSECRET_SECRET` | your FatSecret Consumer Secret |
| `RELAY_TOKEN` | a passphrase you make up (letters and numbers, 16+ characters) |

Optional: add a plain **Text** variable `ALLOWED_ORIGIN` with the value `https://skymasterson.github.io`
so browsers only accept the relay's answers from your app.

## 4. Connect the app

1. Copy the Worker's address from its page. It looks like `https://food-relay.<your-name>.workers.dev`.
2. In the app: **Settings** → **FatSecret (optional)**. Paste the address into **Relay address** and
   your passphrase into **Relay passphrase**.
3. Press **Test FatSecret connection**. "Working" means it is set up.

## If the test fails

| Message | What to do |
|---|---|
| passphrase does not match | The passphrase in the app differs from `RELAY_TOKEN`. Re-enter both. |
| relay is missing FATSECRET_KEY… | A secret is missing or misnamed in step 3, or you didn't press Deploy after adding it. |
| rejected the key or signature | The Consumer Key or Secret was pasted wrongly, or the OAuth 2.0 pair was used. |
| refused the relay's network address | Your FatSecret key has an IP restriction. In FatSecret's **Manage API Keys**, remove it or allow all addresses. |
| Could not reach the FatSecret relay | The relay address is wrong; it must start with `https://`. |

## What the relay can and cannot do

- It only forwards two things: a food search and a food-details lookup.
- Anyone who has both the relay address and the passphrase could use your FatSecret quota, so keep the
  passphrase private. The passphrase is not included in the app's backups; the address is.
- FatSecret has calories, protein, sodium and potassium "where available", and **never phosphorus**.
