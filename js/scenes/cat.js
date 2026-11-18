/**
 * cat.js —— 第 14 款游戏「猫猫方块」玩法场景（固定 8 关闯关）
 *
 * 玩法（区域放置版）：
 *   - 棋盘 N×N 被分成 N 个连通彩色区域，每区域一种颜色（区域由生成器划分）。
 *   - 每区域必须放恰好 1 只该色的猫（每種顏色一隻貓）。
 *   - 任意两只猫不能同行、不能同列；不能 8 方向相邻。
 *   - 放置后，与已放猫「同行 / 同列 / 8 邻」的格子自动打 ✕（禁止落子）。
 *   - 点空格放猫（颜色取自所在区域）；点已放的猫可拿起来；点 ✕ 扣 1 颗心。
 *   - 3 颗心用完 → 本关失败重来；全部 N 只猫放对 → 过关进入下一关。
 *   - 底部三按钮：撤销 / 重置 / 提示。评星看放错次数与是否用提示。
 *
 * 结构照抄 pk24.js（enter/layout/update/onDown/onUp/render + 过关弹窗 + 底部按钮 + RuleTip 接入）。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.SceneCat) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;

  /* ---------------- 场景构造 ---------------- */

  function SceneCat(app) {
    this.app = app;
    this.fadeIn = 1;
    this.t = 0;
    this.win = null;
    this.fail = null;
    this.toast = null;
    this.pressBtn = null;
    this.downCell = null;
    this.hintCell = null;
    this.hintT = 0;
    this.cellRects = [];
  }

  /* ---------------- 建关 / 状态 ---------------- */

  SceneCat.prototype.build = function () {
    var b = BF.CatGen.build(this.level);
    this.N = b.size;
    this.region = b.region;          // region[r][c] = 颜色序号
    this.sol = b.sol;                // sol[颜色] = {r,c}
    this.colors = b.colors;
    this.hasCat = make2D(this.N, false);
    this.xmark = make2D(this.N, false);
    this.regionFilled = new Array(this.N).fill(false);
    this.placed = [];                // 放置顺序（撤销用）
    this.count = 0;
    this.recomputeX();
  };

  function make2D(n, v) {
    var a = [];
    for (var r = 0; r < n; r++) {
      var row = [];
      for (var c = 0; c < n; c++) { row.push(v); }
      a.push(row);
    }
    return a;
  }

  SceneCat.prototype.enter = function (params) {
    params = params || {};
    this.game = 'cat';
    this.level = params.level || 1;

    this.build();
    this.hearts = 3;
    this.mistakes = 0;
    this.hintsUsed = 0;
    this.elapsed = 0;
    this.win = null;
    this.fail = null;
    this.toast = null;
    this.hintCell = null;
    this.hintT = 0;
    this.pressBtn = null;
    this.downCell = null;
    this.fadeIn = 1;
    this.t = 0;
    this.layout();

    // 玩法说明弹框：进这款游戏第一次时弹一次（关内「下一关/重试」用 skipOnce 跳过）
    if (BF.RuleTip.shouldShow(this.game, this)) { BF.RuleTip.enter(this, params); }
    return this;
  };

  SceneCat.prototype.recomputeRegionFilled = function () {
    for (var k = 0; k < this.N; k++) { this.regionFilled[k] = false; }
    for (var r = 0; r < this.N; r++) {
      for (var c = 0; c < this.N; c++) {
        if (this.hasCat[r][c]) { this.regionFilled[this.region[r][c]] = true; }
      }
    }
  };

  /** 重算 ✕ 集合：与任一已放猫同行/同列/8 邻的格子禁止落子 */
  SceneCat.prototype.recomputeX = function () {
    var N = this.N;
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) { this.xmark[r][c] = false; }
    }
    for (var pr = 0; pr < N; pr++) {
      for (var pc = 0; pc < N; pc++) {
        if (!this.hasCat[pr][pc]) { continue; }
        var r2, c2;
        for (c2 = 0; c2 < N; c2++) { this.xmark[pr][c2] = true; }   // 同列
        for (r2 = 0; r2 < N; r2++) { this.xmark[r2][pc] = true; }   // 同行
        for (var dr = -1; dr <= 1; dr++) {
          for (var dc = -1; dc <= 1; dc++) {
            r2 = pr + dr; c2 = pc + dc;
            if (r2 >= 0 && c2 >= 0 && r2 < N && c2 < N) { this.xmark[r2][c2] = true; }
          }
        }
      }
    }
    // 已放猫的格子本身不是 ✕（也顺手清掉，避免误判）
    for (r2 = 0; r2 < N; r2++) {
      for (c2 = 0; c2 < N; c2++) { if (this.hasCat[r2][c2]) { this.xmark[r2][c2] = false; } }
    }
  };

  /* ---------------- 布局 ---------------- */

  SceneCat.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var top = pf.safeTop;

    this.headerH = 56;
    this.headerY = top;
    this.back = { x: 12, y: top + 8, w: 40, h: 40 };
    this.ruleBtn = BF.RuleTip.btnRect(this);

    var footerH = 56 + pf.safeBottom;
    var areaTop = top + this.headerH + 26;     // 给状态行留位置
    var areaBot = H - footerH - 14;
    var availH = Math.max(60, areaBot - areaTop);
    var boardSize = Math.min(W - 28, availH);
    this.boardX = (W - boardSize) / 2;
    this.boardY = areaTop + (availH - boardSize) / 2;
    this.cell = boardSize / this.N;
    this.statusY = areaTop - 14;

    // 底部三按钮
    var bw = (W - 24 - 20) / 3, bh = 44;
    var by = H - pf.safeBottom - bh;
    this.btns = [
      { x: 12, y: by, w: bw, h: bh, key: 'undo', label: '撤销', icon: 'undo' },
      { x: 12 + bw + 10, y: by, w: bw, h: bh, key: 'reset', label: '重置', icon: 'reset' },
      { x: 12 + (bw + 10) * 2, y: by, w: bw, h: bh, key: 'hint', label: '提示', icon: 'hint' }
    ];

    // 棋盘命中盒
    this.cellRects = [];
    for (var r = 0; r < this.N; r++) {
      var row = [];
      for (var c = 0; c < this.N; c++) {
        row.push({ x: this.boardX + c * this.cell, y: this.boardY + r * this.cell, w: this.cell, h: this.cell });
      }
      this.cellRects.push(row);
    }
  };

  SceneCat.prototype.cellAt = function (x, y) {
    for (var r = 0; r < this.N; r++) {
      for (var c = 0; c < this.N; c++) {
        if (U.pointInRect(x, y, this.cellRects[r][c])) { return { r: r, c: c }; }
      }
    }
    return null;
  };

  /* ---------------- 更新 ---------------- */

  SceneCat.prototype.update = function (dt) {
    if (this.showRule) { return BF.RuleTip.update(this, dt); }
    this.t += dt;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) { this.toast = null; } }
    if (this.win) { this.win.t += dt; return; }
    if (this.fail) { this.fail.t += dt; return; }
    if (this.hintCell) { this.hintT += dt; }
    this.elapsed += dt;
  };

  /* ---------------- 输入 ---------------- */

  SceneCat.prototype.onDown = function (x, y) {
    if (this.showRule) { BF.RuleTip.onDown(this, x, y); return; }
    if (this.win) {
      var ob = this.overlayLayout();
      this.win.press = null;
      if (U.pointInRect(x, y, ob.home)) { this.win.press = 'home'; return; }
      if (U.pointInRect(x, y, ob.action)) { this.win.press = 'action'; return; }
      return;
    }
    if (this.fail) {
      var fo = this.overlayLayout();
      this.fail.press = null;
      if (U.pointInRect(x, y, fo.home)) { this.fail.press = 'home'; return; }
      if (U.pointInRect(x, y, fo.action)) { this.fail.press = 'action'; return; }
      return;
    }
    if (U.pointInRect(x, y, this.back)) { this.app.go('home'); return; }
    if (!this.isDaily && U.pointInRect(x, y, BF.RuleTip.btn(this))) {
      BF.RuleTip.enter(this, { force: true }); return;
    }
    for (var i = 0; i < this.btns.length; i++) {
      if (U.pointInRect(x, y, this.btns[i])) { this.pressBtn = this.btns[i]; return; }
    }
    this.downCell = this.cellAt(x, y);
  };

  SceneCat.prototype.onUp = function (x, y) {
    if (this.showRule) { BF.RuleTip.onUp(this, x, y); return; }
    if (this.win) {
      var ob = this.overlayLayout();
      var hit = this.win.press; this.win.press = null;
      if (hit === 'home' && U.pointInRect(x, y, ob.home)) { this.app.go('home'); return; }
      if (hit === 'action' && U.pointInRect(x, y, ob.action)) {
        if (this.level < BF.games.cat.TOTAL) {
          BF.RuleTip.skipOnce(this); this.enter({ level: this.level + 1 });
        } else { this.app.go('home'); }
        return;
      }
      return;
    }
    if (this.fail) {
      var fo = this.overlayLayout();
      var fh = this.fail.press; this.fail.press = null;
      if (fh === 'home' && U.pointInRect(x, y, fo.home)) { this.app.go('home'); return; }
      if (fh === 'action' && U.pointInRect(x, y, fo.action)) {
        BF.RuleTip.skipOnce(this); this.enter({ level: this.level }); return;
      }
      return;
    }
    if (this.pressBtn) {
      var btn = this.pressBtn; this.pressBtn = null;
      if (U.pointInRect(x, y, btn)) { this.doAction(btn.key); }
      return;
    }
    if (this.downCell) {
      var cell = this.downCell; this.downCell = null;
      if (U.pointInRect(x, y, this.cellRects[cell.r][cell.c])) { this.tapCell(cell.r, cell.c); }
    }
  };

  SceneCat.prototype.onMove = function () { /* 猫猫方块无需拖动 */ };

  SceneCat.prototype.tapCell = function (r, c) {
    if (this.hasCat[r][c]) {                 // 拿起已放的猫
      this.removeAt(r, c);
      this.showToast('拿起了猫 🐱');
      return;
    }
    if (this.xmark[r][c]) {                  // 点 ✕：放错，扣心
      this.hearts--;
      this.mistakes++;
      this.showToast('放错啦，扣 1 颗心');
      if (this.hearts <= 0) { this.fail = { t: 0, press: null }; }
      return;
    }
    var color = this.region[r][c];
    if (this.regionFilled[color]) {          // 该区域已有猫（友好拦截，不扣心）
      this.showToast('这个区域已经有猫了');
      return;
    }
    // 合法落子
    this.hasCat[r][c] = true;
    this.placed.push({ r: r, c: c });
    this.recomputeRegionFilled();
    this.recomputeX();
    this.count++;
    this.hintCell = null;
    BF.platform.vibrate('light');
    if (this.count === this.N) { this.onSolved(); }
  };

  SceneCat.prototype.removeAt = function (r, c) {
    this.hasCat[r][c] = false;
    for (var i = this.placed.length - 1; i >= 0; i--) {
      if (this.placed[i].r === r && this.placed[i].c === c) { this.placed.splice(i, 1); break; }
    }
    this.recomputeRegionFilled();
    this.recomputeX();
    this.count--;
    this.hintCell = null;
  };

  SceneCat.prototype.doAction = function (key) {
    if (key === 'undo') {
      if (!this.placed.length) { this.showToast('没有可撤销的步骤'); return; }
      var p = this.placed.pop();
      this.hasCat[p.r][p.c] = false;
      this.recomputeRegionFilled();
      this.recomputeX();
      this.count--;
      this.hintCell = null;
    } else if (key === 'reset') {
      this.placed = [];
      for (var r = 0; r < this.N; r++) { for (var c = 0; c < this.N; c++) { this.hasCat[r][c] = false; } }
      this.recomputeRegionFilled();
      this.recomputeX();
      this.count = 0;
      this.hintCell = null;
      this.showToast('已重置本关');
    } else if (key === 'hint') {
      this.doHint();
    }
  };

  SceneCat.prototype.doHint = function () {
    // 找一个还没填满的区域，优先它的解位（当前合法则直接高亮）
    for (var k = 0; k < this.N; k++) {
      if (this.regionFilled[k]) { continue; }
      var sc = this.sol[k];
      if (!this.hasCat[sc.r][sc.c] && !this.xmark[sc.r][sc.c]) {
        this.setHint(sc.r, sc.c); return;
      }
      // 否则找该区域内任意合法空格
      for (var r = 0; r < this.N; r++) {
        for (var c = 0; c < this.N; c++) {
          if (this.region[r][c] === k && !this.hasCat[r][c] && !this.xmark[r][c]) {
            this.setHint(r, c); return;
          }
        }
      }
    }
    this.showToast('需要先把猫拿起来调整');
  };

  SceneCat.prototype.setHint = function (r, c) {
    this.hintCell = { r: r, c: c };
    this.hintT = 0;
    this.hintsUsed++;
    this.showToast('高亮处可以放猫');
  };

  SceneCat.prototype.showToast = function (txt) { this.toast = { text: txt, t: 1600 }; };

  /* ---------------- 评星 / 存档 ---------------- */

  SceneCat.prototype.starsFor = function (mistakes, hintsUsed) {
    var s = mistakes === 0 ? 3 : (mistakes <= 2 ? 2 : 1);
    if (hintsUsed >= 1) { s = Math.min(s, 2); }
    if (hintsUsed >= 2) { s = Math.min(s, 1); }
    return s;
  };

  SceneCat.prototype.onSolved = function () {
    var stars = this.starsFor(this.mistakes, this.hintsUsed);
    BF.Save.clear('cat', this.level, stars);
    this.win = {
      t: 0, stars: stars, press: null,
      sec: Math.round(this.elapsed / 10) / 100
    };
    BF.platform.vibrate('heavy');
  };

  /* ---------------- 渲染 ---------------- */

  SceneCat.prototype.render = function (ctx) {
    var pf = BF.platform, W = pf.width, H = pf.height;

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.bgTop);
    bg.addColorStop(1, T.bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    this.renderHeader(ctx);
    this.renderStatus(ctx);
    this.renderBoard(ctx);
    this.renderFooter(ctx);
    this.renderToast(ctx);
    if (this.win) { this.renderWin(ctx); }
    if (this.fail) { this.renderFail(ctx); }

    if (this.fadeIn > 0) {
      ctx.save();
      ctx.globalAlpha = this.fadeIn * 0.85;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (this.showRule) { BF.RuleTip.render(ctx, this); }
  };

  SceneCat.prototype.renderHeader = function (ctx) {
    var pf = BF.platform, W = pf.width, top = this.headerY;
    D.fillRound(ctx, this.back.x, this.back.y, this.back.w, this.back.h, 14, '#FFFFFF');
    D.roundRect(ctx, this.back.x + 0.5, this.back.y + 0.5, this.back.w - 1, this.back.h - 1, 14);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    D.icon(ctx, 'back', this.back.x + this.back.w / 2, this.back.y + this.back.h / 2, 16, T.text);
    BF.RuleTip.renderBtn(ctx, this);

    D.text(ctx, '猫猫方块', W / 2, top + 17, { size: 18, weight: '700' });
    D.text(ctx, '第 ' + this.level + ' 关 · ' + this.N + '×' + this.N, W / 2, top + 38,
      { size: 11, color: T.textSub, weight: '600' });

    var sec = Math.floor(this.elapsed / 1000);
    D.text(ctx, '⏱ ' + sec + 's', W - 16, top + 16,
      { size: 13, color: T.textSub, weight: '600', align: 'right' });

    // 心（右上第二行，右对齐）
    var hs = 13, gap = 4, total = 3;
    var baseX = W - 16 - hs / 2;
    var y = top + 38 + hs / 2;
    for (var i = 0; i < total; i++) {
      var hx = baseX - i * (hs + gap);
      fillHeart(ctx, hx, y, hs, i < this.hearts);
    }
  };

  SceneCat.prototype.renderStatus = function (ctx) {
    var pf = BF.platform, W = pf.width;
    var txt = '已放 ' + this.count + ' / ' + this.N;
    D.text(ctx, txt, W / 2, this.statusY, { size: 12, color: T.textSub, weight: '600' });
  };

  SceneCat.prototype.renderBoard = function (ctx) {
    var N = this.N;
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var rect = this.cellRects[r][c];
        var color = this.colors[this.region[r][c]];
        // 区域底色（浅色，区域由同色块体现）
        D.fillRound(ctx, rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, this.cell * 0.14,
          U.rgba(color, 0.18));
        // 单元格描边（区域色）
        D.roundRect(ctx, rect.x + 1.5, rect.y + 1.5, rect.w - 3, rect.h - 3, this.cell * 0.14);
        ctx.strokeStyle = U.rgba(color, 0.5);
        ctx.lineWidth = 1;
        ctx.stroke();

        if (this.hasCat[r][c]) {
          drawCat(ctx, rect.x + rect.w / 2, rect.y + rect.h / 2, this.cell, color);
        } else if (this.xmark[r][c]) {
          drawX(ctx, rect);
        }
      }
    }
    // 区域分界线（相邻不同区域之间画白色分隔，让区域形状更清晰）
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1.5, this.cell * 0.05);
    for (var r2 = 0; r2 < N; r2++) {
      for (var c2 = 0; c2 < N; c2++) {
        var rc = this.region[r2][c2];
        if (c2 < N - 1 && this.region[r2][c2 + 1] !== rc) {
          var x = this.cellRects[r2][c2].x + this.cellRects[r2][c2].w;
          ctx.beginPath();
          ctx.moveTo(x, this.cellRects[r2][c2].y + 2);
          ctx.lineTo(x, this.cellRects[r2][c2].y + this.cell - 2);
          ctx.stroke();
        }
        if (r2 < N - 1 && this.region[r2 + 1][c2] !== rc) {
          var y = this.cellRects[r2][c2].y + this.cellRects[r2][c2].h;
          ctx.beginPath();
          ctx.moveTo(this.cellRects[r2][c2].x + 2, y);
          ctx.lineTo(this.cellRects[r2][c2].x + this.cell - 2, y);
          ctx.stroke();
        }
      }
    }
    ctx.restore();

    // 提示高亮（脉冲圆环）
    if (this.hintCell) {
      var hc = this.hintCell;
      var hr = this.cellRects[hc.r][hc.c];
      var pulse = 0.5 + 0.5 * Math.sin(this.hintT / 180);
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.5 * pulse;
      ctx.strokeStyle = T.accent;
      ctx.lineWidth = 3;
      D.roundRect(ctx, hr.x + 3, hr.y + 3, hr.w - 6, hr.h - 6, this.cell * 0.16);
      ctx.stroke();
      ctx.restore();
    }
  };

  SceneCat.prototype.renderFooter = function (ctx) {
    var undoDead = !this.placed.length;
    for (var i = 0; i < this.btns.length; i++) {
      var b = this.btns[i];
      if (b.key === 'undo') {
        D.button(ctx, b, b.label,
          { fill: '#FFFFFF', color: undoDead ? T.textSub : T.text,
            icon: b.icon, iconColor: undoDead ? T.textSub : T.textSub, disabled: undoDead });
      } else if (b.key === 'reset') {
        D.button(ctx, b, b.label, { fill: '#FFFFFF', color: T.text, icon: b.icon, iconColor: T.textSub });
      } else {
        D.button(ctx, b, b.label,
          { fill: U.rgba(T.accent, 0.12), color: T.accent, icon: b.icon, iconColor: T.accent });
      }
    }
  };

  SceneCat.prototype.renderToast = function (ctx) {
    if (!this.toast) { return; }
    var pf = BF.platform;
    var a = Math.min(1, this.toast.t / 320);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 13px ' + D.FONT;
    var w = ctx.measureText(this.toast.text).width + 32;
    var x = (pf.width - w) / 2, y = this.statusY - 26;
    D.fillRound(ctx, x, y, w, 34, 17, 'rgba(28,31,36,0.88)');
    D.text(ctx, this.toast.text, pf.width / 2, y + 17.5, { size: 13, color: '#FFFFFF', weight: '600' });
    ctx.restore();
  };

  SceneCat.prototype.overlayLayout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var w = Math.min(W - 56, 300), h = 244;
    var x = (W - w) / 2, y = (H - h) / 2 - 10;
    var pad = 20, bw = (w - pad * 2 - 12) / 2;
    return {
      card: { x: x, y: y, w: w, h: h },
      home: { x: x + pad, y: y + h - pad - 48, w: bw, h: 48 },
      action: { x: x + pad + bw + 12, y: y + h - pad - 48, w: bw, h: 48 }
    };
  };

  SceneCat.prototype.renderWin = function (ctx) {
    var pf = BF.platform, ob = this.overlayLayout();
    var t = Math.min(1, this.win.t / 260);
    var s = U.easeOutCubic(t);

    ctx.save();
    ctx.globalAlpha = 0.9 * Math.min(1, this.win.t / 200);
    ctx.fillStyle = T.scrim;
    ctx.fillRect(0, 0, pf.width, pf.height);
    ctx.restore();

    var card = ob.card;
    var cw = card.w * (0.86 + 0.14 * s), ch = card.h * (0.86 + 0.14 * s);
    var cx = card.x + (card.w - cw) / 2, cy = card.y + (card.h - ch) / 2;

    ctx.save();
    ctx.globalAlpha = s;
    D.panel(ctx, cx, cy, cw, ch, { radius: 22, shadowBlur: 24, shadowOffsetY: 8 });
    D.text(ctx, '过关啦 🎉', cx + cw / 2, cy + 46, { size: 23, weight: '800', color: T.ok });

    var starY = cy + 98, r = 22, gapx = r * 2.5;
    for (var i = 0; i < 3; i++) {
      var on = i < this.win.stars;
      var delay = U.clamp((this.win.t - 180 - i * 130) / 220, 0, 1);
      var sc = on ? (0.6 + 0.4 * U.easeOutCubic(delay)) * (1 + 0.25 * Math.sin(Math.PI * delay)) : 1;
      D.star(ctx, cx + cw / 2 + (i - 1) * gapx, starY, r * sc, 0.46,
        on ? T.gold : 'rgba(23,26,31,0.10)', 'rgba(23,26,31,0.10)');
    }
    D.text(ctx, '用时 ' + this.win.sec + ' 秒 · 放错 ' + this.mistakes + ' 次' +
      (this.hintsUsed ? ' · 用了提示' : ''),
      cx + cw / 2, cy + 150, { size: 12.5, color: T.textSub });

    var k = cw / card.w;
    var rh = { x: cx + (ob.home.x - card.x) * k, y: cy + (ob.home.y - card.y) * k,
               w: ob.home.w * k, h: ob.home.h * k };
    var ra = { x: cx + (ob.action.x - card.x) * k, y: cy + (ob.action.y - card.y) * k,
               w: ob.action.w * k, h: ob.action.h * k };
    var pr = this.win.press;
    var last = this.level >= BF.games.cat.TOTAL;
    D.button(ctx, rh, '返回首页', { fill: pr === 'home' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15 });
    D.button(ctx, ra, last ? '完成' : '下一关',
      { fill: pr === 'action' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15, shadow: true });
    ctx.restore();
  };

  SceneCat.prototype.renderFail = function (ctx) {
    var pf = BF.platform, ob = this.overlayLayout();
    var t = Math.min(1, this.fail.t / 260);
    var s = U.easeOutCubic(t);

    ctx.save();
    ctx.globalAlpha = 0.9 * Math.min(1, this.fail.t / 200);
    ctx.fillStyle = T.scrim;
    ctx.fillRect(0, 0, pf.width, pf.height);
    ctx.restore();

    var card = ob.card;
    var cw = card.w * (0.86 + 0.14 * s), ch = card.h * (0.86 + 0.14 * s);
    var cx = card.x + (card.w - cw) / 2, cy = card.y + (card.h - ch) / 2;

    ctx.save();
    ctx.globalAlpha = s;
    D.panel(ctx, cx, cy, cw, ch, { radius: 22, shadowBlur: 24, shadowOffsetY: 8 });
    D.text(ctx, '本关失败', cx + cw / 2, cy + 52, { size: 23, weight: '800', color: '#E5484D' });
    D.text(ctx, '心用完了，再试一次吧', cx + cw / 2, cy + 92,
      { size: 13, color: T.textSub });
    D.text(ctx, '已放 ' + this.count + ' / ' + this.N + ' 只猫',
      cx + cw / 2, cy + 116, { size: 12, color: T.textSub });

    var k = cw / card.w;
    var rh = { x: cx + (ob.home.x - card.x) * k, y: cy + (ob.home.y - card.y) * k,
               w: ob.home.w * k, h: ob.home.h * k };
    var ra = { x: cx + (ob.action.x - card.x) * k, y: cy + (ob.action.y - card.y) * k,
               w: ob.action.w * k, h: ob.action.h * k };
    var pr = this.fail.press;
    D.button(ctx, rh, '返回首页', { fill: pr === 'home' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15 });
    D.button(ctx, ra, '重新挑战',
      { fill: pr === 'action' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15, shadow: true });
    ctx.restore();
  };

  /* ---------------- 绘制小工具 ---------------- */

  function fillHeart(ctx, x, y, s, filled) {
    ctx.save();
    ctx.fillStyle = filled ? '#FF6B6B' : '#D2D6DC';
    var lobe = s * 0.26;
    ctx.beginPath();
    ctx.arc(x - s * 0.18, y - s * 0.02, lobe, 0, Math.PI * 2);   // 左心瓣
    ctx.arc(x + s * 0.18, y - s * 0.02, lobe, 0, Math.PI * 2);   // 右心瓣
    ctx.fill();
    ctx.beginPath();                                              // 下方尖角
    ctx.moveTo(x - s * 0.42, y + s * 0.02);
    ctx.lineTo(x + s * 0.42, y + s * 0.02);
    ctx.lineTo(x, y + s * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawCat(ctx, cx, cy, s, color) {
    var R = s * 0.30;
    ctx.save();
    ctx.shadowColor = 'rgba(23,26,31,0.18)';
    ctx.shadowBlur = Math.max(2, s * 0.06);
    ctx.shadowOffsetY = Math.max(1, s * 0.02);
    ctx.fillStyle = color;
    // 左耳
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.78, cy - R * 0.40);
    ctx.lineTo(cx - R * 0.18, cy - R * 1.08);
    ctx.lineTo(cx - R * 0.02, cy - R * 0.30);
    ctx.closePath(); ctx.fill();
    // 右耳
    ctx.beginPath();
    ctx.moveTo(cx + R * 0.78, cy - R * 0.40);
    ctx.lineTo(cx + R * 0.18, cy - R * 1.08);
    ctx.lineTo(cx + R * 0.02, cy - R * 0.30);
    ctx.closePath(); ctx.fill();
    // 头
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 白色描边让猫在浅色区域上更立体
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 眼睛
    var eyeY = cy - R * 0.04, eyeDx = R * 0.38, er = R * 0.17;
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(cx - eyeDx, eyeY, er, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + eyeDx, eyeY, er, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2C3138';
    ctx.beginPath(); ctx.arc(cx - eyeDx, eyeY, er * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + eyeDx, eyeY, er * 0.5, 0, Math.PI * 2); ctx.fill();
    // 鼻子
    ctx.fillStyle = '#E5748B';
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.10, cy + R * 0.20);
    ctx.lineTo(cx + R * 0.10, cy + R * 0.20);
    ctx.lineTo(cx, cy + R * 0.34);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawX(ctx, rect) {
    var m = rect.w * 0.28;
    var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(229,72,69,0.92)';
    ctx.lineWidth = Math.max(2, rect.w * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - m, cy - m); ctx.lineTo(cx + m, cy + m);
    ctx.moveTo(cx + m, cy - m); ctx.lineTo(cx - m, cy + m);
    ctx.stroke();
    ctx.restore();
  }

  BF.SceneCat = SceneCat;
})();
