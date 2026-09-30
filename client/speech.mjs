import { VoiceGate, parseVoice } from '../shared/voice.mjs';
export class VoiceController extends EventTarget {
    constructor() { super(); this.gate = new VoiceGate(); this.recognition = null; this.active = false; this.started = false; this.timer = null; this.session = 0; this.failures = 0; this.backend = 'none'; this.calibration = null; this.nativeHandler = e => this.nativeEvent(e.detail); window.addEventListener('breakaway-voice', this.nativeHandler); }
    emit(kind, detail) { this.dispatchEvent(new CustomEvent(kind, { detail })); }
    capabilities() { return { native: !!window.BreakawayBridge, browser: !!(window.SpeechRecognition || window.webkitSpeechRecognition), secure: window.isSecureContext }; }
    configure({ wakeWord, threshold } = {}) { if (wakeWord !== undefined)
        this.gate.wakeWord = wakeWord; if (threshold !== undefined)
        this.gate.threshold = threshold; }
    async start({ allowOnline = false } = {}) {
        if (this.active)
            return;
        this.active = true;
        this.failures = 0;
        this.gate.enabled = true;
        if (window.BreakawayBridge) {
            this.backend = 'native';
            window.BreakawayBridge.startVoice(allowOnline);
            this.emit('status', { state: 'starting', message: 'Starting on-device microphone…' });
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
        this.recognition = new Recognition();
        const recognition = this.recognition;
        recognition.lang = 'en-US';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.onstart = () => { this.started = true; this.session++; this.failures = 0; this.emit('status', { state: 'listening', message: 'Listening · browser speech provider' }); };
        recognition.onresult = e => {
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const r = e.results[i], a = r[0];
                if (!a)
                    continue;
                const event = { text: a.transcript, confidence: typeof a.confidence === 'number' ? a.confidence : 1, utteranceId: `web-${this.session}-${i}`, final: r.isFinal };
                this.accept(event);
            }
        };
        recognition.onerror = e => {
            if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) {
                this.active = false;
                clearTimeout(this.timer);
                this.emit('status', { state: 'denied', message: `Microphone unavailable: ${e.error}. Check permission or pair a phone.` });
            }
            else if (e.error !== 'no-speech') {
                this.failures++;
                this.emit('status', { state: 'retrying', message: `Voice ${e.error}; reconnecting…` });
            }
        };
        recognition.onend = () => { this.started = false; if (this.active)
            this.timer = setTimeout(() => this.listen(), Math.min(8000, 250 * 2 ** Math.min(this.failures, 5))); };
        this.listen();
    }
    listen() { if (!this.active || this.started)
        return; try {
        this.recognition.start();
    }
    catch (e) {
        this.failures++;
        this.emit('status', { state: 'retrying', message: e.message });
        if (this.active)
            this.timer = setTimeout(() => this.listen(), 1500);
    } }
    nativeEvent(detail) { if (!detail)
        return; if (detail.type === 'status') {
        if (['unavailable', 'denied', 'stopped'].includes(detail.state))
            this.active = false;
        this.emit('status', detail);
    }
    else if (detail.type === 'result' && this.active)
        this.accept(detail); }
    accept(event) {
        if (!this.active)
            return;
        this.emit('transcript', { text: event.text, final: event.final });
        if (this.calibration && event.final) {
            const c = this.calibration, command = parseVoice(event.text, { confidence: event.confidence, threshold: .35 });
            c.results.push({ expected: c.words[c.index], recognized: command, confidence: event.confidence, match: command === c.words[c.index] });
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
    beginCalibration() { this.calibration = { words: ['left', 'right', 'hit', 'block', 'boost', 'coast'], index: 0, results: [] }; this.emit('calibration', { ...this.calibration, done: false }); }
    stop() { this.active = false; this.gate.enabled = false; this.calibration = null; clearTimeout(this.timer); if (window.BreakawayBridge)
        window.BreakawayBridge.stopVoice(); if (this.recognition) {
        this.recognition.onend = null;
        try {
            this.recognition.abort();
        }
        catch { }
    } this.recognition = null; this.started = false; this.emit('status', { state: 'stopped', message: 'Microphone off' }); }
    destroy() { this.stop(); window.removeEventListener('breakaway-voice', this.nativeHandler); }
}
