/**
 * generator.js —— 关卡生成器
 *
 * 思路：不去"猜"一个题面，而是**先切后出题**。
 *   1. 从一整块 N×N 网格开始；
 *   2. 反复随机挑一块，切成两半，直到块数达标；
 *   3. 每个矩形块 = 一个待放置的方块，它自己所在的格子就是"标准答案"。
 *
 * 这样生成出来的题**100% 有解、且解就是切出来的布局**（还能天然填满棋盘），
 * 同时用 seed 控制可复现 → 每日挑战全服同题。
 *
 * 切分评分 quality() 会让方块尽量"方"、少出细长条，避免出现一堆 1×1。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.generator) { return; }
  var U = BF.util;

  /** 单块质量：1 = 正方形，越细长越低；1×1 几乎不产生 */
  function quality(p) {
    if (p.w < 1 || p.h < 1) { return 0; }
    if (p.w * p.h === 1) { return 0.0001; }
    var mn = Math.min(p.w, p.h), mx = Math.max(p.w, p.h);
    var q = mn / mx;
    if (mn === 1) { q *= 0.42; }      // 细条降权，但允许（参考图里就有细条）
    return q;
  }

  function splitScore(w, h, pos, dir) {
    var a, b;
    if (dir === 'v') { a = { w: pos, h: h }; b = { w: w - pos, h: h }; }
    else { a = { w: w, h: pos }; b = { w: w, h: h - pos }; }
    var sa = quality(a), sb = quality(b);
    if (sa <= 0 || sb <= 0) { return 0; }
    return Math.sqrt(sa * sb);
  }

  /** 递归切割，返回矩形列表 */
  function carve(size, target, rng) {
    var rects = [{ x: 0, y: 0, w: size, h: size }];
    var guard = 0;
    while (rects.length < target && guard++ < 600) {
      var cands = [], i, c, s;
      for (i = 0; i < rects.length; i++) {
        var r = rects[i];
        var areaWeight = Math.pow(r.w * r.h, 0.6);   // 大块优先被切，出来的块更均匀
        for (c = 1; c < r.w; c++) {
          s = splitScore(r.w, r.h, c, 'v');
          if (s > 0) { cands.push({ i: i, dir: 'v', pos: c, score: s * areaWeight }); }
        }
        for (c = 1; c < r.h; c++) {
          s = splitScore(r.w, r.h, c, 'h');
          if (s > 0) { cands.push({ i: i, dir: 'h', pos: c, score: s * areaWeight }); }
        }
      }
      if (!cands.length) { break; }

      var total = 0;
      for (i = 0; i < cands.length; i++) { total += cands[i].score; }
      var pick = rng() * total, acc = 0, chosen = cands[cands.length - 1];
      for (i = 0; i < cands.length; i++) {
        acc += cands[i].score;
        if (pick <= acc) { chosen = cands[i]; break; }
      }

      var rr = rects[chosen.i];
      var a, b;
      if (chosen.dir === 'v') {
        a = { x: rr.x, y: rr.y, w: chosen.pos, h: rr.h };
        b = { x: rr.x + chosen.pos, y: rr.y, w: rr.w - chosen.pos, h: rr.h };
      } else {
        a = { x: rr.x, y: rr.y, w: rr.w, h: chosen.pos };
        b = { x: rr.x, y: rr.y + chosen.pos, w: rr.w, h: rr.h - chosen.pos };
      }
      rects.splice(chosen.i, 1, a, b);
    }
    return rects;
  }

  /** 给每块上色：同色不相邻（四邻域） */
  function assignColors(pieces, size, rng) {
    var n = BF.COLORS.length;
    var owner = new Array(size * size);
    var i;
    for (i = 0; i < owner.length; i++) { owner[i] = -1; }

    var order = pieces.slice().sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
    for (var k = 0; k < order.length; k++) {
      var p = order[k];
      var banned = {};
      for (var dy = 0; dy < p.h; dy++) {
        for (var dx = 0; dx < p.w; dx++) {
          var gx = p.x + dx, gy = p.y + dy;
          var nb = [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]];
          for (var q = 0; q < 4; q++) {
            var nx = nb[q][0], ny = nb[q][1];
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) { continue; }
            var o = owner[ny * size + nx];
            if (o >= 0) { banned[pieces[o].color] = 1; }
          }
        }
      }
      var pool = [];
      for (var c = 0; c < n; c++) { if (!banned[c]) { pool.push(c); } }
      if (!pool.length) { for (c = 0; c < n; c++) { pool.push(c); } }
      p.color = pool[Math.floor(rng() * pool.length)];

      for (dy = 0; dy < p.h; dy++) {
        for (dx = 0; dx < p.w; dx++) { owner[(p.y + dy) * size + p.x + dx] = p.id; }
      }
    }
  }

  function isBoring(pieces) {
    if (pieces.length < 2) { return true; }
    var f = pieces[0].w + 'x' + pieces[0].h;
    for (var i = 1; i < pieces.length; i++) {
      if (pieces[i].w + 'x' + pieces[i].h !== f) { return false; }
    }
    return true;
  }

  /**
   * 生成一道题
   * @param opt {size, pieceCount, seed, shuffle}
   * @returns {size, area, pieces:[{id,w,h,x,y,color}], order:[id...], count}
   *          pieces[i].x/.y 即标准答案坐标（origin 左上，单位=格）
   */
  function generate(opt) {
    opt = opt || {};
    var size = Math.max(2, Math.round(opt.size || 5));
    var target = Math.max(1, Math.round(opt.pieceCount || 5));
    var seed = (opt.seed | 0) || 1;

    var rects = null, pieces = null, attempt;
    for (attempt = 0; attempt < 8; attempt++) {
      var rng = U.mulberry32(seed + attempt * 104729);
      rects = carve(size, target, rng);
      pieces = [];
      for (var i = 0; i < rects.length; i++) {
        pieces.push({
          id: i, w: rects[i].w, h: rects[i].h,
          x: rects[i].x, y: rects[i].y, color: 0
        });
      }
      if (!isBoring(pieces)) { break; }
    }

    var rng2 = U.mulberry32(seed + 777);
    assignColors(pieces, size, rng2);

    var order = pieces.map(function (p) { return p.id; });
    if (opt.shuffle !== false) { U.shuffle(order, rng2); }

    return {
      size: size,
      area: size * size,
      pieces: pieces,
      order: order,
      count: pieces.length,
      seed: seed
    };
  }

  /* ---------------- 关卡难度曲线 ---------------- */
  var BANDS = [
    { size: 4, from: 1,  to: 2,  min: 3,  max: 5 },
    { size: 5, from: 3,  to: 10, min: 5,  max: 7 },
    { size: 6, from: 11, to: 26, min: 6,  max: 10 },
    { size: 7, from: 27, to: 45, min: 8,  max: 13 },
    { size: 8, from: 46, to: 60, min: 10, max: 17 }
  ];

  var Levels = {
    TOTAL: 60,

    spec: function (n) {
      n = Math.max(1, Math.round(n));
      var band = BANDS[BANDS.length - 1];
      for (var i = 0; i < BANDS.length; i++) {
        if (n >= BANDS[i].from && n <= BANDS[i].to) { band = BANDS[i]; break; }
      }
      var t = band.to > band.from ? (n - band.from) / (band.to - band.from) : 0;
      var count = Math.round(U.lerp(band.min, band.max, t));
      return {
        size: band.size,
        pieceCount: count,
        seed: 90210 + n * 7919
      };
    },

    build: function (n) {
      return BF.generator.generate(this.spec(n));
    },

    /** 每日挑战：日期做 seed，全服同一题 */
    buildDaily: function (date) {
      var d = date || new Date();
      return BF.generator.generate({
        size: 6,
        pieceCount: 9,
        seed: U.seedFromDate(d) % 2147483647
      });
    }
  };

  BF.generator = { generate: generate, quality: quality, carve: carve };
  BF.Levels = Levels;

  /* ---------------- 游戏注册表 ---------------- */
  // 合集里每款游戏都在这里登记。play / levels / home 只认注册表，不认具体实现，
  // 所以「新增一款游戏」= 写一个生成器 + 在这里登记 + 首页加一张卡。
  var games = BF.games || (BF.games = {});
  games.block = {
    id: 'block',
    title: '方块拼图',
    skin: 'block',
    TOTAL: Levels.TOTAL,
    build: function (n) { return Levels.build(n); },
    buildDaily: function (d) { return Levels.buildDaily(d); }
  };
})();
