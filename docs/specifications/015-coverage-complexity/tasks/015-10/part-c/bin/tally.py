# Throwaway probe for 015-10 Part C. Not product code.
#   python3 -I tally.py <session dir>...
# Every complexity line the sessions were told, by kind, with its function and the seconds from
# the last file-writing tool call's result to the delivery; then totals by kind.
import collections
import json
import re
import sys

KINDS = [
    ("STILL FAIL", re.compile(r"^STILL FAIL complexity: (\S+) \(([^)]+)\) is (\d+)")),
    ("FAIL", re.compile(r"^FAIL complexity: (\S+) \(([^)]+)\) is (\d+)")),
    ("PASS", re.compile(r"^PASS complexity: (\S+) \(([^)]+)\) is (\d+)")),
    ("too big", re.compile(r"^(\S+) is (\d+) KiB, over the \d+ KiB limit")),
    ("more", re.compile(r"^and (\d+) more complexity changes")),
]
WRITES = re.compile(r"open\([^)]*['\"]w['\"]|sed -i|perl -pi|\bcat >|\btee\b|write_text|writeFileSync|git merge|git rebase|git checkout|git pull")
totals = collections.Counter()
for d in sys.argv[1:]:
    t0 = None
    tools = {}
    last = None
    for raw in open(f"{d}/stream.jsonl"):
        ts, _, line = raw.partition(" ")
        t = int(ts) / 1000
        t0 = t0 or t
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "assistant":
            for c in ev["message"].get("content", []):
                if c.get("type") == "tool_use":
                    tools[c["id"]] = c
        elif ev.get("type") == "user" and isinstance(ev["message"].get("content"), list):
            for c in ev["message"]["content"]:
                tool = tools.get(c.get("tool_use_id")) if c.get("type") == "tool_result" else None
                if tool and (tool["name"] in ("Edit", "Write", "MultiEdit") or (tool["name"] == "Bash" and WRITES.search(tool["input"].get("command", "")))):
                    last = t
        elif ev.get("type") == "system" and ev.get("subtype") == "hook_response":
            out = ev.get("output") or ""
            try:
                ctx = (json.loads(out).get("hookSpecificOutput") or {}).get("additionalContext") or ""
            except ValueError:
                ctx = ""
            for ln in ctx.split("\n"):
                for kind, rx in KINDS:
                    m = rx.match(ln.strip())
                    if m:
                        totals[kind] += 1
                        lat = "" if last is None else f"+{t - last:.1f}s"
                        print(f"{d.split('/')[-1]:5} {t - t0:6.1f} {lat:7} {kind:10} {' '.join(m.groups())}")
                        break
print(dict(totals), "total", sum(totals.values()))
