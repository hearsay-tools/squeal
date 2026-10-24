"""Registration lines in worker worktrees in the window, both harnesses; the survey's own worktree left out.
Usage: python3 -I registrations.py out/cases.json out/codex.json"""
import json, re, sys
from collections import Counter
W0, W1, SELF = '2026-10-24T03:55', '2026-10-24T16:49', '6ee42e2a'
REG = re.compile(r'^Complexity: (\d+) functions? over \d+; squeal code lists them\.$')
CNT = re.compile(r'^Complexity counted: (\d+) functions? over')
D = json.load(open(sys.argv[1])); X = json.load(open(sys.argv[2]))
regs, counted = [], {}
for s in D['sessions']:
    w = (s['worktree'] or '')[:8]
    if not w or w == SELF: continue
    regs += [(s['repo'], w, ts, s['version'], int(REG.match(ln).group(1))) for ts, ev, ln in s['registration'] if W0 <= ts <= W1 and REG.match(ln)]
for c in D['cases']:
    m = CNT.match(c['line'])
    if m and c['worktree'] and W0 <= c['ts'] <= W1: counted.setdefault((c['repo'], c['worktree'][:8]), c['ts'])
for s in X:
    cwd = s['cwd'] or ''
    if '/worktrees/' not in cwd: continue
    repo = 'squeal' if '/projects/squeal' in cwd else 'cezar' if '/projects/cezar' in cwd else None
    if not repo: continue
    w = cwd.split('/')[-1][:8]
    for d in s['deliveries']:
        if not (W0 <= d['ts'] <= W1): continue
        for ln in d['text'].split('\n'):
            if REG.match(ln): regs.append((repo, w, d['ts'], s['version'], int(REG.match(ln).group(1))))
            if CNT.match(ln): counted.setdefault((repo, w), d['ts'])
print('registration lines', len(regs), dict(Counter((r[0], r[4] == 0) for r in regs)))
first = {}
for r in sorted(regs, key=lambda r: r[2]): first.setdefault((r[0], r[1]), r)
zero = {k: r for k, r in first.items() if r[4] == 0}
print('worktrees', len(first), dict(Counter((r[0], r[4] == 0) for r in first.values())))
print('zero first registrations by version', dict(Counter(r[3] for r in zero.values())))
print('corrected later by "Complexity counted:"', sum(1 for k, r in zero.items() if counted.get(k, '') > r[2]))
