/**
 * picross.verify.js —— 数织「数据层」回归测试（node test/picross.verify.js）
 *
 * 覆盖（与 tools/_verify_picross_logic.js 互补，那份跑场景交互）：
 *   - 关卡存储：40 关、base-36 每格一字符、尺寸与档位吻合、字符合法；
 *   - 编解码 round-trip：encodeGrid(decodeGrid(g)) === g；
 *   - 线索自洽：用**独立实现**的 runs() 复核 cluesFor（行/列），
 *     并核对「线索段数/总长/颜色」与该行实际填法一一对应；
 *   - 解本身合法：把整行按已知状态喂给 lineOptions，只能推出唯一填法且等于真解；
 *   - 唯一解：每一关 solveCount(全未知, cap=2) === 1（数织大忌是多解）；
 *   - 求解器不是恒真：手工构造 2 解盘 / 0 解盘，断言解数精确；
 *   - 求解器不改入参；
 *   - 难度：尺寸严格递增 [5,10,12,15]、每档最大色数不减 [3,4,5,5]、色数不超档位上限；
 *   - 确定性：同关两次 build 逐字段一致；同一天两次 buildDaily 一致（tier/尺寸/取自 21-30）；
 *   - 星级：阈值档间严格递增、边界值正确、越界档位夹住；
 *   - tierLevels：四档并集恰为 1..40、两两不交、每档 10 关；
 *   - 注册表字段：scene/TOTAL/difficulties/chipLabel/pickInfo。
 * 不依赖画布，纯 node 跑数据层。失败 process.exit(1)。
 */
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'js/core/ns.js'));
require(path.join(root, 'js/core/palette.js'));
require(path.join(root, 'js/core/draw.js'));
require(path.join(root, 'js/core/save.js'));
require(path.join(root, 'js/game/picross.js'));

var G = BF.PicrossGen;
var meta = BF.games.picross;

var fail = 0;
function ok(cond, msg) { if (!cond) { console.log('  ✗ ' + msg); fail++; } }

/* ---------- 0. 调色板 ---------- */
(function () {
  ok(G.PALETTE.length === 10, '调色板应有 10 色，实际 ' + G.PALETTE.length);
  var hexes = {};
  for (var i = 0; i < G.PALETTE.length; i++) {
    var p = G.PALETTE[i];
    ok(/^#[0-9A-Fa-f]{6}$/.test(p.hex), '第 ' + i + ' 色 hex 不合法：' + p.hex);
    ok(!!p.name && p.name.length <= 2, '第 ' + i + ' 色名称应为 1-2 个汉字：' + p.name);
    ok(!hexes[p.hex], '调色板 hex 重复：' + p.hex);
    hexes[p.hex] = 1;
    ok(G.PALETTE_HEX[i] === p.hex && G.PALETTE_NAME[i] === p.name, 'PALETTE_HEX/NAME 与 PALETTE 不一致 @' + i);
  }
})();

/* ---------- 1. 关卡存储 ---------- */
(function () {
  ok(Array.isArray(G.LEVELS) && G.LEVELS.length === 40, 'LEVELS 应有 40 关，实际 ' + (G.LEVELS || []).length);
  var sizeSeen = [];
  for (var i = 0; i < G.LEVELS.length; i++) {
    var lv = G.LEVELS[i], n = i + 1, t = (i / 10) | 0;
    ok(lv.n === G.TIER_SIZE[t], '第 ' + n + ' 关尺寸应为 ' + G.TIER_SIZE[t] + '，实际 ' + lv.n);
    ok(typeof lv.g === 'string' && lv.g.length === lv.n * lv.n,
      '第 ' + n + ' 关数据串长度应为 ' + (lv.n * lv.n) + '，实际 ' + (lv.g || '').length);
    for (var k = 0; k < lv.g.length; k++) {
      var ch = lv.g[k];
      ok(ch === '-' || (ch >= '0' && ch <= '9'), '第 ' + n + ' 关第 ' + k + ' 格字符非法：' + ch);
      if (fail > 3) { return; }
    }
    ok(typeof lv.name === 'string' && lv.name.length > 0, '第 ' + n + ' 关缺少图案名');
    if (sizeSeen.indexOf(lv.n) < 0) { sizeSeen.push(lv.n); }
  }
  var asc = true;
  for (var s = 1; s < sizeSeen.length; s++) { if (sizeSeen[s] <= sizeSeen[s - 1]) { asc = false; } }
  ok(asc, '关卡尺寸应随档严格递增，实际 ' + sizeSeen.join(','));
})();

/* ---------- 2. 编解码 ---------- */
(function () {
  // 注意：encodeGrid 把「未填(-1)」和「确定空(-2)」都编成 '-'（存档/存储都只关心已知信息）
  ok(G.encodeGrid([-2, -1, 0, 5, 9, 10, 35]) === '--059az', 'encodeGrid 编得不对：' + G.encodeGrid([-2, -1, 0, 5, 9, 10, 35]));
  ok(JSON.stringify(G.decodeGrid('--059az')) === JSON.stringify([-2, -2, 0, 5, 9, 10, 35]), 'decodeGrid 解得不对');
  for (var i = 0; i < G.LEVELS.length; i++) {
    var lv = G.LEVELS[i];
    ok(G.encodeGrid(G.decodeGrid(lv.g)) === lv.g, '第 ' + (i + 1) + ' 关编解码 round-trip 失败');
  }
})();

/* ---------- 3. 线索自洽（独立 runs 实现复核） ---------- */
function runsIndependent(line) {
  var out = [], i = 0;
  while (i < line.length) {
    if (line[i] < 0) { i++; continue; }
    var j = i;
    while (j < line.length && line[j] === line[i]) { j++; }
    out.push([line[i], j - i]);
    i = j;
  }
  return out;
}
function sameClue(a, b) {
  if (a.length !== b.length) { return false; }
  for (var i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) { return false; }
  }
  return true;
}
(function () {
  for (var i = 0; i < G.LEVELS.length; i++) {
    var lv = G.LEVELS[i], n = i + 1;
    var cells = G.decodeGrid(lv.g);
    var cl = G.cluesFor(cells, lv.n);
    ok(cl.rows.length === lv.n && cl.cols.length === lv.n, '第 ' + n + ' 关线索行列数应为 ' + lv.n);
    for (var r = 0; r < lv.n; r++) {
      var row = cells.slice(r * lv.n, r * lv.n + lv.n);
      ok(sameClue(cl.rows[r], runsIndependent(row)), '第 ' + n + ' 关第 ' + r + ' 行线索与独立实现不一致');
      var filled = 0, seg = 0;
      for (var k = 0; k < row.length; k++) { if (row[k] >= 0) { filled++; } }
      for (k = 0; k < cl.rows[r].length; k++) {
        seg += cl.rows[r][k][1];
        ok(row.indexOf(cl.rows[r][k][0]) >= 0, '第 ' + n + ' 关第 ' + r + ' 行线索颜色 ' + cl.rows[r][k][0] + ' 不在该行');
      }
      ok(seg === filled, '第 ' + n + ' 关第 ' + r + ' 行线索总长 ' + seg + ' ≠ 填色格数 ' + filled);
    }
    for (var c = 0; c < lv.n; c++) {
      var col = [];
      for (r = 0; r < lv.n; r++) { col.push(cells[r * lv.n + c]); }
      ok(sameClue(cl.cols[c], runsIndependent(col)), '第 ' + n + ' 关第 ' + c + ' 列线索与独立实现不一致');
    }
    if (fail > 3) { return; }
  }
})();

/* ---------- 4. 解本身合法 + 唯一解 ---------- */
(function () {
  for (var i = 0; i < G.LEVELS.length; i++) {
    var lv = G.LEVELS[i], n = i + 1;
    var cells = G.decodeGrid(lv.g);
    var cl = G.cluesFor(cells, lv.n);
    // 4a. 整行按「已知状态」喂求解器：只能推出唯一填法，且就是真解
    for (var r = 0; r < lv.n; r++) {
      var row = cells.slice(r * lv.n, r * lv.n + lv.n);
      var opts = G.lineOptions(row, cl.rows[r]);
      ok(opts.length === 1, '第 ' + n + ' 关第 ' + r + ' 行真解应唯一合法，实际 ' + opts.length + ' 种');
      if (opts.length === 1) {
        for (var k = 0; k < lv.n; k++) {
          ok(opts[0][k] === (row[k] >= 0 ? row[k] : -2),
            '第 ' + n + ' 关第 ' + r + ' 行第 ' + k + ' 格 lineOptions 结果与真解不符');
        }
      }
      if (fail > 3) { return; }
    }
    // 4b. 从全未知出发只能数出 1 个解
    var blank = [];
    for (k = 0; k < cells.length; k++) { blank.push(-1); }
    var frozen = blank.slice();
    ok(G.solveCount(blank, lv.n, cl.rows, cl.cols, 2) === 1,
      '第 ' + n + ' 关应为唯一解，实际解数 ' + G.solveCount(blank, lv.n, cl.rows, cl.cols, 2));
    ok(JSON.stringify(blank) === JSON.stringify(frozen), '第 ' + n + ' 关 solveCount 改了入参');
    ok(G.isUnique(lv) === true, '第 ' + n + ' 关 isUnique 应为真');
    if (fail > 3) { return; }
  }
})();

/* ---------- 5. 求解器不是恒真 ---------- */
(function () {
  // 2 解盘：2×2，每行每列各一段红1 → 两种对角放法
  var two = G.solveCount([-1, -1, -1, -1], 2, [[[0, 1]], [[0, 1]]], [[[0, 1]], [[0, 1]]], 5);
  ok(two === 2, '2×2 对角盘应数出 2 个解，实际 ' + two);
  // 0 解盘：行要全红、列只要一段红1 → 矛盾
  var zero = G.solveCount([-1, -1, -1, -1], 2, [[[0, 2]], [[0, 2]]], [[[0, 1]], [[0, 1]]], 5);
  ok(zero === 0, '矛盾盘应数出 0 个解，实际 ' + zero);
  // 空行线索：全空行只能全 -2
  var opts = G.lineOptions([-1, -1, -1], []);
  ok(opts.length === 1 && opts[0].join(',') === '-2,-2,-2', '空线索行应唯一推出全空，实际 ' + JSON.stringify(opts));
  // 空线索 + 已填色 → 无解
  ok(G.lineOptions([0, -1, -1], []).length === 0, '空线索行里出现已填色应无解');
  // cap 语义：cap=1 时数到 1 就停
  ok(G.solveCount([-1, -1, -1, -1], 2, [[[0, 1]], [[0, 1]]], [[[0, 1]], [[0, 1]]], 1) === 1, 'cap=1 应停在 1');
})();

/* ---------- 6. 色数与难度 ---------- */
(function () {
  var prevSize = 0, prevMax = 0;
  for (var t = 0; t < 4; t++) {
    var lv = G.tierLevels(G.TIER_NAMES[t]);
    ok(lv.length === 10, G.TIER_NAMES[t] + ' 档应有 10 关');
    var mx = 0;
    for (var i = 0; i < lv.length; i++) {
      var c = G.colorsUsed(lv[i]);
      ok(c >= 1 && c <= G.TIER_COLORS[t],
        '第 ' + lv[i] + ' 关色数 ' + c + ' 应在 [1,' + G.TIER_COLORS[t] + ']');
      mx = Math.max(mx, c);
      ok(G.decodeGrid(G.LEVELS[lv[i] - 1].g).length === G.TIER_SIZE[t] * G.TIER_SIZE[t],
        '第 ' + lv[i] + ' 关格子数应与尺寸一致');
    }
    ok(G.TIER_SIZE[t] > prevSize, '尺寸应严格递增 @' + G.TIER_NAMES[t]);
    ok(mx >= prevMax, '最大色数应不减 @' + G.TIER_NAMES[t] + '：' + mx + ' < ' + prevMax);
    prevSize = G.TIER_SIZE[t];
    prevMax = mx;
  }
})();

/* ---------- 7. 确定性 + 每日 ---------- */
(function () {
  var a = G.build(7), b = G.build(7);
  ok(JSON.stringify(a) === JSON.stringify(b), '同关两次 build 应逐字段一致');
  ok(a.id === 'picross' && a.level === 7 && a.tier === 0 && a.tierName === '入门' &&
     a.n === 5 && a.daily === false && Array.isArray(a.cells) && a.cells.length === 25,
    'build(7) 字段不对：' + JSON.stringify({ level: a.level, tier: a.tier, n: a.n }));
  var threw = false;
  try { G.build(0); } catch (e) { threw = true; }
  ok(threw, 'build(0) 应抛错');
  threw = false;
  try { G.build(41); } catch (e) { threw = true; }
  ok(threw, 'build(41) 应抛错');

  var d1 = G.buildDaily(), d2 = G.buildDaily();
  ok(JSON.stringify(d1) === JSON.stringify(d2), '同一天两次 buildDaily 应一致');
  ok(d1.daily === true && d1.level === 0, '每日挑战应带 daily 标记且 level=0');
  ok(d1.tier === G.DAILY_TIER && d1.n === G.TIER_SIZE[G.DAILY_TIER],
    '每日挑战应取困难档尺寸，实际 tier=' + d1.tier + ' n=' + d1.n);
  var src = -1;
  for (var k = 0; k < G.LEVELS.length; k++) {
    if (G.LEVELS[k].g === G.encodeGrid(d1.cells)) { src = k + 1; }
  }
  ok(src >= 21 && src <= 30, '每日挑战应取自困难档 21-30 关，实际第 ' + src + ' 关');
})();

/* ---------- 8. 星级 ---------- */
(function () {
  var prev = null;
  for (var t = 0; t < 4; t++) {
    var th = G.thresholdsFor(t);
    ok(th.length === 2 && th[0] > 0 && th[1] > th[0], '第 ' + t + ' 档阈值应满足 0 < t3 < t2');
    if (prev) { ok(th[0] > prev[0] && th[1] > prev[1], '阈值应随档位递增'); }
    prev = th;
    ok(G.starsFor(t, th[0]) === 3, 't3 整应给 3★');
    ok(G.starsFor(t, th[0] + 1) === 2, '刚超 t3 应给 2★');
    ok(G.starsFor(t, th[1] + 1) === 1, '刚超 t2 应给 1★');
    ok(G.starsFor(t, 0) === 3, '0 毫秒应给 3★');
  }
  ok(G.starsFor(-1, 0) === 3 && G.starsFor(9, 0) === 3, '越界档位应被夹住');
})();

/* ---------- 9. tierLevels / 文案钩子 ---------- */
(function () {
  var seen = {};
  for (var t = 0; t < 4; t++) {
    var lv = G.tierLevels(G.TIER_NAMES[t]);
    for (var i = 0; i < lv.length; i++) {
      ok(!seen[lv[i]], '关卡 ' + lv[i] + ' 出现在多个档');
      seen[lv[i]] = 1;
    }
  }
  for (var n = 1; n <= 40; n++) { ok(seen[n], '关卡 ' + n + ' 不在任何档'); }
  ok(G.tierLevels('不存在的档').length === 0, '未知档名应返回空');
  ok(G.firstLevelOfSize('困难') === 21, 'firstLevelOfSize(困难) 应为 21');
  ok(G.firstLevelOfSize('瞎写的') === 1, '未知档名 firstLevelOfSize 应兜底为 1');

  ok(meta.chipLabel('专家') === '专家 · 15×15', 'chipLabel 格式不对：' + meta.chipLabel('专家'));
  var info = meta.pickInfo(2, { first: 21, last: 30 });
  ok(/^12×12 · 最多 \d+ 色 · 第 21-30 关$/.test(info.meta), 'pickInfo 格式不对：' + info.meta);
  var plan = G.tierPlanText(0);
  ok(/^5×5 · 最多 \d+ 色$/.test(plan), 'tierPlanText 格式不对：' + plan);
})();

/* ---------- 10. 注册表 ---------- */
(function () {
  var need = ['id', 'title', 'sub', 'skin', 'scene', 'TOTAL', 'difficulties', 'tierLevels',
              'firstLevelOfSize', 'chipLabel', 'pickInfo', 'build', 'buildDaily'];
  for (var i = 0; i < need.length; i++) { ok(meta[need[i]] !== undefined, '注册表缺字段 ' + need[i]); }
  ok(meta.id === 'picross' && meta.scene === 'picross' && meta.TOTAL === 40, '注册表基本字段不对');
  ok(meta.difficulties.length === 4 && meta.difficulties[0] === '入门', 'difficulties 应为四档中文名');
  ok(meta.tierLevels('入门').length === 10, '注册表 tierLevels 应可用');
  ok(typeof meta.build(1).cells === 'object' && typeof meta.buildDaily().cells === 'object', '注册表 build/buildDaily 应可用');
})();

if (fail) {
  console.log('❌ 数织数据层：' + fail + ' 处不合规');
  process.exit(1);
}
console.log('✅ 数织数据层：40 关全部合规（存储/编解码/线索自洽/唯一解/求解器非恒真/色数/确定性/每日/星级/档位/注册）');
