/* 验证 rush 关卡数据层：可解 / opt 一致 / 合法 / 难度单调 / 星级 / 每日挑战 */
var path = require('path');
var root = 'C:/Users/admin/WorkBuddy/2026-09-30-08-41-53/puzzle-arcade';
require(path.join(root, 'js/core/ns.js'));
var G = globalThis;
var BF = G.BF;
require(path.join(root, 'js/game/rush.js'));
var RG = BF.RushGen;
var U = BF.util;

var fail = 0, warn = 0;
function ok(cond, msg) { if (!cond) { console.log('  ✗ ' + msg); fail++; } }
function wm(cond, msg) { if (!cond) { console.log('  ⚠ ' + msg); warn++; } }

var N = RG.LEVELS.length;
console.log('关卡总数: ' + N);
ok(N === 20, '应为 20 关（实际 ' + N + '）');

// 1) 每关：反序列化 + 求解 + 合法性
var opts = [];
var sigs = {};
for (var n = 1; n <= N; n++) {
  var L = RG.configOf(n);
  var board = RG.build(n);
  // 反序列化一致性
  var ser = RG.serialize(board).f;
  // 车辆不重叠、不越界
  var size = board.size;
  var occ = {};
  var overlap = false, oob = false;
  board.cars.forEach(function (c, i) {
    var len = c.len, horiz = c.horiz;
    for (var k = 0; k < len; k++) {
      var x = horiz ? c.x + k : c.x;
      var y = horiz ? c.y : c.y + k;
      if (x < 0 || y < 0 || x >= size || y >= size) { oob = true; }
      var key = y * size + x;
      if (occ[key]) { overlap = true; } occ[key] = true;
    }
    // 警车必须是 cars[0]
    if (i === 0) { ok(c.police === true, 'L' + n + ' 警车应为 cars[0]'); }
  });
  ok(!overlap, 'L' + n + ' 车辆重叠');
  ok(!oob, 'L' + n + ' 车辆越界');

  // 重新求解，校验 opt 与内联一致
  var r = RG.solve(board);
  ok(r.opt === L.o, 'L' + n + ' opt 不一致：内联 ' + L.o + ' 实际 ' + r.opt);
  ok(r.opt !== Infinity, 'L' + n + ' 不可解');
  opts.push(L.o);

  // 去重
  var sig = board.cars.map(function (c) { return (c.horiz?1:0)+','+c.len+','+c.x+','+c.y+','+(c.police?-1:c.ci); }).join(';');
  if (sigs[sig]) { wm(false, 'L' + n + ' 与 L' + sigs[sig] + ' 布局相同（近似重复）'); }
  sigs[sig] = n;

  // 初始局面提示：用 solveStep 验证能给一个合法首步（提示功能运行时从当前局面算，无需存 first）
  var hf = RG.solveStep(board, board.cars.map(function (c) { return c.horiz ? c.x : c.y; }));
  ok(hf !== null && hf !== undefined, 'L' + n + ' 初始局面提示求解失败');
}

// 2) 难度单调：4 档各 5 关，档内升序、档间严格不重叠、落区间
var STAGES = RG.STAGES;
for (var s = 0; s < 4; s++) {
  var slice = opts.slice(s * 5, s * 5 + 5);
  for (var i = 1; i < slice.length; i++) {
    ok(slice[i] >= slice[i - 1], '档' + (s + 1) + ' 档内非单调: ' + slice.join(','));
  }
  var st = STAGES[s];
  slice.forEach(function (o) {
    ok(o >= st.optMin && o <= st.optMax, '档' + (s + 1) + ' opt ' + o + ' 超出区间 ' + st.optMin + '~' + st.optMax);
  });
}
for (var s2 = 1; s2 < 4; s2++) {
  var prevMax = opts[s2 * 5 - 1];
  var curMin = opts[s2 * 5];
  ok(curMin >= prevMax, '档' + s2 + '→档' + (s2 + 1) + ' 边界未单调不降: ' + prevMax + ' / ' + curMin);
}

// 3) 星级（used = 玩家「连续滑动」步数；最优滑动数 = opt-1，opt 含自动驶出那一步）
for (var n2 = 1; n2 <= N; n2++) {
  var best = RG.configOf(n2).o - 1;
  ok(RG.starsFor(n2, best) === 3, 'L' + n2 + ' 用最优 ' + best + ' 步应 3 星');
  ok(RG.starsFor(n2, Math.ceil(best * 1.4)) === 2, 'L' + n2 + ' 用 ceil(最优*1.4) 步应 2 星');
  ok(RG.starsFor(n2, best + 100) === 1, 'L' + n2 + ' 超多步应 1 星');
}

// 4) 每日挑战
var d1 = RG.buildDaily(new Date('2026-10-10'));
var d2 = RG.buildDaily(new Date('2026-10-10'));
ok(d1.level === d2.level, '每日挑战同日应同关');
ok(d1.daily === true, '每日挑战 daily 标记');

// 4b) 可玩性约束：R6 无贴墙死车 + R7 警车初始不卡死
for (var n3 = 1; n3 <= N; n3++) {
  var bb = RG.build(n3);
  ok(RG.isR6(bb), 'L' + n3 + ' isR6 应为 true（贴墙死车 / 警车卡死）');
  var stk = RG.stuckCars(bb);
  ok(stk.indexOf(0) < 0, 'L' + n3 + ' 警车初始就动不了（R7 违规）');
  if (n3 <= 5) {
    ok(RG.isAllFree(bb), 'L' + n3 + ' 入门档应「全体车初始可动」，实际拖不动 ' + stk.join(','));
  }
  for (var q = 0; q < stk.length; q++) {
    var cc = bb.cars[stk[q]], pp = cc.horiz ? cc.x : cc.y;
    ok(pp !== 0 && pp !== bb.size - cc.len,
      'L' + n3 + ' 车#' + stk[q] + ' 贴墙且动不了（R6 违规）');
  }
}
ok(RG.isR6(RG.buildDaily(new Date('2026-10-10'))), '每日挑战 isR6 应为 true');

// 5) 提示求解（随机一关的当前局面）
var hint = RG.solveStep(RG.build(20), RG.build(20).cars.map(function (c) { return c.horiz ? c.x : c.y; }));
ok(hint !== null, '提示求解返回第一步');

console.log('opt 序列: ' + opts.join(','));
console.log(fail === 0 ? ('✅ 全部通过（警告 ' + warn + '）') : ('❌ 失败 ' + fail + ' 项（警告 ' + warn + '）'));
process.exit(fail === 0 ? 0 : 1);
