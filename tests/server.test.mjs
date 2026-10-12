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

test('phone pairing survives reconnect on both devices and revocation updates both streams', async t => {
    const { base, request, session } = await fixture(t);
    const rider = await session('Bike rider'), phone = await session('Phone mic');
    const bikeStream = await stream(base, rider.token), phoneStream = await stream(base, phone.token);
    t.after(() => Promise.all([bikeStream.close(), phoneStream.close()]));
    const room = (await request('/api/rooms/create', { trackId: 'coast' }, rider.token)).data.room;
    const code = (await request('/api/pair/create', {}, rider.token)).data.code;
    await request('/api/pair/claim', { code }, phone.token);
    assert.equal((await bikeStream.wait(x => x.kind === 'paired')).role, 'rider');
    assert.equal((await phoneStream.wait(x => x.kind === 'paired')).role, 'controller');
    await request('/api/control', { command: 'ready', seq: 9 }, phone.token);
    await phoneStream.close();
    const resumed = await stream(base, phone.token);
    t.after(() => resumed.close());
    const hello = await resumed.wait(x => x.kind === 'hello');
    assert.deepEqual(hello.pairing, { role: 'controller', name: 'Bike rider' });
    assert.equal(hello.nextControlSeq, 10);
    assert.equal((await resumed.wait(x => x.kind === 'paired')).restored, true);
    const me = (await request('/api/me', undefined, rider.token, 'GET')).data;
    assert.deepEqual(me.pairing, { role: 'rider', name: 'Phone mic' });
    assert.equal(me.room.code, room.code);
    await request('/api/pair/revoke', {}, phone.token);
    await bikeStream.wait(x => x.kind === 'unpaired');
    await resumed.wait(x => x.kind === 'unpaired');
    assert.equal((await request('/api/control', { command: 'start', seq: 10 }, phone.token)).status, 403);
});

test('phone control preserves spectator permissions and exact pairing expiry', async t => {
    let now = 0;
    const { request, session } = await fixture(t, { clock: () => now });
    const host = await session('Host'), spectator = await session('Spectator'), phone = await session('Phone');
    const room = (await request('/api/rooms/create', { trackId: 'coast' }, host.token)).data.room;
    await request('/api/rooms/join', { code: room.code, spectator: true }, spectator.token);
    let code = (await request('/api/pair/create', {}, spectator.token)).data.code;
    await request('/api/pair/claim', { code }, phone.token);
    assert.equal((await request('/api/control', { command: 'ready', seq: 0 }, phone.token)).status, 403);
    assert.equal((await request('/api/control', { command: 'left', seq: 1 }, phone.token)).status, 403);
    code = (await request('/api/pair/create', {}, host.token)).data.code;
    now = 120000;
    assert.equal((await request('/api/pair/claim', { code }, phone.token)).status, 404);
});

async function until(predicate) {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
        if (Date.now() >= deadline)
            throw new Error('Timed out waiting for network state');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}
function memorySessionStorage() {
    const values = new Map();
    globalThis.sessionStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
test('concurrent joins and rapid reconnects keep one session and one stable event stream', async t => {
    const { base, app } = await fixture(t);
    memorySessionStorage();
    const client = new RaceNetwork({ base });
    t.after(() => client.stop());
    let greetings = 0;
    client.addEventListener('hello', () => greetings++);
    await Promise.all([client.connect('Rider'), client.connect('Rider'), client.connect('Rider')]);
    await until(() => greetings === 1);
    assert.equal(app.sessions.size, 1);
    const id = client.id;
    for (let i = 0; i < 3; i++) {
        client.stop();
        await client.connect('Rider');
        await until(() => greetings === i + 2);
    }
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(client.id, id);
    assert.equal(app.sessions.size, 1);
    assert.equal(client.connected, true);
    assert.equal(greetings, 4, 'Stopped loops must not reconnect and replace the current stream');
    await client.logout();
});

test('temporary session lookup failure retains the original room instead of creating a second rider', async t => {
    const { base, app } = await fixture(t);
    memorySessionStorage();
    const original = new RaceNetwork({ base });
    t.after(() => original.stop());
    await original.connect('Original');
    const room = (await original.request('/api/rooms/create', { trackId: 'coast' })).room;
    original.stop();
    const resumed = new RaceNetwork({ base });
    t.after(() => resumed.stop());
    const request = resumed.request.bind(resumed);
    let failed = false;
    resumed.request = (...args) => {
        if (!failed && args[0] === '/api/me') {
            failed = true;
            return Promise.reject(new Error('Temporary network outage'));
        }
        return request(...args);
    };
    await assert.rejects(resumed.connect('Duplicate'), /Temporary network outage/);
    assert.equal(app.sessions.size, 1);
    await resumed.connect('Duplicate');
    assert.equal(resumed.id, original.id);
    assert.equal((await resumed.request('/api/me', undefined, 'GET')).room.code, room.code);
    assert.equal(app.rooms.get(room.code).members.size, 1);
    await resumed.logout();
});

test('two remote riders share race results and a fresh rematch with the same room', async t => {
    let now = 0;
    const { app, base, request, session } = await fixture(t, { clock: () => now, raceLength: 25 });
    const a = await session('Peloton A'), b = await session('Peloton B');
    const first = await stream(base, a.token), second = await stream(base, b.token);
    t.after(() => Promise.all([first.close(), second.close()]));
    const room = (await request('/api/rooms/create', { trackId: 'coast' }, a.token)).data.room;
    await request('/api/rooms/join', { code: room.code.toLowerCase() }, b.token);
    await request('/api/rooms/ready', {}, a.token);
    await request('/api/rooms/ready', {}, b.token);
    await request('/api/rooms/start', {}, a.token);
    const initial = (await second.wait(x => x.kind === 'state')).state;
    for (let seq = 0; seq < 140; seq++) {
        await Promise.all([
            request('/api/input', { seq, actions: [], telemetry }, a.token),
            request('/api/input', { seq, actions: [], telemetry: { ...telemetry, watts: 280 } }, b.token)
        ]);
        now += 100;
        app.tick();
    }
    const endA = (await first.wait(x => x.kind === 'state' && x.state.phase === 'finished')).state;
    const endB = (await second.wait(x => x.kind === 'state' && x.state.phase === 'finished')).state;
    assert.equal(endA.id, initial.id);
    assert.equal(endB.id, initial.id);
    assert.deepEqual(endA.riders.map(r => [r.id, r.rank, r.finishedAt]), endB.riders.map(r => [r.id, r.rank, r.finishedAt]));
    for (const player of [a, b]) {
        const rider = endA.riders.find(r => r.id === player.id);
        assert.equal(rider.dnf, false);
        assert.ok(rider.finishedAt > 0);
    }
    assert.equal((await request('/api/rooms/rematch', {}, b.token)).status, 403);
    const rematch = (await request('/api/rooms/rematch', {}, a.token)).data.room;
    assert.equal(rematch.code, room.code);
    assert.equal(rematch.raceId, null);
    assert.ok(rematch.riders.every(r => !r.ready));
    await request('/api/rooms/ready', {}, a.token);
    await request('/api/rooms/ready', {}, b.token);
    await request('/api/rooms/start', {}, a.token);
    const next = (await second.wait(x => x.kind === 'state' && x.state.id !== initial.id)).state;
    assert.equal(next.phase, 'countdown');
    assert.equal(next.riders.filter(r => !r.bot).length, 2);
    assert.equal(app.rooms.size, 1);
});
