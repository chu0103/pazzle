/**
 * app.js —— 场景管理 + 主循环
 * 新增一个游戏 = 注册一个场景 + 在 home.js 加一张卡片，互不影响。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.App) { return; }

  var App = {
    scenes: {},
    current: null,
    currentName: '',
    last: 0,
    err: 0,

    init: function () {
      var pf = BF.platform;
      BF.Save.load();
      this.scenes = {
        home: new BF.SceneHome(this),
        levels: new BF.SceneLevels(this),
        play: new BF.ScenePlay(this)
      };
      this.last = pf.now();
      this.go('home');
    },

    register: function (name, scene) {
      this.scenes[name] = scene;
    },

    go: function (name, params) {
      var s = this.scenes[name];
      if (!s) { return; }
      this.current = s;
      this.currentName = name;
      if (s.enter) { s.enter(params || {}); }
    },

    start: function () {
      var self = this;
      BF.platform.bindPointer({
        down: function (x, y) { if (self.current && self.current.onDown) { self.current.onDown(x, y); } },
        move: function (x, y) { if (self.current && self.current.onMove) { self.current.onMove(x, y); } },
        up: function (x, y) { if (self.current && self.current.onUp) { self.current.onUp(x, y); } }
      });

      function frame() {
        var now = BF.platform.now();
        var dt = now - self.last;
        if (!(dt >= 0) || dt > 48) { dt = 48; }
        self.last = now;
        var ctx = BF.platform.ctx;
        var failed = null;

        try {
          if (self.current && self.current.update) { self.current.update(dt); }
        } catch (e) { failed = e; }

        // save / render / restore 三段分开处理，任何一段抛错都不能让主循环断掉。
        // 尤其 ctx.save() 必须包在 try 里：画布状态栈满了它自己就会抛错，
        // 若任其逃出 frame()，requestFrame 就不会被调用 —— 那才是真正的"整屏卡死"。
        var saved = false;
        try {
          ctx.save();
          saved = true;
          if (!failed) {
            if (self.current && self.current.render) { self.current.render(ctx); }
          }
        } catch (e2) { if (!failed) { failed = e2; } }
        if (saved) { try { ctx.restore(); } catch (e3) { /* 状态栈已异常，忽略 */ } }

        if (failed) {
          self.err++;
          if (typeof console !== 'undefined') { console.error(failed); }
          // 连续出错说明画布状态已被污染（常见于某个绘制原语漏了 restore、状态栈溢出），
          // 这里主动把状态栈拉回基线，保证下一帧还有机会正常画出来。
          if (self.err >= 3) { self.recoverCanvas(ctx); }
          try { self.drawErrorBanner(ctx, failed); } catch (e4) { /* 兜底：画不出也不能让循环停 */ }
        } else if (self.err) {
          self.err = 0;   // 恢复正常，清掉计数
        }

        // 无论如何都要排下一帧：主循环一停，整个游戏就"卡死"了
        BF.platform.requestFrame(frame);
      }
      BF.platform.requestFrame(frame);
    },

    /**
     * 把画布状态栈拉回基线。
     * 某个绘制原语漏掉 restore 时，泄漏会逐帧累积，真机状态栈满了之后连 ctx.save()
     * 都会抛错——表现就是画面瞬间错乱、之后再也不刷新。这里把多余的层弹掉，
     * 再把变换/透明度/阴影重置一遍，游戏就能自己缓过来。
     */
    recoverCanvas: function (ctx) {
      var pf = BF.platform;
      var resetOk = false;
      if (typeof ctx.reset === 'function') {
        try { ctx.reset(); resetOk = true; } catch (e0) { resetOk = false; }
      }
      if (!resetOk) {
        // 老机型没有 reset（或 reset 本身失败）：逐层把多出来的状态弹掉。
        // 空栈上 restore 是安全空操作，所以多弹几次没有副作用。
        for (var i = 0; i < 128; i++) {
          try { ctx.restore(); } catch (e1) { break; }
        }
      }
      try {
        if (typeof ctx.setTransform === 'function') { ctx.setTransform(pf.dpr, 0, 0, pf.dpr, 0, 0); }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.shadowColor = 'rgba(0,0,0,0)';
      } catch (e2) { /* 忽略 */ }
    },

    /**
     * 出错时把信息画在屏幕上（真机调试时很有用，别让画面直接黑掉、更别静默卡死）。
     * 这里先主动把画布状态拉回基线 —— 出错往往伴随着 save/restore 失配，
     * 不重置的话这段提示自己也会被错误的变换/透明度/裁剪吃掉，屏幕上只剩一条没有文字的色块。
     */
    drawErrorBanner: function (ctx, e) {
      var pf = BF.platform;
      var lines = ['运行异常 #' + this.err + '（请截图这一条反馈）'];
      lines.push(String((e && e.message) || e).slice(0, 72));
      var st = String((e && e.stack) || '').split('\n')[1] || '';
      if (st) { lines.push(st.trim().slice(0, 72)); }
      var sc = this.current;
      // 版本号一并打出来：真机排查第一件事就是确认这台机器跑的是哪一版
      var where = 'v' + BF.VERSION + '  场景: ' + this.currentName;
      if (sc && sc.level) { where += ' 第' + sc.level + '关'; }
      if (sc && sc.game) { where += ' (' + sc.game + ')'; }
      lines.push(where + '  err=' + this.err);

      try {
        try { ctx.setTransform(pf.dpr, 0, 0, pf.dpr, 0, 0); } catch (e1) { /* 忽略 */ }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.shadowColor = 'rgba(0,0,0,0)';

        var h = 26 + lines.length * 16;
        ctx.fillStyle = 'rgba(201,70,63,0.94)';
        ctx.fillRect(0, pf.height - h, pf.width, h);
        for (var i = 0; i < lines.length; i++) {
          ctx.font = (i === 0 ? '700 ' : '') + (i === 0 ? 13 : 11) + 'px -apple-system, "PingFang SC", sans-serif';
          ctx.fillStyle = i === 0 ? '#FFFFFF' : '#FFE6E4';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(lines[i], 12, pf.height - h + 8 + i * 16);
        }
      } catch (e2) { /* 忽略 */ }
    }
  };

  BF.App = App;

  // 环境就绪后自动启动
  if (BF.platform && BF.platform.ready !== false) {
    App.init();
    App.start();
  } else if (BF.platform) {
    BF.platform.onReady(function () { App.init(); App.start(); });
  }
})();
