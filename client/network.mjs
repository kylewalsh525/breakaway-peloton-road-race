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
    }
    emit(kind, data) { this.dispatchEvent(new CustomEvent(kind, { detail: data })); }
    async request(path, body, method = 'POST', timeout = 8000) {
        const control = new AbortController(), timer = setTimeout(() => control.abort(), timeout), start = performance.now();
        const headers = { 'X-Breakaway-Client': String(PROTOCOL) };
        if (body !== undefined)
            headers['Content-Type'] = 'application/json';
        if (this.token)
            headers.Authorization = `Bearer ${this.token}`;
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
        try {
            const saved = JSON.parse(sessionStorage.getItem(this.storageKey) || 'null');
            if (saved && saved.base === this.base) {
                this.token = saved.token;
                const me = await this.request('/api/me', undefined, 'GET');
                this.id = me.id;
                this.name = me.name;
                this.nextInputSeq = me.nextInputSeq || 0;
                this.nextControlSeq = me.nextControlSeq || 0;
            }
        }
        catch {
            this.token = null;
        }
        if (!this.token) {
            const session = await this.request('/api/session', { name, accessCode, protocol: PROTOCOL });
            this.token = session.token;
            this.id = session.id;
            this.name = session.name;
            try {
                sessionStorage.setItem(this.storageKey, JSON.stringify({ token: this.token, base: this.base }));
            }
            catch { /* A private browser may deny storage. The in-memory session still works. */ }
        }
        this.running = true;
        this.loop();
    }
    async loop() {
        let retry = 0;
        while (this.running) {
            this.abort = new AbortController();
            let watchdog;
            try {
                const res = await fetch(this.base + '/api/stream', { headers: { Authorization: `Bearer ${this.token}` }, signal: this.abort.signal, cache: 'no-store' });
                if (!res.ok) {
                    if (res.status === 401) {
                        this.running = false;
                        this.token = null;
                        try {
                            sessionStorage.removeItem(this.storageKey);
                        }
                        catch { }
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
                    this.abort?.abort(); }, 2000);
                while (this.running) {
                    const { value, done } = await reader.read();
                    if (done)
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
                if (this.running)
                    this.emit('warning', { message: e.message });
            }
            finally {
                clearInterval(watchdog);
                this.connected = false;
                this.emit('connection', { connected: false });
            }
            if (this.running) {
                retry++;
                await new Promise(r => setTimeout(r, Math.min(8000, 350 * 2 ** Math.min(retry, 5)) + Math.random() * 150));
            }
        }
    }
    async leave() { if (this.token)
        await this.request('/api/rooms/leave', {}); }
    stop() { this.running = false; this.abort?.abort(); this.connected = false; }
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
    constructor() { this.frames = []; this.latest = null; }
    push(state, now = performance.now()) { if (this.latest && state.tick < this.latest.tick && state.phase !== 'countdown')
        return; this.latest = state; this.frames.push({ state, now }); if (this.frames.length > 8)
        this.frames.shift(); }
    clear() { this.frames = []; this.latest = null; }
    sample(now = performance.now()) {
        if (!this.latest)
            return null;
        if (this.frames.length < 2)
            return this.latest;
        const target = now - 95;
        let a = this.frames[0], b = this.frames[this.frames.length - 1];
        for (let i = 1; i < this.frames.length; i++)
            if (this.frames[i].now >= target) {
                a = this.frames[i - 1];
                b = this.frames[i];
                break;
            }
        const t = Math.max(0, Math.min(1, (target - a.now) / Math.max(1, b.now - a.now)));
        const riders = this.latest.riders.map(r => { const x = a.state.riders.find(v => v.id === r.id), y = b.state.riders.find(v => v.id === r.id); if (!x || !y)
            return r; return { ...r, z: x.z + (y.z - x.z) * t, lane: x.lane + (y.lane - x.lane) * t, speed: x.speed + (y.speed - x.speed) * t }; });
        return { ...this.latest, riders };
    }
}
