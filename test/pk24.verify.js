/**
 * pk24.verify.js —— 「24点」数据层自检（无尽模式）
 *
 * 用 node 直接加载生成器（不需要 canvas / 平台层），断言：
 *   - 200 副随机发牌**全部可解**（约 4/5 的 4 张牌组合可解，整数整除语义进一步缩小，
 *     生成器必须重抽到可解才发，否则兜底经典可解副 [4,4,10,10]）
 *   - 确定性：dealFromSeed 同种子恒同副；build(n) / buildDaily() 同参恒同
 *   - build / buildDaily 返回 {cards:[...]} 且可解
 *   - 整除规则：除法只在「除数为 0 或不能整除」时判 null，否则返回整数商
 *   - 整数语义下某些题无解（如 3,3,8,8），生成器不得发出这类副
 *   - solve / solveSeq 正确：用 solveSeq 的合并序列反向模拟场景 merge，最后必得 24
 *   - 面值映射：J/Q/K = 11/12/13（face 渲染正确）
 *   - 玩法说明文案：rules.lines 5 条、每条 ≤ 30 字（RuleTip 弹框约定）
 *
 * 运行：node test/pk24.verify.js
 */
(function () {
  var path = require('path');
  var root = path.resolve(__dirname, '..');
  global.BF = {};
  require(path.join(root, 'js/core/ns.js'));
  require(path.join(root, 'js/game/pk24.js'));

  var BF = global.BF;
  var Gen = BF.Pk24Gen;
  var issues = [];

  function uniq(a) { var s = {}; for (var i = 0; i < a.length; i++) { if (s[a[i]]) { return false; } s[a[i]] = 1; } return true; }
  function sameArr(a, b) {
    if (a.length !== b.length) { return false; }
    for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
    return true;
  }

  // 0) 基础契约：运算符 / 花色 / 面值
  if (JSON.stringify(Gen.OPS) !== JSON.stringify(['+', '-', '×', '÷'])) {
    issues.push('运算符必须为正负乘除四则，实际 ' + JSON.stringify(Gen.OPS));
  }
  if (!Gen.SUITS || Gen.SUITS.length < 4) { issues.push('花色数据缺失'); }
  if (Gen.face(1) !== 'A' || Gen.face(11) !== 'J' || Gen.face(12) !== 'Q' || Gen.face(13) !== 'K') {
    issues.push('面值映射错：A=1、JQK=11/12/13 必须成立（JQK 代表 11/12/13）');
  }

  // 1) 200 副随机发牌全部可解（4 张牌可重复点数——一副牌里同点数不同花色是合法的，故不要求去重）
  var allSolvable = true, badDeal = null;
  for (var t = 0; t < 200; t++) {
    var d = Gen.randomDeal();
    if (!d || d.length !== 4) { issues.push('随机副非法（长度）：' + JSON.stringify(d)); break; }
    for (var k = 0; k < 4; k++) { if (d[k] < 1 || d[k] > 13) { issues.push('随机副含越界面值 ' + d[k]); break; } }
    if (!Gen.solvable(d)) { allSolvable = false; badDeal = d; break; }
  }
  if (!allSolvable) { issues.push('随机副不可解（违反「重抽到可解才发」约定）：' + JSON.stringify(badDeal)); }

  // 2) 确定性：同种子恒同副
  var seeds = [1, 7, 42, 12345, 999999];
  for (var s = 0; s < seeds.length; s++) {
    if (!sameArr(Gen.dealFromSeed(seeds[s]), Gen.dealFromSeed(seeds[s]))) {
      issues.push('dealFromSeed 非确定性（seed=' + seeds[s] + '）');
    }
    var b1 = BF.games.pk24.build(seeds[s]);
    var b2 = BF.games.pk24.build(seeds[s]);
    if (!sameArr(b1.cards, b2.cards)) { issues.push('build(n) 非确定性（n=' + seeds[s] + '）'); }
    if (!Gen.solvable(b1.cards)) { issues.push('build(n) 发出的副不可解（n=' + seeds[s] + '）'); }
  }
  // 每日挑战确定性
  var dd1 = BF.games.pk24.buildDaily(new Date(2026, 9, 15));
  var dd2 = BF.games.pk24.buildDaily(new Date(2026, 9, 15));
  if (!sameArr(dd1.cards, dd2.cards)) { issues.push('每日挑战非确定性（同日不同题）'); }
  if (!Gen.solvable(dd1.cards)) { issues.push('每日挑战副不可解'); }

  // 3) 整除规则边界（除数为第二操作数 b；a/b 仅在 b≠0 且 a%b===0 时合法）
  if (Gen.applyOp(3, 8, '÷') !== null) { issues.push('3÷8 应判不可行（除不尽），实际 ' + Gen.applyOp(3, 8, '÷')); }
  if (Gen.applyOp(8, 4, '÷') !== 2) { issues.push('8÷4 应为 2，实际 ' + Gen.applyOp(8, 4, '÷')); }
  if (Gen.applyOp(7, 2, '÷') !== null) { issues.push('7÷2 应判不可行（除不尽），实际 ' + Gen.applyOp(7, 2, '÷')); }
  if (Gen.applyOp(5, 0, '÷') !== null) { issues.push('5÷0 应判不可行（除数为 0），实际 ' + Gen.applyOp(5, 0, '÷')); }
  if (Gen.applyOp(0, 5, '÷') !== 0) { issues.push('0÷5 应为 0（整除合法），实际 ' + Gen.applyOp(0, 5, '÷')); }
  if (Gen.applyOp(3, 0, '-') !== 3) { issues.push('3-0 应为 3，实际 ' + Gen.applyOp(3, 0, '-')); }
  if (Gen.applyOp(13, 11, '+') !== 24) { issues.push('13+11 应为 24'); }

  // 4) 整数语义下某些题无解：生成器不得发出（抽查 3,3,8,8）
  if (Gen.solvable([3, 3, 8, 8])) { issues.push('3,3,8,8 在整数整除语义下本无解，solvable 却判可解'); }
  if (Gen.solve([3, 3, 8, 8]) !== null) { issues.push('3,3,8,8 的 solve 应返回 null'); }
  if (Gen.solveSeq([3, 3, 8, 8]) !== null) { issues.push('3,3,8,8 的 solveSeq 应返回 null'); }

  // 5) solve / solveSeq 正确：用 solveSeq 的合并序列反向模拟「场景 merge」，最后必得 24
  //    这一步同时证明 solveSeq 的下标语义与场景 merge(i,op,j) 一致（供交互测试/提示驱动真实通关）。
  function applySeq(vals, seq) {
    var arr = vals.slice();
    for (var i = 0; i < seq.length; i++) {
      var st = seq[i];
      var a = arr[st.i], b = arr[st.j];
      var r = Gen.applyOp(a, b, st.op);
      if (r === null) { return { ok: false, why: '第' + (i + 1) + '步 ' + a + st.op + b + ' 不可行' }; }
      var hi = Math.max(st.i, st.j), lo = Math.min(st.i, st.j);
      arr.splice(hi, 1); arr.splice(lo, 1); arr.push(r);
    }
    return { ok: true, last: arr[0] };
  }
  // 5) 样本用「生成器保证可解」的副（randomDeal）+ 经典可解副 [4,4,10,10]，避免用错不可解的硬编码样本
  var sampleDeals = [[4, 4, 10, 10]];
  for (var m = 0; m < 5; m++) { sampleDeals.push(Gen.randomDeal()); }
  for (var mi = 0; mi < sampleDeals.length; mi++) {
    var v = sampleDeals[mi];
    var seq = Gen.solveSeq(v);
    if (!seq) { issues.push('样本 ' + JSON.stringify(v) + ' 无解（但生成器声称可解）'); continue; }
    if (seq.length !== 3) { issues.push('样本 ' + JSON.stringify(v) + ' 合并步数应恰为 3，实际 ' + seq.length); }
    var res = applySeq(v, seq);
    if (!res.ok) { issues.push('样本 ' + JSON.stringify(v) + ' solveSeq 模拟失败：' + res.why); }
    else if (res.last !== 24) { issues.push('样本 ' + JSON.stringify(v) + ' solveSeq 模拟结果=' + res.last + ' 不是 24'); }
    if (Gen.solve(v) === null) { issues.push('样本 ' + JSON.stringify(v) + ' solve 应给出表达式'); }
  }
  // 表达式等价校验：把 solve 返回的字符串代入计算，应等于 24
  function evalExpr(expr) {
    // 仅含 0-9、+ - * / ( )，安全
    if (!/^[\d+\-*/() ]+$/.test(expr)) { return null; }
    try { return Function('"use strict";return (' + expr + ')')(); } catch (e) { return null; }
  }
  var ex = Gen.solve([4, 4, 10, 10]);
  var exVal = evalExpr(ex ? ex.replace(/×/g, '*').replace(/÷/g, '/') : '');
  if (exVal !== 24) { issues.push('solve 表达式计算结果应为 24，实际 ' + exVal + '（' + ex + '）'); }

  // 6) 玩法说明文案：5 条、每条 ≤ 30 字（RuleTip 弹框约定）
  var rules = BF.games.pk24.rules;
  if (!rules || !rules.lines || rules.lines.length !== 5) {
    issues.push('24点规则文案应为 5 条，实际 ' + (rules && rules.lines ? rules.lines.length : '缺失'));
  } else {
    for (var li = 0; li < rules.lines.length; li++) {
      if (rules.lines[li].length > 30) { issues.push('规则第 ' + (li + 1) + ' 条超 30 字：' + rules.lines[li]); }
    }
    if (!rules.sub) { issues.push('规则缺少副标题 sub'); }
  }

  if (issues.length) {
    console.error('❌ 24点数据层问题 ' + issues.length + ' 条:');
    for (var z = 0; z < issues.length; z++) { console.error('  - ' + issues[z]); }
    process.exit(1);
  }
  console.log('✅ 24点 · 数据层全过：200 副随机牌全部可解 / dealFromSeed·build·buildDaily 确定性 / 整除规则边界（除不尽·除0 判不可行）/ 整数语义下 3,3,8,8 正确判无解 / solve·solveSeq 反向模拟合并必得 24（步数=3、下标语义与场景 merge 一致）/ 面值 JQK=11/12/13 / 规则文案 5 条≤30 字');
})();
