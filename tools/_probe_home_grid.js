/**
 * _probe_home_grid.js —— 首页「三大类 + 两列网格 + chip 过滤」分层验证
 * 用与 smoke 同口径的假 canvas 跑 home 场景：
 *   - 全部模式：17 卡 / 3 组标题 / 不出屏 / 不重叠 / 渲染不抛异常
 *   - 过滤模式：烧脑 11 / 巧手 5 / 眼力 1，且各卡不出屏
 *   - chip 命中：点 chip 能切换 activeChip 并重建布局
 * 仅做逻辑+几何核验（透明/像素问题靠 Edge 真 canvas 截图另外验证）。
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
var W = parseInt(process.argv[2], 10) || 390;
var H = parseInt(process.argv[3], 10) || 844;

var ctxDepth = 0;
function fakeCtx() {
  var grad = { addColorStop: function () {} };
  var target = {
    save: function () { ctxDepth++; },
    restore: function () { ctxDepth--; if (ctxDepth < 0) { ctxDepth = 0; } },
    scale: function () {}, setTransform: function () {}, transform: function () {}, translate: function () {}, rotate: function () {},
    fillRect: function () {}, clearRect: function () {}, strokeRect: function () {},
    beginPath: function () {}, closePath: function () {}, moveTo: function () {}, lineTo: function () {},
    arc: function () {}, arcTo: function () {}, rect: function () {}, clip: function () {},
    quadraticCurveTo: function () {}, bezierCurveTo: function () {},
    fill: function () {}, stroke: function () {}, setLineDash: function () {}, drawImage: function () {},
    createLinearGradient: function () { return grad; }, createRadialGradient: function () { return grad; },
    measureText: function (t) { return { width: String(t).length * 7 }; },
    fillText: function () {}, strokeText: function () {}
  };
  return new Proxy(target, { get: function (t, k) { return t[k]; }, set: function (t, k, v) { t[k] = v; return true; } });
}
var frames = [];
var input = { down: null, move: null, up: null };
var store = {};
var sandbox = {
  console: console, Math: Math, Date: Date, JSON: JSON, Object: Object, Array: Array,
  String: String, Number: Number, Boolean: Boolean, Error: Error,
  setTimeout: setTimeout, parseInt: parseInt, isNaN: isNaN, Proxy: Proxy
};
sandbox.globalThis = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox);
function load(rel) { vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel }); }

load('js/core/ns.js');
load('js/core/palette.js');
load('js/core/draw.js');
var BF = sandbox.BF;
var ctx = fakeCtx();
BF.platform = {
  isMiniGame: false, ready: true, canvas: { width: W, height: H }, ctx: ctx,
  width: W, height: H, dpr: 2, safeTop: 0, safeBottom: 0,
  now: function () { return Date.now(); },
  requestFrame: function (cb) { frames.push(cb); },
  getStorage: function (k, d) { return store[k] === undefined ? d : store[k]; },
  setStorage: function (k, v) { store[k] = v; },
  vibrate: function () {},
  bindPointer: function (h) { input.down = h.down; input.move = h.move; input.up = h.up; },
  createImage: function (src, cb) { var img = { src: src, width: 720, height: 720, __fake: true }; if (cb) { cb(null, img); } return img; },
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
load('js/scenes/diffpick.js');
load('js/scenes/ruletip.js');
load('js/scenes/play.js');
load('js/scenes/diff.js');
load('js/game/bottle.js'); load('js/scenes/bottle.js');
load('js/game/cipher.js'); load('js/scenes/cipher.js');
load('js/game/rush.js'); load('js/scenes/rush.js');
load('js/game/blocks.js'); load('js/scenes/blocks.js');
load('js/game/sudoku.js'); load('js/game/mine.js');
load('js/scenes/sudoku.js'); load('js/scenes/mine.js');
load('js/game/picross.js'); load('js/scenes/picross.js');
load('js/game/pk24.js'); load('js/scenes/pk24.js');
load('js/game/cat.js'); load('js/scenes/cat.js');
load('js/game/redball.js'); load('js/scenes/redball.js');
load('js/game/tadpole.js'); load('js/scenes/tadpole.js');
load('js/game/recall.js'); load('js/scenes/recall.js');
load('js/app.js');
BF.RuleTip.on = true;

var errors = [];
function frame() {
  var c = BF.App.current;
  try { if (c && c.update) { c.update(16); } if (c && c.render) { c.render(ctx); } }
  catch (e) { errors.push('render 异常: ' + e.message + '\n' + e.stack.split('\n').slice(0, 4).join('\n')); return false; }
  return true;
}
function runFrames(n) { for (var i = 0; i < (n || 1); i++) { if (!frame()) { return false; } } return true; }
function tap(x, y) { try { input.down(x, y); runFrames(1); input.up(x, y); runFrames(1); return true; } catch (e) { errors.push('tap(' + x + ',' + y + '): ' + e.message); return false; } }
function onScreen(r) { return r && r.x >= -1 && r.y >= -1 && r.x + r.w <= W + 1 && r.y + r.h <= H + 1; }
// 首页是可滚动列表：底部卡片落在折叠线下方属正常（滚动可达）。
// 正确布局的判定改为「在内容区内、左右不出界、顶部不低于列表起点」。
function inContent(r, home) {
  return r && r.x >= -1 && r.x + r.w <= W + 1
    && r.y >= home.listTop - 1 && r.y + r.h <= home.listTop + home.contentH + 1;
}
function overlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

var report = [];
var allOk = true;
function check(name, cond, extra) {
  report.push((cond ? '✓ ' : '✗ ') + name + (extra ? '  (' + extra + ')' : ''));
  if (!cond) { allOk = false; }
}

// 进入首页（先 go 到一个会渲染的 app 实例）
BF.App.go('home');
var home = BF.App.current;
if (!home || home.constructor.name !== 'SceneHome') {
  check('首页场景已加载', false, 'current=' + (home && home.constructor.name));
} else {
  // 全部模式
  home.activeChip = 'all';
  home.layout();
  runFrames(2);
  check('全部模式: 渲染无异常', errors.length === 0, errors.join(' | '));
  errors.length = 0;
  check('全部模式: 卡片数=17', home.cards2.length === 17, '实际 ' + home.cards2.length);
  check('全部模式: 分组标题=3', home.headers.length === 3, '实际 ' + home.headers.length);
  var allOn = home.cards2.every(function (r) { return inContent(r, home); });
  check('全部模式: 所有卡片在内容区内(可滚动)', allOn);
  var ov = false;
  for (var i = 0; i < home.cards2.length; i++) {
    for (var j = i + 1; j < home.cards2.length; j++) {
      if (overlap(home.cards2[i], home.cards2[j])) { ov = true; break; }
    }
    if (ov) { break; }
  }
  check('全部模式: 卡片互不重叠', !ov);

  // 过滤模式逐一验证
  var expect = { brain: 11, hand: 5, eye: 1 };
  ['brain', 'hand', 'eye'].forEach(function (cat) {
    home.setChip(['all', 'brain', 'hand', 'eye'].indexOf(cat));
    home.layout();
    runFrames(1);
    check(cat + ' 过滤: 卡片数=' + expect[cat], home.cards2.length === expect[cat], '实际 ' + home.cards2.length);
    check(cat + ' 过滤: 不出屏', home.cards2.every(function (r) { return inContent(r, home); }));
    check(cat + ' 过滤: 渲染无异常', errors.length === 0, errors.join(' | '));
    errors.length = 0;
  });

  // chip 命中：模拟点「烧脑」chip，断言 activeChip 切换 + 重建
  home.activeChip = 'all'; home.layout();
  var chipRect = home.chipRects[1]; // 烧脑
  var before = home.cards2.length;
  tap(chipRect.x + chipRect.w / 2, chipRect.y + chipRect.h / 2);
  check('点 chip 切换 activeChip=bra', home.activeChip === 'brain', 'active=' + home.activeChip);
  check('点 chip 后卡片数变为 11（烧脑含猫猫方块+盯红球+盯蝌蚪+瞬时记忆）', home.cards2.length === 11, '实际 ' + home.cards2.length);

  // 点击某张可见卡能否正常进关（取全部模式下第一张：数独→pickDiff）
  home.activeChip = 'all'; home.layout();
  runFrames(1);
  var first = home.cards2[0];
  var sceneBefore = BF.App.current;
  tap(first.x + first.w / 2, first.y + first.h / 2 - home.scroll);
  check('点卡片进关(场景切换)', BF.App.current !== sceneBefore, 'to=' + (BF.App.current && BF.App.current.constructor.name));

  // 真机尺寸：iPhone 8 (375x667) 与 320x568 下全部模式不出屏
  [375, 320].forEach(function (ww) {
    BF.platform.width = ww; BF.platform.canvas.width = ww; home.W = ww;
    home.activeChip = 'all'; home.layout();
    runFrames(1);
    var ok = home.cards2.every(function (r) { return inContent(r, home); }) && errors.length === 0;
    check('尺寸 ' + ww + ': 全部模式不出屏且渲染正常', ok, errors.join(' | '));
    errors.length = 0;
    BF.platform.width = W; BF.platform.canvas.width = W; home.W = W;
  });
}

console.log('\n=== 首页分层验证 (' + W + 'x' + H + ') ===');
report.forEach(function (l) { console.log(l); });
console.log(allOk ? '\n全部通过 ✓' : '\n存在失败 ✗');
process.exit(allOk ? 0 : 1);
