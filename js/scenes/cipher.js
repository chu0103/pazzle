/**
 * cipher.js —— 第 6 款游戏「密码推理」玩法场景
 *
 * 屏幕自上而下：
 *   1) 头部：返回 / 第 N 关 / 剩几次机会 + 本关提示模式
 *   2) 密码条：N 个灰色「?」——密码全程隐藏，破译成功或机会用完才揭示
 *   3) 猜测板：tries 行（默认 7 行）
 *        已提交的行 → 本行颜色 + 反馈。反馈画在哪里由本关**提示模式 hint** 决定：
 *        　　'line' 划线 / 'dot' 圆点 → **每格正下方**一条线 / 一个点（能看出是哪一格）；
 *        　　　　　　　 其中再按**信息量 info** 裁剪：'full' 关三色全给，
 *        　　　　　　　 'exact' 关（L5~L7）只画"位置对"的绿，其余格子下方留空（画灰色虚位）。
 *        　　'agg'  数量 → **每行右侧**一个点阵（绿/白/黑各几个），不说是哪一格（L8~L10）。
 *        当前编辑行 → 已填的颜色 + 空槽（下一个空槽有主色描边提示）
 *        未来的行   → 灰色空槽
 *   4) 图例：**可点按 / 长按**的胶囊，说明各档反馈代表什么（"不告诉你"也是一档）
 *        （两种提示模式的小样形状同步：划线关画线、圆点关画点）；
 *        点按或长按任一项 → 上方浮出说明气泡（含义 + 本关用的哪种提示），
 *        再点同一项、点气泡任意处、或 4.2 秒后自动收起。
 *   5) 调色板：本关可用的颜色（已在编辑行里用过的会置灰，因为一行不允许重复颜色）
 *   6) 底部按钮：撤销 / 清空 / 提交
 *
 * 交互（填色可以**任意指定位置**，不必从左往右依次填）：
 *   点某格     → 选中它（主色环光标，指明"下一个颜色落这儿"）
 *   点颜色     → 填进选中格；格上已有别的颜色就替换掉
 *   没选中格时 → 颜色自动落到第一个空位，填完光标顺推到下一个空位，
 *               所以"一路点颜色"仍能顺序填满，两种用法共存。
 *   再点选中格 → 已填的取下来（原地清空，后面的格子不动）；空格则取消选中。
 *   撤销       → 撤选中格（未选或该格为空则撤最靠右已填的）；清空 = 整行清掉；提交 = 送一行换反馈。
 *
 * 整体结构照抄 bottle/diff 场景（点按 + 结算弹窗 + 底部按钮），
 * 区别只是把「选中两瓶交换」换成了「从调色板拼一行密码并提交验证」。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.SceneCipher) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;

  // 反馈配色（绿=位置对 / 白=颜色对位置错 / 黑=颜色不在密码里），两种提示模式共用
  var GREEN = '#2EA44F', WHITE = '#FFFFFF', BLACK = '#3C4046';

  /** 图例三档的说明文案（点按 / 长按图例弹出）。'\n' 为强制换行，其余按宽度自动折行 */
  var LEGEND = {
    2: { label: '位置对', desc: '这一格的颜色猜对了，位置也对。\n后面就别再挪它，锁住就行。' },
    1: { label: '换位', desc: '这个颜色确实在密码里，但放错格子了。\n记住它，换到别的位置再试。' },
    0: { label: '排除', desc: '这个颜色根本不在密码里。\n后面几行可以直接不用它。' },
    // 后段关卡（info='exact'）专用：错误的格子下面什么都不画
    '-1': {
      label: '不告诉你',
      desc: '这一格是错的，但本关不告诉你错在哪：\n'
          + '可能是"颜色在密码里、放错了位置"，也可能是"颜色根本不在密码里"。\n'
          + '得拿其它格子交叉推理，才能把这两种情况分开。'
    }
  };
  /** 长按判定阈值（ms）：按住图例超过这么久就弹说明，不必等抬手 */
  var LONG_PRESS = 450;
  /** 说明气泡的存活时长（ms），到点自动收起；期间也可点它关掉 */
  var HELP_LIFE = 4200;

  function SceneCipher(app) {
    this.app = app;
    this.fadeIn = 1;
    this.t = 0;
    this.result = null;
    this.toast = null;
    this.pressBtn = null;
    this.pressPal = -1;
    this.pressCell = -1;
    this.cellSel = -1;          // 编辑行里"被点选"的格子（-1 = 没选，点颜色就落到第一个空位）
    this.legendRects = [];      // 图例三个标签的命中盒（renderLegend 里按实际宽度回填）
    this.legendPress = null;    // 正在按住的图例项 { idx, at, fired }
    this.help = null;           // 弹出的图例说明 { kind, t }
    this.helpRect = null;       // 说明气泡的矩形，用于"点它关掉"
  }

  SceneCipher.prototype.enter = function (params) {
    params = params || {};
    this.isDaily = !!params.daily;
    this.game = params.game || 'cipher';
    this.level = params.level || 1;

    var meta = BF.games && (BF.games[this.game] || BF.games.cipher);
    if (!meta) { throw new Error('未注册的游戏: ' + this.game); }
    this.meta = meta;

    this.puzzle = this.isDaily ? meta.buildDaily() : meta.build(this.level);
    this.cfg = {
      slots: this.puzzle.slots,
      colors: this.puzzle.colors,
      tries: this.puzzle.tries,
      hint: this.puzzle.hint,
      info: this.puzzle.info          // 'full' 全给 / 'exact' 只标"位置对"
    };
    this.palette = this.puzzle.palette;
    this.usable = this.puzzle.usable.slice();
    this.code = this.puzzle.code;

    this.rows = [];                                       // 已提交：{ guess, fb, line }
    this.edit = new Array(this.cfg.slots).fill(-1);        // 当前编辑行（-1 = 空）
    this.pressBtn = null;
    this.pressPal = -1;
    this.pressCell = -1;
    this.cellSel = -1;
    this.legendPress = null;
    this.help = null;
    this.helpRect = null;
    this.result = null;
    this.toast = null;
    this.fadeIn = 1;
    this.t = 0;

    this.layout();
    // 后段关卡反馈被裁掉了一档 / 换了位置，开局必须说清楚，否则玩家会以为提示坏了
    this.showToast(this.cfg.hint === 'agg'
      ? '反馈在右侧，只给各状态的数量 · 点格子选位再填色'
      : (this.cfg.info === 'exact'
         ? '本关只告诉你哪几格对了 · 点格子选位再填色'
         : '点格子选位置，再点颜色填入'));
    // 「玩法说明」弹框：每次进这款游戏的第一个关卡时弹一次（勾过「不再提示」则不弹）
    if (BF.RuleTip.shouldShow(this.game, this)) { BF.RuleTip.enter(this, params); }
    return this;
  };

  /** 已提交次数 */
  SceneCipher.prototype.used = function () { return this.rows.length; };

  /** 剩余机会 */
  SceneCipher.prototype.left = function () { return this.cfg.tries - this.rows.length; };

  /** 编辑行是否已填满 */
  SceneCipher.prototype.editFull = function () {
    for (var i = 0; i < this.edit.length; i++) { if (this.edit[i] < 0) { return false; } }
    return true;
  };

  /** 当前可编辑的行下标（已提交 rows.length 行，下一行就是编辑行）；超出棋盘则返回 -1 */
  SceneCipher.prototype.editRow = function () {
    return this.rows.length < this.cfg.tries ? this.rows.length : -1;
  };

  /* ---------------- 布局 ---------------- */

  SceneCipher.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var top = pf.safeTop;
    var cfg = this.cfg;

    this.headerH = 52;
    this.headerY = top;
    this.back = { x: 12, y: top + 6, w: 40, h: 40 };

    // ---- 底部：按钮行 → 调色板行 → 图例行 ----
    var btnH = 46, palH = 42, legendH = 18;
    var btnY = H - pf.safeBottom - btnH - 6;
    var bw = (W - 24 - 10 * 2) / 3;
    this.btns = [
      { x: 12, y: btnY, w: bw, h: btnH, key: 'undo', label: '撤销', icon: 'undo' },
      { x: 12 + bw + 10, y: btnY, w: bw, h: btnH, key: 'clear', label: '清空', icon: 'reset' },
      { x: 12 + (bw + 10) * 2, y: btnY, w: bw, h: btnH, key: 'submit', label: '提交' }
    ];

    this.palH = palH;
    this.palY = btnY - 8 - palH;
    this.legendY = this.palY - 6 - legendH;
    this.legendH = legendH;

    // 调色板色块（只放本关可用的颜色）
    var nP = this.usable.length;
    var pgap = 6;
    var pw = Math.min(46, (W - 24 - pgap * (nP - 1)) / nP);
    var palW = pw * nP + pgap * (nP - 1);
    var px0 = (W - palW) / 2;
    this.palettes = [];
    for (var i = 0; i < nP; i++) {
      this.palettes.push({
        x: px0 + i * (pw + pgap), y: this.palY, w: pw, h: palH,
        color: this.usable[i]
      });
    }
    this.palW = palW;

    // ---- 顶部：密码条 ----
    var sh = 22, sq = 5;
    this.stripH = 30;
    this.stripY = top + 58;
    this.chipSize = sh;
    this.stripW = Math.min(W - 32, 54 + cfg.slots * sh + (cfg.slots - 1) * sq);
    this.stripX = (W - this.stripW) / 2;

    // ---- 猜测板 ----
    var boardTop = this.stripY + this.stripH + 8;
    var boardBottom = this.legendY - 8;
    var boardH = Math.max(60, boardBottom - boardTop);
    var rowStep = boardH / cfg.tries;

    // 'line' / 'dot' 关：反馈画在**每格正下方**，不需要右侧反馈区，格子列在整屏里居中，
    // 切关不会左右跳；'agg' 关：反馈画在**行右侧**的数量点阵上，预留 fbW，格子列随之整体左移。
    var gapB = 6;
    this.fbCols = 0;
    this.fbDot = 0;
    this.fbW = 0;
    if (cfg.hint === 'agg') {
      // 点阵列数：4 位 → 2 列（2×2 点阵），5 位以上 → 3 列
      this.fbCols = Math.max(2, Math.ceil(Math.sqrt(cfg.slots)));
      // 点径挂在**行高**上而不是格子宽上——格子宽要用到 fbW，fbW 又要用到点径，
      // 挂行高才能先算点阵、再算格子，不会绕成死循环。
      this.fbDot = Math.max(7, Math.min(11, rowStep * 0.17));
      var fbGap = this.fbDot * 0.42;
      this.fbW = this.fbCols * this.fbDot + (this.fbCols - 1) * fbGap + 13;   // 13 = 与格子列的间距 + 右侧留白
    }

    var rowAvailW = (W - 32) - this.fbW;
    var slotByW = (rowAvailW - gapB * (cfg.slots - 1)) / cfg.slots;
    var slot = Math.min(40, slotByW, rowStep * 0.74);
    if (slot < 16) { slot = 16; }

    this.slot = slot;
    this.gapB = gapB;
    this.rowStep = rowStep;
    this.rowW = slot * cfg.slots + gapB * (cfg.slots - 1);
    this.rowBlockW = this.rowW + this.fbW;
    this.slotX0 = (W - this.rowBlockW) / 2;
    this.boardTop = boardTop;
    this.boardBottom = boardBottom;

    this.rowCY = [];
    for (i = 0; i < cfg.tries; i++) { this.rowCY.push(boardTop + rowStep * (i + 0.5)); }
  };

  /** 某行第 i 格子的命中盒 */
  SceneCipher.prototype.cellRect = function (row, i) {
    return {
      x: this.slotX0 + i * (this.slot + this.gapB),
      y: this.rowCY[row] - this.slot / 2,
      w: this.slot, h: this.slot
    };
  };

  /**
   * 某行的**右侧反馈区**（只有 'agg' 数量提示关用得上，其它关 fbW = 0 → 宽 0）。
   * 画点在框内居中，命中盒也算在这里，测试靠它断言"不溢出屏幕"。
   */
  SceneCipher.prototype.fbRect = function (row) {
    return {
      x: this.slotX0 + this.rowW + 6,
      y: this.rowCY[row] - this.slot / 2,
      w: Math.max(0, this.fbW - 6), h: this.slot
    };
  };

  /* ---------------- 更新 ---------------- */

  SceneCipher.prototype.update = function (dt) {
    if (this.showRule) { return BF.RuleTip.update(this, dt); }
    this.t += dt;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) { this.toast = null; } }
    if (this.result) { this.result.t += dt; }

    // 长按图例：按住够久就直接弹说明（不必等抬手）
    if (this.legendPress && !this.legendPress.fired && this.t - this.legendPress.at > LONG_PRESS) {
      this.legendPress.fired = true;
      this.showHelp(this.legendRects[this.legendPress.idx].kind);
    }
    // 说明气泡：到点自动收起
    if (this.help) {
      this.help.t += dt;
      if (this.help.t > this.help.life) { this.help = null; this.helpRect = null; }
    }
  };

  /* ---------------- 输入 ---------------- */

  SceneCipher.prototype.onDown = function (x, y) {
    if (this.showRule) { BF.RuleTip.onDown(this, x, y); return; }
    // header 左上角「?」：随时重看玩法说明（无视「不再提示」）
    if (!this.win && !this.gameOver && !this.pickDiff &&
        U.pointInRect(x, y, BF.RuleTip.btn(this))) { BF.RuleTip.enter(this, { force: true }); return; }
    if (this.result) {
      var ob = this.overlayLayout();
      this.result.press = null;
      if (U.pointInRect(x, y, ob.again)) { this.result.press = 'again'; return; }
      if (U.pointInRect(x, y, ob.next)) { this.result.press = 'next'; return; }
      return;
    }
    if (U.pointInRect(x, y, this.back)) {
      this.pressBtn = { key: 'back' };
      return;
    }
    var i;
    // 说明气泡在最上层：点它任意位置就收起（否则它会挡住棋盘底部的格子）
    if (this.help && this.helpRect && U.pointInRect(x, y, this.helpRect)) {
      this.help = null; this.helpRect = null; return;
    }
    // 图例：按住待判定（抬手=点按弹说明，按住够久=长按弹说明）
    for (i = 0; i < this.legendRects.length; i++) {
      if (U.pointInRect(x, y, this.legendRects[i])) {
        this.legendPress = { idx: i, at: this.t, fired: false };
        return;
      }
    }
    for (i = 0; i < this.btns.length; i++) {
      if (U.pointInRect(x, y, this.btns[i])) { this.pressBtn = this.btns[i]; return; }
    }
    for (i = 0; i < this.palettes.length; i++) {
      if (U.pointInRect(x, y, this.palettes[i])) { this.pressPal = i; return; }
    }
    // 编辑行的格子：空的和已填的都能点（点一下 = 选中这一格，可以往里放颜色）
    var er = this.editRow();
    if (er >= 0) {
      for (i = 0; i < this.cfg.slots; i++) {
        if (U.pointInRect(x, y, this.cellRect(er, i))) { this.pressCell = i; return; }
      }
    }
  };

  SceneCipher.prototype.onUp = function (x, y) {
    if (this.showRule) { BF.RuleTip.onUp(this, x, y); return; }
    if (this.result) {
      var ob = this.overlayLayout();
      var hit = this.result.press;
      this.result.press = null;
      if (hit === 'again' && U.pointInRect(x, y, ob.again)) {
        BF.RuleTip.skipOnce(this);   // 重玩本关不重复弹规则
        this.enter({ game: this.game, level: this.level, daily: this.isDaily });
        return;
      }
      if (hit === 'next' && U.pointInRect(x, y, ob.next)) { this.next(); return; }
      return;
    }
    if (this.pressBtn) {
      var b = this.pressBtn;
      this.pressBtn = null;
      if (b.key === 'back') {
        if (U.pointInRect(x, y, this.back)) {
          this.app.go(this.isDaily ? 'home' : 'levels', { game: this.game });
        }
        return;
      }
      if (U.pointInRect(x, y, b)) { this.doAction(b.key); }
      return;
    }
    // 图例抬手：没被长按提前触发 → 按点按处理，弹说明
    if (this.legendPress) {
      var lp = this.legendPress;
      this.legendPress = null;
      if (!lp.fired && U.pointInRect(x, y, this.legendRects[lp.idx])) {
        this.showHelp(this.legendRects[lp.idx].kind);
      }
      return;
    }
    if (this.pressPal >= 0) {
      var pi = this.pressPal;
      this.pressPal = -1;
      if (U.pointInRect(x, y, this.palettes[pi])) { this.placeColor(this.palettes[pi].color); }
      return;
    }
    if (this.pressCell >= 0) {
      var ci = this.pressCell;
      this.pressCell = -1;
      var er = this.editRow();
      if (er >= 0 && U.pointInRect(x, y, this.cellRect(er, ci))) { this.tapCell(ci); }
    }
  };

  /**
   * 点编辑行第 i 格——把"落笔位置"定在这一格。
   *   第一次点     → 选中（之后点颜色就填进这一格）
   *   再点同一格   → 已填的取下来（原地清空，后面的格子不动）；空的则取消选中
   */
  SceneCipher.prototype.tapCell = function (i) {
    if (i < 0 || i >= this.edit.length) { return; }
    if (this.cellSel === i) {
      if (this.edit[i] >= 0) { this.removeAt(i); }   // 取下来，光标仍留在这一格
      else { this.cellSel = -1; }                    // 取消选中，回到"自动顺推"
    } else {
      this.cellSel = i;
    }
    BF.platform.vibrate('light');
  };

  /* ---------------- 动作 ---------------- */

  /**
   * 把一个颜色放进编辑行。
   *   有选中格 → 填进那一格（格上已有别的颜色就直接替换掉）
   *   没选中   → 填进第一个空位
   * 填完把光标自动顺推到下一个空位，所以"一路点颜色"仍能顺序填满，
   * 想改哪一格就先点哪一格——两种用法共存。
   */
  SceneCipher.prototype.placeColor = function (cIdx) {
    if (this.editRow() < 0) { return; }

    var k = (this.cellSel >= 0 && this.cellSel < this.edit.length) ? this.cellSel : this.firstEmpty();
    if (k < 0) { this.showToast('这一行填满了，点「提交」验证'); return; }

    if (this.edit.indexOf(cIdx) >= 0 && this.edit[k] !== cIdx) {
      this.showToast('这一行已经有' + this.palette[cIdx].name + '色了');
      return;
    }
    this.edit[k] = cIdx;
    this.cellSel = this.nextEmptyAfter(k);   // 自动顺推；全填满则为 -1
    BF.platform.vibrate('light');
  };

  /** 取下编辑行第 i 格的颜色（原地清空，后面的格子不动——位置是玩家自己指定的） */
  SceneCipher.prototype.removeAt = function (i) {
    if (i < 0 || i >= this.edit.length || this.edit[i] < 0) { return; }
    this.edit[i] = -1;
    BF.platform.vibrate('light');
  };

  /** 从 from+1 开始绕一圈找下一个空位（含 from 本身若被跳过的情况），没有则 -1 */
  SceneCipher.prototype.nextEmptyAfter = function (from) {
    var n = this.edit.length, i;
    for (i = 1; i <= n; i++) {
      var k = (from + i) % n;
      if (this.edit[k] < 0) { return k; }
    }
    return -1;
  };

  SceneCipher.prototype.doAction = function (key) {
    if (key === 'clear') {
      this.edit = new Array(this.cfg.slots).fill(-1);
      this.cellSel = -1;
      this.showToast('已清空本行');
    } else if (key === 'undo') {
      // 有选中格就撤那一格，否则撤最靠右已填的（保留原来的"一步步退回来"手感）
      var k = (this.cellSel >= 0 && this.edit[this.cellSel] >= 0) ? this.cellSel : -1;
      if (k < 0) {
        for (var i = this.edit.length - 1; i >= 0; i--) { if (this.edit[i] >= 0) { k = i; break; } }
      }
      if (k < 0) { this.showToast('本行还是空的'); return; }
      this.removeAt(k);
      this.showToast('已取下第 ' + (k + 1) + ' 格');
    } else if (key === 'submit') {
      this.submit();
    }
  };

  SceneCipher.prototype.submit = function () {
    if (this.editRow() < 0) { return; }
    if (!this.editFull()) { this.showToast('密码还没填满'); return; }
    var guess = this.edit.slice();
    var fb = BF.CipherGen.feedback(guess, this.code);
    // 逐格提示按本关信息量裁剪（'exact' 关只留"位置对"，其余格子下方留空）
    var line = BF.CipherGen.revealHint(guess, this.code, this.cfg.info);
    this.rows.push({ guess: guess, fb: fb, line: line });
    this.edit = new Array(this.cfg.slots).fill(-1);
    this.cellSel = -1;          // 新的一行从头开始，光标不残留上一行的位置
    BF.platform.vibrate('medium');

    if (fb.exact >= this.cfg.slots) { this.onSolved(); return; }
    if (this.rows.length >= this.cfg.tries) { this.onFailed(); return; }
    // 提示模式本身会把结果画在行里，这里不再弹文案，免得挡住棋盘
  };

  SceneCipher.prototype.onSolved = function () {
    var stars = BF.CipherGen.starsFor(this.level, this.rows.length);
    if (this.isDaily) { BF.Save.clearDaily(stars); }
    else { BF.Save.clear(this.game, this.level, stars); }
    this.help = null; this.helpRect = null;       // 结算了就别再挂着说明气泡
    this.result = { win: true, t: 0, stars: stars, press: null };
    BF.platform.vibrate('heavy');
  };

  SceneCipher.prototype.onFailed = function () {
    this.help = null; this.helpRect = null;
    this.result = { win: false, t: 0, stars: 0, press: null };
    BF.platform.vibrate('heavy');
  };

  SceneCipher.prototype.next = function () {
    if (this.isDaily) { this.app.go('home'); return; }
    if (this.level >= this.meta.TOTAL) { this.app.go('levels', { game: this.game }); return; }
    BF.RuleTip.skipOnce(this);   // 关内进下一关不重复弹规则
    this.enter({ game: this.game, level: this.level + 1 });
  };

  SceneCipher.prototype.showToast = function (txt) { this.toast = { text: txt, t: 1500 }; };

  /**
   * 弹出某档图例的说明。再点同一项 = 收起（切换关闭），换一项 = 换内容。
   * 长按路径只会在 fired=false 时触发一次，所以不会"长按弹出来又被当成点按关掉"。
   */
  SceneCipher.prototype.showHelp = function (kind) {
    if (this.help && this.help.kind === kind) { this.help = null; this.helpRect = null; return; }
    this.help = { kind: kind, t: 0, life: HELP_LIFE };
    BF.platform.vibrate('light');
  };

  /* ---------------- 渲染 ---------------- */

  SceneCipher.prototype.render = function (ctx) {
    var pf = BF.platform, W = pf.width, H = pf.height;

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.bgTop);
    bg.addColorStop(1, T.bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    this.renderHeader(ctx);
    this.renderStrip(ctx);
    this.renderBoard(ctx);
    this.renderLegend(ctx);
    this.renderPalette(ctx);
    this.renderFooter(ctx);
    this.renderHelp(ctx);       // 说明气泡画在最上层（会盖住棋盘底部），点它即关
    this.renderToast(ctx);
    if (this.result) { this.renderResult(ctx); }

    if (this.fadeIn > 0) {
      ctx.save();
      ctx.globalAlpha = this.fadeIn * 0.85;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    // 规则弹框画在最上层（主体照常画，被遮罩压暗当背景）
    if (this.showRule) { BF.RuleTip.render(ctx, this); }
  };

  SceneCipher.prototype.renderHeader = function (ctx) {
    var W = BF.platform.width;
    D.fillRound(ctx, this.back.x, this.back.y, this.back.w, this.back.h, 14, '#FFFFFF');
    D.roundRect(ctx, this.back.x + 0.5, this.back.y + 0.5, this.back.w - 1, this.back.h - 1, 14);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    D.icon(ctx, 'back', this.back.x + this.back.w / 2, this.back.y + this.back.h / 2, 16, T.text);
    // 「?」重看规则入口（不再提示后也能随时打开）
    BF.RuleTip.renderBtn(ctx, this);

    var title = this.isDaily ? '每日挑战' : ('第 ' + this.level + ' 关');
    var sub = this.isDaily ? BF.util.dateKey(new Date())
                           : (this.meta.title + ' · ' + this.hintName());
    D.text(ctx, title, W / 2, this.headerY + 20, { size: 19, weight: '700' });
    D.text(ctx, sub, W / 2, this.headerY + 40, { size: 11.5, color: T.textSub });

    var left = Math.max(0, this.left());
    D.text(ctx, '剩 ' + left + ' 次', W - 16, this.headerY + 20,
      { size: 12.5, color: left <= 2 ? T.warn : T.textSub, weight: '600', align: 'right' });
    D.text(ctx, this.cfg.slots + ' 位 · ' + this.cfg.colors + ' 色', W - 16, this.headerY + 38,
      { size: 11, color: T.textSub, align: 'right', alpha: 0.85 });
  };

  SceneCipher.prototype.hintName = function () {
    var shape = this.cfg.hint === 'agg' ? '数量提示'
              : (this.cfg.hint === 'line' ? '划线提示' : '圆点提示');
    return this.cfg.info === 'exact' ? (shape + ' · 只标对位') : shape;
  };

  /** 密码条：游戏中全是灰「?」，破译成功 / 机会用完才揭示 */
  SceneCipher.prototype.renderStrip = function (ctx) {
    var pf = BF.platform, W = pf.width;
    D.fillRound(ctx, this.stripX, this.stripY, this.stripW, this.stripH, 15, '#FFFFFF');
    ctx.save();
    D.roundRect(ctx, this.stripX + 0.5, this.stripY + 0.5, this.stripW - 1, this.stripH - 1, 15);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    var revealed = !!this.result;
    var sh = this.chipSize, sq = 5;
    var rowW = this.cfg.slots * sh + (this.cfg.slots - 1) * sq;
    var x0 = this.stripX + this.stripW - 12 - rowW;
    var cy = this.stripY + this.stripH / 2;

    D.icon(ctx, 'lock', this.stripX + 18, cy, 13, revealed ? T.ok : T.textSub);
    D.text(ctx, '密码', this.stripX + 30, cy, { size: 11.5, color: T.textSub, weight: '600', align: 'left' });

    for (var i = 0; i < this.cfg.slots; i++) {
      var r = { x: x0 + i * (sh + sq), y: cy - sh / 2, w: sh, h: sh };
      if (revealed) {
        this.drawChip(ctx, r, this.palette[this.code[i]].hex, { small: true });
      } else {
        D.fillRound(ctx, r.x, r.y, r.w, r.h, sh * 0.28, '#E4E7EC');
        D.text(ctx, '?', r.x + r.w / 2, r.y + r.h / 2 + 0.5,
          { size: sh * 0.62, weight: '800', color: 'rgba(23,26,31,0.26)' });
      }
    }
  };

  SceneCipher.prototype.renderBoard = function (ctx) {
    var cfg = this.cfg, i, r;
    var er = this.result ? -1 : this.editRow();

    for (r = 0; r < cfg.tries; r++) {
      var submitted = r < this.rows.length;
      var isEdit = r === er;
      var cy = this.rowCY[r];

      // 行底纹：编辑行淡淡高亮，让它一眼看出"往这儿填"。
      // 只罩住格子列（rowW）——不能连右侧反馈区（fbW）一起算：
      // 编辑行是不画圆点的，带上 fbW 会往右凸出一块空白（圆点提示关尤其明显）。
      if (isEdit) {
        var pad = Math.max(4, this.slot * 0.14);
        D.fillRound(ctx, this.slotX0 - pad, cy - this.slot / 2 - pad,
          this.rowW + pad * 2, this.slot + pad * 2, 12, U.rgba(T.accent, 0.07));
      }

      for (i = 0; i < cfg.slots; i++) {
        var cr = this.cellRect(r, i);
        if (submitted) {
          this.drawChip(ctx, cr, this.palette[this.rows[r].guess[i]].hex, {});
          // 2 绿 / 1 白 / 0 黑 / -1 = 本关不告诉你（'exact' 关）→ 画灰色虚位，绝不留空
          if (cfg.hint === 'line') { this.drawLine(ctx, cr, this.rows[r].line[i]); }
        } else if (isEdit) {
          var sel = (this.cellSel === i);
          if (this.edit[i] >= 0) {
            this.drawChip(ctx, cr, this.palette[this.edit[i]].hex, {});
            if (sel) { this.drawCellCursor(ctx, cr); }
          } else {
            // 没手选格子时，仍把"下一个会填到的"空位点亮，保持顺推的可预期性
            this.drawEmptyChip(ctx, cr, {
              cursor: sel || (this.cellSel < 0 && i === this.firstEmpty())
            });
          }
        } else {
          this.drawEmptyChip(ctx, cr, { dim: true });
        }
      }

      // 圆点提示：也是"每格正下方"的一个点（和划线同位置、同含义，只是形状不同）——
      // 玩家抬头就能对上"这个颜色下面的点是什么颜色"，不用再去行右侧数汇总。
      // 注意：'-1'（本关不告诉你）同样要画（空心灰圈），否则 exact 关一旦整行没猜中
      // 就是一排空白，玩家分不清"提交成功但全错"和"提交没生效"。
      if (cfg.hint === 'dot' && submitted) {
        for (i = 0; i < cfg.slots; i++) {
          this.drawDotUnder(ctx, this.cellRect(r, i), this.rows[r].line[i]);
        }
      }

      // 数量提示（'agg' 关）：反馈画在**行右侧**的一个点阵上——
      // 只报"几个位置对 / 几个换位 / 几个排除"，不说是哪一格（经典 Mastermind 玩法）。
      if (cfg.hint === 'agg' && submitted) {
        this.drawDots(ctx, r, this.rows[r].fb);
      }
    }
  };

  SceneCipher.prototype.firstEmpty = function () {
    for (var i = 0; i < this.edit.length; i++) { if (this.edit[i] < 0) { return i; } }
    return -1;
  };

  /**
   * 图例：三个**可点按/长按**的小胶囊，说明绿/白/黑分别代表什么。
   * 画成胶囊是为了让人一眼看出"这是能点的"，同时把命中盒撑大到好按的高度。
   * 命中盒在这里按实测文字宽度回填到 this.legendRects —— 布局依赖 ctx 量字宽，
   * layout() 里算不了，所以放在渲染阶段缓存（渲染一定早于交互）。
   */
  SceneCipher.prototype.renderLegend = function (ctx) {
    var W = BF.platform.width;
    var line = this.cfg.hint === 'line';
    // 信息量决定图例有几项：'full' 关三种反馈都说；'exact' 关只说"位置对"，
    // 剩下的合并成一项「不告诉你」，免得玩家照着不存在的提示去找
    var items = this.cfg.info === 'exact'
      ? [{ kind: 2, label: LEGEND[2].label }, { kind: -1, label: LEGEND['-1'].label }]
      : [{ kind: 2, label: LEGEND[2].label },
         { kind: 1, label: LEGEND[1].label },
         { kind: 0, label: LEGEND[0].label }];
    var padX = 7, gap = 10, i;
    var innerW = [], total = 0;

    ctx.save();
    ctx.font = '600 11px ' + D.FONT;
    for (i = 0; i < items.length; i++) {
      innerW.push(18 + 5 + ctx.measureText(items[i].label).width);   // 小样 18 + 间隙 5 + 文字
      total += innerW[i] + padX * 2;
    }
    ctx.restore();
    total += gap * (items.length - 1);

    var x = (W - total) / 2;
    var cy = this.legendY + this.legendH / 2;
    // 命中盒比文字高一圈（18 → 30），手指更好按；上下各留 6px 仍在"棋盘底部~调色板"的空档里
    var boxH = this.legendH + 12;

    this.legendRects = [];
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      var bw = innerW[i] + padX * 2;
      var pressed = !!this.legendPress && this.legendPress.idx === i;
      var open = !!this.help && this.help.kind === it.kind;

      // 胶囊底：展开时用主色（反白），按下时加深 —— 给"这是按钮"的反馈
      D.fillRound(ctx, x, cy - boxH / 2, bw, boxH, boxH / 2,
        open ? T.accent : (pressed ? '#D6DBE2' : 'rgba(255,255,255,0.72)'));
      ctx.save();
      D.roundRect(ctx, x + 0.5, cy - boxH / 2 + 0.5, bw - 1, boxH - 1, boxH / 2);
      ctx.strokeStyle = open ? T.accentDeep : 'rgba(23,26,31,0.10)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      var sx = x + padX;
      if (it.kind < 0) {
        // "不告诉你"：画一个灰色的空槽（虚线 / 空心圈），表示"这里有反馈但被抹掉了"
        ctx.save();
        ctx.strokeStyle = open ? 'rgba(255,255,255,0.85)' : 'rgba(23,26,31,0.32)';
        ctx.lineWidth = 1.2;
        if (line) {
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(sx, cy); ctx.lineTo(sx + 18, cy); ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.beginPath(); ctx.arc(sx + 9, cy, 4.2, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
      } else if (line) {
        var lw = 18, lh = 5;
        D.fillRound(ctx, sx, cy - lh / 2, lw, lh, lh / 2, this.fbColor(it.kind));
        if (it.kind === 1) {
          ctx.save();
          D.roundRect(ctx, sx + 0.5, cy - lh / 2 + 0.5, lw - 1, lh - 1, lh / 2);
          ctx.strokeStyle = 'rgba(23,26,31,0.28)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.restore();
        }
      } else {
        this.drawDot(ctx, sx + 9, cy, 5.5, it.kind);
      }
      D.text(ctx, it.label, sx + 18 + 5 + (innerW[i] - 18 - 5) / 2, cy,
        { size: 11, color: open ? '#FFFFFF' : T.textSub, weight: '600' });

      this.legendRects.push({ x: x, y: cy - boxH / 2, w: bw, h: boxH, kind: it.kind });
      x += bw + gap;
    }
  };

  /**
   * 按像素宽度给中文折行（中文没有空格，只能逐字试宽）。'\n' 视为强制换行。
   * D.text 不会自动换行，说明文案又比图例长，所以这里自己切。
   */
  SceneCipher.prototype.wrapText = function (ctx, text, maxW, size) {
    ctx.save();
    ctx.font = '600 ' + size + 'px ' + D.FONT;
    var out = [], paras = String(text).split('\n'), p, i;
    for (p = 0; p < paras.length; p++) {
      var cur = '';
      for (i = 0; i < paras[p].length; i++) {
        var ch = paras[p][i];
        if (cur && ctx.measureText(cur + ch).width > maxW) { out.push(cur); cur = ch; }
        else { cur += ch; }
      }
      out.push(cur);
    }
    ctx.restore();
    return out;
  };

  /**
   * 图例说明气泡：浮在图例上方（会盖住棋盘最下面一两行，所以点它任意处即关，
   * 且 4.2 秒自动收起）。内容 = 这一档的含义 + 本关用的是哪种提示模式。
   */
  SceneCipher.prototype.renderHelp = function (ctx) {
    if (!this.help) { this.helpRect = null; return; }
    var W = BF.platform.width;
    var kind = this.help.kind;
    var meta = LEGEND[kind];
    var lineHint = this.cfg.hint === 'line';
    var note = this.cfg.hint === 'agg'
      ? '本关是数量提示：反馈在每行右侧，只给绿/白/黑点的个数，不说是哪一格。'
      : (lineHint
         ? '本关是划线提示：每格下方一条线，一眼看出是哪一格。'
         : '本关是圆点提示：每格正下方一个点，和划线一样能看出是哪一格。');

    var pad = 14;
    var w = Math.min(W - 40, 300);
    var textW = w - pad * 2;
    var lines = this.wrapText(ctx, meta.desc, textW, 12.5);
    var noteLines = this.wrapText(ctx, note, textW, 11.5);

    var titleH = 26, lineH = 17, noteLineH = 16;
    var h = pad + titleH + 6 + lines.length * lineH + 6 + noteLines.length * noteLineH + pad;
    var x = (W - w) / 2;
    var y = this.legendY - 8 - h;
    // 底部提示条（toast）画在气泡之上，两者会叠在一起（进关那 1.5 秒内点图例就能撞上）。
    // 撞上时把气泡整体上抬一个提示条的高度，谁都不挡谁；抬完仍在屏幕内（气泡本来就矮）。
    if (this.toast && y - 46 > BF.platform.safeTop) { y -= 46; }

    var s = U.easeOutCubic(U.clamp(this.help.t / 180, 0, 1));
    var dy = y + (1 - s) * 8;          // 轻微上浮，别太张扬

    ctx.save();
    ctx.globalAlpha = s;
    D.panel(ctx, x, dy, w, h, { radius: 14, shadowBlur: 18, shadowOffsetY: 6 });

    // 标题行：色样 + 档位名 + "轻点收起"
    var sx = x + pad, ty = dy + pad + 13, i;
    if (lineHint) {
      D.fillRound(ctx, sx, ty - 2.5, 18, 5, 2.5, this.fbColor(kind));
      if (kind === 1) {
        D.roundRect(ctx, sx + 0.5, ty - 2, 17, 4, 2);
        ctx.strokeStyle = 'rgba(23,26,31,0.28)'; ctx.lineWidth = 1; ctx.stroke();
      }
    } else {
      this.drawDot(ctx, sx + 9, ty, 5.5, kind);
    }
    D.text(ctx, meta.label, sx + 18 + 6, ty, { size: 13.5, weight: '700', align: 'left' });
    D.text(ctx, '轻点收起', x + w - pad, ty, { size: 10.5, color: T.textSub, align: 'right' });

    var ly = dy + pad + titleH + 6;
    for (i = 0; i < lines.length; i++) {
      D.text(ctx, lines[i], sx, ly + i * lineH + lineH / 2,
        { size: 12.5, align: 'left', color: T.text });
    }
    var ny = ly + lines.length * lineH + 6;
    for (i = 0; i < noteLines.length; i++) {
      D.text(ctx, noteLines[i], sx, ny + i * noteLineH + noteLineH / 2,
        { size: 11.5, align: 'left', color: T.textSub });
    }
    ctx.restore();

    this.helpRect = { x: x, y: y, w: w, h: h };
  };

  SceneCipher.prototype.fbColor = function (kind) {
    return kind === 2 ? GREEN : (kind === 1 ? WHITE : BLACK);
  };

  /**
   * 一个圆点：绿=位置对 / 白=颜色对位置错 / 黑=颜色不在密码里 /
   * **空心灰圈 = 本关不告诉你**（'exact' 关：这格不对，但不说错在"换位"还是"排除"）。
   * 空心圈必须画出来而不是留空——留空会和"没提交成功"看起来一模一样。
   */
  SceneCipher.prototype.drawDot = function (ctx, x, y, r, kind) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, kind < 0 ? r * 0.92 : r, 0, Math.PI * 2);
    if (kind < 0) {
      // 「不告诉你」：空心灰圈。棋盘上比图例小样再实一点（主视觉区域，淡了会被当成"没提示"）
      ctx.strokeStyle = 'rgba(23,26,31,0.42)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = this.fbColor(kind);
      ctx.fill();
      if (kind === 1) {
        ctx.strokeStyle = 'rgba(23,26,31,0.30)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  /**
   * 圆点提示：格子**正下方**的一个点（绿=位置对 / 白=换位 / 黑=排除）。
   * 圆心故意落在划线提示那条线的中线上（同样的上边距 + 半厚偏移），
   * 这样两种提示模式的"下方小样"在竖直方向上完全对齐，切关不会跳。
   */
  SceneCipher.prototype.drawDotUnder = function (ctx, cr, kind) {
    var lh = Math.max(3, cr.w * 0.10);                          // 与划线同厚度
    var y = cr.y + cr.h + Math.max(2.5, cr.w * 0.09) + lh / 2;  // 落在线的中心线上
    var d = Math.max(6, cr.w * 0.20);
    this.drawDot(ctx, cr.x + cr.w / 2, y, d / 2, kind);
  };

  /**
   * 数量提示（'agg' 关）的点阵：画在**行右侧**的反馈区里，
   * 顺序固定 绿(2) → 白(1) → 黑(0)，按 fbCols 列从左上填到右下。
   * 点阵在反馈区里水平/竖直都居中——只对了 1 个点时也贴着格子列中轴，不会飘到边角。
   * 点的种类与个数完全来自 Gen.aggDots(fb)，渲染不自己数，避免与数据层各说各话。
   */
  SceneCipher.prototype.drawDots = function (ctx, row, fb) {
    var rect = this.fbRect(row);
    if (rect.w <= 0) { return; }
    var kinds = BF.CipherGen.aggDots(fb);
    var cols = this.fbCols || 2;
    var d = this.fbDot || 8;
    var gap = d * 0.42;
    var rowsN = Math.ceil(kinds.length / cols);
    var gw = cols * d + (cols - 1) * gap;
    var gh = rowsN * d + (rowsN - 1) * gap;
    var x0 = rect.x + (rect.w - gw) / 2;
    var y0 = rect.y + (rect.h - gh) / 2;
    for (var i = 0; i < kinds.length; i++) {
      var cx = x0 + (i % cols) * (d + gap) + d / 2;
      var cy = y0 + Math.floor(i / cols) * (d + gap) + d / 2;
      this.drawDot(ctx, cx, cy, d / 2, kinds[i]);
    }
  };

  /** 划线提示：格子下方一条线（kind < 0 = 本关不告诉你 → 浅灰虚线，同样不能留空） */
  SceneCipher.prototype.drawLine = function (ctx, cr, kind) {
    var lw = cr.w * 0.86;
    var lh = Math.max(3, cr.w * 0.10);
    var x = cr.x + (cr.w - lw) / 2;
    var y = cr.y + cr.h + Math.max(2.5, cr.w * 0.09);
    if (kind < 0) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(23,26,31,0.30)';
      ctx.lineWidth = Math.max(1.2, lh * 0.45);
      ctx.beginPath();
      ctx.moveTo(x + 1, y + lh / 2);
      ctx.lineTo(x + lw - 1, y + lh / 2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    D.fillRound(ctx, x, y, lw, lh, lh / 2, this.fbColor(kind));
    if (kind === 1) {
      ctx.save();
      D.roundRect(ctx, x + 0.5, y + 0.5, lw - 1, lh - 1, lh / 2);
      ctx.strokeStyle = 'rgba(23,26,31,0.30)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
  };

  /** 一个彩色格子（圆角 + 顶部高光 + 描边） */
  SceneCipher.prototype.drawChip = function (ctx, rect, hex, opt) {
    opt = opt || {};
    var r = rect.w * 0.28;
    ctx.save();
    if (opt.lift !== false) {
      ctx.shadowColor = 'rgba(23,26,31,0.18)';
      ctx.shadowBlur = rect.w * 0.12;
      ctx.shadowOffsetY = rect.w * 0.05;
    }
    var g = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
    g.addColorStop(0, U.shade(hex, 0.26));
    g.addColorStop(0.52, hex);
    g.addColorStop(1, U.shade(hex, -0.18));
    D.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, r);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    // 顶部高光
    ctx.save();
    var hg = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h * 0.45);
    hg.addColorStop(0, 'rgba(255,255,255,0.30)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    D.roundRect(ctx, rect.x + rect.w * 0.10, rect.y + rect.h * 0.08,
      rect.w * 0.80, rect.h * 0.40, r * 0.7);
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.restore();

    ctx.save();
    D.roundRect(ctx, rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1, r);
    ctx.strokeStyle = 'rgba(23,26,31,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  };

  /** 选中格的光标：套在已填色块外面的一圈主色环，指明"下一个颜色落在这儿" */
  SceneCipher.prototype.drawCellCursor = function (ctx, rect) {
    var pad = Math.max(2.5, rect.w * 0.10);
    var r = rect.w * 0.28 + pad * 0.6;
    ctx.save();
    D.roundRect(ctx, rect.x - pad + 0.5, rect.y - pad + 0.5,
      rect.w + pad * 2 - 1, rect.h + pad * 2 - 1, r);
    ctx.strokeStyle = T.accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  };

  /** 一个空槽（凹槽感） */
  SceneCipher.prototype.drawEmptyChip = function (ctx, rect, opt) {
    opt = opt || {};
    var r = rect.w * 0.28;
    ctx.save();
    if (opt.dim) { ctx.globalAlpha = 0.55; }
    D.fillRound(ctx, rect.x, rect.y, rect.w, rect.h, r, '#E4E7EC');
    D.roundRect(ctx, rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1, r);
    ctx.strokeStyle = opt.cursor ? U.rgba(T.accent, 0.75) : T.slotEdge;
    ctx.lineWidth = opt.cursor ? 2 : 1;
    ctx.stroke();
    ctx.restore();
  };

  SceneCipher.prototype.renderPalette = function (ctx) {
    for (var i = 0; i < this.palettes.length; i++) {
      var p = this.palettes[i];
      var used = this.edit.indexOf(p.color) >= 0;          // 编辑行里已经用过的颜色 → 置灰
      var dead = this.editRow() < 0;                       // 没有编辑行了（已提交满）
      var hex = this.palette[p.color].hex;
      var r = Math.min(p.w, p.h) / 2;

      ctx.save();
      ctx.globalAlpha = (used || dead) ? 0.30 : 1;
      var g = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
      g.addColorStop(0, U.shade(hex, 0.26));
      g.addColorStop(0.52, hex);
      g.addColorStop(1, U.shade(hex, -0.18));
      D.roundRect(ctx, p.x, p.y, p.w, p.h, r * 0.62);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = (used || dead) ? 0.45 : 1;
      D.roundRect(ctx, p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1, r * 0.62);
      ctx.strokeStyle = 'rgba(23,26,31,0.16)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
  };

  SceneCipher.prototype.renderFooter = function (ctx) {
    var full = this.editFull() && this.editRow() >= 0;
    for (var i = 0; i < this.btns.length; i++) {
      var b = this.btns[i];
      if (b.key === 'submit') {
        if (full) {
          D.button(ctx, b, b.label, { fill: T.accent, color: '#FFFFFF', size: 15, shadow: true });
        } else {
          D.button(ctx, b, b.label, { fill: '#FFFFFF', color: T.text, disabled: true, size: 15 });
        }
      } else {
        D.button(ctx, b, b.label, { fill: '#FFFFFF', color: T.text, icon: b.icon, iconColor: T.textSub });
      }
    }
  };

  SceneCipher.prototype.renderToast = function (ctx) {
    if (!this.toast) { return; }
    var pf = BF.platform;
    var a = Math.min(1, this.toast.t / 320);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 13px ' + D.FONT;
    var w = ctx.measureText(this.toast.text).width + 32;
    var x = (pf.width - w) / 2, y = this.boardBottom - 26;
    D.fillRound(ctx, x, y, w, 38, 19, 'rgba(28,31,36,0.88)');
    D.text(ctx, this.toast.text, pf.width / 2, y + 19.5, { size: 13, color: '#FFFFFF', weight: '600' });
    ctx.restore();
  };

  SceneCipher.prototype.overlayLayout = function () {
    var pf = BF.platform, H = pf.height;
    var w = Math.min(pf.width - 56, 300), h = 300;
    var x = (pf.width - w) / 2, y = (H - h) / 2 - 10;
    var pad = 20, bw = (w - pad * 2 - 12) / 2;
    return {
      card: { x: x, y: y, w: w, h: h },
      again: { x: x + pad, y: y + h - pad - 48, w: bw, h: 48 },
      next: { x: x + pad + bw + 12, y: y + h - pad - 48, w: bw, h: 48 }
    };
  };

  function mapRect(r, card, dx, dy, k) {
    return { x: dx + (r.x - card.x) * k, y: dy + (r.y - card.y) * k, w: r.w * k, h: r.h * k };
  }

  SceneCipher.prototype.renderResult = function (ctx) {
    var pf = BF.platform, ob = this.overlayLayout();
    var win = this.result.win;
    var t = Math.min(1, this.result.t / 260);
    var s = U.easeOutCubic(t);

    ctx.save();
    ctx.globalAlpha = 0.9 * Math.min(1, this.result.t / 200);
    ctx.fillStyle = T.scrim;
    ctx.fillRect(0, 0, pf.width, pf.height);
    ctx.restore();

    var card = ob.card;
    var cw = card.w * (0.86 + 0.14 * s), ch = card.h * (0.86 + 0.14 * s);
    var cx = card.x + (card.w - cw) / 2, cy = card.y + (card.h - ch) / 2;

    ctx.save();
    ctx.globalAlpha = s;
    D.panel(ctx, cx, cy, cw, ch, { radius: 22, shadowBlur: 24, shadowOffsetY: 8 });

    var last = !this.isDaily && this.level >= this.meta.TOTAL;
    var title = this.isDaily ? (win ? '今日挑战完成' : '今日挑战失败')
                             : (win ? (last ? '🎉 全部破译！' : '破译成功！') : '机会用完了');
    D.text(ctx, title, cx + cw / 2, cy + 42, { size: 21, weight: '700' });
    if (win && last) {
      D.text(ctx, '已解锁全部 ' + this.meta.TOTAL + ' 关', cx + cw / 2, cy + 66,
        { size: 12.5, color: T.textSub });
    }

    if (win) {
      var starY = cy + 96, r = 22, gapx = r * 2.5;
      for (var i = 0; i < 3; i++) {
        var on = i < this.result.stars;
        var delay = U.clamp((this.result.t - 180 - i * 130) / 220, 0, 1);
        var sc = on ? (0.6 + 0.4 * U.easeOutCubic(delay)) * (1 + 0.25 * Math.sin(Math.PI * delay)) : 1;
        D.star(ctx, cx + cw / 2 + (i - 1) * gapx, starY, r * sc, 0.46,
          on ? T.gold : 'rgba(23,26,31,0.10)', 'rgba(23,26,31,0.10)');
      }
      var th = BF.CipherGen.thresholdsFor(this.level);
      D.text(ctx, '用了 ' + this.used() + ' 次验证（共 ' + this.cfg.tries + ' 次机会）',
        cx + cw / 2, cy + 142, { size: 12.5, color: T.textSub });
      D.text(ctx, '本关 3★ 线：≤ ' + th.three + ' 次　·　2★ 线：≤ ' + th.two + ' 次',
        cx + cw / 2, cy + 162, { size: 11, color: T.textSub, weight: '600' });
    } else {
      D.text(ctx, this.cfg.tries + ' 次机会用完，正确密码是：',
        cx + cw / 2, cy + 128, { size: 12.5, color: T.textSub });
    }

    // 密码揭示
    var sh = 30, sq = 6;
    var rowW = this.cfg.slots * sh + (this.cfg.slots - 1) * sq;
    if (rowW > cw - 40) {
      var k2 = (cw - 40) / rowW;
      sh *= k2; sq *= k2; rowW = this.cfg.slots * sh + (this.cfg.slots - 1) * sq;
    }
    var x0 = cx + (cw - rowW) / 2;
    var chipCY = cy + (win ? 192 : 160);
    for (var j = 0; j < this.cfg.slots; j++) {
      this.drawChip(ctx, { x: x0 + j * (sh + sq), y: chipCY - sh / 2, w: sh, h: sh },
        this.palette[this.code[j]].hex, { small: true });
    }

    var k = cw / card.w;
    var ra = mapRect(ob.again, card, cx, cy, k);
    var rn = mapRect(ob.next, card, cx, cy, k);
    var pr = this.result.press;

    D.button(ctx, ra, win ? '重玩' : '再来一次',
      { fill: pr === 'again' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15 });
    D.button(ctx, rn, this.isDaily ? '返回首页' : (last ? '返回关卡' : '下一关'),
      { fill: pr === 'next' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15, shadow: true });
    ctx.restore();
  };

  BF.SceneCipher = SceneCipher;
})();
