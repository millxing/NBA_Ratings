# Upcoming NBA forecasts implementation plan

**Goal:** Show today's and tomorrow's unplayed games, projected point margins, and ESPN's current spread.

**Architecture:** Keep the static/direct-file app. Export a dated ESPN snapshot and the current season's actual possessions/minutes from the same NBA_Data advanced logs used by Extra Pass Analytics. Refresh ESPN in the browser with the snapshot as fallback. Forecasts use season-to-date regular-season results before today, independent of the table's selected range. Normalize overtime to 48 minutes. Use league pace until both teams have played 28 regular-season games (one third of 82, rounded up), then their mean pace. Missing advanced data or unidentified ratings yield an unavailable forecast.

**Tech Stack:** Existing vanilla JavaScript, Python standard library, Node assertions, Playwright.

- [x] Add scripts/sync-upcoming.py to export data/forecast.js with two ET dates, source timestamp, ESPN event/odds fields and game-level pace inputs joined by game ID to completed regular-season logs.
- [x] Add upcoming.js with ESPN abbreviation normalization, signed home spreads, independent model fit with model context restored, cutoff-filtered pace and upcoming-game rendering. Display provider, retrieval time, ratings cutoff, pace method, and missing/stale states.
- [x] Add the upcoming section and responsive table to NBAPowerRatings.html. Connect bundle imports/refresh without changing the ratings range. Select a forecast to populate the matchup calculator using its rating window.
- [x] Update the daily workflow to retrieve advanced logs, export/validate/commit/deploy both bundles and upcoming.js.
- [x] Add focused tests for pace weighting/overtime, 28-game switch, home/neutral margin, missing odds, abbreviations, date boundaries, cutoff isolation and context restoration; extend browser checks for rendered forecasts and selection.
- [x] Run Node/Python checks and the existing browser suite, inspect desktop/mobile output, and document behavior in README.md.

Execute inline in the current checkout. Do not commit or publish without a user request.

Validation: model and forecast assertions, offline Python export checks, existing Chromium browser suite, and new Chromium/WebKit interaction checks passed. Inspected desktop/mobile screenshots. Direct-file live ESPN requests were blocked by CORS; local mode now reloads the dated export without making that request. Hosted live requests use an explicit saved-snapshot fallback. Changes remain local.
