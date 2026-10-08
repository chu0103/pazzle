/**
 * ns.js —— 全局命名空间 + 通用工具
 * 同一份代码同时跑在「微信小游戏(GameGlobal)」与「浏览器(window)」里，
 * 所以每个模块都挂到统一的 BF 命名空间上，不使用 ES Module。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.util) { return; }
  // 0.2.0：修复 draw.block() 漏 restore 导致画布状态栈溢出、玩一会儿就整屏卡死的问题。
  // 首页右上角（统计行下方）会显示这个版本号，出错时的红色提示条上也会带上，
  // 真机上一眼就能确认跑的是哪一版。
  BF.VERSION = '0.2.0';

  // 老引擎没有 Math.imul 时的兜底
  var imul = Math.imul || function (a, b) {
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff;
    var bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
    return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
  };

  /** 确定性伪随机（同一 seed 永远同一串数）→ 每日挑战、关卡可复现 */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = imul(a ^ (a >>> 15), 1 | a);
      t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  /** amt > 0 变亮，amt < 0 变暗 */
  function shade(hex, amt) {
    var c = hexToRgb(hex);
    function f(v) { return Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)); }
    return 'rgb(' + f(c.r) + ',' + f(c.g) + ',' + f(c.b) + ')';
  }
  function rgba(hex, a) {
    var c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }

  function pointInRect(px, py, r) {
    return !!r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  /** 两个矩形是否相交。布局类 bug（文字叠字）用它写成断言，比肉眼看截图可靠 */
  function rectsOverlap(a, b) {
    if (!a || !b) { return false; }
    return a.x < b.x + b.w && b.x < a.x + a.w &&
           a.y < b.y + b.h && b.y < a.y + a.h;
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** 20260930 形式，用作「每日挑战」的 seed */
  function seedFromDate(d) {
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function dateKey(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  BF.util = {
    mulberry32: mulberry32,
    clamp: clamp,
    lerp: lerp,
    easeOutCubic: easeOutCubic,
    easeInOutQuad: easeInOutQuad,
    hexToRgb: hexToRgb,
    shade: shade,
    rgba: rgba,
    pointInRect: pointInRect,
    rectsOverlap: rectsOverlap,
    shuffle: shuffle,
    seedFromDate: seedFromDate,
    dateKey: dateKey
  };
})();
