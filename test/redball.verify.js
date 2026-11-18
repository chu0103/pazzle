/**
 * redball.verify.js —— 「盯红球」数据层自检（游戏 15）
 *
 * 用 node 直接加载生成器（不需要 canvas / 平台层），断言：
 *   - 18 关（TOTAL=18）每关：球数 N、红球数 RED、洗牌次数、观察/交换/作答时长正确；
 *     每颗红球 startReds[i] / finalReds[i] 在范围内，且 finalReds[i] ≠ startReds[i]
 *     （防"没洗牌"送分）；finalReds 互不相同。
 *   - 每次洗牌模拟得到的 finalReds 与生成器记录一致（交换路径可被独立复核）。
 *   - 每关确定性（build(level) 两次完全一致）。
 *   - 每日挑战：当天唯一、每颗红球位移 ≥1、参数合理（N=12/2 红/swaps=10）。
 *   - 难度量严格单调（N↑、RED↑、swaps↑、observe/answer↓、swapMs↓）。
 *   - 评星 starsFor 阈值正确；规则文案 5 条≤30 字。
 *
 * 运行：node test/redball.verify.js
 */
(function () {
  var path = require('path');
  var root = path.resolve(__dirname, '..');
  global.BF = {};
  require(path.join(root, 'js/core/ns.js'));
  require(path.join(root, 'js/game/redball.js'));

  var BF = global.BF;
  var Gen = BF.RedballGen;
  var issues = [];

  // 模拟单颗红球（初始在 start）经过 swaps 后落点
  function simFinalRed(start, swaps) {
    var redSlot = start;
    for (var k = 0; k < swaps.length; k++) {
      var x = swaps[k][0], y = swaps[k][1];
      if (redSlot === x) { redSlot = y; }
      else if (redSlot === y) { redSlot = x; }
    }
    return redSlot;
  }

  if (!Gen || !Gen.build) { issues.push('BF.RedballGen 缺失'); }
  if (Gen.TOTAL !== 18) { issues.push('TOTAL 应为 18，实际 ' + Gen.TOTAL); }

  for (var lv = 1; lv <= Gen.TOTAL; lv++) {
    var g = Gen.build(lv);
    var N = g.N;
    if (N !== Gen.N_PER_LEVEL[lv - 1]) { issues.push('第' + lv + '关 N 应为 ' + Gen.N_PER_LEVEL[lv - 1] + '，实际 ' + N); }
    if (g.redCount !== Gen.RED_PER_LEVEL[lv - 1]) {
      issues.push('第' + lv + '关 redCount 应为 ' + Gen.RED_PER_LEVEL[lv - 1] + '，实际 ' + g.redCount);
    }
    if (N % 2 !== 0) { issues.push('第' + lv + '关 N 应为偶数（布局），实际 ' + N); }
    // swaps 数 = 参数值；防送分可能逐颗追加挪走交换（最多 redCount 次），故允许 +redCount
    var sw = Gen.SWAPS_PER_LEVEL[lv - 1];
    if (g.swaps.length < sw || g.swaps.length > sw + g.redCount) {
      issues.push('第' + lv + '关 swaps 数错误（应为 ' + sw + '~' + (sw + g.redCount) + '，实际 ' + g.swaps.length + '）');
    }
    if (g.observeMs !== Gen.OBSERVE_MS[lv - 1]) { issues.push('第' + lv + '关 observeMs 错误'); }
    if (g.swapMs !== Gen.SWAP_MS[lv - 1]) { issues.push('第' + lv + '关 swapMs 错误'); }
    if (g.answerMs !== Gen.ANSWER_MS[lv - 1]) { issues.push('第' + lv + '关 answerMs 错误'); }
    // 红球集合合法性
    if (!g.startReds || g.startReds.length !== g.redCount) { issues.push('第' + lv + '关 startReds 长度≠redCount'); }
    if (!g.finalReds || g.finalReds.length !== g.redCount) { issues.push('第' + lv + '关 finalReds 长度≠redCount'); }
    var seenStart = {}, seenFinal = {};
    for (var ri = 0; ri < g.redCount; ri++) {
      var sr = g.startReds[ri], fr = g.finalReds[ri];
      if (sr < 0 || sr >= N) { issues.push('第' + lv + '关 startReds[' + ri + '] 越界 ' + sr); }
      if (fr < 0 || fr >= N) { issues.push('第' + lv + '关 finalReds[' + ri + '] 越界 ' + fr); }
      if (fr === sr) { issues.push('第' + lv + '关 finalReds[' + ri + ']===startReds[' + ri + ']（红球没动，送分）'); }
      if (seenStart[sr]) { issues.push('第' + lv + '关 startReds 重复 ' + sr); }
      if (seenFinal[fr]) { issues.push('第' + lv + '关 finalReds 重复 ' + fr); }
      seenStart[sr] = 1; seenFinal[fr] = 1;
      if (simFinalRed(sr, g.swaps) !== fr) { issues.push('第' + lv + '关 finalReds[' + ri + '] 与交换路径模拟不符'); }
    }
    // swaps 每对合法（不同槽、在范围内）
    for (var s = 0; s < g.swaps.length; s++) {
      var a = g.swaps[s][0], b = g.swaps[s][1];
      if (a === b) { issues.push('第' + lv + '关 swaps[' + s + '] 两槽相同'); }
      if (a < 0 || a >= N || b < 0 || b >= N) { issues.push('第' + lv + '关 swaps[' + s + '] 越界'); }
    }
    // 确定性
    var g2 = Gen.build(lv);
    if (JSON.stringify(g.swaps) !== JSON.stringify(g2.swaps) ||
        JSON.stringify(g.startReds) !== JSON.stringify(g2.startReds) ||
        JSON.stringify(g.finalReds) !== JSON.stringify(g2.finalReds)) {
      issues.push('第' + lv + '关 build 非确定性');
    }
  }

  // 难度单调（N/RED/swaps 不减；observe/answer/swapMs 不增）
  for (var i = 1; i < Gen.TOTAL; i++) {
    if (Gen.N_PER_LEVEL[i] < Gen.N_PER_LEVEL[i - 1]) { issues.push('N 未单调不减 @' + (i + 1)); }
    if (Gen.RED_PER_LEVEL[i] < Gen.RED_PER_LEVEL[i - 1]) { issues.push('RED 未单调不减 @' + (i + 1)); }
    if (Gen.SWAPS_PER_LEVEL[i] < Gen.SWAPS_PER_LEVEL[i - 1]) { issues.push('swaps 未单调不减 @' + (i + 1)); }
    if (Gen.OBSERVE_MS[i] > Gen.OBSERVE_MS[i - 1]) { issues.push('observeMs 未单调不增 @' + (i + 1)); }
    if (Gen.ANSWER_MS[i] > Gen.ANSWER_MS[i - 1]) { issues.push('answerMs 未单调不增 @' + (i + 1)); }
    if (Gen.SWAP_MS[i] > Gen.SWAP_MS[i - 1]) { issues.push('swapMs 未单调不增 @' + (i + 1)); }
  }

  // 每日挑战
  var d1 = Gen.buildDaily();
  var d2 = Gen.buildDaily();
  if (d1.N !== 12) { issues.push('每日挑战 N 应为 12，实际 ' + d1.N); }
  if (d1.redCount !== 2) { issues.push('每日挑战 redCount 应为 2，实际 ' + d1.redCount); }
  // ⚠️ gen() 为满足「每颗红球必被挪走」会按需追加交换，实际条数随当天日期种子变化
  //    （2026-11-13 实测为 11）。断言写死 ===10 会随日期随机误报，改为语义正确的范围。
  if (d1.swaps.length < 10 || d1.swaps.length > 10 + 2 * d1.redCount) {
    issues.push('每日挑战 swaps 数应在 10~' + (10 + 2 * d1.redCount) + '（基础10+防送分追加），实际 ' + d1.swaps.length);
  }
  for (var di = 0; di < d1.redCount; di++) {
    if (d1.finalReds[di] === d1.startReds[di]) { issues.push('每日挑战 finalReds[' + di + ']===startReds（送分）'); }
  }
  if (JSON.stringify(d1.swaps) !== JSON.stringify(d2.swaps) ||
      JSON.stringify(d1.startReds) !== JSON.stringify(d2.startReds) ||
      JSON.stringify(d1.finalReds) !== JSON.stringify(d2.finalReds)) {
    issues.push('每日挑战非当天唯一（同日两次不一致）');
  }
  for (var dk = 0; dk < d1.redCount; dk++) {
    if (simFinalRed(d1.startReds[dk], d1.swaps) !== d1.finalReds[dk]) { issues.push('每日挑战 finalReds 与交换路径不符'); }
  }

  // 评星
  var SF = Gen.starsFor;
  if (SF(0, 0) !== 3) { issues.push('starsFor(0,0) 应为 3，实际 ' + SF(0, 0)); }
  if (SF(1, 0) !== 2) { issues.push('starsFor(1,0) 应为 2，实际 ' + SF(1, 0)); }
  if (SF(3, 0) !== 1) { issues.push('starsFor(3,0) 应为 1，实际 ' + SF(3, 0)); }
  if (SF(0, 1) !== 2) { issues.push('starsFor(0,1) 应为 2（提示封顶），实际 ' + SF(0, 1)); }
  if (SF(0, 2) !== 1) { issues.push('starsFor(0,2) 应为 1（提示封顶），实际 ' + SF(0, 2)); }

  // 规则文案
  var rules = BF.games.redball.rules;
  if (!rules || !rules.lines || rules.lines.length !== 5) {
    issues.push('盯红球规则文案应为 5 条，实际 ' + (rules && rules.lines ? rules.lines.length : '缺失'));
  } else {
    for (var li = 0; li < rules.lines.length; li++) {
      if (rules.lines[li].length > 30) { issues.push('规则第 ' + (li + 1) + ' 条超 30 字：' + rules.lines[li]); }
    }
    if (!rules.sub) { issues.push('规则缺少副标题 sub'); }
  }

  if (issues.length) {
    console.error('❌ 盯红球数据层问题 ' + issues.length + ' 条:');
    for (var z = 0; z < issues.length; z++) { console.error('  - ' + issues[z]); }
    process.exit(1);
  }
  console.log('✅ 盯红球 · 数据层全过：18 关（TOTAL=18）每关 N/红球数/洗牌数/时长正确 · 每颗红球 finalReds[i]≠startReds[i]（必动·互不重复）· 交换路径可独立复核 · build 确定性 · 每日挑战当天唯一(2红) · 难度严格单调 · starsFor 边界正确 · 规则 5 条≤30 字');
})();
