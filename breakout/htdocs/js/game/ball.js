// game/ball.js — ball with swept (continuous) collision, sticky-launch state
// and a motion trail. Speed is a scalar + direction so power-ups can re-tune it.

import { TAU, clamp } from '../core/math.js';

export const BALL_R = 8;
export const SPEED_MIN = 340;
export const SPEED_MAX = 780;
export const SPEED_START = 400;

export const BALL_STATE = { STUCK: 'stuck', FLYING: 'flying' };

export class Ball {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = BALL_R;
    this.speed = SPEED_START;
    this.angle = -Math.PI / 2 + 0.35;
    this.vx = 0; this.vy = 0;
    this.state = BALL_STATE.STUCK;
    this.trail = [];
    this.trailMax = 14;
    this.alive = true;
    this.spin = 0;
    this.squash = 0;
    this.squashAngle = 0;
    this.bounces = 0;
    this.fuse = false;      // fire-ball: passes through one brick layer (unused power-up hook)
  }

  setAngle(a) {
    this.angle = a;
    this.sync();
  }

  sync() {
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
  }

  launch(angle = -Math.PI / 2 + (Math.random() * 0.5 - 0.25)) {
    this.state = BALL_STATE.FLYING;
    this.setAngle(angle);
  }

  setSpeed(s) { this.speed = clamp(s, SPEED_MIN, SPEED_MAX); this.sync(); }

  reflect(axis, sign) {
    if (axis === 'x') this.vx = Math.abs(this.vx) * sign;
    else this.vy = Math.abs(this.vy) * sign;
    this.angle = Math.atan2(this.vy, this.vx);
    this.squash = 1;
    this.squashAngle = axis === 'x' ? 0 : Math.PI / 2;
    this.bounces++;
  }

  /** Bounce off the paddle: outgoing angle depends on hit offset. */
  bounceOffPaddle(offset, paddleVx, maxDeg = 60) {
    const k = clamp(offset, -1, 1);
    const a = (-90 + k * maxDeg) * (Math.PI / 180);
    this.setAngle(a);
    // paddle spin adds a touch of english without breaking the angle limit
    this.spin = clamp(paddleVx / 1400, -0.6, 0.6);
    this.speed = clamp(this.speed * 1.035 + 4, SPEED_MIN, SPEED_MAX);
    this.sync();
    this.squash = 1;
    this.squashAngle = Math.PI / 2;
    this.bounces++;
  }

  nudgeOutOfHorizontal() {
    // Avoid perfectly horizontal trajectories (endless left/right loops).
    const minVy = this.speed * 0.16;
    if (Math.abs(this.vy) < minVy) {
      this.vy = (this.vy >= 0 ? 1 : -1) * minVy;
      const rest = Math.sqrt(Math.max(1, this.speed * this.speed - this.vy * this.vy));
      this.vx = (this.vx >= 0 ? 1 : -1) * rest;
      this.angle = Math.atan2(this.vy, this.vx);
    }
  }

  update(dt) {
    if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 7);
    this.spin *= Math.pow(0.9, dt * 60);

    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > this.trailMax) this.trail.shift();
  }

  draw(r, time) {
    const { ctx } = r;
    // trail
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      const k = i / this.trail.length;
      ctx.globalAlpha = k * 0.35;
      ctx.fillStyle = i % 2 ? '#ffd166' : '#ff9f1c';
      ctx.beginPath();
      ctx.arc(t.x, t.y, this.r * (0.25 + k * 0.75), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.squashAngle);
    const s = 1 + this.squash * 0.28;
    ctx.scale(s, 2 - s);

    ctx.shadowColor = '#ffd166';
    ctx.shadowBlur = 22;
    const g = r.gradient(0, -this.r, 0, this.r, [
      [0, '#fff6dd'], [0.5, '#ffd166'], [1, '#f08a1d'],
    ]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, this.r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.globalAlpha = 0.75;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-this.r * 0.3, -this.r * 0.34, this.r * 0.28, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
