#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成「图片找不同」各主题的对照证明图：左 A、右 B，B 上用红圈标出差异位置。
放在 test/shots/diff_v2/ 下，每主题一张（取该主题第 1 关，3 处差异）。

用法：python tools/_make_proofs.py
"""
import os
import json
import subprocess
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, 'js', 'game', 'diffAssets.js')
OUT = os.path.join(ROOT, 'test', 'shots', 'diff_v2')
THEME_NAMES = {1: '公园', 2: '厨房', 3: '马路', 4: '房间', 5: '海洋', 6: '太空'}


def load_manifest():
    js = "globalThis.BF={};require(%r);process.stdout.write(JSON.stringify(globalThis.BF.DIFF_ASSETS));" % MANIFEST
    return json.loads(subprocess.check_output(['node', '-e', js], cwd=ROOT))


def main():
    os.makedirs(OUT, exist_ok=True)
    items = load_manifest()
    gap = 24
    for L in range(1, 7):
        it = items[L - 1]
        a = Image.open(os.path.join(ROOT, it['a'])).convert('RGB')
        b = Image.open(os.path.join(ROOT, it['b'])).convert('RGB')
        W, H = a.size
        canvas = Image.new('RGB', (W * 2 + gap, H), (245, 245, 248))
        canvas.paste(a, (0, 0))
        canvas.paste(b, (W + gap, 0))
        d = ImageDraw.Draw(canvas)
        # 分隔线
        d.line([(W + gap // 2, 0), (W + gap // 2, H)], fill=(150, 150, 160), width=3)
        # 标 A / B
        d.text((12, 8), 'A 原图', fill=(60, 60, 70))
        d.text((W + gap + 12, 8), 'B 差异图', fill=(60, 60, 70))
        # 红圈标差异（画在 B 区域，偏移 W+gap）
        for r in it['diffs']:
            cx = (W + gap) + (r['u'] + r['uw'] / 2) * W
            cy = (r['v'] + r['vh'] / 2) * H
            rad = max(r['uw'], r['vh']) * W / 2 * 1.15
            d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], outline=(220, 40, 40), width=4)
        path = os.path.join(OUT, 'diff_v2_L%02d_%s.png' % (L, THEME_NAMES[L]))
        canvas.save(path)
        print('  ✅ %s' % os.path.relpath(path, ROOT))
    print('\n  共 %d 张，存于 %s' % (6, os.path.relpath(OUT, ROOT)))


if __name__ == '__main__':
    main()
