/**
 * 用"假 canvas + 假平台"把瓶子场景真实跑起来，验证**交互逻辑**（不是像素）：
 *   选瓶 → 交换 → "对了 X/N" → 全对过关 → 按 par 算星；以及取消选择、重置、几何不溢出。
 * 这样不用真机/浏览器也能确认状态机没写错（绘制部分委托给 D.*，与已验证的 diff 场景同源）。
 */
(function () {
  var path = require('path');
  var root = path.resolve(__dirname, '..');
  global.BF = {};
  require(path.join(root, 'js/core/ns.js'));

  // 假 draw / theme / platform / save
  var D = new Proxy({}, { get: function (t, p) {
    if (p === 'FONT') { return 'sans'; }
    return function () { return undefined; };
  } });
  BF.draw = D;
  BF.theme = {
    text: '#222', textSub: '#888', bg: '#eee', bgTop: '#fff', accent: '#3a6fbf',
    accentDeep: '#2f5aa0', gold: '#f5b', ok: '#2a9', scrim: '#0008', panel: '#fff',
    panelEdge: '#ddd', slot: '#eee', slotEdge: '#ccc', slotShadow: '#0001',
    boardFrameTop: '#ccc', boardFrameBottom: '#bbb', boardInner: '#f5f5f5',
    tray: '#fafafa', shadow: '#0001'
  };
  var ctx = new Proxy({}, {
    get: function (t, p) {
      if (p === 'measureText') { return function () { return { width: 10 }; }; }
      if (p === 'createLinearGradient' || p === 'createRadialGradient') {
        return function () { return { addColorStop: function () {} }; };
      }
      if (p === 'getImageData') { return function () { return { data: [0, 0, 0, 0] }; }; }
      if (p === 'toDataURL') { return function () { return ''; }; }
      return function () {};
    },
    set: function () { return true; }
  });
  BF.platform = {
    width: 390, height: 844, safeTop: 44, safeBottom: 34, dpr: 2,
    now: function () { return 0; }, vibrate: function () {}, requestFrame: function () {},
    bindPointer: function () {}, createImage: function () {}, ctx: ctx
  };
  var store = {};
  BF.Save = {
    bucket: function (g) { return store[g] || (store[g] = { unlocked: 60, cleared: {}, stars: {} }); },
    clear: function (g, n, s) { var b = this.bucket(g); b.cleared[n] = s; b.stars[n] = s; if (!b.unlocked || b.unlocked < n) { b.unlocked = n; } },
    clearDaily: function () {}, resetAll: function () { store = {}; },
    unlockedOf: function () { return 60; }, clearedCount: function () { return 1; },
    totalStars: function () { return 3; }, starsOf: function () { return 3; },
    isCleared: function () { return false; }, countAll: function () { return 1; },
    starsAll: function () { return 3; }, data: { daily: {} }, load: function () {}, flush: function () {}
  };

  require(path.join(root, 'js/game/bottle.js'));
  require(path.join(root, 'js/scenes/bottle.js'));
  require(path.join(root, 'js/scenes/ruletip.js'));
  BF.RuleTip.on = false;   // harness 默认关掉规则弹框（enter 后输入会被拦走）

  var Scene = BF.SceneBottle;
  var app = { go: function () {} };
  var issues = [];

  function tap(sc, i) {
    var s = sc.playerSlots[i];
    sc.onDown(s.x + s.w / 2, s.y + s.h / 2);
    sc.onUp(s.x + s.w / 2, s.y + s.h / 2);
  }
  function drag(sc, from, to) {
    var a = sc.playerSlots[from], b = sc.playerSlots[to];
    sc.onDown(a.x + a.w / 2, a.y + a.h / 2);
    sc.onMove(b.x + b.w / 2, b.y + b.h / 2);   // 大位移 → 触发拖动
    sc.onUp(b.x + b.w / 2, b.y + b.h / 2);
  }
  function fitIn(sc) {
    var W = BF.platform.width, H = BF.platform.height;
    var all = sc.targetSlots.concat(sc.playerSlots);
    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      if (r.x < 0 || r.y < 0 || r.x + r.w > W + 0.5 || r.y + r.h > H + 0.5) { return false; }
    }
    return true;
  }

  // 1) 全 7 关：模拟贪心解开，断言能过关、交换数=par、星级合法、几何不溢出、render 不抛错
  for (var n = 1; n <= BF.BottleGen.TOTAL; n++) {
    var sc = new Scene(app);
    sc.enter({ level: n, game: 'bottle' });
    if (!fitIn(sc)) { issues.push('L' + n + ' 瓶子超出屏幕'); }
    try { sc.render(ctx); } catch (e) { issues.push('L' + n + ' render 抛错: ' + e.message); }
    var guard = 0;
    while (sc.correct < sc.order.length && guard < 80) {
      guard++;
      var i = -1, k;
      for (k = 0; k < sc.order.length; k++) { if (sc.order[k] !== sc.target[k]) { i = k; break; } }
      if (i < 0) { break; }
      var j = -1;
      for (k = 0; k < sc.order.length; k++) { if (sc.order[k] === sc.target[i]) { j = k; break; } }
      tap(sc, i); tap(sc, j);
    }
    if (sc.correct !== sc.order.length) { issues.push('L' + n + ' 没解开 (correct=' + sc.correct + ')'); }
    if (!sc.win) { issues.push('L' + n + ' 解开却没触发过关'); }
    else if (sc.win.stars < 1 || sc.win.stars > 3) { issues.push('L' + n + ' 星级非法: ' + sc.win.stars); }
    if (sc.swaps !== sc.puzzle.par) {
      issues.push('L' + n + ' 交换数 ' + sc.swaps + ' ≠ par ' + sc.puzzle.par);
    }
  }

  // 2) 取消选择：点同一个瓶子两次 → selected 回到 -1
  var sc2 = new Scene(app); sc2.enter({ level: 3, game: 'bottle' });
  tap(sc2, 0);
  if (sc2.selected !== 0) { issues.push('点选后 selected 应为 0，实际 ' + sc2.selected); }
  tap(sc2, 0);
  if (sc2.selected !== -1) { issues.push('再点自己应取消选择，实际 ' + sc2.selected); }

  // 3) 重置：交换一次后 reset → 回到初始、swaps=0
  var sc3 = new Scene(app); sc3.enter({ level: 5, game: 'bottle' });
  var init = sc3.order.join(',');
  tap(sc3, 0); tap(sc3, 1);
  if (sc3.swaps !== 1) { issues.push('一次交换后 swaps 应为 1'); }
  sc3.doAction('reset');
  if (sc3.order.join(',') !== init) { issues.push('重置后未回到初始排列'); }
  if (sc3.swaps !== 0) { issues.push('重置后 swaps 应为 0'); }

  // 4) 提示：至少能减少一个未对位置
  var sc4 = new Scene(app); sc4.enter({ level: 7, game: 'bottle' });
  var before = sc4.correct;
  sc4.doAction('hint');
  if (sc4.correct < before) { issues.push('提示后"对了"数不应变少'); }
  if (sc4.swaps !== 1) { issues.push('提示应计 1 次交换'); }

  // 5) 标记模式：进入后可切换记号，且不改变排列 / 交换数 / 选中态
  var sc5 = new Scene(app); sc5.enter({ level: 6, game: 'bottle' });
  sc5.doAction('mark');
  if (!sc5.markMode) { issues.push('点「标记」后 markMode 应为 true'); }
  var ord5 = sc5.order.join(',');
  tap(sc5, 0);
  if (!sc5.marks[0]) { issues.push('标记模式点瓶子应打上记号'); }
  if (sc5.selected !== -1) { issues.push('标记模式不应触发选中'); }
  if (sc5.order.join(',') !== ord5 || sc5.swaps !== 0) { issues.push('标记模式不应改变排列或交换数'); }
  tap(sc5, 0);
  if (sc5.marks[0]) { issues.push('再点应取消记号'); }
  sc5.doAction('mark');
  if (sc5.markMode) { issues.push('再点「标记」应退出标记模式'); }
  // 标记模式下 render（画 drawMark）不抛错
  try { sc5.render(ctx); } catch (e) { issues.push('标记态 render 抛错: ' + e.message); }

  // 6) 拖动交换：onDown 源 → onMove 越阈值 → onUp 命中别的瓶 → 交换；松在同瓶/空白则取消
  var sc6 = new Scene(app); sc6.enter({ level: 5, game: 'bottle' });
  var before6 = sc6.order.join(',');
  drag(sc6, 0, 3);
  if (sc6.order.join(',') === before6) { issues.push('拖动 (0→3) 应交换位置'); }
  if (sc6.swaps !== 1) { issues.push('一次拖动应计 1 次交换'); }
  if (sc6.selected !== -1) { issues.push('拖动后应清空选中态'); }
  if (sc6.drag !== null) { issues.push('拖动结束 drag 应为 null'); }
  // render 在拖动中（moved）不抛错：手动造一个 drag 态再 render
  sc6.drag = { from: 0, x: sc6.playerSlots[0].x + sc6.playerSlots[0].w / 2,
               y: sc6.playerSlots[0].y, moved: true, toSlot: 1, thr: 8 };
  try { sc6.render(ctx); } catch (e) { issues.push('拖动态 render 抛错: ' + e.message); }
  sc6.drag = null;
  // 拖动到同一瓶（视为取消，不应交换）
  var sc6b = new Scene(app); sc6b.enter({ level: 5, game: 'bottle' });
  var b6 = sc6b.order.join(',');
  var s0 = sc6b.playerSlots[0];
  sc6b.onDown(s0.x + s0.w / 2, s0.y + s0.h / 2);
  sc6b.onMove(s0.x + s0.w / 2 + 30, s0.y + s0.h / 2 + 2); // 越阈值
  sc6b.onUp(s0.x + s0.w / 2, s0.y + s0.h / 2);             // 落回同瓶
  if (sc6b.order.join(',') !== b6) { issues.push('拖回同瓶不应交换'); }
  if (sc6b.swaps !== 0) { issues.push('拖回同瓶不应计交换'); }

  // 7) 动态评分线：随瓶子数单调递增（难度越高越宽容），且 3★ 容差 ≥1、2★ > 3★
  var prev3 = 0, prev2 = 0, seq = [];
  for (var c = 4; c <= 10; c++) {
    var th = (new Scene(app)).thresholdsFor(c);
    if (th.three < 1) { issues.push('c=' + c + ' 3★ 容差应 ≥1'); }
    if (th.two <= th.three) { issues.push('c=' + c + ' 2★ 容差应 > 3★'); }
    if (th.three < prev3 || th.two < prev2) { issues.push('c=' + c + ' 评分容差应随难度单调递增'); }
    prev3 = th.three; prev2 = th.two;
    seq.push(c + '瓶:' + th.three + '/' + th.two);
  }

  if (issues.length) {
    console.error('❌ 交互逻辑问题 ' + issues.length + ' 条:');
    for (var i = 0; i < issues.length; i++) { console.error('  - ' + issues[i]); }
    process.exit(1);
  }
  console.log('✅ 瓶子颜色推理 · 交互逻辑全过（选/换/拖动/过关/星级/取消选择/重置/提示/标记 · 7 关可解 · 几何不溢出）');
  console.log('   动态评分线 3★/2★ 容差（相对 par）: ' + seq.join('  '));
})();
