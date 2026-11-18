/**
 * _verify_recall_popup.js —— 瞬时记忆「规则弹框永远在最上层」绘制顺序护栏
 *
 * 背景 bug（见 ruletip.js 头注释）：若把「入场淡入白纱」(满屏 fillRect) 画到
 *   RuleTip.render 之后，而 update 在 showRule 期间提前 return → 白纱恒为 1 →
 *   白纱永久盖在弹框上 → 弹框内容全透明（能透过它看见场景卡）。
 *   ⚠️ fake canvas 不合成 alpha，普通逻辑探针测不出，只能靠「记录绘制顺序」断言，
 *      真机侧另由 tools/_shot_recall.py 做像素核验（min_lum ≈47 才是不透明）。
 *
 * 断言：弹框在场时（能识别「开始游戏」sentinel 文字），
 *   绝不允许「满屏近白 fillRect」出现在弹框内容之后。
 * 只验证瞬时记忆，不掺入旧通用探针（那些 load 列表停在 #12，早已失效）。
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var root = path.join(__dirname, '..');
var W = 390, H = 844, SAFE_T = 44, SAFE_B = 34;

var events = [];
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
    arc: function () {}, arcTo: function () {}, rect: function () {}, clip: function () {}, ellipse: function () {},
    quadraticCurveTo: function () {}, bezierCurveTo: function () {},
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
['js/core/ns.js', 'js/core/palette.js', 'js/core/draw.js', 'js/core/save.js',
 'js/game/recall.js', 'js/scenes/ruletip.js', 'js/scenes/recall.js'].forEach(load);
var BF = sandbox.BF;
var ctx = fakeCtx();
BF.platform = { isMiniGame: false, ready: true, canvas: { width: W, height: H }, ctx: ctx,
  width: W, height: H, dpr: 1, safeTop: SAFE_T, safeBottom: SAFE_B, now: function () { return Date.now(); },
  requestFrame: function (cb) { frames.push(cb); }, getStorage: function (k, d) { return store[k] === undefined ? d : store[k]; },
  setStorage: function (k, v) { store[k] = v; }, vibrate: function () {},
  bindPointer: function (h) { input.down = h.down; input.move = h.move; input.up = h.up; },
  createImage: function (s, cb) { var i = { src: s, width: 720, height: 720, __fake: true }; if (cb) { cb(null, i); } return i; } };
BF.RuleTip.on = true;
BF.Save.load();

function isPopupText(s) { return s === '开始游戏' || s === '不再提示'; }
function isWhiteVeil(e) {
  return e.k === 'fill' && e.w >= W - 2 && e.h >= H - 2 && e.x <= 2 && e.y <= 2 &&
    /^#(fff|ffffff|FFF|FFFFFF)$/i.test(e.c.replace(/\s/g, ''));
}

var fakeApp = { go: function () {} };
var scene = new BF.SceneRecall(fakeApp);
var ok = true;
function check(cond, msg) { if (!cond) { ok = false; } console.log((cond ? '✓ ' : '✗ ') + msg); }

/* ---- 用例 1：首次进入应弹规则框，且弹框内容之后无满屏近白覆盖 ---- */
BF.Save.resetAll();
scene.enter({ level: 1 });
for (var i = 0; i < 160; i++) { scene.update(16); }
events = []; recording = true;
try { scene.render(ctx); } catch (e) { check(false, '弹框帧渲染抛异常: ' + e.message); }
recording = false;

var popupIdx = -1, veilAfter = 0;
for (var j = 0; j < events.length; j++) {
  if (popupIdx < 0 && events[j].k === 'text' && isPopupText(events[j].s)) { popupIdx = j; }
  if (popupIdx >= 0 && isWhiteVeil(events[j])) { veilAfter++; }
}
check(popupIdx >= 0, '用例1 首次进入瞬时记忆·已识别规则弹框「开始游戏」');
check(veilAfter === 0, '用例1 弹框内容之后满屏近白覆盖=' + veilAfter + '（应为 0，白纱必须早于弹框）');

/* ---- 用例 2：弹框期间阶段机不推进（观察倒计时冻结） ---- */
var beforeT = scene.observeT;
for (var k2 = 0; k2 < 100; k2++) { scene.update(16); }
check(Math.abs(scene.observeT - beforeT) < 1e-9, '用例2 弹框期间观察倒计时冻结（不偷跑）');
check(scene.phase === 'observe', '用例2 弹框期间仍停在 observe');

/* ---- 用例 3：点击「开始游戏」应关闭弹框，稳态帧不再含弹框内容 ---- */
var okRect = scene.ruleOk;
scene.onDown(okRect.x + okRect.w / 2, okRect.y + okRect.h / 2);
scene.onUp(okRect.x + okRect.w / 2, okRect.y + okRect.h / 2);
for (var k = 0; k < 30; k++) { scene.update(16); }
events = []; recording = true;
try { scene.render(ctx); } catch (e2) { check(false, '稳态帧渲染抛异常: ' + e2.message); }
recording = false;
var popupIdx2 = -1;
for (var m = 0; m < events.length; m++) {
  if (events[m].k === 'text' && isPopupText(events[m].s)) { popupIdx2 = m; break; }
}
check(popupIdx2 < 0 && scene.showRule === false,
  '用例3 点「开始游戏」后弹框已关闭（showRule=' + scene.showRule + '）');
check(scene.observeT < beforeT, '用例3 关闭弹框后观察倒计时恢复推进');

/* ---- 用例 4：header「?」重看弹框，白纱顺序仍正确 ---- */
var rb = scene.ruleBtn;
scene.onDown(rb.x + rb.w / 2, rb.y + rb.h / 2);
scene.onUp(rb.x + rb.w / 2, rb.y + rb.h / 2);
check(scene.showRule === true, '用例4 header「?」可重看规则');
events = []; recording = true;
try { scene.render(ctx); } catch (e3) { check(false, '重看帧渲染抛异常: ' + e3.message); }
recording = false;
var p4 = -1, veil4 = 0;
for (var n = 0; n < events.length; n++) {
  if (p4 < 0 && events[n].k === 'text' && isPopupText(events[n].s)) { p4 = n; }
  if (p4 >= 0 && isWhiteVeil(events[n])) { veil4++; }
}
check(p4 >= 0 && veil4 === 0, '用例4 重看弹框仍在最上层（白纱覆盖=' + veil4 + '）');

console.log(ok ? '\n全部通过 ✓' : '\n存在问题 ✗');
process.exit(ok ? 0 : 1);
