/**
 * _probe_sudoku_grid.js —— 记录数独一屏的全部绘制调用，定位网格线/数字的实际坐标
 * 用法：node tools/_probe_sudoku_grid.js
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var root = path.join(__dirname, '..');

var ops = [];   // {op, args, lineWidth, strokeStyle, font, fillStyle, textAlign}
var cur = {};

function rec(op, args) { ops.push({ op: op, args: args, lineWidth: cur.lineWidth, strokeStyle: cur.strokeStyle, font: cur.font, fillStyle: cur.fillStyle, textAlign: cur.textAlign }); }

function fakeCtx() {
  var grad = { addColorStop: function () {} };
  var target = {
    save: function () {}, restore: function () {},
    scale: function () {}, setTransform: function () {}, transform: function () {}, translate: function () {}, rotate: function () {},
    fillRect: function (a, b, c, d) { rec('fillRect', [a, b, c, d]); },
    clearRect: function () {}, strokeRect: function (a, b, c, d) { rec('strokeRect', [a, b, c, d]); },
    beginPath: function () {}, closePath: function () {},
    moveTo: function (a, b) { rec('moveTo', [a, b]); },
    lineTo: function (a, b) { rec('lineTo', [a, b]); },
    arc: function () {}, arcTo: function () {}, rect: function () {},
    clip: function () {}, fill: function () {}, stroke: function () {},
    setLineDash: function () {},
    drawImage: function () {},
    createLinearGradient: function () { return grad; },
    createRadialGradient: function () { return grad; },
    measureText: function (t) { return { width: String(t).length * 7 }; },
    fillText: function (t, a, b) { rec('fillText', [String(t), a, b]); },
    strokeText: function () {}
  };
  return new Proxy(target, {
    get: function (t, k) {
      if (k === 'lineWidth' || k === 'strokeStyle' || k === 'font' || k === 'fillStyle' || k === 'textAlign') { return cur[k]; }
      return t[k];
    },
    set: function (t, k, v) {
      if (k === 'lineWidth' || k === 'strokeStyle' || k === 'font' || k === 'fillStyle' || k === 'textAlign') { cur[k] = v; return true; }
      t[k] = v; return true;
    }
  });
}

var sandbox = {
  console: console, Math: Math, Date: Date, JSON: JSON, Object: Object, Array: Array,
  String: String, Number: Number, Boolean: Boolean, Error: Error,
  setTimeout: setTimeout, parseInt: parseInt, isNaN: isNaN, Proxy: Proxy
};
sandbox.globalThis = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox);
function load(rel) { vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel }); }

load('js/core/ns.js'); load('js/core/palette.js'); load('js/core/draw.js');
var BF = sandbox.BF;
var ctx = fakeCtx();
BF.platform = {
  isMiniGame: false, ready: true, canvas: { width: 390, height: 844 }, ctx: ctx,
  width: 390, height: 844, dpr: 2, safeTop: 0, safeBottom: 0,
  now: function () { return Date.now(); }, requestFrame: function () {},
  getStorage: function (k, d) { return d; }, setStorage: function () {}, vibrate: function () {},
  bindPointer: function () {}, createImage: function (s, cb) { cb(null, { src: s, width: 720, height: 720, __fake: true }); },
  chooseImage: function (cb) { cb(new Error('no')); }
};
load('js/core/save.js'); load('js/game/generator.js'); load('js/game/logic.js');
load('js/game/photoAssets.js'); load('js/game/photo.js'); load('js/game/diffAssets.js');
load('js/game/diff.js'); load('js/game/model.js'); load('js/scenes/home.js');
load('js/scenes/levels.js'); load('js/scenes/diffpick.js'); load('js/scenes/play.js');
load('js/scenes/diff.js'); load('js/game/bottle.js'); load('js/scenes/bottle.js');
load('js/game/cipher.js'); load('js/scenes/cipher.js'); load('js/game/rush.js');
load('js/scenes/rush.js'); load('js/game/blocks.js'); load('js/scenes/blocks.js');
load('js/scenes/ruletip.js');
load('js/game/sudoku.js'); load('js/game/mine.js');
load('js/scenes/sudoku.js'); load('js/scenes/mine.js');
load('js/game/picross.js'); load('js/scenes/picross.js'); load('js/app.js');

var app = BF.App;
app.go('sudoku', { game: 'sudoku', level: 1 });
var sc = app.current;
sc.layout();
ops.length = 0;
sc.render(ctx);

console.log('cell=' + sc.cell + ' boardX=' + sc.boardX + ' boardY=' + sc.boardY + ' boardW=' + sc.boardW);
console.log('--- 竖线 (moveTo x=y? 看 lineTo) ---');
for (var i = 0; i < ops.length; i++) {
  var o = ops[i];
  if (o.op !== 'moveTo') { continue; }
  var nx = ops[i + 1];
  if (!nx || nx.op !== 'lineTo') { continue; }
  var a = o.args, b = nx.args;
  if (a[0] === b[0]) {
    var col = (a[0] - sc.boardX) / sc.cell;
    console.log('V x=' + a[0].toFixed(2) + ' y=' + a[1].toFixed(2) + '→' + b[1].toFixed(2) +
      ' lw=' + o.lineWidth + ' style=' + o.strokeStyle + '  → 第 ' + col.toFixed(3) + ' 格边界');
  } else if (a[1] === b[1]) {
    var row = (a[1] - sc.boardY) / sc.cell;
    console.log('H y=' + a[1].toFixed(2) + ' x=' + a[0].toFixed(2) + '→' + b[0].toFixed(2) +
      ' lw=' + o.lineWidth + ' style=' + o.strokeStyle + '  → 第 ' + row.toFixed(3) + ' 格边界');
  }
}
console.log('--- 数字 ---');
var n = 0;
for (var j = 0; j < ops.length; j++) {
  var t = ops[j];
  if (t.op !== 'fillText') { continue; }
  var txt = t.args[0], x = t.args[1], y = t.args[2];
  if (x < sc.boardX - 1 || x > sc.boardX + sc.boardW + 1 || y < sc.boardY - 1 || y > sc.boardY + sc.boardW + 1) { continue; }
  var gx = Math.floor((x - sc.boardX) / sc.cell), gy = Math.floor((y - sc.boardY) / sc.cell);
  n++;
  if (n <= 20) {
    console.log('text "' + txt + '" @(' + x.toFixed(1) + ',' + y.toFixed(1) + ') → 格(' + gy + ',' + gx + ')');
  }
}
console.log('board 内 fillText 共 ' + n + ' 个');
