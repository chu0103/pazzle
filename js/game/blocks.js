/**
 * blocks.js —— 第 8 款游戏「超级积木」关卡生成器 + 数据层
 *
 * 玩法（数字化「计客超级积木 GIIKER Super Blocks」）：
 *   8×8 LED 点阵棋盘，开局亮起一片**不规则局部亮区**（不是铺满整盘！），
 *   并指定**一个颜色组**；玩家只可用该色的积木，把亮区**不重叠、不出界**地恰好填满即过关。
 *
 * 数据层职责（与玩法场景解耦）：
 *   1. 16 块积木形状库（4 色 × 4 块，3~5 格，形状互不相同）；
 *   2. 旋转 + 位掩码（8×8=64 格，BigInt 掩码）工具；
 *   3. 精确覆盖求解器 countSolutions —— 统计「用指定积木恰好覆盖亮区」的方案数（= 难度量）；
 *   4. 正向造题 generateOne —— 随机合法摆放积木 → 被占格即亮区（天然有解）；
 *   5. build(n) / buildDaily —— 取第 n 关 / 每日关；
 *   6. starsFor / rankFor —— 普通关 ★★★ 与限时挑战 S/A/B/C/D/E 的评级真源；
 *   7. 注册 BF.games.blocks（TOTAL=40, scene:'blocks'）。
 *
 * 关卡表内联在底部 LEVELS（离线生成、运行时不重算、确定性）；
 * LEVELS 为空时 build 走确定性实时生成（仅用于离线生成脚本与调试）。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.BlocksGen) { return; }
  var U = BF.util;

  var SIZE = 8, AREA = SIZE * SIZE;

  // 4 色（高饱和、色盲友好）；索引 0=红 1=绿 2=蓝 3=黄
  var COLOR_HEX = ['#E63946', '#3DA35D', '#3E6FBF', '#F2C13C'];
  var COLOR_NAME = ['红', '绿', '蓝', '黄'];

  /**
   * 16 块积木（相对坐标，每块至少一个格在 (0,0)）。
   * 每色 4 块，单块 3~5 格（tromino / tetromino / pentomino 族）。
   *
   * ⚠️ 关键不变量：16 块必须是「全局两两不同的自由多连块」（旋转等价视为同一块，
   * 但镜像视为不同——不过本库连镜像都不重复）。否则同一掩码会同时命中两块，
   * placementToPiece 会反推错 pid → 颜色错误。下方 assertDistinctShapes() 会自检。
   *
   * 取用的自由多连块：
   *   三连块(2)：I3, L3
   *   四连块(5 种全用)：O4, T4, I4, S4, L4（S4 与 Z4 是同一自由块，只取其一）
   *   五连块(取 9 种)：P5, L5, N5, U5, V5, I5, T5, Y5, X5
   * 每色 4 块总格数：红 3+4+4+5=16 / 绿 3+4+4+5=16 / 蓝 4+5+5+5=19 / 黄 5+5+5+5=20。
   */
  var SHAPES = [
    // 红 c:0  I3(3) / O4(4) / T4(4) / P5(5)
    { c: 0, cells: [[0, 0], [1, 0], [2, 0]] },                 // 红 I3 (3)
    { c: 0, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },         // 红 O4 (4)
    { c: 0, cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },         // 红 T4 (4)
    { c: 0, cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]] }, // 红 P5 (5)
    // 绿 c:1  L3(3) / I4(4) / S4(4) / L5(5)
    { c: 1, cells: [[0, 0], [1, 0], [0, 1]] },                 // 绿 L3 (3)
    { c: 1, cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },         // 绿 I4 (4)
    { c: 1, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },         // 绿 S4 (4)
    { c: 1, cells: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]] }, // 绿 L5 (5)
    // 蓝 c:2  L4(4) / N5(5) / U5(5) / V5(5)
    { c: 2, cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },         // 蓝 L4 (4)
    { c: 2, cells: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]] }, // 蓝 N5 (5)
    { c: 2, cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]] }, // 蓝 U5 (5)
    { c: 2, cells: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]] }, // 蓝 V5 (5)
    // 黄 c:3  I5(5) / T5(5) / Y5(5) / X5(5)
    { c: 3, cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] }, // 黄 I5 (5)
    { c: 3, cells: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]] }, // 黄 T5 (5)
    { c: 3, cells: [[1, 0], [0, 1], [1, 1], [1, 2], [1, 3]] }, // 黄 Y5 (5)
    { c: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] }  // 黄 X5 (5)
  ];

  /**
   * 自检：16 块是否两两不同的自由多连块。
   * 两个 pid 属同一自由块 ⇔ 存在彼此的旋转归一化形状相等。
   * 返回重复对数组（空 = 全部不同）。
   */
  function assertDistinctShapes() {
    var canon = function (cells) {
      return normalize(cells).map(function (p) { return p[0] + ',' + p[1]; }).sort().join(';');
    };
    var keys = SHAPES.map(function (s) {
      var set = {};
      rotations(s.cells).forEach(function (r) { set[canon(r)] = 1; });
      return Object.keys(set);
    });
    var dups = [];
    for (var i = 0; i < keys.length; i++) {
      for (var j = i + 1; j < keys.length; j++) {
        var hit = keys[i].filter(function (k) { return keys[j].indexOf(k) >= 0; });
        if (hit.length) { dups.push([i, j, hit[0]]); }
      }
    }
    return dups;
  }
  var _dups = assertDistinctShapes();
  if (_dups && _dups.length) {
    // 仅开发期告警；真实环境不影响运行（但应修复数据）
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[blocks] SHAPES 存在重复自由块: ' + JSON.stringify(_dups));
    }
  }

  /* ---------------- 几何工具 ---------------- */

  /** base-36 字符串 → BigInt（JS 原生 BigInt() 只认十进制/0x/0o/0b，不能解 36 进制） */
  function from36(s) {
    var v = 0n;
    for (var i = 0; i < s.length; i++) {
      v = v * 36n + BigInt(parseInt(s[i], 36));
    }
    return v;
  }

  function normalize(cells) {
    var minx = Infinity, miny = Infinity, i;
    for (i = 0; i < cells.length; i++) {
      if (cells[i][0] < minx) { minx = cells[i][0]; }
      if (cells[i][1] < miny) { miny = cells[i][1]; }
    }
    return cells.map(function (p) { return [p[0] - minx, p[1] - miny]; });
  }

  function rotate(cells) {
    // 顺时针 90°：(x,y) -> (-y, x)，再归一化
    return normalize(cells.map(function (p) { return [-p[1], p[0]]; }));
  }

  /** 一块的所有不同旋转（去重，最多 4 个） */
  function rotations(cells) {
    var seen = {}, out = [];
    var cur = normalize(cells);
    for (var r = 0; r < 4; r++) {
      var key = cur.map(function (p) { return p[0] + ',' + p[1]; }).sort().join(';');
      if (!seen[key]) { seen[key] = 1; out.push(cur); }
      cur = rotate(cur);
    }
    return out;
  }

  function maskOf(cells, ox, oy) {
    var m = 0n;
    for (var i = 0; i < cells.length; i++) {
      m |= (1n << BigInt((cells[i][1] + oy) * SIZE + (cells[i][0] + ox)));
    }
    return m;
  }

  // ⚠️ 曾经返回的是「最大坐标」（= 尺寸-1），导致托盘 cs 偏大、积木撑出槽位而抓不到。
  // 正确语义：包围盒「尺寸」= max - min + 1（并顺带给出 min，供绘制原点对齐）。
  function bbox(cells) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < cells.length; i++) {
      var x = cells[i][0], y = cells[i][1];
      if (x < minX) { minX = x; }
      if (x > maxX) { maxX = x; }
      if (y < minY) { minY = y; }
      if (y > maxY) { maxY = y; }
    }
    if (maxX < minX) { return { w: 0, h: 0, minX: 0, minY: 0 }; }
    return { w: maxX - minX + 1, h: maxY - minY + 1, minX: minX, minY: minY };
  }

  /* ---------------- 预计算：旋转 + 全部合法放置 ---------------- */

  var PIECE_ROT = [];    // [pid] = [cells, cells, ...]（旋转后的归一化形状）
  var PIECE_PLACE = [];  // [pid] = [BigInt, ...]（该块在 8×8 内的全部放置掩码，去重）
  var PIECE_AREA = [];   // [pid] = 格数
  (function precompute() {
    for (var pid = 0; pid < SHAPES.length; pid++) {
      var rots = rotations(SHAPES[pid].cells);
      PIECE_ROT[pid] = rots;
      PIECE_AREA[pid] = SHAPES[pid].cells.length;
      var set = new Set();
      for (var r = 0; r < rots.length; r++) {
        var b = bbox(rots[r]);
        for (var ox = 0; ox + b.w <= SIZE; ox++) {
          for (var oy = 0; oy + b.h <= SIZE; oy++) {
            set.add(maskOf(rots[r], ox, oy));
          }
        }
      }
      PIECE_PLACE[pid] = Array.from(set);
    }
  })();

  /* ---------------- 精确覆盖求解器 ---------------- */

  /** 最低位（BigInt） */
  function lowbit(m) { return m & (-m); }

  /**
   * 统计「用 pieces 的每一块恰好一次、完全覆盖 region」的方案数。
   * @param region   BigInt 掩码，所有目标格
   * @param pieceMasks 数组，每项 = 该块的全部放置掩码（BigInt[]）
   * @returns Number（只关心数量级，封顶 CAP）
   */
  function countSolutions(region, pieceMasks) {
    var used = new Array(pieceMasks.length).fill(false);
    // 只需「是否可解」，解数达 2 即早停（上限越低生成越快；存值与复算口径一致，验证仍成立）
    var CAP = 2;
    function dfs(cur) {
      if (cur === 0n) { return 1; }
      var lb = lowbit(cur);
      var total = 0;
      for (var pi = 0; pi < pieceMasks.length; pi++) {
        if (used[pi]) { continue; }
        var ms = pieceMasks[pi];
        for (var m = 0; m < ms.length; m++) {
          var mask = ms[m];
          // 必须完全落在未覆盖集内（= 在目标区内且不重叠），且必须覆盖最低位
          if ((mask & cur) !== mask) { continue; }
          if ((mask & lb) !== lb) { continue; }
          used[pi] = true;
          total += dfs(cur ^ mask);
          used[pi] = false;
          if (total > CAP) { return CAP; }
        }
      }
      return total;
    }
    return dfs(region);
  }

  /* ---------------- 正向造题 ---------------- */

  /**
   * 随机造一题。
   * @param rng   0~1 的随机函数（mulberry32）
   * @param groups 选块计划，如 [{c:0,n:3}]（单色3块）/ [{c:0,n:2},{c:1,n:2}]（双色各2）
   * @returns { region, chosen, placed, sols } 或 null（摆不下）
   */
  /** 取颜色组内全部积木 id（求解器用它来数"用整盒积木能有多少种铺法"= 难度） */
  function colorPieceIds(colors) {
    var out = [];
    colors.forEach(function (c) {
      for (var pid = 0; pid < SHAPES.length; pid++) {
        if (SHAPES[pid].c === c) { out.push(pid); }
      }
    });
    return out;
  }

  function generateOne(rng, groups) {
    // 1) 按 plan 从各色挑出具体块 id（钉死，用于造出 region）
    var chosen = [];
    for (var g = 0; g < groups.length; g++) {
      var c = groups[g].c, need = groups[g].n;
      var pool = [];
      for (var pid = 0; pid < SHAPES.length; pid++) {
        if (SHAPES[pid].c === c) { pool.push(pid); }
      }
      pool = U.shuffle(pool, rng);
      for (var k = 0; k < need && k < pool.length; k++) { chosen.push(pool[k]); }
    }
    if (chosen.length === 0) { return null; }

    // 2) 依次随机旋转 + 随机落点摆放（互不重叠）
    var board = 0n;
    var placed = [];
    for (var i = 0; i < chosen.length; i++) {
      var place = PIECE_PLACE[chosen[i]];
      var ok = false;
      for (var t = 0; t < 400; t++) {
        var m = place[(rng() * place.length) | 0];
        if ((m & board) === 0n) { board |= m; placed.push(m); ok = true; break; }
      }
      if (!ok) { return null; }   // 放不下，整体重试
    }

    // 3) 解数：用「颜色组内全部积木」的所有放置来铺 region，
    //    统计恰好覆盖的方案数（= 难度量；允许只用其中若干块）。
    var colors = groups.map(function (gg) { return gg.c; });
    var allPids = colorPieceIds(colors);
    var pieceMasks = allPids.map(function (pid) { return PIECE_PLACE[pid]; });
    var sols = countSolutions(board, pieceMasks);
    return { region: board, chosen: chosen, placed: placed, sols: sols, colors: colors };
  }

  /* ---------------- 档位参数 ---------------- */

  // 40 关 = 4 档 × 10 关
  // 入门 1-10：单色 3 块；进阶 11-20：单色 4 块；
  // 困难 21-30：双色各 2 块；专家 31-40：双色/三色 5~6 块。
  function tierOf(n) {
    if (n <= 10) { return 0; }
    if (n <= 20) { return 1; }
    if (n <= 30) { return 2; }
    return 3;
  }

  function planFor(n) {
    var tier = tierOf(n);
    // 难度轴 = 颜色数×100 + 块数（档间严格递增）。颜色约束是核心难点，故从入门档就引入双色。
    //   入门 双色5块 → 进阶 双色7块 → 困难 三色9块 → 专家 三色11块（亮区 16~58 格，接近满盘）
    //   ⚠️ 专家档块数原设想 12，实测高密度区生成超时（countSolutions 数解无上限），
    //      收敛为 11 块（三色满配）后生成稳定；难度轴 = 311。
    if (tier === 0) { return [{ c: 0, n: 3 }, { c: 1, n: 2 }]; }            // 红3 + 绿2 = 5 块
    if (tier === 1) { return [{ c: 0, n: 4 }, { c: 2, n: 3 }]; }            // 红4 + 蓝3 = 7 块
    if (tier === 2) { return [{ c: 0, n: 4 }, { c: 2, n: 3 }, { c: 3, n: 2 }]; } // 红4+蓝3+黄2 = 9 块
    return [{ c: 0, n: 4 }, { c: 1, n: 4 }, { c: 2, n: 3 }];               // 红4+绿4+蓝3 = 11 块（三色满配）
  }

  // 每档的目标亮格数区间（几何合理性，占 8×8=64 格的比例）；解数仅作「可解」校验（≥1）。
  // 难度量化用「颜色数×100 + 块数」：入门205 < 进阶207 < 困难309 < 专家311，档间严格递增。
  var TIER_RANGE = [
    { cells: [16, 22], sols: [1, 999999] },   // 入门：双色 5 块（亮区约占 1/4 盘）
    { cells: [24, 33], sols: [1, 999999] },   // 进阶：双色 7 块
    { cells: [36, 48], sols: [1, 999999] },   // 困难：三色 9 块（占约 2/3 盘）
    { cells: [46, 58], sols: [1, 999999] }    // 专家：三色 12 块（接近满盘）
  ];

  /** 把全局掩码编成「块列表」（每块给出覆盖它的具体放置之一，用于提示/初始布局参考） */
  function decompose(region, chosen) {
    // 贪心按 chosen 顺序取第一个合法放置（仅用于"标准解"展示，不唯一）
    var used = new Array(chosen.length).fill(false);
    var cur = region;
    var out = [];
    for (var i = 0; i < chosen.length; i++) {
      var place = PIECE_PLACE[chosen[i]];
      var found = null;
      for (var m = 0; m < place.length; m++) {
        if ((place[m] & cur) === place[m]) { found = place[m]; break; }
      }
      if (found == null) { break; }
      cur ^= found;
      out.push(found);
    }
    return out;
  }

  function maskToCells(mask) {
    var out = [];
    for (var y = 0; y < SIZE; y++) {
      for (var x = 0; x < SIZE; x++) {
        if ((mask & (1n << BigInt(y * SIZE + x))) !== 0n) { out.push([x, y]); }
      }
    }
    return out;
  }

  function placementToPiece(mask) {
    // 从掩码反推 (id, rot, x, y) —— 在 PIECE_PLACE 里查；返回第一匹配
    for (var pid = 0; pid < PIECE_PLACE.length; pid++) {
      var idx = PIECE_PLACE[pid].indexOf(mask);
      if (idx >= 0) {
        // 反推 rot：在 PIECE_ROT[pid] 里找哪个旋转 + 偏移能生成 mask
        for (var r = 0; r < PIECE_ROT[pid].length; r++) {
          var b = bbox(PIECE_ROT[pid][r]);
          for (var ox = 0; ox + b.w <= SIZE; ox++) {
            for (var oy = 0; oy + b.h <= SIZE; oy++) {
              if (maskOf(PIECE_ROT[pid][r], ox, oy) === mask) {
                return { id: pid, rot: r, x: ox, y: oy };
              }
            }
          }
        }
      }
    }
    return null;
  }

  /* ---------------- 关卡构建 ---------------- */

  function regionCellsOf(mask) { return maskToCells(mask); }

  /** 把内部题结构整理成场景可用对象 */
  function toLevel(n, prob, timed) {
    var tier = tierOf(n);
    // 颜色以造题时实际选用的组为准（prob.colors）；
    // 只有缺失时才回退到 planFor（buildDaily 的 n=0 不能走 planFor，否则会把双色题标成单色）。
    var colors;
    if (prob.colors && prob.colors.length) {
      colors = prob.colors.slice();
    } else {
      var groups0 = planFor(n);
      colors = [];
      for (var g0 = 0; g0 < groups0.length; g0++) { colors.push(groups0[g0].c); }
    }

    // 标准解：优先用 generateOne 实际落子 placed（精确铺满）；
    // 兜底才用贪心 decompose（仅当 placed 缺失时）。
    var sol = (prob.placed && prob.placed.length) ? prob.placed
            : decompose(prob.region, prob.chosen);
    var pieces = [];
    for (var i = 0; i < sol.length; i++) {
      var pp = placementToPiece(sol[i]);
      if (pp) { pieces.push(pp); }
    }
    return {
      n: n,
      size: SIZE,
      region: prob.region,                       // BigInt
      regionStr: prob.region.toString(36),
      colors: colors,
      pieces: pieces,                             // [{id,rot,x,y}]
      sols: prob.sols,
      timed: !!timed,
      timeLimit: timed ? (tier <= 1 ? 75000 : 90000) : 0
    };
  }

  /** 确定性实时生成（仅离线生成脚本 / 调试用；最终运行走 LEVELS） */
  function runtimeBuild(n) {
    var tier = tierOf(n);
    var range = TIER_RANGE[tier];
    var baseSeed = 530000 + n * 2654435761 % 1000003;
    for (var attempt = 0; attempt < 4000; attempt++) {
      var seed = (baseSeed + attempt * 104729) >>> 0;
      var rng = U.mulberry32(seed);
      // 整个造题只用这一个 rng，保证确定性
      var groups = planFor(n);
      var prob = generateOne(rng, groups);
      if (!prob) { continue; }
      var cells = maskToCells(prob.region).length;
      if (cells < range.cells[0] || cells > range.cells[1]) { continue; }
      if (prob.sols < range.sols[0] || prob.sols > range.sols[1]) { continue; }
      return toLevel(n, prob, false);
    }
    // 兜底：放宽到任何可解题
    var rng2 = U.mulberry32(baseSeed >>> 0);
    var p2 = generateOne(rng2, planFor(n));
    if (p2) { return toLevel(n, p2, false); }
    throw new Error('blocks: 关卡 ' + n + ' 生成失败');
  }

  function build(n) {
    if (LEVELS && LEVELS[n - 1]) { return fromStored(LEVELS[n - 1], n); }
    return runtimeBuild(n);
  }

  function buildDaily(date) {
    var d = date || new Date();
    var seed = (U.seedFromDate(d) % 2000000) + 400000;
    // 取困难档参数（双色，趣味适中）
    var groups = [{ c: 0, n: 2 }, { c: 2, n: 2 }];
    var prob = null;
    for (var t = 0; t < 8 && !prob; t++) {
      prob = generateOne(U.mulberry32((seed + t * 104729) >>> 0), groups);
    }
    if (!prob) { throw new Error('blocks: 每日挑战生成失败'); }
    var lv = toLevel(0, prob, false);
    lv.daily = true;
    lv.n = 0;
    return lv;
  }

  /* ---------------- 评级 ---------------- */

  /** 普通关 ★★★：3★=没用提示且一次摆对；2★=用过提示或有过 1 次非法落子；1★=通关即可 */
  function starsFor(hintCount, illegal) {
    if (hintCount === 0 && illegal === 0) { return 3; }
    if (hintCount <= 1 && illegal <= 1) { return 2; }
    return 1;
  }

  /** 限时挑战 S/A/B/C/D/E：按剩余时间比例 */
  function rankFor(ratio) {
    if (ratio >= 0.8) { return 'S'; }
    if (ratio >= 0.6) { return 'A'; }
    if (ratio >= 0.4) { return 'B'; }
    if (ratio >= 0.2) { return 'C'; }
    if (ratio >= 0.05) { return 'D'; }
    return 'E';
  }

  /* ---------------- 内联关卡表（离线生成；运行时不重算） ---------------- */
  // 字段：r=region(36进制字符串) c=colors[] p=标准解[{i:id,r:rot,x,y}] s=sols t=timed tl=timeLimit(秒)
  var LEVELS = [
  {r:'10tt0ubv8ynls',c:[0,1],p:[{i:2,r:2,x:1,y:2},{i:0,r:1,x:6,y:5},{i:1,r:0,x:6,y:1},{i:6,r:1,x:1,y:4},{i:4,r:3,x:0,y:6}],s:1,t:0,tl:0},
  {r:'18427cejcw',c:[0,1],p:[{i:1,r:0,x:3,y:2},{i:0,r:1,x:7,y:0},{i:2,r:2,x:4,y:4},{i:7,r:1,x:0,y:4},{i:4,r:3,x:0,y:1}],s:1,t:0,tl:0},
  {r:'7qbkfhdl5hs',c:[0,1],p:[{i:0,r:1,x:0,y:2},{i:3,r:0,x:2,y:4},{i:1,r:0,x:5,y:5},{i:4,r:3,x:1,y:2},{i:5,r:1,x:4,y:0}],s:1,t:0,tl:0},
  {r:'qkyrxbm4oav',c:[0,1],p:[{i:3,r:1,x:0,y:0},{i:2,r:0,x:1,y:3},{i:0,r:1,x:0,y:5},{i:5,r:1,x:6,y:3},{i:4,r:3,x:3,y:5}],s:1,t:0,tl:0},
  {r:'260z21bbngu8w',c:[0,1],p:[{i:3,r:3,x:1,y:6},{i:2,r:2,x:4,y:0},{i:0,r:1,x:7,y:5},{i:6,r:0,x:0,y:3},{i:5,r:0,x:0,y:5}],s:1,t:0,tl:0},
  {r:'62vofwcccvsw',c:[0,1],p:[{i:3,r:0,x:3,y:5},{i:1,r:0,x:0,y:6},{i:2,r:3,x:3,y:1},{i:4,r:3,x:5,y:1},{i:6,r:0,x:3,y:3}],s:2,t:0,tl:0},
  {r:'hq2duca9b9y0',c:[0,1],p:[{i:2,r:1,x:5,y:1},{i:1,r:0,x:1,y:2},{i:3,r:0,x:3,y:0},{i:6,r:0,x:1,y:4},{i:4,r:0,x:5,y:6}],s:1,t:0,tl:0},
  {r:'2bhjc78z4vt1',c:[0,1],p:[{i:0,r:1,x:0,y:0},{i:3,r:3,x:4,y:4},{i:2,r:3,x:2,y:0},{i:6,r:0,x:4,y:2},{i:7,r:1,x:2,y:6}],s:1,t:0,tl:0},
  {r:'iayfszy156a0',c:[0,1],p:[{i:0,r:1,x:3,y:0},{i:2,r:2,x:1,y:2},{i:3,r:0,x:5,y:5},{i:7,r:1,x:0,y:6},{i:6,r:1,x:6,y:1}],s:2,t:0,tl:0},
  {r:'xer6y6ou3g',c:[0,1],p:[{i:3,r:1,x:1,y:5},{i:2,r:3,x:1,y:2},{i:1,r:0,x:2,y:0},{i:7,r:0,x:6,y:0},{i:5,r:1,x:4,y:0}],s:1,t:1,tl:75},
  {r:'10k2e1pmou266',c:[0,2],p:[{i:2,r:3,x:1,y:5},{i:1,r:0,x:1,y:0},{i:3,r:0,x:6,y:5},{i:0,r:1,x:6,y:0},{i:10,r:2,x:5,y:3},{i:8,r:2,x:0,y:2},{i:11,r:2,x:3,y:0}],s:1,t:0,tl:0},
  {r:'1ofi76plaqayo',c:[0,2],p:[{i:2,r:2,x:2,y:1},{i:1,r:0,x:0,y:2},{i:0,r:0,x:4,y:4},{i:3,r:2,x:5,y:5},{i:8,r:1,x:2,y:3},{i:11,r:0,x:1,y:5},{i:9,r:1,x:5,y:1}],s:1,t:0,tl:0},
  {r:'31dg2bxskv2ge',c:[0,2],p:[{i:2,r:2,x:4,y:0},{i:3,r:0,x:3,y:4},{i:1,r:0,x:6,y:6},{i:0,r:0,x:0,y:7},{i:9,r:1,x:0,y:3},{i:8,r:1,x:1,y:0},{i:11,r:2,x:5,y:3}],s:1,t:0,tl:0},
  {r:'3ppd5ncpl4q',c:[0,2],p:[{i:1,r:0,x:1,y:4},{i:0,r:0,x:5,y:3},{i:2,r:2,x:0,y:0},{i:3,r:1,x:3,y:5},{i:9,r:3,x:3,y:2},{i:11,r:1,x:3,y:0},{i:8,r:3,x:0,y:2}],s:2,t:0,tl:0},
  {r:'7sjob5mol8c7',c:[0,2],p:[{i:3,r:3,x:3,y:5},{i:2,r:2,x:1,y:6},{i:0,r:1,x:6,y:2},{i:1,r:0,x:2,y:1},{i:8,r:1,x:0,y:0},{i:11,r:1,x:0,y:3},{i:10,r:2,x:4,y:0}],s:1,t:0,tl:0},
  {r:'fgmjbg9vzbp8',c:[0,2],p:[{i:0,r:0,x:2,y:7},{i:1,r:0,x:2,y:2},{i:3,r:0,x:6,y:2},{i:2,r:0,x:2,y:0},{i:8,r:1,x:5,y:0},{i:11,r:3,x:3,y:4},{i:9,r:1,x:1,y:4}],s:1,t:0,tl:0},
  {r:'qyksuwxatrf4',c:[0,2],p:[{i:2,r:0,x:2,y:5},{i:0,r:0,x:4,y:2},{i:1,r:0,x:4,y:6},{i:3,r:3,x:4,y:3},{i:8,r:1,x:0,y:6},{i:10,r:1,x:1,y:1},{i:9,r:1,x:2,y:0}],s:1,t:0,tl:0},
  {r:'1ogvdd9kaz0ps',c:[0,2],p:[{i:2,r:2,x:1,y:6},{i:3,r:1,x:4,y:6},{i:1,r:0,x:0,y:2},{i:0,r:1,x:6,y:2},{i:10,r:3,x:3,y:1},{i:11,r:0,x:2,y:2},{i:9,r:0,x:5,y:0}],s:1,t:0,tl:0},
  {r:'5vubafizdro',c:[0,2],p:[{i:0,r:0,x:3,y:1},{i:3,r:2,x:2,y:4},{i:2,r:1,x:5,y:4},{i:1,r:0,x:4,y:3},{i:10,r:3,x:0,y:3},{i:9,r:1,x:0,y:0},{i:11,r:2,x:4,y:0}],s:1,t:0,tl:0},
  {r:'ziull2fc6g3',c:[0,2],p:[{i:2,r:2,x:4,y:0},{i:0,r:1,x:0,y:5},{i:1,r:0,x:2,y:5},{i:3,r:3,x:3,y:2},{i:9,r:2,x:5,y:4},{i:10,r:3,x:0,y:0},{i:11,r:3,x:5,y:0}],s:1,t:1,tl:75},
  {r:'10avmwwmnhafg',c:[0,2,3],p:[{i:2,r:0,x:4,y:4},{i:1,r:0,x:2,y:0},{i:3,r:0,x:6,y:1},{i:0,r:1,x:6,y:5},{i:11,r:3,x:2,y:1},{i:8,r:1,x:1,y:6},{i:10,r:2,x:1,y:4},{i:12,r:1,x:0,y:2},{i:13,r:3,x:1,y:1}],s:2,t:0,tl:0},
  {r:'1uhbg7egjxveg',c:[0,2,3],p:[{i:2,r:0,x:5,y:1},{i:1,r:0,x:0,y:2},{i:0,r:0,x:3,y:0},{i:3,r:0,x:2,y:3},{i:9,r:0,x:4,y:5},{i:11,r:0,x:3,y:5},{i:8,r:1,x:0,y:6},{i:15,r:0,x:5,y:3},{i:14,r:0,x:3,y:1}],s:2,t:0,tl:0},
  {r:'2hs4r6cwzho58',c:[0,2,3],p:[{i:3,r:3,x:0,y:2},{i:0,r:1,x:6,y:0},{i:2,r:0,x:3,y:0},{i:1,r:0,x:0,y:6},{i:11,r:0,x:5,y:2},{i:8,r:0,x:2,y:4},{i:10,r:2,x:5,y:6},{i:12,r:1,x:4,y:2},{i:13,r:1,x:0,y:0}],s:1,t:0,tl:0},
  {r:'3h5ohgpdgtjz2',c:[0,2,3],p:[{i:0,r:0,x:1,y:0},{i:2,r:3,x:6,y:0},{i:1,r:0,x:1,y:1},{i:3,r:1,x:3,y:3},{i:9,r:2,x:1,y:3},{i:8,r:1,x:2,y:6},{i:11,r:3,x:5,y:5},{i:14,r:2,x:0,y:3},{i:15,r:0,x:3,y:0}],s:2,t:0,tl:0},
  {r:'3vosq4fcct733',c:[0,2,3],p:[{i:2,r:3,x:5,y:4},{i:3,r:0,x:2,y:2},{i:0,r:0,x:5,y:7},{i:1,r:0,x:5,y:2},{i:10,r:2,x:0,y:0},{i:8,r:2,x:3,y:0},{i:11,r:2,x:5,y:1},{i:12,r:0,x:0,y:7},{i:15,r:0,x:2,y:4}],s:2,t:0,tl:0},
  {r:'dqzfntvjkesc',c:[0,2,3],p:[{i:1,r:0,x:1,y:1},{i:3,r:1,x:4,y:3},{i:2,r:1,x:2,y:5},{i:0,r:0,x:2,y:0},{i:8,r:2,x:1,y:3},{i:11,r:1,x:4,y:5},{i:9,r:3,x:5,y:0},{i:14,r:0,x:6,y:1},{i:12,r:1,x:0,y:3}],s:2,t:0,tl:0},
  {r:'qtgiq6ze6v1k',c:[0,2,3],p:[{i:1,r:0,x:2,y:5},{i:0,r:1,x:3,y:2},{i:3,r:2,x:4,y:0},{i:2,r:0,x:4,y:3},{i:9,r:1,x:1,y:0},{i:8,r:0,x:4,y:5},{i:11,r:3,x:5,y:4},{i:15,r:0,x:0,y:3},{i:14,r:0,x:6,y:0}],s:2,t:0,tl:0},
  {r:'13d1v46kes8zi',c:[0,2,3],p:[{i:0,r:1,x:5,y:3},{i:3,r:1,x:2,y:3},{i:1,r:0,x:6,y:3},{i:2,r:2,x:0,y:6},{i:10,r:2,x:1,y:0},{i:9,r:3,x:0,y:2},{i:11,r:1,x:4,y:0},{i:13,r:3,x:2,y:4},{i:15,r:0,x:5,y:5}],s:2,t:0,tl:0},
  {r:'3n3wzd4hamt83',c:[0,2,3],p:[{i:2,r:2,x:3,y:5},{i:1,r:0,x:6,y:2},{i:0,r:0,x:4,y:0},{i:3,r:0,x:0,y:0},{i:11,r:1,x:5,y:1},{i:10,r:2,x:0,y:4},{i:9,r:1,x:1,y:1},{i:14,r:1,x:0,y:6},{i:13,r:2,x:5,y:5}],s:2,t:0,tl:0},
  {r:'yhihiw3pggyo',c:[0,2,3],p:[{i:2,r:0,x:2,y:5},{i:0,r:0,x:5,y:0},{i:1,r:0,x:4,y:3},{i:3,r:2,x:0,y:1},{i:10,r:1,x:6,y:1},{i:11,r:1,x:2,y:1},{i:9,r:2,x:0,y:4},{i:12,r:0,x:1,y:7},{i:14,r:1,x:4,y:5}],s:1,t:1,tl:100},
  {r:'131w00410csme',c:[0,1,2],p:[{i:0,r:0,x:0,y:2},{i:2,r:1,x:5,y:1},{i:3,r:0,x:2,y:4},{i:1,r:0,x:0,y:3},{i:7,r:3,x:2,y:0},{i:5,r:1,x:6,y:4},{i:4,r:0,x:4,y:5},{i:6,r:0,x:0,y:0},{i:11,r:0,x:0,y:5},{i:8,r:2,x:6,y:0},{i:9,r:2,x:3,y:2}],s:2,t:0,tl:0},
  {r:'1u7nnndkjhrao',c:[0,1,2],p:[{i:3,r:1,x:0,y:1},{i:0,r:1,x:4,y:1},{i:1,r:0,x:2,y:4},{i:2,r:0,x:4,y:5},{i:6,r:1,x:6,y:0},{i:7,r:2,x:4,y:0},{i:4,r:2,x:3,y:6},{i:5,r:1,x:0,y:3},{i:9,r:1,x:5,y:5},{i:11,r:1,x:1,y:3},{i:8,r:3,x:5,y:3}],s:2,t:0,tl:0},
  {r:'27wi75qj4oghr',c:[0,1,2],p:[{i:2,r:1,x:6,y:5},{i:3,r:0,x:4,y:5},{i:1,r:0,x:4,y:1},{i:0,r:1,x:0,y:5},{i:6,r:0,x:2,y:4},{i:5,r:0,x:1,y:0},{i:7,r:2,x:0,y:3},{i:4,r:1,x:5,y:3},{i:11,r:0,x:0,y:0},{i:9,r:0,x:5,y:0},{i:8,r:0,x:3,y:1}],s:2,t:0,tl:0},
  {r:'3dhftje48i3nz',c:[0,1,2],p:[{i:3,r:2,x:3,y:3},{i:2,r:3,x:3,y:0},{i:0,r:0,x:2,y:7},{i:1,r:0,x:5,y:3},{i:5,r:0,x:4,y:2},{i:4,r:2,x:6,y:6},{i:6,r:0,x:1,y:3},{i:7,r:0,x:0,y:0},{i:9,r:1,x:5,y:4},{i:8,r:1,x:0,y:6},{i:10,r:1,x:1,y:0}],s:2,t:0,tl:0},
  {r:'3nxakam0pz666',c:[0,1,2],p:[{i:2,r:0,x:1,y:3},{i:0,r:0,x:2,y:2},{i:3,r:0,x:0,y:4},{i:1,r:0,x:6,y:6},{i:7,r:2,x:4,y:0},{i:4,r:0,x:0,y:2},{i:6,r:1,x:3,y:5},{i:5,r:0,x:4,y:4},{i:11,r:1,x:5,y:5},{i:10,r:3,x:6,y:0},{i:8,r:1,x:1,y:0}],s:2,t:0,tl:0},
  {r:'3v80dxf3rt3ou',c:[0,1,2],p:[{i:0,r:0,x:4,y:4},{i:2,r:3,x:1,y:5},{i:1,r:0,x:6,y:2},{i:3,r:1,x:5,y:0},{i:5,r:0,x:4,y:7},{i:7,r:2,x:1,y:1},{i:6,r:0,x:3,y:2},{i:4,r:1,x:5,y:5},{i:10,r:3,x:2,y:5},{i:11,r:2,x:1,y:0},{i:8,r:0,x:0,y:2}],s:2,t:0,tl:0},
  {r:'gf8ly40fy5l9',c:[0,1,2],p:[{i:2,r:3,x:0,y:5},{i:3,r:2,x:6,y:4},{i:0,r:0,x:3,y:6},{i:1,r:0,x:2,y:0},{i:5,r:0,x:0,y:3},{i:7,r:3,x:2,y:3},{i:4,r:0,x:6,y:0},{i:6,r:0,x:3,y:1},{i:11,r:0,x:2,y:5},{i:9,r:2,x:0,y:0},{i:8,r:2,x:5,y:2}],s:2,t:0,tl:0},
  {r:'vh7axgqudb27',c:[0,1,2],p:[{i:3,r:1,x:0,y:3},{i:2,r:1,x:2,y:5},{i:1,r:0,x:4,y:0},{i:0,r:1,x:3,y:1},{i:6,r:0,x:4,y:6},{i:4,r:1,x:1,y:1},{i:7,r:1,x:0,y:0},{i:5,r:0,x:3,y:4},{i:8,r:1,x:4,y:5},{i:10,r:0,x:5,y:2},{i:9,r:3,x:0,y:5}],s:2,t:0,tl:0},
  {r:'1wy0961dcsqws',c:[0,1,2],p:[{i:1,r:0,x:2,y:6},{i:3,r:0,x:3,y:3},{i:0,r:0,x:5,y:1},{i:2,r:3,x:6,y:5},{i:7,r:1,x:2,y:0},{i:4,r:3,x:1,y:1},{i:6,r:1,x:6,y:2},{i:5,r:1,x:0,y:1},{i:9,r:3,x:0,y:5},{i:10,r:3,x:4,y:5},{i:11,r:2,x:3,y:2}],s:2,t:0,tl:0},
  {r:'z01dywql28nx',c:[0,1,2],p:[{i:3,r:1,x:3,y:3},{i:0,r:0,x:0,y:3},{i:2,r:3,x:6,y:0},{i:1,r:0,x:2,y:6},{i:5,r:0,x:2,y:5},{i:6,r:1,x:4,y:0},{i:4,r:0,x:2,y:0},{i:7,r:2,x:6,y:3},{i:11,r:0,x:0,y:0},{i:10,r:3,x:0,y:5},{i:9,r:1,x:4,y:5}],s:2,t:1,tl:120},
  
  ];

  function fromStored(rec, n) {
    var pieces = rec.p.map(function (q) { return { id: q.i, rot: q.r, x: q.x, y: q.y }; });
    return {
      n: n,
      size: SIZE,
      region: from36(rec.r),
      regionStr: rec.r,
      colors: rec.c,
      pieces: pieces,
      sols: rec.s,
      timed: !!rec.t,
      // ⚠️ 内联表 tl 单位是「秒」（与生成脚本口径一致），场景用的是毫秒 → 必须 ×1000
      timeLimit: (rec.tl || 0) * 1000
    };
  }

  /* ---------------- 注册 ---------------- */

  var games = BF.games || (BF.games = {});

  // 4 档难度的档名（与 tierOf 的 0/1/2/3 对应），供关卡页难度条与
  // 「先选难度再进游戏」首屏（BF.DiffPick）共用。
  var TIER_NAMES = ['入门', '进阶', '困难', '专家'];

  /** 某档包含哪些关卡号（4 档 × 10 关，连续区间） */
  function tierLevels(name) {
    var idx = TIER_NAMES.indexOf(name);
    if (idx < 0) { return []; }
    var first = idx * 10 + 1, out = [];
    for (var n = first; n <= Math.min(LEVELS.length, first + 9); n++) { out.push(n); }
    return out;
  }

  /** 某档第一关是第几关（关卡页顶部难度 chip 用） */
  function firstLevelOfSize(name) {
    var lv = tierLevels(name);
    return lv.length ? lv[0] : 1;
  }

  /** 某档的积木配方一句话（如「红3+绿2 块」） */
  function tierPlanText(n) {
    return planFor(n).map(function (p) { return COLOR_NAME[p.c] + p.n; }).join('+') + ' 块';
  }

  games.blocks = {
    id: 'blocks',
    // 「玩法说明」弹框（BF.RuleTip）：每次进这款游戏的第一个关卡时弹一次，
    // 玩家勾选「不再提示」后写入 Save.extra(id,'noRule')，之后不再弹。
    rules: {
      sub: '8×8 棋盘 · 填满亮区',
      lines: [
        '棋盘只亮起一块不规则区域',
        '把指定颜色的积木恰好填满亮区',
        '可旋转，落点有绿 / 红合法性预览',
        '每 10 关是限时挑战',
      ]
    },
    title: '超级积木',
    sub: '用指定颜色的积木，填满亮起的格子',
    skin: 'blocks',
    scene: 'blocks',
    TOTAL: LEVELS.length,
    difficulties: TIER_NAMES,
    tierLevels: tierLevels,
    firstLevelOfSize: firstLevelOfSize,
    chipLabel: function (name) {
      var lv = tierLevels(name);
      return lv.length ? (name + ' · ' + tierPlanText(lv[0])) : name;
    },
    // 难度自选首屏（BF.DiffPick）档卡副标题：积木配方 + 关卡范围
    pickInfo: function (idx, rg) {
      return { meta: tierPlanText(rg.first) + ' · 第 ' + rg.first + '-' + rg.last + ' 关' };
    },
    build: function (n) { return build(n); },
    buildDaily: buildDaily
  };

  BF.BlocksGen = {
    SIZE: SIZE,
    COLOR_HEX: COLOR_HEX,
    COLOR_NAME: COLOR_NAME,
    SHAPES: SHAPES,
    PIECE_ROT: PIECE_ROT,
    PIECE_PLACE: PIECE_PLACE,
    PIECE_AREA: PIECE_AREA,
    tierOf: tierOf,
    planFor: planFor,
    TIER_RANGE: TIER_RANGE,
    generateOne: generateOne,
    colorPieceIds: colorPieceIds,
    countSolutions: countSolutions,
    maskToCells: maskToCells,
    placementToPiece: placementToPiece,
    rotate: rotate,
    rotations: rotations,
    maskOf: maskOf,
    bbox: bbox,
    runtimeBuild: runtimeBuild,
    build: build,
    buildDaily: buildDaily,
    starsFor: starsFor,
    rankFor: rankFor,
    assertDistinctShapes: assertDistinctShapes,
    LEVELS: LEVELS
  };
})();
