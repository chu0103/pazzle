/**
 * rush.js —— 第 7 款游戏「移车出库」（Rush Hour / 华容道滑车解谜）玩法场景
 *
 * 屏幕自上而下：
 *   1) 头部：返回 / 第 N 关（或每日挑战）/ 最优步数 + 难度档 + 步数计数
 *   2) 棋盘：6×6 停车场网格，右侧 exitRow 行开一个出口（画一条"公路"延伸出去）；
 *            格子用浅色凹槽感画出停车位；警车要滑到最右一格，再从出口驶出。
 *   3) 车辆：卡通 Q 版立体画——顶面高光 + 正面主色 + 底裙暗边三层色块 + 大圆角，
 *            浅蓝车窗 + 白色斜高光 + 深色轮子；警车白车身 + 黑门带 + 红蓝警灯条 + 小警徽。
 *   4) 交互：按住一辆车沿自身轴向拖动，松手吸附到最近合法格；非法位置（被挡）拖动时
 *            实时被夹住，不会穿模；警车到达出口 → 自动驶出动画 → 结算弹窗。
 *   5) 底部：撤销 / 重置 / 提示（每关限 1 次；提示运行时跑 BFS 求最优解的下一步，画箭头）。
 *
 * 整体结构照抄 cipher.js（点按 + 结算弹窗 + 底部按钮 + 返回路由），
 * 区别是把「拼一行密码」换成「拖动车辆求解」，并多了 onMove（拖动）与驶出动画。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.SceneRush) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;

  var WIN_ANIM = 480;   // 警车驶出动画时长（ms）

  function SceneRush(app) {
    this.app = app;
    this.fadeIn = 1;
    this.t = 0;
    this.result = null;
    this.toast = null;
    this.pressBtn = null;
    this.drag = null;       // 拖动中：{ i, axis, start, base, range, cur }
    this.hint = null;       // 提示：{ i, dir }
    this.hintUsed = false;
    this.shake = null;      // 「这辆车当前动不了」的抖动反馈：{ i, t }
    this.pickDiff = false;  // 是否停在「难度自选」首屏
    this.pickCards = null;
    this.win = false;
    this.winT = 0;
    this.result = null;
  }

  SceneRush.prototype.enter = function (params) {
    params = params || {};

    // 难度自选首屏：只选难度，不加载棋盘（从首页卡片进来时走这条路）。
    // 首屏实现与「图片找不同」「超级积木」共用 BF.DiffPick（js/scenes/diffpick.js）。
    if (params.pickDiff) { return BF.DiffPick.enter(this, params); }

    this.pickDiff = false;
    this.pickCards = null;
    this.isDaily = !!params.daily;
    this.game = params.game || 'rush';
    this.level = params.level || 1;

    var meta = BF.games && (BF.games[this.game] || BF.games.rush);
    if (!meta) { throw new Error('未注册的游戏: ' + this.game); }
    this.meta = meta;

    this.puzzle = this.isDaily ? meta.buildDaily() : meta.build(this.level);
    this.size = this.puzzle.size;
    this.exitRow = this.puzzle.exitRow;
    this.opt = this.puzzle.opt;
    // 深拷贝车辆（cars[0] = 警车，horiz/len/x/y 可变）
    this.cars = this.puzzle.cars.map(function (c) {
      return { id: c.id, horiz: c.horiz, len: c.len, x: c.x, y: c.y,
               ci: c.ci, police: c.police };
    });

    this.steps = 0;
    this.history = [];       // 每步前的坐标快照（撤销用）
    this.hint = null;
    this.hintUsed = false;
    this.win = false;
    this.winT = 0;
    this.drag = null;
    this.pressBtn = null;
    this.result = null;
    this.toast = null;
    this.shake = null;
    this.fadeIn = 1;
    this.t = 0;

    this.layout();
    this.showToast(this.isDaily ? '每日挑战 · 滑动车辆让警车驶出'
                                : '滑动车辆，让警车从右侧出口驶出');
    // 「玩法说明」弹框：每次进这款游戏的第一个关卡时弹一次（勾过「不再提示」则不弹）
    if (BF.RuleTip.shouldShow(this.game, this)) { BF.RuleTip.enter(this, params); }
    return this;
  };

  /* ---------------- 布局 ---------------- */

  SceneRush.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var top = pf.safeTop;

    this.headerH = 52;
    this.headerY = top;
    this.back = { x: 12, y: top + 6, w: 40, h: 40 };

    // 底部按钮行
    var btnH = 46;
    var btnY = H - pf.safeBottom - btnH - 8;
    var bw = (W - 24 - 10 * 2) / 3;
    this.btns = [
      { x: 12, y: btnY, w: bw, h: btnH, key: 'undo', label: '撤销', icon: 'undo' },
      { x: 12 + bw + 10, y: btnY, w: bw, h: btnH, key: 'reset', label: '重置', icon: 'reset' },
      { x: 12 + (bw + 10) * 2, y: btnY, w: bw, h: btnH, key: 'hint', label: '提示', icon: 'hint' }
    ];

    // 棋盘：在头部与底部按钮之间垂直居中；右侧预留一条出口车道（约 1 格宽）
    var boardTop = top + 60;
    var boardBottom = btnY - 16;
    var availH = boardBottom - boardTop;
    // 右侧留 exitGutter 给出口车道，棋盘在「左侧区域」内居中，cell 同时受宽/高约束
    var mSide = 14;
    var cellByW0 = (W - mSide * 2) / this.size;          // 初估每格
    this.exitGutter = Math.round(cellByW0 * 1.08);       // 出口车道宽（≈1 格）
    var cellByW = (W - mSide - this.exitGutter - mSide) / this.size;
    var cellByH = availH / this.size;
    this.cell = Math.max(28, Math.min(cellByW, cellByH));
    var area = this.cell * this.size;
    this.bx = mSide + Math.max(0, (W - mSide - this.exitGutter - mSide - area) / 2);
    this.by = boardTop + (availH - area) / 2;
    this.frame = this.cell * 0.16;                       // 棋盘外框厚度
  };

  /**
   * 难度自选首屏的几何（与 diff / blocks 共用，见 js/scenes/diffpick.js）。
   * 保留这个方法名是为了兼容既有调用点与 smoke 断言。
   */
  SceneRush.prototype.layoutPicker = function () { BF.DiffPick.layout(this); };

  /** 某档的关卡范围 [first, last]（按 firstLevelOfSize 定位，档内 5 关） */
  SceneRush.prototype.tierRange = function (idx) {
    return BF.DiffPick.tierRange(this, idx);
  };

  /** 某车（按当前 x/y 或传入的浮点 pos）的像素命中盒 */
  SceneRush.prototype.carRect = function (c, pos) {
    var horiz = c.horiz;
    var x = horiz ? (pos != null ? pos : c.x) : c.x;
    var y = horiz ? c.y : (pos != null ? pos : c.y);
    var wCells = horiz ? c.len : 1;
    var hCells = horiz ? 1 : c.len;
    var pad = this.cell * 0.06;
    return {
      x: this.bx + x * this.cell + pad,
      y: this.by + y * this.cell + pad,
      w: wCells * this.cell - pad * 2,
      h: hCells * this.cell - pad * 2
    };
  };

  /**
   * 某车当前可滑动的合法整数区间 [min, max]（其它车静止）。
   * 注意：水平车与垂直车混合时，障碍车在「被挡轴」上只占 1 格
   * （垂直车在某一行只占其所在列 1 格，水平车在某一列只占其所在行 1 格），
   * 不能用障碍车自身的 len 去算遮挡范围——否则会把车「卡过头」，让本可滑动的步数被吃掉，
   * 严重时导致关卡无法通过拖动解出。这里用对称写法逐车判断它是否真的与本车同行/同列、占几格。
   */
  SceneRush.prototype.legalRange = function (i, outBlockers) {
    var c = this.cars[i], size = this.size, Lc = c.len;
    var cpos = c.horiz ? c.x : c.y;          // 本车当前滑动坐标
    var cfix = c.horiz ? c.y : c.x;          // 本车固定的另一轴坐标（行 / 列）
    var min = 0, max = size - Lc;
    for (var j = 0; j < this.cars.length; j++) {
      if (j === i) { continue; }
      var o = this.cars[j];
      var opos = o.horiz ? o.x : o.y;        // 障碍车滑动坐标
      var ofix = o.horiz ? o.y : o.x;        // 障碍车固定的另一轴坐标
      if (c.horiz) {
        // 本车占第 cfix 行；障碍车是否也占这一行？
        var oInRow = o.horiz ? (ofix === cfix)
                             : (opos <= cfix && cfix <= opos + o.len - 1);
        if (!oInRow) { continue; }
        var oCol = o.horiz ? opos : ofix;     // 障碍车在该行占用的列
        var oCols = o.horiz ? o.len : 1;      // 占用的列数（垂直车只占 1 列）
        if (oCol + oCols - 1 < cpos) {        // 左挡
          if (outBlockers && oCol + oCols > min) { outBlockers.push(j); }
          min = Math.max(min, oCol + oCols);
        } else if (oCol > cpos + Lc - 1) {    // 右挡
          if (outBlockers && oCol - Lc < max) { outBlockers.push(j); }
          max = Math.min(max, oCol - Lc);
        }
      } else {
        // 本车占第 cfix 列；障碍车是否也占这一列？
        var oInCol = o.horiz ? (opos <= cfix && cfix <= opos + o.len - 1)
                             : (ofix === cfix);
        if (!oInCol) { continue; }
        var oRow = o.horiz ? ofix : opos;     // 障碍车在该列占用的行
        var oRows = o.horiz ? 1 : o.len;      // 占用的行数（水平车只占 1 行）
        if (oRow + oRows - 1 < cpos) {        // 上挡
          if (outBlockers && oRow + oRows > min) { outBlockers.push(j); }
          min = Math.max(min, oRow + oRows);
        } else if (oRow > cpos + Lc - 1) {    // 下挡
          if (outBlockers && oRow - Lc < max) { outBlockers.push(j); }
          max = Math.min(max, oRow - Lc);
        }
      }
    }
    return { min: min, max: max };
  };

  /* ---------------- 更新 ---------------- */

  SceneRush.prototype.update = function (dt) {
    if (this.showRule) { return BF.RuleTip.update(this, dt); }
    this.t += dt;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) { this.toast = null; } }
    if (this.shake) { this.shake.t -= dt; if (this.shake.t <= 0) { this.shake = null; } }
    if (this.pickDiff) { return; }                    // 难度首屏不跑玩法状态机
    if (this.result) { this.result.t += dt; }
    if (this.win && !this.result) {
      this.winT += dt;
      if (this.winT >= WIN_ANIM) {
        var stars = BF.RushGen.starsFor(this.level, this.steps);
        if (this.isDaily) { BF.Save.clearDaily(stars); }
        else { BF.Save.clear(this.game, this.level, stars); }
        this.result = { win: true, t: 0, stars: stars, press: null };
      }
    }
  };

  /* ---------------- 输入 ---------------- */

  SceneRush.prototype.onDown = function (x, y) {
    if (this.showRule) { BF.RuleTip.onDown(this, x, y); return; }
    // header 左上角「?」：随时重看玩法说明（无视「不再提示」）
    if (!this.win && !this.gameOver && !this.pickDiff &&
        U.pointInRect(x, y, BF.RuleTip.btn(this))) { BF.RuleTip.enter(this, { force: true }); return; }
    if (this.pickDiff) {                              // 难度自选首屏（共用实现）
      BF.DiffPick.onDown(this, x, y); return;
    }
    if (this.result) {
      var ob = this.overlayLayout();
      this.result.press = null;
      if (U.pointInRect(x, y, ob.again)) { this.result.press = 'again'; return; }
      if (U.pointInRect(x, y, ob.next)) { this.result.press = 'next'; return; }
      return;
    }
    if (this.win) { return; }
    if (U.pointInRect(x, y, this.back)) { this.pressBtn = { key: 'back' }; return; }
    for (var i = 0; i < this.btns.length; i++) {
      if (U.pointInRect(x, y, this.btns[i])) { this.pressBtn = this.btns[i]; return; }
    }
    // 命中最上层车辆（后画的在上，从后往前遍历保证点到的是显示在上方的那辆）
    for (i = this.cars.length - 1; i >= 0; i--) {
      var r = this.carRect(this.cars[i]);
      if (U.pointInRect(x, y, r)) {
        var blk = [];
        var range = this.legalRange(i, blk);
        // 当前完全动不了（被两侧/上下夹死）→ 不进入拖动，改为抖一下 + 高亮"是谁挡着" +
        // 文字说明。否则玩家拖了半天没反应，会以为游戏坏了（用户圈出的死车就是这种）。
        if (range.min === range.max) {
          var uniq = [];
          for (var bi = 0; bi < blk.length; bi++) {
            if (uniq.indexOf(blk[bi]) < 0) { uniq.push(blk[bi]); }
          }
          this.shake = { i: i, t: 520, blockers: uniq };
          this.showToast(this.cars[i].police
            ? '警车被挡住了，先挪开它前面的车'
            : '这辆车被卡住了，先挪开旁边的车');
          return;
        }
        this.drag = {
          i: i, axis: this.cars[i].horiz ? 'h' : 'v',
          start: this.cars[i].horiz ? x : y,
          base: this.cars[i].horiz ? this.cars[i].x : this.cars[i].y,
          range: range, cur: this.cars[i].horiz ? this.cars[i].x : this.cars[i].y
        };
        return;
      }
    }
  };

  SceneRush.prototype.onMove = function (x, y) {
    if (!this.drag) { return; }
    var d = this.drag;
    var deltaPx = (d.axis === 'h' ? x : y) - d.start;
    var deltaCells = deltaPx / this.cell;
    var cur = d.base + deltaCells;
    if (cur < d.range.min) { cur = d.range.min; }
    if (cur > d.range.max) { cur = d.range.max; }
    d.cur = cur;
  };

  SceneRush.prototype.onUp = function (x, y) {
    if (this.showRule) { BF.RuleTip.onUp(this, x, y); return; }
    if (this.pickDiff) {                              // 难度自选首屏（共用实现）
      BF.DiffPick.onUp(this, x, y); return;
    }
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
      var b = this.pressBtn; this.pressBtn = null;
      if (b.key === 'back') {
        if (U.pointInRect(x, y, this.back)) {
          this.app.go(this.isDaily ? 'home' : 'levels', { game: this.game });
        }
        return;
      }
      if (U.pointInRect(x, y, b)) { this.doAction(b.key); }
      return;
    }
    if (this.drag) {
      var d = this.drag; this.drag = null;
      var snap = Math.round(d.cur);
      if (snap < d.range.min) { snap = d.range.min; }
      if (snap > d.range.max) { snap = d.range.max; }
      var c = this.cars[d.i];
      if (snap !== (c.horiz ? c.x : c.y)) {
        // 提交一步：先存快照用于撤销
        this.history.push(this.cars.map(function (k) {
          return { x: k.x, y: k.y };
        }));
        if (c.horiz) { c.x = snap; } else { c.y = snap; }
        this.steps += 1;
        // 提示箭头随局面失效（最优解已变），清掉旧的
        this.hint = null;
        // 警车到达出口 → 触发驶出动画
        if (c.police && c.x === this.size - 2) { this.onSolved(); }
      }
    }
  };

  /* ---------------- 动作 ---------------- */

  SceneRush.prototype.doAction = function (key) {
    if (key === 'undo') {
      if (!this.history.length) { this.showToast('没有可撤销的步骤'); return; }
      var snap = this.history.pop();
      for (var i = 0; i < this.cars.length; i++) {
        this.cars[i].x = snap[i].x; this.cars[i].y = snap[i].y;
      }
      this.steps = Math.max(0, this.steps - 1);
      this.hint = null;
    } else if (key === 'reset') {
      BF.RuleTip.skipOnce(this);   // 重玩本关不重复弹规则
        this.enter({ game: this.game, level: this.level, daily: this.isDaily });
    } else if (key === 'hint') {
      this.doHint();
    }
  };

  SceneRush.prototype.doHint = function () {
    if (this.result || this.win) { return; }
    if (this.hintUsed) { this.showToast('本关提示已用完'); return; }
    var positions = this.cars.map(function (c) { return c.horiz ? c.x : c.y; });
    var board = { size: this.size, exitRow: this.exitRow, cars: this.cars };
    var step = BF.RushGen.solveStep(board, positions);
    if (!step) { this.showToast('已经没有可走的步了'); return; }
    this.hint = { i: step.car, dir: step.dir };
    this.hintUsed = true;
  };

  SceneRush.prototype.onSolved = function () {
    if (this.win) { return; }
    this.win = true;
    this.winT = 0;
    this.drag = null;
    this.hint = null;
  };

  SceneRush.prototype.next = function () {
    if (this.isDaily) { this.app.go('home'); return; }
    if (this.level >= this.meta.TOTAL) { this.app.go('levels', { game: this.game }); return; }
    BF.RuleTip.skipOnce(this);   // 关内进下一关不重复弹规则
    this.enter({ game: this.game, level: this.level + 1 });
  };

  SceneRush.prototype.showToast = function (txt) { this.toast = { text: txt, t: 1700 }; };

  SceneRush.prototype.tierName = function (n) {
    return n <= 5 ? '入门' : (n <= 10 ? '进阶' : (n <= 15 ? '困难' : '专家'));
  };

  /** 玩家视角的最优步数 = 最优连续滑动次数（数据层 opt 含自动驶出那一步，故减 1） */
  SceneRush.prototype.bestSteps = function () {
    return Math.max(1, this.opt - 1);
  };

  /* ---------------- 渲染 ---------------- */

  SceneRush.prototype.render = function (ctx) {
    var pf = BF.platform, W = pf.width, H = pf.height;

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.bgTop);
    bg.addColorStop(1, T.bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (this.pickDiff) {
      BF.DiffPick.render(ctx, this);
    } else {
      this.renderHeader(ctx);
      this.renderBoard(ctx);
      this.renderFooter(ctx);
      this.renderToast(ctx);
      if (this.result) { this.renderResult(ctx); }
    }

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

  SceneRush.prototype.renderHeader = function (ctx) {
    var W = BF.platform.width;
    D.fillRound(ctx, this.back.x, this.back.y, this.back.w, this.back.h, 14, '#FFFFFF');
    D.roundRect(ctx, this.back.x + 0.5, this.back.y + 0.5, this.back.w - 1, this.back.h - 1, 14);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    D.icon(ctx, 'back', this.back.x + this.back.w / 2, this.back.y + this.back.h / 2, 16, T.text);
    // 「?」重看规则入口（不再提示后也能随时打开）
    BF.RuleTip.renderBtn(ctx, this);

    var title = this.isDaily ? '每日挑战' : ('第 ' + this.level + ' 关');
    var sub = this.isDaily ? BF.util.dateKey(new Date())
      : ('最优 ' + this.bestSteps() + ' 步 · ' + this.tierName(this.level));
    D.text(ctx, title, W / 2, this.headerY + 20, { size: 19, weight: '700' });
    D.text(ctx, sub, W / 2, this.headerY + 40, { size: 11.5, color: T.textSub });

    // 右上：步数计数
    D.text(ctx, '步数', W - 16, this.headerY + 18,
      { size: 11, color: T.textSub, align: 'right', alpha: 0.85 });
    D.text(ctx, String(this.steps), W - 16, this.headerY + 40,
      { size: 19, weight: '700', color: T.accent, align: 'right' });
  };

  SceneRush.prototype.renderBoard = function (ctx) {
    var size = this.size, cell = this.cell;
    var area = cell * size;
    var fx = this.bx - this.frame, fy = this.by - this.frame;
    var fw = area + this.frame * 2, fh = area + this.frame * 2;

    // 棋盘外框（灰托盘）
    D.boardFrame(ctx, fx, fy, fw, fh, this.frame, this.frame * 0.72, {});

    // 出口车道：右侧 exitRow 行，明显的高亮车道 + 方向雪佛龙 + 「出口」标签
    var exitY = this.by + this.exitRow * cell;
    var laneX = this.bx + area;
    var laneW = this.exitGutter;
    var laneY = exitY + cell * 0.08, laneH = cell * 0.84;

    // 车道底色（accent 渐变，明显）
    var lg = ctx.createLinearGradient(laneX, 0, laneX + laneW, 0);
    lg.addColorStop(0, U.rgba(T.accent, 0.34));
    lg.addColorStop(1, U.rgba(T.accent, 0.18));
    D.fillRound(ctx, laneX, laneY, laneW, laneH, cell * 0.16, lg);
    // 车道描边
    ctx.save();
    D.roundRect(ctx, laneX + 0.5, laneY + 0.5, laneW - 1, laneH - 1, cell * 0.16);
    ctx.strokeStyle = U.rgba(T.accent, 0.85); ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();

    // 方向雪佛龙 >>（指向右，示意「从这里驶出」）
    var cyc = exitY + cell * 0.5;
    ctx.save();
    ctx.strokeStyle = T.accentDeep; ctx.lineWidth = Math.max(3, cell * 0.07);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var cv = 0; cv < 2; cv++) {
      var cxp = laneX + laneW * (0.22 + cv * 0.20);
      ctx.beginPath();
      ctx.moveTo(cxp - cell * 0.07, cyc - cell * 0.14);
      ctx.lineTo(cxp + cell * 0.05, cyc);
      ctx.lineTo(cxp - cell * 0.07, cyc + cell * 0.14);
      ctx.stroke();
    }
    ctx.restore();

    // 出口标签（竖排，在车道右端，白字 + accent 圆角底）
    var lblX = laneX + laneW * 0.84;
    D.fillRound(ctx, lblX - cell * 0.17, exitY + cell * 0.18, cell * 0.34, cell * 0.64,
      cell * 0.10, T.accentDeep);
    ctx.save();
    ctx.translate(lblX, exitY + cell * 0.50);
    ctx.rotate(-Math.PI / 2);
    D.text(ctx, '出口', 0, 0, { size: Math.max(10, cell * 0.24), color: '#FFFFFF',
      weight: '700', align: 'center', baseline: 'middle' });
    ctx.restore();

    // 停车位网格线（浅色）
    ctx.save();
    ctx.strokeStyle = 'rgba(23,26,31,0.05)';
    ctx.lineWidth = 1;
    for (var k = 1; k < size; k++) {
      ctx.beginPath();
      ctx.moveTo(this.bx + k * cell, this.by);
      ctx.lineTo(this.bx + k * cell, this.by + area);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(this.bx, this.by + k * cell);
      ctx.lineTo(this.bx + area, this.by + k * cell);
      ctx.stroke();
    }
    ctx.restore();

    // 目标格高亮：最右一列的 exitRow（警车停这里即过关）——金色实框 + 淡金底
    var gx = this.bx + (size - 2) * cell, gy = exitY;
    ctx.save();
    D.fillRound(ctx, gx + cell * 0.04, gy + cell * 0.04, cell * 0.92, cell * 0.92, cell * 0.22,
      U.rgba(T.gold, 0.18));
    ctx.setLineDash([cell * 0.09, cell * 0.07]);
    ctx.strokeStyle = T.gold; ctx.lineWidth = 3;
    D.roundRect(ctx, gx + cell * 0.05, gy + cell * 0.05, cell * 0.90, cell * 0.90, cell * 0.22);
    ctx.stroke();
    ctx.restore();

    // 拖动中先把「可滑动轨道」铺在这辆车下面，让它能挪到哪一目了然
    if (this.drag) {
      var dgc = this.cars[this.drag.i], rg0 = this.drag.range, padT = cell * 0.12;
      var tcol = U.rgba(T.accent, 0.14);
      if (dgc.horiz) {
        var tx0 = this.bx + rg0.min * cell + padT;
        var tx1 = this.bx + (rg0.max + dgc.len) * cell - padT;
        D.fillRound(ctx, tx0, this.by + dgc.y * cell + padT,
          tx1 - tx0, cell - padT * 2, cell * 0.20, tcol);
      } else {
        var ty0 = this.by + rg0.min * cell + padT;
        var ty1 = this.by + (rg0.max + dgc.len) * cell - padT;
        D.fillRound(ctx, this.bx + dgc.x * cell + padT, ty0,
          cell - padT * 2, ty1 - ty0, cell * 0.20, tcol);
      }
    }

    // 车辆（先画非拖动的非警车，再画其他，最后画拖动中的，保证拖动车在最上）
    for (var i = 0; i < this.cars.length; i++) {
      if (this.drag && this.drag.i === i) { continue; }
      if (this.win && this.cars[i].police) { continue; }   // 警车单独画（驶出动画）
      var cr = this.carRect(this.cars[i]);
      this.applyShake(cr, this.cars[i], i);
      this.drawCar(ctx, cr, this.cars[i]);
    }
    // 「动不了」时把挡路的那几辆车描红高亮 —— 玩家立刻明白是"谁"挡住了，而不是游戏坏了
    this.renderBlockers(ctx);
    // 提示箭头（在所提示的车上方画，先于该车或后于该车都行；这里画在车之后，浮在上方）
    if (this.hint && !this.win) {
      var hc = this.cars[this.hint.i];
      this.drawHintArrow(ctx, this.carRect(hc), hc, this.hint.dir);
    }
    // 拖动中的车（最后一个画，置顶）
    if (this.drag) {
      var dc = this.cars[this.drag.i];
      var dpos = this.drag.axis === 'h' ? this.drag.cur : null;
      var dr = this.carRect(dc, dpos);
      // 拖动时轻微放大 + 阴影，给"被拿起"的反馈
      this.drawCar(ctx, dr, dc);
    }
    // 警车驶出动画
    if (this.win) {
      var p = this.cars[0];
      var off = U.easeOutCubic(U.clamp(this.winT / WIN_ANIM, 0, 1)) * (cell * 1.7);
      var pr = this.carRect(p, (this.size - 2) + off);
      ctx.save();
      ctx.globalAlpha = 1 - U.clamp((this.winT - WIN_ANIM * 0.6) / (WIN_ANIM * 0.4), 0, 1) * 0.5;
      this.drawCar(ctx, pr, p);
      ctx.restore();
    }
  };

  /** 抖动反馈期间，把「挡住它的车」描红脉动高亮（画在所有车之上，压住谁都不会被盖） */
  SceneRush.prototype.renderBlockers = function (ctx) {
    if (!this.shake || !this.shake.blockers || !this.shake.blockers.length) { return; }
    var k = U.clamp(this.shake.t / 520, 0, 1);
    var pulse = 0.55 + 0.45 * Math.abs(Math.sin(this.t * 0.008));
    ctx.save();
    ctx.globalAlpha = k * pulse;
    ctx.strokeStyle = '#E63946';
    ctx.lineWidth = Math.max(2.5, this.cell * 0.065);
    for (var b = 0; b < this.shake.blockers.length; b++) {
      var bc = this.cars[this.shake.blockers[b]];
      if (!bc) { continue; }
      var br = this.carRect(bc);
      D.roundRect(ctx, br.x + 1.5, br.y + 1.5, br.w - 3, br.h - 3,
        Math.min(br.w, br.h) * 0.30);
      ctx.stroke();
    }
    ctx.restore();
  };

  /**
   * 「这辆车现在动不了」的抖动反馈：沿自身轴来回小幅摆动，幅度随时间衰减。
   * 配合 showToast 的文案，玩家一眼就明白是「被卡住」而不是「游戏坏了」。
   */
  SceneRush.prototype.applyShake = function (rect, car, i) {
    if (!this.shake || this.shake.i !== i) { return rect; }
    var k = U.clamp(this.shake.t / 520, 0, 1);
    var off = Math.sin(this.t * 0.055) * this.cell * 0.09 * k;
    if (car.horiz) { rect.x += off; } else { rect.y += off; }
    return rect;
  };

  /**
   * 卡通 Q 版立体车：顶面高光 + 正面主色 + 底裙暗边三层色块 + 大圆角，
   * 浅蓝车窗 + 白色斜高光 + 深色轮子；警车白车身 + 黑门带 + 红蓝警灯条 + 小警徽。
   * 立体感只靠明暗色块 + 圆角（不靠投影滤镜），符合「卡通立体」的统一观感。
   */
  SceneRush.prototype.drawCar = function (ctx, rect, car) {
    var main = car.police ? BF.RushGen.POLICE_BODY
                          : BF.RushGen.CAR_COLORS[car.ci % BF.RushGen.CAR_COLORS.length];
    var w = rect.w, h = rect.h;
    var horiz = car.horiz;
    var r = Math.min(w, h) * 0.30;
    var thick = Math.max(4, Math.min(w, h) * 0.18);   // 3D 底裙厚度

    // 1) 轮子（先画，车身盖住上半，露出底部一半 → 卡通车轮）
    var wheelD = Math.min(w, h) * 0.34;
    var wheels = horiz
      ? [[rect.x + w * 0.22, rect.y + h], [rect.x + w * 0.78, rect.y + h]]
      : [[rect.x + w / 2, rect.y], [rect.x + w / 2, rect.y + h]];
    for (var wii = 0; wii < wheels.length; wii++) {
      var wcxp = wheels[wii][0], wcyp = wheels[wii][1];
      D.fillRound(ctx, wcxp - wheelD / 2, wcyp - wheelD / 2, wheelD, wheelD,
        wheelD * 0.42, '#2B2F36');
      ctx.save();
      ctx.beginPath();
      ctx.arc(wcxp - wheelD * 0.16, wcyp - wheelD * 0.16, wheelD * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.32)'; ctx.fill();
      ctx.restore();
    }

    // 2) 底裙（更暗），向下偏移，露出厚度
    D.fillRound(ctx, rect.x, rect.y + thick * 0.5, w, h, r, U.shade(main, -0.42));

    // 3) 车身主体
    D.fillRound(ctx, rect.x, rect.y, w, h, r, main);

    // 4) 顶部高光带（更亮），给"上面"的体积感
    ctx.save();
    var hg = ctx.createLinearGradient(0, rect.y, 0, rect.y + h * 0.5);
    hg.addColorStop(0, 'rgba(255,255,255,0.34)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    D.roundRect(ctx, rect.x + w * 0.06, rect.y + h * 0.06, w * 0.88, h * 0.42, r * 0.7);
    ctx.fillStyle = hg; ctx.fill();
    ctx.restore();

    // 5) 描边压边
    ctx.save();
    D.roundRect(ctx, rect.x + 0.5, rect.y + 0.5, w - 1, h - 1, r);
    ctx.strokeStyle = 'rgba(23,26,31,0.16)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    // 6) 车窗（浅蓝玻璃 + 白色斜高光），按车长分 1~2 扇
    var glass = 'rgba(170,205,232,0.95)';
    var panes, p, px, py, pw, ph;
    if (horiz) {
      var m = w * 0.16, gap = w * 0.05;
      pw = (w - 2 * m - gap) / 2; ph = h * 0.40;
      py = rect.y + h * 0.30;
      panes = [[rect.x + m, py, pw, ph], [rect.x + m + pw + gap, py, pw, ph]];
    } else {
      var mt = h * 0.16, gapt = h * 0.05;
      ph = (h - 2 * mt - gapt) / 2; pw = w * 0.40;
      px = rect.x + w * 0.30;
      panes = [[px, rect.y + mt, pw, ph], [px, rect.y + mt + ph + gapt, pw, ph]];
    }
    for (p = 0; p < panes.length; p++) {
      var pn = panes[p];
      D.fillRound(ctx, pn[0], pn[1], pn[2], pn[3], Math.min(pn[2], pn[3]) * 0.32, glass);
      ctx.save();
      ctx.strokeStyle = 'rgba(23,26,31,0.12)'; ctx.lineWidth = 1;
      D.roundRect(ctx, pn[0] + 0.5, pn[1] + 0.5, pn[2] - 1, pn[3] - 1,
        Math.min(pn[2], pn[3]) * 0.32); ctx.stroke();
      // 白色斜高光
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(1.2, pw * 0.05);
      ctx.beginPath();
      ctx.moveTo(pn[0] + pn[2] * 0.18, pn[1] + pn[3] * 0.78);
      ctx.lineTo(pn[0] + pn[2] * 0.78, pn[1] + pn[3] * 0.18);
      ctx.stroke();
      ctx.restore();
    }

    // 7) 警车标识
    if (car.police) {
      // 黑门带（中部一道）
      var bandR = horiz
        ? [rect.x + w * 0.30, rect.y + h * 0.26, w * 0.40, h * 0.48]
        : [rect.x + w * 0.26, rect.y + h * 0.30, w * 0.48, h * 0.40];
      D.fillRound(ctx, bandR[0], bandR[1], bandR[2], bandR[3],
        Math.min(bandR[2], bandR[3]) * 0.3, 'rgba(36,40,46,0.92)');
      // 小警徽（金色五角星）
      D.star(ctx, rect.x + w / 2, rect.y + h / 2, Math.min(w, h) * 0.16, 0.46,
        T.gold, 'rgba(23,26,31,0.25)');
      // 红蓝警灯条（顶部中央，轻微呼吸）
      var blink = 0.7 + 0.3 * Math.sin(this.t * 0.006);
      var barW = (horiz ? w * 0.34 : w * 0.5);
      var barH = thick * 0.55;
      var barX = rect.x + w / 2 - barW / 2, barY = rect.y + h * 0.05;
      D.fillRound(ctx, barX, barY, barW / 2, barH, barH * 0.4,
        'rgba(230,57,70,' + blink.toFixed(3) + ')');
      D.fillRound(ctx, barX + barW / 2, barY, barW / 2, barH, barH * 0.4,
        'rgba(45,109,223,' + (2 - blink).toFixed(3) + ')');
    }
  };

  /** 提示箭头：在所提示车沿移动方向的一端，画一个脉动的小箭头 */
  SceneRush.prototype.drawHintArrow = function (ctx, rect, car, dir) {
    var horiz = car.horiz;
    var pulse = 0.6 + 0.4 * Math.sin(this.t * 0.008);
    var cx, cy, s;
    if (horiz) {
      cx = rect.x + (dir > 0 ? rect.w - rect.w * 0.10 : rect.w * 0.10);
      cy = rect.y + rect.h * 0.5;
      s = rect.h * 0.30;
    } else {
      cx = rect.x + rect.w * 0.5;
      cy = rect.y + (dir > 0 ? rect.h - rect.h * 0.10 : rect.h * 0.10);
      s = rect.w * 0.30;
    }
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = T.accent; ctx.lineWidth = Math.max(3, s * 0.34);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (horiz) {
      ctx.beginPath();
      ctx.moveTo(cx - dir * s * 0.6, cy - s * 0.6);
      ctx.lineTo(cx + dir * s * 0.6, cy);
      ctx.lineTo(cx - dir * s * 0.6, cy + s * 0.6);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.6, cy - dir * s * 0.6);
      ctx.lineTo(cx, cy + dir * s * 0.6);
      ctx.lineTo(cx + s * 0.6, cy - dir * s * 0.6);
      ctx.stroke();
    }
    ctx.restore();
  };

  SceneRush.prototype.renderFooter = function (ctx) {
    var undoDead = !this.history.length;
    var hintDead = this.hintUsed || this.win || !!this.result;
    for (var i = 0; i < this.btns.length; i++) {
      var b = this.btns[i];
      if (b.key === 'undo') {
        D.button(ctx, b, b.label,
          { fill: '#FFFFFF', color: undoDead ? T.textSub : T.text,
            icon: b.icon, iconColor: undoDead ? T.textSub : T.text, disabled: undoDead });
      } else if (b.key === 'reset') {
        D.button(ctx, b, b.label, { fill: '#FFFFFF', color: T.text, icon: b.icon, iconColor: T.textSub });
      } else { // hint
        if (hintDead) {
          D.button(ctx, b, b.label,
            { fill: '#FFFFFF', color: T.textSub, icon: b.icon, iconColor: T.textSub, disabled: true });
        } else {
          D.button(ctx, b, b.label,
            { fill: U.rgba(T.accent, 0.12), color: T.accent, icon: b.icon, iconColor: T.accent });
        }
      }
    }
  };

  SceneRush.prototype.renderToast = function (ctx) {
    if (!this.toast) { return; }
    var pf = BF.platform;
    var a = Math.min(1, this.toast.t / 320);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 13px ' + D.FONT;
    var w = ctx.measureText(this.toast.text).width + 32;
    var x = (pf.width - w) / 2, y = this.by - 14;
    D.fillRound(ctx, x, y - 19, w, 38, 19, 'rgba(28,31,36,0.88)');
    D.text(ctx, this.toast.text, pf.width / 2, y, { size: 13, color: '#FFFFFF', weight: '600' });
    ctx.restore();
  };

  SceneRush.prototype.overlayLayout = function () {
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

  SceneRush.prototype.renderResult = function (ctx) {
    var pf = BF.platform, ob = this.overlayLayout();
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
    var title = this.isDaily ? '今日挑战完成' : (last ? '🎉 全部通关！' : '🚓 成功出库！');
    D.text(ctx, title, cx + cw / 2, cy + 42, { size: 21, weight: '700' });
    if (this.win && last) {
      D.text(ctx, '已解锁全部 ' + this.meta.TOTAL + ' 关', cx + cw / 2, cy + 66,
        { size: 12.5, color: T.textSub });
    }

    // 星级
    var starY = cy + 96, r = 22, gapx = r * 2.5;
    for (var i = 0; i < 3; i++) {
      var on = i < this.result.stars;
      var delay = U.clamp((this.result.t - 180 - i * 130) / 220, 0, 1);
      var sc = on ? (0.6 + 0.4 * U.easeOutCubic(delay)) * (1 + 0.25 * Math.sin(Math.PI * delay)) : 1;
      D.star(ctx, cx + cw / 2 + (i - 1) * gapx, starY, r * sc, 0.46,
        on ? T.gold : 'rgba(23,26,31,0.10)', 'rgba(23,26,31,0.10)');
    }

    D.text(ctx, '用了 ' + this.steps + ' 步（最优 ' + this.bestSteps() + ' 步）',
      cx + cw / 2, cy + 142, { size: 12.5, color: T.textSub });
    D.text(ctx, '本关 3★ 线：≤ ' + this.bestSteps() + ' 步　·　2★ 线：≤ ' + Math.ceil(this.bestSteps() * 1.4) + ' 步',
      cx + cw / 2, cy + 162, { size: 11, color: T.textSub, weight: '600' });

    var k = cw / card.w;
    var ra = { x: cx + (ob.again.x - card.x) * k, y: cy + (ob.again.y - card.y) * k,
               w: ob.again.w * k, h: ob.again.h * k };
    var rn = { x: cx + (ob.next.x - card.x) * k, y: cy + (ob.next.y - card.y) * k,
               w: ob.next.w * k, h: ob.next.h * k };
    var pr = this.result.press;

    D.button(ctx, ra, '重玩',
      { fill: pr === 'again' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15 });
    D.button(ctx, rn, this.isDaily ? '返回首页' : (last ? '返回关卡' : '下一关'),
      { fill: pr === 'next' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15, shadow: true });
    ctx.restore();
  };

  BF.SceneRush = SceneRush;
})();
