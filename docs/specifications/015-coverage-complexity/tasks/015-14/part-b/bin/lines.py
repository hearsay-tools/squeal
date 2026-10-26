"""015-14 part B: every code line delivered in the window, with its session, version, measure and kind.
Claude Code: a line's version is the newest cache entry at the latest process start before it (Round 1's rule).
Codex: the version in the session's skill path, a lower bound.
Usage: python3 -I lines.py  (reads out/cc.json, out/codex-all.json; writes out/lines.json)"""
import json, re, collections

O = '/tmp/dogfood-015-14/w-327524f0/out/'
W0, W1 = '2026-10-25T18:10:00Z', '2026-10-26T16:16:00Z'
CACHE = [('0.1.311', '2026-10-25T13:54:05Z'), ('0.1.313', '2026-10-25T14:59:55Z'), ('0.1.314', '2026-10-25T15:47:55Z'),
         ('0.1.316', '2026-10-25T16:39:52Z'), ('0.1.317', '2026-10-25T17:29:11Z'), ('0.1.318', '2026-10-25T17:58:42Z'),
         ('0.1.319', '2026-10-25T18:38:33Z'), ('0.1.320', '2026-10-25T19:04:35Z'), ('0.1.321', '2026-10-25T19:43:18Z'),
         ('0.1.323', '2026-10-25T21:12:30Z'), ('0.1.325', '2026-10-25T22:22:03Z'), ('0.1.326', '2026-10-25T22:49:56Z'),
         ('0.1.327', '2026-10-25T23:23:22Z'), ('0.1.328', '2026-10-26T00:27:10Z'), ('0.1.329', '2026-10-26T00:58:22Z'),
         ('0.1.330', '2026-10-26T02:01:18Z'), ('0.1.331', '2026-10-26T02:42:00Z'), ('0.1.332', '2026-10-26T04:29:54Z'),
         ('0.1.333', '2026-10-26T05:40:50Z'), ('0.1.334', '2026-10-26T08:49:33Z'), ('0.1.335', '2026-10-26T09:32:37Z'),
         ('0.1.336', '2026-10-26T10:29:44Z'), ('0.1.339', '2026-10-26T11:23:17Z'), ('0.1.341', '2026-10-26T12:07:41Z'),
         ('0.1.342', '2026-10-26T12:24:25Z'), ('0.1.343', '2026-10-26T13:28:13Z'), ('0.1.345', '2026-10-26T14:04:05Z'),
         ('0.1.346', '2026-10-26T14:53:42Z'), ('0.1.347', '2026-10-26T15:45:35Z')]


def version_at(ts):
    v = None
    for name, t in CACHE:
        if t <= ts:
            v = name
    return v


MEAS = {'complexity': 'complexity', 'CRAP': 'crap', 'untested': 'untested', 'uncovered': 'untested'}
LINE = re.compile(r'^(- )?(STILL FAIL|FAIL|PASS|RESOLVED) (complexity|CRAP|untested|uncovered): (.*)$')
HEAD = re.compile(r'^(\S.*) \(([^()]+):(\d+)\):$')
NAMED = re.compile(r'^(.*?(?: \(occurrence \d+\))?) \(([^()]+?)(?::(\d+))?\)(?::| is | )')


def classify(text):
    """Yields (kind, measure, function, path, line) for each code line of one delivery."""
    head = None
    for raw in text.split('\n'):
        ln = raw.strip()
        m = LINE.match(ln)
        if m:
            kind, meas, rest = m.group(2), MEAS[m.group(3)], m.group(4)
            if m.group(1) and head:
                yield kind, meas, head[0], head[1], ln
                continue
            n = NAMED.match(rest)
            fn, path = (n.group(1), n.group(2)) if n else (None, None)
            yield kind, meas, fn, path, ln
            continue
        h = HEAD.match(ln)
        if h and not ln.startswith(('FAIL', 'PASS', 'Full', 'Revision')):
            head = (h.group(1), h.group(2))
            continue
        if re.match(r'^Complexity( counted|: counting| changed)?[: ]', ln) or re.match(r'^Coverage', ln) \
                or ln.startswith('CRAP threshold is now') or 'coverage.exclude)' in ln and 'no longer checked' in ln:
            yield 'summary', 'summary', None, None, ln
        if 'coverage is off until the daemon restarts' in ln or "could not load Squeal's coverage provider" in ln:
            yield 'note', 'note', None, None, ln


lines = []
cc = json.load(open(O + 'cc.json'))
for s in cc:
    starts = sorted(x['ts'] for x in s['starts'] if x['ts'])
    where = 'main' if s['cwd'] == '/home/agent/projects/squeal' else ('worktree' if s['cwd'] and '/worktrees/' in s['cwd'] else str(s['cwd']))
    sid = (s['cwd'] or '').split('/')[-1][:8] if where == 'worktree' else s['session'][:8]
    model = 'haiku' if any('haiku' in m for m in s['models']) else ('opus' if any('opus' in m for m in s['models']) else ','.join(s['models']))
    for d in s['deliveries']:
        if not d['ts'] or not (W0 <= d['ts'] <= W1) or not d.get('text'):
            continue
        start = max([t for t in starts if t <= d['ts']], default=s['first'])
        for kind, meas, fn, path, ln in classify(d['text']):
            lines.append({'harness': 'claude', 'where': where, 'session': sid, 'file': s['file'], 'model': model,
                          'ts': d['ts'], 'event': d['event'], 'version': version_at(start), 'kind': kind,
                          'measure': meas, 'function': fn, 'path': path, 'line': ln})
cx = json.load(open(O + 'codex-all.json'))
for s in cx:
    cwd = s['cwd'] or ''
    repo = cwd.split('/')[4] if cwd.startswith('/home/agent/projects/') else cwd
    where = 'worktree' if '/worktrees/' in cwd else 'main'
    sid = cwd.split('/')[-1][:8] if where == 'worktree' else s['file'].split('/')[-1][-20:-6]
    for d in s['deliveries']:
        if not (W0 <= d['ts'] <= W1):
            continue
        for kind, meas, fn, path, ln in classify(d['text']):
            lines.append({'harness': 'codex', 'repo': repo, 'where': where, 'session': sid, 'file': s['file'], 'model': s['model'],
                          'ts': d['ts'], 'event': 'Stop' if d.get('stop') else 'developer', 'version': s['version'],
                          'kind': kind, 'measure': meas, 'function': fn, 'path': path, 'line': ln})
json.dump(lines, open(O + 'lines.json', 'w'), indent=0)
c = collections.Counter((x['harness'], x.get('repo', 'squeal'), x['where'], x['kind'], x['measure']) for x in lines)
for k, v in sorted(c.items()):
    print(v, k)
