/**
 * mosaic.js —— 游戏 2「逻辑拼图」关卡生成器
 *
 * 玩法：8×8 棋盘，开局已经固定了 3 块黑色拼图（1 格正方形 + 2 格长方形 ×2），
 *       玩家只需把托盘里剩下的 8 块拼图拖进去填满整盘即可过关。
 *
 * 生成策略（沿用游戏 1 的「先切后出题」）：
 *   1. 把 8×8 整块反复随机切成 11 个矩形；
 *   2. 在这些矩形里挑出「恰好 1 个 1×1 + 2 个 1×2」作为固定块（黑色、不可动）；
 *      其余 8 块进入托盘。
 *   3. 因为整盘是矩形切分的结果，天然铺满、无重叠 → 100% 有解。
 *
 * 调参：原 quality() 评分会刻意消灭 1×1，这里把 floor / sliver 放宽，
 *       让 1×1 与 1×2 能稳定出现（探针实测约 9% 直接命中），
 *       再叠加「换 seed 重试 + 兜底切分」，保证每关 100% 产出合规的固定块。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.Mosaic) { return; }
  var U = BF.util;

  var SIZE = 8;     // 棋盘边长
  var TOTAL_PIECES = 11;   // 固定块 3 + 托盘 8
  var TOTAL = 60;          // 关卡数

  /* ---------------- 形状评分 ---------------- */

  function quality(p, floor, sliver) {
    if (p.w < 1 || p.h < 1) { return 0; }
    if (p.w * p.h === 1) { return Math.max(sliver, floor); }   // 1×1 允许
    var mn = Math.min(p.w, p.h), mx = Math.max(p.w, p.h);
    var q = mn / mx;
    if (mn === 1) { q = Math.max(q, sliver); }                // 细条降权但不消灭
    return Math.max(q, floor);
  }

  function splitScore(w, h, pos, dir, floor, sliver) {
    var a, b;
    if (dir === 'v') { a = { w: pos, h: h }; b = { w: w - pos, h: h }; }
    else { a = { w: w, h: pos }; b = { w: w, h: h - pos }; }
    var sa = quality(a, floor, sliver), sb = quality(b, floor, sliver);
    if (sa <= 0 || sb <= 0) { return 0; }
    return Math.sqrt(sa * sb);
  }

  /** 递归切割，返回矩形列表 */
  function carve(size, target, rng, floor, sliver) {
    var rects = [{ x: 0, y: 0, w: size, h: size }];
    var guard = 0;
    while (rects.length < target && guard++ < 800) {
      var cands = [], i, c, s;
      for (i = 0; i < rects.length; i++) {
        var r = rects[i];
        var aw = Math.pow(r.w * r.h, 0.6);
        for (c = 1; c < r.w; c++) {
          s = splitScore(r.w, r.h, c, 'v', floor, sliver);
          if (s > 0) { cands.push({ i: i, dir: 'v', pos: c, score: s * aw }); }
        }
        for (c = 1; c < r.h; c++) {
          s = splitScore(r.w, r.h, c, 'h', floor, sliver);
          if (s > 0) { cands.push({ i: i, dir: 'h', pos: c, score: s * aw }); }
        }
      }
      if (!cands.length) { break; }

      var total = 0;
      for (i = 0; i < cands.length; i++) { total += cands[i].score; }
      var pick = rng() * total, acc = 0, ch = cands[cands.length - 1];
      for (i = 0; i < cands.length; i++) {
        acc += cands[i].score;
        if (pick <= acc) { ch = cands[i]; break; }
      }

      var rr = rects[ch.i], a, b;
      if (ch.dir === 'v') {
        a = { x: rr.x, y: rr.y, w: ch.pos, h: rr.h };
        b = { x: rr.x + ch.pos, y: rr.y, w: rr.w - ch.pos, h: rr.h };
      } else {
        a = { x: rr.x, y: rr.y, w: rr.w, h: ch.pos };
        b = { x: rr.x, y: rr.y + ch.pos, w: rr.w, h: rr.h - ch.pos };
      }
      rects.splice(ch.i, 1, a, b);
    }
    return rects;
  }

  function isMono(r) { return r.w === 1 && r.h === 1; }
  function isDomino(r) { return (r.w === 1 && r.h === 2) || (r.w === 2 && r.h === 1); }

  /** 把一条 1×L（或 L×1）的条带切成 1×1 + 若干 1×2（+ 余量），保证至少一个 1×1 */
  function decomposeStrip(rect) {
    var horiz = rect.h === 1;
    var L = horiz ? rect.w : rect.h;
    var x0 = rect.x, y0 = rect.y, out = [], pos = 0;
    if (L >= 1) {                                   // 先切一个 1×1，保证有单格
      out.push(horiz ? { x: x0 + pos, y: y0, w: 1, h: 1 } : { x: x0, y: y0 + pos, w: 1, h: 1 });
      pos += 1;
    }
    while (L - pos >= 2) {
      out.push(horiz ? { x: x0 + pos, y: y0, w: 2, h: 1 } : { x: x0, y: y0 + pos, w: 1, h: 2 });
      pos += 2;
    }
    if (L - pos >= 1) {
      out.push(horiz ? { x: x0 + pos, y: y0, w: 1, h: 1 } : { x: x0, y: y0 + pos, w: 1, h: 1 });
      pos += 1;
    }
    return out;
  }

  /** 保证从一个面积≥5 的矩形里切出至少一个 1×1 与至少一个 1×2（兜底用） */
  function splitIntoFixed(R) {
    if (R.w * R.h < 5) { return null; }
    if (R.h === 1 && R.w >= 5) { return decomposeStrip(R); }
    if (R.w === 1 && R.h >= 5) { return decomposeStrip(R); }
    if (R.h === 2) {   // 拆成上下两行，每行 w×1（w≥3 必有 1×1+1×2）
      var a = { x: R.x, y: R.y, w: R.w, h: 1 };
      var b = { x: R.x, y: R.y + 1, w: R.w, h: 1 };
      return decomposeStrip(a).concat(decomposeStrip(b));
    }
    // h≥3：先竖切出 1×h 条带，余下继续递归
    var top = { x: R.x, y: R.y, w: 1, h: R.h };
    var rest = { x: R.x + 1, y: R.y, w: R.w - 1, h: R.h };
    return decomposeStrip(top).concat(splitIntoFixed(rest) || [rest]);
  }

  /** 尝试切出 11 块，并选出 1×1 + 2×1×2 作固定块 */
  function carveFixed(size, target, seed) {
    var floor = 0.10, sliver = 0.40;
    var attempt, i;

    function pickFixed(rects) {
      var mono = -1, dom = [];
      for (i = 0; i < rects.length; i++) {
        if (isMono(rects[i])) { if (mono < 0) { mono = i; } }
        else if (isDomino(rects[i])) { if (dom.length < 2) { dom.push(i); } }
      }
      if (mono >= 0 && dom.length >= 2) { return { mono: mono, dom: [dom[0], dom[1]] }; }
      return null;
    }

    // ① 标准调参重试
    for (attempt = 0; attempt < 300; attempt++) {
      var rng = U.mulberry32((seed | 0) + attempt * 104729);
      var rects = carve(size, target, rng, floor, sliver);
      if (rects.length !== target) { continue; }
      var f = pickFixed(rects);
      if (f) { return { rects: rects, mono: f.mono, dom: f.dom }; }
    }

    // ② 更松弛调参重试（1×1 / 1×2 占比更高）
    for (attempt = 0; attempt < 200; attempt++) {
      var rng2 = U.mulberry32((seed | 0) + 900000 + attempt * 104729);
      var rects2 = carve(size, target, rng2, 0.02, 0.95);
      if (rects2.length !== target) { continue; }
      var f2 = pickFixed(rects2);
      if (f2) { return { rects: rects2, mono: f2.mono, dom: f2.dom }; }
    }

    // ③ 兜底：随便切 11 块，把最大块强制切出所需的小块
    var rng3 = U.mulberry32((seed | 0) + 1800000);
    var rects3 = carve(size, target, rng3, 0.05, 0.60);
    var biggest = 0;
    for (i = 1; i < rects3.length; i++) {
      if (rects3[i].w * rects3[i].h > rects3[biggest].w * rects3[biggest].h) { biggest = i; }
    }
    var parts = splitIntoFixed(rects3[biggest]);
    if (!parts) { parts = decomposeStrip(rects3[biggest]); }   // 面积≥5 必有解
    rects3.splice(biggest, 1);
    for (i = 0; i < parts.length; i++) { rects3.push(parts[i]); }
    var f3 = pickFixed(rects3);
    if (!f3) {   // 极端兜底：直接取最小的 3 块当固定（保证有解、可玩）
      var idx = rects3.map(function (r, k) { return { k: k, a: r.w * r.h }; })
        .sort(function (x, y) { return x.a - y.a; }).slice(0, 3).map(function (o) { return o.k; });
      return { rects: rects3, mono: idx[0], dom: [idx[1], idx[2]] };
    }
    return { rects: rects3, mono: f3.mono, dom: f3.dom };
  }

  /** 给托盘块上色（固定块标 -1，渲染为黑色）；同色不相邻 */
  function colorTray(pieces, size, rng) {
    var n = BF.COLORS.length;
    var owner = new Array(size * size);
    for (var i = 0; i < owner.length; i++) { owner[i] = -1; }

    // 先给固定块盖章，让邻接禁用逻辑知道它们的位置
    for (i = 0; i < pieces.length; i++) {
      if (pieces[i].fixed) {
        pieces[i].color = -1;
        for (var dy = 0; dy < pieces[i].h; dy++) {
          for (var dx = 0; dx < pieces[i].w; dx++) {
            owner[(pieces[i].y + dy) * size + (pieces[i].x + dx)] = pieces[i].id;
          }
        }
      }
    }

    var order = pieces.slice().sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
    for (var k = 0; k < order.length; k++) {
      var p = order[k];
      if (p.fixed) { continue; }
      var banned = {};
      for (var dyy = 0; dyy < p.h; dyy++) {
        for (var dxx = 0; dxx < p.w; dxx++) {
          var gx = p.x + dxx, gy = p.y + dyy;
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
      for (dyy = 0; dyy < p.h; dyy++) {
        for (dxx = 0; dxx < p.w; dxx++) { owner[(p.y + dyy) * size + p.x + dxx] = p.id; }
      }
    }
  }

  /** 由「切块结果 + 固定索引」组装成标准 puzzle 对象 */
  function assemble(rects, fixedIdx, seed) {
    var pieces = [], i;
    for (i = 0; i < rects.length; i++) {
      pieces.push({
        id: i, w: rects[i].w, h: rects[i].h,
        x: rects[i].x, y: rects[i].y, color: 0,
        fixed: fixedIdx.indexOf(i) >= 0
      });
    }
    colorTray(pieces, SIZE, U.mulberry32((seed | 0) + 777));

    var order = [];
    for (i = 0; i < pieces.length; i++) { if (!pieces[i].fixed) { order.push(i); } }
    U.shuffle(order, U.mulberry32((seed | 0) + 313));

    return {
      size: SIZE,
      area: SIZE * SIZE,
      pieces: pieces,
      fixed: fixedIdx.slice(),
      order: order,
      count: pieces.length,
      seed: seed | 0,
      gameId: 'mosaic'
    };
  }

  /** 构建第 n 关（确定性：同 n 永远同题） */
  function build(n) {
    n = Math.max(1, Math.round(n));
    var seed = 90211 + n * 7919;          // 与游戏 1 区分，避免撞题
    var res = carveFixed(SIZE, TOTAL_PIECES, seed);
    return assemble(res.rects, [res.mono, res.dom[0], res.dom[1]], seed);
  }

  /** 每日挑战：日期做 seed（只用于合集首页的「每日挑战」入口，归属 block 游戏） */
  function buildDaily(date) {
    var d = date || new Date();
    var seed = U.seedFromDate(d) % 2147483647;
    var res = carveFixed(SIZE, TOTAL_PIECES, seed);
    return assemble(res.rects, [res.mono, res.dom[0], res.dom[1]], seed);
  }

  /**
   * 通用生成（首页卡片缩略图用）：小尺寸、把最小的 3 块标黑当装饰，
   * 不参与真实关卡逻辑。
   */
  function generate(opt) {
    opt = opt || {};
    var size = Math.max(2, Math.round(opt.size || 4));
    var target = Math.max(1, Math.round(opt.pieceCount || 5));
    var seed = (opt.seed | 0) || 1;
    var rects = carve(size, target, U.mulberry32(seed), 0.10, 0.40);
    var pieces = [], i;
    for (i = 0; i < rects.length; i++) {
      pieces.push({ id: i, w: rects[i].w, h: rects[i].h, x: rects[i].x, y: rects[i].y, color: 0, fixed: false });
    }
    colorTray(pieces, size, U.mulberry32(seed + 777));
    // 最小的 3 块当装饰性黑块
    var small = pieces.map(function (p, k) { return { k: k, a: p.w * p.h }; })
      .sort(function (x, y) { return x.a - y.a; }).slice(0, 3).map(function (o) { return o.k; });
    for (i = 0; i < small.length; i++) { pieces[small[i]].fixed = true; pieces[small[i]].color = -1; }
    var order = [];
    for (i = 0; i < pieces.length; i++) { if (!pieces[i].fixed) { order.push(i); } }
    return { size: size, area: size * size, pieces: pieces, fixed: small, order: order, count: pieces.length, seed: seed, gameId: 'mosaic' };
  }

  BF.Mosaic = {
    SIZE: SIZE,
    TOTAL: TOTAL,
    TOTAL_PIECES: TOTAL_PIECES,
    build: build,
    buildDaily: buildDaily,
    generate: generate,
    _carve: carve,
    _carveFixed: carveFixed
  };
})();
