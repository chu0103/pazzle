/* 临时实验 4：R6（无"贴墙被夹"车）下，各车数能拿到的 opt 上限（够大样本） */
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
function hasWallPinned(board) {
  var size = board.size;
  for (var i = 0; i < board.cars.length; i++) {
    var c = board.cars[i], p = c.horiz ? c.x : c.y, Lc = c.len;
    var r = rangeOf(board.cars, size, i);
    if (r.min !== r.max) { continue; }
    if (!(p > 0 && p < size - Lc)) { return true; }   // 贴墙被夹
  }
  return false;
}

var WANT = 250;
for (var cc = 7; cc <= 12; cc++) {
  var opts = [], tries = 0, pass = 0, cap = 400000;
  while (pass < WANT && tries < 400000) {
    tries++;
    var rng = U.mulberry32((61001 + cc * 7919 + tries * 2654435761) % 2147483647);
    var b = RG.generateOne(6, Math.floor(rng() * 6), cc, rng);
    if (!b) { continue; }
    if (hasWallPinned(b)) { continue; }
    pass++;
    var r = RG.solveCap(b, cap);
    if (r.opt === Infinity) { continue; }
    opts.push(r.opt);
  }
  opts.sort(function (a, b) { return a - b; });
  var hist = {};
  opts.forEach(function (o) { var k = o >= 30 ? '30+' : String(o); hist[k] = (hist[k] || 0) + 1; });
  var keys = Object.keys(hist).sort(function (a, b) { return (parseInt(a) || 99) - (parseInt(b) || 99); });
  console.log('车数 ' + cc + '：R6 通过 ' + pass + ' 个（采样 ' + tries + '），可解 ' + opts.length +
    '，opt 中位 ' + (opts.length ? opts[Math.floor(opts.length / 2)] : '-') + '，最大 ' + (opts.length ? opts[opts.length - 1] : '-'));
  console.log('   ' + keys.map(function (k) { return k + ':' + hist[k]; }).join(' '));
}
