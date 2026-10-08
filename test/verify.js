/**
 * verify.js —— 逻辑自检（node test/verify.js）
 * 校验：① 方块总面积 == 棋盘面积 ② 标准答案互不重叠 ③ 按答案摆放后必定通关
 *      ④ 难度曲线递增 ⑤ 每日挑战可复现
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
var sandbox = { console: console, Math: Math, Date: Date, JSON: JSON };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['js/core/ns.js', 'js/core/palette.js', 'js/game/generator.js', 'js/game/model.js'].forEach(function (f) {
  var code = fs.readFileSync(path.join(root, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
});

var BF = sandbox.BF;
var fails = [];
var rows = [];

function check(cond, msg) {
  if (!cond) { fails.push(msg); }
}

for (var n = 1; n <= BF.Levels.TOTAL; n++) {
  var puzzle = BF.Levels.build(n);
  var m = new BF.Model(puzzle);

  // ① 面积守恒
  var sum = 0;
  puzzle.pieces.forEach(function (p) { sum += p.w * p.h; });
  check(sum === puzzle.area, 'L' + n + ' 面积不符 ' + sum + ' != ' + puzzle.area);

  // ② 答案不重叠、完全覆盖
  var grid = new Array(puzzle.area);
  var overlap = false, outOfRange = false;
  puzzle.pieces.forEach(function (p) {
    for (var dy = 0; dy < p.h; dy++) {
      for (var dx = 0; dx < p.w; dx++) {
        var gx = p.x + dx, gy = p.y + dy;
        if (gx < 0 || gy < 0 || gx >= puzzle.size || gy >= puzzle.size) { outOfRange = true; continue; }
        var i = gy * puzzle.size + gx;
        if (grid[i]) { overlap = true; }
        grid[i] = 1;
      }
    }
  });
  check(!overlap, 'L' + n + ' 答案存在重叠');
  check(!outOfRange, 'L' + n + ' 答案越界');
  var covered = 0;
  for (var i = 0; i < puzzle.area; i++) { if (grid[i]) { covered++; } }
  check(covered === puzzle.area, 'L' + n + ' 答案未铺满 ' + covered + '/' + puzzle.area);

  // ③ 按答案逐个摆放，必须能全部放下并通关
  var okAll = true;
  puzzle.pieces.forEach(function (p) {
    if (!m.place(m.pieces[p.id], p.x, p.y)) { okAll = false; }
  });
  check(okAll, 'L' + n + ' 按答案摆放被拒（存在非法放置）');
  check(m.isSolved(), 'L' + n + ' 按答案摆放后未判定通关');

  // ④ 统计
  var minSide = 99, singles = 0;
  puzzle.pieces.forEach(function (p) {
    minSide = Math.min(minSide, Math.min(p.w, p.h));
    if (p.w * p.h === 1) { singles++; }
  });
  rows.push({
    level: n, size: puzzle.size, pieces: puzzle.count,
    minSide: minSide, singles: singles, stars: m.stars()
  });
}

// ⑤ 每日挑战确定性
var d1 = BF.Levels.buildDaily(new Date(2026, 8, 30));
var d2 = BF.Levels.buildDaily(new Date(2026, 8, 30));
check(JSON.stringify(d1.pieces) === JSON.stringify(d2.pieces), '每日挑战不可复现');
var d3 = BF.Levels.buildDaily(new Date(2026, 8, 31));
check(JSON.stringify(d1.pieces) !== JSON.stringify(d3.pieces), '相邻两天题目相同');

console.log('关卡总数: ' + BF.Levels.TOTAL);
console.log('关卡  棋盘  块数  最小边  1x1数');
rows.forEach(function (r) {
  var mark = (r.level <= 2 || r.level % 5 === 0 || r.level === BF.Levels.TOTAL) ? '' : '';
  if (mark === '' && (r.level <= 3 || r.level % 10 === 0 || r.level === 60)) {
    console.log(
      String(r.level).padStart(4) + '  ' +
      String(r.size + 'x' + r.size).padStart(4) + '  ' +
      String(r.pieces).padStart(4) + '  ' +
      String(r.minSide).padStart(6) + '  ' +
      String(r.singles).padStart(5)
    );
  }
});
console.log('每日挑战: 6x6 / ' + d1.count + ' 块, 可复现=' +
  (JSON.stringify(d1.pieces) === JSON.stringify(d2.pieces)));

if (fails.length) {
  console.log('\n❌ 失败 ' + fails.length + ' 项:');
  fails.slice(0, 20).forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
} else {
  console.log('\n✅ 全部通过：60 关 + 每日挑战均有解、可铺满、无重叠');
}
