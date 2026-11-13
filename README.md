# Picture Food Tracker

A personal Android home-screen web app (PWA). Photograph a meal, review an editable list of foods and
portions, and log calories, total and animal protein, potassium, sodium and phosphorus against daily targets.
The full specification is in [SPEC.md](SPEC.md).

**Values are estimates. This is a logging aid, not medical advice.**

## How the numbers are kept honest

- Every value shows its source: **USDA** (database), **AI est.** (dashed outline, italic, `~` prefix) or **You** (typed in).
- A missing value is stored as unknown, shown as `?`, and left out of sums. Any total that includes an
  unknown reads **"at least X"**.
- **Animal protein** (meat, poultry, fish, eggs, dairy) is tracked separately from total protein and carries the
  protein limit. It is total protein × the food's animal share: taken from the USDA food category for single
  foods (a database value), estimated by the AI for mixed dishes (labelled as an estimate, editable), and
  unknown otherwise.
- A progress bar whose total includes unknowns is marked **Incomplete** rather than OK.
- Restaurant meals carry a standing note that sodium and phosphorus are likely underestimated.
- Nothing leaves the phone except: the photo and note (sent to Anthropic for analysis) and food search
  terms (sent to USDA). There is no server and no account.

## What you need

1. **Anthropic API key** — <https://console.anthropic.com> → sign up → *Billing*: add a small prepaid
   balance (US$5 lasts a long time) → *API keys* → *Create key*. Copy the key (starts with `sk-ant-`).
2. **USDA FoodData Central key** (free) — <https://fdc.nal.usda.gov/api-key-signup> → the key arrives by email.

Both keys are typed into the app's **Settings** screen on your phone. They are stored only on the phone
and are never included in backups.

Cost: each photo analysis is one API call with the default model (Claude Opus 5.5), roughly a few US cents.
Settings lets you switch to Sonnet 5.5 (about half) or Haiku 5.5 (cheapest, least accurate).

## Deploy to GitHub Pages

1. Push this project to a GitHub repository (branch `main`).
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) runs the tests, builds, and publishes on every
   push to `main`. The address appears under **Settings → Pages** and in the workflow run
   (`https://<your-user>.github.io/<repo>/`).

GitHub Pages on a free account requires the repository to be **public**. The code contains no keys or
personal data, so that is safe; your log never leaves your phone.

## Install on the phone

1. Open the Pages address in **Chrome on Android**.
2. Chrome menu (⋮) → **Add to Home screen** → **Install**.
3. Open the app from the home screen, read the notice, then go to **Settings** and paste both API keys.

## Using it

- **Photograph a meal** → add a note (dish, restaurant, how much you ate) → **Analyse** → check each
  amount on the review screen → **Save to log**. The review screen shows what the day's totals will be
  and flags any limit the meal would exceed before you save.
- **Describe it instead** does the same from typed text.
- **Add manually** searches the USDA database or lets you type values from a menu's nutrition sheet.
- **Saved**: favourites (one-tap re-log), recipes (log by serving), recently logged foods.
- **Trends**: 7 and 30 days per nutrient, with averages and days over the limit.
- **Export**: CSV, a printable summary for your care team, and full backup / restore.
- Offline: history, favourites, manual entry and previously searched foods work. Photos taken offline
  are kept as drafts and analysed when you are back online.

**Back up regularly** (Export → Download full backup). The log exists only on the phone; clearing
Chrome's site data or losing the phone loses it. The app reminds you after 30 days.

## Development

Requires Node.js 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

`npm run dev` prints a network address you can open on a phone on the same Wi-Fi (camera and install need
HTTPS, so use the deployed site for those).

Layout: `src/domain` (pure nutrient maths, targets, formatting, CSV — unit tested), `src/db` (IndexedDB
via Dexie, backup), `src/services` (USDA lookup, AI provider behind `services/ai/provider.ts`, image
resize), `src/screens`, `src/components`.
