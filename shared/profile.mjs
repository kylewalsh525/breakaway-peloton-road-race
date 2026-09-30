export function emptyProfile() { return { version: 1, xp: 0, races: 0, wins: 0, totalKm: 0, totalHits: 0, records: {}, achievements: [], history: [] }; }
export function awardRace(profile, state, riderId, raceId) {
    if (!profile || profile.version !== 1)
        profile = emptyProfile();
    if (profile.history.some(r => r.id === raceId))
        return profile;
    const rider = state.riders.find(r => r.id === riderId);
    if (!rider)
        return profile;
    const next = JSON.parse(JSON.stringify(profile));
    next.races++;
    next.wins += rider.rank === 1 && !rider.dnf ? 1 : 0;
    next.totalKm += Math.max(0, rider.z) / 1000;
    next.totalHits += rider.hits;
    const earned = 40 + (rider.dnf ? 0 : 60) + rider.hits * 8 + (rider.rank === 1 && !rider.dnf ? 75 : 0);
    next.xp += earned;
    const key = state.trackId + ':' + state.mode + ':' + rider.source;
    if (rider.finishedAt !== null && (!next.records[key] || rider.finishedAt < next.records[key]))
        next.records[key] = rider.finishedAt;
    const unlock = (id, test) => { if (test && !next.achievements.includes(id))
        next.achievements.push(id); };
    unlock('first-finish', !rider.dnf);
    unlock('podium', rider.rank <= 3 && !rider.dnf);
    unlock('clean-line', rider.crashes === 0 && !rider.dnf);
    unlock('elbows-out', rider.hits >= 5);
    unlock('century', next.totalKm >= 100);
    unlock('road-captain', next.wins >= 10);
    next.history.unshift({ id: raceId, trackId: state.trackId, source: rider.source, seconds: rider.finishedAt, rank: rider.rank, earned });
    next.history = next.history.slice(0, 100);
    return next;
}
export const levelFor = xp => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 150));
export const ACHIEVEMENTS = { 'first-finish': 'First finish', 'podium': 'Podium regular', 'clean-line': 'Clean line', 'elbows-out': 'Elbows out', 'century': '100 km club', 'road-captain': 'Road captain' };
