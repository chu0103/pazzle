/**
 * save.js —— 存档（wx storage / localStorage 通用）
 * 按游戏分桶：每款游戏各自记录「通关星级 + 解锁进度」；每日挑战与设置全局共享。
 * 旧版存档（只有一款游戏）会自动迁移到 block 桶，不会丢进度。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.Save) { return; }

  var KEY = 'puzzle_arcade_save_v1';
  var DEFAULT_GAME = 'block';

  function newBucket() {
    return { cleared: {}, unlocked: 1 };   // { "3": 3 } -> 关卡: 星级
  }

  function defaults() {
    return {
      games: {},                            // { block: {cleared, unlocked}, logic: {...} }
      daily: { key: '', cleared: false, stars: 0 },
      settings: { vibrate: true }
    };
  }

  var Save = {
    data: null,

    load: function () {
      var raw = BF.platform.getStorage(KEY, null);
      var d = defaults();
      if (raw && typeof raw === 'object') {
        if (raw.games && typeof raw.games === 'object') {
          for (var k in raw.games) {
            if (!raw.games.hasOwnProperty(k)) { continue; }
            var src = raw.games[k] || {};
            d.games[k] = {
              cleared: (src.cleared && typeof src.cleared === 'object') ? src.cleared : {},
              unlocked: typeof src.unlocked === 'number' ? src.unlocked : 1
            };
          }
        } else if (raw.cleared && typeof raw.cleared === 'object') {
          // 旧格式：整个存档只有一款游戏 → 迁到 block 桶
          d.games[DEFAULT_GAME] = {
            cleared: raw.cleared,
            unlocked: typeof raw.unlocked === 'number' ? raw.unlocked : 1
          };
        }
        if (raw.daily && typeof raw.daily === 'object') { d.daily = raw.daily; }
        if (raw.settings && typeof raw.settings === 'object') {
          d.settings = { vibrate: raw.settings.vibrate !== false };
        }
      }
      this.data = d;
      return d;
    },

    flush: function () {
      BF.platform.setStorage(KEY, this.data);
    },

    /** 取某款游戏的存档桶（没有就建一个） */
    bucket: function (game) {
      var g = game || DEFAULT_GAME;
      if (!this.data.games[g]) { this.data.games[g] = newBucket(); }
      return this.data.games[g];
    },

    isCleared: function (game, n) { return !!this.bucket(game).cleared[String(n)]; },

    starsOf: function (game, n) { return this.bucket(game).cleared[String(n)] || 0; },

    unlockedOf: function (game) { return this.bucket(game).unlocked; },

    clear: function (game, n, stars) {
      var b = this.bucket(game), k = String(n);
      if (!b.cleared[k] || b.cleared[k] < stars) { b.cleared[k] = stars; }
      if (n + 1 > b.unlocked) { b.unlocked = n + 1; }
      this.flush();
    },

    clearedCount: function (game) {
      var b = this.bucket(game), c = 0;
      for (var k in b.cleared) { if (b.cleared.hasOwnProperty(k)) { c++; } }
      return c;
    },

    totalStars: function (game) {
      var b = this.bucket(game), s = 0;
      for (var k in b.cleared) { if (b.cleared.hasOwnProperty(k)) { s += b.cleared[k]; } }
      return s;
    },

    /* 合集合计（首页用） */
    countAll: function () {
      var c = 0;
      for (var k in this.data.games) {
        if (this.data.games.hasOwnProperty(k)) { c += this.clearedCount(k); }
      }
      return c;
    },

    starsAll: function () {
      var s = 0;
      for (var k in this.data.games) {
        if (this.data.games.hasOwnProperty(k)) { s += this.totalStars(k); }
      }
      return s;
    },

    dailyKey: function () {
      return BF.util.dateKey(new Date());
    },

    isDailyDoneToday: function () {
      return this.data.daily.key === this.dailyKey() && this.data.daily.cleared;
    },

    clearDaily: function (stars) {
      this.data.daily = { key: this.dailyKey(), cleared: true, stars: stars };
      this.flush();
    },

    resetAll: function () {
      this.data = defaults();
      this.flush();
    }
  };

  BF.Save = Save;
})();
