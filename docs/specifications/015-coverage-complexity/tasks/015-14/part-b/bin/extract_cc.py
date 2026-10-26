"""Extract SQUEAL deliveries, tool calls and agent text from Claude Code transcripts (read only).
Usage: python3 -I extract_cc.py <list-of-jsonl> <out.json> <window-start-iso> <window-end-iso>"""
import json, re, sys

files = [l.strip() for l in open(sys.argv[1]) if l.strip()]
W0, W1 = sys.argv[3], sys.argv[4]
CODE = re.compile(r'complexity|Complexity|KiB, over the|CRAP|untested|uncovered|[Cc]overage')

def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return '\n'.join(x if isinstance(x, str) else json.dumps(x) for x in content)
    return ''

out = []
for f in files:
    s = {'file': f, 'cwd': None, 'session': None, 'starts': [], 'deliveries': [], 'tools': [], 'results': {}, 'texts': [], 'first': None, 'last': None, 'models': set()}
    for line in open(f, errors='replace'):
        try:
            o = json.loads(line)
        except Exception:
            continue
        ts = o.get('timestamp')
        if s['cwd'] is None and o.get('cwd'):
            s['cwd'] = o['cwd']
        if s['session'] is None and o.get('sessionId'):
            s['session'] = o['sessionId']
        if o.get('isSidechain'):
            continue
        if ts:
            s['first'] = s['first'] or ts
            s['last'] = ts
        t = o.get('type')
        if t == 'attachment':
            a = o['attachment']
            k = a.get('type', '')
            if k == 'environment' and not s['cwd']:
                s['cwd'] = a.get('snapshot', {}).get('workingDirectory')
            if k == 'instructions':
                # a Claude Code process start (startup or resume) loads these
                s['starts'].append({'ts': ts, 'name': 'process:' + k, 'kind': 'marker', 'ms': None})
            if k in ('hook_success', 'hook_cancelled', 'hook_non_blocking_error') and a.get('hookEvent') == 'SessionStart':
                s['starts'].append({'ts': ts, 'name': a.get('hookName'), 'kind': k, 'ms': a.get('durationMs')})
            if k in ('hook_cancelled', 'hook_non_blocking_error') and a.get('hookEvent') != 'SessionStart':
                s['deliveries'].append({'ts': ts, 'event': a.get('hookEvent'), 'tool': a.get('toolUseID'), 'lost': k, 'ms': a.get('durationMs'), 'text': ''})
            if k in ('hook_success', 'hook_cancelled', 'hook_non_blocking_error'):
                s.setdefault('hooks', []).append({'ts': ts, 'event': a.get('hookEvent'), 'kind': k, 'ms': a.get('durationMs')})
            if k == 'hook_additional_context':
                txt = text_of(a.get('content'))
                if 'SQUEAL' in txt or CODE.search(txt):
                    s['deliveries'].append({'ts': ts, 'event': a.get('hookEvent'), 'tool': a.get('toolUseID'), 'text': txt})
        elif t == 'assistant':
            m = o.get('message', {})
            if m.get('model'):
                s['models'].add(m['model'])
            for b in m.get('content', []) or []:
                if b.get('type') == 'tool_use':
                    inp = b.get('input', {})
                    s['tools'].append({'ts': ts, 'id': b.get('id'), 'name': b.get('name'), 'msg': m.get('id'),
                                       'path': inp.get('file_path') or inp.get('notebook_path') or inp.get('path'),
                                       'cmd': (inp.get('command') or '')[:1500] if isinstance(inp.get('command'), str) else None,
                                       'old': (inp.get('old_string') or '')[:4000] if b.get('name') == 'Edit' else None,
                                       'new': (inp.get('new_string') or '')[:4000] if b.get('name') == 'Edit' else None,
                                       'skill': inp.get('skill')})
                elif b.get('type') == 'text' and b.get('text', '').strip():
                    s['texts'].append({'ts': ts, 'text': b['text'][:2000]})
        elif t == 'user':
            c = o.get('message', {}).get('content')
            if isinstance(c, list):
                for b in c:
                    if isinstance(b, dict) and b.get('type') == 'tool_result':
                        r = text_of(b.get('content'))
                        s['results'][b.get('tool_use_id')] = {'ts': ts, 'err': b.get('is_error'), 'head': r[:600]}
    if not s['last'] or s['last'] < W0 or (s['first'] and s['first'] > W1):
        continue
    s['models'] = sorted(s['models'])
    out.append(s)
json.dump(out, open(sys.argv[2], 'w'))
print(len(out), 'sessions;', sum(len(x['deliveries']) for x in out), 'delivery entries')
