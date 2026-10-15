/**
 * picross.js —— 第 12 款游戏「数织 / Picross」玩法场景
 *
 * 玩法（彩色数织）：
 *   每行每列给一串「带颜色的数字」= 该行/列里连续同色段的长度（空位分段）。
 *   从底部调色板选颜色点格子填色；填错立刻标红（可以改，不设失败）；
 *   把所有格子填对即通关——解出来是一张彩色像素画。
 *
 * 与合集其它款一致的地方：
 *   · 首页卡片 mode:'pickDiff' → enter({pickDiff:true}) 进 BF.DiffPick 难度自选首屏；
 *   · 星级按用时（Gen.starsFor，阈值唯一真源在数据层）；
 *   · 断点续玩走 Save.extraOf('picross').prog（位串存每格状态）；
 *   · 每日挑战 buildDaily()。
 *
 * 本场景特有的几处口径：
 *   1. 格子状态三分：未知(-1) / 标空(-2,画 ✕) / 已填某色(>=0)。
 *      "填错"是**推导**出来的（st 与解不一致），不单独存一份错误集——
 *      改对了自然就不红了，避免"状态与渲染各说各话"。
 *   2. 提示不泄题：只填 1 个「还不正确的格」，优先选完全没填过的格。
 *   3. 行/列填满且填对 → 该线索自动变暗（经典数织的满足感反馈）。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.ScenePicross) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;
  var Gen = BF.PicrossGen;

  var HINTS_PER_LEVEL = 3;
  var LONG_PRESS_MS = 350;
  var HEADER_H = 56;
  var PAL_H = 44;          // 调色板行高（色块 32 + 剩余数 10）
  var SW = 32, SGAP = 7;   // 色块尺寸 / 间距

  /* ---------------- 状态串（存档用）----------------
   * 每格一字符：'.' 未知 / 'x' 标空 / '0'-'9' 已填某色。
   * 与关卡数据里的 base-36（'-' = 空位）是两套语义，别混。 */

  function stateStr(st) {
    var s = '';
    for (var i = 0; i < st.length; i++) {
      var v = st[i];
      s += (v === -1) ? '.' : (v === -2) ? 'x' : v.toString(36);
    }
    return s;
  }

  function applyStateStr(st, s) {
    for (var i = 0; i < st.length; i++) {
      var ch = s.charAt(i);
      st[i] = (ch === '.') ? -1 : (ch === 'x') ? -2 : parseInt(ch, 36);
    }
  }

  function fmtTime(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var m = (s / 60) | 0;
    return m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  /* ---------------- 场景 ---------------- */

  function ScenePicross(app) {
    this.app = app;
    this.press = null;
    this.fadeIn = 1;
    this.t = 0;
    this.cards = [];
    // 玩法状态
    this.pickDiff = false;
    this.isDaily = false;
    this.game = 'picross';
    this.level = 1;
    this.meta = null;
    this.puzzle = null;
    this.n = 5;
    this.cells = [];       // 解（-1 空位 / >=0 颜色）
    this.st = [];          // 玩家状态
    this.rowC = [];
    this.colC = [];
    this.colors = [];
    this.sel = 0;          // 当前工具：颜色序号 / -1 橡皮 / -2 标空
    this.started = false;
    this.elapsed = 0;
    this.hintsLeft = HINTS_PER_LEVEL;
    this.hintUsed = 0;
    this.win = null;
    this.toast = null;
    this.pressBtn = null;
    this.pressCell = -1;
    this.pressHandled = false;
    this.pressMoved = false;
    this.pressAt = 0;
    this.hintFlash = null;
  }

  ScenePicross.prototype.enter = function (params) {
    params = params || {};
    if (params.pickDiff) { return BF.DiffPick.enter(this, params); }
    this.pickDiff = false;
    this.isDaily = !!params.daily;
    this.game = params.game || 'picross';
    this.level = params.level || 1;

    var meta = BF.games && (BF.games[this.game] || BF.games.picross);
    if (!meta) { throw new Error('未注册的游戏: ' + this.game); }
    this.meta = meta;

    this.puzzle = this.isDaily ? meta.buildDaily() : meta.build(this.level);
    if (this.puzzle.daily) { this.isDaily = true; }

    this.n = this.puzzle.n;
    this.cells = this.puzzle.cells.slice();
    var cl = Gen.cluesFor(this.cells, this.n);
    this.rowC = cl.rows;
    this.colC = cl.cols;
    this.colors = Gen.colorsOf(this.cells);

    var N = this.n * this.n;
    this.st = new Array(N).fill(-1);
    this.sel = this.colors.length ? this.colors[0] : 0;
    this.started = false;
    this.elapsed = 0;
    this.hintsLeft = HINTS_PER_LEVEL;
    this.hintUsed = 0;
    this.win = null;
    this.toast = null;
    this.pressBtn = null;
    this.pressCell = -1;
    this.pressHandled = false;
    this.hintFlash = null;

    this.restoreProgress();
    this.layout();
    this.fadeIn = 1;
    this.t = 0;
    // 「玩法说明」弹框：每次进这款游戏的第一个关卡时弹一次（勾过「不再提示」则不弹）
    if (BF.RuleTip.shouldShow(this.game, this)) { BF.RuleTip.enter(this, params); }
    return this;
  };

  ScenePicross.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var top = pf.safeTop;
    this.top = top;
    this.W = W; this.H = H;
    this.headerH = HEADER_H;
    this.headerY = top;
    this.back = { x: 12, y: top + 8, w: 40, h: 40 };

    // 右上：提示 / 重置 两个图标按钮 + 计时
    var bw = 34;
    this.resetBtn = { x: W - 16 - bw, y: top + 11, w: bw, h: bw };
    this.hintBtn = { x: W - 16 - bw - 6 - bw, y: top + 11, w: bw, h: bw };

    // 「?」重看规则按钮：本场景标题是左对齐（x=62 起），不能放返回按钮右侧
    // （会压标题），改放提示按钮左边 6px。
    this.ruleBtn = { x: this.hintBtn.x - 6 - 28, y: this.hintBtn.y + (bw - 28) / 2, w: 28, h: 28 };

    // 调色板行
    var items = this.colors.length + 2;   // 颜色 + 橡皮 + 标空
    var palW = items * SW + (items - 1) * SGAP;
    this.palX = (W - palW) / 2;
    this.palY = H - pf.safeBottom - 10 - PAL_H;
    this.palW = palW;

    // 棋盘区
    var boardTop = top + this.headerH + 6;
    var boardBottom = this.palY - 12;
    var availH = Math.max(80, boardBottom - boardTop);
    var availW = W - 32;

    // 线索区尺寸：按"最多几段"算，字号随格子大小缩放。
    // ⚠️ pickDiff 首屏也会走 layout()，那时还没有题目（rowC/colC 是构造时的空数组），
    //    必须先判空 —— 否则 this.rowC[r] 直接 undefined 崩掉（crash probe 全新场景
    //    一进首屏就复现；smoke 因为前面已进过关、rowC 有旧值，反而测不出来）。
    var maxRow = 3, maxCol = 3, r, c;
    if (this.rowC && this.rowC.length === this.n &&
        this.colC && this.colC.length === this.n) {
      maxRow = 1; maxCol = 1;
      for (r = 0; r < this.n; r++) { maxRow = Math.max(maxRow, this.rowC[r].length); }
      for (c = 0; c < this.n; c++) { maxCol = Math.max(maxCol, this.colC[c].length); }
    }
    /* 线索槽预算：行线索槽最多占可用宽 25%，列线索槽最多占可用高 30%。
     * ⚠️ 字号必须由「槽预算 ÷ 最多段数」反推，不能先定字号再 clamp 槽宽：
     *    15×15 专家档有 10 段的列，写死 clamp(78/76) 会让数字串画出槽外、
     *    从屏幕左侧/顶部飞出去（交互层断言「线索不压棋盘」专盯这个）。 */
    var slotWBudget = Math.min(88, availW * 0.25);
    var slotHBudget = Math.min(195, availH * 0.30);
    var clueSize = U.clamp(Math.floor(Math.min(this.cellGuess(W, availH) * 0.45,
      (slotWBudget - 8) / (maxRow * 1.15), (slotHBudget - 6) / (maxCol * 1.3))), 6, 12);
    var itemW = clueSize * 1.15;
    var rowClueW = U.clamp(maxRow * itemW + 8, 26, slotWBudget);
    var colClueH = U.clamp(maxCol * (clueSize * 1.3) + 6, 20, slotHBudget);

    var cell = Math.floor(Math.min((availW - rowClueW) / this.n,
                                  (availH - colClueH) / this.n));
    cell = U.clamp(cell, 14, 46);
    this.cell = cell;
    this.clueSize = clueSize;
    this.rowClueW = rowClueW;
    this.colClueH = colClueH;

    var gridW = cell * this.n;
    var blockW = rowClueW + gridW;
    var blockX = (W - blockW) / 2;
    this.gridX = blockX + rowClueW;
    this.gridY = boardTop + colClueH + Math.max(0, (availH - colClueH - gridW) / 2);
    this.gridW = gridW;
    this.boardX = blockX;
    this.boardY = this.gridY - colClueH;
    this.boardW = blockW;
    this.boardH = colClueH + gridW;
  };

  /** 粗估格子边长（layout 里线索字号要用，避免互相依赖绕环） */
  ScenePicross.prototype.cellGuess = function (W, availH) {
    return Math.min((W - 32 - 50) / this.n, (availH - 40) / this.n);
  };

  ScenePicross.prototype.cellAt = function (x, y) {
    if (x < this.gridX || y < this.gridY) { return -1; }
    var c = Math.floor((x - this.gridX) / this.cell);
    var r = Math.floor((y - this.gridY) / this.cell);
    if (c < 0 || r < 0 || c >= this.n || r >= this.n) { return -1; }
    return r * this.n + c;
  };

  /* ---------------- 进度存档 ---------------- */

  ScenePicross.prototype.bestTimeOf = function (n) {
    var ex = BF.Save.extraOf(this.game);
    var best = ex.best || {};
    var v = best[String(n)];
    return (typeof v === 'number' && v > 0) ? v : null;
  };

  ScenePicross.prototype.restoreProgress = function () {
    if (this.isDaily) { return; }
    var ex = BF.Save.extraOf(this.game);
    var prog = ex.prog && ex.prog[String(this.level)];
    if (!prog || !prog.s) { return; }
    applyStateStr(this.st, prog.s);
    if (typeof prog.t === 'number' && prog.t > 0) { this.elapsed = prog.t; this.started = true; }
    this.hintUsed = Math.min(HINTS_PER_LEVEL, Math.max(0, prog.h | 0));
    this.hintsLeft = HINTS_PER_LEVEL - this.hintUsed;
    if (this.isSolved()) { this.onSolved(); return; }
    this.showToast('已恢复上次进度');
  };

  ScenePicross.prototype.saveProgress = function () {
    if (this.isDaily || this.win || !this.started) { return; }
    BF.Save.putExtra(this.game, 'prog', (function (self) {
      var ex = BF.Save.extraOf(self.game);
      var prog = ex.prog || {};
      prog[String(self.level)] = {
        s: stateStr(self.st),
        t: Math.round(self.elapsed),
        h: self.hintUsed
      };
      return prog;
    })(this));
  };

  /* ---------------- 规则判定 ---------------- */

  /** 全部填对即通关（解里的空格不能被填色，标 ✕ 无所谓） */
  ScenePicross.prototype.isSolved = function () {
    for (var i = 0; i < this.cells.length; i++) {
      var s = this.cells[i], v = this.st[i];
      if (s >= 0) { if (v !== s) { return false; } }
      else if (v >= 0) { return false; }
    }
    return true;
  };

  /** 填错的格数（推导，不存状态） */
  ScenePicross.prototype.errorCount = function () {
    var n = 0;
    for (var i = 0; i < this.cells.length; i++) {
      var s = this.cells[i], v = this.st[i];
      if (v >= 0 && (s < 0 || s !== v)) { n++; }
    }
    return n;
  };

  ScenePicross.prototype.isWrong = function (i) {
    var s = this.cells[i], v = this.st[i];
    return v >= 0 && (s < 0 || s !== v);
  };

  /** 某行/列是否已填满且填对（线索变暗用） */
  ScenePicross.prototype.lineDone = function (k, isRow) {
    for (var j = 0; j < this.n; j++) {
      var i = isRow ? (k * this.n + j) : (j * this.n + k);
      var s = this.cells[i], v = this.st[i];
      if (s >= 0) { if (v !== s) { return false; } }
      else if (v >= 0) { return false; }
    }
    return true;
  };

  /* ---------------- 操作 ---------------- */

  ScenePicross.prototype.applyTool = function (i) {
    var v = this.st[i];
    if (this.sel === -2) {                       // 标空 / 取消标空
      this.st[i] = (v === -2) ? -1 : -2;
    } else if (this.sel === -1) {                // 橡皮
      this.st[i] = -1;
    } else {                                     // 填色（再点同色 = 擦掉）
      this.st[i] = (v === this.sel) ? -1 : this.sel;
    }
    if (!this.started) { this.started = true; }
    this.afterFill();
  };

  ScenePicross.prototype.afterFill = function () {
    if (this.isSolved()) { this.onSolved(); return; }
    this.saveProgress();
  };

  ScenePicross.prototype.doHint = function () {
    if (this.win) { return; }
    if (this.hintsLeft <= 0) {
      this.showToast('本关提示次数已用完');
      return;
    }
    // 候选分两级：先找"该填色还没填对"的格；颜色全对了才提示"该标空的格"。
    // ⚠️ 不能图省事写成 st[i] !== cells[i]：关卡数据里空位是 -2、玩家未动是 -1，
    //    两者不等会把所有空格都算成候选 → 提示变成给空格打 ✕，而不是填色。
    var cands = [], i;
    for (i = 0; i < this.cells.length; i++) {
      if (this.cells[i] >= 0 && this.st[i] !== this.cells[i]) { cands.push(i); }
    }
    if (!cands.length) {
      for (i = 0; i < this.cells.length; i++) {
        if (this.cells[i] < 0 && this.st[i] !== -2) { cands.push(i); }
      }
    }
    if (!cands.length) { return; }
    // 优先提示"完全没填过"的格，而不是替玩家改错
    var pick = -1;
    for (i = 0; i < cands.length; i++) {
      if (this.st[cands[i]] < 0) { pick = cands[i]; break; }
    }
    if (pick < 0) { pick = cands[0]; }
    if (this.cells[pick] >= 0) { this.st[pick] = this.cells[pick]; }
    else { this.st[pick] = -2; }
    this.hintsLeft--;
    this.hintUsed++;
    if (!this.started) { this.started = true; }
    this.hintFlash = { i: pick, t: 900 };
    this.afterFill();
    this.showToast('已提示 1 格 · 还剩 ' + this.hintsLeft + ' 次');
  };

  ScenePicross.prototype.doReset = function () {
    if (this.win) { return; }
    for (var i = 0; i < this.st.length; i++) { this.st[i] = -1; }
    // 计时不清零：防止"重置刷 ★"
    this.showToast('已清空盘面（计时继续）');
    this.saveProgress();
  };

  ScenePicross.prototype.onSolved = function () {
    var stars = Gen.starsFor(this.puzzle.tier, this.elapsed);
    if (this.isDaily) {
      BF.Save.clearDaily(stars);
    } else {
      BF.Save.clear(this.game, this.level, stars);
      var ex = BF.Save.extraOf(this.game);
      var best = ex.best || {};
      var prev = best[String(this.level)];
      if (prev == null || this.elapsed < prev) { best[String(this.level)] = Math.round(this.elapsed); }
      BF.Save.putExtra(this.game, 'best', best);
      var prog = ex.prog || {};
      delete prog[String(this.level)];
      BF.Save.putExtra(this.game, 'prog', prog);
    }
    this.win = {
      t: 0, stars: stars, press: null,
      time: this.elapsed, best: this.bestTimeOf(this.level)
    };
  };

  ScenePicross.prototype.next = function () {
    if (this.isDaily) { this.app.go('home'); return; }
    if (this.level >= this.meta.TOTAL) { this.app.go('levels', { game: this.game }); return; }
    BF.RuleTip.skipOnce(this);   // 关内进下一关不重复弹规则
    this.enter({ game: this.game, level: this.level + 1 });
  };

  ScenePicross.prototype.showToast = function (msg) {
    this.toast = { msg: msg, t: 1700 };
  };

  /* ---------------- 帧循环 ---------------- */

  ScenePicross.prototype.update = function (dt) {
    if (this.showRule) { return BF.RuleTip.update(this, dt); }
    this.t += dt;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    if (this.pickDiff) { return; }
    if (this.toast) {
      this.toast.t -= dt;
      if (this.toast.t <= 0) { this.toast = null; }
    }
    if (this.hintFlash) {
      this.hintFlash.t -= dt;
      if (this.hintFlash.t <= 0) { this.hintFlash = null; }
    }
    if (this.win) { this.win.t += dt; }
    if (this.started && !this.win) { this.elapsed += dt; }
    // 长按 = 标空（与扫雷长按插旗同手感）
    // ⚠️ 必须写 `!== null && >= 0`：只写 `>= 0` 时 null 会被当成 0（`null >= 0` 为 true），
    //    任何把 pressCell 清成 null 的代码路径都会让下一帧误触发「长按第 0 格」。
    if (this.pressCell !== null && this.pressCell >= 0 && !this.pressHandled && !this.pressMoved) {
      if (BF.platform.now() - this.pressAt >= LONG_PRESS_MS) {
        this.pressHandled = true;
        var v = this.st[this.pressCell];
        this.st[this.pressCell] = (v === -2) ? -1 : -2;
        if (!this.started) { this.started = true; }
        BF.platform.vibrate && BF.platform.vibrate('light');
        this.afterFill();
      }
    }
  };

  /* ---------------- 输入 ---------------- */

  ScenePicross.prototype.onDown = function (x, y) {
    if (this.showRule) { BF.RuleTip.onDown(this, x, y); return; }
    // header 左上角「?」：随时重看玩法说明（无视「不再提示」）
    if (!this.win && !this.gameOver && !this.pickDiff &&
        U.pointInRect(x, y, BF.RuleTip.btn(this))) { BF.RuleTip.enter(this, { force: true }); return; }
    if (this.pickDiff) { BF.DiffPick.onDown(this, x, y); return; }
    if (this.win) {
      var ob = this.overlayLayout();
      if (U.pointInRect(x, y, ob.again)) { this.win.press = 'again'; }
      else if (U.pointInRect(x, y, ob.next)) { this.win.press = 'next'; }
      return;
    }
    this.pressBtn = null;
    if (U.pointInRect(x, y, this.back)) { this.pressBtn = { key: 'back' }; return; }
    if (U.pointInRect(x, y, this.hintBtn)) { this.pressBtn = { key: 'hint' }; return; }
    if (U.pointInRect(x, y, this.resetBtn)) { this.pressBtn = { key: 'reset' }; return; }

    // 调色板
    var sw = this.palItemAt(x, y);
    // ⚠️ 必须判 !== null：调色板第一个颜色序号是 0，`if (sw)` 会把「选红色」吞掉
    //    （红色是每个图案都有的主色，选不了直接没法玩）。
    if (sw !== null) {
      this.sel = sw;
      BF.platform.vibrate && BF.platform.vibrate('light');
      return;
    }

    // 棋盘
    var i = this.cellAt(x, y);
    if (i >= 0) {
      this.pressCell = i;
      this.pressHandled = false;
      this.pressMoved = false;
      this.pressAt = BF.platform.now();
    }
  };

  ScenePicross.prototype.onMove = function (x, y) {
    if (this.pickDiff) { return; }
    if (this.pressCell < 0) { return; }
    var r = (this.pressCell / this.n) | 0, c = this.pressCell % this.n;
    var cx = this.gridX + (c + 0.5) * this.cell;
    var cy = this.gridY + (r + 0.5) * this.cell;
    if (Math.abs(x - cx) > this.cell * 0.6 || Math.abs(y - cy) > this.cell * 0.6) {
      this.pressMoved = true;   // 滑出格外 → 取消本次点击/长按
    }
  };

  ScenePicross.prototype.onUp = function (x, y) {
    if (this.showRule) { BF.RuleTip.onUp(this, x, y); return; }
    if (this.pickDiff) { BF.DiffPick.onUp(this, x, y); return; }
    if (this.win) {
      var p0 = this.win.press;
      this.win.press = null;
      var ob = this.overlayLayout();
      if (p0 === 'again' && U.pointInRect(x, y, ob.again)) {
        BF.RuleTip.skipOnce(this);   // 重玩本关不重复弹规则
        this.enter({ game: this.game, level: this.level, daily: this.isDaily });
      } else if (p0 === 'next' && U.pointInRect(x, y, ob.next)) {
        this.next();
      }
      return;
    }
    var p = this.pressBtn;
    this.pressBtn = null;
    if (p) {
      if (p.key === 'back') { this.app.go(this.isDaily ? 'home' : 'home'); return; }
      if (p.key === 'hint') { this.doHint(); return; }
      if (p.key === 'reset') { this.doReset(); return; }
    }
    var i = this.pressCell;
    var handled = this.pressHandled;
    var moved = this.pressMoved;
    this.pressCell = -1;
    this.pressHandled = false;
    this.pressMoved = false;
    if (i < 0 || handled || moved) { return; }
    if (this.cellAt(x, y) !== i) { return; }
    this.applyTool(i);
  };

  /** 调色板命中：返回颜色序号 / -1 橡皮 / -2 标空；没命中返回 null */
  ScenePicross.prototype.palItemAt = function (x, y) {
    if (y < this.palY || y > this.palY + SW) { return null; }
    var items = this.palItems();
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      if (x >= it.x && x <= it.x + SW) { return it.sel; }
    }
    return null;
  };

  ScenePicross.prototype.palItems = function () {
    // ⚠️ 缓存键必须是**颜色清单本身**，不能只比长度：相邻两关色数相同但配色不同
    //    （如 L31 三色 → L3 三色）时，只比长度会返回上一关的调色板 ——
    //    玩家看到别的关的颜色、且选不中本关的颜色（smoke 9f-1b 专盯这个）。
    var key = this.colors.join(',');
    if (this._palItems && this._palItemsKey === key) { return this._palItems; }
    var items = this.colors.map(function (c) { return { sel: c, x: 0 }; });
    items.push({ sel: -1, x: 0 });
    items.push({ sel: -2, x: 0 });
    for (var k = 0; k < items.length; k++) {
      items[k].x = this.palX + k * (SW + SGAP);
    }
    this._palItems = items;
    this._palItemsKey = key;
    return items;
  };

  ScenePicross.prototype.overlayLayout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var w = Math.min(W - 56, 300), h = 272;
    var x = (W - w) / 2, y = (H - h) / 2 - 10;
    var pad = 20, bw = (w - pad * 2 - 12) / 2;
    return {
      card: { x: x, y: y, w: w, h: h },
      again: { x: x + pad, y: y + h - pad - 48, w: bw, h: 48 },
      next: { x: x + pad + bw + 12, y: y + h - pad - 48, w: bw, h: 48 }
    };
  };

  /* ---------------- 渲染 ---------------- */

  ScenePicross.prototype.render = function (ctx) {
    var W = this.W, H = this.H;

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.bgTop);
    bg.addColorStop(1, T.bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (this.pickDiff) {
      BF.DiffPick.render(ctx, this);
      this.renderFade(ctx, W, H);
      return;
    }

    this.renderHeader(ctx);
    this.renderBoard(ctx);
    this.renderPalette(ctx);
    if (this.win) { this.renderWin(ctx); }
    this.renderToast(ctx);
    this.renderFade(ctx, W, H);
    // 规则弹框画在最上层（主体照常画，被遮罩压暗当背景）
    if (this.showRule) { BF.RuleTip.render(ctx, this); }
  };

  ScenePicross.prototype.renderHeader = function (ctx) {
    var W = this.W;
    var pr = this.pressBtn;

    // 返回
    this.drawIconBtn(ctx, this.back, 'back', pr && pr.key === 'back');
    // 「?」重看规则入口（不再提示后也能随时打开）
    BF.RuleTip.renderBtn(ctx, this);

    // 标题 + 副标题
    var title = this.isDaily ? '数织 · 每日挑战' : ('数织 · 第 ' + this.level + ' 关');
    D.text(ctx, title, 62, this.top + 20, { size: 17, weight: '700', align: 'left' });
    var sub = this.puzzle.tierName + ' · ' + this.n + '×' + this.n +
              ' · ' + this.colors.length + ' 色';
    var errs = this.errorCount();
    if (errs > 0) { sub += ' · 失误 ' + errs; }
    D.text(ctx, sub, 62, this.top + 40,
      { size: 11, color: errs > 0 ? T.warn : T.textSub, align: 'left',
        maxWidth: this.hintBtn.x - 70 });

    // 计时
    D.text(ctx, '⏱ ' + fmtTime(this.elapsed), this.hintBtn.x - 10, this.top + 22,
      { size: 14, weight: '600', align: 'right' });

    // 提示（带剩余次数徽标）/ 重置
    this.drawIconBtn(ctx, this.hintBtn, 'hint', pr && pr.key === 'hint',
      this.hintsLeft > 0 ? String(this.hintsLeft) : null, this.hintsLeft <= 0);
    this.drawIconBtn(ctx, this.resetBtn, 'reset', pr && pr.key === 'reset');
  };

  ScenePicross.prototype.drawIconBtn = function (ctx, r, name, pressed, badge, dim) {
    D.fillRound(ctx, r.x, r.y, r.w, r.h, 10,
      pressed ? '#DCDEE3' : (dim ? '#E4E6EA' : '#F0F2F5'));
    ctx.save();
    if (dim) { ctx.globalAlpha = 0.45; }
    D.icon(ctx, name, r.x + r.w / 2, r.y + r.h / 2, 16, T.text);
    ctx.restore();
    if (badge) {
      var br = 8;
      D.fillRound(ctx, r.x + r.w - br - 1, r.y + 1, br * 2, br * 2, br, T.accent);
      D.text(ctx, badge, r.x + r.w - 1, r.y + br + 1,
        { size: 9.5, weight: '700', color: '#FFFFFF' });
    }
  };

  ScenePicross.prototype.renderBoard = function (ctx) {
    var n = this.n, cell = this.cell, i, r, c;

    // 底板
    D.panel(ctx, this.boardX - 4, this.boardY - 4, this.boardW + 8, this.boardH + 8,
      { radius: 12, fill: '#FFFFFF', shadowBlur: 10, shadowOffsetY: 2 });

    /* ---- 格子 ---- */
    for (r = 0; r < n; r++) {
      for (c = 0; c < n; c++) {
        i = r * n + c;
        var x = this.gridX + c * cell, y = this.gridY + r * cell;
        var v = this.st[i];
        if (v === -1) {
          D.fillRound(ctx, x + 0.5, y + 0.5, cell - 1, cell - 1, Math.max(2, cell * 0.14),
            T.slot);
        } else if (v === -2) {
          D.fillRound(ctx, x + 0.5, y + 0.5, cell - 1, cell - 1, Math.max(2, cell * 0.14),
            '#EDEFF2');
          // ✕
          var m = cell * 0.3, cx = x + cell / 2, cy = y + cell / 2;
          ctx.save();
          ctx.strokeStyle = 'rgba(23,26,31,0.34)';
          ctx.lineWidth = Math.max(1.2, cell * 0.07);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(cx - m, cy - m); ctx.lineTo(cx + m, cy + m);
          ctx.moveTo(cx + m, cy - m); ctx.lineTo(cx - m, cy + m);
          ctx.stroke();
          ctx.restore();
        } else {
          D.fillRound(ctx, x + 0.5, y + 0.5, cell - 1, cell - 1, Math.max(2, cell * 0.16),
            Gen.PALETTE_HEX[v]);
          // 填错：红底 + 白 ✕（改对就自动消失）
          if (this.isWrong(i)) {
            D.fillRound(ctx, x + 0.5, y + 0.5, cell - 1, cell - 1, Math.max(2, cell * 0.16),
              'rgba(201,70,63,0.82)');
            var m2 = cell * 0.28, cx2 = x + cell / 2, cy2 = y + cell / 2;
            ctx.save();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = Math.max(1.4, cell * 0.09);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(cx2 - m2, cy2 - m2); ctx.lineTo(cx2 + m2, cy2 + m2);
            ctx.moveTo(cx2 + m2, cy2 - m2); ctx.lineTo(cx2 - m2, cy2 + m2);
            ctx.stroke();
            ctx.restore();
          }
        }
        // 提示闪光
        if (this.hintFlash && this.hintFlash.i === i) {
          var a = 0.35 + 0.35 * Math.sin(this.t / 90);
          ctx.save();
          ctx.globalAlpha = a;
          ctx.strokeStyle = T.gold;
          ctx.lineWidth = Math.max(2, cell * 0.12);
          D.roundRect(ctx, x + 1, y + 1, cell - 2, cell - 2, Math.max(2, cell * 0.16));
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    /* ---- 网格线（每 5 格加粗，经典数织口径）---- */
    ctx.save();
    for (var k = 0; k <= n; k++) {
      var thick = (n >= 10 && k % 5 === 0);
      ctx.strokeStyle = thick ? 'rgba(23,26,31,0.34)' : 'rgba(23,26,31,0.10)';
      ctx.lineWidth = thick ? 1.4 : 0.7;
      var p = this.gridX + k * cell;
      ctx.beginPath();
      ctx.moveTo(p, this.gridY); ctx.lineTo(p, this.gridY + this.gridW);
      ctx.stroke();
      var q = this.gridY + k * cell;
      ctx.beginPath();
      ctx.moveTo(this.gridX, q); ctx.lineTo(this.gridX + this.gridW, q);
      ctx.stroke();
    }
    ctx.restore();

    /* ---- 行线索（右对齐，填满变暗）---- */
    var size = this.clueSize;
    for (r = 0; r < n; r++) {
      var clue = this.rowC[r];
      var done = this.lineDone(r, true);
      this.drawClueRun(ctx, clue, this.gridX - 5, this.gridY + (r + 0.5) * cell,
        'right', done);
    }
    /* ---- 列线索（底对齐，填满变暗）---- */
    for (c = 0; c < n; c++) {
      var cl2 = this.colC[c];
      var done2 = this.lineDone(c, false);
      this.drawClueRun(ctx, cl2, this.gridX + (c + 0.5) * cell, this.gridY - 4,
        'up', done2);
    }
  };

  /**
   * 画一串线索。dir: 'right' = 横向、右端贴 anchorX、垂直居中于 anchorY；
   *             'up'   = 纵向、下端贴 anchorY、水平居中于 anchorX。
   * 每段是「带颜色的数字」，颜色 = 该段对应的积木颜色。
   */
  ScenePicross.prototype.drawClueRun = function (ctx, clue, anchorX, anchorY, dir, done) {
    var size = this.clueSize;
    var alpha = done ? 0.32 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '700 ' + size + 'px ' + D.FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!clue.length) {
      ctx.fillStyle = 'rgba(23,26,31,0.28)';
      if (dir === 'right') { ctx.fillText('0', anchorX - size * 0.35, anchorY); }
      else { ctx.fillText('0', anchorX, anchorY - size * 0.6); }
      ctx.restore();
      return;
    }
    var step = size * 1.15;
    var total = clue.length * step;
    for (var i = 0; i < clue.length; i++) {
      var col = Gen.PALETTE_HEX[clue[i][0]];
      var txt = String(clue[i][1]);
      if (dir === 'right') {
        var x = anchorX - (total - (i + 0.5) * step);
        ctx.fillStyle = col;
        ctx.fillText(txt, x, anchorY);
      } else {
        var y = anchorY - (total - (i + 0.5) * step);
        ctx.fillStyle = col;
        ctx.fillText(txt, anchorX, y);
      }
    }
    ctx.restore();
  };

  /**
   * 某颜色还剩多少格没填对（调色板色块下面的小数字）。
   * ⚠️ 必须按「解里该色总格数 - 已填对数」算：曾经把 used[s] 写成布尔标志
   *    （used[s] = 1），于是 left = 1 - 已填 → 填越多数字越负，快照里直接显示 -5。
   */
  ScenePicross.prototype.remainCount = function (sel) {
    if (sel < 0) { return 0; }
    var total = 0, done = 0;
    for (var i = 0; i < this.cells.length; i++) {
      if (this.cells[i] === sel) {
        total++;
        if (this.st[i] === sel) { done++; }
      }
    }
    return total - done;
  };

  ScenePicross.prototype.renderPalette = function (ctx) {
    var items = this.palItems();
    var i;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      var x = it.x, y = this.palY;
      var on = (this.sel === it.sel);
      var sc = on ? 1.08 : 1;
      var w = SW * sc, h = SW * sc;
      var xx = x - (w - SW) / 2, yy = y - (h - SW) / 2;

      if (it.sel >= 0) {
        D.fillRound(ctx, xx, yy, w, h, 9, Gen.PALETTE_HEX[it.sel]);
        // 剩余格数
        var left = this.remainCount(it.sel);
        D.text(ctx, String(left), x + SW / 2, y + SW + 7,
          { size: 10, weight: '600', color: T.textSub });
      } else if (it.sel === -1) {
        D.fillRound(ctx, xx, yy, w, h, 9, '#F0F2F5');
        ctx.save();
        ctx.strokeStyle = 'rgba(23,26,31,0.45)';
        ctx.lineWidth = 1.6;
        D.roundRect(ctx, xx + w * 0.28, yy + h * 0.28, w * 0.44, h * 0.44, 3);
        ctx.stroke();
        ctx.restore();
        D.text(ctx, '擦', x + SW / 2, y + SW + 7,
          { size: 10, weight: '600', color: T.textSub });
      } else {
        D.fillRound(ctx, xx, yy, w, h, 9, '#F0F2F5');
        ctx.save();
        ctx.strokeStyle = 'rgba(23,26,31,0.55)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        var m = w * 0.24, cx = x + SW / 2, cy = y + SW / 2;
        ctx.beginPath();
        ctx.moveTo(cx - m, cy - m); ctx.lineTo(cx + m, cy + m);
        ctx.moveTo(cx + m, cy - m); ctx.lineTo(cx - m, cy + m);
        ctx.stroke();
        ctx.restore();
        D.text(ctx, '空', x + SW / 2, y + SW + 7,
          { size: 10, weight: '600', color: T.textSub });
      }
      if (on) {
        ctx.save();
        ctx.strokeStyle = T.accent;
        ctx.lineWidth = 2.2;
        D.roundRect(ctx, xx - 3, yy - 3, w + 6, h + 6, 12);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  ScenePicross.prototype.renderWin = function (ctx) {
    var ob = this.overlayLayout();
    var W = this.W;
    ctx.save();
    ctx.fillStyle = T.scrim;
    ctx.fillRect(0, 0, W, this.H);
    ctx.restore();

    D.panel(ctx, ob.card.x, ob.card.y, ob.card.w, ob.card.h,
      { radius: 22, fill: '#FFFFFF', shadowBlur: 24, shadowOffsetY: 8 });

    var cx = ob.card.x + ob.card.w / 2;
    D.text(ctx, '通关！', cx, ob.card.y + 34, { size: 22, weight: '700' });

    // 星星
    var r = 13, gapx = 40, starY = ob.card.y + 76;
    for (var i = 0; i < 3; i++) {
      var on = i < this.win.stars;
      D.star(ctx, cx + (i - 1) * gapx, starY, r, 0.46,
        on ? T.gold : null, on ? null : 'rgba(23,26,31,0.18)');
    }

    D.text(ctx, '用时 ' + fmtTime(this.win.time), cx, ob.card.y + 118,
      { size: 14, color: T.text });
    D.text(ctx, this.win.best ? ('最佳 ' + fmtTime(this.win.best)) : '首次通关',
      cx, ob.card.y + 140, { size: 12, color: T.textSub });
    if (this.puzzle.name) {
      D.text(ctx, '图案：' + this.puzzle.name, cx, ob.card.y + 164,
        { size: 12, color: T.textSub });
    }

    var pr = this.win.press;
    var last = !this.isDaily && this.level >= this.meta.TOTAL;
    D.button(ctx, ob.again, '再玩一次',
      { fill: pr === 'again' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15 });
    D.button(ctx, ob.next, this.isDaily ? '返回首页' : (last ? '返回关卡' : '下一关'),
      { fill: pr === 'next' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15 });
  };

  ScenePicross.prototype.renderToast = function (ctx) {
    if (!this.toast) { return; }
    var msg = this.toast.msg;
    var w = Math.min(this.W - 60, msg.length * 13 + 36);
    var x = (this.W - w) / 2, y = this.palY - 44;
    D.panel(ctx, x, y, w, 32, { radius: 16, fill: 'rgba(24,27,32,0.86)' });
    D.text(ctx, msg, this.W / 2, y + 16, { size: 12.5, color: '#FFFFFF' });
  };

  ScenePicross.prototype.renderFade = function (ctx, W, H) {
    if (this.fadeIn > 0) {
      ctx.save();
      ctx.globalAlpha = this.fadeIn * 0.85;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  };

  BF.ScenePicross = ScenePicross;
})();
