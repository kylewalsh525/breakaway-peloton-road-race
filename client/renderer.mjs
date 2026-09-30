import { getTrack, curveAt, hillAt } from '../shared/tracks.mjs';
import { clamp, rng } from '../shared/protocol.mjs';
/** Original procedural 2.5D renderer. No extracted game art, remote assets, or GPU requirement. */
export class RoadRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.quality = 'auto';
        this.reducedMotion = false;
        this.w = 1280;
        this.h = 720;
        this.cameraZ = 0;
        this.cameraLane = 2;
        this.last = 0;
        this.fps = 60;
        this.shake = 0;
        this.flash = 0;
        this.trackId = 'coast';
        this.random = rng(9107);
        this.stars = Array.from({ length: 90 }, () => ({ x: this.random(), y: this.random() * .42, s: this.random() * 1.7 + .3 }));
        this.scenery = Array.from({ length: 320 }, (_, i) => ({ z: i * 27 + this.random() * 15, side: i % 2 ? 1 : -1, type: this.random(), offset: 9 + this.random() * 14 }));
        this.resize();
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(canvas);
    }
    resize() {
        const ratio = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight), base = this.quality === 'low' ? 640 : this.quality === 'high' ? 1440 : 1080;
        this.canvas.width = base;
        this.canvas.height = Math.round(base / ratio);
        this.w = this.canvas.width;
        this.h = this.canvas.height;
    }
    setQuality(q) { this.quality = q; this.resize(); }
    impact(strength = 1) { if (!this.reducedMotion)
        this.shake = Math.max(this.shake, strength); this.flash = .2; }
    poly(points, fill) { const c = this.ctx; c.fillStyle = fill; c.beginPath(); c.moveTo(points[0][0], points[0][1]); for (let i = 1; i < points.length; i++)
        c.lineTo(...points[i]); c.closePath(); c.fill(); }
    line(points, color, width = 2) { const c = this.ctx; c.strokeStyle = color; c.lineWidth = width; c.lineJoin = 'round'; c.lineCap = 'round'; c.beginPath(); c.moveTo(...points[0]); for (let i = 1; i < points.length; i++)
        c.lineTo(...points[i]); c.stroke(); }
    background(track, now) {
        const c = this.ctx, w = this.w, h = this.h, hor = h * .45;
        const sky = c.createLinearGradient(0, 0, 0, hor * 1.3);
        sky.addColorStop(0, track.sky[0]);
        sky.addColorStop(.68, track.sky[1]);
        sky.addColorStop(1, track.sky[2]);
        c.fillStyle = sky;
        c.fillRect(0, 0, w, h);
        const bend = curveAt(track, this.cameraZ), shift = bend * w * .06;
        if (track.night) {
            c.fillStyle = '#deddf9';
            for (const star of this.stars) {
                c.globalAlpha = .3 + star.s / 3;
                c.fillRect(star.x * w + shift * .2, star.y * h, star.s, star.s);
            }
            c.globalAlpha = 1;
        }
        c.save();
        const sunX = w * .71 + shift, sunY = h * (track.night ? .22 : .29), sunR = h * (track.night ? .045 : .11);
        c.shadowColor = track.accent;
        c.shadowBlur = sunR * .7;
        c.fillStyle = track.night ? '#e1dbfc' : '#ffdb9c';
        c.beginPath();
        c.arc(sunX, sunY, sunR, 0, Math.PI * 2);
        c.fill();
        c.shadowBlur = 0;
        if (!track.night) {
            c.beginPath();
            c.arc(sunX, sunY, sunR, 0, Math.PI * 2);
            c.clip();
            c.fillStyle = track.sky[1];
            for (let j = 0; j < 7; j++)
                c.fillRect(sunX - sunR, sunY + sunR * .08 + j * sunR * .13, sunR * 2, 2 + j * .45);
        }
        c.restore();
        for (let layer = 0; layer < 3; layer++) {
            const pts = [[0, hor + 50]], base = hor + layer * h * .028;
            for (let x = -40; x <= w + 50; x += 25) {
                const a = x / w * 9 + track.seed + layer * 8;
                const peak = (Math.sin(a * 1.2) + Math.sin(a * 2.35) * .6 + Math.cos(a * 4.9) * .15) * h * (.029 + layer * .012);
                pts.push([x, base - Math.abs(peak) - h * .055 + shift * .12]);
            }
            pts.push([w, hor + 70]);
            this.poly(pts, track.night ? ['#3e365f', '#342f51', '#282d46'][layer] : track.scenery === 'pine' ? ['#7e9fa6', '#6c8893', '#4f707d'][layer] : ['#aa818b', '#906e82', '#6b5c76'][layer]);
        }
        if (track.scenery === 'city') {
            for (let i = 0; i < 34; i++) {
                const bw = w / 28, bh = (.03 + Math.abs(Math.sin(i * 2.7)) * .16) * h, x = i * bw - w * .12 + shift;
                const y = hor - bh;
                c.fillStyle = i % 2 ? '#232d49' : '#29314f';
                c.fillRect(x, y, bw * .85, bh + 30);
                c.fillStyle = i % 2 ? '#93dcd4' : '#d19ac6';
                for (let row = 0; row < bh / 12; row++)
                    for (let col = 0; col < 3; col++)
                        if ((row * 7 + col + i) % 3)
                            c.fillRect(x + 6 + col * bw * .2, y + 8 + row * 12, 2, 3);
            }
        }
        if (track.id === 'coast') {
            const sea = c.createLinearGradient(0, hor - 7, 0, h * .8);
            sea.addColorStop(0, '#7a92a8');
            sea.addColorStop(1, '#345771');
            c.fillStyle = sea;
            c.fillRect(0, hor - 1, w, h * .55);
            c.strokeStyle = '#edc1aa';
            c.globalAlpha = .24;
            for (let i = 0; i < 18; i++) {
                const yy = hor + i * i * 1.15;
                c.beginPath();
                c.moveTo(w * .04 + Math.sin(now * .15 + i) * 15, yy);
                c.lineTo(w * .34 - i * 6, yy);
                c.stroke();
            }
            c.globalAlpha = 1;
        }
        else {
            c.fillStyle = track.ground[0];
            c.fillRect(0, hor, w, h - hor);
        }
    }
    project(track, worldZ, lane = 2, extraX = 0) {
        const dz = worldZ - this.cameraZ;
        if (dz <= 1)
            return null;
        const curve = curveAt(track, this.cameraZ + dz * .45), x = curve * dz * dz / 1350 + (lane - this.cameraLane) * 2.64 + extraX;
        const ground = (hillAt(track, worldZ) - hillAt(track, this.cameraZ)) * .095;
        const scale = 1.02 / dz;
        return { x: this.w * .5 + scale * x * this.w * .5, y: this.h * .46 - scale * (ground - 2.7) * this.h * .62, scale, half: scale * 6.6 * this.w * .5, z: dz };
    }
    road(track) {
        const c = this.ctx, w = this.w, h = this.h, segments = [], far = this.quality === 'low' ? 450 : 700, step = 6;
        for (let z = 3; z < far; z += step) {
            const absolute = Math.floor((this.cameraZ + z) / step) * step;
            const p = this.project(track, absolute), q = this.project(track, absolute + step);
            if (!p || !q)
                continue;
            segments.push({ p, q, index: Math.floor(absolute / step), z: absolute });
        }
        if (segments.length) {
            const near = this.project(track, this.cameraZ + 1.01);
            segments.unshift({ p: near, q: segments[0].p, index: Math.floor((this.cameraZ + 1.01) / step), z: this.cameraZ + 1.01 });
        }
        // Far to near painter order lets nearby hills occlude the road behind them naturally.
        for (let i = segments.length - 1; i >= 0; i--) {
            const { p, q, index, z } = segments[i];
            if (q.y > h + 200 || p.y < 0)
                continue;
            const alt = Math.floor(index / 3) % 2;
            if (track.id !== 'coast') {
                this.poly([[0, q.y], [w, q.y], [w, p.y + 1], [0, p.y + 1]], track.ground[alt]);
            }
            else
                this.poly([[q.x - q.half * 1.45, q.y], [w, q.y], [w, p.y + 1], [p.x - p.half * 1.45, p.y + 1]], track.ground[alt]);
            this.poly([[q.x - q.half * 1.12, q.y], [q.x + q.half * 1.12, q.y], [p.x + p.half * 1.12, p.y], [p.x - p.half * 1.12, p.y]], track.verge);
            this.poly([[q.x - q.half * 1.055, q.y], [q.x + q.half * 1.055, q.y], [p.x + p.half * 1.055, p.y], [p.x - p.half * 1.055, p.y]], alt ? '#eee1cb' : '#b85b67');
            this.poly([[q.x - q.half, q.y], [q.x + q.half, q.y], [p.x + p.half, p.y], [p.x - p.half, p.y]], track.road[alt]);
            if (alt)
                for (let lane = 1; lane < 5; lane++) {
                    const f = -1 + lane * .4, thin = .007;
                    this.poly([[q.x + q.half * (f - thin), q.y], [q.x + q.half * (f + thin), q.y], [p.x + p.half * (f + thin), p.y], [p.x + p.half * (f - thin), p.y]], track.night ? '#798091' : '#c7c8c0');
                }
            if (track.night && index % 8 < 4) {
                for (const f of [-.985, .985])
                    this.line([[q.x + q.half * f, q.y], [p.x + p.half * f, p.y]], track.accent, Math.max(.4, p.scale * 14));
            }
            if (z < 40 && z > 0) {
                c.globalAlpha = .025;
                this.line([[q.x, q.y], [p.x, p.y]], '#ffffff', p.half * 2);
                c.globalAlpha = 1;
            }
        }
    }
    palm(x, y, size, flip = 1) {
        const c = this.ctx;
        c.save();
        c.translate(x, y);
        c.scale(size * flip, size);
        this.poly([[-.045, 0], [.035, 0], [.08, -.83], [.025, -.83]], '#594557');
        this.line([[.005, 0], [.045, -.76]], '#b78b78', .015);
        const fronds = [[-.02, -.79, -.34, -1.04, -.62, -.89], [-.02, -.81, -.2, -1.13, -.39, -1.15], [.02, -.81, .17, -1.12, .37, -1.04], [.05, -.82, .37, -1.05, .66, -.88], [.04, -.82, .41, -.83, .51, -.57], [-.01, -.81, -.29, -.89, -.51, -.58]];
        for (let i = 0; i < fronds.length; i++) {
            const f = fronds[i];
            this.poly([[f[0], f[1]], [f[2], f[3]], [f[4], f[5]], [f[2] * .92, f[3] + .09]], i % 2 ? '#35535b' : '#294552');
        }
        c.restore();
    }
    tree(x, y, s, type) {
        const c = this.ctx;
        if (type === 'palm') {
            this.palm(x, y, s);
            return;
        }
        c.save();
        c.translate(x, y);
        c.scale(s, s);
        if (type === 'pine') {
            c.fillStyle = '#514d4b';
            c.fillRect(-.035, -.8, .07, .8);
            for (let i = 0; i < 4; i++)
                this.poly([[-(.18 + i * .05), -.32 + i * .085], [0, -1.15 + i * .18], [.18 + i * .05, -.32 + i * .085]], i % 2 ? '#294f4c' : '#35665a');
        }
        else if (type === 'cactus') {
            c.strokeStyle = '#3c5c53';
            c.lineWidth = .13;
            c.lineCap = 'round';
            c.beginPath();
            c.moveTo(0, 0);
            c.lineTo(0, -.9);
            c.moveTo(0, -.45);
            c.lineTo(-.22, -.45);
            c.lineTo(-.22, -.72);
            c.moveTo(0, -.3);
            c.lineTo(.23, -.3);
            c.lineTo(.23, -.64);
            c.stroke();
            this.line([[-.015, -.1], [-.015, -.85]], '#90a276', .022);
        }
        else {
            c.fillStyle = '#242b43';
            c.fillRect(-.028, -1.3, .055, 1.3);
            this.line([[0, -1.3], [.2, -1.42], [.38, -1.42]], '#626b84', .035);
            c.fillStyle = '#b0f9e8';
            c.fillRect(.28, -1.44, .18, .04);
        }
        c.restore();
    }
    rider(x, y, size, r, now, player = false) {
        const c = this.ctx;
        c.save();
        c.translate(x, y);
        const lean = clamp((r.targetLane - r.lane) * .14, -.18, .18) + (player ? curveAt(getTrack(this.trackId), this.cameraZ) * -.025 : 0);
        c.rotate(lean);
        c.scale(size, size);
        if (r.stun > 0 && !this.reducedMotion)
            c.rotate(Math.sin(now * 35) * .03);
        c.globalAlpha = r.coast ? .6 : 1;
        c.fillStyle = 'rgba(9,13,28,.42)';
        c.beginPath();
        c.ellipse(0, .015, .38, .095, 0, 0, Math.PI * 2);
        c.fill();
        if (r.boost > 0) {
            const g = c.createLinearGradient(0, -.5, 0, .2);
            g.addColorStop(0, 'rgba(113,243,224,0)');
            g.addColorStop(1, 'rgba(113,243,224,.8)');
            this.poly([[-.17, -.5], [.17, -.5], [.3, .27], [-.3, .27]], g);
        }
        // Thin wheels, metal fork and a diamond bicycle frame, viewed from behind.
        c.fillStyle = '#151b2b';
        c.fillRect(-.055, -.65, .11, .62);
        c.fillStyle = '#637a8c';
        c.fillRect(-.026, -.61, .016, .59);
        this.line([[0, -.04], [0, -.43], [-.18, -.48], [0, -.2], [.18, -.48], [0, -.43]], '#a7cdd6', .033);
        this.line([[-.18, -.48], [.18, -.48]], '#1e2636', .055);
        this.line([[-.27, -.7], [-.18, -.72], [.18, -.72], [.27, -.7]], '#b5c3cd', .026);
        const pedal = Math.sin(now * Math.max(2, r.cadence / 60 * 6.283)) * .085;
        this.line([[-.115, -.53], [-.17, -.31 - pedal], [-.08, -.22 - pedal]], '#272b41', .105);
        this.line([[.115, -.53], [.17, -.31 + pedal], [.08, -.22 + pedal]], '#20263a', .105);
        this.line([[-.09, -.22 - pedal], [-.015, -.22 - pedal]], '#e4dbcf', .057);
        this.line([[.09, -.22 + pedal], [.015, -.22 + pedal]], '#e4dbcf', .057);
        this.poly([[-.155, -.6], [-.125, -.44], [0, -.46], [.125, -.44], [.155, -.6]], '#25273c');
        this.poly([[-.19, -.87], [.19, -.87], [.155, -.56], [-.155, -.56]], r.color || '#ffc86a');
        this.poly([[-.19, -.87], [-.09, -.91], [-.05, -.57], [-.155, -.56]], 'rgba(255,255,255,.23)');
        this.poly([[.09, -.89], [.19, -.87], [.155, -.56], [.08, -.58]], 'rgba(25,25,46,.27)');
        this.poly([[.03, -.83], [-.07, -.72], [-.012, -.72], [-.035, -.64], [.075, -.77], [.015, -.77]], '#233347');
        const attack = r.action === 'hit' || r.action === 'kick';
        this.line([[-.18, -.84], [-.24, -.74], [-.23, -.68]], '#d3a889', .075);
        this.line([[.18, -.84], attack ? [.37, -.92] : [.24, -.74], attack ? [.54, -.92] : [.23, -.68]], '#d3a889', .075);
        if (attack && r.chain > 0)
            this.line([[.54, -.92], [.72, -.83], [.89, -.89]], '#d9e7e7', .028);
        c.fillStyle = '#222c40';
        c.fillRect(-.275, -.71, .075, .06);
        c.fillRect(attack ? .49 : .2, attack ? -.95 : -.71, .075, .06);
        c.fillStyle = '#cca283';
        c.fillRect(-.055, -.955, .11, .08);
        c.fillStyle = '#e8ebe0';
        c.beginPath();
        c.ellipse(0, -1.005, .117, .135, 0, 0, Math.PI * 2);
        c.fill();
        this.poly([[-.11, -1.035], [-.065, -1.14], [.065, -1.14], [.11, -1.035], [.09, -.99], [-.09, -.99]], r.color || '#ffc86a');
        this.line([[-.053, -1.125], [-.043, -1.04]], '#30384a', .018);
        this.line([[.053, -1.125], [.043, -1.04]], '#30384a', .018);
        this.line([[-.092, -.97], [.09, -.97]], '#253046', .025);
        if (r.shield > 0) {
            c.strokeStyle = '#a8f4e8';
            c.lineWidth = .018;
            c.globalAlpha = .75;
            c.beginPath();
            c.ellipse(0, -.54, .44, .7, 0, 0, Math.PI * 2);
            c.stroke();
        }
        c.restore();
        if (!player && size > 18) {
            c.save();
            c.font = `600 ${clamp(size * .12, 10, 16)}px system-ui`;
            c.textAlign = 'center';
            const name = r.name;
            const width = c.measureText(name).width + 16;
            c.fillStyle = 'rgba(13,19,34,.8)';
            c.fillRect(x - width / 2, y - size * 1.28 - 17, width, 22);
            c.fillStyle = r.color;
            c.fillText(name, x, y - size * 1.28 - 2);
            c.restore();
        }
    }
    object(o, p) {
        const c = this.ctx, s = p.scale * this.w * 1.0, x = p.x, y = p.y;
        if (o.type === 'oil') {
            c.fillStyle = '#141e30';
            c.beginPath();
            c.ellipse(x, y, s * .7, s * .14, -.1, 0, Math.PI * 2);
            c.fill();
            c.strokeStyle = '#827394';
            c.lineWidth = s * .015;
            c.stroke();
            return;
        }
        if (o.type === 'barrier') {
            c.fillStyle = '#283345';
            c.fillRect(x - s * .5, y - s * .38, s, .38 * s);
            for (let i = 0; i < 4; i++)
                this.poly([[x - s * .5 + i * s * .25, y - s * .38], [x - s * .35 + i * s * .25, y - s * .38], [x - s * .5 + i * s * .25, y], [x - s * .65 + i * s * .25, y]], '#ffb86a');
            return;
        }
        const color = o.type === 'boost' ? '#8befda' : o.type === 'repair' ? '#fb91b3' : '#ffc86a';
        c.save();
        c.translate(x, y - s * .32);
        c.fillStyle = 'rgba(15,23,40,.8)';
        c.strokeStyle = color;
        c.lineWidth = Math.max(1, s * .04);
        c.beginPath();
        c.moveTo(0, -s * .37);
        c.lineTo(s * .32, 0);
        c.lineTo(0, s * .37);
        c.lineTo(-s * .32, 0);
        c.closePath();
        c.fill();
        c.stroke();
        if (o.type === 'repair') {
            c.fillStyle = color;
            c.fillRect(-s * .035, -s * .14, s * .07, s * .28);
            c.fillRect(-s * .14, -s * .035, s * .28, s * .07);
        }
        else if (o.type === 'boost')
            this.poly([[s * .04, -s * .18], [-s * .13, s * .04], [-s * .015, s * .04], [-s * .05, s * .19], [s * .14, -s * .025], [s * .02, -s * .025]], color);
        else {
            c.strokeStyle = color;
            c.lineWidth = s * .035;
            c.beginPath();
            c.ellipse(-s * .05, -s * .035, s * .065, s * .11, -.6, 0, Math.PI * 2);
            c.ellipse(s * .055, s * .035, s * .065, s * .11, -.6, 0, Math.PI * 2);
            c.stroke();
        }
        c.restore();
    }
    render(state, playerId, now, home = false) {
        const dt = Math.min(.1, Math.max(.001, now - this.last));
        this.last = now;
        this.fps = this.fps * .97 + (1 / dt) * .03;
        this.trackId = state?.trackId || this.trackId;
        const track = getTrack(this.trackId), c = this.ctx, w = this.w, h = this.h;
        const rider = state?.riders.find(r => r.id === playerId) || state?.riders[0];
        const desiredZ = rider ? rider.z - 4 : now * 12;
        if (Math.abs(desiredZ - this.cameraZ) > 80)
            this.cameraZ = desiredZ;
        else
            this.cameraZ += (desiredZ - this.cameraZ) * Math.min(1, dt * 12);
        this.cameraLane += (rider ? rider.lane - this.cameraLane : 2 - this.cameraLane) * Math.min(1, dt * 8);
        c.save();
        if (this.shake > 0 && !this.reducedMotion) {
            c.translate(Math.sin(now * 71) * this.shake * 7, Math.cos(now * 83) * this.shake * 4);
            this.shake = Math.max(0, this.shake - dt * 3);
        }
        this.background(track, now);
        this.road(track);
        const drawables = [];
        for (const s of this.scenery) {
            const z = s.z + Math.floor(this.cameraZ / 8640) * 8640;
            const p = this.project(track, z, 2, s.side * s.offset);
            if (p && p.z < 520)
                drawables.push({ z: p.z, draw: () => this.tree(p.x, p.y, p.scale * w * (s.type > .8 ? 6 : 4), track.scenery) });
        }
        for (const o of state?.objects || []) {
            if (rider?.consumed?.includes(o.id))
                continue;
            const p = this.project(track, o.z, o.lane);
            if (p && p.z < 400)
                drawables.push({ z: p.z, draw: () => this.object(o, p) });
        }
        for (const r of state?.riders || []) {
            if (r === rider || r.dnf)
                continue;
            const p = this.project(track, r.z, r.lane);
            if (p && p.z < 420 && p.z > 2)
                drawables.push({ z: p.z, draw: () => this.rider(p.x, p.y, p.scale * w * .48, r, now) });
        }
        if (state && state.length - this.cameraZ < 550) {
            const p = this.project(track, state.length);
            if (p) {
                drawables.push({ z: p.z, draw: () => {
                        const scale = p.half / 6.6;
                        c.fillStyle = '#172337';
                        c.fillRect(p.x - p.half, p.y - scale * 5, scale * .14, scale * 5);
                        c.fillRect(p.x + p.half, p.y - scale * 5, scale * .14, scale * 5);
                        c.fillStyle = '#f1ead9';
                        c.fillRect(p.x - p.half, p.y - scale * 5, p.half * 2, scale * .65);
                        for (let i = 0; i < 26; i++)
                            for (let j = 0; j < 2; j++)
                                if ((i + j) % 2) {
                                    c.fillStyle = '#293146';
                                    c.fillRect(p.x - p.half + i * p.half / 13, p.y - scale * 5 + j * scale * .325, p.half / 13, scale * .325);
                                }
                    } });
            }
        }
        drawables.sort((a, b) => b.z - a.z);
        for (const d of drawables)
            d.draw();
        if (rider && !home)
            this.rider(w * .5, h * .955, h * .225, rider, now, true);
        if (rider?.boost > 0 && !this.reducedMotion) {
            c.strokeStyle = 'rgba(184,253,236,.48)';
            c.lineWidth = 1.2;
            for (let i = 0; i < 18; i++) {
                const angle = i / 18 * Math.PI * 2 + now * .12, rad = w * .32, edge = 1.4 + (i % 3) * .2;
                this.line([[w * .5 + Math.cos(angle) * rad, h * .55 + Math.sin(angle) * rad * .5], [w * .5 + Math.cos(angle) * rad * edge, h * .55 + Math.sin(angle) * rad * .5 * edge]], 'rgba(184,253,236,.25)', 1.1);
            }
        }
        c.restore();
        const vignette = c.createRadialGradient(w * .5, h * .5, w * .14, w * .5, h * .5, w * .65);
        vignette.addColorStop(0, 'rgba(7,12,25,0)');
        vignette.addColorStop(1, home ? 'rgba(7,12,25,.48)' : 'rgba(7,12,25,.38)');
        c.fillStyle = vignette;
        c.fillRect(0, 0, w, h);
        if (this.flash > 0) {
            this.flash = Math.max(0, this.flash - dt);
            c.fillStyle = `rgba(255,153,126,${this.flash * .4})`;
            c.fillRect(0, 0, w, h);
        }
    }
    destroy() { this.observer.disconnect(); }
}
