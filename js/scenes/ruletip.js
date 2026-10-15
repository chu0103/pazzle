/**
 * ruletip.js —— 每款游戏的「玩法说明」弹框（共用弹层）
 *
 * 为什么要有：合集里 11 款游戏规则各不相同（移车出库要滑车、数织要看线索、
 * 密码推理的反馈还分三档提示模式），新玩家从首页卡片点进来经常不知道干嘛。
 * 于是在**每次进入这款游戏的第一个关卡时**弹一次规则说明；玩家勾选
 * 「不再提示」后写入 `Save.extra(game, 'noRule', 1)`，之后进该游戏不再弹。
 *
 * 与 DiffPick 同模式（共用模块 + 场景几步接入）：
 *   1) enter() 末尾（造题之后）：
 *        `if (BF.RuleTip.shouldShow(this.game, this)) { BF.RuleTip.enter(this, params); }`
 *      —— 必须放在造题之后：弹框压着的是已渲染好的盘面，且关闭弹框时
 *      场景状态机必须已经就绪（计时/输入由场景自己的 update/onDown 管）。
 *   2) update() 开头：`if (this.showRule) { return BF.RuleTip.update(this, dt); }`
 *      —— 提前 return 顺带保证**弹框期间不计时**（扫雷/数织/数独的 elapsed 不跑）。
 *   3) onDown()/onUp() 开头分流到 RuleTip.onDown/onUp（弹框期间场景不收输入）。
 *   4) render() 末尾：`if (this.showRule) { BF.RuleTip.render(ctx, this); }`
 *      —— 主体照常画（被遮罩压暗当背景），弹框画在最上层。
 *   5) 游戏注册里提供 `rules: { sub: '一行副标题', lines: ['短句', ...] }`；
 *      header 左上角放一个「?」按钮（RuleTip.renderBtn 画，位置取 scene.ruleBtn），
 *      点了随时重看 —— 否则勾过「不再提示」的玩家再也看不到规则。
 *
 * ⚠️ 遮罩区域**不可点**（必须点「开始游戏」）：规则说明被误触跳过等于没做。
 * ⚠️ 只在 enter（进游戏）时判断；关内点「下一关」不弹（next() 直接重建题目）。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : global);
  var BF = G.BF || (G.BF = {});
  if (BF.RuleTip) { return; }
  var U = BF.util, D = BF.draw, T = BF.theme;

  var ANIM_MS = 160;
  var PAD = 22;
  var BTN_H = 46;
  var BOX = 18;          // 复选框边长
  var LINE_H = 19;       // 规则条目行高（13px 字）
  var ENTRY_GAP = 10;    // 条目间距

  var RuleTip = {};
  BF.RuleTip = RuleTip;
  /** 总开关：测试/快照 harness 设 false 关掉（保留真机行为） */
  RuleTip.on = true;

  /**
   * 规则弹框里的「动画演示」参数（目前仅数织用：在卡片顶部播放一段
   * 会自己解题的迷你彩色数织）。其它游戏不配 demo 字段 → 卡片几何完全不变。
   *   rowT  每行填充耗时（秒）      gap   行间间隔
   *   hold  全图停留（秒）          fade  淡出（秒）后循环
   *   cap   单元格最大边长（屏大也不至于过大）
   *   padT  演示块内边距            badgeK 线索徽标边长 = cs*badgeK
   */
  RuleTip.DEMO = { rowT: 0.42, gap: 0.08, hold: 1.1, fade: 0.35, cap: 34, padT: 8, badgeK: 0.52 };

  /** 把一行/一列（颜色序号或 -1 空位）扫成「连续同色段」数组：[{n, col}] */
  function scanLine(cells) {
    var segs = [], cur = -2, n = 0;
    for (var i = 0; i < cells.length; i++) {
      var v = cells[i];
      if (v < 0) { if (n > 0) { segs.push({ n: n, col: cur }); n = 0; cur = -2; } }
      else if (v !== cur) { if (n > 0) { segs.push({ n: n, col: cur }); } cur = v; n = 1; }
      else { n++; }
    }
    if (n > 0) { segs.push({ n: n, col: cur }); }
    return segs;
  }

  /**
   * 根据 demo.grid 算演示区几何 + 行/列彩色线索。
   * demoX/demoY 是演示块左上角（layout 在算完卡片位置后回填）；
   * inner 卡片可用宽；budgetH 演示块可用高（layout 按 (H-40)-无demo卡片高 给）。
   */
  RuleTip.buildDemo = function (demo, demoX, demoY, inner, budgetH) {
    var grid = demo.grid, colors = (demo.colors && demo.colors.length) ? demo.colors : ['#E5484D'];
    var ROWS = grid.length, COLS = grid[0].length;
    var rowClues = [], colClues = [];
    for (var r = 0; r < ROWS; r++) { rowClues.push(scanLine(grid[r])); }
    for (var c = 0; c < COLS; c++) {
      var arr = []; for (var r2 = 0; r2 < ROWS; r2++) { arr.push(grid[r2][c]); }
      colClues.push(scanLine(arr));
    }
    var maxSeg = 1;
    for (var i = 0; i < ROWS; i++) { maxSeg = Math.max(maxSeg, rowClues[i].length); }
    for (var j = 0; j < COLS; j++) { maxSeg = Math.max(maxSeg, colClues[j].length); }
    // 线索槽需要的「单元格单位」宽度：最多 maxSeg 个徽标（+ 间隙），留点余量
    var gutUnits = Math.max(1.0, 0.55 * maxSeg + 0.3);
    var csW = inner / (COLS + gutUnits);
    var csH = (budgetH - 2 * RuleTip.DEMO.padT) / (ROWS + gutUnits);
    var cs = Math.floor(Math.max(12, Math.min(csW, csH, RuleTip.DEMO.cap)));
    var gut = cs * gutUnits;
    var contentW = gut + COLS * cs, contentH = gut + ROWS * cs;
    var h = contentH + 2 * RuleTip.DEMO.padT;
    return {
      x: demoX, y: demoY, w: inner, h: h,
      cs: cs, gw: gut, gh: gut,
      gx: demoX + gut, gy: demoY + gut,
      grid: grid, rowClues: rowClues, colClues: colClues, colors: colors,
      rows: ROWS, cols: COLS, badge: Math.max(12, cs * RuleTip.DEMO.badgeK)
    };
  };

  /** 一行线索徽标（水平居中于 centerX，垂直居中于 centerY） */
  RuleTip._clueRow = function (ctx, d, segs, cx, cy, a) {
    var n = segs.length, b = d.badge;
    if (n === 0) { D.fillRound(ctx, cx - b / 2, cy - b / 2, b, b, 4, '#C9CDD4');
      D.text(ctx, '0', cx, cy, { size: Math.max(9, b * 0.5), color: '#fff', weight: '700' }); return; }
    var totalW = n * b + (n - 1) * 2, x0 = cx - totalW / 2;
    for (var i = 0; i < n; i++) {
      var seg = segs[i], bx = x0 + i * (b + 2);
      D.fillRound(ctx, bx, cy - b / 2, b, b, 4, d.colors[seg.col] || '#E5484D');
      D.text(ctx, String(seg.n), bx + b / 2, cy + 0.5, { size: Math.max(9, b * 0.5), color: '#fff', weight: '700' });
    }
  };
  /** 一列线索徽标（垂直居中于 centerY，水平居中于 centerX） */
  RuleTip._clueCol = function (ctx, d, segs, cx, cy, a) {
    var n = segs.length, b = d.badge;
    if (n === 0) { D.fillRound(ctx, cx - b / 2, cy - b / 2, b, b, 4, '#C9CDD4');
      D.text(ctx, '0', cx, cy, { size: Math.max(9, b * 0.5), color: '#fff', weight: '700' }); return; }
    var totalH = n * b + (n - 1) * 2, y0 = cy - totalH / 2;
    for (var i = 0; i < n; i++) {
      var seg = segs[i], by = y0 + i * (b + 2);
      D.fillRound(ctx, cx - b / 2, by, b, b, 4, d.colors[seg.col] || '#E5484D');
      D.text(ctx, String(seg.n), cx, by + b / 2 + 0.5, { size: Math.max(9, b * 0.5), color: '#fff', weight: '700' });
    }
  };

  /* ---------------- 数据 ---------------- */

  /** 某游戏的规则文案；没配 rules 的老游戏返回 null（调用方据此跳过弹框） */
  RuleTip.rulesOf = function (game) {
    var meta = (BF.games && BF.games[game]) || null;
    var r = meta && meta.rules;
    if (!r || !r.lines || !r.lines.length) { return null; }
    return r;
  };

  /**
   * 关内切关（「下一关」/「重玩」）调用：本次 enter 不弹。
   * 弹框的语义是"每次进入这款游戏时提醒一次"，不是"每一关都提醒"——
   * 否则连过 10 关要被规则说明打断 10 次。用法：`BF.RuleTip.skipOnce(this); this.enter(...)`。
   */
  RuleTip.skipOnce = function (scene) { scene._skipRule = true; };

  /** 该游戏是否还没被玩家标记「不再提示」（scene 传入时支持 skipOnce） */
  RuleTip.shouldShow = function (game, scene) {
    // ⚠️ skipOnce 必须**无条件先消费**：要是放在 `on === false` 之类的提前 return 之后，
    //    harness 关着弹框时设下的 _skipRule 会一直残留，等开关被打开时第一次 enter 就被
    //    莫名跳过（smoke 9g 实测踩过）。
    var skip = !!(scene && scene._skipRule);
    if (scene) { scene._skipRule = false; }
    if (!RuleTip.rulesOf(game)) { return false; }
    // 测试 harness / 快照页统一关掉（否则 enter 后输入全被弹框拦走，老用例全挂）；
    // 规则弹框的行为由 tools/_verify_ruletip_logic.js 与 smoke 9g 专门覆盖。
    if (RuleTip.on === false) { return false; }
    if (skip) { return false; }
    return !BF.Save.extraOf(game).noRule;
  };

  /** header 左上角「?」按钮的位置（放在返回按钮右侧 8px，各场景通用） */
  RuleTip.btnRect = function (scene) {
    // back 的挂点各场景不同：diff/mine/picross 是 scene.back，play 是 scene.L.back
    var b = scene.back || (scene.L && scene.L.back) || { x: 12, y: 12, w: 32, h: 32 };
    return { x: b.x + b.w + 8, y: b.y + (b.h - 28) / 2, w: 28, h: 28 };
  };

  /**
   * 「?」按钮的命中盒。没开过弹框的场景 ruleBtn 还没算过，用 scene.back 现算兜底
   * —— 这样场景 layout 不用为它改一行，玩家点第一下就能重看。
   */
  RuleTip.btn = function (scene) {
    return scene.ruleBtn || RuleTip.btnRect(scene);
  };

  /* ---------------- 进入 / 关闭 ---------------- */

  /**
   * 打开弹框。params.force = true 时无视「不再提示」（header 的「?」重看入口）。
   * 只清零输入态，不动场景的题目/计时状态。
   */
  RuleTip.enter = function (scene, params) {
    params = params || {};
    scene.showRule = true;
    scene.ruleAnim = 0;
    scene.ruleDemoT = 0;        // 演示动画从头开始（每次打开都重新播一遍）
    scene.ruleNoTip = false;
    scene.rulePress = null;      // 'check' | 'ok' | null（按下态）
    scene.ruleForce = !!params.force;
    // 清掉可能残留的输入态：弹框期间点下的格子/拖动不应在关闭后生效。
    // ⚠️ pressCell 必须清成 -1 不能是 null：picross 的长按判断写的是 `pressCell >= 0`，
    //    而 `null >= 0` 在 JS 里为 true → 关掉弹框的第一帧就会误触发「长按第 0 格」
    //    （标空 + 开始计时 + 存进度）。mine 用 `!= null` 判断所以没这问题，但别再赌。
    scene.pressBtn = null;
    scene.pressCell = -1;
    scene.pressStart = 0;
    scene.pressHandled = false;
    scene.pressMoved = false;
    scene.drag = null;
    scene.held = null;
    scene.selected = -1;
    if (scene.layout) { scene.layout(); }
    RuleTip.layout(scene);
    return scene;
  };

  /** 关闭弹框；勾了「不再提示」就落盘 */
  RuleTip.close = function (scene) {
    if (scene.ruleNoTip) { BF.Save.putExtra(scene.game, 'noRule', 1); }
    scene.showRule = false;
    scene.rulePress = null;
  };

  /* ---------------- 布局 ---------------- */

  /**
   * 卡片几何：宽 min(屏宽-56, 320)，高按内容算（条目按可用宽度换行后累加）。
   * 命中盒与绘制同源（都走这里算出的 rects），避免"看得见点不中"。
   */
  RuleTip.layout = function (scene) {
    var pf = BF.platform, W = pf.width, H = pf.height;
    var r = RuleTip.rulesOf(scene.game) || { sub: '', lines: [] };
    var meta = (BF.games && BF.games[scene.game]) || {};
    var w = Math.min(W - 56, 320);
    var inner = w - PAD * 2;
    var ctx = pf.ctx;

    // 每条规则按可用宽度换行 → entries[i].segs
    var entries = [];
    var rowCount = 0;
    for (var i = 0; i < r.lines.length; i++) {
      var segs = RuleTip.wrap(ctx, String(r.lines[i]), inner - 16);
      entries.push({ segs: segs });
      rowCount += segs.length;
    }

    var titleH = 24, subH = r.sub ? 20 : 0;
    var prefix = PAD + titleH + subH + 10;   // 标题 + 副标题 + 间距
    var rulesH = rowCount ? (rowCount * LINE_H + (entries.length - 1) * ENTRY_GAP) : 0;
    var rest = rulesH + 14 + 1 + 17 + 16 + BTN_H + PAD;  // 规则区以下到卡底
    var hNoDemo = prefix + rest;

    // 动画演示（仅数织等配了 demo 字段的游戏）：在卡片顶部标题下、规则文字上预留一块。
    // 无 demo 的游戏 ruleDemo 保持 null，卡片几何与之前完全一致（86 张老快照 0 差异）。
    var demoH = 0;
    var demo = (r.demo && r.demo.grid) ? r.demo : null;
    if (demo) {
      var budget = (H - 40) - hNoDemo;          // 演示块可用高度
      var rd = RuleTip.buildDemo(demo, 0, 0, inner, budget > 40 ? budget : 40);
      if (rd) {
        demoH = rd.h + 14;                       // 演示块 + 与规则文字的间距
        scene.ruleDemo = rd;
      } else { scene.ruleDemo = null; }
    } else { scene.ruleDemo = null; }

    var h = Math.min(prefix + demoH + rest, H - 40);
    var x = (W - w) / 2, y = Math.max(24, (H - h) / 2 - 8);

    // 演示块几何：左上角 = 卡片左内边距 + 标题副标题下沿；无 demo 时 ruleDemo 仍为 null
    if (scene.ruleDemo) {
      scene.ruleDemo.x = x + PAD;
      scene.ruleDemo.y = y + prefix;
      scene.ruleDemo.w = inner;
      scene.ruleDemo.gx = scene.ruleDemo.x + scene.ruleDemo.gw;
      scene.ruleDemo.gy = scene.ruleDemo.y + scene.ruleDemo.gh;
      scene.ruleRulesTop = y + prefix + demoH;   // 规则文字排在演示块之下
    } else {
      scene.ruleRulesTop = y + prefix;
    }

    scene.ruleCard = { x: x, y: y, w: w, h: h };
    scene.ruleEntries = entries;
    scene.ruleSub = r.sub || '';
    scene.ruleTitle = (meta.title || '') + ' · 玩法说明';
    scene.ruleCheck = { x: x + PAD, y: y + h - PAD - BTN_H - 16 - BOX / 2, w: BOX, h: BOX };
    scene.ruleOk = { x: x + PAD, y: y + h - PAD - BTN_H, w: inner, h: BTN_H };
    // 场景自己摆过「?」位置的不覆盖（如数织 header 是左对齐标题，要避开）
    if (!scene.ruleBtn) { scene.ruleBtn = RuleTip.btnRect(scene); }
  };

  /** 贪心换行：返回行数组（字符级切分，中文场景够用） */
  RuleTip.wrap = function (ctx, text, maxW) {
    if (!ctx || !ctx.measureText) { return [text]; }
    var out = [], cur = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (cur && ctx.measureText(cur + ch).width > maxW) { out.push(cur); cur = ch; }
      else { cur += ch; }
    }
    if (cur) { out.push(cur); }
    return out.length ? out : [text];
  };

  /* ---------------- 状态机 ---------------- */

  RuleTip.update = function (scene, dt) {
    if (scene.ruleAnim < 1) {
      scene.ruleAnim = Math.min(1, scene.ruleAnim + (dt || 16) / ANIM_MS);
    }
    // 演示动画进度（仅配了 demo 的游戏；dt 毫秒 → 秒）
    if (scene.ruleDemo) {
      scene.ruleDemoT = (scene.ruleDemoT || 0) + (dt || 16) / 1000;
    }
  };

  RuleTip.onDown = function (scene, x, y) {
    scene.rulePress = null;
    if (U.pointInRect(x, y, scene.ruleCheck)) { scene.rulePress = 'check'; return; }
    if (U.pointInRect(x, y, scene.ruleOk)) { scene.rulePress = 'ok'; return; }
    // 点遮罩 = 什么都不做（不允许误触跳过规则）
  };

  RuleTip.onUp = function (scene, x, y) {
    var p0 = scene.rulePress;
    scene.rulePress = null;
    if (!p0) { return; }
    if (p0 === 'check') {
      // 复选框：按下与抬起都在框内才切换
      if (U.pointInRect(x, y, scene.ruleCheck)) { scene.ruleNoTip = !scene.ruleNoTip; }
      return;
    }
    if (p0 === 'ok') {
      if (U.pointInRect(x, y, scene.ruleOk)) { RuleTip.close(scene); }
    }
  };

  /* ---------------- 渲染 ---------------- */

  /** header 的「?」按钮（各场景 renderHeader 里调） */
  RuleTip.renderBtn = function (ctx, scene) {
    // 总开关关闭时不画「?」按钮 —— 与 shouldShow 一致，保证 harness / 老快照 0 差异。
    // 生产环境 RuleTip.on 恒为 true，此分支不影响真机表现。
    if (RuleTip.on === false) { return; }
    var r = scene.ruleBtn || RuleTip.btnRect(scene);
    D.fillRound(ctx, r.x, r.y, r.w, r.h, 9, '#FFFFFF');
    D.roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 9);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    D.text(ctx, '?', r.x + r.w / 2, r.y + r.h / 2 + 0.5,
      { size: 15, weight: '700', color: T.textSub });
  };

  /**
   * 演示区渲染：一个会自己解题的迷你彩色数织。
   * 行/列彩色线索（带色块数字串）画在网格左侧/顶部；格子逐行从左往右被填充，
   * 当前正在填的那一行左侧线索高亮；全图停留片刻后淡出、循环。
   * 整个演示都在卡片的 (0.96→1) 缩放变换内，坐标用 layout 算好的屏幕坐标。
   */
  RuleTip.renderDemo = function (ctx, scene, a) {
    var d = scene.ruleDemo; if (!d) { return; }
    var ROWS = d.rows, COLS = d.cols, demoT = scene.ruleDemoT || 0;
    var DZ = RuleTip.DEMO;
    var cycle = ROWS * (DZ.rowT + DZ.gap) - DZ.gap + DZ.hold + DZ.fade;
    var tt = ((demoT % cycle) + cycle) % cycle;
    function rowStart(r) { return r * (DZ.rowT + DZ.gap); }
    var allDone = ROWS * (DZ.rowT + DZ.gap) - DZ.gap;
    var fadeA = 1;
    if (tt > allDone + DZ.hold) { fadeA = Math.max(0, 1 - (tt - allDone - DZ.hold) / DZ.fade); }

    // 演示区浅灰底，与下方规则文字区分开
    ctx.save(); ctx.globalAlpha = a * 0.96;
    D.fillRound(ctx, d.x, d.y, d.w, d.h, 14, '#F3F5F8');
    ctx.restore();

    // 网格底格（白）
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var cx = d.gx + c * d.cs, cy = d.gy + r * d.cs;
        ctx.save(); ctx.globalAlpha = a;
        D.fillRound(ctx, cx + 1, cy + 1, d.cs - 2, d.cs - 2, 4, '#FFFFFF');
        ctx.restore();
      }
    }
    // 已填色格（按动画进度淡入；左→右逐格出现，整行填完即常亮）
    for (var r2 = 0; r2 < ROWS; r2++) {
      for (var c2 = 0; c2 < COLS; c2++) {
        var v = d.grid[r2][c2];
        if (v < 0) { continue; }
        var rs = rowStart(r2), cellA = 0;
        if (tt >= rs + DZ.rowT) { cellA = 1; }
        else if (tt >= rs) {
          var p = (tt - rs) / DZ.rowT;            // 本行填充进度 0..1
          cellA = Math.max(0, Math.min(1, (p - c2 / COLS) * COLS));
        }
        cellA *= fadeA;
        if (cellA > 0.02) {
          var cxp = d.gx + c2 * d.cs, cyp = d.gy + r2 * d.cs;
          ctx.save(); ctx.globalAlpha = a * cellA;
          D.fillRound(ctx, cxp + 1, cyp + 1, d.cs - 2, d.cs - 2, 4, d.colors[v] || '#E5484D');
          ctx.restore();
        }
      }
    }
    // 网格线
    ctx.save(); ctx.globalAlpha = a * 0.9; ctx.strokeStyle = '#E4E7EB'; ctx.lineWidth = 1;
    for (var r3 = 0; r3 <= ROWS; r3++) {
      ctx.beginPath(); ctx.moveTo(d.gx, d.gy + r3 * d.cs); ctx.lineTo(d.gx + COLS * d.cs, d.gy + r3 * d.cs); ctx.stroke();
    }
    for (var c3 = 0; c3 <= COLS; c3++) {
      ctx.beginPath(); ctx.moveTo(d.gx + c3 * d.cs, d.gy); ctx.lineTo(d.gx + c3 * d.cs, d.gy + ROWS * d.cs); ctx.stroke();
    }
    ctx.restore();

    // 行线索（左侧）+ 当前填充行高亮
    for (var r4 = 0; r4 < ROWS; r4++) {
      var rs4 = rowStart(r4);
      if (tt >= rs4 && tt < rs4 + DZ.rowT) {
        ctx.save(); ctx.globalAlpha = a * 0.14;
        D.fillRound(ctx, d.x + 3, d.gy + r4 * d.cs + 2, d.gw - 4, d.cs - 4, 6, T.accent);
        ctx.restore();
      }
      RuleTip._clueRow(ctx, d, d.rowClues[r4], d.x + d.gw / 2, d.gy + r4 * d.cs + d.cs / 2, a);
    }
    // 列线索（顶部）
    for (var c4 = 0; c4 < COLS; c4++) {
      RuleTip._clueCol(ctx, d, d.colClues[c4], d.gx + c4 * d.cs + d.cs / 2, d.y + d.gh / 2, a);
    }
  };

  RuleTip.render = function (ctx, scene) {
    var card = scene.ruleCard;
    if (!card) { return; }
    var a = scene.ruleAnim == null ? 1 : scene.ruleAnim;
    var pf = BF.platform;

    ctx.save();
    // 遮罩（随动画淡入）
    ctx.globalAlpha = 0.55 * a;
    ctx.fillStyle = T.scrim;
    ctx.fillRect(0, 0, pf.width, pf.height);

    // 卡片：淡入 + 轻微放大（0.96 → 1）
    var cx = card.x + card.w / 2, cy = card.y + card.h / 2;
    var s = 0.96 + 0.04 * a;
    ctx.globalAlpha = a;
    ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);

    D.panel(ctx, card.x, card.y, card.w, card.h,
      { radius: 22, fill: '#FFFFFF', shadowBlur: 24, shadowOffsetY: 8 });

    var tx = card.x + PAD;
    var y = card.y + PAD;

    D.text(ctx, scene.ruleTitle, cx, y + 12, { size: 18, weight: '500', color: T.text });
    y += 24;
    if (scene.ruleSub) {
      D.text(ctx, scene.ruleSub, cx, y + 10, { size: 12, color: T.textSub });
      y += 20;
    }
    y += 10;

    // 动画演示（仅配置了 demo 的游戏，如数织；其余游戏 ruleDemo 为 null 不画）
    if (scene.ruleDemo) { RuleTip.renderDemo(ctx, scene, a); }

    // 规则条目：每条第一行左侧一个圆点，其余行缩进对齐
    var row = 0;
    for (var i = 0; i < scene.ruleEntries.length; i++) {
      var segs = scene.ruleEntries[i].segs;
      for (var k = 0; k < segs.length; k++) {
        if (k === 0) {
          D.fillRound(ctx, tx + 1, scene.ruleRulesTop + row * LINE_H + 5, 6, 6, 3, T.accent);
        }
        D.text(ctx, segs[k], tx + 16, scene.ruleRulesTop + row * LINE_H + 10,
          { size: 13, color: T.text, align: 'left' });
        row++;
      }
    }
    var nEnt = scene.ruleEntries.length;
    y = scene.ruleRulesTop + row * LINE_H + (nEnt > 1 ? (nEnt - 1) * ENTRY_GAP : 0) + 14;

    // 分隔线
    ctx.beginPath();
    ctx.moveTo(tx, y + 0.5);
    ctx.lineTo(card.x + card.w - PAD, y + 0.5);
    ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    y += 1;

    // 「不再提示」复选框
    var cb = scene.ruleCheck;
    var cyy = cb.y + cb.h / 2;
    if (scene.ruleNoTip) {
      D.fillRound(ctx, cb.x, cb.y, cb.w, cb.h, 5, T.accent);
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cb.x + 4.5, cyy + 0.5);
      ctx.lineTo(cb.x + 7.5, cyy + 3.5);
      ctx.lineTo(cb.x + 13.5, cyy - 4);
      ctx.stroke();
    } else {
      D.fillRound(ctx, cb.x, cb.y, cb.w, cb.h, 5, '#FFFFFF');
      D.roundRect(ctx, cb.x + 0.5, cb.y + 0.5, cb.w - 1, cb.h - 1, 5);
      ctx.strokeStyle = T.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    }
    D.text(ctx, '不再提示', cb.x + cb.w + 8, cyy + 0.5,
      { size: 12, color: T.textSub, align: 'left' });

    // 主按钮
    var ok = scene.ruleOk;
    D.button(ctx, ok, '开始游戏', {
      fill: scene.rulePress === 'ok' ? T.accentDeep : T.accent,
      color: '#FFFFFF', size: 15
    });

    ctx.restore();
  };
})();
