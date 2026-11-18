#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
瞬时记忆 · Edge 无头截图像素核验（真 Canvas，fake canvas 测不到的视觉层）

- 抓「首页第17张卡 / 观察期场景卡 / 答题期选项 / 揭晓特写 / 结算 / 规则弹框」六类画面，
  另抽 320 窄屏两帧核对 4 个选项不溢出。
- 像素核验：
  1) 规则弹框「透明」已知坑：卡内文字 min 亮度应低(≈47 不透明)，被入场白纱盖住则 ≈224；
  2) 观察期场景卡确实画出了彩色物品（饱和像素占比 > 2%），不是空白卡；
  3) 答题期选项区确实有文字/按钮（暗像素占比 > 0.5%），不是空区域。
- `_dl.html?recall=quiz|reveal|win` 直接定住阶段，避免靠帧数猜。

输出：_shots/recall_*.png + 控制台报告。
"""
import os, sys, subprocess, random

ROOT = r"C:\Users\admin\WorkBuddy\2026-09-30-08-41-53\puzzle-arcade"
DL   = os.path.join(ROOT, "preview", "_dl.html")
OUT  = os.path.join(ROOT, "_shots")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
TMP  = os.path.join(OUT, "_edge_profile_recall")   # 持久 profile，不做 rmtree（沙箱保护）

# (name, query, desc, window_w, window_h)
CAPS = [
    ("recall_home",        "home=1&chip=brain&quiet=1",                                   "首页·烧脑分类(17张卡)", 390, 844),
    ("recall_L1_observe",  "game=recall&level=1&close=1&quiet=1&frames=50",              "第1关·观察期(6件物品场景卡)", 390, 844),
    ("recall_L11_observe", "game=recall&level=11&close=1&quiet=1&frames=50",             "第11关·观察期(10件物品)", 390, 844),
    ("recall_L11_quiz",    "game=recall&level=11&close=1&quiet=1&frames=50&recall=quiz",  "第11关·答题期(黑底?+4选项+黄环)", 390, 844),
    ("recall_L11_reveal",  "game=recall&level=11&close=1&quiet=1&frames=50&recall=reveal","第11关·揭晓期(物品特写+正确答案)", 390, 844),
    ("recall_L11_win",     "game=recall&level=11&close=1&quiet=1&frames=50&recall=win",   "第11关·通关结算(3星)", 390, 844),
    ("recall_L1_popup",    "game=recall&level=1&quiet=1&frames=50",                      "第1关·规则弹框(透明核验)", 390, 844),
    ("recall_320_observe", "game=recall&level=11&close=1&quiet=1&frames=50",             "320窄屏·观察期(物品不挤爆)", 320, 568),
    ("recall_320_quiz",    "game=recall&level=11&close=1&quiet=1&frames=50&recall=quiz",  "320窄屏·答题期(4选项不溢出)", 320, 568),
]

def url_of(q):
    return "file:///" + DL.replace("\\", "/") + "?" + q + "&cb=" + str(random.randint(100000, 999999))

def shot(name, q, w=390, h=844, budget=6000):
    out = os.path.join(OUT, name + ".png")
    u = url_of(q)
    args = [
        EDGE, "--headless=new", "--disable-gpu", "--no-sandbox",
        "--disable-dev-shm-usage", "--user-data-dir=" + TMP,
        "--window-size=%d,%d" % (w, h), "--force-device-scale-factor=1",
        "--hide-scrollbars", "--virtual-time-budget=%d" % budget,
        "--run-all-compositor-stages-before-draw",
        "--screenshot=" + out, u,
    ]
    r = subprocess.run(args, capture_output=True, text=True, timeout=120)
    if not os.path.exists(out) or os.path.getsize(out) < 1000:
        print("  x %s 截图失败 (stderr: %s)" % (name, (r.stderr or "")[-300:]))
        return False
    print("  v %s -> %s (%d bytes)" % (name, name + ".png", os.path.getsize(out)))
    return True

def check_popup_transparency(path):
    """规则弹框在场：卡内文字 min 亮度应低(不透明≈47)；若被白纱盖后则 washed≈224。"""
    import PIL.Image
    im = PIL.Image.open(path).convert("L")
    w, h = im.size
    x0, x1 = int(w * 0.25), int(w * 0.75)
    y0, y1 = int(h * 0.30), int(h * 0.70)
    px = list(im.crop((x0, y0, x1, y1)).getdata())
    mn = min(px); avg = sum(px) / len(px)
    ok = mn < 120
    print("  弹框透明核验: min_lum=%d avg_lum=%.0f -> %s" %
          (mn, avg, "PASS(不透明,文字可见)" if ok else "FAIL(疑似被白纱盖住/透明)"))
    return ok

def check_colorful_items(path, frac_min=0.02):
    """观察期卡片区应有足够饱和像素，证明 10 种矢量物品真的画出来了（不是空白卡）。"""
    import PIL.Image
    im = PIL.Image.open(path).convert("RGB")
    w, h = im.size
    crop = im.crop((int(w * 0.08), int(h * 0.14), int(w * 0.92), int(h * 0.55)))
    px = list(crop.getdata())
    sat = 0
    for (r, g, b) in px:
        if max(r, g, b) - min(r, g, b) > 45:
            sat += 1
    frac = sat / len(px)
    ok = frac > frac_min
    print("  场景物品核验(卡片区): 彩色像素=%.2f%% -> %s" %
          (frac * 100, "PASS(物品已绘制)" if ok else "FAIL(卡片近乎空白)"))
    return ok

def check_options_visible(path, frac_min=0.005):
    """答题期选项区应有暗色文字/描边像素，证明选项按钮不是空区域。"""
    import PIL.Image
    im = PIL.Image.open(path).convert("L")
    w, h = im.size
    crop = im.crop((0, int(h * 0.55), w, int(h * 0.82)))
    px = list(crop.getdata())
    dark = sum(1 for v in px if v < 165)
    frac = dark / len(px)
    ok = frac > frac_min
    print("  选项区核验: 暗像素=%.2f%% -> %s" %
          (frac * 100, "PASS(文字/按钮可见)" if ok else "FAIL(选项区疑似空白)"))
    return ok

def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(TMP, exist_ok=True)
    print("=== 瞬时记忆 · Edge 无头截图 ===")
    # 预热：先用持久 profile 加载一次 recall，把 27 张白底 JPEG 暖进浏览器磁盘缓存，
    # 避免首张冷截图像加载(onload)与虚拟时间预算竞速而抓到矢量兜底帧。
    print("  [warmup] 预热 recall 资源(不落盘) ...")
    shot("__recall_warmup", "game=recall&level=1&close=1&quiet=1&frames=80", 390, 844, budget=12000)
    okall = True
    for (name, q, desc, w, h) in CAPS:
        print("  [%s] %s (%dx%d)" % (name, desc, w, h))
        if not shot(name, q, w, h):
            okall = False

    def p(name): return os.path.join(OUT, name + ".png")
    print("=== 像素核验 ===")
    if os.path.exists(p("recall_L1_popup")):
        okall &= check_popup_transparency(p("recall_L1_popup"))
    if os.path.exists(p("recall_L11_observe")):
        okall &= check_colorful_items(p("recall_L11_observe"))
    if os.path.exists(p("recall_L11_quiz")):
        okall &= check_options_visible(p("recall_L11_quiz"))
    if os.path.exists(p("recall_320_quiz")):
        okall &= check_options_visible(p("recall_320_quiz"))

    print("=== 结论 ===")
    print("全部通过 PASS" if okall else "存在问题 FAIL（请逐张看 _shots/recall_*.png 与 DIAG 输出）")
    sys.exit(0 if okall else 1)

if __name__ == "__main__":
    main()
