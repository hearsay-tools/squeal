"""Codex sessions: SQUEAL developer messages, commands and agent text (read only).
Usage: python3 -I extract_codex.py <out.json> <window-start> <window-end> <rollout.jsonl>..."""
import json, re, sys
out = []
W0, W1 = sys.argv[2], sys.argv[3]
for f in sys.argv[4:]:
    s = {'file': f, 'cwd': None, 'version': None, 'first': None, 'last': None, 'deliveries': [], 'cmds': [], 'texts': [], 'model': None}
    for line in open(f, errors='replace'):
        o = json.loads(line)
        ts = o.get('timestamp'); t = o.get('type'); p = o.get('payload') or {}
        if ts:
            s['first'] = s['first'] or ts; s['last'] = ts
        if t == 'session_meta':
            s['cwd'] = p.get('cwd')
        if t == 'turn_context' and not s['model']:
            s['model'] = p.get('model')
        m = re.search(r'plugins/cache/hearsay/squeal/(0\.1\.\d+)', line)
        if m and not s['version']:
            s['version'] = m.group(1)
        if t == 'response_item' and p.get('type') == 'message':
            txt = '\n'.join(c.get('text', '') for c in p.get('content', []) if isinstance(c, dict))
            if p.get('role') == 'developer' and 'SQUEAL' in txt:
                s['deliveries'].append({'ts': ts, 'text': txt})
            elif p.get('role') == 'user' and '<hook_prompt' in txt and 'SQUEAL' in txt:
                s['deliveries'].append({'ts': ts, 'text': re.sub(r'^<hook_prompt[^>]*>', '', txt), 'stop': True})
            elif p.get('role') == 'assistant' and txt.strip():
                s['texts'].append({'ts': ts, 'text': txt[:1500]})
        if t == 'response_item' and p.get('type') in ('custom_tool_call', 'function_call'):
            s['cmds'].append({'ts': ts, 'name': p.get('name'), 'input': str(p.get('input') or p.get('arguments'))[:1500]})
    if s['last'] and s['last'] >= W0 and s['first'] <= W1:
        out.append(s)
json.dump(out, open(sys.argv[1], 'w'))
print(len(out), 'sessions', sum(len(x['deliveries']) for x in out), 'deliveries')
