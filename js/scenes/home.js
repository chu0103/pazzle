/**
 * home.js —— 合集首页
 * 卡片列表：每款游戏一张卡（关卡数从 BF.games 注册表读）+ 每日挑战 + 敬请期待。
 * 卡片图标不额外做美术：游戏 1 直接让生成器画一张小拼图，
 * 游戏 2 画一张缩小版的题面（圆环点阵 + 墨黑固定块）。
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

  function SceneHome(app) {
    this.app = app;
    this.press = null;
    this.fadeIn = 1;
    this.t = 0;
    this.cards = [];
    // 卡片列表滚动（口径与 levels 一致：scroll ∈ [minScroll, 0]，越小内容越往上）
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
    this.layout();      // layout 会按可用高度算出 minScroll / contentH
    this.fadeIn = 1;
    this.t = 0;
    return this;
  };

  /** 字号取到 0.5 的整数倍，避免不同屏幕下像素级抖动 */
  function roundHalf(v) { return Math.round(v * 2) / 2; }

  /**
   * 首页顶部三块内容的几何（标题块 / 右上统计 / 版本号）。
   * 抽成方法是为了让测试能直接断言「它们互不重叠」——
   * 版本号一度被放在左上角 (12, safeTop+18)，正好压在 30px 的「益智闯关」上，
   * 肉眼看截图才发现。布局坐标能被断言，这类问题才不会再漏。
   */
  SceneHome.prototype.headerLayout = function () {
    var W = this.W, y = this.heroY;
    return {
      // 两行标题：「益智闯关」（30px×4字≈120px）+「PUZZLE ARCADE」（11px）
      // 宽度取 130 的保守包围盒（真实文字约 120，留 10 余量）
      title: { x: 20, y: y + 1, w: Math.min(W * 0.5 - 10, 130), h: 49 },
      // 右上统计「★ n · 已通关 n 关」，右对齐 W-20
      stats: { x: W * 0.5, y: y + 28, w: W * 0.5 - 20, h: 13 },
      // 版本号：压在统计行**下方**的右侧，与左侧标题天然分开，纵向也拉开 22px
      version: { x: W - 110, y: y + 51, w: 90, h: 10 }
    };
  };

  SceneHome.prototype.layout = function () {
    var pf = BF.platform, W = pf.width, H = pf.height;
    this.top = pf.safeTop;
    this.W = W; this.H = H;

    this.heroY = this.top + 16;

    // 卡片区：在标题与底部提示之间垂直居中，高度自适应。
    // ⚠️ 卡片高度必须有「可读下限」：早期只防了负数（避免 arc 负半径崩屏），
    // 结果是真机 iPhone 8（375×667）上 11 张卡把高度压到 36px，
    // 而标题固定 17px、副标题 11.5px —— 文案比卡片还高，直接顶出卡片上下边，
    // 左侧图标也被压成 8px。现在：装得下就居中铺开，装不下就保持可读高度 + 整页可滚动。
    var CARD_MIN_H = 46;    // 14px 标题 + 9.5px 副标题 也还能读
    var CARD_MAX_H = 132;
    var listTop = this.top + 92;
    var listBottom = H - pf.safeBottom - 40;
    var listH = Math.max(60, listBottom - listTop);
    var gap = 14;
    // 12 张卡：方块/逻辑/每日/照片/找不同/瓶子/密码/移车出库/超级积木/九宫格数独/扫雷/数织
    var NCARDS = 12;
    var fitH = (listH - gap * (NCARDS - 1)) / NCARDS;
    var ch = U.clamp(fitH, CARD_MIN_H, CARD_MAX_H);
    var contentH = ch * NCARDS + gap * (NCARDS - 1);
    var step = ch + gap;
    var cardY = listTop + (contentH <= listH ? (listH - contentH) / 2 : 0);

    this.listTop = listTop;
    this.listBottom = listBottom;
    this.viewH = listH;
    this.ncards = NCARDS;
    this.contentH = contentH;
    this.minScroll = Math.min(0, listH - contentH);
    this.scroll = U.clamp(this.scroll, this.minScroll, 0);

    var dailyDone = BF.Save.isDailyDoneToday();
    // 照片拼图没有内置图时整张卡片置灰 —— 与其点进去白屏，不如说清楚缺什么
    var photoN = (BF.Photos && BF.Photos.all().length) || 0;
    // 图片找不同没有内置图对时同理置灰
    var diffN = (BF.DIFF_ASSETS && BF.DIFF_ASSETS.length) || 0;

    this.cards = [
      { key: 'block', icon: 'mini', y: cardY, h: ch, title: '方块拼图',
        sub: '俄罗斯方块式益智拼图 · ' + BF.games.block.TOTAL + ' 关',
        mode: 'levels', game: 'block', enabled: true },

      { key: 'logic', icon: 'logic', y: cardY + step, h: ch, title: '逻辑拼图',
        sub: '固定 3 块 + 自填 8 块 · ' + (BF.games.logic ? BF.games.logic.TOTAL : 60) + ' 关',
        mode: 'levels', game: 'logic', enabled: !!BF.games.logic },

      { key: 'daily', icon: 'mini', y: cardY + step * 2, h: ch, title: '每日挑战',
        sub: dailyDone ? '今日已完成 ★' + BF.Save.data.daily.stars : '每天一道新题 · 全服同题',
        mode: 'daily', enabled: true },

      { key: 'photo', icon: 'photo', y: cardY + step * 3, h: ch, title: '照片拼图',
        sub: photoN ? ('可选难度 3×3~8×8 · ' + BF.games.photo.TOTAL + ' 关')
                    : '未内置照片 · 跑 tools 脚本导入',
        mode: 'levels', game: 'photo', enabled: photoN > 0 },

      { key: 'diff', icon: 'diff', y: cardY + step * 4, h: ch, title: '图片找不同',
        sub: diffN ? ('先选难度 · 3~8 处不同 · ' + BF.games.diff.TOTAL + ' 关')
                   : '未内置图对 · 跑 tools 脚本生成',
        // 与移车出库同思路：3 处和 8 处的手感差太多，直接进第 1 关对老玩家太浅，
        // 所以首页点进来先给一屏难度自选（场景的 pickDiff 模式）。
        mode: 'pickDiff', game: 'diff', enabled: (!!BF.games.diff) && diffN > 0 },

      { key: 'bottle', icon: 'bottle', y: cardY + step * 5, h: ch, title: '瓶子颜色推理',
        sub: (BF.games.bottle ? ('隐藏目标·推理排序 · ' + BF.games.bottle.TOTAL + ' 关通关')
                              : '隐藏目标，推理出正确顺序'),
        mode: 'levels', game: 'bottle', enabled: !!BF.games.bottle },

      { key: 'cipher', icon: 'cipher', y: cardY + step * 6, h: ch, title: '密码推理',
        sub: (BF.games.cipher ? ('逐格 / 数量两种提示 · ' + BF.games.cipher.TOTAL + ' 关')
                              : '看反馈推理出隐藏密码'),
        mode: 'levels', game: 'cipher', enabled: !!BF.games.cipher },

      { key: 'rush', icon: 'rush', y: cardY + step * 7, h: ch, title: '移车出库',
        sub: (BF.games.rush ? ('滑动车辆 · 让警车驶出 · 4 档难度可选')
                            : '滑动车辆，让警车驶出车库'),
        // 移车出库的难度差异极大（入门 2 步 vs 专家 14 步），直接进第 1 关会觉得"太简单"，
        // 所以首页点进来先给一屏难度自选（rush 场景的 pickDiff 模式）。
        mode: 'pickDiff', game: 'rush', enabled: !!BF.games.rush },

      { key: 'blocks', icon: 'blocks', y: cardY + step * 8, h: ch, title: '超级积木',
        sub: (BF.games.blocks ? ('先选难度 · 4 档由易到难 · ' +
                                 (BF.games.blocks.TOTAL || 40) + ' 关')
                              : '用指定颜色的积木，填满亮起的格子'),
        // 4 档难度差异大（入门 5 块 vs 专家 11 块），同移车出库先选难度再进游戏
        mode: 'pickDiff', game: 'blocks', enabled: !!BF.games.blocks },

      { key: 'sudoku', icon: 'sudoku', y: cardY + step * 9, h: ch, title: '九宫格数独',
        sub: (BF.games.sudoku ? ('先选难度 · 挖 36~56 空 · ' +
                                 (BF.games.sudoku.TOTAL || 40) + ' 关')
                              : '每行每列每宫 1-9 不重复'),
        // 挖空数 36 → 56 手感差极大，同移车出库先选难度再进游戏
        mode: 'pickDiff', game: 'sudoku', enabled: !!BF.games.sudoku },

      { key: 'mine', icon: 'mine', y: cardY + step * 10, h: ch, title: '扫雷',
        sub: (BF.games.mine ? ('先选难度 · 保证免猜 · ' +
                                 (BF.games.mine.TOTAL || 40) + ' 关')
                            : '避开所有地雷'),
        // 首点必安全 + 纯逻辑可解，和移车出库同思路先选难度再进游戏
        mode: 'pickDiff', game: 'mine', enabled: !!BF.games.mine },

      { key: 'picross', icon: 'picross', y: cardY + step * 11, h: ch, title: '数织',
        sub: (BF.games.picross ? ('先选难度 · 5×5~15×15 · ' +
                                   (BF.games.picross.TOTAL || 40) + ' 关')
                              : '看行数列线索，填出彩色像素画'),
        // 4 档尺寸跨度大（5×5 vs 15×15），同扫雷先选难度再进游戏
        mode: 'pickDiff', game: 'picross', enabled: !!BF.games.picross }
    ];
    for (var i = 0; i < this.cards.length; i++) {
      this.cards[i].x = 16;
      this.cards[i].w = W - 32;
    }
    this.loadThumb();
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
    // 找不同：加载第一对图（A 原图 / B 改动图），用来画"对比"图标
    if (!this.diffThumb && BF.Diffs) {
      var dlist = BF.Diffs.all();
      if (dlist.length) {
        var pair = dlist[0];
        BF.Diffs.get(pair.a, function (err, img) {
          if (!err && img) { self.diffThumb = img; }
        });
        BF.Diffs.get(pair.b, function (err, img) {
          if (!err && img) { self.diffThumbB = img; }
        });
      }
    }
  };

  SceneHome.prototype.update = function (dt) {
    this.t += dt;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
    // 滚动惯性（与 levels 同一套手感）
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
    // 卡片 y 是"内容坐标"，命中判定要减去滚动偏移
    for (var i = 0; i < this.cards.length; i++) {
      if (U.pointInRect(x, y - this.scroll, this.cards[i])) { this.press = this.cards[i]; return; }
    }
  };

  SceneHome.prototype.onMove = function (x, y) {
    var dy = y - this.dragStartY;
    this.moved = Math.max(this.moved, Math.abs(dy));
    // 抬起超过 8px 就算拖动，不再算点击（否则滑动列表会误进游戏）
    if (this.moved > 8) { this.press = null; }
    if (this.minScroll === 0) { return; }   // 一屏装得下就不动，避免误拖
    this.dragging = true;
    this.scroll = U.clamp(this.scrollStart + dy, this.minScroll, 0);
    this.vel = dy * 0.35;
  };

  SceneHome.prototype.onUp = function (x, y) {
    var c = this.press;
    var wasDrag = this.dragging;
    var moved = this.moved;
    this.dragging = false;
    this.press = null;
    if (wasDrag && moved >= 8) { return; }   // 拖动过 → 不触发点击
    if (!c || !U.pointInRect(x, y - this.scroll, c)) { return; }
    if (!c.enabled) { return; }
    if (c.mode === 'levels') { this.app.go('levels', { game: c.game }); }
    else if (c.mode === 'daily') { this.app.go('play', { daily: true }); }
    // 「先选难度再进游戏」：移车出库 / 图片找不同 / 超级积木 都走这一支
    else if (c.mode === 'pickDiff') { this.app.go(c.game, { pickDiff: true, game: c.game }); }
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

    // 卡片列表：裁剪 + 滚动（卡片 y 是内容坐标，渲染时统一加 scroll）
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.listTop, W, this.viewH);
    ctx.clip();
    ctx.translate(0, this.scroll);
    for (var i = 0; i < this.cards.length; i++) {
      this.renderCard(ctx, this.cards[i]);
    }
    ctx.restore();

    // 装不下时才出现的滚动提示：上下渐隐 + 细滚动条
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
      var thumbH = Math.max(28, trackH * (this.viewH / this.contentH));
      var p = this.minScroll === 0 ? 0 : this.scroll / this.minScroll;
      D.fillRound(ctx, W - 7, this.listTop, 3, trackH, 1.5, 'rgba(23,26,31,0.06)');
      D.fillRound(ctx, W - 7, this.listTop + (trackH - thumbH) * p, 3, thumbH, 1.5,
        'rgba(23,26,31,0.20)');
    }

    var foot = '拖方块 · 找不同 · 排瓶子 · 推密码 · 移汽车 · 搭积木 · 填数独 · 扫雷 · 填数织';
    if (this.minScroll < 0) { foot = '共 ' + this.ncards + ' 款游戏 · 上下拖动查看全部'; }
    D.text(ctx, foot, W / 2, H - BF.platform.safeBottom - 12,
      { size: 11, color: T.textSub, alpha: 0.85 });

    // 版本号：真机排查时第一眼要能确认跑的是哪一版，所以放在页面上，不只打在 console。
    // 位置上必须避开标题区：早先放在左上角 (12, safeTop+18) 会和 30px 的「益智闯关」叠在一起。
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
   * 一张卡片的内部排版：图标边长、文字字号/行位、右侧箭头、文案可用宽度。
   * 全部由卡片高度推导 —— 真机上 11 张卡会把卡片压矮，固定字号必然顶出卡片。
   * 抽成方法是为了能被测试断言（见 smoke「卡片文案必须装在卡片里」）。
   */
  SceneHome.prototype.cardTextLayout = function (r) {
    var h = r.h;
    var pad = U.clamp(h * 0.11, 6, 14);
    var isz = Math.max(10, h - pad * 2);
    var gap2 = U.clamp(h * 0.105, 8, 14);
    var tx = r.x + pad + isz + gap2;
    var titleSize = roundHalf(U.clamp(h * 0.30, 12, 17));
    var subSize = roundHalf(U.clamp(h * 0.205, 9.5, 11.5));
    var lineGap = U.clamp(h * 0.055, 2, 7);
    var blockH = titleSize * 1.2 + lineGap + subSize * 1.2;
    var top = r.y + h / 2 - blockH / 2;
    var arrowR = U.clamp(h * 0.26, 11, 17);
    var arrowX = r.x + r.w - 13 - arrowR;
    return {
      pad: pad, isz: isz, tx: tx,
      titleSize: titleSize, subSize: subSize, lineGap: lineGap,
      top: top, blockH: blockH,
      titleY: top + titleSize * 0.6,
      subY: top + titleSize * 1.2 + lineGap + subSize * 0.6,
      arrowR: arrowR, arrowX: arrowX, arrowY: r.y + h / 2,
      textMax: Math.max(40, arrowX - arrowR - 8 - tx)
    };
  };

  /**
   * 粗估一段文案的像素宽（CJK/全角标点 = 1em，其余 ≈ 0.55em）。
   * 为什么不直接用 ctx.measureText：测试桩里它是假的（按字符数 × 7 返回），
   * 拿它做"文案超没超出卡片"的断言等于没测。这里按字符类型估，两边共用同一个口径。
   */
  SceneHome.prototype.estTextWidth = function (str, size) {
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      w += (str.charCodeAt(i) > 0x2E80) ? size : size * 0.55;
    }
    return w;
  };

  SceneHome.prototype.renderCard = function (ctx, c) {
    var enabled = c.enabled;
    var pressed = this.press === c;
    var scale = pressed ? 0.985 : 1;
    var x = c.x + (c.w * (1 - scale)) / 2, w = c.w * scale;
    var y = c.y + (c.h * (1 - scale)) / 2, h = c.h * scale;
    var float = pressed ? 0 : Math.sin(this.t / 900 + c.y) * 1.2;
    y += float;

    D.panel(ctx, x, y, w, h, {
      radius: 20,
      fill: enabled ? '#FFFFFF' : '#E8EAEE',
      shadowBlur: enabled ? 14 : 0, shadowOffsetY: 3
    });

    var g = this.cardTextLayout({ x: x, y: y, w: w, h: h });

    // 图标区
    var pad = g.pad, isz = g.isz;
    var ix = x + pad, iy = y + pad;

    if (c.icon === 'mini') {
      this.renderMiniIcon(ctx, c, ix, iy, isz);
    } else if (c.icon === 'logic') {
      this.renderLogicIcon(ctx, ix, iy, isz);
    } else if (c.icon === 'photo') {
      this.renderPhotoIcon(ctx, ix, iy, isz);
    } else if (c.icon === 'diff') {
      this.renderDiffIcon(ctx, ix, iy, isz);
    } else if (c.icon === 'bottle') {
      this.renderBottleIcon(ctx, ix, iy, isz);
    } else if (c.icon === 'cipher') {
      this.renderCipherIcon(ctx, ix, iy, isz);
    } else if (c.icon === 'rush') {
      this.renderRushIcon(ctx, ix, iy, isz);
    } else if (c.icon === 'blocks') {
      this.renderBlocksIcon(ctx, ix, iy, isz);
    } else if (c.icon === 'sudoku') {
      this.renderSudokuIcon(ctx, ix, iy, isz);
    } else if (c.icon === 'mine') {
      this.renderMineIcon(ctx, ix, iy, isz);
    } else if (c.icon === 'picross') {
      this.renderPicrossIcon(ctx, ix, iy, isz);
    } else {
      D.fillRound(ctx, ix, iy, isz, isz, 14, '#DDE0E5');
      D.icon(ctx, 'lock', ix + isz / 2, iy + isz / 2, isz * 0.34, '#A7ACB4');
    }

    // 文案（字号随卡片高度缩放 + maxWidth 兜底，保证永远不出界）
    D.text(ctx, c.title, g.tx, g.titleY,
      { size: g.titleSize, weight: '700', align: 'left',
        color: enabled ? T.text : '#A0A5AD', maxWidth: g.textMax });
    D.text(ctx, c.sub, g.tx, g.subY,
      { size: g.subSize, color: T.textSub, align: 'left', maxWidth: g.textMax });

    // 右侧箭头 / 状态
    if (enabled) {
      var ax = g.arrowX, ay = g.arrowY, r = g.arrowR;
      var done = c.key === 'daily' && BF.Save.isDailyDoneToday();
      D.fillRound(ctx, ax - r, ay - r, r * 2, r * 2, r,
        done ? U.rgba(T.ok, 0.14) : U.rgba(T.accent, 0.10));
      var icoS = U.clamp(r * 0.9, 9, 15);
      if (done) {
        D.icon(ctx, 'check', ax, ay, icoS, T.ok);
      } else {
        D.icon(ctx, 'play', ax + icoS / 15, ay, icoS, T.accent);
      }
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

    // 只画固定块（题面感）
    for (var k = 0; k < thumb.pieces.length; k++) {
      var p = thumb.pieces[k];
      if (!p.fixed) { continue; }
      D.block(ctx, ix + padIn + p.x * cell, iy + padIn + p.y * cell,
        p.w * cell, p.h * cell, LT.fixed,
        { pad: 0.6, radius: cell * 0.14, shadow: false });
    }
    // 再点几个彩色块示意"要自己填"：取面积最大的两块
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
      // 图还没加载完（或压根没有内置图）：画一个"照片"占位图标，不要画成空白
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
    // 十字缝：暗示"这张图会被切开"
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
   * 找不同卡片图标：把第一对图的 A/B **上下并排**缩进来画，
   * 再在 B 的某处差异位置点一个圈 —— 一眼看出"两张图对比找不同"。
   * 图没加载完时退化成两个色块 + 圈，不画空白。
   */
  SceneHome.prototype.renderDiffIcon = function (ctx, ix, iy, isz) {
    var r = 10;
    var imgA = this.diffThumb, imgB = this.diffThumbB;
    var padIn = isz * 0.06;
    var w = isz - padIn * 2;
    var h = (isz - padIn * 2 - 6) / 2;   // 上下两格，中间留 6px 缝
    var ax = ix + padIn, ay = iy + padIn;
    var by = ay + h + 6;

    if (!imgA || !imgB) {
      D.fillRound(ctx, ix, iy, isz, isz, r, '#DDE0E5');
      D.fillRound(ctx, ax, ay, w, h, 6, '#C9D6E4');
      D.fillRound(ctx, ax, by, w, h, 6, '#D6C6B4');
      // 示意圈：B 的右中位置
      this.diffRing(ctx, ax + w * 0.68, by + h * 0.5, Math.min(w, h) * 0.26, T.accent);
      return;
    }

    D.photoSlice(ctx, ax, ay, w, h, imgA, { u: 0, v: 0, uw: 1, vh: 1 },
      { radius: 6, stroke: false, shadow: false });
    D.photoSlice(ctx, ax, by, w, h, imgB, { u: 0, v: 0, uw: 1, vh: 1 },
      { radius: 6, stroke: false, shadow: false });

    // 在 B 上圈出第一处差异（用清单里记录的归一化矩形）
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

  /** 一个"找到不同"的圈：半透明填充 + 实线描边 */
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

  /** 瓶子颜色推理卡片图标：3 个彩色小瓶并排，一眼看出玩法 */
  SceneHome.prototype.renderBottleIcon = function (ctx, ix, iy, isz) {
    var pal = (BF.BottleGen && BF.BottleGen.palette) || [];
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#EAF1FB');
    var cols = [0, 1, 2];   // 红 / 蓝 / 绿
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
      // 瓶颈 + 高光
      D.fillRound(ctx, cx - bw * 0.18, by - bh * 0.16, bw * 0.36, bh * 0.22, bw * 0.10,
        U.shade(p.hex, -0.18));
      ctx.save();
      var hg = ctx.createLinearGradient(cx - bw / 2, by, cx, by);
      hg.addColorStop(0, 'rgba(255,255,255,0.34)');
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      D.roundRect(ctx, cx - bw / 2 + bw * 0.12, by + bh * 0.1, bw * 0.18, bh * 0.6, bw * 0.08);
      ctx.fillStyle = hg; ctx.fill();
      ctx.restore();
    }
  };

  /**
   * 密码推理卡片图标：深色「密码机」面板上一条已猜的行（3 个彩色格）+ 一条空行（3 个暗格），
   * 右侧两个反馈小点（绿=位置对 / 白=换位）—— 一眼看出"拼一行、看反馈"。
   */
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
    var pick = [0, 4, 5];   // 红 / 青 / 蓝
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
    // 右侧反馈点：第一行两个（绿=位置对、白=换位）
    var fx = ix + padIn + gridW + gap + fbW / 2;
    var dr = Math.max(2, cw * 0.15);
    D.fillRound(ctx, fx - dr - dr * 1.5, y0 + cw * 0.30 - dr, dr * 2, dr * 2, dr, '#2EA44F');
    ctx.save();
    D.roundRect(ctx, fx + dr * 0.5 - dr, y0 + cw * 0.30 - dr, dr * 2, dr * 2, dr);
    ctx.fillStyle = '#FFFFFF'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    // 第二行一个（黑=排除）
    D.fillRound(ctx, fx - dr, y0 + cw + rowGap + cw * 0.5 - dr, dr * 2, dr * 2, dr, '#111418');
  };

  /**
   * 移车出库卡片图标：浅灰「停车场」底上一排彩色小车 + 一辆白底红蓝灯的警车，
   * 右侧一条出口公路箭头 —— 一眼看出"把车挪开、让警车开出去"。
   */
  SceneHome.prototype.renderRushIcon = function (ctx, ix, iy, isz) {
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#EBEEF2');   // 停车场地面
    // 网格点（停车位质感）
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
    // 几辆彩色小车（横向圆角块）
    for (i = 0; i < 3; i++) {
      var cx = ix + padIn + (i % 3) * cw * 1.02 + cw * 0.12;
      var cyy = iy + padIn + (i < 3 ? cw * 0.18 : 0);
      D.fillRound(ctx, cx, cyy, cw * 0.78, cw * 0.5, cw * 0.18, cols[i]);
    }
    // 警车（白色 + 红蓝灯条）
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

    // 右侧出口箭头
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

  /**
   * 超级积木卡片图标：8×8 暖色亮区棋盘 + 四角各摆一块不同颜色的积木，
   * 一眼看出"把彩色积木填进亮起来的格子里"。
   */
  SceneHome.prototype.renderBlocksIcon = function (ctx, ix, iy, isz) {
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#F3F0E7');
    var Gen = BF.BlocksGen;
    var n = 8, padIn = isz * 0.13, inner = isz - padIn * 2, cw = inner / n;
    // 亮区底（全部暖色凹槽）
    for (var gx = 0; gx < n; gx++) {
      for (var gy = 0; gy < n; gy++) {
        D.fillRound(ctx, ix + padIn + gx * cw, iy + padIn + gy * cw, cw - 1, cw - 1, 1, '#FDEBC8');
      }
    }
    if (!Gen) { return; }
    // 四角各放一块不同颜色的积木（取自各色第 1 块），示意玩法
    var ids = [0, 4, 8, 12];   // 红 / 绿 / 蓝 / 黄
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

  /** 游戏 9「九宫格数独」的图标：迷你 9×9 盘 + 几个给定数/填写数 */
  SceneHome.prototype.renderSudokuIcon = function (ctx, ix, iy, isz) {
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#EDF1F7');
    var n = 9, padIn = isz * 0.12, inner = isz - padIn * 2, cw = inner / n;
    // 盘面
    D.fillRound(ctx, ix + padIn - 1, iy + padIn - 1, inner + 2, inner + 2, 3, '#FFFFFF');
    // 固定演示题（第 1 关的给定数取前几个，制造"半满"的既视感）
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
    // 网格线（宫内细、宫间粗）
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

  /** 扫雷图标：浅底上一个地雷（圆 + 尖刺 + 小旗示意） */
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
    // 小旗
    var fx = ix + isz * 0.72, fy = iy + isz * 0.18;
    ctx.strokeStyle = '#C0392B'; ctx.fillStyle = '#C0392B';
    ctx.lineWidth = Math.max(1.5, isz * 0.04);
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy + isz * 0.22); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(fx, fy); ctx.lineTo(fx + isz * 0.16, fy + isz * 0.07);
    ctx.lineTo(fx, fy + isz * 0.14); ctx.closePath(); ctx.fill();
    ctx.restore();
  };

  /**
   * 数织卡片图标：一张 5×5 迷你棋盘 —— 左上/左侧各一个灰色线索数字，
   * 盘里用红色填出一个心形 —— 一眼看出"看数字提示、填出图案"。
   */
  SceneHome.prototype.renderPicrossIcon = function (ctx, ix, iy, isz) {
    D.fillRound(ctx, ix, iy, isz, isz, 14, '#EDF1F7');
    var n = 5;
    var gut = Math.max(4, isz * 0.15);      // 线索槽宽
    var inner = isz * 0.66;                 // 迷你棋盘边长
    var cw = inner / n;
    var bx = ix + (isz - inner - gut) / 2 + gut;
    var by = iy + (isz - inner - gut) / 2 + gut;
    var gx, gy, k;
    // 空格底
    for (gx = 0; gx < n; gx++) {
      for (gy = 0; gy < n; gy++) {
        D.fillRound(ctx, bx + gx * cw + 0.4, by + gy * cw + 0.4, cw - 0.8, cw - 0.8, 1, '#FFFFFF');
      }
    }
    // 心形（示意"解出来是一张画"）
    var pic = ['.R.R.', 'RRRRR', 'RRRRR', '.RRR.', '..R..'];
    for (gy = 0; gy < n; gy++) {
      for (gx = 0; gx < n; gx++) {
        if (pic[gy].charAt(gx) === 'R') {
          D.fillRound(ctx, bx + gx * cw + 0.4, by + gy * cw + 0.4, cw - 0.8, cw - 0.8, 1, '#E4572E');
        }
      }
    }
    // 网格线
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
    // 线索数字：行 3 / 列 2（与心形一致）
    var fs = Math.max(5, Math.round(isz * 0.13));
    D.text(ctx, '3', bx - gut * 0.55, by + cw * 2.5,
      { size: fs, weight: '700', color: '#8B9199' });
    D.text(ctx, '2', bx + cw * 1.5, by - gut * 0.55,
      { size: fs, weight: '700', color: '#8B9199' });
  };

  BF.SceneHome = SceneHome;
})();
