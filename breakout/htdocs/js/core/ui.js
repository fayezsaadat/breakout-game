// core/ui.js — immediate-mode canvas widgets (buttons, sliders, toggles, panels).
// The whole game UI lives on the canvas so it scales with the letterboxed viewport.

import { clamp, clamp01, easeOutCubic } from './math.js';

let idSeq = 0;

/**
 * UI scale factor for small / touch screens. Everything is drawn in virtual
 * 960×640 units that shrink with the letterbox scale, so on phones text and
 * touch targets become too small — this factor compensates.
 */
export function uiScale(rendererScale, coarse) {
  let k = 1;
  if (rendererScale < 0.75) k = clamp(0.62 / rendererScale, 1, 1.8);
  if (coarse) k = Math.max(k, 1.25);
  return k;
}

export class UI {
  constructor(input) {
    this.input = input;
    this.hot = null;        // id hovered this frame
    this.hotPrev = null;
    this.dragging = null;   // slider id being dragged
    this.k = 1;             // UI scale factor (set by the scene each frame)
    this.rects = {};        // id -> last drawn rect (handy for tests / a11y)
  }

  _hovered(x, y, w, h) {
    const p = this.input.pointer;
    return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
  }

  get pointer() { return this.input.pointer; }

  beginFrame() {
    this.hotPrev = this.hot;
    this.hot = null;
  }

  panel(r, x, y, w, h, { fill = 'rgba(10,16,32,.9)', stroke = '#22345c', radius = 16, blur = true } = {}) {
    const { ctx } = r;
    ctx.save();
    if (blur) {
      ctx.shadowColor = 'rgba(0,0,0,.6)';
      ctx.shadowBlur = 30;
    }
    r.roundRect(x, y, w, h, radius, fill, stroke, 1);
    ctx.restore();
  }

  /**
   * @returns true on the frame the button is activated (click or Enter/Space when focused)
   */
  button(r, id, x, y, w, h, label, { variant = 'default', size = 20, icon = null, enabled = true, hint = null } = {}) {
    const hov = enabled && this._hovered(x, y, w, h);
    if (hov) this.hot = id;
    this.rects[id] = { x, y, w, h };
    const { ctx } = r;
    const palette = {
      default: { bg: ['#1b2742', '#111a30'], bd: '#2c4270', fg: '#dbe6ff' },
      primary: { bg: ['#ffd166', '#f0932b'], bd: '#ffe6a8', fg: '#231703' },
      danger:  { bg: ['#ff5d8f', '#c9265c'], bd: '#ffb3c9', fg: '#2b0413' },
      ghost:   { bg: ['rgba(255,255,255,.06)', 'rgba(255,255,255,.02)'], bd: '#2c4270', fg: '#c6d5f5' },
    }[variant] || { bg: ['#1b2742', '#111a30'], bd: '#2c4270', fg: '#dbe6ff' };

    const lift = hov ? -2 : 0;
    ctx.save();
    ctx.translate(0, lift);
    const g = r.gradient(0, y, 0, y + h, [[0, palette.bg[0]], [1, palette.bg[1]]]);
    r.roundRect(x, y, w, h, 12, g, hov ? '#ffffff' : palette.bd, hov ? 1.6 : 1);
    if (hov) {
      ctx.globalAlpha = 0.14;
      r.roundRect(x, y, w, h, 12, '#ffffff');
      ctx.globalAlpha = 1;
    }
    const labelX = x + w / 2;
    ctx.textAlign = 'center';
    ctx.font = `700 ${size}px Vazirmatn, "Segoe UI", Tahoma, sans-serif`;
    ctx.fillStyle = enabled ? palette.fg : '#5f6f92';
    ctx.fillText(label, labelX, y + h / 2 + 1);
    ctx.restore();

    if (hint) {
      r.text(hint, x + w / 2, y + h + 14, { size: 12, color: '#7f92bb' });
    }

    const clicked = enabled && hov && this.input.pointer.pressed;
    return clicked;
  }

  slider(r, id, x, y, w, value, { min = 0, max = 1, label = '', format = null } = {}) {
    const h = 26 * this.k;
    const hov = this._hovered(x, y - 10, w, h + 20);
    const p = this.input.pointer;
    const dragging = this.dragging === id || (hov && p.pressed);
    if (dragging) this.dragging = id;
    if (!p.down && this.dragging === id) this.dragging = null;
    if (hov) this.hot = id;

    let v = value;
    if (dragging && p.down) {
      v = clamp(min + (max - min) * clamp01((p.x - x) / w), min, max);
    }

    const kk = clamp01((v - min) / (max - min));
    const trackY = y + h / 2;
    const th = 8 * this.k;
    r.roundRect(x, trackY - th / 2, w, th, th / 2, '#182342', '#243459', 1);
    r.roundRect(x, trackY - th / 2, Math.max(8, w * kk), th, th / 2, '#ffd166');
    r.circle(x + w * kk, trackY, 9 * this.k, '#fff', '#ffd166', 2);
    if (label) {
      r.text(label, x - 12, trackY, { size: 14 * this.k, color: '#a9bce0', align: 'right' });
    }
    const txt = format ? format(v) : Math.round(v * 100) + '%';
    r.text(txt, x + w + 12, trackY, { size: 14 * this.k, color: '#ffd166', align: 'left' });
    return v;
  }

  toggle(r, id, x, y, value, { label = '' } = {}) {
    const w = 52 * this.k, h = 26 * this.k;
    const hov = this._hovered(x, y, w, h);
    if (hov) this.hot = id;
    this.rects[id] = { x, y, w, h };
    const clicked = hov && this.input.pointer.pressed;
    const k = value ? 1 : 0;
    r.roundRect(x, y, w, h, h / 2, value ? '#0f6b52' : '#1d2740', value ? '#06d6a0' : '#2c3b5c', 1);
    r.circle(x + 13 * this.k + k * (w - 26 * this.k), y + h / 2, 9 * this.k, value ? '#7cf5c8' : '#8fa2c6');
    if (label) r.text(label, x + w + 12, y + h / 2, { size: 14 * this.k, color: '#c3d2ee', align: 'left' });
    return clicked ? !value : value;
  }

  /** Scrollable list of items; returns the index clicked (or -1). */
  list(r, idPrefix, x, y, w, h, items, { rowH = 44, renderRow = null, scroll = 0 } = {}) {
    const { ctx } = r;
    let clicked = -1;
    r.withClip(x, y, w, h, () => {
      for (let i = 0; i < items.length; i++) {
        const ry = y + i * rowH - scroll;
        if (ry + rowH < y || ry > y + h) continue;
        const id = `${idPrefix}.${i}`;
        const hov = this._hovered(x, ry, w, rowH);
        if (hov) this.hot = id;
        if (hov && this.input.pointer.pressed) clicked = i;
        if (renderRow) renderRow(r, items[i], i, x + 4, ry + 3, w - 8, rowH - 6, hov);
      }
    });
    return clicked;
  }

  /** Returns true when a click happened anywhere this frame. */
  clickedAnywhere() { return this.input.pointer.pressed; }

  /** Text input helper (minimal, canvas-drawn). Returns the new string. */
  textInput(r, id, x, y, w, value, { active = true, placeholder = '', max = 120 } = {}) {
    const h = 34;
    r.roundRect(x, y, w, h, 8, '#0a1122', active ? '#ffd166' : '#243459', active ? 2 : 1);
    const shown = value || '';
    const { ctx } = r;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.font = '14px Vazirmatn, "Segoe UI", Tahoma, monospace';
    const text = shown || placeholder;
    ctx.fillStyle = shown ? '#dbe6ff' : '#5b6d92';
    let tw = ctx.measureText(text).width;
    const maxW = w - 20;
    if (tw > maxW) tw = maxW;
    ctx.beginPath();
    ctx.rect(x + 8, y, maxW, h);
    ctx.clip();
    ctx.fillText(text, x + w - 10, y + h / 2);
    ctx.restore();
    if (active) {
      const caretX = x + w - 12 - Math.min(tw, maxW);
      if (Math.floor(performance.now() / 400) % 2 === 0) {
        r.rect(caretX, y + 8, 2, h - 16, '#ffd166');
      }
    }
    return value;
  }

  /** Reads keyboard typing into a string (ASCII only, for level codes). */
  readTyping(value, { max = 400 } = {}) {
    let out = value;
    for (const [code, k] of this.input.keys) {
      if (!k.pressed) continue;
      if (code === 'Backspace') { out = out.slice(0, -1); continue; }
      if (code.startsWith('Key')) { out += code.slice(3).toLowerCase(); continue; }
      if (code.startsWith('Digit')) { out += code.slice(5); continue; }
      if (code === 'Minus') out += '-';
      if (code === 'Comma') out += ',';
      if (code === 'Slash') out += '/';
      if (out.length > max) out = out.slice(0, max);
    }
    return out;
  }
}

export const easePanel = easeOutCubic;
