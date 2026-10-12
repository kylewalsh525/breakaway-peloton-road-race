#!/usr/bin/env node
/** Synthetic provider callback -> real app/simulation checks and latency samples.
 * Run `node scripts/build.mjs` first. This script deliberately does not build,
 * so parallel renderer work cannot race with Android/standalone asset generation.
 * Set PLAYWRIGHT_MODULE and optionally CHROMIUM_PATH to installed runtimes. */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const checks = [], errors = [], latency = [], throughput = [];
const started = performance.now();
let browser, failure;
function check(name, value) { if (!value) throw new Error(name); checks.push(name); console.log(`PASS: ${name}`); }
const diag = page => page.evaluate(() => window.breakawayDiagnostics());
const settle = page => page.waitForTimeout(120);
const wait = (page, fn) => page.waitForFunction(fn, null, { timeout: 7000 });
const fixture = backend => `
window.fixtureBackend=${JSON.stringify(backend)};
window.fixtureSequence=0;window.fixtureIndexes=new Map();window.fixtureRecognizers=[];
window.fixtureSend=detail=>{
  if(window.fixtureBackend==='native') {
    window.dispatchEvent(new CustomEvent('breakaway-voice',{detail:{type:'result',confidence:.99,final:true,sessionId:window.fixtureSession,...detail}}));
  } else {
    if(!window.fixtureIndexes.has(detail.utteranceId))window.fixtureIndexes.set(detail.utteranceId,window.fixtureSequence++);
    const index=window.fixtureIndexes.get(detail.utteranceId);
    window.fixtureRecognition.onresult?.({resultIndex:index,results:{length:index+1,[index]:{isFinal:detail.final!==false,0:{transcript:detail.text,confidence:detail.confidence??.99}}}});
  }
};
if(window.fixtureBackend==='native') {
  window.BreakawayBridge={getServerUrl:()=>'',isDebug:()=>true,reportCapabilities:()=>{},setServerUrl:()=>{},
    startSensors:()=>{window.fixtureBike=setInterval(()=>window.dispatchEvent(new CustomEvent('breakaway-bike',{detail:{type:'telemetry',source:'peloton-v1',watts:220,cadence:88,resistance:40}})),150);},
    stopSensors:()=>clearInterval(window.fixtureBike),startVoice:()=>{},
    startVoiceSession:(allow,sessionId)=>{window.fixtureSession=sessionId;window.dispatchEvent(new CustomEvent('breakaway-voice',{detail:{type:'status',state:'listening',message:'Synthetic native provider',sessionId}}));},
    stopVoice:()=>{}};
} else {
  // This is a provider fixture in an about:blank document, not a microphone grant.
  Object.defineProperty(window,'isSecureContext',{value:true,configurable:true});
  window.SpeechRecognition=class {constructor(){window.fixtureRecognition=this;window.fixtureRecognizers.push(this);}start(){this.onstart?.();}abort(){}};
}`;

async function enableVoice(page, button) {
    await page.locator(button).click();
    await page.locator('#start-voice').click();
    await wait(page, () => window.breakawayDiagnostics().voice.active);
}
async function send(page, text, id, extra = {}) {
    await page.evaluate(detail => window.fixtureSend(detail), { text, utteranceId: id, ...extra });
}
async function timed(page, backend, text, id, expected, value) {
    const sample = await page.evaluate(async ({ text, id, expected, value }) => {
        const before = window.breakawayDiagnostics();
        const began = performance.now();
        window.fixtureSend({ text, utteranceId: id });
        return await new Promise((resolve, reject) => {
            const poll = () => {
                const d = window.breakawayDiagnostics(), r = d.rider;
                const matched = expected === 'attack' ? r.actionId > before.rider.actionId && r.action === value
                    : expected === 'screen' ? d.screen === value
                    : expected === 'positive' ? r[value] > 0
                    : r[expected] === value;
                if (matched) resolve({ text, callbackToActionMs: performance.now() - began, simulationTicks: (d.tick || 0) - (before.tick || 0), action: r?.action, actionId: r?.actionId });
                else if (performance.now() - began > 1500) reject(new Error(`No ${expected} response to ${text}: ${JSON.stringify(d)}`));
                else requestAnimationFrame(poll);
            };
            poll();
        });
    }, { text, id, expected, value });
    latency.push({ backend, ...sample });
    check(`${backend}: ${text} reaches ${expected} state`, sample.callbackToActionMs < 1500);
}

async function testProvider(html, backend) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(html.replace('<head>', `<head><script>${fixture(backend)}</script>`), { waitUntil: 'domcontentloaded' });
    await wait(page, () => window.breakawayStarted);
    await page.locator('#settings-btn').click();
    await page.locator('#setting-difficulty').selectOption('easy');
    await page.locator('#save-settings').click();
    await enableVoice(page, '#voice-home');
    check(`${backend}: voice setup chooses its provider`, (await diag(page)).voice.backend === backend);
    await send(page, 'start', 'start');
    await wait(page, () => window.breakawayDiagnostics().phase === 'racing');
    check(`${backend}: spoken start reaches the race`, (await diag(page)).screen === 'hud');
    await send(page, 'left', 'low', { confidence: .1 });
    await send(page, 'right', 'partial', { final: false });
    await send(page, 'do not punch', 'conversation');
    await settle(page);
    check(`${backend}: low-confidence, partial, and conversational speech do not act`, (await diag(page)).rider.targetLane === 2 && (await diag(page)).rider.actionId === 0);
    await timed(page, backend, 'left', 'left', 'targetLane', 1);
    await page.waitForTimeout(400);
    await send(page, 'left', 'left');
    await settle(page);
    check(`${backend}: a repeated final result cannot steer twice`, (await diag(page)).rider.targetLane === 1);
    await timed(page, backend, 'right', 'right', 'targetLane', 2);
    await timed(page, backend, 'go left', 'left-again', 'targetLane', 1);
    await timed(page, backend, 'center', 'center', 'targetLane', 2);

    for (const [index, text] of ['punch', 'kick', 'chain', 'swing chain'].entries()) {
        await wait(page, () => window.breakawayDiagnostics().rider.stun === 0 && window.breakawayDiagnostics().rider.actionTimer === 0);
        await timed(page, backend, text, `attack-${index}`, 'attack', text === 'kick' ? 'kick' : 'hit');
        await page.waitForTimeout(1300); // Let the actual combat cooldown finish; never edit simulation state.
    }
    const lastAttack = (await diag(page)).rider.actionId;
    await send(page, 'swing chain', 'attack-3');
    await settle(page);
    check(`${backend}: repeated combat final result cannot attack again after cooldown`, (await diag(page)).rider.actionId === lastAttack);
    await timed(page, backend, 'block', 'block', 'positive', 'shield');
    await timed(page, backend, 'boost', 'boost', 'positive', 'boost');
    await timed(page, backend, 'brake', 'brake', 'positive', 'brake');
    await timed(page, backend, 'coast', 'coast', 'coast', true);
    await timed(page, backend, 'resume', 'resume', 'coast', false);

    const burst = await page.evaluate(() => {
        const before = window.breakawayDiagnostics(), began = performance.now();
        for (let i = 0; i < 1000; i++) window.fixtureSend({ text: 'punch', utteranceId: 'same-partial', final: false });
        return { callbacks: 1000, elapsedMs: performance.now() - began, beforeAction: before.rider.actionId, afterAction: window.breakawayDiagnostics().rider.actionId };
    });
    throughput.push({ backend, ...burst });
    check(`${backend}: 1,000 repeated partial callbacks do not trigger attacks`, burst.beforeAction === burst.afterAction);

    await page.evaluate(() => {
        window.fixtureOldSession = window.fixtureSession;
        window.fixtureOldCallback = window.fixtureRecognition?.onresult;
    });
    await page.locator('#voice-btn').click();
    await enableVoice(page, '#voice-btn');
    await page.evaluate(() => {
        if (window.fixtureBackend === 'native') {
            window.fixtureSend({ text: 'left', utteranceId: 'stale-session', sessionId: window.fixtureOldSession });
            window.dispatchEvent(new CustomEvent('breakaway-voice', { detail: { type: 'status', state: 'stopped', sessionId: window.fixtureOldSession } }));
        } else {
            window.fixtureOldCallback({ resultIndex: 9000, results: { length: 9001, 9000: { isFinal: true, 0: { transcript: 'left', confidence: .99 } } } });
        }
    });
    await settle(page);
    check(`${backend}: stale provider callbacks cannot steer or disable the new session`, (await diag(page)).rider.targetLane === 2 && (await diag(page)).voice.active);
    await timed(page, backend, 'right', 'fresh-after-restart', 'targetLane', 3);
    await page.close();
}

await mkdir(resolve(ROOT, 'artifacts'), { recursive: true });
try {
    const specifier = process.env.PLAYWRIGHT_MODULE || 'playwright';
    const { chromium } = await import(isAbsolute(specifier) ? pathToFileURL(specifier).href : specifier);
    let executablePath = process.env.CHROMIUM_PATH;
    if (!executablePath) for (const path of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium']) {
        try { await access(path); executablePath = path; break; } catch { }
    }
    browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const html = await readFile(resolve(ROOT, 'dist/PLAY-SOLO.html'), 'utf8');
    await testProvider(html, 'native');
    await testProvider(html, 'browser');
    check('No uncaught browser JavaScript errors', errors.length === 0);
} catch (error) { failure = error.stack || String(error); console.error(failure); process.exitCode = 1; }
finally {
    await browser?.close();
    const percentile = (values, p) => values.length ? Math.round([...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] * 100) / 100 : null;
    const samples = latency.filter(sample => sample.simulationTicks > 0).map(sample => sample.callbackToActionMs);
    const report = { test: 'Synthetic provider callback to real game action', passed: !failure, checksPassed: checks.length, checks,
        elapsedSeconds: Math.round((performance.now() - started) / 10) / 100, uncaughtErrors: errors, latency, throughput,
        callbackToSimulation: { samples: samples.length, medianMs: percentile(samples, .5), p95Ms: percentile(samples, .95), maxMs: samples.length ? Math.max(...samples) : null },
        ...(failure ? { failure } : {}), limitations: ['Synthetic browser/native provider callbacks; no audio was recognized.', 'Numbers measure local callback-to-simulation response, excluding acoustic recognition, microphone capture, Android bridging, and multiplayer transport.', 'Android Java was not compiled or run in this environment.', 'Saying chain uses the current attack; a chain pickup is required for the equipped-chain animation.'] };
    await writeFile(resolve(ROOT, 'artifacts/combat-voice-browser-test.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ checksPassed: checks.length, passed: report.passed, callbackToSimulation: report.callbackToSimulation, throughput }, null, 2));
}
