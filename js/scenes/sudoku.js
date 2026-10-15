/**
 * sudoku.js —— 第 9 款游戏「九宫格数独」玩法场景
 *
 * 玩法（标准 9×9 数独）：
 *   每行 / 每列 / 每个 3×3 宫内 1-9 各出现一次。开局给一部分「给定数」，
 *   把剩下的格子填满即过关。
 *
 * 交互：
 *   - 点格子选中（所在行/列/宫淡显，同数字高亮，方便找位置）；
 *   - 底部 1-9 数字键盘输入；再点一次同一数字 = 擦除；
 *   - 「铅笔」模式：填小号候选数（笔记），再点一次同一数字擦掉该候选；
 *   - 「检查」统一校验：没填满 → 提示还剩几格；有错 → 把填错的格标红 2 秒；
 *     **宽松模式：过程中不提示对错**，一切以「检查」与最终校验为准；
 *   - 「提示」每关 3 次：把选中格（或第一个空格）填成正确数；
 *   - 「撤销 / 重置 / 擦除」；计时只增不减（重置不清表也不清时间，防止刷 ★）；
 *   - 星级按用时（数据层 Gen.starsFor 单一真源）；最佳用时与断点续玩存存档 extra。
 *
 * 难度自选首屏：与移车出库 / 找不同 / 超级积木共用 BF.DiffPick（见其头注释五步接入）。
 *
 * 结构照抄 blocks.js（enter/layout/update/onDown/onUp/render + overlayLayout/renderWin
 * + next()），绘制全用 D.* / U.*。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
         : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.SceneSudoku) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;
  var Gen = BF.SudokuGen;

  var N = 9, CELLS = N * N;
  var HINTS_PER_LEVEL = 3;

  var GRID_THIN = 'rgba(23,26,31,0.10)';
  var GRID_THICK = 'rgba(23,26,31,0.38)';

  function fmtTime(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var m = (s / 60) | 0;
    var ss = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
  }

  function SceneSudoku(app) {
    this.app = app;
    this.fadeIn = 1;
    this.t = 0;
    this.win = null;
    this.toast = null;
    this.pressBtn = null;
    this.pressPad = null;      // 数字键盘按下态：{ kind:'num'|'erase', d }
    this.pickDiff = false;     // 是否停在「难度自选」首屏（共用 BF.DiffPick）
    this.pickCards = null;
  }

  /* ---------------- 进入 ---------------- */

  SceneSudoku.prototype.enter = function (params) {
    params = params || {};
    // 难度自选首屏：只选难度，不造题（点档卡后才 build）
    if (params.pickDiff) { return BF.DiffPick.enter(this, params); }
    this.pickDiff = false;
    this.isDaily = !!params.daily;
    this.game = params.game || 'sudoku';
    this.level = params.level || 1;

    var meta = BF.games && (BF.games[this.game] || BF.games.sudoku);
    if (!meta) { throw new Error('未注册的游戏: ' + this.game); }
    this.meta = meta;

    this.puzzle = this.isDaily ? meta.buildDaily() : meta.build(this.level);
    if (this.puzzle.daily) { this.isDaily = true; }

    this.given = this.puzzle.given.slice();
    this.solution = this.puzzle.solution.slice();
    // entries 是「完整盘面」：给定数直接铺进去，之后只有空格会被玩家改写
    // （⚠️ 曾经忘了这一步：渲染读 entries，给定格全是 0 → 开局整盘空白）
    this.entries = new Array(CELLS).fill(0);
    for (var i0 = 0; i0 < CELLS; i0++) { this.entries[i0] = this.given[i0]; }
    this.pencil = new Array(CELLS).fill(0);    // 候选数位掩码（bit d-1）
    this.selected = null;
    this.pencilMode = false;
    this.hintsLeft = HINTS_PER_LEVEL;
    this.hintUsed = 0;
    this.history = [];
    this.elapsed = 0;
    this.wrongFlash = null;    // { t, cells:[idx] } 检查标红
    this.hintFlash = null;     // { t, i } 提示绿闪
    this.fullWarned = false;
    this.win = null;
    this.toast = null;
    this.pressBtn = null;
    this.pressPad = null;

    this.restoreProgress();
    this.layout();
    this.fadeIn = 1;
    this.t = 0;
    // 「玩法说明」弹框：每次进这款游戏的第一个关卡时弹一次（勾过「不再提示」则不弹）
    if (BF.RuleTip.shouldShow(this.game, this)) { BF.RuleTip.enter(this, params); }
    return this;
  };

  /* ---------------- 断点续玩 / 存档 ---------------- */

  /** 同一关未通关时的进度：当前填写 + 候选 + 已用时间 + 已用提示 */
  SceneSudoku.prototype.restoreProgress = function () {
    if (this.isDaily) { return; }
    var ex = BF.Save.extraOf(this.game);
    var prog = ex.prog && ex.prog[String(this.level)];
    if (!prog || !Array.isArray(prog.e) || prog.e.length !== CELLS) { return; }
    var restored = false;
    for (var i = 0; i < CELLS; i++) {
      var v = prog.e[i] | 0;
      // 给定格一律以题目为准（防止换题后存档串味）
      this.entries[i] = this.given[i] ? this.given[i] : (v >= 1 && v <= 9 ? v : 0);
      var mk = Array.isArray(prog.p) ? (prog.p[i] | 0) : 0;
      this.pencil[i] = this.given[i] ? 0 : (mk > 0 && mk < 512 ? mk : 0);
      if (this.entries[i]) { restored = true; }
    }
    if (typeof prog.t === 'number' && prog.t > 0) { this.elapsed = prog.t; }
    this.hintUsed = Math.min(HINTS_PER_LEVEL, Math.max(0, prog.h | 0));
    this.hintsLeft = HINTS_PER_LEVEL - this.hintUsed;
    if (restored) { this.showToast('已恢复上次进度'); }
  };

  SceneSudoku.prototype.saveProgress = function () {
    if (this.isDaily || this.win) { return; }
    var ex = BF.Save.extraOf(this.game);
    var prog = ex.prog || {};
    prog[String(this.level)] = {
      e: this.entries.slice(),
      p: this.pencil.slice(),
      t: Math.round(this.elapsed),
      h: this.hintUsed
    };
    BF.Save.putExtra(this.game, 'prog', prog);
  };

  SceneSudoku.prototype.bestTimeOf = function (n) {
    var ex = BF.Save.extraOf(this.game);
    var best = ex.best || {};
    var v = best[String(n)];
    return (typeof v === 'number' && v > 0) ? v : null;
  };

  /* ---------------- 布局 ---------------- */

  SceneSudoku.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var top = pf.safeTop;

    this.headerH = 52;
    this.headerY = top;
    this.back = { x: 12, y: top + 6, w: 40, h: 40 };

    // 底部两行：动作行（6 键）+ 数字键盘（9 键）
    var actH = 46, keyH = 46, gap = 8, pad = 12;
    var actY = H - pf.safeBottom - 10 - actH;
    var keyY = actY - gap - keyH;

    // 棋盘在头部与键盘之间垂直居中
    var boardTop = top + this.headerH + 8;
    var boardBottom = keyY - 10;
    var avail = boardBottom - boardTop;
    var cell = Math.floor(Math.min((W - 20) / N, avail / N));
    if (cell < 22) { cell = 22; }
    if (cell > 44) { cell = 44; }
    var bw = cell * N;
    this.cell = cell;
    this.boardW = bw;
    this.boardX = (W - bw) / 2;
    this.boardY = boardTop + Math.max(0, (avail - bw) / 2);

    // 动作行：铅笔 / 撤销 / 提示 / 重置 / 擦除 / 检查
    var aw = (W - pad * 2 - gap * 5) / 6;
    this.actBtns = [
      { key: 'pencil', label: '铅笔' },
      { key: 'undo', label: '撤销' },
      { key: 'hint', label: '提示' },
      { key: 'reset', label: '重置' },
      { key: 'erase', label: '擦除' },
      { key: 'check', label: '检查' }
    ].map(function (b, i) {
      return { key: b.key, label: b.label, x: pad + i * (aw + gap), y: actY, w: aw, h: actH };
    });

    // 数字键盘 1-9
    var kw = (W - pad * 2 - gap * 8) / 9;
    this.keys = [];
    for (var d = 1; d <= 9; d++) {
      this.keys.push({ d: d, x: pad + (d - 1) * (kw + gap), y: keyY, w: kw, h: keyH });
    }
  };

  /* ---------------- 更新 ---------------- */

  SceneSudoku.prototype.update = function (dt) {
    if (this.showRule) { return BF.RuleTip.update(this, dt); }
    this.t += dt;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) { this.toast = null; } }
    if (this.wrongFlash) { this.wrongFlash.t -= dt; if (this.wrongFlash.t <= 0) { this.wrongFlash = null; } }
    if (this.hintFlash) { this.hintFlash.t -= dt; if (this.hintFlash.t <= 0) { this.hintFlash = null; } }
    if (this.pickDiff) { return; }             // 难度首屏不跑计时
    if (this.win) { this.win.t += dt; return; }
    this.elapsed += dt;                        // 计时只增不减
  };

  /* ---------------- 输入 ---------------- */

  SceneSudoku.prototype.cellAt = function (x, y) {
    var c = this.cell;
    if (x < this.boardX || y < this.boardY ||
        x >= this.boardX + this.boardW || y >= this.boardY + this.boardW) { return -1; }
    var gx = Math.floor((x - this.boardX) / c), gy = Math.floor((y - this.boardY) / c);
    return gy * N + gx;
  };

  SceneSudoku.prototype.onDown = function (x, y) {
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

    if (U.pointInRect(x, y, this.back)) { this.pressBtn = { key: 'back' }; return; }

    // 动作行
    for (var a = 0; a < this.actBtns.length; a++) {
      if (U.pointInRect(x, y, this.actBtns[a])) { this.pressBtn = { key: this.actBtns[a].key }; return; }
    }
    // 数字键盘
    for (var k = 0; k < this.keys.length; k++) {
      if (U.pointInRect(x, y, this.keys[k])) {
        this.pressPad = { kind: 'num', d: this.keys[k].d };
        this.applyDigit(this.keys[k].d);
        return;
      }
    }
    // 棋盘选格
    var idx = this.cellAt(x, y);
    if (idx >= 0) { this.selected = idx; }
  };

  SceneSudoku.prototype.onUp = function (x, y) {
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

    this.pressPad = null;
    var p = this.pressBtn;
    this.pressBtn = null;
    if (!p) { return; }
    if (p.key === 'back') {
      if (U.pointInRect(x, y, this.back)) { this.app.go('home'); }
      return;
    }
    var btn = null;
    for (var a = 0; a < this.actBtns.length; a++) {
      if (this.actBtns[a].key === p.key) { btn = this.actBtns[a]; break; }
    }
    if (!btn || !U.pointInRect(x, y, btn)) { return; }   // 按下与抬起不在同一键 → 忽略
    this.doAction(p.key);
  };

  /* ---------------- 玩法动作 ---------------- */

  SceneSudoku.prototype.pushHistory = function (i, nextEntry, nextPencil) {
    this.history.push({
      i: i,
      pe: this.entries[i], pp: this.pencil[i],
      ne: nextEntry, np: (typeof nextPencil === 'number') ? nextPencil : this.pencil[i]
    });
  };

  /** 数字键盘：填数 / 擦除 / 铅笔候选 */
  SceneSudoku.prototype.applyDigit = function (d) {
    if (this.selected == null) { this.showToast('先点一个格子'); return; }
    var i = this.selected;
    if (this.given[i]) { this.showToast('题目给定的格子不能改'); return; }

    if (this.pencilMode) {
      var bit = 1 << (d - 1);
      this.pushHistory(i, this.entries[i], this.pencil[i] ^ bit);
      this.pencil[i] ^= bit;
      this.saveProgress();
      return;
    }
    if (this.entries[i] === d) {
      this.pushHistory(i, 0);
      this.entries[i] = 0;                       // 再点同一数字 = 擦除
    } else {
      this.pushHistory(i, d, 0);
      this.entries[i] = d;
      this.pencil[i] = 0;                        // 填了正式数就清掉候选
    }
    this.saveProgress();
    this.afterEntry();
  };

  /** 擦除选中格（铅笔模式下清候选，否则清填写） */
  SceneSudoku.prototype.doErase = function () {
    if (this.selected == null) { this.showToast('先点一个格子'); return; }
    var i = this.selected;
    if (this.given[i]) { this.showToast('题目给定的格子不能改'); return; }
    if (this.pencilMode) {
      if (!this.pencil[i]) { return; }
      this.pushHistory(i, this.entries[i], 0);
      this.pencil[i] = 0;
    } else {
      if (!this.entries[i]) { return; }
      this.pushHistory(i, 0);
      this.entries[i] = 0;
    }
    this.saveProgress();
  };

  SceneSudoku.prototype.doUndo = function () {
    var h = this.history.pop();
    if (!h) { this.showToast('没有可撤销的操作'); return; }
    this.entries[h.i] = h.pe;
    this.pencil[h.i] = h.pp;
    this.saveProgress();
  };

  /** 每关 3 次提示：把选中格（或第一个空格）填成正确数 */
  SceneSudoku.prototype.doHint = function () {
    if (this.hintsLeft <= 0) { this.showToast('本关提示已用完（每关 3 次）'); return; }
    var target = -1;
    if (this.selected != null && !this.given[this.selected] && !this.entries[this.selected]) {
      target = this.selected;
    } else {
      for (var i = 0; i < CELLS; i++) {
        if (!this.given[i] && !this.entries[i]) { target = i; break; }
      }
    }
    if (target < 0) { this.showToast('没有空格了'); return; }
    this.pushHistory(target, this.solution[target], 0);
    this.entries[target] = this.solution[target];
    this.pencil[target] = 0;
    this.hintsLeft--;
    this.hintUsed++;
    this.hintFlash = { t: 900, i: target };
    this.selected = target;
    this.saveProgress();
    this.afterEntry();
  };

  SceneSudoku.prototype.doReset = function () {
    for (var i = 0; i < CELLS; i++) {
      this.entries[i] = this.given[i];
      this.pencil[i] = 0;
    }
    this.history = [];
    this.selected = null;
    this.wrongFlash = null;
    this.saveProgress();
    this.showToast('已重置（计时不清零）');
  };

  /**
   * 统一校验（宽松模式的唯一对错来源）：
   * 没填满 → 报还剩几格；有错 → 填错的格标红 2 秒；全对 → 通关。
   */
  SceneSudoku.prototype.doCheck = function () {
    var empty = 0, wrong = [];
    for (var i = 0; i < CELLS; i++) {
      if (!this.entries[i]) { empty++; }
      else if (this.entries[i] !== this.solution[i]) { wrong.push(i); }
    }
    if (empty > 0) { this.showToast('还有 ' + empty + ' 格没填'); return; }
    if (wrong.length) {
      this.wrongFlash = { t: 2200, cells: wrong };
      this.showToast('有 ' + wrong.length + ' 格填错了（已标红）');
      return;
    }
    this.onSolved();
  };

  SceneSudoku.prototype.doAction = function (key) {
    if (key === 'pencil') {
      this.pencilMode = !this.pencilMode;
      this.showToast(this.pencilMode ? '铅笔模式：填候选数' : '数字模式：填正式答案');
    } else if (key === 'undo') { this.doUndo(); }
    else if (key === 'hint') { this.doHint(); }
    else if (key === 'reset') { this.doReset(); }
    else if (key === 'erase') { this.doErase(); }
    else if (key === 'check') { this.doCheck(); }
  };

  /** 每次填写后：填满且全对立即通关；填满但有错只提醒去点「检查」 */
  SceneSudoku.prototype.afterEntry = function () {
    var empty = 0, wrong = 0;
    for (var i = 0; i < CELLS; i++) {
      if (!this.entries[i]) { empty++; }
      else if (this.entries[i] !== this.solution[i]) { wrong++; }
    }
    if (empty > 0) { return; }
    if (wrong === 0) { this.onSolved(); return; }
    if (!this.fullWarned) {
      this.fullWarned = true;
      this.showToast('已填满，点「检查」看哪里错');
    }
  };

  SceneSudoku.prototype.showToast = function (txt) { this.toast = { text: txt, t: 1600 }; };

  /* ---------------- 结算 ---------------- */

  SceneSudoku.prototype.onSolved = function () {
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

  SceneSudoku.prototype.next = function () {
    if (this.isDaily) { this.app.go('home'); return; }
    if (this.level >= this.meta.TOTAL) { this.app.go('levels', { game: this.game }); return; }
    BF.RuleTip.skipOnce(this);   // 关内进下一关不重复弹规则
    this.enter({ game: this.game, level: this.level + 1 });
  };

  SceneSudoku.prototype.overlayLayout = function () {
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

  SceneSudoku.prototype.render = function (ctx) {
    var pf = BF.platform, W = pf.width, H = pf.height;

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.bgTop);
    bg.addColorStop(1, T.bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 难度自选首屏：必须**先于** renderHeader 分流 —— 首屏阶段没有题目
    if (this.pickDiff) {
      BF.DiffPick.render(ctx, this);
      this.renderFade(ctx, W, H);
      return;
    }

    this.renderHeader(ctx);
    this.renderBoard(ctx);
    this.renderPad(ctx);
    this.renderActions(ctx);
    this.renderToast(ctx);
    if (this.win) { this.renderWin(ctx); }

    this.renderFade(ctx, W, H);
    // 规则弹框画在最上层（主体照常画，被遮罩压暗当背景）
    if (this.showRule) { BF.RuleTip.render(ctx, this); }
  };

  SceneSudoku.prototype.renderFade = function (ctx, W, H) {
    if (this.fadeIn > 0) {
      ctx.save();
      ctx.globalAlpha = this.fadeIn * 0.85;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  };

  SceneSudoku.prototype.renderHeader = function (ctx) {
    var pf = BF.platform, W = pf.width;
    D.fillRound(ctx, this.back.x, this.back.y, this.back.w, this.back.h, 14, '#FFFFFF');
    D.roundRect(ctx, this.back.x + 0.5, this.back.y + 0.5, this.back.w - 1, this.back.h - 1, 14);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    D.icon(ctx, 'back', this.back.x + this.back.w / 2, this.back.y + this.back.h / 2, 16, T.text);
    // 「?」重看规则入口（不再提示后也能随时打开）
    BF.RuleTip.renderBtn(ctx, this);

    var title = this.isDaily ? '每日挑战' : ('第 ' + this.level + ' 关');
    var sub = this.isDaily ? U.dateKey(new Date())
                           : (this.puzzle.tierName + ' · 挖 ' + this.puzzle.blanks + ' 空');
    D.text(ctx, title, W / 2, this.headerY + 20, { size: 19, weight: '700' });
    D.text(ctx, sub, W / 2, this.headerY + 40, { size: 11.5, color: T.textSub });

    // 右侧：计时 + 最佳用时
    D.text(ctx, '⏱ ' + fmtTime(this.elapsed), W - 16, this.headerY + 18,
      { size: 14, weight: '700', align: 'right', color: T.text });
    var best = this.isDaily ? null : this.bestTimeOf(this.level);
    D.text(ctx, best == null ? '最佳 --:--' : ('最佳 ' + fmtTime(best)),
      W - 16, this.headerY + 36, { size: 10.5, color: T.textSub, align: 'right' });

    // 铅笔模式角标
    if (this.pencilMode) {
      D.text(ctx, '铅笔模式', 16, this.headerY + 38,
        { size: 11, color: T.accent, weight: '700', align: 'left' });
    }
  };

  SceneSudoku.prototype.renderBoard = function (ctx) {
    var c = this.cell, bx = this.boardX, by = this.boardY, bw = this.boardW;
    var sel = this.selected;
    var selVal = (sel != null) ? this.entries[sel] : 0;

    // 棋盘底板
    D.panel(ctx, bx - 8, by - 8, bw + 16, bw + 16, { radius: 14, fill: T.panel });

    // 选中格的行/列/宫淡显（先画，数字画在上面）
    if (sel != null) {
      var sr = (sel / N) | 0, sc = sel % N, sb = (((sel / N) | 0) / 3 | 0) * 3 + ((sel % N) / 3 | 0);
      ctx.save();
      ctx.globalAlpha = 1;
      for (var i = 0; i < CELLS; i++) {
        var r = (i / N) | 0, cc = i % N, bb = (((i / N) | 0) / 3 | 0) * 3 + ((i % N) / 3 | 0);
        if (i === sel) { continue; }
        var peer = (r === sr || cc === sc || bb === sb);
        if (!peer) { continue; }
        D.fillRound(ctx, bx + cc * c, by + r * c, c, c, 0, U.rgba(T.accent, 0.055));
      }
      ctx.restore();
    }

    // 每格
    for (var gy = 0; gy < N; gy++) {
      for (var gx = 0; gx < N; gx++) {
        var idx = gy * N + gx;
        var x = bx + gx * c, y = by + gy * c;

        // 底色：给定格浅灰；同数字高亮；选中格主色
        if (this.given[idx]) {
          D.fillRound(ctx, x, y, c, c, 0, '#F1F3F6');
        }
        if (selVal && (this.entries[idx] === selVal) && idx !== sel) {
          D.fillRound(ctx, x, y, c, c, 0, U.rgba(T.gold, 0.22));
        }
        if (idx === sel) {
          D.fillRound(ctx, x, y, c, c, 0, U.rgba(T.accent, 0.16));
        }
        // 检查标红
        if (this.wrongFlash) {
          for (var w = 0; w < this.wrongFlash.cells.length; w++) {
            if (this.wrongFlash.cells[w] === idx) {
              var a = Math.min(1, this.wrongFlash.t / 2200);
              ctx.save(); ctx.globalAlpha = 0.28 + 0.22 * a;
              D.fillRound(ctx, x, y, c, c, 0, T.warn);
              ctx.restore();
            }
          }
        }
        // 提示绿闪
        if (this.hintFlash && this.hintFlash.i === idx) {
          var a2 = Math.min(1, this.hintFlash.t / 900);
          ctx.save(); ctx.globalAlpha = 0.22 * a2;
          D.fillRound(ctx, x, y, c, c, 0, T.ok);
          ctx.restore();
        }

        // 数字
        var v = this.entries[idx];
        if (v) {
          D.text(ctx, String(v), x + c / 2, y + c / 2 + c * 0.17,
            { size: Math.round(c * 0.5), weight: this.given[idx] ? '700' : '600',
              color: this.given[idx] ? T.text : T.accent });
        } else if (this.pencil[idx]) {
          // 候选数 3×3 小字
          var ps = Math.max(7, Math.round(c * 0.22));
          for (var d = 1; d <= 9; d++) {
            if (!(this.pencil[idx] & (1 << (d - 1)))) { continue; }
            var px = x + ((d - 1) % 3) * (c / 3) + c / 6;
            var py = y + (((d - 1) / 3) | 0) * (c / 3) + c / 6;
            D.text(ctx, String(d), px, py, { size: ps, color: T.textSub, align: 'center' });
          }
        }
      }
    }

    // 网格线（宫内细、宫间粗）
    // ⚠️ 曾经在这里栽过：横线 y 误写成 bx + k*c（棋盘左上角 x），
    // 结果横线全画到屏幕上方，棋盘下半部分一条横线都没有 → 用户报「九宫格错乱」。
    // 竖线 x 用 bx、横线 y 用 by，两者各自加 k*c，不能共用一个 p。
    ctx.save();
    for (var k = 0; k <= N; k++) {
      var thick = (k % 3 === 0);
      ctx.strokeStyle = thick ? GRID_THICK : GRID_THIN;
      ctx.lineWidth = thick ? 1.6 : 0.8;
      var px = bx + k * c;   // 竖线：x 从 boardX 起算
      var py = by + k * c;   // 横线：y 从 boardY 起算
      ctx.beginPath();
      ctx.moveTo(px, by); ctx.lineTo(px, by + bw);
      ctx.moveTo(bx, py); ctx.lineTo(bx + bw, py);
      ctx.stroke();
    }
    ctx.restore();

    // 选中格外框
    if (sel != null) {
      var sx = bx + (sel % N) * c, sy = by + (((sel / N) | 0)) * c;
      ctx.save();
      ctx.strokeStyle = T.accent; ctx.lineWidth = 2;
      D.roundRect(ctx, sx + 1, sy + 1, c - 2, c - 2, Math.max(2, c * 0.12));
      ctx.stroke();
      ctx.restore();
    }
  };

  SceneSudoku.prototype.renderPad = function (ctx) {
    for (var k = 0; k < this.keys.length; k++) {
      var key = this.keys[k], d = key.d;
      // 该数字还剩几个要填（entries 已含给定数，直接数）
      var placed = 0;
      for (var i = 0; i < CELLS; i++) {
        if (this.entries[i] === d) { placed++; }
      }
      var remain = 9 - placed;
      var pressed = this.pressPad && this.pressPad.kind === 'num' && this.pressPad.d === d;

      D.panel(ctx, key.x, key.y, key.w, key.h, {
        radius: 12, fill: pressed ? '#E4E7EB' : '#FFFFFF',
        shadowBlur: pressed ? 2 : 6, shadowOffsetY: pressed ? 1 : 2,
        edgeColor: U.rgba(T.accent, 0.18)
      });
      D.text(ctx, String(d), key.x + key.w / 2, key.y + key.h / 2 + (remain > 0 ? 1 : 6),
        { size: Math.min(21, Math.round(key.h * 0.46)), weight: '700',
          color: remain > 0 ? T.text : T.textSub });
      if (remain > 0) {
        D.text(ctx, String(remain), key.x + key.w / 2, key.y + key.h - 7,
          { size: 9, color: T.textSub });
      }
    }
  };

  SceneSudoku.prototype.renderActions = function (ctx) {
    for (var a = 0; a < this.actBtns.length; a++) {
      var b = this.actBtns[a];
      var pressed = this.pressBtn && this.pressBtn.key === b.key;
      var active = (b.key === 'pencil' && this.pencilMode);
      var label = b.label;
      if (b.key === 'hint') { label = '提示 ' + this.hintsLeft; }

      D.button(ctx, b, label, {
        fill: active ? T.accent : (pressed ? '#DCDEE3' : '#FFFFFF'),
        color: active ? '#FFFFFF' : T.text,
        size: 13
      });
    }
  };

  SceneSudoku.prototype.renderToast = function (ctx) {
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

  SceneSudoku.prototype.renderWin = function (ctx) {
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

    // 三颗星
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
    D.text(ctx, this.puzzle.tierName + ' · 挖 ' + this.puzzle.blanks + ' 空' +
      (this.hintUsed ? (' · 用了 ' + this.hintUsed + ' 次提示') : ' · 没用提示'),
      cx, card.y + 184, { size: 11.5, color: T.textSub });

    var pr = this.win.press;
    var last = !this.isDaily && this.level >= this.meta.TOTAL;
    D.button(ctx, ob.again, '重玩', { fill: pr === 'again' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15 });
    D.button(ctx, ob.next, this.isDaily ? '返回首页' : (last ? '返回关卡' : '下一关'),
      { fill: pr === 'next' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15 });

    ctx.restore();
  };

  BF.SceneSudoku = SceneSudoku;
})();
