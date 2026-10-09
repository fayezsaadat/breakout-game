// game/brick.js — a single brick cell. Knows nothing about the scene; it only
// reports damage and exposes geometry for the collision system.

import { AABB, clamp, clamp01 } from '../core/math.js';
import { BRICK_DEFS, BRICK_KIND } from './levels.js';

export class Brick {
  constructor(code, x, y, w, h) {
    this.code = code;
    this.def = BRICK_DEFS[code];
    this.kind = this.def.kind;
    this.maxHp = this.def.hp;
    this.hp = this.def.hp;
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.alive = true;
    this.hitFlash = 0;
    this.spawnT = 0;      // intro animation 0..1
    this.pulse = Math.random() * Math.PI * 2;
  }

  get box() { return new AABB(this.x, this.y, this.w, this.h); }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  get breakable() { return this.kind !== BRICK_KIND.STEEL; }
  get hpRatio() { return this.maxHp === Infinity ? 1 : this.hp / this.maxHp; }

  /** @returns {'broken'|'damaged'|'immune'} */
  damage(amount = 1) {
    if (!this.alive) return 'immune';
    if (this.kind === BRICK_KIND.STEEL) { this.hitFlash = 1; return 'immune'; }
    this.hp -= amount;
    this.hitFlash = 1;
    if (this.hp <= 0) { this.alive = false; return 'broken'; }
    return 'damaged';
  }

  update(dt, time) {
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    if (this.spawnT < 1) this.spawnT = clamp01(this.spawnT + dt * 2.6);
    this.pulse += dt * 2;
  }

  draw(r, time) {
    const { ctx } = r;
    const t = this.spawnT;
    if (t <= 0) return;
    const grow = 0.6 + 0.4 * t;
    const w = this.w * grow, h = this.h * grow;
    const x = this.cx - w / 2, y = this.cy - h / 2;
    const inset = 1.5;
    const rx = x + inset, ry = y + inset, rw = w - inset * 2, rh = h - inset * 2;

    const hpK = this.maxHp === Infinity ? 1 : this.hpRatio;
    const top = this.def.top, bottom = this.def.bottom;

    // body
    const g = r.gradient(0, ry, 0, ry + rh, [[0, top], [1, bottom]]);
    r.roundRect(rx, ry, rw, rh, 4, g, 'rgba(6,10,24,.55)', 1);

    // armour plates for multi-hit bricks
    if (this.maxHp >= 2 && this.maxHp !== Infinity) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.4 * hpK;
      ctx.strokeStyle = this.def.edge;
      ctx.lineWidth = 1.4;
      const n = Math.max(1, this.hp);
      for (let i = 0; i < n; i++) {
        const off = 3 + i * 3;
        ctx.beginPath();
        ctx.moveTo(rx + off, ry + rh - 3);
        ctx.lineTo(rx + off + 5, ry + rh - 3);
        ctx.stroke();
      }
      ctx.restore();
    }

    // top highlight
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fillRect(rx + 2, ry + 1.5, rw - 4, 2);
    ctx.restore();

    // bomb core
    if (this.kind === BRICK_KIND.BOMB) {
      const p = 0.5 + 0.5 * Math.sin(this.pulse * 3);
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.5 * p;
      ctx.fillStyle = '#fff3c4';
      ctx.shadowColor = '#ff6b35';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, 3.4 + p * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // steel rivets
    if (this.kind === BRICK_KIND.STEEL) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      for (const [dx, dy] of [[5, 5], [rw - 8, 5], [5, rh - 8], [rw - 8, rh - 8]]) {
        ctx.beginPath(); ctx.arc(rx + dx, ry + dy, 1.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // hit flash overlay
    if (this.hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = this.hitFlash * 0.85;
      r.roundRect(rx, ry, rw, rh, 4, '#ffffff');
      ctx.restore();
    }
  }
}
