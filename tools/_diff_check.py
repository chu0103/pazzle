import re
from PIL import Image, ImageDraw

ROOT = 'C:/Users/admin/WorkBuddy/2026-09-30-08-41-53/puzzle-arcade'
src = open(ROOT + '/js/game/diffAssets.js').read()
m = re.search(r"d01_a\.jpg', b: '[^']*', color: '[^']*', w: \d+, h: \d+, diffs: \[([^\]]*)\]", src)
diffs = []
for blk in re.findall(r"\{([^\}]*)\}", m.group(1)):
    kv = {}
    for pair in blk.split(','):
        k, v = pair.split(':')
        kv[k.strip()] = float(v)
    diffs.append(kv)
a = Image.open(ROOT + '/assets/diff/d01_a.jpg').convert('RGB')
b = Image.open(ROOT + '/assets/diff/d01_b.jpg').convert('RGB')
db = b.copy()
d = ImageDraw.Draw(db)
S = 720
for r in diffs:
    x0, y0 = int(r['u'] * S), int(r['v'] * S)
    x1, y1 = int((r['u'] + r['uw']) * S), int((r['v'] + r['vh']) * S)
    d.rectangle([x0, y0, x1, y1], outline=(231, 76, 60), width=7)
pad = 16
W = 720 * 2 + pad * 3
comp = Image.new('RGB', (W, 720 + pad * 2), (235, 238, 242))
comp.paste(a, (pad, pad))
comp.paste(db, (pad * 2 + 720, pad))
out = ROOT + '/test/shots/diff_d01_check.png'
comp.save(out)
print('saved', out, 'diffs=', len(diffs))
