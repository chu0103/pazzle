#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成占位照片（用户还没给真图时，用它把游戏跑起来）

    python tools/make_demo_photos.py

画 6 张简单风景，色调彼此拉开、每块都有可辨认的内容，
够用来验证「切片 / 拖拽 / 还原」整条链路。
真图到位后跑 `python tools/process_photos.py --clear 你的图...` 覆盖掉即可。
"""
import os
import random
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.path.join(ROOT, 'assets', '_tmp_demo')
S = 900


def vgrad(top, bottom, horizon):
    """垂直渐变，horizon 之后用地面色"""
    im = Image.new('RGB', (S, S))
    d = ImageDraw.Draw(im)
    h = int(S * horizon)
    for y in range(S):
        if y < h:
            t = y / float(h)
            c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        else:
            t = (y - h) / float(S - h)
            c = tuple(int(bottom[i] + (bottom[i] * 0.72 - bottom[i]) * t) for i in range(3))
        d.line([(0, y), (S, y)], fill=c)
    return im


def scene_sunset():
    im = vgrad((43, 76, 148), (242, 154, 92), 0.62)
    d = ImageDraw.Draw(im)
    d.ellipse([S * 0.62, S * 0.12, S * 0.86, S * 0.36], fill=(255, 214, 120))
    # 远山
    d.polygon([(0, S * 0.62), (S * 0.3, S * 0.38), (S * 0.55, S * 0.62)], fill=(86, 62, 96))
    d.polygon([(S * 0.4, S * 0.62), (S * 0.72, S * 0.44), (S, S * 0.62)], fill=(64, 48, 78))
    d.rectangle([0, S * 0.62, S, S], fill=(38, 30, 46))
    return im


def scene_sea():
    im = vgrad((126, 196, 232), (196, 232, 244), 0.45)
    d = ImageDraw.Draw(im)
    d.rectangle([0, S * 0.45, S, S * 0.72], fill=(38, 122, 178))
    for i in range(9):
        y = S * (0.47 + i * 0.028)
        w = S * (0.10 + (i % 3) * 0.06)
        x = S * ((i * 0.13) % 0.85)
        d.rounded_rectangle([x, y, x + w, y + S * 0.012], radius=6, fill=(214, 242, 250))
    d.rectangle([0, S * 0.72, S, S], fill=(232, 210, 150))
    d.ellipse([S * 0.10, S * 0.10, S * 0.24, S * 0.24], fill=(255, 240, 170))
    return im


def scene_meadow():
    im = vgrad((168, 214, 240), (206, 232, 238), 0.38)
    d = ImageDraw.Draw(im)
    d.rectangle([0, S * 0.38, S, S], fill=(96, 158, 74))
    rnd = random.Random(7)
    palette = [(236, 88, 122), (246, 196, 62), (238, 132, 60), (228, 232, 240), (176, 106, 200)]
    for _ in range(220):
        x = rnd.uniform(0, S)
        y = rnd.uniform(S * 0.40, S)
        r = rnd.uniform(S * 0.006, S * 0.016)
        d.ellipse([x - r, y - r, x + r, y + r], fill=rnd.choice(palette))
    return im


def scene_city():
    im = vgrad((16, 22, 48), (48, 36, 78), 0.55)
    d = ImageDraw.Draw(im)
    rnd = random.Random(11)
    x = 0
    while x < S:
        w = rnd.uniform(S * 0.06, S * 0.13)
        h = rnd.uniform(S * 0.22, S * 0.52)
        top = S * 0.78 - h
        d.rectangle([x, top, x + w, S * 0.80], fill=(26, 30, 56))
        for r in range(int(h / (S * 0.05))):
            for c in range(int(w / (S * 0.035))):
                if rnd.random() < 0.55:
                    wx = x + c * S * 0.035 + S * 0.010
                    wy = top + r * S * 0.05 + S * 0.016
                    d.rectangle([wx, wy, wx + S * 0.016, wy + S * 0.020],
                                fill=rnd.choice([(255, 214, 130), (255, 186, 92), (150, 206, 232)]))
        x += w + S * 0.012
    d.rectangle([0, S * 0.80, S, S], fill=(14, 16, 34))
    return im


def scene_forest():
    im = vgrad((196, 218, 200), (228, 214, 176), 0.42)
    d = ImageDraw.Draw(im)
    d.rectangle([0, S * 0.42, S, S], fill=(122, 96, 58))
    rnd = random.Random(23)
    for _ in range(46):
        x = rnd.uniform(0, S)
        y = rnd.uniform(S * 0.44, S * 0.92)
        r = rnd.uniform(S * 0.03, S * 0.07)
        d.ellipse([x - r, y - r * 1.2, x + r, y + r * 1.2],
                  fill=rnd.choice([(214, 118, 52), (190, 74, 46), (232, 170, 62), (150, 78, 40)]))
    for _ in range(7):
        x = rnd.uniform(S * 0.05, S * 0.95)
        d.rectangle([x - S * 0.010, S * 0.30, x + S * 0.010, S * 0.70], fill=(78, 58, 40))
    return im


def scene_snow():
    im = vgrad((92, 150, 206), (206, 230, 244), 0.50)
    d = ImageDraw.Draw(im)
    d.polygon([(0, S * 0.62), (S * 0.34, S * 0.24), (S * 0.62, S * 0.62)], fill=(238, 244, 250))
    d.polygon([(S * 0.30, S * 0.62), (S * 0.68, S * 0.16), (S, S * 0.62)], fill=(252, 253, 255))
    d.polygon([(S * 0.34, S * 0.24), (S * 0.42, S * 0.34), (S * 0.26, S * 0.34)], fill=(176, 196, 220))
    d.polygon([(S * 0.68, S * 0.16), (S * 0.78, S * 0.30), (S * 0.58, S * 0.30)], fill=(198, 214, 232))
    d.rectangle([0, S * 0.62, S, S], fill=(248, 251, 254))
    return im


def main():
    os.makedirs(TMP, exist_ok=True)
    makers = [scene_sunset, scene_sea, scene_meadow, scene_city, scene_forest, scene_snow]
    paths = []
    for i, mk in enumerate(makers):
        im = mk().filter(ImageFilter.SMOOTH)
        p = os.path.join(TMP, 'demo%d.png' % (i + 1))
        im.save(p)
        paths.append(p)
        print('  生成 ' + p)
    print('\nDEMO_FILES=' + ','.join(paths))


if __name__ == '__main__':
    main()
