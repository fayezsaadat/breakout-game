// core/game.js — application shell: owns the loop, the scene stack and the
// shared context (renderer / input / audio / particles / progress).

import { Renderer } from './render.js';
import { Input, bindDefaultActions } from './input.js';
import { AudioBus } from './audio.js';
import { Emitter } from './emitter.js';
import { Particles, FloatTexts } from '../game/particles.js';
import { loadSettings, saveSettings, loadProgress, saveProgress, loadCustomLevels, saveCustomLevels } from './storage.js';
import { MenuScene } from '../scenes/menu.js';
import { GameScene } from '../scenes/game.js';
import { EditorScene } from '../scenes/editor.js';
import { LEVELS, validateRows } from '../game/levels.js';

const VW = 960;
const VH = 640;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas, VW, VH);
    // Touch devices get fullscreen fake-landscape on portrait screens.
    this.coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.renderer.coarse = this.coarse;
    this.renderer.resize();
    this.input = new Input(canvas, VW, VH, this.renderer);
    this.audio = new AudioBus();
    this.particles = new Particles(1800);
    this.floats = new FloatTexts(120);
    this.events = new Emitter();

    this.settings = loadSettings();
    this.progress = loadProgress();
    this.progress.customLevels = loadCustomLevels();

    this.audio.setSfxVolume(this.settings.sfx);
    this.audio.setMusicVolume(this.settings.music);
    this.audio.setMuted(this.settings.muted);
    this.renderer.shakeScale = this.settings.screenShake ? 1 : 0;

    this.bindActions();
    this.bindEvents();
    this.bindWindow();

    this.scene = null;
    this._enterScenes = false;   // scenes only "enter" once the loop has started
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this.lastT = 0;
    this.started = false;

    this.setScene(new MenuScene(this));
  }

  // ------------------------------------------------------------------ wiring
  bindActions() {
    bindDefaultActions(this.input);
  }

  bindEvents() {
    const e = this.events;
    e.on('startRun', ({ levelId }) => {
      this.progress.sessionScore = 0;
      this.startLevel(levelId);
    });
    e.on('nextLevel', () => {
      const next = this.scene.levelId;
      const id = typeof next === 'string' ? LEVELS[0].id : (next % LEVELS.length) + 1;
      this.startLevel(id);
    });
    e.on('restartLevel', () => this.startLevel(this.scene.levelId));
    e.on('restartRun', () => {
      this.progress.sessionScore = 0;
      this.startLevel(this.lastRunLevel ?? 1);
    });
    e.on('exitToMenu', () => {
      this.progress.sessionScore = 0;
      this.setScene(new MenuScene(this));
    });
    e.on('openEditor', () => this.setScene(new EditorScene(this)));
    e.on('testLevel', ({ rows, name }) => {
      if (!validateRows(rows)) return;
      this.progress.sessionScore = 0;
      const scene = new GameScene(this, { levelId: 0, name, customRows: rows });
      this.lastRunLevel = null;
      this.setScene(scene);
    });

    e.on('levelComplete', ({ score, levelId }) => {
      const p = this.progress;
      p.sessionScore = score;
      p.highScore = Math.max(p.highScore, score);
      p.bestByLevel = p.bestByLevel || {};
      if (typeof levelId === 'number') {
        p.bestByLevel[levelId] = Math.max(p.bestByLevel[levelId] || 0, score);
        p.unlocked = Math.max(p.unlocked, Math.min(LEVELS.length, levelId + 1));
      }
      this.persistProgress();
    });

    e.on('gameOver', ({ score }) => {
      const p = this.progress;
      p.plays = (p.plays || 0) + 1;
      p.highScore = Math.max(p.highScore, score);
      p.sessionScore = 0;
      this.persistProgress();
    });
  }

  bindWindow() {
    // Audio needs a user gesture; hook the first one.
    const kick = () => {
      this.audio.resume();
      if (this.scene instanceof MenuScene) this.scene.enter();
      this.tryLandscapeFullscreen();
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
    window.addEventListener('pointerdown', kick);
    window.addEventListener('keydown', kick);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.scene instanceof GameScene && this.scene.state === 'playing') {
        this.scene.togglePause();
      }
    });
  }

  /** On touch devices: go fullscreen and lock landscape where the platform allows. */
  tryLandscapeFullscreen() {
    if (!this.coarse) return;
    try {
      const el = document.documentElement;
      const fs = el.requestFullscreen?.() || Promise.resolve();
      Promise.resolve(fs)
        .then(() => screen.orientation?.lock?.('landscape'))
        .catch(() => { /* iOS & friends: the rotated renderer covers us */ });
    } catch { /* rotated renderer covers us */ }
  }

  persistProgress() {
    const custom = this.progress.customLevels || [];
    saveProgress(this.progress);
    saveCustomLevels(custom);
  }

  startLevel(levelId) {
    this.lastRunLevel = levelId;
    this.setScene(new GameScene(this, { levelId }));
  }

  setScene(scene) {
    if (this.scene?.dispose) this.scene.dispose();
    this.particles.clear();
    this.floats.clear();
    this.scene = scene;
    this.canvas.classList.remove('ui-cursor');
    if (scene.enter && this._enterScenes) scene.enter();
    // Music itself is started by the scene's enter() — which only ever runs
    // after the first user gesture, so the AudioContext is never created early.
    if (scene instanceof GameScene) this.audio.setMusicPattern('play');
  }

  // ------------------------------------------------------------------ loop
  start() {
    if (this.started) return;
    this.started = true;
    this._enterScenes = true;
    this.lastT = performance.now();
    const frame = (t) => {
      requestAnimationFrame(frame);
      let dt = (t - this.lastT) / 1000;
      this.lastT = t;
      if (dt > 0.05) dt = 0.05;     // clamp after tab switches / hiccups
      this.tick(dt);
    };
    requestAnimationFrame(frame);
  }

  tick(dt) {
    // fps meter
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }

    this.handleGlobalKeys();
    this.renderer.begin(dt);
    this.scene.update(dt);
    this.scene.draw();
    this.drawOverlayMeta();
    this.renderer.end();
    this.input.endFrame();
  }

  handleGlobalKeys() {
    const i = this.input;
    if (i.pressed('appMute')) {
      this.settings.muted = !this.settings.muted;
      this.audio.setMuted(this.settings.muted);
      saveSettings(this.settings);
      if (!this.settings.muted) this.audio.sfx('ui');
    }
    if (i.pressed('fullscreen')) {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.().catch(() => {});
    }
  }

  drawOverlayMeta() {
    const r = this.renderer;
    r.ctx.save();
    r.ctx.globalAlpha = 0.55;
    r.text(`${this.fps} fps`, 24, 626, { size: 11, color: '#5f7199', align: 'left' });
    r.ctx.restore();
  }
}
