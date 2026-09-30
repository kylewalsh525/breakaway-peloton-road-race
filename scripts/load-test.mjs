import { createApp } from '../server/app.mjs';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
const rooms = Number(process.env.LOAD_ROOMS || 4), seconds = Number(process.env.LOAD_SECONDS || 6);
if (!Number.isInteger(rooms) || rooms < 1 || rooms > 32 || !Number.isFinite(seconds) || seconds < 1 || seconds > 120)
    throw new Error('LOAD_ROOMS 1..32, LOAD_SECONDS 1..120');
const app = await createApp({ sessionRate: 512, maxSessions: 512, maxRooms: 32 });
const port = await app.listen(), base = `http://127.0.0.1:${port}`;
let bytes = 0, snapshots = 0;
const clients = [], latencies = [], errors = [];
const delay = monitorEventLoopDelay({ resolution: 10 });
async function post(path, body, token) { const start = performance.now(); const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Breakaway-Client': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); const json = await res.json(); latencies.push(performance.now() - start); if (!res.ok)
    throw new Error(path + ': ' + json.error); return json; }
try {
    for (let room = 0; room < rooms; room++) {
        let code, host;
        for (let rider = 0; rider < 8; rider++) {
            const s = await post('/api/session', { name: `R${room}-${rider}`, protocol: 1 });
            const control = new AbortController();
            const res = await fetch(base + '/api/stream', { headers: { Authorization: `Bearer ${s.token}` }, signal: control.signal });
            const task = (async () => { const reader = res.body.getReader(); try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done)
                        break;
                    bytes += value.length;
                    const text = new TextDecoder().decode(value);
                    snapshots += (text.match(/"kind":"state"/g) || []).length;
                }
            }
            catch (e) {
                if (!control.signal.aborted)
                    errors.push(e.message);
            } })();
            clients.push({ ...s, control, task, seq: 0 });
            if (rider === 0) {
                host = s;
                code = (await post('/api/rooms/create', { trackId: ['coast', 'metro', 'canyon', 'alpine'][room % 4] }, s.token)).room.code;
            }
            else
                await post('/api/rooms/join', { code }, s.token);
            await post('/api/rooms/ready', {}, s.token);
        }
        await post('/api/rooms/start', {}, host.token);
    }
    const started = performance.now(), cpu = process.cpuUsage();
    delay.enable();
    while (performance.now() - started < seconds * 1000) {
        const batch = performance.now();
        await Promise.all(clients.map(c => post('/api/input', { seq: c.seq++, actions: c.seq % 11 === 0 ? ['left'] : [], telemetry: { watts: 220, cadence: 85, resistance: 40, source: 'demo' } }, c.token).catch(e => errors.push(e.message))));
        await new Promise(r => setTimeout(r, Math.max(0, 200 - (performance.now() - batch))));
    }
    const elapsed = (performance.now() - started) / 1000;
    delay.disable();
    const cpuUsed = process.cpuUsage(cpu);
    latencies.sort((a, b) => a - b);
    const report = { kind: 'local HTTP/SSE load test; not a production SLA', node: process.version, rooms, simultaneousRiders: clients.length, elapsedSeconds: elapsed, requests: app.stats.requests, receivedSnapshots: snapshots, receivedBytes: bytes, averageDownstreamKBpsPerRider: bytes / 1024 / elapsed / clients.length, requestLatencyMs: { p50: latencies[Math.floor(latencies.length * .5)], p95: latencies[Math.floor(latencies.length * .95)], max: latencies.at(-1) }, eventLoopDelayMs: { mean: delay.mean / 1e6, p99: delay.percentile(99) / 1e6 }, serverDroppedSimulationSteps: app.stats.droppedSteps, processMemoryMB: process.memoryUsage().rss / 1024 / 1024, cpuMilliseconds: (cpuUsed.user + cpuUsed.system) / 1000, errors };
    await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
    await writeFile(new URL('../artifacts/load-test.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (errors.length || !snapshots || app.stats.droppedSteps > 10)
        process.exitCode = 1;
}
finally {
    for (const c of clients)
        c.control.abort();
    await Promise.all(clients.map(c => c.task));
    await app.close();
}
