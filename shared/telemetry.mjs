import { STALE_MS, SOURCE_IDS, finite } from './protocol.mjs';
export function validSample(s) {
    return s && SOURCE_IDS.includes(s.source) && Number.isFinite(s.watts) && s.watts >= 0 && s.watts <= 2500 &&
        Number.isFinite(s.cadence) && s.cadence >= 0 && s.cadence <= 240 && Number.isFinite(s.resistance) && s.resistance >= 0 && s.resistance <= 100;
}
/** Never renew a stale measurement by merely retransmitting it. Arrival time belongs to the sensor adapter. */
export class TelemetryMux {
    constructor(clock = () => performance.now()) { this.clock = clock; this.samples = new Map(); this.selected = 'demo'; this.lastSequence = new Map(); }
    select(source) { if (!SOURCE_IDS.includes(source))
        throw new Error('Unsupported telemetry source'); this.selected = source; }
    push(sample) {
        if (!validSample(sample))
            return false;
        if (Number.isFinite(sample.seq)) {
            if (sample.seq <= (this.lastSequence.get(sample.source) ?? -1))
                return false;
            this.lastSequence.set(sample.source, sample.seq);
        }
        this.samples.set(sample.source, { ...sample, at: this.clock() });
        return true;
    }
    read() {
        const s = this.samples.get(this.selected), age = s ? this.clock() - s.at : Infinity;
        if (!s || age > STALE_MS)
            return { watts: 0, cadence: 0, resistance: s?.resistance || 0, source: this.selected, stale: true, age };
        return { watts: s.watts, cadence: s.cadence, resistance: s.resistance, source: s.source, stale: false, age };
    }
    invalidate(source = this.selected) { this.samples.delete(source); this.lastSequence.delete(source); }
}
/** Decode a complete Cycling Power Measurement packet (Bluetooth SIG 0x2A63). */
export function decodeCyclingPower(view, previous = null, now = 0) {
    if (!(view instanceof DataView) || view.byteLength < 4)
        throw new Error('Truncated Cycling Power packet');
    const flags = view.getUint16(0, true);
    let offset = 4, cadence = 0, crank = previous;
    const skip = n => { if (offset + n > view.byteLength)
        throw new Error('Truncated optional power field'); offset += n; };
    if (flags & 1)
        skip(1);
    if (flags & 4)
        skip(2);
    if (flags & 16)
        skip(6);
    if (flags & 32) {
        if (offset + 4 > view.byteLength)
            throw new Error('Truncated crank field');
        const rev = view.getUint16(offset, true), tick = view.getUint16(offset + 2, true);
        if (previous) {
            const dr = (rev - previous.rev + 65536) % 65536, dt = (tick - previous.tick + 65536) % 65536;
            if (dt > 0 && dr < 10)
                cadence = Math.min(240, dr * 60 * 1024 / dt);
            else if (dr === 0 && now - previous.changedAt < 2500)
                cadence = previous.cadence || 0;
        }
        crank = { rev, tick, cadence, changedAt: !previous || rev !== previous.rev ? now : previous.changedAt };
    }
    return { watts: Math.max(0, view.getInt16(2, true)), cadence, resistance: 0, source: 'bluetooth-power', crank };
}
/** FTMS Indoor Bike Data 0x2AD2; reads only fields the packet actually contains. */
export function decodeIndoorBike(view) {
    if (!(view instanceof DataView) || view.byteLength < 2)
        throw new Error('Truncated FTMS packet');
    const flags = view.getUint16(0, true);
    let o = 2, cadence = 0, watts = 0, resistance = 0;
    const read = (n, fn) => { if (o + n > view.byteLength)
        throw new Error('Truncated FTMS field'); const v = fn(o); o += n; return v; };
    const skip = n => read(n, () => 0);
    if (!(flags & 1))
        skip(2);
    if (flags & 2)
        skip(2);
    if (flags & 4)
        cadence = read(2, x => view.getUint16(x, true)) / 2;
    if (flags & 8)
        skip(2);
    if (flags & 16)
        skip(3);
    if (flags & 32)
        resistance = Math.max(0, Math.min(100, read(2, x => view.getInt16(x, true))));
    if (flags & 64)
        watts = Math.max(0, read(2, x => view.getInt16(x, true)));
    if (!(flags & 64))
        throw new Error('FTMS packet has no instantaneous power');
    return { watts, cadence, resistance, source: 'bluetooth-ftms' };
}
/** Probe selection needs frames, not successful service bindings. */
export class ProviderArbiter {
    constructor({ silenceMs = 5000, staleMs = 2500 } = {}) { this.silenceMs = silenceMs; this.staleMs = staleMs; this.active = null; this.lastFrame = -Infinity; this.startedAt = 0; }
    start(now) { this.startedAt = now; this.active = null; this.lastFrame = -Infinity; }
    frame(provider, sample, now) { if (!validSample(sample))
        return false; if (this.active && this.active !== provider && now - this.lastFrame < this.staleMs)
        return false; this.active = provider; this.lastFrame = now; return true; }
    status(now) { return { provider: this.active, live: !!this.active && now - this.lastFrame <= this.staleMs, poll: (!this.active && now - this.startedAt >= this.silenceMs) || (!!this.active && now - this.lastFrame > this.staleMs) }; }
}
