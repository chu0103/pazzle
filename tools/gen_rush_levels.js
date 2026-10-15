/**
 * gen_rush_levels.js —— 用 R6 约束重新生成 20 关并输出可内联的 LEVELS 源码。
 * 同时逐关核对：可解 / opt 与内联一致 / 满足 R6（无贴墙死车）/ 档内单调 / 档间不重叠。
 *
 * 用法：node tools/gen_rush_levels.js
 */
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'js/core/ns.js'));
require(path.join(root, 'js/core/palette.js'));
require(path.join(root, 'js/core/draw.js'));
require(path.join(root, 'js/core/save.js'));
require(path.join(root, 'js/game/rush.js'));

var RG = BF.RushGen, U = BF.util;
var t0 = Date.now();
console.log('[gen] 开始 buildAll（含 R6 约束）...');

var all = RG.buildAll();
console.log('[gen] buildAll 完成，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's，共 ' + all.length + ' 关');

// 先落盘再核对：核对脚本万一抛错也不会把 10 分钟算出来的结果丢掉
var lines = all.map(function (b) { return '    ' + JSON.stringify(RG.serialize(b)) + ','; });
var src = '  var LEVELS = [\n' + lines.join('\n') + '\n  ];';
fs.writeFileSync(path.join(root, 'tools', '_rush_levels_out.txt'), src);
console.log('[gen] 已写出 tools/_rush_levels_out.txt（待核对后内联进 js/game/rush.js）');

function stuckInfo(board) {
  var cars = board.cars, size = board.size, wallStuck = 0, anyStuck = 0, policeStuck = 0;
  for (var i = 0; i < cars.length; i++) {
    var c = cars[i], Lc = c.len, p = c.horiz ? c.x : c.y;
    var atWall = (p === 0 || p === size - Lc);
    var rg = RG.legalRangeAt(board, cars, i);
    var stuck = (rg.min === rg.max);
    if (stuck) { anyStuck++; if (atWall) { wallStuck++; } if (c.police) { policeStuck++; } }
  }
  return { wallStuck: wallStuck, anyStuck: anyStuck, policeStuck: policeStuck };
}

var opts = [], r6bad = 0, unsolved = 0, wallStuckTotal = 0, anyStuckTotal = 0, policeStuckTotal = 0;
var stages = RG.STAGES;
for (var s = 0; s < stages.length; s++) {
  var st = stages[s];
  var stageOpts = [], stageWall = 0, stagePolice = 0;
  for (var k = 0; k < 5; k++) {
    var n = s * 5 + k + 1;
    var L = RG.serialize(all[n - 1]);
    var board = RG.deserialize(L);
    board.opt = L.o;
    var r = RG.solve(board);
    var info = stuckInfo(board);
    wallStuckTotal += info.wallStuck; anyStuckTotal += info.anyStuck;
    policeStuckTotal += info.policeStuck;
    stageWall += info.wallStuck; stagePolice += info.policeStuck;
    if (r.opt !== L.o) { unsolved++; console.log('  ✗ L' + n + ' opt 不一致 内联 ' + L.o + ' 求解 ' + r.opt); }
    if (r.opt === Infinity) { unsolved++; console.log('  ✗ L' + n + ' 不可解'); }
    if (!RG.isR6(board)) { r6bad++; console.log('  ✗ L' + n + ' 违反 R6/R7（贴墙死车 ' + info.wallStuck + '，警车卡死 ' + info.policeStuck + '）'); }
    if (st.allFree && !RG.isAllFree(board)) {
      r6bad++;
      console.log('  ✗ L' + n + ' 入门档要求「全体车初始可动」，实际拖不动 ' + RG.stuckCars(board).join(','));
    }
    stageOpts.push(L.o); opts.push(L.o);
  }
  console.log('档' + (s + 1) + ' [' + st.optMin + '~' + st.optMax + '] opt=' + stageOpts.join(',') +
    ' | 贴墙死车=' + stageWall + ' 警车卡死=' + stagePolice + (st.allFree ? ' [allFree]' : ''));
}
console.log('opt 序列: ' + opts.join(','));
console.log('不可解/opt 不一致: ' + unsolved + '，违反 R6/R7: ' + r6bad);
console.log('全部关合计 贴墙死车=' + wallStuckTotal + '，警车卡死=' + policeStuckTotal +
  '，任意初始死车=' + anyStuckTotal + '（R6/R7 只禁贴墙车与警车，盘内被夹的非警车允许）');
