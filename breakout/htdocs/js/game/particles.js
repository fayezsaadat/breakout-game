// game/particles.js — pooled particle system + floating score texts.
// Pool avoids GC churn: thousands of sparks over a session with zero allocation
// in the hot path.

import { clamp, rand, TAU } from '../core/math.js';

const KIND = { SPARK: 0, SHARD: 1, SMOKE: 2, RING: 3, STAR: 4 };

export class Particles {
  constructor(capacity = 1600) {
    this.cap = capacity;
    this.p = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.p[i] = { alive: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, rot: 0, vr: 0, color: '#fff', grav: 0, drag: 0.98, fade: 1 };
    }
    this.cursor = 0;
    this.count = 0;
  }

  _alloc() {
    // round-robin: recycle the oldest slot if the pool is full
    for (let i = 0; i < this.cap; i++) {
      const idx = (this.cursor + i) % this.cap;
      if (!this.p[idx].alive) { this.cursor = (idx + 1) % this.cap; this.count++; return this.p[idx]; }
    }
    this.cursor = (this.cursor + 1) % this.cap;
    return this.p[this.cursor];
  }

  emit(kind, opts) {
    const p = this._alloc();
    p.alive = true; p.kind = kind;
    p.x = opts.x; p.y = opts.y;
    p.vx = opts.vx || 0; p.vy = opts.vy || 0;
    p.max = p.life = opts.life ?? 0.6;
    p.size = opts.size ?? 3;
    p.rot = opts.rot ?? rand.range(0, TAU);
    p.vr = opts.vr ?? rand.range(-8, 8);
    p.color = opts.color ?? '#fff';
    p.grav = opts.grav ?? 0;
    p.drag = opts.drag ?? 0.98;
    return p;
  }

  spark(x, y, color, n = 8, speed = 220, life = 0.45) {
    for (let i = 0; i < n; i++) {
      const a = rand.range(0, TAU), s = rand.range(speed * 0.25, speed);
      this.emit(KIND.SPARK, { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: rand.range(life * 0.5, life), size: rand.range(1.2, 3), drag: 0.94, grav: 120 });
    }
  }

  /** Directional burst — used when a ball strikes a surface. */
  burst(x, y, dirX, dirY, color, n = 10, spread = 1.1, speed = 260) {
    const base = Math.atan2(dirY, dirX);
    for (let i = 0; i < n; i++) {
      const a = base + rand.range(-spread, spread) * 0.5;
      const s = rand.range(speed * 0.3, speed);
      this.emit(KIND.SPARK, { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: rand.range(0.18, 0.5), size: rand.range(1.4, 3.4), drag: 0.93, grav: 200 });
    }
  }

  /** Brick debris: little rotating rectangles in the brick's colours. */
  shards(x, y, w, h, colors, n = 12) {
    for (let i = 0; i < n; i++) {
      const a = rand.range(0, TAU), s = rand.range(60, 320);
      this.emit(KIND.SHARD, {
        x: x + rand.range(-w / 2, w / 2) * 0.6,
        y: y + rand.range(-h / 2, h / 2) * 0.6,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60,
        color: rand.pick(colors),
        life: rand.range(0.5, 1.1),
        size: rand.range(3, Math.min(9, h * 0.55)),
        grav: 900, drag: 0.985,
      });
    }
  }

  smoke(x, y, color = '#8892b0', n = 8) {
    for (let i = 0; i < n; i++) {
      this.emit(KIND.SMOKE, {
        x: x + rand.range(-8, 8), y: y + rand.range(-8, 8),
        vx: rand.range(-40, 40), vy: rand.range(-70, -20),
        color, life: rand.range(0.4, 0.9), size: rand.range(6, 16), drag: 0.96,
      });
    }
  }

  ring(x, y, color, size = 10, life = 0.35) {
    this.emit(KIND.RING, { x, y, color, size, life, drag: 1 });
  }

  stars(x, y, n = 20, color = '#ffd166') {
    for (let i = 0; i < n; i++) {
      const a = rand.range(0, TAU), s = rand.range(80, 420);
      this.emit(KIND.STAR, { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: rand.range(0.6, 1.4), size: rand.range(2, 5), grav: 260, drag: 0.97 });
    }
  }

  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      const p = this.p[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; this.count--; continue; }
      if (p.kind !== KIND.RING) {
        const d = Math.pow(p.drag, dt * 60);
        p.vx *= d; p.vy *= d;
        p.vy += p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      }
    }
  }

  draw(r) {
    const { ctx } = r;
    for (let i = 0; i < this.cap; i++) {
      const p = this.p[i];
      if (!p.alive) continue;
      const t = clamp(p.life / p.max, 0, 1);
      switch (p.kind) {
        case KIND.SPARK:
          ctx.globalAlpha = t;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size * 0.9;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.016, p.y - p.vy * 0.016);
          ctx.stroke();
          break;
        case KIND.SHARD:
          ctx.globalAlpha = t;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
          ctx.restore();
          break;
        case KIND.SMOKE:
          ctx.globalAlpha = t * 0.35;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1.6 - t), 0, TAU);
          ctx.fill();
          break;
        case KIND.RING: {
          const k = 1 - t;
          ctx.globalAlpha = t * 0.85;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 3 * t + 0.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size + k * 46, 0, TAU);
          ctx.stroke();
          break;
        }
        case KIND.STAR: {
          ctx.globalAlpha = t;
          ctx.fillStyle = p.color;
          const s = p.size * (0.4 + t * 0.8);
          ctx.beginPath();
          ctx.moveTo(p.x - s, p.y); ctx.lineTo(p.x, p.y - s * 0.35);
          ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y + s * 0.35);
          ctx.closePath(); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s * 0.35, p.y);
          ctx.lineTo(p.x, p.y + s); ctx.lineTo(p.x - s * 0.35, p.y);
          ctx.closePath(); ctx.fill();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  clear() {
    for (const p of this.p) p.alive = false;
    this.count = 0;
  }
}

// ---------------- floating score / combo texts ----------------
export class FloatTexts {
  constructor(cap = 90) {
    this.items = [];
    this.cap = cap;
  }
  spawn(text, x, y, { color = '#ffd166', size = 22, life = 0.9, vy = -70, vx = 0, glow = true } = {}) {
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push({ text, x, y, color, size, life, max: life, vy, vx, glow, rot: 0 });
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      f.life -= dt;
      if (f.life <= 0) { this.items.splice(i, 1); continue; }
      const k = 1 - f.life / f.max;
      f.y += f.vy * dt * (1 - k * 0.6);
      f.x += f.vx * dt;
    }
  }
  draw(r) {
    for (const f of this.items) {
      const t = f.life / f.max;
      const scale = t > 0.85 ? 1 + (t - 0.85) * 2.2 : 1;
      r.textBold(f.text, f.x, f.y, f.size * scale, f.color, f.glow ? f.color : null);
    }
  }
  clear() { this.items.length = 0; }
}
