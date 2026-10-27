"""015-14 Round 3 interim: the window's sessions, their source edits, repeated summaries and loader
accounts, read only, from extract_cc.py's and extract_codex.py's outputs and lines.py's lines.json.

- A session counts when it has a SQUEAL delivery or a tool call in the window. Its versions are those of
  its deliveries in the window, by lines.py's rules (Claude Code: newest cache entry at the latest process
  start; Codex: newest version its rollout named at or before the delivery).
- A source edit is a write in the window to a path under `src/` or `test/` of the session's own checkout,
  taken only from the written path itself: Claude Code Edit, Write, MultiEdit or NotebookEdit; an
  `apply_patch` file header; the file `sed -i` edits; `p = '<path>'` in a command that has `open(p, 'w')`;
  the target of `>`, `>>` or `tee`. Paths in another checkout are left out. A `git cherry-pick`, `merge`
  or `pull` is not an edit (Round 2's `pull` cause). `src/` paths outside `coverage.exclude` are the ones
  coverage measures in this repository.
- Summaries: Round 2's rule, the first of its text (digits ignored) per session is unclear, a repeat noise.
- Loader accounts (015-81): in one delivery, the counts of test files that load one path; more than one
  count for the same path is inconsistent.
Usage: python3 -I window.py <out dir> <window start> <window end>  (writes window.json)"""
import collections, glob, json, os, re, subprocess, sys

O, W0, W1 = sys.argv[1].rstrip('/') + '/', sys.argv[2], sys.argv[3]
EXCLUDED = re.compile(r'^(test/|src/runners/node-test/runtime/)')
F = r"((?:/[\w.@-]+)*/?(?:\./)?(?:src|test)/[\w./@-]+\.\w+)"
WRITTEN = [re.compile(r"\*\*\* (?:Update|Add|Delete) File: " + F), re.compile(r"sed -i[^|;&\n]*?\s['\"]?" + F),
           re.compile(r">>? ?['\"]?" + F), re.compile(r"tee (?:-a )?['\"]?" + F)]
PY_TARGET = re.compile(r"\bp\s*=\s*['\"]" + F + r"['\"]")
PY_WRITE = re.compile(r"open\(p,\s*['\"][wa]['\"]")
LOADERS = re.compile(r'(\d+) test files? loads? this file|no test file loads this file')
lines = json.load(open(O + 'lines.json'))
BIRTHS = sorted((subprocess.run(['date', '-u', '-d', '@' + subprocess.run(['stat', '-c', '%W', d], capture_output=True, text=True).stdout.strip(),
                                 '+%Y-%m-%dT%H:%M:%SZ'], capture_output=True, text=True).stdout.strip(), os.path.basename(d))
                for d in glob.glob(os.path.expanduser('~/.claude/plugins/cache/hearsay/squeal/0.1.*')))
CODEX_PATH = re.compile(r'(?:plugins/cache/hearsay/squeal|squeal-hearsay/versions)/(0\.1\.\d+)')


def cc_version(s, ts):
    start = max([x['ts'] for x in s['starts'] if x['ts'] and x['ts'] <= ts], default=s['first'])
    return max([v for t, v in BIRTHS if t <= start], key=lambda v: int(v.split('.')[-1]), default=None)


def codex_version(seen, ts, first):
    v = first
    for t, name in seen:
        if t <= ts:
            v = name
    return v


def codex_seen(path):
    out = []
    for line in open(path, errors='replace'):
        m = CODEX_PATH.findall(line)
        ts = re.search(r'"timestamp":"([^"]+)"', line) if m else None
        if ts:
            out.append((ts.group(1), max(m, key=lambda v: int(v.split('.')[-1]))))
    return out


def where_of(cwd):
    m = re.match(r'/home/agent/projects/([^/]+)(/\.ai/cezar/worktrees/([0-9a-f]{8}))?', cwd or '')
    return (m.group(1), m.group(3) or 'main') if m else (cwd, '?')


def own(path, root):
    """The path relative to the session's checkout, or None for another checkout."""
    if path.startswith('/'):
        return path[len(root):] if path.startswith(root) else None
    return path[2:] if path.startswith('./') else path


def written(cmd, root):
    if re.search(r'\bcd /home/agent/projects/\S*/worktrees/', cmd) and root not in cmd:
        return set()
    found = {m for rx in WRITTEN for m in rx.findall(cmd)}
    if PY_WRITE.search(cmd):
        found |= set(PY_TARGET.findall(cmd))
    return {p for p in (own(f, root) for f in found) if p and p.startswith(('src/', 'test/'))}


def edits_cc(s):
    root = (s['cwd'] or '').rstrip('/') + '/'
    out = set()
    for t in s.get('tools', []):
        if not t['ts'] or not (W0 <= t['ts'] <= W1):
            continue
        if t['name'] in ('Edit', 'Write', 'MultiEdit', 'NotebookEdit') and t['path']:
            p = own(t['path'], root)
            if p and p.startswith(('src/', 'test/')):
                out.add(p)
        elif t['name'] == 'Bash' and t['cmd']:
            out |= written(t['cmd'], root)
    return out


def edits_codex(s):
    root = (s['cwd'] or '').rstrip('/') + '/'
    out = set()
    for c in s.get('cmds', []):
        if c['ts'] and W0 <= c['ts'] <= W1:
            out |= written(c['input'], root)
    return out


by_session = collections.defaultdict(list)
for x in lines:
    by_session[(x['harness'], x['file'])].append(x)
sessions = []
for harness, name in (('claude', 'cc.json'), ('codex', 'codex.json')):
    for s in json.load(open(O + name)):
        dts = [d['ts'] for d in s['deliveries'] if d.get('ts') and W0 <= d['ts'] <= W1]
        tts = [t['ts'] for t in s.get('tools', []) + s.get('cmds', []) if t.get('ts') and W0 <= t['ts'] <= W1]
        if not dts and not tts:
            continue
        repo, where = where_of(s['cwd'])
        ls = by_session[(harness, s['file'])]
        if harness == 'claude':
            versions = sorted({cc_version(s, t) for t in dts} - {None})
        else:
            seen_v = codex_seen(s['file'])
            versions = sorted({codex_version(seen_v, t, s['version']) for t in dts} - {None})
        edited = sorted(edits_cc(s) if harness == 'claude' else edits_codex(s))
        measured = [p for p in edited if p.startswith('src/') and not EXCLUDED.match(p)]
        model = ','.join(s.get('models') or [s.get('model') or '?'])
        sessions.append({'harness': harness, 'repo': repo, 'where': where, 'file': s['file'].split('/')[-1][-44:],
                         'model': model, 'first': min(dts + tts), 'last': max(dts + tts), 'deliveries': len(dts),
                         'versions': versions, 'edited': len(edited), 'measured': len(measured),
                         'measured_paths': measured[:12],
                         'coverage_lines': sum(1 for x in ls if x['measure'] in ('crap', 'untested')),
                         'complexity_lines': sum(1 for x in ls if x['measure'] == 'complexity'),
                         'summaries': sum(1 for x in ls if x['kind'] == 'summary')})

seen, sums = set(), collections.Counter()
for x in lines:
    if x['kind'] != 'summary':
        continue
    k = (x['harness'], x['session'], x.get('file'), re.sub(r'\d+', 'N', x['line']))
    told = 'told about' in x['line']
    kind = 'told-over' if told else ('registration' if re.search(r'^Complexity: \d+ functions? over \d+;', x['line']) else 'other')
    sums[(x['repo'], 'worktree' if x['where'] == 'worktree' else 'main', kind, 'repeat' if k in seen else 'first')] += 1
    seen.add(k)
accounts = collections.defaultdict(set)
for x in lines:
    if x['measure'] in ('crap', 'untested') and x['path']:
        for m in LOADERS.finditer(x['line']):
            accounts[(x['harness'], x['file'], x['delivery'], x['path'])].add(m.group(1) or '0')
inconsistent = [{'session': k[1].split('/')[-1][:12], 'delivery': k[2], 'path': k[3], 'counts': sorted(v)} for k, v in accounts.items() if len(v) > 1]

json.dump({'window': [W0, W1], 'sessions': sessions,
           'summaries': [{'repo': k[0], 'where': k[1], 'kind': k[2], 'order': k[3], 'n': n} for k, n in sorted(sums.items())],
           'loader_accounts': {'paths_in_deliveries': len(accounts), 'inconsistent': inconsistent}},
          open(O + 'window.json', 'w'), indent=1)
table = collections.defaultdict(collections.Counter)
for s in sessions:
    k = (s['repo'], 'worktree' if s['where'] != 'main' else 'main', s['harness'], '/'.join(s['versions']) or 'no delivery')
    table[k]['sessions'] += 1
    table[k]['deliveries'] += s['deliveries']
    table[k]['edited src/test'] += s['edited'] > 0
    table[k]['edited measured src'] += s['measured'] > 0
    table[k]['coverage lines'] += s['coverage_lines']
    table[k]['complexity lines'] += s['complexity_lines']
for k, v in sorted(table.items()):
    print(k, dict(v))
print('summaries', [(k, n) for k, n in sorted(sums.items())])
print('loader accounts: paths', len(accounts), 'inconsistent', inconsistent)
