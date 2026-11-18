/**
 * redball.js —— 「盯红球」关卡生成器 + 注册（游戏 15）
 *
 * 玩法（忠实还原参考视频「盯住红球，别跟丢了」的洗牌追踪版，并加难度）：
 *   - 开局 N 个球排成网格，其中恰好 RED_COUNT 个**红球**（其余为统一干扰色），
 *     红球位置随机（startReds）。
 *   - 观察期：红球红、其余蓝，短暂展示让玩家看清每颗红球位置。
 *   - 洗牌期：所有球瞬间统一成干扰色（颜色信息抹除），随后在槽位间
 *     两两交换位置（swaps 次，速度随关卡加快）—— 玩家靠"盯住红球运动轨迹"
 *     记住它们去哪了。
 *   - 作答期：球停在槽位、显编号 1–N；玩家须**点出全部红球的最终落点**。
 *     点中一个正确槽位即标记找到；点错或超时扣 1 颗心，3 心用完本关失败重来。
 *
 * 生成器保证「每颗红球确实被移动过」：模拟后 finalReds[i] !== startReds[i]，
 * 否则追加把该红球挪走的交换（防"没洗牌"送分）。全部由 level 决定的种子驱动
 * → 确定性、可复现、便于测试与每日挑战。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.RedballGen) { return; }
  var U = BF.util;

  // 球配色（红球高饱和红；干扰色蓝，与参考洗牌期绿一致用蓝更醒目）
  var RED = '#FF5B5B';
  var DISTRACT = '#4C8DFF';
  var TOTAL = 18;

  // 18 关五维度：球数 N、红球数 RED、洗牌次数 swaps、观察时长 observeMs /
  // 单次交换时长 swapMs / 作答倒计时 answerMs。难度严格单调：
  // N↑、RED↑、swaps↑、observe/answer↓、swapMs↓。
  var N_PER_LEVEL      = [6, 6, 6, 6,  8, 8, 8, 8, 10, 10, 12, 12, 14, 14, 16, 16, 18, 18];
  var RED_PER_LEVEL    = [1, 1, 1, 1,  1, 1, 1, 1,  1,  2,  2,  2,  2,  2,  3,  3,  3,  3];
  var SWAPS_PER_LEVEL = [3, 3, 4, 4,  5, 5, 6, 6,  7,  8,  9, 10, 11, 12, 13, 14, 15, 16];
  var OBSERVE_MS       = [2500,2400,2300,2200, 2100,2000,1900,1800, 1700,1600,1500,1400,1300,1250,1200,1150,1100,1050];
  var SWAP_MS          = [340, 330, 320, 310, 300, 290, 280, 270, 260, 250, 240, 230, 220, 210, 200, 195, 190, 185];
  var ANSWER_MS        = [9000,8800,8600,8400, 8200,8000,7800,7600, 7400,7200,7000,6800,6600,6400,6200,6000,5800,5600];

  function paramsForLevel(level) {
    var i = U.clamp(level - 1, 0, TOTAL - 1);
    return {
      N: N_PER_LEVEL[i],
      redCount: RED_PER_LEVEL[i],
      swaps: SWAPS_PERLEVEL(i),
      observeMs: OBSERVE_MS[i],
      swapMs: SWAP_MS[i],
      answerMs: ANSWER_MS[i]
    };
  }
  function SWAPS_PERLEVEL(i) { return SWAPS_PER_LEVEL[i]; }

  /** 核心：用 rng 造一组洗牌。返回 {startReds, swaps, finalReds} */
  function gen(rng, N, swapsCount, redCount) {
    // 从 0..N-1 中不重复抽取 redCount 个作为红球初始槽位（球 id==初始槽位）
    var pool = [];
    for (var i = 0; i < N; i++) { pool.push(i); }
    var startReds = [];
    for (var s = 0; s < redCount; s++) {
      var idx = Math.floor(rng() * pool.length);
      startReds.push(pool[idx]);
      pool.splice(idx, 1);
    }
    startReds.sort(function (a, b) { return a - b; });

    var swaps = [];
    for (var k = 0; k < swapsCount; k++) {
      var a = Math.floor(rng() * N);
      var b = Math.floor(rng() * N);
      while (b === a) { b = Math.floor(rng() * N); }
      swaps.push([a, b]);
    }

    // 模拟：id 为 r 的球，经过 swaps 后落在哪个槽位
    function finalOf(r) {
      var slot = r;
      for (var k = 0; k < swaps.length; k++) {
        var x = swaps[k][0], y = swaps[k][1];
        if (slot === x) { slot = y; }
        else if (slot === y) { slot = x; }
      }
      return slot;
    }

    var finalReds = startReds.map(finalOf);

    // 防送分：每颗红球最终都不能停在原位（否则太容易盯），逐颗追加挪走交换
    var guard = 0;
    while (guard++ < 40) {
      var allMoved = true;
      for (var r = 0; r < startReds.length; r++) {
        if (finalReds[r] === startReds[r]) {
          allMoved = false;
          var other = (startReds[r] + 1) % N;
          swaps.push([startReds[r], other]);
        }
      }
      if (allMoved) { break; }
      finalReds = startReds.map(finalOf);
    }
    return { startReds: startReds, swaps: swaps, finalReds: finalReds };
  }

  function build(level) {
    var p = paramsForLevel(level);
    var rng = U.mulberry32((0x1b873593 ^ Math.imul(level, 0x9E3779B1)) >>> 0);
    var g = gen(rng, p.N, p.swaps, p.redCount);
    return {
      level: level,
      N: p.N,
      redCount: p.redCount,
      swaps: g.swaps,
      startReds: g.startReds,
      finalReds: g.finalReds,
      observeMs: p.observeMs,
      swapMs: p.swapMs,
      answerMs: p.answerMs,
      red: RED,
      distract: DISTRACT
    };
  }

  /** 每日挑战：取"困难"档参数，用当天日期种子生成，全服同题（2 红 / 12 球） */
  function buildDaily() {
    var d = new Date();
    var seed = (U.seedFromDate ? U.seedFromDate(d) : (Date.now() & 0x7fffffff)) >>> 0;
    var rng = U.mulberry32((seed ^ 0x85EBCA6B) >>> 0);
    var g = gen(rng, 12, 10, 2);
    return {
      level: 0,
      daily: true,
      N: 12,
      redCount: 2,
      swaps: g.swaps,
      startReds: g.startReds,
      finalReds: g.finalReds,
      observeMs: 1500,
      swapMs: 240,
      answerMs: 7000,
      red: RED,
      distract: DISTRACT
    };
  }

  function starsFor(mistakes, hintsUsed) {
    var s = mistakes === 0 ? 3 : (mistakes <= 2 ? 2 : 1);
    if (hintsUsed >= 1) { s = Math.min(s, 2); }
    if (hintsUsed >= 2) { s = Math.min(s, 1); }
    return s;
  }

  BF.RedballGen = {
    RED: RED,
    DISTRACT: DISTRACT,
    TOTAL: TOTAL,
    N_PER_LEVEL: N_PER_LEVEL,
    RED_PER_LEVEL: RED_PER_LEVEL,
    SWAPS_PER_LEVEL: SWAPS_PER_LEVEL,
    OBSERVE_MS: OBSERVE_MS,
    SWAP_MS: SWAP_MS,
    ANSWER_MS: ANSWER_MS,
    paramsForLevel: paramsForLevel,
    gen: gen,
    build: build,
    buildDaily: buildDaily,
    starsFor: starsFor
  };

  // 注册（固定 18 关闯关，TOTAL=18；后段引入 2~3 个红球追踪）
  var games = BF.games || (BF.games = {});
  games.redball = {
    id: 'redball',
    title: '盯红球',
    sub: '盯住红球，别跟丢了',
    skin: 'redball',
    scene: 'redball',
    TOTAL: TOTAL,
    build: function (n) { return build(n); },
    buildDaily: function () { return buildDaily(); },
    rules: {
      sub: '盯住红球，记住它们的位置',
      lines: [
        '开局红球是红色，其余是蓝色',
        '洗牌时所有球变同色交换位置',
        '记住每颗红球最后到了哪',
        '作答期点出全部红球落点',
        '点错或超时扣 1 心，3 心用完重来'
      ]
    }
  };
})();
