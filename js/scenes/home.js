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
  }

  SceneHome.prototype.enter = function () {
    this.layout();
    this.fadeIn = 1;
    this.t = 0;
    return this;
  };

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

    // 卡片区：在标题与底部提示之间垂直居中，高度自适应（小屏会自动压扁）
    var listTop = this.top + 92;
    var listBottom = H - pf.safeBottom - 40;
    var availH = listBottom - listTop;
    var gap = 16;
    var ch = Math.min(140, (availH - gap * 3) / 4);
    var totalH = ch * 4 + gap * 3;
    var cardY = listTop + Math.max(0, (availH - totalH) / 2);
    var step = ch + gap;

    var dailyDone = BF.Save.isDailyDoneToday();

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

      { key: 'soon', icon: 'lock', y: cardY + step * 3, h: ch, title: '敬请期待',
        sub: '合集第 3 款游戏', mode: null, enabled: false }
    ];
    for (var i = 0; i < this.cards.length; i++) {
      this.cards[i].x = 16;
      this.cards[i].w = W - 32;
    }
  };

  SceneHome.prototype.update = function (dt) {
    this.t += dt;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt / 260); }
  };

  SceneHome.prototype.onDown = function (x, y) {
    for (var i = 0; i < this.cards.length; i++) {
      if (U.pointInRect(x, y, this.cards[i])) { this.press = this.cards[i]; return; }
    }
  };

  SceneHome.prototype.onMove = function () {};

  SceneHome.prototype.onUp = function (x, y) {
    var c = this.press;
    this.press = null;
    if (!c || !U.pointInRect(x, y, c)) { return; }
    if (!c.enabled) { return; }
    if (c.mode === 'levels') { this.app.go('levels', { game: c.game }); }
    else if (c.mode === 'daily') { this.app.go('play', { daily: true }); }
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

    for (var i = 0; i < this.cards.length; i++) {
      this.renderCard(ctx, this.cards[i]);
    }

    D.text(ctx, '两款玩法相同：拖动方块填满棋盘即过关', W / 2, H - BF.platform.safeBottom - 12,
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

    // 图标区
    var pad = 14;
    var isz = h - pad * 2;
    var ix = x + pad, iy = y + pad;

    if (c.icon === 'mini') {
      this.renderMiniIcon(ctx, c, ix, iy, isz);
    } else if (c.icon === 'logic') {
      this.renderLogicIcon(ctx, ix, iy, isz);
    } else {
      D.fillRound(ctx, ix, iy, isz, isz, 14, '#DDE0E5');
      D.icon(ctx, 'lock', ix + isz / 2, iy + isz / 2, isz * 0.34, '#A7ACB4');
    }

    // 文案
    var tx = ix + isz + 14;
    D.text(ctx, c.title, tx, y + h / 2 - 14,
      { size: 17, weight: '700', align: 'left', color: enabled ? T.text : '#A0A5AD' });
    D.text(ctx, c.sub, tx, y + h / 2 + 8,
      { size: 11.5, color: T.textSub, align: 'left' });

    // 右侧箭头 / 状态
    if (enabled) {
      var ax = x + w - 30, ay = y + h / 2;
      var r = 17;
      var done = c.key === 'daily' && BF.Save.isDailyDoneToday();
      D.fillRound(ctx, ax - r, ay - r, r * 2, r * 2, r,
        done ? U.rgba(T.ok, 0.14) : U.rgba(T.accent, 0.10));
      if (done) {
        D.icon(ctx, 'check', ax, ay, 15, T.ok);
      } else {
        D.icon(ctx, 'play', ax + 1, ay, 15, T.accent);
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

  BF.SceneHome = SceneHome;
})();
