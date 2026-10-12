import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBuffer } from '../client/network.mjs';

function state(tick, rider = {}) {
    return { tick, phase: 'racing', riders: [{ id: 'rider', z: tick, lane: 2, speed: 10, action: 'hit', actionId: 1, actionDuration: .48, actionTimer: .48, ...rider }] };
}
const timer = (buffer, now) => buffer.sample(now).riders[0].actionTimer;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('network attack phase interpolates only matching attack identities', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(state(1, { actionTimer: .48 }), 0);
    buffer.push(state(2, { actionTimer: .38 }), 100);
    const sample = buffer.sample(145);
    near(sample.riders[0].actionTimer, .43);
    near(sample.riders[0].z, 1.5);
    near(timer(buffer, 161), .414);
    assert.equal(buffer.latest.riders[0].actionTimer, .38, 'Presentation never changes authoritative snapshots');
});

test('new attacks start immediately and buffered frames cannot rewind their phase', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(state(1, { actionTimer: .08 }), 0);
    near(timer(buffer, 0), .08);
    buffer.push(state(2, { action: 'kick', actionId: 2, actionDuration: .62, actionTimer: .62 }), 100);
    near(timer(buffer, 145), .62);
    buffer.push(state(3, { action: 'kick', actionId: 2, actionDuration: .62, actionTimer: .52 }), 200);
    // Buffered interpolation alone would rewind to .60; display time keeps moving forward.
    near(timer(buffer, 215), .55);
    near(timer(buffer, 231), .534);
    near(timer(buffer, 1200), 0);
});

test('same attack name with a new identity does not inherit the old swing clock', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(state(1, { actionTimer: .1 }), 0);
    near(timer(buffer, 80), .1);
    buffer.push(state(2, { actionId: 2, actionTimer: .48 }), 100);
    near(timer(buffer, 100), .48);
    near(timer(buffer, 116), .464);
});

test('legacy snapshots retain timer behavior while position interpolation remains bounded', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(state(1, { actionId: undefined, actionTimer: .4 }), 0);
    buffer.push(state(2, { actionId: undefined, actionTimer: .3 }), 100);
    near(timer(buffer, 145), .3);
    near(timer(buffer, 1000), .3);
    assert.equal(buffer.sample(1000).riders[0].z, 2);
});

test('clearing or ending an action discards its presentation clock', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(state(1, { actionTimer: .1 }), 0);
    near(timer(buffer, 0), .1);
    buffer.clear();
    buffer.push(state(1), 10);
    near(timer(buffer, 10), .48);
    buffer.push(state(2, { action: '', actionTimer: 0 }), 20);
    near(timer(buffer, 20), 0);
    buffer.push(state(3, { actionId: 2, actionTimer: .48 }), 30);
    near(timer(buffer, 30), .48);
});

test('out-of-order samples cannot increase remaining attack time and duration is bounded', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(state(1, { actionTimer: 10 }), 0);
    near(timer(buffer, 0), .48);
    near(timer(buffer, 100), .38);
    near(timer(buffer, 90), .38);
    near(timer(buffer, 2000), 0);
});
