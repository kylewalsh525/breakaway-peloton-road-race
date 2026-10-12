import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, 'artifacts');
const spec = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(isAbsolute(spec) ? pathToFileURL(spec).href : spec);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
const checks = [], errors = [];
const check = (name, ok) => { if (!ok) throw Error(name); checks.push(name); console.log(`PASS: ${name}`); };
await mkdir(out, { recursive: true });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/combat-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0;background:#1b2329"><canvas id="scene" style="width:960px;height:540px"></canvas></body></html>' }));
    await page.goto(`${process.env.RACE_URL || 'http://127.0.0.1:8787'}/combat-fixture`);
    const result = await page.evaluate(async () => {
        const { RoadRenderer } = await import('/renderer.mjs');
        const { createRace, addRider, snapshot } = await import('/shared/simulation.mjs');
        const renderer = new RoadRenderer(document.querySelector('#scene'));
        const race = createRace({ countdown: 0 }); race.phase = 'racing'; race.objects = [];
        for (let i = 0; i < 8; i++) {
            const r = addRider(race, `r${i}`, `Rival ${i}`); r.z = 320 + (i - 2) * 8; r.speed = 16; r.stale = false;
        }
        const state = snapshot(race), rider = state.riders.find(r => r.id === 'r2');
        rider.lane = rider.targetLane = 2;
        const atlas = document.createElement('canvas'); atlas.width = 1440; atlas.height = 1640; atlas.id = 'atlas';
        const c = atlas.getContext('2d'); c.imageSmoothingEnabled = false; c.fillStyle = '#1b2329'; c.fillRect(0, 0, atlas.width, atlas.height);
        const poses = [0, .20, .45, .65, .82, 1]; const attacks = [['PUNCH', 'hit', false, .48], ['KICK', 'kick', false, .62], ['CHAIN', 'hit', true, .66]];
        c.font = 'bold 18px monospace'; c.fillStyle = '#d9e3df';
        c.fillText('COMBAT POSES / WIND-UP → CONTACT → RECOVERY', 24, 30);
        for (let row = 0; row < attacks.length; row++) {
            const [name, action, chain, duration] = attacks[row];
            for (let col = 0; col < poses.length; col++) {
                const p = poses[col];
                const sprite = renderer.riderSprite({ ...rider, action, actionDuration: duration, actionTimer: Math.max(.001, duration * (1 - p)), actionChain: chain, chain: chain ? 12 : 0, actionSide: 1, actionId: row + 1 }, 10 + p, true);
                const x = (col % 3) * 480, y = 56 + (row * 2 + Math.floor(col / 3)) * 260;
                c.fillStyle = '#29343b'; c.fillRect(x + 8, y + 27, 464, 225);
                c.fillStyle = '#d9e3df'; c.fillText(`${name} ${Math.round(p * 100)}%`, x + 18, y + 19);
                const w = 430, h = sprite.height / sprite.width * w;
                c.drawImage(sprite, x + (480 - w) / 2, y + 45, w, h);
            }
        }
        document.body.append(atlas);
        let drawn = 0, trials = 0;
        const draw = renderer.ctx.drawImage.bind(renderer.ctx);
        renderer.ctx.drawImage = (...args) => { drawn++; return draw(...args); };
        for (const reduced of [false, true]) {
            renderer.reducedMotion = reduced;
            for (let i = 0; i < 60; i++) {
                trials++;
                renderer.rider(400, 400, 180, { ...rider, stun: 1.6 - i / 60, impactTimer: .28, impactDuration: .28, impactSide: -1 }, 10 + i / 60, true);
            }
        }
        renderer.ctx.drawImage = draw;
        renderer.reducedMotion = false; renderer.render(state, rider.id, 12);
        const sky = () => Array.from(renderer.ctx.getImageData(400, 3, 10, 4).data);
        const before = sky(); renderer.impact(1.7); renderer.render(state, rider.id, 12.016);
        const after = sky();
        window.combatRenderFixture = { renderer, state, rider };
        return { draws: drawn, trials, skyStable: JSON.stringify(before) === JSON.stringify(after) };
    });
    check('Every stunned rider stays drawn on every sampled frame, including reduced motion', result.draws === result.trials);
    check('Impact leaves the sky unchanged: no full-screen damage flash', result.skyStable);
    await page.locator('#atlas').screenshot({ path: resolve(out, 'combat-poses.png') });
    await page.evaluate(() => {
        const { renderer, rider } = window.combatRenderFixture;
        const canvas = document.createElement('canvas'); canvas.id = 'strikes'; canvas.width = 1080; canvas.height = 260;
        const c = canvas.getContext('2d'); c.imageSmoothingEnabled = false;
        c.fillStyle = '#1b2329'; c.fillRect(0, 0, 1080, 260);
        for (const [i, [name, action, chain, duration]] of [['PUNCH', 'hit', false, .48], ['KICK', 'kick', false, .62], ['CHAIN', 'hit', true, .66]].entries()) {
            const sprite = renderer.riderSprite({ ...rider, color: '#d52e2e', action, actionDuration: duration, actionTimer: duration * .55, actionChain: chain, actionSide: 1 }, 10, true);
            c.fillStyle = '#29343b'; c.fillRect(i * 360 + 6, 6, 348, 248);
            c.fillStyle = '#e5e7d2'; c.font = 'bold 17px monospace'; c.fillText(name, i * 360 + 18, 29);
            c.drawImage(sprite, i * 360 + 12, 43, 336, 336 * sprite.height / sprite.width);
        }
        document.body.append(canvas);
    });
    await page.locator('#strikes').screenshot({ path: resolve(out, 'combat-strikes.png') });
    const perf = await page.evaluate(async () => {
        const { renderer, state, rider } = window.combatRenderFixture;
        const stats = [];
        for (const quality of ['low', 'auto', 'high']) {
            renderer.setQuality(quality); renderer.shake = 0;
            for (let i = 0; i < 240; i++) {
                for (const [n, r] of state.riders.entries()) Object.assign(r, { action: n % 2 ? 'kick' : 'hit', actionDuration: .66, actionTimer: .66 * (1 - i % 32 / 32), actionChain: n % 3 === 0, chain: n % 3 === 0 ? 12 : 0, actionId: 1, actionSide: n % 2 ? 1 : -1 });
                renderer.render(state, rider.id, 20 + i / 60);
            }
            const cost = [], frame = []; let last;
            for (let i = 0; i < 120; i++) {
                const now = await new Promise(requestAnimationFrame);
                if (last) frame.push(now - last); last = now;
                for (const r of state.riders) r.actionTimer = .66 * (1 - i % 32 / 32);
                const start = performance.now(); renderer.render(state, rider.id, now / 1000); cost.push(performance.now() - start);
            }
            cost.sort((a,b) => a-b); frame.sort((a,b) => a-b);
            stats.push({ quality, samples: cost.length, renderP50Ms: cost[60], renderP95Ms: cost[114], renderMaxMs: cost.at(-1), frameP50Ms: frame[59], frameP95Ms: frame[113], spriteCacheSize: renderer.riderSprites.size });
        }
        return stats;
    });
    check('Eight simultaneous combat animations render within a 16.7ms p95 draw budget on this desktop', perf.every(p => p.renderP95Ms < 16.7));
    check('No uncaught browser errors', errors.length === 0);
    const report = { scope: 'Local Chrome software renderer, synthetic combat states. Does not measure Peloton hardware or acoustic recognition.', checks, errors, visibility: result, performance: perf };
    await writeFile(resolve(out, 'combat-render-test.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(perf, null, 2));
} finally { await browser.close(); }
