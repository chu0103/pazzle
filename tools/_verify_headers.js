// 纯几何校验：各场景 header 的标题/副标题与返回按钮是否重叠（无需 canvas）。
// 中文按“字面宽 ≈ size*0.95”保守估算，足以判定重叠。
function rect(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }
function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function box(x, baseline, size, chars) {
  return rect(x, baseline - size * 0.85, chars * size * 0.95, size);
}

var top = 44; // safeTop 仅用于纵向相对比较
var issues = [];

// 返回按钮：levels / play / diff 三处布局一致
var back = rect(12, top + 6, 40, 40);

// ---- 关卡选择页（levels.js），修复前 x=20 / 修复后 x=64 ----
var titleOld = box(20, top + 20, 22, 5);   // “图片找不同”
var subOld = box(20, top + 46, 12, 13);    // “已通关 12 / 60 · ★ 30”
var titleNew = box(64, top + 20, 22, 5);
var subNew = box(64, top + 46, 12, 13);

console.log('返回按钮    :', JSON.stringify(back));
console.log('（历史）标题@20 重叠?', overlap(titleOld, back), ' （历史）副标题@20 重叠?', overlap(subOld, back));
console.log('当前 标题@64 重叠?', overlap(titleNew, back), ' 当前 副标题@64 重叠?', overlap(subNew, back));
// 仅断言“当前（修复后）”状态；修复前的重叠作为已知历史，不计入失败
if (overlap(titleNew, back) || overlap(subNew, back)) issues.push('levels 修复后标题/副标题仍重叠');

// ---- 玩法页（play.js / diff.js）：标题居中，返回按钮在左 ----
[375, 320, 414].forEach(function (W) {
  var cx = W / 2;
  var pt = box(cx, top + 20, 19, 5);  // “第 12 关”
  var dt = box(cx, top + 20, 19, 5);
  if (overlap(pt, back)) issues.push('play/diff 标题(' + W + ') 重叠');
  if (overlap(dt, back)) issues.push('play/diff 标题(' + W + ') 重叠');
});

// ---- 首页（home.js）：无返回按钮，仅断言自身三块不重叠 ----
var hlTitle = rect(20, top + 17, 130, 49);
var hlStats = rect(187, top + 56, 187, 13);     // W=375 时右侧统计区
var hlVer = rect(265, top + 79, 90, 10);
if (overlap(hlTitle, hlStats) || overlap(hlTitle, hlVer) || overlap(hlStats, hlVer)) {
  issues.push('home 顶部三块相互重叠');
}

console.log('----');
if (issues.length === 0) {
  console.log('✅ 标题与返回按钮均不重叠（已修复 levels 关卡页的左对齐压字问题）');
} else {
  console.log('❌ 发现问题:');
  issues.forEach(function (s) { console.log('  - ' + s); });
  process.exit(1);
}
