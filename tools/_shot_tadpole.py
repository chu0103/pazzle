#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
盯蝌蚪 · Edge 无头截图像素核验
- 用 msedge --headless=new --screenshot 抓真实 Canvas 渲染帧（这是 fake canvas 测不到的视觉层）。
- 顺带像素核验「弹框/内容透明」已知坑：规则弹框在场时，卡内文字 min 亮度应≈47（不透明），
  若被入场白纱盖在弹框之后则 washed≈224（透明 bug）。
- 双核验「倒计时结束定格」：游动倒计时内两帧卡片区必须有明显差异（真的在游），
  作答期两帧必须几乎零差异（真的停下来了，玩家在静止画面点选）。
输出：_shots/*.png + 控制台报告。

帧数换算（_dl.html 每帧 update(16)，实测口径）：
- 第 1 关（observeMs=2600 / swimMs=4500）：frames≈158 是【游动首帧】（红圈全亮、
  倒计时条显示 5 秒）用作衔接 T0；frames≈250~330 为倒计时内游动；frames≥500 已定格。
- 第 15 关（observeMs=1200 / swimMs=4150，2026-11-13 第五轮后段加时后）：
  frames≈70 进游动、frames≈329 归零定格；故 250=游动中、420/480=作答期两帧。
注：close=1 + 无头 rAF 会让观察期比理论值略早结束，故帧数按实测画面状态校准，
不要只按 observeMs/16 反推。
"""
import os, sys, subprocess, random, time, shutil

ROOT = r"C:\Users\admin\WorkBuddy\2026-09-30-08-41-53\puzzle-arcade"
DL   = os.path.join(ROOT, "preview", "_dl.html")
OUT  = os.path.join(ROOT, "_shots")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
TMP  = os.path.join(OUT, "_edge_profile")

# venv python（带 PIL）
VENV_PY = r"C:\Users\admin\.workbuddy\binaries\python\envs\default\Scripts\python.exe"

CAPS = [
    # (name, query, desc)
    ("tadpole_home",      "home=1&chip=brain&quiet=1",            "首页·烧脑分类·盯蝌蚪卡片"),
    ("tadpole_L1_observe","game=tadpole&level=1&close=1&quiet=1", "第1关·观察期(红虚线圈)"),
    ("tadpole_L1_answer", "game=tadpole&level=1&close=1&quiet=1&frames=500", "第1关·作答期(蝌蚪定格·无编号)"),
    ("tadpole_L1_popup",  "game=tadpole&level=1&quiet=1",         "第1关·规则弹框(透明核验)"),
    ("tadpole_L11_obs",   "game=tadpole&level=11&close=1&quiet=1&frames=50","第11关·16蝌蚪4标记(观察期红圈)"),
    # 第 15 关（后段加时后的最难关）：证明后段倒计时内确实在游，归零后照样完全定格
    ("tadpole_L15_swim",   "game=tadpole&level=15&close=1&quiet=1&frames=250", "第15关·游动中(4.15s窗口·倒计时未归零)"),
    ("tadpole_L15_freeze_a","game=tadpole&level=15&close=1&quiet=1&frames=420", "第15关·定格A(作答期·应静止)"),
    ("tadpole_L15_freeze_b","game=tadpole&level=15&close=1&quiet=1&frames=480", "第15关·定格B(再泵60帧应完全相同)"),
    # 游动倒计时内两帧：证明蝌蚪真的在游（顶部有倒计时条）
    ("tadpole_anim_a",   "game=tadpole&level=1&close=1&quiet=1&frames=250", "游动中A(playT≈1.4s·倒计时未归零)"),
    ("tadpole_anim_b",   "game=tadpole&level=1&close=1&quiet=1&frames=330", "游动中B(playT≈2.7s·倒计时未归零)"),
    # 倒计时归零后（>444 帧）两帧：证明完全定格
    ("tadpole_freeze_a", "game=tadpole&level=1&close=1&quiet=1&frames=500", "定格A(作答期·应静止)"),
    ("tadpole_freeze_b", "game=tadpole&level=1&close=1&quiet=1&frames=560", "定格B(作答期·再泵60帧应完全相同)"),
    # 定格→游动 衔接序列：T0 为游动首帧（红圈全亮、倒计时刚开始）
    ("tadpole_T0", "game=tadpole&level=1&close=1&quiet=1&frames=158", "衔接T0·游动首帧(红圈全亮·倒计时刚开始)"),
    ("tadpole_T1", "game=tadpole&level=1&close=1&quiet=1&frames=170", "衔接T1·起步延迟内(playT≈120ms·静止)"),
    ("tadpole_T2", "game=tadpole&level=1&close=1&quiet=1&frames=210", "衔接T2·余辉中(playT≈760ms·刚起步)"),
    ("tadpole_T3", "game=tadpole&level=1&close=1&quiet=1&frames=250", "衔接T3·红圈已隐(playT≈1.4s·游动中)"),
]

def url_of(q):
    return "file:///" + DL.replace("\\", "/") + "?" + q + "&cb=" + str(random.randint(100000, 999999))

def shot(name, q, budget=6000):
    out = os.path.join(OUT, name + ".png")
    u = url_of(q)
    args = [
        EDGE, "--headless=new", "--disable-gpu", "--no-sandbox",
        "--disable-dev-shm-usage", "--user-data-dir=" + TMP,
        "--window-size=390,844", "--force-device-scale-factor=1",
        "--hide-scrollbars", "--virtual-time-budget=%d" % budget,
        "--run-all-compositor-stages-before-draw",
        "--screenshot=" + out, u,
    ]
    r = subprocess.run(args, capture_output=True, text=True, timeout=120)
    if not os.path.exists(out) or os.path.getsize(out) < 1000:
        print("  ✗ %s 截图失败 (stderr: %s)" % (name, (r.stderr or "")[-300:]))
        return False
    print("  ✓ %s -> %s (%d bytes)" % (name, out, os.path.getsize(out)))
    return True

def check_popup_transparency(path):
    """规则弹框在场：卡内文字 min 亮度应低(不透明≈47)；若被白纱盖后则 washed≈224。"""
    import PIL.Image
    im = PIL.Image.open(path).convert("L")
    w, h = im.size
    # 取样中央卡区（x 25%~75%, y 30%~70%）
    x0, x1 = int(w*0.25), int(w*0.75)
    y0, y1 = int(h*0.30), int(h*0.70)
    crop = im.crop((x0, y0, x1, y1))
    px = list(crop.getdata())
    mn = min(px); avg = sum(px)/len(px)
    # 不透明文字存在 => min 明显低于背景(背景亮 ≈220+)
    ok = mn < 120
    print("  弹框透明核验: min_lum=%d avg_lum=%.0f -> %s" %
          (mn, avg, "PASS(不透明,文字可见)" if ok else "FAIL(疑似被白纱盖住/透明)"))
    return ok

def diff_check(pa, pb):
    """游动动画核验：对比【游动倒计时内】两帧卡片蝌蚪区像素差异，证明倒计时内确实在游。"""
    import PIL.Image, PIL.ImageChops
    a = PIL.Image.open(pa).convert("RGB")
    b = PIL.Image.open(pb).convert("RGB")
    w, h = a.size
    crop = (0, int(h*0.30), w, int(h*0.82))   # 卡片蝌蚪区，排除顶部指令条(含进度条)
    d = PIL.ImageChops.difference(a.crop(crop), b.crop(crop))
    bad = 0; total = (crop[3]-crop[1]) * (crop[2]-crop[0])
    for (r, g, bl) in d.getdata():
        if abs(r) + abs(g) + abs(bl) > 24: bad += 1
    frac = bad / total
    ok = frac > 0.0008
    print("  倒计时内游动核验(卡片区): 差异像素=%.3f%% -> %s" %
          (frac*100, "PASS(尾巴/身体在摆动)" if ok else "FAIL(几乎不动)"))
    return ok

def freeze_check(pa, pb):
    """【本轮核心】倒计时归零后两帧卡片区应几乎零差异：蝌蚪停下，玩家在静止画面点选。"""
    frac = card_diff(pa, pb)
    ok = frac < 0.0002
    print("  作答期定格核验(卡片区): 差异像素=%.3f%% -> %s" %
          (frac*100, "PASS(完全静止·已停下)" if ok else "FAIL(仍在游动，没停下来)"))
    return ok

def card_diff(pa, pb):
    """卡片蝌蚪区像素差异比例（排除顶部指令/进度条）。"""
    import PIL.Image, PIL.ImageChops
    a = PIL.Image.open(pa).convert("RGB")
    b = PIL.Image.open(pb).convert("RGB")
    w, h = a.size
    crop = (0, int(h*0.30), w, int(h*0.82))
    d = PIL.ImageChops.difference(a.crop(crop), b.crop(crop))
    bad = 0; total = (crop[3]-crop[1]) * (crop[2]-crop[0])
    for (r, g, bl) in d.getdata():
        if r + g + bl > 24: bad += 1
    return bad / total

def transition_check():
    """定格→动画 衔接核验：交界处(T0→T1)不得突变，之后逐步动起来。"""
    import PIL.Image, PIL.ImageDraw
    names = ["tadpole_T0", "tadpole_T1", "tadpole_T2", "tadpole_T3"]
    paths = [os.path.join(OUT, n + ".png") for n in names]
    if not all(os.path.exists(p) for p in paths):
        print("  ✗ 衔接帧缺失，跳过")
        return False
    ds = [card_diff(paths[k], paths[k+1]) for k in range(3)]
    d_all = card_diff(paths[0], paths[3])
    print("  衔接相邻帧差异: T0→T1=%.3f%%  T1→T2=%.3f%%  T2→T3=%.3f%%  (T0→T3=%.3f%%)" %
          (ds[0]*100, ds[1]*100, ds[2]*100, d_all*100))
    # 修复前红圈瞬间消失 + 全体直飞 + 朝向/摆尾突变 → T0→T1 会很大
    ok = ds[0] < 0.004 and d_all > ds[0] * 2
    print("  起步无突变核验: %s" %
          ("PASS(定格到游动平滑桥接，红圈渐隐跟随)" if ok else "FAIL(交界处仍有突变)"))

    # 2x2 拼图，便于目视确认红圈跟着蝌蚪慢慢淡出
    labels = ["T0 游动首帧·红圈全亮", "T1 起步延迟·圈仍亮不动", "T2 余辉渐隐·缓缓起步", "T3 圈已隐·游动中"]
    thumbs = []
    for p in paths:
        im = PIL.Image.open(p).convert("RGB")
        thumbs.append(im.resize((im.width//2, im.height//2), PIL.Image.LANCZOS))
    tw, th = thumbs[0].size
    sheet = PIL.Image.new("RGB", (tw*2+30, (th+24)*2+10), (245, 245, 245))
    d = PIL.ImageDraw.Draw(sheet)
    for k, im in enumerate(thumbs):
        x = 10 + (k % 2)*(tw+10); y = (k // 2)*(th+24)
        d.text((x+6, y+5), labels[k], fill=(30, 30, 30))
        sheet.paste(im, (x, y+24))
    strip = os.path.join(OUT, "tadpole_transition_strip.png")
    sheet.save(strip)
    print("  衔接拼图 -> %s" % strip)
    return ok

def main():
    os.makedirs(OUT, exist_ok=True)
    # 固定持久 profile（每次捕获都用唯一 ?cb= 防缓存），避免 rmtree 触发批量删除安全拦截
    print("=== Edge 无头截图 (盯蝌蚪) ===")
    for item in CAPS:
        name, q, desc = item[0], item[1], item[2]
        budget = item[3] if len(item) > 3 else 6000
        print("· %s (%s)" % (desc, name))
        shot(name, q, budget)
        time.sleep(0.3)
    # 弹框透明核验（仅对 popup 帧）
    pop = os.path.join(OUT, "tadpole_L1_popup.png")
    if os.path.exists(pop):
        print("=== 弹框透明像素核验 ===")
        check_popup_transparency(pop)
    # 双核验：①游动倒计时内两帧必须有差异（真的在游）②作答期两帧必须零差异（真的停了）
    pa = os.path.join(OUT, "tadpole_anim_a.png")
    pb = os.path.join(OUT, "tadpole_anim_b.png")
    if os.path.exists(pa) and os.path.exists(pb):
        print("=== 倒计时内游动像素核验 ===")
        diff_check(pa, pb)
    fa = os.path.join(OUT, "tadpole_freeze_a.png")
    fb = os.path.join(OUT, "tadpole_freeze_b.png")
    if os.path.exists(fa) and os.path.exists(fb):
        print("=== 第1关·倒计时结束后定格像素核验 ===")
        freeze_check(fa, fb)
    # 后段（第 15 关）抽样：本轮加时后仍须「倒计时内游动 + 归零定格」
    la = os.path.join(OUT, "tadpole_L15_swim.png")
    lfa = os.path.join(OUT, "tadpole_L15_freeze_a.png")
    lfb = os.path.join(OUT, "tadpole_L15_freeze_b.png")
    if os.path.exists(la) and os.path.exists(lfa):
        print("=== 第15关(后段)·游动倒计时内像素核验 ===")
        diff_check(la, lfa)
    if os.path.exists(lfa) and os.path.exists(lfb):
        print("=== 第15关(后段)·倒计时结束后定格像素核验 ===")
        freeze_check(lfa, lfb)
    print("=== 定格→游动 衔接像素核验 ===")
    transition_check()
    print("=== 完成，产物在 %s ===" % OUT)

if __name__ == "__main__":
    main()
