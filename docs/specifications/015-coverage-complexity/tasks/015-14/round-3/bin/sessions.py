"""015-14 Round 3: every session in the extracts with its harness, project,
model, hook versions and counts of SQUEAL lines by kind, read only.

Input: part-b/bin/extract_cc.py's and extract_codex.py's outputs. A Claude Code
line's version is the newest Squeal in its plugin cache born at or before the
session's latest process start before the line (Round 1's rule); the births
come from `stat -c %W` of each cache directory. A Codex session's version is
the one in its skill path, a lower bound (Round 1).
Usage: python3 -I sessions.py <cc.json> <codex.json> <out.json>"""
import bisect, glob, json, os, re, subprocess, sys

cc_path, codex_path, out_path = sys.argv[1:4]
CACHE = os.path.expanduser('~/.claude/plugins/cache/hearsay/squeal')
births = []
for d in glob.glob(CACHE + '/0.1.*'):
    w = int(subprocess.run(['stat', '-c', '%W', d], capture_output=True, text=True).stdout)
    births.append((w, os.path.basename(d)))
births.sort()
KINDS = {
    'coverage': re.compile(r'^\s*(?:- )?(FAIL|PASS|STILL FAIL|RESOLVED) (CRAP|untested|uncovered)\b', re.M),
    'complexity': re.compile(r'^\s*(?:- )?(FAIL|PASS|STILL FAIL|RESOLVED) complexity\b', re.M),
    'told-over': re.compile(r'^(Code|Complexity): .*(told about|--told)', re.M),
    'no-record note': re.compile(r'completed test files? got no record'),
    'coverage off note': re.compile(r'coverage is off until the daemon restarts'),
    'provider failure': re.compile(r'Failed to load custom CoverageProviderModule'),
}


def epoch(ts):
    return subprocess.run(['date', '-d', ts, '+%s'], capture_output=True, text=True).stdout.strip()


def cc_version(starts, ts):
    before = [s['ts'] for s in starts if s['ts'] and s['ts'] <= ts]
    if not before:
        return None
    t = int(epoch(max(before)))
    i = bisect.bisect_right([b[0] for b in births], t)
    return births[i - 1][1] if i else None


def project(cwd):
    cwd = cwd or '?'
    m = re.match(r'/home/agent/projects/([^/]+)(/\.ai/cezar/worktrees/([0-9a-f]{8}))?', cwd)
    return (m.group(1), 'worktree ' + m.group(3) if m.group(3) else 'main checkout') if m else (cwd, '?')


rows = []
for s in json.load(open(cc_path)):
    repo, where = project(s['cwd'])
    counts, versions = {}, set()
    for d in s['deliveries']:
        v = cc_version(s['starts'], d['ts'])
        versions.add(v)
        for k, rx in KINDS.items():
            n = len(rx.findall(d['text']))
            if n:
                counts[f'{k} @{v}'] = counts.get(f'{k} @{v}', 0) + n
    start_versions = sorted({cc_version(s['starts'], x['ts']) for x in s['starts'] if x['ts']} - {None})
    rows.append({'harness': 'claude-code', 'session': (s['session'] or '?')[:8], 'repo': repo, 'where': where,
                 'first': s['first'], 'last': s['last'], 'models': s['models'], 'start_versions': start_versions,
                 'deliveries': len(s['deliveries']), 'counts': counts})
for s in json.load(open(codex_path)):
    repo, where = project(s['cwd'])
    counts = {}
    for d in s['deliveries']:
        for k, rx in KINDS.items():
            n = len(rx.findall(d['text']))
            if n:
                counts[f"{k} @{s['version']}"] = counts.get(f"{k} @{s['version']}", 0) + n
    rows.append({'harness': 'codex', 'session': os.path.basename(s['file'])[-45:-37], 'repo': repo, 'where': where,
                 'first': s['first'], 'last': s['last'], 'models': [s['model']], 'start_versions': [s['version']],
                 'deliveries': len(s['deliveries']), 'counts': counts})
rows.sort(key=lambda r: r['first'] or '')
json.dump({'cache_births': [[b[0], b[1]] for b in births], 'sessions': rows}, open(out_path, 'w'), indent=1)
for r in rows:
    print(r['harness'][:6], r['session'], r['repo'], r['where'], r['first'][:19], r['last'][11:19], ','.join(m or '?' for m in r['models'])[:30],
          r['start_versions'], r['deliveries'], r['counts'])
