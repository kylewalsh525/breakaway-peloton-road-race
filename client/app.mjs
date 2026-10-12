import { VERSION, PROTOCOL, clamp, ordinal } from '../shared/protocol.mjs';
import { TRACKS, getTrack } from '../shared/tracks.mjs';
import { createRace, addRider, fillBots, applyInput, stepRace, snapshot, COLORS } from '../shared/simulation.mjs';
import { awardRace, levelFor, ACHIEVEMENTS } from '../shared/profile.mjs';
import { interpolateRace } from './motion.mjs';
import { RoadRenderer } from './renderer.mjs';
import { ArcadeAudio } from './audio.mjs';
import { VoiceController } from './speech.mjs';
import { BikeController } from './bike.mjs';
import { RaceNetwork, SnapshotBuffer } from './network.mjs';
import { load, save, loadProfile, download, csvCell } from './storage.mjs';
import { $, escapeHtml as esc, timeLabel, toast, modal, closeModal } from './ui.mjs';
const defaults = { name: 'Rider', track: 'coast', mode: 'arcade', difficulty: 'normal', quality: 'auto', volume: .12, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches, wakeWord: false, threshold: .55, ftp: 200, showFps: false, jersey: COLORS[0], serverUrl: '' };
const settings = { ...defaults, ...load('settings', {}) };
if (!TRACKS.some(t => t.id === settings.track))
    settings.track = 'coast';
if (!COLORS.includes(settings.jersey)) settings.jersey = COLORS[0];
let profile = loadProfile(), accessCode = '', screen = 'home', mode = 'practice', room = null, race = null, playerId = 'local', raceId = '', latest = null, result = null, paused = false;
let previousRaceView = null;
let seq = 0, pending = [], inputBusy = false, lastTelemetrySent = 0, lastFrame = performance.now(), accumulator = 0, lastHud = 0, lastEvent = 0, lastCountdown = null, alertUntil = 0, savedResult = false;
let gamepadLast = [], network = null, paired = false, lastSource = 'demo', lastSensorMessage = 'Demo power — not a physical bike', lastSensorToast = '';
const renderer = new RoadRenderer($('world')), audio = new ArcadeAudio(), voice = new VoiceController(), bike = new BikeController(), buffer = new SnapshotBuffer();
renderer.setQuality(settings.quality);
renderer.reducedMotion = settings.reducedMotion;
audio.volume = settings.volume;
voice.configure(settings);
$('rider-name').value = settings.name;
const companion = location.pathname === '/companion';
function persist() { settings.name = $('rider-name').value.trim() || 'Rider'; save('settings', settings); }
function show(next) { screen = next; for (const id of ['home', 'lobby', 'hud', 'results', 'companion'])
    $(id).classList.toggle('hidden', id !== next); document.body.classList.toggle('racing', next === 'hud'); document.body.dataset.screen = next; $('home-shade').classList.toggle('hidden', next === 'hud'); if (next === 'hud')
    audio.startMusic();
else
    audio.stopMusic(); }
function renderTracks() {
    $('track-list').innerHTML = TRACKS.map((t, i) => `<button class="track ${t.id === settings.track ? 'selected' : ''}" data-track="${t.id}" style="--track-color:${t.accent}" aria-pressed="${t.id === settings.track}"><span class="track-number">0${i + 1}</span><span><strong>${t.name}</strong><small>${t.difficulty} / ${(t.length / 1000).toFixed(1)} km</small></span><span class="track-check">${t.id === settings.track ? '◀' : ''}</span></button>`).join('');
    const t = getTrack(settings.track);
    $('track-title').textContent = t.name.toUpperCase();
    $('track-distance').textContent = `${(t.length / 1000).toFixed(1)} KM · ${t.region}`;
    for (const el of $('track-list').querySelectorAll('button'))
        el.onclick = () => { settings.track = el.dataset.track; persist(); renderTracks(); };
}
function alertRace(text, seconds = 1.5) { $('race-alert').textContent = text; alertUntil = performance.now() + seconds * 1000; }
function flashAction(command) { for (const b of document.querySelectorAll(`[data-action="${command}"]`)) {
    b.classList.add('active');
    setTimeout(() => b.classList.remove('active'), 220);
} $('heard').textContent = `✓ ${command.toUpperCase()}`; audio.effect('command'); }
async function enableSound() { try {
    await audio.enable();
    $('sound-btn').style.color = audio.enabled ? '#ffc86a' : '';
}
catch { } }
function startPractice() {
    persist();
    mode = 'practice';
    room = null;
    network?.leave().catch(() => { });
    network?.stop();
    network = null;
    playerId = 'local';
    race = createRace({ trackId: settings.track, mode: settings.mode, difficulty: settings.difficulty, seed: 3241 + Date.now() % 10000 });
    addRider(race, playerId, settings.name, { ftp: settings.ftp, color: settings.jersey, lane: 2 });
    fillBots(race, 7);
    raceId = `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    seq = 0;
    pending = [];
    paused = false;
    lastEvent = 0;
    savedResult = false;
    lastCountdown = null;
    buffer.clear();
    latest = snapshot(race);
    previousRaceView = latest;
    accumulator = 0;
    show('hud');
    enableSound();
    $('demo-control').classList.toggle('hidden', bike.mode !== 'demo');
    $('network-status').textContent = 'LOCAL PRACTICE';
    if (bike.mode !== 'demo' && bike.read().stale)
        toast('No live power yet. The rider will wait for sensor data; demo power is never substituted.', 6000);
}
function baseUrl() {
    if (window.BreakawayBridge) {
        const native = window.BreakawayBridge.getServerUrl?.();
        return (native || settings.serverUrl || '').replace(/\/$/, '');
    }
    return settings.serverUrl?.replace(/\/$/, '') || '';
}
async function ensureNetwork() {
    if (window.BREAKAWAY_STANDALONE)
        throw new Error('For multiplayer, run npm start in the project folder and open http://localhost:8787. This double-click build is for solo play.');
    persist();
    const base = baseUrl();
    if (window.BreakawayBridge && !base) {
        openSettings();
        throw new Error('Set your HTTPS race-server address in Settings before multiplayer. Solo practice works offline.');
    }
    if (network && network.base !== base) {
        network.stop();
        network = null;
    }
    if (!network) {
        network = new RaceNetwork({ base, storageKey: companion ? 'breakaway.remote.session' : 'breakaway.session' });
        const connection = network;
        network.addEventListener('hello', e => { seq = Math.max(seq, companion ? e.detail.nextControlSeq || 0 : e.detail.nextInputSeq || 0); });
        network.addEventListener('room', e => { if (network === connection) onRoom(e.detail.room); });
        network.addEventListener('state', e => { if (network === connection) onState(e.detail.state); });
        network.addEventListener('connection', e => {
            const on = e.detail.connected;
            $('network-status').textContent = on ? 'LIVE MULTIPLAYER' : 'RECONNECTING · POWER WILL COAST';
            $('network-status').classList.toggle('warning', !on);
            if (!on && mode === 'online' && screen === 'hud') {
                pending = [];
                alertRace('CONNECTION LOST', 2);
            }
        });
        network.addEventListener('command', e => { flashAction(e.detail.command); if (mode === 'online' && e.detail.command === 'resume')
            closeModal(); });
        network.addEventListener('paired', e => {
            paired = true;
            if (e.detail.role === 'controller') $('pair-status').textContent = `Paired to ${e.detail.name}. Voice and controls are ready.`;
            else if (!e.detail.restored) toast('Phone controller paired. Keep it within microphone range.');
        });
        network.addEventListener('expired', e => {
            network?.stop(); network = null; paired = false; room = null; latest = null; pending = [];
            if (companion) $('pair-status').textContent = 'Session expired. Enter a fresh pairing code.';
            else { mode = 'practice'; show('home'); }
            toast(e.detail.message || 'Session expired. Join a room again.', 7000);
        });
        network.addEventListener('unpaired', () => { paired = false; $('pair-status').textContent = 'Controller unpaired. Enter a new pairing code.'; });
        network.addEventListener('shutdown', () => toast('The race server is restarting. Reconnection will be attempted.', 7000));
    }
    await network.connect(companion ? 'Phone controller' : settings.name, accessCode);
    if (!companion) {
        playerId = network.id;
        await network.request('/api/profile', { name: settings.name, ftp: settings.ftp, color: settings.jersey });
    }
    return network;
}
async function enterOnline(action, body) {
    try {
        const n = await ensureNetwork();
        mode = 'online';
        race = null;
        buffer.clear();
        seq = Math.max(seq, n.nextInputSeq || 0);
        pending = [];
        const reply = await n.request(`/api/rooms/${action}`, body);
        onRoom(reply.room);
        enableSound();
    }
    catch (e) {
        toast(e.message, 7000);
    }
}
function onRoom(newRoom) {
    if (companion)
        return;
    if (room?.code !== newRoom.code) {
        buffer.clear();
        lastEvent = 0;
        seq = Math.max(seq, network?.nextInputSeq || 0);
    }
    room = newRoom;
    mode = 'online';
    settings.track = room.trackId;
    playerId = network?.id || playerId;
    if (room.phase === 'lobby') {
        buffer.clear();
        latest = null;
        show('lobby');
    }
    if (screen === 'results') $('again-btn').disabled = room.hostId !== playerId;
    $('lobby-title').textContent = room.quick ? 'FINDING YOUR RIVALS' : 'ASSEMBLE YOUR CREW';
    $('lobby-course').textContent = `${getTrack(room.trackId).name} · ${room.mode === 'equalized' ? 'Baseline equalized (self-reported)' : 'Absolute power'} · Up to 8 riders`;
    $('copy-room').textContent = room.code;
    $('lobby-riders').innerHTML = room.riders.map(r => `<div class="lobby-row"><span class="avatar">${esc(r.name.slice(0, 1).toUpperCase())}</span><span>${esc(r.name)}${r.id === playerId ? ' (you)' : ''}${r.id === room.hostId ? ' · host' : ''}</span><span class="state">${r.spectator ? 'WATCHING' : r.ready ? 'READY' : 'GETTING SET'}</span></div>`).join('');
    const me = room.riders.find(r => r.id === playerId), host = room.hostId === playerId;
    $('ready-btn').textContent = me?.ready ? 'READY ✓' : 'I’M READY';
    $('ready-btn').disabled = !!me?.spectator;
    $('start-btn').disabled = !host || !room.riders.filter(r => !r.spectator).every(r => r.ready);
    $('start-btn').classList.toggle('hidden', room.quick);
    $('lobby-hint').textContent = room.quick ? `Race starts in ${Math.ceil(room.startsIn || 0)} seconds. Empty spots become AI rivals.` : host ? 'Everyone ready? Start the race. AI rivals fill the remaining places.' : 'Waiting for the host. Voice commands: “ready” and “start” (host only).';
}
function onState(state) {
    if (companion || mode !== 'online')
        return;
    if (state.id && raceId !== state.id) {
        buffer.clear();
        lastEvent = 0;
        savedResult = false;
        lastCountdown = null;
        raceId = state.id;
        pending = [];
        paused = false;
    }
    if (['countdown', 'racing'].includes(state.phase) && screen !== 'hud') {
        if (!raceId)
            raceId = `online-${room?.code}-${Date.now()}`;
        show('hud');
    }
    buffer.push(state);
    latest = state;
    if (state.phase === 'finished' && !savedResult)
        finish(state);
}
function takeActions(now) {
    // A delayed connection must not fire an old spoken attack after the rider has moved on.
    return pending.splice(0, 6).filter(item => now - item.at <= 450).map(item => item.action);
}
async function sendNetwork(force = false) {
    if (mode !== 'online' || !network || !room || inputBusy || screen !== 'hud' || room.riders.find(r => r.id === playerId)?.spectator)
        return;
    const now = performance.now();
    if (!force && !pending.length && now - lastTelemetrySent < 200)
        return;
    inputBusy = true;
    lastTelemetrySent = now;
    const actions = takeActions(now), telemetry = bike.read();
    try {
        await network.request('/api/input', { seq: seq++, actions, telemetry: { watts: telemetry.watts, cadence: telemetry.cadence, resistance: telemetry.resistance, source: telemetry.source, stale: telemetry.stale } }, 'POST', 2500);
    }
    catch { pending = []; /* Failed transport discards queued commands; never replay old attacks. */ }
    finally {
        inputBusy = false;
        if (pending.length) sendNetwork(true);
    }
}
async function command(action) {
    if (companion) {
        if (!paired) {
            toast('Pair to a rider first.');
            return;
        }
        try {
            await network.request('/api/control', { command: action, seq: seq++ });
            flashAction(action);
            $('pair-status').textContent = `Sent: ${action.toUpperCase()}`;
        }
        catch (e) {
            toast(e.message);
        }
        return;
    }
    if (action === 'ready') {
        if (room) {
            await doReady();
        }
        return;
    }
    if (action === 'start') {
        if (room) {
            await doStart();
        }
        else if (screen === 'home')
            startPractice();
        return;
    }
    if (screen !== 'hud' || (mode === 'online' && room?.riders.find(x => x.id === playerId)?.spectator))
        return;
    if (action === 'resume' && paused) {
        paused = false;
        closeModal();
    }
    if (paused && !['coast', 'resume'].includes(action)) return;
    pending.push({ action, at: performance.now() });
    if (pending.length > 6)
        pending.shift();
    flashAction(action);
    if (action === 'coast')
        alertRace('COASTING · SAY “RESUME”', 3);
    if (action === 'resume')
        alertRace('BACK ON IT', 1);
    sendNetwork(true);
}
function processEvents(state) {
    for (const event of state.events || []) {
        if (event.id <= lastEvent)
            continue;
        lastEvent = event.id;
        const mine = event.rider === playerId, target = event.target === playerId;
        if (mine || target || event.type === 'start')
            audio.effect(event.type);
        if (event.type === 'hit' && mine)
            alertRace(`${event.action === 'kick' ? 'KICK' : event.chain ? 'CHAIN' : 'HIT'} +${event.damage}`);
        if ((event.type === 'hit' && target) || (mine && ['crash', 'obstacle'].includes(event.type))) {
            renderer.impact(event.type === 'crash' ? 1.7 : 1);
            alertRace(event.type === 'crash' ? 'WIPEOUT!' : 'TAKE IT BACK');
        }
        if (mine && event.type === 'pickup')
            alertRace(event.kind === 'chain' ? 'CHAIN EQUIPPED' : event.kind === 'repair' ? 'ARMOR UP' : 'STAMINA REFILLED');
        if (mine && event.type === 'parry')
            alertRace('PERFECT BLOCK');
        if(mine && event.type==='finish') alertRace('FINISHED · WAITING FOR RIVALS',5);
        if (mine && event.type === 'boost')
            alertRace('BOOST!');
    }
}
function updateHud(state) {
    const r = state.riders.find(x => x.id === playerId) || state.riders[0];
    if (!r)
        return;
    const watching = mode === 'online' && room?.riders.find(x => x.id === playerId)?.spectator;
    $('action-bar').classList.toggle('hidden', !!watching);
    if (watching)
        $('network-status').textContent = 'SPECTATING · RACE LEADER';
    const sample = bike.read();
    $('hud-rider-name').textContent = r.name;
    $('distance-left').textContent = `${Math.max(0, (state.length - r.z) / 1000).toFixed(1)} KM TO GO`;
    $('speed-needle').style.transform = `rotate(${-120 + clamp(r.speed * 3.6 / 100, 0, 1) * 240}deg)`;
    $('power-needle').style.transform = `rotate(${-120 + clamp(r.watts / 500, 0, 1) * 240}deg)`;
    const rival = state.riders.filter(x => x.id !== r.id && !x.dnf).sort((a,b) => Math.abs(a.z-r.z)-Math.abs(b.z-r.z))[0];
    $('rival-name').textContent = rival ? `${rival.name}${rival.bot ? ' / AI' : ''}` : 'CLEAR ROAD';
    $('rival-gap').textContent = rival ? `${rival.z >= r.z ? '+' : '−'}${Math.round(Math.abs(rival.z-r.z))}M` : '—';
    $('rival-fill').style.width = `${rival?.armor || 0}%`;
    $('watts').textContent = Math.round(r.watts);
    $('cadence').textContent = Math.round(r.cadence);
    $('speed').textContent = Math.round(r.speed * 3.6);
    $('position').innerHTML = `${r.rank}<span>/${state.riders.length}</span>`;
    $('race-label').textContent = getTrack(state.trackId).name.toUpperCase();
    $('race-time').textContent = timeLabel(state.elapsed);
    $('progress-fill').style.width = `${clamp(r.z / state.length * 100, 0, 100)}%`;
    const coastAction = r.coast ? 'resume' : 'coast';
    if ($('coast-toggle').dataset.action !== coastAction) {
        $('coast-toggle').dataset.action = coastAction;
        $('coast-toggle').innerHTML = r.coast ? '<kbd>R</kbd> RESUME' : '<kbd>C</kbd> COAST';
    }
    $('energy-fill').style.width = `${r.energy}%`;
    $('armor-fill').style.width = `${r.armor}%`;
    $('equipment').textContent = r.chain > 0 ? `CHAIN · ${Math.ceil(r.chain)}s` : r.coast ? 'COASTING · SAY “RESUME”' : 'BARE KNUCKLES';
    $('sensor-status').textContent = r.stale ? 'SENSOR LOST · COASTING' : r.source === 'demo' ? 'DEMO POWER · SIMULATED' : r.source.toUpperCase();
    $('sensor-status').classList.toggle('error', r.stale);
    $('sensor-status').classList.toggle('warning', r.source === 'demo');
    $('fps').classList.toggle('hidden', !settings.showFps);
    $('fps').textContent = `${Math.round(renderer.fps)} FPS${network ? ` · ${Math.round(network.rtt)} ms` : ''}`;
    $('demo-control').classList.toggle('hidden', bike.mode !== 'demo' || !!watching);
    $('standings').innerHTML = state.riders.slice(0, 8).map(x => `<div class="standing ${x.id === playerId ? 'you' : ''}" style="border-color:${x.color}"><b>${x.rank}</b><span>${esc(x.name)}</span><span class="gap">${x.finishedAt !== null ? 'FIN' : x.id === playerId ? 'YOU' : x.bot ? `${Math.round(x.z - r.z)}m AI` : `${Math.round(x.z - r.z)}m`}</span></div>`).join('');
    const count = state.phase === 'countdown' ? Math.ceil(state.countdown) : state.elapsed < 1.1 ? 'GO!' : '';
    $('countdown').textContent = count;
    if (count !== lastCountdown) {
        lastCountdown = count;
        if (typeof count === 'number' && count > 0)
            audio.effect('tick');
    }
    $('draft-label').classList.toggle('hidden', !r.draft || r.coast);
    if (performance.now() > alertUntil)
        $('race-alert').textContent = '';
    if (r.stale && bike.mode !== 'demo' && lastSensorToast !== lastSensorMessage) {
        lastSensorToast = lastSensorMessage;
        toast(lastSensorMessage, 6000);
    }
}
function finish(state) {
    savedResult = true;
    latest = state;
    result = { schema: 1, gameVersion: VERSION, date: new Date().toISOString(), raceId, playerId, mode, verified: false, state };
    const r = state.riders.find(x => x.id === playerId);
    if (r) {
        profile = awardRace(profile, state, playerId, raceId);
        save('profile', profile);
        save('lastRide', result);
    }
    $('result-title').textContent = r ? (r.dnf ? 'NEXT ONE IS YOURS.' : r.rank === 1 ? 'OWN THE ROAD.' : `${ordinal(r.rank).toUpperCase()} · STRONG FINISH.`) : 'RACE COMPLETE.';
    $('result-summary').innerHTML = [['RACE TIME', timeLabel(r?.finishedAt)], ['AVG POWER', `${Math.round(r?.avgWatts || 0)} W`], ['HITS LANDED', String(r?.hits || 0)]].map(([label, value]) => `<div class="result-stat"><span>${label}</span><strong>${value}</strong></div>`).join('');
    $('results-list').innerHTML = state.riders.map(x => `<div class="result-row ${x.id === playerId ? 'you' : ''}"><span class="rank">${x.rank}</span><span>${esc(x.name)}${x.bot ? ' · AI' : ''}</span><span class="time">${timeLabel(x.finishedAt)}</span></div>`).join('');
    $('career-summary').textContent = r ? `LEVEL ${levelFor(profile.xp)} · ${profile.xp} XP · ${profile.totalKm.toFixed(1)} km in the garage${r.source === 'demo' ? ' · Demo ride (not physical exercise data)' : ''}` : 'Spectator view · Thanks for riding along.';
    $('again-btn').textContent = mode === 'online' ? 'BACK TO LOBBY' : 'RACE AGAIN ▶';
    $('again-btn').disabled = mode === 'online' && room?.hostId !== playerId;
    show('results');
    audio.effect('finish');
}
async function goHome() {
    closeModal(); paused = false; race = null; latest = null; pending = [];
    const previousNetwork = network, previousRoom = room;
    network = null; room = null; mode = 'practice';
    previousNetwork?.stop();
    show('home'); renderTracks();
    if (previousNetwork && previousRoom) await previousNetwork.leave().catch(() => {});
}
async function doReady() { if (!network || !room)
    return; try {
    const r = await network.request('/api/rooms/ready', { ready: true });
    onRoom(r.room);
}
catch (e) {
    toast(e.message);
} }
async function doStart() { if (!network || !room)
    return; try {
    await network.request('/api/rooms/start', {});
}
catch (e) {
    toast(e.message);
} }
function openHelp() {
    modal('KEEP YOUR HANDS ON THE BARS.', `
  <p>This is an original arcade cycling game. Your measured power drives the bike; short voice commands handle the action. No command changes physical resistance.</p>
  <div class="help-grid">${[['LEFT / RIGHT', 'Move one lane. Say “center” to return to the middle. Keyboard: ← / →.'], ['HIT / KICK', 'Attack a nearby rider. A chain pickup extends your reach. Space = hit, K = kick.'], ['BLOCK', 'A timed shield that parries attacks and absorbs one hazard. Keyboard: X.'], ['BOOST', 'Spend 28 stamina for a 2.6-second burst. Draft a rider to recharge faster. Keyboard: B.'], ['COAST / RESUME', 'Stop virtual propulsion without changing the bike. Say “resume” when ready. Keyboard: C / R.'], ['READY / START', 'Mark yourself ready in a lobby. Only the host can start a private race.']].map(([a, b]) => `<div class="help-item"><b>${a}</b><p>${b}</p></div>`).join('')}</div>
  <div class="notice">Use a comfortable riding effort. Keep both hands on the handlebars. “Coast” only affects the game; stop pedaling or use the bike’s normal controls to stop physically. Microphone audio is never stored by this game.</div>
  <p>Demo mode uses the power slider, not your Peloton. An installed Android adapter is required for Peloton sensors. Native offline voice needs the Vosk model included by the Android build script. Browser speech requires its provider and may send audio off-device.</p>
  <button id="help-voice" class="primary">SET UP VOICE →</button>`);
    $('help-voice').onclick = () => { closeModal(); openVoice(); };
}
function openVoice() {
    if (voice.active) {
        voice.stop();
        return;
    }
    const native = !!window.BreakawayBridge;
    modal('VOICE CONTROL', `<p>${native ? 'The Android app first uses the offline Vosk command recognizer. A microphone alone is not enough: a recognizer must also be available.' : 'Your browser supplies speech recognition. It may send audio to its speech provider; Breakaway does not receive or store that audio.'}</p>
    <div class="notice">Use short, separate commands: “left”, “right”, “hit”, “kick”, “block”, “boost”, “coast”. For a noisy room, enable the optional “rider” prefix.</div>
    <label class="checkbox"><input type="checkbox" id="voice-wake" ${settings.wakeWord ? 'checked' : ''}>Require “rider” before each command</label>
    <label class="checkbox" style="margin:14px 0"><input type="checkbox" id="voice-online" ${native ? '' : 'checked'}>I allow ${native ? 'the installed Android recognition provider' : 'my browser’s speech provider'} to process audio, potentially online, when needed.</label>
    <div class="row"><button id="start-voice" class="primary">ENABLE MICROPHONE</button><button id="voice-phone" class="secondary">USE PHONE</button></div><p class="muted">Microphone permission is requested only after you enable it. The mic turns off when you hide the app. Calibration checks commands; it does not train a voice model.</p>`);
    $('start-voice').onclick = async () => { settings.wakeWord = $('voice-wake').checked; persist(); voice.configure(settings); const allow = $('voice-online').checked; closeModal(); await enableSound(); await voice.start({ allowOnline: allow }); };
    $('voice-phone').onclick = () => { closeModal(); openPair(); };
}
function openSettings() {
    modal('RIDER SETUP', `<div class="settings-grid">
    <label>RACE BALANCE<select id="setting-mode"><option value="arcade">Absolute watts / arcade</option><option value="equalized">Watts relative to personal baseline</option></select></label>
    <label>BASELINE POWER (W)<input id="setting-ftp" type="number" min="75" max="500" value="${Number(settings.ftp)}"></label>
    <label>AI RIVALS<select id="setting-difficulty"><option value="easy">Easy cruising</option><option value="normal">Street competition</option><option value="hard">Hard charging</option></select></label>
    <label>RENDER QUALITY<select id="setting-quality"><option value="auto">Classic pixel detail</option><option value="low">Low power pixel detail</option><option value="high">High pixel detail</option></select></label>
    <label>YOUR JERSEY<select id="setting-jersey">${COLORS.map((c, i) => `<option value="${c}" ${i > 0 && levelFor(profile.xp) < i + 1 ? 'disabled' : ''}>${['Redline', 'Cobalt', 'Gold', 'Violet', 'Flame', 'Forest', 'Sky', 'Ivory'][i]}${i > 0 ? ` · Level ${i + 1}` : ''}</option>`).join('')}</select></label>
    <label>SOUND LEVEL<input id="setting-volume" type="range" min="0" max="0.35" step="0.01" value="${Number(settings.volume)}"></label>
    <label class="checkbox"><input id="setting-motion" type="checkbox" ${settings.reducedMotion ? 'checked' : ''}>Reduced camera effects</label><label class="checkbox"><input id="setting-fps" type="checkbox" ${settings.showFps ? 'checked' : ''}>Show FPS and network latency</label>
    <label class="wide">MULTIPLAYER SERVER (HTTPS)<input id="setting-server" type="url" placeholder="${nativeExample()}" value="${esc(baseUrl())}"></label>
    <label class="wide">SERVER INVITATION PASSPHRASE (OPTIONAL)<input id="setting-access" type="password" autocomplete="off" value="${esc(accessCode)}" placeholder="Only needed if your server uses ACCESS_CODE"></label>
  </div><p>Baseline power is self-reported, not a fitness test or a verified ranking. Race balance and difficulty apply to the next race.</p>
  <div class="row" style="margin-top:18px"><button id="save-settings" class="primary">SAVE SETTINGS</button><button id="settings-voice" class="secondary">VOICE SETUP</button></div>
  <div class="row" style="margin-top:10px"><button id="diagnostics-btn" class="text-btn">Device diagnostics</button><button id="career-btn" class="text-btn">Career & achievements</button><button id="settings-calibrate" class="text-btn">Check voice commands</button></div>
  <div class="row"><button id="settings-pair" class="text-btn">Pair phone</button><button id="settings-leaderboard" class="text-btn">Server times</button></div>
  <p class="muted">BREAKAWAY ${VERSION} · Protocol ${PROTOCOL} · Hardware compatibility is determined by live capabilities, not the bike’s model name.</p>`);
    for (const [key, id] of [['mode', 'setting-mode'], ['difficulty', 'setting-difficulty'], ['quality', 'setting-quality'], ['jersey', 'setting-jersey']])
        $(id).value = settings[key];
    $('save-settings').onclick = () => {
        const server = $('setting-server').value.trim();
        if (server) {
            let url;
            try {
                url = new URL(server);
            }
            catch {
                toast('Enter a complete HTTPS server address.');
                return;
            }
            if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) {
                toast('Use an HTTP(S) origin without embedded credentials.');
                return;
            }
            if (url.pathname !== '/' || url.search || url.hash) {
                toast('Use just the server origin, without a path or query.');
                return;
            }
            if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname) && !window.BreakawayBridge?.isDebug?.()) {
                toast('Use HTTPS for a remote server. The debug Android build can opt into local HTTP testing.');
                return;
            }
            settings.serverUrl = url.origin;
        }
        else
            settings.serverUrl = '';
        for (const [key, id] of [['mode', 'setting-mode'], ['difficulty', 'setting-difficulty'], ['quality', 'setting-quality'], ['jersey', 'setting-jersey']])
            settings[key] = $(id).value;
        settings.ftp = clamp(Number($('setting-ftp').value) || 200, 75, 500);
        settings.volume = Number($('setting-volume').value);
        settings.reducedMotion = $('setting-motion').checked;
        settings.showFps = $('setting-fps').checked;
        accessCode = $('setting-access').value;
        renderer.setQuality(settings.quality);
        renderer.reducedMotion = settings.reducedMotion;
        audio.volume = settings.volume;
        audio.update();
        window.BreakawayBridge?.setServerUrl?.(settings.serverUrl);
        persist();
        closeModal();
        toast('Settings saved.');
    };
    $('settings-voice').onclick = () => { closeModal(); openVoice(); };
    $('diagnostics-btn').onclick = openDiagnostics;
    $('career-btn').onclick = openCareer;
    $('settings-calibrate').onclick = openCalibration;
    $('settings-pair').onclick = () => { closeModal(); openPair(); };
    $('settings-leaderboard').onclick = openLeaderboard;
}
function nativeExample() { return window.BreakawayBridge ? 'https://race.example.com' : 'Leave blank to use this server'; }
function openDiagnostics() {
    const report = { schema: 1, gameVersion: VERSION, protocol: PROTOCOL, generatedAt: new Date().toISOString(), bike: bike.diagnostics(), voice: voice.capabilities(), voiceBackend: voice.backend, server: baseUrl() || 'same-origin', fps: Math.round(renderer.fps), screen: { width: innerWidth, height: innerHeight }, physicalCertification: false };
    modal('DEVICE CHECK.', `<div class="notice">A successful service bind is not proof of working sensors. Live power requires valid frames. Missing services, blocked installation, or an unavailable microphone are reported, never replaced with fake measurements.</div><pre class="status-box" id="diag-text"></pre><div class="row"><button id="diag-export" class="primary">EXPORT DIAGNOSTICS</button><button id="diag-retry" class="secondary">RETRY SENSORS</button></div><p>No serial number, authentication token, microphone recording, or transcript is included.</p>`);
    $('diag-text').textContent = JSON.stringify(report, null, 2);
    $('diag-export').onclick = () => download('breakaway-diagnostics.json', report);
    $('diag-retry').onclick = () => { bike.select(bike.mode); closeModal(); };
}
function openCareer() {
    const html = profile.achievements.length ? profile.achievements.map(a => `<div class="help-item"><b>◆ ${esc(ACHIEVEMENTS[a] || a)}</b></div>`).join('') : '<p>Your first finish unlocks your first badge.</p>';
    modal('YOUR ROAD STORY.', `<div class="result-summary">${[['LEVEL', levelFor(profile.xp)], ['RIDES', profile.races], ['DISTANCE', profile.totalKm.toFixed(1) + ' KM']].map(([k, v]) => `<div class="result-stat"><span>${k}</span><strong>${v}</strong></div>`).join('')}</div><div class="help-grid">${html}</div><p>Career progression and cosmetics are stored in this browser. Demo rides are labeled separately from actual bike data and never enter server times.</p><button id="career-export" class="secondary">EXPORT LOCAL CAREER</button>`);
    $('career-export').onclick = () => download('breakaway-career.json', profile);
}
async function openLeaderboard() {
    try {
        const n = await ensureNetwork(), r = await n.request(`/api/leaderboard?track=${settings.track}&mode=${settings.mode}`, undefined, 'GET');
        modal('SERVER TIMES.', `<p>${esc(getTrack(settings.track).name)} · Non-demo entries. These times are <b>unverified</b>: a client can misreport watts. This is a friends-and-family leaderboard, not certified competition.</p>${r.results.length ? r.results.map((x, i) => `<div class="result-row"><span class="rank">${i + 1}</span><span>${esc(x.name)}</span><span class="time">${timeLabel(x.seconds)}</span></div>`).join('') : '<p>No non-demo finishes on this server yet.</p>'}`);
    }
    catch (e) {
        toast(e.message);
    }
}
function openCalibration() {
    if (!voice.active) {
        closeModal();
        openVoice();
        toast('Enable voice, then choose “Check voice commands” in Settings.');
        return;
    }
    if (screen === 'hud') {
        toast('Check voice commands in the garage or lobby, not during a race.');
        return;
    }
    modal('EIGHT COMMANDS. ONE CHECK.', `<p>Speak each command once at your normal riding volume. Keep fans and room noise as they will be during a ride. This check measures recognition; it does not promise a latency or accuracy level.</p><div id="calibration-word" class="calibration-word">LEFT</div><div id="calibration-progress" class="calibration-progress">0 / 8</div><pre id="calibration-results" class="status-box hidden"></pre>`, () => { voice.calibration = null; });
    voice.beginCalibration();
}
voice.addEventListener('calibration', e => {
    const c = e.detail;
    if (!$('calibration-word'))
        return;
    $('calibration-progress').textContent = `${c.results.filter(r => r.match).length} correct / ${c.results.length} attempts`;
    if (c.done) {
        $('calibration-word').textContent = 'CHECK COMPLETE';
        $('calibration-results').classList.remove('hidden');
        $('calibration-results').textContent = c.results.map(r => `${r.match ? '✓' : '×'} ${r.expected}: ${r.recognized || 'not recognized'} (${Math.round(r.confidence * 100)}%)`).join('\n');
    }
    else
        $('calibration-word').textContent = c.words[c.index].toUpperCase();
});
async function openPair() {
    if (companion) {
        toast('Enter the pairing code shown on your game screen.');
        return;
    }
    if (!room) {
        toast('Phone control needs a server room. Create a private room first; AI fills empty rider slots.', 6000);
        return;
    }
    try {
        const n = await ensureNetwork(), p = await n.request('/api/pair/create', {});
        modal('PAIR YOUR POCKET PIT CREW.', `<p>Open this server’s <b>/companion</b> page on your phone, then enter the one-time code below. Both devices must reach the same server.</p><div class="calibration-word">${p.code.slice(0, 4)} ${p.code.slice(4)}</div><p>Expires in two minutes. Pairing authorizes game controls for your rider, not your power sensor. Revoke it anytime.</p><div class="status-box" id="companion-address"></div><div class="row" style="margin-top:15px"><button id="pair-copy" class="primary">COPY PHONE ADDRESS</button><button id="pair-revoke" class="secondary">REVOKE CONTROLLER</button></div><p>Phone browser speech requires HTTPS. Its speech provider may process audio online after consent. An empty room still becomes a full race with AI riders.</p>`);
        const url = (n.base || location.origin) + '/companion';
        $('companion-address').textContent = url;
        $('pair-copy').onclick = () => copy(url);
        $('pair-revoke').onclick = async () => { try {
            await n.request('/api/pair/revoke', {});
            paired = false;
            closeModal();
            toast('Controller authorization revoked.');
        }
        catch (e) {
            toast(e.message);
        } };
    }
    catch (e) {
        toast(e.message);
    }
}
async function copy(text) { try {
    await navigator.clipboard.writeText(text);
    toast('Copied.');
}
catch {
    toast(`Copy this: ${text}`, 10000);
} }
function openPause() {
    if (screen !== 'hud')
        return;
    if (mode === 'practice')
        paused = true;
    else
        command('coast');
    modal(mode === 'practice' ? 'TAKE A BREATHER.' : 'COASTING — RACE CONTINUES.', `<p>${mode === 'practice' ? 'Your solo race is paused.' : 'Other riders keep racing. Your virtual bike is coasting; physical resistance is unchanged.'}</p><div class="row"><button id="resume-btn" class="primary">RESUME RIDE</button><button id="quit-btn" class="secondary">LEAVE RACE</button></div>`, () => { if (mode === 'practice')
        paused = false; });
    $('resume-btn').onclick = () => { closeModal(); paused = false; command('resume'); };
    $('quit-btn').onclick = goHome;
}
function requestHome() { if (screen === 'hud') {
    openPause();
    return;
} goHome(); }
$('practice-btn').onclick = startPractice;
$('quick-btn').onclick = () => enterOnline('quick', { trackId: settings.track, mode: settings.mode, difficulty: settings.difficulty });
$('create-btn').onclick = () => enterOnline('create', { trackId: settings.track, mode: settings.mode, difficulty: settings.difficulty });
$('join-form').onsubmit = e => { e.preventDefault(); enterOnline('join', { code: $('room-code').value.trim().toUpperCase() }); };
$('watch-btn').onclick = () => enterOnline('join', { code: $('room-code').value.trim().toUpperCase(), spectator: true });
$('voice-lobby').onclick = openVoice;
$('voice-home').onclick = openVoice;
$('ready-btn').onclick = doReady;
$('start-btn').onclick = doStart;
$('copy-room').onclick = () => copy(room?.code || '');
$('leave-lobby').onclick = goHome;
$('pair-lobby').onclick = openPair;
$('settings-btn').onclick = openSettings;
$('help-btn').onclick = openHelp;
$('brand-home').onclick = requestHome;
$('pause-btn').onclick = openPause;
$('voice-btn').onclick = openVoice;
$('companion-voice').onclick = openVoice;
$('result-home').onclick = goHome;
$('again-btn').onclick = async () => { if (mode === 'online') {
    try {
        const r = await network.request('/api/rooms/rematch', {});
        onRoom(r.room);
    }
    catch (e) {
        toast(e.message);
    }
}
else
    startPractice(); };
$('export-result').onclick = () => { if (result)
    download('breakaway-ride.json', result); };
$('export-csv').onclick = () => { if (result) {
    const keys = ['name', 'rank', 'source', 'finishedAt', 'avgWatts', 'hits', 'crashes', 'kj'];
    const rows = [keys.join(','), ...result.state.riders.map(r => keys.map(k => csvCell(r[k])).join(','))];
    download('breakaway-ride.csv', rows.join('\r\n'), 'text/csv');
} };
$('sound-btn').onclick = async () => { if (!audio.ctx)
    await enableSound();
else
    audio.setEnabled(!audio.enabled); $('sound-btn').style.color = audio.enabled ? '#ffc86a' : ''; };
$('fullscreen-btn').onclick = async () => { try {
    if (document.fullscreenElement)
        await document.exitFullscreen();
    else
        await document.documentElement.requestFullscreen();
}
catch {
    toast('Fullscreen is not available in this browser.');
} };
$('power-source').onchange = async () => { const source = $('power-source').value; await bike.select(source); lastSource = source; };
$('demo-watts').oninput = () => { bike.setDemo(Number($('demo-watts').value)); $('demo-value').textContent = `${bike.demoWatts} W`; };
$('rider-name').onchange = persist;
for (const btn of document.querySelectorAll('[data-action]'))
    btn.onclick = () => command(btn.dataset.action);
bike.addEventListener('status', e => { const s = e.detail; lastSensorMessage = s.message || s.state; $('source-hint').textContent = lastSensorMessage; });
voice.addEventListener('command', e => command(e.detail.command));
voice.addEventListener('transcript', e => { $('heard').textContent = e.detail.text || 'Listening…'; });
voice.addEventListener('status', e => {
    const s = e.detail, listening = s.state === 'listening';
    $('mic-led').classList.toggle('live', listening);
    $('mic-led').classList.toggle('error', ['unavailable', 'denied'].includes(s.state));
    $('voice-label').textContent = listening ? 'VOICE ON · TAP TO MUTE' : s.state === 'starting' || s.state === 'retrying' ? 'CONNECTING VOICE' : 'ENABLE VOICE';
    $('voice-home').classList.toggle('live', listening);
    $('voice-home-label').textContent = listening ? 'VOICE ON · SAY “START”' : s.state === 'starting' || s.state === 'retrying' ? 'CONNECTING MICROPHONE' : 'ENABLE VOICE CONTROL';
    $('voice-lobby').textContent = listening ? 'VOICE ON · TAP TO MUTE' : 'ENABLE VOICE';
    $('companion-voice').textContent = listening ? 'MICROPHONE ON · TAP TO MUTE' : 'ENABLE MICROPHONE';
    audio.setDucked(voice.active);
    if (s.message)
        $('heard').textContent = s.message;
    if (['unavailable', 'denied'].includes(s.state))
        toast(s.message, 8000);
});
const KEYMAP = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ' ': 'hit', k: 'kick', x: 'block', b: 'boost', s: 'brake', c: 'coast', r: 'resume' };
document.addEventListener('keydown', e => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) || !$('modal').classList.contains('hidden'))
        return;
    if (e.code === 'Escape' && screen === 'hud') {
        e.preventDefault();
        openPause();
        return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && screen === 'hud' && bike.mode === 'demo') {
        e.preventDefault();
        bike.setDemo(bike.demoWatts + (e.key === 'ArrowUp' ? 10 : -10));
        $('demo-watts').value = bike.demoWatts;
        $('demo-value').textContent = `${bike.demoWatts} W`;
        return;
    }
    if (screen === 'home' && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const index = TRACKS.findIndex(t => t.id === settings.track);
        settings.track = TRACKS[(index + (e.key === 'ArrowUp' ? -1 : 1) + TRACKS.length) % TRACKS.length].id;
        persist(); renderTracks(); return;
    }
    if (screen === 'home' && e.key === 'Enter' && document.activeElement === document.body) {
        e.preventDefault(); startPractice(); return;
    }
    const action = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase()];
    if (action && (screen === 'hud' || companion)) {
        e.preventDefault();
        if (!e.repeat)
            command(action);
    }
});
function pollGamepad() { const pad = navigator.getGamepads?.()[0]; if (!pad)
    return; const states = [pad.buttons[14]?.pressed || pad.axes[0] < -.55, pad.buttons[15]?.pressed || pad.axes[0] > .55, pad.buttons[2]?.pressed, pad.buttons[1]?.pressed, pad.buttons[0]?.pressed, pad.buttons[3]?.pressed]; const map = ['left', 'right', 'hit', 'block', 'boost', 'kick']; states.forEach((v, i) => { if (v && !gamepadLast[i])
    command(map[i]); }); gamepadLast = states; }
$('controller-grid').innerHTML = ['left', 'right', 'hit', 'kick', 'block', 'boost', 'coast', 'resume', 'ready', 'start'].map(command => `<button class="secondary" data-command="${command}">${command.toUpperCase()}</button>`).join('');
for (const b of $('controller-grid').querySelectorAll('button'))
    b.onclick = () => command(b.dataset.command);
$('pair-form').onsubmit = async (e) => { e.preventDefault(); try {
    const n = await ensureNetwork(), r = await n.request('/api/pair/claim', { code: $('pair-code').value });
    paired = true;
    $('pair-status').textContent = `Paired to ${r.name}. Ready when you are.`;
}
catch (error) {
    toast(error.message);
} };
$('companion-home').onclick = () => { location.href = '/'; };
setInterval(() => { if (companion && network?.running)
    network.request('/api/ping', {}).catch(() => { }); }, 12000);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        voice.stop();
        if (screen === 'hud') {
            if (mode === 'practice') {
                paused = true;
                toast('Ride paused while the app was hidden. Press Resume to continue.');
            }
            else
                command('coast');
        }
        audio.setDucked(true);
    }
    else {
        lastFrame = performance.now();
        accumulator = 0;
        audio.setDucked(voice.active);
        if (paused && screen === 'hud')
            openPause();
    }
});
let preview = { trackId: settings.track, length: 999999, objects: [], riders: [] };
function frame(now) {
    const dt = Math.min(.15, (now - lastFrame) / 1000);
    lastFrame = now;
    accumulator += dt;
    if (screen === 'hud') {
        pollGamepad();
        if (mode === 'practice' && race && !paused) {
            let steps = 0;
            while (accumulator >= 1 / 30 && steps++ < 6) {
                const t = bike.read();
                applyInput(race, playerId, { seq: seq++, actions: takeActions(now), telemetry: { watts: t.watts, cadence: t.cadence, resistance: t.resistance, source: t.source, stale: t.stale } }, now);
                previousRaceView = latest;
                stepRace(race, now);
                latest = snapshot(race);
                accumulator -= 1 / 30;
            }
            if (race.phase === 'finished' && !savedResult)
                finish(latest);
        }
        else {
            accumulator = 0;
            if (mode === 'online')
                sendNetwork();
        }
        const view = mode === 'online' ? buffer.sample(now) : paused ? latest : interpolateRace(previousRaceView, latest, accumulator * 30);
        if (view) {
            processEvents(latest || view);
            renderer.render(view, playerId, now / 1000);
            if (now - lastHud > 90) {
                lastHud = now;
                updateHud(latest || view);
            }
        }
    }
    else {
        accumulator = 0;
        if (screen === 'results' && result) {
            renderer.render(result.state, playerId, now / 1000);
        }
        else {
            const z = now / 1000 * 11;
            preview = { ...preview, trackId: settings.track, riders: [{ id: 'preview', z, lane: 2, targetLane: 2, speed: 11, cadence: 80, color: COLORS[0] }, ...['Moxie', 'Ghost', 'Juno'].map((name, i) => ({ id: name, name, z: z + 20 + i * 25 + Math.sin(now / 6000 + i) * 6, lane: 1 + i, targetLane: 1 + i, speed: 11, cadence: 80, color: COLORS[i + 1] }))] };
            renderer.render(preview, 'preview', now / 1000, true);
        }
    }
    requestAnimationFrame(frame);
}
window.breakawayStarted = true;
$('boot').classList.add('hidden');
renderTracks();
show(companion ? 'companion' : 'home');
if (companion) ensureNetwork().catch(e => { $('pair-status').textContent = e.message; });
requestAnimationFrame(frame);
// Read-only diagnostics hook: it never accepts game state or authorizes server actions.
window.breakawayDiagnostics = () => { const r = latest?.riders.find(x => x.id === playerId); return { version: VERSION, screen, mode, room: room?.code, phase: latest?.phase, playerId, telemetry: bike.read(), fps: renderer.fps, tick: latest?.tick, voice: { active: voice.active, backend: voice.backend }, rider: r ? { lane: r.lane, targetLane: r.targetLane, energy: r.energy, coast: r.coast, watts: r.watts, stale: r.stale, action: r.action, actionTimer: r.actionTimer, actionDuration: r.actionDuration, actionId: r.actionId, actionSide: r.actionSide, actionChain: r.actionChain, chain: r.chain, shield: r.shield, boost: r.boost, brake: r.brake, stun: r.stun, hits: r.hits } : null }; };
if (window.BreakawayBridge) {
    $('power-source').value = 'peloton';
    bike.select('peloton');
    window.BreakawayBridge.reportCapabilities?.();
}
else
    bike.select('demo');
if ('serviceWorker' in navigator && !window.BreakawayBridge && window.isSecureContext)
    navigator.serviceWorker.register('/sw.js').catch(() => { });
window.addEventListener('error', e => { console.error('BREAKAWAY:', e.message); toast('An application error occurred. Open device diagnostics and check the browser console.', 6000); });
