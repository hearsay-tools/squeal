# Throwaway: from a RUST_LOG=debug `codex exec` stderr and its --json stdout,
# print for each `date +%s%N` tool output the ms until the next
# codex.websocket_request (the model request that carries the tool result).
import datetime
import json
import re
import sys

err, out = sys.argv[1], sys.argv[2]
reqs = set()
for line in open(err, errors='replace'):
    line = re.sub(r'\x1b\[[0-9;]*m', '', line)
    if 'event.name="codex.websocket_request"' in line:
        ts = line.split()[0]
        d = datetime.datetime.strptime(ts[:26], '%Y-%m-%dT%H:%M:%S.%f')
        d = d.replace(tzinfo=datetime.timezone.utc)
        reqs.add(int(d.timestamp() * 1000))
reqs = sorted(reqs)
outs = []
for line in open(out):
    o = json.loads(line)
    it = o.get('item') or {}
    if o.get('type') == 'item.completed' and it.get('type') == 'command_execution':
        m = re.match(r'^(\d{19})\s*$', it.get('aggregated_output') or '')
        if m:
            outs.append(int(m.group(1)) // 1000000)
print([next((r - t for r in reqs if r >= t), None) for t in outs])
