/**
 * rush.verify.js —— 移车出库「数据层」回归测试（node test/rush.verify.js）
 *
 * 与 tools/_verify_rush_logic.js 互补：那一份覆盖「配置合法 / 可解 / opt 一致 /
 * 档内单调 / 档间严格不重叠 / starsFor 三档 / 每日确定性 / 提示首步」；本份补上：
 *   - 车辆几何不变量（唯一警车=cars[0]、警车必为横车占 2 格且在 exitRow、垂直车 x 固定、
 *     颜色索引 ci 合法、无越界/重叠）
 *   - 关卡 build 确定性（同一关两次构造逐格一致）
 *   - 每日挑战：可解 + opt 落在 [3,23] + 同日确定性 + daily 标记
 *   - starsFor 边界带（玩家最优滑动步数 best=opt-1 → 3★；best+1 → 2★；超 2★ 线 → 1★）
 *   - solveStep 返回的第一步是「几何合法的单格移动」（不会给出穿模/越界的首步）
 * 不依赖画布，纯 node 跑数据层。失败 process.exit(1)。
 */
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'js/core/ns.js'));
require(path.join(root, 'js/core/palette.js'));
require(path.join(root, 'js/core/draw.js'));
require(path.join(root, 'js/core/save.js'));
require(path.join(root, 'js/game/rush.js'));

var RG = BF.RushGen;
var U = BF.util;

var fail = 0, warn = 0;
function ok(cond, msg) { if (!cond) { console.log('  ✗ ' + msg); fail++; } }
function wm(cond, msg) { if (!cond) { console.log('  ⚠ ' + msg); warn++; } }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/** 车辆占用的格子索引数组 */
function cellsOf(c, pos, size) {
  var out = [], k;
  if (c.horiz) { for (k = 0; k < c.len; k++) out.push(c.y * size + (pos + k)); }
  else { for (k = 0; k < c.len; k++) out.push((pos + k) * size + c.x); }
  return out;
}

/** 校验一关棋盘的几何不变量，返回 { size, exitRow, opt } */
function checkBoard(board, label) {
  var size = board.size, cars = board.cars;
  ok(size === 6, label + ' 应为 6×6（专家档已统一为全 6×6），实际 ' + size);

  // 1) 唯一警车 = cars[0]，且为横车 len=2，停在 exitRow
  var policeCount = 0, pi = -1;
  for (var i = 0; i < cars.length; i++) {
    if (cars[i].police) { policeCount++; pi = i; }
  }
  ok(policeCount === 1, label + ' 警车数量应为 1，实际 ' + policeCount);
  ok(pi === 0, label + ' 警车必须是 cars[0]，实际索引 ' + pi);
  if (pi === 0) {
    var p = cars[0];
    ok(p.horiz === true, label + ' 警车必须是横向车');
    ok(p.len === 2, label + ' 警车必须占 2 格，实际 ' + p.len);
    ok(p.y === board.exitRow, label + ' 警车必须停在 exitRow(' + board.exitRow + ')，实际 y=' + p.y);
    ok(p.x >= 0 && p.x <= size - 2, label + ' 警车 x 越界：' + p.x);
  }

  // 2) 其余车：ci 合法 + 轴固定 + 不越界 + 不重叠
  var occ = {};
  for (i = 0; i < cars.length; i++) {
    var c = cars[i];
    if (!c.police) {
      ok(c.ci >= 0 && c.ci < RG.CAR_COLORS.length,
        label + ' 车#' + i + ' ci=' + c.ci + ' 超出调色板范围[0,' + (RG.CAR_COLORS.length - 1) + ']');
    }
    // 轴固定：横车所有格 y 相同；竖车所有格 x 相同（cellsOf 已隐含，这里再查坐标本身）
    if (c.horiz) {
      ok(c.y >= 0 && c.y < size, label + ' 车#' + i + ' 横车 y 越界: ' + c.y);
      ok(c.x >= 0 && c.x + c.len <= size, label + ' 车#' + i + ' 横车 x 越界: x=' + c.x + ' len=' + c.len);
    } else {
      ok(c.x >= 0 && c.x < size, label + ' 车#' + i + ' 竖车 x 越界: ' + c.x);
      ok(c.y >= 0 && c.y + c.len <= size, label + ' 车#' + i + ' 竖车 y 越界: y=' + c.y + ' len=' + c.len);
    }
    var pos = c.horiz ? c.x : c.y;
    var cells = cellsOf(c, pos, size);
    for (var k = 0; k < cells.length; k++) {
      ok(!occ[cells[k]], label + ' 车#' + i + ' 与别的车重叠于格 ' + cells[k]);
      occ[cells[k]] = true;
    }
  }
  var totalCells = 0;
  for (var j = 0; j < cars.length; j++) { totalCells += cars[j].len; }
  ok(Object.keys(occ).length === totalCells, label + ' 占用格总数应等于各车长度和（' + totalCells + '）');

  return { size: size, exitRow: board.exitRow, opt: board.opt };
}

/* ====================== 1. 20 关几何不变量 ====================== */
console.log('— 关卡几何不变量（' + RG.TOTAL + ' 关）—');
ok(RG.TOTAL === 20, '应为 20 关，实际 ' + RG.TOTAL);
var optList = [];
for (var n = 1; n <= RG.TOTAL; n++) {
  var board = RG.build(n);
  checkBoard(board, 'L' + n);
  // opt 一致（与内联 + 真实求解都吻合）
  var r = RG.solve(board);
  ok(r.opt === RG.configOf(n).o, 'L' + n + ' opt 不一致：内联 ' + RG.configOf(n).o + ' 求解 ' + r.opt);
  ok(r.opt !== Infinity, 'L' + n + ' 不可解');
  optList.push(RG.configOf(n).o);
}

/* ====================== 2. 关卡 build 确定性 ====================== */
console.log('— 关卡构造确定性 —');
for (n = 1; n <= RG.TOTAL; n++) {
  var a = RG.serialize(RG.build(n));
  var b = RG.serialize(RG.build(n));
  ok(eq(a, b), 'L' + n + ' 两次 build 结果不一致（关卡必须确定，真机不重算）');
}

/* ====================== 3. 每日挑战 ====================== */
console.log('— 每日挑战 —');
var DAILY_DATE = new Date('2026-10-10');
var db1 = RG.buildDaily(DAILY_DATE);
var db2 = RG.buildDaily(DAILY_DATE);
ok(db1.daily === true, '每日挑战 daily 标记缺失');
ok(db1.level === db2.level, '每日挑战同日应同关（确定性）');
checkBoard(db1, '每日(' + DAILY_DATE.toISOString().slice(0, 10) + ')');
var dr = RG.solve(db1);
ok(dr.opt !== Infinity, '每日挑战不可解');
ok(dr.opt >= 3 && dr.opt <= 23, '每日挑战 opt(' + dr.opt + ') 应落在 [3,23]');
ok(dr.opt === db1.opt, '每日挑战 opt 不一致：内联 ' + db1.opt + ' 求解 ' + dr.opt);

/* ====================== 4. starsFor 边界带 ====================== */
console.log('— starsFor 边界带 —');
for (n = 1; n <= RG.TOTAL; n++) {
  var best = RG.configOf(n).o - 1;   // 玩家最优「连续滑动」步数（opt 含自动驶出那一步）
  ok(RG.starsFor(n, best) === 3, 'L' + n + ' 用最优滑动 ' + best + ' 步应 3 星');
  ok(RG.starsFor(n, best + 1) === 2, 'L' + n + ' 多滑 1 步（' + (best + 1) + '）应 2 星');
  ok(RG.starsFor(n, Math.ceil(best * 1.4) + 1) === 1, 'L' + n + ' 超过 2★ 线应 1 星');
}

/* ====================== 5. solveStep 首步几何合法 ====================== */
console.log('— 提示首步几何合法性 —');
for (n = 1; n <= RG.TOTAL; n++) {
  var bd = RG.build(n);
  var positions = bd.cars.map(function (c) { return c.horiz ? c.x : c.y; });
  var step = RG.solveStep(bd, positions);
  ok(step && typeof step.car === 'number' && (step.dir === 1 || step.dir === -1),
    'L' + n + ' 提示首步格式异常: ' + JSON.stringify(step));
  if (!step) { continue; }
  var car = bd.cars[step.car];
  var hi = bd.size - car.len;
  var np = positions[step.car] + step.dir;
  ok(np >= 0 && np <= hi, 'L' + n + ' 提示首步会让车#' + step.car + ' 越界到 ' + np);
  // 排除自身后，目标格不能与别的车重叠
  var occ2 = {};
  for (var j = 0; j < bd.cars.length; j++) {
    if (j === step.car) { continue; }
    var cells2 = cellsOf(bd.cars[j], bd.cars[j].horiz ? bd.cars[j].x : bd.cars[j].y, bd.size);
    for (var t = 0; t < cells2.length; t++) { occ2[cells2[t]] = true; }
  }
  var moved = { id: car.id, horiz: car.horiz, len: car.len, x: car.x, y: car.y, ci: car.ci, police: car.police };
  if (car.horiz) { moved.x = np; } else { moved.y = np; }
  var mcells = cellsOf(moved, np, bd.size);
  var collide = false;
  for (t = 0; t < mcells.length; t++) { if (occ2[mcells[t]]) { collide = true; break; } }
  ok(!collide, 'L' + n + ' 提示首步会让车#' + step.car + ' 与别的车重叠');
}

/* ====================== 6. 可玩性约束：无贴墙死车（R6）+ 警车不卡死（R7） ====================== */
console.log('— R6/R7：禁止贴墙死车 + 禁止警车初始卡死 —');
/**
 * R6：一辆「初始完全动不了」的车（legalRange.min===max）若滑动坐标落在墙边
 * （横车 x===0 或 x===size-Lc；竖车 y===0 或 y===size-Lc），则它唯一的移动方向就是
 * 盘内却被邻车堵死 —— 玩家一拖不动就以为坏了（用户圈出的正是右上角贴墙死车）。
 * R7：**警车**初始就动不了同样致命（玩家上手先拖警车），一并禁止。
 * 盘内被两侧车夹住的非警车允许（密度的一部分，且拖动时会有抖动 + 提示兜底）。
 */
function wallStuckCars(board) {
  var cars = board.cars, size = board.size, list = [];
  for (var i = 0; i < cars.length; i++) {
    var c = cars[i], Lc = c.len, p = c.horiz ? c.x : c.y;
    if (p !== 0 && p !== size - Lc) { continue; }
    var rg = RG.legalRangeAt(board, cars, i);
    if (rg.min === rg.max) { list.push(i); }
  }
  return list;
}
for (n = 1; n <= RG.TOTAL; n++) {
  var wb = RG.build(n);
  var ws = wallStuckCars(wb);
  ok(ws.length === 0, 'L' + n + ' 存在贴墙死车（R6 违规）：' + ws.join(','));
  var stk = RG.stuckCars(wb);
  ok(stk.indexOf(0) < 0, 'L' + n + ' 警车初始就动不了（R7 违规）');
  ok(RG.isR6(wb), 'L' + n + ' isR6(board) 应为 true');
  // 入门档（前 5 关）额外要求「全体车初始可动」—— 新手第一印象里不该有拖不动的车
  if (n <= 5) {
    ok(RG.isAllFree(wb),
      'L' + n + ' 入门档应满足「全体车初始可动」，实际拖不动 ' + stk.join(','));
    ok(stk.length === 0, 'L' + n + ' 入门档不该有初始卡死的车');
  }
  // stuckCars 与 legalRangeAt 必须同源：stuck 列表 = 该车 min===max
  for (var si = 0; si < wb.cars.length; si++) {
    var srg = RG.legalRangeAt(wb, wb.cars, si);
    var shouldStuck = (srg.min === srg.max);
    ok((stk.indexOf(si) >= 0) === shouldStuck,
      'L' + n + ' stuckCars 与 legalRangeAt 不一致（车#' + si + '）');
  }
}
// 每日挑战也要满足 R6/R7
var wdb = RG.buildDaily(DAILY_DATE);
ok(wallStuckCars(wdb).length === 0, '每日挑战存在贴墙死车（R6 违规）');
ok(RG.stuckCars(wdb).indexOf(0) < 0, '每日挑战警车初始就动不了（R7 违规）');
ok(RG.isR6(wdb), '每日挑战 isR6(board) 应为 true');

console.log('opt 序列: ' + optList.join(','));

/* ====================== 7. 难度自选入口 ====================== */
console.log('— 难度自选入口（levels.js 难度条三件套）—');
var meta = BF.games.rush;
ok(!!(meta.difficulties && meta.firstLevelOfSize), 'rush 应注册 difficulties + firstLevelOfSize（关卡页才显示难度条）');
ok((meta.difficulties || []).length === 4, '难度档应为 4 档，实际 ' + (meta.difficulties || []).length);
ok(meta.firstLevelOfSize('入门') === 1, '入门应映射到第 1 关，实际 ' + meta.firstLevelOfSize('入门'));
ok(meta.firstLevelOfSize('进阶') === 6, '进阶应映射到第 6 关，实际 ' + meta.firstLevelOfSize('进阶'));
ok(meta.firstLevelOfSize('困难') === 11, '困难应映射到第 11 关，实际 ' + meta.firstLevelOfSize('困难'));
ok(meta.firstLevelOfSize('专家') === 16, '专家应映射到第 16 关，实际 ' + meta.firstLevelOfSize('专家'));
ok(typeof meta.chipLabel === 'function', '应提供 chipLabel');

console.log(fail === 0
  ? ('✅ 全部通过（警告 ' + warn + '）')
  : ('❌ 失败 ' + fail + ' 项（警告 ' + warn + '）'));
process.exit(fail === 0 ? 0 : 1);
