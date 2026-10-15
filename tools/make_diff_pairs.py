#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
图片找不同 · 差异图对生成管线（主题场景版 v2：更细腻的插画风）

用法：
    python tools/make_diff_pairs.py                  # 没有源图 → 自动生成主题场景，产出 60 对
    python tools/make_diff_pairs.py 图1.jpg 图2.jpg  # 用你给的图当底图，产出 60 对（区域变换法）
    python tools/make_diff_pairs.py --clear 图1.jpg  # 先清空已有资源再输出
    python tools/make_diff_pairs.py --count 60        # 产出对数（默认 60，与游戏关数一致）
    python tools/make_diff_pairs.py --size 720        # 输出边长（正方形）
    python tools/make_diff_pairs.py --budget 2.5      # assets/diff 合计体积预算（MB，默认 2.5）

自动生成（无源图）做了什么：
  1. 6 套主题场景：公园 / 厨房 / 马路 / 房间 / 海洋 / 太空。每套由「可辨识物件」拼成
     （太阳、云、树、花、鸟、鱼、车、房子、窗户、星球、星星、苹果、杯子、球、
      鸭子、蘑菇、蝴蝶、小船、蛋糕、交通灯、火箭、书……），插画风、带明暗立体感，
      不再是单调的扁平色块 / 几何图形。
  2. 每处差异都是「语义差异」：某个物件在 B 图里 变色 / 消失 / 冒出来，
     而不是旧版那种「随机区域换色」的色块——玩起来像真的找不同。
  3. 差异位置用物件自身包围盒记录为归一化矩形（与图片尺寸解耦），游戏据此判定点中与否。
  4. 压体积：单张 120KB 上限 + 整包预算（默认 2.5MB）。整包超了逐档降质量、再降尺寸，
     每关随机数按关卡号播种，重生成只换压缩档、差异位置不变。小游戏主包上限 4MB。

产出：
    assets/diff/dNN_a.jpg  dNN_b.jpg
    js/game/diffAssets.js —— 清单（含 a/b 路径 + 主色 + 差异矩形），游戏直接读
"""
import io
import os
import sys
import math
import random
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'assets', 'diff')
MANIFEST = os.path.join(ROOT, 'js', 'game', 'diffAssets.js')

SIZE = 720          # 输出边长（正方形）
BUDGET = 120 * 1024  # 单张体积预算
COUNT = 60          # 默认产出对数（与游戏关数一致）

# 难度曲线：差异数量随关卡递增（和照片拼图同样的 3×3→8×8 节奏感）
BANDS = [
    (3, 1, 8), (4, 9, 18), (5, 19, 30),
    (6, 31, 42), (7, 43, 52), (8, 53, 60)
]


def count_for_level(n):
    for k, lo, hi in BANDS:
        if lo <= n <= hi:
            return k
    return 8


# ---------------------------------------------------------------- 调色板
PALETTE = [
    (231, 76, 60), (241, 196, 15), (46, 204, 113), (52, 152, 219), (155, 89, 182),
    (230, 126, 34), (26, 188, 156), (142, 68, 173), (39, 174, 96), (22, 160, 133),
    (41, 128, 185), (243, 156, 18), (16, 172, 132), (135, 203, 255), (214, 90, 150),
]
GREENS = [(60, 170, 90), (46, 204, 113), (39, 174, 96), (26, 188, 156), (120, 200, 120)]
WALLS = [(235, 225, 210), (210, 225, 235), (225, 210, 225), (245, 235, 200), (220, 235, 225)]
REDS = [(231, 76, 60), (192, 57, 43), (230, 126, 34), (200, 60, 70), (214, 90, 90)]


def _tint(col, f):
    """f>0 向白提亮，f<0 向黑压暗，返回新 RGB。"""
    if f >= 0:
        return tuple(int(c + (255 - c) * f) for c in col)
    return tuple(max(0, int(c * (1 + f))) for c in col)


def pick_other(col, rng):
    for _ in range(20):
        c = rng.choice(PALETTE)
        if max(abs(c[0] - col[0]), abs(c[1] - col[1]), abs(c[2] - col[2])) > 70:
            return c
    return rng.choice(PALETTE)


# ---------------------------------------------------------------- 通用工具
def center_square(im):
    w, h = im.size
    if w == h:
        return im
    s = min(w, h)
    left = (w - s) // 2
    top = (h - s) // 2
    return im.crop((left, top, left + s, top + s))


def dominant_color(im):
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
        if 40 < lum < 225:
            return (r, g, b)
    if cands:
        _, r, g, b = cands[0]
        return (r, g, b)
    return (120, 120, 120)


def to_hex(c):
    return '#%02X%02X%02X' % c


def save_fit(im, path, qmax=88):
    """从 qmax 起逐档降质量，直到单张不超过 BUDGET。返回 (实际质量, 字节数)。"""
    ladder = [qmax] + [x for x in (84, 80, 75, 70, 65, 60, 55, 50, 45, 40) if x < qmax]
    for q in ladder:
        im.save(path, 'JPEG', quality=q, optimize=True, progressive=True)
        if os.path.getsize(path) <= BUDGET:
            return q, os.path.getsize(path)
    return 40, os.path.getsize(path)


def dir_bytes():
    """assets/diff 下全部 jpg 的合计字节数（用来盯小游戏主包预算）。"""
    total = 0
    if os.path.isdir(OUT_DIR):
        for f in os.listdir(OUT_DIR):
            if f.lower().endswith('.jpg'):
                total += os.path.getsize(os.path.join(OUT_DIR, f))
    return total


# ---------------------------------------------------------------- 绘图基元
def _ellipse(d, cx, cy, rx, ry, fill, outline=None, ow=0):
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=fill, outline=outline, width=ow)


def _orb(d, cx, cy, r, col):
    """带明暗的「球体」：底色 + 右下暗面 + 左上亮面 + 高光点，立体感。"""
    _ellipse(d, cx, cy, r, r, col)
    _ellipse(d, cx + r * 0.2, cy + r * 0.2, r * 0.85, r * 0.85, _tint(col, -0.28))
    _ellipse(d, cx - r * 0.32, cy - r * 0.32, r * 0.5, r * 0.5, _tint(col, 0.42))
    _ellipse(d, cx - r * 0.42, cy - r * 0.42, r * 0.16, r * 0.16, (255, 255, 255))


def _star(d, cx, cy, r, fill, outline=None, ow=0):
    pts = []
    for i in range(10):
        ang = math.pi / 2 + math.pi * i / 5
        rr = r if i % 2 == 0 else r * 0.45
        pts.append((cx + math.cos(ang) * rr, cy - math.sin(ang) * rr))
    d.polygon(pts, fill=fill, outline=outline, width=ow)


def _cloud(d, cx, cy, w, h, col):
    _ellipse(d, cx, cy, w, h, col)
    _ellipse(d, cx - w * 0.7, cy + h * 0.3, w * 0.75, h * 0.75, col)
    _ellipse(d, cx + w * 0.7, cy + h * 0.3, w * 0.75, h * 0.75, col)
    _ellipse(d, cx, cy - h * 0.3, w * 0.7, h * 0.7, _tint(col, 0.22))


def _fish(d, cx, cy, r, body):
    d.polygon([(cx - r * 0.9, cy), (cx - 1.8 * r, cy - r * 0.7), (cx - 1.8 * r, cy + r * 0.7)],
              fill=_tint(body, -0.15))
    _orb(d, cx, cy, r, body)
    d.polygon([(cx - r * 0.1, cy - r * 0.9), (cx + r * 0.4, cy - r * 1.3), (cx + r * 0.5, cy - r * 0.7)],
              fill=_tint(body, -0.1))
    d.polygon([(cx - r * 0.1, cy + r * 0.2), (cx + r * 0.2, cy + r * 0.7), (cx + r * 0.4, cy + r * 0.2)],
              fill=_tint(body, -0.1))
    _ellipse(d, cx + r * 1.2, cy - r * 0.9, r * 0.12, r * 0.12, (220, 240, 255))
    _ellipse(d, cx + r * 1.5, cy - r * 1.2, r * 0.08, r * 0.08, (220, 240, 255))
    _ellipse(d, cx + r * 0.45, cy - r * 0.15, r * 0.18, r * 0.18, (255, 255, 255))
    _ellipse(d, cx + r * 0.5, cy - r * 0.15, r * 0.09, r * 0.09, (20, 20, 20))


def _tree(d, cx, baseY, h, leaf):
    tw = max(7, h * 0.08)
    cr = h * 0.5
    d.rectangle([cx - tw / 2, baseY - h * 0.9, cx + tw / 2, baseY], fill=_tint((120, 86, 54), -0.1))
    d.rectangle([cx - tw / 2, baseY - h * 0.9, cx + tw / 2, baseY - h * 0.4], fill=_tint((120, 86, 54), 0.2))
    for dx, dy, rr in [(-cr * 0.55, -h, cr * 0.7), (cr * 0.55, -h, cr * 0.7),
                       (0, -h - cr * 0.5, cr * 0.85), (-cr * 0.2, -h - cr * 0.1, cr * 0.6)]:
        _orb(d, cx + dx, baseY + dy, rr, leaf)


def _sun(d, cx, cy, r, col):
    for k in range(12):
        ang = math.pi * 2 * k / 12
        d.line([(cx + math.cos(ang) * r * 1.05, cy + math.sin(ang) * r * 1.05),
                (cx + math.cos(ang) * r * 1.6, cy + math.sin(ang) * r * 1.6)],
               fill=col, width=max(3, int(r * 0.12)))
    _orb(d, cx, cy, r, col)


def _house(d, cx, baseY, h, w, wall):
    tw = h * 0.5
    d.rectangle([cx - w / 2, baseY - h + tw, cx + w / 2, baseY], fill=wall)
    d.rectangle([cx - w / 2, baseY - h + tw, cx + w / 2, baseY], outline=_tint(wall, -0.18), width=2)
    d.polygon([(cx - w / 2 - 10, baseY - h + tw), (cx + w / 2 + 10, baseY - h + tw),
               (cx, baseY - h - tw - 8)], fill=(150, 90, 70))
    d.polygon([(cx - w / 2 - 10, baseY - h + tw), (cx, baseY - h - tw - 8), (cx - w * 0.2, baseY - h + tw)],
              fill=(170, 100, 80))
    d.rectangle([cx - w * 0.12, baseY - h * 0.5, cx + w * 0.12, baseY], fill=_tint(wall, -0.3))
    d.rectangle([cx + w * 0.28, baseY - h * 0.6, cx + w * 0.5, baseY - h * 0.35], fill=(150, 200, 230))
    d.rectangle([cx - w * 0.5, baseY - h * 0.6, cx - w * 0.28, baseY - h * 0.35], fill=(150, 200, 230))
    d.rectangle([cx + w * 0.3, baseY - h - tw - 2, cx + w * 0.45, baseY - h + tw], fill=(160, 90, 80))


def _car(d, cx, baseY, w, h, body):
    d.rounded_rectangle([cx - w / 2, baseY - h, cx + w / 2, baseY - h * 0.4], radius=h * 0.25, fill=body)
    d.rounded_rectangle([cx - w * 0.3, baseY - h * 1.1, cx + w * 0.3, baseY - h * 0.45], radius=h * 0.2, fill=body)
    d.rounded_rectangle([cx - w * 0.3, baseY - h * 1.1, cx + w * 0.3, baseY - h * 0.45],
                        outline=_tint(body, -0.2), width=2)
    d.rounded_rectangle([cx - w * 0.22, baseY - h * 1.0, cx - w * 0.02, baseY - h * 0.52], radius=h * 0.1,
                        fill=(190, 225, 245))
    d.rounded_rectangle([cx + w * 0.02, baseY - h * 1.0, cx + w * 0.22, baseY - h * 0.52], radius=h * 0.1,
                        fill=(190, 225, 245))
    for wx in (cx - w * 0.3, cx + w * 0.3):
        _orb(d, wx, baseY - h * 0.28, h * 0.32, (40, 40, 45))
        _ellipse(d, wx, baseY - h * 0.28, h * 0.14, h * 0.14, (150, 150, 160))
    _ellipse(d, cx + w * 0.46, baseY - h * 0.7, h * 0.1, h * 0.1, (255, 240, 160))


def _planet(d, cx, cy, r, col):
    _orb(d, cx, cy, r, col)
    _ellipse(d, cx - r * 0.3, cy - r * 0.1, r * 0.18, r * 0.18, _tint(col, -0.2))
    _ellipse(d, cx + r * 0.25, cy + r * 0.3, r * 0.12, r * 0.12, _tint(col, -0.2))
    d.ellipse([cx - 1.6 * r, cy - r * 0.4, cx + 1.6 * r, cy + r * 0.4], outline=_tint(col, 0.5),
              width=max(3, int(r * 0.14)))


def _bird(d, cx, cy, r, col):
    _ellipse(d, cx, cy + r * 0.2, r * 0.5, r * 0.35, col)
    d.line([(cx - 1.6 * r, cy), (cx - 0.5 * r, cy - 0.9 * r), (cx, cy)], fill=col, width=max(3, int(r * 0.3)))
    d.line([(cx, cy), (cx + 0.5 * r, cy - 0.9 * r), (cx + 1.6 * r, cy)], fill=col, width=max(3, int(r * 0.3)))


def _cup(d, cx, baseY, w, h, col):
    d.ellipse([cx - w * 0.7, baseY - 6, cx + w * 0.7, baseY + 8], fill=_tint(col, -0.1))
    d.rounded_rectangle([cx - w / 2, baseY - h, cx + w / 2, baseY], radius=w * 0.12, fill=col)
    d.rounded_rectangle([cx - w / 2, baseY - h, cx + w / 2, baseY], outline=_tint(col, -0.2), width=2)
    d.rectangle([cx - w / 2, baseY - h * 0.78, cx + w / 2, baseY - h * 0.66], fill=(255, 255, 255))
    d.arc([cx + w / 2 - 4, baseY - h * 0.7, cx + w / 2 + w * 0.5, baseY - h * 0.1],
          start=270, end=90, fill=col, width=max(4, int(w * 0.14)))


def _apple(d, cx, cy, r, col):
    _orb(d, cx - r * 0.5, cy, r * 0.85, col)
    _orb(d, cx + r * 0.5, cy, r * 0.85, col)
    d.rectangle([cx - 2, cy - r * 1.2, cx + 2, cy - r * 0.8], fill=(110, 70, 40))
    _ellipse(d, cx + r * 0.4, cy - r * 1.0, r * 0.3, r * 0.18, (80, 170, 70))
    _ellipse(d, cx - r * 0.6, cy - r * 0.2, r * 0.22, r * 0.22, (255, 255, 255))


def _ball(d, cx, cy, r, col):
    _orb(d, cx, cy, r, col)
    d.line([(cx - r, cy), (cx + r, cy)], fill=(255, 255, 255), width=max(2, int(r * 0.12)))
    d.line([(cx, cy - r), (cx, cy + r)], fill=(255, 255, 255), width=max(2, int(r * 0.12)))


def _window(d, cx, cy, w, h, glass):
    frame = (180, 140, 90)
    d.rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], fill=glass)
    d.rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], outline=frame, width=max(4, int(w * 0.1)))
    d.line([(cx, cy - h / 2), (cx, cy + h / 2)], fill=frame, width=max(2, int(w * 0.06)))
    d.line([(cx - w / 2, cy), (cx + w / 2, cy)], fill=frame, width=max(2, int(w * 0.06)))
    d.rectangle([cx - w / 2 - 6, cy + h / 2, cx + w / 2 + 6, cy + h / 2 + w * 0.12], fill=frame)


def _mushroom(d, cx, baseY, w, h, cap):
    d.rectangle([cx - w * 0.22, baseY - h * 0.55, cx + w * 0.22, baseY], fill=(245, 240, 225))
    d.rectangle([cx - w * 0.22, baseY - h * 0.55, cx + w * 0.22, baseY], outline=(210, 200, 180), width=2)
    d.ellipse([cx - w * 0.9, baseY - h * 1.0, cx + w * 0.9, baseY - h * 0.1], fill=cap)
    d.ellipse([cx - w * 0.9, baseY - h * 1.0, cx + w * 0.9, baseY - h * 0.1], outline=_tint(cap, -0.2), width=2)
    for sx, sy in [(-w * 0.4, -h * 0.6), (w * 0.3, -h * 0.7), (0, -h * 0.45), (w * 0.5, -h * 0.45)]:
        _ellipse(d, cx + sx, baseY + sy, w * 0.16, w * 0.16, (255, 255, 255))


def _duck(d, cx, baseY, r, body):
    _orb(d, cx, baseY - r * 0.5, r * 1.1, body)
    _orb(d, cx + r * 0.9, baseY - r * 1.5, r * 0.6, body)
    d.polygon([(cx + r * 1.4, baseY - r * 1.5), (cx + r * 1.9, baseY - r * 1.35),
               (cx + r * 1.4, baseY - r * 1.2)], fill=(245, 150, 40))
    _ellipse(d, cx + r * 1.0, baseY - r * 1.6, r * 0.1, r * 0.1, (20, 20, 20))
    _ellipse(d, cx - r * 0.1, baseY - r * 0.6, r * 0.6, r * 0.35, _tint(body, -0.12))


def _butterfly(d, cx, cy, r, col):
    for sx in (-1, 1):
        d.ellipse([cx + sx * r * 1.3 - r * 0.7, cy - r * 1.2, cx + sx * r * 1.3 + r * 0.7, cy - r * 0.1], fill=col)
        d.ellipse([cx + sx * r * 1.1 - r * 0.6, cy - r * 0.1, cx + sx * r * 1.1 + r * 0.6, cy + r * 1.1],
                  fill=_tint(col, 0.2))
    d.line([(cx, cy - r * 1.3), (cx, cy + r * 1.3)], fill=(60, 60, 70), width=max(3, int(r * 0.18)))
    d.line([(cx, cy - r * 1.2), (cx - r * 0.4, cy - r * 1.6)], fill=(60, 60, 70), width=max(2, int(r * 0.12)))
    d.line([(cx, cy - r * 1.2), (cx + r * 0.4, cy - r * 1.6)], fill=(60, 60, 70), width=max(2, int(r * 0.12)))


def _boat(d, cx, baseY, w, h, sail):
    d.polygon([(cx - w * 0.5, baseY - h * 0.4), (cx + w * 0.5, baseY - h * 0.4),
               (cx + w * 0.3, baseY), (cx - w * 0.3, baseY)], fill=(150, 90, 60))
    d.line([(cx, baseY - h * 0.4), (cx, baseY - h * 2.2)], fill=(120, 80, 50), width=max(3, int(h * 0.12)))
    d.polygon([(cx, baseY - h * 2.1), (cx, baseY - h * 0.6), (cx + w * 0.5, baseY - h * 0.6)], fill=sail)
    d.polygon([(cx, baseY - h * 2.1), (cx, baseY - h * 0.6), (cx - w * 0.45, baseY - h * 0.6)],
              fill=_tint(sail, 0.25))


def _cake(d, cx, baseY, w, h, cream):
    d.ellipse([cx - w * 0.7, baseY - h * 0.2, cx + w * 0.7, baseY + 6], fill=(230, 230, 235))
    d.rectangle([cx - w / 2, baseY - h * 0.9, cx + w / 2, baseY - h * 0.2], fill=cream)
    d.rectangle([cx - w / 2, baseY - h * 0.9, cx + w / 2, baseY - h * 0.6], fill=(255, 240, 230))
    _orb(d, cx, baseY - h * 1.05, w * 0.12, (220, 50, 60))


def _traffic_light(d, cx, baseY, w, h, mid):
    d.rectangle([cx - w * 0.12, baseY - h * 0.3, cx + w * 0.12, baseY], fill=(90, 90, 100))
    d.rounded_rectangle([cx - w * 0.7, baseY - h, cx + w * 0.7, baseY - h * 0.3], radius=w * 0.2, fill=(50, 50, 60))
    for i, col in enumerate([(220, 50, 50), mid, (60, 200, 80)]):
        cyy = baseY - h * 0.55 - i * h * 0.22
        _orb(d, cx, cyy, w * 0.5, col)


def _rocket(d, cx, cy, r, body):
    d.polygon([(cx, cy - 2.0 * r), (cx - r * 0.7, cy - r * 0.7), (cx + r * 0.7, cy - r * 0.7)], fill=(220, 60, 60))
    d.rounded_rectangle([cx - r * 0.6, cy - r * 0.7, cx + r * 0.6, cy + r * 0.6], radius=r * 0.3, fill=body)
    d.rounded_rectangle([cx - r * 0.6, cy - r * 0.7, cx + r * 0.6, cy + r * 0.6], outline=(150, 160, 175), width=2)
    _orb(d, cx, cy - r * 0.1, r * 0.32, (120, 190, 230))
    d.polygon([(cx - r * 0.6, cy + r * 0.2), (cx - r * 1.1, cy + r * 0.7), (cx - r * 0.5, cy + r * 0.6)],
              fill=(220, 60, 60))
    d.polygon([(cx + r * 0.6, cy + r * 0.2), (cx + r * 1.1, cy + r * 0.7), (cx + r * 0.5, cy + r * 0.6)],
              fill=(220, 60, 60))
    d.polygon([(cx - r * 0.3, cy + r * 0.6), (cx, cy + r * 1.2), (cx + r * 0.3, cy + r * 0.6)], fill=(255, 180, 40))
    d.polygon([(cx - r * 0.15, cy + r * 0.6), (cx, cy + r * 0.95), (cx + r * 0.15, cy + r * 0.6)],
              fill=(255, 240, 120))


def _book(d, cx, baseY, w, h, cover):
    d.rectangle([cx - w / 2, baseY - h, cx + w / 2, baseY], fill=cover)
    d.rectangle([cx - w / 2, baseY - h, cx + w / 2, baseY], outline=_tint(cover, -0.25), width=2)
    for i in range(4):
        d.line([(cx - w / 2 + 4, baseY - h * 0.2 * (i + 1)), (cx + w / 2 - 4, baseY - h * 0.2 * (i + 1))],
               fill=(250, 248, 240), width=2)
    d.rectangle([cx - w * 0.12, baseY - h, cx + w * 0.12, baseY], fill=_tint(cover, -0.15))


# ---------------------------------------------------------------- 差异物件
def F(bbox, a, b, normal=None, **meta):
    # normal = 该物件"不做差异时"的正常画法；没被选为差异的物件两张图都用它，
    # 否则 show 类差异（A 空、B 有）在落选时会两边都空、物件凭空消失。
    d = {'bbox': [int(round(x)) for x in bbox], 'a': a, 'b': b, 'normal': normal or a}
    d.update(meta)
    return d


def _diffable(bbox, paint, color, mode, rng, recolor_color=None):
    """把一个可绘制物件包装成差异物件。

    mode:
      recolor —— A/B 用不同颜色（最经典的"找不同"）
      hide    —— 物件只在 A 出现，B 里消失
      show    —— 物件只在 B 出现，A 里没有
    """
    base = lambda d, c=color: paint(d, c)
    if mode == 'recolor':
        c2 = recolor_color if recolor_color else pick_other(color, rng)
        return F(bbox, base, lambda d, c2=c2: paint(d, c2), normal=base,
                 mode=mode, color=color, c2=c2)
    if mode == 'hide':
        return F(bbox, base, lambda d: None, normal=base, mode=mode, color=color, c2=None)
    return F(bbox, lambda d: None, base, normal=base, mode=mode, color=color, c2=None)


# ---------------------------------------------------------------- 差异物件工厂
# 每个工厂返回 F(...)，paint(d, c) 里 c 是该物件主色；recolor 时 c 会变，
# 因此每个物件的 paint 都必须用到 c（否则 recolor 看不出差异）。
def flower_feature(cx, cy, s, mode, rng):
    r = s
    bbox = [cx - 2.4 * r, cy - 2.4 * r, cx + 2.4 * r, cy + 2.4 * r]
    petal = rng.choice(PALETTE)

    def paint(d, c):
        d.line([(cx, cy + r * 0.4), (cx, cy + r * 2.4)], fill=(58, 150, 72), width=max(3, int(r * 0.18)))
        _ellipse(d, cx + r * 0.55, cy + r * 1.5, r * 0.5, r * 0.26, (74, 170, 84))
        for k in range(6):
            ang = math.pi * 2 * k / 6
            px = cx + math.cos(ang) * r * 0.62
            py = cy + math.sin(ang) * r * 0.62
            _ellipse(d, px, py, r * 0.42, r * 0.42, c)
            d.ellipse([px - r * 0.42, py - r * 0.42, px + r * 0.42, py + r * 0.42],
                      outline=_tint(c, -0.22), width=max(1, int(r * 0.07)))
        _orb(d, cx, cy, r * 0.34, (255, 214, 90))
    return _diffable(bbox, paint, petal, mode, rng)


def tree_feature(cx, baseY, s, mode, rng):
    h = s
    tw = max(7, h * 0.08)
    cr = h * 0.5
    bbox = [cx - cr * 1.5, baseY - h - cr, cx + cr * 1.5, baseY + tw + 2]
    leaf = rng.choice(GREENS)
    return _diffable(bbox, lambda d, c: _tree(d, cx, baseY, h, c), leaf, mode, rng)


def cloud_feature(cx, cy, s, mode, rng):
    w, h = s, s * 0.5
    bbox = [cx - 1.9 * w, cy - h * 1.3, cx + 2.1 * w, cy + h * 1.4]
    return _diffable(bbox, lambda d, c: _cloud(d, cx, cy, w, h, c), (250, 250, 252), mode, rng,
                     recolor_color=(190, 196, 206))


def sun_feature(cx, cy, s, mode, rng):
    r = s
    bbox = [cx - 1.6 * r, cy - 1.6 * r, cx + 1.6 * r, cy + 1.6 * r]
    return _diffable(bbox, lambda d, c: _sun(d, cx, cy, r, c), (255, 214, 90), mode, rng,
                     recolor_color=(243, 150, 40))


def bird_feature(cx, cy, s, mode, rng):
    r = s
    bbox = [cx - 1.8 * r, cy - 1.4 * r, cx + 1.8 * r, cy + 1.4 * r]
    return _diffable(bbox, lambda d, c: _bird(d, cx, cy, r, c), (70, 75, 90), mode, rng,
                     recolor_color=(200, 80, 80))


def fish_feature(cx, cy, s, mode, rng):
    r = s
    bbox = [cx - 1.9 * r, cy - 1.2 * r, cx + 1.9 * r, cy + 1.2 * r]
    col = rng.choice(PALETTE)
    return _diffable(bbox, lambda d, c: _fish(d, cx, cy, r, c), col, mode, rng)


def star_feature(cx, cy, s, mode, rng):
    r = s
    bbox = [cx - 1.3 * r, cy - 1.3 * r, cx + 1.3 * r, cy + 1.3 * r]
    col = rng.choice(PALETTE)

    def paint(d, c):
        _star(d, cx, cy, r, c, outline=_tint(c, -0.2), ow=max(2, int(r * 0.08)))
        _star(d, cx, cy, r * 0.5, _tint(c, 0.4))
    return _diffable(bbox, paint, col, mode, rng)


def house_feature(cx, baseY, s, mode, rng):
    h = s * 1.4
    w = s * 1.6
    bbox = [cx - w / 2 - 14, baseY - h - s * 0.6 - 10, cx + w / 2 + 14, baseY + 8]
    wall = rng.choice(WALLS)
    return _diffable(bbox, lambda d, c: _house(d, cx, baseY, h, w, c), wall, mode, rng)


def car_feature(cx, baseY, s, mode, rng):
    w, h = s * 2.0, s * 0.9
    bbox = [cx - w / 2, baseY - h * 1.3, cx + w / 2, baseY + h * 0.2]
    body = rng.choice(PALETTE)
    return _diffable(bbox, lambda d, c: _car(d, cx, baseY, w, h, c), body, mode, rng)


def planet_feature(cx, cy, s, mode, rng):
    r = s
    bbox = [cx - 1.7 * r, cy - 1.7 * r, cx + 1.7 * r, cy + 1.7 * r]
    col = rng.choice(PALETTE)
    return _diffable(bbox, lambda d, c: _planet(d, cx, cy, r, c), col, mode, rng)


def window_feature(cx, cy, s, mode, rng):
    w, h = s * 1.4, s * 1.6
    bbox = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
    return _diffable(bbox, lambda d, c: _window(d, cx, cy, w, h, c), (200, 230, 250), mode, rng,
                     recolor_color=(255, 220, 150))


def ball_feature(cx, cy, s, mode, rng):
    r = s
    bbox = [cx - 1.1 * r, cy - 1.1 * r, cx + 1.1 * r, cy + 1.1 * r]
    col = rng.choice(PALETTE)
    return _diffable(bbox, lambda d, c: _ball(d, cx, cy, r, c), col, mode, rng)


def cup_feature(cx, baseY, s, mode, rng):
    w, h = s * 1.2, s * 1.4
    bbox = [cx - w / 2, baseY - h, cx + w / 2 + w * 0.6, baseY + 4]
    col = rng.choice(PALETTE)
    return _diffable(bbox, lambda d, c: _cup(d, cx, baseY, w, h, c), col, mode, rng)


def apple_feature(cx, cy, s, mode, rng):
    r = s
    bbox = [cx - 1.2 * r, cy - 1.3 * r, cx + 1.2 * r, cy + 1.2 * r]
    col = rng.choice(REDS)
    return _diffable(bbox, lambda d, c: _apple(d, cx, cy, r, c), col, mode, rng)


def mushroom_feature(cx, baseY, s, mode, rng):
    h = s * 1.2
    w = s * 1.2
    bbox = [cx - w * 0.9, baseY - h, cx + w * 0.9, baseY + 4]
    cap = rng.choice([(231, 76, 60), (192, 57, 43), (214, 90, 150), (241, 196, 15)])
    return _diffable(bbox, lambda d, c: _mushroom(d, cx, baseY, w, h, c), cap, mode, rng)


def duck_feature(cx, baseY, s, mode, rng):
    r = s
    bbox = [cx - 1.6 * r, baseY - 1.8 * r, cx + 1.6 * r, baseY + 4]
    return _diffable(bbox, lambda d, c: _duck(d, cx, baseY, r, c), (255, 221, 60), mode, rng)


def butterfly_feature(cx, cy, s, mode, rng):
    r = s
    bbox = [cx - 1.4 * r, cy - 1.4 * r, cx + 1.4 * r, cy + 1.4 * r]
    col = rng.choice(PALETTE)
    return _diffable(bbox, lambda d, c: _butterfly(d, cx, cy, r, c), col, mode, rng)


def boat_feature(cx, baseY, s, mode, rng):
    w = s * 2.2
    h = s
    bbox = [cx - w / 2, baseY - h * 2.4, cx + w / 2, baseY + 4]
    return _diffable(bbox, lambda d, c: _boat(d, cx, baseY, w, h, c), (245, 245, 250), mode, rng,
                     recolor_color=(235, 120, 120))


def cake_feature(cx, baseY, s, mode, rng):
    w = s * 1.6
    h = s * 1.2
    bbox = [cx - w / 2, baseY - h, cx + w / 2, baseY + 4]
    return _diffable(bbox, lambda d, c: _cake(d, cx, baseY, w, h, c), (245, 160, 180), mode, rng,
                     recolor_color=(120, 200, 120))


def traffic_light_feature(cx, baseY, s, mode, rng):
    w = s * 0.6
    h = s * 2.2
    bbox = [cx - w * 1.0, baseY - h, cx + w * 1.0, baseY + 4]
    return _diffable(bbox, lambda d, c: _traffic_light(d, cx, baseY, w, h, c), (240, 200, 40), mode, rng)


def rocket_feature(cx, cy, s, mode, rng):
    r = s
    bbox = [cx - 1.2 * r, cy - 2.0 * r, cx + 1.2 * r, cy + 1.2 * r]
    return _diffable(bbox, lambda d, c: _rocket(d, cx, cy, r, c), (235, 238, 245), mode, rng)


def book_feature(cx, baseY, s, mode, rng):
    w = s * 1.6
    h = s * 1.1
    bbox = [cx - w / 2 - 6, baseY - h, cx + w / 2 + 6, baseY + 4]
    cover = rng.choice(PALETTE)
    return _diffable(bbox, lambda d, c: _book(d, cx, baseY, w, h, c), cover, mode, rng)


def add_feature(features, kind, fx, fy, fs, mode, rng, size):
    # 主题里 fx/fy 是比例(0~1)，fs 已是像素尺寸（如 size*0.2），这里只把比例转像素
    cx, cy, s = fx * size, fy * size, fs
    table = {
        'flower': flower_feature, 'tree': tree_feature, 'cloud': cloud_feature, 'sun': sun_feature,
        'bird': bird_feature, 'fish': fish_feature, 'star': star_feature, 'house': house_feature,
        'car': car_feature, 'planet': planet_feature, 'window': window_feature, 'ball': ball_feature,
        'cup': cup_feature, 'apple': apple_feature, 'mushroom': mushroom_feature, 'duck': duck_feature,
        'butterfly': butterfly_feature, 'boat': boat_feature, 'cake': cake_feature,
        'traffic_light': traffic_light_feature, 'rocket': rocket_feature, 'book': book_feature,
    }
    if kind in table:
        features.append(table[kind](cx, cy, s, mode, rng))


def rmode(rng):
    """差异类型偏好：变色最常见，消失/出现次之。"""
    return rng.choice(['recolor', 'recolor', 'recolor', 'hide', 'show'])


# ---------------------------------------------------------------- 背景
def bg_gradient(size, top, bot):
    img = Image.new('RGB', (size, size), top)
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / size
        r = int(top[0] * (1 - t) + bot[0] * t)
        g = int(top[1] * (1 - t) + bot[1] * t)
        b = int(top[2] * (1 - t) + bot[2] * t)
        d.line([(0, y), (size, y)], fill=(r, g, b))
    return img


# ---------------------------------------------------------------- 主题场景
def place(features, kind, col, row, cols, rows, size, fs_px, mode, rng, base=False):
    """把物件放到 4×4 网格的某个格子里（带轻微抖动），保证彼此留出 >= 物件尺寸的间距，
    这样 pick_diff_features 总能从一关里挑出足够的、互不重叠的差异。"""
    cw = size / cols
    ch = size / rows
    jx, jy = 0.08, 0.06
    cx = (col + 0.5) * cw + rng.uniform(-jx, jx) * cw
    if base:
        # 底部锚定（树/房子/车/杯/苹果/球/…坐在地上/桌上）。
        # 锚点抬到格子下沿上方 0.28 格，给物件自身向下延伸的余量，避免球/苹果等
        # 包围盒超出画面下边缘被裁切。
        cy = (row + 1) * ch - ch * 0.28
    else:
        cy = (row + 0.5) * ch + rng.uniform(-jy, jy) * ch
    add_feature(features, kind, cx / size, cy / size, fs_px, mode, rng, size)


def _grass(d, y0, size, rng, n=None):
    n = n or int(size * 0.9)
    for _ in range(n):
        x = rng.randint(0, size - 1)
        y = rng.randint(int(y0 + size * 0.02), size - 2)
        hh = rng.randint(6, 16)
        d.line([(x, y), (x + rng.randint(-3, 3), y - hh)], fill=(90, 170, 100), width=2)


def _waves(d, y0, size, rng):
    for y in range(int(y0), size, max(10, int(size * 0.03))):
        pts = []
        for x in range(0, size + 1, max(8, int(size * 0.05))):
            yy = y + int(math.sin((x / size) * 6.28 * 3 + y) * 4)
            pts.append((x, yy))
        d.line(pts, fill=(255, 255, 255), width=2)


def _bubbles(d, size, rng, n=40):
    for _ in range(n):
        x = rng.randint(0, size - 1)
        y = rng.randint(int(size * 0.5), size - 1)
        r = rng.randint(2, 6)
        d.ellipse([x - r, y - r, x + r, y + r], outline=(220, 245, 255), width=2)


def theme_park(rng, size):
    img = bg_gradient(size, (135, 206, 250), (200, 235, 255))
    d = ImageDraw.Draw(img)
    hz = int(size * 0.46)
    d.rectangle([0, hz, size, size], fill=(120, 200, 130))
    d.ellipse([-size * 0.2, hz - size * 0.18, size * 0.5, hz + size * 0.12], fill=(150, 210, 150))
    d.ellipse([size * 0.55, hz - size * 0.22, size * 1.25, hz + size * 0.12], fill=(140, 205, 145))
    d.ellipse([size * 0.42, hz + size * 0.45, size * 0.72, hz + size * 0.78], fill=(90, 170, 210))
    d.ellipse([size * 0.42, hz + size * 0.45, size * 0.72, hz + size * 0.78], outline=(70, 150, 190), width=3)
    _grass(d, hz, size, rng)
    fs = []
    cells = [
        ('sun', 0, 0, 0.06, False), ('cloud', 1, 0, 0.05, False),
        ('cloud', 2, 0, 0.05, False), ('cloud', 3, 0, 0.05, False),
        ('bird', 2, 1, 0.03, False), ('butterfly', 1, 1, 0.035, False),
        ('tree', 0, 2, 0.07, True), ('tree', 1, 2, 0.07, True),
        ('tree', 2, 2, 0.07, True), ('tree', 3, 2, 0.07, True),
        ('flower', 0, 3, 0.035, False), ('duck', 1, 3, 0.05, True),
        ('flower', 2, 3, 0.035, False), ('mushroom', 3, 3, 0.05, True),
    ]
    for kind, col, row, fsf, base in cells:
        place(fs, kind, col, row, 4, 4, size, size * fsf, rmode(rng), rng, base=base)
    return img, fs


def theme_kitchen(rng, size):
    img = bg_gradient(size, (245, 235, 220), (232, 222, 205))
    d = ImageDraw.Draw(img)
    for x in range(0, size, int(size * 0.09)):
        d.line([(x, 0), (x, int(size * 0.55))], fill=(225, 214, 198), width=2)
    for y in range(0, int(size * 0.55), int(size * 0.09)):
        d.line([(0, y), (size, y)], fill=(225, 214, 198), width=2)
    tbl = int(size * 0.55)
    d.rectangle([0, tbl, size, size], fill=(180, 130, 90))
    d.rectangle([0, tbl, size, tbl + int(size * 0.04)], fill=(200, 150, 105))
    for y in range(tbl, size, int(size * 0.05)):
        d.line([(0, y), (size, y)], fill=(165, 118, 80), width=1)
    fs = []
    cells = [
        ('window', 0, 0, 0.10, False), ('window', 1, 0, 0.10, False),
        ('star', 2, 0, 0.05, False), ('star', 3, 0, 0.05, False),
        ('cup', 0, 2, 0.05, True), ('apple', 1, 2, 0.05, True),
        ('ball', 2, 2, 0.05, True), ('cup', 3, 2, 0.05, True),
        ('apple', 0, 3, 0.05, True), ('ball', 1, 3, 0.05, True),
        ('cake', 2, 3, 0.07, True), ('apple', 3, 3, 0.05, True),
    ]
    for kind, col, row, fsf, base in cells:
        place(fs, kind, col, row, 4, 4, size, size * fsf, rmode(rng), rng, base=base)
    return img, fs


def theme_traffic(rng, size):
    img = bg_gradient(size, (150, 200, 245), (205, 235, 255))
    d = ImageDraw.Draw(img)
    hz = int(size * 0.55)
    d.ellipse([-size * 0.2, hz - size * 0.2, size * 0.5, hz + size * 0.12], fill=(150, 205, 145))
    d.ellipse([size * 0.6, hz - size * 0.24, size * 1.25, hz + size * 0.12], fill=(140, 200, 140))
    d.rectangle([0, hz, size, size], fill=(120, 200, 130))
    road = int(size * 0.84)
    d.rectangle([0, road, size, size], fill=(92, 92, 102))
    d.rectangle([0, road, size, road + int(size * 0.03)], fill=(120, 120, 130))
    for x in range(0, size, int(size * 0.12)):
        d.rectangle([x, (road + size) // 2 - 4, x + int(size * 0.05), (road + size) // 2 + 4],
                    fill=(240, 230, 120))
    fs = []
    cells = [
        ('sun', 0, 0, 0.06, False), ('cloud', 1, 0, 0.05, False),
        ('cloud', 2, 0, 0.05, False), ('cloud', 3, 0, 0.05, False),
        ('bird', 2, 1, 0.03, False),
        ('tree', 0, 2, 0.07, True), ('traffic_light', 1, 2, 0.07, True),
        ('tree', 2, 2, 0.07, True), ('tree', 3, 2, 0.07, True),
        ('car', 0, 3, 0.05, True), ('car', 1, 3, 0.05, True),
        ('house', 2, 3, 0.10, True), ('car', 3, 3, 0.05, True),
    ]
    for kind, col, row, fsf, base in cells:
        place(fs, kind, col, row, 4, 4, size, size * fsf, rmode(rng), rng, base=base)
    return img, fs


def theme_room(rng, size):
    img = bg_gradient(size, (226, 216, 206), (210, 200, 190))
    d = ImageDraw.Draw(img)
    for x in range(0, size, int(size * 0.12)):
        d.line([(x, 0), (x, int(size * 0.55))], fill=(212, 202, 192), width=3)
    d.rectangle([0, int(size * 0.55), size, size], fill=(170, 140, 110))
    for y in range(int(size * 0.55), size, int(size * 0.06)):
        d.line([(0, y), (size, y)], fill=(155, 125, 98), width=1)
    d.ellipse([size * 0.3, size * 0.78, size * 0.7, size * 0.95], fill=(150, 110, 170))
    d.ellipse([size * 0.3, size * 0.78, size * 0.7, size * 0.95], outline=(120, 85, 140), width=3)
    fs = []
    cells = [
        ('window', 0, 0, 0.10, False), ('window', 1, 0, 0.10, False),
        ('star', 2, 0, 0.05, False), ('star', 3, 0, 0.05, False),
        ('star', 0, 1, 0.05, False), ('book', 1, 1, 0.07, True),
        ('ball', 0, 2, 0.05, True), ('cup', 1, 2, 0.05, True),
        ('apple', 2, 2, 0.05, True), ('ball', 3, 2, 0.05, True),
        ('cup', 0, 3, 0.05, True), ('ball', 1, 3, 0.05, True),
        ('apple', 2, 3, 0.05, True), ('book', 3, 3, 0.07, True),
    ]
    for kind, col, row, fsf, base in cells:
        place(fs, kind, col, row, 4, 4, size, size * fsf, rmode(rng), rng, base=base)
    return img, fs


def theme_sea(rng, size):
    img = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(img)
    mid = int(size * 0.46)
    for y in range(size):
        if y < mid:
            t = y / max(1, mid)
            r = int(150 * (1 - t) + 205 * t); g = int(210 * (1 - t) + 235 * t); b = int(245 * (1 - t) + 255 * t)
        else:
            t = (y - mid) / max(1, size - mid)
            r = int(70 * (1 - t) + 30 * t); g = int(150 * (1 - t) + 90 * t); b = int(200 * (1 - t) + 150 * t)
        d.line([(0, y), (size, y)], fill=(r, g, b))
    _waves(d, mid, size, rng)
    _bubbles(d, size, rng)
    sand = int(size * 0.9)
    d.rectangle([0, sand, size, size], fill=(232, 210, 150))
    d.ellipse([size * 0.1, mid + size * 0.5, size * 0.22, mid + size * 0.6], fill=(90, 170, 110))
    d.ellipse([size * 0.78, mid + size * 0.55, size * 0.88, mid + size * 0.62], fill=(90, 170, 110))
    fs = []
    cells = [
        ('sun', 0, 0, 0.06, False), ('cloud', 1, 0, 0.05, False),
        ('cloud', 2, 0, 0.05, False), ('cloud', 3, 0, 0.05, False),
        ('bird', 1, 1, 0.03, False), ('star', 2, 1, 0.05, False),
        ('fish', 0, 2, 0.05, False), ('fish', 1, 2, 0.05, False),
        ('fish', 2, 2, 0.05, False), ('fish', 3, 2, 0.05, False),
        ('boat', 0, 3, 0.06, True), ('fish', 1, 3, 0.05, False),
        ('star', 2, 3, 0.05, False), ('duck', 3, 3, 0.05, True),
    ]
    for kind, col, row, fsf, base in cells:
        place(fs, kind, col, row, 4, 4, size, size * fsf, rmode(rng), rng, base=base)
    return img, fs


def theme_space(rng, size):
    img = bg_gradient(size, (12, 12, 42), (34, 22, 64))
    d = ImageDraw.Draw(img)
    for _ in range(3):
        cx = rng.randint(0, size); cy = rng.randint(0, size); rr = rng.randint(size // 5, size // 3)
        col = rng.choice([(60, 40, 90), (40, 60, 100), (90, 40, 70)])
        d.ellipse([cx - rr, cy - rr // 2, cx + rr, cy + rr // 2], fill=col)
    for _ in range(70):
        x = rng.randint(0, size - 1); y = rng.randint(0, size - 1); r = rng.randint(1, 3)
        _ellipse(d, x, y, r, r, (240, 240, 255))
    fs = []
    cells = [
        ('planet', 0, 0, 0.06, False), ('star', 1, 0, 0.05, False),
        ('planet', 2, 0, 0.06, False), ('star', 3, 0, 0.05, False),
        ('star', 0, 1, 0.05, False), ('planet', 1, 1, 0.06, False),
        ('star', 2, 1, 0.05, False), ('planet', 3, 1, 0.06, False),
        ('star', 0, 2, 0.05, False), ('planet', 1, 2, 0.06, False),
        ('star', 2, 2, 0.05, False), ('planet', 3, 2, 0.06, False),
        ('star', 0, 3, 0.05, False), ('rocket', 1, 3, 0.07, False),
        ('star', 2, 3, 0.05, False), ('star', 3, 3, 0.05, False),
    ]
    for kind, col, row, fsf, base in cells:
        place(fs, kind, col, row, 4, 4, size, size * fsf, rmode(rng), rng, base=base)
    return img, fs


THEMES = [theme_park, theme_kitchen, theme_traffic, theme_room, theme_sea, theme_space]


# ---------------------------------------------------------------- 选差异
def _overlap(a, b, pad):
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    return not (ax1 + pad <= bx0 or bx1 + pad <= ax0 or ay1 + pad <= by0 or by1 + pad <= ax0)


def pick_diff_features(features, k, rng, size, pad=0.022):
    pad_px = pad * size
    idx = list(range(len(features)))
    rng.shuffle(idx)
    chosen = []
    for i in idx:
        if len(chosen) >= k:
            break
        ok = True
        for j in chosen:
            if _overlap(features[i]['bbox'], features[j]['bbox'], pad_px):
                ok = False
                break
        if ok:
            chosen.append(i)
    return [features[i] for i in chosen]


# ---------------------------------------------------------------- 自动生成主流程
def build_demo(count, size, qmax, quiet=False):
    items = []
    for n in range(1, count + 1):
        k = count_for_level(n)
        theme = THEMES[(n - 1) % len(THEMES)]
        seed = 1000 + n * 2654435761 % 2147483647
        chosen = None
        bg = None
        features = None
        for attempt in range(60):
            r2 = random.Random(seed * 1000 + attempt)
            bg, features = theme(r2, size)
            ch = pick_diff_features(features, k, r2, size)
            if len(ch) >= k:
                chosen = ch
                break
        if chosen is None:
            r2 = random.Random(seed)
            bg, features = theme(r2, size)
            chosen = pick_diff_features(features, k, r2, size)
        ch_ids = set(id(f) for f in chosen)
        for f in features:
            # 没被选为差异的物件：两张图都用 canonical「正常画法」，否则 show 类
            # 差异（A 空、B 有）落选时会两边都空、物件凭空消失。
            if id(f) not in ch_ids:
                f['a'] = f['normal']
                f['b'] = f['normal']
        imgA = bg.copy()
        imgB = bg.copy()
        dA = ImageDraw.Draw(imgA)
        dB = ImageDraw.Draw(imgB)
        for f in features:
            f['a'](dA)
            f['b'](dB)
        rects = []
        for f in chosen:
            x0, y0, x1, y1 = f['bbox']
            # 夹到画面内：底部锚定物件（球/苹果等）的包围盒可能略超出下边缘，
            # 否则差异矩形越界、游戏里点不到。
            x0 = max(0, min(size, x0)); y0 = max(0, min(size, y0))
            x1 = max(0, min(size, x1)); y1 = max(0, min(size, y1))
            if x1 <= x0 or y1 <= y0:
                continue
            rects.append({
                'u': round(x0 / size, 4), 'v': round(y0 / size, 4),
                'uw': round((x1 - x0) / size, 4), 'vh': round((y1 - y0) / size, 4),
            })
        name = 'd%02d' % n
        pa = os.path.join(OUT_DIR, name + '_a.jpg')
        pb = os.path.join(OUT_DIR, name + '_b.jpg')
        qa, na = save_fit(imgA, pa, qmax)
        qb, nb = save_fit(imgB, pb, qmax)
        main_color = dominant_color(imgA)
        items.append({
            'a': 'assets/diff/' + name + '_a.jpg',
            'b': 'assets/diff/' + name + '_b.jpg',
            'color': to_hex(main_color), 'w': size, 'h': size,
            'diffs': rects
        })
        if not quiet and n <= 3:
            print('  ✅ %-9s %s  %2d 处差异  %.0fKB+%.0fKB  主色 %s' %
                  (name, THEMES[(n - 1) % len(THEMES)].__name__.replace('theme_', ''),
                   len(rects), na / 1024.0, nb / 1024.0, to_hex(main_color)))
    if not quiet and count > 3:
        print('  ✅ ... 其余 %d 对同理（6 套主题循环）' % (count - 3))
    return items, dir_bytes()


# ---------------------------------------------------------------- 源图（用户照片）路径
def apply_hue(region, rng):
    hsv = region.convert('HSV')
    data = list(hsv.getdata())
    shift = rng.randint(0, 360)
    out = []
    for px in data:
        h = (px[0] + shift) % 256
        out.append((h, px[1], px[2]))
    hsv.putdata(out)
    return hsv.convert('RGB')


def apply_transform(img, box, rng):
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    w, h = img.size
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    if x1 - x0 < 12 or y1 - y0 < 12:
        return False
    region = img.crop((x0, y0, x1, y1))
    kind = rng.randint(0, 4)
    if kind == 0:
        region = apply_hue(region, rng)
    elif kind == 1:
        f = 1.45 if rng.random() < 0.5 else 0.55
        region = ImageEnhance.Brightness(region).enhance(f)
    elif kind == 2:
        region = region.convert('L').convert('RGB')
    elif kind == 3:
        r = rng.randint(0, 255); g = rng.randint(0, 255); b = rng.randint(0, 255)
        region = Image.new('RGB', region.size, (r, g, b))
    else:
        rd = ImageDraw.Draw(region)
        r = min(region.size) // 2 - 4
        cx, cy = region.size[0] // 2, region.size[1] // 2
        col = (rng.randint(0, 255), rng.randint(0, 255), rng.randint(0, 255))
        if rng.random() < 0.5:
            rd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col, outline=(255, 255, 255))
        else:
            rd.polygon([(cx, cy - r), (cx + r, cy + r), (cx - r, cy + r)], fill=col, outline=(255, 255, 255))
    img.paste(region, (x0, y0))
    return True


def choose_rects(k, rng, s, margin=0.08):
    rects = []
    tries = 0
    min_side = 0.10
    max_side = 0.17
    while len(rects) < k and tries < 4000:
        tries += 1
        uw = rng.uniform(min_side, max_side)
        vh = rng.uniform(min_side, max_side)
        u = rng.uniform(margin, 1 - margin - uw)
        v = rng.uniform(margin, 1 - margin - vh)
        ok = True
        for r in rects:
            if (u < r['u'] + r['uw'] + 0.02 and u + uw + 0.02 > r['u'] and
                    v < r['v'] + r['vh'] + 0.02 and v + vh + 0.02 > r['v']):
                ok = False
                break
        if ok:
            rects.append({'u': round(u, 4), 'v': round(v, 4),
                          'uw': round(uw, 4), 'vh': round(vh, 4)})
    return rects


def load_bases(files, size):
    bases = []
    if not files:
        return bases
    for f in files:
        if not os.path.exists(f):
            print('  ⚠ 跳过（找不到文件）: ' + f)
            continue
        try:
            im = Image.open(f)
        except Exception as e:
            print('  ⚠ 跳过（打不开）: %s —— %s' % (f, e))
            continue
        try:
            from PIL import ImageOps
            im = ImageOps.exif_transpose(im)
        except Exception:
            pass
        im = im.convert('RGB')
        im = center_square(im).resize((size, size), Image.LANCZOS)
        bases.append(im)
        print('  📷 载入底图: ' + os.path.basename(f))
    return bases


def build_from_sources(count, size, qmax, quiet=False):
    bases = load_bases(SOURCE_FILES, size)
    if not bases:
        return None, 0
    items = []
    for n in range(1, count + 1):
        base = bases[(n - 1) % len(bases)].copy()
        rng = random.Random(1000 + n * 2654435761 % 2147483647)
        k = count_for_level(n)
        rects = choose_rects(k, rng, size)
        if len(rects) < k:
            rects = choose_rects(k, random.Random(n * 7 + 3), size)
        bimg = base.copy()
        for r in rects:
            box = (r['u'] * size, r['v'] * size, (r['u'] + r['uw']) * size, (r['v'] + r['vh']) * size)
            apply_transform(bimg, box, rng)
        name = 'd%02d' % n
        pa = os.path.join(OUT_DIR, name + '_a.jpg')
        pb = os.path.join(OUT_DIR, name + '_b.jpg')
        qa, na = save_fit(base, pa, qmax)
        qb, nb = save_fit(bimg, pb, qmax)
        main_color = dominant_color(base)
        items.append({
            'a': 'assets/diff/' + name + '_a.jpg',
            'b': 'assets/diff/' + name + '_b.jpg',
            'color': to_hex(main_color), 'w': size, 'h': size,
            'diffs': rects
        })
        if not quiet and n <= 3:
            print('  ✅ %-9s %dx%d  %2d 处差异  %.0fKB+%.0fKB' %
                  (name, size, size, len(rects), na / 1024.0, nb / 1024.0))
    if not quiet and count > 3:
        print('  ✅ ... 其余 %d 对同理' % (count - 3))
    return items, dir_bytes()


def build_all(count, size, qmax, quiet=False):
    if SOURCE_FILES:
        return build_from_sources(count, size, qmax, quiet)
    return build_demo(count, size, qmax, quiet)


def write_manifest(items):
    lines = []
    lines.append('/**')
    lines.append(' * diffAssets.js —— 图片找不同内置图对清单（由 tools/make_diff_pairs.py 自动生成，勿手改）')
    lines.append(' * 每对含 a（原图）与 b（差异图），diffs 为归一化差异矩形（u,v,uw,vh ∈ 0~1）。')
    lines.append(' */')
    lines.append('(function () {')
    lines.append('  var G = typeof GameGlobal !== \'undefined\' ? GameGlobal')
    lines.append('        : (typeof window !== \'undefined\' ? window : globalThis);')
    lines.append('  var BF = G.BF || (G.BF = {});')
    lines.append('')
    lines.append('  BF.DIFF_ASSETS = [')
    for it in items:
        diffs = ', '.join('{u:%s,v:%s,uw:%s,vh:%s}' %
                          (d['u'], d['v'], d['uw'], d['vh']) for d in it['diffs'])
        lines.append('    { a: \'%s\', b: \'%s\', color: \'%s\', w: %d, h: %d, diffs: [%s] },'
                     % (it['a'], it['b'], it['color'], it['w'], it['h'], diffs))
    lines.append('  ];')
    lines.append('})();')
    lines.append('')
    with io.open(MANIFEST, 'w', encoding='utf-8') as fp:
        fp.write('\n'.join(lines))


# 整包预算尝试序列：(缩放系数, 质量上限)。先降质量（画质损失小），实在不行再降尺寸。
ATTEMPTS = [
    (1.00, 88), (1.00, 80), (1.00, 72), (1.00, 64),
    (0.88, 88), (0.88, 76), (0.88, 64),
    (0.75, 84), (0.75, 72), (0.62, 84), (0.62, 70),
]

SOURCE_FILES = []
count_needed = COUNT


def main():
    global SOURCE_FILES, count_needed
    args = sys.argv[1:]
    size = SIZE
    count = COUNT
    budget_mb = 2.5
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
        elif a == '--count':
            i += 1
            count = int(args[i])
        elif a == '--budget':
            i += 1
            budget_mb = float(args[i])
        else:
            files.append(a)
        i += 1

    SOURCE_FILES = files
    count_needed = count
    budget = int(budget_mb * 1024 * 1024)

    os.makedirs(OUT_DIR, exist_ok=True)

    if not files:
        print('  未提供源图 → 自动生成 6 套主题场景（公园/厨房/马路/房间/海洋/太空）当底图')

    print('  整包预算 %.1fMB（assets/diff 合计），逐档降质量/尺寸直到装得下' % budget_mb)
    items, total = None, 0
    used = None
    for scale, qmax in ATTEMPTS:
        s = int(round(size * scale))
        s -= s % 2
        # 直接覆盖写（文件名固定 dNN_a/b.jpg），不删除旧文件——避免触发沙箱批量删除保护。
        items, total = build_all(count, s, qmax, quiet=(used is not None))
        if items is None:
            print('没有可用底图。')
            return 1
        used = (s, qmax)
        print('    尝试 %dx%d @q%d → %.2fMB %s' %
              (s, s, qmax, total / 1048576.0, '✅ 装得下' if total <= budget else '偏大，继续压'))
        if total <= budget:
            break

    if total > budget:
        print('  ⚠ 压到最低档仍超预算（%.2fMB > %.1fMB）：建议减少 --count 或降低 --size'
              % (total / 1048576.0, budget_mb))

    final_size = used[0]
    for it in items:
        it['w'] = final_size
        it['h'] = final_size

    write_manifest(items)

    print('')
    print('  → assets/diff/  共 %d 对（a+b=%d 张），%dx%d @q%d，合计 %.2fMB（预算 %.1fMB）' %
          (len(items), len(items) * 2, final_size, final_size, used[1],
           total / 1048576.0, budget_mb))
    print('  → js/game/diffAssets.js 已更新')
    return 0


if __name__ == '__main__':
    sys.exit(main())
