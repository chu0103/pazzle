# -*- coding: utf-8 -*-
"""
_png_palette_probe.py —— 从渲染截图里反查调色板是否更新

原理：色块是大面积纯色圆片（数千像素），若截图里"新 hex"命中很多、"旧 hex"几乎为 0，
即可证明渲染用的是新版调色板（而非缓存/旧版）。

用法：python tools/_png_palette_probe.py test/shots/cipher/c39.png ...
"""
import sys
from PIL import Image

NEW = {
    '红': '#E13B36', '橙': '#F5821F', '黄': '#F2C400', '绿': '#3FA34D',
    '青': '#1FB8D6', '蓝': '#1F56CE', '紫': '#B03FDD', '粉': '#FF5FA8',
    '灰': '#7A828E', '棕': '#7C4A1E',
}
OLD = {
    '红': '#E63946', '橙': '#F4820B', '黄': '#E9BC00', '绿': '#2EA44F',
    '青': '#06AED7', '蓝': '#2D6CDF', '紫': '#8B3DF5', '粉': '#FF5DA2',
    '青绿': '#0FA37F', '棕': '#8A5A2D',
}

def hx(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i+2], 16) for i in (0, 2, 4))

def count(img, targets, tol=10):
    px = img.load()
    w, h = img.size
    hits = {k: 0 for k in targets}
    tg = {k: hx(v) for k, v in targets.items()}
    t2 = tol * tol
    for y in range(0, h, 2):           # 隔行采样，速度快一倍
        for x in range(0, w, 2):
            r, g, b = px[x, y][:3]
            for k, (tr, tg_, tb) in tg.items():
                dr, dg, db = r - tr, g - tg_, b - tb
                if dr*dr + dg*dg + db*db <= t2:
                    hits[k] += 1
    return hits

for path in sys.argv[1:]:
    im = Image.open(path).convert('RGB')
    nh = count(im, NEW)
    oh = count(im, OLD)
    nsum = sum(nh.values()); osum = sum(oh.values())
    print('\n=== %s (%dx%d) ===' % (path, im.size[0], im.size[1]))
    print('  新色命中合计 = %d   旧色命中合计 = %d' % (nsum, osum))
    print('  新：' + '  '.join('%s=%d' % (k, v) for k, v in nh.items()))
    print('  旧：' + '  '.join('%s=%d' % (k, v) for k, v in oh.items()))
