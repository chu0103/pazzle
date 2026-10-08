/**
 * platform/browser.js —— 浏览器预览环境适配层
 * 逻辑与 wx 完全一致，只是把输入换成鼠标/触摸事件、存储换成 localStorage。
 * 这样同一份玩法代码可以在电脑上先调好，再原样丢进小游戏。
 */
(function () {
  var G = typeof window !== 'undefined' ? window : globalThis;
  var BF = G.BF || (G.BF = {});

  var stage = document.getElementById('stage');
  var canvas = document.getElementById('game');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'game';
    stage.insertBefore(canvas, stage.firstChild);
  }

  // 逻辑尺寸 = 舞台 CSS 尺寸（手机比例），物理尺寸按 dpr 放大保证清晰
  var W = stage.clientWidth || 390;
  var H = stage.clientHeight || 844;
  var dpr = Math.min(3, window.devicePixelRatio || 2);

  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  var handlers = { down: null, move: null, up: null };
  var active = false;

  /**
   * 帧调度：优先 requestAnimationFrame；
   * 若 rAF 迟迟不回调（无头浏览器 / 后台标签页 / 部分低端 WebView 会这样），
   * 自动退化成 setTimeout 驱动，避免画面直接白屏。
   */
  var pendingCb = null;
  var frameSeen = 0;
  var rafBroken = false;
  var watchStarted = false;

  function schedule(cb) {
    pendingCb = cb;
    if (rafBroken) {
      setTimeout(function () {
        var f = pendingCb; pendingCb = null;
        if (f) { f(); }
      }, 16);
      return;
    }
    window.requestAnimationFrame(function () {
      if (rafBroken) { return; }          // 已切兜底，避免双循环
      frameSeen = Date.now();
      var f = pendingCb; pendingCb = null;
      if (f) { f(); }
    });
    if (!watchStarted) {
      watchStarted = true;
      setTimeout(function () {
        if (Date.now() - frameSeen > 300) {
          rafBroken = true;
          var f = pendingCb; pendingCb = null;
          if (f) { f(); }
        }
      }, 350);
    }
  }

  function toLocal(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) / r.width * W,
      y: (clientY - r.top) / r.height * H
    };
  }

  canvas.addEventListener('mousedown', function (e) {
    active = true;
    var p = toLocal(e.clientX, e.clientY);
    if (handlers.down) { handlers.down(p.x, p.y); }
  });
  window.addEventListener('mousemove', function (e) {
    if (!active) { return; }
    var p = toLocal(e.clientX, e.clientY);
    if (handlers.move) { handlers.move(p.x, p.y); }
  });
  window.addEventListener('mouseup', function (e) {
    if (!active) { return; }
    active = false;
    var p = toLocal(e.clientX, e.clientY);
    if (handlers.up) { handlers.up(p.x, p.y); }
  });

  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    var t = e.touches[0], p = toLocal(t.clientX, t.clientY);
    if (handlers.down) { handlers.down(p.x, p.y); }
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    var t = e.touches[0], p = toLocal(t.clientX, t.clientY);
    if (handlers.move) { handlers.move(p.x, p.y); }
  }, { passive: false });
  canvas.addEventListener('touchend', function (e) {
    e.preventDefault();
    var t = e.changedTouches[0], p = toLocal(t.clientX, t.clientY);
    if (handlers.up) { handlers.up(p.x, p.y); }
  }, { passive: false });

  BF.platform = {
    isMiniGame: false,
    ready: true,
    canvas: canvas,
    ctx: ctx,
    width: W,
    height: H,
    dpr: dpr,
    safeTop: 0,
    safeBottom: 0,

    now: function () { return (window.performance && performance.now) ? performance.now() : Date.now(); },
    requestFrame: function (cb) { schedule(cb); },

    getStorage: function (key, def) {
      try {
        var v = window.localStorage.getItem(key);
        if (!v) { return def; }
        return JSON.parse(v);
      } catch (e) { return def; }
    },
    setStorage: function (key, val) {
      try { window.localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 忽略 */ }
    },

    vibrate: function (kind) {
      if (navigator.vibrate) { navigator.vibrate(kind === 'heavy' ? 30 : 10); }
    },

    bindPointer: function (h) {
      handlers.down = h.down; handlers.move = h.move; handlers.up = h.up;
    },

    /** 加载一张图片（异步）。签名和 wx 端一致，玩法层不用区分宿主 */
    createImage: function (src, cb) {
      var img = new Image();
      img.onload = function () { if (cb) { cb(null, img); } };
      img.onerror = function () { if (cb) { cb(new Error('图片加载失败: ' + src)); } };
      img.src = src;
      return img;
    },

    /** 浏览器端用 <input type=file> 模拟"从相册选一张"，回调给出可用作 img.src 的 URL */
    chooseImage: function (cb) {
      try {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', function () {
          var f = input.files && input.files[0];
          try { document.body.removeChild(input); } catch (e) { /* 忽略 */ }
          if (!f) { cb(new Error('已取消')); return; }
          cb(null, URL.createObjectURL(f));
        });
        input.click();
      } catch (e) { cb(e); }
    }
  };

  // 窗口尺寸变化（旋转 / 拖动窗口）→ 重建画布并让当前场景重新布局
  window.addEventListener('resize', function () {
    var nw = stage.clientWidth, nh = stage.clientHeight;
    if (Math.abs(nw - W) < 2 && Math.abs(nh - H) < 2) { return; }
    W = nw; H = nh;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    BF.platform.width = W;
    BF.platform.height = H;
    if (BF.App && BF.App.current && BF.App.current.layout) { BF.App.current.layout(); }
  });
})();
