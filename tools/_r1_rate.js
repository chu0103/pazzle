/* 临时实验：统计"初始无被卡车辆"约束在 6×6 各车数下的通过率，以及高车数下的 opt 分布 */
var path = require('path');
var root = 'C:/Users/admin/WorkBuddy/2026-09-30-08-41-53/puzzle-arcade';
require(path.join(root, 'js/core/ns.js'));
require(path.join(root, 'js/game/rush.js'));
var BF = globalThis.BF, RG = BF.RushGen, U = BF.util;

function cellsOf(c, p, size) {
  var out = [], k;
  if (c.horiz) { for (k = 0; k < c.len; k++) { out.push(c.y * size + (p + k)); } }
  else { for (k = 0; k < c.len; k++) { out.push((p + k) * size + c.x); } }
  return out;
}
function rangeOf(cars, size, i) {
  var c = cars[i], Lc = c.len;
  var cpos = c.horiz ? c.x : c.y, cfix = c.horiz ? c.y : c.x;
  var min = 0, max = size - Lc;
  for (var j = 0; j < cars.length; j++) {
    if (j === i) { continue; }
    var o = cars[j], opos = o.horiz ? o.x : o.y, ofix = o.horiz ? o.y : o.x;
    if (c.horiz) {
      var inRow = o.horiz ? (ofix === cfix) : (opos <= cfix && cfix <= opos + o.len - 1);
      if (!inRow) { continue; }
      var oCol = o.horiz ? opos : ofix, oCols = o.horiz ? o.len : 1;
      if (oCol + oCols - 1 < cpos) { min = Math.max(min, oCol + oCols); }
      else if (oCol > cpos + Lc - 1) { max = Math.min(max, oCol - Lc); }
    } else {
      var inCol = o.horiz ? (opos <= cfix && cfix <= opos + o.len - 1) : (ofix === cfix);
      if (!inCol) { continue; }
      var oRow = o.horiz ? ofix : opos, oRows = o.horiz ? 1 : o.len;
      if (oRow + oRows - 1 < cpos) { min = Math.max(min, oRow + oRows); }
      else if (oRow > cpos + Lc - 1) { max = Math.min(max, oRow - Lc); }
    }
  }
  return max - min;   // 0 = 被卡死；>=1 = 能滑
}
function pinnedCount(board) {
  var p = 0;
  for (var i = 0; i < board.cars.length; i++) { if (rangeOf(board.cars, board.size, i) === 0) { p++; } }
  return p;
}

var SAMPLE = 20000;
console.log('== 各车数下"零被卡车"通过率（6×6，随机撒车 ' + SAMPLE + ' 次/车数）==');
for (var cc = 5; cc <= 12; cc++) {
  var pass = 0, got = 0, pinSum = 0;
  for (var i = 0; i < SAMPLE; i++) {
    var rng = U.mulberry32((90001 + cc * 7919 + i * 2654435761) % 2147483647);
    var exitRow = Math.floor(rng() * 6);
    var b = RG.generateOne(6, exitRow, cc, rng);
    if (!b) { continue; }
    got++;
    var p = pinnedCount(b);
    pinSum += p;
    if (p === 0) { pass++; }
  }
  console.log('  车数 ' + cc + ': 撒成功 ' + got + '，零被卡 ' + pass +
    '（' + (100 * pass / Math.max(1, got)).toFixed(2) + '%），平均被卡 ' +
    (pinSum / Math.max(1, got)).toFixed(2) + ' 辆');
}

console.log('\n== 高车数 + 零被卡约束下，能拿到的 opt 分布（BFS cap 400k）==');
for (var cc2 = 9; cc2 <= 12; cc2++) {
  var hist = {}, okN = 0, maxOpt = 0, tried = 0;
  for (var k = 0; k < 4000 && okN < 120; k++) {
    var rng2 = U.mulberry32((7717 + cc2 * 104729 + k * 2246822519) % 2147483647);
    var er = Math.floor(rng2() * 6);
    var bb = RG.generateOne(6, er, cc2, rng2);
    if (!bb) { continue; }
    if (pinnedCount(bb) !== 0) { continue; }
    tried++;
    var r = RG.solveCap(bb, 400000);
    if (r.opt === Infinity) { continue; }
    okN++;
    var bucket = r.opt >= 24 ? '24+' : String(r.opt);
    hist[bucket] = (hist[bucket] || 0) + 1;
    if (r.opt > maxOpt) { maxOpt = r.opt; }
  }
  var keys = Object.keys(hist).sort(function (a, b) { return (parseInt(a) || 99) - (parseInt(b) || 99); });
  console.log('  车数 ' + cc2 + ': 试 ' + tried + ' 个零被卡局面，可解 ' + okN +
    '，最大 opt ' + maxOpt + '，分布 ' + keys.map(function (kk) { return kk + ':' + hist[kk]; }).join(' '));
}
