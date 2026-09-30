import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { ResultStore } from '../server/store.mjs';
import { RaceNetwork, SnapshotBuffer } from '../client/network.mjs';
const telemetry = { watts: 230, cadence: 85, resistance: 40, source: 'peloton-v1' };
async function fixture(t, options = {}) {
    const app = await createApp({ ...options });
    const port = await app.listen();
    const base = `http://127.0.0.1:${port}`;
    t.after(() => app.close());
    const request = async (path, body, key, method = 'POST', headers = {}) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Breakaway-Client': '1', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); let data; try {
        data = await r.json();
    }
    catch {
        data = null;
    } return { status: r.status, data, headers: r.headers }; };
    const session = async (name = 'Tester') => { const r = await request('/api/session', { name, protocol: 1, accessCode: options.accessCode }); assert.equal(r.status, 201); return r.data; };
    return { app, base, request, session };
}
async function stream(base, key) {
    const control = new AbortController();
    const response = await fetch(base + '/api/stream', { headers: { Authorization: `Bearer ${key}` }, signal: control.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    const events = [];
    let done = false;
    const task = (async () => { try {
        while (true) {
            const part = await reader.read();
            if (part.done)
                break;
            buffer += decoder.decode(part.value, { stream: true });
            let at;
            while ((at = buffer.indexOf('\n\n')) !== -1) {
                const event = buffer.slice(0, at);
                buffer = buffer.slice(at + 2);
                if (event.startsWith('data: '))
                    events.push(JSON.parse(event.slice(6)));
            }
        }
    }
    catch (error) {
        if (!control.signal.aborted)
            throw error;
    }
    finally {
        done = true;
    } })();
    const wait = async (predicate) => { const deadline = Date.now() + 3000; while (Date.now() < deadline) {
        const found = events.find(predicate);
        if (found)
            return found;
        if (done)
            throw new Error('Stream ended');
        await new Promise(r => setTimeout(r, 10));
    } throw new Error('Timed out waiting for SSE event'); };
    return { events, wait, async close() { control.abort(); await task; } };
}
test('health and static content expose security headers; server files stay private', async (t) => { const { request, base } = await fixture(t); const h = await request('/api/health', undefined, null, 'GET'); assert.equal(h.status, 200); assert.equal(h.data.protocol, 1); assert.equal(h.headers.get('x-content-type-options'), 'nosniff'); for (const path of ['/server/app.mjs', '/.env', '/package.json', '/shared/../../server/main.mjs'])
    assert.equal((await fetch(base + path)).status, 404); const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /BREAKAWAY/); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/); });
test('bearer authorization is required, query-string tokens are not accepted', async (t) => { const { request, session } = await fixture(t); const user = await session(); assert.equal((await request('/api/me', undefined, null, 'GET')).status, 401); assert.equal((await request('/api/me?token=' + user.token, undefined, null, 'GET')).status, 401); assert.equal((await request('/api/me', undefined, user.token, 'GET')).data.id, user.id); });
test('incompatible protocol, wrong content type, and malformed JSON are rejected', async (t) => { const { request, base } = await fixture(t); assert.equal((await request('/api/session', { name: 'Me', protocol: 999 })).status, 400); assert.equal((await request('/api/session', { protocol: 1 }, null, 'POST', { 'X-Breakaway-Client': '0' })).status, 400); assert.equal((await request('/api/session', { protocol: 1 }, null, 'POST', { 'Content-Type': 'text/plain' })).status, 415); const r = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Breakaway-Client': '1' }, body: '{oops' }); assert.equal(r.status, 400); });
test('oversized JSON body and arrays fail closed', async (t) => { const { request } = await fixture(t); assert.equal((await request('/api/session', { protocol: 1, padding: 'a'.repeat(9000) })).status, 413); assert.equal((await request('/api/session', [])).status, 400); });
test('cross-origin policy blocks hostile/null origins and permits configured native origin', async (t) => { const { request } = await fixture(t); assert.equal((await request('/api/session', { protocol: 1 }, null, 'POST', { Origin: 'https://evil.example' })).status, 403); assert.equal((await request('/api/session', { protocol: 1 }, null, 'POST', { Origin: 'null' })).status, 403); const a = await request('/api/session', { protocol: 1 }, null, 'POST', { Origin: 'https://app.breakaway.local' }); assert.equal(a.status, 201); assert.equal(a.headers.get('access-control-allow-origin'), 'https://app.breakaway.local'); });
test('invitation passphrase gates session creation', async (t) => { const { request, session } = await fixture(t, { accessCode: 'only-my-friends' }); assert.equal((await request('/api/session', { protocol: 1 })).status, 403); assert.ok((await session()).token); });
test('session rate and server capacity limits are enforced', async (t) => { const { session, request } = await fixture(t, { maxSessions: 1 }); await session(); assert.equal((await request('/api/session', { protocol: 1 })).status, 503); });
test('new-session abuse has a separate rate limit', async (t) => { const { session, request } = await fixture(t, { sessionRate: 1 }); await session(); assert.equal((await request('/api/session', { protocol: 1 })).status, 429); });
test('room creation validates track and honors max room count', async (t) => { const { request, session } = await fixture(t, { maxRooms: 1 }); const a = await session('A'), b = await session('B'); assert.equal((await request('/api/rooms/create', { trackId: 'bad' }, a.token)).status, 400); assert.equal((await request('/api/rooms/create', { trackId: 'coast' }, a.token)).status, 201); assert.equal((await request('/api/rooms/create', { trackId: 'canyon' }, b.token)).status, 503); });
test('private room ready/host permissions, start, input replay, spectator restrictions', async (t) => {
    const { app, request, session } = await fixture(t);
    const a = await session('A'), b = await session('B'), watch = await session('Watcher');
    const room = (await request('/api/rooms/create', { trackId: 'coast' }, a.token)).data.room;
    assert.equal((await request('/api/rooms/join', { code: room.code }, b.token)).status, 200);
    assert.equal((await request('/api/rooms/start', {}, a.token)).status, 409);
    assert.equal((await request('/api/rooms/start', {}, b.token)).status, 403);
    await request('/api/rooms/ready', {}, a.token);
    await request('/api/rooms/ready', {}, b.token);
    assert.equal((await request('/api/rooms/start', {}, a.token)).status, 200);
    assert.equal(app.rooms.get(room.code).race.riders.length, 8);
    const input = { seq: 1, actions: ['left'], telemetry };
    assert.equal((await request('/api/input', input, a.token)).data.accepted, true);
    assert.equal((await request('/api/input', input, a.token)).data.accepted, false);
    assert.equal((await request('/api/rooms/join', { code: room.code }, watch.token)).status, 409);
    assert.equal((await request('/api/rooms/join', { code: room.code, spectator: true }, watch.token)).status, 200);
    assert.equal((await request('/api/input', input, watch.token)).status, 403);
    assert.equal((await request('/api/rooms/ready', {}, watch.token)).status, 403);
});
test('room capacity is eight riders, with bounded spectator slots', async (t) => { const { request, session } = await fixture(t, { sessionRate: 30 }); const host = await session('Host'); const room = (await request('/api/rooms/create', { trackId: 'metro' }, host.token)).data.room; for (let i = 0; i < 7; i++) {
    const s = await session();
    assert.equal((await request('/api/rooms/join', { code: room.code }, s.token)).status, 200);
} const ninth = await session(); assert.equal((await request('/api/rooms/join', { code: room.code }, ninth.token)).status, 409); assert.equal((await request('/api/rooms/join', { code: room.code, spectator: true }, ninth.token)).status, 200); });
test('leaving transfers host and clears an empty room', async (t) => { const { app, request, session } = await fixture(t); const a = await session('A'), b = await session('B'); const room = (await request('/api/rooms/create', { trackId: 'alpine' }, a.token)).data.room; await request('/api/rooms/join', { code: room.code }, b.token); await request('/api/rooms/leave', {}, a.token); assert.equal(app.rooms.get(room.code).hostId, b.id); await request('/api/rooms/leave', {}, b.token); assert.equal(app.rooms.size, 0); });
test('quick matchmaking matches course/mode and fills empty slots with AI on countdown', async (t) => { let now = 0; const { app, request, session } = await fixture(t, { clock: () => now }); const a = await session('A'), b = await session('B'); const r = (await request('/api/rooms/quick', { trackId: 'canyon', mode: 'equalized' }, a.token)).data.room; const s = (await request('/api/rooms/quick', { trackId: 'canyon', mode: 'equalized' }, b.token)).data.room; assert.equal(r.code, s.code); now = 10050; app.tick(); assert.equal(app.rooms.get(r.code).race.riders.length, 8); assert.equal(app.rooms.get(r.code).race.mode, 'equalized'); });
test('SSE carries room and race state, reconnect restores one rider, tokens never leak', async (t) => { const { app, base, request, session } = await fixture(t); const a = await session('A'), b = await session('B'); const streamA = await stream(base, a.token), streamB = await stream(base, b.token); t.after(() => Promise.all([streamA.close(), streamB.close()])); await streamA.wait(x => x.kind === 'hello'); const room = (await request('/api/rooms/create', { trackId: 'coast' }, a.token)).data.room; await request('/api/rooms/join', { code: room.code }, b.token); await request('/api/rooms/ready', {}, a.token); await request('/api/rooms/ready', {}, b.token); await request('/api/rooms/start', {}, a.token); const state = await streamB.wait(x => x.kind === 'state'); assert.equal(state.state.riders.length, 8); assert.equal(JSON.stringify(streamB.events).includes(a.token), false); await streamA.close(); const resumed = await stream(base, a.token); t.after(() => resumed.close()); const again = await resumed.wait(x => x.kind === 'state'); assert.equal(again.state.riders.filter(x => x.id === a.id).length, 1); assert.equal(app.rooms.get(room.code).members.size, 2); });
test('paired phone control is one-time, scoped, sequenced, revocable, and expires', async (t) => { let now = 0; const { app, request, session } = await fixture(t, { clock: () => now }); const a = await session('Rider'), phone = await session('Phone'), outsider = await session('Other'); const room = (await request('/api/rooms/create', { trackId: 'coast' }, a.token)).data.room; const code = (await request('/api/pair/create', {}, a.token)).data.code; assert.equal((await request('/api/pair/claim', { code }, phone.token)).status, 200); assert.equal((await request('/api/pair/claim', { code }, outsider.token)).status, 404); assert.equal((await request('/api/control', { command: 'ready', seq: 1 }, phone.token)).status, 200); assert.equal((await request('/api/control', { command: 'start', seq: 2 }, phone.token)).status, 200); now = 3500; for (let i = 0; i < 10; i++) {
    app.tick();
    now += 400;
} const race = app.rooms.get(room.code).race; assert.equal(race.phase, 'racing'); assert.equal((await request('/api/control', { command: 'left', seq: 3 }, phone.token)).status, 200); assert.equal(race.riders.find(r => r.id === a.id).targetLane, 1); assert.equal((await request('/api/control', { command: 'left', seq: 3 }, phone.token)).status, 409); assert.equal((await request('/api/control', { command: 'left', seq: 9 }, outsider.token)).status, 403); await request('/api/pair/revoke', {}, a.token); assert.equal((await request('/api/control', { command: 'left', seq: 4 }, phone.token)).status, 403); const expiring = (await request('/api/pair/create', {}, a.token)).data.code; now += 120001; assert.equal((await request('/api/pair/claim', { code: expiring }, phone.token)).status, 404); });
test('race can finish, persist an unverified result, and rematch without duplicate players', async (t) => { let now = 0; const { app, request, session } = await fixture(t, { clock: () => now, raceLength: 25 }); const a = await session('Finisher'); const room = (await request('/api/rooms/create', { trackId: 'coast' }, a.token)).data.room; await request('/api/rooms/ready', {}, a.token); await request('/api/rooms/start', {}, a.token); for (let i = 0; i < 110; i++) {
    await request('/api/input', { seq: i, actions: [], telemetry }, a.token);
    now += 100;
    app.tick();
} assert.equal(app.rooms.get(room.code).race.phase, 'finished'); const board = await request('/api/leaderboard?track=coast', undefined, a.token, 'GET'); assert.equal(board.data.verified, false); assert.equal(board.data.results.length, 1); assert.equal((await request('/api/rooms/rematch', {}, a.token)).status, 200); assert.equal(app.rooms.get(room.code).race, null); assert.equal(app.rooms.get(room.code).members.size, 1); assert.equal((await request('/api/rooms/start', {}, a.token)).status, 409); });
test('logout revokes the token and leaves its room', async (t) => { const { request, session, app } = await fixture(t); const a = await session(); await request('/api/rooms/create', { trackId: 'coast' }, a.token); await request('/api/logout', {}, a.token); assert.equal((await request('/api/me', undefined, a.token, 'GET')).status, 401); assert.equal(app.rooms.size, 0); });
test('result journal reload ignores torn final record and excludes demo leaderboard times', async (t) => { const dir = await mkdtemp(join(tmpdir(), 'breakaway-tests-')); t.after(() => rm(dir, { recursive: true, force: true })); const a = new ResultStore(dir); await a.load(); a.append({ trackId: 'coast', mode: 'arcade', seconds: 100, name: 'Real', source: 'peloton-v1' }); a.append({ trackId: 'coast', mode: 'arcade', seconds: 1, name: 'Demo', source: 'demo' }); await a.queue; await appendFile(join(dir, 'results.jsonl'), 'BROKEN_FINAL'); const b = new ResultStore(dir); await b.load(); assert.equal(b.results.length, 2); assert.equal(b.leaderboard('coast').length, 1); assert.equal(b.leaderboard('coast')[0].name, 'Real'); });
test('interpolation is bounded and rejects reordered old snapshots', () => { const buffer = new SnapshotBuffer(); const state = (tick, z) => ({ tick, phase: 'racing', riders: [{ id: 'a', z, lane: 2, speed: 10 }] }); buffer.push(state(1, 0), 0); buffer.push(state(2, 10), 100); assert.equal(buffer.sample(145).riders[0].z, 5); buffer.push(state(0, -100), 200); assert.equal(buffer.latest.tick, 2); assert.equal(buffer.sample(1000).riders[0].z, 10); buffer.clear(); assert.equal(buffer.sample(), null); });
test('the actual browser network class connects to the real HTTP/SSE server in Node', async (t) => { const { base, app } = await fixture(t); globalThis.sessionStorage = { getItem() { return null; }, setItem() { }, removeItem() { } }; const client = new RaceNetwork({ base }); t.after(() => client.stop()); let resolve; const hello = new Promise(r => resolve = r); client.addEventListener('hello', e => resolve(e.detail), { once: true }); await client.connect('Transport test'); const timer = setTimeout(() => resolve({ timeout: true }), 3000); const greeting = await hello; clearTimeout(timer); assert.equal(greeting.id, client.id); assert.equal(client.connected, true); const room = (await client.request('/api/rooms/create', { trackId: 'coast' })).room; assert.ok(app.rooms.has(room.code)); await client.logout(); assert.equal(client.running, false); assert.equal(app.sessions.size, 0); });
test('page reload resumes the original rider with the next accepted input sequence', async (t) => {
    const { base, app } = await fixture(t);
    const values = new Map();
    globalThis.sessionStorage = { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
    const a = new RaceNetwork({ base });
    t.after(() => a.stop());
    await a.connect('Original');
    const room = (await a.request('/api/rooms/create', { trackId: 'coast' })).room;
    await a.request('/api/rooms/ready', {});
    await a.request('/api/rooms/start', {});
    await a.request('/api/input', { seq: 1000, actions: [], telemetry });
    a.stop();
    const b = new RaceNetwork({ base });
    t.after(() => b.stop());
    await b.connect('Should restore original');
    assert.equal(b.id, a.id);
    assert.equal(b.nextInputSeq, 1001);
    assert.equal((await b.request('/api/input', { seq: b.nextInputSeq, actions: [], telemetry })).accepted, true);
    assert.equal(app.rooms.get(room.code).race.riders.filter(r => r.id === a.id).length, 1);
    assert.ok(app.rooms.get(room.code).race.id);
    await b.logout();
});
test('invalid sensor traffic cannot renew the previous sample on the server', async (t) => { let now = 0; const { app, request, session } = await fixture(t, { clock: () => now }); const a = await session(); const room = (await request('/api/rooms/create', { trackId: 'coast' }, a.token)).data.room; await request('/api/rooms/ready', {}, a.token); await request('/api/rooms/start', {}, a.token); await request('/api/input', { seq: 1, actions: [], telemetry }, a.token); now = 3000; assert.equal((await request('/api/input', { seq: 2, actions: [], telemetry: { ...telemetry, watts: 'bad' } }, a.token)).status, 400); app.tick(); const rider = app.rooms.get(room.code).race.riders.find(r => r.id === a.id); assert.equal(rider.stale, true); assert.equal(rider.watts, 0); });
test('result journal repairs a torn tail before the next append',async t=>{const dir=await mkdtemp(join(tmpdir(),'breakaway-torn-'));t.after(()=>rm(dir,{recursive:true,force:true}));const a=new ResultStore(dir);await a.load();a.append({name:'First'});await a.queue;await appendFile(join(dir,'results.jsonl'),'BROKEN');const b=new ResultStore(dir);await b.load();b.append({name:'Second'});await b.queue;const c=new ResultStore(dir);await c.load();assert.deepEqual(c.results.map(r=>r.name),['First','Second']);});
test('result journal compaction preserves ordered bounded history',async t=>{const dir=await mkdtemp(join(tmpdir(),'breakaway-compact-'));t.after(()=>rm(dir,{recursive:true,force:true}));const s=new ResultStore(dir);await s.load();s.entries=5999;for(let i=0;i<20;i++)s.append({name:String(i)});await s.queue;const reload=new ResultStore(dir);await reload.load();assert.deepEqual(reload.results.map(r=>r.name),Array.from({length:20},(_,i)=>String(i)));});
