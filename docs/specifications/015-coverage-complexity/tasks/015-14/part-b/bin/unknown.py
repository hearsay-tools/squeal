"""015-14 part B: crap and uncovered states that read unknown, by cause, per live worktree (read-only exports).
The file's cause comes from its coverage summary; an unknown function in a judged file is an unresolved span."""
import json, collections, sys
O = '/tmp/dogfood-015-14/w-327524f0/out/'
ids = json.load(open(O + 'roots.json'))
summ = {r['wt']: json.loads(r['value']) for r in json.load(open(O + 'summaries.json'))}
rows = json.load(open(O + 'states-by-path.json'))
per = collections.defaultdict(lambda: collections.Counter())
hidden = collections.defaultdict(lambda: collections.Counter())
fn_in = collections.defaultdict(lambda: collections.defaultdict(int))
for r in rows:
    if r['m'] == 'complexity':
        fn_in[r['wt']][r['path']] += r['n']
for r in rows:
    if r['m'] != 'uncovered':
        continue  # crap and uncovered share the file's condition; count functions once
    s = summ.get(r['wt'])
    if s is None:
        continue
    f = s['files'].get(r['path'])
    fstate = f['state'] if f else 'absent'
    cause = f.get('cause') if f else None
    if r['o'] == 'unknown':
        key = cause if fstate == 'unknown' else ('unresolved span' if fstate == 'judged' else f'in a {fstate} file')
        per[r['wt']][key] += r['n']
    if fstate == 'unknown':
        hidden[r['wt']][(cause, r['o'])] += r['n']
tot = collections.Counter(); toth = collections.Counter()
for wt in summ:
    name = ids.get(wt, '?').split('/')[-1][:8]
    print(name, dict(per[wt]), '| functions in unknown files by (cause, stored outcome):', dict(hidden[wt]))
    tot.update(per[wt]); toth.update(hidden[wt])
print('TOTAL unknown by cause', dict(tot))
print('TOTAL functions in unknown files', dict(toth))
# files by state and cause
fc = collections.Counter()
for wt, s in summ.items():
    for p, f in s['files'].items():
        fc[(f['state'], f.get('cause') or f.get('reason'))] += 1
print('files by state', dict(fc))
