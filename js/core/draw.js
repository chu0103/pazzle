/**
 * draw.js —— Canvas 绘制工具
 * 目标质感：参考图那种「圆角 + 顶部高光 + 底部暗边 + 柔和投影」的实体方块，
 * 以及带内阴影的灰色凹槽棋盘。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.draw) { return; }
  var U = BF.util, T = BF.theme;

  var FONT = '-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    if (r < 0.5) { r = 0.5; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fillRound(ctx, x, y, w, h, r, fill) {
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function withShadow(ctx, color, blur, dy, fn) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetY = dy;
    ctx.shadowOffsetX = 0;
    fn();
    ctx.restore();
  }

  function text(ctx, str, x, y, opt) {
    opt = opt || {};
    ctx.save();
    ctx.font = (opt.weight || 'normal') + ' ' + (opt.size || 14) + 'px ' + (opt.family || FONT);
    ctx.fillStyle = opt.color || T.text;
    ctx.textAlign = opt.align || 'center';
    ctx.textBaseline = opt.baseline || 'middle';
    if (opt.alpha != null) { ctx.globalAlpha = opt.alpha; }
    if (opt.letterSpacing && ctx.letterSpacing !== undefined) {
      try { ctx.letterSpacing = opt.letterSpacing; } catch (e) { /* 忽略 */ }
    }
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  /* ---------------- 方块 ---------------- */

  /** 圆角半径随方块尺寸自适应，小块也会显得圆润 */
  function blockRadius(w, h) {
    return Math.min(w, h) * 0.14 + Math.min(w, h) * 0.06;
  }

  /**
   * 实体方块
   * @param {String|Object} color 颜色 hex 或 BF.COLORS 项
   */
  function block(ctx, x, y, w, h, color, opt) {
    opt = opt || {};
    var base = typeof color === 'string' ? color : color.base;
    var pad = opt.pad || 0;
    x += pad; y += pad; w -= pad * 2; h -= pad * 2;
    if (w <= 0 || h <= 0) { return; }
    var r = opt.radius != null ? opt.radius : blockRadius(w, h);

    ctx.save();
    if (opt.alpha != null) { ctx.globalAlpha = opt.alpha; }
    if (opt.shadow !== false) {
      var lift = opt.lift ? 1.9 : 1;
      ctx.shadowColor = opt.lift ? 'rgba(15,18,22,0.30)' : T.shadow;
      ctx.shadowBlur = Math.max(3, Math.min(h, w) * 0.16) * lift;
      ctx.shadowOffsetY = Math.max(1.5, Math.min(h, w) * 0.06) * lift + (opt.lift ? 2.5 : 0);
    }
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, U.shade(base, 0.22));
    g.addColorStop(0.42, base);
    g.addColorStop(1, U.shade(base, -0.14));
    fillRound(ctx, x, y, w, h, r, g);
    ctx.restore();

    // 顶部内高光（让它有厚度）
    ctx.save();
    if (opt.alpha != null) { ctx.globalAlpha = opt.alpha; }
    var hg = ctx.createLinearGradient(0, y, 0, y + h * 0.5);
    hg.addColorStop(0, 'rgba(255,255,255,0.34)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    fillRound(ctx, x + w * 0.06, y + h * 0.05, w * 0.88, h * 0.45, r * 0.7, hg);
    // 底部渐暗（用渐变而不是实心条，浅色块上才不会出现一道灰边）
    ctx.save();
    if (opt.alpha != null) { ctx.globalAlpha = opt.alpha; }
    var dg = ctx.createLinearGradient(0, y + h * 0.70, 0, y + h);
    dg.addColorStop(0, 'rgba(23,26,31,0)');
    dg.addColorStop(1, 'rgba(23,26,31,0.16)');
    fillRound(ctx, x, y + h * 0.70, w, h * 0.30, r, dg);
    ctx.restore();

    // 描边，压住边缘
    ctx.save();
    if (opt.alpha != null) { ctx.globalAlpha = opt.alpha; }
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.strokeStyle = 'rgba(23,26,31,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // 对应本函数开头（顶部内高光那一段）的 save。
    // 漏掉这一句会让每画一个方块就泄漏一层 canvas 状态（实测每帧 3~15 层，60fps 下每秒 180~900 层），
    // 真机状态栈有上限，几秒就溢出 → save() 抛错 → 整屏卡死。
    ctx.restore();
  }

  /**
   * 扁平拼图块（游戏 2 用）
   * 参考图里这种塑料教具片几乎是平的：纯色 + 一圈深描边，靠块与块之间的缝隙区分边界。
   * 如果沿用 block() 那套强渐变，白块会变灰、看起来像个凹槽，所以单独给一个更平的画法。
   * @param opt {pad, radius, highlight, shadow, alpha, lift}
   */
  function tile(ctx, x, y, w, h, base, opt) {
    opt = opt || {};
    var pad = opt.pad || 0;
    x += pad; y += pad; w -= pad * 2; h -= pad * 2;
    if (w <= 0 || h <= 0) { return; }
    var r = opt.radius != null ? opt.radius : Math.min(w, h) * 0.10;
    var lift = opt.lift ? 1.8 : 1;

    ctx.save();
    if (opt.alpha != null) { ctx.globalAlpha = opt.alpha; }
    if (opt.shadow !== false) {
      ctx.shadowColor = opt.lift ? 'rgba(15,18,22,0.30)' : 'rgba(23,26,31,0.17)';
      ctx.shadowBlur = Math.max(2, Math.min(w, h) * 0.09) * lift;
      ctx.shadowOffsetY = (Math.max(1, Math.min(w, h) * 0.035)) * lift + (opt.lift ? 2 : 0);
    }
    // 极轻的竖向渐变：看得出"有厚度"，又不会让白块发灰
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, U.shade(base, 0.05));
    g.addColorStop(0.55, base);
    g.addColorStop(1, U.shade(base, -0.055));
    fillRound(ctx, x, y, w, h, r, g);
    ctx.restore();

    // 顶部高光：彩色块有质感，白块和黑块不需要（黑块上加高光会很"塑料"）
    if (opt.highlight !== false) {
      ctx.save();
      if (opt.alpha != null) { ctx.globalAlpha = opt.alpha; }
      var hg = ctx.createLinearGradient(0, y, 0, y + h * 0.40);
      hg.addColorStop(0, 'rgba(255,255,255,0.20)');
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      fillRound(ctx, x, y, w, h * 0.40, r, hg);
      ctx.restore();
    }

    // 描边：统一压深，白块也能看出边界
    ctx.save();
    if (opt.alpha != null) { ctx.globalAlpha = opt.alpha; }
    roundRect(ctx, x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1), r);
    ctx.strokeStyle = opt.stroke || 'rgba(23,26,31,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  /** 棋盘空格凹槽 */
  function slot(ctx, x, y, w, h, opt) {
    opt = opt || {};
    var gap = opt.gap != null ? opt.gap : 1.2;
    x += gap; y += gap; w -= gap * 2; h -= gap * 2;
    var r = opt.radius != null ? opt.radius : blockRadius(w, h) * 0.85;
    fillRound(ctx, x, y, w, h, r, opt.fill || T.slot);

    ctx.save();
    roundRect(ctx, x + 0.6, y + 0.6, w - 1.2, h - 1.2, r);
    ctx.strokeStyle = opt.edge || T.slotEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
    // 上沿内阴影，做出"凹"的感觉
    var g = ctx.createLinearGradient(0, y, 0, y + h * 0.4);
    g.addColorStop(0, T.slotShadow);
    g.addColorStop(1, 'rgba(23,26,31,0)');
    ctx.beginPath();
    ctx.moveTo(x + r * 0.6, y + h * 0.075);
    ctx.lineTo(x + w - r * 0.6, y + h * 0.075);
    ctx.lineWidth = Math.max(1.5, h * 0.12);
    ctx.lineCap = 'round';
    ctx.strokeStyle = g;
    ctx.stroke();
    ctx.restore();
  }

  /** 棋盘外框（灰色托盘），opt 可覆盖配色（游戏 2 用另一套灰） */
  function boardFrame(ctx, x, y, w, h, pad, radius, opt) {
    opt = opt || {};
    ctx.save();
    ctx.shadowColor = 'rgba(23,26,31,0.22)';
    ctx.shadowBlur = Math.max(8, w * 0.045);
    ctx.shadowOffsetY = Math.max(3, w * 0.014);
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, opt.frameTop || T.boardFrameTop);
    g.addColorStop(1, opt.frameBottom || T.boardFrameBottom);
    fillRound(ctx, x, y, w, h, radius, g);
    ctx.restore();

    // 内凹区域
    var ix = x + pad, iy = y + pad, iw = w - pad * 2, ih = h - pad * 2;
    fillRound(ctx, ix, iy, iw, ih, radius * 0.72, opt.inner || T.boardInner);

    ctx.save();
    var sg = ctx.createLinearGradient(0, iy, 0, iy + ih * 0.22);
    sg.addColorStop(0, 'rgba(23,26,31,0.11)');
    sg.addColorStop(1, 'rgba(23,26,31,0)');
    fillRound(ctx, ix, iy, iw, ih * 0.28, radius * 0.72, sg);
    ctx.restore();
  }

  /**
   * 圆环点阵底纹（游戏 2 的棋盘格）
   * 每格画一个「环」：先填外圆（环色），再把内圆盖回底色 —— 就得到一个空心圆环。
   * 外径约占格子 0.93，相邻环几乎相切，和参考图的印刷点阵一致。
   */
  function dotGrid(ctx, x, y, size, cell, opt) {
    opt = opt || {};
    var ring = opt.ring || '#C6C6C4';
    var hole = opt.hole || '#E4E4E2';
    var r = cell * (opt.radiusRatio != null ? opt.radiusRatio : 0.415);
    var lw = cell * (opt.widthRatio != null ? opt.widthRatio : 0.09);
    var ri = Math.max(0.2, r - lw);
    for (var gy = 0; gy < size; gy++) {
      for (var gx = 0; gx < size; gx++) {
        var cx = x + (gx + 0.5) * cell;
        var cy = y + (gy + 0.5) * cell;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = ring;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, ri, 0, Math.PI * 2);
        ctx.fillStyle = hole;
        ctx.fill();
      }
    }
  }

  /* ---------------- 面板 / 按钮 ---------------- */

  function panel(ctx, x, y, w, h, opt) {
    opt = opt || {};
    var r = opt.radius != null ? opt.radius : 16;
    ctx.save();
    if (opt.shadow !== false) {
      ctx.shadowColor = opt.shadowColor || 'rgba(23,26,31,0.10)';
      ctx.shadowBlur = opt.shadowBlur != null ? opt.shadowBlur : 12;
      ctx.shadowOffsetY = opt.shadowOffsetY != null ? opt.shadowOffsetY : 3;
    }
    fillRound(ctx, x, y, w, h, r, opt.fill || T.panel);
    ctx.restore();
    if (opt.edge !== false) {
      roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
      ctx.strokeStyle = opt.edgeColor || T.panelEdge;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /**
   * 胶囊按钮
   * @param opt {fill,color,icon,disabled,label,size}
   */
  function button(ctx, r, label, opt) {
    opt = opt || {};
    var fill = opt.fill || T.panel;
    if (opt.disabled) { fill = '#DCDFE4'; }
    ctx.save();
    if (!opt.disabled && opt.shadow !== false) {
      ctx.shadowColor = 'rgba(23,26,31,0.16)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
    }
    fillRound(ctx, r.x, r.y, r.w, r.h, opt.radius != null ? opt.radius : r.h / 2, fill);
    ctx.restore();

    var color = opt.color || T.text;
    if (opt.disabled) { color = '#A5AAB2'; }
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    var size = opt.size || Math.min(15, r.h * 0.34);
    if (opt.icon) {
      var iw = size * 1.25;
      drawIcon(ctx, opt.icon, cx - (label ? iw * 0.62 : 0), cy, size,
        opt.iconColor || color, { alpha: opt.disabled ? 0.5 : 1 });
      if (label) {
        text(ctx, label, cx + iw * 0.62, cy + 0.5, { size: size, color: color, weight: '600' });
      }
    } else if (label) {
      text(ctx, label, cx, cy + 0.5, { size: size, color: color, weight: '600' });
    }
    return r;
  }

  /* ---------------- 图标 ---------------- */

  function drawIcon(ctx, name, cx, cy, s, color, opt) {
    opt = opt || {};
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.6, s * 0.13);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (opt.alpha != null) { ctx.globalAlpha = opt.alpha; }

    if (name === 'back') {
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.28, cy - s * 0.52);
      ctx.lineTo(cx - s * 0.30, cy);
      ctx.lineTo(cx + s * 0.28, cy + s * 0.52);
      ctx.stroke();
    } else if (name === 'undo') {
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.06, s * 0.52, Math.PI * 0.72, Math.PI * 2.05);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.60, cy - s * 0.28);
      ctx.lineTo(cx - s * 0.18, cy - s * 0.30);
      ctx.lineTo(cx - s * 0.40, cy + s * 0.08);
      ctx.closePath();
      ctx.fill();
    } else if (name === 'reset') {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.52, Math.PI * 0.42, Math.PI * 2.02);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.36, cy - s * 0.50);
      ctx.lineTo(cx + s * 0.62, cy - s * 0.12);
      ctx.lineTo(cx + s * 0.16, cy - s * 0.20);
      ctx.closePath();
      ctx.fill();
    } else if (name === 'hint') {
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.12, s * 0.40, Math.PI * 0.82, Math.PI * 2.18);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.20, cy + s * 0.30);
      ctx.lineTo(cx + s * 0.20, cy + s * 0.30);
      ctx.moveTo(cx - s * 0.14, cy + s * 0.48);
      ctx.lineTo(cx + s * 0.14, cy + s * 0.48);
      ctx.moveTo(cx - s * 0.22, cy + s * 0.10);
      ctx.lineTo(cx + s * 0.22, cy + s * 0.10);
      ctx.stroke();
    } else if (name === 'lock') {
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.18, s * 0.26, Math.PI, Math.PI * 2);
      ctx.stroke();
      roundRect(ctx, cx - s * 0.42, cy - s * 0.18, s * 0.84, s * 0.62, s * 0.14);
      ctx.fill();
    } else if (name === 'check') {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.34, cy + s * 0.02);
      ctx.lineTo(cx - s * 0.08, cy + s * 0.30);
      ctx.lineTo(cx + s * 0.36, cy - s * 0.28);
      ctx.stroke();
    } else if (name === 'play') {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.28, cy - s * 0.40);
      ctx.lineTo(cx + s * 0.42, cy);
      ctx.lineTo(cx - s * 0.28, cy + s * 0.40);
      ctx.closePath();
      ctx.fill();
    } else if (name === 'clock') {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.52, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.28);
      ctx.lineTo(cx, cy + s * 0.02);
      ctx.lineTo(cx + s * 0.24, cy + s * 0.16);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 五角星 */
  function star(ctx, cx, cy, r, ratio, fill, empty) {
    var pts = [], i;
    for (i = 0; i < 10; i++) {
      var ang = -Math.PI / 2 + i * Math.PI / 5;
      var rr = (i % 2 === 0) ? r : r * ratio;
      pts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]);
    }
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (i = 1; i < pts.length; i++) { ctx.lineTo(pts[i][0], pts[i][1]); }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (empty) { ctx.strokeStyle = empty; ctx.lineWidth = 1.4; ctx.stroke(); }
    ctx.restore();
  }

  BF.draw = {
    FONT: FONT,
    roundRect: roundRect,
    fillRound: fillRound,
    withShadow: withShadow,
    text: text,
    block: block,
    tile: tile,
    slot: slot,
    boardFrame: boardFrame,
    dotGrid: dotGrid,
    panel: panel,
    button: button,
    icon: drawIcon,
    star: star,
    blockRadius: blockRadius
  };
})();
