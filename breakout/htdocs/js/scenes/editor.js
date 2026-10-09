// scenes/editor.js — click-to-paint level editor with import/export codes.
// Levels are plain text: 16 chars per row, rows separated by "/".

import { clamp, faNum } from '../core/math.js';
import { UI } from '../core/ui.js';
import { BRICK_DEFS, LEVEL_CHARS, validateRows } from '../game/levels.js';

const ED_COLS = 16;
const ED_ROWS = 12;
const ED_CELL = 40;
const ED_X = 36;
const ED_Y = 132;
const BRUSHES = ['1', '2', '3', 'E', 'X', '.'];
const BRUSH_LABEL = { '1': 'عادی', '2': 'مقاوم', '3': 'سنگین', 'E': 'منفجره', 'X': 'فولاد', '.': 'پاک‌کن' };

export class EditorScene {
  constructor(ctx, opts = {}) {
    this.c = ctx;
    this.r = ctx.renderer;
    this.input = ctx.input;
    this.audio = ctx.audio;
    this.particles = ctx.particles;
    this.ui = new UI(ctx.input);

    this.rows = opts.rows ? opts.rows.slice(0, ED_ROWS).map((r) => r.padEnd(ED_COLS, '.').slice(0, ED_COLS)) : emptyGrid();
    while (this.rows.length < ED_ROWS) this.rows.push('.'.repeat(ED_COLS));
    this.name = opts.name || '';
    this.brush = '1';
    this.painting = false;
    this.paintValue = null;
    this.time = 0;
    this.code = '';
    this.codeActive = false;
    this.toast = null;
    this.hoverCell = null;
    this.savedIndex = opts.index ?? -1;
  }

  enter() { this.audio.setMusicPattern('menu'); }

  get codeString() { return this.rows.map((r) => r.replace(/\.+$/, '')).join('/') + '/'; }

  setCode(str) {
    const raw = str.trim().replace(/\s+/g, '').toUpperCase();
    const parts = raw.split(/[\/,\n]/).filter((s) => s.length > 0);
    const rows = parts.map((p) => (p + '.'.repeat(ED_COLS)).slice(0, ED_COLS)).slice(0, ED_ROWS);
    while (rows.length < ED_ROWS) rows.push('.'.repeat(ED_COLS));
    this.rows = rows;
  }

  notify(text, color = '#06d6a0') {
    this.toast = { text, t: 2.2, color };
  }

  update(dt) {
    this.time += dt;
    this.ui.beginFrame();
    this.particles.update(dt);
    if (this.toast) {
      this.toast.t -= dt;
      if (this.toast.t <= 0) this.toast = null;
    }

    // number keys pick a brush (disabled while typing a level code)
    if (!this.codeActive) {
      for (let i = 0; i < BRUSHES.length; i++) {
        if (this.input.pressed('brush' + (i + 1))) {
          this.brush = BRUSHES[i];
          this.audio.sfx('ui');
        }
      }
    }
    if (this.input.pressed('pause')) {
      this.audio.sfx('ui');
      this.c.events.emit('exitToMenu');
    }

    if (this.codeActive) this.code = this.ui.readTyping(this.code);
  }

  // ------------------------------------------------------------------ grid
  cellAt(px, py) {
    const c = Math.floor((px - ED_X) / ED_CELL);
    const r = Math.floor((py - ED_Y) / ED_CELL);
    if (c < 0 || c >= ED_COLS || r < 0 || r >= ED_ROWS) return null;
    return { c, r };
  }

  paint(cell, value) {
    const row = this.rows[cell.r].split('');
    if (row[cell.c] === value) return;
    row[cell.c] = value;
    this.rows[cell.r] = row.join('');
    this.audio.sfx(value === '.' ? 'ui' : 'brick', 2);
    const x = ED_X + cell.c * ED_CELL + ED_CELL / 2;
    const y = ED_Y + cell.r * ED_CELL + ED_CELL / 2;
    if (value === '.') this.particles.smoke(x, y, '#6f82a8', 4);
    else this.particles.spark(x, y, BRICK_DEFS[value].top, 5, 140, 0.3);
  }

  handleGridInput() {
    const p = this.input.pointer;
    const cell = this.cellAt(p.x, p.y);
    this.hoverCell = cell;

    if (p.pressed && cell) {
      this.painting = true;
      this.paintValue = this.rows[cell.r][cell.c] === this.brush ? '.' : this.brush;
      this.paint(cell, this.paintValue);
    }
    if (this.painting && p.down && cell) this.paint(cell, this.paintValue);
    if (!p.down) this.painting = false;
  }

  // ------------------------------------------------------------------ draw
  draw() {
    const r = this.r;
    r.rect(0, 0, 960, 640, r.gradient(0, 0, 0, 640, [[0, '#0a1128'], [1, '#0b0716']]));

    r.textBold('ویرایشگر مرحله', 480, 46, 30, '#dbe6ff', '#4cc9f0');
    r.text('کلیک و کشیدن برای گذاشتن آجر  •  کلیدهای ۱ تا ۶ برای انتخاب قلم', 480, 76, { size: 12, color: '#7f92bb' });

    this.handleGridInput();
    this.drawGrid(r);
    this.drawBrushes(r);
    this.drawSidePanel(r);
    this.particles.draw(r);

    if (this.toast) {
      const a = clamp(this.toast.t / 0.5, 0, 1);
      r.withAlpha(a, () => {
        r.roundRect(330, 588, 300, 36, 10, 'rgba(10,16,32,.95)', this.toast.color, 1.5);
        r.text(this.toast.text, 480, 606, { size: 15, color: this.toast.color, weight: '700' });
      });
    }

    this.r.canvas.classList.toggle('ui-cursor', !!this.ui.hot || !this.hoverCell);
  }

  drawGrid(r) {
    const { ctx } = r;
    const w = ED_COLS * ED_CELL, h = ED_ROWS * ED_CELL;
    r.roundRect(ED_X - 8, ED_Y - 8, w + 16, h + 16, 12, 'rgba(8,13,28,.85)', '#22345c', 1);

    // checker
    for (let rr = 0; rr < ED_ROWS; rr++) {
      for (let cc = 0; cc < ED_COLS; cc++) {
        const x = ED_X + cc * ED_CELL, y = ED_Y + rr * ED_CELL;
        r.rect(x, y, ED_CELL, ED_CELL, (cc + rr) % 2 ? 'rgba(255,255,255,.018)' : 'rgba(255,255,255,.038)');
      }
    }

    // bricks
    for (let rr = 0; rr < ED_ROWS; rr++) {
      for (let cc = 0; cc < ED_COLS; cc++) {
        const code = this.rows[rr][cc];
        if (code === '.') continue;
        const def = BRICK_DEFS[code];
        const x = ED_X + cc * ED_CELL + 2, y = ED_Y + rr * ED_CELL + 3;
        r.roundRect(x, y, ED_CELL - 4, ED_CELL - 6, 5, r.gradient(0, y, 0, y + ED_CELL, [[0, def.top], [1, def.bottom]]), 'rgba(6,10,24,.5)', 1);
      }
    }

    // grid lines
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#22345c';
    ctx.lineWidth = 1;
    for (let cc = 0; cc <= ED_COLS; cc++) {
      ctx.beginPath(); ctx.moveTo(ED_X + cc * ED_CELL, ED_Y); ctx.lineTo(ED_X + cc * ED_CELL, ED_Y + h); ctx.stroke();
    }
    for (let rr = 0; rr <= ED_ROWS; rr++) {
      ctx.beginPath(); ctx.moveTo(ED_X, ED_Y + rr * ED_CELL); ctx.lineTo(ED_X + w, ED_Y + rr * ED_CELL); ctx.stroke();
    }
    ctx.restore();

    // hover highlight + ghost brick
    if (this.hoverCell) {
      const { c, r: rr } = this.hoverCell;
      const x = ED_X + c * ED_CELL, y = ED_Y + rr * ED_CELL;
      const def = BRICK_DEFS[this.brush];
      if (this.brush !== '.') {
        r.withAlpha(0.45, () => r.roundRect(x + 2, y + 3, ED_CELL - 4, ED_CELL - 6, 5, def.bottom));
      }
      r.roundRect(x + 1, y + 1, ED_CELL - 2, ED_CELL - 2, 5, null, '#ffd166', 2);
    }

    // paddle preview line
    r.withAlpha(0.5, () => {
      r.roundRect(480 - 58, ED_Y + h + 14, 116, 8, 4, '#4cc9f0');
    });
  }

  drawBrushes(r) {
    const y = 92;
    BRUSHES.forEach((code, i) => {
      const x = ED_X + i * 72;
      const active = this.brush === code;
      const label = BRUSH_LABEL[code];
      const bg = active ? '#233355' : 'rgba(20,30,54,.7)';
      r.roundRect(x, y, 68, 40, 9, bg, active ? '#ffd166' : '#26375c', active ? 2 : 1);
      if (code === '.') {
        r.ctx.save();
        r.ctx.strokeStyle = '#8ba0c9';
        r.ctx.lineWidth = 2;
        r.ctx.beginPath(); r.ctx.moveTo(x + 14, y + 14); r.ctx.lineTo(x + 26, y + 26);
        r.ctx.moveTo(x + 26, y + 14); r.ctx.lineTo(x + 14, y + 26); r.ctx.stroke();
        r.ctx.restore();
      } else {
        const def = BRICK_DEFS[code];
        r.roundRect(x + 10, y + 12, 20, 14, 3, r.gradient(0, y + 12, 0, y + 26, [[0, def.top], [1, def.bottom]]));
      }
      r.text(label, x + 36, y + 20, { size: 11, color: '#c3d2ee', align: 'left' });
      r.text(faNum(i + 1), x + 60, y + 32, { size: 9, color: '#6f82a8', align: 'left' });
      if (this.ui._hovered(x, y, 68, 40)) {
        this.ui.hot = 'brush.' + code;
        if (this.input.pointer.pressed) { this.brush = code; this.audio.sfx('ui'); }
      }
    });
  }

  drawSidePanel(r) {
    const px = ED_X + ED_COLS * ED_CELL + 24;
    const pw = 960 - px - 20;
    this.ui.panel(r, px, ED_Y - 8, pw, ED_ROWS * ED_CELL + 16, {});

    let y = ED_Y + 18;
    r.text('نام مرحله', px + pw / 2, y, { size: 13, color: '#8ba0c9' });
    y += 16;
    this.ui.textInput(r, 'name', px + 14, y, pw - 28, this.name, { active: true, placeholder: 'مثلاً: دیوار آتش' });
    y += 52;

    const bw = pw - 28;
    const stats = this.gridStats();
    r.text(`آجرها: ${faNum(stats.breakable)}   فولاد: ${faNum(stats.steel)}   منفجره: ${faNum(stats.bombs)}`, px + pw / 2, y, { size: 12, color: '#8ba0c9' });
    y += 26;

    if (this.ui.button(r, 'clear', px + 14, y, bw, 36, 'پاک کردن همه', { variant: 'ghost', size: 14 })) {
      this.rows = emptyGrid();
      this.audio.sfx('bad');
      this.notify('صفحه پاک شد', '#ff5d8f');
    }
    y += 46;

    r.text('کد مرحله (برای اشتراک‌گذاری)', px + pw / 2, y, { size: 13, color: '#8ba0c9' });
    y += 16;
    this.ui.textInput(r, 'code', px + 14, y, bw, this.code, { active: this.codeActive, placeholder: 'کد را اینجا بنویسید' });
    if (this.ui._hovered(px + 14, y, bw, 34) && this.input.pointer.pressed) this.codeActive = true;
    else if (this.input.pointer.pressed && !this.ui._hovered(px + 14, y, bw, 34)) this.codeActive = false;
    y += 44;

    if (this.ui.button(r, 'apply', px + 14, y, bw, 34, 'اعمال کد', { size: 14 })) {
      if (this.code) {
        this.setCode(this.code);
        this.audio.sfx('select');
        this.notify('کد اعمال شد');
      }
    }
    y += 44;
    if (this.ui.button(r, 'copy', px + 14, y, bw, 34, 'کپی کد', { variant: 'ghost', size: 14 })) {
      this.code = this.codeString;
      copyToClipboard(this.code);
      this.audio.sfx('ui');
      this.notify('کد کپی شد');
    }
    y += 44;
    if (this.ui.button(r, 'test', px + 14, y, bw, 40, '▶ آزمایش مرحله', { variant: 'primary', size: 15 })) {
      this.audio.sfx('select');
      this.c.events.emit('testLevel', { rows: this.rows.filter((row, i) => row.includes('1') || row.includes('2') || row.includes('3') || row.includes('E') || row.includes('X')), name: this.name });
    }
    y += 50;
    if (this.ui.button(r, 'save', px + 14, y, bw, 40, '💾 ذخیره', { size: 15 })) this.save();
    y += 50;
    if (this.ui.button(r, 'back', px + 14, y, bw, 36, 'بازگشت به منو', { variant: 'ghost', size: 14 })) {
      this.audio.sfx('ui');
      this.c.events.emit('exitToMenu');
    }
  }

  gridStats() {
    let breakable = 0, steel = 0, bombs = 0;
    for (const row of this.rows) {
      for (const ch of row) {
        if (ch === 'X') steel++;
        else if (ch === 'E') { bombs++; breakable++; }
        else if (ch !== '.') breakable++;
      }
    }
    return { breakable, steel, bombs };
  }

  save() {
    const rows = this.rows.filter((row) => /[123EX]/.test(row));
    if (!validateRows(rows)) {
      this.audio.sfx('bad');
      this.notify('مرحله خالی است!', '#ff5d8f');
      return;
    }
    const list = this.c.progress.customLevels || [];
    const entry = { name: this.name.trim() || 'مرحله دلخواه', rows, createdAt: Date.now() };
    if (this.savedIndex >= 0 && list[this.savedIndex]) list[this.savedIndex] = entry;
    else { list.push(entry); this.savedIndex = list.length - 1; }
    this.c.progress.customLevels = list;
    this.c.persistProgress();
    this.audio.sfx('powerup');
    this.notify('ذخیره شد — در «انتخاب مرحله» هست');
  }
}

function emptyGrid() {
  return Array.from({ length: ED_ROWS }, () => '.'.repeat(ED_COLS));
}

async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
}
