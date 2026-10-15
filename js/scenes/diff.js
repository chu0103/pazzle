/**
 * diff.js —— 第 4 款游戏「图片找不同」玩法场景
 *
 * 上下两张图（A 原图 / B 有改动），点中 B 里每一处不同即过关。
 * 与前三款不同，这里不需要棋盘/拖拽，只做「点按命中差异矩形」的判定。
 *
 * 差异矩形是**归一化**的（u/v/uw/vh ∈ 0~1），判定与渲染都乘图片矩形的宽高，
 * 因此任意尺寸的图共用同一套代码。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.SceneDiff) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;

  // 命中容差：差异矩形四周再放宽这么多（归一化），手指点偏一点也算中
  var TOL = 0.045;

  function SceneDiff(app) {
    this.app = app;
    this.fadeIn = 1;
    this.t = 0;
    this.win = null;
    this.toast = null;
    this.hintFx = null;
    this.wrongFx = null;
    this.pickDiff = false;   // 是否停在「难度自选」首屏（与 rush / blocks 共用 BF.DiffPick）
    this.pickCards = null;
  }

  SceneDiff.prototype.enter = function (params) {
    params = params || {};
    // 难度自选首屏：只选难度，不加载图对（找不同会异步加载图片，选难度阶段不该触发）
    if (params.pickDiff) { return BF.DiffPick.enter(this, params); }
    this.pickDiff = false;
    this.isDaily = !!params.daily;
    this.game = params.game || 'diff';
    this.level = params.level || 1;

    var meta = BF.games && (BF.games[this.game] || BF.games.diff);
    if (!meta) { throw new Error('未注册的游戏: ' + this.game); }
    this.meta = meta;

    this.puzzle = this.isDaily ? meta.buildDaily() : meta.build(this.level);
    this.t = 0; this.fadeIn = 1;
    this.win = null; this.toast = null; this.hintFx = null; this.wrongFx = null;
    this.pressBtn = null; this.tapCand = null;

    // 命中状态：found[i] = true 表示第 i 处差异已被找到
    this.found = {};
    this.foundCount = 0;
    this.foundPop = {};     // 找到时的弹一下动画（1→0 递减）
    this.mistakes = 0;
    this.hinted = {};       // 提示过的差异（避免重复提示同一处）

    // 图片（异步加载）。没加载完时退化成纯色块，逻辑测试也不需要真图。
    this.imgA = null; this.imgB = null; this.imgErr = null;
    this.loadImages();
    this.layout();
    // 「玩法说明」弹框：每次进这款游戏的第一个关卡时弹一次（勾过「不再提示」则不弹）
    if (BF.RuleTip.shouldShow(this.game, this)) { BF.RuleTip.enter(this, params); }
    return this;
  };

  SceneDiff.prototype.loadImages = function () {
    var self = this, p = this.puzzle;
    this.imgErr = null;
    if (!p.a || !p.b) { this.imgErr = '没有可用图对'; return; }
    var aSrc = p.a, bSrc = p.b;
    BF.Diffs.get(aSrc, function (err, img) {
      // 只在"还停在同一个关卡"时写状态，避免切关后旧回调污染新题面
      if (self.puzzle.a !== aSrc) { return; }
      if (err || !img) { self.imgErr = String(err || '加载失败'); return; }
      self.imgA = img;
    });
    BF.Diffs.get(bSrc, function (err, img) {
      if (self.puzzle.b !== bSrc) { return; }
      if (err || !img) { self.imgErr = String(err || '加载失败'); return; }
      self.imgB = img;
    });
  };

  /* ---------------- 布局 ---------------- */

  SceneDiff.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var top = pf.safeTop;

    this.headerH = 52;
    this.headerY = top;
    this.back = { x: 12, y: top + 6, w: 40, h: 40 };

    var availTop = top + this.headerH + 6;
    var footerH = 86 + pf.safeBottom;
    var availBottom = H - footerH;
    var availH = availBottom - availTop;

    var gap = 10;
    // 两张正方形图上下并排；取"宽度"与"分半高度"里更小的那个，小屏也不会溢出
    var S = Math.floor(Math.min(W - 26, (availH - gap) / 2));
    if (S < 120) { S = 120; }
    var totalH = S * 2 + gap;
    var y0 = availTop + Math.max(0, (availH - totalH) / 2);
    var x0 = (W - S) / 2;
    this.rectA = { x: x0, y: y0, w: S, h: S };
    this.rectB = { x: x0, y: y0 + S + gap, w: S, h: S };
    this.imgGap = gap;

    var bw = (W - 24 - 10) / 2;
    this.btns = [
      { x: 12, y: H - pf.safeBottom - 62, w: bw, h: 48, key: 'hint', label: '提示', icon: 'hint' },
      { x: 12 + bw + 10, y: H - pf.safeBottom - 62, w: bw, h: 48, key: 'reset', label: '重来', icon: 'reset' }
    ];
  };

  /* ---------------- 更新 ---------------- */

  SceneDiff.prototype.update = function (dt) {
    if (this.showRule) { return BF.RuleTip.update(this, dt); }
    this.t += dt;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) { this.toast = null; } }
    if (this.hintFx) { this.hintFx.t -= dt; if (this.hintFx.t <= 0) { this.hintFx = null; } }
    if (this.wrongFx) { this.wrongFx.t -= dt; if (this.wrongFx.t <= 0) { this.wrongFx = null; } }
    if (this.pickDiff) { return; }               // 难度首屏不跑玩法状态机
    for (var k in this.foundPop) {
      if (this.foundPop.hasOwnProperty(k)) {
        this.foundPop[k] -= dt / 320;
        if (this.foundPop[k] <= 0) { delete this.foundPop[k]; }
      }
    }
    // 注意：不能清 win.press —— 按下与抬起之间必然夹着帧，清了 onUp 就读不到，
    // 表现就是「重玩」「下一关」点了没反应（前三款都踩过这个坑）。
    if (this.win) { this.win.t += dt; }
  };

  /* ---------------- 输入 ---------------- */

  SceneDiff.prototype.onDown = function (x, y) {
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
    // 点按图片区：记录候选，真正判定放到 onUp（与拖拽/误触区分）
    if (U.pointInRect(x, y, this.rectA) || U.pointInRect(x, y, this.rectB)) {
      this.tapCand = { x: x, y: y };
    }
  };

  SceneDiff.prototype.onUp = function (x, y) {
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
    if (this.tapCand) {
      this.tapCand = null;
      // 轻点：命中哪张图就按那张图的坐标换算
      var rect = null;
      if (U.pointInRect(x, y, this.rectA)) { rect = this.rectA; }
      else if (U.pointInRect(x, y, this.rectB)) { rect = this.rectB; }
      if (rect) { this.handleTap(x, y, rect); }
      return;
    }
  };

  /** 把点按坐标换算成图片内的归一化坐标，判定命中哪处差异 */
  SceneDiff.prototype.handleTap = function (x, y, rect) {
    if (this.win) { return; }
    var u = (x - rect.x) / rect.w;
    var v = (y - rect.y) / rect.h;
    var diffs = this.puzzle.diffs;
    for (var i = 0; i < diffs.length; i++) {
      if (this.found[i]) { continue; }
      var d = diffs[i];
      if (u >= d.u - TOL && u <= d.u + d.uw + TOL &&
          v >= d.v - TOL && v <= d.v + d.vh + TOL) {
        this.found[i] = true;
        this.foundPop[i] = 1;
        this.foundCount++;
        BF.platform.vibrate('light');
        if (this.foundCount >= this.puzzle.total) { this.onSolved(); }
        return;
      }
    }
    // 没中：记一次失误，在点击处画个叉
    this.mistakes++;
    this.wrongFx = { x: x, y: y, t: 620 };
    BF.platform.vibrate('medium');
  };

  SceneDiff.prototype.doAction = function (key) {
    if (key === 'hint') {
      var d = this.puzzle.diffs, pick = -1, i;
      for (i = 0; i < d.length; i++) {
        if (!this.found[i] && !this.hinted[i]) { pick = i; break; }
      }
      if (pick < 0) {
        // 都被提示过或都找到了：退而求其次，提示一处还没找到的
        for (i = 0; i < d.length; i++) { if (!this.found[i]) { pick = i; break; } }
      }
      if (pick < 0) { this.showToast('全部不同都已找到'); return; }
      this.hinted[pick] = true;
      this.hintFx = { idx: pick, t: 2600 };
      this.showToast('已标出一处不同');
    } else if (key === 'reset') {
      this.found = {}; this.foundCount = 0; this.foundPop = {};
      this.mistakes = 0; this.hinted = {}; this.hintFx = null; this.wrongFx = null;
      this.showToast('已重来');
    }
  };

  SceneDiff.prototype.showToast = function (txt) { this.toast = { text: txt, t: 2000 }; };

  SceneDiff.prototype.onSolved = function () {
    var stars = this.mistakes === 0 ? 3 : (this.mistakes <= 2 ? 2 : 1);
    if (this.isDaily) { BF.Save.clearDaily(stars); }
    else { BF.Save.clear(this.game, this.level, stars); }
    this.win = { t: 0, stars: stars, press: null };
    BF.platform.vibrate('heavy');
  };

  SceneDiff.prototype.next = function () {
    if (this.isDaily) { this.app.go('home'); return; }
    if (this.level >= this.meta.TOTAL) { this.app.go('levels', { game: this.game }); return; }
    BF.RuleTip.skipOnce(this);   // 关内进下一关不重复弹规则
    this.enter({ game: this.game, level: this.level + 1 });
  };

  /* ---------------- 渲染 ---------------- */

  SceneDiff.prototype.render = function (ctx) {
    var pf = BF.platform, W = pf.width, H = pf.height;

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.bgTop);
    bg.addColorStop(1, T.bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 难度自选首屏：必须**先于** renderHeader 分流 —— renderHeader 要读 this.puzzle.total，
    // 而首屏阶段没有题目（puzzle = null），顺序反了会直接抛错。
    if (this.pickDiff) {
      BF.DiffPick.render(ctx, this);
      this.renderFade(ctx, W, H);
      return;
    }

    this.renderHeader(ctx);

    // 两张图：A 上、B 下。用照片切片原语画（带圆角/描边/投影），缺图时退化成色块。
    this.paintImage(ctx, this.rectA, this.imgA, 'A');
    this.paintImage(ctx, this.rectB, this.imgB, 'B');

    // 命中/提示标记：两张图上都要画（差异在两图同一归一化位置）
    this.renderMarks(ctx, this.rectA);
    this.renderMarks(ctx, this.rectB);

    // 失误叉
    if (this.wrongFx) {
      var a = Math.min(1, this.wrongFx.t / 620);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = U.rgba(T.warn, 0.95);
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      var s2 = 11;
      ctx.beginPath();
      ctx.moveTo(this.wrongFx.x - s2, this.wrongFx.y - s2);
      ctx.lineTo(this.wrongFx.x + s2, this.wrongFx.y + s2);
      ctx.moveTo(this.wrongFx.x + s2, this.wrongFx.y - s2);
      ctx.lineTo(this.wrongFx.x - s2, this.wrongFx.y + s2);
      ctx.stroke();
      ctx.restore();
    }

    this.renderFooter(ctx);
    this.renderToast(ctx);
    if (this.win) { this.renderWin(ctx); }

    this.renderFade(ctx, W, H);
    // 规则弹框画在最上层（主体照常画，被遮罩压暗当背景）
    if (this.showRule) { BF.RuleTip.render(ctx, this); }
  };

  /** 入场白闪（首屏与玩法共用） */
  SceneDiff.prototype.renderFade = function (ctx, W, H) {
    if (this.fadeIn > 0) {
      ctx.save();
      ctx.globalAlpha = this.fadeIn * 0.85;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  };

  /** 画一张图（缺图时画带 A/B 字样的色块兜底） */
  SceneDiff.prototype.paintImage = function (ctx, rect, img, tag) {
    var ok = false;
    if (img) {
      ok = D.photoSlice(ctx, rect.x, rect.y, rect.w, rect.h, img,
        { u: 0, v: 0, uw: 1, vh: 1 },
        { radius: Math.max(6, rect.w * 0.035), stroke: true, shadow: true });
    }
    if (!ok) {
      D.tile(ctx, rect.x, rect.y, rect.w, rect.h, this.puzzle.color,
        { radius: Math.max(6, rect.w * 0.035), highlight: false });
      D.text(ctx, tag, rect.x + rect.w / 2, rect.y + rect.h / 2,
        { size: 22, color: 'rgba(255,255,255,0.85)', weight: '700' });
    } else {
      // 左上角小角标，明确哪张是"改动图"（玩家在 B 上找不同）
      D.text(ctx, tag, rect.x + 14, rect.y + 14,
        { size: 12, color: 'rgba(255,255,255,0.92)', weight: '700', align: 'left' });
    }
  };

  /** 在给定图片矩形上画"已找到"的绿圈 / "提示中"的脉冲圈 */
  SceneDiff.prototype.renderMarks = function (ctx, rect) {
    var d = this.puzzle.diffs;
    for (var i = 0; i < d.length; i++) {
      var cx = rect.x + (d[i].u + d[i].uw / 2) * rect.w;
      var cy = rect.y + (d[i].v + d[i].vh / 2) * rect.h;
      var rr = Math.min(d[i].uw * rect.w, d[i].vh * rect.h) * 0.5 + 8;

      if (this.found[i]) {
        var pop = this.foundPop[i] || 0;
        var scale = 1 + 0.35 * pop;   // 刚找到时弹一下
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, rr * scale, 0, Math.PI * 2);
        ctx.fillStyle = U.rgba(T.ok, 0.14);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = U.rgba(T.ok, 0.95);
        ctx.stroke();
        ctx.restore();
      } else if (this.hintFx && this.hintFx.idx === i) {
        var pulse = 0.5 + 0.5 * Math.sin(this.hintFx.t / 110);
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.55 * pulse;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = U.rgba(T.accent, 1);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  SceneDiff.prototype.renderHeader = function (ctx) {
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

    var total = this.puzzle.total;
    var left = Math.max(0, total - this.foundCount);
    D.text(ctx, '找到 ' + this.foundCount + ' / ' + total, W - 16, this.headerY + 20,
      { size: 12.5, color: left === 0 ? T.ok : T.textSub, weight: '700', align: 'right' });
    D.text(ctx, '点错 ' + this.mistakes + ' 次', W - 16, this.headerY + 38,
      { size: 11, color: T.textSub, align: 'right', alpha: 0.85 });
  };

  SceneDiff.prototype.renderFooter = function (ctx) {
    for (var i = 0; i < this.btns.length; i++) {
      var b = this.btns[i];
      D.button(ctx, b, b.label, { fill: '#FFFFFF', color: T.text, icon: b.icon, iconColor: T.textSub });
    }
    // 操作提示：塞在「B 图底边」与「按钮顶边」之间的空隙正中。
    // 早先写成固定高度 H-safeBottom-74，小屏上正好压在 B 图的圆角上（截图才发现）。
    if (this.foundCount === 0 && !this.win) {
      var gapTop = this.rectB.y + this.rectB.h;
      var gapBottom = this.btns[0].y;
      if (gapBottom - gapTop >= 14) {
        D.text(ctx, '两张图里藏着 ' + this.puzzle.total + ' 处不同 · 点按即可标记',
          BF.platform.width / 2, gapTop + (gapBottom - gapTop) / 2,
          { size: 11, color: T.textSub, alpha: 0.9 });
      }
    }
  };

  SceneDiff.prototype.renderToast = function (ctx) {
    if (!this.toast) { return; }
    var pf = BF.platform;
    var a = Math.min(1, this.toast.t / 320);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 13px ' + D.FONT;
    var w = ctx.measureText(this.toast.text).width + 32;
    var x = (pf.width - w) / 2, y = this.rectB.y + this.rectB.h - 58;
    D.fillRound(ctx, x, y, w, 38, 19, 'rgba(28,31,36,0.88)');
    D.text(ctx, this.toast.text, pf.width / 2, y + 19.5, { size: 13, color: '#FFFFFF', weight: '600' });
    ctx.restore();
  };

  SceneDiff.prototype.overlayLayout = function () {
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

  SceneDiff.prototype.renderWin = function (ctx) {
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
    D.text(ctx, this.isDaily ? '今日挑战完成' : '全部找到！', cx + cw / 2, cy + 44,
      { size: 21, weight: '700' });

    var starY = cy + 98, r = 22, gapx = r * 2.5;
    for (var i = 0; i < 3; i++) {
      var on = i < this.win.stars;
      var delay = U.clamp((this.win.t - 180 - i * 130) / 220, 0, 1);
      var sc = on ? (0.6 + 0.4 * U.easeOutCubic(delay)) * (1 + 0.25 * Math.sin(Math.PI * delay)) : 1;
      D.star(ctx, cx + cw / 2 + (i - 1) * gapx, starY, r * sc, 0.46,
        on ? T.gold : 'rgba(23,26,31,0.10)', 'rgba(23,26,31,0.10)');
    }
    D.text(ctx, '共 ' + this.puzzle.total + ' 处不同 · 点错 ' + this.mistakes + ' 次',
      cx + cw / 2, cy + 150, { size: 12.5, color: T.textSub });

    var k = cw / card.w;
    var ra = mapRect(ob.again, card, cx, cy, k);
    var rn = mapRect(ob.next, card, cx, cy, k);
    var pr = this.win.press;

    D.button(ctx, ra, '重玩', { fill: pr === 'again' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15 });
    var last = !this.isDaily && this.level >= this.meta.TOTAL;
    D.button(ctx, rn, this.isDaily ? '返回首页' : (last ? '返回关卡' : '下一关'),
      { fill: pr === 'next' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15, shadow: true });
    ctx.restore();
  };

  BF.SceneDiff = SceneDiff;
})();
