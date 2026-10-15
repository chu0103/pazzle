/**
 * _verify_sudoku_logic.js —— 九宫格数独「交互层」验证（node tools/_verify_sudoku_logic.js）
 *
 * 用「假 canvas + 假平台 + 假 Save」把 sudoku 场景真实跑起来，验证交互逻辑（不是像素）：
 *   1. 四档代表关（1/11/21/31）：enter → 几何不溢出/不重叠 → render 不抛；
 *   2. 真实填数通关：按解逐格点选+敲数字 → 自动通关 → 星级写入存档 + 最佳用时记录；
 *   3. 宽松校验：填错后点「检查」→ 标红 + 不通关；没填满点「检查」→ 提示剩余格数；
 *   4. 铅笔模式：填/擦候选数、填正式数自动清候选、撤销可回退；
 *   5. 提示：每关 3 次，填的是正确数，用完再点只弹 toast；
 *   6. 重置：恢复成给定数（计时不清零）；
 *   7. 给定格不可改；未选格敲数字只弹 toast；
 *   8. 断点续玩：中途退出再进同一关 → 恢复填写与候选；
 *   9. 难度自选首屏：4 张档卡几何合法、点档卡进该档第一关、返回键回首页；
 *   10. 每日挑战：可通关 + daily 标记。
 *   11. 网格线几何：横/竖各 10 条、通栏、粗线恰在 3/6/9 边界
 *       （⚠️ 回归护栏：曾经横线 y 误用 bx+k*c，整组横线画到棋盘外，用户报「九宫格错乱」）。
 */
(function () {
  var path = require('path');
  var root = path.resolve(__dirname, '..');
  global.BF = {};
  require(path.join(root, 'js/core/ns.js'));

  var depth = 0, finalDepth = 0;
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
  require(path.join(root, 'js/game/sudoku.js'));
  require(path.join(root, 'js/scenes/diffpick.js'));
  require(path.join(root, 'js/scenes/ruletip.js'));
  BF.RuleTip.on = false;   // harness 默认关掉规则弹框（enter 后输入会被拦走）
  require(path.join(root, 'js/scenes/sudoku.js'));

  BF.platform = {
    width: 390, height: 844, safeTop: 44, safeBottom: 34, dpr: 2,
    now: function () { return 0; }, vibrate: function () {}, requestFrame: function () {},
    bindPointer: function () {}, ctx: ctx
  };

  var Gen = BF.SudokuGen;
  var meta = BF.games.sudoku;
  var app = { go: function (name, params) { app.lastGo = { name: name, params: params }; } };
  var issues = [];
  function ok(cond, msg) { if (!cond) { issues.push(msg); } }

  function newScene() { return new BF.SceneSudoku(app); }
  function frame(sc, n) {
    n = n || 1;
    for (var i = 0; i < n; i++) { sc.update(16); sc.render(ctx); }
  }
  function tap(sc, x, y) { sc.onDown(x, y); sc.onUp(x, y); }

  /** 数字键盘上数字 d 的键中心 */
  function keyCenter(sc, d) {
    var k = sc.keys[d - 1];
    return { x: k.x + k.w / 2, y: k.y + k.h / 2 };
  }
  /** 棋盘格 idx 的中心 */
  function cellCenter(sc, idx) {
    var c = sc.cell;
    return {
      x: sc.boardX + (idx % 9) * c + c / 2,
      y: sc.boardY + (((idx / 9) | 0)) * c + c / 2
    };
  }
  function actCenter(sc, key) {
    for (var i = 0; i < sc.actBtns.length; i++) {
      if (sc.actBtns[i].key === key) {
        return { x: sc.actBtns[i].x + sc.actBtns[i].w / 2, y: sc.actBtns[i].y + sc.actBtns[i].h / 2 };
      }
    }
    return null;
  }
  /** 用真实点击把 idx 填成 v */
  function fillCell(sc, idx, v) {
    var p = cellCenter(sc, idx);
    tap(sc, p.x, p.y);
    var k = keyCenter(sc, v);
    tap(sc, k.x, k.y);
  }
  /** 按标准解把整盘填满（跳过给定格与已填对的格——再点同一数字会触发擦除） */
  function solveByTaps(sc) {
    var pz = sc.puzzle;
    for (var i = 0; i < 81; i++) {
      if (pz.given[i] || sc.entries[i] === pz.solution[i]) { continue; }
      fillCell(sc, i, pz.solution[i]);
    }
  }

  /* ---------- 1. 四档代表关：几何 + 渲染 ---------- */
  (function () {
    [1, 11, 21, 31].forEach(function (n) {
      var sc = newScene();
      sc.enter({ level: n, game: 'sudoku' });
      frame(sc, 2);
      ok(!sc.pickDiff, 'L' + n + ' 不应停在难度首屏');
      ok(sc.puzzle.blanks === Gen.TIER_BLANKS[Gen.tierOf(n)], 'L' + n + ' 挖空数不对');
      // 棋盘不出屏、不压键盘
      ok(sc.boardX >= 0 && sc.boardY >= sc.headerY + sc.headerH, 'L' + n + ' 棋盘越界');
      ok(sc.boardX + sc.boardW <= BF.platform.width, 'L' + n + ' 棋盘右侧出屏');
      ok(sc.boardY + sc.boardW <= sc.keys[0].y, 'L' + n + ' 棋盘压到数字键盘');
      // 动作键不出底安全区
      var last = sc.actBtns[sc.actBtns.length - 1];
      ok(last.y + last.h <= BF.platform.height - BF.platform.safeBottom + 1,
        'L' + n + ' 动作键超出安全区');
      // 键位不重叠
      for (var a = 0; a < sc.actBtns.length; a++) {
        for (var b = a + 1; b < sc.actBtns.length; b++) {
          var r1 = sc.actBtns[a], r2 = sc.actBtns[b];
          ok(r1.x + r1.w <= r2.x + 0.5 || r2.x + r2.w <= r1.x + 0.5, 'L' + n + ' 动作键重叠');
        }
      }
      ok(sc.keys.length === 9, '数字键盘应为 9 键');
      finalDepth = depth;
      ok(finalDepth === 0, 'L' + n + ' render 后 save/restore 未配平（净泄漏 ' + finalDepth + '）');
    });
  })();

  /* ---------- 2. 真实点击填数通关 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ level: 1, game: 'sudoku' });
    frame(sc, 2);
    solveByTaps(sc);
    ok(!!sc.win, '按标准解点完应通关');
    ok(sc.win.stars >= 1 && sc.win.stars <= 3, '星级应在 1~3，实际 ' + (sc.win && sc.win.stars));
    ok(BF.Save.isCleared('sudoku', 1), '通关后应写入存档');
    var best = BF.Save.extraOf('sudoku').best;
    ok(best && typeof best['1'] === 'number', '通关后应记录最佳用时');
    ok(!(BF.Save.extraOf('sudoku').prog || {})['1'], '通关后应清掉该关断点');
    frame(sc, 4);
    // 下一关按钮 → 第 2 关
    var ob = sc.overlayLayout();
    tap(sc, ob.next.x + ob.next.w / 2, ob.next.y + ob.next.h / 2);
    ok(sc.level === 2 && !sc.win, '点「下一关」应进第 2 关');
  })();

  /* ---------- 3. 宽松校验：错误不提示，检查才说 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ level: 1, game: 'sudoku' });
    frame(sc, 2);
    // 找第一个空格，填一个错误数字
    var wrongIdx = -1, wrongVal = 0;
    for (var i = 0; i < 81; i++) {
      if (!sc.puzzle.given[i]) {
        wrongIdx = i;
        wrongVal = sc.puzzle.solution[i] === 9 ? 8 : sc.puzzle.solution[i] + 1;
        break;
      }
    }
    fillCell(sc, wrongIdx, wrongVal);
    ok(!sc.win, '填错不应直接通关');
    ok(!sc.wrongFlash, '宽松模式：填错不应立即标红');
    // 没填满就检查 → 只提示剩余
    var chk = actCenter(sc, 'check');
    tap(sc, chk.x, chk.y);
    ok(!sc.win && !sc.wrongFlash, '没填满时检查不应标红/通关');
    ok(sc.toast && /还有 \d+ 格没填/.test(sc.toast.text), '没填满时应提示剩余格数：' +
      (sc.toast && sc.toast.text));
    // 填满（其余按解，留那格错的）→ 检查 → 标红 1 格
    for (var j = 0; j < 81; j++) {
      if (sc.puzzle.given[j] || j === wrongIdx) { continue; }
      fillCell(sc, j, sc.puzzle.solution[j]);
    }
    ok(!sc.win, '填满但有错不应自动通关');
    tap(sc, chk.x, chk.y);
    ok(!sc.win, '有错时检查不应通关');
    ok(!!sc.wrongFlash && sc.wrongFlash.cells.length === 1 && sc.wrongFlash.cells[0] === wrongIdx,
      '检查应把唯一错格标红');
    // 改对 → 自动通关
    fillCell(sc, wrongIdx, sc.puzzle.solution[wrongIdx]);
    ok(!!sc.win, '改对后应通关');
  })();

  /* ---------- 4. 铅笔候选数 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ level: 1, game: 'sudoku' });
    frame(sc, 2);
    var idx = -1;
    for (var i = 0; i < 81; i++) { if (!sc.puzzle.given[i]) { idx = i; break; } }
    // 开铅笔
    var pen = actCenter(sc, 'pencil');
    tap(sc, pen.x, pen.y);
    ok(sc.pencilMode, '点铅笔应进入铅笔模式');
    // 填候选 3
    fillCell(sc, idx, 3);
    ok(sc.pencil[idx] & (1 << 2), '铅笔模式应写入候选 3');
    ok(!sc.entries[idx], '铅笔模式不应写正式数');
    // 再点 3 → 擦掉候选
    fillCell(sc, idx, 3);
    ok(!(sc.pencil[idx] & (1 << 2)), '再点同一数字应擦掉候选');
    // 填两个候选后撤销一次 → 回到一个候选
    fillCell(sc, idx, 5);
    fillCell(sc, idx, 7);
    ok(sc.pencil[idx] & (1 << 4) && sc.pencil[idx] & (1 << 6), '应有两个候选');
    var undo = actCenter(sc, 'undo');
    tap(sc, undo.x, undo.y);
    ok((sc.pencil[idx] & (1 << 4)) && !(sc.pencil[idx] & (1 << 6)), '撤销应回退最后一次候选');
    // 关铅笔填正式数 → 候选被清掉
    tap(sc, pen.x, pen.y);
    ok(!sc.pencilMode, '再点铅笔应退回数字模式');
    fillCell(sc, idx, 4);
    ok(sc.entries[idx] === 4 && sc.pencil[idx] === 0, '填正式数应清掉候选');
    // 再点同一数字 = 擦除
    fillCell(sc, idx, 4);
    ok(sc.entries[idx] === 0, '再点同一数字应擦除');
    // 撤销擦除 → 数字回来
    tap(sc, undo.x, undo.y);
    ok(sc.entries[idx] === 4, '撤销应恢复被擦掉的数字');
    // 「擦除」按钮
    fillCell(sc, idx, 6);
    var er = actCenter(sc, 'erase');
    tap(sc, er.x, er.y);
    ok(sc.entries[idx] === 0, '擦除按钮应清掉选中格');
  })();

  /* ---------- 5. 提示 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ level: 1, game: 'sudoku' });
    frame(sc, 2);
    var hint = actCenter(sc, 'hint');
    for (var k = 0; k < 3; k++) { tap(sc, hint.x, hint.y); }
    ok(sc.hintsLeft === 0, '提示应只剩 0 次');
    var filled = 0;
    for (var i = 0; i < 81; i++) {
      if (!sc.puzzle.given[i] && sc.entries[i]) {
        ok(sc.entries[i] === sc.puzzle.solution[i], '提示填的应是正确数');
        filled++;
      }
    }
    ok(filled === 3, '3 次提示应填 3 格，实际 ' + filled);
    tap(sc, hint.x, hint.y);
    ok(sc.toast && /提示已用完/.test(sc.toast.text), '第 4 次提示应提示已用完');
  })();

  /* ---------- 6. 重置 / 给定格保护 / 未选格 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ level: 1, game: 'sudoku' });
    frame(sc, 2);
    var idx = -1;
    for (var i = 0; i < 81; i++) { if (!sc.puzzle.given[i]) { idx = i; break; } }
    fillCell(sc, idx, 1);
    var before = sc.elapsed;
    var rs = actCenter(sc, 'reset');
    tap(sc, rs.x, rs.y);
    ok(sc.entries[idx] === 0, '重置应清掉填写');
    var givens = 0;
    for (var i = 0; i < 81; i++) { if (sc.entries[i] === sc.puzzle.given[i] && sc.puzzle.given[i]) { givens++; } }
    ok(givens === 81 - sc.puzzle.blanks, '重置后给定数应原样恢复');
    ok(sc.elapsed >= before, '重置不清计时');
    // 点给定格再敲数字 → 只弹 toast，不改
    var gIdx = -1;
    for (var j = 0; j < 81; j++) { if (sc.puzzle.given[j]) { gIdx = j; break; } }
    fillCell(sc, gIdx, 5);
    ok(sc.entries[gIdx] === sc.puzzle.given[gIdx], '给定格不可改');
    ok(sc.toast && /给定的格子不能改/.test(sc.toast.text), '改给定格应提示');
    // 不选格直接敲数字 → toast
    sc.selected = null;
    var k = keyCenter(sc, 5);
    tap(sc, k.x, k.y);
    ok(sc.toast && /先点一个格子/.test(sc.toast.text), '未选格敲数字应提示');
  })();

  /* ---------- 7. 断点续玩 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ level: 5, game: 'sudoku' });
    frame(sc, 2);
    var idx = -1;
    for (var i = 0; i < 81; i++) { if (!sc.puzzle.given[i]) { idx = i; break; } }
    fillCell(sc, idx, 2);
    sc.elapsed = 65000;
    sc.saveProgress();
    // 重进同一关 → 恢复
    var sc2 = newScene();
    sc2.enter({ level: 5, game: 'sudoku' });
    ok(sc2.entries[idx] === 2, '重进应恢复填写');
    ok(sc2.elapsed === 65000, '重进应恢复计时，实际 ' + sc2.elapsed);
    // 通关后断点被清
    solveByTaps(sc2);
    ok(!(BF.Save.extraOf('sudoku').prog || {})['5'], '通关后断点应清除');
  })();

  /* ---------- 8. 难度自选首屏 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ pickDiff: true, game: 'sudoku' });
    frame(sc, 2);
    ok(sc.pickDiff, '应进入难度首屏');
    ok(sc.pickCards && sc.pickCards.length === 4, '应有 4 张档卡');
    // 不加载题目
    ok(!sc.puzzle, '首屏不应造题');
    // 档卡不重叠、不出屏、不压「查看全部关卡」
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
    // 返回键回首页
    var sc2 = newScene();
    sc2.enter({ pickDiff: true, game: 'sudoku' });
    tap(sc2, sc2.back.x + sc2.back.w / 2, sc2.back.y + sc2.back.h / 2);
    ok(app.lastGo && app.lastGo.name === 'home', '首屏返回键应回首页');
    // 「查看全部关卡」
    var sc3 = newScene();
    sc3.enter({ pickDiff: true, game: 'sudoku' });
    tap(sc3, sc3.pickAll.x + sc3.pickAll.w / 2, sc3.pickAll.y + sc3.pickAll.h / 2);
    ok(app.lastGo && app.lastGo.name === 'levels' && app.lastGo.params.game === 'sudoku',
      '「查看全部关卡」应进 sudoku 关卡页');
  })();

  /* ---------- 9. 每日挑战 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ daily: true, game: 'sudoku' });
    frame(sc, 2);
    ok(sc.isDaily, '应进入每日挑战');
    solveByTaps(sc);
    ok(!!sc.win, '每日挑战应可通关');
    ok(BF.Save.data.daily.cleared, '每日挑战通关应写 daily 存档');
  })();

  /* ---------- 10. 小屏几何（320×568） ---------- */
  (function () {
    BF.platform.width = 320; BF.platform.height = 568;
    BF.platform.safeTop = 20; BF.platform.safeBottom = 20;
    var sc = newScene();
    sc.enter({ level: 21, game: 'sudoku' });
    frame(sc, 2);
    ok(sc.boardX >= 0 && sc.boardX + sc.boardW <= 320, '小屏棋盘左右出屏');
    ok(sc.boardY + sc.boardW <= sc.keys[0].y, '小屏棋盘压键盘');
    var last = sc.actBtns[sc.actBtns.length - 1];
    ok(last.y + last.h <= 568 - 20 + 1, '小屏动作键出安全区');
    BF.platform.width = 390; BF.platform.height = 844;
    BF.platform.safeTop = 44; BF.platform.safeBottom = 34;
  })();

  /* ---------- 11. 网格线几何（横线必须落在棋盘内） ---------- */
  (function () {
    // 记录一次 render 里所有 moveTo/lineTo 线段（D.* 已被上面钉死为 no-op，
    // 所以这里收到的只可能是 renderBoard 里直接画网格的那几条）
    var lines = [], lw = 0;
    var rec = new Proxy({}, {
      get: function (t, p) {
        if (p === 'lineWidth') { return lw; }
        if (p === 'moveTo') { return function (x, y) { lines.push({ x1: x, y1: y, x2: undefined, y2: undefined, lw: lw }); }; }
        if (p === 'lineTo') {
          return function (x, y) {
            var L = lines[lines.length - 1];
            if (L) { L.x2 = x; L.y2 = y; }
          };
        }
        if (p === 'measureText') { return function () { return { width: 10 }; }; }
        if (p === 'createLinearGradient' || p === 'createRadialGradient') {
          return function () { return { addColorStop: function () {} }; };
        }
        return function () {};
      },
      set: function (t, k, v) { if (k === 'lineWidth') { lw = v; } return true; }
    });

    [1, 21, 40].forEach(function (n) {
      var sc = newScene();
      sc.enter({ level: n, game: 'sudoku' });
      lines = [];
      sc.render(rec);
      var bx = sc.boardX, by = sc.boardY, c = sc.cell, bw = sc.boardW;
      var vmap = {}, hmap = {};
      lines.forEach(function (L) {
        if (L.x2 === undefined) { return; }
        if (L.x1 === L.x2) { vmap[Math.round(L.x1)] = L; }
        else if (L.y1 === L.y2) { hmap[Math.round(L.y1)] = L; }
      });
      ok(Object.keys(vmap).length === 10, 'L' + n + ' 竖线应有 10 条，实际 ' + Object.keys(vmap).length);
      ok(Object.keys(hmap).length === 10, 'L' + n + ' 横线应有 10 条，实际 ' + Object.keys(hmap).length);
      for (var k = 0; k <= 9; k++) {
        var V = vmap[Math.round(bx + k * c)];
        var H = hmap[Math.round(by + k * c)];   // ⚠️ 旧 bug：这里取到的是 bx + k*c 的线
        ok(!!V, 'L' + n + ' 缺少第 ' + k + ' 条竖线');
        ok(!!H, 'L' + n + ' 缺少第 ' + k + ' 条横线（横线 y 必须是 by+k*c，曾误写 bx+k*c 画到棋盘外）');
        if (V) {
          ok(Math.abs(V.y1 - by) < 0.01 && Math.abs(V.y2 - (by + bw)) < 0.01, 'L' + n + ' 第 ' + k + ' 条竖线未通栏');
        }
        if (H) {
          ok(Math.abs(H.x1 - bx) < 0.01 && Math.abs(H.x2 - (bx + bw)) < 0.01, 'L' + n + ' 第 ' + k + ' 条横线未通栏');
        }
        var wantThick = (k % 3 === 0);
        if (V) { ok((V.lw >= 1.5) === wantThick, 'L' + n + ' 第 ' + k + ' 条竖线粗细不对（lw=' + V.lw + '）'); }
        if (H) { ok((H.lw >= 1.5) === wantThick, 'L' + n + ' 第 ' + k + ' 条横线粗细不对（lw=' + H.lw + '）'); }
      }
    });
  })();

  if (issues.length) {
    console.log('❌ 九宫格数独交互层：' + issues.length + ' 处问题');
    issues.forEach(function (m) { console.log('  ✗ ' + m); });
    process.exit(1);
  }
  console.log('✅ 九宫格数独交互层：通关/宽松校验/铅笔/撤销/提示/重置/续玩/首屏/每日/小屏/网格线几何 全部通过');

})();
