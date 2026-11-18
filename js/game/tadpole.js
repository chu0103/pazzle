/**
 * tadpole.js —— 「盯蝌蚪」关卡生成器 + 注册（游戏 16）
 *
 * 玩法（忠实还原参考视频「盯紧被标记的蝌蚪」的标记追踪版，并加难度）：
 *   - 开局 N 只蝌蚪自由散布在卡片上，其中恰好 T 只被**红虚线圈住**（观察期临时标注），
 *     其余为"干扰蝌蚪"。蝌蚪非 uniform（尾巴朝向/大小各异），长得很像。
 *   - 观察期：红圈圈住 T 只，短暂展示让玩家看清"哪几只被圈"。
 *   - 游动倒计时：红圈**渐隐撤销**，所有蝌蚪连续蜿蜒游动+摆尾到新位置（看得清轨迹
 *     但无标记可依赖），此阶段**不可点选**；倒计时归零时按 S 曲线平滑停下。
 *   - 作答期：蝌蚪**完全定格**在倒计时结束那一帧、无编号；玩家须**点出全部被标记蝌蚪**。
 *     点中一个正确蝌蚪即标记找到；点错或超时扣 1 颗心，3 心用完本关失败重来。
 *
 * 生成器保证「每只被标记蝌蚪确实被移动过」：打乱后其落点与起点距离 ≥ MIN_MOVE
 * （否则"没动=送分"）。全部由 level 决定的种子驱动 → 确定性、可复现、便于测试与每日挑战。
 *
 * 坐标用**归一化 [0,1]²**（相对卡片内可放区），场景再映射到像素——便于无 canvas 测试。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.TadpoleGen) { return; }
  var U = BF.util;

  // 蝌蚪配色（全是深色，互看长得像——标记只靠红圈，不在颜色上作弊）
  var INK = '#2B2F38';
  var MARK = '#FF5B5B';
  var TOTAL = 15;

  // 15 关五维度：蝌蚪数 N、被标记只数 MARK、观察 observeMs / 游动倒计时 shuffleMs /
  // 作答倒计时 answerMs。难度严格单调：N↑、MARK↑、observe/answer↓；
  // 游动倒计时**不再当难度轴**：后段目标更多更密，反而需要更充裕的追踪窗口，
  // 故全程只小幅递减（4.5s → 4.15s），避免「越到后面越赶、跟丢目标」。
  var N_PER_LEVEL     = [8, 9, 10, 11, 12,  12, 13, 14, 14, 14,  16, 16, 16, 16, 16];
  var MARK_PER_LEVEL  = [2, 2, 2, 2, 2,   3,  3,  3,  3,  3,   4,  4,  4,  4,  4];
  var OBSERVE_MS      = [2600,2500,2400,2300,2200, 2100,2000,1900,1800,1700, 1600,1500,1400,1300,1200];
  // 游动倒计时：红圈消失后蝌蚪游动的时长，归零即定格开放点选。
  // 2026-11-13 第五轮（用户「后面的关卡动画时间可以稍微多一点」）：
  //   旧表 4.5s→3.5s 陡降，11~15 关只剩 3.5~3.75s，而这档恰好 16 只蝌蚪 / 4 目标最挤；
  //   改为每关 -25ms 的缓降（全程降幅仅 350ms），后段抬到 4.15~4.25s（+0.5~0.65s）。
  // ⚠️ 下限不能回到旧的 1.1~1.8s 离场缓动：整段打乱要在倒计时内完成并平滑刹停，
  //    短窗口会让中段速度飙到 ~200px/s 直接跟丢目标。
  var SHUFFLE_MS      = [4500,4475,4450,4425,4400, 4375,4350,4325,4300,4275, 4250,4225,4200,4175,4150];
  var ANSWER_MS       = [9000,8800,8600,8400,8200, 8000,7800,7600,7400,7200, 7000,6800,6600,6400,6200];

  function paramsForLevel(level) {
    var i = U.clamp(level - 1, 0, TOTAL - 1);
    return {
      N: N_PER_LEVEL[i],
      markCount: MARK_PER_LEVEL[i],
      observeMs: OBSERVE_MS[i],
      shuffleMs: SHUFFLE_MS[i],
      answerMs: ANSWER_MS[i]
    };
  }

  var PAD = 0.09;          // 散布内边距（归一化）
  var MIN_MOVE = 0.18;     // 被标记蝌蚪最小位移（防送分）

  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

  /** 在 [PAD,1-PAD]² 内散布 N 个点，两两间距 ≥ minSep（带松弛回退） */
  function scatter(rng, N, minSep) {
    var pts = [], guard = 0, sep = minSep;
    while (pts.length < N) {
      var x = PAD + rng() * (1 - 2 * PAD);
      var y = PAD + rng() * (1 - 2 * PAD);
      var ok = true;
      for (var i = 0; i < pts.length; i++) {
        if (dist(pts[i], { x: x, y: y }) < sep) { ok = false; break; }
      }
      if (ok) { pts.push({ x: x, y: y }); guard = 0; }
      else if (++guard > 3000) { sep *= 0.85; guard = 0; }
    }
    return pts;
  }

  /** 核心：用 rng 造一组打乱。返回 {markedIds, tadpoles:[{id,marked,sx,sy,ex,ey,r0,r1}]} */
  function gen(rng, N, markCount) {
    var minSep = 0.62 / Math.sqrt(N);

    // 选 markCount 个被标记（目标）id
    var pool = [];
    for (var i = 0; i < N; i++) { pool.push(i); }
    var markedIds = [];
    for (var s = 0; s < markCount; s++) {
      var idx = Math.floor(rng() * pool.length);
      markedIds.push(pool[idx]);
      pool.splice(idx, 1);
    }
    markedIds.sort(function (a, b) { return a - b; });
    var markSet = {};
    for (var m = 0; m < markedIds.length; m++) { markSet[markedIds[m]] = true; }

    // 起点 / 终点散布
    var starts = scatter(rng, N, minSep);
    var ends = scatter(rng, N, minSep);

    // 防送分：每只被标记蝌蚪终点必须离起点 ≥ MIN_MOVE
    for (var k = 0; k < markedIds.length; k++) {
      var mi = markedIds[k];
      var tries = 0;
      while (dist(ends[mi], starts[mi]) < MIN_MOVE && tries < 50) {
        tries++;
        var x = PAD + rng() * (1 - 2 * PAD);
        var y = PAD + rng() * (1 - 2 * PAD);
        if (dist({ x: x, y: y }, starts[mi]) < MIN_MOVE) { continue; }
        var collide = false;
        for (var j = 0; j < N; j++) {
          if (j === mi) { continue; }
          if (dist({ x: x, y: y }, ends[j]) < minSep * 0.8) { collide = true; break; }
        }
        if (!collide) { ends[mi] = { x: x, y: y }; break; }
      }
      if (dist(ends[mi], starts[mi]) < MIN_MOVE) {
        ends[mi] = { x: 1 - starts[mi].x, y: 1 - starts[mi].y };
      }
    }

    // 组装（含游动参数：还原参考视频的「细长尾蝌蚪蜿蜒游动」——仅在游动倒计时内播放，
    // 每只蝌蚪绕中心 (ex,ey) 做主波+次级波叠加的有界游动，头朝速度方向、尾巴波状摆动。
    // 全部由 level 决定的 rng 生成 → 确定性、可复现、便于无 canvas 测试）
    var tadpoles = [];
    var amp = U.clamp(minSep * 0.62, 0.05, 0.105);  // 主波幅度（视频位移大；按密度收紧防重叠）
    var fbase = 0.0017;                             // 基础角频（≈3.7s/周期，明显但可追踪）
    for (var id = 0; id < N; id++) {
      var r0 = rng() * Math.PI * 2;
      var r1 = r0 + (rng() * 2 - 1) * Math.PI;
      var ax = amp * (0.8 + rng() * 0.4), ay = amp * (0.8 + rng() * 0.4);
      var fx = fbase * (0.72 + rng() * 0.56), fy = fbase * (0.72 + rng() * 0.56);
      var px = rng() * Math.PI * 2, py = rng() * Math.PI * 2;
      // 次级波：叠加高频小扰动，让轨迹蜿蜒而非规则椭圆（视频里蝌蚪是拐弯游的）
      var ax2 = amp * (0.24 + rng() * 0.16), ay2 = amp * (0.24 + rng() * 0.16);
      var fx2 = fx * (2.1 + rng() * 0.5), fy2 = fy * (2.0 + rng() * 0.5);
      var px2 = rng() * Math.PI * 2, py2 = rng() * Math.PI * 2;
      var wag = 0.0085 + rng() * 0.005;             // 摆尾角频（rad/ms，尾波行波）
      var wagPh = rng() * Math.PI * 2;              // 摆尾初相
      tadpoles.push({
        id: id,
        marked: !!markSet[id],
        sx: starts[id].x, sy: starts[id].y,
        ex: ends[id].x, ey: ends[id].y,
        r0: r0, r1: r1,
        ax: ax, ay: ay, fx: fx, fy: fy, px: px, py: py,
        ax2: ax2, ay2: ay2, fx2: fx2, fy2: fy2, px2: px2, py2: py2,
        wag: wag, wagPh: wagPh
      });
    }
    return { markedIds: markedIds, tadpoles: tadpoles };
  }

  function build(level) {
    var p = paramsForLevel(level);
    var rng = U.mulberry32((0x1b873593 ^ Math.imul(level, 0x9E3779B1)) >>> 0);
    var g = gen(rng, p.N, p.markCount);
    return {
      level: level,
      N: p.N,
      markCount: p.markCount,
      markedIds: g.markedIds,
      tadpoles: g.tadpoles,
      observeMs: p.observeMs,
      shuffleMs: p.shuffleMs,
      answerMs: p.answerMs,
      ink: INK,
      mark: MARK
    };
  }

  /** 每日挑战：取"困难"档参数（N=12 / 3 标记），用当天日期种子，全服同题 */
  function buildDaily() {
    var d = new Date();
    var seed = (U.seedFromDate ? U.seedFromDate(d) : (Date.now() & 0x7fffffff)) >>> 0;
    var rng = U.mulberry32((seed ^ 0x85EBCA6B) >>> 0);
    var g = gen(rng, 12, 3);
    return {
      level: 0,
      daily: true,
      N: 12,
      markCount: 3,
      markedIds: g.markedIds,
      tadpoles: g.tadpoles,
      observeMs: 1900,
      shuffleMs: 4300,
      answerMs: 7000,
      ink: INK,
      mark: MARK
    };
  }

  function starsFor(mistakes, hintsUsed) {
    var s = mistakes === 0 ? 3 : (mistakes <= 2 ? 2 : 1);
    if (hintsUsed >= 1) { s = Math.min(s, 2); }
    if (hintsUsed >= 2) { s = Math.min(s, 1); }
    return s;
  }

  BF.TadpoleGen = {
    INK: INK,
    MARK: MARK,
    TOTAL: TOTAL,
    N_PER_LEVEL: N_PER_LEVEL,
    MARK_PER_LEVEL: MARK_PER_LEVEL,
    OBSERVE_MS: OBSERVE_MS,
    SHUFFLE_MS: SHUFFLE_MS,
    ANSWER_MS: ANSWER_MS,
    MIN_MOVE: MIN_MOVE,
    paramsForLevel: paramsForLevel,
    gen: gen,
    build: build,
    buildDaily: buildDaily,
    starsFor: starsFor
  };

  // 注册（固定 15 关闯关，TOTAL=15；后段引入 3~4 只被标记蝌蚪追踪）
  var games = BF.games || (BF.games = {});
  games.tadpole = {
    id: 'tadpole',
    title: '盯蝌蚪',
    sub: '盯紧被标记的蝌蚪',
    skin: 'tadpole',
    scene: 'tadpole',
    TOTAL: TOTAL,
    build: function (n) { return build(n); },
    buildDaily: function () { return buildDaily(); },
    rules: {
      sub: '盯紧被标记的蝌蚪，别跟丢了',
      lines: [
        '开局红圈圈住几只蝌蚪',
        '红圈消失后蝌蚪持续游动',
        '倒计时结束蝌蚪才会停下',
        '停下后点出全部被标记蝌蚪',
        '点错或超时扣 1 心，3 心用完重来'
      ]
    }
  };
})();
