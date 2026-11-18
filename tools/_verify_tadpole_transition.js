/**
 * _verify_tadpole_transition.js —— 「盯蝌蚪」两端衔接 + 倒计时定格 护栏
 *
 * 背景：先后两次用户反馈
 *   ①「初始化定格页面和动画刚开始之间不连贯，导致动画刚开始就丢失目标」
 *     → 修复 4 个突变（红圈瞬灭 / 全体直飞 / 朝向突变 / 摆尾相位突变）；
 *   ②「应该倒计时结束后蝌蚪停下来，再让用户选」
 *     → 游动收窄到倒计时内，归零时按 S 曲线平滑刹停，作答期 playT 冻结、整幅定格。
 *
 * 本护栏用数值方式全覆盖（15 关 × 390/320 两档屏宽）断言：
 *   ① 观察最后一帧 → 游动首帧：位置/朝向/摆尾严格连续，红圈不瞬灭；
 *   ② 起步渐进：首帧 <0.02px、前 300ms <0.5px、余辉 900ms 内 <12px；
 *   ③ 中段确实大幅游动（0.55D 位移 >8px，0.55D→0.75D 仍在动），没有把游戏改简单；
 *   ④ 倒计时末尾平滑刹停：最后 100ms 位移 <1px，且单位时间速度显著低于中段；
 *   ⑤ 【核心】倒计时结束后完全定格：真实 update 多帧后位置/朝向/摆尾逐位不变，playT 冻结；
 *   ⑥ 红圈余辉 alpha 单调渐隐 + 中心跟随 + fade 后不残留 + 结算无残留。
 */
(function () {
  var path = require('path');
  var root = path.resolve(__dirname, '..');
  global.BF = {};
  require(path.join(root, 'js/core/ns.js'));

  BF.draw = new Proxy({}, { get: function (t, p) {
    if (p === 'FONT') { return 'sans'; }
    return function () { return undefined; };
  } });
  BF.theme = {
    text: '#222', textSub: '#888', bg: '#eee', bgTop: '#fff', accent: '#3a6fbf',
    accentDeep: '#2f5aa0', gold: '#f5b', ok: '#2a9', warn: '#e53', scrim: '#0008',
    panel: '#fff', panelEdge: '#ddd', slot: '#eee', slotEdge: '#ccc', slotShadow: '#0001',
    boardFrameTop: '#ccc', boardFrameBottom: '#bbb', boardInner: '#f5f5f5',
    tray: '#fafafa', shadow: '#0001'
  };
  BF.platform = {
    width: 390, height: 844, safeTop: 44, safeBottom: 34, dpr: 2,
    now: function () { return 0; }, vibrate: function () {}, requestFrame: function () {},
    bindPointer: function () {}, createImage: function () {},
    getStorage: function () { return undefined; }, setStorage: function () {}
  };

  require(path.join(root, 'js/core/save.js'));
  BF.Save.load();
  require(path.join(root, 'js/game/tadpole.js'));
  require(path.join(root, 'js/scenes/tadpole.js'));
  require(path.join(root, 'js/scenes/ruletip.js'));
  BF.RuleTip.on = false;

  var app = { go: function () {} };
  var issues = [], checks = 0;
  function ok(cond, msg) { checks++; if (!cond) { issues.push(msg); } }
  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

  /** 记录型 ctx：只捕获 setLineDash([6,5]) 之后画的 arc（红虚线圈），含当时的 globalAlpha */
  function recCtx() {
    var st = { alpha: 1, dash: false }, stack = [], rec = [];
    var over = {
      save: function () { stack.push({ a: st.alpha, d: st.dash }); },
      restore: function () { var s = stack.pop(); if (s) { st.alpha = s.a; st.dash = s.d; } },
      setLineDash: function (a) { st.dash = !!(a && a.length); },
      arc: function (x, y, r) { if (st.dash) { rec.push({ x: x, y: y, alpha: st.alpha }); } }
    };
    var ctx = new Proxy({}, {
      get: function (t, p) {
        if (p === 'globalAlpha') { return st.alpha; }
        if (over[p]) { return over[p]; }
        if (p === 'measureText') { return function () { return { width: 10 }; }; }
        if (p === 'createLinearGradient') { return function () { return { addColorStop: function () {} }; }; }
        return function () { return undefined; };
      },
      set: function (t, p, v) { if (p === 'globalAlpha') { st.alpha = v; } return true; }
    });
    return { ctx: ctx, rec: rec };
  }

  for (var W = 0; W < 2; W++) {
    BF.platform.width = W === 0 ? 390 : 320;
    BF.platform.height = W === 0 ? 844 : 700;
    for (var lv = 1; lv <= BF.TadpoleGen.TOTAL; lv++) {
      var sc = new BF.SceneTadpole(app).enter({ level: lv, game: 'tadpole' });
      var tag = 'W' + BF.platform.width + ' L' + lv;
      var D = sc.swimMs, i, ti, t;

      // 参数形状：倒计时足够长（中段不赶，后段已加时）、起步延迟落在余辉窗口内、动画时间上限长于倒计时
      ok(D >= 4100 && D <= 4500,
        tag + ' 游动倒计时应在 4.1~4.5s（后段加时后不再越往后越赶；过短会让中段加速过急）');
      ok(sc.startDelayMs > 0 && sc.startDelayMs < sc.markFadeMs,
        tag + ' 起步延迟应落在红圈余辉窗口内');
      ok(sc.motionEnd > D, tag + ' 有效动画时间上限应长于真实倒计时');
      ok(sc.markFadeMs > 0 && sc.markFadeMs < D, tag + ' 红圈余辉应落在游动倒计时内');

      /* ---- ① 观察期最后一帧 ---- */
      sc.phase = 'observe'; sc.playT = 0;
      ok(sc.markAlpha() === 1, tag + ' 观察期红圈应全亮');
      var obsPos = [], obsRot = [];
      for (i = 0; i < sc.N; i++) {
        obsPos.push(sc.posOf(i));
        obsRot.push(sc.rotOf(i));
        ok(sc.wagOf(i) === 0, tag + ' 观察期摆尾相位应为 0');
      }

      /* ---- ② 游动首帧：位置/朝向/摆尾/红圈 四项不得跳变 ---- */
      sc.phase = 'shuffle'; sc.playT = 0;
      ok(sc.markAlpha() === 1, tag + ' 红圈不得在动画第一帧瞬间消失');
      ok(sc.motionTimeOf(0) === 0, tag + ' 起步延迟内有效动画时间应为 0');
      for (i = 0; i < sc.N; i++) {
        var p0 = sc.posOf(i);
        ok(dist(p0, obsPos[i]) < 1e-6, tag + ' #' + i + ' 位置在交界处跳变 ' + dist(p0, obsPos[i]).toFixed(3) + 'px');
        ok(Math.abs(sc.rotOf(i) - obsRot[i]) < 1e-6, tag + ' #' + i + ' 朝向在交界处跳变');
        ok(sc.wagOf(i) === 0, tag + ' #' + i + ' 摆尾相位在交界处跳变');
      }

      /* ---- ③④ 按倒计时比例采样：起步缓 / 中段游动 / 末尾刹停 ---- */
      var keys = [0, 16, 32, 64, 96, 160, 240, 300, 450, 600, 900, 1200,
                  0.35, 0.55, 0.75, 0.90, 0.975, 'd300', 'd100', 1];
      var posAt = {};
      for (ti = 0; ti < keys.length; ti++) {
        var k = keys[ti];
        t = (k === 'd300') ? D - 300 : (k === 'd100') ? D - 100
          : (typeof k === 'number' && k > 0 && k < 1) ? D * k
          : (k === 1) ? D : k;
        sc.phase = 'shuffle'; sc.playT = t;
        var arr = [];
        for (i = 0; i < sc.N; i++) { arr.push(sc.posOf(i)); }
        posAt[String(k)] = arr;
      }
      for (i = 0; i < sc.N; i++) {
        var dFirst = dist(posAt['16'][i], posAt['0'][i]);
        var d300 = dist(posAt['300'][i], posAt['0'][i]);
        var d900 = dist(posAt['900'][i], posAt['0'][i]);
        var dMid = dist(posAt['0.55'][i], posAt['0'][i]);
        var dStillMoving = dist(posAt['0.75'][i], posAt['0.55'][i]);
        var dEnd = dist(posAt['1'][i], posAt['d100'][i]);
        var dLate = dist(posAt['d100'][i], posAt['d300'][i]);
        ok(dFirst < 0.02, tag + ' #' + i + ' 首帧位移 ' + dFirst.toFixed(4) + 'px，速度未从 0 起步');
        ok(d300 < 0.5, tag + ' #' + i + ' 前300ms位移 ' + d300.toFixed(2) + 'px（应<0.5px，起步延迟内静止）');
        ok(d900 < 12, tag + ' #' + i + ' 余辉900ms内位移 ' + d900.toFixed(2) + 'px（应<12px，玩家能跟上）');
        // 防送分只约束「被标记」蝌蚪（生成器保证 ex-sx≥MIN_MOVE）；干扰蝌蚪允许起点终点很近，
        // 但仍须靠波在持续游动（下面的 dStillMoving 覆盖全部蝌蚪）。
        if (sc.tadpoles[i].marked) {
          ok(dMid > 8, tag + ' #' + i + ' 被标记蝌蚪中段总位移仅 ' + dMid.toFixed(2) + 'px，游动被改没了');
        }
        ok(dStillMoving > 1, tag + ' #' + i + ' 中段应仍在持续游动');
        ok(dEnd < 1, tag + ' #' + i + ' 倒计时最后100ms位移 ' + dEnd.toFixed(3) + 'px（应<1px，平滑刹停）');
        // 单位时间速度：末尾必须显著低于中段，证明是「减速停住」而非「急刹」
        ok(dEnd / 100 < dStillMoving / (0.2 * D),
          tag + ' #' + i + ' 末尾速度未显著低于中段（急刹）');
        ok(dLate < dStillMoving, tag + ' #' + i + ' 末尾 200ms 位移应小于中段（确实在减速）');
      }

      /* ---- ⑤【核心】倒计时结束后完全定格：真实 update 多帧后逐位不变 ---- */
      sc.phase = 'answer'; sc.playT = D; sc.answerT = sc.answerMs;
      sc.found = {}; sc.foundCount = 0; sc.hintPulse = 0; sc.wrongFlash = null;
      var frozenPos = [], frozenRot = [], frozenWag = [];
      for (i = 0; i < sc.N; i++) {
        frozenPos.push(sc.posOf(i)); frozenRot.push(sc.rotOf(i)); frozenWag.push(sc.wagOf(i));
      }
      for (ti = 0; ti < 30; ti++) { sc.update(16); }   // 480ms 真实帧
      ok(sc.playT === D, tag + ' 作答期 playT 必须冻结在倒计时终点');
      ok(sc.phase === 'answer', tag + ' 作答期不应被 update 切走');
      for (i = 0; i < sc.N; i++) {
        ok(dist(sc.posOf(i), frozenPos[i]) < 1e-9,
          tag + ' #' + i + ' 作答期仍在移动（倒计时结束后没停下来）');
        ok(Math.abs(sc.rotOf(i) - frozenRot[i]) < 1e-9, tag + ' #' + i + ' 作答期朝向仍在变');
        ok(Math.abs(sc.wagOf(i) - frozenWag[i]) < 1e-9, tag + ' #' + i + ' 作答期摆尾仍在动');
      }
      ok(sc.markAlpha() === 0, tag + ' 作答期不应有红圈余辉');

      /* ---- ⑥ 红圈余辉：alpha 单调渐隐 + 中心跟随 + fade 后不残留 ---- */
      var prevA = Infinity;
      for (t = 0; t <= sc.markFadeMs + 100; t += 100) {
        sc.phase = 'shuffle'; sc.playT = t;
        var a = sc.markAlpha();
        ok(a <= prevA + 1e-9, tag + ' 红圈 alpha 应单调不增');
        prevA = a;
      }
      sc.playT = 0; ok(sc.markAlpha() === 1, tag + ' playT=0 红圈应全亮');
      sc.playT = sc.markFadeMs; ok(sc.markAlpha() === 0, tag + ' 余辉结束红圈应全隐');

      sc.phase = 'shuffle'; sc.playT = 300;
      var R = recCtx();
      sc.renderTadpoles(R.ctx);
      var circles = R.rec;
      ok(circles.length === sc.markCount,
        tag + ' 余辉期红虚线圈应=' + sc.markCount + '，实际 ' + circles.length);
      var expectA = 1 - 300 / sc.markFadeMs;
      for (ti = 0; ti < circles.length; ti++) {
        ok(Math.abs(circles[ti].alpha - expectA) < 1e-6, tag + ' 红圈 alpha 应随余辉渐隐');
      }
      for (ti = 0; ti < sc.markedIds.length; ti++) {
        var id = sc.markedIds[ti], mp = sc.posOf(id), hit = false;
        for (var ci = 0; ci < circles.length; ci++) {
          if (Math.abs(circles[ci].x - mp.x) < 0.01 && Math.abs(circles[ci].y - mp.y) < 0.01) { hit = true; }
        }
        ok(hit, tag + ' 红圈未跟随被标记蝌蚪 #' + id);
      }
      sc.playT = sc.markFadeMs + 16;
      var R2 = recCtx();
      sc.renderTadpoles(R2.ctx);
      ok(R2.rec.length === 0, tag + ' 余辉结束后不应再有红虚线圈');

      /* ---- ⑦ 结算态不得残留余辉 ---- */
      sc.win = { t: 0, press: null };
      ok(sc.markAlpha() === 0, tag + ' 过关结算不应有红圈余辉');
      sc.win = null;
      sc.fail = { t: 0, press: null };
      ok(sc.markAlpha() === 0, tag + ' 失败结算不应有红圈余辉');
      sc.fail = null;
    }
  }

  if (issues.length) {
    console.error('✗ 盯蝌蚪 衔接+定格 护栏失败：' + issues.length + ' 项');
    issues.slice(0, 20).forEach(function (m) { console.error('  - ' + m); });
    process.exit(1);
  }
  console.log('✓ 盯蝌蚪 衔接+定格 护栏通过：15 关 × 390/320 两档 × ' +
    checks + ' 项断言（起步连续/300ms<0.5px/900ms<12px · 中段持续游动 · ' +
    '末尾100ms<1px平滑刹停 · 作答期位置/朝向/摆尾逐位冻结 · 红圈渐隐跟随 · 结算无残留）');
})();
