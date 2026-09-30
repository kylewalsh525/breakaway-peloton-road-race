/** Wire contract. A major mismatch fails closed before joining a race. */
export const VERSION = '0.9.0';
export const PROTOCOL = 1;
export const SIM_HZ = 30;
export const SNAPSHOT_HZ = 15;
export const MAX_RIDERS = 8;
export const STALE_MS = 2500;
export const ACTIONS = Object.freeze(['left', 'right', 'center', 'hit', 'kick', 'block', 'boost', 'brake', 'coast', 'resume']);
export const SOURCE_IDS = Object.freeze(['demo', 'peloton-v1', 'peloton-bike', 'peloton-poll', 'bluetooth-power', 'bluetooth-ftms', 'external']);
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const finite = (n, fallback = 0) => typeof n === 'number' && Number.isFinite(n) ? n : fallback;
export function plainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function validateName(name) {
    if (typeof name !== 'string')
        return 'Rider';
    return name.normalize('NFKC').replace(/[\u0000-\u001f\u007f<>"'`]/g, '').trim().slice(0, 20) || 'Rider';
}
export function validateInput(message) {
    if (!plainObject(message) || !Number.isSafeInteger(message.seq) || message.seq < 0)
        throw new Error('Invalid input sequence');
    if (!Array.isArray(message.actions) || message.actions.length > 6 || message.actions.some(a => !ACTIONS.includes(a)))
        throw new Error('Invalid actions');
    const result = { seq: message.seq, actions: [...new Set(message.actions)] };
    if (message.telemetry !== undefined) {
        const t = message.telemetry;
        if (!plainObject(t) || !SOURCE_IDS.includes(t.source))
            throw new Error('Invalid telemetry source');
        for (const [key, max] of [['watts', 2500], ['cadence', 240], ['resistance', 100]]) {
            if (typeof t[key] !== 'number' || !Number.isFinite(t[key]) || t[key] < 0 || t[key] > max)
                throw new Error(`Invalid ${key}`);
        }
        result.telemetry = { watts: t.watts, cadence: t.cadence, resistance: t.resistance, source: t.source, stale: t.stale === true };
    }
    return result;
}
export function requireProtocol(value) {
    if (value !== PROTOCOL)
        throw new Error(`Protocol mismatch: client ${value}, server ${PROTOCOL}. Update the game, not the bike firmware.`);
}
/** Small non-cryptographic generator used only for deterministic game content. */
export function rng(seed) {
    let state = seed >>> 0 || 0x5a17;
    return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}
export function ordinal(n) { return `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`; }
