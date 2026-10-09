// core/emitter.js — tiny typed-ish event bus used to decouple systems
// (collisions emit "brickBroken", HUD/achievements/audio just listen).

export class Emitter {
  constructor() { this.map = new Map(); }

  on(type, fn) {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (e) => { off(); fn(e); });
    return off;
  }

  off(type, fn) {
    const set = this.map.get(type);
    if (set) set.delete(fn);
  }

  emit(type, payload) {
    const set = this.map.get(type);
    if (!set || set.size === 0) return;
    // copy: listeners may unsubscribe during dispatch
    for (const fn of [...set]) fn(payload, type);
  }

  clear() { this.map.clear(); }
}
