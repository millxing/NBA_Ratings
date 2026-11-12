# NBA Ratings update scheduling

## Reason for the external trigger

GitHub scheduled events can start late. The November 11, 2026 scheduled run
started at 1:49 p.m. Eastern, although the workflow specifies 6:30 a.m.

cron-job.org can start the existing `update-data.yml` workflow through GitHub's
`workflow_dispatch` API. This bypasses the scheduled-event mechanism, but does
not remove runner queues or Pages deployment delays.

## Schedule

The daily trigger times are **6:35 a.m. and 6:50 a.m.**, with timezone
`America/New_York`. This timezone follows daylight saving time. GitHub's existing
6:30 a.m. schedule remains a fallback.

Verified on November 12, 2026: NBA_Data game logs were committed near 6:01 a.m.
Eastern on November 10, 11, and 12. This is evidence for the chosen times, not a
guarantee of future upstream completion. If NBA_Data is late, an on-time Ratings
update can still publish old results.

Job name: **NBA Ratings — daily morning update**. Job ID: `8851681`.

## Request

- Method: `POST`.
- URL: `https://api.github.com/repos/millxing/NBA_Ratings/actions/workflows/update-data.yml/dispatches`.
- JSON body: `{"ref":"main"}`.
- Headers: `Accept: application/vnd.github+json`, `Content-Type: application/json`,
  and `Authorization: Bearer <GitHub token>`.
- Use a fine-grained GitHub token restricted to `millxing/NBA_Ratings`, with
  **Actions: read and write** permission.
- Store the token only in the job's Authorization header. Never commit secrets.
- The cron-job.org API key manages jobs; it is separate from the GitHub token.

Each trigger runs the full export, validation, and publication process. The
second trigger does not skip the run when an earlier update succeeded. The
workflow's concurrency group prevents simultaneous update runs.

## Monitoring and maintenance

Enable email notifications for trigger failure, recovery, and automatic disable.
A successful HTTP response confirms only that GitHub accepted the trigger.
Check the Actions run and Pages deployment to confirm publication.

- Workflow: https://github.com/millxing/NBA_Ratings/actions/workflows/update-data.yml
- Site: https://millxing.github.io/NBA_Ratings/
- Check the latest included game date in `data/games.js`.
- Check `fetchedAt` and `dates` in `data/forecast.js`.
- ESPN failures can retain an older schedule snapshot even when the workflow succeeds.
- The GitHub token expires **July 31, 2027 at 00:00 Eastern** (04:00 UTC).
  Replace it before that date and update the job's Authorization header.

Manual update:

```sh
gh workflow run update-data.yml --repo millxing/NBA_Ratings
```

## Verification — November 12, 2026

- cron-job.org ran the live test at 12:14:02 p.m. Eastern, about two seconds
  after the scheduled time. GitHub returned HTTP `204`.
- [The resulting workflow run](https://github.com/millxing/NBA_Ratings/actions/runs/43267229758)
  passed its export/model/forecast checks and deployed GitHub Pages successfully.
- The published results included completed games through November 11.
- The published forecast had `fetchedAt` of `2026-11-12T17:14:24.394379+00:00`
  and schedule dates of November 12 and 13.
- The daily schedule was saved and read back. The next runs were November 13
  at 6:35 and 6:50 a.m. Eastern.
- Trigger-failure, recovery, and automatic-disable notifications are enabled
  for the account email.

