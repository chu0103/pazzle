/**
 * cipher.verify.js —— 密码推理 数据层自检
 * 用 node 直接加载生成器（不需要 canvas / 平台层），断言全部关卡：
 *   - 配置合法（slots/colors/tries/hint/info 与 LEVELS 一致，颜色数 ≥ 位数且不超调色板）
 *   - 密码合法（位数对、颜色互不重复、且都在本关可用颜色里）
 *   - 可用颜色合法（数量对、互不重复、都在调色板范围内）
 *   - 确定性（同一关永远同一题）
 *   - 反馈自洽（exact+color+miss === 位数；与暴力参考实现逐一对比）
 *   - 逐格提示与聚合反馈一致（每格 2/1/0 的计数 === exact/color/miss）
 *   - 数量提示的点阵数据一致（aggDots 的长度与各类个数 === 聚合反馈）
 *   - 动态星级阈值随关卡单调不放严（3★ 线只增不减 / 2★ > 3★ / 落在合法区间）
 *   - 段内难度严格递增（候选空间 P(colors, slots)；跨玩法段不比较）
 *   - 每日挑战合法
 *
 * 运行：node test/cipher.verify.js
 */
(function () {
  var path = require('path');
  var root = path.resolve(__dirname, '..');
  global.BF = {};
  require(path.join(root, 'js/core/ns.js'));
  require(path.join(root, 'js/game/cipher.js'));

  var BF = global.BF;
  var Gen = BF.CipherGen;
  var P = Gen.palette.length;
  var issues = [];
  var TOTAL = Gen.TOTAL;

  // 0) 调色板体检 —— 防"两个颜色太相近 / 两个绿"回归。
  //    ΔE00 口径与 tools/_palette_check.js 同源（require 复用，单一真源）。
  var color = require(path.join(root, 'tools/_palette_check.js'));
  var PAL_MIN_D = 0;
  (function paletteIntegrity() {
    var pal = Gen.palette;
    var labs = pal.map(function (p) { return color.srgb2lab(color.hex2rgb(p.hex)); });
    var minD = Infinity, minPair = '';
    for (var i = 0; i < pal.length; i++) {
      for (var j = i + 1; j < pal.length; j++) {
        var d = color.de2000(labs[i], labs[j]);
        if (d < minD) { minD = d; minPair = pal[i].name + '/' + pal[j].name; }
      }
    }
    PAL_MIN_D = minD;
    if (minD < 20) {
      issues.push('调色板最小 ΔE00 只有 ' + minD.toFixed(1) + '（' + minPair + '），< 20 会混淆');
    }
    // 绿色族至多一个：按 HSL 色相判断"绿→青绿"家族（hue ∈ [70°,180°] 且够饱和），
    //   青(cyan ≈190°) 与 灰(中性, 低饱和) 自然排除。
    //   ⚠️ 别用"绿通道胜过红/蓝通道"的近似式：青绿 #0B7A72 的 g-max(r,b) 只有 8，
    //      会被判成青色而漏掉两个绿（实测过）——所以改用色相窗口。
    var hueOf = function (hex) {
      var c = color.hex2rgb(hex);
      var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      var h;
      if (d === 0) { h = 0; }
      else if (mx === r) { h = ((g - b) / d) % 6; }
      else if (mx === g) { h = (b - r) / d + 2; }
      else { h = (r - g) / d + 4; }
      h *= 60; if (h < 0) { h += 360; }
      return { h: h, s: mx === 0 ? 0 : d / mx };
    };
    var greens = pal.filter(function (p) {
      var q = hueOf(p.hex);
      return q.h >= 70 && q.h <= 180 && q.s >= 0.25;
    });
    if (greens.length > 1) {
      issues.push('调色板里有 ' + greens.length + ' 个绿色族（' +
        greens.map(function (p) { return p.name; }).join('/') + '），应 ≤ 1（每种色相家族唯一）');
    }
  })();

  function uniq(a) {
    var s = {}; for (var i = 0; i < a.length; i++) { if (s[a[i]]) { return false; } s[a[i]] = 1; }
    return true;
  }
  function sameArr(a, b) {
    if (a.length !== b.length) { return false; }
    for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
    return true;
  }
  /** 暴力参考：标准 Mastermind 计数（用 multiset 数交集） */
  function refFeedback(guess, code) {
    var n = code.length, exact = 0, i;
    var gLeft = [], cLeft = [];
    for (i = 0; i < n; i++) {
      if (guess[i] === code[i]) { exact++; } else { gLeft.push(guess[i]); cLeft.push(code[i]); }
    }
    // 颜色对（不含位置对）的交集大小
    var pool = {};
    for (i = 0; i < cLeft.length; i++) { pool[cLeft[i]] = (pool[cLeft[i]] || 0) + 1; }
    var color = 0;
    for (i = 0; i < gLeft.length; i++) {
      var x = gLeft[i];
      if (pool[x] > 0) { color++; pool[x]--; }
    }
    return { exact: exact, color: color, miss: n - exact - color };
  }

  // 1) 逐关校验配置与密码
  var prevThree = -1, prevTwo = -1, prevSpace = 0, prevStage = 0;
  var spaceSeq = [];
  for (var n = 1; n <= TOTAL; n++) {
    var cfg = Gen.configOf(n);
    var pz = Gen.build(n);

    // 难度递增的量化证明：候选空间 P(colors, slots) 必须**严格**大于上一关。
    // 这只在**同一个玩法段内**成立 —— 段 1（逐格提示）与段 2（数量提示）每次反馈给的
    // 信息量不一样，跨段硬比 P 会把"新玩法从小规模重新起步"误判成难度倒退。
    var space = 1;
    for (var q = 0; q < cfg.slots; q++) { space *= (cfg.colors - q); }
    var stage = Gen.stageOf(n);
    if (n > 1 && stage === prevStage && space <= prevSpace) {
      issues.push('L' + n + ' 段内难度未递增（候选空间 ' + space + ' 未大于上一关 ' + prevSpace + '）');
    }
    if (n > 1 && stage < prevStage) { issues.push('L' + n + ' 玩法段不该回退'); }
    if (stage !== 1 && stage !== 2) { issues.push('L' + n + ' 玩法段号非法'); }
    prevSpace = space; prevStage = stage;
    spaceSeq.push('L' + n + ':' + space + '(段' + stage + ')');

    if (pz.level !== n) { issues.push('L' + n + ' 关卡号错'); }
    if (pz.slots !== cfg.slots) { issues.push('L' + n + ' slots 不一致'); }
    if (pz.colors !== cfg.colors) { issues.push('L' + n + ' colors 不一致'); }
    if (pz.tries !== cfg.tries) { issues.push('L' + n + ' tries 不一致'); }
    if (pz.hint !== cfg.hint) { issues.push('L' + n + ' hint 不一致'); }
    if (['line', 'dot', 'agg'].indexOf(cfg.hint) < 0) { issues.push('L' + n + ' hint 非法: ' + cfg.hint); }
    if (['full', 'exact'].indexOf(cfg.info) < 0) { issues.push('L' + n + ' info 非法: ' + cfg.info); }
    if (cfg.colors < cfg.slots) { issues.push('L' + n + ' 可用颜色数 < 位数，密码取不出'); }
    if (cfg.colors > P) { issues.push('L' + n + ' 颜色数超过调色板容量'); }
    if (cfg.hint === 'agg' && cfg.info === 'exact') {
      issues.push('L' + n + ' 数量提示本来就只给个数，再叠"只标对位"没有意义');
    }

    // 密码
    if (pz.code.length !== cfg.slots) { issues.push('L' + n + ' 密码位数错'); }
    if (!uniq(pz.code)) { issues.push('L' + n + ' 密码有重复颜色'); }
    for (var i = 0; i < pz.code.length; i++) {
      if (pz.usable.indexOf(pz.code[i]) < 0) { issues.push('L' + n + ' 密码色不在可用色里'); break; }
    }

    // 可用颜色
    if (pz.usable.length !== cfg.colors) { issues.push('L' + n + ' 可用颜色数错'); }
    if (!uniq(pz.usable)) { issues.push('L' + n + ' 可用颜色有重复'); }
    for (i = 0; i < pz.usable.length; i++) {
      if (pz.usable[i] < 0 || pz.usable[i] >= P) { issues.push('L' + n + ' 可用色下标越界'); break; }
    }

    // 确定性
    var pz2 = Gen.build(n);
    if (!sameArr(pz.code, pz2.code) || !sameArr(pz.usable, pz2.usable)) {
      issues.push('L' + n + ' 非确定性（同关两次结果不同）');
    }

    // 动态阈值：单调不放严
    var th = Gen.thresholdsFor(n);
    if (th.three < 1) { issues.push('L' + n + ' 3★ 线 < 1'); }
    if (!(th.two > th.three)) { issues.push('L' + n + ' 2★ 线未大于 3★ 线'); }
    if (th.three > cfg.tries - 2) { issues.push('L' + n + ' 3★ 线过宽(> tries-2)'); }
    if (th.two > cfg.tries - 1) { issues.push('L' + n + ' 2★ 线过宽(> tries-1)'); }
    if (prevThree >= 0 && th.three < prevThree) { issues.push('L' + n + ' 3★ 线比上一关更严'); }
    if (prevTwo >= 0 && th.two < prevTwo) { issues.push('L' + n + ' 2★ 线比上一关更严'); }
    prevThree = th.three; prevTwo = th.two;

    // 星级与阈值自洽
    if (Gen.starsFor(n, th.three) !== 3) { issues.push('L' + n + ' 恰好 3★ 线却拿不到 3★'); }
    if (Gen.starsFor(n, th.two) !== 2) { issues.push('L' + n + ' 恰好 2★ 线却拿不到 2★'); }
    if (Gen.starsFor(n, th.two + 1) !== 1) { issues.push('L' + n + ' 超出 2★ 线却不是 1★'); }
    if (Gen.starsFor(n, 1) !== 3) { issues.push('L' + n + ' 1 次就中却非 3★'); }
  }

  // 2) 反馈函数：随机采样比对暴力参考 + 恒等式 + 划线提示一致
  var rnd = BF.util.mulberry32(20261010);
  function randGuess(code) {
    // 生成一个与密码同长度、无重复的随机猜测（从全部颜色里取）
    var idxs = []; for (var i = 0; i < P; i++) { idxs.push(i); }
    BF.util.shuffle(idxs, rnd);
    var g = idxs.slice(0, code.length);
    // 一半概率让它和密码有交集，增加覆盖率
    if (rnd() < 0.5) {
      for (var k = 0; k < Math.min(2, code.length); k++) {
        var j = Math.floor(rnd() * code.length);
        if (g.indexOf(code[k]) < 0) { g[j] = code[k]; }
      }
    }
    return g;
  }
  for (n = 1; n <= TOTAL; n++) {
    var c = Gen.build(n).code;
    for (var t = 0; t < 200; t++) {
      var g = randGuess(c);
      var fb = Gen.feedback(g, c);
      var rf = refFeedback(g, c);
      if (fb.exact !== rf.exact || fb.color !== rf.color || fb.miss !== rf.miss) {
        issues.push('L' + n + ' feedback 与参考实现不符: g=' + g + ' c=' + c +
          ' got=' + JSON.stringify(fb) + ' ref=' + JSON.stringify(rf));
        break;
      }
      if (fb.exact + fb.color + fb.miss !== c.length) {
        issues.push('L' + n + ' feedback 三项之和不等于位数'); break;
      }
      var ln = Gen.lineHint(g, c);
      var c2 = 0, c1 = 0, c0 = 0;
      for (var q = 0; q < ln.length; q++) {
        if (ln[q] === 2) { c2++; } else if (ln[q] === 1) { c1++; } else if (ln[q] === 0) { c0++; }
        else { issues.push('L' + n + ' lineHint 出现非法值 ' + ln[q]); }
      }
      if (c2 !== fb.exact || c1 !== fb.color || c0 !== fb.miss) {
        issues.push('L' + n + ' 划线提示与聚合反馈不一致'); break;
      }
      // 数量提示的点阵（agg 关画在行右侧的那些点）：
      // 长度必须等于位数，且三类点的个数逐一等于聚合反馈的三项（渲染不自己数，全靠这份数据）
      var dots = Gen.aggDots(fb), d2 = 0, d1 = 0, d0 = 0;
      for (q = 0; q < dots.length; q++) {
        if (dots[q] === 2) { d2++; }
        else if (dots[q] === 1) { d1++; }
        else if (dots[q] === 0) { d0++; }
        else { issues.push('L' + n + ' aggDots 出现非法值 ' + dots[q]); }
      }
      if (dots.length !== c.length) { issues.push('L' + n + ' 点阵长度应等于位数'); break; }
      if (d2 !== fb.exact || d1 !== fb.color || d0 !== fb.miss) {
        issues.push('L' + n + ' 点阵各类个数与聚合反馈不一致'); break;
      }
      // 猜中：全绿
      if (sameArr(g, c)) {
        if (fb.exact !== c.length || fb.color !== 0 || fb.miss !== 0) {
          issues.push('L' + n + ' 完全猜中时反馈不是全绿');
        }
        var allLine = Gen.lineHint(g, c), allGreen = true;
        for (q = 0; q < allLine.length; q++) { if (allLine[q] !== 2) { allGreen = false; } }
        if (!allGreen) { issues.push('L' + n + ' 完全猜中时划线不是全绿'); }
      }
    }
  }

  // 3) 每日挑战合法
  for (var dd = 0; dd < 30; dd++) {
    var date = new Date(2026, 9, 1 + dd);
    var d1 = Gen.buildDaily(date);
    var d2 = Gen.buildDaily(date);
    if (!d1.daily || !d2.daily) { issues.push('每日挑战 daily 标记错'); }
    if (d1.level < 1 || d1.level > TOTAL) { issues.push('每日挑战关卡越界'); }
    if (d1.code.length !== d1.slots || !uniq(d1.code)) { issues.push('每日挑战密码非法'); }
    if (!sameArr(d1.code, d2.code)) { issues.push('每日挑战非确定性（同日不同题）'); }
  }

  if (issues.length) {
    console.error('❌ 密码推理数据层问题 ' + issues.length + ' 条:');
    for (var z = 0; z < issues.length; z++) { console.error('  - ' + issues[z]); }
    process.exit(1);
  }
  console.log('数据：' + TOTAL + ' 关配置 ' + JSON.stringify(Gen.LEVELS.map(function (l) {
    return l.slots + '位/' + l.colors + '色/' + l.hint;
  })));
  console.log('阈值：3★ 线 ' + Gen.LEVELS.map(function (_, k) { return Gen.thresholdsFor(k + 1).three; }).join(',') +
    '　2★ 线 ' + Gen.LEVELS.map(function (_, k) { return Gen.thresholdsFor(k + 1).two; }).join(','));
  console.log('难度（候选空间 P(色,位)，**同玩法段内**必须逐关严格递增）：' + spaceSeq.join('  '));
  console.log('调色板：' + Gen.palette.length + ' 色，最小 ΔE00 = ' + PAL_MIN_D.toFixed(1) + '（须 ≥ 20），绿色族 ≤ 1');
  console.log('✅ 密码推理：' + TOTAL + ' 关数据全部合规（配置/密码/可用色/确定性/反馈自洽/划线·点阵一致/**段内难度严格递增**/动态阈值单调/每日挑战合法）');
})();
