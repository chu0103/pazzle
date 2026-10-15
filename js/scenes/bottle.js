/**
 * bottle.js —— 第 5 款游戏「瓶子颜色推理」玩法场景
 *
 * 屏幕两排瓶子：上排是「隐藏目标」（游戏中只显示 N 个灰色占位，不露颜色），
 * 下排是「你的瓶子」。可以**点选两个瓶子交换**，也可以**直接把一个瓶子拖到另一个上交换**，
 * 顶部实时显示「对了 X / N」。玩家看不到目标，只能靠计数反推正确顺序，把下排排到 X == N 即过关；
 * 通关后才揭示上排真实颜色。星级按交换次数 vs par 评定，且评分线随难度动态放宽
 * （瓶子越多、盲记推理越难，3★/2★ 容差越大），结算面板显示「本关 3★ 线」。
 *
 * 标记功能：底部「标记」按钮进入标记模式，点瓶子加/去记号（纯视觉备忘，防记混），
 * 瓶子越多越有用。
 *
 * 交互同时支持「点按」与「拖动」两种交换：点按走 selected 两态；拖动走 onMove 跟踪 +
 * 松手命中别的瓶即交换、源位留出虚位、落点高亮、瓶子跟随手指浮起。
 * 整体结构照抄 diff 场景（点按/拖动 + 过关弹窗 + 底部按钮）。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.SceneBottle) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;

  function SceneBottle(app) {
    this.app = app;
    this.fadeIn = 1;
    this.t = 0;
    this.win = null;
    this.toast = null;
    this.selected = -1;       // 已点选（待配对的）下排瓶子下标
    this.tapSlot = -1;        // 本次按下命中的下排瓶子下标
    this.drag = null;         // 拖动交换状态：{ from, x, y, moved, toSlot, thr }
    this.pressBtn = null;
    this.markMode = false;    // 标记模式（点瓶子加/去记号）
    this.marks = [];          // 每位置是否被标记（纯视觉备忘）
  }

  SceneBottle.prototype.enter = function (params) {
    params = params || {};
    this.isDaily = !!params.daily;
    this.game = params.game || 'bottle';
    this.level = params.level || 1;

    var meta = BF.games && (BF.games[this.game] || BF.games.bottle);
    if (!meta) { throw new Error('未注册的游戏: ' + this.game); }
    this.meta = meta;

    this.puzzle = this.isDaily ? meta.buildDaily() : meta.build(this.level);
    this.order = this.puzzle.player.slice();          // 玩家当前排列（可变）
    this.initial = this.puzzle.player.slice();         // 重置用初始乱序
    this.target = this.puzzle.target;
    this.palette = this.puzzle.palette;

    this.swaps = 0;
    this.selected = -1;
    this.tapSlot = -1;
    this.drag = null;
    this.pressBtn = null;
    this.win = null;
    this.toast = null;
    this.markMode = false;
    this.marks = new Array(this.order.length).fill(false);
    this.fadeIn = 1;
    this.t = 0;

    this.recompute();
    this.layout();
    // 「玩法说明」弹框：每次进这款游戏的第一个关卡时弹一次（勾过「不再提示」则不弹）
    if (BF.RuleTip.shouldShow(this.game, this)) { BF.RuleTip.enter(this, params); }
    return this;
  };

  /** 当前「位置 + 颜色都对」的瓶子数 */
  SceneBottle.prototype.recompute = function () {
    var c = 0;
    for (var i = 0; i < this.order.length; i++) {
      if (this.order[i] === this.target[i]) { c++; }
    }
    this.correct = c;
  };

  /* ---------------- 布局 ---------------- */

  SceneBottle.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var top = pf.safeTop;

    this.headerH = 52;
    this.headerY = top;
    this.back = { x: 12, y: top + 6, w: 40, h: 40 };

    var availTop = top + this.headerH + 6;
    var footerH = 86 + pf.safeBottom;
    var availBottom = H - footerH;
    var availH = availBottom - availTop;

    var count = this.order.length;

    // 瓶子尺寸：宽随数量自适应，封顶 54、兜底 26；高 = 宽 × 1.9（瓶身带瓶颈）
    var gapB = 8;
    var rowMaxW = Math.min(W - 32, 460);
    var cellW = Math.min(54, (rowMaxW - gapB * (count - 1)) / count);
    if (cellW < 26) { cellW = 26; }
    var rowW = cellW * count + gapB * (count - 1);
    var cellH = cellW * 1.9;

    // 两排 + 中间留白（放"对了 X/N"反馈与标签）
    var gapRows = Math.max(78, cellH * 0.85);
    var blockH = cellH * 2 + gapRows;
    var startY = availTop + Math.max(0, (availH - blockH) / 2);

    this.gapB = gapB;
    this.cellW = cellW;
    this.cellH = cellH;
    this.rowW = rowW;

    this.topRowY = startY;
    this.botRowY = startY + cellH + gapRows;

    // 每排每个瓶子的「命中盒」（含瓶颈区域，方便点）
    this.targetSlots = [];
    this.playerSlots = [];
    var x0 = (W - rowW) / 2;
    for (var i = 0; i < count; i++) {
      var x = x0 + i * (cellW + gapB);
      this.targetSlots.push({ x: x, y: this.topRowY, w: cellW, h: cellH });
      this.playerSlots.push({ x: x, y: this.botRowY, w: cellW, h: cellH });
    }

    // 反馈文字（两排正中）
    this.feedY = this.topRowY + cellH + gapRows / 2;

    var bw = (W - 24 - 10 * 2) / 3;
    this.btns = [
      { x: 12, y: H - pf.safeBottom - 62, w: bw, h: 48, key: 'reset', label: '重置', icon: 'reset' },
      { x: 12 + bw + 10, y: H - pf.safeBottom - 62, w: bw, h: 48, key: 'hint', label: '提示', icon: 'hint' },
      { x: 12 + (bw + 10) * 2, y: H - pf.safeBottom - 62, w: bw, h: 48, key: 'mark', label: '标记' }
    ];
  };

  /* ---------------- 更新 ---------------- */

  SceneBottle.prototype.update = function (dt) {
    if (this.showRule) { return BF.RuleTip.update(this, dt); }
    this.t += dt;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) { this.toast = null; } }
    if (this.win) { this.win.t += dt; }
  };

  /* ---------------- 输入 ---------------- */

  SceneBottle.prototype.onDown = function (x, y) {
    if (this.showRule) { BF.RuleTip.onDown(this, x, y); return; }
    // header 左上角「?」：随时重看玩法说明（无视「不再提示」）
    if (!this.win && !this.gameOver && !this.pickDiff &&
        U.pointInRect(x, y, BF.RuleTip.btn(this))) { BF.RuleTip.enter(this, { force: true }); return; }
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
    // 只响应下排（玩家这排）的点击；上排是目标，点它无效
    this.tapSlot = -1;
    this.drag = null;
    for (i = 0; i < this.playerSlots.length; i++) {
      if (U.pointInRect(x, y, this.playerSlots[i])) {
        this.tapSlot = i;
        // 非标记模式才允许拖动交换；标记模式保持"点按切换记号"
        if (!this.markMode) {
          this.drag = { from: i, x: x, y: y, moved: false, toSlot: -1,
                        thr: Math.max(8, this.cellW * 0.35) };
        }
        break;
      }
    }
  };

  SceneBottle.prototype.onUp = function (x, y) {
    if (this.showRule) { BF.RuleTip.onUp(this, x, y); return; }
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
    if (this.drag) {
      var d = this.drag;
      this.drag = null;
      if (d.moved) {
        // 拖动交换：抬手处命中了别的瓶子 → 交换；否则当作取消
        var to = -1;
        for (var k = 0; k < this.playerSlots.length; k++) {
          if (U.pointInRect(x, y, this.playerSlots[k])) { to = k; break; }
        }
        this.tapSlot = -1;
        if (to >= 0 && to !== d.from) { this.swapTwo(d.from, to); }
        this.selected = -1;
        return;
      }
      // 没拖动 → 回落为点按（tapSlot 仍保留）
    }
    if (this.tapSlot >= 0) {
      var i = this.tapSlot;
      this.tapSlot = -1;
      if (!U.pointInRect(x, y, this.playerSlots[i])) { return; }  // 抬手时移出了瓶子，取消
      this.handleTapSlot(i);
    }
  };

  /** 拖动中：超过阈值判定为拖动，实时更新手指位置与落点槽 */
  SceneBottle.prototype.onMove = function (x, y) {
    if (!this.drag) { return; }
    var d = this.drag;
    if (!d.moved) {
      var dx = x - d.x, dy = y - d.y;
      if (dx * dx + dy * dy > d.thr * d.thr) { d.moved = true; }
    }
    if (!d.moved) { return; }
    d.x = x; d.y = y;
    d.toSlot = -1;
    for (var k = 0; k < this.playerSlots.length; k++) {
      if (U.pointInRect(x, y, this.playerSlots[k])) { d.toSlot = k; break; }
    }
  };

  /** 点选下排第 i 个瓶子：标记模式下只切换记号；否则选第一个 → 选第二个则交换；再点自己则取消选择 */
  SceneBottle.prototype.handleTapSlot = function (i) {
    if (this.markMode) {
      this.marks[i] = !this.marks[i];
      BF.platform.vibrate('light');
      return;
    }
    if (this.selected < 0) {
      this.selected = i;
      BF.platform.vibrate('light');
      return;
    }
    if (this.selected === i) {
      this.selected = -1;             // 取消选择
      return;
    }
    // 交换两个瓶子
    var a = this.selected, b = i;
    this.swapTwo(a, b);
    this.selected = -1;
  };

  /** 交换两个位置的瓶子并结算（点按与拖动共用） */
  SceneBottle.prototype.swapTwo = function (a, b) {
    if (a < 0 || b < 0 || a === b) { return; }
    var t = this.order[a]; this.order[a] = this.order[b]; this.order[b] = t;
    this.swaps++;
    this.recompute();
    BF.platform.vibrate('medium');
    if (this.correct >= this.order.length) { this.onSolved(); }
    else { this.showToast('对了 ' + this.correct + ' / ' + this.order.length); }
  };

  SceneBottle.prototype.doAction = function (key) {
    if (key === 'reset') {
      this.order = this.initial.slice();
      this.swaps = 0;
      this.selected = -1;
      this.marks = new Array(this.order.length).fill(false);
      this.recompute();
      this.showToast('已重置');
    } else if (key === 'mark') {
      this.markMode = !this.markMode;
      this.selected = -1;
      this.showToast(this.markMode ? '标记模式：点瓶子加/去记号' : '已退出标记');
      return;
    } else if (key === 'hint') {
      // 找一处还没对的位置，把「属于它的颜色」换过来
      var i, j = -1, src = -1;
      for (i = 0; i < this.order.length; i++) {
        if (this.order[i] !== this.target[i]) { j = i; break; }
      }
      if (j < 0) { this.showToast('已经全部排好'); return; }
      for (i = 0; i < this.order.length; i++) {
        if (i !== j && this.order[i] === this.target[j]) { src = i; break; }
      }
      if (src < 0) { this.showToast('已经全部排好'); return; }
      var t = this.order[j]; this.order[j] = this.order[src]; this.order[src] = t;
      this.swaps++;
      this.selected = -1;
      this.recompute();
      this.showToast('已提示一处');
      if (this.correct >= this.order.length) { this.onSolved(); }
    }
  };

  SceneBottle.prototype.showToast = function (txt) { this.toast = { text: txt, t: 1600 }; };

  /**
   * 动态评分线：难度（瓶子数）越高，越宽容。
   * 以「关卡序号 lv = count-3（4 瓶=1 关 … 10 瓶=7 关）」为基准，
   * 3★ / 2★ 相对 par 的容差随 lv 单调增长：
   *   lv1(4瓶):  3★+1 / 2★+2
   *   lv3(6瓶):  3★+2 / 2★+4
   *   lv5(8瓶):  3★+3 / 2★+7
   *   lv7(10瓶): 3★+5 / 2★+10
   * 即瓶越多、盲记推理越难，给的空间越大，但追求"最优解"永远拿满星。
   */
  SceneBottle.prototype.thresholdsFor = function (count) {
    var lv = Math.max(1, count - 3); // 1..7
    var three = Math.max(1, Math.round(count * 0.15) + Math.floor((lv - 1) / 2));
    var two = Math.max(three + 1, Math.round(count * 0.4) + (lv - 1));
    return { three: three, two: two };
  };

  SceneBottle.prototype.starsFor = function (swaps, par, count) {
    var th = this.thresholdsFor(count);
    if (swaps <= par + th.three) { return 3; }
    if (swaps <= par + th.two) { return 2; }
    return 1;
  };

  SceneBottle.prototype.onSolved = function () {
    var stars = this.starsFor(this.swaps, this.puzzle.par, this.order.length);
    if (this.isDaily) { BF.Save.clearDaily(stars); }
    else { BF.Save.clear(this.game, this.level, stars); }
    this.win = { t: 0, stars: stars, press: null };
    BF.platform.vibrate('heavy');
  };

  SceneBottle.prototype.next = function () {
    if (this.isDaily) { this.app.go('home'); return; }
    if (this.level >= this.meta.TOTAL) { this.app.go('levels', { game: this.game }); return; }
    BF.RuleTip.skipOnce(this);   // 关内进下一关不重复弹规则
    this.enter({ game: this.game, level: this.level + 1 });
  };

  /* ---------------- 渲染 ---------------- */

  SceneBottle.prototype.render = function (ctx) {
    var pf = BF.platform, W = pf.width, H = pf.height;

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.bgTop);
    bg.addColorStop(1, T.bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    this.renderHeader(ctx);
    this.renderRows(ctx);
    this.renderFooter(ctx);
    this.renderToast(ctx);
    if (this.win) { this.renderWin(ctx); }

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

  SceneBottle.prototype.renderHeader = function (ctx) {
    var pf = BF.platform, W = pf.width;
    D.fillRound(ctx, this.back.x, this.back.y, this.back.w, this.back.h, 14, '#FFFFFF');
    D.roundRect(ctx, this.back.x + 0.5, this.back.y + 0.5, this.back.w - 1, this.back.h - 1, 14);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    D.icon(ctx, 'back', this.back.x + this.back.w / 2, this.back.y + this.back.h / 2, 16, T.text);
    // 「?」重看规则入口（不再提示后也能随时打开）
    BF.RuleTip.renderBtn(ctx, this);

    var title = this.isDaily ? '每日挑战' : ('第 ' + this.level + ' 关');
    var sub = this.isDaily ? BF.util.dateKey(new Date()) : this.meta.title;
    D.text(ctx, title, W / 2, this.headerY + 20, { size: 19, weight: '700' });
    D.text(ctx, sub, W / 2, this.headerY + 40, { size: 11.5, color: T.textSub });

    var allOk = this.correct >= this.order.length;
    D.text(ctx, '交换 ' + this.swaps + ' 次', W - 16, this.headerY + 20,
      { size: 12.5, color: T.textSub, weight: '600', align: 'right' });
    D.text(ctx, '最少 ' + this.puzzle.par + ' 次', W - 16, this.headerY + 38,
      { size: 11, color: T.textSub, align: 'right', alpha: 0.85 });
    // 顶部中央不画"对了 X/N"——那块留给两排中间的反馈区，免得和标题叠
    void allOk;
  };

  SceneBottle.prototype.renderRows = function (ctx) {
    var W = BF.platform.width, i;

    // 上排标签
    D.text(ctx, this.win ? '目标（已揭示）' : '目标顺序（隐藏）', W / 2, this.topRowY - 8,
      { size: 12, color: T.textSub, weight: '600' });
    // 下排标签
    D.text(ctx, '你的瓶子（点两个或拖动交换' + (this.markMode ? ' · 标记中' : '') + '）', W / 2, this.botRowY - 8,
      { size: 12, color: T.textSub, weight: '600' });

    // 上排：目标。游戏中隐藏为灰色占位；通关后揭示真实颜色（含绿勾庆祝）
    for (i = 0; i < this.targetSlots.length; i++) {
      if (this.win) {
        this.drawBottle(ctx, this.targetSlots[i], this.palette[this.target[i]].hex, { correct: true });
      } else {
        this.drawCovered(ctx, this.targetSlots[i]);
      }
    }

    // 下排：玩家。游戏中只标选中、不画绿勾（哪几个对了让玩家自己推理）；过关后亮绿勾当庆祝
    var dragging = !!(this.drag && this.drag.moved);
    for (i = 0; i < this.playerSlots.length; i++) {
      var ok = this.order[i] === this.target[i];
      // 拖动中：源位留空（画浅色虚位），被拖起的瓶子画在手指处
      if (dragging && this.drag.from === i) { this.drawSlotGhost(ctx, this.playerSlots[i]); continue; }
      this.drawBottle(ctx, this.playerSlots[i], this.palette[this.order[i]].hex, {
        selected: this.selected === i && !this.win,
        correct: !!(this.win && ok)
      });
      if (this.marks[i]) { this.drawMark(ctx, this.playerSlots[i]); }
    }

    // 拖动中：高亮落点槽 + 把源瓶子画在手指处（带阴影"浮起"感）
    if (dragging) {
      var to = this.drag.toSlot;
      if (to >= 0 && to !== this.drag.from) { this.drawSlotHi(ctx, this.playerSlots[to]); }
      var w2 = this.cellW * 1.08, h2 = this.cellH * 1.08;
      var r2 = { x: this.drag.x - w2 / 2, y: this.drag.y - h2 * 0.6, w: w2, h: h2 };
      this.drawBottle(ctx, r2, this.palette[this.order[this.drag.from]].hex, { lift: true });
    }

    // 中间反馈：对了 X / N（全对变绿）
    var allOk = this.correct >= this.order.length;
    D.text(ctx,
      '对了 ' + this.correct + ' / ' + this.order.length,
      W / 2, this.feedY,
      { size: 22, weight: '700', color: allOk ? T.ok : T.text });
  };

  /** 画一个带瓶颈/瓶盖 + 高光 + 描边的瓶子 */
  SceneBottle.prototype.drawBottle = function (ctx, rect, hex, opt) {
    opt = opt || {};
    var x = rect.x, y = rect.y, w = rect.w, h = rect.h;
    var bodyH = h * 0.82, bodyY = y + h * 0.18;
    var r = w * 0.36;

    // 瓶身（带竖向渐变做体积感）
    ctx.save();
    if (opt.lift !== false) {
      ctx.shadowColor = 'rgba(23,26,31,0.20)';
      ctx.shadowBlur = w * 0.14;
      ctx.shadowOffsetY = w * 0.06;
    }
    var g = ctx.createLinearGradient(x, bodyY, x, bodyY + bodyH);
    g.addColorStop(0, U.shade(hex, 0.28));
    g.addColorStop(0.5, hex);
    g.addColorStop(1, U.shade(hex, -0.20));
    D.roundRect(ctx, x, bodyY, w, bodyH, r);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    // 瓶颈 + 瓶盖（在瓶身顶上，略微探出 cell 顶部）
    var neckW = w * 0.42, neckH = h * 0.22, nx = x + (w - neckW) / 2, ny = y - h * 0.02;
    ctx.save();
    D.fillRound(ctx, nx, ny, neckW, neckH * 0.62, w * 0.08, U.shade(hex, -0.22));
    ctx.restore();
    ctx.save();
    D.fillRound(ctx, nx, ny + neckH * 0.42, neckW, neckH * 0.85, w * 0.10, U.shade(hex, -0.04));
    ctx.restore();

    // 高光：左侧一道竖向亮带
    ctx.save();
    var hg = ctx.createLinearGradient(x, bodyY, x + w * 0.5, bodyY);
    hg.addColorStop(0, 'rgba(255,255,255,0.32)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    D.roundRect(ctx, x + w * 0.12, bodyY + bodyH * 0.08, w * 0.20, bodyH * 0.66, w * 0.10);
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.restore();

    // 描边压边
    ctx.save();
    D.roundRect(ctx, x + 0.5, bodyY + 0.5, w - 1, bodyH - 1, r);
    ctx.strokeStyle = 'rgba(23,26,31,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // 选中环
    if (opt.selected) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + w / 2, bodyY + bodyH / 2, Math.max(w, bodyH) * 0.60, 0, Math.PI * 2);
      ctx.strokeStyle = U.rgba(T.accent, 0.95);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    // 已对位置：右上角小绿勾
    if (opt.correct) {
      ctx.save();
      D.icon(ctx, 'check', x + w - w * 0.22, bodyY + bodyH * 0.16, w * 0.30, T.ok, { alpha: 0.96 });
      ctx.restore();
    }
  };

  /** 画一个「隐藏目标」占位瓶：灰色瓶身 + 问号，不露真实颜色 */
  SceneBottle.prototype.drawCovered = function (ctx, rect) {
    var x = rect.x, y = rect.y, w = rect.w, h = rect.h;
    var bodyH = h * 0.82, bodyY = y + h * 0.18, r = w * 0.36;

    ctx.save();
    var g = ctx.createLinearGradient(x, bodyY, x, bodyY + bodyH);
    g.addColorStop(0, '#E7EAF0');
    g.addColorStop(1, '#CDD2DC');
    D.roundRect(ctx, x, bodyY, w, bodyH, r);
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();

    var neckW = w * 0.42, neckH = h * 0.22, nx = x + (w - neckW) / 2, ny = y - h * 0.02;
    ctx.save();
    D.fillRound(ctx, nx, ny, neckW, neckH * 0.85, w * 0.08, '#C2C8D2');
    ctx.restore();

    ctx.save();
    D.roundRect(ctx, x + 0.5, bodyY + 0.5, w - 1, bodyH - 1, r);
    ctx.strokeStyle = 'rgba(23,26,31,0.12)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    D.text(ctx, '?', x + w / 2, bodyY + bodyH * 0.58,
      { size: Math.max(14, w * 0.5), weight: '800', color: 'rgba(23,26,31,0.28)' });
  };

  /** 在瓶子上角画一个「已标记」圆点（橙色环 + 白心），纯视觉备忘 */
  SceneBottle.prototype.drawMark = function (ctx, rect) {
    var px = rect.x + rect.w * 0.16, py = rect.y + rect.h * 0.12;
    var pr = Math.max(6, rect.w * 0.15);
    ctx.save();
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fillStyle = T.accent; ctx.fill();
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(1.5, pr * 0.28); ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py, pr * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF'; ctx.fill();
    ctx.restore();
  };

  /** 拖动时源位留出的浅色虚位 */
  SceneBottle.prototype.drawSlotGhost = function (ctx, rect) {
    var x = rect.x, y = rect.y, w = rect.w, h = rect.h;
    var bodyH = h * 0.82, bodyY = y + h * 0.18, r = w * 0.36;
    ctx.save();
    D.roundRect(ctx, x, bodyY, w, bodyH, r);
    ctx.fillStyle = 'rgba(23,26,31,0.05)';
    ctx.fill();
    ctx.setLineDash([w * 0.16, w * 0.12]);
    ctx.strokeStyle = 'rgba(23,26,31,0.22)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  };

  /** 拖动时落点槽的高亮环 */
  SceneBottle.prototype.drawSlotHi = function (ctx, rect) {
    var x = rect.x, y = rect.y, w = rect.w, h = rect.h;
    var bodyH = h * 0.82, bodyY = y + h * 0.18;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + w / 2, bodyY + bodyH / 2, Math.max(w, bodyH) * 0.60, 0, Math.PI * 2);
    ctx.strokeStyle = U.rgba(T.accent, 0.95);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  };

  SceneBottle.prototype.renderFooter = function (ctx) {
    for (var i = 0; i < this.btns.length; i++) {
      var b = this.btns[i];
      if (b.key === 'mark' && this.markMode) {
        D.button(ctx, b, b.label, { fill: T.accent, color: '#FFFFFF', size: 14, shadow: true });
      } else {
        D.button(ctx, b, b.label, { fill: '#FFFFFF', color: T.text, icon: b.icon, iconColor: T.textSub });
      }
    }
  };

  SceneBottle.prototype.renderToast = function (ctx) {
    if (!this.toast) { return; }
    var pf = BF.platform;
    var a = Math.min(1, this.toast.t / 320);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 13px ' + D.FONT;
    var w = ctx.measureText(this.toast.text).width + 32;
    var x = (pf.width - w) / 2, y = this.feedY - 30;
    D.fillRound(ctx, x, y, w, 38, 19, 'rgba(28,31,36,0.88)');
    D.text(ctx, this.toast.text, pf.width / 2, y + 19.5, { size: 13, color: '#FFFFFF', weight: '600' });
    ctx.restore();
  };

  SceneBottle.prototype.overlayLayout = function () {
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

  function mapRect(r, card, dx, dy, k) {
    return { x: dx + (r.x - card.x) * k, y: dy + (r.y - card.y) * k, w: r.w * k, h: r.h * k };
  }

  SceneBottle.prototype.renderWin = function (ctx) {
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
    var last = !this.isDaily && this.level >= this.meta.TOTAL;
    D.text(ctx, this.isDaily ? '今日挑战完成' : (last ? '🎉 通关！' : '全部排好！'), cx + cw / 2, cy + 44,
      { size: 21, weight: '700' });
    if (last) {
      D.text(ctx, '已解锁全部 ' + this.meta.TOTAL + ' 关', cx + cw / 2, cy + 70,
        { size: 12.5, color: T.textSub });
    }

    var starY = cy + 98, r = 22, gapx = r * 2.5;
    for (var i = 0; i < 3; i++) {
      var on = i < this.win.stars;
      var delay = U.clamp((this.win.t - 180 - i * 130) / 220, 0, 1);
      var sc = on ? (0.6 + 0.4 * U.easeOutCubic(delay)) * (1 + 0.25 * Math.sin(Math.PI * delay)) : 1;
      D.star(ctx, cx + cw / 2 + (i - 1) * gapx, starY, r * sc, 0.46,
        on ? T.gold : 'rgba(23,26,31,0.10)', 'rgba(23,26,31,0.10)');
    }
    D.text(ctx, '交换 ' + this.swaps + ' 次 · 最少 ' + this.puzzle.par + ' 次',
      cx + cw / 2, cy + 150, { size: 12.5, color: T.textSub });
    var th = this.thresholdsFor(this.order.length);
    D.text(ctx, '本关 3★ 线：交换 ≤ ' + (this.puzzle.par + th.three) + ' 次',
      cx + cw / 2, cy + 168, { size: 11, color: T.textSub, weight: '600' });

    var k = cw / card.w;
    var ra = mapRect(ob.again, card, cx, cy, k);
    var rn = mapRect(ob.next, card, cx, cy, k);
    var pr = this.win.press;

    D.button(ctx, ra, '重玩', { fill: pr === 'again' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15 });
    last = !this.isDaily && this.level >= this.meta.TOTAL;
    D.button(ctx, rn, this.isDaily ? '返回首页' : (last ? '返回关卡' : '下一关'),
      { fill: pr === 'next' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15, shadow: true });
    ctx.restore();
  };

  BF.SceneBottle = SceneBottle;
})();
