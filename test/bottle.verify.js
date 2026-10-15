/**
 * bottle.verify.js —— 瓶子颜色推理 数据层自检
 * 用 node 直接加载生成器（不需要 canvas / 平台层），
 * 断言 7 关「数据合法 + 可解 + 与 par 一致 + 确定性 + 线性难度曲线(4→10)」。
 *
 * 运行：node test/bottle.verify.js
 */
(function () {
  var path = require('path');
  var root = path.resolve(__dirname, '..');
  // ns.js 把工具挂到 globalThis.BF 上；这里先建好 BF 命名空间再 require。
  global.BF = {};
  require(path.join(root, 'js/core/ns.js'));
  require(path.join(root, 'js/game/bottle.js'));

  var BF = global.BF;
  var Gen = BF.BottleGen;
  var issues = [];
  var TOTAL = Gen.TOTAL;
  var COUNTS = Gen.COUNTS;

  function uniq(a) {
    var s = {}; for (var i = 0; i < a.length; i++) { if (s[a[i]]) { return false; } s[a[i]] = 1; }
    return true;
  }
  function isPermOf(a, b) {
    if (a.length !== b.length) { return false; }
    var x = a.slice().sort(), y = b.slice().sort();
    for (var i = 0; i < x.length; i++) { if (x[i] !== y[i]) { return false; } }
    return true;
  }
  function correctCount(order, target) {
    var c = 0; for (var i = 0; i < order.length; i++) { if (order[i] === target[i]) { c++; } } return c;
  }
  /** 模拟「每次把正确颜色换到当前位置」的贪心，应恰好用 par 次交换还原 */
  function greedySwaps(target, player) {
    var arr = player.slice(), n = target.length, swaps = 0, i;
    for (i = 0; i < n; i++) {
      if (arr[i] === target[i]) { continue; }
      var k = arr.indexOf(target[i]);
      var t = arr[i]; arr[i] = arr[k]; arr[k] = t; swaps++;
    }
    return { ok: arr.join(',') === target.join(','), swaps: swaps };
  }

  for (var n = 1; n <= TOTAL; n++) {
    var p = Gen.build(n);
    var tag = 'L' + n;

    // 线性难度曲线：第 n 关瓶子数应为 COUNTS[n-1]
    if (COUNTS[n - 1] !== p.count) {
      issues.push(tag + ' 瓶子数应为 ' + COUNTS[n - 1] + '，实际 ' + p.count);
    }
    if (p.count < 4 || p.count > 10) { issues.push(tag + ' 瓶子数越界: ' + p.count); }

    if (p.target.length !== p.count) { issues.push(tag + ' target 长度≠count'); }
    if (p.player.length !== p.count) { issues.push(tag + ' player 长度≠count'); }
    if (!uniq(p.target)) { issues.push(tag + ' target 颜色有重复（应全不同）'); }
    if (!isPermOf(p.target, p.player)) { issues.push(tag + ' player 不是 target 的排列'); }

    var initCorrect = correctCount(p.player, p.target);
    if (initCorrect >= p.count) { issues.push(tag + ' 初始已经是解（没得玩）'); }

    if (typeof p.par !== 'number' || p.par < 1) { issues.push(tag + ' par 非法: ' + p.par); }
    else {
      var sim = greedySwaps(p.target, p.player);
      if (!sim.ok) { issues.push(tag + ' 贪心没能还原（数据不可解）'); }
      if (sim.swaps !== p.par) { issues.push(tag + ' 贪心交换数 ' + sim.swaps + ' ≠ par ' + p.par); }
    }

    // 确定性：同 n 永远同一题
    var p2 = Gen.build(n);
    if (p2.target.join(',') !== p.target.join(',') || p2.player.join(',') !== p.player.join(',')) {
      issues.push(tag + ' 确定性失败（两次 build 不一致）');
    }
  }

  // 每日挑战：能出题且合法
  var d = Gen.buildDaily(new Date());
  if (!d || d.target.length < 4) { issues.push('buildDaily 出题失败'); }
  else if (!uniq(d.target) || !isPermOf(d.target, d.player)) { issues.push('buildDaily 数据非法'); }

  // 输出
  console.log('每关瓶子数: ' + COUNTS.join(','));
  console.log('par 抽样: L1=' + Gen.build(1).par +
    ' L4=' + Gen.build(4).par + ' L7=' + Gen.build(7).par);

  if (issues.length) {
    console.error('\n❌ 发现问题 ' + issues.length + ' 条:');
    for (var i = 0; i < issues.length; i++) { console.error('  - ' + issues[i]); }
    process.exit(1);
  } else {
    console.log('\n✅ 瓶子颜色推理：7 关全部合规（数据合法 / 可解 / par 一致 / 确定性 / 线性难度 4→10）');
  }
})();
