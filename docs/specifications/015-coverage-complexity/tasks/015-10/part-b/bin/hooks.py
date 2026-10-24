"""PostToolBatch hooks per tool batch, by repository, checkout and version (read only).
Usage: python3 -I hooks.py out/cc.json"""
import json, sys, collections
sys.path.insert(0, '')
from importlib import util
spec = util.spec_from_file_location('cases_mod', 'bin/cases.py')
CACHE = [('0.1.283','01:58:27'),('0.1.284','02:42:11'),('0.1.286','05:16:43'),('0.1.287','08:39:19'),('0.1.288','09:09:30'),('0.1.289','10:07:25'),('0.1.291','11:31:12'),('0.1.292','12:04:29'),('0.1.293','14:51:24'),('0.1.294','16:14:13')]
def ver(ts):
    v='0.1.280'
    for x,t in CACHE:
        if ts >= '2026-10-24T'+t+'Z': v=x
    return v
S = json.load(open(sys.argv[1]))
tab = collections.defaultdict(lambda: collections.Counter())
for s in S:
    cwd = s['cwd'] or ''
    repo = 'squeal' if cwd.startswith('/home/agent/projects/squeal') else 'cezar' if cwd.startswith('/home/agent/projects/cezar') else None
    if not repo or '/worktrees/' not in cwd:
        continue
    starts = sorted(x['ts'] for x in s['starts'] if x['ts'])
    def v_at(ts):
        st = [x for x in starts if x <= ts]
        return ver(st[-1] if st else s['first'])
    batches = {}
    for t in s['tools']:
        if t['ts'] >= '2026-10-24T03:55' and t['ts'] <= '2026-10-24T16:49':
            batches.setdefault(t['msg'], t['ts'])
    for m, ts in batches.items():
        tab[(repo, 'pre-0.1.292' if v_at(ts) < '0.1.292' else '0.1.292+')]['batches'] += 1
    for h in s.get('hooks', []):
        if h['event'] != 'PostToolBatch' or not ('2026-10-24T03:55' <= h['ts'] <= '2026-10-24T16:49'):
            continue
        k = (repo, 'pre-0.1.292' if v_at(h['ts']) < '0.1.292' else '0.1.292+')
        tab[k][h['kind']] += 1
for k in sorted(tab):
    c = tab[k]
    print(k, dict(c), 'cancelled per batch: %.1f%%' % (100 * c['hook_cancelled'] / max(1, c['batches'])))
