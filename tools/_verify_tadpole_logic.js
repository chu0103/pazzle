/**
 * _verify_tadpole_logic.js —— 「盯蝌蚪」交互逻辑自检（固定 15 关闯关，标记追踪 + 自由漂移）
 *
 * 用「假 canvas + 假平台 + 真存档」把 tadpole 场景真实跑起来，验证**交互逻辑**（不是像素）：
 *   - 几何不溢出：15 关 × 390 / 320 两档宽度，返回/提示按钮 + 卡片 + 蝌蚪都装得下、render 不抛错。
 *   - 阶段机：observe → shuffle(游动倒计时) → answer(定格) 由 update(dt) 真实推进，不跳过、不死循环；
 *     倒计时期间不可点选，归零后 playT 冻结、蝌蚪位置不再变化。
 *   - 真实点通：把每关**全部被标记蝌蚪**点出来必过关（多目标须找齐）。
 *   - 猜错扣心：点干扰蝌蚪扣 1 颗心、记 mistakes、闪一下；3 心用完 → 失败覆盖层（重玩同关）。
 *   - 超时扣心：answerT 归零扣心、心没了 → 失败；心还在则重置倒计时再给一次机会。
 *   - 提示：hintsUsed++、hintPulse 置位、降星（与猫猫方块同语义）。
 *   - 评星：看失误次数；用提示封顶。
 *   - 存档 + 「下一关」：Save.clear('tadpole', level, stars)、clearedCount 累加、进 level+1 不弹规则。
 *   - RuleTip 接入：首进弹框、弹框期间不推进阶段、「开始游戏」关、「?」重看。
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
      if (p === 'toDataURL') { return function () { return '' }; }
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
  require(path.join(root, 'js/game/tadpole.js'));
  require(path.join(root, 'js/scenes/tadpole.js'));
  require(path.join(root, 'js/scenes/ruletip.js'));
  BF.RuleTip.on = false;

  var Gen = BF.TadpoleGen;
  var Scene = BF.SceneTadpole;
  var lastGo = null;
  var app = { go: function (name, params) { lastGo = { name: name, params: params }; } };
  var issues = [];

  function center(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
  function tapRect(sc, r) { var c = center(r); sc.onDown(c.x, c.y); sc.onUp(c.x, c.y); }
  function tapTadpoleById(sc, id) {
    var p = sc.posOf(id, 1);            // 作答期用终点
    sc.onDown(p.x, p.y); sc.onUp(p.x, p.y);
  }
  function fitIn(sc) {
    var W = BF.platform.width, H = BF.platform.height;
    if (sc.back.x < 0 || sc.back.y < 0 || sc.back.x + sc.back.w > W || sc.back.y + sc.back.h > H) { return false; }
    var hb = sc.hintBtn;
    if (hb.x < -0.5 || hb.y < -0.5 || hb.x + hb.w > W + 0.5 || hb.y + hb.h > H + 0.5) { return false; }
    // 卡片整体在屏内
    if (sc.cardX < -0.5 || sc.cardY < -0.5 || sc.cardX + sc.cardW > W + 0.5 || sc.cardY + sc.cardH > H + 0.5) { return false; }
    return true;
  }
  function pumpToAnswer(sc) {
    var guard = 0;
    while (sc.phase !== 'answer' && guard < 400) { sc.update(50); guard++; }
    return sc.phase === 'answer';
  }
  /** 点出全部被标记蝌蚪（多目标须找齐） */
  function tapAllMarked(sc) {
    for (var i = 0; i < sc.markedIds.length; i++) { tapTadpoleById(sc, sc.markedIds[i]); }
  }
  function nonMarkedIds(sc) {
    var out = [];
    for (var i = 0; i < sc.N; i++) { if (!sc.tadpoles[i].marked) { out.push(i); } }
    return out;
  }

  /* ---- 1) 几何不溢出：15 关 × 390 / 320 两档宽度 ---- */
  [390, 320].forEach(function (W) {
    BF.platform.width = W;
    for (var lv = 1; lv <= 15; lv++) {
      var sc = new Scene(app);
      sc.enter({ level: lv });
      if (!fitIn(sc)) { issues.push('W=' + W + ' 第' + lv + '关布局溢出屏幕'); }
      try { sc.render(ctx); } catch (e) { issues.push('W=' + W + ' 第' + lv + '关 render 抛错: ' + e.message); }
    }
  });
  BF.platform.width = 390;

  /* ---- 2) 阶段机：observe→shuffle→answer 真实推进 ---- */
  for (var lv2 = 1; lv2 <= 15; lv2++) {
    var scP = new Scene(app);
    scP.enter({ level: lv2 });
    if (scP.phase !== 'observe') { issues.push('第' + lv2 + '关应从 observe 开始'); }
    if (!pumpToAnswer(scP)) { issues.push('第' + lv2 + '关 pump 后未进入 answer（阶段机卡死）'); }
  }

  /* ---- 2b) 游动倒计时期间不可点选；倒计时归零后 playT 冻结、画面定格 ---- */
  var scLock = new Scene(app);
  scLock.enter({ level: 1 });
  var gLock = 0;
  while (scLock.phase === 'observe' && gLock < 200) { scLock.update(50); gLock++; }
  if (scLock.phase !== 'shuffle') {
    issues.push('观察期结束后应进入游动倒计时(shuffle)');
  } else {
    var pLock = scLock.posOf(scLock.markedIds[0]);
    var hLock = scLock.hearts, fLock = scLock.foundCount;
    scLock.onDown(pLock.x, pLock.y); scLock.onUp(pLock.x, pLock.y);
    if (scLock.foundCount !== fLock || scLock.hearts !== hLock || scLock.win) {
      issues.push('游动倒计时期间不应能点选 / 扣心 / 过关（须等蝌蚪停下）');
    }
    if (!pumpToAnswer(scLock)) { issues.push('游动倒计时归零后应进入 answer'); }
    else {
      var tFreeze = scLock.playT;
      var posFreeze = scLock.posOf(0);
      scLock.update(50); scLock.update(50);
      if (scLock.playT !== tFreeze) { issues.push('作答期 playT 必须冻结'); }
      var posAfter = scLock.posOf(0);
      if (Math.abs(posFreeze.x - posAfter.x) > 1e-9 || Math.abs(posFreeze.y - posAfter.y) > 1e-9) {
        issues.push('作答期蝌蚪仍在移动，未停下来让玩家选');
      }
    }
  }

  /* ---- 3) 真实点通：15 关各跑 3 次，全部被标记蝌蚪驱动必过关 + 写档 ---- */
  for (var lv3 = 1; lv3 <= 15; lv3++) {
    for (var rep = 0; rep < 3; rep++) {
      var scW = new Scene(app);
      scW.enter({ level: lv3 });
      if (!pumpToAnswer(scW)) { issues.push('第' + lv3 + '关 第' + (rep + 1) + '次未能进入 answer'); continue; }
      tapAllMarked(scW);
      if (!scW.win) {
        issues.push('第' + lv3 + '关 第' + (rep + 1) + '次点齐被标记(' + scW.markedIds.join(',') + ') 未过关');
        continue;
      }
      if (BF.Save.clearedCount('tadpole') < 1) { issues.push('第' + lv3 + '关过关应写存档'); }
      if (BF.Save.starsOf('tadpole', lv3) < 1) { issues.push('第' + lv3 + '关应记录星级'); }
      try { scW.render(ctx); } catch (e) { issues.push('第' + lv3 + '关结算态 render 抛错: ' + e.message); }
    }
  }

  /* ---- 4) 猜错扣心：点干扰蝌蚪扣 1 心、记失误、闪错；3 心用完 → 失败 ---- */
  var scH = new Scene(app);
  scH.enter({ level: 1 });
  pumpToAnswer(scH);
  var wrongs = nonMarkedIds(scH);
  var h0 = scH.hearts;
  tapTadpoleById(scH, wrongs[0]);
  if (scH.hearts !== h0 - 1) { issues.push('猜错应扣 1 颗心（' + h0 + '→' + scH.hearts + '）'); }
  if (scH.mistakes !== 1) { issues.push('猜错应记 mistakes=1'); }
  if (!scH.wrongFlash) { issues.push('猜错应触发错误蝌蚪闪烁'); }
  if (scH.win) { issues.push('猜错不应过关'); }
  tapTadpoleById(scH, wrongs[1]);
  tapTadpoleById(scH, wrongs[2]);
  if (scH.hearts !== 0) { issues.push('连续猜错 3 次应耗光心（实际 ' + scH.hearts + '）'); }
  if (!scH.fail) { issues.push('心耗光应进入失败覆盖层'); }
  if (scH.win) { issues.push('3 心耗光不应判过关'); }

  /* ---- 5) 超时扣心 ---- */
  var scT = new Scene(app);
  scT.enter({ level: 1 });
  pumpToAnswer(scT);
  var beforeTimeout = scT.hearts;
  scT.update(scT.answerMs + 50);
  if (scT.hearts !== beforeTimeout - 1) { issues.push('超时一次应扣 1 颗心'); }
  if (scT.mistakes !== 1) { issues.push('超时应记 mistakes=1'); }
  if (scT.answerT <= 0) { issues.push('超时扣心后仍应有可倒计时（重置 answerT）'); }
  scT.update(scT.answerMs + 50);
  scT.update(scT.answerMs + 50);
  if (!scT.fail) { issues.push('连续超时 3 次应进入失败覆盖层'); }

  /* ---- 6) 提示：hintsUsed++、hintPulse 置位、降星 ---- */
  var scI = new Scene(app);
  scI.enter({ level: 1 });
  pumpToAnswer(scI);
  scI.pressHint();
  if (scI.hintsUsed !== 1) { issues.push('提示应使 hintsUsed=1'); }
  if (scI.hintPulse <= 0) { issues.push('提示应置位 hintPulse'); }
  if (!scI.toast || scI.toast.text.indexOf('高亮') < 0) { issues.push('提示应给出 toast'); }
  tapAllMarked(scI);
  if (!scI.win) { issues.push('用提示后仍应能点齐被标记蝌蚪过关'); }
  else if (scI.win.stars !== 2) { issues.push('用 1 次提示应封顶 2★（实际 ' + scI.win.stars + '）'); }

  /* ---- 7) 评星 ---- */
  var scS = new Scene(app);
  scS.enter({ level: 1 });
  if (scS.starsFor(0, 0) !== 3) { issues.push('0 失误无提示应得 3★'); }
  if (scS.starsFor(1, 0) !== 2) { issues.push('1 次失误应得 2★'); }
  if (scS.starsFor(3, 0) !== 1) { issues.push('≥3 次失误应得 1★'); }
  if (scS.starsFor(0, 1) !== 2) { issues.push('用 1 次提示应封顶 2★'); }
  if (scS.starsFor(0, 2) !== 1) { issues.push('用 ≥2 次提示应封顶 1★'); }

  /* ---- 8) 存档 + 「下一关」流程 ---- */
  var scN = new Scene(app);
  scN.enter({ level: 2 });
  pumpToAnswer(scN);
  tapAllMarked(scN);
  if (!scN.win) { issues.push('第 2 关应可点通'); }
  else {
    if (BF.Save.clearedCount('tadpole') < 1) { issues.push('过关应写存档 clearedCount'); }
    if (BF.Save.starsOf('tadpole', 2) < 1) { issues.push('过关应记录星级'); }
    var ob = scN.overlayLayout();
    tapRect(scN, ob.action);
    if (scN.level !== 3) { issues.push('点「下一关」应进第 3 关（实际 ' + scN.level + '）'); }
    if (scN.showRule) { issues.push('「下一关」不应再弹规则说明'); }
    if (scN.win !== null) { issues.push('「下一关」后应清掉结算态'); }
  }
  // 最后一关「下一关」→ 返回首页
  var scL = new Scene(app);
  lastGo = null;
  scL.enter({ level: 15 });
  pumpToAnswer(scL);
  tapAllMarked(scL);
  if (scL.win) {
    var obL = scL.overlayLayout();
    tapRect(scL, obL.action);
    if (!lastGo || lastGo.name !== 'home') { issues.push('第 15 关「完成」应返回首页'); }
  } else { issues.push('第 15 关应可点通'); }

  // 失败「重新挑战」→ 重玩同关、重置心
  var scF = new Scene(app);
  lastGo = null;
  scF.enter({ level: 4 });
  pumpToAnswer(scF);
  var wf = nonMarkedIds(scF);
  tapTadpoleById(scF, wf[0]); tapTadpoleById(scF, wf[1]); tapTadpoleById(scF, wf[2]);
  if (!scF.fail) { issues.push('第 4 关耗光心应进入失败层'); }
  else {
    var fo = scF.overlayLayout();
    tapRect(scF, fo.action);
    if (scF.level !== 4) { issues.push('重新挑战应留在第 4 关'); }
    if (scF.fail !== null) { issues.push('重新挑战应清掉失败态'); }
    if (scF.hearts !== 3) { issues.push('重新挑战应重置 3 颗心'); }
    if (scF.mistakes !== 0) { issues.push('重新挑战应清零失误'); }
  }

  /* ---- 9) RuleTip 接入 ---- */
  BF.RuleTip.on = true;
  var scR = new Scene(app);
  BF.Save.extraOf('tadpole').noRule = 0;
  scR.enter({ level: 1 });
  if (!scR.showRule) { issues.push('进游戏首次应弹出玩法说明（showRule=true）'); }
  var phaseBefore = scR.phase;
  scR.update(16);
  if (scR.phase !== phaseBefore) { issues.push('规则弹框期间不应推进阶段机'); }
  try { scR.render(ctx); } catch (e) { issues.push('规则弹框 render 抛错: ' + e.message); }
  var okR = scR.ruleOk;
  scR.onDown(okR.x + okR.w / 2, okR.y + okR.h / 2);
  scR.onUp(okR.x + okR.w / 2, okR.y + okR.h / 2);
  if (scR.showRule) { issues.push('点「开始游戏」应关闭玩法说明'); }
  var rb = BF.RuleTip.btn(scR);
  scR.onDown(rb.x + rb.w / 2, rb.y + rb.h / 2);
  scR.onUp(rb.x + rb.w / 2, rb.y + rb.h / 2);
  if (!scR.showRule) { issues.push('点「?」应重新弹出玩法说明'); }
  BF.RuleTip.on = false;

  if (issues.length) {
    console.error('❌ 盯蝌蚪交互逻辑问题 ' + issues.length + ' 条:');
    for (var i = 0; i < issues.length; i++) { console.error('  - ' + issues[i]); }
    process.exit(1);
  }
  console.log('✅ 盯蝌蚪 · 交互逻辑全过（几何不溢出(15关×390·320)/阶段机(observe→游动倒计时→定格answer)/' +
    '倒计时内不可点选+归零后playT冻结定格/' +
    '真实点通(15关各3次·点齐全部被标记必过关·写档)/猜错扣心(扣1心·记失误·闪错·3心耗光→失败层)/' +
    '超时扣心(扣1心·重置倒计时·3次→失败)/提示(hintsUsed++·hintPulse·降星)/' +
    '评星(失误次数·用提示封顶2★)/存档(clear+clearedCount+星级)+下一关(进level+1·不弹规则)+完结关返回首页+失败重玩同关/' +
    'RuleTip(首进弹·弹框不推进阶段·开始游戏关·?重看)）');
})();
