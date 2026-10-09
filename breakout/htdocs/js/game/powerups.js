// game/powerups.js — falling power-up capsules + laser bolts.

import { AABB, rand, TAU, clamp } from '../core/math.js';

export const POWERUPS = {
  wide:    { label: 'راکت پهن', color: '#06d6a0', icon: 'wide',    dur: 18, good: true,  desc: 'راکت پهن‌تر می‌شود' },
  narrow:  { label: 'راکت باریک', color: '#ff5d8f', icon: 'narrow', dur: 14, good: false, desc: 'راکت باریک می‌شود' },
  multi:   { label: 'چندتوپ',   color: '#4cc9f0', icon: 'multi',   dur: 0,  good: true,  desc: 'دو توپ اضافه' },
  laser:   { label: 'لیزر',     color: '#ffd166', icon: 'laser',   dur: 16, good: true,  desc: 'شلیک لیزر با Space' },
  slow:    { label: 'آهسته',    color: '#8bd3ff', icon: 'slow',    dur: 12, good: true,  desc: 'توپ کند می‌شود' },
  fast:    { label: 'سریع',     color: '#ff8a5c', icon: 'fast',    dur: 12, good: false, desc: 'توپ تند می‌شود' },
  sticky:  { label: 'چسبنده',   color: '#c0a6ff', icon: 'sticky',  dur: 20, good: true,  desc: 'توپ به راکت می‌چسبد' },
  shield:  { label: 'سپر',      color: '#7cf5c8', icon: 'shield',  dur: 0,  good: true,  desc: 'یک بار نجات در پایین' },
  life:    { label: 'جان اضافه', color: '#ff5d8f', icon: 'heart',  dur: 0,  good: true,  desc: '+۱ جان' },
  slowmo:  { label: 'زمان کند', color: '#b6a6ff', icon: 'clock',   dur: 6,  good: true,  desc: 'همه‌چیز آهسته' },
};

export const DROP_TABLE = ['wide', 'multi', 'laser', 'slow', 'sticky', 'shield', 'life', 'narrow', 'fast', 'slowmo'];
export const DROP_WEIGHTS = [16, 15, 14, 10, 10, 8, 5, 9, 8, 5];

export function rollPowerup(r = rand) {
  const total = DROP_WEIGHTS.reduce((a, b) => a + b, 0);
  let x = r.next() * total;
  for (let i = 0; i < DROP_TABLE.length; i++) {
    x -= DROP_WEIGHTS[i];
    if (x <= 0) return DROP_TABLE[i];
  }
  return DROP_TABLE[0];
}

export class PowerUp {
  constructor(type, x, y) {
    this.type = type;
    this.def = POWERUPS[type];
    this.x = x; this.y = y;
    this.w = 46; this.h = 22;
    this.vy = 132;
    this.vx = rand.range(-24, 24);
    this.alive = true;
    this.rot = 0;
    this.spin = rand.range(-2.2, 2.2);
    this.born = 0;
  }

  get box() { return new AABB(this.x - this.w / 2, this.y - this.h / 2, this.w, this.h); }

  update(dt) {
    this.born += dt;
    this.y += this.vy * dt;
    this.x += this.vx * dt;
    this.rot += this.spin * dt;
  }

  draw(r, time) {
    const { ctx } = r;
    const wob = Math.sin(this.born * 7) * 0.06;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot * 0.12 + wob);

    ctx.shadowColor = this.def.color;
    ctx.shadowBlur = 16;
    const g = r.gradient(0, -this.h / 2, 0, this.h / 2, [
      [0, 'rgba(255,255,255,.95)'],
      [0.5, this.def.color],
      [1, 'rgba(0,0,0,.35)'],
    ]);
    r.roundRect(-this.w / 2, -this.h / 2, this.w, this.h, 8, g, 'rgba(255,255,255,.8)', 1.2);
    ctx.shadowBlur = 0;

    drawPowerIcon(ctx, this.def.icon, 0, 0, this.def.good ? '#10182b' : '#2b0b16');
    ctx.restore();
  }
}

/** Small vector icons, also reused by the HUD. */
export function drawPowerIcon(ctx, icon, x, y, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  switch (icon) {
    case 'wide':
      ctx.beginPath(); ctx.moveTo(-14, 4); ctx.lineTo(14, 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-11, -1); ctx.lineTo(-14, 4); ctx.lineTo(-11, 9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(11, -1); ctx.lineTo(14, 4); ctx.lineTo(11, 9); ctx.stroke();
      break;
    case 'narrow':
      ctx.beginPath(); ctx.moveTo(-7, 4); ctx.lineTo(7, 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-11, -1); ctx.lineTo(-8, 4); ctx.lineTo(-11, 9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(11, -1); ctx.lineTo(8, 4); ctx.lineTo(11, 9); ctx.stroke();
      break;
    case 'multi':
      for (const [dx, dy, s] of [[-8, 3, 4], [8, 3, 4], [0, -4, 4]]) {
        ctx.beginPath(); ctx.arc(dx, dy, s, 0, TAU); ctx.stroke();
      }
      break;
    case 'laser':
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(0, -10); ctx.lineTo(4, -4); ctx.stroke();
      ctx.fillRect(-6, 6, 12, 3);
      break;
    case 'slow':
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 0); ctx.lineTo(4, 3); ctx.stroke();
      break;
    case 'fast':
      ctx.beginPath(); ctx.moveTo(-9, -5); ctx.lineTo(-2, 0); ctx.lineTo(-9, 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-1, -5); ctx.lineTo(6, 0); ctx.lineTo(-1, 5); ctx.stroke();
      break;
    case 'sticky':
      ctx.beginPath(); ctx.moveTo(-8, 5); ctx.lineTo(8, 5); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -3, 4, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 1); ctx.lineTo(0, 5); ctx.stroke();
      break;
    case 'shield':
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(8, -5); ctx.lineTo(8, 2);
      ctx.quadraticCurveTo(8, 8, 0, 10);
      ctx.quadraticCurveTo(-8, 8, -8, 2);
      ctx.lineTo(-8, -5); ctx.closePath(); ctx.stroke();
      break;
    case 'heart':
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.bezierCurveTo(-12, 0, -7, -9, 0, -3);
      ctx.bezierCurveTo(7, -9, 12, 0, 0, 8);
      ctx.closePath(); ctx.fill();
      break;
    case 'clock':
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(5, 2); ctx.stroke();
      break;
  }
  ctx.restore();
}

export class Bolt {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.w = 4; this.h = 16;
    this.vy = -900;
    this.alive = true;
  }
  get box() { return new AABB(this.x - this.w / 2, this.y - this.h, this.w, this.h); }
  update(dt) { this.y += this.vy * dt; }
  draw(r) {
    const { ctx } = r;
    ctx.save();
    ctx.shadowColor = '#ffd166';
    ctx.shadowBlur = 12;
    const g = r.gradient(this.x, this.y - this.h, this.x, this.y, [[0, 'rgba(255,240,200,.2)'], [1, '#fff2c4']]);
    r.roundRect(this.x - this.w / 2, this.y - this.h, this.w, this.h, 2, g);
    ctx.restore();
  }
}
