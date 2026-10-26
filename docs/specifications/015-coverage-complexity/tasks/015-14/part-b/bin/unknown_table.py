"""015-14 part B: the per-worktree table of file states and the uncovered functions they hold.
Usage: python3 -I unknown_table.py  (reads out/roots.json, out/summaries.json, out/states-by-path.json)"""
import json, collections, statistics
O = '/tmp/dogfood-015-14/w-327524f0/out/'
ids = json.load(open(O + 'roots.json'))
summ = {r['wt']: json.loads(r['value']) for r in json.load(open(O + 'summaries.json'))}
fns = collections.defaultdict(lambda: collections.Counter())
unres = collections.Counter()
for r in json.load(open(O + 'states-by-path.json')):
    if r['m'] != 'uncovered' or r['wt'] not in summ:
        continue
    f = summ[r['wt']]['files'].get(r['path'])
    key = (f['state'], f.get('cause') or f.get('reason')) if f else ('absent', None)
    fns[r['wt']][key] += r['n']
    if f and f['state'] == 'judged' and r['o'] == 'unknown':
        unres[r['wt']] += r['n']
COLS = [('judged', None), ('unknown', 'skipped'), ('unknown', 'no-record'), ('pending', 'run'), ('pending', 'imports'), ('pending', 'record')]
print('| Worktree | Files | Judged | Unknown, skipped | Unknown, no record | Pending, run | Pending, imports | Pending, record | Functions | In judged files | Unresolved spans | In skipped files | In no-record files |')
print('| --- |' + ' --- |' * 12)
tot = collections.Counter()
rows = []
for wt, s in summ.items():
    name = ids.get(wt, '?')
    name = 'main checkout' if name.rstrip('/').endswith('/squeal') else name.split('/')[-1][:8]
    fc = collections.Counter((f['state'], f.get('cause') or f.get('reason')) for f in s['files'].values())
    fc[('judged', None)] = sum(n for (st, _), n in fc.items() if st == 'judged')
    allf = sum(fns[wt].values())
    row = [len(s['files'])] + [fc[c] for c in COLS] + [allf, sum(n for (st, _), n in fns[wt].items() if st == 'judged'), unres[wt],
                                                       fns[wt][('unknown', 'skipped')], fns[wt][('unknown', 'no-record')]]
    rows.append((name, row))
    tot.update(dict(enumerate(row)))
for name, row in sorted(rows):
    print(f'| {name} | ' + ' | '.join(str(x) for x in row) + ' |')
print(f'| All {len(rows)} | ' + ' | '.join(str(tot[i]) for i in range(len(rows[0][1]))) + ' |')
closed = [r for _, r in rows if r[1] or r[2] or r[3]]
print(f'| Median of the {len(closed)} with closures | ' + ' | '.join(str(statistics.median(r[i] for r in closed)) for i in range(len(rows[0][1]))) + ' |')
other = collections.Counter(k for s in summ.values() for k in ((f['state'], f.get('cause') or f.get('reason')) for f in s['files'].values()) if k not in COLS and k[0] != 'judged')
print('other file states:', dict(other))
