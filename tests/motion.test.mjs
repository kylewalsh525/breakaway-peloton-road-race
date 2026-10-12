import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolateRace } from '../client/motion.mjs';
const rider = (id, z, lane) => ({id,z,lane,speed:20,targetLane:3,energy:65,finishedAt:null,dnf:false});
const state = riders => ({phase:'racing',trackId:'coast',riders});
test('solo render interpolation fills the gap between physics ticks without changing authoritative state', () => {
    const a=state([rider('me',100,1)]), b=state([rider('me',100.6,1.15)]);
    const view=interpolateRace(a,b,.5);
    assert.equal(view.riders[0].z,100.3);
    assert.equal(view.riders[0].lane,1.075);
    assert.equal(view.riders[0].targetLane,3);
    assert.equal(b.riders[0].z,100.6);
    assert.equal(a.riders[0].lane,1);
});
test('render interpolation follows identities across race order changes', () => {
    const view=interpolateRace(state([rider('a',10,1),rider('b',9,2)]),state([rider('b',11,2),rider('a',10.5,1)]),.5);
    assert.deepEqual(view.riders.map(r=>[r.id,r.z]),[['b',10],['a',10.25]]);
});
test('render interpolation does not replay a finish, teleport, countdown, or another course', () => {
    const a=state([rider('me',0,1)]), b=state([{...rider('me',1,2),finishedAt:12}]);
    assert.equal(interpolateRace(a,b,0).riders[0],b.riders[0]);
    const c=state([rider('me',200,2)]);
    assert.equal(interpolateRace(a,c,0).riders[0],c.riders[0]);
    for (const previous of [null,{...a,phase:'countdown'},{...a,trackId:'alpine'}]) assert.equal(interpolateRace(previous,c,.5),c);
});


test('attack clocks interpolate within one swing and start new attacks immediately', () => {
    const rider = { id: 'a', lane: 2, z: 1, speed: 4, finishedAt: null, action: 'hit', actionId: 1, actionTimer: .4 };
    const previous = { phase: 'racing', trackId: 'coast', riders: [rider] };
    const current = { ...previous, riders: [{ ...rider, actionTimer: .366 }] };
    assert.equal(interpolateRace(previous, current, .5).riders[0].actionTimer, .383);
    current.riders[0] = { ...rider, actionId: 2, actionTimer: .48 };
    assert.equal(interpolateRace(previous, current, .5).riders[0].actionTimer, .48);
    assert.equal(previous.riders[0].actionTimer, .4);
});
