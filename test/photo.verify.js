/**
 * photo.verify.js —— 游戏 3「照片拼图」关卡校验
 *
 * 检查 60 关的：难度曲线、块数、切片区域（覆盖整图且不重叠）、
 * 每关都配到了照片、按答案摆回去能过关、**放错位置不算过关**、
 * 每日挑战可复现、同一关重复构建结果稳定。
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
var sandbox = { console: console, Math: Math, Date: Date, JSON: JSON, Array: Array, String: String };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}

load('js/core/ns.js');
load('js/core/palette.js');
load('js/core/draw.js');

sandbox.BF.platform = {
  width: 390, height: 844, dpr: 2, safeTop: 0, safeBottom: 0,
  createImage: function (src, cb) { cb(null, { src: src, width: 720, height: 720 }); },
  chooseImage: function (cb) { cb(new Error('无头环境不支持选图')); },
  vibrate: function () {},
  now: function () { return Date.now(); },
  requestFrame: function () {}
};

load('js/core/save.js');
load('js/game/generator.js');
load('js/game/logic.js');
load('js/game/photoAssets.js');
load('js/game/photo.js');
load('js/game/model.js');

var BF = sandbox.BF;
var fails = [];
function check(cond, msg) { if (!cond) { fails.push(msg); } }

var meta = BF.games.photo;
check(!!meta, '照片拼图没有注册进 BF.games');
check(!!BF.Photos && BF.Photos.all().length > 0,
  '没有内置照片（先跑 python tools/process_photos.py 你的图.jpg）');

/* 期望的难度曲线：3×3 起步，逐级到 8×8 */
function expectSize(n) {
  if (n <= 8) { return 3; }
  if (n <= 18) { return 4; }
  if (n <= 30) { return 5; }
  if (n <= 42) { return 6; }
  if (n <= 52) { return 7; }
  return 8;
}

var t0 = Date.now();
var sizeHist = {};

for (var n = 1; n <= meta.TOTAL; n++) {
  var pz = meta.build(n);
  var want = expectSize(n);
  sizeHist[pz.size] = (sizeHist[pz.size] || 0) + 1;

  check(pz.size === want, '第 ' + n + ' 关应为 ' + want + '×' + want + '，实际 ' + pz.size);
  check(pz.pieces.length === pz.size * pz.size,
    '第 ' + n + ' 关块数应为 ' + (pz.size * pz.size) + '，实际 ' + pz.pieces.length);
  check(!!(pz.photo && pz.photo.src), '第 ' + n + ' 关没有配到照片');
  check(pz.strict === true, '第 ' + n + ' 关必须是严格判定（每块要回到原位）');

  // 每块 1×1，且切片区域覆盖整图、互不重叠
  var seen = {}, dup = 0, oob = 0, badArea = 0;
  var sumArea = 0;
  for (var i = 0; i < pz.pieces.length; i++) {
    var p = pz.pieces[i];
    if (p.w !== 1 || p.h !== 1) { badArea++; continue; }
    var key = p.x + ':' + p.y;
    if (seen[key]) { dup++; }
    seen[key] = 1;
    if (p.x < 0 || p.y < 0 || p.x >= pz.size || p.y >= pz.size) { oob++; }
    // 归一化切片：必须和格子位置一一对应
    var eu = p.x / pz.size, ev = p.y / pz.size, ew = 1 / pz.size;
    if (Math.abs(p.u - eu) > 1e-9 || Math.abs(p.v - ev) > 1e-9 ||
        Math.abs(p.uw - ew) > 1e-9 || Math.abs(p.vh - ew) > 1e-9) {
      badArea++;
    }
    sumArea += p.uw * p.vh;
  }
  check(dup === 0, '第 ' + n + ' 关有 ' + dup + ' 个重复的格子位置');
  check(oob === 0, '第 ' + n + ' 关有 ' + oob + ' 块越界');
  check(badArea === 0, '第 ' + n + ' 关有 ' + badArea + ' 块的尺寸或切片区域不对');
  check(Math.abs(sumArea - 1) < 1e-9,
    '第 ' + n + ' 关所有切片面积之和应为 1（覆盖整张照片），实际 ' + sumArea.toFixed(6));

  // 托盘顺序必须是"全排列"（每块恰好出现一次）
  var oc = {};
  for (i = 0; i < pz.order.length; i++) { oc[pz.order[i]] = (oc[pz.order[i]] || 0) + 1; }
  var orderBad = 0;
  for (i = 0; i < pz.pieces.length; i++) { if (oc[i] !== 1) { orderBad++; } }
  check(orderBad === 0, '第 ' + n + ' 关托盘顺序不是完整排列（' + orderBad + ' 块异常）');

  // 按标准答案摆回去 → 必须判定过关
  var m = new BF.Model(pz);
  for (i = 0; i < m.pieces.length; i++) {
    m.place(m.pieces[i], m.pieces[i].solX, m.pieces[i].solY);
  }
  check(m.isSolved(), '第 ' + n + ' 关按答案摆完却没判过关');
  check(m.misplaced() === 0, '第 ' + n + ' 关按答案摆完仍有块被判为错位');
}

/* 严格判定：故意交换两块 → 填满了也不能过关 */
(function () {
  var pz = meta.build(20);
  var m = new BF.Model(pz);
  for (var i = 0; i < m.pieces.length; i++) {
    m.place(m.pieces[i], m.pieces[i].solX, m.pieces[i].solY);
  }
  check(m.isSolved(), '基准：摆对应过关');
  // 把 0 号和 1 号拿起来互换
  var a = m.pieces[0], b = m.pieces[1];
  m.lift(a); m.lift(b);
  m.place(a, b.solX, b.solY);
  m.place(b, a.solX, a.solY);
  check(m.filled() === m.area, '互换后棋盘应该仍是填满的');
  check(!m.isSolved(), '照片拼图：填满但有块错位，不该判过关（strict 没生效）');
  check(m.misplaced() === 2, '互换两块应判 2 块错位，实际 ' + m.misplaced());

  // 提示要优先指向错位的块，而不是返回 null
  var h = m.hint();
  check(!!h && h.wrong === true, '全部放置但有错位时，提示应指向错位的块');
})();

/* 每日挑战：同一天两次必须一致；不同天应当不同 */
(function () {
  var d = new Date(2026, 9, 8);
  var a = meta.buildDaily(d), b = meta.buildDaily(d);
  var same = a.pieces.length === b.pieces.length && a.photo.src === b.photo.src;
  for (var i = 0; i < a.order.length; i++) { if (a.order[i] !== b.order[i]) { same = false; } }
  check(same, '同一天的每日挑战两次构建结果不一致');
  var c = meta.buildDaily(new Date(2026, 9, 9));
  var diff = false;
  for (i = 0; i < c.order.length; i++) { if (c.order[i] !== a.order[i]) { diff = true; break; } }
  check(diff, '不同日期的每日挑战不应完全一样');

  var m = new BF.Model(a);
  for (i = 0; i < m.pieces.length; i++) { m.place(m.pieces[i], m.pieces[i].solX, m.pieces[i].solY); }
  check(m.isSolved(), '每日挑战按答案摆完没判过关');
})();

/* 稳定性：同一关重复构建必须完全一样（seed 决定，不能每次进来都变题） */
(function () {
  var a = meta.build(33), b = meta.build(33);
  var ok = a.photo.src === b.photo.src;
  for (var i = 0; i < a.order.length; i++) { if (a.order[i] !== b.order[i]) { ok = false; } }
  check(ok, '第 33 关重复构建结果不一致（题面会跳变）');
})();

/* 难度入口（关卡页的"难度"快捷条依赖这两个字段）：档位齐全、firstLevelOfSize 映射正确 */
(function () {
  check(!!meta.difficulties && meta.difficulties.length === 6,
    '照片拼图难度档位应为 6 个（3×3~8×8），实际 ' + (meta.difficulties ? meta.difficulties.length : 0));
  check(!!meta.bands && meta.bands.length === 6, '照片拼图 bands 缺失');
  var expectFrom = { 3: 1, 4: 9, 5: 19, 6: 31, 7: 43, 8: 53 };
  for (var sz = 3; sz <= 8; sz++) {
    var lvl = meta.firstLevelOfSize(sz);
    check(lvl === expectFrom[sz],
      'firstLevelOfSize(' + sz + ') 应为 ' + expectFrom[sz] + '，实际 ' + lvl);
    var pz = meta.build(lvl);
    check(pz.size === sz, '难度 ' + sz + '×' + sz + ' 对应的第 ' + lvl + ' 关实际是 ' + pz.size + '×' + pz.size);
  }
})();

/* 难度分布一目了然 */
var dist = Object.keys(sizeHist).sort().map(function (k) {
  return k + '×' + k + ':' + sizeHist[k] + '关';
}).join('  ');

if (fails.length) {
  console.log('❌ 失败 ' + fails.length + ' 项:');
  fails.slice(0, 12).forEach(function (f) { console.log('   - ' + f); });
  if (fails.length > 12) { console.log('   ... 还有 ' + (fails.length - 12) + ' 项'); }
  process.exit(1);
} else {
  console.log('✅ 照片拼图：' + meta.TOTAL + ' 关全部合规');
  console.log('   难度分布  ' + dist);
  console.log('   内置照片  ' + BF.Photos.all().length + ' 张');
  console.log('   已验证    切片覆盖整图且不重叠 / 按答案可过关 / 错位不过关 / 每日可复现 / 同关稳定');
  console.log('   耗时      ' + (Date.now() - t0) + 'ms');
}
