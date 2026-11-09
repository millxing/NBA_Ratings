# NBA Ratings

NBA team power ratings and matchup projections, adapted from the NFL Ratings app's layout and ordinary least squares model.

## Open the app

Open `NBAPowerRatings.html` directly in a browser. The data bundle loads locally; no server, installation, or build step is required. `index.html` redirects to the app for static hosting, including GitHub Pages.

The app includes:

- Seasons from 2000–01 through 2026–27, using historical team names and the actual number of teams.
- Inclusive start/end dates, with automatic recalculation. Compact sliders and previous/next buttons beneath both dates step through recorded game dates without crossing the other boundary. Arrow keys also move the focused slider; the table remains visible while scrubbing updates settle.
- Regular season, playoffs, and all-games selections.
- Sortable adjusted ratings, wins/losses, Net Rating, ORTG, DRTG, and strength of schedule for the selected dates and game selection.
- A matchup calculator with neutral court or either team's home court.
- Saved season, start date, game selection, and matchup preferences in browser storage. Each opening starts with Rating sorted highest first and the latest available end date for the selected season and game selection.
- Full-game NBA CSV import and refresh of the bundled dataset.

## Data

`data/games.js` is a portable export of `../NBA_Data/team_game_logs/team_game_logs_YYYY-YY.csv`. It contains scores and FGA/FTA/OREB/TOV for both teams, with one row per completed game. Quarter, clutch, and garbage-filtered datasets are deliberately excluded. The bundle grows as new results arrive; the app displays the latest included game date.

The parser handles the source's ISO and M/D/YY dates, alternate `playoff`/`playoffs` and `playin`/`play_in` labels, and case variations in neutral-site flags. Future-dated rows are excluded. Invalid completed scores, duplicate game IDs, and malformed identities are rejected.

Regular-season selections include NBA Cup semifinals, which count toward regular-season records. The Cup final and play-in games appear only in All games. Playoffs includes postseason playoff series, excluding play-ins. Only recorded results are used; no future schedule is required.

### Automatic and manual updates

GitHub Actions refreshes the bundle and publishes the site daily at **6:30 a.m. America/New_York**, adjusting for daylight saving time. Scheduled runs can start late. Each run fetches the latest `millxing/NBA_Data` game logs, exports the bundle, runs model checks, commits changed results, and deploys GitHub Pages. It does not collect NBA scores itself; results depend on NBA_Data being current.

To trigger an update immediately from T3 chat or an authenticated terminal, run:

```sh
gh workflow run update-data.yml --repo millxing/NBA_Ratings
```

This bypasses the scheduled trigger, but still uses a GitHub Actions runner. View progress at https://github.com/millxing/NBA_Ratings/actions/workflows/update-data.yml or run:

```sh
gh run list --repo millxing/NBA_Ratings --workflow update-data.yml --limit 3
```

### Update the local copy

The scheduled job updates GitHub and the hosted site. Run `git pull --ff-only` to bring those changes to this local checkout.


After NBA_Data has newer game logs, run:

```sh
python3 scripts/sync-data.py
```

Or specify a different NBA_Data directory:

```sh
python3 scripts/sync-data.py --source /path/to/NBA_Data
```

Then click **Refresh data** in Source details, or reload the app. If hosted, publish the updated `data/games.js` alongside the app. Refresh does not run the export or fetch new NBA results itself.

**Import CSV** loads a full-game team_game_logs file for the current session, replacing the bundled dataset. Refresh restores the bundle. Invalid imports leave the previous dataset and ratings intact.

## Model

The model preserves the NFL app's two-stage fitting procedure:

1. Estimate each game’s possessions as the average of both teams’ `FGA + 0.44 × FTA − OREB + TOV` ([formula reference](https://hoopr.sportsdataverse.org/articles/basketball-advanced-metrics.html)). Fit game Net Rating: `100 × (home points − away points) / estimated possessions`.
2. Estimate home-court advantage and team effects using non-neutral games.
3. Hold that advantage fixed and estimate team ratings from all selected games, applying zero home advantage at neutral sites.
4. Center team ratings at zero. Rating measures opponent- and home-court-adjusted points per 100 possessions above or below the average participating team. SOS is Rating minus unadjusted Net Rating.

Ratings use the teams represented in the chosen season and game category. Narrow ranges with missing teams or disconnected opponents cannot identify all ratings and produce a clear error. An entirely neutral-site selection, such as the 2020 playoffs, cannot estimate home-court advantage under this model; use a wider game selection including non-neutral games. No arbitrary fallback advantage is inserted.

ORTG is `100 × total points scored / total estimated possessions`; DRTG is `100 × total points allowed / total estimated possessions`. Net Rating is ORTG minus DRTG. These aggregate rates weight games by possessions. The OLS model gives each game equal weight. Possessions are box-score estimates, so these metrics can differ from NBA.com’s possession-based ratings. Imports require FGA, FTA, OREB, and TOV for both teams; score-only files cannot calculate efficiency.

Home-court advantage and matchup projections use points per 100 possessions. Matchup projections estimate an efficiency margin, not a full-game point spread, total score, or betting probability.

## Verification

```sh
node tests/ratings-model.cjs
```

This checks known coefficients, pace normalization, possession-weighted efficiency, possession-stat validation, neutral-site treatment, singular samples, all 27 regular seasons, historical team counts, records, game classification, imports, and matchup arithmetic.

Optional browser checks require Playwright and Chromium already installed:

```sh
node tests/browser.cjs
```

Set `BROWSER=webkit` to run the same interaction checks in WebKit. Set `PLAYWRIGHT_PATH` to a Playwright module path and `CHROMIUM_PATH` to a Chromium executable if they are not available at their defaults. Tests cover direct-file loading, sorting, dates, preferences, historical seasons, playoff and empty states, import/refresh, matchups, and mobile overflow. Screenshots are written to `/tmp`.

## Attribution

Adapted from `NFL_Ratings/NFLPowerRatings.html`; its original source header specifies MIT. Page content retains the original CC BY 4.0 attribution to [entangledparticles.xyz](https://entangledparticles.xyz/). NBA data remains subject to its original terms.
