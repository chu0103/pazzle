/**
 * blocks.js —— 第 8 款游戏「超级积木」玩法场景
 *
 * 玩法（数字化「计客超级积木 GIIKER Super Blocks」）：
 *   8×8 LED 棋盘上亮起一片局部亮区（不规则），并只给一组指定颜色的积木；
 *   把积木不重叠、不出界、只压亮区地恰好填满亮区即过关。
 *
 * 交互：
 *   - 从底部托盘「拖」积木到棋盘：松手时按最近格吸附，实时校验；
 *   - 合法落子 → 吸附到位；非法（出界 / 压暗格 / 与已放积木重叠）→ 红色闪一下并退回原处；
 *   - 拖动已放好的积木可把它挪走重摆；
 *   - 托盘里「双击」某积木 = 原地旋转（也可先点选再按「旋转」按钮）；
 *   - 「提示」每关 1 次（Learn Mode）：把一块摆到标准解位置；
 *   - 限时挑战：倒计时，按剩余时间比例给 S/A/B/C/D/E；普通关按提示/非法次数给 ★★★。
 *
 * 结构照抄 bottle.js（独立场景：enter/layout/update/onDown/onMove/onUp/render
 * + overlayLayout/renderWin + next()），绘制全用 D.* / U.*。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.SceneBlocks) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;
  var Gen = BF.BlocksGen;
  var SIZE = Gen.SIZE;

  function pieceCells(id, rot, gx, gy) {
    var cells = Gen.PIECE_ROT[id][rot];
    var out = [];
    for (var i = 0; i < cells.length; i++) { out.push([cells[i][0] + gx, cells[i][1] + gy]); }
    return out;
  }

  function SceneBlocks(app) {
    this.app = app;
    this.fadeIn = 1;
    this.t = 0;
    this.win = null;
    this.toast = null;
    this.held = null;        // 正在拖动/拿起的积木：{ piece, from:'tray'|'board', x, y, moved, thr, origX, origY, origRot }
    this.selected = null;     // 托盘里被选中的积木（点选态，供「旋转」按钮用）
    this.lastTap = null;     // 双击检测：{ piece, t }
    this.pressBtn = null;
    this.flash = null;       // 非法落子红闪：{ t, cells:[idx] }
    this.pickDiff = false;   // 是否停在「难度自选」首屏（与 rush / diff 共用 BF.DiffPick）
    this.pickCards = null;
  }

  SceneBlocks.prototype.enter = function (params) {
    params = params || {};
    // 难度自选首屏：只选难度，不加载棋盘/托盘（点档卡后才 build 题目）
    if (params.pickDiff) { return BF.DiffPick.enter(this, params); }
    this.pickDiff = false;
    this.isDaily = !!params.daily;
    this.game = params.game || 'blocks';
    this.level = params.level || 1;

    var meta = BF.games && (BF.games[this.game] || BF.games.blocks);
    if (!meta) { throw new Error('未注册的游戏: ' + this.game); }
    this.meta = meta;

    this.puzzle = this.isDaily ? meta.buildDaily() : meta.build(this.level);
    if (this.puzzle.daily) { this.isDaily = true; }

    // 亮区布尔数组（64）+ 计数
    this.lit = new Array(SIZE * SIZE).fill(false);
    var litCount = 0;
    for (var i = 0; i < SIZE * SIZE; i++) {
      if ((this.puzzle.region & (1n << BigInt(i))) !== 0n) { this.lit[i] = true; litCount++; }
    }
    this.litCount = litCount;

    // 托盘积木：用标准解里的 id 集合（每关给的就是恰好能铺满的那组）
    this.stdById = {};
    var self = this;
    this.puzzle.pieces.forEach(function (s) { self.stdById[s.id] = s; });
    this.pieces = this.puzzle.pieces.map(function (s) {
      return { id: s.id, rot: s.rot, x: s.x, y: s.y, placed: false };
    });
    this.colors = this.puzzle.colors.slice();

    this.hintCount = 0;
    this.illegal = 0;
    this.selected = null;
    this.lastTap = null;
    this.held = null;
    this.pressBtn = null;
    this.win = null;
    this.toast = null;
    this.flash = null;

    this.timed = !!this.puzzle.timed && this.puzzle.timeLimit > 0;
    this.timeLeft = this.timed ? this.puzzle.timeLimit : 0;
    this.rank = '';

    this.recompute();
    this.layout();
    this.fadeIn = 1;
    this.t = 0;
    // 「玩法说明」弹框：每次进这款游戏的第一个关卡时弹一次（勾过「不再提示」则不弹）
    if (BF.RuleTip.shouldShow(this.game, this)) { BF.RuleTip.enter(this, params); }
    return this;
  };

  /** 重算占用与已覆盖亮格数（每次放/取积木后调用） */
  SceneBlocks.prototype.recompute = function () {
    this.occupied = new Array(SIZE * SIZE).fill(false);
    this.covered = 0;
    for (var p = 0; p < this.pieces.length; p++) {
      var pc = this.pieces[p];
      if (!pc.placed) { continue; }
      var cells = pieceCells(pc.id, pc.rot, pc.x, pc.y);
      for (var c = 0; c < cells.length; c++) {
        var idx = cells[c][1] * SIZE + cells[c][0];
        if (!this.occupied[idx]) { this.occupied[idx] = true; this.covered++; }
      }
    }
  };

  /* ---------------- 布局 ---------------- */

  SceneBlocks.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var top = pf.safeTop;

    this.headerH = 52;
    this.headerY = top;
    this.back = { x: 12, y: top + 6, w: 40, h: 40 };

    // 底部按钮（旋转 / 提示 / 重置）固定在安全区上方
    var btnY = H - pf.safeBottom - 62;
    // 托盘紧贴按钮上方（⚠️ 曾经把按钮画在托盘区域里，点托盘全命中按钮 → 拖不动积木）
    // 积木多（>7 块）时托盘加高 → 两行且每格更大（专家档 11 块也看得清）。
    // 行数按「本关积木总数」定（不是剩余数），放走几块后不会突然跳行。
    var trayRows = (!this.pieces || this.pieces.length <= 6) ? 1 : 2;
    var trayH = trayRows === 1 ? 104 : 132;
    this.trayRows = trayRows;
    this.trayY = btnY - 10 - trayH;
    this.trayH = trayH;
    // 棋盘：在头部与托盘之间垂直居中，cell 自适应（封顶 ~46）
    var boardTop = top + this.headerH + 10;
    var boardBottom = this.trayY - 8;
    var avail = boardBottom - boardTop;
    var cell = Math.floor(Math.min((avail - 16) / SIZE, (W - 32) / SIZE, 46));
    if (cell < 24) { cell = 24; }
    var bw = cell * SIZE;
    this.cell = cell;
    this.boardW = bw;
    this.boardX = (W - bw) / 2;
    this.boardY = boardTop + Math.max(0, (avail - bw) / 2);

    // 底部按钮（旋转 / 提示 / 重置）
    var bw2 = (W - 24 - 10 * 2) / 3;
    this.btns = [
      { x: 12, y: btnY, w: bw2, h: 48, key: 'rotate', label: '旋转', icon: 'reset' },
      { x: 12 + bw2 + 10, y: btnY, w: bw2, h: 48, key: 'hint', label: '提示', icon: 'hint' },
      { x: 12 + (bw2 + 10) * 2, y: btnY, w: bw2, h: 48, key: 'reset', label: '重置', icon: 'undo' }
    ];
  };

  /* ---------------- 更新 ---------------- */

  SceneBlocks.prototype.update = function (dt) {
    if (this.showRule) { return BF.RuleTip.update(this, dt); }
    this.t += dt;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) { this.toast = null; } }
    if (this.flash) { this.flash.t -= dt; if (this.flash.t <= 0) { this.flash = null; } }
    if (this.pickDiff) { return; }               // 难度首屏不跑倒计时/玩法状态机
    if (this.win) { this.win.t += dt; }
    if (this.timed && !this.win) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.onTimeout(); }
    }
  };

  /* ---------------- 输入 ---------------- */

  SceneBlocks.prototype.trayTokenAt = function (x, y) {
    if (!this.trayTokens) { return -1; }
    for (var i = 0; i < this.trayTokens.length; i++) {
      if (U.pointInRect(x, y, this.trayTokens[i])) { return i; }
    }
    return -1;
  };

  SceneBlocks.prototype.placedPieceAt = function (x, y) {
    // 命中最上层（后放的）积木：反序遍历
    for (var p = this.pieces.length - 1; p >= 0; p--) {
      var pc = this.pieces[p];
      if (!pc.placed) { continue; }
      var cells = pieceCells(pc.id, pc.rot, pc.x, pc.y);
      for (var c = 0; c < cells.length; c++) {
        var cx = this.boardX + cells[c][0] * this.cell;
        var cy = this.boardY + cells[c][1] * this.cell;
        if (U.pointInRect(x, y, { x: cx, y: cy, w: this.cell, h: this.cell })) { return p; }
      }
    }
    return -1;
  };

  SceneBlocks.prototype.onDown = function (x, y) {
    if (this.showRule) { BF.RuleTip.onDown(this, x, y); return; }
    // header 左上角「?」：随时重看玩法说明（无视「不再提示」）
    if (!this.win && !this.gameOver && !this.pickDiff &&
        U.pointInRect(x, y, BF.RuleTip.btn(this))) { BF.RuleTip.enter(this, { force: true }); return; }
    if (this.pickDiff) { BF.DiffPick.onDown(this, x, y); return; }
    if (this.win) {
      var ob = this.overlayLayout();
      this.win.press = null;
      if (U.pointInRect(x, y, ob.again)) { this.win.press = 'again'; return; }
      if (U.pointInRect(x, y, ob.next)) { this.win.press = 'next'; return; }
      return;
    }
    if (U.pointInRect(x, y, this.back)) {
      this.app.go(this.isDaily ? 'home' : 'levels', { game: this.game });
      return;
    }
    for (var i = 0; i < this.btns.length; i++) {
      if (U.pointInRect(x, y, this.btns[i])) { this.pressBtn = this.btns[i]; return; }
    }
    // 托盘积木 → 拿起（拖拽预备）
    // ⚠️ 必须取 token 上挂的 piece 引用：token 索引是「未放置积木」的序号，
    // 与 this.pieces 的全局索引在放过多块之后会错位（曾导致拖托盘抓到错误的积木）。
    var tk = this.trayTokenAt(x, y);
    if (tk >= 0) {
      var piece = this.trayTokens[tk].piece;
      // 抓取偏移感知：记录手指相对积木原点的格偏移（用托盘 cs 归一），
      // 拖拽与吸附全程保持该偏移，积木精确落在所见位置（否则偏移形状会整块偏半格被拒）。
      var td = piece._tray || { x: this.trayTokens[tk].x, y: this.trayTokens[tk].y, cs: this.cell };
      var grabDX = (x - td.x) / td.cs;
      var grabDY = (y - td.y) / td.cs;
      // px0/py0 = 按下点：拖拽阈值必须相对「按下点」判定（否则快速拖动只发一两次 move 时
      // 会把整段位移当成起点、moved 永真为假 → 落子被当成点按，积木「放不下」）。
      this.held = { piece: piece, from: 'tray', x: x, y: y, px0: x, py0: y, moved: false,
                    thr: Math.max(8, this.cell * 0.35), tokenIndex: tk, grabDX: grabDX, grabDY: grabDY };
      this.selected = piece;
      return;
    }
    // 已放好的积木 → 拿起（先从占用里摘掉，移动后可重摆）
    var pk = this.placedPieceAt(x, y);
    if (pk >= 0) {
      var pp = this.pieces[pk];
      pp.placed = false;
      this.recompute();
      var c0 = this.cell, bx0 = this.boardX, by0 = this.boardY;
      var grabDX = (x - (bx0 + pp.x * c0)) / c0;
      var grabDY = (y - (by0 + pp.y * c0)) / c0;
      this.held = { piece: pp, from: 'board', x: x, y: y, px0: x, py0: y, moved: false,
                    thr: Math.max(8, this.cell * 0.35), origX: pp.x, origY: pp.y, origRot: pp.rot, grabDX: grabDX, grabDY: grabDY };
      this.selected = pp;
      return;
    }
  };

  SceneBlocks.prototype.onMove = function (x, y) {
    if (!this.held) { return; }
    var d = this.held;
    d.x = x; d.y = y;
    if (!d.moved) {
      // 阈值相对「按下点」判定（px0/py0 在 onDown 记录）——避免快速拖动只发一两次 move 时
      // 起点被记到中途、整段位移被当成零位移，导致拖拽被识别成点按。
      var dx = x - d.px0, dy = y - d.py0;
      if (dx * dx + dy * dy > d.thr * d.thr) { d.moved = true; }
    }
  };

  SceneBlocks.prototype.onUp = function (x, y) {
    if (this.showRule) { BF.RuleTip.onUp(this, x, y); return; }
    if (this.pickDiff) { BF.DiffPick.onUp(this, x, y); return; }
    if (this.win) {
      var ob = this.overlayLayout();
      var hit = this.win.press;
      this.win.press = null;
      if (hit === 'again' && U.pointInRect(x, y, ob.again)) {
        BF.RuleTip.skipOnce(this);   // 重玩本关不重复弹规则
        this.enter({ game: this.game, level: this.level, daily: this.isDaily });
        return;
      }
      if (hit === 'next' && U.pointInRect(x, y, ob.next)) { this.next(); return; }
      return;
    }
    if (this.pressBtn) {
      var btn = this.pressBtn;
      this.pressBtn = null;
      if (U.pointInRect(x, y, btn)) { this.doAction(btn.key); }
      return;
    }
    if (this.held) {
      var d = this.held;
      this.held = null;
      var piece = d.piece;
      if (d.moved) {
        var g = this.snap(d);
        var overB = this.overBoard(d.x, d.y);
        if (overB && this.isValid(piece, g.rot, g.gx, g.gy)) {
          piece.placed = true; piece.rot = g.rot; piece.x = g.gx; piece.y = g.gy;
          this.recompute();
          if (this.covered >= this.litCount) { this.onSolved(); }
        } else if (!overB) {
          // 松手不在棋盘上：托盘积木 = 放回托盘（无惩罚）；
          // 已放的积木 = 拖出棋盘取回托盘（对应实物"把积木取出来"），同样不计失误。
          if (d.from === 'board') {
            piece.placed = false;
            this.recompute();
            this.showToast('已取回托盘');
          }
        } else {
          // 在棋盘上但不合法：红闪 + 退回原处 + 计 1 次失误
          this.flashCells(piece, g.rot, g.gx, g.gy);
          if (d.from === 'board') {
            piece.placed = true; piece.rot = d.origRot; piece.x = d.origX; piece.y = d.origY;
            this.recompute();
          } else {
            piece.placed = false;
          }
          this.illegal++;
          this.showToast('放不下：要压在亮区里且不重叠');
        }
        this.selected = null;
      } else {
        // 没拖动 = 一次点按：托盘积木点选/双击旋转；已放积木点一下取回托盘
        if (d.from === 'tray') {
          this.handleTrayTap(piece);
        } else {
          piece.placed = false;
          this.recompute();
          this.showToast('已取回托盘');
        }
      }
      return;
    }
  };

  /** 托盘积木点按：双击=旋转（原地），单击=选中 */
  SceneBlocks.prototype.handleTrayTap = function (piece) {
    var now = this.t;
    if (this.lastTap && this.lastTap.piece === piece && (now - this.lastTap.t) < 320) {
      this.rotatePiece(piece);   // 双击旋转
      this.lastTap = null;
      return;
    }
    this.selected = piece;       // 单击选中（供「旋转」按钮）
    this.lastTap = { piece: piece, t: now };
  };

  /** 把手指位置吸附到最近的有效网格锚点（保持抓取偏移，积木精确落在所见位置） */
  SceneBlocks.prototype.snap = function (d) {
    var piece = d.piece;
    var c = this.cell;
    // 按抓取偏移还原积木绘制原点，再吸附到网格
    var drawX = d.x - d.grabDX * c;
    var drawY = d.y - d.grabDY * c;
    var gx = Math.round((drawX - this.boardX) / c);
    var gy = Math.round((drawY - this.boardY) / c);
    return { rot: piece.rot, gx: gx, gy: gy };
  };

  /** 落在棋盘上吗（用于决定红闪/退回逻辑） */
  SceneBlocks.prototype.overBoard = function (x, y) {
    return x >= this.boardX - this.cell && x <= this.boardX + this.boardW + this.cell &&
           y >= this.boardY - this.cell && y <= this.boardY + this.boardW + this.cell;
  };

  /** 校验：全部格在界内、亮起、且未被其它已放积木占用 */
  SceneBlocks.prototype.isValid = function (piece, rot, gx, gy) {
    var cells = Gen.PIECE_ROT[piece.id][rot];
    for (var i = 0; i < cells.length; i++) {
      var cx = cells[i][0] + gx, cy = cells[i][1] + gy;
      if (cx < 0 || cx >= SIZE || cy < 0 || cy >= SIZE) { return false; }
      var idx = cy * SIZE + cx;
      if (!this.lit[idx]) { return false; }
      if (this.occupied[idx]) { return false; }
    }
    return true;
  };

  SceneBlocks.prototype.flashCells = function (piece, rot, gx, gy) {
    var cells = Gen.PIECE_ROT[piece.id][rot];
    var bad = [];
    for (var i = 0; i < cells.length; i++) {
      var cx = cells[i][0] + gx, cy = cells[i][1] + gy;
      if (cx < 0 || cx >= SIZE || cy < 0 || cy >= SIZE) { continue; }
      bad.push([cx, cy]);
    }
    this.flash = { t: 260, cells: bad };
  };

  SceneBlocks.prototype.doAction = function (key) {
    if (key === 'rotate') {
      // 旋转当前选中（或正在拖动）的积木
      var p = this.held ? this.held.piece : this.selected;
      if (p) { this.rotatePiece(p); }
      else { this.showToast('先选一个积木'); }
    } else if (key === 'hint') {
      this.doHint();
    } else if (key === 'reset') {
      for (var i = 0; i < this.pieces.length; i++) {
        this.pieces[i].placed = false;
        this.pieces[i].rot = this.stdById[this.pieces[i].id].rot;
        this.pieces[i].x = this.stdById[this.pieces[i].id].x;
        this.pieces[i].y = this.stdById[this.pieces[i].id].y;
      }
      this.recompute();
      this.showToast('已重置');
    }
  };

  SceneBlocks.prototype.rotatePiece = function (piece) {
    var n = Gen.PIECE_ROT[piece.id].length;
    piece.rot = (piece.rot + 1) % n;
  };

  /** Learn Mode：每关 1 次提示，把一块摆到标准解位置 */
  SceneBlocks.prototype.doHint = function () {
    if (this.hintCount >= 1) { this.showToast('本关提示已用完'); return; }
    var target = null;
    for (var i = 0; i < this.pieces.length; i++) {
      if (!this.pieces[i].placed) { target = this.pieces[i]; break; }
    }
    if (!target) { return; }
    var std = this.stdById[target.id];
    target.placed = true; target.rot = std.rot; target.x = std.x; target.y = std.y;
    this.recompute();
    this.hintCount++;
    this.selected = null;
    this.showToast('已提示一块');
    if (this.covered >= this.litCount) { this.onSolved(); }
  };

  SceneBlocks.prototype.showToast = function (txt) { this.toast = { text: txt, t: 1500 }; };

  /* ---------------- 结算 ---------------- */

  SceneBlocks.prototype.onSolved = function () {
    var stars, rank = '';
    if (this.timed) {
      var ratio = this.timeLeft / this.puzzle.timeLimit;
      rank = Gen.rankFor(ratio);
      stars = (rank === 'S' || rank === 'A') ? 3 : (rank === 'B' || rank === 'C') ? 2 : 1;
      this.rank = rank;
    } else {
      stars = Gen.starsFor(this.hintCount, this.illegal);
    }
    if (this.isDaily) { BF.Save.clearDaily(stars); }
    else { BF.Save.clear(this.game, this.level, stars); }
    this.win = { t: 0, stars: stars, press: null };
  };

  SceneBlocks.prototype.onTimeout = function () {
    // 限时内没解出 → 结算为「时间到」（不计通关），可重玩
    this.win = { t: 0, stars: 0, timeout: true, press: null };
  };

  SceneBlocks.prototype.next = function () {
    if (this.isDaily) { this.app.go('home'); return; }
    if (this.level >= this.meta.TOTAL) { this.app.go('levels', { game: this.game }); return; }
    BF.RuleTip.skipOnce(this);   // 关内进下一关不重复弹规则
    this.enter({ game: this.game, level: this.level + 1 });
  };

  /* ---------------- 渲染 ---------------- */

  SceneBlocks.prototype.render = function (ctx) {
    var pf = BF.platform, W = pf.width, H = pf.height;

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.bgTop);
    bg.addColorStop(1, T.bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 难度自选首屏：必须**先于** renderHeader 分流 —— renderHeader 要读 this.colors /
    // this.litCount，而首屏阶段没有题目（colors 未定义），顺序反了会直接抛错。
    if (this.pickDiff) {
      BF.DiffPick.render(ctx, this);
      this.renderFade(ctx, W, H);
      return;
    }

    this.renderHeader(ctx);
    this.renderBoard(ctx);
    this.renderTray(ctx);
    this.renderFooter(ctx);
    this.renderToast(ctx);
    if (this.win) { this.renderWin(ctx); }

    this.renderFade(ctx, W, H);
    // 规则弹框画在最上层（主体照常画，被遮罩压暗当背景）
    if (this.showRule) { BF.RuleTip.render(ctx, this); }
  };

  /** 入场白闪（首屏与玩法共用） */
  SceneBlocks.prototype.renderFade = function (ctx, W, H) {
    if (this.fadeIn > 0) {
      ctx.save();
      ctx.globalAlpha = this.fadeIn * 0.85;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  };

  SceneBlocks.prototype.renderHeader = function (ctx) {
    var pf = BF.platform, W = pf.width;
    D.fillRound(ctx, this.back.x, this.back.y, this.back.w, this.back.h, 14, '#FFFFFF');
    D.roundRect(ctx, this.back.x + 0.5, this.back.y + 0.5, this.back.w - 1, this.back.h - 1, 14);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    D.icon(ctx, 'back', this.back.x + this.back.w / 2, this.back.y + this.back.h / 2, 16, T.text);
    // 「?」重看规则入口（不再提示后也能随时打开）
    BF.RuleTip.renderBtn(ctx, this);

    var title = this.isDaily ? '每日挑战' : ('第 ' + this.level + ' 关');
    var sub = this.isDaily ? U.dateKey(new Date()) : this.meta.title;
    D.text(ctx, title, W / 2, this.headerY + 20, { size: 19, weight: '700' });
    D.text(ctx, sub, W / 2, this.headerY + 40, { size: 11.5, color: T.textSub });

    // 颜色约束提示（只用这些颜色的积木）
    var names = this.colors.map(function (c) { return Gen.COLOR_NAME[c]; }).join(' / ');
    D.text(ctx, '只用 ' + names + ' 积木填满亮区', W - 16, this.headerY + 20,
      { size: 12, color: T.textSub, weight: '600', align: 'right' });
    D.text(ctx, this.covered + ' / ' + this.litCount + ' 格',
      W - 16, this.headerY + 38, { size: 11, color: T.textSub, align: 'right', alpha: 0.85 });

    if (this.timed) {
      var r = this.timeLeft / this.puzzle.timeLimit;
      D.text(ctx, '⏱ ' + (this.timeLeft / 1000).toFixed(1) + 's',
        W / 2, this.headerY + 52, { size: 12, weight: '700',
          color: r < 0.25 ? T.warn : T.text, align: 'center' });
    }
  };

  SceneBlocks.prototype.renderBoard = function (ctx) {
    var c = this.cell, bx = this.boardX, by = this.boardY, bw = this.boardW;
    // 外框托盘
    D.boardFrame(ctx, bx - 10, by - 10, bw + 20, bw + 20, 12, 18);

    // 每格
    for (var gy = 0; gy < SIZE; gy++) {
      for (var gx = 0; gx < SIZE; gx++) {
        var idx = gy * SIZE + gx;
        var x = bx + gx * c, y = by + gy * c;
        if (this.lit[idx]) {
          // 亮起：暖色凹槽
          D.slot(ctx, x, y, c, c, { fill: '#FDEBC8', edge: 'rgba(180,140,60,0.25)',
            gap: 1.4, radius: c * 0.16 });
        } else {
          // 暗格：极淡
          D.fillRound(ctx, x + 1.4, y + 1.4, c - 2.8, c - 2.8, c * 0.14, 'rgba(23,26,31,0.035)');
        }
      }
    }

    // 已放好的积木
    for (var p = 0; p < this.pieces.length; p++) {
      var pc = this.pieces[p];
      if (!pc.placed) { continue; }
      this.drawPiece(ctx, pc.id, pc.rot, bx + pc.x * c, by + pc.y * c, c, '#000000', 1);
    }

    // 非法红闪
    if (this.flash) {
      var a = Math.min(1, this.flash.t / 260);
      ctx.save();
      ctx.globalAlpha = a * 0.55;
      for (var k = 0; k < this.flash.cells.length; k++) {
        var cx = this.flash.cells[k][0], cyy = this.flash.cells[k][1];
        D.fillRound(ctx, bx + cx * c, by + cyy * c, c, c, c * 0.16, T.warn);
      }
      ctx.restore();
    }

    // 拖动中的吸附预览 + 跟手积木
    if (this.held && this.held.moved) {
      var d = this.held;
      var g = this.snap(d);
      var overB = this.overBoard(d.x, d.y);
      if (overB) {
        var ok = this.isValid(d.piece, g.rot, g.gx, g.gy);
        var cells = Gen.PIECE_ROT[d.piece.id][g.rot];
        ctx.save();
        ctx.globalAlpha = 0.5;
        for (var ci = 0; ci < cells.length; ci++) {
          var cgx = g.gx + cells[ci][0], cgy = g.gy + cells[ci][1];
          if (cgx < 0 || cgx >= SIZE || cgy < 0 || cgy >= SIZE) { continue; }
          D.fillRound(ctx, bx + cgx * c, by + cgy * c, c, c, c * 0.16,
            ok ? 'rgba(78,156,99,0.9)' : 'rgba(201,70,63,0.9)');
        }
        ctx.restore();
      }
      // 跟手积木（浮起，保持抓取偏移）
      var ox = d.x - d.grabDX * c, oy = d.y - d.grabDY * c;
      this.drawPiece(ctx, d.piece.id, d.piece.rot, ox, oy, c, '#000000', 1, true);
    }
  };

  /** 画一个积木（以 (0,0) 格左上角为 ox,oy，每格 cs 像素） */
  SceneBlocks.prototype.drawPiece = function (ctx, id, rot, ox, oy, cs, unused, alpha, lift) {
    var color = Gen.COLOR_HEX[Gen.SHAPES[id].c];
    var cells = Gen.PIECE_ROT[id][rot];
    for (var i = 0; i < cells.length; i++) {
      var x = ox + cells[i][0] * cs, y = oy + cells[i][1] * cs;
      D.block(ctx, x, y, cs, cs, color, { pad: 1.6, radius: cs * 0.16, alpha: alpha, lift: lift, shadow: lift !== true ? false : true });
    }
  };

  SceneBlocks.prototype.renderTray = function (ctx) {
    var pf = BF.platform, W = pf.width;
    var ty = this.trayY, th = this.trayH;
    D.panel(ctx, 12, ty, W - 24, th, { radius: 18, fill: T.panel });
    D.text(ctx, '积木托盘', 24, ty + 18, { size: 12, color: T.textSub, weight: '600', align: 'left' });

    // 未放置的积木进入托盘（按 pieces 顺序）
    var unplaced = [];
    for (var i = 0; i < this.pieces.length; i++) { if (!this.pieces[i].placed) { unplaced.push(this.pieces[i]); } }
    var n = unplaced.length;
    if (n === 0) { return; }

    var padX = 18, padTop = 30, padBot = 12;
    var innerW = (W - 24) - padX * 2;
    var innerH = th - padTop - padBot;
    // 行数由 layout 按「本关积木总数」定好（放走几块也不跳行、每格尺寸不变）
    var rows = this.trayRows || ((n <= 7) ? 1 : 2);
    var perRow = Math.ceil(n / rows);
    var gap = 10;
    var rowGap = 8;
    var rowH = (innerH - rowGap * (rows - 1)) / rows;
    var csCap = 40;
    this.trayTokens = [];
    for (var k = 0; k < n; k++) {
      var pc = unplaced[k];
      var bb = Gen.bbox(Gen.PIECE_ROT[pc.id][pc.rot]);
      var r = Math.floor(k / perRow), col = k % perRow;
      var rowCount = (r === rows - 1) ? (n - perRow * r) : perRow;
      var rowSlotW = (innerW - gap * (rowCount - 1)) / rowCount;
      var cs = Math.min(csCap, (rowSlotW - 6) / Math.max(bb.w, bb.h), (rowH - 6) / Math.max(bb.w, bb.h));
      var pw = bb.w * cs, ph = bb.h * cs;
      var slotX = 12 + padX + col * (rowSlotW + gap);
      var slotY = ty + padTop + r * (rowH + rowGap) + (rowH - ph) / 2;
      // 记录绘制原点（供 onDown 计算抓取偏移，避免整块偏半格被拒）
      pc._tray = { x: slotX, y: slotY, cs: cs };
      // 命中盒（整槽横向铺满 + 整行纵向）
      this.trayTokens.push({ x: slotX - 4, y: ty + padTop + r * (rowH + rowGap) - 6,
                             w: rowSlotW + 8, h: rowH + 12, piece: pc });
      // 选中高亮
      if (this.selected === pc) {
        ctx.save();
        ctx.globalAlpha = 0.12;
        D.fillRound(ctx, slotX - 5, slotY - 5, pw + 10, ph + 10, 10, T.accent);
        ctx.restore();
      }
      this.drawPiece(ctx, pc.id, pc.rot, slotX, slotY, cs, '#000000', 1);
    }
  };

  SceneBlocks.prototype.renderFooter = function (ctx) {
    for (var i = 0; i < this.btns.length; i++) {
      var b = this.btns[i];
      D.button(ctx, b, b.label, { fill: '#FFFFFF', color: T.text, icon: b.icon, iconColor: T.textSub });
    }
  };

  SceneBlocks.prototype.renderToast = function (ctx) {
    if (!this.toast) { return; }
    var pf = BF.platform;
    var a = Math.min(1, this.toast.t / 320);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 13px ' + D.FONT;
    var w = ctx.measureText(this.toast.text).width + 32;
    var x = (pf.width - w) / 2, y = this.boardY + this.boardW + 24;
    D.fillRound(ctx, x, y, w, 38, 19, 'rgba(28,31,36,0.88)');
    D.text(ctx, this.toast.text, pf.width / 2, y + 19.5, { size: 13, color: '#FFFFFF', weight: '600' });
    ctx.restore();
  };

  SceneBlocks.prototype.overlayLayout = function () {
    var pf = BF.platform, H = pf.height;
    var w = Math.min(pf.width - 56, 300), h = 280;
    var x = (pf.width - w) / 2, y = (H - h) / 2 - 10;
    var pad = 20, bw = (w - pad * 2 - 12) / 2;
    return {
      card: { x: x, y: y, w: w, h: h },
      again: { x: x + pad, y: y + h - pad - 48, w: bw, h: 48 },
      next: { x: x + pad + bw + 12, y: y + h - pad - 48, w: bw, h: 48 }
    };
  };

  SceneBlocks.prototype.renderWin = function (ctx) {
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
    var timedOut = !!this.win.timeout;
    D.text(ctx, timedOut ? '时间到' : (this.isDaily ? '今日挑战完成' : '全部填满！'),
      cx + cw / 2, cy + 44, { size: 21, weight: '700' });

    if (timedOut) {
      D.text(ctx, '没在限时内填满，再试一次', cx + cw / 2, cy + 78,
        { size: 13, color: T.textSub });
    } else if (this.timed) {
      // 限时：大字显示评级
      var rk = this.rank || 'E';
      D.text(ctx, rk, cx + cw / 2, cy + 104, { size: 64, weight: '800', color: T.accent });
      D.text(ctx, '剩余时间 ' + (this.timeLeft / 1000).toFixed(1) + 's · ' +
        (this.hintCount > 0 ? '用了提示' : '无提示'),
        cx + cw / 2, cy + 150, { size: 12.5, color: T.textSub });
      // 小星星
      var starY = cy + 182, r = 14, gapx = r * 2.5;
      for (var i = 0; i < 3; i++) {
        var on = i < this.win.stars;
        D.star(ctx, cx + cw / 2 + (i - 1) * gapx, starY, r, 0.46,
          on ? T.gold : 'rgba(23,26,31,0.10)', 'rgba(23,26,31,0.10)');
      }
    } else {
      // 普通：三颗星
      var last = !this.isDaily && this.level >= this.meta.TOTAL;
      if (last) {
        D.text(ctx, '🎉 通关！已解锁全部 ' + this.meta.TOTAL + ' 关', cx + cw / 2, cy + 70,
          { size: 12.5, color: T.textSub });
      }
      var starY2 = cy + 104, r2 = 22, gapx2 = r2 * 2.5;
      for (var j = 0; j < 3; j++) {
        var on2 = j < this.win.stars;
        var delay = U.clamp((this.win.t - 180 - j * 130) / 220, 0, 1);
        var sc = on2 ? (0.6 + 0.4 * U.easeOutCubic(delay)) * (1 + 0.25 * Math.sin(Math.PI * delay)) : 1;
        D.star(ctx, cx + cw / 2 + (j - 1) * gapx2, starY2, r2 * sc, 0.46,
          on2 ? T.gold : 'rgba(23,26,31,0.10)', 'rgba(23,26,31,0.10)');
      }
      var tips = (this.hintCount === 0 && this.illegal === 0) ? '完美！无提示无失误'
        : (this.hintCount <= 1 && this.illegal <= 1) ? '不错，少量提示/失误'
        : '通关达成';
      D.text(ctx, tips, cx + cw / 2, cy + 158, { size: 12.5, color: T.textSub });
    }

    var k = cw / card.w;
    var ra = { x: cx + (ob.again.x - card.x) * k, y: cy + (ob.again.y - card.y) * k, w: ob.again.w * k, h: ob.again.h * k };
    var rn = { x: cx + (ob.next.x - card.x) * k, y: cy + (ob.next.y - card.y) * k, w: ob.next.w * k, h: ob.next.h * k };
    var pr = this.win.press;
    D.button(ctx, ra, '重玩', { fill: pr === 'again' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15 });
    D.button(ctx, rn, this.isDaily ? '返回首页' : (this.win.timeout ? '重玩' : (last ? '返回关卡' : '下一关')),
      { fill: pr === 'next' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15, shadow: true });
    ctx.restore();
  };

  BF.SceneBlocks = SceneBlocks;
})();
