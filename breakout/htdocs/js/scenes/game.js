// scenes/game.js — the play scene: grid, physics, collisions, power-ups, HUD.

import { clamp, clamp01, rand, TAU, sweepCircleAABB, sweepAABB, faNum } from '../core/math.js';
import { Brick } from '../game/brick.js';
import { Paddle, PADDLE_BASE_W } from '../game/paddle.js';
import { Ball, BALL_STATE, SPEED_MIN, SPEED_MAX, SPEED_START } from '../game/ball.js';
import { PowerUp, Bolt, POWERUPS, rollPowerup, drawPowerIcon } from '../game/powerups.js';
import { BRICK_KIND, getLevel } from '../game/levels.js';
import { uiScale } from '../core/ui.js';

export const FIELD = { left: 44, right: 916, top: 80, bottom: 596 };
const COLS = 16;
const BRICK_W = 52;
const BRICK_H = 30;
const GAP = 4;
const GRID_X = FIELD.left + 10;
const GRID_Y = FIELD.top + 20;
const PADDLE_Y = 552;

const MAX_BALLS = 6;
const COMBO_WINDOW = 2.6;

export class GameScene {
  constructor(ctx, opts = {}) {
    this.c = ctx;
    this.r = ctx.renderer;
    this.input = ctx.input;
    this.audio = ctx.audio;
    this.particles = ctx.particles;
    this.floats = ctx.floats;
    this.rng = rand;

    this.level = getLevel(ctx.progress, opts.levelId ?? 1);
    this.levelId = this.level.id;
    if (opts.customRows) this.level = { ...this.level, rows: opts.customRows, name: opts.name || this.level.name };

    this.state = 'ready';      // ready | playing | levelComplete | gameOver | paused
    this.prevState = null;
    this.time = 0;
    this.elapsed = 0;
    this.timeScale = 1;

    // grid
    this.bricks = [];
    this.grid = new Map();     // "col,row" -> Brick
    this.buildLevel(this.level.rows);

    // actors
    this.paddle = new Paddle((FIELD.left + FIELD.right) / 2, PADDLE_Y, { left: FIELD.left + 6, right: FIELD.right - 6 });
    this.balls = [];
    this.powerups = [];
    this.bolts = [];
    this.newBall();

    // meta
    this.score = ctx.progress.sessionScore ?? 0;
    this.lives = 3;
    this.combo = 0;
    this.comboTimer = 0;
    this.multiplier = 1;
    this.effects = new Map();  // type -> remaining seconds
    this.bombQueue = [];
    this.laserCd = 0;
    this.freeze = 0;
    this.stats = { bricksBroken: 0, paddleHits: 0, powerups: 0, maxCombo: 0, startTime: performance.now() };
    this.bg = makeStarfield(this.rng, 90);
    this.message = null;       // { text, t, max, color }
    this.bannerT = 0;
  }

  enter() {
    this.audio.setMusicPattern('play');
    this.audio.startMusic('play');
  }

  // ------------------------------------------------------------------ setup
  buildLevel(rows) {
    this.bricks = [];
    this.grid.clear();
    rows.forEach((row, r) => {
      for (let c = 0; c < COLS; c++) {
        const code = row[c];
        if (!code || code === '.') continue;
        const x = GRID_X + c * BRICK_W + GAP / 2;
        const y = GRID_Y + r * (BRICK_H + GAP) + GAP / 2;
        const b = new Brick(code, x, y, BRICK_W - GAP, BRICK_H - GAP);
        b.spawnT = 0;
        this.bricks.push(b);
        this.grid.set(`${c},${r}`, b);
      }
    });
    this.totalBreakable = this.bricks.filter((b) => b.breakable).length;
    // stagger the intro animation from the middle outwards
    const mid = (FIELD.left + FIELD.right) / 2;
    this.bricks.forEach((b) => { b.spawnT = -Math.abs(b.cx - mid) / 1400; });
  }

  newBall() {
    const b = new Ball(this.paddle.cx, this.paddle.y - 12);
    b.state = BALL_STATE.STUCK;
    this.balls.push(b);
    return b;
  }

  get remaining() { return this.bricks.filter((b) => b.alive && b.breakable).length; }

  // ------------------------------------------------------------------ input
  get pauseBtn() { return { x: 206, y: 15, w: 46, h: 46 }; }

  handleInput(dt) {
    const inp = this.input;

    // on-screen pause button (touch devices have no Esc key)
    if (this.c.coarse) {
      const b = this.pauseBtn;
      if (inp.pointer.pressed &&
          inp.pointer.x >= b.x && inp.pointer.x <= b.x + b.w &&
          inp.pointer.y >= b.y && inp.pointer.y <= b.y + b.h) {
        this.togglePause();
        return;
      }
    }

    if (inp.pressed('pause') && (this.state === 'playing' || this.state === 'paused' || this.state === 'ready')) {
      this.togglePause();
      return;
    }
    if (this.state === 'paused') {
      if (inp.pressed('restart')) {
        this.audio.sfx('select');
        this.c.events.emit('restartLevel');
        return;
      }
      if (inp.pressed('confirm') || inp.pointer.pressed) this.togglePause();
      return;
    }
    if (this.state !== 'playing' && this.state !== 'ready') return;

    // paddle: pointer takes priority, keyboard assists
    if (inp.pointer.active) this.paddle.moveTo(inp.pointer.x);
    const axis = inp.axis('left', 'right');
    if (axis !== 0) this.paddle.nudge(axis, dt, 980);

    if (this.state === 'ready') {
      if (inp.pressed('fire') || inp.pointer.pressed) {
        this.state = 'playing';
        this.banner('شروع!', 0.8);
        for (const b of this.balls) if (b.state === BALL_STATE.STUCK) b.launch();
        this.audio.sfx('select');
      }
      return;
    }

    if (this.paddle.laser && inp.held('fire') && this.laserCd <= 0) {
      this.laserCd = 0.19;
      for (const dx of [-this.paddle.w / 2 + 6, this.paddle.w / 2 - 6]) {
        this.bolts.push(new Bolt(this.paddle.cx + dx, this.paddle.y - 6));
      }
      this.audio.sfx('laser');
    }
  }

  /** Input for the level-complete / game-over overlays. */
  updateEndState() {
    const inp = this.input;
    if (this.time < 0.35) return; // ignore the key that ended the level
    if (inp.pressed('pause')) {
      this.audio.sfx('ui');
      this.c.events.emit('exitToMenu');
      return;
    }
    if (inp.pressed('restart')) {
      this.audio.sfx('select');
      this.c.events.emit('restartLevel');
      return;
    }
    if (this.state === 'levelComplete' && (inp.pressed('confirm') || inp.pointer.pressed)) {
      this.audio.sfx('select');
      this.c.events.emit('nextLevel');
    } else if (this.state === 'gameOver' && (inp.pressed('confirm') || inp.pointer.pressed)) {
      this.audio.sfx('select');
      this.c.events.emit('restartRun');
    }
  }

  togglePause() {
    if (this.state === 'paused') {
      this.state = this.prevState || 'playing';
      this.audio.setMusicPattern('play');
    } else {
      this.prevState = this.state;
      this.state = 'paused';
      this.audio.setMusicPattern('menu');
    }
    this.audio.sfx('ui');
  }

  banner(text, dur = 1.2, color = '#ffd166') {
    this.message = { text, t: dur, max: dur, color };
  }

  /** Is a timed power-up currently active? */
  has(type) { return this.effects.has(type); }

  // ------------------------------------------------------------------ update
  update(dt) {
    this.time += dt;
    // Input must run while paused too — it owns the resume/pause toggles.
    this.handleInput(dt);
    if (this.state === 'paused') return;

    const scale = this.has('slowmo') ? 0.45 : 1;
    const sdt = dt * scale;
    this.timeScale = scale;

    if (this.message) {
      this.message.t -= dt;
      if (this.message.t <= 0) this.message = null;
    }

    if (this.state === 'levelComplete' || this.state === 'gameOver') {
      this.particles.update(dt);
      this.floats.update(dt);
      this.paddle.update(dt);
      this.updateEndState();
      return;
    }

    this.elapsed += sdt;
    if (this.laserCd > 0) this.laserCd -= dt;

    // power-up timers
    for (const [type, t] of [...this.effects]) {
      const nt = t - sdt;
      if (nt <= 0) { this.effects.delete(type); this.onEffectEnd(type); }
      else this.effects.set(type, nt);
    }

    this.paddle.update(dt);

    // bombs resolve on a short fuse so chains read visually
    if (this.bombQueue.length) {
      const q = this.bombQueue;
      this.bombQueue = [];
      for (const b of q) this.detonate(b);
    }

    if (this.state === 'playing') {
      this.updateBalls(sdt);
      this.updateBolts(sdt);
      this.updatePowerups(sdt);
      this.updateCombo(sdt);
    } else {
      // ready: balls glued to the paddle
      for (const b of this.balls) { b.x = this.paddle.cx; b.y = this.paddle.y - 12; b.update(sdt); }
    }

    for (const b of this.bricks) if (b.alive) b.update(dt, this.time);
    this.particles.update(dt);
    this.floats.update(dt);
  }

  updateCombo(dt) {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    this.multiplier = Math.min(8, 1 + Math.floor(this.combo / 4));
  }

  // ------------------------------------------------------------------ balls
  updateBalls(dt) {
    const pbox = this.paddle.box;

    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i];
      if (ball.state === BALL_STATE.STUCK) {
        ball.x = this.paddle.cx;
        ball.y = this.paddle.y - ball.r - 2;
        ball.update(dt);
        continue;
      }

      let dx = ball.vx * dt, dy = ball.vy * dt;

      // --- swept pass against walls, bricks and paddle; resolve nearest first
      for (let guard = 0; guard < 4 && (dx !== 0 || dy !== 0); guard++) {
        let best = null;

        // walls
        const wallHits = [];
        if (dx < 0) {
          const t = (FIELD.left + ball.r - ball.x) / dx;
          if (t >= 0 && t <= 1) wallHits.push({ t, axis: 'x', sign: 1 });
        } else if (dx > 0) {
          const t = (FIELD.right - ball.r - ball.x) / dx;
          if (t >= 0 && t <= 1) wallHits.push({ t, axis: 'x', sign: -1 });
        }
        if (dy < 0) {
          const t = (FIELD.top + ball.r - ball.y) / dy;
          if (t >= 0 && t <= 1) wallHits.push({ t, axis: 'y', sign: 1 });
        }
        for (const w of wallHits) if (!best || w.t < best.t) best = { ...w, type: 'wall' };

        // bricks
        for (const brick of this.bricks) {
          if (!brick.alive || brick.spawnT < 0.6) continue;
          const hit = sweepCircleAABB(ball.x, ball.y, ball.r, dx, dy, brick.box);
          if (hit && (!best || hit.t < best.t)) best = { ...hit, type: 'brick', brick };
        }

        // paddle (only while descending)
        if (dy > 0) {
          const hit = sweepCircleAABB(ball.x, ball.y, ball.r, dx, dy, pbox);
          if (hit && (!best || hit.t < best.t)) best = { ...hit, type: 'paddle' };
        }

        if (!best) { ball.x += dx; ball.y += dy; break; }

        const stepT = Math.max(0, best.t - 1e-4);
        ball.x += dx * stepT;
        ball.y += dy * stepT;
        dx -= dx * stepT;
        dy -= dy * stepT;

        if (best.type === 'wall') {
          ball.reflect(best.axis, best.sign);
          this.audio.sfx('wall');
          this.particles.burst(ball.x, ball.y, best.axis === 'x' ? best.sign : 0, best.axis === 'y' ? best.sign : 0, '#6fa8ff', 5, 1.4, 150);
        } else if (best.type === 'paddle') {
          this.onPaddleHit(ball, best);
        } else if (best.type === 'brick') {
          this.onBrickHit(ball, best.brick, best);
        }

        ball.nudgeOutOfHorizontal();
        const sp = Math.hypot(ball.vx, ball.vy);
        if (sp > 0) { ball.vx = (ball.vx / sp) * ball.speed; ball.vy = (ball.vy / sp) * ball.speed; }
      }

      ball.update(dt);

      // bottom edge
      if (ball.y - ball.r > FIELD.bottom) {
        if (this.paddle.shield) {
          this.paddle.shield = false;
          this.effects.delete('shield');
          ball.y = FIELD.bottom - ball.r - 2;
          ball.reflect('y', -1);
          this.audio.sfx('powerup');
          this.particles.ring(ball.x, FIELD.bottom, '#06d6a0', 14, 0.5);
          this.floats.spawn('سپر!', ball.x, FIELD.bottom - 30, { color: '#06d6a0', size: 20 });
        } else {
          ball.alive = false;
        }
      }
    }

    const lost = this.balls.filter((b) => !b.alive);
    if (lost.length) {
      this.balls = this.balls.filter((b) => b.alive);
      for (const b of lost) {
        this.particles.spark(b.x, FIELD.bottom - 6, '#ff5d8f', 16, 300, 0.6);
        this.particles.smoke(b.x, FIELD.bottom - 6, '#ff5d8f', 6);
      }
      this.r.shake(7);
      if (this.balls.length === 0) this.loseLife();
    }

    if (this.state === 'playing' && this.remaining === 0) this.completeLevel();
  }

  onPaddleHit(ball, hit) {
    const offset = (ball.x - this.paddle.cx) / (this.paddle.w / 2);
    ball.bounceOffPaddle(offset, this.paddle.vx);
    ball.y = Math.min(ball.y, this.paddle.y - ball.r - 0.5);
    this.paddle.hit();
    this.stats.paddleHits++;
    this.audio.sfx('paddle', clamp(Math.abs(offset), 0, 1));
    this.particles.burst(ball.x, this.paddle.y, 0, -1, '#9fe8ff', 9, 1.6, 240);

    if (this.paddle.sticky) {
      ball.state = BALL_STATE.STUCK;
      ball.vx = 0; ball.vy = 0;
      this.audio.sfx('ui');
    }
    this.combo = 0; // paddle touch resets the chain — rewards long volleys
  }

  onBrickHit(ball, brick, hit) {
    ball.reflect(hit.axis, hit.sign);
    // push clear of the surface so the next substep can't re-hit
    if (hit.axis === 'x') ball.x += hit.sign * 0.6; else ball.y += hit.sign * 0.6;
    this.damageBrick(brick, 1, ball.x, ball.y, hit);
  }

  /**
   * @param {boolean} laser — laser bolts are the only thing that cuts steel.
   */
  damageBrick(brick, amount, px, py, hit = null, laser = false) {
    if (!brick.alive) return;
    if (brick.kind === BRICK_KIND.STEEL && laser) brick.hp = 0;
    const res = brick.damage(amount);
    const colors = [brick.def.top, brick.def.bottom, brick.def.edge];

    if (res === 'immune') {
      this.audio.sfx('steel');
      this.particles.burst(px ?? brick.cx, py ?? brick.cy, hit?.axis === 'x' ? hit.sign : 0, hit?.axis === 'y' ? hit.sign : 0, '#d7e3f7', 8, 1.2, 260);
      this.r.shake(2);
      return;
    }
    if (res === 'damaged') {
      this.audio.sfx('armor');
      this.particles.spark(px ?? brick.cx, py ?? brick.cy, colors[1], 8, 220, 0.35);
      this.r.shake(1.6);
      return;
    }

    // broken
    this.stats.bricksBroken++;
    this.combo++;
    this.comboTimer = COMBO_WINDOW;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
    const mult = Math.min(8, 1 + Math.floor(this.combo / 4));
    const pts = brick.def.score * mult;
    this.addScore(pts, brick.cx, brick.cy, mult > 1 ? `×${faNum(mult)}` : null);

    this.audio.sfx(brick.kind === BRICK_KIND.BOMB ? 'explode' : 'break');
    this.particles.shards(brick.cx, brick.cy, brick.w, brick.h, colors, brick.kind === BRICK_KIND.BOMB ? 20 : 12);
    this.particles.ring(brick.cx, brick.cy, colors[0], 8, 0.32);
    this.r.shake(brick.kind === BRICK_KIND.BOMB ? 6 : 2.4);

    if (brick.kind === BRICK_KIND.BOMB) this.bombQueue.push(brick);
    if (this.rng.chance(brick.def.drop)) this.spawnPowerup(brick.cx, brick.cy);
  }

  /** Explosion: damages everything in radius, chains through other bombs. */
  detonate(source) {
    const R = 96;
    this.audio.sfx('explode');
    this.particles.ring(source.cx, source.cy, '#ffb454', 10, 0.5);
    this.particles.spark(source.cx, source.cy, '#ffd166', 26, 420, 0.7);
    this.particles.smoke(source.cx, source.cy, '#ff8a5c', 10);
    this.r.shake(9);

    const targets = this.bricks.filter((b) => b.alive && Math.hypot(b.cx - source.cx, b.cy - source.cy) <= R && b !== source);
    for (const b of targets) {
      const dmg = b.kind === BRICK_KIND.STEEL ? 0 : 2;
      const wasBomb = b.kind === BRICK_KIND.BOMB;
      this.damageBrick(b, Math.max(1, dmg), b.cx, b.cy);
      if (wasBomb && b.alive) { /* chain handled by damageBrick */ }
    }
  }

  // ------------------------------------------------------------------ bolts
  updateBolts(dt) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];
      const dy = bolt.vy * dt;
      let hitBrick = null, bestT = 2;
      for (const brick of this.bricks) {
        if (!brick.alive || brick.spawnT < 0.6) continue;
        const hit = sweepAABB(bolt.x - bolt.w / 2, bolt.y - bolt.h, bolt.w, bolt.h, 0, dy, brick.box);
        if (hit && hit.t < bestT) { bestT = hit.t; hitBrick = brick; }
      }
      if (hitBrick) {
        bolt.y += dy * bestT;
        this.damageBrick(hitBrick, 1, bolt.x, bolt.y, { axis: 'y', sign: 1 }, true);
        this.audio.sfx('laserHit');
        this.particles.spark(bolt.x, bolt.y, '#ffd166', 6, 200, 0.3);
        bolt.alive = false;
      } else {
        bolt.update(dt);
        if (bolt.y < FIELD.top) bolt.alive = false;
      }
      if (!bolt.alive) this.bolts.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------ power-ups
  spawnPowerup(x, y) {
    this.powerups.push(new PowerUp(rollPowerup(this.rng), x, y));
  }

  updatePowerups(dt) {
    const pbox = this.paddle.box;
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i];
      pu.update(dt);
      if (pu.box.overlaps(pbox)) {
        this.applyPowerup(pu.type);
        this.powerups.splice(i, 1);
        continue;
      }
      if (pu.y > FIELD.bottom + 30) this.powerups.splice(i, 1);
    }
  }

  applyPowerup(type) {
    const def = POWERUPS[type];
    this.stats.powerups++;
    this.audio.sfx(def.good ? 'powerup' : 'bad');
    this.floats.spawn(def.label, this.paddle.cx, this.paddle.y - 40, { color: def.color, size: 22 });
    this.particles.stars(this.paddle.cx, this.paddle.y, 14, def.color);
    this.r.shake(3);

    switch (type) {
      case 'wide':
        this.effects.set('wide', def.dur); this.effects.delete('narrow');
        this.paddle.setWidth(PADDLE_BASE_W * 1.6);
        break;
      case 'narrow':
        this.effects.set('narrow', def.dur); this.effects.delete('wide');
        this.paddle.setWidth(PADDLE_BASE_W * 0.62);
        break;
      case 'multi': {
        const src = this.balls.find((b) => b.state === BALL_STATE.FLYING) || this.balls[0];
        const add = Math.min(2, MAX_BALLS - this.balls.length);
        for (let i = 0; i < add; i++) {
          const nb = new Ball(src.x, src.y);
          nb.speed = src.speed;
          nb.state = src.state;
          if (nb.state === BALL_STATE.FLYING) nb.setAngle(src.angle + (i % 2 ? 0.5 : -0.5));
          this.balls.push(nb);
        }
        break;
      }
      case 'laser': this.effects.set('laser', def.dur); this.paddle.laser = true; break;
      case 'sticky': this.effects.set('sticky', def.dur); this.paddle.sticky = true; break;
      case 'shield': this.paddle.shield = true; break;
      case 'life': this.lives = Math.min(6, this.lives + 1); break;
      case 'slow': this.effects.set('slow', def.dur); this.effects.delete('fast'); this.scaleBalls(0.78); break;
      case 'fast': this.effects.set('fast', def.dur); this.effects.delete('slow'); this.scaleBalls(1.28); break;
      case 'slowmo': this.effects.set('slowmo', def.dur); break;
    }
  }

  onEffectEnd(type) {
    switch (type) {
      case 'wide':
      case 'narrow':
        if (!this.effects.has('wide') && !this.effects.has('narrow')) this.paddle.setWidth(PADDLE_BASE_W);
        break;
      case 'laser': this.paddle.laser = false; break;
      case 'sticky': this.paddle.sticky = false; break;
      case 'slow':
      case 'fast':
        if (!this.effects.has('slow') && !this.effects.has('fast')) {
          for (const b of this.balls) b.setSpeed(SPEED_START + Math.min(200, this.elapsed * 4));
        }
        break;
    }
  }

  scaleBalls(k) {
    for (const b of this.balls) b.setSpeed(b.speed * k);
  }

  // ------------------------------------------------------------------ flow
  addScore(pts, x, y, tag) {
    this.score += pts;
    this.floats.spawn(faNum(pts) + (tag ? ' ' + tag : ''), x, y, {
      color: tag ? '#ff5d8f' : '#ffd166',
      size: tag ? 24 : 20,
    });
  }

  loseLife() {
    this.lives--;
    this.audio.sfx('lifeLost');
    this.r.shake(12);
    this.combo = 0;
    this.paddle.setWidth(PADDLE_BASE_W);
    this.effects.clear();
    this.paddle.laser = false;
    this.paddle.sticky = false;
    this.paddle.shield = false;      // the shield is consumed by the miss that cost the life
    this.powerups.length = 0;
    this.bolts.length = 0;
    for (const b of this.balls) b.setSpeed(SPEED_START);

    if (this.lives <= 0) {
      this.state = 'gameOver';
      this.audio.setMusicPattern('menu');
      this.c.events.emit('gameOver', { score: this.score, levelId: this.levelId, stats: this.stats });
      this.banner('باختی!', 2, '#ff5d8f');
      return;
    }
    this.state = 'ready';
    this.banner(`${faNum(this.lives)} جان باقی‌مانده`, 1.4, '#ff5d8f');
    this.newBall();
  }

  completeLevel() {
    this.state = 'levelComplete';
    const timeBonus = Math.max(0, Math.round(3000 - this.elapsed * 12));
    const lifeBonus = this.lives * 300;
    const clearBonus = 500;
    this.bonuses = { timeBonus, lifeBonus, clearBonus };
    this.score += timeBonus + lifeBonus + clearBonus;
    this.audio.sfx('levelWin');
    this.audio.setMusicPattern('menu');
    this.r.shake(6);
    for (let i = 0; i < 5; i++) {
      this.particles.stars(rand.range(FIELD.left, FIELD.right), rand.range(140, 420), 12, i % 2 ? '#4cc9f0' : '#ffd166');
    }
    this.c.events.emit('levelComplete', { score: this.score, levelId: this.levelId, bonuses: this.bonuses });
  }

  // ------------------------------------------------------------------ draw
  draw() {
    const r = this.r;
    this.drawBackground(r);
    this.drawWalls(r);
    for (const b of this.bricks) if (b.alive) b.draw(r, this.time);
    for (const bolt of this.bolts) bolt.draw(r);
    this.paddle.draw(r, this.time);
    for (const pu of this.powerups) pu.draw(r, this.time);
    for (const b of this.balls) b.draw(r, this.time);
    this.particles.draw(r);
    this.floats.draw(r);
    this.drawHUD(r);
    if (this.message) this.drawBanner(r);

    if (this.state === 'paused') this.drawPause(r);
    if (this.state === 'levelComplete') this.drawLevelComplete(r);
    if (this.state === 'gameOver') this.drawGameOver(r);
  }

  drawBackground(r) {
    const { ctx } = r;
    const g = r.gradient(0, 0, 0, 640, [[0, '#0a1128'], [0.6, '#070c1a'], [1, '#0b0716']]);
    r.rect(-20, -20, 1000, 680, g);

    // starfield with slow parallax drift
    ctx.save();
    for (const s of this.bg) {
      const y = (s.y + this.time * s.speed * 12) % 660;
      ctx.globalAlpha = s.a * (0.5 + 0.5 * Math.sin(this.time * 2 + s.ph));
      ctx.fillStyle = s.c;
      ctx.fillRect(s.x, y, s.s, s.s);
    }
    ctx.restore();

    // neon grid
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = '#4cc9f0';
    ctx.lineWidth = 1;
    for (let x = FIELD.left; x <= FIELD.right; x += 32) { ctx.beginPath(); ctx.moveTo(x, FIELD.top); ctx.lineTo(x, FIELD.bottom); ctx.stroke(); }
    for (let y = FIELD.top; y <= FIELD.bottom; y += 32) { ctx.beginPath(); ctx.moveTo(FIELD.left, y); ctx.lineTo(FIELD.right, y); ctx.stroke(); }
    ctx.restore();
  }

  drawWalls(r) {
    const { ctx } = r;
    const t = 10;
    ctx.save();
    ctx.shadowColor = '#4cc9f0';
    ctx.shadowBlur = 14;
    const g = r.gradient(0, FIELD.top, 0, FIELD.bottom, [[0, '#2a4f80'], [1, '#12233f']]);
    r.rect(FIELD.left - t, FIELD.top - t, t, FIELD.bottom - FIELD.top + t, g);
    r.rect(FIELD.right, FIELD.top - t, t, FIELD.bottom - FIELD.top + t, g);
    r.rect(FIELD.left - t, FIELD.top - t, FIELD.right - FIELD.left + t * 2, t, g);
    ctx.restore();

    // danger line at the bottom
    ctx.save();
    ctx.globalAlpha = 0.28 + 0.12 * Math.sin(this.time * 3);
    ctx.strokeStyle = '#ff5d8f';
    ctx.setLineDash([14, 10]);
    ctx.lineWidth = 2;
    ctx.lineDashOffset = this.time * 26;
    ctx.beginPath();
    ctx.moveTo(FIELD.left, FIELD.bottom);
    ctx.lineTo(FIELD.right, FIELD.bottom);
    ctx.stroke();
    ctx.restore();
  }

  drawHUD(r) {
    const { ctx } = r;
    const k = uiScale(r.scale, this.c.coarse);   // legibility on small screens
    r.rect(0, 0, 960, FIELD.top - 6, 'rgba(7,11,24,.82)');
    r.line(0, FIELD.top - 6, 960, FIELD.top - 6, '#1d2c4d', 1);

    // score (right side, RTL)
    r.text('امتیاز', 934, 20, { size: 12 * k, color: '#7f92bb', align: 'right' });
    r.textBold(faNum(this.score), 934, 48, 28 * k, '#ffd166', '#ffb454', 'right');
    const hs = this.c.progress.highScore;
    r.text(`رکورد ${faNum(hs)}`, 934, 70, { size: 11 * k, color: '#5f7199', align: 'right' });

    // level (centre)
    r.text(`مرحله ${faNum(this.levelId)} — ${this.level.name}`, 480, 26, { size: 16 * k, color: '#dbe6ff', weight: '700' });
    const total = this.totalBreakable || 1;
    const done = total - this.remaining;
    const kp = clamp01(done / total);
    r.roundRect(360, 44, 240, 8, 4, '#182342');
    r.roundRect(360, 44, Math.max(6, 240 * kp), 8, 4, r.gradient(360, 0, 600, 0, [[0, '#4cc9f0'], [1, '#06d6a0']]));
    r.text(`${faNum(done)} / ${faNum(total)} آجر`, 480, 68, { size: 11 * k, color: '#8ba0c9' });

    // on-screen pause button for touch devices
    if (this.c.coarse) {
      const b = this.pauseBtn;
      r.roundRect(b.x, b.y, b.w, b.h, 10, 'rgba(27,39,66,.9)', '#2c4270', 1);
      r.rect(b.x + 15, b.y + 13, 5, 20, '#c3d2ee');
      r.rect(b.x + 26, b.y + 13, 5, 20, '#c3d2ee');
    }

    // lives (left)
    r.text('جان', 26, 20, { size: 12 * k, color: '#7f92bb', align: 'left' });
    for (let i = 0; i < this.lives; i++) {
      const x = 34 + i * 26, y = 50;
      ctx.save();
      ctx.fillStyle = '#ff5d8f';
      ctx.shadowColor = '#ff5d8f';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(x, y + 7);
      ctx.bezierCurveTo(x - 11, y, x - 6, y - 8, x, y - 2);
      ctx.bezierCurveTo(x + 6, y - 8, x + 11, y, x, y + 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // bottom strip: active effects + combo
    r.rect(0, FIELD.bottom + 4, 960, 40, 'rgba(7,11,24,.82)');
    r.line(0, FIELD.bottom + 4, 960, FIELD.bottom + 4, '#1d2c4d', 1);

    let ex = 934;
    for (const [type, t] of this.effects) {
      const def = POWERUPS[type];
      if (!def.dur) continue;
      const w = 118;
      const x = ex - w;
      const ratio = clamp01(t / def.dur);
      r.roundRect(x, FIELD.bottom + 10, w, 28, 8, 'rgba(20,30,54,.9)', def.color + '88', 1);
      drawPowerIcon(r.ctx, def.icon, x + w - 18, FIELD.bottom + 24, def.color);
      r.text(def.label, x + w - 34, FIELD.bottom + 20, { size: 12 * k, color: '#dbe6ff', align: 'right' });
      r.roundRect(x + 8, FIELD.bottom + 30, (w - 44) * ratio, 4, 2, def.color);
      ex -= w + 8;
    }
    if (this.paddle.shield) {
      const w = 96, x = ex - w;
      r.roundRect(x, FIELD.bottom + 10, w, 28, 8, 'rgba(20,30,54,.9)', '#06d6a088', 1);
      drawPowerIcon(r.ctx, 'shield', x + w - 18, FIELD.bottom + 24, '#06d6a0');
      r.text('سپر فعال', x + w - 34, FIELD.bottom + 24, { size: 12, color: '#dbe6ff', align: 'right' });
      ex -= w + 8;
    }

    // combo meter (left of bottom strip)
    if (this.combo > 1) {
      const ratio = clamp01(this.comboTimer / COMBO_WINDOW);
      r.text(`کمبو ${faNum(this.combo)}  ×${faNum(this.multiplier)}`, 26, FIELD.bottom + 18, { size: 15 * k, color: '#ff5d8f', align: 'left', weight: '700' });
      r.roundRect(26, FIELD.bottom + 30, 140, 5, 3, '#182342');
      r.roundRect(26, FIELD.bottom + 30, 140 * ratio, 5, 3, '#ff5d8f');
    } else {
      r.text(`سرعت توپ ${faNum(Math.round(this.balls[0]?.speed ?? 0))}`, 26, FIELD.bottom + 24, { size: 12 * k, color: '#6f82a8', align: 'left' });
    }
    if (this.timeScale < 1) {
      r.text('زمان کند', 480, FIELD.bottom + 24, { size: 13 * k, color: '#b6a6ff', weight: '700' });
    }

    if (this.state === 'ready') {
      const msg = this.c.coarse ? 'برای پرتاب توپ ضربه بزنید' : 'برای پرتاب توپ کلیک کنید یا Space بزنید';
      r.text(msg, 480, this.paddle.y - 90, { size: 17 * k, color: '#c3d2ee' });
    }
  }

  drawBanner(r) {
    const m = this.message;
    const k = clamp01(m.t / m.max);
    const pop = k > 0.8 ? 1 + (k - 0.8) * 2.5 : 1;
    r.withAlpha(Math.min(1, k * 2.2), () => {
      r.textBold(m.text, 480, 320, 54 * pop, m.color, m.color);
    });
  }

  drawPause(r) {
    r.rect(0, 0, 960, 640, 'rgba(4,7,16,.72)');
    r.textBold('مکث', 480, 260, 46, '#dbe6ff', '#4cc9f0');
    if (this.c.coarse) {
      r.text('برای ادامه ضربه بزنید', 480, 320, { size: 18, color: '#9fb2d6' });
      r.text('دکمهٔ بالای صفحه = مکث', 480, 352, { size: 14, color: '#6f82a8' });
    } else {
      r.text('Esc یا P برای ادامه', 480, 320, { size: 17, color: '#9fb2d6' });
      r.text('M = بی‌صدا  •  R = شروع دوباره مرحله', 480, 350, { size: 14, color: '#6f82a8' });
    }
  }

  drawLevelComplete(r) {
    r.rect(0, 0, 960, 640, 'rgba(4,7,16,.74)');
    r.textBold('مرحله تمام شد!', 480, 210, 44, '#06d6a0', '#06d6a0');
    const b = this.bonuses;
    const rows = [
      ['پاداش پایان مرحله', b.clearBonus],
      ['پاداش جان‌های باقی‌مانده', b.lifeBonus],
      ['پاداش سرعت', b.timeBonus],
    ];
    rows.forEach(([label, v], i) => {
      const y = 270 + i * 30;
      r.text(label, 620, y, { size: 15, color: '#a9bce0', align: 'right' });
      r.text(faNum(v), 340, y, { size: 15, color: '#ffd166', align: 'left' });
    });
    r.text(`امتیاز کل: ${faNum(this.score)}`, 480, 380, { size: 22, color: '#dbe6ff', weight: '700' });
    r.text(this.c.coarse ? 'ضربه = مرحلهٔ بعد' : 'Enter = مرحله بعد   •   R = تکرار   •   Esc = منو', 480, 430, { size: 14 * (this.c.coarse ? 1.3 : 1), color: '#7f92bb' });
  }

  drawGameOver(r) {
    r.rect(0, 0, 960, 640, 'rgba(4,7,16,.8)');
    r.textBold('پایان بازی', 480, 230, 48, '#ff5d8f', '#ff5d8f');
    r.text(`امتیاز ${faNum(this.score)}`, 480, 300, { size: 26, color: '#ffd166', weight: '700' });
    r.text(`رکورد ${faNum(this.c.progress.highScore)}`, 480, 336, { size: 16, color: '#a9bce0' });
    r.text(`آجرهای شکسته: ${faNum(this.stats.bricksBroken)}   بیشترین کمبو: ${faNum(this.stats.maxCombo)}`, 480, 372, { size: 15, color: '#8ba0c9' });
    r.text(this.c.coarse ? 'ضربه = شروع دوباره' : 'Enter = دوباره   •   Esc = منو', 480, 424, { size: 14 * (this.c.coarse ? 1.3 : 1), color: '#7f92bb' });
  }

  dispose() {
    this.balls.length = 0;
    this.bricks.length = 0;
    this.powerups.length = 0;
    this.bolts.length = 0;
  }
}

function makeStarfield(rng, n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      x: rng.range(0, 960),
      y: rng.range(0, 660),
      s: rng.range(0.8, 2.4),
      a: rng.range(0.15, 0.75),
      speed: rng.range(0.2, 1),
      ph: rng.range(0, TAU),
      c: rng.pick(['#ffffff', '#9fd8ff', '#ffd8a8', '#c9b6ff']),
    });
  }
  return arr;
}
