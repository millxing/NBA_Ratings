#!/usr/bin/env python3
"""Export full-game NBA logs into a portable browser data bundle."""
import argparse
import csv
import io
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[2] / 'NBA_Data')
args = parser.parse_args()
files = sorted((args.source / 'team_game_logs').glob('team_game_logs_[0-9]*.csv'))
if not files:
    raise SystemExit(f'No full-game logs found in {args.source}')
fields = ['game_id', 'game_date', 'season', 'game_type', 'neutral_site',
          'team_abbreviation_home', 'team_name_home', 'team_abbreviation_road',
          'team_name_road', 'pts_home', 'pts_road']
output = io.StringIO(newline='')
writer = csv.DictWriter(output, fieldnames=fields, lineterminator='\n')
writer.writeheader()
seen = set()
for file in files:
    with file.open(newline='') as handle:
        for row in csv.DictReader(handle):
            if row['game_id'] in seen:
                raise SystemExit(f'Duplicate game ID: {row["game_id"]}')
            seen.add(row['game_id'])
            for field in fields:
                if not row.get(field):
                    raise SystemExit(f'Missing {field} in {file}: {row["game_id"]}')
            for side in ['home', 'road']:
                if not row[f'pts_{side}'].isdigit():
                    raise SystemExit(f'Invalid score in {file}: {row["game_id"]}')
            writer.writerow({field: row[field] for field in fields})
target = Path(__file__).resolve().parents[1] / 'data' / 'games.js'
target.parent.mkdir(exist_ok=True)
target.write_text('window.NBA_CSV = ' + json.dumps(output.getvalue()) + ';\n')
print(f'Exported {len(seen):,} games from {len(files)} seasons to {target}')
