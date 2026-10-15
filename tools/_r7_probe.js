/* 实验：把「初始动不了的车」彻底禁掉（R7）后，6×6 还能采到多高 opt？
 * 对每档随机撒车 + 爬山，统计通过率与 opt 分布，判断 R7 是否可行。 */
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'js/core/ns.js'));
require(path.join(root, 'js/game/rush.js'));
var RG = BF.RushGen, U = BF.util;

function minMaxRange(cars, size, i) {
  var c = cars[i], Lc = c.len;
  var cpos = c.horiz ? c.x : c.y, cfix = c.horiz ? c.y : c.x;
  var min = 0, max = size - Lc;
  for (var j = 0; j < cars.length; j++) {
    if (j === i) { continue; }
    var o = cars[j], opos = o.horiz ? o.x : o.y, ofix = o.horiz ? o.y : o.x;
    if (c.horiz) {
      var oInRow = o.horiz ? (ofix === cfix) : (opos <= cfix && cfix <= opos + o.len - 1);
      if (!oInRow) { continue; }
      var oCol = o.horiz ? opos : ofix, oCols = o.horiz ? o.len : 1;
      if (oCol + oCols - 1 < cpos) { min = Math.max(min, oCol + oCols); }
      else if (oCol > cpos + Lc - 1) { max = Math.min(max, oCol - Lc); }
    } else {
      var oInCol = o.horiz ? (opos <= cfix && cfix <= opos + o.len - 1) : (ofix === cfix);
      if (!oInCol) { continue; }
      var oRow = o.horiz ? ofix : opos, oRows = o.horiz ? 1 : o.len;
      if (oRow + oRows - 1 < cpos) { min = Math.max(min, oRow + oRows); }
      else if (oRow > cpos + Lc - 1) { max = Math.min(max, oRow - Lc); }
    }
  }
  return { min: min, max: max };
}
/** R7：全体车（含警车）初始至少有一个方向能动 */
function isR7(board) {
  for (var i = 0; i < board.cars.length; i++) {
    var r = minMaxRange(board.cars, board.size, i);
    if (r.min === r.max) { return false; }
  }
  return true;
}
/** 只有警车必须能动（弱化版 R7a） */
function isR7a(board) {
  var r = minMaxRange(board.cars, board.size, 0);
  return r.min !== r.max;
}

var CARS = [[5, 6], [7, 8], [9, 10], [11, 12]];
var SEED = 20260601;
var N = 6000;
for (var s = 0; s < CARS.length; s++) {
  var mn = CARS[s][0], mx = CARS[s][1];
  var passAll = 0, passPolice = 0, hist = {}, best = 0, bestBoard = null;
  for (var i = 0; i < N; i++) {
    var rng = U.mulberry32((SEED + s * 777 + i * 2654435761) % 2147483647);
    var exitRow = Math.floor(rng() * 6);
    var cc = mn + Math.floor(rng() * (mx - mn + 1));
    var b = RG.generateOne(6, exitRow, cc, rng);
    if (!b) { continue; }
    if (!isR7a(b)) { continue; }
    passPolice++;
    if (!isR7(b)) { continue; }
    passAll++;
    var r = RG.solveCap(b, 400000);
    if (r.opt === Infinity) { continue; }
    hist[r.opt] = (hist[r.opt] || 0) + 1;
    if (r.opt > best) { best = r.opt; bestBoard = b; }
  }
  var keys = Object.keys(hist).map(Number).sort(function (a, b) { return a - b; });
  console.log('车数 ' + mn + '-' + mx + '：样本 ' + N +
    '，警车可动 ' + passPolice + '，全体可动 ' + passAll +
    '，opt 最大 ' + best);
  console.log('   直方 ' + keys.map(function (k) { return k + ':' + hist[k]; }).join(' '));
}
