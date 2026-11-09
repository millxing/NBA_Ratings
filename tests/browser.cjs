// Optional browser checks: requires Playwright and Chromium already installed.
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const browserType = require(process.env.PLAYWRIGHT_PATH || 'playwright')[process.env.BROWSER || 'chromium'];
(async()=>{
    const browser = await browserType.launch({headless:true,...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:1000}});
        const errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        const url=pathToFileURL(path.resolve(__dirname,'../NBAPowerRatings.html')).href;
        const ready=async(count=30)=>{
            await page.waitForFunction(count=>document.querySelector('#results-section').classList.contains('results-section--visible') && document.querySelectorAll('#results-body tr').length===count && document.querySelector('#status-message').textContent==='' && !document.querySelector('#season-select').disabled,count);
            assert.equal(await page.locator('#status-message').innerText(),'');
        };
        await page.goto(url);
        await ready();
        const latest = await page.evaluate(() => {
            const games = seasonGames();
            return {dates:[...new Set(games.map(game => game.gameday))].sort(),count:String(games.length)};
        });
        assert.equal(await page.locator('#results-section th[data-sort="rating"]').getAttribute('aria-sort'),'descending');
        assert.equal(await page.title(),'NBA Power Ratings');
        const headers = await page.locator('#results-section thead th').allTextContents();
        assert.ok(headers.some(text => text.includes('Net Rating')));
        assert.ok(headers.some(text => text.includes('ORTG')));
        assert.ok(headers.some(text => text.includes('DRTG')));
        assert.ok(headers.every(text => !/Δ|Pt Diff/.test(text)));
        assert.equal(await page.locator('#results-body tr').first().locator('td').count(),9);
        for (const [column, direction] of [['ortg','descending'],['drtg','ascending'],['netRating','descending']]) {
            await page.locator(`#results-section th[data-sort="${column}"] button`).click();
            assert.equal(await page.locator(`#results-section th[data-sort="${column}"]`).getAttribute('aria-sort'),direction);
            assert.equal(await page.evaluate(() => {
                const values=sortRatings(appState.currentRatings).map(team=>team[appState.sortColumn]);
                return values.every((value,index)=>!index || (appState.sortDirection==='asc' ? value>=values[index-1] : value<=values[index-1]));
            }),true);
        }

        assert.equal(await page.locator('#season-select option').count(),27);
        assert.equal(await page.locator('#games-count').innerText(),latest.count);
        const scrubReady = async () => page.waitForFunction(() => document.querySelector('#results-section').getAttribute('aria-busy') === 'false');
        assert.equal(await page.locator('#start-previous').isDisabled(),true);
        assert.equal(await page.locator('#end-next').isDisabled(),true);
        await page.locator('#end-previous').click();
        await scrubReady();
        assert.equal(await page.locator('#end-date').inputValue(),latest.dates.at(-2));
        assert.equal(await page.locator('#results-section').isVisible(),true);
        await page.locator('#end-scrubber').focus();
        await page.keyboard.press('ArrowLeft');
        await scrubReady();
        assert.equal(await page.locator('#end-date').inputValue(),latest.dates.at(-3));
        await page.locator('#start-next').click();
        await scrubReady();
        assert.equal(await page.locator('#start-date').inputValue(),'2026-10-21');
        assert.equal(await page.locator('#end-date').inputValue(),latest.dates.at(-3));
        await page.locator('#start-previous').click();
        await scrubReady();
        // Rapid input must only publish the final requested range.
        await page.locator('#end-scrubber').evaluate(input => {
            for (const value of [Number(input.max)-3,Number(input.max)-1,Number(input.max)]) {
                input.value=value; input.dispatchEvent(new Event('input',{bubbles:true}));
            }
        });
        await scrubReady();
        assert.equal(await page.locator('#end-date').inputValue(),latest.dates.at(-1));
        assert.equal(await page.locator('#games-count').innerText(),latest.count);
        await page.locator('#results-section th[data-sort="team"] button').click();
        assert.match(await page.locator('#results-body tr').first().innerText(),/Atlanta/);
        await page.locator('#matchup-link').click();
        await page.locator('#matchup-a').selectOption('BOS');
        await page.locator('#matchup-b').selectOption('NYK');
        const neutral=await page.locator('#matchup-result').innerText();
        assert.match(neutral,/points per 100 possessions|Even matchup/);
        assert.equal(await page.locator('#matchup-stats tr').first().locator('td').count(),9);
        assert.match(await page.locator('#mobile-matchup').textContent(),/ORTG/);
        assert.match(await page.locator('#mobile-matchup').textContent(),/DRTG/);
        assert.doesNotMatch(await page.locator('#mobile-matchup').textContent(),/Δ|Pt Diff/);
        await page.locator('#matchup-venue').selectOption('a');
        assert.notEqual(await page.locator('#matchup-result').innerText(),neutral);
        await page.locator('#matchup-b').selectOption('BOS');
        assert.equal(await page.locator('#matchup-result').innerText(),'Choose two different teams.');
        await page.locator('#matchup-b').selectOption('NYK');
        await page.locator('#ratings-link').click();
        await page.locator('#end-date').fill('2026-10-30');
        await page.locator('#end-date').dispatchEvent('change');
        await ready();
        assert.ok(Number(await page.locator('#games-count').innerText())<132);
        await page.reload();
        await ready();
        assert.equal(await page.locator('#end-date').inputValue(),latest.dates.at(-1));
        assert.equal(await page.locator('#results-section th[data-sort="rating"]').getAttribute('aria-sort'),'descending');
        await page.locator('#start-date').fill('2026-11-06');
        await page.locator('#start-date').dispatchEvent('change');
        await page.waitForFunction(()=>document.querySelector('#status-message').textContent.includes('Select a wider'));
        assert.equal(await page.locator('#results-section').isVisible(),false);
        await page.locator('#season-select').selectOption('2000');
        await ready(29);
        assert.match(await page.locator('#results-body').innerText(),/Vancouver Grizzlies/);
        await page.locator('#season-select').selectOption('2025');
        await ready();
        assert.equal(await page.locator('#games-count').innerText(),'1230');
        await page.locator('#game-type').selectOption('playoffs');
        await ready(16);
        assert.equal(await page.locator('#games-count').innerText(),'85');
        await page.locator('#season-select').selectOption('2026');
        await page.waitForFunction(()=>document.querySelector('#week-availability').textContent.includes('No results'));
        assert.equal(await page.locator('#results-section').isVisible(),false);
        assert.equal(await page.locator('#start-scrubber').isDisabled(),true);
        assert.equal(await page.locator('#end-scrubber').isDisabled(),true);
        await page.locator('#game-type').selectOption('regular');
        await ready();
        await page.locator('#file-upload').setInputFiles({name:'bad.csv',mimeType:'text/csv',buffer:Buffer.from('bad\ndata')});
        await page.waitForFunction(()=>document.querySelector('#status-message').textContent.includes('Error loading file'));
        assert.equal(await page.locator('#results-body tr').count(),30);
        const bundle={window:{}};
        require('node:vm').runInNewContext(require('node:fs').readFileSync(path.resolve(__dirname,'../data/games.js'),'utf8'),bundle);
        const lines=bundle.window.NBA_CSV.trim().split('\n');
        const csv=[lines[0],...lines.slice(1).filter(line=>line.split(',')[2]==='2024-25')].join('\n');
        await page.locator('#file-upload').setInputFiles({name:'season.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
        await ready();
        assert.equal(await page.locator('#season-select').inputValue(),'2024');
        assert.equal(await page.locator('#games-count').innerText(),'1230');
        await page.getByText('Source details',{exact:true}).click();
        await page.locator('#refresh-data').click();
        await ready();
        assert.equal(await page.locator('#season-select option').count(),27);
        await page.locator('#season-select').selectOption('2026');
        await ready();
        await page.screenshot({path:'/tmp/nba-ratings-desktop.png',fullPage:true});
        await page.setViewportSize({width:390,height:844});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
        await page.screenshot({path:'/tmp/nba-ratings-mobile.png',fullPage:true});
        await page.locator('#matchup-link').click();
        await page.locator('#matchup-a').selectOption('BOS');
        await page.locator('#matchup-b').selectOption('NYK');
        await page.locator('#mobile-matchup').waitFor({state:'visible'});
        await page.screenshot({path:'/tmp/nba-ratings-matchup-mobile.png',fullPage:true});
        assert.deepEqual(errors,[]);
        console.log('PASS: direct-file startup, sorting, date scrubbing, rapid-input cancellation, date filtering, saved preferences, historical teams, playoffs, empty and insufficient ranges, CSV imports/rejection, refresh, matchup venues, mobile overflow and no runtime errors.');
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
