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

/** 照片拼图的 drawImage 调用记录（验证切片区域用） */
var drawCalls = [];

function fakeCtx() {
  var grad = { addColorStop: function () {} };
  var target = {
    save: function () { ctxDepth++; if (ctxDepth > ctxMaxDepth) { ctxMaxDepth = ctxDepth; } },
    restore: function () { ctxDepth--; if (ctxDepth < 0) { ctxUnderflow++; ctxDepth = 0; } },
    scale: function () {},
    setTransform: function () {}, transform: function () {}, translate: function () {}, rotate: function () {},
    fillRect: function () {}, clearRect: function () {}, strokeRect: function () {},
    beginPath: function () {}, closePath: function () {}, moveTo: function () {},
    lineTo: function () {}, arc: function () {}, arcTo: function () {}, rect: function () {},
    clip: function () {}, fill: function () {}, stroke: function () {},
    setLineDash: function () {},
    // 照片拼图：把 drawImage 的 9 个参数记下来，
    // 这样"切片区域算得对不对"能在测试里直接断言，不用靠看截图。
    drawImage: function (img, sx, sy, sw, sh, dx, dy, dw, dh) {
      drawCalls.push({ img: img, sx: sx, sy: sy, sw: sw, sh: sh, dx: dx, dy: dy, dw: dw, dh: dh });
    },
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
  bindPointer: function (h) { input.down = h.down; input.move = h.move; input.up = h.up; },
  // 照片拼图要用。测试里同步回调即可 —— 这样 photoImg 立刻就位，
  // 能顺带验证切片坐标（drawImage 的参数被 fakeCtx 记下来）。
  createImage: function (src, cb) {
    var img = { src: src, width: 720, height: 720, __fake: true };
    if (cb) { cb(null, img); }
    return img;
  },
  chooseImage: function (cb) { cb(new Error('测试环境不支持选图')); }
};

load('js/core/save.js');
load('js/game/generator.js');
load('js/game/logic.js');
load('js/game/photoAssets.js');
load('js/game/photo.js');
load('js/game/diffAssets.js');
load('js/game/diff.js');
load('js/game/model.js');
load('js/scenes/home.js');
load('js/scenes/levels.js');
load('js/scenes/diffpick.js'); // 「先选难度再进游戏」首屏（rush / diff / blocks 共用）
load('js/scenes/ruletip.js'); // 「玩法说明」弹框（11 款游戏共用）
load('js/scenes/play.js');
load('js/scenes/diff.js');
load('js/game/bottle.js');
load('js/scenes/bottle.js');
load('js/game/cipher.js');
load('js/scenes/cipher.js');
load('js/game/rush.js');        // 游戏 7「移车出库」关卡生成器 + BFS 求解器
load('js/scenes/rush.js');      // 游戏 7 玩法场景
load('js/game/blocks.js');      // 游戏 8「超级积木」关卡生成器 + 精确覆盖求解器
load('js/scenes/blocks.js');    // 游戏 8 玩法场景
load('js/game/sudoku.js');      // 游戏 9「九宫格数独」关卡生成器 + 求解器
load('js/game/mine.js');       // 游戏 11「扫雷」关卡生成器 + 演绎求解器
load('js/scenes/sudoku.js');    // 游戏 9 玩法场景
load('js/scenes/mine.js');      // 游戏 11 玩法场景
load('js/game/picross.js');     // 游戏 12「数织」关卡数据层 + 唯一解求解器
load('js/scenes/picross.js');   // 游戏 12 玩法场景
load('js/app.js');

/* 规则弹框总开关：harness 里默认关掉（否则 enter 后输入全被弹框拦走，老用例全挂）。
   弹框自身的行为由第 9g 节专门覆盖（那节里临时打开）。 */
BF.RuleTip.on = false;

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

/* 1b. 卡片文案必须装进卡片里。
   为什么有这条：卡片高度早期只防了"算成负数"（防 arc 负半径崩屏），没设可读下限，
   真机 iPhone 8（375×667）上 11 张卡把高度压到 36px，而标题固定 17px
   —— 文案比卡片还高，直接顶出卡片上下边，是靠放大真机截图才看出来的。
   现在文字/图标都随卡片高度缩放，装不下就整页可滚动，这条断言守住它。 */
(function () {
  var bad = [];
  var pf = BF.platform;
  var keep = { w: pf.width, h: pf.height, st: pf.safeTop, sb: pf.safeBottom };
  [[320, 480, 20, 0], [360, 640, 24, 0], [375, 667, 20, 0], [375, 812, 44, 34],
   [390, 844, 47, 34], [414, 736, 24, 0], [430, 932, 59, 34], [768, 1024, 24, 0]]
    .forEach(function (dd) {
      pf.width = dd[0]; pf.height = dd[1]; pf.safeTop = dd[2]; pf.safeBottom = dd[3];
      home.layout();
      var tag = dd[0] + '×' + dd[1];
      var needScroll = home.contentH > home.viewH + 0.5;
      if (home.minScroll > 0) { bad.push(tag + ' minScroll 为正'); }
      if (needScroll && home.minScroll >= 0) { bad.push(tag + ' 一屏装不下却没开滚动'); }
      if (!needScroll && home.minScroll !== 0) { bad.push(tag + ' 一屏装得下却开了滚动'); }
      for (var i = 0; i < home.cards.length; i++) {
        var c = home.cards[i];
        var g = home.cardTextLayout({ x: c.x, y: c.y, w: c.w, h: c.h });
        if (g.top < c.y - 0.6) { bad.push(tag + ' ' + c.key + ' 文案突出卡片上边'); }
        if (g.top + g.blockH > c.y + c.h + 0.6) { bad.push(tag + ' ' + c.key + ' 文案突出卡片下边'); }
        if (home.estTextWidth(c.title, g.titleSize) > g.textMax) {
          bad.push(tag + ' ' + c.key + ' 标题过宽');
        }
        if (home.estTextWidth(c.sub, g.subSize) > g.textMax) {
          bad.push(tag + ' ' + c.key + ' 副标题过宽(' + c.sub.length + '字)');
        }
        if (g.isz < 12) { bad.push(tag + ' ' + c.key + ' 图标被压成 ' + g.isz.toFixed(1) + 'px'); }
        if (g.arrowR * 2 > c.h + 0.5) { bad.push(tag + ' ' + c.key + ' 箭头比卡片还高'); }
      }
    });
  pf.width = keep.w; pf.height = keep.h; pf.safeTop = keep.st; pf.safeBottom = keep.sb;
  home.layout();
  check(bad.length === 0, '首页卡片排版溢出：' + bad.slice(0, 6).join('、'));
})();

/* 1c. 矮屏首页可拖动滚动，且拖动不会被误判成点击卡片 */
(function () {
  var pf = BF.platform;
  var keep = { w: pf.width, h: pf.height, st: pf.safeTop, sb: pf.safeBottom };
  pf.width = 375; pf.height = 667; pf.safeTop = 20; pf.safeBottom = 0;
  home.enter();
  check(home.minScroll < 0, 'iPhone 8（375×667）首页应可滚动，实际 minScroll=' + home.minScroll);
  input.down(195, 440);
  for (var s = 0; s < 8; s++) { input.move(195, 440 - s * 14); }
  input.up(195, 328);
  check(home.scroll < -20, '首页拖动没滚动：scroll=' + home.scroll);
  check(home.scroll >= home.minScroll - 0.5,
    '首页滚动越界：' + home.scroll + ' < ' + home.minScroll);
  check(BF.App.current === BF.App.scenes.home, '首页拖动被误判成点击卡片');
  pf.width = keep.w; pf.height = keep.h; pf.safeTop = keep.st; pf.safeBottom = keep.sb;
  home.enter();
  check(home.scroll === 0 && home.minScroll === 0,
    '还原尺寸后首页滚动状态没复位（scroll=' + home.scroll + ' minScroll=' + home.minScroll + '）');
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

/* ---------- 9c. 游戏 3「照片拼图」端到端 ---------- */
/* 和前两款最大的不同：判定更严（strict）。前两款只要把棋盘填满就算赢；
   照片拼图要求每块都回到它原本在照片里的那个格子，否则"摆满了也不算过关"。
   这套拖拽逻辑要真跑一遍才放心 —— 尤其确认"按答案能过关 + 摆错位置不过关"。 */
var home3 = BF.App.scenes.home;
var photoCard = null;
for (var pci = 0; pci < home3.cards.length; pci++) {
  if (home3.cards[pci].key === 'photo') { photoCard = home3.cards[pci]; }
}
check(!!photoCard, '首页没有「照片拼图」卡片');
check(photoCard.enabled, '「照片拼图」卡片应可用（已有 ' + BF.Photos.all().length + ' 张内置照片）');
tap(photoCard.x + photoCard.w / 2, photoCard.y + photoCard.h / 2);
check(BF.App.current === BF.App.scenes.levels, '点「照片拼图」没有进入关卡页');

var lv3 = BF.App.scenes.levels;
check(lv3.game === 'photo', '关卡页没有切到 photo，实际 ' + lv3.game);
check(lv3.meta.title === '照片拼图', '关卡页标题不对：' + lv3.meta.title);
check(lv3.total === BF.games.photo.TOTAL, '关卡页总数不对：' + lv3.total);
runFrames(5);

/* 难度入口：照片拼图关卡页顶部应有一排「难度」快捷条（3×3~8×8），点一下直接进该档第一关 */
check(lv3.hasDiff === true, '照片拼图关卡页应显示难度入口');
check(!!lv3.chips && lv3.chips.length === 6, '难度快捷条应有 6 档（3×3~8×8），实际 ' + (lv3.chips ? lv3.chips.length : 0));
check(lv3.chips[0].size === 3 && lv3.chips[5].size === 8, '难度快捷条档位顺序不对');
var chip6 = lv3.chips[3];   // 6×6
tap(chip6.x + chip6.w / 2, chip6.y + chip6.h / 2);
check(BF.App.current === BF.App.scenes.play, '点难度快捷条没有进入玩法页');
check(BF.App.scenes.play.level === 31, '点「6×6」应进入第 31 关，实际 ' + BF.App.scenes.play.level);
check(BF.App.scenes.play.model.size === 6, '点「6×6」后棋盘应为 6×6，实际 ' + BF.App.scenes.play.model.size);
BF.App.go('levels', { game: 'photo' });   // 回关卡页继续后面的流程
runFrames(3);

// 解锁全部后从第 1 关进去（教学关 3×3）
BF.Save.bucket('photo').unlocked = BF.games.photo.TOTAL;
runFrames(1);
var r1p = lv3.rectOf(1);
tap(r1p.x + r1p.w / 2, r1p.y + r1p.h / 2);
check(BF.App.current === BF.App.scenes.play, '照片拼图没有进入玩法页');

var pp = BF.App.scenes.play;
check(pp.game === 'photo', 'play 场景 game 标识不对：' + pp.game);
check(pp.skin === 'photo', 'play 场景没有切到 photo 皮肤');
check(pp.model.size === 3, '照片拼图第 1 关应为 3x3，实际 ' + pp.model.size);
check(pp.model.pieces.length === 9, '总块数应为 9，实际 ' + pp.model.pieces.length);
check(pp.puzzle.strict === true, '照片拼图应为严格判定（strict=true）');
check(!!pp.puzzle.photo && !!pp.puzzle.photo.src, '照片拼图第 1 关没有分配照片');
check(!!pp.photoImg, '照片异步加载后 photoImg 未就位（渲染会退化成色块，看不到照片）');
runFrames(20);

/* 提示图（棋盘底淡参照）：默认显示 → 轻触棋盘可切换 → 进关 5 秒后自动收起 */
check(pp.showHint === true, '照片拼图进关应默认显示提示图');
check(pp.hintAuto === true, '进关应武装"5 秒后自动收起提示图"');
var boardCx = pp.L.inner.x + pp.L.inner.w / 2;
var boardCy = pp.L.inner.y + pp.L.inner.h / 2;
tap(boardCx, boardCy);
check(pp.showHint === false, '轻触棋盘空白区没有把提示图切成隐藏');
tap(boardCx, boardCy);
check(pp.showHint === true, '再次轻触棋盘没有把提示图切回显示');
for (var hfi = 0; hfi < 400; hfi++) { pp.update(16); }   // 走完 6.4s > 5s
check(pp.showHint === false && pp.hintAuto === false, '进关 5 秒后提示图没有自动收起');
pp.showHint = true; pp.hintAuto = false; pp.hintFlip = 1;   // 恢复显示，后面的拖拽截图仍带参照

/* 渲染时应真的用 drawImage 把切片原图画出来，而不是退化成纯色块 */
var photoDrawN = 0;
for (var di = 0; di < drawCalls.length; di++) {
  var dc = drawCalls[di];
  if (dc.img && dc.img.__fake && dc.sw > 0 && dc.sh > 0) { photoDrawN++; }
}
check(photoDrawN > 0, '照片拼图没有调用 drawImage 渲染切片（可能退化成色块）');

/* 把 9 块碎片按标准答案拖回原位 → 通关 */
solveLevel(pp, 22);
check(pp.model.filled() === pp.model.area,
  '照片拼图没能填满: ' + pp.model.filled() + '/' + pp.model.area);
check(pp.model.isSolved(), '照片拼图按答案拼好却没判定过关（strict 判定异常）');
check(!!pp.win, '照片拼图填满后没有触发过关');
check(BF.Save.isCleared('photo', 1), '照片拼图通关没写入存档');
check(pp.win.stars === 3, '照片拼图干净通关应得 3 星，实际 ' + pp.win.stars);

/* 弹窗按钮：下一关 / 重玩，和前两款共用同一弹层，别只测一款 */
(function () {
  var obP = pp.overlayLayout();
  tap(obP.next.x + obP.next.w / 2, obP.next.y + obP.next.h / 2);
  runFrames(5);
  check(BF.App.current === pp && pp.level === 2, '照片拼图「下一关」没有切到第 2 关');
  check(!pp.win, '照片拼图「下一关」后弹窗没关');

  solveLevel(pp, 22);
  runFrames(20);
  check(!!pp.win, '照片拼图第 2 关通关后没有弹窗');
  var obP2 = pp.overlayLayout();
  tap(obP2.again.x + obP2.again.w / 2, obP2.again.y + obP2.again.h / 2);
  runFrames(5);
  check(!pp.win, '照片拼图「重玩」没有关掉过关弹窗');
  check(pp.level === 2, '照片拼图「重玩」跑到了别的关卡: ' + pp.level);
  check(pp.model.remaining() === pp.model.pieces.length, '照片拼图「重玩」后棋盘没清空');
})();

/* strict 的核心差异：把碎片 cyclic 挪一格放满（每块都不在正确答案位）
   → 不能算过关，且错位块数 = 全部。这一步专门拦"摆满了却判过关"的回归。 */
(function () {
  var pg = new BF.Model(BF.games.photo.build(1));
  var n = pg.pieces.length;
  for (var i = 0; i < n; i++) {
    var p = pg.pieces[i];
    var tgt = (i + 1) % n;                 // 顺时针挪一格：每块都错
    pg.place(p, tgt % pg.size, Math.floor(tgt / pg.size));
  }
  check(pg.filled() === pg.area, 'cyclic 摆放没能填满（测试构造问题）');
  check(!pg.isSolved(), 'strict 关：填满但每块错位，竟被判过关（bug）');
  check(pg.misplaced() === n, '错位块数统计应为 ' + n + '，实际 ' + pg.misplaced());
})();

/* 三款游戏的存档互不污染 */
check(!BF.Save.isCleared('photo', 55), 'photo 存档被污染');
check(BF.Save.isCleared('photo', 1), 'photo 存档丢失');
check(BF.Save.isCleared('block', 1), 'block 存档丢失');
check(BF.Save.isCleared('logic', 1), 'logic 存档丢失');

/* 从照片拼图返回关卡页 → 首页 */
BF.App.go('levels', { game: 'photo' });
runFrames(5);
check(BF.App.scenes.levels.game === 'photo', '返回关卡页后游戏标识丢失');
tap(BF.App.scenes.levels.back.x + 20, BF.App.scenes.levels.back.y + 20);
check(BF.App.current === BF.App.scenes.home, '照片拼图返回首页失败');
runFrames(5);

/* ---------- 9d. 游戏 4：图片找不同（端到端） ---------- */
/* 与前三款不同：这里没有棋盘/拖拽，只有"点按命中差异矩形"，
   所以走的是独立场景 diff（关卡页按 meta.scene 路由过来）。 */
var home4 = BF.App.scenes.home;
home4.enter();
var diffCard = null;
for (var di4 = 0; di4 < home4.cards.length; di4++) {
  if (home4.cards[di4].key === 'diff') { diffCard = home4.cards[di4]; }
}
check(!!diffCard, '首页没有「图片找不同」卡片');
check(diffCard && diffCard.enabled, '有内置图对时找不同卡片应当可点');
// 与移车出库同思路：首页点卡片先进「难度自选首屏」，不再直接进关卡页
check(diffCard && diffCard.mode === 'pickDiff',
  '找不同卡片应走难度自选（mode=pickDiff），实际 ' + (diffCard && diffCard.mode));
tap(diffCard.x + diffCard.w / 2, diffCard.y + diffCard.h / 2);
runFrames(3);
check(BF.App.current === BF.App.scenes.diff, '点找不同卡片没进难度自选首屏');
check(BF.App.scenes.diff.pickDiff === true, '点找不同卡片后应停在难度自选首屏');

// 关卡页（老路径：难度首屏里的「查看全部关卡」）仍要能正确路由到 diff 场景
BF.App.go('levels', { game: 'diff' });
runFrames(2);
var lv4 = BF.App.scenes.levels;
check(lv4.game === 'diff', '关卡页没有切到 diff，实际 ' + lv4.game);
check(lv4.meta.title === '图片找不同', '关卡页标题不对：' + lv4.meta.title);
check(lv4.total === BF.games.diff.TOTAL, '关卡页总数不对：' + lv4.total);
// 关卡页必须路由到 diff 场景，而不是共用的 play（play 需要 puzzle.pieces，会直接炸）
check(lv4.target === 'diff', '关卡页路由错了，实际去了 ' + lv4.target);
// 难度条：找不同的档位是"不同处数"
check(lv4.chips && lv4.chips.length >= 5, '找不同关卡页没有难度条');
check(typeof lv4.meta.chipLabel === 'function' && lv4.meta.chipLabel(5) === '5 处',
  '难度标签格式不对：' + (lv4.meta.chipLabel && lv4.meta.chipLabel(5)));
runFrames(5);

BF.Save.bucket('diff').unlocked = BF.games.diff.TOTAL;
BF.App.go('diff', { level: 1, game: 'diff' });
var ds = BF.App.scenes.diff;
check(BF.App.current === ds, '进找不同关卡失败');
runFrames(3);
check(!!ds.imgA && !!ds.imgB, '找不同的两张图没加载出来（会退化成色块，看不出不同）');
check(ds.puzzle.total >= 3, '第 1 关的差异数太少：' + ds.puzzle.total);
check(ds.foundCount === 0, '刚进关不该有已找到的差异');

/* 点错：点一个必不命中的位置。
   注意：主题场景里物件可能正好落在图片角落（如太阳在左上格），
   所以不能直接硬点(3,3)这种固定角 —— 先在归一化网格里找一个真正不在任何
   差异矩形（含命中容差）内的点，再换算成屏幕坐标去点。 */
function emptyNorm(sc) {
  var diffs = sc.puzzle.diffs, TOL = 0.06;
  for (var gy = 0; gy <= 10; gy++) {
    for (var gx = 0; gx <= 10; gx++) {
      var u = gx / 10, v = gy / 10, hit = false, i;
      for (i = 0; i < diffs.length; i++) {
        var d = diffs[i];
        if (u >= d.u - TOL && u <= d.u + d.uw + TOL &&
            v >= d.v - TOL && v <= d.v + d.vh + TOL) { hit = true; break; }
      }
      if (!hit) { return { u: u, v: v }; }
    }
  }
  return { u: 0.5, v: 0.5 };
}
var ept = emptyNorm(ds);
var beforeMiss = ds.mistakes;
tap(ds.rectB.x + ept.u * ds.rectB.w, ds.rectB.y + ept.v * ds.rectB.h);
runFrames(2);
check(ds.mistakes === beforeMiss + 1, '点错没有计入失误');
check(!!ds.wrongFx, '点错没有画出红叉反馈');
check(ds.foundCount === 0, '点错竟被当成找到');

/* 逐处点中：走真实命中判定（换算成归一化坐标后点图 B） */
var diffs1 = ds.puzzle.diffs;
function tapDiff(sc, i) {
  var d = sc.puzzle.diffs[i];
  tap(sc.rectB.x + (d.u + d.uw / 2) * sc.rectB.w,
      sc.rectB.y + (d.v + d.vh / 2) * sc.rectB.h);
  runFrames(2);
}
tapDiff(ds, 0);
check(ds.foundCount === 1, '点中差异没被记成找到，实际 ' + ds.foundCount);
check(ds.found[0] === true, '第 0 处未标记为已找到');
// 同一处再点一次不算 2 次（点已找到的区域不该重复计数）
tapDiff(ds, 0);
check(ds.foundCount === 1, '同一处重复点被重复计数');

/* 提示：圈出一处还没找到的，且不该提示已找到的 */
ds.doAction('hint');
runFrames(2);
check(!!ds.hintFx, '提示没有产生标记动画');
check(ds.hintFx.idx !== 0, '提示圈到了已经找到的第 0 处');

/* 重来：清空进度 */
ds.doAction('reset');
runFrames(2);
check(ds.foundCount === 0 && ds.mistakes === 0, '重来没有清空进度');

/* 全部找到 → 过关（全程不错点，应为 3 星） */
for (var k4 = 0; k4 < diffs1.length; k4++) { tapDiff(ds, k4); }
check(ds.foundCount === ds.puzzle.total, '没有全部找到：' + ds.foundCount + '/' + ds.puzzle.total);
check(!!ds.win, '找齐所有不同却没有过关');
check(ds.win.stars === 3, '全程没错点应为 3 星，实际 ' + ds.win.stars);
check(BF.Save.isCleared('diff', 1), '找不同过关没有写进存档');
runFrames(20);

/* 过关弹窗「下一关」按钮：走按下→抬起两段式，
   中间必须夹着帧 —— 只测一次点击容易漏掉"按下被清掉"的回归 */
var ob4 = ds.overlayLayout();
input.down(ob4.next.x + ob4.next.w / 2, ob4.next.y + ob4.next.h / 2);
runFrames(2);
input.up(ob4.next.x + ob4.next.w / 2, ob4.next.y + ob4.next.h / 2);
runFrames(3);
check(ds.level === 2, '找不同「下一关」没生效，仍停在第 ' + ds.level + ' 关');

/* 存档隔离：找不同的进度不影响其它游戏 */
check(!BF.Save.isCleared('photo', 55), 'photo 存档被污染');
check(BF.Save.isCleared('photo', 1), 'photo 存档丢失');
check(BF.Save.isCleared('block', 1), 'block 存档丢失');
check(BF.Save.isCleared('logic', 1), 'logic 存档丢失');

/* 从找不同返回关卡页 → 首页 */
BF.App.go('levels', { game: 'diff' });
runFrames(5);
tap(BF.App.scenes.levels.back.x + 20, BF.App.scenes.levels.back.y + 20);
check(BF.App.current === BF.App.scenes.home, '找不同返回首页失败');
runFrames(5);

/* ---------- 9b. 密码推理：拼行 → 提交 → 反馈 → 破译成功 ---------- */
BF.App.go('cipher', { level: 1, game: 'cipher' });
var cs = BF.App.scenes.cipher;
runFrames(4);
check(cs.cfg.slots === 3, '密码推理第 1 关应为 3 位，实际 ' + cs.cfg.slots);

function palTapC(i) { var p = cs.palettes[i]; tap(p.x + p.w / 2, p.y + p.h / 2, 2); }
function submitC() { var b = cs.btns[2]; tap(b.x + b.w / 2, b.y + b.h / 2, 2); }

/* 提交一行必错的猜测（密码循环左移一位，slots≥2 时必不等于密码）→ 产出一行带反馈的记录 */
var wrong = cs.code.slice(1).concat([cs.code[0]]);
cs.doAction('clear');
for (var q1 = 0; q1 < cs.cfg.slots; q1++) { palTapC(cs.usable.indexOf(wrong[q1])); }
submitC();
check(cs.rows.length === 1, '提交一行后 rows 应为 1，实际 ' + cs.rows.length);
check(!!cs.rows[0].fb && cs.rows[0].fb.exact + cs.rows[0].fb.color + cs.rows[0].fb.miss === cs.cfg.slots,
  '密码推理反馈三项之和不等于位数');
check(cs.edit.every(function (v) { return v < 0; }), '提交后编辑行应清空');
check(!cs.result, '错误猜测不应结算');

/* 未填满提交应被拒（不产生新行） */
cs.doAction('clear');
submitC();
check(cs.rows.length === 1, '未填满不应产生新行');

/* 用调色板拼出正确密码并提交 → 破译成功 */
cs.doAction('clear');
for (var q2 = 0; q2 < cs.cfg.slots; q2++) { palTapC(cs.usable.indexOf(cs.code[q2])); }
submitC();
check(!!cs.result && cs.result.win, '拼对密码却没破译成功');
check(cs.result.stars >= 1 && cs.result.stars <= 3, '密码推理星级非法：' + (cs.result && cs.result.stars));
check(BF.Save.isCleared('cipher', 1), '密码推理过关没有写进存档');
runFrames(20);

/* 结算「下一关」：按下→抬起两段式，中间夹帧 */
var oc = cs.overlayLayout();
input.down(oc.next.x + oc.next.w / 2, oc.next.y + oc.next.h / 2); runFrames(2);
input.up(oc.next.x + oc.next.w / 2, oc.next.y + oc.next.h / 2); runFrames(3);
check(cs.level === 2, '密码推理「下一关」没生效，仍停在第 ' + cs.level + ' 关');

/* 数量提示关（'agg'）：反馈画在**行右侧**，要预留反馈区、点阵数据齐备、不溢出屏幕 */
BF.App.go('cipher', { level: 8, game: 'cipher' });
runFrames(4);
check(cs.cfg.hint === 'agg', '第 8 关应是数量提示关，实际 ' + cs.cfg.hint);
check(cs.fbW > 0 && cs.fbRect(0).w > 0, '数量提示关应预留右侧反馈区');
check(cs.slotX0 + cs.rowBlockW <= BF.platform.width + 0.5, '数量提示关的行(含反馈区)溢出屏幕');
var wrong8 = cs.code.slice(1).concat([cs.code[0]]);   // 循环移位：颜色互异 ⇒ 每格都错、但颜色全在密码里
for (var q3 = 0; q3 < cs.cfg.slots; q3++) { palTapC(cs.usable.indexOf(wrong8[q3])); }
submitC();
check(cs.rows.length === 1, '数量提示关提交一行失败');
var fb8 = cs.rows[0].fb;
check(!!fb8 && fb8.exact + fb8.color + fb8.miss === cs.cfg.slots, '数量提示关反馈三项之和不等于位数');
check(fb8.exact === 0 && fb8.color === cs.cfg.slots, '循环移位的猜测该是 0 对位 / 全换位');
check(BF.CipherGen.aggDots(fb8).length === cs.cfg.slots, '数量提示点阵长度应等于位数');
runFrames(3);

/* 存档隔离：密码推理的进度不影响其它游戏 */
check(BF.Save.isCleared('block', 1), 'block 存档被 cipher 污染');
check(BF.Save.isCleared('logic', 1), 'logic 存档被 cipher 污染');
check(BF.Save.isCleared('photo', 1), 'photo 存档被 cipher 污染');
check(!BF.Save.isCleared('photo', 55), 'photo 存档被 cipher 污染');

/* 从密码推理返回关卡页 → 首页 */
BF.App.go('levels', { game: 'cipher' });
runFrames(5);
tap(BF.App.scenes.levels.back.x + 20, BF.App.scenes.levels.back.y + 20);
check(BF.App.current === BF.App.scenes.home, '密码推理返回首页失败');
runFrames(5);

/* ---------- 9b. 移车出库（第 7 款）：真实拖拽通关 + 存档 ---------- */
(function () {
  if (!BF.games.rush) { console.log('  ⚠ 未注册 rush，跳过'); return; }

  // 自带 BFS：从初始局面求警车出库的最短「连续滑动」移动序列（与场景 legalRange 同逻辑）
  function cellsOf(c, p, size) {
    var out = [], k;
    if (c.horiz) { for (k = 0; k < c.len; k++) out.push(c.y * size + (p + k)); }
    else { for (k = 0; k < c.len; k++) out.push((p + k) * size + c.x); }
    return out;
  }
  function legalRange(cur, cars, size, i) {
    var c = cars[i], Lc = c.len, cpos = cur[i];
    var cfix = c.horiz ? c.y : c.x;
    var min = 0, max = size - Lc;
    for (var j = 0; j < cars.length; j++) {
      if (j === i) { continue; }
      var o = cars[j];
      var opos = cur[j];
      var ofix = o.horiz ? o.y : o.x;
      if (c.horiz) {
        var oInRow = o.horiz ? (ofix === cfix) : (opos <= cfix && cfix <= opos + o.len - 1);
        if (!oInRow) { continue; }
        var oCol = o.horiz ? opos : ofix, oCols = o.horiz ? o.len : 1;
        if (oCol + oCols - 1 < cpos) { min = Math.max(min, oCol + oCols); }
        else if (oCol > cpos + Lc - 1) { max = Math.min(max, oCol - Lc); }
      } else {
        var oInCol = o.horiz ? (opos <= cfix && cfix <= opos + o.len - 1) : (ofix === cfix);
        if (!oInCol) { continue; }
        var oRow = o.horiz ? ofix : opos, oRows = o.horiz ? 1 : o.len;
        if (oRow + oRows - 1 < cpos) { min = Math.max(min, oRow + oRows); }
        else if (oRow > cpos + Lc - 1) { max = Math.min(max, oRow - Lc); }
      }
    }
    return { min: min, max: max };
  }
  function solvePath(size, cars) {
    var start = cars.map(function (c) { return c.horiz ? c.x : c.y; });
    var queue = [start], head = 0;
    var dist = {}, prev = {}, visited = 0, CAP = 400000;
    dist[start.join(',')] = 0;
    while (head < queue.length) {
      if (++visited > CAP) { return null; }
      var cur = queue[head++], key = cur.join(','), d = dist[key];
      if (cur[0] === size - 2) {
        var path = [], k = key;
        while (prev[k]) { path.push(prev[k].mv); k = prev[k].pk; }
        path.reverse();
        return path;
      }
      for (var i = 0; i < cars.length; i++) {
        var rg = legalRange(cur, cars, size, i);
        for (var to = rg.min; to <= rg.max; to++) {
          if (to === cur[i]) { continue; }
          var np = cur.slice(); np[i] = to;
          var nk = np.join(',');
          if (dist[nk] !== undefined) { continue; }
          dist[nk] = d + 1;
          prev[nk] = { pk: key, mv: { car: i, to: to } };
          queue.push(np);
        }
      }
    }
    return null;
  }

  /** 用真实指针事件（drag 助手）把一关拖到通关，覆盖 app 接线/拖拽吸附/步数/通关/存档 */
  function playRush(scene) {
    var path = solvePath(scene.size, scene.cars.map(function (c) {
      return { horiz: c.horiz, len: c.len, x: c.x, y: c.y };
    }));
    if (!path) { return { ok: false, reason: 'BFS 无解' }; }
    for (var s = 0; s < path.length; s++) {
      var mv = path[s], car = scene.cars[mv.car];
      var r0 = scene.carRect(car);
      var cx0 = r0.x + r0.w / 2, cy0 = r0.y + r0.h / 2;
      var r1 = scene.carRect(car, mv.to);
      var cx1 = r1.x + r1.w / 2, cy1 = r1.y + r1.h / 2;
      if (car.horiz) { drag(cx0, cy0, cx1, cy0); } else { drag(cx0, cy0, cx0, cy1); }
    }
    runFrames(40);   // 推进警车驶出动画(WIN_ANIM=480ms) → 结算 + 写存档
    return {
      ok: !!scene.result && scene.result.win,
      steps: scene.steps, opt: scene.opt,
      stars: scene.result ? scene.result.stars : -1
    };
  }

  function clearRush(level) {
    BF.App.go('rush', { level: level, game: 'rush' });
    runFrames(3);
    var sc = BF.App.scenes.rush;
    var r = playRush(sc);
    check(r.ok, '移车出库 L' + level + ' 没能通关' + (r.reason ? ('（' + r.reason + '）') : ''));
    check(BF.Save.isCleared('rush', level), '移车出库 L' + level + ' 通关后没写入存档');
    check(r.stars === 3, '移车出库 L' + level + ' 干净通关应 3 星，实际 ' + r.stars);
  }

  // 四档各取一关覆盖：入门/进阶/困难/专家
  clearRush(1);
  clearRush(8);
  clearRush(14);
  clearRush(20);

  // 每日挑战：同样能拖通 + 写每日存档
  BF.App.go('rush', { daily: true, game: 'rush' });
  runFrames(3);
  var dsc = BF.App.scenes.rush;
  var dr = playRush(dsc);
  check(dr.ok, '移车出库每日挑战没能通关');
  check(BF.Save.isDailyDoneToday(), '移车出库每日挑战没写入每日存档');

  // 关卡页路由：rush 关卡页总数应与 meta.TOTAL 一致
  BF.App.go('levels', { game: 'rush' });
  runFrames(3);
  check(BF.App.scenes.levels.total === BF.games.rush.TOTAL,
    '移车出库关卡页总数不对：' + BF.App.scenes.levels.total);

  // 难度自选入口：rush 关卡页应显示难度条，点「专家」chip 直接进第 16 关（跳过简单关）
  var lvScene = BF.App.scenes.levels;
  check(lvScene.hasDiff === true, '移车出库关卡页应显示难度快捷条（hasDiff）');
  check(lvScene.chips && lvScene.chips.length === 4,
    '难度条应有 4 个 chip，实际 ' + (lvScene.chips ? lvScene.chips.length : 0));
  if (lvScene.chips && lvScene.chips.length === 4) {
    var expertChip = lvScene.chips[3];   // 顺序：入门/进阶/困难/专家
    var ecx = expertChip.x + expertChip.w / 2, ecy = expertChip.y + expertChip.h / 2;
    lvScene.onDown(ecx, ecy);
    lvScene.onUp(ecx, ecy);
    runFrames(3);
    check(BF.App.scenes.rush.level === 16,
      '点「专家」chip 应进入第 16 关，实际 ' + BF.App.scenes.rush.level);
  }

  /* ---- 9b-1. 难度自选首屏：首页点「移车出库」应先选难度，而不是从最简单的第 1 关开始 ---- */
  BF.App.go('home');
  runFrames(3);
  var homeSc = BF.App.scenes.home;
  var rushCard = null;
  for (var hc = 0; hc < homeSc.cards.length; hc++) {
    if (homeSc.cards[hc].key === 'rush') { rushCard = homeSc.cards[hc]; }
  }
  check(!!rushCard, '首页应有「移车出库」卡片');
  check(rushCard && rushCard.mode === 'pickDiff',
    '首页「移车出库」卡片应走难度自选（mode=pickDiff），实际 ' + (rushCard && rushCard.mode));
  if (rushCard) {
    tap(rushCard.x + rushCard.w / 2, rushCard.y + rushCard.h / 2);
    runFrames(3);
    var pk = BF.App.scenes.rush;
    check(pk.pickDiff === true, '首页点「移车出库」应进入难度自选首屏');
    check(pk.pickCards && pk.pickCards.length === 4,
      '难度首屏应有 4 张档卡，实际 ' + (pk.pickCards ? pk.pickCards.length : 0));
    // 每张档卡都要能算出「该档第一关」与进度
    if (pk.pickCards && pk.pickCards.length === 4) {
      var ranges = pk.pickCards.map(function (c, i) { return pk.tierRange(i); });
      check(ranges[0].first === 1 && ranges[3].first === 16,
        '四档起始关应为 1/6/11/16，实际 ' + ranges.map(function (r) { return r.first; }).join('/'));
      // 点「专家」档 → 进该档第一个未通关的关
      var ep = pk.pickCards[3];
      pk.onDown(ep.x + ep.w / 2, ep.y + ep.h / 2);
      pk.onUp(ep.x + ep.w / 2, ep.y + ep.h / 2);
      runFrames(3);
      var after = BF.App.scenes.rush;
      check(after.pickDiff === false, '选了难度后应离开难度首屏');
      check(after.level >= 16 && after.level <= 20,
        '选「专家」应进入第 16~20 关，实际 ' + after.level);
    }
    // 「查看全部关卡」入口仍可达老的关卡网格页
    BF.App.go('rush', { pickDiff: true, game: 'rush' });
    runFrames(2);
    var pk2 = BF.App.scenes.rush;
    pk2.onDown(pk2.pickAll.x + pk2.pickAll.w / 2, pk2.pickAll.y + pk2.pickAll.h / 2);
    pk2.onUp(pk2.pickAll.x + pk2.pickAll.w / 2, pk2.pickAll.y + pk2.pickAll.h / 2);
    runFrames(3);
    check(BF.App.current === BF.App.scenes.levels, '难度首屏的「查看全部关卡」应进入关卡页');
    // 难度首屏的返回键回首页
    BF.App.go('rush', { pickDiff: true, game: 'rush' });
    runFrames(2);
    var pk3 = BF.App.scenes.rush;
    tap(pk3.back.x + pk3.back.w / 2, pk3.back.y + pk3.back.h / 2);
    runFrames(3);
    check(BF.App.current === BF.App.scenes.home, '难度首屏返回键应回首页');
  }

  /* ---- 9b-4. 图片找不同 / 超级积木：首页卡片同样先选难度，再进游戏 ---- */
  var PICK_GAMES = [
    { key: 'diff', scene: 'diff', nTiers: 6, firsts: [1, 9, 19, 31, 43, 53], probe: 'diffs' },
    { key: 'blocks', scene: 'blocks', nTiers: 4, firsts: [1, 11, 21, 31], probe: 'pieces' },
    { key: 'sudoku', scene: 'sudoku', nTiers: 4, firsts: [1, 11, 21, 31], probe: 'given' }
  ];
  PICK_GAMES.forEach(function (pg) {
    BF.App.go('home');
    runFrames(3);
    var card = null;
    for (var hi = 0; hi < BF.App.scenes.home.cards.length; hi++) {
      if (BF.App.scenes.home.cards[hi].key === pg.key) { card = BF.App.scenes.home.cards[hi]; }
    }
    check(!!card, '首页应有「' + pg.key + '」卡片');
    check(card && card.mode === 'pickDiff',
      '首页「' + pg.key + '」卡片应走难度自选（mode=pickDiff），实际 ' + (card && card.mode));
    if (!card) { return; }

    tap(card.x + card.w / 2, card.y + card.h / 2);
    runFrames(3);
    var sc = BF.App.scenes[pg.scene];
    check(sc.pickDiff === true, '首页点「' + pg.key + '」应进入难度自选首屏');
    check(sc.pickCards && sc.pickCards.length === pg.nTiers,
      '难度首屏应有 ' + pg.nTiers + ' 张档卡，实际 ' + (sc.pickCards ? sc.pickCards.length : 0));
    check(!sc.puzzle, '难度首屏不应加载题目（找不同会异步拉图）');

    if (sc.pickCards && sc.pickCards.length === pg.nTiers) {
      // 档卡主标题不能是光秃秃的数字（找不同 difficulties 是 3/4/5…，要显示成"3 处"）
      var titles = sc.pickCards.map(function (cc, i) { return BF.DiffPick.tierTitle(sc, i); });
      check(titles.every(function (t) { return typeof t === 'string' && t.length > 0; }),
        '「' + pg.key + '」档卡主标题为空');
      if (pg.key === 'diff') {
        check(titles.every(function (t) { return t.indexOf('处') >= 0; }),
          '「' + pg.key + '」档卡主标题应带单位（如"3 处"），实际 ' + titles.join('/'));
      }

      // 几何：档卡不重叠、不出屏、不压「查看全部关卡」
      var geoOk = true, prevBottom = -1;
      for (var gi = 0; gi < sc.pickCards.length; gi++) {
        var c = sc.pickCards[gi];
        if (c.y < prevBottom - 0.5) { geoOk = false; }
        if (c.x < 0 || c.y < 0 || c.x + c.w > BF.platform.width + 0.5) { geoOk = false; }
        if (c.y + c.h > sc.pickAll.y + 0.5) { geoOk = false; }
        prevBottom = c.y + c.h;
      }
      check(geoOk, '「' + pg.key + '」难度首屏档卡几何异常（重叠/出屏/压住入口）');

      // 各档起始关
      var firsts = sc.pickCards.map(function (cc, i) { return BF.DiffPick.tierRange(sc, i).first; });
      check(firsts.join(',') === pg.firsts.join(','),
        '「' + pg.key + '」各档起始关应为 ' + pg.firsts.join('/') + '，实际 ' + firsts.join('/'));

      // 每张档卡点下去都要能进「属于该档」的关
      var badTier = [];
      for (var ti = 0; ti < sc.pickCards.length; ti++) {
        BF.App.go(pg.scene, { pickDiff: true, game: pg.key });
        runFrames(2);
        var s2 = BF.App.scenes[pg.scene];
        var card2 = s2.pickCards[ti];
        s2.onDown(card2.x + card2.w / 2, card2.y + card2.h / 2);
        s2.onUp(card2.x + card2.w / 2, card2.y + card2.h / 2);
        runFrames(2);
        var s3 = BF.App.scenes[pg.scene];
        if (s3.pickDiff !== false) { badTier.push(ti + ':未离开首屏'); continue; }
        var lv = BF.DiffPick.tierLevels(s2, ti);
        if (lv.indexOf(s3.level) < 0) { badTier.push('档' + ti + '→L' + s3.level + ' 不在该档'); continue; }
        if (!s3.puzzle || !s3.puzzle[pg.probe]) { badTier.push('档' + ti + ' 题目未加载'); }
      }
      check(badTier.length === 0,
        '「' + pg.key + '」这些档卡点下去进错了关：' + badTier.join('; '));

      // 「查看全部关卡」与返回键
      BF.App.go(pg.scene, { pickDiff: true, game: pg.key });
      runFrames(2);
      var s4 = BF.App.scenes[pg.scene];
      s4.onDown(s4.pickAll.x + s4.pickAll.w / 2, s4.pickAll.y + s4.pickAll.h / 2);
      s4.onUp(s4.pickAll.x + s4.pickAll.w / 2, s4.pickAll.y + s4.pickAll.h / 2);
      runFrames(3);
      check(BF.App.current === BF.App.scenes.levels,
        '「' + pg.key + '」难度首屏的「查看全部关卡」应进入关卡页');
      BF.App.go(pg.scene, { pickDiff: true, game: pg.key });
      runFrames(2);
      tap(BF.App.scenes[pg.scene].back.x + 20, BF.App.scenes[pg.scene].back.y + 20);
      runFrames(3);
      check(BF.App.current === BF.App.scenes.home,
        '「' + pg.key + '」难度首屏返回键应回首页');
    }
  });

  /* ---- 9b-2. 拖不动反馈：所有关的警车都必须一开始就能拖（R7） ---- */
  var policeStuck = [];
  for (var lvN = 1; lvN <= BF.games.rush.TOTAL; lvN++) {
    BF.App.go('rush', { level: lvN, game: 'rush' });
    runFrames(2);
    var s4 = BF.App.scenes.rush;
    var rg0 = s4.legalRange(0);
    if (rg0.min === rg0.max) { policeStuck.push(lvN); }
  }
  check(policeStuck.length === 0,
    '这些关的警车一开始就拖不动（玩家会以为游戏坏了）：L' + policeStuck.join(',L'));

  /* ---- 9b-3. 盘内被夹的非警车：拖动要有"被卡住"的抖动 + 文案，不能毫无反应 ---- */
  var stuckScene = null, stuckIdx = -1;
  for (var lvN2 = 1; lvN2 <= BF.games.rush.TOTAL && !stuckScene; lvN2++) {
    BF.App.go('rush', { level: lvN2, game: 'rush' });
    runFrames(2);
    var s5 = BF.App.scenes.rush;
    var stk = BF.RushGen.stuckCars({ size: s5.size, exitRow: s5.exitRow, cars: s5.cars });
    var np = stk.filter(function (i) { return !s5.cars[i].police; });
    if (np.length) { stuckScene = s5; stuckIdx = np[0]; }
  }
  if (stuckScene) {
    var sc0 = stuckScene.cars[stuckIdx];
    var rcd = stuckScene.carRect(sc0);
    stuckScene.onDown(rcd.x + rcd.w / 2, rcd.y + rcd.h / 2);
    check(!!stuckScene.shake, '拖不动的车应触发抖动反馈（shake）');
    check(!stuckScene.drag, '拖不动的车不应进入拖动状态（否则拖动毫无反应）');
    check(!!stuckScene.toast, '拖不动的车应弹出文字说明');
    stuckScene.onUp(rcd.x + rcd.w / 2, rcd.y + rcd.h / 2);
    runFrames(2);
    check(stuckScene.steps === 0, '拖不动的车不该计入步数');
  } else {
    console.log('  ⚠ 20 关里没有"盘内被夹"的非警车，跳过拖不动反馈断言');
  }
})();

/* ---------- 9c. 超级积木（第 8 款）：真实拖拽通关 + 存档 ---------- */
(function () {
  if (!BF.games.blocks) { console.log('  ⚠ 未注册 blocks，跳过'); return; }
  var Gen = BF.BlocksGen;

  /** 把托盘里的积木真实拖到棋盘 (gx,gy)（tap/drag 判定需两次 move 才越阈值） */
  function dragPiece(sc, piece, gx, gy) {
    sc.update(16); sc.render(ctx);           // 刷新托盘命中区
    var ti = -1;
    for (var i = 0; i < sc.trayTokens.length; i++) {
      if (sc.trayTokens[i].piece === piece) { ti = i; break; }
    }
    if (ti < 0) { return false; }
    var bb = Gen.bbox(Gen.PIECE_ROT[piece.id][piece.rot]);
    // 抓取点用积木在托盘里的实际绘制中心（与场景抓取偏移一致，否则会偏半格被拒）
    var td = piece._tray || { x: sc.trayTokens[ti].x, y: sc.trayTokens[ti].y, cs: sc.cell };
    var tx = sc.boardX + (gx + bb.w / 2) * sc.cell;
    var ty = sc.boardY + (gy + bb.h / 2) * sc.cell;
    var sx = td.x + bb.w * td.cs / 2, sy = td.y + bb.h * td.cs / 2;
    sc.onDown(sx, sy);
    sc.onMove(sx + 1, sy + 1);
    sc.onMove(tx, ty);
    sc.onUp(tx, ty);
    return true;
  }

  /** 用标准解把一关拖到通关，返回是否成功 */
  function solveLevel(level) {
    BF.App.go('blocks', { level: level, game: 'blocks' });
    runFrames(2);
    var sc = BF.App.scenes.blocks;
    for (var i = 0; i < sc.pieces.length; i++) {
      var pc = sc.pieces[i], std = sc.stdById[pc.id];
      if (pc.placed) { continue; }
      if (!dragPiece(sc, pc, std.x, std.y)) { return null; }
      if (!pc.placed) { return null; }
    }
    return sc;
  }

  /* ---- 9c-1. 四档各拖一通关：L1 / L11 / L21 / L31，均应 3 星 + 存档 ---- */
  [1, 11, 21, 31].forEach(function (level) {
    var sc = solveLevel(level);
    check(!!sc, '超级积木 L' + level + ' 应能按标准解拖通关');
    if (!sc) { return; }
    check(!!sc.win, '超级积木 L' + level + ' 通关后应有结算弹窗');
    check(sc.win && sc.win.stars === 3,
      '超级积木 L' + level + ' 零提示零失误应 3 星，实际 ' + (sc.win && sc.win.stars));
    check(BF.Save.isCleared('blocks', level), '超级积木 L' + level + ' 通关后没写入存档');
    check(BF.Save.starsOf('blocks', level) === 3,
      '超级积木 L' + level + ' 存档星级应为 3');
  });

  /* ---- 9c-2. 结算弹窗「下一关」：L1 通关后点下一关应进 L2 ---- */
  BF.App.go('blocks', { level: 1, game: 'blocks' });
  runFrames(2);
  var sc2 = BF.App.scenes.blocks;
  for (var i2 = 0; i2 < sc2.pieces.length; i2++) {
    var pc2 = sc2.pieces[i2], std2 = sc2.stdById[pc2.id];
    if (!pc2.placed) { dragPiece(sc2, pc2, std2.x, std2.y); }
  }
  if (sc2.win) {
    var ob = sc2.overlayLayout();
    tap(ob.next.x + ob.next.w / 2, ob.next.y + ob.next.h / 2);
    runFrames(2);
    check(BF.App.scenes.blocks.level === 2,
      '超级积木 L1 结算后点「下一关」应进入第 2 关，实际 ' + BF.App.scenes.blocks.level);
  } else {
    check(false, '超级积木 L1 应能通关（供下一关按钮测试）');
  }

  /* ---- 9c-3. 限时挑战（L10）：超时应 timeout 且不写通关存档 ---- */
  BF.Save.resetAll ? BF.Save.resetAll() : null;
  BF.App.go('blocks', { level: 10, game: 'blocks' });
  runFrames(2);
  var sc3 = BF.App.scenes.blocks;
  check(sc3.timed, '超级积木第 10 关应是换档限时题');
  for (var f = 0; f < 120; f++) { sc3.update(1000); }   // 烧完 75s
  check(!!sc3.win && sc3.win.timeout === true, '超级积木限时超时应进入「时间到」结算');
  check(!BF.Save.isCleared('blocks', 10), '超级积木限时超时不该写通关存档');

  /* ---- 9c-4. 颜色约束：托盘积木必须全部来自本关指定颜色 ---- */
  BF.App.go('blocks', { level: 25, game: 'blocks' });
  runFrames(2);
  var sc4 = BF.App.scenes.blocks;
  var badColor = sc4.pieces.some(function (p) { return sc4.colors.indexOf(Gen.SHAPES[p.id].c) < 0; });
  check(!badColor, '超级积木托盘里出现了非指定颜色的积木');

  /* ---- 9c-5. 场景路由：关卡页总数应与 meta.TOTAL 一致 ---- */
  BF.App.go('levels', { game: 'blocks' });
  runFrames(2);
  check(BF.App.scenes.levels.total === BF.games.blocks.TOTAL,
    '超级积木关卡页总数应与 meta.TOTAL(40) 一致，实际 ' + BF.App.scenes.levels.total);

  /* ---- 9c-6. 每日挑战：可拖通关 + daily 存档 ---- */
  BF.App.go('blocks', { daily: true, game: 'blocks' });
  runFrames(2);
  var sc6 = BF.App.scenes.blocks;
  check(sc6.isDaily, '应能进入超级积木每日挑战');
  var dailyOk = true;
  for (var i6 = 0; i6 < sc6.pieces.length; i6++) {
    var pc6 = sc6.pieces[i6], std6 = sc6.stdById[pc6.id];
    if (!pc6.placed && !dragPiece(sc6, pc6, std6.x, std6.y)) { dailyOk = false; }
  }
  check(dailyOk && !!sc6.win, '超级积木每日挑战应能拖通关');
  check(BF.Save.isDailyDoneToday(), '超级积木每日挑战通关后应标记今日已完成');
})();

/* ---------- 9d. 九宫格数独（第 9 款）：真实点选填数通关 + 存档 ---------- */
(function () {
  if (!BF.games.sudoku) { console.log('  ⚠ 未注册 sudoku，跳过'); return; }

  /** 棋盘格 idx 中心 */
  function cellPt(sc, idx) {
    var c = sc.cell;
    return { x: sc.boardX + (idx % 9) * c + c / 2, y: sc.boardY + (((idx / 9) | 0)) * c + c / 2 };
  }
  /** 数字键盘 d 键中心 */
  function keyPt(sc, d) {
    var k = sc.keys[d - 1];
    return { x: k.x + k.w / 2, y: k.y + k.h / 2 };
  }
  function actPt(sc, key) {
    for (var i = 0; i < sc.actBtns.length; i++) {
      if (sc.actBtns[i].key === key) {
        return { x: sc.actBtns[i].x + sc.actBtns[i].w / 2, y: sc.actBtns[i].y + sc.actBtns[i].h / 2 };
      }
    }
    return null;
  }
  function fillCell(sc, idx, v) {
    var p = cellPt(sc, idx);
    tap(p.x, p.y);
    var k = keyPt(sc, v);
    tap(k.x, k.y);
  }
  /** 按标准解点选填数通关（跳过给定格与已填对的格） */
  function solveSudoku(level) {
    BF.App.go('sudoku', { level: level, game: 'sudoku' });
    runFrames(2);
    var sc = BF.App.scenes.sudoku;
    for (var i = 0; i < 81; i++) {
      if (sc.puzzle.given[i] || sc.entries[i] === sc.puzzle.solution[i]) { continue; }
      fillCell(sc, i, sc.puzzle.solution[i]);
    }
    return sc;
  }

  /* ---- 9d-1. 开局给定数必须铺进盘面（曾经漏了这步：整盘空白） ---- */
  BF.App.go('sudoku', { level: 1, game: 'sudoku' });
  runFrames(2);
  var sc0 = BF.App.scenes.sudoku;
  var givenShown = 0;
  for (var gi = 0; gi < 81; gi++) {
    if (sc0.puzzle.given[gi] && sc0.entries[gi] === sc0.puzzle.given[gi]) { givenShown++; }
  }
  check(givenShown === 81 - sc0.puzzle.blanks,
    '开局给定数应全部铺进盘面，实际 ' + givenShown + '/' + (81 - sc0.puzzle.blanks));

  /* ---- 9d-2. 四档各真实点选通关一关：均应通关 + 存档 ---- */
  [1, 11, 21, 31].forEach(function (level) {
    var sc = solveSudoku(level);
    check(!!sc.win, '数独 L' + level + ' 应能按标准解点选通关');
    check(sc.win && sc.win.stars >= 1 && sc.win.stars <= 3,
      '数独 L' + level + ' 星级应在 1~3，实际 ' + (sc.win && sc.win.stars));
    check(BF.Save.isCleared('sudoku', level), '数独 L' + level + ' 通关后没写入存档');
  });

  /* ---- 9d-3. 宽松校验：填错不提示；「检查」才标红；改对即通关 ---- */
  BF.App.go('sudoku', { level: 2, game: 'sudoku' });
  runFrames(2);
  var sc2 = BF.App.scenes.sudoku;
  var wrongIdx = -1, wrongVal = 0;
  for (var wi = 0; wi < 81; wi++) {
    if (!sc2.puzzle.given[wi]) {
      wrongIdx = wi;
      wrongVal = sc2.puzzle.solution[wi] === 9 ? 8 : sc2.puzzle.solution[wi] + 1;
      break;
    }
  }
  fillCell(sc2, wrongIdx, wrongVal);
  check(!sc2.win && !sc2.wrongFlash, '宽松模式：填错不应立即通关或标红');
  // 没填满就检查 → 只提示剩余格数
  var chk = actPt(sc2, 'check');
  tap(chk.x, chk.y);
  check(!sc2.wrongFlash && !!sc2.toast && /还有 \d+ 格没填/.test(sc2.toast.text),
    '没填满时点检查应提示剩余格数');
  // 填满（留错格）→ 检查 → 标红
  for (var fj = 0; fj < 81; fj++) {
    if (sc2.puzzle.given[fj] || fj === wrongIdx || sc2.entries[fj] === sc2.puzzle.solution[fj]) { continue; }
    fillCell(sc2, fj, sc2.puzzle.solution[fj]);
  }
  check(!sc2.win, '填满但有错不应自动通关');
  tap(chk.x, chk.y);
  check(!sc2.win && !!sc2.wrongFlash && sc2.wrongFlash.cells.length === 1,
    '检查应只把填错的那一格标红');
  fillCell(sc2, wrongIdx, sc2.puzzle.solution[wrongIdx]);
  check(!!sc2.win, '改对后应通关');

  /* ---- 9d-4. 铅笔 / 撤销 / 提示 / 重置 ---- */
  BF.App.go('sudoku', { level: 3, game: 'sudoku' });
  runFrames(2);
  var sc3 = BF.App.scenes.sudoku;
  var pIdx = -1;
  for (var pi = 0; pi < 81; pi++) { if (!sc3.puzzle.given[pi]) { pIdx = pi; break; } }
  var pen = actPt(sc3, 'pencil');
  tap(pen.x, pen.y);
  check(sc3.pencilMode, '点铅笔应进入铅笔模式');
  fillCell(sc3, pIdx, 3);
  check((sc3.pencil[pIdx] & (1 << 2)) && !sc3.entries[pIdx], '铅笔模式应只写候选数');
  fillCell(sc3, pIdx, 3);
  check(!(sc3.pencil[pIdx] & (1 << 2)), '再点同一数字应擦掉候选');
  tap(pen.x, pen.y);
  fillCell(sc3, pIdx, 4);
  check(sc3.entries[pIdx] === 4 && sc3.pencil[pIdx] === 0, '填正式数应清掉候选');
  var undo = actPt(sc3, 'undo');
  tap(undo.x, undo.y);
  check(sc3.entries[pIdx] === 0, '撤销应恢复填写前状态');
  var hint = actPt(sc3, 'hint');
  tap(hint.x, hint.y);
  check(sc3.hintsLeft === 2, '提示应剩 2 次');
  check(sc3.entries[pIdx] === sc3.puzzle.solution[pIdx], '提示应填正确数');
  var rs = actPt(sc3, 'reset');
  tap(rs.x, rs.y);
  var backToGiven = true;
  for (var ri = 0; ri < 81; ri++) {
    if (sc3.entries[ri] !== sc3.puzzle.given[ri]) { backToGiven = false; }
  }
  check(backToGiven, '重置后应恢复成给定数');

  /* ---- 9d-5. 结算弹窗「下一关」 ---- */
  var sc5 = solveSudoku(4);
  if (sc5.win) {
    var ob5 = sc5.overlayLayout();
    tap(ob5.next.x + ob5.next.w / 2, ob5.next.y + ob5.next.h / 2);
    runFrames(2);
    check(BF.App.scenes.sudoku.level === 5,
      '数独 L4 结算后点「下一关」应进入第 5 关，实际 ' + BF.App.scenes.sudoku.level);
  } else {
    check(false, '数独 L4 应能通关（供下一关按钮测试）');
  }

  /* ---- 9d-6. 每日挑战：可通关 + daily 存档 ---- */
  BF.App.go('sudoku', { daily: true, game: 'sudoku' });
  runFrames(2);
  var sc6 = BF.App.scenes.sudoku;
  check(sc6.isDaily, '应能进入数独每日挑战');
  for (var di = 0; di < 81; di++) {
    if (sc6.puzzle.given[di] || sc6.entries[di] === sc6.puzzle.solution[di]) { continue; }
    fillCell(sc6, di, sc6.puzzle.solution[di]);
  }
  check(!!sc6.win, '数独每日挑战应能通关');
})();

/* ---------- 9e. 扫雷（第 11 款）：真实翻格通关 + 免猜 + 失败 + 标记 + 提示 + 续玩 + 每日 ---------- */
(function () {
  if (!BF.games.mine) { console.log('  ⚠ 未注册 mine，跳过'); return; }

  function cellCenter(sc, idx) {
    var c = sc.cell;
    return { x: sc.boardX + (idx % sc.n) * c + c / 2, y: sc.boardY + (((idx / sc.n) | 0)) * c + c / 2 };
  }
  function actCenter(sc, key) {
    for (var i = 0; i < sc.actBtns.length; i++) {
      if (sc.actBtns[i].key === key) {
        return { x: sc.actBtns[i].x + sc.actBtns[i].w / 2, y: sc.actBtns[i].y + sc.actBtns[i].h / 2 };
      }
    }
    return null;
  }
  /** 凭纯逻辑推理（findForced）把全盘解开：插旗必然雷 + 翻必然安全格，直到通关 */
  function solveMine(sc) {
    var guard = 0;
    while (!sc.win && guard++ < sc.N * sc.N + 50) {
      var f = sc.findForced();
      if (!f) { break; }
      if (f.type === 'mine') { sc.flagAt(f.cell); } else { sc.revealAt(f.cell); }
    }
  }
  function centerIdx(sc) { return ((sc.n / 2) | 0) * sc.n + ((sc.n / 2) | 0); }

  /* ---- 9e-1. 首点必安全 + 免猜可解：四档各真实翻格通关 + 存档 ---- */
  [1, 11, 21, 31].forEach(function (level) {
    BF.App.go('mine', { level: level, game: 'mine' });
    runFrames(2);
    var sc = BF.App.scenes.mine;
    var cc = cellCenter(sc, centerIdx(sc));
    tap(cc.x, cc.y);
    runFrames(3);
    check(sc.started, '扫雷 L' + level + ' 首点应生成棋盘');
    check(sc.firstClick >= 0 && !sc.mines[sc.firstClick], '扫雷 L' + level + ' 首点必安全（不应是雷）');
    solveMine(sc);
    check(!!sc.win, '扫雷 L' + level + ' 凭纯逻辑推理应能通关（免猜）');
    check(sc.win && sc.win.stars >= 1 && sc.win.stars <= 3, '扫雷 L' + level + ' 星级应在 1~3');
    check(BF.Save.isCleared('mine', level), '扫雷 L' + level + ' 通关后没写入存档');
  });

  /* ---- 9e-2. 踩雷即失败（不写通关存档）+ 重玩回到可玩态 ---- */
  BF.App.go('mine', { level: 2, game: 'mine' });
  runFrames(2);
  var sc2 = BF.App.scenes.mine;
  var cc2 = cellCenter(sc2, centerIdx(sc2));
  tap(cc2.x, cc2.y); runFrames(3);
  var boom = -1;
  for (var zi = 0; zi < sc2.N; zi++) { if (sc2.mines[zi]) { boom = zi; break; } }
  sc2.revealAt(boom);
  check(sc2.gameOver, '翻到雷应触发失败');
  check(!BF.Save.isCleared('mine', 2), '失败不应写通关存档');
  var ob2 = sc2.overlayLayout();
  tap(ob2.again.x + ob2.again.w / 2, ob2.again.y + ob2.again.h / 2);
  runFrames(3);
  check(!BF.App.scenes.mine.win && !BF.App.scenes.mine.gameOver, '扫雷「重玩」应回到可玩态');

  /* ---- 9e-3. 标记模式插旗 + 提示消耗次数 ---- */
  BF.App.go('mine', { level: 3, game: 'mine' });
  runFrames(2);
  var sc3 = BF.App.scenes.mine;
  var mb = actCenter(sc3, 'mark');
  tap(mb.x, mb.y); runFrames(2);
  check(sc3.markMode, '点标记应进入标记模式');
  var cc3 = cellCenter(sc3, 0);
  tap(cc3.x, cc3.y); runFrames(2);
  check(sc3.flagged[0], '标记模式下点格应插旗');
  var hintsBefore = sc3.hintsLeft;
  var hb = actCenter(sc3, 'hint');
  tap(hb.x, hb.y); runFrames(3);   // 首点生成 + 推一格
  check(sc3.hintsLeft === hintsBefore - 1, '提示应消耗一次');

  /* ---- 9e-4. 难度自选首屏 + 档位起始关 ---- */
  BF.App.go('mine', { pickDiff: true, game: 'mine' });
  runFrames(3);
  var pk = BF.App.scenes.mine;
  check(pk.pickDiff === true, '首页点扫雷应进入难度自选首屏');
  check(pk.pickCards && pk.pickCards.length === 4, '难度首屏应有 4 张档卡');
  var firsts = pk.pickCards.map(function (cc, i) { return BF.DiffPick.tierRange(pk, i).first; });
  check(JSON.stringify(firsts) === '[1,11,21,31]', '扫雷档位起始关应为[1,11,21,31]，实际 ' + JSON.stringify(firsts));
  // 档卡 → 进该档「第一个未通关」的关（全通则末关）。9e-1 已清 L1，故入门档 next=2
  var exp0 = BF.DiffPick.tierProgress(pk, 0).next;
  var exp3 = BF.DiffPick.tierProgress(pk, 3).next;
  tap(pk.pickCards[0].x + pk.pickCards[0].w / 2, pk.pickCards[0].y + pk.pickCards[0].h / 2);
  runFrames(3);
  check(BF.App.scenes.mine.level === exp0 && !BF.App.scenes.mine.pickDiff,
    '点扫雷入门档应进该档第一个未通关关(' + exp0 + ')，实际 level=' + BF.App.scenes.mine.level);
  // 专家档 → 进该档第一个未通关关
  BF.App.go('mine', { pickDiff: true, game: 'mine' });
  runFrames(3);
  var pk3 = BF.App.scenes.mine;
  tap(pk3.pickCards[3].x + pk3.pickCards[3].w / 2, pk3.pickCards[3].y + pk3.pickCards[3].h / 2);
  runFrames(3);
  check(BF.App.scenes.mine.level === exp3 && !BF.App.scenes.mine.pickDiff,
    '点扫雷专家档应进该档第一个未通关关(' + exp3 + ')，实际 level=' + BF.App.scenes.mine.level);

  /* ---- 9e-5. 断点续玩：翻几格退出再进同一关，应恢复已翻开的格 ---- */
  BF.App.go('mine', { level: 5, game: 'mine' });
  runFrames(2);
  var scR = BF.App.scenes.mine;
  tap(cellCenter(scR, centerIdx(scR)).x, cellCenter(scR, centerIdx(scR)).y);
  runFrames(3);
  scR.doHint(); scR.doHint(); runFrames(4);   // 推两格（不求解完）
  var revBefore = 0;
  for (var rb = 0; rb < scR.N; rb++) { if (scR.revealed[rb]) { revBefore++; } }
  BF.App.go('mine', { level: 5, game: 'mine' });
  runFrames(3);
  var scR2 = BF.App.scenes.mine;
  var revAfter = 0;
  for (var ra = 0; ra < scR2.N; ra++) { if (scR2.revealed[ra]) { revAfter++; } }
  check(scR2.started && revAfter >= revBefore, '扫雷续玩应恢复已翻开的格（' + revBefore + '→' + revAfter + '）');

  /* ---- 9e-6. 每日挑战：可通关 + daily 存档 ---- */
  BF.App.go('mine', { daily: true, game: 'mine' });
  runFrames(2);
  var scD = BF.App.scenes.mine;
  check(scD.isDaily, '应能进入扫雷每日挑战');
  tap(cellCenter(scD, centerIdx(scD)).x, cellCenter(scD, centerIdx(scD)).y);
  runFrames(3);
  solveMine(scD);
  check(!!scD.win, '扫雷每日挑战应能通关');
  check(BF.Save.isDailyDoneToday(), '扫雷每日挑战通关后应标记今日已完成');
})();

/* ---------- 9f. 数织（第 12 款）：真实点填通关 + 填错标红 + 提示 + 续玩 + 首屏 + 每日 ---------- */
(function () {
  if (!BF.games.picross) { console.log('  ⚠ 未注册 picross，跳过'); return; }
  var Gen = BF.PicrossGen;

  function cellCenter(sc, idx) {
    return {
      x: sc.gridX + (idx % sc.n) * sc.cell + sc.cell / 2,
      y: sc.gridY + (((idx / sc.n) | 0)) * sc.cell + sc.cell / 2
    };
  }
  /** 选色后真实点一格。
   *  ⚠️ 选色必须走**真实调色板点击**：直接写 `sc.sel = color` 会绕过命中测试，
   *     `if (sw)` 吞掉 0 号色（红）那种 bug 就永远测不出来（交互层因此加了这个断言）。 */
  function fillCell(sc, idx, color) {
    var items = sc.palItems(), p = null, i;
    for (i = 0; i < items.length; i++) {
      if (items[i].sel === color) { p = { x: items[i].x + 16, y: sc.palY + 16 }; break; }
    }
    if (p) { tap(p.x, p.y); }
    var c = cellCenter(sc, idx);
    tap(c.x, c.y);
  }
  /** 按解把全盘填对（空格不填 —— 数织的"空"也是解的一部分） */
  function solvePicross(sc) {
    for (var i = 0; i < sc.cells.length; i++) {
      if (sc.cells[i] >= 0) { fillCell(sc, i, sc.cells[i]); }
    }
  }

  /* ---- 9f-1. 四档各真实点填通关 + 存档 + 星级 ---- */
  [1, 11, 21, 31].forEach(function (level) {
    BF.App.go('picross', { level: level, game: 'picross' });
    runFrames(2);
    var sc = BF.App.scenes.picross;
    check(sc.n === Gen.TIER_SIZE[((level - 1) / 10) | 0],
      '数织 L' + level + ' 棋盘边长应为 ' + Gen.TIER_SIZE[((level - 1) / 10) | 0] + '，实际 ' + sc.n);
    check(!sc.started, '数织 L' + level + ' 开局不应已经开始计时');
    check(sc.st.every(function (v) { return v === -1; }), '数织 L' + level + ' 开局盘面应为全未知');
    check(sc.colors.length >= 1, '数织 L' + level + ' 应至少 1 种颜色');
    solvePicross(sc);
    runFrames(2);
    check(!!sc.win, '数织 L' + level + ' 按解填满应通关');
    check(sc.win && sc.win.stars >= 1 && sc.win.stars <= 3, '数织 L' + level + ' 星级应在 1~3');
    check(BF.Save.isCleared('picross', level), '数织 L' + level + ' 通关后没写入存档');
  });

  /* ---- 9f-1b. 调色板选色：0 号色（红）必须能选上 ----
   * ⚠️ 回归护栏：`palItemAt` 返回的是颜色序号，`if (sw)` 会把 0（红）当成 falsy 吞掉 →
   *    「选红色」静默失效（而红是很多图案的主色）。只有真点调色板才抓得到，
   *    直接写 `sc.sel = color` 会整个绕过命中测试（上面 9f-1 的四档解就漏过这个 bug）。
   *    另外：9f-1 用的 1/11/21/31 四关恰好都不含 0 号色（除单色的 L1），所以必须单开这一节。 */
  BF.App.go('picross', { level: 3, game: 'picross' });   // 苹果：红/绿/棕
  runFrames(2);
  var scSel = BF.App.scenes.picross;
  check(scSel.colors.indexOf(0) >= 0, '第 3 关应含 0 号色（红）');
  scSel.colors.concat([-1, -2]).forEach(function (c) {
    var it = null, items = scSel.palItems();
    for (var i = 0; i < items.length; i++) { if (items[i].sel === c) { it = items[i]; break; } }
    check(!!it, '调色板应含工具 ' + c);
    if (!it) { return; }
    tap(it.x + 16, scSel.palY + 16);
    check(scSel.sel === c, '点调色板应选中 ' + c + '，实际 sel=' + scSel.sel);
  });

  /* ---- 9f-2. 填错立刻判错（可改）；擦掉就不红 ---- */
  BF.App.go('picross', { level: 1, game: 'picross' });
  runFrames(2);
  var sc2 = BF.App.scenes.picross;
  var emptyIdx = -1;
  for (var i = 0; i < sc2.cells.length; i++) { if (sc2.cells[i] < 0) { emptyIdx = i; break; } }
  check(emptyIdx >= 0, '第 1 关应存在空格位（否则测不了填错）');
  fillCell(sc2, emptyIdx, sc2.colors[0]);
  runFrames(2);
  check(sc2.errorCount() === 1, '往空格里填色应计入 1 次失误，实际 ' + sc2.errorCount());
  check(sc2.isWrong(emptyIdx), '填错的格应被判定为错（渲染标红）');
  check(!sc2.win, '有填错时不应通关');
  // 橡皮擦掉 → 恢复
  sc2.sel = -1;
  var p2 = cellCenter(sc2, emptyIdx);
  tap(p2.x, p2.y);
  runFrames(2);
  check(sc2.errorCount() === 0, '擦掉错误填色后失误应清零，实际 ' + sc2.errorCount());
  check(!sc2.isWrong(emptyIdx), '擦掉后该格不应再判错');

  /* ---- 9f-3. 提示：消耗 1 次且填的格一定对 ---- */
  BF.App.go('picross', { level: 3, game: 'picross' });
  runFrames(2);
  var sc3 = BF.App.scenes.picross;
  var h0 = sc3.hintsLeft;
  var hb = sc3.hintBtn;
  tap(hb.x + hb.w / 2, hb.y + hb.h / 2, 3);
  check(sc3.hintsLeft === h0 - 1, '提示应消耗一次，实际 ' + sc3.hintsLeft + '/' + h0);
  var okCells = 0;
  for (var j = 0; j < sc3.cells.length; j++) {
    if (sc3.st[j] >= 0 && sc3.st[j] === sc3.cells[j]) { okCells++; }
  }
  check(okCells === 1, '提示应恰好填 1 个正确的格，实际 ' + okCells);
  check(sc3.errorCount() === 0, '提示不应留下错误填色');

  /* ---- 9f-4. 难度自选首屏 + 档位起始关 + 点档卡进该档 ---- */
  BF.App.go('picross', { pickDiff: true, game: 'picross' });
  runFrames(3);
  var pk = BF.App.scenes.picross;
  check(pk.pickDiff === true, '首页点数织应进入难度自选首屏');
  check(pk.pickCards && pk.pickCards.length === 4, '难度首屏应有 4 张档卡');
  var firsts = pk.pickCards.map(function (cc, i) { return BF.DiffPick.tierRange(pk, i).first; });
  check(JSON.stringify(firsts) === '[1,11,21,31]',
    '数织档位起始关应为[1,11,21,31]，实际 ' + JSON.stringify(firsts));
  var p3 = pk.pickCards[2];
  tap(p3.x + p3.w / 2, p3.y + p3.h / 2, 3);
  var after = BF.App.scenes.picross;
  check(!after.pickDiff && after.level >= 21 && after.level <= 30,
    '点第 3 档应进困难档（21~30 关），实际 level=' + after.level);

  /* ---- 9f-5. 断点续玩：填几格后离开再回来，盘面应恢复 ---- */
  BF.App.go('picross', { level: 5, game: 'picross' });
  runFrames(2);
  var sc5 = BF.App.scenes.picross;
  var filled = 0;
  for (var k = 0; k < sc5.cells.length && filled < 4; k++) {
    if (sc5.cells[k] >= 0) { fillCell(sc5, k, sc5.cells[k]); filled++; }
  }
  runFrames(2);
  var before = sc5.st.slice();
  check(sc5.started, '填过格后应开始计时');
  BF.App.go('home');
  runFrames(2);
  BF.App.go('picross', { level: 5, game: 'picross' });
  runFrames(2);
  var sc5b = BF.App.scenes.picross;
  check(JSON.stringify(sc5b.st) === JSON.stringify(before),
    '数织 L5 离开再回来应恢复上次盘面');
  check(sc5b.elapsed > 0, '数织 L5 恢复后应继续计时（不清零）');

  /* ---- 9f-6. 每日挑战：可通关 ---- */
  BF.App.go('picross', { daily: true, game: 'picross' });
  runFrames(2);
  var scD = BF.App.scenes.picross;
  check(scD.isDaily, '应能进入数织每日挑战');
  check(scD.n === Gen.TIER_SIZE[Gen.DAILY_TIER],
    '数织每日挑战应为困难档 ' + Gen.TIER_SIZE[Gen.DAILY_TIER] + '×' + Gen.TIER_SIZE[Gen.DAILY_TIER] +
    '，实际 ' + scD.n + '×' + scD.n);
  solvePicross(scD);
  check(!!scD.win, '数织每日挑战应能通关');
  check(BF.Save.isDailyDoneToday(), '数织每日挑战通关后应标记今日已完成');
})();

/* ---- 9g. 「玩法说明」弹框（BF.RuleTip，11 款共用） ----
   注意：smoke 开头把 BF.RuleTip.on 设成了 false（否则 enter 后输入全被拦，老用例全挂），
   这一节临时打开，专门覆盖弹框自身的行为。 */
(function () {
  BF.RuleTip.on = true;

  /* 9g-1. 11 款游戏都应配 rules（否则弹框内容为空） */
  Object.keys(BF.games).forEach(function (id) {
    var r = BF.games[id].rules;
    check(!!r && r.lines.length >= 3 && !!r.sub, id + ' 应配 rules（sub + 至少 3 条）');
    if (id === 'picross') {
      check(!!r.demo && r.demo.grid && r.demo.grid.length === 5,
        '数织 rules 应配 5×5 demo（动画演示）');
    }
  });
  // 只有数织带演示块，其它游戏首进弹框不应出现 ruleDemo（卡片几何不变）
  BF.App.go('mine', { level: 1, game: 'mine' });
  runFrames(2);
  check(!BF.App.scenes.mine.ruleDemo, '扫雷首进弹框不应有演示块');
  BF.App.go('picross', { level: 1, game: 'picross' });
  runFrames(2);
  check(!!BF.App.scenes.picross.ruleDemo, '数织首进弹框应带演示块 ruleDemo');

  /* 9g-2. 首进弹框 + 遮罩不可点 + 「开始游戏」才关 */
  BF.Save.resetAll();
  BF.App.go('mine', { level: 1, game: 'mine' });
  runFrames(2);
  var rm = BF.App.scenes.mine;
  check(!!rm.showRule, '扫雷首进应弹规则说明');
  check(rm.ruleCard && rm.ruleCard.w === Math.min(BF.platform.width - 56, 320),
    '弹框宽应为 min(屏宽-56,320)');
  tap(6, 6, 3);                       // 点遮罩
  check(!!rm.showRule, '点遮罩不应关闭规则弹框');
  var okBtn = rm.ruleOk;
  tap(okBtn.x + okBtn.w / 2, okBtn.y + okBtn.h / 2, 3);
  check(!rm.showRule, '点「开始游戏」应关闭弹框');
  check(!BF.Save.extraOf('mine').noRule, '没勾「不再提示」不应写存档');

  /* 9g-3. 勾选「不再提示」→ 写存档 → 再进不弹 */
  BF.App.go('mine', { level: 1, game: 'mine' });
  runFrames(2);
  var rm2 = BF.App.scenes.mine;
  check(!!rm2.showRule, '没勾过就再进应继续弹');
  var cb = rm2.ruleCheck;
  tap(cb.x + cb.w / 2, cb.y + cb.h / 2, 3);
  check(rm2.ruleNoTip === true, '点复选框应勾选「不再提示」');
  tap(rm2.ruleOk.x + rm2.ruleOk.w / 2, rm2.ruleOk.y + rm2.ruleOk.h / 2, 3);
  check(!rm2.showRule, '勾选后点开始游戏应关闭');
  check(BF.Save.extraOf('mine').noRule === 1, '应写入 noRule=1');
  BF.App.go('mine', { level: 2, game: 'mine' });
  runFrames(2);
  check(!BF.App.scenes.mine.showRule, '勾过「不再提示」后再进不应弹');

  /* 9g-4. header「?」可强制重看（不再提示后也有入口） */
  var qb = BF.RuleTip.btn(BF.App.scenes.mine);
  tap(qb.x + qb.w / 2, qb.y + qb.h / 2, 3);
  check(!!BF.App.scenes.mine.showRule, '点「?」应强制重开规则弹框');
  tap(BF.App.scenes.mine.ruleOk.x + BF.App.scenes.mine.ruleOk.w / 2,
      BF.App.scenes.mine.ruleOk.y + BF.App.scenes.mine.ruleOk.h / 2, 3);
  check(!BF.App.scenes.mine.showRule, '重开后点开始游戏应关闭');

  /* 9g-5. 关内「下一关」不重复弹；重新进这款游戏才弹 */
  BF.Save.resetAll();
  BF.App.go('picross', { level: 1, game: 'picross' });
  runFrames(2);
  var rp = BF.App.scenes.picross;
  check(!!rp.showRule, '数织首进应弹规则');
  tap(rp.ruleOk.x + rp.ruleOk.w / 2, rp.ruleOk.y + rp.ruleOk.h / 2, 3);
  rp.next();
  runFrames(2);
  check(!BF.App.scenes.picross.showRule, '关内进下一关不应重复弹规则');
  check(BF.App.scenes.picross.level === 2, '下一关应到第 2 关');
  BF.App.go('picross', { level: 5, game: 'picross' });
  runFrames(2);
  check(!!BF.App.scenes.picross.showRule, '重新进这款游戏应再弹');

  /* 9g-6. 弹框期间限时倒计时不被扣（超级积木第 10 关） */
  BF.Save.resetAll();
  BF.App.go('blocks', { level: 10, game: 'blocks' });
  runFrames(2);
  var rb = BF.App.scenes.blocks;
  check(!!rb.showRule, '积木第 10 关应弹规则');
  var tl0 = rb.timeLeft;
  runFrames(30);
  check(rb.timeLeft === tl0, '弹框期间限时倒计时不应减少');
  tap(rb.ruleOk.x + rb.ruleOk.w / 2, rb.ruleOk.y + rb.ruleOk.h / 2, 3);
  runFrames(30);
  check(rb.timeLeft < tl0, '关闭后限时倒计时应正常走');

  BF.RuleTip.on = false;      // 还原，避免影响后面的用例
  console.log('   规则弹框已验证：11 款 rules 齐全 / 首进弹框 / 遮罩不可点 / 开始游戏才关 / ' +
    '勾选不再提示后不弹 / 「?」强制重看 / 下一关不重复弹 / 弹框期间限时不倒扣');
})();

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
  console.log('   过关弹窗按钮：重玩 / 下一关 / 最后一关返回关卡 / 每日挑战返回首页 —— 各款游戏均已点通');
  console.log('   canvas 状态栈平衡：' + ctxMaxDepth + ' 层峰值，结束回到 0（无 save/restore 泄漏）');
  console.log('   已自动通关：方块拼图 第 1/2/20/40/60 关 + 每日挑战；逻辑拼图 第 1/2 关；照片拼图 第 1/2 关；图片找不同 第 1/2 关；密码推理 第 1 关(拼行→提交→反馈→破译)；移车出库 第 1/8/14/20 关 + 每日挑战(真实拖拽出库·3星)');
  console.log('   照片拼图已验证：按答案可过关 / 摆错位置(填满)不过关 / 切片用 drawImage 原图渲染 / 存档隔离');
  console.log('   照片拼图新交互：难度快捷条(6×6→第31关) / 提示图默认显示·轻触切换·5秒自动收起');
  console.log('   图片找不同已验证：点中差异 / 点错计失误 / 同处不重复计数 / 提示跳过已找到 / 重来 / 3星结算 / 场景路由 / 存档隔离');
  console.log('   密码推理已验证：调色板拼行 / 提交产出反馈 / 未填满拒绝 / 拼对破译成功 / 下一关 / 场景路由 / 存档隔离');
  console.log('   超级积木已验证：四档各真实拖拽通关(3星) / 落子合法性(压暗格·越界·重叠全拒) / 旋转·重置·提示限1次 / 下一关按钮 / 换档限时题超时timeout不写存档 / 颜色约束 / 每日挑战通关');
  console.log('   九宫格数独已验证：四档各真实点选通关+存档 / 开局给定数铺进盘面 / 宽松校验(填错不提示·检查才标红·改对即通关) / 铅笔候选·撤销·提示3次·重置 / 下一关按钮 / 每日挑战通关');
  console.log('   数织已验证：四档各真实点填通关+存档 / 填错立刻判错且可擦除 / 提示消耗1次且必填对 / 难度首屏4档 / 断点续玩恢复盘面 / 每日挑战通关');
}
