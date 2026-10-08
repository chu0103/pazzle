/* 临时探针 v2：改用「回溯搜索」把剩余区域精确切成 8 块（v1 的贪心只有约 4% 成功率）。
   用法：node test/_probe_logic2.js */
const N = 8, AREA = 64;
const MIN_A = 3, MAX_A = 16, MAX_SIDE = 4;   // 托盘块：面积3~16、最长边≤4（细条最多 1×4）

function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

const idx = (x, y) => y * N + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < N && y < N;

function topLeft(occ) {
  for (let y = 0; y < N; y++) { for (let x = 0; x < N; x++) { if (!occ[idx(x, y)]) return { x, y }; } }
  return null;
}
function maxW(occ, x, y) { let w = 0; while (x + w < N && !occ[idx(x + w, y)]) w++; return w; }
function maxH(occ, x, y, w) {
  let h = 0;
  outer: while (y + h < N) {
    for (let k = 0; k < w; k++) { if (occ[idx(x + k, y + h)]) break outer; }
    h++;
  }
  return h;
}
function countEmpty(occ) { let c = 0; for (let i = 0; i < AREA; i++) { if (!occ[i]) c++; } return c; }

/** 预置一块 1×len（朝向随机） */
function placeFixed(occ, len, rng, tries = 300) {
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

/** 回溯：把 occ 上的剩余空格切成恰好 need 块 */
function solve(occ, need, rng, stat) {
  if (stat.n++ > stat.max) return null;
  const p = topLeft(occ);
  if (!p) return need === 0 ? [] : null;
  if (need <= 0) return null;

  const total = countEmpty(occ);
  if (total < need * MIN_A && total !== need) return null;   // 每块至少 MIN_A 格（除非刚好一格一块）
  if (total > need * MAX_A) return null;                     // 每块至多 MAX_A 格

  const mw = maxW(occ, p.x, p.y);
  const avg = total / need;
  const cands = [];
  for (let w = 1; w <= mw; w++) {
    const mh = maxH(occ, p.x, p.y, w);
    for (let h = 1; h <= mh; h++) {
      const area = w * h;
      if (area < MIN_A || area > MAX_A) continue;

      if (Math.max(w, h) > MAX_SIDE) continue;
      const left = total - area, restNeed = need - 1;
      if (restNeed === 0) { if (left !== 0) continue; }
      else {
        if (left > restNeed * MAX_A) continue;
        if (left < restNeed * MIN_A && left !== restNeed) continue;
      }
      const shape = Math.min(w, h) / Math.max(w, h);
      const fit = 1 / (1 + Math.abs(area - avg) / Math.max(1, avg));
      cands.push({ w, h, score: shape * fit + rng() * 0.35 });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);

  for (const c of cands) {
    for (let dy = 0; dy < c.h; dy++) {
      for (let dx = 0; dx < c.w; dx++) { occ[idx(p.x + dx, p.y + dy)] = 1; }
    }
    const r = solve(occ, need - 1, rng, stat);
    if (r) return [{ x: p.x, y: p.y, w: c.w, h: c.h }, ...r];
    for (let dy = 0; dy < c.h; dy++) {
      for (let dx = 0; dx < c.w; dx++) { occ[idx(p.x + dx, p.y + dy)] = 0; }
    }
  }
  return null;
}

/** 外层：换 seed 重试 */
function attempt(seed, outerTries, maxNodes) {
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
    const stat = { n: 0, max: maxNodes };
    const rest = solve(occ, 8, rng, stat);
    if (rest) return { fixed, rest, tries: t + 1, nodes: stat.n };
  }
  return null;
}

/* ---------------- 统计 ---------------- */
const SEEDS = 300, OUTER = 25, MAXN = 8000;
let hit = 0, noHit = 0, sumTries = 0, maxTries = 0, sumNodes = 0, maxNodes = 0;
let minArea = 99, maxArea = 0, singles = 0, slivers = 0, maxSideSeen = 0;
const t0 = Date.now();

for (let s = 0; s < SEEDS; s++) {
  const r = attempt(1000 + s * 7919, OUTER, MAXN);
  if (!r) { noHit++; continue; }
  hit++; sumTries += r.tries; maxTries = Math.max(maxTries, r.tries);
  sumNodes += r.nodes; maxNodes = Math.max(maxNodes, r.nodes);
  for (const p of r.rest) {
    const a = p.w * p.h;
    minArea = Math.min(minArea, a); maxArea = Math.max(maxArea, a);
    maxSideSeen = Math.max(maxSideSeen, p.w, p.h);
    if (a === 1) singles++;
    if (Math.min(p.w, p.h) === 1) slivers++;
  }
}

console.log('回溯版：成功 ' + hit + '/' + SEEDS + '  放弃 ' + noHit +
  '  平均重试 ' + (hit ? (sumTries / hit).toFixed(2) : '-') +
  '  最差重试 ' + maxTries);
console.log('  搜索节点 平均 ' + (hit ? Math.round(sumNodes / hit) : '-') +
  '  最多 ' + maxNodes);
console.log('  托盘块面积 ' + minArea + '~' + maxArea + '  最长边 ' + maxSideSeen +
  '  1x1碎片 ' + singles + '  含1格的块 ' + slivers);
console.log('  总耗时 ' + (Date.now() - t0) + 'ms');

const sample = attempt(1000 + 7 * 7919, OUTER, MAXN);
if (sample) {
  const g = Array.from({ length: N }, () => new Array(N).fill('.'));
  sample.fixed.forEach((f) => {
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
  console.log('\n样例（# 固定块 / 字母 托盘块）  重试 ' + sample.tries + ' 次，搜索 ' + sample.nodes + ' 节点');
  g.forEach((row) => console.log('   ' + row.join(' ')));
  console.log('   固定块: ' + sample.fixed.map((f) => f.w + 'x' + f.h + '@' + f.x + ',' + f.y).join('  '));
  console.log('   托盘块: ' + sample.rest.map((p, i) => letters[i] + '=' + p.w + 'x' + p.h).join(' '));
}
