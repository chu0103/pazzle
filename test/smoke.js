/**
 * smoke.js —— 端到端交互自检（node test/smoke.js）
 *
 * 不依赖浏览器：用一个「假 Canvas + 假 platform」把 App 真正跑起来，
 * 再模拟手指「按下 → 拖动 → 抬起」，把方块拖到标准答案位置。
 * 能覆盖：场景切换、布局计算、拖拽吸附、放置校验、通关判定、撤销/提示、存档。
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');

/* ---------- 假 Canvas ---------- */
/**
 * save/restore 平衡检测。
 * canvas 状态栈是真机上的有限资源：每画一个方块多一次 save 而不 restore，
 * 攒够之后真机 save() 会直接抛错 → 整屏卡死（用户报的「不时的会卡住」）。
 * 假 canvas 的 save 是空函数、永远不溢出，所以以前完全测不出来 —— 这里手动记账。
 */
var ctxDepth = 0, ctxMaxDepth = 0, ctxUnderflow = 0;
function ctxDepthReset() { ctxDepth = 0; ctxMaxDepth = 0; ctxUnderflow = 0; }

function fakeCtx() {
  var grad = { addColorStop: function () {} };
  var target = {
    save: function () { ctxDepth++; if (ctxDepth > ctxMaxDepth) { ctxMaxDepth = ctxDepth; } },
    restore: function () { ctxDepth--; if (ctxDepth < 0) { ctxUnderflow++; ctxDepth = 0; } },
    scale: function () {},
    setTransform: function () {}, transform: function () {}, translate: function () {},
    fillRect: function () {}, clearRect: function () {}, strokeRect: function () {},
    beginPath: function () {}, closePath: function () {}, moveTo: function () {},
    lineTo: function () {}, arc: function () {}, arcTo: function () {}, rect: function () {},
    clip: function () {}, fill: function () {}, stroke: function () {},
    setLineDash: function () {}, drawImage: function () {},
    createLinearGradient: function () { return grad; },
    createRadialGradient: function () { return grad; },
    measureText: function (t) { return { width: String(t).length * 7 }; },
    fillText: function () {}, strokeText: function () {}
  };
  return new Proxy(target, {
    get: function (t, k) { return t[k]; },
    set: function (t, k, v) { t[k] = v; return true; }
  });
}

/* ---------- 假宿主环境 ---------- */
var frames = [];
var input = { down: null, move: null, up: null };
var store = {};

var sandbox = {
  console: console,
  Math: Math, Date: Date, JSON: JSON, Object: Object, Array: Array,
  String: String, Number: Number, Boolean: Boolean, Error: Error,
  setTimeout: setTimeout, parseInt: parseInt, isNaN: isNaN,
  Proxy: Proxy
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}

load('js/core/ns.js');
load('js/core/palette.js');
load('js/core/draw.js');

var BF = sandbox.BF;
var ctx = fakeCtx();
BF.platform = {
  isMiniGame: false,
  ready: true,
  canvas: { width: 390, height: 844 },
  ctx: ctx,
  width: 390,
  height: 844,
  dpr: 2,
  safeTop: 0,
  safeBottom: 0,
  now: function () { return Date.now(); },
  requestFrame: function (cb) { frames.push(cb); },
  getStorage: function (k, d) { return store[k] === undefined ? d : store[k]; },
  setStorage: function (k, v) { store[k] = v; },
  vibrate: function () {},
  bindPointer: function (h) { input.down = h.down; input.move = h.move; input.up = h.up; }
};

load('js/core/save.js');
load('js/game/generator.js');
load('js/game/logic.js');
load('js/game/model.js');
load('js/scenes/home.js');
load('js/scenes/levels.js');
load('js/scenes/play.js');
load('js/app.js');

/* ---------- 断言 ---------- */
var fails = [];
function check(cond, msg) { if (!cond) { fails.push(msg); } }

/** 单次 render 造成的 save/restore 净泄漏（正数=泄漏，负数=多 restore） */
var ctxLeaks = [];
function frameOnce() {
  var c = BF.App.current;
  if (c.update) { c.update(16); }
  var before = ctxDepth;
  c.render(ctx);
  var leaked = ctxDepth - before;
  if (leaked !== 0) { ctxLeaks.push(leaked); ctxDepth = before; }   // 记账后复原，避免污染后续断言
  return leaked;
}
function runFrames(n) {
  for (var i = 0; i < (n || 1); i++) { frameOnce(); }
}
/**
 * 真实交互里按下与抬起之间一定会过若干帧（60fps 下一帧就是 16ms）。
 * 不夹帧的话，"按下态被 update 每帧清空"这类 bug 永远测不出来 ——
 * 「重玩」「下一关」点了没反应就是这么漏过去的。
 */
function tap(x, y, frames) {
  if (input.down) { input.down(x, y); }
  runFrames(frames === undefined ? 2 : frames);
  if (input.up) { input.up(x, y); }
}
function drag(x0, y0, x1, y1, steps) {
  input.down(x0, y0);
  steps = steps || 6;
  for (var i = 1; i <= steps; i++) {
    input.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps);
  }
  input.up(x1, y1);
}

/* ---------- 0. 启动 ---------- */
check(!!BF.App.current, '启动后没有当前场景');
check(BF.App.current === BF.App.scenes.home, '首页不是启动场景');
runFrames(3);

/* ---------- 1. 首页 → 关卡页 ---------- */
var home = BF.App.scenes.home;
check(home.cards.length >= 2, '首页卡片数量异常');

/* 1a. 首页顶部布局：标题 / 右上统计 / 版本号 三者不得叠字。
   为什么会有这条断言：版本号一度画在 (12, safeTop+18)，和 30px 的「益智闯关」
   重叠（v0.2.0 压在标题左下角），是靠肉眼看渲染截图才发现的。
   布局坐标可测之后，这类问题应该由测试拦住。 */
(function () {
  var bad = [];
  var wKeep = home.W, yKeep = home.heroY;
  // 真机逻辑宽度：320 是现存最窄的常见机型，768 覆盖平板/PC 端
  [320, 360, 375, 390, 414, 430, 768].forEach(function (w) {
    home.W = w;
    var hl = home.headerLayout();
    var tags = [
      ['标题×版本号', hl.title, hl.version],
      ['统计×版本号', hl.stats, hl.version],
      ['标题×统计', hl.title, hl.stats]
    ];
    for (var i = 0; i < tags.length; i++) {
      if (BF.util.rectsOverlap(tags[i][1], tags[i][2])) { bad.push(w + 'px ' + tags[i][0]); }
    }
    // 版本号不能掉进标题块
    if (hl.version.y < hl.title.y + hl.title.h) { bad.push(w + 'px 版本号进入标题纵向区间'); }
  });
  home.W = wKeep; home.heroY = yKeep;
  check(bad.length === 0, '首页顶部元素重叠：' + bad.join('、'));

  var hl0 = home.headerLayout();
  check(hl0.version.y + hl0.version.h <= home.cards[0].y,
    '首页版本号压到第一张卡片（底 ' + (hl0.version.y + hl0.version.h) + ' > 卡片顶 ' + home.cards[0].y + '）');
})();

var card0 = home.cards[0];
tap(card0.x + card0.w / 2, card0.y + card0.h / 2);
check(BF.App.current === BF.App.scenes.levels, '点卡片没有进入关卡页');
runFrames(3);

/* ---------- 2. 关卡页：滚动 + 点击锁定关 ---------- */
var lv = BF.App.scenes.levels;
var beforeScroll = lv.scroll;
input.down(195, 400);
for (var s = 0; s < 8; s++) { input.move(195, 400 - s * 12); }
input.up(195, 400 - 96);
check(lv.scroll !== beforeScroll || lv.minScroll === 0, '关卡页无法滚动');
runFrames(20);
// 未解锁关卡不应该能进入
var lockedRect = lv.rectOf(BF.Levels.TOTAL);
lv.scroll = 0;
runFrames(1);
tap(lockedRect.x + 5, lockedRect.y + 5);
check(BF.App.current === lv, '未解锁关卡被意外进入');

/* ---------- 3. 进入第 1 关，把整关按标准答案拖通 ---------- */
BF.App.go('play', { level: 1, game: 'block' });
var play = BF.App.scenes.play;
check(play.layout && play.L.board.w > 0, '第1关布局失败');
runFrames(30);

check(play.model.size === 4, '第1关应为 4x4，实际 ' + play.model.size);
check(play.model.pieces.length >= 3, '第1关方块数异常');

/** 按标准答案拖拽全部方块 */
function solveLevel(scene, frameSteps) {
  var model = scene.model;
  var L = scene.L;
  var ids = model.puzzle.order.slice();
  for (var i = 0; i < ids.length; i++) {
    var p = model.pieces[ids[i]];
    if (p.placed) { continue; }
    var cx = p.px + p.w * L.cell * p.scale / 2;
    var cy = p.py + p.h * L.cell * p.scale / 2;
    var tx = L.inner.x + (p.solX + p.w / 2) * L.cell;
    var ty = L.inner.y + (p.solY + p.h / 2) * L.cell;
    drag(cx, cy, tx, ty);
    for (var f = 0; f < (frameSteps || 26); f++) { frameOnce(); }
  }
}

solveLevel(play, 26);
check(play.model.filled() === play.model.area,
  '第1关没能填满: ' + play.model.filled() + '/' + play.model.area);
check(!!play.win, '第1关填满后没有触发过关');
check(BF.Save.isCleared('block', 1), '通关后没写入存档');

/* 回归用：已落位的方块不能被动画拉离棋盘（曾经会飘回托盘） */
var drift = 0;
for (var pi = 0; pi < play.model.pieces.length; pi++) {
  var pp = play.model.pieces[pi];
  if (!pp.placed) { continue; }
  var wantX = play.L.inner.x + pp.x * play.L.cell;
  var wantY = play.L.inner.y + pp.y * play.L.cell;
  drift = Math.max(drift, Math.abs(pp.px - wantX), Math.abs(pp.py - wantY));
}
check(drift < 1.5, '已落位的方块位置漂移了 ' + drift.toFixed(1) + 'px（动画把它拉离了棋盘）');
runFrames(40);
check(!!play.win && play.win.stars >= 1 && play.win.stars <= 3, '星级计算异常');
/* 干净通关（没点提示/撤销/重置）必须是满星 —— 曾经因为用 undoStack.length 判断，
   undoStack 是"落子历史"恒等于块数，导致默认只能拿 2 星 */
check(!!play.win && play.win.stars === 3,
  '干净通关应得 3 星，实际 ' + (play.win && play.win.stars));

/* ---------- 3b. 星级规则：提示 / 撤销 各扣一星 ---------- */
(function () {
  var m1 = new BF.Model(BF.Levels.build(1));
  m1.pieces.forEach(function (p) { m1.place(p, p.solX, p.solY); });
  check(m1.stars() === 3, '干净通关应为 3 星，实际 ' + m1.stars());

  var m2 = new BF.Model(BF.Levels.build(1));
  m2.hint();
  m2.pieces.forEach(function (p) { m2.place(p, p.solX, p.solY); });
  check(m2.stars() === 2, '用过提示应为 2 星，实际 ' + m2.stars());

  var m3 = new BF.Model(BF.Levels.build(3));
  var p3 = m3.pieces[m3.puzzle.order[0]];
  m3.place(p3, p3.solX, p3.solY);
  m3.undo();
  m3.pieces.forEach(function (p) { m3.place(p, p.solX, p.solY); });
  check(m3.stars() === 2, '用过撤销应为 2 星，实际 ' + m3.stars());

  var m4 = new BF.Model(BF.Levels.build(2));
  m4.resetCount = 1;   // 视为重置过
  m4.pieces.forEach(function (p) { m4.place(p, p.solX, p.solY); });
  check(m4.stars() === 2, '重置过应为 2 星，实际 ' + m4.stars());
})();

/* ---------- 4. 过关弹窗两个按钮：重玩 / 下一关 ---------- */
(function () {
  var ob0 = play.overlayLayout();
  tap(ob0.again.x + ob0.again.w / 2, ob0.again.y + ob0.again.h / 2);
  runFrames(5);
  check(!play.win, '「重玩」没有关掉过关弹窗（按钮点了没反应）');
  check(play.level === 1, '「重玩」跑到了别的关卡: ' + play.level);
  check(play.model.filled() === 0, '「重玩」后棋盘没有清空');

  solveLevel(play, 26);
  runFrames(20);
  check(!!play.win, '重玩后再次通关没有触发过关');

  var ob1 = play.overlayLayout();
  tap(ob1.next.x + ob1.next.w / 2, ob1.next.y + ob1.next.h / 2);
  runFrames(5);
  check(BF.App.current === play && play.level === 2, '「下一关」没有切到第 2 关');
  check(!play.win, '「下一关」后过关弹窗没关');
})();
runFrames(20);

/* ---------- 5. 第 2 关：撤销 / 提示 / 重置 ---------- */
var p2 = play.model;
var first = p2.pieces[p2.puzzle.order[0]];
drag(first.px + first.w * play.L.cell / 2, first.py + first.h * play.L.cell / 2,
  play.L.inner.x + (first.solX + first.w / 2) * play.L.cell,
  play.L.inner.y + (first.solY + first.h / 2) * play.L.cell);
runFrames(20);
check(p2.filled() > 0, '第2关放置失败');

play.doAction('undo');
runFrames(10);
check(p2.placedCount === undefined || p2.remaining() === p2.pieces.length, '撤销没有还原棋盘');

play.doAction('hint');
check(!!play.hintFx, '提示没有产生高亮');
runFrames(5);

play.doAction('reset');      // 第一次 → 进确认态
check(play.confirmReset > 0, '重置没有二次确认');
play.doAction('reset');      // 第二次 → 真正重置
runFrames(10);
check(p2.remaining() === p2.pieces.length && p2.filled() === 0, '重置失败');

/* ---------- 6. 高难度关（7x7 / 8x8）跑一遍 ---------- */
[20, 40, 60].forEach(function (n) {
  BF.App.go('play', { level: n, game: 'block' });
  var sc = BF.App.scenes.play;
  runFrames(30);
  var t0 = Date.now();
  solveLevel(sc, 22);
  check(sc.model.filled() === sc.model.area,
    '第' + n + '关(' + sc.model.size + 'x' + sc.model.size + ')没能填满: ' +
    sc.model.filled() + '/' + sc.model.area);
  check(!!sc.win, '第' + n + '关没有触发过关');
  if (Date.now() - t0 > 3000) { fails.push('第' + n + '关模拟耗时过长'); }
});

/* ---------- 6b. 最后一关：弹窗右按钮应回关卡页，而不是"下一关" ---------- */
(function () {
  var sc = BF.App.scenes.play;              // 上面刚通关第 60 关
  check(!!sc.win, '第60关通关后没有弹窗，6b 无法验证');
  var ob = sc.overlayLayout();
  tap(ob.next.x + ob.next.w / 2, ob.next.y + ob.next.h / 2);
  runFrames(5);
  check(BF.App.current === BF.App.scenes.levels, '最后一关点「返回关卡」没有回到关卡页');
})();

/* ---------- 7. 每日挑战：同一天两次题目必须一致 ---------- */
BF.App.go('play', { daily: true });
var d1 = JSON.stringify(BF.App.scenes.play.model.puzzle.pieces);
runFrames(10);
solveLevel(BF.App.scenes.play, 24);
check(BF.App.scenes.play.model.isSolved() || !!BF.App.scenes.play.win, '每日挑战无法通关');

/* 每日挑战的弹窗右按钮 = 返回首页 */
(function () {
  var sc = BF.App.scenes.play;
  check(!!sc.win, '每日挑战通关后没有弹窗');
  if (!sc.win) { return; }
  var ob = sc.overlayLayout();
  tap(ob.next.x + ob.next.w / 2, ob.next.y + ob.next.h / 2);
  runFrames(5);
  check(BF.App.current === BF.App.scenes.home, '每日挑战点「返回首页」没有回首页');
})();

BF.App.go('play', { daily: true });
var d2 = JSON.stringify(BF.App.scenes.play.model.puzzle.pieces);
check(d1 === d2, '每日挑战两次生成不一致');
check(BF.Save.isDailyDoneToday(), '每日挑战完成状态没落档');

/* ---------- 8. 返回首页 ---------- */
BF.App.go('levels');
runFrames(5);
var backTap = BF.App.scenes.levels.back;
tap(backTap.x + 20, backTap.y + 20);
check(BF.App.current === BF.App.scenes.home, '返回首页失败');
runFrames(5);

/* ---------- 9. 游戏 2「逻辑拼图」端到端 ---------- */
var home2 = BF.App.scenes.home;
var logicCard = null;
for (var ci = 0; ci < home2.cards.length; ci++) {
  if (home2.cards[ci].key === 'logic') { logicCard = home2.cards[ci]; }
}
check(!!logicCard, '首页没有「逻辑拼图」卡片');
tap(logicCard.x + logicCard.w / 2, logicCard.y + logicCard.h / 2);
check(BF.App.current === BF.App.scenes.levels, '点「逻辑拼图」没有进入关卡页');

var lv2 = BF.App.scenes.levels;
check(lv2.game === 'logic', '关卡页没有切到 logic，实际 ' + lv2.game);
check(lv2.meta.title === '逻辑拼图', '关卡页标题不对：' + lv2.meta.title);
check(lv2.total === BF.Logic.TOTAL, '关卡页总数不对：' + lv2.total);
runFrames(5);

// 解锁后从关卡页点第 1 关进去
BF.Save.bucket('logic').unlocked = BF.Logic.TOTAL;
runFrames(1);
var r1 = lv2.rectOf(1);
tap(r1.x + r1.w / 2, r1.y + r1.h / 2);
check(BF.App.current === BF.App.scenes.play, '逻辑拼图没有进入玩法页');

var lp = BF.App.scenes.play;
check(lp.game === 'logic', 'play 场景 game 标识不对：' + lp.game);
check(lp.skin === 'logic', 'play 场景没有切到 logic 皮肤');
check(lp.model.size === 8, '逻辑拼图应为 8x8，实际 ' + lp.model.size);
check(lp.model.pieces.length === 11, '总块数应为 11，实际 ' + lp.model.pieces.length);
check(lp.model.pieces.filter(function (q) { return q.fixed; }).length === 3, '固定块应为 3 块');
check(lp.model.remaining() === 8, '托盘应为 8 块待放，实际 ' + lp.model.remaining());
check(lp.model.filled() === 6, '开局棋盘应已填 6 格，实际 ' + lp.model.filled());
runFrames(20);

/* 托盘块必须全部落在托盘面板里（曾经因为缩放档位不够，底层块盖住了底部按钮） */
var trayOverflow = 0;
var trayList = lp.model.trayPieces();
for (var ti = 0; ti < trayList.length; ti++) {
  var tq = trayList[ti];
  var rightEdge = tq.tx + tq.w * lp.L.cell * tq.tScale;
  var bottomEdge = tq.ty + tq.h * lp.L.cell * tq.tScale;
  if (rightEdge > lp.L.tray.x + lp.L.tray.w + 1) { trayOverflow++; }
  if (bottomEdge > lp.L.tray.y + lp.L.tray.h + 1) { trayOverflow++; }
  if (tq.tx < lp.L.tray.x - 1) { trayOverflow++; }
  if (tq.ty < lp.L.tray.y - 1) { trayOverflow++; }
}
check(trayOverflow === 0, '托盘块溢出 ' + trayOverflow + ' 处  tray=' +
  Math.round(lp.L.tray.x) + ',' + Math.round(lp.L.tray.y) + ' ' +
  Math.round(lp.L.tray.w) + 'x' + Math.round(lp.L.tray.h) + '  cell=' + lp.L.cell.toFixed(1) +
  '  items=' + trayList.map(function (q) {
    return q.w + 'x' + q.h + '@' + Math.round(q.tx) + ',' + Math.round(q.ty) +
      ' s' + q.tScale.toFixed(2) + ' -> r' + Math.round(q.tx + q.w * lp.L.cell * q.tScale) +
      ' b' + Math.round(q.ty + q.h * lp.L.cell * q.tScale);
  }).join(' | '));

/* 固定块开局就位、拖不动 */
var fpc = lp.model.pieces.filter(function (q) { return q.fixed; })[0];
var filled0 = lp.model.filled();
var fx = lp.L.inner.x + fpc.solX * lp.L.cell + lp.L.cell * 0.5;
var fy = lp.L.inner.y + fpc.solY * lp.L.cell + lp.L.cell * 0.5;
drag(fx, fy, fx + 70, fy + 70);
runFrames(6);
check(lp.model.filled() === filled0, '固定块被拖走后棋盘格数变了');
check(fpc.placed && fpc.x === fpc.solX && fpc.y === fpc.solY, '固定块被移动了');

/* 把 8 块托盘块按标准答案拖通 */
solveLevel(lp, 22);
check(lp.model.filled() === lp.model.area,
  '逻辑拼图没能填满: ' + lp.model.filled() + '/' + lp.model.area);
check(!!lp.win, '逻辑拼图填满后没有触发过关');
check(BF.Save.isCleared('logic', 1), '逻辑拼图通关没写入存档');
check(lp.win.stars === 3, '逻辑拼图干净通关应得 3 星，实际 ' + lp.win.stars);

/* 弹窗按钮：逻辑拼图必须和方块拼图一样能点（同一场景的弹层，别只测一款） */
(function () {
  var obL = lp.overlayLayout();
  tap(obL.next.x + obL.next.w / 2, obL.next.y + obL.next.h / 2);
  runFrames(5);
  check(BF.App.current === lp && lp.level === 2, '逻辑拼图「下一关」没有切到第 2 关');
  check(!lp.win, '逻辑拼图「下一关」后弹窗没关');

  check(lp.model.remaining() === 8, '逻辑拼图第 2 关开局托盘应为 8 块');

  // 重玩：清掉进度，但 3 块固定块必须仍在位（共 6 格）
  solveLevel(lp, 22);
  runFrames(20);
  check(!!lp.win, '逻辑拼图第 2 关通关后没有弹窗');
  var obL2 = lp.overlayLayout();
  tap(obL2.again.x + obL2.again.w / 2, obL2.again.y + obL2.again.h / 2);
  runFrames(5);
  check(!lp.win, '逻辑拼图「重玩」没有关掉过关弹窗');
  check(lp.level === 2, '逻辑拼图「重玩」跑到了别的关卡: ' + lp.level);
  check(lp.model.filled() === 6, '逻辑拼图「重玩」后应只剩 3 块固定块(6 格)，实际 ' + lp.model.filled());
})();

/* 两款游戏的存档互不污染 */
check(!BF.Save.isCleared('logic', 55), 'logic 存档被污染');
check(BF.Save.isCleared('block', 1), 'block 存档丢失');

/* 从逻辑拼图返回关卡页 → 再返回首页 */
BF.App.go('levels', { game: 'logic' });
runFrames(5);
check(BF.App.scenes.levels.game === 'logic', '返回关卡页后游戏标识丢失');
tap(BF.App.scenes.levels.back.x + 20, BF.App.scenes.levels.back.y + 20);
check(BF.App.current === BF.App.scenes.home, '逻辑拼图返回首页失败');
runFrames(5);

/* ---------- 10. canvas 状态栈平衡（真机"卡住"的根因） ---------- */
/* draw.js 的 block() 曾经少一次 ctx.restore()：每画一个方块泄漏一层 canvas 状态。
   真机状态栈有上限，攒够之后 save() 直接抛错 → 整屏卡死（用户报「不时的会卡住」）。
   假 canvas 的 save 是空函数、永远不会溢出，所以必须像这样手动记账才测得出来。 */
check(ctxLeaks.length === 0,
  'canvas save/restore 泄漏了 ' + ctxLeaks.length + ' 次（净层数 ' +
  (ctxLeaks.length ? ctxLeaks.slice(0, 8).join(',') : 0) +
  '）—— 真机上会攒到状态栈溢出，表现为玩一会儿就卡死');
check(ctxUnderflow === 0, 'ctx.restore() 调用次数多于 save()：' + ctxUnderflow + ' 次');
check(ctxDepth === 0, '主循环结束时 canvas 状态栈没有回到 0，残留 ' + ctxDepth + ' 层');

/* ---------- 11. 主循环可调度 ---------- */
check(frames.length > 0, 'requestFrame 未被调用');

/* ---------- 结果 ---------- */
if (fails.length) {
  console.log('❌ 失败 ' + fails.length + ' 项:');
  fails.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
} else {
  console.log('✅ 端到端交互自检全部通过');
  console.log('   场景切换 / 拖拽吸附 / 放置校验 / 通关判定 / 撤销 / 重置 / 提示 / 每日挑战 / 存档 均正常');
  console.log('   过关弹窗按钮：重玩 / 下一关 / 最后一关返回关卡 / 每日挑战返回首页 —— 两款游戏均已点通');
  console.log('   canvas 状态栈平衡：' + ctxMaxDepth + ' 层峰值，结束回到 0（无 save/restore 泄漏）');
  console.log('   已自动通关：方块拼图 第 1、2、20、40、60 关 + 每日挑战；逻辑拼图 第 1、2 关');
}
