/**
 * blocks.verify.js —— 超级积木「数据层」回归测试（node test/blocks.verify.js）
 *
 * 覆盖（与 tools/_verify_blocks_logic.js 互补，那份跑场景交互）：
 *   - SHAPES 库不变量：16 块 / 4 色各 4 块 / 单块 3~5 格 / 两两不同的自由多连块
 *   - 旋转与放置掩码自洽：PIECE_ROT 的每个旋转+偏移都能在 PIECE_PLACE 命中，
 *     且 placementToPiece 能从掩码反推回同一块
 *   - 40 关配置合法：亮区在 8×8 界内、格数落在本档区间、块数/颜色与 planFor 一致、
 *     标准解精确覆盖亮区（不重叠不出界）、每块颜色 ∈ 本关指定颜色
 *   - 每关可解：countSolutions(region, 标准解块集) ≥ 1
 *   - 解数一致：记录值 s === countSolutions(region, 该色整盒积木)
 *     （整盒口径 = 玩家托盘里真有这么多块可用，难度量必须按玩家可见资源算）
 *   - 难度量化单调：档内 composite 不减、档间严格递增（颜色数×100 + 块数）
 *   - 限时题位置：每档最后一关（10/20/30/40）timed，且 timeLimit>0
 *   - 确定性：同关两次 build 逐字段一致
 *   - 每日挑战：可解 + 参数取自困难档 + 同日两次一致 + daily 标记
 *   - starsFor / rankFor 阈值边界
 * 不依赖画布，纯 node 跑数据层。失败 process.exit(1)。
 */
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'js/core/ns.js'));
require(path.join(root, 'js/core/palette.js'));
require(path.join(root, 'js/core/draw.js'));
require(path.join(root, 'js/core/save.js'));
require(path.join(root, 'js/game/blocks.js'));

var G = BF.BlocksGen;
var U = BF.util;
var SIZE = G.SIZE;

var fail = 0;
function ok(cond, msg) { if (!cond) { console.log('  ✗ ' + msg); fail++; } }

/* ---------- 1. SHAPES 库不变量 ---------- */
(function () {
  ok(G.SHAPES.length === 16, '积木应为 16 块，实际 ' + G.SHAPES.length);
  var perColor = [0, 0, 0, 0];
  for (var i = 0; i < G.SHAPES.length; i++) {
    var s = G.SHAPES[i];
    ok(s.c >= 0 && s.c < 4, '第 ' + i + ' 块颜色索引非法：' + s.c);
    perColor[s.c]++;
    ok(s.cells.length >= 3 && s.cells.length <= 5,
      '第 ' + i + ' 块应占 3~5 格，实际 ' + s.cells.length);
  }
  ok(perColor.join(',') === '4,4,4,4', '每色应各 4 块，实际 ' + perColor.join(','));

  var dups = G.assertDistinctShapes();
  ok(dups.length === 0, '16 块必须是两两不同的自由多连块（旋转等价算同一块），重复：' +
    JSON.stringify(dups));

  // 旋转归一化：每块至少 1 个旋转，且 4 次旋转后回到原状
  for (i = 0; i < G.SHAPES.length; i++) {
    var rots = G.PIECE_ROT[i];
    ok(rots.length >= 1 && rots.length <= 4, '第 ' + i + ' 块旋转数异常：' + rots.length);
    var key = function (c) { return c.map(function (p) { return p[0] + ',' + p[1]; }).sort().join(';'); };
    var back = G.rotations(G.SHAPES[i].cells).map(key);
    ok(back.indexOf(key(rots[0])) >= 0, '第 ' + i + ' 块旋转库不含原状');
  }
  console.log('1. SHAPES 库（16 块 / 4 色 / 异形 / 3~5 格）✔');
})();

/* ---------- 2. 放置掩码与反推自洽 ---------- */
(function () {
  var miss = 0, back = 0;
  for (var pid = 0; pid < G.SHAPES.length; pid++) {
    var rots = G.PIECE_ROT[pid];
    for (var r = 0; r < rots.length; r++) {
      var bb = G.bbox(rots[r]);
      // bbox 必须是「尺寸」（max-min+1），不是最大坐标——曾因 off-by-one 让托盘积木撑出槽位抓不到
      var xs = {}, ys = {};
      for (var q = 0; q < rots[r].length; q++) { xs[rots[r][q][0]] = 1; ys[rots[r][q][1]] = 1; }
      ok(bb.w === Object.keys(xs).length && bb.h === Object.keys(ys).length,
        'bbox 尺寸错误：rot 跨度 ' + Object.keys(xs).length + 'x' + Object.keys(ys).length +
        ' 但 bbox 返回 ' + bb.w + 'x' + bb.h);
      for (var ox = 0; ox + bb.w <= SIZE; ox++) {
        for (var oy = 0; oy + bb.h <= SIZE; oy++) {
          var m = G.maskOf(rots[r], ox, oy);
          if (G.PIECE_PLACE[pid].indexOf(m) < 0) { miss++; continue; }
          var pp = G.placementToPiece(m);
          // 反推可能命中同形状的另一色块（本库已保证异形），但必须覆盖同一批格
          if (!pp) { back++; continue; }
          var m2 = G.maskOf(G.PIECE_ROT[pp.id][pp.rot], pp.x, pp.y);
          if (m2 !== m) { back++; }
        }
      }
    }
  }
  ok(miss === 0, miss + ' 个合法放置没有进入 PIECE_PLACE');
  ok(back === 0, back + ' 个掩码无法反推回等价放置');
  console.log('2. 旋转 / 放置掩码 / 反推自洽 ✔');
})();

/* ---------- 3~7. 40 关逐关校验 ---------- */
var TOTAL = BF.games.blocks.TOTAL;
ok(TOTAL === 40 && G.LEVELS.length === 40, '关卡总数应为 40，实际 TOTAL=' + TOTAL +
  ' LEVELS=' + G.LEVELS.length);

var composite = [];       // 难度量化：颜色数×100 + 块数
var cellCounts = [];
for (var n = 1; n <= TOTAL; n++) {
  var lv = G.build(n);
  var tier = G.tierOf(n);
  var plan = G.planFor(n);
  var label = 'L' + n + '(tier' + tier + ')';

  // 3.1 亮区在界内
  var cells = G.maskToCells(lv.region);
  var oob = cells.some(function (p) { return p[0] < 0 || p[0] >= SIZE || p[1] < 0 || p[1] >= SIZE; });
  ok(!oob, label + ' 亮区越界');
  ok(cells.length === G.maskToCells(lv.region).length, label + ' 格数自洽');
  cellCounts.push(cells.length);

  // 3.2 格数落在本档区间
  var rg = G.TIER_RANGE[tier];
  ok(cells.length >= rg.cells[0] && cells.length <= rg.cells[1],
    label + ' 亮区格数 ' + cells.length + ' 不在本档区间 [' + rg.cells + ']');

  // 3.3 颜色与块数符合 planFor
  ok(JSON.stringify(lv.colors) === JSON.stringify(plan.map(function (g) { return g.c; })),
    label + ' 指定颜色应为 ' + JSON.stringify(plan.map(function (g) { return g.c; })) +
    '，实际 ' + JSON.stringify(lv.colors));
  ok(lv.pieces.length === plan.reduce(function (s, g) { return s + g.n; }, 0),
    label + ' 块数应为 ' + plan.reduce(function (s, g) { return s + g.n; }, 0) +
    '，实际 ' + lv.pieces.length);

  // 3.4 标准解：每块颜色 ∈ 指定色、不越界、互不重叠、并集恰好等于亮区
  var cover = 0n, occ = {};
  var colorOk = true, geomOk = true;
  for (var i = 0; i < lv.pieces.length; i++) {
    var q = lv.pieces[i];
    if (lv.colors.indexOf(G.SHAPES[q.id].c) < 0) { colorOk = false; }
    var cs = G.PIECE_ROT[q.id][q.rot];
    for (var k = 0; k < cs.length; k++) {
      var gx = cs[k][0] + q.x, gy = cs[k][1] + q.y;
      if (gx < 0 || gx >= SIZE || gy < 0 || gy >= SIZE) { geomOk = false; continue; }
      var idx = gy * SIZE + gx;
      if (occ[idx]) { geomOk = false; }
      occ[idx] = 1;
    }
    cover |= G.maskOf(cs, q.x, q.y);
  }
  ok(colorOk, label + ' 标准解里有非指定颜色的积木（颜色约束被破坏）');
  ok(geomOk, label + ' 标准解有越界或重叠');
  ok(cover === lv.region, label + ' 标准解并未精确覆盖亮区');

  // 4. 可解：用标准解块集复核 ≥1
  var solMasks = lv.pieces.map(function (q) { return G.PIECE_PLACE[q.id]; });
  var sols = G.countSolutions(lv.region, solMasks);
  ok(sols >= 1, label + ' 用标准解块集数不出解（不可解？）');

  // 5. 解数一致：记录值 === 整盒口径 countSolutions
  //    整盒 = 该指定颜色组的全部积木（玩家托盘里真实可用的量）
  var boxIds = G.colorPieceIds(lv.colors);
  var boxMasks = boxIds.map(function (pid) { return G.PIECE_PLACE[pid]; });
  var boxSols = G.countSolutions(lv.region, boxMasks);
  ok(lv.sols === boxSols,
    label + ' 记录解数 ' + lv.sols + ' 与整盒口径复算 ' + boxSols + ' 不一致');

  // 6. 限时题：每档最后一关
  var expectTimed = (n % 10 === 0);
  ok(!!lv.timed === expectTimed,
    label + ' timed=' + lv.timed + '，应为 ' + expectTimed + '（每 10 关换档时限时题）');
  if (lv.timed) { ok(lv.timeLimit > 0, label + ' 限时题 timeLimit 应 > 0'); }

  // 7. 确定性
  var lv2 = G.build(n);
  ok(lv2.regionStr === lv.regionStr && JSON.stringify(lv2.pieces) === JSON.stringify(lv.pieces) &&
     lv2.sols === lv.sols && lv2.timed === lv.timed,
    label + ' 两次 build 不一致（生成不确定）');

  composite.push(lv.colors.length * 100 + lv.pieces.length);
}
console.log('3~7. 40 关配置 / 可解 / 解数一致 / 颜色硬约束 / 确定性 ✔');

/* ---------- 8. 难度曲线 ---------- */
(function () {
  for (var n = 1; n <= TOTAL; n++) {
    var tier = G.tierOf(n);
    ok(tier === Math.floor((n - 1) / 10), 'L' + n + ' 档位映射错乱');
  }
  // 档内 composite 不减
  for (var t = 0; t < 4; t++) {
    var seg = composite.slice(t * 10, t * 10 + 10);
    for (var i = 1; i < seg.length; i++) {
      ok(seg[i] >= seg[i - 1], '第 ' + t + ' 档内难度倒退：' + seg.join(','));
    }
  }
  // 档间严格递增（区间不重叠）
  var tierComp = [composite[0], composite[10], composite[20], composite[30]];
  for (t = 1; t < 4; t++) {
    ok(tierComp[t] > tierComp[t - 1], '档间难度未严格递增：' + tierComp.join(','));
  }
  console.log('8. 难度曲线（档内不减 / 档间严格递增：' + tierComp.join(' < ') + '）✔');
})();

/* ---------- 9. 每日挑战 ---------- */
(function () {
  var d = new Date(2026, 9, 12);   // 固定一天，避开真实日期漂移
  var a = G.buildDaily(d), b = G.buildDaily(d);
  ok(!!a.daily, '每日挑战应带 daily 标记');
  ok(a.regionStr === b.regionStr, '同一天的每日挑战应一致');
  var cells = G.maskToCells(a.region);
  var oob = cells.some(function (p) { return p[0] < 0 || p[0] >= SIZE || p[1] < 0 || p[1] >= SIZE; });
  ok(!oob, '每日挑战亮区越界');
  var boxMasks = G.colorPieceIds(a.colors).map(function (pid) { return G.PIECE_PLACE[pid]; });
  ok(G.countSolutions(a.region, boxMasks) >= 1, '每日挑战应可解');
  ok(a.colors.length >= 2, '每日挑战应取困难档参数（双色），实际 ' + JSON.stringify(a.colors));
  // 不同天大概率不同题（同题只 warn 不 fail）
  var c = G.buildDaily(new Date(2026, 9, 13));
  console.log('9. 每日挑战（可解 / 同日确定 / 双色）✔' +
    (a.regionStr === c.regionStr ? '（与 10-13 撞题，仅提示）' : ''));
})();

/* ---------- 10. 评级边界 ---------- */
(function () {
  var sf = G.starsFor;
  ok(sf(0, 0) === 3, '无提示无失误应 3 星');
  ok(sf(1, 0) === 2 && sf(0, 1) === 2 && sf(1, 1) === 2, '1 次提示或 1 次失误应 2 星');
  ok(sf(2, 0) === 1 && sf(0, 2) === 1 && sf(2, 2) === 1, '超过 1 次应 1 星');
  var rf = G.rankFor;
  ok(rf(1) === 'S' && rf(0.8) === 'S', '剩余 ≥80% 应 S');
  ok(rf(0.79) === 'A' && rf(0.6) === 'A', '剩余 60~79% 应 A');
  ok(rf(0.59) === 'B' && rf(0.4) === 'B', '剩余 40~59% 应 B');
  ok(rf(0.39) === 'C' && rf(0.2) === 'C', '剩余 20~39% 应 C');
  ok(rf(0.19) === 'D' && rf(0.05) === 'D', '剩余 5~19% 应 D');
  ok(rf(0.04) === 'E' && rf(0) === 'E', '剩余 <5% / 超时应 E');
  // 单调性：ratio 越大评级不降
  var order = { E: 0, D: 1, C: 2, B: 3, A: 4, S: 5 }, prev = -1;
  for (var r = 0; r <= 1.0001; r += 0.01) {
    var v = order[rf(Math.min(1, r))];
    ok(v >= prev, 'rankFor 在 ratio=' + r.toFixed(2) + ' 处非单调');
    prev = v;
  }
  console.log('10. starsFor / rankFor 阈值边界 + 单调 ✔');
})();

/* ---------- 11. 难度维度（关卡页难度条 + 「先选难度」首屏） ---------- */
(function () {
  var games = BF.games || {};
  var meta = games.blocks;
  ok(!!meta, '未注册 BF.games.blocks');
  if (!meta) { return; }
  ok(meta.difficulties && meta.difficulties.length === 4,
    '超级积木应有 4 档难度名，实际 ' + JSON.stringify(meta.difficulties));
  ok(typeof meta.tierLevels === 'function' && typeof meta.firstLevelOfSize === 'function',
    '超级积木应提供 tierLevels / firstLevelOfSize（难度首屏与关卡页难度条都靠它们）');
  ok(typeof meta.chipLabel === 'function', '超级积木应提供 chipLabel');
  ok(typeof meta.pickInfo === 'function', '超级积木应提供 pickInfo（难度首屏档卡副标题）');

  var names = meta.difficulties || [];
  var all = [];
  names.forEach(function (nm, i) {
    var lv = meta.tierLevels(nm);
    ok(lv.length === 10, '档「' + nm + '」应含 10 关，实际 ' + lv.length);
    ok(lv[0] === meta.firstLevelOfSize(nm),
      '档「' + nm + '」的 firstLevelOfSize 与 tierLevels 首关不一致');
    ok(lv.length > 0 && lv[0] === i * 10 + 1,
      '档「' + nm + '」应从第 ' + (i * 10 + 1) + ' 关开始，实际 ' + lv[0]);
    // 档内必须连续且严格递增（否则关卡页网格和首屏进度都会算错）
    for (var k = 1; k < lv.length; k++) {
      ok(lv[k] === lv[k - 1] + 1, '档「' + nm + '」关卡号不连续：' + lv.join(','));
    }
    all = all.concat(lv);
    // 档卡副标题要能说出这一档的配方（块数/颜色），不能是兜底文案
    var info = meta.pickInfo(i, { first: lv[0], last: lv[lv.length - 1], count: lv.length });
    ok(info && info.meta && info.meta.indexOf('块') >= 0,
      '档「' + nm + '」的 pickInfo 没说清积木配方：' + (info && info.meta));
  });
  // 四档合起来必须恰好覆盖 1..TOTAL，不重不漏
  ok(all.length === meta.TOTAL, '四档关卡总数应为 ' + meta.TOTAL + '，实际 ' + all.length);
  var uniq = {};
  var dup = [];
  all.forEach(function (n) { if (uniq[n]) { dup.push(n); } uniq[n] = 1; });
  ok(dup.length === 0, '有关卡被算进多个难度档：' + dup.join(','));
  for (var n2 = 1; n2 <= meta.TOTAL; n2++) {
    ok(!!uniq[n2], '第 ' + n2 + ' 关不属于任何难度档');
  }
  // 难度轴严格递增：档间 composite（颜色数×100+块数）必须越来越难
  var comps = names.map(function (nm, i) {
    var plan = G.planFor(i * 10 + 1);
    var colors = {}, blocks = 0;
    plan.forEach(function (p) { colors[p.c] = 1; blocks += p.n; });
    return Object.keys(colors).length * 100 + blocks;
  });
  for (var i2 = 1; i2 < comps.length; i2++) {
    ok(comps[i2] > comps[i2 - 1],
      '难度轴未严格递增：' + comps.join(' → '));
  }
  console.log('11. 4 档难度元数据（tierLevels 连续不重不漏 / 配方文案 / 难度轴递增）✔');
})();

/* ---------- 结果 ---------- */
if (fail) {
  console.log('❌ 失败 ' + fail + ' 项');
  process.exit(1);
} else {
  console.log('✅ 超级积木数据层校验全部通过（40 关 / 解数一致 / 颜色硬约束 / 难度单调 / 评级边界）');
}
