# Throwaway, row 005-110. Reads Claude Code transcripts (~/.claude/projects/*/*.jsonl), read-only,
# and prints per repository, place (task worktree or main checkout), Squeal hook and outcome:
# count, durationMs median/p90 of completed runs, cancelled (timedOut) count, by day.
# Usage: python3 -I field-hooks.py [since-iso] [DUMP=path]
import json, os, sys, glob, collections
since = sys.argv[1] if len(sys.argv) > 1 else "2026-11-14"
root = os.path.expanduser("~/.claude/projects")
NAMES = ("post-tool-batch.mjs", "stop.mjs", "user-prompt-submit.mjs", "pre-tool-use.mjs", "session-start.mjs")
rows = []
for d in glob.glob(root + "/*"):
    base = os.path.basename(d)
    repo = "cezar" if "projects-cezar" in base else "squeal" if "projects-squeal" in base else None
    if repo is None: continue
    where = "main" if base.endswith(("projects-cezar", "projects-squeal")) else "task"
    for f in glob.glob(d + "/*.jsonl"):
        with open(f, errors="replace") as fh:
            for line in fh:
                if ".mjs" not in line: continue
                try: e = json.loads(line)
                except Exception: continue
                a = e.get("attachment") or {}
                cmd = a.get("command") or ""
                name = next((n for n in NAMES if n in cmd and "stop-slow" not in cmd), None)
                if name is None: continue
                ts = e.get("timestamp", "")
                if ts < since: continue
                rows.append(dict(repo=repo, where=where, ts=ts, kind=a.get("type"), hook=a.get("hookName"),
                    entry=name, ms=a.get("durationMs"), timedOut=a.get("timedOut", False), exit=a.get("exitCode"),
                    outlen=len(a.get("stdout") or ""), task=base[-36:], session=os.path.basename(f)[:8]))
def pct(xs, p):
    xs = sorted(x for x in xs if x is not None); return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None
g = collections.defaultdict(list)
for r in rows: g[(r["repo"], r["where"], r["entry"])].append(r)
print("repo where entry n cancelled completed med_ms p90_ms with_output")
for k in sorted(g):
    xs = g[k]; ok = [r for r in xs if r["kind"] != "hook_cancelled"]
    print(*k, len(xs), sum(r["kind"] == "hook_cancelled" for r in xs), len(ok), pct([r["ms"] for r in ok], .5), pct([r["ms"] for r in ok], .9), sum(r["outlen"] > 0 for r in ok))
dd = collections.defaultdict(list)
for r in rows:
    if r["entry"] in ("post-tool-batch.mjs", "stop.mjs") and r["where"] == "task": dd[(r["ts"][:10], r["repo"], r["entry"])].append(r)
print("\ntask worktrees by day: day repo entry n cancelled completed_med_ms")
for k in sorted(dd):
    xs = dd[k]; ok = [r["ms"] for r in xs if r["kind"] != "hook_cancelled"]
    print(*k, len(xs), sum(r["kind"] == "hook_cancelled" for r in xs), pct(ok, .5))
if os.environ.get("DUMP"): json.dump(rows, open(os.environ["DUMP"], "w"))
