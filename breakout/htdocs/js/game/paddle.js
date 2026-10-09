// game/paddle.js — the paddle. Mouse-driven with keyboard assist,
// carries power-up state (width, laser, sticky, shield).

import { AABB, clamp, damp } from '../core/math.js';

export const PADDLE_BASE_W = 116;
export const PADDLE_H = 16;

export class Paddle {
  constructor(cx, y, bounds) {
    this.bounds = bounds;               // {left, right}
    this.w = PADDLE_BASE_W;
    this.baseW = PADDLE_BASE_W;
    this.h = PADDLE_H;
    this.x = cx - this.w / 2;
    this.y = y;
    this.vx = 0;
    this.prevX = this.x;
    this.targetX = this.x;
    this.laser = false;
    this.sticky = false;
    this.shield = false;
    this.charge = 0;                    // 0..1 squash animation on hit
    this.tilt = 0;
    this.glow = 0;
  }

  get box() { return new AABB(this.x, this.y, this.w, this.h); }
  get cx() { return this.x + this.w / 2; }

  setWidth(w) {
    const c = this.cx;
    this.w = clamp(w, 64, this.bounds.right - this.bounds.left);
    this.x = c - this.w / 2;
  }

  moveTo(px) {
    this.targetX = clamp(px - this.w / 2, this.bounds.left, this.bounds.right - this.w);
  }

  nudge(dir, dt, speed = 900) {
    this.targetX = clamp(this.targetX + dir * speed * dt, this.bounds.left, this.bounds.right - this.w);
  }

  hit() { this.charge = 1; this.glow = 1; }

  update(dt) {
    this.prevX = this.x;
    this.x = damp(this.x, this.targetX, 22, dt);
    this.x = clamp(this.x, this.bounds.left, this.bounds.right - this.w);
    this.vx = (this.x - this.prevX) / Math.max(dt, 1e-4);
    this.charge = Math.max(0, this.charge - dt * 6);
    this.glow = Math.max(0, this.glow - dt * 3.2);
    this.tilt = damp(this.tilt, clamp(this.vx / 900, -1, 1) * 0.12, 12, dt);
  }

  draw(r, time) {
    const { ctx } = r;
    const squash = this.charge;
    const w = this.w * (1 + squash * 0.06);
    const h = this.h * (1 - squash * 0.28);
    const x = this.cx - w / 2;
    const y = this.y + (this.h - h);

    ctx.save();
    ctx.translate(this.cx, y + h / 2);
    ctx.rotate(this.tilt);
    ctx.translate(-this.cx, -(y + h / 2));

    // under-glow
    ctx.save();
    ctx.globalAlpha = 0.35 + this.glow * 0.4;
    ctx.shadowColor = this.shield ? '#06d6a0' : '#4cc9f0';
    ctx.shadowBlur = 26 + this.glow * 20;
    r.roundRect(x + 6, y + 4, w - 12, h, 8, this.shield ? '#06d6a0' : '#4cc9f0');
    ctx.restore();

    // body
    const g = r.gradient(0, y, 0, y + h, [
      [0, this.shield ? '#8ff5d5' : '#bfe9ff'],
      [0.45, this.shield ? '#06d6a0' : '#4cc9f0'],
      [1, this.shield ? '#057a5c' : '#1b5f9e'],
    ]);
    r.roundRect(x, y, w, h, 7, g, 'rgba(255,255,255,.55)', 1.2);

    // grip stripes
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = '#04121f';
    ctx.lineWidth = 2;
    const n = 5;
    for (let i = 1; i < n; i++) {
      const gx = x + (w / n) * i;
      ctx.beginPath(); ctx.moveTo(gx, y + 4); ctx.lineTo(gx, y + h - 4); ctx.stroke();
    }
    ctx.restore();

    // laser cannons
    if (this.laser) {
      for (const side of [x + 6, x + w - 6]) {
        ctx.fillStyle = '#ff5d8f';
        ctx.shadowColor = '#ff5d8f';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(side - 4, y + 2);
        ctx.lineTo(side + 4, y + 2);
        ctx.lineTo(side + 2.4, y - 8);
        ctx.lineTo(side - 2.4, y - 8);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();

    // shield line
    if (this.shield) {
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.25 * Math.sin(time * 6);
      ctx.strokeStyle = '#06d6a0';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -time * 40;
      ctx.beginPath();
      ctx.moveTo(this.bounds.left, this.y + this.h + 26);
      ctx.lineTo(this.bounds.right, this.y + this.h + 26);
      ctx.stroke();
      ctx.restore();
    }
  }
}
