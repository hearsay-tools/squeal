# Throwaway. Reads Claude Code transcripts (~/.claude/projects/*/*.jsonl) and prints the
# duration of each Squeal session-start.mjs hook (SessionStart and SubagentStart):
# per repository, source and outcome. Read-only. Usage: python3 -I hook-durations.py [since-iso]
import json, os, sys, glob, statistics, collections
since = sys.argv[1] if len(sys.argv) > 1 else "2026-11-14"
root = os.path.expanduser("~/.claude/projects")
rows = []
for d in glob.glob(root + "/*"):
    base = os.path.basename(d)
    repo = "cezar" if "projects-cezar" in base else "squeal" if "projects-squeal" in base else None
    if repo is None: continue
    where = "main" if base.endswith(("projects-cezar", "projects-squeal")) else "task"
    for f in glob.glob(d + "/*.jsonl"):
        if os.path.getmtime(f) < 0: continue
        with open(f, errors="replace") as fh:
            for line in fh:
                if "session-start.mjs" not in line: continue
                try: e = json.loads(line)
                except Exception: continue
                a = e.get("attachment") or {}
                if "session-start.mjs" not in (a.get("command") or ""): continue
                ts = e.get("timestamp", "")
                if ts < since: continue
                out = a.get("stdout") or ""
                rows.append(dict(repo=repo, where=where, ts=ts, kind=a.get("type"),
                    name=a.get("hookName"), ms=a.get("durationMs"), timedOut=a.get("timedOut", False),
                    exit=a.get("exitCode"), listed=("not listed" not in out and "has not listed" not in out) if out else None,
                    outlen=len(out)))
def pct(xs, p):
    xs = sorted(xs); return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None
g = collections.defaultdict(list)
for r in rows: g[(r["repo"], r["where"], r["name"], r["kind"])].append(r["ms"] or 0)
print("repo where hook kind n median p90 max over2000")
for k in sorted(g):
    xs = g[k]; print(*k, len(xs), pct(xs, .5), pct(xs, .9), max(xs), sum(x > 2000 for x in xs))
# by day, Claude SessionStart:resume only
d = collections.defaultdict(list)
for r in rows:
    if r["name"] == "SessionStart:resume": d[(r["ts"][:10], r["repo"])].append(r)
print("\nresume by day: day repo n cancelled median_ms p90_ms")
for k in sorted(d):
    xs = [r["ms"] or 0 for r in d[k]]
    print(*k, len(xs), sum(r["kind"] == "hook_cancelled" for r in d[k]), pct(xs, .5), pct(xs, .9))
if os.environ.get("DUMP"): json.dump(rows, open(os.environ["DUMP"], "w"))
