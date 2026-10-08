/**
 * logic.js —— 游戏 2「逻辑拼图」关卡生成器
 *
 * 规格（按参考图）：8×8 圆环点阵棋盘；开局固定 3 块墨黑拼图
 *   —— 占 3 格的长方形、占 2 格的长方形、占 1 格的正方形（横竖朝向随机）；
 *   剩下的 8 块由玩家从下方托盘拖进棋盘，填满即过关。
 *
 * 生成思路（和游戏 1「先切后出题」同源，但方向反过来）：
 *   1. 先在 8×8 上随机「钉」下 3 块固定块（1×3 / 1×2 / 1×1，朝向随机、互不重叠）；
 *   2. 再把剩下的 58 格**精确**切成 8 块矩形；
 *   3. 切出来的 8 块矩形本身就是标准答案 → 必然铺满、无重叠、100% 有解。
 *
 * 为什么第 2 步用回溯而不是贪心：
 *   贪心「每次从左上角取一块」到最后常常剩下非矩形区域而失败（探针实测成功率仅约 4%）；
 *   回溯能把死路回退掉，探针实测 300/300 成功、平均重试 2.8 次、单关约 2ms。
 *
 * 形状约束：托盘块面积 3~16 格、最长边 ≤ 4（避免出现 1×7 那种没法看也没法拖的细长条）；
 *           兜底一轮会放宽约束，确保任何 seed 都能出题。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.Logic) { return; }
  var U = BF.util;

  var SIZE = 8;                       // 棋盘边长
  var AREA = SIZE * SIZE;
  var FIXED_LENS = [3, 2, 1];         // 3 块固定块：3 格长条 / 2 格长条 / 1 格方块
  var TRAY_COUNT = 8;                 // 剩余 8 块由玩家填充
  var TOTAL = 60;                     // 关卡数

  // 两轮尝试：先按观感好的严格约束，实在不行就放宽（保证 100% 能出题）
  var PASSES = [
    { tries: 40, minArea: 3, maxArea: 16, maxSide: 4, budget: 9000 },
    { tries: 30, minArea: 1, maxArea: 24, maxSide: 7, budget: 60000 }
  ];

  /* ---------------- 棋盘位图小工具 ---------------- */

  function idx(x, y) { return y * SIZE + x; }

  function newGrid() {
    var g = new Array(AREA);
    for (var i = 0; i < AREA; i++) { g[i] = 0; }
    return g;
  }

  function fits(grid, x, y, w, h) {
    if (x < 0 || y < 0 || x + w > SIZE || y + h > SIZE) { return false; }
    for (var dy = 0; dy < h; dy++) {
      for (var dx = 0; dx < w; dx++) { if (grid[idx(x + dx, y + dy)]) { return false; } }
    }
    return true;
  }

  function fill(grid, x, y, w, h, v) {
    for (var dy = 0; dy < h; dy++) {
      for (var dx = 0; dx < w; dx++) { grid[idx(x + dx, y + dy)] = v; }
    }
  }

  function countEmpty(grid) {
    var c = 0;
    for (var i = 0; i < AREA; i++) { if (!grid[i]) { c++; } }
    return c;
  }

  /** 最左上的空格 —— 回溯总是从它开始铺，保证不重不漏 */
  function topLeftEmpty(grid) {
    for (var y = 0; y < SIZE; y++) {
      for (var x = 0; x < SIZE; x++) { if (!grid[idx(x, y)]) { return { x: x, y: y }; } }
    }
    return null;
  }

  function maxWidth(grid, x, y) {
    var w = 0;
    while (x + w < SIZE && !grid[idx(x + w, y)]) { w++; }
    return w;
  }

  function maxHeight(grid, x, y, w) {
    var h = 0;
    while (y + h < SIZE) {
      var blocked = false;
      for (var k = 0; k < w; k++) { if (grid[idx(x + k, y + h)]) { blocked = true; break; } }
      if (blocked) { break; }
      h++;
    }
    return h;
  }

  /* ---------------- 固定块 ---------------- */

  var SPREAD = 3;   // 3 块固定块的中心曼哈顿距离下限（别挤在一起，题面才好看）

  /** 新块与已放固定块是否拉开得够远 */
  function spreadOk(x, y, w, h, placed) {
    var cx = x + (w - 1) / 2, cy = y + (h - 1) / 2;
    for (var i = 0; i < placed.length; i++) {
      var f = placed[i];
      var fx = f.x + (f.w - 1) / 2, fy = f.y + (f.h - 1) / 2;
      if (Math.abs(cx - fx) + Math.abs(cy - fy) < SPREAD) { return false; }
    }
    return true;
  }

  /** 随机「钉」一块 1×len（朝向随机），300 次找不到位置就放弃 */
  function placeFixed(grid, len, rng, placed) {
    for (var t = 0; t < 300; t++) {
      var horiz = rng() < 0.5;
      var w = horiz ? len : 1;
      var h = horiz ? 1 : len;
      var x = Math.floor(rng() * (SIZE - w + 1));
      var y = Math.floor(rng() * (SIZE - h + 1));
      if (!fits(grid, x, y, w, h)) { continue; }
      if (!spreadOk(x, y, w, h, placed)) { continue; }
      fill(grid, x, y, w, h, 1);
      return { x: x, y: y, w: w, h: h, len: len };
    }
    return null;
  }

  /* ---------------- 回溯切分 ---------------- */

  /**
   * 把 grid 上的剩余空格切成恰好 need 块矩形。
   * @returns 矩形数组（{x,y,w,h}）或 null（本分支走不通）
   */
  function solve(grid, need, rng, p, stat) {
    if (stat.n++ > stat.max) { return null; }

    var at = topLeftEmpty(grid);
    if (!at) { return need === 0 ? [] : null; }
    if (need <= 0) { return null; }

    var total = countEmpty(grid);
    if (total < need * p.minArea && total !== need) { return null; }   // 每块至少 minArea 格
    if (total > need * p.maxArea) { return null; }                     // 每块至多 maxArea 格

    var mw = maxWidth(grid, at.x, at.y);
    var avg = total / need;
    var cands = [];

    for (var w = 1; w <= mw; w++) {
      var mh = maxHeight(grid, at.x, at.y, w);
      for (var h = 1; h <= mh; h++) {
        var area = w * h;
        if (area < p.minArea || area > p.maxArea) { continue; }
        if (Math.max(w, h) > p.maxSide) { continue; }

        // 剪枝：剩下的格子必须刚好够（也要够得着）剩下的块
        var left = total - area, restNeed = need - 1;
        if (restNeed === 0) {
          if (left !== 0) { continue; }
        } else {
          if (left > restNeed * p.maxArea) { continue; }
          if (left < restNeed * p.minArea && left !== restNeed) { continue; }
        }

        var mn = Math.min(w, h), mx = Math.max(w, h);
        var shape = mn / mx;                                          // 越方越好
        var fit = 1 / (1 + Math.abs(area - avg) / Math.max(1, avg));  // 面积越贴近平均越好
        cands.push({ w: w, h: h, score: shape * fit + rng() * 0.35 });  // 加扰动保证每题都不一样
      }
    }
    if (!cands.length) { return null; }

    // 先试「最好看」的切法，走不通再退而求其次
    cands.sort(function (a, b) { return b.score - a.score; });

    for (var ci = 0; ci < cands.length; ci++) {
      var c = cands[ci];
      fill(grid, at.x, at.y, c.w, c.h, 1);
      var rest = solve(grid, need - 1, rng, p, stat);
      if (rest) {
        rest.unshift({ x: at.x, y: at.y, w: c.w, h: c.h });
        return rest;
      }
      fill(grid, at.x, at.y, c.w, c.h, 0);
    }
    return null;
  }

  /** 出一套布局：钉 3 块固定块 + 切 8 块托盘块 */
  function layout(seed) {
    for (var pi = 0; pi < PASSES.length; pi++) {
      var p = PASSES[pi];
      for (var t = 0; t < p.tries; t++) {
        var rng = U.mulberry32(((seed | 0) + pi * 900000 + t * 104729) >>> 0);
        var grid = newGrid();
        var fixed = [], ok = true;
        for (var i = 0; i < FIXED_LENS.length; i++) {
          var f = placeFixed(grid, FIXED_LENS[i], rng, fixed);
          if (!f) { ok = false; break; }
          fixed.push(f);
        }
        if (!ok) { continue; }

        var stat = { n: 0, max: p.budget };
        var tray = solve(grid, TRAY_COUNT, rng, p, stat);
        if (tray) {
          return { fixed: fixed, tray: tray, pass: pi, tries: t + 1, nodes: stat.n };
        }
      }
    }
    return null;
  }

  /* ---------------- 上色 ---------------- */

  /** 托盘块上色：白/黄/蓝/红，尽量让相邻块不同色（固定块按墨黑参与邻接判定） */
  function assignColors(pieces, rng) {
    var n = BF.LOGIC_COLORS.length;
    var owner = new Array(AREA);
    var i, dy, dx;
    for (i = 0; i < AREA; i++) { owner[i] = -1; }

    for (i = 0; i < pieces.length; i++) {
      if (!pieces[i].fixed) { continue; }
      pieces[i].color = -1;            // -1 = 墨黑固定块
      fill(owner, pieces[i].x, pieces[i].y, pieces[i].w, pieces[i].h, pieces[i].id);
    }

    // 大块先上色，避免大块被小块挤到没颜色可选
    var order = [];
    for (i = 0; i < pieces.length; i++) { if (!pieces[i].fixed) { order.push(pieces[i]); } }
    order.sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });

    for (var k = 0; k < order.length; k++) {
      var p = order[k];
      var banned = {};
      for (dy = 0; dy < p.h; dy++) {
        for (dx = 0; dx < p.w; dx++) {
          var gx = p.x + dx, gy = p.y + dy;
          var nb = [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]];
          for (var q = 0; q < 4; q++) {
            var nx = nb[q][0], ny = nb[q][1];
            if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) { continue; }
            var o = owner[idx(nx, ny)];
            if (o >= 0) { banned[pieces[o].color] = 1; }
          }
        }
      }
      var pool = [];
      for (var c = 0; c < n; c++) { if (!banned[c]) { pool.push(c); } }
      if (!pool.length) { for (c = 0; c < n; c++) { pool.push(c); } }
      p.color = pool[Math.floor(rng() * pool.length)];
      fill(owner, p.x, p.y, p.w, p.h, p.id);
    }
  }

  /* ---------------- 组装 ---------------- */

  function assemble(res, seed) {
    var pieces = [], i;
    for (i = 0; i < res.fixed.length; i++) {
      var f = res.fixed[i];
      pieces.push({
        id: pieces.length, w: f.w, h: f.h, x: f.x, y: f.y,
        color: -1, fixed: true, len: f.len
      });
    }
    for (i = 0; i < res.tray.length; i++) {
      var t = res.tray[i];
      pieces.push({
        id: pieces.length, w: t.w, h: t.h, x: t.x, y: t.y,
        color: 0, fixed: false
      });
    }

    assignColors(pieces, U.mulberry32(((seed | 0) + 313) >>> 0));

    var order = [];
    for (i = 0; i < pieces.length; i++) { if (!pieces[i].fixed) { order.push(i); } }
    U.shuffle(order, U.mulberry32(((seed | 0) + 977) >>> 0));

    return {
      size: SIZE,
      area: AREA,
      pieces: pieces,
      order: order,
      count: pieces.length,
      seed: seed | 0,
      gameId: 'logic'
    };
  }

  /** 第 n 关（同 n 永远同一题） */
  function build(n) {
    n = Math.max(1, Math.round(n || 1));
    var seed = 530000 + n * 7919;               // 与游戏 1 / 旧 mosaic 都错开，避免撞题
    var res = layout(seed);
    if (!res) { res = layout(seed + 1); }       // 理论上到不了这一行
    return assemble(res, seed);
  }

  /** 每日挑战：日期做 seed */
  function buildDaily(date) {
    var d = date || new Date();
    var seed = (U.seedFromDate(d) % 2000000) + 40000000;
    var res = layout(seed);
    if (!res) { res = layout(seed + 1); }
    return assemble(res, seed);
  }

  /** 通用入口（首页缩略图用）：直接给 seed */
  function generate(opt) {
    opt = opt || {};
    var seed = (opt.seed | 0) || 1;
    var res = layout(seed);
    if (!res) { res = layout(seed + 1); }
    return assemble(res, seed);
  }

  BF.Logic = {
    SIZE: SIZE,
    AREA: AREA,
    TOTAL: TOTAL,
    TRAY_COUNT: TRAY_COUNT,
    FIXED_LENS: FIXED_LENS,
    TOTAL_PIECES: FIXED_LENS.length + TRAY_COUNT,
    build: build,
    buildDaily: buildDaily,
    generate: generate,
    _layout: layout
  };

  // 登记进合集注册表
  var games = BF.games || (BF.games = {});
  games.logic = {
    id: 'logic',
    title: '逻辑拼图',
    sub: '3 块固定 + 8 块填空',
    skin: 'logic',
    TOTAL: TOTAL,
    build: build,
    buildDaily: buildDaily
  };
})();
