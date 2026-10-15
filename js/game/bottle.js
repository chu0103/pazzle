/**
 * bottle.js —— 第 5 款游戏「瓶子颜色推理」
 *
 * 玩法（用户最终确认版）：
 *   屏幕上**两排瓶子**——上排是「目标顺序」但**全程隐藏**（只显示 N 个灰色占位），
 *   下排是「你的瓶子」。玩家在下面一排里**点选任意两个瓶子交换位置**，
 *   每交换一次，顶部实时显示「对了 X / N」（X = 位置与颜色都和隐藏目标相同的瓶子数）。
 *   玩家**看不到目标**，只能靠这个计数反推正确顺序，把下排排到 X == N 即过关。
 *
 * 闯关：4 → 10 个瓶子线性递增，每过一关 +1，到 10 个即通关（共 7 关）。
 * 数量越大越需要「标记」功能（点「标记」按钮进入标记模式，点瓶子加/去记号防记混）。
 *
 * 设计要点：
 *   - 颜色全不重复（每关从 8 色调色板里取 N 种），所以「对了几个」=「几个位置对了」，语义清晰。
 *   - 保证「玩家初始排列 ≠ 答案」且一定可解（任意排列都能靠交换还原，最少交换数 = N − 环数）。
 *   - par（最少交换数）算出来，星级按「实际交换数 vs par」给：越接近最优越多星。
 *   - 同关永远同一题（确定性 seed），每日挑战用日期做 seed。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.BottleGen) { return; }
  var U = BF.util;

  /** 10 种高对比度颜色（最多 10 个瓶子每瓶一色，互不重复），附中文名（无障碍 / 提示用） */
  var PALETTE = [
    { id: 0, name: '红', hex: '#E63946' },
    { id: 1, name: '蓝', hex: '#2D6CDF' },
    { id: 2, name: '绿', hex: '#2EA44F' },
    { id: 3, name: '黄', hex: '#F2C200' },
    { id: 4, name: '紫', hex: '#8B3DF5' },
    { id: 5, name: '橙', hex: '#FB8B24' },
    { id: 6, name: '青', hex: '#06AED7' },
    { id: 7, name: '粉', hex: '#FF5DA2' },
    { id: 8, name: '棕', hex: '#8B5A2B' },
    { id: 9, name: '柠', hex: '#B5E61D' }
  ];

  /** 线性闯关：4 → 10 个瓶子，每过一关 +1，到 10 个即通关（共 7 关） */
  var COUNTS = [4, 5, 6, 7, 8, 9, 10];
  var TOTAL = COUNTS.length;

  function sameOrder(a, b) {
    for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
    return true;
  }

  /**
   * 把 player 排成 target 最少需要几次交换。
   * 颜色互不相同 → 每个颜色在 target / player 里各出现一次，
   * 构造置换 σ：player 的第 i 位应当去 target 里该颜色所在的位置。
   * 最少交换数 = 元素数 − 置换环数。
   */
  function optimalSwaps(target, player) {
    var n = target.length, posT = {}, i;
    for (i = 0; i < n; i++) { posT[target[i]] = i; }
    var sigma = new Array(n);
    for (i = 0; i < n; i++) { sigma[i] = posT[player[i]]; }
    var visited = new Array(n), cycles = 0;
    for (i = 0; i < n; i++) {
      if (visited[i]) { continue; }
      cycles++;
      var j = i;
      while (!visited[j]) { visited[j] = true; j = sigma[j]; }
    }
    return n - cycles;
  }

  function build(n, daily) {
    n = Math.max(1, Math.min(TOTAL, Math.round(n || 1)));
    var count = COUNTS[n - 1];
    var rng = U.mulberry32((1000 + n * 2654435761) % 2147483647);

    // 选 count 种不同颜色
    var idxs = [];
    for (var i = 0; i < PALETTE.length; i++) { idxs.push(i); }
    U.shuffle(idxs, rng);
    var chosen = idxs.slice(0, count);

    // 答案行：chosen 打乱后的一种顺序（作为「目标顺序」）
    var target = chosen.slice();
    U.shuffle(target, rng);

    // 玩家行：target 的再打乱，保证不是「已经排好」
    var player = target.slice(), tries = 0;
    do {
      U.shuffle(player, rng);
      tries++;
    } while (sameOrder(player, target) && tries < 80);

    return {
      level: n,
      count: count,
      palette: PALETTE,
      target: target,        // 颜色索引数组（上排 = 答案）
      player: player,        // 颜色索引数组（下排 = 初始乱序，玩家在此交换）
      par: optimalSwaps(target, player),
      daily: !!daily
    };
  }

  function buildDaily(date) {
    var d = date || new Date();
    var rng = U.mulberry32(U.seedFromDate(d) % 2147483647);
    var n = 1 + Math.floor(rng() * TOTAL);
    return build(n, true);
  }

  BF.BottleGen = {
    build: build,
    buildDaily: buildDaily,
    palette: PALETTE,
    COUNTS: COUNTS,
    TOTAL: TOTAL,
    optimalSwaps: optimalSwaps
  };

  /* ---------------- 注册进合集 ---------------- */
  var games = BF.games || (BF.games = {});
  games.bottle = {
    id: 'bottle',
    // 「玩法说明」弹框（BF.RuleTip）：每次进这款游戏的第一个关卡时弹一次，
    // 玩家勾选「不再提示」后写入 Save.extra(id,'noRule')，之后不再弹。
    rules: {
      sub: '隐藏目标 · 推理排序',
      lines: [
        '上排是隐藏目标，不露出颜色',
        '点选或拖动，交换下排瓶子的顺序',
        '顶部「对了 X / N」全对即过关',
        '可用标记功能给瓶子做备忘',
      ]
    },
    title: '瓶子颜色推理',
    sub: '隐藏目标·推理排序',
    skin: 'bottle',
    scene: 'bottle',        // 独立玩法场景，关卡页据此路由
    TOTAL: TOTAL,
    build: function (n) { return build(n, false); },
    buildDaily: buildDaily
  };
})();
