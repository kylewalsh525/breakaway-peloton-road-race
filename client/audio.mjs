/** Original synthesized score and sound effects; no licensed recordings or runtime downloads. */
export class ArcadeAudio {
    constructor() { this.ctx = null; this.volume = .12; this.enabled = false; this.duck = false; this.step = 0; this.timer = null; this.music = false; }
    async enable() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC)
                return false;
            this.ctx = new AC();
            this.master = this.ctx.createGain();
            this.master.connect(this.ctx.destination);
        }
        await this.ctx.resume();
        this.enabled = true;
        this.update();
        return true;
    }
    update() { if (this.master)
        this.master.gain.setTargetAtTime(this.enabled ? this.volume * (this.duck ? .23 : 1) : 0, this.ctx.currentTime, .05); }
    setEnabled(value) { this.enabled = value; this.update(); }
    setDucked(value) { this.duck = value; this.update(); }
    tone(freq, duration = .15, type = 'sine', gain = .25, slide = null, when = 0) { if (!this.ctx || !this.enabled)
        return; const t = this.ctx.currentTime + when, o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t); if (slide)
        o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + duration); g.gain.setValueAtTime(.001, t); g.gain.linearRampToValueAtTime(gain, t + .008); g.gain.exponentialRampToValueAtTime(.001, t + duration); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + duration + .03); }
    noise(duration = .13, gain = .3) { if (!this.ctx || !this.enabled)
        return; const n = Math.floor(this.ctx.sampleRate * duration), buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), a = buf.getChannelData(0); for (let i = 0; i < n; i++)
        a[i] = (Math.random() * 2 - 1) * (1 - i / n); const src = this.ctx.createBufferSource(), g = this.ctx.createGain(); src.buffer = buf; g.gain.value = gain; src.connect(g); g.connect(this.master); src.start(); }
    effect(type) {
        if (type === 'hit' || type === 'obstacle') {
            this.noise(.12, .7);
            this.tone(110, .14, 'triangle', .8, 40);
        }
        else if (type === 'crash') {
            this.noise(.55, .6);
            this.tone(90, .55, 'sawtooth', .2, 20);
        }
        else if (type === 'boost') {
            this.tone(140, .5, 'sawtooth', .14, 740);
            this.tone(210, .6, 'triangle', .2, 1100);
        }
        else if (type === 'pickup') {
            [440, 660, 880].forEach((f, i) => this.tone(f, .12, 'triangle', .35, null, i * .07));
        }
        else if (type === 'parry' || type === 'block') {
            this.tone(880, .13, 'sine', .35);
            this.tone(1320, .18, 'sine', .2, null, .06);
        }
        else if (type === 'finish') {
            [392, 494, 587, 784].forEach((f, i) => this.tone(f, .35, 'triangle', .4, null, i * .12));
        }
        else if (type === 'start') {
            this.tone(880, .3, 'triangle', .5);
        }
        else if (type === 'tick')
            this.tone(440, .08, 'sine', .35);
        else if (type === 'command')
            this.tone(660, .045, 'sine', .12);
    }
    startMusic() {
        if (this.timer)
            return;
        this.music = true;
        const roots = [110, 110, 130.81, 98], notes = [0, 7, 12, 10, 7, 3, 5, 7];
        this.timer = setInterval(() => {
            if (!this.music)
                return;
            const k = this.step++, root = roots[Math.floor(k / 32) % 4];
            if (k % 4 === 0)
                this.tone(root, .22, 'triangle', .27);
            if (k % 8 === 0)
                this.tone(90, .13, 'sine', .5, 35);
            if (k % 4 === 2)
                this.noise(.055, .12);
            if (k % 2 === 0)
                this.tone(root * 4 * 2 ** (notes[Math.floor(k / 2) % 8] / 12), .1, 'triangle', .075);
        }, 60000 / 112 / 4);
    }
    stopMusic() { this.music = false; if (this.timer)
        clearInterval(this.timer); this.timer = null; }
}
