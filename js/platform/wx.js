/**
 * platform/wx.js —— 微信小游戏环境适配层
 * 把 wx 的 canvas / 触摸 / 存储 / 震动 统一成 BF.platform，
 * 让上层玩法代码完全不感知宿主环境。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});

  var sys = wx.getSystemInfoSync();
  var dpr = Math.min(3, sys.pixelRatio || 2);
  var W = sys.windowWidth || sys.screenWidth;
  var H = sys.windowHeight || sys.screenHeight;

  var canvas = wx.createCanvas();
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);

  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  var safe = sys.safeArea || { top: 0, bottom: H };
  var safeTop = Math.max(safe.top || 0, (sys.statusBarHeight || 0));
  var safeBottom = Math.max(0, H - (safe.bottom != null ? safe.bottom : H));

  var raf = (typeof requestAnimationFrame !== 'undefined')
    ? requestAnimationFrame
    : function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); };

  BF.platform = {
    isMiniGame: true,
    ready: true,
    canvas: canvas,
    ctx: ctx,
    width: W,
    height: H,
    dpr: dpr,
    safeTop: safeTop,
    safeBottom: safeBottom,

    now: function () { return Date.now(); },
    requestFrame: function (cb) { raf(cb); },

    getStorage: function (key, def) {
      try {
        var v = wx.getStorageSync(key);
        if (v === '' || v === null || v === undefined) { return def; }
        return v;
      } catch (e) { return def; }
    },
    setStorage: function (key, val) {
      try { wx.setStorageSync(key, val); } catch (e) { /* 忽略 */ }
    },

    vibrate: function (kind) {
      try {
        if (kind === 'heavy') { wx.vibrateLong(); } else { wx.vibrateShort({ type: 'light' }); }
      } catch (e) { /* 忽略 */ }
    },

    bindPointer: function (h) {
      wx.onTouchStart(function (e) {
        var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
        if (t) { h.down(t.clientX, t.clientY); }
      });
      wx.onTouchMove(function (e) {
        var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
        if (t) { h.move(t.clientX, t.clientY); }
      });
      wx.onTouchEnd(function (e) {
        var t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
        if (t) { h.up(t.clientX, t.clientY); } else { h.up(-10000, -10000); }
      });
      wx.onTouchCancel(function (e) {
        var t = (e.changedTouches && e.changedTouches[0]) || null;
        // 拿不到触点坐标时，不要用 (0,0) 冒充"抬起" —— 那是屏幕左上角，
        // 正好压在返回按钮上，会被当成一次真实点击。
        // 用一个远在屏幕外的坐标，让所有命中判定自然落空，效果等同"取消这次交互"。
        h.up(t ? t.clientX : -10000, t ? t.clientY : -10000);
      });
    },

    // 小游戏里保持屏幕常亮，避免玩到一半息屏
    keepScreenOn: function () {
      try { wx.setKeepScreenOn({ keepScreenOn: true }); } catch (e) { /* 忽略 */ }
    },

    /**
     * 加载一张图片（异步）。照片拼图要用，别的地方不用。
     * 统一成回调形式，是为了让浏览器端能写同样的签名。
     */
    createImage: function (src, cb) {
      try {
        var img = wx.createImage();
        img.onload = function () { if (cb) { cb(null, img); } };
        img.onerror = function () { if (cb) { cb(new Error('图片加载失败: ' + src)); } };
        img.src = src;
        return img;
      } catch (e) {
        if (cb) { cb(e); }
        return null;
      }
    },

    /**
     * 从相册选一张图，回调拿到临时路径。
     * ⚠ 需要后台「用户隐私保护指引」里声明相册权限，否则真机上会静默失败。
     */
    chooseImage: function (cb) {
      try {
        if (wx.chooseMedia) {
          wx.chooseMedia({
            count: 1, mediaType: ['image'], sizeType: ['compressed'],
            sourceType: ['album', 'camera'],
            success: function (res) {
              var f = res.tempFiles && res.tempFiles[0];
              if (f && f.tempFilePath) { cb(null, f.tempFilePath); }
              else { cb(new Error('没有取到图片路径')); }
            },
            fail: function (e) { cb(e || new Error('已取消')); }
          });
          return;
        }
        wx.chooseImage({
          count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'],
          success: function (res) {
            var p = res.tempFilePaths && res.tempFilePaths[0];
            if (p) { cb(null, p); } else { cb(new Error('没有取到图片路径')); }
          },
          fail: function (e) { cb(e || new Error('已取消')); }
        });
      } catch (e) { cb(e); }
    }
  };
})();
