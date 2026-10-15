/* 验证「玩法说明」弹框（BF.RuleTip）：
   首进弹框 / 遮罩不可点 / 开始游戏关闭 / 勾选写存档 / 再进不弹 /
   「?」强制重看 / 弹框期间不计时不收输入 / 三种屏宽几何 / 11 款 rules 齐全 /
   save/restore 配平 / 多行换行高度自适应 / 单例连续切关（下一关不弹） */
var path = require('path');
var root = 'C:/Users/admin/WorkBuddy/2026-09-30-08-41-53/puzzle-arcade';
require(path.join(root, 'js/core/ns.js'));
var G = globalThis;
var BF = G.BF;

/* ---------- mock：canvas / platform / Save ---------- */
var depth = 0, maxDepth = 0;
var texts = [];
var D = new Proxy({}, { get: function (t, p) {
  if (p === 'FONT') { return 'sans'; }
  // text / button 的文案记下来，用来断言"这条规则真的被画出来了"
  if (p === 'text') { return function (c, str) { texts.push(String(str)); }; }
  if (p === 'button') { return function (c, r, label) { texts.push(String(label)); }; }
  return function () { return undefined; };
} });
require(path.join(root, 'js/core/palette.js'));   // 真 theme + BF.COLORS（关卡生成器要用）
BF.draw = D;

var ctx = new Proxy({}, {
  get: function (t, p) {
    if (p === 'save') { return function () { depth++; if (depth > maxDepth) { maxDepth = depth; } }; }
    if (p === 'restore') { return function () { depth--; }; }
    if (p === 'measureText') {
      // 按真机中文宽度估（13px 中文字 ≈ 13px），换行逻辑与高度预算才测得准
      return function (s) { return { width: String(s).length * 13 }; };
    }
    if (p === 'createLinearGradient' || p === 'createRadialGradient') {
      return function () { return { addColorStop: function () {} }; };
    }
    if (p === 'fillText') { return function (s) { texts.push(String(s)); }; }
    return function () {};
  },
  set: function () { return true; }
});

var store = { games: {}, daily: { key: '', cleared: false, stars: 0 } };
function bucket(g) {
  if (!store.games[g]) { store.games[g] = { cleared: {}, unlocked: 1, extra: {} }; }
  return store.games[g];
}
BF.Save = {
  data: store, load: function () {}, flush: function () {},
  bucket: bucket,
  extraOf: function (g) { var b = bucket(g); if (!b.extra) { b.extra = {}; } return b.extra; },
  putExtra: function (g, k, v) { this.extraOf(g)[k] = v; },
  delExtra: function (g, k) { delete this.extraOf(g)[k]; },
  isCleared: function (g, n) { return !!bucket(g).cleared[String(n)]; },
  clear: function (g, n, s) { bucket(g).cleared[String(n)] = s; },
  starsOf: function (g, n) { return bucket(g).cleared[String(n)] || 0; },
  unlockedOf: function (g) { return bucket(g).unlocked; },
  clearDaily: function (s) { store.daily = { cleared: true, stars: s }; },
  resetAll: function () { store = { games: {}, daily: { key: '', cleared: false, stars: 0 } }; }
};

var nowT = 1000;
BF.platform = {
  width: 390, height: 844, safeTop: 44, safeBottom: 34, dpr: 2,
  now: function () { return nowT; }, vibrate: function () {},
  requestFrame: function () {}, bindPointer: function () {}, ctx: ctx
};

require(path.join(root, 'js/core/palette.js'));   // BF.COLORS / BF.theme
['generator', 'logic', 'photo', 'diff', 'bottle', 'cipher', 'rush', 'blocks',
 'sudoku', 'mine', 'picross', 'model'].forEach(function (f) {
  require(path.join(root, 'js/game/' + f + '.js'));
});
require(path.join(root, 'js/scenes/diffpick.js'));
require(path.join(root, 'js/scenes/ruletip.js'));
['play', 'diff', 'bottle', 'cipher', 'rush', 'blocks', 'sudoku', 'mine', 'picross'].forEach(function (f) {
  require(path.join(root, 'js/scenes/' + f + '.js'));
});

var fails = 0;
function ok(cond, msg) { if (!cond) { console.log('  ✗ ' + msg); fails++; } }
function fresh() { BF.Save.resetAll(); BF.RuleTip.on = true; }

var app = { go: function () {} };
function newScene(name) {
  var Ctor = { play: BF.ScenePlay, diff: BF.SceneDiff, bottle: BF.SceneBottle,
    cipher: BF.SceneCipher, rush: BF.SceneRush, blocks: BF.SceneBlocks,
    sudoku: BF.SceneSudoku, mine: BF.SceneMine, picross: BF.ScenePicross }[name];
  return new Ctor(app);
}
function frame(sc, n) {
  for (var i = 0; i < (n || 1); i++) { sc.update(16); sc.render(ctx); }
}
function tap(sc, x, y) { sc.onDown(x, y); sc.onUp(x, y); }
function center(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

/* 场景构造器 + 该场景的代表关卡（用来跑 11 款全覆盖） */
var REPR = [
  ['play', 'block', 1], ['play', 'logic', 1], ['play', 'photo', 1],
  ['diff', 'diff', 1], ['bottle', 'bottle', 1], ['cipher', 'cipher', 1],
  ['rush', 'rush', 1], ['blocks', 'blocks', 1], ['sudoku', 'sudoku', 1],
  ['mine', 'mine', 1], ['picross', 'picross', 1]
];

console.log('== 1. 11 款 rules 注册完整性 + 首进弹框几何（390×844） ==');
(function () {
  fresh();
  REPR.forEach(function (r) {
    var sceneName = r[0], game = r[1], level = r[2];
    var meta = BF.games[game];
    ok(!!meta.rules && meta.rules.lines.length >= 3, game + ' 应配 rules 且至少 3 条');
    ok(!!meta.rules.sub && meta.rules.sub.length <= 24, game + ' 副标题应在 24 字内');
    meta.rules.lines.forEach(function (ln, i) {
      ok(typeof ln === 'string' && ln.length > 0 && ln.length <= 30,
        game + ' 第 ' + (i + 1) + ' 条规则应为 1~30 字');
    });
    var sc = newScene(sceneName);
    sc.enter({ level: level, game: game });
    ok(!!sc.showRule, game + ' 首进应弹规则说明');
    var c = sc.ruleCard;
    ok(c && c.x >= 0 && c.y >= 0 && c.x + c.w <= 390 && c.y + c.h <= 844,
      game + ' 弹框应在屏内（x=' + (c && c.x.toFixed(0)) + ' y=' + (c && c.y.toFixed(0)) +
      ' w=' + (c && c.w) + ' h=' + (c && c.h.toFixed(0)) + '）');
    ok(c && c.w === Math.min(390 - 56, 320), game + ' 弹框宽应为 min(屏宽-56,320)');
    // 复选框与按钮不重叠、都在卡内
    var cb = sc.ruleCheck, ob = sc.ruleOk;
    ok(cb.y + cb.h <= ob.y, game + ' 复选框不应压按钮');
    ok(ob.x + ob.w <= c.x + c.w && ob.y + ob.h <= c.y + c.h, game + ' 按钮应在卡内');
    // 「?」按钮不与返回按钮重叠、不出屏
    var back = sc.back || (sc.L && sc.L.back);
    var btn = BF.RuleTip.btn(sc);
    ok(btn.x + btn.w <= 390 && btn.y >= 0, game + ' 「?」按钮应不出屏');
    ok(back && !(btn.x < back.x + back.w && back.x < btn.x + btn.w &&
         btn.y < back.y + back.h && back.y < btn.y + btn.h),
      game + ' 「?」按钮不应压返回按钮');
  });
})();

console.log('== 2. 交互流程：遮罩不关 / 开始游戏 / 勾选写存档 / 再进不弹 ==');
(function () {
  fresh();
  var sc = newScene('mine');
  sc.enter({ level: 1, game: 'mine' });
  ok(!!sc.showRule, 'mine 首进应弹');
  var d0 = depth;
  frame(sc, 12);                       // 动画跑完（160ms / 16ms ≈ 10 帧）
  ok(sc.ruleAnim >= 1, '动画应在 ~10 帧内跑完，实际 ' + sc.ruleAnim.toFixed(2));
  ok(depth === 0, 'render 后 save/restore 未配平（净泄漏 ' + depth + '）');

  // 2a. 点遮罩（卡片外的角落）= 不关
  tap(sc, 6, 6);
  ok(!!sc.showRule, '点遮罩不应关闭弹框');
  // 2b. 点卡片内部空白（非按钮区）= 不关
  var c = sc.ruleCard;
  tap(sc, c.x + 8, c.y + 8);
  ok(!!sc.showRule, '点卡片空白处不应关闭');

  // 2c. 按下在按钮上、滑到别处抬起 = 不关（防误触）
  var ob = sc.ruleOk;
  sc.onDown(ob.x + ob.w / 2, ob.y + ob.h / 2);
  sc.onUp(4, 4);
  ok(!!sc.showRule, '按下后滑出按钮不应关闭');

  // 2d. 正常点「开始游戏」= 关，且不写存档
  tap(sc, ob.x + ob.w / 2, ob.y + ob.h / 2);
  ok(!sc.showRule, '点「开始游戏」应关闭弹框');
  ok(!BF.Save.extraOf('mine').noRule, '没勾「不再提示」不应写存档');

  // 2e. 勾选 + 开始游戏 → 写 noRule，再进不弹
  sc.enter({ level: 1, game: 'mine' });
  ok(!!sc.showRule, '没勾过就再进应继续弹');
  var cb = sc.ruleCheck;
  tap(sc, cb.x + cb.w / 2, cb.y + cb.h / 2);
  ok(sc.ruleNoTip === true, '点复选框应勾选');
  tap(sc, sc.ruleOk.x + sc.ruleOk.w / 2, sc.ruleOk.y + sc.ruleOk.h / 2);
  ok(!sc.showRule, '勾选后点开始游戏应关闭');
  ok(BF.Save.extraOf('mine').noRule === 1, '应写入 noRule=1');
  sc.enter({ level: 2, game: 'mine' });
  ok(!sc.showRule, '勾过「不再提示」后再进不应弹');
  // 再点一下复选框应取消勾选（不写存档）—— 强制重开走 RuleTip.enter({force:true})
  BF.RuleTip.enter(sc, { force: true });
  ok(!!sc.showRule, 'force 应能强制重开');
  ok(sc.ruleNoTip === false, '重开时勾选态应复位为未勾');
  tap(sc, cb.x + cb.w / 2, cb.y + cb.h / 2);
  ok(sc.ruleNoTip === true, '点一次应勾选');
  tap(sc, cb.x + cb.w / 2, cb.y + cb.h / 2);
  ok(sc.ruleNoTip === false, '再点一次应取消勾选');
  tap(sc, sc.ruleOk.x + sc.ruleOk.w / 2, sc.ruleOk.y + sc.ruleOk.h / 2);
  ok(BF.Save.extraOf('mine').noRule === 1, '取消勾选后关闭不应删掉已存的 noRule');
})();

console.log('== 3. 「?」按钮：不再提示后也能强制重看 ==');
(function () {
  fresh();
  var sc = newScene('picross');
  sc.enter({ level: 1, game: 'picross' });
  tap(sc, sc.ruleOk.x + sc.ruleOk.w / 2, sc.ruleOk.y + sc.ruleOk.h / 2);
  BF.Save.putExtra('picross', 'noRule', 1);
  sc.enter({ level: 1, game: 'picross' });
  ok(!sc.showRule, '勾过不再提示后正常进关不弹');
  // 点 header 左上角「?」
  var btn = BF.RuleTip.btn(sc);
  tap(sc, btn.x + btn.w / 2, btn.y + btn.h / 2);
  ok(!!sc.showRule, '点「?」应强制重开规则弹框');
  ok(sc.ruleForce === true, '「?」重开应带 force 标记');
  tap(sc, sc.ruleOk.x + sc.ruleOk.w / 2, sc.ruleOk.y + sc.ruleOk.h / 2);
  ok(!sc.showRule, '重开后点开始游戏应关闭');
  // ? 按钮按在框内、滑出框外抬起 = 不开（onDown 是即时开的，这里验证 onUp 不重复关）
  ok(!sc.showRule, '关闭后应保持关闭');
})();

console.log('== 4. 弹框期间隔离：不计时 / 不收输入 / 不穿层到 win 弹窗 ==');
(function () {
  fresh();
  var sc = newScene('picross');
  sc.enter({ level: 1, game: 'picross' });
  var st0 = sc.st.slice();
  frame(sc, 30);                       // 480ms
  ok(sc.elapsed === 0, '弹框期间不应计时，实际 ' + sc.elapsed);
  ok(JSON.stringify(sc.st) === JSON.stringify(st0), '弹框期间点格不应生效');
  ok(sc.hintsLeft === 3, '弹框期间提示次数不应被消耗');
  // 弹框期间点调色板/提示按钮都不该有效果
  var hb = sc.hintBtn;
  tap(sc, hb.x + hb.w / 2, hb.y + hb.h / 2);
  ok(sc.hintsLeft === 3, '弹框期间点提示按钮不应生效');
  // 关闭后恢复
  tap(sc, sc.ruleOk.x + sc.ruleOk.w / 2, sc.ruleOk.y + sc.ruleOk.h / 2);
  frame(sc, 30);
  ok(sc.elapsed === 0, '关闭后没点格也不应计时（picross 首点才 started）');
  var i = -1;
  for (var k = 0; k < sc.cells.length; k++) { if (sc.cells[k] >= 0) { i = k; break; } }
  var px = sc.gridX + (i % sc.n) * sc.cell + sc.cell / 2;
  var py = sc.gridY + (((i / sc.n) | 0)) * sc.cell + sc.cell / 2;
  tap(sc, px, py);
  ok(sc.st[i] === sc.cells[i], '关闭后点格应正常生效');
  ok(sc.started === true, '关闭后点格应开始计时');
  frame(sc, 30);
  ok(sc.elapsed > 0, '关闭后应正常计时');

  // 4b. 限时关（超级积木第 10 关）：弹框期间倒计时不应被扣
  var sc3 = newScene('blocks');
  sc3.enter({ level: 10, game: 'blocks' });
  ok(!!sc3.showRule, 'blocks 第 10 关应弹规则');
  ok(sc3.timed === true, '第 10 关应为限时关');
  var tl0 = sc3.timeLeft;
  frame(sc3, 60);                     // 960ms
  ok(sc3.timeLeft === tl0,
    '弹框期间限时倒计时不应减少（' + tl0 + ' → ' + sc3.timeLeft + '）');
  tap(sc3, sc3.ruleOk.x + sc3.ruleOk.w / 2, sc3.ruleOk.y + sc3.ruleOk.h / 2);
  frame(sc3, 60);
  ok(sc3.timeLeft < tl0, '关闭后限时倒计时应正常走');

  // 4c. win 弹窗打开时点「?」区域不开弹框（弹窗优先）
  var sc2 = newScene('mine');
  sc2.enter({ level: 1, game: 'mine' });
  tap(sc2, sc2.ruleOk.x + sc2.ruleOk.w / 2, sc2.ruleOk.y + sc2.ruleOk.h / 2);
  // 首点触发布雷（必安全），再把所有非雷格摆成已翻开 → 通关弹窗
  var fc = (((sc2.n / 2) | 0)) * sc2.n + ((sc2.n / 2) | 0);
  var fcx = sc2.boardX + (fc % sc2.n) * sc2.cell + sc2.cell / 2;
  var fcy = sc2.boardY + (((fc / sc2.n) | 0)) * sc2.cell + sc2.cell / 2;
  tap(sc2, fcx, fcy);
  ok(!!sc2.mines, '首点后应生成雷位');
  for (var j = 0; j < sc2.N; j++) { sc2.revealed[j] = !sc2.mines[j]; }
  sc2.onSolved();
  ok(!!sc2.win, '应进入通关弹窗');
  var btn2 = BF.RuleTip.btn(sc2);
  tap(sc2, btn2.x + btn2.w / 2, btn2.y + btn2.h / 2);
  ok(!sc2.showRule, '通关弹窗打开时点「?」不应开规则弹框');
  ok(!!sc2.win, '通关弹窗应保持');
})();

console.log('== 5. 三种屏宽几何（320 / 375 / 414） ==');
(function () {
  fresh();
  [320, 375, 414].forEach(function (W) {
    BF.platform.width = W;
    REPR.forEach(function (r) {
      var sc = newScene(r[0]);
      sc.enter({ level: r[2], game: r[1] });
      var c = sc.ruleCard, ob = sc.ruleOk, cb = sc.ruleCheck;
      ok(c.x >= 0 && c.x + c.w <= W && c.y >= 0 && c.y + c.h <= 844,
        r[1] + ' @' + W + ' 弹框应不出屏');
      ok(cb.x >= c.x && ob.x + ob.w <= c.x + c.w, r[1] + ' @' + W + ' 复选框/按钮应在卡内');
      ok(cb.y + cb.h <= ob.y, r[1] + ' @' + W + ' 复选框不压按钮');
      if (r[1] === 'picross') {
        ok(!!sc.ruleDemo, 'picross @' + W + ' 应带演示块 ruleDemo');
        var dm = sc.ruleDemo;
        ok(dm.x >= c.x && dm.x + dm.w <= c.x + c.w, 'picross @' + W + ' 演示块应横向在卡内');
        ok(dm.y >= c.y && dm.y + dm.h <= c.y + c.h, 'picross @' + W + ' 演示块应纵向在卡内');
        ok(dm.y + dm.h <= sc.ruleRulesTop + 0.5, 'picross @' + W + ' 演示块应在规则文字上方');
      } else {
        ok(!sc.ruleDemo, r[1] + ' @' + W + ' 非数织不应有演示块');
      }
    });
  });
  BF.platform.width = 390;
})();

console.log('== 6. 11 款弹框全部渲染一遍（save/restore 配平 + 不崩） ==');
(function () {
  fresh();
  var before = depth;
  REPR.forEach(function (r) {
    var sc = newScene(r[0]);
    sc.enter({ level: r[2], game: r[1] });
    texts.length = 0;
    frame(sc, 12);
    ok(depth === before, r[1] + ' 弹框 render 后状态栈应配平（净 ' + (depth - before) + '）');
    var title = (BF.games[r[1]].title || '') + ' · 玩法说明';
    ok(texts.indexOf(title) >= 0, r[1] + ' 应画出标题「' + title + '」');
    ok(texts.indexOf('不再提示') >= 0, r[1] + ' 应画出「不再提示」');
    ok(texts.indexOf('开始游戏') >= 0, r[1] + ' 应画出「开始游戏」');
    BF.games[r[1]].rules.lines.forEach(function (ln) {
      // 长条目会换行，只查第一段
      ok(texts.indexOf(BF.RuleTip.wrap(ctx, ln, 320 - 44 - 16)[0]) >= 0,
        r[1] + ' 应画出规则条目「' + ln.slice(0, 12) + '…」');
    });
  });
})();

console.log('== 7. 换行与高度自适应 ==');
(function () {
  fresh();
  // 造一条 60 字的长文案，应折成多行且卡片变高
  var long = '一二三四五六七八九十'.repeat(6);   // 60 字
  var segs = BF.RuleTip.wrap(ctx, long, 320 - 44 - 16);
  ok(segs.length >= 2, '60 字长文案应换行，实际 ' + segs.length + ' 行');
  ok(segs.join('') === long, '换行不应丢字');
  ok(segs.every(function (s) { return s.length <= 22; }), '每行应不超过 22 字（真机 13px）');

  var sc = newScene('picross');
  sc.enter({ level: 1, game: 'picross' });
  var hShort = sc.ruleCard.h;
  BF.games.picross.rules.lines = [
    '一二三四五六七八九十'.repeat(6), '短规则',
    '一二三四五六七八九十'.repeat(6), '短规则'];   // 3+1+3+1 = 8 行 > 原 4 行
  sc.enter({ level: 1, game: 'picross', force: true });
  var hLong = sc.ruleCard.h;
  ok(hLong > hShort, '条目变长后卡片应变高（' + hShort.toFixed(0) + ' → ' + hLong.toFixed(0) + '）');
  ok(sc.ruleOk.y + sc.ruleOk.h <= sc.ruleCard.y + sc.ruleCard.h, '长文案按钮仍应在卡内');
  // 小屏 + 长文案：高度被夹在 H-40 内
  BF.platform.height = 568;
  sc.enter({ level: 1, game: 'picross', force: true });
  ok(sc.ruleCard.y + sc.ruleCard.h <= 568, '568 矮屏卡片应不出底');
  BF.platform.height = 844;
})();

console.log('== 8. 单例场景连续切关：下一关不弹，重进才弹 ==');
(function () {
  fresh();
  var sc = newScene('picross');       // 模拟 BF.App.scenes.picross 单例
  sc.enter({ level: 1, game: 'picross' });
  ok(!!sc.showRule, '首进应弹');
  tap(sc, sc.ruleOk.x + sc.ruleOk.w / 2, sc.ruleOk.y + sc.ruleOk.h / 2);
  // 关内「下一关」走 next()：直接重建题目（不经过 enter 的规则判断）
  if (typeof sc.next === 'function') { sc.next(); }
  ok(!sc.showRule, '关内进下一关不应再弹');
  // 从首页重新 enter 同一款游戏 → 弹（因为没勾不再提示）
  sc.enter({ level: 3, game: 'picross' });
  ok(!!sc.showRule, '重新进这款游戏应再弹');
  // 每日挑战也弹（共用开关）
  sc.enter({ level: 1, game: 'picross', daily: true });
  ok(!!sc.showRule, '每日挑战同样应弹');
})();

console.log('== 9. 数织规则弹框的「动画演示」（仅数织有，其余无） ==');
(function () {
  fresh();
  // 数织应带演示块；mine 等无 demo 字段 → 不应有
  var sp = newScene('picross'); sp.enter({ level: 1, game: 'picross' });
  ok(!!sp.ruleDemo, '数织弹框应带演示块');
  var sm = newScene('mine'); sm.enter({ level: 1, game: 'mine' });
  ok(!sm.ruleDemo, '扫雷弹框不应有演示块（不影响其它游戏卡片几何）');

  var d = sp.ruleDemo;
  ok(d.rows === 5 && d.cols === 5, '演示应为 5×5 迷你数织');
  ok(d.colors.length === 2, '演示应含 2 种颜色（彩色数织）');
  // 第 2 列（index 2）应是「1 黄 + 4 红」的两段彩色线索，演示带色块数字串
  var col2 = d.colClues[2];
  ok(col2.length === 2 && col2[0].col === 1 && col2[0].n === 1 && col2[1].col === 0 && col2[1].n === 4,
    '第 2 列线索应为 1黄+4红 的两段（实际 ' + JSON.stringify(col2) + '）');
  // 行线索也应有彩色（红心那些行）
  ok(d.rowClues[1].length === 1 && d.rowClues[1][0].col === 0 && d.rowClues[1][0].n === 5,
    '第 2 行应为 5 红的一段');

  // 演示进度应随帧推进
  var t0 = sp.ruleDemoT || 0;
  frame(sp, 30);   // 30×16ms ≈ 0.48s
  ok((sp.ruleDemoT || 0) > t0 + 0.3, '演示进度应随帧推进（t0=' + t0.toFixed(2) + ' → ' + (sp.ruleDemoT||0).toFixed(2) + '）');

  // 演示渲染多帧不崩、状态栈配平
  var before = depth;
  texts.length = 0;
  frame(sp, 240);   // 跨多个循环
  ok(depth === before, '数织演示 render 后状态栈应配平（净 ' + (depth - before) + '）');

  // 矮屏（568）下演示块 + 卡片不出底
  BF.platform.height = 568;
  var sd = newScene('picross'); sd.enter({ level: 1, game: 'picross' });
  ok(sd.ruleDemo && sd.ruleDemo.y + sd.ruleDemo.h <= 568, '568 矮屏演示块应不出底');
  ok(sd.ruleCard.y + sd.ruleCard.h <= 568, '568 矮屏卡片应不出底');
  BF.platform.height = 844;
})();

console.log('');
if (fails === 0) { console.log('✅ 规则弹框交互验证全部通过'); }
else { console.log('❌ 失败 ' + fails + ' 项'); process.exit(1); }
