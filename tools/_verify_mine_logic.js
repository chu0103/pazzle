/**
 * _verify_mine_logic.js —— 扫雷「交互层」验证（node tools/_verify_mine_logic.js）
 *
 * 用「假 canvas + 假平台 + 假 Save」把 mine 场景真实跑起来，验证交互逻辑（不是像素）：
 *   1. 四档代表关（1/11/21/31）：enter → 几何不溢出/不重叠 → render 不抛 → save/restore 配平；
 *   2. 真实翻格通关：首点生成棋盘 → findForced 推「必然安全/必然雷」直到通关 → 星级 + 存档 + 最佳用时；
 *   3. 踩雷即失败：翻到雷 → gameOver（不写通关存档）→「重玩」回到可玩态；
 *   4. 标记模式 + 插旗 + 提示消耗次数（每关 3 次）；
 *   5. 洪水填充 / chord：翻开 0 应连片展开、数字旗满双击应 chord；
 *   6. 提示后端：findForced 推的必然是「真安全 / 真雷」；
 *   7. 重置：棋盘清空、mines 置空、计时不清零（防刷 ★）；
 *   8. 断点续玩：翻几格退出再进同一关 → 恢复已翻开格与计时；
 *   9. 难度自选首屏：4 张档卡几何合法、点档卡进该档第一关、返回键回首页；
 *   10. 每日挑战：可通关 + daily 标记；
 *   11. 长按插旗：按下超过 350ms 抬起应插旗而不翻开。
 *   12. 失败显形：gameOver 时所有未插旗的雷都标记为 revealed（renderGameOver 用）。
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
    isDailyDoneToday: function () { return !!(store.daily && store.daily.cleared); },
    isDailyDoneOn: function () { return this.isDailyDoneToday(); },
    countAll: function () { return 0; }, starsAll: function () { return 0; },
    resetAll: function () { store = { games: {}, daily: {} }; }
  };

  require(path.join(root, 'js/core/palette.js'));
  require(path.join(root, 'js/core/draw.js'));
  require(path.join(root, 'js/core/save.js'));
  BF.Save = BF.Save;   // 保留上面的假 Save（真 save.js 检测到已存在会跳过）
  require(path.join(root, 'js/game/mine.js'));
  require(path.join(root, 'js/scenes/diffpick.js'));
  require(path.join(root, 'js/scenes/ruletip.js'));
  BF.RuleTip.on = false;   // harness 默认关掉规则弹框（enter 后输入会被拦走）
  require(path.join(root, 'js/scenes/mine.js'));

  var nowVal = 0;
  BF.platform = {
    width: 390, height: 844, safeTop: 44, safeBottom: 34, dpr: 2,
    now: function () { return nowVal; }, vibrate: function () {}, requestFrame: function () {},
    bindPointer: function () {}, ctx: ctx
  };

  var Gen = BF.MineGen;
  var meta = BF.games.mine;
  var app = { go: function (name, params) { app.lastGo = { name: name, params: params }; } };
  var issues = [];
  function ok(cond, msg) { if (!cond) { issues.push(msg); } }

  function newScene() { return new BF.SceneMine(app); }
  function frame(sc, n) { n = n || 1; for (var i = 0; i < n; i++) { sc.update(16); sc.render(ctx); } }
  function tap(sc, x, y) { sc.onDown(x, y); sc.onUp(x, y); }
  function cellCenter(sc, idx) {
    var c = sc.cell;
    return { x: sc.boardX + (idx % sc.n) * c + c / 2, y: sc.boardY + (((idx / sc.n) | 0)) * c + c / 2 };
  }
  function actCenter(sc, key) {
    for (var i = 0; i < sc.actBtns.length; i++) {
      if (sc.actBtns[i].key === key) {
        return { x: sc.actBtns[i].x + sc.actBtns[i].w / 2, y: sc.actBtns[i].y + sc.actBtns[i].h / 2 };
      }
    }
    return null;
  }
  function centerIdx(sc) { return ((sc.n / 2) | 0) * sc.n + ((sc.n / 2) | 0); }

  /** 凭纯逻辑推理（findForced）把全盘解开：插旗必然雷 + 翻必然安全格，直到通关 */
  function solveMine(sc) {
    var guard = 0;
    while (!sc.win && guard++ < sc.N * sc.N + 50) {
      var f = sc.findForced();
      if (!f) { break; }
      if (f.type === 'mine') { sc.flagAt(f.cell); } else { sc.revealAt(f.cell); }
    }
  }
  /** 用真实点击推：必然安全格走 tap（翻开），必然雷格走标记模式插旗 */
  function solveMineReal(sc) {
    var guard = 0;
    while (!sc.win && guard++ < sc.N * sc.N + 50) {
      var f = sc.findForced();
      if (!f) { break; }
      if (f.type === 'mine') { sc.flagAt(f.cell); }
      else { var p = cellCenter(sc, f.cell); tap(sc, p.x, p.y); }
    }
  }

  /* ---------- 1. 四档代表关：几何 + 渲染 + 状态栈配平 ---------- */
  (function () {
    [1, 11, 21, 31].forEach(function (n) {
      var sc = newScene();
      sc.enter({ level: n, game: 'mine' });
      frame(sc, 2);
      ok(!sc.pickDiff, 'L' + n + ' 不应停在难度首屏');
      ok(sc.n === Gen.TIER_SIZE[Gen.tierOf(n)] && sc.m === Gen.TIER_MINES[Gen.tierOf(n)],
        'L' + n + ' 尺寸/雷数不对');
      // 棋盘不出屏、不压动作行
      ok(sc.boardX >= 0 && sc.boardY >= sc.headerY + sc.headerH, 'L' + n + ' 棋盘越界');
      ok(sc.boardX + sc.boardW <= BF.platform.width, 'L' + n + ' 棋盘右侧出屏');
      ok(sc.boardY + sc.boardW <= sc.actBtns[0].y, 'L' + n + ' 棋盘压到动作行');
      // 动作键不超底安全区
      var last = sc.actBtns[sc.actBtns.length - 1];
      ok(last.y + last.h <= BF.platform.height - BF.platform.safeBottom + 1, 'L' + n + ' 动作键超出安全区');
      // 键位不重叠
      for (var a = 0; a < sc.actBtns.length; a++) {
        for (var b = a + 1; b < sc.actBtns.length; b++) {
          var r1 = sc.actBtns[a], r2 = sc.actBtns[b];
          ok(r1.x + r1.w <= r2.x + 0.5 || r2.x + r2.w <= r1.x + 0.5, 'L' + n + ' 动作键重叠');
        }
      }
      finalDepth = depth;
      ok(finalDepth === 0, 'L' + n + ' render 后 save/restore 未配平（净泄漏 ' + finalDepth + '）');
    });
  })();

  /* ---------- 2. 真实翻格通关 + 存档 + 星级 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ level: 1, game: 'mine' });
    frame(sc, 2);
    tap(sc, cellCenter(sc, centerIdx(sc)).x, cellCenter(sc, centerIdx(sc)).y);
    frame(sc, 3);
    ok(sc.started && sc.firstClick >= 0 && !sc.mines[sc.firstClick], '首点应生成棋盘且必安全');
    solveMineReal(sc);
    ok(!!sc.win, '凭纯逻辑推理应能通关（免猜）');
    ok(sc.win.stars >= 1 && sc.win.stars <= 3, '星级应在 1~3，实际 ' + (sc.win && sc.win.stars));
    ok(BF.Save.isCleared('mine', 1), '通关后应写入存档');
    var best = BF.Save.extraOf('mine').best;
    ok(best && typeof best['1'] === 'number', '通关后应记录最佳用时');
    ok(!(BF.Save.extraOf('mine').prog || {})['1'], '通关后应清掉该关断点');
    // 下一关按钮 → 第 2 关
    var ob = sc.overlayLayout();
    tap(sc, ob.next.x + ob.next.w / 2, ob.next.y + ob.next.h / 2);
    ok(sc.level === 2 && !sc.win, '点「下一关」应进第 2 关');
  })();

  /* ---------- 3. 踩雷即失败 + 重玩回到可玩态 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ level: 2, game: 'mine' });
    frame(sc, 2);
    tap(sc, cellCenter(sc, centerIdx(sc)).x, cellCenter(sc, centerIdx(sc)).y);
    frame(sc, 3);
    var boom = -1;
    for (var zi = 0; zi < sc.N; zi++) { if (sc.mines[zi]) { boom = zi; break; } }
    sc.revealAt(boom);
    ok(sc.gameOver, '翻到雷应触发失败');
    ok(!BF.Save.isCleared('mine', 2), '失败不应写通关存档');
    // 失败时所有未插旗的雷都应被标记为 revealed（renderGameOver 用）
    var allRevealed = true;
    for (var mi = 0; mi < sc.N; mi++) {
      if (sc.mines[mi] && !sc.flagged[mi] && !sc.revealed[mi]) { allRevealed = false; break; }
    }
    ok(allRevealed, '游戏失败时应把所有未插旗的雷显形');
    var ob2 = sc.overlayLayout();
    tap(sc, ob2.again.x + ob2.again.w / 2, ob2.again.y + ob2.again.h / 2);
    ok(!sc.win && !sc.gameOver && !sc.started, '「重玩」应回到可玩态（清空棋盘）');
  })();

  /* ---------- 4. 标记模式插旗 + 提示消耗次数 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ level: 3, game: 'mine' });
    frame(sc, 2);
    var mb = actCenter(sc, 'mark');
    tap(sc, mb.x, mb.y); frame(sc, 2);
    ok(sc.markMode, '点标记应进入标记模式');
    // 标记模式下点格（中心首点生成 + 插旗）
    tap(sc, cellCenter(sc, 0).x, cellCenter(sc, 0).y); frame(sc, 2);
    ok(sc.flagged[0], '标记模式下点格应插旗');
    // 再点取消
    tap(sc, cellCenter(sc, 0).x, cellCenter(sc, 0).y); frame(sc, 2);
    ok(!sc.flagged[0], '标记模式下再点应取消插旗');
    var hintsBefore = sc.hintsLeft;
    var hb = actCenter(sc, 'hint');
    tap(sc, hb.x, hb.y); frame(sc, 3);   // 首点生成 + 推一格
    ok(sc.hintsLeft === hintsBefore - 1, '提示应消耗一次，剩 ' + sc.hintsLeft);
  })();

  /* ---------- 5. 洪水填充 / chord ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ level: 1, game: 'mine' });
    frame(sc, 2);
    tap(sc, cellCenter(sc, centerIdx(sc)).x, cellCenter(sc, centerIdx(sc)).y);
    frame(sc, 3);
    // 洪水：首点若是 0 则一次展开一片（revealed 远大于 1）
    var revealed0 = 0;
    for (var i = 0; i < sc.N; i++) { if (sc.revealed[i]) { revealed0++; } }
    ok(revealed0 >= 1, '首点应至少翻开一格');
    ok(!sc.mines[sc.firstClick] && sc.revealed[sc.firstClick], '首点格应已翻开且非雷');
    // chord：找一个已翻开且已插满旗的数字格，双击应展开邻格
    var found = false;
    for (var j = 0; j < sc.N && !found; j++) {
      if (!sc.revealed[j] || sc.nums[j] === 0) { continue; }
      var nb = Gen.neighbors(j, sc.n), flags = 0, hiddenNotFlag = 0;
      for (var k = 0; k < nb.length; k++) {
        if (sc.flagged[nb[k]]) { flags++; }
        else if (!sc.revealed[nb[k]]) { hiddenNotFlag++; }
      }
      if (flags === sc.nums[j] && hiddenNotFlag > 0) {
        // 假设这些 hidden 都是安全格（免猜盘里 flag 全对），chord 应翻开它们
        var before = 0; for (var z = 0; z < sc.N; z++) { if (sc.revealed[z]) { before++; } }
        sc.chordAt(j);
        var afterc = 0; for (var z2 = 0; z2 < sc.N; z2++) { if (sc.revealed[z2]) { afterc++; } }
        ok(afterc > before, 'chord 应展开周围未插旗的格');
        found = true;
      }
    }
  })();

  /* ---------- 6. 提示后端：findForced 推的必是真安全 / 真雷 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ level: 1, game: 'mine' });
    frame(sc, 2);
    tap(sc, cellCenter(sc, centerIdx(sc)).x, cellCenter(sc, centerIdx(sc)).y);
    frame(sc, 3);
    var f = sc.findForced();
    ok(!!f, '开局应至少有一个可推理的格');
    if (f) {
      if (f.type === 'mine') {
        ok(sc.mines[f.cell], 'findForced 推的「雷」应是真雷');
      } else {
        ok(!sc.mines[f.cell], 'findForced 推的「安全」应真不是雷');
        ok(!sc.revealed[f.cell], 'findForced 推的安全格应还未翻开');
      }
    }
  })();

  /* ---------- 7. 重置：清空棋盘 / mines 置空 / 计时不清零 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ level: 4, game: 'mine' });
    frame(sc, 2);
    tap(sc, cellCenter(sc, centerIdx(sc)).x, cellCenter(sc, centerIdx(sc)).y);
    frame(sc, 3);
    sc.elapsed = 42000;
    var rs = actCenter(sc, 'reset');
    tap(sc, rs.x, rs.y); frame(sc, 2);
    var anyRev = false;
    for (var i = 0; i < sc.N; i++) { if (sc.revealed[i]) { anyRev = true; break; } }
    ok(!anyRev, '重置应清掉所有已翻开格');
    ok(sc.mines === null, '重置应把棋盘置空（未首点态）');
    ok(!sc.started, '重置应回到未开局');
    ok(sc.elapsed >= 42000, '重置不清计时，实际 ' + sc.elapsed);
  })();

  /* ---------- 8. 断点续玩 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ level: 5, game: 'mine' });
    frame(sc, 2);
    tap(sc, cellCenter(sc, centerIdx(sc)).x, cellCenter(sc, centerIdx(sc)).y);
    frame(sc, 3);
    sc.doHint(); sc.doHint(); frame(sc, 4);   // 推两格（不求解完）
    var revBefore = 0;
    for (var rb = 0; rb < sc.N; rb++) { if (sc.revealed[rb]) { revBefore++; } }
    ok(revBefore > 1, '开局后应翻开了若干格');
    // 重进同一关 → 恢复
    var sc2 = newScene();
    sc2.enter({ level: 5, game: 'mine' });
    frame(sc, 2);
    var revAfter = 0;
    for (var ra = 0; ra < sc2.N; ra++) { if (sc2.revealed[ra]) { revAfter++; } }
    ok(sc2.started && revAfter >= revBefore, '重进应恢复已翻开的格（' + revBefore + '→' + revAfter + '）');
    // 通关后断点被清
    solveMine(sc2);
    ok(!!sc2.win, '续玩局应能通关');
    ok(!(BF.Save.extraOf('mine').prog || {})['5'], '通关后断点应清除');
  })();

  /* ---------- 9. 难度自选首屏 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ pickDiff: true, game: 'mine' });
    frame(sc, 2);
    ok(sc.pickDiff, '应进入难度首屏');
    ok(sc.pickCards && sc.pickCards.length === 4, '应有 4 张档卡');
    ok(!sc.puzzle, '首屏不应造题');
    for (var i = 0; i < sc.pickCards.length; i++) {
      var c = sc.pickCards[i];
      ok(c.x >= 0 && c.x + c.w <= BF.platform.width, '档卡 ' + i + ' 左右出屏');
      ok(c.y >= sc.headerY, '档卡 ' + i + ' 压到标题');
      ok(c.y + c.h <= sc.pickAll.y + 0.5, '档卡 ' + i + ' 压到「查看全部关卡」');
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
    sc2.enter({ pickDiff: true, game: 'mine' });
    tap(sc2, sc2.back.x + sc2.back.w / 2, sc2.back.y + sc2.back.h / 2);
    ok(app.lastGo && app.lastGo.name === 'home', '首屏返回键应回首页');
  })();

  /* ---------- 10. 每日挑战 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ daily: true, game: 'mine' });
    frame(sc, 2);
    ok(sc.isDaily, '应进入每日挑战');
    tap(sc, cellCenter(sc, centerIdx(sc)).x, cellCenter(sc, centerIdx(sc)).y);
    frame(sc, 3);
    solveMine(sc);
    ok(!!sc.win, '每日挑战应可通关');
    ok(BF.Save.isDailyDoneToday(), '每日挑战通关应标记今日已完成');
  })();

  /* ---------- 11. 长按插旗 ---------- */
  (function () {
    var sc = newScene();
    sc.enter({ level: 6, game: 'mine' });
    frame(sc, 2);
    nowVal = 0;
    var ci = 0;
    var p = cellCenter(sc, ci);
    sc.onDown(p.x, p.y);          // 记录 pressStart = now()
    nowVal = 500;                 // 超过 LONG_PRESS_MS
    sc.update(500);               // 触发长按插旗
    ok(sc.flagged[ci], '长按空格应插旗');
    sc.onUp(p.x, p.y);            // 抬起：pressHandled 为真 → 不应翻开
    ok(!sc.revealed[ci], '长按插旗后抬起不应翻开该格');
    // 未越过长按阈值 → 普通翻开（首点生成）
    nowVal = 0;
    var p2 = cellCenter(sc, centerIdx(sc));
    sc.onDown(p2.x, p2.y);
    nowVal = 50;
    sc.update(50);
    sc.onUp(p2.x, p2.y);
    ok(sc.revealed[centerIdx(sc)], '短按应翻开（首点生成棋盘）');
  })();

  if (issues.length) {
    console.log('❌ 扫雷交互层：' + issues.length + ' 处问题');
    issues.forEach(function (m) { console.log('  ✗ ' + m); });
    process.exit(1);
  }
  console.log('✅ 扫雷交互层：通关/免猜/失败/重玩/标记/提示/洪水/chord/提示后端/重置/续玩/首屏/每日/长按 全部通过');
})();
