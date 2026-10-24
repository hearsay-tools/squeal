"""Markdown table of every complexity line in the window with its judgment. Usage: python3 -I line-table.py > out/line-table.md"""
import json, re
W0, W1 = '2026-10-24T03:55', '2026-10-24T16:49'
D = json.load(open('out/cases.json')); X = json.load(open('out/codex.json'))
J = {}
for f, h in (('out/judged.tsv', 'cc'), ('out/codex-judged.tsv', 'codex')):
    for row in open(f):
        if row.startswith('#') or not row.strip(): continue
        w, t, k, fn, cause, react, verdict, note = (row.rstrip('\n').split('\t') + [''] * 8)[:8]
        J[(h, w, t, k, fn)] = (cause, react, verdict, note)
def short(ln):
    ln = re.sub(r' \(ESLint rule\).*$', '', ln)
    ln = re.sub(r'; it was already over 20 before it$', '; already over 20 before it', ln)
    return ln.replace('|', '\\|')
rows = []
for c in D['cases']:
    if not (W0 <= c['ts'] <= W1) or c['kind'] in ('registration',) or c['kind'].startswith('other'): continue
    w = (c['worktree'] or 'main')[:8]
    fn = c['name'] if c['kind'] not in ('summary', 'too big') else ('-' if c['kind'] == 'summary' else 'run.ts')
    j = J[('cc', w, c['ts'][11:19], c['kind'], fn)]
    hint = ' (with the quiet hint)' if 'stays quiet' in c['line'] else ''
    rows.append((c['ts'][11:19], c['repo'], 'Claude Code ' + w, c['version'], short(c['line']) + hint, j))
RX = [('STILL FAIL', r'^STILL FAIL complexity: (.+?) \([^()\s]+'), ('FAIL', r'^FAIL complexity: (.+?) \([^()\s]+'), ('PASS', r'^PASS complexity: (.+?) \([^()\s]+'),
      ('too big', r'^\S+ is \d+ KiB, over'), ('summary', r'^Complexity (counted|threshold)')]
for s in X:
    cwd = s['cwd'] or ''
    repo = 'squeal' if '/projects/squeal' in cwd else 'cezar' if '/projects/cezar' in cwd else None
    if not repo: continue
    co = 'worktree' if '/worktrees/' in cwd else 'main'
    key = cwd.split('/')[-1][:8] if co == 'worktree' else 'cezar'
    for d in s['deliveries']:
        if not (W0 <= d['ts'] <= W1): continue
        for ln in d['text'].split('\n'):
            for k, rx in RX:
                m = re.match(rx, ln)
                if not m: continue
                fn = m.group(1) if k in ('STILL FAIL', 'FAIL', 'PASS') else ('-' if k == 'summary' else 'run.ts')
                j = J[('codex', key, d['ts'][11:19], k, fn)]
                rows.append((d['ts'][11:19], repo, 'Codex ' + (key if co == 'worktree' else 'main checkout'), s['version'], short(ln.replace('/home/agent/.codex/plugins/data/squeal-hearsay/bin/', '')), j))
                break
rows.sort()
print('| Time (Z) | Repo | Session | Version | Line | Cause | Agent | Verdict | Note |')
print('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for t, repo, who, v, ln, (cause, react, verdict, note) in rows:
    print(f'| {t[:5]} | {repo} | {who} | {v} | `{ln}` | {cause} | {react} | {verdict} | {note} |')
print(f'\n{len(rows)} lines.')
