/**
 * _probe_lv_flow.js —— 复现「数独/扫雷/数织看不到关卡」的真机模式探针
 *
 * 与 smoke 的区别：BF.RuleTip.on = true（真机口径），并走完整用户路径：
 *   首页 → 进游戏(难度首屏) → 点第一张档卡 → (弹框→点「开始游戏」) → 棋盘渲染
 *   → 返回难度首屏 → 点「查看全部关卡」→ 关卡网格 → 点第 1 关 → 进关。
 * 每一步都真跑 update+render（假 canvas），任何异常/几何出屏都会被抓出来。
 * rush 作为对照组（用户没报障的游戏）。
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');

var W = parseInt(process.argv[2], 10) || 390;
var H = parseInt(process.argv[3], 10) || 844;

/* ---------- 假 Canvas（与 smoke 同口径 + 记录填充/文字调用） ---------- */
var ctxDepth = 0;
var ops = [];           // 每帧记录 {fill: n, text: n}
var curOps = null;

function fakeCtx() {
  var grad = { addColorStop: function () {} };
  var target = {
    save: function () { ctxDepth++; },
    restore: function () { ctxDepth--; if (ctxDepth < 0) { ctxDepth = 0; } },
    scale: function () {},
    setTransform: function () {}, transform: function () {}, translate: function () {}, rotate: function () {},
    fillRect: function () { if (curOps) { curOps.fill++; } },
    clearRect: function () {}, strokeRect: function () {},
    beginPath: function () {}, closePath: function () {}, moveTo: function () {},
    lineTo: function () {}, arc: function () {}, arcTo: function () {}, rect: function () {},
    clip: function () {}, fill: function () { if (curOps) { curOps.fill++; } }, stroke: function () {},
    setLineDash: function () {},
    drawImage: function () {},
    createLinearGradient: function () { return grad; },
    createRadialGradient: function () { return grad; },
    measureText: function (t) { return { width: String(t).length * 7 }; },
    fillText: function (t) { if (curOps) { curOps.text++; curOps.texts.push(String(t)); } },
    strokeText: function () {}
  };
  return new Proxy(target, {
    get: function (t, k) { return t[k]; },
    set: function (t, k, v) { t[k] = v; return true; }
  });
}

/* ---------- 假宿主 ---------- */
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
  canvas: { width: W, height: H },
  ctx: ctx,
  width: W,
  height: H,
  dpr: 2,
  safeTop: 0,
  safeBottom: 0,
  now: function () { return Date.now(); },
  requestFrame: function (cb) { frames.push(cb); },
  getStorage: function (k, d) { return store[k] === undefined ? d : store[k]; },
  setStorage: function (k, v) { store[k] = v; },
  vibrate: function () {},
  bindPointer: function (h) { input.down = h.down; input.move = h.move; input.up = h.up; },
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
load('js/scenes/diffpick.js');
load('js/scenes/ruletip.js');
load('js/scenes/play.js');
load('js/scenes/diff.js');
load('js/game/bottle.js');
load('js/scenes/bottle.js');
load('js/game/cipher.js');
load('js/scenes/cipher.js');
load('js/game/rush.js');
load('js/scenes/rush.js');
load('js/game/blocks.js');
load('js/scenes/blocks.js');
load('js/game/sudoku.js');
load('js/game/mine.js');
load('js/scenes/sudoku.js');
load('js/scenes/mine.js');
load('js/game/picross.js');
load('js/scenes/picross.js');
load('js/app.js');

/* ★★★ 真机口径：弹框总开关开着（与 smoke 相反） ★★★ */
BF.RuleTip.on = true;

/* ---------- 工具 ---------- */
var errors = [];
function frame() {
  var c = BF.App.current;
  curOps = { fill: 0, text: 0, texts: [] };
  try {
    if (c.update) { c.update(16); }
    c.render(ctx);
  } catch (e) {
    errors.push('render/update 异常 @' + (c && c.constructor ? c.constructor.name : '?') + ': ' + e.message + '\n' + e.stack.split('\n').slice(0, 4).join('\n'));
    curOps = null;
    return false;
  }
  curOps = null;
  return true;
}
function runFrames(n) { for (var i = 0; i < (n || 1); i++) { if (!frame()) { return false; } } return true; }
function tap(x, y, n) {
  try {
    if (input.down) { input.down(x, y); }
    runFrames(n === undefined ? 2 : n);
    if (input.up) { input.up(x, y); }
    return true;
  } catch (e) {
    errors.push('tap 异常 @(' + x + ',' + y + '): ' + e.message + '\n' + e.stack.split('\n').slice(0, 4).join('\n'));
    return false;
  }
}
function center(r) { return [r.x + r.w / 2, r.y + r.h / 2]; }
function onScreen(r, W, H) { return r && r.x >= -1 && r.y >= -1 && r.x + r.w <= W + 1 && r.y + r.h <= H + 1; }

var report = [];

/* 每款游戏的棋盘「存在感」检查：关掉弹框后，场景该有的关键状态/画面内容 */
function boardCheck(game, sc) {
  if (game === 'sudoku') {
    return sc.entries && sc.entries.some(function (v) { return v > 0; });
  }
  if (game === 'mine') {
    return typeof sc.n === 'number' && sc.n > 0;   // 棋盘尺寸已定（首点后才有雷位，初始只验网格就绪）
  }
  if (game === 'picross') {
    return !!(sc.cells && sc.cells.length && sc.rowC && sc.rowC.length);
  }
  if (game === 'rush') {
    return !!(sc.cars && sc.cars.length);
  }
  return true;
}

var GAMES = ['rush', 'sudoku', 'mine', 'picross'];

GAMES.forEach(function (game) {
  var log = { game: game, steps: [], ok: true };
  report.push(log);
  BF.Save.resetAll();
  errors.length = 0;

  try {
    /* 1. 首页 → 进游戏（与首页卡片 onTap 同参数） */
    BF.App.go('home');
    if (!runFrames(3)) { log.ok = false; log.steps.push('home render fail'); return; }
    BF.App.go(game, { pickDiff: true, game: game });
    if (process.env.DBG) {
      console.error('DBG platform=', BF.platform.width, BF.platform.height,
        'headerY=', BF.App.current.headerY,
        'card0=', JSON.stringify(BF.App.current.pickCards && BF.App.current.pickCards[0]));
    }
    if (!runFrames(5)) { log.ok = false; log.steps.push('pickDiff render fail'); return; }
    var sc = BF.App.current;
    if (!sc.pickDiff || !sc.pickCards || !sc.pickCards.length) {
      log.ok = false; log.steps.push('难度首屏没有档卡 pickCards=' + (sc.pickCards && sc.pickCards.length)); return;
    }
    var bad = sc.pickCards.filter(function (c) { return !onScreen(c, W, H); });
    if (bad.length) {
      log.ok = false;
      log.steps.push(bad.length + ' 张档卡出屏 ' + JSON.stringify(bad.map(function (c) { return [c.name, Math.round(c.x), Math.round(c.y), Math.round(c.w), Math.round(c.h)]; })));
      return;
    }
    log.steps.push('难度首屏 OK(' + sc.pickCards.length + ' 档)');

    /* 2. 点第一张档卡 → 进该档第一个未通关的关 */
    var c0 = center(sc.pickCards[0]);
    if (!tap(c0[0], c0[1], 3)) { log.ok = false; return; }
    sc = BF.App.current;
    if (sc.pickDiff) { log.ok = false; log.steps.push('点档卡后仍在难度首屏'); return; }
    log.steps.push('进关 OK(level=' + sc.level + ')');

    /* 3. 首进应有规则弹框；弹框期间棋盘也照常画（被遮罩压暗当背景） */
    if (!runFrames(10)) { log.ok = false; return; }
    if (sc.showRule) {
      log.steps.push('弹框已弹');
      if (!sc.ruleCard || !onScreen(sc.ruleCard, W, H)) {
        log.ok = false; log.steps.push('弹框卡片出屏 ruleCard=' + JSON.stringify(sc.ruleCard)); return;
      }
      /* 点「开始游戏」关闭 */
      var ob = sc.ruleOk;
      if (!ob) { log.ok = false; log.steps.push('ruleOk 不存在'); return; }
      var oc = center(ob);
      if (!tap(oc[0], oc[1], 3)) { log.ok = false; return; }
      if (sc.showRule) { log.ok = false; log.steps.push('点「开始游戏」弹框没关'); return; }
      log.steps.push('弹框关闭 OK');
    } else {
      log.steps.push('(本进未弹框——检查 shouldShow 口径)');
    }

    /* 4. 关掉弹框后棋盘渲染：画得出来 + 状态就绪 */
    if (!runFrames(30)) { log.ok = false; return; }
    if (!boardCheck(game, sc)) { log.ok = false; log.steps.push('棋盘状态缺失(boardCheck fail)'); return; }
    log.steps.push('棋盘渲染 OK');

    /* 5. 返回难度首屏 → 查看全部关卡 → 关卡网格 → 点第 1 关 */
    BF.App.go(game, { pickDiff: true, game: game });
    if (!runFrames(5)) { log.ok = false; return; }
    sc = BF.App.current;
    if (!sc.pickAll) { log.ok = false; log.steps.push('pickAll 不存在'); return; }
    var pa = center(sc.pickAll);
    if (!tap(pa[0], pa[1], 3)) { log.ok = false; return; }
    sc = BF.App.current;
    if (!sc.total) { log.ok = false; log.steps.push('关卡网格 total=' + sc.total); return; }
    /* 网格首格应该在屏内且可命中 */
    var cell1 = sc.rectOf ? sc.rectOf(1) : null;
    if (!cell1 || !onScreen(cell1, W, H)) {
      log.ok = false; log.steps.push('第 1 关格子不在屏内 ' + JSON.stringify(cell1)); return;
    }
    if (sc.hitLevel) {
      var hit = sc.hitLevel(center(cell1)[0], center(cell1)[1]);
      if (hit !== 1) { log.ok = false; log.steps.push('hitLevel(第1格)=' + hit + ' 应为 1'); return; }
    }
    log.steps.push('关卡网格 OK(total=' + sc.total + ', 首格在屏)');

    /* 6. 点第 1 关格子 → 进关（关卡网格入口也能进游戏） */
    var cc = center(cell1);
    if (!tap(cc[0], cc[1], 3)) { log.ok = false; return; }
    sc = BF.App.current;
    if (sc.total) { log.ok = false; log.steps.push('点第 1 关没进关（仍在关卡网格）'); return; }
    if (!runFrames(20)) { log.ok = false; return; }
    if (sc.showRule) {
      /* 从关卡网格进也应弹框（同一关第一次），关掉后棋盘要能画 */
      var ob2 = sc.ruleOk;
      if (ob2) { var oc2 = center(ob2); tap(oc2[0], oc2[1], 3); }
      if (sc.showRule) { log.ok = false; log.steps.push('网格入口的弹框关不掉'); return; }
    }
    if (!boardCheck(game, sc)) { log.ok = false; log.steps.push('网格入口进关后棋盘状态缺失'); return; }
    log.steps.push('网格入口进关 OK');
  } catch (e) {
    log.ok = false;
    log.steps.push('EXCEPTION: ' + e.message);
    errors.push(e.stack);
  }
  if (errors.length) { log.err = errors.slice(0, 3); }
});

/* ---------- 汇总 ---------- */
console.log('\n========== 真机模式弹框路径探针（RuleTip.on=true） ==========');
var allOk = true;
report.forEach(function (r) {
  console.log((r.ok ? '✓' : '✗') + ' ' + r.game + ': ' + r.steps.join(' → '));
  if (r.err) { console.log('    ' + r.err.join('\n    ')); }
  if (!r.ok) { allOk = false; }
});
console.log(allOk ? '\n全部通过' : '\n存在问题');
process.exit(allOk ? 0 : 1);
