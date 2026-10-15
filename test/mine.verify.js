/**
 * mine.verify.js —— 扫雷「数据层」回归测试（node test/mine.verify.js）
 *
 * 覆盖（与 tools/_verify_mine_logic.js 互补，那份跑场景交互）：
 *   - 生成器自洽：genBoard 产出「首点必安全 + 纯逻辑可解」的盘，且雷数精确、数字自洽；
 *   - 40 关配置合法：档位划分正确（4 档 × 10 关连续区间）、尺寸/雷数逐档递增；
 *   - 免猜保证：每一关在代表首点（中心）下 genBoard 返回非 null 且 deduceClear 为真；
 *   - 演绎求解器不是「恒真」：手工构造一张必然要猜的盘，断言 deduceClear 返回 false；
 *   - 确定性：同关两次 build 逐字段一致；同参数两次 genBoard 雷位一致；每日同天一致；
 *   - 越界保护：build(0)/build(999) 被夹到合法区间；
 *   - 每日挑战：daily 标记 + 用进阶档尺寸/雷数 + 中心首点可免猜解出；
 *   - tierLevels：四档并集恰为 1..40、两两不交、每档 10 关；
 *   - starsFor / thresholdsFor：阈值档间严格递增、边界值正确；
 *   - 注册表字段：scene/TOTAL/difficulties/chipLabel/pickInfo。
 * 不依赖画布，纯 node 跑数据层。失败 process.exit(1)。
 */
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'js/core/ns.js'));
require(path.join(root, 'js/core/palette.js'));
require(path.join(root, 'js/core/draw.js'));
require(path.join(root, 'js/core/save.js'));
require(path.join(root, 'js/game/mine.js'));

var G = BF.MineGen;
var meta = BF.games.mine;

var fail = 0;
function ok(cond, msg) { if (!cond) { console.log('  ✗ ' + msg); fail++; } }

function centerOf(n) { return ((n / 2) | 0) * n + ((n / 2) | 0); }

/** 数字自洽：每个非雷格的 nums == 周围雷数；雷格 nums 必为 0（不显示） */
function numsConsistent(mines, nums, n) {
  var N = n * n;
  for (var i = 0; i < N; i++) {
    if (mines[i]) { if (nums[i] !== 0) { return false; } continue; }
    var nb = G.neighbors(i, n), s = 0;
    for (var k = 0; k < nb.length; k++) { if (mines[nb[k]]) { s++; } }
    if (nums[i] !== s) { return false; }
  }
  return true;
}

function countMines(mines) { var s = 0; for (var i = 0; i < mines.length; i++) { if (mines[i]) { s++; } } return s; }

/* ---------- 1. 注册表 ---------- */
(function () {
  ok(!!meta, 'BF.games.mine 未注册');
  ok(meta.scene === 'mine', 'scene 应为 mine，实际 ' + meta.scene);
  ok(meta.TOTAL === 40, 'TOTAL 应为 40，实际 ' + meta.TOTAL);
  ok(JSON.stringify(meta.difficulties) === JSON.stringify(['入门', '进阶', '困难', '专家']),
    'difficulties 应为 4 档中文档名');
  ok(typeof meta.build === 'function' && typeof meta.buildDaily === 'function',
    'build / buildDaily 应为函数');
  ok(G.TIER_COUNT === 10, '每档关数应为 10，实际 ' + G.TIER_COUNT);
})();

/* ---------- 2. 关卡表 / 档位 / 难度递增 ---------- */
(function () {
  var prevSize = 0, prevMines = 0;
  for (var n = 1; n <= 40; n++) {
    var t = G.tierOf(n);
    var pz = meta.build(n);
    ok(t === Math.floor((n - 1) / 10), '第 ' + n + ' 关档位错：' + t);
    ok(pz.n === G.TIER_SIZE[t], '第 ' + n + ' 关尺寸应为 ' + G.TIER_SIZE[t] + '，实际 ' + pz.n);
    ok(pz.m === G.TIER_MINES[t], '第 ' + n + ' 关雷数应为 ' + G.TIER_MINES[t] + '，实际 ' + pz.m);
    ok(pz.level === n, 'build 返回的 level 应一致');
    // 档间尺寸 / 雷数严格递增
    if (n === 1 || n === 11 || n === 21 || n === 31) {
      ok(G.TIER_SIZE[t] > prevSize, '档间尺寸应严格递增：' + prevSize + ' → ' + G.TIER_SIZE[t]);
      ok(G.TIER_MINES[t] > prevMines, '档间雷数应严格递增：' + prevMines + ' → ' + G.TIER_MINES[t]);
      prevSize = G.TIER_SIZE[t]; prevMines = G.TIER_MINES[t];
    }
  }
})();

/* ---------- 3. 免猜保证：每一关都能生成「首点必安全 + 纯逻辑可解」的盘 ---------- */
(function () {
  for (var n = 1; n <= 40; n++) {
    var pz = meta.build(n);
    var fc = centerOf(pz.n);
    var b = G.genBoard(pz.n, pz.m, pz.seed, fc);
    ok(!!b, '第 ' + n + ' 关（' + pz.tierName + '）应能生成免猜盘（genBoard 返回 null）');
    if (!b) { continue; }
    ok(b.usedMines === pz.m, '第 ' + n + ' 关雷数应精确为 ' + pz.m + '，实际 ' + b.usedMines);
    // 首点必安全：首点及其 8 邻域全部无雷
    ok(!b.mines[fc], '第 ' + n + ' 关首点不应该是雷');
    var nb = G.neighbors(fc, pz.n);
    var safeOK = true;
    for (var q = 0; q < nb.length; q++) { if (b.mines[nb[q]]) { safeOK = false; break; } }
    ok(safeOK, '第 ' + n + ' 关首点邻域不应有雷（首点必安全）');
    // 纯逻辑可解
    ok(G.deduceClear(b.mines, b.nums, fc, pz.n), '第 ' + n + ' 关应能通过纯逻辑演绎清空全盘');
    // 数字自洽
    ok(numsConsistent(b.mines, b.nums, pz.n), '第 ' + n + ' 关数字与雷位不一致');
  }
})();

/* ---------- 4. 演绎求解器不是「恒真」（反向自洽） ---------- */
(function () {
  // 构造一张必然要猜的盘：n=4，首点=5，邻格 4/6 布雷 → 首点显示 2，
  // 但 8 个未知邻格里哪个是雷纯靠数字推不出来（D1/D2 都触发不了）→ deduceClear 应返回 false。
  var n = 4, fc = 5;
  var mines = new Array(16).fill(false);
  mines[4] = true; mines[6] = true;
  ok(!mines[fc], '反向用例：首点本身应是安全的');
  var nums = G.computeNums(mines, n);
  ok(!G.deduceClear(mines, nums, fc, n),
    '演绎求解器应能识别「必须猜」的盘（返回 false，证明不是恒真）');
  // 再证：只要是 genBoard 产出的盘，deduceClear 一定为 true（上面第 3 节已逐关验证，这里只补一个随机样本）
  var sample = G.genBoard(12, 28, 12345, centerOf(12));
  ok(!!sample && G.deduceClear(sample.mines, sample.nums, centerOf(12), 12),
    'genBoard 产出的盘必须可被演绎求解器判为可解');
})();

/* ---------- 5. 确定性 / 越界 ---------- */
(function () {
  var a = meta.build(17), b = meta.build(17);
  ok(JSON.stringify(a) === JSON.stringify(b), '同关两次 build 应逐字段一致');
  // 同参数两次生成，雷位必须一致（genBoard 用确定性 rng）
  var pz = meta.build(21);
  var fc = centerOf(pz.n);
  var g1 = G.genBoard(pz.n, pz.m, pz.seed, fc);
  var g2 = G.genBoard(pz.n, pz.m, pz.seed, fc);
  ok(JSON.stringify(g1.mines) === JSON.stringify(g2.mines), '同参数两次 genBoard 雷位应一致');
  var lo = meta.build(0), hi = meta.build(999);
  ok(lo.level === 1, 'build(0) 应夹到第 1 关');
  ok(hi.level === 40, 'build(999) 应夹到第 40 关');
})();

/* ---------- 6. 每日挑战 ---------- */
(function () {
  var d1 = meta.buildDaily(), d2 = meta.buildDaily();
  ok(!!d1.daily, '每日题应带 daily 标记');
  var t = G.DAILY_TIER;
  ok(d1.n === G.TIER_SIZE[t] && d1.m === G.TIER_MINES[t], '每日题尺寸/雷数应为进阶档');
  ok(JSON.stringify(d1) === JSON.stringify(d2), '同日两次 buildDaily 应一致');
  var b = G.genBoard(d1.n, d1.m, d1.seed, centerOf(d1.n));
  ok(!!b && G.deduceClear(b.mines, b.nums, centerOf(d1.n), d1.n), '每日题中心首点应免猜可解');
})();

/* ---------- 7. tierLevels 划分 ---------- */
(function () {
  var seen = {}, union = [];
  G.TIER_NAMES.forEach(function (nm) {
    var lv = meta.tierLevels(nm);
    ok(lv.length === 10, nm + ' 档应有 10 关，实际 ' + lv.length);
    ok(meta.firstLevelOfSize(nm) === lv[0], nm + ' 档 firstLevelOfSize 不对');
    lv.forEach(function (n) {
      ok(!seen[n], '第 ' + n + ' 关被多个档重复包含');
      seen[n] = true;
      union.push(n);
    });
  });
  union.sort(function (a, b) { return a - b; });
  ok(union.length === 40 && union[0] === 1 && union[39] === 40, '四档并集应恰为 1..40');
})();

/* ---------- 8. 星级 ---------- */
(function () {
  var prev = null;
  for (var t = 0; t < 4; t++) {
    var th = G.thresholdsFor(t);
    ok(th.t3 > 0 && th.t2 > th.t3, '第 ' + t + ' 档阈值应满足 0 < t3 < t2');
    if (prev) { ok(th.t3 > prev.t3 && th.t2 > prev.t2, '阈值应随档位递增'); }
    prev = th;
    ok(G.starsFor(t, th.t3) === 3, 't3 整应给 3★');
    ok(G.starsFor(t, th.t3 + 1) === 2, '刚超 t3 应给 2★');
    ok(G.starsFor(t, th.t2 + 1) === 1, '刚超 t2 应给 1★');
    ok(G.starsFor(t, 0) === 3, '0 毫秒应给 3★');
  }
  ok(G.starsFor(-1, 0) === 3 && G.starsFor(9, 0) === 3, '越界档位应被夹住');
})();

/* ---------- 9. 文案钩子 ---------- */
(function () {
  ok(meta.chipLabel('困难') === '困难 · 12×12 / 28 雷', 'chipLabel 格式不对：' + meta.chipLabel('困难'));
  var info = meta.pickInfo(0, { first: 1, last: 10 });
  ok(info.meta === '8×8 · 10 雷 · 第 1-10 关', 'pickInfo 格式不对：' + info.meta);
})();

if (fail) {
  console.log('❌ 扫雷数据层：' + fail + ' 处不合规');
  process.exit(1);
}
console.log('✅ 扫雷数据层：40 关全部合规（免猜保证/首点安全/雷数精确/数字自洽/档位/确定性/每日/星级/求解器自洽）');
