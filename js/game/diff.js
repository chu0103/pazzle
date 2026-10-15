/**
 * diff.js —— 第 4 款游戏「图片找不同」
 *
 * 玩法：上下并排两张几乎一样的图（A 为原图，B 有若干处改动），
 * 找出并点中 B 里每一处不同。找齐即过关。
 *
 * 与前三款最大的区别：**没有棋盘状态机**，不需要拖拽与占用判定，
 * 只需知道"哪儿不同"（差异矩形）以及"玩家点中了没有"。
 *
 * 差异位置在美术管线（tools/make_diff_pairs.py）里生成时就记录下来，
 * 用**归一化**矩形（u/v/uw/vh ∈ 0~1）写进清单 ——
 * 这样任意尺寸的图都能共用一套判定与渲染代码，和照片拼图同一思路。
 *
 * 图片是异步加载的，关卡只拿到 src，真正的 Image 由 BF.Diffs 统一管理。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.diffGen) { return; }
  var U = BF.util;

  /* ---------------- 图片仓库 ---------------- */
  var Diffs = {
    /** 内置图对清单，由 tools/make_diff_pairs.py 生成（js/game/diffAssets.js） */
    list: BF.DIFF_ASSETS || [],
    cache: {},        // 解析后的 URL -> Image
    failed: {},       // 加载失败过的 URL，别反复重试
    /**
     * 资源根路径前缀。小游戏里为空（src 相对包根解析）。
     * 浏览器预览/视觉快照页在子目录里（preview/、test/），要设成 '../' 指回项目根，
     * 否则 assets/diff/... 会被解析成 test/assets/diff/... 而 404。
     */
    base: '',
    /** 禁用图片加载（仅 file:// 快照页用：画过图片的画布会被判跨源污染而无法导出） */
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

    all: function () { return this.list; },

    /** 第 n 关用哪一对：按顺序取，保证同关永远同一对（可复现） */
    pick: function (n) {
      var pool = this.list;
      if (!pool.length) { return null; }
      return pool[(Math.max(1, Math.round(n)) - 1) % pool.length];
    }
  };

  var TOTAL = (BF.DIFF_ASSETS && BF.DIFF_ASSETS.length) || 60;

  function buildPair(pair, n, daily) {
    if (!pair) {
      return { level: n, a: '', b: '', color: '#8A8F98', w: 0, h: 0,
               diffs: [], total: 0, daily: !!daily };
    }
    // 复制差异矩形，避免上游对象被玩法层不小心改动
    var diffs = (pair.diffs || []).map(function (d) {
      return { u: d.u, v: d.v, uw: d.uw, vh: d.vh };
    });
    return {
      level: n,
      a: pair.a, b: pair.b, color: pair.color || '#8A8F98',
      w: pair.w || 0, h: pair.h || 0,
      diffs: diffs,
      total: diffs.length,
      daily: !!daily
    };
  }

  function build(n) {
    n = Math.max(1, Math.round(n));
    return buildPair(Diffs.pick(n), n, false);
  }

  function buildDaily(date) {
    var d = date || new Date();
    var rng = U.mulberry32(U.seedFromDate(d) % 2147483647);
    var pool = Diffs.list;
    if (!pool.length) { return build(1); }
    var idx = Math.floor(rng() * pool.length);
    return buildPair(pool[idx], idx + 1, true);
  }

  BF.diffGen = { build: build, buildDaily: buildDaily };
  BF.Diffs = Diffs;

  /* ---------------- 难度维度：一处不同 = 一档 ----------------
   * 关卡页顶部那排"难度"快捷入口 + 首页点进来的「难度自选首屏」靠这几个字段工作：
   *   difficulties    —— 有哪些档（不同处的数量）
   *   firstLevelOfSize—— 该档的第一关是第几关
   *   tierLevels     —— 该档包含哪些关卡号（⚠️ 不是连续区间！见下）
   *   pickInfo       —— 难度首屏档卡的副标题
   * 与照片拼图（网格尺寸）唯一的区别是 chipLabel：这里写"5 处"而不是"5×5"。
   *
   * ⚠️ 关卡是 `pool[(n-1) % pool.length]` 循环取图对的，所以同一"不同处数"的关
   * **散布在整条关卡线上**（第 1、第 1+len、第 1+2*len… 关），不是连续的一段。
   * 因此 tierLevels 必须显式枚举，难度首屏的进度/入口才能算对 ——
   * 直接按"第一关起连续 10 关"会把别的难度的关也算进这一档。
   */
  var COUNTS = [];
  for (var ci = 0; ci < TOTAL; ci++) {
    var cnt = (Diffs.list[ci] && Diffs.list[ci].diffs) ? Diffs.list[ci].diffs.length : 0;
    if (cnt && COUNTS.indexOf(cnt) < 0) { COUNTS.push(cnt); }
  }
  COUNTS.sort(function (a, b) { return a - b; });

  function firstLevelOfSize(cnt) {
    for (var i = 0; i < TOTAL; i++) {
      var it = Diffs.list[i];
      if (it && (it.diffs || []).length === cnt) { return i + 1; }
    }
    return 1;
  }

  /** 该难度（不同处数）包含哪些关卡号 */
  function tierLevels(cnt) {
    var out = [];
    for (var n = 1; n <= TOTAL; n++) {
      var it = Diffs.list[(n - 1) % Diffs.list.length];
      if (it && (it.diffs || []).length === cnt) { out.push(n); }
    }
    return out;
  }

  /* ---------------- 注册进合集 ---------------- */
  var games = BF.games || (BF.games = {});
  games.diff = {
    id: 'diff',
    // 「玩法说明」弹框（BF.RuleTip）：每次进这款游戏的第一个关卡时弹一次，
    // 玩家勾选「不再提示」后写入 Save.extra(id,'noRule')，之后不再弹。
    rules: {
      sub: '6 档 · 每图 3~8 处不同',
      lines: [
        '上下两图看起来一样，其实有几处不同',
        '点中下图里的每一处不同',
        '全部点中即过关',
      ]
    },
    title: '图片找不同',
    sub: '找出两图的不同之处',
    skin: 'diff',
    scene: 'diff',          // 玩法场景与前三款不同，关卡页据此路由
    TOTAL: TOTAL,
    difficulties: COUNTS,
    firstLevelOfSize: firstLevelOfSize,
    tierLevels: tierLevels,
    // 档卡主标题：difficulties 是数字，光写"3"玩家不知道是什么 → 补成"3 处"
    tierTitle: function (c) { return c + ' 处'; },
    chipLabel: function (c) { return c + ' 处'; },
    // 难度自选首屏（BF.DiffPick）档卡副标题
    pickInfo: function (idx, rg) {
      return { meta: '每图 ' + COUNTS[idx] + ' 处不同 · 共 ' + rg.count + ' 关' };
    },
    build: build,
    buildDaily: buildDaily
  };
})();
