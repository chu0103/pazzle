/**
 * cat.js —— 「猫猫方块」关卡生成器 + 注册（游戏 14）
 *
 * 玩法（忠实还原参考视频「猫猫方块 / 简单版数独」）：
 *   - 棋盘 N×N 被分成 N 个连通的彩色区域（每区域一种颜色）。
 *   - 每区域必须放恰好 1 只该色的猫（每種顏色一隻貓）。
 *   - 任意两只猫不能同行、不能同列（同行同列僅一隻）。
 *   - 任意两只猫不能 8 方向相邻（貓咪不能挨在一起）。
 *   固定 8 关闯关：第 1-2 关 6×6，第 3-4 关 7×7，第 5-8 关 8×8（渐进 6→8）。
 *
 * 生成器必须保证「必有解」：
 *   1) 先随机生成一组合法猫位（每行每列各 1 只、互不 8 相邻），作为 solution；
 *   2) 再把整盘划分成 N 个连通彩色区域，每个区域恰好包住 1 个 solution 位
 *      （solution 位 = 该区域的猫应落的格子，保证整盘存在合法解）。
 *   区域划分用「多源连通增长」：以每个 solution 位为种子，逐步把相邻空格并入
 *   某个邻区，保证每区连通且恰好含 1 个解位。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.CatGen) { return; }
  var U = BF.util;

  // 8 只猫的配色（明快、互异，便于一眼区分）
  var COLORS = [
    '#FF6B6B', // 红
    '#FFA94D', // 橙
    '#FCC419', // 黄
    '#69DB7C', // 绿
    '#38D9A9', // 青
    '#4DABF7', // 蓝
    '#9775FA', // 紫
    '#F783AC'  // 粉
  ];

  // 8 关尺寸（渐进 6→8）：第 1-2 关 6×6，3-4 关 7×7，5-8 关 8×8
  var LEVEL_SIZES = [6, 6, 7, 7, 8, 8, 8, 8];
  var TOTAL = 8;

  function sizeForLevel(level) {
    var i = U.clamp(level - 1, 0, LEVEL_SIZES.length - 1);
    return LEVEL_SIZES[i];
  }

  function range(n) { var a = []; for (var i = 0; i < n; i++) { a.push(i); } return a; }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /**
   * 生成一组合法猫位：返回列排列 p（p[row]=col），满足
   *   - 每行每列各 1 只（排列本身保证）
   *   - 任意两只不 8 相邻：行相邻的两只列差必须 >=2（|p[i]-p[i+1]|>=2）
   * 用种子 rng 试随机排列；试不出则退回「偶数位在前、奇数位在后」的确定性排列。
   */
  function genSolution(N, rng) {
    for (var attempt = 0; attempt < 300; attempt++) {
      var p = shuffle(range(N), rng);
      var ok = true;
      for (var i = 0; i < N - 1; i++) {
        if (Math.abs(p[i] - p[i + 1]) < 2) { ok = false; break; }
      }
      if (ok) { return p; }
    }
    // 确定性退回：偶数索引列、再奇数索引列，相邻差恒 >=2
    var p2 = [];
    for (var e = 0; e < N; e += 2) { p2.push(e); }
    for (var o = 1; o < N; o += 2) { p2.push(o); }
    return p2;
  }

  function inBounds(N, r, c) { return r >= 0 && c >= 0 && r < N && c < N; }

  /**
   * 把 N×N 盘面划分成 N 个连通区域，每个区域恰好包住 1 个 solution 位。
   * solPos[k] = {r,c} 为第 k 色（第 k 区）的猫位。
   * 多源连通增长：种子固定 → 每次把「与已分配格正交相邻」的空格并入某邻区
   * （优先并入当前最小区以保持均衡、且保证连通）。
   */
  function partitionRegions(N, solPos, rng) {
    var region = [];
    for (var r = 0; r < N; r++) { region.push(new Array(N).fill(-1)); }
    var sizes = new Array(N).fill(0);
    for (var k = 0; k < N; k++) {
      var s = solPos[k];
      region[s.r][s.c] = k;
      sizes[k] = 1;
    }
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var changed = true, guard = 0;
    while (changed && guard++ < N * N * 4) {
      changed = false;
      // 扫描所有未分配格，若有已分配正交邻格就并入
      for (var r2 = 0; r2 < N; r2++) {
        for (var c2 = 0; c2 < N; c2++) {
          if (region[r2][c2] !== -1) { continue; }
          var cand = [];
          for (var d = 0; d < dirs.length; d++) {
            var nr = r2 + dirs[d][0], nc = c2 + dirs[d][1];
            if (inBounds(N, nr, nc) && region[nr][nc] !== -1) { cand.push(region[nr][nc]); }
          }
          if (!cand.length) { continue; }
          // 选当前最小的候选区（随机打破平局），保证均衡 + 连通
          var minSz = Infinity, pick = cand[0];
          var ties = [];
          for (var ci = 0; ci < cand.length; ci++) {
            var reg = cand[ci];
            if (sizes[reg] < minSz) { minSz = sizes[reg]; ties = [reg]; }
            else if (sizes[reg] === minSz) { ties.push(reg); }
          }
          pick = ties.length > 1 ? ties[Math.floor(rng() * ties.length)] : ties[0];
          region[r2][c2] = pick;
          sizes[pick]++;
          changed = true;
        }
      }
    }
    return region;
  }

  /** 校验一组猫位是否合法（每行每列各 1、互不 8 相邻） */
  function validPlacement(cells) {
    var N = cells.length;
    var rowUsed = {}, colUsed = {};
    for (var i = 0; i < N; i++) {
      var a = cells[i];
      if (rowUsed[a.r] || colUsed[a.c]) { return false; }
      rowUsed[a.r] = 1; colUsed[a.c] = 1;
      for (var j = 0; j < N; j++) {
        if (i === j) { continue; }
        var b = cells[j];
        if (Math.abs(a.r - b.r) <= 1 && Math.abs(a.c - b.c) <= 1) { return false; }
      }
    }
    return true;
  }

  /** 校验区域划分：N 区、每区连通、每区恰好含 1 个解位 */
  function validPartition(N, region, solPos) {
    if (region.length !== N) { return false; }
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var seen = {};
    for (var k = 0; k < N; k++) {
      // BFS 该区，统计格子数 + 是否含解位
      var start = solPos[k];
      if (region[start.r][start.c] !== k) { return false; }
      var q = [[start.r, start.c]], vis = {}, cnt = 0, hasSol = false;
      vis[start.r * N + start.c] = 1;
      while (q.length) {
        var cur = q.pop();
        var r = cur[0], c = cur[1];
        if (region[r][c] !== k) { continue; }
        cnt++;
        if (r === start.r && c === start.c) { hasSol = true; }
        for (var d = 0; d < dirs.length; d++) {
          var nr = r + dirs[d][0], nc = c + dirs[d][1];
          if (inBounds(N, nr, nc) && !vis[nr * N + nc] && region[nr][nc] === k) {
            vis[nr * N + nc] = 1; q.push([nr, nc]);
          }
        }
      }
      if (!hasSol) { return false; }
      if (cnt < 1) { return false; }
    }
    return true;
  }

  function build(level) {
    var N = sizeForLevel(level);
    var rng = U.mulberry32((0x9e3779b1 ^ (Math.imul(level, 2654435761))) >>> 0);
    var p = genSolution(N, rng);
    var solPos = [];
    for (var k = 0; k < N; k++) { solPos.push({ r: k, c: p[k] }); }   // 第 k 色猫位 = (k, p[k])
    var region = partitionRegions(N, solPos, rng);
    return {
      level: level,
      size: N,
      region: region,        // region[r][c] = 颜色序号
      sol: solPos.slice(),   // sol[color] = {r,c}
      colors: COLORS
    };
  }

  BF.CatGen = {
    COLORS: COLORS,
    LEVEL_SIZES: LEVEL_SIZES,
    TOTAL: TOTAL,
    sizeForLevel: sizeForLevel,
    build: build,
    validPlacement: validPlacement,
    validPartition: validPartition
  };

  // 注册（固定 8 关闯关，TOTAL=8）
  var games = BF.games || (BF.games = {});
  games.cat = {
    id: 'cat',
    title: '猫猫方块',
    sub: '每色一只猫 · 同行列不相邻',
    skin: 'cat',
    scene: 'cat',
    TOTAL: TOTAL,
    build: function (n) { return build(n); },
    rules: {
      sub: '给每色区域放一只猫',
      lines: [
        '棋盘分成若干彩色区域，每区放 1 只同色猫',
        '每行、每列最多只能有 1 只猫',
        '任意两只猫不能上下左右斜向挨着',
        '点空格放猫，点猫可拿起来；✕ 处不能放',
        '放错（点 ✕）会扣 1 颗心，3 心用完本关重来'
      ]
    }
  };
})();
