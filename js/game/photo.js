/**
 * photo.js —— 第 3 款游戏「照片拼图」
 *
 * 玩法：一张照片切成 N×N，碎片打乱后散在托盘里，拖回正确格子把照片拼回去。
 * 和前两款最大的区别是**判定更严格**：不仅要把棋盘填满，每块还必须回到
 * 它原本所在的格子（puzzle.strict = true，见 Model.isSolved）。
 *
 * 切片坐标用**归一化**的 u/v/uw/vh（0~1）而不是像素：
 * 这样任意尺寸、任意来源（内置图 / 相册选的图）都能用同一套渲染代码。
 *
 * 图片是异步加载的，所以关卡拿到的是 src，真正的 Image 对象由 BF.Photos 统一管。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.photoGen) { return; }
  var U = BF.util;

  /* ---------------- 图片仓库 ---------------- */
  var Photos = {
    /** 内置图清单，由 tools/process_photos.py 生成（js/game/photoAssets.js） */
    list: BF.PHOTO_ASSETS || [],
    cache: {},        // 解析后的 URL -> Image
    failed: {},       // 加载失败过的 URL，别反复重试
    custom: null,     // 用户从相册选的图：{ src, color }
    /**
     * 资源根路径前缀。
     * 小游戏里为空 —— src 相对"包根"解析（assets/photo/p1.jpg 就在包根下）。
     * 浏览器预览/视觉快照页在子目录里（preview/、test/），同一份 src 会被解析成
     * test/assets/photo/... 而 404，所以这两处把 base 设为 '../' 指回项目根。
     */
    base: '',

    /**
     * 禁用图片加载的开关。
     * 仅给"视觉快照页在 file:// 下打开"这种场景用：画过图片的画布会被判跨源污染，
     * toDataURL 会抛 SecurityError，而且**一旦污染就整块画布永久不能导出** ——
     * 连方块/逻辑的快照都会被连累。置 true 后图片一律不加载，画布保持干净，
     * 照片拼图退化成色块兜底（用 http 打开快照页就能看到真实照片）。
     */
    blocked: false,

    /** 把清单里的相对路径补成当前宿主下能直接用的 URL（绝对 URL / data / blob 原样返回） */
    resolve: function (src) {
      if (!src) { return src; }
      if (/^(https?:|data:|blob:|wxfile:|file:|\/)/i.test(src)) { return src; }
      return (this.base || '') + src;
    },

    /** 取一张图（带缓存）。cb(err, img) */
    get: function (src, cb) {
      var self = this;
      if (!src) { cb(new Error('没有图片源')); return; }
      if (this.blocked) { cb(new Error('图片加载已禁用')); return; }
      var url = this.resolve(src);
      if (this.cache[url]) { cb(null, this.cache[url]); return; }
      if (this.failed[url]) { cb(new Error('图片加载失败: ' + url)); return; }
      if (!BF.platform || !BF.platform.createImage) {
        cb(new Error('当前宿主不支持加载图片'));
        return;
      }
      BF.platform.createImage(url, function (err, img) {
        if (err || !img) {
          self.failed[url] = 1;
          cb(err || new Error('图片加载失败'));
          return;
        }
        self.cache[url] = img;
        cb(null, img);
      });
    },

    /** 全部候选图：内置 + 用户选的（选的排前面，让玩家立刻看到自己那张） */
    all: function () {
      var out = [];
      if (this.custom) { out.push(this.custom); }
      for (var i = 0; i < this.list.length; i++) { out.push(this.list[i]); }
      return out;
    },

    /** 按关卡挑一张图：相邻关尽量不同图，同一关永远是同一张（seed 决定） */
    pick: function (n, rng) {
      var pool = this.all();
      if (!pool.length) { return null; }
      var i = ((n - 1) + Math.floor(rng() * 3)) % pool.length;
      if (this.custom && n === 1) { i = 0; }      // 第 1 关优先用玩家自己选的图
      return pool[i];
    },

    /** 从相册选一张。选到后放进 custom，后续关卡立刻可用 */
    choose: function (cb) {
      var self = this;
      if (!BF.platform || !BF.platform.chooseImage) {
        cb(new Error('当前宿主不支持选图'));
        return;
      }
      BF.platform.chooseImage(function (err, src) {
        if (err || !src) { cb(err || new Error('已取消')); return; }
        self.get(src, function (e2, img) {
          if (e2) { cb(e2); return; }
          self.custom = { src: src, color: '#8A8F98' };
          cb(null, self.custom);
        });
      });
    }
  };

  /* ---------------- 难度曲线 ---------------- */
  // 3×3 起步当教学，逐级升到 8×8。每档的关数按"手感"分配：
  // 小棋盘少几关（很快就没挑战），大棋盘多几关（够玩）。
  var BANDS = [
    { size: 3, from: 1,  to: 8  },
    { size: 4, from: 9,  to: 18 },
    { size: 5, from: 19, to: 30 },
    { size: 6, from: 31, to: 42 },
    { size: 7, from: 43, to: 52 },
    { size: 8, from: 53, to: 60 }
  ];

  var TOTAL = 60;

  function spec(n) {
    n = Math.max(1, Math.round(n));
    var band = BANDS[BANDS.length - 1];
    for (var i = 0; i < BANDS.length; i++) {
      if (n >= BANDS[i].from && n <= BANDS[i].to) { band = BANDS[i]; break; }
    }
    return { size: band.size, seed: 330000 + n * 7919 };
  }

  function layout(seed, n) {
    var s = spec(n);
    var size = s.size;
    var rng = U.mulberry32(s.seed);
    var photo = Photos.pick(n, rng) || { src: '', color: '#8A8F98' };

    var pieces = [], i;
    for (i = 0; i < size * size; i++) {
      var col = i % size, row = Math.floor(i / size);
      pieces.push({
        id: i,
        w: 1, h: 1,
        x: col, y: row,                 // 标准答案坐标 = 它在照片里的位置
        u: col / size, v: row / size,   // 归一化切片区域（不依赖图片真实像素）
        uw: 1 / size, vh: 1 / size,
        color: photo.color
      });
    }

    var order = pieces.map(function (p) { return p.id; });
    U.shuffle(order, rng);

    return {
      size: size,
      area: size * size,
      pieces: pieces,
      order: order,
      count: pieces.length,
      seed: s.seed,
      strict: true,                     // 必须回到原位才算过关
      photo: photo
    };
  }

  var Levels = {
    TOTAL: TOTAL,
    spec: spec,
    build: function (n) { return layout(spec(n).seed, n); },
    buildDaily: function (date) {
      var d = date || new Date();
      var seed = U.seedFromDate(d) % 2147483647;
      var rng = U.mulberry32(seed);
      var pool = Photos.all();
      var photo = pool.length ? pool[seed % pool.length] : { src: '', color: '#8A8F98' };
      var size = 5;
      var pieces = [], i;
      for (i = 0; i < size * size; i++) {
        var col = i % size, row = Math.floor(i / size);
        pieces.push({
          id: i, w: 1, h: 1, x: col, y: row,
          u: col / size, v: row / size, uw: 1 / size, vh: 1 / size,
          color: photo.color
        });
      }
      var order = pieces.map(function (p) { return p.id; });
      U.shuffle(order, rng);
      return {
        size: size, area: size * size, pieces: pieces, order: order,
        count: pieces.length, seed: seed, strict: true, photo: photo, daily: true
      };
    }
  };

  BF.photoGen = { layout: layout, spec: spec };
  BF.Photos = Photos;

  /* ---------------- 注册进合集 ---------------- */
  var games = BF.games || (BF.games = {});
  games.photo = {
    id: 'photo',
    // 「玩法说明」弹框（BF.RuleTip）：每次进这款游戏的第一个关卡时弹一次，
    // 玩家勾选「不再提示」后写入 Save.extra(id,'noRule')，之后不再弹。
    rules: {
      sub: '把打乱的照片拼回去',
      lines: [
        '照片被切成碎片打乱了',
        '拖动碎片放回正确位置',
        '拼合成完整照片即过关',
      ]
    },
    title: '照片拼图',
    sub: '把打乱的照片拼回去',
    skin: 'photo',
    TOTAL: TOTAL,
    // 难度档位（3×3 起步 → 8×8）。关卡选择页用它画"难度"快捷入口，
    // firstLevelOfSize 把某个网格尺寸映射到该档第一关，点一下直接进对应难度。
    bands: BANDS,
    difficulties: BANDS.map(function (b) { return b.size; }),
    firstLevelOfSize: function (size) {
      for (var i = 0; i < BANDS.length; i++) {
        if (BANDS[i].size === size) { return BANDS[i].from; }
      }
      return 1;
    },
    build: function (n) { return Levels.build(n); },
    buildDaily: function (d) { return Levels.buildDaily(d); }
  };
})();
