# Throwaway. Reads Squawk run logs (~/projects/{cezar,squeal}/.ai/squawk/runs/*.ndjson) and,
# for each Claude Code SessionStart hook item, prints the time from its step's start to the
# hook's end (an upper bound of the hook: it includes Claude Code's own start), by status.
# Only Claude items (id hook_<uuid>); a completed item counts when its text is Squeal's.
# Read-only. Usage: python3 -I squawk-hooks.py [since-date]
import json, os, sys, glob, collections, datetime as dt
since = sys.argv[1] if len(sys.argv) > 1 else "2026-11-14"
def t(s): return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
g = collections.defaultdict(list)
for repo in ("cezar", "squeal"):
    for f in glob.glob(os.path.expanduser(f"~/projects/{repo}/.ai/squawk/runs/*.ndjson")):
        if dt.datetime.fromtimestamp(os.path.getmtime(f)).isoformat() < since: continue
        start = None
        for line in open(f, errors="replace"):
            if '"step-start"' in line:
                try: start = t(json.loads(line)["ts"])
                except Exception: start = None
                continue
            if '"event":"SessionStart"' not in line: continue
            try: d = json.loads(line)
            except Exception: continue
            it = d.get("item", {})
            if not it.get("id", "").startswith("hook_") or "session-start:" in it["id"]: continue  # Codex ids name the hook file
            text = "".join(e.get("text", "") for e in it.get("entries", []))
            st = it.get("status")
            if st == "completed" and "SQUEAL" not in text: continue
            if d["ts"][:10] < since or start is None: continue
            ms = (t(d["ts"]) - start).total_seconds() * 1000
            g[(repo, it.get("name"), st)].append(ms)
def pct(xs, p): xs = sorted(xs); return round(xs[min(len(xs) - 1, int(p * len(xs)))]) if xs else None
print("repo hook status n median p90  (ms from step start to hook end)")
for k in sorted(g): print(*k, len(g[k]), pct(g[k], .5), pct(g[k], .9))
