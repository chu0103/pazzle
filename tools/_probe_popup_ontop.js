/**
 * _probe_popup_ontop.js —— 规则弹框「永远在最上层」的绘制顺序护栏
 *
 * 背景 bug：play.js 曾把「入场淡入白纱」(fadeIn*0.85 的满屏 fillRect) 放到了
 *   `RuleTip.render` 之后，而 update 在 showRule 期间提前 return → fadeIn 恒为 1
 *   → 白纱永久盖在弹框上 → 弹框内容全透明（能透过它看见棋盘）。
 *   ⚠️ fake canvas 不合成 alpha，普通逻辑探针完全测不出这种「看起来透明」的 bug，
 *   只能靠真机截图 + 像素核验发现（见 tools/_verify_popup_opacity_edge.sh）。
 *
 * 本护栏用**记录绘制顺序**的方式在纯 node 里抓住同一类回归：
 *   弹框内容用 sentinel 文字「开始游戏 / 不再提示」识别；满屏近白 fillRect = 淡入白纱。
 *   断言：弹框在场时，绝不允许「白纱」出现在弹框内容之后。
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var root = path.join(__dirname, '..');
var W = 390, H = 844, SAFE_T = 44, SAFE_B = 34;

var events = [];      // 有序绘制事件 {k:'fill'|'text', ...}
var recording = false;
function fakeCtx() {
  var grad = { addColorStop: function () {} };
  var fillStyle = '#000';
  var t = {
    save: function () {}, restore: function () {}, scale: function () {},
    setTransform: function () {}, transform: function () {}, translate: function () {}, rotate: function () {},
    fillRect: function (x, y, w, h) {
      if (recording) { events.push({ k: 'fill', x: x, y: y, w: w, h: h, c: String(fillStyle) }); }
    },
    clearRect: function () {}, strokeRect: function () {},
    beginPath: function () {}, closePath: function () {}, moveTo: function () {}, lineTo: function () {},
    arc: function () {}, arcTo: function () {}, rect: function () {}, clip: function () {},
    fill: function () {}, stroke: function () {}, setLineDash: function () {}, drawImage: function () {},
    createLinearGradient: function () { return grad; }, createRadialGradient: function () { return grad; },
    measureText: function (s) { return { width: String(s).length * 7 }; },
    fillText: function (s) { if (recording) { events.push({ k: 'text', s: String(s) }); } },
    strokeText: function () {}
  };
  return new Proxy(t, {
    get: function (o, k) { if (k === 'fillStyle') { return fillStyle; } return o[k]; },
    set: function (o, k, v) { if (k === 'fillStyle') { fillStyle = v; } else { o[k] = v; } return true; }
  });
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
  width: W, height: H, dpr: 1, safeTop: SAFE_T, safeBottom: SAFE_B, now: function () { return Date.now(); },
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

// 「弹框内容」的 sentinel 文字（RuleTip 按钮/复选框专属）
function isPopupText(s) { return s === '开始游戏' || s === '不再提示'; }
// 「淡入白纱」= 覆盖近满屏的近白 fillRect
function isWhiteVeil(e) {
  return e.k === 'fill' && e.w >= W - 2 && e.h >= H - 2 && e.x <= 2 && e.y <= 2 &&
    /^#(fff|ffffff|FFF|FFFFFF)$/i.test(e.c.replace(/\s/g, ''));
}

// 每个用例：进入方式 + 期望（是否该有 rules 弹框）
var CASES = [
  { name: 'play(每日挑战)', go: function () { BF.App.go('play', { daily: true }); }, want: true },
  { name: 'block', go: function () { BF.App.go('play', { level: 1, game: 'block' }); }, want: null },
  { name: 'rush', go: function () { BF.App.go('rush', { level: 1 }); }, want: null },
  { name: 'blocks', go: function () { BF.App.go('blocks', { level: 1 }); }, want: null },
  { name: 'sudoku', go: function () { BF.App.go('sudoku', { level: 1 }); }, want: null },
  { name: 'mine', go: function () { BF.App.go('mine', { level: 1 }); }, want: null },
  { name: 'picross', go: function () { BF.App.go('picross', { level: 1 }); }, want: null },
  { name: 'diff', go: function () { BF.App.go('diff', { level: 1 }); }, want: null },
  { name: 'bottle', go: function () { BF.App.go('bottle', { level: 1 }); }, want: null },
  { name: 'cipher', go: function () { BF.App.go('cipher', { level: 1 }); }, want: null }
];

var allOk = true;
CASES.forEach(function (tc) {
  BF.Save.resetAll();
  events = []; recording = false;
  try {
    tc.go();
    // 跑到稳态（ruleAnim→1；弹框场景 fadeIn 会冻在 1，正好覆盖本 bug 的触发条件）
    var c = BF.App.current;
    for (var i = 0; i < 160; i++) { if (c.update) { c.update(16); } }
    // 记录一帧的绘制顺序
    recording = true;
    if (c.render) { c.render(ctx); }
    recording = false;

    var popupIdx = -1, veilAfterPopup = 0;
    for (var j = 0; j < events.length; j++) {
      if (popupIdx < 0 && events[j].k === 'text' && isPopupText(events[j].s)) { popupIdx = j; }
      if (popupIdx >= 0 && isWhiteVeil(events[j])) { veilAfterPopup++; }
    }
    var hasPopup = popupIdx >= 0;
    var ok = hasPopup ? (veilAfterPopup === 0) : true;   // 没弹框的帧不适用
    if (!ok) { allOk = false; }
    console.log((ok ? '✓' : '✗') + ' ' + tc.name +
      (hasPopup ? (' 弹框在场，白纱在弹框后=' + veilAfterPopup) : ' （本帧无弹框，跳过）'));
  } catch (e) {
    allOk = false;
    console.log('✗ ' + tc.name + ' EXCEPTION: ' + e.message);
  }
});
console.log(allOk ? '\n全部通过' : '\n存在问题');
process.exit(allOk ? 0 : 1);
