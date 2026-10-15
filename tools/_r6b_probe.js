/* 探测：升级后的可玩性约束（R6 贴墙死车 + R7 警车可动）下，各档随机撒车能采到多高 opt */
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'js/core/ns.js'));
require(path.join(root, 'js/game/rush.js'));
var RG = BF.RushGen, U = BF.util;
var CARS = [[5, 6], [7, 8], [9, 10], [11, 12]];
var SEED = 20260601, N = 4000;
for (var s = 0; s < CARS.length; s++) {
  var mn = CARS[s][0], mx = CARS[s][1];
  var pass = 0, hist = {}, best = 0, maxCars = 0;
  for (var i = 0; i < N; i++) {
    var rng = U.mulberry32((SEED + s * 777 + i * 2654435761) % 2147483647);
    var exitRow = Math.floor(rng() * 6);
    var cc = mn + Math.floor(rng() * (mx - mn + 1));
    var b = RG.generateOne(6, exitRow, cc, rng);
    if (!b) { continue; }
    if (!RG.isR6(b)) { continue; }
    pass++;
    var r = RG.solveCap(b, 400000);
    if (r.opt === Infinity) { continue; }
    hist[r.opt] = (hist[r.opt] || 0) + 1;
    if (r.opt > best) { best = r.opt; maxCars = b.cars.length; }
  }
  var keys = Object.keys(hist).map(Number).sort(function (a, b) { return a - b; });
  console.log('车数 ' + mn + '-' + mx + '：合格 ' + pass + '/' + N +
    '，opt 最大 ' + best + '（' + maxCars + ' 车）');
  console.log('   直方 ' + keys.map(function (k) { return k + ':' + hist[k]; }).join(' '));
}
