/* 直接核对 tools/_rush_levels_out.txt 里生成好的 20 关（不内联也能验）：
 * 可解 / opt 一致 / R6 无贴墙死车 / R7 警车不卡死 / 逐关列出"拖不动"的车 */
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'js/core/ns.js'));
require(path.join(root, 'js/game/rush.js'));
var RG = BF.RushGen;

var txt = fs.readFileSync(path.join(root, 'tools', '_rush_levels_out.txt'), 'utf8');
var body = txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1);
var LEVELS = JSON.parse(body.replace(/,\s*\]/g, ']'));
console.log('解析出 ' + LEVELS.length + ' 关');

function grid(board) {
  var size = board.size, g = [];
  for (var y = 0; y < size; y++) { g.push(new Array(size).fill('.')); }
  board.cars.forEach(function (c, i) {
    var ch = c.police ? 'P' : String.fromCharCode(65 + i - 1);
    for (var k = 0; k < c.len; k++) {
      var x = c.horiz ? c.x + k : c.x, y = c.horiz ? c.y : c.y + k;
      g[y][x] = ch;
    }
  });
  return g.map(function (row, y) { return '   ' + row.join(' ') + (y === board.exitRow ? '  >出口' : ''); }).join('\n');
}

var fail = 0, policeStuckTotal = 0, anyStuckTotal = 0, wallTotal = 0;
LEVELS.forEach(function (L, idx) {
  var n = idx + 1;
  var b = RG.deserialize(L);
  var r = RG.solve(b);
  if (r.opt !== L.o) { console.log('  ✗ L' + n + ' opt 不一致 内联 ' + L.o + ' 求解 ' + r.opt); fail++; }
  if (r.opt === Infinity) { console.log('  ✗ L' + n + ' 不可解'); fail++; }
  if (!RG.isR6(b)) { console.log('  ✗ L' + n + ' isR6 失败'); fail++; }
  var stk = RG.stuckCars(b);
  var policeStuck = stk.filter(function (i) { return b.cars[i].police; });
  var wall = stk.filter(function (i) {
    var c = b.cars[i], p = c.horiz ? c.x : c.y;
    return p === 0 || p === b.size - c.len;
  });
  policeStuckTotal += policeStuck.length; anyStuckTotal += stk.length; wallTotal += wall.length;
  if (policeStuck.length) { console.log('  ✗ L' + n + ' 警车初始卡死'); fail++; }
  if (wall.length) { console.log('  ✗ L' + n + ' 贴墙死车 ' + wall.join(',')); fail++; }
  if (n <= 5 && !RG.isAllFree(b)) {
    console.log('  ✗ L' + n + ' 入门档应「全体车初始可动」，实际拖不动 ' + stk.join(','));
    fail++;
  }
  console.log('L' + n + ' opt=' + L.o + '  初始拖不动的车=' + (stk.length ? stk.join(',') : '无') +
    '  警车=' + (policeStuck.length ? '卡死' : '可动'));
  if (stk.length) { console.log(grid(b)); }
});
console.log('合计：拖不动 ' + anyStuckTotal + ' 辆（其中贴墙 ' + wallTotal + '，警车 ' + policeStuckTotal + '），失败 ' + fail);
