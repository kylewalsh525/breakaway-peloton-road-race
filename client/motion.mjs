import { clamp } from '../shared/protocol.mjs';

/** Smooth fixed-step solo poses for display only. Never changes simulation or race authority. */
export function interpolateRace(previous, current, alpha) {
    if (!previous || !current || previous.phase !== 'racing' || current.phase !== 'racing' || previous.trackId !== current.trackId)
        return current;
    const t = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1);
    const before = new Map(previous.riders.map(r => [r.id, r]));
    return { ...current, riders: current.riders.map(r => {
        const p = before.get(r.id);
        if (!p || r.finishedAt !== null || r.dnf || Math.abs(r.z - p.z) > 20) return r;
        const sameAttack = r.action && r.actionId === p.actionId && r.action === p.action;
        const actionTimer = sameAttack ? p.actionTimer + (r.actionTimer - p.actionTimer) * t : r.actionTimer;
        return { ...r, actionTimer, z: p.z + (r.z - p.z) * t, lane: p.lane + (r.lane - p.lane) * t, speed: p.speed + (r.speed - p.speed) * t };
    }) };
}
