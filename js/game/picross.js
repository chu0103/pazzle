/**
 * picross.js —— 第 12 款游戏「数织 / Picross」关卡数据层 + 注册
 *
 * 玩法（彩色数织 / Color Picross）：
 *   每行每列给一串「带颜色的数字」，表示该行/列里**连续同色段**的长度。
 *   例：一行是 [红,红,蓝,红] → 行提示为「红2 蓝1 红1」；空位把不同颜色的段隔开。
 *   把所有格子按提示填对即通关（解出来是一张彩色像素画）。
 *
 * 关卡来源（与 sudoku/blocks 一致：**离线生成、内联数据**）：
 *   图案来自 tools/gen_picross_levels.js 里的手工图案库（ASCII 点阵），
 *   生成器会用「唯一解求解器」逐关校验：**只有行/列线索能推出唯一解的图案才会入选**，
 *   否则玩家可能推出两种都合法的填法（数织的大忌）。LEVELS 按 base-36 紧凑存储：
 *   每格一个字符 —— '-' 表示空位，'0'-'9'/'a'-'z' 表示 PALETTE 里的颜色序号。
 *
 * 为什么线索不存、只存解：线索是解的唯一函数（cluesFor），
 *   运行时算 40 关的代价是几十微秒；少存一份数据就少一处「线索与解不一致」的风险。
 *   数据层仍然导出 solveCount/isUnique，供 test/picross.verify.js 做运行时回归。
 *
 * 数据层职责：
 *   1. LEVELS + decodeGrid/encodeGrid —— 关卡存储与解码；
 *   2. cluesFor —— 行/列线索（唯一真源，场景和测试都从这里取）；
 *   3. lineOptions/propagate/solveCount/isUnique —— 唯一解求解器（生成期过滤 + 测试回归）；
 *   4. build(n) / buildDaily —— 取关（确定性：同关永远同题）；
 *   5. starsFor(tier, ms) —— 按用时给 ★ 的唯一真源（阈值随档递增）；
 *   6. 注册 BF.games.picross（TOTAL=40，4 档 × 10 关）。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.PicrossGen) { return; }
  var U = BF.util;

  /* ---------------- 调色板 ----------------
   * 彩色数织的可用颜色。每关最多用 6 色（档位越高色越多），
   * 索引即关卡数据里的字符（'0'..'9','a'..'z'）。 */
  var PALETTE = [
    { hex: '#E4572E', name: '红' },   // 0
    { hex: '#F2A03D', name: '橙' },   // 1
    { hex: '#F0C244', name: '黄' },   // 2
    { hex: '#5FA85A', name: '绿' },   // 3
    { hex: '#37A0A0', name: '青' },   // 4
    { hex: '#3E7CB1', name: '蓝' },   // 5
    { hex: '#8E6FB5', name: '紫' },   // 6
    { hex: '#8A5A3B', name: '棕' },   // 7
    { hex: '#EE8FA9', name: '粉' },   // 8
    { hex: '#3A3F4A', name: '墨' }    // 9
  ];
  var PALETTE_HEX = PALETTE.map(function (p) { return p.hex; });
  var PALETTE_NAME = PALETTE.map(function (p) { return p.name; });

  /* ---------------- 难度档 ---------------- */

  var TIER_NAMES = ['入门', '进阶', '困难', '专家'];
  var TIER_SIZE  = [5, 10, 12, 15];       // 棋盘边长
  var TIER_COLORS = [3, 4, 5, 6];         // 每档颜色数上限（图案库按档控制）
  var TIER_COUNT = 10;                     // 每档 10 关
  var TOTAL = TIER_NAMES.length * TIER_COUNT;
  var DAILY_TIER = 2;                      // 每日挑战固定「困难」档（12×12，有挑战但不太大）

  function tierOf(n) { return Math.min(TIER_NAMES.length - 1, Math.floor((n - 1) / TIER_COUNT)); }

  /* ---------------- 关卡数据（离线生成，勿手改；重跑 tools/gen_picross_levels.js）-------- */
  // __PICROSS_LEVELS_BEGIN__
  var LEVELS = [
    { n: 5, g: '-0-0-0000000000-000---0--', name: '爱心' },
    { n: 5, g: '--2---222-22222-222--2-2-', name: '星星' },
    { n: 5, g: '--7---73--0000000000-000-', name: '苹果' },
    { n: 5, g: '--11-511195511951119--11-', name: '小鱼' },
    { n: 5, g: '-0-0-00000277722-77222222', name: '小房子' },
    { n: 5, g: '62626-626--626---3----3--', name: '小花' },
    { n: 5, g: '-222-222--22---222---222-', name: '月牙' },
    { n: 5, g: '2---2-222-22122-222-2---2', name: '太阳' },
    { n: 5, g: '000000808000000--7----7--', name: '蘑菇' },
    { n: 5, g: '6666666666-666---7----7-7', name: '雨伞' },
    { n: 10, g: '77------77767----767-77777777-77888888777898888987789888898778888888877888988887-78888887---777777--', name: '小猫' },
    { n: 10, g: '7--------777------7777888888777898888987789888898778888988877888008887-78888887---777777-----7777---', name: '小狗' },
    { n: 10, g: '-66----66--66----66--66----66-88888888888889889888888988988888888988888888888888-88888888---888888--', name: '小兔' },
    { n: 10, g: '-33----33-3333--33333393333933-33333333-333333333338333333833333333333-33333333---333333-----3333---', name: '青蛙' },
    { n: 10, g: '----0--------00000----8888888--22222222--22222222---8888888--22222222--22222222---8888888-7777777777', name: '蛋糕' },
    { n: 10, g: '----99-------9889-----000000---00000000-0000000000000000000099------99-9------9---------------------', name: '小汽车' },
    { n: 10, g: '------5--------555------55555-888888888888888888880888888888----555--------5------------------------', name: '小飞机' },
    { n: 10, g: '----33-------3333-----333333---33133313--33333333---333333------77--------77-------7777-----777777--', name: '大树' },
    { n: 10, g: '--2-2-2----2222222--222777222222277722222227772222-2222222------33--------33-------3333-------33----', name: '向日葵' },
    { n: 10, g: '----99-------9889-----998899----988889---99888899--99888899--99888899---988889-----9889-----11--11--', name: '企鹅' },
    { n: 12, g: '--99----99---9889--9889--9889--9889---99999999----99999999----98899889----99999999-----999999------999999------999999-------9999--------9999----', name: '大象' },
    { n: 12, g: '--7------7---729----927--729----927--777----777---77777777----77777777----78888887----78898887----78888887-----777777------7-77-7-----77--77----', name: '猫头鹰' },
    { n: 12, g: '--7-7--7-7----0-7--7-0----077--770---0777777770--0777777770--0727777270--0727777270--0777777770---777--777----777--777----777--777----77755777--', name: '城堡' },
    { n: 12, g: '-----99----------99------9999999999--9598888959--9889889889--9999009999----988889-----98888889----98988989----98888889-----999999------99--99---', name: '机器人' },
    { n: 12, g: '-----0----------333---------3-3------88-3-3-88---33-3-3-33---33-----33-----3---3-------3---3-------3---3------333-333-----7777777-----7777777---', name: '仙人掌' },
    { n: 12, g: '-----2----------222----------22---------8888-------888888-----80000008----88888888-----888888-----80000008-----888888-----8889888-----5559555---', name: '灯塔' },
    { n: 12, g: '---0----0-----00----00----000--000-----00--00-------0000---------77---------7777--------7227-------777777-----77722777----77777777----33333333--', name: '风车' },
    { n: 12, g: '--88888888---8888888888---33333333----00000000----22222222----00000000----22222222----77777777---7777777777--7777777777---77777777--------------', name: '汉堡' },
    { n: 12, g: '--77----77---7777--7777--7777--7777---77----77---7777777777--7777777777--7977777797--7977777797--7777887777--7778888777--7777897777---77777777--', name: '小熊' },
    { n: 12, g: '--------------88888888---8888888888--8898888988--8888888888--8887777888--8887997888--8887777888--8888888888---88888888-----888888---------------', name: '小猪' },
    { n: 15, g: '-------5-------------555-----------55555-------55555555555---5555555555555-555955555555555555555555555555555555555555555555555555555555555555555555555-5555555555555---88888888888-----888888888--------88888------------8-------', name: '鲸鱼' },
    { n: 15, g: '--1---1---1-----1111-111-111----122277777222--1222177771222---122277777222--1222277722222---1111-11111----------333------------33-------------33--------333-333-333---------33-------------33------------3333-----------3333-----', name: '向日葵' },
    { n: 15, g: '-------2-------------222-----------22222-----------999-----------99999---------8888888-------888888888-----8000000008-----88888888888-----80000008-------888888888-----8000000008------888888888-------8888888-------555555555---', name: '灯塔' },
    { n: 15, g: '--99------99-2--9889----988923-9889----988933--99------99-2----999999999-23--9999999999933--9888888889-23--98898889899----98898889899-3--9888888889-33--98888088889-3--9888888889-33---988888889--3----9999999--3------99999--33-', name: '熊猫' },
    { n: 15, g: '---------777-----------77777---------777777--------7777777-------7777777-------7888777-------7798777--------7798777--------778877--------7778877--------77777777--------777777----------111------------11------------------------', name: '松鼠' },
    { n: 15, g: '--7--777--7------0--070--0------077777770-----077777777770---077777777770---072777777270---072777777270---077777777770----7777--7777-----7777--7777-----7777--7777-----7777555777-----7777--7777-----7777--7777-----3333--3333---', name: '城堡' },
    { n: 15, g: '---77----77------767----767-----767----767-----77777777777----77888888777----78898888987----78898888987----78888888887----78888008887----77888888777-----77888877--------777777---------77--77--------77----77-------------------', name: '小猫' },
    { n: 15, g: '---------333-----------3333----------33333---------333333--------3333333-------33933333------333333333-----3333333333----33333333333----3333233333333-333333333333333-0000000000000---333-333-333----33--33--33----77---77---77--', name: '恐龙' },
    { n: 15, g: '---77----77------7227---7227----7292---2927----7227---7227-----777---777------777777777777--778888888877---788888888887---788888888887---778888888877----777777777777---777---777-----44444---4444--4444444444444----------------', name: '猫头鹰' },
    { n: 15, g: '----------------------999----------955559--------0000000------00000000000---0000000000000-220000000000002-99---------99--99---------99-------------------------------555555555555555-5--5--5--5--5-555555555555555---------------', name: '小汽车' },
  ];
  // __PICROSS_LEVELS_END__

  /* ---------------- 网格编解码 ----------------
   * 每格一个字符：'-' 空位；'0'-'9' / 'a'-'z' = PALETTE 颜色序号。
   * cells 数组语义：-1 未知（运行时）/ -2 确定空 / >=0 已填某色。 */

  function decodeGrid(str) {
    var out = new Array(str.length);
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      out[i] = (ch === '-') ? -2 : parseInt(ch, 36);
    }
    return out;
  }

  function encodeGrid(cells) {
    var out = '';
    for (var i = 0; i < cells.length; i++) {
      var v = cells[i];
      out += (v < 0) ? '-' : v.toString(36);
    }
    return out;
  }

  /** 该关用到哪些颜色（升序序号） */
  function colorsOf(cells) {
    var seen = {}, out = [];
    for (var i = 0; i < cells.length; i++) {
      var v = cells[i];
      if (v >= 0 && !seen[v]) { seen[v] = 1; out.push(v); }
    }
    return out.sort(function (a, b) { return a - b; });
  }

  /* ---------------- 线索生成 ----------------
   * 彩色数织规则：连续同色算一段；异色或空位都算分隔。
   * 一行 [红,红,蓝,红] → [[0,2],[5,1],[0,1]]；全空行 → []（显示为 0）。 */

  function cluesForLine(line) {
    var out = [], i = 0, n = line.length;
    while (i < n) {
      var v = line[i];
      if (v < 0) { i++; continue; }
      var j = i;
      while (j < n && line[j] === v) { j++; }
      out.push([v, j - i]);
      i = j;
    }
    return out;
  }

  function cluesFor(cells, n) {
    var rows = [], cols = [], r, c;
    for (r = 0; r < n; r++) {
      var line = [];
      for (c = 0; c < n; c++) { line.push(cells[r * n + c]); }
      rows.push(cluesForLine(line));
    }
    for (c = 0; c < n; c++) {
      var col = [];
      for (r = 0; r < n; r++) { col.push(cells[r * n + c]); }
      cols.push(cluesForLine(col));
    }
    return { rows: rows, cols: cols };
  }

  /* ---------------- 唯一解求解器 ----------------
   * 口径与「玩家能看到的信息」严格一致：只有行/列线索，
   * 不偷看解（除了最后判定"是不是唯一"）。流程：
   *   1. 逐行/列枚举所有合法填法（lineOptions），把所有填法都一致的位置定下来；
   *   2. 仍有未定格就分支（候选值 = 空 或 该行该列线索里出现过的颜色）；
   *   3. 数到 cap 个解就停（cap=2 判唯一解够用）。
   * 节点超过 SOLVE_NODE_CAP 返回 -1（"算不动"）—— 调用方按"不唯一/不可判定"处理，
   * 宁可错杀也不放过，避免把多解题放进出题库。 */

  var SOLVE_NODE_CAP = 200000;

  /**
   * 单行/列的所有合法填法。
   * @param line  状态数组：-2 确定空 / -1 未知 / >=0 已填某色
   * @param clue  [[colorIdx, len], ...]
   * @returns 所有合法赋值（每项长度 = line.length，取值为 -2 或颜色序号）
   */
  function lineOptions(line, clue) {
    var n = line.length, out = [];
    if (!clue.length) {
      for (var i = 0; i < n; i++) { if (line[i] >= 0) { return out; } }
      var all = [];
      for (i = 0; i < n; i++) { all.push(-2); }
      out.push(all);
      return out;
    }
    var acc = new Array(n);
    function place(pos, ci) {
      if (ci === clue.length) {
        for (var k = pos; k < n; k++) {
          if (line[k] >= 0) { return; }        // 已填色不能当空
          acc[k] = -2;
        }
        out.push(acc.slice());
        return;
      }
      var c = clue[ci][0], len = clue[ci][1], p, k, ok;
      for (p = pos; p + len <= n; p++) {
        // 前缀 [pos, p) 必须可空；出现已填色 → 再往右前缀更长，直接没戏
        ok = true;
        for (k = pos; k < p; k++) {
          if (line[k] >= 0) { ok = false; break; }
          acc[k] = -2;
        }
        if (!ok) { break; }
        // [p, p+len) 必须全是未知或同色；撞到异色可以整体右移绕开 → continue
        for (k = p; k < p + len; k++) {
          if (line[k] !== -1 && line[k] !== c) { ok = false; break; }
        }
        if (!ok) { continue; }
        // 右界不能紧贴同色（否则两段会连成一格，与线索段数矛盾）
        if (p + len < n && line[p + len] === c) { continue; }
        for (k = p; k < p + len; k++) { acc[k] = c; }
        place(p + len, ci + 1);
      }
    }
    place(0, 0);
    return out;
  }

  /**
   * 数解的个数（数到 cap 即停）。
   * @param cells 初始状态（通常全 -1 未知）；函数内部会复制，不改入参
   * @returns 解的个数；-1 表示节点超限、算不动
   */
  function solveCount(cells, n, rowC, colC, cap) {
    var st = cells.slice();
    var nodes = 0;

    function prop() {
      var changed = true, r, c, k, o;
      while (changed) {
        changed = false;
        for (r = 0; r < n; r++) {
          var line = [];
          for (c = 0; c < n; c++) { line.push(st[r * n + c]); }
          var opts = lineOptions(line, rowC[r]);
          if (!opts.length) { return false; }
          for (k = 0; k < n; k++) {
            var v = opts[0][k], same = true;
            for (o = 1; o < opts.length; o++) {
              if (opts[o][k] !== v) { same = false; break; }
            }
            if (same && st[r * n + k] !== v) { st[r * n + k] = v; changed = true; }
          }
        }
        for (c = 0; c < n; c++) {
          var col = [];
          for (r = 0; r < n; r++) { col.push(st[r * n + c]); }
          var copts = lineOptions(col, colC[c]);
          if (!copts.length) { return false; }
          for (k = 0; k < n; k++) {
            var cv = copts[0][k], csame = true;
            for (o = 1; o < copts.length; o++) {
              if (copts[o][k] !== cv) { csame = false; break; }
            }
            if (csame && st[k * n + c] !== cv) { st[k * n + c] = cv; changed = true; }
          }
        }
      }
      return true;
    }

    function rec() {
      if (++nodes > SOLVE_NODE_CAP) { throw 'cap'; }
      if (!prop()) { return 0; }
      var idx = -1, i;
      for (i = 0; i < st.length; i++) { if (st[i] === -1) { idx = i; break; } }
      if (idx < 0) { return 1; }
      var r = (idx / n) | 0, c = idx % n;
      // 候选值：空，或出现在该行/该列线索里的颜色（别的颜色不可能出现在这格）
      var cand = [-2], seen = { '-2': 1 }, cl;
      for (i = 0; i < rowC[r].length; i++) {
        cl = rowC[r][i][0];
        if (!seen['c' + cl]) { seen['c' + cl] = 1; cand.push(cl); }
      }
      for (i = 0; i < colC[c].length; i++) {
        cl = colC[c][i][0];
        if (!seen['c' + cl]) { seen['c' + cl] = 1; cand.push(cl); }
      }
      var total = 0;
      for (i = 0; i < cand.length; i++) {
        var saved = st.slice();
        st[idx] = cand[i];
        total += rec();
        st = saved;
        if (total >= cap) { return total; }
      }
      return total;
    }

    try { return rec(); }
    catch (e) { if (e === 'cap') { return -1; } throw e; }
  }

  /** 关卡是否唯一解（入参可以是 LEVELS 项或 {n, cells}） */
  function isUnique(lv) {
    var cells = lv.cells || decodeGrid(lv.g);
    var n = lv.n;
    var cl = cluesFor(cells, n);
    return solveCount(cells.map(function () { return -1; }), n, cl.rows, cl.cols, 2) === 1;
  }

  /* ---------------- 星级 ----------------
   * 用时阈值：随档递增、同档内不放严。场景与测试都从这里取，避免两处各说各话。 */

  var STAR_MS = [
    { t3: 90000,  t2: 195000 },   // 入门 5×5
    { t3: 240000, t2: 420000 },   // 进阶 10×10
    { t3: 360000, t2: 620000 },   // 困难 12×12
    { t3: 540000, t2: 900000 }    // 专家 15×15
  ];

  function thresholdsFor(tier) {
    var s = STAR_MS[Math.max(0, Math.min(STAR_MS.length - 1, tier))];
    return [s.t3, s.t2];
  }

  function starsFor(tier, ms) {
    var s = STAR_MS[Math.max(0, Math.min(STAR_MS.length - 1, tier))];
    if (ms <= s.t3) { return 3; }
    if (ms <= s.t2) { return 2; }
    return 1;
  }

  /* ---------------- 档位 / 取关 ---------------- */

  function tierLevels(name) {
    var idx = TIER_NAMES.indexOf(name);
    if (idx < 0) { return []; }
    var out = [];
    for (var i = 1; i <= TIER_COUNT; i++) { out.push(idx * TIER_COUNT + i); }
    return out;
  }

  function firstLevelOfSize(name) {
    var lv = tierLevels(name);
    return lv.length ? lv[0] : 1;
  }

  /** 某关实际用了几个颜色（给档卡副标题用） */
  function colorsUsed(n) {
    var lv = LEVELS[n - 1];
    return lv ? colorsOf(decodeGrid(lv.g)).length : 0;
  }

  /** 档位副标题：尺寸 + 该档最大色数 + 关卡范围 */
  function tierPlanText(idx) {
    var lv = tierLevels(TIER_NAMES[idx]);
    var mx = 0;
    for (var i = 0; i < lv.length; i++) { mx = Math.max(mx, colorsUsed(lv[i])); }
    return TIER_SIZE[idx] + '×' + TIER_SIZE[idx] + ' · 最多 ' + mx + ' 色';
  }

  function build(n) {
    var lv = LEVELS[n - 1];
    if (!lv) { throw new Error('数织关卡不存在: ' + n); }
    var t = tierOf(n);
    return {
      id: 'picross',
      level: n,
      tier: t,
      tierName: TIER_NAMES[t],
      n: lv.n,
      name: lv.name || '',
      cells: decodeGrid(lv.g),
      daily: false
    };
  }

  function buildDaily() {
    var seed = U.seedFromDate(new Date());
    var t = DAILY_TIER;
    var lv = tierLevels(TIER_NAMES[t]);
    var n = lv[seed % lv.length];       // 每天从该档里按日期挑一关
    var p = build(n);
    p.level = 0;
    p.daily = true;
    return p;
  }

  /* ---------------- 注册 ---------------- */

  var games = BF.games || (BF.games = {});
  games.picross = {
    id: 'picross',
    title: '数织',
    // 「玩法说明」弹框（BF.RuleTip）：每次进这款游戏的第一个关卡时弹一次，
    // 玩家勾选「不再提示」后写入 Save.extra(id,'noRule')，之后不再弹。
    rules: {
      sub: '4 档 × 10 关 · 5×5 ~ 15×15',
      lines: [
        '行 / 列提示是带色块的数字串',
        '连续同色算一段，异色或空位分隔',
        '解开是一张彩色像素画',
        '填色格全部填对即通关',
      ],
      // 规则弹框顶部的「动画演示」：一段会自己解题的迷你彩色数织。
      // 顶部一颗黄点 + 红心，演示「第 2 列线索是 1黄 + 4红」的带色块数字串。
      demo: {
        colors: ['#E5484D', '#F5A623'],   // 0=红 1=黄（与 BF.theme 红 / 琥珀一致）
        grid: [
          [-1, -1,  1, -1, -1],
          [ 0,  0,  0,  0,  0],
          [ 0,  0,  0,  0,  0],
          [-1,  0,  0,  0, -1],
          [-1, -1,  0, -1, -1]
        ]
      }
    },
    sub: '看行数列线索，填出彩色像素画',
    skin: 'picross',
    scene: 'picross',
    TOTAL: TOTAL,
    difficulties: TIER_NAMES,
    tierLevels: tierLevels,
    firstLevelOfSize: firstLevelOfSize,
    chipLabel: function (name) {
      var idx = TIER_NAMES.indexOf(name);
      return idx < 0 ? name : (name + ' · ' + TIER_SIZE[idx] + '×' + TIER_SIZE[idx]);
    },
    // 难度自选首屏（BF.DiffPick）档卡副标题：尺寸 + 色数 + 关卡范围
    pickInfo: function (idx, rg) {
      return { meta: tierPlanText(idx) + ' · 第 ' + rg.first + '-' + rg.last + ' 关' };
    },
    build: function (n) { return build(n); },
    buildDaily: buildDaily
  };

  BF.PicrossGen = {
    PALETTE: PALETTE,
    PALETTE_HEX: PALETTE_HEX,
    PALETTE_NAME: PALETTE_NAME,
    TIER_NAMES: TIER_NAMES,
    TIER_SIZE: TIER_SIZE,
    TIER_COLORS: TIER_COLORS,
    TIER_COUNT: TIER_COUNT,
    TOTAL: TOTAL,
    DAILY_TIER: DAILY_TIER,
    LEVELS: LEVELS,
    STAR_MS: STAR_MS,
    tierOf: tierOf,
    decodeGrid: decodeGrid,
    encodeGrid: encodeGrid,
    colorsOf: colorsOf,
    cluesForLine: cluesForLine,
    cluesFor: cluesFor,
    lineOptions: lineOptions,
    solveCount: solveCount,
    isUnique: isUnique,
    starsFor: starsFor,
    thresholdsFor: thresholdsFor,
    tierLevels: tierLevels,
    firstLevelOfSize: firstLevelOfSize,
    colorsUsed: colorsUsed,
    tierPlanText: tierPlanText,
    build: build,
    buildDaily: buildDaily
  };
})();
