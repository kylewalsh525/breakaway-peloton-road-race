import test from 'node:test';
import assert from 'node:assert/strict';
import { createRace, createRider, addRider, fillBots, applyInput, actionsFor, stepRace, snapshot, standings, DT } from '../shared/simulation.mjs';
import { TRACKS, makeCourse, getTrack } from '../shared/tracks.mjs';
const input = (seq, watts = 220, actions = [], extra = {}) => ({ seq, actions, telemetry: { watts, cadence: 85, resistance: 45, source: 'demo', ...extra } });
function setup(options = {}) { const race = createRace({ countdown: 0, ...options }); const rider = addRider(race, 'me', 'Rider'); stepRace(race, 0); return { race, rider }; }
function run(race, n, watts = 220) { for (let i = 0; i < n; i++) {
    const now = race.time * 1000;
    const r = race.riders.find(x => x.id === 'me');
    applyInput(race, 'me', input(r.lastInput + 1, watts), now);
    stepRace(race, now);
} }
test('grid is bounded and has distinct starting positions', () => { const { race } = setup(); fillBots(race, 7); assert.equal(race.riders.length, 8); assert.equal(new Set(race.riders.map(r => r.lane + ':' + r.z)).size, 8); assert.throws(() => addRider(race, 'ninth', 'No')); });
test('duplicate rider IDs are rejected', () => { const { race } = setup(); assert.throws(() => addRider(race, 'me', 'Impersonator')); });
test('power accelerates; zero power is stationary', () => { const a = setup(), b = setup(); run(a.race, 300, 200); run(b.race, 300, 0); assert.ok(a.rider.z > 80); assert.equal(b.rider.z, 0); assert.ok(a.rider.speed > b.rider.speed); });
test('higher watts produce higher long-run speed', () => { const a = setup(), b = setup(); run(a.race, 150, 120); run(b.race, 150, 400); assert.ok(b.rider.speed > a.rider.speed); });
test('countdown does not accumulate distance', () => { const race = createRace({ countdown: 3 }); const r = addRider(race, 'me'); for (let i = 0; i < 80; i++) {
    applyInput(race, 'me', input(i, 2000), i * DT * 1000);
    stepRace(race, i * DT * 1000);
} assert.equal(r.z, 0); assert.equal(race.phase, 'countdown'); });
test('stale telemetry removes propulsion and cancels boosts', () => { const { race, rider } = setup(); run(race, 200); actionsFor(race, rider, ['boost']); assert.ok(rider.boost > 0); stepRace(race, rider.lastTelemetry + 2501); assert.equal(rider.watts, 0); assert.equal(rider.stale, true); assert.equal(rider.boost, 0); for (let i = 0; i < 200; i++)
    stepRace(race, 200000); assert.equal(rider.speed, 0); });
test('client-stale samples are zeroed immediately', () => { const { race, rider } = setup(); applyInput(race, 'me', input(1, 999, [], { stale: true }), 0); assert.equal(rider.watts, 0); assert.equal(rider.stale, true); });
test('duplicate and out-of-order packets do not repeat lane changes', () => { const { race, rider } = setup(); assert.equal(applyInput(race, 'me', input(4, 220, ['left']), 0), true); assert.equal(applyInput(race, 'me', input(4, 220, ['left']), 1000), false); assert.equal(applyInput(race, 'me', input(3, 220, ['right']), 1000), false); assert.equal(rider.targetLane, 1); });
test('malformed client input cannot teleport a rider', () => { const { race, rider } = setup(); applyInput(race, 'me', { ...input(1), z: 999999, finishedAt: 0, rank: 1 }, 0); assert.equal(rider.z, 0); assert.equal(rider.finishedAt, null); assert.throws(() => applyInput(race, 'me', input(2, 999999), 0)); });
test('unknown players and bots reject client input', () => { const { race } = setup(); fillBots(race, 1); assert.equal(applyInput(race, 'other', input(1), 0), false); assert.equal(applyInput(race, 'bot-0', input(1), 0), false); });
test('lane steering is clamped and smoothly interpolated', () => { const { race, rider } = setup(); for (let i = 0; i < 20; i++) {
    rider.cooldown = {};
    actionsFor(race, rider, ['left']);
} assert.equal(rider.targetLane, 0); run(race, 30); assert.equal(rider.lane, 0); rider.cooldown = {}; actionsFor(race, rider, ['center']); assert.equal(rider.targetLane, 2); });
test('coast and resume never change physical resistance', () => { const { race, rider } = setup(); run(race, 200); const resistance = rider.resistance; actionsFor(race, rider, ['coast']); run(race, 150); assert.equal(rider.speed, 0); assert.equal(rider.resistance, resistance); actionsFor(race, rider, ['resume']); run(race, 60); assert.ok(rider.speed > 0); });
test('boost requires real-time power and stamina', () => { const { race, rider } = setup(); actionsFor(race, rider, ['boost']); assert.equal(rider.boost, 0); applyInput(race, 'me', input(1), 0); rider.energy = 20; actionsFor(race, rider, ['boost']); assert.equal(rider.boost, 0); rider.energy = 65; actionsFor(race, rider, ['boost']); assert.equal(rider.energy, 37); assert.ok(rider.boost > 2); actionsFor(race, rider, ['boost']); assert.equal(rider.energy, 37); });
test('hit requires range and applies authoritative damage', () => { const { race, rider } = setup(); const other = addRider(race, 'other', 'Other', { lane: 3 }); other.z = 3; rider.energy = 65; actionsFor(race, rider, ['hit']); assert.equal(other.armor, 83); assert.equal(rider.hits, 1); actionsFor(race, rider, ['hit']); assert.equal(other.armor, 83); });
test('block parries attacks and avoids damage', () => { const { race, rider } = setup(); const other = addRider(race, 'other', 'Other', { lane: 3 }); other.z = 2; actionsFor(race, other, ['block']); actionsFor(race, rider, ['hit']); assert.equal(other.armor, 100); assert.equal(rider.hits, 0); assert.equal(race.events.at(-1).type, 'parry'); });
test('kick pushes lane and out-of-range attacks miss', () => { const { race, rider } = setup(); const other = addRider(race, 'other', 'Other', { lane: 3 }); other.z = 3; actionsFor(race, rider, ['kick']); assert.equal(other.targetLane, 4); assert.equal(other.armor, 76); other.z = 100; rider.cooldown = {}; actionsFor(race, rider, ['hit']); assert.equal(rider.hits, 1); });
test('chain increases reach and damage', () => { const { race, rider } = setup(); const other = addRider(race, 'other', 'Other', { lane: 3 }); other.z = 9; rider.chain = 10; actionsFor(race, rider, ['hit']); assert.equal(other.armor, 75); });
test('armor break triggers recovery, not elimination', () => { const { race, rider } = setup(); const other = addRider(race, 'other', 'Other', { lane: 3 }); other.z = 2; other.armor = 10; actionsFor(race, rider, ['hit']); assert.equal(other.crashes, 1); assert.equal(other.armor, 65); assert.ok(other.stun > 1); assert.equal(other.dnf, false); });
test('pickups are consumed once per rider', () => { const { race, rider } = setup(); race.objects = [{ id: 'p', z: .2, lane: 2, type: 'boost' }]; rider.energy = 10; run(race, 2); assert.equal(rider.pickups, 1); assert.ok(rider.energy > 40); run(race, 10); assert.equal(rider.pickups, 1); });
test('hazards reduce speed and armor; shield absorbs one', () => { const a = setup(), b = setup(); for (const pair of [a, b]) {
    pair.race.objects = [{ id: 'p', z: .2, lane: 2, type: 'barrier' }];
    pair.rider.speed = 10;
} b.rider.shield = 1; run(a.race, 1); run(b.race, 1); assert.ok(a.rider.armor < b.rider.armor); assert.equal(b.rider.armor, 100); assert.equal(b.rider.shield, 0); });
test('drafting works behind a rider in the same lane', () => { const { race, rider } = setup(); const ahead = addRider(race, 'other', 'Other', { lane: 2 }); ahead.z = 9; run(race, 1); assert.equal(rider.draft, 1); });
test('following contact prevents driving through a slower rider', () => { const { race, rider } = setup(); const ahead = addRider(race, 'other', 'Other', { lane: 2 }); ahead.z = 1.3; ahead.speed = 1; rider.speed = 15; run(race, 1, 500); assert.ok(rider.speed < 3); assert.ok(rider.z < ahead.z); });
test('finish results are sorted and stable after race end', () => { const { race, rider } = setup({ length: 25 }); run(race, 600); assert.equal(race.phase, 'finished'); assert.ok(rider.finishedAt > 0); assert.equal(rider.z, 25); assert.equal(standings(race)[0].id, 'me'); const seconds = rider.finishedAt; run(race, 100); assert.equal(rider.finishedAt, seconds); });
test('race timeout marks unfinished riders DNF', () => { const { race, rider } = setup({ duration: 1 }); run(race, 35, 0); assert.equal(race.phase, 'finished'); assert.equal(rider.dnf, true); });
test('equalized mode uses configured FTP, absolute mode does not', () => { const a = setup({ mode: 'equalized' }), b = setup({ mode: 'equalized' }); a.rider.ftp = 100; b.rider.ftp = 200; run(a.race, 160, 100); run(b.race, 160, 200); assert.ok(Math.abs(a.rider.z - b.rider.z) < .001); });
test('snapshots never expose cooldown maps or random generator', () => { const { race } = setup(); const s = snapshot(race); assert.equal(s.rng, undefined); assert.equal(s.riders[0].cooldown, undefined); assert.doesNotThrow(() => JSON.stringify(s)); });
test('simulation is deterministic with identical seed and inputs', () => { const a = setup({ seed: 7 }), b = setup({ seed: 7 }); fillBots(a.race, 7); fillBots(b.race, 7); run(a.race, 4000); run(b.race, 4000); assert.deepEqual(snapshot(a.race), snapshot(b.race)); });
for (const track of TRACKS)
    test(`course ${track.id}: repeatable content and long-run invariants`, () => { assert.deepEqual(makeCourse(track, track.length), makeCourse(track, track.length)); const { race } = setup({ trackId: track.id, seed: 991, length: 1000 }); fillBots(race, 7); for (let i = 0; i < 4000; i++) {
        run(race, 1, 100 + i % 500);
        for (const r of race.riders) {
            assert.ok(Number.isFinite(r.z) && Number.isFinite(r.speed));
            assert.ok(r.lane >= 0 && r.lane <= 4);
            assert.ok(r.energy >= 0 && r.energy <= 100);
            assert.ok(r.armor >= 0 && r.armor <= 100);
            assert.ok(r.speed >= 0 && r.speed < 40);
        }
        if (race.phase === 'finished')
            break;
    } assert.equal(race.phase, 'finished'); });

test('multiplayer ends after a 45-second grace period when a rival stops', () => {
    const { race, rider } = setup({ length: 25, duration: 300 });
    const stopped = addRider(race, 'stopped', 'Stopped', { lane: 4 });
    run(race, 1800, 220);
    assert.equal(race.phase, 'finished');
    assert.ok(rider.finishedAt > 0);
    assert.equal(stopped.dnf, true);
    assert.ok(race.elapsed - race.firstHumanFinish >= 45);
    assert.ok(race.elapsed - race.firstHumanFinish < 45 + DT * 2);
});
