/**
 * play.js —— 方块拼图主玩法场景
 * 拖拽方块 → 网格吸附 → 填满即过关。
 * 支持：从托盘拿起、从棋盘拿起重摆、撤销、重置(二次确认)、提示、星级结算。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.ScenePlay) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;

  function ScenePlay(app) {
    this.app = app;
    this.model = null;
    this.L = null;
    this.drag = null;
    this.win = null;
    this.toast = null;
    this.hintFx = null;
    this.confirmReset = 0;
    this.fadeIn = 1;
  }

  ScenePlay.prototype.enter = function (params) {
    params = params || {};
    this.isDaily = !!params.daily;
    this.game = params.game || 'block';
    this.level = params.level || 1;

    // 从注册表取游戏元信息（标题 / 关卡总数 / 题面构建器 / 皮肤）
    var meta = BF.games && (BF.games[this.game] || BF.games.block);
    if (!meta) { throw new Error('未注册的游戏: ' + this.game); }
    this.meta = meta;
    this.skin = meta.skin || 'block';
    this.isLogic = this.skin === 'logic';
    this.isPhoto = this.skin === 'photo';

    this.puzzle = this.isDaily ? meta.buildDaily() : meta.build(this.level);
    this.model = new BF.Model(this.puzzle);
    this.win = null; this.drag = null; this.toast = null; this.hintFx = null;
    this.confirmReset = 0;
    this.fadeIn = 1;
    // 照片是异步加载的。没加载完之前退化成色块（见 paintPiece），
    // 这样"图还没到"的那一两帧不会是一片空白，逻辑测试也不需要真图。
    this.photoImg = null;
    this.photoErr = null;
    // 照片提示图（棋盘底的淡参照）状态：默认显示，进关 5 秒后自动收起，
    // 玩家可随时轻触棋盘空白区切换。hintFlip 是"翻合"动画的视觉量（1=完全展开）。
    this.showHint = true;
    this.hintAuto = true;
    this.hintCount = 5000;
    this.hintFlip = 1;
    this.boardTap = null;
    if (this.isPhoto) { this.loadPhoto(); }
    this.layout();
    this.syncFirst = true;
    // 「玩法说明」弹框：每次进这款游戏的第一个关卡时弹一次（勾过「不再提示」则不弹）
    if (BF.RuleTip.shouldShow(this.game, this)) { BF.RuleTip.enter(this, params); }
    return this;
  };

  /** 取当前关卡的照片（异步，加载完会自己触发重排） */
  ScenePlay.prototype.loadPhoto = function () {
    var self = this;
    var src = this.puzzle.photo && this.puzzle.photo.src;
    if (!src) { this.photoErr = '没有可用照片'; return; }
    this.photoErr = null;
    BF.Photos.get(src, function (err, img) {
      if (err || !img) {
        // 只在"还停在同一个关卡"时写状态，避免切关后旧回调污染新题面
        if (self.puzzle.photo && self.puzzle.photo.src === src) { self.photoErr = String(err || '加载失败'); }
        return;
      }
      if (self.puzzle.photo && self.puzzle.photo.src === src) { self.photoImg = img; }
    });
  };

  /* ---------------- 皮肤：颜色 / 圆角 ---------------- */

  /** 块的颜色：游戏 2 的固定块是墨黑，托盘块走白/黄/蓝/红；照片块用该照片主色（仅兜底时可见） */
  ScenePlay.prototype.pieceColor = function (p) {
    if (this.isLogic) {
      return p.fixed ? BF.LOGIC_THEME.fixed : BF.logicColorOf(p.color).base;
    }
    if (this.isPhoto) { return p.color || '#8A8F98'; }
    return BF.colorOf(p.color).base;
  };

  /** 块圆角：游戏 2 几乎是直角；照片切片只留一点点，太圆就不像"一块照片"了 */
  ScenePlay.prototype.pieceRadius = function (scale) {
    var k = this.isPhoto ? 0.045 : (this.isLogic ? 0.09 : 0.18);
    return this.L.cell * k * (scale || 1);
  };

  /** 块之间的缝：游戏 2 要留出棋盘底色；照片只要极小一道，用来看出块边界 */
  ScenePlay.prototype.piecePad = function () {
    return this.isPhoto ? 0.6 : (this.isLogic ? 1.1 : 1.6);
  };

  /**
   * 统一的块绘制入口：按皮肤分派
   * 游戏 1 立体方块 / 游戏 2 扁平拼图片 / 游戏 3 照片切片
   */
  ScenePlay.prototype.paintPiece = function (ctx, x, y, w, h, p, opt) {
    opt = opt || {};
    var o = {
      pad: opt.pad != null ? opt.pad : this.piecePad(),
      radius: opt.radius != null ? opt.radius : this.pieceRadius(),
      lift: !!opt.lift
    };
    if (this.isPhoto) {
      if (opt.alpha != null) { o.alpha = opt.alpha; }
      var ok = D.photoSlice(ctx, x, y, w, h, this.photoImg, p, o);
      if (ok) { return; }
      // 图没到 / 加载失败：退化成主色块，游戏照样能玩，不会白屏
      o.highlight = false;
      D.tile(ctx, x, y, w, h, this.pieceColor(p), o);
      return;
    }
    if (this.isLogic) {
      o.highlight = !!opt.highlight;   // 固定块是墨黑，加高光会很"塑料"
      D.tile(ctx, x, y, w, h, this.pieceColor(p), o);
    } else {
      D.block(ctx, x, y, w, h, this.pieceColor(p), o);
    }
  };

  /* ---------------- 布局 ---------------- */

  ScenePlay.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var L = this.L = {};
    var top = pf.safeTop;
    var bottomPad = pf.safeBottom;

    L.headerH = 52;
    L.headerY = top;
    L.back = { x: 12, y: top + 6, w: 40, h: 40 };

    var availTop = top + L.headerH + 6;
    var footerH = 86 + bottomPad;
    var availBottom = H - footerH;
    var availH = availBottom - availTop;

    var boardOut = Math.min(W - 26, availH * 0.615);
    L.board = { x: (W - boardOut) / 2, y: availTop + 2, w: boardOut, h: boardOut };
    L.framePad = Math.round(boardOut * 0.032);
    L.inner = {
      x: L.board.x + L.framePad,
      y: L.board.y + L.framePad,
      w: boardOut - L.framePad * 2,
      h: boardOut - L.framePad * 2
    };
    L.cell = L.inner.w / this.model.size;

    L.trayAvail = {
      x: 12,
      y: L.board.y + boardOut + 12,
      w: W - 24,
      h: availBottom - (L.board.y + boardOut + 12) - 10
    };
    if (L.trayAvail.h < 64) { L.trayAvail.h = 64; }
    L.tray = { x: L.trayAvail.x, y: L.trayAvail.y, w: L.trayAvail.w, h: L.trayAvail.h };

    var bw = (W - 24 - 20) / 3;
    L.btns = [
      { x: 12, y: H - bottomPad - 62, w: bw, h: 48, key: 'undo', label: '撤销', icon: 'undo' },
      { x: 12 + bw + 10, y: H - bottomPad - 62, w: bw, h: 48, key: 'reset', label: '重置', icon: 'reset' },
      { x: 12 + (bw + 10) * 2, y: H - bottomPad - 62, w: bw, h: 48, key: 'hint', label: '提示', icon: 'hint' }
    ];

    this.measureTray();
    this.layoutTray();
  };

  /** 行的打包：把 blocks 按给定格子尺寸铺成若干行 */
  ScenePlay.prototype.packRows = function (list, cellT, maxW) {
    var rows = [], cur = null, cx = 0, cy = 0, rowH = 0;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var w = p.w * cellT, h = p.h * cellT;
      if (cur && cx + w > maxW) { rows.push(cur); cur = null; }
      if (!cur) { cur = { y: cy, w: 0, items: [] }; cx = 0; rowH = 0; }
      // 注意：行的 y 必须用 cur.y，不能用 cy —— cy 在行内每加一块之后都会被改成"下一行"的起点，
      // 用它会导致同一行里的块各占一个 y，整行错开、越排越高（最后溢出托盘）。
      cur.items.push({ p: p, x: cx, y: cur.y, w: w, h: h });
      cur.w = cx + w;
      cx += w + 8;
      if (h > rowH) { rowH = h; }
      cy = cur.y + rowH + 10;
    }
    if (cur) { rows.push(cur); }
    return { rows: rows, height: cy > 0 ? cy - 10 : 0 };
  };

  /**
   * 选一个能让所有块塞进 maxH 的最大缩放。
   * 用二分而不是固定档位：像游戏 2 那样一次要摆 8 块时，
   * 离散档位可能"全都放不下"，结果是块被挤到托盘外面、盖住底部按钮。
   */
  ScenePlay.prototype.fitScale = function (list, maxW, maxH) {
    if (!list.length) {
      return { scale: 1, cellT: this.L.cell, pack: { rows: [], height: 0 } };
    }
    var lo = 0.06, hi = 0.92, best = null;
    for (var it = 0; it < 16; it++) {
      var mid = (lo + hi) / 2;
      var pack = this.packRows(list, this.L.cell * mid, maxW);
      if (pack.height <= maxH) {
        best = { scale: mid, cellT: this.L.cell * mid, pack: pack };
        lo = mid;
      } else {
        hi = mid;
      }
    }
    if (!best) {   // 连最小档都塞不下（极端题面）：用最小档，至少不会更糟
      best = { scale: lo, cellT: this.L.cell * lo, pack: this.packRows(list, this.L.cell * lo, maxW) };
    }
    return best;
  };

  /** 托盘面板高度：按"全部方块未放置"的最坏情况算一次，之后不再跳动 */
  ScenePlay.prototype.measureTray = function () {
    var L = this.L, av = L.trayAvail;
    var all = [], i;
    for (i = 0; i < this.model.puzzle.order.length; i++) {
      var pc = this.model.pieces[this.model.puzzle.order[i]];
      if (pc.fixed) { continue; }   // 固定块已在棋盘上，不占托盘高度
      all.push(pc);
    }
    var fit = this.fitScale(all, av.w - 24, av.h - 18);
    var h = Math.min(av.h, fit.pack.height + 26);
    L.tray = {
      x: av.x,
      y: av.y + Math.max(0, (av.h - h) / 2),
      w: av.w,
      h: h
    };
  };

  /** 把当前未放置的块排进托盘（目标位置，动画在 update 里平滑过去） */
  ScenePlay.prototype.layoutTray = function () {
    var L = this.L, rect = L.tray;
    var list = this.model.trayPieces();
    var innerW = rect.w - 24, innerH = rect.h - 18;
    var fit = this.fitScale(list, innerW, innerH);
    var rows = fit.pack.rows, totalH = fit.pack.height;
    var baseY = rect.y + Math.max(9, (rect.h - totalH) / 2);

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var offX = (innerW - row.w) / 2;
      for (var k = 0; k < row.items.length; k++) {
        var it = row.items[k];
        it.p.tx = rect.x + 12 + offX + it.x;
        it.p.ty = baseY + it.y;
        it.p.tScale = fit.scale;
        if (this.syncFirst) {
          it.p.px = it.p.tx; it.p.py = it.p.ty; it.p.scale = fit.scale;
        }
      }
    }
    if (this.syncFirst) { this.syncFirst = false; }
  };

  /* ---------------- 更新 ---------------- */

  ScenePlay.prototype.update = function (dt) {
    var L = this.L;
    // 规则弹框打开期间：不跑玩法状态机（顺带保证计时/动画不启动）
    if (this.showRule) { return BF.RuleTip.update(this, dt); }
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    if (this.toast) {
      this.toast.t -= dt;
      if (this.toast.t <= 0) { this.toast = null; }
    }
    if (this.confirmReset > 0) { this.confirmReset -= dt; }
    if (this.hintFx) {
      this.hintFx.t -= dt;
      if (this.hintFx.t <= 0) { this.hintFx = null; }
    }
    // 提示图：翻合动画 + 5 秒自动收起
    if (this.isPhoto) {
      var htarget = this.showHint ? 1 : 0;
      this.hintFlip += (htarget - this.hintFlip) * (1 - Math.exp(-dt / 130));
      if (this.hintFlip < 0.001) { this.hintFlip = 0; }
      if (this.hintFlip > 0.999) { this.hintFlip = 1; }
      if (this.hintAuto && this.showHint) {
        this.hintCount -= dt;
        if (this.hintCount <= 0) { this.showHint = false; this.hintAuto = false; }
      }
    }

    var ps = this.model.pieces;
    var k = 1 - Math.exp(-dt / 68);
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (p.pop > 0) { p.pop = Math.max(0, p.pop - dt / 240); }
      if (this.drag && this.drag.piece === p) { continue; }

      if (p.placed) {
        // 已落位的块一律以模型坐标为准。
        // 否则它会带着"托盘时期的旧目标位置"被 update 的插值慢慢拉回托盘。
        p.px = L.inner.x + p.x * L.cell;
        p.py = L.inner.y + p.y * L.cell;
        p.tx = p.px; p.ty = p.py;
        p.scale = 1; p.tScale = 1;
        continue;
      }

      p.px += (p.tx - p.px) * k;
      p.py += (p.ty - p.py) * k;
      p.scale += (p.tScale - p.scale) * k;
      if (Math.abs(p.tx - p.px) < 0.35 && Math.abs(p.ty - p.py) < 0.35) { p.px = p.tx; p.py = p.ty; }
    }

    // 注意：这里绝不能清 win.press。按下与抬起之间必然夹着若干帧，
    // 按下态一被清掉，onUp 永远读不到，表现就是「重玩」「下一关」点了没反应。
    if (this.win) { this.win.t += dt; }
  };

  /* ---------------- 输入 ---------------- */

  ScenePlay.prototype.onDown = function (x, y) {
    var L = this.L;

    // 规则弹框打开期间：输入全部交给弹框（点遮罩不关，必须点「开始游戏」）
    if (this.showRule) { BF.RuleTip.onDown(this, x, y); return; }

    if (this.win) {
      var ob = this.overlayLayout();
      this.win.press = null;
      if (U.pointInRect(x, y, ob.again)) { this.win.press = 'again'; return; }
      if (U.pointInRect(x, y, ob.next)) { this.win.press = 'next'; return; }
      return;
    }

    if (U.pointInRect(x, y, L.back)) {
      this.app.go(this.isDaily ? 'home' : 'levels', { game: this.game });
      return;
    }

    // header 左上角的「?」：随时重看玩法说明（无视「不再提示」）
    if (U.pointInRect(x, y, BF.RuleTip.btn(this))) { BF.RuleTip.enter(this, { force: true }); return; }

    for (var i = 0; i < L.btns.length; i++) {
      if (U.pointInRect(x, y, L.btns[i])) { this.pressBtn = L.btns[i]; return; }
    }

    // 先从棋盘上找（后放的在上层）；固定块开局就位、不可拾起
    var ps = this.model.pieces, p = null;
    for (i = ps.length - 1; i >= 0; i--) {
      if (!ps[i].placed || ps[i].fixed) { continue; }
      var r = {
        x: L.inner.x + ps[i].x * L.cell,
        y: L.inner.y + ps[i].y * L.cell,
        w: ps[i].w * L.cell,
        h: ps[i].h * L.cell
      };
      if (U.pointInRect(x, y, r)) { p = ps[i]; break; }
    }
    var fromBoard = !!p;

    // 再从托盘找
    if (!p) {
      var list = this.model.trayPieces();
      for (i = list.length - 1; i >= 0; i--) {
        var q = list[i];
        var rr = { x: q.px, y: q.py, w: q.w * L.cell * q.scale, h: q.h * L.cell * q.scale };
        if (U.pointInRect(x, y, rr)) { p = q; break; }
      }
    }
    if (!p) {
      // 轻触棋盘空白区：记录为"提示图切换"候选，真正切换在 onUp 判定（避免和拖块混淆）
      if (U.pointInRect(x, y, L.inner)) { this.boardTap = { x: x, y: y }; }
      return;
    }

    if (fromBoard) { this.model.lift(p); this.layoutTray(); }

    this.drag = {
      piece: p,
      fromBoard: fromBoard,
      dx: x - p.px,          // 抓取偏移（用棋盘尺度重算）
      dy: y - p.py,
      moved: 0,
      startX: x, startY: y,
      scale: 1,
      x: p.px, y: p.py
    };
    // 拿起瞬间以棋盘尺寸呈现，手指落在块的同一相对位置
    var s = p.scale || 1;
    this.drag.dx = (x - p.px) / s;
    this.drag.dy = (y - p.py) / s;
    p.scale = 1;
    this.updateDragPos(x, y);
  };

  ScenePlay.prototype.updateDragPos = function (x, y) {
    var d = this.drag;
    if (!d) { return; }
    d.x = x - d.dx;
    d.y = y - d.dy;
    d.piece.px = d.x;
    d.piece.py = d.y;
    d.piece.tx = d.x;
    d.piece.ty = d.y;
    d.piece.tScale = 1;
  };

  ScenePlay.prototype.onMove = function (x, y) {
    if (!this.drag) { return; }
    this.drag.moved = Math.max(this.drag.moved,
      Math.abs(x - this.drag.startX) + Math.abs(y - this.drag.startY));
    this.updateDragPos(x, y);
  };

  /** 吸附计算：用块中心对齐网格 */
  ScenePlay.prototype.snapTarget = function () {
    var d = this.drag, L = this.L, p = d.piece;
    if (!d) { return null; }
    var cxf = (d.x + p.w * L.cell / 2 - L.inner.x) / L.cell;
    var cyf = (d.y + p.h * L.cell / 2 - L.inner.y) / L.cell;
    var gx = Math.round(cxf - p.w / 2);
    var gy = Math.round(cyf - p.h / 2);
    gx = U.clamp(gx, 0, this.model.size - p.w);
    gy = U.clamp(gy, 0, this.model.size - p.h);
    return { x: gx, y: gy, inBoard: this.isNearBoard() };
  };

  ScenePlay.prototype.isNearBoard = function () {
    var d = this.drag, L = this.L;
    if (!d) { return false; }
    var cx = d.x + d.piece.w * L.cell / 2;
    var cy = d.y + d.piece.h * L.cell / 2;
    var pad = L.cell * 1.2;
    return cx > L.board.x - pad && cx < L.board.x + L.board.w + pad &&
           cy > L.board.y - pad && cy < L.board.y + L.board.h + pad;
  };

  ScenePlay.prototype.onUp = function (x, y) {
    if (this.showRule) { BF.RuleTip.onUp(this, x, y); return; }
    if (this.win) {
      var ob = this.overlayLayout();
      var hit = this.win.press;
      this.win.press = null;
      if (hit === 'again' && U.pointInRect(x, y, ob.again)) { this.replay(); return; }
      if (hit === 'next' && U.pointInRect(x, y, ob.next)) { this.next(); return; }
      return;
    }

    if (this.pressBtn) {
      var btn = this.pressBtn;
      this.pressBtn = null;
      if (U.pointInRect(x, y, btn)) { this.doAction(btn.key); }
      return;
    }

    // 轻触棋盘空白区：切换提示图的显示 / 隐藏
    if (this.boardTap) {
      var bt = this.boardTap;
      this.boardTap = null;
      if (!this.win && U.pointInRect(x, y, this.L.inner)) { this.toggleHint(); }
      return;
    }

    var d = this.drag;
    if (!d) { return; }
    this.drag = null;
    var p = d.piece;

    var t = this.snapTargetFor(d);
    var placed = false;
    if (d.moved < 6 && !d.fromBoard && this.isNearBoard() === false) {
      // 轻点托盘里的块：不动，回位
      placed = false;
    } else if (t && t.inBoard && this.model.canPlace(p, t.x, t.y)) {
      placed = this.model.place(p, t.x, t.y);
    }

    if (placed) {
      p.px = this.L.inner.x + t.x * this.L.cell;
      p.py = this.L.inner.y + t.y * this.L.cell;
      p.scale = 1; p.tScale = 1;
      this.layoutTray();
      BF.platform.vibrate('light');
      if (this.model.isSolved()) { this.onSolved(); }
      else if (this.puzzle.strict && this.model.remaining() === 0) {
        // 照片拼图：填满不等于完成，还得每块都在原位。
        // 不说清楚的话，玩家会以为"摆满了怎么还不过关"，以为是 bug。
        var wrong = this.model.misplaced();
        if (wrong > 0) { this.showToast('还有 ' + wrong + ' 块没回到原位'); }
      }
    } else {
      // 回托盘
      p.scale = 1; p.tScale = 1;
      this.layoutTray();
      if (d.moved < 6 && !d.fromBoard) {
        // 单击：直接对齐回去，不播动画
        p.px = p.tx; p.py = p.ty; p.scale = p.tScale;
      }
    }
  };

  ScenePlay.prototype.snapTargetFor = function (d) {
    var saved = this.drag;
    this.drag = d;
    var t = this.snapTarget();
    this.drag = saved;
    return t;
  };

  ScenePlay.prototype.doAction = function (key) {
    if (key === 'undo') {
      if (this.model.undo()) {
        this.layoutTray();
        BF.platform.vibrate('light');
      } else {
        this.showToast('没有可撤销的操作');
      }
    } else if (key === 'reset') {
      if (this.confirmReset > 0) {
        this.confirmReset = 0;
        this.model.softReset();
        this.syncFirst = true;
        this.layoutTray();
      } else {
        this.confirmReset = 2600;
        this.showToast('再点一次「重置」清空棋盘');
      }
    } else if (key === 'hint') {
      var h = this.model.hint();
      if (!h) { this.showToast('所有方块都已放置'); return; }
      this.hintFx = {
        x: this.L.inner.x + h.x * this.L.cell,
        y: this.L.inner.y + h.y * this.L.cell,
        w: h.piece.w * this.L.cell,
        h: h.piece.h * this.L.cell,
        t: 2600
      };
      h.piece.hintT = 1;
      if (h.blocked) { this.showToast('目标位置被占用，先把上面的方块挪开'); }
    }
  };

  ScenePlay.prototype.showToast = function (txt) {
    this.toast = { text: txt, t: 2000 };
  };

  /** 轻触棋盘：切换提示图。打开时重新武装 5 秒自动收起；关闭后保持隐藏直到再次手动开启 */
  ScenePlay.prototype.toggleHint = function () {
    this.showHint = !this.showHint;
    if (this.showHint) {
      this.hintAuto = true;
      this.hintCount = 5000;
      this.showToast('已显示提示图');
    } else {
      this.hintAuto = false;
      this.showToast('已隐藏提示图');
    }
  };

  ScenePlay.prototype.onSolved = function () {
    var stars = this.model.stars();
    if (this.isDaily) { BF.Save.clearDaily(stars); }
    else { BF.Save.clear(this.game, this.level, stars); }
    this.win = { t: 0, stars: stars, press: null };
    BF.platform.vibrate('heavy');
  };

  ScenePlay.prototype.replay = function () {
    BF.RuleTip.skipOnce(this);   // 重玩本关不重复弹规则
    this.enter({ game: this.game, level: this.level, daily: this.isDaily });
  };

  ScenePlay.prototype.next = function () {
    if (this.isDaily) { this.app.go('home'); return; }
    if (this.level >= this.meta.TOTAL) { this.app.go('levels', { game: this.game }); return; }
    BF.RuleTip.skipOnce(this);   // 关内进下一关不重复弹规则
    this.enter({ game: this.game, level: this.level + 1 });
  };

  /* ---------------- 渲染 ---------------- */

  ScenePlay.prototype.render = function (ctx) {
    var pf = BF.platform, L = this.L, W = pf.width, H = pf.height;

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.bgTop);
    bg.addColorStop(1, T.bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    this.renderHeader(ctx);

    // 棋盘
    var LT = BF.LOGIC_THEME;
    D.boardFrame(ctx, L.board.x, L.board.y, L.board.w, L.board.h, L.framePad,
      Math.max(10, L.board.w * 0.055),
      this.isLogic ? { frameTop: LT.frameTop, frameBottom: LT.frameBottom, inner: LT.boardBg } : null);

    var i, gx, gy;

    // 游戏 3：棋盘底铺一层极淡的原图当参照。
    // 没有参照的话，遇到天空、墙面这类大片同色的照片根本无从下手 ——
    // 但一直全亮会"太明显、像照着描"，所以默认只 0.12，且进关 5 秒后自动收起
    // （垂直翻合动画 hintFlip → 0），露出只有网格线的"缺省"棋盘；玩家可随时轻触棋盘切换。
    if (this.isPhoto && this.photoImg && this.hintFlip > 0.02) {
      ctx.save();
      var hcy = L.inner.y + L.inner.h / 2;
      ctx.translate(0, hcy);
      ctx.scale(1, this.hintFlip);   // 翻合：以棋盘中线为轴纵向收起
      ctx.translate(0, -hcy);
      ctx.globalAlpha = 0.12 * this.hintFlip;
      D.photoSlice(ctx, L.inner.x, L.inner.y, L.inner.w, L.inner.h, this.photoImg,
        { u: 0, v: 0, uw: 1, vh: 1 },
        { radius: Math.max(2, L.board.w * 0.02), stroke: false, shadow: false });
      ctx.restore();
    }

    // 游戏 3 的网格线：提示图在时用白色细线（压在淡照片上分块），
    // 提示图收起后换成淡灰线 —— 白底上画白线等于没画，棋盘会变成一片空白。
    if (this.isPhoto) {
      var hintOn = this.hintFlip > 0.5;
      ctx.save();
      ctx.globalAlpha = hintOn ? 0.14 : 0.17;
      ctx.strokeStyle = hintOn ? '#FFFFFF' : '#2E3338';
      ctx.lineWidth = 1;
      for (i = 1; i < this.model.size; i++) {
        var lx = L.inner.x + i * L.cell;
        ctx.beginPath(); ctx.moveTo(lx, L.inner.y); ctx.lineTo(lx, L.inner.y + L.inner.h); ctx.stroke();
        var ly = L.inner.y + i * L.cell;
        ctx.beginPath(); ctx.moveTo(L.inner.x, ly); ctx.lineTo(L.inner.x + L.inner.w, ly); ctx.stroke();
      }
      ctx.restore();
    }

    for (gy = 0; gy < this.model.size; gy++) {
      for (gx = 0; gx < this.model.size; gx++) {
        if (this.model.cells[this.model.idx(gx, gy)] !== -1) { continue; }
        var gxx = L.inner.x + gx * L.cell, gyy = L.inner.y + gy * L.cell;
        if (this.isPhoto) {
          // 提示图收起后给空格画浅凹槽当"缺省"格，棋盘不至于全白、看不出格子
          if (this.hintFlip < 0.5) { D.slot(ctx, gxx, gyy, L.cell, L.cell, { gap: 1.4 }); }
          continue;
        }
        if (this.isLogic) {
          // 游戏 2：每格一个圆环点，空格才画（被块盖住的格子不画）
          D.dotGrid(ctx, gxx, gyy, 1, L.cell, { ring: LT.dotRing, hole: LT.dotHole });
        } else {
          D.slot(ctx, gxx, gyy, L.cell, L.cell, { gap: 1.4 });
        }
      }
    }

    // 已放置的方块
    var ps = this.model.pieces;
    for (i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (!p.placed) { continue; }
      var pop = 1 + 0.13 * Math.sin(Math.PI * (1 - p.pop));
      var w = p.w * L.cell, h = p.h * L.cell;
      var ex = (w * (pop - 1)) / 2, ey = (h * (pop - 1)) / 2;
      this.paintPiece(ctx, L.inner.x + p.x * L.cell - ex, L.inner.y + p.y * L.cell - ey,
        w + ex * 2, h + ey * 2, p, { highlight: !p.fixed });
    }

    // 提示高亮
    if (this.hintFx) {
      var pulse = 0.55 + 0.45 * Math.sin(this.hintFx.t / 110);
      ctx.save();
      ctx.globalAlpha = pulse;
      D.roundRect(ctx, this.hintFx.x + 1, this.hintFx.y + 1, this.hintFx.w - 2, this.hintFx.h - 2,
        L.cell * 0.18);
      ctx.strokeStyle = T.accent;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    // 托盘
    D.panel(ctx, L.tray.x, L.tray.y, L.tray.w, L.tray.h, {
      radius: 18, fill: T.tray, shadowBlur: 6, shadowOffsetY: 2,
      edgeColor: 'rgba(23,26,31,0.05)'
    });

    var list = this.model.trayPieces();
    for (i = 0; i < list.length; i++) {
      var q = list[i];
      if (this.drag && this.drag.piece === q) { continue; }
      this.drawPiece(ctx, q, 1);
    }
    if (!list.length) {
      var wrongN = this.model.misplaced();
      var done = !(this.puzzle.strict && wrongN > 0);
      D.icon(ctx, done ? 'check' : 'hint', L.tray.x + L.tray.w / 2, L.tray.y + L.tray.h / 2 - 10,
        20, done ? T.ok : T.warn, { alpha: 0.9 });
      D.text(ctx, done ? (this.isPhoto ? '照片拼好了' : '方块全部就位')
                       : ('还有 ' + wrongN + ' 块没回到原位'),
        L.tray.x + L.tray.w / 2, L.tray.y + L.tray.h / 2 + 16,
        { size: 12.5, color: T.textSub, weight: '600' });
    }

    // 拖拽中的块 + 落点预览
    if (this.drag) {
      var dp = this.drag.piece;
      var t = this.snapTarget();

      // ① 块体：与格子等大，落在哪一眼就看得出来（只加投影表示"被拿起来了"）
      this.drawPiece(ctx, dp, 1, true);

      // ② 落点预览画在块体之上，任何底色（尤其白色块压在白色棋盘上）都看得见
      if (t && t.inBoard) {
        var ok = this.model.canPlace(dp, t.x, t.y);
        var dzx = L.inner.x + t.x * L.cell, dzy = L.inner.y + t.y * L.cell;
        var gw = dp.w * L.cell, gh = dp.h * L.cell;
        var gr = this.pieceRadius();
        ctx.save();
        ctx.globalAlpha = 0.26;
        D.fillRound(ctx, dzx + 2, dzy + 2, gw - 4, gh - 4, gr,
          ok ? this.pieceColor(dp) : T.warn);
        ctx.restore();
        ctx.save();
        D.roundRect(ctx, dzx + 1.5, dzy + 1.5, gw - 3, gh - 3, gr);
        ctx.strokeStyle = ok ? U.rgba(T.ok, 0.98) : U.rgba(T.warn, 0.95);
        ctx.lineWidth = 3;
        ctx.setLineDash(ok ? [] : [6, 5]);
        ctx.stroke();
        ctx.restore();
      }
    }

    this.renderFooter(ctx);
    this.renderToast(ctx);
    this.renderHintTip(ctx);
    if (this.win) { this.renderWin(ctx); }

    // 入场淡入（白色遮罩）必须先于规则弹框画：弹框永远画在最上层。
    // ⚠️ 曾经把这段淡入放到了 `RuleTip.render` 之后，而 update 在 showRule
    //    期间提前 return（line 272）→ fadeIn 永远停在 1 → 这层 0.85 白纱
    //    永久盖在弹框上，弹框内容看起来全透明（能透过它看见棋盘）。
    //    fake canvas 不合成 alpha，node 探针测不出来，只能靠真机/截图发现
    //    （回归护栏：tools/_probe_popup_ontop.js 记录绘制顺序抓住同类问题）。
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

  ScenePlay.prototype.drawPiece = function (ctx, p, extra, lift) {
    var L = this.L;
    var s = p.scale * (extra || 1);
    var w = p.w * L.cell * s, h = p.h * L.cell * s;
    // 拿起时以块中心为基准放大，避免"往右下角长"的错觉
    var w0 = p.w * L.cell * p.scale, h0 = p.h * L.cell * p.scale;
    var x = p.px - (w - w0) / 2, y = p.py - (h - h0) / 2;
    if (p.hintT) { p.hintT = Math.max(0, p.hintT - 0.02); }
    this.paintPiece(ctx, x, y, w, h, p,
      { radius: this.pieceRadius(s), lift: !!lift, highlight: !p.fixed });
  };

  ScenePlay.prototype.renderHeader = function (ctx) {
    var L = this.L, pf = BF.platform;
    D.fillRound(ctx, L.back.x, L.back.y, L.back.w, L.back.h, 14, '#FFFFFF');
    D.roundRect(ctx, L.back.x + 0.5, L.back.y + 0.5, L.back.w - 1, L.back.h - 1, 14);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    D.icon(ctx, 'back', L.back.x + L.back.w / 2, L.back.y + L.back.h / 2, 16, T.text);
    // 「?」重看规则入口（不再提示后也能随时打开）
    BF.RuleTip.renderBtn(ctx, this);

    var title = this.isDaily ? '每日挑战' : ('第 ' + this.level + ' 关');
    var sub = this.isDaily ? BF.util.dateKey(new Date())
      : (this.isPhoto ? (this.meta.title + ' · ' + this.model.size + '×' + this.model.size)
                      : this.meta.title);
    D.text(ctx, title, pf.width / 2, L.headerY + 20, { size: 19, weight: '700' });
    D.text(ctx, sub, pf.width / 2, L.headerY + 40, { size: 11.5, color: T.textSub });

    var rem = this.model.remaining();
    D.text(ctx, '剩余 ' + rem + ' 块', pf.width - 16, L.headerY + 26,
      { size: 12.5, color: rem === 0 ? T.ok : T.textSub, weight: '600', align: 'right' });
  };

  ScenePlay.prototype.renderFooter = function (ctx) {
    var L = this.L;
    for (var i = 0; i < L.btns.length; i++) {
      var b = L.btns[i];
      var disabled = false;
      if (b.key === 'undo') { disabled = this.model.undoStack.length === 0; }
      var label = b.label;
      var fill = '#FFFFFF';
      var color = T.text;
      if (b.key === 'reset' && this.confirmReset > 0) { fill = T.warn; color = '#FFFFFF'; }
      D.button(ctx, b, label, {
        fill: fill, color: color, icon: b.icon,
        iconColor: b.key === 'reset' && this.confirmReset > 0 ? '#FFFFFF' : T.textSub,
        disabled: disabled
      });
    }
  };

  ScenePlay.prototype.renderToast = function (ctx) {
    if (!this.toast) { return; }
    var pf = BF.platform;
    var a = Math.min(1, this.toast.t / 320);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 13px ' + D.FONT;
    var w = ctx.measureText(this.toast.text).width + 32;
    var x = (pf.width - w) / 2, y = this.L.board.y + this.L.board.h - 58;
    D.fillRound(ctx, x, y, w, 38, 19, 'rgba(28,31,36,0.88)');
    D.text(ctx, this.toast.text, pf.width / 2, y + 19.5, { size: 13, color: '#FFFFFF', weight: '600' });
    ctx.restore();
  };

  /** 进关 5 秒内的温馨提示条：提示图即将自动收起，轻触棋盘可随时切换 */
  ScenePlay.prototype.renderHintTip = function (ctx) {
    if (!this.isPhoto || !this.hintAuto) { return; }
    var pf = BF.platform, W = pf.width;
    var sec = Math.max(0, Math.ceil(this.hintCount / 1000));
    var txt = '提示图 ' + sec + 's 后自动隐藏 · 轻触棋盘可切换';
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.hintCount / 600); // 最后 0.6s 淡出
    ctx.font = '600 11.5px ' + D.FONT;
    var w = ctx.measureText(txt).width + 28;
    var x = (W - w) / 2;
    var y = this.L.board.y + 14;   // 贴着棋盘上沿内侧，5 秒后随 hintAuto 关闭一起消失
    D.fillRound(ctx, x, y, w, 26, 13, 'rgba(28,31,36,0.80)');
    D.text(ctx, txt, W / 2, y + 13.5, { size: 11.5, color: '#FFFFFF', weight: '600', align: 'center' });
    ctx.restore();
  };

  ScenePlay.prototype.overlayLayout = function () {
    var pf = BF.platform, H = pf.height;
    var w = Math.min(pf.width - 56, 300), h = 268;
    var x = (pf.width - w) / 2, y = (H - h) / 2 - 10;
    var pad = 20, bw = (w - pad * 2 - 12) / 2;
    return {
      card: { x: x, y: y, w: w, h: h },
      again: { x: x + pad, y: y + h - pad - 48, w: bw, h: 48 },
      next: { x: x + pad + bw + 12, y: y + h - pad - 48, w: bw, h: 48 }
    };
  };

  /** 把最终布局里的矩形，按卡片弹出动画的缩放/位移映射一份用于绘制 */
  function mapRect(r, card, dx, dy, k) {
    return {
      x: dx + (r.x - card.x) * k,
      y: dy + (r.y - card.y) * k,
      w: r.w * k,
      h: r.h * k
    };
  }

  ScenePlay.prototype.renderWin = function (ctx) {
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
    D.text(ctx, this.isDaily ? '今日挑战完成' : '闯关成功', cx + cw / 2, cy + 44,
      { size: 21, weight: '700' });

    // 星星
    var starY = cy + 98, r = 22, gapx = r * 2.5;
    for (var i = 0; i < 3; i++) {
      var on = i < this.win.stars;
      var delay = U.clamp((this.win.t - 180 - i * 130) / 220, 0, 1);
      var sc = on ? (0.6 + 0.4 * U.easeOutCubic(delay)) * (1 + 0.25 * Math.sin(Math.PI * delay)) : 1;
      D.star(ctx, cx + cw / 2 + (i - 1) * gapx, starY, r * sc, 0.46,
        on ? T.gold : 'rgba(23,26,31,0.10)',
        'rgba(23,26,31,0.10)');
    }
    D.text(ctx, '用了 ' + this.model.moves + ' 步 · 提示 ' + this.model.hintCount + ' 次',
      cx + cw / 2, cy + 150, { size: 12.5, color: T.textSub });

    // 卡片有 0.86→1 的弹出动画，两个按钮必须跟着同一套变换走，
    // 否则动画期间按钮会画在卡片外面。命中判定仍用最终位置的 ob.*（动画只有 260ms）。
    var k = cw / card.w;
    var ra = mapRect(ob.again, card, cx, cy, k);
    var rn = mapRect(ob.next, card, cx, cy, k);
    var pr = this.win.press;

    D.button(ctx, ra, '重玩', {
      fill: pr === 'again' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15
    });
    var last = !this.isDaily && this.level >= this.meta.TOTAL;
    D.button(ctx, rn, this.isDaily ? '返回首页' : (last ? '返回关卡' : '下一关'),
      { fill: pr === 'next' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15, shadow: true });
    ctx.restore();
  };

  BF.ScenePlay = ScenePlay;
})();
