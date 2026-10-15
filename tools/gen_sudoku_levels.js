/**
 * gen_sudoku_levels.js —— 离线生成数独 40 关并写回 js/game/sudoku.js 的 LEVELS
 *
 * 用法：node tools/gen_sudoku_levels.js
 * 流程：逐关 generate(seedOf(n), 目标挖空数) → 校验唯一解/可解/挖空数达标
 *       → 不达标就换 seed 后缀重试（每关最多 40 次）→ 全部通过后按标记位内联写回。
 * ⚠️ 「先落盘、后核对」：先把结果写进 _sudoku_levels_out.txt，核对无误才动 js 文件。
 */
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');

global.GameGlobal = global;
require(path.join(root, 'js/core/ns.js'));
require(path.join(root, 'js/core/palette.js'));
require(path.join(root, 'js/core/save.js'));
require(path.join(root, 'js/game/sudoku.js'));

var Gen = global.BF.SudokuGen;
var TOTAL = Gen.TOTAL;
var BLANKS = Gen.TIER_BLANKS;

function blanksOf(grid) {
  var n = 0;
  for (var i = 0; i < 81; i++) { if (!grid[i]) { n++; } }
  return n;
}

var out = [];
var report = [];
for (var n = 1; n <= TOTAL; n++) {
  var target = BLANKS[Gen.tierOf(n)];
  var rec = null;
  for (var attempt = 0; attempt < 40 && !rec; attempt++) {
    var seed = (Gen.seedOf(n) + attempt * 7717) >>> 0;
    var g = Gen.generate(seed, target);
    if (!g) { continue; }
    if (g.blanks !== target) { continue; }                 // 没挖到目标数
    if (Gen.countSolutions(g.p, 2) !== 1) { continue; }    // 必须唯一解
    // 解必须真的是解：逐格比对（solveOne 造出来的，理论上是，还是查一遍）
    var ok = true;
    for (var i = 0; i < 81; i++) { if (g.p[i] && g.p[i] !== g.s[i]) { ok = false; } }
    if (!ok) { continue; }
    rec = { seed: seed, p: g.p, s: g.s };
  }
  if (!rec) { throw new Error('第 ' + n + ' 关（目标 ' + target + ' 空）40 次尝试都没造出来'); }
  out.push(rec);
  report.push('L' + n + ' tier=' + Gen.tierOf(n) + ' blanks=' + blanksOf(rec.p) +
              ' seed=' + rec.seed);
}

var txt = report.join('\n') + '\n';
fs.writeFileSync(path.join(root, 'tools/_sudoku_levels_out.txt'), txt);
console.log(txt);

/* ---- 内联写回 js/game/sudoku.js ---- */
var jsPath = path.join(root, 'js/game/sudoku.js');
var src = fs.readFileSync(jsPath, 'utf8');
var BEGIN = '  // __SUDOKU_LEVELS_BEGIN__';
var END = '  // __SUDOKU_LEVELS_END__';
var i0 = src.indexOf(BEGIN), i1 = src.indexOf(END);
if (i0 < 0 || i1 < 0) { throw new Error('找不到 LEVELS 标记位'); }

var lines = out.map(function (r) {
  return "    { b: " + blanksOf(r.p) + ", p: '" + r.p.join('') + "', s: '" + r.s.join('') + "' },";
});
var block = BEGIN + '\n  var LEVELS = [\n' + lines.join('\n') + '\n  ];';
src = src.slice(0, i0) + block + src.slice(i1);
fs.writeFileSync(jsPath, src, 'utf8');
console.log('✅ 已写回 js/game/sudoku.js（' + out.length + ' 关）');
