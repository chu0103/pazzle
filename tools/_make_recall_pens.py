#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
瞬时记忆 · 重新生成「签字笔」实物图的后处理管线（专用）

只处理 _gen/pen_regen/<color>/*.png，输出 assets/recall/pen_<color>.jpg。
与 process_photos.py 不同：这里不做居中方裁，而是
  1. 用**饱和度遮罩**抠出「彩色笔身」（同时天然排除浅灰背景与角标水印文字）
  2. 取笔身 bbox + 内边距裁切
  3. 等比缩放铺进 150×150 纯白画布（保持比例，居中）
  4. 存 JPEG q86（与现有 recall 资源一致的体积策略）

约定：所有 6 张笔都是「水平放置、笔尖朝右（+x，0°）」，
所以游戏里 PEN_BASE_ROT = 0，只需按 item.rot 旋转即可让笔尖指向目标。
"""
import os
import glob
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '_gen', 'pen_regen')
OUT = os.path.join(ROOT, 'assets', 'recall')
SIZE = 150
PAD = 10           # 笔身 bbox 内边距（源像素）
QUALITY = 86
COLORS = ['blue', 'red', 'green', 'yellow', 'purple', 'orange']
CODE = {'blue': 'blue', 'red': 'red', 'green': 'green',
        'yellow': 'yellow', 'purple': 'purple', 'orange': 'orange'}


def isolate_pen(im):
    """返回笔身灰度遮罩（bool 数组）。优先用饱和度遮罩（排除灰底+水印）。"""
    a = np.asarray(im).astype(np.float32) / 255.0
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    s = mx - mn
    mask = (s > 0.12) & (mx > 0.12) & (mx < 0.96)
    if mask.sum() < 80:
        # 兜底：角点取背景色，欧氏距离抠底
        arr = np.asarray(im).astype(np.float32)
        h, w = arr.shape[:2]
        corners = np.concatenate([
            arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]
        ], axis=0).reshape(4, 3)
        bg = corners.mean(axis=0)
        d = np.sqrt(((arr - bg) ** 2).sum(axis=2))
        mask = d > 55
    return mask


def whiten(arr, mask):
    """把背景（角点同色）漂成纯白，并抹掉浅灰角标水印（低饱和+偏暗的文字）。
    金属笔尖是银灰、与背景有色差 → 欧氏距离大 → 不会被漂成白（保留可见）。
    返回 (白底 RGB 数组, 笔身遮罩)。"""
    h, w = arr.shape[:2]
    corners = np.array([
        arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]
    ], dtype=np.float32)
    bg = corners.mean(axis=0)
    d = np.sqrt(((arr - bg) ** 2).sum(axis=2))
    out = arr.copy()
    out[d <= 75] = 255  # 背景（含浅灰渐变）→ 白

    # 水印：低饱和且偏暗（深色浅灰字），不是彩色笔身 → 也描白
    mx = arr.max(axis=2) / 255.0
    mn = arr.min(axis=2) / 255.0
    sat = mx - mn
    val = mx
    wm = (sat < 0.10) & (val < 0.55)
    out[wm] = 255
    return out, mask


def process(color):
    files = glob.glob(os.path.join(SRC, color, '*.png'))
    if not files:
        print('  ⚠ 跳过（找不到 %s 的生成图）' % color)
        return
    src = files[0]
    im = Image.open(src).convert('RGB')
    try:
        from PIL import ImageOps
        im = ImageOps.exif_transpose(im)
    except Exception:
        pass
    mask = isolate_pen(im)
    ys, xs = np.where(mask)
    if len(xs) < 50:
        print('  ⚠ %s 抠图失败（前景像素过少）' % color)
        return
    arr = np.asarray(im).astype(np.float32)
    white, _ = whiten(arr, mask)

    x0, x1 = xs.min() - PAD, xs.max() + PAD
    y0, y1 = ys.min() - PAD, ys.max() + PAD
    hh, ww = im.size[1], im.size[0]
    x0, x1 = max(0, x0), min(ww, x1)
    y0, y1 = max(0, y0), min(hh, y1)
    crop = Image.fromarray(white[y0:y1, x0:x1].astype(np.uint8), 'RGB')

    # 等比铺进 SIZE×SIZE 白底
    cw, ch = crop.size
    scale = (SIZE - 4) / max(cw, ch)
    nw, nh = max(1, int(round(cw * scale))), max(1, int(round(ch * scale)))
    crop = crop.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGB', (SIZE, SIZE), (255, 255, 255))
    canvas.paste(crop, ((SIZE - nw) // 2, (SIZE - nh) // 2))

    name = 'pen_%s.jpg' % CODE[color]
    path = os.path.join(OUT, name)
    canvas.save(path, 'JPEG', quality=QUALITY, optimize=True, progressive=True)
    print('  ✅ %-10s %s  (%d px, %dKB)' %
          (name, src, len(xs), os.path.getsize(path) // 1024))


def main():
    os.makedirs(OUT, exist_ok=True)
    for c in COLORS:
        process(c)
    total = sum(os.path.getsize(os.path.join(OUT, 'pen_%s.jpg' % CODE[c])) for c in COLORS)
    print('\n  → 6 张笔图已写入 assets/recall/，合计 %dKB' % (total // 1024))


if __name__ == '__main__':
    main()
