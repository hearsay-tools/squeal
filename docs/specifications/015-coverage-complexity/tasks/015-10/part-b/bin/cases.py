"""Real complexity lines per session, with context. Usage: python3 -I cases.py out/cc.json out/cases.json out/cases.txt"""
import json, re, sys, bisect

S = json.load(open(sys.argv[1]))
CACHE = [('0.1.283', '01:58:27'), ('0.1.284', '02:42:11'), ('0.1.286', '05:16:43'), ('0.1.287', '08:39:19'), ('0.1.288', '09:09:30'),
         ('0.1.289', '10:07:25'), ('0.1.291', '11:31:12'), ('0.1.292', '12:04:29'), ('0.1.293', '14:51:24'), ('0.1.294', '16:14:13')]
CACHE = [(v, '2026-10-24T' + t + 'Z') for v, t in CACHE]

def version_at(ts):
    v = '0.1.280'
    for ver, t in CACHE:
        if ts >= t:
            v = ver
    return v

LOC = r'(?P<name>.+) \((?P<path>[^()\s]+):(?P<line>\d+)\)'
KINDS = [
    ('STILL FAIL', re.compile(r'^STILL FAIL complexity: ' + LOC + r' is (?P<v>\d+) after the edit')),
    ('FAIL', re.compile(r'^FAIL complexity: ' + LOC + r' is (?P<v>\d+), over (?P<t>\d+)')),
    ('PASS', re.compile(r'^PASS complexity: ' + LOC + r' is (?P<v>\d+), at or under')),
    ('RESOLVED', re.compile(r'^RESOLVED complexity: (?P<name>.+) \((?P<path>[^()\s]+?)(:(?P<line>\d+))?\) is no longer')),
    ('too big', re.compile(r'^(?P<path>\S+) is (?P<v>\d+) KiB, over the \d+ KiB limit')),
    ('summary', re.compile(r'^Complexity (counted|threshold is now)')),
    ('more', re.compile(r'^and \d+ more complexity changes')),
    ('other side: code', re.compile(r'^Complexity: \d+ functions? over \d+ that this session was told about')),
    ('other side: tests', re.compile(r'^Tests: \d+ known failures?; squeal status lists them')),
    ('registration', re.compile(r'^Complexity: (\d+ functions? over \d+(; counting[^;]*)?; squeal code lists them|counting)')),
]
GIT_MOVE = re.compile(r'\bgit\s+(-C\s+\S+\s+)?(pull|rebase|merge|checkout|switch|reset|cherry-pick|am|stash\s+(pop|apply)|restore|fetch\s+.*&&.*(rebase|merge|reset))\b')
BASH_WRITE = re.compile(r"sed -i|perl -[pi]|>\s*[\w./-]+\.(ts|tsx|js|mjs|py|md|json)|python3? - <<|cat >|tee |git apply|open\([^)]*['\"]w")

def repo_of(cwd):
    cwd = cwd or ''
    for r in ('squeal', 'cezar'):
        base = '/home/agent/projects/' + r
        if cwd == base:
            return r, 'main', None
        if cwd.startswith(base + '/.ai/cezar/worktrees/'):
            return r, 'worktree', cwd.split('/')[8]
    return None, None, None

cases = []
sessions = []
for s in S:
    repo, co, wt = repo_of(s['cwd'])
    if not repo:
        continue
    starts = sorted([x for x in s['starts'] if x['ts']], key=lambda x: x['ts'])
    start_ts = starts[0]['ts'] if starts else s['first']
    tools = s['tools']
    tool_ts = [t['ts'] for t in tools]
    tool_by_id = {t['id']: t for t in tools}
    sess = {'file': s['file'], 'session': s['session'], 'repo': repo, 'checkout': co, 'worktree': wt, 'first': s['first'], 'last': s['last'],
            'starts': [(x['ts'], x['name'], x['kind']) for x in starts if x['kind'] != 'marker'],
            'processes': sorted(set(version_at(x['ts']) for x in starts)), 'version': version_at(start_ts or s['first']),
            'models': s['models'], 'n_tools': len(tools),
            'edits': sum(1 for t in tools if t['name'] in ('Edit', 'Write', 'MultiEdit', 'NotebookEdit')),
            'bash_writes': sum(1 for t in tools if t['name'] == 'Bash' and t['cmd'] and BASH_WRITE.search(t['cmd'])),
            'git_moves': [(t['ts'], t['cmd'][:200]) for t in tools if t['name'] == 'Bash' and t['cmd'] and GIT_MOVE.search(t['cmd'])],
            'lines': {}, 'registration': [], 'lost': 0}
    for d in s['deliveries']:
        if d.get('lost'):
            sess['lost'] += 1
            continue
        title = d['text'].split('\n', 1)[0]
        for ln in d['text'].split('\n'):
            for kind, rx in KINDS:
                m = rx.match(ln)
                if not m:
                    continue
                if kind == 'registration':
                    sess['registration'].append((d['ts'], d['event'], ln))
                    break
                sess['lines'][kind] = sess['lines'].get(kind, 0) + 1
                # versions: the latest SessionStart before the delivery
                st = [x for x in starts if x['ts'] and x['ts'] <= d['ts']]
                ver = version_at(st[-1]['ts'] if st else (s['first'] or d['ts']))
                i = bisect.bisect_right(tool_ts, d['ts'])
                prev = tools[max(0, i - 6):i]
                nxt = tools[i:i + 4]
                ntext = [x for x in s['texts'] if x['ts'] >= d['ts']][:2]
                path = m.groupdict().get('path')
                name = m.groupdict().get('name')
                file_edits_before = [t for t in tools[:i] if (t.get('path') and path and t['path'].endswith(path)) or (t['name'] == 'Bash' and t['cmd'] and path and path in t['cmd'] and BASH_WRITE.search(t['cmd']))]
                moves_before = [t for t in tools[:i] if t['name'] == 'Bash' and t['cmd'] and GIT_MOVE.search(t['cmd'])]
                trig = tool_by_id.get(d['tool'])
                cases.append({'session': s['session'], 'file': s['file'], 'repo': repo, 'checkout': co, 'worktree': wt, 'version': ver,
                              'ts': d['ts'], 'event': d['event'], 'title': title, 'kind': kind, 'line': ln, 'name': name, 'path': path,
                              'value': int(m.group('v')) if 'v' in m.groupdict() and m.group('v') else None,
                              'trigger': trig and {'name': trig['name'], 'path': trig.get('path'), 'cmd': (trig.get('cmd') or '')[:300]},
                              'prev': [{'ts': t['ts'], 'name': t['name'], 'path': t.get('path'), 'cmd': (t.get('cmd') or '')[:300]} for t in prev],
                              'next': [{'ts': t['ts'], 'name': t['name'], 'path': t.get('path'), 'cmd': (t.get('cmd') or '')[:300]} for t in nxt],
                              'next_text': [x['text'][:700] for x in ntext],
                              'file_edits_before': len(file_edits_before),
                              'last_move_before': moves_before[-1]['cmd'][:200] if moves_before else None,
                              'last_move_ts': moves_before[-1]['ts'] if moves_before else None})
                break
    sessions.append(sess)
json.dump({'sessions': sessions, 'cases': cases}, open(sys.argv[2], 'w'), indent=1)
with open(sys.argv[3], 'w') as w:
    for c in cases:
        if c['kind'] in ('other side: code', 'other side: tests'):
            continue
        w.write(f"=== {c['repo']} {c['checkout']} {c['worktree']} {c['session']} v{c['version']} {c['ts']} {c['event']}\n")
        w.write(f"TITLE {c['title']}\nLINE  {c['line'][:260]}\n")
        w.write(f"file edits before: {c['file_edits_before']}; last git move: {c['last_move_ts']} {c['last_move_before']}\n")
        for t in c['prev'][-3:]:
            w.write(f"  prev {t['ts']} {t['name']} {t['path'] or ''} {t['cmd'][:200]}\n")
        for t in c['next'][:3]:
            w.write(f"  next {t['ts']} {t['name']} {t['path'] or ''} {t['cmd'][:200]}\n")
        for x in c['next_text'][:1]:
            w.write('  text ' + x.replace('\n', ' ')[:500] + '\n')
print(len(sessions), 'sessions', len(cases), 'lines')
