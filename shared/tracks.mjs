import { rng } from './protocol.mjs';
/** Hand-authored art direction; all course geometry and decorations are generated locally. */
export const TRACKS = Object.freeze([
    { id: 'coast', name: 'Pacific Overdrive', subtitle: 'Salt air. Sharp elbows.', region: 'COASTAL HIGHWAY', length: 3200, seed: 7219, difficulty: 'Flow',
        sky: ['#202f66', '#eb937f', '#ffd79a'], road: ['#3b4257', '#41485e'], ground: ['#a7865e', '#b9956b'], verge: '#e3c4a0', accent: '#ffbb68', fog: '#f4bba2', hill: 0.8, curve: 0.8, scenery: 'palm', night: false },
    { id: 'canyon', name: 'Redline Canyon', subtitle: 'Take the inside line.', region: 'DESERT SWITCHBACKS', length: 3600, seed: 4417, difficulty: 'Technical',
        sky: ['#381e52', '#dc775e', '#ffd38f'], road: ['#49414b', '#514854'], ground: ['#945147', '#aa6350'], verge: '#e6ab7d', accent: '#ff815e', fog: '#e49b75', hill: 1.5, curve: 1.5, scenery: 'cactus', night: false },
    { id: 'metro', name: 'Neon Afterhours', subtitle: 'The city is your circuit.', region: 'MIDNIGHT EXPRESSWAY', length: 3000, seed: 8881, difficulty: 'Fast',
        sky: ['#090d28', '#29214c', '#644079'], road: ['#262b45', '#2d324c'], ground: ['#18253b', '#1e2d43'], verge: '#8c5eff', accent: '#8cf5ed', fog: '#51436d', hill: 0.35, curve: 1.1, scenery: 'city', night: true },
    { id: 'alpine', name: 'Summit Radio', subtitle: 'Thin air. Full send.', region: 'ALPINE PASS', length: 4000, seed: 2019, difficulty: 'Endurance',
        sky: ['#263e69', '#94b6c5', '#e3dfc6'], road: ['#404a54', '#47515b'], ground: ['#4d7162', '#5b806e'], verge: '#d3dfcc', accent: '#c6f18c', fog: '#c8dbd0', hill: 2.0, curve: 1.0, scenery: 'pine', night: false }
]);
export function getTrack(id) { return TRACKS.find(t => t.id === id) || TRACKS[0]; }
export function curveAt(track, z) { return (Math.sin(z / 350 + track.seed) * .62 + Math.sin(z / 710) * .38) * track.curve; }
export function hillAt(track, z) { return Math.sin(z / 230 + track.seed) * 22 * track.hill + Math.sin(z / 630) * 28 * track.hill; }
export function gradeAt(track, z) { return (hillAt(track, z + 4) - hillAt(track, z - 4)) / 8; }
export function makeCourse(track, length = track.length) {
    const rand = rng(track.seed), objects = [];
    for (let z = 140, i = 0; z < length - 60; z += 95 + rand() * 100, i++) {
        const lane = Math.floor(rand() * 5), type = i % 4 === 0 ? 'repair' : i % 4 === 1 ? 'boost' : i % 4 === 2 ? 'chain' : 'oil';
        objects.push({ id: `p${i}`, z: Math.round(z), lane, type });
        if (i % 3 === 2)
            objects.push({ id: `h${i}`, z: Math.round(z + 45), lane: (lane + 2) % 5, type: 'barrier' });
    }
    return objects;
}
