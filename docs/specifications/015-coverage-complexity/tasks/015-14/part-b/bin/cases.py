"""015-14 part B: each coverage and complexity line of a worktree session with its cause and the agent's next steps.
Cause: own (the session wrote the file before the line), pull (a git pull, merge, rebase, switch, checkout,
reset or cherry-pick in the session before the line, and no own write), not own (neither).
Usage: python3 -I cases.py > out/cases.txt"""
import json, re, collections

O = '/tmp/dogfood-015-14/w-327524f0/out/'
lines = json.load(open(O + 'lines.json'))
cc = {s['file']: s for s in json.load(open(O + 'cc.json'))}
cx = {s['file']: s for s in json.load(open(O + 'codex-all.json'))}
GIT = re.compile(r'git (-C \S+ )?(pull|merge|rebase|switch|checkout|reset|cherry-pick|am|stash (pop|apply))\b')


def writes(s, path, before):
    if path is None:
        return False
    for t in s.get('tools', []):
        if t['ts'] and t['ts'] < before:
            if t['name'] in ('Edit', 'Write', 'MultiEdit', 'NotebookEdit') and t['path'] and t['path'].endswith('/' + path):
                return True
            if t['name'] == 'Bash' and t['cmd'] and path in t['cmd'] and re.search(r"open\(|>|sed -i|tee|apply|python", t['cmd']):
                return True
    for c in s.get('cmds', []):
        if c['ts'] < before and path in c['input'] and re.search(r'apply_patch|\*\*\* (Update|Add) File', c['input']):
            return True
    return False


def pulled(s, before):
    for t in s.get('tools', []):
        if t['ts'] and t['ts'] < before and t['name'] == 'Bash' and t['cmd'] and GIT.search(t['cmd']):
            return t['ts']
    for c in s.get('cmds', []):
        if c['ts'] < before and GIT.search(c['input']):
            return c['ts']
    return None


out = collections.defaultdict(list)
for x in lines:
    if x['where'] != 'worktree' or x['kind'] in ('summary',):
        continue
    s = cc.get(x['file']) or cx.get(x['file'])
    own = writes(s, x['path'], x['ts'])
    p = pulled(s, x['ts'])
    x['cause'] = 'own' if own else ('pull' if p else 'not own')
    out[(x['harness'], x['session'], x['file'])].append(x)
json.dump([x for v in out.values() for x in v], open(O + 'cases.json', 'w'), indent=0)
for (h, sid, f), xs in sorted(out.items(), key=lambda kv: kv[1][0]['ts']):
    s = cc.get(f) or cx.get(f)
    print(f'=== {h} {sid} {xs[0]["version"]} {f.split("/")[-1][:12]} lines={len(xs)}')
    for x in xs:
        print(f'  {x["ts"][11:19]} {x["event"][:4]} {x["version"]} [{x["cause"]}] {x["line"][:230]}')
    last = xs[-1]['ts']
    for t in s.get('texts', []):
        if xs[0]['ts'] <= t['ts'] and re.search(r'(?i)crap|untested|uncovered|coverage|complexity|squeal code', t['text']):
            print(f'    > {t["ts"][11:19]} {t["text"][:260]}'.replace('\n', ' '))
