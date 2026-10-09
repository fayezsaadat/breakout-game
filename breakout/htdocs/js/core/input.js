// core/input.js — action-oriented input layer.
// Maps raw keys / pointer to named actions so gameplay code never touches keycodes.

import { clamp } from './math.js';

export class Input {
  constructor(canvas, vw = 960, vh = 640, renderer = null) {
    this.canvas = canvas;
    this.vw = vw;
    this.vh = vh;
    this.renderer = renderer;
    this.keys = new Map();          // code -> {down, pressed, released}
    this.actions = new Map();       // action -> [codes]
    this.pointer = { x: 0, y: 0, active: false, down: false, pressed: false, released: false, moved: false };
    this.wheel = 0;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onBlur = this._onBlur.bind(this);

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bind(action, codes) {
    const arr = this.actions.get(action) || [];
    for (const c of codes) if (!arr.includes(c)) arr.push(c);
    this.actions.set(action, arr);
  }

  _updateKey(code, down) {
    let k = this.keys.get(code);
    if (!k) this.keys.set(code, (k = { down: false, pressed: false, released: false }));
    if (down && !k.down) k.pressed = true;
    if (!down && k.down) k.released = true;
    k.down = down;
  }

  _onKeyDown(e) {
    // Keep the browser from scrolling / repeating while playing.
    const blocked = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'];
    if (blocked.includes(e.code)) e.preventDefault();
    if (e.repeat) { this._updateKey(e.code, true); return; }
    this._updateKey(e.code, true);
  }

  _onKeyUp(e) { this._updateKey(e.code, false); }
  _onBlur() { for (const k of this.keys.values()) { k.down = false; k.pressed = false; } this.pointer.down = false; }

  /** Screen px → virtual game units. The canvas element is exactly the
   *  letterboxed game area (flex-centered), so its rect maps 1:1 to the
   *  virtual viewport and the scale is derived from the rect itself —
   *  this stays correct through any window resize. */
  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const rd = this.renderer;
    if (rd && rd.rotated) {
      // inverse of Renderer.virtualToLocal:  X = e - s*y ; Y = f + s*x
      return {
        x: (py - rd.f) / rd.scale,
        y: (rd.e - px) / rd.scale,
      };
    }
    const sx = r.width / this.vw || 1;
    const sy = r.height / this.vh || 1;
    return { x: px / sx, y: py / sy };
  }

  _onPointerDown(e) {
    try { this.canvas.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointers */ }
    const p = this._local(e);
    this.pointer.x = p.x; this.pointer.y = p.y;
    this.pointer.down = true; this.pointer.pressed = true; this.pointer.active = true; this.pointer.moved = true;
  }

  _onPointerMove(e) {
    const p = this._local(e);
    if (p.x !== this.pointer.x || p.y !== this.pointer.y) this.pointer.moved = true;
    this.pointer.x = p.x; this.pointer.y = p.y;
    this.pointer.active = true;
  }

  _onPointerUp() {
    if (!this.pointer.down) return;
    this.pointer.down = false; this.pointer.released = true;
  }

  _onWheel(e) { e.preventDefault(); this.wheel += Math.sign(e.deltaY); }

  // ---- queried by game code ----
  held(action) {
    for (const c of this.actions.get(action) || []) if (this.keys.get(c)?.down) return true;
    return false;
  }
  pressed(action) {
    for (const c of this.actions.get(action) || []) if (this.keys.get(c)?.pressed) return true;
    return false;
  }
  released(action) {
    for (const c of this.actions.get(action) || []) if (this.keys.get(c)?.released) return true;
    return false;
  }
  // -1 | 0 | 1 for a signed axis built from two actions
  axis(neg, pos) {
    let v = 0;
    if (this.held(neg)) v -= 1;
    if (this.held(pos)) v += 1;
    return clamp(v, -1, 1);
  }

  anyKeyPressed() {
    for (const k of this.keys.values()) if (k.pressed) return true;
    return false;
  }

  // Must be called at the very end of every frame.
  endFrame() {
    for (const k of this.keys.values()) { k.pressed = false; k.released = false; }
    this.pointer.pressed = false;
    this.pointer.released = false;
    this.pointer.moved = false;
    this.wheel = 0;
  }
}

/** The game's canonical action map — shared by the app and the headless tests. */
export function bindDefaultActions(input) {
  input.bind('left', ['ArrowLeft', 'KeyA']);
  input.bind('right', ['ArrowRight', 'KeyD']);
  input.bind('fire', ['Space', 'Enter']);
  input.bind('confirm', ['Enter', 'NumpadEnter']);
  input.bind('pause', ['Escape', 'KeyP']);
  input.bind('restart', ['KeyR']);
  input.bind('appMute', ['KeyM']);
  input.bind('fullscreen', ['KeyF']);
  for (let n = 1; n <= 9; n++) input.bind('brush' + n, ['Digit' + n, 'Numpad' + n]);
  return input;
}
