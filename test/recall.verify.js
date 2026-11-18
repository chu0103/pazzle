/**
 * recall.verify.js —— 瞬时记忆 数据层断言（node 直载，无 canvas）
 *
 * 重点：题目公平性。对每道题**独立从场景属性重新推导真值**（不复读生成器的
 * revealText），再断言：
 *   - 答案唯一：options 里恰好一个等于真值，且 answerIndex 指向它；
 *   - 干扰项确实不成立：其余选项都 ≠ 真值，二选一题选项集合固定；
 *   - 指向题回算一致且与第二名角差 ≥ MIN_ANGLE_GAP。
 * 另覆盖：15 关难度表、每 kind 唯一、格点不重叠、确定性、每日、单调缓降、
 * starsFor 边界、rules 合规。
 */
global.BF = {};
require('../js/core/ns.js');
require('../js/game/recall.js');

var BF = global.BF;
var G = BF.RecallGen;
var fail = 0, pass = 0;
function check(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.log('  ❌ ' + msg); }
}

/* ---------- 独立真值推导 ---------- */

function byId(scene, id) {
  for (var i = 0; i < scene.items.length; i++) { if (scene.items[i].id === id) { return scene.items[i]; } }
  return null;
}
function byName(scene, name) {
  for (var i = 0; i < scene.items.length; i++) { if (scene.items[i].name === name) { return scene.items[i]; } }
  return null;
}
function byKind(scene, kind) { return byId(scene, kind); }
function countColor(scene, col) {
  var n = 0;
  for (var i = 0; i < scene.items.length; i++) { if (scene.items[i].colorName === col) { n++; } }
  return n;
}
/** 从题目文字 + 场景属性独立算出「正确答案应该是什么」 */
function truthOf(scene, q) {
  var t = q.text, it, col;
  if (q.type === 'color') {
    it = byName(scene, t.slice(3, t.indexOf('是什么颜色')));
    return it ? it.colorName : null;
  }
  if (q.type === 'exist') {
    var body = t.slice(t.indexOf('有没有') + 3, t.indexOf('？'));
    col = body.slice(0, 2);
    it = byName(scene, body.slice(2));
    return (it && it.colorName === col) ? '有' : '没有';
  }
  if (q.type === 'state') {
    it = byName(scene, t.slice(3, t.indexOf('是打开还是关闭')));
    return it ? G.STATE_NAMES[it.state] : null;
  }
  if (q.type === 'label') {
    var ticket = byKind(scene, 'ticket');
    if (!ticket) { return null; }
    if (t.indexOf('目的地') >= 0) { return ticket.dest; }
    if (t.indexOf('车次') >= 0) { return ticket.train; }
    if (t.indexOf('出发站') >= 0) { return ticket.from; }
    return null;
  }
  if (q.type === 'count') {
    col = t.slice(5, t.indexOf('的物品'));
    return countColor(scene, col);
  }
  if (q.type === 'position') {
    it = byName(scene, t.slice(3, t.indexOf('在卡片')));
    return it ? (it.x < 0.5 ? '左半边' : '右半边') : null;
  }
  if (q.type === 'spatial') {
    var p = G.resolvePointing(scene);
    var tgt = p && byId(scene, p.targetId);
    return tgt ? tgt.name : null;
  }
  return null;
}

var ALL_COLOR_NAMES = G.COLORS.map(function (c) { return c.name; });
var ALL_KIND_NAMES = G.KINDS.map(function (k) { return k.name; });

/* ---------- 逐关检查 ---------- */

for (var L = 1; L <= G.TOTAL; L++) {
  var g = G.build(L);
  var p = G.paramsForLevel(L);
  var tag = '第' + L + '关';

  // 档位表
  check(g.N === p.N && g.N === G.N_PER_LEVEL[L - 1], tag + ' 物品数 N 匹配档位表');
  check(g.M === p.M, tag + ' 题数 M 匹配档位表');
  check(g.observeMs === G.OBSERVE_MS[L - 1], tag + ' 观察时长匹配档位表');
  check(g.answerMs === G.ANSWER_MS[L - 1], tag + ' 作答时长匹配档位表');
  check(g.revealMs === G.REVEAL_MS, tag + ' 揭晓时长=REVEAL_MS');
  check(g.types.length === G.TYPES_BY_TIER[G.tierOf(L)].length, tag + ' 题型解锁档位正确');

  // 场景结构
  check(g.items.length === g.N, tag + ' 物品数=N');
  check(g.questions.length === g.M, tag + ' 出题数=M');
  var kindSeen = {}, kindUnique = true;
  for (var a = 0; a < g.items.length; a++) {
    if (kindSeen[g.items[a].kind]) { kindUnique = false; }
    kindSeen[g.items[a].kind] = 1;
  }
  check(kindUnique, tag + ' 每种 kind 至多 1 件（颜色/有无题答案唯一的前提）');

  // 坐标范围 + 格点不重叠
  var inRange = true, noOverlap = true;
  for (var b = 0; b < g.items.length; b++) {
    var it = g.items[b];
    if (it.x < 0.08 || it.x > 0.92 || it.y < 0.08 || it.y > 0.92) { inRange = false; }
    for (var c = b + 1; c < g.items.length; c++) {
      var dx = it.x - g.items[c].x, dy = it.y - g.items[c].y;
      if (Math.sqrt(dx * dx + dy * dy) < 0.16) { noOverlap = false; }
    }
  }
  check(inRange, tag + ' 物品坐标在 [0.08,0.92]');
  check(noOverlap, tag + ' 物品两两归一化距离 ≥0.16（不重叠）');

  // 至少 3 种颜色（数量题才有区分度）
  var cols = {};
  for (var d = 0; d < g.items.length; d++) { cols[g.items[d].colorName] = 1; }
  check(Object.keys(cols).length >= 3, tag + ' 场景至少 3 种颜色');

  // 车票字段合法
  var tk = byKind(g, 'ticket');
  if (tk) {
    check(G.STATIONS.indexOf(tk.dest) >= 0, tag + ' 车票目的地来自站名池');
    check(G.TRAINS.indexOf(tk.train) >= 0, tag + ' 车票车次来自车次池');
    check(tk.dest !== tk.from, tag + ' 车票出发站 ≠ 目的地');
  }
  // 开合状态合法
  for (var e2 = 0; e2 < g.items.length; e2++) {
    if (g.items[e2].state) {
      check(g.items[e2].state === 'open' || g.items[e2].state === 'closed', tag + ' 开合状态合法');
    }
  }

  // 指向题：rot 回算唯一 + 角差达标
  if (g.pointing) {
    var rp = G.resolvePointing(g);
    check(rp && rp.targetId === g.pointing.targetId, tag + ' 笔尖指向回算一致');
    check(rp && rp.second >= G.MIN_ANGLE_GAP - 1e-9,
      tag + ' 指向题第二名角差 ≥ MIN_ANGLE_GAP（无歧义）');
    check(Math.abs(g.items.filter(function (x) { return x.kind === 'pen'; })[0].rot - g.pointing.rot) < 1e-9,
      tag + ' pen.rot 与 pointing.rot 一致');
  }

  // 逐题：答案唯一 / 干扰项不成立 / 选项数 / 题型已解锁
  var typesUsed = {};
  for (var qi = 0; qi < g.questions.length; qi++) {
    var q = g.questions[qi];
    var qtag = tag + ' 第' + (qi + 1) + '题(' + q.type + ')';
    typesUsed[q.type] = 1;
    check(g.types.indexOf(q.type) >= 0, qtag + ' 题型属于本档已解锁集合');

    check(Array.isArray(q.options) && q.options.length >= 2, qtag + ' 选项数 ≥2');
    check(q.options.length <= p.optCount, qtag + ' 选项数 ≤ 本档 optCount');
    check(q.answerIndex >= 0 && q.answerIndex < q.options.length, qtag + ' answerIndex 合法');

    var truth = truthOf(g, q);
    check(truth !== null, qtag + ' 能从场景独立推导出真值');
    if (truth === null) { continue; }

    var hits = 0;
    for (var oi = 0; oi < q.options.length; oi++) { if (q.options[oi] === truth) { hits++; } }
    check(hits === 1, qtag + ' 答案唯一（恰 1 个选项等于真值 ' + truth + '）');
    check(q.options[q.answerIndex] === truth, qtag + ' answerIndex 指向正确答案');
    check(q.revealText === truth, qtag + ' revealText 与真值一致');

    // 干扰项确实不成立
    var wrongOk = true;
    for (var wi = 0; wi < q.options.length; wi++) {
      if (wi !== q.answerIndex && q.options[wi] === truth) { wrongOk = false; }
    }
    check(wrongOk, qtag + ' 干扰项均不等于真值');
    var optUniq = (function (arr) {
      var s = {}; for (var z = 0; z < arr.length; z++) { if (s[arr[z]]) { return false; } s[arr[z]] = 1; }
      return true;
    })(q.options);
    check(optUniq, qtag + ' 选项互不重复');

    // 二选一题：选项集合必须恰好是这两个
    if (q.type === 'exist') {
      check(q.options.indexOf('有') >= 0 && q.options.indexOf('没有') >= 0 && q.options.length === 2,
        qtag + ' 有无题选项集合={有,没有}');
    }
    if (q.type === 'state') {
      check(q.options.indexOf('打开') >= 0 && q.options.indexOf('关闭') >= 0 && q.options.length === 2,
        qtag + ' 状态题选项集合={打开,关闭}');
    }
    if (q.type === 'position') {
      check(q.options.indexOf('左半边') >= 0 && q.options.indexOf('右半边') >= 0 && q.options.length === 2,
        qtag + ' 方位题选项集合={左半边,右半边}');
      var pit = byName(g, q.text.slice(3, q.text.indexOf('在卡片')));
      check(pit && Math.abs(pit.x - 0.5) >= 0.12, qtag + ' 方位题物品离中线 ≥0.12（无歧义）');
    }
    if (q.type === 'color') {
      check(ALL_COLOR_NAMES.indexOf(truth) >= 0, qtag + ' 颜色答案来自颜色池');
      for (var ci = 0; ci < q.options.length; ci++) {
        if (q.options[ci] !== truth) {
          check(ALL_COLOR_NAMES.indexOf(q.options[ci]) >= 0, qtag + ' 颜色干扰项来自颜色池');
        }
      }
    }
    if (q.type === 'label') {
      var pool = q.text.indexOf('车次') >= 0 ? G.TRAINS : G.STATIONS;
      for (var li = 0; li < q.options.length; li++) {
        check(pool.indexOf(q.options[li]) >= 0, qtag + ' 文字细节选项来自对应池');
      }
    }
    if (q.type === 'spatial') {
      for (var si = 0; si < q.options.length; si++) {
        check(ALL_KIND_NAMES.indexOf(q.options[si]) >= 0, qtag + ' 指向题选项是物品名');
      }
      var rp2 = G.resolvePointing(g);
      check(rp2 && rp2.second >= G.MIN_ANGLE_GAP - 1e-9, qtag + ' 指向题角差达标');
    }
    // targetId 必须是场景里真实存在的物品（揭晓特写要用到）
    check(q.targetId === null || !!byId(g, q.targetId), qtag + ' targetId 指向真实物品');
  }

  // 题型分散：一关不应 M 题全是同一类型
  check(Object.keys(typesUsed).length >= 2, tag + ' 一关至少 2 种题型');
}

/* ---------- 确定性 ---------- */
for (var L2 = 1; L2 <= G.TOTAL; L2++) {
  check(JSON.stringify(G.build(L2)) === JSON.stringify(G.build(L2)),
    '第' + L2 + '关 build(level) 两次完全一致（确定性）');
}
var d1 = G.buildDaily(), d2 = G.buildDaily();
check(JSON.stringify(d1) === JSON.stringify(d2), 'buildDaily 当天同题');
check(d1.daily === true && d1.level === 0, 'buildDaily 标记为每日');
check(d1.N === 8 && d1.M === 4, 'buildDaily 采用进阶档 N=8/M=4');
check(d1.questions.length === 4, 'buildDaily 题目数=4');
check(G.build(1).questions[0].text !== undefined, 'build 产出题目文本');

/* ---------- 难度单调 + 缓降 ---------- */
var monoN = true, monoM = true, monoObs = true, monoAns = true, monoOpt = true;
for (var k = 1; k < G.TOTAL; k++) {
  if (G.N_PER_LEVEL[k] < G.N_PER_LEVEL[k - 1]) { monoN = false; }
  if (G.Q_PER_LEVEL[k] < G.Q_PER_LEVEL[k - 1]) { monoM = false; }
  if (G.OBSERVE_MS[k] > G.OBSERVE_MS[k - 1]) { monoObs = false; }
  if (G.ANSWER_MS[k] > G.ANSWER_MS[k - 1]) { monoAns = false; }
  if (G.OPT_PER_LEVEL[k] < G.OPT_PER_LEVEL[k - 1]) { monoOpt = false; }
}
check(monoN, '物品数 N 逐关不减');
check(monoM, '题数 M 逐关不减');
check(monoOpt, '选项数逐关不减');
check(monoObs, '观察时长逐关不增');
check(monoAns, '作答时长逐关不增');
check(G.OBSERVE_MS[0] - G.OBSERVE_MS[14] <= 2000, '观察时长全程降幅 ≤2000ms（缓降，不靠压缩时间提难度）');
check(G.ANSWER_MS[0] - G.ANSWER_MS[14] <= 1000, '作答时长全程降幅 ≤1000ms（缓降）');
var lateOk = true;
for (var z = 10; z < 15; z++) {
  if (G.OBSERVE_MS[z] < 6000 || G.ANSWER_MS[z] < 5000) { lateOk = false; }
}
check(lateOk, '后段 11-15 关观察 ≥6000ms / 作答 ≥5000ms');
check(G.TYPES_BY_TIER[0].length < G.TYPES_BY_TIER[1].length &&
      G.TYPES_BY_TIER[1].length < G.TYPES_BY_TIER[2].length, '题型逐档严格解锁');

/* ---------- 越界 level 兜底 ---------- */
check(G.build(0).level === 1 && G.build(99).level === 15, '越界 level 被 clamp 到 [1,15]');

/* ---------- starsFor 边界 ---------- */
check(G.starsFor(0, 0) === 3, 'starsFor(0,0)=3');
check(G.starsFor(1, 0) === 2, 'starsFor(1,0)=2');
check(G.starsFor(2, 0) === 2, 'starsFor(2,0)=2');
check(G.starsFor(3, 0) === 1, 'starsFor(3,0)=1');
check(G.starsFor(0, 1) === 2, 'starsFor(0,1)=2（提示降星）');
check(G.starsFor(0, 2) === 1, 'starsFor(0,2)=1');

/* ---------- 注册与规则文案 ---------- */
var meta = BF.games.recall;
check(!!meta && meta.scene === 'recall' && meta.TOTAL === 15, 'BF.games.recall 注册正确');
check(meta.title === '瞬时记忆', '标题=瞬时记忆');
check(!!meta.rules && meta.rules.lines.length === 5, 'rules 恰好 5 行');
for (var ri = 0; ri < meta.rules.lines.length; ri++) {
  check(meta.rules.lines[ri].length <= 30, 'rules 第' + (ri + 1) + '行 ≤30 字');
}
check(typeof meta.buildDaily === 'function', '注册了 buildDaily');

console.log('=== 瞬时记忆 · 数据层断言 ===');
console.log((fail === 0 ? '✓ 全部通过' : '✗ 存在失败') + '：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
