/**
 * palette.js —— 配色与主题
 * 方块颜色取自参考图（黄 / 红 / 白 / 蓝 / 墨黑）+ 3 个补充色，
 * 保证同色块不相邻、整体像一张干净的拼图。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.theme) { return; }

  BF.theme = {
    bg: '#EFF1F4',
    bgTop: '#F8F9FB',
    panel: '#FFFFFF',
    panelEdge: 'rgba(23,26,31,0.07)',

    text: '#2C3036',
    textSub: '#8B9199',
    textOnDark: '#FFFFFF',

    boardFrameTop: '#B7BDC5',
    boardFrameBottom: '#9BA1A9',
    boardInner: '#FBFBFC',
    slot: '#E3E7EC',
    slotEdge: 'rgba(23,26,31,0.06)',
    slotShadow: 'rgba(23,26,31,0.13)',

    tray: '#DFE3E8',
    accent: '#3E6FBF',
    accentDeep: '#315A9E',   // 主色按下态
    ok: '#4E9C63',
    warn: '#C9463F',
    gold: '#F2C13C',

    shadow: 'rgba(23,26,31,0.20)',
    scrim: 'rgba(24,27,32,0.55)'
  };

  // 每个颜色都带一个 ink（用于在色块上写数字/图标时的前景色）
  BF.COLORS = [
    { name: 'yellow', base: '#F2D340', ink: '#5A4700' },
    { name: 'red',    base: '#C9463F', ink: '#FFFFFF' },
    { name: 'white',  base: '#E8EAEE', ink: '#3A3D42' },
    { name: 'blue',   base: '#3E6FBF', ink: '#FFFFFF' },
    { name: 'ink',    base: '#34383E', ink: '#FFFFFF' },
    { name: 'orange', base: '#E08A3C', ink: '#FFFFFF' },
    { name: 'green',  base: '#4E9C63', ink: '#FFFFFF' },
    { name: 'purple', base: '#8A6BC1', ink: '#FFFFFF' }
  ];

  BF.colorOf = function (i) {
    return BF.COLORS[((i % BF.COLORS.length) + BF.COLORS.length) % BF.COLORS.length];
  };

  /* ---------------- 游戏 2「逻辑拼图」配色 ---------------- */
  // 全部按参考图取样：白 / 黄 / 蓝 / 红 + 墨黑固定块 + 灰底圆环点阵
  BF.LOGIC_COLORS = [
    { name: 'white',  base: '#FFFFFF', ink: '#3A3D42' },
    { name: 'yellow', base: '#F2CE45', ink: '#6B5400' },
    { name: 'blue',   base: '#4079C4', ink: '#FFFFFF' },
    { name: 'red',    base: '#CE3F47', ink: '#FFFFFF' }
  ];

  BF.LOGIC_THEME = {
    fixed: '#3C3F45',        // 固定块：墨黑，开局就位、不可拖动
    boardBg: '#EDEDEB',      // 点阵棋盘底色
    dotRing: '#BBBBB9',      // 圆环描边
    dotHole: '#E7E7E5',      // 圆环内部（比底色略沉，做出"凹点"感）
    frameTop: '#B6B8B2',     // 棋盘外框（灰塑料托盘）
    frameBottom: '#9A9C96',
    tray: '#DDDFDA',         // 下方托盘
    holeHint: '#B9BBB6'      // 悬停落点提示
  };

  BF.logicColorOf = function (i) {
    var n = BF.LOGIC_COLORS.length;
    return BF.LOGIC_COLORS[((i % n) + n) % n];
  };
})();
