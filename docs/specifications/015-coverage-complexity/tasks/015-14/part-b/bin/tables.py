"""015-14 part B: Markdown tables of the window's code lines by version (this repository; other repositories apart).
Usage: python3 -I tables.py > out/tables.md"""
import json, re, collections

O = '/tmp/dogfood-015-14/w-327524f0/out/'
xs = json.load(open(O + 'judged.json'))
allx = json.load(open(O + 'lines.json'))
here = [x for x in allx if x.get('repo', 'squeal') == 'squeal']


def vkey(v):
    return tuple(int(p) for p in (v or '0.0.0').split('.'))


def stype(line):
    if 'that this session was told about' in line:
        return 'told'
    if line.startswith('Complexity counted'):
        return 'counted'
    if 'counting has not started' in line or 'counting,' in line:
        return 'counting'
    if 'no longer checked' in line:
        return 'exclude'
    return 'registration'


print('### All code lines in this repository, by version\n')
print('| Version | Sessions with a line | Complexity FAIL / PASS / STILL FAIL / RESOLVED | CRAP FAIL / PASS / STILL FAIL / RESOLVED | untested FAIL / PASS / STILL FAIL / RESOLVED | Registration | Counting / counted | Told-over |')
print('| --- | --- | --- | --- | --- | --- | --- | --- |')
by = collections.defaultdict(list)
for x in here:
    by[x['version']].append(x)
tot = collections.Counter()
for v in sorted(by, key=vkey):
    ls = by[v]
    c = collections.Counter((x['measure'], x['kind']) for x in ls)
    s = collections.Counter(stype(x['line']) for x in ls if x['kind'] == 'summary')
    ses = len({(x['harness'], x['session']) for x in ls if x['kind'] != 'summary' or stype(x['line']) not in ('registration', 'counting')})
    part = lambda m: ' / '.join(str(c[(m, k)]) for k in ('FAIL', 'PASS', 'STILL FAIL', 'RESOLVED'))
    print(f"| {v} | {ses} | {part('complexity')} | {part('crap')} | {part('untested')} | {s['registration']} | {s['counting']} / {s['counted']} | {s['told']} |")
    tot.update(c)
    tot.update({'s:' + k: n for k, n in s.items()})
part = lambda m: ' / '.join(str(tot[(m, k)]) for k in ('FAIL', 'PASS', 'STILL FAIL', 'RESOLVED'))
print(f"| All | | {part('complexity')} | {part('crap')} | {part('untested')} | {tot['s:registration']} | {tot['s:counting']} / {tot['s:counted']} | {tot['s:told']} |")

print('\n### Coverage lines (CRAP and untested) in this repository, by version, with verdicts\n')
print('| Version | Sessions | FAIL | PASS | STILL FAIL | RESOLVED | Useful | Unclear | Noise |')
print('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
cov = [x for x in xs if x['measure'] in ('crap', 'untested') and x.get('repo', 'squeal') == 'squeal']
byv = collections.defaultdict(list)
for x in cov:
    byv[x['version']].append(x)
T = collections.Counter()
for v in sorted(byv, key=vkey):
    ls = byv[v]
    k = collections.Counter(x['kind'] for x in ls)
    d = collections.Counter(x['verdict'] for x in ls)
    print(f"| {v} | {len({x['session'] for x in ls})} | {k['FAIL']} | {k['PASS']} | {k['STILL FAIL']} | {k['RESOLVED']} | {d['useful']} | {d['unclear']} | {d['noise']} |")
    T.update(k)
    T.update({'v:' + a: b for a, b in d.items()})
print(f"| All | {len({x['session'] for x in cov})} | {T['FAIL']} | {T['PASS']} | {T['STILL FAIL']} | {T['RESOLVED']} | {T['v:useful']} | {T['v:unclear']} | {T['v:noise']} |")

print('\n### Coverage lines before and after 0.1.341 (default on)\n')
for label, f in (('before 0.1.341', lambda v: vkey(v) < (0, 1, 341)), ('0.1.341 and later', lambda v: vkey(v) >= (0, 1, 341))):
    ls = [x for x in cov if f(x['version'])]
    print(label, len(ls), dict(collections.Counter(x['verdict'] for x in ls)), dict(collections.Counter(x['why'] for x in ls)))

print('\n### Noise by reason\n')
for k, n in collections.Counter(x['why'] for x in cov if x['verdict'] == 'noise').most_common():
    print(f'- {n}: {k}')

print('\n### Told-over lines: per session, first unclear, repeats noise\n')
told = [x for x in here if x['kind'] == 'summary' and stype(x['line']) == 'told']
per = collections.Counter((x['harness'], x['session']) for x in told)
print(len(told), 'lines in', len(per), 'sessions; repeats', sum(n - 1 for n in per.values()), '; max per session', max(per.values()))
print(sorted(per.values(), reverse=True)[:10])
