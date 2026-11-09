// Adapted from NFL_Ratings/NFLPowerRatings.html. Original source license: MIT.
'use strict';

function showStatus(message, type) {
    const { statusMessage } = elements;

    statusMessage.classList.remove(
        'status-message--loading',
        'status-message--error',
        'status-message--success',
        'status-message--stale',
    );

    statusMessage.classList.add(`status-message--${type}`, 'status-message--visible');
    statusMessage.textContent = message;
}

function hideStatus() {
    elements.statusMessage.className = 'status-message';
    elements.statusMessage.textContent = ''; 
}

function createMatrix(rows, cols) {
    return Array.from({ length: rows }, () => Array(cols).fill(0));
}

function createVector(length) {
    return Array(length).fill(0);
}

function transposeMatrix(matrix) {
    const rows = matrix.length;
    const cols = matrix[0].length;

    const transposed = createMatrix(cols, rows);

    for (let i = 0; i < rows; i += 1) {
        for (let j = 0; j < cols; j += 1) {
            transposed[j][i] = matrix[i][j];
        }
    }

    return transposed;
}

function multiplyMatrices(A, B) {
    const rowsA = A.length;
    const colsA = A[0].length;
    const rowsB = B.length;
    const colsB = B[0].length;

    if (colsA !== rowsB) {
        throw new Error(`Matrix dimensions incompatible: ${colsA} !== ${rowsB}`);
    }

    const result = createMatrix(rowsA, colsB);

    for (let i = 0; i < rowsA; i += 1) {
        for (let j = 0; j < colsB; j += 1) {
            let sum = 0;
            for (let k = 0; k < colsA; k += 1) {
                sum += A[i][k] * B[k][j];
            }
            result[i][j] = sum;
        }
    }

    return result;
}

function multiplyMatrixVector(matrix, vector) {
    const rows = matrix.length;
    const cols = matrix[0].length;

    if (cols !== vector.length) {
        throw new Error('Matrix and vector dimensions incompatible');
    }

    const result = createVector(rows);
    for (let i = 0; i < rows; i += 1) {
        let sum = 0;
        for (let j = 0; j < cols; j += 1) {
            sum += matrix[i][j] * vector[j];
        }
        result[i] = sum;
    }

    return result;
}

function invertMatrix(matrix) {
    const n = matrix.length;

    const augmented = matrix.map((row, i) => {
        const identityRow = Array(n).fill(0);
        identityRow[i] = 1;
        return [...row, ...identityRow];
    });

    for (let col = 0; col < n; col += 1) {

        let maxRow = col;
        let maxVal = Math.abs(augmented[col][col]);

        for (let row = col + 1; row < n; row += 1) {
            const absVal = Math.abs(augmented[row][col]);
            if (absVal > maxVal) {
                maxVal = absVal;
                maxRow = row;
            }
        }

        if (maxRow !== col) {
            [augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];
        }

        const pivot = augmented[col][col];
        if (Math.abs(pivot) < 1e-12) {
            throw new Error('This game range cannot identify all team ratings and home-court advantage. Select a wider date range.');
        }

        const scaleFactor = augmented[col][col];
        for (let j = 0; j < 2 * n; j += 1) {
            augmented[col][j] /= scaleFactor;
        }

        for (let row = 0; row < n; row += 1) {
            if (row !== col) {
                const factor = augmented[row][col];
                for (let j = 0; j < 2 * n; j += 1) {
                    augmented[row][j] -= factor * augmented[col][j];
                }
            }
        }
    }

    const inverse = augmented.map((row) => row.slice(n));

    return inverse;
}

function buildDesignMatrix(games) {

    const validGames = games.filter((game) => {
        const homeTeam = normalizeTeamAbbr(game.home_team);
        const awayTeam = normalizeTeamAbbr(game.away_team);
        return homeTeam && awayTeam;
    });

    const numGames = validGames.length;

    if (validGames.length < games.length) {
        console.warn(`Skipped ${games.length - validGames.length} games with unknown teams`);
    }

    const X = createMatrix(numGames, NUM_PREDICTORS);
    const y = createVector(numGames);

    validGames.forEach((game, rowIndex) => {

        const homeTeam = normalizeTeamAbbr(game.home_team);
        const awayTeam = normalizeTeamAbbr(game.away_team);

        const homeIndex = TEAM_INDEX_MAP[homeTeam];
        const awayIndex = TEAM_INDEX_MAP[awayTeam];

        const locationValue = String(game.location || '').toLowerCase().trim();
        const isNeutralSite = locationValue !== 'home' && locationValue !== '';
        X[rowIndex][0] = isNeutralSite ? 0 : 1;

        X[rowIndex][homeIndex] = 1;
        X[rowIndex][awayIndex] = -1;

        y[rowIndex] = game.home_score - game.away_score;
    });

    return { X, y, validGames: numGames };
}

function performOLSRegression(X, y) {
    const homeRows = X.map((row, i) => i).filter(i => X[i][0] === 1);
    if (homeRows.length < NUM_TEAMS) {
        throw new Error('Not enough non-neutral games to estimate home-court advantage. Select a wider date range.');
    }
    const firstStage = solveLeastSquares(
        homeRows.map(i => X[i].slice(0, -1)),
        homeRows.map(i => y[i]),
    );
    const homeFieldAdvantage = firstStage[0];
    const teamRatings = solveLeastSquares(
        X.map(row => row.slice(1, -1)),
        y.map((margin, i) => margin - X[i][0] * homeFieldAdvantage),
    );
    return [homeFieldAdvantage, ...teamRatings, 0];
}

function solveLeastSquares(X, y) {
    const Xt = transposeMatrix(X);
    const coefficients = multiplyMatrixVector(
        invertMatrix(multiplyMatrices(Xt, X)),
        multiplyMatrixVector(Xt, y),
    );
    if (!coefficients.every(Number.isFinite)) {
        throw new Error('Could not calculate stable ratings for this game range.');
    }
    return coefficients;
}

function calculateTeamRecords(games) {
    const records = {};

    Object.keys(TEAM_INDEX_MAP).forEach((team) => {
        records[team] = { wins: 0, losses: 0, ties: 0 };
    });

    games.forEach((game) => {
        const homeTeam = normalizeTeamAbbr(game.home_team);
        const awayTeam = normalizeTeamAbbr(game.away_team);

        if (!homeTeam || !awayTeam) return;

        const { home_score, away_score } = game;

        if (home_score > away_score) {

            records[homeTeam].wins += 1;
            records[awayTeam].losses += 1;
        } else if (away_score > home_score) {

            records[awayTeam].wins += 1;
            records[homeTeam].losses += 1;
        } else {

            records[homeTeam].ties += 1;
            records[awayTeam].ties += 1;
        }
    });

    return records;
}

function calculateRatingDecomposition(games) {
    const teamStats = {};

    Object.keys(TEAM_INDEX_MAP).forEach((team) => {
        teamStats[team] = {
            totalPointDiff: 0,
            gameCount: 0,
            opponentPointDiffs: [],
        };
    });

    games.forEach((game) => {
        const homeTeam = normalizeTeamAbbr(game.home_team);
        const awayTeam = normalizeTeamAbbr(game.away_team);

        if (!homeTeam || !awayTeam) return;

        const pointDiff = game.home_score - game.away_score;

        teamStats[homeTeam].totalPointDiff += pointDiff;
        teamStats[homeTeam].gameCount += 1;

        teamStats[awayTeam].totalPointDiff -= pointDiff;
        teamStats[awayTeam].gameCount += 1;
    });

    const avgPointDiffs = {};
    Object.keys(teamStats).forEach((team) => {
        avgPointDiffs[team] = teamStats[team].gameCount > 0
            ? teamStats[team].totalPointDiff / teamStats[team].gameCount
            : 0;
    });

    games.forEach((game) => {
        const homeTeam = normalizeTeamAbbr(game.home_team);
        const awayTeam = normalizeTeamAbbr(game.away_team);

        if (!homeTeam || !awayTeam) return;

        teamStats[homeTeam].opponentPointDiffs.push(avgPointDiffs[awayTeam]);
        teamStats[awayTeam].opponentPointDiffs.push(avgPointDiffs[homeTeam]);
    });

    const decomposition = {};
    Object.keys(teamStats).forEach((team) => {
        const avgPointDiff = avgPointDiffs[team];
        const opponentAvg = teamStats[team].opponentPointDiffs.length > 0
            ? teamStats[team].opponentPointDiffs.reduce((sum, val) => sum + val, 0) /
              teamStats[team].opponentPointDiffs.length
            : 0;

        const sos = opponentAvg;

        decomposition[team] = {
            avgPointDiff,
            sos,
            gameCount: teamStats[team].gameCount,
        };
    });

    return decomposition;
}

function calculatePowerRatings(beta, games) {

    const homeFieldAdvantage = beta[0];

    const teamBetas = beta.slice(1);

    const meanBeta = teamBetas.reduce((sum, val) => sum + val, 0) / teamBetas.length;

    const teamRecords = calculateTeamRecords(games);

    const decomposition = calculateRatingDecomposition(games);

    const ratings = teamBetas.map((rawRating, index) => {
        const teamAbbr = INDEX_TEAM_MAP[index + 1];
        const record = teamRecords[teamAbbr];
        const decompStats = decomposition[teamAbbr];
        const rating = rawRating - meanBeta;

        const sos = rating - decompStats.avgPointDiff;

        return {
            team: teamAbbr,
            teamName: TEAM_NAMES[teamAbbr],
            rating: rating,
            wins: record.wins,
            losses: record.losses,
            ties: record.ties,
            avgPointDiff: decompStats.avgPointDiff,
            sos: sos,
        };
    });

    ratings.sort((a, b) => b.rating - a.rating);

    return { homeFieldAdvantage, ratings };
}

function isValidScore(value) {

    if (value === undefined || value === null || value === '') {
        return false;
    }

    const strValue = String(value).trim().toUpperCase();

    if (strValue === '' || strValue === 'NA' || strValue === 'N/A' || strValue === 'NULL') {
        return false;
    }

    const numValue = Number(value);
    if (!Number.isFinite(numValue) || !Number.isInteger(numValue) || numValue < 0) {
        return false;
    }

    return true;
}

function parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    values.push(current.trim());

    return values;
}

function sortRatings(ratings) {
    const sorted = [...ratings];
    const { sortColumn, sortDirection } = appState;
    const multiplier = sortDirection === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
        let comparison = 0;

        switch (sortColumn) {
            case 'team':

                comparison = a.teamName.localeCompare(b.teamName);
                break;
            case 'rating':

                comparison = a.rating - b.rating;
                break;
            case 'wins':

                comparison = a.wins - b.wins;
                break;
            case 'losses':

                comparison = a.losses - b.losses;
                break;
            case 'ties':

                comparison = a.ties - b.ties;
                break;
            case 'pointdiff':

                comparison = a.avgPointDiff - b.avgPointDiff;
                break;
            case 'sos':

                comparison = a.sos - b.sos;
                break;
            case 'movementPoints':
            case 'movementRanks': {
                const field = sortColumn === 'movementPoints' ? 'points' : 'ranks';
                const left = movement.get(a.team)?.[field];
                const right = movement.get(b.team)?.[field];
                if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1;
                comparison = left - right;
                break;
            }
            case 'rank':
            default:

                comparison = b.rating - a.rating;

                return (a.rating - b.rating) * -multiplier;
        }

        return comparison * multiplier;
    });

    return sorted;
}

function updateSortIndicators() {
    const headers = document.querySelectorAll('.results-table th[data-sort]');

    headers.forEach((header) => {
        const column = header.getAttribute('data-sort');
        const indicator = header.querySelector('.sort-indicator');

        if (column === appState.sortColumn) {
            header.classList.add('sort-active');
            header.setAttribute('aria-sort', appState.sortDirection === 'asc' ? 'ascending' : 'descending');
            indicator.textContent = appState.sortDirection === 'asc' ? '▲' : '▼';
        } else {
            header.classList.remove('sort-active');
            header.setAttribute('aria-sort', 'none');
            indicator.textContent = '↕';
        }
    });
}

function handleSortClick(event) {
    const header = event.target.closest('th[data-sort]');
    if (!header) return;

    const column = header.getAttribute('data-sort');

    if (column === appState.sortColumn) {
        appState.sortDirection = appState.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        appState.sortColumn = column;
        appState.sortDirection = ['rank', 'team'].includes(column) ? 'asc' : 'desc';
    }

    savePreferences();

    updateSortIndicators();
    renderTableBody();
}

function renderTableBody() {
    const { resultsBody } = elements;
    const sortedRatings = sortRatings(appState.currentRatings);

    resultsBody.innerHTML = '';

    sortedRatings.forEach((teamData, index) => {

        const originalRank = appState.currentRatings
            .filter((t) => t.rating > teamData.rating).length + 1;

        const { team, teamName, rating, wins, losses, avgPointDiff, sos } = teamData;

        const row = document.createElement('tr');

        let ratingClass = 'rating-cell--neutral';
        if (rating > 0.5) {
            ratingClass = 'rating-cell--positive';
        } else if (rating < -0.5) {
            ratingClass = 'rating-cell--negative';
        }

        let pointDiffClass = 'rating-cell--neutral';
        if (avgPointDiff > 0.5) {
            pointDiffClass = 'rating-cell--positive';
        } else if (avgPointDiff < -0.5) {
            pointDiffClass = 'rating-cell--negative';
        }

        let sosClass = 'rating-cell--neutral';
        if (sos > 0.5) {
            sosClass = 'rating-cell--positive';
        } else if (sos < -0.5) {
            sosClass = 'rating-cell--negative';
        }

        row.innerHTML = `
  <td class="rank-cell">${originalRank}</td>
  <td class="team-cell">
    <span class="team-cell__full">${escapeHTML(teamName)}</span><span class="team-cell__nickname">${escapeHTML(teamName.split(' ').pop())}</span>
    <span class="team-cell__abbr">${escapeHTML(team)}</span>
  </td>
  <td class="rating-cell numeric-cell ${ratingClass}">
    ${signedValue(rating)}
  </td>
  <td class="record-cell">${wins}</td>
  <td class="record-cell">${losses}</td>
  
  <td class="movement">${movementText(team, false)}</td><td class="movement">${movementText(team, true)}</td>
  <td class="rating-cell numeric-cell ${pointDiffClass}">
    ${signedValue(avgPointDiff)}
  </td>
  <td class="rating-cell numeric-cell ${sosClass}">
    ${signedValue(sos)}
  </td>
`;

        resultsBody.appendChild(row);
    });
}

function renderResultsTable(results, gamesCount) {
    const { resultsSection, hfaValue } = elements;

    appState.currentRatings = results.ratings;
    appState.currentHFA = results.homeFieldAdvantage;

    elements.gamesCount.textContent = gamesCount;
    document.getElementById('results-range').textContent = selectionLabel();

    hfaValue.textContent = results.homeFieldAdvantage.toFixed(2);

    const tableHead = document.querySelector('.results-table thead');
    tableHead.onclick = handleSortClick;

    updateSortIndicators();

    renderTableBody();

    resultsSection.classList.add('results-section--visible');
    document.getElementById('analysis-context').textContent = selectionLabel();
    populateMatchups();
    updateMatchup();
    showView();
    syncFloatingHeader();
}

function readStored(key) {
    try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + key)); }
    catch { return null; }
}

function writeStored(key, value) {
    try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); }
    catch { document.getElementById('storage-note').textContent = 'Browser storage is unavailable or full. You can still use the app, but data or settings may not persist.'; }
}

function signedValue(value) {
    const rounded = Number(value.toFixed(1));
    return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`;
}

function movementText(team, ranks) {
    const item = movement.get(team);
    if (!item) return '—';
    const value = ranks ? item.ranks : item.points;
    const formatted = ranks ? String(value) : Number(value.toFixed(1)).toFixed(1);
    return (Number(formatted) > 0 ? '+' : '') + formatted;
}

function matchupMargin(a, b, venue, hfa) {
    return a - b + (venue === 'a' ? hfa : venue === 'b' ? -hfa : 0);
}

function updateMatchup() {
    const a = document.getElementById('matchup-a').value;
    const b = document.getElementById('matchup-b').value;
    const output = document.getElementById('matchup-result');
    const venue = document.getElementById('matchup-venue');
    venue.options[1].textContent = `${TEAM_NAMES[a]} home`;
    venue.options[2].textContent = `${TEAM_NAMES[b]} home`;
    output.classList.toggle('is-notice', a === b);
    document.querySelector('#matchup-view .table-container').hidden = a === b;
    document.getElementById('mobile-matchup').hidden = a === b;
    renderMatchupStats(a === b ? [] : [a, b]);
    if (a === b) { output.textContent = 'Choose two different teams.'; return; }
    const first = appState.currentRatings.find(t => t.team === a);
    const second = appState.currentRatings.find(t => t.team === b);
    if (!first || !second) { output.textContent = 'Ratings are not available for this selection.'; return; }
    const margin = matchupMargin(first.rating, second.rating, document.getElementById('matchup-venue').value, appState.currentHFA);
    output.textContent = Math.abs(margin) < 0.05 ? 'Even matchup' : `${margin > 0 ? first.teamName : second.teamName} by ${Math.abs(margin).toFixed(1)} points`;
}

function initializeFloatingHeader() {
    const original = document.querySelector('#results-section .results-table');
    const floating = document.createElement('div');
    floating.className = 'floating-head';
    floating.id = 'floating-head';
    floating.hidden = true;
    const table = document.createElement('table');
    table.className = 'results-table';
    table.setAttribute('aria-label', 'Power ratings column sorting');
    table.append(original.tHead.cloneNode(true));
    floating.append(table);
    document.body.append(floating);
    floating.onclick = handleSortClick;
    window.addEventListener('scroll', syncFloatingHeader, {passive:true});
    window.addEventListener('resize', syncFloatingHeader);
    window.addEventListener('hashchange', syncFloatingHeader);
    original.parentElement.addEventListener('scroll', syncFloatingHeader, {passive:true});
    syncFloatingHeader();
}

function syncFloatingHeader() {
    const floating = document.getElementById('floating-head');
    if (!floating) return;
    const original = document.querySelector('#results-section .results-table');
    const wrapper = original.parentElement;
    const rect = wrapper.getBoundingClientRect();
    const height = original.tHead.getBoundingClientRect().height;
    const visible = !elements.resultsSection.hidden && appState.currentRatings.length && rect.top < 0 && rect.bottom > height;
    floating.hidden = !visible;
    if (!visible) return;
    floating.style.left = `${rect.left}px`;
    floating.style.width = `${rect.width}px`;
    floating.firstElementChild.style.width = `${original.getBoundingClientRect().width}px`;
    [...original.tHead.rows[0].cells].forEach((cell,index) => {
        floating.querySelectorAll('th')[index].style.width = `${cell.getBoundingClientRect().width}px`;
    });
    floating.scrollLeft = wrapper.scrollLeft;
}

function showView() {
    const matchup = location.hash === '#matchup';
    const ready = appState.currentRatings.length > 0;
    document.getElementById('empty-state').hidden = matchup || ready;
    syncFloatingHeader();
    elements.statusMessage.hidden = false;
    document.querySelector('.control-panel').hidden = matchup;
    elements.resultsSection.hidden = matchup;
    document.getElementById('matchup-view').hidden = !matchup || !ready;
    document.getElementById('view-message').hidden = !matchup || ready;
    for (const [id, active] of [['ratings-link', !matchup], ['matchup-link', matchup]]) {
        const link = document.getElementById(id);
        if (active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    }
}

function renderMobileMatchup(teams) {
    const container = document.getElementById('mobile-matchup');
    container.replaceChildren();
    if (teams.length !== 2) return;
    const data = teams.map(team => appState.currentRatings.find(t => t.team === team));
    if (data.some(t => !t)) return;
    const table = document.createElement('table');
    const caption = table.createCaption();
    caption.textContent = 'Team comparison';
    const head = table.createTHead().insertRow();
    for (const label of ['Metric', ...teams]) {
        const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; head.append(th);
    }
    const body = table.createTBody();
    const metrics = [
        ['Rank', t => appState.currentRatings.filter(other => other.rating > t.rating).length + 1],
        ['Rating', t => signedValue(t.rating)],
        ['Record (W–L)', t => `${t.wins}–${t.losses}`],
        ['Δ Rating', t => movementText(t.team,false)],
        ['Δ Rank', t => movementText(t.team,true)],
        ['Pt Diff', t => signedValue(t.avgPointDiff)],
        ['SOS', t => signedValue(t.sos)]
    ];
    for (const [label, value] of metrics) {
        const row = body.insertRow();
        const th = document.createElement('th'); th.scope = 'row'; th.textContent = label; row.append(th);
        data.forEach(team => { row.insertCell().textContent = value(team); });
    }
    container.append(table);
}

function renderMatchupStats(teams) {
    const body = document.getElementById('matchup-stats');
    body.replaceChildren();
    renderMobileMatchup(teams);
    for (const abbr of teams) {
        const team = appState.currentRatings.find(t => t.team === abbr);
        if (!team) continue;
        const row = document.createElement('tr');
        const rank = appState.currentRatings.filter(t => t.rating > team.rating).length + 1;
        const signed = signedValue;
        for (const value of [rank, team.teamName, signed(team.rating), team.wins, team.losses, movementText(abbr,false), movementText(abbr,true), signed(team.avgPointDiff), signed(team.sos)]) {
            const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
        }
        body.appendChild(row);
    }
}

const STORAGE_PREFIX = 'nba-ratings-v1-';
const elements = {
    seasonSelect: document.getElementById('season-select'),
    startDate: document.getElementById('start-date'),
    endDate: document.getElementById('end-date'),
    gameType: document.getElementById('game-type'),
    statusMessage: document.getElementById('status-message'),
    resultsSection: document.getElementById('results-section'),
    resultsBody: document.getElementById('results-body'),
    gamesCount: document.getElementById('games-count'),
    hfaValue: document.getElementById('hfa-value'),
    fileUploadSection: document.getElementById('file-upload-section'),
    fileUpload: document.getElementById('file-upload'),
};
const appState = {gamesData: [], currentRatings: [], currentHFA: 0, sortColumn: 'rating', sortDirection: 'desc', loadingData: false};
let TEAM_INDEX_MAP = {}, INDEX_TEAM_MAP = {}, TEAM_NAMES = {};
let NUM_TEAMS = 0, NUM_PREDICTORS = 1;
let movement = new Map();
let calculationVersion = 0;
let scrubDates = [];

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function normalizeTeamAbbr(abbr) { return TEAM_INDEX_MAP[abbr] ? abbr : null; }
function seasonLabel(season) { return `${season}–${String(Number(season) + 1).slice(-2)}`; }
function formatDate(date) {
    return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'});
}
function selectionLabel() {
    return `${seasonLabel(elements.seasonSelect.value)} · ${formatDate(elements.startDate.value)} – ${formatDate(elements.endDate.value)} · ${elements.gameType.selectedOptions[0].textContent}`;
}
function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const header = parseCSVLine(lines.shift().replace(/^\uFEFF/, ''));
    const required = ['game_id','game_date','season','game_type','neutral_site','team_abbreviation_home','team_abbreviation_road','pts_home','pts_road'];
    const columns = Object.fromEntries(header.map((name,i) => [name,i]));
    if (required.some(key => columns[key] === undefined)) throw new Error('Choose a full-game NBA team_game_logs CSV with dates, teams, scores, game types, and neutral-site flags.');
    const games = [], seen = new Set();
    const today = new Date().toLocaleDateString('en-CA', {timeZone:'America/New_York'});
    for (const [index,line] of lines.entries()) {
        if (!line.trim()) continue;
        const values = parseCSVLine(line);
        const get = key => values[columns[key]];
        let date = get('game_date');
        const shortDate = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(date);
        if (shortDate) {
            const [,month,day,year] = shortDate;
            date = `${year.length === 2 ? '20' + year : year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
        }
        const season = Number(get('season').slice(0,4));
        const id = get('game_id');
        const home = get('team_abbreviation_home'), away = get('team_abbreviation_road');
        const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
        if (!validDate || !Number.isInteger(season) || season < 1946 || !id || !/^[A-Z]{2,4}$/.test(home) || !/^[A-Z]{2,4}$/.test(away) || home === away) throw new Error(`Invalid game identity or date on CSV row ${index+2}.`);
        if (seen.has(id)) throw new Error(`Duplicate game ID ${id}.`);
        seen.add(id);
        if (date > today) continue;
        if (!isValidScore(get('pts_home')) || !isValidScore(get('pts_road')) || get('pts_home') === get('pts_road')) throw new Error(`Invalid final score on CSV row ${index+2}.`);
        const neutral = get('neutral_site').toLowerCase();
        if (!['true','false'].includes(neutral)) throw new Error(`Invalid neutral-site flag on CSV row ${index+2}.`);
        const gameType = ({playoff:'playoffs', playin:'play_in'})[get('game_type')] || get('game_type');
        if (!['regular_season','nba_cup_semi','nba_cup_final','play_in','playoffs'].includes(gameType)) throw new Error(`Unknown game type on CSV row ${index+2}.`);
        games.push({game_id:id, season, gameday:date, game_type:gameType, home_team:home, away_team:away,
            home_name:get('team_name_home') || home, away_name:get('team_name_road') || away,
            home_score:Number(get('pts_home')), away_score:Number(get('pts_road')), location:neutral === 'true' ? 'Neutral' : 'Home'});
    }
    if (!games.length) throw new Error('No completed games found.');
    return games.sort((a,b) => a.gameday.localeCompare(b.gameday) || a.game_id.localeCompare(b.game_id));
}
function matchesType(game, type) {
    return type === 'all' || (type === 'regular' ? ['regular_season','nba_cup_semi'].includes(game.game_type) : game.game_type === 'playoffs');
}
function seasonGames() {
    return appState.gamesData.filter(g => g.season === Number(elements.seasonSelect.value) && matchesType(g,elements.gameType.value));
}
function filterGames(games, season, start, end, type = elements.gameType.value) {
    return games.filter(g => g.season === season && matchesType(g,type) && g.gameday >= start && g.gameday <= end);
}
function configureTeams(games) {
    TEAM_NAMES = {};
    for (const g of games) { TEAM_NAMES[g.home_team] = g.home_name; TEAM_NAMES[g.away_team] = g.away_name; }
    const teams = Object.keys(TEAM_NAMES).sort();
    TEAM_INDEX_MAP = Object.fromEntries(teams.map((t,i) => [t,i+1]));
    INDEX_TEAM_MAP = Object.fromEntries(teams.map((t,i) => [i+1,t]));
    NUM_TEAMS = teams.length;
    NUM_PREDICTORS = NUM_TEAMS + 1;
}
function populateMatchups() {
    for (const id of ['matchup-a','matchup-b']) {
        const select = document.getElementById(id), previous = select.value;
        select.replaceChildren();
        Object.entries(TEAM_NAMES).sort((a,b) => a[1].localeCompare(b[1])).forEach(([team,name]) => select.add(new Option(name,team)));
        select.value = TEAM_NAMES[previous] ? previous : [...select.options].find(option => id === 'matchup-a' || option.value !== document.getElementById('matchup-a').value)?.value || '';
    }
}
function savePreferences() {
    writeStored('preferences', {season:elements.seasonSelect.value,start:elements.startDate.value,end:elements.endDate.value,type:elements.gameType.value,sortColumn:appState.sortColumn,sortDirection:appState.sortDirection,teamA:document.getElementById('matchup-a').value,teamB:document.getElementById('matchup-b').value,venue:document.getElementById('matchup-venue').value});
}
function invalidateResults() {
    appState.currentRatings = [];
    movement.clear();
    elements.resultsSection.classList.remove('results-section--visible');
    showView();
}
function updateRange(reset = false) {
    const games = seasonGames();
    configureTeams(games);
    const dates = games.map(g => g.gameday).sort();
    scrubDates = [...new Set(dates)];
    const first = dates[0], last = dates.at(-1);
    for (const input of [elements.startDate,elements.endDate]) {
        input.disabled = appState.loadingData || !games.length;
        input.min = first || ''; input.max = last || '';
    }
    if (reset || !elements.startDate.value || elements.startDate.value < first || elements.startDate.value > last) elements.startDate.value = first || '';
    if (reset || !elements.endDate.value || elements.endDate.value > last || elements.endDate.value < first) elements.endDate.value = last || '';
    if (elements.startDate.value > elements.endDate.value) {
        elements.endDate.value = elements.startDate.value;
        document.getElementById('range-adjustment').textContent = 'End date moved to match the start date.';
    }
    syncScrubbers();
    document.getElementById('week-availability').textContent = games.length ? `${seasonLabel(elements.seasonSelect.value)} · Results through ${formatDate(last)} · ${games.length.toLocaleString()} games recorded` : `${seasonLabel(elements.seasonSelect.value)} · No results for this game selection.`;
}
// Keep the two thumbs within the selected interval. Manual date entry can
// still use off-days; slider steps always correspond to recorded game dates.
function syncScrubbers() {
    for (const side of ['start','end']) {
        const date = elements[side + 'Date'].value;
        const slider = document.getElementById(side + '-scrubber');
        const previous = document.getElementById(side + '-previous');
        const next = document.getElementById(side + '-next');
        const allowed = scrubDates.map((day,index) => ({day,index})).filter(({day}) =>
            side === 'start' ? day <= elements.endDate.value : day >= elements.startDate.value);
        const disabled = appState.loadingData || !allowed.length;
        slider.min = allowed[0]?.index ?? 0;
        slider.max = allowed.at(-1)?.index ?? 0;
        const selected = side === 'start'
            ? allowed.find(item => item.day >= date) || allowed.at(-1)
            : allowed.findLast(item => item.day <= date) || allowed[0];
        slider.value = selected?.index ?? 0;
        slider.disabled = disabled || allowed.length < 2;
        slider.setAttribute('aria-valuetext', date ? formatDate(date) : 'No game dates');
        previous.disabled = disabled || !allowed.some(item => item.day < date);
        next.disabled = disabled || !allowed.some(item => item.day > date);
    }
}
function scrubDate(side, date) {
    if (!date || appState.loadingData) return;
    elements[side + 'Date'].value = date;
    document.getElementById('range-adjustment').textContent = '';
    syncScrubbers();
    savePreferences();
    calculateRatings(true);
}
function initializeScrubbers() {
    for (const side of ['start','end']) {
        document.getElementById(side + '-scrubber').addEventListener('input',event => {
            scrubDate(side,scrubDates[Number(event.target.value)]);
        });
        for (const direction of ['previous','next']) {
            document.getElementById(side + '-' + direction).addEventListener('click',() => {
                const date = elements[side + 'Date'].value;
                const next = direction === 'previous' ? scrubDates.findLast(day => day < date) : scrubDates.find(day => day > date);
                scrubDate(side,next);
            });
        }
    }
}
function calculateMovement(season,start,end,results) {
    movement.clear();
    const priorEnd = new Date(Date.parse(end + 'T12:00:00Z') - 7*86400000).toISOString().slice(0,10);
    const previous = filterGames(appState.gamesData,season,start,priorEnd);
    const note = document.getElementById('comparison-note');
    try {
        if (previous.length < NUM_TEAMS) throw new Error('Insufficient history');
        const {X,y} = buildDesignMatrix(previous);
        const prior = calculatePowerRatings(performOLSRegression(X,y),previous).ratings;
        for (const team of results.ratings) {
            const old = prior.find(t => t.team === team.team);
            movement.set(team.team,{points:team.rating-old.rating,ranks:prior.filter(t => t.rating>old.rating).length-results.ratings.filter(t => t.rating>team.rating).length});
        }
        note.textContent = `Movement since ${formatDate(priorEnd)}, using the same start date.`;
    } catch {
        movement.clear();
        note.textContent = 'Weekly movement unavailable: the earlier range does not contain enough games to estimate every team.';
    }
}
async function calculateRatings(scrubbing = false) {
    const version = ++calculationVersion;
    const keepVisible = scrubbing && appState.currentRatings.length > 0;
    if (!keepVisible) invalidateResults();
    if (!seasonGames().length) {
        hideStatus();
        elements.resultsSection.setAttribute('aria-busy','false');
        return;
    }
    const season = Number(elements.seasonSelect.value), start = elements.startDate.value, end = elements.endDate.value;
    elements.resultsSection.setAttribute('aria-busy','true');
    if (!keepVisible) showStatus('Updating ratings…','loading');
    try {
        await new Promise(resolve => setTimeout(resolve,100));
        if (version !== calculationVersion) return;
        const games = filterGames(appState.gamesData,season,start,end);
        if (games.length < NUM_TEAMS) throw new Error(`Only ${games.length} games in this range. Select a wider date range.`);
        const {X,y} = buildDesignMatrix(games);
        const results = calculatePowerRatings(performOLSRegression(X,y),games);
        calculateMovement(season,start,end,results);
        renderResultsTable(results,games.length);
        savePreferences();
        hideStatus();
    } catch (error) {
        if (version === calculationVersion) {
            invalidateResults();
            showStatus(error.message,'error');
        }
    } finally {
        if (version === calculationVersion) elements.resultsSection.setAttribute('aria-busy','false');
    }
}
function setLoading(loading) {
    appState.loadingData = loading;
    syncScrubbers();
    for (const control of [elements.seasonSelect,elements.gameType,elements.startDate,elements.endDate,document.getElementById('refresh-data'),document.getElementById('import-data')]) control.disabled = loading;
    if (!loading) {
        elements.seasonSelect.disabled = elements.gameType.disabled = !appState.gamesData.length;
        updateRange();
    }
}
function describeData(games,source) {
    const last = games.at(-1).gameday;
    document.getElementById('data-freshness').textContent = `Results through ${formatDate(last)}`;
    document.getElementById('data-source').textContent = `${source} · ${games.length.toLocaleString()} completed games. Regular season includes NBA Cup semifinals; the Cup final and play-in games are included only under All games. Refresh reloads the exported data bundle. Imported CSVs replace the loaded dataset for this session.`;
}
function acceptData(games,source,preserve = false) {
    const oldSeason = elements.seasonSelect.value;
    appState.gamesData = games;
    elements.seasonSelect.replaceChildren();
    [...new Set(games.map(g => g.season))].sort((a,b) => b-a).forEach(season => elements.seasonSelect.add(new Option(seasonLabel(season),String(season))));
    if (preserve && [...elements.seasonSelect.options].some(o => o.value === oldSeason)) elements.seasonSelect.value = oldSeason;
    updateRange(true);
    describeData(games,source);
    elements.fileUploadSection.style.display = 'none';
}
async function loadBundle() {
    // A script bundle works both when hosted and when this HTML is opened directly.
    return new Promise((resolve,reject) => {
        const script = document.createElement('script');
        script.src = `data/games.js?v=${Date.now()}`;
        script.onload = () => { script.remove(); try { resolve(parseCSV(window.NBA_CSV)); } catch(error) { reject(error); } };
        script.onerror = () => { script.remove(); reject(new Error('Unable to load bundled data. Refresh or import a full-game NBA CSV.')); };
        document.head.append(script);
    });
}
async function refreshData() {
    ++calculationVersion;
    setLoading(true);
    try {
        acceptData(await loadBundle(),'NBA_Data full-game team logs',true);
        await calculateRatings();
    } catch(error) {
        showStatus(error.message,'error');
        elements.fileUploadSection.style.display = 'block';
    } finally { setLoading(false); }
}
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    ++calculationVersion;
    setLoading(true);
    try {
        const games = parseCSV(await file.text());
        acceptData(games,`Imported CSV: ${file.name}`);
        await calculateRatings();
    } catch(error) { showStatus(`Error loading file: ${error.message}`,'error'); }
    finally { setLoading(false); elements.fileUpload.value = ''; }
}
async function initializeApp() {
    initializeFloatingHeader();
    initializeScrubbers();
    window.addEventListener('hashchange',showView);
    for (const control of [elements.seasonSelect,elements.gameType,elements.startDate,elements.endDate]) {
        control.addEventListener('change',() => {
            document.getElementById('range-adjustment').textContent = '';
            updateRange(control === elements.seasonSelect || control === elements.gameType);
            savePreferences();
            calculateRatings();
        });
    }
    for (const id of ['matchup-a','matchup-b','matchup-venue']) document.getElementById(id).addEventListener('change',() => { updateMatchup(); savePreferences(); });
    elements.fileUpload.addEventListener('change',handleFileUpload);
    document.getElementById('import-data').onclick = () => elements.fileUpload.click();
    document.getElementById('refresh-data').onclick = refreshData;
    const prefs = readStored('preferences');
    setLoading(true);
    try {
        acceptData(await loadBundle(),'NBA_Data full-game team logs');
        if (prefs) {
            if ([...elements.seasonSelect.options].some(o => o.value === prefs.season)) elements.seasonSelect.value = prefs.season;
            if (['regular','playoffs','all'].includes(prefs.type)) elements.gameType.value = prefs.type;
            elements.startDate.value = prefs.start || '';
            // Always open at the latest result, even when an older range was saved.
            elements.endDate.value = '';
            updateRange();
            populateMatchups();
            for (const [id,value] of [['matchup-a',prefs.teamA],['matchup-b',prefs.teamB],['matchup-venue',prefs.venue]]) {
                const select = document.getElementById(id);
                if ([...select.options].some(o => o.value === value)) select.value = value;
            }
        }
        await calculateRatings();
    } catch(error) { showStatus(error.message,'error'); elements.fileUploadSection.style.display = 'block'; }
    finally { setLoading(false); showView(); }
}
document.addEventListener('DOMContentLoaded',initializeApp);
