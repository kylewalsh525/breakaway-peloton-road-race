import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { VERSION, PROTOCOL, SIM_HZ, SNAPSHOT_HZ, MAX_RIDERS, validateName, requireProtocol, validateInput, ACTIONS } from '../shared/protocol.mjs';
import { createRace, addRider, fillBots, applyInput, actionsFor, stepRace, snapshot, COLORS } from '../shared/simulation.mjs';
import { TRACKS } from '../shared/tracks.mjs';
import { token, equalSecret, HttpError, RateLimiter, readJson, sendJson, securityHeaders } from './security.mjs';
import { ResultStore } from './store.mjs';
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function code(n = 6) { return Array.from({ length: n }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join(''); }
function pickCode(map, n = 6) { let c; do {
    c = code(n);
} while (map.has(c)); return c; }
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
export async function createApp(options = {}) {
    const sessions = new Map(), rooms = new Map(), pairs = new Map();
    const maxRooms = options.maxRooms ?? 32, maxSessions = options.maxSessions ?? 256;
    const store = new ResultStore(options.dataDir ?? null);
    await store.load();
    const creation = new RateLimiter(options.sessionRate ?? 20), globalRate = new RateLimiter(10000), pairAttempts = new RateLimiter(12), commands = new RateLimiter(1500);
    const allowedOrigins = new Set(['https://app.breakaway.local', ...(options.allowedOrigins || [])]);
    const clock = options.clock || (() => performance.now());
    let accumulator = 0, lastTick = clock(), snapshotClock = 0, closing = false;
    const stats = { ticks: 0, droppedSteps: 0, startedAt: Date.now(), requests: 0 };
    function session(req) {
        const raw = req.headers.authorization;
        if (typeof raw !== 'string' || !raw.startsWith('Bearer '))
            throw new HttpError(401, 'Session required');
        const s = sessions.get(raw.slice(7));
        if (!s)
            throw new HttpError(401, 'Session expired');
        s.seen = clock();
        return s;
    }
    function publicRoom(room) {
        return { code: room.code, trackId: room.trackId, mode: room.mode, phase: room.race?.phase || 'lobby', hostId: room.hostId, quick: room.quick,
            raceId: room.race?.id || null, startsIn: room.autoStart ? Math.max(0, (room.autoStart - clock()) / 1000) : null,
            riders: [...room.members.values()].map(s => ({ id: s.id, name: s.name, ready: s.ready, connected: !!s.stream, spectator: s.spectator })), capacity: MAX_RIDERS };
    }
    function emit(s, message) {
        const res = s.stream;
        if (!res || res.destroyed)
            return;
        if (res.writableLength > 128 * 1024) {
            res.end();
            s.stream = null;
            return;
        }
        res.write(`data: ${JSON.stringify(message)}\n\n`);
    }
    function broadcast(room, message) { for (const s of room.members.values())
        emit(s, message); }
    function roomOf(s) { const r = rooms.get(s.roomCode); if (!r)
        throw new HttpError(409, 'Join a room first'); return r; }
    function pairing(s) {
        if (s.controlTarget)
            return { role: 'controller', name: s.controlTarget.name };
        if (s.controller)
            return { role: 'rider', name: s.controller.name };
        return null;
    }
    function unpair(s) {
        const wasPaired = !!(s.controlTarget || s.controller);
        if (s.controlTarget) {
            emit(s.controlTarget, { kind: 'unpaired' });
            s.controlTarget.controller = null;
            s.controlTarget = null;
        }
        if (s.controller) {
            s.controller.controlTarget = null;
            emit(s.controller, { kind: 'unpaired' });
            s.controller = null;
        }
        if (wasPaired)
            emit(s, { kind: 'unpaired' });
        for (const [k, p] of pairs)
            if (p.target === s)
                pairs.delete(k);
    }
    function leave(s) {
        const room = rooms.get(s.roomCode);
        s.roomCode = null;
        s.ready = false;
        if (!room)
            return;
        room.members.delete(s.id);
        const r = room.race?.riders.find(x => x.id === s.id);
        if (r) {
            r.connected = false;
            r.dnf = true;
            r.watts = 0;
            r.coast = true;
        }
        if (room.hostId === s.id)
            room.hostId = [...room.members.values()].find(x => !x.spectator)?.id || null;
        if (!room.members.size)
            rooms.delete(room.code);
        else
            broadcast(room, { kind: 'room', room: publicRoom(room) });
    }
    function join(s, room, spectator = false) {
        if (s.roomCode === room.code && room.members.has(s.id))
            return;
        if (!spectator && room.race && room.race.phase !== 'finished')
            throw new HttpError(409, 'Race already started. Join as a spectator.');
        if (!spectator && [...room.members.values()].filter(x => !x.spectator).length >= 8)
            throw new HttpError(409, 'Room is full');
        if (room.members.size >= 16)
            throw new HttpError(409, 'Spectator capacity reached');
        leave(s);
        s.spectator = spectator;
        s.roomCode = room.code;
        s.ready = false;
        room.members.set(s.id, s);
        if (!room.hostId && !spectator)
            room.hostId = s.id;
        broadcast(room, { kind: 'room', room: publicRoom(room) });
    }
    function newRoom(s, body, quick = false) {
        if (rooms.size >= maxRooms)
            throw new HttpError(503, 'All race rooms are busy');
        if (!TRACKS.some(t => t.id === body.trackId))
            throw new HttpError(400, 'Unknown track');
        const room = { code: pickCode(rooms), trackId: body.trackId, mode: body.mode === 'equalized' ? 'equalized' : 'arcade', difficulty: ['easy', 'normal', 'hard'].includes(body.difficulty) ? body.difficulty : 'normal',
            hostId: s.id, members: new Map(), race: null, quick, autoStart: quick ? clock() + 10000 : null, recorded: false, updatedAt: clock() };
        rooms.set(room.code, room);
        join(s, room);
        return room;
    }
    function start(room, s, force = false) {
        if (!force && room.hostId !== s.id)
            throw new HttpError(403, 'Only the host can start this race');
        if (room.race && room.race.phase !== 'finished')
            throw new HttpError(409, 'Race already running');
        const riders = [...room.members.values()].filter(x => !x.spectator);
        if (!riders.length)
            throw new HttpError(409, 'No riders');
        if (!force && riders.some(x => !x.ready))
            throw new HttpError(409, 'Every rider must be ready');
        room.race = createRace({ trackId: room.trackId, mode: room.mode, difficulty: room.difficulty, seed: randomInt(1, 0x7fffffff), length: options.raceLength });
        room.race.id = token(12);
        for (const rider of riders)
            addRider(room.race, rider.id, rider.name, { ftp: rider.ftp, color: rider.color });
        fillBots(room.race, 8 - riders.length);
        room.autoStart = null;
        room.recorded = false;
        room.updatedAt = clock();
        broadcast(room, { kind: 'room', room: publicRoom(room) });
        broadcast(room, { kind: 'state', state: snapshot(room.race) });
    }
    function record(room) {
        if (room.recorded)
            return;
        room.recorded = true;
        for (const r of snapshot(room.race).riders.filter(x => !x.bot))
            store.append({ id: token(10), trackId: room.trackId, mode: room.mode, name: r.name, seconds: r.finishedAt, avgWatts: Math.round(r.avgWatts), source: r.source, date: new Date().toISOString(), verified: false });
    }
    async function route(req, res) {
        stats.requests++;
        securityHeaders(res);
        const url = new URL(req.url, 'http://internal.invalid'), ip = req.socket.remoteAddress || 'unknown';
        const origin = req.headers.origin, ownOrigin = options.publicOrigin || (req.socket.encrypted ? 'https' : 'http') + '://' + req.headers.host;
        const originAllowed = !origin || origin === ownOrigin || allowedOrigins.has(origin);
        if (url.pathname.startsWith('/api/')) {
            if (!originAllowed)
                throw new HttpError(403, 'Origin not allowed');
            if (origin) {
                res.setHeader('Access-Control-Allow-Origin', origin);
                res.setHeader('Vary', 'Origin');
            }
            if (req.method === 'OPTIONS') {
                res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Breakaway-Client');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.writeHead(204);
                res.end();
                return;
            }
            if (!globalRate.allow(ip))
                throw new HttpError(429, 'Too many requests');
            if (req.method === 'POST' && req.headers['x-breakaway-client'] !== String(PROTOCOL))
                throw new HttpError(400, 'Client protocol header required');
        }
        if (req.method === 'GET' && url.pathname === '/api/health')
            return sendJson(res, 200, { ok: !closing, version: VERSION, protocol: PROTOCOL, rooms: rooms.size, uptimeSeconds: Math.round((Date.now() - stats.startedAt) / 1000) });
        if (req.method === 'POST' && url.pathname === '/api/session') {
            if (!creation.allow(ip))
                throw new HttpError(429, 'Too many new sessions; wait one minute');
            if (sessions.size >= maxSessions)
                throw new HttpError(503, 'Server capacity reached');
            const b = await readJson(req);
            requireProtocol(b.protocol);
            if (options.accessCode && !equalSecret(b.accessCode || '', options.accessCode))
                throw new HttpError(403, 'Invitation passphrase required');
            const key = token(), s = { id: token(10), name: validateName(b.name), key, seen: clock(), roomCode: null, ready: false, spectator: false, stream: null, ftp: 200, controlTarget: null, controller: null, controlSeq: -1 };
            sessions.set(key, s);
            return sendJson(res, 201, { token: key, id: s.id, name: s.name, protocol: PROTOCOL, version: VERSION });
        }
        if (req.method === 'GET' && url.pathname === '/api/me') {
            const s = session(req);
            return sendJson(res, 200, { id: s.id, name: s.name, pairing: pairing(s), nextInputSeq: (rooms.get(s.roomCode)?.race?.riders.find(r => r.id === s.id)?.lastInput ?? -1) + 1, nextControlSeq: s.controlSeq + 1, room: s.roomCode ? publicRoom(roomOf(s)) : null });
        }
        if (req.method === 'GET' && url.pathname === '/api/stream') {
            const s = session(req);
            s.stream?.end();
            s.stream = res;
            s.disconnectedAt = null;
            res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
            res.flushHeaders();
            emit(s, { kind: 'hello', id: s.id, protocol: PROTOCOL, pairing: pairing(s), nextInputSeq: (rooms.get(s.roomCode)?.race?.riders.find(r => r.id === s.id)?.lastInput ?? -1) + 1, nextControlSeq: s.controlSeq + 1 });
            if (pairing(s))
                emit(s, { kind: 'paired', ...pairing(s), restored: true });
            const room = rooms.get(s.roomCode);
            if (room) {
                const r = room.race?.riders.find(x => x.id === s.id);
                if (r)
                    r.connected = true;
                emit(s, { kind: 'room', room: publicRoom(room) });
                if (room.race)
                    emit(s, { kind: 'state', state: snapshot(room.race) });
            }
            res.on('close', () => { if (s.stream === res) {
                s.stream = null;
                s.disconnectedAt = clock();
                s.seen = s.disconnectedAt;
                const r = rooms.get(s.roomCode)?.race?.riders.find(x => x.id === s.id);
                if (r)
                    r.connected = false;
            } });
            return;
        }
        if (url.pathname.startsWith('/api/')) {
            const s = session(req);
            if (req.method === 'GET' && url.pathname === '/api/leaderboard')
                return sendJson(res, 200, { results: store.leaderboard(url.searchParams.get('track') || 'coast', url.searchParams.get('mode') || 'arcade'), verified: false });
            if (req.method !== 'POST')
                throw new HttpError(404, 'Not found');
            if (!commands.allow(s.id))
                throw new HttpError(429, 'Input rate exceeded');
            const b = await readJson(req);
            if (url.pathname === '/api/profile') {
                s.name = validateName(b.name);
                s.color = COLORS.includes(b.color) ? b.color : undefined;
                s.ftp = Math.max(75, Math.min(500, Number.isFinite(b.ftp) ? b.ftp : 200));
                return sendJson(res, 200, { name: s.name, ftp: s.ftp });
            }
            if (url.pathname === '/api/rooms/create') {
                const room = newRoom(s, b);
                return sendJson(res, 201, { room: publicRoom(room) });
            }
            if (url.pathname === '/api/rooms/quick') {
                const trackId = TRACKS.some(t => t.id === b.trackId) ? b.trackId : 'coast';
                const room = [...rooms.values()].find(r => r.quick && !r.race && r.trackId === trackId && r.mode === (b.mode === 'equalized' ? 'equalized' : 'arcade') && r.members.size < 8) || newRoom(s, { ...b, trackId }, true);
                join(s, room);
                s.ready = true;
                broadcast(room, { kind: 'room', room: publicRoom(room) });
                return sendJson(res, 200, { room: publicRoom(room) });
            }
            if (url.pathname === '/api/rooms/join') {
                const room = rooms.get(String(b.code || '').trim().toUpperCase());
                if (!room)
                    throw new HttpError(404, 'Room not found');
                join(s, room, b.spectator === true);
                return sendJson(res, 200, { room: publicRoom(room) });
            }
            if (url.pathname === '/api/rooms/leave') {
                leave(s);
                return sendJson(res, 200, { ok: true });
            }
            if (url.pathname === '/api/rooms/ready') {
                const room = roomOf(s);
                if (s.spectator)
                    throw new HttpError(403, 'Spectators cannot ready');
                s.ready = b.ready !== false;
                broadcast(room, { kind: 'room', room: publicRoom(room) });
                return sendJson(res, 200, { room: publicRoom(room) });
            }
            if (url.pathname === '/api/rooms/start') {
                const room = roomOf(s);
                start(room, s);
                return sendJson(res, 200, { ok: true });
            }
            if (url.pathname === '/api/rooms/rematch') {
                const room = roomOf(s);
                if (room.hostId !== s.id)
                    throw new HttpError(403, 'Host only');
                if (room.race?.phase !== 'finished')
                    throw new HttpError(409, 'Finish the race first');
                room.race = null;
                room.recorded = false;
                for (const m of room.members.values())
                    m.ready = false;
                broadcast(room, { kind: 'room', room: publicRoom(room) });
                return sendJson(res, 200, { room: publicRoom(room) });
            }
            if (url.pathname === '/api/input') {
                const room = roomOf(s);
                if (s.spectator)
                    throw new HttpError(403, 'Spectators cannot control riders');
                if (!room.race)
                    return sendJson(res, 200, { accepted: false });
                const accepted = applyInput(room.race, s.id, b, clock());
                return sendJson(res, 200, { accepted, tick: room.race.tick });
            }
            if (url.pathname === '/api/pair/create') {
                unpair(s);
                const c = pickCode(pairs, 8);
                pairs.set(c, { target: s, expires: clock() + 120000 });
                return sendJson(res, 201, { code: c, expiresIn: 120 });
            }
            if (url.pathname === '/api/pair/claim') {
                if (!pairAttempts.allow(ip))
                    throw new HttpError(429, 'Too many pairing attempts');
                const c = String(b.code || '').replace(/[ -]/g, '').toUpperCase(), p = pairs.get(c);
                if (!p || p.expires <= clock())
                    throw new HttpError(404, 'Pairing code expired or not found');
                if (p.target === s)
                    throw new HttpError(400, 'Use a separate device or browser context for the controller');
                unpair(s);
                unpair(p.target);
                s.controlTarget = p.target;
                s.controlSeq = -1;
                p.target.controller = s;
                pairs.delete(c);
                emit(p.target, { kind: 'paired', ...pairing(p.target) });
                emit(s, { kind: 'paired', ...pairing(s) });
                return sendJson(res, 200, { name: p.target.name });
            }
            if (url.pathname === '/api/pair/revoke') {
                unpair(s);
                return sendJson(res, 200, { ok: true });
            }
            if (url.pathname === '/api/control') {
                const target = s.controlTarget;
                if (!target)
                    throw new HttpError(403, 'Pair this controller first');
                if (!Number.isSafeInteger(b.seq) || b.seq < 0 || b.seq <= s.controlSeq)
                    throw new HttpError(409, 'Duplicate controller input');
                if (![...ACTIONS, 'ready', 'start'].includes(b.command))
                    throw new HttpError(400, 'Unknown command');
                s.controlSeq = b.seq;
                const room = roomOf(target);
                if (target.spectator)
                    throw new HttpError(403, 'Spectators cannot control riders');
                if (b.command === 'ready') {
                    target.ready = true;
                    broadcast(room, { kind: 'room', room: publicRoom(room) });
                }
                else if (b.command === 'start')
                    start(room, target);
                else if (room.race) {
                    const r = room.race.riders.find(x => x.id === target.id);
                    if (r)
                        actionsFor(room.race, r, [b.command]);
                }
                emit(target, { kind: 'command', command: b.command, source: 'phone' });
                return sendJson(res, 200, { ok: true });
            }
            if (url.pathname === '/api/ping')
                return sendJson(res, 200, { ok: true, serverTime: Date.now() });
            if (url.pathname === '/api/logout') {
                leave(s);
                unpair(s);
                s.stream?.end();
                sessions.delete(s.key);
                return sendJson(res, 200, { ok: true });
            }
            throw new HttpError(404, 'Not found');
        }
        if (req.method !== 'GET' && req.method !== 'HEAD')
            throw new HttpError(405, 'Method not allowed');
        let pathname;
        try {
            pathname = decodeURIComponent(url.pathname);
        }
        catch {
            throw new HttpError(400, 'Invalid path');
        }
        if (pathname.includes('\0') || pathname.includes('\\'))
            throw new HttpError(400, 'Invalid path');
        let root, relative;
        if (pathname.startsWith('/shared/')) {
            root = resolve(ROOT, 'shared');
            relative = pathname.slice(8);
        }
        else {
            root = resolve(ROOT, 'client');
            relative = pathname === '/' || pathname === '/companion' ? 'index.html' : pathname.slice(1);
        }
        const file = resolve(root, relative);
        if (!file.startsWith(root + sep) || !mime[extname(file)])
            throw new HttpError(404, 'Not found');
        try {
            const data = await readFile(file);
            res.writeHead(200, { 'Content-Type': mime[extname(file)], 'Cache-Control': 'no-cache' });
            res.end(req.method === 'HEAD' ? undefined : data);
        }
        catch (e) {
            if (['ENOENT', 'EISDIR'].includes(e.code))
                throw new HttpError(404, 'Not found');
            throw e;
        }
    }
    const server = http.createServer((req, res) => route(req, res).catch(e => {
        if (res.headersSent) {
            res.end();
            return;
        }
        const status = e instanceof HttpError ? e.status : e.message?.startsWith('Invalid') || e.message?.startsWith('Protocol mismatch') ? 400 : 500;
        if (status === 500)
            console.error('Request failed:', e.message);
        sendJson(res, status, { error: status === 500 ? 'Internal server error' : e.message });
    }));
    server.requestTimeout = 10000;
    server.headersTimeout = 15000;
    server.keepAliveTimeout = 65000;
    server.maxHeadersCount = 40;
    function tick() {
        const now = clock();
        accumulator += Math.max(0, now - lastTick);
        lastTick = now;
        if (accumulator > 500) {
            stats.droppedSteps += Math.floor((accumulator - 500) / (1000 / SIM_HZ));
            accumulator = 500;
        }
        while (accumulator >= 1000 / SIM_HZ) {
            accumulator -= 1000 / SIM_HZ;
            stats.ticks++;
            for (const room of rooms.values()) {
                if (room.autoStart && now >= room.autoStart) {
                    try {
                        start(room, null, true);
                    }
                    catch {
                        room.autoStart = null;
                    }
                }
                if (room.race) {
                    stepRace(room.race, now);
                    if (room.race.phase === 'finished')
                        record(room);
                }
            }
        }
        if (now - snapshotClock >= 1000 / SNAPSHOT_HZ) {
            snapshotClock = now;
            for (const room of rooms.values())
                broadcast(room, room.race ? { kind: 'state', state: snapshot(room.race) } : { kind: 'room', room: publicRoom(room) });
        }
    }
    const interval = setInterval(tick, 10);
    interval.unref();
    const housekeeping = setInterval(() => {
        const now = clock();
        for (const [key, s] of sessions) {
            if (s.stream)
                emit(s, { kind: 'heartbeat', serverTime: Date.now() });
            if (!s.stream && s.disconnectedAt != null && now - s.disconnectedAt > 120000) {
                const r = rooms.get(s.roomCode)?.race?.riders.find(x => x.id === s.id);
                if (r) {
                    r.dnf = true;
                    r.coast = true;
                }
            }
            if (!s.stream && now - s.seen > 1800000) {
                leave(s);
                unpair(s);
                s.stream?.end();
                sessions.delete(key);
            }
        }
        for (const [k, p] of pairs)
            if (p.expires < now)
                pairs.delete(k);
        for (const limiter of [creation, globalRate, pairAttempts, commands])
            limiter.clean();
    }, 10000);
    housekeeping.unref();
    return { server, sessions, rooms, pairs, store, stats, tick,
        async listen(port = 0, host = '127.0.0.1') { await new Promise((yes, no) => { server.once('error', no); server.listen(port, host, yes); }); return server.address().port; },
        async close() { closing = true; clearInterval(interval); clearInterval(housekeeping); for (const s of sessions.values()) {
            emit(s, { kind: 'shutdown' });
            s.stream?.end();
        } server.closeAllConnections(); await new Promise(r => server.close(r)); await store.queue; }
    };
}
