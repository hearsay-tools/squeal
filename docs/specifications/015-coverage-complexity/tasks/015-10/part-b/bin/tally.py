"""Tables per repository from the judged lines. Usage: python3 -I tally.py"""
import json, re, collections
CACHE = [('0.1.283','01:58:27'),('0.1.284','02:42:11'),('0.1.286','05:16:43'),('0.1.287','08:39:19'),('0.1.288','09:09:30'),('0.1.289','10:07:25'),('0.1.291','11:31:12'),('0.1.292','12:04:29'),('0.1.293','14:51:24'),('0.1.294','16:14:13')]
def ver(ts):
    v = '0.1.280'
    for x, t in CACHE:
        if ts >= '2026-10-24T' + t + 'Z': v = x
    return v
def group(repo, co, ts, v):
    if repo == 'cezar' and ts < '2026-10-24T07:31':
        return 'cezar ' + co + ' before 07:31Z'
    return repo + (' 0.1.292+' if tuple(map(int, v.split('.'))) >= (0, 1, 292) else ' before 0.1.292')
W0, W1 = '2026-10-24T03:55', '2026-10-24T16:49'
D = json.load(open('out/cases.json'))
X = json.load(open('out/codex.json'))
J = {}
for f, h in (('out/judged.tsv', 'cc'), ('out/codex-judged.tsv', 'codex')):
    for row in open(f):
        if row.startswith('#') or not row.strip(): continue
        w, t, k, fn, cause, react, verdict, note = (row.rstrip('\n').split('\t') + [''] * 8)[:8]
        J[(h, w, t, k, fn)] = (cause, react, verdict)
lines = []
for c in D['cases']:
    if c['ts'] < W0 or c['ts'] > W1 or c['kind'] == 'registration': continue
    w = (c['worktree'] or 'main')[:8]
    fn = c['name'] if c['kind'] not in ('summary', 'too big') else ('-' if c['kind'] == 'summary' else 'run.ts')
    j = J.get(('cc', w, c['ts'][11:19], c['kind'], fn), ('', '', 'other side' if c['kind'].startswith('other') else '?'))
    lines.append({'harness': 'claude', 'repo': c['repo'], 'session': c['session'], 'kind': c['kind'], 'group': group(c['repo'], c['checkout'], c['ts'], c['version']), 'cause': j[0], 'verdict': j[2], 'version': c['version']})
RX = [('STILL FAIL', r'^STILL FAIL complexity: (.+?) \([^()\s]+'), ('FAIL', r'^FAIL complexity: (.+?) \([^()\s]+'), ('PASS', r'^PASS complexity: (.+?) \([^()\s]+'), ('RESOLVED', r'^RESOLVED complexity: (.+?) \([^()\s]+'),
      ('too big', r'^\S+ is \d+ KiB, over'), ('summary', r'^Complexity (counted|threshold)'), ('other side: code', r'^Complexity: \d+ functions? over \d+ that'), ('other side: tests', r'^Tests: \d+ known')]
xs = []
for s in X:
    cwd = s['cwd'] or ''
    repo = 'squeal' if '/projects/squeal' in cwd else 'cezar' if '/projects/cezar' in cwd else None
    if not repo: continue
    co = 'worktree' if '/worktrees/' in cwd else 'main'
    key = cwd.split('/')[-1][:8] if co == 'worktree' else 'cezar'
    for d in s['deliveries']:
        if d['ts'] < W0 or d['ts'] > W1: continue
        for ln in d['text'].split('\n'):
            for k, rx in RX:
                m = re.match(rx, ln)
                if not m: continue
                fn = m.group(1) if k in ('STILL FAIL', 'FAIL', 'PASS', 'RESOLVED') else ('-' if k == 'summary' else 'run.ts')
                j = J.get(('codex', key, d['ts'][11:19], k, fn), ('', '', 'other side' if k.startswith('other') else '?'))
                lines.append({'harness': 'codex', 'repo': repo, 'session': s['file'], 'kind': k, 'group': group(repo, co, d['ts'], s['version']), 'cause': j[0], 'verdict': j[2], 'version': s['version']})
                break
assert not [l for l in lines if l['verdict'] == '?'], [l for l in lines if l['verdict'] == '?'][:3]
# sessions per group: working sessions (worktrees, and Codex in any checkout) with a tool call in the group
sess = collections.defaultdict(set); helpers = collections.Counter()
for s in D['sessions']:
    if s['checkout'] == 'main':
        helpers[s['repo']] += 1
        continue
for s in json.load(open('out/cc.json')):
    cwd = s['cwd'] or ''
    repo = 'squeal' if cwd.startswith('/home/agent/projects/squeal') else 'cezar' if cwd.startswith('/home/agent/projects/cezar') else None
    if not repo or '/worktrees/' not in cwd: continue
    starts = sorted(x['ts'] for x in s['starts'] if x['ts'])
    for t in s['tools']:
        if W0 <= t['ts'] <= W1:
            st = [x for x in starts if x <= t['ts']]
            sess[group(repo, 'worktree', t['ts'], ver(st[-1] if st else s['first']))].add(('claude', s['session']))
for s in X:
    cwd = s['cwd'] or ''
    repo = 'squeal' if '/projects/squeal' in cwd else 'cezar' if '/projects/cezar' in cwd else None
    if not repo: continue
    co = 'worktree' if '/worktrees/' in cwd else 'main'
    for c in s['cmds']:
        if W0 <= c['ts'] <= W1:
            sess[group(repo, co, c['ts'], s['version'])].add(('codex', s['file']))
order = ['squeal before 0.1.292', 'squeal 0.1.292+', 'cezar main before 07:31Z', 'cezar worktree before 07:31Z', 'cezar before 0.1.292', 'cezar 0.1.292+']
K = ['FAIL', 'PASS', 'STILL FAIL', 'RESOLVED', 'too big', 'summary', 'other side: code', 'other side: tests']
V = ['useful', 'redundant', 'unclear', 'noise']
print('| Group | Sessions (Claude Code + Codex) | with a complexity line | ' + ' | '.join(K) + ' | ' + ' | '.join(V) + ' |')
for g in order:
    L = [l for l in lines if l['group'] == g]
    ss = sess.get(g, set())
    cc = sum(1 for x in ss if x[0] == 'claude'); cx = len(ss) - cc
    withl = len({(l['harness'], l['session']) for l in L if not l['kind'].startswith('other')})
    k = collections.Counter(l['kind'] for l in L); v = collections.Counter(l['verdict'] for l in L if not l['kind'].startswith('other'))
    print(f'| {g} | {cc} + {cx} | {withl} | ' + ' | '.join(str(k[x]) for x in K) + ' | ' + ' | '.join(str(v[x]) for x in V) + ' |')
print('helpers in main checkouts (Claude Code, Haiku):', dict(helpers))
c = collections.Counter((l['repo'], l['kind'], l['cause'], l['verdict']) for l in lines if l['kind'] in ('FAIL', 'PASS', 'STILL FAIL', 'RESOLVED'))
for x in sorted(c): print(x, c[x])
pv = collections.Counter((l['kind'], l['cause'], 'new' if l['group'].endswith('0.1.292+') else 'old') for l in lines if l['kind'] in ('STILL FAIL', 'FAIL', 'PASS'))
print('P1/P2 split:', sorted(pv.items()))
json.dump(lines, open('out/lines.json', 'w'))
