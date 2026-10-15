# _probe_sudoku_lines.py —— 像素级验证数独网格粗线（修复「九宫格错乱」回归后）
# 用法：python tools/_probe_sudoku_lines.py test/shots/sudoku/s71.png [s72 ...]
# 尺度无关：快照页把 390 逻辑宽缩到 ~320 展示（?w= 参数有双重 px 的无效值回退），
# 所以这里不写死坐标，全部用「检测到的线之间的相对关系」断言：
#   A. 粗横线 / 粗竖线各 4 条（宫界），且各自等距；
#   B. 横线间距 ≈ 竖线间距 ≈ 棋盘宽/3（= 3 格）；
#      ⚠️ 旧 bug：横线 y 误用 bx+k*c → 横线间距只有 1 格、整体平移到棋盘上方，这里会挂；
#   C. 4 条横线的纵向跨度与 4 条竖线的横向跨度一致（宫格是正方的）；
#   D. 每条粗线通栏（暗像素跨度 ≥ 线组的 90%）。
from PIL import Image
import sys

def load(path):
    im = Image.open(path).convert('RGB')
    return im, im.load(), im.size

def group(idxs):
    out = []
    for i in idxs:
        if out and i - out[-1][-1] <= 2:
            out[-1].append(i)
        else:
            out.append([i])
    return [sum(g) / len(g) for g in out]

fails = []
for path in sys.argv[1:]:
    im, px, (W, H) = load(path)
    # 粗线 rgba(23,26,31,0.38) 叠白底 ≈ (187,189,192)；细线 (0.10) ≈ 232 不触发；页面背景 246+
    def dark_ratio_row(y):
        n = sum(1 for x in range(W) if px[x, y][0] < 218)
        return n
    cand_h = [y for y in range(H) if dark_ratio_row(y) > W * 0.55]
    hlines = group(cand_h)
    if len(hlines) < 4:
        fails.append('%s: 只检测到 %d 条通栏粗横线（应 4 条）' % (path, len(hlines)))
        continue
    # 只用最强的 4 条（防止页码/标题等偶发通栏行混入）：取暗像素最多的 4 组
    scored = sorted(hlines, key=lambda y: -dark_ratio_row(int(round(y))))[:4]
    hlines = sorted(scored)
    ytop, ybot = hlines[0], hlines[-1]
    # 在横线跨度内找粗竖线
    def dark_ratio_col(x):
        n = sum(1 for y in range(int(ytop) - 4, int(ybot) + 5) if px[x, y][0] < 218)
        return n
    cand_v = [x for x in range(W) if dark_ratio_col(x) > (ybot - ytop) * 0.9]
    vlines = group(cand_v)
    if len(vlines) < 4:
        fails.append('%s: 只检测到 %d 条通栏粗竖线（应 4 条）' % (path, len(vlines)))
        continue
    scored = sorted(vlines, key=lambda x: -dark_ratio_col(int(round(x))))[:4]
    vlines = sorted(scored)

    hs = [hlines[i + 1] - hlines[i] for i in range(3)]
    vs = [vlines[i + 1] - vlines[i] for i in range(3)]
    bw = vlines[-1] - vlines[0]
    bh = hlines[-1] - hlines[0]
    print('%s\n  粗横线 y=%s 间距=%s\n  粗竖线 x=%s 间距=%s\n  棋盘 %.0fx%.0f' %
          (path, [round(v) for v in hlines], [round(v, 1) for v in hs],
           [round(v) for v in vlines], [round(v, 1) for v in vs], bw, bh))
    if max(hs) - min(hs) > 3:
        fails.append('%s: 横线间距不均 %s（旧 bug：横线整体偏移且间距=1 格）' % (path, [round(v, 1) for v in hs]))
    if max(vs) - min(vs) > 3:
        fails.append('%s: 竖线间距不均 %s' % (path, [round(v, 1) for v in vs]))
    if abs(hs[0] - bw / 3) > max(4, bw * 0.06):
        fails.append('%s: 横线间距 %.1f ≠ 棋盘宽/3 %.1f' % (path, hs[0], bw / 3))
    if abs(vs[0] - bw / 3) > max(4, bw * 0.06):
        fails.append('%s: 竖线间距 %.1f ≠ 棋盘宽/3 %.1f' % (path, vs[0], bw / 3))
    if abs(bh - bw) > max(5, bw * 0.06):
        fails.append('%s: 宫格不正方（宽 %.0f 高 %.0f）' % (path, bw, bh))
    # D: 每条粗线通栏
    for y in hlines:
        yy = int(round(y))
        xs = [x for x in range(W) if px[x, yy][0] < 218]
        if not xs or (xs[-1] - xs[0]) < bw * 0.9:
            fails.append('%s: y=%d 横线不通栏（跨度 %d / %.0f）' % (path, yy, xs[-1] - xs[0] if xs else 0, bw))
    for x in vlines:
        xx = int(round(x))
        ys = [y for y in range(int(ytop) - 4, int(ybot) + 5) if px[xx, y][0] < 218]
        if not ys or (ys[-1] - ys[0]) < bh * 0.9:
            fails.append('%s: x=%d 竖线不通栏' % (path, xx))
    # 棋盘上方不应有通栏横线（旧 bug 会把整组横线画到画布内、棋盘上方）。
    # 只扫画布区域：画布顶 = 棋盘顶 - boardY逻辑值×缩放（缩放 = 棋盘宽/369，逻辑 boardY=207.5）。
    # 页面标题/图注在画布之外，不能误判。
    scale = bw / 369.0
    canvas_top = ytop - 207.5 * scale
    above = [y for y in range(int(canvas_top) + 4, int(ytop) - 8) if dark_ratio_row(y) > W * 0.55]
    if above:
        fails.append('%s: 画布内棋盘上方 y=%d 处出现通栏横线（旧 bug 复现？）' % (path, above[0]))

if fails:
    print('❌ 网格线像素校验失败')
    for f in fails:
        print('  ✗ ' + f)
    sys.exit(1)
print('✅ 网格线像素校验通过：4 条宫界粗横/竖线等距通栏、宫格正方、棋盘上方无残留线')
