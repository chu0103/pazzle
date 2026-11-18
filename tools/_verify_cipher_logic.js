/**
 * 用"假 canvas + 假平台"把密码推理场景真实跑起来，验证**交互逻辑**（不是像素）：
 *   选色 → 拼行 → 提交 → 反馈 → 破译成功/失败；以及撤销、清空、取下一格、重复色禁止、
 *   几何不溢出、两种提示模式渲染不抛错、动态星级阈值随关卡单调。
 * 另用一个"反馈驱动的候选集消解求解器"证明**每关都能在 7 次机会内被破译**（关卡难度合理）。
 * 这样不用真机/浏览器也能确认状态机没写错（绘制部分委托给 D.*，与已验证的场景同源）。
 */
(function () {
  var path = require('path');
  var root = path.resolve(__dirname, '..');
  global.BF = {};
  require(path.join(root, 'js/core/ns.js'));

  // 假 draw / theme / platform / save（与 _verify_bottle_logic.js 同源）
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
  BF.platform = {
    width: 390, height: 844, safeTop: 44, safeBottom: 34, dpr: 2,
    now: function () { return 0; }, vibrate: function () {}, requestFrame: function () {},
    bindPointer: function () {}, createImage: function () {}, ctx: ctx
  };
  var store = {};
  BF.Save = {
    bucket: function (g) { return store[g] || (store[g] = { unlocked: 60, cleared: {}, stars: {} }); },
    clear: function (g, n, s) { var b = this.bucket(g); b.cleared[n] = s; b.stars[n] = s; if (!b.unlocked || b.unlocked < n) { b.unlocked = n; } },
    clearDaily: function () {}, resetAll: function () { store = {}; },
    unlockedOf: function () { return 60; }, clearedCount: function () { return 1; },
    totalStars: function () { return 3; }, starsOf: function () { return 3; },
    isCleared: function () { return false; }, countAll: function () { return 1; },
    starsAll: function () { return 3; }, data: { daily: {} }, load: function () {}, flush: function () {}
  };

  require(path.join(root, 'js/game/cipher.js'));
  require(path.join(root, 'js/scenes/cipher.js'));
  require(path.join(root, 'js/scenes/ruletip.js'));
  BF.RuleTip.on = false;   // harness 默认关掉规则弹框（enter 后输入会被拦走）

  var Gen = BF.CipherGen;
  var Scene = BF.SceneCipher;
  var app = { go: function () {} };
  var issues = [];
  var sampleLog = [];      // 每关"换题抽查"的实际用次（证明能解不是碰巧）

  /* ---- 命中盒工具 ---- */
  function palTap(sc, i) {
    var p = sc.palettes[i];
    sc.onDown(p.x + p.w / 2, p.y + p.h / 2);
    sc.onUp(p.x + p.w / 2, p.y + p.h / 2);
  }
  function cellTap(sc, row, i) {
    var c = sc.cellRect(row, i);
    sc.onDown(c.x + c.w / 2, c.y + c.h / 2);
    sc.onUp(c.x + c.w / 2, c.y + c.h / 2);
  }
  /** 用调色板把编辑行填满（按 usable 顺序） */
  function fillRow(sc) {
    sc.doAction('clear');
    for (var i = 0; i < sc.cfg.slots; i++) {
      palTap(sc, sc.usable.indexOf(sc.usable[i]));
    }
  }
  function fitIn(sc) {
    var W = BF.platform.width, H = BF.platform.height, i;
    // 头部/返回
    if (sc.back.x < 0 || sc.back.y < 0 || sc.back.x + sc.back.w > W || sc.back.y + sc.back.h > H) { return false; }
    // 每个调色板色块
    for (i = 0; i < sc.palettes.length; i++) {
      var p = sc.palettes[i];
      if (p.x < -0.5 || p.y < -0.5 || p.x + p.w > W + 0.5 || p.y + p.h > H + 0.5) { return false; }
    }
    // 每一行每一格（含反馈区）
    for (var r = 0; r < sc.cfg.tries; r++) {
      var rb = sc.fbRect(r);
      if (rb.w > 0 && rb.x + rb.w > W + 0.5) { return false; }
      for (i = 0; i < sc.cfg.slots; i++) {
        var c = sc.cellRect(r, i);
        if (c.x < -0.5 || c.y < -0.5 || c.x + c.w > W + 0.5 || c.y + c.h > H + 0.5) { return false; }
      }
    }
    // 编辑行底纹：只罩格子列（rowW），不能把右侧反馈区（fbW）也圈进去 ——
    // 编辑行不画圆点，带上 fbW 会往右凸出一块空白（用户截图反馈过）
    var pad = Math.max(4, sc.slot * 0.14);
    if (sc.slotX0 - pad < -0.5) { return false; }
    if (sc.slotX0 + sc.rowW + pad > W + 0.5) { return false; }
    return true;
  }

  /* ---- 反馈驱动的候选集消解求解器：找"能在 tries 次内解出"的猜测序列 ---- */
  function permutations(arr, k) {
    var out = [];
    var used = new Array(arr.length).fill(false);
    var cur = [];
    (function rec() {
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (var i = 0; i < arr.length; i++) {
        if (used[i]) { continue; }
        used[i] = true; cur.push(arr[i]);
        rec();
        cur.pop(); used[i] = false;
      }
    })();
    return out;
  }
  /**
   * 求解器只能看到**本关实际给出的那些信息**——这一点是难度结论成立的前提，
   * 所以比较键必须严格按 hint 走，绝不能一律用聚合计数、也不能一律用逐格：
   *   'line' / 'dot' 关 → 逐格提示：每格都给全 2/1/0（绿/白/黑）
   *   'agg' 关          → 数量提示：只看到"几个位置对 / 几个换位 / 几个排除"，**不说是哪一格**
   * 用同一份 lineHint()/feedback()（数据层函数），保证"玩家看到的"与"求解器看到的"是同一份。
   */
  function infoKey(g, code, cfg) {
    if (cfg.hint === 'agg') {
      var fb = Gen.feedback(g, code);
      return fb.exact + '/' + fb.color + '/' + fb.miss;
    }
    return Gen.lineHint(g, code).join(',');
  }

  /**
   * 在候选集里挑下一步猜什么：
   *   |S| ≤ 600  → 真极大极小（每个候选都算一遍"反馈分布的最坏桶"）
   *   |S| 更大   → 用固定种子的 rng 抽 40 个候选评分（**不能等距抽样**：S 是字典序子序列，
   *                等距取到的永远是"最靠前"那批，偏置极大，实测会让尾关多花 1~2 次机会）
   * 大候选集（十几万）做全量极大极小是 O(|S|²) 会跑到天亮，抽样是关键。
   */
  function bestGuess(S, cfg, rng) {
    var idxs = [], i;
    if (S.length <= 600) { for (i = 0; i < S.length; i++) { idxs.push(i); } }
    else { for (i = 0; i < 40; i++) { idxs.push(Math.floor(rng() * S.length)); } }
    var best = null, bestWorst = Infinity;
    for (var x = 0; x < idxs.length; x++) {
      var g = S[idxs[x]], buckets = {}, b, kk, worst = 0;
      for (b = 0; b < S.length; b++) {
        var key = infoKey(g, S[b], cfg);
        buckets[key] = (buckets[key] || 0) + 1;
      }
      for (kk in buckets) { if (buckets[kk] > worst) { worst = buckets[kk]; } }
      if (worst < bestWorst) { bestWorst = worst; best = g; }
    }
    return best;
  }

  /** 在一个候选空间里解一道具体的题：返回用了几次猜中；超过次数或异常返回 -1 */
  function solveWith(cfg, space, code, seed) {
    var cands = space;
    var rng = BF.util.mulberry32(seed || 20261010);
    var used = 0;
    while (used < cfg.tries) {
      used++;
      var guess;
      if (cands.length === 1) { guess = cands[0].slice(); }
      else { guess = bestGuess(cands, cfg, rng).slice(); }
      if (Gen.feedback(guess, code).exact === cfg.slots) { return used; }
      var realKey = infoKey(guess, code, cfg);
      var next = [];
      for (var c = 0; c < cands.length; c++) {
        if (infoKey(guess, cands[c], cfg) === realKey) { next.push(cands[c]); }
      }
      cands = next;
      if (!cands.length) { return -1; }
    }
    return -1;
  }

  /** 解本关那道题（题目与玩家看到的完全一致） */
  function solve(level) {
    var pz = Gen.build(level);
    return solveWith(Gen.configOf(level), permutations(pz.usable, pz.slots), pz.code, 20261010 + level);
  }

  /**
   * 换一批题目再解几遍，确认"能解出来"不是因为恰好抽到一道容易的题。
   * 候选空间越大跑得越慢，所以按空间大小自动降采样次数。
   */
  function sampleStats(level) {
    var cfg = Gen.configOf(level);
    var pool = [], i;
    for (i = 0; i < cfg.colors; i++) { pool.push(i); }       // 固定色池，候选空间可复用
    var space = permutations(pool, cfg.slots);
    var trials = space.length > 100000 ? 4 : (space.length > 10000 ? 6 : 20);
    var rng = BF.util.mulberry32(4242 + level * 7919);
    var got = [], worst = 0, bad = 0;
    for (i = 0; i < trials; i++) {
      var code = space[Math.floor(rng() * space.length)].slice();
      var k = solveWith(cfg, space, code, 20261010 + level * 31 + i);
      got.push(k);
      if (k < 0) { bad++; }
      else if (k > worst) { worst = k; }
    }
    return { got: got, trials: trials, worst: worst, bad: bad };
  }

  /* ---- 1) 全 10 关：几何不溢出 + render 不抛 + 求解器能在 tries 次内解出 ---- */
  var solveLog = [];
  for (var n = 1; n <= Gen.TOTAL; n++) {
    var sc = new Scene(app);
    sc.enter({ level: n, game: 'cipher' });
    if (!fitIn(sc)) { issues.push('L' + n + ' 元素超出屏幕'); }
    try { sc.render(ctx); } catch (e) { issues.push('L' + n + ' render 抛错: ' + e.message); }

    var st = solve(n);
    solveLog.push('L' + n + ': ' + (st > 0 ? st + '次' : '未能在' + sc.cfg.tries + '次内解出'));
    if (st < 0) { issues.push('L' + n + ' 求解器未能在 ' + sc.cfg.tries + ' 次机会内破译（难度可能过高）'); }

    // 换题抽查：任何一题都必须能在 tries 次内解出
    var sm = sampleStats(n);
    if (sm.bad > 0) {
      issues.push('L' + n + ' 换 ' + sm.trials + ' 道题抽查时，有 ' + sm.bad + ' 道没能在 ' +
        sc.cfg.tries + ' 次内解出（关卡偏难，别只靠这一道题通过）');
    }
    sampleLog.push('L' + n + ':' + sm.got.join('/') + '（' + sm.trials + ' 题）');
  }

  /* ---- 2) 提交正确密码 → 过关、星级 1~3、result.win ---- */
  for (n = 1; n <= Gen.TOTAL; n++) {
    var sc2 = new Scene(app);
    sc2.enter({ level: n, game: 'cipher' });
    sc2.edit = sc2.code.slice();
    sc2.submit();
    if (!sc2.result || !sc2.result.win) { issues.push('L' + n + ' 提交正确密码未过关'); }
    else if (sc2.result.stars < 1 || sc2.result.stars > 3) { issues.push('L' + n + ' 星级非法'); }
    // 结算态 render 不抛
    try { sc2.render(ctx); } catch (e) { issues.push('L' + n + ' 结算态 render 抛错: ' + e.message); }
  }

  /* ---- 3) 重复色禁止：同一行不能放同一个颜色两次 ---- */
  var sc3 = new Scene(app); sc3.enter({ level: 1, game: 'cipher' });
  sc3.doAction('clear');
  palTap(sc3, 0);
  var lenAfterFirst = sc3.edit.filter(function (v) { return v >= 0; }).length;
  palTap(sc3, 0);   // 再点同一色 → 应被拒
  var lenAfterSecond = sc3.edit.filter(function (v) { return v >= 0; }).length;
  if (lenAfterSecond !== lenAfterFirst) { issues.push('同一行不该允许重复颜色'); }
  if (!sc3.toast) { issues.push('重复颜色应给出提示'); }

  /* ---- 4) 撤销 / 清空 / 取下一格 ---- */
  var sc4 = new Scene(app); sc4.enter({ level: 2, game: 'cipher' });
  sc4.doAction('clear');
  palTap(sc4, 0); palTap(sc4, 1); palTap(sc4, 2);
  if (sc4.edit.filter(function (v) { return v >= 0; }).length !== 3) { issues.push('连放三色应填三格'); }
  sc4.doAction('undo');
  if (sc4.edit.filter(function (v) { return v >= 0; }).length !== 2) { issues.push('撤销应去掉最后一格'); }
  sc4.doAction('clear');
  if (sc4.edit.filter(function (v) { return v >= 0; }).length !== 0) { issues.push('清空应清掉整行'); }
  // 取下中间一格 → 原地清空（后面的格子不再左移，位置由玩家自己指定）
  sc4.doAction('clear');
  palTap(sc4, 0); palTap(sc4, 1); palTap(sc4, 2);
  var c1 = sc4.edit[0], c3 = sc4.edit[2];
  cellTap(sc4, 0, 1);                                      // 第一次点 = 选中
  if (sc4.cellSel !== 1) { issues.push('点格子应选中它'); }
  if (sc4.edit.filter(function (v) { return v >= 0; }).length !== 3) { issues.push('选中格子不应改动已填内容'); }
  cellTap(sc4, 0, 1);                                      // 再点同一格 = 取下
  if (sc4.edit.filter(function (v) { return v >= 0; }).length !== 2) { issues.push('再点已填格应把它取下来'); }
  if (sc4.edit[1] !== -1) { issues.push('取下的格子应为空'); }
  if (sc4.edit[0] !== c1 || sc4.edit[2] !== c3) { issues.push('取下一格应原地清空，其余格子保持不动'); }

  /* ---- 4b) 任意指定位置：先点格子，再点颜色 ---- */
  var sc4b = new Scene(app); sc4b.enter({ level: 3, game: 'cipher' });
  sc4b.doAction('clear');
  cellTap(sc4b, 0, 2);                                     // 选中第 3 格（不是第 1 格）
  if (sc4b.cellSel !== 2) { issues.push('点第 3 格应选中第 3 格'); }
  palTap(sc4b, 0);
  if (sc4b.edit[0] !== -1) { issues.push('没选中的第 1 格不应被自动填上'); }
  if (sc4b.edit[2] < 0) { issues.push('颜色应填进被选中的那一格'); }
  cellTap(sc4b, 0, 2);                                     // 重新选中已填的格子
  if (sc4b.cellSel !== 2) { issues.push('应能重新选中已填的格子'); }
  palTap(sc4b, 1);                                         // 换个颜色 → 原地替换，不算重复
  if (sc4b.edit[2] !== sc4b.usable[1]) { issues.push('选中格已有颜色时应被替换掉'); }
  if (sc4b.edit.filter(function (v) { return v >= 0; }).length !== 1) { issues.push('替换不应多出一格'); }
  // 没选中时保持老手感：落到第一个空位，且连点颜色会自动顺推
  sc4b.doAction('clear');
  palTap(sc4b, 2);
  if (sc4b.edit[0] !== sc4b.usable[2]) { issues.push('未选格子时颜色应落到第一个空位'); }
  palTap(sc4b, 3);
  if (sc4b.edit[1] !== sc4b.usable[3]) { issues.push('连点颜色应自动顺推到下一个空位'); }
  // 任意跳位填 + 选中态渲染不抛错
  cellTap(sc4b, 0, 3);
  palTap(sc4b, 4);
  if (sc4b.edit[3] !== sc4b.usable[4]) { issues.push('跳到最后一格填色应生效'); }
  try { sc4b.render(ctx); } catch (e) { issues.push('选中态 render 抛错: ' + e.message); }

  /* ---- 5) 未填满提交 → 拒绝、不产生新行 ---- */
  var sc5 = new Scene(app); sc5.enter({ level: 1, game: 'cipher' });
  sc5.doAction('clear');
  palTap(sc5, 0);                       // 只填一格
  var rowsBefore = sc5.rows.length;
  sc5.submit();
  if (sc5.rows.length !== rowsBefore) { issues.push('未填满不应提交成功'); }
  if (!sc5.toast) { issues.push('未填满提交应提示'); }

  /* ---- 6) 失败路径：连续提交错误猜测直到机会用完 → result.win === false、密码揭示 ---- */
  var sc6 = new Scene(app); sc6.enter({ level: 1, game: 'cipher' });
  // 构造一个"永远不含密码任何色"的猜测（用不在 usable 里的颜色下标），保证不会误中
  var badColor = -1;
  for (var ci = 0; ci < Gen.palette.length; ci++) { if (sc6.usable.indexOf(ci) < 0) { badColor = ci; break; } }
  if (badColor < 0) { issues.push('L1 可用色占满了调色板，构造失败用例失败'); }
  else {
    for (var tt = 0; tt < sc6.cfg.tries; tt++) {
      sc6.edit = new Array(sc6.cfg.slots).fill(badColor);
      // 注意：同色重复会被 feedback 正常处理（此处只关心"不可能猜中"，不关心合法性校验）
      sc6.submit();
      if (sc6.result) { break; }
    }
    if (!sc6.result) { issues.push('机会用完却没有触发结算'); }
    else if (sc6.result.win) { issues.push('全错猜测却判胜'); }
    try { sc6.render(ctx); } catch (e) { issues.push('失败结算态 render 抛错: ' + e.message); }
  }

  /* ---- 7b. 图例说明：点按弹 / 长按弹 / 再点收起 / 点气泡收起 / 到点自动收起 ---- */
  var sc7 = new Scene(app); sc7.enter({ level: 1, game: 'cipher' });
  sc7.render(ctx);                       // 先渲染一次，图例命中盒才回填
  if (sc7.legendRects.length !== 3) { issues.push('图例应有 3 个命中盒，实际 ' + sc7.legendRects.length); }
  for (var li = 0; li < sc7.legendRects.length; li++) {
    var lr = sc7.legendRects[li];
    if (lr.x < 0 || lr.x + lr.w > BF.platform.width + 0.5) { issues.push('图例第 ' + li + ' 项横向溢出'); }
    if (lr.h < 24) { issues.push('图例第 ' + li + ' 项命中盒太矮(' + lr.h + ')，不好按'); }
  }
  // 三项互不重叠
  for (li = 0; li + 1 < sc7.legendRects.length; li++) {
    var a = sc7.legendRects[li], b = sc7.legendRects[li + 1];
    if (a.x + a.w > b.x + 0.5) { issues.push('图例第 ' + li + ' 项与下一项重叠'); }
  }

  function legendTap(sc, i) {
    var r = sc.legendRects[i];
    sc.onDown(r.x + r.w / 2, r.y + r.h / 2);
    sc.onUp(r.x + r.w / 2, r.y + r.h / 2);
  }
  /** 按住不动并推进若干帧（模拟长按） */
  function legendHold(sc, i, ms) {
    var r = sc.legendRects[i];
    sc.onDown(r.x + r.w / 2, r.y + r.h / 2);
    for (var acc = 0; acc < ms; acc += 16) { sc.update(16); }
  }

  // 点按 → 弹出对应档位的说明
  legendTap(sc7, 0);
  if (!sc7.help || sc7.help.kind !== sc7.legendRects[0].kind) { issues.push('点按图例没有弹出说明'); }
  try { sc7.render(ctx); } catch (e) { issues.push('说明气泡 render 抛错: ' + e.message); }
  if (!sc7.helpRect || sc7.helpRect.w <= 0 || sc7.helpRect.h <= 0) { issues.push('说明气泡没有有效矩形'); }
  if (sc7.helpRect.y < 0) { issues.push('说明气泡顶部溢出屏幕'); }
  if (sc7.helpRect.x < 0 || sc7.helpRect.x + sc7.helpRect.w > BF.platform.width + 0.5) {
    issues.push('说明气泡横向溢出屏幕');
  }
  // 再点同一项 → 收起
  legendTap(sc7, 0);
  if (sc7.help) { issues.push('再点同一项应收起说明'); }
  // 点另一项 → 换成那一项（而不是关掉）
  legendTap(sc7, 1);
  if (!sc7.help || sc7.help.kind !== sc7.legendRects[1].kind) { issues.push('点另一项应换内容'); }
  // 气泡矩形要量字宽，只在渲染时回填 —— 真机每帧都渲染，这里显式跑一帧
  sc7.render(ctx);
  if (!sc7.helpRect || sc7.helpRect.w <= 0 || sc7.helpRect.h <= 0) { issues.push('换项后说明气泡矩形无效'); }
  // 点气泡任意处 → 收起
  var hr = sc7.helpRect;
  sc7.onDown(hr.x + hr.w / 2, hr.y + hr.h / 2);
  sc7.onUp(hr.x + hr.w / 2, hr.y + hr.h / 2);
  if (sc7.help) { issues.push('点说明气泡应收起'); }
  // 长按（按住 600ms）→ 不必抬手就弹出
  legendHold(sc7, 2, 600);
  if (!sc7.help || sc7.help.kind !== sc7.legendRects[2].kind) { issues.push('长按图例没有弹出说明'); }
  // 长按已触发后再抬手，不应把刚弹出的说明又关掉
  var lr2 = sc7.legendRects[2];
  sc7.onUp(lr2.x + lr2.w / 2, lr2.y + lr2.h / 2);
  if (!sc7.help) { issues.push('长按后抬手不应把说明关掉'); }
  // 到点自动收起
  var sc7b = new Scene(app); sc7b.enter({ level: 4, game: 'cipher' });
  sc7b.render(ctx);
  legendTap(sc7b, 0);
  if (!sc7b.help) { issues.push('圆点提示关卡点按图例也应弹说明'); }
  for (var acc7 = 0; acc7 < 5000; acc7 += 16) { sc7b.update(16); }
  if (sc7b.help) { issues.push('说明气泡没有在超时后自动收起'); }
  // 图例弹出时 render 不抛、且不改动棋盘状态
  var sc7c = new Scene(app); sc7c.enter({ level: 5, game: 'cipher' });
  sc7c.render(ctx);
  var rows7 = sc7c.rows.length, edit7 = sc7c.edit.join(',');
  // 图例恒为三档（位置对/换位/排除）——按实际项数点，别写死
  for (var li7 = 0; li7 < sc7c.legendRects.length; li7++) { legendTap(sc7c, li7); }
  if (sc7c.legendRects.length !== 3) {
    issues.push('图例应有"位置对/换位/排除"三项，实际 ' + sc7c.legendRects.length);
  }
  if (sc7c.rows.length !== rows7 || sc7c.edit.join(',') !== edit7) {
    issues.push('查看图例说明不应改动棋盘/编辑行');
  }
  // 数量提示关（'agg'）图例同样是"位置对/换位/排除"三档（它给的是三者的**个数**），
  // 点按要能弹出说明（说明里会指出"反馈在右侧、只给个数"）
  var sc7d = new Scene(app); sc7d.enter({ level: Gen.TOTAL, game: 'cipher' });
  sc7d.render(ctx);
  if (sc7d.cfg.hint !== 'agg') { issues.push('最后一关应是数量提示关'); }
  if (sc7d.legendRects.length !== 3) {
    issues.push('数量提示关图例应有 3 项，实际 ' + sc7d.legendRects.length);
  } else {
    var wantKind = [2, 1, 0];
    for (var li7d = 0; li7d < 3; li7d++) {
      if (sc7d.legendRects[li7d].kind !== wantKind[li7d]) {
        issues.push('数量提示关图例第 ' + (li7d + 1) + ' 项应是 ' + wantKind[li7d]);
      }
    }
  }
  legendTap(sc7d, 0);
  if (!sc7d.help) { issues.push('数量提示关点按图例应弹说明'); }
  sc7d.render(ctx);
  if (!sc7d.helpRect || sc7d.helpRect.h <= 0 || sc7d.helpRect.y < 0) {
    issues.push('数量提示关说明气泡无效或溢出顶部');
  }

  /* ---- 7) 动态星级阈值：随关卡单调不放严，且 3★ 线 ≥1、2★ > 3★ ---- */
  var prev3 = 0, prev2 = 0, seq = [];
  for (n = 1; n <= Gen.TOTAL; n++) {
    var th = Gen.thresholdsFor(n);
    if (th.three < 1) { issues.push('L' + n + ' 3★ 线应 ≥1'); }
    if (th.two <= th.three) { issues.push('L' + n + ' 2★ 线应 > 3★ 线'); }
    if (th.three < prev3 || th.two < prev2) { issues.push('L' + n + ' 星级线应随关卡单调不放严'); }
    prev3 = th.three; prev2 = th.two;
    seq.push('L' + n + ':' + th.three + '/' + th.two);
  }

  /* ---- 8) 反馈画在哪里，按提示模式分流：
        'line' / 'dot' → **每格正下方**（格子列在整屏居中），每格都必须有标记（含 exact 关的灰虚位）；
        'agg'          → **行右侧**的数量点阵（格子列左移让位），点阵恰好 slots 个点、全落在反馈区内。---- */
  /**
   * 渲染一帧并统计"这一行的反馈标记"：
   *   逐格关 → drawDotUnder / drawLine 的调用次数（图例小样走的是 drawDot + D.fillRound，不会混进来）；
   *   agg 关 → drawDots 被调用几次 + 有几个点真的画在右侧反馈区里（靠坐标判定，不靠调用次数）。
   */
  function marksOf(scv) {
    var dotsUnder = 0, lines = 0, dotsCalls = 0, inFb = 0;
    var fb0 = scv.fbRect(0);
    var od = scv.drawDotUnder, ol = scv.drawLine, ods = scv.drawDots, oDot = scv.drawDot;
    scv.drawDotUnder = function () { dotsUnder++; return od.apply(this, arguments); };
    scv.drawLine = function () { lines++; return ol.apply(this, arguments); };
    scv.drawDots = function () { dotsCalls++; return ods.apply(this, arguments); };
    scv.drawDot = function (c, x, y, r, k) {
      if (x >= fb0.x - 0.5 && x <= fb0.x + fb0.w + 0.5 &&
          y >= fb0.y - 0.5 && y <= fb0.y + fb0.h + 0.5) { inFb++; }
      return oDot.apply(this, arguments);
    };
    var err = null;
    try { scv.render(ctx); } catch (e) { err = e; }
    return { dotsUnder: dotsUnder, lines: lines, dotsCalls: dotsCalls, inFb: inFb, err: err };
  }

  for (n = 1; n <= Gen.TOTAL; n++) {
    var sc8 = new Scene(app); sc8.enter({ level: n, game: 'cipher' });
    var agg8 = sc8.cfg.hint === 'agg';
    var W8 = BF.platform.width;
    var i8;

    // ---- 布局：谁占右侧反馈区、格子列该不该居中 ----
    if (agg8) {
      if (sc8.fbW <= 0) { issues.push('L' + n + ' 数量提示关应预留右侧反馈区'); }
      if (sc8.fbCols < 2) { issues.push('L' + n + ' 数量提示关点阵应至少 2 列'); }
      if (sc8.fbRect(0).w <= 0) { issues.push('L' + n + ' 数量提示关右侧反馈区宽度应为正'); }
      // 行整体（格子列 + 反馈区）居中；格子列本身随之左移，这是刻意的（右侧要放点阵）
      if (Math.abs(sc8.slotX0 - (W8 - (sc8.slotX0 + sc8.rowBlockW))) > 1) {
        issues.push('L' + n + ' 行（含右侧反馈区）未居中');
      }
      if (sc8.slotX0 >= W8 - (sc8.slotX0 + sc8.rowW) - 1) {
        issues.push('L' + n + ' 数量提示关的格子列应左移给反馈区让位');
      }
    } else {
      if (sc8.fbW !== 0) { issues.push('L' + n + ' 逐格提示关不该占右侧反馈区'); }
      if (sc8.fbRect(0).w > 0) { issues.push('L' + n + ' 逐格提示关右侧反馈区宽度应为 0'); }
      if (sc8.rowBlockW !== sc8.rowW) { issues.push('L' + n + ' 逐格提示关行宽应等于格子列宽（不含反馈区）'); }
      if (Math.abs(sc8.slotX0 - (W8 - (sc8.slotX0 + sc8.rowW))) > 1) {
        issues.push('L' + n + ' 格子列未居中（左右留白不等）');
      }
    }

    // ---- 反馈数据：逐格合法 + 聚合三项之和 = 位数 + 点阵数据与聚合反馈一致 ----
    fillRow(sc8);
    sc8.submit();
    var r0 = sc8.rows[0];
    if (!r0 || r0.line.length !== sc8.cfg.slots) { issues.push('L' + n + ' 提交行应逐格带反馈数据'); }
    else {
      for (i8 = 0; i8 < r0.line.length; i8++) {
        var kv = r0.line[i8];
        // 逐格提示三档全给：0=排除 / 1=换位 / 2=位置对，没有留空值
        if (kv !== 0 && kv !== 1 && kv !== 2) { issues.push('L' + n + ' 逐格反馈取值应为 0/1/2'); break; }
      }
    }
    if (!r0 || r0.fb.exact + r0.fb.color + r0.fb.miss !== sc8.cfg.slots) {
      issues.push('L' + n + ' 聚合反馈三项之和应等于位数');
    }
    var dots8 = Gen.aggDots(r0.fb), dc8 = [0, 0, 0];
    for (i8 = 0; i8 < dots8.length; i8++) { dc8[dots8[i8]]++; }
    if (dots8.length !== sc8.cfg.slots ||
        dc8[2] !== r0.fb.exact || dc8[1] !== r0.fb.color || dc8[0] !== r0.fb.miss) {
      issues.push('L' + n + ' 点阵数据与聚合反馈不一致（个数/顺序不符）');
    }

    // ---- 标记数：**每一格都必须有反馈**，绝不能留空 ----
    var rep8 = marksOf(sc8);
    if (rep8.err) { issues.push('L' + n + ' 反馈 render 抛错: ' + rep8.err.message); }
    if (agg8) {
      if (rep8.dotsCalls !== 1) {
        issues.push('L' + n + ' 数量提示关每条提交行应画一次点阵（实际 ' + rep8.dotsCalls + '）');
      }
      if (rep8.inFb !== sc8.cfg.slots) {
        issues.push('L' + n + ' 右侧点阵应有 ' + sc8.cfg.slots + ' 个点落在反馈区内（实际 ' + rep8.inFb + '）');
      }
    } else {
      if (rep8.dotsCalls !== 0) { issues.push('L' + n + ' 逐格提示关不该画右侧点阵'); }
      var marks8 = sc8.cfg.hint === 'dot' ? rep8.dotsUnder : rep8.lines;
      if (marks8 !== sc8.cfg.slots) {
        issues.push('L' + n + ' 提交行应逐格都有反馈标记，实际 ' + marks8 + '/' + sc8.cfg.slots);
      }
    }

    // ---- 极端情况：整行一个位置都没猜中，反馈同样不能留空 ----
    //（循环移位：密码颜色互异 ⇒ 每格都错。逐格关会画满黑标记，agg 关会画满白点）
    var sc8b = new Scene(app); sc8b.enter({ level: n, game: 'cipher' });
    sc8b.edit = sc8b.code.slice(1).concat(sc8b.code[0]);
    sc8b.submit();
    var repB = marksOf(sc8b);
    if (repB.err) { issues.push('L' + n + ' 全错行 render 抛错: ' + repB.err.message); }
    if (agg8) {
      if (repB.inFb !== sc8b.cfg.slots) {
        issues.push('L' + n + ' 没猜中时右侧点阵也必须是 ' + sc8b.cfg.slots + ' 个点（实际 ' + repB.inFb + '）');
      }
      // 颜色互异 ⇒ 颜色全在密码里，所以聚合反馈必然是"0 个位置对 + 全换位"，点阵该是 slots 个白点
      var fbB = sc8b.rows[0].fb;
      if (fbB.exact !== 0 || fbB.color !== sc8b.cfg.slots || fbB.miss !== 0) {
        issues.push('L' + n + ' 循环移位的猜测应得到 0 对位 / 全换位，实际 ' + JSON.stringify(fbB));
      }
    } else {
      var marksB = sc8b.cfg.hint === 'dot' ? repB.dotsUnder : repB.lines;
      if (marksB !== sc8b.cfg.slots) {
        issues.push('L' + n + ' 整行没猜中时反馈不能留空（应 ' + sc8b.cfg.slots + ' 个标记，实际 ' + marksB + '）');
      }
    }
  }

  if (issues.length) {
    console.error('❌ 密码推理交互逻辑问题 ' + issues.length + ' 条:');
    for (var i = 0; i < issues.length; i++) { console.error('  - ' + issues[i]); }
    process.exit(1);
  }
  console.log('✅ 密码推理 · 交互逻辑全过（选色/**任意点格选位**/跳位填/原地替换/拼行/提交/反馈/撤销/清空/取下(原地)/重复色禁止/过关/失败/图例点按·长按·收起（恒 3 项：位置对/换位/排除）/**反馈位置随提示模式分流：逐格下方（格子列居中）↔ 行右侧数量点阵（格子列左移）**/两种形状+数量点阵渲染 · 几何不溢出）');
  console.log('   求解器表现（严格按本关**玩家可见**的信息推理）: ' + solveLog.join('  '));
  console.log('   换题抽查（同一参数换几道题，验证能解不是碰巧）: ' + sampleLog.join('  '));
  console.log('   动态星级线 3★/2★（次）: ' + seq.join('  '));
})();
