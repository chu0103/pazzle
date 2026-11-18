/**
 * cipher.js —— 第 6 款游戏「密码推理」（Mastermind / 珠玑妙算式破译密码）
 *
 * 玩法：
 *   系统随机生成一段**隐藏密码**（N 个互不重复的颜色，按顺序排列）。
 *   玩家在底部调色板上选颜色，拼出一行猜测后提交验证，系统给出反馈；
 *   在 7 次验证机会内把密码完全猜中即过关。
 *
 * **三种提示模式**（见 LEVELS 的 hint）：
 *   - 'line' 划线：反馈画在提交行**每一格的正下方**，一条线（前几关用，最醒目，适合教学）
 *   - 'dot'  圆点：反馈画在提交行**每一格的正下方**，一个点（中段用，位数多时不与格子抢视觉）
 *   - 'agg'  数量：反馈画在提交行**右侧**，只给"各状态的个数"的一个点阵（尾段用）——
 *            这是经典 Mastermind 的原始反馈：你知道"有 2 个位置对、1 个换位、3 个排除"，
 *            但**不知道是哪几格**，必须靠多行交叉推断，所以同样格子数下它比逐格提示更难。
 *   绿 = 颜色正确 + 位置正确（锁住别动）
 *   白 = 颜色在密码里，但位置不对（记住它，换到别处）
 *   黑 = 颜色根本不在密码里（后面可以直接不用）
 *
 * 难度来自**两个维度**，后段关卡一起涨（见 LEVELS）：
 *   1. 密码位数 slots × 可用颜色数 colors —— 候选空间 P(colors, slots) 同段内逐关严格递增
 *   2. **提示样式 hint** —— 换玩法段时从小规模重新起步（见下）
 *
 * 提示样式两档：
 *   - 'line' / 'dot' 逐格提示：每格都标 绿/白/黑。信息最全，基本是"照着提示挪"就能解，
 *     用于教学与前段关（L4 起位数多了，把划线小样换成圆点，不与格子抢视觉）。
 *   - 'agg' 数量提示：反馈画在行右侧，只给"几个位置对 / 几个换位 / 几个排除"，
 *     不说哪一格 —— 经典 Mastermind 的原始玩法，同位数下信息更少、更难，
 *     所以段内**从 3 位重新起步**，再靠位数/颜色抬上去。
 *
 * 设计要点：
 *   - **密码与猜测都不允许重复颜色**（密码由 N 个互不重复的颜色组成）。
 *     这样「白线」的语义才是确定的（这个颜色在密码里、但不是这一格），
 *     划线提示与聚合反馈（绿/白/黑计数）永远自洽；玩家猜的是
 *     「密码用了哪 N 个颜色 + 什么顺序」，而不是随手乱填。
 *     候选空间 = P(colors, slots)，例如 5 位 8 色 = 6720 种。
 *   - 同关永远同一题（确定性 seed），每日挑战用日期做 seed。
 *   - 星级阈值随关卡动态放宽（见 thresholdsFor），且是数据层的单一真源，
 *     场景与测试都从这里取，不会出现"改了场景忘了改测试"的漂移。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.CipherGen) { return; }
  var U = BF.util;

  /**
   * 10 种颜色：每种各占一个"色相家族"（红/橙/黄/绿/青/蓝/紫/粉/灰/棕），
   * **表内任意两色 ΔE00 ≥ 22.9**（最紧的一对是 紫/粉 22.9、蓝/紫 23.0）。经验口径：
   * <10 完全混淆、10~18 偏近、≥18 清晰可分——所以每一对都能一眼分开。
   *
   * ⚠️ 两轮历史坑（改色值前务必看完）：
   *   1) 旧版 `绿 #2EA44F` 与 `青绿 #0FA37F` 的 ΔE00 只有 **11.4** → 用户第 7 关截图
   *      投诉"两个颜色太相近"。先把这对拉开（ΔE00 24.3），但**玩家仍会觉得"怎么有两个绿"**——
   *      因为 L10 用满全部 10 色，抽样根本绕不开那两块绿（约束抽样也救不了）。
   *   2) **彻底解 = 把 `青绿` 换成中性灰 `#7A828E`**，让全表每种色相只出现一次，
   *      任何子集（含 10 色全用）都不可能再出现"两个同族色"。灰与彩色都远（青/灰 23.1、蓝/灰 24.7）。
   *   **改这组色值前先跑 `node tools/_palette_check.js` 确认最小 ΔE00 仍 ≥ 20**；
   *   `test/cipher.verify.js` 已有两道回归断言（最小 ΔE00 ≥ 20 + 绿色族 ≤ 1）。
   *   关卡是"从这 10 色里随机抽 N 色"：**必须全表两两可分 + 每族唯一**，任何子集才都可分。
   */
  var PALETTE = [
    { id: 0, name: '红', hex: '#E13B36' },
    { id: 1, name: '橙', hex: '#F5821F' },
    { id: 2, name: '黄', hex: '#F2C400' },
    { id: 3, name: '绿', hex: '#3FA34D' },
    { id: 4, name: '青', hex: '#1FB8D6' },
    { id: 5, name: '蓝', hex: '#1F56CE' },
    { id: 6, name: '紫', hex: '#B03FDD' },
    { id: 7, name: '粉', hex: '#FF5FA8' },
    { id: 8, name: '灰', hex: '#7A828E' },
    { id: 9, name: '棕', hex: '#7C4A1E' }
  ];

  /**
   * 10 关线性闯关，共**两个玩法段**（见 stageOf）。
   *
   * 难度用候选空间 P(colors, slots) 衡量（密码是从 colors 色里取 slots 个的排列）。
   * **只在同段内比较**——跨段比 P 没有意义：两段每次反馈给出的信息量不一样
   * （逐格提示一次给"哪几格对"，数量提示只给"几个对"），玩法换了就该重新起步。
   *
   *   ── 段 1：逐格提示（hint = line / dot），每格绿/白/黑全给 ──
   *     L1   24 → L2   60 → L3  120 → L4  360 → L5  720 → L6 5040
   *     L1~L3 划线小样（最醒目，教学用）；L4 起换圆点小样（位数多了不与格子抢视觉）。
   *     L4→L5→L6 逐级加位数（4→5→6）：L5 保持 6 色只加一位，L6 再加一色到 7 色
   *     （6 位 6 色的 P 与 L5 持平，必须加色才能保持段内严格递增）。
   *   ── 段 2：数量提示（hint = 'agg'）──
   *     L7  120 → L8 1680 → L9 15120 → L10 151200
   *     反馈改画在**行右侧**：只报"几个位置对 / 几个换位 / 几个排除"，不说是哪一格。
   *     这是经典 Mastermind 的原始玩法：同样位数下信息比逐格少，得靠多行交叉推断，
   *     所以**段内从小规模重新起步**（L7 只有 3 位 6 色，和 L3 一个量级）让玩家换脑子，
   *     再用位数/颜色把它推上去（L8 四位、L9 五位、L10 六位满池收尾）；
   *     机会也从 7 次放宽到 8 次——信息少了，多给一发。
   *
   * 历史上段 1 尾段（L5~L7）曾用过 'exact' 信息量：只标"位置对"的绿、其余留空，
   * 玩家分不清"换位"与"排除"、多行之间无法交叉验证，实测口碑"没有逻辑性"，
   * 2026-10 整段重做：L5/L6 改为全给反馈加位数，L7 起改为数量提示从 3 位重新起步，
   * 'exact' 机制（含场景里的「不告诉你」图例/空心圈绘制）随之全部删除。
   *
   * 各关机会次数：段 1 一律 7 次（对应参考玩具「7 步之内破译密码」的 7 行棋盘），
   * 段 2 放宽到 8 次（反馈更少，容错多一点）。
   */
  var LEVELS = [
    { slots: 3, colors: 4,  tries: 7, hint: 'line' },  // L1  三位四色，入门      P=24
    { slots: 3, colors: 5,  tries: 7, hint: 'line' },  // L2  色池加一            P=60
    { slots: 4, colors: 5,  tries: 7, hint: 'line' },  // L3  升到四位            P=120
    { slots: 4, colors: 6,  tries: 7, hint: 'dot'  },  // L4  色池加一，换圆点    P=360
    { slots: 5, colors: 6,  tries: 7, hint: 'dot'  },  // L5  升五位，全给反馈    P=720
    { slots: 6, colors: 7,  tries: 7, hint: 'dot'  },  // L6  六位七色，段 1 终关 P=5040
    { slots: 3, colors: 6,  tries: 8, hint: 'agg'  },  // L7  数量提示登场，3 位重新起步 P=120
    { slots: 4, colors: 8,  tries: 8, hint: 'agg'  },  // L8  升四位 + 加色       P=1680
    { slots: 5, colors: 9,  tries: 8, hint: 'agg'  },  // L9  升五位 + 加色       P=15120
    { slots: 6, colors: 10, tries: 8, hint: 'agg'  }   // L10 十色满池，最高难度  P=151200
  ];
  var TOTAL = LEVELS.length;

  function configOf(n) {
    var i = Math.max(1, Math.min(TOTAL, Math.round(n || 1)));
    return LEVELS[i - 1];
  }

  /**
   * 玩法段：1 = 逐格提示（line / dot），2 = 数量提示（agg）。
   * "难度递增"的断言只在同段内做（跨段玩法不同，比候选空间没有意义），
   * 所以拿它当唯一真源，测试与文档都从这里取。
   */
  function stageOf(n) {
    return configOf(n).hint === 'agg' ? 2 : 1;
  }

  /**
   * 聚合反馈（Mastermind 标准算法，兼容重复颜色；本游戏实际不重复）：
   *   exact 绿 = 颜色对 + 位置对
   *   color 白 = 颜色对、位置不对
   *   miss  黑 = 颜色不在密码里
   * exact + color + miss === 位数，恒成立。
   */
  function feedback(guess, code) {
    var n = code.length, i, j;
    var gUsed = [], cUsed = [];
    for (i = 0; i < n; i++) { gUsed[i] = false; cUsed[i] = false; }
    var exact = 0;
    for (i = 0; i < n; i++) {
      if (guess[i] === code[i]) { exact++; gUsed[i] = true; cUsed[i] = true; }
    }
    var color = 0;
    for (i = 0; i < n; i++) {
      if (gUsed[i]) { continue; }
      for (j = 0; j < n; j++) {
        if (cUsed[j]) { continue; }
        if (guess[i] === code[j]) { color++; cUsed[j] = true; break; }
      }
    }
    return { exact: exact, color: color, miss: n - exact - color };
  }

  /**
   * 逐格划线提示：每格 2 = 绿（颜色+位置都对）、1 = 白（颜色在密码里但位置不对）、0 = 黑（颜色不在密码里）。
   * 因为密码与猜测都不带重复颜色，这里的 2/1/0 计数与 feedback() 的 exact/color/miss 逐一相等
   * （测试里直接断言这一点，两种提示不会互相打架）。
   */
  function lineHint(guess, code) {
    var n = code.length, out = new Array(n), i, j;
    for (i = 0; i < n; i++) {
      if (guess[i] === code[i]) { out[i] = 2; continue; }
      var found = false;
      for (j = 0; j < n; j++) { if (code[j] === guess[i]) { found = true; break; } }
      out[i] = found ? 1 : 0;
    }
    return out;
  }

  /**
   * **数量提示（hint='agg'）的点阵数据**：把聚合反馈的三项计数摊成一个个点，
   * 顺序固定为 绿(2) → 白(1) → 黑(0)，长度恒等于位数。
   *
   * 场景拿到这个数组就能直接按网格画点（只知道个数、不知道是哪一格），
   * 测试也能靠它断言"点阵计数 === feedback 的三项"，渲染与数据不会各说各话。
   */
  function aggDots(fb) {
    var out = [], i;
    for (i = 0; i < fb.exact; i++) { out.push(2); }
    for (i = 0; i < fb.color; i++) { out.push(1); }
    for (i = 0; i < fb.miss; i++) { out.push(0); }
    return out;
  }

  /**
   * 动态星级阈值（以「用了几次验证」计）。
   *
   * 阈值**直接由难度参数推导**（位数 slots 与颜色数 colors），而不是按关卡序号硬编码——
   * 这样以后调 LEVELS 里的位数/颜色，评分线会自动跟着难度走，不会出现
   * "难度涨了、评分线没涨，入门关反而最难拿 3★"的错位。
   *
   *   3★ 线 three = round(2 + 0.5·slots + 0.15·colors)，上限 tries-2
   *       —— 机会只有 7~8 次，3★ 线再放宽就等于"最后一发才中也是满分"，失去意义。
   *   2★ 线 two   = three + 2，上限 tries-1（保证 1★ 这一段永远存在）。
   *
   * 'agg'（数量提示）关再放宽一档：它连"哪一格对"都不说，同样位数下要多花几次试错，
   * 拿逐格关的线去卡，通关的人几乎拿不到 3★。
   *
 * 当前 LEVELS 实得：3★ 线 = 4,4,5,5,5,5,5,6,6,6；2★ 线 = 6,6,6,6,6,6,7,7,7,7。
 * 参照：本仓库的数据驱动求解器（tools/_verify_cipher_logic.js）实测用 2,2,4,2,2,3,4,5,4,5 次，
 * 换题抽查最差 L6 5 次(7 机会) / L9 7 次(8 机会)，都在 3★~2★ 线之间或以内——难度合理。
   */
  function thresholdsFor(n) {
    var cfg = configOf(n);
    var tries = cfg.tries;
    var three = Math.round(2 + 0.5 * cfg.slots + 0.15 * cfg.colors);
    if (cfg.hint === 'agg') { three += 1; }        // 数量提示少给"哪一格"，评分线放宽一档
    three = Math.max(1, Math.min(three, tries - 2));
    var two = Math.min(three + 2, tries - 1);
    if (two <= three) { two = three + 1; }
    return { three: three, two: two };
  }

  function starsFor(n, used) {
    var th = thresholdsFor(n);
    if (used <= th.three) { return 3; }
    if (used <= th.two) { return 2; }
    return 1;
  }

  /** 生成第 n 关的密码（确定性：同一关永远同一题） */
  function build(n, daily) {
    var lv = Math.max(1, Math.min(TOTAL, Math.round(n || 1)));
    var cfg = configOf(lv);
    var rng = U.mulberry32((7000 + lv * 2654435761) % 2147483647);

    // 从 8 色里挑 cfg.colors 个"本关可用的颜色"，密码只从这里面取
    var idxs = [];
    for (var i = 0; i < PALETTE.length; i++) { idxs.push(i); }
    U.shuffle(idxs, rng);
    var usable = idxs.slice(0, cfg.colors).sort(function (a, b) { return a - b; });

    // 密码 = 从 usable 里取 slots 个互不重复的颜色，再打乱顺序
    var pool = usable.slice();
    U.shuffle(pool, rng);
    var code = pool.slice(0, cfg.slots);

    return {
      level: lv,
      slots: cfg.slots,
      colors: cfg.colors,
      tries: cfg.tries,
      hint: cfg.hint,
      palette: PALETTE,
      usable: usable,        // 本关可用的颜色下标（调色板只展示这些）
      code: code,            // 隐藏密码（颜色下标数组）
      daily: !!daily
    };
  }

  function buildDaily(date) {
    var d = date || new Date();
    var rng = U.mulberry32(U.seedFromDate(d) % 2147483647);
    var lv = 1 + Math.floor(rng() * TOTAL);
    return build(lv, true);
  }

  BF.CipherGen = {
    build: build,
    buildDaily: buildDaily,
    feedback: feedback,
    lineHint: lineHint,
    aggDots: aggDots,
    thresholdsFor: thresholdsFor,
    starsFor: starsFor,
    configOf: configOf,
    stageOf: stageOf,
    palette: PALETTE,
    LEVELS: LEVELS,
    TOTAL: TOTAL
  };

  /* ---------------- 注册进合集 ---------------- */
  var games = BF.games || (BF.games = {});
  games.cipher = {
    id: 'cipher',
    // 「玩法说明」弹框（BF.RuleTip）：每次进这款游戏的第一个关卡时弹一次，
    // 玩家勾选「不再提示」后写入 Save.extra(id,'noRule')，之后不再弹。
    rules: {
      sub: '有限次数内破译隐藏密码',
      lines: [
        '在有限次数内破译隐藏的密码',
        '每次提交后按本关提示给出反馈',
        '反馈分三档：划线 / 圆点 / 只给数量',
      ]
    },
    title: '密码推理',
    sub: '在有限机会内破译隐藏密码',
    skin: 'cipher',
    scene: 'cipher',        // 独立玩法场景，关卡页据此路由
    TOTAL: TOTAL,
    build: function (n) { return build(n, false); },
    buildDaily: buildDaily
  };
})();
