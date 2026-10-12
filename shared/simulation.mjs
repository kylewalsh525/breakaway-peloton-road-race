import { SIM_HZ, STALE_MS, clamp, rng, validateName, validateInput } from './protocol.mjs';
import { getTrack, gradeAt, makeCourse } from './tracks.mjs';
export const DT = 1 / SIM_HZ;
export const COLORS = ['#d52e2e', '#426cda', '#e2bd36', '#8952b6', '#e27832', '#4b9860', '#53a8cc', '#d9d8ba'];
const BOT_NAMES = ['Moxie', 'Ghost', 'Switch', 'Juno', 'Echo', 'Sprocket', 'Rivet', 'Vega'];
const COOLDOWNS = { hit: .85, kick: 1.25, block: 2.2, boost: 4.2, left: .18, right: .18, center: .18, brake: .2, coast: .2, resume: .2 };
export function createRider(id, name = 'Rider', options = {}) {
    return { id, name: validateName(name), bot: !!options.bot, color: options.color || COLORS[0],
        lane: options.lane ?? 2, targetLane: options.lane ?? 2, z: 0, speed: 0, watts: 0, cadence: 0, resistance: 0, source: options.bot ? 'bot' : 'demo',
        energy: 65, armor: 100, chain: 0, shield: 0, boost: 0, stun: 0, action: '', actionTimer: 0, actionDuration: 0, actionId: 0, actionSide: 1, actionChain: false, pendingAttack: null, impactTimer: 0, impactDuration: 0, impactSide: 1, coast: false, brake: 0,
        cooldown: {}, lastInput: -1, lastTelemetry: -Infinity, stale: true, connected: true,
        finishedAt: null, dnf: false, hits: 0, crashes: 0, pickups: 0, draft: 0, combo: 0,
        ftp: clamp(options.ftp || 200, 75, 500), effort: 0, powerSum: 0, samples: 0, consumed: [], ai: 0, aiPower: options.aiPower || 190 };
}
export function createRace({ trackId = 'coast', seed = 3241, duration = 0, length, mode = 'arcade', difficulty = 'normal', countdown = 3 } = {}) {
    const track = getTrack(trackId), distance = length || track.length;
    return { version: 1, seed, rng: rng(seed), trackId: track.id, length: distance, mode, difficulty,
        tick: 0, time: 0, elapsed: 0, countdown, phase: 'countdown', riders: [], objects: makeCourse(track, distance),
        events: [], eventId: 0, endedAt: null, firstHumanFinish: null, finishGrace: 45, maxSeconds: duration || Math.max(360, distance / 4) };
}
export function addRider(race, id, name, options = {}) {
    if (race.riders.some(r => r.id === id))
        throw new Error('Duplicate rider');
    if (race.riders.length >= 8)
        throw new Error('Race full');
    const rider = createRider(id, name, { color: COLORS[race.riders.length], lane: [2, 1, 3, 0, 4, 1, 3, 2][race.riders.length], ...options });
    rider.z = 0 - Math.floor(race.riders.length / 5) * 5;
    race.riders.push(rider);
    return rider;
}
export function fillBots(race, count = 7) {
    const n = Math.min(count, 8 - race.riders.length);
    for (let i = 0; i < n; i++)
        addRider(race, `bot-${i}`, BOT_NAMES[i], { bot: true, aiPower: (race.difficulty === 'easy' ? 140 : race.difficulty === 'hard' ? 255 : 190) + race.rng() * 35 });
}
function event(race, type, rider, data = {}) {
    race.events.push({ id: ++race.eventId, tick: race.tick, type, rider: rider.id, ...data });
    if (race.events.length > 40)
        race.events.shift();
}
export function actionsFor(race, rider, actions) {
    if (rider.finishedAt !== null || rider.dnf)
        return;
    for (const action of actions) {
        if (!Object.hasOwn(COOLDOWNS, action))
            continue;
        if ((rider.cooldown[action] || 0) > 0)
            continue;
        if (action === 'coast') {
            rider.coast = true;
            rider.boost = 0;
            rider.shield = 0;
            rider.pendingAttack = null;
            rider.action = '';
            rider.actionTimer = 0;
            event(race, 'coast', rider);
            continue;
        }
        if (action === 'resume') {
            rider.coast = false;
            event(race, 'resume', rider);
            continue;
        }
        if (race.phase !== 'racing')
            continue;
        if (action === 'left' || action === 'right' || action === 'center') {
            rider.targetLane = action === 'center' ? 2 : clamp(rider.targetLane + (action === 'left' ? -1 : 1), 0, 4);
        }
        else if (action === 'brake')
            rider.brake = 1.2;
        else if (action === 'boost') {
            if (rider.energy < 28 || rider.stale || rider.coast || rider.stun > 0 || rider.watts < 15)
                continue;
            rider.energy -= 28;
            rider.boost = 2.6;
            event(race, 'boost', rider);
        }
        else if (action === 'block') {
            if (rider.energy < 12 || rider.stun > 0)
                continue;
            rider.energy -= 12;
            rider.shield = 1.4;
            event(race, 'block', rider);
        }
        else if (action === 'hit' || action === 'kick') {
            if (rider.stun > 0 || rider.coast || rider.energy < 6 || rider.actionTimer > 0)
                continue;
            rider.energy -= 6;
            const chain = action === 'hit' && rider.chain > 0;
            const target = attackTarget(race, rider, chain ? 10 : 7);
            rider.action = action;
            rider.actionDuration = action === 'kick' ? .62 : chain ? .66 : .48;
            rider.actionTimer = rider.actionDuration;
            rider.actionId++;
            rider.actionChain = chain;
            rider.actionSide = target && target.lane !== rider.lane ? Math.sign(target.lane - rider.lane) : rider.actionSide;
            // Start the pose immediately; resolve contact at the visible strike, once.
            rider.pendingAttack = { action, chain, side: rider.actionSide, contactTimer: rider.actionDuration * .55 };
        }
        rider.cooldown[action] = COOLDOWNS[action];
    }
}
function attackTarget(race, rider, reach, side = 0) {
    return race.riders.filter(t => t !== rider && !t.coast && !t.dnf && t.finishedAt === null &&
        Math.abs(t.z - rider.z) < reach && Math.abs(t.lane - rider.lane) < 1.25 &&
        (!side || Math.abs(t.lane - rider.lane) < .15 || Math.sign(t.lane - rider.lane) === side))
        .sort((a, b) => Math.abs(a.z - rider.z) - Math.abs(b.z - rider.z))[0];
}
function recoil(rider, duration, side = 1) {
    rider.stun = Math.max(rider.stun, duration);
    rider.impactTimer = duration;
    rider.impactDuration = duration;
    rider.impactSide = side;
}
function resolveAttack(race, rider) {
    const attack = rider.pendingAttack;
    if (!attack || rider.actionTimer > attack.contactTimer) return;
    rider.pendingAttack = null;
    if (rider.coast || rider.dnf || rider.finishedAt !== null) return;
    const target = attackTarget(race, rider, attack.chain ? 10 : 7, attack.side);
    if (!target) {
        event(race, 'swing', rider, { action: attack.action, chain: attack.chain, side: attack.side });
        return;
    }
    if (target.shield > 0) {
        event(race, 'parry', target, { attacker: rider.id });
        recoil(rider, .2, attack.side);
        return;
    }
    const damage = attack.action === 'kick' ? 24 : attack.chain ? 25 : 17;
    target.armor = clamp(target.armor - damage, 0, 100);
    target.speed *= attack.action === 'kick' ? .78 : .88;
    recoil(target, .28, -attack.side);
    rider.hits++;
    rider.combo++;
    rider.energy = clamp(rider.energy + 7, 0, 100);
    if (attack.action === 'kick') target.targetLane = clamp(target.targetLane + attack.side, 0, 4);
    event(race, 'hit', rider, { target: target.id, damage, action: attack.action, chain: attack.chain, side: attack.side });
    if (target.armor <= 0) crash(race, target);
}
function crash(race, rider) {
    rider.crashes++; rider.armor = 65; recoil(rider, 1.6, rider.impactSide);
    rider.speed *= .35; rider.chain = 0; rider.combo = 0; rider.boost = 0;
    rider.pendingAttack = null; rider.action = ''; rider.actionTimer = 0;
    event(race, 'crash', rider);
}
export function applyInput(race, id, message, nowMs) {
    const rider = race.riders.find(r => r.id === id);
    if (!rider || rider.bot)
        return false;
    const input = validateInput(message);
    if (input.seq <= rider.lastInput)
        return false;
    rider.lastInput = input.seq;
    if (input.telemetry) {
        const t = input.telemetry;
        rider.source = t.source;
        rider.resistance = t.resistance;
        if (t.stale) {
            rider.stale = true;
            rider.watts = 0;
            rider.cadence = 0;
            rider.boost = 0;
            rider.lastTelemetry = -Infinity;
        }
        else {
            rider.lastTelemetry = nowMs;
            rider.watts = t.watts;
            rider.cadence = t.cadence;
            rider.stale = false;
        }
    }
    actionsFor(race, rider, input.actions);
    return true;
}
function updateBot(race, r, dt, nowMs) {
    r.ai -= dt;
    r.watts = r.aiPower * (.93 + .13 * Math.sin(race.elapsed / 11 + Number(r.id.slice(4))));
    r.cadence = 75 + r.watts / 16;
    r.stale = false;
    r.lastTelemetry = nowMs;
    if (r.ai > 0)
        return;
    r.ai = .6 + race.rng() * .5;
    const obstacle = race.objects.find(o => ['barrier', 'oil'].includes(o.type) && o.z > r.z && o.z - r.z < 26 && Math.abs(o.lane - r.targetLane) < .8);
    if (obstacle)
        actionsFor(race, r, [r.targetLane > 2 ? 'left' : 'right']);
    else {
        const pickup = race.objects.find(o => !['barrier', 'oil'].includes(o.type) && o.z > r.z && o.z - r.z < 34 && !r.consumed.includes(o.id));
        const leader = race.riders.find(o => o !== r && o.z - r.z > 2 && o.z - r.z < 20);
        if (pickup && race.rng() < .6)
            r.targetLane = pickup.lane;
        else if (leader && race.rng() < .65)
            r.targetLane = Math.round(leader.lane);
        else if (race.rng() < .18)
            actionsFor(race, r, [race.rng() < .5 ? 'left' : 'right']);
    }
    const near = race.riders.find(o => o !== r && Math.abs(o.z - r.z) < 7 && Math.abs(o.lane - r.lane) < 1.2);
    if (near && race.rng() < .4)
        actionsFor(race, r, [race.rng() < .7 ? 'hit' : 'block']);
    if (r.energy > 65 && race.rng() < .25)
        actionsFor(race, r, ['boost']);
}
/** Single fixed-size step. Network clients may NEVER choose the timestep. */
export function stepRace(race, nowMs = race.time * 1000) {
    const dt = DT;
    race.tick++;
    race.time += dt;
    for (const r of race.riders) {
        if (!r.bot && nowMs - r.lastTelemetry > STALE_MS) {
            r.stale = true;
            r.watts = 0;
            r.cadence = 0;
            r.boost = 0;
        }
    }
    if (race.phase === 'finished')
        return;
    if (race.phase === 'countdown') {
        race.countdown = Math.max(0, race.countdown - dt);
        if (race.countdown <= 1e-6) {
            race.phase = 'racing';
            event(race, 'start', { id: 'race' });
        }
        return;
    }
    race.elapsed += dt;
    const track = getTrack(race.trackId);
    for (const r of race.riders) {
        if (r.finishedAt !== null || r.dnf)
            continue;
        if (r.bot)
            updateBot(race, r, dt, nowMs);
        for (const key of ['shield', 'boost', 'stun', 'actionTimer', 'impactTimer', 'brake', 'chain'])
            r[key] = Math.max(0, r[key] - dt);
        for (const key of Object.keys(r.cooldown))
            r.cooldown[key] = Math.max(0, r.cooldown[key] - dt);
        if (r.actionTimer === 0)
            r.action = '';
        const turn = clamp(r.targetLane - r.lane, -dt * 4.5, dt * 4.5);
        r.lane = clamp(r.lane + turn, 0, 4);
        const effective = r.coast || r.stale ? 0 : r.watts;
        const watts = race.mode === 'equalized' ? effective / r.ftp * 200 : effective;
        const draftTarget = race.riders.find(o => o !== r && o.z - r.z > 2 && o.z - r.z < 15 && Math.abs(o.lane - r.lane) < .48 && !o.dnf);
        r.draft = draftTarget ? 1 : 0;
        let target = watts > 0 ? Math.min(27, Math.cbrt(watts) * 2.38) : 0;
        target *= 1 + Math.max(-.16, Math.min(.16, -gradeAt(track, r.z) * 1.1));
        if (r.draft)
            target *= 1.07;
        if (r.boost > 0)
            target *= 1.32;
        if (r.stun > 0)
            target *= .32;
        if (r.brake > 0)
            target *= .38;
        const accel = target > r.speed ? 2.8 : 3.6;
        r.speed = Math.max(0, r.speed + clamp(target - r.speed, -accel * dt, accel * dt));
        r.energy = clamp(r.energy + dt * (r.coast ? 3.5 : r.draft ? 6 : effective > 20 ? 2.3 : .7), 0, 100);
        if (r.stun === 0)
            r.armor = Math.min(100, r.armor + dt * .65);
        const oldZ = r.z;
        const ahead = race.riders.filter(o => o !== r && !o.dnf && o.finishedAt === null && o.z > r.z && o.z - r.z < 2.2 && Math.abs(o.lane - r.lane) < .30).sort((a, b) => a.z - b.z)[0];
        if (ahead && r.speed > ahead.speed)
            r.speed = Math.max(0, Math.min(r.speed, ahead.speed + (ahead.z - r.z - 1.2) * 2));
        r.z += r.speed * dt;
        r.powerSum += effective * dt;
        r.samples += dt;
        r.effort += effective * dt / 1000;
        for (const o of race.objects) {
            if (o.z < oldZ - .8 || o.z > r.z + .8 || Math.abs(r.lane - o.lane) > .45 || r.consumed.includes(o.id))
                continue;
            r.consumed.push(o.id);
            if (o.type === 'barrier' || o.type === 'oil') {
                if (r.shield > 0) {
                    r.shield = 0;
                    event(race, 'parry', r);
                    continue;
                }
                r.speed *= o.type === 'barrier' ? .55 : .78;
                r.armor -= o.type === 'barrier' ? 30 : 12;
                recoil(r, .5, r.lane < 2 ? -1 : 1);
                event(race, 'obstacle', r, { kind: o.type });
                if (r.armor <= 0)
                    crash(race, r);
            }
            else {
                r.pickups++;
                if (o.type === 'repair')
                    r.armor = Math.min(100, r.armor + 35);
                if (o.type === 'boost')
                    r.energy = Math.min(100, r.energy + 32);
                if (o.type === 'chain')
                    r.chain = 20;
                event(race, 'pickup', r, { kind: o.type });
            }
        }
        if (r.z >= race.length) {
            r.finishedAt = race.elapsed - dt + (race.length - oldZ) / Math.max(.00001, r.speed);
            r.z = race.length;
            r.boost = 0;
            if(!r.bot && race.firstHumanFinish===null) race.firstHumanFinish=race.elapsed;
            event(race, 'finish', r, { seconds: r.finishedAt });
        }
    }
    for (const r of race.riders) resolveAttack(race, r);
    const humans = race.riders.filter(r => !r.bot);
    if ((humans.length && humans.every(r => r.finishedAt !== null || r.dnf)) || race.riders.every(r => r.finishedAt !== null || r.dnf) || race.elapsed >= race.maxSeconds || (race.firstHumanFinish!==null && race.elapsed-race.firstHumanFinish>=race.finishGrace)) {
        race.phase = 'finished';
        race.endedAt = race.elapsed;
        for (const r of race.riders)
            if (r.finishedAt === null)
                r.dnf = true;
        event(race, 'race-end', { id: 'race' });
    }
}
export function standings(race) {
    return [...race.riders].sort((a, b) => {
        if (a.finishedAt !== null && b.finishedAt !== null)
            return a.finishedAt - b.finishedAt;
        if (a.finishedAt !== null)
            return -1;
        if (b.finishedAt !== null)
            return 1;
        if (a.dnf !== b.dnf)
            return a.dnf ? 1 : -1;
        return b.z - a.z || a.id.localeCompare(b.id);
    });
}
export function snapshot(race) {
    return { id: race.id || null, version: race.version, tick: race.tick, time: race.time, elapsed: race.elapsed, trackId: race.trackId, length: race.length, mode: race.mode,
        countdown: race.countdown, phase: race.phase, objects: race.objects, events: race.events,
        riders: standings(race).map((r, i) => ({ id: r.id, name: r.name, bot: r.bot, color: r.color, rank: i + 1, lane: r.lane, targetLane: r.targetLane, z: r.z, speed: r.speed,
            watts: r.watts, cadence: r.cadence, resistance: r.resistance, source: r.source, stale: r.stale, connected: r.connected,
            energy: r.energy, armor: r.armor, chain: r.chain, shield: r.shield, boost: r.boost, stun: r.stun, coast: r.coast, action: r.action, actionTimer: r.actionTimer, actionDuration: r.actionDuration, actionId: r.actionId, actionSide: r.actionSide, actionChain: r.actionChain,
            impactTimer: r.impactTimer, impactDuration: r.impactDuration, impactSide: r.impactSide, brake: r.brake,
            draft: r.draft, finishedAt: r.finishedAt, dnf: r.dnf, hits: r.hits, crashes: r.crashes, pickups: r.pickups,
            avgWatts: r.samples ? r.powerSum / r.samples : 0, kj: r.effort, consumed: r.consumed })) };
}
