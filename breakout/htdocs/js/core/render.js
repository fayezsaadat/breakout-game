// core/render.js — canvas wrapper: DPI-aware letterboxed viewport, camera shake,
// and a handful of drawing helpers so scenes stay declarative.

import { clamp, rand } from './math.js';

export class Renderer {
  constructor(canvas, vw, vh) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.vw = vw;
    this.vh = vh;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.shakeAmp = 0;
    this.shakeDecay = 8;
    this._shakeX = 0;
    this._shakeY = 0;
    this.time = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const host = this.canvas.parentElement;
    // clientWidth includes the container's padding — subtract it so the
    // letterboxed canvas never overflows the rounded panel.
    let pl = 0, pr = 0, pt = 0, pb = 0;
    if (typeof getComputedStyle === 'function') {
      const cs = getComputedStyle(host);
      pl = parseFloat(cs.paddingLeft) || 0;
      pr = parseFloat(cs.paddingRight) || 0;
      pt = parseFloat(cs.paddingTop) || 0;
      pb = parseFloat(cs.paddingBottom) || 0;
    }
    const availW = Math.max(320, host.clientWidth - pl - pr);
    const availH = Math.max(240, host.clientHeight - pt - pb);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Touch devices in portrait get "fake landscape": the canvas fills the
    // whole screen and the scene is drawn rotated by 90°, so the game is
    // always landscape + fullscreen on phones/iPads.
    this.rotated = !!this.coarse && availH > availW;

    if (this.rotated) {
      const scale = Math.min(availH / this.vw, availW / this.vh);
      this.scale = scale;
      const offW = (availW - this.vh * scale) / 2;
      const offH = (availH - this.vw * scale) / 2;
      this.e = offW + this.vh * scale;   // X = e - scale*vy
      this.f = offH;                     // Y = f + scale*vx
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.canvas.width = Math.round(availW * dpr);
      this.canvas.height = Math.round(availH * dpr);
    } else {
      const scale = Math.min(availW / this.vw, availH / this.vh);
      this.scale = scale;
      const cssW = Math.round(this.vw * scale);
      const cssH = Math.round(this.vh * scale);
      this.offsetX = Math.round((availW - cssW) / 2);
      this.offsetY = Math.round((availH - cssH) / 2);
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
    }
    this.dpr = dpr;
  }

  /** Virtual game coords → canvas-local CSS px (inverse of Input._local). */
  virtualToLocal(vx, vy) {
    if (this.rotated) return { x: this.e - this.scale * vy, y: this.f + this.scale * vx };
    return { x: vx * this.scale, y: vy * this.scale };
  }

  shake(amp) {
    if (this.shakeScale <= 0) return;
    this.shakeAmp = Math.max(this.shakeAmp, amp * this.shakeScale);
  }

  begin(dt) {
    const { ctx, dpr } = this;
    this.time += dt;

    this.shakeAmp = Math.max(0, this.shakeAmp - this.shakeDecay * this.shakeAmp * dt - 0.4 * dt);
    if (this.shakeAmp > 0.05) {
      this._shakeX = rand.range(-this.shakeAmp, this.shakeAmp);
      this._shakeY = rand.range(-this.shakeAmp, this.shakeAmp);
    } else { this._shakeX = 0; this._shakeY = 0; }

    // The canvas element is already sized cssW×cssH and centered by flexbox,
    // so no letterbox translate is needed here — translating again would
    // double-apply the offset and clip the bottom/right of the scene.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.translate(this._shakeX, this._shakeY);   // shake in physical px
    if (this.rotated) {
      // X = e - s*y ; Y = f + s*x  (90° clockwise fake-landscape)
      ctx.transform(0, this.scale, -this.scale, 0, this.e, this.f);
    } else {
      ctx.scale(this.scale, this.scale);
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.textBaseline = 'middle';
  }

  end() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  get shakeOffset() { return { x: this._shakeX, y: this._shakeY }; }

  // ---------- helpers ----------
  rect(x, y, w, h, fill) {
    const { ctx } = this;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }

  roundRect(x, y, w, h, r, fill, stroke, lineWidth = 1) {
    const { ctx } = this;
    const rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lineWidth; ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  circle(x, y, r, fill, stroke, lineWidth = 1) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lineWidth; ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  line(x1, y1, x2, y2, color, width = 1) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  text(str, x, y, { size = 16, color = '#fff', align = 'center', weight = '400', font = null, alpha = 1 } = {}) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.font = `${weight} ${size}px ${font || 'Vazirmatn, "Segoe UI", Tahoma, sans-serif'}`;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  /** Outline + fill text, useful over busy backgrounds. */
  textBold(str, x, y, size, color = '#fff', glow = null, align = 'center') {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = align;
    ctx.font = `700 ${size}px Vazirmatn, "Segoe UI", Tahoma, sans-serif`;
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = 18;
      ctx.fillStyle = glow;
      ctx.fillText(str, x, y);
      ctx.fillText(str, x, y);
    }
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(2, size * 0.14);
    ctx.strokeStyle = 'rgba(3,6,16,.85)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  gradient(x0, y0, x1, y1, stops) {
    const g = this.ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [o, c] of stops) g.addColorStop(clamp(o, 0, 1), c);
    return g;
  }

  withAlpha(a, fn) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    fn();
    ctx.restore();
  }

  withClip(x, y, w, h, fn) {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    fn();
    ctx.restore();
  }
}
