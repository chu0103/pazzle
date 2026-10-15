# 按 project.config.json 的 packOptions.ignore 复核微信主包真实体积
import json, os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cfg_path = os.path.join(root, 'project.config.json')
with open(cfg_path, encoding='utf-8') as f:
    cfg = json.load(f)

ignore = (cfg.get('packOptions') or {}).get('ignore') or []
ignore = [i.get('value') if isinstance(i, dict) else i for i in ignore]
print('ignore 规则: %s' % ignore)

def ignored(rel):
    r = rel.replace('\\', '/')
    for pat in ignore:
        p = pat.replace('\\', '/').rstrip('/')
        if r == p or r.startswith(p + '/'):
            return True
    return False

total = 0
per = {}
for dirpath, dirnames, filenames in os.walk(root):
    rel_dir = os.path.relpath(dirpath, root).replace('\\', '/')
    if rel_dir == '.':
        rel_dir = ''
    if rel_dir and rel_dir.split('/')[0] == '.workbuddy':
        dirnames[:] = []
        continue
    for name in filenames:
        rel = (rel_dir + '/' + name) if rel_dir else name
        if ignored(rel):
            continue
        size = os.path.getsize(os.path.join(dirpath, name))
        total += size
        top = rel.split('/')[0] if '/' in rel else rel
        per[top] = per.get(top, 0) + size

LIMIT = 4 * 1024 * 1024
by_size = sorted(per.items(), key=lambda kv: -kv[1])[:12]
print('')
for k, v in by_size:
    print('  %-24s %8.1f KB' % (k, v / 1024))
print('')
print('打包体积: %.2f KB / %.2f MB' % (total / 1024, total / 1024 / 1024))
print('容量余量: %.2f KB (%.1f%%)' % ((LIMIT - total) / 1024, (LIMIT - total) / LIMIT * 100))
