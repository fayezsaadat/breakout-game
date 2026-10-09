// scenes/menu.js — main menu, level select, settings and help.
// Every widget is drawn on the canvas through the immediate-mode UI helper.

import { clamp, faNum, TAU, rand } from '../core/math.js';
import { UI, uiScale } from '../core/ui.js';
import { LEVELS, LEVEL_COUNT, BRICK_DEFS } from '../game/levels.js';
import { POWERUPS, drawPowerIcon } from '../game/powerups.js';
import { saveSettings } from '../core/storage.js';

const VIEWS = { MAIN: 'main', LEVELS: 'levels', SETTINGS: 'settings', HELP: 'help' };

export class MenuScene {
  constructor(ctx) {
    this.c = ctx;
    this.r = ctx.renderer;
    this.input = ctx.input;
    this.audio = ctx.audio;
    this.particles = ctx.particles;
    this.ui = new UI(ctx.input);
    this.view = VIEWS.MAIN;
    this.time = 0;
    this.t = 0;                       // view transition 0..1
    this.hoverSfx = false;
    this.scroll = 0;
    this.demo = makeDemo(this.rng || rand);
    this.titleY = 0;
  }

  get settings() { return this.c.settings; }

  enter() {
    this.audio.setMusicPattern('menu');
    this.audio.startMusic('menu');
  }

  update(dt) {
    this.time += dt;
    this.t = clamp(this.t + dt * 4, 0, 1);
    this.ui.k = uiScale(this.r.scale, this.c.coarse);
    this.ui.beginFrame();
    this.particles.update(dt);

    if (this.input.pressed('pause') && this.view !== VIEWS.MAIN) {
      this.audio.sfx('ui');
      this.goto(VIEWS.MAIN);
    }
  }

  goto(view) {
    if (this.view !== view) this.t = 0;
    this.view = view;
    this.scroll = 0;
  }

  draw() {
    const r = this.r;
    this.drawBackdrop(r);

    const k = this.t;
    r.withAlpha(0.25 + 0.75 * k, () => {
      switch (this.view) {
        case VIEWS.MAIN: this.drawMain(r, k); break;
        case VIEWS.LEVELS: this.drawLevels(r, k); break;
        case VIEWS.SETTINGS: this.drawSettings(r, k); break;
        case VIEWS.HELP: this.drawHelp(r, k); break;
      }
    });

    this.particles.draw(r);
    this.drawFooter(r);

    const hovering = !!this.ui.hot;
    this.r.canvas.classList.toggle('ui-cursor', hovering);
  }

  // ------------------------------------------------------------------ shared
  drawBackdrop(r) {
    const g = r.gradient(0, 0, 0, 640, [[0, '#0a1128'], [0.55, '#070c1a'], [1, '#120a20']]);
    r.rect(0, 0, 960, 640, g);

    // animated ambient bricks
    const { ctx } = r;
    ctx.save();
    for (const b of this.demo.bricks) {
      const y = ((b.y + this.time * b.v) % 760) - 60;
      ctx.globalAlpha = b.a;
      const gg = r.gradient(0, y, 0, y + b.h, [[0, b.c1], [1, b.c2]]);
      r.roundRect(b.x, y, b.w, b.h, 4, gg);
    }
    ctx.restore();

    // glow blobs
    ctx.save();
    ctx.globalAlpha = 0.16;
    for (const [cx, cy, rad, col, sp] of this.demo.blobs) {
      const x = cx + Math.sin(this.time * sp) * 60;
      const y = cy + Math.cos(this.time * sp * 0.8) * 40;
      const rg = r.ctx.createRadialGradient(x, y, 0, x, y, rad);
      rg.addColorStop(0, col);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawFooter(r) {
    const hint = this.c.coarse && innerWidth < innerHeight
      ? 'نمایش افقیِ خودکار فعال است 🔄'
      : 'ساخته‌شده با Canvas خالص — بدون فایل خارجی';
    r.text(hint, 480, 622, { size: 12 * this.ui.k, color: '#4e5f84' });
    // The M hotkey is handled globally in core/game.js so it never double-fires.
    const m = this.settings.muted;
    r.text(m ? '🔇 بی‌صدا (M)' : '🔊 صدا (M)', 928, 622, { size: 12, color: '#4e5f84', align: 'right' });
  }

  header(r, title, sub) {
    r.textBold(title, 480, 62, 34, '#dbe6ff', '#4cc9f0');
    if (sub) r.text(sub, 480, 92, { size: 14, color: '#7f92bb' });
  }

  // ------------------------------------------------------------------ main
  drawMain(r, k) {
    const y0 = 120 + (1 - k) * 24;

    // title
    const bounce = Math.sin(this.time * 1.6) * 5;
    r.textBold('آجرشکن', 480, y0 + bounce, 84, '#ffd166', '#ffb454');
    r.text('نسخه پیشرفته — فیزیک پیوسته، پاور‌آپ، ویرایشگر مرحله', 480, y0 + 48, { size: 15, color: '#8ba0c9' });

    const hs = this.c.progress.highScore;
    if (hs > 0) r.text(`رکورد شما: ${faNum(hs)}`, 480, y0 + 74, { size: 15, color: '#4cc9f0', weight: '700' });

    const uk = this.ui.k;
    const bw = 300 * Math.min(uk, 1.35), bh = 54 * uk, bx = 480 - bw / 2;
    let by = y0 + 108 * uk;
    const gap = 16 * uk;

    if (this.ui.button(r, 'start', bx, by, bw, bh, '▶  شروع بازی', { variant: 'primary', size: 22 * uk, hint: 'Enter' })) {
      this.audio.sfx('select');
      this.c.events.emit('startRun', { levelId: 1 });
      return;
    }
    by += bh + gap + 16 * uk;
    if (this.ui.button(r, 'levels', bx, by, bw, bh, 'انتخاب مرحله', { size: 20 * uk })) {
      this.audio.sfx('ui'); this.goto(VIEWS.LEVELS); return;
    }
    by += bh + gap;
    if (this.ui.button(r, 'editor', bx, by, bw, bh, 'ویرایشگر مرحله', { size: 20 * uk })) {
      this.audio.sfx('ui'); this.c.events.emit('openEditor'); return;
    }
    by += bh + gap;

    // two half-width buttons
    const hw = (bw - gap) / 2;
    if (this.ui.button(r, 'settings', bx, by, hw, (bh - 8) * uk, 'تنظیمات', { variant: 'ghost', size: 17 * uk })) {
      this.audio.sfx('ui'); this.goto(VIEWS.SETTINGS); return;
    }
    if (this.ui.button(r, 'help', bx + hw + gap, by, hw, (bh - 8) * uk, 'راهنما', { variant: 'ghost', size: 17 * uk })) {
      this.audio.sfx('ui'); this.goto(VIEWS.HELP); return;
    }
  }

  // ------------------------------------------------------------------ levels
  drawLevels(r, k) {
    this.header(r, 'انتخاب مرحله', 'مرحله‌ها با پیشرفت شما باز می‌شوند');
    const cols = 5, cw = 168, ch = 104, gap = 14;
    const totalW = cols * cw + (cols - 1) * gap;
    const x0 = 480 - totalW / 2, y0 = 130;

    const prog = this.c.progress;
    const custom = prog.customLevels || [];
    const totalRows = Math.ceil((LEVEL_COUNT + custom.length) / cols);
    const gridH = Math.min(392, totalRows * (ch + gap));
    const maxScroll = Math.max(0, totalRows * (ch + gap) - gridH);

    this.scroll = clamp(this.scroll + this.input.wheel * 40, 0, maxScroll);
    // touch drag scrolling (phones have no wheel)
    const p2 = this.input.pointer;
    if (p2.down && p2.moved) {
      if (this.scrollDrag == null) this.scrollDrag = { y: p2.y, moved: 0 };
    }
    if (this.scrollDrag && p2.down) {
      const dy = p2.y - this.scrollDrag.y;
      this.scrollDrag.y = p2.y;
      this.scrollDrag.moved += Math.abs(dy);
      this.scroll = clamp(this.scroll - dy, 0, maxScroll);
      if (this.scrollDrag.moved > 12) this.suppressClick = true;
    }
    if (!p2.down) { this.scrollDrag = null; }
    if (!p2.down && !p2.pressed) this.suppressClick = false;

    const items = [];
    for (let i = 1; i <= LEVEL_COUNT; i++) items.push({ id: i, def: LEVELS[i - 1], custom: false });
    custom.forEach((c, i) => items.push({ id: 'c' + i, def: { name: c.name || 'دلخواه', rows: c.rows }, custom: true }));

    this.drawLevelGrid(r, items, { x0, y0, cw, ch, gap, cols, gridH, totalW });

    const clickedIdx = this.hitLevelCard(r, items, { x0, y0, cw, ch, gap, cols, gridH });
    if (clickedIdx >= 0) {
      const item = items[clickedIdx];
      const unlocked = item.custom || item.id <= prog.unlocked;
      if (unlocked) {
        this.audio.sfx('select');
        this.c.events.emit('startRun', { levelId: item.id });
        return;
      }
      this.audio.sfx('bad');
    }

    const uk = this.ui.k;
    const bw = 200 * Math.min(uk, 1.3);
    const byy = 640 - 74 * Math.min(uk, 1.3);
    if (this.ui.button(r, 'newlevel', 480 - bw - 10, byy, bw, 44 * Math.min(uk, 1.3), '+ مرحله جدید', { size: 17 * Math.min(uk, 1.3) })) {
      this.audio.sfx('ui'); this.c.events.emit('openEditor'); return;
    }
    if (this.ui.button(r, 'back', 480 + 10, byy, bw, 44 * Math.min(uk, 1.3), 'بازگشت', { variant: 'ghost', size: 17 * Math.min(uk, 1.3) })) {
      this.audio.sfx('ui'); this.goto(VIEWS.MAIN); return;
    }
  }

  /** Draws the level cards and reports hover state. */
  drawLevelGrid(r, items, g) {
    const prog = this.c.progress;
    const p = this.input.pointer;
    const { x0, y0, cw, ch, gap, cols, gridH, totalW } = g;

    r.withClip(x0, y0, totalW, gridH, () => {
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const col = idx % cols, row = (idx / cols) | 0;
        const cx = x0 + col * (cw + gap);
        const cy = y0 + row * (ch + gap) - this.scroll;
        if (cy + ch < y0 || cy > y0 + gridH) continue;

        const unlocked = item.custom || item.id <= prog.unlocked;
        const best = prog.bestByLevel?.[item.id] ?? 0;
        const inside = p.x >= cx && p.x <= cx + cw && p.y >= cy && p.y <= cy + ch;
        const hov = inside && unlocked;
        if (inside) this.ui.hot = 'card.' + idx;

        const bg = hov
          ? r.gradient(0, cy, 0, cy + ch, [[0, '#233355'], [1, '#152036']])
          : r.gradient(0, cy, 0, cy + ch, [[0, '#161f36'], [1, '#0e1526']]);
        r.roundRect(cx, cy, cw, ch, 12, bg, hov ? '#4cc9f0' : unlocked ? '#26375c' : '#1b2338', hov ? 1.8 : 1);

        if (!unlocked) {
          r.text('🔒', cx + cw / 2, cy + ch / 2 - 10, { size: 26, color: '#5d6d92' });
          r.text(`مرحله ${faNum(item.id)}`, cx + cw / 2, cy + ch - 20, { size: 12, color: '#4e5f84' });
          continue;
        }

        r.text(item.custom ? '⭐' : faNum(item.id), cx + 18, cy + 26, {
          size: 24, color: item.custom ? '#ffd166' : '#4cc9f0', align: 'left', weight: '700',
        });
        r.text(item.def.name, cx + cw - 14, cy + 26, { size: 15, color: '#dbe6ff', align: 'right', weight: '700' });
        r.text(best ? `بهترین: ${faNum(best)}` : 'بازی نشده', cx + cw - 14, cy + 52, { size: 12, color: '#7f92bb', align: 'right' });

        const rows = item.def.rows;
        if (rows) {
          const pw = 5.2, ph = 3.2, pg = 0.8;
          r.ctx.save();
          for (let rr2 = 0; rr2 < Math.min(rows.length, 8); rr2++) {
            for (let cc = 0; cc < 16; cc++) {
              const code = rows[rr2]?.[cc];
              if (!code || code === '.') continue;
              r.ctx.globalAlpha = 0.9;
              r.ctx.fillStyle = BRICK_DEFS[code]?.bottom ?? '#666';
              r.ctx.fillRect(cx + 14 + cc * (pw + pg), cy + 64 + rr2 * (ph + pg), pw, ph);
            }
          }
          r.ctx.restore();
        }
      }
    });

    if (totalW > 0 && items.length > cols * Math.floor(gridH / (ch + gap))) {
      const maxScroll = Math.max(1, Math.ceil(items.length / cols) * (ch + gap) - gridH);
      const k = this.scroll / maxScroll;
      const barH = Math.max(30, gridH * (gridH / (Math.ceil(items.length / cols) * (ch + gap))));
      r.roundRect(x0 + totalW + 6, y0 + k * (gridH - barH), 5, barH, 3, '#2c4270');
    }
  }

  /** @returns index of a clicked card, or -1 */
  hitLevelCard(r, items, g) {
    const p = this.input.pointer;
    if (!p.pressed || this.suppressClick) return -1;
    const { x0, y0, cw, ch, gap, cols, gridH } = g;
    for (let idx = 0; idx < items.length; idx++) {
      const col = idx % cols, row = (idx / cols) | 0;
      const cx = x0 + col * (cw + gap);
      const cy = y0 + row * (ch + gap) - this.scroll;
      if (cy + ch < y0 || cy > y0 + gridH) continue;
      if (p.x >= cx && p.x <= cx + cw && p.y >= cy && p.y <= cy + ch) return idx;
    }
    return -1;
  }

  // ------------------------------------------------------------------ settings
  drawSettings(r, k) {
    this.header(r, 'تنظیمات', 'تغییرات فوراً ذخیره می‌شوند');
    const s = this.settings;
    const uk = this.ui.k;
    const x = 300, w = 360;
    let y = 170 * uk;

    s.sfx = this.ui.slider(r, 'sfx', x, y, w, s.sfx, { label: 'صدای افکت', format: (v) => faNum(Math.round(v * 100)) + '٪' });
    y += 58 * uk;
    s.music = this.ui.slider(r, 'music', x, y, w, s.music, { label: 'موسیقی', format: (v) => faNum(Math.round(v * 100)) + '٪' });
    y += 58 * uk;

    s.muted = this.ui.toggle(r, 'muted', x, y, s.muted, { label: 'بی‌صدا کردن همه' });
    y += 48 * uk;
    s.screenShake = this.ui.toggle(r, 'shake', x, y, s.screenShake, { label: 'لرزش صفحه' });
    y += 48 * uk;

    r.text('کنترل راکت', x - 12, y + 14 * uk, { size: 14 * uk, color: '#a9bce0', align: 'right' });
    const modes = [['both', 'هر دو'], ['mouse', 'ماوس'], ['keys', 'کیبورد']];
    const mw = 96 * uk;
    modes.forEach(([id, label], i) => {
      const bx = x + i * (mw + 8 * uk);
      const active = s.control === id;
      if (this.ui.button(r, 'ctl-' + id, bx, y, mw, 34 * uk, label, { variant: active ? 'primary' : 'ghost', size: 14 * uk })) {
        s.control = id;
        this.audio.sfx('ui');
      }
    });
    y += 60 * uk;

    r.text('با «هر دو» می‌توانید هم‌زمان با ماوس و جهت‌نما بازی کنید.', x + w, y + 12, { size: 12 * uk, color: '#6f82a8', align: 'right' });
    y += 52 * uk;

    if (this.ui.button(r, 'reset-progress', 300, y, 220 * uk, 42 * uk, 'پاک کردن رکوردها', { variant: 'danger', size: 16 * uk })) {
      this.c.progress.highScore = 0;
      this.c.progress.unlocked = 1;
      this.c.progress.bestByLevel = {};
      this.c.persistProgress();
      this.audio.sfx('bad');
    }
    if (this.ui.button(r, 'back2', 300 + 240 * uk, y, 120 * uk, 42 * uk, 'بازگشت', { variant: 'ghost', size: 16 * uk })) {
      this.audio.sfx('ui'); this.goto(VIEWS.MAIN); return;
    }

    saveSettings(s);
    this.audio.setSfxVolume(s.sfx);
    this.audio.setMusicVolume(s.music);
    this.audio.setMuted(s.muted);
    this.r.shakeScale = s.screenShake ? 1 : 0;
  }

  // ------------------------------------------------------------------ help
  drawHelp(r, k) {
    this.header(r, 'راهنما', 'چطور بازی کنیم');

    this.ui.panel(r, 90, 130, 380, 250, {});
    r.text('کنترل‌ها', 280, 160, { size: 18, color: '#ffd166', weight: '700' });
    const controls = [
      ['ماوس / لمس', 'حرکت راکت'],
      ['← →  یا  A D', 'حرکت راکت با کیبورد'],
      ['Space / کلیک', 'پرتاب توپ و شلیک لیزر'],
      ['Esc یا P', 'مکث'],
      ['M', 'بی‌صدا'],
      ['F', 'تمام‌صفحه'],
      ['R', 'شروع دوباره مرحله'],
    ];
    controls.forEach(([key, desc], i) => {
      const y = 196 + i * 25;
      r.roundRect(430, y - 11, 28, 22, 5, '#1b2742', '#2c4270', 1);
      r.text(key.split(' ')[0], 444, y, { size: 11, color: '#c3d2ee' });
      r.text(desc, 420, y, { size: 13, color: '#a9bce0', align: 'right' });
    });

    this.ui.panel(r, 490, 130, 380, 250, {});
    r.text('انواع آجر', 680, 160, { size: 18, color: '#ffd166', weight: '700' });
    const kinds = [
      ['1', 'یک ضربه — ۵۰ امتیاز'],
      ['2', 'دو ضربه — ۱۱۰ امتیاز'],
      ['3', 'سه ضربه — ۱۹۰ امتیاز'],
      ['E', 'منفجره — زنجیره‌ای می‌ترکد'],
      ['X', 'فولاد — با توپ شکسته نمی‌شود، فقط لیزر'],
    ];
    kinds.forEach(([code, desc], i) => {
      const y = 198 + i * 30;
      const def = BRICK_DEFS[code];
      r.roundRect(828, y - 11, 30, 20, 4, r.gradient(0, y - 11, 0, y + 9, [[0, def.top], [1, def.bottom]]));
      r.text(desc, 818, y, { size: 13, color: '#a9bce0', align: 'right' });
    });

    this.ui.panel(r, 90, 396, 780, 130, {});
    r.text('پاور‌آپ‌ها', 480, 422, { size: 18, color: '#ffd166', weight: '700' });
    const keys = Object.keys(POWERUPS);
    const pw = 780 / keys.length;
    keys.forEach((key, i) => {
      const def = POWERUPS[key];
      const cx = 90 + pw * i + pw / 2;
      r.circle(cx, 462, 15, def.color + '33', def.color, 1.5);
      drawPowerIcon(r.ctx, def.icon, cx, 462, def.color);
      r.text(def.label, cx, 492, { size: 11, color: '#c3d2ee' });
      r.text(def.desc, cx, 508, { size: 9, color: '#6f82a8' });
    });

    if (this.ui.button(r, 'back3', 380, 552, 200, 44, 'بازگشت', { variant: 'ghost', size: 17 })) {
      this.audio.sfx('ui'); this.goto(VIEWS.MAIN);
    }
  }
}

function makeDemo(rng) {
  const bricks = [];
  const palette = [
    ['#ffb454', '#f0762a'], ['#7ad7ff', '#2b8fd0'], ['#d7a6ff', '#8a4fd6'], ['#ff8a7a', '#e23b3b'],
  ];
  for (let i = 0; i < 26; i++) {
    const [c1, c2] = rng.pick(palette);
    bricks.push({ x: rng.range(-20, 940), y: rng.range(-60, 700), w: rng.range(34, 74), h: rng.range(16, 26), v: rng.range(6, 26), a: rng.range(0.05, 0.16), c1, c2 });
  }
  const blobs = [
    [200, 180, 260, '#4cc9f0', 0.25],
    [780, 420, 300, '#ff5d8f', 0.18],
    [520, 620, 240, '#8a4fd6', 0.3],
  ];
  return { bricks, blobs };
}
