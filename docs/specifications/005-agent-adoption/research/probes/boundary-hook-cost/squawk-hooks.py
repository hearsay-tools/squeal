# Throwaway, row 005-110. Squawk run logs (~/projects/{cezar,squeal}/.ai/squawk/runs/*.ndjson), read-only:
# hook items by repository, event and status, with or without entries (output), since a date.
# Usage: python3 -I squawk-hooks.py [since-iso]
import json, os, sys, glob, collections
since = sys.argv[1] if len(sys.argv) > 1 else "2026-11-14"
c = collections.Counter(); runs = collections.defaultdict(set)
for repo in ("cezar", "squeal"):
    for f in glob.glob(os.path.expanduser(f"~/projects/{repo}/.ai/squawk/runs/*.ndjson")):
        with open(f, errors="replace") as fh:
            for line in fh:
                if '"kind":"hook"' not in line or "item.completed" not in line: continue
                try: o = json.loads(line)
                except Exception: continue
                if (o.get("ts") or "") < since: continue
                it = o["item"]
                k = (repo, it.get("event"), it.get("status"), "output" if it.get("entries") else "silent")
                c[k] += 1; runs[k].add(os.path.basename(f)[:8])
print("repo event status output n runs")
for k in sorted(c): print(*k, c[k], len(runs[k]))
