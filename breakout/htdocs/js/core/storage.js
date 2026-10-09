// core/storage.js — namespaced localStorage wrapper. Never throws (private mode safe).

const NS = 'breakout.v1.';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch { /* ignore */ }
}

export const store = {
  get: read,
  set: write,
  remove(key) { try { localStorage.removeItem(NS + key); } catch { /* ignore */ } },
};

export const defaults = {
  settings: { sfx: 0.7, music: 0.28, muted: false, control: 'both', screenShake: true },
  progress: { highScore: 0, unlocked: 1, bestByLevel: {}, totalBricks: 0, plays: 0 },
  customLevels: [],
};

export function loadSettings() { return { ...defaults.settings, ...(read('settings', {}) || {}) }; }
export function saveSettings(s) { write('settings', s); }

export function loadProgress() { return { ...defaults.progress, ...(read('progress', {}) || {}) }; }
export function saveProgress(p) { write('progress', p); }

export function loadCustomLevels() { return read('customLevels', []) || []; }
export function saveCustomLevels(l) { write('customLevels', l); }
