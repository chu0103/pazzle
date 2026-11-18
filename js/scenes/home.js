/**
 * home.js —— 合集首页
 * 三大类分组（烧脑区 / 巧手区 / 眼力区）+ 两列网格 + 顶部 chip 过滤（吸顶）。
 * 卡片图标全部沿用各游戏原本的矢量画法（renderXxxIcon），不按大类重新染色。
 * 玩法说明弹框（RuleTip）不在首页出现，所以首页的淡入纱罩仍画在最后，没问题。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.SceneHome) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;

  // 缩略图只生成一次，之后一直复用（首页每帧都要画）
  var logicThumb = null;
  function getLogicThumb() {
    if (!logicThumb) { logicThumb = BF.Logic.generate({ seed: 20260930 }); }
    return logicThumb;
  }

  // 三大类：分组口径 + 类目主色（仅用于标题条 / chip 高亮，卡片图标仍是各游戏原图）
  var CAT_COLORS = { brain: '#6C63FF', hand: '#1FB6B6', eye: '#A6754B' };
  var GROUPS = [
    { id: 'brain', name: '烧脑区', cat: 'brain',
      games: ['sudoku', 'mine', 'picross', 'cipher', 'bottle', 'logic', 'pk24', 'cat', 'redball', 'tadpole', 'recall'] },
    { id: 'hand', name: '巧手区', cat: 'hand',
      games: ['daily', 'block', 'blocks', 'photo', 'rush'] },
    { id: 'eye', name: '眼力区', cat: 'eye',
      games: ['diff'] }
  ];
  var CHIPS = [
    { id: 'all', name: '全部 17' },
    { id: 'brain', name: '烧脑 11' },
    { id: 'hand', name: '巧手 5' },
    { id: 'eye', name: '眼力 1' }
  ];

  function SceneHome(app) {
    this.app = app;
    this.press = null;
    this.chipPress = null;
    this.activeChip = 'all';
    this.fadeIn = 1;
    this.t = 0;
    // 扁平卡列表（每款一条，含 cat 分组标记）
    this.cards = [];
    // 当前过滤下实际可见、带 x/y/w/h 的卡（布局时算出）
    this.cards2 = [];
    // 分组标题（仅全部模式有）
    this.headers = [];
    // chip 命中矩形
    this.chipRects = [];
    this.scroll = 0;
    this.minScroll = 0;
    this.vel = 0;
    this.dragging = false;
    this.moved = 0;
    this.dragStartY = 0;
    this.scrollStart = 0;
  }

  SceneHome.prototype.enter = function () {
    this.scroll = 0;
    this.vel = 0;
    this.dragging = false;
    this.moved = 0;
    this.press = null;
    this.chipPress = null;
    this.activeChip = 'all';
    this.layout();
    this.fadeIn = 1;
    this.t = 0;
    return this;
  };

  /** 字号取到 0.5 的整数倍，避免不同屏幕下像素级抖动 */
  function roundHalf(v) { return Math.round(v * 2) / 2; }

  SceneHome.prototype.headerLayout = function () {
    var W = this.W, y = this.heroY;
    return {
      title: { x: 20, y: y + 1, w: Math.min(W * 0.5 - 10, 130), h: 49 },
      stats: { x: W * 0.5, y: y + 28, w: W * 0.5 - 20, h: 13 },
      version: { x: W - 110, y: y + 51, w: 90, h: 10 }
    };
  };

  // 粗估文案像素宽（与卡片文案断言同一口径：CJK=1em，其余≈0.55em）
  SceneHome.prototype.estTextWidth = function (str, size) {
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      w += (str.charCodeAt(i) > 0x2E80) ? size : size * 0.55;
    }
    return w;
  };

  SceneHome.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    this.top = pf.safeTop;
    this.W = W; this.H = H;
    this.heroY = this.top + 16;

    // chip 行：固定在英雄区下方、列表区上方，滚动时吸顶（始终画在屏幕固定位置）
    this.chipY = this.top + 86;
    this.chipH = 34;
    this.chipRects = [];
    var cxp = 16, cgap = 8;
    for (var ci = 0; ci < CHIPS.length; ci++) {
      var cw = this.estTextWidth(CHIPS[ci].name, 13) + 24;
      this.chipRects.push({ x: cxp, y: this.chipY, w: cw, h: this.chipH, id: CHIPS[ci].id, idx: ci });
      cxp += cw + cgap;
    }

    var listTop = this.chipY + this.chipH + 12;
    var listBottom = H - pf.safeBottom - 40;
    var listH = Math.max(60, listBottom - listTop);

    // 构建扁平卡（每款一条，沿用旧版文案 / 图标 / mode / enabled）
    this.cards = this.buildCards();

    // 按当前 chip 过滤出要渲染的组
    var groups = (this.activeChip === 'all')
      ? GROUPS
      : GROUPS.filter(function (g) { return g.id === this.activeChip; }, this);
    var showHeaders = (this.activeChip === 'all');

    var margin = 16, gapX = 12, gapY = 14;
    var colW = (W - margin * 2 - gapX) / 2;
    var headerH = 30, headerGap = 8;
    var cardRows = 0, ng = groups.length;
    for (var gi = 0; gi < groups.length; gi++) {
      cardRows += Math.ceil(groups[gi].games.length / 2);
    }
    // 解出合适卡片高度（装得下就居满，装不下留可读下限 + 整页滚动）
    var CARD_MIN = 108, CARD_MAX = 196;
    var avail = listH - ng * headerH - ng * headerGap - (cardRows - 1) * gapY - 8;
    var cardH = U.clamp(avail / Math.max(1, cardRows), CARD_MIN, CARD_MAX);

    this.cards2 = [];
    this.headers = [];
    var cy = listTop + 4;
    for (var gj = 0; gj < groups.length; gj++) {
      var grp = groups[gj];
      if (showHeaders) {
        this.headers.push({ name: grp.name, cat: grp.id, y: cy, h: headerH });
        cy += headerH + headerGap;
      }
      var items = grp.games.map(function (k) { return this.findCard(k); }, this);
      for (var i = 0; i < items.length; i += 2) {
        var c1 = items[i];
        var y = cy;
        c1.x = margin; c1.y = y; c1.w = colW; c1.h = cardH;
        this.cards2.push(c1);
        if (i + 1 < items.length) {
          var c2 = items[i + 1];
          c2.x = margin + colW + gapX; c2.y = y; c2.w = colW; c2.h = cardH;
          this.cards2.push(c2);
        }
        cy += cardH + gapY;
      }
    }
    var contentH = cy - listTop;
    this.minScroll = Math.min(0, listH - contentH);
    this.scroll = U.clamp(this.scroll, this.minScroll, 0);
    this.listTop = listTop;
    this.listBottom = listBottom;
    this.viewH = listH;
    this.contentH = contentH;
    this.loadThumb();
  };

  // 每款游戏一条卡定义（图标 / 文案 / mode / enabled 沿用旧版，新增 cat 分组标记）
  SceneHome.prototype.buildCards = function () {
    var dailyDone = BF.Save.isDailyDoneToday();
    var photoN = (BF.Photos && BF.Photos.all().length) || 0;
    var diffN = (BF.DIFF_ASSETS && BF.DIFF_ASSETS.length) || 0;
    return [
      { key: 'sudoku', icon: 'sudoku', cat: 'brain', title: '九宫格数独',
        sub: (BF.games.sudoku ? ('挖 36~56 空 · ' + (BF.games.sudoku.TOTAL || 40) + ' 关')
                              : '每行每列每宫 1-9 不重复'),
        mode: 'pickDiff', game: 'sudoku', enabled: !!BF.games.sudoku },

      { key: 'mine', icon: 'mine', cat: 'brain', title: '扫雷',
        sub: (BF.games.mine ? ('保证免猜 · ' + (BF.games.mine.TOTAL || 40) + ' 关')
                            : '避开所有地雷'),
        mode: 'pickDiff', game: 'mine', enabled: !!BF.games.mine },

      { key: 'picross', icon: 'picross', cat: 'brain', title: '数织',
        sub: (BF.games.picross ? ('5×5~15×15 · ' + (BF.games.picross.TOTAL || 40) + ' 关')
                               : '看线索填出彩色像素画'),
        mode: 'pickDiff', game: 'picross', enabled: !!BF.games.picross },

      { key: 'cipher', icon: 'cipher', cat: 'brain', title: '密码推理',
        sub: (BF.games.cipher ? ('逐格/数量提示 · ' + BF.games.cipher.TOTAL + ' 关')
                              : '看反馈推理出隐藏密码'),
        mode: 'levels', game: 'cipher', enabled: !!BF.games.cipher },

      { key: 'bottle', icon: 'bottle', cat: 'brain', title: '瓶子颜色推理',
        sub: (BF.games.bottle ? ('隐藏目标 · ' + BF.games.bottle.TOTAL + ' 关')
                              : '隐藏目标，推理出顺序'),
        mode: 'levels', game: 'bottle', enabled: !!BF.games.bottle },

      { key: 'logic', icon: 'logic', cat: 'brain', title: '逻辑拼图',
        sub: '固定块+自填块 · ' + (BF.games.logic ? BF.games.logic.TOTAL : 60) + ' 关',
        mode: 'levels', game: 'logic', enabled: !!BF.games.logic },

      { key: 'pk24', icon: 'pk24', cat: 'brain', title: '24点',
        sub: (BF.games.pk24 ? '随机发牌 · 无尽挑战' : '凑 4 张牌成 24'),
        mode: 'play', game: 'pk24', enabled: !!BF.games.pk24 },

      { key: 'cat', icon: 'cat', cat: 'brain', title: '猫猫方块',
        sub: (BF.games.cat ? ('每色一只猫 · ' + (BF.games.cat.TOTAL) + ' 关') : '每色一只猫 · 同行列不相邻'),
        mode: 'levels', game: 'cat', enabled: !!BF.games.cat },

      { key: 'redball', icon: 'redball', cat: 'brain', title: '盯红球',
        sub: (BF.games.redball ? ('盯住红球 · ' + (BF.games.redball.TOTAL) + ' 关') : '盯住红球，别跟丢了'),
        mode: 'levels', game: 'redball', enabled: !!BF.games.redball },

      { key: 'tadpole', icon: 'tadpole', cat: 'brain', title: '盯蝌蚪',
        sub: (BF.games.tadpole ? ('盯紧蝌蚪 · ' + (BF.games.tadpole.TOTAL) + ' 关') : '盯紧被标记的蝌蚪'),
        mode: 'levels', game: 'tadpole', enabled: !!BF.games.tadpole },

      { key: 'recall', icon: 'recall', cat: 'brain', title: '瞬时记忆',
        sub: (BF.games.recall ? ('看图几秒 · ' + (BF.games.recall.TOTAL) + ' 关') : '看图几秒，答出细节'),
        mode: 'levels', game: 'recall', enabled: !!BF.games.recall },

      { key: 'daily', icon: 'mini', cat: 'hand', title: '每日挑战',
        sub: dailyDone ? ('今日已完成 ★' + BF.Save.data.daily.stars) : '每天一道新题 · 全服同题',
        mode: 'daily', enabled: true },

      { key: 'block', icon: 'mini', cat: 'hand', title: '方块拼图',
        sub: '俄罗斯方块 · ' + BF.games.block.TOTAL + ' 关',
        mode: 'levels', game: 'block', enabled: true },

      { key: 'blocks', icon: 'blocks', cat: 'hand', title: '超级积木',
        sub: (BF.games.blocks ? ('4 档由易到难 · ' + (BF.games.blocks.TOTAL || 40) + ' 关')
                              : '用彩色积木填满亮起的格子'),
        mode: 'pickDiff', game: 'blocks', enabled: !!BF.games.blocks },

      { key: 'photo', icon: 'photo', cat: 'hand', title: '照片拼图',
        sub: photoN ? ('难度 3×3~8×8 · ' + BF.games.photo.TOTAL + ' 关')
                    : '未内置照片 · 需导入',
        mode: 'levels', game: 'photo', enabled: photoN > 0 },

      { key: 'rush', icon: 'rush', cat: 'hand', title: '移车出库',
        sub: (BF.games.rush ? '滑动车辆让警车驶出 · 4 档' : '滑动车辆让警车驶出'),
        mode: 'pickDiff', game: 'rush', enabled: !!BF.games.rush },

      { key: 'diff', icon: 'diff', cat: 'eye', title: '图片找不同',
        sub: diffN ? ('3~8 处不同 · ' + BF.games.diff.TOTAL + ' 关')
                   : '未内置图对 · 需生成',
        mode: 'pickDiff', game: 'diff', enabled: (!!BF.games.diff) && diffN > 0 }
    ];
  };

  SceneHome.prototype.findCard = function (key) {
    for (var i = 0; i < this.cards.length; i++) {
      if (this.cards[i].key === key) { return this.cards[i]; }
    }
    return null;
  };

  /** 每款已通关进度（进度条用）；daily 无 N，返回 null；pk24 无尽模式特判成「已解题数」 */
  SceneHome.prototype.progressOf = function (c) {
    if (c.mode === 'daily') { return null; }
    if (c.key === 'pk24') {
      var solved = (BF.Save.extraOf('pk24').solved) || 0;
      return { pk24Solved: solved };
    }
    var n = (BF.games[c.game] && BF.games[c.game].TOTAL) || 0;
    if (!n) { n = (c.mode === 'pickDiff' ? 40 : 60); }
    var cleared = BF.Save.clearedCount(c.game);
    return { n: n, c: cleared };
  };

  /** 首页卡片上的照片缩略图：异步加载第一张内置图，拿到就画，拿不到就用占位图标 */
  SceneHome.prototype.loadThumb = function () {
    var self = this;
    if (!this.photoThumb && BF.Photos) {
      var plist = BF.Photos.all();
      if (plist.length) {
        BF.Photos.get(plist[0].src, function (err, img) {
          if (!err && img) { self.photoThumb = img; }
        });
      }
    }
    if (!this.diffThumb && BF.Diffs) {
      var dlist = BF.Diffs.all();
      if (dlist.length) {
        var pair = dlist[0];
        BF.Diffs.get(pair.a, function (err, img) { if (!err && img) { self.diffThumb = img; } });
        BF.Diffs.get(pair.b, function (err, img) { if (!err && img) { self.diffThumbB = img; } });
      }
    }
  };

  SceneHome.prototype.update = function (dt) {
    this.t += dt;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    if (!this.dragging && Math.abs(this.vel) > 0.4) {
      this.scroll += this.vel * (dt / 16);
      this.vel *= Math.pow(0.94, dt / 16);
      if (this.scroll > 0) { this.scroll = 0; this.vel = 0; }
      if (this.scroll < this.minScroll) { this.scroll = this.minScroll; this.vel = 0; }
    }
  };

  SceneHome.prototype.onDown = function (x, y) {
    this.dragging = false;
    this.moved = 0;
    this.dragStartY = y;
    this.scrollStart = this.scroll;
    this.vel = 0;
    this.press = null;
    this.chipPress = null;
    // chip 行优先（固定在屏幕顶部，不参与滚动偏移）
    for (var i = 0; i < this.chipRects.length; i++) {
      if (U.pointInRect(x, y, this.chipRects[i])) { this.chipPress = i; return; }
    }
    for (var j = 0; j < this.cards2.length; j++) {
      if (U.pointInRect(x, y - this.scroll, this.cards2[j])) { this.press = this.cards2[j]; return; }
    }
  };

  SceneHome.prototype.onMove = function (x, y) {
    var dy = y - this.dragStartY;
    this.moved = Math.max(this.moved, Math.abs(dy));
    if (this.moved > 8) { this.press = null; this.chipPress = null; }
    if (this.minScroll === 0) { return; }
    this.dragging = true;
    this.scroll = U.clamp(this.scrollStart + dy, this.minScroll, 0);
    this.vel = dy * 0.35;
  };

  SceneHome.prototype.setChip = function (idx) {
    var id = CHIPS[idx] && CHIPS[idx].id;
    if (!id || id === this.activeChip) { this.activeChip = id || this.activeChip; this.scroll = 0; return; }
    this.activeChip = id;
    this.scroll = 0;
    this.layout();
  };

  SceneHome.prototype.onUp = function (x, y) {
    var c = this.press;
    var chip = this.chipPress;
    var wasDrag = this.dragging;
    var moved = this.moved;
    this.dragging = false;
    this.press = null;
    this.chipPress = null;

    if (chip !== null && !(wasDrag && moved >= 8)) { this.setChip(chip); return; }
    if (wasDrag && moved >= 8) { return; }
    if (!c || !U.pointInRect(x, y - this.scroll, c)) { return; }
    if (!c.enabled) { return; }
    if (c.mode === 'levels') { this.app.go('levels', { game: c.game }); }
    else if (c.mode === 'daily') { this.app.go('play', { daily: true }); }
    else if (c.mode === 'pickDiff') { this.app.go(c.game, { pickDiff: true, game: c.game }); }
    else { this.app.go(c.game, { game: c.game }); }   // 无尽模式（如 24点）：直接进场景
  };

  SceneHome.prototype.render = function (ctx) {
    var W = this.W, H = this.H;
    var hl = this.headerLayout();

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.bgTop);
    bg.addColorStop(1, T.bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 标题
    D.text(ctx, '益智闯关', hl.title.x, hl.title.y + 15,
      { size: 30, weight: '700', align: 'left' });
    D.text(ctx, 'PUZZLE ARCADE', hl.title.x, hl.title.y + 43,
      { size: 11, color: T.textSub, align: 'left', letterSpacing: '1.5px' });
    D.text(ctx, '★ ' + BF.Save.starsAll() + '　·　已通关 ' + BF.Save.countAll() + ' 关',
      W - 20, hl.stats.y + 7, { size: 13, color: T.textSub, align: 'right', weight: '600' });

    // chip 行（吸顶，屏幕固定位置）
    for (var ci = 0; ci < this.chipRects.length; ci++) {
      var ch = this.chipRects[ci];
      var active = (CHIPS[ci].id === this.activeChip);
      var col = (CHIPS[ci].id === 'all') ? T.accent : CAT_COLORS[CHIPS[ci].id];
      if (active) {
        D.fillRound(ctx, ch.x, ch.y, ch.w, ch.h, ch.h / 2, col);
        D.text(ctx, CHIPS[ci].name, ch.x + ch.w / 2, ch.y + ch.h / 2 + 0.5,
          { size: 13, weight: '700', color: '#FFFFFF', align: 'center' });
      } else {
        D.fillRound(ctx, ch.x, ch.y, ch.w, ch.h, ch.h / 2, '#EEF0F3');
        D.text(ctx, CHIPS[ci].name, ch.x + ch.w / 2, ch.y + ch.h / 2 + 0.5,
          { size: 13, color: '#7A818C', align: 'center' });
      }
    }

    // 卡片列表：裁剪 + 滚动
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.listTop, W, this.viewH);
    ctx.clip();
    ctx.translate(0, this.scroll);
    // 分组标题
    for (var hi = 0; hi < this.headers.length; hi++) {
      var hd = this.headers[hi];
      var hc = CAT_COLORS[hd.cat] || T.accent;
      D.text(ctx, hd.name, 18, hd.y + hd.h * 0.72,
        { size: 16, weight: '800', color: hc, align: 'left' });
      // 类目主色短横线
      D.fillRound(ctx, 18, hd.y + hd.h - 7, 22, 3, 1.5, hc);
    }
    for (var i = 0; i < this.cards2.length; i++) {
      this.renderCard(ctx, this.cards2[i]);
    }
    ctx.restore();

    // 滚动渐隐 + 滚动条（拆不掉内容时）
    if (this.minScroll < 0) {
      var mh = 18;
      if (this.scroll < 0) {
        var g1 = ctx.createLinearGradient(0, this.listTop, 0, this.listTop + mh);
        g1.addColorStop(0, T.bg);
        g1.addColorStop(1, U.rgba(T.bg, 0));
        ctx.fillStyle = g1;
        ctx.fillRect(0, this.listTop, W, mh);
      }
      if (this.scroll > this.minScroll) {
        var g2 = ctx.createLinearGradient(0, this.listBottom - mh, 0, this.listBottom);
        g2.addColorStop(0, U.rgba(T.bg, 0));
        g2.addColorStop(1, T.bg);
        ctx.fillStyle = g2;
        ctx.fillRect(0, this.listBottom - mh, W, mh);
      }
      var trackH = this.viewH;
      var thumbH = Math.max(28, trackH * (this.viewH / Math.max(1, this.contentH)));
      var p = this.minScroll === 0 ? 0 : this.scroll / this.minScroll;
      D.fillRound(ctx, W - 7, this.listTop, 3, trackH, 1.5, 'rgba(23,26,31,0.06)');
      D.fillRound(ctx, W - 7, this.listTop + (trackH - thumbH) * p, 3, thumbH, 1.5,
        'rgba(23,26,31,0.20)');
    }

    var foot = '拖方块 · 找不同 · 排瓶子 · 推密码 · 移汽车 · 搭积木 · 填数独 · 扫雷 · 数织 · 算24点';
    D.text(ctx, foot, W / 2, H - BF.platform.safeBottom - 12,
      { size: 11, color: T.textSub, alpha: 0.85 });

    D.text(ctx, 'v' + BF.VERSION, W - 20, hl.version.y + 5,
      { size: 10, color: T.textSub, align: 'right', alpha: 0.6 });

    if (this.fadeIn > 0) {
      ctx.save();
      ctx.globalAlpha = this.fadeIn * 0.85;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  };

  /**
   * 两列网格卡片内部排版（图标尺寸/文字行位/可用宽），全部由卡片矩形推导。
   * 抽成方法让测试能断言「文案不出卡片、图标不被压瘪」。
   */
  SceneHome.prototype.cardInternals = function (x, y, w, h) {
    var pad = 10;
    var isz = U.clamp(h * 0.34, 38, 52);
    var ix = x + (w - isz) / 2, iy = y + pad + 2;
    var titleSize = roundHalf(U.clamp(h * 0.135, 13, 16));
    var titleY = iy + isz + 8;
    var subSize = roundHalf(U.clamp(h * 0.088, 9, 11));
    var subY = titleY + titleSize * 1.15;
    var textMax = w - 14;
    return {
      pad: pad, isz: isz, ix: ix, iy: iy,
      titleSize: titleSize, titleY: titleY,
      subSize: subSize, subY: subY,
      textMax: textMax,
      progY: y + h - 18,
      blockTop: titleY - titleSize * 0.62,
      blockBottom: subY + subSize * 0.62
    };
  };

  /**
   * 两列网格卡片：原图图标在上、标题/副标题居中、底部进度条（或状态）。
   * 图标沿用各游戏自带的矢量画法，不被大类主色覆盖。
   */
  SceneHome.prototype.renderCard = function (ctx, c) {
    var enabled = c.enabled;
    var pressed = this.press === c;
    var scale = pressed ? 0.985 : 1;
    var x = c.x + (c.w * (1 - scale)) / 2, w = c.w * scale;
    var y = c.y + (c.h * (1 - scale)) / 2, h = c.h * scale;
    var float = pressed ? 0 : Math.sin(this.t / 900 + c.y) * 1.0;
    y += float;

    D.panel(ctx, x, y, w, h, {
      radius: 18,
      fill: enabled ? '#FFFFFF' : '#E8EAEE',
      shadowBlur: enabled ? 12 : 0, shadowOffsetY: 3
    });

    // 每日挑战：右上「今日」角标
    if (c.key === 'daily') {
      D.fillRound(ctx, x + w - 44, y + 8, 36, 16, 8, '#1FB6B6');
      D.text(ctx, '今日', x + w - 44 + 18, y + 8 + 8.5, { size: 10, weight: '700', color: '#FFFFFF', align: 'center' });
    }

    // 图标（顶部居中，沿用原图标画法）+ 居中文案
    var g = this.cardInternals(x, y, w, h);
    this.renderIconByKey(ctx, c.icon, c, g.ix, g.iy, g.isz);
    D.text(ctx, c.title, x + w / 2, g.titleY,
      { size: g.titleSize, weight: '700', align: 'center', color: enabled ? T.text : '#A0A5AD', maxWidth: g.textMax });
    D.text(ctx, c.sub, x + w / 2, g.subY,
      { size: g.subSize, color: T.textSub, align: 'center', maxWidth: g.textMax });

    // 底部：进度 / 状态
    var progY = g.progY;
    if (!enabled) {
      D.text(ctx, '暂未开放', x + w / 2, progY, { size: 10.5, color: '#A0A5AD', align: 'center' });
    } else if (c.key === 'daily') {
      var done = BF.Save.isDailyDoneToday();
      D.text(ctx, done ? ('已完成 ★' + BF.Save.data.daily.stars) : '点击开始今日挑战',
        x + w / 2, progY, { size: 10.5, color: done ? T.ok : T.accent, align: 'center', weight: '600' });
    } else {
      var pg = this.progressOf(c);
      if (pg) {
        if (pg.pk24Solved !== undefined) {
          // 24点无尽模式：不画进度条，显示已解题数
          D.text(ctx, pg.pk24Solved > 0 ? ('已解 ' + pg.pk24Solved + ' 题') : '点击开始挑战',
            x + w / 2, progY, { size: 10.5, color: pg.pk24Solved > 0 ? T.accent : T.textSub, align: 'center', weight: '600' });
        } else {
          var barX = x + 16, barW = w - 32, barH = 5;
          D.fillRound(ctx, barX, progY, barW, barH, barH / 2, 'rgba(23,26,31,0.08)');
          var frac = U.clamp(pg.c / pg.n, 0, 1);
          if (frac > 0) {
            var col = (c.cat && CAT_COLORS[c.cat]) || T.accent;
            D.fillRound(ctx, barX, progY, Math.max(barH, barW * frac), barH, barH / 2, col);
          }
          var label = pg.c > 0 ? (pg.c + '/' + pg.n) : '未开始';
          D.text(ctx, label, x + w / 2, progY + 12, { size: 10, color: T.textSub, align: 'center' });
        }
      }
    }
  };

  SceneHome.prototype.renderIconByKey = function (ctx, icon, c, ix, iy, isz) {
    if (icon === 'mini') { this.renderMiniIcon(ctx, c, ix, iy, isz); }
    else if (icon === 'logic') { this.renderLogicIcon(ctx, ix, iy, isz); }
    else if (icon === 'photo') { this.renderPhotoIcon(ctx, ix, iy, isz); }
    else if (icon === 'diff') { this.renderDiffIcon(ctx, ix, iy, isz); }
    else if (icon === 'bottle') { this.renderBottleIcon(ctx, ix, iy, isz); }
    else if (icon === 'cipher') { this.renderCipherIcon(ctx, ix, iy, isz); }
    else if (icon === 'rush') { this.renderRushIcon(ctx, ix, iy, isz); }
    else if (icon === 'blocks') { this.renderBlocksIcon(ctx, ix, iy, isz); }
    else if (icon === 'sudoku') { this.renderSudokuIcon(ctx, ix, iy, isz); }
    else if (icon === 'mine') { this.renderMineIcon(ctx, ix, iy, isz); }
    else if (icon === 'picross') { this.renderPicrossIcon(ctx, ix, iy, isz); }
    else if (icon === 'pk24') { this.renderPk24Icon(ctx, ix, iy, isz); }
    else if (icon === 'cat') { this.renderCatIcon(ctx, ix, iy, isz); }
    else if (icon === 'redball') { this.renderRedballIcon(ctx, ix, iy, isz); }
    else if (icon === 'tadpole') { this.renderTadpoleIcon(ctx, ix, iy, isz); }
    else if (icon === 'recall') { this.renderRecallIcon(ctx, ix, iy, isz); }
    else {
      D.fillRound(ctx, ix, iy, isz, isz, 14, '#DDE0E5');
      D.icon(ctx, 'lock', ix + isz / 2, iy + isz / 2, isz * 0.34, '#A7ACB4');
    }
  };

  /** 游戏 1 / 每日挑战的图标：让生成器画一张已填满的小拼图 */
  SceneHome.prototype.renderMiniIcon = function (ctx, c, ix, iy, isz) {
    D.fillRound(ctx, ix, iy, isz, isz, 14, c.key === 'daily' ? '#F6F0E2' : '#EDF1F7');
    var seed = c.key === 'daily' ? U.seedFromDate(new Date()) % 2147483647 : 20260930;
    var mini = BF.generator.generate({ size: 4, pieceCount: 5, seed: seed, shuffle: false });
    var padIn = isz * 0.16;
    var cell = (isz - padIn * 2) / mini.size;
    for (var k = 0; k < mini.pieces.length; k++) {
      var p = mini.pieces[k];
      D.block(ctx, ix + padIn + p.x * cell, iy + padIn + p.y * cell,
        p.w * cell, p.h * cell, BF.colorOf(p.color), { pad: 1, radius: cell * 0.18 });
    }
    if (c.key === 'daily') {
      D.icon(ctx, 'clock', ix + isz - 13, iy + 13, 15, '#B99A5A', { alpha: 0.9 });
    }
  };

  /** 游戏 2 的图标：缩小版题面 —— 圆环点阵 + 墨黑固定块，一眼看出玩法 */
  SceneHome.prototype.renderLogicIcon = function (ctx, ix, iy, isz) {
    var LT = BF.LOGIC_THEME;
    var thumb = getLogicThumb();
    D.fillRound(ctx, ix, iy, isz, isz, 14, LT.boardBg);

    var padIn = isz * 0.10;
    var inner = isz - padIn * 2;
    var cell = inner / thumb.size;
    D.dotGrid(ctx, ix + padIn, iy + padIn, thumb.size, cell,
      { ring: LT.dotRing, hole: LT.dotHole });

    for (var k = 0; k < thumb.pieces.length; k++) {
      var p = thumb.pieces[k];
      if (!p.fixed) { continue; }
      D.block(ctx, ix + padIn + p.x * cell, iy + padIn + p.y * cell,
        p.w * cell, p.h * cell, LT.fixed,
        { pad: 0.6, radius: cell * 0.14, shadow: false });
    }
    var rest = thumb.pieces.filter(function (q) { return !q.fixed; })
      .sort(function (a, b) { return b.w * b.h - a.w * a.h; }).slice(0, 2);
    for (k = 0; k < rest.length; k++) {
      var q = rest[k];
      D.block(ctx, ix + padIn + q.x * cell, iy + padIn + q.y * cell,
        q.w * cell, q.h * cell, BF.logicColorOf(q.color).base,
        { pad: 0.6, radius: cell * 0.10, shadow: false, alpha: 0.9 });
    }
  };

  /** 照片拼图卡片图标：真实缩略图 + 一道十字切缝，一眼看出"是把照片切成块" */
  SceneHome.prototype.renderPhotoIcon = function (ctx, ix, iy, isz) {
    var img = this.photoThumb;
    var r = 14;
    if (!img) {
      D.fillRound(ctx, ix, iy, isz, isz, r, '#DDE0E5');
      D.fillRound(ctx, ix + isz * 0.16, iy + isz * 0.22, isz * 0.68, isz * 0.56, 6, '#F2F4F7');
      ctx.save();
      ctx.fillStyle = '#8FB6D8';
      ctx.beginPath();
      ctx.moveTo(ix + isz * 0.20, iy + isz * 0.68);
      ctx.lineTo(ix + isz * 0.44, iy + isz * 0.36);
      ctx.lineTo(ix + isz * 0.68, iy + isz * 0.68);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#F0C24A';
      ctx.beginPath();
      ctx.arc(ix + isz * 0.68, iy + isz * 0.36, isz * 0.07, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    D.photoSlice(ctx, ix, iy, isz, isz, img, { u: 0, v: 0, uw: 1, vh: 1 },
      { radius: r, stroke: false, shadow: false });
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1.5, isz * 0.028);
    ctx.beginPath();
    ctx.moveTo(ix + isz / 2, iy + r * 0.4);
    ctx.lineTo(ix + isz / 2, iy + isz - r * 0.4);
    ctx.moveTo(ix + r * 0.4, iy + isz / 2);
    ctx.lineTo(ix + isz - r * 0.4, iy + isz / 2);
    ctx.stroke();
    ctx.restore();
    D.roundRect(ctx, ix + 0.5, iy + 0.5, isz - 1, isz - 1, r);
    ctx.strokeStyle = 'rgba(23,26,31,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  /**
   * 找不同卡片图标：把第一对图的 A/B 上下并排缩进来画，再在 B 的某处差异位置点一个圈。
   */
  SceneHome.prototype.renderDiffIcon = function (ctx, ix, iy, isz) {
    var r = 10;
    var imgA = this.diffThumb, imgB = this.diffThumbB;
    var padIn = isz * 0.06;
    var w = isz - padIn * 2;
    var h = (isz - padIn * 2 - 6) / 2;
    var ax = ix + padIn, ay = iy + padIn;
    var by = ay + h + 6;

    if (!imgA || !imgB) {
      D.fillRound(ctx, ix, iy, isz, isz, r, '#DDE0E5');
      D.fillRound(ctx, ax, ay, w, h, 6, '#C9D6E4');
      D.fillRound(ctx, ax, by, w, h, 6, '#D6C6B4');
      this.diffRing(ctx, ax + w * 0.68, by + h * 0.5, Math.min(w, h) * 0.26, T.accent);
      return;
    }

    D.photoSlice(ctx, ax, ay, w, h, imgA, { u: 0, v: 0, uw: 1, vh: 1 }, { radius: 6, stroke: false, shadow: false });
    D.photoSlice(ctx, ax, by, w, h, imgB, { u: 0, v: 0, uw: 1, vh: 1 }, { radius: 6, stroke: false, shadow: false });

    var pair = (BF.Diffs && BF.Diffs.all()[0]) || null;
    if (pair && pair.diffs && pair.diffs.length) {
      var d = pair.diffs[0];
      this.diffRing(ctx,
        ax + (d.u + d.uw / 2) * w, by + (d.v + d.vh / 2) * h,
        Math.min(d.uw * w, d.vh * h) * 0.5 + Math.min(w, h) * 0.06, T.accent);
    }

    D.roundRect(ctx, ix + 0.5, iy + 0.5, isz - 1, isz - 1, r);
    ctx.strokeStyle = 'rgba(23,26,31,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  SceneHome.prototype.diffRing = function (ctx, cx, cy, rr, color) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.fillStyle = U.rgba(color, 0.16);
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = U.rgba(color, 0.95);
    ctx.stroke();
    ctx.restore();
  };

  /** 瓶子颜色推理卡片图标：3 个彩色小瓶并排 */
  SceneHome.prototype.renderBottleIcon = function (ctx, ix, iy, isz) {
    var pal = (BF.BottleGen && BF.BottleGen.palette) || [];
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#EAF1FB');
    var cols = [0, 1, 2];
    var n = cols.length;
    var padIn = isz * 0.16;
    var inner = isz - padIn * 2;
    var cellW = inner / n;
    var bw = cellW * 0.52, bh = inner * 0.64;
    for (var k = 0; k < n; k++) {
      var p = pal[cols[k]] || { hex: '#3A86FF' };
      var cx = ix + padIn + cellW * (k + 0.5);
      var by = iy + padIn + (inner - bh) / 2;
      D.fillRound(ctx, cx - bw / 2, by, bw, bh, bw * 0.34, p.hex);
      D.fillRound(ctx, cx - bw * 0.18, by - bh * 0.16, bw * 0.36, bh * 0.22, bw * 0.10, U.shade(p.hex, -0.18));
      ctx.save();
      var hg = ctx.createLinearGradient(cx - bw / 2, by, cx, by);
      hg.addColorStop(0, 'rgba(255,255,255,0.34)');
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      D.roundRect(ctx, cx - bw / 2 + bw * 0.12, by + bh * 0.1, bw * 0.18, bh * 0.6, bw * 0.08);
      ctx.fillStyle = hg; ctx.fill();
      ctx.restore();
    }
  };

  SceneHome.prototype.renderCipherIcon = function (ctx, ix, iy, isz) {
    var pal = (BF.CipherGen && BF.CipherGen.palette) || [];
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#2F333A');
    var padIn = isz * 0.16;
    var inner = isz - padIn * 2;
    var cols = 3;
    var gap = inner * 0.075;
    var fbW = inner * 0.20;
    var gridW = inner - fbW - gap;
    var cw = (gridW - gap * (cols - 1)) / cols;
    var rowGap = cw * 0.30;
    var y0 = iy + padIn + (inner - (cw * 2 + rowGap)) / 2;
    var pick = [0, 4, 5];
    var r, c, x, y;
    for (r = 0; r < 2; r++) {
      for (c = 0; c < cols; c++) {
        x = ix + padIn + c * (cw + gap);
        y = y0 + r * (cw + rowGap);
        if (r === 0) {
          D.fillRound(ctx, x, y, cw, cw, cw * 0.26, (pal[pick[c]] || { hex: '#2D6CDF' }).hex);
        } else {
          D.fillRound(ctx, x, y, cw, cw, cw * 0.26, '#464C55');
          D.text(ctx, '?', x + cw / 2, y + cw / 2 + 0.5,
            { size: cw * 0.68, weight: '800', color: 'rgba(255,255,255,0.30)' });
        }
      }
    }
    var fx = ix + padIn + gridW + gap + fbW / 2;
    var dr = Math.max(2, cw * 0.15);
    D.fillRound(ctx, fx - dr - dr * 1.5, y0 + cw * 0.30 - dr, dr * 2, dr * 2, dr, '#2EA44F');
    ctx.save();
    D.roundRect(ctx, fx + dr * 0.5 - dr, y0 + cw * 0.30 - dr, dr * 2, dr * 2, dr);
    ctx.fillStyle = '#FFFFFF'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    D.fillRound(ctx, fx - dr, y0 + cw + rowGap + cw * 0.5 - dr, dr * 2, dr * 2, dr, '#111418');
  };

  SceneHome.prototype.renderRushIcon = function (ctx, ix, iy, isz) {
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#EBEEF2');
    var n = 4, padIn = isz * 0.12, inner = isz - padIn * 2, cw = inner / n;
    ctx.save();
    ctx.strokeStyle = 'rgba(23,26,31,0.05)'; ctx.lineWidth = 1;
    for (var gx = 1; gx < n; gx++) {
      ctx.beginPath();
      ctx.moveTo(ix + padIn + gx * cw, iy + padIn);
      ctx.lineTo(ix + padIn + gx * cw, iy + padIn + inner);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ix + padIn, iy + padIn + gx * cw);
      ctx.lineTo(ix + padIn + inner, iy + padIn + gx * cw);
      ctx.stroke();
    }
    ctx.restore();

    var cols = ['#E63946', '#06AED7', '#2EA44F', '#E9BC00'];
    var i, k = 0;
    for (i = 0; i < 3; i++) {
      var cx = ix + padIn + (i % 3) * cw * 1.02 + cw * 0.12;
      var cyy = iy + padIn + (i < 3 ? cw * 0.18 : 0);
      D.fillRound(ctx, cx, cyy, cw * 0.78, cw * 0.5, cw * 0.18, cols[i]);
    }
    var px = ix + padIn + cw * 0.12, py = iy + padIn + inner - cw * 0.62;
    var pw = cw * 1.5, ph = cw * 0.5;
    D.fillRound(ctx, px, py, pw, ph, ph * 0.32, '#F4F4F4');
    ctx.save();
    D.roundRect(ctx, px + 0.5, py + 0.5, pw - 1, ph - 1, ph * 0.32);
    ctx.strokeStyle = 'rgba(23,26,31,0.16)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    var barY = py + ph * 0.12, barH = ph * 0.24;
    D.fillRound(ctx, px + pw * 0.34, barY, pw * 0.16, barH, barH * 0.4, '#E63946');
    D.fillRound(ctx, px + pw * 0.50, barY, pw * 0.16, barH, barH * 0.4, '#2D6CDF');

    var ay = iy + isz * 0.5, ax0 = ix + isz - isz * 0.30;
    ctx.save();
    ctx.strokeStyle = T.accent; ctx.lineWidth = Math.max(2, isz * 0.035);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(ax0 - isz * 0.10, ay - isz * 0.10);
    ctx.lineTo(ax0 + isz * 0.06, ay);
    ctx.lineTo(ax0 - isz * 0.10, ay + isz * 0.10);
    ctx.stroke();
    ctx.restore();
  };

  SceneHome.prototype.renderBlocksIcon = function (ctx, ix, iy, isz) {
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#F3F0E7');
    var Gen = BF.BlocksGen;
    var n = 8, padIn = isz * 0.13, inner = isz - padIn * 2, cw = inner / n;
    for (var gx = 0; gx < n; gx++) {
      for (var gy = 0; gy < n; gy++) {
        D.fillRound(ctx, ix + padIn + gx * cw, iy + padIn + gy * cw, cw - 1, cw - 1, 1, '#FDEBC8');
      }
    }
    if (!Gen) { return; }
    var ids = [0, 4, 8, 12];
    var oxs = [0, 5, 0, 5], oys = [0, 0, 5, 5];
    for (var k = 0; k < ids.length; k++) {
      var id = ids[k];
      if (id >= Gen.SHAPES.length) { continue; }
      var cells = Gen.PIECE_ROT[id][0];
      var col = Gen.COLOR_HEX[Gen.SHAPES[id].c];
      for (var ci = 0; ci < cells.length; ci++) {
        var gx2 = oxs[k] + cells[ci][0], gy2 = oys[k] + cells[ci][1];
        if (gx2 >= n || gy2 >= n) { continue; }
        D.block(ctx, ix + padIn + gx2 * cw, iy + padIn + gy2 * cw, cw - 1, cw - 1, col,
          { pad: 0.8, radius: cw * 0.28 });
      }
    }
  };

  SceneHome.prototype.renderSudokuIcon = function (ctx, ix, iy, isz) {
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#EDF1F7');
    var n = 9, padIn = isz * 0.12, inner = isz - padIn * 2, cw = inner / n;
    D.fillRound(ctx, ix + padIn - 1, iy + padIn - 1, inner + 2, inner + 2, 3, '#FFFFFF');
    var givens = [
      [0, 0, 5], [1, 0, 3], [4, 0, 7],
      [0, 1, 6], [3, 1, 1], [4, 1, 9], [5, 1, 5],
      [1, 2, 9], [2, 2, 8], [7, 2, 6],
      [0, 3, 8], [4, 3, 6], [8, 3, 3],
      [0, 4, 4], [3, 4, 8], [5, 4, 3], [8, 4, 1],
      [0, 5, 7], [4, 5, 2], [8, 5, 6],
      [1, 6, 6], [6, 6, 2], [7, 6, 8],
      [3, 7, 4], [4, 7, 1], [5, 7, 9], [8, 7, 5],
      [4, 8, 8], [7, 8, 7], [8, 8, 9]
    ];
    var filled = [[2, 0, 4], [6, 1, 7], [2, 3, 5], [6, 4, 5], [2, 6, 3], [6, 7, 1]];
    var i, gx, gy;
    for (i = 0; i < givens.length; i++) {
      gx = givens[i][0]; gy = givens[i][1];
      D.text(ctx, String(givens[i][2]),
        ix + padIn + gx * cw + cw / 2, iy + padIn + gy * cw + cw / 2 + cw * 0.16,
        { size: Math.max(5, Math.round(cw * 0.62)), weight: '700', color: T.text });
    }
    for (i = 0; i < filled.length; i++) {
      gx = filled[i][0]; gy = filled[i][1];
      D.text(ctx, String(filled[i][2]),
        ix + padIn + gx * cw + cw / 2, iy + padIn + gy * cw + cw / 2 + cw * 0.16,
        { size: Math.max(5, Math.round(cw * 0.62)), weight: '600', color: T.accent });
    }
    ctx.save();
    for (var k = 0; k <= n; k++) {
      ctx.strokeStyle = (k % 3 === 0) ? 'rgba(23,26,31,0.42)' : 'rgba(23,26,31,0.12)';
      ctx.lineWidth = (k % 3 === 0) ? 1.4 : 0.7;
      var p = ix + padIn + k * cw;
      ctx.beginPath();
      ctx.moveTo(p, iy + padIn); ctx.lineTo(p, iy + padIn + inner);
      ctx.moveTo(ix + padIn, p); ctx.lineTo(ix + padIn + inner, p);
      ctx.stroke();
    }
    ctx.restore();
  };

  SceneHome.prototype.renderMineIcon = function (ctx, ix, iy, isz) {
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#EDF1F7');
    var cx = ix + isz * 0.5, cy = iy + isz * 0.56, r = isz * 0.20;
    var col = '#2C3138';
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.lineWidth = Math.max(1.5, isz * 0.05);
    var sp = isz * 0.30;
    ctx.beginPath();
    ctx.moveTo(cx - sp, cy); ctx.lineTo(cx + sp, cy);
    ctx.moveTo(cx, cy - sp); ctx.lineTo(cx, cy + sp);
    ctx.moveTo(cx - sp * 0.7, cy - sp * 0.7); ctx.lineTo(cx + sp * 0.7, cy + sp * 0.7);
    ctx.moveTo(cx - sp * 0.7, cy + sp * 0.7); ctx.lineTo(cx + sp * 0.7, cy - sp * 0.7);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    var fx = ix + isz * 0.72, fy = iy + isz * 0.18;
    ctx.strokeStyle = '#C0392B'; ctx.fillStyle = '#C0392B';
    ctx.lineWidth = Math.max(1.5, isz * 0.04);
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy + isz * 0.22); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(fx, fy); ctx.lineTo(fx + isz * 0.16, fy + isz * 0.07);
    ctx.lineTo(fx, fy + isz * 0.14); ctx.closePath(); ctx.fill();
    ctx.restore();
  };

  SceneHome.prototype.renderPicrossIcon = function (ctx, ix, iy, isz) {
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#EDF1F7');
    var n = 5;
    var gut = Math.max(4, isz * 0.15);
    var inner = isz * 0.66;
    var cw = inner / n;
    var bx = ix + (isz - inner - gut) / 2 + gut;
    var by = iy + (isz - inner - gut) / 2 + gut;
    var gx, gy, k;
    for (gx = 0; gx < n; gx++) {
      for (gy = 0; gy < n; gy++) {
        D.fillRound(ctx, bx + gx * cw + 0.4, by + gy * cw + 0.4, cw - 0.8, cw - 0.8, 1, '#FFFFFF');
      }
    }
    var pic = ['.R.R.', 'RRRRR', 'RRRRR', '.RRR.', '..R..'];
    for (gy = 0; gy < n; gy++) {
      for (gx = 0; gx < n; gx++) {
        if (pic[gy].charAt(gx) === 'R') {
          D.fillRound(ctx, bx + gx * cw + 0.4, by + gy * cw + 0.4, cw - 0.8, cw - 0.8, 1, '#E4572E');
        }
      }
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(23,26,31,0.12)';
    ctx.lineWidth = 0.6;
    for (k = 0; k <= n; k++) {
      ctx.beginPath();
      ctx.moveTo(bx + k * cw, by); ctx.lineTo(bx + k * cw, by + inner);
      ctx.moveTo(bx, by + k * cw); ctx.lineTo(bx + inner, by + k * cw);
      ctx.stroke();
    }
    ctx.restore();
    var fs = Math.max(5, Math.round(isz * 0.13));
    D.text(ctx, '3', bx - gut * 0.55, by + cw * 2.5, { size: fs, weight: '700', color: '#8B9199' });
    D.text(ctx, '2', bx + cw * 1.5, by - gut * 0.55, { size: fs, weight: '700', color: '#8B9199' });
  };

  /** 24点卡片图标：一张扑克牌（红桃）+ 角标「24」，一眼看出玩法 */
  SceneHome.prototype.renderPk24Icon = function (ctx, ix, iy, isz) {
    var padIn = isz * 0.14;
    var w = isz - padIn * 2, h = isz - padIn * 2;
    var x = ix + padIn, y = iy + padIn;
    var r = Math.min(w, h) * 0.16;
    // 牌底（白卡 + 轻微投影）
    ctx.save();
    D.fillRound(ctx, x, y, w, h, r, '#FFFFFF');
    ctx.restore();
    // 角标花色（红桃，红色）+ 角标数字
    var red = '#E5484D';
    D.text(ctx, '♥', x + w * 0.18, y + h * 0.30, { size: w * 0.30, weight: '700', color: red });
    D.text(ctx, 'K', x + w * 0.18, y + h * 0.60, { size: w * 0.34, weight: '800', color: red });
    // 中央大「24」主视觉
    D.text(ctx, '24', x + w * 0.82, y + h * 0.54, { size: w * 0.42, weight: '800', color: T.text, align: 'center' });
    // 描边压边
    ctx.save();
    D.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.strokeStyle = 'rgba(23,26,31,0.12)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  };

  /** 猫猫方块卡片图标：一块浅色棋盘 + 一只彩色小猫，一眼看出玩法 */
  SceneHome.prototype.renderCatIcon = function (ctx, ix, iy, isz) {
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#FBEFF0');
    var COLS = BF.CatGen && BF.CatGen.COLORS ? BF.CatGen.COLORS
      : ['#FF6B6B', '#FFA94D', '#FCC419', '#69DB7C', '#38D9A9', '#4DABF7', '#9775FA', '#F783AC'];
    // 3×3 小棋盘，两种区域色 + 一只小猫
    var n = 3, padIn = isz * 0.16, inner = isz - padIn * 2, cw = inner / n;
    var region = [[0, 1, 1], [0, 0, 1], [2, 2, 1]];
    for (var gy = 0; gy < n; gy++) {
      for (var gx = 0; gx < n; gx++) {
        var col = COLS[region[gy][gx]] || '#CCCCCC';
        D.fillRound(ctx, ix + padIn + gx * cw + 1, iy + padIn + gy * cw + 1,
          cw - 2, cw - 2, cw * 0.16, U.rgba(col, 0.30));
      }
    }
    // 中央放一只小猫
    drawCatHome(ctx, ix + isz / 2, iy + isz / 2, inner, COLS[0]);
  };

  /** 盯红球卡片图标：几颗小球里一颗红球，一眼看出玩法 */
  SceneHome.prototype.renderRedballIcon = function (ctx, ix, iy, isz) {
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#EAF1FB');
    var r = isz * 0.17;
    var blues = [[0.30, 0.34], [0.66, 0.30], [0.46, 0.64], [0.74, 0.66]];
    for (var i = 0; i < blues.length; i++) {
      drawBallHome(ctx, ix + isz * blues[i][0], iy + isz * blues[i][1], r, '#4C8DFF');
    }
    drawBallHome(ctx, ix + isz * 0.32, iy + isz * 0.66, r * 1.12, '#FF5B5B');
  };

  // 盯蝌蚪首页卡图标：淡黄底 + 两只迷你蝌蚪，其中一只被红虚线圈住
  SceneHome.prototype.renderTadpoleIcon = function (ctx, ix, iy, isz) {
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#FBEFC9');
    var r = isz * 0.16;
    miniTadpoleHome(ctx, ix + isz * 0.36, iy + isz * 0.42, r, 0.25);
    miniTadpoleHome(ctx, ix + isz * 0.68, iy + isz * 0.66, r, -0.7);
    ctx.save();
    ctx.strokeStyle = '#FF5B5B';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(ix + isz * 0.36, iy + isz * 0.42, r * 1.75, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  };

  /** 瞬时记忆首页卡图标：迷你场景卡 + 4 件彩色物品 + 问号 + 钟表（纯矢量，不依赖场景文件） */
  SceneHome.prototype.renderRecallIcon = function (ctx, ix, iy, isz) {
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#EAF1FB');
    var pad = isz * 0.13, w = isz - pad * 2;
    var x = ix + pad, y = iy + pad;
    D.fillRound(ctx, x, y, w, w, 8, '#FFFFFF');
    var pts = [
      [0.28, 0.30, '#4C8DFF', 1],
      [0.70, 0.28, '#FF5B5B', 0],
      [0.30, 0.70, '#F2C13C', 0],
      [0.70, 0.70, '#4E9C63', 1]
    ];
    var s = w * 0.24;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], cx = x + w * p[0], cy = y + w * p[1];
      if (p[3]) {
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.46, 0, Math.PI * 2);
        ctx.fillStyle = p[2]; ctx.fill();
      } else {
        D.fillRound(ctx, cx - s * 0.5, cy - s * 0.36, s, s * 0.72, s * 0.16, p[2]);
      }
    }
    // 右上问号徽标（记忆问答）
    var qx = ix + isz * 0.80, qy = iy + isz * 0.21, qr = isz * 0.15;
    ctx.beginPath(); ctx.arc(qx, qy, qr, 0, Math.PI * 2);
    ctx.fillStyle = '#2C3036'; ctx.fill();
    D.text(ctx, '?', qx, qy + 0.5, { size: qr * 1.2, weight: '800', color: '#FFFFFF' });
    // 右下小钟表（限时观察）
    D.icon(ctx, 'clock', ix + isz * 0.82, iy + isz * 0.83, isz * 0.19, '#3E6FBF', { alpha: 0.9 });
  };

  function miniTadpoleHome(ctx, x, y, r, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.strokeStyle = '#2B2F38';
    ctx.lineWidth = r * 0.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, r * 0.45);
    ctx.quadraticCurveTo(-r * 1.0, r * 1.25, -r * 1.7, r * 0.15);
    ctx.stroke();
    ctx.fillStyle = '#2B2F38';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(r * 0.30, -r * 0.20, r * 0.20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBallHome(ctx, cx, cy, r, color) {
    var g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, U.shade(color, 0.34));
    g.addColorStop(1, U.shade(color, -0.06));
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.translate(cx - r * 0.3, cy - r * 0.38);
    ctx.rotate(-0.6);
    ctx.scale(1, 0.22 / 0.34);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCatHome(ctx, cx, cy, s, color) {
    var R = s * 0.20;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.78, cy - R * 0.40);
    ctx.lineTo(cx - R * 0.18, cy - R * 1.08);
    ctx.lineTo(cx - R * 0.02, cy - R * 0.30);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + R * 0.78, cy - R * 0.40);
    ctx.lineTo(cx + R * 0.18, cy - R * 1.08);
    ctx.lineTo(cx + R * 0.02, cy - R * 0.30);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(cx - R * 0.38, cy - R * 0.04, R * 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + R * 0.38, cy - R * 0.04, R * 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2C3138';
    ctx.beginPath(); ctx.arc(cx - R * 0.38, cy - R * 0.04, R * 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + R * 0.38, cy - R * 0.04, R * 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#E5748B';
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.10, cy + R * 0.20);
    ctx.lineTo(cx + R * 0.10, cy + R * 0.20);
    ctx.lineTo(cx, cy + R * 0.34);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  BF.SceneHome = SceneHome;
})();
