#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""探测 diff/photo 图片压缩质量与重压收益（只读，不改原图）。
重点：配对图 a/b 用相同质量重压后，非差异区域是否出现假差异（找不同的致命问题）。
"""
import os, re, io, json
from PIL import Image, ImageChops, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIFF = os.path.join(ROOT, 'assets', 'diff')
PHOTO = os.path.join(ROOT, 'assets', 'photo')
ASSETS_JS = os.path.join(ROOT, 'js', 'game', 'diffAssets.js')

# ---------- 1. 估算当前 JPEG 质量 ----------
def est_quality(path):
    im = Image.open(path)
    qt = im.quantization
    if not qt: return None
    # 用 JPEG 标准量化表线性拟合质量
    std50 = [16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,
             14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,
             49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99]
    q = qt.get(0, qt.get(1))
    if not q: return None
    vals = [q[i] for i in range(64)]
    # 取中低频若干点拟合 scale
    ratios = []
    for i in [0,1,2,8,10,16,24,9]:
        if std50[i] and vals[i]:
            ratios.append(std50[i]/vals[i])
    s = sum(ratios)/len(ratios) if ratios else 1
    if s >= 1: return min(100, int(50 + s*50))
    else: return max(1, int(50*s*2))

def jpeg_save_bytes(im, quality, optimize=True, progressive=True):
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=quality, optimize=optimize, progressive=progressive)
    return len(buf.getvalue())

def psnr(a, b):
    import math
    diff = ImageChops.difference(a.convert('RGB'), b.convert('RGB'))
    stat = ImageStat.Stat(diff)
    mse = sum(v*v for v in stat.rms)/3
    if mse == 0: return 99.0
    return 10*math.log10(255*255/mse)

def main():
    print('===== 当前 diff JPEG 质量抽样 =====')
    dqs = []
    for f in sorted(os.listdir(DIFF))[:20]:
        if f.endswith('.jpg'):
            dqs.append(est_quality(os.path.join(DIFF, f)))
    print('  估算 quality:', dqs, ' 均值≈%.0f' % (sum(x for x in dqs if x)/len([x for x in dqs if x])))

    print('\n===== diff 120 张重压收益 =====')
    files = [f for f in sorted(os.listdir(DIFF)) if f.endswith('.jpg')]
    orig_total = sum(os.path.getsize(os.path.join(DIFF, f)) for f in files)
    print('  当前总计: %.1f KB' % (orig_total/1024))
    for q in [90, 88, 85, 82, 80, 78, 75]:
        tot = 0; psum = 0
        for f in files:
            p = os.path.join(DIFF, f)
            im = Image.open(p).convert('RGB')
            tot += jpeg_save_bytes(im, q)
            if f.endswith('_a.jpg'):
                psum += psnr(im, Image.open(os.path.join(DIFF, f.replace('_a','_b'))).convert('RGB'))
        print('  q%-3d -> %7.1f KB (省 %6.1f KB, %.1f%%)  a/b平均PSNR=%.1f'
              % (q, tot/1024, (orig_total-tot)/1024, (orig_total-tot)/orig_total*100, psum/(len(files)//2)))

    print('\n===== photo 7 张重压收益 =====')
    pf = [f for f in sorted(os.listdir(PHOTO)) if f.endswith('.jpg')]
    po = sum(os.path.getsize(os.path.join(PHOTO, f)) for f in pf)
    print('  当前总计: %.1f KB' % (po/1024))
    for q in [88, 85, 82, 80, 78]:
        tot = sum(jpeg_save_bytes(Image.open(os.path.join(PHOTO,f)).convert('RGB'), q) for f in pf)
        print('  q%-3d -> %7.1f KB (省 %6.1f KB, %.1f%%)' % (q, tot/1024, (po-tot)/1024, (po-tot)/po*100))

    # ---------- 4. 假差异核验：重压后 a/b 在非差异区是否出现明显差异 ----------
    print('\n===== 假差异核验（q82 重压后，逐对检查）=====')
    txt = open(ASSETS_JS, encoding='utf-8').read()
    # 解析每关 diffs: [{u,v,uw,vh},...]
    recs = re.findall(r"\{ a: 'assets/diff/d(\d+)_a\.jpg'.*?diffs: \[(.*?)\] \}", txt)
    print('  解析到关卡数:', len(recs))
    worst = []
    for idx, diffs_str in recs:
        boxes = [(float(u),float(v),float(uw),float(vh)) for u,v,uw,vh in
                 re.findall(r'u:([\d.]+),v:([\d.]+),uw:([\d.]+),vh:([\d.]+)', diffs_str)]
        a = Image.open(os.path.join(DIFF, 'd%s_a.jpg'%idx)).convert('RGB')
        b = Image.open(os.path.join(DIFF, 'd%s_b.jpg'%idx)).convert('RGB')
        # 重压后再解码（模拟真机）
        a2 = Image.open(io.BytesIO(jpeg_save_bytes(a, 82))).convert('RGB')
        b2 = Image.open(io.BytesIO(jpeg_save_bytes(b, 82))).convert('RGB')
        w,h = a.size
        mask = Image.new('L', (w,h), 0)
        from PIL import ImageDraw
        dr = ImageDraw.Draw(mask)
        for u,v,uw,vh in boxes:
            dr.rectangle([u*w, v*h, (u+uw)*w, (v+vh)*h], fill=255)
        d = ImageChops.difference(a2,b2).convert('L')
        # 非差异区平均差 & 最大值
        px_d = list(d.getdata()); px_m = list(mask.getdata())
        out = [px_d[i] for i in range(len(px_d)) if px_m[i]==0]
        avg_out = sum(out)/len(out)
        mx_out = max(out)
        # 差异区平均差
        inn = [px_d[i] for i in range(len(px_d)) if px_m[i]==255]
        avg_in = sum(inn)/len(inn) if inn else 0
        worst.append((mx_out, avg_out, avg_in, idx))
    worst.sort(reverse=True)
    print('  非差异区最大单像素差 top5 (关卡/outside_avg/inside_avg/outside_max):')
    for mx,ao,ai,idx in worst[:5]:
        print('    d%s: outside_avg=%.2f inside_avg=%.2f outside_max=%d' % (idx,ao,ai,mx))
    print('  outside_avg 全局最大 = %.2f, 平均 = %.2f'
          % (max(x[1] for x in worst), sum(x[1] for x in worst)/len(worst)))

if __name__ == '__main__':
    main()
