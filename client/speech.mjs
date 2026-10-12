import { VoiceGate, parseVoice } from '../shared/voice.mjs';
export class VoiceController extends EventTarget {
    constructor() { super(); this.gate = new VoiceGate(); this.recognition = null; this.active = false; this.started = false; this.timer = null; this.session = 0; this.nativeSession = null; this.lastTranscript = null; this.failures = 0; this.backend = 'none'; this.calibration = null; this.nativeHandler = e => this.nativeEvent(e.detail); window.addEventListener('breakaway-voice', this.nativeHandler); }
    emit(kind, detail) { this.dispatchEvent(new CustomEvent(kind, { detail })); }
    capabilities() { return { native: typeof window.BreakawayBridge?.startVoice === 'function', browser: !!(window.SpeechRecognition || window.webkitSpeechRecognition), secure: window.isSecureContext }; }
    configure({ wakeWord, threshold } = {}) { if (wakeWord !== undefined)
        this.gate.wakeWord = wakeWord; if (threshold !== undefined)
        this.gate.threshold = threshold; }
    async start({ allowOnline = false } = {}) {
        if (this.active)
            return;
        this.active = true;
        this.failures = 0;
        this.lastTranscript = null;
        this.gate.reset();
        this.gate.enabled = true;
        if (this.capabilities().native) {
            this.backend = 'native';
            this.nativeSession = typeof window.BreakawayBridge.startVoiceSession === 'function' ? `voice-${++this.session}` : null;
            this.emit('status', { state: 'starting', message: 'Starting on-device microphone…' });
            try {
                if (this.nativeSession) window.BreakawayBridge.startVoiceSession(allowOnline, this.nativeSession);
                else window.BreakawayBridge.startVoice(allowOnline);
            }
            catch { this.active = false; this.emit('status', { state: 'unavailable', message: 'The Android speech adapter could not start. Pair a phone or retry voice setup.' }); }
            return;
        }
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!window.isSecureContext) {
            this.active = false;
            this.emit('status', { state: 'unavailable', message: 'Microphone requires HTTPS or localhost. Pair a phone using an HTTPS server.' });
            return;
        }
        if (!Recognition) {
            this.active = false;
            this.emit('status', { state: 'unavailable', message: 'Speech recognition is not available in this browser. Use the Android offline engine or a compatible phone.' });
            return;
        }
        if (!allowOnline) {
            this.active = false;
            this.emit('status', { state: 'unavailable', message: 'Browser speech may send audio to its provider. Consent is required; native Vosk stays on device.' });
            return;
        }
        this.backend = 'browser';
        this.startBrowser(Recognition);
    }
    startBrowser(Recognition) {
        if (!this.active) return;
        try { this.recognition = new Recognition(); }
        catch { this.active = false; this.emit('status', { state: 'unavailable', message: 'Browser speech recognition could not initialize. Try another browser or pair a phone.' }); return; }
        const recognition = this.recognition;
        recognition.lang = 'en-US';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        let lastFinalResult = -1;
        const current = () => this.active && this.recognition === recognition;
        recognition.onstart = () => { if (!current()) return; this.started = true; this.session++; this.emit('status', { state: 'listening', message: 'Listening · browser speech provider' }); };
        recognition.onresult = e => {
            if (!current()) return;
            this.failures = 0;
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const r = e.results[i], a = r[0];
                if (!a)
                    continue;
                if (r.isFinal) {
                    if (i <= lastFinalResult) continue;
                    lastFinalResult = i;
                }
                const event = { text: a.transcript, confidence: typeof a.confidence === 'number' ? a.confidence : 1, utteranceId: `web-${this.session}-${i}`, final: r.isFinal };
                this.accept(event);
            }
        };
        recognition.onerror = e => {
            if (!current()) return;
            if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) {
                this.stop();
                this.emit('status', { state: 'denied', message: `Microphone unavailable: ${e.error}. Check permission or pair a phone.` });
            }
            else if (['language-not-supported', 'bad-grammar'].includes(e.error)) {
                this.stop();
                this.emit('status', { state: 'unavailable', message: `Speech recognition unavailable: ${e.error}. Try another browser or pair a phone.` });
            }
            else if (e.error !== 'no-speech') {
                this.failures++;
                if (this.failures >= 8) {
                    this.stop();
                    this.emit('status', { state: 'unavailable', message: 'Speech recognition repeatedly failed. Check your connection, then enable voice again.' });
                    return;
                }
                this.emit('status', { state: 'retrying', message: `Voice ${e.error}; reconnecting…` });
            }
        };
        recognition.onend = () => {
            if (!current()) return;
            this.started = false;
            this.recognition = null;
            recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
            // A new recognizer gives late callbacks from the ended stream no authority.
            this.timer = setTimeout(() => this.startBrowser(Recognition), Math.min(8000, 250 * 2 ** Math.min(this.failures, 5)));
        };
        this.emit('status', { state: 'starting', message: 'Starting browser microphone…' });
        this.listen();
    }
    listen() { if (!this.active || this.started)
        return; try {
        this.recognition.start();
    }
    catch (e) {
        this.failures++;
        if (this.failures >= 8) {
            this.stop();
            this.emit('status', { state: 'unavailable', message: 'Speech recognition could not start. Enable voice again or pair a phone.' });
            return;
        }
        this.emit('status', { state: 'retrying', message: e.message });
        if (this.active)
            this.timer = setTimeout(() => this.listen(), 1500);
    } }
    nativeEvent(detail) { if (!detail || this.backend !== 'native')
        return; if (this.nativeSession && detail.sessionId !== this.nativeSession) return; if (detail.type === 'status') {
        if (!this.active && detail.state !== 'stopped') return;
        if (['unavailable', 'denied', 'stopped'].includes(detail.state))
            this.active = false;
        this.emit('status', detail);
    }
    else if (detail.type === 'result' && this.active)
        this.accept(detail); }
    accept(event) {
        if (!this.active || !event || typeof event.text !== 'string')
            return;
        // Continuous engines often repeat identical interim text every audio buffer.
        // Keep final-result processing immediate while avoiding redundant DOM updates.
        const transcript = `${event.final ? 'final' : 'partial'}:${event.text}`;
        if (transcript !== this.lastTranscript) {
            this.lastTranscript = transcript;
            this.emit('transcript', { text: event.text, final: event.final });
        }
        if (this.calibration) {
            if (!event.final || typeof event.utteranceId !== 'string' || this.calibration.seen.has(event.utteranceId)) return;
            this.calibration.seen.add(event.utteranceId);
            this.gate.seen.set(event.utteranceId, performance.now());
            const c = this.calibration, command = parseVoice(event.text, { confidence: event.confidence, threshold: .35 });
            c.results.push({ expected: c.words[c.index], recognized: command, confidence: event.confidence, match: command === parseVoice(c.words[c.index]) });
            c.index++;
            this.emit('calibration', { ...c, done: c.index >= c.words.length });
            if (c.index >= c.words.length)
                this.calibration = null;
            return;
        }
        const command = this.gate.accept(event, performance.now());
        if (command)
            this.emit('command', { command, confidence: event.confidence });
    }
    beginCalibration() { this.calibration = { words: ['left', 'right', 'hit', 'kick', 'chain', 'block', 'boost', 'coast'], index: 0, results: [], seen: new Set() }; this.emit('calibration', { ...this.calibration, done: false }); }
    stop() { this.active = false; this.gate.enabled = false; this.calibration = null; clearTimeout(this.timer); if (this.backend === 'native' && typeof window.BreakawayBridge?.stopVoice === 'function') {
        try { window.BreakawayBridge.stopVoice(); } catch { }
    } if (this.recognition) {
        this.recognition.onstart = this.recognition.onresult = this.recognition.onerror = this.recognition.onend = null;
        try {
            this.recognition.abort();
        }
        catch { }
    } this.recognition = null; this.started = false; this.emit('status', { state: 'stopped', message: 'Microphone off' }); }
    destroy() { this.stop(); window.removeEventListener('breakaway-voice', this.nativeHandler); }
}
