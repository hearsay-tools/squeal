"""015-14 part B, D10: CPU per edit with coverage off and on, per pair and edit, from out/ab.jsonl.
Writes out/table-d10.md (the table for part-b.md) and prints the summary numbers.
Usage: python3 -I d10.py"""
import json, statistics, collections
O = '/tmp/dogfood-015-14/w-327524f0/out/'
arms = [json.loads(l) for l in open(O + 'ab.jsonl')]
pairs = collections.defaultdict(dict)
for a in arms:
    pairs[a['arm']][a['mode']] = a
rows, ratios_v, ratios_q, tot = [], [], [], collections.Counter()
out = ['| Pair | Order | Edit | Test files | Load off / on | CPU to verdict, off / on (s) | On / off | CPU to quiet, off / on (s) | On / off | Verdict wall, off / on (s) |',
       '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
walls, added = [], []
SEL = {'E0': 2, 'E1': 2, 'E2': 19, 'E3': 41, 'E4': 78}
for p in sorted(pairs):
    if set(pairs[p]) != {'off', 'on'}:
        continue
    off, on = pairs[p]['off'], pairs[p]['on']
    order = 'off, on' if off['at'] < on['at'] else 'on, off'
    for eo, en in zip(off['edits'], on['edits']):
        assert eo['name'] == en['name']
        rv = en['cpu_to_verdict_s'] / eo['cpu_to_verdict_s']
        rq = en['cpu_to_quiet_s'] / eo['cpu_to_quiet_s']
        ratios_v.append((p, eo['name'], rv, max(eo['load1'], en['load1'])))
        ratios_q.append((p, eo['name'], rq))
        tot[(p, 'off v')] += eo['cpu_to_verdict_s']; tot[(p, 'on v')] += en['cpu_to_verdict_s']
        tot[(p, 'off q')] += eo['cpu_to_quiet_s']; tot[(p, 'on q')] += en['cpu_to_quiet_s']
        over = max(eo['load1'], en['load1']) > 24
        walls.append(en['verdict_s'] / eo['verdict_s'])
        added.append(en['cpu_to_verdict_s'] - eo['cpu_to_verdict_s'])
        out.append(f"| {p[1:]}{' (over load 24)' if over else ''} | {order} | {eo['name']} `{eo['path'].split('/')[-1]}` | {SEL[eo['name']]} + 61 | "
                   f"{eo['load1']:.1f} / {en['load1']:.1f} | {eo['cpu_to_verdict_s']:.0f} / {en['cpu_to_verdict_s']:.0f} | {rv:.2f} | "
                   f"{eo['cpu_to_quiet_s']:.0f} / {en['cpu_to_quiet_s']:.0f} | {rq:.2f} | {eo['verdict_s']:.0f} / {en['verdict_s']:.0f} |")
    out.append(f"| {p[1:]} | | all 5 edits | | | {tot[(p, 'off v')]:.0f} / {tot[(p, 'on v')]:.0f} | {tot[(p, 'on v')] / tot[(p, 'off v')]:.2f} | "
               f"{tot[(p, 'off q')]:.0f} / {tot[(p, 'on q')]:.0f} | {tot[(p, 'on q')] / tot[(p, 'off q')]:.2f} | |")
    out.append(f"| {p[1:]} | | start (lookup-only, empty store) | | {off['load_start']:.1f} / {on['load_start']:.1f} | {off['start_cpu_s']:.0f} / {on['start_cpu_s']:.0f} | "
               f"{on['start_cpu_s'] / off['start_cpu_s']:.2f} | | | {off['start_wall_s']:.0f} / {on['start_wall_s']:.0f} |")
open(O + 'table-d10.partial.md', 'w').write('\n'.join(out) + '\n')
print('\n'.join(out))
if ratios_v:
    print('median on/off to verdict', round(statistics.median(r[2] for r in ratios_v), 3), 'n', len(ratios_v))
    print('median on/off to quiet', round(statistics.median(r[2] for r in ratios_q), 3))
    print('median on/off verdict wall', round(statistics.median(walls), 3), 'added cpu per edit (s)', sorted(round(x) for x in added))
    print('ratios', sorted(round(r[2], 2) for r in ratios_v))
    low = [r for r in ratios_v if r[3] <= 24]
    print('edits at load <= 24 in both arms:', len(low), [(r[0], r[1], round(r[2], 2)) for r in low])
for a in arms:
    print(a['arm'], a['mode'], a['at'], 'start cpu', a['start_cpu_s'], 'wall', a['start_wall_s'], 'total cpu', a['total_cpu_s'],
          'load', a['load_start'], a['load_end'], 'code.sqlite', a.get('code.sqlite_bytes'), 'store.sqlite', a.get('store.sqlite_bytes'))
