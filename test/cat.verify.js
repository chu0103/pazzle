/**
 * cat.verify.js —— 「猫猫方块」数据层自检（游戏 14）
 *
 * 用 node 直接加载生成器（不需要 canvas / 平台层），断言：
 *   - 8 关（TOTAL=8）每关生成的盘面：尺寸正确、区域划分合法（N 区、每区连通、每区恰含 1 解位）
 *   - 生成的 solution 本身就是一组合法猫位（每行每列各 1、互不 8 相邻）→ 证明「必有解」
 *   - 每个 solution 位落在该色区域内（解位 ∈ 区域，区域划分与解一致）
 *   - 确定性：同关 build(level) 两次结果完全一致
 *   - 区域数组：每格颜色 ∈ [0,N)、每种颜色恰出现（构成合法分治）
 *   - 玩法说明文案：rules.lines 5 条、每条 ≤ 30 字
 *
 * 运行：node test/cat.verify.js
 */
(function () {
  var path = require('path');
  var root = path.resolve(__dirname, '..');
  global.BF = {};
  require(path.join(root, 'js/core/ns.js'));
  require(path.join(root, 'js/game/cat.js'));

  var BF = global.BF;
  var Gen = BF.CatGen;
  var issues = [];

  function eq2d(a, b) {
    if (a.length !== b.length) { return false; }
    for (var r = 0; r < a.length; r++) {
      if (a[r].length !== b[r].length) { return false; }
      for (var c = 0; c < a[r].length; c++) { if (a[r][c] !== b[r][c]) { return false; } }
    }
    return true;
  }

  // 基本契约
  if (!Gen || !Gen.build) { issues.push('BF.CatGen 缺失'); }
  if (Gen.TOTAL !== 8) { issues.push('TOTAL 应为 8，实际 ' + Gen.TOTAL); }
  if (!Gen.COLORS || Gen.COLORS.length < 8) { issues.push('配色少于 8 种'); }

  // 逐关校验
  for (var lv = 1; lv <= Gen.TOTAL; lv++) {
    var g = Gen.build(lv);
    var N = g.size;
    if (N !== Gen.sizeForLevel(lv)) { issues.push('第' + lv + '关尺寸与 sizeForLevel 不符'); }
    if (g.region.length !== N) { issues.push('第' + lv + '关 region 行数错'); }
    for (var r = 0; r < N; r++) {
      if (g.region[r].length !== N) { issues.push('第' + lv + '关 region 列数错'); break; }
    }
    // 区域划分合法
    if (!Gen.validPartition(N, g.region, g.sol)) {
      issues.push('第' + lv + '关区域划分非法（需 N 区、每区连通、每区恰含 1 解位）');
    }
    // solution 是合法完整猫位
    if (g.sol.length !== N) { issues.push('第' + lv + '关解位数量≠N'); }
    if (!Gen.validPlacement(g.sol)) {
      issues.push('第' + lv + '关解位非法（需每行每列各1、互不8相邻）—— 违反「必有解」');
    }
    // 解位 ∈ 所属区域
    for (var k = 0; k < N; k++) {
      var s = g.sol[k];
      if (g.region[s.r][s.c] !== k) {
        issues.push('第' + lv + '关：第 ' + k + ' 色解位 (' + s.r + ',' + s.c + ') 不在该色区域内');
      }
    }
    // 颜色覆盖：每种颜色都出现、且均在 [0,N)
    var seen = {};
    for (var r2 = 0; r2 < N; r2++) {
      for (var c2 = 0; c2 < N; c2++) {
        var col = g.region[r2][c2];
        if (col < 0 || col >= N) { issues.push('第' + lv + '关区域含越界颜色 ' + col); }
        seen[col] = 1;
      }
    }
    for (var kk = 0; kk < N; kk++) { if (!seen[kk]) { issues.push('第' + lv + '关颜色 ' + kk + ' 未出现'); } }
    // 确定性
    var g2 = Gen.build(lv);
    if (!eq2d(g.region, g2.region)) { issues.push('第' + lv + '关 build 非确定性'); }
    if (JSON.stringify(g.sol) !== JSON.stringify(g2.sol)) { issues.push('第' + lv + '关 sol 非确定性'); }
  }

  // 尺寸梯度：第 1-2 关 6、3-4 关 7、5-8 关 8
  var expectSizes = [6, 6, 7, 7, 8, 8, 8, 8];
  for (var i = 0; i < 8; i++) {
    if (Gen.build(i + 1).size !== expectSizes[i]) {
      issues.push('第' + (i + 1) + '关尺寸应为 ' + expectSizes[i] + '，实际 ' + Gen.build(i + 1).size);
    }
  }

  // 规则文案
  var rules = BF.games.cat.rules;
  if (!rules || !rules.lines || rules.lines.length !== 5) {
    issues.push('猫猫方块规则文案应为 5 条，实际 ' + (rules && rules.lines ? rules.lines.length : '缺失'));
  } else {
    for (var li = 0; li < rules.lines.length; li++) {
      if (rules.lines[li].length > 30) { issues.push('规则第 ' + (li + 1) + ' 条超 30 字：' + rules.lines[li]); }
    }
    if (!rules.sub) { issues.push('规则缺少副标题 sub'); }
  }

  if (issues.length) {
    console.error('❌ 猫猫方块数据层问题 ' + issues.length + ' 条:');
    for (var z = 0; z < issues.length; z++) { console.error('  - ' + issues[z]); }
    process.exit(1);
  }
  console.log('✅ 猫猫方块 · 数据层全过：8 关（TOTAL=8）每关区域划分合法（N 区·每区连通·每区恰含1解位）/ 生成的 solution 即合法完整猫位——必有解 / 解位∈所属区域 / 颜色覆盖完整 / build 确定性 / 尺寸梯度 6→6→7→7→8→8→8→8 / 规则文案 5 条≤30 字');
})();
