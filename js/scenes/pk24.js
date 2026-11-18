/**
 * pk24.js —— 第 13 款游戏「24点」玩法场景（无尽随机）
 *
 * 交互（逐步合并）：点一张牌 → 点运算符 → 点另一张牌，两张合并成一张带中间结果的新牌；
 * 重复到只剩 1 张，若值 = 24 就过关。减/除按点击顺序算（先点的当被减/被除数）。
 * 整除规则：除法只在能整除时进行，否则该步不可用（toast 提示换算法）。
 *
 * 底部三按钮：撤销（回退上一步合并）/ 重置（还原本副 4 张原牌）/ 提示（给出一种解的表达式）。
 * 过关按用时评星（用提示会降星），进度存无尽统计（已解题数 / 最佳星级）。
 *
 * 结构照抄 bottle.js（enter/layout/update/onDown/onUp/render + 过关弹窗 + 底部按钮 + RuleTip 接入）。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.ScenePk24) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;
  var Gen = BF.Pk24Gen;

  // 评星时间线（毫秒）：越快星越高；用提示会额外降星
  var T_STAR3 = 45000;   // ≤45s → 3★
  var T_STAR2 = 90000;   // ≤90s → 2★（否则 1★）

  function ScenePk24(app) {
    this.app = app;
    this.fadeIn = 1;
    this.t = 0;
    this.win = null;
    this.toast = null;
    this.selected = -1;
    this.pendingOp = null;
    this.pressBtn = null;
    this.pressOp = null;
    this.cards = [];
    this.initial = [];
    this.initialVals = [];
    this.history = [];
    this.elapsed = 0;
    this.hintsUsed = 0;
    this.solution = null;
    this.hintExpr = null;
    this.tokenRects = [];
  }

  /* ---------------- 发牌 / 状态 ---------------- */

  ScenePk24.prototype.buildTokens = function (vals) {
    var suits = Gen.SUITS;
    var arr = [];
    for (var i = 0; i < vals.length; i++) {
      arr.push({
        id: i,
        v: vals[i],
        expr: String(vals[i]),
        suit: suits[i % suits.length]   // 花色仅装饰原始牌
      });
    }
    return arr;
  };

  ScenePk24.prototype.cloneCards = function (cards) {
    return cards.map(function (c) {
      return { id: c.id, v: c.v, expr: c.expr, suit: c.suit };
    });
  };

  ScenePk24.prototype.enter = function (params) {
    params = params || {};
    this.game = 'pk24';
    this.isDaily = !!params.daily;
    this.level = params.level || 1;

    this.newDeal(true);
    this.fadeIn = 1;
    this.t = 0;
    this.layout();
    // 玩法说明弹框：进这款游戏第一次时弹一次
    if (BF.RuleTip.shouldShow(this.game, this)) { BF.RuleTip.enter(this, params); }
    return this;
  };

  /** 发一副新牌（或重开本副）。first=true 时不重置无尽统计 */
  ScenePk24.prototype.newDeal = function (keepStats) {
    var vals = this.isDaily ? BF.games.pk24.buildDaily().cards : Gen.randomDeal();
    this.initialVals = vals.slice();
    this.cards = this.buildTokens(vals);
    this.initial = this.cloneCards(this.cards);
    this.history = [];
    this.selected = -1;
    this.pendingOp = null;
    this.elapsed = 0;
    this.hintsUsed = 0;
    this.hintExpr = null;
    this.solution = Gen.solve(vals);
    this.win = null;
    this.toast = null;
    this.relayoutTokens();
  };

  ScenePk24.prototype.relayoutTokens = function () {
    // 命中盒在 render 中按当前张数实时算，这里只是占位（保证 onDown 首帧有值）
    this.computeTokenRects();
  };

  /* ---------------- 布局 ---------------- */

  ScenePk24.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var top = pf.safeTop;

    this.headerH = 52;
    this.headerY = top;
    this.back = { x: 12, y: top + 6, w: 40, h: 40 };
    this.ruleBtn = BF.RuleTip.btnRect(this);

    var footerH = 86 + pf.safeBottom;
    var opH = 54;
    var opGap = 10;
    var opY = H - footerH - opH - 12;

    // 运算符行（4 个按钮，居中）
    var opMaxW = Math.min(W - 32, 360);
    var opW = (opMaxW - opGap * 3) / 4;
    var opX0 = (W - (opW * 4 + opGap * 3)) / 2;
    this.opBtns = [];
    for (var o = 0; o < Gen.OPS.length; o++) {
      this.opBtns.push({ x: opX0 + o * (opW + opGap), y: opY, w: opW, h: opH, op: Gen.OPS[o] });
    }

    // 底部三按钮（撤销 / 重置 / 提示）
    var bw = (W - 24 - 10 * 2) / 3;
    this.btns = [
      { x: 12, y: H - pf.safeBottom - 62, w: bw, h: 48, key: 'undo', label: '撤销', icon: 'undo' },
      { x: 12 + bw + 10, y: H - pf.safeBottom - 62, w: bw, h: 48, key: 'reset', label: '重置', icon: 'reset' },
      { x: 12 + (bw + 10) * 2, y: H - pf.safeBottom - 62, w: bw, h: 48, key: 'hint', label: '提示', icon: 'hint' }
    ];

    // 牌区（标题下到运算符行上）
    this.areaTop = top + this.headerH + 10;
    this.areaBot = opY - 12;

    this.computeTokenRects();
  };

  /** 按当前张数实时算每张牌的命中盒（张数会变，每帧重算最稳） */
  ScenePk24.prototype.computeTokenRects = function () {
    var pf = BF.platform, W = pf.width;
    var n = this.cards.length;
    if (!n) { this.tokenRects = []; return; }
    var areaTop = this.areaTop, areaBot = this.areaBot;
    var areaH = Math.max(60, areaBot - areaTop);
    var gap = 10;
    var cw = (W - 32 - (n - 1) * gap) / n;
    if (n === 1) { cw = Math.min(150, W * 0.46); }
    cw = Math.max(60, Math.min(cw, n === 1 ? 150 : 96));
    var ch = Math.min(areaH * 0.82, cw * 1.18, 150);
    ch = Math.max(80, ch);
    var totalW = cw * n + gap * (n - 1);
    var x0 = (W - totalW) / 2;
    var y = areaTop + (areaH - ch) / 2;
    this.tokenRects = [];
    for (var i = 0; i < n; i++) {
      this.tokenRects.push({ x: x0 + i * (cw + gap), y: y, w: cw, h: ch });
    }
  };

  /* ---------------- 更新 ---------------- */

  ScenePk24.prototype.update = function (dt) {
    if (this.showRule) { return BF.RuleTip.update(this, dt); }
    this.t += dt;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) { this.toast = null; } }
    if (this.win) { this.win.t += dt; return; }
    // 计时：仅在未过关、未弹规则时跑
    this.elapsed += dt;
  };

  /* ---------------- 输入 ---------------- */

  ScenePk24.prototype.onDown = function (x, y) {
    if (this.showRule) { BF.RuleTip.onDown(this, x, y); return; }
    if (!this.win && !this.isDaily && !this.pickDiff &&
        U.pointInRect(x, y, BF.RuleTip.btn(this))) { BF.RuleTip.enter(this, { force: true }); return; }
    if (this.win) {
      var ob = this.overlayLayout();
      this.win.press = null;
      if (U.pointInRect(x, y, ob.next)) { this.win.press = 'next'; return; }
      if (U.pointInRect(x, y, ob.home)) { this.win.press = 'home'; return; }
      return;
    }
    if (U.pointInRect(x, y, this.back)) { this.app.go('home'); return; }
    for (var i = 0; i < this.btns.length; i++) {
      if (U.pointInRect(x, y, this.btns[i])) { this.pressBtn = this.btns[i]; return; }
    }
    for (i = 0; i < this.opBtns.length; i++) {
      if (U.pointInRect(x, y, this.opBtns[i])) { this.pressOp = this.opBtns[i]; return; }
    }
    // 点牌（命中盒用最近一次 render 算出的 tokenRects）
    this.computeTokenRects();
    for (i = 0; i < this.tokenRects.length; i++) {
      if (U.pointInRect(x, y, this.tokenRects[i])) { this.tapCard(i); return; }
    }
  };

  ScenePk24.prototype.onUp = function (x, y) {
    if (this.showRule) { BF.RuleTip.onUp(this, x, y); return; }
    if (this.win) {
      var ob = this.overlayLayout();
      var hit = this.win.press;
      this.win.press = null;
      if (hit === 'next' && U.pointInRect(x, y, ob.next)) { BF.RuleTip.skipOnce(this); this.newDeal(false); return; }
      if (hit === 'home' && U.pointInRect(x, y, ob.home)) { this.app.go('home'); return; }
      return;
    }
    if (this.pressBtn) {
      var btn = this.pressBtn; this.pressBtn = null;
      if (U.pointInRect(x, y, btn)) { this.doAction(btn.key); }
      return;
    }
    if (this.pressOp) {
      var ob2 = this.pressOp; this.pressOp = null;
      if (U.pointInRect(x, y, ob2)) { this.tapOp(ob2.op); }
      return;
    }
  };

  ScenePk24.prototype.onMove = function () { /* 24点无需拖动 */ };

  ScenePk24.prototype.tapCard = function (i) {
    if (this.selected === i) {                 // 再点自己 → 取消选择
      this.selected = -1; this.pendingOp = null; return;
    }
    if (this.selected >= 0 && this.pendingOp) { // 已选牌+已选运算符 → 合并
      this.merge(this.selected, this.pendingOp, i);
      return;
    }
    if (this.selected >= 0 && !this.pendingOp) { // 已选牌但还没选运算符 → 改选这张
      this.selected = i; return;
    }
    this.selected = i;                          // 第一次选牌
  };

  ScenePk24.prototype.tapOp = function (op) {
    if (this.selected < 0) { this.showToast('先选一张牌'); return; }
    this.pendingOp = op;
  };

  /** 合并第 i 张与第 j 张（op 作用于 i 为先算方） */
  ScenePk24.prototype.merge = function (i, op, j) {
    if (i === j) { return; }
    var a = this.cards[i], b = this.cards[j];
    var r = Gen.applyOp(a.v, b.v, op);
    if (r === null) {
      this.pendingOp = null;       // 除不尽：清运算符，保留选牌让用户换算法
      this.showToast(op === '÷' ? '除不尽，换种算法' : '这一步算不了');
      return;
    }
    // 存历史（撤销用）
    this.history.push(this.cloneCards(this.cards));
    // 删两张（先删大下标，保下标有效）
    var hi = Math.max(i, j), lo = Math.min(i, j);
    var merged = {
      id: 100 + this.history.length,
      v: r,
      expr: '(' + a.expr + op + b.expr + ')',
      suit: null
    };
    this.cards.splice(hi, 1);
    this.cards.splice(lo, 1);
    this.cards.push(merged);
    this.selected = -1;
    this.pendingOp = null;
    BF.platform.vibrate('light');

    if (this.cards.length === 1) {
      if (this.cards[0].v === 24) { this.onSolved(); }
      else { this.showToast('= ' + this.cards[0].v + '，不是 24，点撤销或重置再试'); }
    }
  };

  ScenePk24.prototype.doAction = function (key) {
    if (key === 'undo') {
      if (!this.history.length) { this.showToast('没有可撤销的步骤'); return; }
      this.cards = this.history.pop();
      this.selected = -1; this.pendingOp = null;
    } else if (key === 'reset') {
      this.cards = this.cloneCards(this.initial);
      this.history = [];
      this.selected = -1; this.pendingOp = null;
      this.elapsed = 0;
      this.showToast('已重置本副牌');
    } else if (key === 'hint') {
      if (!this.solution) { this.showToast('这副牌暂无解，点重置换新副'); return; }
      this.hintsUsed++;
      this.hintExpr = this.solution + ' = 24';
      this.showToast('已显示一种解法');
    }
  };

  ScenePk24.prototype.showToast = function (txt) { this.toast = { text: txt, t: 1800 }; };

  /* ---------------- 评星 / 存档 ---------------- */

  ScenePk24.prototype.starsFor = function (elapsed, hintsUsed) {
    var s = elapsed <= T_STAR3 ? 3 : (elapsed <= T_STAR2 ? 2 : 1);
    if (hintsUsed >= 1) { s = Math.min(s, 2); }
    if (hintsUsed >= 2) { s = Math.min(s, 1); }
    return s;
  };

  ScenePk24.prototype.onSolved = function () {
    var stars = this.starsFor(this.elapsed, this.hintsUsed);
    var ex = BF.Save.extraOf('pk24');
    ex.solved = (ex.solved || 0) + 1;
    if (!ex.bestStars || stars > ex.bestStars) { ex.bestStars = stars; }
    if (!ex.bestTime || this.elapsed < ex.bestTime) { ex.bestTime = this.elapsed; }
    BF.Save.flush();
    this.win = { t: 0, stars: stars, press: null, sec: Math.round(this.elapsed / 10) / 100 };
    BF.platform.vibrate('heavy');
  };

  /* ---------------- 渲染 ---------------- */

  ScenePk24.prototype.render = function (ctx) {
    var pf = BF.platform, W = pf.width, H = pf.height;

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.bgTop);
    bg.addColorStop(1, T.bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    this.renderHeader(ctx);
    this.computeTokenRects();
    this.renderTokens(ctx);
    this.renderOperators(ctx);
    this.renderFooter(ctx);
    this.renderHint(ctx);
    this.renderToast(ctx);
    if (this.win) { this.renderWin(ctx); }

    if (this.fadeIn > 0) {
      ctx.save();
      ctx.globalAlpha = this.fadeIn * 0.85;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (this.showRule) { BF.RuleTip.render(ctx, this); }
  };

  ScenePk24.prototype.renderHeader = function (ctx) {
    var pf = BF.platform, W = pf.width;
    D.fillRound(ctx, this.back.x, this.back.y, this.back.w, this.back.h, 14, '#FFFFFF');
    D.roundRect(ctx, this.back.x + 0.5, this.back.y + 0.5, this.back.w - 1, this.back.h - 1, 14);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    D.icon(ctx, 'back', this.back.x + this.back.w / 2, this.back.y + this.back.h / 2, 16, T.text);
    BF.RuleTip.renderBtn(ctx, this);

    D.text(ctx, '24点', W / 2, this.headerY + 20, { size: 19, weight: '700' });
    var solved = (BF.Save.extraOf('pk24').solved) || 0;
    D.text(ctx, '已解 ' + solved + ' 题', W / 2, this.headerY + 40,
      { size: 11.5, color: T.textSub });

    var sec = Math.floor(this.elapsed / 1000);
    D.text(ctx, this.win ? '完成' : ('⏱ ' + sec + 's'), W - 16, this.headerY + 20,
      { size: 13, color: T.textSub, weight: '600', align: 'right' });
    var prog = this.cards.length;
    D.text(ctx, prog + ' 张待合并', W - 16, this.headerY + 38,
      { size: 11, color: T.textSub, align: 'right', alpha: 0.85 });
  };

  ScenePk24.prototype.renderTokens = function (ctx) {
    for (var i = 0; i < this.tokenRects.length; i++) {
      this.drawToken(ctx, this.tokenRects[i], this.cards[i], this.selected === i);
    }
  };

  ScenePk24.prototype.drawToken = function (ctx, r, tok, selected) {
    if (!tok) { return; }
    var isResult = tok.suit == null;
    var x = r.x, y = r.y, w = r.w, h = r.h;
    var done = this.cards.length === 1 && this.cards[0].v === 24;

    // 卡片底
    D.panel(ctx, x, y, w, h, {
      radius: 14,
      fill: done ? U.rgba(T.ok, 0.12) : '#FFFFFF',
      shadowBlur: selected ? 14 : 8, shadowOffsetY: selected ? 4 : 3
    });
    if (selected) {
      ctx.save();
      D.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 14);
      ctx.strokeStyle = T.accent; ctx.lineWidth = 3; ctx.stroke();
      ctx.restore();
    }

    var cx = x + w / 2;
    // 原始牌：左上角花色（红/黑）
    if (!isResult && tok.suit) {
      var sc = tok.suit.red ? '#E5484D' : '#2C3138';
      D.text(ctx, tok.suit.ch, x + 12, y + 22, { size: 17, weight: '700', color: sc });
    }
    // 数值（大）
    var valCol = done ? T.ok : T.text;
    D.text(ctx, Gen.face(tok.v), cx, y + h * 0.46,
      { size: Math.min(40, w * 0.5), weight: '800', color: valCol, align: 'center' });
    // 合并结果：下方小字显示表达式
    if (isResult) {
      D.text(ctx, tok.expr, cx, y + h - 14,
        { size: Math.max(9, Math.min(13, w * 0.14)), color: T.textSub, align: 'center', maxWidth: w - 10 });
    } else {
      D.text(ctx, '值 ' + tok.v, cx, y + h - 14,
        { size: 10.5, color: T.textSub, align: 'center' });
    }
  };

  ScenePk24.prototype.renderOperators = function (ctx) {
    for (var i = 0; i < this.opBtns.length; i++) {
      var b = this.opBtns[i];
      var active = this.pendingOp === b.op;
      D.button(ctx, b, b.op, {
        fill: active ? T.accent : '#FFFFFF',
        color: active ? '#FFFFFF' : T.text,
        size: 22, weight: '700',
        icon: null
      });
    }
  };

  ScenePk24.prototype.renderFooter = function (ctx) {
    var undoDead = !this.history.length;
    var hintDead = !this.solution;
    for (var i = 0; i < this.btns.length; i++) {
      var b = this.btns[i];
      if (b.key === 'undo') {
        D.button(ctx, b, b.label,
          { fill: '#FFFFFF', color: undoDead ? T.textSub : T.text,
            icon: b.icon, iconColor: undoDead ? T.textSub : T.textSub, disabled: undoDead });
      } else if (b.key === 'reset') {
        D.button(ctx, b, b.label, { fill: '#FFFFFF', color: T.text, icon: b.icon, iconColor: T.textSub });
      } else {
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

  ScenePk24.prototype.renderHint = function (ctx) {
    if (!this.hintExpr) { return; }
    var pf = BF.platform, W = pf.width;
    var y = this.areaBot + 2;
    D.panel(ctx, 12, y, W - 24, 30, { radius: 10, fill: U.rgba(T.accent, 0.10) });
    D.text(ctx, '提示：' + this.hintExpr, W / 2, y + 15,
      { size: 13, color: T.accent, weight: '600', align: 'center', maxWidth: W - 36 });
  };

  ScenePk24.prototype.renderToast = function (ctx) {
    if (!this.toast) { return; }
    var pf = BF.platform;
    var a = Math.min(1, this.toast.t / 360);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 13px ' + D.FONT;
    var w = ctx.measureText(this.toast.text).width + 32;
    var x = (pf.width - w) / 2, y = this.areaTop - 4;
    D.fillRound(ctx, x, y, w, 36, 18, 'rgba(28,31,36,0.88)');
    D.text(ctx, this.toast.text, pf.width / 2, y + 18.5, { size: 13, color: '#FFFFFF', weight: '600' });
    ctx.restore();
  };

  ScenePk24.prototype.overlayLayout = function () {
    var pf = BF.platform, H = pf.height;
    var w = Math.min(pf.width - 56, 300), h = 250;
    var x = (pf.width - w) / 2, y = (H - h) / 2 - 10;
    var pad = 20, bw = (w - pad * 2 - 12) / 2;
    return {
      card: { x: x, y: y, w: w, h: h },
      home: { x: x + pad, y: y + h - pad - 48, w: bw, h: 48 },
      next: { x: x + pad + bw + 12, y: y + h - pad - 48, w: bw, h: 48 }
    };
  };

  ScenePk24.prototype.renderWin = function (ctx) {
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
    D.text(ctx, '= 24 🎉', cx + cw / 2, cy + 46, { size: 24, weight: '800', color: T.ok });

    var starY = cy + 96, r = 22, gapx = r * 2.5;
    for (var i = 0; i < 3; i++) {
      var on = i < this.win.stars;
      var delay = U.clamp((this.win.t - 180 - i * 130) / 220, 0, 1);
      var sc = on ? (0.6 + 0.4 * U.easeOutCubic(delay)) * (1 + 0.25 * Math.sin(Math.PI * delay)) : 1;
      D.star(ctx, cx + cw / 2 + (i - 1) * gapx, starY, r * sc, 0.46,
        on ? T.gold : 'rgba(23,26,31,0.10)', 'rgba(23,26,31,0.10)');
    }
    D.text(ctx, '用时 ' + this.win.sec + ' 秒' + (this.hintsUsed ? ' · 用了提示' : ''),
      cx + cw / 2, cy + 148, { size: 12.5, color: T.textSub });
    var best = BF.Save.extraOf('pk24').bestStars || this.win.stars;
    D.text(ctx, '已解 ' + ((BF.Save.extraOf('pk24').solved) || 0) + ' 题 · 最佳 ' + best + '★',
      cx + cw / 2, cy + 166, { size: 11, color: T.textSub, weight: '600' });

    var k = cw / card.w;
    var rh = { x: cx + (ob.home.x - card.x) * k, y: cy + (ob.home.y - card.y) * k,
               w: ob.home.w * k, h: ob.home.h * k };
    var rn = { x: cx + (ob.next.x - card.x) * k, y: cy + (ob.next.y - card.y) * k,
               w: ob.next.w * k, h: ob.next.h * k };
    var pr = this.win.press;
    D.button(ctx, rh, '返回首页', { fill: pr === 'home' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15 });
    D.button(ctx, rn, '下一题', { fill: pr === 'next' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15, shadow: true });
    ctx.restore();
  };

  BF.ScenePk24 = ScenePk24;
})();
