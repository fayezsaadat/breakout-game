// main.js — bootstrap.

import { Game } from './core/game.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);

// Expose for debugging from the console.
window.__breakout = game;

// The viewport must be measured after layout, so start on the next frame.
requestAnimationFrame(() => {
  game.renderer.resize();
  game.start();
  document.getElementById('boot')?.remove();
});
