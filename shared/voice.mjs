import { ACTIONS } from './protocol.mjs';
export const VOICE_ALIASES = Object.freeze({
    left: 'left', 'go left': 'left', 'move left': 'left', right: 'right', 'go right': 'right', 'move right': 'right',
    center: 'center', centre: 'center', middle: 'center', hit: 'hit', punch: 'hit', attack: 'hit', chain: 'hit', 'swing chain': 'hit', kick: 'kick',
    block: 'block', shield: 'block', defend: 'block', boost: 'boost', turbo: 'boost', sprint: 'boost',
    brake: 'brake', brakes: 'brake', slow: 'brake', coast: 'coast', stop: 'coast', pause: 'coast',
    resume: 'resume', ride: 'resume', ready: 'ready', start: 'start'
});
/** Exact short phrases only: ordinary conversation and negations must not trigger actions. */
export function parseVoice(text, { wakeWord = false, confidence = 1, threshold = .55 } = {}) {
    if (typeof text !== 'string' || text.length > 120 || !Number.isFinite(confidence) || confidence < threshold)
        return null;
    let words = text.toLowerCase().replace(/[.,!?;:]/g, '').replace(/\s+/g, ' ').trim();
    if (wakeWord) {
        if (!words.startsWith('rider '))
            return null;
        words = words.slice(6);
    }
    else if (words.startsWith('rider '))
        words = words.slice(6);
    return Object.prototype.hasOwnProperty.call(VOICE_ALIASES, words) ? VOICE_ALIASES[words] : null;
}
/** A final result may repeat an interim result: utterance ID is authoritative for de-duplication. */
export class VoiceGate {
    constructor({ debounceMs = 360, wakeWord = false, threshold = .55 } = {}) {
        this.debounceMs = debounceMs;
        this.wakeWord = wakeWord;
        this.threshold = threshold;
        this.seen = new Map();
        this.last = new Map();
        this.enabled = true;
    }
    reset() { this.seen.clear(); this.last.clear(); }
    accept({ text, confidence = 1, utteranceId, final = true }, now) {
        if (!this.enabled || !final)
            return null;
        const command = parseVoice(text, { wakeWord: this.wakeWord, threshold: this.threshold, confidence });
        if (!command || typeof utteranceId !== 'string' || this.seen.has(utteranceId))
            return null;
        this.seen.set(utteranceId, now);
        for (const [id, time] of this.seen)
            if (now - time > 30000)
                this.seen.delete(id);
        if (this.seen.size > 256)
            this.seen.delete(this.seen.keys().next().value);
        if (now - (this.last.get(command) ?? -Infinity) < this.debounceMs)
            return null;
        this.last.set(command, now);
        return command;
    }
}
export const gameCommand = command => ACTIONS.includes(command);
