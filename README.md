# NBA Ratings

NBA team power ratings and matchup projections, adapted from the NFL Ratings app's layout and ordinary least squares model.

## Open the app

Open `NBAPowerRatings.html` directly in a browser. The data bundle loads locally; no server, installation, or build step is required. `index.html` redirects to the app for static hosting, including GitHub Pages.

The app includes:

- Seasons from 2000–01 through 2026–27, using historical team names and the actual number of teams.
- Inclusive start/end dates, with automatic recalculation. Compact sliders and previous/next buttons beneath both dates step through recorded game dates without crossing the other boundary. Arrow keys also move the focused slider; the table remains visible while scrubbing updates settle.
- Regular season, playoffs, and all-games selections.
- Sortable adjusted ratings, W/L, winning percentage (Pct), Net Rating, ORTG, DRTG, and strength of schedule for the selected dates and game selection.
- A matchup calculator with neutral court or either team's home court.
- Upcoming games for today and tomorrow (Eastern time), with model point spreads, ESPN spreads/provider, pace, and a schedule/line refresh button.
- Saved season, start date, game selection, and matchup preferences in browser storage. Each opening starts with Rating sorted highest first and the latest available end date for the selected season and game selection.
- Full-game NBA CSV import and refresh of the bundled dataset.

## Data

`data/games.js` is a portable export of `../NBA_Data/team_game_logs/team_game_logs_YYYY-YY.csv`. It contains scores and FGA/FTA/OREB/TOV for both teams, with one row per completed game. Quarter, clutch, and garbage-filtered datasets are deliberately excluded. The bundle grows as new results arrive; the app displays the latest included game date.

The parser handles the source's ISO and M/D/YY dates, alternate `playoff`/`playoffs` and `playin`/`play_in` labels, and case variations in neutral-site flags. Future-dated rows are excluded. Invalid completed scores, duplicate game IDs, and malformed identities are rejected.

Regular-season selections include NBA Cup semifinals, which count toward regular-season records. The Cup final and play-in games appear only in All games. Playoffs includes postseason playoff series, excluding play-ins. The ratings table uses only recorded results. Upcoming forecasts use a separate ESPN schedule feed.

### Automatic and manual updates

cron-job.org triggers the GitHub Actions update daily at **6:35 a.m. and 6:50 a.m. America/New_York**, adjusting for daylight saving time. GitHub's **6:30 a.m.** schedule remains enabled as a fallback. The external trigger avoids GitHub scheduled-event delays; runner and publication delays can still occur. Both external triggers run the full update. See [scheduling setup and maintenance](GITHUB_ACTIONS_SCHEDULING.md).

Each run fetches the latest `millxing/NBA_Data` game logs, exports the bundle, runs model checks, exports the ESPN schedule/lines and actual pace inputs, runs forecast checks, commits changed bundles, and deploys GitHub Pages. It does not collect NBA scores itself; results depend on NBA_Data being current.

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
python3 scripts/sync-upcoming.py
```

Or specify a different NBA_Data directory:

```sh
python3 scripts/sync-data.py --source /path/to/NBA_Data
```

Then click **Refresh data** in Source details, or reload the app. If hosted, publish the updated `data/games.js` and `data/forecast.js` alongside the app. Refresh does not run the export or fetch new NBA results itself.

**Import CSV** loads a full-game team_game_logs file for the current session, replacing the bundled dataset. Refresh restores the bundle. Invalid imports leave the previous dataset and ratings intact.

## Model

The model preserves the NFL app's two-stage fitting procedure:

1. Estimate each game’s possessions as the average of both teams’ `FGA + 0.44 × FTA − OREB + TOV` ([formula reference](https://hoopr.sportsdataverse.org/articles/basketball-advanced-metrics.html)). Fit game Net Rating: `100 × (home points − away points) / estimated possessions`.
2. Estimate home-court advantage and team effects using non-neutral games.
3. Hold that advantage fixed and estimate team ratings from all selected games, applying zero home advantage at neutral sites.
4. Center team ratings at zero. Rating measures opponent- and home-court-adjusted points per 100 possessions above or below the average participating team. SOS is Rating minus unadjusted Net Rating.

Ratings use the teams represented in the chosen season and game category. Narrow ranges with missing teams or disconnected opponents cannot identify all ratings and produce a clear error. An entirely neutral-site selection, such as the 2020 playoffs, cannot estimate home-court advantage under this model; use a wider game selection including non-neutral games. No arbitrary fallback advantage is inserted.

ORTG is `100 × total points scored / total estimated possessions`; DRTG is `100 × total points allowed / total estimated possessions`. Net Rating is ORTG minus DRTG. These aggregate rates weight games by possessions. The OLS model gives each game equal weight. Possessions are box-score estimates, so these metrics can differ from NBA.com’s possession-based ratings. Imports require FGA, FTA, OREB, and TOV for both teams; score-only files cannot calculate efficiency.

Home-court advantage and the matchup calculator use points per 100 possessions. Upcoming forecasts convert the efficiency margin to a point margin using projected pace; they do not estimate totals or win probabilities.

### Upcoming forecasts and ESPN lines

The upcoming section shows unplayed games that have not reached tipoff today and tomorrow in America/New_York. It uses current-season regular-season ratings from the start of the season through yesterday, regardless of the ratings table's selected season, dates, or game category. The actual results cutoff is shown. Today's completed games are excluded from both ratings and pace. Clicking a forecast sets the calculator to that forecast's teams, venue, and rating dates; the calculator continues to display the efficiency margin.

Pace uses the same full-game actual possessions and minutes as Extra Pass Analytics in `GLA`, from NBA_Data's `box_score_advanced_YYYY-YY.csv`, joined to regular-season completed game IDs. Each game's average home/road possessions is divided by game minutes and multiplied by 48. Season aggregates divide total possessions by total minutes, so overtime is normalized. League pace is used until **both teams have played at least 28 regular-season games** (one third of 82, rounded up); then projected pace is the mean of their season paces. Team and league rates are rounded to one decimal as in Extra Pass. Model point margin is `(home rating − away rating + home-court advantage) × pace / 100`, with no home advantage at neutral sites. Missing pace coverage or insufficient ratings produces an unavailable forecast, with a reason.

ESPN's scoreboard feed supplies schedules and the sportsbook line it publishes. Spreads identify the favored team and include the provider (for example, DraftKings via ESPN). The retrieval time is shown; lines can change. Missing odds show **Not posted**, never zero. On the hosted app, live refresh is attempted on opening and via **Refresh schedule & lines**. ESPN may restrict browser requests; the dated snapshot remains available. Direct-file mode uses **Reload saved schedule** to reload the exported bundle, avoiding blocked cross-origin requests. Network failures retain the last retrieved snapshot and report the failure. Old snapshots are flagged and games outside the current window are omitted. Imported CSVs disable model forecasts until bundled results are restored, because imports do not include verified actual-pace coverage.

`scripts/sync-upcoming.py` exports a portable schedule/line snapshot and current-season game-level pace inputs to `data/forecast.js`; it accepts the same `--source` option as the results exporter. The daily update publishes both bundles. Hosted browser refresh attempts to retrieve schedule/lines, while newer pace inputs require a new export. If ESPN is unavailable during export, the updater retains the previous snapshot with its original timestamp and still updates pace inputs. No API key or running GLA backend is required.

## Verification

```sh
node tests/ratings-model.cjs
node tests/upcoming.cjs
python3 tests/forecast-export.py
```

This checks known coefficients, pace normalization, possession-weighted efficiency, possession-stat validation, neutral-site treatment, singular samples, all 27 regular seasons, historical team counts, records, game classification, imports, and matchup arithmetic.

Optional browser checks require Playwright and Chromium already installed:

```sh
node tests/browser.cjs
node tests/upcoming-browser.cjs
```

Set `BROWSER=webkit` to run the same interaction checks in WebKit. Set `PLAYWRIGHT_PATH` to a Playwright module path and `CHROMIUM_PATH` to a Chromium executable if they are not available at their defaults. Tests cover direct-file loading, sorting, dates, preferences, historical seasons, playoff and empty states, import/refresh, matchups, and mobile overflow. Screenshots are written to `/tmp`.

## Attribution

Adapted from `NFL_Ratings/NFLPowerRatings.html`; its original source header specifies MIT. Page content retains the original CC BY 4.0 attribution to [entangledparticles.xyz](https://entangledparticles.xyz/). NBA data remains subject to its original terms.
