/**
 * diff.verify.js —— 第 4 款游戏「图片找不同」的关卡数据自检
 *
 * 独立于 UI：直接跑生成器，逐关校验图对与差异矩形。
 * 重点防三类问题：
 *   1) 差异矩形越界 / 相互重叠（重叠会让"一处不同"实际藏着两处，玩家点中一次却只找到一半）
 *   2) 难度曲线不单调（低关比高关还难）
 *   3) 同一关两次生成不一致（刷一下题目就变了，存档星级对不上）
 */
(function () {
  var t0 = Date.now();
  var fs = require('fs'), vm = require('vm'), path = require('path');
  var root = path.join(__dirname, '..');

  var sandbox = {
    console: console, Math: Math, Date: Date, JSON: JSON,
    Object: Object, Array: Array, String: String, Number: Number,
    Error: Error, parseInt: parseInt, isNaN: isNaN
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  function load(rel) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
  }

  load('js/core/ns.js');
  load('js/game/diffAssets.js');
  var BF = sandbox.BF;
  // 生成器只用到 util；platform 不需要（不加载图片）
  BF.platform = { vibrate: function () {} };
  load('js/game/diff.js');

  var fails = [];
  function check(cond, msg) { if (!cond) { fails.push(msg); } }
  function fail(msg) { fails.push(msg); }

  var meta = BF.games && BF.games.diff;
  if (!meta) { console.log('❌ 游戏 4 未注册（BF.games.diff 不存在）'); process.exit(1); }
  var assets = BF.DIFF_ASSETS || [];
  if (!assets.length) {
    console.log('❌ 没有内置图对 —— 先跑 tools/make_diff_pairs.py');
    process.exit(1);
  }

  var TOTAL = meta.TOTAL;
  check(TOTAL === assets.length,
    'TOTAL(' + TOTAL + ') 与内置图对数(' + assets.length + ') 不一致');

  /* ---------- 1. 逐关校验 ---------- */
  var counts = [];
  var dist = {};
  for (var n = 1; n <= TOTAL; n++) {
    var p = meta.build(n);
    var tag = '第 ' + n + ' 关';

    if (!p.a || !p.b) { fail(tag + '：缺少图片源'); continue; }
    if (!p.diffs.length) { fail(tag + '：一处不同都没有'); continue; }
    counts.push(p.diffs.length);
    dist[p.diffs.length] = (dist[p.diffs.length] || 0) + 1;

    // 差异矩形必须落在图内
    for (var i = 0; i < p.diffs.length; i++) {
      var d = p.diffs[i];
      if (d.u < 0 || d.v < 0 || d.u + d.uw > 1 || d.v + d.vh > 1) {
        fail(tag + ' 第 ' + i + ' 处差异越界：u=' + d.u + ' v=' + d.v +
             ' uw=' + d.uw + ' vh=' + d.vh);
      }
      if (d.uw <= 0 || d.vh <= 0) {
        fail(tag + ' 第 ' + i + ' 处差异尺寸非正');
      }
    }

    // 差异之间不能重叠：重叠会让两处改动挤在一起，玩家点一次只找到一半，
    // 剩下的永远点不出来（表现为"明明点了却没反应"）。
    for (i = 0; i < p.diffs.length; i++) {
      for (var j = i + 1; j < p.diffs.length; j++) {
        var a = p.diffs[i], b = p.diffs[j];
        var ox = Math.min(a.u + a.uw, b.u + b.uw) - Math.max(a.u, b.u);
        var oy = Math.min(a.v + a.vh, b.v + b.vh) - Math.max(a.v, b.v);
        if (ox > 0 && oy > 0) {
          fail(tag + '：第 ' + i + ' 处与第 ' + j + ' 处差异重叠（' +
               ox.toFixed(3) + ' × ' + oy.toFixed(3) + '）');
        }
      }
    }

    // 关卡返回的 diffs 必须是副本：玩法层若改到清单对象，第二次进同一关就脏了
    if (p.diffs[0] === assets[(n - 1) % assets.length].diffs[0]) {
      fail(tag + '：diffs 直接复用了清单里的对象（会被玩法层改脏）');
    }
  }

  /* ---------- 2. 难度曲线单调不降 ---------- */
  for (var c = 1; c < counts.length; c++) {
    if (counts[c] < counts[c - 1]) {
      fail('难度曲线在第 ' + (c + 1) + ' 关回落：' + counts[c - 1] + ' → ' + counts[c]);
    }
  }
  if (counts.length) {
    check(counts[0] <= 4, '第 1 关差异数偏多（' + counts[0] + ' 处），教学关应更友好');
    check(counts[counts.length - 1] >= 6,
      '最后一关差异数偏少（' + counts[counts.length - 1] + ' 处），难度没爬上去');
  }

  /* ---------- 3. 同关稳定（重进同一关必须同一题） ---------- */
  var s1 = JSON.stringify(meta.build(17));
  var s2 = JSON.stringify(meta.build(17));
  check(s1 === s2, '同一关重复生成结果不一致（刷新一次题目就变了）');

  /* ---------- 4. 每日挑战可复现 ---------- */
  var d1 = JSON.stringify(meta.buildDaily(new Date(2026, 9, 8)));
  var d2 = JSON.stringify(meta.buildDaily(new Date(2026, 9, 8)));
  check(d1 === d2, '每日挑战同一天两次生成不一致');
  var d3 = JSON.stringify(meta.buildDaily(new Date(2026, 9, 9)));
  check(d1 !== d3 || assets.length === 1, '每日挑战换一天题目没变');
  var dd = meta.buildDaily(new Date(2026, 9, 8));
  check(dd.daily === true && dd.total >= 3, '每日挑战题面异常');

  /* ---------- 5. 难度维度（关卡页那排"难度"快捷条 + 「先选难度」首屏靠它） ---------- */
  check(Array.isArray(meta.difficulties) && meta.difficulties.length >= 5,
    '缺少难度档位（difficulties）');
  check(typeof meta.tierLevels === 'function',
    '缺少 tierLevels（难度首屏要按档枚举关卡号）');
  check(typeof meta.pickInfo === 'function',
    '缺少 pickInfo（难度首屏档卡副标题）');
  var seen = {};
  var allLevels = [];
  for (var s = 0; s < meta.difficulties.length; s++) {
    var cnt = meta.difficulties[s];
    if (seen[cnt]) { fail('难度档位重复：' + cnt); }
    seen[cnt] = true;
    var lv = meta.firstLevelOfSize(cnt);
    var pl = meta.build(lv);
    check(pl.total === cnt,
      '难度条「' + cnt + ' 处」指向第 ' + lv + ' 关，但该关实际 ' + pl.total + ' 处');
    check(meta.chipLabel(cnt) === cnt + ' 处', '难度标签格式不对');

    // tierLevels：该档必须非空、每个元素真的是这个难度、且合起来不重不漏
    var tl = meta.tierLevels(cnt);
    check(tl.length > 0, '难度档「' + cnt + ' 处」一关都没有');
    check(tl[0] === lv, '难度档「' + cnt + ' 处」的 tierLevels 首关与 firstLevelOfSize 不一致');
    for (var q = 0; q < tl.length; q++) {
      check(meta.build(tl[q]).total === cnt,
        '第 ' + tl[q] + ' 关被算进「' + cnt + ' 处」档，但实际 ' + meta.build(tl[q]).total + ' 处');
    }
    allLevels = allLevels.concat(tl);

    // 档卡副标题必须说出"几处不同"，不能掉到兜底文案
    var info = meta.pickInfo(s, { first: tl[0], last: tl[tl.length - 1], count: tl.length });
    check(info && info.meta && info.meta.indexOf(String(cnt)) >= 0,
      '难度档「' + cnt + ' 处」的 pickInfo 没说清难度：' + (info && info.meta));
  }
  // 各档合起来必须恰好覆盖 1..TOTAL（不重不漏），否则首屏进度/入口会算错
  var uniqLv = {}, dupLv = [];
  allLevels.forEach(function (x) { if (uniqLv[x]) { dupLv.push(x); } uniqLv[x] = 1; });
  check(dupLv.length === 0, '有关节被算进多个难度档：' + dupLv.join(','));
  check(allLevels.length === TOTAL,
    '各档关卡总数(' + allLevels.length + ') 应等于 TOTAL(' + TOTAL + ')');
  for (var n2 = 1; n2 <= TOTAL; n2++) {
    check(!!uniqLv[n2], '第 ' + n2 + ' 关不属于任何难度档');
  }

  /* ---------- 结果 ---------- */
  if (fails.length) {
    console.log('❌ 图片找不同校验失败 ' + fails.length + ' 项:');
    fails.slice(0, 12).forEach(function (f) { console.log('   - ' + f); });
    process.exit(1);
  }
  var distTxt = Object.keys(dist).sort(function (x, y) { return x - y; })
    .map(function (k) { return k + '处×' + dist[k] + '关'; }).join('  ');
  console.log('✅ 图片找不同：' + TOTAL + ' 关全部合规');
  console.log('   难度分布  ' + distTxt);
  console.log('   内置图对  ' + assets.length + ' 对');
  console.log('   已验证    差异矩形不越界 / 互不重叠 / 难度曲线不回落 / 同关稳定 / 每日可复现 / 难度条映射正确');
  console.log('   耗时      ' + (Date.now() - t0) + 'ms');
})();
