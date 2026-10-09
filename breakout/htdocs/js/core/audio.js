// core/audio.js — fully procedural sound + a tiny step sequencer.
// No audio files: every blip is synthesised on demand with WebAudio.

import { clamp, rand } from './math.js';

const NOTES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function freq(note) {
  // note like "A4", "C#3"
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(note);
  if (!m) return 440;
  let semi = NOTES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const oct = parseInt(m[3], 10);
  // A4 = 440Hz => midi 69
  const midi = (oct + 1) * 12 + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class AudioBus {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.sfxVol = 0.7;
    this.musicVol = 0.28;
    this._musicTimer = null;
    this._step = 0;
    this._pattern = null;
    this._nextNoteTime = 0;
    this._bpm = 104;
    this._voices = 0;
  }

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.sfxVol;
      // gentle limiter-ish compressor so stacked explosions don't clip
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.knee.value = 22;
      this.comp.ratio.value = 8;
      this.sfxBus.connect(this.comp);
      this.comp.connect(this.master);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVol;
      this.musicBus.connect(this.master);

      this.ready = true;
    } catch { /* audio unavailable — game still runs silent */ }
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setSfxVolume(v) { this.sfxVol = clamp(v, 0, 1); if (this.sfxBus) this.sfxBus.gain.value = this.sfxVol; }
  setMusicVolume(v) { this.musicVol = clamp(v, 0, 1); if (this.musicBus) this.musicBus.gain.value = this.musicVol; }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.9; }

  // ---------- primitives ----------
  _env(node, t0, a, d, peak) {
    const g = node.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  tone({ f = 440, f2 = null, type = 'square', dur = 0.12, gain = 0.3, delay = 0, detune = 0, bus = 'sfx' }) {
    if (!this.ready || this.muted || this._voices > 24) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t0);
    if (detune) osc.detune.setValueAtTime(detune, t0);
    if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    this._env(g, t0, Math.min(0.02, dur * 0.25), dur, gain);
    osc.connect(g);
    g.connect(bus === 'music' ? this.musicBus : this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    this._voices++;
    osc.onended = () => { this._voices--; osc.disconnect(); g.disconnect(); };
  }

  noise({ dur = 0.2, gain = 0.3, filter = 1200, q = 1, type = 'lowpass', delay = 0, sweepTo = null }) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bq = ctx.createBiquadFilter();
    bq.type = type;
    bq.frequency.setValueAtTime(filter, t0);
    bq.Q.value = q;
    if (sweepTo) bq.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bq); bq.connect(g); g.connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // ---------- game SFX ----------
  sfx(name, param = 0) {
    if (!this.ready || this.muted) return;
    switch (name) {
      case 'wall':
        this.tone({ f: 300, f2: 240, type: 'triangle', dur: 0.05, gain: 0.16 });
        break;
      case 'paddle':
        this.tone({ f: 220 + param * 90, f2: 480 + param * 120, type: 'triangle', dur: 0.09, gain: 0.26 });
        this.noise({ dur: 0.05, gain: 0.08, filter: 2600, type: 'highpass' });
        break;
      case 'brick':
        this.tone({ f: 420 + param * 60, f2: 620 + param * 60, type: 'square', dur: 0.07, gain: 0.17 });
        this.noise({ dur: 0.08, gain: 0.1, filter: 3200, sweepTo: 900, type: 'lowpass' });
        break;
      case 'armor':
        this.tone({ f: 180, f2: 120, type: 'sawtooth', dur: 0.09, gain: 0.16 });
        this.noise({ dur: 0.09, gain: 0.12, filter: 900, type: 'bandpass', q: 3 });
        break;
      case 'steel':
        this.tone({ f: 140, type: 'square', dur: 0.05, gain: 0.12 });
        this.noise({ dur: 0.05, gain: 0.1, filter: 4200, type: 'highpass' });
        break;
      case 'break':
        this.tone({ f: 660, f2: 1180, type: 'triangle', dur: 0.13, gain: 0.2 });
        this.noise({ dur: 0.16, gain: 0.13, filter: 2600, sweepTo: 600, type: 'lowpass' });
        break;
      case 'explode':
        this.noise({ dur: 0.42, gain: 0.4, filter: 900, sweepTo: 120, type: 'lowpass', q: 0.7 });
        this.tone({ f: 120, f2: 40, type: 'sine', dur: 0.35, gain: 0.35 });
        break;
      case 'laser':
        this.tone({ f: 900, f2: 320, type: 'sawtooth', dur: 0.07, gain: 0.12 });
        break;
      case 'laserHit':
        this.noise({ dur: 0.06, gain: 0.12, filter: 3000, type: 'highpass' });
        break;
      case 'powerup':
        [0, 4, 7, 12].forEach((s, i) =>
          this.tone({ f: freq('C5') * Math.pow(2, s / 12), type: 'triangle', dur: 0.14, gain: 0.16, delay: i * 0.045 }));
        break;
      case 'bad':
        this.tone({ f: 220, f2: 90, type: 'sawtooth', dur: 0.3, gain: 0.22 });
        break;
      case 'lifeLost':
        [0, -3, -7, -12].forEach((s, i) =>
          this.tone({ f: freq('A4') * Math.pow(2, s / 12), type: 'triangle', dur: 0.26, gain: 0.2, delay: i * 0.1 }));
        this.noise({ dur: 0.5, gain: 0.14, filter: 700, sweepTo: 120, type: 'lowpass' });
        break;
      case 'levelWin':
        [0, 4, 7, 12, 16].forEach((s, i) =>
          this.tone({ f: freq('C5') * Math.pow(2, s / 12), type: 'square', dur: 0.22, gain: 0.16, delay: i * 0.09 }));
        break;
      case 'gameOver':
        [0, -5, -9, -14].forEach((s, i) =>
          this.tone({ f: freq('D4') * Math.pow(2, s / 12), type: 'sawtooth', dur: 0.4, gain: 0.18, delay: i * 0.16 }));
        break;
      case 'ui':
        this.tone({ f: 620, f2: 820, type: 'triangle', dur: 0.05, gain: 0.1 });
        break;
      case 'select':
        this.tone({ f: 880, f2: 1320, type: 'square', dur: 0.08, gain: 0.12 });
        break;
    }
  }

  // ---------- music: 16-step arpeggio + bass, scheduled ahead of time ----------
  startMusic(pattern = 'play') {
    this.init();
    if (!this.ready) return;
    this._pattern = pattern;
    if (this._musicTimer) return;
    this._step = 0;
    this._nextNoteTime = this.ctx.currentTime + 0.1;
    this._musicTimer = setInterval(() => this._schedule(), 25);
  }

  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  }

  setMusicPattern(p) { this._pattern = p; }

  _schedule() {
    if (!this.ready || this.muted || !this._pattern) return;
    const spb = 60 / this._bpm / 2; // eighth notes
    while (this._nextNoteTime < this.ctx.currentTime + 0.25) {
      this._playStep(this._step, this._nextNoteTime);
      this._nextNoteTime += spb;
      this._step = (this._step + 1) % 16;
    }
  }

  _playStep(step, t) {
    const ctx = this.ctx;
    const dur = 0.16;
    const play = (note, type, gain, detune = 0) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq(note);
      osc.detune.value = detune;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(this.musicBus);
      osc.start(t); osc.stop(t + dur + 0.03);
      osc.onended = () => { osc.disconnect(); g.disconnect(); };
    };

    const minor = ['A3', 'C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'E5'];
    const menu = ['D3', 'F3', 'A3', 'D4', 'F4', 'A4', 'C5', 'D5'];
    const scale = this._pattern === 'menu' ? menu : minor;
    const bass = this._pattern === 'menu' ? ['D2', 'D2', 'A2', 'A2'] : ['A2', 'A2', 'G2', 'F2'];

    if (step % 2 === 0) {
      play(bass[(step / 4) | 0], 'triangle', 0.32);
    }
    if (this._pattern === 'play') {
      const n = scale[(step * 3 + ((step / 8) | 0)) % scale.length];
      play(n, 'square', 0.075, rand.range(-6, 6));
      if (step % 4 === 2) play(scale[(step + 2) % scale.length], 'square', 0.05, 6);
    } else if (step % 4 === 0) {
      play(scale[(step / 2) % scale.length], 'triangle', 0.09);
    }
    // hi-hat
    if (step % 2 === 1) {
      const len = Math.floor(ctx.sampleRate * 0.03);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      src.connect(hp); hp.connect(g); g.connect(this.musicBus);
      src.start(t); src.stop(t + 0.04);
    }
  }
}
