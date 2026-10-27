"""015-14 Round 3, D10: CPU per edit with coverage off and on, per pair and
edit, from ab.jsonl, beside Round 2's ratios. Round 2's part-b/bin/d10.py with
the base from DOGFOOD_BASE, an edit counted as measured below the CPU count
only when both arms' one-minute loads at its start were at or under it, and a
geometric mean with a t interval on the log ratios.
Writes out/table-d10.md and prints the summary.
Usage: python3 -I d10.py [cpus]"""
import collections, json, math, os, re, statistics, sys

B = os.environ.get('DOGFOOD_BASE', '/var/tmp/dogfood-015-14/w-d3937b73')
CPUS = int(sys.argv[1]) if len(sys.argv) > 1 else os.cpu_count()
# Round 2 (part-b.md, D10): on/off CPU to the verdict per edit pair, pairs 1 and 2.
ROUND2 = [1.17, 1.15, 1.20, 1.47, 0.92, 0.99, 1.04, 1.08, 1.21, 1.10]
T975 = {1: 12.71, 2: 4.30, 3: 3.18, 4: 2.78, 5: 2.57, 6: 2.45, 7: 2.36, 8: 2.31, 9: 2.26, 10: 2.23, 11: 2.20,
        12: 2.18, 13: 2.16, 14: 2.14, 15: 2.13, 16: 2.12, 17: 2.11, 18: 2.10, 19: 2.09, 20: 2.09}


def summary(ratios):
    logs = [math.log(r) for r in ratios]
    g = math.exp(statistics.mean(logs))
    if len(logs) < 2:
        return g, None
    half = T975.get(len(logs) - 1, 2.0) * statistics.stdev(logs) / math.sqrt(len(logs))
    return g, (math.exp(statistics.mean(logs) - half), math.exp(statistics.mean(logs) + half))




def selected(edit):
    m = re.search(r'it selects the (\d+) test files?', edit.get('wait_out', ''))
    return m.group(1) if m else '?'


arms = [json.loads(l) for l in open(f'{B}/out/ab.jsonl')]
pairs = collections.defaultdict(dict)
for a in arms:
    pairs[a['arm']][a['mode']] = a
out = ['| Pair | Order | Edit | Test files off / on | Load off / on | CPU to verdict, off / on (s) | On / off | CPU to quiet, off / on (s) | On / off | Verdict wall, off / on (s) |',
       '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
ratios, below, quiet, walls = [], [], [], []
for p in sorted(pairs):
    if set(pairs[p]) != {'off', 'on'}:
        continue
    off, on = pairs[p]['off'], pairs[p]['on']
    order = 'off, on' if off['at'] < on['at'] else 'on, off'
    tv = collections.Counter()
    for eo, en in zip(off['edits'], on['edits']):
        assert eo['name'] == en['name']
        rv = en['cpu_to_verdict_s'] / eo['cpu_to_verdict_s']
        rq = en['cpu_to_quiet_s'] / eo['cpu_to_quiet_s']
        over = max(eo['load1'], en['load1']) > CPUS
        ratios.append(rv)
        quiet.append(rq)
        walls.append(en['verdict_s'] / eo['verdict_s'])
        if not over:
            below.append(rv)
        tv['off'] += eo['cpu_to_verdict_s']
        tv['on'] += en['cpu_to_verdict_s']
        out.append(f"| {p[1:]}{f' (over load {CPUS})' if over else ''} | {order} | {eo['name']} `{eo['path'].split('/')[-1]}` | {selected(eo)} / {selected(en)} | "
                   f"{eo['load1']:.1f} / {en['load1']:.1f} | {eo['cpu_to_verdict_s']:.0f} / {en['cpu_to_verdict_s']:.0f} | {rv:.2f} | "
                   f"{eo['cpu_to_quiet_s']:.0f} / {en['cpu_to_quiet_s']:.0f} | {rq:.2f} | {eo['verdict_s']:.0f} / {en['verdict_s']:.0f} |")
    out.append(f"| {p[1:]} | | all 5 edits | | | {tv['off']:.0f} / {tv['on']:.0f} | {tv['on'] / tv['off']:.2f} | | | |")
    out.append(f"| {p[1:]} | | start (lookup-only, empty store) | | {off['load_start']:.1f} / {on['load_start']:.1f} | "
               f"{off['start_cpu_s']:.0f} / {on['start_cpu_s']:.0f} | {on['start_cpu_s'] / off['start_cpu_s']:.2f} | | | "
               f"{off['start_wall_s']:.0f} / {on['start_wall_s']:.0f} |")
open(f'{B}/out/table-d10.md', 'w').write('\n'.join(out) + '\n')
print('\n'.join(out))
for name, rs in (('Round 3, all edit pairs', ratios), (f'Round 3, both arms at load <= {CPUS}', below), ('Round 2, all edit pairs', ROUND2)):
    if rs:
        g, ci = summary(rs)
        print(f"{name}: n {len(rs)}, median {statistics.median(rs):.3f}, geometric mean {g:.3f}, "
              f"95% interval {'%.3f to %.3f' % ci if ci else 'n/a'}, range {min(rs):.2f} to {max(rs):.2f}, above 1: {sum(r > 1 for r in rs)}")
if quiet:
    print(f'to quiet: median {statistics.median(quiet):.3f}; verdict wall: median {statistics.median(walls):.3f}')
for a in arms:
    print(a['arm'], a['mode'], a['at'], a.get('squeal'), a.get('node'), 'start cpu', a['start_cpu_s'], 'wall', a['start_wall_s'],
          'total cpu', a['total_cpu_s'], 'load', a['load_start'], a['load_end'], 'code.sqlite', a.get('code.sqlite_bytes'),
          'store.sqlite', a.get('store.sqlite_bytes'))
