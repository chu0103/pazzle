#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""主包瘦身：diff 480→360 降采样 + photo 600→q82 重压（配套备份见 tools/_diff480_backup / _photo_backup）。

- diff：LANCZOS 降采样到 360×360，JPEG q84 optimize+progressive。差异坐标为归一化(u,v,uw,vh)，
        与像素尺寸解耦 → diffAssets.js 的 diffs 不用改，只把 w/h 字段同步为 360（dormant 元数据）。
- photo：保持 600×600（切片拼图要清晰度），仅 q82 重压。
- 默认 dry-run；加 --apply 才真正覆盖。

用法：
    python tools/_shrink_assets.py            # 预览前后体积
    python tools/_shrink_assets.py --apply     # 落地
"""
import os, io, sys, re
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIFF = os.path.join(ROOT, 'assets', 'diff')
PHOTO = os.path.join(ROOT, 'assets', 'photo')
MANIFEST = os.path.join(ROOT, 'js', 'game', 'diffAssets.js')
DIFF_SIZE = 360
DIFF_Q = 84
PHOTO_Q = 82

def jpg_bytes(im, q):
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=q, optimize=True, progressive=True)
    return buf.getvalue()

def main():
    apply = '--apply' in sys.argv
    print('模式:', 'APPLY(覆盖写)' if apply else 'DRY-RUN(仅预览)')

    # ---- diff ----
    dfiles = sorted(f for f in os.listdir(DIFF) if f.lower().endswith('.jpg'))
    d_before = sum(os.path.getsize(os.path.join(DIFF, f)) for f in dfiles)
    d_after = 0
    for f in dfiles:
        src = os.path.join(DIFF, f)
        im = Image.open(src).convert('RGB')
        if im.size != (DIFF_SIZE, DIFF_SIZE):
            im = im.resize((DIFF_SIZE, DIFF_SIZE), Image.LANCZOS)
        data = jpg_bytes(im, DIFF_Q)
        d_after += len(data)
        if apply:
            with open(src, 'wb') as fp:
                fp.write(data)
    print('diff %d 张: %.1fKB -> %.1fKB (省 %.1fKB)' %
          (len(dfiles), d_before/1024, d_after/1024, (d_before-d_after)/1024))

    # ---- photo ----
    pfiles = sorted(f for f in os.listdir(PHOTO) if f.lower().endswith('.jpg'))
    p_before = sum(os.path.getsize(os.path.join(PHOTO, f)) for f in pfiles)
    p_after = 0
    for f in pfiles:
        src = os.path.join(PHOTO, f)
        im = Image.open(src).convert('RGB')
        data = jpg_bytes(im, PHOTO_Q)
        p_after += len(data)
        if apply:
            with open(src, 'wb') as fp:
                fp.write(data)
    print('photo %d 张: %.1fKB -> %.1fKB (省 %.1fKB)' %
          (len(pfiles), p_before/1024, p_after/1024, (p_before-p_after)/1024))

    # ---- manifest w/h 480 -> 360 ----
    txt = open(MANIFEST, encoding='utf-8').read()
    new = re.sub(r"w: \d+, h: \d+, diffs:", "w: %d, h: %d, diffs:" % (DIFF_SIZE, DIFF_SIZE), txt)
    cnt = len(re.findall(r"w: \d+, h: \d+, diffs:", txt))
    if apply and new != txt:
        open(MANIFEST, 'w', encoding='utf-8').write(new)
    print('manifest w/h 同步 %d 条: 480 -> %d' % (cnt, DIFF_SIZE))

    print('预计主包: %.1fKB -> %.1fKB (总省 %.1fKB)' %
          (4028.46, 4028.46-(d_before-d_after+p_before-p_after)/1024,
           (d_before-d_after+p_before-p_after)/1024))

if __name__ == '__main__':
    main()
