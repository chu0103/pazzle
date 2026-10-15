/* 临时实验 3：规则 R6 = 初始被卡的车不许是"贴墙被夹"型（必须左右/上下都是车）。
   统计各车数通过率，以及密档下 R6 是否还留得住高 opt。 */
var path = require('path');
var root = 'C:/Users/admin/WorkBuddy/2026-09-30-08-41-53/puzzle-arcade';
require(path.join(root, 'js/core/ns.js'));
require(path.join(root, 'js/game/rush.js'));
var BF = globalThis.BF, RG = BF.RushGen, U = BF.util;

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
  return { min: min, max: max };
}
/** 贴墙被夹的车：被卡死且"唯一可行方向"是墙外 */
function wallPinned(board, i) {
  var c = board.cars[i], size = board.size;
  var p = c.horiz ? c.x : c.y, Lc = c.len;
  var r = rangeOf(board.cars, size, i);
  if (r.min !== r.max) { return false; }          // 能滑
  var bothOpen = (p > 0) && (p < size - Lc);      // 两头都在盘内 → 属于"被车夹住"
  return !bothOpen;
}
function wallPinnedCount(board) {
  var n = 0;
  for (var i = 0; i < board.cars.length; i++) { if (wallPinned(board, i)) { n++; } }
  return n;
}
function pinnedCount(board) {
  var n = 0;
  for (var i = 0; i < board.cars.length; i++) {
    var r = rangeOf(board.cars, board.size, i);
    if (r.min === r.max) { n++; }
  }
  return n;
}

var SAMPLE = 30000;
console.log('== R6（无"贴墙被夹"车）通过率 ==');
for (var cc = 5; cc <= 12; cc++) {
  var pass = 0, got = 0, pinSum = 0, pinPassSum = 0;
  for (var i = 0; i < SAMPLE; i++) {
    var rng = U.mulberry32((50501 + cc * 7919 + i * 2654435761) % 2147483647);
    var b = RG.generateOne(6, Math.floor(rng() * 6), cc, rng);
    if (!b) { continue; }
    got++;
    var wp = wallPinnedCount(b);
    if (wp === 0) { pass++; pinPassSum += pinnedCount(b); }
    pinSum += pinnedCount(b);
  }
  console.log('  车数 ' + cc + ': 通过 ' + pass + '/' + got + '（' + (100 * pass / got).toFixed(2) +
    '%），通过样本平均被卡 ' + (pass ? (pinPassSum / pass).toFixed(2) : '-') + ' 辆（全体均 ' + (pinSum / got).toFixed(2) + '）');
}

console.log('\n== R6 下密档 opt 上限 ==');
[9, 10, 11, 12].forEach(function (cc2) {
  var hist = {}, okN = 0, maxOpt = 0, tried = 0;
  for (var k = 0; k < 60000 && okN < 130; k++) {
    var rng2 = U.mulberry32((881 + cc2 * 104729 + k * 2246822519) % 2147483647);
    var bb = RG.generateOne(6, Math.floor(rng2() * 6), cc2, rng2);
    if (!bb) { continue; }
    if (wallPinnedCount(bb) !== 0) { continue; }
    tried++;
    var r = RG.solveCap(bb, 400000);
    if (r.opt === Infinity) { continue; }
    okN++;
    var bk = r.opt >= 26 ? '26+' : String(r.opt);
    hist[bk] = (hist[bk] || 0) + 1;
    if (r.opt > maxOpt) { maxOpt = r.opt; }
  }
  var keys = Object.keys(hist).sort(function (a, b) { return (parseInt(a) || 99) - (parseInt(b) || 99); });
  console.log('  车数 ' + cc2 + ': 通过筛选 ' + tried + '，可解 ' + okN + '，最大 opt ' + maxOpt +
    '\n      ' + keys.map(function (kk) { return kk + ':' + hist[kk]; }).join(' '));
});
