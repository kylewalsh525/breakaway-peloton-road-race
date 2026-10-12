import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController } from '../client/speech.mjs';
import { BikeController } from '../client/bike.mjs';
import { VOICE_ALIASES } from '../shared/voice.mjs';

const managed = new WeakMap();
function browser(t, extra = {}, bluetooth) {
    managed.set(t, []);
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const window = Object.assign(new EventTarget(), { isSecureContext: true }, extra);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { bluetooth, userAgent: 'test' } });
    t.after(() => {
        for (const controller of managed.get(t)) controller.destroy();
        if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else delete globalThis.window;
        if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else delete globalThis.navigator;
    });
    return window;
}
class Recognition {
    start() { this.onstart?.(); }
    abort() { this.aborted = true; }
}
const result = (text, id = 0) => ({ resultIndex: id, results: { length: id + 1, [id]: { isFinal: true, 0: { transcript: text, confidence: .95 } } } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('browser speech restart ignores late results from the previous microphone session', async t => {
    browser(t, { SpeechRecognition: Recognition });
    const voice = new VoiceController(), commands = [];
    managed.get(t).push(voice);
    voice.addEventListener('command', e => commands.push(e.detail.command));
    await voice.start({ allowOnline: true });
    const previous = voice.recognition, lateResult = previous.onresult, lateError = previous.onerror;
    previous.onresult(result('left'));
    voice.stop();
    await voice.start({ allowOnline: true });
    lateResult(result('hit', 1));
    lateError({ error: 'not-allowed' });
    voice.recognition.onresult(result('right'));
    assert.equal(voice.active, true);
    assert.equal(previous.aborted, true);
    assert.deepEqual(commands, ['left', 'right']);
});

test('browser permission denial releases capture and cannot restart on an old end callback', async t => {
    browser(t, { SpeechRecognition: Recognition });
    const voice = new VoiceController(), states = [];
    managed.get(t).push(voice);
    voice.addEventListener('status', e => states.push(e.detail.state));
    await voice.start({ allowOnline: true });
    const recognition = voice.recognition, end = recognition.onend;
    recognition.onerror({ error: 'not-allowed' });
    end();
    assert.equal(voice.active, false);
    assert.equal(recognition.aborted, true);
    assert.equal(states.at(-1), 'denied');
});

test('repeated provider failures stop retrying even if the recognizer starts between errors', async t => {
    browser(t, { SpeechRecognition: Recognition });
    const voice = new VoiceController(), states = [];
    managed.get(t).push(voice);
    voice.addEventListener('status', e => states.push(e.detail.state));
    await voice.start({ allowOnline: true });
    for (let i = 0; i < 8; i++) {
        voice.recognition.onstart();
        voice.recognition.onerror({ error: 'network' });
    }
    assert.equal(voice.active, false);
    assert.equal(states.at(-1), 'unavailable');
});

test('unavailable browser recognition constructor reports a recoverable status', async t => {
    browser(t, { SpeechRecognition: class { constructor() { throw new Error('Service missing'); } } });
    const voice = new VoiceController();
    managed.get(t).push(voice);
    let state;
    voice.addEventListener('status', e => { state = e.detail.state; });
    await voice.start({ allowOnline: true });
    assert.equal(voice.active, false);
    assert.equal(state, 'unavailable');
});

test('native listening status is not overwritten after a synchronous bridge response', async t => {
    const window = browser(t);
    window.BreakawayBridge = {
        startVoice: () => window.dispatchEvent(new CustomEvent('breakaway-voice', { detail: { type: 'status', state: 'listening' } })),
        stopVoice() {}
    };
    const voice = new VoiceController(), states = [];
    managed.get(t).push(voice);
    voice.addEventListener('status', e => states.push(e.detail.state));
    await voice.start();
    assert.equal(states.at(-1), 'listening');
});

test('calibration counts each final utterance once and never leaks it into gameplay', async t => {
    browser(t, { SpeechRecognition: Recognition });
    const voice = new VoiceController(), commands = [];
    let completed;
    managed.get(t).push(voice);
    voice.addEventListener('command', e => commands.push(e.detail.command));
    voice.addEventListener('calibration', e => { if (e.detail.done) completed = e.detail.results; });
    await voice.start({ allowOnline: true });
    voice.beginCalibration();
    const words = [...voice.calibration.words];
    for (const [i, text] of words.entries()) {
        const event = { text, confidence: .95, final: true, utteranceId: `check-${i}` };
        voice.accept(event);
        voice.accept(event);
        if (voice.calibration) assert.equal(voice.calibration.index, i + 1);
    }
    assert.equal(voice.calibration, null);
    assert.deepEqual(commands, []);
    assert.equal(completed.length, 8);
    assert.equal(completed.every(result => result.match), true);
});

test('late Bluetooth chooser completion cannot replace the selected demo power source', async t => {
    const chooser = deferred();
    browser(t, {}, { requestDevice: () => chooser.promise });
    const bike = new BikeController(), states = [];
    managed.get(t).push(bike);
    bike.addEventListener('status', e => states.push(e.detail.state));
    const pending = bike.select('bluetooth-power');
    await bike.select('demo');
    let connections = 0;
    chooser.resolve({ gatt: { connect() { connections++; } } });
    await pending;
    assert.equal(connections, 0);
    assert.equal(bike.mode, 'demo');
    assert.equal(bike.bluetooth, null);
    assert.equal(states.at(-1), 'demo');
});

test('Bluetooth connection completing after a source change is disconnected', async t => {
    const connection = deferred(), device = new EventTarget();
    let disconnected = 0;
    device.gatt = { connected: false, connect: () => connection.promise, disconnect() { this.connected = false; disconnected++; } };
    browser(t, {}, { requestDevice: async () => device });
    const bike = new BikeController();
    managed.get(t).push(bike);
    const pending = bike.select('bluetooth-power');
    await Promise.resolve();
    await bike.select('demo');
    device.gatt.connected = true;
    connection.resolve({});
    await pending;
    assert.equal(disconnected, 1);
    assert.equal(bike.bluetooth, null);
});

test('invalid native frames cannot claim live bike telemetry or change providers', async t => {
    const window = browser(t, { BreakawayBridge: { startSensors() {}, stopSensors() {} } });
    const bike = new BikeController(), states = [];
    managed.get(t).push(bike);
    bike.addEventListener('status', e => states.push(e.detail.state));
    await bike.select('peloton');
    for (const source of ['bogus', 'demo', 'peloton-bike']) {
        window.dispatchEvent(new CustomEvent('breakaway-bike', { detail: { type: 'telemetry', source, watts: 3000, cadence: 90, resistance: 40 } }));
    }
    assert.equal(bike.read().stale, true);
    assert.equal(bike.read().source, 'peloton-v1');
    assert.equal(states.includes('live'), false);
    window.dispatchEvent(new CustomEvent('breakaway-bike', { detail: { type: 'telemetry', source: 'peloton-bike', watts: 220, cadence: 90, resistance: 40 } }));
    assert.equal(bike.read().watts, 220);
    assert.equal(states.at(-1), 'live');
});

test('native sensor status arriving after selecting demo does not replace demo feedback', async t => {
    const window = browser(t, { BreakawayBridge: { startSensors() {}, stopSensors() {} } });
    const bike = new BikeController(), states = [];
    managed.get(t).push(bike);
    bike.addEventListener('status', e => states.push(e.detail.state));
    await bike.select('peloton');
    await bike.select('demo');
    window.dispatchEvent(new CustomEvent('breakaway-bike', { detail: { type: 'status', state: 'stopped' } }));
    assert.equal(states.at(-1), 'demo');
});

for (const backend of ['browser', 'native']) {
    test(`${backend} speech routes every supported phrase to its command exactly once`, async t => {
        const window = browser(t, backend === 'browser' ? { SpeechRecognition: Recognition } : { BreakawayBridge: { startVoice() {}, stopVoice() {} } });
        const voice = new VoiceController(), commands = [];
        managed.get(t).push(voice);
        voice.gate.debounceMs = 0; // Exercise vocabulary independently of the per-action cooldown.
        voice.addEventListener('command', event => commands.push(event.detail.command));
        await voice.start({ allowOnline: true });
        let index = 0;
        for (const [text, command] of Object.entries(VOICE_ALIASES)) {
            if (backend === 'browser') {
                const event = result(text, index++);
                voice.recognition.onresult(event);
                voice.recognition.onresult(event);
            } else {
                const event = { type: 'result', text, confidence: .95, final: true, utteranceId: `native-${index++}` };
                window.dispatchEvent(new CustomEvent('breakaway-voice', { detail: event }));
                window.dispatchEvent(new CustomEvent('breakaway-voice', { detail: event }));
            }
            assert.equal(commands.at(-1), command, text);
        }
        assert.deepEqual(commands, Object.values(VOICE_ALIASES));
    });
}

test('native session tags prevent queued old commands and statuses after re-enabling voice', async t => {
    const sessions = [];
    const window = browser(t, { BreakawayBridge: { startVoice() {}, startVoiceSession(allow, session) { sessions.push(session); }, stopVoice() {} } });
    const voice = new VoiceController(), commands = [];
    managed.get(t).push(voice);
    voice.addEventListener('command', event => commands.push(event.detail.command));
    await voice.start();
    voice.stop();
    await voice.start();
    const send = detail => window.dispatchEvent(new CustomEvent('breakaway-voice', { detail }));
    send({ type: 'result', sessionId: sessions[0], text: 'hit', confidence: .99, final: true, utteranceId: 'old' });
    send({ type: 'status', sessionId: sessions[0], state: 'stopped' });
    send({ type: 'result', sessionId: sessions[1], text: 'kick', confidence: .99, final: true, utteranceId: 'new' });
    assert.equal(voice.active, true);
    assert.deepEqual(commands, ['kick']);
});

test('normal browser stream restart retires old callbacks while keeping voice enabled', async t => {
    browser(t, { SpeechRecognition: Recognition });
    const voice = new VoiceController(), commands = [];
    managed.get(t).push(voice);
    voice.addEventListener('command', event => commands.push(event.detail.command));
    await voice.start({ allowOnline: true });
    const old = voice.recognition, lateResult = old.onresult;
    old.onend();
    lateResult(result('hit'));
    await new Promise(resolve => setTimeout(resolve, 280));
    assert.notEqual(voice.recognition, old);
    lateResult(result('kick', 1));
    voice.recognition.onresult(result('boost'));
    assert.equal(voice.active, true);
    assert.deepEqual(commands, ['boost']);
});

test('browser never replays old final indexes after command-cache eviction', async t => {
    browser(t, { SpeechRecognition: Recognition });
    const voice = new VoiceController(), commands = [];
    managed.get(t).push(voice);
    voice.addEventListener('command', event => commands.push(event.detail.command));
    await voice.start({ allowOnline: true });
    voice.recognition.onresult(result('punch', 0));
    voice.gate.reset(); // Simulates expiry/eviction of the bounded generic utterance cache.
    voice.recognition.onresult(result('punch', 0));
    voice.recognition.onresult(result('kick', 1));
    assert.deepEqual(commands, ['hit', 'kick']);
});

test('unchanged partial hypotheses update the transcript once and never issue commands', async t => {
    browser(t, { SpeechRecognition: Recognition });
    const voice = new VoiceController(), transcripts = [], commands = [];
    managed.get(t).push(voice);
    voice.addEventListener('transcript', event => transcripts.push(event.detail));
    voice.addEventListener('command', event => commands.push(event.detail.command));
    await voice.start({ allowOnline: true });
    const partial = result('swing chain');
    partial.results[0].isFinal = false;
    for (let i = 0; i < 100; i++) voice.recognition.onresult(partial);
    assert.equal(transcripts.length, 1);
    assert.equal(commands.length, 0);
    voice.recognition.onresult(result('swing chain'));
    assert.equal(transcripts.length, 2);
    assert.deepEqual(commands, ['hit']);
});

test('wake-word mode rejects bare commands, sentences, and low-confidence final results', async t => {
    browser(t, { SpeechRecognition: Recognition });
    const voice = new VoiceController(), commands = [];
    managed.get(t).push(voice);
    voice.configure({ wakeWord: true });
    voice.addEventListener('command', event => commands.push(event.detail.command));
    await voice.start({ allowOnline: true });
    for (const [index, text] of ['punch', 'do not punch', 'rider swing chain now', 'rider punch'].entries()) {
        const event = result(text, index);
        if (index === 3) event.results[index][0].confidence = .1;
        voice.recognition.onresult(event);
    }
    voice.recognition.onresult(result('rider swing chain', 4));
    voice.recognition.onresult(result('rider kick', 5));
    assert.deepEqual(commands, ['hit', 'kick']);
});
