/**
 * gen_blocks_levels.js —— 离线生成「超级积木」40 关并内联进 js/game/blocks.js
 *
 * 难度轴 = 颜色数 × 100 + 块数（档间严格递增）：
 *   入门 单色3块=103 → 进阶 单色4块=104 → 困难 双色4块=204 → 专家 双色5块=205。
 * 造题为「钉死块反向出题」，每关天然可解（sols≥1）；求解器用颜色组全部积木核可解性。
 */
var path = require('path');
var fs = require('fs');

var root = path.join(__dirname, '..');
global.BF = {};
require(path.join(root, 'js', 'core', 'ns.js'));
require(path.join(root, 'js', 'game', 'blocks.js'));

var U = BF.util, Gen = BF.BlocksGen, SIZE = Gen.SIZE;

/** base-36 字符串 → BigInt（JS 原生 BigInt() 解析不了 36 进制） */
function from36(s) {
  var v = 0n;
  for (var i = 0; i < s.length; i++) { v = v * 36n + BigInt(parseInt(s[i], 36)); }
  return v;
}

/* ---------------- 1) 收集候选 ---------------- */

function collect(n, count) {
  var tier = Gen.tierOf(n);
  var range = Gen.TIER_RANGE[tier];
  var groups = Gen.planFor(n);
  var cands = [], seen = {};
  var s = 12345 + n * 7919;
  for (var t = 0; t < count * 80 && cands.length < count; t++) {
    var rng = U.mulberry32((s + t * 104729) >>> 0);
    var p = Gen.generateOne(rng, groups);
    if (!p) { continue; }
    var cells = Gen.maskToCells(p.region).length;
    if (cells < range.cells[0] || cells > range.cells[1]) { continue; }
    if (p.sols < 1) { continue; }
    var key = p.region.toString(36);
    if (seen[key]) { continue; }
    seen[key] = 1;
    // 记录 generateOne 实际落子 placed（精确铺满 region 的掩码），
    // 用它反推标准解比贪心 decompose 更稳（贪心可能重新装不下）。
    cands.push({ region: key, cells: cells, sols: p.sols, chosen: p.chosen.slice(), placed: p.placed.slice() });
  }
  return cands;
}

/* ---------------- 2) 每档挑选（格数升序 + region 不重复） ---------------- */

function pickTier(ns) {
  // 同档 planFor 完全相同，pool 内容一致，只收集一次即可（更快、且保证档内不重复）
  var n0 = ns[0];
  var all = collect(n0, 400);
  if (all.length < ns.length) {
    throw new Error('档 ' + n0 + ' 候选不足（' + all.length + ' < ' + ns.length + '）');
  }
  all.sort(function (a, b) {
    return (a.cells - b.cells) || (a.region < b.region ? -1 : 1);
  });
  var m = ns.length, out = {};
  // 在 cells 升序的候选里均匀取 m 个 → 档内 cell 数有梯度（自然难度爬升），且 region 不重复
  for (var k = 0; k < m; k++) {
    var idx = (m === 1) ? 0 : Math.floor(k * (all.length - 1) / (m - 1));
    if (idx >= all.length) { idx = all.length - 1; }
    out[ns[k]] = all[idx];
  }
  return out;
}

var tiers = { 0: [], 1: [], 2: [], 3: [] };
for (var n = 1; n <= 40; n++) { tiers[Gen.tierOf(n)].push(n); }
var picked = {};
for (var t = 0; t < 4; t++) {
  var part = pickTier(tiers[t]);
  for (var key in part) { if (part.hasOwnProperty(key)) { picked[key] = part[key]; } }
}

/* ---------------- 3) 构建紧凑 LEVELS ---------------- */

var timedSet = {};
for (n = 10; n <= 40; n += 10) { timedSet[n] = true; }

var LEVELS = [];
for (n = 1; n <= 40; n++) {
  var pick = picked[n];
  var region = from36(pick.region);
  // 用 generateOne 实际落子 placed 反推标准解（精确铺满，绝不会装不下）
  var sol = pick.placed;
  var pieces = [];
  for (var i = 0; i < sol.length; i++) {
    var pp = Gen.placementToPiece(sol[i]);
    if (!pp) { throw new Error('关卡 ' + n + ' 反推放置失败'); }
    pieces.push({ i: pp.id, r: pp.rot, x: pp.x, y: pp.y });
  }
  var groups = Gen.planFor(n);
  var colors = groups.map(function (g) { return g.c; });
  var timed = !!timedSet[n];
  var tier = Gen.tierOf(n);
  LEVELS.push({
    r: pick.region,
    c: colors,
    p: pieces,
    s: pick.sols,
    t: timed ? 1 : 0,
    tl: timed ? (tier <= 1 ? 75 : (tier === 2 ? 100 : 120)) : 0
  });
}

/* ---------------- 4) 校验 ---------------- */

function difficulty(rec) { return rec.c.length * 100 + rec.p.length; }

function verify() {
  var ok = true;
  // 0) 形状库自检：16 块必须两两不同的自由多连块
  var dups = Gen.assertDistinctShapes();
  if (dups && dups.length) {
    console.error('SHAPES 存在重复自由块: ' + JSON.stringify(dups));
    ok = false;
  }
  for (n = 1; n <= 40; n++) {
    var rec = LEVELS[n - 1];
    var region = from36(rec.r);
    var cellsArr = Gen.maskToCells(region);
    if (cellsArr.length === 0) { console.error('L' + n + ' 空区域'); ok = false; }
    for (var ci = 0; ci < cellsArr.length; ci++) {
      if (cellsArr[ci][0] < 0 || cellsArr[ci][0] >= SIZE || cellsArr[ci][1] < 0 || cellsArr[ci][1] >= SIZE) {
        console.error('L' + n + ' 越界'); ok = false;
      }
    }
    var chosen = rec.p.map(function (q) { return q.i; });
    var pieceMasks = chosen.map(function (pid) { return Gen.PIECE_PLACE[pid]; });
    var sols = Gen.countSolutions(region, pieceMasks);
    if (sols < 1) { console.error('L' + n + ' 不可解 sols=' + sols); ok = false; }
    for (var pi = 0; pi < chosen.length; pi++) {
      var col = Gen.SHAPES[chosen[pi]].c;
      if (rec.c.indexOf(col) < 0) { console.error('L' + n + ' 颜色越界'); ok = false; }
    }
    var cover = 0n;
    for (var qi = 0; qi < rec.p.length; qi++) {
      var q = rec.p[qi];
      cover |= Gen.maskOf(Gen.PIECE_ROT[q.i][q.r], q.x, q.y);
    }
    if (cover !== region) { console.error('L' + n + ' 标准解未覆盖区域'); ok = false; }
  }
  // 档间难度严格递增
  for (var tt = 0; tt < 3; tt++) {
    var d1 = difficulty(LEVELS[tiers[tt][0] - 1]);
    var d2 = difficulty(LEVELS[tiers[tt + 1][0] - 1]);
    if (d2 <= d1) { console.error('档 ' + tt + ' 难度 ' + d1 + ' 未小于档 ' + (tt + 1) + ' 难度 ' + d2); ok = false; }
  }
  return ok;
}

if (!verify()) {
  console.error('校验未通过，未写入');
  process.exit(1);
}

/* ---------------- 5) 内联写回 blocks.js ---------------- */

function toLine(rec) {
  var p = rec.p.map(function (q) { return '{i:' + q.i + ',r:' + q.r + ',x:' + q.x + ',y:' + q.y + '}'; }).join(',');
  var c = '[' + rec.c.join(',') + ']';
  return '  {r:\'' + rec.r + '\',c:' + c + ',p:[' + p + '],s:' + rec.s + ',t:' + rec.t + ',tl:' + rec.tl + '},';
}

var body = '\n' + LEVELS.map(toLine).join('\n') + '\n  ';

var fpath = path.join(root, 'js', 'game', 'blocks.js');
var src = fs.readFileSync(fpath, 'utf8');
var re = /(var LEVELS = \[)[\s\S]*?(\n  \];)/;
if (!re.test(src)) { console.error('找不到 LEVELS 占位'); process.exit(1); }
src = src.replace(re, '$1' + body + '$2');
fs.writeFileSync(fpath, src, 'utf8');

/* ---------------- 6) 打印曲线 ---------------- */

console.log('已写入 40 关到 ' + fpath);
for (var ti = 0; ti < 4; ti++) {
  var line = '档' + ti + ' [' + tiers[ti][0] + '-' + tiers[ti][tiers[ti].length - 1] + '] 难度' +
    difficulty(LEVELS[tiers[ti][0] - 1]) + ': ';
  for (var k2 = 0; k2 < tiers[ti].length; k2++) {
    var mm = tiers[ti][k2];
    var rec2 = LEVELS[mm - 1];
    line += '(' + Gen.maskToCells(from36(rec2.r)).length + '格/' + rec2.c.length + '色/' + rec2.p.length + '块' +
      (rec2.t ? '/限时' : '') + ') ';
  }
  console.log(line);
}
