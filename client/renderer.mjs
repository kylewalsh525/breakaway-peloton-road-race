import { getTrack, curveAt, hillAt } from '../shared/tracks.mjs';
import { clamp, rng } from '../shared/protocol.mjs';

// Original pixel sprites and software road projection, inspired by 16-bit combat racers.
const INK = '#24262b';
const SPRITE_WIDTH = 224, SPRITE_HEIGHT = 122, SPRITE_CENTER = 112, MAX_RIDER_POSES = 192;
const smooth = n => { const t = clamp(n, 0, 1); return t * t * (3 - 2 * t); };
function poseAt(frames, progress) {
    for (let i = 1; i < frames.length; i++) if (progress <= frames[i][0]) {
        const a = frames[i - 1], b = frames[i], t = smooth((progress - a[0]) / (b[0] - a[0]));
        return a.slice(1).map((v, index) => v + (b[index + 1] - v) * t);
    }
    return frames.at(-1).slice(1);
}
function limb(c, from, to, startWidth, endWidth, color) {
    const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / length, ny = dx / length;
    polygon(c, [[from[0] + nx * startWidth, from[1] + ny * startWidth],
        [to[0] + nx * endWidth, to[1] + ny * endWidth],
        [to[0] - nx * endWidth, to[1] - ny * endWidth],
        [from[0] - nx * startWidth, from[1] - ny * startWidth]], color);
}
function tint(hex, amount) {
    const value = Number.parseInt(hex.slice(1), 16);
    if (!Number.isFinite(value)) return hex;
    const toward = amount > 0 ? 255 : 0, factor = Math.abs(amount);
    return `rgb(${[16, 8, 0].map(shift => Math.round(((value >> shift) & 255) * (1 - factor) + toward * factor)).join(',')})`;
}
const PALETTES = {
    coast: { sky: '#5686d9', haze: '#a7c1e1', grass: ['#668d37', '#6d963b'], verge: '#b7b474', mountains: ['#8a9c9c', '#657f77', '#456346'] },
    canyon: { sky: '#5c91d5', haze: '#b3cee4', grass: ['#b99457', '#c19d60'], verge: '#dfbc7a', mountains: ['#b99b88', '#a67b58', '#875e3e'] },
    metro: { sky: '#517ab8', haze: '#b0c2db', grass: ['#648041', '#6d8849'], verge: '#b5b39a', mountains: ['#99a3ac', '#717e87', '#50686d'] },
    alpine: { sky: '#548adb', haze: '#aecae8', grass: ['#437438', '#4e803b'], verge: '#adb38b', mountains: ['#99adba', '#6b8491', '#4d6b58'] },
};
function surface(w, h) {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const c = canvas.getContext('2d'); c.imageSmoothingEnabled = false; return { canvas, c };
}
function box(c, color, x, y, w, h) {
    c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
function pixelOval(c, color, cx, cy, rx, ry, step = 1) {
    c.fillStyle = color;
    for (let y = -ry; y <= ry; y += step) {
        const span = Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))) * rx;
        c.fillRect(Math.round(cx - span), Math.round(cy + y), Math.max(1, Math.round(span * 2)), step);
    }
}
function polygon(c, points, color) {
    c.fillStyle = color; c.beginPath();
    points.forEach(([x, y], i) => i ? c.lineTo(Math.round(x), Math.round(y)) : c.moveTo(Math.round(x), Math.round(y)));
    c.closePath(); c.fill();
}
export class RoadRenderer {
    constructor(canvas) {
        this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
        this.quality = 'auto'; this.reducedMotion = false;
        this.w = 640; this.h = 320; this.cameraZ = 0; this.cameraLane = 2;
        this.last = 0; this.fps = 60; this.impactPulse = 0; this.impactStrength = 1; this.trackId = 'coast';
        this.panorama = null; this.sprites = new Map(); this.riderSprites = new Map();
        this.frameCost = 0; this.rearTraffic = []; this.mirrorFrame = null;
        const random = rng(9107);
        this.scenery = Array.from({ length: 520 }, (_, i) => ({ z: i * 18 + random() * 10, side: i % 2 ? 1 : -1, type: random(), offset: 8.4 + random() * 15 }));
        this.resize(); this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas);
    }
    resize() {
        const ratio = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
        const base = this.quality === 'low' ? 640 : this.quality === 'high' ? 1280 : 960;
        this.canvas.width = base; this.canvas.height = Math.max(160, Math.round(base / Math.max(.6, ratio)));
        this.w = this.canvas.width; this.h = this.canvas.height; this.ctx.imageSmoothingEnabled = false; this.panorama = null; this.mirrorFrame = null;
    }
    setQuality(q) { this.quality = q; this.resize(); }
    impact(strength = 1) { this.impactPulse = .28; this.impactStrength = strength; }
    poly(points, color) { polygon(this.ctx, points, color); }
    line(points, color, width = 1) {
        const c = this.ctx; c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'square';
        c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(Math.round(x), Math.round(y)) : c.moveTo(Math.round(x), Math.round(y))); c.stroke();
    }
    makePanorama(track) {
        const w = this.w, h = this.h, { canvas, c } = surface(w * 2, Math.ceil(h * .40));
        const colors = PALETTES[track.id] || PALETTES.coast, random = rng(track.seed);
        box(c, colors.sky, 0, 0, w * 2, h); box(c, '#739ce0', 0, h * .16, w * 2, h * .10); box(c, colors.haze, 0, h * .26, w * 2, h * .15);
        for (let i = 0; i < 15; i++) {
            const x = i * w * .15 + random() * 20 - 40, y = h * (.035 + random() * .17), scale = .6 + random() * 1.2;
            for (const [dx, dy, rx, ry] of [[10, 13, 19, 5], [28, 9, 20, 10], [47, 10, 25, 8], [66, 15, 20, 5]])
                pixelOval(c, '#b5c7d8', x + dx * scale, y + dy * scale, rx * scale, ry * scale, 2);
            for (const [dx, dy, rx, ry] of [[8, 10, 18, 5], [26, 5, 17, 9], [46, 9, 24, 8], [65, 12, 17, 5]])
                pixelOval(c, '#dce5e9', x + dx * scale, y + dy * scale, rx * scale, ry * scale, 2);
            pixelOval(c, '#f0f1e8', x + 25 * scale, y + 2 * scale, 11 * scale, 6 * scale, 2);
            pixelOval(c, '#f0f1e8', x + 42 * scale, y + 6 * scale, 14 * scale, 4 * scale, 2);
            box(c, '#bdcede', x + 6 * scale, y + 17 * scale, 64 * scale, 2 * scale);
        }
        const horizon = h * .35;
        for (let layer = 0; layer < 3; layer++) {
            const points = [[0, horizon + 5]], heights = [];
            for (let x = 0; x <= w * 2; x += 4) {
                const a = x / w * 10 + track.seed + layer * 3.4;
                const peak = Math.abs(Math.sin(a) * .65 + Math.sin(a * 2.13) * .26 + Math.sin(a * 5.8) * .09);
                const y = Math.round(horizon - h * (.025 + peak * (.13 - layer * .028)) + layer * 3);
                points.push([x, y]); heights.push(y);
            }
            points.push([w * 2, horizon + 7]); polygon(c, points, colors.mountains[layer]);
            for (let x = 0; x < w * 2; x += 3) {
                const y = heights[Math.floor(x / 4)], slope = (heights[Math.min(heights.length - 1, Math.floor(x / 4) + 3)] || y) - y;
                if (layer === 0 && (track.id === 'alpine' || track.id === 'coast') && y < h * .265) box(c, slope < 0 ? '#cdd4cd' : '#e6e7d8', x, y + 1, 3, 2 + Math.abs(slope));
                else if (random() > .5) box(c, layer === 2 ? '#6d8650' : '#9dae91', x, y + 3 + random() * 9, 2, 1 + random() * 3);
            }
        }
        for (let x = 0; x < w * 2; x += 3) {
            const th = 2 + random() * 8; box(c, x % 2 ? '#3f6036' : '#4e703a', x, horizon - th + 3, 3, th + 6);
        }
        if (track.id === 'metro') for (let i = 0; i < 35; i++) {
            const x = i * w / 19, bh = 8 + random() * 24;
            box(c, '#717879', x, horizon - bh, 9 + random() * 12, bh); box(c, '#b3beb5', x + 2, horizon - bh + 3, 3, 2);
        }
        this.panorama = { id: track.id, canvas };
    }
    background(track) {
        if (this.panorama?.id !== track.id) this.makePanorama(track);
        const colors = PALETTES[track.id] || PALETTES.coast;
        box(this.ctx, colors.grass[0], 0, 0, this.w, this.h);
        const shift = Math.round(this.w * .4 + curveAt(track, this.cameraZ) * this.w * .08);
        this.ctx.drawImage(this.panorama.canvas, -shift, 0);
    }
    project(track, worldZ, lane = 2, extraX = 0) {
        const dz = worldZ - this.cameraZ; if (dz <= 1) return null;
        const bend = curveAt(track, this.cameraZ + dz * .43), x = bend * dz * dz / 1450 + (lane - this.cameraLane) * 2.64 + extraX;
        const ground = (hillAt(track, worldZ) - hillAt(track, this.cameraZ)) * .10, scale = 1.5 / dz;
        return { x: this.w * .5 + scale * x * this.w * .5, y: this.h * .35 + scale * (5.7 - ground) * this.h * .8, scale, half: scale * 6.6 * this.w * .5, z: dz };
    }
    road(track) {
        const c = this.ctx, w = this.w, h = this.h, colors = PALETTES[track.id] || PALETTES.coast;
        const step = 3, far = this.quality === 'low' ? 420 : 660, segments = [];
        for (let z = 2; z < far; z += step) {
            const absolute = Math.floor((this.cameraZ + z) / step) * step, p = this.project(track, absolute), q = this.project(track, absolute + step);
            if (p && q) segments.push({ p, q, absolute });
        }
        if (segments.length) segments.unshift({ p: this.project(track, this.cameraZ + 1.01), q: segments[0].p, absolute: this.cameraZ });
        for (let i = segments.length - 1; i >= 0; i--) {
            const { p, q, absolute } = segments[i], top = Math.round(q.y), bottom = Math.round(p.y) + 1;
            if (top > h || bottom < top) continue;
            const band = Math.floor(absolute / 17) % 2; box(c, colors.grass[band], 0, top, w, bottom - top);
            for (let y = Math.max(0, top); y < Math.min(h, bottom); y++) {
                const t = clamp((y - q.y) / Math.max(.001, p.y - q.y), 0, 1), center = q.x + (p.x - q.x) * t, half = q.half + (p.half - q.half) * t;
                const left = Math.round(center - half), roadWidth = Math.round(half * 2), edge = Math.max(1, Math.round(half * .025)), gravel = Math.max(1, Math.round(half * .08));
                box(c, colors.verge, left - gravel, y, roadWidth + gravel * 2, 1); box(c, band ? '#696969' : '#646464', left, y, roadWidth, 1);
                box(c, '#d0d0b7', left + edge, y, Math.max(1, edge * .6), 1); box(c, '#d0d0b7', left + roadWidth - edge * 1.6, y, Math.max(1, edge * .6), 1);
                if (Math.floor(absolute / 10) % 3 < 2) box(c, '#e7e1c2', center - Math.max(1, half * .013), y, Math.max(2, half * .026), 1);
                if (half > w * .11 && y % 3 === 0) {
                    const speck = (Math.floor(absolute * 11) + y * 37) % Math.max(1, roadWidth);
                    box(c, '#747474', left + speck, y, Math.max(1, half * .008), 1);
                    box(c, '#485e2c', left - gravel * 2.6, y, gravel * .6, 1); box(c, '#97a44b', left + roadWidth + gravel * 2, y, gravel, 1);
                }
            }
        }
    }
    scenerySprite(type) {
        if (this.sprites.has(type)) return this.sprites.get(type);
        const { canvas, c } = surface(72, 104), random = rng(type.length * 231);
        if (type === 'sign') {
            box(c, '#373a30', 34, 40, 4, 64); box(c, '#c2beb0', 35, 40, 2, 64);
            polygon(c, [[36, 3], [66, 32], [36, 61], [6, 32]], '#252622'); polygon(c, [[36, 7], [62, 32], [36, 57], [10, 32]], '#e8c733');
            polygon(c, [[28, 16], [38, 16], [50, 31], [38, 45], [28, 45], [40, 31]], '#292a22');
        } else if (type === 'cactus') {
            box(c, '#344c2e', 30, 16, 14, 88); box(c, '#4f733c', 31, 13, 10, 85);
            box(c, '#36582f', 13, 38, 10, 32); box(c, '#436736', 16, 64, 19, 9);
            box(c, '#36582f', 51, 25, 9, 33); box(c, '#50733a', 40, 51, 17, 8);
            box(c, '#91a058', 33, 17, 2, 75); box(c, '#758d4c', 17, 42, 2, 21); box(c, '#758d4c', 53, 28, 2, 22);
        } else {
            box(c, '#373d26', 32, 53, 9, 51); box(c, '#7a7250', 36, 58, 3, 44);
            if (type === 'broadleaf') {
                const lobes = [[36, 19, 17, 14], [21, 30, 17, 16], [49, 29, 17, 17], [35, 43, 26, 24], [14, 48, 11, 14], [57, 47, 10, 13]];
                for (const [x, y, rx, ry] of lobes) pixelOval(c, '#294b2e', x, y, rx, ry, 2);
                for (const [x, y, rx, ry] of lobes) pixelOval(c, '#406b36', x - 2, y - 2, rx - 3, ry - 3, 2);
                for (const [x, y] of [[31, 12], [18, 23], [44, 25], [29, 36], [13, 43], [48, 42], [26, 51]]) {
                    pixelOval(c, '#608243', x, y, 7 + random() * 3, 5 + random() * 3, 2);
                    pixelOval(c, '#798f4d', x - 2, y - 2, 4, 2, 1);
                }
                for (let i = 0; i < 100; i++) {
                    const x = Math.round(7 + random() * 56), y = Math.round(9 + random() * 56);
                    if (c.getImageData(x, y, 1, 1).data[3]) box(c, i % 3 ? '#50763b' : '#87984d', x, y, 1 + random() * 3, 1);
                }
            } else for (let i = 0; i < 7; i++) {
                const y = 1 + i * 10, radius = 8 + i * 3.8;
                polygon(c, [[36, y], [36 + radius, y + 31], [36 - radius, y + 31]], i % 2 ? '#294d32' : '#315738');
                polygon(c, [[36, y + 3], [36, y + 29], [36 - radius + 4, y + 29]], '#4b713d');
                for (let j = 0; j < 5; j++) box(c, '#698848', 34 - random() * radius, y + 20 + random() * 9, 3, 1);
            }
        }
        this.sprites.set(type, canvas); return canvas;
    }
    tree(x, y, size, type) {
        if (size < 2) return;
        const sprite = this.scenerySprite(type), width = Math.round(size * 72 / 104);
        this.ctx.drawImage(sprite, Math.round(x - width / 2), Math.round(y - size), width, Math.round(size));
    }
    combatPose(r) {
        const attacking = r.action === 'hit', kicking = r.action === 'kick';
        const chain = attacking && (r.actionChain ?? (r.chain > 0));
        const duration = Math.max(.05, r.actionDuration || (kicking ? .62 : chain ? .66 : .48));
        const progress = attacking || kicking ? clamp(1 - (r.actionTimer ?? duration) / duration, 0, 1) : 0;
        const phase = attacking || kicking ? Math.min(15, Math.floor(progress * 16)) : 0;
        return { attacking, kicking, chain, phase, progress: phase / 15, side: r.actionSide === -1 ? -1 : 1 };
    }
    riderSprite(r, now, player = false, front = false) {
        const color = r.color || '#d72e2e', pose = this.combatPose(r);
        const { attacking, kicking, chain, phase, progress } = pose;
        const blocking = r.action === 'block' || r.shield > 0;
        const side = pose.side * (front ? -1 : 1);
        const extension = poseAt([[0, 0], [.2, -.25], [.45, 1], [.56, .9], [.8, .25], [1, 0]], progress)[0];
        const baseLean = clamp(((r.targetLane ?? r.lane) - r.lane) * 6 + (player ? -curveAt(getTrack(this.trackId), this.cameraZ) * 2 : 0), -8, 8);
        const lean = Math.round(baseLean / 2) * 2;
        const key = `${color}:${player ? 1 : 0}:${front ? 1 : 0}:${attacking ? 'p' : kicking ? 'k' : blocking ? 'b' : 'r'}:${chain ? 1 : 0}:${lean}:${phase}:${side}`;
        if (this.riderSprites.has(key)) return this.riderSprites.get(key);
        const { canvas, c } = surface(SPRITE_WIDTH, SPRITE_HEIGHT), light = tint(color, .32), dark = tint(color, -.32), shade = tint(color, -.15);
        c.translate(SPRITE_CENTER, 0); c.transform(1, 0, -lean / 110, 1, lean, 0);
        // Mirroring the complete authored pose keeps the attacking shoulder, hip and limb coherent.
        if ((attacking || kicking) && side < 0) c.scale(-1, 1);
        // The narrow outline follows curved fenders and articulated clothing panels.
        polygon(c, [[-6, 76], [6, 76], [9, 84], [8, 108], [5, 115], [-5, 115], [-8, 108], [-9, 84]], '#1d2023');
        box(c, '#4f5357', -6, 82, 12, 26); box(c, '#313437', -3, 82, 8, 31); box(c, '#797a78', -5, 85, 1, 23);
        for (let i = 0; i < 8; i++) {
            box(c, '#24272b', -3, 84 + i * 4, 7, 1); box(c, '#626468', 4, 85 + i * 4, 1, 2);
        }
        // Swingarm, shock absorbers, rear brake and twin chrome silencers.
        polygon(c, [[-12, 62], [-8, 66], [-5, 101], [-8, 102], [-14, 75]], '#a6aca9');
        polygon(c, [[12, 62], [8, 66], [5, 101], [8, 102], [14, 75]], '#686f72');
        for (const side of [-17, 13]) {
            box(c, '#383d42', side - 1, 69, 7, 36); box(c, '#a5afb1', side, 70, 5, 32);
            box(c, '#f1efe3', side, 71, 1, 27); box(c, '#d0d4ce', side + 1, 74, 1, 20);
            box(c, '#60696d', side + 3, 73, 2, 25); box(c, '#181d22', side, 100, 5, 4); box(c, '#717c7d', side + 1, 100, 3, 1);
            for (let i = 0; i < 5; i++) box(c, '#e0ded1', side + (side < 0 ? 5 : -3), 61 + i * 3, 3, 1);
        }
        polygon(c, [[-13, 49], [13, 49], [17, 65], [12, 89], [6, 94], [-6, 94], [-12, 89], [-17, 65]], '#38343b');
        polygon(c, [[-12, 51], [12, 51], [16, 65], [11, 87], [-11, 87], [-16, 65]], dark);
        polygon(c, [[-12, 53], [10, 53], [13, 66], [10, 82], [-11, 82], [-14, 64]], color);
        polygon(c, [[-12, 55], [-8, 54], [-9, 66], [-12, 78], [-14, 64]], light);
        polygon(c, [[8, 56], [12, 58], [14, 65], [10, 80], [7, 80]], shade);
        polygon(c, [[-12, 58], [12, 58], [11, 65], [-11, 65]], '#2e3037');
        box(c, '#5e6065', -9, 59, 17, 2); box(c, '#aba396', -10, 66, 20, 2);
        box(c, '#5d242c', -10, 71, 20, 8); box(c, '#ed4b34', -9, 72, 18, 5); box(c, '#ffa679', -8, 72, 16, 1);
        for (const dx of [-12, 10]) { box(c, '#b46a25', dx, 72, 3, 5); box(c, '#ebad53', dx, 72, 2, 2); }
        box(c, '#34383d', -9, 82, 18, 8); box(c, '#dcdcca', -8, 83, 16, 6); box(c, '#67706c', -5, 85, 10, 1); box(c, '#9b9f92', -3, 87, 5, 1);
        // Bent denim legs and boots; a kick moves the entire leg clear of the bike.
        polygon(c, [[-17, 43], [-5, 53], [-13, 65], [-18, 83], [-26, 85], [-25, 69], [-23, 56]], '#353b48');
        polygon(c, [[-17, 47], [-9, 53], [-18, 66], [-21, 81], [-25, 82], [-22, 63]], '#8893a7');
        polygon(c, [[-17, 49], [-12, 53], [-21, 65], [-22, 76], [-24, 78], [-21, 60]], '#b1b9c2');
        box(c, '#727f95', -23, 67, 3, 7); box(c, '#454b59', -24, 73, 3, 6); box(c, '#d6d5c9', -22, 65, 3, 1);
        polygon(c, [[-26, 80], [-18, 80], [-17, 86], [-20, 90], [-30, 90], [-30, 87]], '#303339');
        box(c, '#727979', -28, 86, 9, 2); box(c, '#babaae', -30, 89, 11, 1);
        if (kicking) {
            const [kx, ky, ax, ay] = poseAt([[0, 21, 66, 23, 84], [.2, 28, 54, 20, 65],
                [.45, 39, 51, 63, 49], [.56, 38, 54, 60, 55], [.8, 27, 61, 35, 72], [1, 21, 66, 23, 84]], progress);
            const hip = [13, 50], knee = [kx, ky], ankle = [ax, ay];
            limb(c, hip, knee, 6, 5, '#343e4d'); limb(c, knee, ankle, 5, 4, '#333c48');
            limb(c, [hip[0], hip[1] - 1], [kx, ky - 1], 4.5, 3.5, '#8c9cb3');
            limb(c, [kx, ky - 1], [ax, ay - 1], 3.5, 2.8, '#6c7f98');
            limb(c, [hip[0] + 1, hip[1] - 3], [kx, ky - 3], 1.5, 1, '#bac3c9');
            box(c, '#566377', kx - 2, ky - 2, 5, 4); box(c, '#a8b4bf', kx - 2, ky - 2, 4, 1);
            c.save(); c.translate(ax, ay); c.rotate(-Math.max(0, extension) * .26);
            polygon(c, [[-4, -7], [3, -7], [4, -2], [10, 0], [13, 3], [12, 6], [-5, 6], [-5, 0]], '#282e35');
            polygon(c, [[-3, -6], [2, -6], [3, -1], [9, 1], [10, 3], [-3, 3]], '#454f58');
            box(c, '#78858a', -2, -5, 2, 6); box(c, '#a9b3b1', -4, 4, 16, 1);
            box(c, '#535c60', -4, 6, 15, 1);
            for (let i = 0; i < 3; i++) box(c, '#969d99', 1, -4 + i * 2, 3, 1);
            box(c, '#7e898a', 7, 1, 3, 1); c.restore();
        } else {
            polygon(c, [[17, 43], [5, 53], [13, 65], [18, 83], [26, 85], [25, 69], [23, 56]], '#343b4c');
            polygon(c, [[17, 47], [10, 53], [19, 66], [21, 81], [25, 82], [22, 63]], '#718099');
            polygon(c, [[17, 49], [13, 53], [22, 66], [24, 78], [24, 65], [20, 55]], '#a4afbd');
            box(c, '#58647a', 21, 69, 3, 6); box(c, '#b7bdc3', 20, 65, 3, 1);
            polygon(c, [[26, 80], [18, 80], [17, 86], [20, 90], [30, 90], [30, 87]], '#303339');
            box(c, '#727979', 20, 86, 8, 2); box(c, '#babaae', 19, 89, 11, 1);
        }
        box(c, '#343b40', -28, 36, 56, 3); box(c, '#b7bfba', -29, 36, 10, 1); box(c, '#b7bfba', 19, 36, 10, 1);
        box(c, '#40484a', -30, 31, 2, 8); box(c, '#40484a', 28, 31, 2, 8);
        box(c, '#7c9499', -34, 29, 7, 3); box(c, '#cedbd8', -33, 29, 5, 1); box(c, '#7c9499', 27, 29, 7, 3); box(c, '#cedbd8', 28, 29, 5, 1);
        c.save();
        if (attacking || kicking) {
            c.translate(extension * (attacking ? 2 : -1), Math.max(0, -extension) * 2);
            c.transform(1, 0, extension * .035, 1, -extension * 1.7, 0);
        }
        const jacket = player ? '#e2dfd2' : color, jacketLight = player ? '#f5f0dc' : light;
        const jacketShade = player ? '#aeb2b0' : dark, jacketMid = player ? '#c6c9c0' : shade;
        polygon(c, [[-8, 18], [8, 18], [16, 23], [19, 30], [16, 42], [11, 54], [-11, 54], [-16, 42], [-19, 30], [-16, 23]], '#51545a');
        polygon(c, [[-8, 20], [8, 20], [15, 24], [17, 30], [14, 42], [10, 52], [-10, 52], [-14, 42], [-17, 30], [-15, 24]], jacket);
        polygon(c, [[-8, 21], [5, 21], [10, 24], [7, 32], [-4, 34], [-12, 30], [-13, 26]], jacketLight);
        polygon(c, [[9, 23], [15, 25], [17, 31], [13, 42], [9, 49], [7, 42], [10, 32]], jacketShade);
        polygon(c, [[-15, 26], [-12, 29], [-11, 37], [-6, 45], [-8, 50], [-12, 47], [-16, 36]], jacketMid);
        polygon(c, [[-9, 35], [-1, 38], [7, 36], [6, 38], [-1, 40]], jacketMid);
        polygon(c, [[-6, 40], [0, 43], [7, 40], [5, 44], [-1, 45]], jacketShade);
        box(c, jacketMid, -1, 22, 1, 12); box(c, jacketLight, -6, 37, 2, 3); box(c, jacketLight, -5, 43, 3, 2);
        polygon(c, [[-12, 46], [-7, 49], [6, 49], [12, 46], [10, 53], [-10, 53]], color);
        box(c, dark, -8, 51, 16, 2); box(c, '#3c4250', -10, 54, 20, 3);
        // Curved shoulders, articulated elbows, and leather gloves.
        polygon(c, [[-16, 24], [-21, 26], [-25, 33], [-29, 40], [-27, 46], [-22, 44], [-20, 38], [-18, 33]], '#50545a');
        polygon(c, [[-17, 25], [-20, 28], [-24, 36], [-27, 41], [-25, 43], [-22, 38], [-19, 32]], jacket);
        box(c, jacketLight, -21, 29, 2, 5); box(c, jacketShade, -25, 37, 2, 4); box(c, '#31383d', -28, 42, 6, 4); box(c, '#737d7d', -27, 42, 3, 1);
        if (attacking) {
            const armFrames = chain ? [[0, 24, 34, 27, 41], [.2, 24, 20, 19, 11], [.45, 35, 25, 51, 23],
                [.56, 38, 30, 52, 33], [.8, 28, 33, 38, 40], [1, 24, 36, 27, 43]] :
                [[0, 24, 34, 27, 41], [.2, 21, 31, 17, 28], [.45, 37, 26, 57, 22],
                [.56, 39, 28, 57, 27], [.8, 28, 30, 38, 34], [1, 24, 36, 27, 43]];
            const [ex, ey, hx, hy] = poseAt(armFrames, progress), shoulder = [16, 26], elbow = [ex, ey], hand = [hx, hy];
            limb(c, shoulder, elbow, 5, 4, '#50545a'); limb(c, elbow, hand, 4, 3, '#63564b');
            limb(c, [17, 25], [ex, ey - 1], 3.6, 2.8, jacket);
            limb(c, [ex, ey - 1], [hx, hy - 1], 2.7, 2, '#c49c78');
            limb(c, [ex, ey - 2], [hx - 1, hy - 2], 1, .8, '#e1bc91');
            box(c, jacketShade, ex - 2, ey - 2, 4, 2);
            c.save(); c.translate(hx, hy); c.rotate(Math.atan2(hy - ey, hx - ex));
            box(c, '#333b43', -7, -4, 5, 8); box(c, '#8b999a', -6, -3, 1, 6);
            polygon(c, [[-3, -5], [4, -5], [7, -2], [7, 3], [3, 5], [-3, 4]], '#252d34');
            polygon(c, [[-2, -4], [3, -4], [5, -2], [5, 2], [1, 3], [-2, 2]], '#526069');
            polygon(c, [[-3, 1], [0, 2], [1, 5], [-2, 6], [-4, 4]], '#373f46');
            for (let i = 0; i < 3; i++) box(c, '#899395', i * 2 - 1, -3, 1, 2);
            box(c, '#6b777d', 3, 1, 2, 1); c.restore();
            if (chain) {
                const [cx, cy, tx, ty] = poseAt([[0, 33, 55, 28, 75], [.2, 38, 1, 37, 33],
                    [.45, 79, 9, 101, 30], [.56, 83, 38, 90, 62], [.8, 54, 55, 43, 72], [1, 33, 56, 28, 75]], progress);
                const point = t => [(1 - t) ** 2 * hx + 2 * (1 - t) * t * cx + t * t * tx,
                    (1 - t) ** 2 * hy + 2 * (1 - t) * t * cy + t * t * ty];
                // Alternating linked steel rings follow an attack-relative weighted arc.
                for (let i = 0; i < 15; i++) {
                    const t = (i + .5) / 15, [lx, ly] = point(t), next = point(Math.min(1, t + .025));
                    const angle = Math.atan2(next[1] - ly, next[0] - lx), ax = Math.cos(angle), ay = Math.sin(angle);
                    const nx = -ay, ny = ax, breadth = i % 2 ? .65 : 1.7;
                    const points = [[lx - ax * 2, ly - ay * 2], [lx + nx * breadth, ly + ny * breadth],
                        [lx + ax * 2, ly + ay * 2], [lx - nx * breadth, ly - ny * breadth]];
                    c.beginPath(); points.forEach(([px, py], index) => index ? c.lineTo(Math.round(px), Math.round(py)) : c.moveTo(Math.round(px), Math.round(py))); c.closePath();
                    c.lineWidth = 2; c.strokeStyle = '#4f5960'; c.stroke();
                    c.lineWidth = 1; c.strokeStyle = i % 2 ? '#b1bec1' : '#e0e2d8'; c.stroke();
                }
                box(c, '#d5d9d0', tx - 1, ty - 1, 3, 2);
            }
        } else if (blocking) {
            polygon(c, [[17, 25], [24, 20], [20, 9], [26, 7], [30, 24], [22, 36], [18, 33]], '#50545a');
            polygon(c, [[20, 26], [26, 24], [23, 13], [25, 11], [28, 24], [22, 33]], jacket); box(c, jacketLight, 25, 18, 1, 7);
        } else {
            polygon(c, [[16, 24], [21, 26], [25, 33], [29, 40], [27, 46], [22, 44], [20, 38], [18, 33]], '#50545a');
            polygon(c, [[17, 25], [20, 28], [24, 36], [27, 41], [25, 43], [22, 38], [19, 32]], jacketMid);
            box(c, jacketLight, 20, 29, 2, 5); box(c, jacketShade, 24, 37, 2, 4); box(c, '#31383d', 22, 42, 6, 4); box(c, '#737d7d', 23, 42, 3, 1);
        }
        // Rounded helmet with a restrained specular highlight and shaded lower rim.
        polygon(c, [[-4, 1], [4, 1], [8, 3], [10, 7], [10, 13], [8, 18], [4, 21], [-4, 21], [-8, 18], [-10, 13], [-10, 7], [-8, 3]], '#424248');
        polygon(c, [[-4, 2], [4, 2], [7, 4], [9, 8], [9, 13], [6, 18], [-6, 18], [-9, 13], [-9, 8], [-7, 4]], color);
        polygon(c, [[4, 3], [7, 5], [9, 9], [8, 14], [5, 18], [2, 18], [5, 11]], dark);
        polygon(c, [[-6, 5], [-3, 3], [-1, 3], [-4, 7], [-5, 12], [-7, 12], [-7, 8]], light);
        box(c, '#e6e5d7', -1, 2, 3, 15); box(c, '#f9f4e3', 0, 3, 1, 8);
        box(c, '#606466', -7, 18, 14, 2); box(c, '#b8bdba', -4, 20, 8, 1);
        box(c, '#3f4549', -6, 16, 3, 1); box(c, '#3f4549', 4, 16, 3, 1);
        if (front) {
            // A real front-facing sprite for riders approaching in the mirrors.
            polygon(c, [[-8, 7], [8, 7], [8, 12], [5, 15], [-5, 15], [-8, 12]], '#273540');
            box(c, '#8ba9b5', -6, 8, 11, 1); box(c, '#c4d3d5', -5, 9, 4, 1);
            polygon(c, [[-12, 61], [12, 61], [15, 77], [8, 87], [-8, 87], [-15, 77]], dark);
            polygon(c, [[-11, 62], [11, 62], [13, 76], [7, 83], [-7, 83], [-13, 76]], color);
            box(c, '#393b3d', -10, 65, 20, 10); box(c, '#f3eaca', -9, 66, 18, 7); box(c, '#ffffff', -6, 67, 11, 2);
            box(c, '#a4abad', -11, 81, 3, 21); box(c, '#555f67', 8, 81, 3, 21);
            box(c, color, -6, 82, 12, 7); box(c, light, -5, 82, 8, 2);
        }
        c.restore();
        c.setTransform(1, 0, 0, 1, 0, 0);
        if (this.riderSprites.size >= MAX_RIDER_POSES) this.riderSprites.delete(this.riderSprites.keys().next().value);
        this.riderSprites.set(key, canvas); return canvas;
    }
    rider(x, y, size, r, now, player = false, front = false) {
        const canvas = this.riderSprite(r, now, player, front), ctx = this.ctx;
        const height = Math.round(size), width = Math.round(size * SPRITE_WIDTH / SPRITE_HEIGHT);
        const bob = !this.reducedMotion && r.speed > 2 ? Math.sin(now * 20 + (r.lane || 0)) * Math.min(.65, size / 180) : 0;
        const remaining = Math.max(r.impactTimer || 0, player ? this.impactPulse : 0);
        const duration = Math.max(.05, r.impactDuration || .28), impactProgress = clamp(1 - remaining / duration, 0, 1);
        const impactSide = r.impactSide === -1 ? -1 : 1;
        const recoil = remaining > 0 && !this.reducedMotion ? Math.sin(impactProgress * Math.PI) * (1 - impactProgress) : 0;
        box(ctx, '#454840', x - size * .19, y - size * .032, size * .42, Math.max(1, size * .028));
        if (r.boost > 0 && !this.reducedMotion) {
            box(ctx, '#ecb64b', x - size * .14, y - size * .14, size * .028, 3);
            box(ctx, '#e67f3d', x + size * .13, y - size * .14, size * .028, 3);
        }
        // Impacts bend the rider briefly around the rear tyre; the character is never hidden.
        ctx.save(); ctx.translate(x - impactSide * recoil * size * .025, y);
        ctx.rotate(-impactSide * recoil * (duration > .8 ? .12 : .065));
        ctx.drawImage(canvas, Math.round(-size * SPRITE_CENTER / SPRITE_HEIGHT), Math.round(-height + bob + recoil * size * .012), width, height);
        ctx.restore();
        if (remaining > 0 && impactProgress < .48 && !front) {
            const power = 1 - impactProgress / .48, scale = size / SPRITE_HEIGHT;
            const ix = x + impactSide * size * .20, iy = y - size * .67;
            for (let i = 0; i < 3; i++) {
                const a = (i - 1) * .85 + (impactSide < 0 ? Math.PI : 0);
                const start = (3 + impactProgress * 12) * scale, end = start + (3 + i) * power * scale;
                this.line([[ix + Math.cos(a) * start, iy + Math.sin(a) * start],
                    [ix + Math.cos(a) * end, iy + Math.sin(a) * end]], '#cabf8c', Math.max(1, scale));
            }
        }
    }
    renderMirrors(state, player, now, track) {
        if (!player) return;
        const c = this.ctx, w = this.w, h = this.h, palette = PALETTES[track.id] || PALETTES.coast;
        const mw = Math.round(Math.min(w * .21, h * .54)), mh = Math.round(mw * .43), inset = Math.max(7, Math.round(w * .018));
        const y = h - mh - Math.max(7, Math.round(h * .035));
        const traffic = (state?.riders || []).filter(r => r.id !== player.id && !r.dnf && r.z < player.z && player.z - r.z < 140).sort((a, b) => a.z - b.z);
        this.rearTraffic = traffic.map(r => ({ id: r.id, distance: Math.round((player.z - r.z) * 10) / 10, closing: r.speed > player.speed + .5, side: r.lane <= player.lane ? 'left' : 'right' }));
        for (const side of [-1, 1]) {
            const x = side < 0 ? inset : w - inset - mw, horizon = y + mh * .27;
            polygon(c, [[x - 3, y + 3], [x + 2, y - 3], [x + mw - 3, y - 3], [x + mw + 3, y + 3], [x + mw + 3, y + mh + 3], [x - 3, y + mh + 3]], '#252a2e');
            box(c, '#929b9d', x, y - 2, mw - 2, 1); box(c, '#060c0f', x, y, mw, mh);
            c.save(); c.beginPath(); c.rect(x + 2, y + 2, mw - 4, mh - 4); c.clip();
            box(c, '#9eb9d0', x, y, mw, mh * .30); box(c, palette.grass[0], x, horizon, mw, mh);
            polygon(c, [[x, horizon], [x + mw * .2, y + mh * .13], [x + mw * .37, horizon], [x + mw * .74, y + mh * .17], [x + mw, horizon]], palette.mountains[1]);
            const bend = -curveAt(track, player.z - 35) * mw * .13;
            polygon(c, [[x + mw * .5 + bend - 2, horizon], [x + mw * .5 + bend + 2, horizon], [x + mw * 1.11, y + mh], [x - mw * .11, y + mh]], '#676c6c');
            const movement = player.z % 12;
            for (let i = 0; i < 5; i++) {
                const depth = (i + movement / 12) / 5, yy = horizon + depth * depth * mh * .78;
                box(c, '#d7d5bc', x + mw * .5 + bend * (1 - depth), yy, Math.max(1, depth * 2), Math.max(1, depth * mh * .11));
            }
            let nearest = null;
            for (const r of traffic) {
                const relative = r.lane - player.lane;
                if (side < 0 ? relative > .35 : relative < -.35) continue;
                const distance = player.z - r.z, depth = 1 / (1 + distance / 15);
                const ry = horizon + (mh * .72) * depth;
                const rx = x + mw * (.5 - relative * .105 * depth) + bend * (1 - depth);
                this.rider(rx, ry, mh * .95 * depth, r, now, false, true);
                if (!nearest || distance < nearest.distance) nearest = { distance, closing: r.speed > player.speed + .5 };
            }
            c.restore();
            const font = Math.max(6, Math.round(mw * .047)); c.font = `bold ${font}px monospace`; c.textBaseline = 'top';
            const label = nearest ? `${Math.round(nearest.distance)}m${nearest.closing ? ' CLOSING' : ' BEHIND'}` : 'REAR CLEAR';
            box(c, '#252a2e', x, y + mh - font - 3, mw, font + 4);
            c.fillStyle = nearest?.closing ? '#f4cc68' : '#dde2cf'; c.fillText(label, x + 4, y + mh - font - 1);
            c.textBaseline = 'alphabetic';
        }
    }
    object(o, p) {
        const c = this.ctx, s = Math.max(2, p.scale * this.w * .9), x = Math.round(p.x), y = Math.round(p.y);
        if (o.type === 'oil') {
            box(c, '#282930', x - s * .6, y - s * .06, s * 1.2, s * .12); box(c, '#343443', x - s * .4, y - s * .12, s * .8, s * .2); box(c, '#605474', x - s * .27, y - s * .08, s * .3, Math.max(1, s * .025)); return;
        }
        if (o.type === 'barrier') {
            box(c, '#292b29', x - s * .5, y - s * .42, s, s * .25); box(c, '#d9c999', x - s * .48, y - s * .4, s * .96, s * .21);
            for (let i = 0; i < 4; i++) polygon(c, [[x - s * .48 + i * s * .25, y - s * .4], [x - s * .35 + i * s * .25, y - s * .4], [x - s * .47 + i * s * .25, y - s * .2], [x - s * .6 + i * s * .25, y - s * .2]], '#ad442d');
            box(c, '#403f32', x - s * .4, y - s * .2, s * .08, s * .2); box(c, '#403f32', x + s * .3, y - s * .2, s * .08, s * .2); return;
        }
        box(c, INK, x - s * .22, y - s * .5, s * .44, s * .43); box(c, '#d7cfaa', x - s * .19, y - s * .47, s * .38, s * .36);
        if (o.type === 'repair') {
            box(c, '#b5352c', x - s * .045, y - s * .41, s * .09, s * .25); box(c, '#b5352c', x - s * .12, y - s * .33, s * .24, s * .09);
        } else if (o.type === 'boost') polygon(c, [[x + s * .06, y - s * .43], [x - s * .1, y - s * .27], [x, y - s * .27], [x - s * .05, y - s * .14], [x + s * .12, y - s * .31], [x + s * .02, y - s * .31]], '#975e19');
        else for (let i = 0; i < 4; i++) box(c, '#575961', x - s * .11 + i * s * .055, y - s * .4 + i * s * .055, s * .085, s * .08);
    }
    render(state, playerId, now, home = false) {
        const frameStart = performance.now();
        const dt = Math.min(.1, Math.max(.001, now - this.last)); this.last = now; this.fps = this.fps * .97 + (1 / dt) * .03;
        this.trackId = state?.trackId || this.trackId;
        const track = getTrack(this.trackId), c = this.ctx, w = this.w, h = this.h;
        const rider = state?.riders.find(r => r.id === playerId) || state?.riders[0], desiredZ = rider ? rider.z - 16 : now * 12;
        // Snapshots are already interpolated by the client; another longitudinal lag obscures close racers.
        this.cameraZ = desiredZ;
        const laneFocus = 2 + ((rider?.lane ?? 2) - 2) * .65;
        this.cameraLane += (laneFocus - this.cameraLane) * (1 - Math.exp(-dt * 22));
        c.save();
        this.background(track); this.road(track);
        const drawables = [];
        for (const s of this.scenery) {
            let z = s.z + Math.floor(this.cameraZ / 9360) * 9360; if (z < this.cameraZ) z += 9360;
            const sign = s.type > .94, p = this.project(track, z, 2, s.side * (sign ? 8.2 : s.offset));
            if (p && p.z < 500) {
                const type = sign ? 'sign' : track.scenery === 'cactus' ? 'cactus' : s.type > .72 && track.id !== 'alpine' ? 'broadleaf' : 'pine';
                const size = Math.min(h * 3, p.scale * w * (sign ? 1.8 : 3.7));
                if (p.x + size > 0 && p.x - size < w) drawables.push({ z: p.z, draw: () => this.tree(p.x, p.y, size, type) });
            }
        }
        for (const o of state?.objects || []) {
            if (rider?.consumed?.includes(o.id)) continue; const p = this.project(track, o.z, o.lane);
            if (p && p.z < 400) drawables.push({ z: p.z, draw: () => this.object(o, p) });
        }
        const playerProjection = rider ? this.project(track, rider.z, rider.lane) : null;
        const playerSize = playerProjection ? Math.min(h * .74, playerProjection.scale * h * 3.45) : 0;
        for (const r of state?.riders || []) {
            if (r.dnf) continue; const p = this.project(track, r.z, r.lane);
            if (p && p.z < 420 && p.z > 2) {
                const size = Math.min(h * .74, p.scale * h * 3.45);
                // Keep the controlled rider readable. Directly overlapping rear traffic remains
                // visible in the live mirrors; approaching riders at either side stay on the road.
                if (rider && r !== rider && r.z < rider.z && playerProjection &&
                    Math.abs(p.x - playerProjection.x) < (size + playerSize) * .24) continue;
                drawables.push({ z: p.z, draw: () => this.rider(p.x, p.y, size, r, now, r === rider) });
            }
        }
        if (state && state.length - this.cameraZ < 550) {
            const p = this.project(track, state.length);
            if (p) drawables.push({ z: p.z, draw: () => {
                const span = p.half * 2, unit = span / 24, top = p.y - span * .38;
                box(c, '#373c38', p.x - p.half, top, Math.max(1, unit * .45), span * .38); box(c, '#373c38', p.x + p.half, top, Math.max(1, unit * .45), span * .38);
                for (let a = 0; a < 24; a++) for (let b = 0; b < 2; b++) box(c, (a + b) % 2 ? '#242526' : '#eee9cf', p.x - p.half + a * unit, top + b * unit, unit + 1, unit + 1);
            } });
        }
        drawables.sort((a, b) => b.z - a.z); drawables.forEach(d => d.draw());
        c.restore();
        if (!home) this.renderMirrors(state, rider, now, track);
        this.impactPulse = Math.max(0, this.impactPulse - dt);
        this.frameCost = this.frameCost * .95 + (performance.now() - frameStart) * .05;
    }
    destroy() { this.observer.disconnect(); this.riderSprites.clear(); }
}
