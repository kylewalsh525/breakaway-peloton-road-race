#!/usr/bin/env node
/** Rendered standalone-game checks. Native speech and bike data are synthetic fixtures,
 * not microphone, Bluetooth, Android, or physical Peloton certification.
 * Install Playwright separately, or point PLAYWRIGHT_MODULE at its module entry point.
 * CHROMIUM_PATH may select an existing browser; no browser download is performed. */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ARTIFACTS = resolve(ROOT, 'artifacts');
const checks = [], errors = [], startedAt = performance.now();
let browser, activePage, failure;
const reportPath = resolve(ARTIFACTS, 'retro-browser-test.json');

function check(name, condition) {
    if (!condition) throw new Error(name);
    checks.push(name);
    console.log(`PASS: ${name}`);
}
const diag = page => page.evaluate(() => window.breakawayDiagnostics());
const wait = (page, expression, timeout = 7000) => page.waitForFunction(expression, null, { timeout });
const screenshot = (page, name) => page.screenshot({ path: resolve(ARTIFACTS, name), animations: 'disabled' });

async function launch() {
    const specifier = process.env.PLAYWRIGHT_MODULE || 'playwright';
    const { chromium } = await import(isAbsolute(specifier) ? pathToFileURL(specifier).href : specifier);
    let executablePath = process.env.CHROMIUM_PATH;
    if (!executablePath) {
        for (const path of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
            try { await access(path); executablePath = path; break; } catch { }
        }
    }
    return chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

async function load(html, viewport = { width: 1440, height: 900 }, prelude = '') {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    activePage = page;
    page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(html.replace('<head>', `<head><script>${prelude}</script>`), { waitUntil: 'domcontentloaded' });
    await wait(page, () => window.breakawayStarted === true);
    await wait(page, () => window.breakawayDiagnostics().fps > 0);
    return page;
}

async function main() {
    const build = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: ROOT, encoding: 'utf8' });
    if (build.status !== 0) throw new Error(`Standalone build failed: ${build.stderr || build.stdout}`);
    console.log(build.stdout.trim());
    const html = await readFile(resolve(ROOT, 'dist/PLAY-SOLO.html'), 'utf8');
    browser = await launch();
    let page = await load(html);
    check('Desktop garage boots', (await diag(page)).screen === 'home');
    check('Four selectable courses', await page.locator('[data-track]').count() === 4);
    const startBox = await page.locator('#practice-btn').boundingBox();
    check('Desktop start control fits inside the viewport', startBox && startBox.y >= 0 && startBox.y + startBox.height <= 900);
    check('Voice can be enabled before starting a race', await page.locator('#voice-home').isVisible());
    await page.locator('#rider-name').fill('Road tester');
    for (const track of ['coast', 'canyon', 'metro', 'alpine']) {
        await page.locator(`[data-track="${track}"]`).click();
        check(`Course ${track} selects`, await page.locator(`[data-track="${track}"]`).getAttribute('aria-pressed') === 'true');
    }
    await page.locator('[data-track="coast"]').click();
    await screenshot(page, 'retro-home.png');
    await page.locator('#quick-btn').click();
    check('Standalone multiplayer explains server setup', (await page.locator('#toast').innerText()).includes('npm start'));
    await page.locator('#settings-btn').click();
    await page.locator('#setting-quality').selectOption('low');
    await page.locator('#setting-difficulty').selectOption('easy');
    await page.locator('#setting-ftp').fill('250');
    await page.locator('#setting-fps').check();
    await page.locator('#save-settings').click();
    check('Settings save and close', await page.locator('#modal').isHidden());
    await page.locator('#help-btn').click();
    check('Controls explain virtual versus physical stopping', (await page.locator('#modal-content').innerText()).includes('stop physically'));
    await page.keyboard.press('Escape');
    await page.locator('#power-source').selectOption('peloton');
    check('Missing native sensor service is explained', (await page.locator('#source-hint').innerText()).includes('Android shell'));
    check('Unavailable Peloton data does not become demo power', (await diag(page)).telemetry.stale && (await diag(page)).telemetry.watts === 0);
    await page.locator('#power-source').selectOption('demo');
    await wait(page, () => window.breakawayDiagnostics().telemetry.watts === 200);
    await page.locator('#practice-btn').click();
    await wait(page, () => window.breakawayDiagnostics().phase === 'racing');
    check('Solo countdown reaches racing', (await diag(page)).screen === 'hud');
    check('Demo power is visibly labeled', (await page.locator('#watts').innerText()) === '200' && (await page.locator('#sensor-status').innerText()).includes('DEMO'));
    await page.keyboard.press('ArrowLeft');
    await wait(page, () => window.breakawayDiagnostics().rider.targetLane === 1);
    check('Keyboard steers left', (await diag(page)).rider.targetLane === 1);
    await page.waitForTimeout(220);
    await page.keyboard.press('ArrowRight');
    await wait(page, () => window.breakawayDiagnostics().rider.targetLane === 2);
    check('Keyboard steers right', (await diag(page)).rider.targetLane === 2);
    await page.keyboard.press('b');
    await wait(page, () => window.breakawayDiagnostics().rider.energy < 65);
    check('Boost spends stamina', (await diag(page)).rider.energy < 65);
    await page.keyboard.press('c');
    await wait(page, () => window.breakawayDiagnostics().rider.coast);
    check('Keyboard coast reaches the simulation', (await diag(page)).rider.coast);
    await page.keyboard.press('r');
    await wait(page, () => !window.breakawayDiagnostics().rider.coast);
    check('Keyboard resume restores propulsion', !(await diag(page)).rider.coast);
    await page.locator('#pause-btn').click();
    check('Solo pause dialog opens', (await page.locator('#modal-title').innerText()).includes('BREATHER'));
    await page.locator('#resume-btn').click();
    check('Eight riders exist in the collapsed race order', await page.locator('.standing').count() === 8);
    check('Low quality renders a 640-pixel canvas', await page.locator('#world').evaluate(canvas => canvas.width === 640));
    await page.locator('#settings-btn').click();
    await page.selectOption('#setting-quality', 'auto');
    await page.locator('#save-settings').click();
    await page.locator('[data-action=hit]').click();
    check('Race action buttons remain clickable beneath a visible notification', (await page.locator('#heard').innerText()).includes('HIT'));
    await page.waitForTimeout(4300);
    await screenshot(page, 'retro-race.png');
    await page.locator('#pause-btn').click();
    await page.locator('#quit-btn').click();
    check('Leaving solo returns to the garage', (await diag(page)).screen === 'home');
    await page.close();

    for (const [width, height] of [[1920, 1080], [1024, 600], [390, 844]]) {
        page = await load(html, { width, height });
        check(`Home ${width}×${height} has no horizontal page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.locator('#practice-btn').scrollIntoViewIfNeeded();
        check(`Home ${width}×${height} start control is clickable`, await page.locator('#practice-btn').isVisible());
        if (width === 390) {
            await page.evaluate(() => window.scrollTo(0, 0));
            await screenshot(page, 'retro-mobile.png');
            await page.locator('#settings-btn').click();
            await page.locator('#save-settings').scrollIntoViewIfNeeded();
            check('Mobile settings can be saved', await page.locator('#save-settings').isVisible());
            await page.locator('#save-settings').click();
        }
        await page.locator('#practice-btn').click();
        await wait(page, () => window.breakawayDiagnostics().phase === 'racing');
        check(`Race ${width}×${height} has no horizontal page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        check(`Race ${width}×${height} has readable power and voice controls`, await page.locator('#watts').isVisible() && await page.locator('#voice-btn').isVisible());
        await page.close();
    }

    const native = `window.BreakawayBridge={getServerUrl:()=>'',isDebug:()=>true,reportCapabilities:()=>{},startSensors:()=>{},stopSensors:()=>{},setServerUrl:()=>{},startVoice:allow=>{window.lastOnlineConsent=allow;window.dispatchEvent(new CustomEvent('breakaway-voice',{detail:{type:'status',state:'listening',message:'Synthetic offline recognizer'}}));},stopVoice:()=>{}};`;
    page = await load(html, { width: 1920, height: 1080 }, native);
    check('Native boot selects real sensors and awaits frames', (await diag(page)).telemetry.source === 'peloton-v1' && (await diag(page)).telemetry.stale);
    await page.evaluate(() => { window.injectBike = setInterval(() => window.dispatchEvent(new CustomEvent('breakaway-bike', { detail: { type: 'telemetry', watts: 215, cadence: 88, resistance: 43, source: 'peloton-v1' } })), 150); });
    await wait(page, () => window.breakawayDiagnostics().telemetry.watts === 215);
    check('Valid synthetic native frames enable telemetry', !(await diag(page)).telemetry.stale);
    await page.locator('#voice-home').click();
    check('Native online speech is opt-in', !(await page.locator('#voice-online').isChecked()));
    await page.locator('#start-voice').click();
    await wait(page, () => window.lastOnlineConsent === false);
    check('Home voice setup starts without online consent', (await page.locator('#voice-home-label').innerText()).includes('SAY “START”'));
    const utterance = async (text, confidence, utteranceId, final = true) => {
        await page.evaluate(detail => window.dispatchEvent(new CustomEvent('breakaway-voice', { detail })), { type: 'result', text, confidence, utteranceId, final });
        await page.waitForTimeout(120);
    };
    await utterance('start', .95, 'start');
    await wait(page, () => window.breakawayDiagnostics().phase === 'racing');
    check('Voice starts a solo race from the garage', (await diag(page)).screen === 'hud');
    await utterance('left', .1, 'low');
    check('Low-confidence speech cannot steer', (await diag(page)).rider.targetLane === 2);
    await utterance('left', .95, 'good');
    check('Native voice steers the simulation', (await diag(page)).rider.targetLane === 1);
    await page.waitForTimeout(400);
    await utterance('left', .95, 'good');
    check('Repeated native final result is de-duplicated', (await diag(page)).rider.targetLane === 1);
    await utterance('right', .95, 'partial', false);
    check('Interim speech cannot steer', (await diag(page)).rider.targetLane === 1);
    await utterance('coast', .95, 'coast');
    check('Voice coast reaches the simulation', (await diag(page)).rider.coast);
    await utterance('resume', .95, 'resume');
    check('Voice resume restores propulsion', !(await diag(page)).rider.coast);
    await page.evaluate(() => clearInterval(window.injectBike));
    await wait(page, () => window.breakawayDiagnostics().telemetry.stale && window.breakawayDiagnostics().rider.watts === 0);
    check('Lost native stream becomes stale and zero power', (await diag(page)).telemetry.stale && (await diag(page)).rider.watts === 0);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('breakaway-voice', { detail: { type: 'status', state: 'denied', message: 'Synthetic permission denial' } })));
    check('Microphone denial restores the enable control', (await page.locator('#voice-label').innerText()).includes('ENABLE VOICE'));
    await page.close();

    const fastClock = 'let virtual=performance.now();window.requestAnimationFrame=callback=>setTimeout(()=>{virtual+=150;callback(virtual);},0);';
    page = await load(html, { width: 1440, height: 900 }, fastClock);
    await page.locator('#settings-btn').click();
    await page.locator('#setting-quality').selectOption('low');
    await page.locator('#setting-difficulty').selectOption('easy');
    await page.locator('#save-settings').click();
    await page.locator('#practice-btn').click();
    await page.locator('#demo-watts').fill('600');
    await page.locator('#demo-watts').dispatchEvent('input');
    await wait(page, () => window.breakawayDiagnostics().screen === 'results', 45000);
    check('Complete accelerated solo race reaches eight-rider results', await page.locator('.result-row').count() === 8);
    check('Results award career XP', (await page.locator('#career-summary').innerText()).includes('XP'));
    await screenshot(page, 'retro-results.png');
    await page.locator('#again-btn').click();
    check('Race again starts another race', (await diag(page)).screen === 'hud');
    await page.close();
    check('No uncaught JavaScript errors', errors.length === 0);
}

await mkdir(ARTIFACTS, { recursive: true });
try { await main(); }
catch (error) {
    failure = error.stack || String(error);
    console.error(failure);
    if (activePage && !activePage.isClosed()) await screenshot(activePage, 'retro-failure.png').catch(() => {});
    process.exitCode = 1;
}
finally {
    await browser?.close();
    const report = {
        test: 'Retro UI, standalone gameplay, and synthetic native voice/telemetry integration',
        passed: !failure, checksPassed: checks.length, elapsedSeconds: Math.round((performance.now() - startedAt) / 10) / 100,
        checks, uncaughtErrors: errors, ...(failure ? { failure } : {}),
        limitations: ['No actual microphone input, Bluetooth device, or physical Peloton was used.', 'Native bridge events were synthetic.', 'The complete-race check used an accelerated animation clock.', 'HTTP/SSE multiplayer transport is covered by separate server integration tests.']
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Saved ${checks.length} checks to ${reportPath}`);
}
