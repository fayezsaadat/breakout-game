// core/math.js — small math/geometry toolkit used across the engine.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const approach = (cur, target, delta) =>
  cur < target ? Math.min(cur + delta, target) : Math.max(cur - delta, target);

// Frame-rate independent exponential smoothing.
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));

export const sign = (v) => (v < 0 ? -1 : 1);
export const deg2rad = (d) => (d * Math.PI) / 180;

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutElastic = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

export const smoothstep = (t) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};

// ---------- deterministic RNG (mulberry32) ----------
export class RNG {
  constructor(seed = (Math.random() * 0xffffffff) >>> 0) {
    this.seed = seed >>> 0;
  }
  next() {
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  // Random point inside a circle of radius r.
  inCircle(r) {
    const a = this.next() * TAU, d = r * Math.sqrt(this.next());
    return { x: Math.cos(a) * d, y: Math.sin(a) * d };
  }
}

export const rand = new RNG();

// ---------- axis-aligned bounding box ----------
export class AABB {
  constructor(x = 0, y = 0, w = 0, h = 0) { this.x = x; this.y = y; this.w = w; this.h = h; }
  get left() { return this.x; }
  get right() { return this.x + this.w; }
  get top() { return this.y; }
  get bottom() { return this.y + this.h; }
  get cx() { return this.x + this.w * 0.5; }
  get cy() { return this.y + this.h * 0.5; }
  contains(px, py) { return px >= this.x && px <= this.right && py >= this.y && py <= this.bottom; }
  overlaps(o) { return this.x < o.right && this.right > o.x && this.y < o.bottom && this.bottom > o.y; }
  expandedBy(p) { return new AABB(this.x - p, this.y - p, this.w + p * 2, this.h + p * 2); }
}

/**
 * Swept (continuous) circle-vs-AABB test. Prevents tunnelling at high ball speeds.
 * Returns null on miss, otherwise { t, axis, sign, px, py } where `t` is the
 * time of impact in [0,1] of the frame movement, `axis` is 'x' | 'y' and `sign`
 * is the surface normal direction on that axis.
 */
export function sweepCircleAABB(cx, cy, r, vx, vy, box) {
  const mink = box.expandedBy(r);
  // Already overlapping at the start of the frame: resolve as an immediate hit
  // using the shallowest penetration axis.
  if (mink.contains(cx, cy)) {
    const dl = cx - mink.left, dr = mink.right - cx;
    const dt = cy - mink.top, db = mink.bottom - cy;
    const m = Math.min(dl, dr, dt, db);
    if (m === dt) return { t: 0, axis: 'y', sign: -1, px: cx, py: box.top };
    if (m === db) return { t: 0, axis: 'y', sign: 1, px: cx, py: box.bottom };
    if (m === dl) return { t: 0, axis: 'x', sign: -1, px: box.left, py: cy };
    return { t: 0, axis: 'x', sign: 1, px: box.right, py: cy };
  }

  let t0x = -Infinity, t1x = Infinity;
  if (vx !== 0) {
    let a = (mink.left - cx) / vx, b = (mink.right - cx) / vx;
    if (a > b) { const s = a; a = b; b = s; }
    t0x = a; t1x = b;
  } else if (cx < mink.left || cx > mink.right) return null;

  let t0y = -Infinity, t1y = Infinity;
  if (vy !== 0) {
    let a = (mink.top - cy) / vy, b = (mink.bottom - cy) / vy;
    if (a > b) { const s = a; a = b; b = s; }
    t0y = a; t1y = b;
  } else if (cy < mink.top || cy > mink.bottom) return null;

  const t0 = Math.max(t0x, t0y);
  const t1 = Math.min(t1x, t1y);
  if (t0 > t1 || t1 < 0 || t0 > 1) return null;

  const t = Math.max(0, t0);
  const px = cx + vx * t, py = cy + vy * t;
  if (t0x > t0y) {
    return { t, axis: 'x', sign: vx > 0 ? -1 : 1, px, py };
  }
  return { t, axis: 'y', sign: vy > 0 ? -1 : 1, px, py };
}

// Swept AABB vs AABB (used by laser bolts).
export function sweepAABB(x, y, w, h, vx, vy, box) {
  let tx0 = -Infinity, tx1 = Infinity, ty0 = -Infinity, ty1 = Infinity;
  if (vx !== 0) {
    let a = (box.left - (x + w)) / vx, b = (box.right - x) / vx;
    if (a > b) { const s = a; a = b; b = s; }
    tx0 = a; tx1 = b;
  } else if (x + w < box.left || x > box.right) return null;
  if (vy !== 0) {
    let a = (box.top - (y + h)) / vy, b = (box.bottom - y) / vy;
    if (a > b) { const s = a; a = b; b = s; }
    ty0 = a; ty1 = b;
  } else if (y + h < box.top || y > box.bottom) return null;

  const t0 = Math.max(tx0, ty0), t1 = Math.min(tx1, ty1);
  if (t0 > t1 || t1 < 0 || t0 > 1) return null;
  return { t: Math.max(0, t0) };
}

export const faNum = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
