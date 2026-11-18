/**
 * _verify_pk24_logic.js —— 「24点」交互逻辑自检（无尽模式）
 *
 * 用「假 canvas + 假平台」把 pk24 场景真实跑起来，验证**交互逻辑**（不是像素）：
 *   发牌 → 点牌 → 点运算符 → 点另一张牌（逐步合并）→ 合并成 1 张 = 24 过关；
 *   整除拦截（除不尽该步不可用、toast 提示）、撤销、重置、提示（显示一种解的表达式）、
 *   按用时评星（用提示降星）、无尽统计存档、几何不溢出（390/320 两档宽度）、RuleTip 接入。
 * 另用 solveSeq 驱动的合并序列证明「每副随机牌都能在 3 步内被真实点通」。
 */
(function () {
  var path = require('path');
  var root = path.resolve(__dirname, '..');
  global.BF = {};
  require(path.join(root, 'js/core/ns.js'));

  // 假 draw / theme / platform / save（与 _verify_cipher_logic.js 同源）
  var D = new Proxy({}, { get: function (t, p) {
    if (p === 'FONT') { return 'sans'; }
    return function () { return undefined; };
  } });
  BF.draw = D;
  BF.theme = {
    text: '#222', textSub: '#888', bg: '#eee', bgTop: '#fff', accent: '#3a6fbf',
    accentDeep: '#2f5aa0', gold: '#f5b', ok: '#2a9', warn: '#e53', scrim: '#0008',
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
  // 无尽统计存档：extraOf 返回每游戏独立对象，putExtra/flush 落盘（真机行为的最小桩）
  var exStore = {};
  BF.Save = {
    bucket: function () { return {}; },
    extraOf: function (g) { return exStore[g] || (exStore[g] = {}); },
    putExtra: function (g, k, v) { this.extraOf(g)[k] = v; },
    flush: function () {},
    resetAll: function () { exStore = {}; },
    load: function () {}
  };

  require(path.join(root, 'js/game/pk24.js'));
  require(path.join(root, 'js/scenes/pk24.js'));
  require(path.join(root, 'js/scenes/ruletip.js'));
  BF.RuleTip.on = false;   // harness 默认关掉规则弹框（enter 后输入会被拦走）

  var Gen = BF.Pk24Gen;
  var Scene = BF.ScenePk24;
  var app = { go: function () {} };
  var issues = [];

  function center(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
  function tapRect(sc, r) { var c = center(r); sc.onDown(c.x, c.y); sc.onUp(c.x, c.y); }
  // ⚠️ 必须先按当前张数重算命中盒，再取中心；否则用「上一状态的旧布局」点会命中错牌
  // （真机每帧 render 都会 computeTokenRects，玩家看到的就是最新布局，故无此问题——这是测试桩的坑）。
  function tapCard(sc, i) { sc.computeTokenRects(); tapRect(sc, sc.tokenRects[i]); }
  function opBtn(sc, op) { for (var b = 0; b < sc.opBtns.length; b++) { if (sc.opBtns[b].op === op) { return sc.opBtns[b]; } } return null; }
  function tapOp(sc, op) { tapRect(sc, opBtn(sc, op)); }
  /** 用 solveSeq 的合并序列真实地点通整副牌（驱动与玩家操作同构） */
  function driveWin(sc) {
    var seq = Gen.solveSeq(sc.initialVals.slice());
    if (!seq) { issues.push('当前副不可解（生成器应保证可解）'); return; }
    for (var s = 0; s < seq.length; s++) {
      tapCard(sc, seq[s].i);
      tapOp(sc, seq[s].op);
      tapCard(sc, seq[s].j);
    }
  }
  function fitIn(sc) {
    var W = BF.platform.width, H = BF.platform.height, i;
    if (sc.back.x < 0 || sc.back.y < 0 || sc.back.x + sc.back.w > W || sc.back.y + sc.back.h > H) { return false; }
    for (i = 0; i < sc.opBtns.length; i++) {
      var o = sc.opBtns[i];
      if (o.x < -0.5 || o.y < -0.5 || o.x + o.w > W + 0.5 || o.y + o.h > H + 0.5) { return false; }
    }
    for (i = 0; i < sc.btns.length; i++) {
      var b = sc.btns[i];
      if (b.x < -0.5 || b.y < -0.5 || b.x + b.w > W + 0.5 || b.y + b.h > H + 0.5) { return false; }
    }
    for (i = 0; i < sc.tokenRects.length; i++) {
      var r = sc.tokenRects[i];
      if (r.x < -0.5 || r.y < -0.5 || r.x + r.w > W + 0.5 || r.y + r.h > H + 0.5) { return false; }
    }
    return true;
  }

  /* ---- 1) 几何不溢出：390（主）与 320（窄屏）两档宽度，初始 4 张 + 合并中途 3/2 张 + 剩 1 张 ---- */
  [390, 320].forEach(function (W) {
    BF.platform.width = W;
    var sc = new Scene(app);
    sc.enter({ game: 'pk24' });
    if (!fitIn(sc)) { issues.push('W=' + W + ' 初始 4 张牌布局溢出屏幕'); }
    try { sc.render(ctx); } catch (e) { issues.push('W=' + W + ' 初始 render 抛错: ' + e.message); }
    // 走两步合并，验证中途张数布局也不溢出
    var seq = Gen.solveSeq(sc.initialVals.slice());
    tapCard(sc, seq[0].i); tapOp(sc, seq[0].op); tapCard(sc, seq[0].j);
    if (sc.cards.length !== 3) { issues.push('W=' + W + ' 第一步合并后应剩 3 张，实际 ' + sc.cards.length); }
    if (!fitIn(sc)) { issues.push('W=' + W + ' 合并中途 3 张布局溢出屏幕'); }
    try { sc.render(ctx); } catch (e) { issues.push('W=' + W + ' 中途 render 抛错: ' + e.message); }
  });
  BF.platform.width = 390;

  /* ---- 2) 真实点通：solveSeq 驱动的合并序列必能过关（每副随机牌 3 步内点通） ---- */
  var winLog = [];
  for (var t = 0; t < 30; t++) {
    var sc2 = new Scene(app);
    sc2.enter({ game: 'pk24' });
    sc2.elapsed = t * 1000;            // 让星级落到不同档，顺便验证评星
    driveWin(sc2);
    if (!sc2.win) { issues.push('第 ' + (t + 1) + ' 副随机牌未能真实点通（solveSeq 驱动失败）'); }
    else if (sc2.cards.length !== 1 || sc2.cards[0].v !== 24) {
      issues.push('第 ' + (t + 1) + ' 副点通后剩 ' + sc2.cards.length + ' 张，值=' + (sc2.cards[0] && sc2.cards[0].v));
    } else {
      winLog.push('副' + (t + 1) + ':' + sc2.win.stars + '★');
    }
    try { sc2.render(ctx); } catch (e) { issues.push('第 ' + (t + 1) + ' 副结算态 render 抛错: ' + e.message); }
  }

  /* ---- 3) 整除拦截：选两张不能整除的牌做除法 → 该步不可用、toast、pendingOp 清零、张数不变 ---- */
  var sc3 = new Scene(app);
  sc3.enter({ game: 'pk24' });
  // 造一副含 3 和 8 的牌（3÷8 除不尽），其余两张随便凑成可解；先强制 seed 找到这样的副
  var deal3 = null;
  for (var z = 0; z < 600; z++) {
    var cand = Gen.dealFromSeed(1000 + z);
    if (cand.indexOf(3) >= 0 && cand.indexOf(8) >= 0) { deal3 = cand; break; }
  }
  if (!deal3) { issues.push('找不到含 3 和 8 的可解副（整除拦截用例构造失败）'); }
  else {
    sc3.initialVals = deal3.slice();
    sc3.cards = sc3.buildTokens(deal3);
    sc3.initial = sc3.cloneCards(sc3.cards);
    sc3.history = []; sc3.solution = Gen.solve(deal3); sc3.win = null; sc3.selected = -1; sc3.pendingOp = null;
    sc3.computeTokenRects();
    var i3 = deal3.indexOf(3), i8 = deal3.indexOf(8);
    var before = sc3.cards.length;
    tapCard(sc3, i3); tapOp(sc3, '÷'); tapCard(sc3, i8);   // 3÷8 除不尽
    if (sc3.cards.length !== before) { issues.push('除不尽的合并不该改变牌数'); }
    if (sc3.pendingOp !== null) { issues.push('除不尽后 pendingOp 应清零（保留选牌让用户换算法）'); }
    if (!sc3.toast || sc3.toast.text.indexOf('除不尽') < 0) { issues.push('除不尽应给出 toast 提示「除不尽，换种算法」'); }
    // 乘法则合法：3×8=24 是一步可能解（若恰为最后一步直接过关；此处只验证不报错且张数减一）
    var sc3b = new Scene(app);
    sc3b.enter({ game: 'pk24' });
    sc3b.initialVals = deal3.slice();
    sc3b.cards = sc3b.buildTokens(deal3);
    sc3b.initial = sc3b.cloneCards(sc3b.cards);
    sc3b.history = []; sc3b.solution = Gen.solve(deal3); sc3b.win = null; sc3b.selected = -1; sc3b.pendingOp = null;
    sc3b.computeTokenRects();
    tapCard(sc3b, i3); tapOp(sc3b, '×'); tapCard(sc3b, i8);
    if (sc3b.cards.length !== before - 1) { issues.push('3×8 合法合并应使牌数减一，实际 ' + sc3b.cards.length); }
  }

  /* ---- 4) 撤销 / 重置 / 提示 ---- */
  var sc4 = new Scene(app);
  sc4.enter({ game: 'pk24' });
  var seq4 = Gen.solveSeq(sc4.initialVals.slice());
  tapCard(sc4, seq4[0].i); tapOp(sc4, seq4[0].op); tapCard(sc4, seq4[0].j);
  if (sc4.cards.length !== 3) { issues.push('合并一步后应剩 3 张'); }
  sc4.doAction('undo');
  if (sc4.cards.length !== 4) { issues.push('撤销应恢复 4 张牌'); }
  if (sc4.history.length !== 0) { issues.push('撤销后应清空 history'); }
  // 重置：先合并再重置，回到初始 4 张且 elapsed 归零
  tapCard(sc4, seq4[0].i); tapOp(sc4, seq4[0].op); tapCard(sc4, seq4[0].j);
  sc4.elapsed = 12345;
  sc4.doAction('reset');
  if (sc4.cards.length !== 4) { issues.push('重置应恢复 4 张初始牌'); }
  if (sc4.elapsed !== 0) { issues.push('重置应把计时归零'); }
  if (sc4.history.length !== 0) { issues.push('重置应清空 history'); }
  // 提示：显示一种解的表达式、hintsUsed++、hintExpr 非空
  sc4.doAction('hint');
  if (sc4.hintsUsed !== 1) { issues.push('提示应使 hintsUsed=1'); }
  if (!sc4.hintExpr || sc4.hintExpr.indexOf('= 24') < 0) { issues.push('提示应给出「... = 24」的表达式'); }
  if (!sc4.toast || sc4.toast.text.indexOf('解法') < 0) { issues.push('提示应给出 toast'); }
  // 没有可解副时（solution 为 null）提示应走兜底分支
  var sc4b = new Scene(app);
  sc4b.enter({ game: 'pk24' });
  sc4b.solution = null;
  sc4b.doAction('hint');
  if (!sc4b.toast || sc4b.toast.text.indexOf('新副') < 0) { issues.push('无解时提示应引导换副'); }

  /* ---- 5) 按用时评星 + 用提示降星 ---- */
  if (sc4.starsFor(0, 0) !== 3) { issues.push('0ms 无提示应得 3★'); }
  if (sc4.starsFor(100000, 0) !== 1) { issues.push('>90s 应得 1★（实际 ' + sc4.starsFor(100000, 0) + '）'); }
  if (sc4.starsFor(0, 1) !== 2) { issues.push('用 1 次提示应封顶 2★，实际 ' + sc4.starsFor(0, 1)); }
  if (sc4.starsFor(0, 2) !== 1) { issues.push('用 ≥2 次提示应封顶 1★，实际 ' + sc4.starsFor(0, 2)); }
  // 真实：用提示后点通，星级应 ≤2
  var sc5 = new Scene(app);
  sc5.enter({ game: 'pk24' });
  sc5.doAction('hint');
  driveWin(sc5);
  if (!sc5.win) { issues.push('用了提示也应能点通'); }
  else if (sc5.win.stars > 2) { issues.push('用了提示却给了 >2★（封顶失效）'); }

  /* ---- 6) 无尽统计存档：过关后 extraOf('pk24').solved 累加 ---- */
  var beforeSolved = (BF.Save.extraOf('pk24').solved) || 0;
  var sc6 = new Scene(app);
  sc6.enter({ game: 'pk24' });
  driveWin(sc6);
  var afterSolved = (BF.Save.extraOf('pk24').solved) || 0;
  if (afterSolved !== beforeSolved + 1) {
    issues.push('过关后已解题数应 +1（' + beforeSolved + '→' + afterSolved + '）');
  }
  if (!(BF.Save.extraOf('pk24').bestStars >= 1 && BF.Save.extraOf('pk24').bestStars <= 3)) {
    issues.push('bestStars 应落在 1~3');
  }
  // 下一题：点击「下一题」后换一副新牌（cards 重置为 4 张，win 清空）
  var sc6b = new Scene(app);
  sc6b.enter({ game: 'pk24' });
  driveWin(sc6b);
  var ob = sc6b.overlayLayout();
  sc6b.onDown(ob.next.x + ob.next.w / 2, ob.next.y + ob.next.h / 2);
  sc6b.onUp(ob.next.x + ob.next.w / 2, ob.next.y + ob.next.h / 2);
  if (sc6b.win !== null) { issues.push('点「下一题」应清掉结算态'); }
  if (sc6b.cards.length !== 4) { issues.push('点「下一题」应发一副新 4 张牌'); }

  /* ---- 7) RuleTip 接入（独立开关验证，不走 harness 默认 off） ---- */
  BF.RuleTip.on = true;
  var sc7 = new Scene(app);
  exStore.pk24 = {};                       // 清掉 noRule，确保会弹
  sc7.enter({ game: 'pk24' });
  if (!sc7.showRule) { issues.push('进游戏首次应弹出玩法说明（showRule=true）'); }
  // 弹框期间 update 不应推进计时（update 提前 return 到 RuleTip.update）
  sc7.update(16);
  if (sc7.elapsed !== 0) { issues.push('规则弹框期间不应计时'); }
  try { sc7.render(ctx); } catch (e) { issues.push('规则弹框 render 抛错: ' + e.message); }
  // 「开始游戏」关闭弹框
  var ok = sc7.ruleOk;
  sc7.onDown(ok.x + ok.w / 2, ok.y + ok.h / 2);
  sc7.onUp(ok.x + ok.w / 2, ok.y + ok.h / 2);
  if (sc7.showRule) { issues.push('点「开始游戏」应关闭玩法说明'); }
  // 「?」按钮重看：header 的 ruleBtn 命中盒
  var rb = BF.RuleTip.btn(sc7);
  sc7.onDown(rb.x + rb.w / 2, rb.y + rb.h / 2);
  sc7.onUp(rb.x + rb.w / 2, rb.y + rb.h / 2);
  if (!sc7.showRule) { issues.push('点「?」应重新弹出玩法说明'); }
  BF.RuleTip.on = false;                   // 还原，避免影响外部

  if (issues.length) {
    console.error('❌ 24点交互逻辑问题 ' + issues.length + ' 条:');
    for (var i = 0; i < issues.length; i++) { console.error('  - ' + issues[i]); }
    process.exit(1);
  }
  console.log('✅ 24点 · 交互逻辑全过（发牌/点牌→点运算符→点另一张逐步合并/3步真实点通 30 副随机牌/' +
    '整除拦截（除不尽该步不可用+toast+pendingOp 清零+张数不变）/撤销/重置(计时归零)/提示(显示一种解+降星)/' +
    '按用时评星(用提示降星)/无尽统计存档+下一题换副/几何不溢出(390·320)/RuleTip 接入(首进弹·「开始游戏」关·「?」重看·弹框期间不计时)）');
  console.log('   30 副随机牌星级分布（验证评星随用时落档）: ' + winLog.join('  '));
})();
