"""Per-session counts of complexity lines by kind and verdict, with stored transitions.
Usage: python3 -I session-table.py out/line-table.md out/transitions-squeal.json out/transitions-cezar.json"""
import json, re, sys
from collections import defaultdict, Counter
rows = [l for l in open(sys.argv[1]) if l.startswith('| ') and not l.startswith('| Time') and not l.startswith('| ---')]
T = {'squeal': json.load(open(sys.argv[2])), 'cezar': json.load(open(sys.argv[3]))}
S = defaultdict(lambda: {'v': set(), 'k': Counter(), 'j': Counter()})
def kind(line):
    for k in ('STILL FAIL', 'FAIL', 'PASS', 'RESOLVED'):
        if line.startswith(k + ' '): return k
    return 'too big' if ' KiB, over' in line else 'summary'
for l in rows:
    c = [x.strip() for x in l.strip().strip('|').split(' | ')]
    t, repo, who, v, line, cause, react, verdict = c[:8]
    s = S[(repo, who)]; s['v'].add(v); s['k'][kind(line.strip('`'))] += 1; s['j'][verdict] += 1
K = ('FAIL', 'PASS', 'STILL FAIL', 'RESOLVED', 'too big', 'summary')
print('| Repo | Session | Versions | Stored transitions | ' + ' | '.join(K) + ' | Verdicts |')
print('| --- | --- | --- | --- | ' + ' | '.join('---' for _ in K) + ' | --- |')
for (repo, who), s in sorted(S.items()):
    key = who.split()[-1] if 'main checkout' not in who else repo
    tr = T[repo].get(key, {})
    trs = ', '.join(f'{n} {k.split(":")[0]}' for k, n in sorted(tr.items())) or '0'
    print(f'| {repo} | {who} | {", ".join(sorted(s["v"]))} | {trs} | ' + ' | '.join(str(s['k'][k] or '') for k in K) + ' | ' + ', '.join(f'{n} {j}' for j, n in s['j'].most_common()) + ' |')
seen = {(r, w.split()[-1]) for r, w in S}
for repo in T:
    for key, tr in T[repo].items():
        if (repo, key) not in seen and key != repo:
            print(f'| {repo} | Claude Code {key} | | ' + ', '.join(f'{n} {k.split(":")[0]}' for k, n in sorted(tr.items())) + ' | ' + ' | '.join('' for _ in K) + ' | no line |')
