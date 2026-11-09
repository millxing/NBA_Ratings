const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const context = vm.createContext({console,document:{getElementById:()=>({value:'regular'}),addEventListener(){}},window:{}});
vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'data/games.js'),'utf8'),context);
const games = context.parseCSV(context.window.NBA_CSV);
assert.ok(games.length >= 33582, 'The bundle must retain historical games as new results arrive.');
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const fit = games => { const {X,y} = context.buildDesignMatrix(games); return context.performOLSRegression(X,y); };
const teams = Array.from({length:30},(_,i)=>`T${i}`);
const synthetic = [];
for (let i=0;i<30;i++) for (let j=0;j<30;j++) if(i!==j) synthetic.push({home_team:teams[i],away_team:teams[j],home_name:teams[i],away_name:teams[j],home_score:100+i-j+3,away_score:100,possessions:100,location:'Home'});
context.configureTeams(synthetic);
const baseline = fit(synthetic);
close(baseline[0],3);
const ratings = context.calculatePowerRatings(baseline,synthetic).ratings;
for(let i=0;i<30;i++) close(ratings.find(t=>t.team===teams[i]).rating,i-14.5);
// A faster game with the same efficiency must provide the same model response.
const fast = {...synthetic[0], home_score:synthetic[0].home_score*2, away_score:200, possessions:200};
close(context.buildDesignMatrix([fast]).y[0], context.buildDesignMatrix([synthetic[0]]).y[0]);
close(context.estimatePossessions({fga:90,fta:25,oreb:10,tov:12},{fga:88,fta:20,oreb:8,tov:11}),101.4);
// Aggregate efficiency must weight by possessions, rather than average game rates.
context.configureTeams([synthetic[0]]);
const weighted = context.calculateTeamEfficiency([
 {...synthetic[0],home_score:120,away_score:100,possessions:100},
 {...synthetic[0],home_score:90,away_score:100,possessions:80},
]);
close(weighted.T0.ortg, 100*210/180);
close(weighted.T0.drtg, 100*200/180);
close(weighted.T0.netRating, 100*10/180);
close(weighted.T1.netRating,-weighted.T0.netRating);
context.configureTeams(synthetic);
const neutral={...synthetic[0],location:'Neutral',home_score:99};
fit([...synthetic,neutral]).forEach((v,i)=>close(v,baseline[i]));
const changed=fit([...synthetic,{...neutral,home_score:149}]);
close(changed[0],3);
assert.ok(Math.abs(changed[1]-baseline[1])>0.01);
assert.throws(()=>fit(Array(40).fill(neutral)),/non-neutral/);
assert.throws(()=>fit(Array(40).fill(synthetic[0])),/cannot identify/);
for(const season of [...new Set(games.map(g=>g.season))]) {
 const sample = games.filter(g=>g.season===season && context.matchesType(g,'regular'));
 context.configureTeams(sample);
 const result=context.calculatePowerRatings(fit(sample),sample);
 assert.equal(result.ratings.length,season<2004 ? 29 : 30);
 assert.ok(result.ratings.every(t=>[t.rating,t.ortg,t.drtg,t.netRating,t.sos].every(Number.isFinite)));
 result.ratings.forEach(t=>{ close(t.netRating,t.ortg-t.drtg); close(t.sos,t.rating-t.netRating); close(t.pct,t.wins/(t.wins+t.losses)); });
 close(result.ratings.reduce((sum,t)=>sum+t.rating,0),0);
 assert.equal(result.ratings.reduce((sum,t)=>sum+t.wins,0),sample.length);
 assert.equal(result.ratings.reduce((sum,t)=>sum+t.losses,0),sample.length);
}
assert.equal(games.filter(g=>g.season===2025 && context.matchesType(g,'regular')).length,1230);
assert.equal(context.matchesType({game_type:'nba_cup_final'},'regular'),false);
assert.equal(context.matchesType({game_type:'play_in'},'regular'),false);
assert.equal(context.matchesType({game_type:'play_in'},'all'),true);
const header='game_id,game_date,season,game_type,neutral_site,team_abbreviation_home,team_abbreviation_road,pts_home,pts_road,fga_home,fta_home,oreb_home,tov_home,fga_road,fta_road,oreb_road,tov_road';
assert.throws(()=>context.parseCSV(header+'\nx,2026-11-01,2026-27,regular_season,False,BOS,NYK,100,100'),/Invalid final score/);
assert.throws(()=>context.parseCSV(header+'\nx,2026-02-30,2025-26,regular_season,False,BOS,NYK,100,99'),/Invalid game identity/);
assert.throws(()=>context.parseCSV(header+'\nx,2099-11-01,2099-00,regular_season,False,BOS,NYK,100,99'),/No completed games/);
const validRow='\nx,2026-11-01,2026-27,regular_season,False,BOS,NYK,110,100,90,25,10,12,88,20,8,11';
close(context.parseCSV(header+validRow)[0].possessions,101.4);
assert.throws(()=>context.parseCSV(header+validRow.replace(',90,25',',,25')),/Invalid possession stat/);
assert.throws(()=>context.parseCSV(header+validRow.replace(',90,25',',-1,25')),/Invalid possession stat/);
assert.throws(()=>context.parseCSV(header+validRow.replace(',90,25',',NaN,25')),/Invalid possession stat/);
assert.throws(()=>context.parseCSV(header+validRow.replace(',90,25,10,12,88,20,8,11',',0,0,0,0,0,0,0,0')),/Invalid estimated possessions/);
assert.throws(()=>context.parseCSV('game_id,game_date\nx,2026-11-01'),/FGA\/FTA\/OREB\/TOV/);
assert.equal(context.formatPct(8/10),'.800');
assert.equal(context.formatPct(0),'.000');
assert.equal(context.formatPct(1),'1.000');
assert.equal(context.formatPct(null),'—');
close(context.matchupMargin(5,2,'neutral',3),3);
close(context.matchupMargin(5,2,'a',3),6);
close(context.matchupMargin(5,2,'b',3),0);
console.log('PASS: known ratings, neutral-site isolation, singular-range guards, all 27 regular seasons, historical team counts, records, Cup classification, CSV validation and matchup venues.');
