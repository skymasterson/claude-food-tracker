# Picture Food Tracker — Build Spec for Claude Code

## 1. Purpose

A personal Android home-screen web app (PWA) for one user. Take a photo of a meal, get an editable list of foods and portions, and log calories, protein, potassium, sodium and phosphorus against daily targets. It replaces a paid tracker whose food-directory search is slow and often impossible for home-cooked and restaurant meals.

The numbers are used to manage a chronic health condition, so the app must never present a guess as a fact, and never present missing data as zero.

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Platform | Installable web app (PWA) on Android Chrome, added to the home screen |
| Food recognition | Pay-per-use AI vision API with the user's own key (a few dollars a month is acceptable) |
| Nutrient values | Looked up in USDA FoodData Central where possible; AI estimate only as a labelled fallback |
| Storage | On the phone only (IndexedDB). No account, no server database |
| Backup | Manual export and import |
| Eating pattern | About 60% restaurant, 40% home cooking; little reliance on packaged foods |
| Not in scope | Barcode scanning, multi-user, cloud sync, Play Store release |

## 3. Daily targets (editable in Settings)

| Nutrient | Target | Type |
|---|---|---|
| Protein | 65 g | Target — **confirm with user whether this is a minimum, a maximum, or a range** |
| Potassium | 1,800 mg | Maximum |
| Phosphorus | 1,000 mg | Maximum |
| Sodium | 2,000 mg | Maximum |
| Calories | none set | Tracked; optional target can be added |

Each target stores a value, a unit and a type (minimum, maximum or range) so the user can change them if their care team does.

## 4. Core flow: log a meal from a photo

1. Tap the large camera button on the home screen. Take a photo or pick one from the gallery.
2. Optionally add a short note ("chicken pad thai, ate about half", restaurant name). Because most meals are restaurant meals, this note field is prominent, not hidden.
3. The app resizes the image (longest side about 1,280 px, JPEG) and sends it with the note to the vision model.
4. The model returns structured JSON: a list of items, each with a food name, a search term suited to USDA lookup, an estimated amount in grams, a household description of the amount ("1 cup", "1 fillet"), a confidence level, and its own fallback nutrient estimate per 100 g.
5. For each item the app searches USDA FoodData Central and picks the best match, preferring Foundation and SR Legacy entries because they carry potassium and phosphorus most completely.
6. A review screen shows every item with its amount and the five nutrients. The user can change the amount, swap the matched food, delete an item, or add one by typing.
7. The screen shows the meal total and what the day's totals would be after saving, with any limit that would be exceeded highlighted before the user commits.
8. Save. The entry stores the time, meal type, items, nutrient values, the source of each value, and a small thumbnail.

A "describe it instead" route follows the same flow from typed text with no photo.

## 5. Data honesty rules

- Every nutrient value carries a source: `usda`, `ai-estimate` or `user-entered`. The source is visible on the review screen and in exports.
- When a nutrient is unavailable for a food it is stored as unknown (null), shown as "?", and excluded from the sum. Any daily total that includes unknowns is marked "at least X mg".
- AI-estimated values are visually distinct from database values.
- Restaurant meals get a standing note on the review screen that sodium and phosphorus are likely underestimated, since added salt and phosphate additives are not visible in a photo.
- Portion estimates are always editable, and the amount field is the first thing in each row.
- A short line in Settings and on first launch states that values are estimates and the app is a logging aid, not medical advice.

## 6. Other features

**Today screen (home)**
- Progress bar for each nutrient showing consumed, remaining and target.
- Colour states: normal, approaching (80% or more of a maximum), over. Colour is paired with text or an icon so it is not the only signal.
- List of today's entries, tappable to edit or delete.
- Date switcher for viewing and editing past days.

**Saved meals and favourites**
- Save any logged meal as a favourite with a name.
- One-tap re-log, with the option to adjust the amount first.
- Recently logged items appear as quick picks.
- A simple recipe entry: list ingredients and amounts once, set the number of servings, then log by serving. This covers repeat home cooking.

**Trends**
- 7-day and 30-day chart per nutrient with the target drawn as a line.
- Daily averages and the number of days over each limit.

**Export**
- CSV of all entries for a date range (one row per item, with sources).
- A printable daily-totals summary for a date range, suitable for sharing with a care team.
- Full JSON backup and restore, with a reminder if no backup has been made in 30 days.

**Settings**
- Targets, AI API key, USDA API key, backup and restore, delete all data.

## 7. Technical approach

- **Stack:** React, TypeScript and Vite, with a PWA plugin for the manifest and service worker. Mobile-first layout with large touch targets.
- **Storage:** IndexedDB through a small wrapper library such as Dexie. Tables: entries, items, favourites, recipes, settings, and a cache of USDA lookups.
- **Camera:** a file input with `capture="environment"`, which opens the phone camera without extra permissions code.
- **AI:** a vision-capable model called directly from the browser with the user's key, which is stored only on the device. Use structured output so the response is valid JSON. Keep the provider behind one small module so it can be swapped. Check the provider's current documentation for the right model name and for the setting that permits browser-side calls.
- **Nutrient data:** USDA FoodData Central API (free key from api.data.gov). Nutrients needed: energy, protein, potassium, sodium, phosphorus. Cache results locally.
- **Hosting:** a free static host with HTTPS (GitHub Pages, Cloudflare Pages or Netlify). HTTPS is required for installing to the home screen. No backend.
- **Offline:** the app shell, history, favourites and manual entry work offline. Photo analysis needs a connection; offline photos are queued as drafts.
- **Charts:** a lightweight charting library such as Recharts.
- **Tests:** unit tests for nutrient maths, unknown-value handling and target status.

## 8. Build order

1. Project scaffold, PWA install, Settings with targets, Today screen with manual entry and local storage.
2. USDA search and lookup with caching; typed "describe it" entry using lookup.
3. Photo capture, AI analysis and the review screen.
4. Favourites, recents and recipes.
5. Trends and exports, backup and restore.
6. Polish: offline drafts, accessibility, deploy to a static host and install on the phone.

Each step should end with something usable on the phone.

## 9. Kickoff prompt for Claude Code

Save this file in an empty project folder as `SPEC.md`, start Claude Code in that folder, and paste:

> Read SPEC.md. This is a personal Android home-screen web app I will use daily to manage a health condition, so accuracy handling in section 5 is not optional. I have some coding experience but need clear instructions for anything I must do myself (installing tools, getting API keys, deploying).
>
> First, ask me any questions the spec leaves open, including the protein target type. Then propose the project structure and data model and wait for my approval. After that, build step 1 from section 8 only, tell me how to run it and view it on my phone, and stop so I can test before you continue to the next step.

## 10. What the user needs before starting

- A computer with Node.js and Claude Code installed.
- An API key for the AI vision provider, with a small prepaid balance.
- A free USDA FoodData Central API key.
- A free account on a static host, needed at step 6 (or earlier to test on the phone).
