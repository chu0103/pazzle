/**
 * _verify_picross_logic.js —— 数织「交互层」验证（node tools/_verify_picross_logic.js）
 *
 * 用「假 canvas + 假平台 + 假 Save」把 picross 场景真实跑起来，验证交互逻辑（不是像素）：
 *   1. 四档代表关（1/11/21/31）：enter → 几何不溢出/不重叠 → render 不抛且 save/restore 配平；
 *   2. 真实点击通关：调色板选色 + 点格 → 自动通关 → 星级/最佳用时写存档 + 断点清除；
 *   3. 宽松判错：填错立刻标错（errorCount/isWrong）但不失败；同色再点=擦除；
 *      橡皮 / 标空✕ 两个工具；往解的空格填色 → 永不通关，擦掉才通关；
 *   4. 提示：每关 3 次、每次恰好填 1 个正确格、第 4 次只弹 toast；
 *   5. 重置：清空盘面但**计时不清零**（防刷 ★）；
 *   6. 长按 350ms = 标空；滑出格外 = 取消本次点击；
 *   7. 断点续玩：中途退出再进同一关 → 恢复盘面/计时/提示次数，且不串关；
 *   8. 难度自选首屏：4 张档卡几何合法、点档卡进该档第一关、返回回首页、查看全部关卡；
 *   9. 每日挑战：困难档 12×12、可通关、写 daily 存档；
 *   10. 小屏几何（320×568）：棋盘/调色板不出屏、不互压；
 *   11. 线索渲染几何：行/列线索的数字个数与 cluesFor 一致、全部落在线索槽内
 *       （不压棋盘）、颜色与 PALETTE 对应、阅读顺序 = 线索顺序；
 *       网格线 n+1 条通栏、n≥10 时每 5 格加粗。
 */
(function () {
  var path = require('path');
  var root = path.resolve(__dirname, '..');
  global.BF = {};
  require(path.join(root, 'js/core/ns.js'));

  var depth = 0;
  var D = new Proxy({}, { get: function (t, p) {
    if (p === 'FONT') { return 'sans'; }
    return function () { return undefined; };
  } });
  BF.draw = D;
  BF.theme = {
    text: '#222', textSub: '#888', bg: '#eee', bgTop: '#fff', accent: '#3a6fbf',
    accentDeep: '#2f5aa0', gold: '#f5b', ok: '#2a9', warn: '#c9463f', scrim: '#0008',
    panel: '#fff', panelEdge: '#ddd', slot: '#eee', slotEdge: '#ccc', slotShadow: '#0001',
    boardFrameTop: '#ccc', boardFrameBottom: '#bbb', boardInner: '#f5f5f5',
    tray: '#fafafa', shadow: '#0001'
  };
  var ctx = new Proxy({}, {
    get: function (t, p) {
      if (p === 'save') { return function () { depth++; }; }
      if (p === 'restore') { return function () { depth--; }; }
      if (p === 'measureText') { return function () { return { width: 10 }; }; }
      if (p === 'createLinearGradient' || p === 'createRadialGradient') {
        return function () { return { addColorStop: function () {} }; };
      }
      return function () {};
    },
    set: function () { return true; }
  });

  /* ---- 假 Save（带 extra 扩展数据 + 落盘计数） ---- */
  var store = { games: {}, daily: { key: '', cleared: false, stars: 0 } };
  var flushes = 0;
  function bucket(g) {
    if (!store.games[g]) { store.games[g] = { cleared: {}, unlocked: 1, extra: {} }; }
    return store.games[g];
  }
  BF.Save = {
    data: store,
    load: function () {}, flush: function () { flushes++; },
    bucket: bucket,
    extraOf: function (g) {
      var b = bucket(g);
      if (!b.extra) { b.extra = {}; }
      return b.extra;
    },
    putExtra: function (g, k, v) { this.extraOf(g)[k] = v; this.flush(); },
    delExtra: function (g, k) { delete this.extraOf(g)[k]; this.flush(); },
    isCleared: function (g, n) { return !!bucket(g).cleared[String(n)]; },
    starsOf: function (g, n) { return bucket(g).cleared[String(n)] || 0; },
    unlockedOf: function (g) { return bucket(g).unlocked; },
    clear: function (g, n, s) {
      var b = bucket(g), k = String(n);
      if (!b.cleared[k] || b.cleared[k] < s) { b.cleared[k] = s; }
      if (n + 1 > b.unlocked) { b.unlocked = n + 1; }
      this.flush();
    },
    clearedCount: function (g) { return Object.keys(bucket(g).cleared).length; },
    totalStars: function (g) {
      var s = 0, c = bucket(g).cleared;
      for (var k in c) { if (c.hasOwnProperty(k)) { s += c[k]; } }
      return s;
    },
    clearDaily: function (s) { store.daily = { key: 'x', cleared: true, stars: s }; this.flush(); },
    isDailyDoneToday: function () { return false; },
    countAll: function () { return 0; }, starsAll: function () { return 0; },
    resetAll: function () { store = { games: {}, daily: {} }; }
  };

  require(path.join(root, 'js/core/palette.js'));
  require(path.join(root, 'js/core/draw.js'));
  require(path.join(root, 'js/core/save.js'));
  BF.Save = BF.Save;   // 保留上面的假 Save（真 save.js 检测到已存在会跳过）
  require(path.join(root, 'js/game/picross.js'));
  require(path.join(root, 'js/scenes/diffpick.js'));
  require(path.join(root, 'js/scenes/ruletip.js'));
  BF.RuleTip.on = false;   // harness 默认关掉规则弹框（enter 后输入会被拦走）
  require(path.join(root, 'js/scenes/picross.js'));

  /* ---- 假平台：now() 可推进，用来驱动长按判定 ---- */
  var nowT = 1000;
  BF.platform = {
    width: 390, height: 844, safeTop: 44, safeBottom: 34, dpr: 2,
    now: function () { return nowT; }, vibrate: function () {}, requestFrame: function () {},
    bindPointer: function () {}, ctx: ctx
  };

  var Gen = BF.PicrossGen;
  var meta = BF.games.picross;
  var SW = 32;    // 与场景模块里的调色板色块边长保持一致
  var app = { go: function (name, params) { app.lastGo = { name: name, params: params }; } };
  var issues = [];
  function ok(cond, msg) { if (!cond) { issues.push(msg); } }

  function newScene() { return new BF.ScenePicross(app); }
  /** 每节开头清空存档：断点是 per-level 持久状态，不隔离会让上一节的残留盘面
   *  灌进下一节（restoreProgress 会直接恢复盘面），断言就失去意义了。 */
  function fresh() {
    store.games = {};
    store.daily = { key: '', cleared: false, stars: 0 };
  }
  function frame(sc, n) {
    n = n || 1;
    for (var i = 0; i < n; i++) { nowT += 16; sc.update(16); sc.render(ctx); }
  }
  function tap(sc, x, y) { sc.onDown(x, y); sc.onUp(x, y); }
  function cellCenter(sc, idx) {
    return {
      x: sc.gridX + (idx % sc.n) * sc.cell + sc.cell / 2,
      y: sc.gridY + (((idx / sc.n) | 0)) * sc.cell + sc.cell / 2
    };
  }
  /** 调色板上某个工具（颜色序号 / -1 橡皮 / -2 标空）的中心 */
  function palCenter(sc, sel) {
    var items = sc.palItems();
    for (var i = 0; i < items.length; i++) {
      if (items[i].sel === sel) { return { x: items[i].x + SW / 2, y: sc.palY + SW / 2 }; }
    }
    return null;
  }
  /** 选色 + 点格（真实点击链路） */
  function fillCell(sc, idx, color) {
    var p = palCenter(sc, color);
    tap(sc, p.x, p.y);
    var c = cellCenter(sc, idx);
    tap(sc, c.x, c.y);
  }
  function actBtn(sc, key) {
    var r = key === 'hint' ? sc.hintBtn : (key === 'reset' ? sc.resetBtn : sc.back);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }
  /** 按标准解把整盘点满（解里的空位不点） */
  function solveByTaps(sc) {
    for (var i = 0; i < sc.cells.length; i++) {
      if (sc.cells[i] < 0 || sc.st[i] === sc.cells[i]) { continue; }
      fillCell(sc, i, sc.cells[i]);
    }
  }

  /* ---------- 1. 四档代表关：几何 + 渲染 ---------- */
  (function () {
    fresh();
    [1, 11, 21, 31].forEach(function (n) {
      var sc = newScene();
      sc.enter({ level: n, game: 'picross' });
      frame(sc, 2);
      ok(!sc.pickDiff, 'L' + n + ' 不应停在难度首屏');
      ok(sc.n === Gen.TIER_SIZE[(n - 1) / 10 | 0], 'L' + n + ' 尺寸不对');
      ok(!sc.started, 'L' + n + ' 未点格不应开始计时');
      var allBlank = true;
      for (var i = 0; i < sc.st.length; i++) { if (sc.st[i] !== -1) { allBlank = false; } }
      ok(allBlank, 'L' + n + ' 初始盘面应全未知');
      // 棋盘不出屏、不压调色板
      ok(sc.gridX >= 0 && sc.gridY >= sc.boardY + sc.colClueH, 'L' + n + ' 棋盘越界');
      ok(sc.boardX >= 0 && sc.boardX + sc.boardW <= BF.platform.width, 'L' + n + ' 棋盘左右出屏');
      ok(sc.boardY >= sc.headerY + sc.headerH, 'L' + n + ' 棋盘压到标题');
      ok(sc.gridY + sc.gridW <= sc.palY, 'L' + n + ' 棋盘压到调色板');
      ok(sc.cell >= 14 && sc.cell <= 46, 'L' + n + ' 格子边长越界：' + sc.cell);
      ok(sc.clueSize >= 8 && sc.clueSize <= 12, 'L' + n + ' 线索字号越界：' + sc.clueSize);
      // 调色板不出屏、色块数 = 颜色数 + 橡皮 + 标空
      ok(sc.palX >= 0 && sc.palX + sc.palW <= BF.platform.width, 'L' + n + ' 调色板左右出屏');
      ok(sc.palY + SW <= BF.platform.height - BF.platform.safeBottom + 1, 'L' + n + ' 调色板出安全区');
      ok(sc.palItems().length === sc.colors.length + 2, 'L' + n + ' 调色板工具数不对');
      var hasEraser = false, hasMark = false;
      sc.palItems().forEach(function (it) {
        if (it.sel === -1) { hasEraser = true; }
        if (it.sel === -2) { hasMark = true; }
      });
      ok(hasEraser && hasMark, 'L' + n + ' 调色板应含橡皮与标空');
      ok(sc.hintsLeft === 3, 'L' + n + ' 每关应有 3 次提示');
      // 调色板剩余格数：初始 = 解里该色总格数；橡皮/标空没有剩余数
      // ⚠️ 回归护栏：曾经 used[s] 写成布尔标志 → left = 1 - 已填，快照里显示 -5
      var tally = {};
      for (var q2 = 0; q2 < sc.cells.length; q2++) {
        if (sc.cells[q2] >= 0) { tally[sc.cells[q2]] = (tally[sc.cells[q2]] || 0) + 1; }
      }
      sc.colors.forEach(function (c) {
        ok(sc.remainCount(c) === tally[c],
          'L' + n + ' 色 ' + c + ' 初始剩余数应为 ' + tally[c] + '，实际 ' + sc.remainCount(c));
      });
      ok(sc.remainCount(-1) === 0 && sc.remainCount(-2) === 0, 'L' + n + ' 橡皮/标空不应有剩余数');
      ok(depth === 0, 'L' + n + ' render 后 save/restore 未配平（净泄漏 ' + depth + '）');
    });
  })();

  /* ---------- 2. 真实点击通关 ---------- */
  (function () {
    fresh();
    var sc = newScene();
    sc.enter({ level: 1, game: 'picross' });
    frame(sc, 2);
    // 先填一格、跑几帧，让计时真的走起来（模拟真实游玩；否则通关瞬间 elapsed 还是 0）
    var first = -1;
    for (var i = 0; i < sc.cells.length; i++) { if (sc.cells[i] >= 0) { first = i; break; } }
    fillCell(sc, first, sc.cells[first]);
    frame(sc, 10);
    solveByTaps(sc);
    ok(!!sc.win, '按标准解点完应通关');
    ok(sc.win.stars >= 1 && sc.win.stars <= 3, '星级应在 1~3，实际 ' + (sc.win && sc.win.stars));
    ok(sc.errorCount() === 0, '通关时不应有错格');
    ok(BF.Save.isCleared('picross', 1), '通关后应写入存档');
    var best = BF.Save.extraOf('picross').best;
    ok(best && typeof best['1'] === 'number', '通关后应记录最佳用时');
    ok(!(BF.Save.extraOf('picross').prog || {})['1'], '通关后应清掉该关断点');
    ok(sc.elapsed > 0, '通关后应有计时');
    // 通关后计时冻结
    var frozen = sc.elapsed;
    frame(sc, 10);
    ok(sc.elapsed === frozen, '通关后计时应冻结，实际 ' + sc.elapsed + ' → ' + frozen);
    frame(sc, 4);
    // 「下一关」→ 第 2 关
    var ob = sc.overlayLayout();
    tap(sc, ob.next.x + ob.next.w / 2, ob.next.y + ob.next.h / 2);
    ok(sc.level === 2 && !sc.win, '点「下一关」应进第 2 关');
    // 「再玩一次」→ 同一关重来
    var sc2 = newScene();
    sc2.enter({ level: 2, game: 'picross' });
    frame(sc2, 2);
    solveByTaps(sc2);
    ok(!!sc2.win, '第 2 关应可通关');
    var ob2 = sc2.overlayLayout();
    tap(sc2, ob2.again.x + ob2.again.w / 2, ob2.again.y + ob2.again.h / 2);
    ok(sc2.level === 2 && !sc2.win && sc2.elapsed === 0, '「再玩一次」应重置同一关');
  })();

  /* ---------- 3. 宽松判错 + 工具 ---------- */
  (function () {
    fresh();
    // 用第 3 关（苹果：3 色 + 9 个空位）——第 1 关爱心是单色，没有"填错色"可言
    var sc = newScene();
    sc.enter({ level: 3, game: 'picross' });
    frame(sc, 2);
    ok(sc.colors.length >= 2, 'L3 应至少有 2 色');
    // 3a. 填错：立刻能算出错、但不失败、可随时改
    var i = -1, wrongColor = -1;
    for (var k = 0; k < sc.cells.length; k++) {
      if (sc.cells[k] >= 0) { i = k; break; }
    }
    for (k = 0; k < sc.colors.length; k++) {
      if (sc.colors[k] !== sc.cells[i]) { wrongColor = sc.colors[k]; break; }
    }
    ok(wrongColor >= 0, 'L3 应能找到错误颜色');
    fillCell(sc, i, wrongColor);
    ok(!sc.win, '填错不应通关');
    ok(sc.errorCount() === 1 && sc.isWrong(i), '填错应计入失误，实际 ' + sc.errorCount());
    ok(sc.started, '点格应开始计时');
    // 剩余格数只减"填对"的：填错不该让该色剩余数变少
    var totalOf = 0;
    for (var q = 0; q < sc.cells.length; q++) { if (sc.cells[q] === sc.cells[i]) { totalOf++; } }
    ok(sc.remainCount(sc.cells[i]) === totalOf,
      '填错不应减少该色剩余数（' + sc.remainCount(sc.cells[i]) + ' ≠ ' + totalOf + '）');
    ok(sc.remainCount(wrongColor) >= 0, '剩余格数不应为负');
    // 同色再点 = 擦掉（这里点是错色，再点一次错色应擦除）
    var p = cellCenter(sc, i);
    tap(sc, p.x, p.y);
    ok(sc.st[i] === -1 && sc.errorCount() === 0, '再点同一颜色应擦除');
    // 3b. 橡皮
    fillCell(sc, i, wrongColor);
    var er = palCenter(sc, -1);
    tap(sc, er.x, er.y);
    ok(sc.sel === -1, '点橡皮应切换到橡皮');
    tap(sc, p.x, p.y);
    ok(sc.st[i] === -1, '橡皮应清掉该格');
    // 3c. 标空 ✕（可反复切换）
    var mk = palCenter(sc, -2);
    tap(sc, mk.x, mk.y);
    ok(sc.sel === -2, '点标空应切换到标空');
    tap(sc, p.x, p.y);
    ok(sc.st[i] === -2, '标空工具应打 ✕');
    tap(sc, p.x, p.y);
    ok(sc.st[i] === -1, '再点一次应取消 ✕');
    // 3d. 往解的空格填色 → 永不通关；擦掉才通关
    // （口径：解里的空格留空即算对，✕ 可有可无；但**填了色**就永远差一步）
    var empty = -1, last = -1;
    for (k = 0; k < sc.cells.length; k++) {
      if (sc.cells[k] < 0) { if (empty < 0) { empty = k; } }
      else { last = k; }
    }
    ok(empty >= 0 && last >= 0, 'L3 应同时有填色格与空位');
    for (k = 0; k < sc.cells.length; k++) {
      if (sc.cells[k] >= 0 && k !== last && sc.st[k] !== sc.cells[k]) { fillCell(sc, k, sc.cells[k]); }
    }
    fillCell(sc, empty, sc.colors[0]);
    ok(!sc.win && sc.errorCount() === 1, '解的空格被填色不应通关');
    fillCell(sc, last, sc.cells[last]);
    ok(!sc.win && sc.errorCount() === 1, '误填空格时，其余全对也不通关');
    tap(sc, er.x, er.y);           // 橡皮
    var ep = cellCenter(sc, empty);
    tap(sc, ep.x, ep.y);
    ok(!!sc.win, '擦掉误填后应通关');
  })();

  /* ---------- 4. 提示 ---------- */
  (function () {
    fresh();
    var sc = newScene();
    sc.enter({ level: 1, game: 'picross' });
    frame(sc, 2);
    var h = actBtn(sc, 'hint');
    for (var k = 0; k < 3; k++) { tap(sc, h.x, h.y); }
    ok(sc.hintsLeft === 0 && sc.hintUsed === 3, '提示应只剩 0 次');
    var filled = 0;
    for (var i = 0; i < sc.st.length; i++) {
      if (sc.st[i] === -1) { continue; }
      filled++;
      if (sc.cells[i] >= 0) { ok(sc.st[i] === sc.cells[i], '提示填的应是正确颜色 @' + i); }
      else { ok(sc.st[i] === -2, '提示空格应打 ✕ @' + i); }
    }
    ok(filled === 3, '3 次提示应动 3 格，实际 ' + filled);
    ok(!!sc.hintFlash && sc.hintFlash.t > 0, '提示应有金圈闪光');
    tap(sc, h.x, h.y);
    ok(sc.toast && /提示次数已用完/.test(sc.toast.msg), '第 4 次提示应提示已用完：' +
      (sc.toast && sc.toast.msg));
    var still = 0;
    for (i = 0; i < sc.st.length; i++) { if (sc.st[i] !== -1) { still++; } }
    ok(still === 3, '提示用完后不应再改动盘面');
  })();

  /* ---------- 5. 重置不清计时 ---------- */
  (function () {
    fresh();
    var sc = newScene();
    sc.enter({ level: 3, game: 'picross' });
    frame(sc, 2);
    var cnt = 0;
    for (var i = 0; i < sc.cells.length && cnt < 4; i++) {
      if (sc.cells[i] >= 0) { fillCell(sc, i, sc.cells[i]); cnt++; }
    }
    ok(cnt === 4, '应填了 4 格');
    frame(sc, 30);                     // 让计时走一会
    var before = sc.elapsed;
    ok(before > 0, '填格后应有计时');
    var rs = actBtn(sc, 'reset');
    tap(sc, rs.x, rs.y);
    var blank = true;
    for (i = 0; i < sc.st.length; i++) { if (sc.st[i] !== -1) { blank = false; } }
    ok(blank, '重置应清空盘面');
    ok(sc.elapsed >= before, '重置不清计时（' + before + ' → ' + sc.elapsed + '）');
    ok(sc.toast && /已清空盘面/.test(sc.toast.msg), '重置应弹提示');
    // 重置后断点仍在（防退出丢进度）
    var prog = (BF.Save.extraOf('picross').prog || {})['3'];
    ok(!!prog && typeof prog.s === 'string' && prog.s.length === 25, '重置后应写断点');
  })();

  /* ---------- 6. 长按标空 / 滑出取消 ---------- */
  (function () {
    fresh();
    var sc = newScene();
    sc.enter({ level: 1, game: 'picross' });
    frame(sc, 2);
    var idx = -1;
    for (var i = 0; i < sc.cells.length; i++) { if (sc.cells[i] >= 0) { idx = i; break; } }
    var p = cellCenter(sc, idx);
    // 6a. 长按 400ms → 标空（不填色）
    sc.onDown(p.x, p.y);
    frame(sc, 25);                     // 400ms > 350ms
    sc.onUp(p.x, p.y);
    ok(sc.st[idx] === -2, '长按应标空，实际 ' + sc.st[idx]);
    ok(sc.started, '长按也应开始计时');
    // 6b. 短按（同帧内 up）→ 正常填色，不会误触长按
    var idx2 = -1;
    for (i = 0; i < sc.cells.length; i++) { if (sc.cells[i] >= 0 && i !== idx) { idx2 = i; break; } }
    var p2 = cellCenter(sc, idx2);
    tap(sc, p2.x, p2.y);
    ok(sc.st[idx2] === sc.sel, '短按应按当前工具填色，实际 ' + sc.st[idx2]);
    // 6c. 滑出格外 → 取消本次点击
    var idx3 = -1;
    for (i = 0; i < sc.cells.length; i++) { if (sc.cells[i] >= 0 && i !== idx && i !== idx2) { idx3 = i; break; } }
    var p3 = cellCenter(sc, idx3);
    sc.onDown(p3.x, p3.y);
    sc.onMove(p3.x + 500, p3.y + 500);
    sc.onUp(p3.x + 500, p3.y + 500);
    ok(sc.st[idx3] === -1, '滑出格外应取消点击');
    // 6d. 长按已标✕的格 → 取消标空
    sc.onDown(p.x, p.y);
    frame(sc, 25);
    sc.onUp(p.x, p.y);
    ok(sc.st[idx] === -1, '长按已标空的格应取消 ✕');
  })();

  /* ---------- 7. 断点续玩 ---------- */
  (function () {
    fresh();
    var sc = newScene();
    sc.enter({ level: 5, game: 'picross' });
    frame(sc, 2);
    var touched = [];
    for (var i = 0; i < sc.cells.length && touched.length < 4; i++) {
      if (sc.cells[i] >= 0) { fillCell(sc, i, sc.cells[i]); touched.push(i); }
    }
    sc.elapsed = 65000;
    sc.saveProgress();
    var sc2 = newScene();
    sc2.enter({ level: 5, game: 'picross' });
    var same = true;
    for (var k = 0; k < touched.length; k++) {
      if (sc2.st[touched[k]] !== sc.cells[touched[k]]) { same = false; }
    }
    ok(same, '重进同一关应恢复盘面');
    ok(sc2.elapsed === 65000, '重进应恢复计时，实际 ' + sc2.elapsed);
    ok(sc2.hintUsed === 0 && sc2.hintsLeft === 3, '重进应恢复提示次数');
    ok(sc2.toast && /已恢复上次进度/.test(sc2.toast.msg), '重进应提示恢复进度');
    // 不串关：进第 6 关应是空白盘
    var sc3 = newScene();
    sc3.enter({ level: 6, game: 'picross' });
    var blank = true;
    for (k = 0; k < sc3.st.length; k++) { if (sc3.st[k] !== -1) { blank = false; } }
    ok(blank && sc3.elapsed === 0, '换关不应继承上一关断点');
  })();

  /* ---------- 8. 难度自选首屏 ---------- */
  (function () {
    fresh();
    var sc = newScene();
    sc.enter({ pickDiff: true, game: 'picross' });
    frame(sc, 2);
    ok(sc.pickDiff, '应进入难度首屏');
    ok(sc.pickCards && sc.pickCards.length === 4, '应有 4 张档卡');
    ok(!sc.puzzle, '首屏不应造题');
    for (var i = 0; i < sc.pickCards.length; i++) {
      var c = sc.pickCards[i];
      ok(c.x >= 0 && c.x + c.w <= BF.platform.width, '档卡 ' + i + ' 左右出屏');
      ok(c.y >= sc.headerY, '档卡 ' + i + ' 压到标题');
      ok(c.y + c.h <= sc.pickAll.y, '档卡 ' + i + ' 压到「查看全部关卡」');
      if (i > 0) {
        ok(c.y >= sc.pickCards[i - 1].y + sc.pickCards[i - 1].h, '档卡 ' + i + ' 与上一张重叠');
      }
    }
    // 点「专家」档 → 进第 31 关
    var ep = sc.pickCards[3];
    tap(sc, ep.x + ep.w / 2, ep.y + ep.h / 2);
    ok(!sc.pickDiff && sc.level === 31, '点专家档应进第 31 关，实际 level=' + sc.level);
    ok(sc.n === 15, '专家档应为 15×15');
    // 返回键回首页
    var sc2 = newScene();
    sc2.enter({ pickDiff: true, game: 'picross' });
    var bk = actBtn(sc2, 'back');
    tap(sc2, bk.x, bk.y);
    ok(app.lastGo && app.lastGo.name === 'home', '首屏返回键应回首页');
    // 「查看全部关卡」
    var sc3 = newScene();
    sc3.enter({ pickDiff: true, game: 'picross' });
    tap(sc3, sc3.pickAll.x + sc3.pickAll.w / 2, sc3.pickAll.y + sc3.pickAll.h / 2);
    ok(app.lastGo && app.lastGo.name === 'levels' && app.lastGo.params.game === 'picross',
      '「查看全部关卡」应进 picross 关卡页');
    // 首屏 render 不抛
    frame(sc3, 2);
    ok(depth === 0, '首屏 render 后 save/restore 未配平');
  })();

  /* ---------- 9. 每日挑战 ---------- */
  (function () {
    fresh();
    var sc = newScene();
    sc.enter({ daily: true, game: 'picross' });
    frame(sc, 2);
    ok(sc.isDaily, '应进入每日挑战');
    ok(sc.puzzle.tier === Gen.DAILY_TIER && sc.n === 12, '每日挑战应为困难档 12×12');
    solveByTaps(sc);
    ok(!!sc.win, '每日挑战应可通关');
    ok(BF.Save.data.daily.cleared, '每日挑战通关应写 daily 存档');
    // 每日的「下一关」= 回首页
    var ob = sc.overlayLayout();
    tap(sc, ob.next.x + ob.next.w / 2, ob.next.y + ob.next.h / 2);
    ok(app.lastGo && app.lastGo.name === 'home', '每日挑战结算后应回首页');
  })();

  /* ---------- 10. 小屏几何（320×568） ---------- */
  (function () {
    fresh();
    BF.platform.width = 320; BF.platform.height = 568;
    BF.platform.safeTop = 20; BF.platform.safeBottom = 20;
    [1, 21, 31].forEach(function (n) {
      var sc = newScene();
      sc.enter({ level: n, game: 'picross' });
      frame(sc, 2);
      ok(sc.boardX >= 0 && sc.boardX + sc.boardW <= 320, '小屏 L' + n + ' 棋盘左右出屏');
      ok(sc.gridY + sc.gridW <= sc.palY, '小屏 L' + n + ' 棋盘压到调色板');
      ok(sc.palY + SW <= 568 - 20 + 1, '小屏 L' + n + ' 调色板出安全区');
      ok(sc.cell >= 14, '小屏 L' + n + ' 格子边长下限被击穿：' + sc.cell);
    });
    BF.platform.width = 390; BF.platform.height = 844;
    BF.platform.safeTop = 44; BF.platform.safeBottom = 34;
  })();

  /* ---------- 11. 线索渲染几何 ---------- */
  /** 记录型 ctx：只抓 fillText（线索数字只走这条路径）与网格线 moveTo/lineTo */
  function recorder() {
    var calls = [], lines = [], lw = 1, fill = '#000';
    var c = new Proxy({}, {
      get: function (t, p) {
        if (p === 'fillStyle') { return fill; }
        if (p === 'lineWidth') { return lw; }
        if (p === 'fillText') {
          return function (txt, x, y) { calls.push({ txt: String(txt), x: x, y: y, fill: fill }); };
        }
        if (p === 'moveTo') { return function (x, y) { lines.push({ x1: x, y1: y, lw: lw }); }; }
        if (p === 'lineTo') {
          return function (x, y) {
            var L = lines[lines.length - 1];
            if (L && L.x2 === undefined) { L.x2 = x; L.y2 = y; }
          };
        }
        if (p === 'measureText') { return function () { return { width: 10 }; }; }
        if (p === 'createLinearGradient' || p === 'createRadialGradient') {
          return function () { return { addColorStop: function () {} }; };
        }
        return function () {};
      },
      set: function (t, k, v) {
        if (k === 'fillStyle') { fill = v; }
        if (k === 'lineWidth') { lw = v; }
        return true;
      }
    });
    return { ctx: c, calls: calls, lines: lines };
  }

  [1, 11, 21, 31].forEach(function (n) {
    var sc = newScene();
    sc.enter({ level: n, game: 'picross' });
    frame(sc, 2);
    var rec = recorder();
    sc.renderBoard(rec.ctx);

    // 11a. 网格线：n+1 竖 + n+1 横，通栏，n>=10 时每 5 格加粗
    var vmap = {}, hmap = {};
    rec.lines.forEach(function (L) {
      if (L.x2 === undefined) { return; }
      if (L.x1 === L.x2) { vmap[Math.round(L.x1)] = L; }
      else if (L.y1 === L.y2) { hmap[Math.round(L.y1)] = L; }
    });
    ok(Object.keys(vmap).length === sc.n + 1, 'L' + n + ' 竖线应有 ' + (sc.n + 1) + ' 条，实际 ' + Object.keys(vmap).length);
    ok(Object.keys(hmap).length === sc.n + 1, 'L' + n + ' 横线应有 ' + (sc.n + 1) + ' 条，实际 ' + Object.keys(hmap).length);
    for (var k = 0; k <= sc.n; k++) {
      var V = vmap[Math.round(sc.gridX + k * sc.cell)];
      var H = hmap[Math.round(sc.gridY + k * sc.cell)];
      ok(!!V, 'L' + n + ' 缺少第 ' + k + ' 条竖线');
      ok(!!H, 'L' + n + ' 缺少第 ' + k + ' 条横线');
      if (V) { ok(Math.abs(V.y1 - sc.gridY) < 0.01 && Math.abs(V.y2 - (sc.gridY + sc.gridW)) < 0.01, 'L' + n + ' 竖线未通栏'); }
      if (H) { ok(Math.abs(H.x1 - sc.gridX) < 0.01 && Math.abs(H.x2 - (sc.gridX + sc.gridW)) < 0.01, 'L' + n + ' 横线未通栏'); }
      var wantThick = (sc.n >= 10 && k % 5 === 0);
      if (V) { ok((V.lw >= 1.4) === wantThick, 'L' + n + ' 第 ' + k + ' 条竖线粗细不对'); }
      if (H) { ok((H.lw >= 1.4) === wantThick, 'L' + n + ' 第 ' + k + ' 条横线粗细不对'); }
    }

    // 11b. 线索数字：个数 / 位置 / 颜色 / 顺序
    // 行线索按 y 分行（每行一个锚点），行内按 x 升序 = 线索顺序；
    // 列线索按 x 分列，列内按 y 升序 = 线索顺序。
    var rowGlyphs = [], colGlyphs = [];
    rec.calls.forEach(function (g) {
      if (!/^\d+$/.test(g.txt)) { return; }
      if (g.x < sc.gridX - 1 && g.y >= sc.gridY - 0.5 && g.y <= sc.gridY + sc.gridW + 0.5) { rowGlyphs.push(g); }
      else if (g.y < sc.gridY - 1 && g.x >= sc.gridX - 0.5 && g.x <= sc.gridX + sc.gridW + 0.5) { colGlyphs.push(g); }
    });
    var expect = 0;
    for (var r = 0; r < sc.n; r++) { expect += Math.max(1, sc.rowC[r].length); }
    for (var c2 = 0; c2 < sc.n; c2++) { expect += Math.max(1, sc.colC[c2].length); }
    ok(rowGlyphs.length + colGlyphs.length === expect,
      'L' + n + ' 线索数字个数应为 ' + expect + '，实际 ' + (rowGlyphs.length + colGlyphs.length));
    /** 取某一行（isRow）上、按阅读顺序排好的线索数字 */
    function glyphsOf(list, k, isRow) {
      var anchor = isRow ? (sc.gridY + (k + 0.5) * sc.cell) : (sc.gridX + (k + 0.5) * sc.cell);
      return list.filter(function (g) {
        return Math.abs((isRow ? g.y : g.x) - anchor) < sc.cell * 0.5;
      }).sort(function (a, b) { return isRow ? (a.x - b.x) : (a.y - b.y); });
    }
    for (r = 0; r < sc.n; r++) {
      var clue = sc.rowC[r];
      var gs = glyphsOf(rowGlyphs, r, true);
      ok(gs.length === Math.max(1, clue.length),
        'L' + n + ' 第 ' + r + ' 行线索数字段数应为 ' + Math.max(1, clue.length) + '，实际 ' + gs.length);
      if (!clue.length) {
        ok(gs.length === 1 && gs[0].txt === '0', 'L' + n + ' 第 ' + r + ' 行空行应显示 0');
        continue;
      }
      for (var q = 0; q < clue.length && q < gs.length; q++) {
        var g = gs[q];
        ok(g.txt === String(clue[q][1]), 'L' + n + ' 第 ' + r + ' 行第 ' + q + ' 段数字不对（' + g.txt + '）');
        ok(g.fill === Gen.PALETTE_HEX[clue[q][0]], 'L' + n + ' 第 ' + r + ' 行第 ' + q + ' 段颜色不对');
        ok(g.x >= sc.boardX - 0.5 && g.x <= sc.gridX - 2,
          'L' + n + ' 第 ' + r + ' 行线索数字压到棋盘/越出线索槽（x=' + g.x.toFixed(1) + '）');
        ok(g.y >= sc.gridY - 0.5 && g.y <= sc.gridY + sc.gridW + 0.5,
          'L' + n + ' 第 ' + r + ' 行线索数字纵向越界');
      }
    }
    for (var c3 = 0; c3 < sc.n; c3++) {
      var cl2 = sc.colC[c3];
      var gs2 = glyphsOf(colGlyphs, c3, false);
      ok(gs2.length === Math.max(1, cl2.length),
        'L' + n + ' 第 ' + c3 + ' 列线索数字段数应为 ' + Math.max(1, cl2.length) + '，实际 ' + gs2.length);
      if (!cl2.length) {
        ok(gs2.length === 1 && gs2[0].txt === '0', 'L' + n + ' 第 ' + c3 + ' 列空列应显示 0');
        continue;
      }
      for (var q2 = 0; q2 < cl2.length && q2 < gs2.length; q2++) {
        var g2 = gs2[q2];
        ok(g2.txt === String(cl2[q2][1]), 'L' + n + ' 第 ' + c3 + ' 列第 ' + q2 + ' 段数字不对（' + g2.txt + '）');
        ok(g2.fill === Gen.PALETTE_HEX[cl2[q2][0]], 'L' + n + ' 第 ' + c3 + ' 列第 ' + q2 + ' 段颜色不对');
        ok(g2.y >= sc.boardY - 0.5 && g2.y <= sc.gridY - 2,
          'L' + n + ' 第 ' + c3 + ' 列线索数字压到棋盘/越出线索槽（y=' + g2.y.toFixed(1) + '）');
        ok(g2.x >= sc.gridX - 0.5 && g2.x <= sc.gridX + sc.gridW + 0.5,
          'L' + n + ' 第 ' + c3 + ' 列线索数字横向越界');
      }
    }
  });

  if (issues.length) {
    console.log('❌ 数织交互层：' + issues.length + ' 处问题');
    issues.forEach(function (m) { console.log('  ✗ ' + m); });
    process.exit(1);
  }
  console.log('✅ 数织交互层：通关/宽松判错/橡皮·标空/提示/重置不清计时/长按标空/滑出取消/续玩/首屏/每日/小屏/线索几何 全部通过');

})();
