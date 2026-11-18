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
  load('js/game/photoAssets.js');
  load('js/game/photo.js');
  load('js/game/diffAssets.js');
  load('js/game/diff.js');
  load('js/game/bottle.js');
  load('js/game/cipher.js');
  load('js/game/rush.js');
  load('js/game/blocks.js');
  load('js/game/sudoku.js');
  load('js/game/mine.js');
  load('js/game/model.js');
  load('js/scenes/home.js');
  load('js/scenes/levels.js');
  load('js/scenes/diffpick.js');
  load('js/scenes/ruletip.js');
  BF.RuleTip.on = false;   // harness 默认关规则弹框（输入会被拦走）
  load('js/scenes/play.js');
  load('js/scenes/diff.js');
  load('js/scenes/bottle.js');
  load('js/scenes/cipher.js');
  load('js/scenes/rush.js');
  load('js/scenes/blocks.js');
  load('js/scenes/sudoku.js');
  load('js/scenes/mine.js');
  load('js/game/picross.js');
  load('js/scenes/picross.js');
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

  /* --- 首页卡片排版：每张卡的文案必须落在卡片内 ---
     窄屏/矮屏最容易压塌：iPhone 8（375×667）上卡片高度被压缩，
     标题字号随卡片高度缩放 + 装不下就整页可滚动，这里逐设备守住。
     首页重写为「三大类两列网格」后：cards2 = 当前可见卡（含几何），
     cardInternals(x,y,w,h) = 图标/文案/进度条的几何（替代旧 cardTextLayout）。 */
  {
    const hs = App.current;
    if (!hs || !hs.cards2 || !hs.cards2.length || typeof hs.cardInternals !== 'function') {
      errs.push(label + ' 首页没起来');
    } else {
      if (hs.minScroll > 0) { errs.push(label + ' 首页 minScroll 为正'); }
      const need = hs.contentH > hs.viewH + 0.5;
      if (need && hs.minScroll >= 0) { errs.push(label + ' 首页一屏装不下却没开滚动'); }
      if (!need && hs.minScroll !== 0) { errs.push(label + ' 首页装得下却开了滚动'); }
      for (let i = 0; i < hs.cards2.length; i++) {
        const c = hs.cards2[i];
        const g = hs.cardInternals(c.x, c.y, c.w, c.h);
        if (g.blockTop < c.y - 0.6 || g.blockBottom > c.y + c.h + 0.6) {
          errs.push(label + ' 首页卡片「' + c.title + '」文案溢出卡片');
        }
        if (hs.estTextWidth(c.title, g.titleSize) > g.textMax) {
          errs.push(label + ' 首页卡片「' + c.title + '」标题超宽');
        }
        if (hs.estTextWidth(c.sub, g.subSize) > g.textMax) {
          errs.push(label + ' 首页卡片「' + c.title + '」副标题超宽');
        }
        if (g.isz < 12) {
          errs.push(label + ' 首页卡片「' + c.title + '」图标被压成 ' + g.isz.toFixed(1) + 'px');
        }
        if (c.x < 0 || c.x + c.w > W + 0.5) {
          errs.push(label + ' 首页卡片「' + c.title + '」横向出屏');
        }
      }
      if (hs.minScroll < 0) {
        const s0 = hs.scroll;
        drag(W / 2, H * 0.72, W / 2, H * 0.28);
        frames(4);
        if (!(hs.scroll < s0)) { errs.push(label + ' 首页可滚动却拖不动（scroll=' + hs.scroll + '）'); }
        if (hs.scroll < hs.minScroll - 0.5) { errs.push(label + ' 首页拖动越界'); }
        hs.scroll = 0; hs.vel = 0; hs.dragging = false; hs.moved = 0; hs.press = null;
        frames(1);
      }
    }
  }

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

  /* --- 图片找不同也走一遍（独立场景、无棋盘分支，布局在窄屏最容易溢出） --- */
  App.go('levels', { game: 'diff' });
  frames(3);
  App.go('diff', { level: 1, game: 'diff' });
  frames(6);
  const df = App.current;
  if (!df || !df.rectA) { errs.push(label + ' 找不同场景没起来'); }
  else {
    // 两图必须完整落在屏幕内（窄屏最容易溢出）
    if (df.rectA.y < 0) { errs.push(label + ' 找不同 A 图溢出顶部: y=' + df.rectA.y); }
    if (df.rectB.y + df.rectB.h > H) { errs.push(label + ' 找不同 B 图溢出底部: ' + (df.rectB.y + df.rectB.h) + '/' + H); }
    for (let bi = 0; bi < df.btns.length; bi++) {
      const b = df.btns[bi];
      if (b.y + b.h > H) { errs.push(label + ' 找不同底部按钮溢出: ' + (b.y + b.h) + '/' + H); }
    }
    // 点完所有差异 → 过关 → 重玩
    const dArr = df.puzzle.diffs;
    for (let di = 0; di < dArr.length; di++) {
      const d = dArr[di];
      tap(df.rectB.x + (d.u + d.uw / 2) * df.rectB.w, df.rectB.y + (d.v + d.vh / 2) * df.rectB.h);
    }
    frames(20);
    if (!df.win) { errs.push(label + ' 找不同第1关没通关'); }
    else {
      const ob4 = df.overlayLayout();
      tap(ob4.again.x + ob4.again.w / 2, ob4.again.y + ob4.again.h / 2);
      frames(6);
      if (df.win) { errs.push(label + ' 找不同「重玩」无效'); }
      if (df.foundCount !== 0) { errs.push(label + ' 找不同「重玩」后进度没清空: ' + df.foundCount); }
    }
    // 提示 / 重来 两个按钮也点一遍
    ['hint', 'reset'].forEach(function (k) { df.doAction(k); frames(2); });
    frames(4);
  }

  /* --- 「先选难度，再进游戏」首屏（rush / diff / blocks 共用 BF.DiffPick） ---
     窄屏最容易在这里出事：找不同有 6 张档卡，卡片一溢出就会压住「查看全部关卡」。
     这里逐款验几何 + 点一张档卡能真进游戏。 */
  [['rush', 4], ['diff', 6], ['blocks', 4]].forEach(function (pg) {
    App.go(pg[0], { pickDiff: true, game: pg[0] });
    frames(4);
    const pk = App.current;
    if (!pk || pk.pickDiff !== true) { errs.push(label + ' ' + pg[0] + ' 难度首屏没起来'); return; }
    if (!pk.pickCards || pk.pickCards.length !== pg[1]) {
      errs.push(label + ' ' + pg[0] + ' 难度首屏应有 ' + pg[1] + ' 张档卡，实际 ' +
        (pk.pickCards ? pk.pickCards.length : 0));
      return;
    }
    let prevBottom = -1;
    for (let ci = 0; ci < pk.pickCards.length; ci++) {
      const c = pk.pickCards[ci];
      if (c.y < prevBottom - 0.5) { errs.push(label + ' ' + pg[0] + ' 档卡重叠 @' + ci); }
      if (c.x < 0 || c.x + c.w > W + 0.5) { errs.push(label + ' ' + pg[0] + ' 档卡横向出屏 @' + ci); }
      if (c.y + c.h > pk.pickAll.y + 0.5) {
        errs.push(label + ' ' + pg[0] + ' 档卡压住「查看全部关卡」@' + ci +
          ' (' + (c.y + c.h) + ' > ' + pk.pickAll.y + ')');
      }
      prevBottom = c.y + c.h;
    }
    if (pk.pickAll.y + pk.pickAll.h > H) {
      errs.push(label + ' ' + pg[0] + ' 「查看全部关卡」溢出底部');
    }
    // 点最后一张档卡 → 必须离开首屏并真正加载题目
    const last = pk.pickCards[pk.pickCards.length - 1];
    tap(last.x + last.w / 2, last.y + last.h / 2);
    frames(6);
    const after = App.current;
    if (after.pickDiff !== false) { errs.push(label + ' ' + pg[0] + ' 点档卡没离开难度首屏'); }
    if (!after.puzzle) { errs.push(label + ' ' + pg[0] + ' 点档卡后题目没加载'); }
    frames(4);
  });

  /* --- 扫雷也走一遍（独立场景、运行时生成棋盘，窄屏布局最易溢出） --- */
  App.go('mine', { pickDiff: true, game: 'mine' });
  frames(4);
  const mk = App.current;
  if (!mk || mk.pickDiff !== true) { errs.push(label + ' 扫雷难度首屏没起来'); }
  else if (mk.pickCards && mk.pickCards.length !== 4) {
    errs.push(label + ' 扫雷难度首屏应有 4 张档卡，实际 ' + (mk.pickCards ? mk.pickCards.length : 0));
  } else {
    for (let ci = 0; ci < mk.pickCards.length; ci++) {
      const c = mk.pickCards[ci];
      if (c.y < -0.5) { errs.push(label + ' 扫雷档卡溢出顶部 @' + ci); }
      if (c.x < 0 || c.x + c.w > W + 0.5) { errs.push(label + ' 扫雷档卡横向出屏 @' + ci); }
      if (c.y + c.h > mk.pickAll.y + 0.5) { errs.push(label + ' 扫雷档卡压住入口 @' + ci); }
    }
  }
  App.go('mine', { level: 1, game: 'mine' });
  frames(4);
  const mn = App.current;
  if (!mn || !mn.puzzle) { errs.push(label + ' 扫雷第1关没起来'); }
  else {
    const cxm = mn.boardX + mn.boardW / 2, cym = mn.boardY + mn.boardW / 2;
    tap(cxm, cym);                       // 首点翻格（运行时会生成棋盘）
    frames(6);
    if (!mn.started) { errs.push(label + ' 扫雷首点没生成棋盘'); }
    const mb = mn.actBtns.find(function (b) { return b.key === 'mark'; });
    tap(mb.x + mb.w / 2, mb.y + mb.h / 2);   // 标记模式
    frames(2);
    if (!mn.markMode) { errs.push(label + ' 扫雷标记模式没开'); }
    mn.doHint();                        // 提示推一格（保证不崩）
    frames(4);
    let boom = -1;
    for (let zi = 0; zi < mn.N; zi++) { if (mn.mines[zi]) { boom = zi; break; } }
    mn.revealAt(boom);                  // 触发踩雷失败路径
    frames(4);
    if (!mn.gameOver) { errs.push(label + ' 扫雷翻雷没触发失败'); }
  }
  frames(6);

  /* --- 数织也走一遍（线索槽 + 调色板 + 15×15 专家档，窄屏布局最易溢出） --- */
  App.go('picross', { pickDiff: true, game: 'picross' });
  frames(4);
  const pk = App.current;
  if (!pk || pk.pickDiff !== true) { errs.push(label + ' 数织难度首屏没起来'); }
  else if (pk.pickCards && pk.pickCards.length !== 4) {
    errs.push(label + ' 数织难度首屏应有 4 张档卡，实际 ' + (pk.pickCards ? pk.pickCards.length : 0));
  } else {
    for (let ci = 0; ci < pk.pickCards.length; ci++) {
      const c = pk.pickCards[ci];
      if (c.y < -0.5) { errs.push(label + ' 数织档卡溢出顶部 @' + ci); }
      if (c.x < 0 || c.x + c.w > W + 0.5) { errs.push(label + ' 数织档卡横向出屏 @' + ci); }
      if (c.y + c.h > pk.pickAll.y + 0.5) { errs.push(label + ' 数织档卡压住入口 @' + ci); }
    }
  }
  // 专家档 15×15：格子最小，线索槽最宽，是最容易挤爆的一档
  App.go('picross', { level: 31, game: 'picross' });
  frames(4);
  const pc = App.current;
  if (!pc || !pc.puzzle) { errs.push(label + ' 数织第31关没起来'); }
  else {
    if (pc.cell < 14) { errs.push(label + ' 数织专家档格子过小: ' + pc.cell); }
    if (pc.gridX < 0 || pc.gridX + pc.gridW > W + 0.5) {
      errs.push(label + ' 数织棋盘横向出屏: x=' + pc.gridX + ' w=' + pc.gridW + ' W=' + W);
    }
    if (pc.gridY + pc.gridW > pc.palY + 0.5) {
      errs.push(label + ' 数织棋盘压住调色板: 底=' + (pc.gridY + pc.gridW) + ' 调色板顶=' + pc.palY);
    }
    if (pc.boardX < 0 || pc.boardX + pc.boardW > W + 0.5) {
      errs.push(label + ' 数织底板横向出屏');
    }
    // 调色板不能出屏
    const items = pc.palItems();
    for (let ii = 0; ii < items.length; ii++) {
      if (items[ii].x < 0 || items[ii].x + 32 > W + 0.5) {
        errs.push(label + ' 数织调色板第 ' + ii + ' 项出屏');
      }
    }
    // 真实点一格 → 开始计时
    const cx0 = pc.gridX + pc.cell / 2, cy0 = pc.gridY + pc.cell / 2;
    tap(cx0, cy0);
    frames(3);
    if (!pc.started) { errs.push(label + ' 数织点格没开始计时'); }
    // 换工具：橡皮 / 标空，再长按一次（走长按分支）
    pc.sel = -1;
    tap(cx0 + pc.cell, cy0);
    frames(2);
    pc.sel = -2;
    tap(cx0 + pc.cell * 2, cy0);
    frames(2);
    input.down(cx0 + pc.cell * 3, cy0);
    frames(30);          // 超过 LONG_PRESS_MS
    input.up(cx0 + pc.cell * 3, cy0);
    frames(2);
    // 提示（含"提示完直接通关"的边界：这里只点一次，不会刚好通关）
    pc.doHint();
    frames(4);
    if (pc.hintsLeft !== 2) { errs.push(label + ' 数织提示没消耗次数'); }
    // 直接摆成通关态，走结算弹窗 + 下一关按钮。
    // ⚠️ 必须先把之前点的格子清掉：上面在 (0,0) 填过色，若那格在解里是空位，
    //    残留的填色会让 isSolved() 永远为假（"填错不通关"由 smoke 9f-2 覆盖）。
    for (let zi = 0; zi < pc.cells.length; zi++) {
      pc.st[zi] = (pc.cells[zi] >= 0) ? pc.cells[zi] : -1;
    }
    pc.afterFill();
    frames(4);
    if (!pc.win) { errs.push(label + ' 数织填满没触发通关'); }
    const obp = pc.overlayLayout();
    if (obp.card.x < 0 || obp.card.x + obp.card.w > W + 0.5) {
      errs.push(label + ' 数织结算弹窗横向出屏');
    }
    tap(obp.next.x + obp.next.w / 2, obp.next.y + obp.next.h / 2, 3);
    frames(4);
  }
  frames(6);

  /* --- 「玩法说明」弹框（BF.RuleTip）：窄屏下卡片/按钮/复选框不出屏、不压调色板 --- */
  BF.RuleTip.on = true;          // 本探针块专门测弹框，临时打开总开关
  App.go('picross', { level: 31, game: 'picross' });
  frames(4);
  const rt = App.current;
  if (!rt || !rt.showRule) { errs.push(label + ' 数织专家档首进没弹规则说明'); }
  else {
    const rc = rt.ruleCard, ro = rt.ruleOk, rk = rt.ruleCheck;
    if (rc.x < 0 || rc.x + rc.w > W + 0.5) { errs.push(label + ' 规则弹框横向出屏'); }
    if (rc.y < 0 || rc.y + rc.h > H + 0.5) { errs.push(label + ' 规则弹框纵向出屏'); }
    if (ro.x < rc.x || ro.x + ro.w > rc.x + rc.w) { errs.push(label + ' 规则弹框按钮超出卡片'); }
    if (rk.y + rk.h > ro.y) { errs.push(label + ' 规则弹框复选框压住按钮'); }
    if (rk.x < rc.x || rk.x + rk.w > rc.x + rc.w) { errs.push(label + ' 规则弹框复选框超出卡片'); }
    // 顶部动画演示块（数织专属）必须完整落在卡片内、且在规则文字上方
    const dm = rt.ruleDemo;
    if (!dm) { errs.push(label + ' 数织弹框缺少动画演示块 ruleDemo'); }
    else {
      if (dm.x < rc.x || dm.x + dm.w > rc.x + rc.w) { errs.push(label + ' 演示块横向超出卡片'); }
      if (dm.y < rc.y || dm.y + dm.h > rc.y + rc.h) { errs.push(label + ' 演示块纵向超出卡片'); }
      if (dm.y + dm.h > rt.ruleRulesTop + 0.5) { errs.push(label + ' 演示块压住规则文字'); }
    }
    // 「?」按钮不能压返回 / 标题（picross 标题左对齐，? 在提示按钮左边）
    const qbtn = BF.RuleTip.btn(rt);
    if (qbtn.x + qbtn.w > rt.hintBtn.x) { errs.push(label + ' 「?」按钮压住提示按钮'); }
    if (qbtn.x < rt.back.x + rt.back.w) { errs.push(label + ' 「?」按钮压住返回按钮'); }
    // 点遮罩不关；点「开始游戏」才关，关后能正常点格
    tap(4, H - 4);
    frames(2);
    if (!rt.showRule) { errs.push(label + ' 点遮罩竟然关掉了规则弹框'); }
    tap(ro.x + ro.w / 2, ro.y + ro.h / 2);
    frames(3);
    if (rt.showRule) { errs.push(label + ' 点开始游戏没关掉规则弹框'); }
    const qx = rt.gridX + rt.cell / 2, qy = rt.gridY + rt.cell / 2;
    tap(qx, qy);
    frames(3);
    if (!rt.started) { errs.push(label + ' 关掉弹框后点格没开始计时'); }
    // 勾了「不再提示」再进同关：不应再弹
    BF.RuleTip.enter(rt, { force: true });
    frames(2);
    tap(rt.ruleCheck.x + rt.ruleCheck.w / 2, rt.ruleCheck.y + rt.ruleCheck.h / 2);
    tap(rt.ruleOk.x + rt.ruleOk.w / 2, rt.ruleOk.y + rt.ruleOk.h / 2);
    frames(3);
    App.go('picross', { level: 31, game: 'picross' });
    frames(4);
    if (App.current.showRule) { errs.push(label + ' 勾过不再提示后仍弹规则弹框'); }
  }
  BF.RuleTip.on = false;         // 还原，避免影响后面的探针
  frames(6);

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
  load('js/game/photoAssets.js'); load('js/game/photo.js');
  load('js/game/diffAssets.js'); load('js/game/diff.js');
  load('js/game/bottle.js'); load('js/game/cipher.js');
  load('js/game/rush.js'); load('js/game/blocks.js');
  load('js/game/sudoku.js');
  load('js/game/mine.js');
  load('js/game/model.js'); load('js/scenes/home.js'); load('js/scenes/levels.js');
  load('js/scenes/diffpick.js');
  load('js/scenes/ruletip.js');
  BF.RuleTip.on = false;   // harness 默认关规则弹框（输入会被拦走）
  load('js/scenes/play.js'); load('js/scenes/diff.js');
  load('js/scenes/bottle.js'); load('js/scenes/cipher.js');
  load('js/scenes/rush.js'); load('js/scenes/blocks.js');
  load('js/scenes/sudoku.js');
  load('js/scenes/mine.js');
  load('js/game/picross.js');
  load('js/scenes/picross.js');
  load('js/app.js');

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
