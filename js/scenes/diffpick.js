/**
 * diffpick.js —— 「先选难度，再进游戏」的难度自选首屏
 *
 * 为什么要有这一屏：难度差异大的游戏（移车出库入门 2 步 vs 专家 14 步；
 * 超级积木 5 块 vs 11 块；找不同 3 处 vs 8 处）如果从首页卡片直接进第 1 关，
 * 老玩家会觉得"太简单"，新手又会被专家档劝退。所以在玩法场景里加一个
 * **pickDiff 模式**：停在这屏让玩家选档，点某张档卡 → 进该档「第一个未通关」的关
 * （全通则重玩本档末关），不让玩家每次都从最简关重来。
 *
 * 这一屏最初只写在 rush.js 里；找不同和超级积木也要同一套交互，于是抽成共用模块，
 * 避免三份重复实现在迭代里各自跑偏（ hit box 与渲染不同源 = "看得见点不中"）。
 *
 * 场景接入只需五步：
 *   1) enter() 开头识别 params.pickDiff → `return BF.DiffPick.enter(this, params);`
 *   2) update() 里 `if (this.pickDiff) { return; }`（首屏不跑玩法状态机/倒计时）
 *   3) onDown()/onUp() 开头 `if (this.pickDiff) { BF.DiffPick.onDown(this, x, y); return; }`
 *   4) render() 里 `if (this.pickDiff) { BF.DiffPick.render(ctx, this); }`
 *   5) 游戏注册里提供两个可选钩子：
 *        meta.tierLevels(name) → 该档包含哪些关卡号（默认按 5 关一档连续取）
 *        meta.pickInfo(idx, range) → 档卡副标题（默认「第 first-last 关」）
 *
 * ⚠️ 档卡的命中盒与绘制必须同源（都走 DiffPick.layout / DiffPick.render），
 *    否则就会出现"卡片画在这儿、点下去却没反应"。smoke.js 有对应断言。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.DiffPick) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;

  /** 四档难度的主题色（越难越"烫"：绿 → 蓝 → 橙 → 红） */
  var TIER_COLORS = ['#2EA44F', '#2D6CDF', '#F4820B', '#E63946'];

  var DiffPick = {};
  DiffPick.TIER_COLORS = TIER_COLORS;

  /* ---------------- 进入首屏 ---------------- */

  /**
   * 把场景切成"难度自选"态。只重置首屏要用的字段，不加载题目/图片
   * （找不同会异步加载图对，选难度阶段完全不该触发）。
   */
  DiffPick.enter = function (scene, params) {
    params = params || {};
    scene.pickDiff = true;
    scene.isDaily = false;
    scene.game = params.game || scene.game || 'rush';

    var meta = BF.games && (BF.games[scene.game] || scene.meta);
    if (!meta) { throw new Error('未注册的游戏: ' + scene.game); }
    scene.meta = meta;

    // 首屏不玩法：把上一局的残留清成空，避免 update/render 踩到旧状态
    scene.pressBtn = null;
    scene.toast = null;
    scene.win = null;
    scene.result = null;
    scene.drag = null;
    scene.held = null;
    scene.puzzle = null;
    scene.pieces = [];
    scene.cars = [];
    scene.fadeIn = 1;
    scene.t = 0;

    if (scene.layout) { scene.layout(); }   // 先算 headerY 等基础几何
    DiffPick.layout(scene);
    return scene;
  };

  /* ---------------- 布局 ---------------- */

  /**
   * 首屏几何：标题下方纵向排 N 张难度卡（各档的关卡范围 / 难度指标 / 进度），
   * 底部一个「查看全部关卡」入口。卡片高度自适应，小屏不会溢出。
   */
  DiffPick.layout = function (scene) {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var names = (scene.meta && scene.meta.difficulties) || [];
    var n = names.length, gap = 11;
    var top = (scene.headerY || pf.safeTop) + 58;
    var bottom = H - pf.safeBottom - 62;
    var ch = Math.max(56, Math.min(104, (bottom - top - gap * (n - 1)) / n));
    var totalH = ch * n + gap * (n - 1);
    var y0 = top + Math.max(0, (bottom - top - totalH) / 2);
    scene.pickCards = names.map(function (nm, i) {
      return { name: nm, idx: i, x: 18, y: y0 + i * (ch + gap), w: W - 36, h: ch };
    });
    scene.pickAll = { x: W / 2 - 80, y: H - pf.safeBottom - 46, w: 160, h: 38 };
  };

  /* ---------------- 档位数据 ---------------- */

  /** 某档包含哪些关卡号。游戏可在注册里给 meta.tierLevels(name) 覆盖默认口径 */
  DiffPick.tierLevels = function (scene, idx) {
    var meta = scene.meta || {};
    var names = meta.difficulties || [];
    var key = names[idx];
    if (typeof meta.tierLevels === 'function') { return meta.tierLevels(key) || []; }
    // 默认：从该档第一关起连续 5 关（移车出库口径）
    var first = typeof meta.firstLevelOfSize === 'function'
      ? meta.firstLevelOfSize(key) : (idx * 5 + 1);
    var out = [];
    for (var n = first; n <= Math.min(meta.TOTAL || first, first + 4); n++) { out.push(n); }
    return out;
  };

  /** 某档的关卡范围 { first, last, count } */
  DiffPick.tierRange = function (scene, idx) {
    var lv = DiffPick.tierLevels(scene, idx);
    if (!lv.length) { return { first: 1, last: 1, count: 0 }; }
    return { first: lv[0], last: lv[lv.length - 1], count: lv.length };
  };

  /** 某档的进度：{ cleared, stars, next, total }。next = 该档第一个未通关的关 */
  DiffPick.tierProgress = function (scene, idx) {
    var lv = DiffPick.tierLevels(scene, idx);
    var cleared = 0, stars = 0;
    for (var i = 0; i < lv.length; i++) {
      var n = lv[i];
      if (BF.Save.isCleared(scene.game, n)) { cleared++; stars += BF.Save.starsOf(scene.game, n); }
    }
    var next = lv.length ? lv[lv.length - 1] : 1;   // 全通关 → 重玩本档最后一关
    for (i = 0; i < lv.length; i++) {
      if (!BF.Save.isCleared(scene.game, lv[i])) { next = lv[i]; break; }
    }
    return { cleared: cleared, stars: stars, next: next, total: lv.length };
  };

  /** 档卡副标题。游戏可在注册里给 meta.pickInfo(idx, range) 覆盖 */
  DiffPick.pickInfo = function (scene, idx, rg) {
    var meta = scene.meta || {};
    if (typeof meta.pickInfo === 'function') {
      var o = meta.pickInfo(idx, rg) || {};
      if (o.meta) { return { meta: o.meta }; }
    }
    return { meta: '第 ' + rg.first + '-' + rg.last + ' 关' };
  };

  /**
   * 档卡主标题。游戏可在注册里给 meta.tierTitle(name) 覆盖 ——
   * 找不同的 difficulties 是数字（3/4/5…），直接当标题会显示成光秃秃一个"3"，
   * 所以它给的是 "3 处"； rush / blocks 的档名本身就是中文，用默认值即可。
   */
  DiffPick.tierTitle = function (scene, idx) {
    var meta = scene.meta || {};
    var names = meta.difficulties || [];
    if (typeof meta.tierTitle === 'function') { return meta.tierTitle(names[idx]); }
    return names[idx];
  };

  /* ---------------- 输入 ---------------- */

  DiffPick.onDown = function (scene, x, y) {
    scene.pressBtn = null;
    if (U.pointInRect(x, y, scene.back)) { scene.pressBtn = { key: 'back' }; return; }
    if (scene.pickAll && U.pointInRect(x, y, scene.pickAll)) {
      scene.pressBtn = { key: 'all' }; return;
    }
    for (var k = 0; k < scene.pickCards.length; k++) {
      if (U.pointInRect(x, y, scene.pickCards[k])) {
        scene.pressBtn = { key: 'tier', idx: k }; return;
      }
    }
  };

  DiffPick.onUp = function (scene, x, y) {
    var p0 = scene.pressBtn;
    scene.pressBtn = null;
    if (!p0) { return; }
    if (p0.key === 'back') {
      if (U.pointInRect(x, y, scene.back)) { scene.app.go('home'); }
      return;
    }
    if (p0.key === 'all') {
      if (U.pointInRect(x, y, scene.pickAll)) { scene.app.go('levels', { game: scene.game }); }
      return;
    }
    if (p0.key === 'tier') {
      var cb = scene.pickCards[p0.idx];
      // 必须"按下与抬起都在同一张卡里"才算选中，否则手抖滑到别国会误触
      if (cb && U.pointInRect(x, y, cb)) {
        scene.enter({ game: scene.game, level: DiffPick.tierProgress(scene, p0.idx).next });
      }
      return;
    }
  };

  /* ---------------- 渲染 ---------------- */

  DiffPick.render = function (ctx, scene) {
    var pf = BF.platform, W = pf.width;
    var names = (scene.meta && scene.meta.difficulties) || [];

    // 返回
    D.fillRound(ctx, scene.back.x, scene.back.y, scene.back.w, scene.back.h, 14, '#FFFFFF');
    D.roundRect(ctx, scene.back.x + 0.5, scene.back.y + 0.5, scene.back.w - 1, scene.back.h - 1, 14);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    D.icon(ctx, 'back', scene.back.x + scene.back.w / 2, scene.back.y + scene.back.h / 2, 16, T.text);

    D.text(ctx, scene.meta.title, W / 2, scene.headerY + 18, { size: 20, weight: '700' });
    D.text(ctx, '先选难度 · ' + names.length + ' 档由易到难', W / 2, scene.headerY + 38,
      { size: 11.5, color: T.textSub });

    for (var i = 0; i < scene.pickCards.length; i++) {
      var c = scene.pickCards[i];
      var pressed = scene.pressBtn && scene.pressBtn.key === 'tier' && scene.pressBtn.idx === i;
      var pr = DiffPick.tierProgress(scene, i);
      var rg = DiffPick.tierRange(scene, i);
      var info = DiffPick.pickInfo(scene, i, rg);
      var col = TIER_COLORS[i % TIER_COLORS.length];

      var sc = pressed ? 0.985 : 1;
      var x = c.x + (c.w * (1 - sc)) / 2, w = c.w * sc;
      var y = c.y + (c.h * (1 - sc)) / 2, h = c.h * sc;

      D.panel(ctx, x, y, w, h, {
        radius: 18, fill: '#FFFFFF', shadowBlur: pressed ? 4 : 12, shadowOffsetY: pressed ? 1 : 3,
        edgeColor: U.rgba(col, 0.35)
      });

      // 左侧难度徽章：该档主色淡底 + (i+1) 根递增信号条 —— 一眼看出"第几档"
      var bd = h * 0.78;
      var bxp = x + 12, byp = y + (h - bd) / 2;
      D.fillRound(ctx, bxp, byp, bd, bd, bd * 0.28, U.rgba(col, 0.13));
      var bars = i + 1;
      var bwid = bd * 0.13, bgap = bd * 0.09;
      var totalW = bars * bwid + (bars - 1) * bgap;
      var barsX = bxp + (bd - totalW) / 2;
      for (var b2 = 0; b2 < bars; b2++) {
        var bh = bd * (0.20 + 0.16 * b2);
        D.fillRound(ctx, barsX + b2 * (bwid + bgap), byp + bd - bd * 0.16 - bh,
          bwid, bh, bwid * 0.5, col);
      }

      // 文案
      var tx = bxp + bd + 13;
      D.text(ctx, DiffPick.tierTitle(scene, i), tx, y + h * 0.5 - 13,
        { size: 17, weight: '700', align: 'left', color: T.text });
      D.text(ctx, info.meta, tx, y + h * 0.5 + 7,
        { size: 11, color: T.textSub, align: 'left' });
      D.text(ctx, !pr.total ? '暂无关卡'
                            : (pr.cleared >= pr.total ? ('已全清 ★ ' + pr.stars)
                                                      : ('已过 ' + pr.cleared + '/' + pr.total +
                                                         '　★ ' + pr.stars)),
        tx, y + h * 0.5 + 24,
        { size: 10.5, color: U.rgba(col, 0.95), align: 'left', weight: '600' });

      // 右侧进入箭头
      var ax = x + w - 30, ay = y + h / 2, rr = Math.min(17, h * 0.30);
      D.fillRound(ctx, ax - rr, ay - rr, rr * 2, rr * 2, rr, U.rgba(col, 0.12));
      D.icon(ctx, 'play', ax + 1, ay, 15, col);
    }

    // 「查看全部关卡」入口（老路径：关卡网格 + 顶部难度条）
    var pa = scene.pickAll;
    var pPressed = scene.pressBtn && scene.pressBtn.key === 'all';
    D.button(ctx, pa, '查看全部关卡',
      { fill: pPressed ? '#E4E7EB' : '#FFFFFF', color: T.textSub, size: 13.5 });
  };

  BF.DiffPick = DiffPick;
})();
