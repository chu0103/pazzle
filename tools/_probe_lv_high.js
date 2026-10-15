/**
 * _probe_lv_high.js —— 复现「数独/扫雷/数织看不到关卡」的高关卡维度探针
 *
 * 上一版 _probe_lv_flow 只进了第 1 关（全新存档 → next=1）。
 * 但数独/扫雷/数织是高关卡游戏，用户在「先选难度」首屏点档卡进的是
 * 该档「第一个未通关」的关——有进度的老玩家可能直接进到 20/40 关，
 * 而这些关的棋盘尺寸更大（扫雷 14×14、数织 15×15），几何最紧张。
 * 若高关卡造题/渲染有问题，就会出现「点进去一片空白」。
 *
 * 本探针：对每款游戏直接 enter 1/10/20/40 关，断言
 *   ① 造题成功（boardCheck 通过）② 棋盘矩形完整在屏内（safeTop=44/safeBottom=34 真机口径）。
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
var W = 390, H = 844;
var SAFE_T = 44, SAFE_B = 34;   // iPhone X 类刘海/底部安全区

var ctxDepth = 0;
function fakeCtx() {
  var grad = { addColorStop: function () {} };
  var t = {
    save: function () { ctxDepth++; }, restore: function () { ctxDepth--; if (ctxDepth < 0) ctxDepth = 0; },
    scale: function () {}, setTransform: function () {}, transform: function () {}, translate: function () {}, rotate: function () {},
    fillRect: function () {}, clearRect: function () {}, strokeRect: function () {},
    beginPath: function () {}, closePath: function () {}, moveTo: function () {}, lineTo: function () {},
    arc: function () {}, arcTo: function () {}, rect: function () {}, clip: function () {},
    fill: function () {}, stroke: function () {}, setLineDash: function () {}, drawImage: function () {},
    createLinearGradient: function () { return grad; }, createRadialGradient: function () { return grad; },
    measureText: function (s) { return { width: String(s).length * 7 }; },
    fillText: function () {}, strokeText: function () {}
  };
  return new Proxy(t, { get: function (o, k) { return o[k]; }, set: function (o, k, v) { o[k] = v; return true; } });
}
var frames = [];
var input = { down: null, move: null, up: null };
var store = {};
var sandbox = { console: console, Math: Math, Date: Date, JSON: JSON, Object: Object, Array: Array,
  String: String, Number: Number, Boolean: Boolean, Error: Error, setTimeout: setTimeout,
  parseInt: parseInt, isNaN: isNaN, Proxy: Proxy };
sandbox.globalThis = sandbox; sandbox.window = sandbox; vm.createContext(sandbox);
function load(rel) { vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel }); }

['js/core/ns.js','js/core/palette.js','js/core/draw.js'].forEach(load);
var BF = sandbox.BF;
var ctx = fakeCtx();
BF.platform = { isMiniGame: false, ready: true, canvas: { width: W, height: H }, ctx: ctx,
  width: W, height: H, dpr: 2, safeTop: SAFE_T, safeBottom: SAFE_B, now: function () { return Date.now(); },
  requestFrame: function (cb) { frames.push(cb); }, getStorage: function (k, d) { return store[k] === undefined ? d : store[k]; },
  setStorage: function (k, v) { store[k] = v; }, vibrate: function () {},
  bindPointer: function (h) { input.down = h.down; input.move = h.move; input.up = h.up; },
  createImage: function (s, cb) { var i = { src: s, width: 720, height: 720, __fake: true }; if (cb) cb(null, i); return i; },
  chooseImage: function (cb) { cb(new Error('x')); } };
['js/core/save.js','js/game/generator.js','js/game/logic.js','js/game/photoAssets.js','js/game/photo.js',
 'js/game/diffAssets.js','js/game/diff.js','js/game/model.js','js/scenes/home.js','js/scenes/levels.js',
 'js/scenes/diffpick.js','js/scenes/ruletip.js','js/scenes/play.js','js/scenes/diff.js','js/game/bottle.js',
 'js/scenes/bottle.js','js/game/cipher.js','js/scenes/cipher.js','js/game/rush.js','js/scenes/rush.js',
 'js/game/blocks.js','js/scenes/blocks.js','js/game/sudoku.js','js/game/mine.js','js/scenes/sudoku.js',
 'js/scenes/mine.js','js/game/picross.js','js/scenes/picross.js','js/app.js'].forEach(load);
BF.RuleTip.on = true;

function frame() { var c = BF.App.current; try { if (c.update) c.update(16); c.render(ctx); return true; } catch (e) { console.error('  render/update 异常 @' + (c.constructor && c.constructor.name) + ': ' + e.message + '\n' + e.stack.split('\n').slice(0,5).join('\n')); return false; } }
function runFrames(n) { for (var i = 0; i < (n||1); i++) { if (!frame()) return false; } return true; }
function tap(x, y) { try { if (input.down) input.down(x, y); runFrames(2); if (input.up) input.up(x, y); return true; } catch (e) { console.error('  tap 异常: ' + e.message); return false; } }
function center(r) { return [r.x + r.w / 2, r.y + r.h / 2]; }
function onScreen(r) { return r && r.x >= -2 && r.y >= -2 && r.x + r.w <= W + 2 && r.y + r.h <= H + 2; }

function boardCheck(game, sc) {
  if (game === 'sudoku') return sc.entries && sc.entries.some(function (v) { return v > 0; });
  if (game === 'mine') return typeof sc.n === 'number' && sc.n > 0;
  if (game === 'picross') return !!(sc.cells && sc.cells.length && sc.rowC && sc.rowC.length);
  return true;
}
function boardRect(game, sc) {
  if (game === 'sudoku' || game === 'mine') return { x: sc.boardX, y: sc.boardY, w: sc.boardW, h: sc.boardW };
  if (game === 'picross') return { x: sc.boardX, y: sc.boardY, w: sc.boardW, h: sc.boardH };
  return null;
}

// rush 用 cars（非网格矩形），其 boardRect 模型不同，不在本探针范围；
// 这里只覆盖用户报障的三款（网格类，rect 口径统一）。
var GAMES = ['sudoku', 'mine', 'picross'];
var LEVELS = [1, 10, 20, 40];
var allOk = true;

GAMES.forEach(function (game) {
  LEVELS.forEach(function (lv) {
    BF.Save.resetAll();
    var tag = game + ' L' + lv;
    try {
      BF.App.go(game, { level: lv });
      runFrames(6);
      var sc = BF.App.current;
      // 首进可能弹规则框：关掉再验棋盘
      if (sc.showRule) {
        var ob = sc.ruleOk;
        if (ob) { var oc = center(ob); tap(oc[0], oc[1]); }
      }
      runFrames(30);
      sc = BF.App.current;
      var okGen = boardCheck(game, sc);
      var rect = boardRect(game, sc);
      var okGeo = onScreen(rect);
      var status = (okGen && okGeo) ? '✓' : '✗';
      if (!(okGen && okGeo)) allOk = false;
      var detail = okGen ? '' : ' [造题失败]';
      if (!okGeo) detail += ' [棋盘出屏 ' + (rect ? JSON.stringify([Math.round(rect.x),Math.round(rect.y),Math.round(rect.w),Math.round(rect.h)]) : 'null') + ']';
      console.log(status + ' ' + tag + (detail || ' 棋盘在屏内'));
    } catch (e) {
      allOk = false;
      console.log('✗ ' + tag + ' EXCEPTION: ' + e.message);
    }
  });
});
console.log(allOk ? '\n全部通过' : '\n存在问题');
process.exit(allOk ? 0 : 1);
