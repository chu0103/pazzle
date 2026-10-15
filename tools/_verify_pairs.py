#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动校验「图片找不同」图对（替代肉眼看 PNG，因为我这边无法看图）：

  1. 每个声明过的差异矩形里，A、B 像素确实有明显不同（差异是真的，不是隐形差异）。
  2. 所有「变化像素」中，>= 90% 落在声明矩形内（说明没有物件凭空消失 / 多出额外差异）。

用法：
    python tools/_verify_pairs.py            # 校验全部 60 对
    python tools/_verify_pairs.py 1 6       # 只校验 L01..L06（每主题一对）
"""
import os
import sys
import json
import subprocess
from PIL import Image, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, 'js', 'game', 'diffAssets.js')
ASSET_DIR = os.path.join(ROOT, 'assets', 'diff')

THRESH = 35          # 单像素「最大通道差」> 此值算「变化」（用最大通道而非亮度，
                     #   因为浅蓝→浅黄这类变色亮度差小但色相明显不同，肉眼可辨）
INSIDE_RATIO = 0.90  # 变化像素落在声明矩形内的比例阈值
PER_RECT_MIN = 30    # 单个声明矩形内至少要有这么多「变化像素」才算真有差异
                     # （薄物件如鸟/星/蝴蝶的描边只占包围盒一小部分，用绝对像素数而非比例，
                     #   避免把正常的变色差异误判成「隐形差异」）


def load_manifest():
    # 用 node 把 BF.DIFF_ASSETS 直接 dump 成 JSON（避免手写解析 JS 字面量）
    js = "globalThis.BF={};require(%r);process.stdout.write(JSON.stringify(globalThis.BF.DIFF_ASSETS));" % MANIFEST
    out = subprocess.check_output(['node', '-e', js], cwd=ROOT)
    return json.loads(out)


def in_any_rect(x, y, W, H, rects, tol=0.012):
    u0, v0 = x / W, y / H
    for r in rects:
        if (r['u'] - tol <= u0 <= r['u'] + r['uw'] + tol and
                r['v'] - tol <= v0 <= r['v'] + r['vh'] + tol):
            return True
    return False


def verify_item(it):
    a = Image.open(os.path.join(ROOT, it['a'])).convert('RGB')
    b = Image.open(os.path.join(ROOT, it['b'])).convert('RGB')
    W, H = a.size
    diff = ImageChops.difference(a, b)
    # 取 R/G/B 三通道的逐像素最大值作为「变化强度」（比亮度更贴合人眼辨色）
    dr, dg, db = diff.split()
    mx = ImageChops.lighter(dr, ImageChops.lighter(dg, db))
    dpx = mx.load()
    rects = it['diffs']
    total_changed = 0
    inside_changed = 0
    # 逐声明矩形统计变化像素数
    rect_changed = [0] * len(rects)
    rect_area = max(1, int((W * H) * sum(r['uw'] * r['vh'] for r in rects) / max(1, len(rects))))
    for y in range(H):
        for x in range(W):
            if dpx[x, y] > THRESH:
                total_changed += 1
                if in_any_rect(x, y, W, H, rects):
                    inside_changed += 1
                    # 归属到具体某个矩形（取第一个命中的）
                    u0, v0 = x / W, y / H
                    for i, r in enumerate(rects):
                        if (r['u'] <= u0 <= r['u'] + r['uw'] and r['v'] <= v0 <= r['v'] + r['vh']):
                            rect_changed[i] += 1
                            break
    ratio = inside_changed / total_changed if total_changed else 1.0
    # 每个声明矩形是否真有变化（用绝对像素数，避免薄物件包围盒比例误判）
    dead = [i for i in range(len(rects)) if rect_changed[i] < PER_RECT_MIN]
    problems = []
    if len(rects) == 0:
        problems.append('无差异矩形')
    if ratio < INSIDE_RATIO:
        problems.append('变化像素仅 %.0f%% 在声明矩形内（有额外差异/物件消失）' % (ratio * 100))
    if dead:
        problems.append('矩形 %s 内几乎无变化（隐形差异/物件消失）' % dead)
    return total_changed, inside_changed, ratio, dead, problems


def main():
    only = None
    if len(sys.argv) >= 3:
        only = list(range(int(sys.argv[1]), int(sys.argv[2]) + 1))
    items = load_manifest()
    print('  载入 %d 对，逐对像素校验（阈值 %d）…' % (len(items), THRESH))
    bad = 0
    for idx, it in enumerate(items, 1):
        if only and idx not in only:
            continue
        tc, ic, ratio, dead, problems = verify_item(it)
        tag = 'OK' if not problems else '✗'
        if problems:
            bad += 1
            print('  %s L%02d (%d 处) 变化=%d 框内=%.0f%%  %s' %
                  (tag, idx, len(it['diffs']), tc, ratio * 100, '; '.join(problems)))
        else:
            print('  %s L%02d (%d 处) 变化=%d 框内=%.0f%%' % (tag, idx, len(it['diffs']), tc, ratio * 100))
    print('')
    if bad == 0:
        print('  ✅ 全部通过：每个差异都真实存在，且无物件凭空消失 / 无额外差异。')
    else:
        print('  ⚠ %d 对有问题，见上。' % bad)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
