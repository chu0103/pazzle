/* 临时探针（不是正式测试）：验证「预置 1x1/1x2/1x3 固定块 + 贪心矩形化切成 8 块」的成功率与形状质量。
   用法：node test/_probe_logic.js */
const N = 8, AREA = 64;

function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const idx = (x, y) => y * N + x;

/** 随机放一块 1×len（朝向随机），不覆盖已有格子 */
function placeFixed(occ, len, rng, tries = 400) {
  for (let t = 0; t < tries; t++) {
    const horiz = rng() < 0.5;
    const w = horiz ? len : 1, h = horiz ? 1 : len;
    const x = Math.floor(rng() * (N - w + 1)), y = Math.floor(rng() * (N - h + 1));
    let ok = true;
    for (let dy = 0; dy < h && ok; dy++) {
      for (let dx = 0; dx < w; dx++) { if (occ[idx(x + dx, y + dy)]) { ok = false; break; } }
    }
    if (!ok) continue;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) { occ[idx(x + dx, y + dy)] = 1; }
    }
    return { x, y, w, h, len };
  }
  return null;
}

const topLeftEmpty = (occ) => {
  for (let y = 0; y < N; y++) { for (let x = 0; x < N; x++) { if (!occ[idx(x, y)]) return { x, y }; } }
  return null;
};
const maxWidth = (occ, x, y) => { let w = 0; while (x + w < N && !occ[idx(x + w, y)]) w++; return w; };
function maxHeight(occ, x, y, w) {
  let h = 0;
  outer: while (y + h < N) {
    for (let k = 0; k < w; k++) { if (occ[idx(x + k, y + h)]) break outer; }
    h++;
  }
  return h;
}

/** 把剩余空格切成恰好 target 块（左上角优先贪心 + 面积均衡评分） */
function rectify(occ, target, rng, cfg) {
  const pieces = [];
  let left = 0;
  for (let i = 0; i < AREA; i++) { if (!occ[i]) left++; }
  let guard = 0;
  while (left > 0) {
    if (guard++ > 60) return null;
    const need = target - pieces.length;
    if (need <= 0) return null;
    const p = topLeftEmpty(occ);
    if (!p) break;
    const mw = maxWidth(occ, p.x, p.y);
    const avg = left / need;
    const cands = [];
    for (let w = 1; w <= mw; w++) {
      const mh = maxHeight(occ, p.x, p.y, w);
      for (let h = 1; h <= mh; h++) {
        const area = w * h;
        if (area > left - (need - 1)) continue;          // 给后面每块至少留 1 格
        const shape = Math.min(w, h) / Math.max(w, h);   // 方正度
        const fit = 1 / (1 + Math.abs(area - avg) / Math.max(1, avg)); // 面积贴近平均
        cands.push({ w, h, area, sc: Math.pow(shape, cfg.shapePow) * Math.pow(fit, cfg.fitPow) });
      }
    }
    if (!cands.length) return null;
    let tot = 0;
    for (const c of cands) tot += c.sc;
    let pick = rng() * tot, acc = 0, ch = cands[cands.length - 1];
    for (const c of cands) { acc += c.sc; if (pick <= acc) { ch = c; break; } }
    for (let dy = 0; dy < ch.h; dy++) {
      for (let dx = 0; dx < ch.w; dx++) { occ[idx(p.x + dx, p.y + dy)] = 2; }
    }
    pieces.push({ x: p.x, y: p.y, w: ch.w, h: ch.h });
    left -= ch.area;
  }
  return pieces.length === target ? pieces : null;
}

/** 尝试生成一关：外层换 seed 重试 */
function attempt(seed, cfg, outerTries) {
  for (let t = 0; t < outerTries; t++) {
    const rng = mulberry32((seed + t * 104729) >>> 0);
    const occ = new Uint8Array(AREA);
    const fixed = [];
    let ok = true;
    for (const len of [3, 2, 1]) {
      const f = placeFixed(occ, len, rng);
      if (!f) { ok = false; break; }
      fixed.push(f);
    }
    if (!ok) continue;
    const rest = rectify(occ, 8, rng, cfg);
    if (rest) return { fixed, rest, tries: t + 1 };
  }
  return null;
}

/* ---------------- 跑统计 ---------------- */
const CFGS = [
  { name: 'shape1 fit1', shapePow: 1.0, fitPow: 1.0 },
  { name: 'shape1 fit2', shapePow: 1.0, fitPow: 2.0 },
  { name: 'shape0.5 fit2', shapePow: 0.5, fitPow: 2.0 },
  { name: 'shape2 fit1', shapePow: 2.0, fitPow: 1.0 }
];
const SEEDS = 300;
const OUTER = 40;

for (const cfg of CFGS) {
  let hit = 0, sumTries = 0, maxTries = 0, noHit = 0;
  let minArea = 99, maxArea = 0, singles = 0, slivers = 0, sumPieces = 0;
  for (let s = 0; s < SEEDS; s++) {
    const r = attempt(1000 + s * 7919, cfg, OUTER);
    if (!r) { noHit++; continue; }
    hit++; sumTries += r.tries; maxTries = Math.max(maxTries, r.tries);
    for (const p of r.rest) {
      const a = p.w * p.h;
      sumPieces++;
      minArea = Math.min(minArea, a);
      maxArea = Math.max(maxArea, a);
      if (a === 1) singles++;
      if (Math.min(p.w, p.h) === 1 && Math.max(p.w, p.h) >= 4) slivers++;
    }
  }
  console.log(
    cfg.name.padEnd(14) +
    ' 成功 ' + String(hit).padStart(3) + '/' + SEEDS +
    '  放弃 ' + String(noHit).padStart(3) +
    '  平均重试 ' + (hit ? (sumTries / hit).toFixed(1) : '-').padStart(5) +
    '  最差 ' + String(maxTries).padStart(3) +
    '  块面积 ' + minArea + '~' + maxArea +
    '  1x1碎片 ' + singles +
    '  细长条 ' + slivers
  );
}

/* 打一个样例出来看形状 */
const sample = attempt(1000 + 7 * 7919, CFGS[1], OUTER);
if (sample) {
  const g = Array.from({ length: N }, () => new Array(N).fill('.'));
  sample.fixed.forEach((f, i) => {
    for (let dy = 0; dy < f.h; dy++) {
      for (let dx = 0; dx < f.w; dx++) { g[f.y + dy][f.x + dx] = '#'; }
    }
  });
  const letters = 'abcdefgh';
  sample.rest.forEach((p, i) => {
    for (let dy = 0; dy < p.h; dy++) {
      for (let dx = 0; dx < p.w; dx++) { g[p.y + dy][p.x + dx] = letters[i]; }
    }
  });
  console.log('\n样例（# = 固定块，字母 = 8 块托盘块）  重试 ' + sample.tries + ' 次');
  g.forEach((row) => console.log('   ' + row.join(' ')));
  console.log('   固定块: ' + sample.fixed.map((f) => f.w + 'x' + f.h + '@' + f.x + ',' + f.y).join('  '));
}
