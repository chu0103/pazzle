/**
 * recall.js —— 第 17 款游戏「瞬时记忆」玩法场景（固定 15 关闯关 + 每日挑战）
 *
 * 四阶段状态机：
 *   observe → quiz → reveal → (下一题 quiz | result)
 *   - observe：正方形场景卡展示 N 件物品，倒计时归零（或轻触）收图；前 420ms 屏蔽误触。
 *   - quiz：场景卡收起成黑底大「?」，逐题给 2~4 个选项 + 黄色倒计时环；点选项即判，超时算答错。
 *   - reveal：约 1.2s 放大画出该题对应物品特写 + 正确答案（还原视频「特写揭晓」），轻触可跳过。
 *   - result：答完 M 题 → 星级过关；3 心耗光 → 失败重玩同关。
 *
 * ⚠️ 弹框透明坑：入场淡入白纱(fadeIn)必须画在 RuleTip.render 之前，否则白纱恒亮
 *    盖在弹框上（update 在 showRule 期间提前 return）→ 弹框内容全透明。fake canvas
 *    不合成 alpha 测不出，由 tools/_verify_recall_popup.js 记录绘制顺序断言。
 *
 * ⚠️ 物品主体一律用 assets/recall/ 下的白底实物图渲染（drawImage）；
 *    颜色题的「答案色」由生成器赋给 item.colorName，与图上真实颜色一致，保证公平。
 *    车票票面文字（出发/到达/车次）在白底照片上用 D.text 叠加，是文字细节题的依据。
 *    图片未加载完 / 宿主无图片能力时退化到矢量兜底（drawItemVector）。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.SceneRecall) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;

  var CARD_BG = '#FFFFFF';       // 场景卡底色（纯白，让白底实物图无缝融入）
  var QUIZ_BG = '#22262E';       // 收图后的黑底（还原视频）
  var INK = '#2C3036';

  // 笔图统一生成为「水平放置、笔尖朝右(+x, 0°)」；渲染时按 item.rot 旋转，
  // 笔尖即指向 target（保证「笔尖指向谁」空间题所见即所答）。
  var PEN_BASE_ROT = 0;

  /* ---------------- 实物图注册表（27 张白底 JPEG，assets/recall/） ---------------- */
  var RECALL_IMAGE_NAMES = [
    'umbrella_blue', 'umbrella_red', 'umbrella_green', 'umbrella_yellow', 'umbrella_purple', 'umbrella_orange',
    'mug_blue', 'mug_red', 'mug_green', 'mug_yellow', 'mug_purple', 'mug_orange',
    'pen_blue', 'pen_red', 'pen_green', 'pen_yellow', 'pen_purple', 'pen_orange',
    'earbuds_open', 'earbuds_closed', 'wallet_open', 'wallet_closed',
    'eraser', 'orange', 'ticket', 'keys', 'glasses'
  ];

  /** 由物品推导对应的实物图文件名（不含扩展名） */
  function imageNameFor(item) {
    var k = item.kind;
    if (k === 'umbrella' || k === 'mug' || k === 'pen') {
      var code = (BF.RecallGen && BF.RecallGen.COLOR_CODE[item.colorName]) || 'blue';
      return k + '_' + code;
    }
    if (k === 'earbuds' || k === 'wallet') {
      return k + '_' + ((item.state === 'open') ? 'open' : 'closed');
    }
    return k;  // eraser / orange / ticket / keys / glasses
  }

  var RecallImgs = {
    base: '',
    cache: {},
    failed: {},
    blocked: false,
    resolve: function (name) {
      var src = 'assets/recall/' + name + '.jpg';
      if (/^(https?:|data:|blob:|wxfile:|file:|\/)/i.test(src)) { return src; }
      return (this.base || '') + src;
    },
    get: function (name, cb) {
      var self = this;
      if (!name) { if (cb) cb(new Error('no name')); return; }
      if (this.blocked) { if (cb) cb(new Error('blocked')); return; }
      var url = this.resolve(name);
      if (this.cache[url]) { if (cb) cb(null, this.cache[url]); return; }
      if (this.failed[url]) { if (cb) cb(new Error('failed:' + url)); return; }
      if (!BF.platform || !BF.platform.createImage) { if (cb) cb(new Error('no createImage')); return; }
      BF.platform.createImage(url, function (err, img) {
        if (err || !img) { self.failed[url] = 1; if (cb) cb(err || new Error('fail')); return; }
        self.cache[url] = img; if (cb) cb(null, img);
      });
    },
    /** 同步取已缓存图（未加载完返回 null），供 render 直接 drawImage */
    peek: function (name) {
      var url = this.resolve(name);
      return this.cache[url] || null;
    },
    /** 预载全部 27 张（重复进入靠 cache 命中，不会重复下载） */
    preloadAll: function (cb) {
      var names = RECALL_IMAGE_NAMES, total = names.length, done = 0, fired = false;
      if (!total) { if (cb) cb(); return; }
      function once() { done++; if (done >= total && !fired) { fired = true; if (cb) cb(); } }
      for (var i = 0; i < total; i++) { this.get(names[i], once); }
    }
  };


  /* ---------------- 场景构造 ---------------- */

  function SceneRecall(app) {
    this.app = app;
    this.fadeIn = 1;
    this.t = 0;
    this.win = null;
    this.fail = null;
    this.toast = null;
    this.pressOpt = -1;
  }

  /* ---------------- 建关 / 状态 ---------------- */

  SceneRecall.prototype.enter = function (params) {
    params = params || {};
    this.game = params.game || 'recall';
    this.level = params.level || 1;
    this.isDaily = !!params.daily;

    var g = this.isDaily ? BF.RecallGen.buildDaily() : BF.RecallGen.build(this.level);
    this.scene = g;
    this.items = g.items;
    this.questions = g.questions;
    this.N = g.N;
    this.M = g.M;
    this.observeMs = g.observeMs;
    this.answerMs = g.answerMs;
    this.revealMs = g.revealMs;

    this.hearts = 3;
    this.mistakes = 0;
    this.hintsUsed = 0;
    this.correctCount = 0;
    this.qIndex = 0;
    this.phase = 'observe';          // observe → quiz → reveal → (quiz | result)
    this.pendingFail = false;
    this.observeT = this.observeMs;
    this.observeLockT = 420;         // 进关前 420ms 屏蔽「轻触提前开始」，防手滑
    this.quizT = this.answerMs;
    this.revealT = 0;
    this.excluded = -1;              // 本题被提示排除的错误选项
    this.hintUsedForQ = false;
    this.lastAnswer = null;          // {q, chosen, correct, timeout}
    this.pressOpt = -1;
    this.elapsed = 0;
    this.win = null;
    this.fail = null;
    this.toast = null;
    this.fadeIn = 1;
    this.t = 0;

    this.layout();
    BF.RecallImgs.preloadAll();   // 提前异步加载 27 张白底实物图，首帧可能先矢量兜底
    if (BF.RuleTip.shouldShow(this.game, this)) { BF.RuleTip.enter(this, params); }
    return this;
  };

  /* ---------------- 布局 ---------------- */

  SceneRecall.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var top = pf.safeTop;

    this.headerH = 56;
    this.headerY = top;
    this.back = { x: 12, y: top + 8, w: 40, h: 40 };
    this.ruleBtn = BF.RuleTip.btnRect(this);
    this.instrY = top + this.headerH + 18;

    // 选项区固定按 2 行预算高度，阶段切换时卡片几何不跳动
    var questionH = 34, optCellH = 48, optGapY = 10;
    var optH = 2 * optCellH + optGapY;
    this.optCellH = optCellH;
    this.optGapX = 12;
    this.optGapY = optGapY;
    this.optW = W - 48;
    this.optCellW = (this.optW - this.optGapX) / 2;

    var cardTop = top + this.headerH + 34 + 6;
    var footerH = 64 + pf.safeBottom;
    var optAreaH = questionH + optH + 12;
    var availH = Math.max(120, H - cardTop - optAreaH - footerH - 8);
    var size = Math.min(W - 48, 340, availH);
    this.cardSize = size;
    this.cardX = (W - size) / 2;
    this.cardY = cardTop;
    this.itemR = size * 0.085;          // 物品基准半径（揭晓特写另用更大的 R）

    this.questionY = this.cardY + size + 20;
    this.optY = this.questionY + questionH;

    var bh = 44, bw = 168;
    this.hintBtn = { x: (W - bw) / 2, y: H - pf.safeBottom - bh - 6, w: bw, h: bh };

    this.ring = { cx: W - 32, cy: this.instrY, r: 15 };
    this.refreshOptions();
  };

  /** 按当前题选项数排布 2 列按钮；奇数个时最后一个横跨整行 */
  SceneRecall.prototype.refreshOptions = function () {
    var q = this.questions && this.questions[this.qIndex];
    var n = q ? q.options.length : 0;
    this.optRects = [];
    for (var i = 0; i < n; i++) {
      var col = i % 2, row = Math.floor(i / 2);
      var lastOdd = (i === n - 1) && (n % 2 === 1) && n > 2;
      this.optRects.push({
        x: 24 + col * (this.optCellW + this.optGapX),
        y: this.optY + row * (this.optCellH + this.optGapY),
        w: lastOdd ? this.optW : this.optCellW,
        h: this.optCellH,
        idx: i
      });
    }
  };

  SceneRecall.prototype.itemPos = function (item) {
    return { x: this.cardX + item.x * this.cardSize, y: this.cardY + item.y * this.cardSize };
  };

  /* ---------------- 更新 ---------------- */

  SceneRecall.prototype.update = function (dt) {
    if (this.showRule) { return BF.RuleTip.update(this, dt); }
    this.t += dt;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) { this.toast = null; } }
    if (this.win) { this.win.t += dt; return; }
    if (this.fail) { this.fail.t += dt; return; }
    if (this.observeLockT > 0) { this.observeLockT = Math.max(0, this.observeLockT - dt); }
    this.elapsed += dt;

    if (this.phase === 'observe') {
      this.observeT -= dt;
      if (this.observeT <= 0) { this.startQuiz(); }
    } else if (this.phase === 'quiz') {
      this.quizT -= dt;
      if (this.quizT <= 0) { this.answer(-1); }   // 超时按答错处理
    } else if (this.phase === 'reveal') {
      this.revealT -= dt;
      if (this.revealT <= 0) { this.nextQuestion(); }
    }
  };

  SceneRecall.prototype.startQuiz = function () {
    this.phase = 'quiz';
    this.qIndex = 0;
    this.quizT = this.answerMs;
    this.excluded = -1;
    this.hintUsedForQ = false;
    this.lastAnswer = null;
    this.refreshOptions();
    this.showToast('图片收起，开始作答');
  };

  /** 作答：idx<0 表示超时。判完进 reveal；0 心时先揭晓再失败 */
  SceneRecall.prototype.answer = function (idx) {
    if (this.phase !== 'quiz') { return; }
    var q = this.questions[this.qIndex];
    if (!q) { return; }
    var correct = (idx >= 0 && idx === q.answerIndex);
    this.lastAnswer = { q: q, chosen: idx, correct: correct, timeout: idx < 0 };
    if (correct) {
      this.correctCount++;
      BF.platform.vibrate('light');
    } else {
      this.mistakes++;
      this.hearts--;
      BF.platform.vibrate('light');
      if (this.hearts <= 0) { this.pendingFail = true; }
    }
    this.phase = 'reveal';
    this.revealT = this.revealMs;
    this.pressOpt = -1;
  };

  SceneRecall.prototype.nextQuestion = function () {
    if (this.pendingFail) { this.fail = { t: 0, press: null }; return; }
    if (this.qIndex + 1 >= this.M) { this.onSolved(); return; }
    this.qIndex++;
    this.phase = 'quiz';
    this.quizT = this.answerMs;
    this.excluded = -1;
    this.hintUsedForQ = false;
    this.lastAnswer = null;
    this.refreshOptions();
  };

  SceneRecall.prototype.pressHint = function () {
    if (this.phase !== 'quiz' || this.hintUsedForQ) { return; }
    var q = this.questions[this.qIndex];
    var cand = [];
    for (var i = 0; i < q.options.length; i++) {
      if (i !== q.answerIndex && i !== this.excluded) { cand.push(i); }
    }
    if (!cand.length) { return; }
    this.excluded = cand[Math.floor((this.t / 97) % cand.length)];
    this.hintsUsed++;
    this.hintUsedForQ = true;
    this.showToast('已排除一个错误选项（本关降星）');
  };

  SceneRecall.prototype.showToast = function (txt) { this.toast = { text: txt, t: 1500 }; };

  /* ---------------- 输入 ---------------- */

  SceneRecall.prototype.onDown = function (x, y) {
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
    // 观察期轻触提前收图（防误触窗口内不响应）；揭晓期轻触跳过
    if (this.phase === 'observe' && this.observeLockT <= 0) { this.startQuiz(); return; }
    if (this.phase === 'reveal') { this.revealT = 0; return; }
    // 答题期：记录选项按下态，实际判定放 onUp（答案点选只在 onUp，避免一次点按触发两次）
    this.pressOpt = -1;
    if (this.phase === 'quiz') {
      for (var i = 0; i < this.optRects.length; i++) {
        if (U.pointInRect(x, y, this.optRects[i])) { this.pressOpt = this.optRects[i].idx; break; }
      }
    }
  };

  SceneRecall.prototype.onUp = function (x, y) {
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
    var pi = this.pressOpt;
    this.pressOpt = -1;
    if (this.phase === 'quiz' && pi >= 0 && U.pointInRect(x, y, this.optRects[pi])) {
      this.answer(pi); return;
    }
    if (this.phase === 'quiz' && U.pointInRect(x, y, this.hintBtn)) { this.pressHint(); }
  };

  SceneRecall.prototype.onMove = function () { /* 纯点选，无拖动 */ };

  /* ---------------- 评星 / 存档 ---------------- */

  SceneRecall.prototype.onSolved = function () {
    var stars = BF.RecallGen.starsFor(this.mistakes, this.hintsUsed);
    if (this.isDaily) { BF.Save.clearDaily(stars); }
    else { BF.Save.clear('recall', this.level, stars); }
    this.win = { t: 0, stars: stars, press: null,
      sec: Math.round(this.elapsed / 10) / 100 };
    BF.platform.vibrate('heavy');
  };

  SceneRecall.prototype.nextAfterWin = function () {
    if (this.isDaily) { this.app.go('home'); return; }
    if (this.level < BF.games.recall.TOTAL) {
      BF.RuleTip.skipOnce(this); this.enter({ level: this.level + 1, game: this.game });
    } else { this.app.go('home'); }
  };

  /* ---------------- 渲染 ---------------- */

  SceneRecall.prototype.render = function (ctx) {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.bgTop);
    bg.addColorStop(1, T.bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    this.renderHeader(ctx);
    this.renderInstr(ctx);
    this.renderCard(ctx);
    this.renderOptions(ctx);
    this.renderHintButton(ctx);
    this.renderToast(ctx);
    if (this.win) { this.renderWin(ctx); }
    if (this.fail) { this.renderFail(ctx); }

    // ⚠️ 入场白纱必须早于 RuleTip.render（弹框永远最后画）
    if (this.fadeIn > 0) {
      ctx.save();
      ctx.globalAlpha = this.fadeIn * 0.85;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (this.showRule) { BF.RuleTip.render(ctx, this); }
  };

  SceneRecall.prototype.renderHeader = function (ctx) {
    var W = BF.platform.width, top = this.headerY;
    D.fillRound(ctx, this.back.x, this.back.y, this.back.w, this.back.h, 14, '#FFFFFF');
    D.roundRect(ctx, this.back.x + 0.5, this.back.y + 0.5, this.back.w - 1, this.back.h - 1, 14);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    D.icon(ctx, 'back', this.back.x + this.back.w / 2, this.back.y + this.back.h / 2, 16, T.text);
    BF.RuleTip.renderBtn(ctx, this);

    D.text(ctx, '瞬时记忆', W / 2, top + 17, { size: 18, weight: '700' });
    var sub = this.isDaily ? '每日挑战 · ' + this.N + ' 件物品'
      : ('第 ' + this.level + ' 关 · ' + this.N + ' 件物品 · ' + this.M + ' 题');
    D.text(ctx, sub, W / 2, top + 38, { size: 11, color: T.textSub, weight: '600' });

    var sec = Math.floor(this.elapsed / 1000);
    D.text(ctx, '⏱ ' + sec + 's', W - 16, top + 16,
      { size: 13, color: T.textSub, weight: '600', align: 'right' });

    var hs = 13, gap = 4;
    var baseX = W - 16 - hs / 2, y = top + 38 + hs / 2;
    for (var i = 0; i < 3; i++) { fillHeart(ctx, baseX - i * (hs + gap), y, hs, i < this.hearts); }
  };

  SceneRecall.prototype.renderInstr = function (ctx) {
    var txt = '', frac = 0, ringCol = T.accent, showRing = true;
    if (this.phase === 'observe') {
      txt = '记住这些物品的颜色与细节';
      frac = U.clamp(this.observeT / this.observeMs, 0, 1);
    } else if (this.phase === 'quiz') {
      txt = '第 ' + (this.qIndex + 1) + '/' + this.M + ' 题 · 选出正确答案';
      frac = U.clamp(this.quizT / this.answerMs, 0, 1);
      ringCol = T.gold;
    } else if (this.phase === 'reveal') {
      var la = this.lastAnswer;
      txt = !la ? '' : (la.correct ? '答对了！' : (la.timeout ? '超时了' : '答错了'));
      frac = U.clamp(this.revealT / this.revealMs, 0, 1);
      ringCol = (la && la.correct) ? T.ok : T.warn;
    } else { showRing = false; }
    if (txt) {
      D.text(ctx, txt, BF.platform.width / 2 - 12, this.instrY,
        { size: 15, weight: '700', color: T.accent, maxWidth: BF.platform.width - 90 });
    }
    if (!showRing) { return; }

    // 倒计时环（底环浅灰 + 进度弧），中心显示剩余秒数
    var r = this.ring.r, cx = this.ring.cx, cy = this.ring.cy;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(23,26,31,0.10)'; ctx.lineWidth = 4; ctx.stroke();
    if (frac > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.strokeStyle = ringCol; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.restore();
    var left = (this.phase === 'observe') ? this.observeT
      : (this.phase === 'quiz' ? this.quizT : this.revealT);
    D.text(ctx, String(Math.max(0, Math.ceil(left / 1000))), cx, cy + 0.5,
      { size: 11, weight: '700', color: T.text });

    // 下方细进度条
    var W = BF.platform.width;
    var barX = 24, barW = W - 48, barY = this.instrY + 22, barH = 5;
    D.fillRound(ctx, barX, barY, barW, barH, barH / 2, 'rgba(23,26,31,0.08)');
    if (frac > 0) {
      D.fillRound(ctx, barX, barY, Math.max(barH, barW * frac), barH, barH / 2, ringCol);
    }
  };

  /** 中央卡片：观察期画场景；答题期收成黑底「?」；揭晓期画物品特写 */
  SceneRecall.prototype.renderCard = function (ctx) {
    var x = this.cardX, y = this.cardY, s = this.cardSize;
    if (this.phase === 'observe') {
      D.panel(ctx, x, y, s, s, { radius: 20, fill: CARD_BG, shadowBlur: 16, shadowOffsetY: 5 });
      for (var i = 0; i < this.items.length; i++) {
        var p = this.itemPos(this.items[i]);
        drawItem(ctx, this.items[i], p.x, p.y, this.itemR);
      }
      D.text(ctx, '轻触屏幕可提前收图', x + s / 2, y + s - 12,
        { size: 10, color: T.textSub, alpha: 0.9 });
      return;
    }

    if (this.phase === 'quiz') {
      D.panel(ctx, x, y, s, s, { radius: 20, fill: QUIZ_BG, shadowBlur: 16, shadowOffsetY: 5 });
      D.text(ctx, '?', x + s / 2, y + s * 0.45,
        { size: Math.min(120, s * 0.36), weight: '800', color: 'rgba(255,255,255,0.90)' });
      D.text(ctx, '回想刚才那张图', x + s / 2, y + s * 0.78,
        { size: 13, color: 'rgba(255,255,255,0.55)', weight: '600' });
      return;
    }

    // reveal：白卡 + 目标物品放大特写 + 答案
    D.panel(ctx, x, y, s, s, { radius: 20, fill: '#FFFFFF', shadowBlur: 16, shadowOffsetY: 5 });
    var la = this.lastAnswer, q = la && la.q;
    if (q && q.targetId) {
      var it = null;
      for (var k = 0; k < this.items.length; k++) {
        if (this.items[k].id === q.targetId) { it = this.items[k]; break; }
      }
      if (it) { drawItem(ctx, it, x + s / 2, y + s * 0.40, s * 0.22); }
    }
    if (q) {
      D.text(ctx, '正确答案：' + q.revealText, x + s / 2, y + s * 0.79,
        { size: 15, weight: '700', color: (la && la.correct) ? T.ok : T.warn,
          maxWidth: s - 24 });
      if (q.explain) {
        D.text(ctx, q.explain, x + s / 2, y + s * 0.88,
          { size: 11, color: T.textSub, maxWidth: s - 24 });
      }
    }
    D.text(ctx, '轻触跳过', x + s / 2, y + s - 12, { size: 10, color: T.textSub, alpha: 0.9 });
  };

  /** 选项区：quiz 期画 2~4 个选项；其余阶段画说明文字 */
  SceneRecall.prototype.renderOptions = function (ctx) {
    var W = BF.platform.width;
    if (this.phase === 'observe') {
      D.text(ctx, '倒计时结束后图片收起，逐题回答细节', W / 2, this.questionY,
        { size: 12, color: T.textSub, maxWidth: W - 48 });
      return;
    }
    if (this.phase === 'reveal') {
      var la = this.lastAnswer;
      D.text(ctx, la && la.correct ? '✓ 答对了，马上进入下一题' : '✕ 答错扣 1 颗心，记住这个细节',
        W / 2, this.questionY,
        { size: 13, weight: '600', color: (la && la.correct) ? T.ok : T.warn, maxWidth: W - 48 });
      return;
    }
    if (this.phase !== 'quiz') { return; }

    var q = this.questions[this.qIndex];
    if (!q) { return; }
    D.text(ctx, q.text, W / 2, this.questionY - 6,
      { size: 14, weight: '700', color: T.text, maxWidth: W - 48 });

    for (var i = 0; i < this.optRects.length; i++) {
      var r = this.optRects[i];
      var isExcluded = (i === this.excluded);
      var fill = '#FFFFFF', color = T.text;
      if (isExcluded) { fill = '#EDEFF2'; color = '#B4B9C2'; }
      else if (this.pressOpt === i) { fill = U.rgba(T.accent, 0.14); color = T.accentDeep; }
      D.button(ctx, r, isExcluded ? '✕ ' + q.options[i] : q.options[i], {
        fill: fill, color: color, size: 14, radius: 12,
        shadow: !isExcluded
      });
    }
  };

  SceneRecall.prototype.renderHintButton = function (ctx) {
    var active = (this.phase === 'quiz' && !this.hintUsedForQ);
    D.button(ctx, this.hintBtn, active ? '提示（排除一个）' : '提示', {
      fill: active ? U.rgba(T.accent, 0.12) : '#F0F2F5',
      color: active ? T.accent : T.textSub,
      icon: 'hint', iconColor: active ? T.accent : T.textSub,
      disabled: !active
    });
  };

  SceneRecall.prototype.renderToast = function (ctx) {
    if (!this.toast) { return; }
    var pf = BF.platform;
    var a = Math.min(1, this.toast.t / 300);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 13px ' + D.FONT;
    var w = ctx.measureText(this.toast.text).width + 32;
    var x = (pf.width - w) / 2, y = this.instrY + 32;
    D.fillRound(ctx, x, y, w, 34, 17, 'rgba(28,31,36,0.88)');
    D.text(ctx, this.toast.text, pf.width / 2, y + 17.5,
      { size: 13, color: '#FFFFFF', weight: '600' });
    ctx.restore();
  };

  /* ---------------- 结算弹层（沿用 redball/cat 同款几何） ---------------- */

  SceneRecall.prototype.overlayLayout = function () {
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

  SceneRecall.prototype.renderWin = function (ctx) {
    var pf = BF.platform, ob = this.overlayLayout();
    var t = Math.min(1, this.win.t / 260), s = U.easeOutCubic(t);
    ctx.save();
    ctx.globalAlpha = 0.9 * Math.min(1, this.win.t / 200);
    ctx.fillStyle = T.scrim; ctx.fillRect(0, 0, pf.width, pf.height);
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
    D.text(ctx, '答对 ' + this.correctCount + '/' + this.M + ' 题 · 用时 ' + this.win.sec + ' 秒' +
      (this.hintsUsed ? ' · 用了提示' : ''),
      cx + cw / 2, cy + 150, { size: 12.5, color: T.textSub });

    var k = cw / card.w;
    var rh = { x: cx + (ob.home.x - card.x) * k, y: cy + (ob.home.y - card.y) * k,
               w: ob.home.w * k, h: ob.home.h * k };
    var ra = { x: cx + (ob.action.x - card.x) * k, y: cy + (ob.action.y - card.y) * k,
               w: ob.action.w * k, h: ob.action.h * k };
    var pr = this.win.press;
    var last = this.isDaily || this.level >= BF.games.recall.TOTAL;
    D.button(ctx, rh, '返回首页', { fill: pr === 'home' ? '#DCDEE3' : '#F0F2F5', color: T.text, size: 15 });
    D.button(ctx, ra, last ? '完成' : '下一关',
      { fill: pr === 'action' ? T.accentDeep : T.accent, color: '#FFFFFF', size: 15, shadow: true });
    ctx.restore();
  };

  SceneRecall.prototype.renderFail = function (ctx) {
    var pf = BF.platform, ob = this.overlayLayout();
    var t = Math.min(1, this.fail.t / 260), s = U.easeOutCubic(t);
    ctx.save();
    ctx.globalAlpha = 0.9 * Math.min(1, this.fail.t / 200);
    ctx.fillStyle = T.scrim; ctx.fillRect(0, 0, pf.width, pf.height);
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
    D.text(ctx, '本关答对 ' + this.correctCount + '/' + this.M + ' 题',
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

  /* ---------------- 矢量物品绘制（纯 Canvas，0 图片） ---------------- */

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
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /** 本地坐标小工具：圆 / 圆角矩形 / 线，坐标以物品中心为原点 */
  function circle(ctx, x, y, r, fill) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
  }
  function rr(ctx, x, y, w, h, rad, fill) { D.fillRound(ctx, x, y, w, h, rad, fill); }
  function line(ctx, x1, y1, x2, y2, col, lw) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke();
  }

  /* ---------------- 写实矢量物品绘制（主体用 item.colorHex，保持颜色题公平） ---------------- */

  /** 圆角矩形路径（不填充，供渐变/描边复用） */
  function rrp(ctx, x, y, w, h, rad) {
    rad = Math.min(rad, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }
  /** 柔和接触阴影：让物品「落地」更立体（物品局部、未旋转坐标系内，x=0） */
  function contactShadow(ctx, y, rx, ry, a) {
    ctx.save();
    ctx.fillStyle = 'rgba(20,24,31,' + (a == null ? 0.10 : a) + ')';
    ctx.beginPath();
    ctx.ellipse(0, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  /** 球体体积渐变：高光左上、阴影右下，基准色取自 item.colorHex（主色不变） */
  function sphereGrad(ctx, R, base, hi, lo) {
    var g = ctx.createRadialGradient(-R * 0.36, -R * 0.36, R * 0.08, 0, 0, R * 1.06);
    g.addColorStop(0, U.shade(base, hi == null ? 0.40 : hi));
    g.addColorStop(0.5, base);
    g.addColorStop(1, U.shade(base, lo == null ? -0.38 : lo));
    return g;
  }

  function drawUmbrella(ctx, r, c) {
    var dark = U.shade(c, -0.42), hi = U.shade(c, 0.34);
    contactShadow(ctx, r * 1.22, r * 0.32, r * 0.10, 0.10);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#43474F'; ctx.lineWidth = Math.max(1.6, r * 0.12);
    ctx.beginPath(); ctx.moveTo(0, -r * 0.05); ctx.lineTo(0, r * 0.80); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, r * 0.80);
    ctx.quadraticCurveTo(0, r * 1.18, -r * 0.34, r * 1.12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -r * 1.0); ctx.lineTo(0, -r * 1.2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 1.15, -r * 0.05);
    ctx.bezierCurveTo(-r * 1.18, -r * 1.06, r * 1.18, -r * 1.06, r * 1.15, -r * 0.05);
    var steps = 4, x0 = r * 1.15, x1 = -r * 1.15;
    for (var i = 0; i < steps; i++) {
      var xa = x0 + (x1 - x0) * (i / steps), xb = x0 + (x1 - x0) * ((i + 1) / steps), xm = (xa + xb) / 2;
      ctx.quadraticCurveTo(xm, r * 0.20, xb, -r * 0.05);
    }
    ctx.closePath();
    var g = ctx.createLinearGradient(0, -r * 1.05, 0, r * 0.20);
    g.addColorStop(0, hi); g.addColorStop(0.5, c); g.addColorStop(1, dark);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = Math.max(0.8, r * 0.045);
    for (var j = 0; j <= steps; j++) {
      var tx = x0 + (x1 - x0) * (j / steps);
      ctx.beginPath(); ctx.moveTo(0, -r * 1.0); ctx.lineTo(tx, -r * 0.02); ctx.stroke();
    }
    circle(ctx, 0, -r * 1.0, r * 0.05, dark);
  }

  function drawMug(ctx, r, c) {
    var dark = U.shade(c, -0.42), hi = U.shade(c, 0.34);
    contactShadow(ctx, r * 0.92, r * 0.86, r * 0.20, 0.10);
    ctx.lineCap = 'round';
    ctx.strokeStyle = c; ctx.lineWidth = Math.max(2, r * 0.26);
    ctx.beginPath(); ctx.arc(r * 0.86, 0, r * 0.42, -Math.PI * 0.62, Math.PI * 0.62); ctx.stroke();
    ctx.strokeStyle = U.shade(c, 0.16); ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.beginPath(); ctx.arc(r * 0.86, 0, r * 0.42, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
    var bw = r * 0.92, top = -r * 0.82, bot = r * 0.82;
    ctx.beginPath();
    ctx.moveTo(-bw, top);
    ctx.lineTo(bw, top);
    ctx.quadraticCurveTo(bw + r * 0.05, 0, bw * 0.92, bot);
    ctx.quadraticCurveTo(0, bot + r * 0.12, -bw * 0.92, bot);
    ctx.quadraticCurveTo(-bw - r * 0.05, 0, -bw, top);
    ctx.closePath();
    var g = ctx.createLinearGradient(-bw, 0, bw, 0);
    g.addColorStop(0, dark); g.addColorStop(0.3, hi); g.addColorStop(0.55, c); g.addColorStop(1, U.shade(c, -0.30));
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, top, bw, r * 0.20, 0, 0, Math.PI * 2);
    ctx.fillStyle = U.shade(c, -0.28); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, top, bw * 0.80, r * 0.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = hi; ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, top, bw * 0.60, r * 0.11, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#3A2A1E'; ctx.fill();
    ctx.save(); ctx.globalAlpha = 0.28;
    rr(ctx, -bw * 0.78, top + r * 0.14, r * 0.16, (bot - top) * 0.66, r * 0.08, '#FFFFFF');
    ctx.restore();
  }

  function drawBud(ctx, x, y, s) {
    ctx.fillStyle = '#F4F5F7';
    ctx.beginPath(); ctx.ellipse(x, y, s * 0.66, s * 0.48, 0, 0, Math.PI * 2); ctx.fill();
    rr(ctx, x - s * 0.13, y, s * 0.26, s * 1.05, s * 0.13, '#F4F5F7');
    ctx.fillStyle = 'rgba(20,24,31,0.10)';
    ctx.beginPath(); ctx.ellipse(x + s * 0.18, y + s * 0.12, s * 0.38, s * 0.26, 0, 0, Math.PI * 2); ctx.fill();
  }
  function drawEarbuds(ctx, r, c, item) {
    var dark = U.shade(c, -0.42), hi = U.shade(c, 0.34);
    if (item.state !== 'open') {
      contactShadow(ctx, r * 0.70, r * 0.95, r * 0.18, 0.10);
      var w = r * 1.7, h = r * 1.3;
      rrp(ctx, -w / 2, -h / 2, w, h, r * 0.28);
      var g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, hi); g.addColorStop(0.5, c); g.addColorStop(1, dark);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = U.shade(c, -0.28); ctx.lineWidth = Math.max(1, r * 0.07);
      ctx.beginPath(); ctx.moveTo(-w / 2, -r * 0.06); ctx.lineTo(w / 2, -r * 0.06); ctx.stroke();
      circle(ctx, w * 0.32, -r * 0.06, r * 0.06, '#5BD06B');
    } else {
      contactShadow(ctx, r * 0.80, r * 1.0, r * 0.18, 0.10);
      var w = r * 1.7, h = r * 1.0;
      rrp(ctx, -w / 2, 0, w, h, r * 0.22);
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, hi); g.addColorStop(1, dark);
      ctx.fillStyle = g; ctx.fill();
      ctx.save(); ctx.translate(0, 0); ctx.rotate(-0.22);
      rrp(ctx, -w / 2, -h * 0.95, w, h * 0.5, r * 0.18);
      ctx.fillStyle = U.shade(c, 0.10); ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = Math.max(0.8, r * 0.04); ctx.stroke();
      ctx.restore();
      drawBud(ctx, -r * 0.42, r * 0.44, r * 0.34);
      drawBud(ctx, r * 0.42, r * 0.44, r * 0.34);
    }
  }

  function stitch(ctx, x1, y1, x2, y2, r) {
    ctx.save(); ctx.setLineDash([Math.max(1.4, r * 0.10), Math.max(1.4, r * 0.10)]);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = Math.max(0.8, r * 0.05);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
  }
  function drawWallet(ctx, r, c, item) {
    var dark = U.shade(c, -0.42), hi = U.shade(c, 0.32);
    if (item.state !== 'open') {
      contactShadow(ctx, r * 0.72, r * 1.1, r * 0.18, 0.10);
      var w = r * 2.0, h = r * 1.3;
      rrp(ctx, -w / 2, -h / 2, w, h, r * 0.18);
      var g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, hi); g.addColorStop(0.5, c); g.addColorStop(1, dark);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = U.shade(c, -0.28); ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.beginPath(); ctx.moveTo(0, -h / 2); ctx.lineTo(0, h / 2); ctx.stroke();
      circle(ctx, 0, 0, r * 0.10, U.shade(c, -0.16));
      stitch(ctx, -w / 2 + r * 0.12, -h / 2 + r * 0.05, -w / 2 + r * 0.12, h / 2 - r * 0.05, r);
      stitch(ctx, w / 2 - r * 0.12, -h / 2 + r * 0.05, w / 2 - r * 0.12, h / 2 - r * 0.05, r);
    } else {
      contactShadow(ctx, r * 0.72, r * 1.15, r * 0.18, 0.10);
      var w = r * 2.1, h = r * 1.2;
      rrp(ctx, -w / 2, -h / 2, w, h, r * 0.12);
      var g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, dark); g.addColorStop(0.5, U.shade(c, -0.10)); g.addColorStop(1, U.shade(c, -0.46));
      ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = '#E9D8B8';
      rrp(ctx, -w / 2 + r * 0.1, -h / 2 + r * 0.1, w / 2 - r * 0.2, h - r * 0.2, r * 0.06); ctx.fill();
      rrp(ctx, r * 0.1, -h / 2 + r * 0.1, w / 2 - r * 0.2, h - r * 0.2, r * 0.06); ctx.fill();
      ctx.strokeStyle = 'rgba(120,100,70,0.5)'; ctx.lineWidth = Math.max(0.6, r * 0.04);
      for (var s = 1; s <= 2; s++) {
        ctx.beginPath(); ctx.moveTo(-w / 2 + r * 0.1, -h / 2 + r * 0.1 + s * r * 0.28);
        ctx.lineTo(-r * 0.1, -h / 2 + r * 0.1 + s * r * 0.28); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(20,24,31,0.18)'; ctx.fillRect(-r * 0.04, -h / 2, r * 0.08, h);
    }
  }

  function drawEraser(ctx, r, c) {
    var dark = U.shade(c, -0.42), hi = U.shade(c, 0.32);
    contactShadow(ctx, r * 0.62, r * 1.05, r * 0.16, 0.10);
    var w = r * 2.0, h = r * 1.1;
    rrp(ctx, -w / 2 + w * 0.58, -h / 2, w * 0.42, h, r * 0.10);
    ctx.fillStyle = '#F0C9C0'; ctx.fill();
    rrp(ctx, -w / 2, -h / 2, w * 0.62, h, r * 0.12);
    var g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, hi); g.addColorStop(0.5, c); g.addColorStop(1, dark);
    ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(-w * 0.30, -h * 0.18, w * 0.22, h * 0.36);
    ctx.strokeStyle = U.shade(c, -0.30); ctx.lineWidth = Math.max(0.8, r * 0.05);
    ctx.beginPath(); ctx.moveTo(-w / 2 + w * 0.58, -h / 2); ctx.lineTo(-w / 2 + w * 0.58, h / 2); ctx.stroke();
    ctx.save(); ctx.globalAlpha = 0.25;
    rr(ctx, -w / 2 + r * 0.1, -h / 2 + r * 0.1, w * 0.5, h * 0.16, r * 0.06, '#FFFFFF');
    ctx.restore();
  }

  function drawPen(ctx, r, c) {
    var dark = U.shade(c, -0.45), hi = U.shade(c, 0.34), md = U.shade(c, -0.2);
    var x0 = -r * 1.2, x1 = r * 0.78, yh = r * 0.18;
    ctx.beginPath();
    ctx.moveTo(x0, -yh);
    ctx.lineTo(x1, -yh);
    ctx.lineTo(x1 + r * 0.12, 0);
    ctx.lineTo(x1, yh);
    ctx.lineTo(x0, yh);
    ctx.quadraticCurveTo(x0 - r * 0.12, 0, x0, -yh);
    ctx.closePath();
    var g = ctx.createLinearGradient(0, -yh, 0, yh);
    g.addColorStop(0, hi); g.addColorStop(0.45, c); g.addColorStop(0.55, c); g.addColorStop(1, dark);
    ctx.fillStyle = g; ctx.fill();
    rrp(ctx, x1 - r * 0.10, -yh, r * 0.42, yh * 2, r * 0.05);
    ctx.fillStyle = md; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x1 + r * 0.10, -yh * 0.55);
    ctx.lineTo(r * 1.42, 0);
    ctx.lineTo(x1 + r * 0.10, yh * 0.55);
    ctx.closePath();
    ctx.fillStyle = '#C9CDD4'; ctx.fill();
    ctx.strokeStyle = '#9AA0AA'; ctx.lineWidth = Math.max(0.6, r * 0.03); ctx.stroke();
    rrp(ctx, x0 + r * 0.1, -yh - r * 0.10, r * 0.5, r * 0.10, r * 0.05);
    ctx.fillStyle = dark; ctx.fill();
    rrp(ctx, x0 - r * 0.04, -yh, r * 0.10, yh * 2, r * 0.04);
    ctx.fillStyle = U.shade(c, 0.1); ctx.fill();
  }

  function drawOrange(ctx, r, c) {
    contactShadow(ctx, r * 0.98, r * 0.86, r * 0.16, 0.10);
    ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    ctx.fillStyle = sphereGrad(ctx, r * 0.9, c, 0.34, -0.40); ctx.fill();
    ctx.fillStyle = 'rgba(20,24,31,0.06)';
    var pts = [[-0.3, 0.3], [0.2, -0.2], [0.35, 0.25], [-0.15, -0.35], [0.05, 0.05]];
    for (var i = 0; i < pts.length; i++) {
      ctx.beginPath(); ctx.arc(pts[i][0] * r, pts[i][1] * r, r * 0.05, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save(); ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.ellipse(-r * 0.32, -r * 0.34, r * 0.18, r * 0.12, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.restore();
    line(ctx, 0, -r * 0.86, 0, -r * 1.02, '#6B4A2B', Math.max(1, r * 0.06));
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.98);
    ctx.quadraticCurveTo(r * 0.5, -r * 1.28, r * 0.62, -r * 0.86);
    ctx.quadraticCurveTo(r * 0.3, -r * 0.86, 0, -r * 0.98);
    ctx.closePath(); ctx.fillStyle = '#4E9C63'; ctx.fill();
  }

  function drawTicket(ctx, r, c, item) {
    var dark = U.shade(c, -0.42), hi = U.shade(c, 0.30);
    var w = r * 2.7, h = r * 1.6;
    rrp(ctx, -w / 2, -h / 2, w, h, r * 0.14);
    var g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, hi); g.addColorStop(0.5, c); g.addColorStop(1, dark);
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.setLineDash([Math.max(1.5, r * 0.10), Math.max(1.5, r * 0.10)]);
    ctx.strokeStyle = 'rgba(20,24,31,0.35)'; ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.beginPath(); ctx.moveTo(r * 0.4, -h / 2 + r * 0.12); ctx.lineTo(r * 0.4, h / 2 - r * 0.12); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(20,24,31,0.30)';
    for (var i = 0; i < 6; i++) { ctx.fillRect(r * 0.55 + i * r * 0.12, h / 2 - r * 0.42, r * 0.04, r * 0.30); }
    var fs = Math.max(6, r * 0.30);
    D.text(ctx, item.from || '', -r * 1.10, -r * 0.36, { size: fs * 0.9, color: INK, align: 'left', maxWidth: r * 1.9 });
    D.text(ctx, '→', r * 0.4, -r * 0.30, { size: fs, color: T.textSub, align: 'center' });
    D.text(ctx, item.dest || '', r * 1.10, -r * 0.36, { size: fs * 0.9, color: INK, align: 'right', maxWidth: r * 1.6 });
    D.text(ctx, item.train || '', -r * 1.10, r * 0.40, { size: fs, weight: '700', color: INK, align: 'left', maxWidth: r * 1.9 });
  }

  function drawKey(ctx, x, y, s, c) {
    var dark = U.shade(c, -0.42), hi = U.shade(c, 0.34);
    ctx.save(); ctx.translate(x, y); ctx.rotate(0.5);
    var g = ctx.createLinearGradient(0, -s * 0.08, 0, s * 0.08);
    g.addColorStop(0, hi); g.addColorStop(0.5, c); g.addColorStop(1, dark);
    ctx.fillStyle = g;
    rrp(ctx, -s * 0.05, -s * 0.5, s * 0.10, s * 0.9, s * 0.05); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -s * 0.5, s * 0.22, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
    ctx.beginPath(); ctx.arc(0, -s * 0.5, s * 0.10, 0, Math.PI * 2); ctx.fillStyle = 'rgba(20,24,31,0.15)'; ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(s * 0.02, s * 0.18, s * 0.10, s * 0.10);
    ctx.fillRect(s * 0.02, s * 0.34, s * 0.14, s * 0.10);
    ctx.restore();
  }
  function drawKeys(ctx, r, c) {
    contactShadow(ctx, r * 0.62, r * 0.7, r * 0.14, 0.10);
    ctx.lineWidth = Math.max(1.6, r * 0.14);
    ctx.strokeStyle = U.shade(c, 0.05);
    ctx.beginPath(); ctx.ellipse(0, -r * 0.5, r * 0.42, r * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
    drawKey(ctx, -r * 0.18, r * 0.1, r, c);
    drawKey(ctx, r * 0.42, r * 0.34, r * 0.85, c);
  }

  function drawGlasses(ctx, r, c) {
    contactShadow(ctx, r * 0.52, r * 0.78, r * 0.12, 0.08);
    var dark = '#3A3F47';
    for (var gi = 0; gi < 2; gi++) {
      var gx = gi === 0 ? -r * 0.62 : r * 0.62;
      ctx.beginPath(); ctx.ellipse(gx, 0, r * 0.5, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fillStyle = U.rgba(c, 0.30); ctx.fill();
      ctx.lineWidth = Math.max(1.6, r * 0.13); ctx.strokeStyle = dark; ctx.stroke();
      ctx.save(); ctx.globalAlpha = 0.35; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.beginPath(); ctx.ellipse(gx - r * 0.12, -r * 0.08, r * 0.22, r * 0.10, -0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.lineWidth = Math.max(1.6, r * 0.12); ctx.strokeStyle = dark; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-r * 0.12, -r * 0.06); ctx.lineTo(r * 0.12, -r * 0.06); ctx.stroke();
    line(ctx, -r * 1.1, -r * 0.18, -r * 1.36, -r * 0.40, dark, Math.max(1.4, r * 0.11));
    line(ctx, r * 1.1, -r * 0.18, r * 1.36, -r * 0.40, dark, Math.max(1.4, r * 0.11));
  }

  /**
   * 画一件物品：优先用白底实物图（drawImage），未加载完 / 宿主不支持时退化到矢量兜底。
   * - 笔按 (item.rot - PEN_BASE_ROT) 旋转：笔尖朝右(0°) → 旋转后即指向 target，
   *   保证「笔尖指向谁」空间题所见即所答。
   * - 车票轴对齐（不随机旋转），便于在白底照片上叠字。
   * - 其余物品轻微随机旋转，场景更自然（白底照片旋转后背景仍白，边界不可见）。
   */
  function drawItem(ctx, item, cx, cy, r) {
    var k = item.kind;
    var name = imageNameFor(item);
    var img = BF.RecallImgs.peek(name);
    if (img && img.width) {
      ctx.save();
      ctx.translate(cx, cy);
      if (k === 'pen') { ctx.rotate((item.rot || 0) - PEN_BASE_ROT); }
      else if (k === 'ticket') { /* 轴对齐，便于叠字 */ }
      else { ctx.rotate((((item.x || 0) * 7 + (item.y || 0) * 11) % 1 - 0.5) * 0.22); }
      var d = r * 2;
      ctx.drawImage(img, -d / 2, -d / 2, d, d);
      ctx.restore();
      if (k === 'ticket') { drawTicketLabel(ctx, item, cx, cy, r); }
      return;
    }
    // 退化路径：任何环境都能画出物品（矢量）
    drawItemVector(ctx, item, cx, cy, r);
  }

  /** 车票：白底照片上叠半透明白条 + 出发/到达/车次，保证 label 题清晰可读 */
  function drawTicketLabel(ctx, item, cx, cy, r) {
    var d = r * 2, bw = d * 0.82, bh = d * 0.46;
    D.fillRound(ctx, cx - bw / 2, cy - bh / 2, bw, bh, d * 0.05, 'rgba(255,255,255,0.80)');
    var fs = d * 0.095;
    D.text(ctx, (item.from || '') + '  →  ' + (item.dest || ''), cx, cy - d * 0.07,
      { size: fs, color: INK, align: 'center', weight: '600', maxWidth: bw * 0.96 });
    D.text(ctx, item.train || '', cx, cy + d * 0.11,
      { size: fs * 1.05, color: INK, align: 'center', weight: '700', maxWidth: bw * 0.96 });
  }

  /**
   * 矢量兜底（与旧版 drawItem 一致）：宿主无图片能力 / 图片未就绪时仍能量化画出物品。
   * 主体一律用 item.colorHex，保证颜色题所见即所答；pen 按 item.rot 旋转（笔尖 +x）。
   */
  function drawItemVector(ctx, item, cx, cy, r) {
    var c = item.colorHex;
    var k = item.kind;
    ctx.save();
    ctx.translate(cx, cy);
    if (k === 'pen') { ctx.rotate(item.rot || 0); }
    else { ctx.rotate((((item.x || 0) * 7 + (item.y || 0) * 11) % 1 - 0.5) * 0.22); }

    if (k === 'umbrella') { drawUmbrella(ctx, r, c); }
    else if (k === 'mug') { drawMug(ctx, r, c); }
    else if (k === 'earbuds') { drawEarbuds(ctx, r, c, item); }
    else if (k === 'wallet') { drawWallet(ctx, r, c, item); }
    else if (k === 'eraser') { drawEraser(ctx, r, c); }
    else if (k === 'pen') { drawPen(ctx, r, c); }
    else if (k === 'orange') { drawOrange(ctx, r, c); }
    else if (k === 'ticket') { drawTicket(ctx, r, c, item); }
    else if (k === 'keys') { drawKeys(ctx, r, c); }
    else if (k === 'glasses') { drawGlasses(ctx, r, c); }
    ctx.restore();
  }


  // 供首页迷你图标 / 测试复用
  BF.SceneRecall = SceneRecall;
  BF.RecallDrawItem = drawItem;
  BF.RecallImgs = RecallImgs;
})();
