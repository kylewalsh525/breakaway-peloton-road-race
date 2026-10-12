import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInput, validateName, requireProtocol, rng, ordinal, PROTOCOL } from '../shared/protocol.mjs';
import { parseVoice, VoiceGate, VOICE_ALIASES } from '../shared/voice.mjs';
import { TelemetryMux, ProviderArbiter, decodeCyclingPower, decodeIndoorBike, validSample } from '../shared/telemetry.mjs';
import { emptyProfile, awardRace, levelFor } from '../shared/profile.mjs';
import { csvCell } from '../client/storage.mjs';
import { RateLimiter, equalSecret, token } from '../server/security.mjs';
const sample = { watts: 200, cadence: 85, resistance: 40, source: 'peloton-v1' };
const packet = (flags, power = 245) => { const v = new DataView(new ArrayBuffer(24)); v.setUint16(0, flags, true); v.setInt16(2, power, true); return v; };
for (const [phrase, expected] of Object.entries(VOICE_ALIASES))
    test(`voice exact alias: ${phrase}`, () => assert.equal(parseVoice(phrase), expected));
for (const phrase of ["don't go left", 'I left my phone', 'hit and then boost', 'left right', 'please attack this rider', 'nothing', '', 'stop talking', 'right now', 'constructor', '__proto__', 'toString'])
    test(`voice rejects conversation: ${phrase}`, () => assert.equal(parseVoice(phrase), null));
test('voice punctuation and optional wake word', () => { assert.equal(parseVoice('Rider, LEFT!'), 'left'); assert.equal(parseVoice('left', { wakeWord: true }), null); assert.equal(parseVoice('rider right', { wakeWord: true }), 'right'); });
test('voice confidence gate uses the actual result confidence', () => { const gate = new VoiceGate(); assert.equal(gate.accept({ text: 'hit', confidence: .2, utteranceId: 'a' }, 0), null); assert.equal(gate.accept({ text: 'hit', confidence: .8, utteranceId: 'b' }, 0), 'hit'); });
test('voice partial results never act', () => { const gate = new VoiceGate(); assert.equal(gate.accept({ text: 'hit', utteranceId: '1', final: false }, 0), null); assert.equal(gate.accept({ text: 'hit', utteranceId: '1', final: true }, 5), 'hit'); });
test('voice final repetition, per-action cooldown and disable', () => { const gate = new VoiceGate(); assert.equal(gate.accept({ text: 'hit', utteranceId: 'a' }, 0), 'hit'); assert.equal(gate.accept({ text: 'hit', utteranceId: 'a' }, 1000), null); assert.equal(gate.accept({ text: 'hit', utteranceId: 'b' }, 100), null); assert.equal(gate.accept({ text: 'left', utteranceId: 'c' }, 101), 'left'); assert.equal(gate.accept({ text: 'hit', utteranceId: 'd' }, 361), 'hit'); gate.enabled = false; assert.equal(gate.accept({ text: 'right', utteranceId: 'e' }, 999), null); });
test('voice malformed and oversized transcripts are rejected', () => { for (const text of [null, {}, 123, 'x'.repeat(121)])
    assert.equal(parseVoice(text), null); assert.equal(parseVoice('hit', { confidence: NaN }), null); });
test('voice de-duplication cache stays bounded', () => { const g = new VoiceGate(); for (let i = 0; i < 2000; i++)
    g.accept({ text: 'left', utteranceId: String(i) }, i * 400); assert.ok(g.seen.size <= 256); });
test('input is normalized, de-duplicated and strips authority fields', () => { const i = validateInput({ seq: 1, actions: ['left', 'left'], telemetry: sample, z: 999999, rank: 1 }); assert.deepEqual(i.actions, ['left']); assert.equal(i.z, undefined); assert.equal(i.telemetry.watts, 200); });
for (const seq of [-1, 1.5, NaN, Infinity, '1', null, 9007199254740992])
    test(`invalid sequence ${seq}`, () => assert.throws(() => validateInput({ seq, actions: [] })));
for (const actions of [null, ['teleport'], Array(7).fill('left'), {}, 'left'])
    test(`invalid actions ${JSON.stringify(actions)}`, () => assert.throws(() => validateInput({ seq: 1, actions })));
for (const [key, value] of [['watts', -1], ['watts', 2501], ['watts', NaN], ['cadence', 241], ['resistance', 101], ['source', 'root'], ['watts', '200']])
    test(`invalid telemetry ${key}/${value}`, () => assert.throws(() => validateInput({ seq: 1, actions: [], telemetry: { ...sample, [key]: value } })));
test('protocol negotiation never silently accepts a mismatch', () => { assert.doesNotThrow(() => requireProtocol(PROTOCOL)); assert.throws(() => requireProtocol(0), /Protocol mismatch/); });
test('names are normalized, bounded and remove markup delimiters', () => { assert.equal(validateName(' <Rider>\n '), 'Rider'); assert.equal(validateName('x'.repeat(80)).length, 20); assert.equal(validateName(null), 'Rider'); });
test('seeded random generator is repeatable and finite', () => { const a = rng(42), b = rng(42); for (let i = 0; i < 10000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
} });
test('ordinal formatting handles teens', () => assert.deepEqual([1, 2, 3, 11, 12, 13, 21].map(ordinal), ['1st', '2nd', '3rd', '11th', '12th', '13th', '21st']));
test('telemetry ages at sensor arrival, not every read', () => { let now = 0; const m = new TelemetryMux(() => now); m.select('peloton-v1'); assert.equal(m.read().stale, true); assert.ok(m.push({ ...sample, seq: 1 })); now = 2499; assert.equal(m.read().watts, 200); now = 2501; assert.equal(m.read().watts, 0); assert.equal(m.read().stale, true); assert.equal(m.push({ ...sample, seq: 1 }), false); assert.equal(m.read().stale, true); });
test('telemetry invalidation permits clean provider restart', () => { const m = new TelemetryMux(() => 0); m.select(sample.source); m.push({ ...sample, seq: 20 }); m.invalidate(); assert.ok(m.push({ ...sample, seq: 1 })); assert.equal(m.read().watts, 200); });
test('telemetry switching never substitutes demo for a missing bike', () => { const m = new TelemetryMux(() => 0); m.push({ ...sample, source: 'demo' }); m.select('peloton-bike'); assert.equal(m.read().watts, 0); assert.equal(m.read().stale, true); assert.throws(() => m.select('unsupported')); assert.equal(m.push({ ...sample, watts: Infinity }), false); });
test('provider arbitration requires a frame, not a successful bind', () => { const a = new ProviderArbiter(); a.start(0); assert.equal(a.status(100).live, false); assert.equal(a.status(5000).poll, true); assert.equal(a.frame('bike', { ...sample, source: 'peloton-bike' }, 5100), true); assert.equal(a.status(5101).live, true); assert.equal(a.frame('v1', sample, 5200), false); assert.equal(a.status(8001).poll, true); assert.equal(a.frame('v1', sample, 8001), true); });
test('provider invalid data cannot win arbitration', () => { const a = new ProviderArbiter(); a.start(0); assert.equal(a.frame('v1', { ...sample, watts: 999999 }, 1), false); assert.equal(a.status(2).provider, null); });
test('cycling power basic signed packet', () => { assert.equal(decodeCyclingPower(packet(0)).watts, 245); assert.equal(decodeCyclingPower(packet(0, -20)).watts, 0); });
test('cycling power crank cadence and 16-bit rollover', () => { const v = packet(32); v.setUint16(4, 0, true); v.setUint16(6, 512, true); const s = decodeCyclingPower(v, { rev: 65535, tick: 65024, changedAt: 0, cadence: 60 }, 1000); assert.equal(s.cadence, 60); });
test('cycling power optional fields preserve crank offsets', () => { const v = packet(1 | 4 | 16 | 32); v.setUint16(13, 11, true); v.setUint16(15, 2048, true); const s = decodeCyclingPower(v, { rev: 10, tick: 1024, changedAt: 0, cadence: 60 }, 1000); assert.equal(s.cadence, 60); });
test('cycling power unchanged crank eventually becomes zero', () => { const v = packet(32); v.setUint16(4, 20, true); v.setUint16(6, 1200, true); assert.equal(decodeCyclingPower(v, { rev: 20, tick: 1200, changedAt: 0, cadence: 80 }, 3000).cadence, 0); });
test('cycling power truncated optional fields fail closed', () => { assert.throws(() => decodeCyclingPower(new DataView(new ArrayBuffer(3)))); const v = packet(32); assert.throws(() => decodeCyclingPower(new DataView(v.buffer, 0, 5))); });
test('FTMS optional fields, centi-rpm and power', () => { const v = new DataView(new ArrayBuffer(10)); v.setUint16(0, 4 | 32 | 64, true); v.setUint16(2, 1200, true); v.setUint16(4, 170, true); v.setInt16(6, 45, true); v.setInt16(8, 230, true); assert.deepEqual(decodeIndoorBike(v), { watts: 230, cadence: 85, resistance: 45, source: 'bluetooth-ftms' }); });
test('FTMS missing or truncated power is never fabricated', () => { assert.throws(() => decodeIndoorBike(new DataView(new ArrayBuffer(4)))); const v = new DataView(new ArrayBuffer(2)); v.setUint16(0, 65, true); assert.throws(() => decodeIndoorBike(v)); });
test('CSV exports neutralize formulas and escape quotes', () => { assert.equal(csvCell('=SUM(1)'), '"\'=SUM(1)"'); assert.equal(csvCell('a"b'), '"a""b"'); });
test('rate limiter bounds activity and expires old buckets', () => { const l = new RateLimiter(2, 100); assert.equal(l.allow('a', 0), true); assert.equal(l.allow('a', 1), true); assert.equal(l.allow('a', 2), false); assert.equal(l.allow('a', 100), true); l.clean(400); assert.equal(l.buckets.size, 0); });
test('auth secrets are random and equality handles different lengths', () => { assert.notEqual(token(), token()); assert.equal(token().length, 64); assert.equal(equalSecret('a', 'a'), true); assert.equal(equalSecret('a', 'ab'), false); });
test('local career award is idempotent and sources have separate records', () => { let p = emptyProfile(); const state = { trackId: 'coast', mode: 'arcade', riders: [{ id: 'me', rank: 1, dnf: false, z: 3200, hits: 5, finishedAt: 150, source: 'demo', crashes: 0 }] }; p = awardRace(p, state, 'me', 'ride1'); assert.equal(p.races, 1); assert.equal(p.wins, 1); assert.ok(p.achievements.includes('elbows-out')); assert.equal(awardRace(p, state, 'me', 'ride1').races, 1); state.riders[0].source = 'peloton-v1'; p = awardRace(p, state, 'me', 'ride2'); assert.equal(Object.keys(p.records).length, 2); assert.ok(levelFor(p.xp) >= 2); });
test('local career missing rider is a no-op', () => { const p = emptyProfile(); assert.equal(awardRace(p, { riders: [] }, 'none', 'r1'), p); });
