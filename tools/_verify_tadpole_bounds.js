/**
 * _verify_tadpole_bounds.js —— 「盯蝌蚪」持续游动边界护栏
 *
 * 背景：还原参考视频造型后，蝌蚪尾巴长达 3.3r 且带行波摆动（正交偏移最大 0.70r），
 * 头朝速度方向自由旋转，因此**尾巴尖端可能甩出黄色卡片**。单帧截图只能看某一时刻，
 * 这里用数值方式全覆盖：15 关 × 390/320 两档屏宽 × 多个游动时刻 × 每只蝌蚪，
 * 以「圆形保守包络」(头中心 + 尾长 + 摆幅) 断言整只蝌蚪恒在卡片内。
 *
 * 圆形包络比真实尾巴更严格：圆过 ⇒ 实际尾巴必过。
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
  var issues = [];
  var checks = 0;

  // 与 drawTadpole 保持一致的包络常数（改造型时必须同步）
  var TAIL_REACH = 0.40 + 3.3;   // 尾尖沿局部 -x 到头中心的距离（单位 r）
  var WAG_MAX = 0.08 + 0.62;     // 行波最大正交摆幅（单位 r）
  var HALO = 0.28;               // 尾巴末端最小半宽 + 抗锯齿余量（像素）

  function sizeK(i) { return 0.90 + ((i * 7) % 5) * 0.045; }

  for (var W = 0; W < 2; W++) {
    BF.platform.width = W === 0 ? 390 : 320;
    BF.platform.height = W === 0 ? 844 : 700;
    for (var lv = 1; lv <= BF.TadpoleGen.TOTAL; lv++) {
      var sc = new BF.SceneTadpole(app).enter({ level: lv, game: 'tadpole' });
      if (sc.phase !== 'observe') { issues.push('L' + lv + ' 应从 observe 开始'); }

      // 覆盖观察期、起步延迟、缓入、中段加速、末尾减速、倒计时终点，
      // 以及 >1 的超界比例（验证 motionTimeOf clamp 饱和后仍安全）。
      var ratios = [0, 0.02, 0.08, 0.15, 0.25, 0.35, 0.45, 0.55,
                    0.65, 0.75, 0.85, 0.92, 0.97, 1, 1.2, 2];
      var times = ratios.map(function (r) { return r * sc.swimMs; });
      for (var ti = 0; ti < times.length; ti++) {
        // 直接设定 playT 与 phase，模拟该时刻（跳过 observe 锁定）
        sc.phase = 'shuffle';
        sc.playT = times[ti];
        var t = sc.tadpoles;
        for (var i = 0; i < sc.N; i++) {
          var p = sc.posOf(i);
          var rd = sc.r * sizeK(i);
          // 保守包络半径：尾长与摆幅正交合成 + 末端半宽
          var env = rd * Math.sqrt(TAIL_REACH * TAIL_REACH + WAG_MAX * WAG_MAX) + HALO + 1.5;
          checks++;
          var L = sc.cardX, R = sc.cardX + sc.cardW;
          var T = sc.cardY, B = sc.cardY + sc.cardH;
          if (p.x - env < L - 0.5 || p.x + env > R + 0.5 ||
              p.y - env < T - 0.5 || p.y + env > B + 0.5) {
            if (issues.length < 12) {
              issues.push('W' + BF.platform.width + ' L' + lv + ' t=' + times[ti] +
                ' 蝌蚪#' + i + ' 尾部包络出卡: center=(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) +
                ') env=' + env.toFixed(1) + ' card=[' + L.toFixed(1) + ',' + T.toFixed(1) +
                ',' + R.toFixed(1) + ',' + B.toFixed(1) + ']');
            }
          }
        }
      }
    }
  }

  if (issues.length) {
    console.log('✗ 盯蝌蚪游动边界护栏失败（' + issues.length + ' 处）:');
    issues.forEach(function (s) { console.log('   - ' + s); });
    process.exit(1);
  }
  console.log('✓ 盯蝌蚪游动边界护栏通过：15 关 × 390/320 两档 × 16 个倒计时比例时刻 × 每只蝌蚪 = ' +
    checks + ' 次包络检查，长尾(3.3r)+行波摆幅恒在卡片内（含定格点/clamp 超界）');
})();
