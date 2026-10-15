/* 临时实验 2：分车数看「被卡车数上限」与 opt 分布的关系，找出可行约束 */
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
  return max - min;
}
function pinnedList(board) {
  var out = [];
  for (var i = 0; i < board.cars.length; i++) { if (rangeOf(board.cars, board.size, i) === 0) { out.push(i); } }
  return out;
}

function sweep(carCount, maxPinned, want, label) {
  var hist = {}, okN = 0, maxOpt = 0, tried = 0, solvedSum = 0;
  for (var k = 0; k < 30000 && okN < want; k++) {
    var rng = U.mulberry32((31337 + carCount * 7919 + maxPinned * 104729 + k * 2654435761) % 2147483647);
    var er = Math.floor(rng() * 6);
    var b = RG.generateOne(6, er, carCount, rng);
    if (!b) { continue; }
    if (pinnedList(b).length > maxPinned) { continue; }
    tried++;
    var r = RG.solveCap(b, 400000);
    if (r.opt === Infinity) { continue; }
    okN++; solvedSum += r.opt;
    var bk = r.opt >= 26 ? '26+' : String(r.opt);
    hist[bk] = (hist[bk] || 0) + 1;
    if (r.opt > maxOpt) { maxOpt = r.opt; }
  }
  var keys = Object.keys(hist).sort(function (a, b) { return (parseInt(a) || 99) - (parseInt(b) || 99); });
  console.log('  ' + label + '（车数 ' + carCount + '，被卡≤' + maxPinned + '）：试 ' + tried +
    '，可解 ' + okN + '，最大 opt ' + maxOpt + '，均 ' + (okN ? (solvedSum / okN).toFixed(1) : '-') +
    '\n      ' + keys.map(function (kk) { return kk + ':' + hist[kk]; }).join(' '));
}

console.log('== 宽松档（想覆盖 opt 3~13）==');
[5, 6, 7, 8].forEach(function (cc) { sweep(cc, 0, 150, '零被卡'); });
[7, 8].forEach(function (cc) { sweep(cc, 1, 150, '被卡≤1'); });

console.log('\n== 密档（想覆盖 opt 14~23）==');
[9, 10, 11, 12].forEach(function (cc) { sweep(cc, 2, 120, '被卡≤2'); });
[10, 11, 12].forEach(function (cc) { sweep(cc, 3, 120, '被卡≤3'); });
