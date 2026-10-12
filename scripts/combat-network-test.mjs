#!/usr/bin/env node
/** Actual-server voice command latency and stale input regression checks.
 * Start npm start, then provide PLAYWRIGHT_MODULE / CHROMIUM_PATH if needed.
 * Voice events and power are synthetic. No acoustic or recognition latency is measured.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = (process.env.RACE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const checks = [], errors = [], measurements = [], releases = [];
const started = performance.now();
let browser, page, failure = null, identifier = 0;
function check(name, condition) {
    if (!condition) throw new Error(name);
    checks.push(name); console.log(`PASS: ${name}`);
}
const waitFor = (condition, arg) => page.waitForFunction(condition, arg, { timeout: 10000 });
const latestRider = () => page.evaluate(() => window.combatQA.states.at(-1)?.rider);

async function say(text) {
    return page.evaluate(({ text, id }) => {
        const at = performance.now();
        window.combatQA.voice.push({ text, id, at });
        window.dispatchEvent(new CustomEvent('breakaway-voice', {
            detail: { type: 'result', text, confidence: .99, final: true, utteranceId: id }
        }));
        return at;
    }, { text, id: `network-combat-${++identifier}` });
}

async function holdNextInput() {
    let release, entered, done;
    const gate = new Promise(resolve => { release = resolve; });
    const seen = new Promise(resolve => { entered = resolve; });
    const finished = new Promise(resolve => { done = resolve; });
    releases.push(release);
    let captured = false;
    const handler = async route => {
        if (captured) return route.continue();
        captured = true; entered();
        try {
            const outcome = await gate;
            if (outcome === 'fail') await route.abort('failed');
            else await route.continue();
        } finally { done(); }
    };
    await page.route('**/api/input', handler);
    let timer;
    try {
        await Promise.race([seen, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('No telemetry POST arrived to hold')), 3000);
        })]);
    } finally { clearTimeout(timer); }
    return async outcome => {
        release(outcome); await finished;
        await page.unroute('**/api/input', handler);
    };
}

async function rejectedQueuedAttack(action, outcome, holdMs) {
    const before = await latestRider();
    const release = await holdNextInput();
    const at = await say(action);
    await waitFor(word => document.querySelector('#heard').textContent.includes(word.toUpperCase()), action);
    await page.waitForTimeout(holdMs);
    const releasedAt = await page.evaluate(() => performance.now());
    await release(outcome);
    await waitFor(after => window.combatQA.inputs.some(input => input.at > after), releasedAt);
    await page.waitForTimeout(500);
    const attempted = await page.evaluate(({ at, action }) => window.combatQA.inputs.filter(input => input.at >= at && input.actions.includes(action)), { at, action });
    check(outcome === 'fail' ? 'Failed POST discards even a recent queued voice attack' : 'Voice attack older than 450 ms is discarded when a busy POST finishes', attempted.length === 0);
    check(`${action.toUpperCase()} was not replayed into an authoritative attack`, (await latestRider()).actionId === before.actionId);
}

async function main() {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
    browser = await chromium.launch({ headless: true,
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
        args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        window.combatQA = { states: [], inputs: [], voice: [] };
        const originalFetch = window.fetch.bind(window);
        window.fetch = (resource, options) => {
            const url = new URL(typeof resource === 'string' ? resource : resource.url, location.href);
            if (url.pathname === '/api/input' && typeof options?.body === 'string') {
                const input = JSON.parse(options.body);
                window.combatQA.inputs.push({ at: performance.now(), seq: input.seq, actions: input.actions });
            }
            return originalFetch(resource, options);
        };
        let sensorTimer;
        window.BreakawayBridge = {
            getServerUrl: () => location.origin, isDebug: () => true,
            reportCapabilities() {}, setServerUrl() {},
            startSensors() {
                clearInterval(sensorTimer);
                sensorTimer = setInterval(() => window.dispatchEvent(new CustomEvent('breakaway-bike', {
                    detail: { type: 'telemetry', watts: 235, cadence: 88, resistance: 40, source: 'peloton-v1' }
                })), 150);
            },
            stopSensors() { clearInterval(sensorTimer); },
            startVoice() {
                window.dispatchEvent(new CustomEvent('breakaway-voice', {
                    detail: { type: 'status', state: 'listening', message: 'Synthetic offline recognizer' }
                }));
            },
            stopVoice() {}
        };
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitFor(() => window.breakawayStarted && !!window.breakawayDiagnostics);
    // Observe real SSE delivery; do not mutate simulation, commands, or authority.
    await page.evaluate(async () => {
        const { RaceNetwork } = await import('/network.mjs');
        const emit = RaceNetwork.prototype.emit;
        RaceNetwork.prototype.emit = function (kind, data) {
            if (kind === 'state') {
                const rider = data.state.riders.find(r => r.id === this.id);
                if (rider) window.combatQA.states.push({ at: performance.now(), tick: data.state.tick, rider });
            }
            return emit.call(this, kind, data);
        };
    });
    await page.locator('#rider-name').fill('Combat voice test');
    if (process.env.BREAKAWAY_ACCESS_CODE) {
        await page.locator('#settings-btn').click();
        await page.locator('#setting-access').fill(process.env.BREAKAWAY_ACCESS_CODE);
        await page.locator('#save-settings').click();
    }
    await page.locator('#create-btn').click();
    await waitFor(() => window.breakawayDiagnostics().screen === 'lobby');
    await page.locator('#ready-btn').click();
    await waitFor(() => !document.querySelector('#start-btn').disabled);
    await page.locator('#start-btn').click();
    await waitFor(() => window.breakawayDiagnostics().phase === 'racing');
    check('Real server publishes attack identities for browser verification', Number.isSafeInteger((await latestRider()).actionId));
    await page.locator('#voice-btn').click();
    await page.locator('#start-voice').click();
    await waitFor(() => window.breakawayDiagnostics().voice.active);
    await say('coast');
    await waitFor(() => window.combatQA.states.at(-1).rider.coast);

    // Coasting prevents bot hits from obscuring the input timing measurement.
    for (const command of ['center', 'left', 'right', 'left', 'right', 'left']) {
        const before = await latestRider();
        const target = command === 'center' ? 2 : before.targetLane + (command === 'left' ? -1 : 1);
        const at = await say(command);
        await waitFor(({ at, target }) => window.combatQA.states.some(s => s.at >= at && s.rider.targetLane === target), { at, target });
        const received = await page.evaluate(({ at, target }) => window.combatQA.states.find(s => s.at >= at && s.rider.targetLane === target).at, { at, target });
        if (before.targetLane !== target) measurements.push({ command, milliseconds: Math.round((received - at) * 100) / 100 });
        await page.waitForTimeout(250);
    }
    await say('resume');
    await waitFor(() => !window.combatQA.states.at(-1).rider.coast && window.combatQA.states.at(-1).rider.stun === 0);
    check('Voice steering updates authoritative state without an acoustic fixture', measurements.length === 5);

    await rejectedQueuedAttack('hit', 'continue', 600);
    await rejectedQueuedAttack('kick', 'fail', 100);

    for (const command of ['hit', 'kick']) {
        await waitFor(() => {
            const rider = window.combatQA.states.at(-1).rider;
            return rider.stun === 0 && rider.actionTimer === 0 && !rider.coast;
        });
        const before = await latestRider(), at = await say(command);
        await waitFor(({ at, id, command }) => window.combatQA.states.some(s => s.at >= at && s.rider.actionId > id && s.rider.action === command), { at, id: before.actionId, command });
        const received = await page.evaluate(({ at, id }) => window.combatQA.states.find(s => s.at >= at && s.rider.actionId > id).at, { at, id: before.actionId });
        measurements.push({ command, milliseconds: Math.round((received - at) * 100) / 100 });
    }
    const sorted = measurements.map(x => x.milliseconds).sort((a, b) => a - b);
    check('Recognized command to authoritative state p95 stays below 250 ms locally', sorted[Math.ceil(sorted.length * .95) - 1] < 250);
    check('No uncaught JavaScript errors during delayed and failed input requests', errors.length === 0);
}

try { await main(); }
catch (error) { failure = { message: error.message, stack: error.stack }; process.exitCode = 1; console.error(error.stack); }
finally {
    for (const release of releases) release('fail');
    if (page) {
        try {
            await page.evaluate(async () => {
                const saved = JSON.parse(sessionStorage.getItem('breakaway.session') || 'null');
                if (saved?.token) await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Breakaway-Client': '1', Authorization: `Bearer ${saved.token}` }, body: '{}' });
            });
        } catch {}
    }
    await browser?.close();
    const sorted = measurements.map(x => x.milliseconds).sort((a, b) => a - b);
    const report = {
        test: 'Recognized voice to authoritative multiplayer action and stale queue handling', passed: !failure,
        base: BASE, checksPassed: checks.length, checks, elapsedSeconds: Math.round((performance.now() - started) / 10) / 100,
        latency: { metric: 'Synthetic final recognized command dispatch to matching real SSE authoritative state', samples: measurements,
            medianMilliseconds: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
            p95Milliseconds: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null },
        uncaughtErrors: errors, failure,
        limitations: ['Native recognized speech events and Peloton telemetry were synthetic.',
            'No microphone, speech recognizer, acoustic accuracy, physical Peloton, or remote network latency was measured.',
            'One real telemetry POST was held for over 450 ms; another was failed while a recent attack was pending.',
            'This localhost headless Chrome measurement excludes the 95 ms display interpolation buffer.']
    };
    await mkdir(resolve(ROOT, 'artifacts'), { recursive: true });
    const path = resolve(ROOT, 'artifacts/combat-network-test.json');
    await writeFile(path, JSON.stringify(report, null, 2) + '\n');
    console.log('Report: artifacts/combat-network-test.json');
}
