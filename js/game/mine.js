/**
 * mine.js —— 第 11 款游戏「扫雷」关卡生成器 + 数据层
 *
 * 玩法（经典扫雷）：
 *   棋盘 N×N 藏 M 颗雷，点格翻开：数字 = 周围 8 格的雷数；翻到 0 则洪水填充展开邻域；
 *   翻到雷即失败（全雷显形 + 红闪）。把全部非雷格翻开即过关。
 *
 * 核心卖点 —— **保证免猜**：
 *   每关的雷位在「运行时、以玩家首点为种子」生成：首点及其 8 邻域保证无雷（首点必安全），
 *   然后用「单步演绎求解器」(D1/D2) 反复重试，直到存在一条**纯逻辑**通路能清空全盘才采用。
 *   也就是说：只要玩家不主动乱点，按数字推理就一定能解出来，没有任何 50/50 的运气成分。
 *
 * 为什么运行时生成而不是离线内联雷位：
 *   免猜的保证与「首点落在哪」强相关（首点决定展开哪片区域）。把雷位钉死、又要求
 *   玩家首点必安全、还要求免猜，三者会互相打架。让 board = f(n, m, seed, firstClick)
 *   就从根上消除了这个矛盾——每次开局都天然免猜。代价只是「同一关每次首点不同→雷位略不同」，
 *   对休闲游戏完全可接受（每日挑战用固定首点，保证全服同题）。
 *
 * 数据层职责（与玩法场景解耦）：
 *   1. genBoard(n, m, seed, firstClick) —— 生成免猜棋盘（含首点安全 + 演绎重试 + 减雷兜底）；
 *   2. computeNums / neighbors / deduceClear —— 派生数字 + 单步演绎求解器（也是提示的后端）；
 *   3. build(n) / buildDaily —— 取第 n 关 / 每日关（确定性：同 level 同 seed）；
 *   4. starsFor(tier, ms) —— 按用时给 ★ 的唯一真源（阈值单调递增）；
 *   5. 注册 BF.games.mine（TOTAL=40，4 档 × 10 关）。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
         : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.MineGen) { return; }
  var U = BF.util;

  /* ---------------- 难度档 ---------------- */

  var TIER_NAMES = ['入门', '进阶', '困难', '专家'];
  var TIER_SIZE  = [8, 10, 12, 14];      // 棋盘边长
  var TIER_MINES = [10, 18, 28, 40];     // 雷数
  var TIER_COUNT = 10;                    // 每档 10 关
  var TOTAL = TIER_NAMES.length * TIER_COUNT;
  var DAILY_TIER = 1;                     // 每日挑战固定「进阶」档（中等，谁都能玩）

  function tierOf(n) { return Math.min(TIER_NAMES.length - 1, Math.floor((n - 1) / TIER_COUNT)); }
  function seedOf(n) { return (((n * 2654435761) >>> 0) ^ 0x9E3779B9 ^ (n * 40503)) >>> 0; }

  /* ---------------- 基础索引 ---------------- */

  function neighbors(idx, n) {
    var r = (idx / n) | 0, c = idx % n, out = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) { continue; }
        var nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= n || nc >= n) { continue; }
        out.push(nr * n + nc);
      }
    }
    return out;
  }

  function computeNums(mines, n) {
    var N = n * n, nums = new Array(N).fill(0);
    for (var i = 0; i < N; i++) {
      if (mines[i]) { continue; }
      var nb = neighbors(i, n), s = 0;
      for (var k = 0; k < nb.length; k++) { if (mines[nb[k]]) { s++; } }
      nums[i] = s;
    }
    return nums;
  }

  /* ---------------- 单步演绎求解器（免猜保证 + 提示后端） ---------------- */

  /**
   * 只凭「单格 / 数字」的确定性推导（不靠任何概率）能否清空全盘：
   *   D1：某数字格的「未翻开且未插旗」邻居数 === 数字−已插旗数 → 这些邻居全是雷；
   *   D2：某数字格的已插旗数 === 数字 → 剩余未翻开邻居全安全，翻开（洪水）。
   * 从首点展开的区域出发，反复迭代 D1/D2，直到不再变化；若此时所有非雷格都已翻开，
   * 说明这张盘「纯逻辑可解」——这正是我们要的生成目标。
   */
  function deduceClear(mines, nums, firstClick, n) {
    var N = n * n;
    var revealed = new Array(N).fill(false);
    var flagged = new Array(N).fill(false);
    var stack = [firstClick];
    while (stack.length) {
      var idx = stack.pop();
      if (revealed[idx]) { continue; }
      revealed[idx] = true;
      if (nums[idx] === 0) {
        var nb0 = neighbors(idx, n);
        for (var z = 0; z < nb0.length; z++) {
          if (!mines[nb0[z]] && !revealed[nb0[z]]) { stack.push(nb0[z]); }
        }
      }
    }
    var changed = true, guard = 0;
    while (changed) {
      changed = false;
      if (++guard > 20000) { break; }
      for (var i = 0; i < N; i++) {
        if (!revealed[i] || nums[i] === 0) { continue; }
        var nb = neighbors(i, n), hidden = [], flags = 0;
        for (var k = 0; k < nb.length; k++) {
          if (revealed[nb[k]]) { continue; }
          if (flagged[nb[k]]) { flags++; } else { hidden.push(nb[k]); }
        }
        if (hidden.length === 0) { continue; }
        if (hidden.length === nums[i] - flags) {
          for (var h = 0; h < hidden.length; h++) {
            if (!flagged[hidden[h]]) { flagged[hidden[h]] = true; changed = true; }
          }
        } else if (flags === nums[i]) {
          for (var h2 = 0; h2 < hidden.length; h2++) {
            if (!revealed[hidden[h2]]) { stack.push(hidden[h2]); }
          }
        }
      }
      while (stack.length) {
        var j = stack.pop();
        if (revealed[j]) { continue; }
        revealed[j] = true; changed = true;
        if (nums[j] === 0) {
          var nb2 = neighbors(j, n);
          for (var k2 = 0; k2 < nb2.length; k2++) {
            if (!mines[nb2[k2]] && !revealed[nb2[k2]]) { stack.push(nb2[k2]); }
          }
        }
      }
    }
    for (var z2 = 0; z2 < N; z2++) { if (!mines[z2] && !revealed[z2]) { return false; } }
    return true;
  }

  /* ---------------- 生成免猜棋盘 ---------------- */

  /**
   * 生成一张「首点必安全 + 纯逻辑可解」的棋盘。
   * 首点及其 8 邻域排除雷位（首点一定安全，且至少展开一小片）；
   * 在其余格随机布雷，用演绎求解器校验，不行就换一种随机顺序重试；
   * 极端密度下（理论上不会触发）兜底减一颗雷再试，保证永远出得来一张能玩的盘。
   *
   * @returns {{mines:bool[], nums:int[], firstClick:int, usedMines:int}|null}
   */
  function genBoard(n, m, seed, firstClick, opts) {
    opts = opts || {};
    var N = n * n;
    var excl = {}; excl[firstClick] = 1;
    var nb0 = neighbors(firstClick, n);
    for (var q = 0; q < nb0.length; q++) { excl[nb0[q]] = 1; }
    var pool = [];
    for (var i = 0; i < N; i++) { if (!excl[i]) { pool.push(i); } }

    var mines = m;
    var MAX = opts.maxAttempts || 8000;
    var rng = U.mulberry32(((seed >>> 0) ^ ((firstClick * 2654435761) >>> 0)) >>> 0);
    var attempt = 0;
    while (attempt < MAX) {
      attempt++;
      var order = pool.slice();
      U.shuffle(order, rng);
      var isMine = new Array(N).fill(false);
      for (var k = 0; k < mines; k++) { isMine[order[k]] = true; }
      var nums = computeNums(isMine, n);
      if (deduceClear(isMine, nums, firstClick, n)) {
        return { mines: isMine, nums: nums, firstClick: firstClick, usedMines: mines };
      }
    }
    // 兜底：减雷重试（仅在极密档位、且随机性极端时才可能走到）
    if (mines > 1) { return genBoard(n, mines - 1, seed, firstClick, { maxAttempts: MAX }); }
    return null;
  }

  /* ---------------- build ---------------- */

  function build(n) {
    n = Math.max(1, Math.min(TOTAL, n | 0));
    var t = tierOf(n);
    return {
      id: 'mine',
      level: n,
      tier: t,
      tierName: TIER_NAMES[t],
      n: TIER_SIZE[t],
      m: TIER_MINES[t],
      seed: seedOf(n),
      daily: false
    };
  }

  function buildDaily() {
    var seed = U.seedFromDate(new Date());
    var t = DAILY_TIER;
    return {
      id: 'mine',
      level: 0,
      tier: t,
      tierName: TIER_NAMES[t],
      n: TIER_SIZE[t],
      m: TIER_MINES[t],
      seed: seed,
      daily: true
    };
  }

  /* ---------------- 星级 ---------------- */

  /**
   * 按用时给 ★（毫秒）。阈值按档递增，放这里当唯一真源。
   * 经典扫雷越快越准，时间阈值给得比较宽松（休闲向，3 星不难但也不白送）。
   */
  var STAR_MS = [
    { t3: 45 * 60000,  t2: 120 * 60000 },   // 入门 8×8 / 10
    { t3: 90 * 60000,  t2: 210 * 60000 },   // 进阶 10×10 / 18
    { t3: 170 * 60000, t2: 360 * 60000 },   // 困难 12×12 / 28
    { t3: 280 * 60000, t2: 560 * 60000 }    // 专家 14×14 / 40
  ];

  function thresholdsFor(tier) { return STAR_MS[Math.max(0, Math.min(3, tier | 0))]; }

  function starsFor(tier, ms) {
    var th = thresholdsFor(tier);
    if (ms <= th.t3) { return 3; }
    if (ms <= th.t2) { return 2; }
    return 1;
  }

  /* ---------------- 注册 ---------------- */

  function tierLevels(name) {
    var idx = TIER_NAMES.indexOf(name);
    if (idx < 0) { return []; }
    var first = idx * TIER_COUNT + 1, out = [];
    for (var nn = first; nn <= Math.min(TOTAL, first + TIER_COUNT - 1); nn++) { out.push(nn); }
    return out;
  }

  function firstLevelOfSize(name) {
    var lv = tierLevels(name);
    return lv.length ? lv[0] : 1;
  }

  var games = BF.games || (BF.games = {});
  games.mine = {
    id: 'mine',
    title: '扫雷',
    // 「玩法说明」弹框（BF.RuleTip）：每次进这款游戏的第一个关卡时弹一次，
    // 玩家勾选「不再提示」后写入 Save.extra(id,'noRule')，之后不再弹。
    rules: {
      sub: '4 档 × 10 关 · 8×8 ~ 14×14',
      lines: [
        '翻开全部非雷格即通关，踩雷立即失败',
        '数字表示它周围 8 格里的雷数',
        '长按或开标记模式插旗',
        '每关都保证不猜，纯逻辑可解',
      ]
    },
    sub: '避开所有地雷',
    skin: 'mine',
    scene: 'mine',
    TOTAL: TOTAL,
    difficulties: TIER_NAMES,
    tierLevels: tierLevels,
    firstLevelOfSize: firstLevelOfSize,
    chipLabel: function (name) {
      var idx = TIER_NAMES.indexOf(name);
      return name + ' · ' + TIER_SIZE[idx] + '×' + TIER_SIZE[idx] + ' / ' + TIER_MINES[idx] + ' 雷';
    },
    // 难度自选首屏（BF.DiffPick）档卡副标题：尺寸 + 雷数 + 关卡范围
    pickInfo: function (idx, rg) {
      return {
        meta: TIER_SIZE[idx] + '×' + TIER_SIZE[idx] + ' · ' + TIER_MINES[idx] + ' 雷 · 第 ' +
              rg.first + '-' + rg.last + ' 关'
      };
    },
    build: function (n) { return build(n); },
    buildDaily: buildDaily
  };

  BF.MineGen = {
    TIER_NAMES: TIER_NAMES,
    TIER_SIZE: TIER_SIZE,
    TIER_MINES: TIER_MINES,
    TIER_COUNT: TIER_COUNT,
    TOTAL: TOTAL,
    DAILY_TIER: DAILY_TIER,
    STAR_MS: STAR_MS,
    tierOf: tierOf,
    seedOf: seedOf,
    neighbors: neighbors,
    computeNums: computeNums,
    deduceClear: deduceClear,
    genBoard: genBoard,
    build: build,
    buildDaily: buildDaily,
    thresholdsFor: thresholdsFor,
    starsFor: starsFor
  };
})();
