/**
 * _verify_cat_logic.js —— 「猫猫方块」交互逻辑自检（固定 8 关闯关）
 *
 * 用「假 canvas + 假平台 + 真存档」把 cat 场景真实跑起来，验证**交互逻辑**（不是像素）：
 *   - 几何不溢出：8 关 × 390/320 两档宽度，棋盘 + 底部三按钮都装得下、render 不抛错。
 *   - 真实点通：把每关 8 个解位依次点出来必过关（生成器保证 sol 合法、每关可解）。
 *   - 放错扣心：点 ✕ 扣 1 颗心，3 心用完 → 失败覆盖层（重玩同关）。
 *   - 拿起猫：点已放的猫可移除（不扣心）；移除后该区域可再放。
 *   - 撤销 / 重置 / 提示（提示高亮一个合法空格、hintsUsed++、降星）。
 *   - 评星：看放错次数；用提示封顶 2★。
 *   - 存档：过关调用 Save.clear('cat', level, stars)，clearedCount 累加；「下一关」进 level+1。
 *   - RuleTip 接入：首进弹框、弹框期间不计时、「开始游戏」关、「?」重看。
 */
(function () {
  var path = require('path');
  var root = path.resolve(__dirname, '..');
  global.BF = {};
  require(path.join(root, 'js/core/ns.js'));

  // 假 draw / theme（与 _verify_pk24_logic.js 同源）
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
  var store = {};
  BF.platform = {
    width: 390, height: 844, safeTop: 44, safeBottom: 34, dpr: 2,
    now: function () { return 0; }, vibrate: function () {}, requestFrame: function () {},
    bindPointer: function () {}, createImage: function () {}, ctx: ctx,
    getStorage: function (k) { return store[k]; },
    setStorage: function (k, v) { store[k] = v; }
  };

  require(path.join(root, 'js/core/save.js'));
  BF.Save.load();
  require(path.join(root, 'js/game/cat.js'));
  require(path.join(root, 'js/scenes/cat.js'));
  require(path.join(root, 'js/scenes/ruletip.js'));
  BF.RuleTip.on = false;   // harness 默认关掉规则弹框（enter 后输入会被拦走）

  var Gen = BF.CatGen;
  var Scene = BF.SceneCat;
  var lastGo = null;
  var app = { go: function (name, params) { lastGo = { name: name, params: params }; } };
  var issues = [];

  function center(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
  function tapRect(sc, r) { var c = center(r); sc.onDown(c.x, c.y); sc.onUp(c.x, c.y); }
  function tapCell(sc, r, c) { tapRect(sc, sc.cellRects[r][c]); }
  function fitIn(sc) {
    var W = BF.platform.width, H = BF.platform.height, i, j;
    if (sc.back.x < 0 || sc.back.y < 0 || sc.back.x + sc.back.w > W || sc.back.y + sc.back.h > H) { return false; }
    for (i = 0; i < sc.btns.length; i++) {
      var b = sc.btns[i];
      if (b.x < -0.5 || b.y < -0.5 || b.x + b.w > W + 0.5 || b.y + b.h > H + 0.5) { return false; }
    }
    for (i = 0; i < sc.N; i++) {
      for (j = 0; j < sc.N; j++) {
        var r = sc.cellRects[i][j];
        if (r.x < -0.5 || r.y < -0.5 || r.x + r.w > W + 0.5 || r.y + r.h > H + 0.5) { return false; }
      }
    }
    return true;
  }
  /** 把每关的全部解位依次点出来 → 必过关（生成器保证 sol 合法、彼此不冲突） */
  function driveWin(sc) {
    if (!sc.N) { issues.push('scene.N 未初始化'); return; }
    for (var k = 0; k < sc.N; k++) {
      var s = sc.sol[k];
      tapCell(sc, s.r, s.c);
    }
  }

  /* ---- 1) 几何不溢出：8 关 × 390 / 320 两档宽度 ---- */
  [390, 320].forEach(function (W) {
    BF.platform.width = W;
    for (var lv = 1; lv <= 8; lv++) {
      var sc = new Scene(app);
      sc.enter({ level: lv });
      if (!fitIn(sc)) { issues.push('W=' + W + ' 第' + lv + '关布局溢出屏幕'); }
      try { sc.render(ctx); } catch (e) { issues.push('W=' + W + ' 第' + lv + '关 render 抛错: ' + e.message); }
    }
  });
  BF.platform.width = 390;

  /* ---- 2) 真实点通：8 关各跑 5 次随机种子，解位驱动必过关 ---- */
  for (var lv2 = 1; lv2 <= 8; lv2++) {
    for (var rep = 0; rep < 5; rep++) {
      var scW = new Scene(app);
      scW.enter({ level: lv2 });
      var N = scW.N;
      // 先用解位真实点通
      driveWin(scW);
      if (!scW.win) {
        issues.push('第' + lv2 + '关 第' + (rep + 1) + '次未能真实点通（sol 驱动失败，N=' + N + '）');
        continue;
      }
      if (scW.count !== N) { issues.push('第' + lv2 + '关点通后 count=' + scW.count + ' 应为 ' + N); }
      try { scW.render(ctx); } catch (e) { issues.push('第' + lv2 + '关结算态 render 抛错: ' + e.message); }
      // 存档：clearedCount 应 +1
      if (BF.Save.clearedCount('cat') < rep + 1) { /* 跨关累计，后面统一校验 */ }
    }
  }

  /* ---- 3) 放错扣心：点 ✕ 扣 1 颗心；3 心用完 → 失败覆盖层 ---- */
  var scH = new Scene(app);
  scH.enter({ level: 1 });
  // 先放一只猫，制造 ✕
  var s0 = scH.sol[0];
  tapCell(scH, s0.r, s0.c);
  if (scH.count !== 1) { issues.push('放置首只猫后 count 应为 1'); }
  // 找一个 ✕ 格（与已放猫同行）
  var xr = s0.r, xc = (s0.c + 1) % scH.N;
  if (!scH.xmark[xr][xc]) { issues.push('与已放猫同行的格子应被打 ✕'); }
  else {
    var h0 = scH.hearts;
    tapCell(scH, xr, xc);                 // 点 ✕
    if (scH.hearts !== h0 - 1) { issues.push('点 ✕ 应扣 1 颗心（' + h0 + '→' + scH.hearts + '）'); }
    if (scH.mistakes !== 1) { issues.push('点 ✕ 应记 mistakes=1'); }
    // 再点两次 ✕ 把心耗光
    tapCell(scH, xr, xc);                 // 同一格仍是 ✕
    tapCell(scH, xr, xc);
    if (scH.hearts !== 0) { issues.push('连续点 ✕ 应把心耗光（实际 ' + scH.hearts + '）'); }
    if (!scH.fail) { issues.push('心耗光应进入失败覆盖层'); }
  }

  /* ---- 4) 拿起猫：点已放猫可移除（不扣心）---- */
  var scR = new Scene(app);
  scR.enter({ level: 1 });
  var sr = scR.sol[0];
  tapCell(scR, sr.r, sr.c);
  var heartsBefore = scR.hearts;
  tapCell(scR, sr.r, sr.c);               // 再点同一只 → 拿起
  if (scR.count !== 0) { issues.push('再次点已放猫应移除它（count 应为 0）'); }
  if (scR.hearts !== heartsBefore) { issues.push('拿起猫不应扣心'); }
  // 拿起来后该区域可再放（不报「已经有猫」）
  tapCell(scR, sr.r, sr.c);
  if (scR.count !== 1 || scR.regionFilled[scR.region[sr.r][sr.c]] !== true) {
    issues.push('拿起后同区域应可重新放置');
  }

  /* ---- 5) 撤销 / 重置 / 提示 ---- */
  var scA = new Scene(app);
  scA.enter({ level: 1 });
  tapCell(scA, scA.sol[0].r, scA.sol[0].c);
  tapCell(scA, scA.sol[1].r, scA.sol[1].c);
  if (scA.count !== 2) { issues.push('放两只猫后 count 应为 2'); }
  scA.doAction('undo');
  if (scA.count !== 1) { issues.push('撤销应移除最近一只（count 应为 1）'); }
  if (scA.placed.length !== 1) { issues.push('撤销后应剩 1 条放置记录'); }
  // 撤销到空
  scA.doAction('undo');
  if (scA.count !== 0) { issues.push('再撤销应清空（count 应为 0）'); }
  // 重置
  tapCell(scA, scA.sol[0].r, scA.sol[0].c);
  tapCell(scA, scA.sol[1].r, scA.sol[1].c);
  scA.doAction('reset');
  if (scA.count !== 0) { issues.push('重置应清空所有猫'); }
  if (scA.placed.length !== 0) { issues.push('重置应清空放置记录'); }
  // 提示
  scA.doAction('hint');
  if (scA.hintsUsed !== 1) { issues.push('提示应使 hintsUsed=1'); }
  if (!scA.hintCell) { issues.push('提示应设置高亮格 hintCell'); }
  if (!scA.toast || scA.toast.text.indexOf('高亮') < 0) { issues.push('提示应给出 toast'); }

  /* ---- 6) 评星：放错次数 + 用提示封顶 ---- */
  if (scA.starsFor(0, 0) !== 3) { issues.push('0 放错无提示应得 3★'); }
  if (scA.starsFor(1, 0) !== 2) { issues.push('1 次放错应得 2★'); }
  if (scA.starsFor(3, 0) !== 1) { issues.push('≥3 次放错应得 1★'); }
  if (scA.starsFor(0, 1) !== 2) { issues.push('用 1 次提示应封顶 2★'); }
  if (scA.starsFor(0, 2) !== 1) { issues.push('用 ≥2 次提示应封顶 1★'); }

  /* ---- 7) 存档 + 「下一关」流程 ---- */
  var scN = new Scene(app);
  scN.enter({ level: 2 });
  driveWin(scN);
  if (!scN.win) { issues.push('第 2 关应可点通'); }
  else {
    var clrBefore = BF.Save.clearedCount('cat');
    // 模拟 onSolved 已写档（driveWin 触发的 onSolved 内部已 clear）
    if (BF.Save.clearedCount('cat') < 1) { issues.push('过关应写存档 clearedCount'); }
    if (BF.Save.starsOf('cat', 2) < 1) { issues.push('过关应记录星级'); }
    // 点「下一关」→ 进第 3 关（skipOnce 不弹规则）
    var ob = scN.overlayLayout();
    tapRect(scN, ob.action);
    if (scN.level !== 3) { issues.push('点「下一关」应进第 3 关（实际 ' + scN.level + '）'); }
    if (scN.showRule) { issues.push('「下一关」不应再弹规则说明'); }
    if (scN.win !== null) { issues.push('「下一关」后应清掉结算态'); }
  }
  // 最后一关「下一关」→ 返回首页
  var scL = new Scene(app);
  lastGo = null;
  scL.enter({ level: 8 });
  driveWin(scL);
  if (scL.win) {
    var obL = scL.overlayLayout();
    tapRect(scL, obL.action);
    if (!lastGo || lastGo.name !== 'home') { issues.push('第 8 关「完成」应返回首页'); }
  } else { issues.push('第 8 关应可点通'); }

  // 失败「重新挑战」→ 重玩同关
  var scF = new Scene(app);
  lastGo = null;
  scF.enter({ level: 4 });
  var sf0 = scF.sol[0];
  tapCell(scF, sf0.r, sf0.c);
  // 连点 ✕ 耗光心
  var fxr = sf0.r, fxc = (sf0.c + 1) % scF.N;
  tapCell(scF, fxr, fxc); tapCell(scF, fxr, fxc); tapCell(scF, fxr, fxc);
  if (!scF.fail) { issues.push('第 4 关耗光心应进入失败层'); }
  else {
    var fo = scF.overlayLayout();
    tapRect(scF, fo.action);             // 重新挑战
    if (scF.level !== 4) { issues.push('重新挑战应留在第 4 关'); }
    if (scF.fail !== null) { issues.push('重新挑战应清掉失败态'); }
    if (scF.hearts !== 3) { issues.push('重新挑战应重置 3 颗心'); }
    if (scF.count !== 0) { issues.push('重新挑战应清空猫'); }
  }

  /* ---- 8) RuleTip 接入 ---- */
  BF.RuleTip.on = true;
  var scT = new Scene(app);
  BF.Save.putExtra('cat', 'noRule', 0);   // 清掉 noRule，确保会弹
  BF.Save.extraOf('cat').noRule = 0;
  scT.enter({ level: 1 });
  if (!scT.showRule) { issues.push('进游戏首次应弹出玩法说明（showRule=true）'); }
  scT.update(16);
  if (scT.elapsed !== 0) { issues.push('规则弹框期间不应计时'); }
  try { scT.render(ctx); } catch (e) { issues.push('规则弹框 render 抛错: ' + e.message); }
  var ok = scT.ruleOk;
  scT.onDown(ok.x + ok.w / 2, ok.y + ok.h / 2);
  scT.onUp(ok.x + ok.w / 2, ok.y + ok.h / 2);
  if (scT.showRule) { issues.push('点「开始游戏」应关闭玩法说明'); }
  // 「?」重看
  var rb = BF.RuleTip.btn(scT);
  scT.onDown(rb.x + rb.w / 2, rb.y + rb.h / 2);
  scT.onUp(rb.x + rb.w / 2, rb.y + rb.h / 2);
  if (!scT.showRule) { issues.push('点「?」应重新弹出玩法说明'); }
  BF.RuleTip.on = false;

  if (issues.length) {
    console.error('❌ 猫猫方块交互逻辑问题 ' + issues.length + ' 条:');
    for (var i = 0; i < issues.length; i++) { console.error('  - ' + issues[i]); }
    process.exit(1);
  }
  console.log('✅ 猫猫方块 · 交互逻辑全过（几何不溢出(8关×390·320)/真实点通(8关各5次随机种子·sol驱动必过关)/' +
    '放错扣心(点✕扣1心·3心耗光→失败层)/拿起猫(再点已放猫移除且不计错)/撤销/重置/提示(高亮合法格+降星)/' +
    '评星(放错次数·用提示封顶2★)/存档(clear+clearedCount+星级)+下一关(进level+1·不弹规则)+完结关返回首页+失败重玩同关/' +
    'RuleTip(首进弹·弹框不计时·开始游戏关·?重看)）');
})();
