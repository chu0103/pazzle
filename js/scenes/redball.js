/**
 * redball.js —— 第 15 款游戏「盯红球」玩法场景（固定 18 关闯关，多红球追踪）
 *
 * 玩法（洗牌追踪版，后段 2~3 个红球同时追踪）：
 *   - 观察期(OBSERVE)：N 个球排成网格，RED_COUNT 个红球、其余统一干扰蓝，
 *     短暂展示让玩家看清每颗红球初始位置（startReds）。
 *   - 洗牌期(SHUFFLE)：所有球瞬间统一成干扰蓝（抹除颜色信息），随后在槽位间
 *     两两交换位置（swaps 次，速度随关卡加快）；玩家只能靠"盯住红球运动轨迹"
 *     记住它们去哪了。
 *   - 作答期(ANSWER)：球停在最终槽位、显淡编号 1–N；玩家须**点出全部红球落点**。
 *     点中一个正确槽位即标记找到；点错或超时扣 1 颗心，3 心用完本关失败重来
 *     （与猫猫方块同套 3 心语义）。
 *   - 揭晓(REVEAL)：找齐 → 过关；心用完 → 失败，高亮全部红球真实落点。
 *
 * 结构照抄 cat.js（enter/layout/update/onDown/onUp/render + 过关/失败弹窗 +
 * 底部提示按钮 + RuleTip 5 点接入）。洗牌动画用 slot 历史表驱动，纯矢量绘制。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.SceneRedball) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;

  /* ---------------- 场景构造 ---------------- */

  function SceneRedball(app) {
    this.app = app;
    this.fadeIn = 1;
    this.t = 0;
    this.win = null;
    this.fail = null;
    this.toast = null;
    this.hintBtn = null;
    this.wrongFlash = null;
  }

  /* ---------------- 建关 / 状态 ---------------- */

  SceneRedball.prototype.enter = function (params) {
    params = params || {};
    this.game = params.game || 'redball';
    this.level = params.level || 1;
    this.isDaily = !!params.daily;

    var p = BF.RedballGen.build(this.level);
    this.N = p.N;
    this.redCount = p.redCount;           // 本关需追踪的红球数
    this.swaps = p.swaps;                 // [[a,b], ...] 槽位对
    this.startReds = p.startReds;         // 红球初始槽位（观察期红色）
    this.finalReds = p.finalReds;         // 红球最终槽位（答案集合）
    this.red = p.red;
    this.distract = p.distract;
    this.observeMs = p.observeMs;
    this.swapMs = p.swapMs;
    this.answerMs = p.answerMs;

    // 槽位历史表：hist[k] = 洗牌第 k 次交换前、槽位 s 上放的球 id（id==初始槽位）。
    // 初始 hist[0][s]=s；每次交换 swaps[k]=[a,b] 把 hist[k][a]/[b] 互换得 hist[k+1]。
    // inv[k][id] = 第 k 步时球 id 所在槽位（供静止球定位 + 揭晓找红球用）。
    this.buildHist();

    this.hearts = 3;
    this.mistakes = 0;
    this.hintsUsed = 0;
    this.found = {};                      // finalSlot -> true（已找到的红球）
    this.foundCount = 0;
    this.hintSlot = -1;
    this.elapsed = 0;
    this.phase = 'observe';               // observe → shuffle → answer → (reveal 内联)
    this.observeT = this.observeMs;
    this.shuffleT = 0;
    this.answerT = this.answerMs;
    this.win = null;
    this.fail = null;
    this.toast = null;
    this.wrongFlash = null;
    this.hintPulse = 0;
    this.fadeIn = 1;
    this.t = 0;
    this.layout();

    // 玩法说明弹框：进这款游戏第一次时弹一次
    if (BF.RuleTip.shouldShow(this.game, this)) { BF.RuleTip.enter(this, params); }
    return this;
  };

  SceneRedball.prototype.buildHist = function () {
    var N = this.N, swaps = this.swaps;
    var hist = [], inv = [];
    var cur = [];
    for (var i = 0; i < N; i++) { cur.push(i); }
    hist.push(cur.slice());
    inv.push(cur.slice());                // inv[0][id]=id
    for (var k = 0; k < swaps.length; k++) {
      var a = swaps[k][0], b = swaps[k][1];
      var nc = cur.slice();
      var tmp = nc[a]; nc[a] = nc[b]; nc[b] = tmp;
      cur = nc;
      hist.push(cur.slice());
      // 反查：inv[k+1][id] = 球 id 在 cur 中的下标
      var invRow = new Array(N);
      for (var s = 0; s < N; s++) { invRow[cur[s]] = s; }
      inv.push(invRow);
    }
    this.hist = hist;
    this.inv = inv;
  };

  /* ---------------- 布局 ---------------- */

  SceneRedball.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var top = pf.safeTop;

    this.headerH = 56;
    this.headerY = top;
    this.back = { x: 12, y: top + 8, w: 40, h: 40 };
    this.ruleBtn = BF.RuleTip.btnRect(this);

    var footerH = 56 + pf.safeBottom;
    var instrH = 28;
    var cols = (this.N <= 8) ? 2 : 3;     // 球数多时三列，避免单列过高
    var rows = Math.ceil(this.N / cols);
    var areaTop = top + this.headerH + instrH + 6;
    var areaBot = H - footerH - 8;
    var availH = Math.max(80, areaBot - areaTop);

    var gap = 12;
    var cellW = (W - 32 - gap * (cols - 1)) / cols;
    var cellH = (availH - gap * (rows - 1)) / rows;
    var cell = Math.min(cellW, cellH);
    var boardW = cols * cell + gap * (cols - 1);
    var boardH = rows * cell + gap * (rows - 1);
    this.boardX = (W - boardW) / 2;
    this.boardY = areaTop + (availH - boardH) / 2;
    this.cell = cell;

    this.slots = [];
    for (var i = 0; i < this.N; i++) {
      var col = i % cols, row = Math.floor(i / cols);
      var x = this.boardX + col * (cell + gap);
      var y = this.boardY + row * (cell + gap);
      this.slots.push({ x: x, y: y, w: cell, h: cell });
    }
    this.radius = cell * 0.34;
    this.instrY = top + this.headerH + instrH * 0.5 + 4;

    var bh = 44, bw = 168;
    this.hintBtn = { x: (W - bw) / 2, y: H - pf.safeBottom - bh, w: bw, h: bh };
  };

  SceneRedball.prototype.slotCenter = function (s) {
    var r = this.slots[s];
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };

  /* ---------------- 更新 ---------------- */

  SceneRedball.prototype.update = function (dt) {
    if (this.showRule) { return BF.RuleTip.update(this, dt); }
    this.t += dt;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) { this.toast = null; } }
    if (this.wrongFlash) { this.wrongFlash.t -= dt; if (this.wrongFlash.t <= 0) { this.wrongFlash = null; } }
    if (this.win) { this.win.t += dt; return; }
    if (this.fail) { this.fail.t += dt; return; }
    if (this.hintPulse > 0) { this.hintPulse = Math.max(0, this.hintPulse - dt); }
    this.elapsed += dt;

    if (this.phase === 'observe') {
      this.observeT -= dt;
      if (this.observeT <= 0) { this.phase = 'shuffle'; this.shuffleT = 0; }
    } else if (this.phase === 'shuffle') {
      this.shuffleT += dt;
      var total = this.swaps.length * this.swapMs;
      if (this.shuffleT >= total) { this.phase = 'answer'; this.answerT = this.answerMs; }
    } else if (this.phase === 'answer') {
      this.answerT -= dt;
      if (this.answerT <= 0) {
        // 超时：算一次失误、扣心；心没了 → 失败，否则重置倒计时再给一次机会
        this.mistakes++;
        this.hearts--;
        this.showToast('超时啦，扣 1 颗心');
        if (this.hearts <= 0) { this.fail = { t: 0, press: null }; }
        else { this.answerT = this.answerMs; }
      }
    }
  };

  /* ---------------- 输入 ---------------- */

  SceneRedball.prototype.onDown = function (x, y) {
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
    // 观察期点背景 = 提前结束观察（作答期点槽位在 onUp 里处理，避免一次点按触发两次）
    if (this.phase === 'observe') {
      this.phase = 'shuffle'; this.shuffleT = 0;
    }
  };

  SceneRedball.prototype.onUp = function (x, y) {
    if (this.showRule) { BF.RuleTip.onUp(this, x, y); return; }
    if (this.win) {
      var ob = this.overlayLayout();
      var hit = this.win.press; this.win.press = null;
      if (hit === 'home' && U.pointInRect(x, y, ob.home)) { this.app.go('home'); return; }
      if (hit === 'action' && U.pointInRect(x, y, ob.action)) { this.nextAfterWin(); return; }
      return;
    }
    if (this.fail) {
      var fo = this.overlayLayout();
      var fh = this.fail.press; this.fail.press = null;
      if (fh === 'home' && U.pointInRect(x, y, fo.home)) { this.app.go('home'); return; }
      if (fh === 'action' && U.pointInRect(x, y, fo.action)) {
        BF.RuleTip.skipOnce(this); this.enter({ level: this.level, game: this.game }); return;
      }
      return;
    }
    // 提示按钮按下态（简单点按即可，无需 press 跟踪）
    if (this.phase === 'answer' && U.pointInRect(x, y, this.hintBtn)) {
      this.pressHint(); return;
    }
    if (this.phase === 'answer') {
      var s = this.slotAt(x, y);
      if (s >= 0) { this.tapSlot(s); }
    }
  };

  SceneRedball.prototype.onMove = function () { /* 盯红球无需拖动 */ };

  SceneRedball.prototype.slotAt = function (x, y) {
    for (var i = 0; i < this.slots.length; i++) {
      if (U.pointInRect(x, y, this.slots[i])) { return i; }
    }
    return -1;
  };

  /** 作答期点选一个槽位：命中未找到的红球→标记找到；找齐→过关；否则扣心 */
  SceneRedball.prototype.tapSlot = function (s) {
    if (this.found[s]) { return; }                 // 已找到，忽略重复点
    if (this.finalReds.indexOf(s) >= 0) {
      this.found[s] = true;
      this.foundCount++;
      BF.platform.vibrate('light');
      if (this.foundCount >= this.redCount) { this.onSolved(); }
      else { this.showToast('找到啦！还差 ' + (this.redCount - this.foundCount) + ' 个'); }
    } else {
      // 猜错：扣心、记失误、闪一下错误槽位
      this.hearts--;
      this.mistakes++;
      this.wrongFlash = { slot: s, t: 600 };
      BF.platform.vibrate('light');
      if (this.hearts <= 0) { this.fail = { t: 0, press: null }; }
      else { this.showToast('不是红球，再想想'); }
    }
  };

  SceneRedball.prototype.pressHint = function () {
    this.hintsUsed++;
    this.hintPulse = 1200;
    // 选一个尚未找到的红球落点高亮
    for (var i = 0; i < this.finalReds.length; i++) {
      if (!this.found[this.finalReds[i]]) { this.hintSlot = this.finalReds[i]; break; }
    }
    this.showToast('已高亮一个红球所在的格子');
  };

  SceneRedball.prototype.showToast = function (txt) { this.toast = { text: txt, t: 1500 }; };

  /* ---------------- 评星 / 存档 ---------------- */

  SceneRedball.prototype.starsFor = function (mistakes, hintsUsed) {
    var s = mistakes === 0 ? 3 : (mistakes <= 2 ? 2 : 1);
    if (hintsUsed >= 1) { s = Math.min(s, 2); }
    if (hintsUsed >= 2) { s = Math.min(s, 1); }
    return s;
  };

  SceneRedball.prototype.onSolved = function () {
    var stars = this.starsFor(this.mistakes, this.hintsUsed);
    BF.Save.clear('redball', this.level, stars);
    this.win = { t: 0, stars: stars, press: null,
      sec: Math.round(this.elapsed / 10) / 100 };
    BF.platform.vibrate('heavy');
  };

  SceneRedball.prototype.nextAfterWin = function () {
    if (this.level < BF.games.redball.TOTAL) {
      BF.RuleTip.skipOnce(this); this.enter({ level: this.level + 1, game: this.game });
    } else { this.app.go('home'); }
  };

  /* ---------------- 渲染 ---------------- */

  SceneRedball.prototype.render = function (ctx) {
    var pf = BF.platform, W = pf.width, H = pf.height;

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.bgTop);
    bg.addColorStop(1, T.bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    this.renderHeader(ctx);
    this.renderInstr(ctx);
    this.renderBalls(ctx);
    this.renderHintButton(ctx);
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

  SceneRedball.prototype.renderHeader = function (ctx) {
    var W = BF.platform.width, top = this.headerY;
    D.fillRound(ctx, this.back.x, this.back.y, this.back.w, this.back.h, 14, '#FFFFFF');
    D.roundRect(ctx, this.back.x + 0.5, this.back.y + 0.5, this.back.w - 1, this.back.h - 1, 14);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    D.icon(ctx, 'back', this.back.x + this.back.w / 2, this.back.y + this.back.h / 2, 16, T.text);
    BF.RuleTip.renderBtn(ctx, this);

    D.text(ctx, '盯红球', W / 2, top + 17, { size: 18, weight: '700' });
    var sub = '第 ' + this.level + ' 关 · ' + this.N + ' 球';
    if (this.redCount > 1) { sub += ' · ' + this.redCount + ' 红'; }
    D.text(ctx, sub, W / 2, top + 38,
      { size: 11, color: T.textSub, weight: '600' });

    var sec = Math.floor(this.elapsed / 1000);
    D.text(ctx, '⏱ ' + sec + 's', W - 16, top + 16,
      { size: 13, color: T.textSub, weight: '600', align: 'right' });

    var hs = 13, gap = 4, total = 3;
    var baseX = W - 16 - hs / 2;
    var y = top + 38 + hs / 2;
    for (var i = 0; i < total; i++) {
      var hx = baseX - i * (hs + gap);
      fillHeart(ctx, hx, y, hs, i < this.hearts);
    }
  };

  SceneRedball.prototype.renderInstr = function (ctx) {
    var txt;
    if (this.phase === 'observe') { txt = '记住 ' + this.redCount + ' 颗红球的位置！'; }
    else if (this.phase === 'shuffle') { txt = '盯住红球别跟丢了…'; }
    else if (this.phase === 'answer') {
      txt = '点出全部红球落点（已找到 ' + this.foundCount + '/' + this.redCount + '）';
    } else { txt = ''; }
    if (txt) {
      D.text(ctx, txt, BF.platform.width / 2, this.instrY,
        { size: 15, weight: '700', color: T.accent });
    }
    // 作答倒计时条
    if (this.phase === 'answer') {
      var W = BF.platform.width;
      var barX = 24, barW = W - 48, barY = this.instrY + 12, barH = 6;
      var frac = U.clamp(this.answerT / this.answerMs, 0, 1);
      D.fillRound(ctx, barX, barY, barW, barH, barH / 2, 'rgba(23,26,31,0.08)');
      var col = frac > 0.35 ? T.accent : '#E5484D';
      if (frac > 0) {
        D.fillRound(ctx, barX, barY, Math.max(barH, barW * frac), barH, barH / 2, col);
      }
    }
  };

  /** 画全部球。按阶段决定颜色 / 编号 / 动画位置。 */
  SceneRedball.prototype.renderBalls = function (ctx) {
    var r = this.radius;

    // 洗牌动画：当前段 k + 进度 p
    var k = -1, p = 0, e = 0;
    if (this.phase === 'shuffle') {
      var total = this.swaps.length * this.swapMs;
      var tt = U.clamp(this.shuffleT, 0, total);
      k = Math.min(Math.floor(tt / this.swapMs), this.swaps.length - 1);
      p = (tt - k * this.swapMs) / this.swapMs;
      e = U.easeInOutQuad(p);
    }

    var reveal = (this.win || this.fail);
    for (var id = 0; id < this.N; id++) {
      var cx, cy, color, isRed = false;

      if (this.phase === 'observe') {
        // 红球在 startReds；其余蓝
        if (this.startReds.indexOf(id) >= 0) { color = this.red; isRed = true; }
        else { color = this.distract; }
        var c0 = this.slotCenter(id);
        cx = c0.x; cy = c0.y;
      } else if (this.phase === 'shuffle') {
        color = this.distract;
        var stepSlot = this.inv[k][id];
        var a = this.swaps[k][0], b = this.swaps[k][1];
        var idA = this.hist[k][a], idB = this.hist[k][b];
        if (id === idA) {
          var ca = this.slotCenter(a), cb = this.slotCenter(b);
          cx = ca.x + (cb.x - ca.x) * e; cy = ca.y + (cb.y - ca.y) * e;
        } else if (id === idB) {
          var cb2 = this.slotCenter(b), ca2 = this.slotCenter(a);
          cx = cb2.x + (ca2.x - cb2.x) * e; cy = cb2.y + (ca2.y - cb2.y) * e;
        } else {
          var cs = this.slotCenter(stepSlot);
          cx = cs.x; cy = cs.y;
        }
      } else {
        // answer / reveal：球停在最终槽位（inv[last][id]）
        var lastSlot = this.inv[this.inv.length - 1][id];
        var cf = this.slotCenter(lastSlot);
        cx = cf.x; cy = cf.y;
        color = this.distract;
        // 揭晓：红球亮出来（在 finalReds 槽位上的球即红球）
        if (reveal && this.finalReds.indexOf(lastSlot) >= 0) {
          color = this.red; isRed = true;
        }
      }

      // 作答期编号：按球当前所在槽位（=inv[last][id]）给号
      var slotNow = (this.phase === 'observe') ? id : this.inv[this.inv.length - 1][id];
      var num = (this.phase === 'answer' || reveal) ? (slotNow + 1) : -1;

      drawBall(ctx, cx, cy, r, color, { num: num, red: isRed });

      // 提示高亮：脉冲一个尚未找到的红球落点
      if (this.hintPulse > 0 && this.phase === 'answer' && this.hintSlot >= 0 && slotNow === this.hintSlot) {
        var pulse = 0.5 + 0.5 * Math.sin(this.hintPulse / 120);
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.5 * pulse;
        ctx.strokeStyle = T.gold;
        ctx.lineWidth = 3;
        D.roundRect(ctx, cx - r - 4, cy - r - 4, (r + 4) * 2, (r + 4) * 2, r * 0.6);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 答错闪烁：在错误槽位画红圈
    if (this.wrongFlash) {
      var wr = this.slotCenter(this.wrongFlash.slot);
      var wa = U.clamp(this.wrongFlash.t / 600, 0, 1);
      ctx.save();
      ctx.globalAlpha = wa;
      ctx.strokeStyle = '#E5484D';
      ctx.lineWidth = 3;
      D.roundRect(ctx, wr.x - r - 4, wr.y - r - 4, (r + 4) * 2, (r + 4) * 2, r * 0.6);
      ctx.stroke();
      ctx.restore();
    }

    // 已找到的红球：绿圈 + ✓（作答期与揭晓期都显示，提示进度）
    for (var fi = 0; fi < this.finalReds.length; fi++) {
      var fs = this.finalReds[fi];
      if (!this.found[fs]) { continue; }
      var fc = this.slotCenter(fs);
      ctx.save();
      ctx.strokeStyle = T.ok;
      ctx.lineWidth = 3;
      D.roundRect(ctx, fc.x - r - 4, fc.y - r - 4, (r + 4) * 2, (r + 4) * 2, r * 0.6);
      ctx.stroke();
      ctx.fillStyle = T.ok;
      ctx.font = '700 ' + Math.round(r * 0.8) + 'px ' + D.FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✓', fc.x, fc.y + r * 0.04);
      ctx.restore();
    }

    // 揭晓且失败：未找到的红球落点画红圈，提示正确位置
    if (reveal && this.fail) {
      for (var ui = 0; ui < this.finalReds.length; ui++) {
        var us = this.finalReds[ui];
        if (this.found[us]) { continue; }
        var uc = this.slotCenter(us);
        ctx.save();
        ctx.strokeStyle = this.red;
        ctx.lineWidth = 3;
        D.roundRect(ctx, uc.x - r - 4, uc.y - r - 4, (r + 4) * 2, (r + 4) * 2, r * 0.6);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  SceneRedball.prototype.renderHintButton = function (ctx) {
    var b = this.hintBtn;
    var active = (this.phase === 'answer' && this.foundCount < this.redCount);
    D.button(ctx, b, '提示', {
      fill: active ? U.rgba(T.accent, 0.12) : '#F0F2F5',
      color: active ? T.accent : T.textSub,
      icon: 'hint', iconColor: active ? T.accent : T.textSub,
      disabled: !active
    });
  };

  SceneRedball.prototype.renderToast = function (ctx) {
    if (!this.toast) { return; }
    var pf = BF.platform;
    var a = Math.min(1, this.toast.t / 300);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 13px ' + D.FONT;
    var w = ctx.measureText(this.toast.text).width + 32;
    var x = (pf.width - w) / 2, y = this.instrY + 6;
    D.fillRound(ctx, x, y, w, 34, 17, 'rgba(28,31,36,0.88)');
    D.text(ctx, this.toast.text, pf.width / 2, y + 17.5, { size: 13, color: '#FFFFFF', weight: '600' });
    ctx.restore();
  };

  SceneRedball.prototype.overlayLayout = function () {
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

  SceneRedball.prototype.renderWin = function (ctx) {
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
    D.text(ctx, '用时 ' + this.win.sec + ' 秒 · 失误 ' + this.mistakes + ' 次' +
      (this.hintsUsed ? ' · 用了提示' : ''),
      cx + cw / 2, cy + 150, { size: 12.5, color: T.textSub });

    var k = cw / card.w;
    var rh = { x: cx + (ob.home.x - card.x) * k, y: cy + (ob.home.y - card.y) * k,
               w: ob.home.w * k, h: ob.home.h * k };
    var ra = { x: cx + (ob.action.x - card.x) * k, y: cy + (ob.action.y - card.y) * k,
               w: ob.action.w * k, h: ob.action.h * k };
    var pr = this.win.press;
    var last = this.level >= BF.games.redball.TOTAL;
    D.button(ctx, rh, '返回首页', { fill: pr === 'home' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15 });
    D.button(ctx, ra, last ? '完成' : '下一关',
      { fill: pr === 'action' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15, shadow: true });
    ctx.restore();
  };

  SceneRedball.prototype.renderFail = function (ctx) {
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
    D.text(ctx, '3 颗心用完了，再试一次吧', cx + cw / 2, cy + 92,
      { size: 13, color: T.textSub });
    var nums = this.finalReds.map(function (v) { return (v + 1); }).join('、');
    D.text(ctx, '红球其实在 ' + nums + ' 号',
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
    ctx.arc(x - s * 0.18, y - s * 0.02, lobe, 0, Math.PI * 2);
    ctx.arc(x + s * 0.18, y - s * 0.02, lobe, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - s * 0.42, y + s * 0.02);
    ctx.lineTo(x + s * 0.42, y + s * 0.02);
    ctx.lineTo(x, y + s * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 一颗球：径向高光 + 描边光泽 + 可选编号 */
  function drawBall(ctx, cx, cy, r, color, opt) {
    opt = opt || {};
    ctx.save();
    ctx.shadowColor = 'rgba(23,26,31,0.18)';
    ctx.shadowBlur = Math.max(2, r * 0.16);
    ctx.shadowOffsetY = Math.max(1, r * 0.06);

    var g = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.36, r * 0.1, cx, cy, r);
    g.addColorStop(0, U.shade(color, 0.32));
    g.addColorStop(1, U.shade(color, -0.06));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 顶部高光点（用缩放圆画椭圆，避开部分引擎不支持的 ctx.ellipse）
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.translate(cx - r * 0.30, cy - r * 0.38);
    ctx.rotate(-0.6);
    ctx.scale(1, 0.22 / 0.34);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 编号
    if (opt.num && opt.num > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '700 ' + Math.round(r * 0.7) + 'px ' + D.FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(opt.num), cx, cy + r * 0.04);
      ctx.restore();
    }
  }

  BF.SceneRedball = SceneRedball;
})();
