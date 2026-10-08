/**
 * levels.js —— 关卡选择（可滚动，带惯性 + 锁定态）
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.SceneLevels) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;

  var COLS = 5;

  function SceneLevels(app) {
    this.app = app;
    this.scroll = 0;
    this.vel = 0;
    this.dragging = false;
    this.fadeIn = 1;
    this.press = null;
    this.tapFx = null;
  }

  SceneLevels.prototype.enter = function (params) {
    params = params || {};
    this.game = params.game || 'block';
    this.meta = (BF.games && (BF.games[this.game] || BF.games.block));
    if (!this.meta) { throw new Error('未注册的游戏: ' + this.game); }
    this.total = this.meta.TOTAL;

    this.layout();
    this.fadeIn = 1;
    this.vel = 0;
    // 打开时自动滚到当前进度
    var unlocked = BF.Save.unlockedOf(this.game);
    var row = Math.floor((unlocked - 1) / COLS);
    var target = -(row * (this.cell.h + this.gap)) + 40;
    this.scroll = U.clamp(target, this.minScroll, 0);
    return this;
  };

  SceneLevels.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    this.top = pf.safeTop;
    this.bottom = H - pf.safeBottom;

    this.back = { x: 12, y: this.top + 6, w: 40, h: 40 };

    this.listTop = this.top + 96;
    this.listBottom = this.bottom - 8;
    this.viewH = this.listBottom - this.listTop;

    var availW = W - 32;
    var gap = 10;
    var bw = (availW - gap * (COLS - 1)) / COLS;
    this.gap = gap;
    this.cell = { w: bw, h: bw * 1.0 };
    this.gridX = 16;
    this.rows = Math.ceil(this.total / COLS);
    this.contentH = this.rows * (this.cell.h + gap) - gap;
    this.minScroll = Math.min(0, this.viewH - this.contentH - 8);
  };

  SceneLevels.prototype.update = function (dt) {
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    if (this.tapFx) { this.tapFx.t -= dt; if (this.tapFx.t <= 0) { this.tapFx = null; } }
    if (!this.dragging && Math.abs(this.vel) > 0.4) {
      this.scroll += this.vel * (dt / 16);
      this.vel *= Math.pow(0.94, dt / 16);
      if (this.scroll > 0) { this.scroll = 0; this.vel = 0; }
      if (this.scroll < this.minScroll) { this.scroll = this.minScroll; this.vel = 0; }
    }
  };

  SceneLevels.prototype.rectOf = function (n) {
    var i = n - 1;
    var r = Math.floor(i / COLS), c = i % COLS;
    return {
      x: this.gridX + c * (this.cell.w + this.gap),
      y: this.listTop + r * (this.cell.h + this.gap) + this.scroll,
      w: this.cell.w,
      h: this.cell.h
    };
  };

  SceneLevels.prototype.onDown = function (x, y) {
    if (U.pointInRect(x, y, this.back)) { this.press = { kind: 'back' }; return; }
    this.dragging = true;
    this.dragStartY = y;
    this.scrollStart = this.scroll;
    this.vel = 0;
    this.moved = 0;
    this.downPos = { x: x, y: y };
    this.press = null;
  };

  SceneLevels.prototype.onMove = function (x, y) {
    if (!this.dragging) { return; }
    var dy = y - this.dragStartY;
    this.moved = Math.max(this.moved, Math.abs(dy));
    this.scroll = U.clamp(this.scrollStart + dy, this.minScroll, 0);
    this.vel = (y - this.dragStartY) - (this.scroll - this.scrollStart);
    this.vel = dy * 0.35;
  };

  SceneLevels.prototype.onUp = function (x, y) {
    if (this.press && this.press.kind === 'back') {
      this.press = null;
      if (U.pointInRect(x, y, this.back)) { this.app.go('home'); }
      return;
    }
    if (!this.dragging) { return; }
    this.dragging = false;
    if (this.moved < 8) {
      var n = this.hitLevel(x, y);
      if (n) {
        if (n <= BF.Save.unlockedOf(this.game)) {
          this.app.go('play', { level: n, game: this.game });
        } else {
          this.tapFx = { rect: this.rectOf(n), t: 420 };
        }
      }
    }
  };

  SceneLevels.prototype.hitLevel = function (x, y) {
    for (var n = 1; n <= this.total; n++) {
      var r = this.rectOf(n);
      if (r.y + r.h < this.listTop - 10 || r.y > this.listBottom + 10) { continue; }
      if (U.pointInRect(x, y, r)) { return n; }
    }
    return null;
  };

  SceneLevels.prototype.render = function (ctx) {
    var pf = BF.platform, W = pf.width, H = pf.height;

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.bgTop);
    bg.addColorStop(1, T.bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 头部
    D.fillRound(ctx, this.back.x, this.back.y, this.back.w, this.back.h, 14, '#FFFFFF');
    D.roundRect(ctx, this.back.x + 0.5, this.back.y + 0.5, this.back.w - 1, this.back.h - 1, 14);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    D.icon(ctx, 'back', this.back.x + 20, this.back.y + 20, 16, T.text);

    var cleared0 = BF.Save.clearedCount(this.game);
    var unlockedTo = BF.Save.unlockedOf(this.game);

    D.text(ctx, this.meta.title, 20, this.top + 20, { size: 22, weight: '700', align: 'left' });
    D.text(ctx, '已通关 ' + cleared0 + ' / ' + this.total +
      '　·　★ ' + BF.Save.totalStars(this.game),
      20, this.top + 46, { size: 12, color: T.textSub, align: 'left' });

    // 进度条
    var pct = cleared0 / this.total;
    var barX = 20, barY = this.top + 66, barW = W - 40, barH = 6;
    D.fillRound(ctx, barX, barY, barW, barH, 3, 'rgba(23,26,31,0.08)');
    if (pct > 0) {
      D.fillRound(ctx, barX, barY, Math.max(6, barW * pct), barH, 3, T.accent);
    }

    // 列表（裁剪）
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.listTop - 6, W, this.viewH + 12);
    ctx.clip();

    for (var n = 1; n <= this.total; n++) {
      var r = this.rectOf(n);
      if (r.y + r.h < this.listTop - 60 || r.y > this.listBottom + 60) { continue; }
      var unlocked = n <= unlockedTo;
      var stars = BF.Save.starsOf(this.game, n);
      var cleared = BF.Save.isCleared(this.game, n);
      var isTap = this.tapFx && this.tapFx.rect && Math.abs(this.tapFx.rect.y - r.y) < 1;

      var fill = '#FFFFFF';
      var ink = T.text;
      if (!unlocked) { fill = '#E4E7EB'; ink = '#A7ACB4'; }
      else if (cleared) { fill = '#FFFFFF'; }

      if (isTap) { fill = '#FFE9E7'; }

      D.panel(ctx, r.x, r.y, r.w, r.h, {
        radius: 14, fill: fill, shadowBlur: unlocked ? 7 : 0, shadowOffsetY: 2,
        edgeColor: cleared ? U.rgba(T.accent, 0.45) : T.panelEdge
      });

      if (!unlocked) {
        D.icon(ctx, 'lock', r.x + r.w / 2, r.y + r.h / 2, r.w * 0.30, ink, { alpha: 0.75 });
      } else {
        D.text(ctx, String(n), r.x + r.w / 2, r.y + r.h / 2 - (cleared ? 4 : 0),
          { size: r.w * 0.34, weight: '700', color: cleared ? T.accent : T.text });
        if (cleared) {
          for (var s = 0; s < 3; s++) {
            D.star(ctx, r.x + r.w / 2 + (s - 1) * r.w * 0.22, r.y + r.h - r.h * 0.20,
              r.w * 0.085, 0.46, s < stars ? T.gold : 'rgba(23,26,31,0.12)');
          }
        }
      }
    }
    ctx.restore();

    // 上下渐隐遮罩
    var mh = 22;
    var g1 = ctx.createLinearGradient(0, this.listTop - 6, 0, this.listTop - 6 + mh);
    g1.addColorStop(0, T.bg);
    g1.addColorStop(1, 'rgba(239,241,244,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, this.listTop - 6, W, mh);
    var g2 = ctx.createLinearGradient(0, this.listBottom + 6 - mh, 0, this.listBottom + 6);
    g2.addColorStop(0, 'rgba(239,241,244,0)');
    g2.addColorStop(1, T.bg);
    ctx.fillStyle = g2;
    ctx.fillRect(0, this.listBottom + 6 - mh, W, mh);

    // 滚动条
    if (this.contentH > this.viewH) {
      var trackH = this.viewH;
      var thumbH = Math.max(28, trackH * (this.viewH / this.contentH));
      var p = this.minScroll === 0 ? 0 : this.scroll / this.minScroll;
      var ty = this.listTop + (trackH - thumbH) * p;
      D.fillRound(ctx, W - 8, this.listTop, 3, trackH, 1.5, 'rgba(23,26,31,0.06)');
      D.fillRound(ctx, W - 8, ty, 3, thumbH, 1.5, 'rgba(23,26,31,0.20)');
    }

    // 提示
    var tip = '全部 ' + this.total + ' 关 · 拖动可滚动';
    if (this.rows > 4) {
      D.text(ctx, tip, W / 2, this.bottom - 4, { size: 11, color: T.textSub, alpha: 0.8 });
    }

    if (this.fadeIn > 0) {
      ctx.save();
      ctx.globalAlpha = this.fadeIn * 0.85;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  };

  BF.SceneLevels = SceneLevels;
})();
