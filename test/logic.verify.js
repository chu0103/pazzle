/**
 * logic.verify.js —— 游戏 2「逻辑拼图」逻辑自检（node test/logic.verify.js）
 * 校验：① 每关都能生成 ② 面积守恒 ③ 标准答案无重叠/无越界/铺满
 *      ④ 固定块恰好 3 块且分别是 1/2/3 格 ⑤ 托盘恰好 8 块 ⑥ 按答案摆放必定通关
 *      ⑦ 每日挑战可复现 ⑧ 生成耗时
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
var sandbox = { console: console, Math: Math, Date: Date, JSON: JSON };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['js/core/ns.js', 'js/core/palette.js', 'js/game/logic.js', 'js/game/model.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
});

var BF = sandbox.BF;
var Logic = BF.Logic;
var fails = [];

function check(cond, msg) { if (!cond) { fails.push(msg); } }

var stats = { minTries: 99, maxTries: 0, sumMs: 0, trayAreas: {}, thin: 0, fixedHit: { 1: 0, 2: 0, 3: 0 } };
var t0 = Date.now();

for (var n = 1; n <= Logic.TOTAL; n++) {
  var t = Date.now();
  var puzzle = Logic.build(n);
  var ms = Date.now() - t;
  stats.sumMs += ms;

  var m = new BF.Model(puzzle);

  // ① 规格
  check(puzzle.size === 8, 'L' + n + ' 棋盘不是 8x8');
  check(puzzle.area === 64, 'L' + n + ' 面积标记不对');
  check(puzzle.pieces.length === 11, 'L' + n + ' 总块数应为 11，实际 ' + puzzle.pieces.length);

  // ② 固定块：恰好 3 块，面积分别 1 / 2 / 3
  var fixedAreas = puzzle.pieces.filter(function (p) { return p.fixed; })
    .map(function (p) { return p.w * p.h; }).sort(function (a, b) { return a - b; });
  check(fixedAreas.length === 3, 'L' + n + ' 固定块应为 3 块，实际 ' + fixedAreas.length);
  check(fixedAreas.join(',') === '1,2,3',
    'L' + n + ' 固定块应为 1/2/3 格，实际 [' + fixedAreas.join(',') + ']');
  fixedAreas.forEach(function (a) { if (stats.fixedHit[a] != null) { stats.fixedHit[a]++; } });

  // ③ 托盘块：恰好 8 块
  var tray = puzzle.pieces.filter(function (p) { return !p.fixed; });
  check(tray.length === 8, 'L' + n + ' 托盘块应为 8 块，实际 ' + tray.length);
  tray.forEach(function (p) {
    var key = p.w + 'x' + p.h;
    stats.trayAreas[key] = (stats.trayAreas[key] || 0) + 1;
    if (Math.min(p.w, p.h) === 1 && Math.max(p.w, p.h) >= 4) { stats.thin++; }
  });

  // ④ 面积守恒
  var sum = 0;
  puzzle.pieces.forEach(function (p) { sum += p.w * p.h; });
  check(sum === 64, 'L' + n + ' 面积不符 ' + sum);

  // ⑤ 标准答案：无重叠、无越界、完全覆盖
  var grid = new Array(64);
  var overlap = false, outOfRange = false;
  puzzle.pieces.forEach(function (p) {
    for (var dy = 0; dy < p.h; dy++) {
      for (var dx = 0; dx < p.w; dx++) {
        var gx = p.x + dx, gy = p.y + dy;
        if (gx < 0 || gy < 0 || gx >= 8 || gy >= 8) { outOfRange = true; continue; }
        var i = gy * 8 + gx;
        if (grid[i]) { overlap = true; }
        grid[i] = 1;
      }
    }
  });
  check(!overlap, 'L' + n + ' 答案存在重叠');
  check(!outOfRange, 'L' + n + ' 答案越界');
  var covered = 0;
  for (var i = 0; i < 64; i++) { if (grid[i]) { covered++; } }
  check(covered === 64, 'L' + n + ' 答案未铺满 ' + covered + '/64');

  // ⑥ 开局状态：3 块固定块已就位，托盘 8 块，棋盘已填 6 格
  check(m.remaining() === 8, 'L' + n + ' 开局应剩 8 块待放，实际 ' + m.remaining());
  check(m.filled() === 6, 'L' + n + ' 开局应已填 6 格，实际 ' + m.filled());
  check(m.undoStack.length === 0, 'L' + n + ' 开局不应有落子历史');

  // ⑦ 固定块不可抬起
  var fp = puzzle.pieces.filter(function (p) { return p.fixed; })[0];
  var fpBefore = m.filled();
  m.lift(m.pieces[fp.id]);
  check(m.filled() === fpBefore, 'L' + n + ' 固定块被抬起来了');

  // ⑧ 按答案摆放 → 必定通关，且干净通关 3 星
  var okAll = true;
  puzzle.pieces.forEach(function (p) {
    if (!m.place(m.pieces[p.id], p.x, p.y)) { okAll = false; }
  });
  check(okAll, 'L' + n + ' 按答案摆放被拒');
  check(m.isSolved(), 'L' + n + ' 按答案摆放后未判定通关');
  check(m.stars() === 3, 'L' + n + ' 干净通关应为 3 星，实际 ' + m.stars());
}

// ⑨ 每日挑战：可复现 + 规格正确
var d1 = Logic.buildDaily(new Date(2026, 8, 30));
var d2 = Logic.buildDaily(new Date(2026, 8, 30));
var d3 = Logic.buildDaily(new Date(2026, 8, 31));
check(JSON.stringify(d1.pieces) === JSON.stringify(d2.pieces), '每日挑战不可复现');
check(JSON.stringify(d1.pieces) !== JSON.stringify(d3.pieces), '相邻两天题目相同');
check(d1.pieces.filter(function (p) { return p.fixed; }).length === 3, '每日挑战固定块数不对');

// ⑩ 同 n 稳定
var a = JSON.stringify(Logic.build(17).pieces);
var b = JSON.stringify(Logic.build(17).pieces);
check(a === b, '同一关两次生成结果不一致');

console.log('关卡总数: ' + Logic.TOTAL);
console.log('生成总耗时 ' + stats.sumMs + 'ms（' + (stats.sumMs / Logic.TOTAL).toFixed(1) + 'ms/关）');
console.log('固定块命中: 1格 x' + stats.fixedHit[1] + ' / 2格 x' + stats.fixedHit[2] + ' / 3格 x' + stats.fixedHit[3]);
console.log('托盘块含细长条(1x4)的次数: ' + stats.thin + ' / ' + (Logic.TOTAL * 8) + ' 块');
console.log('托盘块形状分布: ' + Object.keys(stats.trayAreas).sort().map(function (k) {
  return k + 'x' + stats.trayAreas[k];
}).join('  '));

// 打一关题面出来看
var s = Logic.build(7);
var g = Array.from({ length: 8 }, function () { return new Array(8).fill('.'); });
s.pieces.forEach(function (p) {
  var ch = p.fixed ? '#' : String.fromCharCode(97 + (p.color % 4));
  for (var dy = 0; dy < p.h; dy++) {
    for (var dx = 0; dx < p.w; dx++) { g[p.y + dy][p.x + dx] = ch; }
  }
});
console.log('\n第 7 关题面（# = 固定块，字母 = 托盘块按颜色）：');
g.forEach(function (row) { console.log('   ' + row.join(' ')); });

if (fails.length) {
  console.log('\n❌ 失败 ' + fails.length + ' 项:');
  fails.slice(0, 20).forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
} else {
  console.log('\n✅ 全部通过：' + Logic.TOTAL + ' 关 + 每日挑战均合规（3 块固定 1/2/3 格 + 8 块托盘，铺满无重叠、100% 有解）');
}
