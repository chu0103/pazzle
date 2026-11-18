/**
 * pk24.js —— 「24点」关卡生成器 + 注册（游戏 13）
 *
 * 玩法：随机发 4 张牌（A=1、J/Q/K=11/12/13），用 + − × ÷ 把 4 个数算成 24，
 * 每张牌必须用且只用一次。减/除按点击顺序算（先点的当被减/被除数）。
 *
 * 关键约束（生成器必须保证）：
 *   - 不是每副 4 张牌都能凑出 24（约 4/5 的可解副里还有一部分要靠分数）。
 *     本游戏**整除规则**：每一步合并的结果必须是正整数（除法只在能整除时进行），
 *     所以生成器用「玩家实际能做的整数合并」语义来判定可解——可解才发，否则重抽。
 *   - 玩家是**逐步合并**两张牌（点牌→点运算符→点另一张牌），这等价于把所有
 *     4 个数按任意二叉括号树 + 任意运算符组合，所以求解器枚举「任意两张当前牌做四则、
 *     递归到只剩一张」，完全覆盖玩家能做到的每一种算法。
 *
 * 无尽模式：不按固定关卡，每过一题随机发新副。build(n)/buildDaily() 仍提供确定性发牌
 * （供框架注册形态与每日挑战复用），场景自己用 randomDeal() 取无限随机副。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.Pk24Gen) { return; }
  var U = BF.util;

  var OPS = ['+', '-', '×', '÷'];
  var FACE = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
  // 花色：黑桃/梅花为黑，红桃/方块为红（仅原始牌做装饰，合并结果不画花色）
  var SUITS = [
    { ch: '♠', red: false },
    { ch: '♥', red: true },
    { ch: '♦', red: true },
    { ch: '♣', red: false }
  ];

  function face(v) { return FACE[v] || String(v); }

  /**
   * 单步四则（整除规则）：除法只在「除数非 0 且能整除」时合法，否则返回 null。
   * 减/除按参数顺序算（a 为被减/被除数），顺序由调用方根据点击先后决定。
   */
  function applyOp(a, b, op) {
    if (op === '+') { return a + b; }
    if (op === '-') { return a - b; }
    if (op === '×') { return a * b; }
    if (op === '÷') {
      if (b === 0) { return null; }
      if (a % b !== 0) { return null; }   // 整除才允许：分数在手机上既难画又难算
      return a / b;
    }
    return null;
  }

  /**
   * 递归合并求解：items 为当前「牌堆」（每张带值 v 与表达式 expr）。
   * 任意挑两张做四种运算，递归到只剩一张；若那张值为 24 即返回其表达式串（带括号、无歧义）。
   * 枚举所有有序对 (i≠j)，因此任意二叉括号树 + 任意叶子顺序 + 任意运算符都被覆盖。
   */
  function combine(items) {
    if (items.length === 1) {
      return items[0].v === 24 ? items[0].expr : null;
    }
    for (var i = 0; i < items.length; i++) {
      for (var j = 0; j < items.length; j++) {
        if (i === j) { continue; }
        var a = items[i], b = items[j];
        // 其余牌（按原顺序）作为新的牌堆
        var rest = [];
        for (var k = 0; k < items.length; k++) {
          if (k !== i && k !== j) { rest.push(items[k]); }
        }
        for (var o = 0; o < OPS.length; o++) {
          var r = applyOp(a.v, b.v, OPS[o]);
          if (r === null) { continue; }
          var ne = { v: r, expr: '(' + a.expr + OPS[o] + b.expr + ')' };
          rest.push(ne);
          var found = combine(rest);
          if (found) { return found; }
          rest.pop();
        }
      }
    }
    return null;
  }

  /** 返回一组合法解的表达式串（如 "((10×10-4)÷4)"），无解返回 null */
  function solve(vals) {
    var items = vals.map(function (v) { return { v: v, expr: String(v) }; });
    return combine(items);
  }

  /**
   * 返回达成 24 的**合并步骤序列**（供提示/测试驱动）：每步 { i, j, op } 中的 i/j
   * 是当前牌堆数组下标（a=牌 i，b=牌 j，结果追加到末尾），与场景 merge(i,op,j) 的下标语义一致，
   * 因此按序驱动场景即可真实通关。无解返回 null。
   */
  function solveSeq(vals) {
    function rec(items) {
      if (items.length === 1) { return items[0].v === 24 ? [] : null; }
      for (var i = 0; i < items.length; i++) {
        for (var j = 0; j < items.length; j++) {
          if (i === j) { continue; }
          var a = items[i], b = items[j];
          var rest = [];
          for (var k = 0; k < items.length; k++) { if (k !== i && k !== j) { rest.push(items[k]); } }
          for (var o = 0; o < OPS.length; o++) {
            var r = applyOp(a.v, b.v, OPS[o]);
            if (r === null) { continue; }
            rest.push({ v: r, expr: '' });
            var sub = rec(rest);
            if (sub !== null) { return [{ i: i, j: j, op: OPS[o] }].concat(sub); }
            rest.pop();
          }
        }
      }
      return null;
    }
    return rec(vals.map(function (v) { return { v: v, expr: String(v) }; }));
  }

  function solvable(vals) { return solve(vals) != null; }

  /** 用给定 rng（返回 [0,1)）抽 4 张牌，直到在整除语义下可解；兜底用经典可解副 */
  function makeDeal(rng) {
    for (var t = 0; t < 600; t++) {
      var vals = [];
      for (var i = 0; i < 4; i++) { vals.push(1 + Math.floor(rng() * 13)); }
      if (solvable(vals)) { return vals; }
    }
    return [4, 4, 10, 10];   // ((10×10-4)÷4) = 24，整除语义必可解
  }

  function dealFromSeed(seed) {
    return makeDeal(U.mulberry32((seed >>> 0) || 1));
  }

  function randomDeal() {
    // 无尽模式：用时间熵做种子，每副都不同
    return makeDeal(U.mulberry32((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0));
  }

  BF.Pk24Gen = {
    OPS: OPS,
    SUITS: SUITS,
    face: face,
    applyOp: applyOp,
    solve: solve,
    solveSeq: solveSeq,
    solvable: solvable,
    makeDeal: makeDeal,
    dealFromSeed: dealFromSeed,
    randomDeal: randomDeal
  };

  // 注册（无尽模式：TOTAL=0，不按关卡进度）
  var games = BF.games || (BF.games = {});
  games.pk24 = {
    id: 'pk24',
    title: '24点',
    sub: '凑出 24 · 加减乘除',
    skin: 'pk24',
    scene: 'pk24',
    TOTAL: 0,
    build: function (n) {
      return { cards: dealFromSeed((0x9e3779b1 ^ (n * 2654435761)) >>> 0) };
    },
    buildDaily: function () {
      return { cards: dealFromSeed(U.seedFromDate(new Date())) };
    },
    rules: {
      sub: '凑出 24 · 用加减乘除',
      lines: [
        '随机发 4 张牌，A=1、JQK=11/12/13',
        '每张牌必须用且只用一次',
        '点一张牌→点运算符→点另一张，合并',
        '减/除按点击顺序算（先点的先算）',
        '把 4 张牌都合成 24 就过关'
      ]
    }
  };
})();
