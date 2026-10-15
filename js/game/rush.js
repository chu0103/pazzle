/**
 * rush.js —— 第 7 款游戏「移车出库」（Rush Hour / 华容道滑车解谜）
 *
 * 玩法：6×6（专家档 7×7）停车场网格里停着若干辆车，每辆车只能沿自身轴向滑动。
 * 想办法把**警车**（横车、占 2 格）滑到右侧出口并驶出即过关。
 *
 * 本文件只负责**数据与逻辑**（纯矢量、无 canvas 依赖，可在 node 直跑）：
 *   - 棋盘/车辆数据模型
 *   - BFS 最短步求解器：状态 = 每辆车的"滑动坐标"，一步 = 一辆车一次连续滑动
 *   - 程序化生成 20 关（4 档 × 5 关）：撒车 → BFS 求最少步 opt → 只留 opt 落在本档区间的关
 *   - 动态星级（由本关 opt 推导，单一真源）
 *
 * 设计要点：
 *   - **每关必定可解**（生成时 BFS 复核），**opt 已知**（星级要用），难度可精确控制。
 *   - 关卡摆位是确定性的（按关卡号做种子），生成结果内联进 LEVELS，运行时不重算 BFS。
 *   - 提示功能（场景里点一下）运行时对"当前局面"跑 BFS 求最优解的下一步（solveStep），
 *     6×6 极快；7×7 偶发稍慢但带状态数上限保护，不会卡死真机。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.RushGen) { return; }
  var U = BF.util;

  /**
   * 卡通车身色（与「密码推理」的 PALETTE **同源同序同值**，两两 ΔE00 ≥ 22.9，对比强）。
   * ⚠️ 改一边记得改另一边，并用 `node tools/_palette_check.js` 确认最小 ΔE00 仍 ≥ 20。
   * 第 9 色是**中性灰 `#7A828E`**（替代旧的青绿），使全表每种色相只出现一次——
   * 避免出现"两个绿/两个同族色"，也让 10 色同屏时更好分辨。
   */
  var CAR_COLORS = ['#E13B36', '#F5821F', '#F2C400', '#3FA34D', '#1FB8D6',
                    '#1F56CE', '#B03FDD', '#FF5FA8', '#7A828E', '#7C4A1E'];
  var POLICE_BODY = '#F4F4F4';   // 警车白车身

  /**
   * 4 档难度（生成用，确定性）。size=棋盘边长；carCount=车辆总数（含警车）；
   * optMin/optMax = 最少步数区间（档内收集时按 opt 升序取前 5，保证档内单调；
   * 档间区间也互不重叠，难度单调递增才有量化证明）。
   *
   * 说明：经典 Rush Hour 就是 6×6（12 车）。7×7 的 BFS 可达状态数达千万级，
   * 生成阶段与真机「提示」都会卡死，因此**全部用 6×6**。
   *
   * allFree=true 的档（入门）额外要求「每辆车一开始都能往某个方向滑」——
   * 新手第一印象里不应出现任何"拖不动"的车。代价是可达 opt 更低（实测 6×6
   * 全体可动时 opt 上限约 8，见 tools/_r7_probe.js），正好匹配入门档区间。
   * 进阶及以上放开为 R6（见 isR6）：密度上去了，一定会有互相夹住的车，
   * 那些交给交互反馈（拖动抖动 + 挡路车描红 + 文字说明）。
   */
  var STAGES = [
    { size: 6, minCars: 5,  maxCars: 6,  optMin: 3,  optMax: 7,  allFree: true },
    { size: 6, minCars: 7,  maxCars: 8,  optMin: 8,  optMax: 12 },
    { size: 6, minCars: 9,  maxCars: 10, optMin: 12, optMax: 15 },
    { size: 6, minCars: 11, maxCars: 12, optMin: 14, optMax: 18 }
  ];

  /* ---------------- 车辆 / 棋盘工具 ---------------- */

  /** 车 i 在滑动坐标 p 时占据的格子下标（size×size 一维） */
  function cellsOf(c, p, size) {
    var out = [], k;
    if (c.horiz) {
      for (k = 0; k < c.len; k++) { out.push(c.y * size + (p + k)); }
    } else {
      for (k = 0; k < c.len; k++) { out.push((p + k) * size + c.x); }
    }
    return out;
  }

  /** 整个棋盘的占用布尔数组（含所有车） */
  function occupyFull(pos, board) {
    var size = board.size, n = board.cars.length, occ = new Array(size * size);
    var i, cells;
    for (i = 0; i < size * size; i++) { occ[i] = false; }
    for (i = 0; i < n; i++) {
      cells = cellsOf(board.cars[i], pos[i], size);
      for (var j = 0; j < cells.length; j++) { occ[cells[j]] = true; }
    }
    return occ;
  }

  /* ---------------- BFS 求解器 ---------------- */

  /**
   * 广度优先求"警车驶出右侧出口"的最少连续滑动次数（含出库那一步）。
   *   - 状态 = 每辆车的滑动坐标数组 positions（横车=左端 x，竖车=上端 y）
   *   - 一步  = 任意一辆车沿轴滑到某个合法新位置（中间连续，被挡即停）
   *   - 终态 = 警车（cars[0]）滑到最右合法位（x = size-2），再出库算 1 步
   *   - 返回 { opt: 最少步数(含出库) , first: 从初始局面最优解的第一步 {car,dir} }
   *     opt = Infinity 表示不可解；limit 限制访问状态数（提示路径用，避免 7×7 卡死）。
   */
  /**
   * 广度优先求"警车驶出右侧出口"的最少连续滑动次数（含出库那一步）。
   *   - 状态 = 整数编码的滑动坐标数组（每车坐标用 base=size 进制占一位；size=6 → 6^13 < 2^53，安全整数）
   *   - 占用用 32 位分块的位掩码（low 0~31 / high 32~35），碰撞检测是纯位运算，比"字符串 key + 布尔数组"快一个量级
   *   - 一步  = 一辆车沿轴滑到某合法新位置（连续滑动，被挡即停）
   *   - 终态 = 警车（cars[0]）滑到最右合法位（x = size-2），再出库算 1 步
   *   - 返回 { opt, first }；opt=Infinity 不可解；limit 限制访问状态数（提示路径用，防 7×7 卡死——本作全 6×6 不会触发）
   */
  function bfs(board, startPos, limit) {
    var size = board.size, n = board.cars.length;
    var base = size;
    var maxVisited = limit || 5000000;
    if (startPos[0] === size - 2) { return { opt: 1, first: { car: 0, dir: 1 } }; }

    function encode(pos) { var s = 0; for (var i = 0; i < n; i++) { s = s * base + pos[i]; } return s; }
    function decode(s) { var pos = new Array(n); for (var i = n - 1; i >= 0; i--) { pos[i] = s % base; s = Math.floor(s / base); } return pos; }
    function maskOf(cells) {
      var lo = 0, hi = 0;
      for (var j = 0; j < cells.length; j++) {
        var idx = cells[j];
        if (idx < 32) { lo |= (1 << idx); } else { hi |= (1 << (idx - 32)); }
      }
      return { lo: lo, hi: hi };
    }

    var start = encode(startPos);
    var queue = [start], head = 0;
    var dist = {}, prev = {};
    dist[start] = 0;
    var visited = 0;

    while (head < queue.length) {
      if (++visited > maxVisited) { return { opt: Infinity, first: null }; }
      var curS = queue[head++], d = dist[curS];
      var cur = decode(curS);

      if (cur[0] === size - 2) {
        var k = curS, first = null;
        while (prev[k]) { first = prev[k].mv; k = prev[k].pk; }
        return { opt: d + 1, first: first };
      }

      // 当前占用位图（含所有车），扩展时按"总占用 − 自身占格"判冲突
      var occLo = 0, occHi = 0;
      for (var i = 0; i < n; i++) {
        var cm = maskOf(cellsOf(board.cars[i], cur[i], size));
        occLo |= cm.lo; occHi |= cm.hi;
      }

      for (i = 0; i < n; i++) {
        var c = board.cars[i], len = c.len, hi = size - len;
        var own = maskOf(cellsOf(c, cur[i], size));
        for (var dir = -1; dir <= 1; dir += 2) {
          for (var step = 1; ; step++) {
            var np = cur[i] + dir * step;
            if (np < 0 || np > hi) { break; }
            var nm = maskOf(cellsOf(c, np, size));
            if (((occLo & ~own.lo) & nm.lo) !== 0 || ((occHi & ~own.hi) & nm.hi) !== 0) { break; }
            var np2 = cur.slice(); np2[i] = np;
            var nk = encode(np2);
            if (dist[nk] !== undefined) { continue; }
            dist[nk] = d + 1;
            prev[nk] = { pk: curS, mv: { car: i, dir: dir } };
            queue.push(nk);
          }
        }
      }
    }
    return { opt: Infinity, first: null };
  }

  /** 从初始局面求最少步数 + 第一步（生成/测试用，不限制状态数） */
  function solve(board) {
    var start = board.cars.map(function (c) { return c.horiz ? c.x : c.y; });
    return bfs(board, start, 0);
  }

  /** 从"任意当前局面"求最优解的下一步（提示用，带状态数上限保护） */
  function solveStep(board, positions) {
    return bfs(board, positions, 600000).first;
  }

  /** 带状态数上限的求解（生成/标定时用，避免不可解题跑满状态空间） */
  function solveCap(board, cap) {
    var start = board.cars.map(function (c) { return c.horiz ? c.x : c.y; });
    return bfs(board, start, cap);
  }

  /* ---------------- 数据层合法区间 / R6 校验 ---------------- */

  /**
   * 数据层合法滑动区间（与场景 legalRange 完全同算法，供生成期校验用）。
   * 返回 [min, max]：本车当前坐标 cpos 在「其它车静止」时沿轴可滑到的整数区间。
   * 横竖混合时，障碍车在「被挡轴」上只占 1 格（垂直车在一行只占其所在列 1 格）。
   */
  function legalRangeAt(board, cars, i) {
    var c = cars[i], size = board.size, Lc = c.len;
    var cpos = c.horiz ? c.x : c.y;          // 本车滑动坐标
    var cfix = c.horiz ? c.y : c.x;          // 本车固定的另一轴
    var min = 0, max = size - Lc;
    for (var j = 0; j < cars.length; j++) {
      if (j === i) { continue; }
      var o = cars[j];
      var opos = o.horiz ? o.x : o.y;
      var ofix = o.horiz ? o.y : o.x;
      if (c.horiz) {
        var oInRow = o.horiz ? (ofix === cfix)
                             : (opos <= cfix && cfix <= opos + o.len - 1);
        if (!oInRow) { continue; }
        var oCol = o.horiz ? opos : ofix;
        var oCols = o.horiz ? o.len : 1;
        if (oCol + oCols - 1 < cpos) { min = Math.max(min, oCol + oCols); }
        else if (oCol > cpos + Lc - 1) { max = Math.min(max, oCol - Lc); }
      } else {
        var oInCol = o.horiz ? (opos <= cfix && cfix <= opos + o.len - 1)
                             : (ofix === cfix);
        if (!oInCol) { continue; }
        var oRow = o.horiz ? ofix : opos;
        var oRows = o.horiz ? 1 : o.len;
        if (oRow + oRows - 1 < cpos) { min = Math.max(min, oRow + oRows); }
        else if (oRow > cpos + Lc - 1) { max = Math.min(max, oRow - Lc); }
      }
    }
    return { min: min, max: max };
  }

  /** 初始「完全动不了」的车索引（legalRange.min === max，即一拖不动） */
  function stuckCars(board) {
    var cars = board.cars, out = [];
    for (var i = 0; i < cars.length; i++) {
      var rg = legalRangeAt(board, cars, i);
      if (rg.min === rg.max) { out.push(i); }
    }
    return out;
  }

  /**
   * 可玩性约束（R6 + R7 合并，生成期过滤用）。**禁止两类"拖不动"的车**：
   *
   *  R6 —— 「贴墙被夹」的死车：一辆初始完全动不了的车若其滑动坐标落在墙边
   *        （横车 x===0 或 x===size-Lc；竖车 y===0 或 y===size-Lc），
   *        则它唯一的移动方向是盘内、却被邻车堵死 → 玩家一拖不动就以为坏了。
   *
   *  R7 —— **警车**初始就动不了：玩家上手第一件事一定是拖警车，警车纹丝不动
   *        会直接得出"游戏坏了"的结论（实测原 20 关里 L2/L9/L10 都有这个问题）。
   *
   * 为什么不禁「盘内被夹的非警车」：实测（tools/_r7_probe.js）在 6×6 上要求
   * 「每辆车初始都能动」会让 9 车以上几乎采不到样（6000 次抽样仅 232 次通过，
   * opt 上限掉到 7；11-12 车只剩 8 次、opt ≤ 3），高难度档直接塌掉。
   * 这类车改为**交互反馈**兜底：拖动时车身抖动 + 提示"被挡住了"（见 scenes/rush.js）。
   */
  function isR6(board) {
    var cars = board.cars, size = board.size;
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i], Lc = c.len;
      var rg = legalRangeAt(board, cars, i);
      if (rg.min !== rg.max) { continue; }            // 能动 → 合规
      if (c.police) { return false; }                 // R7：警车不许初始卡死
      var p = c.horiz ? c.x : c.y;
      if (p === 0 || p === size - Lc) { return false; } // R6：贴墙死车
    }
    return true;
  }

  /** 全体车（含警车）初始都能往某个方向滑（入门档的额外要求） */
  function isAllFree(board) {
    for (var i = 0; i < board.cars.length; i++) {
      var rg = legalRangeAt(board, board.cars, i);
      if (rg.min === rg.max) { return false; }
    }
    return true;
  }

  /** 生成期的可玩性过滤：allFree 档最严，其余档只需满足 isR6 */
  function passPlayable(board, allFree) {
    return allFree ? isAllFree(board) : isR6(board);
  }

  /* ---------------- 程序化生成 ---------------- */

  /** 生成时求解用的状态数上限：够覆盖所有可解 6×6 题，又能把"不可解/超难"题的成本封顶 */
  var GEN_CAP = 400000;

  /**
   * 对随机起点做局部扰动：随机挑一辆非警车，沿轴 ±1 或 ±2 滑动到合法且不重叠的位置。
   * 返回新 board（深拷贝 cars），非法则返回 null。
   */
  function perturb(board, rng) {
    var n = board.cars.length;
    var ci = 1 + Math.floor(rng() * (n - 1));
    var c = board.cars[ci];
    var hi = board.size - c.len;
    var curP = c.horiz ? c.x : c.y;
    var step = (rng() < 0.5 ? -1 : 1) * (rng() < 0.5 ? 1 : 2);
    var np = curP + step;
    if (np < 0 || np > hi) { return null; }
    var occ = new Array(board.size * board.size);
    for (var i = 0; i < occ.length; i++) { occ[i] = false; }
    for (i = 0; i < n; i++) {
      if (i === ci) { continue; }
      var cells = cellsOf(board.cars[i], board.cars[i].horiz ? board.cars[i].x : board.cars[i].y, board.size);
      for (var j = 0; j < cells.length; j++) { occ[cells[j]] = true; }
    }
    var moved = { id: c.id, horiz: c.horiz, len: c.len, ci: c.ci, police: c.police };
    if (c.horiz) { moved.x = np; moved.y = c.y; } else { moved.x = c.x; moved.y = np; }
    var mc = cellsOf(moved, np, board.size), bad = false;
    for (j = 0; j < mc.length; j++) { if (occ[mc[j]]) { bad = true; break; } }
    if (bad) { return null; }
    var cars = board.cars.map(function (k) {
      return { id: k.id, horiz: k.horiz, len: k.len, x: k.x, y: k.y, ci: k.ci, police: k.police };
    });
    cars[ci] = moved;
    return { size: board.size, exitRow: board.exitRow, cars: cars };
  }

  /** 棋盘布局签名（用于去重） */
  function sigOf(board) {
    return board.cars.map(function (c) {
      return (c.horiz ? 1 : 0) + ',' + c.len + ',' + c.x + ',' + c.y + ',' + (c.police ? -1 : c.ci);
    }).join(';');
  }

  /**
   * 构造法生成：从「已通关」状态（警车在右侧出口）出发，随机走 k 步合法滑动打乱，
   * 逆序即为一条可行解 → **必定可解**，且 opt ≤ k。每条候选只需 1 次 BFS 取精确 opt。
   * 比"随机撒车+爬山"快一个量级，且能稳定产出高 opt 局。
   */
  function genScramble(size, exitRow, carCount, k, rng) {
    var occ = new Array(size * size);
    for (var z = 0; z < occ.length; z++) { occ[z] = false; }
    function place(c) {
      var cells = cellsOf(c, c.horiz ? c.x : c.y, size);
      for (var j = 0; j < cells.length; j++) { occ[cells[j]] = true; }
    }
    var cars = [];
    // 目标车（警车）放在出口位（最右合法 x = size-2），其它车随机撒
    var police = { id: 0, horiz: true, len: 2, x: size - 2, y: exitRow, ci: -1, police: true };
    place(police); cars.push(police);
    var attempts = 0;
    while (cars.length < carCount && attempts < 800) {
      attempts++;
      var len = rng() < 0.5 ? 2 : 3, horiz = rng() < 0.5;
      var maxC = size - len;
      var p = Math.floor(rng() * (maxC + 1)), fixed = Math.floor(rng() * size);
      var x = horiz ? p : fixed, y = horiz ? fixed : p;
      if (x < 0 || x + (horiz ? len : 1) > size) { continue; }
      if (y < 0 || y + (horiz ? 1 : len) > size) { continue; }
      var c = { id: cars.length, horiz: horiz, len: len, x: x, y: y,
                ci: Math.floor(rng() * CAR_COLORS.length), police: false };
      var cells = cellsOf(c, horiz ? x : y, size), bad = false;
      for (var q = 0; q < cells.length; q++) { if (occ[cells[q]]) { bad = true; break; } }
      if (bad) { continue; }
      place(c); cars.push(c);
    }
    if (cars.length < carCount) { return null; }
    // 随机走 k 步合法滑动打乱（逆序即解）
    for (var step = 0; step < k; step++) {
      var ci = Math.floor(rng() * cars.length);
      var cc = cars[ci], maxP = size - cc.len, curP = cc.horiz ? cc.x : cc.y;
      var dir = rng() < 0.5 ? -1 : 1;
      var dist = 1 + Math.floor(rng() * (Math.min(3, maxP) + 1));
      var np = curP + dir * dist;
      if (np < 0 || np > maxP) { continue; }
      var oldCells = cellsOf(cc, curP, size);
      for (var o = 0; o < oldCells.length; o++) { occ[oldCells[o]] = false; }
      var newCells = cellsOf(cc, np, size), bad2 = false;
      for (var m = 0; m < newCells.length; m++) { if (occ[newCells[m]]) { bad2 = true; break; } }
      if (bad2) { for (var o2 = 0; o2 < oldCells.length; o2++) { occ[oldCells[o2]] = true; } continue; }
      if (cc.horiz) { cc.x = np; } else { cc.y = np; }
      for (var m2 = 0; m2 < newCells.length; m2++) { occ[newCells[m2]] = true; }
    }
    return { size: size, exitRow: exitRow, cars: cars };
  }

  /**
   * 撒一辆车到 (size×size) 棋盘：目标车（警车）固定 2 格横、放在 exitRow 行、
   * 初始 x∈[1, size-3]（保证未通关）。其余车随机 len{2,3} × 横/竖 × 位置 × 颜色，
   * 校验不重叠、不越界；撒够 carCount 辆返回 board，过于拥挤撒不出则返回 null。
   */
  function generateOne(size, exitRow, carCount, rng) {
    var target = {
      id: 0, horiz: true, len: 2,
      x: 1 + Math.floor(rng() * (size - 3)), y: exitRow,
      police: true, ci: -1
    };
    var cars = [target];
    var occ = new Array(size * size);
    var i;
    for (i = 0; i < size * size; i++) { occ[i] = false; }
    var tc = cellsOf(target, target.x, size);
    for (i = 0; i < tc.length; i++) { occ[tc[i]] = true; }

    var attempts = 0;
    while (cars.length < carCount && attempts < 600) {
      attempts++;
      var len = rng() < 0.5 ? 2 : 3;
      var horiz = rng() < 0.5;
      var maxC = size - len;
      var p = Math.floor(rng() * (maxC + 1));               // 滑动坐标
      var fixed = Math.floor(rng() * size);                 // 另一轴坐标
      var x = horiz ? p : fixed, y = horiz ? fixed : p;
      if (x < 0 || x + (horiz ? len : 1) > size) { continue; }
      if (y < 0 || y + (horiz ? 1 : len) > size) { continue; }
      var c = { id: cars.length, horiz: horiz, len: len, x: x, y: y };
      var cells = cellsOf(c, p, size), bad = false;
      for (i = 0; i < cells.length; i++) { if (occ[cells[i]]) { bad = true; break; } }
      if (bad) { continue; }
      c.ci = Math.floor(rng() * CAR_COLORS.length);
      for (i = 0; i < cells.length; i++) { occ[cells[i]] = true; }
      cars.push(c);
    }
    if (cars.length < carCount) { return null; }
    return { size: size, exitRow: exitRow, cars: cars };
  }

  /**
   * 确定性生成全部 20 关（4 档 × 5 关），带可玩性约束（见 isR6 / isAllFree）。
   * 方法：随机撒车(generateOne) 起手，再用「局部爬山(perturb 只接受 opt 升高)」把 opt
   * 推高 —— 纯随机极难采到高 opt 局，爬山是可靠拿到高 opt 的手段。全程按布局签名去重
   * 收集进 bucket[opt]，再逐档挑「最接近目标 opt」的未用局，保证 20 关互异、档内单调。
   *
   * ⚠️ 可玩性约束实测把 6×6 的 opt 上限压到约 15（车多了必然互相夹住）：高密度局要凑出
   * 高 opt 又不出现任何"拖不动"的车极难。故档间区间按可达范围划分（专家封顶 ~15 步），
   * 并接受"进阶以上允许盘内互夹的非警车"，用交互反馈兜底（抖动 + 挡路车描红 + 文案）。
   */
  var SLOT_TARGETS = [
    [3, 4, 5, 6, 7],          // 入门：opt 3~7（该档 allFree，车型稀疏，均可达）
    [8, 9, 10, 11, 12],       // 进阶：opt 8~12
    [12, 13, 14, 14, 14],     // 困难：opt 12~14
    [15, 15, 15, 15, 15]      // 专家：opt 15（6×6 + 约束下可达上限附近）
  ];

  /** 局部扰动爬山收集：从 start 沿「只升 opt」方向游走，途中通过可玩性过滤且
   * opt∈[optMin,optMax] 的局经 add() 按布局签名去重进 bucket（跨档全局去重，保证 20 关不重复）。 */
  function walkCollect(start, steps, rng, optMin, optMax, add, allFree) {
    var r = solveCap(start, GEN_CAP);
    if (r.opt === Infinity) { return; }
    var cur = start, curOpt = r.opt;
    for (var s = 0; s < steps; s++) {
      var nb = perturb(cur, rng);
      if (!nb) { continue; }
      if (!passPlayable(nb, allFree)) { continue; }
      var nr = solveCap(nb, GEN_CAP);
      if (nr.opt === Infinity) { continue; }
      if (nr.opt > curOpt || rng() < 0.12) {
        cur = nb; curOpt = nr.opt;
        if (curOpt >= optMin && curOpt <= optMax) { add(nb, curOpt); }
      }
    }
  }

  function buildAll() {
    var seen = {}, bucket = {};                 // bucket[opt] = [board]（按布局去重）
    function add(b, opt) {
      var sig = sigOf(b);
      if (seen[sig]) { return; }
      seen[sig] = true;
      (bucket[opt] || (bucket[opt] = [])).push(b);
    }
    var seedBase = 20260601;
    for (var s = 0; s < STAGES.length; s++) {
      var st = STAGES[s];
      var tries = st.optMin >= 12 ? 30000 : 10000;   // 高密度档多采样（R6 通过率低）
      // 1) 随机撒车大池（R6 过滤）
      var pool = [];
      for (var i = 0; i < tries; i++) {
        var rng0 = U.mulberry32((seedBase + s * 777 + i * 2654435761) % 2147483647);
        var exitRow = Math.floor(rng0() * 6);
        var carCount = st.minCars + Math.floor(rng0() * (st.maxCars - st.minCars + 1));
        var b = generateOne(6, exitRow, carCount, rng0);
        if (!b) { continue; }
        if (!passPlayable(b, st.allFree)) { continue; }
        var r0 = solveCap(b, GEN_CAP);
        if (r0.opt === Infinity) { continue; }
        pool.push({ board: b, opt: r0.opt });
      }
      // 2) 池里所有局进 bucket
      pool.forEach(function (p) { add(p.board, p.opt); });
      // 3) 爬山收集（从池里 opt 最高的起点游走，沿途 R6 有效局全部进 bucket）
      pool.sort(function (a, b) { return b.opt - a.opt; });
      for (var w = 0; w < 25; w++) {
        if (!pool.length) { break; }
        var start = pool[w % pool.length].board;
        var wrng = U.mulberry32((seedBase + s * 50000 + w * 131) % 2147483647);
        walkCollect(start, 1500, wrng, 3, 22, add, st.allFree);
      }
    }
    // 4) 逐档挑「最接近的未用」局（保证互异 + 档内单调）。
    //    关键：从高难度档(专家)向低难度档(入门)逆序挑，专家先挑走最高 opt 的局，
    //    这样即使 R6 下高 opt 局稀缺，档间也天然单调不降（专家.min ≥ 困难.max …）。
    var chosenByTier = [[], [], [], []], used = {};
    for (var t = SLOT_TARGETS.length - 1; t >= 0; t--) {
      var block = SLOT_TARGETS[t], chosen = [];
      for (var q = 0; q < block.length; q++) {
        var tg = block[q], best = null, bestD = 1e9;
        for (var o = 3; o <= 22; o++) {
          var arr = bucket[o]; if (!arr) { continue; }
          for (var j = 0; j < arr.length; j++) {
            var sg = sigOf(arr[j]);
            if (used[sg]) { continue; }
            var d = Math.abs(o - tg);
            if (d < bestD) { bestD = d; best = arr[j]; }
          }
        }
        if (!best) {   // 兜底：任意未用局
          for (var o2 = 3; o2 <= 22 && !best; o2++) {
            var a2 = bucket[o2]; if (!a2) { continue; }
            for (var j2 = 0; j2 < a2.length; j2++) {
              if (!used[sigOf(a2[j2])]) { best = a2[j2]; break; }
            }
          }
        }
        if (best) {
          used[sigOf(best)] = true;
          var rr = bfs(best, best.cars.map(function (c) { return c.horiz ? c.x : c.y; }), 0);
          best.opt = rr.opt; best.first = rr.first;
          chosen.push(best);
        }
      }
      chosen.sort(function (a, b) { return a.opt - b.opt; });
      chosenByTier[t] = chosen;
    }
    var out = [];
    for (var t2 = 0; t2 < chosenByTier.length; t2++) {
      for (var ci = 0; ci < chosenByTier[t2].length; ci++) { out.push(chosenByTier[t2][ci]); }
    }
    return out;
  }

  /* ---------------- 关卡表（生成结果内联；确定，真机不重算） ---------------- */

  /** 紧凑序列化：每关 { s, e, o, f:[car,...] }；car = [horiz(0/1), len, x, y, ci(0-9, -1=警车)] */
  var LEVELS = [
    {"s":6,"e":5,"o":3,"f":[[1,2,1,5,-1],[0,3,2,0,7],[0,2,4,4,0],[0,2,5,3,1],[1,2,3,1,7]]},
    {"s":6,"e":1,"o":4,"f":[[1,2,3,1,-1],[1,3,0,4,3],[0,3,5,0,5],[1,2,4,4,5],[1,3,1,0,6]]},
    {"s":6,"e":4,"o":5,"f":[[1,2,1,4,-1],[1,3,3,0,0],[0,3,4,3,4],[1,2,3,1,3],[0,3,0,3,6],[0,3,5,3,0]]},
    {"s":6,"e":3,"o":6,"f":[[1,2,1,3,-1],[0,2,0,0,3],[0,3,4,1,6],[1,3,3,0,7],[1,3,2,5,7],[0,3,3,1,5]]},
    {"s":6,"e":4,"o":7,"f":[[1,2,1,4,-1],[0,3,4,3,8],[1,2,3,0,5],[1,2,0,5,8],[1,2,3,1,5],[0,3,2,1,8]]},
    {"s":6,"e":2,"o":8,"f":[[1,2,1,2,-1],[1,3,0,0,4],[0,3,4,1,7],[0,2,5,2,3],[1,3,3,4,7],[0,2,0,3,9],[1,2,3,5,4],[0,2,1,4,6]]},
    {"s":6,"e":4,"o":9,"f":[[1,2,1,4,-1],[0,2,5,3,7],[1,2,1,3,0],[0,3,4,3,0],[0,2,3,4,6],[1,3,3,1,2],[0,2,1,0,2]]},
    {"s":6,"e":4,"o":10,"f":[[1,2,1,4,-1],[0,2,5,2,7],[1,2,1,3,0],[0,3,4,3,0],[0,2,3,2,6],[1,3,3,1,2],[0,2,1,1,2]]},
    {"s":6,"e":4,"o":11,"f":[[1,2,2,4,-1],[1,3,2,0,5],[0,2,0,0,7],[1,2,0,5,6],[0,2,4,3,9],[0,3,2,1,1],[0,2,5,3,9],[0,3,1,0,8],[1,2,3,2,9],[1,2,4,5,1]]},
    {"s":6,"e":4,"o":12,"f":[[1,2,2,4,-1],[1,3,2,0,5],[0,2,0,3,7],[1,2,0,5,6],[0,2,4,3,9],[0,3,2,1,1],[0,2,5,3,9],[0,3,1,0,8],[1,2,3,2,9],[1,2,4,5,1]]},
    {"s":6,"e":2,"o":12,"f":[[1,2,2,2,-1],[0,2,5,4,3],[0,2,5,0,2],[0,3,0,3,5],[1,2,3,4,3],[0,2,2,3,4],[0,2,1,0,3],[1,3,1,5,8],[0,3,4,1,2],[1,3,2,0,4]]},
    {"s":6,"e":2,"o":13,"f":[[1,2,2,2,-1],[0,2,5,4,3],[0,2,5,1,2],[0,3,0,1,5],[1,2,3,4,3],[0,2,2,3,4],[0,2,1,0,3],[1,3,0,5,8],[0,3,4,1,2],[1,3,2,0,4]]},
    {"s":6,"e":2,"o":14,"f":[[1,2,2,2,-1],[0,2,5,4,3],[0,2,5,0,2],[0,3,0,1,5],[1,2,3,4,3],[0,2,2,3,4],[0,2,1,0,3],[1,3,0,5,8],[0,3,4,1,2],[1,3,2,0,4]]},
    {"s":6,"e":2,"o":14,"f":[[1,2,2,2,-1],[0,2,5,4,3],[0,2,5,0,2],[0,3,0,1,5],[1,2,3,4,3],[0,2,2,3,4],[0,2,1,0,3],[1,3,2,5,8],[0,3,4,1,2],[1,3,2,0,4]]},
    {"s":6,"e":2,"o":14,"f":[[1,2,2,2,-1],[0,2,5,4,3],[0,2,5,0,2],[0,3,0,2,5],[1,2,3,4,3],[0,2,2,3,4],[0,2,1,0,3],[1,3,2,5,8],[0,3,4,1,2],[1,3,2,0,4]]},
    {"s":6,"e":4,"o":15,"f":[[1,2,1,4,-1],[1,2,3,0,5],[1,3,2,5,1],[0,3,1,1,4],[1,2,2,1,4],[0,3,4,2,4],[0,3,0,1,4],[0,2,3,3,7],[1,2,1,0,2],[0,3,5,0,4],[1,2,2,2,4]]},
    {"s":6,"e":4,"o":15,"f":[[1,2,1,4,-1],[1,2,3,0,5],[1,3,3,5,1],[0,3,1,1,4],[1,2,2,1,4],[0,3,4,2,4],[0,3,0,1,4],[0,2,3,3,7],[1,2,1,0,2],[0,3,5,0,4],[1,2,2,2,4]]},
    {"s":6,"e":4,"o":15,"f":[[1,2,1,4,-1],[1,2,3,0,5],[1,3,3,5,1],[0,3,1,1,4],[1,2,2,1,4],[0,3,4,2,4],[0,3,0,0,4],[0,2,3,3,7],[1,2,1,0,2],[0,3,5,0,4],[1,2,2,2,4]]},
    {"s":6,"e":4,"o":15,"f":[[1,2,1,4,-1],[1,2,3,0,5],[1,3,2,5,1],[0,3,1,1,4],[1,2,2,1,4],[0,3,4,2,4],[0,3,0,0,4],[0,2,3,3,7],[1,2,1,0,2],[0,3,5,0,4],[1,2,2,2,4]]},
    {"s":6,"e":4,"o":15,"f":[[1,2,1,4,-1],[1,2,3,0,5],[1,3,2,5,1],[0,3,1,1,4],[1,2,2,1,4],[0,3,4,2,4],[0,3,0,0,4],[0,2,3,3,7],[1,2,1,0,2],[0,3,5,1,4],[1,2,2,2,4]]},
  ];

  function serialize(b) {
    return {
      s: b.size, e: b.exitRow, o: b.opt,
      f: b.cars.map(function (c) { return [c.horiz ? 1 : 0, c.len, c.x, c.y, c.police ? -1 : c.ci]; })
    };
  }
  function deserialize(L) {
    var cars = L.f.map(function (a, idx) {
      return {
        id: idx, horiz: a[0] === 1, len: a[1], x: a[2], y: a[3],
        ci: a[4], police: a[4] === -1
      };
    });
    return { size: L.s, exitRow: L.e, opt: L.o, cars: cars };
  }

  function configOf(n) {
    var i = Math.max(1, Math.min(LEVELS.length, Math.round(n || 1)));
    return LEVELS[i - 1];
  }

  /** 构造第 n 关的完整棋盘对象（确定性，从内联 LEVELS 取） */
  function build(n, daily) {
    var L = configOf(n);
    var board = deserialize(L);
    return {
      level: Math.max(1, Math.min(LEVELS.length, Math.round(n || 1))),
      size: board.size,
      exitRow: board.exitRow,
      opt: board.opt,
      cars: board.cars,
      daily: !!daily
    };
  }

  function buildDaily(date) {
    var d = date || new Date();
    var rng = U.mulberry32(U.seedFromDate(d) % 2147483647);
    var lv = 1 + Math.floor(rng() * LEVELS.length);
    return build(lv, true);
  }

  /* ---------------- 动态星级（由本关 opt 推导，单一真源） ---------------- */

  /**
   * 星级：used = 玩家实际「连续滑动」步数（出库那一步由动画自动完成，不计入玩家步数）。
   * 数据层 opt 含"驶出"那一步，故玩家视角的最优滑动数 = opt - 1：
   * 玩家拖到最优即 opt-1 步 → 3★；多滑 1 步以内（含冗余）仍 2★；再多 1★。
   */
  function starsFor(n, used) {
    var best = configOf(n).o - 1;
    if (used <= best) { return 3; }
    if (used <= Math.ceil(best * 1.4)) { return 2; }
    return 1;
  }

  BF.RushGen = {
    CAR_COLORS: CAR_COLORS,
    POLICE_BODY: POLICE_BODY,
    STAGES: STAGES,
    solve: solve,
    solveStep: solveStep,
    solveCap: solveCap,
    generateOne: generateOne,
    genScramble: genScramble,
    buildAll: buildAll,
    serialize: serialize,
    deserialize: deserialize,
    build: build,
    buildDaily: buildDaily,
    configOf: configOf,
    isR6: isR6,
    isAllFree: isAllFree,
    stuckCars: stuckCars,
    legalRangeAt: legalRangeAt,
    starsFor: starsFor,
    typeOf: function (c) {
      if (c.police) { return 'police'; }
      if (c.len === 3) { return c.horiz ? 'bus' : 'truck'; }
      return 'car';
    },
    colorOf: function (c) { return c.police ? POLICE_BODY : CAR_COLORS[c.ci]; },
    LEVELS: LEVELS,
    TOTAL: LEVELS.length
  };

  /* ---------------- 注册进合集 ---------------- */
  var games = BF.games || (BF.games = {});
  games.rush = {
    id: 'rush',
    // 「玩法说明」弹框（BF.RuleTip）：每次进这款游戏的第一个关卡时弹一次，
    // 玩家勾选「不再提示」后写入 Save.extra(id,'noRule')，之后不再弹。
    rules: {
      sub: '6×6 停车场 · 滑动车辆',
      lines: [
        '车辆只能沿自身方向滑动，不能转弯',
        '把警车滑到右侧出口驶出即过关',
        '一次连续滑动算 1 步，步数越少星级越高',
      ]
    },
    title: '移车出库',
    sub: '滑动车辆 · 让警车驶出车库',
    skin: 'rush',
    scene: 'rush',        // 独立玩法场景，关卡页据此路由
    TOTAL: LEVELS.length,
    // 难度维度（4 档）：关卡页顶部画一排「难度」快捷入口，点一下进该档第一关。
    // 因为本作全 6×6，难度不是「网格尺寸」而是「最少步数档」，故用档名作值。
    difficulties: ['入门', '进阶', '困难', '专家'],
    firstLevelOfSize: function (name) {
      var map = { '入门': 1, '进阶': 6, '困难': 11, '专家': 16 };
      return map[name] || 1;
    },
    // 顶部难度 chip 的标签：档名 + 该档最少步数区间（运行时从实际 LEVELS 推导，与实际一致）
    chipLabel: function (name) {
      var idx = ['入门', '进阶', '困难', '专家'].indexOf(name);
      if (idx < 0) { return name; }
      var lo = idx === 0 ? 1 : idx * 5, hi = lo + 4, mn = 999, mx = 0;
      for (var n = lo; n <= hi; n++) {
        var o = (BF.RushGen.configOf(n) || {}).o || 0;
        if (o) { if (o < mn) { mn = o; } if (o > mx) { mx = o; } }
      }
      return (mn <= mx) ? (name + ' · ' + mn + '-' + mx + ' 步') : name;
    },
    // 难度自选首屏（BF.DiffPick）档卡副标题：关卡范围 + 该档最优连续滑动区间。
    // ⚠️ 展示口径必须是「玩家滑动数」= opt - 1（opt 含警车自动驶出那一步），
    //    否则会出现「按提示完美通关却比最优少 1 步」的 off-by-one。
    pickInfo: function (idx, rg) {
      var mn = 999, mx = 0;
      for (var n = rg.first; n <= rg.last; n++) {
        var o = (BF.RushGen.configOf(n) || {}).o || 0;
        if (o) { if (o < mn) { mn = o; } if (o > mx) { mx = o; } }
      }
      return {
        meta: '第 ' + rg.first + '-' + rg.last + ' 关 · 最少 ' +
          (mn <= mx ? (mn - 1) + '-' + (mx - 1) : '?') + ' 步'
      };
    },
    build: function (n) { return build(n, false); },
    buildDaily: buildDaily
  };
})();
