/**
 * tadpole.verify.js —— 盯蝌蚪 数据层断言（node 直载，无 canvas）
 * 覆盖：每关 N/标记数/防送分位移、确定性、每日、难度单调、starsFor 边界、rules 合规。
 */
global.BF = {};
require('../js/core/ns.js');
require('../js/game/tadpole.js');

var BF = global.BF;
var G = BF.TadpoleGen;
var fail = 0, pass = 0;
function check(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.log('  ❌ ' + msg); }
}
function dist(a, b) { var dx = a.sx - b.ex, dy = a.sy - b.ey; return Math.sqrt(dx * dx + dy * dy); }
function mov(t) { var dx = t.ex - t.sx, dy = t.ey - t.sy; return Math.sqrt(dx * dx + dy * dy); }

var TOTAL = G.TOTAL;

// 逐关检查
for (var L = 1; L <= TOTAL; L++) {
  var g = G.build(L);
  var i = L - 1;

  check(g.N === G.N_PER_LEVEL[i], '第' + L + '关 N=' + g.N + ' 应等于表 ' + G.N_PER_LEVEL[i]);
  check(g.markCount === G.MARK_PER_LEVEL[i], '第' + L + '关 markCount=' + g.markCount + ' 应等于表 ' + G.MARK_PER_LEVEL[i]);
  check(g.observeMs === G.OBSERVE_MS[i], '第' + L + '关 observeMs 匹配');
  check(g.shuffleMs === G.SHUFFLE_MS[i], '第' + L + '关 shuffleMs 匹配');
  check(g.answerMs === G.ANSWER_MS[i], '第' + L + '关 answerMs 匹配');

  check(g.tadpoles.length === g.N, '第' + L + '关 tadpoles 数=N');
  check(g.markedIds.length === g.markCount, '第' + L + '关 markedIds 数=markCount');

  // markedIds 互异且 < N
  var seen = {}; var okRange = true; var okDup = true;
  for (var k = 0; k < g.markedIds.length; k++) {
    var id = g.markedIds[k];
    if (id < 0 || id >= g.N) { okRange = false; }
    if (seen[id]) { okDup = false; } seen[id] = true;
  }
  check(okRange, '第' + L + '关 markedIds 均在 [0,N)');
  check(okDup, '第' + L + '关 markedIds 互异');
  check(g.markCount <= g.N, '第' + L + '关 markCount<=N');

  // 防送分：每只被标记蝌蚪打乱后位移 ≥ MIN_MOVE
  var minMoveOK = true;
  for (var t = 0; t < g.tadpoles.length; t++) {
    var tp = g.tadpoles[t];
    if (tp.marked && mov(tp) < G.MIN_MOVE - 1e-9) { minMoveOK = false; }
  }
  check(minMoveOK, '第' + L + '关 每只被标记蝌蚪位移 ≥ MIN_MOVE(' + G.MIN_MOVE + ')');

  // 每只蝌蚪坐标在 [0,1]
  var inRange = true;
  for (var t2 = 0; t2 < g.tadpoles.length; t2++) {
    var q = g.tadpoles[t2];
    if (q.sx < 0 || q.sx > 1 || q.sy < 0 || q.sy > 1 || q.ex < 0 || q.ex > 1 || q.ey < 0 || q.ey > 1) { inRange = false; }
  }
  check(inRange, '第' + L + '关 坐标均在 [0,1]');
}

// 确定性：同 level 两次完全一致
for (var L2 = 1; L2 <= TOTAL; L2++) {
  var a = G.build(L2), b = G.build(L2);
  var same = JSON.stringify(a.markedIds) === JSON.stringify(b.markedIds)
    && JSON.stringify(a.tadpoles) === JSON.stringify(b.tadpoles);
  check(same, '第' + L2 + '关 生成确定性（两次一致）');
}

// 难度单调：N↑、markCount↑、observe↓、shuffle↓、answer↓
for (var L3 = 2; L3 <= TOTAL; L3++) {
  var p0 = G.paramsForLevel(L3 - 1), p1 = G.paramsForLevel(L3);
  check(p1.N >= p0.N, '第' + (L3 - 1) + '→' + L3 + ' 关 N 单调不减');
  check(p1.markCount >= p0.markCount, '第' + (L3 - 1) + '→' + L3 + ' 关 markCount 单调不减');
  check(p1.observeMs <= p0.observeMs, '第' + (L3 - 1) + '→' + L3 + ' 关 observe 单调不增');
  check(p1.shuffleMs <= p0.shuffleMs, '第' + (L3 - 1) + '→' + L3 + ' 关 shuffle 单调不增');
  check(p1.answerMs <= p0.answerMs, '第' + (L3 - 1) + '→' + L3 + ' 关 answer 单调不增');
}

// 后段动画时长护栏（2026-11-13 第五轮「后面的关卡动画时间可以稍微多一点」）：
// 11~15 关是 16 只蝌蚪 / 4 目标最挤的一档，游动窗口不得被压回 3.5s 短窗口，
// 也不许重新出现「逐关陡降」把短时长当难度轴。
check(G.SHUFFLE_MS[0] - G.SHUFFLE_MS[TOTAL - 1] <= 400,
  '游动倒计时全程降幅应 ≤400ms（保持缓降，不把短窗口当难度轴）');
for (var L4 = 11; L4 <= TOTAL; L4++) {
  check(G.paramsForLevel(L4).shuffleMs >= 4100,
    '第' + L4 + '关后段游动倒计时应 ≥4100ms');
}
check(G.buildDaily().shuffleMs >= 4100, '每日挑战游动倒计时应同步后段口径');

// starsFor 边界
check(G.starsFor(0, 0) === 3, 'starsFor(0,0)=3');
check(G.starsFor(1, 0) === 2, 'starsFor(1,0)=2');
check(G.starsFor(3, 0) === 1, 'starsFor(3,0)=1');
check(G.starsFor(0, 1) === 2, 'starsFor(0,1)=2（提示降星）');
check(G.starsFor(0, 2) === 1, 'starsFor(0,2)=1（双提示降星）');

// rules 合规（5 行、每行 ≤30 字）
var rules = BF.games.tadpole.rules;
check(rules && rules.lines.length === 5, 'rules 恰 5 行');
var linesOK = rules.lines.every(function (s) { return s.length <= 30; });
check(linesOK, 'rules 每行 ≤30 字');

// 每日挑战：非送命题 + 参数
var d = G.buildDaily();
check(d.N === 12 && d.markCount === 3, '每日挑战 N=12/mark=3');
var dmin = true;
for (var dt = 0; dt < d.tadpoles.length; dt++) { if (d.tadpoles[dt].marked && mov(d.tadpoles[dt]) < G.MIN_MOVE - 1e-9) { dmin = false; } }
check(dmin, '每日挑战 防送分（被标记位移≥MIN_MOVE）');

console.log('盯蝌蚪 data verify: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
