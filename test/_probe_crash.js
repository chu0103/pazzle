/**
 * _probe_crash.js —— 一次性探针：按真机各种屏幕尺寸跑完整流程，抓运行时异常
 * 用法：node test/_probe_crash.js
 *
 * 背景：真机截图里出现 app.js renderError() 画的 120px 红条，
 * 说明 render/update 抛了未捕获异常。这里按尺寸矩阵扫，定位触发条件。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function fakeCtx() {
  const noop = function () {};
  const grad = { addColorStop: function () {} };
  const target = {
    save: function () { ctxDepth++; if (ctxDepth > ctxMaxDepth) { ctxMaxDepth = ctxDepth; } },
    restore: function () { ctxDepth--; if (ctxDepth < 0) { ctxUnderflow++; ctxDepth = 0; } },
    fillText: function (t) { capturedTexts.push(String(t)); },
    createLinearGradient: function () { return grad; },
    createRadialGradient: function () { return grad; },
    measureText: function (t) { return { width: String(t).length * 7 }; }
  };
  return new Proxy(target, {
    get: function (t, k) { return k in t ? t[k] : noop; },
    set: function (t, k, v) { t[k] = v; return true; }
  });
}

let ctxDepth = 0, ctxMaxDepth = 0, ctxUnderflow = 0;
let capturedTexts = [];   // 记录 fillText 的内容，用来验证"出错了文字真的画得出来"

/** 用给定屏幕尺寸跑一遍完整流程，返回捕获到的异常列表 */
function runScreen(W, H, dpr, label) {
  const errs = [];
  const store = {};
  const sandbox = {
    console: { log: function () {}, error: function (e) { errs.push(String(e && e.stack || e)); }, warn: function () {} },
    Math, Date, JSON, Object, Array, String, Number, Boolean, Error,
    setTimeout, parseInt, isNaN, Proxy
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  function load(rel) {
    const code = fs.readFileSync(path.join(root, rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }

  const ctx = fakeCtx();
  ctxDepth = 0; ctxMaxDepth = 0; ctxUnderflow = 0;
  const input = {};
  // 关键：不启用 app.js 自带的 try/catch 掩盖异常 —— 用一个"裸" platform 先手工跑
  load('js/core/ns.js');
  load('js/core/palette.js');
  load('js/core/draw.js');

  const BF = sandbox.BF;
  BF.platform = {
    isMiniGame: true, ready: true,
    canvas: { width: Math.floor(W * dpr), height: Math.floor(H * dpr) },
    ctx: ctx, width: W, height: H, dpr: dpr,
    safeTop: 0, safeBottom: 0,
    now: function () { return Date.now(); },
    requestFrame: function () {},
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

  const App = sandbox.BF.App;
  let leaks = 0;
  function frames(n) {
    for (let i = 0; i < n; i++) {
      const c = App.current;
      try { if (c.update) { c.update(16); } } catch (e) { errs.push('[update ' + label + '] ' + e.message); }
      const before = ctxDepth;
      try { c.render(ctx); } catch (e) { errs.push('[render ' + label + '] ' + e.message + ' @ ' + String(e.stack || '').split('\n')[1]); }
      if (ctxDepth !== before) { leaks++; ctxDepth = before; }
    }
  }
  function tap(x, y) {
    input.down(x, y);
    frames(2);
    input.up(x, y);
  }
  function drag(x0, y0, x1, y1) {
    input.down(x0, y0);
    for (let i = 1; i <= 6; i++) { input.move(x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6); }
    input.up(x1, y1);
  }

  function solve(sc) {
    const m = sc.model, L = sc.L;
    m.puzzle.order.forEach(function (id) {
      const p = m.pieces[id];
      if (p.placed) { return; }
      const cx = p.px + p.w * L.cell * p.scale / 2;
      const cy = p.py + p.h * L.cell * p.scale / 2;
      drag(cx, cy, L.inner.x + (p.solX + p.w / 2) * L.cell, L.inner.y + (p.solY + p.h / 2) * L.cell);
      frames(22);
    });
  }

  frames(3);
  // 首页 → 方块拼图 → 逐关玩到第 8 关，每关都走：通关 → 重玩 → 再通关 → 下一关
  App.go('levels', { game: 'block' });
  frames(3);
  for (let lv = 1; lv <= 8; lv++) {
    App.go('play', { level: lv, game: 'block' });
    frames(6);
    const sc = App.current;
    solve(sc);
    frames(20);
    if (!sc.win) { errs.push(label + ' 第' + lv + '关没通关'); continue; }
    const ob = sc.overlayLayout();
    tap(ob.again.x + ob.again.w / 2, ob.again.y + ob.again.h / 2);   // 重玩
    frames(6);
    if (sc.win) { errs.push(label + ' 第' + lv + '关「重玩」无效'); }
    solve(sc);
    frames(20);
    const ob2 = sc.overlayLayout();
    tap(ob2.next.x + ob2.next.w / 2, ob2.next.y + ob2.next.h / 2);   // 下一关
    frames(6);
    if (sc.level !== lv + 1) { errs.push(label + ' 第' + lv + '关「下一关」无效 -> ' + sc.level); }
    // 顺手把底部三个按钮也点一遍
    ['undo', 'reset', 'hint'].forEach(function (k) { sc.doAction(k); frames(2); });
    frames(4);
  }

  /* --- 逻辑拼图也走一遍（固定块 + 托盘，绘制分支和方块拼图不同） --- */
  App.go('play', { level: 1, game: 'logic' });
  frames(6);
  const lg = App.current;
  if (lg.skin !== 'logic') { errs.push(label + ' 逻辑拼图没切到 logic 皮肤'); }
  solve(lg);
  frames(20);
  if (!lg.win) { errs.push(label + ' 逻辑拼图第1关没通关'); }
  else {
    const ob3 = lg.overlayLayout();
    tap(ob3.again.x + ob3.again.w / 2, ob3.again.y + ob3.again.h / 2);
    frames(6);
    if (lg.win) { errs.push(label + ' 逻辑拼图「重玩」无效'); }
    if (lg.model.filled() !== 6) { errs.push(label + ' 逻辑拼图「重玩」后固定块丢失: ' + lg.model.filled()); }
  }
  frames(10);

  /* --- 错误面板可见性：故意让 render 抛错，文字必须真的画出来 --- */
  capturedTexts = [];
  const sc0 = App.current;
  const origRender = sc0.render;
  sc0.render = function () { throw new Error('探针故意抛错'); };
  let bannerErr = null;
  try { App.drawErrorBanner(ctx, new Error('探针故意抛错')); } catch (e) { bannerErr = e; }
  sc0.render = origRender;
  if (bannerErr) {
    errs.push(label + ' 错误面板自身抛错: ' + bannerErr.message);
  } else {
    const hasTitle = capturedTexts.some(function (t) { return t.indexOf('运行异常') >= 0; });
    const hasMsg = capturedTexts.some(function (t) { return t.indexOf('探针故意抛错') >= 0; });
    if (!hasTitle || !hasMsg) {
      errs.push(label + ' 错误面板没画出可读文字（真实异常时用户只会看到一条无字色块）');
    }
  }

  if (leaks > 0) { errs.push(label + ' canvas save/restore 泄漏 ' + leaks + ' 次'); }
  if (ctxUnderflow > 0) { errs.push(label + ' restore 多于 save: ' + ctxUnderflow + ' 次'); }
  if (ctxDepth !== 0) { errs.push(label + ' 结束时状态栈残留 ' + ctxDepth + ' 层'); }
  return errs;
}

/* ---------- 容错验证：画布状态栈被打爆时，必须能自愈而不是永久卡死 ---------- */
function runResilience(W, H, dpr) {
  const errs = [];
  const store = {};
  const sandbox = {
    console: { log: function () {}, error: function () {}, warn: function () {} },
    Math, Date, JSON, Object, Array, String, Number, Boolean, Error,
    setTimeout, parseInt, isNaN, Proxy
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  function load(rel) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
  }

  const PENDING = [];
  const LIMIT = 40;          // 模拟真机有限的状态栈
  let depth = 0;
  const grad = { addColorStop: function () {} };
  const target = {
    // 注意：栈满时 save() 失败**不能**改变栈深 —— 否则失败的 save 自己也会加深栈，
    // 深度只增不减，recoverCanvas 再怎么弹栈也追不上（第一次跑就是这么卡住的）。
    save: function () { if (depth >= LIMIT) { throw new Error('画布状态栈溢出（模拟真机）'); } depth++; },
    restore: function () { if (depth > 0) { depth--; } },
    createLinearGradient: function () { return grad; },
    createRadialGradient: function () { return grad; },
    // 显式声明为 undefined：模拟"老机型没有 ctx.reset"，逼代码走逐层弹栈那条路。
    // 不加这一行的话，下面 Proxy 会给任何未知属性都返回空函数，
    // ctx.reset 被判成"存在"，结果走了 reset 分支却是空操作 —— 自愈看起来失败。
    reset: undefined,
    measureText: function (t) { return { width: String(t).length * 7 }; }
  };
  const ctx = new Proxy(target, {
    get: function (t, k) { return k in t ? t[k] : function () {}; },
    set: function (t, k, v) { t[k] = v; return true; }
  });

  load('js/core/ns.js'); load('js/core/palette.js'); load('js/core/draw.js');
  const BF = sandbox.BF;
  BF.platform = {
    isMiniGame: true, ready: true,
    canvas: { width: W * dpr, height: H * dpr }, ctx: ctx,
    width: W, height: H, dpr: dpr, safeTop: 0, safeBottom: 0,
    now: function () { return Date.now(); },
    requestFrame: function (cb) { PENDING.push(cb); },
    getStorage: function (k, d) { return store[k] === undefined ? d : store[k]; },
    setStorage: function (k, v) { store[k] = v; },
    vibrate: function () {}, bindPointer: function () {}
  };
  load('js/core/save.js'); load('js/game/generator.js'); load('js/game/logic.js');
  load('js/game/model.js'); load('js/scenes/home.js'); load('js/scenes/levels.js');
  load('js/scenes/play.js'); load('js/app.js');

  const App = sandbox.BF.App;
  function pump(n) {
    for (let i = 0; i < n; i++) {
      if (!PENDING.length) { errs.push('主循环停止排帧（第 ' + i + ' 帧）—— 真机上这就是永久卡死'); return i; }
      const f = PENDING.shift();
      try { f(); } catch (e) { errs.push('frame() 抛错逃逸出主循环: ' + e.message); return i; }
    }
    return n;
  }

  App.go('play', { level: 1, game: 'block' });
  pump(5);

  // 1) 人为制造泄漏：包一层 render，进出都 save 却不 restore
  const sc = App.current;
  const orig = sc.render;
  sc.render = function (c) { c.save(); c.save(); orig.call(sc, c); };
  pump(40);
  if (App.err === 0) { errs.push('状态栈已溢出，但 err 仍为 0（异常没被兜住）'); }
  if (!PENDING.length) { errs.push('溢出后主循环停了 —— 这就是用户看到的「卡住」'); }

  // 2) 撤掉泄漏源后必须能自己缓过来
  sc.render = orig;
  pump(40);
  if (App.err !== 0) { errs.push('泄漏源已移除但 err 未归零（' + App.err + '），无法自愈'); }
  if (!PENDING.length) { errs.push('自愈阶段主循环停了'); }
  return errs;
}

/* 常见真机逻辑尺寸（windowWidth x windowHeight） */
const SCREENS = [
  [375, 667, 2, 'iPhone SE/8'],
  [375, 812, 3, 'iPhone X/12mini'],
  [375, 834, 3, 'iPhone 13 mini 类比(截图反推)'],
  [390, 844, 3, 'iPhone 14'],
  [393, 852, 3, 'iPhone 14 Pro'],
  [428, 926, 3, 'iPhone 14 Plus'],
  [414, 896, 2, 'iPhone XR'],
  [360, 780, 3, 'Android 常见'],
  [360, 800, 3, 'Android 常见2'],
  [412, 915, 2.625, 'Android Pixel'],
  [320, 568, 2, '老机型 320x568'],
  [540, 960, 3, '大屏 Android']
];

let total = 0;
SCREENS.forEach(function (s) {
  const errs = runScreen(s[0], s[1], s[2], s[3]);
  total += errs.length;
  if (errs.length) {
    console.log('❌ ' + s[3] + ' (' + s[0] + 'x' + s[1] + ' dpr' + s[2] + ') —— ' + errs.length + ' 个问题');
    const uniq = Array.from(new Set(errs)).slice(0, 6);
    uniq.forEach(function (e) { console.log('     ' + e); });
  } else {
    console.log('✅ ' + s[3] + ' (' + s[0] + 'x' + s[1] + ' dpr' + s[2] + ')');
  }
});
console.log('\n合计问题数: ' + total);

/* ---------- 容错：状态栈被打爆也不能永久卡死 ---------- */
console.log('\n--- 容错验证（模拟真机画布状态栈上限 40 层） ---');
const rErr = runResilience(390, 844, 3);
if (rErr.length) {
  rErr.forEach(function (e) { console.log('❌ ' + e); });
} else {
  console.log('✅ 栈溢出被兜住、主循环未断、移除泄漏源后自动恢复到 err=0');
}
