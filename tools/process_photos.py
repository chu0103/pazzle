#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
照片拼图 · 图片处理管线

用法：
    python tools/process_photos.py 图1.jpg 图2.jpg ...
    python tools/process_photos.py --clear 图1.jpg ...      # 先清空已有资源再输出
    python tools/process_photos.py --size 640 图1.jpg ...   # 指定输出边长

做了什么（对应「自动处理成适合拼图的图」）：
  1. 居中裁成正方形（拼图必须方盘，非方图不能拉伸变形）
  2. 统一尺寸（默认 720，兼顾清晰度与小游戏主包体积）
  3. 轻微提亮 + 加对比 + 微增饱和 —— 目的是让切出来的块彼此**好分辨**
  4. 压体积：JPEG 质量从 88 往下试探，单张控制在预算内（默认 160KB）
  5. 体检：按 8×8 逐块算色彩方差，挑出「几乎纯色」的块并给出提示
     —— 这种块玩家肉眼分不出来，是照片拼图最常见的劝退点

产出：
    assets/photo/p1.jpg ... pN.jpg
    js/game/photoAssets.js     —— 清单（文件名 + 主色 + 体检结果），游戏直接读
"""
import io
import os
import sys
import math
from PIL import Image, ImageEnhance, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'assets', 'photo')
MANIFEST = os.path.join(ROOT, 'js', 'game', 'photoAssets.js')

SIZE = 720          # 输出边长（正方形）
BUDGET = 160 * 1024  # 单张体积预算
GRID = 8            # 体检用的切分粒度（最难关是 8x8）


def center_square(im):
    """居中裁正方：不做智能构图（容易切掉主体），中心裁剪最可预期"""
    w, h = im.size
    if w == h:
        return im
    s = min(w, h)
    left = (w - s) // 2
    top = (h - s) // 2
    return im.crop((left, top, left + s, top + s))


def enhance(im):
    """轻微提亮 + 加对比 + 微增饱和。
    注意是'轻微'：拼图块数量多，过度处理会让相邻块色差失真、反而更难拼。"""
    im = ImageEnhance.Brightness(im).enhance(1.04)
    im = ImageEnhance.Contrast(im).enhance(1.12)
    im = ImageEnhance.Color(im).enhance(1.08)
    return im


def dominant_color(im):
    """主色：量化到 5 色取占比最高的；若它太白/太黑（不好用作 UI 色）就退而取第二色"""
    small = im.copy().convert('RGB').resize((64, 64), Image.LANCZOS)
    q = small.quantize(colors=5, method=Image.MEDIANCUT)
    palette = q.getpalette()
    counts = sorted(q.getcolors(), reverse=True) or []
    cands = []
    for cnt, idx in counts[:3]:
        r, g, b = palette[idx * 3:idx * 3 + 3]
        cands.append((cnt, r, g, b))
    for cnt, r, g, b in cands:
        lum = (r * 299 + g * 587 + b * 114) / 1000
        if 40 < lum < 225:          # 排除接近纯白/纯黑
            return (r, g, b)
    if cands:
        _, r, g, b = cands[0]
        return (r, g, b)
    return (120, 120, 120)


def to_hex(c):
    return '#%02X%02X%02X' % c


def health_check(im):
    """按 GRID×GRID 切块，统计'信息量不足'的块（色彩方差过低 = 一整块几乎同色）"""
    s = im.size[0]
    step = s / GRID
    flat = []
    for gy in range(GRID):
        for gx in range(GRID):
            box = (int(gx * step), int(gy * step), int((gx + 1) * step), int((gy + 1) * step))
            tile = im.crop(box)
            st = ImageStat.Stat(tile.convert('RGB'))
            # 三个通道的标准差取均值，再和整体对比度挂钩
            sd = sum(st.stddev) / 3.0
            if sd < 6.0:
                flat.append((gx, gy, round(sd, 1)))
    return flat


def save_fit(im, path):
    """在保证体积预算的前提下取最高质量"""
    for q in (88, 84, 80, 75, 70, 65, 60, 55, 50):
        im.save(path, 'JPEG', quality=q, optimize=True, progressive=True)
        if os.path.getsize(path) <= BUDGET:
            return q, os.path.getsize(path)
    return 50, os.path.getsize(path)


def main():
    args = sys.argv[1:]
    size = SIZE
    clear = False
    files = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == '--clear':
            clear = True
        elif a == '--size':
            i += 1
            size = int(args[i])
        else:
            files.append(a)
        i += 1

    if not files:
        print(__doc__)
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    if clear:
        for f in os.listdir(OUT_DIR):
            if f.lower().endswith('.jpg'):
                os.remove(os.path.join(OUT_DIR, f))

    items = []
    idx = 0
    for f in files:
        if not os.path.exists(f):
            print('  ⚠ 跳过（找不到文件）: ' + f)
            continue
        try:
            im = Image.open(f)
        except Exception as e:
            print('  ⚠ 跳过（不是图片 / 打不开）: %s —— %s' % (f, e))
            continue
        # EXIF 方向：手机竖拍的照片常常带旋转标记，不处理会躺着装进拼图
        try:
            from PIL import ImageOps
            im = ImageOps.exif_transpose(im)
        except Exception:
            pass
        im = im.convert('RGB')
        idx += 1
        im = center_square(im)
        im = im.resize((size, size), Image.LANCZOS)
        im = enhance(im)
        name = 'p%d.jpg' % idx
        path = os.path.join(OUT_DIR, name)
        q, nbytes = save_fit(im, path)
        main_color = dominant_color(im)
        flat = health_check(im)
        items.append({
            'name': name, 'src': name, 'color': to_hex(main_color),
            'w': size, 'h': size, 'flat': len(flat), 'kb': nbytes // 1024
        })
        warn = ''
        if flat:
            worst = sorted(flat, key=lambda t: t[2])[:3]
            where = '、'.join('(%d,%d)' % (t[0], t[1]) for t in worst)
            warn = '  ⚠ 有 %d 块几乎纯色%s，这些块会很难分辨' % (len(flat), '（如 ' + where + '）')
        print('  ✅ %-10s %dx%d  q%-3d %4dKB  主色 %s%s' %
              (name, size, size, q, nbytes // 1024, to_hex(main_color), warn))

    if not items:
        print('没有可用图片。')
        return 1

    # 清单：游戏运行时读它，新增图不用改任何游戏代码
    lines = []
    lines.append('/**')
    lines.append(' * photoAssets.js —— 内置照片清单（由 tools/process_photos.py 自动生成，勿手改）')
    lines.append(' * 每张图已经过：居中裁正方 → 统一尺寸 → 提亮加对比 → 压体积。')
    lines.append(' */')
    lines.append('(function () {')
    lines.append('  var G = typeof GameGlobal !== \'undefined\' ? GameGlobal')
    lines.append('        : (typeof window !== \'undefined\' ? window : globalThis);')
    lines.append('  var BF = G.BF || (G.BF = {});')
    lines.append('')
    lines.append('  BF.PHOTO_ASSETS = [')
    for it in items:
        lines.append('    { src: \'assets/photo/%s\', color: \'%s\', w: %d, h: %d },'
                     % (it['src'], it['color'], it['w'], it['h']))
    lines.append('  ];')
    lines.append('})();')
    lines.append('')
    with io.open(MANIFEST, 'w', encoding='utf-8') as fp:
        fp.write('\n'.join(lines))

    total = sum(it['kb'] for it in items)
    print('')
    print('  → assets/photo/  共 %d 张，合计 %dKB（主包上限 4MB）' % (len(items), total))
    print('  → js/game/photoAssets.js 已更新')
    return 0


if __name__ == '__main__':
    sys.exit(main())
