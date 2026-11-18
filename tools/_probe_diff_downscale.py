#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""探测 diff 图降采样收益 + 画质 + 假差异（只读，不改原图）。
真机显示尺寸参考：390 逻辑宽屏两图并排每张 ~180 CSS px；DPR2=360 物理px，DPR3=540。
"""
import os, re, io, math
from PIL import Image, ImageChops, ImageStat, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIFF = os.path.join(ROOT, 'assets', 'diff')
ASSETS_JS = os.path.join(ROOT, 'js', 'game', 'diffAssets.js')

def save_bytes(im, q, optimize=True, progressive=True):
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=q, optimize=optimize, progressive=progressive)
    return buf.getvalue()

def psnr(a, b):
    d = ImageChops.difference(a.convert('RGB'), b.convert('RGB'))
    rms = ImageStat.Stat(d).rms
    mse = sum(v*v for v in rms)/3
    return 99.0 if mse==0 else 10*math.log10(255*255/mse)

def parse_levels():
    txt = open(ASSETS_JS, encoding='utf-8').read()
    return [(idx, [(float(u),float(v),float(uw),float(vh)) for u,v,uw,vh in
             re.findall(r'u:([\d.]+),v:([\d.]+),uw:([\d.]+),vh:([\d.]+)', s)])
            for idx, s in re.findall(r"\{ a: 'assets/diff/d(\d+)_a\.jpg'.*?diffs: \[(.*?)\] \}", txt)]

def main():
    files = sorted(f for f in os.listdir(DIFF) if f.endswith('.jpg'))
    orig_total = sum(os.path.getsize(os.path.join(DIFF,f)) for f in files)
    levels = parse_levels()
    print('当前 120 张: %.1f KB (480x480), 关卡数=%d' % (orig_total/1024, len(levels)))
    print('目标: 给 photo 重压留 ~67KB 后，diff 最好降到 ~1800KB 以下（主包留出 ~800KB 余量）')
    print()
    print('%-10s %9s %9s %8s %10s %10s' % ('档位','总体积KB','省KB','PSNR','非差异均差','差异/非差异'))
    for target in [440, 420, 400, 380, 360, 340, 320]:
        tot = 0; ps = 0; worst_out = 0; ratio_sum = 0; n=0
        for f in files:
            p = os.path.join(DIFF,f)
            im = Image.open(p).convert('RGB')
            sm = im.resize((target,target), Image.LANCZOS)
            data = save_bytes(sm, 88)
            tot += len(data)
        # 画质 + 假差异（抽样前 12 对即可，全量在正式脚本做）
        sample = levels[:12]
        for idx, boxes in sample:
            a = Image.open(os.path.join(DIFF,'d%s_a.jpg'%idx)).convert('RGB').resize((target,target), Image.LANCZOS)
            b = Image.open(os.path.join(DIFF,'d%s_b.jpg'%idx)).convert('RGB').resize((target,target), Image.LANCZOS)
            a2 = Image.open(io.BytesIO(save_bytes(a,88))).convert('RGB')
            b2 = Image.open(io.BytesIO(save_bytes(b,88))).convert('RGB')
            ps += psnr(a,a2)
            mask = Image.new('L',(target,target),0)
            dr = ImageDraw.Draw(mask)
            for u,v,uw,vh in boxes:
                dr.rectangle([u*target,v*target,(u+uw)*target,(v+vh)*target], fill=255)
            dd = list(ImageChops.difference(a2,b2).convert('L').getdata())
            mm = list(mask.getdata())
            out=[dd[i] for i in range(len(dd)) if mm[i]==0]
            inn=[dd[i] for i in range(len(dd)) if mm[i]==255]
            ao=sum(out)/len(out); ai=sum(inn)/len(inn) if inn else 0
            worst_out=max(worst_out,max(out)); ratio_sum+= ai/max(ao,0.01); n+=1
        print('%-10s %9.1f %9.1f %8.1f %10.2f %10.1f' %
              ('%dx%d@88'%(target,target), tot/1024, (orig_total-tot)/1024,
               ps/len(sample), worst_out, ratio_sum/n))

if __name__=='__main__':
    main()
