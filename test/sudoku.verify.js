/**
 * sudoku.verify.js —— 九宫格数独「数据层」回归测试（node test/sudoku.verify.js）
 *
 * 覆盖（与 tools/_verify_sudoku_logic.js 互补，那份跑场景交互）：
 *   - 求解器自洽：完整解合法；造出来的题解唯一（countSolutions=1）
 *   - 40 关配置合法：给定数与解一致、给定数不重复冲突、挖空数精确等于本档目标、
 *     档位划分正确（4 档 × 10 关连续区间）
 *   - 解的合法性：每行 / 每列 / 每宫都是 1-9 的一个排列
 *   - 难度承诺：档间挖空数严格递增（36 < 45 < 51 < 56）
 *   - 确定性：同关两次 build 逐字段一致
 *   - 越界保护：build(0)/build(999) 被夹到合法区间
 *   - 每日挑战：可解 + 解唯一 + 挖空数 = 进阶档 + daily 标记
 *   - tierLevels：四档并集恰为 1..40、两两不交、每档 10 关
 *   - starsFor / thresholdsFor：阈值档间严格递增、边界值正确
 *   - 注册表字段：scene/TOTAL/difficulties/chipLabel/pickInfo
 * 不依赖画布，纯 node 跑数据层。失败 process.exit(1)。
 */
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'js/core/ns.js'));
require(path.join(root, 'js/core/palette.js'));
require(path.join(root, 'js/core/draw.js'));
require(path.join(root, 'js/core/save.js'));
require(path.join(root, 'js/game/sudoku.js'));

var G = BF.SudokuGen;
var meta = BF.games.sudoku;
var CELLS = G.CELLS;

var fail = 0;
function ok(cond, msg) { if (!cond) { console.log('  ✗ ' + msg); fail++; } }

/** 一个 81 数组是否合法完整解（行/列/宫各 1-9） */
function isCompleteValid(g) {
  var want = 0x1FF;
  function bits(list) {
    var m = 0;
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (v < 1 || v > 9) { return -1; }
      var b = 1 << (v - 1);
      if (m & b) { return -1; }   // 重复
      m |= b;
    }
    return m;
  }
  var i, r, c, list;
  for (r = 0; r < 9; r++) {
    list = [];
    for (c = 0; c < 9; c++) { list.push(g[r * 9 + c]); }
    if (bits(list) !== want) { return false; }
  }
  for (c = 0; c < 9; c++) {
    list = [];
    for (r = 0; r < 9; r++) { list.push(g[r * 9 + c]); }
    if (bits(list) !== want) { return false; }
  }
  for (var br = 0; br < 3; br++) {
    for (var bc = 0; bc < 3; bc++) {
      list = [];
      for (r = 0; r < 3; r++) {
        for (c = 0; c < 3; c++) { list.push(g[(br * 3 + r) * 9 + bc * 3 + c]); }
      }
      if (bits(list) !== want) { return false; }
    }
  }
  return true;
}

function blanksOf(g) {
  var n = 0;
  for (var i = 0; i < CELLS; i++) { if (!g[i]) { n++; } }
  return n;
}

/* ---------- 1. 注册表 ---------- */
(function () {
  ok(!!meta, 'BF.games.sudoku 未注册');
  ok(meta.scene === 'sudoku', 'scene 应为 sudoku，实际 ' + meta.scene);
  ok(meta.TOTAL === 40, 'TOTAL 应为 40，实际 ' + meta.TOTAL);
  ok(JSON.stringify(meta.difficulties) === JSON.stringify(['入门', '进阶', '困难', '专家']),
    'difficulties 应为 4 档中文档名');
  ok(typeof meta.build === 'function' && typeof meta.buildDaily === 'function',
    'build / buildDaily 应为函数');
})();

/* ---------- 2. 关卡表 ---------- */
(function () {
  ok(G.LEVELS.length === 40, '内联关卡表应为 40 关，实际 ' + G.LEVELS.length);
  var prevBlanks = -1;
  for (var n = 1; n <= 40; n++) {
    var t = G.tierOf(n);
    var pz = meta.build(n);
    // 档位：4 档 × 10 关连续区间
    ok(t === Math.floor((n - 1) / 10), '第 ' + n + ' 关档位错：' + t);
    // 挖空数 = 难度承诺，必须精确
    var want = G.TIER_BLANKS[t];
    ok(blanksOf(pz.given) === want,
      '第 ' + n + ' 关（' + G.TIER_NAMES[t] + '）应挖 ' + want + ' 空，实际 ' + blanksOf(pz.given));
    ok(pz.blanks === want, '第 ' + n + ' 关记录的 blanks 字段不一致');
    // 给定数与解一致 + 给定格本身无冲突
    for (var i = 0; i < CELLS; i++) {
      if (pz.given[i]) {
        ok(pz.given[i] === pz.solution[i], '第 ' + n + ' 关第 ' + i + ' 格给定数与解不一致');
      }
    }
    // 给定格不违反规则（同行列宫无重复给定）
    ok(G.countSolutions(pz.given, 2) >= 1, '第 ' + n + ' 关给定数自相矛盾（无解）');
    // 解唯一（宽松模式的底气：填对即唯一答案）
    ok(G.countSolutions(pz.given, 2) === 1, '第 ' + n + ' 关应只有唯一解');
    // 解合法
    ok(isCompleteValid(pz.solution), '第 ' + n + ' 关的解不是合法完整盘');
    // 档间挖空数严格递增
    if (n === 1 || n === 11 || n === 21 || n === 31) {
      ok(want > prevBlanks, '档间挖空数应严格递增：' + prevBlanks + ' → ' + want);
      prevBlanks = want;
    }
  }
})();

/* ---------- 3. 确定性 / 越界 ---------- */
(function () {
  var a = meta.build(17), b = meta.build(17);
  ok(JSON.stringify(a) === JSON.stringify(b), '同关两次 build 应逐字段一致');
  var lo = meta.build(0), hi = meta.build(999);
  ok(lo.level === 1, 'build(0) 应夹到第 1 关');
  ok(hi.level === 40, 'build(999) 应夹到第 40 关');
})();

/* ---------- 4. 每日挑战 ---------- */
(function () {
  var d1 = meta.buildDaily(), d2 = meta.buildDaily();
  ok(!!d1.daily, '每日题应带 daily 标记');
  ok(d1.blanks === G.DAILY_BLANKS, '每日题挖空数应为 ' + G.DAILY_BLANKS + '，实际 ' + d1.blanks);
  ok(G.countSolutions(d1.given, 2) === 1, '每日题应唯一解');
  ok(isCompleteValid(d1.solution), '每日题的解应合法');
  ok(JSON.stringify(d1) === JSON.stringify(d2), '同日两次 buildDaily 应一致');
})();

/* ---------- 5. tierLevels 划分 ---------- */
(function () {
  var seen = {}, union = [];
  G.TIER_NAMES.forEach(function (nm) {
    var lv = meta.tierLevels(nm);
    ok(lv.length === 10, nm + ' 档应有 10 关，实际 ' + lv.length);
    ok(meta.firstLevelOfSize(nm) === lv[0], nm + ' 档 firstLevelOfSize 不对');
    lv.forEach(function (n) {
      ok(!seen[n], '第 ' + n + ' 关被多个档重复包含');
      seen[n] = true;
      union.push(n);
    });
  });
  union.sort(function (a, b) { return a - b; });
  ok(union.length === 40 && union[0] === 1 && union[39] === 40,
    '四档并集应恰为 1..40');
})();

/* ---------- 6. 星级 ---------- */
(function () {
  var prev = null;
  for (var t = 0; t < 4; t++) {
    var th = G.thresholdsFor(t);
    ok(th.t3 > 0 && th.t2 > th.t3, '第 ' + t + ' 档阈值应满足 0 < t3 < t2');
    if (prev) {
      ok(th.t3 > prev.t3 && th.t2 > prev.t2, '阈值应随档位递增');
    }
    prev = th;
    ok(G.starsFor(t, th.t3) === 3, 't3 整应给 3★');
    ok(G.starsFor(t, th.t3 + 1) === 2, '刚超 t3 应给 2★');
    ok(G.starsFor(t, th.t2 + 1) === 1, '刚超 t2 应给 1★');
    ok(G.starsFor(t, 0) === 3, '0 毫秒应给 3★');
  }
  // 越界档位不炸
  ok(G.starsFor(-1, 0) === 3 && G.starsFor(9, 0) === 3, '越界档位应被夹住');
})();

/* ---------- 7. 文案钩子 ---------- */
(function () {
  ok(meta.chipLabel('困难') === '困难 · 51 空', 'chipLabel 格式不对：' + meta.chipLabel('困难'));
  var info = meta.pickInfo(0, { first: 1, last: 10 });
  ok(info.meta === '每局挖 36 空 · 第 1-10 关', 'pickInfo 格式不对：' + info.meta);
})();

/* ---------- 8. 求解器反向自洽（不能是恒返回 1 的假求解器） ---------- */
(function () {
  var pz = meta.build(40);
  // a) 完整解喂回去 → 恰好 1 个解
  ok(G.countSolutions(pz.solution.slice(), 2) === 1, '把完整解喂回求解器应数出 1 个解');
  // b) 只挖一个格 → 仍被所在行列强制，唯一
  var one = pz.solution.slice();
  for (var i = 0; i < CELLS; i++) { if (!pz.given[i]) { one[i] = 0; break; } }
  ok(G.countSolutions(one, 2) === 1, '只挖一格应仍唯一解');
  // c) 给定数自相矛盾（同一行两个 1）→ 0 个解
  var bad = pz.solution.slice();
  bad[0] = 1; bad[1] = 1;
  ok(G.countSolutions(bad, 2) === 0, '同一行两个 1 应判无解');
  // d) 空盘 → 解数直接撞 cap（证明求解器数得出 >1，不是恒真）
  ok(G.countSolutions(new Array(CELLS).fill(0), 5) === 5, '空盘解数应撞到 cap=5');
})();

if (fail) {
  console.log('❌ 九宫格数独数据层：' + fail + ' 处不合规');
  process.exit(1);
}
console.log('✅ 九宫格数独数据层：40 关全部合规（唯一解/挖空数/档位/确定性/每日/星级/求解器自洽）');
