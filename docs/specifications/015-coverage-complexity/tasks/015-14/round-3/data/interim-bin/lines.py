"""015-14 Round 3 interim: every code line delivered in a window, with its session, version, measure and kind.
Round 2's part-b/bin/lines.py with these changes: the out directory and window are arguments; the Claude
Code cache births are read with `stat -c %W`, not a fixed table; a Codex line's version is the newest
Squeal version its rollout named (skill or hook path) at or before the line, not the first one; `Code:`
lines (told-over, since 015-84) count as summaries; each line keeps its repository and its delivery's index.
Claude Code: a line's version is the newest cache entry at the latest process start before it (Round 1's rule).
Usage: python3 -I lines.py <out dir> <window start> <window end>
(reads cc.json and codex.json there; writes lines.json)"""
import glob, json, os, re, subprocess, sys, collections

O, W0, W1 = sys.argv[1].rstrip('/') + '/', sys.argv[2], sys.argv[3]
CACHE = sorted((subprocess.run(['date', '-u', '-d', '@' + subprocess.run(['stat', '-c', '%W', d], capture_output=True, text=True).stdout.strip(),
                                '+%Y-%m-%dT%H:%M:%SZ'], capture_output=True, text=True).stdout.strip(), os.path.basename(d))
               for d in glob.glob(os.path.expanduser('~/.claude/plugins/cache/hearsay/squeal/0.1.*')))
CACHE = [(v, t) for t, v in CACHE]
CODEX_PATH = re.compile(r'(?:plugins/cache/hearsay/squeal|squeal-hearsay/versions)/(0\.1\.\d+)')


def codex_versions(path):
    """(ts, version) for each rollout line that names a Squeal version, in file order."""
    out = []
    for line in open(path, errors='replace'):
        m = CODEX_PATH.findall(line)
        if m:
            ts = re.search(r'"timestamp":"([^"]+)"', line)
            if ts:
                out.append((ts.group(1), max(m, key=lambda v: int(v.split('.')[-1]))))
    return out


def codex_version_at(seen, ts):
    v = None
    for t, name in seen:
        if t <= ts:
            v = name
    return v


def repo_of(cwd):
    return cwd.split('/')[4] if cwd and cwd.startswith('/home/agent/projects/') else str(cwd)


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
        if re.match(r'^Complexity( counted|: counting| changed)?[: ]', ln) or re.match(r'^(Coverage|Code: )', ln) \
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
    for i, d in enumerate(s['deliveries']):
        if not d['ts'] or not (W0 <= d['ts'] <= W1) or not d.get('text'):
            continue
        start = max([t for t in starts if t <= d['ts']], default=s['first'])
        for kind, meas, fn, path, ln in classify(d['text']):
            lines.append({'harness': 'claude', 'repo': repo_of(s['cwd']), 'where': where, 'session': sid, 'file': s['file'], 'model': model,
                          'ts': d['ts'], 'delivery': i, 'event': d['event'], 'version': version_at(start), 'kind': kind,
                          'measure': meas, 'function': fn, 'path': path, 'line': ln})
cx = json.load(open(O + 'codex.json'))
for s in cx:
    cwd = s['cwd'] or ''
    repo = repo_of(cwd)
    where = 'worktree' if '/worktrees/' in cwd else 'main'
    sid = cwd.split('/')[-1][:8] if where == 'worktree' else s['file'].split('/')[-1][-20:-6]
    seen = codex_versions(s['file'])
    for i, d in enumerate(s['deliveries']):
        if not (W0 <= d['ts'] <= W1):
            continue
        for kind, meas, fn, path, ln in classify(d['text']):
            lines.append({'harness': 'codex', 'repo': repo, 'where': where, 'session': sid, 'file': s['file'], 'model': s['model'],
                          'ts': d['ts'], 'delivery': i, 'event': 'Stop' if d.get('stop') else 'developer',
                          'version': codex_version_at(seen, d['ts']) or s['version'],
                          'kind': kind, 'measure': meas, 'function': fn, 'path': path, 'line': ln})
json.dump(lines, open(O + 'lines.json', 'w'), indent=0)
c = collections.Counter((x['harness'], x['repo'], x['where'], x['version'], x['kind'], x['measure']) for x in lines)
for k, v in sorted(c.items()):
    print(v, k)
