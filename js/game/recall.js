/**
 * recall.js —— 「瞬时记忆」场景生成器 + 注册（游戏 17）
 *
 * 玩法（忠实还原参考视频「每日前额叶训练 · 短时记忆挑战」）：
 *   - 观察期：一张场景卡里自由散布 N 件物品，记住颜色 / 开合 / 票面文字 / 朝向 / 方位。
 *   - 答题期：图片收起，逐题问「刚才那张图的细节」，点 2~4 个选项作答。
 *   - 揭晓期：每题判完放大画出该物品特写 + 正确答案（还原视频的「特写揭晓」）。
 *   - 结算：全部答完过关；答错/超时扣心，3 心耗光本关重来。
 *
 * ⚠️ 设计要点（题目公平性的根基）：
 *   1) **每种 kind 一关最多出现 1 件** → 「雨伞是什么颜色」永远只有一个答案，
 *      不会出现「两把伞颜色不同」的歧义题；「有没有粉色马克杯」也能确定性判定。
 *   2) 物品位置取自 12 个固定格点（3 列 × 4 行）+ 微小抖动 → 两两不重叠、
 *      确定性可复现；色彩允许重复，让「数量题」答案落在 0~3 而非恒为 1。
 *   3) **所有题目答案由场景属性直接推导**，干扰项必须确实不成立；
 *      「笔尖指向」题由 rot + 角度差算出唯一目标，且要求与第二名角差 ≥ MIN_ANGLE_GAP，
 *      否则这关不出该题型（宁可少一种题，也不出有歧义的题）。
 *   4) 场景卡是**正方形**，归一化 [0,1]² 的角度 == 屏幕视觉角度，指向题才不会算歪。
 *
 * 难度轴（呼应用户「后段别靠压缩时间提难度」的反馈）：
 *   物品数 6→10、题数 3→5、题型逐档解锁、选项 3→4；
 *   观察 8.0→6.0s / 每题 6.0→5.0s 仅**缓降**（每关 100~140ms），不陡降。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.RecallGen) { return; }
  var U = BF.util;

  var TOTAL = 15;
  var REVEAL_MS = 1200;              // 每题揭晓停留（轻触可跳过）
  var MIN_ANGLE_GAP = 0.38;         // 指向题：笔尖方向与第二名物品的最小角差（弧度）

  /* ---------------- 属性表 ---------------- */

  // 10 种物品；stateful 能问开合，directional 能问笔尖指向，label 能问票面文字
  var KINDS = [
    { id: 'umbrella', name: '雨伞', recolorable: true },
    { id: 'mug',      name: '马克杯', recolorable: true },
    { id: 'earbuds',  name: '耳机盒', stateful: true },
    { id: 'wallet',   name: '皮夹',   stateful: true },
    { id: 'eraser',   name: '橡皮' },
    { id: 'pen',      name: '签字笔', directional: true, recolorable: true },
    { id: 'orange',   name: '橘子' },
    { id: 'ticket',   name: '车票',   label: true },
    { id: 'keys',     name: '钥匙串' },
    { id: 'glasses',  name: '眼镜' }
  ];

  // 可换色物品集合（只有这些才随机染色、才被颜色题考核，杜绝"粉色钥匙"类怪象）
  var REC_SET = { umbrella: 1, mug: 1, pen: 1 };
  // 中文色名 → 文件名英文码（assets/recall/<kind>_<code>.jpg）
  var COLOR_CODE = { '蓝色': 'blue', '红色': 'red', '绿色': 'green', '黄色': 'yellow', '紫色': 'purple', '橙色': 'orange' };
  // 非换色物品固定自然色（颜色题不考它们，但 exist/count 题会用 colorName）
  var NATURAL = {
    earbuds: { name: '白色', hex: '#EDEFF2' },
    wallet:  { name: '棕色', hex: '#8A5A2B' },
    eraser:  { name: '白色', hex: '#EDEFF2' },
    orange:  { name: '橙色', hex: '#E08A3C' },
    ticket:  { name: '白色', hex: '#EDEFF2' },
    keys:    { name: '银色', hex: '#C9CDD4' },
    glasses: { name: '黑色', hex: '#34383E' }
  };

  var COLORS = [
    { name: '蓝色', hex: '#4C8DFF' },
    { name: '红色', hex: '#FF5B5B' },
    { name: '绿色', hex: '#4E9C63' },
    { name: '黄色', hex: '#F2C13C' },
    { name: '紫色', hex: '#9775FA' },
    { name: '粉色', hex: '#F783AC' },
    { name: '橙色', hex: '#E08A3C' },
    { name: '黑色', hex: '#34383E' },
    { name: '白色', hex: '#EDEFF2' }
  ];
  // 仅给天生多彩的 3 种物品做 6 色变体（蓝红绿黄紫橙，去掉粉/黑/白）
  var REC_COLORS = [COLORS[0], COLORS[1], COLORS[2], COLORS[3], COLORS[4], COLORS[6]];

  var STATIONS = ['上海虹桥', '北京南站', '杭州东站', '南京南站',
                  '广州南站', '深圳北站', '成都东站', '武汉站'];
  var TRAINS = ['G1234', 'G1024', 'D2156', 'G7368', 'G88', 'K512'];
  var STATE_NAMES = { open: '打开', closed: '关闭' };

  // 12 个候选格点（3 列 × 4 行）。场景卡正方形 → x/y 同尺度。
  var GRID = [
    [0.20, 0.16], [0.50, 0.16], [0.80, 0.16],
    [0.20, 0.38], [0.50, 0.38], [0.80, 0.38],
    [0.20, 0.62], [0.50, 0.62], [0.80, 0.62],
    [0.20, 0.84], [0.50, 0.84], [0.80, 0.84]
  ];
  var JITTER = 0.022;               // 格点抖动上限（保证两两 ≥0.16 归一化距离）

  /* ---------------- 15 关难度表 ---------------- */

  var N_PER_LEVEL  = [6, 6, 7, 7, 7,   8, 8, 9, 9, 9,   10, 10, 10, 10, 10];
  var Q_PER_LEVEL  = [3, 3, 3, 3, 3,   4, 4, 4, 4, 4,   5, 5, 5, 5, 5];
  var OPT_PER_LEVEL = [3, 3, 3, 3, 3,  4, 4, 4, 4, 4,   4, 4, 4, 4, 4];
  // 观察 8.0→6.0s 缓降（前段每关 -140ms、后段 -150ms）
  var OBSERVE_MS  = [8000, 7860, 7720, 7580, 7440, 7300, 7160, 7020, 6880, 6740,
                     6600, 6450, 6300, 6150, 6000];
  // 每题作答 6.0→5.0s 缓降（前段每关 -60ms、后段 -80ms）
  var ANSWER_MS   = [6000, 5940, 5880, 5820, 5760, 5700, 5640, 5580, 5520, 5460,
                     5400, 5320, 5240, 5160, 5000];

  var TYPES_BY_TIER = [
    ['color', 'exist', 'state'],                                                  // 1-5  入门
    ['color', 'exist', 'state', 'label', 'count'],                                // 6-10 进阶
    ['color', 'exist', 'state', 'label', 'count', 'spatial', 'position']         // 11-15 困难
  ];

  function tierOf(level) { return level <= 5 ? 0 : (level <= 10 ? 1 : 2); }

  function paramsForLevel(level) {
    var i = U.clamp(level - 1, 0, TOTAL - 1);
    return {
      N: N_PER_LEVEL[i],
      M: Q_PER_LEVEL[i],
      optCount: OPT_PER_LEVEL[i],
      observeMs: OBSERVE_MS[i],
      answerMs: ANSWER_MS[i],
      revealMs: REVEAL_MS,
      types: TYPES_BY_TIER[tierOf(level)].slice()
    };
  }

  /* ---------------- 工具 ---------------- */

  function uniq(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) { if (out.indexOf(arr[i]) < 0) { out.push(arr[i]); } }
    return out;
  }
  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }
  function angleDiff(a, b) {
    var d = Math.abs(a - b) % (Math.PI * 2);
    return d > Math.PI ? Math.PI * 2 - d : d;
  }
  function findById(items, id) {
    for (var i = 0; i < items.length; i++) { if (items[i].id === id) { return items[i]; } }
    return null;
  }
  function findByKind(items, kindId) { return findById(items, kindId); }

  /** 组装选项：正确答案 + 干扰项，去重后洗牌，返回 {options, answerIndex} */
  function makeOptions(correct, distractors, rng) {
    var raw = [correct].concat(distractors || []);
    var opts = uniq(raw);
    U.shuffle(opts, rng);
    return { options: opts, answerIndex: opts.indexOf(correct) };
  }

  /** 从颜色池取 n-1 个不等于 correct 的干扰色 */
  function colorDistractors(correct, n, rng) {
    var pool = [];
    for (var i = 0; i < COLORS.length; i++) {
      if (COLORS[i].name !== correct) { pool.push(COLORS[i].name); }
    }
    U.shuffle(pool, rng);
    return pool.slice(0, Math.max(0, n - 1));
  }

  /** 从字符串池取 n-1 个不等于 correct 的干扰项 */
  function stringDistractors(correct, pool, n, rng) {
    var p = [];
    for (var i = 0; i < pool.length; i++) { if (pool[i] !== correct) { p.push(pool[i]); } }
    U.shuffle(p, rng);
    return p.slice(0, Math.max(0, n - 1));
  }

  function allKindNames() {
    var out = [];
    for (var i = 0; i < KINDS.length; i++) { out.push(KINDS[i].name); }
    return out;
  }

  /* ---------------- 场景生成 ---------------- */

  /**
   * 生成场景卡：从 10 种物品里洗牌取 N 种（每 kind 唯一），
   * 从 12 格点洗牌取 N 个（带微小抖动），随机上色（同色最多 3 件、保证 ≥3 种色）。
   */
  function buildScene(rng, N) {
    var kinds = KINDS.slice();
    U.shuffle(kinds, rng);
    kinds = kinds.slice(0, N);

    var pts = GRID.slice();
    U.shuffle(pts, rng);
    pts = pts.slice(0, N);

    var items = [];
    var colorUse = {};
    for (var i = 0; i < N; i++) {
      var p = pts[i];
      var x = U.clamp(p[0] + (rng() * 2 - 1) * JITTER, 0.08, 0.92);
      var y = U.clamp(p[1] + (rng() * 2 - 1) * JITTER, 0.08, 0.92);

      var k = kinds[i];
      var item = {
        id: k.id, kind: k.id, name: k.name,
        x: x, y: y, rot: 0,
        state: null, dest: null, train: null, from: null
      };
      if (REC_SET[k.id]) {
        var c = pick(REC_COLORS, rng);
        var guard = 0;
        while ((colorUse[c.name] || 0) >= 3 && guard++ < 30) { c = pick(REC_COLORS, rng); }
        colorUse[c.name] = (colorUse[c.name] || 0) + 1;
        item.colorName = c.name; item.colorHex = c.hex;
      } else {
        var nat = NATURAL[k.id];
        item.colorName = nat.name; item.colorHex = nat.hex;
      }
      if (k.stateful) { item.state = rng() < 0.5 ? 'open' : 'closed'; }
      if (k.label) {
        item.dest = pick(STATIONS, rng);
        item.train = pick(TRAINS, rng);
        item.from = STATIONS[(STATIONS.indexOf(item.dest) + 1 + Math.floor(rng() * (STATIONS.length - 1))) % STATIONS.length];
        if (item.from === item.dest) { item.from = STATIONS[0] === item.dest ? STATIONS[1] : STATIONS[0]; }
      }
      items.push(item);
    }

    // 兜底：可换色物品至少 3 种色，否则「数量题」选项太单调、颜色题也缺干扰
    // （只重排 recolorable 物品，绝不触碰钥匙/橘子等自然色物品）
    var recItems = items.filter(function (a) { return REC_SET[a.kind]; });
    var distinct = uniq(recItems.map(function (a) { return a.colorName; }));
    if (distinct.length < 3 && recItems.length >= 3) {
      for (var q = 0; q < 3; q++) {
        recItems[q].colorName = REC_COLORS[q].name;
        recItems[q].colorHex = REC_COLORS[q].hex;
      }
    }

    // 笔尖指向：把 pen.rot 设成指向某个唯一目标（第二名角差 ≥ MIN_ANGLE_GAP）
    var pointing = computePointing(items, rng);
    return { items: items, pointing: pointing };
  }

  /**
   * 在 items 里找 directional 物品（签字笔），挑一个「沿 rot 方向角差唯一最小」的目标。
   * 找不到就返回 null（该关不出指向题），绝不硬凑一个有多个候选的歧义答案。
   */
  function computePointing(items, rng) {
    var pen = null;
    for (var i = 0; i < items.length; i++) { if (items[i].kind === 'pen') { pen = items[i]; break; } }
    if (!pen) { return null; }
    var others = items.filter(function (a) { return a.id !== pen.id; });
    if (others.length < 2) { return null; }

    var cand = others.slice();
    U.shuffle(cand, rng);
    for (var t = 0; t < cand.length; t++) {
      var target = cand[t];
      var ang = Math.atan2(target.y - pen.y, target.x - pen.x);
      var minGap = Infinity;
      for (var o = 0; o < others.length; o++) {
        var it = others[o];
        if (it.id === target.id) { continue; }
        var ao = Math.atan2(it.y - pen.y, it.x - pen.x);
        var d = angleDiff(ao, ang);
        if (d < minGap) { minGap = d; }
      }
      if (minGap >= MIN_ANGLE_GAP) {
        pen.rot = ang;
        return { penId: pen.id, targetId: target.id, gap: minGap, rot: ang };
      }
    }
    pen.rot = Math.atan2(cand[0].y - pen.y, cand[0].x - pen.x);
    return null;
  }

  /** 用 scene 里存下的 rot 回算「笔尖指向谁」，供数据层断言与揭晓复用 */
  function resolvePointing(scene) {
    var p = scene.pointing;
    if (!p) { return null; }
    var pen = findById(scene.items, p.penId);
    if (!pen) { return null; }
    var best = null, bestD = Infinity, second = Infinity;
    for (var i = 0; i < scene.items.length; i++) {
      var it = scene.items[i];
      if (it.id === pen.id) { continue; }
      var d = angleDiff(Math.atan2(it.y - pen.y, it.x - pen.x), pen.rot);
      if (d < bestD) { second = bestD; bestD = d; best = it; }
      else if (d < second) { second = d; }
    }
    return { targetId: best && best.id, first: bestD, second: second };
  }

  /* ---------------- 自动出题 ---------------- */

  /**
   * 按题型构造候选题池。每题 {type, text, options, answerIndex, targetId, revealText, explain}。
   * ⚠️ 所有干扰项都从「确实不等于正确答案」的池里取，二选一题天然唯一。
   */
  function buildCandidates(scene, allowed, optCount, rng) {
    var items = scene.items;
    var buckets = {};
    for (var a = 0; a < allowed.length; a++) { buckets[allowed[a]] = []; }
    function add(type, q) {
      if (buckets[type]) { buckets[type].push(q); }
    }
    function q(type, text, correct, distractors, targetId, explain) {
      var o = makeOptions(correct, distractors, rng);
      return { type: type, text: text, options: o.options, answerIndex: o.answerIndex,
        targetId: targetId || null, revealText: correct, explain: explain || '' };
    }

    // 1) 颜色：仅天生多彩物品（雨伞/马克杯/签字笔）才考颜色，
    //    其余物品有自然色（钥匙银、橘子橙…），考颜色会变成怪题
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!REC_SET[it.kind]) { continue; }
      add('color', q('color', '图中的' + it.name + '是什么颜色？', it.colorName,
        colorDistractors(it.colorName, optCount, rng), it.id,
        '图中的' + it.name + '是' + it.colorName + '的'));
    }

    // 2) 有无：问「有没有 <色><物品>」，颜色从场景中出现过的色里挑，答案分布均衡
    var usedColors = uniq(items.map(function (a2) { return a2.colorName; }));
    for (var e = 0; e < items.length; e++) {
      var ei = items[e];
      var c = rng() < 0.5 ? ei.colorName : pick(usedColors, rng);
      var exists = false;
      for (var f = 0; f < items.length; f++) {
        if (items[f].kind === ei.kind && items[f].colorName === c) { exists = true; break; }
      }
      var ans = exists ? '有' : '没有';
      add('exist', q('exist', '图中有没有' + c + ei.name + '？', ans,
        [exists ? '没有' : '有'], ei.id,
        exists ? ('有的，图里确实有' + c + ei.name) : ('没有，图里没有' + c + ei.name)));
    }

    // 3) 状态：只有 stateful 物品能问
    for (var s = 0; s < items.length; s++) {
      var si = items[s];
      if (!si.state) { continue; }
      var sa = STATE_NAMES[si.state];
      add('state', q('state', '图中的' + si.name + '是打开还是关闭的？', sa,
        [sa === '打开' ? '关闭' : '打开'], si.id,
        '图中的' + si.name + '是' + sa + '的'));
    }

    // 4) 文字细节：车票目的地 / 车次 / 出发站
    var ticket = findByKind(items, 'ticket');
    if (ticket) {
      add('label', q('label', '车票的目的地是哪里？', ticket.dest,
        stringDistractors(ticket.dest, STATIONS, optCount, rng), ticket.id,
        '车票终点是 ' + ticket.dest));
      add('label', q('label', '车票上的车次是什么？', ticket.train,
        stringDistractors(ticket.train, TRAINS, optCount, rng), ticket.id,
        '车票车次是 ' + ticket.train));
      add('label', q('label', '车票的出发站是哪里？', ticket.from,
        stringDistractors(ticket.from, STATIONS, optCount, rng), ticket.id,
        '车票从 ' + ticket.from + ' 出发'));
    }

    // 5) 数量：优先问场景里出现过的颜色（答案 ≥1，避免恒为 0 太好猜）
    var cnt = {};
    for (var h = 0; h < items.length; h++) { cnt[items[h].colorName] = (cnt[items[h].colorName] || 0) + 1; }
    var present = Object.keys(cnt).filter(function (k2) { return cnt[k2] > 0; });
    U.shuffle(present, rng);
    for (var cq = 0; cq < Math.min(3, present.length); cq++) {
      var col = present[cq], n = cnt[col];
      var ds = [], v = 1;
      while (ds.length < optCount - 1) {
        var candN = n + (v % 2 === 0 ? v / 2 : -(v + 1) / 2);
        v++;
        if (candN >= 0 && candN !== n && ds.indexOf(candN) < 0) { ds.push(candN); }
        if (v > 40) { break; }
      }
      var firstId = null;
      for (var z = 0; z < items.length; z++) { if (items[z].colorName === col) { firstId = items[z].id; break; } }
      add('count', q('count', '图中有几个' + col + '的物品？', n, ds, firstId,
        '图中' + col + '的物品共 ' + n + ' 个'));
    }

    // 6) 方位：只问明显偏左/右的物品，避免贴中线造成歧义
    for (var pp = 0; pp < items.length; pp++) {
      var pi = items[pp];
      if (Math.abs(pi.x - 0.5) < 0.12) { continue; }
      var pa = pi.x < 0.5 ? '左半边' : '右半边';
      add('position', q('position', '图中的' + pi.name + '在卡片左半边还是右半边？', pa,
        [pa === '左半边' ? '右半边' : '左半边'], pi.id,
        pi.name + '在卡片的' + pa));
    }

    // 7) 空间关系：笔尖指向（pointing 为 null 时整组为空，不出歧义题）
    var pt = resolvePointing(scene);
    if (pt && pt.targetId) {
      var tgt = findById(items, pt.targetId);
      var names = items.map(function (a3) { return a3.name; })
        .filter(function (nm) { return nm !== tgt.name; });
      U.shuffle(names, rng);
      add('spatial', q('spatial', '签字笔的笔尖指向什么物品？', tgt.name,
        uniq(names).slice(0, Math.max(0, optCount - 1)), tgt.id,
        '笔尖指向的是' + tgt.name));
    }

    // 每组内部洗牌，保证不同关卡题目不同
    for (var key in buckets) {
      if (buckets.hasOwnProperty(key)) { U.shuffle(buckets[key], rng); }
    }
    return buckets;
  }

  /**
   * round-robin 从各题型组取题，保证题型分散（一关不会 5 题全是颜色）；
   * 同一 targetId 最多被问 2 次，避免全程盯着同一件物品。
   */
  function genQuestions(scene, rng, count, allowedTypes, optCount) {
    var buckets = buildCandidates(scene, allowedTypes.slice(), optCount, rng);
    var types = Object.keys(buckets);
    U.shuffle(types, rng);
    var picked = [], usedTarget = {}, guard = 0;
    while (picked.length < count && guard++ < 300) {
      var progressed = false;
      for (var ti = 0; ti < types.length && picked.length < count; ti++) {
        var b = buckets[types[ti]];
        var chosen = null;
        for (var bi = 0; bi < b.length; bi++) {
          var cand = b[bi];
          if ((usedTarget[cand.targetId] || 0) < 2) { chosen = cand; b.splice(bi, 1); break; }
        }
        if (chosen) {
          usedTarget[chosen.targetId] = (usedTarget[chosen.targetId] || 0) + 1;
          picked.push(chosen);
          progressed = true;
        }
      }
      if (!progressed) {
        // 去重限制导致取不满：放宽限制再补一轮
        for (var t2 = 0; t2 < types.length && picked.length < count; t2++) {
          if (buckets[types[t2]].length) { picked.push(buckets[types[t2]].shift()); progressed = true; }
        }
        if (!progressed) { break; }
      }
    }
    return picked;
  }

  /* ---------------- build / daily / 评分 ---------------- */

  function buildSceneFull(seed, p, level, daily) {
    var rng = U.mulberry32(seed);
    var sc = buildScene(rng, p.N);
    var questions = genQuestions(sc, rng, p.M, p.types, p.optCount);
    return {
      level: level,
      daily: !!daily,
      N: p.N,
      M: p.M,
      optCount: p.optCount,
      observeMs: p.observeMs,
      answerMs: p.answerMs,
      revealMs: p.revealMs,
      types: p.types.slice(),
      items: sc.items,
      pointing: sc.pointing,
      questions: questions
    };
  }

  function build(level) {
    var lv = U.clamp(level | 0, 1, TOTAL);
    var p = paramsForLevel(lv);
    var seed = (0x5f356495 ^ Math.imul(lv, 0x9E3779B1)) >>> 0;
    return buildSceneFull(seed, p, lv, false);
  }

  /** 每日挑战：进阶档 N=8 / M=4，当天日期种子，全服同题 */
  function buildDaily() {
    var d = new Date();
    var seed = (U.seedFromDate ? U.seedFromDate(d) : (Date.now() & 0x7fffffff)) >>> 0;
    var p = paramsForLevel(8);
    p.N = 8; p.M = 4;
    return buildSceneFull((seed ^ 0x27D4EB2D) >>> 0, p, 0, true);
  }

  function starsFor(mistakes, hintsUsed) {
    var s = mistakes === 0 ? 3 : (mistakes <= 2 ? 2 : 1);
    if (hintsUsed >= 1) { s = Math.min(s, 2); }
    if (hintsUsed >= 2) { s = Math.min(s, 1); }
    return s;
  }

  BF.RecallGen = {
    TOTAL: TOTAL,
    REVEAL_MS: REVEAL_MS,
    MIN_ANGLE_GAP: MIN_ANGLE_GAP,
    KINDS: KINDS,
    COLORS: COLORS,
    REC_COLORS: REC_COLORS,
    COLOR_CODE: COLOR_CODE,
    REC_SET: REC_SET,
    NATURAL: NATURAL,
    STATIONS: STATIONS,
    TRAINS: TRAINS,
    STATE_NAMES: STATE_NAMES,
    GRID: GRID,
    JITTER: JITTER,
    N_PER_LEVEL: N_PER_LEVEL,
    Q_PER_LEVEL: Q_PER_LEVEL,
    OPT_PER_LEVEL: OPT_PER_LEVEL,
    OBSERVE_MS: OBSERVE_MS,
    ANSWER_MS: ANSWER_MS,
    TYPES_BY_TIER: TYPES_BY_TIER,
    tierOf: tierOf,
    paramsForLevel: paramsForLevel,
    buildScene: buildScene,
    computePointing: computePointing,
    resolvePointing: resolvePointing,
    buildCandidates: buildCandidates,
    genQuestions: genQuestions,
    build: build,
    buildDaily: buildDaily,
    starsFor: starsFor,
    angleDiff: angleDiff
  };

  var games = BF.games || (BF.games = {});
  games.recall = {
    id: 'recall',
    title: '瞬时记忆',
    sub: '看图几秒，答出细节',
    skin: 'recall',
    scene: 'recall',
    TOTAL: TOTAL,
    build: function (n) { return build(n); },
    buildDaily: function () { return buildDaily(); },
    rules: {
      sub: '看几秒，答出图里的细节',
      lines: [
        '先看场景卡，记住物品的颜色和细节',
        '倒计时结束图片收起，开始逐题作答',
        '点选正确答案，超时算答错',
        '答错扣 1 颗心，3 心用完本关重来',
        '全对且不用提示可得 3 星'
      ]
    }
  };
})();
