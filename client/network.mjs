import { PROTOCOL } from '../shared/protocol.mjs';
/** Native HTTP/SSE transport: no install-time dependencies, 15 Hz authoritative snapshots.
 * Commands use authenticated keep-alive POST. Bearer tokens never appear in URLs or server logs. */
export class RaceNetwork extends EventTarget {
    constructor({ base = '', storageKey = 'breakaway.session' } = {}) {
        super();
        this.base = base.replace(/\/$/, '');
        this.storageKey = storageKey;
        this.token = null;
        this.id = null;
        this.name = 'Rider';
        this.running = false;
        this.abort = null;
        this.lastMessage = 0;
        this.connected = false;
        this.rtt = 0;
        this.nextInputSeq = 0;
        this.nextControlSeq = 0;
        this.generation = 0;
        this.connecting = null;
        this.retryTimer = null;
        this.retryResolve = null;
    }
    emit(kind, data) { this.dispatchEvent(new CustomEvent(kind, { detail: data })); }
    async request(path, body, method = 'POST', timeout = 8000, authToken = this.token) {
        const control = new AbortController(), timer = setTimeout(() => control.abort(), timeout), start = performance.now();
        const headers = { 'X-Breakaway-Client': String(PROTOCOL) };
        if (body !== undefined)
            headers['Content-Type'] = 'application/json';
        if (authToken)
            headers.Authorization = `Bearer ${authToken}`;
        try {
            const res = await fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: control.signal, cache: 'no-store' });
            const data = await res.json();
            this.rtt = this.rtt ? this.rtt * .8 + (performance.now() - start) * .2 : performance.now() - start;
            if (!res.ok) {
                const e = new Error(data.error || `Server error ${res.status}`);
                e.status = res.status;
                throw e;
            }
            return data;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async connect(name, accessCode = '') {
        if (this.running)
            return;
        if (this.connecting)
            return this.connecting;
        const generation = ++this.generation;
        const task = this.openSession(name, accessCode, generation);
        this.connecting = task;
        try {
            await task;
        }
        finally {
            if (this.connecting === task)
                this.connecting = null;
        }
    }
    async openSession(name, accessCode, generation) {
        let key = this.token, identity;
        try {
            const saved = JSON.parse(sessionStorage.getItem(this.storageKey) || 'null');
            if (!key && saved?.base === this.base && typeof saved.token === 'string')
                key = saved.token;
        }
        catch { /* Storage can be disabled in a private browser. */ }
        if (key) {
            try {
                identity = await this.request('/api/me', undefined, 'GET', 8000, key);
            }
            catch (error) {
                // A temporary outage must not turn a reconnect into a second rider.
                if (error.status !== 401)
                    throw error;
                key = null;
            }
        }
        if (generation !== this.generation)
            return;
        if (!key) {
            identity = await this.request('/api/session', { name, accessCode, protocol: PROTOCOL }, 'POST', 8000, null);
            key = identity.token;
        }
        if (generation !== this.generation)
            return;
        this.token = key;
        this.id = identity.id;
        this.name = identity.name;
        this.nextInputSeq = identity.nextInputSeq || 0;
        this.nextControlSeq = identity.nextControlSeq || 0;
        try {
            sessionStorage.setItem(this.storageKey, JSON.stringify({ token: this.token, base: this.base }));
        }
        catch { /* A private browser may deny storage. The in-memory session still works. */ }
        this.running = true;
        this.loop(generation);
    }
    async loop(generation) {
        let retry = 0;
        const active = () => this.running && this.generation === generation;
        while (active()) {
            const control = new AbortController();
            this.abort = control;
            let watchdog;
            try {
                const res = await fetch(this.base + '/api/stream', { headers: { Authorization: `Bearer ${this.token}` }, signal: control.signal, cache: 'no-store' });
                if (!active()) {
                    control.abort();
                    break;
                }
                if (!res.ok) {
                    if (res.status === 401) {
                        this.running = false;
                        this.token = null;
                        try {
                            sessionStorage.removeItem(this.storageKey);
                        }
                        catch { }
                        this.emit('expired', { message: 'Your race session expired. Join a room again.' });
                    }
                    throw new Error(`Stream HTTP ${res.status}`);
                }
                if (!res.body?.getReader)
                    throw new Error('This browser lacks streaming fetch. Use WebView 90+ or an external browser.');
                const reader = res.body.getReader(), decoder = new TextDecoder();
                let buffer = '';
                this.lastMessage = performance.now();
                this.connected = true;
                retry = 0;
                this.emit('connection', { connected: true });
                watchdog = setInterval(() => { if (performance.now() - this.lastMessage > 16000)
                    control.abort(); }, 2000);
                while (active()) {
                    const { value, done } = await reader.read();
                    if (done || !active())
                        break;
                    this.lastMessage = performance.now();
                    buffer += decoder.decode(value, { stream: true });
                    if (buffer.length > 512000)
                        throw new Error('Oversized server stream');
                    let end;
                    while ((end = buffer.indexOf('\n\n')) >= 0) {
                        const chunk = buffer.slice(0, end);
                        buffer = buffer.slice(end + 2);
                        for (const line of chunk.split('\n'))
                            if (line.startsWith('data: ')) {
                                const data = JSON.parse(line.slice(6));
                                if (data.kind === 'hello') {
                                    this.nextInputSeq = data.nextInputSeq || 0;
                                    this.nextControlSeq = data.nextControlSeq || 0;
                                }
                                this.emit(data.kind, data);
                            }
                    }
                }
            }
            catch (e) {
                if (active())
                    this.emit('warning', { message: e.message });
            }
            finally {
                clearInterval(watchdog);
                if (this.generation === generation) {
                    this.connected = false;
                    this.emit('connection', { connected: false });
                }
            }
            if (active()) {
                retry++;
                await new Promise(resolve => {
                    this.retryResolve = resolve;
                    this.retryTimer = setTimeout(resolve, Math.min(8000, 350 * 2 ** Math.min(retry, 5)) + Math.random() * 150);
                });
                if (this.generation === generation) {
                    this.retryTimer = null;
                    this.retryResolve = null;
                }
            }
        }
    }
    async leave() { if (this.token)
        await this.request('/api/rooms/leave', {}); }
    stop() {
        this.running = false;
        this.generation++;
        this.connecting = null;
        this.abort?.abort();
        clearTimeout(this.retryTimer);
        this.retryResolve?.();
        this.retryTimer = null;
        this.retryResolve = null;
        this.connected = false;
    }
    async logout() { if (this.token) {
        try {
            await this.request('/api/logout', {});
        }
        catch { }
    } this.stop(); this.token = null; try {
        sessionStorage.removeItem(this.storageKey);
    }
    catch { } }
}
/** Snapshot interpolation is presentation only. The client never owns scoring or collisions. */
export class SnapshotBuffer {
    constructor() { this.frames = []; this.latest = null; this.actionClocks = new Map(); }
    push(state, now = performance.now()) { if (this.latest && state.tick < this.latest.tick && state.phase !== 'countdown')
        return; this.latest = state; this.frames.push({ state, now }); if (this.frames.length > 8)
        this.frames.shift(); }
    clear() { this.frames = []; this.latest = null; this.actionClocks.clear(); }
    sample(now = performance.now()) {
        if (!this.latest)
            return null;
        const target = now - 95;
        let a = this.frames[0], b = this.frames[this.frames.length - 1];
        for (let i = 1; i < this.frames.length; i++)
            if (this.frames[i].now >= target) {
                a = this.frames[i - 1];
                b = this.frames[i];
                break;
            }
        const t = Math.max(0, Math.min(1, (target - a.now) / Math.max(1, b.now - a.now)));
        const activeActions = new Set();
        const riders = this.latest.riders.map(r => {
            const x = a.state.riders.find(v => v.id === r.id), y = b.state.riders.find(v => v.id === r.id);
            const pose = !x || !y ? r : { ...r, z: x.z + (y.z - x.z) * t, lane: x.lane + (y.lane - x.lane) * t, speed: x.speed + (y.speed - x.speed) * t };
            // Legacy snapshots have no attack identity; keep their existing presentation.
            if (!['hit', 'kick'].includes(r.action) || !Number.isSafeInteger(r.actionId) || r.actionId < 1 || !Number.isFinite(r.actionTimer))
                return pose;
            activeActions.add(r.id);
            const sameAttack = x?.actionId === r.actionId && y?.actionId === r.actionId && x.action === r.action && y.action === r.action;
            let remaining = sameAttack && Number.isFinite(x.actionTimer) && Number.isFinite(y.actionTimer)
                ? x.actionTimer + (y.actionTimer - x.actionTimer) * t : r.actionTimer;
            const previous = this.actionClocks.get(r.id);
            // A newly received swing starts promptly. Older position-buffer frames must
            // never rewind its phase when they later catch up to that same attack.
            if (previous?.actionId === r.actionId && previous.action === r.action)
                remaining = Math.min(remaining, previous.remaining - Math.max(0, now - previous.now) / 1000);
            remaining = Math.max(0, Math.min(remaining, Number.isFinite(r.actionDuration) ? Math.max(0, r.actionDuration) : Infinity));
            this.actionClocks.set(r.id, { actionId: r.actionId, action: r.action, remaining, now });
            return { ...pose, actionTimer: remaining };
        });
        for (const id of this.actionClocks.keys())
            if (!activeActions.has(id)) this.actionClocks.delete(id);
        return { ...this.latest, riders };
    }
}
