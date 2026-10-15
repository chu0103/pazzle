/**
 * mine.js —— 第 11 款游戏「扫雷」玩法场景
 *
 * 玩法：点格翻开 / 翻到 0 洪水展开 / 长按或「标记模式」插旗 / 数字上旗满双击 chord /
 *       翻到雷即失败（全雷显形 + 红闪）/ 避开所有雷即通关。首点必安全 + 全程免猜。
 *
 * 交互：
 *   - 点空格：翻开（首点触发运行时生成免猜棋盘）；
 *   - 「标记模式」开关：开启后点格 = 插旗 / 取消旗（移动端主用）；
 *   - 长按空格：插旗 / 取消旗（快捷，免切模式）；
 *   - 已翻开的数字、且已插旗数 === 数字 → 再点它 = chord（一次展开周围未插旗的格）；
 *   - 「提示」每关 3 次：用演绎求解器推一个**必然安全**的格翻开（或必然雷的格插旗）；
 *   - 「重置」：退回首点前的空白态（计时不清零，防刷 ★）；
 *   - 星级按用时（数据层 Gen.starsFor 单一真源）；最佳用时与断点续玩存存档 extra。
 *
 * 难度自选首屏：与移车出库 / 找不同 / 超级积木 / 数独共用 BF.DiffPick（见其头注释五步接入）。
 *
 * 结构照抄 sudoku.js（enter/layout/update/onDown/onUp/render + overlayLayout/renderWin
 * + next()），绘制全用 D.* / U.*。棋盘生成逻辑下沉到 BF.MineGen，场景只管状态机与渲染。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
         : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.SceneMine) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;
  var Gen = BF.MineGen;

  var HINTS_PER_LEVEL = 3;
  var LONG_PRESS_MS = 350;

  // 数字配色（经典扫雷：1 蓝 2 绿 3 红 4 靛 5 褐 6 青 7 近黑 8 灰）
  var NUM_COLORS = ['', '#1976D2', '#388E3C', '#D32F2F', '#512DA8',
                    '#B23A1E', '#00838F', '#263238', '#607D8B'];

  function fmtTime(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var m = (s / 60) | 0;
    var ss = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
  }

  function SceneMine(app) {
    this.app = app;
    this.fadeIn = 1;
    this.t = 0;
    this.win = null;
    this.toast = null;
    this.pressBtn = null;
    this.pickDiff = false;
    this.pickCards = null;
    this.pressCell = null;       // 长按检测：按下时记录格
    this.pressStart = 0;
    this.pressHandled = false;   // 长按已处理（插旗）→ 抬起不再翻开
  }

  /* ---------------- 进入 ---------------- */

  SceneMine.prototype.enter = function (params) {
    params = params || {};
    if (params.pickDiff) { return BF.DiffPick.enter(this, params); }
    this.pickDiff = false;
    this.isDaily = !!params.daily;
    this.game = params.game || 'mine';
    this.level = params.level || 1;

    var meta = BF.games && (BF.games[this.game] || BF.games.mine);
    if (!meta) { throw new Error('未注册的游戏: ' + this.game); }
    this.meta = meta;

    this.puzzle = this.isDaily ? meta.buildDaily() : meta.build(this.level);
    if (this.puzzle.daily) { this.isDaily = true; }

    this.n = this.puzzle.n;
    this.m = this.puzzle.m;
    this.seed = this.puzzle.seed;
    this.N = this.n * this.n;

    this.mines = null;            // 未首点 → 还没生成棋盘
    this.nums = null;
    this.revealed = new Array(this.N).fill(false);
    this.flagged = new Array(this.N).fill(false);
    this.flagsPlaced = 0;
    this.firstClick = -1;
    this.started = false;
    this.gameOver = false;
    this.exploded = -1;
    this.markMode = false;
    this.hintsLeft = HINTS_PER_LEVEL;
    this.hintUsed = 0;
    this.elapsed = 0;
    this.win = null;
    this.losePress = null;
    this.toast = null;
    this.pressBtn = null;
    this.pressCell = null;
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

  /* ---------------- 断点续玩 / 存档 ---------------- */

  function maskOf(arr) {
    var s = '';
    for (var i = 0; i < arr.length; i++) { s += arr[i] ? '1' : '0'; }
    return s;
  }
  function applyMask(arr, str) {
    for (var i = 0; i < arr.length; i++) { arr[i] = str && str.charAt(i) === '1'; }
  }

  SceneMine.prototype.restoreProgress = function () {
    if (this.isDaily) { return; }
    var ex = BF.Save.extraOf(this.game);
    var prog = ex.prog && ex.prog[String(this.level)];
    if (!prog || prog.fc == null) { return; }
    this.generateMines(prog.fc | 0);
    applyMask(this.revealed, prog.r);
    applyMask(this.flagged, prog.f);
    var fp = 0;
    for (var i = 0; i < this.N; i++) { if (this.flagged[i]) { fp++; } }
    this.flagsPlaced = fp;
    if (typeof prog.t === 'number' && prog.t > 0) { this.elapsed = prog.t; this.started = true; }
    this.hintUsed = Math.min(HINTS_PER_LEVEL, Math.max(0, prog.h | 0));
    this.hintsLeft = HINTS_PER_LEVEL - this.hintUsed;
    this.afterReveal(true);
    if (!this.win && !this.gameOver) { this.showToast('已恢复上次进度'); }
  };

  SceneMine.prototype.saveProgress = function () {
    if (this.isDaily || this.win || this.gameOver || !this.started) { return; }
    var ex = BF.Save.extraOf(this.game);
    var prog = ex.prog || {};
    prog[String(this.level)] = {
      fc: this.firstClick,
      r: maskOf(this.revealed),
      f: maskOf(this.flagged),
      t: Math.round(this.elapsed),
      h: this.hintUsed
    };
    BF.Save.putExtra(this.game, 'prog', prog);
  };

  SceneMine.prototype.bestTimeOf = function (n) {
    var ex = BF.Save.extraOf(this.game);
    var best = ex.best || {};
    var v = best[String(n)];
    return (typeof v === 'number' && v > 0) ? v : null;
  };

  /* ---------------- 生成棋盘 ---------------- */

  /** 首点触发：运行时生成免猜棋盘（保证首点 + 邻域无雷） */
  SceneMine.prototype.generateMines = function (firstClick) {
    if (this.mines && this.firstClick === firstClick) { return; }
    var b = Gen.genBoard(this.n, this.m, this.seed, firstClick);
    if (!b) {
      // 兜底：极端随机下 genBoard 减雷，理论上不会走到；走到也仍能玩
      b = Gen.genBoard(this.n, Math.max(1, this.m - 1), this.seed, firstClick);
    }
    this.mines = b.mines;
    this.nums = b.nums;
    this.firstClick = firstClick;
    this.revealed = new Array(this.N).fill(false);
    this.flagged = new Array(this.N).fill(false);
    this.flagsPlaced = 0;
  };

  /* ---------------- 布局 ---------------- */

  SceneMine.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var top = pf.safeTop;

    this.headerH = 52;
    this.headerY = top;
    this.back = { x: 12, y: top + 6, w: 40, h: 40 };

    // 底部动作行
    var actH = 46, gap = 8, pad = 12;
    var actY = H - pf.safeBottom - 10 - actH;

    var boardTop = top + this.headerH + 8;
    var boardBottom = actY - 10;
    var avail = boardBottom - boardTop;
    var cell = Math.floor(Math.min((W - 20) / this.n, avail / this.n));
    if (cell < 20) { cell = 20; }
    if (cell > 46) { cell = 46; }
    var bw = cell * this.n;
    this.cell = cell;
    this.boardW = bw;
    this.boardX = (W - bw) / 2;
    this.boardY = boardTop + Math.max(0, (avail - bw) / 2);

    var aw = (W - pad * 2 - gap * 3) / 4;
    // 标记 / 提示 / 重置 / 续玩清空（重开）
    this.actBtns = [
      { key: 'mark', label: '标记' },
      { key: 'hint', label: '提示' },
      { key: 'reset', label: '重置' },
      { key: 'restart', label: '重开' }
    ].map(function (b, i) {
      return { key: b.key, label: b.label, x: pad + i * (aw + gap), y: actY, w: aw, h: actH };
    });
  };

  /* ---------------- 更新 ---------------- */

  SceneMine.prototype.update = function (dt) {
    if (this.showRule) { return BF.RuleTip.update(this, dt); }
    this.t += dt;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) { this.toast = null; } }
    if (this.hintFlash) { this.hintFlash.t -= dt; if (this.hintFlash.t <= 0) { this.hintFlash = null; } }
    if (this.pickDiff) { return; }
    if (this.win) { this.win.t += dt; return; }
    // 长按 → 插旗（免切标记模式）
    if (this.pressCell != null && !this.pressHandled && !this.gameOver && !this.win) {
      if (BF.platform.now() - this.pressStart >= LONG_PRESS_MS) {
        this.flagAt(this.pressCell);
        this.pressHandled = true;
      }
    }
    if (this.started && !this.win && !this.gameOver) { this.elapsed += dt; }
  };

  /* ---------------- 输入 ---------------- */

  SceneMine.prototype.cellAt = function (x, y) {
    var c = this.cell;
    if (x < this.boardX || y < this.boardY ||
        x >= this.boardX + this.boardW || y >= this.boardY + this.boardW) { return -1; }
    var gx = Math.floor((x - this.boardX) / c), gy = Math.floor((y - this.boardY) / c);
    return gy * this.n + gx;
  };

  SceneMine.prototype.onDown = function (x, y) {
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
    if (this.gameOver) {
      var obl = this.overlayLayout();
      if (U.pointInRect(x, y, obl.again)) { this.losePress = 'again'; }
      else if (U.pointInRect(x, y, obl.next)) { this.losePress = 'next'; }
      return;
    }
    if (U.pointInRect(x, y, this.back)) { this.pressBtn = { key: 'back' }; return; }
    for (var a = 0; a < this.actBtns.length; a++) {
      if (U.pointInRect(x, y, this.actBtns[a])) { this.pressBtn = { key: this.actBtns[a].key }; return; }
    }
    var idx = this.cellAt(x, y);
    if (idx >= 0) {
      this.pressCell = idx;
      this.pressStart = BF.platform.now();
      this.pressHandled = false;
    }
  };

  SceneMine.prototype.onMove = function (x, y) {
    if (this.pickDiff) { return; }
    // 手指滑出原格 → 取消长按（避免误插旗）
    if (this.pressCell != null && this.cellAt(x, y) !== this.pressCell) {
      this.pressCell = null;
    }
  };

  SceneMine.prototype.onUp = function (x, y) {
    if (this.showRule) { BF.RuleTip.onUp(this, x, y); return; }
    if (this.pickDiff) { BF.DiffPick.onUp(this, x, y); return; }

    if (this.win) {
      var ob = this.overlayLayout(), p0 = this.win.press;
      this.win.press = null;
      if (!p0) { return; }
      if (p0 === 'again' && U.pointInRect(x, y, ob.again)) {
        BF.RuleTip.skipOnce(this);   // 重玩本关不重复弹规则
        this.enter({ game: this.game, level: this.level, daily: this.isDaily });
      } else if (p0 === 'next' && U.pointInRect(x, y, ob.next)) {
        this.next();
      }
      return;
    }

    if (this.gameOver) {
      var obl = this.overlayLayout(), pl = this.losePress;
      this.losePress = null;
      if (!pl) { return; }
      if (pl === 'again' && U.pointInRect(x, y, obl.again)) {
        BF.RuleTip.skipOnce(this);   // 重玩本关不重复弹规则
        this.enter({ game: this.game, level: this.level, daily: this.isDaily });
      } else if (pl === 'next' && U.pointInRect(x, y, obl.next)) {
        this.app.go('home');
      }
      return;
    }

    var p = this.pressBtn;
    this.pressBtn = null;
    if (p) {
      if (p.key === 'back') {
        if (U.pointInRect(x, y, this.back)) { this.app.go('home'); }
        return;
      }
      var btn = null;
      for (var a = 0; a < this.actBtns.length; a++) {
        if (this.actBtns[a].key === p.key) { btn = this.actBtns[a]; break; }
      }
      if (btn && U.pointInRect(x, y, btn)) { this.doAction(p.key); }
      return;
    }

    var idx = this.pressCell;
    this.pressCell = null;
    if (idx == null || this.cellAt(x, y) !== idx) { return; }
    if (this.pressHandled) { return; }          // 长按已插旗，抬起不再翻开
    if (this.gameOver) { return; }
    if (this.markMode) { this.flagAt(idx); }
    else { this.revealAt(idx); }
  };

  /* ---------------- 核心动作（输入层 + 测试都走这里） ---------------- */

  /** 翻开一格（首点会触发棋盘生成）。已翻开的数字且旗满 → chord。 */
  SceneMine.prototype.revealAt = function (idx) {
    if (this.gameOver || this.win) { return; }
    if (idx < 0 || idx >= this.N) { return; }
    if (this.flagged[idx]) { this.showToast('这一格插了旗'); return; }
    if (!this.started) {
      this.generateMines(idx);
      this.started = true;
    }
    if (this.revealed[idx]) {
      if (this.nums[idx] > 0) { this.chordAt(idx); }
      return;
    }
    if (this.mines[idx]) { this.explode(idx); return; }
    this.floodReveal(idx);
    this.afterReveal();
  };

  /** 洪水填充：翻开 idx 及其连通的 0 区域 */
  SceneMine.prototype.floodReveal = function (idx) {
    var stack = [idx];
    while (stack.length) {
      var j = stack.pop();
      if (this.revealed[j] || this.flagged[j]) { continue; }
      this.revealed[j] = true;
      if (this.nums[j] === 0) {
        var nb = Gen.neighbors(j, this.n);
        for (var k = 0; k < nb.length; k++) {
          if (!this.mines[nb[k]] && !this.revealed[nb[k]]) { stack.push(nb[k]); }
        }
      }
    }
  };

  /** chord：已翻开数字、且插旗数 === 数字 → 一次展开周围未插旗的格（点到雷即爆） */
  SceneMine.prototype.chordAt = function (idx) {
    if (this.nums[idx] === 0) { return; }
    var nb = Gen.neighbors(idx, this.n), flags = 0;
    for (var k = 0; k < nb.length; k++) { if (this.flagged[nb[k]]) { flags++; } }
    if (flags !== this.nums[idx]) { return; }
    for (var h = 0; h < nb.length; h++) {
      var c = nb[h];
      if (this.gameOver) { return; }
      if (!this.revealed[c] && !this.flagged[c]) { this.revealAt(c); }
    }
  };

  /** 插旗 / 取消旗 */
  SceneMine.prototype.flagAt = function (idx) {
    if (this.gameOver || this.win) { return; }
    if (idx < 0 || idx >= this.N) { return; }
    if (this.revealed[idx]) { this.showToast('已翻开的格不能插旗'); return; }
    if (this.flagged[idx]) { this.flagged[idx] = false; this.flagsPlaced--; }
    else { this.flagged[idx] = true; this.flagsPlaced++; }
    this.saveProgress();
  };

  /** 演绎求解器找「必然」的一步（供提示 + 自动求解）。返回 {type:'safe'|'mine', cell} 或 null */
  SceneMine.prototype.findForced = function () {
    for (var i = 0; i < this.N; i++) {
      if (!this.revealed[i] || this.nums[i] === 0) { continue; }
      var nb = Gen.neighbors(i, this.n), hidden = [], flags = 0;
      for (var k = 0; k < nb.length; k++) {
        if (this.revealed[nb[k]]) { continue; }
        if (this.flagged[nb[k]]) { flags++; } else { hidden.push(nb[k]); }
      }
      if (hidden.length === 0) { continue; }
      if (hidden.length === this.nums[i] - flags) { return { type: 'mine', cell: hidden[0] }; }
      if (flags === this.nums[i]) { return { type: 'safe', cell: hidden[0] }; }
    }
    return null;
  };

  SceneMine.prototype.doHint = function () {
    if (this.hintsLeft <= 0) { this.showToast('本关提示已用完（每关 3 次）'); return; }
    if (!this.started) {
      // 还没开局：提示先帮首点（在中心附近翻一个安全格）
      var fc = ((this.n / 2) | 0) * this.n + ((this.n / 2) | 0);
      this.revealAt(fc);
      this.hintsLeft--; this.hintUsed++; this.hintFlash = { t: 900, i: fc };
      this.saveProgress();
      return;
    }
    var f = this.findForced();
    if (!f) { this.showToast('暂时无法推理，试试标记模式'); return; }
    if (f.type === 'mine') { this.flagAt(f.cell); }
    else { this.revealAt(f.cell); }
    this.hintsLeft--; this.hintUsed++;
    this.hintFlash = { t: 900, i: f.cell };
    this.saveProgress();
  };

  SceneMine.prototype.doReset = function () {
    this.revealed = new Array(this.N).fill(false);
    this.flagged = new Array(this.N).fill(false);
    this.flagsPlaced = 0;
    this.mines = null; this.nums = null;
    this.firstClick = -1;
    this.started = false;
    this.gameOver = false; this.exploded = -1;
    this.win = null;
    this.markMode = false;
    // 计时不清零（防刷 ★）
    this.saveProgress();
    this.showToast('已重置（计时不清零）');
  };

  SceneMine.prototype.doRestart = function () {
    // 重新进同一关（新种子随机 → 同难度不同雷位）
    BF.RuleTip.skipOnce(this);   // 重玩本关不重复弹规则
        this.enter({ game: this.game, level: this.level, daily: this.isDaily });
  };

  SceneMine.prototype.doMarkToggle = function () {
    this.markMode = !this.markMode;
    this.showToast(this.markMode ? '标记模式：点格插旗' : '翻开模式');
  };

  SceneMine.prototype.doAction = function (key) {
    if (key === 'mark') { this.doMarkToggle(); }
    else if (key === 'hint') { this.doHint(); }
    else if (key === 'reset') { this.doReset(); }
    else if (key === 'restart') { this.doRestart(); }
  };

  /* ---------------- 通关 / 失败 ---------------- */

  SceneMine.prototype.afterReveal = function (silent) {
    if (this.win || this.gameOver) { return; }
    var safeLeft = 0;
    for (var i = 0; i < this.N; i++) { if (!this.mines[i] && !this.revealed[i]) { safeLeft++; } }
    if (safeLeft === 0) { this.onSolved(); return; }
    if (!silent) { this.saveProgress(); }
  };

  SceneMine.prototype.onSolved = function () {
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
    this.win = { t: 0, stars: stars, press: null, time: this.elapsed, best: this.bestTimeOf(this.level) };
  };

  SceneMine.prototype.explode = function (idx) {
    this.gameOver = true;
    this.exploded = idx;
    this.revealed[idx] = true;     // 引爆格翻开（红闪）
    // 失败时把所有未插旗的雷显形（状态对齐渲染，便于快照/续玩判定一致）
    for (var i = 0; i < this.N; i++) {
      if (this.mines[i] && !this.flagged[i]) { this.revealed[i] = true; }
    }
    this.showToast('踩到雷了！点「重玩」或返回首页');
  };

  SceneMine.prototype.next = function () {
    if (this.isDaily) { this.app.go('home'); return; }
    if (this.level >= this.meta.TOTAL) { this.app.go('levels', { game: this.game }); return; }
    BF.RuleTip.skipOnce(this);   // 关内进下一关不重复弹规则
    this.enter({ game: this.game, level: this.level + 1 });
  };

  SceneMine.prototype.showToast = function (txt) { this.toast = { text: txt, t: 1600 }; };

  SceneMine.prototype.overlayLayout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var w = Math.min(W - 56, 300), h = 288;
    var x = (W - w) / 2, y = (H - h) / 2 - 10;
    var pad = 20, bw = (w - pad * 2 - 12) / 2;
    return {
      card: { x: x, y: y, w: w, h: h },
      again: { x: x + pad, y: y + h - pad - 48, w: bw, h: 48 },
      next: { x: x + pad + bw + 12, y: y + h - pad - 48, w: bw, h: 48 }
    };
  };

  /* ---------------- 渲染 ---------------- */

  SceneMine.prototype.render = function (ctx) {
    var pf = BF.platform, W = pf.width, H = pf.height;
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
    this.renderActions(ctx);
    this.renderToast(ctx);
    if (this.win) { this.renderWin(ctx); }
    else if (this.gameOver) { this.renderLose(ctx); }

    this.renderFade(ctx, W, H);
    // 规则弹框画在最上层（主体照常画，被遮罩压暗当背景）
    if (this.showRule) { BF.RuleTip.render(ctx, this); }
  };

  SceneMine.prototype.renderFade = function (ctx, W, H) {
    if (this.fadeIn > 0) {
      ctx.save();
      ctx.globalAlpha = this.fadeIn * 0.85;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  };

  SceneMine.prototype.renderHeader = function (ctx) {
    var W = BF.platform.width;
    D.fillRound(ctx, this.back.x, this.back.y, this.back.w, this.back.h, 14, '#FFFFFF');
    D.roundRect(ctx, this.back.x + 0.5, this.back.y + 0.5, this.back.w - 1, this.back.h - 1, 14);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    D.icon(ctx, 'back', this.back.x + this.back.w / 2, this.back.y + this.back.h / 2, 16, T.text);
    // 「?」重看规则入口（不再提示后也能随时打开）
    BF.RuleTip.renderBtn(ctx, this);

    var title = this.isDaily ? '每日挑战' : ('第 ' + this.level + ' 关');
    var sub = this.isDaily ? U.dateKey(new Date())
                           : (this.puzzle.tierName + ' · ' + this.n + '×' + this.n + ' / ' + this.m + ' 雷');
    D.text(ctx, title, W / 2, this.headerY + 20, { size: 19, weight: '700' });
    D.text(ctx, sub, W / 2, this.headerY + 40, { size: 11.5, color: T.textSub });

    // 右侧：计时 + 剩余雷数（总雷 − 已插旗）
    D.text(ctx, '⏱ ' + fmtTime(this.elapsed), W - 16, this.headerY + 18,
      { size: 14, weight: '700', align: 'right', color: T.text });
    var left = this.m - this.flagsPlaced;
    D.text(ctx, '💣 ' + left, W - 16, this.headerY + 36,
      { size: 11, align: 'right', color: left < 0 ? T.warn : T.textSub });
  };

  SceneMine.prototype.renderBoard = function (ctx) {
    var c = this.cell, bx = this.boardX, by = this.boardY, bw = this.boardW, n = this.n;

    D.panel(ctx, bx - 6, by - 6, bw + 12, bw + 12, { radius: 12, fill: T.panel });

    for (var gy = 0; gy < n; gy++) {
      for (var gx = 0; gx < n; gx++) {
        var idx = gy * n + gx;
        var x = bx + gx * c, y = by + gy * c;
        var revealed = this.revealed[idx];
        var flagged = this.flagged[idx];
        var isMine = this.mines && this.mines[idx];

        if (!revealed) {
          // 未翻开：立体格
          D.fillRound(ctx, x + 1, y + 1, c - 2, c - 2, Math.max(2, c * 0.12), '#D9DEE6');
          D.fillRound(ctx, x + 1, y + 1, c - 2, (c - 2) * 0.5, Math.max(2, c * 0.12), '#E9EDF3');
          if (flagged) { this.drawFlag(ctx, x, y, c); }
          else if (this.markMode) {
            ctx.save(); ctx.globalAlpha = 0.5;
            D.text(ctx, '🚩', x + c / 2, y + c / 2 + c * 0.18,
              { size: Math.round(c * 0.5), align: 'center' });
            ctx.restore();
          }
        } else {
          // 已翻开：平格
          D.fillRound(ctx, x + 0.5, y + 0.5, c - 1, c - 1, 0,
            (idx === this.exploded) ? T.warn : '#F3F5F8');
          if (isMine) {
            this.drawMine(ctx, x, y, c, idx === this.exploded);
          } else if (this.nums[idx] > 0) {
            D.text(ctx, String(this.nums[idx]), x + c / 2, y + c / 2 + c * 0.17,
              { size: Math.round(c * 0.52), weight: '800',
                color: NUM_COLORS[this.nums[idx]] || T.text, align: 'center' });
          }
        }
        // 提示绿闪
        if (this.hintFlash && this.hintFlash.i === idx) {
          var a2 = Math.min(1, this.hintFlash.t / 900);
          ctx.save(); ctx.globalAlpha = 0.22 * a2;
          D.fillRound(ctx, x + 1, y + 1, c - 2, c - 2, 2, T.ok);
          ctx.restore();
        }
      }
    }

    // 游戏失败时：把未插旗的雷都显形（已插旗的正确雷保持旗，错旗画叉）
    if (this.gameOver) {
      for (var mi = 0; mi < this.N; mi++) {
        if (this.mines[mi] && !this.revealed[mi] && !this.flagged[mi]) {
          var mx = bx + (mi % n) * c, my = by + (((mi / n) | 0)) * c;
          D.fillRound(ctx, mx + 1, my + 1, c - 2, c - 2, Math.max(2, c * 0.12), '#F3F5F8');
          this.drawMine(ctx, mx, my, c, false);
        } else if (!this.mines[mi] && this.flagged[mi]) {
          // 错旗：画叉
          var ex = bx + (mi % n) * c, ey = by + (((mi / n) | 0)) * c;
          ctx.save();
          ctx.strokeStyle = T.warn; ctx.lineWidth = Math.max(2, c * 0.1);
          ctx.beginPath();
          ctx.moveTo(ex + c * 0.25, ey + c * 0.25); ctx.lineTo(ex + c * 0.75, ey + c * 0.75);
          ctx.moveTo(ex + c * 0.75, ey + c * 0.25); ctx.lineTo(ex + c * 0.25, ey + c * 0.75);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // 网格线（每格细线，棋盘外粗框）
    ctx.save();
    ctx.strokeStyle = 'rgba(23,26,31,0.16)';
    ctx.lineWidth = 1;
    for (var k = 0; k <= n; k++) {
      var px = bx + k * c, py = by + k * c;
      ctx.beginPath();
      ctx.moveTo(px, by); ctx.lineTo(px, by + bw);
      ctx.moveTo(bx, py); ctx.lineTo(bx + bw, py);
      ctx.stroke();
    }
    ctx.restore();
  };

  SceneMine.prototype.drawFlag = function (ctx, x, y, c) {
    var cx = x + c / 2;
    ctx.save();
    ctx.fillStyle = '#C0392B';
    ctx.strokeStyle = '#C0392B';
    ctx.lineWidth = Math.max(1.5, c * 0.06);
    ctx.beginPath();
    ctx.moveTo(cx, y + c * 0.2); ctx.lineTo(cx, y + c * 0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, y + c * 0.2);
    ctx.lineTo(cx + c * 0.28, y + c * 0.32);
    ctx.lineTo(cx, y + c * 0.44);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7F8C8D';
    ctx.fillRect(cx - c * 0.12, y + c * 0.8, c * 0.24, c * 0.06);
    ctx.restore();
  };

  SceneMine.prototype.drawMine = function (ctx, x, y, c, hot) {
    var cx = x + c / 2, cy = y + c / 2, r = c * 0.26;
    ctx.save();
    ctx.fillStyle = hot ? '#C0392B' : '#2C3138';
    ctx.strokeStyle = hot ? '#C0392B' : '#2C3138';
    ctx.lineWidth = Math.max(1.5, c * 0.06);
    // 尖刺
    var sp = c * 0.42;
    ctx.beginPath();
    ctx.moveTo(cx - sp, cy); ctx.lineTo(cx + sp, cy);
    ctx.moveTo(cx, cy - sp); ctx.lineTo(cx, cy + sp);
    ctx.moveTo(cx - sp * 0.7, cy - sp * 0.7); ctx.lineTo(cx + sp * 0.7, cy + sp * 0.7);
    ctx.moveTo(cx - sp * 0.7, cy + sp * 0.7); ctx.lineTo(cx + sp * 0.7, cy - sp * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  SceneMine.prototype.renderActions = function (ctx) {
    for (var a = 0; a < this.actBtns.length; a++) {
      var b = this.actBtns[a];
      var pressed = this.pressBtn && this.pressBtn.key === b.key;
      var active = (b.key === 'mark' && this.markMode);
      var label = b.label;
      if (b.key === 'hint') { label = '提示 ' + this.hintsLeft; }
      D.button(ctx, b, label, {
        fill: active ? T.accent : (pressed ? '#DCDEE3' : '#FFFFFF'),
        color: active ? '#FFFFFF' : T.text,
        size: 13
      });
    }
  };

  SceneMine.prototype.renderToast = function (ctx) {
    if (!this.toast) { return; }
    var pf = BF.platform, W = pf.width;
    var txt = this.toast.text;
    var a = Math.min(1, this.toast.t / 300);
    ctx.save();
    ctx.globalAlpha = a;
    var w = Math.min(W - 80, txt.length * 13 + 36);
    var x = (W - w) / 2, y = this.boardY + this.boardW + 14;
    D.panel(ctx, x, y, w, 32, { radius: 16, fill: 'rgba(44,48,54,0.88)' });
    D.text(ctx, txt, W / 2, y + 21, { size: 12.5, color: '#FFFFFF' });
    ctx.restore();
  };

  SceneMine.prototype.renderWin = function (ctx) {
    var pf = BF.platform, ob = this.overlayLayout();
    var card = ob.card;
    var sc = 1;
    if (this.win.t < 220) { sc = 0.9 + 0.1 * U.easeOutCubic(this.win.t / 220); }

    ctx.save();
    ctx.fillStyle = T.scrim;
    ctx.fillRect(0, 0, pf.width, pf.height);

    var cx = card.x + card.w / 2, cy = card.y + card.h / 2;
    ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);

    D.panel(ctx, card.x, card.y, card.w, card.h, { radius: 22, fill: '#FFFFFF', shadowBlur: 24 });
    D.text(ctx, this.isDaily ? '每日挑战完成' : '通关！', cx, card.y + 44,
      { size: 21, weight: '700' });

    var r = 15, gapx = 44, starY = card.y + 92;
    for (var i = 0; i < 3; i++) {
      var on = i < this.win.stars;
      D.star(ctx, cx + (i - 1) * gapx, starY, r, 0.46,
        on ? T.gold : 'rgba(23,26,31,0.10)', 'rgba(23,26,31,0.10)');
    }

    D.text(ctx, '用时 ' + fmtTime(this.win.time), cx, card.y + 140,
      { size: 14, weight: '600', color: T.text });
    var bestTxt = this.win.best == null ? '--:--' : fmtTime(this.win.best);
    D.text(ctx, '最佳 ' + bestTxt + (this.win.best != null && this.win.time <= this.win.best ? '（新纪录）' : ''),
      cx, card.y + 162, { size: 11.5, color: T.textSub });
    D.text(ctx, this.puzzle.tierName + ' · ' + this.n + '×' + this.n + ' / ' + this.m + ' 雷' +
      (this.hintUsed ? (' · 用了 ' + this.hintUsed + ' 次提示') : ' · 没用提示'),
      cx, card.y + 184, { size: 11.5, color: T.textSub });

    var pr = this.win.press;
    var last = !this.isDaily && this.level >= this.meta.TOTAL;
    D.button(ctx, ob.again, '重玩', { fill: pr === 'again' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15 });
    D.button(ctx, ob.next, this.isDaily ? '返回首页' : (last ? '返回关卡' : '下一关'),
      { fill: pr === 'next' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15 });

    ctx.restore();
  };

  SceneMine.prototype.renderLose = function (ctx) {
    var pf = BF.platform, ob = this.overlayLayout();
    var card = ob.card;
    var cx = card.x + card.w / 2, cy = card.y + card.h / 2;
    var sc = 1;
    if (this.t < 220) { sc = 0.9 + 0.1 * U.easeOutCubic(this.t / 220); }

    ctx.save();
    ctx.fillStyle = T.scrim;
    ctx.fillRect(0, 0, pf.width, pf.height);

    ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);

    D.panel(ctx, card.x, card.y, card.w, card.h, { radius: 22, fill: '#FFFFFF', shadowBlur: 24 });
    D.text(ctx, '踩到雷了', cx, card.y + 44, { size: 21, weight: '700', color: T.warn });

    var safeOpened = 0;
    for (var i = 0; i < this.N; i++) { if (this.revealed[i] && !this.mines[i]) { safeOpened++; } }
    D.text(ctx, '本局安全格翻开 ' + safeOpened + ' / ' + (this.N - this.m), cx, card.y + 74,
      { size: 13, weight: '600', color: T.text });
    D.text(ctx, this.puzzle.tierName + ' · ' + this.n + '×' + this.n + ' / ' + this.m + ' 雷',
      cx, card.y + 98, { size: 11.5, color: T.textSub });

    var pr = this.losePress;
    D.button(ctx, ob.again, '重玩', { fill: pr === 'again' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15 });
    D.button(ctx, ob.next, '返回首页',
      { fill: pr === 'next' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15 });

    ctx.restore();
  };

  BF.SceneMine = SceneMine;
})();
