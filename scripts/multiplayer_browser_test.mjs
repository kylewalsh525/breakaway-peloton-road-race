#!/usr/bin/env node
/** Real HTTP/SSE browser integration, with synthetic Peloton/voice bridge fixtures.
 * Start `npm start` first. Run with Node 22+ and Playwright installed, or set
 * PLAYWRIGHT_MODULE to its index.mjs and CHROMIUM_PATH to an installed Chrome.
 * No microphone, physical bike, or external speech service is accessed.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = (process.env.RACE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const reportPath = resolve(ROOT, 'artifacts/multiplayer-browser-test.json');
const started = performance.now(), checks = [], errors = [], pages = [], inputs = new Map();
let browser, failure = null, roomCode = null;

function check(name, condition) {
    if (!condition) throw new Error(name);
    checks.push(name);
    console.log(`PASS: ${name}`);
}
const diagnostics = page => page.evaluate(() => window.breakawayDiagnostics());
const waitFor = (page, condition, arg) => page.waitForFunction(condition, arg, { timeout: 10000 });

function nativeFixture({ watts }) {
    let sensorTimer;
    window.BreakawayBridge = {
        getServerUrl: () => location.origin,
        isDebug: () => true,
        reportCapabilities() {},
        setServerUrl() {},
        startSensors() {
            clearInterval(sensorTimer);
            sensorTimer = setInterval(() => window.dispatchEvent(new CustomEvent('breakaway-bike', {
                detail: { type: 'telemetry', watts, cadence: 88, resistance: 43, source: 'peloton-v1' }
            })), 150);
        },
        stopSensors() { clearInterval(sensorTimer); },
        startVoice(allowOnline) {
            window.fixtureOnlineConsent = allowOnline;
            window.dispatchEvent(new CustomEvent('breakaway-voice', {
                detail: { type: 'status', state: 'listening', message: 'Synthetic offline recognizer fixture' }
            }));
        },
        stopVoice() {}
    };
}

async function openClient(name, { phone = false, watts = 235 } = {}) {
    const context = await browser.newContext({
        viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        reducedMotion: 'reduce', serviceWorkers: 'block'
    });
    await context.addInitScript(nativeFixture, { watts });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push({ client: name, message: error.message }));
    const accepted = [];
    inputs.set(page, accepted);
    page.on('response', async response => {
        if (new URL(response.url()).pathname !== '/api/input') return;
        try { accepted.push({ status: response.status(), ...(await response.json()) }); }
        catch { /* A page reload may interrupt an obsolete response. */ }
    });
    pages.push({ name, page, context, phone });
    await page.goto(BASE + (phone ? '/companion' : '/'), { waitUntil: 'domcontentloaded' });
    await waitFor(page, () => window.breakawayStarted === true && !!window.breakawayDiagnostics);
    if (!phone) {
        await page.locator('#rider-name').fill(name);
        await waitFor(page, value => window.breakawayDiagnostics().telemetry.watts === value, watts);
    }
    if (process.env.BREAKAWAY_ACCESS_CODE) {
        await page.locator('#settings-btn').click();
        await page.locator('#setting-access').fill(process.env.BREAKAWAY_ACCESS_CODE);
        await page.locator('#save-settings').click();
    }
    return page;
}

async function utterance(page, text, utteranceId) {
    await page.evaluate(detail => window.dispatchEvent(new CustomEvent('breakaway-voice', { detail })), {
        type: 'result', text, confidence: .98, final: true, utteranceId
    });
}

async function main() {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
    browser = await chromium.launch({
        headless: true,
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
        args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
    });
    const host = await openClient('Peloton Alice', { watts: 235 });
    const guest = await openClient('Peloton Bob', { watts: 275 });
    check('Separate rider browser contexts boot with synthetic live bike telemetry',
        (await diagnostics(host)).telemetry.source === 'peloton-v1' && (await diagnostics(guest)).telemetry.source === 'peloton-v1');

    await host.locator('#create-btn').click();
    await waitFor(host, () => window.breakawayDiagnostics().screen === 'lobby');
    roomCode = (await host.locator('#copy-room').innerText()).trim();
    check('Host creates a private room with a shareable code', /^[A-Z2-9]{6}$/.test(roomCode));
    await guest.locator('#room-code').fill(roomCode);
    await guest.locator('#join-form button[type="submit"]').click();
    await waitFor(guest, code => window.breakawayDiagnostics().room === code && window.breakawayDiagnostics().screen === 'lobby', roomCode);
    await waitFor(host, () => document.querySelectorAll('#lobby-riders .lobby-row').length === 2);
    check('Two named riders share one lobby', (await host.locator('#lobby-riders').innerText()).includes('Peloton Bob'));
    check('Guest cannot start the host race', await guest.locator('#start-btn').isDisabled());

    await host.locator('#pair-lobby').click();
    await host.locator('#modal-content .calibration-word').waitFor();
    const pairCode = (await host.locator('#modal-content .calibration-word').innerText()).trim();
    await host.locator('#close-modal').click();
    const phone = await openClient('Phone controller', { phone: true, watts: 0 });
    await phone.locator('#pair-code').fill(pairCode);
    await phone.locator('#pair-form button').click();
    await waitFor(phone, () => document.querySelector('#pair-status').textContent.includes('Paired to Peloton Alice'));
    check('Phone companion pairs through the rendered code form', true);

    await host.locator('#ready-btn').click();
    await guest.locator('#ready-btn').click();
    await waitFor(host, () => !document.querySelector('#start-btn').disabled);
    await host.locator('#start-btn').click();
    for (const page of [host, guest]) {
        await waitFor(page, () => window.breakawayDiagnostics().phase === 'racing' && window.breakawayDiagnostics().screen === 'hud');
        await waitFor(page, () => window.breakawayDiagnostics().rider?.watts > 0 && !window.breakawayDiagnostics().rider.stale);
    }
    const hostState = await diagnostics(host), guestState = await diagnostics(guest);
    check('Both riders reach the race HUD in the same live room', hostState.room === roomCode && guestState.room === roomCode && hostState.playerId !== guestState.playerId);
    check('Authoritative HUD power matches each independent bike fixture', hostState.rider.watts === 235 && guestState.rider.watts === 275);
    check('Both clients display live multiplayer and eight-rider standings',
        (await host.locator('#network-status').innerText()) === 'LIVE MULTIPLAYER' &&
        (await guest.locator('#network-status').innerText()) === 'LIVE MULTIPLAYER' &&
        await host.locator('.standing').count() === 8 && await guest.locator('.standing').count() === 8);

    await phone.locator('#companion-voice').click();
    check('Synthetic native voice requires no online speech consent', !(await phone.locator('#voice-online').isChecked()));
    await phone.locator('#start-voice').click();
    await waitFor(phone, () => document.querySelector('#companion-voice').textContent.includes('MICROPHONE ON'));
    check('Voice starts on the synthetic offline bridge', await phone.evaluate(() => window.fixtureOnlineConsent === false));
    await utterance(phone, 'coast', 'phone-coast');
    await waitFor(host, () => window.breakawayDiagnostics().rider.coast);
    check('Phone voice controls only its paired rider on the real server', !(await diagnostics(guest)).rider.coast);
    await utterance(phone, 'center', 'phone-center');
    await waitFor(host, () => window.breakawayDiagnostics().rider.targetLane === 2);
    await utterance(phone, 'left', 'phone-left');
    await waitFor(host, () => window.breakawayDiagnostics().rider.targetLane === 1);
    check('Synthetic phone voice steers the authoritative multiplayer rider', true);
    await phone.waitForTimeout(400);
    await utterance(phone, 'left', 'phone-left');
    await host.waitForTimeout(400);
    check('Duplicate final voice result is not replayed on the server', (await diagnostics(host)).rider.targetLane === 1);

    await phone.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(phone, () => document.querySelector('#pair-status').textContent.includes('Paired to Peloton Alice'));
    check('Reloading the phone restores pairing without a new code', true);
    await phone.locator('[data-command="resume"]').click();
    await waitFor(host, () => !window.breakawayDiagnostics().rider.coast);
    check('Restored phone sequence accepts the next real control command', true);

    const originalId = (await diagnostics(host)).playerId;
    await host.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(host, () => window.breakawayStarted && !!window.breakawayDiagnostics);
    await host.locator('#room-code').fill(roomCode);
    const beforeRejoin = inputs.get(host).length;
    await host.locator('#join-form button[type="submit"]').click();
    await waitFor(host, () => window.breakawayDiagnostics().screen === 'hud' && window.breakawayDiagnostics().rider?.watts === 235);
    const deadline = performance.now() + 3000;
    while (!inputs.get(host).slice(beforeRejoin).some(input => input.accepted)) {
        if (performance.now() > deadline) throw new Error('Rejoined rider input sequence never accepted');
        await host.waitForTimeout(100);
    }
    check('Reload/rejoin retains rider identity and immediately accepted power input', (await diagnostics(host)).playerId === originalId);

    await guest.locator('#pause-btn').click();
    await guest.locator('#quit-btn').click();
    await waitFor(guest, () => window.breakawayDiagnostics().screen === 'home');
    await waitFor(host, () => document.querySelectorAll('#lobby-riders .lobby-row').length === 1);
    await guest.waitForTimeout(1000);
    check('Leaving removes the guest and does not reopen the race HUD', (await diagnostics(guest)).screen === 'home');

    await host.route('**/api/rooms/leave', route => route.abort('failed'));
    await host.locator('#pause-btn').click();
    await host.locator('#quit-btn').click();
    await waitFor(host, () => window.breakawayDiagnostics().screen === 'home');
    for (let i = 0; i < 6; i++) {
        await host.waitForTimeout(200);
        if ((await diagnostics(host)).screen !== 'home') throw new Error('Failed leave request allowed stale SSE to reopen the race');
    }
    check('A failed leave POST still stops the race stream and stays home', true);
    check('No uncaught JavaScript errors across rider and phone contexts', errors.length === 0);
}

try { await main(); }
catch (error) {
    failure = { message: error.message, stack: error.stack };
    console.error(error.stack);
    process.exitCode = 1;
}
finally {
    // Revoke fixture sessions without logging bearer credentials or retaining room state.
    for (const { page, phone } of pages) {
        try {
            await page.evaluate(async storageKey => {
                const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
                if (!saved?.token) return;
                await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Breakaway-Client': '1', Authorization: `Bearer ${saved.token}` }, body: '{}' });
            }, phone ? 'breakaway.remote.session' : 'breakaway.session');
        } catch { /* A failed browser/server startup may leave nothing to clean up. */ }
    }
    await browser?.close();
    const report = {
        test: 'Rendered multiplayer room, telemetry, phone voice and reconnect integration',
        passed: !failure, base: BASE, roomCode, checksPassed: checks.length,
        elapsedSeconds: Math.round((performance.now() - started) / 10) / 100,
        checks, uncaughtErrors: errors, failure,
        limitations: [
            'Real Chromium contexts and the actual HTTP/SSE server were used.',
            'Peloton telemetry and native speech results were synthetic fixtures; no physical bike or microphone was used.',
            'This does not certify Android installation, real speech recognition, remote HTTPS hosting, or internet latency.'
        ]
    };
    await mkdir(resolve(ROOT, 'artifacts'), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`Report: ${reportPath}`);
}
