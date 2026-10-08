/* 临时探针：测"切出 11 块且恰好含 1 个 1x1 + 2 个 1x2"的命中率 */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function quality(p, floor, sliver) {
  if (p.w < 1 || p.h < 1) { return 0; }
  var mn = Math.min(p.w, p.h), mx = Math.max(p.w, p.h);
  var q = mn / mx;
  if (mn === 1) { q = Math.max(q, sliver); }
  return Math.max(q, floor);
}

function splitScore(w, h, pos, dir, floor, sliver) {
  var a, b;
  if (dir === 'v') { a = { w: pos, h: h }; b = { w: w - pos, h: h }; }
  else { a = { w: w, h: pos }; b = { w: w, h: h - pos }; }
  var sa = quality(a, floor, sliver), sb = quality(b, floor, sliver);
  if (sa <= 0 || sb <= 0) { return 0; }
  return Math.sqrt(sa * sb);
}

function carve(size, target, rng, floor, sliver) {
  var rects = [{ x: 0, y: 0, w: size, h: size }];
  var guard = 0;
  while (rects.length < target && guard++ < 600) {
    var cands = [], i, c, s;
    for (i = 0; i < rects.length; i++) {
      var r = rects[i];
      var aw = Math.pow(r.w * r.h, 0.6);
      for (c = 1; c < r.w; c++) { s = splitScore(r.w, r.h, c, 'v', floor, sliver); if (s > 0) { cands.push({ i: i, dir: 'v', pos: c, score: s * aw }); } }
      for (c = 1; c < r.h; c++) { s = splitScore(r.w, r.h, c, 'h', floor, sliver); if (s > 0) { cands.push({ i: i, dir: 'h', pos: c, score: s * aw }); } }
    }
    if (!cands.length) { break; }
    var total = 0;
    for (i = 0; i < cands.length; i++) { total += cands[i].score; }
    var pick = rng() * total, acc = 0, ch = cands[cands.length - 1];
    for (i = 0; i < cands.length; i++) { acc += cands[i].score; if (pick <= acc) { ch = cands[i]; break; } }
    var rr = rects[ch.i], a, b;
    if (ch.dir === 'v') {
      a = { x: rr.x, y: rr.y, w: ch.pos, h: rr.h };
      b = { x: rr.x + ch.pos, y: rr.y, w: rr.w - ch.pos, h: rr.h };
    } else {
      a = { x: rr.x, y: rr.y, w: rr.w, h: ch.pos };
      b = { x: rr.x, y: rr.y + ch.pos, w: rr.w, h: rr.h - ch.pos };
    }
    rects.splice(ch.i, 1, a, b);
  }
  return rects;
}

function mutate(rects, needMono, needDom) {
  /* 返回能切出所需小块的操作序列：优先 1x3 -> 1x1+1x2，2x2 -> 1x2+1x2 */
  var ops = [];
  var mono = 0, dom = 0, i;
  for (i = 0; i < rects.length; i++) {
    var r = rects[i];
    var long = Math.max(r.w, r.h), short = Math.min(r.w, r.h);
    if (long === 1 && short === 1) { mono++; }
    else if (long === 2 && short === 1) { dom++; }
  }
  return { mono: mono, dom: dom };
}

function trySeed(seed, size, target, floor, sliver) {
  var rng = mulberry32(seed);
  var rects = carve(size, target, rng, floor, sliver);
  if (rects.length !== target) { return null; }
  return mutate(rects);
}

function run(floor, sliver, label, N) {
  var exact = 0, atleast = 0, fail = 0, piecesAvg = 0;
  var firstSeeds = [];
  for (var s = 1; s <= N; s++) {
    var r = trySeed(s, 8, 11, floor, sliver);
    if (!r) { fail++; continue; }
    if (r.mono === 1 && r.dom === 2) { exact++; if (firstSeeds.length < 5) { firstSeeds.push(s); } }
    if (r.mono >= 1 && r.dom >= 2) { atleast++; }
  }
  console.log(label + ' floor=' + floor + ' sliver=' + sliver +
    '  exact=' + (100 * exact / N).toFixed(1) + '%' +
    '  atLeast=' + (100 * atleast / N).toFixed(1) + '%' +
    '  fail=' + fail + '  样例seed=' + firstSeeds.join(','));
}

var N = 1500;
run(0.0001, 0.42, '[原评分]      ', N);
run(0.05, 0.30, '[放宽]        ', N);
run(0.10, 0.40, '[中]          ', N);
run(0.15, 0.50, '[更放宽]      ', N);
