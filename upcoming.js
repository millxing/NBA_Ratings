'use strict';

const upcomingState = {snapshot: window.NBA_FORECAST, live: false, error: '', loading: false};
const ESPN_TEAMS = {NY:'NYK', GS:'GSW', SA:'SAS', NO:'NOP', UTAH:'UTA', WSH:'WAS', PHO:'PHX'};
function espnTeam(abbr) { return ESPN_TEAMS[abbr] || abbr; }
function easternDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const get = type => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}
function upcomingDates(now = new Date()) {
    const today = easternDate(now);
    return [today, new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0,10)];
}
function espnHomeSpread(odds = []) {
    for (const o of odds || []) {
        const line = o.pointSpread?.home?.close?.line;
        if (line !== null && line !== undefined && String(line).trim() !== '' && Number.isFinite(Number(line))) {
            return {line:Number(line), provider:o.provider?.name || 'ESPN'};
        }
        // Legacy payload: spread is signed for the home team; require favorite
        // flags to establish direction rather than guessing from the details text.
        if (o.spread !== null && o.spread !== undefined && Number.isFinite(Number(o.spread))) {
            const n = Math.abs(Number(o.spread));
            if (n === 0 || o.homeTeamOdds?.favorite === true || o.awayTeamOdds?.favorite === true) {
                return {line:n === 0 ? 0 : o.homeTeamOdds?.favorite === true ? -n : n, provider:o.provider?.name || 'ESPN'};
            }
        }
    }
    return null;
}
function scheduledGames(snapshot, now = new Date()) {
    const dates = upcomingDates(now);
    const seen = new Set();
    return (snapshot?.events || []).flatMap(e => {
        const c = e.competitions?.[0], status = c?.status?.type || e.status?.type;
        const date = c?.date || e.date;
        if (!date || !Number.isFinite(Date.parse(date)) || !dates.includes(easternDate(new Date(date))) || status?.state !== 'pre' || status?.name !== 'STATUS_SCHEDULED' || Date.parse(date) <= now.getTime() || seen.has(e.id)) return [];
        const home = c.competitors?.find(t => t.homeAway === 'home')?.team;
        const away = c.competitors?.find(t => t.homeAway === 'away')?.team;
        if (!home || !away) return [];
        seen.add(e.id);
        return [{id:e.id, date, season:Number(e.season?.year)-1, home:espnTeam(home.abbreviation), away:espnTeam(away.abbreviation), homeName:home.displayName, awayName:away.displayName, neutral:!!c.neutralSite, spread:espnHomeSpread(c.odds)}];
    }).sort((a,b) => a.date.localeCompare(b.date));
}
function forecastRatings(games, season, today) {
    const sample = games.filter(g => g.season === season && matchesType(g,'regular') && g.gameday < today);
    const previous = [TEAM_INDEX_MAP, INDEX_TEAM_MAP, TEAM_NAMES, NUM_TEAMS, NUM_PREDICTORS];
    try {
        configureTeams(sample);
        if (NUM_TEAMS !== 30 || sample.length < 30) throw new Error('Not enough earlier games to rate all 30 teams.');
        const {X,y} = buildDesignMatrix(sample);
        return {...calculatePowerRatings(performOLSRegression(X,y), sample), games:sample, cutoff:sample.map(g => g.gameday).sort().at(-1)};
    } finally {
        [TEAM_INDEX_MAP, INDEX_TEAM_MAP, TEAM_NAMES, NUM_TEAMS, NUM_PREDICTORS] = previous;
    }
}
function forecastPace(paceGames, sample, home, away) {
    const ids = new Set(sample.map(g => g.game_id));
    const rows = paceGames.filter(g => ids.has(g.id));
    if (!sample.length || rows.length !== ids.size || new Set(rows.map(g=>g.id)).size !== ids.size || rows.some(g => !Number.isFinite(g.possessions) || g.possessions <= 0 || !Number.isFinite(g.minutes) || g.minutes <= 0)) {
        throw new Error('Pace data is incomplete for the ratings cutoff.');
    }
    const aggregate = games => {
        if (!games.length) throw new Error('Team pace is unavailable.');
        return Math.round(10 * 48 * games.reduce((n,g)=>n+g.possessions,0) / games.reduce((n,g)=>n+g.minutes,0)) / 10;
    };
    const homeGames = rows.filter(g=>g.home===home || g.away===home);
    const awayGames = rows.filter(g=>g.home===away || g.away===away);
    const teamPace = homeGames.length >= 28 && awayGames.length >= 28;
    return {pace:teamPace ? (aggregate(homeGames)+aggregate(awayGames))/2 : aggregate(rows), method:teamPace ? 'Team average' : 'League', homeGames:homeGames.length, awayGames:awayGames.length};
}
function gameForecast(game, ratings, paceGames) {
    const home = ratings.ratings.find(t=>t.team===game.home), away = ratings.ratings.find(t=>t.team===game.away);
    if (!home || !away) throw new Error('Team ratings unavailable.');
    const pace = forecastPace(paceGames, ratings.games, game.home, game.away);
    const efficiencyMargin = home.rating - away.rating + (game.neutral ? 0 : ratings.homeFieldAdvantage);
    return {...pace, margin:efficiencyMargin * pace.pace / 100};
}
function spreadLabel(home, away, homeLine) {
    if (Math.abs(homeLine) < 0.05) return 'Pick’em';
    return `${homeLine < 0 ? home : away} −${Math.abs(homeLine).toFixed(1)}`;
}
function selectUpcomingGame(game, cutoff) {
    if (appState.loadingData) return;
    elements.seasonSelect.value = String(game.season);
    elements.gameType.value = 'regular';
    updateRange(true);
    elements.endDate.value = cutoff;
    syncScrubbers();
    calculateRatings().then(() => {
        document.getElementById('matchup-a').value = game.away;
        document.getElementById('matchup-b').value = game.home;
        document.getElementById('matchup-venue').value = game.neutral ? 'neutral' : 'b';
        updateMatchup(); savePreferences(); location.hash = '#matchup';
    });
}
function renderUpcoming() {
    const context = document.getElementById('upcoming-context');
    const body = document.getElementById('upcoming-body');
    if (!context || !body) return;
    body.replaceChildren();
    const dates = upcomingDates(), snapshot = upcomingState.snapshot;
    const stamp = snapshot?.fetchedAt ? new Date(snapshot.fetchedAt).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) + ' ET' : 'unknown';
    const complete = dates.every(day=>snapshot?.dates?.includes(day));
    const games = scheduledGames(snapshot);
    const notes = [`${formatDate(dates[0])} – ${formatDate(dates[1])} · Eastern time.`, `ESPN ${upcomingState.live ? 'checked' : 'snapshot'}: ${stamp}.`];
    if (upcomingState.loading) notes.push('Refreshing schedule and lines…');
    if (upcomingState.error) notes.push('Live refresh unavailable; showing the last retrieved schedule.');
    if (location.protocol === 'file:') notes.push('Local file: schedule and lines use the exported snapshot. The hosted app can attempt a live refresh.');
    if (!complete) notes.push('Schedule coverage is out of date. A newer snapshot or live refresh is needed for both days.');
    if (!games.length) notes.push(complete ? 'No upcoming unplayed games in this window.' : 'No current schedule available.');
    const forecasts = new Map();
    for (const game of games) {
        if (!forecasts.has(game.season)) {
            try {
                if (appState.imported) throw new Error('Refresh bundled results to use forecasts; imported results do not include verified pace coverage.');
                forecasts.set(game.season, forecastRatings(appState.gamesData,game.season,dates[0]));
            } catch(error) { forecasts.set(game.season,{error:error.message}); }
        }
    }
    for (const [season, ratings] of forecasts) {
        notes.push(ratings.error ? `Forecasts unavailable: ${ratings.error}` : `${seasonLabel(season)} regular-season ratings and pace through ${formatDate(ratings.cutoff)}; today’s results excluded.`);
    }
    context.textContent = notes.join(' ');
    for (const game of games) {
        const ratings = forecasts.get(game.season);
        let prediction, error = ratings.error;
        if (!error) try { prediction = gameForecast(game, ratings, snapshot.paceGames || []); } catch(e) { error = e.message; }
        const row = document.createElement('tr');
        const time = new Date(game.date).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
        row.innerHTML = `<td>${escapeHTML(time)} ET</td><td><button class="upcoming-game" type="button" ${prediction ? '' : 'disabled'}>${escapeHTML(game.awayName)} at ${escapeHTML(game.homeName)}</button><small>${game.neutral ? 'Neutral court' : escapeHTML(game.home) + ' home'}</small></td><td data-label="Model spread">${prediction ? escapeHTML(spreadLabel(game.home,game.away,-prediction.margin)) : 'Unavailable'}${error ? `<small>${escapeHTML(error)}</small>` : ''}</td><td data-label="ESPN spread">${game.spread ? escapeHTML(spreadLabel(game.home,game.away,game.spread.line)) + `<small>${escapeHTML(game.spread.provider)} via ESPN</small>` : 'Not posted'}</td><td data-label="Pace">${prediction ? `${prediction.pace.toFixed(1)}<small>${prediction.method}</small>` : '—'}</td>`;
        row.querySelector('button').onclick = ()=>selectUpcomingGame(game,ratings.cutoff);
        body.append(row);
    }
    document.getElementById('refresh-upcoming').disabled = upcomingState.loading;
}
async function refreshUpcoming() {
    if (upcomingState.loading) return;
    upcomingState.loading = true; upcomingState.error = ''; renderUpcoming();
    try {
        if (location.protocol === 'file:') {
            await new Promise((resolve,reject) => {
                const script = document.createElement('script');
                script.src = `data/forecast.js?v=${Date.now()}`;
                script.onload = () => { upcomingState.snapshot = window.NBA_FORECAST; upcomingState.live = false; script.remove(); resolve(); };
                script.onerror = () => { script.remove(); reject(new Error('Saved schedule unavailable')); };
                document.head.append(script);
            });
            return;
        }
        const dates = upcomingDates();
        const results = await Promise.all(dates.map(async day => {
            const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=' + day.replaceAll('-',''), {signal:AbortSignal.timeout(12000), cache:'no-store'});
            if (!response.ok) throw new Error('ESPN request failed');
            const data = await response.json();
            if (!Array.isArray(data.events)) throw new Error('Invalid ESPN response');
            return data.events;
        }));
        upcomingState.snapshot = {...upcomingState.snapshot, dates, fetchedAt:new Date().toISOString(), events:results.flat()};
        upcomingState.live = true;
    } catch(error) { upcomingState.error = error.message; }
    finally { upcomingState.loading = false; renderUpcoming(); }
}
function initializeUpcoming() {
    const button = document.getElementById('refresh-upcoming');
    button.onclick = refreshUpcoming;
    if (location.protocol === 'file:') button.textContent = 'Reload saved schedule';
    renderUpcoming();
    if (location.protocol !== 'file:') refreshUpcoming();
}
