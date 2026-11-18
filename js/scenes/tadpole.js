/**
 * tadpole.js —— 第 16 款游戏「盯蝌蚪」玩法场景（固定 15 关闯关，标记追踪 + 自由漂移）
 *
 * 玩法（标记追踪版，与盯红球同构但机制不同）：
 *   - 观察期(OBSERVE)：N 只蝌蚪自由散布在卡片上，T 只被红虚线圈住（被标记目标），
 *     其余为干扰蝌蚪；短暂展示让玩家记住"哪几只被圈"。
 *   - 游动倒计时(SHUFFLE)：红圈渐隐并【跟随】目标 900ms，所有蝌蚪连续蜿蜒游动；
 *     顶部有倒计时条，此阶段**不可点选**，玩家只负责盯住被圈的那几只。
 *     倒计时归零时按 S 曲线平滑减速到 0（不是急刹），蝌蚪停在最后一帧。
 *   - 作答期(ANSWER)：蝌蚪**完全定格**（playT 冻结）、无编号；玩家须**点出全部被标记蝌蚪**。
 *     点中一个正确蝌蚪即标记找到；点错干扰蝌蚪或超时扣 1 颗心，3 心用完本关失败重来。
 *   - 揭晓(REVEAL)：找齐 → 过关；心用完 → 失败，高亮全部被标记蝌蚪。
 *
 * 结构照抄 redball.js（enter/layout/update/onDown/onUp/render + 过关/失败弹窗 +
 * 底部提示按钮 + RuleTip 5 点接入）。位置用归一化坐标经 layout 映射，纯矢量绘制蝌蚪。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.SceneTadpole) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;

  /* ---------------- 场景构造 ---------------- */

  function SceneTadpole(app) {
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

  SceneTadpole.prototype.enter = function (params) {
    params = params || {};
    this.game = params.game || 'tadpole';
    this.level = params.level || 1;
    this.isDaily = !!params.daily;

    var p = BF.TadpoleGen.build(this.level);
    this.N = p.N;
    this.markCount = p.markCount;       // 本关需追踪的被标记蝌蚪数
    this.markedIds = p.markedIds;       // 被标记蝌蚪 id 集合（答案）
    this.tadpoles = p.tadpoles;         // [{id,marked,sx,sy,ex,ey,r0,r1}]
    this.ink = p.ink;
    this.markColor = p.mark;
    this.observeMs = p.observeMs;
    this.shuffleMs = p.shuffleMs;
    this.answerMs = p.answerMs;

    this.hearts = 3;
    this.mistakes = 0;
    this.hintsUsed = 0;
    this.found = {};                    // tadpole id -> true（已找到的被标记蝌蚪）
    this.foundCount = 0;
    this.hintId = -1;
    this.elapsed = 0;
    this.phase = 'observe';             // observe → shuffle(游动倒计时) → answer(定格点选)
    this.observeT = this.observeMs;
    this.observeLockT = 420;            // 进观察期前 420ms 屏蔽"跳过"，防刚进关手滑误触
    this.playT = 0;                     // 游动倒计时计时；进 answer 后**冻结**，画面定格
    this.swimMs = this.shuffleMs;       // 游动倒计时总长（数据层按关卡缓降，后段已加时）
    this.markFadeMs = 900;              // 红圈余辉：渐隐且跟随蝌蚪，桥接「定格→游动」
    // 红圈渐隐前半段先保持绝对静止，之后才缓缓起步：余辉窗口里玩家稳稳把「圈」对应到「蝌蚪」。
    this.startDelayMs = Math.max(360, this.swimMs * 0.10);
    // 有效动画时间上限：motionTimeOf 用 easeInOutCubic 把 [startDelayMs,swimMs] 映射成
    // [0,motionEnd]。该曲线首尾导数均为 0 → 「定格→游动」缓缓起步、「游动→定格」平滑刹停，
    // 两端都 C¹ 连续；倒计时结束时 motionT 饱和，此后 playT 冻结 → 整幅画面完全静止。
    this.motionEnd = Math.max(4200, this.swimMs * 1.1);
    this.answerT = this.answerMs;
    this.showNumbers = false;           // 视频无编号：靠记长相 + 倒计时内追踪，停下后点选
    this.win = null;
    this.fail = null;
    this.toast = null;
    this.wrongFlash = null;
    this.hintPulse = 0;
    this.fadeIn = 1;
    this.t = 0;
    this.layout();

    if (BF.RuleTip.shouldShow(this.game, this)) { BF.RuleTip.enter(this, params); }
    return this;
  };

  /* ---------------- 布局 ---------------- */

  SceneTadpole.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var top = pf.safeTop;

    this.headerH = 56;
    this.headerY = top;
    this.back = { x: 12, y: top + 8, w: 40, h: 40 };
    this.ruleBtn = BF.RuleTip.btnRect(this);

    var footerH = 56 + pf.safeBottom;
    var instrH = 30;
    var areaTop = top + this.headerH + instrH + 6;
    var areaBot = H - footerH - 8;
    var availH = Math.max(120, areaBot - areaTop);

    // 卡片（淡黄色），居中，偏竖
    var cardW = Math.min(W * 0.9, 430);
    var cardH = Math.min(availH * 0.98, cardW * 1.34);
    this.cardX = (W - cardW) / 2;
    this.cardY = areaTop + (availH - cardH) / 2;
    this.cardW = cardW;
    this.cardH = cardH;

    // 蝌蚪半径：按参考视频比例——小小的水滴头 + 细长尾，整体明显小于早版「大逗号」；
    // 据 N 略缩，缩小后所有基于 r 的红圈/绿圈/提示框/边距同步缩放。
    var baseR = Math.min(cardW, cardH) * 0.036;
    this.r = U.clamp(baseR - (this.N - 8) * 0.25, 7, 13);
    var inset = this.r * 2.6;           // 保证蝌蚪(含尾巴)不触卡片边
    this.innerX = this.cardX + inset;
    this.innerY = this.cardY + inset;
    this.innerW = cardW - 2 * inset;
    this.innerH = cardH - 2 * inset;

    this.instrY = top + this.headerH + instrH * 0.5 + 4;

    var bh = 44, bw = 168;
    this.hintBtn = { x: (W - bw) / 2, y: H - pf.safeBottom - bh, w: bw, h: bh };
  };

  /** 归一化坐标 → 卡片像素坐标 */
  SceneTadpole.prototype.map = function (nx, ny) {
    return { x: this.innerX + nx * this.innerW, y: this.innerY + ny * this.innerH };
  };

  /**
   * 真实倒计时 playT → 有效动画时间 motionT。
   * easeInOutCubic 首尾导数均为 0：起步不丢目标、收尾自然刹停；u≥1 后 clamp 饱和，
   * 配合 update 里 playT 冻结，保证作答期每一帧都完全相同（蝌蚪停下来再让玩家选）。
   */
  SceneTadpole.prototype.motionTimeOf = function (playT) {
    var span = this.swimMs - this.startDelayMs;
    var u = U.clamp(((playT || 0) - this.startDelayMs) / span, 0, 1);
    return this.motionEnd * U.easeInOutCubic(u);
  };

  /** 迁徙进度：0=观察期起点，1=打乱终点附近。缓入缓出交给 motionTimeOf，这里线性即可。 */
  SceneTadpole.prototype.wakeOf = function (motionT) {
    return U.clamp(motionT / this.motionEnd, 0, 1);
  };

  // 归一化游动坐标：绕 (ex,ey) 做「主波 + 次级波」叠加的蜿蜒游动，次级波让轨迹拐弯
  // 而非规则椭圆。参数 time 是**有效动画时间** motionT（不是真实 playT）。
  SceneTadpole.prototype.swimXY = function (i, time) {
    var t = this.tadpoles[i];
    var wake = this.wakeOf(time);
    // 波形幅度也随 wake 渐入，避免起步瞬间叠加一个"已经在别处"的相位偏移
    var nx = t.ex + (t.ax * Math.sin(t.fx * time + t.px)
                  + t.ax2 * Math.sin(t.fx2 * time + t.px2)) * wake;
    var ny = t.ey + (t.ay * Math.sin(t.fy * time + t.py)
                  + t.ay2 * Math.sin(t.fy2 * time + t.py2)) * wake;
    // 有界：尾巴长达 3.3r 会甩到头后方，故留比 inset(r*2.6) 更宽的边距防出卡片
    nx = U.clamp(nx, 0.088, 0.912);
    ny = U.clamp(ny, 0.088, 0.912);
    return { x: t.sx + (nx - t.sx) * wake, y: t.sy + (ny - t.sy) * wake };
  };

  /** 当前像素位置（answer 期 playT 冻结 → 位置恒定，蝌蚪停在倒计时结束那一帧） */
  SceneTadpole.prototype.posOf = function (i, e) {
    var t = this.tadpoles[i];
    if (this.phase === 'observe') { return this.map(t.sx, t.sy); }
    var s = this.swimXY(i, this.motionTimeOf(this.playT || 0));
    return this.map(s.x, s.y);
  };

  /** 朝向：观察期固定 r0；起步后按最短角差从 r0 平滑转向游动速度方向（避免第一帧朝向突变） */
  SceneTadpole.prototype.rotOf = function (i, e) {
    var t = this.tadpoles[i];
    if (this.phase === 'observe') { return t.r0; }
    var p = this.motionTimeOf(this.playT || 0);
    var a = this.swimXY(i, p), b = this.swimXY(i, p + 16);
    var dx = (b.x - a.x) * this.innerW, dy = (b.y - a.y) * this.innerH;
    if (dx * dx + dy * dy < 1e-8) { return t.r0; }   // 起步瞬间速度≈0，保持定格朝向
    var target = Math.atan2(dy, dx);
    var d = ((target - t.r0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return t.r0 + d * this.wakeOf(p);
  };

  /** 摆尾相位：观察期 0（静态弯），起步后从 0 连续进入行波；倒计时归零时行波同步停摆 */
  SceneTadpole.prototype.wagOf = function (i) {
    var t = this.tadpoles[i];
    if (this.phase === 'observe') { return 0; }
    var p = this.motionTimeOf(this.playT || 0);
    return (t.wagPh + i * 0.7 + t.wag * p) * this.wakeOf(p);
  };

  /** 红圈余辉透明度：观察期 1；游动后 markFadeMs 内渐隐到 0（桥接窗口，可数值化验证） */
  SceneTadpole.prototype.markAlpha = function () {
    if (this.phase === 'observe') { return 1; }
    if (this.win || this.fail) { return 0; }
    return 1 - U.clamp((this.playT || 0) / this.markFadeMs, 0, 1);
  };

  /* ---------------- 更新 ---------------- */

  SceneTadpole.prototype.update = function (dt) {
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
      if (this.observeLockT > 0) { this.observeLockT -= dt; }
      this.observeT -= dt;
      if (this.observeT <= 0) { this.phase = 'shuffle'; this.playT = 0; }
    } else if (this.phase === 'shuffle') {
      // 游动倒计时：末端由 motionTimeOf 的 S 曲线平滑减速，归零即切入定格作答
      this.playT = Math.min(this.playT + dt, this.swimMs);
      if (this.playT >= this.swimMs) { this.phase = 'answer'; this.answerT = this.answerMs; }
    } else if (this.phase === 'answer') {
      // ⚠️ playT 不再累加：倒计时结束后蝌蚪停下来，玩家在静止画面上点选
      this.answerT -= dt;
      if (this.answerT <= 0) {
        this.mistakes++;
        this.hearts--;
        this.showToast('超时啦，扣 1 颗心');
        if (this.hearts <= 0) { this.fail = { t: 0, press: null }; }
        else { this.answerT = this.answerMs; }
      }
    }
  };

  /* ---------------- 输入 ---------------- */

  SceneTadpole.prototype.onDown = function (x, y) {
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
    if (this.phase === 'observe') {
      if (this.observeLockT <= 0) { this.phase = 'shuffle'; this.playT = 0; }  // 防误触窗口内忽略
    }
  };

  SceneTadpole.prototype.onUp = function (x, y) {
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
    if (this.phase === 'answer' && U.pointInRect(x, y, this.hintBtn)) {
      this.pressHint(); return;
    }
    if (this.phase === 'answer') {
      var id = this.tadpoleAt(x, y);
      if (id >= 0) { this.tapTadpole(id); }
    }
  };

  SceneTadpole.prototype.onMove = function () { /* 盯蝌蚪无需拖动 */ };

  SceneTadpole.prototype.tadpoleAt = function (x, y) {
    // 尾巴长达 2.9r，判定半径放宽到 2.1r，点尾巴也能命中整只蝌蚪
    var best = -1, bestD = (this.r * 2.1) * (this.r * 2.1);
    for (var i = 0; i < this.N; i++) {
      var p = this.posOf(i);                   // 当前游动位置
      var dx = p.x - x, dy = p.y - y;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  /** 作答期点选一只蝌蚪：命中未找到的被标记→标记找到；找齐→过关；点干扰→扣心 */
  SceneTadpole.prototype.tapTadpole = function (id) {
    var t = this.tadpoles[id];
    if (this.found[id]) { return; }
    if (t.marked) {
      this.found[id] = true;
      this.foundCount++;
      BF.platform.vibrate('light');
      if (this.foundCount >= this.markCount) { this.onSolved(); }
      else { this.showToast('找到啦！还差 ' + (this.markCount - this.foundCount) + ' 只'); }
    } else {
      this.hearts--;
      this.mistakes++;
      this.wrongFlash = { id: id, t: 600 };
      BF.platform.vibrate('light');
      if (this.hearts <= 0) { this.fail = { t: 0, press: null }; }
      else { this.showToast('这不是被标记的，再想想'); }
    }
  };

  SceneTadpole.prototype.pressHint = function () {
    this.hintsUsed++;
    this.hintPulse = 1200;
    for (var i = 0; i < this.tadpoles.length; i++) {
      if (this.tadpoles[i].marked && !this.found[i]) { this.hintId = i; break; }
    }
    this.showToast('已高亮一只被标记的蝌蚪');
  };

  SceneTadpole.prototype.showToast = function (txt) { this.toast = { text: txt, t: 1500 }; };

  /* ---------------- 评星 / 存档 ---------------- */

  SceneTadpole.prototype.starsFor = function (mistakes, hintsUsed) {
    var s = mistakes === 0 ? 3 : (mistakes <= 2 ? 2 : 1);
    if (hintsUsed >= 1) { s = Math.min(s, 2); }
    if (hintsUsed >= 2) { s = Math.min(s, 1); }
    return s;
  };

  SceneTadpole.prototype.onSolved = function () {
    var stars = this.starsFor(this.mistakes, this.hintsUsed);
    BF.Save.clear('tadpole', this.level, stars);
    this.win = { t: 0, stars: stars, press: null, sec: Math.round(this.elapsed / 10) / 100 };
    BF.platform.vibrate('heavy');
  };

  SceneTadpole.prototype.nextAfterWin = function () {
    if (this.level < BF.games.tadpole.TOTAL) {
      BF.RuleTip.skipOnce(this); this.enter({ level: this.level + 1, game: this.game });
    } else { this.app.go('home'); }
  };

  /* ---------------- 渲染 ---------------- */

  SceneTadpole.prototype.render = function (ctx) {
    var pf = BF.platform, W = pf.width, H = pf.height;

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.bgTop);
    bg.addColorStop(1, T.bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    this.renderHeader(ctx);
    this.renderInstr(ctx);
    this.renderCard(ctx);
    this.renderTadpoles(ctx);
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

  SceneTadpole.prototype.renderHeader = function (ctx) {
    var W = BF.platform.width, top = this.headerY;
    D.fillRound(ctx, this.back.x, this.back.y, this.back.w, this.back.h, 14, '#FFFFFF');
    D.roundRect(ctx, this.back.x + 0.5, this.back.y + 0.5, this.back.w - 1, this.back.h - 1, 14);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    D.icon(ctx, 'back', this.back.x + this.back.w / 2, this.back.y + this.back.h / 2, 16, T.text);
    BF.RuleTip.renderBtn(ctx, this);

    D.text(ctx, '盯蝌蚪', W / 2, top + 17, { size: 18, weight: '700' });
    var sub = '第 ' + this.level + ' 关 · ' + this.N + ' 蝌蚪';
    if (this.markCount > 1) { sub += ' · ' + this.markCount + ' 只被标记'; }
    D.text(ctx, sub, W / 2, top + 38, { size: 11, color: T.textSub, weight: '600' });

    var sec = Math.floor(this.elapsed / 1000);
    D.text(ctx, '⏱ ' + sec + 's', W - 16, top + 16, { size: 13, color: T.textSub, weight: '600', align: 'right' });

    var hs = 13, gap = 4, total = 3;
    var baseX = W - 16 - hs / 2;
    var y = top + 38 + hs / 2;
    for (var i = 0; i < total; i++) {
      var hx = baseX - i * (hs + gap);
      fillHeart(ctx, hx, y, hs, i < this.hearts);
    }
  };

  SceneTadpole.prototype.renderInstr = function (ctx) {
    var txt;
    if (this.phase === 'observe') {
      txt = '记住红圈圈住的 ' + this.markCount + ' 只蝌蚪！';
    } else if (this.phase === 'shuffle') {
      txt = '盯紧被圈的，倒计时结束就停下';
    } else if (this.phase === 'answer') {
      txt = '蝌蚪停下了，点出被标记的（' + this.foundCount + '/' + this.markCount + '）';
    } else { txt = ''; }
    if (txt) {
      D.text(ctx, txt, BF.platform.width / 2, this.instrY, { size: 15, weight: '700', color: T.accent });
    }
    if (this.phase === 'observe') {
      // 观察期倒计时可视：让玩家知道红圈还剩多久消失，便于决定要不要提前跳过
      var Wo = BF.platform.width;
      var barX = 24, barW = Wo - 48, barY = this.instrY + 12, barH = 6;
      var ofrac = U.clamp(this.observeT / this.observeMs, 0, 1);
      D.fillRound(ctx, barX, barY, barW, barH, barH / 2, 'rgba(23,26,31,0.08)');
      var ocol = ofrac > 0.3 ? T.accent : '#E5484D';
      if (ofrac > 0) { D.fillRound(ctx, barX, barY, Math.max(barH, barW * ofrac), barH, barH / 2, ocol); }
      D.text(ctx, '轻触屏幕提前开始游动', Wo / 2, barY + 20, { size: 11, color: T.textSub, weight: '600' });
    } else if (this.phase === 'shuffle') {
      // 游动倒计时可视：明确告诉玩家「还要盯多久 / 什么时候能点」
      var Ws = BF.platform.width;
      var bx = 24, bw = Ws - 48, by = this.instrY + 12, bh = 6;
      var leftMs = Math.max(0, this.swimMs - (this.playT || 0));
      var sfrac = U.clamp(leftMs / this.swimMs, 0, 1);
      D.fillRound(ctx, bx, by, bw, bh, bh / 2, 'rgba(23,26,31,0.08)');
      if (sfrac > 0) { D.fillRound(ctx, bx, by, Math.max(bh, bw * sfrac), bh, bh / 2, T.accent); }
      D.text(ctx, Math.ceil(leftMs / 1000) + ' 秒后停下 · 现在还不能点',
        Ws / 2, by + 20, { size: 11, color: T.textSub, weight: '600' });
    } else if (this.phase === 'answer') {
      var W = BF.platform.width;
      var barX = 24, barW = W - 48, barY = this.instrY + 12, barH = 6;
      var frac = U.clamp(this.answerT / this.answerMs, 0, 1);
      D.fillRound(ctx, barX, barY, barW, barH, barH / 2, 'rgba(23,26,31,0.08)');
      var col = frac > 0.35 ? T.accent : '#E5484D';
      if (frac > 0) { D.fillRound(ctx, barX, barY, Math.max(barH, barW * frac), barH, barH / 2, col); }
    }
  };

  SceneTadpole.prototype.renderCard = function (ctx) {
    D.panel(ctx, this.cardX, this.cardY, this.cardW, this.cardH,
      { radius: 22, fill: '#FBEFC9', shadowBlur: 18, shadowOffsetY: 6 });
    // 细微内描边
    ctx.save();
    ctx.strokeStyle = 'rgba(180,150,60,0.25)';
    ctx.lineWidth = 1.5;
    D.roundRect(ctx, this.cardX + 1, this.cardY + 1, this.cardW - 2, this.cardH - 2, 21);
    ctx.stroke();
    ctx.restore();
  };

  SceneTadpole.prototype.renderTadpoles = function (ctx) {
    var reveal = (this.win || this.fail);

    // 红圈：观察期常亮；进入游动后【渐隐但仍跟随蝌蚪一起移动】，
    // 给眼睛一个「刚才被圈的那只往哪游了」的桥接窗口，避免动画起步瞬间丢失目标。
    // 整个游动倒计时期间玩家不能点选（onUp 仅 answer 期响应），不构成送分。
    var markA = this.markAlpha();
    if (markA > 0) {
      for (var mi = 0; mi < this.tadpoles.length; mi++) {
        if (!this.tadpoles[mi].marked) { continue; }
        var mp = this.posOf(mi);
        ctx.save();
        ctx.globalAlpha = markA;
        drawMarkCircle(ctx, mp.x, mp.y, this.r * 1.75, this.markColor);
        ctx.restore();
      }
    }

    // 画每只蝌蚪（游动倒计时内头朝游动方向持续蜿蜒，倒计时归零后整幅定格）
    for (var i = 0; i < this.N; i++) {
      var p = this.posOf(i);
      var rot = this.rotOf(i);
      var t = this.tadpoles[i];
      // 视频无编号：仅当开启 showNumbers 才显示稳定编号（默认关，靠记长相+追踪，停下后点选）
      var showNum = this.showNumbers ? (i + 1) : -1;
      // 体型微扰：非 uniform，长相各异便于记忆（确定性，由 id 派生）
      var sizeK = 0.90 + ((i * 7) % 5) * 0.045;
      drawTadpole(ctx, p.x, p.y, this.r * sizeK, rot, {
        number: showNum,
        marked: t.marked,
        wag: this.wagOf(i)
      });

      // 提示高亮：脉冲一只尚未找到的被标记蝌蚪
      if (this.hintPulse > 0 && this.hintId >= 0 && i === this.hintId && !this.found[i]) {
        var pulse = 0.5 + 0.5 * Math.sin(this.hintPulse / 120);
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.5 * pulse;
        ctx.strokeStyle = T.gold; ctx.lineWidth = 3;
        D.roundRect(ctx, p.x - this.r * 1.6, p.y - this.r * 1.6, this.r * 3.2, this.r * 3.2, this.r * 0.6);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 已找到的被标记蝌蚪：绿圈 + ✓（作答期与揭晓期都显示，提示进度）
    for (var fi = 0; fi < this.tadpoles.length; fi++) {
      if (!this.found[fi]) { continue; }
      var fp = this.posOf(fi);
      ctx.save();
      ctx.strokeStyle = T.ok; ctx.lineWidth = 3;
      D.roundRect(ctx, fp.x - this.r * 1.5, fp.y - this.r * 1.5, this.r * 3, this.r * 3, this.r * 0.5);
      ctx.stroke();
      ctx.fillStyle = T.ok;
      ctx.font = '700 ' + Math.round(this.r * 0.9) + 'px ' + D.FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✓', fp.x, fp.y + this.r * 0.05);
      ctx.restore();
    }

    // 答错闪烁：在错误蝌蚪上画红圈
    if (this.wrongFlash) {
      var wp = this.posOf(this.wrongFlash.id);
      var wa = U.clamp(this.wrongFlash.t / 600, 0, 1);
      ctx.save();
      ctx.globalAlpha = wa;
      ctx.strokeStyle = '#E5484D'; ctx.lineWidth = 3;
      D.roundRect(ctx, wp.x - this.r * 1.5, wp.y - this.r * 1.5, this.r * 3, this.r * 3, this.r * 0.5);
      ctx.stroke();
      ctx.restore();
    }

    // 揭晓且失败：未找到的被标记蝌蚪画红圈，提示正确位置（不再依赖编号）
    if (reveal && this.fail) {
      for (var ui = 0; ui < this.tadpoles.length; ui++) {
        if (!this.tadpoles[ui].marked || this.found[ui]) { continue; }
        var up = this.posOf(ui);
        ctx.save();
        ctx.strokeStyle = this.markColor; ctx.lineWidth = 3;
        D.roundRect(ctx, up.x - this.r * 1.6, up.y - this.r * 1.6, this.r * 3.2, this.r * 3.2, this.r * 0.5);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  SceneTadpole.prototype.renderHintButton = function (ctx) {
    var b = this.hintBtn;
    var active = (this.phase === 'answer' && this.foundCount < this.markCount);
    D.button(ctx, b, '提示', {
      fill: active ? U.rgba(T.accent, 0.12) : '#F0F2F5',
      color: active ? T.accent : T.textSub,
      icon: 'hint', iconColor: active ? T.accent : T.textSub,
      disabled: !active
    });
  };

  SceneTadpole.prototype.renderToast = function (ctx) {
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

  SceneTadpole.prototype.overlayLayout = function () {
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

  SceneTadpole.prototype.renderWin = function (ctx) {
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
    var rh = { x: cx + (ob.home.x - card.x) * k, y: cy + (ob.home.y - card.y) * k, w: ob.home.w * k, h: ob.home.h * k };
    var ra = { x: cx + (ob.action.x - card.x) * k, y: cy + (ob.action.y - card.y) * k, w: ob.action.w * k, h: ob.action.h * k };
    var pr = this.win.press;
    var last = this.level >= BF.games.tadpole.TOTAL;
    D.button(ctx, rh, '返回首页', { fill: pr === 'home' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15 });
    D.button(ctx, ra, last ? '完成' : '下一关',
      { fill: pr === 'action' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15, shadow: true });
    ctx.restore();
  };

  SceneTadpole.prototype.renderFail = function (ctx) {
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
    D.text(ctx, '3 颗心用完了，再试一次吧', cx + cw / 2, cy + 92, { size: 13, color: T.textSub });
    if (this.showNumbers) {
      var nums = this.markedIds.map(function (v) { return (v + 1); }).join('、');
      D.text(ctx, '被标记的是 ' + nums + ' 号',
        cx + cw / 2, cy + 116, { size: 12, color: T.textSub });
    } else {
      D.text(ctx, '红圈标出的就是被标记的蝌蚪',
        cx + cw / 2, cy + 116, { size: 12, color: T.textSub });
    }

    var k = cw / card.w;
    var rh = { x: cx + (ob.home.x - card.x) * k, y: cy + (ob.home.y - card.y) * k, w: ob.home.w * k, h: ob.home.h * k };
    var ra = { x: cx + (ob.action.x - card.x) * k, y: cy + (ob.action.y - card.y) * k, w: ob.action.w * k, h: ob.action.h * k };
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

  /** 红虚线圈（观察期临时标注被标记蝌蚪） */
  function drawMarkCircle(ctx, x, y, r, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /**
   * 一只蝌蚪（还原参考视频造型）：小小的水滴形黑头 + 一条细长、末端渐细、
   * S 形「行波」摆动的尾巴；头朝游动方向、尾巴拖后。纯矢量（arc + lineTo 多边形填充）。
   * opt.wag = 摆尾相位（行波沿尾巴传播）。
   */
  function drawTadpole(ctx, x, y, r, rot, opt) {
    opt = opt || {};
    var phase = opt.wag || 0;
    var col = '#2B2F38';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);

    // ---- 尾巴：中心线按行波弯曲，宽度从根部渐细到尾尖，构造多边形填充 ----
    // 注：不做浅色光晕/描边——多只蝌蚪重叠时后画的浅圈会切在前面那只尾巴上形成缺口。
    // 视频里蝌蚪本就是纯黑一体，黄底对比已足够。
    var L = r * 3.3, seg = 12;
    var up = [], dn = [];
    for (var k = 0; k <= seg; k++) {
      var u = k / seg;                                  // 0 根部 → 1 尾尖
      var px = -r * 0.40 - L * u;
      var py = Math.sin(phase - u * 3.6) * r * (0.08 + 0.62 * u);  // 越靠尾尖摆幅越大
      var w = r * 0.22 * Math.pow(1 - u, 1.3) + 0.28;              // 细如线、渐细到近尖
      up.push({ x: px, y: py - w });
      dn.push({ x: px, y: py + w });
    }
    ctx.beginPath();
    ctx.moveTo(up[0].x, up[0].y);
    for (k = 1; k <= seg; k++) { ctx.lineTo(up[k].x, up[k].y); }
    for (k = seg; k >= 0; k--) { ctx.lineTo(dn[k].x, dn[k].y); }
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();

    // ---- 头：小小的略扁水滴（纯黑），压在尾巴根部与光晕之上，衔接干净 ----
    ctx.save();
    ctx.scale(1, 0.9);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.restore();

    ctx.restore();

    // 编号（开启 showNumbers 时画在头顶，不随旋转）
    if (opt.number && opt.number > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = '700 ' + Math.round(r * 0.78) + 'px ' + BF.draw.FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(opt.number), x, y - r * 1.15);
      ctx.restore();
    }
  }

  BF.SceneTadpole = SceneTadpole;
})();
