"""Offline checks for the pace export and ESPN failure retention."""
import csv
import importlib.util
import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('forecast_export', Path(__file__).resolve().parents[1] / 'scripts/sync-upcoming.py')
export = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export)

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    source = root / 'source'
    (source / 'team_game_logs').mkdir(parents=True)
    (source / 'box_score_advanced').mkdir()
    log_fields = ['game_id', 'game_date', 'game_type', 'team_abbreviation_home', 'team_abbreviation_road']
    advanced_fields = ['game_id', 'possessions_home', 'possessions_road', 'minutes_home', 'minutes_road']
    logs = source / 'team_game_logs/team_game_logs_2026-27.csv'
    advanced = source / 'box_score_advanced/box_score_advanced_2026-27.csv'
    def write(file, fields, rows):
        with file.open('w') as f:
            writer = csv.writer(f)
            writer.writerow(fields)
            writer.writerows(rows)
    write(logs, log_fields, [['regular','2026-11-01','regular_season','BOS','NYK'], ['cup','2026-11-02','nba_cup_final','BOS','NYK']])
    write(advanced, advanced_fields, [['regular',110,112,265,265], ['cup',100,100,240,240]])
    pace = export.build_pace(source, 2026)
    assert len(pace) == 1 and pace[0]['possessions'] == 111 and pace[0]['minutes'] == 53
    assert export.build_pace(source, 2099) == []
    write(advanced, advanced_fields, [['regular',110,112,265,265], ['regular',110,112,265,265]])
    try:
        export.build_pace(source, 2026)
        raise AssertionError('Duplicates must be rejected')
    except ValueError as error:
        assert 'Duplicate' in str(error)
    write(advanced, advanced_fields, [['regular',110,112,265,265]])
    (root / 'data').mkdir()
    saved = {'events':[], 'dates':['2026-11-01','2026-11-02'], 'fetchedAt':'2026-11-01T12:00:00Z'}
    target = root / 'data/forecast.js'
    target.write_text('window.NBA_FORECAST = ' + json.dumps(saved) + ';\n')
    with patch.object(export, 'ROOT', root), patch.object(export, 'urlopen', side_effect=OSError('offline')), patch.object(sys, 'argv', ['sync-upcoming.py','--source',str(source)]):
        export.main()
    result = json.loads(target.read_text().removeprefix('window.NBA_FORECAST = ').strip().removesuffix(';'))
    assert result['fetchedAt'] == saved['fetchedAt'] and result['dates'] == saved['dates']
print('PASS: actual possession averaging, overtime minutes, regular-season scope, duplicate rejection, missing season and dated ESPN fallback.')
