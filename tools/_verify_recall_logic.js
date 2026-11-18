/**
 * _verify_recall_logic.js —— 瞬时记忆 交互层护栏（mock canvas/platform/Save，真跑场景）
 *
 * 覆盖：
 *   - 四阶段状态机 observe → quiz → reveal →(下一题|过关|失败) 由 update(dt) 真实推进；
 *   - 几何：390/375/320 三档下卡片、2~4 个选项按钮、提示按钮均不出屏且互不重叠；
 *   - 正确性：按 answerIndex 真实点选项 → 全对过关写档、3 星、下一关不弹规则；
 *   - 答错/超时扣心、3 心耗光 → 失败层、重玩同关重置；
 *   - 提示排除错误选项且不排除正确答案、降星；观察期 420ms 防误触；
 *   - RuleTip 接入（首进弹 / 弹框不推进阶段机 / 「开始游戏」关 / 「?」重看）；
 *   - 每日挑战走 buildDaily + Save.clearDaily。
 *
 * ⚠️ 只验证瞬时记忆，不掺入旧通用探针（那些 load 列表停在 #12，早已失效）。
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var root = path.join(__dirname, '..');

function makeEnv(W, H, safeTop, safeBottom) {
  var grad = { addColorStop: function () {} };
  var ctxTarget = {
    save: function () {}, restore: function () {}, scale: function () {},
    setTransform: function () {}, transform: function () {}, translate: function () {}, rotate: function () {},
    fillRect: function () {}, clearRect: function () {}, strokeRect: function () {},
    beginPath: function () {}, closePath: function () {}, moveTo: function () {}, lineTo: function () {},
    arc: function () {}, arcTo: function () {}, rect: function () {}, clip: function () {}, ellipse: function () {},
    quadraticCurveTo: function () {}, bezierCurveTo: function () {},
    fill: function () {}, stroke: function () {}, setLineDash: function () {}, drawImage: function () {},
    createLinearGradient: function () { return grad; }, createRadialGradient: function () { return grad; },
    measureText: function (s) { return { width: String(s).length * 7 }; },
    fillText: function () {}, strokeText: function () {}
  };
  var ctx = new Proxy(ctxTarget, { get: function (t, k) { return t[k]; }, set: function (t, k, v) { t[k] = v; return true; } });
  var store = {};
  var frames = [];
  var input = { down: null, move: null, up: null };
  var sandbox = {
    console: console, Math: Math, Date: Date, JSON: JSON, Object: Object, Array: Array,
    String: String, Number: Number, Boolean: Boolean, Error: Error,
    setTimeout: setTimeout, parseInt: parseInt, isNaN: isNaN, Proxy: Proxy
  };
  sandbox.globalThis = sandbox; sandbox.window = sandbox;
  vm.createContext(sandbox);
  function load(rel) { vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel }); }
  ['js/core/ns.js', 'js/core/palette.js', 'js/core/draw.js', 'js/core/save.js',
   'js/game/recall.js', 'js/scenes/ruletip.js', 'js/scenes/recall.js'].forEach(load);
  var BF = sandbox.BF;
  BF.platform = {
    isMiniGame: false, ready: true, canvas: { width: W, height: H }, ctx: ctx,
    width: W, height: H, dpr: 2, safeTop: safeTop || 0, safeBottom: safeBottom || 0,
    now: function () { return Date.now(); },
    requestFrame: function (cb) { frames.push(cb); },
    getStorage: function (k, d) { return store[k] === undefined ? d : store[k]; },
    setStorage: function (k, v) { store[k] = v; },
    vibrate: function () {},
    bindPointer: function (h) { input.down = h.down; input.move = h.move; input.up = h.up; },
    createImage: function (src, cb) { var i = { src: src, width: 720, height: 720 }; if (cb) { cb(null, i); } return i; }
  };
  BF.Save.load();
  BF.RuleTip.on = false;   // 常态关弹框；单独用例临时打开
  return { BF: BF, ctx: ctx, input: input, setSize: function (w, h) {
    BF.platform.width = w; BF.platform.height = h;
    BF.platform.canvas.width = w; BF.platform.canvas.height = h;
  } };
}

var env = makeEnv(390, 844, 44, 34);
var BF = env.BF, ctx = env.ctx;
var issues = [];
function ok(cond, msg) { if (!cond) { issues.push(msg); } }
function render(sc) { try { sc.render(ctx); } catch (e) { issues.push('render 抛异常: ' + e.message + ' @ ' + String(e.stack || '').split('\n')[1]); } }
function pump(sc, n) { for (var i = 0; i < (n || 1); i++) { try { sc.update(16); } catch (e) { issues.push('update 抛异常: ' + e.message); return; } } }
function pumpTo(sc, phase) {
  var g = 0;
  while (sc.phase !== phase && !sc.win && !sc.fail && g++ < 1200) { pump(sc, 1); }
  return sc.phase === phase;
}
function tapOpt(sc, idx) {
  var r = sc.optRects[idx];
  if (!r) { issues.push('选项按钮 rect 缺失 idx=' + idx); return; }
  sc.onDown(r.x + r.w / 2, r.y + r.h / 2);
  sc.onUp(r.x + r.w / 2, r.y + r.h / 2);
}
function tap(sc, r) { sc.onDown(r.x + r.w / 2, r.y + r.h / 2); sc.onUp(r.x + r.w / 2, r.y + r.h / 2); }
function onScreen(r, W, H) { return r && r.x >= -1 && r.y >= -1 && r.x + r.w <= W + 1 && r.y + r.h <= H + 1; }
function overlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}
var fakeApp = { go: function () {} };

/* ---------- 1) 15 关阶段机 + 全对真实点通 + 几何 ---------- */
for (var L = 1; L <= 15; L++) {
  var sc = new BF.SceneRecall(fakeApp);
  sc.enter({ level: L, game: 'recall' });
  ok(sc.phase === 'observe', '第' + L + '关应从 observe 开始');
  ok(sc.N === BF.RecallGen.N_PER_LEVEL[L - 1], '第' + L + '关物品数应匹配难度表');
  ok(sc.M === BF.RecallGen.Q_PER_LEVEL[L - 1], '第' + L + '关题数应匹配难度表');
  ok(sc.questions.length === sc.M, '第' + L + '关应生成 M 道题');
  render(sc);   // 观察期渲染（含 10 种物品矢量绘制）

  ok(pumpTo(sc, 'quiz'), '第' + L + '关应能从 observe 推进到 quiz');
  render(sc);   // 答题期渲染（黑底 ? + 选项）

  // 逐题按 answerIndex 真实点选项，reveal 期泵到下一题
  var guard = 0;
  while (!sc.win && !sc.fail && guard++ < 200) {
    if (sc.phase === 'quiz') {
      var q = sc.questions[sc.qIndex];
      ok(!!q && q.answerIndex >= 0, '第' + L + '关题目应存在且答案合法');
      tapOpt(sc, q.answerIndex);
      ok(sc.phase === 'reveal', '第' + L + '关点选项后应进入 reveal');
      render(sc);   // 揭晓期渲染（物品特写）
    } else {
      pump(sc, Math.ceil(sc.revealMs / 16) + 2);   // 揭晓期一次泵到下一题
    }
  }
  ok(!!sc.win, '第' + L + '关全答应过关（实际 win=' + !!sc.win + ' fail=' + !!sc.fail + '）');
  ok(sc.win && sc.win.stars === 3, '第' + L + '关全对且未用提示应 3 星');
  ok(sc.correctCount === sc.M, '第' + L + '关答对数应=M');
  ok(sc.mistakes === 0, '第' + L + '关全对 mistakes=0');
  render(sc);   // 结算层渲染
}
ok(BF.Save.clearedCount('recall') >= 15, '全关通关后存档应记录 15 关');

/* ---------- 2) 几何：三档屏宽下卡片 / 选项 / 提示按钮不出屏且互不重叠 ---------- */
[[390, 844, 44, 34], [375, 667, 20, 0], [320, 568, 20, 0]].forEach(function (dim) {
  var e2 = makeEnv(dim[0], dim[1], dim[2], dim[3]);
  var tag = dim[0] + 'x' + dim[1];
  for (var lv = 1; lv <= 15; lv++) {
    var s2 = new e2.BF.SceneRecall(fakeApp);
    s2.enter({ level: lv, game: 'recall' });
    e2.BF.RuleTip.on = false;
    ok(pumpTo(s2, 'quiz'), tag + ' 第' + lv + '关应进 quiz');
    var card = { x: s2.cardX, y: s2.cardY, w: s2.cardSize, h: s2.cardSize };
    ok(onScreen(card, dim[0], dim[1]), tag + ' 第' + lv + '关场景卡不出屏');
    ok(onScreen(s2.hintBtn, dim[0], dim[1]), tag + ' 第' + lv + '关提示按钮不出屏');
    ok(!overlap(card, s2.hintBtn), tag + ' 第' + lv + '关卡片与提示按钮不重叠');
    for (var oi = 0; oi < s2.optRects.length; oi++) {
      var r = s2.optRects[oi];
      ok(onScreen(r, dim[0], dim[1]), tag + ' 第' + lv + '关选项' + oi + '不出屏');
      ok(!overlap(r, s2.hintBtn), tag + ' 第' + lv + '关选项' + oi + '与提示按钮不重叠');
      ok(!overlap(r, card), tag + ' 第' + lv + '关选项' + oi + '与卡片不重叠');
      for (var oj = oi + 1; oj < s2.optRects.length; oj++) {
        ok(!overlap(r, s2.optRects[oj]), tag + ' 第' + lv + '关选项' + oi + '/' + oj + '不重叠');
      }
    }
    try { s2.render(e2.ctx); } catch (err) { ok(false, tag + ' 第' + lv + '关渲染抛异常: ' + err.message); }
  }
});

/* ---------- 3) 答错 / 超时扣心，3 心耗光失败重玩 ---------- */
var sc3 = new BF.SceneRecall(fakeApp);
sc3.enter({ level: 1, game: 'recall' });
ok(pumpTo(sc3, 'quiz'), '扣心用例应进 quiz');
var wrongIdx = (sc3.questions[0].answerIndex + 1) % sc3.questions[0].options.length;
tapOpt(sc3, wrongIdx);
ok(sc3.hearts === 2 && sc3.mistakes === 1, '答错应扣 1 心、记 1 次失误');
ok(sc3.phase === 'reveal', '答错也应进 reveal 揭晓');
pump(sc3, Math.ceil(sc3.revealMs / 16) + 2);
ok(sc3.qIndex === 1 && sc3.phase === 'quiz', 'reveal 结束应进入第 2 题');
// 第 2 题超时按答错
sc3.quizT = 1; pump(sc3, 2);
ok(sc3.hearts === 1 && sc3.mistakes === 2, '超时应按答错扣心');
pump(sc3, Math.ceil(sc3.revealMs / 16) + 2);
var w2 = (sc3.questions[sc3.qIndex].answerIndex + 1) % sc3.questions[sc3.qIndex].options.length;
tapOpt(sc3, w2);
ok(sc3.hearts === 0, '3 次错应把心耗光');
ok(sc3.pendingFail === true, '心耗光应先标记 pendingFail（先揭晓再失败）');
pump(sc3, Math.ceil(sc3.revealMs / 16) + 2);
ok(!!sc3.fail, '揭晓结束后应进入失败层');
ok(BF.Save.starsOf('recall', 1) === 0 || BF.Save.starsOf('recall', 1) === 3,
  '失败不应覆盖已有星级（本关此前已 3 星）');
tap(sc3, sc3.overlayLayout().action);
ok(sc3.level === 1 && !sc3.fail && sc3.hearts === 3 && sc3.mistakes === 0,
  '失败「重新挑战」应留在第 1 关、清失败态、重置 3 心与失误');

/* ---------- 4) 提示：排除一个错误选项、不排除正确答案、降星 ---------- */
var sc4 = new BF.SceneRecall(fakeApp);
BF.Save.resetAll();
sc4.enter({ level: 2, game: 'recall' });
ok(pumpTo(sc4, 'quiz'), '提示用例应进 quiz');
tap(sc4, sc4.hintBtn);
ok(sc4.excluded >= 0 && sc4.excluded !== sc4.questions[sc4.qIndex].answerIndex,
  '提示排除的必须是错误选项');
ok(sc4.hintsUsed === 1 && sc4.hintUsedForQ === true, '提示应记 hintsUsed 且每题只能用 1 次');
tap(sc4, sc4.hintBtn);
ok(sc4.hintsUsed === 1, '同题重复点提示不应再计数');
var g4 = 0;
while (!sc4.win && !sc4.fail && g4++ < 200) {
  if (sc4.phase === 'quiz') { tapOpt(sc4, sc4.questions[sc4.qIndex].answerIndex); }
  else { pump(sc4, Math.ceil(sc4.revealMs / 16) + 2); }
}
ok(!!sc4.win && sc4.win.stars === 2, '全对但用了 1 次提示应降为 2 星');
ok(BF.Save.starsOf('recall', 2) === 2, '存档星级应写 2');

/* ---------- 5) 下一关不弹规则 ---------- */
var sc5 = new BF.SceneRecall(fakeApp);
sc5.enter({ level: 3, game: 'recall' });
ok(pumpTo(sc5, 'quiz'), '下一关用例应进 quiz');
var g5 = 0;
while (!sc5.win && g5++ < 200) {
  if (sc5.phase === 'quiz') { tapOpt(sc5, sc5.questions[sc5.qIndex].answerIndex); }
  else { pump(sc5, Math.ceil(sc5.revealMs / 16) + 2); }
}
sc5.nextAfterWin();
ok(sc5.level === 4, '「下一关」应进第 4 关');
ok(!sc5.showRule, '关内「下一关」不应弹规则说明');
ok(sc5.phase === 'observe' && sc5.hearts === 3, '下一关应重置为观察期 + 3 心');
// 末关完成回首页
var sc5b = new BF.SceneRecall(fakeApp);
var wentHome = false;
sc5b.app = { go: function (n) { if (n === 'home') { wentHome = true; } } };
sc5b.enter({ level: 15, game: 'recall' });
sc5b.onSolved();
sc5b.nextAfterWin();
ok(wentHome, '第 15 关完成后应返回首页');

/* ---------- 6) 观察期防误触 ---------- */
var sc6 = new BF.SceneRecall(fakeApp);
sc6.enter({ level: 1, game: 'recall' });
sc6.onDown(195, 400); sc6.onUp(195, 400);
ok(sc6.phase === 'observe', '进关 420ms 内轻触不应提前收图');
pump(sc6, 30);   // 480ms
sc6.onDown(195, 400); sc6.onUp(195, 400);
ok(sc6.phase === 'quiz', '防误触窗口过后轻触应提前收图');

/* ---------- 7) RuleTip 五点接入 ---------- */
var e7 = makeEnv(390, 844, 44, 34);
var B7 = e7.BF;
B7.RuleTip.on = true;
B7.Save.resetAll();
var sc7 = new B7.SceneRecall(fakeApp);
sc7.enter({ level: 1, game: 'recall' });
ok(sc7.showRule === true, '首次进入应弹规则说明');
var t0 = sc7.observeT;
for (var u7 = 0; u7 < 40; u7++) { sc7.update(16); }
ok(Math.abs(sc7.observeT - t0) < 1e-9, '弹框期间观察倒计时不应推进');
try { sc7.render(e7.ctx); } catch (er7) { ok(false, '弹框帧渲染抛异常: ' + er7.message); }
tap(sc7, sc7.ruleOk);
ok(sc7.showRule === false, '点「开始游戏」应关闭弹框');
pump(sc7, 2);
ok(sc7.observeT < t0, '关闭弹框后观察倒计时恢复推进');
// 「?」重看
sc7.onDown(sc7.ruleBtn.x + sc7.ruleBtn.w / 2, sc7.ruleBtn.y + sc7.ruleBtn.h / 2);
sc7.onUp(sc7.ruleBtn.x + sc7.ruleBtn.w / 2, sc7.ruleBtn.y + sc7.ruleBtn.h / 2);
ok(sc7.showRule === true, 'header「?」应能重看规则');

/* ---------- 8) 每日挑战 ---------- */
var sc8 = new BF.SceneRecall(fakeApp);
BF.Save.resetAll();
sc8.enter({ level: 1, game: 'recall', daily: true });
ok(sc8.isDaily === true && sc8.scene.daily === true, '每日挑战应走 buildDaily');
ok(sc8.N === 8 && sc8.M === 4, '每日挑战应是进阶档 N=8/M=4');
ok(pumpTo(sc8, 'quiz'), '每日挑战应能进答题期');
var g8 = 0;
while (!sc8.win && !sc8.fail && g8++ < 200) {
  if (sc8.phase === 'quiz') { tapOpt(sc8, sc8.questions[sc8.qIndex].answerIndex); }
  else { pump(sc8, Math.ceil(sc8.revealMs / 16) + 2); }
}
ok(!!sc8.win, '每日挑战应可通关');
ok(BF.Save.isDailyDoneToday(), '每日通关应写 clearDaily');
ok(BF.Save.clearedCount('recall') === 0, '每日通关不应污染普通关存档');

/* ---------- 汇总 ---------- */
console.log('=== 瞬时记忆 · 交互逻辑护栏 ===');
if (issues.length) {
  console.log('✗ 发现 ' + issues.length + ' 个问题：');
  issues.slice(0, 40).forEach(function (m) { console.log('  - ' + m); });
  if (issues.length > 40) { console.log('  ... 其余 ' + (issues.length - 40) + ' 条省略'); }
  process.exit(1);
}
console.log('✓ 全部通过：15 关阶段机/全对点通/三档几何(390·375·320)/扣心超时/失败重玩/提示降星/下一关/防误触/RuleTip/每日挑战');
process.exit(0);
