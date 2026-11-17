# Throwaway, row 005-110. Claude Code transcripts, read-only. Splits each Squawk task transcript at
# 011-385's "stretch": from the first Squeal text that says the test files are not listed ("has not
# listed this worktree" or "still starting in this worktree and has no results") to the first later
# Squeal text that does not. Counts tool batches (distinct assistant message ids with a tool_use),
# PostToolBatch and Stop cancellations, and completed PostToolBatch durations, inside and outside it.
# Usage: python3 -I field-split.py [since-iso]
import json, os, sys, glob, collections
since = sys.argv[1] if len(sys.argv) > 1 else "2026-11-14"
UNL = ("has not listed this worktree", "still starting in this worktree and has no results")
agg = collections.defaultdict(collections.Counter); ms = collections.defaultdict(list)
for d in glob.glob(os.path.expanduser("~/.claude/projects/*")):
    b = os.path.basename(d)
    repo = "cezar" if "projects-cezar--ai-squawk-worktrees" in b else "squeal" if "projects-squeal--ai-squawk-worktrees" in b else None
    if repo is None: continue
    for f in glob.glob(d + "/*.jsonl"):
        ev = []; seen = set()
        for line in open(f, errors="replace"):
            try: o = json.loads(line)
            except Exception: continue
            if o.get("timestamp", "") < since or o.get("isSidechain"): continue
            a = o.get("attachment") or {}
            if str(a.get("type", "")).startswith("hook_") and a.get("type") != "hook_additional_context":
                text = ""
                try: text = json.loads(a.get("stdout") or "{}").get("hookSpecificOutput", {}).get("additionalContext", "") or ""
                except Exception: pass
                cmd = a.get("command") or ""
                ev.append(("hook", a.get("hookEvent"), a.get("type"), a.get("durationMs"), "SQUEAL" in text, any(u in text for u in UNL), "/hooks/run" in cmd or "SQUEAL" in text))
            m = o.get("message") or {}
            if o.get("type") == "assistant" and isinstance(m.get("content"), list) and any(isinstance(c, dict) and c.get("type") == "tool_use" for c in m["content"]) and m.get("id") not in seen:
                seen.add(m.get("id")); ev.append(("batch",))
            if o.get("type") == "assistant" and m.get("stop_reason") == "end_turn": ev.append(("turn",))
        if not any(e[0] == "hook" and e[6] for e in ev): continue
        inside = False
        for e in ev:
            if e[0] == "hook" and e[5]: inside = True
            elif e[0] == "hook" and e[4] and not e[5]: inside = False
            k = (repo, "in stretch" if inside else "outside")
            if e[0] == "batch": agg[k]["batches"] += 1; continue
            if e[0] == "turn": agg[k]["turns"] += 1; continue
            if e[1] in ("PostToolBatch", "Stop") and e[6]:
                agg[k][e[1] + "_" + e[2]] += 1
                if e[1] == "PostToolBatch" and e[2] == "hook_success" and e[3] is not None: ms[k].append(e[3])
def q(xs, p): xs = sorted(xs); return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None
print("repo where batches ptb_cancelled share ptb_success(text) success_med success_p90 turns stop_cancelled share")
for k in sorted(agg):
    a = agg[k]; c = a["PostToolBatch_hook_cancelled"]
    print(*k, a["batches"], c, f"{100*c/max(1,a['batches']):.1f}%", a["PostToolBatch_hook_success"], q(ms[k], .5), q(ms[k], .9), a["turns"], a["Stop_hook_cancelled"], f"{100*a['Stop_hook_cancelled']/max(1,a['turns']):.0f}%")
