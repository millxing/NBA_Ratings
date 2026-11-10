#!/usr/bin/env python3
"""Bundle ESPN's next two ET dates and Extra Pass's underlying pace inputs."""
import argparse
import csv
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]


def build_pace(source, season):
    label = f'{season}-{str(season + 1)[-2:]}'
    logs = source / 'team_game_logs' / f'team_game_logs_{label}.csv'
    advanced = source / 'box_score_advanced' / f'box_score_advanced_{label}.csv'
    if not logs.exists() or not advanced.exists():
        return []
    with logs.open() as f:
        regular = {r['game_id']: r for r in csv.DictReader(f)
                   if r['game_type'] in ('regular_season', 'nba_cup_semi')}
    games = []
    with advanced.open() as f:
        seen = set()
        for r in csv.DictReader(f):
            if r['game_id'] not in regular:
                continue
            if r['game_id'] in seen:
                raise ValueError(f'Duplicate advanced game: {r["game_id"]}')
            seen.add(r['game_id'])
            try:
                poss = (float(r['possessions_home']) + float(r['possessions_road'])) / 2
                minutes = (float(r['minutes_home']) + float(r['minutes_road'])) / 10
                if not all(math.isfinite(v) and v > 0 for v in (poss, minutes)):
                    raise ValueError('Nonpositive pace inputs')
            except (ValueError, KeyError):
                continue  # Absent inputs must never become an invented pace.
            g = regular[r['game_id']]
            games.append(dict(id=r['game_id'], date=g['game_date'], home=g['team_abbreviation_home'],
                              away=g['team_abbreviation_road'], possessions=poss, minutes=minutes))
    return games


def compact_event(e):
    c = e['competitions'][0]
    odds = []
    for o in c.get('odds') or []:
        odds.append({
            'provider': {'name': o.get('provider', {}).get('name', 'ESPN')},
            'pointSpread': {'home': {'close': {'line': o.get('pointSpread', {}).get('home', {}).get('close', {}).get('line')}}},
            **{k: o[k] for k in ('details', 'spread') if k in o},
            'homeTeamOdds': {'favorite': o.get('homeTeamOdds', {}).get('favorite')},
            'awayTeamOdds': {'favorite': o.get('awayTeamOdds', {}).get('favorite')},
        })
    return dict(id=e['id'], date=e['date'], season=e['season'], competitions=[dict(
        date=c['date'], neutralSite=c.get('neutralSite', False), status=c.get('status', e.get('status')),
        competitors=[{'homeAway': t['homeAway'], 'team': {k: t['team'][k] for k in ('abbreviation', 'displayName')}}
                     for t in c['competitors']], odds=odds)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT.parent / 'NBA_Data')
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    today = now.astimezone(ZoneInfo('America/New_York')).date()
    dates = [(today + timedelta(days=i)).isoformat() for i in range(2)]
    events = []
    fetched_at = now.isoformat()
    target = ROOT / 'data' / 'forecast.js'
    try:
        for day in dates:
            with urlopen('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=' + day.replace('-', ''), timeout=30) as f:
                data = json.load(f)
            if not isinstance(data.get('events'), list):
                raise ValueError('ESPN response has no events array')
            events.extend(compact_event(e) for e in data['events'])
    except (OSError, ValueError, KeyError) as error:
        print(f'ESPN unavailable; retaining the previous dated snapshot: {error}', file=sys.stderr)
        saved = json.loads(target.read_text().removeprefix('window.NBA_FORECAST = ').strip().removesuffix(';')) if target.exists() else {}
        events, dates, fetched_at = saved.get('events', []), saved.get('dates', []), saved.get('fetchedAt')
    season = today.year if today.month >= 9 else today.year - 1
    bundle = dict(fetchedAt=fetched_at, dates=dates, season=season,
                  events=events, paceGames=build_pace(args.source, season))
    target.write_text('window.NBA_FORECAST = ' + json.dumps(bundle, separators=(',', ':')) + ';\n')
    print(f'Exported {len(events)} scheduled events and {len(bundle["paceGames"])} pace games to {target}')


if __name__ == '__main__':
    main()
