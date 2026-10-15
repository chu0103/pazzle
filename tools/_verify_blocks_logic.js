/**
 * _verify_blocks_logic.js —— 超级积木「交互层」验证（node tools/_verify_blocks_logic.js）
 *
 * 用「假 canvas + 假平台 + 假 Save」把 blocks 场景真实跑起来，验证交互逻辑（不是像素）：
 *   1. 全 40 关：enter → 几何不溢出 → render 不抛 → 按标准解真实拖拽通关 → 3 星 + 存档；
 *   2. 落子合法性：压暗格被拒 / 越界被拒 / 重叠被拒 / 拖出棋盘取回托盘不计失误；
 *   3. 颜色约束：托盘里只出现指定颜色的积木；
 *   4. 旋转 4 次回到原状；重置恢复初始；提示每关限 1 次且摆到标准解位置；
 *   5. 星级线：0 提示 0 失误 = 3★；1 次失误 = 2★；
 *   6. 限时挑战：超时 → timeout 结算；提前完成 → 按剩余时间给 S~E；
 *   7. 每日挑战：可拖拽通关 + daily 标记。
 */
(function () {
  var path = require('path');
  var root = path.resolve(__dirname, '..');
  global.BF = {};
  require(path.join(root, 'js/core/ns.js'));

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
      if (p === 'measureText') { return function () { return { width: 10 }; }; }
      if (p === 'createLinearGradient' || p === 'createRadialGradient') {
        return function () { return { addColorStop: function () {} }; };
      }
      return function () {};
    },
    set: function () { return true; }
  });
  BF.platform = {
    width: 390, height: 844, safeTop: 44, safeBottom: 34, dpr: 2,
    now: function () { return 0; }, vibrate: function () {}, requestFrame: function () {},
    bindPointer: function () {}, ctx: ctx
  };
  var store = {};
  BF.Save = {
    bucket: function (g) { return store[g] || (store[g] = { unlocked: 60, cleared: {}, stars: {} }); },
    clear: function (g, n, s) { var b = this.bucket(g); b.cleared[n] = s; b.stars[n] = s; },
    clearDaily: function (s) { store.daily = { cleared: true, stars: s }; },
    resetAll: function () { store = {}; },
    unlockedOf: function () { return 60; }, clearedCount: function () { return 1; },
    totalStars: function () { return 3; }, starsOf: function () { return 3; },
    isCleared: function () { return false; }, countAll: function () { return 1; },
    starsAll: function () { return 3; }, data: { daily: {} }, load: function () {}, flush: function () {}
  };

  require(path.join(root, 'js/game/blocks.js'));
  require(path.join(root, 'js/scenes/diffpick.js'));
  require(path.join(root, 'js/scenes/ruletip.js'));
  BF.RuleTip.on = false;   // harness 默认关掉规则弹框（enter 后输入会被拦走）
  require(path.join(root, 'js/scenes/blocks.js'));

  var Scene = BF.SceneBlocks;
  var Gen = BF.BlocksGen;
  var app = { go: function () {} };
  var issues = [];
  function ok(cond, msg) { if (!cond) { issues.push(msg); } }

  /** 渲染一帧（顺带刷新 trayTokens 命中区） */
  function frame(sc) { sc.update(16); sc.render(ctx); }

  /** 托盘里某块「实际绘制中心」屏幕坐标（抓取点应落在这里，才与场景的抓取偏移一致） */
  function trayCenter(piece) {
    var td = piece._tray;
    var bb = Gen.bbox(Gen.PIECE_ROT[piece.id][piece.rot]);
    return { x: td.x + bb.w * td.cs / 2, y: td.y + bb.h * td.cs / 2 };
  }

  /** 把托盘里的 piece 拖到棋盘 (gx,gy)（真实指针事件）。
   *  注意：场景的 tap/drag 判定首次 onMove 只记录起点，第二次才越阈值 → 必须发两次 move。 */
  function dragTo(sc, piece, gx, gy) {
    frame(sc);
    var ti = -1;
    for (var i = 0; i < sc.trayTokens.length; i++) {
      if (sc.trayTokens[i].piece === piece) { ti = i; break; }
    }
    if (ti < 0) { return false; }
    var bb = Gen.bbox(Gen.PIECE_ROT[piece.id][piece.rot]);
    var tx = sc.boardX + (gx + bb.w / 2) * sc.cell;
    var ty = sc.boardY + (gy + bb.h / 2) * sc.cell;
    var s = trayCenter(piece);
    sc.onDown(s.x, s.y);
    sc.onMove(s.x + 1, s.y + 1);    // 起手微移（越过 tap/drag 阈值判定）
    sc.onMove(tx, ty);
    sc.onUp(tx, ty);
    return true;
  }

  /** 从托盘第一块拖到绝对坐标 (tx,ty)（用于棋盘外等非网格目标） */
  function dragRaw(sc, tx, ty) {
    frame(sc);
    if (!sc.trayTokens.length) { return false; }
    var piece = sc.trayTokens[0].piece;
    var s = trayCenter(piece);
    sc.onDown(s.x, s.y);
    sc.onMove(s.x + 1, s.y + 1);
    sc.onMove(tx, ty);
    sc.onUp(tx, ty);
    return true;
  }

  /** 按标准解把全部积木摆好（逐块真实拖拽） */
  function solveByDrag(sc) {
    for (var i = 0; i < sc.pieces.length; i++) {
      var pc = sc.pieces[i], std = sc.stdById[pc.id];
      if (pc.placed) { continue; }
      if (!dragTo(sc, pc, std.x, std.y)) {
        issues.push('L' + sc.level + ' 托盘里找不到积木 #' + pc.id);
        return false;
      }
      if (!pc.placed) {
        issues.push('L' + sc.level + ' 积木 #' + pc.id + ' 拖到标准解位置却被拒（解应合法）');
        return false;
      }
    }
    return true;
  }

  /** 几何不溢出：棋盘/托盘/按钮/命中区都在屏内 */
  function fitIn(sc) {
    var W = BF.platform.width, H = BF.platform.height;
    var rects = [
      { x: sc.boardX, y: sc.boardY, w: sc.boardW, h: sc.boardW },
      { x: 12, y: sc.trayY, w: W - 24, h: sc.trayH }
    ].concat(sc.btns);
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (r.x < -0.5 || r.y < -0.5 || r.x + r.w > W + 0.5 || r.y + r.h > H + 0.5) { return false; }
    }
    for (var k = 0; k < (sc.trayTokens || []).length; k++) {
      var t = sc.trayTokens[k];
      if (t.y + t.h > H + 0.5) { return false; }
    }
    return true;
  }

  var TOTAL = BF.games.blocks.TOTAL;

  /* ---------- 1. 全 40 关：真实拖拽通关 + 3 星 + 存档隔离 ---------- */
  for (var n = 1; n <= TOTAL; n++) {
    var sc = new Scene(app);
    sc.enter({ level: n, game: 'blocks' });
    if (!fitIn(sc)) { issues.push('L' + n + ' 版面超出屏幕'); }
    try { frame(sc); } catch (e) { issues.push('L' + n + ' render 抛错: ' + e.message); }

    // 颜色约束：托盘积木必须全部来自指定颜色组
    for (var i = 0; i < sc.pieces.length; i++) {
      if (sc.colors.indexOf(Gen.SHAPES[sc.pieces[i].id].c) < 0) {
        issues.push('L' + n + ' 托盘里出现了非指定颜色的积木 #' + sc.pieces[i].id);
      }
    }

    if (!solveByDrag(sc)) { continue; }
    if (!sc.win) { issues.push('L' + n + ' 摆满却没触发过关'); continue; }
    if (sc.win.stars !== 3) {
      issues.push('L' + n + ' 零提示零失误应 3 星，实际 ' + sc.win.stars);
    }
    if (sc.illegal !== 0 || sc.hintCount !== 0) {
      issues.push('L' + n + ' 标准解拖拽不应产生失误/提示（illegal=' + sc.illegal +
        ' hint=' + sc.hintCount + '）');
    }
    var b = BF.Save.bucket('blocks');
    if (b.cleared[n] !== 3) { issues.push('L' + n + ' 通关后存档星级应为 3，实际 ' + b.cleared[n]); }
  }
  console.log('1. 全 ' + TOTAL + ' 关真实拖拽通关 / 3 星 / 存档 / 颜色约束 / 几何 ✔（问题 ' + issues.length + '）');

  /* ---------- 2. 落子合法性（L1） ---------- */
  (function () {
    var sc = new Scene(app);
    sc.enter({ level: 1, game: 'blocks' });
    frame(sc);
    var pc = sc.pieces[0], std = sc.stdById[pc.id];

    // 2a. 压暗格 → 被拒 + 计 1 次失误 + 不落子
    var dark = -1;
    for (var k = 0; k < 64; k++) { if (!sc.lit[k]) { dark = k; break; } }
    ok(dark >= 0, 'L1 应存在暗格');
    var dx = dark % 8, dy = (dark / 8) | 0;
    var moved = dragTo(sc, pc, dx, dy);
    ok(moved, 'L1 托盘里应有积木可拖');
    ok(!pc.placed, '压暗格不该落子');
    ok(sc.illegal === 1, '压暗格应计 1 次失误，实际 ' + sc.illegal);
    ok(!!sc.flash, '非法落子应触发红闪');
    ok(!!sc.toast, '非法落子应弹说明');

    // 2b. 越界（拖到棋盘外沿）→ 不落子、不计失误
    var sc2 = new Scene(app);
    sc2.enter({ level: 1, game: 'blocks' });
    frame(sc2);
    var p2 = sc2.pieces[0];
    var ox = sc2.boardX + sc2.boardW + sc2.cell * 2, oy = sc2.boardY + sc2.cell * 2;
    dragRaw(sc2, ox, oy);
    ok(!p2.placed, '拖到棋盘外不该落子');
    ok(sc2.illegal === 0, '拖出棋盘放回托盘不计失误，实际 ' + sc2.illegal);

    // 2c. 重叠：先合法放一块，再拖另一块压上去 → 被拒
    var sc3 = new Scene(app);
    sc3.enter({ level: 1, game: 'blocks' });
    frame(sc3);
    var pa = sc3.pieces[0], sa = sc3.stdById[pa.id];
    ok(dragTo(sc3, pa, sa.x, sa.y) && pa.placed, 'L1 第一块应能放到标准解位置');
    // 找第二块，把它拖到与第一块重叠的位置（第一块占的任一格）
    var pb = null;
    for (var q = 1; q < sc3.pieces.length; q++) { if (!sc3.pieces[q].placed) { pb = sc3.pieces[q]; break; } }
    ok(!!pb, 'L1 应有第二块积木');
    if (pb) {
      var bbA = Gen.PIECE_ROT[pa.id][pa.rot];
      var cellX = sa.x + bbA[0][0], cellY = sa.y + bbA[0][1];
      // 让 pb 的包围盒左上角对准重叠格（拖过去后 snap 到该格附近即重叠）
      var bbB = Gen.bbox(Gen.PIECE_ROT[pb.id][pb.rot]);
      ok(dragTo(sc3, pb, cellX - 0, cellY - 0) !== false, '第二块应在托盘里');
      // dragTo 是以包围盒中心对手指；直接构造一次压在第一块左上角中心
      frame(sc3);
      var ti = -1;
      for (var w = 0; w < sc3.trayTokens.length; w++) {
        if (sc3.trayTokens[w].piece === pb) { ti = w; break; }
      }
      if (ti >= 0) {
        var fx = sc3.boardX + (cellX + 0.5) * sc3.cell, fy = sc3.boardY + (cellY + 0.5) * sc3.cell;
        var s3 = trayCenter(pb);
        sc3.onDown(s3.x, s3.y);
        sc3.onMove(fx, fy);
        sc3.onUp(fx, fy);
        ok(!pb.placed || pb.x !== cellX || pb.y !== cellY,
          '第二块不该落到与第一块重叠的位置（实际 x=' + pb.x + ' y=' + pb.y + '）');
      }
    }

    // 2d. 取下积木：点一下盘上的积木 → 回托盘（对应实物"取出来"）
    var sc4 = new Scene(app);
    sc4.enter({ level: 1, game: 'blocks' });
    frame(sc4);
    var pd = sc4.pieces[0], sd = sc4.stdById[pd.id];
    ok(dragTo(sc4, pd, sd.x, sd.y) && pd.placed, '先合法放一块');
    var csd = Gen.PIECE_ROT[pd.id][pd.rot];
    var tapX = sc4.boardX + (sd.x + csd[0][0] + 0.5) * sc4.cell;
    var tapY = sc4.boardY + (sd.y + csd[0][1] + 0.5) * sc4.cell;
    sc4.onDown(tapX, tapY);
    sc4.onUp(tapX, tapY);
    ok(!pd.placed, '点一下盘上的积木应取回托盘');
    ok(sc4.covered === 0, '取回后覆盖数应归零');
  })();
  console.log('2. 落子合法性：压暗格拒 / 越界不计失误 / 重叠拒 / 取下回托盘 ✔（累计问题 ' + issues.length + '）');

  /* ---------- 3. 旋转 / 重置 / 提示 ---------- */
  (function () {
    var sc = new Scene(app);
    sc.enter({ level: 5, game: 'blocks' });
    frame(sc);
    var pc = sc.pieces[0];
    var r0 = pc.rot, nRot = Gen.PIECE_ROT[pc.id].length;
    for (var i = 0; i < nRot; i++) { sc.rotatePiece(pc); }
    ok(pc.rot === r0, '旋转 ' + nRot + ' 次应回到原状，实际 ' + pc.rot);

    // 双击托盘积木也能旋转
    frame(sc);
    var s1 = trayCenter(pc);
    sc.onDown(s1.x, s1.y);
    sc.onUp(s1.x, s1.y);                                // 单击选中
    sc.onDown(s1.x, s1.y);
    sc.onUp(s1.x, s1.y);                                // 双击 → 旋转
    ok(pc.rot === (r0 + 1) % nRot, '双击托盘积木应旋转一次，实际 ' + pc.rot);
    sc.rotatePiece(pc);   // 转回去，保持后续测试干净

    // 提示：第一块摆到标准解；第二次提示被拒
    sc.doHint();
    var target = null;
    for (var i = 0; i < sc.pieces.length; i++) { if (!sc.pieces[i].placed) { target = sc.pieces[i]; break; } }
    ok(sc.hintCount === 1, '提示后 hintCount 应为 1');
    var anyStd = false;
    for (var k = 0; k < sc.pieces.length; k++) {
      var s = sc.stdById[sc.pieces[k].id];
      if (sc.pieces[k].placed && sc.pieces[k].x === s.x && sc.pieces[k].y === s.y &&
          sc.pieces[k].rot === s.rot) { anyStd = true; }
    }
    ok(anyStd, '提示应把一块摆到标准解位置');
    var hintBefore = sc.hintCount;
    sc.doHint();
    ok(sc.hintCount === hintBefore, '每关提示应限 1 次');
    ok(!!sc.toast && sc.toast.text.indexOf('已用完') >= 0, '第二次提示应提示已用完');

    // 重置：全部回托盘 + 姿态回标准解初始
    sc.doAction('reset');
    var allBack = sc.pieces.every(function (p) {
      var s = sc.stdById[p.id];
      return !p.placed && p.rot === s.rot && p.x === s.x && p.y === s.y;
    });
    ok(allBack, '重置后应全部回托盘且姿态复位');
    ok(sc.covered === 0, '重置后覆盖数应归零');

    // 旋转按钮作用于选中积木
    frame(sc);
    var s2 = trayCenter(sc.pieces[0]);
    sc.onDown(s2.x, s2.y);
    sc.onUp(s2.x, s2.y);                                // 选中
    var sel = sc.selected, selRot = sel.rot;
    sc.doAction('rotate');
    ok(sel.rot !== selRot, '旋转按钮应转动选中积木');
  })();
  console.log('3. 旋转（连转/双击/按钮）/ 重置 / 提示限 1 次 ✔（累计问题 ' + issues.length + '）');

  /* ---------- 4. 星级线：1 次失误 → 2 星 ---------- */
  (function () {
    var sc = new Scene(app);
    sc.enter({ level: 3, game: 'blocks' });
    frame(sc);
    var pc = sc.pieces[0];
    var dark = -1;
    for (var k = 0; k < 64; k++) { if (!sc.lit[k]) { dark = k; break; } }
    dragTo(sc, pc, dark % 8, (dark / 8) | 0);   // 故意失误 1 次
    ok(sc.illegal === 1, '应有 1 次失误');
    solveByDrag(sc);
    ok(!!sc.win, '失误后仍应能通关');
    ok(sc.win && sc.win.stars === 2, '1 次失误应 2 星，实际 ' + (sc.win && sc.win.stars));

    // 提示通关 → 2 星
    var sc2 = new Scene(app);
    sc2.enter({ level: 3, game: 'blocks' });
    frame(sc2);
    sc2.doHint();                       // 用掉唯一提示（自动摆一块）
    solveByDrag(sc2);
    ok(!!sc2.win && sc2.win.stars === 2, '用过提示应 2 星，实际 ' + (sc2.win && sc2.win.stars));
  })();
  console.log('4. 星级线：0 失误 3★ / 1 失误或 1 提示 2★ ✔（累计问题 ' + issues.length + '）');

  /* ---------- 5. 限时挑战 ---------- */
  (function () {
    BF.Save.resetAll();   // 与第 1 段的通关存档隔离
    // 5a. 超时 → timeout 结算，不计通关
    var sc = new Scene(app);
    sc.enter({ level: 10, game: 'blocks' });
    frame(sc);
    ok(sc.timed, '第 10 关应是限时挑战');
    ok(sc.puzzle.timeLimit > 0, '限时题应有倒计时');
    for (var i = 0; i < 200; i++) { sc.update(1000); }   // 烧完时间
    ok(!!sc.win && sc.win.timeout === true, '超时应进入 timeout 结算');
    ok(sc.win && sc.win.stars === 0, '超时不计星');
    ok(BF.Save.bucket('blocks').cleared[10] === undefined, '超时不该写通关存档');

    // 5b. 提前解完 → 按剩余时间给评级
    var sc2 = new Scene(app);
    sc2.enter({ level: 10, game: 'blocks' });
    frame(sc2);
    sc2.update(2000);                    // 只用 2s
    solveByDrag(sc2);
    ok(!!sc2.win && !sc2.win.timeout, '提前解完应正常结算');
    var ratio = sc2.timeLeft / sc2.puzzle.timeLimit;
    var expect = Gen.rankFor(ratio);
    ok(sc2.rank === expect, '限时评级应为 ' + expect + '（剩余 ' + (ratio * 100).toFixed(0) + '%），实际 ' + sc2.rank);
    ok(['S', 'A', 'B', 'C', 'D'].indexOf(sc2.rank) >= 0, '提前完成不应是 E');

    // 5c. 压线超时前解完 → D/E 边界由 rankFor 兜底（数据层已测），这里测"最后 1 秒解完"不崩
    var sc3 = new Scene(app);
    sc3.enter({ level: 20, game: 'blocks' });
    frame(sc3);
    ok(sc3.timed, '第 20 关应是限时挑战');
    sc3.update(sc3.puzzle.timeLimit - 500);
    solveByDrag(sc3);
    ok(!!sc3.win, '压线解完应能结算');
  })();
  console.log('5. 限时挑战：超时 timeout / 提前 S~D / 压线 ✔（累计问题 ' + issues.length + '）');

  /* ---------- 6. 每日挑战 ---------- */
  (function () {
    var sc = new Scene(app);
    sc.enter({ daily: true, game: 'blocks' });
    frame(sc);
    ok(sc.isDaily, '应进入每日挑战');
    ok(sc.puzzle.colors.length >= 2, '每日挑战应是双色，实际 ' + JSON.stringify(sc.puzzle.colors));
    if (!solveByDrag(sc)) { return; }
    ok(!!sc.win, '每日挑战应能通关');
    ok(store.daily && store.daily.cleared === true, '每日挑战通关应写 daily 存档');
    // 「下一关」应回首页（每日没有下一关）
    sc.next();
  })();
  console.log('6. 每日挑战通关 + daily 存档 ✔（累计问题 ' + issues.length + '）');

  /* ---------- 结果 ---------- */
  if (issues.length) {
    console.log('❌ 失败 ' + issues.length + ' 项:');
    issues.forEach(function (m) { console.log('   - ' + m); });
    process.exit(1);
  } else {
    console.log('✅ 超级积木交互层验证全部通过');
  }
})();
