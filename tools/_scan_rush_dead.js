/* 临时诊断：扫描 20 关里"动不了的车"（初始就被卡死的 / 在整个可达状态空间里从没动过的） */
var path = require('path');
var root = 'C:/Users/admin/WorkBuddy/2026-09-30-08-41-53/puzzle-arcade';
require(path.join(root, 'js/core/ns.js'));
require(path.join(root, 'js/game/rush.js'));
var BF = globalThis.BF, RG = BF.RushGen;

function cellsOf(c, p, size) {
  var out = [], k;
  if (c.horiz) { for (k = 0; k < c.len; k++) { out.push(c.y * size + (p + k)); } }
  else { for (k = 0; k < c.len; k++) { out.push((p + k) * size + c.x); } }
  return out;
}
function occOf(cars, pos, size) {
  var occ = new Array(size * size);
  for (var i = 0; i < occ.length; i++) { occ[i] = false; }
  for (i = 0; i < cars.length; i++) {
    var cl = cellsOf(cars[i], pos[i], size);
    for (var j = 0; j < cl.length; j++) { occ[cl[j]] = true; }
  }
  return occ;
}
function legalRange(cars, size, i, pos) {
  var c = cars[i], Lc = c.len;
  var cpos = pos ? pos[i] : (c.horiz ? c.x : c.y);
  var cfix = c.horiz ? c.y : c.x;
  var min = 0, max = size - Lc;
  for (var j = 0; j < cars.length; j++) {
    if (j === i) { continue; }
    var o = cars[j];
    var opos = pos ? pos[j] : (o.horiz ? o.x : o.y);
    var ofix = o.horiz ? o.y : o.x;
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

/** 可达状态空间里，每辆车有没有"能动"过 */
function everMovable(board, cap) {
  var size = board.size, cars = board.cars, n = cars.length, base = size;
  var start = 0;
  for (var i = 0; i < n; i++) { start = start * base + (cars[i].horiz ? cars[i].x : cars[i].y); }
  var can = new Array(n); for (i = 0; i < n; i++) { can[i] = false; }
  var seen = {}, queue = [start], head = 0, visited = 0;
  seen[start] = true;
  function decode(s) { var p = new Array(n); for (var k = n - 1; k >= 0; k--) { p[k] = s % base; s = Math.floor(s / base); } return p; }
  while (head < queue.length && visited < cap) {
    visited++;
    var s2 = queue[head++], pos = decode(s2);
    var occ = occOf(cars, pos, size);
    for (i = 0; i < n; i++) {
      var c = cars[i], own = cellsOf(c, pos[i], size), Lc = c.len, hi = size - Lc;
      var o2 = occ.slice();
      for (var q = 0; q < own.length; q++) { o2[own[q]] = false; }
      for (var dir = -1; dir <= 1; dir += 2) {
        for (var st = 1; ; st++) {
          var np = pos[i] + dir * st;
          if (np < 0 || np > hi) { break; }
          var cl = cellsOf(c, np, size), bad = false;
          for (var m = 0; m < cl.length; m++) { if (o2[cl[m]]) { bad = true; break; } }
          if (bad) { break; }
          can[i] = true;
          var p2 = pos.slice(); p2[i] = np;
          var k2 = 0; for (var z = 0; z < n; z++) { k2 = k2 * base + p2[z]; }
          if (!seen[k2]) { seen[k2] = true; queue.push(k2); }
        }
      }
    }
  }
  return { can: can, visited: visited };
}

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

var CAP = 200000;
var totalDead = 0, initPinned = 0;
for (var n = 1; n <= RG.LEVELS.length; n++) {
  var b = RG.build(n);
  var em = everMovable(b, CAP);
  var pinnedNow = [], dead = [];
  for (var i = 0; i < b.cars.length; i++) {
    var r = legalRange(b.cars, b.size, i);
    if (r.min === r.max) { pinnedNow.push(i); }
    if (!em.can[i]) { dead.push(i); }
  }
  totalDead += dead.length; initPinned += pinnedNow.length;
  console.log('L' + n + '  opt=' + b.opt + '  e=' + b.exitRow + '  车=' + b.cars.length +
    '  初始被卡=' + (pinnedNow.length ? pinnedNow.join(',') : '无') +
    '  全程没动=' + (dead.length ? dead.join(',') : '无') +
    (em.visited >= CAP ? '  (触及状态上限)' : ''));
  if (pinnedNow.length) { console.log(grid(b)); }
}
console.log('合计：初始被卡 ' + initPinned + ' 辆，全程没动 ' + totalDead + ' 辆');
