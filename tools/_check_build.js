var path = require('path');
var root = path.join(__dirname, '..');
global.BF = {};
require(path.join(root, 'js', 'core', 'ns.js'));
require(path.join(root, 'js', 'game', 'blocks.js'));
var G = BF.BlocksGen, SIZE = G.SIZE;

var fails = 0;
[1, 5, 10, 11, 20, 21, 25, 30, 31, 35, 40].forEach(function (n) {
  var lv = G.build(n);
  // 1) region 在界内
  var cells = G.maskToCells(lv.region);
  var oob = cells.some(function (p) { return p[0] < 0 || p[0] >= SIZE || p[1] < 0 || p[1] >= SIZE; });
  // 2) 颜色一致：每块颜色 ∈ lv.colors
  var badColor = lv.pieces.some(function (q) { return lv.colors.indexOf(G.SHAPES[q.id].c) < 0; });
  // 3) 标准解精确覆盖 region
  var cover = 0n;
  lv.pieces.forEach(function (q) { cover |= G.maskOf(G.PIECE_ROT[q.id][q.rot], q.x, q.y); });
  var covers = (cover === lv.region);
  // 4) 可解（用标准解 pieces 计数应 ≥1）
  var pieceMasks = lv.pieces.map(function (q) { return G.PIECE_PLACE[q.id]; });
  var sols = G.countSolutions(lv.region, pieceMasks);
  var ok = !oob && !badColor && covers && sols >= 1;
  if (!ok) fails++;
  console.log('L' + n + ' cells=' + cells.length + ' colors=' + JSON.stringify(lv.colors) +
    ' pieces=' + lv.pieces.length + ' timed=' + lv.timed + (lv.timed ? '(tl=' + lv.timeLimit + ')' : '') +
    ' sols=' + sols + (oob ? ' OOB!' : '') + (badColor ? ' BADCOLOR!' : '') +
    (covers ? '' : ' NOCOVER!') + (ok ? ' OK' : ' FAIL'));
});
console.log(fails === 0 ? '\n全部通过 ✅' : ('\n失败 ' + fails + ' 关 ❌'));
process.exit(fails ? 1 : 0);
