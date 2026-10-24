# Throwaway probe for 015-26. Not product code.
#   python3 -I tally.py <sessions dir>
# Per session: each `squeal code` call and each eslint call with its time, and each delivered
# complexity line (FAIL, STILL FAIL, PASS) with its time, in seconds from the stream's first line.
import json
import os
import re
import sys

root = sys.argv[1]
KINDS = re.compile(r"^(STILL FAIL|FAIL|PASS|RESOLVED) complexity: (\S+)")
for s in sorted(os.listdir(root)):
    path = os.path.join(root, s, "stream.jsonl")
    if not os.path.exists(path) or "contaminated" in s or "aborted" in s:
        continue
    t0 = None
    events = []
    for raw in open(path):
        ts, _, line = raw.partition(" ")
        t0 = t0 or int(ts)
        t = (int(ts) - t0) / 1000
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "assistant":
            for c in ev.get("message", {}).get("content", []):
                if c.get("type") != "tool_use":
                    continue
                cmd = str(c.get("input", {}).get("command", ""))
                if "squeal code" in cmd:
                    events.append((t, "CALL squeal code", cmd.split("squeal code", 1)[1][:70]))
                if "eslint" in cmd:
                    events.append((t, "CALL eslint", ""))
        if ev.get("type") == "system" and ev.get("subtype") == "hook_response":
            for ln in (ev.get("output") or "").replace("\\n", "\n").split("\n"):
                m = KINDS.search(ln.strip())
                if m:
                    events.append((t, f"LINE {m.group(1)}", m.group(2)))
    calls = sum(1 for e in events if e[1] == "CALL squeal code")
    lines = sum(1 for e in events if e[1].startswith("LINE"))
    print(f"== {s}: {calls} squeal code calls, {lines} complexity lines")
    for t, kind, what in events:
        print(f"  {t:6.1f} {kind:18} {what}")
